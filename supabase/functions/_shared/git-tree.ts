// C3 commit 4: GitHub tree/content primitives, EXTRACTED from git-pull
// (previously private functions there) so the repo-import pipeline reuses
// the battle-tested walk instead of duplicating it. Behavior is unchanged;
// git-pull now imports from here. The non-recursive fallback exists because
// GitHub's recursive tree API silently truncates around ~100k entries/7MB —
// the walk trades API calls for completeness, bounded by wall clock and an
// entry cap so an XL repo degrades loudly instead of hanging.

/** A repository file path as encoded URL segments, or null when it is not a plain path
 *  inside the repository. A dot segment climbs out of /repos/{owner}/{repo}/contents/
 *  once the URL is parsed and reaches another endpoint with the integration's token
 *  (the RLS audit, 2026-09-30), so dot and empty segments are refused and every
 *  segment is encoded. */
export function encodeRepoPath(path: string): string | null {
  if (typeof path !== "string" || path === "" || path.length > 4096) return null;
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return segments.map(encodeURIComponent).join("/");
}

export const MAX_TREE_WALK_ENTRIES = 100_000;
export const TREE_WALK_CONCURRENCY = 15;
export const TREE_WALK_TIMEOUT_MS = 110_000;

export interface GitTreeResult {
  // deno-lint-ignore no-explicit-any
  tree: any[];
  truncated: boolean;
  collectedCount?: number;
  pendingDirs?: number;
  /** Directories the walk could not read after its retries (AJ.1). */
  failedDirs?: number;
  /** GitLab: tree pages it could not read before the listing's end. */
  failedPages?: number;
}

/** A directory read that failed on a rate limit or a server error is retried
 * this many times, waiting what GitHub asks for (Retry-After) up to the cap. */
export const TREE_DIR_RETRIES = 2;
const TREE_RETRY_WAIT_CAP_MS = 10_000;
const TREE_RETRY_DEFAULT_MS = 1_000;

/** How long the provider asks a caller to wait, or null when the answer is not
 *  worth waiting for (a 4xx that is not a rate limit). GitHub's secondary rate
 *  limits arrive as 403 with Retry-After or with no remaining quota; GitLab's
 *  as 429 with Retry-After and RateLimit-* headers (no x- prefix). */
export function retryWaitMs(resp: Response, capMs: number, defaultMs = TREE_RETRY_DEFAULT_MS): number | null {
  const remaining = resp.headers.get("x-ratelimit-remaining") ?? resp.headers.get("ratelimit-remaining");
  const retryable = resp.status === 429 || resp.status >= 500 ||
    (resp.status === 403 && (resp.headers.has("retry-after") || remaining === "0"));
  if (!retryable) return null;
  const after = Number(resp.headers.get("retry-after"));
  if (Number.isFinite(after) && after > 0) return Math.min(after * 1000, capMs);
  const reset = Number(resp.headers.get("x-ratelimit-reset") ?? resp.headers.get("ratelimit-reset"));
  if (remaining === "0" && Number.isFinite(reset) && reset > 0) {
    const wait = reset * 1000 - Date.now();
    // A primary quota that resets beyond the cap is not waited for here.
    return wait > capMs ? null : Math.max(wait, defaultMs);
  }
  return defaultMs;
}

export function buildGitHubHeaders(token: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function fetchGitHubTree(
  apiBase: string, owner: string, repo: string, branch: string, headers: Record<string, string>,
): Promise<{ tree: GitTreeResult["tree"]; truncated: boolean }> {
  const treeUrl = `${apiBase}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

  const treeResponse = await fetch(treeUrl, { headers });
  if (!treeResponse.ok) {
    const body = await treeResponse.text();

    if (treeResponse.status === 401) {
      throw new Error('GitHub rejected the access token (401 Bad credentials). The token may be expired or revoked. Please re-save the integration with a new token.');
    }
    if (treeResponse.status === 404) {
      const repoCheck = await fetch(`${apiBase}/repos/${owner}/${repo}`, { headers });
      if (repoCheck.ok) {
        const repoData = await repoCheck.json();
        const actualDefault = repoData.default_branch || 'unknown';
        throw new Error(`Branch "${branch}" not found in ${owner}/${repo}. The repository's default branch is "${actualDefault}". Update the branch name in your integration settings.`);
      }
      throw new Error(`Repository ${owner}/${repo} not found, or the token lacks access. Check the repo name and token permissions (requires "repo" scope).`);
    }
    throw new Error(`Failed to get repo tree (${treeResponse.status}): ${body}`);
  }

  const treeData = await treeResponse.json();
  return {
    tree: treeData.tree || [],
    truncated: treeData.truncated === true,
  };
}

export async function fetchGitHubTreeNonRecursive(
  apiBase: string, owner: string, repo: string, rootSha: string, headers: Record<string, string>,
  opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<GitTreeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // deno-lint-ignore no-explicit-any
  const allBlobs: any[] = [];
  const queue: Array<{ sha: string; pathPrefix: string }> = [{ sha: rootSha, pathPrefix: "" }];
  let hitLimit = false;
  let timedOut = false;
  let failedDirs = 0;
  const walkStart = Date.now();

  while (queue.length > 0 && !hitLimit && !timedOut) {
    if (Date.now() - walkStart > TREE_WALK_TIMEOUT_MS) {
      timedOut = true;
      console.warn(`[git-tree] Non-recursive walk hit wall-clock timeout (${TREE_WALK_TIMEOUT_MS}ms) with ${allBlobs.length} blobs collected, ${queue.length} dirs remaining`);
      break;
    }

    const batch = queue.splice(0, TREE_WALK_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ sha, pathPrefix }) => {
        const url = `${apiBase}/repos/${owner}/${repo}/git/trees/${sha}`;
        let resp = await fetchImpl(url, { headers });
        // AJ.1: fifteen reads at a time over thousands of directories meets
        // GitHub's secondary rate limit, and a directory that failed was
        // dropped with the listing still called complete. It is retried, and
        // one that still fails marks the listing truncated.
        for (let retry = 0; !resp.ok && retry < TREE_DIR_RETRIES; retry++) {
          const wait = retryWaitMs(resp, TREE_RETRY_WAIT_CAP_MS);
          if (wait === null) break;
          await resp.body?.cancel();
          await sleep(wait);
          resp = await fetchImpl(url, { headers });
        }
        if (!resp.ok) {
          console.warn(`[git-tree] Non-recursive tree fetch failed for ${pathPrefix || "/"} (${sha}): ${resp.status}`);
          await resp.body?.cancel();
          failedDirs++;
          return { blobs: [], subtrees: [] };
        }
        const data = await resp.json();
        // deno-lint-ignore no-explicit-any
        const blobs: any[] = [];
        const subtrees: Array<{ sha: string; pathPrefix: string }> = [];
        for (const item of data.tree || []) {
          const fullPath = pathPrefix ? `${pathPrefix}/${item.path}` : item.path;
          if (item.type === "blob") {
            blobs.push({ ...item, path: fullPath });
          } else if (item.type === "tree") {
            subtrees.push({ sha: item.sha, pathPrefix: fullPath });
          }
        }
        return { blobs, subtrees };
      })
    );

    for (const { blobs, subtrees } of results) {
      allBlobs.push(...blobs);
      queue.push(...subtrees);
      if (allBlobs.length >= MAX_TREE_WALK_ENTRIES) {
        hitLimit = true;
        break;
      }
    }
  }

  const truncated = hitLimit || timedOut || failedDirs > 0;
  const elapsed = Date.now() - walkStart;
  console.log(`[git-tree] Non-recursive walk completed in ${elapsed}ms: ${allBlobs.length} blobs (limit hit: ${hitLimit}, timed out: ${timedOut}, dirs failed: ${failedDirs}, dirs remaining: ${queue.length})`);
  return {
    tree: allBlobs.slice(0, MAX_TREE_WALK_ENTRIES),
    truncated,
    collectedCount: truncated ? allBlobs.length : undefined,
    pendingDirs: truncated ? queue.length : undefined,
    ...(failedDirs > 0 ? { failedDirs } : {}),
  };
}

export async function resolveRootTreeSha(
  apiBase: string, owner: string, repo: string, branch: string, headers: Record<string, string>,
): Promise<string> {
  const refUrl = `${apiBase}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const refResp = await fetch(refUrl, { headers });
  if (!refResp.ok) {
    throw new Error(`Failed to resolve branch ref "${branch}": ${refResp.status}`);
  }
  const refData = await refResp.json();
  const commitSha = refData.object?.sha;
  if (!commitSha) throw new Error(`Could not resolve commit SHA for branch "${branch}"`);

  const commitUrl = `${apiBase}/repos/${owner}/${repo}/git/commits/${commitSha}`;
  const commitResp = await fetch(commitUrl, { headers });
  if (!commitResp.ok) {
    throw new Error(`Failed to fetch commit ${commitSha}: ${commitResp.status}`);
  }
  const commitData = await commitResp.json();
  const treeSha = commitData.tree?.sha;
  if (!treeSha) throw new Error(`Could not resolve tree SHA from commit ${commitSha}`);
  return treeSha;
}

/** Head COMMIT sha for a branch — the import pipeline pins its whole run to
 * one sha so the skeleton's tree and the fetch stage's blob reads can never
 * disagree about what the repo contained. */
export async function resolveHeadCommitSha(
  apiBase: string, owner: string, repo: string, branch: string, headers: Record<string, string>,
): Promise<string> {
  const refUrl = `${apiBase}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const refResp = await fetch(refUrl, { headers });
  if (!refResp.ok) {
    throw new Error(`Failed to resolve branch ref "${branch}": ${refResp.status}`);
  }
  const refData = await refResp.json();
  const sha = refData.object?.sha;
  if (!sha) throw new Error(`Could not resolve commit SHA for branch "${branch}"`);
  return sha;
}

export async function fetchFullGitHubTree(
  apiBase: string, owner: string, repo: string, branch: string, headers: Record<string, string>,
): Promise<GitTreeResult> {
  const { tree, truncated } = await fetchGitHubTree(apiBase, owner, repo, branch, headers);
  if (!truncated) {
    return { tree, truncated: false };
  }
  console.log(`[git-tree] Recursive tree was truncated (${tree.length} items). Falling back to non-recursive walk.`);
  const rootSha = await resolveRootTreeSha(apiBase, owner, repo, branch, headers);
  return await fetchGitHubTreeNonRecursive(apiBase, owner, repo, rootSha, headers);
}

/** Small-N raw content fetch (the skeleton stage's manifest/config read).
 * Bulk content belongs to the fetch stage's blob lane — this is for the
 * couple dozen files frame determination needs before it runs. */
export async function fetchGitHubFiles(
  apiBase: string, owner: string, repo: string, ref: string, token: string,
  paths: string[],
): Promise<Array<{ path: string; content: string }>> {
  const headers = { ...buildGitHubHeaders(token), "Accept": "application/vnd.github.raw+json" };
  const files: Array<{ path: string; content: string }> = [];
  const batchSize = 10;
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (path) => {
        const encoded = encodeRepoPath(path);
        if (!encoded) return null;
        const resp = await fetch(
          `${apiBase}/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
          { headers },
        );
        if (!resp.ok) return null;
        return { path, content: await resp.text() };
      }),
    );
    for (const r of results) {
      if (r) files.push(r);
    }
  }
  return files;
}

// ── GitLab (GL-1, 2026-09-08) ───────────────────────────────────────────────
//
// The import lane's GitLab twins of the GitHub seams above. GitLab's REST
// tree is paginated at 100 entries a page with no recursive single call, so
// the walk requests pages in concurrent WINDOWS (offset pagination; the
// first short page ends the walk) — a 30k-file repository is ~300 pages,
// ~40 windows. Tree entries carry the blob id (the sha the census keeps for
// freshness) but NO size — GitLab does not report it in the tree — so size
// is 0 here and the GitLab blob lane asks the sizes before it asks bodies
// (import-blobs.ts), holding GitLab to GitHub's bounds (AJ.1).

export const GITLAB_TREE_PAGE = 100;
export const GITLAB_TREE_WINDOW = 8;

export function buildGitLabHeaders(token: string): Record<string, string> {
  return { "PRIVATE-TOKEN": token };
}

export function gitlabProjectPath(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

export interface GitLabTreeItem {
  id: string;
  name: string;
  type: "blob" | "tree";
  path: string;
  mode?: string;
}

export interface GitLabTreeOptions {
  fetchImpl?: typeof fetch;
  perPage?: number;
  window?: number;
  maxEntries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Every blob of a branch, walked in concurrent page windows. A 401 or 404 is a
 * named error, and so is a first page that cannot be read. A later page that
 * fails on a rate limit or a server error is retried as GitLab asks (AJ.1: eight
 * pages at a time meets the rate limit on a large repository, and one 429 used
 * to fail the whole import); one that still fails, or GitLab's offset limit on
 * a very large tree, marks the listing truncated, as the GitHub walk does. */
export async function fetchFullGitLabTree(
  apiBase: string, owner: string, repo: string, branch: string, token: string,
  opts: GitLabTreeOptions = {},
): Promise<GitTreeResult & { requests: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const perPage = opts.perPage ?? GITLAB_TREE_PAGE;
  const window = Math.max(1, opts.window ?? GITLAB_TREE_WINDOW);
  const maxEntries = opts.maxEntries ?? MAX_TREE_WALK_ENTRIES;
  const headers = buildGitLabHeaders(token);
  const project = gitlabProjectPath(owner, repo);
  // deno-lint-ignore no-explicit-any
  const tree: any[] = [];
  let requests = 0;
  let page = 1;
  let done = false;
  let truncated = false;
  /** Pages that could not be read. The walk stops at the first short page, so
   *  every one recorded lies before the listing's end: a gap. */
  const failedPages: number[] = [];

  const readPage = async (p: number): Promise<GitLabTreeItem[] | { failed: number }> => {
    const url = `${apiBase}/projects/${project}/repository/tree?ref=${encodeURIComponent(branch)}&recursive=true&per_page=${perPage}&page=${p}`;
    requests++;
    let resp = await fetchImpl(url, { headers });
    for (let retry = 0; !resp.ok && retry < TREE_DIR_RETRIES; retry++) {
      const wait = retryWaitMs(resp, TREE_RETRY_WAIT_CAP_MS);
      if (wait === null) break;
      await resp.body?.cancel();
      await sleep(wait);
      requests++;
      resp = await fetchImpl(url, { headers });
    }
    if (resp.ok) return (await resp.json()) as GitLabTreeItem[];
    await resp.body?.cancel();
    if (resp.status === 401) throw new Error("GitLab rejected the access token (401). The token may be expired, revoked, or missing the read_api / read_repository scope. Please re-save the integration with a new token.");
    if (resp.status === 404) throw new Error(`GitLab could not find ${owner}/${repo}@${branch} (404). Check the project path (group/subgroup/project), the branch, and that the token can see the project.`);
    if (p === 1) throw new Error(`GitLab tree page ${p} failed (HTTP ${resp.status})`);
    return { failed: resp.status };
  };

  while (!done && tree.length < maxEntries) {
    const pages = Array.from({ length: window }, (_, i) => page + i);
    const responses = await Promise.all(pages.map(readPage));
    let anyRead = false;
    for (let i = 0; i < responses.length; i++) {
      const items = responses[i];
      if (!Array.isArray(items)) {
        failedPages.push(pages[i]);
        continue;
      }
      anyRead = true;
      for (const item of items) {
        if (item.type !== "blob") continue;
        tree.push({ path: item.path, type: "blob", size: 0, sha: item.id });
        if (tree.length >= maxEntries) { truncated = true; break; }
      }
      if (items.length < perPage || truncated) { done = true; break; }
    }
    // A window with no page read ends the listing, incomplete: past GitLab's
    // offset limit on a very large tree every page answers 400, and a window
    // that failed whole would otherwise repeat forever.
    if (!anyRead) done = true;
    page += window;
  }
  if (failedPages.length > 0) {
    truncated = true;
    console.warn(`[git-tree] GitLab tree pages not read: ${failedPages.join(", ")}`);
  }
  return { tree, truncated, collectedCount: tree.length, requests, ...(failedPages.length > 0 ? { failedPages: failedPages.length } : {}) };
}

/** Raw bodies for a bounded set of paths (the skeleton's manifests and
 * configs), ten at a time. A path that fails is simply absent. */
export async function fetchGitLabFiles(
  apiBase: string, owner: string, repo: string, ref: string, token: string,
  paths: string[], fetchImpl: typeof fetch = fetch,
): Promise<Array<{ path: string; content: string }>> {
  const headers = buildGitLabHeaders(token);
  const project = gitlabProjectPath(owner, repo);
  const files: Array<{ path: string; content: string }> = [];
  const batchSize = 10;
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (path) => {
      try {
        const resp = await fetchImpl(
          `${apiBase}/projects/${project}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`,
          { headers },
        );
        if (!resp.ok) return null;
        return { path, content: await resp.text() };
      } catch {
        return null;
      }
    }));
    for (const r of results) if (r) files.push(r);
  }
  return files;
}

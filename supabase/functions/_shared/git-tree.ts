// C3 commit 4: GitHub tree/content primitives, EXTRACTED from git-pull
// (previously private functions there) so the repo-import pipeline reuses
// the battle-tested walk instead of duplicating it. Behavior is unchanged;
// git-pull now imports from here. The non-recursive fallback exists because
// GitHub's recursive tree API silently truncates around ~100k entries/7MB —
// the walk trades API calls for completeness, bounded by wall clock and an
// entry cap so an XL repo degrades loudly instead of hanging.

export const MAX_TREE_WALK_ENTRIES = 100_000;
export const TREE_WALK_CONCURRENCY = 15;
export const TREE_WALK_TIMEOUT_MS = 110_000;

export interface GitTreeResult {
  // deno-lint-ignore no-explicit-any
  tree: any[];
  truncated: boolean;
  collectedCount?: number;
  pendingDirs?: number;
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
): Promise<GitTreeResult> {
  // deno-lint-ignore no-explicit-any
  const allBlobs: any[] = [];
  const queue: Array<{ sha: string; pathPrefix: string }> = [{ sha: rootSha, pathPrefix: "" }];
  let hitLimit = false;
  let timedOut = false;
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
        const resp = await fetch(url, { headers });
        if (!resp.ok) {
          console.warn(`[git-tree] Non-recursive tree fetch failed for ${sha}: ${resp.status}`);
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

  const truncated = hitLimit || timedOut;
  const elapsed = Date.now() - walkStart;
  console.log(`[git-tree] Non-recursive walk completed in ${elapsed}ms: ${allBlobs.length} blobs (limit hit: ${hitLimit}, timed out: ${timedOut}, dirs remaining: ${queue.length})`);
  return {
    tree: allBlobs.slice(0, MAX_TREE_WALK_ENTRIES),
    truncated,
    collectedCount: truncated ? allBlobs.length : undefined,
    pendingDirs: truncated ? queue.length : undefined,
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
 * one sha so the skeleton's tree and the fetch stage's tarball can never
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
 * Bulk content belongs to the tarball stage — this is for the couple dozen
 * files frame determination needs before the tarball lands. */
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
        const resp = await fetch(
          `${apiBase}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
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

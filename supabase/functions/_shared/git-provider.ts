// P1-7 R1.5: provider API base resolution + shared ref lookup. The app container can be hosted
// anywhere, and so can the git server — cloud github.com/gitlab.com OR self-hosted GitHub
// Enterprise Server / self-managed GitLab (including a local container on the owner's bench).
// `git_integrations.base_url` (nullable) overrides the cloud default; null keeps today's
// behavior exactly.
//
// Conventions (stored normalized, no trailing slash):
//   github cloud  -> https://api.github.com
//   GHES          -> https://ghe.example.com/api/v3
//   gitlab cloud  -> https://gitlab.com/api/v4
//   self-managed  -> https://gitlab.example.com/api/v4
import { encodeRepoPath } from "./git-tree.ts";

export function providerApiBase(provider: string, baseUrl?: string | null): string {
  const normalized = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (normalized) return normalized;
  if (provider === "github") return "https://api.github.com";
  if (provider === "gitlab") return "https://gitlab.com/api/v4";
  throw new Error(`Unsupported provider: ${provider}`);
}

export interface HeadShaResult {
  sha: string | null;
  /** HTTP status when the provider answered with a failure; undefined on network errors. */
  status?: number;
}

/** Like fetchRemoteHeadSha but keeps the failure status so callers can say WHY (401 token vs 404 branch). */
export async function fetchRemoteHeadShaDetailed(
  provider: string, apiBase: string, owner: string, repo: string, branch: string, token: string,
): Promise<HeadShaResult> {
  try {
    if (provider === "github") {
      const resp = await fetch(
        `${apiBase}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
        { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "User-Agent": "nodespec" } },
      );
      if (!resp.ok) return { sha: null, status: resp.status };
      const data = await resp.json();
      return { sha: data.object?.sha ?? null };
    }
    if (provider === "gitlab") {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const resp = await fetch(
        `${apiBase}/projects/${projectPath}/repository/branches/${encodeURIComponent(branch)}`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (!resp.ok) return { sha: null, status: resp.status };
      const data = await resp.json();
      return { sha: data.commit?.id ?? null };
    }
    return { sha: null };
  } catch {
    return { sha: null };
  }
}

/** Current HEAD commit SHA of a remote branch (both providers). Null on any failure. */
export async function fetchRemoteHeadSha(
  provider: string, apiBase: string, owner: string, repo: string, branch: string, token: string,
): Promise<string | null> {
  return (await fetchRemoteHeadShaDetailed(provider, apiBase, owner, repo, branch, token)).sha;
}

/** R3-3a: create a REAL git branch at a given commit (both providers). A NodeSpec
 *  design branch maps 1:1 to a git ref — creating one creates the ref. Returns the
 *  new branch's HEAD sha on success, or an error string (409-class = already exists,
 *  surfaced as such so callers can bind to the existing ref instead of failing). */
export async function createRemoteBranch(
  provider: string, apiBase: string, owner: string, repo: string,
  newBranch: string, fromSha: string, token: string,
): Promise<{ sha: string | null; alreadyExists?: boolean; error?: string }> {
  try {
    if (provider === "github") {
      const resp = await fetch(`${apiBase}/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "nodespec",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
      });
      if (resp.status === 422) {
        const body = await resp.json().catch(() => ({}));
        if (String(body?.message ?? "").toLowerCase().includes("already exists")) {
          return { sha: fromSha, alreadyExists: true };
        }
        return { sha: null, error: `GitHub rejected branch creation: ${body?.message ?? resp.status}` };
      }
      if (!resp.ok) return { sha: null, error: `GitHub branch creation failed (HTTP ${resp.status})` };
      const data = await resp.json();
      return { sha: data.object?.sha ?? fromSha };
    }
    if (provider === "gitlab") {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const resp = await fetch(
        `${apiBase}/projects/${projectPath}/repository/branches?branch=${encodeURIComponent(newBranch)}&ref=${encodeURIComponent(fromSha)}`,
        { method: "POST", headers: { "PRIVATE-TOKEN": token } },
      );
      if (resp.status === 400) {
        const body = await resp.json().catch(() => ({}));
        if (String(body?.message ?? "").toLowerCase().includes("already exists")) {
          return { sha: fromSha, alreadyExists: true };
        }
        return { sha: null, error: `GitLab rejected branch creation: ${body?.message ?? resp.status}` };
      }
      if (!resp.ok) return { sha: null, error: `GitLab branch creation failed (HTTP ${resp.status})` };
      const data = await resp.json();
      return { sha: data.commit?.id ?? fromSha };
    }
    return { sha: null, error: `Unsupported provider: ${provider}` };
  } catch (err) {
    return { sha: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── R3-3b: a design merge IS a git merge, and the default vehicle is a PULL REQUEST ──

export interface PullRequestResult {
  url: string | null;
  number?: number;
  /** True when an open PR for this source→target pair already existed (we bind to it). */
  alreadyExists?: boolean;
  /** Provider said there is nothing to merge (no commits between the refs). */
  nothingToMerge?: boolean;
  error?: string;
}

/** Open a PR/MR from sourceRef into targetRef. An already-open PR is a bindable
 *  outcome, not a failure — the push that preceded this call already updated it. */
export async function createPullRequest(
  provider: string, apiBase: string, owner: string, repo: string,
  sourceRef: string, targetRef: string, title: string, body: string, token: string,
): Promise<PullRequestResult> {
  try {
    if (provider === "github") {
      const headers = {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "nodespec",
        "Content-Type": "application/json",
      };
      const resp = await fetch(`${apiBase}/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title, head: sourceRef, base: targetRef, body }),
      });
      if (resp.status === 422) {
        const errBody = await resp.json().catch(() => ({}));
        const msg = JSON.stringify(errBody?.errors ?? errBody?.message ?? "");
        if (msg.toLowerCase().includes("already exists")) {
          const listResp = await fetch(
            `${apiBase}/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${sourceRef}`)}&base=${encodeURIComponent(targetRef)}&state=open`,
            { headers },
          );
          if (listResp.ok) {
            const prs = await listResp.json();
            if (Array.isArray(prs) && prs.length > 0) {
              return { url: prs[0].html_url ?? null, number: prs[0].number, alreadyExists: true };
            }
          }
          return { url: null, error: "A pull request already exists for this branch, but it could not be located" };
        }
        if (msg.toLowerCase().includes("no commits between")) {
          return { url: null, nothingToMerge: true, error: `No commits between ${targetRef} and ${sourceRef} — nothing to merge` };
        }
        return { url: null, error: `GitHub rejected the pull request: ${msg}` };
      }
      if (!resp.ok) return { url: null, error: `GitHub PR creation failed (HTTP ${resp.status})` };
      const data = await resp.json();
      return { url: data.html_url ?? null, number: data.number };
    }
    if (provider === "gitlab") {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const glHeaders = { "PRIVATE-TOKEN": token, "Content-Type": "application/json" };
      const resp = await fetch(`${apiBase}/projects/${projectPath}/merge_requests`, {
        method: "POST",
        headers: glHeaders,
        body: JSON.stringify({ source_branch: sourceRef, target_branch: targetRef, title, description: body }),
      });
      if (resp.status === 409) {
        const listResp = await fetch(
          `${apiBase}/projects/${projectPath}/merge_requests?source_branch=${encodeURIComponent(sourceRef)}&target_branch=${encodeURIComponent(targetRef)}&state=opened`,
          { headers: { "PRIVATE-TOKEN": token } },
        );
        if (listResp.ok) {
          const mrs = await listResp.json();
          if (Array.isArray(mrs) && mrs.length > 0) {
            return { url: mrs[0].web_url ?? null, number: mrs[0].iid, alreadyExists: true };
          }
        }
        return { url: null, error: "A merge request already exists for this branch, but it could not be located" };
      }
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        return { url: null, error: `GitLab MR creation failed (HTTP ${resp.status}): ${JSON.stringify(errBody?.message ?? "")}` };
      }
      const data = await resp.json();
      return { url: data.web_url ?? null, number: data.iid };
    }
    return { url: null, error: `Unsupported provider: ${provider}` };
  } catch (err) {
    return { url: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** V3 AD.4 (D14): a pull request from NodeSpec's work branch. */
export interface PullRequestRef {
  number: number;
  url: string | null;
  /** The commits a merge of it put on the target: GitHub's merge_commit_sha
   *  (the merge, squash or last rebased commit), GitLab's squash, merge and
   *  source-head shas. Empty while it is open. */
  mergeShas: string[];
}

/** The open, or the recently merged, pull requests from sourceRef into
 *  targetRef, newest first. Null when the provider could not be read: not
 *  knowing is never "none". */
export async function listPullRequests(
  provider: string, apiBase: string, owner: string, repo: string,
  sourceRef: string, targetRef: string, token: string, state: "open" | "merged",
): Promise<PullRequestRef[] | null> {
  try {
    if (provider === "github") {
      const query = state === "open" ? "state=open&per_page=10" : "state=closed&sort=updated&direction=desc&per_page=30";
      const resp = await fetch(
        `${apiBase}/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${sourceRef}`)}&base=${encodeURIComponent(targetRef)}&${query}`,
        { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "User-Agent": "nodespec" } },
      );
      if (!resp.ok) return null;
      const prs = await resp.json();
      if (!Array.isArray(prs)) return null;
      return prs
        // deno-lint-ignore no-explicit-any
        .filter((pr: any) => state === "open" || !!pr?.merged_at)
        // deno-lint-ignore no-explicit-any
        .map((pr: any) => ({
          number: Number(pr.number),
          url: pr.html_url ?? null,
          mergeShas: state === "merged" && typeof pr.merge_commit_sha === "string" ? [pr.merge_commit_sha] : [],
        }));
    }
    if (provider === "gitlab") {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const resp = await fetch(
        `${apiBase}/projects/${projectPath}/merge_requests?source_branch=${encodeURIComponent(sourceRef)}&target_branch=${encodeURIComponent(targetRef)}&state=${state === "open" ? "opened" : "merged"}&order_by=updated_at&sort=desc&per_page=30`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (!resp.ok) return null;
      const mrs = await resp.json();
      if (!Array.isArray(mrs)) return null;
      // deno-lint-ignore no-explicit-any
      return mrs.map((mr: any) => ({
        number: Number(mr.iid),
        url: mr.web_url ?? null,
        mergeShas: state === "merged"
          ? [mr.squash_commit_sha, mr.merge_commit_sha, mr.sha].filter((x): x is string => typeof x === "string" && x.length > 0)
          : [],
      }));
    }
    return null;
  } catch {
    return null;
  }
}

/** V3 AD.4 (D14): point NodeSpec's work branch at `sha`, creating it when it
 *  does not exist. Only ever called for a work branch with no open pull
 *  request: its old commits were merged or turned down. */
export async function resetRemoteBranch(
  provider: string, apiBase: string, owner: string, repo: string,
  branch: string, sha: string, token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (provider === "github") {
      const resp = await fetch(`${apiBase}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        method: "PATCH",
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "User-Agent": "nodespec", "Content-Type": "application/json" },
        body: JSON.stringify({ sha, force: true }),
      });
      if (resp.ok) return { ok: true };
      if (resp.status === 404 || resp.status === 422) {
        const created = await createRemoteBranch(provider, apiBase, owner, repo, branch, sha, token);
        if (created.sha && created.alreadyExists !== true) return { ok: true };
        return { ok: false, error: created.error ?? `GitHub could not reset ${branch} (HTTP ${resp.status})` };
      }
      return { ok: false, error: `GitHub could not reset ${branch} (HTTP ${resp.status})` };
    }
    if (provider === "gitlab") {
      // GitLab moves no branch by force: the work branch is removed and cut again.
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const del = await fetch(`${apiBase}/projects/${projectPath}/repository/branches/${encodeURIComponent(branch)}`, {
        method: "DELETE", headers: { "PRIVATE-TOKEN": token },
      });
      if (!del.ok && del.status !== 404) return { ok: false, error: `GitLab could not remove ${branch} (HTTP ${del.status})` };
      const created = await createRemoteBranch(provider, apiBase, owner, repo, branch, sha, token);
      if (created.sha && created.alreadyExists !== true) return { ok: true };
      return { ok: false, error: created.error ?? `GitLab could not cut ${branch} again` };
    }
    return { ok: false, error: `Unsupported provider: ${provider}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface MergeBranchResult {
  sha: string | null;
  /** Provider reports the target already contains the source (nothing to merge). */
  alreadyMerged?: boolean;
  /** The merge cannot be done automatically — resolve in git (the provider's conflict UX). */
  conflict?: boolean;
  /** GitLab lane: the MR created for the merge (left open on conflict as the resolution surface). */
  prUrl?: string;
  error?: string;
}

/** Merge sourceRef into targetRef as a REAL merge commit via the provider API.
 *  GitHub: POST /merges. GitLab has no branch-merge endpoint: create an MR and
 *  accept it (a conflicted MR stays open and is returned as the resolution path). */
export async function mergeRemoteBranch(
  provider: string, apiBase: string, owner: string, repo: string,
  sourceRef: string, targetRef: string, message: string, token: string,
): Promise<MergeBranchResult> {
  try {
    if (provider === "github") {
      const resp = await fetch(`${apiBase}/repos/${owner}/${repo}/merges`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "nodespec",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ base: targetRef, head: sourceRef, commit_message: message }),
      });
      if (resp.status === 201) {
        const data = await resp.json();
        return { sha: data.sha ?? null };
      }
      if (resp.status === 204) return { sha: null, alreadyMerged: true };
      if (resp.status === 409) return { sha: null, conflict: true, error: "Merge conflict — resolve it in git (open a pull request or merge locally), then either side loads the result" };
      const errBody = await resp.text();
      return { sha: null, error: `GitHub merge failed (HTTP ${resp.status}): ${errBody.slice(0, 200)}` };
    }
    if (provider === "gitlab") {
      const pr = await createPullRequest(provider, apiBase, owner, repo, sourceRef, targetRef, message, "", token);
      if (pr.nothingToMerge) return { sha: null, alreadyMerged: true };
      if (!pr.number) return { sha: null, error: pr.error ?? "GitLab MR creation for direct merge failed" };
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const acceptResp = await fetch(
        `${apiBase}/projects/${projectPath}/merge_requests/${pr.number}/merge`,
        {
          method: "PUT",
          headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
          body: JSON.stringify({ merge_commit_message: message }),
        },
      );
      if (acceptResp.ok) {
        const data = await acceptResp.json();
        return { sha: data.merge_commit_sha ?? data.sha ?? null, prUrl: pr.url ?? undefined };
      }
      // 405/406/422 = not mergeable (conflict or checks) — the MR stays open as the resolution surface.
      if ([405, 406, 422].includes(acceptResp.status)) {
        return { sha: null, conflict: true, prUrl: pr.url ?? undefined, error: "GitLab cannot merge automatically (conflict) — resolve in the merge request left open" };
      }
      return { sha: null, prUrl: pr.url ?? undefined, error: `GitLab merge failed (HTTP ${acceptResp.status})` };
    }
    return { sha: null, error: `Unsupported provider: ${provider}` };
  } catch (err) {
    return { sha: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface CompareResult {
  // oldPath present = the file was renamed/moved; path is the NEW location. Preserving this is
  // what lets artifact bindings FOLLOW git-side moves instead of orphaning (git owns the tree;
  // artifact.path is a binding, not a derivation).
  files: Array<{ path: string; action: "added" | "modified" | "removed"; oldPath?: string; blob?: string | null }>;
  /** AD.3: `author` is the provider's login, else the commit's author name. */
  commits: Array<{ sha: string; message: string; author?: string }>;
}

/** Compare base...head on the remote. Null when the provider can't compare (e.g. force-push). */
export async function fetchCompare(
  provider: string, apiBase: string, owner: string, repo: string,
  base: string, head: string, token: string,
): Promise<CompareResult | null> {
  try {
    if (provider === "github") {
      const resp = await fetch(
        `${apiBase}/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
        { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "User-Agent": "nodespec" } },
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      const actionMap: Record<string, "added" | "modified" | "removed"> = {
        added: "added", removed: "removed", modified: "modified", changed: "modified", renamed: "modified", copied: "added",
      };
      return {
        files: (data.files ?? []).map((f: { filename: string; status: string; previous_filename?: string; sha?: string }) => ({
          path: f.filename,
          action: actionMap[f.status] ?? "modified",
          ...(f.status === "renamed" && f.previous_filename ? { oldPath: f.previous_filename } : {}),
          // AD.1: the file's blob at head (absent for a removed file).
          ...(f.status !== "removed" && typeof f.sha === "string" ? { blob: f.sha } : {}),
        })),
        commits: (data.commits ?? []).map((c: { sha: string; commit?: { message?: string; author?: { name?: string } }; author?: { login?: string } | null }) => ({
          sha: c.sha, message: c.commit?.message ?? "",
          ...((c.author?.login || c.commit?.author?.name) ? { author: c.author?.login || c.commit?.author?.name } : {}),
        })),
      };
    }
    if (provider === "gitlab") {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const resp = await fetch(
        `${apiBase}/projects/${projectPath}/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      return {
        files: (data.diffs ?? []).map((d: { new_path: string; old_path: string; new_file: boolean; deleted_file: boolean; renamed_file?: boolean }) => ({
          path: d.new_path || d.old_path,
          action: d.new_file ? "added" as const : d.deleted_file ? "removed" as const : "modified" as const,
          ...(d.renamed_file && d.old_path && d.old_path !== d.new_path ? { oldPath: d.old_path } : {}),
        })),
        commits: (data.commits ?? []).map((c: { id: string; message?: string; author_name?: string }) => ({
          sha: c.id, message: c.message ?? "",
          ...(c.author_name ? { author: c.author_name } : {}),
        })),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * V3 AD.1 (finding D11): one file's text at a ref, saying which of three
 * things happened. A guard must never read a provider outage as "the file is
 * not there": the unbaselined push guard used to pass on a failed read, and a
 * connect used to treat an unreachable model.json as a repository without one.
 *   found   the file, decoded
 *   absent  the provider answered 404
 *   failed  anything else: another status, a network error, a body we cannot read
 */
export type RepoFileRead =
  | { status: "found"; text: string }
  | { status: "absent" }
  | { status: "failed"; error: string };

export async function readRepoFile(
  provider: string, apiBase: string, owner: string, repo: string,
  path: string, ref: string, token: string,
): Promise<RepoFileRead> {
  const encoded = encodeRepoPath(path);
  if (!encoded) return { status: "failed", error: `${path} is not a path inside the repository` };
  try {
    if (provider === "github") {
      const resp = await fetch(
        `${apiBase}/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
        { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "User-Agent": "nodespec" } },
      );
      if (resp.status === 404) return { status: "absent" };
      if (!resp.ok) return { status: "failed", error: `GitHub answered HTTP ${resp.status} for ${path}` };
      const data = await resp.json();
      if (data.encoding === "base64" && typeof data.content === "string") {
        const bin = atob(data.content.replace(/\n/g, ""));
        const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
        return { status: "found", text: new TextDecoder().decode(bytes) };
      }
      return typeof data.content === "string"
        ? { status: "found", text: data.content }
        : { status: "failed", error: `GitHub returned no readable content for ${path}` };
    }
    if (provider === "gitlab") {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const resp = await fetch(
        `${apiBase}/projects/${projectPath}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (resp.status === 404) return { status: "absent" };
      if (!resp.ok) return { status: "failed", error: `GitLab answered HTTP ${resp.status} for ${path}` };
      return { status: "found", text: await resp.text() };
    }
    return { status: "failed", error: `Unsupported provider: ${provider}` };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Fetch one file's text content at a ref. Null when absent OR unreadable: for
 *  best-effort reads only. A guard reads with readRepoFile (AD.1, D11). */
export async function fetchRepoFile(
  provider: string, apiBase: string, owner: string, repo: string,
  path: string, ref: string, token: string,
): Promise<string | null> {
  const read = await readRepoFile(provider, apiBase, owner, repo, path, ref, token);
  return read.status === "found" ? read.text : null;
}

/**
 * V3 AD.1: the blob at `ref` for each path, where GitLab's compare gives none.
 * GitLab answers a HEAD on the files API with the blob id in a header. A path
 * it will not answer for is left out, and a caller reads that as foreign.
 */
export async function fetchGitLabBlobIds(
  apiBase: string, owner: string, repo: string, ref: string, paths: string[], token: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  for (const path of paths) {
    try {
      const resp = await fetch(
        `${apiBase}/projects/${projectPath}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
        { method: "HEAD", headers: { "PRIVATE-TOKEN": token } },
      );
      const blob = resp.ok ? resp.headers.get("x-gitlab-blob-id") : null;
      if (blob) out.set(path, blob);
    } catch { /* left out: read as foreign */ }
  }
  return out;
}

/**
 * V3 AD.1 (finding D8): where `head` stands relative to `base`.
 *   ahead      head descends from base: moving a baseline from base to head goes forward
 *   identical  the same commit
 *   behind     head is an ancestor of base: moving there would go backwards
 *   diverged   neither: history was rewritten (a force push)
 * Null when the provider cannot say; the baseline writer treats that as "no".
 */
export type Ancestry = "ahead" | "identical" | "behind" | "diverged";

/** V3 AD.3: the paths one commit changed (a rename counts both paths). Null
 *  when the provider cannot say, so a caller never reads "no files". */
export async function fetchCommitFiles(
  provider: string, apiBase: string, owner: string, repo: string,
  sha: string, token: string,
): Promise<string[] | null> {
  try {
    if (provider === "github") {
      const resp = await fetch(
        `${apiBase}/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`,
        { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "User-Agent": "nodespec" } },
      );
      if (!resp.ok) return null;
      const files = (await resp.json())?.files;
      if (!Array.isArray(files)) return null;
      return [...new Set(files.flatMap((f: { filename?: string; previous_filename?: string }) =>
        [f.filename, f.previous_filename].filter((x): x is string => typeof x === "string" && x !== "")))];
    }
    if (provider === "gitlab") {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const resp = await fetch(
        `${apiBase}/projects/${projectPath}/repository/commits/${encodeURIComponent(sha)}/diff?per_page=100`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (!resp.ok) return null;
      const diffs = await resp.json();
      if (!Array.isArray(diffs)) return null;
      return [...new Set(diffs.flatMap((d: { new_path?: string; old_path?: string }) =>
        [d.new_path, d.old_path].filter((x): x is string => typeof x === "string" && x !== "")))];
    }
    return null;
  } catch {
    return null;
  }
}

/** V3 AD.3a: does the repository have this commit? A short sha comes back as
 *  the full one. "absent" is the provider saying no; "failed" is not knowing. */
export type CommitLookup =
  | { status: "found"; sha: string }
  | { status: "absent" }
  | { status: "failed"; error: string };

export async function fetchCommit(
  provider: string, apiBase: string, owner: string, repo: string,
  sha: string, token: string,
): Promise<CommitLookup> {
  try {
    if (provider === "github") {
      const resp = await fetch(
        `${apiBase}/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`,
        { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "User-Agent": "nodespec" } },
      );
      // 422: "No commit found for SHA"
      if (resp.status === 404 || resp.status === 422) return { status: "absent" };
      if (!resp.ok) return { status: "failed", error: `GitHub answered HTTP ${resp.status}` };
      const full = (await resp.json())?.sha;
      return typeof full === "string" && full
        ? { status: "found", sha: full.toLowerCase() }
        : { status: "failed", error: "GitHub returned no sha" };
    }
    if (provider === "gitlab") {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const resp = await fetch(
        `${apiBase}/projects/${projectPath}/repository/commits/${encodeURIComponent(sha)}`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (resp.status === 404) return { status: "absent" };
      if (!resp.ok) return { status: "failed", error: `GitLab answered HTTP ${resp.status}` };
      const full = (await resp.json())?.id;
      return typeof full === "string" && full
        ? { status: "found", sha: full.toLowerCase() }
        : { status: "failed", error: "GitLab returned no sha" };
    }
    return { status: "failed", error: `Unsupported provider: ${provider}` };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchAncestry(
  provider: string, apiBase: string, owner: string, repo: string,
  base: string, head: string, token: string,
): Promise<Ancestry | null> {
  if (base === head) return "identical";
  try {
    if (provider === "github") {
      const resp = await fetch(
        `${apiBase}/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=1`,
        { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "User-Agent": "nodespec" } },
      );
      if (!resp.ok) return null;
      const status = (await resp.json())?.status;
      return status === "ahead" || status === "identical" || status === "behind" || status === "diverged" ? status : null;
    }
    if (provider === "gitlab") {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const resp = await fetch(
        `${apiBase}/projects/${projectPath}/repository/merge_base?refs[]=${encodeURIComponent(base)}&refs[]=${encodeURIComponent(head)}`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (!resp.ok) return null;
      const mergeBase = (await resp.json())?.id;
      if (typeof mergeBase !== "string" || mergeBase === "") return null;
      if (mergeBase === base) return "ahead";
      if (mergeBase === head) return "behind";
      return "diverged";
    }
    return null;
  } catch {
    return null;
  }
}

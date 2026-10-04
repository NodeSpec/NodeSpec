// V3 AD.1b (owner 2026-09-24): what a push may write, and which changes in
// git are NodeSpec's own.
//
// A push used to commit on the live head and write every bound file the
// canvas held (finding D1): an agent's edit still waiting on a change card was
// reverted by the next push, the automatic one after any accepted proposal
// included. It then moved the baseline to its new commit whatever lay between
// (D2), so those commits left every later range. NodeSpec also knew its own
// commits only by their message (D12): any commit starting "Update from
// NodeSpec:" was trusted, and a push whose head was NodeSpec's hid the rest.
//
// Now:
//   - every push records its commit sha, the commit it was built on, and the
//     git blob of every file it wrote, in git_sync_log (before the ref moves
//     on GitHub);
//   - a change in git is NodeSpec's own only when its sha is recorded, and a
//     file only when its blob at head is one NodeSpec wrote from that branch;
//   - a push skips every file git changed since the baseline other than by
//     NodeSpec, reference files included, and says so;
//   - the baseline moves to the push's commit only when the push was built on
//     the baseline itself; otherwise the foreign commits stay on their card.
import type { ChangedFile } from "./git-drift.ts";
import { fetchCompare, fetchGitLabBlobIds, listPullRequests, type CompareResult, type PullRequestRef } from "./git-provider.ts";
import { BINDINGS_PATH, manifestAfterBinds } from "./binding-manifest.ts";

/** git's object id for a text blob: sha1("blob <byte length>\0<bytes>"). */
export async function gitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(header.length + body.length);
  all.set(header, 0);
  all.set(body, header.length);
  const digest = await crypto.subtle.digest("SHA-1", all);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One NodeSpec push as git_sync_log records it. */
export interface NodeSpecPush {
  sha: string;
  branchId: string | null;
  /** path → blob NodeSpec wrote there */
  blobs: Record<string, string>;
  deleted: string[];
  /** AD.4 (D14): a pull request push names the work branch it went to and
   *  its pull request's number. */
  workBranch?: string;
  prNumber?: number;
}

// deno-lint-ignore no-explicit-any
function pushOf(r: any): NodeSpecPush {
  return {
    sha: r.commit_sha as string,
    branchId: (r.branch_id as string | null) ?? null,
    blobs: (r.metadata?.blobs ?? {}) as Record<string, string>,
    deleted: Array.isArray(r.metadata?.deleted) ? (r.metadata.deleted as string[]) : [],
    ...(typeof r.metadata?.workBranch === "string" ? { workBranch: r.metadata.workBranch as string } : {}),
    ...(typeof r.metadata?.prNumber === "number" ? { prNumber: r.metadata.prNumber as number } : {}),
  };
}

/** The pushes NodeSpec recorded among `shas`, any branch of the integration. */
export async function loadNodeSpecPushes(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  integrationId: string,
  shas: string[],
): Promise<NodeSpecPush[]> {
  if (shas.length === 0) return [];
  const { data } = await supabase
    .from("git_sync_log")
    .select("commit_sha, branch_id, status, metadata")
    .eq("integration_id", integrationId)
    .eq("direction", "push")
    .in("commit_sha", shas);
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[])
    .filter((r) => r?.commit_sha && r.status !== "failed" && r.metadata?.nodespecPush === true)
    .map(pushOf);
}

/** How many of the integration's latest NodeSpec pushes a merge is matched against. */
export const RECENT_PUSHES = 200;

/**
 * NodeSpec's recent pushes on the integration, every branch, newest first,
 * however their commits reached a range. A true merge keeps the pushed
 * commits, but a rebase or squash merge mints new shas, so these are matched
 * by blob, never by sha. Bench 2026-09-25: looking them up by the range's
 * shas found none after a rebase or squash, and the merged design came back
 * as a card instead of a load.
 */
export async function loadRecentPushes(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  integrationId: string,
  limit = RECENT_PUSHES,
): Promise<NodeSpecPush[]> {
  const { data } = await supabase
    .from("git_sync_log")
    .select("commit_sha, branch_id, status, metadata")
    .eq("integration_id", integrationId)
    .eq("direction", "push")
    // The table's time column is started_at (bench 2026-09-25: ordering by a
    // created_at it does not have failed the whole read, and no merge was
    // ever recognised by blob).
    .order("started_at", { ascending: false })
    .limit(limit);
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[])
    .filter((r) => r?.commit_sha && r.status !== "failed" && r.metadata?.nodespecPush === true)
    .map(pushOf);
}

/** The newest content NodeSpec pushed for each path (pushes newest first),
 *  as one push: an older push of the same path never counts. */
export function newestPerPath(pushes: NodeSpecPush[]): NodeSpecPush {
  const blobs: Record<string, string> = {};
  const deleted: string[] = [];
  const seen = new Set<string>();
  for (const p of pushes) {
    for (const [path, blob] of Object.entries(p.blobs)) {
      if (!seen.has(path)) { seen.add(path); blobs[path] = blob; }
    }
    for (const path of p.deleted) {
      if (!seen.has(path)) { seen.add(path); deleted.push(path); }
    }
  }
  return { sha: pushes[0]?.sha ?? "", branchId: pushes[0]?.branchId ?? null, blobs, deleted };
}

/**
 * AD.4 (D14): this branch's pull request pushes whose pull request merged
 * inside the range. A merge, squash or rebase of the pull request puts one of
 * the provider's merge commits in the range; only that pull request's pushes
 * count, so a revert to an older pull request's content never passes for
 * NodeSpec's writing. A provider that cannot be read names none: those files
 * stay foreign and reach a person as a card.
 */
export async function arrivedPullRequestPushes(
  candidates: NodeSpecPush[],
  inRange: Set<string>,
  merged: (workBranch: string) => Promise<PullRequestRef[] | null>,
): Promise<NodeSpecPush[]> {
  const byWorkBranch = new Map<string, NodeSpecPush[]>();
  for (const p of candidates) {
    if (!p.workBranch || typeof p.prNumber !== "number") continue;
    byWorkBranch.set(p.workBranch, [...(byWorkBranch.get(p.workBranch) ?? []), p]);
  }
  const arrived: NodeSpecPush[] = [];
  for (const [workBranch, pushes] of byWorkBranch) {
    const prs = await merged(workBranch);
    const numbers = new Set((prs ?? []).filter((pr) => pr.mergeShas.some((sha) => inRange.has(sha))).map((pr) => pr.number));
    arrived.push(...pushes.filter((p) => numbers.has(p.prNumber as number)));
  }
  return arrived;
}

/** A changed file with its blob at head, when the provider said. */
export type HeadFile = ChangedFile & { blob?: string | null };

/** Split a range's changed files into NodeSpec's own writing from this branch
 *  and everything else. A file counts as NodeSpec's only when its blob at
 *  head is one NodeSpec wrote there (or NodeSpec deleted it); anything the
 *  provider did not give a blob for counts as foreign. */
export function splitOwnChanges(files: HeadFile[], own: NodeSpecPush[]): { foreign: HeadFile[]; own: HeadFile[] } {
  const foreign: HeadFile[] = [];
  const mine: HeadFile[] = [];
  for (const f of files) {
    const isOwn = f.oldPath
      ? false
      : f.action === "removed"
        ? own.some((p) => p.deleted.includes(f.path))
        : !!f.blob && own.some((p) => p.blobs[f.path] === f.blob);
    (isOwn ? mine : foreign).push(f);
  }
  return { foreign, own: mine };
}

/**
 * AD.4 (D17): what a GitLab commit for this push changes, against the files
 * the branch held at the head the preflight read (path to blob). A file whose
 * blob is already there is left out, as GitHub's tree leaves it unchanged; a
 * deletion names only a path the branch has. Nothing to change is an
 * unchanged push, with no commit.
 */
export function gitLabChanges(args: {
  files: PlannedFile[];
  blobs: Record<string, string>;
  existing: Map<string, string>;
  stalePaths: string[];
}): { creates: PlannedFile[]; updates: PlannedFile[]; deletes: string[] } {
  const creates: PlannedFile[] = [];
  const updates: PlannedFile[] = [];
  for (const f of args.files) {
    const there = args.existing.get(f.path);
    if (there === undefined) creates.push(f);
    else if (there !== args.blobs[f.path]) updates.push(f);
  }
  const deletes = args.stalePaths.filter((p) => args.existing.has(p));
  return { creates, updates, deletes };
}

/** The GitLab commit actions: an update or delete carries the commit that
 *  last changed its file at the head the preflight read (`last_commit_id`),
 *  so GitLab refuses the whole commit if the file changed since. */
export function gitLabActions(
  changes: { creates: PlannedFile[]; updates: PlannedFile[]; deletes: string[] },
  lastCommitIds: Map<string, string>,
): Array<Record<string, string>> {
  const last = (path: string): Record<string, string> => {
    const id = lastCommitIds.get(path);
    return id ? { last_commit_id: id } : {};
  };
  return [
    ...changes.creates.map((f) => ({ action: "create", file_path: f.path, content: f.content })),
    ...changes.updates.map((f) => ({ action: "update", file_path: f.path, content: f.content, ...last(f.path) })),
    ...changes.deletes.map((path) => ({ action: "delete", file_path: path, ...last(path) })),
  ];
}

/** GitLab's refusals that mean the branch changed under the push (a file
 *  changed, appeared or went since the preflight read it). */
export function gitLabBranchMoved(status: number, message: string): boolean {
  return status === 400 && /changed since you started editing|already exists|doesn't exist|does not exist/i.test(message);
}

/** Every path a foreign change touches (a rename touches both ends). */
export function foreignPaths(foreign: HeadFile[]): Set<string> {
  const paths = new Set<string>();
  for (const f of foreign) {
    paths.add(f.path);
    if (f.oldPath) paths.add(f.oldPath);
  }
  return paths;
}

export interface PlannedFile { path: string; content: string }

export interface PushPlan {
  write: PlannedFile[];
  skipped: Array<{ path: string; reason: string }>;
  deletions: string[];
}

export const SKIP_REASON = "changed in git since the last sync; review its change card, then push again";

/** Pure: which files a push writes and deletes. A file git changed since the
 *  baseline other than by NodeSpec is never written or deleted, reference
 *  files included (a hand edit to spec.json or a ticked task doc stays in git
 *  until a person acts on its card). */
export function planPush(args: {
  files: PlannedFile[];
  stalePaths: string[];
  foreign: Set<string>;
  /** Files the push derived from git's own content at the head it builds on
   *  (the bindings manifest, minus the declarations the canvas bound): they
   *  keep what git changed, so they are written even though git changed them. */
  mergedAtHead?: Set<string>;
}): PushPlan {
  const write: PlannedFile[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const f of args.files) {
    if (args.foreign.has(f.path) && !args.mergedAtHead?.has(f.path)) skipped.push({ path: f.path, reason: SKIP_REASON });
    else write.push(f);
  }
  const deletions: string[] = [];
  for (const p of args.stalePaths) {
    if (args.foreign.has(p)) skipped.push({ path: p, reason: SKIP_REASON });
    else deletions.push(p);
  }
  return { write, skipped, deletions };
}

/**
 * One attempt of the push preflight: the plan for the head this attempt
 * builds on. The bindings manifest is read at that same head, never at a
 * second read of the ref (bench 2026-09-28: the manifest was read at a head
 * taken before the loop while the commit was built on a later one, so an
 * author's cleaned manifest was read as its older flagged body, skipped as
 * "changed in git", and a consumed declaration never left the file). Read at
 * the head, the rewrite keeps everything git changed and is written although
 * git changed it. A failed read leaves the manifest alone and never fails a
 * push.
 */
export async function planAttempt(args: {
  files: PlannedFile[];
  stalePaths: string[];
  foreign: Set<string>;
  /** The head this attempt builds on; null when the branch has none yet. */
  head: string | null;
  /** The tracked ref, read by name only when there is no head. */
  ref: string;
  boundPaths: ReadonlySet<string>;
  readManifest: (at: string) => Promise<string | null>;
}): Promise<PushPlan> {
  let manifest: string | null = null;
  try {
    manifest = manifestAfterBinds(await args.readManifest(args.head ?? args.ref), args.boundPaths);
  } catch (err) {
    console.warn("[git-push] bindings cleanup skipped (push continues):", err);
  }
  return planPush({
    files: manifest === null ? args.files : [...args.files, { path: BINDINGS_PATH, content: manifest }],
    stalePaths: args.stalePaths,
    foreign: args.foreign,
    mergedAtHead: manifest !== null && args.head ? new Set([BINDINGS_PATH]) : undefined,
  });
}

/** Pure: where the baseline goes after a push. Only a push built on the
 *  baseline itself may move it; otherwise commits NodeSpec did not write lie
 *  between, and they stay on their card. */
export function baselineAfterPush(args: {
  baseline: string | null;
  parent: string | null;
  newSha: string;
  unchanged: boolean;
}): { move: boolean; reason: "first" | "built-on-baseline" | "same" | "foreign-commits-between" } {
  if (!args.baseline) return { move: true, reason: "first" };
  if (args.unchanged) return { move: false, reason: args.parent === args.baseline ? "same" : "foreign-commits-between" };
  if (args.parent === args.baseline) return { move: true, reason: "built-on-baseline" };
  return { move: false, reason: "foreign-commits-between" };
}


/**
 * The range base..head as the sync check and the push preflight both read it:
 * the provider's compare, the pushes NodeSpec recorded in it (any branch), and
 * the changed files split into NodeSpec's own writing from this branch and
 * everything else. `ok: false` when the provider cannot compare (a rewritten
 * history, an outage): the caller treats every file as unknown.
 */
export async function readRange(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    provider: string; apiBase: string; owner: string; repo: string; token: string;
    integrationId: string; branchId: string; base: string; head: string;
    /** The ref the range was read on. AD.4: with it, this branch's pull
     *  requests merged in the range bring their pushes' content. */
    ref?: string;
    /** Test seam: the merged pull requests of a work branch into `ref`. */
    mergedPullRequests?: (workBranch: string) => Promise<PullRequestRef[] | null>;
  },
): Promise<
  | {
    ok: true;
    compare: CompareResult;
    /** Changed files NodeSpec did not write from this branch. */
    foreign: HeadFile[];
    own: HeadFile[];
    /** Changed files NodeSpec did not write from any branch. Empty while
     *  `foreign` is not: NodeSpec's writing from another branch arrived (a
     *  merge, squash or rebase changes shas but never blobs). */
    foreignAnyBranch: HeadFile[];
    recorded: Set<string>;
  }
  | { ok: false }
> {
  const compare = await fetchCompare(args.provider, args.apiBase, args.owner, args.repo, args.base, args.head, args.token);
  if (!compare) return { ok: false };
  const pushes = await loadNodeSpecPushes(supabase, args.integrationId, compare.commits.map((c) => c.sha));
  const recent = await loadRecentPushes(supabase, args.integrationId);
  const others = recent.filter((p) => p.branchId !== args.branchId);
  // AD.4 (D14): a pull request of this branch that merged in the range brings
  // its pushes' content, newest per path, whatever the merge did to the shas.
  const inRange = new Set([...compare.commits.map((c) => c.sha), args.head]);
  const ref = args.ref;
  const arrived = ref
    ? await arrivedPullRequestPushes(
      recent.filter((p) => p.branchId === args.branchId),
      inRange,
      args.mergedPullRequests ?? ((workBranch) => listPullRequests(args.provider, args.apiBase, args.owner, args.repo, workBranch, ref, args.token, "merged")),
    )
    : [];
  const pullRequestWriting = arrived.length > 0 ? [newestPerPath(arrived)] : [];
  const mine = [...pushes.filter((p) => p.branchId === args.branchId), ...pullRequestWriting];
  const anyBranchPushes = [...pushes, ...others.filter((o) => !pushes.some((p) => p.sha === o.sha)), ...pullRequestWriting];
  let files: HeadFile[] = compare.files;
  if (args.provider === "gitlab" && anyBranchPushes.length > 0) {
    const candidates = files
      .filter((f) => f.action !== "removed" && anyBranchPushes.some((p) => p.blobs[f.path] !== undefined))
      .map((f) => f.path);
    if (candidates.length > 0) {
      const blobs = await fetchGitLabBlobIds(args.apiBase, args.owner, args.repo, args.head, candidates, args.token);
      files = files.map((f) => (blobs.has(f.path) ? { ...f, blob: blobs.get(f.path) } : f));
    }
  }
  const split = splitOwnChanges(files, mine);
  const anyBranch = splitOwnChanges(files, anyBranchPushes);
  return {
    ok: true, compare, foreign: split.foreign, own: split.own,
    foreignAnyBranch: anyBranch.foreign, recorded: new Set(pushes.map((p) => p.sha)),
  };
}

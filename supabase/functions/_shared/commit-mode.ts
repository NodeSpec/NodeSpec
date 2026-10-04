// UX-1.1b (owner spec 2026-08-21): commit mode for NodeSpec pushes: direct
// commit (the default) or a pull request opened from a nodespec/push-* work
// branch. Pure helpers so the decision and the branch naming are testable
// offline.
//
// V3 AD.4 (finding D14, ruling 6): one work branch per tracked ref and one
// open pull request on it. Each push used to cut a new work branch and open a
// new pull request. Now a push adds a commit to the open pull request, and
// with none open the work branch starts again at the tracked branch's head.
// A pull request push does not move branches.last_synced_commit (the tracked
// branch has not moved); the sync check recognises the merge by the blobs
// NodeSpec recorded for that pull request's pushes, whatever the merge did to
// the shas, so a squash title needs no prefix.

export const COMMIT_MODES = ["direct", "pull-request"] as const;
export type CommitMode = (typeof COMMIT_MODES)[number];

/** Only an explicit 'pull-request' opts in — absent/unknown reads as direct,
 *  so pre-migration rows and forks behave exactly as before. */
export function resolveCommitMode(row: { commit_mode?: string | null } | null | undefined): CommitMode {
  return row?.commit_mode === "pull-request" ? "pull-request" : "direct";
}

/** Every PR-mode work branch starts with this. AD.4 (D16): such a branch is a
 *  pull request's source, never a branch a project tracks, so it is not
 *  offered at connect and is refused at save. */
export const WORK_BRANCH_PREFIX = "nodespec/push-";

export function isWorkBranch(ref: string | null | undefined): boolean {
  return typeof ref === "string" && ref.startsWith(WORK_BRANCH_PREFIX);
}

/** The work branch for pull requests into `targetRef`: recognizably
 *  NodeSpec's, one per tracked ref (AD.4), sanitized for a git ref name. */
export function workBranchName(targetRef: string): string {
  const safe = targetRef.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "branch";
  return `${WORK_BRANCH_PREFIX}${safe}`;
}

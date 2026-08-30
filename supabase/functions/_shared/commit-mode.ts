// UX-1.1b (owner spec 2026-08-21): commit mode for NodeSpec pushes — direct
// commit (the default, today's behavior) or a pull request opened from a
// nodespec/push-* work branch. Pure helpers so the decision and the branch
// naming are testable offline.
//
// WHY THE PR LANE IS SAFE ON EXISTING RAILS: the work-branch push carries the
// SELF_PUSH_PREFIX commit message, so the webhook's self-push guard skips it
// (no drift card against our own commit); and when the PR merges, the target
// branch's webhook event lands in the EXISTING merge-arrival lane, which
// fast-forwards the baseline. That is also why a PR-mode push must NOT
// advance branches.last_synced_commit — the target has not moved yet.

export const COMMIT_MODES = ["direct", "pull-request"] as const;
export type CommitMode = (typeof COMMIT_MODES)[number];

/** Only an explicit 'pull-request' opts in — absent/unknown reads as direct,
 *  so pre-migration rows and forks behave exactly as before. */
export function resolveCommitMode(row: { commit_mode?: string | null } | null | undefined): CommitMode {
  return row?.commit_mode === "pull-request" ? "pull-request" : "direct";
}

/** Work-branch name for a PR-mode push: recognizably NodeSpec's, scoped to
 *  the target ref, unique per push. */
export function workBranchName(targetRef: string, seed?: string): string {
  const stamp = (seed ?? Date.now().toString(36)).replace(/[^a-z0-9]/gi, "").slice(0, 12) || "x";
  const safe = targetRef.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "branch";
  return `nodespec/push-${safe}-${stamp}`;
}

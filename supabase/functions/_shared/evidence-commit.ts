// V3 AD.3a (owner 2026-09-24, finding D18): evidence names a commit the
// repository has. report_test_results used to check only that a sha looked
// like hex, so a test result could claim any commit, real or not, and flip a
// criterion on the strength of it.
//
// Now a result that names a commit is checked before anything is recorded:
//   - the repository does not have the commit: refused, nothing recorded;
//   - the check could not be made: refused, nothing recorded (not knowing is
//     not "absent", and it is not "present" either); report again;
//   - the commit is on the tracked branch (the primary branch's ref, the one
//     the sync check reads): the result counts now, as before;
//   - the commit exists but is not on the tracked branch yet (an agent's
//     working branch, a pull request not merged): the result is HELD. It is
//     stored on its test case (`metadata.held`) and flips nothing; the sync
//     check of the tracked branch releases it once the commit is there.
// A project with no repository connected has nothing to check against, and a
// result that names no commit claims none: both count as before.

import { decryptWithUpgrade, isEncrypted } from "./crypto.ts";
import { providerApiBase, fetchRemoteHeadShaDetailed, fetchAncestry, fetchCommit, type Ancestry } from "./git-provider.ts";
import { getPrimaryBranch } from "./primary-branch.ts";

export type EvidenceCommit =
  | { state: "no-repository" }
  | { state: "unknown"; repo: string }
  | { state: "failed"; repo: string; error: string }
  | { state: "counts"; sha: string; ref: string }
  | { state: "held"; sha: string; ref: string };

/** What a result held for its commit carries on its test case. */
export interface HeldEvidence {
  status: "passed" | "failed";
  commitSha: string;
  /** The tracked ref the commit has to reach. */
  ref: string;
  branch?: string;
  framework?: string;
  at: string;
}

/** Pure: a found commit counts once the tracked branch's head is it or
 *  descends from it. Anything else, including "cannot say", waits. */
export function evidenceStanding(ancestry: Ancestry | null): "counts" | "held" {
  return ancestry === "ahead" || ancestry === "identical" ? "counts" : "held";
}

export function heldOf(metadata: unknown): HeldEvidence | null {
  const held = (metadata as { held?: HeldEvidence } | null)?.held;
  return held && typeof held.commitSha === "string" && (held.status === "passed" || held.status === "failed") ? held : null;
}

// deno-lint-ignore no-explicit-any
export async function checkEvidenceCommit(supabase: any, projectId: string, sha: string): Promise<EvidenceCommit> {
  const { data: integration } = await supabase
    .from("git_integrations")
    .select("provider, repo_owner, repo_name, default_branch, base_url, access_token_encrypted")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!integration) return { state: "no-repository" };
  const repo = `${integration.repo_owner}/${integration.repo_name}`;

  let token: string = integration.access_token_encrypted ?? "";
  try {
    if (isEncrypted(token)) token = (await decryptWithUpgrade(token)).plaintext;
  } catch (err) {
    return { state: "failed", repo, error: `the stored token could not be read (${err instanceof Error ? err.message : String(err)})` };
  }
  token = token.trim();
  const apiBase = providerApiBase(integration.provider, integration.base_url);

  const commit = await fetchCommit(integration.provider, apiBase, integration.repo_owner, integration.repo_name, sha, token);
  if (commit.status === "absent") return { state: "unknown", repo };
  if (commit.status === "failed") return { state: "failed", repo, error: commit.error };

  const primary = await getPrimaryBranch(supabase, projectId, "id, name, git_ref, is_primary");
  const ref: string = primary?.git_ref || integration.default_branch;
  const head = await fetchRemoteHeadShaDetailed(integration.provider, apiBase, integration.repo_owner, integration.repo_name, ref, token);
  if (!head.sha) return { state: "held", sha: commit.sha, ref };
  const ancestry = head.sha === commit.sha
    ? "identical"
    : await fetchAncestry(integration.provider, apiBase, integration.repo_owner, integration.repo_name, commit.sha, head.sha, token);
  return { state: evidenceStanding(ancestry), sha: commit.sha, ref };
}

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

/**
 * The sync check of the tracked branch: every result held for a commit the
 * head now is or descends from counts. Its status is written (the met-flip
 * trigger fires, as for any report) and its criteria take the same explicit
 * operations a report makes: met, the stale mark cleared, test provenance
 * with the commit. Written only while the case is as it was read: a newer
 * report replaces a held result, and is never overwritten by it.
 */
export async function releaseHeldEvidence(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: { projectId: string; headSha: string; ancestry: (base: string, head: string) => Promise<Ancestry | null>; nowIso?: string },
): Promise<{ released: number; waiting: number }> {
  const { data: spec } = await supabase
    .from("project_specifications")
    .select("id")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!spec) return { released: 0, waiting: 0 };
  const { data: reqRows } = await supabase
    .from("specification_requirements")
    .select("id, acceptance_criteria")
    .eq("specification_id", spec.id);
  const requirements = new Map(((reqRows ?? []) as AnyRecord[]).map((r) => [String(r.id), r]));
  if (requirements.size === 0) return { released: 0, waiting: 0 };
  const { data: caseRows } = await supabase
    .from("test_cases")
    .select("id, requirement_id, metadata, updated_at")
    .in("requirement_id", [...requirements.keys()]);
  const held = ((caseRows ?? []) as AnyRecord[])
    .map((row) => ({ row, held: heldOf(row.metadata) }))
    .filter((c): c is { row: AnyRecord; held: HeldEvidence } => c.held !== null);
  if (held.length === 0) return { released: 0, waiting: 0 };

  const now = args.nowIso ?? new Date().toISOString();
  const standing = new Map<string, "counts" | "held">();
  let released = 0;
  let waiting = 0;
  for (const { row, held: h } of held) {
    if (!standing.has(h.commitSha)) {
      const ancestry = h.commitSha === args.headSha ? "identical" : await args.ancestry(h.commitSha, args.headSha);
      standing.set(h.commitSha, evidenceStanding(ancestry));
    }
    if (standing.get(h.commitSha) !== "counts") { waiting++; continue; }

    const { held: _released, ...rest } = (row.metadata ?? {}) as AnyRecord;
    const { data: moved } = await supabase
      .from("test_cases")
      .update({ status: h.status, stale: false, staleness_reason: null, metadata: rest, updated_at: now })
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .select("id");
    if (!Array.isArray(moved) || moved.length === 0) continue;
    released++;

    const criteria = (Array.isArray(requirements.get(String(row.requirement_id))?.acceptance_criteria)
      ? requirements.get(String(row.requirement_id))!.acceptance_criteria as unknown[]
      : []).filter((c): c is AnyRecord => !!c && typeof c === "object");
    const bound = criteria.filter((c) => c.testId === row.id);
    if (bound.length === 0) continue;
    const intended = h.status === "passed";
    const ops: AnyRecord[] = [{ op: "set_met", test_id: row.id, value: intended }];
    if (bound.some((c) => c.evidenceStale)) ops.push({ op: "clear_stale", test_id: row.id });
    if (bound.some((c) => c.met !== intended)) {
      ops.push({
        op: "stamp",
        test_id: row.id,
        value: {
          source: "test", testCaseId: row.id, ...(h.framework ? { framework: h.framework } : {}), at: now,
          commitSha: h.commitSha, ...(h.branch ? { branch: h.branch } : {}), heldSince: h.at,
        },
      });
    }
    await supabase.rpc("apply_criteria_ops", { p_requirement_id: row.requirement_id, p_ops: ops });
  }
  return { released, waiting };
}

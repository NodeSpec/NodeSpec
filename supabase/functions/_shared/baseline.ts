// V3 AD.1 (owner 2026-09-24): the one baseline writer.
//
// A branch's baseline (branches.last_synced_commit) is NodeSpec's claim about
// git: the last commit on the bound ref whose content the canvas has
// reconciled. Everything after it reaches a person as a card. The rule the
// whole integration rests on: nothing may advance a baseline past content the
// canvas has not seen. Nine places used to write it directly, each with its
// own idea of when that was safe; a card resolve could move it backwards
// (finding D8) and a connect re-save could jump it forward (D10).
//
// Every baseline change now comes through here, and here it only ever moves
// forward:
//   - to a commit the provider reports as descending from the current
//     baseline (a first baseline is set freely);
//   - never backwards, and never across rewritten history, unless a person
//     explicitly loads the repository's model (reanchor), which is the one way
//     back from a force push;
//   - never when the provider cannot say (fail closed);
//   - only if the baseline is still the one this call read, so two writers
//     never interleave.
// The one other write is save-git-integration clearing it to null when the
// integration is bound to a different repository: a sha from another
// repository means nothing.
import { decryptWithUpgrade, isEncrypted } from "./crypto.ts";
import { providerApiBase, fetchAncestry, type Ancestry } from "./git-provider.ts";

export type AncestryFn = (base: string, head: string) => Promise<Ancestry | null>;

export function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value);
}

export type BaselineDecision =
  | { move: true; outcome: "first" | "forward" | "reanchored" }
  | { move: false; outcome: "same" | "behind" | "diverged" | "unknown" | "invalid" };

/** Pure: may the baseline go from `current` to `to`? */
export function decideBaselineMove(args: {
  current: string | null;
  to: string;
  ancestry: Ancestry | null;
  /** A person loaded the repository's model at `to`: the one way across a
   *  rewritten or rewound history. Never for an automatic lane. */
  reanchor?: boolean;
}): BaselineDecision {
  const { current, to, ancestry, reanchor } = args;
  if (!isCommitSha(to)) return { move: false, outcome: "invalid" };
  if (!current) return { move: true, outcome: "first" };
  if (current === to) return { move: false, outcome: "same" };
  switch (ancestry) {
    case "ahead": return { move: true, outcome: "forward" };
    case "identical": return { move: false, outcome: "same" };
    case "behind": return reanchor ? { move: true, outcome: "reanchored" } : { move: false, outcome: "behind" };
    case "diverged": return reanchor ? { move: true, outcome: "reanchored" } : { move: false, outcome: "diverged" };
    default: return { move: false, outcome: "unknown" };
  }
}

export type BaselineOutcome = BaselineDecision["outcome"] | "raced" | "no-branch";

export interface BaselinePlan {
  branchId: string;
  current: string | null;
  to: string;
  decision: BaselineDecision;
}

/** Read the branch and decide, without writing. Callers that must refuse
 *  their own write when the baseline cannot move (a card resolve on an
 *  unanswerable provider) plan first and write after. */
export async function planBaselineMove(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: { branchId: string; to: string; ancestry: AncestryFn; reanchor?: boolean },
): Promise<BaselinePlan | null> {
  const { data: branch } = await supabase
    .from("branches")
    .select("id, last_synced_commit")
    .eq("id", args.branchId)
    .maybeSingle();
  if (!branch) return null;
  const current: string | null = branch.last_synced_commit ?? null;
  const needsAncestry = !!current && current !== args.to && isCommitSha(args.to);
  const ancestry = needsAncestry ? await args.ancestry(current as string, args.to) : null;
  return {
    branchId: args.branchId,
    current,
    to: args.to,
    decision: decideBaselineMove({ current, to: args.to, ancestry, reanchor: args.reanchor }),
  };
}

/** Write a planned move, only if the baseline is still the one the plan read. */
export async function writeBaselineMove(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  plan: BaselinePlan,
  extra?: Record<string, unknown>,
): Promise<{ moved: boolean; outcome: BaselineOutcome; from: string | null }> {
  if (!plan.decision.move) return { moved: false, outcome: plan.decision.outcome, from: plan.current };
  let query = supabase
    .from("branches")
    .update({ ...(extra ?? {}), last_synced_commit: plan.to })
    .eq("id", plan.branchId);
  query = plan.current === null
    ? query.is("last_synced_commit", null)
    : query.eq("last_synced_commit", plan.current);
  const { data, error } = await query.select("id");
  if (error || !Array.isArray(data) || data.length === 0) {
    return { moved: false, outcome: "raced", from: plan.current };
  }
  return { moved: true, outcome: plan.decision.outcome, from: plan.current };
}

/** Plan and write in one call. */
export async function advanceBaseline(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: { branchId: string; to: string; ancestry: AncestryFn; reanchor?: boolean; extra?: Record<string, unknown> },
): Promise<{ moved: boolean; outcome: BaselineOutcome; from: string | null }> {
  const plan = await planBaselineMove(supabase, args);
  if (!plan) return { moved: false, outcome: "no-branch", from: null };
  return await writeBaselineMove(supabase, plan, args.extra);
}

/** The ancestry check against one repository. */
export function ancestryFor(provider: string, apiBase: string, owner: string, repo: string, token: string): AncestryFn {
  return (base, head) => fetchAncestry(provider, apiBase, owner, repo, base, head, token);
}

/** The ancestry check for a project's integration (decrypts its token). With
 *  no integration or an unreadable token, every answer is "cannot say", so no
 *  baseline moves except a first one. */
// deno-lint-ignore no-explicit-any
export async function projectAncestry(supabase: any, projectId: string): Promise<AncestryFn> {
  const { data: integration } = await supabase
    .from("git_integrations")
    .select("provider, repo_owner, repo_name, base_url, access_token_encrypted")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!integration?.access_token_encrypted) return async () => null;
  let token: string = integration.access_token_encrypted;
  try {
    if (isEncrypted(token)) token = (await decryptWithUpgrade(token)).plaintext;
  } catch {
    return async () => null;
  }
  return ancestryFor(
    integration.provider,
    providerApiBase(integration.provider, integration.base_url),
    integration.repo_owner,
    integration.repo_name,
    token.trim(),
  );
}

/** What a move that did not happen means, in the person's words. */
export function baselineOutcomeNote(outcome: BaselineOutcome): string | null {
  switch (outcome) {
    case "behind": return "The last sync is already past this commit, so it stayed where it was.";
    case "diverged": return "The repository's history was rewritten since the last sync. Load the repository's model to sync from its current head.";
    case "unknown": return "The git provider could not confirm this commit follows the last sync, so nothing moved. Try again.";
    case "raced": return "The last sync moved while this ran, so it was left as it is; the next check picks up anything still unreviewed.";
    case "invalid": return "The commit is not a valid sha, so the last sync did not move.";
    case "no-branch": return "The branch was not found, so the last sync did not move.";
    default: return null;
  }
}

// V3 P2 (task 2.4): resolve_proposal — the server accept/reject lane for
// SPEC-PLANE proposals (the level-1 route's other half; P8's approvals UI
// rides the same semantics). Graph proposals keep their shipped lane: the
// app canvas is where patches are reviewed against the model — this tool
// refuses them by plane, never applies them.
//
// Doctrine (R6/R7): a proposal containing a NEVER_AUTO_APPLY op (promote,
// settle) is acceptable ONLY by the human — and the channel decides who
// that is: the app's session JWT is the human act; an API key or OAuth
// token is a delegate, which could otherwise approve what it proposed.
// Those proposals wait for the app's approvals queue (P8), which resolves
// them through this same handler under the signed-in user's JWT, and the
// derivation records the proposal as its origin.
//
// Accept applies each patch through applySpecPatch (the same lane the
// level-2 route uses), sequentially. Application is NOT transactional
// across patches: a mid-batch refusal leaves the proposal 'partial' with
// per-patch statuses — honest state, never a silent half-merge reported
// as success.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, canApprove, approvalRefusal } from "../shared.ts";
import { patchKindOf, NEVER_AUTO_APPLY, SpecPatchOperationSchema, type SpecPatchOperation } from "../../_shared/spec-patch-schema.ts";
import { applySpecPatch, preflightSpecBatch, type DerivationOrigin } from "./spec-patch-apply.ts";
import { releaseHoldsForProposal } from "./checkouts.ts";

export type ProposalRow = {
  id: string;
  status: string;
  source_branch_id: string;
  patches: Array<{ patch: { type?: string }; explanation?: string; status?: string }>;
  metadata: Record<string, unknown> | null;
};

/** 8.1: the audit names the channel — the app's queue (a session) or MCP (a delegate). */
function resolvedBy(auth: AuthResult): "app" | "mcp" {
  return auth.authMethod === "jwt" ? "app" : "mcp";
}

export async function handleResolveProposal(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; proposal_id: string; action: string; note?: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, "write")) {
    return { success: false, error: "Insufficient permissions: write scope required" };
  }
  if (args.action !== "accept" && args.action !== "reject") {
    return { success: false, error: `Unknown action "${args.action}". Valid: accept, reject.` };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ("error" in resolved) return resolved.error;
  const projectId = resolved.project.id;
  // 7.0: deciding is the owner's on any channel and a maintainer's in person;
  // a contributor's or viewer's seat — or a member's agent — never settles.
  if (!canApprove(resolved.project.role, auth.authMethod)) {
    return { success: false, error: approvalRefusal("Resolving a proposal", resolved.project.name, resolved.project.role, auth.authMethod) };
  }

  const { data: proposal, error: readErr } = await supabase
    .from("ai_proposals")
    .select("id, status, source_branch_id, patches, metadata")
    .eq("id", args.proposal_id)
    .maybeSingle();
  if (readErr) return { success: false, error: `Could not read the proposal: ${readErr.message}` };
  if (!proposal) return { success: false, error: "Proposal not found." };
  const row = proposal as ProposalRow;

  // Ownership: the proposal's branch must belong to this project.
  const { data: branch } = await supabase
    .from("branches")
    .select("id, project_id")
    .eq("id", row.source_branch_id)
    .maybeSingle();
  if (!branch || (branch as { project_id: string }).project_id !== projectId) {
    return { success: false, error: "Proposal does not belong to this project." };
  }

  const entries = Array.isArray(row.patches) ? row.patches : [];
  // AL.12 (owner 2026-10-02: proposals "hanging" that cannot be cleared): a
  // partial proposal closes by reject. What applied stays applied; nothing
  // else about it resolves, and an accept says so.
  const appliedCount = entries.filter((e) => e?.status === "accepted").length;
  if (row.status === "partial" && args.action === "accept") {
    return { success: false, error: `Proposal is partial: ${appliedCount} of ${entries.length} patch(es) applied and stay applied; the rest were refused. Reject it to close it, then re-propose what is left.` };
  }
  if (row.status !== "pending" && row.status !== "partial") {
    return { success: false, error: `Proposal is ${row.status}; only pending proposals resolve. The settled outcome is the answer.` };
  }
  if (entries.length === 0) return { success: false, error: "Proposal carries no patches." };

  const types = entries.map((e) => String(e?.patch?.type ?? ""));

  if (args.action === "reject") {
    const now = new Date().toISOString();
    if (row.status === "partial") {
      // the close. No claim: an accept refuses a partial, so nothing else
      // decides it; the write lands only while it is still partial.
      const { data: closed, error } = await supabase
        .from("ai_proposals")
        .update({
          status: "rejected",
          reviewed_at: now,
          patches: entries.map((e) => (e?.status === "accepted" ? e : { ...e, status: "rejected" })),
          metadata: {
            ...(row.metadata ?? {}), resolvedBy: resolvedBy(auth), closedAfterPartial: true,
            resolveNote: args.note ?? `Closed after a partial apply: ${appliedCount} of ${entries.length} patch(es) applied and stay; the rest were not applied.`,
          },
        })
        .eq("id", row.id)
        .eq("status", "partial")
        .select("id");
      if (error) return { success: false, error: `Close failed: ${error.message}` };
      if (Array.isArray(closed) && closed.length === 0) return { success: false, error: "This proposal was already closed." };
      const holdsReleased = await releaseHoldsForProposal(supabase, row.id);
      return { success: true, data: { proposalId: row.id, status: "rejected", closedAfterPartial: true, applied: appliedCount, ...(holdsReleased > 0 ? { holdsReleased } : {}) } };
    }
    // AL.8: never under an accept that holds it
    const claim = await claimProposal(supabase, row.id, now);
    if (claim !== "claimed") return { success: false, error: claim === "busy" ? BEING_DECIDED : "Could not take the proposal to decide it." };
    const { data: rejected, error } = await supabase
      .from("ai_proposals")
      .update({
        status: "rejected",
        reviewed_at: now,
        patches: entries.map((e) => ({ ...e, status: "rejected" })),
        metadata: { ...(row.metadata ?? {}), resolvedBy: resolvedBy(auth), resolveNote: args.note ?? null },
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (error) return { success: false, error: `Reject failed: ${error.message}` };
    if (Array.isArray(rejected) && rejected.length === 0) return { success: false, error: BEING_DECIDED };
    // 4b.3: the drafting holds bound to this proposal end as 'resolved'.
    const holdsReleased = await releaseHoldsForProposal(supabase, row.id);
    return { success: true, data: { proposalId: row.id, status: "rejected", ...(holdsReleased > 0 ? { holdsReleased } : {}) } };
  }

  // accept. AL.12: the plane gate is for accepting only; a reject above
  // never needs the canvas, so a batch filed on both planes can be cleared.
  const graphOps = types.filter((t) => patchKindOf(t) === "patch");
  if (graphOps.length > 0) {
    return {
      success: false,
      error: `This proposal carries graph patches (${[...new Set(graphOps)].join(", ")}): graph proposals are reviewed and accepted in the app canvas, never through resolve_proposal.`,
    };
  }
  const humanOnly = types.filter((t) => NEVER_AUTO_APPLY.has(t));
  if (humanOnly.length > 0 && auth.authMethod !== "jwt") {
    return {
      success: false,
      error: `This proposal contains ${[...new Set(humanOnly)].join(", ")}: ${humanOnly.every((t) => t.endsWith("_constraint")) ? "a waiver, a changed check or a retired constraint is the person's decision" : "promotion is a human act"}, and an MCP key cannot approve what it proposed. ` +
        `The user accepts it in the app's approvals queue.`,
    };
  }
  // R6 for Team: proposer ≠ approver — a maintainer may not accept a
  // promotion their own agent filed. The owner's approval of their own
  // agent's proposal is the Individual flow and stays.
  const meta = row.metadata ?? {};
  if (humanOnly.length > 0 && resolved.project.role !== "owner" && typeof meta.proposedByUserId === "string" && meta.proposedByUserId === auth.userId) {
    return {
      success: false,
      error: `This promotion was proposed by your own agent — proposer and approver must differ (R6). Another maintainer or the project owner accepts it.`,
    };
  }
  return acceptSpecBatch(supabase, auth, projectId, row, { by: resolvedBy(auth), note: args.note ?? null });
}

/** A claim older than this is a decider that died mid-accept: it lapses. */
const CLAIM_LAPSES_MS = 5 * 60_000;
const BEING_DECIDED = "This proposal is being decided right now (another accept or reject is in progress). Read it again with get_proposal_status.";

/** AL.8: take a pending proposal to decide it, as a compare-and-set on its
 *  reviewed_at (set only while it is unclaimed, or its claim has lapsed).
 *  A database answers the rows it changed: none means another decider holds it. */
async function claimProposal(supabase: SupabaseClient, id: string, at: string): Promise<"claimed" | "busy" | "failed"> {
  const take = (current: string | null) => {
    const q = supabase.from("ai_proposals").update({ reviewed_at: at }).eq("id", id).eq("status", "pending");
    return (current === null ? q.is("reviewed_at", null) : q.eq("reviewed_at", current)).select("id");
  };
  const first = await take(null);
  if (first.error) return "failed";
  if (!(Array.isArray(first.data) && first.data.length === 0)) return "claimed";
  const { data: cur } = await supabase.from("ai_proposals").select("status, reviewed_at").eq("id", id).maybeSingle();
  const held = (cur as { status?: string; reviewed_at?: string | null } | null)?.reviewed_at ?? null;
  if ((cur as { status?: string } | null)?.status !== "pending" || !held || Date.parse(held) > Date.now() - CLAIM_LAPSES_MS) return "busy";
  const again = await take(held);
  if (again.error) return "failed";
  return Array.isArray(again.data) && again.data.length === 0 ? "busy" : "claimed";
}

/** AL.6/AL.8: accept a pending spec proposal: the one routine behind
 *  resolve_proposal and an Auto lane applying a batch at filing.
 *
 *  1. Claim it: one decider at a time. The row's reviewed_at is set only
 *     while it is still pending and unclaimed, so a second accept (or a
 *     reject) arriving meanwhile is refused instead of applying it twice.
 *  2. Check the whole batch against the rows as they are now
 *     (preflightSpecBatch): a batch another agent overtook applies nothing
 *     and stays pending (or, at filing under Auto, is set aside with the
 *     reason), never half.
 *  3. Apply in order; a refusal only the apply can see still leaves
 *     'partial' with per-patch statuses, as before. */
export async function acceptSpecBatch(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  row: ProposalRow,
  opts: { by: "app" | "mcp" | "auto"; note: string | null },
): Promise<MCPResponse> {
  const entries = Array.isArray(row.patches) ? row.patches : [];
  const types = entries.map((e) => String(e?.patch?.type ?? ""));
  const meta = row.metadata ?? {};
  // The proposal's own origin rides into every derivation it creates.
  const origin: DerivationOrigin = {
    proposedByKind: meta.authMethod === "jwt" ? "human" : "agent",
    proposedById: (typeof meta.apiKeyId === "string" && meta.apiKeyId) ? meta.apiKeyId
      : (typeof meta.externalAgent === "string" && meta.externalAgent) ? meta.externalAgent : null,
    viaProposalId: row.id,
    // AL.7: an outcome this proposal files names the agent that filed it.
    credential: typeof meta.credential === "string" && meta.credential ? meta.credential
      : (typeof meta.apiKeyId === "string" && meta.apiKeyId) ? `key:${meta.apiKeyId}` : null,
    agent: typeof meta.externalAgent === "string" && meta.externalAgent ? meta.externalAgent : null,
  };

  const parsed: SpecPatchOperation[] = [];
  for (let i = 0; i < entries.length; i++) {
    const p = SpecPatchOperationSchema.safeParse(entries[i].patch);
    if (!p.success) return { success: false, error: `Patch ${i + 1} ("${types[i] || "(unknown)"}") no longer parses; nothing was applied.` };
    parsed.push(p.data);
  }

  // 1. the claim
  const claimedAt = new Date().toISOString();
  const claim = await claimProposal(supabase, row.id, claimedAt);
  if (claim !== "claimed") {
    return { success: false, error: claim === "busy" ? BEING_DECIDED : "Could not take the proposal to decide it." };
  }
  const release = async () => {
    await supabase.from("ai_proposals").update({ reviewed_at: null }).eq("id", row.id).eq("status", "pending").eq("reviewed_at", claimedAt);
  };

  // 2. the whole batch against the rows as they are now
  const stale = await preflightSpecBatch(supabase, projectId, parsed);
  if (stale) {
    const reason = `Patch ${stale.index + 1} ("${stale.type}") would be refused: ${stale.error}`;
    if (opts.by === "auto") {
      // Under Auto nothing waits: the batch is set aside with the reason, and the agent re-reads and files again.
      await supabase.from("ai_proposals").update({
        status: "rejected", reviewed_at: claimedAt,
        patches: entries.map((e) => ({ ...e, status: "rejected" })),
        metadata: { ...meta, resolvedBy: "auto", resolveNote: reason },
      }).eq("id", row.id).eq("reviewed_at", claimedAt);
      await releaseHoldsForProposal(supabase, row.id);
      return { success: false, error: `Nothing was applied. ${reason} Re-read and file again.`, data: { proposalId: row.id, status: "rejected", refused: stale } } as MCPResponse;
    }
    await release();
    return {
      success: false,
      error: `Nothing was applied. ${reason} The proposal stays pending: reject it, or ask its agent to re-read and file again.`,
      data: { proposalId: row.id, status: "pending", refused: stale },
    } as MCPResponse;
  }

  // 3. apply in order
  const results: Array<{ type: string; applied: boolean; error?: string }> = [];
  let failedAt = -1;
  for (let i = 0; i < parsed.length; i++) {
    const applied = await applySpecPatch(supabase, auth, projectId, parsed[i], origin);
    if (applied.applied) {
      results.push({ type: types[i], applied: true });
    } else {
      results.push({ type: types[i], applied: false, error: applied.error });
      failedAt = i;
      break;
    }
  }

  const now = new Date().toISOString();
  const allApplied = failedAt === -1;
  const patchStatuses = entries.map((e, i) => ({
    ...e,
    status: i < results.length ? (results[i].applied ? "accepted" : "failed") : "pending",
  }));
  const { error: updErr } = await supabase
    .from("ai_proposals")
    .update({
      status: allApplied ? "merged" : "partial",
      reviewed_at: now,
      ...(allApplied ? { merged_at: now } : {}),
      patches: patchStatuses,
      metadata: { ...meta, resolvedBy: opts.by, resolveNote: opts.note, ...(opts.by === "auto" ? { auto: true } : {}) },
    })
    .eq("id", row.id)
    .eq("status", "pending")
    .eq("reviewed_at", claimedAt);
  if (updErr) {
    return { success: false, error: `Patches ${allApplied ? "applied" : "partially applied"} but the proposal could not be marked: ${updErr.message}` };
  }
  // 4b.3: decided either way — the drafting holds bound to it end as 'resolved'.
  const holdsReleased = await releaseHoldsForProposal(supabase, row.id);

  if (!allApplied) {
    const failure = results[results.length - 1];
    return {
      success: false,
      error: `Applied ${results.length - 1} of ${entries.length} patch(es), then "${failure.type}" refused: ${failure.error}. ` +
        `The proposal is marked partial with per-patch statuses — resolve the refusal and re-propose the remainder.`,
      data: { proposalId: row.id, status: "partial", results },
    } as MCPResponse;
  }
  return {
    success: true,
    data: {
      proposalId: row.id,
      status: "merged",
      applied: results.length,
      results,
      ...(holdsReleased > 0 ? { holdsReleased } : {}),
      message: "All patches applied and the proposal is merged. get_project_status reflects the new state.",
    },
  };
}

// V3 4b.3 (R5/R6/R7): get_outcome_board — the agent's read of the OUTCOMES
// pool. Until this, candidates were reachable over MCP only through the
// repo-import backfill flow; an agent that wanted to SUGGEST a derivation
// had nothing to read. This is that read: every pending outcome on the
// branch with its criteria AND THEIR IDS (what promote_candidate's
// criteriaIds claims), the steps it maps to, what it already derived and
// which criteria those derivations claimed, and the advisory holds on it
// (mine marked by credential). Everything user-authored travels in the
// untrusted-data envelope.
//
// The lane it teaches: read → checkout_task {level: 'outcome'} → propose
// promote_candidate per slice (hash_match the claimed texts by id) → the
// user accepts in the app → settle when covered. Agents draft below the
// promotion line; a human crosses it (R6).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, holderIdentity, credentialLabel } from "../shared.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";
import { identifiedFromRow, criterionIdOf } from "../../_shared/criterion-identity.ts";
import { UNTRUSTED_ADVISORY, wrapField, wrapFieldNullable } from "../../_shared/untrusted-data.ts";
import { isMine, credentialHorizons } from "./checkouts.ts";
import { getEffectiveTier, getProjectTier } from "../../_shared/deployment.ts";
import { workflowsBlock } from "../../_shared/workflow-gate.ts";
import { servesOf, visionSentences } from "../../_shared/vision-sentences.ts";

const STALE_MS = 30 * 60 * 1000;

/** P (2026-09-22): the board as the plan sees it. Every board carries
 *  `workflows`; below Indie it also OMITS lanes, homeLaneId, homeLane and
 *  steps. Omitted, never emptied: an empty `steps` reads as "not placed yet"
 *  and a lone lane named "Workflow" reads as a workflow the user made. The
 *  outcomes, their criteria, derivations and holds are untouched. Pure. */
export function shapeBoardForPlan<O extends Record<string, unknown>, B extends { outcomes: O[]; lanes?: unknown }>(
  board: B,
  block: ReturnType<typeof workflowsBlock>,
): Omit<B, "lanes" | "outcomes"> & { outcomes: Array<Partial<O>>; lanes?: B["lanes"]; workflows: ReturnType<typeof workflowsBlock> } {
  if (block.available) return { ...board, workflows: block };
  const { lanes: _lanes, outcomes, ...rest } = board;
  return {
    ...rest,
    workflows: block,
    outcomes: outcomes.map((o) => {
      const { homeLaneId: _h, homeLane: _hl, steps: _s, ...kept } = o as Record<string, unknown>;
      return kept as Partial<O>;
    }),
  };
}

export type BoardCandidate = {
  id: string; key: string; kind: string; name: string; description: string | null; category: string | null;
  status: string; criteria: unknown; requirement_row_id: string | null; updated_at: string;
  /** AA.1: evidence.serves holds the vision sentences it cites. */
  evidence?: unknown;
};
export type BoardLane = { id: string; name: string; color: string | null; sort_order: number };
export type BoardStep = { id: string; workflow_id: string; name: string; sort_order: number };
export type BoardMap = { candidate_id: string; step_id: string };
export type BoardDerivation = {
  id: string; candidate_id: string; requirement_row_id: string; criteria_slice: Array<{ id?: string; text?: string }> | null;
  proposed_by_kind: string; via_proposal_id: string | null; created_at: string;
};
export type BoardHold = {
  id: string; candidate_id: string | null; holder_label: string; holder_key_id: string | null; holder_delegate: string | null;
  proposal_id: string | null; since: string; heartbeat_at: string; meta: Record<string, unknown> | null;
};

/** Pure assembly — the shape agents read. */
export function assembleOutcomeBoard(input: {
  auth: AuthResult;
  candidates: BoardCandidate[];
  lanes: BoardLane[];
  steps: BoardStep[];
  maps: BoardMap[];
  derivations: BoardDerivation[];
  reqRefs: Map<string, { requirementId: string; name: string }>;
  holds: BoardHold[];
  keyNames: Map<string, string>;
  horizons?: Map<string, string | null>;
  now?: number;
  /** AA.1: the project's vision, split into the sentences outcomes cite. */
  vision?: string | null;
  /** AA.1: sentence id → outcomes citing it, counted over settled outcomes too (the board may hide them). */
  servedCounts?: Map<string, number>;
}) {
  const now = input.now ?? Date.now();
  const sentences = visionSentences(input.vision);
  const liveSentence = new Set(sentences.map((v) => v.id));
  const me = holderIdentity(input.auth);
  const laneById = new Map(input.lanes.map((l) => [l.id, l]));
  const stepById = new Map(input.steps.map((s) => [s.id, s]));
  const outcomes = input.candidates.map((c) => {
    const criteria = identifiedFromRow(c.criteria);
    const mine = input.derivations.filter((d) => d.candidate_id === c.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const claimedBy = new Map<string, string>();
    const derivations = mine.map((d) => {
      const ref = input.reqRefs.get(d.requirement_row_id);
      const criteriaIds = (d.criteria_slice ?? []).map((x) => criterionIdOf(x));
      for (const id of criteriaIds) claimedBy.set(id, ref?.requirementId ?? d.requirement_row_id);
      return {
        derivationId: d.id,
        requirementId: ref?.requirementId ?? null,
        requirementRowId: d.requirement_row_id,
        requirementName: ref ? wrapField(ref.name) : null,
        criteriaIds,
        proposedByKind: d.proposed_by_kind,
        viaProposalId: d.via_proposal_id,
        createdAt: d.created_at,
      };
    });
    const steps = input.maps.filter((m) => m.candidate_id === c.id).map((m) => {
      const step = stepById.get(m.step_id);
      const lane = step ? laneById.get(step.workflow_id) : undefined;
      return { stepId: m.step_id, name: step ? wrapField(step.name) : null, laneId: lane?.id ?? null, laneName: lane ? wrapField(lane.name) : null };
    });
    const holds = input.holds.filter((h) => h.candidate_id === c.id).map((h) => {
      const delegate = h.holder_delegate ?? (h.holder_key_id ? `key:${h.holder_key_id}` : null);
      return {
      checkoutId: h.id,
      holder: h.holder_label,
      credential: credentialLabel(delegate, input.keyNames),
      credentialExpiresAt: delegate ? (input.horizons?.get(delegate) ?? null) : null,
      mine: isMine(input.auth, me, h),
      since: h.since,
      stale: now - new Date(h.heartbeat_at).getTime() > STALE_MS,
      proposalId: h.proposal_id,
      ...(h.meta && Object.keys(h.meta).length > 0 ? { meta: h.meta } : {}),
      };
    });
    return {
      candidateId: c.id,
      key: c.key,
      kind: c.kind,
      status: c.status,
      // 7.3: the mark travels with the item so the boundary can withhold it
      mark: (c as { mark?: string | null }).mark ?? null,
      name: wrapField(c.name),
      description: wrapFieldNullable(c.description),
      category: c.category,
      // the whole-row token — too coarse for a derivation; claim by criterion id instead
      updatedAt: c.updated_at,
      firstRequirementRowId: c.requirement_row_id,
      // 9.5 (v3v): the outcome's HOME lane — exactly one. `steps` below may
      // reach into other lanes (the JOIN seam); that touch is not a home.
      homeLaneId: (c as { workflow_id?: string | null }).workflow_id ?? null,
      homeLane: (() => { const wf = (c as { workflow_id?: string | null }).workflow_id; const lane = wf ? laneById.get(wf) : undefined; return lane ? wrapField(lane.name) : null; })(),
      criteria: criteria.map((k) => ({
        id: k.id,
        text: wrapField(k.text),
        ...(k.verification ? { verification: k.verification } : {}),
        claimedBy: claimedBy.get(k.id) ?? null,
      })),
      unclaimedCriteriaIds: criteria.filter((k) => !claimedBy.has(k.id)).map((k) => k.id),
      // AA.1: what it cites; `current: false` is a sentence the vision no longer has.
      serves: servesOf(c.evidence).map((v) => ({ id: v.id, ...(v.text ? { text: wrapField(v.text) } : {}), current: liveSentence.has(v.id) })),
      steps,
      derivations,
      holds,
    };
  });
  const servedBy = input.servedCounts ?? new Map<string, number>();
  if (!input.servedCounts) for (const o of outcomes) for (const v of o.serves) servedBy.set(v.id, (servedBy.get(v.id) ?? 0) + 1);
  return {
    outcomes,
    // AA.1: the sentences an outcome cites (create_candidate / update_candidate `serves`), each with its id.
    vision: { sentences: sentences.map((v) => ({ id: v.id, text: wrapField(v.text), servedBy: servedBy.get(v.id) ?? 0 })) },
    lanes: [...input.lanes].sort((a, b) => a.sort_order - b.sort_order).map((l) => ({
      laneId: l.id, name: wrapField(l.name), color: l.color,
      steps: input.steps.filter((s) => s.workflow_id === l.id).sort((a, b) => a.sort_order - b.sort_order).map((s) => ({ stepId: s.id, name: wrapField(s.name) })),
    })),
    counts: {
      outcomes: outcomes.length,
      pending: outcomes.filter((o) => o.status === "pending").length,
      settled: outcomes.filter((o) => o.status === "accepted").length,
      derivations: input.derivations.length,
      heldByMe: outcomes.reduce((n, o) => n + o.holds.filter((h) => h.mine).length, 0),
    },
  };
}

export async function handleGetOutcomeBoard(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id?: string; include_settled?: boolean }
): Promise<MCPResponse> {
  if (!checkScope(auth, "read")) {
    return { success: false, error: "Insufficient permissions: read scope required" };
  }
  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ("error" in resolved) return resolved.error;
  const projectId = resolved.project.id;

  let branchId = args.branch_id ?? null;
  if (!branchId) {
    const primary = await getPrimaryBranch(supabase, projectId, "id, name");
    branchId = (primary as { id: string } | null)?.id ?? null;
  }
  if (!branchId) return { success: false, error: "This project has no branch, so there is no outcomes board to read." };

  // P: below Indie the lanes, steps and step maps are not read at all; the
  // board says so in `workflows` instead of carrying them empty.
  let tier: Awaited<ReturnType<typeof getEffectiveTier>> = "community";
  try { tier = await getProjectTier(supabase, projectId, auth.userId, { role: resolved.project.role }); } catch { /* fail closed */ }
  const plan = workflowsBlock(tier);
  let lanes: BoardLane[] = [];
  if (plan.available) {
    const { data: laneRows } = await supabase.from("workflows").select("id, name, color, sort_order").eq("project_id", projectId);
    lanes = (laneRows ?? []) as BoardLane[];
  }
  let steps: BoardStep[] = [];
  if (lanes.length > 0) {
    const { data: stepRows } = await supabase.from("workflow_steps").select("id, workflow_id, name, sort_order").in("workflow_id", lanes.map((l) => l.id));
    steps = (stepRows ?? []) as BoardStep[];
  }

  const { data: candRows, error: candErr } = await supabase
    .from("requirement_candidates")
    .select("id, key, kind, name, description, category, status, criteria, requirement_row_id, workflow_id, mark, updated_at, evidence")
    .eq("project_id", projectId)
    .eq("branch_id", branchId)
    .neq("status", "dismissed");
  if (candErr) return { success: false, error: `Could not read the outcomes: ${candErr.message}` };
  const candidates = ((candRows ?? []) as BoardCandidate[]).filter((c) => args.include_settled || c.status === "pending");
  const ids = candidates.map((c) => c.id);

  let maps: BoardMap[] = [];
  let derivations: BoardDerivation[] = [];
  let holds: BoardHold[] = [];
  const reqRefs = new Map<string, { requirementId: string; name: string }>();
  if (ids.length > 0) {
    if (plan.available) {
      const { data: mapRows } = await supabase.from("outcome_step_maps").select("candidate_id, step_id").in("candidate_id", ids);
      maps = (mapRows ?? []) as BoardMap[];
    }
    const { data: derRows } = await supabase
      .from("outcome_derivations")
      .select("id, candidate_id, requirement_row_id, criteria_slice, proposed_by_kind, via_proposal_id, created_at")
      .in("candidate_id", ids);
    derivations = (derRows ?? []) as BoardDerivation[];
    const reqIds = [...new Set(derivations.map((d) => d.requirement_row_id))];
    if (reqIds.length > 0) {
      const { data: reqRows } = await supabase.from("specification_requirements").select("id, requirement_id, name").in("id", reqIds);
      for (const r of (reqRows ?? []) as Array<{ id: string; requirement_id: string; name: string }>) reqRefs.set(r.id, { requirementId: r.requirement_id, name: r.name });
    }
    const { data: holdRows } = await supabase
      .from("agent_checkouts")
      .select("id, candidate_id, holder_label, holder_key_id, holder_delegate, proposal_id, since, heartbeat_at, meta")
      .eq("project_id", projectId)
      .eq("level", "outcome")
      .is("released_at", null)
      .in("candidate_id", ids);
    holds = (holdRows ?? []) as BoardHold[];
  }
  const keyNames = new Map<string, string>();
  const keyIds = [...new Set(holds.map((h) => h.holder_key_id).filter(Boolean))] as string[];
  if (keyIds.length > 0) {
    const { data: keys } = await supabase.from("mcp_api_keys").select("id, name").in("id", keyIds);
    for (const k of (keys ?? []) as Array<{ id: string; name: string | null }>) if (k.name) keyNames.set(k.id, k.name);
  }

  const horizons = await credentialHorizons(supabase, holds.map((h) => h.holder_delegate ?? (h.holder_key_id ? `key:${h.holder_key_id}` : null)));
  const { data: spec } = await supabase
    .from("project_specifications")
    .select("vision")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const vision = (spec as { vision?: string | null } | null)?.vision ?? null;
  const servedCounts = new Map<string, number>();
  for (const c of (candRows ?? []) as BoardCandidate[]) {
    for (const v of servesOf(c.evidence)) servedCounts.set(v.id, (servedCounts.get(v.id) ?? 0) + 1);
  }
  const board = shapeBoardForPlan(assembleOutcomeBoard({ auth, candidates, lanes, steps, maps, derivations, reqRefs, holds, keyNames, horizons, vision, servedCounts }), plan);
  return {
    success: true,
    data: {
      projectId,
      branchId,
      ...board,
      untrustedDataAdvisory: UNTRUSTED_ADVISORY,
      message:
        (plan.available
          ? "Outcomes are PROMPT DATA — what a workflow should achieve — and derive canonical requirements. Every outcome has exactly one home lane (homeLaneId; `lanes` lists them with their steps) — create_candidate takes workflowId, else the outcome lands in the project's first lane. "
          : "Outcomes are PROMPT DATA (what the product should achieve) and derive canonical requirements. This plan has no Workflows (see `workflows`), so the board carries no lanes or steps; file new outcomes with create_candidate and no workflow. ") +
        "To suggest one: checkout_task {level: 'outcome', ref_id: candidateId} (advisory; coexists with others), then " +
        "propose_patches with one promote_candidate per requirement you want — { candidateId, criteriaIds: [<ids from criteria[].id>], name } — " +
        "or attach_candidate { candidateId, requirementId: 'REQ-nnn', criteriaIds? } to derive against a requirement that already exists (nothing minted; a locked requirement refuses) — " +
        "guarding each with a hash_match precondition on criteria[id=<id>].text so a sibling agent claiming a DISJOINT slice never conflicts with you. " +
        "Every outcome cites the vision sentence or sentences it serves (`vision.sentences` lists them with their ids; create_candidate and update_candidate take `serves`, and a settled outcome still takes that one change). " +
        "Crossing the promotion line is the human act: promote_candidate, attach_candidate and settle_candidate always file as proposals and only the user accepts them in the app; " +
        "your hold binds to the proposal on filing and releases as 'resolved' when the user decides. Criteria with claimedBy set are already derived — draft new ones on the outcome instead.",
    },
  };
}

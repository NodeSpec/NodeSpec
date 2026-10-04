// V3 P2 (task 2.3): applying spec-plane patches — the other half of the
// vocabulary in _shared/spec-patch-schema.ts. Consumed by the change router
// (task 2.4: the level-2 apply-and-record lane) and the approvals accept
// lane (P8); nothing calls it before those land, so shipping it is zero
// behavior change.
//
// DESIGN: requirement-kind ops DELEGATE to the existing MCP handlers — the
// same code paths the direct tools run, so propose-then-accept ≡ direct
// edit by construction: locks refuse the apply (a lock blocks apply at
// every level), sections resolve-or-create, delete keeps its force rules
// and supersession posture, mappings dual-write the architecture trace.
// Outcome ops write the candidates plane directly, mirroring
// backfill_requirements' decide lane (the SAME requirement insert shape)
// with the two ideation deltas: a NULL-node candidate skips the mapping,
// and the PROMOTION GATE is deterministic — at least one testable
// criterion, or the apply refuses ("AI board summarization" is refused by
// rule, not by taste). Workflow ops write the lane tables with a project
// guard on every ref.
//
// v3l (R5): promotion DERIVES, it does not consume. The candidate stays
// pending; the claimed criteria slice is snapshotted in outcome_derivations
// with proposer + approver; a claimed criterion refuses a second claim by
// name; 'accepted' is the explicit settle act (settle_candidate). Dismissed
// and settled candidates refuse every op — a refile mints a new row.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { criterionIdOf, identifiedFromRow, identifyCriteria } from "../../_shared/criterion-identity.ts";
import { credentialOf, type AuthResult } from "../shared.ts";
import type { SpecPatchOperation } from "../../_shared/spec-patch-schema.ts";
import {
  handleCreateRequirement,
  handleUpdateRequirement,
  handleDeleteRequirement,
  handleMapRequirement,
  lockedRefusal,
  nextRequirementId,
  resolveRequirementRow,
  resolveSpecForProject,
  type CriterionInput,
} from "./requirements.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";
import { getProjectTier } from "../../_shared/deployment.ts";
import { isWorkflowOp, requireWorkflows, workflowsAllowed, OUTCOME_ON_PROJECT_NOTE, isConstraintOp, requireConstraints } from "../../_shared/workflow-gate.ts";
import { constraintIdentity } from "../../_shared/constraint-identity.ts";
import { CONTRACT_KIND_VALUES } from "../../_shared/enums.ts";
import type { VisionSentence } from "../../_shared/vision-sentences.ts";
import { citeVision, OFF_VISION_NOTE } from "../../_shared/chain.ts";
import type { PlanTier } from "../../_shared/tiers.ts";
import { changeSteps } from "../../_shared/change-intent.ts";
import { handleUpdateVision } from "./vision.ts";
import { handleRelateRequirements } from "./relations.ts";
import { checkSpecPreconditions } from "./spec-preconditions.ts";

export type ApplyResult =
  | { applied: true; result?: unknown }
  | { applied: false; error: string };

const ok = (result?: unknown): ApplyResult => ({ applied: true, result });
const refuse = (error: string): ApplyResult => ({ applied: false, error });

type CandidateRow = {
  id: string;
  project_id: string;
  branch_id: string;
  node_id: string | null;
  key: string;
  kind: string;
  name: string;
  description: string;
  category: string;
  criteria: Array<{ text?: string; verification?: string }> | null;
  status: string;
  requirement_row_id: string | null;
  /** 9.4: repo-index evidence on import-born rows; {} on ideation outcomes. */
  evidence?: Record<string, unknown> | null;
};

async function getCandidate(
  supabase: SupabaseClient,
  projectId: string,
  candidateId: string
): Promise<CandidateRow | null> {
  const { data } = await supabase
    .from("requirement_candidates")
    .select("id, project_id, branch_id, node_id, key, kind, name, description, category, criteria, status, requirement_row_id, evidence")
    .eq("id", candidateId)
    .eq("project_id", projectId)
    .maybeSingle();
  return (data as CandidateRow | null) ?? null;
}

/** Who PROPOSED a derivation (R7: a human user, or an agent credential)
 *  and through which proposal. The approvals lane passes the proposal's
 *  own origin; a direct apply derives it from the acting credential. */
export interface DerivationOrigin {
  proposedByKind: "human" | "agent";
  proposedById: string | null;
  viaProposalId: string | null;
  /** AL.7: the proven credential an agent filed with ("key:<id>",
   *  "oauth:<user>:<client>"), and the name it gave itself; the app names
   *  the agent on an outcome it filed from these. */
  credential?: string | null;
  agent?: string | null;
}

function originOf(auth: AuthResult, origin?: DerivationOrigin): DerivationOrigin {
  if (origin) return origin;
  const human = auth.authMethod === "jwt";
  return {
    proposedByKind: human ? "human" : "agent", proposedById: human ? auth.userId : (auth.keyId ?? null), viaProposalId: null,
    ...(human ? {} : { credential: credentialOf(auth).delegate }),
  };
}

/** AL.8: a decided outcome stays decided: the write that found it open lost the race. */
const DECIDED_MEANWHILE = (name: string) => `"${name}" was decided while this was waiting; nothing was changed. Read it again with get_outcome_board.`;

const OPEN_OUTCOME_OPS = new Set(["update_candidate", "dismiss_candidate", "promote_candidate", "attach_candidate", "settle_candidate", "set_outcome_step_maps"]);

/** AL.8 (owner 2026-10-01: "partial" approvals on outcomes and
 *  requirements, and agents working at the same time must not collide).
 *  The refusals a batch would meet against the rows as they are NOW,
 *  checked before any patch is written, so a batch built on a read another
 *  agent overtook applies nothing instead of half: its guards, the outcome
 *  still open, the criteria still unclaimed (by other proposals or by
 *  earlier patches in this one), the requirement still there and not
 *  locked. Read-only. What only an earlier patch of the same batch makes
 *  true is left to the apply. Null when nothing would be refused. */
export async function preflightSpecBatch(
  supabase: SupabaseClient,
  projectId: string,
  patches: SpecPatchOperation[],
): Promise<{ index: number; type: string; error: string } | null> {
  const claimedHere = new Map<string, Set<string>>();
  const createsRequirements = patches.some((p) => p.type === "create_requirement");
  let spec: { id: string } | null | undefined;
  const requirementRow = async (ref: string) => {
    if (spec === undefined) spec = await resolveSpecForProject(supabase, projectId);
    if (!spec) return null;
    const column = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref) ? "id" : "requirement_id";
    const { data } = await supabase.from("specification_requirements").select("id, requirement_id, locked").eq("specification_id", spec.id).eq(column, ref).maybeSingle();
    return (data as { id: string; requirement_id: string; locked?: boolean } | null) ?? null;
  };
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const stop = (error: string) => ({ index: i, type: patch.type, error });
    const pre = await checkSpecPreconditions(supabase, projectId, patch);
    if (!pre.ok) return stop(pre.error);
    const p = patch.payload as Record<string, unknown>;

    const refs: string[] = [];
    if (["update_requirement", "delete_requirement", "map_requirement"].includes(patch.type) && typeof p.requirementId === "string") refs.push(p.requirementId);
    if (patch.type === "relate_requirements") for (const k of ["fromRequirementId", "toRequirementId"]) if (typeof p[k] === "string") refs.push(p[k] as string);
    if (patch.type === "attach_candidate" && typeof p.requirementId === "string") refs.push(p.requirementId);
    for (const ref of refs) {
      const row = await requirementRow(ref);
      if (!row) {
        if (createsRequirements) continue;
        return stop(`${ref} is not a requirement of this project any more.`);
      }
      if (row.locked === true) return stop(lockedRefusal(row.requirement_id));
    }

    if (!OPEN_OUTCOME_OPS.has(patch.type) || typeof p.candidateId !== "string") continue;
    const row = await getCandidate(supabase, projectId, p.candidateId);
    if (!row) return stop("Candidate not found in this project.");
    const changes = (p.changes ?? {}) as Record<string, unknown>;
    const onlyServes = patch.type === "update_candidate" && changes.serves !== undefined
      && Object.entries(changes).every(([k, v]) => k === "serves" || v === undefined);
    if (row.status !== "pending" && !(row.status === "accepted" && onlyServes)) {
      // Read at filing (under Auto) and at accept alike, so it says what is
      // true in both: the outcome is decided, and a decided outcome is terminal.
      return stop(`"${row.name}" is ${row.status === "accepted" ? "settled" : row.status} now: a decided outcome is terminal, so nothing more lands on it. File a new outcome instead.`);
    }
    if (patch.type !== "promote_candidate" && patch.type !== "attach_candidate") continue;
    const { data: priorRows } = await supabase.from("outcome_derivations").select("criteria_slice").eq("candidate_id", row.id);
    const claimed = new Set<string>(claimedHere.get(row.id) ?? []);
    for (const d of (priorRows ?? []) as Array<{ criteria_slice: Array<{ id?: string; text?: string }> | null }>) {
      for (const c of d.criteria_slice ?? []) claimed.add(criterionIdOf(c));
    }
    const all = identifiedFromRow(row.criteria);
    const asked = Array.isArray(p.criteriaIds) && p.criteriaIds.length > 0 ? (p.criteriaIds as string[]) : null;
    const slice = asked ? asked : all.filter((c) => !claimed.has(c.id)).map((c) => c.id);
    for (const id of slice) {
      const c = all.find((x) => x.id === id);
      if (!c) return stop(`Criterion "${id}" is not on "${row.name}" any more.`);
      if (claimed.has(id)) return stop(`Criterion "${c.text}" of "${row.name}" is already derived into a requirement.`);
    }
    if (patch.type === "promote_candidate" && slice.length === 0 && all.length > 0) {
      return stop(`Every criterion of "${row.name}" is already derived.`);
    }
    claimedHere.set(row.id, new Set([...claimed, ...slice]));
  }
  return null;
}

/** AL.7: the agent that filed an outcome, kept on the outcome itself (its
 *  evidence, beside the vision sentences it serves), or null for a person. */
function filedByOf(who: DerivationOrigin, patch: SpecPatchOperation): { credential: string | null; agent: string | null } | null {
  if (who.proposedByKind !== "agent") return null;
  const actor = (patch.metadata as { actorId?: unknown } | undefined)?.actorId;
  const agent = who.agent ?? (typeof actor === "string" && actor.trim() ? actor.trim() : null);
  return { credential: who.credential ?? null, agent };
}

type DerivationRow = { id: string; requirement_row_id: string; criteria_slice: Array<{ id?: string; text?: string }> | null };

// ── 9.6: lanes by name ───────────────────────────────────────────────────
// A context proposal creates lanes and then names them from its steps and
// outcomes (upsert_workflow_step / create_candidate { workflowName }), since
// a lane created earlier in the same proposal has no id yet.
//
// P (2026-09-22) retired the "Individual plan: one lane" merge. It merged a
// second lane into the first below TEAM; Workflows now start at Indie with
// as many lanes as the work needs, and below Indie every lane-shaping op is
// refused at the top of applySpecPatch, so nothing below reaches a merge.
type LaneRow = { id: string; name: string };

/** The acting account's tier. A tier read that fails is treated as the
 *  lowest plan: the gate fails closed, the same as a missing subscription. */
/** Decision 1: the project's plan (its owner's). */
async function tierOf(supabase: SupabaseClient, auth: AuthResult, projectId: string): Promise<PlanTier> {
  try {
    return await getProjectTier(supabase, projectId, auth.userId);
  } catch {
    return "community";
  }
}

/** R.2b: what a constraint's scope and check name must exist: a catalog
 *  role or technology, a contract kind, a node on the project's primary
 *  branch. Returns the refusal, or null. */
async function checkConstraintRefs(
  supabase: SupabaseClient,
  projectId: string,
  scope: { kind: string; value: string } | null,
  check: { predicate: string; params?: Record<string, unknown> } | null,
): Promise<string | null> {
  const roles = new Set<string>();
  const techs = new Set<string>();
  if (scope?.kind === "role") roles.add(scope.value);
  if (scope?.kind === "technology") techs.add(scope.value);
  if (scope?.kind === "contract_kind" && !(CONTRACT_KIND_VALUES as readonly string[]).includes(scope.value)) {
    return `"${scope.value}" is not a contract kind (${CONTRACT_KIND_VALUES.join(", ")}).`;
  }
  if (check?.predicate === "no_calls_between_roles") {
    roles.add(String(check.params?.from ?? ""));
    roles.add(String(check.params?.to ?? ""));
  }
  if (check?.predicate === "technology_in_list" && Array.isArray(check.params?.technologies)) {
    for (const t of check.params!.technologies as unknown[]) techs.add(String(t));
  }
  if (roles.size > 0) {
    const { data } = await supabase.from("node_roles").select("id").in("id", [...roles]);
    const known = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    const unknown = [...roles].filter((r) => !known.has(r));
    if (unknown.length > 0) return `no node role ${unknown.map((r) => `"${r}"`).join(", ")} in the catalog (lookup_catalog lists them).`;
  }
  if (techs.size > 0) {
    const { data } = await supabase.from("technology_catalog").select("id").in("id", [...techs]);
    const known = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    const unknown = [...techs].filter((t) => !known.has(t));
    if (unknown.length > 0) return `no technology ${unknown.map((t) => `"${t}"`).join(", ")} in the catalog (search_catalog finds them).`;
  }
  if (scope?.kind === "node") {
    const branch = await getPrimaryBranch(supabase, projectId, "id");
    const { data } = branch ? await supabase.rpc("graph_reference_ids", { p_branch_id: (branch as { id: string }).id }) : { data: null };
    const nodes = Array.isArray((data as { nodes?: unknown } | null)?.nodes) ? (data as { nodes: string[] }).nodes : [];
    if (!nodes.includes(scope.value)) return `no node ${scope.value} on this project's graph.`;
  }
  return null;
}

async function resolveLaneRef(
  supabase: SupabaseClient,
  projectId: string,
  ref: { workflowId?: string; workflowName?: string },
): Promise<{ lane: LaneRow } | { error: string }> {
  if (ref.workflowId) {
    const { data } = await supabase.from("workflows").select("id, name").eq("id", ref.workflowId).eq("project_id", projectId).maybeSingle();
    return data ? { lane: data as LaneRow } : { error: "Workflow not found in this project." };
  }
  const name = ref.workflowName?.trim();
  if (!name) return { error: "workflowId or workflowName is required." };
  const { data } = await supabase.from("workflows").select("id, name").eq("project_id", projectId).eq("name", name).maybeSingle();
  if (data) return { lane: data as LaneRow };
  return { error: `Workflow "${name}" not found in this project. Put an upsert_workflow for it EARLIER in the same proposal, or name an existing lane (get_outcome_board lists them).` };
}

// ── AA.1: outcomes cite the vision ──────────────────────────────────────
// A citation resolves against the vision as it is when the patch applies, so
// an update_vision earlier in the same proposal (applied first) counts.

/** The project's current vision text ('' when none). */
export async function currentVision(supabase: SupabaseClient, projectId: string): Promise<string> {
  const { data } = await supabase
    .from("project_specifications")
    .select("vision")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return String((data as { vision?: string | null } | null)?.vision ?? "");
}

/** Apply one spec-plane patch as the acting user. The caller (router
 *  level-2 lane, or the approvals accept lane) decides WHETHER this runs —
 *  this module only decides whether the write is legal. */
export async function applySpecPatch(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  patch: SpecPatchOperation,
  origin?: DerivationOrigin
): Promise<ApplyResult> {
  // V3 (task 2.7): preconditions gate EVERY apply of this patch — the
  // router's level-2 lane and the approvals accept lane both come through
  // here, so a stale patch fails loudly at merge no matter which door it
  // entered by. No preconditions costs no read.
  const pre = await checkSpecPreconditions(supabase, projectId, patch);
  if (!pre.ok) return refuse(pre.error);

  // P: the lane-shaping ops are Indie and above. Checked here as well as at
  // propose, because a proposal filed on Indie can be accepted after a
  // downgrade: this patch is refused at its write with the upgrade reason,
  // and the proposal's other patches are decided one by one as always.
  if (isWorkflowOp(patch.type)) {
    const gate = requireWorkflows(await tierOf(supabase, auth, projectId), `Shaping a workflow (${patch.type})`);
    if (!gate.ok) return refuse(gate.error);
  }
  // AC (owner 2026-09-24): constraints do not exist below Indie; the same
  // rule at the same two doors (a proposal accepted after a downgrade).
  if (isConstraintOp(patch.type)) {
    const gate = requireConstraints(await tierOf(supabase, auth, projectId), `Working with constraints (${patch.type})`);
    if (!gate.ok) return refuse(gate.error);
  }

  switch (patch.type) {
    // ── requirement kind: delegate to the shipped handlers ─────────────────
    case "create_requirement": {
      const p = patch.payload;
      const r = await handleCreateRequirement(supabase, auth, {
        project_id: projectId,
        name: p.name,
        description: p.description,
        category: p.category,
        acceptance_criteria: p.criteria as CriterionInput[] | undefined,
        section: p.section,
        mark: p.mark,
      } as never);
      return r.success ? ok(r.data) : refuse(r.error ?? "create_requirement failed");
    }
    case "update_requirement": {
      const p = patch.payload;
      const r = await handleUpdateRequirement(supabase, auth, {
        project_id: projectId,
        requirement_id: p.requirementId,
        name: p.changes.name,
        description: p.changes.description,
        category: p.changes.category,
        status: p.changes.status,
        acceptance_criteria: p.changes.criteria as CriterionInput[] | undefined,
        mark: p.changes.mark,
        archived: p.changes.archived,
      } as never);
      return r.success ? ok(r.data) : refuse(r.error ?? "update_requirement failed");
    }
    case "delete_requirement": {
      const p = patch.payload;
      const r = await handleDeleteRequirement(supabase, auth, {
        project_id: projectId,
        requirement_id: p.requirementId,
        force: p.force,
      });
      return r.success ? ok(r.data) : refuse(r.error ?? "delete_requirement failed");
    }
    case "update_vision": {
      const r = await handleUpdateVision(supabase, auth, { project_id: projectId, vision: patch.payload.vision });
      return r.success ? ok(r.data) : refuse(r.error ?? "update_vision failed");
    }
    case "map_requirement": {
      const p = patch.payload;
      const r = await handleMapRequirement(supabase, auth, {
        project_id: projectId,
        requirement_id: p.requirementId,
        node_ids: p.nodeIds,
        mode: p.mode,
        mapping_type: p.mappingType,
        branch_id: p.branchId,
      } as never);
      return r.success ? ok(r.data) : refuse(r.error ?? "map_requirement failed");
    }
    case "relate_requirements": {
      const p = patch.payload;
      const r = await handleRelateRequirements(supabase, auth, {
        project_id: projectId,
        from_requirement_id: p.fromRequirementId,
        to_requirement_id: p.toRequirementId,
        relation_type: p.relationType,
        mode: p.mode,
        notes: p.notes,
      } as never);
      return r.success ? ok(r.data) : refuse(r.error ?? "relate_requirements failed");
    }

    // ── Z: a standing constraint ───────────────────────────────────────────
    // The same row the app's add writes: the same identity (a second filing
    // of the same constraint, from either door, is refused as already
    // recorded), the lane checked against this project, and the proposer
    // named as its author so the Team pane can say who filed it.
    case "create_constraint": {
      const p = patch.payload;
      let workflowId: string | null = null;
      if (p.workflowId || p.workflowName?.trim()) {
        const lane = await resolveLaneRef(supabase, projectId, { workflowId: p.workflowId, workflowName: p.workflowName });
        if ("error" in lane) return refuse(`create_constraint refused: ${lane.error}`);
        workflowId = lane.lane.id;
      }
      // R.2b: a scope and a check name only what exists: catalog roles and
      // technologies, a contract kind, a node on this project's graph.
      const refs = await checkConstraintRefs(supabase, projectId, p.scope ?? null, p.check ?? null);
      if (refs) return refuse(`create_constraint refused: ${refs}`);
      const description = p.description.trim();
      const { data, error } = await supabase
        .from("project_constraints")
        .insert({
          project_id: projectId,
          ctype: p.ctype,
          description,
          source_hash: await constraintIdentity(p.ctype, description),
          workflow_id: workflowId,
          // R.2b: guidance is the column default, so a guide writes what it always did.
          ...(p.kind === "check" && p.check ? { kind: "check", check_spec: p.check } : {}),
          ...(p.scope && !workflowId ? { scope_kind: p.scope.kind, scope_value: p.scope.value } : {}),
          ...(p.origin ? { origin: p.origin } : {}),
          ...(p.title?.trim() ? { title: p.title.trim() } : {}),
          ...(p.rationale?.trim() ? { rationale: p.rationale.trim() } : {}),
          ...(patch.metadata.actorId ? { author: patch.metadata.actorId } : {}),
        })
        .select("id")
        .single();
      if (error || !data) {
        if (error?.code === "23505" || /duplicate|unique/i.test(error?.message ?? "")) {
          return refuse(`create_constraint refused: this ${p.ctype} constraint is already recorded on the project.`);
        }
        return refuse(`create_constraint failed: ${error?.message ?? "insert failed"}`);
      }
      return ok({ constraintId: (data as { id: string }).id, ctype: p.ctype, workflowId, ...(p.kind === "check" ? { kind: "check" } : {}) });
    }

    // ── R.2b: change a constraint, or waive a check where it cannot hold ──
    // The person accepts these in the app (NEVER_AUTO_APPLY): the waiver's
    // owner is the person who accepted it.
    case "update_constraint": {
      const p = patch.payload;
      // AL.10 (owner 2026-10-01): the waivers are one list, so a change lands
      // only on the row as it was read; a waiver added or lifted meanwhile is
      // read again and kept (three tries), never written over.
      for (let attempt = 1; ; attempt++) {
        const { data: row, error: readErr } = await supabase
          .from("project_constraints")
          .select("id, ctype, kind, description, waivers, updated_at")
          .eq("id", p.constraintId)
          .eq("project_id", projectId)
          .maybeSingle();
        if (readErr) return refuse(`update_constraint failed: ${readErr.message}`);
        if (!row) return refuse(`update_constraint refused: no constraint ${p.constraintId} on this project.`);
        const cur = row as { ctype: string; kind: string; description: string; waivers: unknown; updated_at?: string | null };
        const changes: Record<string, unknown> = {};
        if (p.changes?.check) {
          if (cur.kind !== "check") return refuse("update_constraint refused: this constraint is guidance, not a check; file a check as its own constraint.");
          const refs = await checkConstraintRefs(supabase, projectId, null, p.changes.check);
          if (refs) return refuse(`update_constraint refused: ${refs}`);
          changes.check_spec = p.changes.check;
        }
        if (p.changes?.title?.trim()) changes.title = p.changes.title.trim();
        if (p.changes?.rationale !== undefined) changes.rationale = p.changes.rationale.trim() || null;
        if (p.changes?.description?.trim() && p.changes.description.trim() !== cur.description) {
          changes.description = p.changes.description.trim();
          changes.source_hash = await constraintIdentity(cur.ctype, p.changes.description);
        }
        let waivers = Array.isArray(cur.waivers) ? cur.waivers as Array<Record<string, unknown>> : [];
        if (p.removeWaiver) {
          if (!waivers.some((w) => w.id === p.removeWaiver)) return refuse(`update_constraint refused: no waiver ${p.removeWaiver} on this constraint.`);
          waivers = waivers.filter((w) => w.id !== p.removeWaiver);
          changes.waivers = waivers;
        }
        if (p.addWaiver) {
          if (cur.kind !== "check") return refuse("update_constraint refused: only a check can be waived.");
          waivers = [...waivers.filter((w) => w.target !== p.addWaiver!.target), {
            id: crypto.randomUUID(),
            target: p.addWaiver.target,
            reason: p.addWaiver.reason.trim(),
            owner: auth.userId ?? null,
            ...(p.addWaiver.expiresAt ? { expiresAt: p.addWaiver.expiresAt } : {}),
            at: new Date().toISOString(),
          }];
          changes.waivers = waivers;
        }
        if (Object.keys(changes).length === 0) return ok({ constraintId: p.constraintId, unchanged: true });
        const write = supabase
          .from("project_constraints")
          .update({ ...changes, updated_at: new Date().toISOString() })
          .eq("id", p.constraintId)
          .eq("project_id", projectId);
        const { data: wrote, error } = await (cur.updated_at ? write.eq("updated_at", cur.updated_at) : write.is("updated_at", null)).select("id");
        if (error) {
          if (error.code === "23505" || /duplicate|unique/i.test(error.message ?? "")) {
            return refuse("update_constraint refused: another constraint of this type already says that.");
          }
          return refuse(`update_constraint failed: ${error.message}`);
        }
        if (Array.isArray(wrote) && wrote.length === 0) {
          if (attempt < 3) continue;
          return refuse("update_constraint refused: the constraint kept changing while this was written; nothing was changed. Read it again and file again.");
        }
        return ok({ constraintId: p.constraintId, changed: Object.keys(changes).filter((k) => k !== "source_hash") });
      }
    }

    // ── R.2c: retire a constraint ─────────────────────────────────────────
    case "delete_constraint": {
      const p = patch.payload;
      const { data, error } = await supabase
        .from("project_constraints")
        .delete()
        .eq("id", p.constraintId)
        .eq("project_id", projectId)
        .select("id");
      if (error) return refuse(`delete_constraint failed: ${error.message}`);
      if (!Array.isArray(data) || data.length === 0) return refuse(`delete_constraint refused: no constraint ${p.constraintId} on this project.`);
      return ok({ constraintId: p.constraintId, retired: true, reason: p.reason });
    }

    // ── outcome kind: the candidates plane ──────────────────────────────────
    case "create_candidate": {
      const p = patch.payload;
      const filedBy = filedByOf(originOf(auth, origin), patch);
      // 9.5: a named home lane must be this project's; absent, the v3v
      // trigger homes the outcome in the first lane (no orphan process).
      // 9.6: the lane may be named (workflowName) — resolved here.
      // P: below Indie a named workflow is not honoured. The outcome is
      // still filed (outcomes are open on every plan) and the trigger homes
      // it, so it is never orphaned; the note tells the agent where it went.
      let served: VisionSentence[] | null = null;
      if (p.serves) {
        const cited = citeVision("create_candidate", p.serves, await currentVision(supabase, projectId));
        if ("error" in cited) return refuse(cited.error);
        served = cited.served;
      }
      let homeLaneId: string | null = null;
      let laneNote: string | null = null;
      const named = p.workflowName?.trim() || p.workflowId || null;
      if (named && !workflowsAllowed(await tierOf(supabase, auth, projectId))) {
        laneNote = OUTCOME_ON_PROJECT_NOTE(named);
      } else if (p.workflowId) {
        const { data: lane } = await supabase
          .from("workflows").select("id").eq("id", p.workflowId).eq("project_id", projectId).maybeSingle();
        if (!lane) return refuse(`create_candidate refused: workflow ${p.workflowId} is not a workflow of this project. get_outcome_board lists the lanes.`);
        homeLaneId = p.workflowId;
      } else if (p.workflowName) {
        const resolvedLane = await resolveLaneRef(supabase, projectId, { workflowName: p.workflowName });
        if ("error" in resolvedLane) return refuse(`create_candidate refused: ${resolvedLane.error}`);
        homeLaneId = resolvedLane.lane.id;
      }
      // AA.2: filed on a step of its home lane, by the step's name.
      let stepId: string | null = null;
      if (p.stepName && !laneNote) {
        if (!homeLaneId) return refuse("create_candidate refused: stepName names a step of the home lane; name the lane too (workflowName or workflowId).");
        const { data: laneSteps } = await supabase.from("workflow_steps").select("id, name").eq("workflow_id", homeLaneId);
        const wanted = p.stepName.trim().toLowerCase();
        const step = ((laneSteps ?? []) as Array<{ id: string; name: string }>).find((s) => s.name.trim().toLowerCase() === wanted);
        if (!step) {
          const names = ((laneSteps ?? []) as Array<{ name: string }>).map((s) => `"${s.name}"`).join(", ");
          return refuse(`create_candidate refused: the lane has no step named "${p.stepName}"${names ? ` (its steps: ${names})` : ""}.`);
        }
        stepId = step.id;
      }
      const { data, error } = await supabase
        .from("requirement_candidates")
        .insert({
          project_id: projectId,
          branch_id: p.branchId,
          ...(homeLaneId ? { workflow_id: homeLaneId } : {}),
          node_id: null,
          key: p.key ?? `outcome:${crypto.randomUUID().slice(0, 8)}`,
          kind: "outcome",
          name: p.name,
          description: p.description ?? "",
          category: p.category ?? "functional",
          criteria: identifyCriteria(p.criteria as never),
          ...(served || filedBy ? { evidence: { ...(served ? { serves: served } : {}), ...(filedBy ? { filedBy } : {}) } } : {}),
        })
        .select("id, key")
        .single();
      if (error || !data) return refuse(`create_candidate failed: ${error?.message ?? "insert failed"}`);
      if (stepId) {
        const { error: mapErr } = await supabase
          .from("outcome_step_maps")
          .insert({ branch_id: p.branchId, candidate_id: (data as { id: string }).id, step_id: stepId });
        if (mapErr) return refuse(`create_candidate filed the outcome but not on its step: ${mapErr.message}`);
      }
      return ok({
        ...(data as Record<string, unknown>),
        ...(served ? { serves: served.map((v) => v.id) } : { offVision: OFF_VISION_NOTE }),
        ...(laneNote ? { workflow: null, note: laneNote } : {}),
        ...(stepId ? { stepId } : {}),
      });
    }
    case "update_candidate": {
      const p = patch.payload;
      const row = await getCandidate(supabase, projectId, p.candidateId);
      if (!row) return refuse("Candidate not found in this project.");
      // AA.1: a citation is provenance, not content, so a settled outcome
      // still takes one (a vision edit must never strand it off vision).
      const onlyServes = p.changes.serves !== undefined
        && Object.entries(p.changes).every(([k, v]) => k === "serves" || v === undefined);
      if (row.status !== "pending" && !(row.status === "accepted" && onlyServes)) {
        return refuse(`Candidate is ${row.status} — decided candidates are terminal. Refile as a new candidate instead.${row.status === "accepted" ? " A settled outcome takes one change: serves." : ""}`);
      }
      const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
      let served: VisionSentence[] | null = null;
      if (p.changes.serves !== undefined) {
        const cited = citeVision("update_candidate", p.changes.serves, await currentVision(supabase, projectId));
        if ("error" in cited) return refuse(cited.error);
        served = cited.served;
        changes.evidence = { ...(row.evidence ?? {}), serves: served };
      }
      if (p.changes.name !== undefined) changes.name = p.changes.name;
      if (p.changes.description !== undefined) changes.description = p.changes.description;
      if (p.changes.category !== undefined) changes.category = p.changes.category;
      if (p.changes.criteria !== undefined) changes.criteria = identifyCriteria(p.changes.criteria as never, row.criteria ?? []);
      const { error } = await supabase.from("requirement_candidates").update(changes).eq("id", row.id);
      return error ? refuse(`update_candidate failed: ${error.message}`) : ok({ candidateId: row.id, ...(served ? { serves: served.map((v) => v.id) } : {}) });
    }
    case "dismiss_candidate": {
      const row = await getCandidate(supabase, projectId, patch.payload.candidateId);
      if (!row) return refuse("Candidate not found in this project.");
      if (row.status !== "pending") {
        return refuse(`Candidate is already ${row.status} — dismissed is terminal; a refile is a new row.`);
      }
      // 9.8: dismiss is for outcomes that derived nothing. An outcome with
      // derivations is the "why" of real requirements — settle it instead.
      const { data: derivedRows } = await supabase
        .from("outcome_derivations")
        .select("id")
        .eq("candidate_id", row.id);
      const derivedCount = ((derivedRows ?? []) as unknown[]).length;
      if (derivedCount > 0) {
        return refuse(`"${row.name}" derived ${derivedCount} requirement${derivedCount === 1 ? "" : "s"} — dismiss is for outcomes that derived nothing. Settle it when it is fully covered; the derived requirements keep it as their origin.`);
      }
      // AL.8: only while still open: an outcome decided meanwhile stays as decided.
      const { data: dismissed, error } = await supabase
        .from("requirement_candidates")
        .update({ status: "dismissed", decided_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id");
      if (error) return refuse(`dismiss_candidate failed: ${error.message}`);
      if (Array.isArray(dismissed) && dismissed.length === 0) return refuse(DECIDED_MEANWHILE(row.name));
      return ok({ candidateId: row.id, status: "dismissed" });
    }
    case "promote_candidate": {
      const p = patch.payload;
      const row = await getCandidate(supabase, projectId, p.candidateId);
      if (!row) return refuse("Candidate not found in this project.");
      if (row.status === "dismissed") return refuse("Candidate is dismissed — dismissed is terminal; a refile is a new row.");
      if (row.status !== "pending") {
        return refuse(`Candidate is ${row.status} — a settled outcome derives no further. Refile a new outcome for new intent.`);
      }

      // R5: what this outcome already derived, and which criteria those
      // derivations claimed — a claim is by criterion id (written, or the
      // text hash for legacy rows), never by position.
      const { data: priorRows } = await supabase
        .from("outcome_derivations")
        .select("id, requirement_row_id, criteria_slice")
        .eq("candidate_id", row.id);
      const prior = (priorRows ?? []) as DerivationRow[];
      const reqRefOf = new Map<string, string>();
      if (prior.length > 0) {
        const { data: reqs } = await supabase
          .from("specification_requirements")
          .select("id, requirement_id")
          .in("id", prior.map((d) => d.requirement_row_id));
        for (const r of (reqs ?? []) as Array<{ id: string; requirement_id: string }>) reqRefOf.set(r.id, r.requirement_id);
      }
      const claimedBy = new Map<string, string>();
      for (const d of prior) {
        for (const c of d.criteria_slice ?? []) claimedBy.set(criterionIdOf(c), reqRefOf.get(d.requirement_row_id) ?? d.requirement_row_id);
      }
      const all = identifiedFromRow(row.criteria);
      const unclaimed = all.filter((c) => !claimedBy.has(c.id));

      let slice = unclaimed;
      if (p.criteriaIds && p.criteriaIds.length > 0) {
        slice = [];
        for (const id of p.criteriaIds) {
          const c = all.find((x) => x.id === id);
          if (!c) return refuse(`Criterion "${id}" is not on "${row.name}" — read the outcome's current criteria (each carries its id) and re-submit.`);
          const holder = claimedBy.get(id);
          if (holder) return refuse(`Criterion "${c.text}" is already derived into ${holder} — choose unclaimed criteria, or draft new ones on the outcome.`);
          slice.push(c);
        }
      }
      // The deterministic promotion gate, per slice: at least one testable
      // criterion, or the gate refuses. Human judgment lives in the approval
      // that got this patch here — never in this check.
      if (slice.length === 0) {
        if (all.length === 0) {
          return refuse(`"${row.name}" has no testable outcome — the promotion gate needs at least one acceptance criterion. Draft criteria on the candidate, then promote.`);
        }
        return refuse(`Every criterion of "${row.name}" is already derived (${[...new Set(claimedBy.values())].join(", ")}) — draft new criteria to derive more, or settle the outcome.`);
      }

      // Mirror of backfill_requirements' decide lane (the canonical
      // candidate→requirement insert shape), ideation deltas noted above.
      let spec = await resolveSpecForProject(supabase, projectId);
      if (!spec) {
        const { data: created, error: specErr } = await supabase
          .from("project_specifications")
          .insert({ project_id: projectId, vision: "", raw_input: "", created_by: auth.userId, phase_status: "drafting_requirements" })
          .select("id")
          .single();
        if (specErr || !created) return refuse(`Failed to create specification: ${specErr?.message ?? "unknown error"}`);
        spec = created as { id: string };
      }
      const derivationId = crypto.randomUUID();
      const promotedAt = new Date().toISOString();
      // AL.8: two promotions at once can pick the same next REQ number; the
      // unique index refuses the second, which takes the next number instead
      // (as create_requirement does), rather than failing its proposal.
      let req: unknown = null;
      let reqErr: { message: string; code?: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const requirementId = await nextRequirementId(supabase, spec.id);
        ({ data: req, error: reqErr } = await supabase
          .from("specification_requirements")
          .insert({
            specification_id: spec.id,
            requirement_id: requirementId,
            name: p.name ?? row.name,
            description: p.description ?? row.description,
            category: row.category,
            status: "pending",
            // The REQ owns its COPY of the slice from here on (R5).
            acceptance_criteria: slice.map((c) => ({ text: c.text, met: false, ...(c.verification ? { verification: c.verification } : {}) })),
            source: "ai-generated",
            confirmed: false,
            locked: false,
            metadata: {
              promotion: { candidateId: row.id, key: row.key, kind: row.kind, promotedAt, derivationId, criterionIds: slice.map((c) => c.id) },
              // 9.4 (one seam): an import-born candidate keeps the provenance
              // backfill_requirements used to write: the evidence that built it.
              ...(row.kind !== "outcome"
                ? { backfill: { candidateId: row.id, key: row.key, kind: row.kind, nodeId: row.node_id, evidence: row.evidence ?? {}, acceptedAt: promotedAt } }
                : {}),
            },
          })
          .select("id, requirement_id")
          .single());
        if (reqErr?.code !== "23505") break;
      }
      if (reqErr || !req) return refuse(`promote_candidate failed: ${reqErr?.message ?? "insert failed"}`);
      const created = req as { id: string; requirement_id: string };
      // Import-derived candidates carry their owning node — map it exactly
      // as backfill does. Ideation-born outcomes have none yet: mapping
      // happens later via map_requirement, never with a fabricated node.
      if (row.node_id) {
        await supabase.from("specification_mappings").insert({
          specification_id: spec.id,
          requirement_id: created.id,
          node_id: row.node_id,
          mapping_type: "implements",
          confidence: 0.6,
          notes: row.kind !== "outcome" ? `backfill_requirements: ${row.kind} candidate from repo-index evidence` : `promoted candidate ${row.key}`,
        });
      }
      // The derivation row IS the record (R5): slice, proposer, approver.
      const who = originOf(auth, origin);
      const { error: derErr } = await supabase.from("outcome_derivations").insert({
        id: derivationId,
        project_id: projectId,
        branch_id: row.branch_id,
        candidate_id: row.id,
        requirement_row_id: created.id,
        criteria_slice: slice,
        proposed_by_kind: who.proposedByKind,
        proposed_by_id: who.proposedById,
        via_proposal_id: who.viaProposalId,
        approved_by: auth.userId,
      });
      if (derErr) return refuse(`Requirement ${created.requirement_id} created but the derivation could not be recorded: ${derErr.message}`);
      // The first derivation freezes requirement_row_id; the candidate
      // stays PENDING — settle is a separate human act.
      if (!row.requirement_row_id) {
        const { error: markErr } = await supabase
          .from("requirement_candidates")
          .update({ requirement_row_id: created.id, updated_at: promotedAt })
          .eq("id", row.id);
        if (markErr) return refuse(`Requirement ${created.requirement_id} created but the candidate could not be linked: ${markErr.message}`);
      }
      // Sibling derivations relate — best effort, never fails the promote.
      for (const d of prior) {
        await supabase.from("specification_requirement_relations").insert({
          specification_id: spec.id,
          from_requirement_id: created.id,
          to_requirement_id: d.requirement_row_id,
          relation_type: "relates_to",
          source: who.proposedByKind === "human" ? "user" : "ai",
          notes: `derived from outcome ${row.key}`,
        });
      }
      const remaining = unclaimed.filter((c) => !slice.some((x) => x.id === c.id)).length;
      return ok({ candidateId: row.id, requirementId: created.requirement_id, rowId: created.id, derivationId, claimed: slice.length, remaining, derivations: prior.length + 1 });
    }
    case "attach_candidate": {
      // 9.3: attach to an EXISTING requirement. The terminal rules and the
      // claim rules are promote's; nothing is minted, the requirement's own
      // criteria are untouched, the derivation row is the record.
      const p = patch.payload;
      const row = await getCandidate(supabase, projectId, p.candidateId);
      if (!row) return refuse("Candidate not found in this project.");
      if (row.status === "dismissed") return refuse("Candidate is dismissed — dismissed is terminal; a refile is a new row.");
      if (row.status !== "pending") {
        return refuse(`Candidate is ${row.status} — a settled outcome derives no further. Refile a new outcome for new intent.`);
      }
      const spec = await resolveSpecForProject(supabase, projectId);
      if (!spec) return refuse("Project has no specification — promote first, or create a requirement to attach to.");
      const target = await resolveRequirementRow(supabase, spec.id, p.requirementId);
      if (!target) return refuse(`Requirement not found: ${p.requirementId}. list_requirements serves the ids.`);
      // doctrine 6 (v3x): a lock refuses every write, attach included. The
      // database refuses too; this names the door before any insert is tried.
      if (target.locked) return refuse(lockedRefusal(target.requirement_id));
      // Candidates are branch-scoped, requirements are spec-scoped: the
      // outcome must live on the project's primary branch.
      const primary = await getPrimaryBranch(supabase, projectId, "id, name, is_primary") as { id: string; name: string } | null;
      if (!primary || primary.id !== row.branch_id) {
        return refuse(`Attach across branches is refused: "${row.name}" lives on another branch and requirements belong to the project's primary branch${primary ? ` (${primary.name})` : ""}. Attach from an outcome on the primary branch.`);
      }
      const { data: priorRows } = await supabase
        .from("outcome_derivations")
        .select("id, requirement_row_id, criteria_slice")
        .eq("candidate_id", row.id);
      const prior = (priorRows ?? []) as DerivationRow[];
      // Idempotent: the link already stands (UNIQUE(candidate_id, requirement_row_id)).
      if (prior.some((d) => d.requirement_row_id === target.id)) {
        return ok({ candidateId: row.id, requirementId: target.requirement_id, rowId: target.id, alreadyExists: true, derivations: prior.length });
      }
      const reqRefOf = new Map<string, string>();
      if (prior.length > 0) {
        const { data: reqs } = await supabase
          .from("specification_requirements")
          .select("id, requirement_id")
          .in("id", prior.map((d) => d.requirement_row_id));
        for (const r of (reqs ?? []) as Array<{ id: string; requirement_id: string }>) reqRefOf.set(r.id, r.requirement_id);
      }
      const claimedBy = new Map<string, string>();
      for (const d of prior) {
        for (const c of d.criteria_slice ?? []) claimedBy.set(criterionIdOf(c), reqRefOf.get(d.requirement_row_id) ?? d.requirement_row_id);
      }
      const all = identifiedFromRow(row.criteria);
      // The slice this attach claims: every unclaimed criterion by default;
      // an outcome with none still attaches (it is the requirement's "why").
      let slice = all.filter((c) => !claimedBy.has(c.id));
      if (p.criteriaIds && p.criteriaIds.length > 0) {
        slice = [];
        for (const id of p.criteriaIds) {
          const c = all.find((x) => x.id === id);
          if (!c) return refuse(`Criterion "${id}" is not on "${row.name}" — read the outcome's current criteria (each carries its id) and re-submit.`);
          const holder = claimedBy.get(id);
          if (holder) return refuse(`Criterion "${c.text}" is already derived into ${holder} — choose unclaimed criteria, or draft new ones on the outcome.`);
          slice.push(c);
        }
      }
      const who = originOf(auth, origin);
      const derivationId = crypto.randomUUID();
      const attachedAt = new Date().toISOString();
      const { error: derErr } = await supabase.from("outcome_derivations").insert({
        id: derivationId,
        project_id: projectId,
        branch_id: row.branch_id,
        candidate_id: row.id,
        requirement_row_id: target.id,
        criteria_slice: slice,
        proposed_by_kind: who.proposedByKind,
        proposed_by_id: who.proposedById,
        via_proposal_id: who.viaProposalId,
        approved_by: auth.userId,
      });
      if (derErr) {
        if (derErr.code === "23505") {
          return ok({ candidateId: row.id, requirementId: target.requirement_id, rowId: target.id, alreadyExists: true, derivations: prior.length });
        }
        return refuse(`attach_candidate failed: ${derErr.message}`);
      }
      // The first derivation freezes requirement_row_id; the outcome stays PENDING.
      if (!row.requirement_row_id) {
        const { error: markErr } = await supabase
          .from("requirement_candidates")
          .update({ requirement_row_id: target.id, updated_at: attachedAt })
          .eq("id", row.id);
        if (markErr) return refuse(`Attached to ${target.requirement_id} but the candidate could not be linked: ${markErr.message}`);
      }
      // Sibling derivations relate — best effort, never fails the attach.
      for (const d of prior) {
        await supabase.from("specification_requirement_relations").insert({
          specification_id: spec.id,
          from_requirement_id: target.id,
          to_requirement_id: d.requirement_row_id,
          relation_type: "relates_to",
          source: who.proposedByKind === "human" ? "user" : "ai",
          notes: `derived from outcome ${row.key}`,
        });
      }
      return ok({ candidateId: row.id, requirementId: target.requirement_id, rowId: target.id, derivationId, claimed: slice.length, alreadyExists: false, derivations: prior.length + 1 });
    }
    case "settle_candidate": {
      const row = await getCandidate(supabase, projectId, patch.payload.candidateId);
      if (!row) return refuse("Candidate not found in this project.");
      if (row.status !== "pending") {
        return refuse(`Candidate is already ${row.status} — ${row.status === "dismissed" ? "dismissed is terminal" : "settled is settled"}; a refile is a new row.`);
      }
      const { data: derived } = await supabase
        .from("outcome_derivations")
        .select("id")
        .eq("candidate_id", row.id);
      const n = ((derived ?? []) as unknown[]).length;
      if (n === 0) {
        return refuse(`"${row.name}" has derived nothing yet — settle means "fully covered": promote at least one criteria slice first, or dismiss the outcome.`);
      }
      const { data: settled, error } = await supabase
        .from("requirement_candidates")
        .update({ status: "accepted", decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id");
      if (error) return refuse(`settle_candidate failed: ${error.message}`);
      if (Array.isArray(settled) && settled.length === 0) return refuse(DECIDED_MEANWHILE(row.name));
      return ok({ candidateId: row.id, status: "accepted", derivations: n });
    }

    // ── workflow kind: the Ideation lane tables ─────────────────────────────
    case "upsert_workflow": {
      const p = patch.payload;
      // AA.2: an intent makes the lane a change; the imported lane is never retyped.
      const kind = p.intent ? "change" : p.kind;
      if (p.id) {
        const changes: Record<string, unknown> = { name: p.name, updated_at: new Date().toISOString() };
        if (p.color !== undefined) changes.color = p.color;
        if (p.ownerLabel !== undefined) changes.owner_label = p.ownerLabel;
        if (p.contributors !== undefined) changes.contributors = p.contributors;
        if (p.sortOrder !== undefined) changes.sort_order = p.sortOrder;
        if (kind !== undefined) changes.kind = kind;
        const { data, error } = await supabase
          .from("workflows")
          .update(changes)
          .eq("id", p.id)
          .eq("project_id", projectId)
          .neq("kind", "imported")
          .select("id")
          .maybeSingle();
        if (error) return refuse(`upsert_workflow failed: ${error.message}`);
        if (!data) return refuse("Workflow not found in this project (the imported lane is the system's and is not edited here).");
        return ok({ workflowId: p.id, updated: true });
      }
      // 9.6: a lane is keyed by its name (UNIQUE project_id, name): naming an
      // existing lane updates it instead of failing the accept.
      const { data: sameName } = await supabase
        .from("workflows").select("id, name, kind").eq("project_id", projectId).eq("name", p.name).maybeSingle();
      if (sameName) {
        const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (p.color !== undefined) changes.color = p.color;
        if (p.ownerLabel !== undefined) changes.owner_label = p.ownerLabel;
        if (p.contributors !== undefined) changes.contributors = p.contributors;
        if (p.sortOrder !== undefined) changes.sort_order = p.sortOrder;
        if (kind !== undefined && (sameName as { kind?: string }).kind !== "imported") changes.kind = kind;
        const { error: updErr } = await supabase.from("workflows").update(changes).eq("id", (sameName as LaneRow).id);
        if (updErr) return refuse(`upsert_workflow failed: ${updErr.message}`);
        return ok({ workflowId: (sameName as LaneRow).id, existing: true });
      }
      const { data, error } = await supabase
        .from("workflows")
        .insert({
          project_id: projectId,
          name: p.name,
          color: p.color ?? null,
          owner_label: p.ownerLabel ?? null,
          contributors: p.contributors ?? [],
          sort_order: p.sortOrder ?? 0,
          created_by: auth.userId,
          ...(kind ? { kind } : {}),
        })
        .select("id")
        .single();
      if (error || !data) return refuse(`upsert_workflow failed: ${error?.message ?? "insert failed"}`);
      const laneId = (data as { id: string }).id;
      // AA.2: a new change starts with its intent's steps, What works today first.
      const template = p.intent ? changeSteps(p.intent) : [];
      if (template.length > 0) {
        const { error: stepErr } = await supabase
          .from("workflow_steps")
          .insert(template.map((name, i) => ({ workflow_id: laneId, name, sort_order: i })));
        if (stepErr) return refuse(`upsert_workflow created the change but not its steps: ${stepErr.message}`);
      }
      return ok({ workflowId: laneId, created: true, ...(kind ? { kind } : {}), ...(template.length > 0 ? { steps: template } : {}) });
    }
    case "delete_workflow": {
      const { data, error } = await supabase
        .from("workflows")
        .delete()
        .eq("id", patch.payload.id)
        .eq("project_id", projectId)
        .select("id")
        .maybeSingle();
      if (error) return refuse(`delete_workflow failed: ${error.message}`);
      if (!data) return refuse("Workflow not found in this project.");
      return ok({ workflowId: patch.payload.id, deleted: true });
    }
    case "upsert_workflow_step": {
      const p = patch.payload;
      // Project guard: the step's lane must belong to this project — by id,
      // or (9.6) by the name an earlier upsert_workflow in this proposal gave it.
      const resolvedLane = await resolveLaneRef(supabase, projectId, { workflowId: p.workflowId, workflowName: p.workflowName });
      if ("error" in resolvedLane) return refuse(resolvedLane.error);
      const laneId = resolvedLane.lane.id;
      if (p.id) {
        const { data, error } = await supabase
          .from("workflow_steps")
          .update({ name: p.name, ...(p.sortOrder !== undefined ? { sort_order: p.sortOrder } : {}), updated_at: new Date().toISOString() })
          .eq("id", p.id)
          .eq("workflow_id", laneId)
          .select("id")
          .maybeSingle();
        if (error) return refuse(`upsert_workflow_step failed: ${error.message}`);
        if (!data) return refuse("Step not found on that workflow.");
        return ok({ stepId: p.id, updated: true });
      }
      const { data, error } = await supabase
        .from("workflow_steps")
        .insert({ workflow_id: laneId, name: p.name, sort_order: p.sortOrder ?? 0 })
        .select("id")
        .single();
      if (error || !data) return refuse(`upsert_workflow_step failed: ${error?.message ?? "insert failed"}`);
      return ok({ stepId: (data as { id: string }).id, created: true });
    }
    case "delete_workflow_step": {
      // Guard through the lane: only steps of this project's workflows.
      const { data: step } = await supabase
        .from("workflow_steps")
        .select("id, workflow_id")
        .eq("id", patch.payload.id)
        .maybeSingle();
      if (!step) return refuse("Step not found.");
      const { data: wf } = await supabase
        .from("workflows")
        .select("id")
        .eq("id", (step as { workflow_id: string }).workflow_id)
        .eq("project_id", projectId)
        .maybeSingle();
      if (!wf) return refuse("Step does not belong to this project.");
      const { error } = await supabase.from("workflow_steps").delete().eq("id", patch.payload.id);
      return error ? refuse(`delete_workflow_step failed: ${error.message}`) : ok({ stepId: patch.payload.id, deleted: true });
    }
    case "set_outcome_step_maps": {
      const p = patch.payload;
      const row = await getCandidate(supabase, projectId, p.candidateId);
      if (!row) return refuse("Candidate not found in this project.");
      // This case already loaded the row and then never looked at its status,
      // so it was the one candidate op that let a DECIDED outcome be remapped —
      // rewriting the record of where that work was actually filed. The v3t
      // trigger is the guarantee; this is the message worth reading.
      if (row.status !== "pending") {
        return refuse(`Candidate is ${row.status} — decided outcomes keep the steps they were filed on. Create a new outcome to map different steps.`);
      }
      const { error: delErr } = await supabase
        .from("outcome_step_maps")
        .delete()
        .eq("candidate_id", p.candidateId);
      if (delErr) return refuse(`set_outcome_step_maps failed: ${delErr.message}`);
      const stepIds = [...new Set(p.stepIds)];
      if (stepIds.length > 0) {
        const { error: insErr } = await supabase
          .from("outcome_step_maps")
          .insert(stepIds.map((stepId) => ({ branch_id: p.branchId, candidate_id: p.candidateId, step_id: stepId })));
        if (insErr) return refuse(`set_outcome_step_maps failed: ${insErr.message}`);
      }
      return ok({ candidateId: p.candidateId, steps: stepIds.length });
    }
  }
}

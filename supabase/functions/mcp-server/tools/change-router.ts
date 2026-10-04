// V3 P2 (task 2.4): the change router — the control-plane merge. One module
// decides how a mutating call travels: REFUSE (level 0, ask-first),
// PROPOSE (level 1, the change becomes a pending ai_proposals row), or
// APPLY-AND-RECORD (level 2, the write happens now and a merged proposal
// row makes the approvals queue the complete "what agents changed or
// proposed" surface). Routing is policy, not entity type — the defect the
// three-planes analysis named.
//
// SHIPPED DEFAULTS MIRROR TODAY'S EFFECTIVE ROUTING, per pinned semantics —
// not the design's recommended posture. Requirements/Candidates/Tasks/Tests
// auto-apply (their tools write directly today), Architecture proposes
// (propose_patches is the only graph path today), Code is pinned 0
// (NodeSpec never writes code; the DB CHECK enforces it too). An owner
// TIGHTENS lanes in the Autonomy overlay; deploy day changes nothing for
// any connected agent.
//
// Doctrine enforced here, at every level:
// - NEVER_AUTO_APPLY ops (promotion) route to PROPOSE even at level 2 —
//   promotion is a human act.
// - propose_patches itself is never routed: explicitly proposing IS the
//   ask, legal at every level.
// - Evidence is not change: report_test_results and task ticks never come
//   through this router.
// - Recording is additive: a failed audit row NEVER fails the edit.
//
// Lane note (the pinned "lane" collision): policy keys are the six TIERS.
// workflow-kind ops (lanes/steps/step-maps) are ideation structure and
// route under the CANDIDATES tier — the design calls it "the ideation
// lane" — never a seventh key.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { resolveProjectByName, actorLabel, credentialOf } from "../shared.ts";
import {
  SpecPatchOperationSchema,
  type SpecPatchOperation,
  patchKindOf,
  NEVER_AUTO_APPLY,
} from "../../_shared/spec-patch-schema.ts";
import { checkSpecPreconditions } from "./spec-preconditions.ts";
import { resolveSpecForProject, lockedRefusal } from "./requirements.ts";
import { bindHoldsToProposal } from "./checkouts.ts";

export type AutomationLane = "candidates" | "requirements" | "architecture" | "tasks" | "tests" | "code";
export type AutomationLevel = 0 | 1 | 2;
export type ChangeRoute = "refuse" | "propose" | "apply";

export const AUTOMATION_LANES: readonly AutomationLane[] = [
  "candidates", "requirements", "architecture", "tasks", "tests", "code",
];

/** Today's effective routing — the no-regression default (pinned semantics:
 *  shipped defaults ≠ recommended settings). */
export const EFFECTIVE_DEFAULTS: Readonly<Record<AutomationLane, AutomationLevel>> = {
  candidates: 2,    // candidate writes are direct today (backfill decide, this lane)
  requirements: 2,  // update/create/delete_requirement write directly today
  architecture: 1,  // propose_patches is the ONLY graph path today
  tasks: 2,         // generate_task_docs applies on request today
  tests: 2,         // update_test_case writes directly today
  code: 0,          // NodeSpec never writes code — pinned here AND by DB CHECK
};

/** Normalize a stored automation_policy jsonb (values arrive as '0'|'1'|'2'
 *  strings or numbers; anything unreadable falls back to the default; the
 *  code lane can never be raised, whatever the row says). */
export function resolveAutomationPolicy(raw: unknown): Record<AutomationLane, AutomationLevel> {
  const src = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const out = {} as Record<AutomationLane, AutomationLevel>;
  for (const lane of AUTOMATION_LANES) {
    const v = src[lane];
    const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
    out[lane] = (n === 0 || n === 1 || n === 2) ? (n as AutomationLevel) : EFFECTIVE_DEFAULTS[lane];
  }
  out.code = 0;
  return out;
}

/** Which tier lane governs a patch type. Rows, not branches. */
export function laneOfPatchType(type: string): AutomationLane {
  switch (patchKindOf(type)) {
    case "requirement": return "requirements";
    case "outcome": return "candidates";
    case "workflow": return "candidates"; // ideation structure rides the ideation lane
    default: return "architecture";
  }
}

/** 9.6: a MIXED batch takes the strictest lane its ops touch — the level
 *  that would govern a direct write of the strictest op. propose_patches
 *  reports it and files regardless (proposing IS the ask); the direct tools
 *  route op by op. */
export function strictestRoute(policy: Record<AutomationLane, AutomationLevel>, patchTypes: readonly string[]): { route: ChangeRoute; lane: AutomationLane | null } {
  const rank: Record<ChangeRoute, number> = { refuse: 0, propose: 1, apply: 2 };
  let worst: { route: ChangeRoute; lane: AutomationLane | null } = { route: "apply", lane: null };
  for (const t of patchTypes) {
    const route = routeChange(policy, t);
    if (worst.lane === null || rank[route] < rank[worst.route]) worst = { route, lane: laneOfPatchType(t) };
  }
  return worst;
}

/** The routing decision. Promotion proposes even at auto. */
export function routeChange(policy: Record<AutomationLane, AutomationLevel>, patchType: string): ChangeRoute {
  const level = policy[laneOfPatchType(patchType)];
  if (level === 0) return "refuse";
  if (level === 1) return "propose";
  return NEVER_AUTO_APPLY.has(patchType) ? "propose" : "apply";
}

export async function loadAutomationPolicy(
  supabase: SupabaseClient,
  projectId: string
): Promise<Record<AutomationLane, AutomationLevel>> {
  const { data } = await supabase
    .from("projects")
    .select("automation_policy")
    .eq("id", projectId)
    .maybeSingle();
  return resolveAutomationPolicy((data as { automation_policy?: unknown } | null)?.automation_policy);
}

const LANE_LABEL: Record<AutomationLane, string> = {
  candidates: "Candidates", requirements: "Requirements", architecture: "Architecture",
  tasks: "Tasks", tests: "Tests", code: "Code",
};

async function primaryBranchId(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  const { data } = await supabase
    .from("branches")
    .select("id, is_primary")
    .eq("project_id", projectId);
  const rows = (data ?? []) as Array<{ id: string; is_primary: boolean | null }>;
  return (rows.find((b) => b.is_primary) ?? rows[0])?.id ?? null;
}

async function mintRun(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  branchId: string,
  externalAgent: string,
  promptHash: string
): Promise<string | null> {
  const aiRunId = crypto.randomUUID();
  const { error } = await supabase.from("ai_runs").insert({
    id: aiRunId,
    project_id: projectId,
    branch_id: branchId,
    model: externalAgent,
    prompt_hash: promptHash,
    status: "completed",
    completed_at: new Date().toISOString(),
    metadata: { source: "mcp-server", externalAgent, authMethod: auth.authMethod, apiKeyId: auth.keyId ?? null, credential: credentialOf(auth).delegate, credentialLabel: credentialOf(auth).label },
  });
  return error ? null : aiRunId;
}

/** File one spec patch as a PENDING proposal (the level-1 lane, and the
 *  destination NEVER_AUTO_APPLY forces at level 2). */
export async function fileSpecProposal(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  patch: SpecPatchOperation,
  explanation: string,
  externalAgent: string
): Promise<{ proposalId: string } | { error: string }> {
  const branchId = await primaryBranchId(supabase, projectId);
  if (!branchId) return { error: "This project has no branch, so there is nothing to attach the proposal to." };
  const aiRunId = await mintRun(supabase, auth, projectId, branchId, externalAgent, "mcp-spec-proposal");
  if (!aiRunId) return { error: "Failed to record the proposing run." };
  const proposalId = crypto.randomUUID();
  const { error } = await supabase.from("ai_proposals").insert({
    id: proposalId,
    ai_run_id: aiRunId,
    source_branch_id: branchId,
    proposal_branch_id: branchId,
    status: "pending",
    patches: [{ patch, explanation, status: "pending" }],
    validation_expectations: [],
    metadata: {
      source: "mcp-server", plane: "spec", externalAgent,
      authMethod: auth.authMethod, apiKeyId: auth.keyId ?? null,
      // O.2: the proven credential, by name, on the row the history shows.
      credential: credentialOf(auth).delegate, credentialLabel: credentialOf(auth).label,
    },
  });
  if (error) return { error: `Failed to file the proposal: ${error.message}` };
  // 4b.3: the filing credential's advisory hold on the target binds to it.
  await bindHoldsToProposal(supabase, auth, projectId, proposalId, [patch]);
  return { proposalId };
}

/** Record a level-2 auto-applied change as a MERGED proposal row, so the
 *  approvals queue is the complete audit surface. Additive: any failure
 *  here returns null and never fails the edit it records. */
export async function recordAutoApplied(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  patch: SpecPatchOperation,
  explanation: string,
  externalAgent: string
): Promise<string | null> {
  try {
    const branchId = await primaryBranchId(supabase, projectId);
    if (!branchId) return null;
    const aiRunId = await mintRun(supabase, auth, projectId, branchId, externalAgent, "mcp-auto-applied");
    if (!aiRunId) return null;
    const proposalId = crypto.randomUUID();
    const now = new Date().toISOString();
    const { error } = await supabase.from("ai_proposals").insert({
      id: proposalId,
      ai_run_id: aiRunId,
      source_branch_id: branchId,
      proposal_branch_id: branchId,
      status: "merged",
      patches: [{ patch, explanation, status: "accepted" }],
      validation_expectations: [],
      reviewed_at: now,
      merged_at: now,
      metadata: {
        source: "mcp-server", plane: "spec", auto: true, externalAgent,
        authMethod: auth.authMethod, apiKeyId: auth.keyId ?? null,
        credential: credentialOf(auth).delegate, credentialLabel: credentialOf(auth).label,
      },
    });
    return error ? null : proposalId;
  } catch (_err) {
    return null;
  }
}

/** Build a well-formed spec patch from tool args (metadata enriched the
 *  same way propose_patches does). Throws only on programmer error — the
 *  per-tool builders below construct payloads the union accepts. */
export function buildSpecPatch(
  type: SpecPatchOperation["type"],
  payload: Record<string, unknown>,
  summary: string,
  externalAgent: string,
  preconditions?: unknown
): SpecPatchOperation {
  const candidate = {
    type,
    metadata: {
      id: crypto.randomUUID(),
      actorType: "ai" as const,
      actorId: externalAgent,
      summary,
      timestamp: new Date().toISOString(),
      // V3 (task 2.7): caller-supplied preconditions ride the patch metadata
      // (the same seat the graph vocabulary gives them) and are validated by
      // the schema parse below — malformed ones fail the build, and the
      // router REFUSES rather than falling through unguarded.
      ...(preconditions !== undefined ? { preconditions } : {}),
    },
    payload,
  };
  const parsed = SpecPatchOperationSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`buildSpecPatch(${type}): ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** Per-tool translation: which patch a direct tool call is equivalent to.
 *  Returns null when the args cannot express a patch (the handler will
 *  surface its own argument errors on the apply path). */
export function toolCallToSpecPatch(
  toolName: string,
  args: Record<string, unknown>,
  externalAgent: string
): SpecPatchOperation | null {
  try {
    switch (toolName) {
      case "create_requirement":
        return buildSpecPatch("create_requirement", {
          name: args.name, description: args.description,
          ...(args.category !== undefined ? { category: args.category } : {}),
          ...(args.acceptance_criteria !== undefined ? { criteria: args.acceptance_criteria } : {}),
          ...(args.section !== undefined ? { section: args.section } : {}),
        } as Record<string, unknown>, `Create requirement "${args.name}"`, externalAgent);
      case "update_requirement": {
        const changes: Record<string, unknown> = {};
        for (const [from, to] of [["name", "name"], ["description", "description"], ["category", "category"], ["status", "status"], ["acceptance_criteria", "criteria"], ["archived", "archived"]] as const) {
          if (args[from] !== undefined) changes[to] = args[from];
        }
        return buildSpecPatch("update_requirement", { requirementId: args.requirement_id, changes },
          `Update requirement ${args.requirement_id}`, externalAgent, args.preconditions);
      }
      case "delete_requirement":
        return buildSpecPatch("delete_requirement", {
          requirementId: args.requirement_id,
          ...(args.force !== undefined ? { force: args.force } : {}),
        }, `Delete requirement ${args.requirement_id}`, externalAgent, args.preconditions);
      case "update_vision":
        return buildSpecPatch("update_vision", { vision: args.vision }, "Update the project vision", externalAgent);
      case "map_requirement":
        return buildSpecPatch("map_requirement", {
          requirementId: args.requirement_id,
          nodeIds: args.node_ids,
          ...(args.mode !== undefined ? { mode: args.mode } : {}),
          ...(args.mapping_type !== undefined ? { mappingType: args.mapping_type } : {}),
          ...(args.branch_id !== undefined ? { branchId: args.branch_id } : {}),
        }, `Map requirement ${args.requirement_id}`, externalAgent);
      case "relate_requirements":
        return buildSpecPatch("relate_requirements", {
          fromRequirementId: args.from_requirement_id,
          toRequirementId: args.to_requirement_id,
          relationType: args.relation_type,
          ...(args.mode !== undefined ? { mode: args.mode } : {}),
          ...(args.notes !== undefined ? { notes: args.notes } : {}),
        }, `Relate ${args.from_requirement_id} → ${args.to_requirement_id}`, externalAgent);
      default:
        return null;
    }
  } catch (_err) {
    // Malformed args — let the apply path's handler name the field errors.
    return null;
  }
}

/** V3 2.4: which existing requirement rows a direct op is about (by REQ
 *  ref or row uuid). Creates and vision edits name none. */
export function requirementRefsOf(patch: SpecPatchOperation): string[] {
  const p = patch.payload as Record<string, unknown>;
  switch (patch.type) {
    case "update_requirement": case "delete_requirement": case "map_requirement":
      return typeof p.requirementId === "string" ? [p.requirementId] : [];
    case "relate_requirements":
      return [p.fromRequirementId, p.toRequirementId].filter((x): x is string => typeof x === "string");
    default:
      return [];
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** AL.8: what a spec patch changes that already exists, as keys
 *  ("req:<ref>", "outcome:<id>", "constraint:<id>", "workflow:<id>",
 *  "step:<id>"). Creates name nothing: two new things never collide. Pure. */
export function specTargetsOf(patch: { type?: unknown; payload?: unknown }): string[] {
  const p = (patch.payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const keys: string[] = [];
  const add = (kind: string, v: unknown) => { const x = str(v); if (x) keys.push(`${kind}:${x}`); };
  switch (patch.type) {
    case "update_requirement": case "delete_requirement": case "map_requirement": add("req", p.requirementId); break;
    case "relate_requirements": add("req", p.fromRequirementId); add("req", p.toRequirementId); break;
    case "update_candidate": case "dismiss_candidate": case "promote_candidate": case "settle_candidate": case "set_outcome_step_maps":
      add("outcome", p.candidateId); break;
    case "attach_candidate": add("outcome", p.candidateId); add("req", p.requirementId); break;
    case "update_constraint": case "delete_constraint": add("constraint", p.constraintId); break;
    case "upsert_workflow": case "delete_workflow": add("workflow", p.id); break;
    case "upsert_workflow_step": case "delete_workflow_step": add("step", p.id); break;
  }
  return keys;
}

/** AL.11: what a file patch holds while it waits: the file it changes or
 *  removes, and for a new task document the node it documents (a node has
 *  one task document, so two first generations are one thing). */
export function artifactTargetsOf(patch: { type?: unknown; payload?: unknown }): string[] {
  const p = (patch.payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  switch (patch.type) {
    case "update_artifact": case "remove_artifact": case "delete_artifact": {
      const id = str(p.id);
      return id ? [`artifact:${id}`] : [];
    }
    case "add_artifact": {
      const node = str(p.nodeId);
      return p.kind === "task" && node ? [`taskdoc:${node}`] : [];
    }
  }
  return [];
}

const heldKeysOf = (patch: { type?: unknown; payload?: unknown }) => [...specTargetsOf(patch), ...artifactTargetsOf(patch)];

const filedBy = (m: Record<string, unknown> | null) =>
  typeof m?.credentialLabel === "string" && m.credentialLabel ? m.credentialLabel
    : typeof m?.externalAgent === "string" && m.externalAgent ? m.externalAgent
    : typeof m?.requestedBy === "string" && m.requestedBy ? m.requestedBy : "another agent";

/** AL.8/AL.11: the project's waiting proposals and what each holds. Null when
 *  the read fails. */
export async function waitingProposals(
  supabase: SupabaseClient,
  projectId: string,
  except?: string | null,
): Promise<Array<{ id: string; by: string; keys: string[] }> | null> {
  const { data: rows, error } = await supabase
    .from("ai_proposals")
    .select("id, patches, metadata, branches!ai_proposals_source_branch_id_fkey!inner(project_id)")
    .eq("status", "pending")
    .eq("branches.project_id", projectId);
  if (error) return null;
  return ((rows ?? []) as Array<{ id: string; patches: unknown; metadata: Record<string, unknown> | null }>)
    .filter((r) => r.id !== except)
    .map((r) => ({
      id: r.id,
      by: filedBy(r.metadata),
      keys: (Array.isArray(r.patches) ? r.patches : []).flatMap((e) => heldKeysOf(((e ?? {}) as { patch?: { type?: unknown; payload?: unknown } }).patch ?? {})),
    }));
}

/** AL.8 (owner 2026-10-01: agents working at the same time must not
 *  collide, "like our checkout feature"). A waiting proposal holds what it
 *  changes: a second one on the same requirement, outcome, constraint,
 *  workflow or step is refused at filing, naming the first and who filed
 *  it, instead of both waiting and the later accept landing half. The
 *  holder decides by deciding: once the first is accepted or rejected the
 *  thing is free. A requirement named by REQ code and by row id is one
 *  thing. Null when nothing overlaps (or the read fails: a filing is never
 *  blocked by a failed read). */
export async function pendingOverlap(
  supabase: SupabaseClient,
  projectId: string,
  patches: ReadonlyArray<{ type?: unknown; payload?: unknown }>,
  except?: string | null,
): Promise<{ proposalId: string; by: string; key: string; type: string } | null> {
  const mine = new Map<string, string>();
  for (const p of patches) for (const k of heldKeysOf(p)) mine.set(k, String(p.type));
  if (mine.size === 0) return null;
  try {
    const theirs = await waitingProposals(supabase, projectId, except);
    if (!theirs || theirs.length === 0) return null;
    // a requirement by code and by row id is one thing
    const reqRefs = new Set<string>();
    for (const k of [...mine.keys(), ...theirs.flatMap((t) => t.keys)]) if (k.startsWith("req:")) reqRefs.add(k.slice(4));
    const canon = new Map<string, string>();
    if (reqRefs.size > 0) {
      const spec = await resolveSpecForProject(supabase, projectId);
      if (spec) {
        const ids = [...reqRefs].filter((r) => UUID_RE.test(r));
        const codes = [...reqRefs].filter((r) => !UUID_RE.test(r));
        const found: Array<{ id: string; requirement_id: string }> = [];
        if (ids.length > 0) found.push(...(((await supabase.from("specification_requirements").select("id, requirement_id").eq("specification_id", spec.id).in("id", ids)).data ?? []) as Array<{ id: string; requirement_id: string }>));
        if (codes.length > 0) found.push(...(((await supabase.from("specification_requirements").select("id, requirement_id").eq("specification_id", spec.id).in("requirement_id", codes)).data ?? []) as Array<{ id: string; requirement_id: string }>));
        for (const f of found) { canon.set(`req:${f.id}`, `req:${f.requirement_id}`); canon.set(`req:${f.requirement_id}`, `req:${f.requirement_id}`); }
      }
    }
    const c = (k: string) => canon.get(k) ?? k;
    const wanted = new Map([...mine].map(([k, t]) => [c(k), t]));
    for (const r of theirs) {
      for (const k of r.keys) {
        const type = wanted.get(c(k));
        if (!type) continue;
        return { proposalId: r.id, by: r.by, key: c(k), type };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** AL.8: the refusal for an overlap, in words an agent can act on. */
export function overlapRefusal(o: { proposalId: string; by: string; key: string; type: string }): string {
  const [kind, ref] = [o.key.slice(0, o.key.indexOf(":")), o.key.slice(o.key.indexOf(":") + 1)];
  const what = kind === "req" ? ref
    : kind === "artifact" ? `the file ${ref}`
    : kind === "taskdoc" ? `the task document of node ${ref}`
    : `${kind === "outcome" ? "the outcome" : `the ${kind}`} ${ref}`;
  return `Proposal ${o.proposalId} (from ${o.by}) is already waiting on ${what}, so this ${o.type} was not filed: ` +
    `two waiting proposals on one thing would leave the later one half-applied. Wait until it is decided (get_proposal_status), ` +
    `then re-read and file against what it left. If it is yours and out of date, reject it with resolve_proposal first.`;
}

async function loadRequirementRow(
  supabase: SupabaseClient,
  specId: string,
  ref: string,
): Promise<Record<string, unknown> | null> {
  const column = UUID_RE.test(ref) ? "id" : "requirement_id";
  const { data } = await supabase
    .from("specification_requirements")
    .select("*")
    .eq("specification_id", specId)
    .eq(column, ref)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

/** The transport-layer wrap: route a direct mutating tool call by the
 *  project's automation policy. Handlers stay untouched — this is the one
 *  integration point. */
export async function routeToolCall(
  supabase: SupabaseClient,
  auth: AuthResult,
  toolName: string,
  args: Record<string, unknown>,
  handler: () => Promise<MCPResponse>
): Promise<MCPResponse> {
  // Resolve the project ONLY to read its policy; the handler re-resolves
  // and re-authorizes exactly as it always has.
  const resolved = await resolveProjectByName(supabase, auth.userId, String(args.project_id ?? ""));
  if ("error" in resolved) return resolved.error;
  const projectId = resolved.project.id;

  // O.2: the nickname when given, else the proven credential. Never "unknown agent".
  const externalAgent = actorLabel(auth, args.external_agent);
  const patch = toolCallToSpecPatch(toolName, args, externalAgent);
  // No patch representation (unroutable args): fall through to the handler,
  // which owns the argument errors — UNLESS the call carried preconditions.
  // A caller who asked for a guard must never run unguarded: malformed
  // preconditions (they ride the patch build and fail its schema parse)
  // refuse loudly instead of silently applying.
  if (!patch) {
    if (args.preconditions !== undefined) {
      return {
        success: false,
        error: "preconditions could not be validated — each entry needs {type: hash_match|value_exists|value_equals, path, expected?}. " +
          "Nothing was changed; fix the preconditions (and any named argument errors) and retry.",
      };
    }
    return handler();
  }

  const policy = await loadAutomationPolicy(supabase, projectId);
  const route = routeChange(policy, patch.type);
  const lane = laneOfPatchType(patch.type);

  if (route === "refuse") {
    return {
      success: false,
      error: `The ${LANE_LABEL[lane]} lane is set to "Ask first" — agent-initiated changes are refused at this level. ` +
        `Discuss the change with the user (they can apply it in the app, or raise the lane in Autonomy settings). ` +
        `An explicit proposal via propose_patches remains open — proposing is the ask.`,
    };
  }

  // V3 2.4 (2026-09-19): the ladder. The lane's level governs OPEN rows. A
  // row the user CONFIRMED always comes back as a proposal, whatever the
  // lane says (level 0 refused above). A LOCKED row refuses here, in the
  // lock's own words, before the handler: the database refuses too, so this
  // spares the agent a 500 and says what to do. The rows are resolved once
  // and handed to the precondition check, so nothing is read twice.
  const refs = requirementRefsOf(patch);
  let spec: { id: string } | null = null;
  const targets: Array<{ ref: string; row: Record<string, unknown> | null }> = [];
  if (refs.length > 0) {
    spec = await resolveSpecForProject(supabase, projectId);
    if (spec) {
      for (const ref of refs) targets.push({ ref, row: await loadRequirementRow(supabase, spec.id, ref) });
    }
  }
  for (const t of targets) {
    if (t.row && t.row.locked === true) {
      return { success: false, error: lockedRefusal(String(t.row.requirement_id ?? t.ref)) };
    }
  }
  // AL.8: a waiting proposal holds what it changes, at either route.
  const overlap = await pendingOverlap(supabase, projectId, [patch]);
  if (overlap) return { success: false, error: overlapRefusal(overlap) };
  const confirmedTarget = targets.find((t) => t.row?.confirmed === true);
  const effectiveRoute: ChangeRoute = route === "apply" && confirmedTarget ? "propose" : route;

  if (effectiveRoute === "propose") {
    const filed = await fileSpecProposal(supabase, auth, projectId, patch, patch.metadata.summary, externalAgent);
    if ("error" in filed) return { success: false, error: filed.error };
    const confirmedRef = confirmedTarget ? String(confirmedTarget.row?.requirement_id ?? confirmedTarget.ref) : null;
    return {
      success: true,
      data: {
        routed: "proposed",
        proposalId: filed.proposalId,
        lane,
        ...(route === "apply" && confirmedRef ? { reason: "confirmed", requirement: confirmedRef } : {}),
        message: (route === "apply" && confirmedRef
          ? `${confirmedRef} is confirmed, so this change is filed as proposal ${filed.proposalId} for the user to decide ` +
            `(the ${LANE_LABEL[lane]} lane would apply an open requirement directly). Nothing was changed. `
          : `The ${LANE_LABEL[lane]} lane is set to "Propose" — nothing was changed. ` +
            `Your change is filed as proposal ${filed.proposalId}; `) +
          `The user accepts it in the approvals queue (or over MCP via resolve_proposal). Poll get_proposal_status.`,
      },
    };
  }

  // V3 (task 2.7): the level-2 lane checks preconditions BEFORE the handler
  // writes — an overlapping auto-apply fails loudly against the current row,
  // never last-write-wins. (The propose lane stores them instead; the accept
  // lane re-checks at merge through applySpecPatch.)
  const preloaded = targets.length === 1 && (patch.type === "update_requirement" || patch.type === "delete_requirement")
    ? { spec, row: targets[0].row }
    : undefined;
  const pre = await checkSpecPreconditions(supabase, projectId, patch, preloaded);
  if (!pre.ok) return { success: false, error: pre.error };

  const result = await handler();
  if (result.success) {
    const recordedProposalId = await recordAutoApplied(supabase, auth, projectId, patch, patch.metadata.summary, externalAgent);
    if (recordedProposalId) {
      return { ...result, data: { ...(result.data as Record<string, unknown> ?? {}), routed: "applied", recordedProposalId } };
    }
  }
  return result;
}

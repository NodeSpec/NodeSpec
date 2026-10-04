// S1-3: the `proposals` tool bucket — propose_patches (the primary external-agent write
// path) and get_proposal_status. Moved verbatim from index.ts (no logic change). A leaf
// bucket: it depends only on shared helpers + the patch schema, and the git bucket's
// resolve_change depends on THIS module (not the other way round). Structural supabase
// param + type-only SupabaseClient so it's offline-testable.
import { conflictsSince, describeConflicts, laterPatchFromRow, patchTargets, type PatchRowLike } from '../../_shared/patch-targets.ts';
import { compileIntents, STRUCTURE_INTENT_KINDS, type CompiledIntent } from '../../_shared/intent-compiler.ts';
import { citedTableFiles, type ExplodeContext } from '../../_shared/explode.ts';
import { loadExplodeContext, requireNodeLeases } from './explode-context.ts';
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PatchOperationSchema, UPDATE_CHANGE_KEYS, UNKNOWN_CHANGE_KEY_HINTS } from "../../_shared/patch-schema.ts";
import { SpecPatchOperationSchema, SPEC_PATCH_KIND } from "../../_shared/spec-patch-schema.ts";
import { loadAutomationPolicy, strictestRoute, pendingOverlap, overlapRefusal, requirementRefsOf } from "./change-router.ts";
import { acceptSpecBatch, type ProposalRow } from "./approvals.ts";
import { resolveSpecForProject } from "./requirements.ts";
import { bindHoldsToProposal, nodeLeasesOfOthers } from './checkouts.ts';
import { getEffectiveTier, getProjectTier } from "../../_shared/deployment.ts";
import { isWorkflowOp, requireWorkflows, workflowsAllowed, OUTCOME_ON_PROJECT_NOTE, isConstraintOp, requireConstraints } from "../../_shared/workflow-gate.ts";
import { citeVision, OFF_VISION_NOTE } from "../../_shared/chain.ts";
import { loadCatalogs } from "../../_shared/catalog-loader.ts";
import type { CatalogData } from "../../_shared/catalog-loader.ts";
import { PLACEMENT_RULE, holdingKind, placementFor, placementRefusal } from "../../_shared/role-registry.ts";
import { loadGraphData } from "../../_shared/mcp-context-assembly.ts";
import { constraintsCarried, judgeProposal, type ProposalJudgement } from "../../_shared/node-constraints.ts";
import { SIGNAL_ASKS } from "../../_shared/constraint-rules.ts";
import { normalizeProposedNode, type NodeNormalizationNote } from "../../_shared/catalog-node-normalization.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, resolveBranchId, UUID_RE, memberRoleFor, roleAtLeast, actorLabel, credentialOf, canApprove } from "../shared.ts";

// C1 (docs/WORK_LOOP_PLAN.md): content-by-reference. When the AI has already
// pushed the file bodies to git, an add_artifact may omit `content` and pass
// `content_ref` (the pushed commit sha, or a branch name) — the server stamps
// this sentinel plus payload.metadata.contentSource, and the CLIENT pulls the
// real bytes from git at accept time (the B2 rule: only the state's owner
// writes the graph; the fetch itself still runs server-side via git-pull).
// The sentinel is server-stamped ONLY — a caller submitting it verbatim is
// refused, so it can never smuggle un-refed "content" past review.
export const GIT_CONTENT_SENTINEL = "__nodespec_git_content__";

// C2 (docs/WORK_LOOP_PLAN.md): chunked proposal sessions. A session is an
// ai_proposals row in the EXISTING 'staged' status (the import lane's
// invisible-until-finalized convention — ChangesPanel lists 'pending' only)
// carrying metadata.chunkedSession as the marker that separates it from
// import drafts. Expiry is a sliding window enforced LAZILY (append/finalize
// past the deadline discards the draft and says so) plus opportunistic
// cleanup on session start — no cron, replay-safe, no migration.
export const CHUNKED_SESSION_TTL_MS = 30 * 60 * 1000;
export const CHUNKED_SESSION_MAX_PATCHES = 5000;

// C3 (docs/WORK_LOOP_PLAN.md): honest partial reporting. A JSON payload that
// PARSES is indistinguishable from a complete one, so truncation is fought on
// three fronts: a per-call ceiling that names the chunked continuation path
// instead of choking downstream, a caller-declared expected_patch_count that
// makes a short delivery fail LOUDLY before anything is created, and every
// response echoing exactly what arrived so a fragment is never silently
// accepted as complete.
export const SINGLE_CALL_MAX_PATCHES = 500;

/**
 * Pre-validation transform for one patch: stamp content-by-reference on
 * add_artifact payloads that omit `content` when the call carries a
 * content_ref. Pure; malformed patches pass through untouched so the main
 * validator reports them with its richer message.
 */
export function applyContentByReference(
  patch: unknown,
  contentRef: string | undefined,
  index: number,
): { patch: unknown; stamped: boolean } | { error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { patch, stamped: false };
  const p = patch as Record<string, unknown>;
  const payload = (p.payload && typeof p.payload === 'object' && !Array.isArray(p.payload))
    ? p.payload as Record<string, unknown>
    : null;
  if (payload?.content === GIT_CONTENT_SENTINEL) {
    return {
      error: `patch[${index}]: content "${GIT_CONTENT_SENTINEL}" is a reserved sentinel the server stamps itself — ` +
        `omit content and pass content_ref instead`,
    };
  }
  if (p.type !== 'add_artifact' || !payload || payload.content !== undefined || !contentRef) {
    return { patch, stamped: false };
  }
  const priorMeta = (payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata))
    ? payload.metadata as Record<string, unknown>
    : {};
  return {
    patch: {
      ...p,
      payload: {
        ...payload,
        content: GIT_CONTENT_SENTINEL,
        metadata: { ...priorMeta, contentSource: { type: 'git', ref: contentRef } },
      },
    },
    stamped: true,
  };
}

const VALID_PATCH_TYPES = new Set([
  'add_node', 'update_node', 'remove_node', 'delete_node',
  'add_edge', 'update_edge', 'remove_edge', 'delete_edge',
  'add_contract', 'update_contract', 'remove_contract', 'delete_contract',
  'add_artifact', 'update_artifact', 'remove_artifact', 'delete_artifact',
  'update_graph_metadata', 'create_node_from_template', 'instantiate_contract_stub',
  'attach_artifact_stub', 'mark_entity_complete', 'add_node_group',
  'update_node_group', 'remove_node_group', 'set_edge_direction',
  'set_edge_criticality',
]);

/**
 * The id sets a batch's references are checked against: a branch's current
 * snapshot, from the graph_reference_ids RPC (migration 20260919100000).
 */
export interface GraphReferenceIds {
  nodes: string[];
  contracts: string[];
}

/** One unresolved reference, named down to the field. */
export interface ReferenceGap {
  index: number;
  patchType: string;
  field: string;
  missingId: string;
  entity: 'contract' | 'node';
}

/**
 * Patch types that bring a contract into existence, and the path to its id.
 * create_node_from_template carries an ARRAY of contracts plus the node.
 */
const CONTRACT_CREATORS = new Set(['add_contract', 'instantiate_contract_stub']);
const NODE_CREATORS = new Set(['add_node']);

/**
 * Referential validation across a whole batch (2026-09-18).
 *
 * PatchOperationSchema validates one patch in isolation: it asks that
 * contractId be a uuid, not that the uuid means anything. On 'OpenMed Import'
 * an explode shipped 7 add_edge patches referencing two contract ids that no
 * add_contract ever created; the batch was accepted, the approve-time engine
 * raised CONTRACT_NOT_FOUND, and the edges were silently discarded while the
 * 7 remove_edge patches that retired the old edges applied. The canvas lost
 * 7 edges and every patch stayed in graph_patches.
 *
 * A reference resolves if the id already exists in the branch's snapshot OR
 * some patch in this batch creates it. Order inside the batch does NOT matter:
 * applyPatches sorts by dependency phase (add_contract at 10, edges later), so
 * a contract declared after the edge that uses it still lands first.
 *
 * Removals are honored in submitted order — a batch that removes a contract
 * and then adds an edge against it is a genuine gap, and saying so is the
 * point of this check.
 *
 * Pure and exported for tests; takes plain arrays so it needs no graph.
 */
export function findBatchReferenceGaps(
  patches: Array<Record<string, unknown>>,
  existing: GraphReferenceIds,
): ReferenceGap[] {
  const contracts = new Set(existing.contracts);
  const nodes = new Set(existing.nodes);

  // Pass 1: everything this batch brings into existence, regardless of position.
  for (const p of patches) {
    const type = typeof p.type === 'string' ? p.type : '';
    const payload = (p.payload && typeof p.payload === 'object' && !Array.isArray(p.payload))
      ? p.payload as Record<string, unknown>
      : {};
    const id = typeof payload.id === 'string' ? payload.id : null;

    if (CONTRACT_CREATORS.has(type) && id) contracts.add(id);
    if (NODE_CREATORS.has(type) && id) nodes.add(id);
    if (type === 'create_node_from_template') {
      const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId : null;
      if (nodeId) nodes.add(nodeId);
      if (Array.isArray(payload.contracts)) {
        for (const c of payload.contracts) {
          const cid = (c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string')
            ? (c as { id: string }).id
            : null;
          if (cid) contracts.add(cid);
        }
      }
    }
  }

  // Pass 2: check each reference, applying removals as they are submitted.
  const gaps: ReferenceGap[] = [];
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    const type = typeof p.type === 'string' ? p.type : '';
    const payload = (p.payload && typeof p.payload === 'object' && !Array.isArray(p.payload))
      ? p.payload as Record<string, unknown>
      : {};

    const needContract = (field: string) => {
      const v = payload[field];
      if (typeof v !== 'string' || v.length === 0) return;
      if (!contracts.has(v)) {
        gaps.push({ index: i, patchType: type, field, missingId: v, entity: 'contract' });
      }
    };
    const needNode = (field: string) => {
      const v = payload[field];
      if (typeof v !== 'string' || v.length === 0) return;
      if (!nodes.has(v)) {
        gaps.push({ index: i, patchType: type, field, missingId: v, entity: 'node' });
      }
    };

    if (type === 'add_edge') {
      needContract('contractId');
      needNode('source');
      needNode('target');
    } else if (type === 'update_edge') {
      const changes = (payload.changes && typeof payload.changes === 'object' && !Array.isArray(payload.changes))
        ? payload.changes as Record<string, unknown>
        : null;
      if (changes && typeof changes.contractId === 'string' && !contracts.has(changes.contractId)) {
        gaps.push({ index: i, patchType: type, field: 'changes.contractId', missingId: changes.contractId, entity: 'contract' });
      }
      // AA.0: moving an endpoint (explode_node, an agent's re-wire) must name a
      // node that exists or that this batch creates.
      for (const end of ['source', 'target'] as const) {
        const v = changes?.[end];
        if (typeof v === 'string' && v.length > 0 && !nodes.has(v)) {
          gaps.push({ index: i, patchType: type, field: `changes.${end}`, missingId: v, entity: 'node' });
        }
      }
    }

    if (type === 'remove_contract' || type === 'delete_contract') {
      const id = typeof payload.id === 'string' ? payload.id : null;
      if (id) contracts.delete(id);
    }
    if (type === 'remove_node' || type === 'delete_node') {
      const id = typeof payload.id === 'string' ? payload.id : null;
      if (id) nodes.delete(id);
    }
  }
  return gaps;
}

/** The refusal text for a set of gaps — names every field and the fix. */
export function describeBatchReferenceGaps(gaps: ReferenceGap[]): string {
  const lines = gaps.slice(0, 10).map((g) =>
    `patch[${g.index}] (${g.patchType}): ${g.field} = ${g.missingId} — no such ${g.entity} exists on this branch ` +
    `and no patch in this batch creates it`
  );
  const contractGaps = gaps.filter((g) => g.entity === 'contract').length;
  return `Unresolved references (${gaps.length}): ${lines.join('; ')}` +
    (gaps.length > 10 ? ` … and ${gaps.length - 10} more` : '') +
    `. No proposal was created. ` +
    (contractGaps > 0
      ? `Every edge needs a contract that EXISTS: include an add_contract patch for each new contract in this same batch ` +
        `(order does not matter, contracts are applied first), or reference a contract id already on the branch — ` +
        `get_project_context lists them. `
      : '') +
    `Patches that reference entities which do not exist are refused here rather than dropped at approve time; ` +
    `an approval never discards a patch.`;
}

// Conform a proposed patch's node type/technology to the catalog (IP-safe, server-side,
// deterministic — the external AI proposes catalog-blind). Applies to the three ops that
// embed a node: add_node (payload), create_node_from_template (payload.node), and update_node
// (payload.changes, only when a `type` is being changed — a technology-only change lacks the
// existing node's role to validate against and is left as-is, a documented minor gap).
// Returns a payload copy + the change notes; a null catalog (load failure) is a no-op.
function applyCatalogNormalization(
  p: Record<string, unknown>,
  catalogs: CatalogData | null,
): { payload: unknown; notes: NodeNormalizationNote[] } {
  if (!catalogs) return { payload: p.payload, notes: [] };
  const notes: NodeNormalizationNote[] = [];

  const conformFullNode = (node: Record<string, unknown>): Record<string, unknown> => {
    const out = { ...node };
    const n = normalizeProposedNode(catalogs, out.type as string | undefined, out.technology as string | undefined);
    out.type = n.type;
    if (n.technology !== undefined) out.technology = n.technology;
    else delete out.technology;
    if (out.status === undefined) out.status = 'draft';
    notes.push(...n.notes);
    return out;
  };

  if (p.type === 'add_node' && p.payload && typeof p.payload === 'object') {
    return { payload: conformFullNode(p.payload as Record<string, unknown>), notes };
  }
  if (p.type === 'create_node_from_template' && p.payload && typeof p.payload === 'object') {
    const payload = { ...(p.payload as Record<string, unknown>) };
    if (payload.node && typeof payload.node === 'object') payload.node = conformFullNode(payload.node as Record<string, unknown>);
    return { payload, notes };
  }
  if (p.type === 'update_node' && p.payload && typeof p.payload === 'object') {
    const payload = { ...(p.payload as Record<string, unknown>) };
    const changes = { ...((payload.changes ?? {}) as Record<string, unknown>) };
    if (changes.type !== undefined) {
      const n = normalizeProposedNode(catalogs, changes.type as string | undefined, changes.technology as string | undefined);
      changes.type = n.type;
      if (changes.technology !== undefined && n.technology !== undefined) changes.technology = n.technology;
      notes.push(...n.notes);
    }
    payload.changes = changes;
    return { payload, notes };
  }
  return { payload: p.payload, notes: [] };
}

/** AG.13: a node's ports and an edge's port ids, left out of what is filed.
 *  Returns the payload without them and what was dropped, or null. */
export function withoutPortFields(type: string, payload: unknown): { payload: unknown; dropped: string | null } {
  if (!payload || typeof payload !== 'object') return { payload, dropped: null };
  const out = { ...(payload as Record<string, unknown>) };
  if (type === 'add_node' && 'ports' in out) {
    delete out.ports;
    return { payload: out, dropped: 'node ports' };
  }
  if (type === 'create_node_from_template' && out.node && typeof out.node === 'object' && 'ports' in (out.node as Record<string, unknown>)) {
    const node = { ...(out.node as Record<string, unknown>) };
    delete node.ports;
    return { payload: { ...out, node }, dropped: 'node ports' };
  }
  if (type === 'add_edge' && ('sourcePortId' in out || 'targetPortId' in out)) {
    delete out.sourcePortId;
    delete out.targetPortId;
    return { payload: out, dropped: 'edge port ids' };
  }
  return { payload, dropped: null };
}

// Validate a single incoming patch against the canonical NodeSpec shape and
// enrich its metadata so it satisfies PatchOperationSchema when applied in the UI.
export function validateAndNormalizeProposalPatch(
  patch: unknown,
  index: number,
  explanation: string,
  externalAgent: string,
  catalogs: CatalogData | null = null,
): { patch: Record<string, unknown>; notes: NodeNormalizationNote[] } | { error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { error: `patch[${index}]: must be an object` };
  }
  const p = patch as Record<string, unknown>;

  // AG.13 (owner 2026-09-28): ports came out of the model. The port ops are
  // refused by name, pointing at the edge; the patch engine still replays the
  // ones already stored.
  const portOp = p.type === 'add_port' || p.type === 'update_port' || p.type === 'delete_port' || p.type === 'connect_ports'
    || (p.type === 'mark_entity_complete' && (p.payload as { entityType?: unknown } | undefined)?.entityType === 'port');
  if (portOp) {
    return {
      error: `patch[${index}] (${p.type}): ports are not part of NodeSpec's model. An edge joins two nodes and its contract says ` +
        `what the connection is: send add_contract then add_edge (source, target, contractId), or the connect_nodes intent. ` +
        `No proposal was created.`,
    };
  }

  // V3 (task 2.4): the proposal lane carries BOTH planes — graph ops below,
  // spec-plane ops (requirement | outcome | workflow kinds) via their own union.
  const isSpecOp = typeof p.type === 'string' && Object.prototype.hasOwnProperty.call(SPEC_PATCH_KIND, p.type);
  if (typeof p.type !== 'string' || (!VALID_PATCH_TYPES.has(p.type) && !isSpecOp)) {
    return {
      error: `patch[${index}]: invalid or missing 'type'. Expected a NodeSpec patch operation type (graph: add_node, add_edge, add_contract, add_artifact, ...; spec-plane: update_requirement, create_candidate, upsert_workflow, ...).`,
    };
  }

  if (!p.payload || typeof p.payload !== 'object' || Array.isArray(p.payload)) {
    return { error: `patch[${index}] (${p.type}): missing 'payload' object` };
  }

  const rawMeta = (p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata))
    ? p.metadata as Record<string, unknown>
    : {};

  const metadata: Record<string, unknown> = {
    ...rawMeta,
    id: typeof rawMeta.id === 'string' && UUID_RE.test(rawMeta.id) ? rawMeta.id : crypto.randomUUID(),
    actorType: rawMeta.actorType === 'human' || rawMeta.actorType === 'ai' || rawMeta.actorType === 'system'
      ? rawMeta.actorType
      : 'ai',
    actorId: typeof rawMeta.actorId === 'string' ? rawMeta.actorId : externalAgent,
    summary: typeof rawMeta.summary === 'string' && rawMeta.summary.length > 0 ? rawMeta.summary : explanation,
    timestamp: typeof rawMeta.timestamp === 'string' ? rawMeta.timestamp : new Date().toISOString(),
  };

  // Spec-plane ops validate against THEIR union and skip the graph-only
  // lanes (catalog normalization, change-key allowlists) entirely.
  if (isSpecOp) {
    const specParsed = SpecPatchOperationSchema.safeParse({ ...p, metadata });
    if (!specParsed.success) {
      const issues = specParsed.error.issues
        .slice(0, 10)
        .map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`)
        .join('; ');
      return {
        error: `patch[${index}] (${p.type}): payload does not match the spec-plane patch schema — ${issues}. ` +
          `Fix the named fields and resubmit; no proposal was created.`,
      };
    }
    return { patch: specParsed.data as unknown as Record<string, unknown>, notes: [] };
  }

  // IP-safe catalog normalization (2026-07-15): conform node type/technology to the catalog
  // server-side BEFORE schema validation, so the external AI can propose catalog-blind and the
  // stored patch renders correctly. Deterministic; the catalog never crosses the AI boundary.
  const { payload: catalogPayload, notes } = applyCatalogNormalization(p, catalogs);
  // AG.13: ports and edge port ids an agent sends are left out, and the
  // response says so; an update that sets them is refused below (they are not
  // among UPDATE_CHANGE_KEYS).
  const { payload: normalizedPayload, dropped } = withoutPortFields(p.type, catalogPayload);
  if (dropped) notes.push({ field: 'ports', from: dropped, to: '(none)', reason: 'ports are not part of the model; an edge joins the nodes themselves' });

  // P0-10: validate against the SAME schema the app enforces at approve time. Without
  // this, a malformed payload is accepted here and dies later in the approve dialog as
  // an unactionable "Patch does not match schema" — the agent must hear the field-level
  // errors NOW so it can self-correct.
  const parsed = PatchOperationSchema.safeParse({ ...p, payload: normalizedPayload, metadata });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`)
      .join('; ');
    return {
      error: `patch[${index}] (${p.type}): payload does not match the NodeSpec patch schema — ${issues}. ` +
        `Fix the named fields and resubmit; no proposal was created.`,
    };
  }

  // Dogfood find 2026-09-02 (#1): Zod strips unknown keys SILENTLY, so an
  // update whose changes carry a field the schema does not know (the live
  // case: update_node changes.configuration) validated clean and reported
  // merged while the data evaporated. The MCP lane refuses unknown change
  // keys by name — silent data loss reported as success is the one failure
  // shape this server must never have.
  const knownKeys = UPDATE_CHANGE_KEYS[p.type as string];
  const rawChanges = (normalizedPayload as { changes?: unknown })?.changes;
  if (knownKeys && rawChanges && typeof rawChanges === 'object' && !Array.isArray(rawChanges)) {
    const unknown = Object.keys(rawChanges as Record<string, unknown>).filter((k) => !knownKeys.has(k));
    if (unknown.length > 0) {
      const hints = unknown
        .map((k) => UNKNOWN_CHANGE_KEY_HINTS[k] ? `"${k}": ${UNKNOWN_CHANGE_KEY_HINTS[k]}` : null)
        .filter(Boolean);
      return {
        error: `patch[${index}] (${p.type}): unknown field(s) in changes: ${unknown.map((k) => `"${k}"`).join(', ')} — ` +
          `these would be dropped silently, so the patch is refused. Known fields: ${[...knownKeys].join(', ')}.` +
          (hints.length ? ` Hint — ${hints.join('; ')}.` : '') +
          ` No proposal was created.`,
      };
    }
  }

  return { patch: parsed.data as unknown as Record<string, unknown>, notes };
}

/** AA.5 (owner 2026-09-23): "if a node is leased, then it is locked." A
 *  graph change to a node someone else holds a fresh lease on (the node
 *  lease, or work inside it) is refused where it is filed, whole, naming each
 *  patch, the node, the holder and since when. Your own leases never lock you
 *  out. Edges count: a node's edges are its structure. An artifact update is
 *  traced to its node through the artifacts table. Spec ops are not graph
 *  structure and pass. Returns the refusal, or null. */
export async function refuseLeasedNodeTargets(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  patches: Array<Record<string, unknown>>,
  branchId?: string,
): Promise<string | null> {
  const graphPatches = patches.map((p, i) => ({ p, i })).filter(({ p }) => !(String(p.type) in SPEC_PATCH_KIND));
  if (graphPatches.length === 0) return null;
  // a failed read locks nothing here: the accept checks the leases again
  const { byNode } = await nodeLeasesOfOthers(supabase, auth, projectId);
  if (byNode.size === 0) return null;
  const others = [...byNode.values()];

  const artifactIds = graphPatches
    .filter(({ p }) => ['update_artifact', 'remove_artifact', 'delete_artifact'].includes(String(p.type)))
    .map(({ p }) => String(((p.payload ?? {}) as { id?: unknown }).id ?? ''))
    .filter((id) => UUID_RE.test(id));
  const nodeOfArtifact = new Map<string, string>();
  if (artifactIds.length > 0) {
    const { data: arts } = await supabase.from('artifacts').select('id, node_id').in('id', artifactIds);
    for (const a of (arts ?? []) as Array<{ id: string; node_id: string | null }>) if (a.node_id) nodeOfArtifact.set(a.id, a.node_id);
  }

  // AA.3: a box's node lease covers its parts. The graph is read only when
  // someone else holds a node lease.
  const boxOf = new Map<string, string>();
  const heldBoxes = new Set(others.filter((l) => l.level === 'node').map((l) => l.node_id!));
  if (heldBoxes.size > 0 && branchId) {
    try {
      const graph = (await loadGraphData(supabase, branchId)) as { nodes?: Record<string, { id: string; type?: string; parentId?: string | null }> } | null;
      const children = Object.values(graph?.nodes ?? {}).filter((n) => n.parentId && heldBoxes.has(n.parentId));
      if (children.length > 0) {
        const { data: roles } = await supabase.from('node_roles').select('id, capability_tags').in('id', [...new Set(children.map((n) => String(n.type)))]);
        const partRoles = new Set(((roles ?? []) as Array<{ id: string; capability_tags: string[] | null }>).filter((r) => (r.capability_tags ?? []).includes('part')).map((r) => r.id));
        for (const n of children) if (partRoles.has(String(n.type))) boxOf.set(n.id, n.parentId!);
      }
    } catch { /* no graph, no box cover: the direct leases above still hold */ }
  }

  const hits: string[] = [];
  for (const { p, i } of graphPatches) {
    const t = patchTargets(p);
    const nodes = [t.primary, ...t.touched, nodeOfArtifact.get(t.primary ?? '') ?? null].filter((x): x is string => !!x);
    const hit = nodes.find((n) => byNode.has(n));
    if (hit) {
      const l = byNode.get(hit)!;
      hits.push(`patch[${i}] ${String(p.type)} changes node ${hit}, ${l.level === 'node' ? 'leased' : 'where work is held'} by ${l.holder_label} since ${l.since}`);
      continue;
    }
    const part = nodes.find((n) => boxOf.has(n));
    if (!part) continue;
    const box = boxOf.get(part)!;
    const l = others.find((x) => x.level === 'node' && x.node_id === box)!;
    hits.push(`patch[${i}] ${String(p.type)} changes node ${part}, a part of node ${box}, which is leased by ${l.holder_label} since ${l.since} (a box's lease covers its parts)`);
  }
  if (hits.length === 0) return null;
  return `Leased node: ${hits.join('; ')}. A leased node is locked: its structure changes only through its holder. ` +
    `Wait for the lease to end, coordinate with the holder, or claim the node (checkout_task level node) once it is free. Nothing was created.`;
}

/** AA.3 and AG.12a (owner 2026-09-28: "Agent proposals should follow the same canvas
 *  rules"): a node placed under a parent (add_node with a parentId, update_node moving it,
 *  or update_node changing the type of a node that has one) must be one the parent may
 *  hold, by the check the canvas and import apply (canContainerAcceptChild: the parent's
 *  list or rule, one provider per chain, a platform only in a group, and the depth rule).
 *  The whole batch is refused, naming each patch and what its parent may hold. A placement
 *  that passes under a container gets its placementKind from how the container holds
 *  (hosts, contains or scopes), written onto the patch here so an agent never chooses it;
 *  each change is noted. Types come from the batch, else the branch graph, read only when
 *  a placement needs it. Returns the refusal, or null. */
export async function refusePlacementViolations(
  supabase: SupabaseClient,
  branchId: string,
  catalogs: CatalogData | null,
  patches: Array<Record<string, unknown>>,
  notes?: Array<{ patchIndex: number; field: string; from: string; to: string; reason: string }>,
): Promise<string | null> {
  if (!catalogs) return null;
  type Changes = { type?: string; parentId?: string | null; technology?: string; placementKind?: string | null };
  type NodePayload = { id?: string; type?: string; label?: string; technology?: string; parentId?: string; placementKind?: string; changes?: Changes };
  type Known = { type?: string; label?: string; technology?: string; parentId?: string | null };
  const batch = new Map<string, Known>();
  for (const p of patches) {
    const pl = (p.payload ?? {}) as NodePayload;
    if (p.type === 'add_node' && pl.id) batch.set(pl.id, { type: pl.type, label: pl.label, technology: pl.technology, parentId: pl.parentId });
  }
  const placements: Array<{ i: number; kind: string; id: string; parentId?: string; childType?: string; childTech?: string; target: { placementKind?: string | null } }> = [];
  patches.forEach((p, i) => {
    const pl = (p.payload ?? {}) as NodePayload;
    if (!pl.id) return;
    if (p.type === 'add_node' && pl.parentId) {
      placements.push({ i, kind: 'add_node', id: pl.id, parentId: pl.parentId, childType: pl.type, childTech: pl.technology, target: pl });
    }
    if (p.type === 'update_node' && pl.changes && (pl.changes.parentId || (pl.changes.type && pl.changes.parentId !== null))) {
      placements.push({
        i, kind: 'update_node', id: pl.id, parentId: pl.changes.parentId ?? undefined,
        childType: pl.changes.type ?? batch.get(pl.id)?.type, childTech: pl.changes.technology ?? batch.get(pl.id)?.technology, target: pl.changes,
      });
    }
  });
  if (placements.length === 0) return null;
  let graphNodes: Record<string, Known> = {};
  if (placements.some((pl) => !pl.parentId || !batch.has(pl.parentId) || !pl.childType)) {
    try {
      const graph = await loadGraphData(supabase, branchId);
      graphNodes = ((graph as { nodes?: Record<string, Known> } | null)?.nodes) ?? {};
    } catch { graphNodes = {}; }
  }
  const node = (id: string): Known | undefined => batch.get(id) ?? graphNodes[id];
  const name = (id: string) => (node(id)?.label ? `"${node(id)!.label}"` : id);
  const hits: string[] = [];
  for (const pl of placements) {
    // A type change keeps the node where it is: its parent comes from the graph.
    const parentId = pl.parentId ?? graphNodes[pl.id]?.parentId ?? undefined;
    if (!parentId) continue;
    const parentType = node(parentId)?.type;
    const childType = pl.childType ?? node(pl.id)?.type;
    if (!parentType || !childType) continue;
    const childTech = pl.childTech ?? graphNodes[pl.id]?.technology;
    const reason = placementRefusal(catalogs, parentType, childType, childTech, node(parentId)?.technology);
    if (reason) {
      hits.push(`patch[${pl.i}] ${pl.kind} places ${name(pl.id)} (${childType}) in ${name(parentId)} (${parentType}): ${reason}`);
      continue;
    }
    if (!catalogs.nodeRoles[parentType]?.is_container) continue;
    const placement = placementFor(catalogs, parentType, childType, childTech);
    const sent = pl.target.placementKind ?? null;
    if (sent === placement) continue;
    pl.target.placementKind = placement;
    notes?.push({
      patchIndex: pl.i, field: 'placementKind', from: sent ?? '(none)', to: placement,
      reason: `${name(pl.id)} sits in ${name(parentId)}, a ${parentType}, which ${holdingKind(catalogs, parentType) === 'runs' ? 'runs' : holdingKind(catalogs, parentType) === 'groups' ? 'groups' : 'places'} what it holds; the placement follows the parent, as on the canvas.`,
    });
  }
  if (hits.length === 0) return null;
  return `Placement refused: ${hits.join(' ')} ${PLACEMENT_RULE} Nothing was created.`;
}

/** AG.14 (owner 2026-09-28: "edges should not go to a host, place or group
 *  and go to the specific node contained within"): both ends of an edge are
 *  nodes whose type is not a container. An exploded node's box is a leaf (its
 *  type is a leaf type). The batch is refused whole, naming each edge and the
 *  nodes inside the container to connect instead. Types come from the batch,
 *  else the branch graph, read only when an edge needs it. Returns the
 *  refusal, or null. */
export async function refuseContainerEdgeEnds(
  supabase: SupabaseClient,
  branchId: string,
  catalogs: CatalogData | null,
  patches: Array<Record<string, unknown>>,
): Promise<string | null> {
  if (!catalogs) return null;
  type Pl = { id?: string; type?: string; label?: string; parentId?: string; source?: string; target?: string; changes?: { type?: string; parentId?: string; source?: string; target?: string } };
  const ends: Array<{ i: number; kind: string; source?: string; target?: string }> = [];
  patches.forEach((p, i) => {
    const pl = (p.payload ?? {}) as Pl;
    if (p.type === 'add_edge') ends.push({ i, kind: 'add_edge', source: pl.source, target: pl.target });
    if (p.type === 'update_edge' && (pl.changes?.source || pl.changes?.target)) {
      ends.push({ i, kind: 'update_edge', source: pl.changes?.source, target: pl.changes?.target });
    }
  });
  if (ends.length === 0) return null;
  const batch = new Map<string, { type?: string; label?: string; parentId?: string }>();
  for (const p of patches) {
    const pl = (p.payload ?? {}) as Pl;
    if (p.type === 'add_node' && pl.id) batch.set(pl.id, { type: pl.type, label: pl.label, parentId: pl.parentId });
  }
  const batchLeaf = (id: string | undefined) => {
    const t = id ? batch.get(id)?.type : undefined;
    return !!t && catalogs.nodeRoles[t]?.is_container !== true;
  };
  let graphNodes: Record<string, { type?: string; label?: string; parentId?: string }> = {};
  if (ends.some((e) => (e.source && !batchLeaf(e.source)) || (e.target && !batchLeaf(e.target)))) {
    try {
      const graph = await loadGraphData(supabase, branchId);
      graphNodes = ((graph as { nodes?: Record<string, { type?: string; label?: string; parentId?: string }> } | null)?.nodes) ?? {};
    } catch { graphNodes = {}; }
  }
  const node = (id: string) => batch.get(id) ?? graphNodes[id];
  const isContainer = (id: string) => {
    const t = node(id)?.type;
    return !!t && catalogs.nodeRoles[t]?.is_container === true;
  };
  const name = (id: string) => (node(id)?.label ? `"${node(id)!.label}"` : id);
  const inside = (id: string) => {
    const all = new Map([...Object.entries(graphNodes), ...batch.entries()]);
    return [...all.entries()].filter(([, n]) => n?.parentId === id).map(([cid]) => cid);
  };
  const hits: string[] = [];
  for (const e of ends) {
    for (const end of [e.source, e.target]) {
      if (!end || !isContainer(end)) continue;
      const children = inside(end);
      const leaves = children.filter((c) => !isContainer(c));
      const offer = leaves.length > 0
        ? `connect to the node inside it instead: ${leaves.slice(0, 8).map(name).join(', ')}${leaves.length > 8 ? ` and ${leaves.length - 8} more` : ''}`
        : children.length > 0
          ? `it holds only containers (${children.slice(0, 8).map(name).join(', ')}); connect to a node inside one of them`
          : 'it holds no node yet; add the node it runs or holds, then connect to that node';
      hits.push(`patch[${e.i}] ${e.kind} ends on ${name(end)}, a ${node(end)?.type} (a container): ${offer}.`);
    }
  }
  if (hits.length === 0) return null;
  return `Edge ends on a container: ${hits.join(' ')} An edge joins the nodes themselves; a host, a place or a group only holds them. Nothing was created.`;
}

/** V3 2.4 (2026-09-19): the graph plane's lock, enforced where the proposal
 *  is filed. project_specifications.locked_nodes was read only by the
 *  browser at accept, so an agent proposing against a locked node learned
 *  it when the user pressed accept. Now the batch is refused here, whole
 *  (never partial), naming each patch and node. Edges to a locked node stay
 *  allowed, as the app allows them: the lock protects the node, not its
 *  neighbourhood. Returns the refusal, or null when nothing is locked. */
export async function refuseLockedNodeTargets(
  supabase: SupabaseClient,
  projectId: string,
  patches: Array<Record<string, unknown>>,
): Promise<string | null> {
  const { data } = await supabase
    .from('project_specifications')
    .select('locked_nodes')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const raw = (data as { locked_nodes?: unknown } | null)?.locked_nodes;
  const locked = new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  if (locked.size === 0) return null;
  const hits: string[] = [];
  patches.forEach((p, i) => {
    const t = patchTargets(p);
    const edgeOp = p.type === 'add_edge';
    const hit = (t.primary && locked.has(t.primary)) ? t.primary
      : (!edgeOp ? t.touched.find((id) => locked.has(id)) ?? null : null);
    if (hit) hits.push(`patch[${i}] ${String(p.type)} targets node ${hit}`);
  });
  if (hits.length === 0) return null;
  return `Locked node: ${hits.join('; ')}. The user locked ${hits.length === 1 ? 'that node' : 'those nodes'} in Architecture ` +
    `(the Lock action on the node). Unlock it in the app, then retry; edges to a locked node are allowed, changes to it are not. ` +
    `No tool unlocks. Nothing was created.`;
}

const isSpecOpType = (t: unknown): boolean => typeof t === 'string' && Object.prototype.hasOwnProperty.call(SPEC_PATCH_KIND, t);

/** AL.6: the refusal for a batch that mixes the canvas plane with the spec
 *  plane, or null. A canvas change is reviewed on the canvas and a
 *  requirement, outcome, workflow or constraint change in Proposals, so a
 *  mixed batch could be accepted in neither. Pure. */
export function mixedPlanes(patches: ReadonlyArray<{ type?: unknown }>): string | null {
  const spec = [...new Set(patches.filter((p) => isSpecOpType(p.type)).map((p) => String(p.type)))];
  const canvas = [...new Set(patches.filter((p) => !isSpecOpType(p.type)).map((p) => String(p.type)))];
  if (spec.length === 0 || canvas.length === 0) return null;
  return `This batch mixes canvas changes (${canvas.join(', ')}) with requirement, outcome, workflow or constraint changes (${spec.join(', ')}). ` +
    'File them as two propose_patches calls: the canvas changes first (reviewed on the canvas), then the rest (Proposals), which may name what the first adds once it is accepted. Nothing was filed.';
}

/** AL.6 (owner 2026-10-01: "if I set autonomy to Auto it doesn't still hold
 *  a requirement/outcome/constraint proposal in waiting"). A proposal used
 *  to file and wait whatever the lanes said. Now, when every lane a batch of
 *  spec changes touches is at Auto (no promotion, settle, or changed or
 *  retired constraint among them: those stay the person's), no requirement
 *  it changes is confirmed, and the filing account may decide the project
 *  (its owner), it applies as it files, through the same accept a person's
 *  would run, and reads as applied in Proposals. Null when it waits. */
async function autoApplyIfAllowed(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  role: string | undefined,
  routing: { route: string } | null,
  row: ProposalRow,
): Promise<MCPResponse | null> {
  if (routing?.route !== 'apply') return null;
  const patches = (row.patches ?? []).map((e) => ((e ?? {}) as { patch?: { type?: unknown; payload?: unknown } }).patch ?? {});
  if (patches.length === 0 || !patches.every((p) => isSpecOpType(p.type))) return null;
  // the vision is the person's to confirm: a batch that sets it (the 9.6
  // context proposal among them) waits at every autonomy level
  if (patches.some((p) => p.type === 'update_vision')) return null;
  // the caller's own rights: a key that may only propose, or a member's agent, waits
  if (!checkScope(auth, 'write') || !role || !canApprove(role as never, auth.authMethod as never)) return null;
  // a confirmed requirement always waits for the person (as on a direct write)
  const refs = [...new Set(patches.flatMap((p) => requirementRefsOf(p as never)))];
  if (refs.length > 0) {
    const spec = await resolveSpecForProject(supabase, projectId);
    if (spec) {
      const ids = refs.filter((r) => UUID_RE.test(r)), codes = refs.filter((r) => !UUID_RE.test(r));
      const rows: Array<{ confirmed?: boolean }> = [];
      if (ids.length > 0) rows.push(...(((await supabase.from('specification_requirements').select('confirmed').eq('specification_id', spec.id).in('id', ids)).data ?? []) as Array<{ confirmed?: boolean }>));
      if (codes.length > 0) rows.push(...(((await supabase.from('specification_requirements').select('confirmed').eq('specification_id', spec.id).in('requirement_id', codes)).data ?? []) as Array<{ confirmed?: boolean }>));
      if (rows.some((r) => r.confirmed === true)) return null;
    }
  }
  const decided = await acceptSpecBatch(supabase, auth, projectId, row, { by: 'auto', note: null });
  const data = (decided.data ?? {}) as Record<string, unknown>;
  return {
    ...decided,
    data: {
      ...data,
      proposalId: row.id,
      routed: decided.success ? 'applied' : (data.status === 'partial' ? 'partial' : 'set aside'),
      message: decided.success
        ? `Every lane this batch touches is at Auto, so it applied as it filed (${patches.length} change${patches.length === 1 ? '' : 's'}); Proposals shows it as applied.`
        : String(decided.error ?? 'It did not apply.'),
    },
  };
}

export async function handleProposePatches(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id?: string; patches?: unknown[]; intents?: unknown[]; explanations?: string[]; external_agent?: string; content_ref?: string; proposal_id?: string; finalize?: boolean; expected_patch_count?: number; base_sequence?: number }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'propose')) {
    return { success: false, error: 'Insufficient permissions: propose scope required' };
  }

  // C2 (docs/WORK_LOOP_PLAN.md): chunked sessions. finalize:false starts a
  // STAGED session (invisible to review — the same staged convention the
  // import lane uses); proposal_id appends to it; finalize:true promotes it
  // to pending. A finalize-only call may omit patches entirely.
  const hasIntents = Array.isArray(args.intents) && args.intents.length > 0;
  const isFinalizeOnly = !!args.proposal_id && args.finalize === true && !hasIntents &&
    (args.patches === undefined || (Array.isArray(args.patches) && args.patches.length === 0));
  const ownPatches = args.patches ?? [];

  if (!args.project_id || (!isFinalizeOnly && !hasIntents && (!args.patches || !Array.isArray(args.patches)))) {
    return { success: false, error: 'project_id and a patches array (or an intents array) are required (branch_id is optional and defaults to the primary branch)' };
  }
  if (args.intents !== undefined && !Array.isArray(args.intents)) {
    return { success: false, error: 'intents must be an array of { kind, ... } objects' };
  }

  if (ownPatches.length === 0 && !hasIntents && !isFinalizeOnly) {
    return { success: false, error: 'patches array must contain at least one patch (or pass intents)' };
  }

  // V3 3.1 (2026-09-19): intents. The agent says what it wants in five
  // structured shapes; the server compiles them to the patches it would
  // otherwise hand-assemble, and those patches join the batch BEFORE
  // validation so catalog conformance and the reference check run
  // unchanged. The project and branch are resolved here first only when
  // intents are present (place_on_step needs the branch in its payload);
  // the resolution below is memoized so nothing is read twice.
  let resolvedProject: { id: string; name: string; role?: string } | null = null;
  let resolvedBranchId: string | null = null;
  // One lookup per call: the catalog read (AG.6c) and the project resolution share it.
  let projectLookup: Awaited<ReturnType<typeof resolveProjectByName>> | null = null;
  const lookupProject = async () => projectLookup ??= await resolveProjectByName(supabase, auth.userId, args.project_id);
  const ensureProjectAndBranch = async (): Promise<MCPResponse | null> => {
    if (resolvedProject) return null;
    const r = await lookupProject();
    if ('error' in r) return r.error;
    resolvedProject = r.project as { id: string; name: string; role?: string };
    resolvedBranchId = await resolveBranchId(supabase, resolvedProject.id, args.branch_id);
    if (!resolvedBranchId) return { success: false, error: 'No primary branch found for this project' };
    return null;
  };
  // Load the catalog once for the whole batch (server-side; never sent to the AI). A load
  // failure degrades to no normalization rather than failing the propose. Memoized: an
  // explode or collapse reads it before compiling (AA.3), the batch after.
  let catalogsRead = false;
  let catalogsMemo: CatalogData | null = null;
  const ensureCatalogs = async (): Promise<CatalogData | null> => {
    if (catalogsRead) return catalogsMemo;
    catalogsRead = true;
    try {
      // AG.6c: custom technology rows are read only inside this call's project. The
      // project may not be resolved yet (normalization runs first); look it up here
      // without refusing, and read no custom row at all when it cannot be named. A
      // refusal still comes from the resolution after validation, as before.
      const found = await lookupProject().catch(() => null);
      const project = found && !('error' in found) ? found.project as { id: string } : null;
      const loaded = await loadCatalogs(supabase, { projectIds: project ? [project.id] : [] });
      // An empty catalog (load failure, or a stack that returned no roles) disables
      // normalization cleanly rather than defaulting every node to the global generic.
      if (loaded && Object.keys(loaded.nodeRoles).length > 0) catalogsMemo = loaded;
    } catch (e) {
      console.warn('[propose_patches] catalog load failed; proceeding without node normalization:', e);
    }
    return catalogsMemo;
  };

  let compiledIntents: CompiledIntent[] = [];
  let compiledPatches: unknown[] = [];
  let compiledExplanations: string[] = [];
  let compiledOrigin: number[] = [];
  if (hasIntents) {
    const early = await ensureProjectAndBranch();
    if (early) return early;
    // AA.3: explode_node and collapse_node (split_node is explode's alias) compile
    // against the graph, the depth rule and the repo index, and need the node's lease.
    let explode: ExplodeContext | undefined;
    const structure = (args.intents as unknown[])
      .map((i) => (i && typeof i === 'object' && !Array.isArray(i) ? i as Record<string, unknown> : {}))
      .filter((i) => STRUCTURE_INTENT_KINDS.has(String(i.kind)));
    if (structure.length > 0) {
      const loaded = await loadExplodeContext(supabase, resolvedBranchId as unknown as string, structure.map((i) => String(i.nodeId ?? '')), await ensureCatalogs(), structure.flatMap(citedTableFiles));
      if (loaded) {
        const refusal = await requireNodeLeases(supabase, auth, (resolvedProject as unknown as { id: string }).id, structure
          .filter((i) => loaded.nodes[String(i.nodeId ?? '')])
          .map((i) => ({ nodeId: String(i.nodeId), label: loaded.nodes[String(i.nodeId)].label, kind: String(i.kind) })));
        if (refusal) return { success: false, error: refusal };
        explode = loaded;
      }
    }
    const compiled = compileIntents(args.intents, { branchId: resolvedBranchId as string, newId: () => crypto.randomUUID(), explode });
    if ('error' in compiled) return { success: false, error: `${compiled.error} Nothing was created.` };
    compiledIntents = compiled.intents;
    compiledPatches = compiled.patches;
    compiledExplanations = compiled.explanations;
    compiledOrigin = compiled.originOf;
  }
  const patches: unknown[] = [...compiledPatches, ...ownPatches];
  const explanationsAll: string[] = [...compiledExplanations, ...(args.explanations ?? [])];

  // C3: declared-intent truncation check — fail loudly BEFORE anything is
  // created, never accept a fragment as silently complete.
  if (args.expected_patch_count !== undefined) {
    if (!Number.isInteger(args.expected_patch_count) || args.expected_patch_count < 1) {
      return { success: false, error: 'expected_patch_count must be a positive integer' };
    }
    if (args.expected_patch_count !== ownPatches.length) {
      return {
        success: false,
        error: `Truncation detected: expected_patch_count declares ${args.expected_patch_count} patch(es) but ${ownPatches.length} arrived — ` +
          `nothing was created. Resend the full batch, or stream it as a chunked session ` +
          `(finalize: false to start, append with the returned proposal_id, finalize: true to submit).`,
      };
    }
  }

  // C3: per-call ceiling — a call this size should be a chunked session, and
  // the error names that path instead of choking downstream.
  if (patches.length > SINGLE_CALL_MAX_PATCHES) {
    return {
      success: false,
      error: `${patches.length} patches exceeds the ${SINGLE_CALL_MAX_PATCHES}-per-call limit — nothing was created. ` +
        `Stream a chunked session instead: finalize: false to start, append batches of up to ${SINGLE_CALL_MAX_PATCHES} ` +
        `with the returned proposal_id, then finalize: true (sessions hold up to ${CHUNKED_SESSION_MAX_PATCHES} patches).`,
    };
  }

  // C3: an explanations array that does not line up with patches is a cheap
  // truncation tell (a generation cut mid-stream closes arrays early) —
  // surfaced as a warning, never inferred away.
  const truncationWarnings: string[] = [];
  if (args.explanations !== undefined && ownPatches.length > 0 && args.explanations.length !== ownPatches.length) {
    truncationWarnings.push(
      `explanations has ${args.explanations.length} entr(ies) for ${ownPatches.length} patch(es) — if your call was cut ` +
        `short mid-generation, verify patchCountThisCall matches what you intended before the user accepts.`,
    );
  }

  // C1: content_ref is a git ref (commit sha preferred — it pins the bytes; a
  // branch name is accepted but moves). Shape-checked here so a typo fails the
  // call, not the user's accept click later.
  const contentRef = typeof args.content_ref === 'string' ? args.content_ref.trim() : undefined;
  if (args.content_ref !== undefined && (!contentRef || contentRef.length > 200 || /\s/.test(contentRef))) {
    return { success: false, error: 'content_ref must be a single git ref (commit sha or branch name) with no whitespace' };
  }

  // O.2: the nickname when given, else the proven credential (the key's name). Never 'external-mcp-agent'.
  const externalAgent = actorLabel(auth, args.external_agent);
  const cred = credentialOf(auth);

  const catalogs = await ensureCatalogs();
  // AA.3: what an explode or collapse leaves for the accept (the repo index follows
  // the files) and for the agent (a mapping it may want to move).
  const repoIndexMoves = compiledIntents.flatMap((c) => c.repoIndexMoves ?? []);
  const intentSuggestions = compiledIntents.flatMap((c) => c.suggestions ?? []);

  const validationErrors: string[] = [];
  const normalizedPatches: Record<string, unknown>[] = [];
  const normalizationNotes: Array<{ patchIndex: number; field: string; from: string; to: string; reason: string }> = [];
  let contentByReferenceCount = 0;
  for (let i = 0; i < patches.length; i++) {
    const explanation = explanationsAll[i] || 'No explanation provided';
    // C1: stamp content-by-reference before schema validation (the sentinel is
    // a plain string, so the stamped patch validates like any content-ful one).
    const prepared = applyContentByReference(patches[i], contentRef, i);
    if ('error' in prepared) {
      validationErrors.push(prepared.error);
      continue;
    }
    if (prepared.stamped) contentByReferenceCount++;
    const result = validateAndNormalizeProposalPatch(prepared.patch, i, explanation, externalAgent, catalogs);
    if ('error' in result) {
      validationErrors.push(result.error);
    } else {
      normalizedPatches.push(result.patch);
      for (const n of result.notes) normalizationNotes.push({ patchIndex: i, ...n });
    }
  }

  if (validationErrors.length > 0) {
    const named = validationErrors.map((e) => e.replace(/patch\[(\d+)\]/g, (m, n) => {
      const idx = Number(n);
      return idx < compiledPatches.length ? `intent[${compiledOrigin[idx]}] (${compiledIntents[compiledOrigin[idx]].kind}) compiled ${m}` : m;
    }));
    return {
      success: false,
      error: `Invalid patches (${named.length}): ${named.join('; ')}`,
    };
  }

  const late = await ensureProjectAndBranch();
  if (late) return late;
  const projectId = (resolvedProject as { id: string; name: string }).id;
  const projectRole = (resolvedProject as unknown as { role?: string } | null)?.role;
  // V3 3.2: branch_id is optional; the primary branch is the default.
  const branchId = resolvedBranchId as string;

  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', branchId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (!branch) {
    return { success: false, error: 'Branch not found' };
  }

  // AL.6: one plane per proposal. A canvas change is reviewed on the canvas
  // and a requirement, outcome, workflow or constraint change in Proposals;
  // a batch that mixes them could be accepted in neither place, so it is
  // refused here, naming both halves.
  const mixed = mixedPlanes(normalizedPatches);
  if (mixed) return { success: false, error: mixed };
  // AL.8: a waiting proposal holds what it changes.
  const overlap = await pendingOverlap(supabase, projectId, normalizedPatches, typeof args.proposal_id === 'string' ? args.proposal_id : null);
  if (overlap) return { success: false, error: `${overlapRefusal(overlap)} Nothing was filed.` };

  // P (2026-09-22): Workflows are Indie and above. Checked here, before
  // anything is filed, so the agent hears at once instead of when the user
  // accepts. A lane-shaping op refuses the whole batch by name (a batch is
  // never half-filed); an outcome that names a workflow still files, with a
  // warning saying it lands on the project. The apply path checks again for
  // a proposal accepted after a downgrade.
  // AC (owner 2026-09-24): every constraint op is refused the same way, by
  // name: constraints do not exist below Indie.
  const shapingIdx: number[] = [];
  const namedLaneIdx: number[] = [];
  const constraintIdx: number[] = [];
  normalizedPatches.forEach((np, i) => {
    if (isWorkflowOp(np.type)) shapingIdx.push(i);
    else if (isConstraintOp(np.type)) constraintIdx.push(i);
    else if (np.type === 'create_candidate') {
      const pl = (np.payload ?? {}) as { workflowId?: string; workflowName?: string };
      if (pl.workflowId || pl.workflowName?.trim()) namedLaneIdx.push(i);
    }
  });
  if (shapingIdx.length > 0 || namedLaneIdx.length > 0 || constraintIdx.length > 0) {
    let tier: Awaited<ReturnType<typeof getEffectiveTier>> = 'community';
    // Decision 1: the project's plan (its owner's), for everyone seated on it.
    try { tier = await getProjectTier(supabase, projectId, auth.userId, { role: (resolvedProject as { role?: string } | null)?.role }); } catch { /* fail closed */ }
    if (!workflowsAllowed(tier)) {
      const where = (i: number) => i < compiledPatches.length
        ? `intent[${compiledOrigin[i]}] ${compiledIntents[compiledOrigin[i]].kind}`
        : `patch[${i}] ${String(normalizedPatches[i].type)}`;
      if (shapingIdx.length > 0) {
        const gate = requireWorkflows(tier, `Shaping a workflow (${shapingIdx.map(where).join(', ')})`);
        if (!gate.ok) return { success: false, error: `${gate.error} Nothing was created.` };
      }
      if (constraintIdx.length > 0) {
        const gate = requireConstraints(tier, `Working with constraints (${constraintIdx.map(where).join(', ')})`);
        if (!gate.ok) return { success: false, error: `${gate.error} Nothing was created.` };
      }
      for (const i of namedLaneIdx) {
        const pl = normalizedPatches[i].payload as { workflowId?: string; workflowName?: string };
        truncationWarnings.push(`${where(i)}: ${OUTCOME_ON_PROJECT_NOTE(pl.workflowName?.trim() || String(pl.workflowId))}`);
      }
    }
  }

  // AA.1: an outcome's citations resolve before anything is filed, against
  // the vision as the batch leaves it (its own update_vision earlier in the
  // batch, else the stored one); the apply path resolves them again at
  // accept. A new outcome that cites nothing still files, with the note.
  {
    const whereAt = (i: number) => i < compiledPatches.length
      ? `intent[${compiledOrigin[i]}] ${compiledIntents[compiledOrigin[i]].kind}`
      : `patch[${i}] ${String(normalizedPatches[i].type)}`;
    const refsOf = (np: { type: unknown; payload?: unknown }): string[] | null => {
      const pl = (np.payload ?? {}) as { serves?: unknown; changes?: { serves?: unknown } };
      const refs = np.type === 'create_candidate' ? pl.serves : np.type === 'update_candidate' ? pl.changes?.serves : undefined;
      return Array.isArray(refs) ? refs.map(String) : null;
    };
    let stored: string | null = null;
    const citeErrors: string[] = [];
    for (let i = 0; i < normalizedPatches.length; i++) {
      const np = normalizedPatches[i] as { type: unknown; payload?: unknown };
      const refs = refsOf(np);
      if (!refs) {
        if (np.type === 'create_candidate') truncationWarnings.push(`${whereAt(i)}: ${OFF_VISION_NOTE}`);
        continue;
      }
      const prior = normalizedPatches.slice(0, i).filter((q) => q.type === 'update_vision').pop();
      let vision: string;
      if (prior) {
        vision = String((prior.payload as { vision?: string }).vision ?? '');
      } else {
        if (stored === null) {
          const { data: spec } = await supabase
            .from('project_specifications')
            .select('vision')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          stored = String((spec as { vision?: string | null } | null)?.vision ?? '');
        }
        vision = stored;
      }
      const cited = citeVision(String(np.type), refs, vision);
      if ('error' in cited) citeErrors.push(`${whereAt(i)}: ${cited.error}`);
    }
    if (citeErrors.length > 0) return { success: false, error: `${citeErrors.join(' ')} Nothing was created.` };
  }

  // 9.6: a proposal is an ASK, so it always files; the routing note tells the
  // agent which tier lane its batch would answer to on a direct write (the
  // strictest lane among the ops), so a level-0 lane is not a surprise at
  // review time. Best-effort: a policy read failure never blocks a proposal.
  let routing: { route: string; lane: string | null; note: string } | null = null;
  try {
    const patchTypes = normalizedPatches.map((p) => String(p.type));
    const policy = await loadAutomationPolicy(supabase, projectId);
    const strictest = strictestRoute(policy, patchTypes);
    routing = {
      route: strictest.route,
      lane: strictest.lane,
      note: strictest.route === 'refuse'
        ? `The ${strictest.lane} lane is at level 0 (off) for direct writes. This proposal still files for review; the owner decides.`
        : strictest.route === 'propose'
          ? `The ${strictest.lane} lane reviews every change; this proposal is the expected path.`
          : 'Every lane this batch touches is at Auto, but this proposal waits for review: Auto applies a batch of requirement, outcome, workflow and constraint changes filed with write access by the owner\'s agent, touching no confirmed requirement and not setting the vision.',
    };
  } catch {
    routing = null;
  }

  // 2026-09-18: referential validation across the batch. Each patch was already
  // checked ALONE against PatchOperationSchema, which cannot see that a
  // contractId names nothing. The id sets come from the snapshot without its
  // graph_data (megabytes on a real branch). A load failure does NOT skip the
  // check — it fails the call, because the alternative is what happened on
  // 'OpenMed Import': seven edges accepted against contracts that did not
  // exist, discarded at approve time, and reported as a success.
  const loadExistingIds = async (): Promise<GraphReferenceIds | { error: string }> => {
    const { data, error } = await supabase.rpc('graph_reference_ids', { p_branch_id: branchId });
    if (error) {
      if (/could not find the function/i.test(error.message ?? '')) {
        // A stack without migration 20260919100000 cannot do this check; say so
        // rather than pretending the batch was validated.
        return { error: `This NodeSpec stack is missing the graph_reference_ids function (migration 20260919100000), so patch references cannot be verified. Apply pending migrations and retry.` };
      }
      return { error: `Could not read the branch's graph to verify patch references: ${error.message}` };
    }
    const row = (data ?? {}) as { nodes?: unknown; contracts?: unknown };
    return {
      nodes: Array.isArray(row.nodes) ? row.nodes.filter((x): x is string => typeof x === 'string') : [],
      contracts: Array.isArray(row.contracts) ? row.contracts.filter((x): x is string => typeof x === 'string') : [],
    };
  };

  // C1: bindings-only artifacts are only honest if someone can actually pull
  // the bytes at accept — refuse BEFORE any insert when no repo is connected,
  // naming both fixes.
  if (contentByReferenceCount > 0) {
    const { data: integration } = await supabase
      .from('git_integrations')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle();
    if (!integration) {
      return {
        success: false,
        error: `content_ref was provided for ${contentByReferenceCount} artifact(s) but this project has no git integration — ` +
          `connect the repository in NodeSpec's Git panel, or include the artifact content inline`,
      };
    }
  }

  // C2: session continuation — append to (and/or finalize) an existing
  // chunked draft. One UPDATE; no extra ai_runs row (the session's run was
  // created when it started).
  if (args.proposal_id) {
    const { data: sessRow } = await supabase
      .from('ai_proposals')
      .select('id, status, patches, metadata, source_branch_id')
      .eq('id', args.proposal_id)
      .maybeSingle();
    // The branch was already verified to belong to the caller's project, so
    // requiring the session to sit on that same branch closes ownership.
    if (!sessRow || (sessRow as { source_branch_id: string }).source_branch_id !== branchId) {
      return { success: false, error: 'Proposal session not found on this branch' };
    }
    const sess = sessRow as { id: string; status: string; patches: unknown[]; metadata: Record<string, unknown> };
    // deno-lint-ignore no-explicit-any
    const chunked = (sess.metadata?.chunkedSession ?? null) as any;
    if (sess.status !== 'staged') {
      return {
        success: false,
        error: `Proposal session is '${sess.status}', not 'staged' — it was already finalized. Start a new session (finalize: false) for further changes.`,
      };
    }
    if (!chunked) {
      return { success: false, error: 'That staged proposal is not a chunked session (it belongs to the import lane) — it cannot be appended to or finalized here.' };
    }
    if (typeof chunked.expiresAt === 'string' && Date.parse(chunked.expiresAt) < Date.now()) {
      // Lazy expiry: discard the stale draft so it cannot linger invisible.
      try {
        await supabase.from('ai_proposals').delete().eq('id', sess.id).eq('status', 'staged');
      } catch (_delErr) { /* cleanup is best-effort */ }
      return {
        success: false,
        error: `Proposal session expired (no activity before ${chunked.expiresAt}) and was discarded — resubmit from the start with finalize: false.`,
      };
    }

    const appendedEntries = normalizedPatches.map((patch, index) => ({
      patch,
      explanation: explanationsAll[index] || 'No explanation provided',
      status: 'pending',
    }));
    const combined = [...(sess.patches ?? []), ...appendedEntries];
    const sessionMixed = mixedPlanes(combined.map((e) => ((e && typeof e === 'object' && 'patch' in e ? (e as { patch: unknown }).patch : e) ?? {}) as Record<string, unknown>));
    if (sessionMixed) return { success: false, error: `Not appended: this session would carry both planes. ${sessionMixed}` };

    if (combined.length > CHUNKED_SESSION_MAX_PATCHES) {
      return { success: false, error: `Session would hold ${combined.length} patches, over the ${CHUNKED_SESSION_MAX_PATCHES} cap — finalize what is staged or split the work.` };
    }
    const finalizing = args.finalize === true;

    // A session is ONE proposal: a reference may be satisfied by a patch that
    // any call in the session contributed, so the set is only complete at
    // finalize — that is where it is checked. Indices are positions within the
    // whole session, which is what locates the patch across several calls. The
    // session stays staged on refusal, so the gap can be appended and finalized
    // again rather than the work being lost.
    let sessionJudgement: ProposalJudgement | null = null;
    if (finalizing) {
      const existingIds = await loadExistingIds();
      if ('error' in existingIds) return { success: false, error: existingIds.error };
      const sessionPatches = combined.map((e) =>
        (e && typeof e === 'object' && 'patch' in e ? (e as { patch: unknown }).patch : e) as Record<string, unknown>
      );
      const gaps = findBatchReferenceGaps(sessionPatches, existingIds);
      const lockedRefusal = gaps.length > 0 ? null : (await refuseLockedNodeTargets(supabase, projectId, sessionPatches))
        ?? (await refuseLeasedNodeTargets(supabase, auth, projectId, sessionPatches, branchId))
        ?? (await refusePlacementViolations(supabase, branchId, catalogs, sessionPatches, normalizationNotes))
        ?? (await refuseContainerEdgeEnds(supabase, branchId, catalogs, sessionPatches));
      if (lockedRefusal) {
        return { success: false, error: `Session NOT finalized — ${lockedRefusal}` };
      }
      // R.2b: the whole session is held against the project's checks.
      if (gaps.length === 0) {
        sessionJudgement = await judgeProposal(supabase, projectId, branchId, sessionPatches);
        if (sessionJudgement?.refusal) return { success: false, error: `Session NOT finalized. ${sessionJudgement.refusal}` };
        for (const w of sessionJudgement?.warnings ?? []) truncationWarnings.push(w);
      }
      if (gaps.length > 0) {
        return {
          success: false,
          error: `Session NOT finalized — ${describeBatchReferenceGaps(gaps)} ` +
            `Indices are positions within the ${sessionPatches.length} patches this finalize would have held. ` +
            `The session is untouched and still staged, so THIS call's ${normalizedPatches.length} patch(es) were not stored: ` +
            `resend them together with the missing add_contract / add_node patches using this proposal_id, then finalize.`,
        };
      }
    }
    const expiresAt = new Date(Date.now() + CHUNKED_SESSION_TTL_MS).toISOString();
    const { error: updateError } = await supabase
      .from('ai_proposals')
      .update({
        patches: combined,
        ...(finalizing ? { status: 'pending' } : {}),
        metadata: {
          ...sess.metadata,
          ...(repoIndexMoves.length > 0
            ? { repoIndexMoves: [...((sess.metadata?.repoIndexMoves as unknown[] | undefined) ?? []), ...repoIndexMoves] }
            : {}),
          ...(sessionJudgement && sessionJudgement.findings.length > 0 ? { constraintFindings: sessionJudgement.findings } : {}),
          chunkedSession: {
            ...chunked,
            calls: (typeof chunked.calls === 'number' ? chunked.calls : 1) + 1,
            // Sliding window: every append buys the session another interval.
            expiresAt,
            ...(finalizing ? { finalizedAt: new Date().toISOString() } : {}),
          },
        },
      })
      .eq('id', sess.id)
      .eq('status', 'staged');
    if (updateError) {
      return { success: false, error: `Failed to update session: ${updateError.message}` };
    }
    // AL.6: a finalized session under Auto applies as one batch.
    if (finalizing) {
      const auto = await autoApplyIfAllowed(supabase, auth, projectId, projectRole, routing,
        { id: sess.id, status: 'pending', source_branch_id: branchId, patches: combined as ProposalRow['patches'], metadata: { ...sess.metadata } });
      if (auto) return auto;
    }

    return {
      success: true,
      data: {
        proposalId: sess.id,
        status: finalizing ? 'pending' : 'staged',
        // C3 groundwork: every chunked response states what THIS call added
        // and what the session now holds — a truncated batch is visible.
        patchCountThisCall: normalizedPatches.length,
        sessionPatchCount: combined.length,
        ...(finalizing
          ? {
              message: `Session finalized with ${combined.length} patch(es) — now pending user review as ONE proposal.`,
              nextAction: 'Poll get_proposal_status with the proposalId to check acceptance.',
              ifTruncated: 'If sessionPatchCount is lower than you intended, the finalized proposal is a FRAGMENT — ask the user to decline it and restart a session (finalize: false).',
            }
          : {
              message: `Appended ${normalizedPatches.length} patch(es); session holds ${combined.length}.`,
              nextAction: `Append more with proposal_id, or pass finalize: true to submit for review. Session expires ${expiresAt} without activity.`,
              expiresAt,
              ifTruncated: `If fewer patches arrived this call than you sent, the session is still open — append the missing ones with proposal_id: "${sess.id}" before finalizing.`,
            }),
        ...(truncationWarnings.length > 0 ? { warnings: truncationWarnings } : {}),
        ...(intentSuggestions.length > 0 ? { suggestions: intentSuggestions } : {}),
        ...(contentByReferenceCount > 0
          ? { contentByReference: { count: contentByReferenceCount, ref: contentRef } }
          : {}),
        ...(routing ? { routing } : {}),
        normalizations: normalizationNotes,
      },
    };
  }

  // C2: session start — a staged draft, invisible to review until finalized.
  const isChunkedStart = args.finalize === false;

  // A single-call proposal is complete as submitted, so its references must
  // resolve now. A chunked START is exempt: a later call in the session may
  // supply the contract or node, and the session is checked when it finalizes.
  let judgement: ProposalJudgement | null = null;
  if (!isChunkedStart) {
    const existingIds = await loadExistingIds();
    if ('error' in existingIds) return { success: false, error: existingIds.error };
    const gaps = findBatchReferenceGaps(normalizedPatches, existingIds);
    if (gaps.length > 0) {
      return { success: false, error: describeBatchReferenceGaps(gaps) };
    }
    const lockedRefusal = (await refuseLockedNodeTargets(supabase, projectId, normalizedPatches as Array<Record<string, unknown>>))
      ?? (await refuseLeasedNodeTargets(supabase, auth, projectId, normalizedPatches as Array<Record<string, unknown>>, branchId))
      ?? (await refusePlacementViolations(supabase, branchId, catalogs, normalizedPatches as Array<Record<string, unknown>>, normalizationNotes))
      ?? (await refuseContainerEdgeEnds(supabase, branchId, catalogs, normalizedPatches as Array<Record<string, unknown>>));
    if (lockedRefusal) return { success: false, error: lockedRefusal };
    // R.2b: the batch is held against the project's checks: a refusing check
    // it breaks refuses the batch, a warning check files with the warning.
    judgement = await judgeProposal(supabase, projectId, branchId, normalizedPatches as Array<{ type?: unknown; payload?: unknown }>);
    if (judgement?.refusal) return { success: false, error: judgement.refusal };
    for (const w of judgement?.warnings ?? []) truncationWarnings.push(w);
  }

  if (isChunkedStart) {
    // Opportunistic hygiene: expired chunked drafts on this branch are dead
    // weight nobody can see — clear them while we are here. Best-effort.
    try {
      await supabase
        .from('ai_proposals')
        .delete()
        .eq('source_branch_id', branchId)
        .eq('status', 'staged')
        .lt('metadata->chunkedSession->>expiresAt', new Date().toISOString());
    } catch (_cleanupErr) { /* never blocks the propose */ }
  }

  // V3 2.1 (2026-09-19): base_sequence, the branch head the agent last read
  // (headSequence from get_architecture_overview). Checked here, and again
  // when the user accepts in the app: a proposal built on a read that later
  // patches overtook is refused BEFORE anything is created, naming the patch
  // and the later change, so the agent re-reads (since_sequence) and
  // re-proposes. Optional: without it the proposal files as before.
  let headSequence: number | null = null;
  if (args.base_sequence !== undefined) {
    if (!Number.isInteger(args.base_sequence) || (args.base_sequence as number) < 0) {
      return { success: false, error: 'base_sequence must be a non-negative integer: the headSequence you last read from get_architecture_overview.' };
    }
    const { data: laterRows, error: laterError } = await supabase
      .from('graph_patches')
      .select('sequence, patch_type, payload, actor_type, summary')
      .eq('branch_id', branchId)
      .gt('sequence', args.base_sequence)
      .order('sequence', { ascending: true });
    if (laterError) {
      return { success: false, error: `Could not read the branch's patches after sequence ${args.base_sequence}: ${laterError.message}` };
    }
    const later = ((laterRows ?? []) as PatchRowLike[]).map(laterPatchFromRow);
    headSequence = later.length > 0 ? later[later.length - 1].sequence : args.base_sequence;
    const conflicts = conflictsSince(normalizedPatches as Array<{ type?: unknown; payload?: unknown; metadata?: unknown }>, later);
    if (conflicts.length > 0) {
      return {
        success: false,
        error: `Stale read (base_sequence ${args.base_sequence}, head is now ${headSequence}): ${describeConflicts(conflicts)} ` +
          `Nothing was created. Re-read with get_architecture_overview (since_sequence: ${args.base_sequence}) and re-propose against the current head, ` +
          'or omit base_sequence to file anyway and let the user decide.',
      };
    }
  }

  const aiRunId = crypto.randomUUID();
  const { error: runError } = await supabase
    .from('ai_runs')
    .insert({
      id: aiRunId,
      project_id: projectId,
      branch_id: branchId,
      model: externalAgent,
      prompt_hash: 'mcp-proposal',
      status: 'completed',
      completed_at: new Date().toISOString(),
      metadata: {
        source: 'mcp-server',
        externalAgent,
        credential: cred.delegate,
        credentialLabel: cred.label,
        patchCount: patches.length,
        authMethod: auth.authMethod,
        apiKeyId: auth.keyId || null,
      },
    });

  if (runError) {
    return { success: false, error: `Failed to create AI run: ${runError.message}` };
  }

  // Bugfix (2026-07-14): previously this minted a real `mcp-proposal/<run>` branch on
  // every proposal purely to satisfy the NOT-NULL `proposal_branch_id` FK — but nothing
  // ever populated it with a graph snapshot or read it back. The result was dangling
  // empty branches that cluttered the branch switcher and, when clicked, silently landed
  // the user on the new-project onboarding screen (no snapshot to load). The in-app
  // proposal path never created a branch either; it points proposal_branch_id at the
  // source branch. Match that: the proposal's patches live in `patches` (JSON) and are
  // applied to the source branch on approval, so a distinct branch was never needed.
  const proposalBranchId = branchId;

  const proposalPatches = normalizedPatches.map((patch, index) => ({
    patch,
    explanation: explanationsAll[index] || 'No explanation provided',
    status: 'pending',
  }));

  // AL.8: a canvas proposal always records the head it was built on, so the
  // accept finds what landed on the same things since (an agent that sent
  // no base_sequence was compared against nothing, and the later accept won).
  let implicitBase: number | null = null;
  if (args.base_sequence === undefined && normalizedPatches.some((np) => !isSpecOpType(np.type))) {
    try {
      const { data: head, error: headErr } = await supabase
        .from('graph_patches').select('sequence').eq('branch_id', branchId)
        .order('sequence', { ascending: false }).limit(1).maybeSingle();
      if (!headErr) implicitBase = typeof (head as { sequence?: unknown } | null)?.sequence === 'number' ? (head as { sequence: number }).sequence : 0;
    } catch { implicitBase = null; }
  }

  const sessionExpiresAt = new Date(Date.now() + CHUNKED_SESSION_TTL_MS).toISOString();
  const proposalId = crypto.randomUUID();
  const insertedMetadata: Record<string, unknown> = {
    source: 'mcp-server',
    externalAgent,
    credential: cred.delegate,
    credentialLabel: cred.label,
    authMethod: auth.authMethod,
    apiKeyId: auth.keyId || null,
    // 7.0: the account behind the channel: a maintainer may not approve
    // a promotion their own agent filed (R6, proposer ≠ approver).
    proposedByUserId: auth.userId,
    normalizations: normalizationNotes,
    ...(args.base_sequence !== undefined ? { baseSequence: args.base_sequence } : implicitBase !== null ? { baseSequence: implicitBase } : {}),
    // R.1: each intent keeps the files and lines it rests on, for the reviewer.
    ...(compiledIntents.length > 0 ? { intents: compiledIntents.map((c) => ({ kind: c.kind, summary: c.summary, ids: c.ids, ...(c.evidence ? { evidence: c.evidence } : {}) })) } : {}),
    ...(repoIndexMoves.length > 0 ? { repoIndexMoves } : {}),
    // R.2b: the checks this proposal breaks with a warning, for the reviewer.
    ...(judgement && judgement.findings.length > 0 ? { constraintFindings: judgement.findings } : {}),
    ...(isChunkedStart
      ? { chunkedSession: { startedAt: new Date().toISOString(), calls: 1, expiresAt: sessionExpiresAt } }
      : {}),
  };
  const { error: proposalError } = await supabase
    .from('ai_proposals')
    .insert({
      id: proposalId,
      ai_run_id: aiRunId,
      source_branch_id: branchId,
      proposal_branch_id: proposalBranchId,
      status: isChunkedStart ? 'staged' : 'pending',
      patches: proposalPatches,
      validation_expectations: [],
      metadata: insertedMetadata,
    });

  if (proposalError) {
    return { success: false, error: `Failed to create proposal: ${proposalError.message}` };
  }

  // 4b.3: the filing credential's advisory holds on what this proposal
  // touches now say "waiting for approval" — bound to the proposal id.
  const holdsBound = await bindHoldsToProposal(supabase, auth, projectId, proposalId, normalizedPatches as Array<{ type?: string; payload?: unknown }>);

  // AL.6: under Auto, a batch of spec changes applies as it files.
  if (!isChunkedStart) {
    const auto = await autoApplyIfAllowed(supabase, auth, projectId, projectRole, routing,
      { id: proposalId, status: 'pending', source_branch_id: branchId, patches: proposalPatches as ProposalRow['patches'], metadata: insertedMetadata });
    if (auto) return auto;
  }

  return {
    success: true,
    data: {
      proposalId,
      aiRunId,
      proposalBranchId,
      ...(holdsBound > 0 ? { holdsBound } : {}),
      patchCount: patches.length,
      status: isChunkedStart ? 'staged' : 'pending',
      ...(headSequence !== null ? { baseSequence: args.base_sequence, headSequence } : {}),
      ...(compiledIntents.length > 0 ? { compiled: { intents: compiledIntents.length, patches: compiledPatches.length, ids: compiledIntents.map((c) => ({ kind: c.kind, ...c.ids })) } } : {}),
      // C3: every response states exactly what arrived this call.
      patchCountThisCall: patches.length,
      ...(isChunkedStart ? { sessionPatchCount: patches.length, expiresAt: sessionExpiresAt } : {}),
      message: (isChunkedStart
        ? `Chunked session started with ${patches.length} patch(es) — INVISIBLE to review until finalized.`
        : `Proposal created successfully with ${patches.length} patch(es). Review and accept/reject patches in NodeSpec UI.`)
        + (contentByReferenceCount > 0
          ? ` ${contentByReferenceCount} artifact(s) are bindings-only: their content will be pulled from git at ref "${contentRef}" when the user accepts — make sure that commit is pushed and reachable.`
          : ''),
      nextAction: isChunkedStart
        ? `Append further batches with proposal_id: "${proposalId}", then pass finalize: true on the last call (patches optional). Session expires ${sessionExpiresAt} without activity.`
        : 'Poll get_proposal_status with the proposalId to check acceptance. After patches are accepted, call get_project_status to see what is needed next.',
      // C3: never accept a fragment as silently complete — the recovery path
      // rides every response.
      ifTruncated: isChunkedStart
        ? `If fewer patches arrived than you sent, the session is still open — append the missing ones with proposal_id: "${proposalId}" before finalizing.`
        : 'If patchCountThisCall is lower than you intended, this proposal is a FRAGMENT — ask the user to decline it, then resubmit as a chunked session (finalize: false → append with proposal_id → finalize: true), or resend with expected_patch_count so a short delivery fails loudly.',
      ...(truncationWarnings.length > 0 ? { warnings: truncationWarnings } : {}),
      ...(intentSuggestions.length > 0 ? { suggestions: intentSuggestions } : {}),
      // C1 transparency: how many artifacts ride as bindings-only, and at what ref.
      ...(contentByReferenceCount > 0
        ? { contentByReference: { count: contentByReferenceCount, ref: contentRef } }
        : {}),
      // Transparency: which proposed node type/technology values the server conformed to the
      // catalog (so the AI can learn the house vocabulary). Empty when nothing was changed.
      normalizations: normalizationNotes,
      ...(routing ? { routing } : {}),
    },
  };
}

export async function handleGetProposalStatus(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { proposal_id: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  if (!args.proposal_id) {
    return { success: false, error: 'proposal_id is required' };
  }

  const { data: ownerCheck, error: ownerError } = await supabase
    .from('ai_proposals')
    .select(`
      id,
      source_branch_id,
      branches!ai_proposals_source_branch_id_fkey (
        project_id,
        projects!branches_project_id_fkey (
          owner_id
        )
      )
    `)
    .eq('id', args.proposal_id)
    .maybeSingle();

  if (ownerError || !ownerCheck) {
    return { success: false, error: 'Proposal not found' };
  }

  const via = ownerCheck.branches as { project_id?: string; projects: { owner_id: string } | null } | null;
  const projectOwnerId = via?.projects?.owner_id;
  if (projectOwnerId !== auth.userId) {
    // 7.0: not the owner — a roster seat (any role) reads.
    const seat = via?.project_id ? await memberRoleFor(supabase, via.project_id, auth.userId) : null;
    if (!roleAtLeast(seat, 'viewer')) {
      return { success: false, error: 'Proposal not found or access denied' };
    }
  }

  const { data: proposal, error } = await supabase
    .from('ai_proposals')
    .select('id, status, patches, metadata, created_at, reviewed_at, merged_at')
    .eq('id', args.proposal_id)
    .maybeSingle();

  if (error || !proposal) {
    return { success: false, error: 'Proposal not found' };
  }
  // V3 2.1: the read the proposal was built on, and what the accept found
  // had moved since (written by the app's accept path, never by this tool).
  const proposalMeta = ((proposal as { metadata?: unknown }).metadata ?? {}) as { baseSequence?: unknown; conflicts?: unknown; resolveNote?: unknown; rejectionReason?: unknown };
  const baseSequence = typeof proposalMeta.baseSequence === 'number' ? proposalMeta.baseSequence : null;
  const conflicts = Array.isArray(proposalMeta.conflicts) ? proposalMeta.conflicts : [];
  // R.2c: the reviewer's own words on a decided proposal, and what to do
  // with them when they state something that holds beyond this proposal.
  const noteRaw = typeof proposalMeta.resolveNote === 'string' ? proposalMeta.resolveNote
    : typeof proposalMeta.rejectionReason === 'string' ? proposalMeta.rejectionReason : '';
  const reviewNote = proposal.status !== 'pending' && proposal.status !== 'staged' && noteRaw.trim() ? noteRaw.trim() : null;
  // AC: the ask to file the note as a constraint only where constraints exist.
  const reviewNoteAsk = reviewNote && via?.project_id && await constraintsCarried(supabase, via.project_id, projectOwnerId) ? SIGNAL_ASKS.review : null;

  const patches = proposal.patches as Array<{ patch: unknown; explanation: string; status: string }>;

  // Dogfood find 2026-09-02 (#2): a whole-proposal accept applies every patch
  // and stamps the ROW merged, but never rewrites the per-patch statuses in
  // the stored JSON — so this tool reported `status: merged` beside
  // `pending: 1, merged: 0` and callers had to learn which field to trust.
  // The row lifecycle governs: under a terminal row, a stored 'pending' or
  // 'approved' patch WAS carried by the whole-proposal action (individually
  // rejected patches keep their explicit stamp). Derive at read time — one
  // consistent answer, no data rewrite, historical proposals self-heal.
  const effectiveStatus = (stored: string): string => {
    if (proposal.status === 'merged' && (stored === 'pending' || stored === 'approved')) return 'merged';
    if (proposal.status === 'rejected' && (stored === 'pending' || stored === 'approved')) return 'rejected';
    return stored;
  };
  const effective = patches.map((p) => effectiveStatus(p.status));
  const patchSummary = {
    total: patches.length,
    pending: effective.filter(s => s === 'pending').length,
    approved: effective.filter(s => s === 'approved').length,
    rejected: effective.filter(s => s === 'rejected').length,
    merged: effective.filter(s => s === 'merged').length,
    conflicted: effective.filter(s => s === 'conflicted').length,
  };

  return {
    success: true,
    data: {
      proposalId: proposal.id,
      status: proposal.status,
      patchSummary,
      baseSequence,
      ...(conflicts.length > 0 ? { conflicts } : {}),
      ...(reviewNote ? { reviewNote, ...(reviewNoteAsk ? { reviewNoteAsk } : {}) } : {}),
      createdAt: proposal.created_at,
      reviewedAt: proposal.reviewed_at,
      mergedAt: proposal.merged_at,
      patches: patches.map((p, i) => ({
        index: i,
        status: effective[i],
        explanation: p.explanation,
      })),
    },
  };
}

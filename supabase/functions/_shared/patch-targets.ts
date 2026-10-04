// V3 2.1 (2026-09-19): what a graph patch touches, so two writers on one
// branch can be compared by the ids they mutate. MIRRORED at
// supabase/functions/_shared/patch-targets.ts (byte-identical, pinned by
// src/tests/patch-targets.test.ts); this file has no imports so the mirror
// is the same bytes.
//
// primary: the entity the op creates, changes or removes (one id, or the
// graph itself for metadata). touched: entities the op depends on being as
// they were when the agent read them (an edge's endpoints, a port's node).
// A later patch CONFLICTS with a proposed one when the later patch's primary
// is anything the proposed one targets or touches. Adds of other ids never
// conflict; a contract edit never invalidates an edge that names it.

export interface PatchTargets { primary: string | null; touched: string[] }

export type AnyPatch = { type?: unknown; payload?: unknown; metadata?: unknown };

const GRAPH_ITSELF = '__graph__';

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const rec = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const ids = (...vals: unknown[]): string[] => vals.map(str).filter((x): x is string => x !== null);

export function patchTargets(patch: AnyPatch): PatchTargets {
  const p = rec(patch.payload);
  const id = str(p.id);
  switch (patch.type) {
    case 'add_node': case 'update_node': case 'remove_node': case 'delete_node':
    case 'add_contract': case 'update_contract': case 'remove_contract': case 'delete_contract':
    case 'instantiate_contract_stub':
    case 'update_edge': case 'remove_edge': case 'delete_edge':
    case 'set_edge_direction': case 'set_edge_criticality':
    case 'update_artifact': case 'remove_artifact': case 'delete_artifact':
    case 'add_node_group': case 'update_node_group': case 'remove_node_group':
      return { primary: id, touched: [] };
    case 'add_edge':
      return { primary: id, touched: ids(p.source, p.target) };
    case 'add_artifact': case 'attach_artifact_stub':
      return { primary: id, touched: ids(p.nodeId) };
    case 'update_graph_metadata':
      return { primary: GRAPH_ITSELF, touched: [] };
    case 'add_port':
      return { primary: str(rec(p.port).id), touched: ids(p.nodeId) };
    case 'update_port': case 'delete_port':
      return { primary: str(p.portId), touched: ids(p.nodeId) };
    case 'connect_ports':
      return { primary: str(p.edgeId), touched: ids(p.sourceNodeId, p.targetNodeId) };
    case 'create_node_from_template':
      return { primary: str(p.nodeId), touched: [] };
    case 'mark_entity_complete':
      return { primary: str(p.entityId), touched: ids(p.nodeId) };
    default:
      return { primary: null, touched: [] };
  }
}

const LAYOUT_KEYS = new Set(['position', 'size', 'width', 'height', 'style', 'visual', 'collapsed']);

/** A node move or resize: layout only. It locks nothing (AA.5b), and as a
 *  later patch it overtakes nothing (AL.11): where a node sits says nothing
 *  about what a proposal changes on it. A reparent is structure, not layout. */
export function layoutOnly(patch: AnyPatch): boolean {
  if (patch.type !== 'update_node') return false;
  const entries = Object.entries(rec(rec(patch.payload).changes));
  if (entries.length === 0) return false; // nothing named is not a move
  return entries.every(([k, v]) =>
    LAYOUT_KEYS.has(k) || (k === 'metadata' && v !== null && typeof v === 'object' && Object.keys(v as object).every((m) => LAYOUT_KEYS.has(m))));
}

/** A patch appended after the agent's read, as the handlers see it. */
export interface LaterPatch {
  sequence: number;
  type: string;
  payload?: unknown;
  actorType?: string | null;
  summary?: string | null;
}

/** One graph_patches row (the stored payload is the whole patch envelope). */
export interface PatchRowLike {
  sequence: number | string;
  patch_type: string;
  payload?: unknown;
  actor_type?: string | null;
  summary?: string | null;
}

export function laterPatchFromRow(row: PatchRowLike): LaterPatch {
  const envelope = rec(row.payload);
  return {
    sequence: Number(row.sequence),
    type: row.patch_type,
    payload: envelope.payload,
    actorType: row.actor_type ?? null,
    summary: row.summary ?? null,
  };
}

export interface PatchConflict {
  /** Index of the proposed patch in its batch. */
  index: number;
  patchId: string | null;
  type: string;
  /** The id both sides name. */
  targetId: string;
  laterSequence: number;
  laterType: string;
  laterActor: string | null;
  laterSummary: string | null;
}

/** The proposed patches whose targets a later patch overtook. Pure. */
export function conflictsSince(proposed: AnyPatch[], later: LaterPatch[]): PatchConflict[] {
  const out: PatchConflict[] = [];
  const laterPrimaries = later
    .filter((l) => !layoutOnly(l))
    .map((l) => ({ l, primary: patchTargets(l).primary }))
    .filter((x): x is { l: LaterPatch; primary: string } => x.primary !== null);
  if (laterPrimaries.length === 0) return out;
  proposed.forEach((patch, index) => {
    const t = patchTargets(patch);
    const mine = new Set<string>([...(t.primary ? [t.primary] : []), ...t.touched]);
    if (mine.size === 0) return;
    for (const { l, primary } of laterPrimaries) {
      if (!mine.has(primary)) continue;
      out.push({
        index,
        patchId: str(rec(patch.metadata).id),
        type: String(patch.type ?? ''),
        targetId: primary,
        laterSequence: l.sequence,
        laterType: l.type,
        laterActor: l.actorType ?? null,
        laterSummary: l.summary ?? null,
      });
    }
  });
  return out;
}

/** One sentence per conflict, for a refusal or a card. */
export function describeConflicts(conflicts: PatchConflict[]): string {
  return conflicts
    .map((c) => {
      const who = c.laterActor === 'human' ? 'the user' : (c.laterActor ? `an ${c.laterActor} writer` : 'a later writer');
      const what = c.laterSummary ? ` (${c.laterSummary})` : '';
      const target = c.targetId === GRAPH_ITSELF ? 'the graph metadata' : c.targetId;
      return `patch[${c.index}] ${c.type} targets ${target}, which ${who} changed at sequence ${c.laterSequence} with ${c.laterType}${what}.`;
    })
    .join(' ');
}

/** The later patches that name a node, as primary or as a touched endpoint. */
export function patchesTouchingNode(patches: LaterPatch[], nodeId: string): LaterPatch[] {
  return patches.filter((p) => {
    const t = patchTargets(p);
    return t.primary === nodeId || t.touched.includes(nodeId);
  });
}

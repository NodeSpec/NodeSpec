// R6: DERIVED coupling + expand suggestions for the spec panel — pure helpers,
// no I/O. Mirrors the server's computeRequirementCoupling (mcp-server
// tools/requirements.ts) over the client's mapping pivots: coupling is
// architectural FACT computed at read time and never stored; the authored
// relations table records INTENT, and the ONLY path from a suggestion to a
// stored row is the user's accept click (source 'user').
import type { RequirementMapping } from '../../services/MappingService.js';
import type { Requirement } from '../../../persistence/supabase/requirements-repository.js';
import type { RequirementRelation } from '../../../persistence/supabase/requirement-relations-repository.js';

export interface CouplingEntry {
  /** Row uuid of the coupled requirement. */
  requirementRowId: string;
  kind: 'shared_node' | 'adjacent';
  /** The shared node's label, or the bridging edge as "Source → Target". */
  via: string;
}

/** Structural slice of the graph the helpers need — core's Graph satisfies it. */
export interface CouplingGraphSlice {
  nodes: Record<string, { label?: string }>;
  edges: Record<string, { source: string; target: string }>;
}

// Keys are requirement ROW uuids (the client mapping pivots are keyed by row
// id). One entry per (req, other) pair: shared_node beats adjacent.
export function computeCouplingByRequirement(
  mappingsByNode: Map<string, RequirementMapping[]>,
  mappingsByRequirement: Map<string, RequirementMapping[]>,
  graph: CouplingGraphSlice | undefined,
): Map<string, CouplingEntry[]> {
  const out = new Map<string, CouplingEntry[]>();
  if (mappingsByRequirement.size === 0) return out;

  const nodeLabel = (id: string): string => graph?.nodes?.[id]?.label || id;
  const reqsOnNode = (nodeId: string): string[] => {
    const seen = new Set<string>();
    for (const m of mappingsByNode.get(nodeId) || []) {
      if (m.requirementId) seen.add(m.requirementId);
    }
    return [...seen];
  };

  const seenPairs = new Set<string>(); // directed pair guard — shared_node runs first and wins
  const addPair = (a: string, b: string, kind: CouplingEntry['kind'], via: string) => {
    if (a === b) return;
    const key = `${a} ${b}`;
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    const list = out.get(a) ?? [];
    list.push({ requirementRowId: b, kind, via });
    out.set(a, list);
  };

  for (const nodeId of mappingsByNode.keys()) {
    const reqs = reqsOnNode(nodeId);
    if (reqs.length < 2) continue;
    const via = nodeLabel(nodeId);
    for (const a of reqs) {
      for (const b of reqs) addPair(a, b, 'shared_node', via);
    }
  }

  for (const edge of Object.values(graph?.edges || {})) {
    if (!edge?.source || !edge?.target || edge.source === edge.target) continue;
    const sourceReqs = reqsOnNode(edge.source);
    const targetReqs = reqsOnNode(edge.target);
    if (sourceReqs.length === 0 || targetReqs.length === 0) continue;
    const via = `${nodeLabel(edge.source)} → ${nodeLabel(edge.target)}`;
    for (const a of sourceReqs) {
      for (const b of targetReqs) {
        addPair(a, b, 'adjacent', via);
        addPair(b, a, 'adjacent', via);
      }
    }
  }

  return out;
}

/** Completed = every criterion met (and there is at least one), or the status
 *  itself says the work landed. Matches the server's completion vocabulary. */
export function isRequirementCompleted(req: Pick<Requirement, 'status' | 'acceptanceCriteria'>): boolean {
  if (req.status === 'implemented' || req.status === 'validated') return true;
  const criteria = req.acceptanceCriteria || [];
  return criteria.length > 0 && criteria.every((ac) => ac.met);
}

export interface ExpandSuggestion {
  /** Row uuid of the completed requirement this one possibly expands. */
  targetRowId: string;
  /** Human REQ id for display ("REQ-007"). */
  targetRequirementId: string;
  /** The shared node's label — the evidence the suggestion cites. */
  via: string;
}

// "Possibly expands REQ-007 — same nodes": an INCOMPLETE requirement that
// shares a node (shared_node coupling only — adjacency is too weak to imply
// lineage) with a COMPLETED one, and no expands relation already recorded
// between the pair in either direction. Purely a rendering hint — accepting
// it is the user's call.
export function computeExpandSuggestions(
  requirements: Requirement[],
  couplingByRequirement: Map<string, CouplingEntry[]>,
  relations: RequirementRelation[],
): Map<string, ExpandSuggestion[]> {
  const byRowId = new Map(requirements.map((r) => [r.id, r]));
  const expandsPairs = new Set<string>();
  for (const rel of relations) {
    if (rel.relationType !== 'expands') continue;
    expandsPairs.add(`${rel.fromRequirementId} ${rel.toRequirementId}`);
    expandsPairs.add(`${rel.toRequirementId} ${rel.fromRequirementId}`);
  }

  const out = new Map<string, ExpandSuggestion[]>();
  for (const req of requirements) {
    if (isRequirementCompleted(req)) continue;
    const suggestions: ExpandSuggestion[] = [];
    for (const entry of couplingByRequirement.get(req.id) || []) {
      if (entry.kind !== 'shared_node') continue;
      if (expandsPairs.has(`${req.id} ${entry.requirementRowId}`)) continue;
      const target = byRowId.get(entry.requirementRowId);
      if (!target || !isRequirementCompleted(target)) continue;
      suggestions.push({
        targetRowId: target.id,
        targetRequirementId: target.requirementId,
        via: entry.via,
      });
    }
    if (suggestions.length > 0) out.set(req.id, suggestions);
  }
  return out;
}

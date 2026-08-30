// Requirement→node traceability (`specification_mappings`) references a node by a bare
// `node_id` uuid. Crucially, that table is spec/project-global (columns: specification_id,
// node_id — no branch_id, no FK to a nodes table), while nodes themselves live inside a
// *branch's* graph snapshot (`graph_snapshots.graph_data.nodes`). So a mapping can point at a
// node that has been removed from the branch currently being read — or that never existed on
// it. "Deleted" is therefore branch-relative, and the only correct place to drop such a
// mapping is at READ time, against the specific graph being assembled.
//
// (A write-time cascade delete would be wrong: the same node_id may still be alive on another
// branch, and the mapping is shared across branches — deleting it would corrupt that branch's
// traceability. Dead-everywhere cleanup is a separate, conservative concern.)
//
// Pure and dependency-free so it unit-tests offline — the assembly modules that call it pull
// value jsr imports transitively and cannot be imported in the Deno test harness.

/** The set of node ids present in a branch's live graph. Missing/empty graph → empty set. */
export function liveNodeIdSet(
  graphNodes: Record<string, unknown> | null | undefined,
): Set<string> {
  return new Set(graphNodes ? Object.keys(graphNodes) : []);
}

/** Keep only the mappings whose node_id still exists in the live graph node set. */
export function filterMappingsToLiveNodes<T extends { node_id: string }>(
  mappings: T[],
  live: Set<string>,
): T[] {
  return mappings.filter((m) => live.has(m.node_id));
}

/**
 * Drop node ids that aren't in the live graph from a requirement→node map, returning a new map
 * (and omitting requirements left with no live nodes). Used to keep the assembled
 * `requirementNodeMap` honest for the branch being read.
 */
export function pruneRequirementNodeMap(
  requirementNodeMap: Record<string, string[]>,
  live: Set<string>,
): Record<string, string[]> {
  const pruned: Record<string, string[]> = {};
  for (const [requirementId, nodeIds] of Object.entries(requirementNodeMap)) {
    const liveIds = nodeIds.filter((id) => live.has(id));
    if (liveIds.length > 0) pruned[requirementId] = liveIds;
  }
  return pruned;
}

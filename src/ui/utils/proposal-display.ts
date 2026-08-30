// UX-1.2 (docs/V2_TASKS.md, owner spec 2026-08-21): review rows must name the
// ACTUAL thing being changed — never a UUID. describePatch already resolves
// ids against the live graph, but a proposal that ADDS an entity and then
// references it in the same batch (an edge to a node created two patches up —
// the normal MCP shape) resolves against a graph that does not hold it yet.
// This overlay folds the proposal's own additions into the lookup, so
// intra-proposal references read by name too. Pure; display-only — never fed
// back into any apply path.
import type { Graph, PatchOperation } from '@nodespec/core/types.js';

export function buildProposalGraphOverlay(patches: PatchOperation[], graph: Graph): Graph {
  const nodes: Record<string, unknown> = { ...(graph?.nodes ?? {}) };
  const edges: Record<string, unknown> = { ...(graph?.edges ?? {}) };
  const contracts: Record<string, unknown> = { ...(graph?.contracts ?? {}) };
  const artifacts: Record<string, unknown> = { ...(graph?.artifacts ?? {}) };

  for (const patch of patches) {
    const payload = patch.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    const id = typeof payload.id === 'string' ? payload.id : undefined;
    switch (patch.type) {
      case 'add_node':
        if (id && !nodes[id]) nodes[id] = payload;
        break;
      case 'create_node_from_template': {
        const node = payload.node as Record<string, unknown> | undefined;
        const nodeId = typeof node?.id === 'string' ? node.id : undefined;
        if (nodeId && !nodes[nodeId]) nodes[nodeId] = node;
        break;
      }
      case 'add_edge':
        if (id && !edges[id]) edges[id] = payload;
        break;
      case 'add_contract':
        if (id && !contracts[id]) contracts[id] = payload;
        break;
      case 'add_artifact':
        if (id && !artifacts[id]) artifacts[id] = payload;
        break;
    }
  }

  return { ...graph, nodes, edges, contracts, artifacts } as Graph;
}

/** Queue-row timestamp: short, locale-aware, matches the history tab's style. */
export function formatProposalTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

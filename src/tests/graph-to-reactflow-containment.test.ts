// Bench 2026-07-21 (owner report): (1) nodes edge-connected to a container rendered INSIDE
// it without being parented — collapsed count said "3 nodes" with 1 assigned (auto-nesting
// illusion, removed in Canvas); (2) nodes disappeared during drag — React Flow silently
// drops a child whose parentId points at a node appearing later in the array or absent.
// These pins hold the adapter to the canonical-graph contract.
import { describe, expect, it } from 'vitest';
import { mapGraphToRFNodes, mapNodeToRFNode } from '../ui/adapters/graph-to-reactflow.js';

// deno-lint-ignore-file — vitest file; minimal Graph shape the adapter reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGraph(nodes: Record<string, any>): any {
  return { nodes, edges: {}, contracts: {}, artifacts: {} };
}

describe('graph-to-reactflow containment truth (bench 2026-07-21)', () => {
  it('parents come BEFORE children in the RF array regardless of insertion order', () => {
    // Child inserted first — object order alone would put it ahead of its container.
    const graph = makeGraph({
      child: { id: 'child', label: 'Svc', type: 'backend-service', parentId: 'box' },
      box: { id: 'box', label: 'Box', type: 'docker-container' },
      grandchild: { id: 'grandchild', label: 'Deep', type: 'backend-service', parentId: 'child' },
    });
    const ids = mapGraphToRFNodes(graph, 'nested', null).map(n => n.id);
    expect(ids.indexOf('box')).toBeLessThan(ids.indexOf('child'));
    expect(ids.indexOf('child')).toBeLessThan(ids.indexOf('grandchild'));
  });

  it('dangling parentId renders as a root node instead of being dropped by React Flow', () => {
    const graph = makeGraph({
      orphan: { id: 'orphan', label: 'Orphan', type: 'backend-service', parentId: 'deleted-container' },
    });
    const rf = mapNodeToRFNode(graph.nodes.orphan, graph, 'nested', null);
    expect(rf.parentId).toBeUndefined();
    expect(rf.hidden).toBeFalsy();
  });

  it('childCount counts ONLY canonical parentId children (no phantom membership)', () => {
    const graph = makeGraph({
      box: { id: 'box', label: 'Box', type: 'docker-container' },
      real: { id: 'real', label: 'Real Child', type: 'backend-service', parentId: 'box' },
      nearby: { id: 'nearby', label: 'Edge-connected, NOT parented', type: 'backend-service' },
    });
    const rf = mapNodeToRFNode(graph.nodes.box, graph, 'nested', null);
    expect((rf.data.metadata as Record<string, unknown>).childCount).toBe(1);
  });

  it('parented child of an existing expanded container still gets RF parentId + extent', () => {
    const graph = makeGraph({
      box: { id: 'box', label: 'Box', type: 'docker-container' },
      real: { id: 'real', label: 'Real Child', type: 'backend-service', parentId: 'box' },
    });
    const rf = mapNodeToRFNode(graph.nodes.real, graph, 'nested', null);
    expect(rf.parentId).toBe('box');
    expect(rf.extent).toBe('parent');
  });
});

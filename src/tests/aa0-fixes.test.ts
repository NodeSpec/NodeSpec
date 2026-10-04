// AA.0 (owner 2026-09-23), the app half:
//   · a port id belongs to its node: an update_edge that moves an endpoint to
//     another node drops the old node's port unless the change names one on
//     the new node (split_node left "Missing source port" on the canvas);
//   · the exports read constraints from the one store, and a marked
//     constraint never lands in an exported file.
import { describe, it, expect } from 'vitest';
import { applyPatch } from '@nodespec/core/patch-engine.js';
import { createUpdateEdgePatch } from '@nodespec/core/patch-factory.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Graph, Node } from '@nodespec/core/types.js';
import { exportConstraintsOf } from '../ui/utils/export-constraints.js';

const opts = { actorType: 'ai' as const, summary: 'AA.0 port test' };
const port = (id: string, direction: 'in' | 'out' = 'out') => ({ id, name: `p-${id.slice(0, 4)}`, direction });

function graphWithPortedEdge() {
  const g = createEmptyGraph() as Graph;
  const [a, b, part, contract, edge, pa, pb, pPart] = Array.from({ length: 8 }, () => generateUUID());
  const node = (id: string, ports: Node['ports']): Node => ({ id, type: 'backend-service', label: id.slice(0, 6), data: {}, metadata: {}, ports });
  g.nodes[a] = node(a, [port(pa)]);
  g.nodes[b] = node(b, [port(pb, 'in')]);
  g.nodes[part] = node(part, [port(pPart)]);
  g.contracts[contract] = { id: contract, kind: 'rest', name: 'Orders API', schema: {}, metadata: {} } as Graph['contracts'][string];
  g.edges[edge] = { id: edge, source: a, target: b, sourcePortId: pa, targetPortId: pb, contractId: contract, metadata: {} } as Graph['edges'][string];
  return { g, a, b, part, edge, pa, pb, pPart };
}

describe('AA.0 · a moved endpoint takes no foreign port', () => {
  it('moving the source to a part drops the old node\'s source port and keeps the untouched target port', () => {
    const { g, part, edge, pb } = graphWithPortedEdge();
    const r = applyPatch(g, createUpdateEdgePatch(edge, { source: part }, opts));
    expect(r.success).toBe(true);
    const e = (r as { graph: Graph }).graph.edges[edge];
    expect(e.source).toBe(part);
    expect(e.sourcePortId).toBeUndefined();
    expect(e.targetPortId).toBe(pb);
  });

  it('a change that names a port on the new node keeps it', () => {
    const { g, part, edge, pPart } = graphWithPortedEdge();
    const r = applyPatch(g, createUpdateEdgePatch(edge, { source: part, sourcePortId: pPart }, opts));
    expect((r as { graph: Graph }).graph.edges[edge].sourcePortId).toBe(pPart);
  });

  it('an update that does not move the endpoint leaves its port alone', () => {
    const { g, edge, pa } = graphWithPortedEdge();
    const r = applyPatch(g, createUpdateEdgePatch(edge, { label: 'renamed' }, opts));
    expect((r as { graph: Graph }).graph.edges[edge].sourcePortId).toBe(pa);
  });
});

describe('AA.0 · exports read the one store', () => {
  it('marked constraints are dropped; the title leads and the reason follows', () => {
    expect(exportConstraintsOf([
      { ctype: 'security', title: 'Short sessions', description: 'Sessions expire after 15 minutes idle', rationale: 'Stolen sessions die fast', mark: null },
      { ctype: 'cost', title: null, description: 'Under 40 dollars a month', rationale: null, mark: null },
      { ctype: 'security', title: null, description: 'The enclave is air-gapped', rationale: null, mark: 'CUI' },
    ])).toEqual([
      { type: 'cost', description: 'Under 40 dollars a month' },
      { type: 'security', description: 'Short sessions: Sessions expire after 15 minutes idle (why: Stolen sessions die fast)' },
    ]);
  });
});

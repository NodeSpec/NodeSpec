// Owner bench 2026-07-29 (test project build): the model carried FOUR edges on
// CloudFront but the canvas drew ONE. Exact topology reproduced here:
//   SPA (top level) → CloudFront;  CloudFront → WAF / S3 (siblings in "AWS Cloud
//   Platform");  CloudFront → ALB (nested DEEPER: Platform → VPC → ALB).
// Three defects pinned:
//  1. nested-sibling containers classified 'cross-container' → summary mode hid the
//     detail edge behind a degenerate parent→own-child summary (CF→ALB vanished);
//  2. dead/direction-mismatched port handle ids passed straight to React Flow,
//     which SILENTLY drops such edges (and nodes without direction-typed ports
//     render no handle at all — covered by FallbackHandles, bench-verified);
//  3. parent→own-child container pairs must never appear as summary edges.
import { describe, it, expect } from 'vitest';
import {
  classifyEdge,
  computeCrossContainerSummaries,
  mapGraphToRFEdges,
  mapEdgeToRFEdge,
} from '../ui/adapters/graph-to-reactflow.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import type { Graph, Node, Edge, Contract, Port } from '@nodespec/core/types.js';

const SPA = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PLATFORM = 'aaaaaaaa-0000-4000-8000-00000000000b';
const CF = 'aaaaaaaa-0000-4000-8000-00000000000c';
const WAF = 'aaaaaaaa-0000-4000-8000-00000000000d';
const S3 = 'aaaaaaaa-0000-4000-8000-00000000000e';
const VPC = 'aaaaaaaa-0000-4000-8000-00000000000f';
const ALB = 'aaaaaaaa-0000-4000-8000-000000000010';
const CONTRACT = 'bbbbbbbb-0000-4000-8000-000000000001';

const OUT_PORT: Port = { id: 'cccccccc-0000-4000-8000-000000000001', name: 'out', direction: 'out' };
const IN_PORT: Port = { id: 'cccccccc-0000-4000-8000-000000000002', name: 'in', direction: 'in' };

function node(id: string, label: string, type: string, parentId?: string, ports: Port[] = []): Node {
  return { id, type, label, parentId, ports, artifacts: [], metadata: {}, status: 'draft' };
}

function edge(id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge {
  return { id, source, target, contractId: CONTRACT, metadata: {}, ...extra } as Edge;
}

function ownerTopology(): Graph {
  const g = createEmptyGraph();
  g.nodes[SPA] = node(SPA, 'Frontend SPA', 'frontend-app', undefined, [OUT_PORT]);
  // 'vpc' stands in for the aws platform container: tests run without the catalog
  // resolver, and 'vpc' is in the STATIC container registry (in the app, the
  // catalog recognizes 'aws' the same way). Nesting semantics are identical.
  g.nodes[PLATFORM] = node(PLATFORM, 'AWS Cloud Platform', 'vpc');
  g.nodes[CF] = node(CF, 'CloudFront', 'cdn', PLATFORM, [IN_PORT]);
  // The MCP-proposed shape: no ports at all on the new nodes.
  g.nodes[WAF] = node(WAF, 'AWS WAF', 'waf', PLATFORM);
  g.nodes[S3] = node(S3, 'S3 Static Assets', 'object-storage', PLATFORM);
  g.nodes[VPC] = node(VPC, 'VPC', 'vpc', PLATFORM);
  g.nodes[ALB] = node(ALB, 'Application Load Balancer', 'load-balancer', VPC);
  const contract: Contract = { id: CONTRACT, kind: 'rest', name: 'traffic', schema: {}, metadata: {}, status: 'draft' } as Contract;
  g.contracts[CONTRACT] = contract;
  g.edges['e1'] = edge('dddddddd-0000-4000-8000-000000000001', SPA, CF);
  g.edges['e2'] = edge('dddddddd-0000-4000-8000-000000000002', CF, WAF);
  g.edges['e3'] = edge('dddddddd-0000-4000-8000-000000000003', CF, ALB);
  g.edges['e4'] = edge('dddddddd-0000-4000-8000-000000000004', CF, S3);
  return g;
}

describe('cross-container edge rendering (owner bench topology)', () => {
  it('classifies the deep-nested ALB edge as intra-container, not cross-container', () => {
    const g = ownerTopology();
    expect(classifyEdge(g.edges['e1'], g)).toBe('external');        // SPA(top) → CF(in platform)
    expect(classifyEdge(g.edges['e2'], g)).toBe('intra-container'); // CF → WAF (siblings)
    expect(classifyEdge(g.edges['e4'], g)).toBe('intra-container'); // CF → S3 (siblings)
    // THE regression: VPC sits INSIDE the platform — hiding this edge behind a
    // Platform→VPC summary made it vanish.
    expect(classifyEdge(g.edges['e3'], g)).toBe('intra-container');
  });

  it("summary mode (the DEFAULT) hides NONE of the owner's four edges", () => {
    const g = ownerTopology();
    const rfEdges = mapGraphToRFEdges(g, 'nested');
    expect(rfEdges).toHaveLength(4);
    // Mirror Canvas's summary-mode filter: only 'cross-container' gets hidden.
    const hidden = rfEdges.filter(e => e.data?.edgeVisibility === 'cross-container');
    expect(hidden).toHaveLength(0);
    expect(rfEdges.every(e => e.hidden !== true)).toBe(true);
  });

  it('never produces a parent→own-child container summary pair', () => {
    const g = ownerTopology();
    const summaries = computeCrossContainerSummaries(g);
    for (const [containerId, list] of summaries) {
      for (const s of list) {
        expect(
          containerId === PLATFORM && s.targetContainerId === VPC ||
          containerId === VPC && s.targetContainerId === PLATFORM,
          'degenerate Platform↔VPC summary must not exist'
        ).toBe(false);
      }
    }
  });

  it('sanitizes dead or direction-mismatched port handles instead of passing them to React Flow', () => {
    const g = ownerTopology();
    // Valid binding: SPA out-port → CF in-port — ids pass through.
    const valid = mapEdgeToRFEdge(edge('dddddddd-0000-4000-8000-000000000005', SPA, CF, {
      sourcePortId: OUT_PORT.id, targetPortId: IN_PORT.id,
    }), g);
    expect(valid.sourceHandle).toBe(OUT_PORT.id);
    expect(valid.targetHandle).toBe(IN_PORT.id);

    // Direction mismatch: CF's IN port used as the SOURCE — React Flow would drop
    // the edge silently; the binding must fall back to undefined instead.
    const mismatched = mapEdgeToRFEdge(edge('dddddddd-0000-4000-8000-000000000006', CF, WAF, {
      sourcePortId: IN_PORT.id,
    }), g);
    expect(mismatched.sourceHandle).toBeUndefined();

    // Dead id: port doesn't exist on the node — same fallback (hasError still flags it).
    const dead = mapEdgeToRFEdge(edge('dddddddd-0000-4000-8000-000000000007', CF, WAF, {
      sourcePortId: 'eeeeeeee-0000-4000-8000-000000000009', targetPortId: 'eeeeeeee-0000-4000-8000-00000000000a',
    }), g);
    expect(dead.sourceHandle).toBeUndefined();
    expect(dead.targetHandle).toBeUndefined();
    expect(dead.data?.hasError).toBe(true);
  });
});

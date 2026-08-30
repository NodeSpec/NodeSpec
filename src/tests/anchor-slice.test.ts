// P1-7 C2: the node context export is a strict per-node SLICE of the repo anchor.
// The fixture's anchorJson was produced by the Deno-side serializeModel
// (supabase/functions/_shared/model-anchor.ts, pinned byte-for-byte by
// supabase/functions/tests/anchor-golden_test.ts). Here we assert core's
// buildNodeAnchorSlice emits DEEP-EQUAL elements — same field names, same optional-field
// handling, same sorting, same contentHash — so an exported node matches the same node in
// `.nodespec/model.json` at HEAD, across two runtimes and two implementations.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildNodeAnchorSlice,
  serializeNodeAnchorSlice,
  NODE_SLICE_VERSION,
} from '@nodespec/core/anchor-slice.js';
import type { Graph } from '@nodespec/core/types.js';

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../supabase/functions/tests/fixtures/anchor-slice-golden.json'),
    'utf-8',
  ),
);
const anchor = JSON.parse(fixture.anchorJson);
const graph = fixture.graph as Graph;

const N2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('buildNodeAnchorSlice — one serialization contract with the model anchor', () => {
  it('node, edges, contracts, artifacts deep-equal the anchor elements (incl. contentHash)', async () => {
    const slice = await buildNodeAnchorSlice(graph, N2, {
      requirements: ['REQ-002', 'REQ-001'],
      taskDocPath: '.nodespec/tasks/api.task.md',
    });
    expect(slice).not.toBeNull();

    const anchorNode = anchor.nodes.find((n: { id: string }) => n.id === N2);
    expect(slice!.node).toEqual(anchorNode);

    const incident = anchor.edges.filter((e: { source: string; target: string }) => e.source === N2 || e.target === N2);
    expect(slice!.edges).toEqual(incident);

    const contractIds = new Set(incident.map((e: { contractId: string }) => e.contractId));
    const referenced = anchor.contracts.filter((c: { id: string }) => contractIds.has(c.id));
    expect(slice!.contracts).toEqual(referenced);

    const nodeArtifacts = anchor.artifacts.filter((a: { nodeId: string }) => a.nodeId === N2);
    expect(slice!.artifacts).toEqual(nodeArtifacts);
  });

  it('carries spec references and the packet pointer — nothing else on top of the slice', async () => {
    const slice = await buildNodeAnchorSlice(graph, N2, {
      requirements: ['REQ-002', 'REQ-001'],
      taskDocPath: '.nodespec/tasks/api.task.md',
    });
    expect(slice!.requirements).toEqual(['REQ-001', 'REQ-002']); // sorted
    expect(slice!.taskDocPath).toBe('.nodespec/tasks/api.task.md');
    expect(slice!.sliceVersion).toBe(NODE_SLICE_VERSION);
    expect(slice!.modelVersion).toBe(anchor.modelVersion);
    expect(Object.keys(slice!).sort()).toEqual([
      'artifacts', 'contracts', 'edges', 'generatedBy', 'modelVersion',
      'neighbors', 'node', 'nodeId', 'requirements', 'sliceVersion', 'taskDocPath',
    ]);
  });

  it('neighbors are id-sorted summaries; unknown node returns null; output is deterministic', async () => {
    const a = await buildNodeAnchorSlice(graph, N2, { requirements: ['REQ-001'] });
    const b = await buildNodeAnchorSlice(graph, N2, { requirements: ['REQ-001'] });
    expect(serializeNodeAnchorSlice(a!)).toBe(serializeNodeAnchorSlice(b!));
    expect(a!.neighbors.map(n => n.id)).toEqual([...a!.neighbors.map(n => n.id)].sort());
    expect(a!.neighbors).toHaveLength(2);
    expect(await buildNodeAnchorSlice(graph, 'not-a-node')).toBeNull();
  });
});

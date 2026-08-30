// Owner bench 2026-07-29: "clicked Bind after adding a file out-of-band — file
// detected, but did not bind to the node I selected." Reproduce the EXACT client
// lane: GraphEditor.handleBindResidueFile → buildResidueBindPatches → TWO
// sequential store.proposePatches calls against a realistic store.
import { describe, it, expect } from 'vitest';
import { createBranchStore } from '../ui/store/branch-store.js';
import { buildResidueBindPatches } from '../ui/utils/git-accept.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Graph, Node, Artifact } from '@nodespec/core/types.js';

const NODE_ID = '22222222-2222-4222-8222-222222222222';
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

function seededGraph(): Graph {
  const graph = createEmptyGraph();
  const node: Node = {
    id: NODE_ID,
    type: 'backend-service',
    label: 'Api',
    ports: [],
    artifacts: [],
    metadata: {},
    status: 'draft',
  };
  graph.nodes[NODE_ID] = node;
  return graph;
}

describe('residue bind through the REAL store (owner bench repro)', () => {
  it('two sequential proposePatches calls land the binding on the selected node', () => {
    const store = createBranchStore(seededGraph());
    const node = store.getState().derivedGraph.nodes[NODE_ID];
    const [addPatch, linkPatch] = buildResidueBindPatches(node, 'src/out-of-band.ts', 'x = 1', SHA);

    const r1 = store.proposePatches([addPatch]);
    expect(r1.success, `add_artifact failed: ${r1.error ?? ''}`).toBe(true);
    const r2 = store.proposePatches([linkPatch]);
    expect(r2.success, `update_node failed: ${r2.error ?? ''}`).toBe(true);

    const g = store.getState().derivedGraph;
    const arts = Object.values(g.artifacts) as Artifact[];
    expect(arts).toHaveLength(1);
    expect(arts[0].nodeId).toBe(NODE_ID);
    expect(arts[0].path).toBe('src/out-of-band.ts');
    expect(g.nodes[NODE_ID].artifacts).toContain(arts[0].id);
  });

  it('survives the full replay from base (what a reload/undo recompute does)', () => {
    const store = createBranchStore(seededGraph());
    const node = store.getState().derivedGraph.nodes[NODE_ID];
    const [addPatch, linkPatch] = buildResidueBindPatches(node, 'docs/NOTES.md', 'hello', SHA);
    store.proposePatches([addPatch]);
    store.proposePatches([linkPatch]);
    // Force a recompute-from-base by switching to the same patches (replay lane).
    const patches = store.getState().activeBranch.patches;
    store.switchToBranch(generateUUID(), 'replay-check', patches);
    const g = store.getState().derivedGraph;
    expect(Object.values(g.artifacts)).toHaveLength(1);
    expect(g.nodes[NODE_ID].artifacts).toHaveLength(1);
  });
});

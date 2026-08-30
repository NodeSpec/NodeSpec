// R3-4c: the manual attribution lane — binding an unattributed repo file (residue)
// to a node creates a REAL, valid binding pair (add_artifact + node-array link)
// stamped with the shared provenance convention.
import { describe, it, expect } from 'vitest';
import { buildResidueBindPatches, inferArtifactKindFromPath } from '../ui/utils/git-accept.js';
import { applyPatches } from '@nodespec/core/patch-engine.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Artifact, Graph, Node } from '@nodespec/core/types.js';

const NODE_ID = '22222222-2222-4222-8222-222222222222';
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

function graphWithNode(): { graph: Graph; node: Node } {
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
  return { graph, node };
}

describe('inferArtifactKindFromPath', () => {
  it('maps common extensions to kinds, defaulting to source', () => {
    expect(inferArtifactKindFromPath('docs/README.md')).toBe('doc');
    expect(inferArtifactKindFromPath('db/schema.sql')).toBe('schema');
    expect(inferArtifactKindFromPath('config/app.yaml')).toBe('config');
    expect(inferArtifactKindFromPath('Dockerfile')).toBe('build');
    expect(inferArtifactKindFromPath('src/worker.rs')).toBe('source');
    expect(inferArtifactKindFromPath('no-extension')).toBe('source');
  });
});

describe('buildResidueBindPatches (R3-4c)', () => {
  it('produces a binding pair that applies cleanly IN SEQUENCE: artifact exists, node links it, provenance stamped', () => {
    const { graph, node } = graphWithNode();
    const patches = buildResidueBindPatches(node, 'src/new-service.ts', 'export const x = 1;', SHA);
    expect(patches).toHaveLength(2);

    // Sequential application is the contract (the engine's dependency sort puts
    // update_node before add_artifact inside one batch — see the builder's doc).
    const first = applyPatches(graph, [patches[0]]);
    expect(first.success).toBe(true);
    if (!first.success || !first.graph) return;
    const result = applyPatches(first.graph, [patches[1]]);
    expect(result.success).toBe(true);
    if (!result.success || !result.graph) return;
    const applied = result.graph;

    const artifacts = Object.values(applied.artifacts) as Artifact[];
    expect(artifacts).toHaveLength(1);
    const bound = artifacts[0];
    expect(bound.nodeId).toBe(NODE_ID);
    expect(bound.path).toBe('src/new-service.ts');
    expect(bound.kind).toBe('source');
    expect(bound.status).toBe('draft');
    expect(bound.content).toBe('export const x = 1;');
    expect(bound.sourceProvenance).toBe('git-residue-bind');
    const prov = (bound.metadata as Record<string, unknown>).provenance as Record<string, unknown>;
    expect(prov.origin).toBe('git-residue-bind');
    expect(prov.commitSha).toBe(SHA);

    expect(applied.nodes[NODE_ID].artifacts).toContain(bound.id);
  });

  it('heals a stale dangling artifact id FIRST, then binds (the owner-bench silent failure)', () => {
    // 2026-07-29: the bench node carried an artifact id whose artifact no longer
    // existed — applyPatches' whole-graph validation failed EVERY subsequent patch
    // ("node references non-existent artifact"), so the bind died before anything
    // applied. The builder now leads with a heal patch pruning stale ids.
    const { graph, node } = graphWithNode();
    const staleId = generateUUID();
    node.artifacts = [staleId];
    graph.nodes[NODE_ID] = node;

    const liveIds = new Set(Object.keys(graph.artifacts));
    const patches = buildResidueBindPatches(node, 'src/out-of-band.ts', 'x', SHA, liveIds);
    expect(patches).toHaveLength(3);
    expect(patches[0].metadata.summary).toContain('Prune 1 stale artifact reference');

    let g: Graph = graph;
    for (const p of patches) {
      const r = applyPatches(g, [p]);
      expect(r.success, `${p.metadata.summary} failed: ${JSON.stringify((r as unknown as Record<string, unknown>).error)}`).toBe(true);
      if (!r.success || !r.graph) return;
      g = r.graph;
    }

    const arts = g.nodes[NODE_ID].artifacts ?? [];
    expect(arts).toHaveLength(1);
    expect(arts).not.toContain(staleId);
    expect(Object.values(g.artifacts)).toHaveLength(1);
  });

  it('appends to an existing artifacts array instead of replacing it', () => {
    const { graph, node } = graphWithNode();
    const existingId = generateUUID();
    node.artifacts = [existingId];
    graph.nodes[NODE_ID] = node;

    const patches = buildResidueBindPatches(node, 'docs/NOTES.md', '', undefined);
    const nodePatch = patches[patches.length - 1];
    const updates = (nodePatch.payload as { changes: { artifacts: string[] } }).changes;
    expect(updates.artifacts).toHaveLength(2);
    expect(updates.artifacts[0]).toBe(existingId);
  });
});

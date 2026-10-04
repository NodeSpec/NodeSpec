// AA.3 (owner 2026-09-23): exploding a node moves its files to the parts
// that own them, and collapsing moves them back. A finished file moves too:
// the move changes where it lives, not what it is. Anything else about a
// finished file still needs it back in draft first.
import { describe, expect, it } from 'vitest';
import { validatePatch } from '@nodespec/core/patch-engine.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import type { Artifact, Graph, Node, PatchOperation } from '@nodespec/core/types.js';

const NODE = '00000000-0000-4000-8000-000000000001';
const PART = '00000000-0000-4000-8000-000000000002';
const FILE = '00000000-0000-4000-8000-000000000003';

function graph(): Graph {
  const g = createEmptyGraph();
  g.nodes[NODE] = { id: NODE, type: 'backend-service', label: 'Checkout API', data: {}, metadata: {}, artifacts: [FILE] } as Node;
  g.nodes[PART] = { id: PART, type: 'part-handler', label: 'Routes', parentId: NODE, data: {}, metadata: {} } as Node;
  g.artifacts[FILE] = { id: FILE, nodeId: NODE, path: 'src/routes/orders.ts', kind: 'source', status: 'complete', content: 'export {}' } as Artifact;
  return g;
}

const update = (changes: Record<string, unknown>): PatchOperation => ({
  type: 'update_artifact',
  metadata: { id: '00000000-0000-4000-8000-0000000000aa', actorType: 'ai', summary: 'move', timestamp: new Date().toISOString() },
  payload: { id: FILE, changes },
} as PatchOperation);

describe('AA.3 a finished file moves with its part', () => {
  it('a move alone is allowed on a complete artifact', () => {
    expect(validatePatch(graph(), update({ nodeId: PART })).valid).toBe(true);
  });
  it('a move with any other change still needs the file back in draft', () => {
    const r = validatePatch(graph(), update({ nodeId: PART, content: 'changed' }));
    expect(r.valid).toBe(false);
    expect(r.errors[0].code).toBe('ARTIFACT_IMMUTABLE');
  });
});

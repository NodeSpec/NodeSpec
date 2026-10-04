/**
 * V3 2.1 (2026-09-19): base_sequence rests on one pure question, "what does
 * this patch touch", answered once in core and mirrored for the Deno
 * functions. The mirror is pinned byte-identical; the rest is behaviour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  patchTargets, conflictsSince, describeConflicts, laterPatchFromRow, patchesTouchingNode, layoutOnly,
} from '@nodespec/core/patch-targets.js';

const N1 = '11111111-1111-4111-8111-111111111111';
const N2 = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333';
const C1 = '44444444-4444-4444-8444-444444444444';
const A1 = '55555555-5555-4555-8555-555555555555';
const P1 = '66666666-6666-4666-8666-666666666666';

describe('the Deno mirror', () => {
  it('is byte-identical to core', () => {
    expect(readFileSync('supabase/functions/_shared/patch-targets.ts', 'utf8'))
      .toBe(readFileSync('core/src/patch-targets.ts', 'utf8'));
  });
});

describe('patchTargets', () => {
  it('names the entity an op creates, changes or removes', () => {
    expect(patchTargets({ type: 'update_node', payload: { id: N1 } })).toEqual({ primary: N1, touched: [] });
    expect(patchTargets({ type: 'remove_contract', payload: { id: C1 } })).toEqual({ primary: C1, touched: [] });
    expect(patchTargets({ type: 'set_edge_criticality', payload: { id: E1 } })).toEqual({ primary: E1, touched: [] });
    expect(patchTargets({ type: 'update_node_group', payload: { id: N2 } })).toEqual({ primary: N2, touched: [] });
  });
  it('adds what an op depends on: edge endpoints, an artifact or port node', () => {
    expect(patchTargets({ type: 'add_edge', payload: { id: E1, source: N1, target: N2, contractId: C1 } }))
      .toEqual({ primary: E1, touched: [N1, N2] });
    expect(patchTargets({ type: 'add_artifact', payload: { id: A1, nodeId: N1 } })).toEqual({ primary: A1, touched: [N1] });
    expect(patchTargets({ type: 'update_port', payload: { nodeId: N1, portId: P1 } })).toEqual({ primary: P1, touched: [N1] });
    expect(patchTargets({ type: 'add_port', payload: { nodeId: N1, port: { id: P1, name: 'in' } } })).toEqual({ primary: P1, touched: [N1] });
    expect(patchTargets({ type: 'connect_ports', payload: { edgeId: E1, sourceNodeId: N1, targetNodeId: N2, sourcePortId: P1, targetPortId: P1, contractId: C1 } }))
      .toEqual({ primary: E1, touched: [N1, N2] });
    expect(patchTargets({ type: 'mark_entity_complete', payload: { entityType: 'node', entityId: N1 } })).toEqual({ primary: N1, touched: [] });
  });
  it('treats the graph metadata as one entity, and unknown or spec ops as nothing', () => {
    expect(patchTargets({ type: 'update_graph_metadata', payload: { changes: { name: 'x' } } }).primary).toBe('__graph__');
    expect(patchTargets({ type: 'update_requirement', payload: { requirementId: 'REQ-1' } })).toEqual({ primary: null, touched: [] });
    expect(patchTargets({ type: 'add_node' })).toEqual({ primary: null, touched: [] });
  });
});

describe('conflictsSince', () => {
  const later = (sequence: number, type: string, payload: Record<string, unknown>, actorType = 'human', summary = 'moved it') =>
    ({ sequence, type, payload, actorType, summary });

  it('flags a proposed change to an entity a later patch changed', () => {
    const c = conflictsSince(
      [{ type: 'update_node', payload: { id: N1, changes: { label: 'B' } }, metadata: { id: 'p-1' } }],
      [later(9, 'update_node', { id: N1, changes: { label: 'A' } })],
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ index: 0, patchId: 'p-1', targetId: N1, laterSequence: 9, laterType: 'update_node', laterActor: 'human' });
  });
  it('AL.11: a later move or resize overtakes nothing; a later reparent does', () => {
    const N9 = 'aaaaaaaa-0000-4000-8000-000000000009';
    const proposed = [
      { type: 'update_node', payload: { id: N1, changes: { artifacts: ['f1'] } } },
      { type: 'add_edge', payload: { id: 'e1', source: N1, target: N9 } },
    ];
    expect(conflictsSince(proposed, [later(9, 'update_node', { id: N1, changes: { position: { x: 1, y: 2 }, metadata: { width: 300 } } })])).toEqual([]);
    expect(conflictsSince(proposed, [later(9, 'update_node', { id: N1, changes: { position: { x: 1, y: 2 }, parentId: N9 } })])).toHaveLength(2);
    expect(layoutOnly({ type: 'update_node', payload: { id: N1, changes: {} } })).toBe(false);
    expect(layoutOnly({ type: 'update_node', payload: { id: N1 } })).toBe(false);
    expect(layoutOnly({ type: 'update_node', payload: { id: N1, changes: { metadata: { owner: 'x' } } } })).toBe(false);
    expect(layoutOnly({ type: 'remove_node', payload: { id: N1 } })).toBe(false);
  });
  it('flags an edge whose endpoint was removed after the read', () => {
    const c = conflictsSince(
      [{ type: 'add_edge', payload: { id: E1, source: N1, target: N2, contractId: C1 } }],
      [later(4, 'remove_node', { id: N2 }, 'ai', 'dropped the cache')],
    );
    expect(c.map((x) => x.targetId)).toEqual([N2]);
  });
  it('ignores later adds of other ids, contract edits under an edge, and unrelated entities', () => {
    const proposed = [{ type: 'add_edge', payload: { id: E1, source: N1, target: N2, contractId: C1 } }, { type: 'update_node', payload: { id: N1 } }];
    const c = conflictsSince(proposed, [
      later(5, 'add_node', { id: A1 }),
      later(6, 'update_contract', { id: C1 }),
      later(7, 'update_node', { id: N2 }),
    ]);
    // only the edge's endpoint N2 moved; N1's update is untouched
    expect(c).toEqual([expect.objectContaining({ index: 0, targetId: N2, laterSequence: 7 })]);
  });
  it('two metadata edits collide; nothing collides when nothing came after', () => {
    expect(conflictsSince([{ type: 'update_graph_metadata', payload: { changes: {} } }], [later(2, 'update_graph_metadata', { changes: {} })])).toHaveLength(1);
    expect(conflictsSince([{ type: 'update_node', payload: { id: N1 } }], [])).toEqual([]);
  });
  it('reads a graph_patches row (the payload column is the whole envelope)', () => {
    const l = laterPatchFromRow({ sequence: '12', patch_type: 'update_node', actor_type: 'human', summary: 'renamed', payload: { type: 'update_node', payload: { id: N1 }, metadata: { id: 'x' } } });
    expect(l).toEqual({ sequence: 12, type: 'update_node', payload: { id: N1 }, actorType: 'human', summary: 'renamed' });
  });
  it('describes each conflict in one sentence the agent can act on', () => {
    const text = describeConflicts(conflictsSince(
      [{ type: 'update_node', payload: { id: N1 } }],
      [later(9, 'update_node', { id: N1 }, 'human', 'renamed to Cache')],
    ));
    expect(text).toBe(`patch[0] update_node targets ${N1}, which the user changed at sequence 9 with update_node (renamed to Cache).`);
  });
  it('lists the later patches that touched a node, for the hold on that node', () => {
    const rows = [later(1, 'update_node', { id: N1 }), later(2, 'add_edge', { id: E1, source: N2, target: N1 }), later(3, 'update_node', { id: N2 })];
    expect(patchesTouchingNode(rows, N1).map((p) => p.sequence)).toEqual([1, 2]);
  });
});

import { describe, it, expect } from 'vitest';
import { acceptLeaseRefusal, type LeaseRowLite } from '../ui/components/ideation/node-leases.js';
import { conflictsSince } from '@nodespec/core/patch-targets.js';

// AL.11 (owner 2026-10-01: "Fix task document checkout, this is critical").
// The server side (generate_task_docs leaves a held node's document as it is,
// a waiting proposal holds its document, the proposal records the graph it
// was generated from) is in supabase/functions/tests/al11-task-doc-checkout_test.ts.
// These hold the accept: a task document is its node's work, so accepting a
// change to it while someone else works on the node is refused, and a
// document that changed after it was generated is never overwritten.

const NODE = 'aaaaaaaa-0000-4000-8000-000000000001';
const BOX = 'aaaaaaaa-0000-4000-8000-000000000002';
const PART = 'aaaaaaaa-0000-4000-8000-000000000003';
const DOC = 'bbbbbbbb-0000-4000-8000-000000000001';
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const graph = {
  nodes: { [NODE]: { parentId: null }, [BOX]: { parentId: null }, [PART]: { parentId: BOX } },
  edges: { e1: { source: PART, target: NODE } },
  artifacts: { [DOC]: { nodeId: NODE } },
};
const docUpdate = [{ type: 'update_artifact', payload: { id: DOC, changes: { content: '# regenerated' } } }];
const workOn = (nodeId: string, level = 'task', minutesSinceBeat = 1): LeaseRowLite => ({
  level, node_id: nodeId, holder_label: 'codex · lead', holder_delegate: 'key:k2', since: ago(12), heartbeat_at: ago(minutesSinceBeat),
});

describe('AL.11 · accepting a task document while its node is worked on', () => {
  it('is refused naming who works there: the file counts as its node', () => {
    const refusal = acceptLeaseRefusal(docUpdate, [workOn(NODE)], ['key:k9', 'user:me'], graph);
    expect(refusal).toContain('is being worked on by codex · lead');
    expect(refusal).toContain('A leased node is locked');
  });

  it('passes for the proposal\'s own author, the person accepting, a stale hold, and another node', () => {
    expect(acceptLeaseRefusal(docUpdate, [workOn(NODE)], ['key:k2', 'user:me'], graph)).toBeNull();
    expect(acceptLeaseRefusal(docUpdate, [{ ...workOn(NODE), holder_delegate: 'user:me' }], ['key:k9', 'user:me'], graph)).toBeNull();
    expect(acceptLeaseRefusal(docUpdate, [workOn(NODE, 'task', 45)], ['key:k9'], graph)).toBeNull();
    expect(acceptLeaseRefusal(docUpdate, [workOn(BOX)], ['key:k9'], graph)).toBeNull();
  });

  it('an edge counts as its two ends, and a part as its held box', () => {
    expect(acceptLeaseRefusal([{ type: 'remove_edge', payload: { id: 'e1' } }], [workOn(NODE)], ['key:k9'], graph)).toContain('codex · lead');
    const partFile = [{ type: 'update_node', payload: { id: PART, changes: { technology: 'fastify' } } }];
    expect(acceptLeaseRefusal(partFile, [workOn(BOX, 'node')], ['key:k9'], graph, (id) => id === BOX)).toContain('a part of');
    expect(acceptLeaseRefusal(partFile, [workOn(BOX, 'node')], ['key:k9'], graph, () => false)).toBeNull();
  });

  it('without the graph a file cannot be traced, and the node\'s own patches still are', () => {
    expect(acceptLeaseRefusal(docUpdate, [workOn(NODE)], ['key:k9'], null)).toBeNull();
    expect(acceptLeaseRefusal([{ type: 'update_node', payload: { id: NODE, changes: { technology: 'x' } } }], [workOn(NODE)], ['key:k9'], null)).toContain('codex · lead');
  });
});

describe('AL.11 · a document that changed after it was generated', () => {
  // generate_task_docs files these shapes with metadata.baseSequence; the
  // accept reads the branch's later patches against them and applies nothing
  // on a conflict.
  const regenerated = [{ type: 'update_artifact', metadata: { id: 'p1' }, payload: { id: DOC, changes: { content: '# v2' } } }];
  const firstDoc = [
    { type: 'add_artifact', metadata: { id: 'p1' }, payload: { id: DOC, nodeId: NODE, kind: 'task' } },
    { type: 'update_node', metadata: { id: 'p2' }, payload: { id: NODE, changes: { artifacts: [DOC] } } },
  ];

  it('a later edit to the document, or to the node a new document links into, conflicts', () => {
    const edited = conflictsSince(regenerated, [{ sequence: 42, type: 'update_artifact', payload: { id: DOC, changes: { content: '# expanded by hand' } } }]);
    expect(edited.map((c) => [c.index, c.targetId, c.laterSequence])).toEqual([[0, DOC, 42]]);
    const linked = conflictsSince(firstDoc, [{ sequence: 43, type: 'update_node', payload: { id: NODE, changes: { artifacts: ['other-file'] } } }]);
    expect(linked.map((c) => c.index)).toEqual([0, 1]);
  });

  it('a later change elsewhere does not, nor does dragging the node around before accepting', () => {
    expect(conflictsSince(regenerated, [{ sequence: 44, type: 'update_node', payload: { id: BOX, changes: { label: 'Cluster' } } }])).toEqual([]);
    expect(conflictsSince(firstDoc, [{ sequence: 45, type: 'update_node', payload: { id: NODE, changes: { position: { x: 40, y: 80 } } } }])).toEqual([]);
  });
});

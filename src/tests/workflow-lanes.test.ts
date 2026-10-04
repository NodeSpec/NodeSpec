import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assembleLanes,
  splitLanes,
  nextSortOrder,
  reorderSwap,
  reorderByDrag,
  type WorkflowRow,
  type WorkflowStepRow,
} from '../ui/components/ideation/useWorkflowLanes.js';

// V3 P4 (task 4.1) → V3 4.1: the lane model. LANES are v3c `workflows` +
// `workflow_steps`; assembly, ordering, append position, swap reorder and
// drag reorder are pure and pinned here. How many lanes a plan may have is
// no longer a lane-model question: P (2026-09-22) made it the workflow_space
// gate (none below Indie, no cap from Indie up), pinned in individual-variant. The board that rendered them (WorkflowBoard) retired
// with V3 4.1; Work's Requirements list reads the same hook (work-requirements.test.tsx).




const wf = (id: string, name: string, sort: number | null, kind?: string | null): WorkflowRow =>
  ({ id, name, kind, color: null, owner_label: null, contributors: null, sort_order: sort });
const st = (id: string, workflowId: string, name: string, sort: number | null): WorkflowStepRow =>
  ({ id, workflow_id: workflowId, name, sort_order: sort });

describe('assembleLanes', () => {
  it('groups steps under their lane, orders both by sort_order then name', () => {
    const lanes = assembleLanes(
      [wf('b', 'Buyer journey', 1), wf('a', 'Admin ops', 0)],
      [st('s2', 'b', 'Checkout', 1), st('s1', 'b', 'Browse', 0), st('s3', 'a', 'Review', 0)],
    );
    expect(lanes.map((l) => l.name)).toEqual(['Admin ops', 'Buyer journey']);
    expect(lanes[1].steps.map((s) => s.name)).toEqual(['Browse', 'Checkout']);
    expect(lanes[0].steps.map((s) => s.name)).toEqual(['Review']);
  });

  it('ties on sort_order break by name; null orders read as 0; junk contributors read as empty', () => {
    const lanes = assembleLanes(
      [wf('x', 'Zeta', null), wf('y', 'Alpha', null)],
      [],
    );
    expect(lanes.map((l) => l.name)).toEqual(['Alpha', 'Zeta']);
    expect(lanes[0].contributors).toEqual([]);
  });

  it('steps of a lane missing from the read drop silently (mid-flight delete), never a crash', () => {
    const lanes = assembleLanes([wf('a', 'Only', 0)], [st('s1', 'GONE', 'Orphan', 0), st('s2', 'a', 'Kept', 0)]);
    expect(lanes[0].steps.map((s) => s.name)).toEqual(['Kept']);
  });
});

// ── V3 6.6 (2026-09-21): the import's home lane is a system lane, not a workflow row ──
describe('V3 6.6 · workflows.kind: the imported lane is read, and kept apart from the workflows', () => {
  it('assembleLanes carries the kind; a row without one (read before the column) is a workflow', () => {
    const lanes = assembleLanes([wf('a', 'Blockout', 0), wf('i', 'Imported', 2, 'imported'), wf('b', 'Delivery', 1, 'workflow'), wf('z', 'Old', 3, null)], []);
    expect(lanes.map((l) => [l.name, l.kind])).toEqual([['Blockout', 'workflow'], ['Delivery', 'workflow'], ['Imported', 'imported'], ['Old', 'workflow']]);
  });

  it('splitLanes: the workflows Work draws as rows, and the one imported lane the aside\'s Imported row stands for', () => {
    const lanes = assembleLanes([wf('a', 'Blockout', 0), wf('i', 'Imported', 2, 'imported'), wf('b', 'Delivery', 1)], []);
    const split = splitLanes(lanes);
    expect(split.workflows.map((l) => l.id)).toEqual(['a', 'b']);
    expect(split.imported?.id).toBe('i');
    expect(splitLanes(assembleLanes([wf('a', 'Only', 0)], [])).imported).toBeNull();
    // the Imported lane is never counted as a workflow a person made
    expect(splitLanes(assembleLanes([wf('i', 'Imported', 0, 'imported')], [])).workflows).toEqual([]);
  });

  it('the hook reads kind, hands Work the workflows only, and names the imported lane apart', () => {
    const hook = readFileSync(resolve(process.cwd(), 'src/ui/components/ideation/useWorkflowLanes.ts'), 'utf8');
    expect(hook).toContain(".select('id, name, kind, color, owner_label, contributors, sort_order')");
    expect(hook).toContain('const split = splitLanes(assembleLanes(workflows, steps));');
    expect(hook).toContain('setLanes(split.workflows);');
    expect(hook).toContain('setImportedLaneId(split.imported?.id ?? null);');
  });
});

describe('nextSortOrder: append position, never a sibling reindex', () => {
  it('empty starts at 0; otherwise max + 1 (gaps preserved)', () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 7 }])).toBe(8);
  });
});

describe('reorderSwap: one swap, two writes, honest edges', () => {
  const items = [
    { id: 'a', sortOrder: 0 },
    { id: 'b', sortOrder: 1 },
    { id: 'c', sortOrder: 2 },
  ];
  it('swaps sort orders with the neighbor in the given direction', () => {
    expect(reorderSwap(items, 'b', 'up')).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
    ]);
    expect(reorderSwap(items, 'b', 'down')).toEqual([
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: 1 },
    ]);
  });
  it('edges and unknown ids return null — the button is a no-op, not a write', () => {
    expect(reorderSwap(items, 'a', 'up')).toBeNull();
    expect(reorderSwap(items, 'c', 'down')).toBeNull();
    expect(reorderSwap(items, 'nope', 'up')).toBeNull();
  });
  it('equal legacy orders still produce a strict move, never a no-op swap', () => {
    const flat = [{ id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 0 }];
    const writes = reorderSwap(flat, 'b', 'up')!;
    const b = writes.find((w) => w.id === 'b')!;
    const a = writes.find((w) => w.id === 'a')!;
    expect(b.sortOrder).toBeLessThan(a.sortOrder);
  });
});
describe('reorderByDrag', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('dragging forward drops AFTER the pill it lands on', () => {
    expect(reorderByDrag(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderByDrag(ids, 'a', 'd')).toEqual(['b', 'c', 'd', 'a']);
  });
  it('dragging backward drops BEFORE the pill it lands on', () => {
    expect(reorderByDrag(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(reorderByDrag(ids, 'c', 'a')).toEqual(['c', 'a', 'b', 'd']);
  });
  it('a no-op drop, or an id that is not in the list, returns the same order as a fresh array', () => {
    expect(reorderByDrag(ids, 'b', 'b')).toEqual(ids);
    expect(reorderByDrag(ids, 'zz', 'b')).toEqual(ids);
    expect(reorderByDrag(ids, 'b', 'zz')).toEqual(ids);
    expect(reorderByDrag(ids, 'b', 'b')).not.toBe(ids);
  });
  it('never loses or duplicates a step', () => {
    for (const from of ids) for (const over of ids) {
      expect([...reorderByDrag(ids, from, over)].sort()).toEqual([...ids].sort());
    }
  });
});

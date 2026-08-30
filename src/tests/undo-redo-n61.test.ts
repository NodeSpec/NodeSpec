// N6.1 (owner 2026-07-25): "add undo and redo functionality that can revert the canvas
// since canvas changes are not automatic pushes to git."
//
// Undo/redo operate on whole-GRAPH snapshots, not on the patch list, because
//   · the 3-second autosave flattens pending patches into a new base and clears them,
//     so a patch-list undo dies seconds after any edit; and
//   · `graph_patches` is append-only + hash-chained (guardrail i) — a persisted patch
//     can never be un-persisted.
// The log therefore keeps every forward edit; the SNAPSHOT is what moves back.
import { describe, it, expect } from 'vitest';
import { createBranchStore } from '../ui/store/branch-store.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import { createAddNodePatch } from '@nodespec/core/patch-factory.js';
import type { Node } from '@nodespec/core/types.js';

const N1 = '11111111-1111-1111-1111-111111111111';
const N2 = '22222222-2222-2222-2222-222222222222';

const node = (id: string): Node => ({ id, type: 'backend-service', label: `Node ${id.slice(0, 4)}`, metadata: {} });
const opts = { actorType: 'human' as const, summary: 'test edit' };

function storeWithTwoNodes() {
  const store = createBranchStore(createEmptyGraph());
  store.proposePatches([createAddNodePatch(node(N1), opts)]);
  store.proposePatches([createAddNodePatch(node(N2), opts)]);
  return store;
}

describe('N6.1 canvas undo/redo', () => {
  it('undo restores the previous canvas; redo replays it', () => {
    const store = storeWithTwoNodes();
    expect(Object.keys(store.getState().derivedGraph.nodes)).toHaveLength(2);

    expect(store.undo()).toBe(true);
    expect(Object.keys(store.getState().derivedGraph.nodes)).toEqual([N1]);

    expect(store.redo()).toBe(true);
    expect(Object.keys(store.getState().derivedGraph.nodes).sort()).toEqual([N1, N2].sort());
  });

  it('undo walks back multiple steps to the empty canvas', () => {
    const store = storeWithTwoNodes();
    store.undo();
    store.undo();
    expect(Object.keys(store.getState().derivedGraph.nodes)).toHaveLength(0);
    expect(store.canUndo()).toBe(false);
    expect(store.undo()).toBe(false); // nothing left to undo
  });

  it('the restored graph becomes the BASE and pending patches are cleared', () => {
    // Replaying pending patches onto the restored base would re-apply the very edit
    // being reverted, so undo clears them. Already-persisted patches stay in the log.
    const store = storeWithTwoNodes();
    expect(store.getState().activeBranch.patches.length).toBeGreaterThan(0);

    store.undo();
    const state = store.getState();
    expect(state.activeBranch.patches).toHaveLength(0);
    expect(Object.keys(state.baseSnapshotGraph.nodes)).toEqual([N1]);
    expect(Object.keys(state.derivedGraph.nodes)).toEqual([N1]);
  });

  it('bumps graphRevision so the editor persists the reverted snapshot', () => {
    // Autosave only fires while patches exist; without this counter a revert-to-empty
    // would never reach the DB and a reload would resurrect the undone state.
    const store = storeWithTwoNodes();
    const before = store.getState().graphRevision;
    store.undo();
    expect(store.getState().graphRevision).toBe(before + 1);
    store.redo();
    expect(store.getState().graphRevision).toBe(before + 2);
  });

  it('a NEW edit after undo forks history — the redo stack is dropped', () => {
    const store = storeWithTwoNodes();
    store.undo();
    expect(store.canRedo()).toBe(true);

    store.proposePatches([createAddNodePatch(node('33333333-3333-3333-3333-333333333333'), opts)]);
    expect(store.canRedo()).toBe(false);
    expect(Object.keys(store.getState().derivedGraph.nodes).sort())
      .toEqual([N1, '33333333-3333-3333-3333-333333333333'].sort());
  });

  it('canUndo/canRedo report the stack ends', () => {
    const store = createBranchStore(createEmptyGraph());
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(store.redo()).toBe(false);

    store.proposePatches([createAddNodePatch(node(N1), opts)]);
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);
  });

  it('switching branches clears both stacks (history is per canvas)', () => {
    const store = storeWithTwoNodes();
    store.switchToBranch('branch-2', 'feature', []);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('the undo stack is bounded — deep edit runs do not grow memory without limit', () => {
    const store = createBranchStore(createEmptyGraph());
    for (let i = 0; i < 40; i++) {
      store.proposePatches([createAddNodePatch(node(`${i}`.padStart(8, '0') + '-1111-1111-1111-111111111111'), opts)]);
    }
    expect(store.getState().undoStack.length).toBeLessThanOrEqual(25);
    expect(store.canUndo()).toBe(true);
  });
});

// N6.1 FIX (owner-caught 2026-07-25: "the undo/redo doesn't seem like it will work if
// autosave is a feature… undo becomes unavailable after autosave kicks"). It didn't:
// the autosave commit called setBaseSnapshot + switchToBranch, and BOTH clear the
// stacks — so history died ~3 seconds after every edit. These pins reproduce the
// autosave sequence the editor runs.
describe('N6.1 undo survives autosave', () => {
  /** What saveDraftInternal does after persisting: the saved graph becomes the base
   *  and only patches proposed during the save survive. */
  const simulateAutosave = (store: ReturnType<typeof createBranchStore>) => {
    const { derivedGraph } = store.getState();
    store.commitSavedSnapshot(derivedGraph, []);
  };

  it('keeps undo available after an autosave', () => {
    const store = storeWithTwoNodes();
    simulateAutosave(store);

    expect(store.getState().activeBranch.patches).toHaveLength(0); // saved
    expect(store.canUndo()).toBe(true);                            // …but revertible
  });

  it('undo after autosave actually reverts the canvas', () => {
    const store = storeWithTwoNodes();
    simulateAutosave(store);

    expect(store.undo()).toBe(true);
    expect(Object.keys(store.getState().derivedGraph.nodes)).toEqual([N1]);
    expect(store.redo()).toBe(true);
    expect(Object.keys(store.getState().derivedGraph.nodes).sort()).toEqual([N1, N2].sort());
  });

  it('survives an autosave after EVERY edit — the real 3-second cadence', () => {
    const store = createBranchStore(createEmptyGraph());
    const ids = [N1, N2, '33333333-3333-3333-3333-333333333333'];
    for (const id of ids) {
      store.proposePatches([createAddNodePatch(node(id), opts)]);
      simulateAutosave(store); // autosave fires between every edit
    }
    expect(Object.keys(store.getState().derivedGraph.nodes)).toHaveLength(3);

    store.undo();
    store.undo();
    store.undo();
    expect(Object.keys(store.getState().derivedGraph.nodes)).toHaveLength(0);
  });

  it('documents the bug: the OLD save sequence wiped history', () => {
    // setBaseSnapshot (graph replaced from outside) and switchToBranch (different
    // canvas) both clear the stacks BY DESIGN. The autosave commit used both, which is
    // why undo died seconds after every edit. Keeping this pin means a future refactor
    // that routes saving back through them fails here instead of on the bench.
    const store = storeWithTwoNodes();
    expect(store.canUndo()).toBe(true);
    store.setBaseSnapshot(store.getState().derivedGraph);
    expect(store.canUndo()).toBe(false);
  });

  it('a genuine branch switch still clears history (different canvas)', () => {
    const store = storeWithTwoNodes();
    simulateAutosave(store);
    expect(store.canUndo()).toBe(true);

    store.switchToBranch('other-branch', 'feature', []);
    expect(store.canUndo()).toBe(false);
  });

  it('keeps the branch identity and carries in-flight patches like switchToBranch did', () => {
    // Debt audit 2026-07-29: pendingMergeToMain was write-only production state
    // (no reader outside this test) and was removed with the R3-3b merge rework;
    // the invariant this test guards is branch identity + in-flight patch carry.
    const store = createBranchStore(createEmptyGraph());
    store.switchToBranch('b1', 'feature', []);
    store.proposePatches([createAddNodePatch(node(N1), opts)]);
    const pending = store.getState().activeBranch.patches;

    // Mid-save: patches proposed while the save was in flight carry forward.
    store.commitSavedSnapshot(createEmptyGraph(), pending);
    expect(store.getState().activeBranch.patches.length).toBeGreaterThan(0);
    expect(store.getState().activeBranch.id).toBe('b1');
    expect(store.getState().activeBranch.name).toBe('feature');

    // Fully saved: nothing pending carries forward.
    store.commitSavedSnapshot(store.getState().derivedGraph, []);
    expect(store.getState().activeBranch.patches.length).toBe(0);
    expect(store.canUndo()).toBe(true);
  });
});

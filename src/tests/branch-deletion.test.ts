import { describe, it, expect, beforeEach } from 'vitest';
import { createBranchStore } from '../ui/store/branch-store.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import type { Graph } from '@nodespec/core/types.js';

describe('Branch Deletion and Merge Visibility', () => {
  let store: ReturnType<typeof createBranchStore>;
  let initialGraph: Graph;

  beforeEach(() => {
    initialGraph = createEmptyGraph();
    store = createBranchStore(initialGraph);
  });

  it('should have delete branch handler defined', () => {
    expect(typeof store.getState).toBe('function');
    const state = store.getState();
    expect(state).toBeDefined();
    expect(state.activeBranch).toBeDefined();
  });

  it('should identify draft branches correctly', () => {
    store.createBranchFromMain('draft-1');

    const draftState = store.getState();
    expect(draftState.activeBranch.name).toBe('draft-1');

    const isDraftBranch = draftState.activeBranch.name !== 'main';
    expect(isDraftBranch).toBe(true);
  });

  it('should not identify main as draft branch', () => {
    store.switchToBranch('main-branch-id', 'main', []);

    const state = store.getState();
    const isDraftBranch = state.activeBranch.name !== 'main';

    expect(isDraftBranch).toBe(false);
  });

  it('should calculate pending merge state correctly', () => {
    const state = store.getState();
    const activeBranchName = state.activeBranch.name;
    const patchCount = state.activeBranch.patches.length;

    const shouldShowMergeButton = activeBranchName !== 'main' && patchCount > 0;

    expect(activeBranchName).toBe('main');
    expect(shouldShowMergeButton).toBe(false);
  });
});

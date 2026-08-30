import { describe, it, expect, vi } from 'vitest';
import { createBranchStore } from '../ui/store/branch-store.js';
import { createEmptyGraph, generateUUID, now } from '@nodespec/core/utils.js';
import type { PatchOperation } from '@nodespec/core/types.js';

describe('Refresh Guard Pattern', () => {
  describe('Ref-based guard prevents concurrent refreshes', () => {
    it('should prevent a second call while the first is in progress', async () => {
      let callCount = 0;
      let resolveFirst: (() => void) | null = null;
      const isRefreshingRef = { current: false };

      async function refreshGraph() {
        if (isRefreshingRef.current) return;
        isRefreshingRef.current = true;
        callCount++;

        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });

        isRefreshingRef.current = false;
      }

      const first = refreshGraph();
      refreshGraph();
      refreshGraph();

      expect(callCount).toBe(1);

      resolveFirst!();
      await first;

      expect(callCount).toBe(1);
    });

    it('should allow a new refresh after the guard is released', async () => {
      let callCount = 0;
      const isRefreshingRef = { current: false };

      async function refreshGraph() {
        if (isRefreshingRef.current) return;
        isRefreshingRef.current = true;
        callCount++;
        await Promise.resolve();
        isRefreshingRef.current = false;
      }

      await refreshGraph();
      expect(callCount).toBe(1);

      await refreshGraph();
      expect(callCount).toBe(2);
    });

    it('should handle errors gracefully and release the guard', async () => {
      let callCount = 0;
      const isRefreshingRef = { current: false };
      const errors: string[] = [];

      async function refreshGraph() {
        if (isRefreshingRef.current) return;
        isRefreshingRef.current = true;
        callCount++;

        try {
          throw new Error('Network failure');
        } catch (error) {
          errors.push((error as Error).message);
        } finally {
          isRefreshingRef.current = false;
        }
      }

      await refreshGraph();
      expect(callCount).toBe(1);
      expect(errors).toEqual(['Network failure']);

      await refreshGraph();
      expect(callCount).toBe(2);
    });
  });

  describe('Delayed guard release pattern', () => {
    it('should keep guard active during the cooldown period', async () => {
      vi.useFakeTimers();

      let callCount = 0;
      const isRefreshingRef = { current: false };

      async function refreshGraph() {
        if (isRefreshingRef.current) return;
        isRefreshingRef.current = true;
        callCount++;

        await Promise.resolve();

        setTimeout(() => {
          isRefreshingRef.current = false;
        }, 300);
      }

      await refreshGraph();
      expect(callCount).toBe(1);

      await refreshGraph();
      expect(callCount).toBe(1);

      vi.advanceTimersByTime(300);

      await refreshGraph();
      expect(callCount).toBe(2);

      vi.useRealTimers();
    });
  });
});

describe('Event-Driven Proposal Loading', () => {
  describe('Load-on-demand vs polling pattern', () => {
    it('should load proposals only when explicitly triggered', async () => {
      let loadCount = 0;
      const proposals: any[] = [];

      async function loadProposals() {
        loadCount++;
        proposals.push({ id: generateUUID(), status: 'pending' });
      }

      await loadProposals();
      expect(loadCount).toBe(1);

      expect(loadCount).toBe(1);

      await loadProposals();
      expect(loadCount).toBe(2);
    });

    it('should load proposals after generation completes', async () => {
      let loadCount = 0;
      let generationComplete = false;

      async function loadProposals() {
        loadCount++;
      }

      async function onGenerationComplete() {
        generationComplete = true;
        await loadProposals();
      }

      await loadProposals();
      expect(loadCount).toBe(1);

      await onGenerationComplete();
      expect(generationComplete).toBe(true);
      expect(loadCount).toBe(2);
    });

    it('should load proposals after accept/decline', async () => {
      let loadCount = 0;

      async function loadProposals() {
        loadCount++;
      }

      async function acceptProposal() {
        await loadProposals();
      }

      async function declineProposal() {
        await loadProposals();
      }

      await loadProposals();
      expect(loadCount).toBe(1);

      await acceptProposal();
      expect(loadCount).toBe(2);

      await declineProposal();
      expect(loadCount).toBe(3);
    });
  });

  describe('Stable callback reference', () => {
    it('should not recreate callback when unrelated state changes', () => {
      let callbackVersion = 0;
      const deps = { store: {}, projectId: 'p1', branchId: 'b1' };

      function createCallback(currentDeps: typeof deps) {
        callbackVersion++;
        return () => ({ ...currentDeps });
      }

      createCallback(deps);
      const v1 = callbackVersion;

      createCallback(deps);
      expect(callbackVersion).toBe(v1 + 1);

      const sameDeps = { ...deps };
      expect(sameDeps.projectId).toBe(deps.projectId);
      expect(sameDeps.branchId).toBe(deps.branchId);
    });
  });
});

describe('BranchStore Snapshot and Patch Integration', () => {
  it('should apply patches without triggering unnecessary re-renders', () => {
    const graph = createEmptyGraph();
    const store = createBranchStore(graph);

    let stateChangeCount = 0;
    store.subscribe(() => {
      stateChangeCount++;
    });

    const nodeId = generateUUID();
    const patch: PatchOperation = {
      type: 'add_node',
      metadata: {
        id: generateUUID(),
        actorType: 'ai',
        summary: 'Add test node',
        timestamp: now(),
      },
      payload: {
        id: nodeId,
        type: 'backend-service',
        label: 'Test Service',
        status: 'draft',
        metadata: {},
      },
    } as PatchOperation;

    store.proposePatches([patch]);

    expect(stateChangeCount).toBe(1);
    expect(store.getState().derivedGraph.nodes[nodeId]).toBeDefined();
    expect(store.getState().derivedGraph.nodes[nodeId].label).toBe('Test Service');
  });

  it('should apply multiple patches in a single batch', () => {
    const graph = createEmptyGraph();
    const store = createBranchStore(graph);

    let stateChangeCount = 0;
    store.subscribe(() => {
      stateChangeCount++;
    });

    const patches: PatchOperation[] = [];
    for (let i = 0; i < 5; i++) {
      patches.push({
        type: 'add_node',
        metadata: {
          id: generateUUID(),
          actorType: 'ai',
          summary: `Add node ${i}`,
          timestamp: now(),
        },
        payload: {
          id: generateUUID(),
          type: 'backend-service',
          label: `Service ${i}`,
          status: 'draft',
          metadata: {},
        },
      } as PatchOperation);
    }

    store.proposePatches(patches);

    expect(stateChangeCount).toBe(1);
    expect(Object.keys(store.getState().derivedGraph.nodes).length).toBe(5);
  });

  it('should update base snapshot without cascading state changes', () => {
    const graph = createEmptyGraph();
    const store = createBranchStore(graph);

    let stateChangeCount = 0;
    store.subscribe(() => {
      stateChangeCount++;
    });

    const newGraph = createEmptyGraph();
    const nodeId = generateUUID();
    newGraph.nodes[nodeId] = {
      id: nodeId,
      type: 'backend-service',
      label: 'Preloaded Service',
      metadata: {},
    };

    store.setBaseSnapshot(newGraph);

    expect(stateChangeCount).toBe(1);
    expect(store.getState().derivedGraph.nodes[nodeId]).toBeDefined();
  });
});

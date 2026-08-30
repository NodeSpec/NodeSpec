import { describe, it, expect } from 'vitest';
import { createBranchStore } from '../ui/store/branch-store.js';
import { generateUUID } from '@nodespec/core/utils.js';
import { createAddNodePatch } from '@nodespec/core/patch-factory.js';
import type { Node } from '@nodespec/core/types.js';

function createTestNode(id: string): Node {
  return {
    id,
    type: 'service',
    label: `Test Node ${id.slice(0, 8)}`,
    metadata: {},
  };
}

describe('Selection State', () => {
  it('should initialize with no selection', () => {
    const store = createBranchStore();
    const state = store.getState();

    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedEdgeId).toBeNull();
  });

  it('should set selected node', () => {
    const store = createBranchStore();
    const nodeId = generateUUID();

    store.setSelectedNode(nodeId);
    const state = store.getState();

    expect(state.selectedNodeId).toBe(nodeId);
    expect(state.selectedEdgeId).toBeNull();
  });

  it('should set selected edge', () => {
    const store = createBranchStore();
    const edgeId = generateUUID();

    store.setSelectedEdge(edgeId);
    const state = store.getState();

    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedEdgeId).toBe(edgeId);
  });

  it('should clear selection when setting node after edge', () => {
    const store = createBranchStore();
    const nodeId = generateUUID();
    const edgeId = generateUUID();

    store.setSelectedEdge(edgeId);
    store.setSelectedNode(nodeId);
    const state = store.getState();

    expect(state.selectedNodeId).toBe(nodeId);
    expect(state.selectedEdgeId).toBeNull();
  });

  it('should clear selection when setting edge after node', () => {
    const store = createBranchStore();
    const nodeId = generateUUID();
    const edgeId = generateUUID();

    store.setSelectedNode(nodeId);
    store.setSelectedEdge(edgeId);
    const state = store.getState();

    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedEdgeId).toBe(edgeId);
  });

  it('should clear both selections', () => {
    const store = createBranchStore();
    const nodeId = generateUUID();

    store.setSelectedNode(nodeId);
    store.clearSelection();
    const state = store.getState();

    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedEdgeId).toBeNull();
  });

  it('should not mutate graph when changing selection', () => {
    const store = createBranchStore();
    const nodeId = generateUUID();
    const node = createTestNode(nodeId);

    store.proposePatches([
      createAddNodePatch(node, { actorType: 'human', summary: 'Add node' }),
    ]);

    const graphBefore = store.getState().derivedGraph;

    store.setSelectedNode(nodeId);

    const graphAfter = store.getState().derivedGraph;

    expect(graphBefore).toEqual(graphAfter);
    expect(store.getState().activeBranch.patches).toHaveLength(1);
  });

  it('should notify subscribers when selection changes', () => {
    const store = createBranchStore();
    const nodeId = generateUUID();
    let notifyCount = 0;

    store.subscribe(() => {
      notifyCount++;
    });

    store.setSelectedNode(nodeId);
    expect(notifyCount).toBe(1);

    store.clearSelection();
    expect(notifyCount).toBe(2);
  });

  it('should not emit patches for selection changes', () => {
    const store = createBranchStore();
    const nodeId = generateUUID();

    store.setSelectedNode(nodeId);
    store.setSelectedEdge(generateUUID());
    store.clearSelection();

    const state = store.getState();
    expect(state.activeBranch.patches).toHaveLength(0);
    expect(state.patchLog).toHaveLength(0);
  });
});

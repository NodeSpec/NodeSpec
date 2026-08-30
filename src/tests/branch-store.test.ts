import { describe, it, expect, vi } from 'vitest';
import { createBranchStore } from '../ui/store/branch-store.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import {
  createAddNodePatch,
  createUpdateNodePatch,
  createRemoveNodePatch,
  createRemoveEdgePatch,
  createAddContractPatch,
  createAddEdgePatch,
} from '@nodespec/core/patch-factory.js';
import type { Graph, Node, Contract, Edge } from '@nodespec/core/types.js';

function createTestNode(id: string, type = 'service'): Node {
  return {
    id,
    type,
    label: `Test Node ${id.slice(0, 8)}`,
    metadata: {},
  };
}

function createTestContract(id: string): Contract {
  return {
    id,
    kind: 'sql',
    name: `Contract ${id.slice(0, 8)}`,
    schema: {},
    metadata: {},
  };
}

const FIXED_NODE1_ID = '11111111-1111-1111-1111-111111111111';
const FIXED_NODE2_ID = '22222222-2222-2222-2222-222222222222';
const FIXED_CONTRACT_ID = '33333333-3333-3333-3333-333333333333';
const FIXED_EDGE_ID = '44444444-4444-4444-4444-444444444444';

function createGraphWithConnectedNodes(): Graph {
  const graph = createEmptyGraph();

  graph.nodes[FIXED_NODE1_ID] = createTestNode(FIXED_NODE1_ID);
  graph.nodes[FIXED_NODE2_ID] = createTestNode(FIXED_NODE2_ID);
  graph.contracts[FIXED_CONTRACT_ID] = createTestContract(FIXED_CONTRACT_ID);
  graph.edges[FIXED_EDGE_ID] = {
    id: FIXED_EDGE_ID,
    source: FIXED_NODE1_ID,
    target: FIXED_NODE2_ID,
    contractId: FIXED_CONTRACT_ID,
    label: 'Connection',
    metadata: {},
  };

  return graph;
}

const patchOptions = { actorType: 'human' as const, summary: 'Test patch' };

describe('BranchStore', () => {
  describe('initialization', () => {
    it('should initialize with empty graph when no initial graph provided', () => {
      const store = createBranchStore();
      const state = store.getState();

      expect(state.baseSnapshotGraph).toBeDefined();
      expect(state.activeBranch.patches).toHaveLength(0);
      expect(state.derivedGraph).toEqual(state.baseSnapshotGraph);
      expect(state.lastError).toBeNull();
      expect(state.patchLog).toHaveLength(0);
    });

    it('should initialize with provided graph', () => {
      const initialGraph = createGraphWithConnectedNodes();
      const store = createBranchStore(initialGraph);
      const state = store.getState();

      expect(Object.keys(state.derivedGraph.nodes)).toHaveLength(2);
      expect(Object.keys(state.derivedGraph.edges)).toHaveLength(1);
    });
  });

  describe('proposePatches', () => {
    it('should apply valid patches and update derived graph', () => {
      const store = createBranchStore();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);
      const patch = createAddNodePatch(node, patchOptions);

      const result = store.proposePatches([patch]);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(1);

      const state = store.getState();
      expect(state.activeBranch.patches).toHaveLength(1);
      expect(state.derivedGraph.nodes[nodeId]).toBeDefined();
      expect(state.patchLog).toHaveLength(1);
      expect(state.patchLog[0].status).toBe('applied');
    });

    it('should reject invalid patches and set lastError', () => {
      const store = createBranchStore();
      const nodeId = generateUUID();
      const patch = createUpdateNodePatch(nodeId, { label: 'Updated' }, patchOptions);

      const result = store.proposePatches([patch]);

      expect(result.success).toBe(false);
      expect(result.failedPatchId).toBe(patch.metadata.id);
      expect(result.error).toContain('does not exist');

      const state = store.getState();
      expect(state.activeBranch.patches).toHaveLength(0);
      expect(state.lastError).not.toBeNull();
      expect(state.patchLog).toHaveLength(1);
      expect(state.patchLog[0].status).toBe('rejected');
    });

    it('should stop at first failure and not apply remaining patches', () => {
      const store = createBranchStore();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const node1 = createTestNode(nodeId1);

      const validPatch = createAddNodePatch(node1, patchOptions);
      const invalidPatch = createUpdateNodePatch(nodeId2, { label: 'Invalid' }, patchOptions);
      const node2 = createTestNode(nodeId2);
      const neverAppliedPatch = createAddNodePatch(node2, patchOptions);

      const result = store.proposePatches([validPatch, invalidPatch, neverAppliedPatch]);

      expect(result.success).toBe(false);
      expect(result.appliedCount).toBe(1);
      expect(result.failedPatchId).toBe(invalidPatch.metadata.id);

      const state = store.getState();
      expect(state.activeBranch.patches).toHaveLength(1);
      expect(state.derivedGraph.nodes[nodeId1]).toBeDefined();
      expect(state.derivedGraph.nodes[nodeId2]).toBeUndefined();
    });

    it('should cascade-delete edges when removing a node with connected edges', () => {
      const graph = createGraphWithConnectedNodes();
      const store = createBranchStore(graph);

      const patch = createRemoveNodePatch(FIXED_NODE1_ID, patchOptions);
      const result = store.proposePatches([patch]);

      expect(result.success).toBe(true);

      const state = store.getState();
      expect(state.derivedGraph.nodes[FIXED_NODE1_ID]).toBeUndefined();
      expect(Object.keys(state.derivedGraph.edges)).toHaveLength(0);
    });
  });

  describe('connection flow', () => {
    it('should apply contract then edge patches in sequence', () => {
      const store = createBranchStore();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const node1 = createTestNode(node1Id);
      const node2 = createTestNode(node2Id);
      const contract = createTestContract(contractId);
      const edge: Edge = {
        id: edgeId,
        source: node1Id,
        target: node2Id,
        contractId,
        label: 'Connection',
        metadata: {},
      };

      const patches = [
        createAddNodePatch(node1, patchOptions),
        createAddNodePatch(node2, patchOptions),
        createAddContractPatch(contract, patchOptions),
        createAddEdgePatch(edge, patchOptions),
      ];

      const result = store.proposePatches(patches);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(4);

      const state = store.getState();
      expect(state.derivedGraph.contracts[contractId]).toBeDefined();
      expect(state.derivedGraph.edges[edgeId]).toBeDefined();
    });

    it('should reject edge if contract does not exist', () => {
      const store = createBranchStore();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const node1 = createTestNode(node1Id);
      const node2 = createTestNode(node2Id);
      const edge: Edge = {
        id: edgeId,
        source: node1Id,
        target: node2Id,
        contractId,
        label: 'Connection',
        metadata: {},
      };

      const patches = [
        createAddNodePatch(node1, patchOptions),
        createAddNodePatch(node2, patchOptions),
        createAddEdgePatch(edge, patchOptions),
      ];

      const result = store.proposePatches(patches);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Contract');
    });
  });

  describe('drag behavior', () => {
    it('should update node label', () => {
      const store = createBranchStore();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);

      store.proposePatches([createAddNodePatch(node, patchOptions)]);

      const updatePatch = createUpdateNodePatch(
        nodeId,
        { label: 'Updated Label' },
        { actorType: 'human', summary: 'Update label' }
      );

      const result = store.proposePatches([updatePatch]);

      expect(result.success).toBe(true);

      const state = store.getState();
      const updatedNode = state.derivedGraph.nodes[nodeId];
      expect(updatedNode.label).toBe('Updated Label');
      expect(updatedNode.type).toBe(node.type);
    });
  });

  describe('branch replay consistency', () => {
    it('should produce stable derived graph across recompute', () => {
      const store = createBranchStore();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);

      store.proposePatches([createAddNodePatch(node, patchOptions)]);
      store.proposePatches([
        createUpdateNodePatch(nodeId, { label: 'Updated Label' }, patchOptions),
      ]);

      const state1 = store.getState();

      store.resetBranch();
      const resetState = store.getState();
      expect(resetState.activeBranch.patches).toHaveLength(0);

      const newStore = createBranchStore();
      newStore.proposePatches([createAddNodePatch(node, patchOptions)]);
      newStore.proposePatches([
        createUpdateNodePatch(nodeId, { label: 'Updated Label' }, patchOptions),
      ]);

      const state2 = newStore.getState();

      expect(state1.derivedGraph.nodes[nodeId].label).toBe(state2.derivedGraph.nodes[nodeId].label);
    });
  });

  describe('resetBranch', () => {
    it('should reset patches and derived graph to base snapshot', () => {
      const initialGraph = createGraphWithConnectedNodes();
      const store = createBranchStore(initialGraph);
      const nodeId = generateUUID();

      store.proposePatches([createAddNodePatch(createTestNode(nodeId), patchOptions)]);

      expect(store.getState().activeBranch.patches).toHaveLength(1);
      expect(store.getState().derivedGraph.nodes[nodeId]).toBeDefined();

      store.resetBranch();

      const state = store.getState();
      expect(state.activeBranch.patches).toHaveLength(0);
      expect(state.derivedGraph.nodes[nodeId]).toBeUndefined();
      expect(Object.keys(state.derivedGraph.nodes)).toHaveLength(2);
      expect(state.patchLog).toHaveLength(0);
      expect(state.lastError).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('should notify listeners on state changes', () => {
      const store = createBranchStore();
      const listener = vi.fn();

      store.subscribe(listener);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch(createTestNode(nodeId), patchOptions)]);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          activeBranch: expect.objectContaining({
            patches: expect.arrayContaining([expect.any(Object)]),
          }),
        })
      );
    });

    it('should allow unsubscribe', () => {
      const store = createBranchStore();
      const listener = vi.fn();

      const unsubscribe = store.subscribe(listener);
      unsubscribe();

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch(createTestNode(nodeId), patchOptions)]);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('edge deletion then node deletion', () => {
    it('should allow node deletion after its edges are removed', () => {
      const graph = createGraphWithConnectedNodes();
      const store = createBranchStore(graph);

      const deleteEdgePatch = createRemoveEdgePatch(FIXED_EDGE_ID, patchOptions);
      const deleteNodePatch = createRemoveNodePatch(FIXED_NODE1_ID, patchOptions);

      const result = store.proposePatches([deleteEdgePatch, deleteNodePatch]);

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(2);

      const state = store.getState();
      expect(state.derivedGraph.edges[FIXED_EDGE_ID]).toBeUndefined();
      expect(state.derivedGraph.nodes[FIXED_NODE1_ID]).toBeUndefined();
    });
  });
});

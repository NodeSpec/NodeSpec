import { describe, it, expect } from 'vitest';
import {
  applyPatch,
  applyPatches,
  validatePatch,
  validateGraph,
} from '@nodespec/core/patch-engine.js';
import {
  createAddNodePatch,
  createAddEdgePatch,
  createAddContractPatch,
  createRemoveNodePatch,
  createRemoveContractPatch,
  createUpdateNodePatch,
} from '@nodespec/core/patch-factory.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Node, Edge, Contract, Precondition } from '@nodespec/core/types.js';

const actorOptions = { actorType: 'human' as const, summary: 'Test patch' };

function createTestNode(id: string): Node {
  return {
    id,
    type: 'service',
    label: `Node ${id.slice(0, 8)}`,
    data: {},
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

function createTestEdge(id: string, source: string, target: string, contractId: string): Edge {
  return {
    id,
    source,
    target,
    contractId,
    label: 'test-edge',
    metadata: {},
  };
}

describe('Patch Engine', () => {
  describe('validateGraph', () => {
    it('should validate an empty graph', () => {
      const graph = createEmptyGraph();
      const result = validateGraph(graph);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect edges with missing contracts', () => {
      const graph = createEmptyGraph();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const edgeId = generateUUID();
      const fakeContractId = generateUUID();

      graph.nodes[nodeId1] = createTestNode(nodeId1);
      graph.nodes[nodeId2] = createTestNode(nodeId2);
      graph.edges[edgeId] = createTestEdge(edgeId, nodeId1, nodeId2, fakeContractId);

      const result = validateGraph(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_CONTRACT')).toBe(true);
    });

    it('should detect edges with missing source nodes', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const fakeNodeId = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      graph.nodes[nodeId] = createTestNode(nodeId);
      graph.contracts[contractId] = createTestContract(contractId);
      graph.edges[edgeId] = createTestEdge(edgeId, fakeNodeId, nodeId, contractId);

      const result = validateGraph(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_SOURCE_NODE')).toBe(true);
    });
  });

  describe('validatePatch', () => {
    it('should reject adding a node that already exists', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      graph.nodes[nodeId] = createTestNode(nodeId);

      const patch = createAddNodePatch(createTestNode(nodeId), actorOptions);
      const result = validatePatch(graph, patch);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'NODE_EXISTS')).toBe(true);
    });

    it('should reject adding an edge without a contract', () => {
      const graph = createEmptyGraph();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const edgeId = generateUUID();
      const fakeContractId = generateUUID();

      graph.nodes[nodeId1] = createTestNode(nodeId1);
      graph.nodes[nodeId2] = createTestNode(nodeId2);

      const patch = createAddEdgePatch(
        createTestEdge(edgeId, nodeId1, nodeId2, fakeContractId),
        actorOptions
      );
      const result = validatePatch(graph, patch);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'CONTRACT_NOT_FOUND')).toBe(true);
    });

    it('should allow removing a node with connected edges (cascade deletion)', () => {
      const graph = createEmptyGraph();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      graph.nodes[nodeId1] = createTestNode(nodeId1);
      graph.nodes[nodeId2] = createTestNode(nodeId2);
      graph.contracts[contractId] = createTestContract(contractId);
      graph.edges[edgeId] = createTestEdge(edgeId, nodeId1, nodeId2, contractId);

      const patch = createRemoveNodePatch(nodeId1, actorOptions);
      const result = validatePatch(graph, patch);

      expect(result.valid).toBe(true);
    });

    it('should reject removing a contract in use by edges', () => {
      const graph = createEmptyGraph();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      graph.nodes[nodeId1] = createTestNode(nodeId1);
      graph.nodes[nodeId2] = createTestNode(nodeId2);
      graph.contracts[contractId] = createTestContract(contractId);
      graph.edges[edgeId] = createTestEdge(edgeId, nodeId1, nodeId2, contractId);

      const patch = createRemoveContractPatch(contractId, actorOptions);
      const result = validatePatch(graph, patch);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'CONTRACT_IN_USE')).toBe(true);
    });
  });

  describe('applyPatch', () => {
    it('should add a node successfully', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);

      const patch = createAddNodePatch(node, actorOptions);
      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      expect(result.graph?.nodes[nodeId]).toEqual(node);
      expect(result.graph?.version).toBe(1);
    });

    it('should update a node successfully', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      graph.nodes[nodeId] = createTestNode(nodeId);

      const patch = createUpdateNodePatch(
        nodeId,
        { label: 'Updated Label' },
        actorOptions
      );
      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      expect(result.graph?.nodes[nodeId].label).toBe('Updated Label');
    });

    it('should succeed on idempotent remove_node for non-existent node', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      const patch = createRemoveNodePatch(nodeId, actorOptions);
      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
    });

    it('should update graph hash after patch', () => {
      const graph = createEmptyGraph();
      const initialHash = graph.hash;
      const nodeId = generateUUID();

      const patch = createAddNodePatch(createTestNode(nodeId), actorOptions);
      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
      expect(result.graph?.hash).not.toBe(initialHash);
    });
  });

  describe('applyPatches', () => {
    it('should apply multiple patches in order', () => {
      const graph = createEmptyGraph();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const patches = [
        createAddContractPatch(createTestContract(contractId), actorOptions),
        createAddNodePatch(createTestNode(nodeId1), actorOptions),
        createAddNodePatch(createTestNode(nodeId2), actorOptions),
        createAddEdgePatch(
          createTestEdge(edgeId, nodeId1, nodeId2, contractId),
          actorOptions
        ),
      ];

      const result = applyPatches(graph, patches);

      expect(result.success).toBe(true);
      expect(Object.keys(result.graph?.nodes ?? {})).toHaveLength(2);
      expect(Object.keys(result.graph?.edges ?? {})).toHaveLength(1);
      expect(Object.keys(result.graph?.contracts ?? {})).toHaveLength(1);
      expect(result.graph?.version).toBe(4);
    });

    it('should fail on conflicting patches and report index', () => {
      const graph = createEmptyGraph();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();

      const patches = [
        createAddNodePatch(createTestNode(nodeId1), actorOptions),
        createUpdateNodePatch(nodeId2, { label: 'Does not exist' }, actorOptions),
      ];

      const result = applyPatches(graph, patches);

      expect(result.success).toBe(false);
      expect(result.error?.details?.patchIndex).toBe(1);
    });
  });

  describe('preconditions', () => {
    it('should fail when hash precondition does not match', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      graph.nodes[nodeId] = createTestNode(nodeId);

      const preconditions: Precondition[] = [
        {
          type: 'hash_match',
          path: `nodes.${nodeId}`,
          expected: 'wrong-hash',
        },
      ];

      const patch = createUpdateNodePatch(
        nodeId,
        { label: 'New Label' },
        { ...actorOptions, preconditions }
      );

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PRECONDITION_FAILED');
    });

    it('should fail when value_exists precondition fails', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      const preconditions: Precondition[] = [
        {
          type: 'value_exists',
          path: `nodes.${nodeId}`,
        },
      ];

      const patch = createAddNodePatch(createTestNode(nodeId), {
        ...actorOptions,
        preconditions,
      });

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PRECONDITION_FAILED');
    });

    it('should pass when value_equals precondition matches', () => {
      const graph = createEmptyGraph();
      graph.metadata = { status: 'active' };
      const nodeId = generateUUID();

      const preconditions: Precondition[] = [
        {
          type: 'value_equals',
          path: 'metadata.status',
          expected: 'active',
        },
      ];

      const patch = createAddNodePatch(createTestNode(nodeId), {
        ...actorOptions,
        preconditions,
      });

      const result = applyPatch(graph, patch);

      expect(result.success).toBe(true);
    });
  });
});

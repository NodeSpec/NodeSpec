import { describe, it, expect } from 'vitest';
import {
  mapNodeChangesToPatches,
  mapEdgeChangesToPatches,
  mapConnectionToPatches,
  mapDeleteSelectionToPatches,
} from '../ui/adapters/interaction-to-patch.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Graph, Node, Contract } from '@nodespec/core/types.js';
import type { NodeChange, EdgeChange, Connection } from '@xyflow/react';

const patchOptions = { actorType: 'human' as const };

function createTestNode(id: string): Node {
  return {
    id,
    type: 'service',
    label: `Node ${id.slice(0, 8)}`,
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

function createGraphWithNodes(): Graph {
  const graph = createEmptyGraph();
  const node1Id = generateUUID();
  const node2Id = generateUUID();

  graph.nodes[node1Id] = createTestNode(node1Id);
  graph.nodes[node2Id] = createTestNode(node2Id);

  return graph;
}

function createGraphWithConnectedNodes(): Graph {
  const graph = createEmptyGraph();
  const node1Id = generateUUID();
  const node2Id = generateUUID();
  const contractId = generateUUID();
  const edgeId = generateUUID();

  graph.nodes[node1Id] = createTestNode(node1Id);
  graph.nodes[node2Id] = createTestNode(node2Id);
  graph.contracts[contractId] = createTestContract(contractId);
  graph.edges[edgeId] = {
    id: edgeId,
    source: node1Id,
    target: node2Id,
    contractId,
    label: 'Connection',
    metadata: {},
  };

  return graph;
}

describe('Interaction Gating', () => {
  describe('node drag interactions', () => {
    it('should not emit patch for node drag (position is UI-only)', () => {
      const graph = createGraphWithNodes();
      const nodeId = Object.keys(graph.nodes)[0];

      const changes: NodeChange[] = [
        {
          type: 'position',
          id: nodeId,
          dragging: false,
        },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.patches).toHaveLength(0);
      expect(result.blocked).toBe(false);
    });

    it('should not emit patch for non-existent node drag', () => {
      const graph = createGraphWithNodes();
      const nonExistentId = generateUUID();

      const changes: NodeChange[] = [
        {
          type: 'position',
          id: nonExistentId,
          dragging: false,
        },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.patches).toHaveLength(0);
    });
  });

  describe('node deletion interactions', () => {
    it('should block deletion of node with connected edges', () => {
      const graph = createGraphWithConnectedNodes();
      const nodeId = Object.keys(graph.nodes)[0];

      const changes: NodeChange[] = [
        {
          type: 'remove',
          id: nodeId,
        },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('connected edge');
      expect(result.patches).toHaveLength(0);
    });

    it('should allow deletion of node without edges', () => {
      const graph = createGraphWithNodes();
      const nodeId = Object.keys(graph.nodes)[0];

      const changes: NodeChange[] = [
        {
          type: 'remove',
          id: nodeId,
        },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.blocked).toBe(false);
      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].type).toBe('remove_node');
    });

    it('should emit warning for non-existent node deletion', () => {
      const graph = createGraphWithNodes();
      const nonExistentId = generateUUID();

      const changes: NodeChange[] = [
        {
          type: 'remove',
          id: nonExistentId,
        },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('non-existent');
      expect(result.patches).toHaveLength(0);
    });
  });

  describe('edge deletion interactions', () => {
    it('should allow edge deletion', () => {
      const graph = createGraphWithConnectedNodes();
      const edgeId = Object.keys(graph.edges)[0];

      const changes: EdgeChange[] = [
        {
          type: 'remove',
          id: edgeId,
        },
      ];

      const result = mapEdgeChangesToPatches(changes, graph, patchOptions);

      expect(result.blocked).toBe(false);
      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].type).toBe('remove_edge');
    });

    it('should emit warning for non-existent edge deletion', () => {
      const graph = createGraphWithNodes();
      const nonExistentId = generateUUID();

      const changes: EdgeChange[] = [
        {
          type: 'remove',
          id: nonExistentId,
        },
      ];

      const result = mapEdgeChangesToPatches(changes, graph, patchOptions);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('non-existent');
      expect(result.patches).toHaveLength(0);
    });
  });

  describe('connection interactions', () => {
    it('should emit patches for valid connection', () => {
      const graph = createGraphWithNodes();
      const [node1Id, node2Id] = Object.keys(graph.nodes);

      const connection: Connection = {
        source: node1Id,
        target: node2Id,
        sourceHandle: null,
        targetHandle: null,
      };

      const result = mapConnectionToPatches(connection, graph, patchOptions);

      expect(result.blocked).toBe(false);
      expect(result.patches).toHaveLength(2);
      expect(result.patches[0].type).toBe('add_contract');
      expect(result.patches[1].type).toBe('add_edge');
    });

    it('should block connection with missing source', () => {
      const graph = createGraphWithNodes();
      const nonExistentId = generateUUID();
      const node2Id = Object.keys(graph.nodes)[0];

      const connection: Connection = {
        source: nonExistentId,
        target: node2Id,
        sourceHandle: null,
        targetHandle: null,
      };

      const result = mapConnectionToPatches(connection, graph, patchOptions);

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('Source node does not exist');
      expect(result.patches).toHaveLength(0);
    });

    it('should block connection with missing target', () => {
      const graph = createGraphWithNodes();
      const node1Id = Object.keys(graph.nodes)[0];
      const nonExistentId = generateUUID();

      const connection: Connection = {
        source: node1Id,
        target: nonExistentId,
        sourceHandle: null,
        targetHandle: null,
      };

      const result = mapConnectionToPatches(connection, graph, patchOptions);

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('Target node does not exist');
      expect(result.patches).toHaveLength(0);
    });

    it('should block connection with missing both nodes', () => {
      const graph = createGraphWithNodes();

      const connection = {
        source: null,
        target: null,
        sourceHandle: null,
        targetHandle: null,
      } as unknown as Connection;

      const result = mapConnectionToPatches(connection, graph, patchOptions);

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('requires both source and target');
      expect(result.patches).toHaveLength(0);
    });
  });

  describe('batch deletion interactions', () => {
    it('should delete edges before nodes', () => {
      const graph = createGraphWithConnectedNodes();
      const [node1Id] = Object.keys(graph.nodes);
      const [edgeId] = Object.keys(graph.edges);

      const result = mapDeleteSelectionToPatches(
        [node1Id],
        [edgeId],
        graph,
        patchOptions
      );

      expect(result.blocked).toBe(false);
      expect(result.patches).toHaveLength(2);
      expect(result.patches[0].type).toBe('remove_edge');
      expect(result.patches[1].type).toBe('remove_node');
    });

    it('should block node deletion if edges remain', () => {
      const graph = createGraphWithConnectedNodes();
      const [node1Id] = Object.keys(graph.nodes);

      const result = mapDeleteSelectionToPatches(
        [node1Id],
        [],
        graph,
        patchOptions
      );

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('still has');
      expect(result.patches).toHaveLength(0);
    });
  });

  describe('error recovery', () => {
    it('should not corrupt state when interaction is blocked', () => {
      const graph = createGraphWithConnectedNodes();
      const [nodeId] = Object.keys(graph.nodes);

      const changes: NodeChange[] = [
        {
          type: 'remove',
          id: nodeId,
        },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.blocked).toBe(true);
      expect(result.patches).toHaveLength(0);
      expect(graph.nodes[nodeId]).toBeDefined();
    });
  });
});

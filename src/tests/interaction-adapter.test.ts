import { describe, it, expect } from 'vitest';
import {
  mapNodeChangesToPatches,
  mapEdgeChangesToPatches,
  mapConnectionToPatches,
  mapDeleteSelectionToPatches,
} from '../ui/adapters/interaction-to-patch.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import type { Graph, Node, Contract, AddContractPatch, AddEdgePatch, ConnectPortsPatch } from '@nodespec/core/types.js';
import type { NodeChange, EdgeChange, Connection } from '@xyflow/react';

const NODE_1_ID = '11111111-1111-4111-8111-111111111111';
const NODE_2_ID = '22222222-2222-4222-8222-222222222222';
const CONTRACT_1_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EDGE_1_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const NODE_1_PORT_IN = '11111111-0001-4001-8001-000000000001';
const NODE_1_PORT_OUT = '11111111-0002-4002-8002-000000000002';
const NODE_2_PORT_IN = '22222222-0001-4001-8001-000000000001';
const NODE_2_PORT_OUT = '22222222-0002-4002-8002-000000000002';

function createTestNode(id: string, label: string, withPorts = false): Node {
  const node: Node = {
    id,
    type: 'service',
    label,
    metadata: {},
  };

  if (withPorts) {
    if (id === NODE_1_ID) {
      node.ports = [
        { id: NODE_1_PORT_IN, name: 'default-in', direction: 'in' },
        { id: NODE_1_PORT_OUT, name: 'default-out', direction: 'out' },
      ];
    } else if (id === NODE_2_ID) {
      node.ports = [
        { id: NODE_2_PORT_IN, name: 'default-in', direction: 'in' },
        { id: NODE_2_PORT_OUT, name: 'default-out', direction: 'out' },
      ];
    }
  }

  return node;
}

function createTestContract(id: string, name: string): Contract {
  return {
    id,
    kind: 'sql',
    name,
    schema: {},
    metadata: {},
  };
}

function createGraphWithNodes(withPorts = false): Graph {
  const graph = createEmptyGraph();
  graph.nodes[NODE_1_ID] = createTestNode(NODE_1_ID, 'Node 1', withPorts);
  graph.nodes[NODE_2_ID] = createTestNode(NODE_2_ID, 'Node 2', withPorts);
  graph.contracts[CONTRACT_1_ID] = createTestContract(CONTRACT_1_ID, 'Contract');
  graph.edges[EDGE_1_ID] = {
    id: EDGE_1_ID,
    source: NODE_1_ID,
    target: NODE_2_ID,
    contractId: CONTRACT_1_ID,
    label: 'Connection',
    metadata: {},
  };
  return graph;
}

const patchOptions = { actorType: 'human' as const };

describe('Interaction to Patch Adapter', () => {
  // N8.6(B): mapNodeDragToPatch (the @deprecated always-null stub) is deleted —
  // position is UI-only state and nothing called the function.

  describe('mapNodeChangesToPatches', () => {
    it('should ignore position changes (UI-only state)', () => {
      const graph = createGraphWithNodes();
      const changes: NodeChange[] = [
        {
          type: 'position',
          id: NODE_1_ID,
          dragging: false,
        },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.patches).toHaveLength(0);
      expect(result.blocked).toBe(false);
    });

    it('should ignore position change while dragging', () => {
      const graph = createGraphWithNodes();
      const changes: NodeChange[] = [
        {
          type: 'position',
          id: NODE_1_ID,
          dragging: true,
        },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.patches).toHaveLength(0);
    });

    it('should not emit patch when position unchanged', () => {
      const graph = createGraphWithNodes();
      const changes: NodeChange[] = [
        {
          type: 'position',
          id: NODE_1_ID,
          dragging: false,
        },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.patches).toHaveLength(0);
    });

    it('should block node removal when edges exist', () => {
      const graph = createGraphWithNodes();
      const changes: NodeChange[] = [
        { type: 'remove', id: NODE_1_ID },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('connected edge');
      expect(result.patches).toHaveLength(0);
    });

    it('should allow node removal when no edges exist', () => {
      const graph = createGraphWithNodes();
      delete graph.edges[EDGE_1_ID];

      const changes: NodeChange[] = [
        { type: 'remove', id: NODE_1_ID },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.blocked).toBe(false);
      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].type).toBe('remove_node');
    });
  });

  describe('mapEdgeChangesToPatches', () => {
    it('should map edge removal to removeEdge patch', () => {
      const graph = createGraphWithNodes();
      const changes: EdgeChange[] = [
        { type: 'remove', id: EDGE_1_ID },
      ];

      const result = mapEdgeChangesToPatches(changes, graph, patchOptions);

      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].type).toBe('remove_edge');
      expect(result.blocked).toBe(false);
    });

    it('should add warning for non-existent edge removal', () => {
      const graph = createGraphWithNodes();
      const changes: EdgeChange[] = [
        { type: 'remove', id: 'non-existent' },
      ];

      const result = mapEdgeChangesToPatches(changes, graph, patchOptions);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('non-existent');
    });
  });

  describe('mapConnectionToPatches', () => {
    it('should emit addContract and addEdge patches when nodes have no ports', () => {
      const graph = createGraphWithNodes();
      delete graph.edges[EDGE_1_ID];
      delete graph.contracts[CONTRACT_1_ID];

      const connection: Connection = {
        source: NODE_1_ID,
        target: NODE_2_ID,
        sourceHandle: null,
        targetHandle: null,
      };

      const result = mapConnectionToPatches(connection, graph, patchOptions);

      expect(result.patches).toHaveLength(2);
      expect(result.patches[0].type).toBe('add_contract');
      expect(result.patches[1].type).toBe('add_edge');

      const contractPatch = result.patches[0] as AddContractPatch;
      const edgePatch = result.patches[1] as AddEdgePatch;

      expect(edgePatch.payload.contractId).toBe(contractPatch.payload.id);
      expect(edgePatch.payload.source).toBe(NODE_1_ID);
      expect(edgePatch.payload.target).toBe(NODE_2_ID);
    });

    it('should emit connect_ports patch when nodes have ports', () => {
      const graph = createGraphWithNodes(true);
      delete graph.edges[EDGE_1_ID];
      delete graph.contracts[CONTRACT_1_ID];

      const connection: Connection = {
        source: NODE_1_ID,
        target: NODE_2_ID,
        sourceHandle: null,
        targetHandle: null,
      };

      const result = mapConnectionToPatches(connection, graph, patchOptions);

      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].type).toBe('connect_ports');

      const patch = result.patches[0] as ConnectPortsPatch;
      expect(patch.payload.sourceNodeId).toBe(NODE_1_ID);
      expect(patch.payload.targetNodeId).toBe(NODE_2_ID);
    });

    it('should block connection when source node missing', () => {
      const graph = createGraphWithNodes();
      const NON_EXISTENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const connection: Connection = {
        source: NON_EXISTENT_ID,
        target: NODE_2_ID,
        sourceHandle: null,
        targetHandle: null,
      };

      const result = mapConnectionToPatches(connection, graph, patchOptions);

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('Source');
    });

    it('should block connection when target node missing', () => {
      const graph = createGraphWithNodes();
      const NON_EXISTENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const connection: Connection = {
        source: NODE_1_ID,
        target: NON_EXISTENT_ID,
        sourceHandle: null,
        targetHandle: null,
      };

      const result = mapConnectionToPatches(connection, graph, patchOptions);

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('Target');
    });

    it('should include auto-generated contract with valid schema', () => {
      const graph = createGraphWithNodes();
      delete graph.edges[EDGE_1_ID];
      delete graph.contracts[CONTRACT_1_ID];

      const connection: Connection = {
        source: NODE_1_ID,
        target: NODE_2_ID,
        sourceHandle: null,
        targetHandle: null,
      };

      const result = mapConnectionToPatches(connection, graph, patchOptions);

      const contractPatch = result.patches[0] as AddContractPatch;
      // N8.6(A): connect-time contracts are inferred from the TARGET role (rest/
      // request_response fallback) — the old hardcoded 'sql' birth defect is gone.
      expect(contractPatch.payload.kind).toBe('rest');
      expect(contractPatch.payload.name).toContain('Node 1');
      expect(contractPatch.payload.name).toContain('Node 2');
      expect(contractPatch.payload.metadata?.autoGenerated).toBe(true);
    });
  });

  describe('mapDeleteSelectionToPatches', () => {
    it('should delete edges before nodes to respect constraints', () => {
      const graph = createGraphWithNodes();

      const result = mapDeleteSelectionToPatches(
        [NODE_1_ID],
        [EDGE_1_ID],
        graph,
        patchOptions
      );

      expect(result.patches).toHaveLength(2);
      expect(result.patches[0].type).toBe('remove_edge');
      expect(result.patches[1].type).toBe('remove_node');
    });

    it('should block if node has remaining edges after selection delete', () => {
      const graph = createGraphWithNodes();
      const EDGE_2_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      graph.edges[EDGE_2_ID] = {
        id: EDGE_2_ID,
        source: NODE_1_ID,
        target: NODE_2_ID,
        contractId: CONTRACT_1_ID,
        label: 'Second Edge',
        metadata: {},
      };

      const result = mapDeleteSelectionToPatches(
        [NODE_1_ID],
        [EDGE_1_ID],
        graph,
        patchOptions
      );

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('still has');
    });
  });

  describe('selection behavior (no patches)', () => {
    it('clicking node should NOT produce patches', () => {
      const graph = createGraphWithNodes();
      const changes: NodeChange[] = [
        { type: 'select', id: NODE_1_ID, selected: true },
      ];

      const result = mapNodeChangesToPatches(changes, graph, patchOptions);

      expect(result.patches).toHaveLength(0);
      expect(result.blocked).toBe(false);
    });

    it('clicking edge should NOT produce patches', () => {
      const graph = createGraphWithNodes();
      const changes: EdgeChange[] = [
        { type: 'select', id: EDGE_1_ID, selected: true },
      ];

      const result = mapEdgeChangesToPatches(changes, graph, patchOptions);

      expect(result.patches).toHaveLength(0);
      expect(result.blocked).toBe(false);
    });
  });
});

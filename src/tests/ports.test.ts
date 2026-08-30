import { describe, it, expect } from 'vitest';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import {
  createAddNodePatch,
  createAddPortPatch,
  createUpdatePortPatch,
  createDeletePortPatch,
  createConnectPortsPatch,
  createAddContractPatch,
} from '@nodespec/core/patch-factory.js';
import { applyPatches } from '@nodespec/core/patch-engine.js';
import type { Node, Port, Contract } from '@nodespec/core/types.js';

function createTestNode(id: string): Node {
  return {
    id,
    type: 'service',
    label: `Service ${id.slice(0, 8)}`,
    ports: [],
    metadata: {},
  };
}

function createTestPort(id: string, name: string, direction: 'in' | 'out'): Port {
  return {
    id,
    name,
    direction,
  };
}

function createTestContract(id: string, kind: 'rest' | 'kafka' | 'grpc' = 'rest'): Contract {
  return {
    id,
    kind,
    name: `${kind} contract`,
    schema: {},
    metadata: {},
  };
}

describe('Port Operations', () => {
  describe('add_port', () => {
    it('should add a port to a node', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddPortPatch(nodeId, createTestPort(portId, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add input port',
        }),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.nodes[nodeId].ports).toHaveLength(1);
      expect(result.graph?.nodes[nodeId].ports?.[0].id).toBe(portId);
      expect(result.graph?.nodes[nodeId].ports?.[0].name).toBe('input');
      expect(result.graph?.nodes[nodeId].ports?.[0].direction).toBe('in');
    });

    it('should reject add_port on non-existent node', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();

      const result = applyPatches(graph, [
        createAddPortPatch(nodeId, createTestPort(portId, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add port',
        }),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NODE_NOT_FOUND');
    });

    it('should reject duplicate port ID', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddPortPatch(nodeId, createTestPort(portId, 'input1', 'in'), {
          actorType: 'human',
          summary: 'Add port 1',
        }),
        createAddPortPatch(nodeId, createTestPort(portId, 'input2', 'in'), {
          actorType: 'human',
          summary: 'Add port 2 with same ID',
        }),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PORT_EXISTS');
    });

    it('should reject port with non-existent contract reference', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();
      const contractId = generateUUID();

      const port: Port = {
        id: portId,
        name: 'input',
        direction: 'in',
        contractId,
      };

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddPortPatch(nodeId, port, {
          actorType: 'human',
          summary: 'Add port',
        }),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CONTRACT_NOT_FOUND');
    });
  });

  describe('update_port', () => {
    it('should update port name', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddPortPatch(nodeId, createTestPort(portId, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add port',
        }),
        createUpdatePortPatch(nodeId, portId, { name: 'renamed_input' }, {
          actorType: 'human',
          summary: 'Rename port',
        }),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.nodes[nodeId].ports?.[0].name).toBe('renamed_input');
    });

    it('should update port direction', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddPortPatch(nodeId, createTestPort(portId, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add port',
        }),
        createUpdatePortPatch(nodeId, portId, { direction: 'out' }, {
          actorType: 'human',
          summary: 'Change direction',
        }),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.nodes[nodeId].ports?.[0].direction).toBe('out');
    });

    it('should reject update on non-existent port', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createUpdatePortPatch(nodeId, portId, { name: 'new_name' }, {
          actorType: 'human',
          summary: 'Update port',
        }),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PORT_NOT_FOUND');
    });
  });

  describe('delete_port', () => {
    it('should delete a port', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddPortPatch(nodeId, createTestPort(portId, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add port',
        }),
        createDeletePortPatch(nodeId, portId, {
          actorType: 'human',
          summary: 'Delete port',
        }),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.nodes[nodeId].ports).toHaveLength(0);
    });

    it('should reject delete_port on non-existent port', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const portId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createDeletePortPatch(nodeId, portId, {
          actorType: 'human',
          summary: 'Delete port',
        }),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PORT_NOT_FOUND');
    });

    it('should reject delete_port if port is referenced by edge', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(node1Id), {
          actorType: 'human',
          summary: 'Add node 1',
        }),
        createAddNodePatch(createTestNode(node2Id), {
          actorType: 'human',
          summary: 'Add node 2',
        }),
        createAddPortPatch(node1Id, createTestPort(port1Id, 'output', 'out'), {
          actorType: 'human',
          summary: 'Add output port',
        }),
        createAddPortPatch(node2Id, createTestPort(port2Id, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add input port',
        }),
        createAddContractPatch(createTestContract(contractId), {
          actorType: 'human',
          summary: 'Add contract',
        }),
        createConnectPortsPatch(
          node1Id,
          port1Id,
          node2Id,
          port2Id,
          edgeId,
          contractId,
          { actorType: 'human', summary: 'Connect ports' }
        ),
        createDeletePortPatch(node1Id, port1Id, {
          actorType: 'human',
          summary: 'Delete port',
        }),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PORT_IN_USE');
    });
  });

  describe('connect_ports', () => {
    it('should connect two ports with existing contract', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(node1Id), {
          actorType: 'human',
          summary: 'Add node 1',
        }),
        createAddNodePatch(createTestNode(node2Id), {
          actorType: 'human',
          summary: 'Add node 2',
        }),
        createAddPortPatch(node1Id, createTestPort(port1Id, 'output', 'out'), {
          actorType: 'human',
          summary: 'Add output port',
        }),
        createAddPortPatch(node2Id, createTestPort(port2Id, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add input port',
        }),
        createAddContractPatch(createTestContract(contractId), {
          actorType: 'human',
          summary: 'Add contract',
        }),
        createConnectPortsPatch(
          node1Id,
          port1Id,
          node2Id,
          port2Id,
          edgeId,
          contractId,
          { actorType: 'human', summary: 'Connect ports' },
          undefined,
          'Test connection'
        ),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.edges[edgeId]).toBeDefined();
      expect(result.graph?.edges[edgeId].source).toBe(node1Id);
      expect(result.graph?.edges[edgeId].target).toBe(node2Id);
      expect(result.graph?.edges[edgeId].sourcePortId).toBe(port1Id);
      expect(result.graph?.edges[edgeId].targetPortId).toBe(port2Id);
      expect(result.graph?.edges[edgeId].contractId).toBe(contractId);
    });

    it('should connect two ports with inline contract', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();
      const contract = createTestContract(contractId);

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(node1Id), {
          actorType: 'human',
          summary: 'Add node 1',
        }),
        createAddNodePatch(createTestNode(node2Id), {
          actorType: 'human',
          summary: 'Add node 2',
        }),
        createAddPortPatch(node1Id, createTestPort(port1Id, 'output', 'out'), {
          actorType: 'human',
          summary: 'Add output port',
        }),
        createAddPortPatch(node2Id, createTestPort(port2Id, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add input port',
        }),
        createConnectPortsPatch(
          node1Id,
          port1Id,
          node2Id,
          port2Id,
          edgeId,
          contractId,
          { actorType: 'human', summary: 'Connect ports' },
          contract
        ),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.edges[edgeId]).toBeDefined();
      expect(result.graph?.contracts[contractId]).toBeDefined();
      expect(result.graph?.contracts[contractId].kind).toBe('rest');
    });

    it('should reject connection with invalid port direction (in -> in)', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(node1Id), {
          actorType: 'human',
          summary: 'Add node 1',
        }),
        createAddNodePatch(createTestNode(node2Id), {
          actorType: 'human',
          summary: 'Add node 2',
        }),
        createAddPortPatch(node1Id, createTestPort(port1Id, 'input1', 'in'), {
          actorType: 'human',
          summary: 'Add input port 1',
        }),
        createAddPortPatch(node2Id, createTestPort(port2Id, 'input2', 'in'), {
          actorType: 'human',
          summary: 'Add input port 2',
        }),
        createAddContractPatch(createTestContract(contractId), {
          actorType: 'human',
          summary: 'Add contract',
        }),
        createConnectPortsPatch(
          node1Id,
          port1Id,
          node2Id,
          port2Id,
          edgeId,
          contractId,
          { actorType: 'human', summary: 'Connect ports' }
        ),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PORT_DIRECTION');
    });

    it('should reject connection with invalid port direction (out -> out)', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(node1Id), {
          actorType: 'human',
          summary: 'Add node 1',
        }),
        createAddNodePatch(createTestNode(node2Id), {
          actorType: 'human',
          summary: 'Add node 2',
        }),
        createAddPortPatch(node1Id, createTestPort(port1Id, 'output1', 'out'), {
          actorType: 'human',
          summary: 'Add output port 1',
        }),
        createAddPortPatch(node2Id, createTestPort(port2Id, 'output2', 'out'), {
          actorType: 'human',
          summary: 'Add output port 2',
        }),
        createAddContractPatch(createTestContract(contractId), {
          actorType: 'human',
          summary: 'Add contract',
        }),
        createConnectPortsPatch(
          node1Id,
          port1Id,
          node2Id,
          port2Id,
          edgeId,
          contractId,
          { actorType: 'human', summary: 'Connect ports' }
        ),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PORT_DIRECTION');
    });

    it('should reject connection with non-existent source port', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(node1Id), {
          actorType: 'human',
          summary: 'Add node 1',
        }),
        createAddNodePatch(createTestNode(node2Id), {
          actorType: 'human',
          summary: 'Add node 2',
        }),
        createAddPortPatch(node2Id, createTestPort(port2Id, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add input port',
        }),
        createAddContractPatch(createTestContract(contractId), {
          actorType: 'human',
          summary: 'Add contract',
        }),
        createConnectPortsPatch(
          node1Id,
          port1Id,
          node2Id,
          port2Id,
          edgeId,
          contractId,
          { actorType: 'human', summary: 'Connect ports' }
        ),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SOURCE_PORT_NOT_FOUND');
    });

    it('should reject connection with non-existent target port', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(node1Id), {
          actorType: 'human',
          summary: 'Add node 1',
        }),
        createAddNodePatch(createTestNode(node2Id), {
          actorType: 'human',
          summary: 'Add node 2',
        }),
        createAddPortPatch(node1Id, createTestPort(port1Id, 'output', 'out'), {
          actorType: 'human',
          summary: 'Add output port',
        }),
        createAddContractPatch(createTestContract(contractId), {
          actorType: 'human',
          summary: 'Add contract',
        }),
        createConnectPortsPatch(
          node1Id,
          port1Id,
          node2Id,
          port2Id,
          edgeId,
          contractId,
          { actorType: 'human', summary: 'Connect ports' }
        ),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TARGET_PORT_NOT_FOUND');
    });

    it('should reject connection without contract', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(node1Id), {
          actorType: 'human',
          summary: 'Add node 1',
        }),
        createAddNodePatch(createTestNode(node2Id), {
          actorType: 'human',
          summary: 'Add node 2',
        }),
        createAddPortPatch(node1Id, createTestPort(port1Id, 'output', 'out'), {
          actorType: 'human',
          summary: 'Add output port',
        }),
        createAddPortPatch(node2Id, createTestPort(port2Id, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add input port',
        }),
        createConnectPortsPatch(
          node1Id,
          port1Id,
          node2Id,
          port2Id,
          edgeId,
          contractId,
          { actorType: 'human', summary: 'Connect ports' }
        ),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CONTRACT_NOT_FOUND');
    });
  });

  describe('branch replay with ports', () => {
    it('should replay patches consistently', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      const patches = [
        createAddNodePatch(createTestNode(node1Id), {
          actorType: 'human',
          summary: 'Add node 1',
        }),
        createAddNodePatch(createTestNode(node2Id), {
          actorType: 'human',
          summary: 'Add node 2',
        }),
        createAddPortPatch(node1Id, createTestPort(port1Id, 'output', 'out'), {
          actorType: 'human',
          summary: 'Add output port',
        }),
        createAddPortPatch(node2Id, createTestPort(port2Id, 'input', 'in'), {
          actorType: 'human',
          summary: 'Add input port',
        }),
        createAddContractPatch(createTestContract(contractId), {
          actorType: 'human',
          summary: 'Add contract',
        }),
        createConnectPortsPatch(
          node1Id,
          port1Id,
          node2Id,
          port2Id,
          edgeId,
          contractId,
          { actorType: 'human', summary: 'Connect ports' }
        ),
      ];

      const result1 = applyPatches(graph, patches);
      const result2 = applyPatches(graph, patches);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.graph).toEqual(result2.graph);
    });
  });
});

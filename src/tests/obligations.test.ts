import { describe, it, expect } from 'vitest';
import { createEmptyGraph, generateUUID, computeContentHash, now } from '@nodespec/core/utils.js';
import { deriveNodeObligations, deriveAllObligations } from '@nodespec/core/obligations.js';
import type { Port, Artifact } from '@nodespec/core/types.js';

describe('Obligations', () => {
  describe('deriveNodeObligations', () => {
    it('should return empty array for non-existent node', () => {
      const graph = createEmptyGraph();
      const obligations = deriveNodeObligations(graph, 'non-existent-id');
      expect(obligations).toEqual([]);
    });

    it('should return empty array for node with no ports or artifacts', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Test Service',
      };

      const obligations = deriveNodeObligations(graph, nodeId);
      expect(obligations).toEqual([]);
    });

    it('should return contract_required for required ports with edges', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'User API',
      };

      const port1: Port = {
        id: port1Id,
        direction: 'out',
        name: 'HTTP Out',
        required: true,
      };

      const port2: Port = {
        id: port2Id,
        direction: 'in',
        name: 'HTTP In',
        required: true,
      };

      graph.nodes[node1Id] = {
        id: node1Id,
        type: 'frontend',
        label: 'Frontend',
        ports: [port1],
      };

      graph.nodes[node2Id] = {
        id: node2Id,
        type: 'service',
        label: 'API Service',
        ports: [port2],
      };

      graph.edges[edgeId] = {
        id: edgeId,
        source: node1Id,
        target: node2Id,
        sourcePortId: port1Id,
        targetPortId: port2Id,
        contractId,
      };

      const obligations = deriveNodeObligations(graph, node2Id);

      expect(obligations.length).toBeGreaterThan(0);
      const contractObligation = obligations.find(o => o.kind === 'contract_required');
      expect(contractObligation).toBeDefined();
      expect(contractObligation?.severity).toBe('warning');
      expect(contractObligation?.portId).toBe(port2Id);
      expect(contractObligation?.contractId).toBe(contractId);
    });

    it('should emit artifact_required warning when REST contract exists but no schema/doc artifact', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'User API',
      };

      const port1: Port = {
        id: port1Id,
        direction: 'out',
        name: 'HTTP Out',
      };

      const port2: Port = {
        id: port2Id,
        direction: 'in',
        name: 'HTTP In',
      };

      graph.nodes[node1Id] = {
        id: node1Id,
        type: 'frontend',
        label: 'Frontend',
        ports: [port1],
      };

      graph.nodes[node2Id] = {
        id: node2Id,
        type: 'service',
        label: 'API Service',
        ports: [port2],
        artifacts: [],
      };

      graph.edges[edgeId] = {
        id: edgeId,
        source: node1Id,
        target: node2Id,
        sourcePortId: port1Id,
        targetPortId: port2Id,
        contractId,
      };

      const obligations = deriveNodeObligations(graph, node2Id);

      const artifactObligation = obligations.find(
        o => o.kind === 'artifact_required' && o.artifactKind === 'schema'
      );
      expect(artifactObligation).toBeDefined();
      expect(artifactObligation?.severity).toBe('warning');
    });

    it('should NOT emit artifact_required when REST contract has schema artifact', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();
      const artifactId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'User API',
      };

      const port1: Port = {
        id: port1Id,
        direction: 'out',
        name: 'HTTP Out',
      };

      const port2: Port = {
        id: port2Id,
        direction: 'in',
        name: 'HTTP In',
      };

      const artifact: Artifact = {
        id: artifactId,
        nodeId: node2Id,
        kind: 'schema',
        path: 'api.yaml',
        content: 'openapi: 3.0.0',
        contentHash: computeContentHash('openapi: 3.0.0'),
        createdAt: now(),
        updatedAt: now(),
      };

      graph.artifacts[artifactId] = artifact;

      graph.nodes[node1Id] = {
        id: node1Id,
        type: 'frontend',
        label: 'Frontend',
        ports: [port1],
      };

      graph.nodes[node2Id] = {
        id: node2Id,
        type: 'service',
        label: 'API Service',
        ports: [port2],
        artifacts: [artifactId],
      };

      graph.edges[edgeId] = {
        id: edgeId,
        source: node1Id,
        target: node2Id,
        sourcePortId: port1Id,
        targetPortId: port2Id,
        contractId,
      };

      const obligations = deriveNodeObligations(graph, node2Id);

      const artifactObligation = obligations.find(
        o => o.kind === 'artifact_required' && o.artifactKind === 'schema'
      );
      expect(artifactObligation).toBeUndefined();
    });

    it('should emit schema_present warning for draft contract missing schema and schemaRef', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'User API',
        status: 'draft',
      };

      const port1: Port = {
        id: port1Id,
        direction: 'out',
        name: 'HTTP Out',
      };

      const port2: Port = {
        id: port2Id,
        direction: 'in',
        name: 'HTTP In',
      };

      graph.nodes[node1Id] = {
        id: node1Id,
        type: 'frontend',
        label: 'Frontend',
        ports: [port1],
      };

      graph.nodes[node2Id] = {
        id: node2Id,
        type: 'service',
        label: 'API Service',
        ports: [port2],
      };

      graph.edges[edgeId] = {
        id: edgeId,
        source: node1Id,
        target: node2Id,
        sourcePortId: port1Id,
        targetPortId: port2Id,
        contractId,
      };

      const obligations = deriveNodeObligations(graph, node2Id);

      const schemaObligation = obligations.find(o => o.kind === 'schema_present');
      expect(schemaObligation).toBeDefined();
      expect(schemaObligation?.severity).toBe('warning');
      expect(schemaObligation?.contractId).toBe(contractId);
    });

    it('should NOT emit schema_present warning when draft contract has schema', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'User API',
        status: 'draft',
        schema: { type: 'object' },
      };

      const port1: Port = {
        id: port1Id,
        direction: 'out',
        name: 'HTTP Out',
      };

      const port2: Port = {
        id: port2Id,
        direction: 'in',
        name: 'HTTP In',
      };

      graph.nodes[node1Id] = {
        id: node1Id,
        type: 'frontend',
        label: 'Frontend',
        ports: [port1],
      };

      graph.nodes[node2Id] = {
        id: node2Id,
        type: 'service',
        label: 'API Service',
        ports: [port2],
      };

      graph.edges[edgeId] = {
        id: edgeId,
        source: node1Id,
        target: node2Id,
        sourcePortId: port1Id,
        targetPortId: port2Id,
        contractId,
      };

      const obligations = deriveNodeObligations(graph, node2Id);

      const schemaObligation = obligations.find(o => o.kind === 'schema_present');
      expect(schemaObligation).toBeUndefined();
    });

    it('should NOT emit schema_present warning when draft contract has schemaRef', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const port1Id = generateUUID();
      const port2Id = generateUUID();
      const contractId = generateUUID();
      const edgeId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'User API',
        status: 'draft',
        schemaRef: 'https://example.com/schema.json',
      };

      const port1: Port = {
        id: port1Id,
        direction: 'out',
        name: 'HTTP Out',
      };

      const port2: Port = {
        id: port2Id,
        direction: 'in',
        name: 'HTTP In',
      };

      graph.nodes[node1Id] = {
        id: node1Id,
        type: 'frontend',
        label: 'Frontend',
        ports: [port1],
      };

      graph.nodes[node2Id] = {
        id: node2Id,
        type: 'service',
        label: 'API Service',
        ports: [port2],
      };

      graph.edges[edgeId] = {
        id: edgeId,
        source: node1Id,
        target: node2Id,
        sourcePortId: port1Id,
        targetPortId: port2Id,
        contractId,
      };

      const obligations = deriveNodeObligations(graph, node2Id);

      const schemaObligation = obligations.find(o => o.kind === 'schema_present');
      expect(schemaObligation).toBeUndefined();
    });

    it('should emit artifact_required error when complete node has no artifacts', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Complete Service',
        status: 'complete',
        artifacts: [],
      };

      const obligations = deriveNodeObligations(graph, nodeId);

      const artifactObligation = obligations.find(
        o => o.kind === 'artifact_required' && o.severity === 'error'
      );
      expect(artifactObligation).toBeDefined();
      if (artifactObligation && artifactObligation.kind === 'artifact_required') {
        expect(artifactObligation.artifactKind).toBe('source');
      }
    });

    it('should emit artifact_required error with doc kind for frontend nodes', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'frontend',
        label: 'Complete Frontend',
        status: 'complete',
        artifacts: [],
      };

      const obligations = deriveNodeObligations(graph, nodeId);

      const artifactObligation = obligations.find(
        o => o.kind === 'artifact_required' && o.severity === 'error'
      );
      expect(artifactObligation).toBeDefined();
      if (artifactObligation && artifactObligation.kind === 'artifact_required') {
        expect(artifactObligation.artifactKind).toBe('doc');
      }
    });

    it('should NOT emit artifact_required error when complete node has artifacts', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const artifact: Artifact = {
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'index.ts',
        content: 'export default {}',
        contentHash: computeContentHash('export default {}'),
        createdAt: now(),
        updatedAt: now(),
      };

      graph.artifacts[artifactId] = artifact;

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Complete Service',
        status: 'complete',
        artifacts: [artifactId],
      };

      const obligations = deriveNodeObligations(graph, nodeId);

      const artifactObligation = obligations.find(
        o => o.kind === 'artifact_required' && o.severity === 'error'
      );
      expect(artifactObligation).toBeUndefined();
    });
  });

  describe('deriveAllObligations', () => {
    it('should return obligations for all nodes with issues', () => {
      const graph = createEmptyGraph();
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();
      const contractId = generateUUID();
      const portId = generateUUID();

      graph.contracts[contractId] = {
        id: contractId,
        kind: 'rest',
        name: 'API',
      };

      graph.nodes[nodeId1] = {
        id: nodeId1,
        type: 'service',
        label: 'Service 1',
        ports: [{
          id: portId,
          direction: 'in',
          name: 'HTTP In',
          contractId,
        }],
      };

      graph.nodes[nodeId2] = {
        id: nodeId2,
        type: 'service',
        label: 'Service 2',
        status: 'complete',
        artifacts: [],
      };

      const allObligations = deriveAllObligations(graph);

      expect(allObligations.size).toBeGreaterThan(0);
      expect(allObligations.has(nodeId2)).toBe(true);
    });

    it('should return empty map when no nodes have obligations', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      graph.nodes[nodeId] = {
        id: nodeId,
        type: 'service',
        label: 'Simple Service',
      };

      const allObligations = deriveAllObligations(graph);

      expect(allObligations.size).toBe(0);
    });
  });
});

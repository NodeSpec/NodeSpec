import { describe, it, expect } from 'vitest';
import { buildArtifactContext, buildNodeContext } from '@nodespec/core/ai-context.js';
import { createEmptyGraph, generateUUID, now, computeContentHash } from '@nodespec/core/utils.js';
import type { Artifact, Node, Contract, Edge } from '@nodespec/core/types.js';

describe('AI Context Builders', () => {
  describe('buildArtifactContext', () => {
    it('should return null for non-existent artifact', async () => {
      const graph = createEmptyGraph();
      const result = await buildArtifactContext(graph, generateUUID());
      expect(result).toBeNull();
    });

    it('should return null when node does not exist', async () => {
      const graph = createEmptyGraph();
      const artifactId = generateUUID();

      graph.artifacts[artifactId] = {
        id: artifactId,
        nodeId: generateUUID(),
        kind: 'source',
        path: 'test.ts',
        content: 'test',
        contentHash: computeContentHash('test'),
        createdAt: now(),
        updatedAt: now(),
      };

      const result = await buildArtifactContext(graph, artifactId);
      expect(result).toBeNull();
    });

    it('should build complete artifact context', async () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      const node: Node = {
        id: nodeId,
        type: 'service',
        label: 'Test Service',
        ports: [
          {
            id: generateUUID(),
            name: 'http',
            direction: 'in',
            contractId: generateUUID(),
          },
          {
            id: generateUUID(),
            name: 'output',
            direction: 'out',
          },
        ],
      };

      graph.nodes[nodeId] = node;

      const artifact1Id = generateUUID();
      const artifact1: Artifact = {
        id: artifact1Id,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: 'main',
        contentHash: computeContentHash('main'),
        createdAt: now(),
        updatedAt: now(),
      };

      const artifact2Id = generateUUID();
      const artifact2: Artifact = {
        id: artifact2Id,
        nodeId,
        kind: 'schema',
        path: 'schema.json',
        content: '{}',
        contentHash: computeContentHash('{}'),
        createdAt: now(),
        updatedAt: now(),
      };

      graph.artifacts[artifact1Id] = artifact1;
      graph.artifacts[artifact2Id] = artifact2;

      const contractId = generateUUID();
      const contract: Contract = {
        id: contractId,
        kind: 'rest',
        name: 'REST API',
      };
      graph.contracts[contractId] = contract;

      const edgeId = generateUUID();
      const edge: Edge = {
        id: edgeId,
        source: nodeId,
        target: generateUUID(),
        contractId,
      };
      graph.edges[edgeId] = edge;

      const context = await buildArtifactContext(graph, artifact1Id);

      expect(context).not.toBeNull();
      expect(context!.artifact.id).toBe(artifact1Id);
      expect(context!.node.id).toBe(nodeId);
      expect(context!.relatedPorts).toHaveLength(2);
      expect(context!.relatedContracts).toHaveLength(1);
      expect(context!.relatedContracts[0].id).toBe(contractId);
      expect(context!.outgoingEdges).toHaveLength(1);
      expect(context!.incomingEdges).toHaveLength(0);
      expect(context!.otherNodeArtifacts).toHaveLength(1);
      expect(context!.otherNodeArtifacts[0].id).toBe(artifact2Id);
    });
  });

  describe('buildNodeContext', () => {
    it('should return null for non-existent node', () => {
      const graph = createEmptyGraph();
      const result = buildNodeContext(graph, generateUUID());
      expect(result).toBeNull();
    });

    it('should build complete node context', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const sourceNodeId = generateUUID();
      const targetNodeId = generateUUID();

      const node: Node = {
        id: nodeId,
        type: 'service',
        label: 'Test Service',
        ports: [
          {
            id: generateUUID(),
            name: 'input',
            direction: 'in',
          },
          {
            id: generateUUID(),
            name: 'output',
            direction: 'out',
          },
        ],
      };

      const sourceNode: Node = {
        id: sourceNodeId,
        type: 'service',
        label: 'Source Service',
      };

      const targetNode: Node = {
        id: targetNodeId,
        type: 'service',
        label: 'Target Service',
      };

      graph.nodes[nodeId] = node;
      graph.nodes[sourceNodeId] = sourceNode;
      graph.nodes[targetNodeId] = targetNode;

      const artifact1Id = generateUUID();
      const artifact1: Artifact = {
        id: artifact1Id,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: 'main',
        contentHash: computeContentHash('main'),
        createdAt: now(),
        updatedAt: now(),
      };

      const artifact2Id = generateUUID();
      const artifact2: Artifact = {
        id: artifact2Id,
        nodeId,
        kind: 'doc',
        path: 'README.md',
        content: 'docs',
        contentHash: computeContentHash('docs'),
        createdAt: now(),
        updatedAt: now(),
      };

      graph.artifacts[artifact1Id] = artifact1;
      graph.artifacts[artifact2Id] = artifact2;

      const contract1Id = generateUUID();
      const contract1: Contract = {
        id: contract1Id,
        kind: 'rest',
        name: 'Incoming API',
      };

      const contract2Id = generateUUID();
      const contract2: Contract = {
        id: contract2Id,
        kind: 'kafka',
        name: 'Outgoing Event',
      };

      graph.contracts[contract1Id] = contract1;
      graph.contracts[contract2Id] = contract2;

      const incomingEdgeId = generateUUID();
      const incomingEdge: Edge = {
        id: incomingEdgeId,
        source: sourceNodeId,
        target: nodeId,
        contractId: contract1Id,
      };

      const outgoingEdgeId = generateUUID();
      const outgoingEdge: Edge = {
        id: outgoingEdgeId,
        source: nodeId,
        target: targetNodeId,
        contractId: contract2Id,
      };

      graph.edges[incomingEdgeId] = incomingEdge;
      graph.edges[outgoingEdgeId] = outgoingEdge;

      const context = buildNodeContext(graph, nodeId);

      expect(context).not.toBeNull();
      expect(context!.node.id).toBe(nodeId);
      expect(context!.artifacts).toHaveLength(2);
      expect(context!.ports).toHaveLength(2);
      expect(context!.contracts).toHaveLength(2);
      expect(context!.incomingEdges).toHaveLength(1);
      expect(context!.outgoingEdges).toHaveLength(1);
      expect(context!.connectedNodes.incoming).toHaveLength(1);
      expect(context!.connectedNodes.incoming[0].id).toBe(sourceNodeId);
      expect(context!.connectedNodes.outgoing).toHaveLength(1);
      expect(context!.connectedNodes.outgoing[0].id).toBe(targetNodeId);
    });

    it('should handle nodes with no connections', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      const node: Node = {
        id: nodeId,
        type: 'service',
        label: 'Isolated Service',
      };

      graph.nodes[nodeId] = node;

      const context = buildNodeContext(graph, nodeId);

      expect(context).not.toBeNull();
      expect(context!.node.id).toBe(nodeId);
      expect(context!.artifacts).toHaveLength(0);
      expect(context!.ports).toHaveLength(0);
      expect(context!.contracts).toHaveLength(0);
      expect(context!.incomingEdges).toHaveLength(0);
      expect(context!.outgoingEdges).toHaveLength(0);
      expect(context!.connectedNodes.incoming).toHaveLength(0);
      expect(context!.connectedNodes.outgoing).toHaveLength(0);
    });
  });
});

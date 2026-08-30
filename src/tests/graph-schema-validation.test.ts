import { describe, it, expect } from 'vitest';
import { GraphSchema, NodeSchema, EdgeSchema, ContractSchema, ArtifactSchema, NodeGroupSchema } from '@nodespec/core/schemas.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Graph } from '@nodespec/core/types.js';

function validNode(id?: string) {
  return {
    id: id ?? generateUUID(),
    type: 'backend.api-server',
    label: 'Test Node',
    ports: [],
    data: {},
    metadata: {},
  };
}

function validContract(id?: string) {
  return {
    id: id ?? generateUUID(),
    kind: 'rest' as const,
    name: 'Test Contract',
    schema: {},
    metadata: {},
  };
}

function validArtifact(nodeId: string, id?: string) {
  return {
    id: id ?? generateUUID(),
    nodeId,
    kind: 'source' as const,
    path: 'src/index.ts',
    content: 'console.log("hello")',
    language: 'typescript',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  };
}

function validEdge(source: string, target: string, contractId: string, id?: string) {
  return {
    id: id ?? generateUUID(),
    source,
    target,
    contractId,
    label: 'test-edge',
    metadata: {},
  };
}

function populatedGraph(): Graph {
  const nodeA = validNode();
  const nodeB = validNode();
  const contract = validContract();
  const artifact = validArtifact(nodeA.id);
  const edge = validEdge(nodeA.id, nodeB.id, contract.id);

  const base = createEmptyGraph();
  return {
    ...base,
    nodes: { [nodeA.id]: nodeA, [nodeB.id]: nodeB },
    edges: { [edge.id]: edge },
    contracts: { [contract.id]: contract },
    artifacts: { [artifact.id]: { ...artifact, nodeId: nodeA.id } },
  };
}

describe('GraphSchema Zod Validation', () => {
  describe('valid graphs', () => {
    it('accepts an empty graph', () => {
      const graph = createEmptyGraph();
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(true);
    });

    it('accepts a fully populated graph', () => {
      const graph = populatedGraph();
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(true);
    });

    it('accepts a graph with optional nodeGroups', () => {
      const graph = createEmptyGraph();
      const nodeA = validNode();
      const nodeB = validNode();
      const groupId = generateUUID();
      const withGroups = {
        ...graph,
        nodes: { [nodeA.id]: nodeA, [nodeB.id]: nodeB },
        nodeGroups: {
          [groupId]: {
            id: groupId,
            label: 'My Group',
            nodeIds: [nodeA.id, nodeB.id],
            position: { x: 100, y: 200 },
            style: { backgroundColor: '#f0f0f0' },
          },
        },
      };
      const result = GraphSchema.safeParse(withGroups);
      expect(result.success).toBe(true);
    });

    it('accepts a graph with optional metadata', () => {
      const graph = { ...createEmptyGraph(), metadata: { createdBy: 'test', tags: ['a', 'b'] } };
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(true);
    });
  });

  describe('missing required top-level keys', () => {
    it('rejects graph missing id', () => {
      const { id: _, ...graph } = createEmptyGraph();
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects graph missing schemaVersion', () => {
      const { schemaVersion: _, ...graph } = createEmptyGraph();
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects graph missing version', () => {
      const { version: _, ...graph } = createEmptyGraph();
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects graph missing hash', () => {
      const { hash: _, ...graph } = createEmptyGraph();
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects graph missing nodes', () => {
      const { nodes: _, ...graph } = createEmptyGraph();
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects graph missing edges', () => {
      const { edges: _, ...graph } = createEmptyGraph();
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects graph missing contracts', () => {
      const { contracts: _, ...graph } = createEmptyGraph();
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects graph missing artifacts', () => {
      const { artifacts: _, ...graph } = createEmptyGraph();
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });
  });

  describe('invalid top-level field types', () => {
    it('rejects non-uuid id', () => {
      const graph = { ...createEmptyGraph(), id: 'not-a-uuid' };
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects negative schemaVersion', () => {
      const graph = { ...createEmptyGraph(), schemaVersion: -1 };
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects zero schemaVersion', () => {
      const graph = { ...createEmptyGraph(), schemaVersion: 0 };
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects fractional schemaVersion', () => {
      const graph = { ...createEmptyGraph(), schemaVersion: 1.5 };
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects negative version', () => {
      const graph = { ...createEmptyGraph(), version: -1 };
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects nodes as array', () => {
      const graph = { ...createEmptyGraph(), nodes: [] };
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects nodes as string', () => {
      const graph = { ...createEmptyGraph(), nodes: 'invalid' };
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(false);
    });

    it('rejects null graph', () => {
      const result = GraphSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it('rejects undefined graph', () => {
      const result = GraphSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });

    it('rejects empty object', () => {
      const result = GraphSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('invalid node structures', () => {
    it('rejects node missing id', () => {
      const { id: _, ...node } = validNode();
      const result = NodeSchema.safeParse(node);
      expect(result.success).toBe(false);
    });

    it('rejects node with empty type', () => {
      const node = { ...validNode(), type: '' };
      const result = NodeSchema.safeParse(node);
      expect(result.success).toBe(false);
    });

    it('rejects node with non-uuid id', () => {
      const node = { ...validNode(), id: 'bad-id' };
      const result = NodeSchema.safeParse(node);
      expect(result.success).toBe(false);
    });

    it('accepts node with minimal fields', () => {
      const result = NodeSchema.safeParse({
        id: generateUUID(),
        type: 'service',
        label: '',
      });
      expect(result.success).toBe(true);
    });

    it('rejects graph with malformed node in record', () => {
      const graph = createEmptyGraph();
      const badId = generateUUID();
      const withBadNode = {
        ...graph,
        nodes: { [badId]: { id: badId, type: '', label: 'bad' } },
      };
      const result = GraphSchema.safeParse(withBadNode);
      expect(result.success).toBe(false);
    });
  });

  describe('invalid edge structures', () => {
    it('rejects edge missing source', () => {
      const { source: _, ...edge } = validEdge(generateUUID(), generateUUID(), generateUUID());
      const result = EdgeSchema.safeParse(edge);
      expect(result.success).toBe(false);
    });

    it('rejects edge missing contractId', () => {
      const { contractId: _, ...edge } = validEdge(generateUUID(), generateUUID(), generateUUID());
      const result = EdgeSchema.safeParse(edge);
      expect(result.success).toBe(false);
    });

    it('rejects edge with non-uuid source', () => {
      const edge = validEdge('not-uuid', generateUUID(), generateUUID());
      const result = EdgeSchema.safeParse(edge);
      expect(result.success).toBe(false);
    });
  });

  describe('invalid contract structures', () => {
    it('rejects contract with invalid kind', () => {
      const contract = { ...validContract(), kind: 'ftp' };
      const result = ContractSchema.safeParse(contract);
      expect(result.success).toBe(false);
    });

    it('rejects contract with empty name', () => {
      const contract = { ...validContract(), name: '' };
      const result = ContractSchema.safeParse(contract);
      expect(result.success).toBe(false);
    });

    it('accepts all valid contract kinds', () => {
      const kinds = ['rest', 'graphql', 'grpc', 'websocket', 'sse', 'kafka', 'amqp', 'sql', 'nosql', 'ipc', 'custom'];
      for (const kind of kinds) {
        const contract = { ...validContract(), kind };
        const result = ContractSchema.safeParse(contract);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('invalid artifact structures', () => {
    it('rejects artifact with invalid kind', () => {
      const artifact = { ...validArtifact(generateUUID()), kind: 'binary' };
      const result = ArtifactSchema.safeParse(artifact);
      expect(result.success).toBe(false);
    });

    it('rejects artifact with empty path', () => {
      const artifact = { ...validArtifact(generateUUID()), path: '' };
      const result = ArtifactSchema.safeParse(artifact);
      expect(result.success).toBe(false);
    });

    it('rejects artifact with invalid datetime', () => {
      const artifact = { ...validArtifact(generateUUID()), createdAt: 'not-a-date' };
      const result = ArtifactSchema.safeParse(artifact);
      expect(result.success).toBe(false);
    });

    it('accepts all valid artifact kinds', () => {
      const kinds = ['source', 'schema', 'doc', 'config', 'build', 'design', 'task'];
      for (const kind of kinds) {
        const artifact = { ...validArtifact(generateUUID()), kind };
        const result = ArtifactSchema.safeParse(artifact);
        expect(result.success).toBe(true);
      }
    });

    it('accepts artifact with empty string nodeId for global artifacts', () => {
      const artifact = { ...validArtifact(''), nodeId: '' };
      const result = ArtifactSchema.safeParse(artifact);
      expect(result.success).toBe(true);
    });
  });

  describe('invalid node group structures', () => {
    it('rejects group with empty label', () => {
      const result = NodeGroupSchema.safeParse({
        id: generateUUID(),
        label: '',
        nodeIds: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects group with non-uuid nodeIds', () => {
      const result = NodeGroupSchema.safeParse({
        id: generateUUID(),
        label: 'Group',
        nodeIds: ['bad-id'],
      });
      expect(result.success).toBe(false);
    });

    it('accepts group with empty nodeIds array', () => {
      const result = NodeGroupSchema.safeParse({
        id: generateUUID(),
        label: 'Empty Group',
        nodeIds: [],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('error message quality', () => {
    it('provides path information in errors', () => {
      const graph = createEmptyGraph();
      const badId = generateUUID();
      const badGraph = {
        ...graph,
        nodes: { [badId]: { id: badId, type: '', label: 'bad' } },
      };
      const result = GraphSchema.safeParse(badGraph);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(i => i.path.join('.'));
        expect(paths.some(p => p.includes('nodes'))).toBe(true);
      }
    });

    it('reports multiple errors at once', () => {
      const result = GraphSchema.safeParse({
        id: 'bad',
        schemaVersion: -1,
        version: -1,
        hash: '',
        nodes: 'invalid',
        edges: 'invalid',
        contracts: 'invalid',
        artifacts: 'invalid',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(1);
      }
    });
  });

  describe('round-trip consistency', () => {
    it('validated graph can be serialized and re-validated', () => {
      const graph = populatedGraph();
      const first = GraphSchema.safeParse(graph);
      expect(first.success).toBe(true);

      const serialized = JSON.parse(JSON.stringify(graph));
      const second = GraphSchema.safeParse(serialized);
      expect(second.success).toBe(true);
    });

    it('version 0 is accepted for new graphs', () => {
      const graph = createEmptyGraph();
      expect(graph.version).toBe(0);
      const result = GraphSchema.safeParse(graph);
      expect(result.success).toBe(true);
    });
  });
});

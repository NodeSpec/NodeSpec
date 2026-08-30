import { describe, it, expect, vi } from 'vitest';
import { mapNodeToRFNode } from '../ui/adapters/graph-to-reactflow.js';
import { buildScaffoldPrompt } from '@nodespec/core/scaffold-prompt-builder.js';
import { createEmptyGraph, generateUUID, now, computeContentHash } from '@nodespec/core/utils.js';
import type { Graph, Node, Artifact } from '@nodespec/core/types.js';

function addNode(graph: Graph, overrides: Partial<Node> & { id: string; label: string; type: string }): Node {
  const node: Node = {
    id: overrides.id,
    type: overrides.type,
    label: overrides.label,
    ports: overrides.ports ?? [
      { id: generateUUID(), name: 'input', direction: 'in' },
      { id: generateUUID(), name: 'output', direction: 'out' },
    ],
    metadata: overrides.metadata ?? {},
    technology: overrides.technology,
    artifacts: overrides.artifacts,
    parentId: overrides.parentId,
  };
  graph.nodes[node.id] = node;
  return node;
}

function addArtifact(graph: Graph, nodeId: string, path: string, status: string = 'draft'): Artifact {
  const id = generateUUID();
  const artifact: Artifact = {
    id,
    nodeId,
    kind: 'source',
    path,
    content: '// code',
    contentHash: computeContentHash('// code'),
    createdAt: now(),
    updatedAt: now(),
    status: status as Artifact['status'],
  };
  graph.artifacts[id] = artifact;
  return artifact;
}

describe('Scaffold Button Wiring', () => {
  describe('RFNodeData.onScaffold callback', () => {
    it('mapNodeToRFNode includes onScaffold undefined by default', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'Test', type: 'backend-service' });

      const rfNode = mapNodeToRFNode(graph.nodes[nodeId], graph);

      expect(rfNode.data.onScaffold).toBeUndefined();
    });
  });

  describe('RFNodeData.artifactCount', () => {
    it('counts non-suggested artifacts on a node', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const art1 = addArtifact(graph, nodeId, 'src/index.ts', 'draft');
      const art2 = addArtifact(graph, nodeId, 'src/routes.ts', 'draft');
      addArtifact(graph, nodeId, 'src/suggested.ts', 'suggested');

      addNode(graph, {
        id: nodeId,
        label: 'Service',
        type: 'backend-service',
        artifacts: [art1.id, art2.id],
      });

      const rfNode = mapNodeToRFNode(graph.nodes[nodeId], graph);

      expect(rfNode.data.artifactCount).toBe(2);
    });

    it('returns 0 when node has no artifacts', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'Service', type: 'backend-service' });

      const rfNode = mapNodeToRFNode(graph.nodes[nodeId], graph);

      expect(rfNode.data.artifactCount).toBe(0);
    });

    it('returns 0 when node has only suggested artifacts', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const art = addArtifact(graph, nodeId, 'src/suggested.ts', 'suggested');

      addNode(graph, {
        id: nodeId,
        label: 'Service',
        type: 'backend-service',
        artifacts: [art.id],
      });

      const rfNode = mapNodeToRFNode(graph.nodes[nodeId], graph);

      expect(rfNode.data.artifactCount).toBe(0);
    });
  });

  describe('end-to-end scaffold flow', () => {
    it('buildScaffoldPrompt produces non-empty prompt for valid nodes', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'Auth API', type: 'backend-service', technology: 'nodejs' });

      const prompt = buildScaffoldPrompt(graph, nodeId);

      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('Auth API');
      expect(prompt).toContain('Generate initial');
    });

    it('simulates the full button -> prompt -> chat input flow', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'User Service', type: 'backend-service', technology: 'nodejs' });

      const setChatInput = vi.fn();

      const prompt = buildScaffoldPrompt(graph, nodeId);
      if (prompt) {
        setChatInput(prompt);
      }

      expect(setChatInput).toHaveBeenCalledOnce();
      expect(setChatInput).toHaveBeenCalledWith(expect.stringContaining('User Service'));
      expect(setChatInput).toHaveBeenCalledWith(expect.stringContaining('Generate initial source code'));
    });

    it('scaffold prompt for node with connections includes interface context', () => {
      const graph = createEmptyGraph();
      const svcId = generateUUID();
      const dbId = generateUUID();
      const contractId = generateUUID();

      addNode(graph, { id: svcId, label: 'API Server', type: 'backend-service', technology: 'nodejs' });
      addNode(graph, { id: dbId, label: 'Users DB', type: 'database', technology: 'postgresql' });

      graph.contracts[contractId] = {
        id: contractId,
        name: 'User Queries',
        kind: 'sql',
        status: 'draft',
      };

      const edgeId = generateUUID();
      graph.edges[edgeId] = {
        id: edgeId,
        source: svcId,
        target: dbId,
        contractId,
      };

      const setChatInput = vi.fn();
      const prompt = buildScaffoldPrompt(graph, svcId);
      if (prompt) setChatInput(prompt);

      expect(setChatInput).toHaveBeenCalledWith(expect.stringContaining('OUT: [Users DB] role=database (postgresql) via sql "User Queries"'));
    });

    it('scaffold prompt changes from generate to refine when artifacts exist', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'Auth Service', type: 'backend-service', technology: 'nodejs' });

      const promptBefore = buildScaffoldPrompt(graph, nodeId);
      expect(promptBefore).toContain('Generate initial');

      addArtifact(graph, nodeId, 'src/index.ts', 'draft');

      const promptAfter = buildScaffoldPrompt(graph, nodeId);
      expect(promptAfter).toContain('Refine');
      expect(promptAfter).toContain('Existing files: src/index.ts');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { buildScaffoldPrompt } from '@nodespec/core/scaffold-prompt-builder.js';
import { createEmptyGraph, generateUUID, now, computeContentHash } from '@nodespec/core/utils.js';
import type { Graph, Node, Contract, Edge, Artifact } from '@nodespec/core/types.js';

function addNode(graph: Graph, overrides: Partial<Node> & { id: string; label: string; type: string }): Node {
  const node: Node = {
    id: overrides.id,
    type: overrides.type,
    label: overrides.label,
    ports: overrides.ports ?? [],
    metadata: overrides.metadata ?? {},
    technology: overrides.technology,
    parentId: overrides.parentId,
  };
  graph.nodes[node.id] = node;
  return node;
}

function addEdge(graph: Graph, sourceId: string, targetId: string, contractId: string): Edge {
  const edgeId = generateUUID();
  const edge: Edge = {
    id: edgeId,
    source: sourceId,
    target: targetId,
    contractId,
  };
  graph.edges[edgeId] = edge;
  return edge;
}

function addContract(graph: Graph, name: string, kind: string): Contract {
  const id = generateUUID();
  const contract: Contract = { id, name, kind: kind as Contract['kind'], status: 'draft' };
  graph.contracts[id] = contract;
  return contract;
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

describe('buildScaffoldPrompt', () => {
  it('returns empty string for non-existent node', () => {
    const graph = createEmptyGraph();
    expect(buildScaffoldPrompt(graph, generateUUID())).toBe('');
  });

  describe('functional nodes (first scaffold)', () => {
    it('generates a first-scaffold prompt for a node with no artifacts', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'Auth API', type: 'backend-service', technology: 'nodejs' });

      const result = buildScaffoldPrompt(graph, nodeId);

      expect(result).toContain('Generate initial source code artifacts');
      expect(result).toContain('"Auth API"');
      expect(result).toContain('nodejs');
      expect(result).toContain('Additional context:');
      expect(result).not.toContain('Refine');
      expect(result).not.toContain('Existing files');
    });

    it('includes interface connections in the prompt', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const frontendId = generateUUID();
      const dbId = generateUUID();

      addNode(graph, { id: nodeId, label: 'User Service', type: 'backend-service', technology: 'nodejs' });
      addNode(graph, { id: frontendId, label: 'Web App', type: 'frontend-app', technology: 'react' });
      addNode(graph, { id: dbId, label: 'User DB', type: 'database', technology: 'postgresql' });

      // N8.6: unified contract vocabulary — database access is kind 'sql'.
      const restContract = addContract(graph, 'User API', 'rest');
      const dataContract = addContract(graph, 'User Data', 'sql');

      addEdge(graph, frontendId, nodeId, restContract.id);
      addEdge(graph, nodeId, dbId, dataContract.id);

      const result = buildScaffoldPrompt(graph, nodeId);

      // Connection lines carry the peer's role and technology alongside the contract.
      expect(result).toContain('Interfaces:');
      expect(result).toContain('IN: [Web App] role=frontend-app (react) via rest "User API"');
      expect(result).toContain('OUT: [User DB] role=database (postgresql) via sql "User Data"');
    });

    it('does not include Interfaces section when there are no connections', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'Standalone Service', type: 'backend-service' });

      const result = buildScaffoldPrompt(graph, nodeId);

      expect(result).not.toContain('Interfaces:');
    });
  });

  describe('functional nodes (iteration)', () => {
    it('generates a refine prompt when artifacts already exist', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'Auth API', type: 'backend-service', technology: 'nodejs' });
      addArtifact(graph, nodeId, 'src/auth/routes.ts');
      addArtifact(graph, nodeId, 'src/auth/middleware.ts');

      const result = buildScaffoldPrompt(graph, nodeId);

      expect(result).toContain('Refine the source code artifacts');
      expect(result).toContain('"Auth API"');
      expect(result).toContain('Existing files: src/auth/routes.ts, src/auth/middleware.ts');
      expect(result).not.toContain('Generate initial');
    });

    it('ignores artifacts with status "suggested"', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'Auth API', type: 'backend-service', technology: 'nodejs' });
      addArtifact(graph, nodeId, 'src/auth/routes.ts', 'suggested');

      const result = buildScaffoldPrompt(graph, nodeId);

      expect(result).toContain('Generate initial');
      expect(result).not.toContain('Refine');
    });
  });

  describe('infrastructure container nodes', () => {
    it('generates infrastructure prompt for a docker-container node', () => {
      const graph = createEmptyGraph();
      const containerId = generateUUID();
      addNode(graph, { id: containerId, label: 'App Container', type: 'docker-container', technology: 'docker' });

      const result = buildScaffoldPrompt(graph, containerId);

      expect(result).toContain('Generate configuration artifacts');
      expect(result).toContain('"App Container"');
      expect(result).toContain('docker');
    });

    it('lists child nodes for infrastructure containers', () => {
      const graph = createEmptyGraph();
      const vpcId = generateUUID();
      const svcId = generateUUID();
      const dbId = generateUUID();

      addNode(graph, { id: vpcId, label: 'Production VPC', type: 'vpc', technology: 'aws' });
      addNode(graph, { id: svcId, label: 'API Service', type: 'backend-service', parentId: vpcId });
      addNode(graph, { id: dbId, label: 'Main DB', type: 'database', parentId: vpcId });

      const result = buildScaffoldPrompt(graph, vpcId);

      expect(result).toContain('Contains: API Service, Main DB');
    });

    it('generates iteration prompt for infra container with existing artifacts', () => {
      const graph = createEmptyGraph();
      const clusterId = generateUUID();
      addNode(graph, { id: clusterId, label: 'K8s Cluster', type: 'k8s-cluster', technology: 'kubernetes' });
      addArtifact(graph, clusterId, 'k8s/deployment.yaml');

      const result = buildScaffoldPrompt(graph, clusterId);

      expect(result).toContain('Refine the configuration artifacts');
      expect(result).toContain('Existing files: k8s/deployment.yaml');
    });

    it('detects infra containers by pattern when not in container registry', () => {
      const graph = createEmptyGraph();
      const vmId = generateUUID();
      addNode(graph, { id: vmId, label: 'App VM', type: 'virtual-machine', technology: 'azure' });

      const result = buildScaffoldPrompt(graph, vmId);

      expect(result).toContain('Generate configuration artifacts');
    });
  });

  describe('technology fallback', () => {
    it('falls back to type-derived tech name when no technology is set', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'My Service', type: 'backend-service' });

      const result = buildScaffoldPrompt(graph, nodeId);

      expect(result).toContain('backend service');
    });
  });

  describe('prompt structure', () => {
    it('always ends with a cursor position for user context', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      addNode(graph, { id: nodeId, label: 'Test', type: 'backend-service' });

      const result = buildScaffoldPrompt(graph, nodeId);

      expect(result).toMatch(/Additional context:\s*$/);
    });

    it('prompt is concise (under 15 lines)', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const otherId = generateUUID();
      addNode(graph, { id: nodeId, label: 'Service', type: 'backend-service', technology: 'nodejs' });
      addNode(graph, { id: otherId, label: 'Frontend', type: 'frontend-app' });
      const contract = addContract(graph, 'API', 'rest');
      addEdge(graph, otherId, nodeId, contract.id);
      addArtifact(graph, nodeId, 'src/index.ts');
      addArtifact(graph, nodeId, 'src/routes.ts');

      const result = buildScaffoldPrompt(graph, nodeId);
      const lineCount = result.split('\n').length;

      expect(lineCount).toBeLessThanOrEqual(15);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { buildScaffoldPrompt } from '@nodespec/core/scaffold-prompt-builder.js';
import { createEmptyGraph, generateUUID, computeContentHash, now } from '@nodespec/core/utils.js';
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
  const edge: Edge = { id: edgeId, source: sourceId, target: targetId, contractId };
  graph.edges[edgeId] = edge;
  return edge;
}

function addContract(graph: Graph, name: string, kind: string): Contract {
  const id = generateUUID();
  const contract: Contract = { id, name, kind: kind as Contract['kind'], status: 'draft' };
  graph.contracts[id] = contract;
  return contract;
}

function addArtifact(graph: Graph, nodeId: string, path: string): Artifact {
  const id = generateUUID();
  const artifact: Artifact = {
    id, nodeId, kind: 'source', path, content: '// code',
    contentHash: computeContentHash('// code'), createdAt: now(), updatedAt: now(),
    status: 'draft',
  };
  graph.artifacts[id] = artifact;
  return artifact;
}

describe('Architecture Rationale - Node Metadata', () => {
  it('stores rationale in node metadata', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, {
      id: nodeId,
      label: 'Auth API',
      type: 'backend-service',
      technology: 'nodejs',
      metadata: {
        rationale: 'Handles user authentication and session management. Validates credentials against the user database and issues JWT tokens.',
      },
    });

    const node = graph.nodes[nodeId];
    expect((node.metadata as Record<string, unknown>).rationale).toBe(
      'Handles user authentication and session management. Validates credentials against the user database and issues JWT tokens.'
    );
  });

  it('rationale survives graph serialization round-trip', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    const rationaleText = 'Serves as the primary data store for user profiles and authentication data.';
    addNode(graph, {
      id: nodeId,
      label: 'User DB',
      type: 'database',
      technology: 'postgresql',
      metadata: { rationale: rationaleText },
    });

    const serialized = JSON.stringify(graph);
    const deserialized = JSON.parse(serialized) as Graph;

    expect((deserialized.nodes[nodeId].metadata as Record<string, unknown>).rationale).toBe(rationaleText);
  });

  it('node without rationale has undefined rationale', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, { id: nodeId, label: 'Service', type: 'backend-service' });

    const node = graph.nodes[nodeId];
    expect((node.metadata as Record<string, unknown>).rationale).toBeUndefined();
  });
});

describe('Architecture Rationale - Scaffold Prompt Integration', () => {
  it('includes rationale in scaffold prompt when present', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, {
      id: nodeId,
      label: 'Auth API',
      type: 'backend-service',
      technology: 'nodejs',
      metadata: {
        rationale: 'Handles user authentication via JWT. Manages login, registration, and token refresh flows.',
      },
    });

    const result = buildScaffoldPrompt(graph, nodeId);

    expect(result).toContain('Rationale:');
    expect(result).toContain('Handles user authentication via JWT');
    expect(result).toContain('Manages login, registration, and token refresh flows');
  });

  it('does not include rationale section when rationale is absent', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, {
      id: nodeId,
      label: 'Auth API',
      type: 'backend-service',
      technology: 'nodejs',
    });

    const result = buildScaffoldPrompt(graph, nodeId);

    expect(result).not.toContain('Rationale:');
  });

  it('includes rationale alongside interfaces in scaffold prompt', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    const frontendId = generateUUID();

    addNode(graph, {
      id: nodeId,
      label: 'Order Service',
      type: 'backend-service',
      technology: 'nodejs',
      metadata: {
        rationale: 'Processes customer orders and manages order lifecycle from creation to fulfillment.',
      },
    });
    addNode(graph, { id: frontendId, label: 'Web App', type: 'frontend-app' });

    const contract = addContract(graph, 'Order API', 'rest');
    addEdge(graph, frontendId, nodeId, contract.id);

    const result = buildScaffoldPrompt(graph, nodeId);

    expect(result).toContain('Rationale: Processes customer orders');
    expect(result).toContain('Interfaces:');
    expect(result).toContain('IN: [Web App] role=frontend-app via rest "Order API"');
  });

  it('includes rationale in iteration scaffold prompt', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, {
      id: nodeId,
      label: 'Auth API',
      type: 'backend-service',
      technology: 'nodejs',
      metadata: {
        rationale: 'Central auth service for all clients.',
      },
    });
    addArtifact(graph, nodeId, 'src/index.ts');

    const result = buildScaffoldPrompt(graph, nodeId);

    expect(result).toContain('Refine the source code artifacts');
    expect(result).toContain('Rationale: Central auth service for all clients.');
    expect(result).toContain('Existing files: src/index.ts');
  });
});

describe('Architecture Explanation Node - Data Shape', () => {
  it('decomposition canvas architecture node data includes rationale', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, {
      id: nodeId,
      label: 'Auth API',
      type: 'backend-service',
      technology: 'nodejs',
      metadata: { rationale: 'Handles JWT auth flows.' },
    });

    const graphNode = graph.nodes[nodeId];
    const archNodeData = {
      label: graphNode.label,
      nodeType: graphNode.type,
      nodeTypeLabel: 'Backend Service',
      technology: graphNode.technology || '',
      artifacts: [],
      ports: [{ id: 'in-0', direction: 'in' as const, name: 'Input' }],
      hasError: false,
      isDraft: false,
      highlighted: false,
      metadata: {
        ...graphNode.metadata,
        rationale: (graphNode.metadata as Record<string, unknown>)?.rationale || '',
        originalNodeId: nodeId,
      },
    };

    expect(archNodeData.metadata.rationale).toBe('Handles JWT auth flows.');
    expect(archNodeData.technology).toBe('nodejs');
    expect(archNodeData.label).toBe('Auth API');
  });

  it('node without rationale gets empty string in data shape', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, { id: nodeId, label: 'Service', type: 'backend-service' });

    const graphNode = graph.nodes[nodeId];
    const rationaleValue = (graphNode.metadata as Record<string, unknown>)?.rationale || '';

    expect(rationaleValue).toBe('');
  });
});

describe('Scaffold Intent Detection with Rationale Context', () => {
  const scaffoldPatterns: Array<{ re: RegExp; config?: boolean; iteration?: boolean }> = [
    { re: /^Generate initial source code artifacts?\s+for\s+"?([^"(]+?)"?\s*(?:\(|$)/i },
    { re: /^Generate source code\s+for\s+"?([^"(]+?)"?\s*(?:\(|$)/i },
    { re: /^Generate configuration(?:\s+artifacts?)?\s+for\s+"?([^"(]+?)"?\s*(?:\(|$)/i, config: true },
    { re: /^Refine the source code artifacts?\s+for\s+"?([^"(]+?)"?\s*(?:\(|$)/i, iteration: true },
    { re: /^Refine the configuration artifacts?\s+for\s+"?([^"(]+?)"?\s*(?:\(|$)/i, config: true, iteration: true },
    { re: /^(?:Create|Generate|Scaffold)\s+(?:code|artifacts?|files?)\s+for\s+"?([^"(]+?)"?\s*$/i },
    { re: /^Generate\s+(?:source\s+)?(?:code|artifacts?)\s+for\s+"?([^"(]+?)"?\s*$/i },
  ];

  function detectScaffoldIntent(message: string) {
    for (const { re, config, iteration } of scaffoldPatterns) {
      const match = message.match(re);
      if (match) {
        return {
          isScaffold: true,
          targetNode: match[1].trim(),
          isConfiguration: config ?? false,
          isIteration: iteration ?? false,
        };
      }
    }
    return { isScaffold: false };
  }

  it('scaffold prompt generated from buildScaffoldPrompt is itself detected as scaffold intent', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, {
      id: nodeId,
      label: 'Auth API',
      type: 'backend-service',
      technology: 'nodejs',
      metadata: { rationale: 'Handles auth.' },
    });

    const prompt = buildScaffoldPrompt(graph, nodeId);
    const firstLine = prompt.split('\n')[0];
    const intent = detectScaffoldIntent(firstLine);

    expect(intent.isScaffold).toBe(true);
    expect(intent.targetNode).toBe('Auth API');
  });

  it('iteration scaffold prompt is detected as iteration intent', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, {
      id: nodeId,
      label: 'Auth API',
      type: 'backend-service',
      technology: 'nodejs',
    });
    addArtifact(graph, nodeId, 'src/index.ts');

    const prompt = buildScaffoldPrompt(graph, nodeId);
    const firstLine = prompt.split('\n')[0];
    const intent = detectScaffoldIntent(firstLine);

    expect(intent.isScaffold).toBe(true);
    expect(intent.isIteration).toBe(true);
  });
});

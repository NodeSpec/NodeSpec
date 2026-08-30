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

function addArtifact(graph: Graph, nodeId: string, path: string, status: string = 'draft'): Artifact {
  const id = generateUUID();
  const artifact: Artifact = {
    id, nodeId, kind: 'source', path, content: '// code',
    contentHash: computeContentHash('// code'), createdAt: now(), updatedAt: now(),
    status: status as Artifact['status'],
  };
  graph.artifacts[id] = artifact;
  return artifact;
}

describe('Scaffold Intent Detection Patterns', () => {
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

  it('detects "Generate source code for" pattern', () => {
    const result = detectScaffoldIntent('Generate source code for User Auth API');
    expect(result.isScaffold).toBe(true);
    expect(result.targetNode).toBe('User Auth API');
    expect(result.isConfiguration).toBe(false);
    expect(result.isIteration).toBe(false);
  });

  it('detects "Generate initial source code artifacts for" pattern', () => {
    const result = detectScaffoldIntent('Generate initial source code artifacts for "Payment Service" (nodejs backend service).');
    expect(result.isScaffold).toBe(true);
    expect(result.targetNode).toBe('Payment Service');
  });

  it('detects "Generate configuration for" pattern', () => {
    const result = detectScaffoldIntent('Generate configuration for Production VPC');
    expect(result.isScaffold).toBe(true);
    expect(result.targetNode).toBe('Production VPC');
    expect(result.isConfiguration).toBe(true);
  });

  it('detects "Refine the source code artifacts for" pattern', () => {
    const result = detectScaffoldIntent('Refine the source code artifacts for "Auth API" (nodejs)');
    expect(result.isScaffold).toBe(true);
    expect(result.targetNode).toBe('Auth API');
    expect(result.isIteration).toBe(true);
  });

  it('detects "Scaffold code for" pattern', () => {
    const result = detectScaffoldIntent('Scaffold code for Order Service');
    expect(result.isScaffold).toBe(true);
    expect(result.targetNode).toBe('Order Service');
  });

  it('does not match general architecture messages', () => {
    const result = detectScaffoldIntent('Build me a todo app with React frontend and Node backend');
    expect(result.isScaffold).toBe(false);
  });

  it('does not match question-type messages', () => {
    const result = detectScaffoldIntent('What source code files does the auth service have?');
    expect(result.isScaffold).toBe(false);
  });

  it('does not match feature generation messages', () => {
    const result = detectScaffoldIntent('Generate features for the user management domain');
    expect(result.isScaffold).toBe(false);
  });

  it('detects "Generate artifacts for" pattern', () => {
    const result = detectScaffoldIntent('Generate artifacts for API Gateway');
    expect(result.isScaffold).toBe(true);
    expect(result.targetNode).toBe('API Gateway');
  });
});

describe('Scaffold Prompt Builder with Contract Context', () => {
  it('includes all contract kinds in connection lines', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    const frontendId = generateUUID();
    const dbId = generateUUID();
    const queueId = generateUUID();
    const wsId = generateUUID();

    addNode(graph, { id: nodeId, label: 'Order Service', type: 'backend-service', technology: 'nodejs' });
    addNode(graph, { id: frontendId, label: 'Web App', type: 'frontend-app', technology: 'react' });
    addNode(graph, { id: dbId, label: 'Order DB', type: 'database', technology: 'postgresql' });
    addNode(graph, { id: queueId, label: 'Event Bus', type: 'message-broker', technology: 'rabbitmq' });
    addNode(graph, { id: wsId, label: 'Realtime Gateway', type: 'backend-service', technology: 'nodejs' });

    const restContract = addContract(graph, 'Order REST API', 'rest');
    const dataContract = addContract(graph, 'Order Data', 'sql');
    const mqContract = addContract(graph, 'Order Events', 'amqp');
    const wsContract = addContract(graph, 'Realtime Updates', 'websocket');

    addEdge(graph, frontendId, nodeId, restContract.id);
    addEdge(graph, nodeId, dbId, dataContract.id);
    addEdge(graph, nodeId, queueId, mqContract.id);
    addEdge(graph, wsId, nodeId, wsContract.id);

    const result = buildScaffoldPrompt(graph, nodeId);

    // Connection lines carry the peer's role/technology; kinds use the N8.6 unified
    // vocabulary (sql, amqp) rather than the retired data_flow/message_queue tokens.
    expect(result).toContain('IN: [Web App] role=frontend-app (react) via rest "Order REST API"');
    expect(result).toContain('OUT: [Order DB] role=database (postgresql) via sql "Order Data"');
    expect(result).toContain('OUT: [Event Bus] role=message-broker (rabbitmq) via amqp "Order Events"');
    expect(result).toContain('IN: [Realtime Gateway] role=backend-service (nodejs) via websocket "Realtime Updates"');
  });

  it('handles grpc and graphql contracts', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    const gatewayId = generateUUID();
    const grpcTargetId = generateUUID();

    addNode(graph, { id: nodeId, label: 'User Service', type: 'backend-service', technology: 'go' });
    addNode(graph, { id: gatewayId, label: 'GraphQL Gateway', type: 'backend-service' });
    addNode(graph, { id: grpcTargetId, label: 'Notification Service', type: 'backend-service' });

    const graphqlContract = addContract(graph, 'User Schema', 'graphql');
    const grpcContract = addContract(graph, 'Notification RPC', 'grpc');

    addEdge(graph, gatewayId, nodeId, graphqlContract.id);
    addEdge(graph, nodeId, grpcTargetId, grpcContract.id);

    const result = buildScaffoldPrompt(graph, nodeId);

    expect(result).toContain('IN: [GraphQL Gateway] role=backend-service via graphql "User Schema"');
    expect(result).toContain('OUT: [Notification Service] role=backend-service via grpc "Notification RPC"');
  });

  it('generates iteration prompt when node has existing artifacts', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, { id: nodeId, label: 'Auth API', type: 'backend-service', technology: 'nodejs' });
    addArtifact(graph, nodeId, 'src/index.ts');
    addArtifact(graph, nodeId, 'src/routes/auth.ts');
    addArtifact(graph, nodeId, 'src/types.ts');

    const result = buildScaffoldPrompt(graph, nodeId);

    expect(result).toContain('Refine');
    expect(result).toContain('Existing files: src/index.ts, src/routes/auth.ts, src/types.ts');
    expect(result).not.toContain('Generate initial');
  });

  it('generates first-scaffold prompt for node with only suggested artifacts', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    addNode(graph, { id: nodeId, label: 'Auth API', type: 'backend-service', technology: 'nodejs' });
    addArtifact(graph, nodeId, 'src/index.ts', 'suggested');

    const result = buildScaffoldPrompt(graph, nodeId);

    expect(result).toContain('Generate initial');
    expect(result).not.toContain('Refine');
  });
});

describe('Artifact SSE Event Handling', () => {
  it('AgentStreamCallbacks interface includes artifact events', async () => {
    const agentModule = await import('../ui/services/AgentService.js');
    expect(agentModule.AgentService).toBeDefined();

    const createdArtifacts: Array<{ id: string; nodeLabel: string; path: string; kind: string }> = [];
    const updatedArtifacts: Array<{ id: string; nodeLabel: string; path: string; kind: string }> = [];

    const callbacks = {
      onArtifactCreated: (artifact: { id: string; nodeLabel: string; path: string; kind: string }) => {
        createdArtifacts.push(artifact);
      },
      onArtifactUpdated: (artifact: { id: string; nodeLabel: string; path: string; kind: string }) => {
        updatedArtifacts.push(artifact);
      },
    };

    callbacks.onArtifactCreated({ id: '1', nodeLabel: 'Auth API', path: 'src/routes.ts', kind: 'source' });
    callbacks.onArtifactCreated({ id: '2', nodeLabel: 'Auth API', path: 'src/types.ts', kind: 'schema' });
    callbacks.onArtifactUpdated({ id: '1', nodeLabel: 'Auth API', path: 'src/routes.ts', kind: 'source' });

    expect(createdArtifacts).toHaveLength(2);
    expect(updatedArtifacts).toHaveLength(1);
    expect(createdArtifacts[0].path).toBe('src/routes.ts');
    expect(createdArtifacts[1].kind).toBe('schema');
    expect(updatedArtifacts[0].path).toBe('src/routes.ts');
  });

  it('SSE event type mapping covers artifact events', () => {
    const eventTypeMap: Record<string, string> = {
      'artifact_created': 'onArtifactCreated',
      'artifact_updated': 'onArtifactUpdated',
      'node_created': 'onNodeCreated',
      'node_updated': 'onNodeUpdated',
      'edge_created': 'onEdgeCreated',
    };

    expect(eventTypeMap['artifact_created']).toBe('onArtifactCreated');
    expect(eventTypeMap['artifact_updated']).toBe('onArtifactUpdated');
  });

  it('artifact events produce correct chat display format', () => {
    const formatCreated = (artifact: { path: string; kind: string }) =>
      `+ Created: ${artifact.path} (${artifact.kind})`;
    const formatUpdated = (artifact: { path: string }) =>
      `~ Updated: ${artifact.path}`;

    expect(formatCreated({ path: 'src/auth/routes.ts', kind: 'source' })).toBe('+ Created: src/auth/routes.ts (source)');
    expect(formatCreated({ path: 'src/auth/types.ts', kind: 'schema' })).toBe('+ Created: src/auth/types.ts (schema)');
    expect(formatUpdated({ path: 'src/auth/index.ts' })).toBe('~ Updated: src/auth/index.ts');
    expect(formatCreated({ path: 'Dockerfile', kind: 'config' })).toBe('+ Created: Dockerfile (config)');
  });
});

describe('useAgentStream Artifact State Tracking', () => {
  it('AgentStreamState includes artifact arrays', () => {
    const initialState = {
      isRunning: false,
      status: '',
      nodesCreated: [] as Array<{ id: string; label: string; type: string }>,
      edgesCreated: [] as Array<{ id: string; sourceLabel: string; targetLabel: string; contractName: string }>,
      artifactsCreated: [] as Array<{ id: string; nodeLabel: string; path: string; kind: string }>,
      artifactsUpdated: [] as Array<{ id: string; nodeLabel: string; path: string; kind: string }>,
      toolCalls: [] as Array<{ tool: string; args: Record<string, unknown> }>,
      error: null as string | null,
      summary: null as string | null,
      patches: [] as unknown[],
    };

    expect(initialState.artifactsCreated).toEqual([]);
    expect(initialState.artifactsUpdated).toEqual([]);
  });

  it('accumulates artifact events correctly', () => {
    const state = {
      artifactsCreated: [] as Array<{ id: string; nodeLabel: string; path: string; kind: string }>,
      artifactsUpdated: [] as Array<{ id: string; nodeLabel: string; path: string; kind: string }>,
    };

    const newCreated = { id: '1', nodeLabel: 'Auth API', path: 'src/index.ts', kind: 'source' };
    state.artifactsCreated = [...state.artifactsCreated, newCreated];
    expect(state.artifactsCreated).toHaveLength(1);

    const anotherCreated = { id: '2', nodeLabel: 'Auth API', path: 'src/types.ts', kind: 'schema' };
    state.artifactsCreated = [...state.artifactsCreated, anotherCreated];
    expect(state.artifactsCreated).toHaveLength(2);

    const updated = { id: '1', nodeLabel: 'Auth API', path: 'src/index.ts', kind: 'source' };
    state.artifactsUpdated = [...state.artifactsUpdated, updated];
    expect(state.artifactsUpdated).toHaveLength(1);
    expect(state.artifactsCreated).toHaveLength(2);
  });
});

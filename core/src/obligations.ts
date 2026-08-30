import type { Graph } from './types.js';

export type ObligationSeverity = 'error' | 'warning';

export type Obligation =
  | {
      kind: 'contract_required';
      severity: ObligationSeverity;
      nodeId: string;
      portId: string;
      contractId: string;
      message: string;
    }
  | {
      kind: 'artifact_required';
      severity: ObligationSeverity;
      nodeId: string;
      artifactKind: 'source' | 'schema' | 'doc' | 'config' | 'build';
      message: string;
    }
  | {
      kind: 'schema_present';
      severity: ObligationSeverity;
      nodeId: string;
      contractId: string;
      message: string;
    }
  | {
      kind: 'architectural_pattern';
      severity: ObligationSeverity;
      edgeId: string;
      nodeId?: string;
      message: string;
      suggestion?: string;
    };

/**
 * Derives obligations for a node based on graph state.
 * Obligations represent requirements or expectations that should be satisfied.
 * This is a pure function that does NOT mutate the graph.
 */
export function deriveNodeObligations(graph: Graph, nodeId: string): Obligation[] {
  const node = graph.nodes[nodeId];
  if (!node) {
    return [];
  }

  const obligations: Obligation[] = [];

  const connectedEdges = Object.values(graph.edges).filter(
    (edge) => edge.source === nodeId || edge.target === nodeId
  );

  const portContractMap = new Map<string, string>();
  for (const edge of connectedEdges) {
    if (edge.source === nodeId && edge.sourcePortId) {
      portContractMap.set(edge.sourcePortId, edge.contractId);
    }
    if (edge.target === nodeId && edge.targetPortId) {
      portContractMap.set(edge.targetPortId, edge.contractId);
    }
  }

  if (node.ports && node.ports.length > 0) {
    for (const port of node.ports) {
      const contractId = portContractMap.get(port.id);
      if (contractId) {
        const contract = graph.contracts[contractId];
        obligations.push({
          kind: 'contract_required',
          severity: 'warning',
          nodeId,
          portId: port.id,
          contractId,
          message: `Port "${port.name}" uses contract "${contract?.name || 'Unknown'}"`,
        });
      }
    }
  }

  const restContracts: string[] = [];
  for (const edge of connectedEdges) {
    const contract = graph.contracts[edge.contractId];
    if (contract && contract.kind === 'rest') {
      restContracts.push(edge.contractId);
    }
  }

  if (restContracts.length > 0) {
    const hasSchemaOrDocArtifact = node.artifacts?.some((artId) => {
      const artifact = graph.artifacts[artId];
      return artifact && (artifact.kind === 'schema' || artifact.kind === 'doc');
    });

    if (!hasSchemaOrDocArtifact) {
      obligations.push({
        kind: 'artifact_required',
        severity: 'warning',
        nodeId,
        artifactKind: 'schema',
        message: `REST contract(s) found but no schema or documentation artifact exists`,
      });
    }
  }

  const allContractIds = new Set<string>();
  for (const edge of connectedEdges) {
    allContractIds.add(edge.contractId);
  }

  for (const contractId of allContractIds) {
    const contract = graph.contracts[contractId];
    if (contract && contract.status === 'draft') {
      if (!contract.schema && !contract.schemaRef) {
        obligations.push({
          kind: 'schema_present',
          severity: 'warning',
          nodeId,
          contractId,
          message: `Contract "${contract.name}" is draft and missing schema definition`,
        });
      }
    }
  }

  if (node.status === 'complete') {
    if (!node.artifacts || node.artifacts.length === 0) {
      const artifactKind = node.type === 'frontend' ? 'doc' : 'source';
      obligations.push({
        kind: 'artifact_required',
        severity: 'error',
        nodeId,
        artifactKind,
        message: `Node is marked complete but has no artifacts (expected at least one ${artifactKind} artifact)`,
      });
    }
  }

  return obligations;
}

/**
 * Checks edges for architectural anti-patterns and returns warnings.
 * These are design-level warnings to guide users toward better architectures.
 */
export function deriveArchitecturalObligations(graph: Graph): Obligation[] {
  const obligations: Obligation[] = [];

  for (const edgeId of Object.keys(graph.edges)) {
    const edge = graph.edges[edgeId];
    const sourceNode = graph.nodes[edge.source];
    const targetNode = graph.nodes[edge.target];
    const contract = graph.contracts[edge.contractId];

    if (!sourceNode || !targetNode || !contract) continue;

    // Rule 1: REST/GraphQL/gRPC shouldn't connect directly to database nodes
    if (['rest', 'graphql', 'grpc'].includes(contract.kind)) {
      const targetIsDatabase = targetNode.type.toLowerCase().includes('database') ||
                               targetNode.type.toLowerCase().includes('db') ||
                               targetNode.label.toLowerCase().includes('database');

      if (targetIsDatabase) {
        obligations.push({
          kind: 'architectural_pattern',
          severity: 'warning',
          edgeId,
          nodeId: edge.source,
          message: `${contract.kind.toUpperCase()} contract connects directly to database "${targetNode.label}"`,
          suggestion: 'Consider adding a backend API layer between the caller and database. Use "sql" contracts for database connections.',
        });
      }
    }

    // Rule 2: sql/nosql contracts should only connect to database-like nodes
    if (contract.kind === 'sql' || contract.kind === 'nosql') {
      const targetIsDatabase = targetNode.type.toLowerCase().includes('database') ||
                               targetNode.type.toLowerCase().includes('db') ||
                               targetNode.label.toLowerCase().includes('database') ||
                               targetNode.type.toLowerCase().includes('storage');

      if (!targetIsDatabase) {
        obligations.push({
          kind: 'architectural_pattern',
          severity: 'warning',
          edgeId,
          nodeId: edge.source,
          message: `"sql/nosql" contract connects to non-database node "${targetNode.label}"`,
          suggestion: 'Data flow contracts are meant for database connections. For service-to-service communication, use REST, GraphQL, or gRPC.',
        });
      }
    }

    // Rule 3: Warn about synchronous contracts (REST/gRPC) for notification-like patterns
    if (['rest', 'grpc'].includes(contract.kind)) {
      const contractName = contract.name.toLowerCase();
      const isNotificationPattern = contractName.includes('notif') ||
                                    contractName.includes('alert') ||
                                    contractName.includes('event') ||
                                    contractName.includes('broadcast');

      if (isNotificationPattern) {
        obligations.push({
          kind: 'architectural_pattern',
          severity: 'warning',
          edgeId,
          message: `Contract "${contract.name}" appears to be a notification but uses synchronous ${contract.kind.toUpperCase()}`,
          suggestion: 'Consider using "event_stream" for fire-and-forget notifications, or "message_queue" for reliable delivery.',
        });
      }
    }

    // Rule 4: Frontend nodes shouldn't connect directly to databases
    const sourceIsFrontend = sourceNode.type.toLowerCase().includes('frontend') ||
                             sourceNode.type.toLowerCase().includes('client') ||
                             sourceNode.type.toLowerCase().includes('ui');
    const targetIsDatabase = targetNode.type.toLowerCase().includes('database') ||
                             targetNode.type.toLowerCase().includes('db');

    if (sourceIsFrontend && targetIsDatabase) {
      obligations.push({
        kind: 'architectural_pattern',
        severity: 'error',
        edgeId,
        nodeId: edge.source,
        message: `Frontend "${sourceNode.label}" connects directly to database "${targetNode.label}"`,
        suggestion: 'SECURITY RISK: Never expose databases directly to frontends. Add a backend API layer with proper authentication and authorization.',
      });
    }

    // Rule 5: Message queues should connect between services, not to databases
    if (contract.kind === 'amqp' || contract.kind === 'kafka') {
      const targetIsDatabase = targetNode.type.toLowerCase().includes('database');

      if (targetIsDatabase) {
        obligations.push({
          kind: 'architectural_pattern',
          severity: 'warning',
          edgeId,
          message: `Message queue connects to database "${targetNode.label}"`,
          suggestion: 'Message queues typically connect services to workers. The worker then connects to the database using "sql".',
        });
      }
    }
  }

  return obligations;
}

/**
 * Derives obligations for all nodes in the graph.
 */
export function deriveAllObligations(graph: Graph): Map<string, Obligation[]> {
  const result = new Map<string, Obligation[]>();

  // Derive node-level obligations
  for (const nodeId of Object.keys(graph.nodes)) {
    const obligations = deriveNodeObligations(graph, nodeId);
    if (obligations.length > 0) {
      result.set(nodeId, obligations);
    }
  }

  // Derive architectural obligations (edge-level)
  const archObligations = deriveArchitecturalObligations(graph);
  for (const obligation of archObligations) {
    if (obligation.kind === 'architectural_pattern' && obligation.nodeId) {
      const existing = result.get(obligation.nodeId) || [];
      result.set(obligation.nodeId, [...existing, obligation]);
    }
  }

  return result;
}

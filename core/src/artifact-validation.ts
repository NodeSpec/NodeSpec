import type { Graph } from './types.js';
import { computeHash } from './utils.js';
import { deriveNodeObligations, type Obligation } from './obligations.js';

export type ValidationIssue = {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  nodeId: string;
  artifactId?: string;
  contractId?: string;
  // Best-effort pointers for UX
  pathHint?: string;
  lineStart?: number;
  lineEnd?: number;
};

export type ArtifactValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

/**
 * Validates node artifacts against derived obligations.
 * This is a pure, lightweight validator that does NOT mutate the graph.
 * It performs heuristic checks on artifact content without deep parsing.
 */
export function validateNodeArtifactsAgainstObligations(
  graph: Graph,
  nodeId: string
): ArtifactValidationResult {
  const node = graph.nodes[nodeId];
  if (!node) {
    return {
      ok: false,
      issues: [{
        id: computeHash({ nodeId, error: 'node_not_found' }),
        severity: 'error',
        message: `Node ${nodeId} not found in graph`,
        nodeId,
      }],
    };
  }

  const issues: ValidationIssue[] = [];
  const obligations = deriveNodeObligations(graph, nodeId);

  // Process artifact_required obligations
  const artifactRequiredObs = obligations.filter(
    (o): o is Extract<Obligation, { kind: 'artifact_required' }> => o.kind === 'artifact_required'
  );

  for (const ob of artifactRequiredObs) {
    const hasArtifact = node.artifacts?.some((artId) => {
      const artifact = graph.artifacts[artId];
      return artifact && artifact.kind === ob.artifactKind;
    });

    if (!hasArtifact) {
      issues.push({
        id: computeHash({ nodeId, kind: 'artifact_required', artifactKind: ob.artifactKind }),
        severity: ob.severity,
        message: ob.message,
        nodeId,
      });
    }
  }

  // Validate request_response contracts (REST/GraphQL/gRPC) have schema artifacts
  // TODO(cleanup): Remove legacy kind checks once all graphs are V5+ (interactionKind is authoritative)
  if (node.ports) {
    for (const port of node.ports) {
      if (port.contractId) {
        const contract = graph.contracts[port.contractId];
        const isRequestResponse = contract?.interactionKind === 'request_response' || contract?.kind === 'rest' || contract?.kind === 'graphql' || contract?.kind === 'grpc';
        if (contract && isRequestResponse && contract.kind === 'rest') {
          const schemaArtifacts = node.artifacts
            ?.map(artId => graph.artifacts[artId])
            .filter(art => art && art.kind === 'schema');

          const hasOpenApiSchema = schemaArtifacts?.some(art =>
            art && art.content && (
              art.content.toLowerCase().includes('openapi') ||
              art.content.toLowerCase().includes('swagger')
            )
          );

          if (!hasOpenApiSchema) {
            issues.push({
              id: computeHash({ nodeId, contractId: contract.id, check: 'rest_schema' }),
              severity: 'warning',
              message: `REST contract "${contract.name}" expects a schema artifact containing OpenAPI/Swagger definition`,
              nodeId,
              contractId: contract.id,
            });
          }
        }
      }
    }
  }

  // Validate event/messaging contracts have schema artifacts
  // TODO(cleanup): Remove legacy kind checks once all graphs are V5+ (interactionKind is authoritative)
  if (node.ports) {
    for (const port of node.ports) {
      if (port.contractId) {
        const contract = graph.contracts[port.contractId];
        const isMessaging = contract?.interactionKind === 'event' || contract?.interactionKind === 'queue' ||
          contract?.kind === 'kafka' || contract?.kind === 'amqp';
        if (contract && isMessaging) {
          const schemaArtifacts = node.artifacts
            ?.map(artId => graph.artifacts[artId])
            .filter(art => art && art.kind === 'schema');

          const hasEventSchema = schemaArtifacts?.some(art =>
            art && art.content && (
              art.content.toLowerCase().includes('schema') ||
              art.content.toLowerCase().includes('json')
            )
          );

          if (!hasEventSchema) {
            const label = contract.interactionKind || contract.kind;
            issues.push({
              id: computeHash({ nodeId, contractId: contract.id, check: 'event_schema' }),
              severity: 'warning',
              message: `${label} contract "${contract.name}" expects a schema artifact with event/message schema definition`,
              nodeId,
              contractId: contract.id,
            });
          }
        }
      }
    }
  }

  // Validate complete artifacts have content
  if (node.artifacts) {
    for (const artId of node.artifacts) {
      const artifact = graph.artifacts[artId];
      if (artifact && artifact.status === 'complete' && (artifact.content == null || artifact.content.trim() === '')) {
        issues.push({
          id: computeHash({ nodeId, artifactId: artId, check: 'empty_content' }),
          severity: 'error',
          message: `Artifact "${artifact.path}" is marked complete but has empty content`,
          nodeId,
          artifactId: artId,
          pathHint: artifact.path,
        });
      }
    }
  }

  // Determine ok status: false if any error severity exists
  const hasErrors = issues.some(issue => issue.severity === 'error');
  const ok = !hasErrors;

  return {
    ok,
    issues,
  };
}

/**
 * Validates all nodes in the graph and returns aggregated results.
 */
export function validateAllArtifacts(graph: Graph): Map<string, ArtifactValidationResult> {
  const results = new Map<string, ArtifactValidationResult>();

  for (const nodeId of Object.keys(graph.nodes)) {
    const result = validateNodeArtifactsAgainstObligations(graph, nodeId);
    if (result.issues.length > 0) {
      results.set(nodeId, result);
    }
  }

  return results;
}

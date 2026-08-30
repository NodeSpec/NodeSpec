import { GraphSchema, PatchOperationSchema } from './schemas.js';
import { CONTRACT_KIND_VALUES, ARTIFACT_KIND_VALUES } from './shared/enums.js';
import type {
  Graph,
  PatchOperation,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  PatchResult,
} from './types.js';
import { deepClone, checkPrecondition, updateGraphHash, computeHash, computeContentHash, now } from './utils.js';
import { getNodeTypeById } from './node-types.js';

export function validateGraph(graph: Graph): ValidationResult {
  const errors: ValidationError[] = [];

  const schemaResult = GraphSchema.safeParse(graph);
  if (!schemaResult.success) {
    errors.push({
      code: 'INVALID_GRAPH_SCHEMA',
      message: 'Graph does not match schema',
      details: { zodErrors: schemaResult.error.flatten() },
    });
    return { valid: false, errors };
  }

  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (!graph.contracts[edge.contractId]) {
      errors.push({
        code: 'MISSING_CONTRACT',
        message: `Edge ${edgeId} references non-existent contract ${edge.contractId}`,
        path: `edges.${edgeId}.contractId`,
      });
    }

    if (!graph.nodes[edge.source]) {
      errors.push({
        code: 'MISSING_SOURCE_NODE',
        message: `Edge ${edgeId} references non-existent source node ${edge.source}`,
        path: `edges.${edgeId}.source`,
      });
    }

    if (!graph.nodes[edge.target]) {
      errors.push({
        code: 'MISSING_TARGET_NODE',
        message: `Edge ${edgeId} references non-existent target node ${edge.target}`,
        path: `edges.${edgeId}.target`,
      });
    }

    if (edge.sourcePortId) {
      const sourceNode = graph.nodes[edge.source];
      if (sourceNode?.ports && !sourceNode.ports.find(p => p.id === edge.sourcePortId)) {
        errors.push({
          code: 'MISSING_SOURCE_PORT',
          message: `Edge ${edgeId} references non-existent source port ${edge.sourcePortId}`,
          path: `edges.${edgeId}.sourcePortId`,
        });
      }
    }

    if (edge.targetPortId) {
      const targetNode = graph.nodes[edge.target];
      if (targetNode?.ports && !targetNode.ports.find(p => p.id === edge.targetPortId)) {
        errors.push({
          code: 'MISSING_TARGET_PORT',
          message: `Edge ${edgeId} references non-existent target port ${edge.targetPortId}`,
          path: `edges.${edgeId}.targetPortId`,
        });
      }
    }

    if (edge.sourcePortId && edge.targetPortId) {
      const sourceNode = graph.nodes[edge.source];
      const targetNode = graph.nodes[edge.target];
      const sourcePort = sourceNode?.ports?.find(p => p.id === edge.sourcePortId);
      const targetPort = targetNode?.ports?.find(p => p.id === edge.targetPortId);

      if (sourcePort && targetPort) {
        if (sourcePort.direction !== 'out') {
          errors.push({
            code: 'INVALID_PORT_DIRECTION',
            message: `Edge ${edgeId} source port must have direction 'out', got '${sourcePort.direction}'`,
            path: `edges.${edgeId}.sourcePortId`,
          });
        }
        if (targetPort.direction !== 'in') {
          errors.push({
            code: 'INVALID_PORT_DIRECTION',
            message: `Edge ${edgeId} target port must have direction 'in', got '${targetPort.direction}'`,
            path: `edges.${edgeId}.targetPortId`,
          });
        }
      }
    }
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.ports) {
      const portIds = new Set<string>();
      for (const port of node.ports) {
        if (portIds.has(port.id)) {
          errors.push({
            code: 'DUPLICATE_PORT_ID',
            message: `Node ${nodeId} has duplicate port ID ${port.id}`,
            path: `nodes.${nodeId}.ports`,
          });
        }
        portIds.add(port.id);

        if (port.contractId && !graph.contracts[port.contractId]) {
          // This is now handled gracefully during patch application by clearing the contractId
          console.warn(`[validateGraph] Port ${port.id} on node ${nodeId} references non-existent contract ${port.contractId} - this will be auto-fixed during patch application`);
        }
      }
    }
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.artifacts) {
      for (const artifactId of node.artifacts) {
        if (!graph.artifacts[artifactId]) {
          errors.push({
            code: 'MISSING_ARTIFACT',
            message: `Node ${nodeId} references non-existent artifact ${artifactId}`,
            path: `nodes.${nodeId}.artifacts`,
          });
        }
      }
    }
  }

  for (const [contractId, contract] of Object.entries(graph.contracts)) {
    if (contract.schemaRef && !graph.artifacts[contract.schemaRef]) {
      errors.push({
        code: 'MISSING_SCHEMA_ARTIFACT',
        message: `Contract ${contractId} references non-existent schema artifact ${contract.schemaRef}`,
        path: `contracts.${contractId}.schemaRef`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Infers a filename from artifact content by looking for common patterns
 * @param addUniqueSuffix - Whether to add artifact ID suffix for guaranteed uniqueness
 */
function inferFilenameFromContent(content: string, kind: string, artifactId: string, addUniqueSuffix = true): string {
  if (!content) {
    return `artifact-${artifactId.substring(0, 8)}.txt`;
  }

  // Try to detect file type from content
  const contentLower = content.toLowerCase().trim();
  let baseName = '';

  // Terraform - check more specific patterns first
  if (contentLower.includes('variable "') || contentLower.match(/^variable\s+"/m)) {
    baseName = 'variables.tf';
  } else if (contentLower.includes('output "') || contentLower.match(/^output\s+"/m)) {
    baseName = 'outputs.tf';
  } else if (contentLower.includes('provider "') || contentLower.includes('resource "') || contentLower.includes('terraform {')) {
    baseName = 'main.tf';
  }
  // Docker
  else if (contentLower.startsWith('from ') || contentLower.includes('dockerfile')) {
    baseName = 'Dockerfile';
  }
  // YAML/Kubernetes
  else if (contentLower.includes('apiversion:') || contentLower.includes('kind:')) {
    baseName = 'deployment.yaml';
  }
  // SQL
  else if (contentLower.includes('create table') || contentLower.includes('select ') || contentLower.includes('insert into')) {
    baseName = 'schema.sql';
  }
  // JSON
  else if (contentLower.trim().startsWith('{') && (contentLower.includes('"name"') || contentLower.includes('"version"'))) {
    baseName = 'package.json';
  }
  // Markdown
  else if (contentLower.startsWith('# ') || contentLower.includes('## ')) {
    baseName = 'README.md';
  }
  // TypeScript/JavaScript
  else if (contentLower.includes('export ') || contentLower.includes('import ') || contentLower.includes('function ')) {
    if (contentLower.includes('react') || contentLower.includes('component')) {
      baseName = 'component.tsx';
    } else {
      baseName = 'index.ts';
    }
  }

  // If we couldn't infer, create fallback
  if (!baseName) {
    const extensions: Record<string, string> = {
      source: '.ts',
      config: '.json',
      schema: '.sql',
      doc: '.md',
      build: '.yaml',
    };
    return `artifact-${artifactId.substring(0, 8)}${extensions[kind] || '.txt'}`;
  }

  // For legacy "Unnamed Artifact" conversions, add unique suffix to prevent collisions
  if (addUniqueSuffix) {
    const ext = baseName.includes('.') ? baseName.substring(baseName.lastIndexOf('.')) : '';
    const nameWithoutExt = baseName.includes('.') ? baseName.substring(0, baseName.lastIndexOf('.')) : baseName;
    return `${nameWithoutExt}-${artifactId.substring(0, 8)}${ext}`;
  }

  return baseName;
}

/**
 * Normalizes a patch to handle legacy artifact format (name/type -> path/kind)
 */
export function normalizePatch(patch: any): any {
  if (!patch) {
    console.error('[patch-engine] normalizePatch called with undefined patch');
    return patch;
  }

  // Fix incorrect patch type names (delete_* -> remove_*)
  if (patch.type === 'delete_node') {
    patch.type = 'remove_node';
  } else if (patch.type === 'delete_edge') {
    patch.type = 'remove_edge';
  } else if (patch.type === 'delete_contract') {
    patch.type = 'remove_contract';
  } else if (patch.type === 'delete_artifact') {
    patch.type = 'remove_artifact';
  }

  if ((patch.type === 'add_contract' || patch.type === 'instantiate_contract_stub') && patch.payload) {
    const payload = patch.payload;
    if (payload.kind === 'event_bus' || payload.kind === 'pubsub') {
      payload.kind = 'event';
    }
  }

  if (patch.type === 'create_node_from_template' && patch.payload?.contracts) {
    for (const contract of patch.payload.contracts) {
      if (contract.kind === 'event_bus' || contract.kind === 'pubsub') {
        contract.kind = 'event';
      }
    }
  }

  if (patch.type === 'add_artifact' && patch.payload) {
    const payload = patch.payload;

    // Handle legacy format conversion
    if (!payload.path && (payload as any).name) {
      const legacyName = (payload as any).name;
      // If name is generic/placeholder, infer from content
      if (legacyName === 'Unnamed Artifact' || !legacyName || legacyName.trim() === '') {
        payload.path = inferFilenameFromContent(
          payload.content || '',
          payload.kind || (payload as any).type || 'source',
          payload.id || 'unknown'
        );
      } else {
        payload.path = legacyName;
      }
      delete (payload as any).name;
    }

    // If still no path, generate one
    if (!payload.path || payload.path.trim() === '') {
      payload.path = inferFilenameFromContent(
        payload.content || '',
        payload.kind || (payload as any).type || 'source',
        payload.id || 'unknown'
      );
    }

    if (!payload.kind && (payload as any).type) {
      const oldType = (payload as any).type;
      // Map old types to new kinds
      payload.kind = oldType === 'code' ? 'source' :
                     oldType === 'documentation' ? 'doc' :
                     oldType === 'schema' ? 'schema' :
                     oldType === 'config' ? 'config' :
                     'source'; // default
      delete (payload as any).type;
    }

    // Ensure required fields exist
    if (!payload.createdAt) {
      payload.createdAt = new Date().toISOString();
    }
    if (!payload.updatedAt) {
      payload.updatedAt = new Date().toISOString();
    }

    // Ensure kind is valid
    if (!(ARTIFACT_KIND_VALUES as readonly string[]).includes(payload.kind)) {
      payload.kind = 'source';
    }
  }

  return patch;
}

export function validatePatch(graph: Graph, patch: PatchOperation): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Normalize patch to handle legacy formats
  const normalizedPatch = normalizePatch(patch);

  const schemaResult = PatchOperationSchema.safeParse(normalizedPatch);
  if (!schemaResult.success) {
    console.error('[patch-engine] Schema validation failed for patch:', {
      patchType: (normalizedPatch as any)?.type,
      patchId: (normalizedPatch as any)?.metadata?.id,
      nodeId: (normalizedPatch as any)?.payload?.id,
      zodErrors: schemaResult.error.format(),
      patch: JSON.stringify(normalizedPatch, null, 2),
    });
    errors.push({
      code: 'INVALID_PATCH_SCHEMA',
      message: 'Patch does not match schema',
      details: { zodErrors: schemaResult.error.flatten() },
    });
    return { valid: false, errors };
  }

  // Use normalized patch for the rest of validation
  const validPatch = normalizedPatch as PatchOperation;

  if (validPatch.metadata.preconditions) {
    for (const precondition of validPatch.metadata.preconditions) {
      if (!checkPrecondition(graph, precondition)) {
        errors.push({
          code: 'PRECONDITION_FAILED',
          message: `Precondition failed: ${precondition.type} at path ${precondition.path}`,
          path: precondition.path,
          details: { precondition },
        });
      }
    }
  }

  switch (validPatch.type) {
    case 'add_node':
      if (graph.nodes[validPatch.payload.id]) {
        errors.push({
          code: 'NODE_EXISTS',
          message: `Node ${validPatch.payload.id} already exists`,
          path: `nodes.${validPatch.payload.id}`,
        });
      }
      // Note: We do NOT validate artifacts array here because:
      // 1. Artifacts are added via separate add_artifact patches
      // 2. The artifacts array is built up incrementally as artifacts are added
      // 3. Validating artifact references at node creation time would create a circular dependency
      break;

    case 'update_node':
      if (!graph.nodes[validPatch.payload.id]) {
        errors.push({
          code: 'NODE_NOT_FOUND',
          message: `Node ${validPatch.payload.id} does not exist`,
          path: `nodes.${validPatch.payload.id}`,
        });
      }
      if (validPatch.payload.changes.artifacts) {
        for (const artifactId of validPatch.payload.changes.artifacts) {
          if (!graph.artifacts[artifactId]) {
            errors.push({
              code: 'MISSING_ARTIFACT',
              message: `Referenced artifact ${artifactId} does not exist`,
            });
          }
        }
      }
      break;

    case 'remove_node':
    case 'delete_node': {
      // Node deletion is idempotent - if node doesn't exist, it's a no-op
      // Connected edges and owned artifacts will be automatically removed via cascade
      // No validation needed - the apply phase handles cleanup automatically
      break;
    }

    case 'add_edge':
      if (graph.edges[validPatch.payload.id]) {
        errors.push({
          code: 'EDGE_EXISTS',
          message: `Edge ${validPatch.payload.id} already exists`,
          path: `edges.${validPatch.payload.id}`,
        });
      }
      if (!graph.nodes[validPatch.payload.source]) {
        errors.push({
          code: 'SOURCE_NODE_NOT_FOUND',
          message: `Source node ${validPatch.payload.source} does not exist`,
          path: `edges.${validPatch.payload.id}.source`,
        });
      }
      if (!graph.nodes[validPatch.payload.target]) {
        errors.push({
          code: 'TARGET_NODE_NOT_FOUND',
          message: `Target node ${validPatch.payload.target} does not exist`,
          path: `edges.${validPatch.payload.id}.target`,
        });
      }
      if (!graph.contracts[validPatch.payload.contractId]) {
        errors.push({
          code: 'CONTRACT_NOT_FOUND',
          message: `Contract ${validPatch.payload.contractId} does not exist`,
          path: `edges.${validPatch.payload.id}.contractId`,
        });
      }
      break;

    case 'update_edge':
      if (!graph.edges[validPatch.payload.id]) {
        errors.push({
          code: 'EDGE_NOT_FOUND',
          message: `Edge ${validPatch.payload.id} does not exist`,
          path: `edges.${validPatch.payload.id}`,
        });
      }
      if (validPatch.payload.changes.source && !graph.nodes[validPatch.payload.changes.source]) {
        errors.push({
          code: 'SOURCE_NODE_NOT_FOUND',
          message: `Source node ${validPatch.payload.changes.source} does not exist`,
        });
      }
      if (validPatch.payload.changes.target && !graph.nodes[validPatch.payload.changes.target]) {
        errors.push({
          code: 'TARGET_NODE_NOT_FOUND',
          message: `Target node ${validPatch.payload.changes.target} does not exist`,
        });
      }
      if (validPatch.payload.changes.contractId && !graph.contracts[validPatch.payload.changes.contractId]) {
        errors.push({
          code: 'CONTRACT_NOT_FOUND',
          message: `Contract ${validPatch.payload.changes.contractId} does not exist`,
        });
      }
      break;

    case 'remove_edge':
    case 'delete_edge':
      break;

    case 'set_edge_direction':
    case 'set_edge_criticality':
      if (!graph.edges[validPatch.payload.id]) {
        errors.push({
          code: 'EDGE_NOT_FOUND',
          message: `Edge ${validPatch.payload.id} does not exist`,
          path: `edges.${validPatch.payload.id}`,
        });
      }
      break;

    case 'add_contract':
      if (graph.contracts[validPatch.payload.id]) {
        errors.push({
          code: 'CONTRACT_EXISTS',
          message: `Contract ${validPatch.payload.id} already exists`,
          path: `contracts.${validPatch.payload.id}`,
        });
      }
      if (validPatch.payload.schemaRef && !graph.artifacts[validPatch.payload.schemaRef]) {
        errors.push({
          code: 'SCHEMA_ARTIFACT_NOT_FOUND',
          message: `Schema artifact ${validPatch.payload.schemaRef} does not exist`,
          path: `contracts.${validPatch.payload.id}.schemaRef`,
        });
      }
      break;

    case 'update_contract':
      if (!graph.contracts[validPatch.payload.id]) {
        errors.push({
          code: 'CONTRACT_NOT_FOUND',
          message: `Contract ${validPatch.payload.id} does not exist`,
          path: `contracts.${validPatch.payload.id}`,
        });
      }
      if (validPatch.payload.changes.schemaRef && !graph.artifacts[validPatch.payload.changes.schemaRef]) {
        errors.push({
          code: 'SCHEMA_ARTIFACT_NOT_FOUND',
          message: `Schema artifact ${validPatch.payload.changes.schemaRef} does not exist`,
          path: `contracts.${validPatch.payload.id}.schemaRef`,
        });
      }
      break;

    case 'remove_contract':
    case 'delete_contract': {
      // Contract deletion is idempotent - if contract doesn't exist, it's a no-op
      // Check for referencing edges AND ports only if contract exists (ports keep a
      // contract alive too — port.contractId is a first-class reference)
      if (graph.contracts[validPatch.payload.id]) {
        const referencingEdges = Object.entries(graph.edges).filter(
          ([_, edge]) => edge.contractId === validPatch.payload.id
        );
        const referencingPorts: string[] = [];
        for (const node of Object.values(graph.nodes)) {
          for (const port of node.ports ?? []) {
            if (port.contractId === validPatch.payload.id) {
              referencingPorts.push(`${node.id}:${port.id}`);
            }
          }
        }
        if (referencingEdges.length > 0 || referencingPorts.length > 0) {
          const refs = [
            ...referencingEdges.map(([id]) => `edge ${id}`),
            ...referencingPorts.map(ref => `port ${ref}`),
          ];
          errors.push({
            code: 'CONTRACT_IN_USE',
            message: `Cannot remove contract ${validPatch.payload.id}: referenced by ${refs.join(', ')}`,
            path: `contracts.${validPatch.payload.id}`,
            details: { edgeIds: referencingEdges.map(([id]) => id), portRefs: referencingPorts },
          });
        }
      }
      break;
    }

    case 'add_artifact':
      if (validPatch.payload.nodeId && !graph.nodes[validPatch.payload.nodeId]) {
        errors.push({
          code: 'NODE_NOT_FOUND',
          message: `Node ${validPatch.payload.nodeId} does not exist`,
          path: `nodes.${validPatch.payload.nodeId}`,
        });
      }
      break;

    case 'update_artifact':
      if (!graph.artifacts[validPatch.payload.id]) {
        errors.push({
          code: 'ARTIFACT_NOT_FOUND',
          message: `Artifact ${validPatch.payload.id} does not exist`,
          path: `artifacts.${validPatch.payload.id}`,
        });
      } else {
        const artifact = graph.artifacts[validPatch.payload.id];

        if (validPatch.payload.changes.content !== undefined) {
          const contentHashPrecondition = validPatch.metadata.preconditions?.find(
            (p) => p.type === 'value_equals' && p.path === `artifacts.${validPatch.payload.id}.contentHash`
          );
          if (contentHashPrecondition && contentHashPrecondition.expected !== artifact.contentHash) {
            errors.push({
              code: 'CONTENT_HASH_MISMATCH',
              message: `Content hash mismatch for artifact ${validPatch.payload.id}. Expected ${contentHashPrecondition.expected}, got ${artifact.contentHash}`,
              path: `artifacts.${validPatch.payload.id}.contentHash`,
              details: { expected: contentHashPrecondition.expected, actual: artifact.contentHash },
            });
          }
        }

        if (artifact.status === 'complete' && validPatch.payload.changes.status !== 'draft') {
          errors.push({
            code: 'ARTIFACT_IMMUTABLE',
            message: `Artifact ${validPatch.payload.id} is complete and cannot be modified. Revert to draft first.`,
            path: `artifacts.${validPatch.payload.id}`,
          });
        }
        if (validPatch.payload.changes.path) {
          const existingArtifactWithPath = Object.values(graph.artifacts).find(
            (a) =>
              a.id !== validPatch.payload.id &&
              a.nodeId === artifact.nodeId &&
              a.path === validPatch.payload.changes.path
          );
          if (existingArtifactWithPath) {
            errors.push({
              code: 'ARTIFACT_PATH_EXISTS',
              message: `Artifact with path "${validPatch.payload.changes.path}" already exists on node ${artifact.nodeId}`,
              path: `artifacts.${validPatch.payload.id}`,
            });
          }
        }
        if (validPatch.payload.changes.nodeId) {
          const targetNode = graph.nodes[validPatch.payload.changes.nodeId];
          if (!targetNode) {
            errors.push({
              code: 'TARGET_NODE_NOT_FOUND',
              message: `Target node ${validPatch.payload.changes.nodeId} does not exist`,
              path: `artifacts.${validPatch.payload.id}`,
            });
          } else {
            const targetNodeType = getNodeTypeById(targetNode.type);
            if (targetNodeType?.suggestedFiles) {
              const suggestedKinds = new Set(targetNodeType.suggestedFiles.map(f => f.kind));
              if (!suggestedKinds.has(artifact.kind as any)) {
                warnings.push({
                  code: 'ARTIFACT_KIND_MISMATCH',
                  message: `Artifact kind "${artifact.kind}" is not among suggested file types for ${targetNodeType.label || targetNode.type}. Consider placing it on a more appropriate node.`,
                  path: `artifacts.${validPatch.payload.id}`,
                });
              }
            }
          }
        }
      }
      break;

    case 'remove_artifact':
    case 'delete_artifact': {
      if (!graph.artifacts[validPatch.payload.id]) {
        errors.push({
          code: 'ARTIFACT_NOT_FOUND',
          message: `Artifact ${validPatch.payload.id} does not exist`,
          path: `artifacts.${validPatch.payload.id}`,
        });
      } else {
        const artifact = graph.artifacts[validPatch.payload.id];
        if (artifact.status === 'complete') {
          errors.push({
            code: 'ARTIFACT_IMMUTABLE',
            message: `Cannot remove artifact ${validPatch.payload.id}: artifact is complete. Revert to draft first.`,
            path: `artifacts.${validPatch.payload.id}`,
          });
        }
      }

      const referencingContractsBySchemaRef = Object.entries(graph.contracts).filter(
        ([_, contract]) => contract.schemaRef === validPatch.payload.id
      );
      if (referencingContractsBySchemaRef.length > 0) {
        errors.push({
          code: 'ARTIFACT_REFERENCED_BY_CONTRACT_SCHEMA',
          message: `Cannot remove artifact ${validPatch.payload.id}: used as schema by contracts ${referencingContractsBySchemaRef.map(([id]) => id).join(', ')}`,
          path: `artifacts.${validPatch.payload.id}`,
          details: { contractIds: referencingContractsBySchemaRef.map(([id]) => id) },
        });
      }

      const referencingContractsMetadata = Object.entries(graph.contracts).filter(
        ([_, contract]) => contract.metadata?.artifactId === validPatch.payload.id
      );
      if (referencingContractsMetadata.length > 0) {
        errors.push({
          code: 'ARTIFACT_REFERENCED_BY_CONTRACT',
          message: `Cannot remove artifact ${validPatch.payload.id}: referenced by contracts ${referencingContractsMetadata.map(([id]) => id).join(', ')}`,
          path: `artifacts.${validPatch.payload.id}`,
          details: { contractIds: referencingContractsMetadata.map(([id]) => id) },
        });
      }

      const nodeWithPrimaryArtifact = Object.entries(graph.nodes).find(
        ([_, node]) => {
          const primaryArtifacts = node.metadata?.primaryArtifacts as Record<string, string> | undefined;
          return primaryArtifacts && Object.values(primaryArtifacts).includes(validPatch.payload.id);
        }
      );
      if (nodeWithPrimaryArtifact) {
        errors.push({
          code: 'ARTIFACT_IS_PRIMARY',
          message: `Cannot remove artifact ${validPatch.payload.id}: set as primary for node ${nodeWithPrimaryArtifact[0]}. Unset primary first.`,
          path: `artifacts.${validPatch.payload.id}`,
          details: { nodeId: nodeWithPrimaryArtifact[0] },
        });
      }
      break;
    }

    case 'add_port': {
      const node = graph.nodes[validPatch.payload.nodeId];
      if (!node) {
        errors.push({
          code: 'NODE_NOT_FOUND',
          message: `Node ${validPatch.payload.nodeId} does not exist`,
          path: `nodes.${validPatch.payload.nodeId}`,
        });
      } else {
        const existingPort = node.ports?.find(p => p.id === validPatch.payload.port.id);
        if (existingPort) {
          errors.push({
            code: 'PORT_EXISTS',
            message: `Port ${validPatch.payload.port.id} already exists on node ${validPatch.payload.nodeId}`,
            path: `nodes.${validPatch.payload.nodeId}.ports`,
          });
        }
      }
      if (validPatch.payload.port.contractId && !graph.contracts[validPatch.payload.port.contractId]) {
        errors.push({
          code: 'CONTRACT_NOT_FOUND',
          message: `Contract ${validPatch.payload.port.contractId} does not exist`,
          path: `nodes.${validPatch.payload.nodeId}.ports`,
        });
      }
      break;
    }

    case 'update_port': {
      const node = graph.nodes[validPatch.payload.nodeId];
      if (!node) {
        errors.push({
          code: 'NODE_NOT_FOUND',
          message: `Node ${validPatch.payload.nodeId} does not exist`,
          path: `nodes.${validPatch.payload.nodeId}`,
        });
      } else {
        const port = node.ports?.find(p => p.id === validPatch.payload.portId);
        if (!port) {
          errors.push({
            code: 'PORT_NOT_FOUND',
            message: `Port ${validPatch.payload.portId} does not exist on node ${validPatch.payload.nodeId}`,
            path: `nodes.${validPatch.payload.nodeId}.ports`,
          });
        }
      }
      if (validPatch.payload.changes.contractId && !graph.contracts[validPatch.payload.changes.contractId]) {
        errors.push({
          code: 'CONTRACT_NOT_FOUND',
          message: `Contract ${validPatch.payload.changes.contractId} does not exist`,
        });
      }
      break;
    }

    case 'delete_port': {
      const node = graph.nodes[validPatch.payload.nodeId];
      if (!node) {
        errors.push({
          code: 'NODE_NOT_FOUND',
          message: `Node ${validPatch.payload.nodeId} does not exist`,
          path: `nodes.${validPatch.payload.nodeId}`,
        });
      } else {
        const port = node.ports?.find(p => p.id === validPatch.payload.portId);
        if (!port) {
          errors.push({
            code: 'PORT_NOT_FOUND',
            message: `Port ${validPatch.payload.portId} does not exist on node ${validPatch.payload.nodeId}`,
            path: `nodes.${validPatch.payload.nodeId}.ports`,
          });
        }
      }
      const referencingEdges = Object.entries(graph.edges).filter(
        ([_, edge]) =>
          edge.sourcePortId === validPatch.payload.portId || edge.targetPortId === validPatch.payload.portId
      );
      if (referencingEdges.length > 0) {
        errors.push({
          code: 'PORT_IN_USE',
          message: `Cannot delete port ${validPatch.payload.portId}: referenced by edges ${referencingEdges.map(([id]) => id).join(', ')}`,
          path: `nodes.${validPatch.payload.nodeId}.ports`,
          details: { edgeIds: referencingEdges.map(([id]) => id) },
        });
      }
      break;
    }

    case 'connect_ports': {
      const sourceNode = graph.nodes[validPatch.payload.sourceNodeId];
      const targetNode = graph.nodes[validPatch.payload.targetNodeId];

      if (!sourceNode) {
        errors.push({
          code: 'SOURCE_NODE_NOT_FOUND',
          message: `Source node ${validPatch.payload.sourceNodeId} does not exist`,
          path: `nodes.${validPatch.payload.sourceNodeId}`,
        });
      } else {
        const sourcePort = sourceNode.ports?.find(p => p.id === validPatch.payload.sourcePortId);
        if (!sourcePort) {
          errors.push({
            code: 'SOURCE_PORT_NOT_FOUND',
            message: `Source port ${validPatch.payload.sourcePortId} does not exist on node ${validPatch.payload.sourceNodeId}`,
            path: `nodes.${validPatch.payload.sourceNodeId}.ports`,
          });
        } else if (sourcePort.direction !== 'out') {
          errors.push({
            code: 'INVALID_PORT_DIRECTION',
            message: `Source port ${validPatch.payload.sourcePortId} must have direction 'out', got '${sourcePort.direction}'`,
            path: `nodes.${validPatch.payload.sourceNodeId}.ports`,
          });
        }
      }

      if (!targetNode) {
        errors.push({
          code: 'TARGET_NODE_NOT_FOUND',
          message: `Target node ${validPatch.payload.targetNodeId} does not exist`,
          path: `nodes.${validPatch.payload.targetNodeId}`,
        });
      } else {
        const targetPort = targetNode.ports?.find(p => p.id === validPatch.payload.targetPortId);
        if (!targetPort) {
          errors.push({
            code: 'TARGET_PORT_NOT_FOUND',
            message: `Target port ${validPatch.payload.targetPortId} does not exist on node ${validPatch.payload.targetNodeId}`,
            path: `nodes.${validPatch.payload.targetNodeId}.ports`,
          });
        } else if (targetPort.direction !== 'in') {
          errors.push({
            code: 'INVALID_PORT_DIRECTION',
            message: `Target port ${validPatch.payload.targetPortId} must have direction 'in', got '${targetPort.direction}'`,
            path: `nodes.${validPatch.payload.targetNodeId}.ports`,
          });
        }
      }

      if (graph.edges[validPatch.payload.edgeId]) {
        errors.push({
          code: 'EDGE_EXISTS',
          message: `Edge ${validPatch.payload.edgeId} already exists`,
          path: `edges.${validPatch.payload.edgeId}`,
        });
      }

      if (!validPatch.payload.contract && !graph.contracts[validPatch.payload.contractId]) {
        errors.push({
          code: 'CONTRACT_NOT_FOUND',
          message: `Contract ${validPatch.payload.contractId} does not exist and no inline contract provided`,
          path: `contracts.${validPatch.payload.contractId}`,
        });
      }

      if (validPatch.payload.contract) {
        const contract = validPatch.payload.contract;
        if (graph.contracts[contract.id]) {
          errors.push({
            code: 'CONTRACT_EXISTS',
            message: `Inline contract ${contract.id} already exists in graph`,
            path: `contracts.${contract.id}`,
          });
        }
        if (!(CONTRACT_KIND_VALUES as readonly string[]).includes(contract.kind)) {
          errors.push({
            code: 'INVALID_CONTRACT_KIND',
            message: `Invalid contract kind '${contract.kind}'`,
            path: `contracts.${contract.id}.kind`,
          });
        }
      }
      break;
    }

    case 'create_node_from_template':
      if (graph.nodes[validPatch.payload.nodeId]) {
        errors.push({
          code: 'NODE_EXISTS',
          message: `Node ${validPatch.payload.nodeId} already exists`,
          path: `nodes.${validPatch.payload.nodeId}`,
        });
      }
      for (const contract of validPatch.payload.contracts) {
        if (graph.contracts[contract.id]) {
          errors.push({
            code: 'CONTRACT_EXISTS',
            message: `Contract ${contract.id} already exists`,
            path: `contracts.${contract.id}`,
          });
        }
      }
      break;

    case 'instantiate_contract_stub':
      if (graph.contracts[validPatch.payload.id]) {
        errors.push({
          code: 'CONTRACT_EXISTS',
          message: `Contract ${validPatch.payload.id} already exists`,
          path: `contracts.${validPatch.payload.id}`,
        });
      }
      break;

    case 'attach_artifact_stub':
      if (graph.artifacts[validPatch.payload.id]) {
        errors.push({
          code: 'ARTIFACT_EXISTS',
          message: `Artifact ${validPatch.payload.id} already exists`,
          path: `artifacts.${validPatch.payload.id}`,
        });
      }
      if (!graph.nodes[validPatch.payload.nodeId]) {
        errors.push({
          code: 'NODE_NOT_FOUND',
          message: `Node ${validPatch.payload.nodeId} does not exist`,
          path: `nodes.${validPatch.payload.nodeId}`,
        });
      }
      break;

    case 'mark_entity_complete': {
      const { entityType, entityId, nodeId } = validPatch.payload;
      switch (entityType) {
        case 'node':
          if (!graph.nodes[entityId]) {
            errors.push({
              code: 'NODE_NOT_FOUND',
              message: `Node ${entityId} does not exist`,
              path: `nodes.${entityId}`,
            });
          }
          break;
        case 'contract':
          if (!graph.contracts[entityId]) {
            errors.push({
              code: 'CONTRACT_NOT_FOUND',
              message: `Contract ${entityId} does not exist`,
              path: `contracts.${entityId}`,
            });
          }
          break;
        case 'artifact':
          if (!graph.artifacts[entityId]) {
            errors.push({
              code: 'ARTIFACT_NOT_FOUND',
              message: `Artifact ${entityId} does not exist`,
              path: `artifacts.${entityId}`,
            });
          }
          break;
        case 'port':
          if (!nodeId) {
            errors.push({
              code: 'MISSING_NODE_ID',
              message: 'nodeId is required when marking a port as complete',
            });
          } else {
            const portNode = graph.nodes[nodeId];
            if (!portNode) {
              errors.push({
                code: 'NODE_NOT_FOUND',
                message: `Node ${nodeId} does not exist`,
                path: `nodes.${nodeId}`,
              });
            } else {
              const port = portNode.ports?.find(p => p.id === entityId);
              if (!port) {
                errors.push({
                  code: 'PORT_NOT_FOUND',
                  message: `Port ${entityId} does not exist on node ${nodeId}`,
                  path: `nodes.${nodeId}.ports`,
                });
              }
            }
          }
          break;
      }
      break;
    }

    case 'add_node_group':
      if (!graph.nodeGroups) {
        break;
      }
      if (graph.nodeGroups[validPatch.payload.id]) {
        errors.push({
          code: 'NODE_GROUP_EXISTS',
          message: `NodeGroup ${validPatch.payload.id} already exists`,
          path: `nodeGroups.${validPatch.payload.id}`,
        });
      }
      for (const nodeId of validPatch.payload.nodeIds) {
        if (!graph.nodes[nodeId]) {
          errors.push({
            code: 'NODE_NOT_FOUND',
            message: `Node ${nodeId} referenced in NodeGroup does not exist`,
            path: `nodeGroups.${validPatch.payload.id}.nodeIds`,
          });
        }
      }
      break;

    case 'update_node_group':
      if (!graph.nodeGroups || !graph.nodeGroups[validPatch.payload.id]) {
        errors.push({
          code: 'NODE_GROUP_NOT_FOUND',
          message: `NodeGroup ${validPatch.payload.id} does not exist`,
          path: `nodeGroups.${validPatch.payload.id}`,
        });
      }
      if (validPatch.payload.changes.nodeIds) {
        for (const nodeId of validPatch.payload.changes.nodeIds) {
          if (!graph.nodes[nodeId]) {
            errors.push({
              code: 'NODE_NOT_FOUND',
              message: `Node ${nodeId} referenced in NodeGroup does not exist`,
              path: `nodeGroups.${validPatch.payload.id}.nodeIds`,
            });
          }
        }
      }
      break;

    case 'remove_node_group':
      if (!graph.nodeGroups || !graph.nodeGroups[validPatch.payload.id]) {
        errors.push({
          code: 'NODE_GROUP_NOT_FOUND',
          message: `NodeGroup ${validPatch.payload.id} does not exist`,
          path: `nodeGroups.${validPatch.payload.id}`,
        });
      }
      break;
  }

  return { valid: errors.length === 0, errors, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Of the candidate contract ids, return those no longer referenced by any edge's
 * contractId or any node port's contractId. Scoped GC: callers pass only the contracts
 * touched by the edges they just removed — deliberately-created standalone contracts
 * (add_contract awaiting wiring) are never candidates and always survive.
 */
function collectOrphanedContracts(graph: Graph, candidateContractIds: Iterable<string>): string[] {
  const stillReferenced = new Set<string>();
  for (const edge of Object.values(graph.edges)) {
    stillReferenced.add(edge.contractId);
  }
  for (const node of Object.values(graph.nodes)) {
    for (const port of node.ports ?? []) {
      if (port.contractId) stillReferenced.add(port.contractId);
    }
  }
  const orphaned: string[] = [];
  for (const id of candidateContractIds) {
    if (graph.contracts[id] && !stillReferenced.has(id)) orphaned.push(id);
  }
  return orphaned;
}

function applyPatchToGraph(graph: Graph, patch: PatchOperation): void {
  switch (patch.type) {
    case 'add_node': {
      const sanitizedPayload = { ...patch.payload } as any;
      if (sanitizedPayload.ports) {
        sanitizedPayload.ports = sanitizedPayload.ports.map((p: any) => ({ ...p }));
      }
      if (sanitizedPayload.metadata) {
        sanitizedPayload.metadata = { ...sanitizedPayload.metadata };
      }

      if (sanitizedPayload.artifacts && sanitizedPayload.artifacts.length > 0) {
        console.warn(`[patch-engine] Node ${sanitizedPayload.id} has pre-populated artifacts array, stripping it. Artifacts should be added via add_artifact patches.`);
        delete sanitizedPayload.artifacts;
      }

      if (sanitizedPayload.ports && sanitizedPayload.ports.length > 0) {
        sanitizedPayload.ports = sanitizedPayload.ports.map((port: any) => {
          if (port.contractId && !graph.contracts[port.contractId]) {
            console.warn(`[patch-engine] Port ${port.id} references non-existent contract ${port.contractId}, clearing contractId`);
            return { ...port, contractId: undefined };
          }
          return port;
        });
      }
      graph.nodes[patch.payload.id] = sanitizedPayload;
      break;
    }

    case 'update_node': {
      const sanitizedChanges = { ...patch.payload.changes };
      if (sanitizedChanges.ports && sanitizedChanges.ports.length > 0) {
        sanitizedChanges.ports = sanitizedChanges.ports.map(port => {
          if (port.contractId && !graph.contracts[port.contractId]) {
            console.warn(`[patch-engine] Port ${port.id} references non-existent contract ${port.contractId}, clearing contractId`);
            return { ...port, contractId: undefined };
          }
          return port;
        });
      }
      const existingNode = graph.nodes[patch.payload.id];
      if (sanitizedChanges.metadata && existingNode.metadata) {
        sanitizedChanges.metadata = {
          ...existingNode.metadata,
          ...sanitizedChanges.metadata,
        };
      }
      graph.nodes[patch.payload.id] = {
        ...existingNode,
        ...sanitizedChanges,
      };
      break;
    }

    case 'remove_node':
    case 'delete_node': {
      const nodeId = patch.payload.id;
      delete graph.nodes[nodeId];

      const removedEdgeContractIds = new Set<string>();
      for (const [edgeId, edge] of Object.entries(graph.edges)) {
        if (edge.source === nodeId || edge.target === nodeId) {
          removedEdgeContractIds.add(edge.contractId);
          delete graph.edges[edgeId];
        }
      }

      const deletedArtifactIds = new Set<string>();
      for (const [artifactId, artifact] of Object.entries(graph.artifacts)) {
        if (artifact.nodeId === nodeId) {
          delete graph.artifacts[artifactId];
          deletedArtifactIds.add(artifactId);
        }
      }

      for (const contract of Object.values(graph.contracts)) {
        if (contract.schemaRef && deletedArtifactIds.has(contract.schemaRef)) {
          delete contract.schemaRef;
        }
      }

      // GC contracts orphaned by the edge cascade (no other edge or port references
      // them). Contracts referenced elsewhere — or never referenced by these edges —
      // are untouched.
      for (const contractId of collectOrphanedContracts(graph, removedEdgeContractIds)) {
        delete graph.contracts[contractId];
      }
      break;
    }

    case 'add_edge':
      graph.edges[patch.payload.id] = { ...patch.payload, metadata: patch.payload.metadata ? { ...patch.payload.metadata } : {} };
      break;

    case 'update_edge':
      graph.edges[patch.payload.id] = {
        ...graph.edges[patch.payload.id],
        ...patch.payload.changes,
      };
      break;

    case 'remove_edge':
    case 'delete_edge': {
      const removedEdge = graph.edges[patch.payload.id];
      delete graph.edges[patch.payload.id];
      // GC the edge's contract if nothing else (edge or port) references it.
      if (removedEdge) {
        for (const contractId of collectOrphanedContracts(graph, [removedEdge.contractId])) {
          delete graph.contracts[contractId];
        }
      }
      break;
    }

    case 'set_edge_direction':
      graph.edges[patch.payload.id] = {
        ...graph.edges[patch.payload.id],
        direction: patch.payload.direction,
      };
      break;

    case 'set_edge_criticality':
      graph.edges[patch.payload.id] = {
        ...graph.edges[patch.payload.id],
        criticality: patch.payload.criticality,
      };
      break;

    case 'add_contract':
      graph.contracts[patch.payload.id] = { ...patch.payload, metadata: patch.payload.metadata ? { ...patch.payload.metadata } : {} };
      break;

    case 'update_contract':
      graph.contracts[patch.payload.id] = {
        ...graph.contracts[patch.payload.id],
        ...patch.payload.changes,
      };
      break;

    case 'remove_contract':
    case 'delete_contract':
      delete graph.contracts[patch.payload.id];
      break;

    case 'add_artifact': {
      const dupeEntry = Object.entries(graph.artifacts).find(
        ([, a]) => a.nodeId === patch.payload.nodeId && a.path === patch.payload.path
      );
      if (dupeEntry) {
        const [oldId] = dupeEntry;
        delete graph.artifacts[oldId];
        for (const n of Object.values(graph.nodes)) {
          if (n.artifacts) {
            n.artifacts = n.artifacts.filter((id: string) => id !== oldId);
          }
        }
      }
      graph.artifacts[patch.payload.id] = { ...patch.payload, metadata: patch.payload.metadata ? { ...patch.payload.metadata } : {} };
      if (patch.payload.nodeId && graph.nodes[patch.payload.nodeId]) {
        const node = graph.nodes[patch.payload.nodeId];
        if (!node.artifacts) {
          node.artifacts = [];
        }
        if (!node.artifacts.includes(patch.payload.id)) {
          node.artifacts.push(patch.payload.id);
        }
      }
      break;
    }

    case 'update_artifact': {
      const artifact = graph.artifacts[patch.payload.id];
      const updatedArtifact = {
        ...artifact,
        ...patch.payload.changes,
        updatedAt: now(),
      };
      if (patch.payload.changes.content !== undefined) {
        updatedArtifact.contentHash = computeContentHash(patch.payload.changes.content);
      }
      if (patch.payload.changes.nodeId && patch.payload.changes.nodeId !== artifact.nodeId) {
        const oldNode = graph.nodes[artifact.nodeId];
        if (oldNode?.artifacts) {
          oldNode.artifacts = oldNode.artifacts.filter(id => id !== patch.payload.id);
        }
        const newNode = graph.nodes[patch.payload.changes.nodeId];
        if (newNode) {
          if (!newNode.artifacts) newNode.artifacts = [];
          if (!newNode.artifacts.includes(patch.payload.id)) {
            newNode.artifacts.push(patch.payload.id);
          }
        }
      }
      graph.artifacts[patch.payload.id] = updatedArtifact;
      break;
    }

    case 'remove_artifact':
    case 'delete_artifact': {
      delete graph.artifacts[patch.payload.id];
      for (const node of Object.values(graph.nodes)) {
        if (node.artifacts) {
          node.artifacts = node.artifacts.filter(id => id !== patch.payload.id);
        }
      }
      break;
    }

    case 'update_graph_metadata':
      graph.metadata = {
        ...graph.metadata,
        ...patch.payload.changes,
      };
      break;

    case 'add_port': {
      const node = graph.nodes[patch.payload.nodeId];
      if (!node.ports) {
        node.ports = [];
      }
      node.ports.push(patch.payload.port);
      break;
    }

    case 'update_port': {
      const node = graph.nodes[patch.payload.nodeId];
      if (node.ports) {
        const portIndex = node.ports.findIndex(p => p.id === patch.payload.portId);
        if (portIndex >= 0) {
          node.ports[portIndex] = {
            ...node.ports[portIndex],
            ...patch.payload.changes,
          };
        }
      }
      break;
    }

    case 'delete_port': {
      const node = graph.nodes[patch.payload.nodeId];
      if (node.ports) {
        node.ports = node.ports.filter(p => p.id !== patch.payload.portId);
      }
      break;
    }

    case 'connect_ports': {
      if (patch.payload.contract) {
        graph.contracts[patch.payload.contract.id] = patch.payload.contract;
      }
      graph.edges[patch.payload.edgeId] = {
        id: patch.payload.edgeId,
        source: patch.payload.sourceNodeId,
        target: patch.payload.targetNodeId,
        sourcePortId: patch.payload.sourcePortId,
        targetPortId: patch.payload.targetPortId,
        contractId: patch.payload.contractId,
        label: patch.payload.label,
        metadata: {},
      };
      break;
    }

    case 'create_node_from_template': {
      graph.nodes[patch.payload.nodeId] = patch.payload.node;
      for (const contract of patch.payload.contracts) {
        graph.contracts[contract.id] = contract;
      }
      if (patch.payload.artifacts) {
        for (const artifact of patch.payload.artifacts) {
          graph.artifacts[artifact.id] = artifact;
        }
      }
      break;
    }

    case 'instantiate_contract_stub':
      graph.contracts[patch.payload.id] = patch.payload;
      break;

    case 'attach_artifact_stub':
      graph.artifacts[patch.payload.id] = patch.payload;
      break;

    case 'mark_entity_complete': {
      const { entityType, entityId, nodeId } = patch.payload;
      switch (entityType) {
        case 'node':
          graph.nodes[entityId] = {
            ...graph.nodes[entityId],
            status: 'complete',
          };
          break;
        case 'contract':
          graph.contracts[entityId] = {
            ...graph.contracts[entityId],
            status: 'complete',
          };
          break;
        case 'artifact':
          graph.artifacts[entityId] = {
            ...graph.artifacts[entityId],
            status: 'complete',
          };
          break;
        case 'port': {
          const portNode = graph.nodes[nodeId!];
          if (portNode.ports) {
            const portIndex = portNode.ports.findIndex(p => p.id === entityId);
            if (portIndex >= 0) {
              portNode.ports[portIndex] = {
                ...portNode.ports[portIndex],
                status: 'complete',
              };
            }
          }
          break;
        }
      }
      break;
    }

    case 'add_node_group':
      if (!graph.nodeGroups) {
        graph.nodeGroups = {};
      }
      graph.nodeGroups[patch.payload.id] = patch.payload;
      break;

    case 'update_node_group':
      if (graph.nodeGroups && graph.nodeGroups[patch.payload.id]) {
        graph.nodeGroups[patch.payload.id] = {
          ...graph.nodeGroups[patch.payload.id],
          ...patch.payload.changes,
        };
      }
      break;

    case 'remove_node_group':
      if (graph.nodeGroups) {
        delete graph.nodeGroups[patch.payload.id];
      }
      break;
  }
}

function applyPatchInternal(graph: Graph, patch: PatchOperation): Graph {
  const newGraph = deepClone(graph);
  applyPatchToGraph(newGraph, patch);
  newGraph.version = graph.version + 1;
  return updateGraphHash(newGraph);
}

export function applyPatch(graph: Graph, patch: PatchOperation): PatchResult {
  // Normalize patch before validation and application
  const normalizedPatch = normalizePatch(patch) as PatchOperation;

  const validation = validatePatch(graph, normalizedPatch);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.errors[0],
    };
  }

  const newGraph = applyPatchInternal(graph, normalizedPatch);

  const graphValidation = validateGraph(newGraph);
  if (!graphValidation.valid) {
    return {
      success: false,
      error: graphValidation.errors[0],
    };
  }

  return {
    success: true,
    graph: newGraph,
    warnings: validation.warnings,
  };
}

export function applyPatches(graph: Graph, patches: PatchOperation[]): PatchResult {
  if (patches.length === 0) {
    return { success: true, graph: deepClone(graph) };
  }

  const sortedPatches = sortPatchesByDependencyOrder(patches);

  const workingGraph = deepClone(graph);

  let nodesCreated = 0;
  let artifactsCreated = 0;

  for (let i = 0; i < sortedPatches.length; i++) {
    const patch = sortedPatches[i];
    const normalizedPatch = normalizePatch(patch) as PatchOperation;

    const validation = validatePatch(workingGraph, normalizedPatch);
    if (!validation.valid) {
      console.error('[patch-engine] Failing patch at index', i, ':', JSON.stringify(patch, null, 2));
      console.error('[patch-engine] Progress before failure:', {
        patchesApplied: i,
        nodesCreated,
        artifactsCreated,
        currentNodeCount: Object.keys(workingGraph.nodes).length,
      });

      return {
        success: false,
        error: {
          ...validation.errors[0],
          details: {
            ...validation.errors[0]?.details,
            patchIndex: i,
            patchId: patch.metadata.id,
            patchType: patch.type,
          },
        },
      };
    }

    applyPatchToGraph(workingGraph, normalizedPatch);

    if (patch.type === 'add_node') nodesCreated++;
    if (patch.type === 'add_artifact') artifactsCreated++;
  }

  workingGraph.version = graph.version + sortedPatches.length;
  const { hash: _oldHash, ...graphWithoutHash } = workingGraph;
  workingGraph.hash = computeHash(graphWithoutHash);

  const graphValidation = validateGraph(workingGraph);
  if (!graphValidation.valid) {
    console.error('[patch-engine] Final graph validation failed after applying all patches:', graphValidation.errors);
    return { success: false, error: graphValidation.errors[0] };
  }

  console.log('[patch-engine] All patches applied successfully:', {
    totalPatches: sortedPatches.length,
    nodesCreated,
    artifactsCreated,
    finalNodeCount: Object.keys(workingGraph.nodes).length,
    finalArtifactCount: Object.keys(workingGraph.artifacts).length,
  });

  return {
    success: true,
    graph: workingGraph,
  };
}

export function sortPatchesByTimestamp(patches: PatchOperation[]): PatchOperation[] {
  return [...patches].sort((a, b) =>
    new Date(a.metadata.timestamp).getTime() - new Date(b.metadata.timestamp).getTime()
  );
}

/**
 * Sort patches by dependency order to ensure:
 * 1. Contracts before edges (edges reference contracts)
 * 2. Nodes before edges (edges reference nodes)
 * 3. Nodes before artifacts (artifacts reference nodes)
 * 4. Nodes before ports (ports belong to nodes)
 * 5. Within each category, sort by timestamp
 */
/**
 * Topologically sort add_node patches based on parentId dependencies.
 * Ensures parent nodes are created before their children.
 */
function topologicalSortNodes(nodePatches: PatchOperation[]): PatchOperation[] {
  // Type guard to extract only add_node patches
  type AddNodePatch = Extract<PatchOperation, { type: 'add_node' }>;

  // Build dependency graph
  const nodeById = new Map<string, AddNodePatch>();
  const children = new Map<string, AddNodePatch[]>();
  const roots: AddNodePatch[] = [];

  for (const patch of nodePatches) {
    if (patch.type !== 'add_node') continue;
    const addNodePatch = patch as AddNodePatch;
    const nodeId = addNodePatch.payload.id;
    const parentId = addNodePatch.payload.parentId;

    nodeById.set(nodeId, addNodePatch);

    if (!parentId) {
      roots.push(addNodePatch);
    } else {
      if (!children.has(parentId)) {
        children.set(parentId, []);
      }
      children.get(parentId)!.push(addNodePatch);
    }
  }

  // Topological sort via DFS
  const sorted: PatchOperation[] = [];
  const visited = new Set<string>();

  function visit(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const patch = nodeById.get(nodeId);
    if (patch) {
      sorted.push(patch);
    }

    // Visit children
    const childPatches = children.get(nodeId) || [];
    for (const child of childPatches) {
      visit(child.payload.id);
    }
  }

  // Start with roots
  for (const root of roots) {
    visit(root.payload.id);
  }

  // Handle orphaned nodes (parentId references non-existent node)
  // Add them at the end so they don't block other nodes
  for (const patch of nodePatches) {
    if (patch.type === 'add_node') {
      const addNodePatch = patch as AddNodePatch;
      if (!visited.has(addNodePatch.payload.id)) {
        console.warn(`[patch-engine] Orphaned node detected: ${addNodePatch.payload.id} (label: ${addNodePatch.payload.label}) references missing parent ${addNodePatch.payload.parentId}`);
        sorted.push(addNodePatch);
        visited.add(addNodePatch.payload.id);
      }
    }
  }

  return sorted;
}

export function sortPatchesByDependencyOrder(patches: PatchOperation[]): PatchOperation[] {
  const patchOrder: Record<string, number> = {
    // Phase 0: Graph-level metadata (no entity dependencies)
    'update_graph_metadata': 5,

    // Phase 1: Foundation (contracts and template-based node creation)
    'add_contract': 10,
    'update_contract': 11,
    'instantiate_contract_stub': 12,
    'create_node_from_template': 15,

    // Phase 2: Nodes (will be topologically sorted)
    'add_node': 20,
    'update_node': 21,

    // Phase 3: Node children (artifacts, ports, etc.)
    'add_artifact': 30,
    'update_artifact': 31,
    'move_artifact': 32,
    'add_port': 33,
    'update_port': 34,
    'add_obligation': 35,
    'attach_artifact_stub': 36,

    // Phase 4: Edges (require both nodes to exist)
    'add_edge': 40,
    'update_edge': 41,
    'connect_ports': 42,

    // Phase 5: Higher-level structures
    'add_node_group': 50,
    'update_node_group': 51,
    'link_entities': 52,

    // Phase 6: Status updates (entities must exist)
    'mark_entity_complete': 60,

    // Phase 7: Removals (should be last)
    'remove_artifact': 90,
    'delete_artifact': 90,
    'remove_port': 91,
    'delete_port': 91,
    'remove_edge': 92,
    'delete_edge': 92,
    'remove_contract': 93,
    'delete_contract': 93,
    'remove_node': 94,
    'delete_node': 94,
    'remove_node_group': 95,
    'delete_node_group': 95,
    'unlink_entities': 96,
  };

  // Separate patches by type
  const byPhase = new Map<number, PatchOperation[]>();

  for (const patch of patches) {
    const order = patchOrder[patch.type] || 100;
    if (!byPhase.has(order)) {
      byPhase.set(order, []);
    }
    byPhase.get(order)!.push(patch);
  }

  // Sort each phase
  const sorted: PatchOperation[] = [];
  const phases = Array.from(byPhase.keys()).sort((a, b) => a - b);

  for (const phase of phases) {
    const phasePatches = byPhase.get(phase)!;

    if (phase === 20) {
      // Phase 2: Topologically sort add_node patches
      const nodeSorted = topologicalSortNodes(phasePatches);
      sorted.push(...nodeSorted);
    } else {
      // Other phases: sort by timestamp
      phasePatches.sort((a, b) =>
        new Date(a.metadata.timestamp).getTime() - new Date(b.metadata.timestamp).getTime()
      );
      sorted.push(...phasePatches);
    }
  }

  return sorted;
}

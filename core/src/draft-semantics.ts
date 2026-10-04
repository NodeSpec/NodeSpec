import type { Graph, Node, Contract, Artifact, EntityStatus } from './types.js';
import { getNodeCompletenessRequirements, type NodeTemplate } from './templates.js';

export interface ValidationWarning {
  entityType: 'node' | 'contract' | 'artifact';
  entityId: string;
  field: string;
  message: string;
}

export function validateCompleteness(graph: Graph): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.status === 'complete') continue;

    const artifactCount = Object.values(graph.artifacts).filter(a => a.nodeId === nodeId).length;
    const requirements = getNodeCompletenessRequirements(node, artifactCount);

    for (const req of requirements) {
      if (!req.isMet) {
        warnings.push({
          entityType: 'node',
          entityId: nodeId,
          field: req.field,
          message: req.description,
        });
      }
    }
  }

  for (const [contractId, contract] of Object.entries(graph.contracts)) {
    if (contract.status === 'complete') continue;

    if (!contract.name || contract.name === 'Unnamed Contract') {
      warnings.push({
        entityType: 'contract',
        entityId: contractId,
        field: 'name',
        message: 'Contract must have a meaningful name',
      });
    }

    if (!contract.schema || Object.keys(contract.schema).length === 0) {
      warnings.push({
        entityType: 'contract',
        entityId: contractId,
        field: 'schema',
        message: 'Contract should define a schema',
      });
    }
  }

  for (const [artifactId, artifact] of Object.entries(graph.artifacts)) {
    if (artifact.status === 'complete') continue;

    if (!artifact.content || artifact.content.trim().length === 0) {
      warnings.push({
        entityType: 'artifact',
        entityId: artifactId,
        field: 'content',
        message: 'Artifact content is empty',
      });
    }
  }

  return warnings;
}

export function canMarkNodeComplete(node: Node, graph: Graph): { canComplete: boolean; missingRequirements: string[] } {
  const artifactCount = Object.values(graph.artifacts).filter(a => a.nodeId === node.id).length;
  const requirements = getNodeCompletenessRequirements(node, artifactCount);
  const missingRequirements = requirements.filter(r => !r.isMet).map(r => r.description);

  return {
    canComplete: missingRequirements.length === 0,
    missingRequirements,
  };
}

export function canMarkContractComplete(contract: Contract): { canComplete: boolean; missingRequirements: string[] } {
  const missingRequirements: string[] = [];

  if (!contract.name || contract.name === 'Unnamed Contract' || contract.name.startsWith('Stub:')) {
    missingRequirements.push('Contract must have a meaningful name');
  }

  return {
    canComplete: missingRequirements.length === 0,
    missingRequirements,
  };
}

export function canMarkArtifactComplete(artifact: Artifact): { canComplete: boolean; missingRequirements: string[] } {
  const missingRequirements: string[] = [];

  if (!artifact.content || artifact.content.trim().length === 0) {
    missingRequirements.push('Artifact content cannot be empty');
  }

  if (!artifact.path || artifact.path.length === 0) {
    missingRequirements.push('Artifact must have a valid path');
  }

  return {
    canComplete: missingRequirements.length === 0,
    missingRequirements,
  };
}

export function isDraftEntity(entity: { status?: EntityStatus }): boolean {
  return entity.status === 'draft' || entity.status === undefined;
}

export function isCompleteEntity(entity: { status?: EntityStatus }): boolean {
  return entity.status === 'complete';
}

export interface ScaffoldedNode {
  node: Node;
}

// AG.13 (owner 2026-09-28): a scaffolded node carries no ports and no stub
// contracts. A contract is born when an edge is drawn, from the edge's target
// (inferConnectContract); stubs pinned to ports were never used by any edge.
export function scaffoldNodeFromTemplate(
  template: NodeTemplate,
  nodeId: string
): ScaffoldedNode {
  const node: Node = {
    id: nodeId,
    type: template.nodeType,
    label: `New ${template.name}`,
    data: { ...template.defaultData },
    artifacts: [],
    metadata: { templateId: template.id },
    status: 'draft' as EntityStatus,
  };

  return { node };
}

export function createContractStub(
  contractId: string,
  kind: Contract['kind'],
  name: string
): Contract {
  return {
    id: contractId,
    kind,
    name: `Stub: ${name}`,
    schema: {},
    metadata: { isStub: true },
    status: 'draft',
  };
}

export function createArtifactStub(
  artifactId: string,
  nodeId: string,
  kind: Artifact['kind'],
  path: string,
  timestamp: string
): Artifact {
  return {
    id: artifactId,
    nodeId,
    kind,
    path,
    content: '',
    contentHash: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: { isStub: true },
    status: 'draft',
  };
}

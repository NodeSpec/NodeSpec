import type { Graph, Node, Contract, Artifact, Port, EntityStatus } from './types.js';
import { getNodeCompletenessRequirements, type NodeTemplate } from './templates.js';

export interface ValidationWarning {
  entityType: 'node' | 'port' | 'contract' | 'artifact';
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

    const ports = node.ports ?? [];
    for (const port of ports) {
      if (port.status === 'complete') continue;

      if (!port.name || port.name === 'Unnamed Port') {
        warnings.push({
          entityType: 'port',
          entityId: port.id,
          field: 'name',
          message: 'Port must have a meaningful name',
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
  ports: Port[];
  contracts: Contract[];
}

export function scaffoldNodeFromTemplate(
  template: NodeTemplate,
  nodeId: string
): ScaffoldedNode {
  const ports: Port[] = template.defaultPorts.map((portTemplate, index) => ({
    id: generateScaffoldPortId(nodeId, portTemplate.direction, index),
    name: portTemplate.name,
    direction: portTemplate.direction,
    required: portTemplate.required,
    schemaRef: portTemplate.schemaRef,
    status: 'draft' as EntityStatus,
  }));

  const contracts: Contract[] = template.defaultContracts.map((contractTemplate, index) => ({
    id: generateScaffoldContractId(nodeId, index),
    kind: contractTemplate.kind,
    name: `Stub: ${contractTemplate.name}`,
    schema: {},
    metadata: { templateSource: template.id },
    status: 'draft' as EntityStatus,
    ...(contractTemplate.interactionKind && { interactionKind: contractTemplate.interactionKind }),
    ...(contractTemplate.transport && { transport: contractTemplate.transport }),
    ...(contractTemplate.specFormat && { specFormat: contractTemplate.specFormat }),
  }));

  ports.forEach((port, index) => {
    const matchingContract = template.defaultContracts[index];
    if (matchingContract && contracts[index] && port.direction === matchingContract.portDirection) {
      port.contractId = contracts[index].id;
    }
  });

  const node: Node = {
    id: nodeId,
    type: template.nodeType,
    label: `New ${template.name}`,
    ports,
    data: { ...template.defaultData },
    artifacts: [],
    metadata: { templateId: template.id },
    status: 'draft' as EntityStatus,
  };

  return { node, ports, contracts };
}

function generateScaffoldPortId(nodeId: string, direction: 'in' | 'out', index: number): string {
  const base = nodeId.slice(0, 8);
  const dirCode = direction === 'in' ? 'a001' : 'a002';
  const indexHex = (index + 1).toString(16).padStart(3, '0');
  return `${base}-${dirCode}-4${indexHex}-8001-${base.padEnd(12, '0').slice(0, 12)}`;
}

function generateScaffoldContractId(nodeId: string, index: number): string {
  const base = nodeId.slice(0, 8);
  const indexHex = (index + 1).toString(16).padStart(3, '0');
  return `${base}-c${indexHex}-4001-8001-${base.padEnd(12, '0').slice(0, 12)}`;
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

import type {
  PatchOperation,
  Node,
  Port,
  Contract,
  ActorType,
  Precondition,
  ContractKind,
  InteractionKind,
  TransportKind,
  SpecFormat,
} from '@nodespec/core/types.js';
import {
  PatchOperationSchema,
  PortSchema,
  ContractSchema,
} from '@nodespec/core/schemas.js';
import { generateUUID, now, computeHash } from '@nodespec/core/utils.js';
import { getTemplateByNodeType } from '@nodespec/core/templates.js';

export class PatchBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchBuilderError';
  }
}

interface BuilderOptions {
  actor: ActorType;
  summary: string;
  preconditions?: Precondition[];
}

function createMetadata(options: BuilderOptions) {
  return {
    id: generateUUID(),
    actorType: options.actor,
    summary: options.summary,
    timestamp: now(),
    preconditions: options.preconditions,
  };
}

function validateAndReturn(patch: unknown): PatchOperation {
  const result = PatchOperationSchema.safeParse(patch);
  if (!result.success) {
    throw new PatchBuilderError(
      `Invalid patch structure: ${result.error.message}`
    );
  }
  return result.data;
}

function validateUUID(value: string, fieldName: string): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new PatchBuilderError(`${fieldName} must be a valid UUID, got: ${value}`);
  }
}

function validateNonEmpty(value: string, fieldName: string): void {
  if (!value || value.trim().length === 0) {
    throw new PatchBuilderError(`${fieldName} must not be empty`);
  }
}

export interface UpdateNodeInput {
  nodeId: string;
  updates: Partial<Omit<Node, 'id'>>;
  actor: ActorType;
  summary: string;
  preconditions?: Precondition[];
}

export function buildUpdateNodePatch(input: UpdateNodeInput): PatchOperation {
  validateUUID(input.nodeId, 'nodeId');

  if (Object.keys(input.updates).length === 0) {
    throw new PatchBuilderError('updates must contain at least one field');
  }

  const patch = {
    type: 'update_node' as const,
    metadata: createMetadata({
      actor: input.actor,
      summary: input.summary,
      preconditions: input.preconditions,
    }),
    payload: {
      id: input.nodeId,
      changes: input.updates,
    },
  };

  return validateAndReturn(patch);
}

export interface AddPortInput {
  nodeId: string;
  port: {
    id?: string;
    name: string;
    direction: 'in' | 'out';
    contractId?: string;
    schemaRef?: string;
    required?: boolean;
  };
  actor: ActorType;
  summary: string;
  preconditions?: Precondition[];
}

export function buildAddPortPatch(input: AddPortInput): PatchOperation {
  validateUUID(input.nodeId, 'nodeId');
  validateNonEmpty(input.port.name, 'port.name');

  if (input.port.direction !== 'in' && input.port.direction !== 'out') {
    throw new PatchBuilderError(`port.direction must be 'in' or 'out', got: ${input.port.direction}`);
  }

  const portId = input.port.id ?? generateUUID();
  validateUUID(portId, 'port.id');

  if (input.port.contractId) {
    validateUUID(input.port.contractId, 'port.contractId');
  }

  const port: Port = {
    id: portId,
    name: input.port.name,
    direction: input.port.direction,
    contractId: input.port.contractId,
    schemaRef: input.port.schemaRef,
    required: input.port.required,
  };

  const portValidation = PortSchema.safeParse(port);
  if (!portValidation.success) {
    throw new PatchBuilderError(`Invalid port: ${portValidation.error.message}`);
  }

  const patch = {
    type: 'add_port' as const,
    metadata: createMetadata({
      actor: input.actor,
      summary: input.summary,
      preconditions: input.preconditions,
    }),
    payload: {
      nodeId: input.nodeId,
      port: portValidation.data,
    },
  };

  return validateAndReturn(patch);
}

export interface ConnectPortsInput {
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  contract?: {
    id?: string;
    kind: ContractKind;
    interactionKind?: InteractionKind;
    transport?: TransportKind;
    specFormat?: SpecFormat;
    name: string;
    schema?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  existingContractId?: string;
  label?: string;
  actor: ActorType;
  summary: string;
  preconditions?: Precondition[];
}

export function buildConnectPortsPatch(input: ConnectPortsInput): PatchOperation {
  validateUUID(input.sourceNodeId, 'sourceNodeId');
  validateUUID(input.sourcePortId, 'sourcePortId');
  validateUUID(input.targetNodeId, 'targetNodeId');
  validateUUID(input.targetPortId, 'targetPortId');

  if (!input.contract && !input.existingContractId) {
    throw new PatchBuilderError('Either contract or existingContractId must be provided');
  }

  const edgeId = generateUUID();
  let contractId: string;
  let contractData: Contract | undefined;

  if (input.contract) {
    contractId = input.contract.id ?? generateUUID();
    validateUUID(contractId, 'contract.id');
    validateNonEmpty(input.contract.name, 'contract.name');

    contractData = {
      id: contractId,
      kind: input.contract.kind,
      interactionKind: input.contract.interactionKind,
      transport: input.contract.transport,
      specFormat: input.contract.specFormat,
      name: input.contract.name,
      schema: input.contract.schema,
      metadata: input.contract.metadata,
    };

    const contractValidation = ContractSchema.safeParse(contractData);
    if (!contractValidation.success) {
      throw new PatchBuilderError(`Invalid contract: ${contractValidation.error.message}`);
    }
    contractData = contractValidation.data;
  } else {
    contractId = input.existingContractId!;
    validateUUID(contractId, 'existingContractId');
  }

  const patch = {
    type: 'connect_ports' as const,
    metadata: createMetadata({
      actor: input.actor,
      summary: input.summary,
      preconditions: input.preconditions,
    }),
    payload: {
      sourceNodeId: input.sourceNodeId,
      sourcePortId: input.sourcePortId,
      targetNodeId: input.targetNodeId,
      targetPortId: input.targetPortId,
      edgeId,
      contractId,
      contract: contractData,
      label: input.label,
    },
  };

  return validateAndReturn(patch);
}

export interface AddNodeInput {
  node: {
    id?: string;
    type: string;
    label: string;
    position?: { x: number; y: number };
    ports?: Port[];
    data?: Record<string, unknown>;
    artifacts?: string[];
    metadata?: Record<string, unknown>;
  };
  actor: ActorType;
  summary: string;
  preconditions?: Precondition[];
}

export function buildAddNodePatch(input: AddNodeInput): PatchOperation {
  const nodeId = input.node.id ?? generateUUID();
  validateUUID(nodeId, 'node.id');
  validateNonEmpty(input.node.type, 'node.type');

  if (input.node.artifacts) {
    for (const artifactId of input.node.artifacts) {
      validateUUID(artifactId, 'artifacts[]');
    }
  }

  let ports = input.node.ports;
  if (!ports || ports.length === 0) {
    const template = getTemplateByNodeType(input.node.type);
    if (template && template.defaultPorts.length > 0) {
      ports = template.defaultPorts.map((pt) => ({
        id: generateUUID(),
        name: pt.name,
        direction: pt.direction,
        required: pt.required,
        schemaRef: pt.schemaRef,
      }));
    }
  }

  const patch = {
    type: 'add_node' as const,
    metadata: createMetadata({
      actor: input.actor,
      summary: input.summary,
      preconditions: input.preconditions,
    }),
    payload: {
      id: nodeId,
      type: input.node.type,
      label: input.node.label,
      position: input.node.position,
      ports,
      data: input.node.data,
      artifacts: input.node.artifacts,
      metadata: input.node.metadata,
    },
  };

  return validateAndReturn(patch);
}

export interface RemoveNodeInput {
  nodeId: string;
  actor: ActorType;
  summary: string;
  preconditions?: Precondition[];
}

export function buildRemoveNodePatch(input: RemoveNodeInput): PatchOperation {
  validateUUID(input.nodeId, 'nodeId');

  const patch = {
    type: 'remove_node' as const,
    metadata: createMetadata({
      actor: input.actor,
      summary: input.summary,
      preconditions: input.preconditions,
    }),
    payload: {
      id: input.nodeId,
    },
  };

  return validateAndReturn(patch);
}

export interface RemoveEdgeInput {
  edgeId: string;
  actor: ActorType;
  summary: string;
  preconditions?: Precondition[];
}

export function buildRemoveEdgePatch(input: RemoveEdgeInput): PatchOperation {
  validateUUID(input.edgeId, 'edgeId');

  const patch = {
    type: 'remove_edge' as const,
    metadata: createMetadata({
      actor: input.actor,
      summary: input.summary,
      preconditions: input.preconditions,
    }),
    payload: {
      id: input.edgeId,
    },
  };

  return validateAndReturn(patch);
}

export interface AddContractInput {
  contract: {
    id?: string;
    kind: ContractKind;
    interactionKind?: InteractionKind;
    transport?: TransportKind;
    specFormat?: SpecFormat;
    name: string;
    schema?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  actor: ActorType;
  summary: string;
  preconditions?: Precondition[];
}

export function buildAddContractPatch(input: AddContractInput): PatchOperation {
  const contractId = input.contract.id ?? generateUUID();
  validateUUID(contractId, 'contract.id');
  validateNonEmpty(input.contract.name, 'contract.name');

  const patch = {
    type: 'add_contract' as const,
    metadata: createMetadata({
      actor: input.actor,
      summary: input.summary,
      preconditions: input.preconditions,
    }),
    payload: {
      id: contractId,
      kind: input.contract.kind,
      interactionKind: input.contract.interactionKind,
      transport: input.contract.transport,
      specFormat: input.contract.specFormat,
      name: input.contract.name,
      schema: input.contract.schema,
      metadata: input.contract.metadata,
    },
  };

  return validateAndReturn(patch);
}

export interface AddEdgeInput {
  edge: {
    id?: string;
    source: string;
    target: string;
    sourcePortId?: string;
    targetPortId?: string;
    contractId: string;
    label?: string;
    metadata?: Record<string, unknown>;
  };
  actor: ActorType;
  summary: string;
  preconditions?: Precondition[];
}

export function buildAddEdgePatch(input: AddEdgeInput): PatchOperation {
  const edgeId = input.edge.id ?? generateUUID();
  validateUUID(edgeId, 'edge.id');
  validateUUID(input.edge.source, 'edge.source');
  validateUUID(input.edge.target, 'edge.target');
  validateUUID(input.edge.contractId, 'edge.contractId');

  if (input.edge.sourcePortId) {
    validateUUID(input.edge.sourcePortId, 'edge.sourcePortId');
  }
  if (input.edge.targetPortId) {
    validateUUID(input.edge.targetPortId, 'edge.targetPortId');
  }

  const patch = {
    type: 'add_edge' as const,
    metadata: createMetadata({
      actor: input.actor,
      summary: input.summary,
      preconditions: input.preconditions,
    }),
    payload: {
      id: edgeId,
      source: input.edge.source,
      target: input.edge.target,
      sourcePortId: input.edge.sourcePortId,
      targetPortId: input.edge.targetPortId,
      contractId: input.edge.contractId,
      label: input.edge.label,
      metadata: input.edge.metadata,
    },
  };

  return validateAndReturn(patch);
}

export function computeNodeHashPrecondition(nodeId: string, node: Node): Precondition {
  return {
    type: 'hash_match',
    path: `nodes.${nodeId}`,
    expected: computeHash(node),
  };
}

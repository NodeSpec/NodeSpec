import type {
  PatchOperation,
  Node,
  ActorType,
  Precondition,
  ContractKind,
  InteractionKind,
  TransportKind,
  SpecFormat,
} from '@nodespec/core/types.js';
import {
  PatchOperationSchema,
} from '@nodespec/core/schemas.js';
import { generateUUID, now, computeHash } from '@nodespec/core/utils.js';

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

export interface AddNodeInput {
  node: {
    id?: string;
    type: string;
    label: string;
    position?: { x: number; y: number };
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

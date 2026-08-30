import type {
  ActorType,
  Precondition,
  PatchMetadata,
  Node,
  Edge,
  Contract,
  Artifact,
  Port,
  AddNodePatch,
  UpdateNodePatch,
  RemoveNodePatch,
  AddEdgePatch,
  UpdateEdgePatch,
  RemoveEdgePatch,
  AddContractPatch,
  UpdateContractPatch,
  RemoveContractPatch,
  AddArtifactPatch,
  UpdateArtifactPatch,
  RemoveArtifactPatch,
  UpdateGraphMetadataPatch,
  AddPortPatch,
  UpdatePortPatch,
  DeletePortPatch,
  ConnectPortsPatch,
  CreateNodeFromTemplatePatch,
} from './types.js';
import { generateUUID, now, computeContentHash } from './utils.js';
import { scaffoldNodeFromTemplate } from './draft-semantics.js';
import { getTemplateById, getArtifactPlaceholdersForNode } from './templates.js';

interface PatchOptions {
  actorType: ActorType;
  actorId?: string;
  summary: string;
  preconditions?: Precondition[];
}

function createMetadata(options: PatchOptions): PatchMetadata {
  return {
    id: generateUUID(),
    actorType: options.actorType,
    actorId: options.actorId,
    summary: options.summary,
    timestamp: now(),
    preconditions: options.preconditions,
  };
}

export function createPatchMetadata(options: PatchOptions): PatchMetadata {
  return createMetadata(options);
}

export function createAddNodePatch(
  node: Node,
  options: PatchOptions
): AddNodePatch {
  return {
    type: 'add_node',
    metadata: createMetadata(options),
    payload: node,
  };
}

export function createUpdateNodePatch(
  id: string,
  changes: Partial<Omit<Node, 'id'>>,
  options: PatchOptions
): UpdateNodePatch {
  return {
    type: 'update_node',
    metadata: createMetadata(options),
    payload: { id, changes },
  };
}

export function createRemoveNodePatch(
  id: string,
  options: PatchOptions
): RemoveNodePatch {
  return {
    type: 'remove_node',
    metadata: createMetadata(options),
    payload: { id },
  };
}

export function createAddEdgePatch(
  edge: Edge,
  options: PatchOptions
): AddEdgePatch {
  return {
    type: 'add_edge',
    metadata: createMetadata(options),
    payload: edge,
  };
}

export function createUpdateEdgePatch(
  id: string,
  changes: Partial<Omit<Edge, 'id'>>,
  options: PatchOptions
): UpdateEdgePatch {
  return {
    type: 'update_edge',
    metadata: createMetadata(options),
    payload: { id, changes },
  };
}

export function createRemoveEdgePatch(
  id: string,
  options: PatchOptions
): RemoveEdgePatch {
  return {
    type: 'remove_edge',
    metadata: createMetadata(options),
    payload: { id },
  };
}

export function createAddContractPatch(
  contract: Contract,
  options: PatchOptions
): AddContractPatch {
  return {
    type: 'add_contract',
    metadata: createMetadata(options),
    payload: contract,
  };
}

export function createUpdateContractPatch(
  id: string,
  changes: Partial<Omit<Contract, 'id'>>,
  options: PatchOptions
): UpdateContractPatch {
  return {
    type: 'update_contract',
    metadata: createMetadata(options),
    payload: { id, changes },
  };
}

export function createRemoveContractPatch(
  id: string,
  options: PatchOptions
): RemoveContractPatch {
  return {
    type: 'remove_contract',
    metadata: createMetadata(options),
    payload: { id },
  };
}

export function createAddArtifactPatch(
  artifact: Artifact,
  options: PatchOptions
): AddArtifactPatch {
  return {
    type: 'add_artifact',
    metadata: createMetadata(options),
    payload: artifact,
  };
}

export function createUpdateArtifactPatch(
  id: string,
  changes: Partial<Omit<Artifact, 'id'>>,
  options: PatchOptions
): UpdateArtifactPatch {
  const updatedChanges = { ...changes };

  // Automatically compute contentHash if content is being changed
  // Use computeContentHash to match patch-engine behavior
  if (changes.content !== undefined && changes.contentHash === undefined) {
    updatedChanges.contentHash = computeContentHash(changes.content);
  }

  // Automatically update updatedAt timestamp
  if (!updatedChanges.updatedAt) {
    updatedChanges.updatedAt = now();
  }

  return {
    type: 'update_artifact',
    metadata: createMetadata(options),
    payload: { id, changes: updatedChanges },
  };
}

export function createRemoveArtifactPatch(
  id: string,
  options: PatchOptions
): RemoveArtifactPatch {
  return {
    type: 'remove_artifact',
    metadata: createMetadata(options),
    payload: { id },
  };
}

export function createUpdateGraphMetadataPatch(
  changes: Record<string, unknown>,
  options: PatchOptions
): UpdateGraphMetadataPatch {
  return {
    type: 'update_graph_metadata',
    metadata: createMetadata(options),
    payload: { changes },
  };
}

export function createAddPortPatch(
  nodeId: string,
  port: Port,
  options: PatchOptions
): AddPortPatch {
  return {
    type: 'add_port',
    metadata: createMetadata(options),
    payload: { nodeId, port },
  };
}

export function createUpdatePortPatch(
  nodeId: string,
  portId: string,
  changes: Partial<Omit<Port, 'id'>>,
  options: PatchOptions
): UpdatePortPatch {
  return {
    type: 'update_port',
    metadata: createMetadata(options),
    payload: { nodeId, portId, changes },
  };
}

export function createDeletePortPatch(
  nodeId: string,
  portId: string,
  options: PatchOptions
): DeletePortPatch {
  return {
    type: 'delete_port',
    metadata: createMetadata(options),
    payload: { nodeId, portId },
  };
}

export function createConnectPortsPatch(
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
  edgeId: string,
  contractId: string,
  options: PatchOptions,
  contract?: Contract,
  label?: string
): ConnectPortsPatch {
  return {
    type: 'connect_ports',
    metadata: createMetadata(options),
    payload: {
      sourceNodeId,
      sourcePortId,
      targetNodeId,
      targetPortId,
      edgeId,
      contractId,
      contract,
      label,
    },
  };
}

export function createNodeFromTemplatePatch(
  templateId: string,
  nodeId: string,
  label: string | undefined,
  options: PatchOptions,
  additionalMetadata?: Record<string, unknown>,
  parentId?: string
): CreateNodeFromTemplatePatch {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }

  const scaffolded = scaffoldNodeFromTemplate(template, nodeId);

  if (label) {
    scaffolded.node.label = label;
  }

  if (additionalMetadata) {
    scaffolded.node.metadata = {
      ...scaffolded.node.metadata,
      ...additionalMetadata,
    };
  }

  if (parentId) {
    scaffolded.node.parentId = parentId;
  }

  const artifactPlaceholders = getArtifactPlaceholdersForNode(scaffolded.node);

  const suggestedArtifacts: Artifact[] = artifactPlaceholders.map(placeholder => ({
    id: generateUUID(),
    nodeId: scaffolded.node.id,
    kind: placeholder.kind,
    path: placeholder.suggestedPath,
    content: undefined,
    contentHash: undefined,
    language: placeholder.language,
    createdAt: now(),
    updatedAt: now(),
    status: 'suggested' as const,
    description: placeholder.description,
    metadata: {
      isTemplate: true,
      templateId: template.id,
    },
  }));

  return {
    type: 'create_node_from_template',
    metadata: createMetadata(options),
    payload: {
      templateId,
      nodeId,
      node: scaffolded.node,
      contracts: scaffolded.contracts,
      artifacts: suggestedArtifacts,
    },
  };
}

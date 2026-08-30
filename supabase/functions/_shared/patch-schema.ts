import { z } from "npm:zod@3.22.4";
import {
  EntityStatusSchema,
  ContractKindSchema,
  InteractionKindSchema,
  TransportKindSchema,
  SpecFormatSchema,
  PlacementKindSchema,
  PortDirectionSchema,
  ArtifactKindSchema,
  ActorTypeSchema,
  EdgeDirectionSchema,
  EdgeCriticalitySchema,
  GraphOriginSchema,
} from './enums.ts';

export {
  EntityStatusSchema,
  ContractKindSchema,
  InteractionKindSchema,
  TransportKindSchema,
  SpecFormatSchema,
  PlacementKindSchema,
  PortDirectionSchema,
  ArtifactKindSchema,
  ActorTypeSchema,
  EdgeDirectionSchema,
  EdgeCriticalitySchema,
  GraphOriginSchema,
};
export const PortDirectionExtendedSchema = z.enum(['in', 'out', 'bidirectional']);

export const PortSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  direction: PortDirectionExtendedSchema,
  contractId: z.string().uuid().optional(),
  schemaRef: z.string().optional(),
  required: z.boolean().optional(),
  status: EntityStatusSchema.optional(),
  multiplicity: z.string().optional(),
  bindingAddress: z.string().optional(),
  discoverability: z.enum(['static', 'dynamic', 'service_mesh']).optional(),
  idempotency: z.enum(['idempotent', 'non_idempotent', 'at_most_once']).optional(),
});

export const ContractSchema = z.object({
  id: z.string().uuid(),
  kind: ContractKindSchema,
  interactionKind: InteractionKindSchema.optional(),
  transport: TransportKindSchema.optional(),
  specFormat: SpecFormatSchema.optional(),
  name: z.string().min(1),
  schema: z.record(z.unknown()).optional(),
  schemaRef: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
  status: EntityStatusSchema.optional(),
});

export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  nodeId: z.string().uuid().or(z.literal('')),
  kind: ArtifactKindSchema,
  path: z.string().min(1),
  content: z.string().optional(),
  contentHash: z.string().optional(),
  language: z.string().optional(),
  type: z.string().optional(),
  uri: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
  status: EntityStatusSchema.optional(),
  description: z.string().optional(),
  generatedBy: z.string().optional(),
  sourceProvenance: z.string().optional(),
  contentUrl: z.string().url().optional(),
});

export const NodeSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  label: z.string(),
  technology: z.string().optional(),
  deploymentTarget: z.string().optional(),
  ports: z.array(PortSchema).optional(),
  data: z.record(z.unknown()).optional(),
  artifacts: z.array(z.string().uuid()).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: EntityStatusSchema.optional(),
  parentId: z.string().uuid().optional(),
  placementKind: PlacementKindSchema.optional(),
});

export const EdgeSchema = z.object({
  id: z.string().uuid(),
  source: z.string().uuid(),
  target: z.string().uuid(),
  sourcePortId: z.string().uuid().optional(),
  targetPortId: z.string().uuid().optional(),
  contractId: z.string().uuid(),
  label: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  direction: EdgeDirectionSchema.optional(),
  criticality: EdgeCriticalitySchema.optional(),
});

export const NodeGroupSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  nodeIds: z.array(z.string().uuid()),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
  style: z.object({
    backgroundColor: z.string().optional(),
    borderColor: z.string().optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const CURRENT_GRAPH_SCHEMA_VERSION = 8;

export const GraphSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  hash: z.string(),
  nodes: z.record(z.string().uuid(), NodeSchema),
  edges: z.record(z.string().uuid(), EdgeSchema),
  contracts: z.record(z.string().uuid(), ContractSchema),
  artifacts: z.record(z.string().uuid(), ArtifactSchema),
  nodeGroups: z.record(z.string().uuid(), NodeGroupSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
  origin: GraphOriginSchema.optional(),
  sourceContext: z.record(z.unknown()).optional(),
});

export const PreconditionSchema = z.object({
  type: z.enum(['hash_match', 'value_exists', 'value_equals']),
  path: z.string(),
  expected: z.unknown().optional(),
});

export const PatchMetadataSchema = z.object({
  id: z.string().uuid(),
  actorType: ActorTypeSchema,
  actorId: z.string().optional(),
  summary: z.string(),
  timestamp: z.string().datetime(),
  preconditions: z.array(PreconditionSchema).optional(),
});

export const AddNodePatchSchema = z.object({
  type: z.literal('add_node'),
  metadata: PatchMetadataSchema,
  payload: NodeSchema,
});

export const UpdateNodePatchSchema = z.object({
  type: z.literal('update_node'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
    changes: NodeSchema.partial().omit({ id: true }),
  }),
});

export const RemoveNodePatchSchema = z.object({
  type: z.literal('remove_node'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
  }),
});

export const DeleteNodePatchSchema = z.object({
  type: z.literal('delete_node'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
  }),
});

export const AddEdgePatchSchema = z.object({
  type: z.literal('add_edge'),
  metadata: PatchMetadataSchema,
  payload: EdgeSchema,
});

export const UpdateEdgePatchSchema = z.object({
  type: z.literal('update_edge'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
    changes: EdgeSchema.partial().omit({ id: true }),
  }),
});

export const RemoveEdgePatchSchema = z.object({
  type: z.literal('remove_edge'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
  }),
});

export const DeleteEdgePatchSchema = z.object({
  type: z.literal('delete_edge'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
  }),
});

export const AddContractPatchSchema = z.object({
  type: z.literal('add_contract'),
  metadata: PatchMetadataSchema,
  payload: ContractSchema,
});

export const UpdateContractPatchSchema = z.object({
  type: z.literal('update_contract'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
    changes: ContractSchema.partial().omit({ id: true }),
  }),
});

export const RemoveContractPatchSchema = z.object({
  type: z.literal('remove_contract'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
  }),
});

export const DeleteContractPatchSchema = z.object({
  type: z.literal('delete_contract'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
  }),
});

export const AddArtifactPatchSchema = z.object({
  type: z.literal('add_artifact'),
  metadata: PatchMetadataSchema,
  payload: ArtifactSchema,
});

export const UpdateArtifactPatchSchema = z.object({
  type: z.literal('update_artifact'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
    changes: ArtifactSchema.partial().omit({ id: true }),
  }),
});

export const RemoveArtifactPatchSchema = z.object({
  type: z.literal('remove_artifact'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
  }),
});

export const DeleteArtifactPatchSchema = z.object({
  type: z.literal('delete_artifact'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
  }),
});

export const UpdateGraphMetadataPatchSchema = z.object({
  type: z.literal('update_graph_metadata'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    changes: z.record(z.unknown()),
  }),
});

export const AddPortPatchSchema = z.object({
  type: z.literal('add_port'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    nodeId: z.string().uuid(),
    port: PortSchema,
  }),
});

export const UpdatePortPatchSchema = z.object({
  type: z.literal('update_port'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    nodeId: z.string().uuid(),
    portId: z.string().uuid(),
    changes: PortSchema.partial().omit({ id: true }),
  }),
});

export const DeletePortPatchSchema = z.object({
  type: z.literal('delete_port'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    nodeId: z.string().uuid(),
    portId: z.string().uuid(),
  }),
});

export const ConnectPortsPatchSchema = z.object({
  type: z.literal('connect_ports'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    sourceNodeId: z.string().uuid(),
    sourcePortId: z.string().uuid(),
    targetNodeId: z.string().uuid(),
    targetPortId: z.string().uuid(),
    edgeId: z.string().uuid(),
    contractId: z.string().uuid(),
    contract: ContractSchema.optional(),
    label: z.string().optional(),
  }),
});

export const CreateNodeFromTemplatePatchSchema = z.object({
  type: z.literal('create_node_from_template'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    templateId: z.string().min(1),
    nodeId: z.string().uuid(),
    node: NodeSchema,
    contracts: z.array(ContractSchema),
    artifacts: z.array(ArtifactSchema).optional(),
  }),
});

export const InstantiateContractStubPatchSchema = z.object({
  type: z.literal('instantiate_contract_stub'),
  metadata: PatchMetadataSchema,
  payload: ContractSchema,
});

export const AttachArtifactStubPatchSchema = z.object({
  type: z.literal('attach_artifact_stub'),
  metadata: PatchMetadataSchema,
  payload: ArtifactSchema,
});

export const MarkEntityCompletePatchSchema = z.object({
  type: z.literal('mark_entity_complete'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    entityType: z.enum(['node', 'port', 'contract', 'artifact']),
    entityId: z.string().uuid(),
    nodeId: z.string().uuid().optional(),
  }),
});

export const AddNodeGroupPatchSchema = z.object({
  type: z.literal('add_node_group'),
  metadata: PatchMetadataSchema,
  payload: NodeGroupSchema,
});

export const UpdateNodeGroupPatchSchema = z.object({
  type: z.literal('update_node_group'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
    changes: NodeGroupSchema.partial().omit({ id: true }),
  }),
});

export const RemoveNodeGroupPatchSchema = z.object({
  type: z.literal('remove_node_group'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
  }),
});

export const SetEdgeDirectionPatchSchema = z.object({
  type: z.literal('set_edge_direction'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
    direction: EdgeDirectionSchema,
  }),
});

export const SetEdgeCriticalityPatchSchema = z.object({
  type: z.literal('set_edge_criticality'),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid(),
    criticality: EdgeCriticalitySchema,
  }),
});

export const PatchOperationSchema = z.discriminatedUnion('type', [
  AddNodePatchSchema,
  UpdateNodePatchSchema,
  RemoveNodePatchSchema,
  DeleteNodePatchSchema,
  AddEdgePatchSchema,
  UpdateEdgePatchSchema,
  RemoveEdgePatchSchema,
  DeleteEdgePatchSchema,
  AddContractPatchSchema,
  UpdateContractPatchSchema,
  RemoveContractPatchSchema,
  DeleteContractPatchSchema,
  AddArtifactPatchSchema,
  UpdateArtifactPatchSchema,
  RemoveArtifactPatchSchema,
  DeleteArtifactPatchSchema,
  UpdateGraphMetadataPatchSchema,
  AddPortPatchSchema,
  UpdatePortPatchSchema,
  DeletePortPatchSchema,
  ConnectPortsPatchSchema,
  CreateNodeFromTemplatePatchSchema,
  InstantiateContractStubPatchSchema,
  AttachArtifactStubPatchSchema,
  MarkEntityCompletePatchSchema,
  AddNodeGroupPatchSchema,
  UpdateNodeGroupPatchSchema,
  RemoveNodeGroupPatchSchema,
  SetEdgeDirectionPatchSchema,
  SetEdgeCriticalityPatchSchema,
]);

export const BranchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  baseSnapshotId: z.string().uuid().nullable(),
  patches: z.array(PatchOperationSchema),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

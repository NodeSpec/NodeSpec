import { z } from 'zod';
import {
  ContractKindSchema,
  InteractionKindSchema,
  TransportKindSchema,
  SpecFormatSchema,
  ActorTypeSchema,
  ContractSchema,
  ArtifactKindSchema,
  ArtifactSchema,
  PlacementKindSchema,
  NodeSchema,
  EdgeSchema,
  NodeGroupSchema,
  GraphSchema,
  PreconditionSchema,
  PatchMetadataSchema,
  PatchOperationSchema,
  BranchSchema,
  PortDirectionSchema,
  PortSchema,
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
  EntityStatusSchema,
  CreateNodeFromTemplatePatchSchema,
  InstantiateContractStubPatchSchema,
  AttachArtifactStubPatchSchema,
  MarkEntityCompletePatchSchema,
  AddNodeGroupPatchSchema,
  UpdateNodeGroupPatchSchema,
  RemoveNodeGroupPatchSchema,
} from './schemas.js';

export type EntityStatus = z.infer<typeof EntityStatusSchema>;
export type ContractKind = z.infer<typeof ContractKindSchema>;
export type InteractionKind = z.infer<typeof InteractionKindSchema>;
export type TransportKind = z.infer<typeof TransportKindSchema>;
export type SpecFormat = z.infer<typeof SpecFormatSchema>;
export type PlacementKind = z.infer<typeof PlacementKindSchema>;
export type ActorType = z.infer<typeof ActorTypeSchema>;
export type Contract = z.infer<typeof ContractSchema>;
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type PortDirection = z.infer<typeof PortDirectionSchema>;
export type Port = z.infer<typeof PortSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type NodeGroup = z.infer<typeof NodeGroupSchema>;
export type Graph = z.infer<typeof GraphSchema>;
export type Precondition = z.infer<typeof PreconditionSchema>;
export type PatchMetadata = z.infer<typeof PatchMetadataSchema>;
export type PatchOperation = z.infer<typeof PatchOperationSchema>;
export type Branch = z.infer<typeof BranchSchema>;

export type AddNodePatch = z.infer<typeof AddNodePatchSchema>;
export type UpdateNodePatch = z.infer<typeof UpdateNodePatchSchema>;
export type RemoveNodePatch = z.infer<typeof RemoveNodePatchSchema>;
export type DeleteNodePatch = z.infer<typeof DeleteNodePatchSchema>;
export type AddEdgePatch = z.infer<typeof AddEdgePatchSchema>;
export type UpdateEdgePatch = z.infer<typeof UpdateEdgePatchSchema>;
export type RemoveEdgePatch = z.infer<typeof RemoveEdgePatchSchema>;
export type DeleteEdgePatch = z.infer<typeof DeleteEdgePatchSchema>;
export type AddContractPatch = z.infer<typeof AddContractPatchSchema>;
export type UpdateContractPatch = z.infer<typeof UpdateContractPatchSchema>;
export type RemoveContractPatch = z.infer<typeof RemoveContractPatchSchema>;
export type DeleteContractPatch = z.infer<typeof DeleteContractPatchSchema>;
export type AddArtifactPatch = z.infer<typeof AddArtifactPatchSchema>;
export type UpdateArtifactPatch = z.infer<typeof UpdateArtifactPatchSchema>;
export type RemoveArtifactPatch = z.infer<typeof RemoveArtifactPatchSchema>;
export type DeleteArtifactPatch = z.infer<typeof DeleteArtifactPatchSchema>;
export type UpdateGraphMetadataPatch = z.infer<typeof UpdateGraphMetadataPatchSchema>;
export type AddPortPatch = z.infer<typeof AddPortPatchSchema>;
export type UpdatePortPatch = z.infer<typeof UpdatePortPatchSchema>;
export type DeletePortPatch = z.infer<typeof DeletePortPatchSchema>;
export type ConnectPortsPatch = z.infer<typeof ConnectPortsPatchSchema>;
export type CreateNodeFromTemplatePatch = z.infer<typeof CreateNodeFromTemplatePatchSchema>;
export type InstantiateContractStubPatch = z.infer<typeof InstantiateContractStubPatchSchema>;
export type AttachArtifactStubPatch = z.infer<typeof AttachArtifactStubPatchSchema>;
export type MarkEntityCompletePatch = z.infer<typeof MarkEntityCompletePatchSchema>;
export type AddNodeGroupPatch = z.infer<typeof AddNodeGroupPatchSchema>;
export type UpdateNodeGroupPatch = z.infer<typeof UpdateNodeGroupPatchSchema>;
export type RemoveNodeGroupPatch = z.infer<typeof RemoveNodeGroupPatchSchema>;

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}

export interface ValidationWarning {
  code: string;
  message: string;
  path?: string;
}

export interface PatchResult {
  success: boolean;
  graph?: Graph;
  error?: ValidationError;
  warnings?: ValidationWarning[];
}

export interface BranchDiff {
  added: PatchOperation[];
  removed: PatchOperation[];
  common: PatchOperation[];
}

export interface GraphSnapshot {
  id: string;
  graph: Graph;
  createdAt: string;
}

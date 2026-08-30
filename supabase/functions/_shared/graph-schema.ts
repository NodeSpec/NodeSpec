import { z } from "npm:zod@3.22.4";
import {
  EntityStatusSchema,
  ContractKindSchema,
  InteractionKindSchema,
  TransportKindSchema,
  SpecFormatSchema,
  PlacementKindSchema,
  ArtifactKindSchema,
  EdgeDirectionSchema,
  EdgeCriticalitySchema,
  GraphOriginSchema,
} from "./enums.ts";

const PortDirectionExtendedSchema = z.enum(['in', 'out', 'bidirectional']);

const PortSchema = z.object({
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

const ContractSchema = z.object({
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

const ArtifactSchema = z.object({
  id: z.string().uuid(),
  nodeId: z.string().uuid().or(z.literal("")),
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

const NodeSchema = z.object({
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

const EdgeSchema = z.object({
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

const NodeGroupSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  nodeIds: z.array(z.string().uuid()),
  position: z
    .object({ x: z.number(), y: z.number() })
    .optional(),
  style: z
    .object({
      backgroundColor: z.string().optional(),
      borderColor: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const GraphDataSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  hash: z.string(),
  nodes: z.record(z.string(), NodeSchema),
  edges: z.record(z.string(), EdgeSchema),
  contracts: z.record(z.string(), ContractSchema),
  artifacts: z.record(z.string(), ArtifactSchema),
  nodeGroups: z.record(z.string(), NodeGroupSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
  origin: GraphOriginSchema.optional(),
  sourceContext: z.record(z.unknown()).optional(),
});

export type GraphData = z.infer<typeof GraphDataSchema>;

export const GraphDataTopLevelSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  hash: z.string(),
  nodes: z.record(z.unknown()),
  edges: z.record(z.unknown()),
  contracts: z.record(z.unknown()),
  artifacts: z.record(z.unknown()),
});

export function validateGraphData(data: unknown): { valid: boolean; errors?: string[] } {
  const result = GraphDataSchema.safeParse(data);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`
    ),
  };
}

export function validateGraphDataTopLevel(data: unknown): { valid: boolean; errors?: string[] } {
  const result = GraphDataTopLevelSchema.safeParse(data);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`
    ),
  };
}

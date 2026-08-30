import { z } from 'zod';

// ─── Canonical enum tuples ───────────────────────────────────────────────────
// These are the single source of truth for ontology enums used across both
// client (src/domain/schemas.ts) and server (supabase/functions/_shared/enums.ts).
// Any change here must be mirrored in supabase/functions/_shared/enums.ts.

export const ENTITY_STATUS_VALUES = ['suggested', 'draft', 'complete'] as const;

export const CONTRACT_KIND_VALUES = [
  'rest',
  'graphql',
  'grpc',
  'websocket',
  'sse',
  'kafka',
  'amqp',
  'sql',
  'nosql',
  'ipc',
  'dependency',
  'custom',
] as const;

export const INTERACTION_KIND_VALUES = [
  'request_response',
  'event',
  'queue',
  'data_read',
  'data_write',
  'data_sync',
  'file_transfer',
  'auth',
  'telemetry',
  'ipc',
  'dependency',
] as const;

export const TRANSPORT_KIND_VALUES = [
  'http',
  'graphql',
  'grpc',
  'websocket',
  'sse',
  'amqp',
  'mqtt',
  'kafka',
  'nats',
  'sqs',
  'eventbridge',
  'sql',
  'redis',
  'ipc',
  'tcp',
  'udp',
  'i2c',
  'spi',
  'uart',
  'can',
  'dds',
  'mavlink',
  'none',
] as const;

export const SPEC_FORMAT_VALUES = [
  'openapi',
  'graphql_schema',
  'protobuf',
  'asyncapi',
  'json_schema',
  'sql_ddl',
  'avro',
  'oauth_oidc',
  'telemetry_schema',
  'terraform_hcl',
  'helm_chart',
  'dockerfile',
  'object_storage_contract',
  'hardware_protocol_contract',
  'custom',
  'none',
] as const;

export const PLACEMENT_KIND_VALUES = ['contains', 'hosts', 'deployed_to', 'scopes'] as const;

export const PORT_DIRECTION_VALUES = ['in', 'out'] as const;

export const ARTIFACT_KIND_VALUES = ['source', 'schema', 'doc', 'config', 'build', 'design', 'task', 'test-plan'] as const;

export const ACTOR_TYPE_VALUES = ['human', 'ai', 'system'] as const;

// ─── Edge enums ─────────────────────────────────────────────────────────────

export const EDGE_DIRECTION_VALUES = ['unidirectional', 'bidirectional'] as const;

export const EDGE_CRITICALITY_VALUES = ['required', 'optional', 'fallback'] as const;

// ─── Graph-level enums ──────────────────────────────────────────────────────

export const GRAPH_ORIGIN_VALUES = ['spec_authored', 'reverse_engineered', 'hybrid'] as const;

// ─── Zod schemas derived from tuples ─────────────────────────────────────────

export const EntityStatusSchema = z.enum(ENTITY_STATUS_VALUES);
export const ContractKindSchema = z.enum(CONTRACT_KIND_VALUES);
export const InteractionKindSchema = z.enum(INTERACTION_KIND_VALUES);
export const TransportKindSchema = z.enum(TRANSPORT_KIND_VALUES);
export const SpecFormatSchema = z.enum(SPEC_FORMAT_VALUES);
export const PlacementKindSchema = z.enum(PLACEMENT_KIND_VALUES);
export const PortDirectionSchema = z.enum(PORT_DIRECTION_VALUES);
export const ArtifactKindSchema = z.enum(ARTIFACT_KIND_VALUES);
export const ActorTypeSchema = z.enum(ACTOR_TYPE_VALUES);

export const EdgeDirectionSchema = z.enum(EDGE_DIRECTION_VALUES);
export const EdgeCriticalitySchema = z.enum(EDGE_CRITICALITY_VALUES);
export const GraphOriginSchema = z.enum(GRAPH_ORIGIN_VALUES);

// ─── TypeScript types derived from schemas ───────────────────────────────────

export type EntityStatus = z.infer<typeof EntityStatusSchema>;
export type ContractKind = z.infer<typeof ContractKindSchema>;
export type InteractionKind = z.infer<typeof InteractionKindSchema>;
export type TransportKind = z.infer<typeof TransportKindSchema>;
export type SpecFormat = z.infer<typeof SpecFormatSchema>;
export type PlacementKind = z.infer<typeof PlacementKindSchema>;
export type PortDirection = z.infer<typeof PortDirectionSchema>;
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ActorType = z.infer<typeof ActorTypeSchema>;

export type EdgeDirection = z.infer<typeof EdgeDirectionSchema>;
export type EdgeCriticality = z.infer<typeof EdgeCriticalitySchema>;
export type GraphOrigin = z.infer<typeof GraphOriginSchema>;

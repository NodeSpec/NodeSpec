import type { ContractKind, InteractionKind, TransportKind, SpecFormat } from './enums.js';

export interface ContractFieldDefaults {
  interactionKind: InteractionKind;
  transport: TransportKind;
  specFormat: SpecFormat;
}

export const KIND_TO_INTERACTION_FIELDS: Record<ContractKind, ContractFieldDefaults> = {
  rest: { interactionKind: 'request_response', transport: 'http', specFormat: 'openapi' },
  graphql: { interactionKind: 'request_response', transport: 'graphql', specFormat: 'graphql_schema' },
  grpc: { interactionKind: 'request_response', transport: 'grpc', specFormat: 'protobuf' },
  websocket: { interactionKind: 'event', transport: 'websocket', specFormat: 'json_schema' },
  sse: { interactionKind: 'event', transport: 'sse', specFormat: 'json_schema' },
  kafka: { interactionKind: 'event', transport: 'kafka', specFormat: 'asyncapi' },
  amqp: { interactionKind: 'queue', transport: 'amqp', specFormat: 'asyncapi' },
  sql: { interactionKind: 'data_read', transport: 'sql', specFormat: 'sql_ddl' },
  nosql: { interactionKind: 'data_read', transport: 'http', specFormat: 'json_schema' },
  ipc: { interactionKind: 'ipc', transport: 'ipc', specFormat: 'none' },
  dependency: { interactionKind: 'dependency', transport: 'none', specFormat: 'none' },
  custom: { interactionKind: 'request_response', transport: 'http', specFormat: 'none' },
};

export const INTERACTION_KIND_DEFAULTS: Record<InteractionKind, { transport: TransportKind; specFormat: SpecFormat }> = {
  request_response: { transport: 'http', specFormat: 'openapi' },
  event: { transport: 'kafka', specFormat: 'asyncapi' },
  queue: { transport: 'amqp', specFormat: 'asyncapi' },
  data_read: { transport: 'sql', specFormat: 'sql_ddl' },
  data_write: { transport: 'sql', specFormat: 'sql_ddl' },
  data_sync: { transport: 'http', specFormat: 'json_schema' },
  // N8.6(C-fix): auth/telemetry amended to the richer spec formats the resolution
  // module always intended (oauth_oidc, telemetry_schema) — this table is now the
  // ONLY per-interaction default source; the private copies are dead.
  file_transfer: { transport: 'http', specFormat: 'none' },
  auth: { transport: 'http', specFormat: 'oauth_oidc' },
  telemetry: { transport: 'http', specFormat: 'telemetry_schema' },
  ipc: { transport: 'ipc', specFormat: 'none' },
  dependency: { transport: 'none', specFormat: 'none' },
};

/**
 * M6: THE interaction+transport -> contract kind table. One definition, both runtimes.
 *
 * There were two, and they disagreed. The client's was transport-BLIND
 * (`interaction-resolution.ts`: request_response -> rest, always) and the server's was
 * transport-AWARE (`tool-executor.ts`), so the same edge became a different contract kind
 * depending on which path created it. The user-visible cost: a HAND-DRAWN edge could never
 * become graphql / grpc / websocket / sse / nosql — only 5 of 12 contract kinds were
 * reachable by drawing — while an AI-created one could reach all 12.
 *
 * Unified onto the transport-aware behavior, which is the strictly more informed of the two.
 * On the DEFAULT transport for every one of the 11 interaction kinds
 * (INTERACTION_KIND_DEFAULTS above) this returns exactly what the blind table returned, so
 * unification changes no existing result — it only lets a caller that KNOWS the transport
 * reach the other 7 kinds.
 */
export function contractKindForInteraction(
  interactionKind: string,
  transport?: string | null,
): ContractKind {
  switch (interactionKind) {
    case 'request_response':
      if (transport === 'graphql') return 'graphql';
      if (transport === 'grpc') return 'grpc';
      return 'rest';
    case 'event':
      if (transport === 'websocket') return 'websocket';
      if (transport === 'sse') return 'sse';
      return 'kafka';
    case 'queue':
      return 'amqp';
    case 'data_read':
      // http means a document/key-value API rather than a wire-level SQL connection.
      // Asymmetric with data_write on purpose: `nosql`'s own defaults are data_read/http,
      // so a data_write over http has no honest nosql shape to land in.
      if (transport === 'http') return 'nosql';
      return 'sql';
    case 'data_write':
      return 'sql';
    case 'auth':
      return 'rest';
    case 'ipc':
      return 'ipc';
    case 'dependency':
      return 'dependency';
    // data_sync, file_transfer, telemetry have no dedicated kind — `custom` is honest.
    default:
      return 'custom';
  }
}

export type LegacyInteractionKind =
  | 'request_response'
  | 'realtime_channel'
  | 'event_publish'
  | 'event_subscribe'
  | 'message_enqueue'
  | 'message_consume'
  | 'data_access'
  | 'data_read'
  | 'data_write'
  | 'data_sync'
  | 'file_transfer'
  | 'auth_flow'
  | 'authorization_check'
  | 'observability_signal'
  | 'hardware_io'
  | 'ipc'
  | 'dependency';

/**
 * Retired interaction kinds -> current vocabulary.
 *
 * M4: this was scheduled for deletion once `suggested_contracts` was re-seeded (which it
 * now is). It STAYS, because the DB seeds were never its only source: `graph_patches` are
 * append-only and HASH-CHAINED, so they are never rewritten — a replayed patch can still
 * carry `event_publish` or `realtime_channel`, and the read boundary is the only place
 * that can resolve it. Reclassified rather than removed: this is read-boundary tolerance
 * (the same category as LEGACY_ALIAS_MAP), not graph backward-compatibility.
 */
export const LEGACY_INTERACTION_KIND_MAP: Record<LegacyInteractionKind, InteractionKind> = {
  request_response: 'request_response',
  realtime_channel: 'event',
  event_publish: 'event',
  event_subscribe: 'event',
  message_enqueue: 'queue',
  message_consume: 'queue',
  data_access: 'data_read',
  data_read: 'data_read',
  data_write: 'data_write',
  data_sync: 'data_sync',
  file_transfer: 'file_transfer',
  auth_flow: 'auth',
  authorization_check: 'auth',
  observability_signal: 'telemetry',
  hardware_io: 'ipc',
  ipc: 'ipc',
  dependency: 'dependency',
};

export function compressInteractionKind(legacy: string): InteractionKind {
  return LEGACY_INTERACTION_KIND_MAP[legacy as LegacyInteractionKind] ?? 'request_response';
}

export type LegacyContractKind =
  | 'rest'
  | 'graphql'
  | 'grpc'
  | 'websocket'
  | 'sse'
  | 'kafka'
  | 'amqp'
  | 'sql'
  | 'nosql'
  | 'ipc'
  | 'custom'
  | 'event_stream'
  | 'data_flow'
  | 'message_queue'
  | 'cache'
  | 'event'
  | 'oauth';

export const LEGACY_CONTRACT_KIND_MAP: Record<LegacyContractKind, { kind: ContractKind; interactionKind: InteractionKind; specFormat?: SpecFormat }> = {
  rest: { kind: 'rest', interactionKind: 'request_response' },
  graphql: { kind: 'graphql', interactionKind: 'request_response' },
  grpc: { kind: 'grpc', interactionKind: 'request_response' },
  websocket: { kind: 'websocket', interactionKind: 'event' },
  sse: { kind: 'sse', interactionKind: 'event' },
  kafka: { kind: 'kafka', interactionKind: 'event' },
  amqp: { kind: 'amqp', interactionKind: 'queue' },
  sql: { kind: 'sql', interactionKind: 'data_read' },
  nosql: { kind: 'nosql', interactionKind: 'data_read' },
  ipc: { kind: 'ipc', interactionKind: 'ipc' },
  custom: { kind: 'custom', interactionKind: 'request_response' },
  event_stream: { kind: 'kafka', interactionKind: 'event' },
  data_flow: { kind: 'sql', interactionKind: 'data_read' },
  message_queue: { kind: 'amqp', interactionKind: 'queue' },
  cache: { kind: 'custom', interactionKind: 'data_read' },
  event: { kind: 'custom', interactionKind: 'event' },
  oauth: { kind: 'rest', interactionKind: 'auth', specFormat: 'oauth_oidc' },
};

export function compressContractKind(legacy: string): ContractKind {
  const mapped = LEGACY_CONTRACT_KIND_MAP[legacy as LegacyContractKind];
  return mapped?.kind ?? 'custom';
}

export const LEGACY_ALIAS_MAP: Record<string, ContractKind> = {
  http: 'rest',
  api: 'rest',
  'rest-api': 'rest',
  restapi: 'rest',
  gql: 'graphql',
  graphql_api: 'graphql',
  ws: 'websocket',
  socket: 'websocket',
  events: 'kafka',
  stream: 'kafka',
  database: 'sql',
  db: 'sql',
  data: 'sql',
  dataflow: 'custom',
  queue: 'amqp',
  mq: 'amqp',
  rabbit: 'amqp',
  rabbitmq: 'amqp',
  rpc: 'grpc',
  messaging: 'amqp',
  pubsub: 'kafka',
  authentication: 'rest',
  file_storage: 'custom',
  storage: 'custom',
  realtime: 'websocket',
};

export function inferContractFieldsFromKind(kind: string): ContractFieldDefaults {
  const mapped = LEGACY_CONTRACT_KIND_MAP[kind as LegacyContractKind];
  if (mapped) {
    return KIND_TO_INTERACTION_FIELDS[mapped.kind];
  }
  return KIND_TO_INTERACTION_FIELDS[kind as ContractKind] ?? { interactionKind: 'data_read', transport: 'http', specFormat: 'none' };
}

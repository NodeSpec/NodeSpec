import { InteractionKindSchema, ContractKindSchema } from './schemas.js';
import type { ContractKind, InteractionKind, TransportKind, SpecFormat } from './types.js';
import {
  KIND_TO_INTERACTION_FIELDS,
  INTERACTION_KIND_DEFAULTS,
  LEGACY_ALIAS_MAP,
  LEGACY_INTERACTION_KIND_MAP,
  contractKindForInteraction,
  type LegacyInteractionKind,
} from './shared/legacy-mappings.js';

// N8.6(A): this module previously carried its OWN alias table that disagreed with
// shared/legacy-mappings (dataflow, rest-api, db, mq, rpc … existed in one and not
// the other), and it could not parse the retired interaction kinds the DB
// `suggested_contracts` seeds still speak (realtime_channel, event_publish,
// data_access …) — every one fell through to {kind:'custom'}. There is now ONE
// vocabulary: the shared legacy-mappings module. This file only maps CURRENT
// interaction kinds to their contract-field defaults.

// M6: the private transport-BLIND copy of this table is gone. It disagreed with the
// server's transport-aware one, so the same edge became a different contract kind depending
// on which path created it — and a hand-drawn edge could reach only 5 of the 12 kinds.
// `contractKindForInteraction` in shared/legacy-mappings is now the single definition.

// N8.6(C-fix, owner bench 2026-07-28): this module carried PRIVATE per-interaction
// transport/spec maps that disagreed with the shared INTERACTION_KIND_DEFAULTS —
// data_read said http/json_schema locally vs sql/sql_ddl shared, so the (A)
// connect-time inference birthed database contracts as "sql over http". The exact
// defect class (A) was built to kill, one layer down. The shared table is now the
// ONLY source (auth/telemetry rows there were amended to the richer oauth_oidc /
// telemetry_schema values this module always intended).

export interface ResolvedContractFields {
  kind: ContractKind;
  interactionKind?: InteractionKind;
  transport?: TransportKind;
  specFormat?: SpecFormat;
}

export function isInteractionKind(value: string): value is InteractionKind {
  return InteractionKindSchema.safeParse(value).success;
}

export function isContractKind(value: string): value is ContractKind {
  return ContractKindSchema.safeParse(value).success;
}

function fieldsForInteraction(
  value: InteractionKind,
  transportOverride?: string | null,
): ResolvedContractFields {
  const defaults = INTERACTION_KIND_DEFAULTS[value];
  // A caller that KNOWS the transport gets the more specific kind (graphql, grpc,
  // websocket, sse, nosql); one that does not gets the same result as before, because the
  // default transport is what the blind table's answer was keyed to.
  const transport = (transportOverride ?? defaults?.transport) as TransportKind | undefined;
  return {
    kind: contractKindForInteraction(value, transport),
    interactionKind: value,
    transport,
    specFormat: defaults?.specFormat as SpecFormat | undefined,
  };
}

function fieldsForKind(kind: ContractKind): ResolvedContractFields {
  const defaults = KIND_TO_INTERACTION_FIELDS[kind];
  return defaults ? { kind, ...defaults } : { kind };
}

export function resolveContractFields(
  value: string,
  /** M6: optional, and optional on purpose — most callers resolve a bare token. When it IS
   *  known (the inspector's transport select, an imported dependency), passing it is what
   *  makes graphql / grpc / websocket / sse / nosql reachable outside the AI path. */
  transport?: string | null,
): ResolvedContractFields {
  // 1. current interaction kind
  if (isInteractionKind(value)) return fieldsForInteraction(value, transport);

  // 2. current contract kind — now returns FULL defaults (previously kind-only,
  //    which left seeded port contracts without interaction/transport/specFormat)
  if (isContractKind(value)) return fieldsForKind(value);

  // 3. RETIRED interaction kinds (the DB suggested_contracts seeds: realtime_channel,
  //    event_publish, message_enqueue, data_access, auth_flow, hardware_io …)
  const modernInteraction = LEGACY_INTERACTION_KIND_MAP[value as LegacyInteractionKind];
  if (modernInteraction) return fieldsForInteraction(modernInteraction, transport);

  // 4. the ONE alias table (shared with every other legacy reader)
  const aliased = LEGACY_ALIAS_MAP[value];
  if (aliased) return fieldsForKind(aliased);

  return fieldsForKind('custom');
}

export function resolveToContractKind(value: string): ContractKind {
  return resolveContractFields(value).kind;
}

// ── N8.6(A): connect-time contract inference ─────────────────────────────────────────
// Every hand-drawn edge used to be born `kind:'sql'` (hardcoded in the connect
// adapter). The TARGET node's role decides what calling it MEANS; the functional
// kind maps to an interaction token and the standard resolution does the rest.
// Fallback is rest/request_response — the honest generic for service-to-service —
// never sql. Silent by design (no picker; the N8.5 direction): the inspector's
// Connection Type select is the rebind surface.
// M1b: keyed on the target role's `interface_kind` — the axis that exists precisely to
// answer "what does an edge INTO this node mean". Every value here changes the born
// contract; `service` is the honest generic and falls through to the fallback below.
const INTERFACE_KIND_TO_INTERACTION: Record<string, InteractionKind> = {
  data: 'data_read',
  object_store: 'file_transfer',
  queue: 'queue',
  event_bus: 'event',
  auth: 'auth',
  telemetry: 'telemetry',
};

export function inferConnectContract(
  targetRole: { interfaceKind?: string | null } | null | undefined,
): ResolvedContractFields {
  const ik = targetRole?.interfaceKind ?? null;
  if (ik && INTERFACE_KIND_TO_INTERACTION[ik]) {
    return fieldsForInteraction(INTERFACE_KIND_TO_INTERACTION[ik]);
  }
  return fieldsForInteraction('request_response');
}

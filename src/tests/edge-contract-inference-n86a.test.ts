// N8.6(A): edge correctness pins.
// (1) resolveContractFields speaks ONE vocabulary — the shared legacy-mappings
//     module — and parses the retired interaction kinds the DB suggested_contracts
//     seeds still carry (realtime_channel, event_publish, data_access …) instead of
//     collapsing them all to {kind:'custom'}.
// (2) kind-only resolution returns FULL field defaults, not a bare kind.
// (3) inferConnectContract: a hand-drawn edge's contract comes from the TARGET
//     role's functional kind — never the old hardcoded 'sql'.
// (4) the connect adapter emits the inferred contract end-to-end.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveContractFields,
  inferConnectContract,
} from '@nodespec/core/interaction-resolution.js';
import { setRoleResolver, type RoleInfo } from '@nodespec/core/container-types.js';
import { mapConnectionToPatches } from '../ui/adapters/interaction-to-patch.js';
import type { Graph } from '@nodespec/core/types.js';

describe('resolveContractFields — one vocabulary (N8.6A)', () => {
  it('parses retired interaction kinds from suggested_contracts seeds', () => {
    expect(resolveContractFields('realtime_channel')).toMatchObject({ kind: 'kafka', interactionKind: 'event' });
    expect(resolveContractFields('event_publish')).toMatchObject({ kind: 'kafka', interactionKind: 'event' });
    expect(resolveContractFields('message_enqueue')).toMatchObject({ kind: 'amqp', interactionKind: 'queue' });
    expect(resolveContractFields('data_access')).toMatchObject({ kind: 'sql', interactionKind: 'data_read' });
    expect(resolveContractFields('auth_flow')).toMatchObject({ kind: 'rest', interactionKind: 'auth' });
    expect(resolveContractFields('observability_signal')).toMatchObject({ kind: 'custom', interactionKind: 'telemetry' });
    expect(resolveContractFields('hardware_io')).toMatchObject({ kind: 'ipc', interactionKind: 'ipc' });
  });

  it('resolves shared aliases (the private disagreeing table is gone)', () => {
    expect(resolveContractFields('db').kind).toBe('sql');
    expect(resolveContractFields('rpc').kind).toBe('grpc');
    expect(resolveContractFields('dataflow').kind).toBe('custom');
    expect(resolveContractFields('realtime').kind).toBe('websocket');
  });

  it('kind-only input returns FULL field defaults', () => {
    expect(resolveContractFields('rest')).toEqual({
      kind: 'rest', interactionKind: 'request_response', transport: 'http', specFormat: 'openapi',
    });
    expect(resolveContractFields('websocket')).toEqual({
      kind: 'websocket', interactionKind: 'event', transport: 'websocket', specFormat: 'json_schema',
    });
  });

  it('unknown tokens fall to custom with full defaults', () => {
    expect(resolveContractFields('no-such-token')).toEqual({
      kind: 'custom', interactionKind: 'request_response', transport: 'http', specFormat: 'none',
    });
  });
});

describe('inferConnectContract — the target role decides (N8.6A)', () => {
  const role = (interfaceKind: string | null): RoleInfo => ({
    id: 'x', nature: 'build', interfaceKind, provider: null,
  });

  it('data_store target → sql/data_read over SQL transport (owner bench caught "sql over http")', () => {
    // N8.6(C-fix): the private per-interaction maps disagreed with the shared
    // INTERACTION_KIND_DEFAULTS (data_read: http/json_schema vs sql/sql_ddl) —
    // pinned exactly so the vocabulary cannot fork again.
    expect(inferConnectContract(role('data'))).toEqual({
      kind: 'sql', interactionKind: 'data_read', transport: 'sql', specFormat: 'sql_ddl',
    });
  });

  it('messaging → amqp/queue, event_bus → kafka/event', () => {
    expect(inferConnectContract(role('queue'))).toMatchObject({ kind: 'amqp', interactionKind: 'queue' });
    expect(inferConnectContract(role('event_bus'))).toMatchObject({ kind: 'kafka', interactionKind: 'event' });
  });

  it('auth → rest/auth (oauth_oidc), observability → telemetry (telemetry_schema), object_storage → file_transfer', () => {
    expect(inferConnectContract(role('auth'))).toMatchObject({ kind: 'rest', interactionKind: 'auth', specFormat: 'oauth_oidc' });
    expect(inferConnectContract(role('telemetry'))).toMatchObject({ interactionKind: 'telemetry', specFormat: 'telemetry_schema' });
    expect(inferConnectContract(role('object_store'))).toMatchObject({ interactionKind: 'file_transfer' });
  });

  it('service targets and unknown roles fall back to rest/request_response — never sql', () => {
    expect(inferConnectContract(role(null))).toMatchObject({ kind: 'rest', interactionKind: 'request_response' });
    expect(inferConnectContract(null)).toMatchObject({ kind: 'rest', interactionKind: 'request_response' });
  });
});

describe('connect adapter — the sql birth defect is dead (N8.6A)', () => {
  const SRC = '11111111-1111-4111-8111-111111111111';
  const TGT = '22222222-2222-4222-8222-222222222222';

  const ROLES: Record<string, RoleInfo> = {
    'backend-service': { id: 'backend-service', nature: 'build', interfaceKind: 'service', provider: null },
    'relational-db': { id: 'relational-db', nature: 'build', interfaceKind: 'data', provider: null },
  };

  beforeEach(() => setRoleResolver((id) => ROLES[id] ?? null));
  afterEach(() => setRoleResolver(null));

  const graphWith = (targetType: string): Graph => ({
    id: 'g', name: 'g', version: 1,
    nodes: {
      [SRC]: { id: SRC, type: 'backend-service', label: 'Api', metadata: {}, ports: [] },
      [TGT]: { id: TGT, type: targetType, label: 'Target', metadata: {}, ports: [] },
    },
    edges: {}, contracts: {}, artifacts: {},
  } as unknown as Graph);

  it('React→API edge is born rest/request_response, not sql', () => {
    const result = mapConnectionToPatches(
      { source: SRC, target: TGT, sourceHandle: null, targetHandle: null },
      graphWith('backend-service'),
      { actorType: 'human' },
    );
    expect(result.blocked).toBe(false);
    const contractPatch = result.patches.find((p) => p.type === 'add_contract');
    expect(contractPatch).toBeDefined();
    const payload = (contractPatch as { payload: Record<string, unknown> }).payload;
    expect(payload.kind).toBe('rest');
    expect(payload.interactionKind).toBe('request_response');
    expect(payload.transport).toBe('http');
    expect(payload.specFormat).toBe('openapi');
  });

  it('edge INTO a database is born sql/data_read', () => {
    const result = mapConnectionToPatches(
      { source: SRC, target: TGT, sourceHandle: null, targetHandle: null },
      graphWith('relational-db'),
      { actorType: 'human' },
    );
    const contractPatch = result.patches.find((p) => p.type === 'add_contract');
    const payload = (contractPatch as { payload: Record<string, unknown> }).payload;
    expect(payload.kind).toBe('sql');
    expect(payload.interactionKind).toBe('data_read');
  });

  it('no resolver registered (pre-hydration) → generic rest fallback, never sql', () => {
    setRoleResolver(null);
    const result = mapConnectionToPatches(
      { source: SRC, target: TGT, sourceHandle: null, targetHandle: null },
      graphWith('relational-db'),
      { actorType: 'human' },
    );
    const contractPatch = result.patches.find((p) => p.type === 'add_contract');
    const payload = (contractPatch as { payload: Record<string, unknown> }).payload;
    expect(payload.kind).toBe('rest');
  });
});

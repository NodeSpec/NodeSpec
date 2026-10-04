// S1-3 chunk 1: regression tests for the `keys` tool bucket, extracted verbatim from
// mcp-server/index.ts into mcp-server/tools/keys.ts. Exercises the real handlers against
// a FakeSupabase — proving the extraction preserved behavior. (Logic preservation only;
// the module-graph-boots check happens on the live edge runtime, per the S1-2 lesson.)
import {
  handleCreateApiKey,
  handleListApiKeys,
  handleRevokeApiKey,
} from '../mcp-server/tools/keys.ts';
import { sha256Hex, type AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';
import { createRepos } from '../mcp-server/supabase-adapter.ts';

// S1-4 c1: handlers now consume the repository seam. Tests exercise the REAL adapter over
// the FakeSupabase — the adapter issues the exact queries the handlers used to run inline,
// so all scripted responses and callsTo assertions below are unchanged.
const repos = (sb: FakeSupabase) => createRepos(sb as never);

const JWT_AUTH: AuthResult = { userId: 'user-1', scopes: ['read', 'write', 'propose'], authMethod: 'jwt' };
const KEY_AUTH: AuthResult = { userId: 'user-1', scopes: ['read'], authMethod: 'api_key' };

// ── create_api_key ───────────────────────────────────────────────────────────────────

Deno.test('create_api_key: non-JWT auth is rejected', async () => {
  const sb = new FakeSupabase();
  const r = await handleCreateApiKey(repos(sb), KEY_AUTH, { name: 'k' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('JWT authentication'), 'error names the JWT requirement');
  assertEquals(sb.calls.length, 0, 'no DB call on rejected auth');
});

Deno.test('create_api_key: name is required', async () => {
  const sb = new FakeSupabase();
  const r = await handleCreateApiKey(repos(sb), JWT_AUTH, { name: '' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('name is required'), 'error names the missing field');
});

Deno.test('create_api_key: free tier defaults to ALL scopes (2026-08-10 all-features ruling); key is hashed, plaintext returned once', async () => {
  const sb = new FakeSupabase();
  // getUserTier → no subscription row → free tier.
  sb.script('stripe_subscriptions', 'select', { data: null, error: null });
  sb.script('mcp_api_keys', 'insert', {
    data: {
      id: 'key-1', name: 'ci', key_prefix: 'ns_live_00000000',
      scopes: ['read', 'write', 'propose'], expires_at: null, created_at: '2026-07-14T00:00:00.000Z',
    },
    error: null,
  });

  const r = await handleCreateApiKey(repos(sb), JWT_AUTH, { name: 'ci' });
  assertEquals(r.success, true);
  const data = r.data as Record<string, unknown>;

  // Plaintext key returned once, correct shape, prefix derived from it.
  const apiKey = data.apiKey as string;
  assert(/^ns_live_[0-9a-f]{48}$/.test(apiKey), `apiKey shape: ${apiKey}`);

  // The inserted row hashes the plaintext (never stores it) and carries all scopes.
  const insert = sb.callsTo('mcp_api_keys', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(insert.key_hash, await sha256Hex(apiKey));
  assertEquals(insert.key_prefix, apiKey.slice(0, 16));
  assertEquals(insert.scopes, ['read', 'write', 'propose']);
  assertEquals(insert.user_id, 'user-1');
  assertEquals(insert.expires_at, null);
});

Deno.test('create_api_key: explicit write scope on free tier is honored (2026-08-10 all-features ruling)', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: null, error: null });
  sb.script('mcp_api_keys', 'insert', {
    data: { id: 'key-f', name: 'k', key_prefix: 'ns_live_y', scopes: ['read', 'write'], expires_at: null, created_at: '2026-07-14T00:00:00.000Z' },
    error: null,
  });
  const r = await handleCreateApiKey(repos(sb), JWT_AUTH, { name: 'k', scopes: ['read', 'write'] });
  assertEquals(r.success, true);
  const insert = sb.callsTo('mcp_api_keys', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(insert.scopes, ['read', 'write']);
});

Deno.test('create_api_key: pro tier honors an explicit write scope', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: { plan_name: 'Pro Monthly', status: 'active' }, error: null });
  sb.script('mcp_api_keys', 'insert', {
    data: { id: 'key-2', name: 'k', key_prefix: 'ns_live_x', scopes: ['read', 'write', 'propose'], expires_at: null, created_at: '2026-07-14T00:00:00.000Z' },
    error: null,
  });
  const r = await handleCreateApiKey(repos(sb), JWT_AUTH, { name: 'k', scopes: ['read', 'write', 'propose'] });
  assertEquals(r.success, true);
  const insert = sb.callsTo('mcp_api_keys', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(insert.scopes, ['read', 'write', 'propose']);
});

Deno.test('create_api_key: expires_in_days sets a future expiry; DB error is surfaced', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: null, error: null });
  sb.script('mcp_api_keys', 'insert', { data: null, error: { message: 'unique violation' } });
  const r = await handleCreateApiKey(repos(sb), JWT_AUTH, { name: 'k', expires_in_days: 30 });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('unique violation'), 'DB error message is surfaced');
  const insert = sb.callsTo('mcp_api_keys', 'insert')[0].payload as Record<string, unknown>;
  assert(insert.expires_at != null, 'expires_at populated when expires_in_days given');
});

// ── list_api_keys ────────────────────────────────────────────────────────────────────

Deno.test('list_api_keys: maps rows and computes isActive', async () => {
  const sb = new FakeSupabase();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  sb.script('mcp_api_keys', 'select', {
    data: [
      { id: 'a', name: 'active', key_prefix: 'p1', scopes: ['read'], last_used_at: null, expires_at: future, revoked_at: null, created_at: 't' },
      { id: 'b', name: 'revoked', key_prefix: 'p2', scopes: ['read'], last_used_at: null, expires_at: null, revoked_at: 't', created_at: 't' },
      { id: 'c', name: 'expired', key_prefix: 'p3', scopes: ['read'], last_used_at: null, expires_at: past, revoked_at: null, created_at: 't' },
    ],
    error: null,
  });
  const r = await handleListApiKeys(repos(sb), JWT_AUTH);
  assertEquals(r.success, true);
  const keys = (r.data as { apiKeys: Array<{ keyId: string; isActive: boolean }> }).apiKeys;
  assertEquals(keys.map((k) => [k.keyId, k.isActive]), [['a', true], ['b', false], ['c', false]]);
});

Deno.test('list_api_keys: non-JWT auth is rejected', async () => {
  const sb = new FakeSupabase();
  const r = await handleListApiKeys(repos(sb), KEY_AUTH);
  assertEquals(r.success, false);
});

// ── revoke_api_key ───────────────────────────────────────────────────────────────────

Deno.test('revoke_api_key: missing key_id is rejected', async () => {
  const sb = new FakeSupabase();
  const r = await handleRevokeApiKey(repos(sb), JWT_AUTH, { key_id: '' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('key_id is required'), 'names the missing field');
});

Deno.test('revoke_api_key: unknown key (no row) reports not-found', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_api_keys', 'update', { data: null, error: null });
  const r = await handleRevokeApiKey(repos(sb), JWT_AUTH, { key_id: 'nope' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('not found'), 'not-found message');
});

Deno.test('revoke_api_key: success returns the revoked row', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_api_keys', 'update', { data: { id: 'k1', name: 'ci', revoked_at: '2026-07-14T00:00:00.000Z' }, error: null });
  const r = await handleRevokeApiKey(repos(sb), JWT_AUTH, { key_id: 'k1' });
  assertEquals(r.success, true);
  assertEquals((r.data as { keyId: string }).keyId, 'k1');
});

// ── 4b.4: a revoked key cannot heartbeat — its leases end now ──────────────────
Deno.test('revoke_api_key: releases the active leases the key held, audited as released, and says so', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_api_keys', 'update', { data: { id: 'k1', name: 'ci runner', revoked_at: '2026-09-14T10:00:00Z' }, error: null });
  sb.script('agent_checkouts', 'update', { data: [{ id: 'lease-1' }, { id: 'lease-2' }], error: null });
  const r = await handleRevokeApiKey(repos(sb), JWT_AUTH, { key_id: 'k1' });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.leasesReleased, 2);
  assert(String(data.message).includes('2 active lease(s) it held were released'));
  // deno-lint-ignore no-explicit-any
  const rel = sb.callsTo('agent_checkouts', 'update')[0].payload as any;
  assertEquals(rel.released_reason, 'released');
  assertEquals(rel.released_at, '2026-09-14T10:00:00Z');
  const filters = JSON.stringify(sb.callsTo('agent_checkouts', 'update')[0].filters);
  assert(filters.includes('holder_key_id') && filters.includes('k1') && filters.includes('released_at'), 'only this key’s ACTIVE leases');
});

Deno.test('revoke_api_key: a failed lease release never fails the revoke (best effort, reports zero)', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_api_keys', 'update', { data: { id: 'k1', name: 'ci runner', revoked_at: 't' }, error: null });
  sb.script('agent_checkouts', 'update', { data: null, error: { message: 'boom' } });
  const r = await handleRevokeApiKey(repos(sb), JWT_AUTH, { key_id: 'k1' });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  assertEquals((r.data as any).leasesReleased, 0);
});

// ── V3 I (owner ruling 2026-09-21): the plan's connection allowance ─────────
// A new key is a new connection. The handler compares agent_connection_count
// (keys and OAuth clients alike, lane 065 proves the SQL) with the tier's
// allowance: community one, indie and above five per person. One live key
// per name; the partial unique index answers 23505 and the handler speaks
// the sentence.

const INDIE = { data: { plan_name: 'Indie Monthly', status: 'active' }, error: null };
const NO_PLAN = { data: null, error: null };
const minted = (name: string) => ({
  data: { id: 'key-n', name, key_prefix: 'ns_live_00000000', scopes: ['read', 'write', 'propose'], expires_at: null, created_at: '2026-09-21T00:00:00.000Z' },
  error: null,
});

Deno.test('create_api_key: community with one connection live is refused with the cap sentence, and nothing is inserted', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', NO_PLAN);
  sb.script('rpc', 'agent_connection_count', { data: 1, error: null });
  const r = await handleCreateApiKey(repos(sb), JWT_AUTH, { name: 'hermes' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Your plan includes one connected agent, and it is in use'), r.error);
  assert((r.error ?? '').includes('upgrade to Indie to connect up to five'), r.error);
  assertEquals(sb.callsTo('mcp_api_keys', 'insert').length, 0, 'refused before the insert');
  const count = sb.callsTo('rpc', 'agent_connection_count')[0].payload as Record<string, unknown>;
  assertEquals(count.p_user_id, 'user-1');
  assertEquals(count.p_except_client_id, null);
});

Deno.test('create_api_key: indie mints the fifth connection and refuses the sixth', async () => {
  const four = new FakeSupabase();
  four.script('stripe_subscriptions', 'select', INDIE);
  four.script('rpc', 'agent_connection_count', { data: 4, error: null });
  four.script('mcp_api_keys', 'insert', minted('fifth'));
  const ok = await handleCreateApiKey(repos(four), JWT_AUTH, { name: 'fifth' });
  assertEquals(ok.success, true, JSON.stringify(ok));

  const five = new FakeSupabase();
  five.script('stripe_subscriptions', 'select', INDIE);
  five.script('rpc', 'agent_connection_count', { data: 5, error: null });
  const r = await handleCreateApiKey(repos(five), JWT_AUTH, { name: 'sixth' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Indie connects up to five agents per person, and yours are all in use'), r.error);
  assertEquals(five.callsTo('mcp_api_keys', 'insert').length, 0);
});

Deno.test('create_api_key: a count the database cannot give refuses rather than minting blind', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', INDIE);
  sb.script('rpc', 'agent_connection_count', { data: null, error: { message: 'function public.agent_connection_count does not exist', code: '42883' } });
  const r = await handleCreateApiKey(repos(sb), JWT_AUTH, { name: 'k' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Could not count your connected agents'), r.error);
  assertEquals(sb.callsTo('mcp_api_keys', 'insert').length, 0);
});

Deno.test('create_api_key: a live name is refused with the sentence, not the constraint text; the name is trimmed', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', INDIE);
  sb.script('rpc', 'agent_connection_count', { data: 2, error: null });
  sb.script('mcp_api_keys', 'insert', { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_mcp_api_keys_active_name"' } });
  const r = await handleCreateApiKey(repos(sb), JWT_AUTH, { name: '  hermes ' });
  assertEquals(r.success, false);
  assertEquals(r.error, 'An agent named "hermes" is already connected. Revoke it under Agents, Connected, or pick another name.');
  const insert = sb.callsTo('mcp_api_keys', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(insert.name, 'hermes');
});

Deno.test('list_api_keys: OAuth-connected clients sit in the same list, one per live family; the allowance rides along', async () => {
  const sb = new FakeSupabase();
  const day = 86_400_000;
  const future = (d: number) => new Date(Date.now() + d * day).toISOString();
  const past = (d: number) => new Date(Date.now() - d * day).toISOString();
  const usedOlder = past(2);
  const usedNewer = past(1);
  sb.script('mcp_api_keys', 'select', {
    data: [
      { id: 'a', name: 'hermes', key_prefix: 'p1', scopes: ['read'], last_used_at: null, expires_at: null, revoked_at: null, created_at: 't' },
      { id: 'b', name: 'old', key_prefix: 'p2', scopes: ['read'], last_used_at: null, expires_at: null, revoked_at: 't', created_at: 't' },
    ],
    error: null,
  });
  sb.script('mcp_oauth_tokens', 'select', {
    data: [
      // client A rotated once: two live-looking rows, one client
      { client_id: 'client-a', expires_at: future(1), refresh_expires_at: future(10), last_used_at: usedOlder, created_at: '2026-09-01T00:00:00Z' },
      { client_id: 'client-a', expires_at: future(7), refresh_expires_at: future(60), last_used_at: usedNewer, created_at: '2026-09-08T00:00:00Z' },
      // client B: access token expired, refresh still ahead = still connected
      { client_id: 'client-b', expires_at: past(1), refresh_expires_at: future(20), last_used_at: null, created_at: '2026-09-05T00:00:00Z' },
      // client C: fully expired, no refresh = gone
      { client_id: 'client-c', expires_at: past(1), refresh_expires_at: null, last_used_at: past(3), created_at: '2026-08-01T00:00:00Z' },
    ],
    error: null,
  });
  sb.script('stripe_subscriptions', 'select', NO_PLAN);
  const r = await handleListApiKeys(repos(sb), JWT_AUTH);
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.apiKeys.map((k: { keyId: string; isActive: boolean }) => [k.keyId, k.isActive]), [['a', true], ['b', false]]);
  assertEquals(data.oauthClients.map((c: { clientId: string; clientName: string | null }) => [c.clientId, c.clientName]), [['client-a', null], ['client-b', null]], 'one row per live client; registration keeps no name');
  const a = data.oauthClients[0];
  assertEquals(a.lastUsedAt, usedNewer, 'the newest last_used_at wins');
  assertEquals(a.createdAt, '2026-09-01T00:00:00Z', 'first approval is the connection date');
  assertEquals(data.connections, { active: 3, limit: 1, tier: 'community', allowance: 'Your plan includes one connected agent.' });
  const tokenFilters = JSON.stringify(sb.callsTo('mcp_oauth_tokens', 'select')[0].filters);
  assert(tokenFilters.includes('"user_id","user-1"') && tokenFilters.includes('"revoked_at",null'), 'only this person\'s unrevoked tokens are read');
});

Deno.test('list_api_keys: the OAuth side failing is reported, never an empty list', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_api_keys', 'select', { data: [], error: null });
  sb.script('mcp_oauth_tokens', 'select', { data: null, error: { message: 'permission denied' } });
  const r = await handleListApiKeys(repos(sb), JWT_AUTH);
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('OAuth-connected clients'), r.error);
});

Deno.test('revoke_api_key by client_id: every live token of that client ends, its holds are released by delegate, and the answer says so', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_tokens', 'update', { data: [{ id: 't1' }, { id: 't2' }], error: null });
  sb.script('agent_checkouts', 'update', { data: [{ id: 'lease-1' }], error: null });
  const r = await handleRevokeApiKey(repos(sb), JWT_AUTH, { client_id: 'client-a' });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.clientId, 'client-a');
  assertEquals(data.tokensRevoked, 2);
  assertEquals(data.leasesReleased, 1);
  assert(String(data.message).includes('sign in again'), data.message);
  const tokenFilters = JSON.stringify(sb.callsTo('mcp_oauth_tokens', 'update')[0].filters);
  assert(tokenFilters.includes('"user_id","user-1"') && tokenFilters.includes('"client_id","client-a"') && tokenFilters.includes('revoked_at'), tokenFilters);
  const leaseFilters = JSON.stringify(sb.callsTo('agent_checkouts', 'update')[0].filters);
  assert(leaseFilters.includes('"holder_delegate","oauth:user-1:client-a"') && leaseFilters.includes('released_at'), leaseFilters);
  assertEquals(sb.callsTo('mcp_api_keys', 'update').length, 0, 'no key row is touched');
});

Deno.test('revoke_api_key by client_id: nothing live for that client is not-found; neither id is the old key_id error', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_tokens', 'update', { data: [], error: null });
  const r = await handleRevokeApiKey(repos(sb), JWT_AUTH, { client_id: 'client-x' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('No live connection for that client'), r.error);
  const none = await handleRevokeApiKey(repos(sb), JWT_AUTH, {});
  assertEquals(none.success, false);
  assert((none.error ?? '').includes('key_id is required'), none.error);
});

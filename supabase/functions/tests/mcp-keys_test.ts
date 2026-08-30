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

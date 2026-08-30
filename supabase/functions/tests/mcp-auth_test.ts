// S1-3 chunk 7: regression tests for the `auth` family, extracted verbatim from
// mcp-server/index.ts into mcp-server/auth.ts. SENSITIVE (production auth must not drift) — these
// pin the request-routing + api-key/oauth-token paths against a FakeSupabase. The JWT path
// (supabase.auth.getUser) and the full OAuth authorize/token flow are bench-verified (the fake
// has no auth server), per the chunk ledger.
import {
  authenticate,
  authenticateWithApiKey,
  authenticateWithOAuthToken,
} from '../mcp-server/auth.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const URL = 'https://example.com/functions/v1/mcp-server';
function reqWith(headers: Record<string, string>): Request {
  return new Request(URL, { method: 'POST', headers });
}
async function throwsWith(fn: () => Promise<unknown>, needle: string): Promise<void> {
  try {
    await fn();
    throw new Error(`expected throw containing "${needle}"`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    assert(msg.includes(needle), `error "${msg}" should include "${needle}"`);
  }
}

// ── authenticate: header routing + guards ─────────────────────────────────────────────

Deno.test('authenticate: no Authorization header is rejected', async () => {
  const sb = new FakeSupabase();
  await throwsWith(() => authenticate(reqWith({}), sb as never), 'Authentication required');
  assertEquals(sb.calls.length, 0, 'no DB call when unauthenticated');
});

Deno.test('authenticate: non-Bearer Authorization is rejected', async () => {
  const sb = new FakeSupabase();
  await throwsWith(() => authenticate(reqWith({ Authorization: 'Basic abc' }), sb as never), 'Must start with "Bearer "');
});

Deno.test('authenticate: X-MCP-API-Key routes to the api-key validator', async () => {
  const sb = new FakeSupabase();
  sb.script('rpc', 'validate_mcp_api_key', {
    data: [{ is_valid: true, user_id: 'user-1', key_id: 'key-1', scopes: ['read', 'propose'] }],
    error: null,
  });
  const auth = await authenticate(reqWith({ 'X-MCP-API-Key': 'ns_live_secret' }), sb as never);
  assertEquals(auth, { userId: 'user-1', keyId: 'key-1', scopes: ['read', 'propose'], authMethod: 'api_key' });
  assertEquals(sb.callsTo('rpc', 'validate_mcp_api_key').length, 1);
});

Deno.test('authenticate: Bearer ns_live_ token routes to the api-key validator', async () => {
  const sb = new FakeSupabase();
  sb.script('rpc', 'validate_mcp_api_key', {
    data: [{ is_valid: true, user_id: 'user-1', key_id: 'key-1', scopes: ['read'] }],
    error: null,
  });
  const auth = await authenticate(reqWith({ Authorization: 'Bearer ns_live_abc' }), sb as never);
  assertEquals(auth.authMethod, 'api_key');
  assertEquals(sb.callsTo('rpc', 'validate_mcp_api_key').length, 1);
});

Deno.test('authenticate: Bearer nst_ token routes to the OAuth-token validator', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_tokens', 'select', {
    data: { user_id: 'user-1', client_id: 'c1', scopes: ['read'], expires_at: '2999-01-01T00:00:00Z', revoked_at: null },
    error: null,
  });
  const auth = await authenticate(reqWith({ Authorization: 'Bearer nst_abc' }), sb as never);
  assertEquals(auth.authMethod, 'oauth_token');
  assertEquals(auth.userId, 'user-1');
});

// ── authenticateWithApiKey ────────────────────────────────────────────────────────────

Deno.test('authenticateWithApiKey: invalid key throws with the rejection reason', async () => {
  const sb = new FakeSupabase();
  sb.script('rpc', 'validate_mcp_api_key', {
    data: [{ is_valid: false, rejection_reason: 'Key revoked' }],
    error: null,
  });
  await throwsWith(() => authenticateWithApiKey(sb as never, 'ns_live_x'), 'Key revoked');
});

Deno.test('authenticateWithApiKey: scopes default to read when absent', async () => {
  const sb = new FakeSupabase();
  sb.script('rpc', 'validate_mcp_api_key', {
    data: [{ is_valid: true, user_id: 'u', key_id: 'k', scopes: null }],
    error: null,
  });
  const auth = await authenticateWithApiKey(sb as never, 'ns_live_x');
  assertEquals(auth.scopes, ['read']);
});

// ── authenticateWithOAuthToken ────────────────────────────────────────────────────────

Deno.test('authenticateWithOAuthToken: valid token returns an oauth AuthResult', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_tokens', 'select', {
    data: { user_id: 'user-1', scopes: ['read', 'write'], expires_at: '2999-01-01T00:00:00Z', revoked_at: null },
    error: null,
  });
  const auth = await authenticateWithOAuthToken(sb as never, 'nst_x');
  assertEquals(auth, { userId: 'user-1', scopes: ['read', 'write'], authMethod: 'oauth_token' });
});

Deno.test('authenticateWithOAuthToken: revoked token is rejected', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_tokens', 'select', {
    data: { user_id: 'u', scopes: ['read'], expires_at: '2999-01-01T00:00:00Z', revoked_at: '2020-01-01T00:00:00Z' },
    error: null,
  });
  await throwsWith(() => authenticateWithOAuthToken(sb as never, 'nst_x'), 'revoked');
});

Deno.test('authenticateWithOAuthToken: expired token is rejected', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_tokens', 'select', {
    data: { user_id: 'u', scopes: ['read'], expires_at: '2000-01-01T00:00:00Z', revoked_at: null },
    error: null,
  });
  await throwsWith(() => authenticateWithOAuthToken(sb as never, 'nst_x'), 'expired');
});

Deno.test('authenticateWithOAuthToken: unknown token is rejected', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_tokens', 'select', { data: null, error: null });
  await throwsWith(() => authenticateWithOAuthToken(sb as never, 'nst_x'), 'Invalid access token');
});

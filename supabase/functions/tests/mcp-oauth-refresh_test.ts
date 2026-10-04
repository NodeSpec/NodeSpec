// V3 4b.4 (R7): refresh tokens on the MCP OAuth lane. Pins: the code
// exchange issues a PAIR (access keeps its 7-day TTL — no client that never
// refreshes regresses; refresh renews it for a sliding 60-day window); the
// refresh grant rotates (new pair, old row retired with rotated_to and
// revoked); a refresh token presented AFTER rotation is reuse — the family
// is revoked and the client must authorize again; expired / revoked /
// wrong-client / widened-scope refreshes refuse; discovery advertises the
// grant; the self-hosted consent page's Google button is an explicit opt-in.
import {
  handleTokenExchange, handleOAuthMetadata, revokeTokenFamily, consentGoogleOptIn,
  ACCESS_TOKEN_TTL_DAYS, REFRESH_TOKEN_TTL_DAYS,
} from '../mcp-server/oauth.ts';
import { sha256Hex } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const CODE = { id: 'code-1', code: 'abc', user_id: 'user-1', client_id: 'claude-code', redirect_uri: 'http://127.0.0.1:1/cb', code_challenge: '', code_challenge_method: 'S256', scopes: ['read', 'write'], expires_at: new Date(Date.now() + 60_000).toISOString(), used: false };

async function pkce() {
  const verifier = 'v'.repeat(48);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

const form = (fields: Record<string, string>) => new Request('http://mcp.test/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
});

Deno.test('authorization_code: the exchange issues a pair — 7-day access + 60-day refresh — and stores both hashes', async () => {
  const { verifier, challenge } = await pkce();
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_codes', 'select', { data: { ...CODE, code_challenge: challenge }, error: null });
  sb.script('mcp_oauth_codes', 'update', { data: [{ id: 'code-1' }], error: null }); // this exchange claimed the code
  sb.script('mcp_oauth_tokens', 'insert', { data: { id: 'tok-1' }, error: null });
  const res = await handleTokenExchange(form({ grant_type: 'authorization_code', code: 'abc', code_verifier: verifier, client_id: 'claude-code' }), sb as never);
  assertEquals(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert(body.access_token.startsWith('nst_'));
  assert(body.refresh_token.startsWith('nsr_'));
  assertEquals(body.expires_in, ACCESS_TOKEN_TTL_DAYS * 86400);
  assertEquals(body.refresh_token_expires_in, REFRESH_TOKEN_TTL_DAYS * 86400);
  assertEquals(body.scope, 'read write');
  // deno-lint-ignore no-explicit-any
  const ins = sb.callsTo('mcp_oauth_tokens', 'insert')[0].payload as any;
  assertEquals(ins.access_token_hash, await sha256Hex(body.access_token));
  assertEquals(ins.refresh_token_hash, await sha256Hex(body.refresh_token));
  assert(!!ins.refresh_expires_at && ins.refresh_expires_at > ins.expires_at, 'the refresh window outlives the access token');
  assertEquals(ins.rotated_from, undefined);
});

Deno.test('RLS audit: a code another exchange already claimed issues nothing, even if it read as unused a moment ago', async () => {
  const { verifier, challenge } = await pkce();
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_codes', 'select', { data: { ...CODE, code_challenge: challenge }, error: null });
  sb.script('mcp_oauth_codes', 'update', { data: [], error: null }); // the other exchange flipped it first
  const res = await handleTokenExchange(form({ grant_type: 'authorization_code', code: 'abc', code_verifier: verifier, client_id: 'claude-code' }), sb as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid_grant');
  assertEquals(sb.callsTo('mcp_oauth_tokens', 'insert').length, 0, 'no token pair minted');
  const claim = sb.callsTo('mcp_oauth_codes', 'update')[0];
  assert(JSON.stringify(claim.filters).includes('"used"'), 'the claim is conditional on the code being unused');
});

Deno.test('refresh_token: rotates — a new pair, the old row retired with rotated_to and revoked', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_tokens', 'select', { data: { id: 'tok-1', user_id: 'user-1', client_id: 'claude-code', scopes: ['read', 'write'], revoked_at: null, refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(), rotated_to: null }, error: null });
  sb.script('mcp_oauth_tokens', 'insert', { data: { id: 'tok-2' }, error: null });
  sb.script('mcp_oauth_tokens', 'update', { data: null, error: null });
  const res = await handleTokenExchange(form({ grant_type: 'refresh_token', refresh_token: 'nsr_old', client_id: 'claude-code' }), sb as never);
  assertEquals(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert(body.access_token.startsWith('nst_') && body.refresh_token.startsWith('nsr_'));
  // deno-lint-ignore no-explicit-any
  const ins = sb.callsTo('mcp_oauth_tokens', 'insert')[0].payload as any;
  assertEquals(ins.rotated_from, 'tok-1');
  assertEquals(ins.user_id, 'user-1');
  assertEquals(ins.client_id, 'claude-code');
  // deno-lint-ignore no-explicit-any
  const upd = sb.callsTo('mcp_oauth_tokens', 'update')[0].payload as any;
  assertEquals(upd.rotated_to, 'tok-2');
  assert(!!upd.revoked_at, 'the old pair stops authenticating');
  assert(JSON.stringify(sb.callsTo('mcp_oauth_tokens', 'update')[0].filters).includes('tok-1'));
  // the lookup was by the refresh hash, never the raw token
  const sel = JSON.stringify(sb.callsTo('mcp_oauth_tokens', 'select')[0].filters);
  assert(sel.includes(await sha256Hex('nsr_old')) && !sel.includes('nsr_old'));
});

Deno.test('refresh_token: reuse after rotation revokes the whole family and refuses', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_tokens', 'select', { data: { id: 'tok-1', user_id: 'user-1', client_id: 'claude-code', scopes: ['read'], revoked_at: '2026-09-14T00:00:00Z', refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(), rotated_to: 'tok-2' }, error: null });
  sb.script('mcp_oauth_tokens', 'update', { data: { id: 'tok-1', rotated_to: 'tok-2' }, error: null });
  sb.script('mcp_oauth_tokens', 'update', { data: { id: 'tok-2', rotated_to: 'tok-3' }, error: null });
  sb.script('mcp_oauth_tokens', 'update', { data: { id: 'tok-3', rotated_to: null }, error: null });
  const res = await handleTokenExchange(form({ grant_type: 'refresh_token', refresh_token: 'nsr_replayed' }), sb as never);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'invalid_grant');
  assert(body.error_description.includes('reuse detected'));
  assertEquals(sb.callsTo('mcp_oauth_tokens', 'update').length, 3, 'the chain tok-1 → tok-2 → tok-3 is revoked');
  assertEquals(sb.callsTo('mcp_oauth_tokens', 'insert').length, 0, 'nothing minted');
});

Deno.test('refresh_token: expired, revoked, unknown, wrong client and widened scope all refuse; narrowing is allowed', async () => {
  const live = { id: 'tok-1', user_id: 'user-1', client_id: 'claude-code', scopes: ['read', 'write'], revoked_at: null, refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(), rotated_to: null };
  const attempt = async (row: unknown, fields: Record<string, string>) => {
    const sb = new FakeSupabase();
    sb.script('mcp_oauth_tokens', 'select', { data: row, error: null });
    sb.script('mcp_oauth_tokens', 'insert', { data: { id: 'tok-2' }, error: null });
    const res = await handleTokenExchange(form({ grant_type: 'refresh_token', refresh_token: 'nsr_x', ...fields }), sb as never);
    return { status: res.status, body: await res.json() };
  };
  assertEquals((await attempt({ ...live, refresh_expires_at: '2020-01-01T00:00:00Z' }, {})).body.error_description.includes('expired'), true);
  assertEquals((await attempt({ ...live, revoked_at: '2026-01-01T00:00:00Z' }, {})).body.error_description.includes('revoked'), true);
  assertEquals((await attempt(null, {})).body.error, 'invalid_grant');
  assertEquals((await attempt(live, { client_id: 'someone-else' })).body.error_description, 'client_id mismatch');
  assertEquals((await attempt(live, { scope: 'read write propose' })).body.error, 'invalid_scope');
  const narrowed = await attempt(live, { scope: 'read' });
  assertEquals(narrowed.status, 200);
  assertEquals(narrowed.body.scope, 'read');
  const missing = await handleTokenExchange(form({ grant_type: 'refresh_token' }), new FakeSupabase() as never);
  assertEquals((await missing.json()).error, 'invalid_request');
});

Deno.test('revokeTokenFamily walks rotated_to with a hop limit; discovery advertises refresh_token', async () => {
  const sb = new FakeSupabase();
  sb.script('mcp_oauth_tokens', 'update', { data: { id: 'a', rotated_to: 'b' }, error: null });
  sb.script('mcp_oauth_tokens', 'update', { data: { id: 'b', rotated_to: null }, error: null });
  assertEquals(await revokeTokenFamily(sb as never, 'a'), 2);
  const meta = await handleOAuthMetadata(new Request('http://mcp.test/.well-known/oauth-authorization-server')).json();
  assertEquals(meta.grant_types_supported, ['authorization_code', 'refresh_token']);
});

Deno.test('the self-hosted consent page shows Google only by explicit opt-in', () => {
  assertEquals(consentGoogleOptIn({ get: () => undefined }), false);
  assertEquals(consentGoogleOptIn({ get: (n: string) => (n === 'MCP_CONSENT_GOOGLE' ? 'true' : undefined) }), true);
  assertEquals(consentGoogleOptIn({ get: () => 'yes' }), false, 'exact value only');
});

// MCP OAuth consent — server-side MFA enforcement (found live 2026-08-26).
// A password-only (AAL1) session token must never mint an authorization code
// for a user with a verified factor; the consent page's client-side check is
// UX, not enforcement. These pins hold the gate AND its two failure modes:
// the factor source must be the getUser result (a PostgREST query against the
// auth schema fails silently = fail-open), and the JWT aal decoder must
// handle UNPADDED base64url (naive atob throws = every MFA user fails closed).
import { decodeJwtAal, handleAuthorizeGet } from '../mcp-server/oauth.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const b64url = (s: string) =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fakeJwt = (claims: Record<string, unknown>) =>
  `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.${b64url('sig')}`;

Deno.test('decodeJwtAal: reads aal from UNPADDED base64url payloads (the atob padding trap)', () => {
  // Deliberately vary payload lengths so unpadded segments hit every mod-4 case.
  assertEquals(decodeJwtAal(fakeJwt({ aal: 'aal2', sub: 'u1' })), 'aal2');
  assertEquals(decodeJwtAal(fakeJwt({ aal: 'aal1' })), 'aal1');
  assertEquals(decodeJwtAal(fakeJwt({ aal: 'aal2', sub: 'user-123', session_id: 'abc' })), 'aal2');
  assertEquals(decodeJwtAal(fakeJwt({ sub: 'no-aal-claim' })), null);
  assertEquals(decodeJwtAal('garbage'), null);
  assertEquals(decodeJwtAal(''), null);
});

type Any = Record<string, unknown>;

function authorizeUrl(sessionToken: string): Request {
  const u = new URL('http://localhost/functions/v1/mcp-server/authorize');
  u.searchParams.set('client_id', 'client-1');
  u.searchParams.set('redirect_uri', 'https://claude.ai/api/mcp/auth_callback');
  u.searchParams.set('code_challenge', 'x'.repeat(43));
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', 'st');
  u.searchParams.set('scope', 'read write propose');
  u.searchParams.set('session_token', sessionToken);
  return new Request(u.toString());
}

function supabaseWithUser(user: Any) {
  const fake = new FakeSupabase() as unknown as Any;
  (fake as { auth?: unknown }).auth = {
    getUser: (_token: string) => Promise.resolve({ data: { user }, error: null }),
  };
  return fake as unknown as Parameters<typeof handleAuthorizeGet>[1] & FakeSupabase;
}

Deno.test('authorize: verified factor + AAL1 token → 401, and NO code row is written', async () => {
  const sb = supabaseWithUser({ id: 'u1', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] });
  const res = await handleAuthorizeGet(authorizeUrl(fakeJwt({ aal: 'aal1', sub: 'u1' })), sb);
  assertEquals(res.status, 401);
  assert((await res.text()).includes('Multi-factor authentication required'));
  assertEquals((sb as FakeSupabase).callsTo('mcp_oauth_codes', 'insert').length, 0, 'no authorization code minted pre-MFA');
});

Deno.test('authorize: verified factor + AAL2 token → code minted and 302 back to the client', async () => {
  const sb = supabaseWithUser({ id: 'u1', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] });
  const res = await handleAuthorizeGet(authorizeUrl(fakeJwt({ aal: 'aal2', sub: 'u1' })), sb);
  assertEquals(res.status, 302);
  const loc = res.headers.get('location') ?? '';
  assert(loc.startsWith('https://claude.ai/api/mcp/auth_callback'), loc);
  assert(loc.includes('code='), 'authorization code issued');
  assertEquals((sb as FakeSupabase).callsTo('mcp_oauth_codes', 'insert').length, 1);
});

Deno.test('authorize: NO verified factor + AAL1 token → proceeds (MFA only binds enrolled users)', async () => {
  const sb = supabaseWithUser({ id: 'u2', factors: [{ id: 'f9', factor_type: 'totp', status: 'unverified' }] });
  const res = await handleAuthorizeGet(authorizeUrl(fakeJwt({ aal: 'aal1', sub: 'u2' })), sb);
  assertEquals(res.status, 302);
  assertEquals((sb as FakeSupabase).callsTo('mcp_oauth_codes', 'insert').length, 1);
});

Deno.test('consent page source: the client factor check FAILS CLOSED and the community stack can enroll', async () => {
  const src = await Deno.readTextFile(new URL('../mcp-server/oauth.ts', import.meta.url));
  // A failed /auth/v1/user fetch must be an error, never "no MFA".
  assert(src.includes('Could not check two-factor status'));
  assert(!src.includes('if (factorsResp.ok) {'), 'the fail-open branch shape must not return');
  // The gate reads factors from getUser — never a PostgREST auth-schema query.
  assert(!src.includes(".schema('auth')"), 'auth schema is not exposed via PostgREST; querying it fails open');
  // Community/self-host: TOTP enrollment is on so container users can create
  // their authenticator/QR (config.toml ships in the export).
  const config = await Deno.readTextFile(new URL('../../config.toml', import.meta.url));
  const totp = config.slice(config.indexOf('[auth.mfa.totp]'));
  assert(totp.slice(0, 200).includes('enroll_enabled = true'), 'TOTP enroll enabled for the community stack');
  assert(totp.slice(0, 200).includes('verify_enabled = true'), 'TOTP verify enabled for the community stack');
});

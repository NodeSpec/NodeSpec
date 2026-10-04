// V3 I (owner ruling 2026-09-21): the OAuth consent is a connection door too.
// A new client approved in the browser is a new connected agent, so the
// code mint compares agent_connection_count with the plan's allowance the
// same way create_api_key does. The client renewing its own connection is
// left out of the count by name, so re-authorizing never trips the cap. The
// refusal rides back the OAuth way: a 302 to the client's redirect_uri with
// error=access_denied and the one sentence the Connected tab speaks; no
// authorization code is written.
import { handleAuthorizeGet } from '../mcp-server/oauth.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

type Any = Record<string, unknown>;

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fakeJwt = (claims: Record<string, unknown>) =>
  `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.${b64url('sig')}`;
const SESSION = fakeJwt({ aal: 'aal1', sub: 'u1' });

function authorizeUrl(clientId = 'client-1'): Request {
  const u = new URL('http://localhost/functions/v1/mcp-server/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', 'https://claude.ai/api/mcp/auth_callback');
  u.searchParams.set('code_challenge', 'x'.repeat(43));
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', 'st-7');
  u.searchParams.set('scope', 'read write propose');
  u.searchParams.set('session_token', SESSION);
  return new Request(u.toString());
}

function supabaseWithUser(user: Any) {
  const fake = new FakeSupabase() as unknown as Any;
  (fake as { auth?: unknown }).auth = {
    getUser: (_token: string) => Promise.resolve({ data: { user }, error: null }),
  };
  return fake as unknown as Parameters<typeof handleAuthorizeGet>[1] & FakeSupabase;
}

const INDIE = { data: { plan_name: 'Indie', status: 'active' }, error: null };

Deno.test('consent: community with one connection live is turned away with access_denied, the sentence and the state; no code is minted', async () => {
  const sb = supabaseWithUser({ id: 'u1', factors: [] });
  sb.script('stripe_subscriptions', 'select', { data: null, error: null });
  sb.script('rpc', 'agent_connection_count', { data: 1, error: null });
  const res = await handleAuthorizeGet(authorizeUrl(), sb);
  assertEquals(res.status, 302);
  const loc = new URL(res.headers.get('location') ?? 'http://x/');
  assertEquals(loc.origin + loc.pathname, 'https://claude.ai/api/mcp/auth_callback');
  assertEquals(loc.searchParams.get('error'), 'access_denied');
  assertEquals(loc.searchParams.get('state'), 'st-7');
  assert((loc.searchParams.get('error_description') ?? '').includes('Your plan includes one connected agent, and it is in use'), loc.toString());
  assertEquals(loc.searchParams.get('code'), null);
  assertEquals(sb.callsTo('mcp_oauth_codes', 'insert').length, 0, 'no authorization code written');
});

Deno.test('consent: the client renewing its own connection is left out of the count by name', async () => {
  const sb = supabaseWithUser({ id: 'u1', factors: [] });
  sb.script('stripe_subscriptions', 'select', { data: null, error: null });
  sb.script('rpc', 'agent_connection_count', { data: 0, error: null });
  const res = await handleAuthorizeGet(authorizeUrl('claude-desktop-42'), sb);
  assertEquals(res.status, 302);
  assert((res.headers.get('location') ?? '').includes('code='), 'code issued');
  const count = sb.callsTo('rpc', 'agent_connection_count')[0].payload as Any;
  assertEquals(count, { p_user_id: 'u1', p_except_client_id: 'claude-desktop-42' });
  assertEquals(sb.callsTo('mcp_oauth_codes', 'insert').length, 1);
});

Deno.test('consent: indie approves a fifth client and turns away a sixth', async () => {
  const four = supabaseWithUser({ id: 'u1', factors: [] });
  four.script('stripe_subscriptions', 'select', INDIE);
  four.script('rpc', 'agent_connection_count', { data: 4, error: null });
  const ok = await handleAuthorizeGet(authorizeUrl('fifth'), four);
  assertEquals(ok.status, 302);
  assert((ok.headers.get('location') ?? '').includes('code='), 'fifth is approved');

  const five = supabaseWithUser({ id: 'u1', factors: [] });
  five.script('stripe_subscriptions', 'select', INDIE);
  five.script('rpc', 'agent_connection_count', { data: 5, error: null });
  const no = await handleAuthorizeGet(authorizeUrl('sixth'), five);
  const loc = new URL(no.headers.get('location') ?? 'http://x/');
  assertEquals(loc.searchParams.get('error'), 'access_denied');
  assert((loc.searchParams.get('error_description') ?? '').includes('Indie connects up to five agents per person, and yours are all in use'), loc.toString());
  assertEquals(five.callsTo('mcp_oauth_codes', 'insert').length, 0);
});

Deno.test('consent: a count the database cannot give refuses (500, plain), never mints blind', async () => {
  const sb = supabaseWithUser({ id: 'u1', factors: [] });
  sb.script('stripe_subscriptions', 'select', INDIE);
  sb.script('rpc', 'agent_connection_count', { data: null, error: { message: 'boom', code: '42883' } });
  const res = await handleAuthorizeGet(authorizeUrl(), sb);
  assertEquals(res.status, 500);
  assert((await res.text()).includes('Could not count your connected agents'));
  assertEquals(sb.callsTo('mcp_oauth_codes', 'insert').length, 0);
});

Deno.test('consent: the cap is checked after MFA, so an AAL1 session with a verified factor never reaches the count', async () => {
  const sb = supabaseWithUser({ id: 'u1', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] });
  sb.script('rpc', 'agent_connection_count', { data: 0, error: null });
  const res = await handleAuthorizeGet(authorizeUrl(), sb);
  assertEquals(res.status, 401);
  assertEquals(sb.callsTo('rpc', 'agent_connection_count').length, 0, 'the count is not consulted before the factor gate');
});

// RLS and access audit (owner 2026-09-30): the OAuth consent page is web facing and
// takes its values from the query string. The values went into an inline <script> as
// JSON.stringify output, which leaves "</script>" as it is, so a crafted link could end
// the script and run its own on the page where people type their password. They are
// escaped now; a redirect_uri that is not a URL, or would run in the page, is refused;
// and because any client may register, the page names where an approval is sent.
import { handleAuthorizeGet, redirectDestination, scriptJson } from '../mcp-server/oauth.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

function consent(params: Record<string, string>): Promise<Response> {
  const u = new URL('http://localhost/functions/v1/mcp-server/authorize');
  const all = {
    client_id: 'client-1', redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state: 'st-1', scope: 'read write', ...params,
  };
  for (const [k, v] of Object.entries(all)) u.searchParams.set(k, v);
  return handleAuthorizeGet(new Request(u.toString()), new FakeSupabase() as never);
}

/** The page's own parameters, read back the way its script reads them. */
function pageParams(html: string): Record<string, string> {
  const m = /const __params = (.*);\n/.exec(html);
  if (!m) throw new Error('no __params in the page');
  return JSON.parse(m[1]);
}

Deno.test('a value that closes the script is carried as text; the page runs no script of the attacker\'s', async () => {
  const hostile = '</script><script>alert(document.domain)</script><!--';
  const res = await consent({ state: hostile, client_id: 'c</script><img src=x onerror=alert(1)>' });
  assertEquals(res.status, 200);
  const html = await res.text();
  assert(!html.includes('<script>alert('), 'the injected script tag is not in the page');
  assert(!html.includes('<img src=x'), 'the injected tag is not in the page');
  const params = pageParams(html);
  assertEquals(params.state, hostile, 'the state still round-trips exactly');
  assertEquals(params.clientId, 'c</script><img src=x onerror=alert(1)>');
  assertEquals(JSON.parse(scriptJson({ s: '\u2028<&>\u2029' })).s, '\u2028<&>\u2029');
});

Deno.test('a redirect_uri that is not a URL, or would run in the page, is refused before any page', async () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'not a url', 'file:///etc/passwd']) {
    const res = await consent({ redirect_uri: bad });
    assertEquals(res.status, 400, bad);
    assertEquals(res.headers.get('content-type')?.startsWith('text/plain'), true);
  }
});

Deno.test('the page names where an approval is sent, including a custom scheme a desktop client listens on', async () => {
  const html = await (await consent({ redirect_uri: 'https://attacker.example/cb' })).text();
  assert(html.includes('<strong>attacker.example</strong>'), 'the destination host is named');
  assertEquals(redirectDestination('http://127.0.0.1:33418/callback'), '127.0.0.1:33418');
  assertEquals(redirectDestination('cursor://anysphere.cursor-mcp/oauth/callback'), 'cursor://anysphere.cursor-mcp');
  const named = await (await consent({ redirect_uri: 'https://a.example/cb?x="><b>' })).text();
  assert(named.includes('<strong>a.example</strong>'));
});

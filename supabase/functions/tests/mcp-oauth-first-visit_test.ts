// AL.26 (owner 2026-10-07): accounts were being created by the Google button on
// the Claude sign-in page and connecting an agent without ever opening the app, so
// they never got the example project, the walkthrough or the plan step. On the
// managed site an account the app has never set up now gets a page instead of an
// authorization code: open NodeSpec, add the NodeSpec skill (the header's Skills
// menu, or GitHub), come back and continue. The same request finishes once the app
// has set the account up. The consent page also offers "Create your account first".
import { handleAuthorizeGet, hasUsedApp } from '../mcp-server/oauth.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

type Any = Record<string, unknown>;

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fakeJwt = (claims: Record<string, unknown>) =>
  `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.${b64url('signature:' + JSON.stringify(claims))}`;
const SESSION = fakeJwt({ aal: 'aal1', sub: 'u1' });
const BASE = 'https://mcp.nodespec.io/mcp';
const APP = 'https://nodespec.io';
const SKILL = 'https://github.com/NodeSpec/NodeSpec/blob/HEAD/skills/nodespec-developer/SKILL.md';
const MARKED = { data: { preferences: { theme: 'dark', exampleProject: { id: 'ex-1', at: '2026-10-01T00:00:00Z' } } }, error: null };

function params(session?: string): URLSearchParams {
  const p = new URLSearchParams({
    client_id: 'claude-ai', redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state: 'st-9', scope: 'read write propose',
  });
  if (session) p.set('session_token', session);
  return p;
}

const authorize = (session?: string) => new Request(`${BASE}/authorize?${params(session)}`);

function supabaseWithUser(user: Any) {
  const fake = new FakeSupabase() as unknown as Any;
  (fake as { auth?: unknown }).auth = {
    getUser: (_token: string) => Promise.resolve({ data: { user }, error: null }),
  };
  return fake as unknown as Parameters<typeof handleAuthorizeGet>[1] & FakeSupabase;
}

/** Runs the test with these environment values and puts the old ones back. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, Deno.env.get(k)]));
  const put = (v: Record<string, string | undefined>) => {
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) Deno.env.delete(k);
      else Deno.env.set(k, x);
    }
  };
  put(vars);
  try { await fn(); } finally { put(before); }
}
const HOSTED = { NODESPEC_DEPLOYMENT: undefined, MCP_PUBLIC_URL: BASE };
const SELF_HOSTED = { NODESPEC_DEPLOYMENT: 'self-hosted', MCP_PUBLIC_URL: BASE };

const minted = (sb: FakeSupabase) => sb.callsTo('mcp_oauth_codes', 'insert').length;
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

Deno.test('a brand-new account gets the setup page, not a code: the app, the skill in the header and on GitHub, and the way back', async () => {
  await withEnv(HOSTED, async () => {
    const sb = supabaseWithUser({ id: 'u1', factors: [] });
    const res = await handleAuthorizeGet(authorize(SESSION), sb);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('cache-control'), 'no-store');
    const html = await res.text();
    assert(html.includes('Your NodeSpec account is ready'), 'the page says what happened');
    assertEquals(minted(sb), 0, 'no authorization code is written');
    assertEquals(sb.callsTo('rpc', 'agent_connection_count').length, 0, 'the page comes before the connection count');

    const links = hrefs(html);
    assert(links.includes(`${APP}/?signin=claude`), `Open NodeSpec goes to the app's sign-in: ${links.join(' ')}`);
    assert(links.includes(SKILL), 'the skill file on GitHub is linked');
    assert(/Copy it from <strong>Skills<\/strong> in the app's header/.test(html), 'the header Skills menu is named');

    // "Sign in again" is this same request without the token.
    const again = links.find((l) => l.startsWith(`${BASE}/authorize?`))!;
    const back = new URL(again).searchParams;
    for (const [k, v] of params()) assertEquals(back.get(k), v, k);
    assertEquals(back.get('session_token'), null);
    assert(!html.includes(SESSION) && !html.includes(SESSION.slice(-12)), 'the session token is nowhere in the page');
  });
});

Deno.test('an account the app has set up is connected: the example mark, an owned project, or a seat', async () => {
  await withEnv(HOSTED, async () => {
    // The mark stays after the example is deleted, so no project is needed.
    const marked = supabaseWithUser({ id: 'u1', factors: [] });
    marked.script('user_settings', 'select', MARKED);
    const a = await handleAuthorizeGet(authorize(SESSION), marked);
    assertEquals(a.status, 302);
    assert((a.headers.get('location') ?? '').includes('code='));
    assertEquals(minted(marked), 1);
    assertEquals(marked.callsTo('projects', 'select').length, 0, 'the mark alone answers');

    // An account from before the example project: it owns a project.
    const owner = supabaseWithUser({ id: 'u1', factors: [] });
    owner.script('user_settings', 'select', { data: null, error: null });
    owner.script('projects', 'select', { data: [{ id: 'p1' }], error: null });
    const b = await handleAuthorizeGet(authorize(SESSION), owner);
    assertEquals(b.status, 302);
    assertEquals(minted(owner), 1);

    // A teammate with a seat on someone else's project and nothing of their own.
    const seat = supabaseWithUser({ id: 'u1', factors: [] });
    seat.script('projects', 'select', { data: [], error: null });
    seat.script('project_members', 'select', { data: [{ role: 'editor' }], error: null });
    const c = await handleAuthorizeGet(authorize(SESSION), seat);
    assertEquals(c.status, 302);
    assertEquals(minted(seat), 1);
  });
});

Deno.test('settings without the example mark do not count as having used the app', async () => {
  await withEnv(HOSTED, async () => {
    const sb = supabaseWithUser({ id: 'u1', factors: [] });
    sb.script('user_settings', 'select', { data: { preferences: { theme: 'dark' } }, error: null });
    const res = await handleAuthorizeGet(authorize(SESSION), sb);
    assertEquals(res.status, 200);
    assert((await res.text()).includes('Your NodeSpec account is ready'));
    assertEquals(minted(sb), 0);
  });
});

Deno.test('the check reads the account it was asked about, and a lookup the database cannot answer refuses rather than guessing', async () => {
  const sb = new FakeSupabase();
  sb.script('user_settings', 'select', { data: null, error: null });
  sb.script('projects', 'select', { data: [], error: null });
  sb.script('project_members', 'select', { data: [], error: null });
  assertEquals(await hasUsedApp(sb as never, 'u-42'), false);
  for (const [table, column] of [['user_settings', 'user_id'], ['projects', 'owner_id'], ['project_members', 'user_id']]) {
    const call = sb.callsTo(table, 'select')[0];
    assert(call.filters.some((f) => f.method === 'eq' && f.args[0] === column && f.args[1] === 'u-42'),
      `${table} is read by ${column} = u-42: ${JSON.stringify(call.filters)}`);
  }

  for (const failing of ['user_settings', 'projects', 'project_members']) {
    const db = new FakeSupabase();
    for (const t of ['user_settings', 'projects', 'project_members']) {
      db.script(t, 'select', t === failing ? { data: null, error: { message: 'boom' } } : { data: t === 'user_settings' ? null : [], error: null });
    }
    assertEquals(await hasUsedApp(db as never, 'u1'), null, `${failing} failing`);
  }

  await withEnv(HOSTED, async () => {
    const down = supabaseWithUser({ id: 'u1', factors: [] });
    down.script('user_settings', 'select', { data: null, error: { message: 'boom' } });
    const res = await handleAuthorizeGet(authorize(SESSION), down);
    assertEquals(res.status, 500);
    assert((await res.text()).includes('Could not check your NodeSpec account'));
    assertEquals(minted(down), 0);
  });
});

Deno.test('two-factor still comes first: a verified factor with a password-only session is asked for its code, not sent to setup', async () => {
  await withEnv(HOSTED, async () => {
    const sb = supabaseWithUser({ id: 'u1', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] });
    const res = await handleAuthorizeGet(authorize(SESSION), sb);
    assertEquals(res.status, 401);
    assertEquals(sb.callsTo('user_settings', 'select').length, 0);
  });
});

Deno.test('a self-hosted install connects a new account as before, and its sign-in page names no nodespec.io', async () => {
  await withEnv(SELF_HOSTED, async () => {
    const sb = supabaseWithUser({ id: 'u1', factors: [] });
    const res = await handleAuthorizeGet(authorize(SESSION), sb);
    assertEquals(res.status, 302);
    assertEquals(minted(sb), 1);
    assertEquals(sb.callsTo('user_settings', 'select').length, 0, 'the check never runs');

    const page = await (await handleAuthorizeGet(authorize(), new FakeSupabase() as never)).text();
    assert(!page.includes('Create your account first'));
    assert(!page.includes('nodespec.io/?signup'));
  });
});

Deno.test('the managed sign-in page offers someone new the app\'s sign-up, in a new tab so the request survives', async () => {
  await withEnv(HOSTED, async () => {
    const res = await handleAuthorizeGet(authorize(), new FakeSupabase() as never);
    assertEquals(res.status, 200);
    const html = await res.text();
    const link = /<div class="signup-note">New to NodeSpec\? <a href="([^"]+)" target="_blank" rel="noopener noreferrer">Create your account first<\/a>/.exec(html);
    assert(link, 'the sign-up link is on the page');
    assertEquals(link[1], `${APP}/?signup=claude`);
    assert(html.indexOf('signup-note') < html.indexOf('id="googleBtn"'), 'it comes before the sign-in choices');
  });
});

/** The setup page's script, run against a stand-in browser. */
function runSetupScript(html: string, href: string, storage: Map<string, string>) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
  const state = { address: '', location: { href }, again: { style: { display: 'none' } }, click: () => {} };
  const els: Record<string, unknown> = {
    again: state.again,
    continueBtn: { addEventListener: (_type: string, fn: () => void) => { state.click = fn; } },
  };
  new Function('window', 'history', 'sessionStorage', 'document', script)(
    { location: state.location },
    { replaceState: (_s: unknown, _t: string, url: string) => { state.address = url; } },
    { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, String(v)), removeItem: (k: string) => storage.delete(k) },
    { getElementById: (id: string) => els[id] },
  );
  return state;
}

Deno.test('the setup page takes the token out of the address bar, Continue finishes the same request, and a retry that lands back here says why', async () => {
  await withEnv(HOSTED, async () => {
    const html = await (await handleAuthorizeGet(authorize(SESSION), supabaseWithUser({ id: 'u1', factors: [] }))).text();
    const storage = new Map<string, string>();
    const href = `${BASE}/authorize?${params(SESSION)}`;

    const first = runSetupScript(html, href, storage);
    const shown = new URL(first.address, BASE);
    assertEquals(shown.searchParams.get('session_token'), null, 'the token leaves the address bar');
    assertEquals(shown.searchParams.get('state'), 'st-9');
    assertEquals(first.again.style.display, 'none', 'nothing to explain on the first visit');

    first.click();
    const next = new URL(first.location.href);
    assertEquals(next.searchParams.get('session_token'), SESSION, 'Continue sends the same sign-in back');
    for (const [k, v] of params()) assertEquals(next.searchParams.get(k), v, k);

    // The server stops it again (not set up yet): the page says so this time.
    const second = runSetupScript(html, href, storage);
    assertEquals(second.again.style.display, 'block');

    // A different sign-in in the same tab starts clean.
    const other = fakeJwt({ aal: 'aal1', sub: 'u2' });
    storage.set('nodespec_mcp_setup_retry', SESSION.slice(-12));
    const fresh = runSetupScript(html, `${BASE}/authorize?${params(other)}`, storage);
    assertEquals(fresh.again.style.display, 'none');
  });
});

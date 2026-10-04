// V3 I bench rider (docs/V3_OVERHAUL_PLAN.md, section I): connected agents
// per person, live on the deployed stack. The Deno suite proves the
// handlers over fakes and lane 065 proves the SQL; THIS proves the whole
// door as the app and the agents use it: the signed-in session calls the
// three key tools over JSON-RPC exactly as the Connected tab does, a minted
// key connects and is its own identity on the lease board beside a second
// minted key, the plan's allowance is reached and refused with the sentence
// on both doors (create_api_key and the OAuth consent redirect), the OAuth
// consent is approved once a slot is free and its token pair exchanges and
// connects, a revoke ends a key and its hold, a revoke by client_id ends
// the token family and its hold, and a second real account never sees the
// first one's connections. The account is left as it was found: every key
// and client this run minted is revoked in `finally`, leftovers of a
// crashed run are deleted at the start.
import { createHash, randomBytes } from 'node:crypto';
import { rest, mcpCall, mcpCallAs, mcpRpc, uid, Scenario, parseMcp } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

// Over the REAL transport the tool-result text is the handler's data
// ALREADY UNWRAPPED; an error arrives as isError text. parseMcp (lib.mjs) reads it.

const PREFIX = 'bench-conn-';
const REDIRECT = 'http://localhost:3334/oauth/callback';
const CAP_LINE = /connects up to five agents per person, and yours are all in use\. Revoke one under Agents, Connected, to connect another\./;
const ONE_LINE = /Your plan includes one connected agent, and it is in use\. Revoke it under Agents, Connected, or upgrade to Indie to connect up to five\./;
const capLineFor = (limit) => (limit === 1 ? ONE_LINE : CAP_LINE);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Every key and OAuth client this scenario ever minted for one person:
 *  deleted before a run (a crashed run's leftovers would trip the cap or
 *  the name rule), revoked after it (the account keeps only what it had). */
async function sweep(db, userId, mode) {
  if (mode === 'delete') {
    await db.delete('mcp_oauth_codes', `user_id=eq.${userId}&client_id=like.${PREFIX}*`);
    await db.delete('mcp_oauth_tokens', `user_id=eq.${userId}&client_id=like.${PREFIX}*`);
    await db.delete('mcp_api_keys', `user_id=eq.${userId}&name=like.${PREFIX}*`);
    return;
  }
  const now = new Date().toISOString();
  await db.update('mcp_oauth_tokens', `user_id=eq.${userId}&client_id=like.${PREFIX}*&revoked_at=is.null`, { revoked_at: now });
  await db.update('mcp_api_keys', `user_id=eq.${userId}&name=like.${PREFIX}*&revoked_at=is.null`, { revoked_at: now });
}

async function adminCreateUser(env, email, password) {
  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.id) throw new Error(`admin create user ${email} → ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.id;
}
async function adminDeleteUser(env, id) {
  await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  }).catch(() => {});
}
async function signInAs(env, email, password) {
  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) throw new Error(`sign-in as ${email} → ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return { accessToken: data.access_token, userId: data.user?.id };
}

/** GET /authorize with the session token, the way the consent page finishes
 *  after sign-in; the answer is the 302 back to the client, read raw. */
async function authorize(env, session, clientId, challenge, state) {
  const u = new URL(`${env.SUPABASE_URL}/functions/v1/mcp-server/authorize`);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  u.searchParams.set('scope', 'read write propose');
  u.searchParams.set('session_token', session.accessToken);
  const resp = await fetch(u, { redirect: 'manual', headers: { apikey: env.SUPABASE_ANON_KEY } });
  const location = resp.headers.get('location') ?? '';
  let params = new URLSearchParams();
  try { if (location) params = new URL(location).searchParams; } catch { /* not a URL: the body says why */ }
  const body = resp.status >= 400 || !location ? await resp.text().catch(() => '') : '';
  return {
    status: resp.status, location, body: body.slice(0, 300),
    code: params.get('code'), error: params.get('error'), description: params.get('error_description'), state: params.get('state'),
  };
}
async function tokenGrant(env, form) {
  const resp = await fetch(`${env.SUPABASE_URL}/functions/v1/mcp-server/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', apikey: env.SUPABASE_ANON_KEY },
    body: new URLSearchParams(form),
  });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

export const connections = {
  name: 'v3-connections',
  boxes: [
    'V3-I allowance counted live', 'V3-I mint refused at the cap and on a taken name', 'V3-I a minted key connects as its own identity',
    'V3-I OAuth consent obeys the cap', 'V3-I revoke ends the credential and its holds', 'V3-I one person never sees another',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const db = rest(env);
    const asMe = (tool, args) => mcpCallAs(env, { accessToken: session.accessToken }, tool, args);
    const stamp = Date.now();
    let other = null;
    await sweep(db, session.userId, 'delete');

    try {
      // 0 — the door the Connected tab uses: a browser's preflight must admit the bearer.
      const pre = await fetch(`${env.SUPABASE_URL}/functions/v1/mcp-server`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
      });
      s.check('the browser door: preflight admits Authorization and Content-Type',
        pre.status < 300 && /authorization/i.test(pre.headers.get('access-control-allow-headers') ?? '') && /content-type/i.test(pre.headers.get('access-control-allow-headers') ?? ''),
        `${pre.status} allow-headers=${pre.headers.get('access-control-allow-headers')}`);

      // 1 — the list, as the person: the plan's number, the seeded key live.
      let list = parseMcp(await asMe('list_api_keys', {}));
      const limit = list.connections?.limit;
      s.check('list_api_keys answers the signed-in person with the allowance (1 on community, 5 above)',
        (limit === 1 || limit === 5) && typeof list.connections?.tier === 'string' && typeof list.connections?.active === 'number' && typeof list.connections?.allowance === 'string',
        JSON.stringify(list.connections ?? list).slice(0, 300));
      const [seededRow] = await db.select('mcp_api_keys', `key_hash=eq.${sha256(env.MCP_API_KEY)}&select=id,name,revoked_at`);
      const seeded = (list.apiKeys ?? []).find((k) => k.keyId === seededRow?.id);
      s.check('the key the bench connects with is a live connection in the list', !!seededRow && seeded?.isActive === true, JSON.stringify({ seededRow, seeded }).slice(0, 300));
      const baseActive = list.connections?.active ?? 0;
      s.check('active is live keys plus OAuth clients, nothing else',
        baseActive === (list.apiKeys ?? []).filter((k) => k.isActive).length + (list.oauthClients ?? []).length,
        JSON.stringify({ active: baseActive, keys: (list.apiKeys ?? []).map((k) => [k.name, k.isActive]), clients: list.oauthClients }).slice(0, 400));
      s.check('the bench account has room for two more connections (this rider mints two keys before filling to the cap)', baseActive + 2 <= limit,
        `active ${baseActive} of ${limit}: revoke connections under Agents, Connected, before running this scenario (a community account cannot run it)`);

      // 2 — a key cannot mint a sibling.
      const sibling = parseMcp(await mcpCall(env, 'create_api_key', { name: `${PREFIX}sibling` }));
      s.check('a key cannot mint a sibling: JWT only', sibling.isError === true && /JWT authentication/.test(String(sibling.raw)), JSON.stringify(sibling).slice(0, 200));

      // 3 — mint A: the secret shows once, the row keeps the hash.
      const a = parseMcp(await asMe('create_api_key', { name: `${PREFIX}a`, expires_in_days: 30 }));
      s.check('mint A returns the key once, with its expiry',
        /^ns_live_[0-9a-f]{48}$/.test(a.apiKey ?? '') && !!a.keyId && a.name === `${PREFIX}a` && typeof a.expiresAt === 'string',
        JSON.stringify({ ...a, apiKey: a.apiKey ? 'ns_live_…' : a.apiKey }).slice(0, 300));
      if (!a.apiKey) throw new Error(`mint A failed: ${JSON.stringify(a).slice(0, 300)}`);
      const [rowA] = await db.select('mcp_api_keys', `id=eq.${a.keyId}&select=key_hash,key_prefix,user_id,last_used_at,revoked_at`);
      s.check('the row holds the hash and the prefix, never the plaintext, unused so far',
        rowA?.key_hash === sha256(a.apiKey) && rowA?.key_prefix === a.apiKey.slice(0, 16) && rowA?.user_id === session.userId && rowA?.last_used_at === null,
        JSON.stringify(rowA));

      // 4 — the minted key connects, and the first call stamps it used.
      const hello = await mcpRpc(env, { apiKey: a.apiKey }, 'tools/list', {});
      s.check('the minted key connects and sees the tools', hello.status === 200 && Array.isArray(hello.data?.result?.tools) && hello.data.result.tools.length > 40,
        `${hello.status} ${JSON.stringify(hello.data).slice(0, 200)}`);
      const [usedA] = await db.select('mcp_api_keys', `id=eq.${a.keyId}&select=last_used_at`);
      s.check('the first call stamps last_used_at (the tab\'s "used" line)', !!usedA?.last_used_at, JSON.stringify(usedA));
      list = parseMcp(await asMe('list_api_keys', {}));
      s.check('the list counts A, live and used',
        list.connections?.active === baseActive + 1 && (list.apiKeys ?? []).some((k) => k.keyId === a.keyId && k.isActive && !!k.lastUsedAt),
        JSON.stringify(list.connections));

      // 5 — two minted keys on one project: each is its own identity on the board.
      const fx = await createProject(env, session, 'v3conn');
      const t1 = uid();
      const t2 = uid();
      await db.insert('task_items', [
        { id: t1, project_id: fx.ids.project, node_id: fx.ids.nodeApi, task_key: 'c0a11e01', display_id: 'T1', title: 'Wire the API', done: false, orphaned: false, provenance: {} },
        { id: t2, project_id: fx.ids.project, node_id: fx.ids.nodeDb, task_key: 'c0a11e02', display_id: 'T2', title: 'Provision the store', done: false, orphaned: false, provenance: {} },
      ]);
      const b = parseMcp(await asMe('create_api_key', { name: `${PREFIX}b` }));
      s.check('mint B', /^ns_live_/.test(b.apiKey ?? ''), JSON.stringify(b).slice(0, 200));
      if (!b.apiKey) throw new Error(`mint B failed: ${JSON.stringify(b).slice(0, 300)}`);
      const holdA = parseMcp(await mcpCallAs(env, { apiKey: a.apiKey }, 'checkout_task', { project_id: fx.ids.project, task_item_id: t1, external_agent: 'bench · a' }));
      const holdB = parseMcp(await mcpCallAs(env, { apiKey: b.apiKey }, 'checkout_task', { project_id: fx.ids.project, task_item_id: t2, external_agent: 'bench · b' }));
      s.check('two minted keys hold two tasks', holdA.claimed === true && holdB.claimed === true, JSON.stringify({ holdA, holdB }).slice(0, 300));
      const contend = parseMcp(await mcpCallAs(env, { apiKey: b.apiKey }, 'checkout_task', { project_id: fx.ids.project, task_item_id: t1, external_agent: 'bench · b' }));
      s.check('B is told A holds T1', contend.claimed === false && contend.heldBy === 'bench · a', JSON.stringify(contend).slice(0, 300));
      const qb = parseMcp(await mcpCallAs(env, { apiKey: b.apiKey }, 'get_work_queue', { project_id: fx.ids.project }));
      const seenA = (qb.activeHolds ?? []).find((h) => h.refId === t1);
      const seenB = (qb.activeHolds ?? []).find((h) => h.refId === t2);
      s.check("the board tells the keys apart: A's hold is not B's and names A's key; B's is mine",
        seenA?.mine === false && seenA?.credential === `key · ${PREFIX}a` && seenB?.mine === true && seenB?.credential === `key · ${PREFIX}b`,
        JSON.stringify(qb.activeHolds).slice(0, 400));
      const leases = await db.select('agent_checkouts', `project_id=eq.${fx.ids.project}&released_at=is.null&select=holder_key_id,holder_delegate,task_item_id`);
      s.check('each lease names its own key in the database',
        leases.find((r) => r.task_item_id === t1)?.holder_key_id === a.keyId && leases.find((r) => r.task_item_id === t2)?.holder_delegate === `key:${b.keyId}`,
        JSON.stringify(leases));

      // 6 — one live name per person, case blind.
      const taken = parseMcp(await asMe('create_api_key', { name: `${PREFIX}A` }));
      s.check('a taken name is refused with the sentence, not the constraint',
        taken.isError === true && String(taken.raw).includes(`An agent named "${PREFIX}A" is already connected`) && /Agents, Connected/.test(String(taken.raw)) && !/duplicate key/.test(String(taken.raw)),
        JSON.stringify(taken).slice(0, 300));

      // 7 — the cap: fill to the allowance, the next is refused, nothing lands.
      list = parseMcp(await asMe('list_api_keys', {}));
      let n = 0;
      while ((list.connections?.active ?? Infinity) < limit && n < 6) {
        const k = parseMcp(await asMe('create_api_key', { name: `${PREFIX}fill-${n++}` }));
        if (!k.keyId) { s.check('filling to the allowance mints', false, JSON.stringify(k).slice(0, 300)); break; }
        list = parseMcp(await asMe('list_api_keys', {}));
      }
      s.check(`the person reaches the allowance (${limit} of ${limit})`, list.connections?.active === limit, JSON.stringify(list.connections));
      const over = parseMcp(await asMe('create_api_key', { name: `${PREFIX}one-too-many` }));
      s.check('the next mint is refused with the cap sentence', over.isError === true && capLineFor(limit).test(String(over.raw)), JSON.stringify(over).slice(0, 300));
      s.check('nothing was minted over the cap', (await db.select('mcp_api_keys', `user_id=eq.${session.userId}&name=eq.${PREFIX}one-too-many&select=id`)).length === 0);

      // 8 — the OAuth consent at the cap is turned away the OAuth way.
      const clientId = `${PREFIX}oauth-${stamp}`;
      const verifier = b64url(randomBytes(32));
      const challenge = b64url(createHash('sha256').update(verifier).digest());
      const denied = await authorize(env, session, clientId, challenge, 'st-1');
      s.check('a new OAuth client at the cap is redirected with access_denied, the sentence and the state, no code',
        denied.status === 302 && denied.error === 'access_denied' && capLineFor(limit).test(denied.description ?? '') && !denied.code && denied.state === 'st-1',
        JSON.stringify(denied).slice(0, 400));
      s.check('no authorization code was written for it', (await db.select('mcp_oauth_codes', `client_id=eq.${clientId}&select=id`)).length === 0);

      // 9 — revoke B, which holds T2: the hold ends, the key is refused, the count drops.
      const revokedB = parseMcp(await asMe('revoke_api_key', { key_id: b.keyId }));
      s.check('revoking B releases its hold and says so', revokedB.keyId === b.keyId && revokedB.leasesReleased === 1 && /released/.test(String(revokedB.message)), JSON.stringify(revokedB).slice(0, 300));
      const [leaseB] = await db.select('agent_checkouts', `task_item_id=eq.${t2}&select=released_at,released_reason`);
      s.check("B's lease ended as released, an audit row", leaseB?.released_reason === 'released' && !!leaseB?.released_at, JSON.stringify(leaseB));
      const bGone = await mcpRpc(env, { apiKey: b.apiKey }, 'initialize', {});
      s.check('the revoked key is 401 on its next call', bGone.status === 401 && bGone.data?.error === 'unauthorized',
        `${bGone.status} ${JSON.stringify(bGone.data).slice(0, 200)}`);
      list = parseMcp(await asMe('list_api_keys', {}));
      s.check('the count drops at once and B leaves the live list',
        list.connections?.active === limit - 1 && !(list.apiKeys ?? []).some((k) => k.keyId === b.keyId && k.isActive),
        JSON.stringify(list.connections));

      // 10 — with a slot free the consent is approved: code, token pair, connection, the list.
      const ok = await authorize(env, session, clientId, challenge, 'st-2');
      s.check('the same client is approved once a slot is free', ok.status === 302 && !!ok.code && ok.state === 'st-2' && !ok.error, JSON.stringify(ok).slice(0, 300));
      const tok = await tokenGrant(env, { grant_type: 'authorization_code', code: ok.code ?? '', code_verifier: verifier, redirect_uri: REDIRECT, client_id: clientId });
      s.check('the code exchanges for a token pair', tok.status === 200 && /^nst_/.test(tok.data?.access_token ?? '') && /^nsr_/.test(tok.data?.refresh_token ?? ''),
        `${tok.status} ${JSON.stringify({ ...tok.data, access_token: tok.data?.access_token ? 'nst_…' : undefined, refresh_token: tok.data?.refresh_token ? 'nsr_…' : undefined }).slice(0, 200)}`);
      const oauth = { accessToken: tok.data.access_token };
      const oauthHello = await mcpRpc(env, oauth, 'tools/list', {});
      s.check('the OAuth token connects', oauthHello.status === 200 && Array.isArray(oauthHello.data?.result?.tools), `${oauthHello.status} ${JSON.stringify(oauthHello.data).slice(0, 200)}`);
      list = parseMcp(await asMe('list_api_keys', {}));
      const client = (list.oauthClients ?? []).find((c) => c.clientId === clientId);
      s.check('the OAuth client sits in the same list and counts toward the allowance (back at the cap)',
        !!client && client.isActive === true && list.connections?.active === limit,
        JSON.stringify({ client, connections: list.connections }).slice(0, 300));

      // 11 — the client renewing its own connection is never counted against itself.
      const again = await authorize(env, session, clientId, challenge, 'st-3');
      s.check('re-authorizing the same client at the cap is approved', again.status === 302 && !!again.code && !again.error, JSON.stringify(again).slice(0, 300));
      const stranger = await authorize(env, session, `${PREFIX}oauth-stranger-${stamp}`, challenge, 'st-4');
      s.check('a different new client at the cap is still turned away', stranger.status === 302 && stranger.error === 'access_denied', JSON.stringify(stranger).slice(0, 300));

      // 12 — the OAuth client holds a task and is its own identity on the board.
      const holdO = parseMcp(await mcpCallAs(env, oauth, 'checkout_task', { project_id: fx.ids.project, task_item_id: t2, external_agent: 'bench · oauth' }));
      s.check('the OAuth client holds the task B released', holdO.claimed === true, JSON.stringify(holdO).slice(0, 300));
      const qa = parseMcp(await mcpCallAs(env, { apiKey: a.apiKey }, 'get_work_queue', { project_id: fx.ids.project }));
      const seenO = (qa.activeHolds ?? []).find((h) => h.refId === t2);
      s.check("A sees the OAuth hold as not mine, with the client's credential", seenO?.mine === false && seenO?.credential === `oauth · ${clientId}`, JSON.stringify(qa.activeHolds).slice(0, 400));

      // 13 — revoke the client by client_id: tokens, refresh and hold all end.
      const revokedO = parseMcp(await asMe('revoke_api_key', { client_id: clientId }));
      s.check('revoking the client ends its tokens and its hold', revokedO.clientId === clientId && revokedO.tokensRevoked >= 1 && revokedO.leasesReleased === 1, JSON.stringify(revokedO).slice(0, 300));
      const oGone = await mcpRpc(env, oauth, 'initialize', {});
      s.check('the OAuth token is 401 afterwards', oGone.status === 401, `${oGone.status} ${JSON.stringify(oGone.data).slice(0, 200)}`);
      const ref = await tokenGrant(env, { grant_type: 'refresh_token', refresh_token: tok.data.refresh_token ?? '' });
      s.check('its refresh token is refused too: the family died', ref.status === 400 && ref.data?.error === 'invalid_grant', `${ref.status} ${JSON.stringify(ref.data).slice(0, 200)}`);
      const liveOnT2 = (await db.select('agent_checkouts', `task_item_id=eq.${t2}&released_at=is.null&select=id`)).length;
      s.check("the client's hold is gone from the live board", liveOnT2 === 0, `live holds on T2: ${liveOnT2}`);
      list = parseMcp(await asMe('list_api_keys', {}));
      s.check('the client leaves the list and the count', !(list.oauthClients ?? []).some((c) => c.clientId === clientId) && list.connections?.active === limit - 1, JSON.stringify(list.connections));

      // 14 — one person never sees another: a fresh real account.
      const email = `${PREFIX}${stamp}@nodespec.test`;
      const password = `Bench-${uid()}`;
      other = { id: await adminCreateUser(env, email, password) };
      const otherSession = await signInAs(env, email, password);
      const asOther = (tool, args) => mcpCallAs(env, { accessToken: otherSession.accessToken }, tool, args);
      const otherList = parseMcp(await asOther('list_api_keys', {}));
      const otherLimit = otherList.connections?.limit;
      s.check('a fresh account starts with nothing connected and its own allowance',
        otherList.connections?.active === 0 && (otherList.apiKeys ?? []).length === 0 && (otherLimit === 1 || otherLimit === 5),
        JSON.stringify(otherList.connections ?? otherList).slice(0, 300));
      const otherKeys = [];
      for (let i = 0; i < (otherLimit ?? 0); i++) {
        const k = parseMcp(await asOther('create_api_key', { name: `${PREFIX}other-${i}` }));
        if (k.keyId) otherKeys.push(k);
      }
      s.check(`the other person mints up to their own allowance (${otherLimit})`, otherKeys.length === otherLimit, `minted ${otherKeys.length}`);
      const otherOver = parseMcp(await asOther('create_api_key', { name: `${PREFIX}other-over` }));
      s.check("and is refused at it, in their plan's words", otherOver.isError === true && capLineFor(otherLimit).test(String(otherOver.raw)), JSON.stringify(otherOver).slice(0, 300));
      const otherAfter = parseMcp(await asOther('list_api_keys', {}));
      s.check("the other person's list never shows the bench account's keys",
        !(otherAfter.apiKeys ?? []).some((k) => k.keyId === a.keyId) && otherAfter.connections?.active === otherLimit,
        JSON.stringify(otherAfter.apiKeys?.map((k) => k.name)));
      const foreign = parseMcp(await asOther('revoke_api_key', { key_id: a.keyId }));
      s.check("the other person cannot revoke the bench account's key", foreign.isError === true && /not found or access denied/.test(String(foreign.raw)), JSON.stringify(foreign).slice(0, 200));
      const [stillA] = await db.select('mcp_api_keys', `id=eq.${a.keyId}&select=revoked_at`);
      s.check('A stands', stillA?.revoked_at === null, JSON.stringify(stillA));
      const otherRevoke = parseMcp(await asOther('revoke_api_key', { key_id: otherKeys[0]?.keyId }));
      const sameName = parseMcp(await asOther('create_api_key', { name: `${PREFIX}a` }));
      s.check('a name is unique per person, not per stack: the other person may also call an agent bench-conn-a',
        otherRevoke.keyId === otherKeys[0]?.keyId && !!sameName.keyId, JSON.stringify({ otherRevoke, sameName: { ...sameName, apiKey: undefined } }).slice(0, 300));

      // 15 — the key the bench connects with was never touched.
      const seededOk = await mcpRpc(env, { apiKey: env.MCP_API_KEY }, 'ping', {});
      s.check('the seeded bench key still connects', seededOk.status === 200, `${seededOk.status}`);
    } finally {
      await sweep(db, session.userId, 'revoke').catch((e) => s.check('cleanup revoked what this run minted', false, String(e)));
      if (other) await adminDeleteUser(env, other.id);
    }
    return { s };
  },
};

export default [connections];

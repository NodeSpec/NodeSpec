// Two agents through the front door (2026-09-21). Nothing in the suite drove
// the MCP server's HTTP router as a connecting client, and no test held two
// distinct credentials against one project. This file does both: the real
// router (mcp-server/server.ts: sub-path, discovery, authentication, the
// 401/405/400 contracts, JSON-RPC and the legacy body) with the real
// transport, dispatch, membership gate and tool handlers, over a
// MemorySupabase whose rows remember. Two API keys under the owner (agent A
// and agent B), a read-only key, a revoked key, a contributor's key and a
// viewer's session each connect; the lease board tells them apart by
// credential; a hold is refused to the second agent while fresh and taken
// over once silent; heartbeat and release touch only live rows.
//
// The two SQL functions the router leans on are modelled here after the
// migrations, and PROVEN on real Postgres by the lane: 050_agent_checkouts
// (agent_checkout_claim) and 051_mcp_api_keys (validate_mcp_api_key).
import { handleRequest, getSubPath } from '../mcp-server/server.ts';
import { MCP_TOOLS } from '../mcp-server/tool-registry.ts';
import { TOOL_FEATURE } from '../mcp-server/tool-surface.ts';
import { sha256Hex } from '../mcp-server/shared.ts';
import { MemorySupabase, assert, assertEquals, type Row } from './helpers.ts';

Deno.env.set('SUPABASE_URL', 'https://x.supabase.co');
const BASE = 'https://x.supabase.co/functions/v1/mcp-server';

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const VIEWER = 'user-viewer';
const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Living Cascade', owner_id: OWNER };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N1 = '33333333-3333-4333-8333-333333333331';
const N2 = '33333333-3333-4333-8333-333333333332';
const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const T2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const KEYS = {
  a: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', secret: 'ns_live_agent_a_secret', user_id: OWNER, name: 'agent a', scopes: ['read', 'write', 'propose'] },
  b: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', secret: 'ns_live_agent_b_secret', user_id: OWNER, name: 'agent b', scopes: ['read', 'write', 'propose'] },
  reader: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', secret: 'ns_live_reader_secret', user_id: OWNER, name: 'reader', scopes: ['read'] },
  revoked: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', secret: 'ns_live_revoked_secret', user_id: OWNER, name: 'old', scopes: ['read', 'write'], revoked_at: '2026-01-01T00:00:00Z' },
  member: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5', secret: 'ns_live_member_secret', user_id: MEMBER, name: 'member key', scopes: ['read', 'write', 'propose'] },
};
const VIEWER_JWT = 'eyJ.viewer.session';
const PAID_TOOLS = Object.keys(TOOL_FEATURE);
const INDIE_ROW = { user_id: OWNER, plan_name: 'Indie Monthly', status: 'active', current_period_end: '2027-01-01T00:00:00Z' };
const OWNER_JWT = 'eyJ.owner.session';

async function world(): Promise<MemorySupabase> {
  const sb = new MemorySupabase();
  sb.table('projects', [{ ...PROJECT }]);
  sb.table('project_members', [
    { project_id: PROJECT.id, user_id: MEMBER, role: 'contributor', clearance: [] },
    { project_id: PROJECT.id, user_id: VIEWER, role: 'viewer', clearance: [] },
  ]);
  sb.table('branches', [{ id: BRANCH, project_id: PROJECT.id, name: 'main', is_primary: true }]);
  sb.table('task_items', [
    { id: T1, project_id: PROJECT.id, node_id: N1, task_key: 't1', display_id: 'T1', title: 'Pour the pool', done: false, orphaned: false, mark: null },
    { id: T2, project_id: PROJECT.id, node_id: N2, task_key: 't2', display_id: 'T2', title: 'Cut the bank exit', done: false, orphaned: false, mark: null },
  ]);
  sb.table('work_plans', [{ id: 'plan-1', project_id: PROJECT.id, branch_id: BRANCH, status: 'accepted' }]);
  sb.table('work_plan_items', [
    { id: 'pi-1', plan_id: 'plan-1', item_kind: 'task', node_id: N1, item_key: 't1', rank: 0 },
    { id: 'pi-2', plan_id: 'plan-1', item_kind: 'task', node_id: N2, item_key: 't2', rank: 1 },
  ]);
  sb.table('agent_checkouts', []);
  sb.unique('agent_checkouts', ['task_item_id'], { name: 'idx_agent_checkouts_task_active', where: (r) => r.level === 'task' && r.released_at == null });
  sb.table('graph_patches', []);
  sb.table('specification_requirements', []);
  sb.table('requirement_candidates', []);
  sb.table('artifacts', []);
  sb.table('mcp_oauth_tokens', []);
  sb.table('stripe_subscriptions', []);
  const keys: Row[] = [];
  for (const k of Object.values(KEYS)) keys.push({ id: k.id, user_id: k.user_id, name: k.name, key_hash: await sha256Hex(k.secret), key_prefix: k.secret.slice(0, 12), scopes: k.scopes, expires_at: null, revoked_at: (k as { revoked_at?: string }).revoked_at ?? null, last_used_at: null });
  sb.table('mcp_api_keys', keys);
  // I.1: one live key per name per person (migration 20260921130000, lane 065 proves the SQL)
  sb.unique('mcp_api_keys', ['user_id', 'name'], { name: 'idx_mcp_api_keys_active_name', where: (r) => r.revoked_at == null });
  sb.jwt(VIEWER_JWT, { id: VIEWER, email: 'viewer@bench.local' });
  sb.jwt(OWNER_JWT, { id: OWNER, email: 'owner@bench.local' });

  // agent_connection_count, as migration 20260921130000 answers (lane 065 proves the SQL)
  sb.fn('agent_connection_count', (p, db) => {
    const now = Date.now();
    const keysLive = db.rowsOf('mcp_api_keys').filter((k) => k.user_id === p.p_user_id && k.revoked_at == null && (!k.expires_at || new Date(String(k.expires_at)).getTime() > now)).length;
    const clients = new Set(db.rowsOf('mcp_oauth_tokens')
      .filter((t) => t.user_id === p.p_user_id && t.revoked_at == null && new Date(String(t.refresh_expires_at ?? t.expires_at)).getTime() > now && (p.p_except_client_id == null || t.client_id !== p.p_except_client_id))
      .map((t) => t.client_id));
    return keysLive + clients.size;
  });

  // validate_mcp_api_key, as migration 20260330222120 answers (lane 051 proves the SQL)
  sb.fn('validate_mcp_api_key', (p, db) => {
    const k = db.rowsOf('mcp_api_keys').find((r) => r.key_hash === p.p_key_hash);
    if (!k) return [{ user_id: null, key_id: null, scopes: null, is_valid: false, rejection_reason: 'Invalid API key', key_name: null }];
    if (k.revoked_at) return [{ user_id: k.user_id, key_id: k.id, scopes: k.scopes, is_valid: false, rejection_reason: 'API key has been revoked', key_name: k.name }];
    if (k.expires_at && new Date(String(k.expires_at)) < new Date()) return [{ user_id: k.user_id, key_id: k.id, scopes: k.scopes, is_valid: false, rejection_reason: 'API key has expired', key_name: k.name }];
    k.last_used_at = new Date().toISOString();
    // O.2 (migration 20260922100000): the key's name rides the answer
    return [{ user_id: k.user_id, key_id: k.id, scopes: k.scopes, is_valid: true, rejection_reason: null, key_name: k.name }];
  });
  // agent_checkout_claim, as migration 20260916100000 answers (lane 050 proves the SQL)
  sb.fn('agent_checkout_claim', (p, db) => {
    const rows = db.rowsOf('agent_checkouts');
    const level = String(p.p_level);
    const ref = String(p.p_ref_id);
    let reclaimedFrom: string | null = null;
    if (['task', 'code', 'criterion'].includes(level)) {
      const col = level === 'task' ? 'task_item_id' : level === 'code' ? 'artifact_id' : 'requirement_id';
      const existing = rows.find((r) => r.released_at == null && r.level === level && r[col] === ref && (level !== 'criterion' || r.criterion_id === p.p_criterion_id));
      if (existing) {
        const staleAfter = Math.max(Number(p.p_stale_after_minutes ?? 30), 1);
        const stale = new Date(String(existing.heartbeat_at)).getTime() < Date.now() - staleAfter * 60_000;
        if (!stale) return { claimed: false, heldBy: existing.holder_label, holderKind: existing.holder_kind, since: existing.since, heartbeatAt: existing.heartbeat_at, stale: false };
        existing.released_at = new Date().toISOString();
        existing.released_reason = 'reclaimed';
        reclaimedFrom = String(existing.id);
      }
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    rows.push({
      id, project_id: p.p_project_id, branch_id: p.p_branch_id ?? null, level, holder_kind: p.p_holder_kind, holder_label: p.p_holder_label,
      holder_key_id: p.p_holder_key_id ?? null, holder_delegate: p.p_holder_delegate ?? (p.p_holder_key_id ? `key:${p.p_holder_key_id}` : null),
      task_item_id: level === 'task' ? ref : null, artifact_id: level === 'code' ? ref : null,
      requirement_id: level === 'requirement' || level === 'criterion' ? ref : null, candidate_id: level === 'outcome' ? ref : null,
      criterion_id: level === 'criterion' ? p.p_criterion_id : null, proposal_id: p.p_proposal_id ?? null, meta: p.p_meta ?? {},
      since: now, heartbeat_at: now, released_at: null, released_reason: null,
    });
    return { claimed: true, checkoutId: id, advisory: level === 'requirement' || level === 'outcome', reclaimedFrom };
  });
  return sb;
}

// ── the wire ──
type Headers_ = Record<string, string>;
const post = (auth: Headers_, body: unknown, extra: Headers_ = {}) =>
  new Request(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth, ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const asKey = (secret: string): Headers_ => ({ 'X-MCP-API-Key': secret });
const asJwt = (token: string): Headers_ => ({ Authorization: `Bearer ${token}` });
let nextId = 1;
const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) });

/** tools/call over JSON-RPC, decoded the way an MCP client reads it. */
async function call(sb: MemorySupabase, auth: Headers_, tool: string, args: Record<string, unknown>) {
  const res = await handleRequest(post(auth, rpc('tools/call', { name: tool, arguments: args })), sb as never);
  const body = await res.json();
  const text: string = body.result?.content?.[0]?.text ?? '';
  const isError = body.result?.isError === true;
  // deno-lint-ignore no-explicit-any
  const data: any = !isError && text ? JSON.parse(text) : null;
  return { status: res.status, body, text, isError, data };
}
const activeHolds = (sb: MemorySupabase) => sb.rowsOf('agent_checkouts').filter((r) => r.released_at == null);

Deno.test('the door: discovery is open, everything else needs a credential; a bad, revoked or missing key is 401 with the OAuth pointer; GET is 405; a torn body is 400', async () => {
  const sb = await world();
  const discovery = await handleRequest(new Request(BASE, { method: 'GET' }), sb as never);
  assertEquals(discovery.status, 200);
  const doc = await discovery.json();
  assertEquals(doc.data.authentication.apiKeyHeader, 'X-MCP-API-Key');
  // Q: no credential means no plan, so discovery shows the Community list
  assertEquals(doc.data.tools.length, MCP_TOOLS.length - PAID_TOOLS.length);
  for (const t of PAID_TOOLS) assert(!doc.data.tools.some((d: { name: string }) => d.name === t), `discovery lists ${t}`);

  for (const [name, headers] of [['no credential', {}], ['unknown key', asKey('ns_live_nobody')], ['revoked key', asKey(KEYS.revoked.secret)], ['unknown session', asJwt('eyJ.nobody')]] as Array<[string, Headers_]>) {
    const res = await handleRequest(post(headers, rpc('initialize')), sb as never);
    assertEquals(res.status, 401, name);
    assertEquals(res.headers.get('WWW-Authenticate'), `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`, name);
    assertEquals((await res.json()).error, 'unauthorized', name);
  }
  assertEquals(activeHolds(sb).length, 0, 'a refused connection wrote nothing');

  const get = await handleRequest(new Request(BASE, { method: 'GET', headers: asKey(KEYS.a.secret) }), sb as never);
  assertEquals(get.status, 200, 'GET with a key is still the discovery document');
  const put = await handleRequest(new Request(BASE, { method: 'PUT', headers: asKey(KEYS.a.secret) }), sb as never);
  assertEquals(put.status, 405);
  const torn = await handleRequest(post(asKey(KEYS.a.secret), '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"propose_patches","arguments":{"patches":[{"ty'), sb as never);
  assertEquals(torn.status, 400);
  const tornBody = await torn.json();
  assert(String(tornBody.error).includes('truncated in transit'), tornBody.error);
  assert(String(tornBody.error).includes('nothing was received or stored'), tornBody.error);
});

Deno.test('the protocol: initialize, session id, tools/list, ping, batch, notification, unknown method and unknown tool', async () => {
  const sb = await world();
  const init = await handleRequest(post(asKey(KEYS.a.secret), rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } })), sb as never);
  assertEquals(init.status, 200);
  const initBody = await init.json();
  assertEquals(initBody.result.protocolVersion, '2025-03-26');
  assertEquals(initBody.result.serverInfo.name, 'nodespec-mcp-server');
  assert(/^[0-9a-f]{32}$/.test(init.headers.get('Mcp-Session-Id') ?? ''), 'a session id is minted');
  const echoed = await handleRequest(post(asKey(KEYS.a.secret), rpc('ping'), { 'mcp-session-id': 'sess-42' }), sb as never);
  assertEquals(echoed.headers.get('Mcp-Session-Id'), 'sess-42', 'the client session id is echoed');

  // Q: the list is the caller's plan. This world has no subscription row,
  // so it resolves to Community: the paid tools are absent, not refused later.
  const list = await (await handleRequest(post(asKey(KEYS.a.secret), rpc('tools/list')), sb as never)).json();
  assertEquals(list.result.tools.length, MCP_TOOLS.length - PAID_TOOLS.length);
  assert(list.result.tools.some((t: { name: string }) => t.name === 'checkout_task'));
  for (const t of PAID_TOOLS) assert(!list.result.tools.some((d: { name: string }) => d.name === t), `community lists ${t}`);

  const batch = await handleRequest(post(asKey(KEYS.a.secret), [rpc('ping'), rpc('initialize')]), sb as never);
  assertEquals(batch.status, 200);
  assertEquals((await batch.json()).length, 2);
  const note = await handleRequest(post(asKey(KEYS.a.secret), { jsonrpc: '2.0', method: 'notifications/initialized' }), sb as never);
  assertEquals(note.status, 202);

  const unknown = await (await handleRequest(post(asKey(KEYS.a.secret), rpc('resources/list')), sb as never)).json();
  assertEquals(unknown.error.code, -32601);
  const typo = await (await handleRequest(post(asKey(KEYS.a.secret), rpc('tools/call', { name: 'checkout_tsk', arguments: {} })), sb as never)).json();
  assertEquals(typo.error.code, -32602);
  assert(String(typo.error.message).includes('checkout_task'), 'the nearest tool is named');
  // a typo near a hidden tool never names it
  const nearHidden = await (await handleRequest(post(asKey(KEYS.a.secret), rpc('tools/call', { name: 'get_work_pln', arguments: {} })), sb as never)).json();
  assert(!String(nearHidden.error.message).includes('get_work_plan'), nearHidden.error.message);

  // the legacy body works with a key too
  const legacy = await handleRequest(post(asKey(KEYS.a.secret), { tool: 'get_work_queue', arguments: { project_id: PROJECT.id } }), sb as never);
  assertEquals(legacy.status, 200);
  assertEquals((await legacy.json()).success, true);
});

Deno.test('two agents, one task: the first holds, the second is told who; the board marks each hold mine only for its own credential', async () => {
  const sb = await world();
  const a = await call(sb, asKey(KEYS.a.secret), 'checkout_task', { project_id: PROJECT.id, task_item_id: T1, external_agent: 'agent-a' });
  assertEquals(a.status, 200, a.text);
  assertEquals(a.isError, false, a.text);
  assertEquals(a.data.claimed, true);
  const holdA = activeHolds(sb)[0];
  assertEquals(holdA.holder_kind, 'agent');
  assertEquals(holdA.holder_label, 'agent-a');
  assertEquals(holdA.holder_key_id, KEYS.a.id);
  assertEquals(holdA.holder_delegate, `key:${KEYS.a.id}`);
  assertEquals(sb.rowsOf('mcp_api_keys').find((k) => k.id === KEYS.a.id)!.last_used_at !== null, true, 'the connecting key is stamped');

  const b = await call(sb, asKey(KEYS.b.secret), 'checkout_task', { project_id: PROJECT.id, task_item_id: T1, external_agent: 'agent-b' });
  assertEquals(b.isError, false, b.text);
  assertEquals(b.data.claimed, false);
  assertEquals(b.data.heldBy, 'agent-a');
  assert(String(b.data.message).includes('stale'), 'the answer teaches the staleness rule');
  assertEquals(activeHolds(sb).length, 1, 'the refusal wrote no hold');

  // the queue as B sees it: T1 held by A, not mine, with A's credential named
  // (on Indie, so the accepted plan pins the order)
  sb.rowsOf('stripe_subscriptions').push({ ...INDIE_ROW });
  const qb = await call(sb, asKey(KEYS.b.secret), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(qb.isError, false, qb.text);
  assertEquals(qb.data.source, 'accepted-plan');
  assertEquals(qb.data.queue.map((q: { displayId: string }) => q.displayId), ['T1', 'T2']);
  assertEquals(qb.data.queue[0].heldBy, 'agent-a');
  assertEquals(qb.data.queue[0].holdStale, false);
  assertEquals(qb.data.queue[1].heldBy, undefined);
  assertEquals(qb.data.activeHolds.length, 1);
  assertEquals(qb.data.activeHolds[0].mine, false);
  assertEquals(qb.data.activeHolds[0].holder, 'agent-a');
  assertEquals(qb.data.activeHolds[0].credential, 'key · agent a');
  assertEquals(qb.data.activeHolds[0].refLabel, 'T1 · Pour the pool');
  assertEquals(qb.data.activeHolds[0].nodeId, N1);
  // and as A sees it: mine
  const qa = await call(sb, asKey(KEYS.a.secret), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(qa.data.activeHolds[0].mine, true);

  // B takes the other task; both agents now hold, each marked by its own key
  const b2 = await call(sb, asKey(KEYS.b.secret), 'checkout_task', { project_id: PROJECT.id, node_id: N2, task_key: 't2', external_agent: 'agent-b' });
  assertEquals(b2.data.claimed, true, b2.text);
  assertEquals(b2.data.refId, T2);
  const qa2 = await call(sb, asKey(KEYS.a.secret), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(qa2.data.activeHolds.map((h: { holder: string; mine: boolean }) => [h.holder, h.mine]).sort(), [['agent-a', true], ['agent-b', false]]);
});

Deno.test('a silent hold is taken over on the wire; heartbeat and release touch only live rows', async () => {
  const sb = await world();
  const a = await call(sb, asKey(KEYS.a.secret), 'checkout_task', { project_id: PROJECT.id, task_item_id: T1, external_agent: 'agent-a' });
  const holdA = activeHolds(sb)[0];
  holdA.heartbeat_at = new Date(Date.now() - 31 * 60_000).toISOString();

  const stale = await call(sb, asKey(KEYS.b.secret), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(stale.data.queue[0].holdStale, true);
  assertEquals(stale.data.activeHolds[0].stale, true);

  const b = await call(sb, asKey(KEYS.b.secret), 'checkout_task', { project_id: PROJECT.id, task_item_id: T1, external_agent: 'agent-b' });
  assertEquals(b.data.claimed, true, b.text);
  assertEquals(b.data.reclaimedFrom, a.data.checkoutId);
  assertEquals(holdA.released_reason, 'reclaimed');
  assertEquals(activeHolds(sb).length, 1);
  assertEquals(activeHolds(sb)[0].holder_label, 'agent-b');

  // A's heartbeat on its reclaimed lease finds nothing
  const beat = await call(sb, asKey(KEYS.a.secret), 'checkout_heartbeat', { project_id: PROJECT.id, checkout_id: a.data.checkoutId });
  assertEquals(beat.isError, true);
  assert(beat.text.includes('released or reclaimed'), beat.text);
  // B's heartbeat lands
  const beatB = await call(sb, asKey(KEYS.b.secret), 'checkout_heartbeat', { project_id: PROJECT.id, checkout_id: b.data.checkoutId, meta: { tests: ['pool.spec'] } });
  assertEquals(beatB.isError, false, beatB.text);
  assertEquals((activeHolds(sb)[0].meta as { tests: string[] }).tests, ['pool.spec']);
  // release: a wrong reason is refused; the live hold releases once
  const badReason = await call(sb, asKey(KEYS.b.secret), 'release_checkout', { project_id: PROJECT.id, checkout_id: b.data.checkoutId, reason: 'done' });
  assertEquals(badReason.isError, true);
  // AA.5: releasing hands the work on, so it says where the work stands
  const bare = await call(sb, asKey(KEYS.b.secret), 'release_checkout', { project_id: PROJECT.id, checkout_id: b.data.checkoutId, reason: 'released' });
  assertEquals(bare.isError, true);
  assert(bare.text.includes('say where it stands in note'), bare.text);
  const rel = await call(sb, asKey(KEYS.b.secret), 'release_checkout', { project_id: PROJECT.id, checkout_id: b.data.checkoutId, reason: 'released', note: 'Pool fills; the drain is next.' });
  assertEquals(rel.isError, false, rel.text);
  assertEquals(rel.data.released, true);
  assertEquals(activeHolds(sb).length, 0);
  const relAgain = await call(sb, asKey(KEYS.b.secret), 'release_checkout', { project_id: PROJECT.id, checkout_id: b.data.checkoutId });
  assertEquals(relAgain.isError, true);
  assert(relAgain.text.includes('No active checkout'), relAgain.text);
});

Deno.test('seats and scopes at the door: a read-only key cannot claim, a viewer\'s session cannot claim, a contributor\'s key can and is its own identity', async () => {
  const sb = await world();
  // seats are Team and above (decision 1): the owner is on Team
  sb.rowsOf('stripe_subscriptions').push({ user_id: OWNER, plan_name: 'team', status: 'active', current_period_end: '2099-01-01T00:00:00Z' });
  const reader = await call(sb, asKey(KEYS.reader.secret), 'checkout_task', { project_id: PROJECT.id, task_item_id: T1 });
  assertEquals(reader.isError, true);
  assert(reader.text.includes('insufficient scope'), reader.text);
  const readerLegacy = await handleRequest(post(asKey(KEYS.reader.secret), { tool: 'checkout_task', arguments: { project_id: PROJECT.id, task_item_id: T1 } }), sb as never);
  assertEquals(readerLegacy.status, 400);
  assert(String((await readerLegacy.json()).error).includes('write scope'), 'the legacy body refuses the same way');
  const readerReads = await call(sb, asKey(KEYS.reader.secret), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(readerReads.isError, false, readerReads.text);

  const viewer = await call(sb, asJwt(VIEWER_JWT), 'checkout_task', { project_id: PROJECT.id, task_item_id: T1 });
  assertEquals(viewer.isError, true);
  assert(/viewer/.test(viewer.text) && /contributor/.test(viewer.text), viewer.text);
  assertEquals(activeHolds(sb).length, 0, 'nothing was claimed by a refused seat');

  const member = await call(sb, asKey(KEYS.member.secret), 'checkout_task', { project_id: PROJECT.id, task_item_id: T1, external_agent: 'member-agent' });
  assertEquals(member.isError, false, member.text);
  assertEquals(member.data.claimed, true);
  const hold = activeHolds(sb)[0];
  assertEquals(hold.holder_key_id, KEYS.member.id);
  assertEquals(hold.holder_delegate, `key:${KEYS.member.id}`);
  const seen = await call(sb, asKey(KEYS.a.secret), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(seen.data.activeHolds[0].credential, 'key · member key');
  assertEquals(seen.data.activeHolds[0].mine, false);
  const own = await call(sb, asKey(KEYS.member.secret), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(own.data.activeHolds[0].mine, true);
  // the owner's other agent is refused the held task by name, across accounts
  const a = await call(sb, asKey(KEYS.a.secret), 'checkout_task', { project_id: PROJECT.id, task_item_id: T1, external_agent: 'agent-a' });
  assertEquals(a.data.claimed, false);
  assertEquals(a.data.heldBy, 'member-agent');
});

Deno.test('connecting agents through the front door: the plan counts what is live, a minted key connects, a taken name is refused, a revoke ends the key and its holds', async () => {
  const sb = await world();
  // The owner already holds three live keys (a, b, reader; the revoked one
  // is free). On community the allowance is one: nothing more connects.
  const capped = await call(sb, asJwt(OWNER_JWT), 'create_api_key', { name: 'hermes' });
  assertEquals(capped.status, 200);
  assertEquals(capped.isError, true, capped.text);
  assert(capped.text.includes('Your plan includes one connected agent, and it is in use'), capped.text);
  assertEquals(sb.rowsOf('mcp_api_keys').length, 5, 'nothing was minted');

  // Indie: five per person. Three live, so two more connect, the sixth does not.
  sb.rowsOf('stripe_subscriptions').push({ user_id: OWNER, plan_name: 'Indie Monthly', status: 'active', current_period_end: '2027-01-01T00:00:00Z' });
  const hermes = await call(sb, asJwt(OWNER_JWT), 'create_api_key', { name: 'hermes' });
  assertEquals(hermes.isError, false, hermes.text);
  assert(/^ns_live_[0-9a-f]{48}$/.test(hermes.data.apiKey), 'the secret is returned once');
  assertEquals(hermes.data.name, 'hermes');

  // the minted key connects and is its own identity on the board
  const hold = await call(sb, asKey(hermes.data.apiKey), 'checkout_task', { project_id: PROJECT.id, task_item_id: T2, external_agent: 'hermes' });
  assertEquals(hold.isError, false, hold.text);
  assertEquals(hold.data.claimed, true);
  assertEquals(activeHolds(sb)[0].holder_key_id, hermes.data.keyId);

  // a key cannot mint a sibling
  const sibling = await call(sb, asKey(hermes.data.apiKey), 'create_api_key', { name: 'hermes-2' });
  assertEquals(sibling.isError, true);
  assert(sibling.text.includes('JWT authentication'), sibling.text);

  // one live name per person: the taken name is refused with the sentence
  const taken = await call(sb, asJwt(OWNER_JWT), 'create_api_key', { name: 'hermes' });
  assertEquals(taken.isError, true);
  assert(taken.text.includes('An agent named "hermes" is already connected'), taken.text);

  const fifth = await call(sb, asJwt(OWNER_JWT), 'create_api_key', { name: 'codex' });
  assertEquals(fifth.isError, false, fifth.text);
  const sixth = await call(sb, asJwt(OWNER_JWT), 'create_api_key', { name: 'one too many' });
  assertEquals(sixth.isError, true);
  assert(sixth.text.includes('Indie connects up to five agents per person, and yours are all in use'), sixth.text);

  // the list is the truth on both lanes: five live keys, no OAuth client, five of five
  const listed = await call(sb, asJwt(OWNER_JWT), 'list_api_keys', {});
  assertEquals(listed.isError, false, listed.text);
  assertEquals(listed.data.apiKeys.filter((k: { isActive: boolean }) => k.isActive).length, 5);
  assertEquals(listed.data.oauthClients, []);
  assertEquals(listed.data.connections, { active: 5, limit: 5, tier: 'indie', allowance: 'Indie connects up to five agents per person.' });
  // the member's key is not in the owner's list
  assertEquals(listed.data.apiKeys.some((k: { keyId: string }) => k.keyId === KEYS.member.id), false);

  // a viewer's session may list its own (empty) connections, never the owner's
  const viewerList = await call(sb, asJwt(VIEWER_JWT), 'list_api_keys', {});
  assertEquals(viewerList.isError, false, viewerList.text);
  assertEquals(viewerList.data.apiKeys, []);

  // revoking hermes ends its hold, frees the name, and the key is 401 on the next call
  const revoked = await call(sb, asJwt(OWNER_JWT), 'revoke_api_key', { key_id: hermes.data.keyId });
  assertEquals(revoked.isError, false, revoked.text);
  assertEquals(revoked.data.leasesReleased, 1);
  assertEquals(activeHolds(sb).length, 0);
  assertEquals(sb.rowsOf('agent_checkouts')[0].released_reason, 'released');
  const gone = await handleRequest(post(asKey(hermes.data.apiKey), rpc('initialize')), sb as never);
  assertEquals(gone.status, 401);
  const again = await call(sb, asJwt(OWNER_JWT), 'create_api_key', { name: 'hermes' });
  assertEquals(again.isError, false, again.text);

  // the member cannot revoke the owner's key
  const memberJwt = 'eyJ.member.session';
  sb.jwt(memberJwt, { id: MEMBER, email: 'member@bench.local' });
  const foreign = await call(sb, asJwt(memberJwt), 'revoke_api_key', { key_id: fifth.data.keyId });
  assertEquals(foreign.isError, true);
  assert(foreign.text.includes('not found or access denied'), foreign.text);
  assertEquals(sb.rowsOf('mcp_api_keys').find((k) => k.id === fifth.data.keyId)!.revoked_at ?? null, null, 'the owner\'s key stands');
});

Deno.test('getSubPath: the _path override, the gateway prefix, the internal prefix, the trailing slash', () => {
  const at = (u: string) => getSubPath(new Request(u));
  assertEquals(at('https://x.supabase.co/functions/v1/mcp-server/authorize'), '/authorize');
  assertEquals(at('https://x.supabase.co/functions/v1/mcp-server'), '');
  assertEquals(at('https://x.supabase.co/functions/v1/mcp-server?_path=token'), '/token');
  assertEquals(at('https://x.supabase.co/functions/v1/mcp-server?_path=/register'), '/register');
  assertEquals(at('http://localhost:9000/mcp-server/token'), '/token');
  assertEquals(at('http://localhost:9000/mcp-server/'), '');
  assertEquals(at('http://localhost:9000/mcp-server'), '');
});

Deno.test('Q: a Free account sees and uses only its plan, on both doors; an upgrade shows the rest', async () => {
  const sb = await world();
  const list = async () => (await (await handleRequest(post(asKey(KEYS.a.secret), rpc('tools/list')), sb as never)).json()).result.tools as Array<{ name: string; description: string }>;

  // Community: the paid tools are not listed and no open tool describes them
  const free = await list();
  for (const t of PAID_TOOLS) assert(!free.some((d) => d.name === t), `community lists ${t}`);
  assert(!free.find((d) => d.name === 'propose_patches')!.description.includes('place_on_step'), 'propose_patches names place_on_step');
  assert(!free.find((d) => d.name === 'get_work_queue')!.description.includes('get_work_plan'), 'get_work_queue names get_work_plan');

  // a call anyway is refused by plan, over JSON-RPC and over the legacy body
  const refused = await call(sb, asKey(KEYS.a.secret), 'get_work_plan', { project_id: PROJECT.id });
  assertEquals(refused.isError, true, refused.text);
  assert(refused.text.includes('get_work_plan is available on Indie and above; this account resolves to the Community tier.'), refused.text);
  assert(refused.text.includes('reconnect the NodeSpec MCP server'), refused.text);
  const legacy = await (await handleRequest(post(asKey(KEYS.a.secret), { tool: 'run_repo_import', arguments: { project_id: PROJECT.id } }), sb as never)).json();
  assertEquals(legacy.success, false);
  assert(String(legacy.error).includes('run_repo_import is available on Indie and above'), legacy.error);

  // the accepted plan in the database does not order a Free queue
  const q = await call(sb, asKey(KEYS.a.secret), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(q.isError, false, q.text);
  assertEquals(q.data.source, 'build-order');

  // Indie: repo import and Priority appear, the Team roster writer does not
  sb.rowsOf('stripe_subscriptions').push({ ...INDIE_ROW });
  const indie = await list();
  for (const t of ['get_work_plan', 'propose_work_plan', 'accept_work_plan', 'run_repo_import', 'search_repo_index', 'get_node_context', 'get_import_context', 'backfill_requirements']) {
    assert(indie.some((d) => d.name === t), `indie lacks ${t}`);
  }
  assert(!indie.some((d) => d.name === 'set_project_member'), 'indie lists set_project_member');
  assert(indie.find((d) => d.name === 'propose_patches')!.description.includes('place_on_step'), 'indie hears about place_on_step');
  const qi = await call(sb, asKey(KEYS.a.secret), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(qi.data.source, 'accepted-plan');
});

// ── AL.9 (owner 2026-10-01: "no two agents should share the same key") ──
// A key serves one connection: the one that initialized with it last. Another
// connection's tool calls are refused naming the one that holds it; a restart
// is a new connection and takes the key back; a call with no session is not
// checked (it cannot be told apart).
const initAs = async (sb: MemorySupabase, secret: string, client: string) => {
  const res = await handleRequest(post(asKey(secret), rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: client, version: '1' } })), sb as never);
  assertEquals(res.status, 200);
  return res.headers.get('Mcp-Session-Id')!;
};
const inSession = (secret: string, session: string): Headers_ => ({ ...asKey(secret), 'mcp-session-id': session });
const SHARED = 'This key is connected to another agent now';

Deno.test('AL.9 one agent per key: the last connection holds it; another connection is refused by name and does nothing; a restart takes it back', async () => {
  const sb = await world();
  sb.rowsOf('mcp_api_keys').find((k) => k.id === KEYS.a.id)!.metadata = { probe: { at: '2026-09-01T00:00:00Z' } };
  const first = await initAs(sb, KEYS.a.secret, 'claude-code');
  const q1 = await call(sb, inSession(KEYS.a.secret, first), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(q1.isError, false, q1.text);

  const second = await initAs(sb, KEYS.a.secret, 'cursor');
  assert(second !== first, 'a new connection');
  const refused = await call(sb, inSession(KEYS.a.secret, first), 'checkout_task', { project_id: PROJECT.id, task_item_id: T1, external_agent: 'agent-a' });
  assertEquals(refused.isError, true);
  assert(refused.text.startsWith(`Error: ${SHARED} (cursor, connected `), refused.text);
  assert(refused.text.includes('connect this agent with its own key (Agents, Connected, Connect an agent)') && refused.text.endsWith('Nothing was done.'), refused.text);
  assertEquals(activeHolds(sb).length, 0, 'the refused call claimed nothing');

  const held = await call(sb, inSession(KEYS.a.secret, second), 'checkout_task', { project_id: PROJECT.id, task_item_id: T1, external_agent: 'agent-a' });
  assertEquals(held.isError, false, held.text);
  const noSession = await call(sb, asKey(KEYS.a.secret), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(noSession.isError, false, 'a call without a session is not checked');

  // the first agent restarts: a new connection takes the key, the other is refused now
  const restarted = await initAs(sb, KEYS.a.secret, 'claude-code');
  assertEquals((await call(sb, inSession(KEYS.a.secret, restarted), 'get_work_queue', { project_id: PROJECT.id })).isError, false);
  const nowRefused = await call(sb, inSession(KEYS.a.secret, second), 'get_work_queue', { project_id: PROJECT.id });
  assert(nowRefused.text.startsWith(`Error: ${SHARED} (claude-code, connected `), nowRefused.text);

  const row = sb.rowsOf('mcp_api_keys').find((k) => k.id === KEYS.a.id)!;
  const meta = row.metadata as { probe?: unknown; connection?: { session: string; client: string } };
  assertEquals([meta.connection?.session, meta.connection?.client], [restarted, 'claude-code']);
  assertEquals(meta.probe, { at: '2026-09-01T00:00:00Z' }, 'the rest of the key\'s metadata is kept');
});

Deno.test('AL.9 a key connected before the rule is held by the first session that calls; each key holds its own', async () => {
  const sb = await world();
  const early = await call(sb, inSession(KEYS.a.secret, 'sess-early'), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(early.isError, false, early.text);
  const other = await call(sb, inSession(KEYS.a.secret, 'sess-other'), 'get_work_queue', { project_id: PROJECT.id });
  assert(other.text.startsWith(`Error: ${SHARED} (connected `), other.text);
  const keyB = await call(sb, inSession(KEYS.b.secret, 'sess-other'), 'get_work_queue', { project_id: PROJECT.id });
  assertEquals(keyB.isError, false, 'another key is its own: the same session id on it is fine');
  const session = await call(sb, { ...asJwt(OWNER_JWT), 'mcp-session-id': 'sess-x' }, 'get_work_queue', { project_id: PROJECT.id });
  assert(!session.text.includes(SHARED), 'a person\'s session is not a key');
});

// Q (owner 2026-09-22): Free and Community see and use only what their plan
// carries. These pin the MCP half: what tools/list serves per plan, that the
// paid sentences and fields are gone from open tools below their tier, that
// every edit still matches the registry text it edits, and that the
// transport serves and refuses by the same table (driven through the server).
import { MCP_TOOLS } from '../mcp-server/tool-registry.ts';
import {
  TOOL_FEATURE, EDITS, AFTER_UPGRADE, toolsForTier, toolOnPlan, planRefusal, nearestOnPlan, unknownToolMessage,
} from '../mcp-server/tool-surface.ts';
import { FEATURES, featureAllowed, type Feature } from '../_shared/feature-rules.ts';
import { CANONICAL_TIERS, type PlanTier } from '../_shared/tiers.ts';
import { handleMCPRequest } from '../mcp-server/transport.ts';
import { handleRequest, resetRateLimiter } from '../mcp-server/server.ts';
import { sha256Hex } from '../mcp-server/shared.ts';
import { MemorySupabase, assert, assertEquals } from './helpers.ts';

const PAID_TOOLS = Object.keys(TOOL_FEATURE).sort();
const names = (tier: PlanTier) => toolsForTier(tier).map((t) => t.name);
const served = (tier: PlanTier, name: string) => toolsForTier(tier).find((t) => t.name === name)!;
const text = (tier: PlanTier) => toolsForTier(tier).map((t) => `${t.name}\n${t.description}\n${JSON.stringify(t.inputSchema)}`).join('\n');

Deno.test('Q.1 the table names real tools and real features', () => {
  const registered = new Set(MCP_TOOLS.map((t) => t.name));
  for (const [tool, feature] of Object.entries(TOOL_FEATURE)) {
    assert(registered.has(tool), `${tool} is not a registered tool`);
    assert((FEATURES as readonly string[]).includes(feature), `${tool} names an unknown feature ${feature}`);
  }
  for (const edit of EDITS) {
    assert(registered.has(edit.tool), `an edit names an unregistered tool ${edit.tool}`);
    assert((FEATURES as readonly string[]).includes(edit.feature), `${edit.tool} edit names an unknown feature`);
    assert(!TOOL_FEATURE[edit.tool] || TOOL_FEATURE[edit.tool] !== edit.feature, `${edit.tool}: editing a tool its own feature already hides`);
  }
  assertEquals(PAID_TOOLS, [
    'accept_work_plan', 'backfill_requirements', 'get_import_context', 'get_node_context', 'get_work_plan',
    'propose_work_plan', 'run_repo_import', 'search_repo_index', 'set_project_member',
  ]);
});

Deno.test('Q.1 every edit still matches the registry text it edits (a reworded description fails here)', () => {
  for (const edit of EDITS) {
    const tool = MCP_TOOLS.find((t) => t.name === edit.tool)!;
    if ('find' in edit) {
      assert((tool.description as string).includes(edit.find), `${edit.tool}: "${edit.find.slice(0, 60)}" is no longer in the description`);
    } else if ('schemaFind' in edit) {
      assert(JSON.stringify(tool.inputSchema).includes(edit.schemaFind), `${edit.tool}: schema text "${edit.schemaFind}" is gone`);
    } else {
      let node: unknown = tool.inputSchema;
      for (const key of edit.drop) node = (node as Record<string | number, unknown> | undefined)?.[key];
      assert(node !== undefined, `${edit.tool}: schema path ${edit.drop.join('.')} does not exist`);
    }
  }
});

Deno.test('Q.1 Community lists no paid tool, and no open tool names one', () => {
  const list = names('community');
  for (const tool of PAID_TOOLS) assert(!list.includes(tool), `community lists ${tool}`);
  assertEquals(list.length, MCP_TOOLS.length - PAID_TOOLS.length);
  const all = text('community');
  for (const word of [
    ...PAID_TOOLS, 'place_on_step', 'upsert_workflow', 'set_outcome_step_maps', 'workflow kinds', 'workflow steps it maps',
    'work plan', 'work_plan', 'repo import', 'Repo-import', 'brownfield', 'clearance', 'classification', 'Government',
    'Team and above', 'below Indie',
  ]) {
    assert(!all.includes(word), `the Community surface still says "${word}"`);
  }
  // what the board promises is said the plan's way: no lanes or steps here
  assert(served('community', 'get_outcome_board').description.includes('workflows.available is false on this plan'), 'board says what it carries');
});

Deno.test('Q.1 each tier lists exactly the tools its features allow, additively', () => {
  for (const tier of CANONICAL_TIERS) {
    const expected = MCP_TOOLS.map((t) => t.name).filter((n) => !TOOL_FEATURE[n] || featureAllowed(tier, TOOL_FEATURE[n] as Feature));
    assertEquals(names(tier), expected, `${tier} list`);
  }
  // Indie: repo import and Priority, not the roster writer
  for (const t of ['run_repo_import', 'search_repo_index', 'get_work_plan', 'accept_work_plan']) assert(names('indie').includes(t), `indie lacks ${t}`);
  assert(!names('indie').includes('set_project_member'), 'indie lists set_project_member');
  assert(served('indie', 'propose_patches').description.includes('place_on_step'), 'indie hears about place_on_step');
  // Team: the roster writer, without Government's clearance field
  assert(names('team').includes('set_project_member'), 'team lacks set_project_member');
  assert(!JSON.stringify(served('team', 'set_project_member').inputSchema).includes('clearance'), 'team sees clearance');
  // Government, in the Government build: every tool, every field, word for word as registered
  for (const tool of MCP_TOOLS) {
    const s = toolsForTier('government', 'government').find((t) => t.name === tool.name)!;
    assertEquals(s.description, tool.description, `${tool.name} description on government`);
    assertEquals(s.inputSchema, tool.inputSchema, `${tool.name} schema on government`);
  }
});

// Audit (owner 2026-09-27): classification is the Government build's alone.
// Any other build serves no mark and no clearance, whatever the plan says.
Deno.test('Audit: outside the Government build no plan sees a mark or a clearance', () => {
  for (const edition of ['hosted', 'enterprise', 'oss'] as const) {
    const surface = toolsForTier('government', edition);
    const all = surface.map((t) => `${t.description}\n${JSON.stringify(t.inputSchema)}`).join('\n');
    assert(!all.includes('clearance') && !all.includes('"mark"'), `${edition} serves classification`);
    assertEquals(surface.map((t) => t.name), toolsForTier('government', 'government').map((t) => t.name), `${edition} keeps every tool`);
  }
  // this test process is not a self-hosted install: the default is the hosted build
  assert(!JSON.stringify(served('government', 'set_project_member').inputSchema).includes('clearance'), 'hosted serves clearance by default');
});

Deno.test('Q.1 serving a plan never mutates the registry', () => {
  const before = JSON.stringify(MCP_TOOLS);
  toolsForTier('community'); toolsForTier('indie'); toolsForTier('team');
  assertEquals(JSON.stringify(MCP_TOOLS), before);
});

Deno.test('Q.1 a hidden tool is refused with the plan, the price page and how it appears', () => {
  const r = planRefusal('run_repo_import', 'community');
  assert(r !== null, 'community is refused');
  assert(r.startsWith('run_repo_import is available on Indie and above; this account resolves to the Community tier.'), r);
  assert(r.includes('https://nodespec.io/pricing') && r.endsWith(AFTER_UPGRADE), r);
  assert(planRefusal('set_project_member', 'indie')!.includes('on Team and above'), 'indie is refused the roster writer');
  assertEquals(planRefusal('run_repo_import', 'indie'), null);
  assertEquals(planRefusal('list_requirements', 'community'), null, 'an open tool is never refused here');
  for (const t of PAID_TOOLS) assertEquals(toolOnPlan(t, 'government'), true);
});

Deno.test('Q.1 a typo never suggests a tool the plan hides', () => {
  assertEquals(nearestOnPlan('run_repo_imprt', 'community').includes('run_repo_import'), false);
  assertEquals(nearestOnPlan('run_repo_imprt', 'indie')[0], 'run_repo_import');
  const msg = unknownToolMessage('get_work_pln', 'community');
  assert(!msg.includes('get_work_plan'), msg);
  assert(msg.includes(`every tool on this plan (${MCP_TOOLS.length - PAID_TOOLS.length} tools)`), msg);
});

// The transport, driven through the real server (handleRequest) and the real
// dispatcher (handleMCPRequest) for a Free person with no seat anywhere.
const FREE_USER = 'f0000000-0000-4000-8000-00000000000f';
const FREE_KEY = 'ns_live_free_surface';
async function freeWorld(): Promise<MemorySupabase> {
  const sb = new MemorySupabase();
  for (const t of ['projects', 'project_members', 'stripe_subscriptions']) sb.table(t, []);
  sb.table('mcp_api_keys', [{ id: 'k-free', user_id: FREE_USER, name: 'free agent', key_hash: await sha256Hex(FREE_KEY), key_prefix: FREE_KEY.slice(0, 12), scopes: ['read', 'write', 'propose'], expires_at: null, revoked_at: null, last_used_at: null }]);
  sb.fn('validate_mcp_api_key', (p, db) => {
    const k = db.rowsOf('mcp_api_keys').find((r) => r.key_hash === p.p_key_hash);
    return k
      ? [{ user_id: k.user_id, key_id: k.id, scopes: k.scopes, is_valid: true, rejection_reason: null, key_name: k.name }]
      : [{ user_id: null, key_id: null, scopes: null, is_valid: false, rejection_reason: 'Invalid API key', key_name: null }];
  });
  return sb;
}
const rpc = (method: string, params?: Record<string, unknown>) => new Request('http://localhost:54321/functions/v1/mcp-server', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-MCP-API-Key': FREE_KEY },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
});
const COMMUNITY_COUNT = MCP_TOOLS.length - PAID_TOOLS.length;

Deno.test('Q.1 transport: tools/list serves a Free person the Community list, no paid tool and no paid sentence', async () => {
  resetRateLimiter();
  const body = await (await handleRequest(rpc('tools/list'), await freeWorld() as never)).json();
  const tools = body.result.tools as Array<{ name: string; description: string }>;
  assertEquals(tools.map((t) => t.name), names('community'));
  for (const t of PAID_TOOLS) assert(!tools.some((x) => x.name === t), `${t} listed`);
  const propose = tools.find((t) => t.name === 'propose_patches')!;
  assertEquals(propose.description, served('community', 'propose_patches').description, 'the served description is the edited one, never the raw registry');
});

Deno.test('Q.1 transport: unauthenticated discovery shows the Community list', async () => {
  resetRateLimiter();
  const res = await handleRequest(new Request('http://localhost:54321/functions/v1/mcp-server', { method: 'GET' }), await freeWorld() as never);
  const body = await res.json();
  assertEquals((body.data.tools as Array<{ name: string }>).map((t) => t.name), names('community'));
});

Deno.test('Q.1 transport: a typo of a paid tool is answered from the caller\'s list on both doors', async () => {
  resetRateLimiter();
  const sb = await freeWorld();
  const viaCall = await (await handleRequest(rpc('tools/call', { name: 'get_work_pla', arguments: {} }), sb as never)).json();
  const callMsg = String(viaCall.error?.message ?? JSON.stringify(viaCall));
  assert(callMsg.startsWith('Unknown tool: get_work_pla.'), callMsg);
  assert(!callMsg.includes('get_work_plan'), `tools/call names no tool the caller cannot see: ${callMsg}`);
  assert(callMsg.includes(`(${COMMUNITY_COUNT} tools)`), callMsg);
  const direct = await handleMCPRequest(sb as never, { userId: FREE_USER, scopes: ['read'], authMethod: 'jwt' }, { tool: 'get_work_pla', arguments: {} } as never);
  assertEquals(direct.error, callMsg, 'the direct path answers the same');
});

Deno.test('Q.1 transport: a paid tool is refused at the choke point before its handler runs, on both doors', async () => {
  resetRateLimiter();
  const sb = await freeWorld();
  const direct = await handleMCPRequest(sb as never, { userId: FREE_USER, scopes: ['read', 'propose', 'write'], authMethod: 'jwt' }, { tool: 'propose_work_plan', arguments: { items: [], summary: 'x' } } as never);
  assertEquals(direct.error, planRefusal('propose_work_plan', 'community'), 'no project named: the person\'s own plan, refused before the handler asks for one');
  const viaCall = await (await handleRequest(rpc('tools/call', { name: 'propose_work_plan', arguments: { items: [], summary: 'x' } }), sb as never)).json();
  assert(String(viaCall.result?.content?.[0]?.text ?? '').includes(planRefusal('propose_work_plan', 'community')!), JSON.stringify(viaCall).slice(0, 300));
});
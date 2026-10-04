// V3 4b.3 (R7): delegate identity + the hold↔proposal wiring. Pins: the
// credential IS the identity (key id, or the OAuth (user, client) pair
// stable across token renewals; humans have none); OAuth-connected agents
// now recognize their own holds (`mine`) — the gap that made activeHolds
// blind to the primary documented path; the credential label rides beside
// the display label; the claim passes the delegate; filing a proposal binds
// the filer's advisory holds on its targets; resolving it (either way)
// releases them as 'resolved'.
import { delegateOf, credentialLabel } from '../mcp-server/shared.ts';
import { isMine, bindHoldsToProposal, releaseHoldsForProposal, handleGetWorkQueue, handleCheckoutTask } from '../mcp-server/tools/checkouts.ts';
import { handleResolveProposal } from '../mcp-server/tools/approvals.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const CAND = '33333333-3333-4333-8333-333333333333';
const PROP = '44444444-4444-4444-8444-444444444444';
const KEY = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] } as never;
const OAUTH = { userId: 'user-1', authMethod: 'oauth_token', clientId: 'claude-code', scopes: ['read', 'write'] } as never;
const JWT = { userId: 'user-1', authMethod: 'jwt', scopes: ['read', 'write', 'propose'] } as never;

Deno.test('delegateOf: the credential is the identity — key id, OAuth (user, client), nothing for a human', () => {
  assertEquals(delegateOf(KEY), 'key:k1');
  assertEquals(delegateOf(OAUTH), 'oauth:user-1:claude-code');
  assertEquals(delegateOf(JWT), null);
  // a client id with colons (a URL) survives the split, and reads as its host (AL.2)
  assertEquals(credentialLabel('oauth:user-1:https://cursor.sh/mcp'), 'oauth · cursor.sh');
  assertEquals(credentialLabel('key:k1'), 'key · k1');
  assertEquals(credentialLabel('key:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', new Map([['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'ci runner']])), 'key · ci runner');
  assertEquals(credentialLabel('key:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'), 'key · aaaaaaaa');
  assertEquals(credentialLabel(null), null);
});

Deno.test('isMine: by key id or by delegate — an OAuth agent recognizes its own hold across renewals', () => {
  const keyHold = { holder_key_id: 'k1', holder_delegate: 'key:k1' };
  const oauthHold = { holder_key_id: null, holder_delegate: 'oauth:user-1:claude-code' };
  assertEquals(isMine(KEY, delegateOf(KEY), keyHold), true);
  assertEquals(isMine(KEY, delegateOf(KEY), oauthHold), false);
  assertEquals(isMine(OAUTH, delegateOf(OAUTH), oauthHold), true, 'the gap that was always false before v3m');
  assertEquals(isMine(OAUTH, delegateOf(OAUTH), keyHold), false);
  // a pre-v3m row (delegate null) still answers to its key id
  assertEquals(isMine(KEY, delegateOf(KEY), { holder_key_id: 'k1', holder_delegate: null }), true);
  assertEquals(isMine(JWT, delegateOf(JWT), oauthHold), false, 'a human session holds nothing here');
});

Deno.test('checkout_task passes the delegate to the claim RPC', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('rpc', 'agent_checkout_claim', { data: { claimed: true, checkoutId: 'lease-1', advisory: true }, error: null });
  const r = await handleCheckoutTask(sb as never, OAUTH, { project_id: PROJECT.id, level: 'outcome', ref_id: CAND, external_agent: 'claude · planner' });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const params = sb.callsTo('rpc', 'agent_checkout_claim')[0].payload as any;
  assertEquals(params.p_holder_delegate, 'oauth:user-1:claude-code');
  assertEquals(params.p_holder_key_id, null);
});

Deno.test('get_work_queue.activeHolds: an OAuth caller sees its hold as mine, with the credential beside the label', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH, name: 'main', is_primary: true }, error: null });
  sb.script('task_items', 'select', { data: [], error: null });
  const fresh = new Date().toISOString();
  sb.script('agent_checkouts', 'select', {
    data: [
      { id: 'lease-1', level: 'outcome', holder_label: 'claude · planner', holder_key_id: null, holder_delegate: 'oauth:user-1:claude-code', task_item_id: null, artifact_id: null, requirement_id: null, candidate_id: CAND, proposal_id: null, meta: {}, since: fresh, heartbeat_at: fresh },
      { id: 'lease-2', level: 'outcome', holder_label: 'ci', holder_key_id: 'kkkkkkkk-0000-4000-8000-000000000000', holder_delegate: 'key:kkkkkkkk-0000-4000-8000-000000000000', task_item_id: null, artifact_id: null, requirement_id: null, candidate_id: CAND, proposal_id: null, meta: {}, since: fresh, heartbeat_at: fresh },
    ],
    error: null,
  });
  sb.script('requirement_candidates', 'select', { data: [{ id: CAND, name: 'Tenants export their data' }], error: null });
  sb.script('mcp_api_keys', 'select', { data: [{ id: 'kkkkkkkk-0000-4000-8000-000000000000', name: 'ci runner' }], error: null });
  const r = await handleGetWorkQueue(sb as never, OAUTH, { project_id: PROJECT.id });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const holds = (r.data as any).activeHolds as Array<Record<string, unknown>>;
  assertEquals(holds.length, 2);
  const mineHold = holds.find((h) => h.checkoutId === 'lease-1')!;
  assertEquals(mineHold.mine, true);
  assertEquals(mineHold.credential, 'oauth · claude-code');
  const ciHold = holds.find((h) => h.checkoutId === 'lease-2')!;
  assertEquals(ciHold.mine, false);
  assertEquals(ciHold.credential, 'key · ci runner');
});

Deno.test('bindHoldsToProposal: the filer\'s advisory holds on the targets bind — by credential for an agent, by user:<id> for a session (7.0); foreign holds do not', async () => {
  const sb = new FakeSupabase();
  sb.script('agent_checkouts', 'update', { data: [{ id: 'lease-1' }], error: null });
  const patches = [
    { type: 'promote_candidate', payload: { candidateId: CAND, criteriaIds: ['c1'] } },
    { type: 'update_requirement', payload: { requirementId: 'REQ-004', changes: {} } }, // REQ-xxx form: not bound (uuid only)
  ];
  const n = await bindHoldsToProposal(sb as never, KEY, PROJECT.id, PROP, patches);
  assertEquals(n, 1);
  const upd = sb.callsTo('agent_checkouts', 'update');
  assertEquals(upd.length, 1, 'only the outcome lane was touched');
  // deno-lint-ignore no-explicit-any
  assertEquals((upd[0].payload as any).proposal_id, PROP);
  const filters = JSON.stringify(upd[0].filters);
  assert(filters.includes('holder_delegate') && filters.includes('key:k1'), 'bound by the filing credential');
  assert(filters.includes('outcome'), 'outcome level');

  // 7.0: a person holds in person — their own advisory holds bind to what they file.
  const sb2 = new FakeSupabase();
  sb2.script('agent_checkouts', 'update', { data: [{ id: 'lease-2' }], error: null });
  assertEquals(await bindHoldsToProposal(sb2 as never, JWT, PROJECT.id, PROP, patches), 1, 'a session binds by user:<id>');
  assert(JSON.stringify(sb2.callsTo('agent_checkouts', 'update')[0].filters).includes('user:user-1'), 'bound by the human identity');
});

Deno.test('resolve_proposal reject releases the bound holds as resolved; a key may reject what it proposed', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('ai_proposals', 'select', { data: { id: PROP, status: 'pending', source_branch_id: BRANCH, patches: [{ patch: { type: 'promote_candidate', payload: { candidateId: CAND } }, status: 'pending' }], metadata: { plane: 'spec' } }, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH, project_id: PROJECT.id }, error: null });
  sb.script('ai_proposals', 'update', { data: null, error: null });
  sb.script('agent_checkouts', 'update', { data: [{ id: 'lease-1' }], error: null });
  const r = await handleResolveProposal(sb as never, KEY, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject' });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  assertEquals((r.data as any).holdsReleased, 1);
  // deno-lint-ignore no-explicit-any
  const rel = sb.callsTo('agent_checkouts', 'update')[0].payload as any;
  assertEquals(rel.released_reason, 'resolved');
  assert(!!rel.released_at);
  assert(JSON.stringify(sb.callsTo('agent_checkouts', 'update')[0].filters).includes(PROP), 'only holds bound to this proposal');
});

Deno.test('releaseHoldsForProposal is best effort — a failed read never fails the resolve', async () => {
  const sb = new FakeSupabase();
  sb.script('agent_checkouts', 'update', { data: null, error: { message: 'boom' } });
  assertEquals(await releaseHoldsForProposal(sb as never, PROP), 0);
});

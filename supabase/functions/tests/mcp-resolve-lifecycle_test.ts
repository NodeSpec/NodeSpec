// Changes, settled on rows that remember (2026-09-21). mcp-resolve-proposal_test
// drives handleResolveProposal against a FakeSupabase that answers whatever
// was scripted, so the compare-and-set on `status = pending`, the release of
// the drafting holds bound to the proposal, and the write the accept makes
// were never applied to anything. Here the same handler runs on a
// MemorySupabase that keeps rows: a reject settles the row and releases
// exactly the holds bound to it; a second resolve of the settled row is
// refused; an accept of update_vision changes the specification's vision;
// a proposal of another project is refused before any row moves; a
// contributor's key never settles.
import { handleResolveProposal } from '../mcp-server/tools/approvals.ts';
import { MemorySupabase, assert, assertEquals } from './helpers.ts';

const OWNER = 'user-owner';
const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench', owner_id: OWNER };
const OTHER = { id: '11111111-1111-4111-8111-222222222222', name: 'Other', owner_id: 'user-other' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH = '22222222-2222-4222-8222-333333333333';
const PROP = '33333333-3333-4333-8333-333333333333';
const PROP_OTHER = '33333333-3333-4333-8333-444444444444';
const SPEC = '44444444-4444-4444-8444-444444444444';
const KEY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const KEY_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

const OWNER_KEY = { userId: OWNER, authMethod: 'api_key', keyId: KEY_A, scopes: ['read', 'write', 'propose'] } as never;
const OWNER_APP = { userId: OWNER, authMethod: 'jwt', email: 'owner@bench.local', scopes: ['read', 'write', 'propose'] } as never;
const CONTRIBUTOR_KEY = { userId: 'user-contrib', authMethod: 'api_key', keyId: KEY_B, scopes: ['read', 'write', 'propose'] } as never;

const meta = () => ({ id: crypto.randomUUID(), actorType: 'ai', actorId: 'claude · bench', summary: 'bench', timestamp: new Date().toISOString() });

function world() {
  const sb = new MemorySupabase();
  sb.table('projects', [{ ...PROJECT }, { ...OTHER }]);
  sb.table('project_members', [{ project_id: PROJECT.id, user_id: 'user-contrib', role: 'contributor', clearance: [] }]);
  // seats are Team and above (decision 1): the owner is on Team
  sb.table('stripe_subscriptions', [{ user_id: OWNER, plan_name: 'team', status: 'active', current_period_end: '2099-01-01T00:00:00Z' }]);
  sb.table('branches', [
    { id: BRANCH, project_id: PROJECT.id, name: 'main', is_primary: true },
    { id: OTHER_BRANCH, project_id: OTHER.id, name: 'main', is_primary: true },
  ]);
  sb.table('project_specifications', [{ id: SPEC, project_id: PROJECT.id, vision: 'Before.', constraints: [], phase_status: 'drafting_requirements' }]);
  sb.table('ai_proposals', [
    { id: PROP, status: 'pending', source_branch_id: BRANCH, proposal_branch_id: BRANCH, patches: [{ patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'Architecture as data.' } }, explanation: 'v', status: 'pending' }], metadata: { plane: 'spec', proposedByUserId: OWNER } },
    { id: PROP_OTHER, status: 'pending', source_branch_id: OTHER_BRANCH, proposal_branch_id: OTHER_BRANCH, patches: [{ patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'x' } }, status: 'pending' }], metadata: { plane: 'spec' } },
  ]);
  // two drafting holds: one bound to the proposal, one another agent's on the same requirement
  sb.table('agent_checkouts', [
    { id: 'hold-bound', project_id: PROJECT.id, level: 'requirement', holder_kind: 'agent', holder_label: 'agent-a', holder_key_id: KEY_A, holder_delegate: `key:${KEY_A}`, requirement_id: 'req-1', proposal_id: PROP, released_at: null, released_reason: null, since: '2026-09-21T00:00:00Z', heartbeat_at: '2026-09-21T00:00:00Z' },
    { id: 'hold-other', project_id: PROJECT.id, level: 'requirement', holder_kind: 'agent', holder_label: 'agent-b', holder_key_id: KEY_B, holder_delegate: `key:${KEY_B}`, requirement_id: 'req-1', proposal_id: null, released_at: null, released_reason: null, since: '2026-09-21T00:00:00Z', heartbeat_at: '2026-09-21T00:00:00Z' },
  ]);
  return sb;
}
const proposal = (sb: MemorySupabase, id: string) => sb.rowsOf('ai_proposals').find((r) => r.id === id)!;
const hold = (sb: MemorySupabase, id: string) => sb.rowsOf('agent_checkouts').find((r) => r.id === id)!;

Deno.test('reject settles the row once, stamps every patch, and releases exactly the holds bound to the proposal', async () => {
  const sb = world();
  const r = await handleResolveProposal(sb as never, OWNER_KEY, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject', note: 'not now' });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals((r.data as { status: string; holdsReleased?: number }).status, 'rejected');
  assertEquals((r.data as { holdsReleased?: number }).holdsReleased, 1);
  const row = proposal(sb, PROP);
  assertEquals(row.status, 'rejected');
  assert(!!row.reviewed_at, 'reviewed_at stamped');
  assertEquals((row.patches as Array<{ status: string }>).map((p) => p.status), ['rejected']);
  assertEquals((row.metadata as { resolveNote: string }).resolveNote, 'not now');
  // the bound hold ended as resolved; the other agent's drafting hold on the same requirement stands
  assertEquals(hold(sb, 'hold-bound').released_reason, 'resolved');
  assertEquals(hold(sb, 'hold-other').released_at, null);
  // the vision was never touched by a reject
  assertEquals(sb.rowsOf('project_specifications')[0].vision, 'Before.');

  // a second resolve of the settled row is refused, and the row does not move
  const again = await handleResolveProposal(sb as never, OWNER_KEY, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(again.success, false);
  assert(String(again.error).includes('only pending proposals resolve'), again.error);
  assertEquals(proposal(sb, PROP).status, 'rejected');
});

Deno.test('accept applies the spec patch: the specification vision changes, the row reads merged with per-patch accepted, the hold releases', async () => {
  const sb = world();
  const r = await handleResolveProposal(sb as never, OWNER_APP, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals((r.data as { status: string; applied: number }).status, 'merged');
  assertEquals((r.data as { applied: number }).applied, 1);
  assertEquals(sb.rowsOf('project_specifications')[0].vision, 'Architecture as data.');
  const row = proposal(sb, PROP);
  assertEquals(row.status, 'merged');
  assert(!!row.merged_at, 'merged_at stamped');
  assertEquals((row.patches as Array<{ status: string }>).map((p) => p.status), ['accepted']);
  assertEquals(hold(sb, 'hold-bound').released_reason, 'resolved');
  // once merged, a reject finds nothing to settle
  const again = await handleResolveProposal(sb as never, OWNER_APP, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject' });
  assertEquals(again.success, false);
  assertEquals(proposal(sb, PROP).status, 'merged');
});

Deno.test('a proposal of another project is refused before any row moves; a contributor\'s key never settles', async () => {
  const sb = world();
  const foreign = await handleResolveProposal(sb as never, OWNER_KEY, { project_id: PROJECT.id, proposal_id: PROP_OTHER, action: 'accept' });
  assertEquals(foreign.success, false);
  assert(String(foreign.error).includes('does not belong'), foreign.error);
  assertEquals(proposal(sb, PROP_OTHER).status, 'pending');

  const seat = await handleResolveProposal(sb as never, CONTRIBUTOR_KEY, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject' });
  assertEquals(seat.success, false);
  assert(/contributor|maintainer|owner/.test(String(seat.error)), seat.error);
  assertEquals(proposal(sb, PROP).status, 'pending');
  assertEquals(hold(sb, 'hold-bound').released_at, null);
});

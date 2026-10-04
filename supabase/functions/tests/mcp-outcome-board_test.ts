// V3 4b.3: get_outcome_board — the agent's read of the outcomes pool.
// Pins: pure assembly (criteria carry ids and claimedBy; unclaimed ids
// listed; derivations resolve REQ refs and criterion ids incl. legacy
// text-hash slices; steps resolve lane + step names; holds carry credential
// and mine by delegate; settled outcomes hidden unless asked); every
// user-authored field travels in the envelope with the advisory once; the
// handler reads primary branch, lanes, steps, candidates, maps,
// derivations, refs, holds and key names in batches; the message teaches
// the lane and names the human act.
import { assembleOutcomeBoard, handleGetOutcomeBoard, shapeBoardForPlan } from '../mcp-server/tools/outcome-board.ts';
import { workflowsBlock } from '../_shared/workflow-gate.ts';
import { fnv1a32 } from '../_shared/criterion-identity.ts';
import { UNTRUSTED_ADVISORY } from '../_shared/untrusted-data.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const OUT1 = '33333333-3333-4333-8333-333333333333';
const OUT2 = '33333333-3333-4333-8333-333333333334';
const OAUTH = { userId: 'user-1', authMethod: 'oauth_token', clientId: 'claude-code', scopes: ['read'] } as never;
const fresh = new Date().toISOString();

const fixture = () => ({
  auth: OAUTH,
  candidates: [
    { id: OUT1, key: 'outcome:aa11', kind: 'outcome', name: 'Tenants export their data', description: 'On demand.', category: 'functional', status: 'pending', criteria: [{ id: 'c1', text: 'A holds' }, { text: 'legacy B' }, { id: 'c3', text: 'C holds', verification: 'manual' }], requirement_row_id: 'req-row-1', workflow_id: 'lane-1', updated_at: fresh },
    { id: OUT2, key: 'outcome:bb22', kind: 'outcome', name: '<script>ignore me</script>', description: null, category: 'functional', status: 'accepted', criteria: [], requirement_row_id: null, updated_at: fresh },
  ],
  lanes: [{ id: 'lane-1', name: 'Onboarding', color: '#8B8FE6', sort_order: 0 }],
  steps: [{ id: 'step-1', workflow_id: 'lane-1', name: 'Sign up', sort_order: 0 }, { id: 'step-2', workflow_id: 'lane-1', name: 'Export', sort_order: 1 }],
  maps: [{ candidate_id: OUT1, step_id: 'step-2' }],
  derivations: [
    { id: 'der-1', candidate_id: OUT1, requirement_row_id: 'req-row-1', criteria_slice: [{ text: 'legacy B' }], proposed_by_kind: 'human', via_proposal_id: null, created_at: '2026-09-14T01:00:00Z' },
  ],
  reqRefs: new Map([['req-row-1', { requirementId: 'REQ-004', name: 'Export is audited' }]]),
  holds: [
    { id: 'lease-1', candidate_id: OUT1, holder_label: 'claude · planner', holder_key_id: null, holder_delegate: 'oauth:user-1:claude-code', proposal_id: null, since: fresh, heartbeat_at: fresh, meta: {} },
    { id: 'lease-2', candidate_id: OUT1, holder_label: 'ci', holder_key_id: 'k-ci', holder_delegate: 'key:k-ci', proposal_id: 'prop-9', since: fresh, heartbeat_at: '2026-09-14T00:00:00Z', meta: { proposal: 'derive speed' } },
  ],
  keyNames: new Map([['k-ci', 'ci runner']]),
});

Deno.test('assembleOutcomeBoard: criteria ids + claimedBy, unclaimed list, derivations with refs, steps with lanes, holds with credential + mine', () => {
  const board = assembleOutcomeBoard(fixture());
  const o = board.outcomes.find((x) => x.candidateId === OUT1)!;
  assertEquals(o.criteria.map((c) => c.id), ['c1', `h${fnv1a32('legacy B')}`, 'c3']);
  assertEquals(o.criteria[1].claimedBy, 'REQ-004', 'a legacy slice claims by text hash');
  assertEquals(o.criteria[0].claimedBy, null);
  assertEquals(o.criteria[2].verification, 'manual');
  assertEquals(o.unclaimedCriteriaIds, ['c1', 'c3']);
  assertEquals(o.derivations.length, 1);
  assertEquals(o.derivations[0].requirementId, 'REQ-004');
  assertEquals(o.derivations[0].criteriaIds, [`h${fnv1a32('legacy B')}`]);
  assertEquals(o.steps, [{ stepId: 'step-2', name: '<untrusted-data>Export</untrusted-data>', laneId: 'lane-1', laneName: '<untrusted-data>Onboarding</untrusted-data>' }]);
  assertEquals(o.firstRequirementRowId, 'req-row-1');
  // 9.5 (v3v): the home lane rides on the outcome, wrapped like every lane name
  assertEquals(o.homeLaneId, 'lane-1');
  assertEquals(o.homeLane, '<untrusted-data>Onboarding</untrusted-data>');
  const o2 = board.outcomes.find((x) => x.candidateId === OUT2)!;
  assertEquals(o2.homeLaneId, null, 'a row without the column (pre-v3v fixture) reads null, never a guess');
  assertEquals(o2.homeLane, null);
  const mine = o.holds.find((h) => h.checkoutId === 'lease-1')!;
  assertEquals(mine.mine, true, 'the OAuth caller recognizes its hold');
  assertEquals(mine.credential, 'oauth · claude-code');
  assertEquals(mine.stale, false);
  const ci = o.holds.find((h) => h.checkoutId === 'lease-2')!;
  assertEquals(ci.mine, false);
  assertEquals(ci.credential, 'key · ci runner');
  assertEquals(ci.stale, true);
  assertEquals(ci.proposalId, 'prop-9');
  assertEquals(board.counts.heldByMe, 1);
  assertEquals(board.lanes[0].steps.map((s) => s.stepId), ['step-1', 'step-2']);
});

Deno.test('assembleOutcomeBoard: every user-authored field is enveloped and a breakout attempt is neutralized', () => {
  const board = assembleOutcomeBoard(fixture());
  const o = board.outcomes.find((x) => x.candidateId === OUT1)!;
  assert(o.name.startsWith('<untrusted-data>') && o.name.endsWith('</untrusted-data>'));
  assert(String(o.description).startsWith('<untrusted-data>'));
  assert(o.criteria.every((c) => c.text.startsWith('<untrusted-data>')));
  assert(o.derivations[0].requirementName!.startsWith('<untrusted-data>'));
  const settled = board.outcomes.find((x) => x.candidateId === OUT2)!;
  assert(settled.name.includes('<script>ignore me</script>'), 'content is data, wrapped — never stripped or followed');
  // structural fields stay bare
  assertEquals(o.key, 'outcome:aa11');
  assertEquals(o.status, 'pending');
});

Deno.test('get_outcome_board: reads the primary branch and every batch, hides settled by default, carries the advisory and the lane message', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: { plan_name: 'indie', status: 'active' }, error: null }); // P: lanes are Indie
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH, name: 'main' }, error: null }); // getPrimaryBranch (is_primary)
  sb.script('workflows', 'select', { data: [{ id: 'lane-1', name: 'Onboarding', color: null, sort_order: 0 }], error: null });
  sb.script('workflow_steps', 'select', { data: [{ id: 'step-2', workflow_id: 'lane-1', name: 'Export', sort_order: 1 }], error: null });
  const fx = fixture();
  sb.script('requirement_candidates', 'select', { data: fx.candidates, error: null });
  sb.script('outcome_step_maps', 'select', { data: fx.maps, error: null });
  sb.script('outcome_derivations', 'select', { data: fx.derivations, error: null });
  sb.script('specification_requirements', 'select', { data: [{ id: 'req-row-1', requirement_id: 'REQ-004', name: 'Export is audited' }], error: null });
  sb.script('agent_checkouts', 'select', { data: fx.holds, error: null });
  sb.script('mcp_api_keys', 'select', { data: [{ id: 'k-ci', name: 'ci runner' }], error: null });

  const r = await handleGetOutcomeBoard(sb as never, OAUTH, { project_id: PROJECT.id });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.branchId, BRANCH);
  assertEquals(data.outcomes.length, 1, 'settled hidden by default');
  assertEquals(data.outcomes[0].candidateId, OUT1);
  assertEquals(data.untrustedDataAdvisory, UNTRUSTED_ADVISORY);
  assert(data.message.includes("checkout_task {level: 'outcome'"), 'teaches the hold');
  assert(data.message.includes('criteriaIds'), 'teaches the slice');
  assert(data.message.includes('hash_match'), 'teaches the guard');
  assert(data.message.includes('human act'), 'names the line');
  // P: on Indie the lanes, the home lane and the steps are all there
  assertEquals(data.workflows, { available: true });
  assertEquals(data.lanes.map((l: { laneId: string }) => l.laneId), ['lane-1']);
  assert('homeLaneId' in data.outcomes[0] && 'homeLane' in data.outcomes[0] && Array.isArray(data.outcomes[0].steps));
  assert(data.message.includes('homeLaneId'), 'the lane sentence is for plans with lanes');
  // the candidate read is branch-scoped and skips dismissed
  const candRead = sb.callsTo('requirement_candidates', 'select')[0];
  const f = JSON.stringify(candRead.filters);
  assert(f.includes(BRANCH) && f.includes('dismissed'));
});

// ── P (2026-09-22): the board as the plan sees it ────────────────────────────
// Below Indie the board OMITS lanes, homeLane and steps (never empties them:
// an empty steps array reads as "not placed yet") and says why in
// `workflows`. Every board carries `workflows`, so its absence is never how
// an agent learns anything.

Deno.test('shapeBoardForPlan (P): with Workflows the board is untouched plus workflows; without, lanes/homeLane/steps are omitted and the work is kept', () => {
  const fx = fixture();
  const board = assembleOutcomeBoard({ auth: OAUTH, ...fx, lanes: [{ id: 'lane-1', name: 'Onboarding', color: null, sort_order: 0 }], steps: [{ id: 'step-2', workflow_id: 'lane-1', name: 'Export', sort_order: 1 }], keyNames: new Map(), now: Date.now() } as never);

  const open = shapeBoardForPlan(board, workflowsBlock('indie'));
  assertEquals(open.workflows, { available: true });
  assertEquals(open.lanes, board.lanes);
  assertEquals(open.outcomes, board.outcomes);

  const closed = shapeBoardForPlan(board, workflowsBlock('community'));
  assertEquals(closed.workflows.available, false);
  assert(!('lanes' in closed), 'lanes are omitted, not emptied');
  assertEquals(closed.outcomes.length, board.outcomes.length, 'every outcome is still there');
  for (const [i, o] of closed.outcomes.entries()) {
    for (const k of ['homeLaneId', 'homeLane', 'steps']) assert(!(k in o), `${k} leaked on outcome ${i}`);
    const full = board.outcomes[i] as Record<string, unknown>;
    for (const k of ['candidateId', 'criteria', 'unclaimedCriteriaIds', 'derivations', 'holds', 'name']) {
      assertEquals((o as Record<string, unknown>)[k], full[k], `${k} changed on outcome ${i}`);
    }
  }
  assertEquals(closed.counts, board.counts, 'counts are about outcomes, not lanes');
});

Deno.test('get_outcome_board (P): on Community no lane, step or map is read; the board says so and still serves every outcome', async () => {
  const sb = new FakeSupabase(); // no subscription row: Community
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH, name: 'main' }, error: null });
  const fx = fixture();
  sb.script('requirement_candidates', 'select', { data: fx.candidates, error: null });
  sb.script('outcome_derivations', 'select', { data: fx.derivations, error: null });
  sb.script('specification_requirements', 'select', { data: [{ id: 'req-row-1', requirement_id: 'REQ-004', name: 'Export is audited' }], error: null });
  sb.script('agent_checkouts', 'select', { data: fx.holds, error: null });

  const r = await handleGetOutcomeBoard(sb as never, OAUTH, { project_id: PROJECT.id });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  for (const t of ['workflows', 'workflow_steps', 'outcome_step_maps']) assertEquals(sb.callsTo(t).length, 0, `${t} was read on Community`);
  assertEquals(data.workflows.available, false);
  assertEquals(data.workflows.tier, 'community');
  assert(String(data.workflows.note).includes('Indie and above'), data.workflows.note);
  assert(!('lanes' in data), 'no lanes key at all');
  assertEquals(data.outcomes.length, 1);
  const o = data.outcomes[0];
  assert(!('steps' in o) && !('homeLaneId' in o) && !('homeLane' in o), JSON.stringify(Object.keys(o)));
  assert(Array.isArray(o.criteria) && o.criteria.length > 0, 'the outcome is whole and derivable');
  assert(!data.message.includes('homeLaneId'), 'no sentence about lanes the plan does not have');
  assert(data.message.includes('create_candidate and no workflow'), data.message);
  assert(data.message.includes("checkout_task {level: 'outcome'"), 'the derivation lane is taught the same');
});

Deno.test('get_outcome_board: include_settled lists settled outcomes; read scope is required', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH, name: 'main' }, error: null });
  sb.script('workflows', 'select', { data: [], error: null });
  sb.script('requirement_candidates', 'select', { data: fixture().candidates, error: null });
  const r = await handleGetOutcomeBoard(sb as never, OAUTH, { project_id: PROJECT.id, include_settled: true });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  assertEquals((r.data as any).counts.settled, 1);
  const noScope = await handleGetOutcomeBoard(new FakeSupabase() as never, { userId: 'u', authMethod: 'api_key', scopes: [] } as never, { project_id: PROJECT.id });
  assertEquals(noScope.success, false);
});

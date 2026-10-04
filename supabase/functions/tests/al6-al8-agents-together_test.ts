// AL.6 and AL.8 (owner 2026-10-01): "if I set autonomy to Auto it doesn't
// still hold a requirement/outcome/constraint proposal in waiting", and
// agents working at the same time over MCP must not collide, with no more
// "partial" approvals on outcomes and requirements.
//
//   AL.6  Under Auto a batch of spec changes from the owner's agent (write
//         scope) applies as it files, through the same accept a person runs.
//         A key that may only propose, a member's agent, a confirmed
//         requirement, or a drafted vision still waits. A batch mixing canvas and spec changes is
//         refused: it could be accepted in neither place.
//   AL.8  A waiting proposal holds what it changes: a second one on the same
//         requirement, outcome, constraint, workflow or step is refused at
//         filing, and so is a direct write. A decision takes the proposal
//         first (one decider at a time). A batch is checked against the rows
//         as they are now before anything is written. A promotion that loses
//         a REQ number to another takes the next. A dismiss or settle that
//         finds the outcome decided meanwhile changes nothing.
import { handleProposePatches, mixedPlanes } from '../mcp-server/tools/proposals.ts';
import { acceptSpecBatch } from '../mcp-server/tools/approvals.ts';
import { pendingOverlap, routeToolCall, specTargetsOf } from '../mcp-server/tools/change-router.ts';
import { applySpecPatch, preflightSpecBatch } from '../mcp-server/tools/spec-patch-apply.ts';
import { SpecPatchOperationSchema } from '../_shared/spec-patch-schema.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals, scriptSeatOwner } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bakery' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const CAND = '33333333-3333-4333-8333-333333333333';
const SPEC = '44444444-4444-4444-8444-444444444444';
const REQ_ROW = '55555555-5555-4555-8555-555555555555';
const OWNER_AGENT = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write', 'propose'] } as AuthResult;
const PROPOSER = { ...OWNER_AGENT, scopes: ['read', 'propose'] } as AuthResult;
const AUTO = { automation_policy: { candidates: 2, requirements: 2 } };

// deno-lint-ignore no-explicit-any
const spec = (type: string, payload: unknown): any => {
  const parsed = SpecPatchOperationSchema.safeParse({
    type, metadata: { id: crypto.randomUUID(), actorType: 'ai', actorId: 'site-builder', summary: type, timestamp: new Date().toISOString() }, payload,
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};
const newOutcome = { type: 'create_candidate', payload: { branchId: BRANCH, name: 'Customers order ahead for pickup' } };
// deno-lint-ignore no-explicit-any
const decision = (sb: FakeSupabase): any => sb.callsTo('ai_proposals', 'update').map((c) => c.payload as Record<string, unknown>).find((p) => 'status' in p);

/** The reads propose_patches makes for a spec batch, in order. */
function scriptFiling(sb: FakeSupabase, policy: unknown, owner = true) {
  if (owner) sb.script('projects', 'select', { data: { id: PROJECT.id, name: PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('projects', 'select', { data: policy, error: null }); // the policy read
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
}

// ── AL.6: Auto applies as it files ──────────────────────────────────────────

Deno.test('AL.6 under Auto the owner\'s agent\'s outcome applies as it files, and reads as applied', async () => {
  const sb = new FakeSupabase();
  scriptFiling(sb, AUTO);
  sb.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:abcd1234' }, error: null });
  const r = await handleProposePatches(sb as never, OWNER_AGENT, { project_id: PROJECT.id, branch_id: BRANCH, patches: [newOutcome], external_agent: 'site-builder' });
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as { status: string; routed: string; message: string };
  assertEquals([data.status, data.routed], ['merged', 'applied']);
  assert(data.message.startsWith('Every lane this batch touches is at Auto, so it applied as it filed'), data.message);
  assertEquals(sb.callsTo('requirement_candidates', 'insert').length, 1, 'the outcome exists');
  const done = decision(sb);
  assertEquals([done.status, done.metadata.resolvedBy, done.metadata.auto], ['merged', 'auto', true]);
  assertEquals(done.patches.map((e: { status: string }) => e.status), ['accepted']);
  // the decision is written only under the claim it took
  const [claim, mark] = sb.callsTo('ai_proposals', 'update');
  const claimedAt = (claim.payload as { reviewed_at: string }).reviewed_at;
  assert(mark.filters.some((f) => f.method === 'eq' && f.args[0] === 'reviewed_at' && f.args[1] === claimedAt), 'marked under its own claim');
});

Deno.test('AL.6 under Propose the same batch files and waits; nothing is claimed or applied', async () => {
  const sb = new FakeSupabase();
  scriptFiling(sb, { automation_policy: { candidates: 1, requirements: 2 } });
  const r = await handleProposePatches(sb as never, OWNER_AGENT, { project_id: PROJECT.id, branch_id: BRANCH, patches: [newOutcome] });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals((r.data as { status: string }).status, 'pending');
  assertEquals(sb.callsTo('ai_proposals', 'update').length, 0);
  assertEquals(sb.callsTo('requirement_candidates', 'insert').length, 0);
});

Deno.test('AL.6 under Auto it still waits for a key that may only propose, a member\'s agent, a promotion, a confirmed requirement, and a vision', async () => {
  const waits = async (sb: FakeSupabase, auth: AuthResult, patches: unknown[]) => {
    const r = await handleProposePatches(sb as never, auth, { project_id: PROJECT.id, branch_id: BRANCH, patches });
    assertEquals(r.success, true, JSON.stringify(r));
    assertEquals((r.data as { status: string }).status, 'pending', JSON.stringify(r.data));
    assertEquals(decision(sb), undefined, 'not decided');
  };
  const proposer = new FakeSupabase();
  scriptFiling(proposer, AUTO);
  await waits(proposer, PROPOSER, [newOutcome]);

  // a contributor's agent on the owner's Team project
  const member = new FakeSupabase();
  member.script('projects', 'select', { data: null, error: null });
  member.script('project_members', 'select', { data: { role: 'contributor', projects: { id: PROJECT.id, name: PROJECT.name, owner_id: 'owner-2' } }, error: null });
  scriptSeatOwner(member, 'owner-2');
  scriptFiling(member, AUTO, false);
  await waits(member, OWNER_AGENT, [newOutcome]);

  const promotion = new FakeSupabase();
  scriptFiling(promotion, AUTO);
  await waits(promotion, OWNER_AGENT, [{ type: 'promote_candidate', payload: { candidateId: CAND } }]);

  const confirmed = new FakeSupabase();
  scriptFiling(confirmed, AUTO);
  confirmed.script('project_specifications', 'select', { data: null, error: null }); // the project's checks read first
  confirmed.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  confirmed.script('specification_requirements', 'select', { data: [{ confirmed: true }], error: null });
  await waits(confirmed, OWNER_AGENT, [{ type: 'update_requirement', payload: { requirementId: 'REQ-004', changes: { description: 'sharper' } } }]);

  // a drafted vision is the person's to confirm (the 9.6 context proposal)
  const vision = new FakeSupabase();
  scriptFiling(vision, AUTO);
  await waits(vision, OWNER_AGENT, [{ type: 'update_vision', payload: { vision: 'Neighbours order bread ahead and collect it warm.' } }, newOutcome]);
  assertEquals(vision.callsTo('requirement_candidates', 'insert').length, 0, 'nothing applied');
});

Deno.test('AL.6 a batch mixing canvas and spec changes is refused, naming both halves; nothing is filed', async () => {
  assertEquals(mixedPlanes([{ type: 'create_candidate' }, { type: 'update_vision' }]), null);
  assertEquals(mixedPlanes([{ type: 'add_node' }, { type: 'add_edge' }]), null);
  const sb = new FakeSupabase();
  scriptFiling(sb, AUTO);
  const r = await handleProposePatches(sb as never, OWNER_AGENT, {
    project_id: PROJECT.id, branch_id: BRANCH,
    patches: [{ type: 'add_node', payload: { id: crypto.randomUUID(), label: 'Kitchen printer', type: 'external-service' } }, newOutcome],
  });
  assertEquals(r.success, false);
  assert(String(r.error).startsWith('This batch mixes canvas changes (add_node) with requirement, outcome, workflow or constraint changes (create_candidate).'), String(r.error));
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);
});

Deno.test('AL.6 under Auto a batch overtaken before it applies is set aside with the reason: nothing applied, nothing waits', async () => {
  const sb = new FakeSupabase();
  scriptFiling(sb, AUTO);
  sb.script('requirement_candidates', 'select', { data: null, error: null }); // the check: the outcome to dismiss is gone
  const r = await handleProposePatches(sb as never, OWNER_AGENT, {
    project_id: PROJECT.id, branch_id: BRANCH, patches: [newOutcome, { type: 'dismiss_candidate', payload: { candidateId: CAND } }],
  });
  assertEquals(r.success, false);
  assert(String(r.error).includes('Nothing was applied. Patch 2 ("dismiss_candidate") would be refused: Candidate not found'), String(r.error));
  assertEquals((r.data as { routed: string }).routed, 'set aside');
  assertEquals(sb.callsTo('requirement_candidates', 'insert').length, 0, 'patch 1 was not applied either');
  const done = decision(sb);
  assertEquals([done.status, done.metadata.resolvedBy], ['rejected', 'auto']);
  assert(String(done.metadata.resolveNote).startsWith('Patch 2 ("dismiss_candidate") would be refused'), done.metadata.resolveNote);
});

// ── AL.8: a waiting proposal holds what it changes ─────────────────────────

Deno.test('AL.8 what a patch holds: the existing things it changes; a create holds nothing', () => {
  assertEquals(specTargetsOf({ type: 'update_requirement', payload: { requirementId: 'REQ-004' } }), ['req:REQ-004']);
  assertEquals(specTargetsOf({ type: 'relate_requirements', payload: { fromRequirementId: 'REQ-1', toRequirementId: 'REQ-2' } }), ['req:REQ-1', 'req:REQ-2']);
  assertEquals(specTargetsOf({ type: 'attach_candidate', payload: { candidateId: 'o1', requirementId: 'REQ-3' } }), ['outcome:o1', 'req:REQ-3']);
  assertEquals(specTargetsOf({ type: 'set_outcome_step_maps', payload: { candidateId: 'o1' } }), ['outcome:o1']);
  assertEquals(specTargetsOf({ type: 'delete_constraint', payload: { constraintId: 'c1' } }), ['constraint:c1']);
  assertEquals(specTargetsOf({ type: 'upsert_workflow_step', payload: { id: 's1', name: 'Pay' } }), ['step:s1']);
  assertEquals(specTargetsOf({ type: 'upsert_workflow_step', payload: { name: 'Pay' } }), []);
  assertEquals(specTargetsOf({ type: 'create_requirement', payload: { name: 'x' } }), []);
  assertEquals(specTargetsOf({ type: 'add_node', payload: { id: 'n1' } }), []);
});

const waitingOnReq4 = (byRowId = true) => ({
  data: [{ id: 'prop-waiting', patches: [{ patch: { type: 'update_requirement', payload: { requirementId: byRowId ? REQ_ROW : 'REQ-004' } } }], metadata: { credentialLabel: 'key · ci runner' } }],
  error: null,
});

Deno.test('AL.8 a second proposal on a requirement another waits on is refused at filing, by code or by row id alike', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT.id, name: PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('ai_proposals', 'select', waitingOnReq4());
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('specification_requirements', 'select', { data: [{ id: REQ_ROW, requirement_id: 'REQ-004' }], error: null }); // by id
  sb.script('specification_requirements', 'select', { data: [{ id: REQ_ROW, requirement_id: 'REQ-004' }], error: null }); // by code
  const r = await handleProposePatches(sb as never, OWNER_AGENT, {
    project_id: PROJECT.id, branch_id: BRANCH, patches: [{ type: 'update_requirement', payload: { requirementId: 'REQ-004', changes: { name: 'Pickup slots' } } }],
  });
  assertEquals(r.success, false);
  const e = String(r.error);
  assert(e.startsWith('Proposal prop-waiting (from key · ci runner) is already waiting on REQ-004, so this update_requirement was not filed'), e);
  assert(e.includes('get_proposal_status') && e.includes('reject it with resolve_proposal') && e.endsWith('Nothing was filed.'), e);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);
});

Deno.test('AL.8 the overlap read: other things, its own session, and a failed read never block', async () => {
  const outcome = [{ type: 'update_candidate', payload: { candidateId: CAND, changes: { name: 'x' } } }];
  const other = new FakeSupabase();
  other.script('ai_proposals', 'select', waitingOnReq4(false));
  assertEquals(await pendingOverlap(other as never, PROJECT.id, outcome), null);

  const same = new FakeSupabase();
  same.script('ai_proposals', 'select', { data: [{ id: 'mine', patches: [{ patch: outcome[0] }], metadata: { externalAgent: 'site-builder' } }], error: null });
  assertEquals((await pendingOverlap(same as never, PROJECT.id, outcome))?.by, 'site-builder');
  const own = new FakeSupabase();
  own.script('ai_proposals', 'select', { data: [{ id: 'mine', patches: [{ patch: outcome[0] }], metadata: {} }], error: null });
  assertEquals(await pendingOverlap(own as never, PROJECT.id, outcome, 'mine'), null);

  const failed = new FakeSupabase();
  failed.script('ai_proposals', 'select', { data: null, error: { message: 'timeout' } });
  assertEquals(await pendingOverlap(failed as never, PROJECT.id, outcome), null);
});

Deno.test('AL.8 a direct write is refused under a waiting proposal on the same requirement; the handler never runs', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT.id, name: PROJECT.name }, error: null });
  sb.script('projects', 'select', { data: AUTO, error: null });
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('specification_requirements', 'select', { data: { id: REQ_ROW, requirement_id: 'REQ-004', locked: false, confirmed: false }, error: null });
  sb.script('ai_proposals', 'select', waitingOnReq4(false));
  let ran = false;
  const r = await routeToolCall(sb as never, OWNER_AGENT, 'update_requirement', { project_id: PROJECT.id, requirement_id: 'REQ-004', name: 'Pickup slots' },
    async () => { ran = true; return { success: true }; });
  assertEquals(r.success, false);
  assert(String(r.error).startsWith('Proposal prop-waiting (from key · ci runner) is already waiting on REQ-004'), String(r.error));
  assertEquals(ran, false);
});

// ── AL.8: one decider at a time ────────────────────────────────────────────

const row = (patches: unknown[]) => ({ id: 'prop-1', status: 'pending', source_branch_id: BRANCH, patches: patches.map((patch) => ({ patch, status: 'pending' })), metadata: { plane: 'spec' } });

Deno.test('AL.8 a decision takes the proposal first: one in progress refuses the second, which applies nothing', async () => {
  const sb = new FakeSupabase();
  sb.script('ai_proposals', 'update', { data: [], error: null }); // someone holds it
  sb.script('ai_proposals', 'select', { data: { status: 'pending', reviewed_at: new Date().toISOString() }, error: null });
  const r = await acceptSpecBatch(sb as never, OWNER_AGENT, PROJECT.id, row([spec('create_candidate', newOutcome.payload)]) as never, { by: 'mcp', note: null });
  assertEquals(r.success, false);
  assert(String(r.error).startsWith('This proposal is being decided right now'), String(r.error));
  assertEquals(sb.callsTo('requirement_candidates', 'insert').length, 0);
});

Deno.test('AL.8 a reject waits for an accept in progress: refused, nothing marked', async () => {
  const { handleResolveProposal } = await import('../mcp-server/tools/approvals.ts');
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('ai_proposals', 'select', { data: row([spec('create_candidate', newOutcome.payload)]), error: null });
  sb.script('branches', 'select', { data: { id: BRANCH, project_id: PROJECT.id }, error: null });
  sb.script('ai_proposals', 'update', { data: [], error: null });
  sb.script('ai_proposals', 'select', { data: { status: 'pending', reviewed_at: new Date().toISOString() }, error: null });
  const r = await handleResolveProposal(sb as never, OWNER_AGENT, { project_id: PROJECT.id, proposal_id: 'prop-1', action: 'reject', note: 'no' });
  assertEquals(r.success, false);
  assert(String(r.error).startsWith('This proposal is being decided right now'), String(r.error));
  assertEquals(decision(sb), undefined);
});

Deno.test('AL.8 a claim left by a decider that died lapses after five minutes and is taken over', async () => {
  const sb = new FakeSupabase();
  const stale = new Date(Date.now() - 6 * 60_000).toISOString();
  sb.script('ai_proposals', 'update', { data: [], error: null });
  sb.script('ai_proposals', 'select', { data: { status: 'pending', reviewed_at: stale }, error: null });
  sb.script('ai_proposals', 'update', { data: [{ id: 'prop-1' }], error: null });
  sb.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:abcd1234' }, error: null });
  const r = await acceptSpecBatch(sb as never, OWNER_AGENT, PROJECT.id, row([spec('create_candidate', newOutcome.payload)]) as never, { by: 'mcp', note: null });
  assertEquals(r.success, true, JSON.stringify(r));
  const takeover = sb.callsTo('ai_proposals', 'update')[1];
  assert(takeover.filters.some((f) => f.method === 'eq' && f.args[0] === 'reviewed_at' && f.args[1] === stale), 'taken only from the claim it saw');
});

// ── AL.8: the batch against the rows as they are now ───────────────────────

Deno.test('AL.8 two promotions in one batch claiming the same criterion: the check refuses the second before anything is written', async () => {
  const sb = new FakeSupabase();
  const candidate = { id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null, key: 'o', kind: 'outcome', name: 'Order ahead', description: '', category: 'functional', criteria: [{ id: 'c1', text: 'Pick a slot' }, { id: 'c2', text: 'Pay' }], status: 'pending', requirement_row_id: null };
  for (let i = 0; i < 2; i++) {
    sb.script('requirement_candidates', 'select', { data: candidate, error: null });
    sb.script('outcome_derivations', 'select', { data: [], error: null });
  }
  const first = spec('promote_candidate', { candidateId: CAND, criteriaIds: ['c1'] });
  const second = spec('promote_candidate', { candidateId: CAND, criteriaIds: ['c1', 'c2'] });
  assertEquals(await preflightSpecBatch(sb as never, PROJECT.id, [first, second]), {
    index: 1, type: 'promote_candidate', error: 'Criterion "Pick a slot" of "Order ahead" is already derived into a requirement.',
  });
});

Deno.test('AL.8 the check: an outcome decided meanwhile, a locked requirement, a requirement deleted meanwhile', async () => {
  const decided = new FakeSupabase();
  decided.script('requirement_candidates', 'select', { data: { id: CAND, name: 'Order ahead', status: 'accepted', criteria: [] }, error: null });
  assertEquals((await preflightSpecBatch(decided as never, PROJECT.id, [spec('update_candidate', { candidateId: CAND, changes: { name: 'x' } })]))?.error,
    '"Order ahead" is settled now: a decided outcome is terminal, so nothing more lands on it. File a new outcome instead.');

  const locked = new FakeSupabase();
  locked.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  locked.script('specification_requirements', 'select', { data: { id: REQ_ROW, requirement_id: 'REQ-004', locked: true }, error: null });
  assert(String((await preflightSpecBatch(locked as never, PROJECT.id, [spec('update_requirement', { requirementId: 'REQ-004', changes: { name: 'x' } })]))?.error).includes('REQ-004'));

  const gone = new FakeSupabase();
  gone.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  gone.script('specification_requirements', 'select', { data: null, error: null });
  assertEquals((await preflightSpecBatch(gone as never, PROJECT.id, [spec('map_requirement', { requirementId: 'REQ-009', nodeIds: [crypto.randomUUID()] })]))?.error,
    'REQ-009 is not a requirement of this project any more.');
});

// ── AL.8: the write that loses a race says so ──────────────────────────────

Deno.test('AL.8 a promotion that loses its REQ number to another takes the next', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', { data: { id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null, key: 'o', kind: 'outcome', name: 'Order ahead', description: '', category: 'functional', criteria: [{ id: 'c1', text: 'Pick a slot' }], status: 'pending', requirement_row_id: null }, error: null });
  sb.script('outcome_derivations', 'select', { data: [], error: null });
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('specification_requirements', 'select', { data: [{ requirement_id: 'REQ-004' }], error: null });
  sb.script('specification_requirements', 'insert', { data: null, error: { message: 'duplicate key', code: '23505' } });
  sb.script('specification_requirements', 'select', { data: [{ requirement_id: 'REQ-005' }], error: null });
  sb.script('specification_requirements', 'insert', { data: { id: 'req-row-6', requirement_id: 'REQ-006' }, error: null });
  const r = await applySpecPatch(sb as never, OWNER_AGENT, PROJECT.id, spec('promote_candidate', { candidateId: CAND }));
  assertEquals(r.applied, true, JSON.stringify(r));
  assertEquals(sb.callsTo('specification_requirements', 'insert').map((c) => (c.payload as { requirement_id: string }).requirement_id), ['REQ-005', 'REQ-006']);
});

Deno.test('AL.8 a dismiss or settle that finds the outcome decided meanwhile changes nothing and says so', async () => {
  const open = { id: CAND, project_id: PROJECT.id, branch_id: BRANCH, name: 'Order ahead', status: 'pending', criteria: [] };
  const dismiss = new FakeSupabase();
  dismiss.script('requirement_candidates', 'select', { data: open, error: null });
  dismiss.script('outcome_derivations', 'select', { data: [], error: null });
  dismiss.script('requirement_candidates', 'update', { data: [], error: null });
  const d = await applySpecPatch(dismiss as never, OWNER_AGENT, PROJECT.id, spec('dismiss_candidate', { candidateId: CAND }));
  assertEquals(d.applied, false);
  assert(String((d as { error: string }).error).startsWith('"Order ahead" was decided while this was waiting; nothing was changed.'), JSON.stringify(d));
  assert(dismiss.callsTo('requirement_candidates', 'update')[0].filters.some((f) => f.method === 'eq' && f.args[0] === 'status' && f.args[1] === 'pending'), 'only while still open');

  const settle = new FakeSupabase();
  settle.script('requirement_candidates', 'select', { data: open, error: null });
  settle.script('outcome_derivations', 'select', { data: [{ id: 'd1' }], error: null });
  settle.script('requirement_candidates', 'update', { data: [], error: null });
  const s = await applySpecPatch(settle as never, { ...OWNER_AGENT, authMethod: 'jwt' } as AuthResult, PROJECT.id, spec('settle_candidate', { candidateId: CAND }));
  assertEquals(s.applied, false);
  assert(String((s as { error: string }).error).startsWith('"Order ahead" was decided while this was waiting'), JSON.stringify(s));
});

// V3 P2 (task 2.4): resolve_proposal — the server accept/reject lane for
// spec-plane proposals. Pins: pending-only; project ownership through the
// branch; the two refusals-by-design (graph proposals belong to the app
// canvas; promotion can never be accepted over MCP — a key cannot approve
// what it proposed); accept applies through applySpecPatch and merges with
// per-patch statuses; a mid-batch refusal leaves PARTIAL, never a silent
// half-merge; reject settles every patch with the note.
// AL.12: a partial proposal closes by reject (what applied stays); a
// reject is never blocked by plane, so a batch filed on both can be cleared.
import { handleResolveProposal } from '../mcp-server/tools/approvals.ts';
import { FakeSupabase, assert, assertEquals, scriptSeatOwner } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const PROP = '33333333-3333-4333-8333-333333333333';
const SPEC = '44444444-4444-4444-8444-444444444444';

const AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] } as never;

const meta = () => ({
  id: crypto.randomUUID(), actorType: 'ai', actorId: 'claude · bench',
  summary: 'bench', timestamp: new Date().toISOString(),
});

// deno-lint-ignore no-explicit-any
function proposalRow(patches: any[], status = 'pending'): any {
  return { id: PROP, status, source_branch_id: BRANCH, patches, metadata: { plane: 'spec' } };
}

/** The update that decides the proposal (AL.8: the claim before it sets only reviewed_at). */
// deno-lint-ignore no-explicit-any
const decision = (sb: FakeSupabase): any => sb.callsTo('ai_proposals', 'update').map((c) => c.payload as Record<string, unknown>).find((p) => 'status' in p);

function prelude(sb: FakeSupabase, row: unknown) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('ai_proposals', 'select', { data: row, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH, project_id: PROJECT.id }, error: null });
}

Deno.test('resolve_proposal: pending-only, ownership through the branch, action vocabulary', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  const badAction = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'merge' });
  assertEquals(badAction.success, false);
  assert(String(badAction.error).includes('accept, reject'));

  const sb2 = new FakeSupabase();
  prelude(sb2, proposalRow([{ patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'x' } }, status: 'pending' }], 'merged'));
  const settled = await handleResolveProposal(sb2 as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(settled.success, false);
  assert(String(settled.error).includes('only pending proposals resolve'));

  const sb3 = new FakeSupabase();
  sb3.script('projects', 'select', { data: PROJECT, error: null });
  sb3.script('ai_proposals', 'select', { data: proposalRow([]), error: null });
  sb3.script('branches', 'select', { data: { id: BRANCH, project_id: 'someone-elses-project' }, error: null });
  const foreign = await handleResolveProposal(sb3 as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(foreign.success, false);
  assert(String(foreign.error).includes('does not belong'));
});

Deno.test('resolve_proposal: graph proposals are refused by plane — the app canvas is their lane', async () => {
  const sb = new FakeSupabase();
  prelude(sb, proposalRow([{ patch: { type: 'add_node', metadata: meta(), payload: {} }, status: 'pending' }]));
  const r = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(r.success, false);
  assert(String(r.error).includes('app canvas'), 'the refusal routes the caller correctly');
});

Deno.test('resolve_proposal: promotion can NEVER be accepted over MCP — a key cannot approve what it proposed', async () => {
  const sb = new FakeSupabase();
  prelude(sb, proposalRow([{ patch: { type: 'promote_candidate', metadata: meta(), payload: { candidateId: crypto.randomUUID() } }, status: 'pending' }]));
  const r = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(r.success, false);
  assert(String(r.error).includes('human act'), 'doctrine named in the refusal');
  assertEquals(sb.callsTo('ai_proposals', 'update').length, 0, 'the proposal stays pending for the app');
});

Deno.test('resolve_proposal accept: applies through the spec lane and merges with per-patch statuses', async () => {
  const sb = new FakeSupabase();
  prelude(sb, proposalRow([
    { patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'Architecture as data.' } }, explanation: 'v', status: 'pending' },
  ]));
  // applySpecPatch → handleUpdateVision internals: resolve, spec select, update.
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('project_specifications', 'update', { data: null, error: null });
  sb.script('ai_proposals', 'update', { data: null, error: null });

  const r = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.status, 'merged');
  assertEquals(data.applied, 1);
  const upd = decision(sb);
  assertEquals(upd.status, 'merged');
  assert(!!upd.merged_at && !!upd.reviewed_at);
  assertEquals(upd.patches[0].status, 'accepted');
});

Deno.test('resolve_proposal accept (AL.8): a batch another agent overtook applies NOTHING and stays pending, never half', async () => {
  const sb = new FakeSupabase();
  prelude(sb, proposalRow([
    { patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'Would apply first.' } }, status: 'pending' },
    { patch: { type: 'dismiss_candidate', metadata: meta(), payload: { candidateId: crypto.randomUUID() } }, status: 'pending' },
    { patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'Never reached.' } }, status: 'pending' },
  ]));
  // the check reads patch 2's outcome first: it is gone from the project.
  sb.script('requirement_candidates', 'select', { data: null, error: null });

  const r = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(r.success, false);
  assert(String(r.error).startsWith('Nothing was applied. Patch 2 ("dismiss_candidate") would be refused: Candidate not found'), String(r.error));
  // deno-lint-ignore no-explicit-any
  assertEquals((r.data as any).status, 'pending');
  assertEquals(sb.callsTo('project_specifications', 'update').length, 0, 'patch 1 was not applied either');
  assertEquals(decision(sb), undefined, 'the proposal is not marked');
  // the claim is taken and handed back, so the proposal can be decided again
  const claims = sb.callsTo('ai_proposals', 'update').map((c) => (c.payload as { reviewed_at: unknown }).reviewed_at);
  assertEquals([typeof claims[0], claims[1]], ['string', null]);
});

Deno.test('resolve_proposal accept: a refusal only the apply can see still leaves PARTIAL with honest per-patch statuses', async () => {
  const sb = new FakeSupabase();
  prelude(sb, proposalRow([
    { patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'First applies.' } }, status: 'pending' },
    { patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'The write fails.' } }, status: 'pending' },
    { patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'Never reached.' } }, status: 'pending' },
  ]));
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('project_specifications', 'update', { data: null, error: null });
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('project_specifications', 'update', { data: null, error: { message: 'connection reset' } });

  const r = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(r.success, false);
  assert(String(r.error).includes('partial'), 'the failure names the state');
  const upd = decision(sb);
  assertEquals(upd.status, 'partial');
  assertEquals(upd.patches.map((e: { status: string }) => e.status), ['accepted', 'failed', 'pending']);
});

Deno.test('resolve_proposal reject: settles every patch with the note, no applies', async () => {
  const sb = new FakeSupabase();
  prelude(sb, proposalRow([
    { patch: { type: 'update_requirement', metadata: meta(), payload: { requirementId: 'REQ-001', changes: { name: 'x' } } }, status: 'pending' },
  ]));
  sb.script('ai_proposals', 'update', { data: null, error: null });
  const r = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject', note: 'not now' });
  assertEquals(r.success, true);
  const upd = decision(sb);
  assertEquals(upd.status, 'rejected');
  assertEquals(upd.patches[0].status, 'rejected');
  assertEquals(upd.metadata.resolveNote, 'not now');
  assertEquals(sb.callsTo('specification_requirements', 'update').length, 0, 'nothing applied');
});

// ── 8.1: the audit names the channel ─────────────────────────────────────────

Deno.test('8.1: the resolved row says who decided — the app (a session) or MCP (a delegate)', async () => {
  const JWT = { userId: 'user-1', authMethod: 'jwt', scopes: ['read', 'write', 'propose'] } as never;
  const row = () => proposalRow([{ patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'x' } }, status: 'pending' }]);

  const app = new FakeSupabase();
  prelude(app, row());
  app.script('ai_proposals', 'update', { data: null, error: null });
  const viaApp = await handleResolveProposal(app as never, JWT, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject', note: 'not now' });
  assertEquals(viaApp.success, true, JSON.stringify(viaApp));
  const appMeta = decision(app).metadata;
  assertEquals(appMeta.resolvedBy, 'app');
  assertEquals(appMeta.resolveNote, 'not now');
  assertEquals(appMeta.plane, 'spec', 'the proposal\'s own metadata survives the stamp');

  const mcp = new FakeSupabase();
  prelude(mcp, row());
  mcp.script('ai_proposals', 'update', { data: null, error: null });
  const viaKey = await handleResolveProposal(mcp as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject' });
  assertEquals(viaKey.success, true, JSON.stringify(viaKey));
  assertEquals(decision(mcp).metadata.resolvedBy, 'mcp');
});

// ── 7.0: who decides ───────────────────────────────────────────────────────
Deno.test('resolve_proposal (7.0): a contributor never settles; a maintainer settles in person, never through an agent; proposer ≠ approver for a maintainer\'s promotion', async () => {
  const seat = (role: string) => {
    const sb = new FakeSupabase();
    sb.script('projects', 'select', { data: null, error: null });
    sb.script('project_members', 'select', { data: { role, projects: { ...PROJECT, owner_id: 'user-1' } }, error: null });
    scriptSeatOwner(sb, 'user-1'); // seats are Team and above
    return sb;
  };
  const MEMBER_KEY = { userId: 'user-2', authMethod: 'api_key', keyId: 'k2', scopes: ['read', 'write'] } as never;
  const MEMBER_JWT = { userId: 'user-2', authMethod: 'jwt', scopes: ['read', 'write'] } as never;

  const contributor = await handleResolveProposal(seat('contributor') as never, MEMBER_JWT, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject' });
  assert(!contributor.success && String(contributor.error).includes("owner's call") && String(contributor.error).includes('contributor'), JSON.stringify(contributor));

  const agent = await handleResolveProposal(seat('maintainer') as never, MEMBER_KEY, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject' });
  assert(!agent.success && String(agent.error).includes("a member's agent never approves"), JSON.stringify(agent));

  // a maintainer in person passes the cap and reaches the proposal
  const person = seat('maintainer');
  person.script('ai_proposals', 'select', { data: null, error: null });
  const reached = await handleResolveProposal(person as never, MEMBER_JWT, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject' });
  assert(!reached.success && String(reached.error).includes('Proposal not found'), JSON.stringify(reached));

  // R6: the maintainer may not accept a promotion their own agent filed
  const own = seat('maintainer');
  own.script('ai_proposals', 'select', { data: { ...proposalRow([{ patch: { type: 'promote_candidate', metadata: meta(), payload: { candidateId: crypto.randomUUID() } }, status: 'pending' }]), metadata: { plane: 'spec', proposedByUserId: 'user-2' } }, error: null });
  own.script('branches', 'select', { data: { id: BRANCH, project_id: PROJECT.id }, error: null });
  const r6 = await handleResolveProposal(own as never, MEMBER_JWT, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assert(!r6.success && String(r6.error).includes('proposer and approver must differ'), JSON.stringify(r6));
  assertEquals(own.callsTo('ai_proposals', 'update').length, 0, 'nothing settled');
});

// ── AL.12: a partial proposal closes; a reject is never blocked by plane ────

Deno.test('AL.12 reject closes a partial proposal: what applied stays accepted, the rest is rejected, the note says so, nothing applies', async () => {
  const sb = new FakeSupabase();
  prelude(sb, proposalRow([
    { patch: { type: 'create_candidate', metadata: meta(), payload: { branchId: BRANCH, name: 'A' } }, status: 'accepted' },
    { patch: { type: 'update_requirement', metadata: meta(), payload: { requirementId: 'REQ-001', changes: { name: 'x' } } }, status: 'failed' },
    { patch: { type: 'update_requirement', metadata: meta(), payload: { requirementId: 'REQ-002', changes: { name: 'y' } } }, status: 'pending' },
  ], 'partial'));
  sb.script('ai_proposals', 'update', { data: [{ id: PROP }], error: null });
  const r = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject' });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals((r.data as { status: string; closedAfterPartial: boolean; applied: number }).status, 'rejected');
  assertEquals((r.data as { applied: number }).applied, 1);
  const upd = decision(sb);
  assertEquals(upd.status, 'rejected');
  assertEquals(upd.patches.map((e: { status: string }) => e.status), ['accepted', 'rejected', 'rejected']);
  assertEquals(upd.metadata.closedAfterPartial, true);
  assertEquals(upd.metadata.resolveNote, 'Closed after a partial apply: 1 of 3 patch(es) applied and stay; the rest were not applied.');
  const call = sb.callsTo('ai_proposals', 'update')[0];
  assert(call.filters.some((f) => f.method === 'eq' && f.args[0] === 'status' && f.args[1] === 'partial'), 'lands only while still partial');
  assertEquals(sb.callsTo('specification_requirements', 'update').length, 0, 'nothing applied');
  assertEquals(sb.callsTo('requirement_candidates', 'insert').length, 0, 'nothing applied');
});

Deno.test('AL.12 a partial proposal: accept says what applied and how to clear it; closing twice says it was closed; a note of your own is kept', async () => {
  const row = proposalRow([
    { patch: { type: 'update_vision', metadata: meta(), payload: { vision: 'x' } }, status: 'accepted' },
    { patch: { type: 'update_requirement', metadata: meta(), payload: { requirementId: 'REQ-001', changes: { name: 'x' } } }, status: 'failed' },
  ], 'partial');
  const a = new FakeSupabase();
  prelude(a, row);
  const accept = await handleResolveProposal(a as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(accept.success, false);
  assertEquals(accept.error, 'Proposal is partial: 1 of 2 patch(es) applied and stay applied; the rest were refused. Reject it to close it, then re-propose what is left.');
  assertEquals(a.callsTo('ai_proposals', 'update').length, 0);

  const twice = new FakeSupabase();
  prelude(twice, row);
  twice.script('ai_proposals', 'update', { data: [], error: null });
  const r = await handleResolveProposal(twice as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject', note: 'done with it' });
  assertEquals(r.success, false);
  assertEquals(r.error, 'This proposal was already closed.');
  assertEquals(decision(twice).metadata.resolveNote, 'done with it');
});

Deno.test('AL.12 a reject is never blocked by plane: a pending proposal carrying graph patches rejects; accepting it is still the canvas\'s', async () => {
  const mixed = proposalRow([
    { patch: { type: 'add_node', metadata: meta(), payload: {} }, status: 'pending' },
    { patch: { type: 'create_candidate', metadata: meta(), payload: { branchId: BRANCH, name: 'A' } }, status: 'pending' },
  ]);
  const sb = new FakeSupabase();
  prelude(sb, mixed);
  sb.script('ai_proposals', 'update', { data: null, error: null });
  const r = await handleResolveProposal(sb as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'reject', note: 'filed on both planes' });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals(decision(sb).status, 'rejected');
  assertEquals(decision(sb).patches.map((e: { status: string }) => e.status), ['rejected', 'rejected']);

  const sb2 = new FakeSupabase();
  prelude(sb2, mixed);
  const accept = await handleResolveProposal(sb2 as never, AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(accept.success, false);
  assert(String(accept.error).includes('app canvas'), String(accept.error));
  assertEquals(sb2.callsTo('ai_proposals', 'update').length, 0);
});

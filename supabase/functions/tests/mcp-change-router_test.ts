// V3 P2 (task 2.4): the change router. Pins: the no-regression DEFAULTS
// matrix (today's effective routing, lane by lane, with the WHY), policy
// normalization (strings/numbers/junk, code unraisable), the lane table
// (workflow kind rides the candidates tier — the "lane" collision pin),
// the routing matrix incl. NEVER_AUTO_APPLY forcing propose at auto, the
// transport wrap's three routes (refuse never calls the handler; propose
// files a pending plane:spec proposal and changes nothing; apply calls
// the handler and records a MERGED audit row whose failure never fails
// the edit), and propose_patches' widened validation (spec ops parse with
// field-level errors; junk still refused; graph lane untouched).
import {
  EFFECTIVE_DEFAULTS,
  resolveAutomationPolicy,
  laneOfPatchType,
  routeChange,
  routeToolCall,
  strictestRoute,
  requirementRefsOf,
} from '../mcp-server/tools/change-router.ts';
import { validateAndNormalizeProposalPatch } from '../mcp-server/tools/proposals.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] } as never;

Deno.test('defaults matrix: shipped defaults mirror TODAY, not the recommended posture', () => {
  // Requirements/Candidates/Tasks/Tests write directly today → auto-apply.
  assertEquals(EFFECTIVE_DEFAULTS.requirements, 2);
  assertEquals(EFFECTIVE_DEFAULTS.candidates, 2);
  assertEquals(EFFECTIVE_DEFAULTS.tasks, 2);
  assertEquals(EFFECTIVE_DEFAULTS.tests, 2);
  // propose_patches is the ONLY graph path today → propose.
  assertEquals(EFFECTIVE_DEFAULTS.architecture, 1);
  // NodeSpec never writes code.
  assertEquals(EFFECTIVE_DEFAULTS.code, 0);
});

Deno.test('policy normalization: strings and numbers read, junk falls back, code can never be raised', () => {
  const p = resolveAutomationPolicy({ requirements: '1', architecture: 2, tests: 'banana', code: '2' });
  assertEquals(p.requirements, 1);
  assertEquals(p.architecture, 2);
  assertEquals(p.tests, 2, 'junk falls back to the default');
  assertEquals(p.code, 0, 'the code lane is pinned whatever the row says');
  const empty = resolveAutomationPolicy({});
  assertEquals(empty, { ...EFFECTIVE_DEFAULTS });
  const junk = resolveAutomationPolicy('not-an-object');
  assertEquals(junk.requirements, 2);
});

Deno.test('lane table: kinds map to tiers; workflow structure rides the candidates (ideation) tier', () => {
  assertEquals(laneOfPatchType('update_requirement'), 'requirements');
  assertEquals(laneOfPatchType('update_vision'), 'requirements');
  assertEquals(laneOfPatchType('create_candidate'), 'candidates');
  assertEquals(laneOfPatchType('promote_candidate'), 'candidates');
  assertEquals(laneOfPatchType('upsert_workflow'), 'candidates');
  assertEquals(laneOfPatchType('set_outcome_step_maps'), 'candidates');
  assertEquals(laneOfPatchType('add_node'), 'architecture');
});

Deno.test('routing matrix: 0 refuses, 1 proposes, 2 applies — and promotion proposes even at auto', () => {
  const auto = resolveAutomationPolicy({});
  assertEquals(routeChange(auto, 'update_requirement'), 'apply');
  assertEquals(routeChange(auto, 'promote_candidate'), 'propose', 'NEVER_AUTO_APPLY holds at level 2');
  const propose = resolveAutomationPolicy({ requirements: '1' });
  assertEquals(routeChange(propose, 'update_requirement'), 'propose');
  const ask = resolveAutomationPolicy({ requirements: '0' });
  assertEquals(routeChange(ask, 'delete_requirement'), 'refuse');
});

Deno.test('routeToolCall level 0: refused with guidance, the handler is NEVER invoked', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('projects', 'select', { data: { automation_policy: { requirements: '0' } }, error: null });
  let handlerRan = false;
  const r = await routeToolCall(sb as never, AUTH, 'update_requirement',
    { project_id: PROJECT.id, requirement_id: 'REQ-001', name: 'renamed' },
    // deno-lint-ignore require-await
    async () => { handlerRan = true; return { success: true }; });
  assertEquals(r.success, false);
  assert(String(r.error).includes('Ask first'), 'the refusal names the lane setting');
  assert(String(r.error).includes('propose_patches'), 'and leaves the explicit-proposal door open');
  assertEquals(handlerRan, false, 'nothing touched the requirement');
});

Deno.test('routeToolCall level 1: files a pending plane:spec proposal, changes NOTHING, points at the queue', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('projects', 'select', { data: { automation_policy: { requirements: '1' } }, error: null });
  sb.script('branches', 'select', { data: [{ id: BRANCH, is_primary: true }], error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  let handlerRan = false;
  const r = await routeToolCall(sb as never, AUTH, 'update_requirement',
    { project_id: PROJECT.id, requirement_id: 'REQ-001', description: 'sharper wording', external_agent: 'claude · bench' },
    // deno-lint-ignore require-await
    async () => { handlerRan = true; return { success: true }; });
  assertEquals(handlerRan, false, 'propose means NOTHING was changed');
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.routed, 'proposed');
  assert(!!data.proposalId);
  // deno-lint-ignore no-explicit-any
  const ins = sb.callsTo('ai_proposals', 'insert')[0].payload as any;
  assertEquals(ins.status, 'pending');
  assertEquals(ins.metadata.plane, 'spec');
  assertEquals(ins.patches[0].patch.type, 'update_requirement');
  assertEquals(ins.patches[0].patch.payload.changes.description, 'sharper wording');
});

Deno.test('routeToolCall level 2 (default): the handler runs and a MERGED audit row records it; audit failure never fails the edit', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('projects', 'select', { data: { automation_policy: {} }, error: null });
  sb.script('branches', 'select', { data: [{ id: BRANCH, is_primary: true }], error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  const r = await routeToolCall(sb as never, AUTH, 'update_vision',
    { project_id: PROJECT.id, vision: 'Architecture as data.' },
    // deno-lint-ignore require-await
    async () => ({ success: true, data: { specificationId: 'spec-1' } }));
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.routed, 'applied');
  assert(!!data.recordedProposalId, 'the audit row id rides the response');
  assertEquals(data.specificationId, 'spec-1', 'the handler result survives');
  // deno-lint-ignore no-explicit-any
  const rec = sb.callsTo('ai_proposals', 'insert')[0].payload as any;
  assertEquals(rec.status, 'merged');
  assertEquals(rec.metadata.auto, true);
  assertEquals(rec.patches[0].status, 'accepted');

  // Audit failure: no branch to attach to → the edit still succeeds, quietly.
  const sb2 = new FakeSupabase();
  sb2.script('projects', 'select', { data: PROJECT, error: null });
  sb2.script('projects', 'select', { data: { automation_policy: {} }, error: null });
  sb2.script('branches', 'select', { data: [], error: null });
  const r2 = await routeToolCall(sb2 as never, AUTH, 'update_vision',
    { project_id: PROJECT.id, vision: 'Still applies.' },
    // deno-lint-ignore require-await
    async () => ({ success: true, data: { specificationId: 'spec-1' } }));
  assertEquals(r2.success, true);
  assertEquals(sb2.callsTo('ai_proposals', 'insert').length, 0);
});

Deno.test('routeToolCall: unroutable args fall through to the handler, which owns the argument errors', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  let handlerRan = false;
  const r = await routeToolCall(sb as never, AUTH, 'update_vision',
    { project_id: PROJECT.id }, // no vision — buildSpecPatch cannot express it
    // deno-lint-ignore require-await
    async () => { handlerRan = true; return { success: false, error: 'vision is required' }; });
  assertEquals(handlerRan, true);
  assertEquals(r.success, false);
});

Deno.test('propose_patches widening: spec ops validate with field-level errors; junk refused; graph lane untouched', () => {
  const spec = validateAndNormalizeProposalPatch(
    { type: 'update_vision', payload: { vision: 'A CRM for small teams' } }, 0, 'set the vision', 'claude · bench');
  assert(!('error' in spec), JSON.stringify(spec));
  // deno-lint-ignore no-explicit-any
  assertEquals((spec as any).patch.metadata.actorId, 'claude · bench', 'metadata enriched the same way');

  const bad = validateAndNormalizeProposalPatch(
    { type: 'update_requirement', payload: { requirementId: 'REQ-001' } }, 0, 'x', 'a');
  assert('error' in bad && String(bad.error).includes('changes'), 'field-level errors name the gap');

  const junk = validateAndNormalizeProposalPatch({ type: 'reboot_prod', payload: {} }, 0, 'x', 'a');
  assert('error' in junk && String(junk.error).includes('spec-plane'), 'the type error now teaches both planes');

  const graph = validateAndNormalizeProposalPatch(
    { type: 'remove_node', payload: { id: crypto.randomUUID() } }, 0, 'drop it', 'a');
  assert(!('error' in graph), 'graph ops validate exactly as before');
});

// 9.6: a MIXED batch answers to the strictest lane its ops touch. The
// context proposal (update_vision on the requirements lane + lanes, steps
// and outcomes on the candidates lane) is the case that matters: the
// candidates lane's level names the batch, however open requirements is.
Deno.test('strictestRoute (9.6): a mixed batch takes the strictest lane; promotion pins propose at auto; an empty batch applies with no lane', () => {
  const CONTEXT = ['update_vision', 'upsert_workflow', 'upsert_workflow_step', 'create_candidate'];
  const off = resolveAutomationPolicy({ requirements: '2', candidates: '0' });
  assertEquals(strictestRoute(off, CONTEXT), { route: 'refuse', lane: 'candidates' });
  const review = resolveAutomationPolicy({ requirements: '2', candidates: '1' });
  assertEquals(strictestRoute(review, CONTEXT), { route: 'propose', lane: 'candidates' });
  const open = resolveAutomationPolicy({ requirements: '2', candidates: '2' });
  assertEquals(strictestRoute(open, CONTEXT), { route: 'apply', lane: 'requirements' }, 'when every lane applies, the first op names the lane');
  assertEquals(strictestRoute(open, ['update_vision', 'promote_candidate']), { route: 'propose', lane: 'candidates' }, 'NEVER_AUTO_APPLY holds inside a batch');
  const strictReq = resolveAutomationPolicy({ requirements: '0', candidates: '2' });
  assertEquals(strictestRoute(strictReq, CONTEXT), { route: 'refuse', lane: 'requirements' }, 'the strictest lane wins whichever op carries it');
  assertEquals(strictestRoute(open, []), { route: 'apply', lane: null });
});

// ── V3 2.4 (2026-09-19): the ladder ──────────────────────────────────────────
// The lane's level governs OPEN rows; a CONFIRMED row always comes back as a
// proposal; a LOCKED row refuses before the handler, in the lock's own words.
const SPEC_ROW = { id: '55555555-5555-4555-8555-555555555555' };
const reqRow = (over: Record<string, unknown> = {}) => ({
  id: '66666666-6666-4666-8666-666666666666', requirement_id: 'REQ-001', name: 'Store tasks', description: 'd',
  locked: false, confirmed: false, acceptance_criteria: [], updated_at: '2026-09-19T10:00:00Z', ...over,
});

Deno.test('ladder: an OPEN row at level 2 applies (the handler runs) and the row is read once', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('projects', 'select', { data: { automation_policy: {} }, error: null });
  sb.script('project_specifications', 'select', { data: SPEC_ROW, error: null });
  sb.script('specification_requirements', 'select', { data: reqRow(), error: null });
  sb.script('branches', 'select', { data: [{ id: BRANCH, is_primary: true }], error: null });
  let handlerRan = false;
  const r = await routeToolCall(sb as never, AUTH, 'update_requirement',
    { project_id: PROJECT.id, requirement_id: 'REQ-001', name: 'renamed' },
    // deno-lint-ignore require-await
    async () => { handlerRan = true; return { success: true }; });
  assertEquals(r.success, true, r.error);
  assertEquals(handlerRan, true);
  assertEquals((r.data as { routed: string }).routed, 'applied');
  assertEquals(sb.callsTo('specification_requirements', 'select').length, 1, 'the ladder and the precondition check share one read');
});

Deno.test('ladder: a CONFIRMED row at level 2 files a proposal instead; the handler never runs', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('projects', 'select', { data: { automation_policy: {} }, error: null });
  sb.script('project_specifications', 'select', { data: SPEC_ROW, error: null });
  sb.script('specification_requirements', 'select', { data: reqRow({ confirmed: true }), error: null });
  sb.script('branches', 'select', { data: [{ id: BRANCH, is_primary: true }], error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  let handlerRan = false;
  const r = await routeToolCall(sb as never, AUTH, 'update_requirement',
    { project_id: PROJECT.id, requirement_id: 'REQ-001', name: 'renamed' },
    // deno-lint-ignore require-await
    async () => { handlerRan = true; return { success: true }; });
  assertEquals(r.success, true, r.error);
  assertEquals(handlerRan, false, 'nothing touched the confirmed requirement');
  // deno-lint-ignore no-explicit-any
  const d = r.data as any;
  assertEquals(d.routed, 'proposed');
  assertEquals(d.reason, 'confirmed');
  assertEquals(d.requirement, 'REQ-001');
  assert(String(d.message).includes('REQ-001 is confirmed'), d.message);
  // deno-lint-ignore no-explicit-any
  const rec = sb.callsTo('ai_proposals', 'insert')[0].payload as any;
  assertEquals(rec.status, 'pending');
  assertEquals(rec.metadata.plane, 'spec');
});

Deno.test('ladder: a CONFIRMED row at level 0 is still refused, before any row is read', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('projects', 'select', { data: { automation_policy: { requirements: '0' } }, error: null });
  const r = await routeToolCall(sb as never, AUTH, 'update_requirement',
    { project_id: PROJECT.id, requirement_id: 'REQ-001', name: 'renamed' },
    // deno-lint-ignore require-await
    async () => ({ success: true }));
  assertEquals(r.success, false);
  assert(String(r.error).includes('Ask first'));
  assertEquals(sb.callsTo('specification_requirements', 'select').length, 0);
});

Deno.test('ladder: a LOCKED row refuses at level 2 and at level 1, in the lock\'s words, with no proposal and no handler', async () => {
  for (const policy of [{}, { requirements: '1' }]) {
    const sb = new FakeSupabase();
    sb.script('projects', 'select', { data: PROJECT, error: null });
    sb.script('projects', 'select', { data: { automation_policy: policy }, error: null });
    sb.script('project_specifications', 'select', { data: SPEC_ROW, error: null });
    sb.script('specification_requirements', 'select', { data: reqRow({ locked: true, confirmed: true }), error: null });
    let handlerRan = false;
    const r = await routeToolCall(sb as never, AUTH, 'update_requirement',
      { project_id: PROJECT.id, requirement_id: 'REQ-001', name: 'renamed' },
      // deno-lint-ignore require-await
      async () => { handlerRan = true; return { success: true }; });
    assertEquals(r.success, false);
    assert(String(r.error).includes('REQ-001 is locked'), r.error);
    assert(String(r.error).includes('No tool unlocks'), r.error);
    assertEquals(handlerRan, false);
    assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);
  }
});

Deno.test('ladder: map_requirement and relate_requirements resolve their rows too; a locked endpoint refuses', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('projects', 'select', { data: { automation_policy: {} }, error: null });
  sb.script('project_specifications', 'select', { data: SPEC_ROW, error: null });
  sb.script('specification_requirements', 'select', { data: reqRow(), error: null });
  sb.script('specification_requirements', 'select', { data: reqRow({ id: '77777777-7777-4777-8777-777777777777', requirement_id: 'REQ-002', locked: true }), error: null });
  const r = await routeToolCall(sb as never, AUTH, 'relate_requirements',
    { project_id: PROJECT.id, from_requirement_id: 'REQ-001', to_requirement_id: 'REQ-002', relation_type: 'depends_on' },
    // deno-lint-ignore require-await
    async () => ({ success: true }));
  assertEquals(r.success, false);
  assert(String(r.error).includes('REQ-002 is locked'), r.error);
  assertEquals(requirementRefsOf({ type: 'map_requirement', payload: { requirementId: 'REQ-009', nodeIds: [] } } as never), ['REQ-009']);
  assertEquals(requirementRefsOf({ type: 'update_vision', payload: { vision: 'v' } } as never), []);
});

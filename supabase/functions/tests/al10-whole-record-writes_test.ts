// AL.10 (owner 2026-10-01: "fix bullet #2"): writes that replace a whole
// list no longer erase what another agent wrote a moment before. Each one
// now lands only on the row as it was read; when the row moved, it is read
// again and decided again (three tries), and refuses rather than write over.
//   - update_requirement's criteria: a test result or tick recorded between
//     the read and the write is carried forward, never erased;
//   - report_test_results and update_test_case bindings: a criterion another
//     agent bound a moment ago reads as a conflict, never stolen;
//   - update_constraint's waivers: a waiver added meanwhile is kept.
// The app's waiver lift is in src/tests/al10-whole-record-writes.test.ts.
import { handleUpdateRequirement } from '../mcp-server/tools/requirements.ts';
import { handleReportTestResults, handleUpdateTestCase } from '../mcp-server/tools/test-results.ts';
import { applySpecPatch } from '../mcp-server/tools/spec-patch-apply.ts';
import { SpecPatchOperationSchema } from '../_shared/spec-patch-schema.ts';
import { FakeSupabase, assert, assertEquals, scriptOwnerPlan } from './helpers.ts';
// deno-lint-ignore no-explicit-any
type Any = any;

const AUTH: Any = { userId: 'user-1', scopes: ['read', 'write', 'propose'], authMethod: 'api_key', keyId: 'k1' };
const PROJECT = '00000000-0000-4000-8000-000000000001';
const REQ_ROW = '77777777-7777-4777-8777-777777777777';
const CASE_MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASE_THEIRS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T0 = '2026-10-01T12:00:00.000+00:00';
const T1 = '2026-10-01T12:00:01.000+00:00';
const MOVED = { data: null, error: { code: '40001', message: 'apply_criteria_ops: the requirement moved since you read it (expected x, found y), re-read and retry' } };

const reqRow = (criteria: Any[], updated_at: string | null = T0, over: Any = {}) =>
  ({ data: { id: REQ_ROW, requirement_id: 'REQ-001', name: 'R', locked: false, acceptance_criteria: criteria, updated_at, ...over }, error: null });

function base(sb: FakeSupabase) {
  sb.script('projects', 'select', { data: { id: PROJECT, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
}
const guardOf = (call: { filters: Array<{ method: string; args: unknown[] }> }) =>
  call.filters.find((f) => f.args[0] === 'updated_at');

// ── update_requirement ──────────────────────────────────────────────────────

Deno.test('AL.10 a test result recorded between the read and the write is carried forward, not erased', async () => {
  const sb = new FakeSupabase();
  base(sb);
  sb.script('specification_requirements', 'select', reqRow([{ id: 'c1', text: 'Pickup slots show', met: false }]));
  sb.script('specification_requirements', 'update', { data: [], error: null }); // moved meanwhile
  sb.script('specification_requirements', 'select', reqRow([{ id: 'c1', text: 'Pickup slots show', met: true, testId: CASE_THEIRS }], T1));
  sb.script('specification_requirements', 'update', { data: [{ id: REQ_ROW }], error: null });
  const r = await handleUpdateRequirement(sb as never, AUTH, {
    project_id: PROJECT, requirement_id: 'REQ-001',
    acceptance_criteria: ['Pickup slots show', 'A full slot says so'],
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const [first, second] = sb.callsTo('specification_requirements', 'update');
  assertEquals([guardOf(first)?.method, guardOf(first)?.args[1]], ['eq', T0], 'the first write lands only on the row as read');
  assertEquals(guardOf(second)?.args[1], T1, 'the second, on the row as re-read');
  assertEquals((second.payload as Any).acceptance_criteria, [
    { id: 'c1', text: 'Pickup slots show', met: true, testId: CASE_THEIRS },
    { text: 'A full slot says so', met: false },
  ]);
});

Deno.test('AL.10 a row that keeps moving is refused after three tries; one locked meanwhile is refused as locked', async () => {
  const busy = new FakeSupabase();
  base(busy);
  for (let i = 0; i < 3; i++) {
    busy.script('specification_requirements', 'select', reqRow([{ text: 'A' }], `2026-10-01T12:00:0${i}.000+00:00`));
    busy.script('specification_requirements', 'update', { data: [], error: null });
  }
  const r = await handleUpdateRequirement(busy as never, AUTH, { project_id: PROJECT, requirement_id: 'REQ-001', acceptance_criteria: ['A', 'B'] });
  assertEquals(r.success, false);
  assert(String(r.error).startsWith('REQ-001 kept changing while this was written'), String(r.error));
  assertEquals(busy.callsTo('specification_requirements', 'update').length, 3);

  const locked = new FakeSupabase();
  base(locked);
  locked.script('specification_requirements', 'select', reqRow([{ text: 'A' }]));
  locked.script('specification_requirements', 'update', { data: [], error: null });
  locked.script('specification_requirements', 'select', reqRow([{ text: 'A' }], T1, { locked: true }));
  const r2 = await handleUpdateRequirement(locked as never, AUTH, { project_id: PROJECT, requirement_id: 'REQ-001', acceptance_criteria: ['A', 'B'] });
  assertEquals(r2.success, false);
  assert(String(r2.error).includes('REQ-001') && /locked/i.test(String(r2.error)), String(r2.error));
  assertEquals(locked.callsTo('specification_requirements', 'update').length, 1);
});

Deno.test('AL.10 a row never stamped is guarded as unstamped; an edit that leaves the criteria alone is not guarded', async () => {
  const sb = new FakeSupabase();
  base(sb);
  sb.script('specification_requirements', 'select', reqRow([{ text: 'A' }], null));
  sb.script('specification_requirements', 'update', { data: [{ id: REQ_ROW }], error: null });
  await handleUpdateRequirement(sb as never, AUTH, { project_id: PROJECT, requirement_id: 'REQ-001', acceptance_criteria: ['A'] });
  assertEquals([guardOf(sb.callsTo('specification_requirements', 'update')[0])?.method], ['is']);

  const named = new FakeSupabase();
  base(named);
  named.script('specification_requirements', 'select', reqRow([{ text: 'A' }]));
  named.script('specification_requirements', 'update', { data: null, error: null });
  const r = await handleUpdateRequirement(named as never, AUTH, { project_id: PROJECT, requirement_id: 'REQ-001', name: 'Pickup' });
  assertEquals(r.success, true);
  assertEquals(guardOf(named.callsTo('specification_requirements', 'update')[0]), undefined);
});

// ── test bindings ───────────────────────────────────────────────────────────

const report = (sb: FakeSupabase) => handleReportTestResults(sb as never, AUTH, {
  project_id: PROJECT, requirement_id: REQ_ROW,
  results: [{ test_id: 'TC-1', status: 'passed', criterion_text: 'Pickup slots show' }],
});

Deno.test('AL.10 report_test_results: a criterion another agent bound a moment ago is a conflict, not stolen', async () => {
  const sb = new FakeSupabase();
  base(sb);
  sb.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show', met: false }]));
  sb.script('test_cases', 'select', { data: [{ id: CASE_MINE, test_id: 'TC-1', status: 'not_started' }], error: null });
  sb.script('rpc', 'apply_criteria_ops', MOVED);
  sb.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show', met: false, testId: CASE_THEIRS }], T1));
  sb.script('test_cases', 'select', { data: [{ id: CASE_THEIRS, test_id: 'TC-9' }], error: null }); // the conflict's name
  const r = await report(sb);
  assertEquals(r.success, true, JSON.stringify(r));
  const binds = sb.callsTo('rpc', 'apply_criteria_ops').filter((c) => ((c.payload as Any).p_ops as Any[]).some((o) => o.op === 'bind'));
  assertEquals(binds.length, 1, 'one bind tried; the re-read showed it taken');
  assertEquals((binds[0].payload as Any).p_expected_updated_at, T0, 'the bind lands only on the row as read');
  const outcome = (r.data as Any).results[0];
  assertEquals([outcome.criterionBinding, outcome.boundTestId], ['conflict', 'TC-9']);
});

Deno.test('AL.10 report_test_results: when the row moved for another reason the bind is decided again and lands', async () => {
  const sb = new FakeSupabase();
  base(sb);
  sb.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show', met: false }, { text: 'B', met: false }]));
  sb.script('test_cases', 'select', { data: [{ id: CASE_MINE, test_id: 'TC-1', status: 'not_started' }], error: null });
  sb.script('rpc', 'apply_criteria_ops', MOVED);
  sb.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show', met: false }, { text: 'B', met: true, testId: CASE_THEIRS }], T1));
  sb.script('rpc', 'apply_criteria_ops', { data: { found: true, applied: 1, changed: true }, error: null });
  const r = await report(sb);
  assertEquals(r.success, true, JSON.stringify(r));
  const binds = sb.callsTo('rpc', 'apply_criteria_ops').filter((c) => ((c.payload as Any).p_ops as Any[]).some((o) => o.op === 'bind'));
  assertEquals(binds.map((c) => (c.payload as Any).p_expected_updated_at), [T0, T1]);
  assertEquals((r.data as Any).results[0].criterionBinding, 'bound');
});

Deno.test('AL.10 report_test_results: three moves refuse with nothing recorded; another error is not retried', async () => {
  const sb = new FakeSupabase();
  base(sb);
  sb.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show' }]));
  sb.script('test_cases', 'select', { data: [{ id: CASE_MINE, test_id: 'TC-1', status: 'not_started' }], error: null });
  for (let i = 0; i < 3; i++) {
    sb.script('rpc', 'apply_criteria_ops', MOVED);
    sb.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show' }], T1));
  }
  const r = await report(sb);
  assertEquals(r.success, false);
  assert(String(r.error).endsWith('No result was recorded; report again.'), String(r.error));
  assertEquals(sb.callsTo('test_cases', 'update').length, 0, 'no status written');

  const other = new FakeSupabase();
  base(other);
  other.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show' }]));
  other.script('test_cases', 'select', { data: [{ id: CASE_MINE, test_id: 'TC-1', status: 'not_started' }], error: null });
  other.script('rpc', 'apply_criteria_ops', { data: null, error: { code: '42501', message: 'permission denied' } });
  const r2 = await report(other);
  assertEquals(r2.success, false);
  assertEquals(String(r2.error), 'Failed to bind criteria to test cases: permission denied');
  assertEquals(other.callsTo('rpc', 'apply_criteria_ops').length, 1);
});

Deno.test('AL.10 report_test_results: each try decides afresh, so a conflict that cleared names no stale holder', async () => {
  const sb = new FakeSupabase();
  base(sb);
  sb.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show', testId: CASE_THEIRS }, { text: 'B' }]));
  sb.script('test_cases', 'select', { data: [{ id: CASE_MINE, test_id: 'TC-1', status: 'not_started' }, { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', test_id: 'TC-2', status: 'not_started' }], error: null });
  sb.script('rpc', 'apply_criteria_ops', MOVED); // TC-2's bind, while TC-1 read as taken
  sb.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show' }, { text: 'B' }], T1)); // released meanwhile
  sb.script('rpc', 'apply_criteria_ops', { data: { found: true, applied: 2, changed: true }, error: null });
  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-1', status: 'passed', criterion_text: 'Pickup slots show' }, { test_id: 'TC-2', status: 'passed', criterion_text: 'B' }],
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const first = (r.data as Any).results[0];
  assertEquals([first.criterionBinding, first.boundTestId], ['bound', undefined]);
});

Deno.test('AL.10 update_test_case: a rebind decided on a moved row reads again; taken meanwhile is a conflict', async () => {
  const sb = new FakeSupabase();
  base(sb);
  sb.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show', met: false }]));
  sb.script('test_cases', 'select', { data: { id: CASE_MINE, test_id: 'TC-1', name: 'x', status: 'passed', retired_at: null, retired_reason: null }, error: null });
  sb.script('rpc', 'apply_criteria_ops', MOVED);
  sb.script('specification_requirements', 'select', reqRow([{ text: 'Pickup slots show', met: false, testId: CASE_THEIRS }], T1));
  sb.script('test_cases', 'select', { data: { test_id: 'TC-9' }, error: null });
  const r = await handleUpdateTestCase(sb as never, AUTH, { project_id: PROJECT, requirement_id: 'REQ-001', test_id: 'TC-1', criterion_text: 'Pickup slots show' });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals((r.data as Any).criterionBinding, 'conflict');
  assert(((r.data as Any).notes as string[]).some((n) => n.includes('already bound to TC-9')), JSON.stringify(r.data));
  assertEquals((sb.callsTo('rpc', 'apply_criteria_ops')[0].payload as Any).p_expected_updated_at, T0);
  assertEquals(sb.callsTo('rpc', 'apply_criteria_ops').length, 1);
});

// ── constraint waivers ──────────────────────────────────────────────────────

const C1 = '99999999-9999-4999-8999-999999999999';
const waive = () => {
  const parsed = SpecPatchOperationSchema.safeParse({
    type: 'update_constraint',
    metadata: { id: crypto.randomUUID(), actorType: 'ai', actorId: 'a', summary: 's', timestamp: new Date().toISOString() },
    payload: { constraintId: C1, addWaiver: { target: 'e1', reason: 'The legacy admin page, retired in Q1' } },
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};
const constraintRow = (waivers: Any[], updated_at: string | null) =>
  ({ data: { id: C1, ctype: 'architecture', kind: 'check', description: 'Services talk through the queue', waivers, updated_at }, error: null });

Deno.test('AL.10 update_constraint: a waiver added meanwhile is kept; the change lands on the row as re-read', async () => {
  const sb = new FakeSupabase();
  scriptOwnerPlan(sb);
  sb.script('project_constraints', 'select', constraintRow([], T0));
  sb.script('project_constraints', 'update', { data: [], error: null });
  sb.script('project_constraints', 'select', constraintRow([{ id: 'w-theirs', target: 'e7', reason: 'Spike' }], T1));
  sb.script('project_constraints', 'update', { data: [{ id: C1 }], error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT, waive());
  assertEquals(r.applied, true, JSON.stringify(r));
  const [first, second] = sb.callsTo('project_constraints', 'update');
  assertEquals(guardOf(first)?.args[1], T0);
  assertEquals(guardOf(second)?.args[1], T1);
  assertEquals(((second.payload as Any).waivers as Any[]).map((w) => w.target), ['e7', 'e1']);
});

Deno.test('AL.10 update_constraint: three moves refuse with nothing changed', async () => {
  const sb = new FakeSupabase();
  scriptOwnerPlan(sb);
  for (let i = 0; i < 3; i++) {
    sb.script('project_constraints', 'select', constraintRow([], `2026-10-01T12:00:0${i}.000+00:00`));
    sb.script('project_constraints', 'update', { data: [], error: null });
  }
  const r = await applySpecPatch(sb as never, AUTH, PROJECT, waive());
  assertEquals(r.applied, false);
  assert(String(r.error).includes('kept changing while this was written'), String(r.error));
});

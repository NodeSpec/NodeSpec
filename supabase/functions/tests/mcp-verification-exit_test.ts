// V3 P2 (task 2.6), reworked by 4b.5 (R7/R8): the verification exit. A task
// lease ends three ways — explicit release, heartbeat expiry, or EVIDENCE:
// a report_test_results call carrying at least one passing result releases
// the CALLER's own active task-level checkouts on tasks whose node is
// mapped to the reported requirement, reason 'verified'. Pins: "the
// caller's own" is by CREDENTIAL — the project's active task leases are
// read once and filtered with isMine in TS (an OAuth connector has no key
// id, so a holder_key_id filter would exclude it), and a teammate's lease
// on the same task line is never swept; each release is its own row write
// carrying meta.verified {at, requirementId} beside the lease's progress
// meta; failing-only reports never even look at the lease table; a release
// failure never fails the already-recorded report (best-effort by design);
// and mark_entity_complete — the bare "done" declaration — structurally
// never touches agent_checkouts.
import { handleReportTestResults } from '../mcp-server/tools/test-results.ts';
import { handleMarkEntityComplete } from '../mcp-server/tools/requirements.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const SPEC = '22222222-2222-4222-8222-222222222222';
const N_API = '33333333-3333-4333-8333-333333333333';
const N_OTHER = '44444444-4444-4444-8444-444444444444';
const T_MAPPED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T_ELSEWHERE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const L_MAPPED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const L_ELSEWHERE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const L_TEAMMATE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const CASE1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] } as never;

/** Scripts handleReportTestResults up to (not including) the checkout block:
 *  project → spec → requirement, no existing cases, one inserted row, the
 *  status update, and the post-write criteria reread. */
function reportPrelude(sb: FakeSupabase) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: 'r1', requirement_id: 'REQ-001', name: 'Store tasks', locked: false, acceptance_criteria: [] },
    error: null,
  });
  sb.script('test_cases', 'select', { data: [], error: null }); // no existing rows
  sb.script('test_cases', 'insert', { data: { id: CASE1 }, error: null });
  sb.script('test_cases', 'update', { data: null, error: null }); // phase C status write
  sb.script('specification_requirements', 'select', { data: { acceptance_criteria: [] }, error: null }); // reread
}

Deno.test('verification exit: a passing report releases ONLY the caller\'s leases on mapped-node tasks, reason verified', async () => {
  const sb = new FakeSupabase();
  reportPrelude(sb);
  // The project's active task leases: two held by this key — one on a task
  // whose node is mapped to REQ-001, one on a task elsewhere — and a
  // teammate's lease on the SAME mapped task. Only the first is verified.
  sb.script('agent_checkouts', 'select', {
    data: [
      { id: L_MAPPED, task_item_id: T_MAPPED, holder_key_id: 'k1', holder_delegate: 'key:k1', meta: { tests: ['TC-001'] } },
      { id: L_ELSEWHERE, task_item_id: T_ELSEWHERE, holder_key_id: 'k1', holder_delegate: 'key:k1', meta: null },
      { id: L_TEAMMATE, task_item_id: T_MAPPED, holder_key_id: 'k2', holder_delegate: 'key:k2', meta: null },
    ],
    error: null,
  });
  sb.script('specification_mappings', 'select', { data: [{ node_id: N_API }], error: null });
  sb.script('task_items', 'select', {
    data: [
      { id: T_MAPPED, node_id: N_API },
      { id: T_ELSEWHERE, node_id: N_OTHER },
    ],
    error: null,
  });
  sb.script('agent_checkouts', 'update', { data: null, error: null });

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT.id, requirement_id: 'REQ-001',
    results: [{ test_id: 'TC-001', status: 'passed' }],
  });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.checkoutsReleased, [{ checkoutId: L_MAPPED, taskItemId: T_MAPPED }],
    'the receipt names the released lease');

  // The lease read is the project's active task board — mine is decided in
  // TS by credential (isMine), so an OAuth connector is not filtered out by
  // a key-id column it never writes.
  const leaseRead = sb.callsTo('agent_checkouts', 'select')[0];
  assert(leaseRead.filters.some((f) => f.method === 'eq' && f.args[0] === 'project_id' && f.args[1] === PROJECT.id), 'scoped to the project');
  assert(leaseRead.filters.some((f) => f.method === 'eq' && f.args[0] === 'level' && f.args[1] === 'task'), 'task level only');
  assert(leaseRead.filters.some((f) => f.method === 'is' && f.args[0] === 'released_at' && f.args[1] === null), 'active only');
  assert(!leaseRead.filters.some((f) => f.args[0] === 'holder_key_id'), 'no holder_key_id filter — credential is decided in TS');
  // Only MY leases' tasks are looked up — the teammate's never enters the join.
  const taskRead = sb.callsTo('task_items', 'select')[0];
  const inTasks = taskRead.filters.find((f) => f.method === 'in');
  assertEquals(inTasks?.args[1], [T_MAPPED, T_ELSEWHERE], 'the task lookup covers exactly the caller\'s leases');

  // The write: verified, one row, exactly the mapped lease, still-active
  // guarded; the exit is stamped beside the lease's own progress meta.
  const updates = sb.callsTo('agent_checkouts', 'update');
  assertEquals(updates.length, 1, 'one release per verified lease — the unmapped lease and the teammate\'s survive');
  const upd = updates[0];
  // deno-lint-ignore no-explicit-any
  const payload = upd.payload as any;
  assertEquals(payload.released_reason, 'verified');
  assert(!!payload.released_at, 'released_at stamps the exit');
  assertEquals(payload.meta.tests, ['TC-001'], 'progress meta survives the exit');
  assertEquals(payload.meta.verified.requirementId, 'REQ-001', 'the exit names the requirement whose evidence closed it');
  assert(!!payload.meta.verified.at, 'the exit is timed');
  assert(!('commitSha' in payload.meta.verified), 'no git stamp when the report carried none');
  assert(upd.filters.some((f) => f.method === 'eq' && f.args[0] === 'id' && f.args[1] === L_MAPPED), 'the mapped lease, by id');
  assert(upd.filters.some((f) => f.method === 'is' && f.args[0] === 'released_at'),
    'only still-active rows are touched');
});

Deno.test('verification exit: a failing-only report holds the lease — the checkout table is never even read', async () => {
  const sb = new FakeSupabase();
  reportPrelude(sb);
  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT.id, requirement_id: 'REQ-001',
    results: [{ test_id: 'TC-001', status: 'failed' }],
  });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals(sb.callsTo('agent_checkouts').length, 0, 'red evidence releases nothing');
  // deno-lint-ignore no-explicit-any
  assert(!('checkoutsReleased' in (r.data as any)), 'no receipt when nothing released');
});

Deno.test('verification exit: a release failure never fails the already-recorded report', async () => {
  const sb = new FakeSupabase();
  reportPrelude(sb);
  sb.script('agent_checkouts', 'select', { data: [{ id: L_MAPPED, task_item_id: T_MAPPED, holder_key_id: 'k1', holder_delegate: 'key:k1', meta: null }], error: null });
  sb.script('specification_mappings', 'select', { data: [{ node_id: N_API }], error: null });
  sb.script('task_items', 'select', { data: [{ id: T_MAPPED, node_id: N_API }], error: null });
  sb.script('agent_checkouts', 'update', { data: null, error: { message: 'boom' } });

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT.id, requirement_id: 'REQ-001',
    results: [{ test_id: 'TC-001', status: 'passed' }],
  });
  assertEquals(r.success, true, 'the report stands; the lease exits on heartbeat expiry');
  // deno-lint-ignore no-explicit-any
  assert(!('checkoutsReleased' in (r.data as any)), 'no false receipt on a failed release');
});

Deno.test('bare "done" guard: mark_entity_complete never touches agent_checkouts', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('branches', 'select', { data: { id: 'branch-1', name: 'main', is_primary: true }, error: null });
  sb.script('graph_snapshots', 'select', {
    data: { graph_data: { nodes: { [N_API]: { id: N_API, label: 'API' } }, artifacts: {} } },
    error: null,
  });
  sb.script('specification_mappings', 'select', { data: [{ id: 'm1', requirement_id: 'r1' }], error: null });
  sb.script('specification_mappings', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'select', {
    data: [{ requirement_id: 'REQ-001', acceptance_criteria: [{ text: 'c1', met: false }] }],
    error: null,
  });

  const r = await handleMarkEntityComplete(sb as never, AUTH, { project_id: PROJECT.id, node_id: N_API });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals(sb.callsTo('agent_checkouts').length, 0,
    'a declaration is not evidence — only report_test_results releases leases');
});

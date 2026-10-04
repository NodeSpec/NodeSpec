// V3 4b.5 (R8): the gitops stitch — coder ↔ NodeSpec ↔ git. The handshake
// is commit → push → report_test_results with git.commit_sha: the sha is
// stamped on every criterion the call flips (provenance.commitSha) and on
// the verified lease (meta.verified), so the spec, the lease audit and the
// repository name the same commit. Pins: the stamp on both rows; the exit
// reaching an OAuth connector by delegate (R7, no key id); a junk sha
// refused before any read; the pure collision join (git reality vs the
// lease board) and get_pending_changes carrying it as touchesHeldWork.
import { handleReportTestResults } from '../mcp-server/tools/test-results.ts';
import { handleGetPendingChanges } from '../mcp-server/tools/git.ts';
import { collisionsBetween } from '../_shared/lease-collisions.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const SPEC = '22222222-2222-4222-8222-222222222222';
const N_API = '33333333-3333-4333-8333-333333333333';
const T_API = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const L_MINE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const L_OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CASE1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const A_API = '55555555-5555-4555-8555-555555555555';

const KEY = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] } as never;
const OAUTH = { userId: 'user-1', authMethod: 'oauth_token', clientId: 'claude-code', scopes: ['read', 'write'] } as never;

/** project → spec → requirement (criteria as given) → existing case rows → status write → reread. */
function prelude(sb: FakeSupabase, pre: unknown[], existing: unknown[], post: unknown[]) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: 'r1', requirement_id: 'REQ-001', name: 'Store tasks', locked: false, acceptance_criteria: pre },
    error: null,
  });
  sb.script('test_cases', 'select', { data: existing, error: null });
  if (existing.length === 0) sb.script('test_cases', 'insert', { data: { id: CASE1 }, error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  // R2: phase D is one locked apply_criteria_ops call and its return IS the
  // post-state — there is no re-read for a concurrent writer to falsify.
  sb.script('rpc', 'apply_criteria_ops', { data: { found: true, applied: 2, changed: true, criteria: post }, error: null });
}

Deno.test('R8: the sha lands on the flipped criterion AND the verified lease — one commit, three rows', async () => {
  const sb = new FakeSupabase();
  // TC-001 already bound to c1 (testId = case row); the trigger flips it
  // between the pre read and the reread, so this call stamps provenance.
  prelude(sb,
    [{ text: 'c1', met: false, testId: CASE1 }],
    [{ id: CASE1, test_id: 'TC-001', status: 'failed' }],
    [{ text: 'c1', met: true, testId: CASE1 }]);
  sb.script('agent_checkouts', 'select', {
    data: [{ id: L_MINE, task_item_id: T_API, holder_key_id: 'k1', holder_delegate: 'key:k1', meta: { tests: ['TC-001'], commitSha: 'abc123def456' } }],
    error: null,
  });
  sb.script('specification_mappings', 'select', { data: [{ node_id: N_API }], error: null });
  sb.script('task_items', 'select', { data: [{ id: T_API, node_id: N_API }], error: null });
  sb.script('agent_checkouts', 'update', { data: null, error: null });

  const r = await handleReportTestResults(sb as never, KEY, {
    project_id: PROJECT.id, requirement_id: 'REQ-001',
    results: [{ test_id: 'TC-001', status: 'passed', criterion_text: 'c1', framework: 'vitest' }],
    git: { commit_sha: 'ABC123DEF456', branch: 'main' }, // normalized to lower-case hex
  });
  assertEquals(r.success, true, JSON.stringify(r));

  // The criterion: provenance carries the commit beside the test evidence —
  // now as a stamp OP on the one locked writer, never a whole-array write.
  const opsCalls = sb.callsTo('rpc', 'apply_criteria_ops');
  assertEquals(opsCalls.length, 1, 'already-bound → no bind batch; one flip/stamp batch');
  assertEquals(sb.callsTo('specification_requirements', 'update').length, 0, 'nothing writes the array directly');
  // deno-lint-ignore no-explicit-any
  const ops = (opsCalls[0].payload as any).p_ops as any[];
  const setMet = ops.find((o) => o.op === 'set_met');
  assertEquals(setMet.test_id, CASE1);
  assertEquals(setMet.value, true, 'the tool states the flip explicitly — not a trigger side effect');
  const stamp = ops.find((o) => o.op === 'stamp');
  assertEquals(stamp.test_id, CASE1);
  assertEquals(stamp.value.source, 'test');
  assertEquals(stamp.value.testCaseId, CASE1);
  assertEquals(stamp.value.framework, 'vitest');
  assertEquals(stamp.value.commitSha, 'abc123def456');
  assertEquals(stamp.value.branch, 'main');

  // The lease: the same commit on the verified row, progress meta intact.
  const upd = sb.callsTo('agent_checkouts', 'update');
  assertEquals(upd.length, 1);
  // deno-lint-ignore no-explicit-any
  const lease = upd[0].payload as any;
  assertEquals(lease.released_reason, 'verified');
  assertEquals(lease.meta.tests, ['TC-001'], 'heartbeat progress survives');
  assertEquals(lease.meta.commitSha, 'abc123def456', 'the heartbeat\'s commitSha survives');
  assertEquals(lease.meta.verified.commitSha, 'abc123def456');
  assertEquals(lease.meta.verified.branch, 'main');
  assertEquals(lease.meta.verified.requirementId, 'REQ-001');

  // The receipt: the agent sees the stitch it made.
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.checkoutsReleased, [{ checkoutId: L_MINE, taskItemId: T_API, commitSha: 'abc123def456' }]);
  assertEquals(data.flippedCriteria, [{ text: 'c1', met: true, testId: CASE1 }]);
});

Deno.test('R7 × R8: an OAuth connector gets the verification exit by delegate — no key id needed, nobody else swept', async () => {
  const sb = new FakeSupabase();
  prelude(sb, [], [], []);
  sb.script('agent_checkouts', 'select', {
    data: [
      { id: L_MINE, task_item_id: T_API, holder_key_id: null, holder_delegate: 'oauth:user-1:claude-code', meta: null },
      { id: L_OTHER, task_item_id: T_API, holder_key_id: null, holder_delegate: 'oauth:user-1:https://cursor.sh/mcp', meta: null },
    ],
    error: null,
  });
  sb.script('specification_mappings', 'select', { data: [{ node_id: N_API }], error: null });
  sb.script('task_items', 'select', { data: [{ id: T_API, node_id: N_API }], error: null });
  sb.script('agent_checkouts', 'update', { data: null, error: null });

  const r = await handleReportTestResults(sb as never, OAUTH, {
    project_id: PROJECT.id, requirement_id: 'REQ-001',
    results: [{ test_id: 'TC-001', status: 'passed' }],
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const upd = sb.callsTo('agent_checkouts', 'update');
  assertEquals(upd.length, 1, 'the connector\'s own lease, not the other connector\'s');
  assert(upd[0].filters.some((f) => f.method === 'eq' && f.args[0] === 'id' && f.args[1] === L_MINE));
  // deno-lint-ignore no-explicit-any
  const verified = (upd[0].payload as any).meta.verified;
  assertEquals(verified.requirementId, 'REQ-001');
  assert(!('commitSha' in verified), 'no git stamp when the report carried none');
  // deno-lint-ignore no-explicit-any
  assertEquals((r.data as any).checkoutsReleased, [{ checkoutId: L_MINE, taskItemId: T_API }]);
});

Deno.test('R8: a junk sha is refused before any read — the stitch never stamps noise', async () => {
  const sb = new FakeSupabase();
  const r = await handleReportTestResults(sb as never, KEY, {
    project_id: PROJECT.id, requirement_id: 'REQ-001',
    results: [{ test_id: 'TC-001', status: 'passed' }],
    git: { commit_sha: 'not-a-sha' },
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('hex commit sha'), r.error);
  assert((r.error ?? '').includes('Commit and push first'), 'the refusal teaches the handshake order');
  assertEquals(sb.calls.length, 0, 'refused before the project is even resolved');
  // too short is junk too; whitespace and case are forgiven
  const short = await handleReportTestResults(sb as never, KEY, {
    project_id: PROJECT.id, requirement_id: 'REQ-001', results: [{ test_id: 'TC-001', status: 'passed' }], git: { commit_sha: 'abc12' },
  });
  assertEquals(short.success, false);
  assertEquals(sb.calls.length, 0);
});

// ── the pure join: git reality vs the lease board ────────────────────────────

const CHANGE = { changeEventId: 'e1', commitSha: 'abc1234', author: 'dev', changedFiles: [{ path: 'src/api.ts' }, 'src/api.ts', 'README.md', { path: 'src/db.ts' }] };
const TASK = { id: T_API, node_id: N_API, display_id: 'T-1', title: 'Wire API' };
const ARTS = [{ id: A_API, node_id: N_API, path: 'src/api.ts' }, { id: 'a-db', node_id: N_API, path: 'src/db.ts' }, { id: 'a-ui', node_id: 'n-ui', path: 'src/ui.tsx' }];

Deno.test('collisionsBetween: a task lease collides through the artifacts bound to its node — paths deduped and sorted, object or string entries', () => {
  const out = collisionsBetween([CHANGE],
    [{ id: L_MINE, level: 'task', holder_label: 'planner', credential: 'key · runner', task_item_id: T_API, artifact_id: null }],
    [TASK], ARTS);
  assertEquals(out, [{
    changeEventId: 'e1', commitSha: 'abc1234', author: 'dev', checkoutId: L_MINE, level: 'task',
    holder: 'planner', credential: 'key · runner', refLabel: 'T-1 · Wire API', paths: ['src/api.ts', 'src/db.ts'], by: [],
  }]);
});

Deno.test('collisionsBetween: a code lease collides on exactly its artifact; advisory holds and unknown refs never do', () => {
  const leases = [
    { id: 'l-code', level: 'code', holder_label: 'coder', task_item_id: null, artifact_id: A_API },
    { id: 'l-req', level: 'requirement', holder_label: 'drafter', task_item_id: null, artifact_id: null },
    { id: 'l-ghost', level: 'task', holder_label: 'ghost', task_item_id: 'no-such-task', artifact_id: null },
    { id: 'l-ui', level: 'task', holder_label: 'ui', task_item_id: 't-ui', artifact_id: null },
  ];
  const out = collisionsBetween([CHANGE], leases, [TASK, { id: 't-ui', node_id: 'n-ui' }], ARTS);
  assertEquals(out.map((c) => [c.checkoutId, c.refLabel, c.paths]), [['l-code', 'src/api.ts', ['src/api.ts']]]);
  // a commit that touched nothing bound, or nothing at all, is not a collision
  assertEquals(collisionsBetween([{ ...CHANGE, changedFiles: ['docs/x.md'] }], leases, [TASK], ARTS), []);
  assertEquals(collisionsBetween([{ ...CHANGE, changedFiles: null }], leases, [TASK], ARTS), []);
  assertEquals(collisionsBetween([CHANGE], [], [TASK], ARTS), []);
});

Deno.test('get_pending_changes: a pending commit on held work carries touchesHeldWork — holder, credential, ref, paths', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  // runDriftSweep reads git_integrations first → unscripted null → no_integration
  sb.script('git_change_events', 'select', {
    data: [{ id: 'e1', commit_sha: 'abc1234', commit_message: 'wire api', author: 'dev', changed_files: [{ path: 'src/api.ts' }, 'README.md'], status: 'pending', metadata: {}, created_at: 't' }],
    error: null,
  });
  sb.script('agent_checkouts', 'select', {
    data: [{ id: L_MINE, level: 'task', holder_label: 'planner', holder_key_id: 'k1', holder_delegate: 'key:k1', task_item_id: T_API, artifact_id: null }],
    error: null,
  });
  sb.script('task_items', 'select', { data: [TASK], error: null });
  sb.script('artifacts', 'select', { data: [ARTS[0]], error: null }); // by node
  sb.script('mcp_api_keys', 'select', { data: [{ id: 'k1', name: 'runner' }], error: null });

  const r = await handleGetPendingChanges(sb as never, KEY, { project_id: PROJECT.id });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.heldWorkCollisions, 1);
  assertEquals(data.pendingChanges[0].touchesHeldWork, [{
    changeEventId: 'e1', commitSha: 'abc1234', author: 'dev', checkoutId: L_MINE, level: 'task',
    holder: 'planner', credential: 'key · runner', refLabel: 'T-1 · Wire API', paths: ['src/api.ts'], by: [],
  }]);
  const leaseRead = sb.callsTo('agent_checkouts', 'select')[0];
  assert(leaseRead.filters.some((f) => f.method === 'in' && f.args[0] === 'level'), 'exclusive levels only');
  assert(leaseRead.filters.some((f) => f.method === 'is' && f.args[0] === 'released_at'), 'active leases only');
});

Deno.test('get_pending_changes: no held work → no touchesHeldWork key, nothing joined, count 0', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('git_change_events', 'select', {
    data: [{ id: 'e1', commit_sha: 'abc1234', commit_message: 'wire api', author: 'dev', changed_files: ['src/api.ts'], status: 'pending', metadata: {}, created_at: 't' }],
    error: null,
  });
  sb.script('agent_checkouts', 'select', { data: [], error: null });
  const r = await handleGetPendingChanges(sb as never, KEY, { project_id: PROJECT.id });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.heldWorkCollisions, 0);
  assert(!('touchesHeldWork' in data.pendingChanges[0]), 'no key when nothing collides');
  assertEquals(sb.callsTo('task_items').length, 0, 'the join stops at an empty board');
  assertEquals(sb.callsTo('artifacts').length, 0);
});

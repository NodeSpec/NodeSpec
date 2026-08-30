// C4 step 3 · report_test_results — the evidence lane that flips acceptance criteria.
//
// THE mechanism under pin: the met-flip trigger (on_test_case_status_change,
// 20260325192007) is AFTER UPDATE OF status ONLY — an INSERT never fires it. So a NEW
// case must land in TWO steps (insert at 'not_started', then UPDATE to the reported
// status), and criterion binding (criterion.testId = the test-case ROW uuid) must be
// written BEFORE that status update or the flip has nothing to match. Provenance
// parity with R5's git ticks: a criterion flipped by this call carries
// { source: 'test', testCaseId, at } so the Spec view can audit the claim.
import { FakeSupabase, assert, assertEquals } from './helpers.ts';
import { handleReportTestResults } from '../mcp-server/tools/test-results.ts';
import { MCP_TOOLS } from '../mcp-server/tool-registry.ts';
// deno-lint-ignore no-explicit-any
type Any = any;

const AUTH: Any = { userId: 'user-1', scopes: ['read', 'write', 'propose'], authMethod: 'api_key' };
const PROJECT_UUID = '00000000-0000-4000-8000-000000000001';
const REQ_ROW = '77777777-7777-4777-8777-777777777777';
const CASE1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // pre-existing row
const CASE2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // created by the call
const OTHER_CASE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // someone else's binding

function scriptBase(sb: FakeSupabase, criteria: Any[]) {
  sb.script('projects', 'select', { data: { id: PROJECT_UUID, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: REQ_ROW, requirement_id: 'REQ-001', name: 'R', locked: false, acceptance_criteria: criteria },
    error: null,
  });
}

Deno.test('report_test_results: new row is a TWO-STEP write (insert not_started, then status update) and binding lands before the flip, with provenance stamped', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, [
    { text: 'A holds', met: false },                  // bound by criterion_text this call
    { text: 'B holds', met: false, testId: CASE1 },   // pre-linked to the existing case
    { text: 'C holds', met: false },                  // untouched
  ]);
  sb.script('test_cases', 'select', { data: [{ id: CASE1, test_id: 'TC-1', status: 'passed' }], error: null });
  sb.script('test_cases', 'insert', { data: { id: CASE2 }, error: null });
  sb.script('specification_requirements', 'update', { data: null, error: null }); // binding
  sb.script('test_cases', 'update', { data: null, error: null }); // existing row
  sb.script('test_cases', 'update', { data: null, error: null }); // new row status
  // Post-write reread simulates the trigger having flipped A (TC-2 passed). B stays
  // unmet (TC-1 failed and was already false).
  sb.script('specification_requirements', 'select', {
    data: {
      acceptance_criteria: [
        { text: 'A holds', met: true, testId: CASE2 },
        { text: 'B holds', met: false, testId: CASE1 },
        { text: 'C holds', met: false },
      ],
    },
    error: null,
  });
  sb.script('specification_requirements', 'update', { data: null, error: null }); // provenance

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID,
    requirement_id: REQ_ROW,
    results: [
      { test_id: 'TC-1', status: 'failed' },
      { test_id: 'TC-2', status: 'passed', name: 'A test', framework: 'vitest', criterion_text: 'A holds' },
    ],
  });
  assert(r.success, JSON.stringify(r));
  const data = r.data as Any;

  // (pin a) two-step sequencing for the new row: the trigger is AFTER UPDATE OF
  // status, so the insert MUST carry 'not_started' and the reported status MUST
  // arrive as a separate update.
  const inserts = sb.callsTo('test_cases', 'insert');
  assertEquals(inserts.length, 1);
  const insertPayload = inserts[0].payload as Any;
  assertEquals(insertPayload.status, 'not_started', 'insert never carries the reported status');
  assertEquals(insertPayload.requirement_id, REQ_ROW);
  assertEquals(insertPayload.test_id, 'TC-2');
  const newRowUpdate = sb.callsTo('test_cases', 'update')
    .find((c) => c.filters.some((f) => f.method === 'eq' && f.args[1] === CASE2));
  assert(newRowUpdate, 'second step exists');
  assertEquals((newRowUpdate!.payload as Any).status, 'passed');
  const insertIdx = sb.calls.indexOf(inserts[0]);
  const statusIdx = sb.calls.indexOf(newRowUpdate!);
  assert(insertIdx < statusIdx, 'insert happens before the status update');

  // (coordinator pin a) criterion binding: testId written onto the exact-text match,
  // in an update that lands BETWEEN insert and the status update — so the trigger
  // flip sees the binding in the same call.
  const specUpdates = sb.callsTo('specification_requirements', 'update');
  assertEquals(specUpdates.length, 2, 'one binding update + one provenance update');
  const bindPayload = specUpdates[0].payload as Any;
  const boundA = bindPayload.acceptance_criteria.find((c: Any) => c.text === 'A holds');
  assertEquals(boundA.testId, CASE2, 'criterion bound to the new case row uuid');
  assertEquals(bindPayload.acceptance_criteria.find((c: Any) => c.text === 'B holds').testId, CASE1, 'existing binding preserved');
  assertEquals(bindPayload.acceptance_criteria.find((c: Any) => c.text === 'C holds').testId, undefined, 'unrelated criterion untouched');
  const bindIdx = sb.calls.indexOf(specUpdates[0]);
  assert(insertIdx < bindIdx && bindIdx < statusIdx, 'binding lands after the insert and before the status update');

  // Existing row: plain update carrying status + staleness clear (a fresh result IS
  // the re-verification).
  const existingUpdate = sb.callsTo('test_cases', 'update')
    .find((c) => c.filters.some((f) => f.method === 'eq' && f.args[1] === CASE1));
  assert(existingUpdate, 'existing row updated in place — no re-insert');
  const ep = existingUpdate!.payload as Any;
  assertEquals(ep.status, 'failed');
  assertEquals(ep.stale, false);
  assertEquals(ep.staleness_reason, null);

  // (pin c) flippedCriteria reflects the POST-write reread, not a simulation: A met
  // true, B met false, C absent (not linked to an affected case).
  assertEquals(data.flippedCriteria, [
    { text: 'A holds', met: true, testId: CASE2 },
    { text: 'B holds', met: false, testId: CASE1 },
  ]);

  // (coordinator pin a, provenance half) only the criterion whose met CHANGED gets
  // the test stamp, other keys preserved, single follow-up update.
  const provPayload = specUpdates[1].payload as Any;
  const provA = provPayload.acceptance_criteria.find((c: Any) => c.text === 'A holds');
  assertEquals(provA.provenance.source, 'test');
  assertEquals(provA.provenance.testCaseId, CASE2);
  assertEquals(provA.provenance.framework, 'vitest');
  assert(typeof provA.provenance.at === 'string' && provA.provenance.at.length > 0);
  assertEquals(provA.met, true, 'other keys preserved through the stamp');
  assertEquals(provA.testId, CASE2);
  const provB = provPayload.acceptance_criteria.find((c: Any) => c.text === 'B holds');
  assertEquals(provB.provenance, undefined, 'met did not change (false -> false) — no stamp');
  assertEquals(data.criteriaStamped, 1);

  const outcomes = data.results as Any[];
  assertEquals(outcomes.find((o) => o.testId === 'TC-1').action, 'updated');
  const created = outcomes.find((o) => o.testId === 'TC-2');
  assertEquals(created.action, 'created');
  assertEquals(created.caseId, CASE2);
  assertEquals(created.criterionBinding, 'bound');
});

// (pin b) scope rejection before any query.
Deno.test('report_test_results: write scope required — nothing touched without it', async () => {
  const sb = new FakeSupabase();
  const r = await handleReportTestResults(sb as never, { userId: 'user-1', scopes: ['read', 'propose'], authMethod: 'api_key' } as Any, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW, results: [{ test_id: 'T', status: 'passed' }],
  });
  assert(!r.success);
  assert((r.error ?? '').includes('write scope'));
  assertEquals(sb.calls.length, 0);
});

// (coordinator pin b) unmatched criterion_text: reported as unbound, nothing guessed,
// nothing written to the requirement.
Deno.test('report_test_results: criterion_text with no exact match is reported unbound — never guessed', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, [{ text: 'The real criterion', met: false }]);
  sb.script('test_cases', 'select', { data: [], error: null });
  sb.script('test_cases', 'insert', { data: { id: CASE2 }, error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'select', {
    data: { acceptance_criteria: [{ text: 'The real criterion', met: false }] },
    error: null,
  });

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-9', status: 'passed', criterion_text: 'the real criterion' }], // case differs — NOT exact
  });
  assert(r.success, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals((data.results as Any[])[0].criterionBinding, 'unbound');
  assertEquals(sb.callsTo('specification_requirements', 'update').length, 0,
    'exact text match or nothing — fuzzy binding would attach evidence to the wrong claim');
  assertEquals(data.flippedCriteria, []);
  assert((data.warnings as string[])[0].includes('matched NO criterion'));
});

// (coordinator pin c) a criterion already bound to a DIFFERENT case keeps its binding.
Deno.test('report_test_results: a foreign testId binding is never stolen — conflict reported', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, [{ text: 'A holds', met: true, testId: OTHER_CASE }]);
  sb.script('test_cases', 'select', { data: [{ id: CASE1, test_id: 'TC-1', status: 'failed' }], error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'select', {
    data: { acceptance_criteria: [{ text: 'A holds', met: true, testId: OTHER_CASE }] },
    error: null,
  });

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-1', status: 'passed', criterion_text: 'A holds' }],
  });
  assert(r.success, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals((data.results as Any[])[0].criterionBinding, 'conflict');
  assertEquals(sb.callsTo('specification_requirements', 'update').length, 0,
    'the foreign binding (and its evidence chain) stays intact');
  assertEquals(data.flippedCriteria, [], 'the criterion belongs to the OTHER case — not this call\'s receipt');
  assert((data.warnings as string[])[0].includes('DIFFERENT test case'));
});

// (WS3 pin) manual-lane refusal: a verification:'manual' criterion is the R5
// tick+approval lane's property — binding is refused, testId is never written, so the
// met-flip trigger structurally cannot fire from this tool.
Deno.test('report_test_results: verification manual criterion refuses binding — manual-lane outcome, no testId written, warning names the tick+approval lane', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, [{ text: 'User confirms the dashboard renders correctly', met: false, verification: 'manual' }]);
  sb.script('test_cases', 'select', { data: [], error: null });
  sb.script('test_cases', 'insert', { data: { id: CASE2 }, error: null });
  sb.script('test_cases', 'update', { data: null, error: null }); // new-row status step
  sb.script('specification_requirements', 'select', {
    data: { acceptance_criteria: [{ text: 'User confirms the dashboard renders correctly', met: false, verification: 'manual' }] },
    error: null,
  });

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-7', status: 'passed', criterion_text: 'User confirms the dashboard renders correctly' }],
  });
  assert(r.success, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals((data.results as Any[])[0].criterionBinding, 'manual-lane');
  assertEquals(sb.callsTo('specification_requirements', 'update').length, 0,
    'no binding update — testId must never land on a manual criterion (the trigger could then flip it)');
  assertEquals(data.flippedCriteria, [], 'nothing linked, nothing flipped');
  assert((data.warnings as string[])[0].includes('manual'), 'warning names the lane');
  assert((data.warnings as string[])[0].includes('task document'), 'warning points at the task-doc tick + approval lane');
});

Deno.test('report_test_results: a new row reported not_started is insert-only (no status update — the trigger ignores not_started anyway)', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, []);
  sb.script('test_cases', 'select', { data: [], error: null });
  sb.script('test_cases', 'insert', { data: { id: CASE2 }, error: null });
  sb.script('specification_requirements', 'select', { data: { acceptance_criteria: [] }, error: null });

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-5', status: 'not_started', name: 'planned only' }],
  });
  assert(r.success, JSON.stringify(r));
  assertEquals(sb.callsTo('test_cases', 'update').length, 0);
  assertEquals((sb.callsTo('test_cases', 'insert')[0].payload as Any).status, 'not_started');
});

Deno.test('report_test_results: batch validated before any write — bad status, bad framework, duplicate test_id all refuse up front', async () => {
  const bad = async (results: Any[]) => {
    const sb = new FakeSupabase();
    const r = await handleReportTestResults(sb as never, AUTH, { project_id: PROJECT_UUID, requirement_id: REQ_ROW, results });
    assert(!r.success);
    assertEquals(sb.calls.length, 0, 'validation failures never reach the database');
    return r.error ?? '';
  };
  assert((await bad([{ test_id: 'T', status: 'green' }])).includes('Invalid status'));
  assert((await bad([{ test_id: 'T', status: 'passed', framework: 'my-runner' }])).includes('Invalid framework'));
  assert((await bad([{ test_id: 'T', status: 'passed', test_type: 'smoke' }])).includes('Invalid test_type'));
  assert((await bad([{ test_id: 'T', status: 'passed' }, { test_id: 'T', status: 'failed' }])).includes('Duplicate test_id'));
});

Deno.test('report_test_results: requirement must belong to this project\'s specification', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT_UUID, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: null, error: null }); // not in spec-1
  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW, results: [{ test_id: 'T', status: 'passed' }],
  });
  assert(!r.success);
  assert((r.error ?? '').includes('Requirement not found'));
  assertEquals(sb.callsTo('test_cases').length, 0);
});

// (pin f) registry + dispatch wiring, mirroring the r5d pin style.
Deno.test('report_test_results: registered with write scope and dispatched by transport', () => {
  const tool = MCP_TOOLS.find((t) => t.name === 'report_test_results');
  assert(tool, 'registered in MCP_TOOLS');
  assertEquals(tool!.requiredScope, 'write');
  assert(tool!.description.includes('criterion_text'), 'description teaches the binding lane');
  assert(tool!.description.includes('Never report a result you did not actually run'),
    'the honesty rule must be stated to the calling AI');
  const schema = tool!.inputSchema as Any;
  assertEquals(schema.required, ['project_id', 'requirement_id', 'results']);
  assertEquals(schema.properties.results.items.required, ['test_id', 'status']);

  const transport = Deno.readTextFileSync(new URL('../mcp-server/transport.ts', import.meta.url));
  assert(transport.includes("case 'report_test_results':"));
  assert(transport.includes('handleReportTestResults'));
});

// ── Plan-lane alignment: evidence must be able to point back at its plan ────────
//
// The orphan the owner's live bench surfaced: report_test_results freely creates
// test_cases rows, so the canvas showed test cards while .nodespec/tests/ carried
// no plan .md at all — downstream evidence with no upstream document. The report
// now reads the main-branch snapshot (the same read get_project_status does) and
// (a) returns testPlan { exists, path? }, (b) appends an orphan warning LAST
// (binding warnings keep their pinned first position), (c) never blocks.

Deno.test('report_test_results plan alignment: no stored plan → testPlan.exists false + orphan warning appended LAST, success untouched', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, [{ text: 'The real criterion', met: false }]);
  sb.script('test_cases', 'select', { data: [], error: null });
  sb.script('test_cases', 'insert', { data: { id: CASE2 }, error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'select', {
    data: { acceptance_criteria: [{ text: 'The real criterion', met: false }] },
    error: null,
  });
  sb.script('branches', 'select', { data: { id: 'branch-main' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { artifacts: {} } }, error: null });

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-9', status: 'passed', criterion_text: 'wrong wording' }],
  });
  assert(r.success, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals((data.testPlan as Any).exists, false);
  const warnings = data.warnings as string[];
  assertEquals(warnings.length, 2, 'binding warning + orphan warning');
  assert(warnings[0].includes('matched NO criterion'), 'binding warnings keep first position (pinned wording)');
  assert(warnings[1].includes('No test plan is stored'), 'orphan warning appended last');
  assert(warnings[1].includes('get_test_plan'), 'points at the plan lane, never blocks');
});

Deno.test('report_test_results plan alignment: stored plan found via metadata.requirementId → testPlan {exists, path}, no orphan warning', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, []);
  sb.script('test_cases', 'select', { data: [], error: null });
  sb.script('test_cases', 'insert', { data: { id: CASE2 }, error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'select', { data: { acceptance_criteria: [] }, error: null });
  sb.script('branches', 'select', { data: { id: 'branch-main' }, error: null });
  sb.script('graph_snapshots', 'select', {
    data: {
      graph_data: {
        artifacts: {
          'art-1': { kind: 'test-plan', path: '.nodespec/tests/req-001.tests.md', metadata: { requirementId: 'REQ-001' } },
          'art-2': { kind: 'task', path: '.nodespec/tasks/api.task.md' },
        },
      },
    },
    error: null,
  });

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-9', status: 'passed' }],
  });
  assert(r.success, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals(data.testPlan, { exists: true, path: '.nodespec/tests/req-001.tests.md' });
  assert(!(data.warnings as string[] | undefined)?.some((w) => w.includes('No test plan')), 'aligned report carries no orphan warning');
});

Deno.test('report_test_results plan alignment: unreadable branch (no main row) → testPlan OMITTED, no orphan warning — unknown is never reported as absent', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, []);
  sb.script('test_cases', 'select', { data: [], error: null });
  sb.script('test_cases', 'insert', { data: { id: CASE2 }, error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'select', { data: { acceptance_criteria: [] }, error: null });
  // branches unscripted → null: the lookup cannot resolve a main branch.

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-9', status: 'passed' }],
  });
  assert(r.success, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals(data.testPlan, undefined, 'unknown ≠ absent');
  assert(!(data.warnings as string[] | undefined)?.some((w) => w.includes('No test plan')));
});

// ── D4: the budget receipt ───────────────────────────────────────────────────────────

Deno.test('D4 report_test_results: an over-budget write returns the testBudget receipt with the consolidation nudge', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, [{ text: 'A holds', met: false, testId: CASE1 }]); // ONE criterion
  sb.script('test_cases', 'select', { data: [{ id: CASE1, test_id: 'TC-1', status: 'failed' }], error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'select', {
    data: { acceptance_criteria: [{ text: 'A holds', met: true, testId: CASE1 }] }, error: null,
  });
  sb.script('specification_requirements', 'update', { data: null, error: null }); // provenance
  // D4 post-write head count: 5 cases against 1 criterion — over the 2x budget.
  sb.script('test_cases', 'select', { count: 5, data: null, error: null });

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-1', status: 'passed' }],
  });
  assert(r.success, JSON.stringify(r));
  const budget = (r.data as Any).testBudget;
  assertEquals(budget.criteria, 1);
  assertEquals(budget.testCases, 5);
  assertEquals(budget.testsPerCriterion, 5);
  assert(budget.nudge.includes('ONE binding test per criterion'), budget.nudge);
  assert(budget.nudge.includes('verified (smoke)'), 'defers deep tier to post-smoke');
});

Deno.test('D4 report_test_results: within budget -> NO testBudget field (the receipt only flags sprawl)', async () => {
  const sb = new FakeSupabase();
  scriptBase(sb, [{ text: 'A holds', met: false, testId: CASE1 }]);
  sb.script('test_cases', 'select', { data: [{ id: CASE1, test_id: 'TC-1', status: 'failed' }], error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'select', {
    data: { acceptance_criteria: [{ text: 'A holds', met: true, testId: CASE1 }] }, error: null,
  });
  sb.script('specification_requirements', 'update', { data: null, error: null });
  sb.script('test_cases', 'select', { count: 2, data: null, error: null }); // 2 <= 2x1

  const r = await handleReportTestResults(sb as never, AUTH, {
    project_id: PROJECT_UUID, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-1', status: 'passed' }],
  });
  assert(r.success, JSON.stringify(r));
  assertEquals((r.data as Any).testBudget, undefined);
});

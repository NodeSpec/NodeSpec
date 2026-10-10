// AL.29 phase 4 (owner 2026-10-09): the Requirements record and the Plan board
// show the bullets the files carry, read with the server's own readers: the
// steps under each work order (task-deltas) and the statements under each test
// case (plan-cases). R2: the Tasks section is this requirement's work orders and
// the node's setup orders; other requirements' orders wait behind "Show the
// other N". 4.2: one Tests row per test case in the plan, joined to its result
// through the criterion's binding. R3: Code is the logic files bound to the
// nodes and the test files the results name, in the record only. 4.3: the Plan
// board reads per-node counts from the plans and adds no plan items (the line
// it shows is pinned beside PlanTab, in work-plan.test.tsx).
import { describe, it, expect } from 'vitest';
import type { Graph } from '@nodespec/core/types.js';
import { assembleTierItems, type CandidateItemRow, type RequirementItemRow } from '../ui/components/ideation/useTierItems.js';
import { assembleTrace, docTasksOf, type TraceArtifact, type TraceChain, type TraceTaskRow, type TraceTestRow } from '../ui/components/ideation/useTraceData.js';
import { recordOf, testRowsOf, planTestsByNode, chainFilePaths } from '../ui/components/work/requirements-model.js';
import { taskDocDetails, checkboxOf } from '../../supabase/functions/_shared/task-deltas.js';
import { planCases } from '../../supabase/functions/_shared/plan-cases.js';

const NODE = 'n1', REQ = 'r1', REQ2 = 'r2';
// A task doc as the generator writes it, with the agent's steps under T1 and T2.
const DOC = [
  '## Implementation Tasks',
  '',
  '- [ ] **T1 \u2014 Scaffold the API component.** <!-- t:aaaaaaaa -->',
  "  Create the source layout, build files, and test harness this node's working code lives in.",
  '  - [x] Create `src/api.ts` with the Express app',
  '  - [ ] Add the vitest harness',
  '- [ ] **T2 \u2014 Implement: "tasks persist" (REQ-001).** <!-- t:bbbbbbbb -->',
  "  No interface contract maps to this criterion \u2014 it is this node's internal responsibility.",
  '  \u21b3 serves: REQ-001 "tasks persist"',
  '  - [ ] Write each task to the tasks table in src/db.ts',
  '    Use one transaction per write.',
  '- [ ] **T3 \u2014 Implement: "filter works" (REQ-002).** <!-- t:cccccccc -->',
  "  No interface contract maps to this criterion \u2014 it is this node's internal responsibility.",
  '  \u21b3 serves: REQ-002 "filter works"',
  '',
  '## Notes',
].join('\n');
// REQ-001's test plan as the generator writes it, with the agent's statements.
const PLAN = [
  '## Acceptance Criteria',
  '',
  '- **AC-REQ-001-1** [automated] [VERIFIED] tasks persist',
  '- **AC-REQ-001-2** [automated] [PENDING] queries return within 200ms',
  '- **AC-REQ-001-3** [manual] [VERIFIED] ops sign-off',
  '',
  '## Automated Test Scenarios',
  '',
  'Each heading and the line under it are derived.',
  '',
  '#### AC-REQ-001-1: tasks-persist',
  'Derive the test from AC-REQ-001-1 and report the outcome with test_id "TC-REQ-001-1".',
  '- [x] Given a saved task, when the API restarts, then GET /tasks returns it',
  '',
  '#### AC-REQ-001-2: queries-return-within-200ms',
  'Derive the test from AC-REQ-001-2 and report the outcome with test_id "TC-REQ-001-2".',
  '- [ ] Given 10k tasks, when GET /tasks?status=open runs, then it answers within 200ms',
  '',
  '#### Statements to review',
  '',
  'Kept from a criterion that was reworded or removed. Move each under its test case, or delete it.',
  '',
  'Written for: "tasks survive a crash"',
  '- [ ] Given a crash mid-write, when the API restarts, then no task is half written',
  '',
  '## Manual Verification',
  '',
  'These criteria are proven by a HUMAN.',
  '',
  '- [ ] AC-REQ-001-3 \u2014 verify per the criterion text above, then tick + approve via the task doc',
  "  - [ ] Given the runbook, when an operator restores last night's dump, then the tasks are back",
  '',
  '## Test Strategy',
].join('\n');

const artifacts: Record<string, TraceArtifact> = {
  a1: { id: 'a1', nodeId: NODE, path: 'src/api.ts', kind: 'source' },
  a3: { id: 'a3', nodeId: NODE, path: '.nodespec/tasks/api.task.md', kind: 'task', content: DOC },
  a4: { id: 'a4', nodeId: NODE, path: '.nodespec/tests/req-001.tests.md', kind: 'test-plan', content: PLAN, metadata: { requirementId: 'REQ-001' } },
};
const graph = {
  id: 'g', schemaVersion: 8, version: 0, hash: 'x',
  nodes: { [NODE]: { id: NODE, type: 'backend-service', label: 'API', ports: [], artifacts: [] } },
  edges: {}, contracts: {}, artifacts,
} as unknown as Graph;
const candidates: CandidateItemRow[] = [];
const requirements: RequirementItemRow[] = [
  { id: REQ, requirement_id: 'REQ-001', name: 'Store tasks', acceptance_criteria: [
    { id: 'k1', text: 'tasks persist', met: true, testId: 'tc1' },
    { id: 'k2', text: 'queries return within 200ms', met: false },
    { id: 'k3', text: 'ops sign-off', met: true, verification: 'manual' },
  ] as never },
  { id: REQ2, requirement_id: 'REQ-002', name: 'Query tasks', acceptance_criteria: [{ id: 'k5', text: 'filter works', met: false }] as never },
];
const mappings = [{ requirement_id: REQ, node_id: NODE }, { requirement_id: REQ2, node_id: NODE }];
const result = (over: Partial<TraceTestRow>): TraceTestRow => ({
  id: 't', requirement_id: REQ, test_id: 'T', name: 'n', status: 'not_started', stale: false, staleness_reason: null, test_type: null, framework: null,
  artifact_path: null, source_artifact_ids: null, expected_result: null, updated_at: null, ...over,
});
// tc1 proves AC-1 by its binding; its free-form test_id happens to be the id
// the plan suggests for AC-2, which must not join it there.
const tests: TraceTestRow[] = [
  result({ id: 'tc1', test_id: 'TC-REQ-001-2', name: 'persist.spec', status: 'passed', artifact_path: 'tests/api.spec.ts', source_artifact_ids: ['a1'] }),
  result({ id: 'tc9', test_id: 'TC-9', name: 'load.bench', status: 'running' }),
];

function chains(over: { artifacts?: Record<string, TraceArtifact>; taskItems?: TraceTaskRow[] } = {}): TraceChain[] {
  const g = { ...graph, artifacts: over.artifacts ?? artifacts } as unknown as Graph;
  const items = assembleTierItems({ candidates, requirements, mappings, taskItems: [], stepMaps: [], graph: g, lanes: [] });
  return assembleTrace({
    items, requirements, derivations: [], mappings, tests, taskItems: over.taskItems ?? [],
    docTasksByNode: new Map([[NODE, docTasksOf(DOC)]]),
    artifacts: Object.values(over.artifacts ?? artifacts), holds: [], driftPaths: new Set(),
  });
}
const band = { confirmed: false, backfilled: false, metCount: 2, criteriaCount: 3 };
const recordFor = (all: TraceChain[], ref: string) => recordOf(all.find((c) => c.ref === ref)!, { requirement: band, outcomes: [], lanes: [] as never });

describe('AL.29 4.1 · Tasks: this requirement\'s work orders and the setup orders, each with its steps as the parser reads them', () => {
  it('R2: a setup order shows for every requirement on its node; another requirement\'s order waits behind "Show the other N"', () => {
    const all = chains();
    const one = recordFor(all, 'REQ-001');
    expect(one.tasks.map((t) => [t.displayId, t.serves])).toEqual([['T1', []], ['T2', ['AC1']]]);
    expect(one.otherTasks.map((g) => g.tasks.map((t) => t.displayId))).toEqual([['T3']]);
    const two = recordFor(all, 'REQ-002');
    expect(two.tasks.map((t) => t.displayId)).toEqual(['T1', 'T3']);
    expect(two.otherTasks.map((g) => g.tasks.map((t) => t.displayId))).toEqual([['T2']]);
    // a row whose work order the doc no longer lists cites nothing, and is not a setup order
    const orphan: TraceTaskRow = { id: 'row-9', node_id: NODE, task_key: 'dddddddd', display_id: 'T9', title: 'Retired work', done: false, orphaned: true, provenance: null };
    const withOrphan = recordFor(chains({ taskItems: [orphan] }), 'REQ-001');
    expect(withOrphan.tasks.map((t) => t.displayId)).toEqual(['T1', 'T2']);
    expect(withOrphan.otherTasks.map((g) => g.tasks.map((t) => t.displayId))).toEqual([['T3', 'T9']]);
  });

  it('each work order carries exactly the lines the parser returns under it, its steps among them', () => {
    const one = recordFor(chains(), 'REQ-001');
    const parsed = taskDocDetails(DOC);
    expect(one.tasks.map((t) => t.details)).toEqual([parsed.get('aaaaaaaa'), parsed.get('bbbbbbbb')]);
    // the steps, read as tick rows: ticked or not, and their text
    expect(one.tasks[0].details.map(checkboxOf)).toEqual([null, { done: true, text: 'Create `src/api.ts` with the Express app' }, { done: false, text: 'Add the vitest harness' }]);
    // a line indented under a step is not a step
    expect(one.tasks[1].details.map((l) => checkboxOf(l)?.text ?? null)).toEqual([null, 'Write each task to the tasks table in src/db.ts', null]);
  });
});

describe('AL.29 4.2 · Tests: one row per test case in the plan, the result joined through the criterion\'s binding', () => {
  it('with results: each case in plan order with its statements, the result on the case its criterion binds, then the result no case reaches', () => {
    const rows = testRowsOf(chains().find((c) => c.ref === 'REQ-001')!);
    expect(rows.map((r) => [r.rowId, r.testId, r.status, r.criterion, r.type, r.statements])).toEqual([
      ['tc1', 'TC-REQ-001-2', 'passed', 'AC1', null, ['- [x] Given a saved task, when the API restarts, then GET /tasks returns it']],
      // AC-2 carries no result: tc1's test_id names this case, but its binding is AC-1
      ['plan:AC-REQ-001-2', 'TC-REQ-001-2', 'not run', 'AC2', null, ['- [ ] Given 10k tasks, when GET /tasks?status=open runs, then it answers within 200ms']],
      // the manual case: proven by the person's tick the criterion carries
      ['plan:AC-REQ-001-3', 'AC-REQ-001-3', 'passed', 'AC3', 'manual', ["- [ ] Given the runbook, when an operator restores last night's dump, then the tasks are back"]],
      ['tc9', 'TC-9', 'running', null, null, []],
    ]);
    expect(rows.slice(0, 3).map((r) => r.statements)).toEqual(planCases(PLAN).cases.map((c) => c.statements));
    expect(recordFor(chains(), 'REQ-001').tests).toEqual(rows);
  });

  it('without results the automated cases read not run, a met criterion or not; the manual case reads its tick; with no plan the results alone', () => {
    const noResults = chains().find((c) => c.ref === 'REQ-001')!;
    const bare = { ...noResults, verify: { ...noResults.verify, tests: [], criteria: noResults.verify.criteria.map((c) => ({ ...c, testId: undefined })) } };
    expect(bare.verify.criteria.map((c) => c.met)).toEqual([true, false, true]);
    expect(testRowsOf(bare).map((r) => [r.rowId, r.status])).toEqual([['plan:AC-REQ-001-1', 'not run'], ['plan:AC-REQ-001-2', 'not run'], ['plan:AC-REQ-001-3', 'passed']]);
    const { a4: _plan, ...noPlan } = artifacts;
    const rows = testRowsOf(chains({ artifacts: noPlan }).find((c) => c.ref === 'REQ-001')!);
    expect(rows.map((r) => [r.rowId, r.statements])).toEqual([['tc1', []], ['tc9', []]]);
  });
});

describe('AL.29 4.4 · Code (R3): the logic files bound to its nodes, then the test files its results name; the Plan rail unchanged', () => {
  it('the bound source and the result\'s test file, never the task doc or the test plan', () => {
    const all = chains();
    const one = recordFor(all, 'REQ-001');
    expect(one.files.map((f) => [f.path, f.isTest, f.touchedBy])).toEqual([['src/api.ts', false, ['TC-REQ-001-2']], ['tests/api.spec.ts', true, ['TC-REQ-001-2']]]);
    // REQ-002 has no results: its node's logic file, and no test file
    expect(recordFor(all, 'REQ-002').files.map((f) => f.path)).toEqual(['src/api.ts']);
    // the trace's code cell reads the same: a test plan is not a source file
    expect(all.find((c) => c.ref === 'REQ-001')!.cells.code.flatMap((c) => c.up.map((s) => s.title))).toEqual(['src/api.ts']);
    // the Plan rail's list is the files the results name, as before
    expect(chainFilePaths(all.find((c) => c.ref === 'REQ-001')!)).toEqual(['tests/api.spec.ts', 'src/api.ts']);
  });
});

describe('AL.29 4.3 · the Plan board: per node, the planned test cases, how many pass, the statements to review', () => {
  it('reads the plans the record reads; a node with no plan reads nothing', () => {
    const counts = planTestsByNode(chains());
    expect(counts.get(NODE)).toEqual({ planned: 3, passing: 2, review: 1 });
    const { a4: _plan, ...noPlan } = artifacts;
    expect(planTestsByNode(chains({ artifacts: noPlan })).size).toBe(0);
  });

  it('adds up the plans of every requirement on the node, counts only the cases, and skips an archived requirement', () => {
    const plan2 = [
      '## Acceptance Criteria', '', '- **AC-REQ-002-1** [automated] [PENDING] filter works', '',
      '## Automated Test Scenarios', '', '#### AC-REQ-002-1: filter-works',
      'Derive the test from AC-REQ-002-1 and report the outcome with test_id "TC-REQ-002-1".',
    ].join('\n');
    const both = chains({ artifacts: { ...artifacts, a5: { id: 'a5', nodeId: NODE, path: '.nodespec/tests/req-002.tests.md', kind: 'test-plan', content: plan2, metadata: { requirementId: 'REQ-002' } } } });
    expect(both.map((c) => c.ref)).toEqual(['REQ-001', 'REQ-002']);
    expect(planTestsByNode(both).get(NODE)).toEqual({ planned: 4, passing: 2, review: 1 });
    // a result no case reaches is not a planned case, passing or not
    const one = both[0];
    const extraPass = { ...one, verify: { ...one.verify, tests: one.verify.tests.map((t) => (t.id === 'tc9' ? { ...t, status: 'passed' as const } : t)) } };
    expect(testRowsOf(extraPass).map((r) => r.status)).toEqual(['passed', 'not run', 'passed', 'passed']);
    expect(planTestsByNode([extraPass]).get(NODE)).toEqual({ planned: 3, passing: 2, review: 1 });
    expect(planTestsByNode([{ ...one, archived: true }, both[1]]).get(NODE)).toEqual({ planned: 1, passing: 0, review: 0 });
  });
});

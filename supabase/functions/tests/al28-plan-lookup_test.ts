// AL.28 (owner 2026-10-08, a live production bug): the agent filed 16 test
// plans by hand, each naming the requirement's row id and spelled
// .nodespec/tests/REQ-015.tests.md. get_project_status counted every
// test-plan file (16), while get_test_plan and report_test_results looked for
// "REQ-015" or req-015.tests.md, found none, and get_test_plan filed a second
// plan beside each (REQ-015 and req-015 are one file in a macOS or Windows
// checkout). One lookup now answers for every lane.
import { findExistingTestArtifact } from '../_shared/test-document-generator.ts';
import { handleGetTestPlan } from '../mcp-server/tools/context.ts';
import { handleGetProjectStatus } from '../mcp-server/tools/projects.ts';
import { handleReportTestResults } from '../mcp-server/tools/test-results.ts';
import { buildBoardModel } from '../_shared/board-generator.ts';
import { applyPatches } from '../_shared/core-engine/patch-engine.ts';
import { createEmptyGraph } from '../_shared/core-engine/utils.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

// deno-lint-ignore no-explicit-any
type Any = any;
const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N1 = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';
const REQ_ROW = '55555555-5555-4555-8555-555555555555';
const OTHER_ROW = '66666666-6666-4666-8666-666666666666';
const READ: Any = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read'] };
const WRITE: Any = { userId: 'user-1', authMethod: 'api_key', scopes: ['read', 'write', 'propose'] };

const plan = (path: string, metadata: Record<string, unknown> = {}, content = 'PLAN') =>
  ({ kind: 'test-plan', nodeId: N1, path, content, metadata });

// ── the lookup ───────────────────────────────────────────────────────────────

Deno.test('AL.28 lookup: a plan naming the row id is found when the caller passes it, and only for that requirement', () => {
  const artifacts = { hand: plan('docs/qa/browser-boundary.md', { requirementId: REQ_ROW }) };
  assertEquals(findExistingTestArtifact(artifacts, 'REQ-015', 'Browser boundary', REQ_ROW), artifacts.hand);
  assertEquals(findExistingTestArtifact(artifacts, 'REQ-015', 'Browser boundary'), null, 'no row id given, no row-id match');
  assertEquals(findExistingTestArtifact(artifacts, 'REQ-016', 'Other', OTHER_ROW), null, "another requirement's row id never matches");
});

Deno.test('AL.28 lookup: the id-only path matches in any case, so REQ-015 and req-015 are one plan', () => {
  const artifacts = { upper: plan('.nodespec/tests/REQ-015.tests.md') };
  assertEquals(findExistingTestArtifact(artifacts, 'REQ-015', 'Browser boundary'), artifacts.upper);
  assertEquals(findExistingTestArtifact(artifacts, 'REQ-016', 'Other'), null);
});

Deno.test('AL.28 lookup: a generated plan (human id) is still found first, ahead of a hand-filed one', () => {
  const artifacts = {
    hand: plan('.nodespec/tests/REQ-015.tests.md', { requirementId: REQ_ROW }),
    generated: plan('.nodespec/tests/req-015.tests.md', { requirementId: 'REQ-015' }),
  };
  assertEquals(findExistingTestArtifact(artifacts, 'REQ-015', 'Browser boundary', REQ_ROW), artifacts.generated);
});

// ── get_project_status counts what the lookup finds ──────────────────────────

Deno.test('AL.28 get_project_status counts requirements the lookup finds a plan for: each once, orphans never', async () => {
  const rows = [
    { id: 'row-1', requirement_id: 'REQ-001', name: 'Generated', acceptance_criteria: [] },
    { id: 'row-2', requirement_id: 'REQ-002', name: 'Hand-filed by row id', acceptance_criteria: [] },
    { id: 'row-3', requirement_id: 'REQ-003', name: 'Hand-filed by path', acceptance_criteria: [] },
    { id: 'row-4', requirement_id: 'REQ-004', name: 'No plan', acceptance_criteria: [] },
  ];
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'architecture_confirmed', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', { count: rows.length, data: null, error: null });
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', {
    data: {
      graph_data: {
        nodes: { [N1]: {} },
        artifacts: {
          g1: plan('.nodespec/tests/req-001.tests.md', { requirementId: 'REQ-001' }),
          g1again: plan('.nodespec/tests/req-001-copy.tests.md', { requirementId: 'REQ-001' }),
          h2: plan('docs/qa/two.md', { requirementId: 'row-2' }),
          h3: plan('.nodespec/tests/REQ-003.tests.md'),
          orphan: plan('.nodespec/tests/req-099.tests.md', { requirementId: 'REQ-099', stale: true }),
        },
      },
    },
    error: null,
  });
  sb.script('specification_requirements', 'select', { data: rows, error: null });
  sb.script('test_cases', 'select', { data: [], error: null });
  sb.script('git_change_events', 'select', { count: 0, data: null, error: null });

  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assert(r.success, JSON.stringify(r));
  const coverage = (r.data as Any).testCoverage;
  assertEquals(coverage.requirementsWithTestPlans, 3);
  assertEquals(coverage.requirementsWithoutTestPlans, 1);
  assertEquals(coverage.staleTestPlans, 1, 'plan staleness still reads every plan file');
});

// ── get_test_plan serves the plan the agent filed by hand ────────────────────

function scriptGetTestPlan(sb: FakeSupabase, graph: Any, mappings: Array<{ node_id: string }> = [{ node_id: N1 }]) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  // AL.29: get_test_plan resolves the requirement inside the project's specification.
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: REQ_ROW, requirement_id: 'REQ-015', name: 'Browser boundary', description: 'Browser code reaches secret-backed services only through the App API', category: 'functional', status: 'pending', acceptance_criteria: [{ text: 'No secret leaves the API' }], specification_id: 'spec-1' },
    error: null,
  });
  sb.script('graph_snapshots', 'select', { data: { graph_data: graph }, error: null });
  sb.script('specification_mappings', 'select', { data: mappings, error: null });
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  sb.script('test_cases', 'select', { data: [], error: null });
}

const webApp = () => ({ [N1]: { id: N1, label: 'Web App', type: 'frontend-app', technology: 'react', artifacts: ['hand'] } });

Deno.test('AL.28 get_test_plan: a plan filed by hand under the row id is the plan; nothing new is filed', async () => {
  const sb = new FakeSupabase();
  scriptGetTestPlan(sb, { nodes: webApp(), edges: {}, contracts: {}, artifacts: { hand: { id: 'hand', ...plan('docs/qa/browser-boundary.md', { requirementId: REQ_ROW }, 'HAND-WRITTEN STRATEGY') } } });

  const r = await handleGetTestPlan(sb as never, READ, { project_id: PROJECT.id, branch_id: BRANCH, requirement_id: REQ_ROW });
  assert(r.success, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals(data.testPlanIsNew, false);
  assert(String(data.testPlanContent).includes('HAND-WRITTEN STRATEGY'), 'the stored plan is served as written');
  assertEquals(data.proposalId, undefined);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0, 'no second plan is filed');
});

Deno.test('AL.28 get_test_plan: REQ-015.tests.md is the plan for REQ-015; no req-015.tests.md is filed beside it', async () => {
  const sb = new FakeSupabase();
  scriptGetTestPlan(sb, { nodes: webApp(), edges: {}, contracts: {}, artifacts: { hand: { id: 'hand', ...plan('.nodespec/tests/REQ-015.tests.md', {}, 'UPPER CASE PLAN') } } });

  const r = await handleGetTestPlan(sb as never, READ, { project_id: PROJECT.id, branch_id: BRANCH, requirement_id: REQ_ROW });
  assert(r.success, JSON.stringify(r));
  assertEquals((r.data as Any).testPlanIsNew, false);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);
});

Deno.test('AL.28 get_test_plan: a new plan goes on the first mapped node the graph still holds, and applies there', async () => {
  // A mapping to a deleted node used to become the plan's node, and the
  // create then failed (NODE_NOT_FOUND) every time it was applied.
  const sb = new FakeSupabase();
  const graph = { ...createEmptyGraph(), nodes: { [N1]: { id: N1, label: 'Web App', type: 'frontend-app', technology: 'react', artifacts: [] } } };
  scriptGetTestPlan(sb, graph, [{ node_id: GONE }, { node_id: N1 }]);

  const r = await handleGetTestPlan(sb as never, READ, { project_id: PROJECT.id, branch_id: BRANCH, requirement_id: REQ_ROW });
  assert(r.success, JSON.stringify(r));
  assertEquals((r.data as Any).testPlanIsNew, true);
  const mappingRead = sb.callsTo('specification_mappings', 'select')[0];
  assert(mappingRead.filters.some((f) => f.method === 'order' && f.args[0] === 'created_at'), 'the first mapped node, every time');

  const patches = (sb.callsTo('ai_proposals', 'insert')[0].payload as Any).patches.map((p: Any) => p.patch);
  assertEquals(patches.map((p: Any) => [p.type, p.payload.nodeId]), [['add_artifact', N1]]);
  const applied = applyPatches(graph as never, patches);
  assert(applied.success, JSON.stringify(applied.error));
  assertEquals(applied.graph!.nodes[N1].artifacts, [patches[0].payload.id]);
});

// ── report_test_results ties results to the same plan ────────────────────────

Deno.test('AL.28 report_test_results: a plan filed under the row id is the plan, so no orphan warning', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT.id, name: 'Demo' }, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: { id: REQ_ROW, requirement_id: 'REQ-015', name: 'Browser boundary', locked: false, acceptance_criteria: [] }, error: null });
  sb.script('test_cases', 'select', { data: [], error: null });
  sb.script('test_cases', 'insert', { data: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('specification_requirements', 'select', { data: { acceptance_criteria: [] }, error: null });
  sb.script('branches', 'select', { data: { id: 'branch-main' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { artifacts: { hand: plan('docs/qa/browser-boundary.md', { requirementId: REQ_ROW }) } } }, error: null });

  const r = await handleReportTestResults(sb as never, WRITE, {
    project_id: PROJECT.id, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-1', status: 'passed' }],
  });
  assert(r.success, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals(data.testPlan, { exists: true, path: 'docs/qa/browser-boundary.md' });
  assert(!(data.warnings as string[] | undefined)?.some((w) => w.includes('No test plan')), 'no orphan warning');
});

// ── the board git-push writes names the same plan ────────────────────────────

Deno.test('AL.28 the board names a plan filed under the row id as the requirement\'s plan', async () => {
  const sb = new FakeSupabase();
  sb.script('test_cases', 'select', { data: [], error: null });
  sb.script('task_items', 'select', { data: [], error: null });
  sb.script('specification_requirement_relations', 'select', { data: [], error: null });
  const model = await buildBoardModel(sb as never, PROJECT.id, {
    graph: { nodes: { [N1]: { id: N1, label: 'Web App' } }, artifacts: { hand: plan('docs/qa/browser-boundary.md', { requirementId: REQ_ROW }) } },
    requirements: [{ id: REQ_ROW, requirement_id: 'REQ-015', name: 'Browser boundary', status: 'pending', acceptance_criteria: [] }],
    mappings: [{ requirementId: REQ_ROW, nodeId: N1 }],
  });
  assertEquals(model.requirements[0].planPath, 'docs/qa/browser-boundary.md');
});

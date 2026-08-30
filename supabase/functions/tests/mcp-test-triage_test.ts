// C4 step 4 · the triage surface: failed/stale test cases must SURFACE where the
// implementing AI already looks — get_build_readiness (per-node `tests` advisory with
// the re-verify pointer) and get_project_status (project-wide totals). Also pins the
// three Discovered fixes: #1 the column is `stale` (is_stale does not exist — the old
// selects errored and every summary silently read empty), #2 test_cases has NO
// specification_id column (join through the spec's requirement ROW ids), #3 test-plan
// staleness is metadata.stale (not a fingerprint-timestamp age heuristic).
import { handleGetBuildReadiness } from '../mcp-server/tools/tasks.ts';
import { handleGetProjectStatus } from '../mcp-server/tools/projects.ts';
import { FakeSupabase, assert, assertEquals, completeRole } from './helpers.ts';
// deno-lint-ignore no-explicit-any
type Any = any;

const READ: Any = { userId: 'user-1', scopes: ['read'], authMethod: 'api_key' };
const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N_WORKER = '33333333-3333-4333-8333-333333333333';
const N_DB = '44444444-4444-4444-8444-444444444444';
const N_LONELY = '55555555-5555-4555-8555-555555555555';
const REQ_ROW = '77777777-7777-4777-8777-777777777777';

// ── get_build_readiness: the `tests` advisory ────────────────────────────────────────

const ROLES = [{ id: 'backend-service', kind: 'app_service', is_container: false, treatment_mode: 'leaf' }];
const TECHS = [
  { id: 'aws-lambda', name: 'AWS Lambda', role_affinities: ['backend-service'], ai_context: { configMode: 'code' } },
  { id: 'express', name: 'Express', role_affinities: ['backend-service'], ai_context: {} },
];

function readinessGraph(): Any {
  return {
    nodes: {
      [N_WORKER]: { id: N_WORKER, type: 'backend-service', label: 'Heavy Job Worker', technology: 'aws-lambda', ports: [] },
      [N_DB]: { id: N_DB, type: 'backend-service', label: 'Primary Database', technology: 'express', ports: [] },
      [N_LONELY]: { id: N_LONELY, type: 'backend-service', label: 'Lonely Service', technology: 'express', ports: [] },
    },
    edges: {},
    contracts: {},
    artifacts: {},
  };
}

function scriptReadiness(sb: FakeSupabase, testCaseRows: Any[]) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: readinessGraph() }, error: null });
  sb.script('node_roles', 'select', { data: ROLES.map(completeRole), error: null });
  sb.script('technology_catalog', 'select', { data: TECHS, error: null });
  for (const t of ['deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: 'Bench' }, error: null });
  sb.script('specification_mappings', 'select', {
    data: [
      { requirement_id: REQ_ROW, node_id: N_WORKER },
      { requirement_id: REQ_ROW, node_id: N_DB },
    ],
    error: null,
  });
  sb.script('specification_requirements', 'select', {
    data: [{
      id: REQ_ROW, requirement_id: 'REQ-005', name: 'Dedicated Compute',
      description: 'Background jobs on dedicated compute.', category: 'technical', status: 'in-progress',
      acceptance_criteria: [{ text: 'Compute has no public-facing network path', met: false }],
    }],
    error: null,
  });
  sb.script('test_cases', 'select', { data: testCaseRows, error: null });
}

Deno.test('get_build_readiness: failed/stale cases surface as a tests ADVISORY naming counts + requirement ids, on every node serving the requirement', async () => {
  const sb = new FakeSupabase();
  scriptReadiness(sb, [
    { requirement_id: REQ_ROW, status: 'failed', stale: false },
    { requirement_id: REQ_ROW, status: 'passed', stale: true },
    { requirement_id: REQ_ROW, status: 'passed', stale: false }, // healthy — counts nowhere
  ]);

  const r = await handleGetBuildReadiness(sb as never, READ, { project_id: PROJECT.id, branch_id: BRANCH, detail: 'full' });
  assert(r.success, JSON.stringify(r));
  const nodes = (r.data as Any).nodes as Any[];

  const worker = nodes.find((n) => n.label === 'Heavy Job Worker');
  const advisory = (worker.advisories as Any[]).find((a) => a.kind === 'tests');
  assert(advisory, 'tests advisory present');
  assert(advisory.detail.includes('1 failing'), 'failed count named');
  assert(advisory.detail.includes('1 stale'), 'stale count named');
  assert(advisory.detail.includes('REQ-005'), 'requirement id named so the AI can re-run exactly those plans');
  // WS1: resolution actions live ONCE in the top-level remediations map, keyed by kind.
  const remediations = (r.data as Any).remediations as Record<string, string>;
  assert(remediations.tests.includes('get_test_plan'), 'remediation points at the plan');
  assert(remediations.tests.includes('report_test_results'), 'remediation points at the evidence lane');
  assert(!('resolveWith' in advisory), 'gaps never carry resolveWith over MCP');

  // Advisory, not blocker: the build brief is fine — the VERIFICATION is behind.
  assert(!(worker.blockers as Any[]).some((b) => b.kind === 'tests'), 'never a blocker');

  // Both nodes serving the requirement carry the backlog; the unmapped node does not.
  assert((nodes.find((n) => n.label === 'Primary Database').advisories as Any[]).some((a) => a.kind === 'tests'));
  assert(!(nodes.find((n) => n.label === 'Lonely Service').advisories as Any[]).some((a) => a.kind === 'tests'));

  // Discovered #1/#2 at the query level: ONE batch query, keyed by requirement ROW
  // uuids, selecting `stale` — never is_stale, never specification_id.
  const q = sb.callsTo('test_cases', 'select');
  assertEquals(q.length, 1, 'one .in() batch query for all mapped requirements');
  assert(String(q[0].payload).includes('stale') && !String(q[0].payload).includes('is_stale'), 'selects the real column');
  const inFilter = q[0].filters.find((f) => f.method === 'in');
  assertEquals(inFilter?.args, ['requirement_id', [REQ_ROW]]);
});

Deno.test('get_build_readiness: healthy cases produce NO tests advisory', async () => {
  const sb = new FakeSupabase();
  scriptReadiness(sb, [{ requirement_id: REQ_ROW, status: 'passed', stale: false }]);
  const r = await handleGetBuildReadiness(sb as never, READ, { project_id: PROJECT.id, branch_id: BRANCH, detail: 'full' });
  assert(r.success, JSON.stringify(r));
  for (const n of (r.data as Any).nodes as Any[]) {
    assert(!(n.advisories as Any[]).some((a: Any) => a.kind === 'tests'), `${n.label}: no backlog, no advisory`);
  }
  assert(!('tests' in ((r.data as Any).remediations as Record<string, string>)), 'no backlog → no tests remediation');
});

// ── get_project_status: Discovered #1 + #2 + #3 ─────────────────────────────────────

Deno.test('get_project_status: test-case totals join through requirement ROW ids and read `stale`; plan staleness is metadata.stale only', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'architecture_confirmed', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', { count: 2, data: null, error: null }); // reqCount head query
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', {
    data: {
      graph_data: {
        nodes: { n1: {} },
        artifacts: {
          // Discovered #3: metadata.stale is the ONLY staleness truth for plans.
          tp1: { kind: 'test-plan', metadata: { stale: true } },
          tp2: { kind: 'test-plan', metadata: { testContextFingerprint: { fingerprint: 'x' }, stale: false } },
          // The OLD (wrong) signal — a fingerprint timestamp 30 days old. Must NOT count.
          tp3: { kind: 'test-plan', metadata: { fingerprint: { timestamp: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() } } },
          doc1: { kind: 'task', metadata: { stale: true } }, // wrong kind — never counted
        },
      },
    },
    error: null,
  });
  sb.script('specification_requirements', 'select', { data: [{ id: 'r1' }, { id: 'r2' }], error: null }); // row ids
  sb.script('test_cases', 'select', {
    data: [
      { id: 'c1', status: 'failed', stale: true },
      { id: 'c2', status: 'passed', stale: false },
      { id: 'c3', status: 'not_started', stale: true },
    ],
    error: null,
  });
  sb.script('git_change_events', 'select', { count: 0, data: null, error: null });

  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assert(r.success, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals(data.counts.testCases, 3);
  assertEquals(data.testCoverage.staleTestPlans, 1, 'metadata.stale only — the age heuristic is gone');
  assertEquals(data.testCoverage.staleTestCases, 2);
  assertEquals(data.testCoverage.failedTestCases, 1);
  assertEquals(data.testCoverage.requirementsWithTestPlans, 3);

  // Discovered #2: the join goes spec -> requirement row ids -> test_cases.
  const caseQueries = sb.callsTo('test_cases', 'select');
  assertEquals(caseQueries.length, 1);
  const inFilter = caseQueries[0].filters.find((f) => f.method === 'in');
  assertEquals(inFilter?.args, ['requirement_id', ['r1', 'r2']]);
  assert(!caseQueries[0].filters.some((f) => f.method === 'eq' && f.args[0] === 'specification_id'),
    'test_cases has NO specification_id column — the old filter matched nothing');
  // Discovered #1: the real column name.
  assert(String(caseQueries[0].payload).includes('stale') && !String(caseQueries[0].payload).includes('is_stale'));
});

Deno.test('get_project_status: no requirements -> no test_cases query at all', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', { count: 0, data: null, error: null });
  sb.script('branches', 'select', { data: null, error: null });
  sb.script('specification_requirements', 'select', { data: [], error: null });
  sb.script('git_change_events', 'select', { count: 0, data: null, error: null });

  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assert(r.success, JSON.stringify(r));
  assertEquals(sb.callsTo('test_cases').length, 0, 'an .in() over zero row ids is a no-op — skip it');
  assertEquals((r.data as Any).counts.testCases, 0);
});

// ── Discovered #1, source level: is_stale is gone from every live query ─────────────
// FakeSupabase cannot see the two summary sites inside context.ts's shared assembly
// without a full fixture, so the column name is pinned at source: a quoted `is_stale`
// (select list or filter) must never reappear. Backticked comments explaining the fix
// don't match.
Deno.test('no MCP tool queries is_stale — the column is stale', () => {
  for (const rel of ['../mcp-server/tools/context.ts', '../mcp-server/tools/projects.ts', '../mcp-server/tools/tasks.ts', '../mcp-server/tools/test-results.ts']) {
    const src = Deno.readTextFileSync(new URL(rel, import.meta.url));
    assert(!src.includes("is_stale'") && !src.includes("'is_stale"), `${rel}: quoted is_stale present`);
  }
});

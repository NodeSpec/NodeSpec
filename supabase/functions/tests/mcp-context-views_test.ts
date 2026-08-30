// WS1: get_project_context views — the token diet on the primary read surface
// (owner-measured ~33k tokens/call; the task doc shipped up to THREE times: as
// context.promptDocument, as the top-level re-emit, and again as the task artifact's
// contentPreview). Pins: brief/structured/full response contracts, the document
// appearing at most ONCE per response (D1), task/test-plan artifacts excluded from
// existingArtifacts (D2), inline contract.schema reported present (the assembly used
// to read only schemaRef), schemaPreview bounded + enveloped, and requirement-target
// READ PURITY (plan STATE only — no generation, no parked proposal; that lane stays
// in get_test_plan).
import { handleGetProjectContext } from '../mcp-server/tools/context.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N_API = '33333333-3333-4333-8333-333333333333';
const N_DB = '44444444-4444-4444-8444-444444444444';
const REQ_ROW = '77777777-7777-4777-8777-777777777777';

const READ_AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read'] } as never;

// Big enough that JSON.stringify(schema, null, 2) exceeds the 600-char preview cap.
const BIG_SCHEMA = {
  table: 'tasks',
  operation: 'select',
  columns: Array.from({ length: 40 }, (_, i) => `column_name_${i}`),
};

// deno-lint-ignore no-explicit-any
function viewGraph(): any {
  return {
    nodes: {
      [N_API]: { id: N_API, label: 'API Service', type: 'backend-service', technology: 'express', ports: [] },
      [N_DB]: { id: N_DB, label: 'Primary Database', type: 'backend-service', ports: [] },
    },
    edges: { e1: { id: 'e1', source: N_API, target: N_DB, contractId: 'c1' } },
    // INLINE schema (what update_contract {schema} writes) — no schemaRef at all.
    contracts: { c1: { id: 'c1', name: 'Data Queries', kind: 'sql', schema: BIG_SCHEMA } },
    artifacts: {
      t1: { id: 't1', nodeId: N_API, kind: 'task', path: '.nodespec/tasks/api-service.task.md', content: 'TASKDOCBODY', status: 'draft' },
      s1: { id: 's1', nodeId: N_API, kind: 'source', path: 'src/index.ts', content: 'SOURCEBODY', status: 'draft', language: 'typescript' },
      tp1: {
        id: 'tp1', nodeId: N_API, kind: 'test-plan', path: '.nodespec/tests/req-001.tests.md', content: 'PLANBODY', status: 'draft',
        metadata: { requirementId: 'REQ-001', testContextFingerprint: { fingerprint: 'fp1' }, stale: false },
      },
    },
  };
}

const REQ_LIST_ROW = {
  id: REQ_ROW, requirement_id: 'REQ-001', name: 'Store tasks', description: 'Tasks persist across restarts',
  category: 'functional', status: 'pending', acceptance_criteria: [{ text: 'tasks persist', met: false }],
};

// Handler query order: projects (resolve) → branches (guard) → [projects, branches,
// graph_snapshots, catalogs] (assembly) → project_specifications → requirements +
// mappings → project_specifications (phase_status). Queues are FIFO per table.op.
// deno-lint-ignore no-explicit-any
function scriptContext(sb: FakeSupabase, g: any) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { name: 'main' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: g }, error: null });
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: 'Vision text', constraints: [], preferences: {} }, error: null });
  sb.script('specification_requirements', 'select', { data: [REQ_LIST_ROW], error: null });
  sb.script('specification_mappings', 'select', { data: [{ requirement_id: REQ_ROW, node_id: N_API }], error: null });
  sb.script('project_specifications', 'select', { data: { phase_status: 'architecture_confirmed' }, error: null });
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

Deno.test('get_project_context view brief (default): promptDocument + hints only — no context block, doc exactly once', async () => {
  const sb = new FakeSupabase();
  scriptContext(sb, viewGraph());

  const r = await handleGetProjectContext(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, target_type: 'node', target_id: 'API Service' });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.view, 'brief');
  assert(!('context' in data), 'brief never ships the model context');
  assert(String(data.promptDocument).startsWith('<untrusted-data>'), 'doc stays enveloped (P0-7)');
  assert(String(data.promptDocument).includes('TASKDOCBODY'), 'the stored task doc IS the brief');
  assertEquals(count(JSON.stringify(data), 'TASKDOCBODY'), 1, 'D1: the document travels exactly once');
  assertEquals(data.target.id, N_API);
  assertEquals(data.target.type, 'node');
  assert(String(data.target.label).includes('API Service'), 'target label present (wrapped)');
  assert(typeof data.untrustedDataAdvisory === 'string' && data.untrustedDataAdvisory.length > 0, 'advisory rides the brief');
  assert(data.processHints.currentPhase === 'architecture_confirmed');
});

Deno.test('get_project_context view structured: model context WITHOUT the document; inline schema reports present as preview+hash; task/test-plan artifacts excluded (D2)', async () => {
  const sb = new FakeSupabase();
  scriptContext(sb, viewGraph());

  const r = await handleGetProjectContext(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, target_type: 'node', target_id: 'API Service', view: 'structured' });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.view, 'structured');
  assert(!('promptDocument' in data), 'structured never ships the document');
  const json = JSON.stringify(data);
  assertEquals(count(json, 'TASKDOCBODY'), 0, 'no doc copy anywhere — not even as an artifact preview');
  assertEquals(count(json, 'PLANBODY'), 0, 'test-plan artifacts excluded too (they ship via get_test_plan)');

  const contract = data.context.target.node.contracts[0];
  // Inline-schema-first: the old read honored only schemaRef and would report absent.
  assertEquals(contract.schemaPresent, true, 'inline contract.schema counts as present');
  assertEquals(contract.schemaContent, null, 'the body is full-view-only');
  assert(/^[0-9a-f]{8}$/.test(contract.schemaHash), 'stable h8 content hash');
  assert(String(contract.schemaPreview).startsWith('<untrusted-data>'), 'preview is user-authored → enveloped');
  assert(String(contract.schemaPreview).includes('column_name_0'), 'preview shows the head of the schema');
  assert(String(contract.schemaPreview).includes('(truncated)'), 'preview is bounded at 600 chars');
  assert(!String(contract.schemaPreview).includes('column_name_39'), 'the tail never rides the preview');

  // deno-lint-ignore no-explicit-any
  const paths = (data.context.existingArtifacts as any[]).map((a) => a.path);
  assert(paths.includes('src/index.ts'), 'source artifacts still listed');
  assert(!paths.some((p: string) => p.includes('.task.md') || p.includes('.tests.md')), 'task/test-plan bindings dropped');
});

Deno.test('get_project_context view full: structured context with full schema bodies + the document once at top level', async () => {
  const sb = new FakeSupabase();
  scriptContext(sb, viewGraph());

  const r = await handleGetProjectContext(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, target_type: 'node', target_id: 'API Service', view: 'full' });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.view, 'full');
  assert(String(data.promptDocument).includes('TASKDOCBODY'), 'document present at top level');
  assertEquals(count(JSON.stringify(data), 'TASKDOCBODY'), 1, 'D1 holds in full view too — never re-emitted inside context');

  const contract = data.context.target.node.contracts[0];
  assertEquals(contract.schemaPresent, true);
  assert(String(contract.schemaContent).includes('column_name_39'), 'full view carries the complete schema body');
  assert(/^[0-9a-f]{8}$/.test(contract.schemaHash), 'hash still rides along');
});

Deno.test('get_project_context view guard: unknown view is rejected, not silently defaulted', async () => {
  const sb = new FakeSupabase();
  const r = await handleGetProjectContext(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, target_type: 'node', target_id: 'API Service', view: 'verbose' });
  assertEquals(r.success, false);
  assert(String(r.error).includes("'brief' | 'structured' | 'full'"), 'error names the valid views');
});

// ── WS1 READ PURITY: requirement targets report plan STATE, never generate ──────────

// deno-lint-ignore no-explicit-any
function scriptRequirementRead(sb: FakeSupabase, g: any, testCaseRows: any[]) {
  scriptContext(sb, g);
  sb.script('specification_requirements', 'select', { data: REQ_LIST_ROW, error: null }); // handler maybeSingle
  sb.script('graph_snapshots', 'select', { data: { graph_data: g }, error: null }); // plan-state lookup
  sb.script('test_cases', 'select', { data: testCaseRows, error: null });
}

Deno.test('requirement target with NO stored plan: exists:false + get_test_plan pointer — nothing generated, nothing parked', async () => {
  // deno-lint-ignore no-explicit-any
  const g: any = viewGraph();
  delete g.artifacts.tp1; // no stored plan

  const sb = new FakeSupabase();
  scriptRequirementRead(sb, g, [{ id: 'c1', status: 'failed', stale: true }]);

  const r = await handleGetProjectContext(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, target_type: 'requirement', target_id: REQ_ROW });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.testPlan.exists, false);
  assert(String(data.testPlan.note).includes('get_test_plan'), 'points at the lane that owns generation');
  assertEquals(data.testPlan.testCaseSummary, { total: 1, passed: 0, failed: 1, stale: 1 });
  // The read stayed pure: the pre-WS1 behavior generated a plan and parked a proposal.
  assertEquals(sb.callsTo('ai_runs').length, 0, 'no ai_runs row from a read');
  assertEquals(sb.callsTo('ai_proposals').length, 0, 'no proposal parked from a read');
  assert(String(data.target.label).includes('Store tasks'), 'brief target label falls back to the requirement name');
});

Deno.test('requirement target with a stored plan: state summary (path/stale/fingerprint) — the content itself stays in get_test_plan', async () => {
  const sb = new FakeSupabase();
  const g = viewGraph();
  scriptRequirementRead(sb, g, []);

  const r = await handleGetProjectContext(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, target_type: 'requirement', target_id: REQ_ROW });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.testPlan.exists, true);
  assertEquals(data.testPlan.path, '.nodespec/tests/req-001.tests.md', 'found via the rename-proof lookup');
  assertEquals(data.testPlan.stale, false);
  assertEquals(data.testPlan.fingerprint, { fingerprint: 'fp1' });
  assertEquals(count(JSON.stringify(data), 'PLANBODY'), 0, 'plan CONTENT never rides the context read');
  assertEquals(sb.callsTo('ai_proposals').length, 0);
});

Deno.test('stale-phase fix (owner 2026-08-23): a resolved NODE target floors the hint phase at architecture_confirmed', async () => {
  // Same chain scriptContext builds, but the final phase read returns the
  // STALE wizard column value.
  const sb2 = new FakeSupabase();
  sb2.script('projects', 'select', { data: PROJECT, error: null });
  sb2.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb2.script('projects', 'select', { data: PROJECT, error: null });
  sb2.script('branches', 'select', { data: { name: 'main' }, error: null });
  sb2.script('graph_snapshots', 'select', { data: { graph_data: viewGraph() }, error: null });
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb2.script(t, 'select', { data: [], error: null });
  }
  sb2.script('project_specifications', 'select', { data: { id: 'spec-1', vision: 'Vision text', constraints: [], preferences: {} }, error: null });
  sb2.script('specification_requirements', 'select', { data: [REQ_LIST_ROW], error: null });
  sb2.script('specification_mappings', 'select', { data: [{ requirement_id: REQ_ROW, node_id: N_API }], error: null });
  sb2.script('project_specifications', 'select', { data: { phase_status: 'drafting_requirements' }, error: null }); // the stale column

  const r = await handleGetProjectContext(sb2 as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, target_type: 'node', target_id: 'API Service' });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const hints = (r.data as any).processHints;
  // The call resolved a concrete node — that IS evidence the project is past
  // drafting; the hint must not claim requirements are still being drafted.
  assertEquals(hints.currentPhase, 'architecture_confirmed');
  assert(String(hints.nextStep).includes('implementation brief'), hints.nextStep);
});

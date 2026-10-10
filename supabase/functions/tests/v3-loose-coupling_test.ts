// 9.7 (owner ruling 2, 2026-09-16): THE LOOSE-COUPLING PIN, as AA amends it.
//
// 2026-09-16: "Vision → Workflows → Outcomes w/ Constraints → Requirements
// → ... isn't so tightly coupled that the user's AI will not proceed."
//
// AA (owner 2026-09-23): "the only thing that makes these optional is the
// tiering of the user's plan. Having vision with zero downstream provenance
// makes the field and data useless." So where the plan carries a link, a
// missing link is a readiness gap, reported in get_build_readiness's
// `chain` block. What survives of 9.7 is the half that keeps the agent
// moving: five tools of the build loop (task docs, test plans, the queue,
// checkouts, test reports) run against a project with requirements +
// mappings and an EMPTY vision, no workflows, no outcomes, no constraints,
// and none refuses or names any of it; a node's own blocker vocabulary stays
// schema | owner | doc; and settling or dismissing an outcome still writes
// nothing to a requirement, a task or a test.
//
// FakeSupabase answers an unscripted read with null, which IS the empty
// ideation, and a Community owner. Constraints are Indie and above (AC,
// owner 2026-09-24): here they are not read, and nothing names them.
import { handleGetBuildReadiness, handleGenerateTaskDocs } from '../mcp-server/tools/tasks.ts';
import { handleGetTestPlan } from '../mcp-server/tools/context.ts';
import { handleGetWorkQueue, handleCheckoutTask } from '../mcp-server/tools/checkouts.ts';
import { handleReportTestResults } from '../mcp-server/tools/test-results.ts';
import { applySpecPatch } from '../mcp-server/tools/spec-patch-apply.ts';
import { SpecPatchOperationSchema } from '../_shared/spec-patch-schema.ts';
import { FakeSupabase, assert, assertEquals, completeRole } from './helpers.ts';

const read = (rel: string) => Deno.readTextFileSync(new URL(rel, import.meta.url));
const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N_API = '33333333-3333-4333-8333-333333333333';
const N_DB = '44444444-4444-4444-8444-444444444444';
const REQ_ROW = '77777777-7777-4777-8777-777777777777';
const TASK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAND = '55555555-5555-4555-8555-555555555555';
const CASE1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const READ_AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read'] } as never;
const WRITE_AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write', 'propose'] } as never;

const UPSTREAM = /vision|workflow|outcome|candidate|constraint|coupling/i;
const BLOCKER_KINDS = new Set(['schema', 'owner', 'doc']);

// deno-lint-ignore no-explicit-any
function graph(): any {
  return {
    nodes: {
      [N_API]: { id: N_API, type: 'backend-service', label: 'API Service', technology: 'express', ports: [] },
      [N_DB]: { id: N_DB, type: 'backend-service', label: 'Primary Database', technology: 'express', ports: [] },
    },
    edges: { e1: { id: 'e1', source: N_API, target: N_DB, contractId: 'c1' } },
    contracts: { c1: { id: 'c1', name: 'Data Queries', kind: 'sql', schema: { ok: true } } },
    artifacts: {},
  };
}
const REQ = {
  id: REQ_ROW, requirement_id: 'REQ-001', name: 'Health endpoint', description: 'The API must expose /health',
  category: 'technical', status: 'pending', locked: false,
  acceptance_criteria: [{ text: 'GET /health returns 200', met: false }],
};
function scriptCatalogs(sb: FakeSupabase) {
  sb.script('node_roles', 'select', { data: [{ id: 'backend-service', kind: 'app_service', is_container: false, treatment_mode: 'leaf' }].map(completeRole), error: null });
  sb.script('technology_catalog', 'select', { data: [{ id: 'express', name: 'Express', role_affinities: ['backend-service'], ai_context: {} }], error: null });
  for (const t of ['deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
}
/** Requirements + mappings, EMPTY vision, and nothing above the requirements. */
function scriptSpec(sb: FakeSupabase, opts: { vision?: string; requirements?: boolean } = {}) {
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: opts.vision ?? '' }, error: null });
  const withReqs = opts.requirements ?? true;
  sb.script('specification_mappings', 'select', { data: withReqs ? [{ requirement_id: REQ_ROW, node_id: N_API }] : [], error: null });
  sb.script('specification_requirements', 'select', { data: withReqs ? [REQ] : [], error: null });
}
function scriptReadiness(sb: FakeSupabase, opts: { vision?: string; requirements?: boolean } = {}) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: graph() }, error: null });
  scriptCatalogs(sb);
  scriptSpec(sb, opts);
}
// deno-lint-ignore no-explicit-any
const gapsOf = (data: any) => (data.nodes as any[]).flatMap((n) => [...(n.blockers ?? []), ...(n.advisories ?? [])]);
// deno-lint-ignore no-explicit-any
const blockerKinds = (data: any) => new Set((data.nodes as any[]).flatMap((n) => (n.blockers ?? []).map((b: any) => b.kind)));

Deno.test('9.7 + AA.1: get_build_readiness with requirements + mappings and an EMPTY ideation — nodes keep their vocabulary; the chain reports the missing links', async () => {
  const sb = new FakeSupabase();
  scriptReadiness(sb);
  sb.script('specification_requirements', 'select', { data: [{ ...REQ, mark: null, archived_at: null }], error: null }); // the chain reads every requirement
  const r = await handleGetBuildReadiness(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, detail: 'full' });
  assertEquals(r.success, true, JSON.stringify(r).slice(0, 300));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  for (const k of blockerKinds(data)) assert(BLOCKER_KINDS.has(k), `node blocker vocabulary: ${k}`);
  assert(blockerKinds(data).has('doc'), 'the missing task doc is the node blocker — on doc grounds');
  for (const g of gapsOf(data)) assert(!UPSTREAM.test(JSON.stringify(g)), `a NODE gap names the ideation: ${JSON.stringify(g)}`);
  assertEquals(data.candidatesOpen ?? 0, 0);
  // AA.1: the chain names what the plan carries and the project lacks
  assertEquals(data.chain.ready, false);
  assertEquals(data.chain.blockers.map((g: { kind: string }) => g.kind), ['vision', 'origin']);
  assertEquals(data.chain.blockers[1].items.map((i: { id: string }) => i.id), ['REQ-001']);
  assert(!JSON.stringify(data).toLowerCase().includes('constraint'), 'constraints do not exist on this plan: no note, no gap');
  assert(String(data.message).includes('nothing waits on them'), 'the message says the build is not held');
  assert(typeof data.remediations.origin === 'string' && data.remediations.origin.includes('attach_candidate'), 'the origin fix is named once');
  for (const t of ['workflows', 'workflow_steps', 'couplings', 'outcome_step_maps']) {
    assertEquals(sb.callsTo(t).length, 0, `${t} is not read on a plan without Workflows`);
  }
  assertEquals(sb.callsTo('project_constraints').length, 0, 'not read on a plan without them');
});

Deno.test('9.7 edge + AA.1: a vision but NO requirements — node blockers stay doc, the chain says no outcome cites the vision', async () => {
  const sb = new FakeSupabase();
  scriptReadiness(sb, { vision: 'A grand vision the AI must never wait on', requirements: false });
  const r = await handleGetBuildReadiness(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, detail: 'full' });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals([...blockerKinds(data)], ['doc']);
  // deno-lint-ignore no-explicit-any
  assert((data.nodes as any[]).every((n) => (n.advisories ?? []).some((a: any) => a.kind === 'mapping')), 'unmapped nodes read as a mapping ADVISORY');
  for (const g of gapsOf(data)) assert(!/vision/i.test(JSON.stringify(g)), 'no NODE gap mentions the vision');
  assertEquals(data.chain.blockers.map((g: { kind: string; detail: string }) => [g.kind, g.detail]), [['vision', 'No outcome cites the vision, so nothing built traces back to it.']]);
  assertEquals(data.chain.counts.visionSentences, 1);
  assert(typeof data.remediations.vision === 'string' && data.remediations.vision.includes('update_vision'));
});

Deno.test('9.7: generate_task_docs and get_test_plan proceed on requirements alone', async () => {
  const docs = new FakeSupabase();
  docs.script('projects', 'select', { data: PROJECT, error: null });
  docs.script('branches', 'select', { data: { id: BRANCH }, error: null });
  docs.script('graph_snapshots', 'select', { data: { graph_data: graph() }, error: null });
  scriptCatalogs(docs);
  scriptSpec(docs);
  docs.script('ai_runs', 'insert', { data: null, error: null });
  docs.script('ai_proposals', 'insert', { data: null, error: null });
  const d = await handleGenerateTaskDocs(docs as never, WRITE_AUTH, { project_id: PROJECT.id, branch_id: BRANCH });
  assertEquals(d.success, true, JSON.stringify(d).slice(0, 300));
  assert(((d.data as { generated: number }).generated) >= 1, 'a packet was generated');
  assertEquals(docs.callsTo('workflows').length + docs.callsTo('requirement_candidates').length, 0);
  // AC: below Indie the constraints are not read and the packet carries no block for them.
  assertEquals(docs.callsTo('project_constraints').length, 0);
  assert(!JSON.stringify(docs.callsTo('ai_proposals', 'insert')[0].payload).includes('Constraints That Apply Here'), 'no constraints block');

  const plan = new FakeSupabase();
  plan.script('projects', 'select', { data: PROJECT, error: null });
  // AL.29: get_test_plan resolves the requirement inside the project's specification.
  plan.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  plan.script('specification_requirements', 'select', { data: REQ, error: null });
  plan.script('graph_snapshots', 'select', { data: { graph_data: graph() }, error: null });
  plan.script('specification_mappings', 'select', { data: [{ node_id: N_API }], error: null });
  scriptCatalogs(plan);
  plan.script('ai_runs', 'insert', { data: null, error: null });
  plan.script('ai_proposals', 'insert', { data: null, error: null });
  plan.script('test_cases', 'select', { data: [], error: null });
  const p = await handleGetTestPlan(plan as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, requirement_id: REQ_ROW });
  assertEquals(p.success, true, JSON.stringify(p).slice(0, 300));
  assertEquals((p.data as { testPlanIsNew: boolean }).testPlanIsNew, true);
});

Deno.test('9.7: get_work_queue serves the queue and checkout_task claims with nothing above the requirements present', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('projects', 'select', { data: PROJECT, error: null }); // readiness resolves the project again
  sb.script('task_items', 'select', {
    data: [
      { id: TASK_A, node_id: N_API, task_key: 'a3f19c02', display_id: 'T1', title: 'Wire the API', done: false, orphaned: false },
      { id: TASK_B, node_id: N_DB, task_key: 'b4e28d13', display_id: 'T2', title: 'Provision the store', done: false, orphaned: false },
    ],
    error: null,
  });
  sb.script('work_plans', 'select', { data: null, error: { message: 'relation "work_plans" does not exist' } });
  sb.script('branches', 'select', { data: [{ id: BRANCH, is_primary: true }], error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  // AL.29: the queue reads the branch's task docs first; none here, so the rows are the open work.
  sb.script('graph_snapshots', 'select', { data: { graph_data: { artifacts: {} } }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: graph() }, error: null });
  scriptCatalogs(sb);
  scriptSpec(sb);
  sb.script('agent_checkouts', 'select', { data: [], error: null });
  sb.script('agent_checkouts', 'select', { data: [], error: null });
  const q = await handleGetWorkQueue(sb as never, READ_AUTH, { project_id: PROJECT.id });
  assertEquals(q.success, true, JSON.stringify(q).slice(0, 300));
  // AA.1: the queue reads readiness for buildOrder only, never the chain
  assertEquals(sb.callsTo('outcome_derivations').length + sb.callsTo('outcome_step_maps').length, 0, 'the queue never waits on the chain');
  // deno-lint-ignore no-explicit-any
  const data = q.data as any;
  assertEquals(data.totalOpen, 2);
  assertEquals(data.queue[0].taskItemId, TASK_B, 'the database before the API that calls it');
  assert(!UPSTREAM.test(String(data.message ?? '')), 'the queue names nothing above the requirements');

  const co = new FakeSupabase();
  co.script('projects', 'select', { data: PROJECT, error: null });
  co.script('task_items', 'select', { data: { id: TASK_A, done: false, orphaned: false }, error: null });
  co.script('rpc', 'agent_checkout_claim', { data: { claimed: true, checkoutId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', advisory: false }, error: null });
  const c = await handleCheckoutTask(co as never, WRITE_AUTH, { project_id: PROJECT.id, node_id: N_API, task_key: 'a3f19c02', external_agent: 'claude · bench' });
  assertEquals(c.success, true);
  assertEquals((c.data as { claimed: boolean }).claimed, true);
});

Deno.test('9.7: report_test_results proves a criterion with nothing above the requirements present', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1' }, error: null });
  sb.script('specification_requirements', 'select', { data: REQ, error: null });
  sb.script('test_cases', 'select', { data: [{ id: CASE1, test_id: 'TC-1', status: 'not_started' }], error: null });
  sb.script('rpc', 'apply_criteria_ops', { data: { found: true, applied: 1, changed: true }, error: null });
  sb.script('test_cases', 'update', { data: null, error: null });
  sb.script('rpc', 'apply_criteria_ops', {
    data: { found: true, applied: 1, changed: true, criteria: [{ text: 'GET /health returns 200', met: true, testId: CASE1, provenance: { source: 'test', testCaseId: CASE1, at: '2026-09-16T00:00:00.000Z' } }] },
    error: null,
  });
  const r = await handleReportTestResults(sb as never, WRITE_AUTH, {
    project_id: PROJECT.id, requirement_id: REQ_ROW,
    results: [{ test_id: 'TC-1', status: 'passed', criterion_text: 'GET /health returns 200' }],
  });
  assertEquals(r.success, true, JSON.stringify(r).slice(0, 300));
  assertEquals(sb.callsTo('requirement_candidates').length + sb.callsTo('workflows').length + sb.callsTo('couplings').length, 0, 'evidence never looks upstream');
});

// ── the reverse: upstream is derived, never written down ───────────────────

const meta = () => ({ id: crypto.randomUUID(), actorType: 'ai' as const, actorId: 'claude · bench', summary: 'bench patch', timestamp: new Date().toISOString() });
// deno-lint-ignore no-explicit-any
const specPatch = (type: string, payload: unknown): any => {
  const parsed = SpecPatchOperationSchema.safeParse({ type, metadata: meta(), payload });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};
const candidate = (status = 'pending') => ({
  id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null, key: 'outcome:ff66', kind: 'outcome',
  name: 'Tenants export their data', description: '', category: 'functional', criteria: [{ id: 'c1', text: 'A holds' }], status, requirement_row_id: REQ_ROW,
});

Deno.test('9.7 reverse: settling an outcome writes the candidate row only — no criterion, no task tick, no test verdict moves', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', { data: candidate(), error: null });
  sb.script('outcome_derivations', 'select', { data: [{ id: 'der-1' }], error: null });
  sb.script('requirement_candidates', 'update', { data: null, error: null });
  const r = await applySpecPatch(sb as never, WRITE_AUTH, PROJECT.id, specPatch('settle_candidate', { candidateId: CAND }));
  assertEquals(r.applied, true, JSON.stringify(r));
  for (const t of ['specification_requirements', 'task_items', 'test_cases', 'specification_mappings']) {
    assertEquals(sb.callsTo(t).length, 0, `${t} untouched by a settle`);
  }
  const written = sb.callsTo('requirement_candidates', 'update')[0].payload as Record<string, unknown>;
  assertEquals(written.status, 'accepted');
});

Deno.test('9.7 reverse: dismissing an outcome writes the candidate row only', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', { data: candidate(), error: null });
  sb.script('requirement_candidates', 'update', { data: null, error: null });
  const r = await applySpecPatch(sb as never, WRITE_AUTH, PROJECT.id, specPatch('dismiss_candidate', { candidateId: CAND }));
  assertEquals(r.applied, true, JSON.stringify(r));
  for (const t of ['specification_requirements', 'task_items', 'test_cases']) assertEquals(sb.callsTo(t).length, 0, t);
});

Deno.test('9.7 + AA.1: a node blocker is schema | owner | doc, by source; the chain lives in its own block; the skill says the plan decides', () => {
  const sources = read('../mcp-server/tools/tasks.ts') + read('../_shared/task-document-generator.ts');
  const kinds = new Set([...sources.matchAll(/blockers\.push\(\{\s*kind:\s*['"](\w+)['"]/g)].map((m) => m[1]));
  assertEquals([...kinds].sort(), ['doc', 'owner', 'schema']);
  const chain = read('../_shared/chain.ts');
  assert(chain.includes('export type ChainGapKind = "vision" | "off-vision" | "origin" | "no-step" | "unserved";'));
  const skill = read('../../../skills/nodespec-developer/SKILL.md');
  assert(!skill.includes('context when present, never\na precondition'), 'the 9.7 line is superseded');
  assert(skill.includes('The chain comes with the plan.'), 'the AA line');
  assert(skill.includes('Readiness reports the chain and nothing\nwaits on it'), 'nothing waits on it');
  assert(skill.includes("A node's own blockers are\nonly `schema`, `owner` and `doc`"), 'the node vocabulary');
});

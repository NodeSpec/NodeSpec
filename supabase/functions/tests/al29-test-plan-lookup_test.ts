// AL.29 (bench, 2026-10-09): get_test_plan read the requirement by row UUID
// alone, from any project, while report_test_results and the other
// requirement tools take REQ-xxx or the row UUID inside the project's own
// specification. An agent calling get_test_plan with REQ-003 got "Requirement
// not found"; one holding another project's requirement UUID got that
// requirement's plan. Over MemorySupabase, so the filters are applied.
import { handleGetTestPlan } from '../mcp-server/tools/context.ts';
import { applyPatches } from '../_shared/core-engine/patch-engine.ts';
import { createEmptyGraph } from '../_shared/core-engine/utils.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { planCases, STATEMENT_FORMAT, STATEMENTS_TO_REVIEW_HEADING } from '../_shared/test-document-generator.ts';
import { wrapField } from '../_shared/untrusted-data.ts';
import { MemorySupabase, assert, assertEquals } from './helpers.ts';

const OWNER = 'a2910000-0000-4000-8000-000000000003';
const P1 = 'a2910000-0000-4000-8000-000000000001';
const P2 = 'a2910000-0000-4000-8000-000000000011';
const B1 = 'a2910000-0000-4000-8000-000000000002';
const S1 = 'a2910000-0000-4000-8000-000000000004';
const S2 = 'a2910000-0000-4000-8000-000000000014';
const R1 = 'a2910000-0000-4000-8000-000000000005';
const R2 = 'a2910000-0000-4000-8000-000000000015';
const N1 = 'a2910000-0000-4000-8000-0000000000a1';
const T = '2026-10-09T00:00:00.000Z';
const KEY = { userId: OWNER, keyId: 'a2910000-0000-4000-8000-0000000000b1', authMethod: 'api_key', scopes: ['read', 'write', 'propose'] } as AuthResult;

function world() {
  const db = new MemorySupabase();
  const base = applyPatches(createEmptyGraph(), [
    { type: 'add_node', metadata: { id: crypto.randomUUID(), actorType: 'human', summary: 'add', timestamp: T }, payload: { id: N1, type: 'database', label: 'Orders DB', technology: 'postgresql' } },
  ] as never).graph!;
  db.table('projects', [
    { id: P1, name: 'Bakery', owner_id: OWNER, automation_policy: {}, metadata: {} },
    { id: P2, name: 'Florist', owner_id: OWNER, automation_policy: {}, metadata: {} },
  ]);
  db.table('branches', [{ id: B1, project_id: P1, name: 'main', is_primary: true }]);
  db.table('graph_snapshots', [{ id: crypto.randomUUID(), project_id: P1, branch_id: B1, graph_data: base, version: base.version, hash: base.hash, patch_sequence: 0, created_at: T }]);
  db.table('project_specifications', [
    { id: S1, project_id: P1, vision: 'Pickup orders', locked_nodes: [], preferences: {}, created_at: T },
    { id: S2, project_id: P2, vision: 'Flower delivery', locked_nodes: [], preferences: {}, created_at: T },
  ]);
  db.table('specification_requirements', [
    { id: R1, specification_id: S1, requirement_id: 'REQ-003', name: 'Back up tasks', description: 'The store is backed up', category: 'functional', status: 'pending', acceptance_criteria: [{ text: 'a nightly backup is taken' }] },
    { id: R2, specification_id: S2, requirement_id: 'REQ-003', name: 'Florist secret', description: 'Another project\'s requirement', category: 'functional', status: 'pending', acceptance_criteria: [{ text: 'FLORIST ONLY' }] },
  ]);
  db.table('specification_mappings', [{ id: crypto.randomUUID(), specification_id: S1, requirement_id: R1, node_id: N1, mapping_type: 'implements', created_at: T }]);
  for (const t of ['ai_proposals', 'ai_runs', 'graph_patches', 'test_cases', 'project_members', 'stripe_subscriptions',
    'node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) db.table(t, []);
  return db;
}

Deno.test('AL.29 get_test_plan: REQ-xxx and the row UUID both name the project\'s requirement', async () => {
  for (const ref of ['REQ-003', R1]) {
    const r = await handleGetTestPlan(world() as never, KEY, { project_id: P1, requirement_id: ref });
    assertEquals(r.success, true, `${ref}: ${JSON.stringify(r).slice(0, 300)}`);
    const d = r.data as { requirementId: string; requirementName: string; testPlanContent: string };
    assertEquals([d.requirementId, d.requirementName], ['REQ-003', 'Back up tasks'], ref);
    assert(d.testPlanContent.includes('a nightly backup is taken'), ref);
  }
});

Deno.test('AL.29 get_test_plan: another project\'s requirement UUID is not found here, and nothing is filed for it', async () => {
  const db = world();
  const r = await handleGetTestPlan(db as never, KEY, { project_id: P1, requirement_id: R2 });
  assertEquals(r.success, false);
  assert(String(r.error).includes('not found in this project'), String(r.error));
  assert(!JSON.stringify(r).includes('FLORIST ONLY'), 'nothing of it is served');
  assertEquals(db.rowsOf('ai_proposals').length, 0, 'no plan is filed for it');
});

// AL.29 phase 3.3: the response says which test cases still have no statements,
// names the plan to write them into, and gives the line format.
Deno.test('AL.29 get_test_plan: the response names the cases with no statements and the plan to write them into', async () => {
  const db = world();
  const first = await handleGetTestPlan(db as never, KEY, { project_id: P1, requirement_id: 'REQ-003' });
  assert(first.success, JSON.stringify(first).slice(0, 300));
  // deno-lint-ignore no-explicit-any
  let d = first.data as any;
  const add = (db.rowsOf('ai_proposals')[0].patches as Array<{ patch: { type: string; payload: { id: string; content: string; metadata: unknown } } }>)
    .find((p) => p.patch.type === 'add_artifact')!.patch.payload;
  assertEquals(d.testPlanArtifactId, add.id, 'the new plan, by the id its proposal adds');
  assertEquals(d.testCasesWithoutStatements, [{ id: 'AC-REQ-003-1', lane: 'automated', criterion: wrapField('a nightly backup is taken') }]);
  assertEquals(d.statementFormat, STATEMENT_FORMAT);
  assertEquals(d.statementsToReview, undefined);

  // The proposal is accepted: the stored plan, served as it is, still asks for the statement.
  const snap = db.rowsOf('graph_snapshots')[0] as { graph_data: unknown };
  const before = snap.graph_data;
  const accept = (content: string) => {
    snap.graph_data = applyPatches(before as never, [{
      type: 'add_artifact', metadata: { id: crypto.randomUUID(), actorType: 'ai', summary: 'accepted', timestamp: T },
      payload: { ...add, content, nodeId: N1, kind: 'test-plan', path: '.nodespec/tests/req-003.tests.md', language: 'markdown', status: 'draft', createdAt: T, updatedAt: T },
    }] as never).graph!;
  };
  accept(add.content);
  d = (await handleGetTestPlan(db as never, KEY, { project_id: P1, requirement_id: 'REQ-003' })).data;
  assertEquals([d.testPlanIsNew, d.testPlanRefreshed, d.testPlanArtifactId], [false, undefined, add.id]);
  assertEquals(d.testCasesWithoutStatements?.map((c: { id: string }) => c.id), ['AC-REQ-003-1']);

  // An agent writes the statement under the case.
  const lines = add.content.split('\n');
  lines.splice(lines.findIndex((l) => l.startsWith('#### AC-REQ-003-1:')) + 2, 0, '- [ ] Given the job ran, when the bucket is listed, then a dump dated today is present');
  accept(lines.join('\n'));
  d = (await handleGetTestPlan(db as never, KEY, { project_id: P1, requirement_id: 'REQ-003' })).data;
  assertEquals([d.testPlanIsNew, d.testPlanRefreshed], [false, undefined], 'the stored plan is served as it is');
  assertEquals(d.testPlanArtifactId, add.id);
  // 3.2: the parsed cases equal the file, the agent's text in the envelope.
  assertEquals(d.testCases, planCases(lines.join('\n')).cases.map((c) => ({ id: c.id, lane: c.lane, criterion: wrapField(c.criterion!), testId: c.testId, statements: c.statements.map((t) => wrapField(t)) })));
  assertEquals(d.testCases.map((c: { testId: string; statements: string[] }) => [c.testId, c.statements.length]), [['TC-REQ-003-1', 1]]);
  assertEquals([d.testCasesWithoutStatements, d.statementFormat], [undefined, undefined], 'nothing is asked');

  // Statements kept for review from a reworded criterion are counted, with the format.
  const review = lines.slice();
  review.splice(review.findIndex((l) => l.startsWith('## ') && l !== '## Automated Test Scenarios' && review.indexOf(l) > review.indexOf('## Automated Test Scenarios')), 0,
    STATEMENTS_TO_REVIEW_HEADING, '', 'Kept from a criterion that was reworded or removed. Move each under its test case, or delete it.', '',
    'Written for: "a weekly backup is taken"', '- [ ] Given a week passed, when the bucket is listed, then a weekly dump is present', '');
  accept(review.join('\n'));
  d = (await handleGetTestPlan(db as never, KEY, { project_id: P1, requirement_id: 'REQ-003' })).data;
  assertEquals([d.testCasesWithoutStatements, d.statementsToReview, d.statementFormat], [undefined, 1, STATEMENT_FORMAT]);
});

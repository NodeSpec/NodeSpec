// AL.29 phase 5.1 (owner 2026-10-10): get_build_readiness counts what the task
// docs and test plans still ask of an agent: work orders with no step, test
// cases with no statement, lines kept for review, and stored plans out of date.
// The docs are in the generator's format and the plans are the real generator's
// output, stamped as get_test_plan stamps them; a statement moves to review by a
// real reword, and a plan goes out of date because its criterion changed after
// it was stored. The counts are project rows; no node's readiness moves.
import { handleGetBuildReadiness } from '../mcp-server/tools/tasks.ts';
import { ensureTestDocumentForRequirement } from '../_shared/mcp-context-assembly.ts';
import { loadCatalogs } from '../_shared/catalog-loader.ts';
import { MemorySupabase, assert, assertEquals, completeRole, type Row } from './helpers.ts';
// deno-lint-ignore no-explicit-any
type Any = any;

const OWNER = 'user-owner';
const AUTH: Any = { userId: OWNER, authMethod: 'api_key', keyId: 'k1', scopes: ['read'] };
const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Readiness Counts', owner_id: OWNER };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N_API = '33333333-3333-4333-8333-333333333331';
const N_DB = '33333333-3333-4333-8333-333333333332';
const row = (n: number) => `77777777-7777-4777-8777-77777777777${n}`;

// A work order exactly as the generator writes it (task-deltas TASK_LINE).
const line = (box: ' ' | 'x', id: string, title: string, key: string) => `- [${box}] **${id} \u2014 ${title}** <!-- t:${key} -->`;
const doc = (lines: string[]) => ['# Task: node', '', '## Implementation Tasks', '', ...lines, '', '## Implementation Context', '', '_Not yet authored._', ''].join('\n');
const API_DOC = doc([
  line(' ', 'T1', 'Expose the orders route', 'aaaa0001'),
  '  - [ ] Add GET /orders in src/routes/orders.ts',
  line(' ', 'T2', 'Validate the order body', 'aaaa0002'),
  line('x', 'T3', 'Wire the health check', 'aaaa0003'),
  '',
  '### Steps to review',
  '',
  'Kept from a work order that was reworded or removed. Move each under a work order above, or delete it.',
  '',
  'Written for T4: Retry failed writes',
  '  - [ ] Wrap the insert in a retry in src/db/orders.ts',
]);
const DB_DOC = doc([
  line(' ', 'T1', 'Create the orders table', 'bbbb0001'),
  line(' ', 'T2', 'Index the customer column', 'bbbb0002'),
]);
const FILLED = (d: string) => d.split('\n').flatMap((l) => (/<!-- t:/.test(l) && l.startsWith('- [ ]') ? [l, '  - [ ] One step'] : [l])).join('\n').split('\n### Steps to review')[0];

const req = (n: number, id: string, name: string, criteria: string[]) => ({
  id: row(n), requirement_id: id, name, description: `${name}.`, category: 'functional', status: 'in-progress',
  acceptance_criteria: criteria.map((text) => ({ text, met: false })),
});
const ctx = (r: ReturnType<typeof req>) => ({
  requirementId: r.requirement_id, name: r.name, description: r.description, category: r.category, status: r.status,
  acceptanceCriteria: r.acceptance_criteria, rowId: r.id,
});
// A statement under a test case's derive line, as an agent writes it.
const withStatement = (plan: string, acId: string, statement: string) => {
  const lines = plan.split('\n');
  const at = lines.findIndex((l) => l.startsWith(`#### ${acId}:`));
  assert(at >= 0, `the plan has a heading for ${acId}`);
  lines.splice(at + 2, 0, `- [ ] ${statement}`);
  return lines.join('\n');
};

function graph(artifacts: Record<string, Any> = {}): Any {
  return {
    nodes: {
      [N_API]: { id: N_API, type: 'backend-service', label: 'Orders API', ports: [] },
      [N_DB]: { id: N_DB, type: 'backend-service', label: 'Orders DB', ports: [] },
    },
    edges: {}, contracts: {}, artifacts,
  };
}

function world(requirements: Row[], artifacts: Record<string, Any>): MemorySupabase {
  const sb = new MemorySupabase();
  sb.table('projects', [{ ...PROJECT }]);
  sb.table('project_members', []);
  sb.table('branches', [{ id: BRANCH, project_id: PROJECT.id, name: 'main', is_primary: true }]);
  sb.table('graph_snapshots', [{ id: 'snap-1', branch_id: BRANCH, project_id: PROJECT.id, patch_sequence: 3, created_at: '2026-10-10T00:00:00Z', graph_data: graph(artifacts) }]);
  sb.table('node_roles', [{ id: 'backend-service', kind: 'app_service', is_container: false, treatment_mode: 'leaf' }].map(completeRole));
  for (const t of ['technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes', 'test_cases', 'requirement_candidates', 'stripe_subscriptions', 'artifacts']) sb.table(t, []);
  sb.table('project_specifications', [{ id: 'spec-1', project_id: PROJECT.id, vision: null, created_at: '2026-10-01T00:00:00Z' }]);
  sb.table('specification_requirements', requirements.map((r) => ({ ...r, specification_id: 'spec-1' })));
  sb.table('specification_mappings', [
    { specification_id: 'spec-1', requirement_id: row(1), node_id: N_API },
    { specification_id: 'spec-1', requirement_id: row(1), node_id: N_DB },
    { specification_id: 'spec-1', requirement_id: row(2), node_id: N_DB },
    { specification_id: 'spec-1', requirement_id: row(3), node_id: N_API },
    { specification_id: 'spec-1', requirement_id: row(4), node_id: N_API },
    { specification_id: 'spec-1', requirement_id: row(5), node_id: N_API },
  ]);
  return sb;
}

const NODES_OF: Record<string, string[]> = { 'REQ-001': [N_API, N_DB], 'REQ-002': [N_DB], 'REQ-003': [N_API], 'REQ-004': [N_API] };

/** A plan as get_test_plan stores it: the generator's document and its fingerprint. */
async function storedPlan(sb: MemorySupabase, r: ReturnType<typeof req>, artifacts: Record<string, Any>, edit: (plan: string) => string, id: string) {
  const catalogs = await loadCatalogs(sb as never, { projectIds: [PROJECT.id] });
  const made = ensureTestDocumentForRequirement(graph(artifacts), catalogs, ctx(r), NODES_OF[r.requirement_id]);
  assert(made.rawContent, `a plan for ${r.requirement_id}`);
  return { id, nodeId: NODES_OF[r.requirement_id][0], kind: 'test-plan', path: made.path ?? `.nodespec/tests/${r.requirement_id.toLowerCase()}.tests.md`, content: edit(made.rawContent!), metadata: { testContextFingerprint: made.fingerprint, requirementId: r.requirement_id } };
}

async function fixture() {
  const r1 = req(1, 'REQ-001', 'Orders persist', ['orders persist across restarts', 'orders list in under 200ms', 'a deleted order is gone']);
  const r2before = req(2, 'REQ-002', 'Totals', ['totals add up']);
  const r2 = req(2, 'REQ-002', 'Totals', ['totals add up to the cent']);
  const r3before = req(3, 'REQ-003', 'Export', ['exports a CSV']);
  const r3 = req(3, 'REQ-003', 'Export', ['exports a CSV with headers']);
  const r4 = req(4, 'REQ-004', 'Audit', ['every write is logged']);
  const r5 = req(5, 'REQ-005', 'Archive', ['old orders are archived']);
  const docs = {
    'doc-api': { id: 'doc-api', kind: 'task', nodeId: N_API, path: '.nodespec/tasks/orders-api.task.md', content: API_DOC },
    'doc-db': { id: 'doc-db', kind: 'task', nodeId: N_DB, path: '.nodespec/tasks/orders-db.task.md', content: DB_DOC },
  };
  const sb = world([r1, r2, r3, r4, r5], docs);
  // REQ-001: current; a statement under the first case, none under the other two.
  const p1 = await storedPlan(sb, r1, docs, (p) => withStatement(p, 'AC-REQ-001-1', 'Given a saved order, when the API restarts, then GET /orders returns it'), 'plan-1');
  // REQ-002: its criterion was reworded after the agent wrote a statement, and the
  // refresh was accepted: the statement waits for review, the reworded case has none.
  const old2 = await storedPlan(sb, r2before, docs, (p) => withStatement(p, 'AC-REQ-002-1', 'Given two lines, when totalled, then the sum is exact'), 'plan-2');
  const catalogs = await loadCatalogs(sb as never, { projectIds: [PROJECT.id] });
  const refreshed = ensureTestDocumentForRequirement(graph({ ...docs, 'plan-2': old2 }), catalogs, ctx(r2), NODES_OF['REQ-002']);
  assert(refreshed.refreshed && refreshed.rawContent?.includes('#### Statements to review'), 'the reword moved the statement to review');
  const p2 = { ...old2, content: refreshed.rawContent!, metadata: { ...old2.metadata, testContextFingerprint: refreshed.fingerprint } };
  // REQ-003: stored, then its criterion changed: out of date (its stored statement still counts as written).
  const p3 = await storedPlan(sb, r3before, docs, (p) => withStatement(p, 'AC-REQ-003-1', 'Given orders, when exported, then the file is a CSV'), 'plan-3');
  // REQ-004: stored before plans carried a fingerprint; served as current, as get_test_plan serves it.
  const legacy = await storedPlan(sb, r4, docs, (p) => withStatement(p, 'AC-REQ-004-1', 'Given a write, when it lands, then the log has it'), 'plan-4');
  const p4 = { ...legacy, metadata: { requirementId: 'REQ-004' } };
  // REQ-005 has no plan yet: nothing to count.
  sb.rowsOf('graph_snapshots')[0].graph_data = graph({ ...docs, 'plan-1': p1, 'plan-2': p2, 'plan-3': p3, 'plan-4': p4 });
  return sb;
}

// deno-lint-ignore no-explicit-any
const read = async (sb: MemorySupabase, args: Record<string, unknown> = {}): Promise<any> => {
  const r = await handleGetBuildReadiness(sb as never, AUTH, { project_id: PROJECT.id, detail: 'full', ...args });
  assertEquals(r.success, true, JSON.stringify(r).slice(0, 400));
  return r.data;
};
const rows = (d: Any) => Object.fromEntries((d.projectAdvisories as Any[]).map((a) => [a.kind, a]));

Deno.test('AL.29 5.1: readiness counts the steps, statements and review lines still to write, and the stored plans out of date', async () => {
  const sb = await fixture();
  const d = await read(sb);
  const by = rows(d);
  assertEquals(Object.keys(by).sort(), ['review', 'statements', 'steps', 'test-plans']);
  // T2 in the API doc, both work orders in the DB doc; a ticked work order is done.
  assertEquals([by.steps.count, by.steps.detail], [3, '3 work orders have no step under them (task documents of Orders API, Orders DB)']);
  // REQ-001's last two cases and REQ-002's reworded case; REQ-001 counts once though two nodes carry it.
  assertEquals([by.statements.count, by.statements.detail], [3, '3 test cases have no statement under them (test plans of REQ-001, REQ-002)']);
  // One step in the API doc's review block, one statement in REQ-002's.
  assertEquals([by.review.count, by.review.detail], [2, '2 steps or statements wait for review, kept from a work order or criterion that was reworded or removed (Orders API, REQ-002)']);
  assertEquals([by['test-plans'].count, by['test-plans'].detail], [1, '1 stored test plan is out of date (REQ-003)']);
  for (const k of ['steps', 'statements', 'review', 'test-plans']) assert(String(d.remediations[k] ?? '').length > 0, `a remediation for ${k}`);
  assert(d.remediations.steps.includes('stepFormat') && d.remediations.statements.includes('statementFormat'), 'each points at the format its tool returns');
  // Counted, never blocking: no node's ready or gaps carry them.
  for (const n of d.nodes as Any[]) {
    for (const g of [...n.blockers, ...n.advisories]) assert(!['steps', 'statements', 'review', 'test-plans'].includes(g.kind), `${n.label}: ${g.kind}`);
  }
});

Deno.test('AL.29 5.1: a node filter counts that node\'s doc and the plans of its requirements; a project with nothing left to write shows no row', async () => {
  const sb = await fixture();
  const by = rows(await read(sb, { node_ids: [N_DB] }));
  assertEquals([by.steps?.count, by.statements?.count, by.review?.count, by['test-plans']], [2, 3, 1, undefined]);

  // Every work order with a step, every case with a statement, no review block, the
  // out-of-date plan refreshed: no row and no remediation for any of them.
  const snap = sb.rowsOf('graph_snapshots')[0].graph_data as Any;
  snap.artifacts['doc-api'].content = FILLED(API_DOC);
  snap.artifacts['doc-db'].content = FILLED(DB_DOC);
  const catalogs = await loadCatalogs(sb as never, { projectIds: [PROJECT.id] });
  for (const [id, n] of [['plan-1', 1], ['plan-2', 2], ['plan-3', 3]] as const) {
    const r = (sb.rowsOf('specification_requirements') as Any[]).find((x) => x.id === row(n));
    const fresh = ensureTestDocumentForRequirement({ ...snap, artifacts: {} }, catalogs, ctx(r), NODES_OF[r.requirement_id]);
    const content = fresh.rawContent!.split('\n').flatMap((l: string) => (/^#### AC-/.test(l) ? [l] : /^Derive the test from/.test(l) ? [l, '- [ ] Given it, when run, then it holds'] : [l])).join('\n');
    snap.artifacts[id] = { ...snap.artifacts[id], content, metadata: { ...snap.artifacts[id].metadata, testContextFingerprint: fresh.fingerprint } };
  }
  const d = await read(sb);
  assertEquals(d.projectAdvisories, []);
  for (const k of ['steps', 'statements', 'review', 'test-plans']) assert(!(k in d.remediations), `no ${k} remediation`);
});

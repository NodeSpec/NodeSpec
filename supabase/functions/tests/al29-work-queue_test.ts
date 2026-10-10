// AL.29 (gap 3): the queue lists the work orders the task docs list, and a
// claim by node and key records the row the first tick used to be the only
// writer of. Production had 0 task_items rows on a project whose docs held 62
// work orders, so get_work_queue offered nothing and checkout_task by key
// refused every one. These run over MemorySupabase, whose rows remember, so
// the claim's row, the queue after it and the refusals are read back, not
// scripted.
import { handleCheckoutTask, handleGetWorkQueue, openWorkOrders, type DocWorkOrder, type TaskStateRow } from '../mcp-server/tools/checkouts.ts';
import { STEP_FORMAT } from '../_shared/task-deltas.ts';
import { MemorySupabase, assert, assertEquals, completeRole, type Row } from './helpers.ts';

const OWNER = 'user-owner';
const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Queue From Docs', owner_id: OWNER };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N_API = '33333333-3333-4333-8333-333333333331';
const N_DB = '33333333-3333-4333-8333-333333333332';
const AUTH = { userId: OWNER, authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] } as never;

// A work-order line exactly as the generator writes it (task-deltas TASK_LINE).
const line = (box: ' ' | 'x', id: string, title: string, key: string) => `- [${box}] **${id} \u2014 ${title}** <!-- t:${key} -->`;
const doc = (lines: string[]) => ['# Task: node', '', '## Implementation Tasks', '', ...lines, '', '## Implementation Context', '', '_Not yet authored._', ''].join('\n');

const API_DOC = doc([
  line(' ', 'T1', 'Expose the orders route', 'aaaa0001'),
  line(' ', 'T2', 'Validate the order body', 'aaaa0002'),
  '  - [ ] Parse the body with the order schema in src/orders/body.ts',
  line('x', 'T3', 'Wire the health check', 'aaaa0003'),
  line(' ', 'T10', 'Document the route', 'aaaa0010'),
]);
const DB_DOC = doc([
  line(' ', 'T1', 'Create the orders table', 'bbbb0001'),
  line(' ', 'T2', 'Index the customer column', 'bbbb0002'),
  '  - [ ] Add an index on orders.customer_id in supabase/migrations',
  '',
  '### Steps to review',
  '',
  'Kept from a work order that was reworded or removed. Move each under a work order above, or delete it.',
  '',
  'Written for T3: Seed the orders table',
  '  - [ ] Insert three orders in supabase/seed.sql',
]);

function world(taskRows: Row[] = [], docs = { api: API_DOC, db: DB_DOC }): MemorySupabase {
  const sb = new MemorySupabase();
  sb.table('projects', [{ ...PROJECT }]);
  sb.table('project_members', []);
  sb.table('branches', [{ id: BRANCH, project_id: PROJECT.id, name: 'main', is_primary: true }]);
  sb.table('graph_snapshots', [{
    id: 'snap-1', branch_id: BRANCH, project_id: PROJECT.id, patch_sequence: 7, created_at: '2026-10-09T00:00:00Z',
    graph_data: {
      nodes: {
        [N_API]: { id: N_API, type: 'backend-service', label: 'Orders API' },
        [N_DB]: { id: N_DB, type: 'database', label: 'Orders DB' },
      },
      edges: {}, contracts: {},
      artifacts: {
        'doc-api': { id: 'doc-api', kind: 'task', nodeId: N_API, path: '.nodespec/tasks/orders-api.task.md', content: docs.api },
        'doc-db': { id: 'doc-db', kind: 'task', nodeId: N_DB, path: '.nodespec/tasks/orders-db.task.md', content: docs.db },
      },
    },
  }]);
  sb.table('task_items', taskRows);
  sb.unique('task_items', ['project_id', 'node_id', 'task_key'], { name: 'task_items_project_id_node_id_task_key_key' });
  sb.table('agent_checkouts', []);
  sb.table('work_plans', []);
  sb.table('work_plan_items', []);
  sb.table('artifacts', []);
  sb.table('stripe_subscriptions', []);
  sb.table('specification_requirements', []);
  sb.table('requirement_candidates', []);
  // What readiness reads for the build order the queue falls back to.
  sb.table('node_roles', [
    { id: 'backend-service', kind: 'app_service', is_container: false, treatment_mode: 'leaf' },
    { id: 'database', kind: 'data_store', is_container: false, treatment_mode: 'leaf' },
  ].map(completeRole));
  for (const t of ['technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes', 'project_specifications', 'specification_mappings']) sb.table(t, []);
  sb.fn('agent_checkout_claim', (p, db) => {
    const id = crypto.randomUUID();
    db.rowsOf('agent_checkouts').push({ id, project_id: p.p_project_id, level: p.p_level, task_item_id: p.p_ref_id, holder_label: p.p_holder_label, since: new Date().toISOString(), heartbeat_at: new Date().toISOString(), released_at: null, meta: {} });
    return { claimed: true, checkoutId: id, advisory: false };
  });
  return sb;
}

// deno-lint-ignore no-explicit-any
const queueOf = async (sb: MemorySupabase): Promise<any> => {
  const r = await handleGetWorkQueue(sb as never, AUTH, { project_id: PROJECT.id, limit: 50 });
  assertEquals(r.success, true, JSON.stringify(r).slice(0, 300));
  return r.data;
};

Deno.test('AL.29 openWorkOrders: the docs say what exists, a row says done, orphaned and the mark, the doc box decides when there is no row', () => {
  const order = (nodeId: string, key: string, docIndex: number, checked = false): DocWorkOrder => ({ nodeId, key, displayId: `T${docIndex + 1}`, title: `work ${key}`, checked, docIndex, withoutSteps: false });
  const orders = [order('n1', 'k1', 0), order('n1', 'k2', 1), order('n1', 'k3', 2, true), order('n1', 'k4', 3), order('n1', 'k5', 4, true), order('n1', 'k6', 5)];
  const rows: TaskStateRow[] = [
    { id: 'r2', node_id: 'n1', task_key: 'k2', display_id: 'T2', title: 'old title', done: true, orphaned: false },
    { id: 'r4', node_id: 'n1', task_key: 'k4', display_id: 'T4', title: 'old title', done: false, orphaned: false, mark: 'CUI' },
    { id: 'r5', node_id: 'n1', task_key: 'k5', display_id: 'T5', title: 'old title', done: false, orphaned: false },
    { id: 'r6', node_id: 'n1', task_key: 'k6', display_id: 'T6', title: 'old title', done: false, orphaned: true },
    { id: 'r7', node_id: 'n2', task_key: 'k7', display_id: 'T1', title: 'row only', done: false, orphaned: false },
    { id: 'r8', node_id: 'n2', task_key: 'k8', display_id: 'T2', title: 'row only, done', done: true, orphaned: false },
  ];
  const open = openWorkOrders(rows, orders);
  assertEquals(open.map((o) => o.taskKey), ['k1', 'k4', 'k5', 'k7']);
  const byKey = Object.fromEntries(open.map((o) => [o.taskKey, o]));
  assertEquals(byKey.k1.taskItemId, null, 'a work order nobody has ticked or claimed has no row');
  assertEquals(byKey.k1.title, 'work k1', 'the title is the doc\'s');
  assertEquals(byKey.k4.taskItemId, 'r4');
  assertEquals(byKey.k4.mark, 'CUI', 'the row\'s mark travels with the entry, so the boundary can withhold it');
  assertEquals(byKey.k4.title, 'work k4', 'a row\'s display snapshot never overrides the doc');
  assertEquals(byKey.k5.taskItemId, 'r5', 'a row decides over the doc box (the Plan board\'s rule)');
  assertEquals(byKey.k7.docIndex, Number.MAX_SAFE_INTEGER, 'a row no doc lists stays open work, after the doc\'s own');
});

Deno.test('AL.29 get_work_queue: fresh work orders are offered from the docs, in doc order, done ones are not, and the claim by key that follows records the row', async () => {
  const sb = world([
    { id: 'row-db-1', project_id: PROJECT.id, node_id: N_DB, task_key: 'bbbb0001', display_id: 'T1', title: 'Create the orders table', done: true, orphaned: false, provenance: { source: 'ui' }, mark: null },
  ]);
  const q = await queueOf(sb);
  // deno-lint-ignore no-explicit-any
  const keys = q.queue.map((e: any) => e.taskKey);
  assertEquals(new Set(keys), new Set(['aaaa0001', 'aaaa0002', 'aaaa0010', 'bbbb0002']), `offered: ${keys}`);
  assertEquals(q.totalOpen, 4);
  // deno-lint-ignore no-explicit-any
  const api = q.queue.filter((e: any) => e.nodeId === N_API).map((e: any) => e.displayId);
  assertEquals(api, ['T1', 'T2', 'T10'], 'within a node the doc order holds (T10 after T2)');
  // deno-lint-ignore no-explicit-any
  const fresh = q.queue.find((e: any) => e.taskKey === 'aaaa0001');
  assertEquals(fresh.taskItemId, null);
  assertEquals(fresh.title, 'Expose the orders route');
  assert(String(q.message).includes('node_id + task_key'), 'the message says how to claim an entry with no row');

  // The claim an agent makes from that entry: by node and key.
  const c = await handleCheckoutTask(sb as never, AUTH, { project_id: PROJECT.id, node_id: N_API, task_key: 'aaaa0001', external_agent: 'agent a' });
  assertEquals(c.success, true, JSON.stringify(c));
  // deno-lint-ignore no-explicit-any
  const claim = c.data as any;
  assertEquals(claim.claimed, true);
  const row = sb.rowsOf('task_items').find((r) => r.node_id === N_API && r.task_key === 'aaaa0001')!;
  assert(!!row, 'the claim recorded the row');
  assertEquals(claim.refId, row.id, 'the lease is on that row');
  assertEquals([row.done, row.orphaned, row.display_id, row.title], [false, false, 'T1', 'Expose the orders route']);
  assertEquals(row.provenance, {}, 'a claim is not evidence: no provenance');

  const q2 = await queueOf(sb);
  // deno-lint-ignore no-explicit-any
  const held = q2.queue.find((e: any) => e.taskKey === 'aaaa0001');
  assertEquals(held.taskItemId, row.id, 'the queue now names the row');
  assertEquals(held.heldBy, 'agent a', 'and who holds it');
  assertEquals(q2.totalOpen, 4, 'claiming is not finishing');
});

Deno.test('AL.29 checkout_task: done, orphaned, ticked and unknown work orders are refused, and nothing is recorded for them', async () => {
  const sb = world([
    { id: 'row-done', project_id: PROJECT.id, node_id: N_DB, task_key: 'bbbb0001', display_id: 'T1', title: 'Create the orders table', done: true, orphaned: false, provenance: { source: 'ui' } },
    { id: 'row-orphan', project_id: PROJECT.id, node_id: N_API, task_key: 'aaaa9999', display_id: 'T9', title: 'Gone from the doc', done: false, orphaned: true, provenance: {} },
  ]);
  const before = sb.rowsOf('task_items').length;
  const tries = [
    { args: { node_id: N_DB, task_key: 'bbbb0001' }, says: 'done' },
    { args: { task_item_id: 'row-done' }, says: 'done' },
    { args: { task_item_id: 'row-orphan' }, says: 'orphaned' },
    { args: { node_id: N_API, task_key: 'aaaa0003' }, says: 'ticked done in its task document' },
    { args: { node_id: N_API, task_key: 'ffff0000' }, says: 'get_work_queue' },
  ];
  for (const t of tries) {
    const r = await handleCheckoutTask(sb as never, AUTH, { project_id: PROJECT.id, ...t.args });
    assertEquals(r.success, false, `${JSON.stringify(t.args)} must be refused`);
    assert(String(r.error).includes(t.says), `${JSON.stringify(t.args)}: ${r.error}`);
  }
  assertEquals(sb.rowsOf('task_items').length, before, 'a refused claim records no row');
  assertEquals(sb.callsTo('rpc', 'agent_checkout_claim').length, 0, 'and takes no lease');
});

// A tick that lands between the claim's lookup and its insert: the claim keeps
// the tick's row (ON CONFLICT DO NOTHING) and refuses, instead of writing the
// work order back to open.
class TickLandsFirst extends MemorySupabase {
  from(table: string) {
    const q = super.from(table);
    if (table !== 'task_items') return q;
    return {
      ...q,
      upsert: (payload: unknown, opts?: unknown) => {
        const p = payload as Row;
        this.rowsOf('task_items').push({ id: 'row-ticked', project_id: p.project_id, node_id: p.node_id, task_key: p.task_key, display_id: p.display_id, title: p.title, done: true, orphaned: false, provenance: { source: 'git' } });
        return q.upsert(payload, opts);
      },
    };
  }
}

Deno.test('AL.29 checkout_task: a tick that lands while the claim records the row wins, and the claim is refused', async () => {
  const base = world();
  const sb = new TickLandsFirst();
  for (const t of ['projects', 'project_members', 'branches', 'graph_snapshots', 'task_items', 'agent_checkouts', 'artifacts']) sb.table(t, base.rowsOf(t));
  sb.fn('agent_checkout_claim', () => ({ claimed: true, checkoutId: 'x', advisory: false }));
  const r = await handleCheckoutTask(sb as never, AUTH, { project_id: PROJECT.id, node_id: N_API, task_key: 'aaaa0002' });
  assertEquals(r.success, false, JSON.stringify(r));
  assert(String(r.error).includes('done'), String(r.error));
  const rows = sb.rowsOf('task_items').filter((x) => x.task_key === 'aaaa0002');
  assertEquals(rows.length, 1);
  assertEquals([rows[0].id, rows[0].done], ['row-ticked', true], 'the tick\'s row is kept as it was');
  assertEquals(sb.callsTo('rpc', 'agent_checkout_claim').length, 0);
});

Deno.test('AL.29 get_work_queue and checkout_task: a work order with no step and a doc with steps to review are named, with the format', async () => {
  const sb = world([
    { id: 'row-db-2', project_id: PROJECT.id, node_id: N_DB, task_key: 'bbbb0002', display_id: 'T2', title: 'Index the customer column', done: false, orphaned: false, provenance: {}, mark: null },
  ]);
  const q = await queueOf(sb);
  // deno-lint-ignore no-explicit-any
  const flagged = Object.fromEntries(q.queue.map((e: any) => [e.taskKey, e.withoutSteps === true]));
  assertEquals(flagged, { aaaa0001: true, aaaa0002: false, aaaa0010: true, bbbb0001: true, bbbb0002: false }, 'each T2 has a step; the rest have none');
  assertEquals(q.stepsToReview, [{ nodeId: N_DB, artifactId: 'doc-db', path: '.nodespec/tasks/orders-db.task.md', steps: 1 }]);
  assertEquals(q.stepFormat, STEP_FORMAT);

  // deno-lint-ignore no-explicit-any
  const claim = async (args: Record<string, unknown>): Promise<any> => {
    const r = await handleCheckoutTask(sb as never, AUTH, { project_id: PROJECT.id, ...args });
    assertEquals(r.success, true, JSON.stringify(r));
    return r.data;
  };
  const withStep = await claim({ node_id: N_API, task_key: 'aaaa0002' });
  assertEquals([withStep.withoutSteps, withStep.stepsToReview, withStep.stepFormat], [undefined, undefined, undefined], 'a work order with a step in a doc with nothing to review asks for nothing');
  const empty = await claim({ node_id: N_API, task_key: 'aaaa0001' });
  assertEquals([empty.withoutSteps, empty.stepsToReview, empty.stepFormat], [true, undefined, STEP_FORMAT]);
  const byRow = await claim({ task_item_id: 'row-db-2' });
  assertEquals([byRow.withoutSteps, byRow.stepsToReview, byRow.stepFormat], [undefined, q.stepsToReview, STEP_FORMAT], 'a claim by row reads the doc too, and its review block asks with the format');
});

Deno.test('AL.29 get_work_queue: a queue whose work orders all have steps, and no doc with steps to review, carries no format', async () => {
  const stepped = (d: string) => d.split('\n').flatMap((l) => (/<!-- t:/.test(l) ? [l, '  - [ ] One step'] : [l])).join('\n');
  const q = await queueOf(world([], { api: stepped(API_DOC), db: stepped(DB_DOC.split('\n### Steps to review')[0]) }));
  assertEquals(q.totalOpen, 5);
  // deno-lint-ignore no-explicit-any
  assertEquals(q.queue.filter((e: any) => 'withoutSteps' in e).length, 0);
  assertEquals([q.stepsToReview, q.stepFormat], [undefined, undefined]);
  const emptyOnly = await queueOf(world([], { api: API_DOC, db: stepped(DB_DOC.split('\n### Steps to review')[0]) }));
  assertEquals([emptyOnly.stepsToReview, emptyOnly.stepFormat], [undefined, STEP_FORMAT], 'a work order with no step asks with the format on its own');
});

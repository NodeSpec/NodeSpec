// AL.28 (owner 2026-10-08): "this was partially a collision scenario I wanted
// extensively tested in bigger multi-agent work in a single project, but was
// created by this simple workflow." get_test_plan's proposal could never
// apply under Auto (33 set aside in production), and nothing exercised it:
// the bench wrote the accepted end state itself.
//
// These run the real tools agents call (get_test_plan, generate_task_docs)
// for several agents at once against one project held in memory, then the
// server's own Auto apply, the way production runs it with the app closed.
// What they hold to: every proposal applies exactly once, every node links
// each of its files exactly once, nothing links a file that is not there, and
// the branch log replays to the snapshot the server wrote.
import { handleGetTestPlan } from '../mcp-server/tools/context.ts';
import { handleGenerateTaskDocs } from '../mcp-server/tools/tasks.ts';
import { acceptCanvasBatch, type CanvasAcceptDeps } from '../mcp-server/tools/canvas-accept.ts';
import { sweepAuto } from '../mcp-server/tools/auto-apply.ts';
import { applyPatches, validateGraph } from '../_shared/core-engine/patch-engine.ts';
import { createEmptyGraph } from '../_shared/core-engine/utils.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { MemorySupabase, migrationColumns, assert, assertEquals, type Row } from './helpers.ts';

const P = 'a2800000-0000-4000-8000-000000000001';
const B = 'a2800000-0000-4000-8000-000000000002';
const OWNER = 'a2800000-0000-4000-8000-000000000003';
const SPEC = 'a2800000-0000-4000-8000-000000000004';
const WEB = 'a2800000-0000-4000-8000-0000000000a1';
const API = 'a2800000-0000-4000-8000-0000000000a2';
const DB = 'a2800000-0000-4000-8000-0000000000a3';
const T = '2026-10-08T13:00:00.000Z';
const KEYS = { A: 'a2800000-0000-4000-8000-0000000000b1', B: 'a2800000-0000-4000-8000-0000000000b2', C: 'a2800000-0000-4000-8000-0000000000b3' } as const;
type Agent = keyof typeof KEYS;
const agent = (name: Agent): AuthResult => ({ userId: OWNER, keyId: KEYS[name], authMethod: 'api_key', scopes: ['read', 'write', 'propose'] } as AuthResult);
const noGit: CanvasAcceptDeps = { repoReader: () => Promise.resolve(null), ancestry: () => Promise.resolve(async () => 'ahead' as const) };

/** REQ-001..006: two on the web app, two on the API, one on the database,
 *  and one mapped to the web app first and the API second. */
const REQS: Array<{ code: string; name: string; nodes: string[] }> = [
  { code: 'REQ-001', name: 'Customers sign in', nodes: [WEB] },
  { code: 'REQ-002', name: 'Customers see their orders', nodes: [WEB] },
  { code: 'REQ-003', name: 'Orders are stored', nodes: [API] },
  { code: 'REQ-004', name: 'Orders are priced', nodes: [API] },
  { code: 'REQ-005', name: 'Order history is kept', nodes: [DB] },
  { code: 'REQ-006', name: 'Browser code reaches secret-backed services only through the App API', nodes: [WEB, API] },
];
const rowOf = (code: string) => `a2800000-0000-4000-8000-${code.slice(4).padStart(12, '0')}`;

type Graph = { nodes: Record<string, { id: string; label: string; artifacts?: string[] }>; artifacts: Record<string, { id: string; nodeId: string; kind: string; path: string; metadata?: Row }> };

/** The database's clock: rows a write leaves without created_at get one, in order. */
function clocked(db: MemorySupabase): MemorySupabase {
  let tick = Date.parse(T);
  const stamp = (row: Row) => (row.created_at === undefined ? { ...row, created_at: new Date(++tick).toISOString() } : row);
  const from = db.from.bind(db);
  db.from = ((table: string) => {
    const q = from(table);
    if (table !== 'graph_snapshots' && table !== 'ai_proposals' && table !== 'ai_runs') return q;
    const insert = q.insert;
    return { ...q, insert: (payload: unknown) => insert(Array.isArray(payload) ? payload.map(stamp) : stamp(payload as Row)) };
  }) as typeof db.from;
  return db;
}

function world(policy: Record<string, number> = { architecture: 2, requirements: 2, candidates: 2, tasks: 2, tests: 2 }) {
  const db = clocked(new MemorySupabase());
  for (const t of ['ai_proposals', 'graph_patches', 'graph_snapshots', 'specification_mappings', 'branches']) db.columns(t, migrationColumns(t));
  const node = (id: string, label: string, type: string, technology: string) => ({ type: 'add_node', metadata: { id: crypto.randomUUID(), actorType: 'human', summary: `add ${label}`, timestamp: T }, payload: { id, type, label, technology } });
  const base = applyPatches(createEmptyGraph(), [
    node(WEB, 'Web App', 'frontend-app', 'react'), node(API, 'App API', 'backend-service', 'express'), node(DB, 'Orders DB', 'database', 'postgresql'),
  ] as never).graph!;
  db.table('projects', [{ id: P, name: 'Bakery', owner_id: OWNER, automation_policy: policy, metadata: {} }]);
  db.table('branches', [{ id: B, project_id: P, name: 'main', is_primary: true }]);
  db.table('graph_snapshots', [{ id: crypto.randomUUID(), project_id: P, branch_id: B, graph_data: base, version: base.version, hash: base.hash, patch_sequence: 0, created_at: T }]);
  db.table('project_specifications', [{ id: SPEC, project_id: P, vision: 'A bakery takes pickup orders online', locked_nodes: [], preferences: {}, created_at: T }]);
  db.table('specification_requirements', REQS.map((r) => ({
    id: rowOf(r.code), specification_id: SPEC, requirement_id: r.code, name: r.name, description: r.name, category: 'functional', status: 'pending',
    acceptance_criteria: [{ text: `${r.name} works` }], confirmed: false, locked: false,
  })));
  let at = Date.parse(T) - 100000;
  db.table('specification_mappings', REQS.flatMap((r) => r.nodes.map((n) => ({
    id: crypto.randomUUID(), specification_id: SPEC, requirement_id: rowOf(r.code), node_id: n, mapping_type: 'implements', created_at: new Date(at++).toISOString(),
  }))).reverse()); // stored newest first: the plan's node must not depend on row order
  for (const t of ['ai_proposals', 'ai_runs', 'graph_patches', 'test_cases', 'task_items', 'agent_checkouts', 'project_members', 'git_change_events', 'work_plans',
    'node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes',
    'project_constraints', 'workflows', 'workflow_steps', 'requirement_candidates', 'stripe_subscriptions', 'user_settings', 'outcome_derivations']) db.table(t, []);
  db.table('mcp_api_keys', Object.values(KEYS).map((id) => ({ id, user_id: OWNER, scopes: ['read', 'write', 'propose'], revoked_at: null, expires_at: null })));
  db.unique('graph_patches', ['branch_id', 'sequence']);
  db.fn('get_next_patch_sequence', (p, d) => Math.max(0, ...d.rowsOf('graph_patches').filter((r) => r.branch_id === p.p_branch_id).map((r) => Number(r.sequence))) + 1);
  db.fn('apply_criteria_ops', () => ({ criteria: [] }));
  db.fn('graph_reference_ids', () => ({ nodes: [WEB, API, DB], contracts: [] }));
  return db;
}

const plan = (db: MemorySupabase, who: Agent, code: string) => handleGetTestPlan(db as never, agent(who), { project_id: P, requirement_id: rowOf(code) });
const docs = (db: MemorySupabase, who: Agent) => handleGenerateTaskDocs(db as never, agent(who), { project_id: P, branch_id: B });
const latest = (db: MemorySupabase) =>
  db.rowsOf('graph_snapshots').slice().sort((a, b) => Number(b.patch_sequence) - Number(a.patch_sequence))[0] as { graph_data: Graph; patch_sequence: number };
const proposals = (db: MemorySupabase) => db.rowsOf('ai_proposals') as Array<Row & { metadata: Row; patches: Array<{ patch: Row }> }>;

/** What must hold of the branch after any number of Auto applies. */
function assertSound(db: MemorySupabase) {
  const log = db.rowsOf('graph_patches').slice().sort((a, b) => Number(a.sequence) - Number(b.sequence));
  assertEquals(log.map((r) => Number(r.sequence)), log.map((_, i) => i + 1), 'the log is numbered 1..n with no gap and no repeat');
  assertEquals(new Set(log.map((r) => r.id)).size, log.length, 'no patch is in the log twice');

  const snap = latest(db);
  assertEquals(snap.patch_sequence, log.length, 'the newest snapshot is the head of the log');
  const g = snap.graph_data;
  for (const n of Object.values(g.nodes)) {
    const own = Object.values(g.artifacts).filter((a) => a.nodeId === n.id).map((a) => a.id).sort();
    assertEquals([...(n.artifacts ?? [])].sort(), own, `${n.label} links each of its files exactly once, and nothing else`);
  }
  assert(validateGraph(g as never).valid, 'the snapshot is a valid graph');

  // The server's own read of the branch: the base snapshot with the log applied in one call.
  const base = db.rowsOf('graph_snapshots').find((s) => s.patch_sequence === 0)!.graph_data as never;
  const replay = applyPatches(base, log.map((r) => r.payload) as never);
  assert(replay.success, `the log replays: ${JSON.stringify(replay.error)}`);
  assertEquals(replay.graph!.nodes, g.nodes as never);
  assertEquals(replay.graph!.artifacts, g.artifacts as never);
}

/** Run `hook` once, at the moment the server writes its patches (the insert
 *  into graph_patches), before the write lands. */
function beforePatchWrite(db: MemorySupabase, hook: () => Promise<unknown>): void {
  let fired = false;
  const from = db.from.bind(db);
  db.from = ((table: string) => {
    const q = from(table);
    if (table !== 'graph_patches') return q;
    return { ...q, insert: (payload: unknown) => ({
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => (async () => {
        if (!fired) { fired = true; await hook(); }
        return await from(table).insert(payload);
      })().then(ok, bad),
    }) };
  }) as typeof db.from;
}

// ── many agents, one project ───────────────────────────────────────────────

Deno.test('AL.28 three agents file six plans and every task doc from the same read; two sweeps race; each applies exactly once and the canvas is sound', async () => {
  const db = world();
  // Every call reads the same base snapshot: nothing applies until the sweeps.
  const filed = await Promise.all([
    plan(db, 'A', 'REQ-001'), plan(db, 'B', 'REQ-003'), docs(db, 'C'),
    plan(db, 'A', 'REQ-002'), plan(db, 'B', 'REQ-004'), plan(db, 'C', 'REQ-005'), plan(db, 'A', 'REQ-006'),
  ]);
  for (const r of filed) assert(r.success, JSON.stringify(r));
  assertEquals(proposals(db).length, 7);
  assertEquals(proposals(db).flatMap((p) => p.patches.map((e) => e.patch.type)).filter((t) => t !== 'add_artifact'), [], 'no link step is filed');

  // The app's project-open sweep and the Auto toggle's sweep, at once.
  const [one, two] = await Promise.all([sweepAuto(db as never, P, noGit), sweepAuto(db as never, P, noGit)]);
  const applied = [...one.applied, ...two.applied].map((a) => a.proposalId);
  assertEquals(applied.length, 7, JSON.stringify({ one, two }));
  assertEquals(new Set(applied).size, 7, 'no proposal applied twice');
  assertEquals([...one.setAside, ...two.setAside, ...one.waiting, ...two.waiting], []);
  for (const p of proposals(db)) assertEquals([p.status, p.metadata.resolvedBy], ['merged', 'auto']);
  assertSound(db);

  const g = latest(db).graph_data;
  const plans = Object.values(g.artifacts).filter((a) => a.kind === 'test-plan');
  assertEquals(plans.map((a) => a.metadata?.requirementId).sort(), REQS.map((r) => r.code));
  assertEquals(plans.find((a) => a.metadata?.requirementId === 'REQ-006')!.nodeId, WEB, 'the first mapped node, though the mappings were read newest first');
  assertEquals(Object.values(g.artifacts).filter((a) => a.kind === 'task').map((a) => a.nodeId).sort(), [WEB, API, DB].sort());

  // Asked again, every plan is the one that landed: nothing new is filed.
  for (const r of REQS) {
    const again = await plan(db, 'B', r.code);
    assertEquals((again.data as Row).testPlanIsNew, false, r.code);
  }
  assertEquals(proposals(db).length, 7);
});

Deno.test('AL.28 the same plan filed by two agents before either applies ends as one plan on one node, linked once', async () => {
  const db = world();
  const [a, b] = await Promise.all([plan(db, 'A', 'REQ-006'), plan(db, 'B', 'REQ-006')]);
  assert(a.success && b.success, JSON.stringify([a, b]));
  const swept = await sweepAuto(db as never, P, noGit);
  assertEquals(swept.applied.length, 2, JSON.stringify(swept));
  assertSound(db);
  const g = latest(db).graph_data;
  const plans = Object.values(g.artifacts).filter((x) => x.kind === 'test-plan');
  assertEquals(plans.length, 1, 'the second replaced the first at the same path on the same node');
  assertEquals([plans[0].nodeId, plans[0].path], [WEB, '.nodespec/tests/req-006.tests.md']);
});

Deno.test('AL.28 an agent filing a plan while the server applies another: it waits for the next sweep, and nothing applies twice', async () => {
  const db = world();
  assert((await plan(db, 'A', 'REQ-001')).success);
  let filedMidway: Row | null = null;
  // agent B files while the server is writing the first plan's patches
  beforePatchWrite(db, async () => { filedMidway = (await plan(db, 'B', 'REQ-002')) as unknown as Row; });
  const first = await sweepAuto(db as never, P, noGit);
  assertEquals(first.applied.length, 1);
  assert((filedMidway as unknown as { success: boolean }).success, JSON.stringify(filedMidway));
  assertEquals(proposals(db).filter((p) => p.status === 'pending').length, 1, 'the one filed mid-apply waits as filed');

  const second = await sweepAuto(db as never, P, noGit);
  assertEquals(second.applied.length, 1);
  assertEquals(proposals(db).map((p) => p.status), ['merged', 'merged']);
  assertSound(db);
  assertEquals(Object.values(latest(db).graph_data.nodes[WEB].artifacts ?? []).length, 2);
});

// ── what was already in the log, or filed the old way ────────────────────────

Deno.test('AL.28 a create-and-link pair the app wrote into the log (Add task by hand) no longer stops every Auto apply on the branch', async () => {
  // The server reads the branch as the snapshot plus the log after it, in one
  // engine call. Before AL.28 one such pair made that read throw, and every
  // Auto apply on the branch waited with "the branch's own history does not replay".
  const db = world();
  const doc = crypto.randomUUID();
  const meta = (summary: string) => ({ id: crypto.randomUUID(), actorType: 'human', summary, timestamp: T });
  const pair = [
    { type: 'add_artifact', metadata: meta('Add T1 to Web App by hand'), payload: { id: doc, nodeId: WEB, kind: 'task', path: '.nodespec/tasks/web-app.task.md', content: '# Task: Web App', language: 'markdown', status: 'draft', createdAt: T, updatedAt: T } },
    { type: 'update_node', metadata: meta('Link the task document to Web App'), payload: { id: WEB, changes: { artifacts: [doc] } } },
  ];
  pair.forEach((p, i) => db.rowsOf('graph_patches').push({ id: p.metadata.id, branch_id: B, sequence: i + 1, patch_type: p.type, actor_type: 'human', summary: p.metadata.summary, payload: p }));

  assert((await plan(db, 'A', 'REQ-001')).success);
  const swept = await sweepAuto(db as never, P, noGit);
  assertEquals([swept.applied.length, swept.waiting.length], [1, 0], JSON.stringify(swept));
  assertSound(db);
  const web = latest(db).graph_data.nodes[WEB];
  assertEquals(web.artifacts?.length, 2);
  assert(web.artifacts!.includes(doc), 'the hand-added task doc stays linked');
});

Deno.test('AL.28 an agent that files the old shape itself (create, then link) applies under Auto', async () => {
  const db = world();
  const id = crypto.randomUUID(), file = crypto.randomUUID();
  const meta = (summary: string) => ({ id: crypto.randomUUID(), actorType: 'ai', actorId: 'agent-a', summary, timestamp: T });
  db.rowsOf('ai_proposals').push({
    id, status: 'pending', source_branch_id: B, reviewed_at: null, merged_at: null, created_at: T,
    patches: [
      { patch: { type: 'add_artifact', metadata: meta('add the plan'), payload: { id: file, nodeId: API, kind: 'test-plan', path: 'docs/qa/orders.md', content: '# plan', language: 'markdown', status: 'draft', createdAt: T, updatedAt: T } }, status: 'pending', explanation: 'x' },
      { patch: { type: 'update_node', metadata: meta('link the plan'), payload: { id: API, changes: { artifacts: [file] } } }, status: 'pending', explanation: 'x' },
    ],
    metadata: { source: 'mcp-server', credential: `key:${KEYS.A}`, apiKeyId: KEYS.A, authMethod: 'api_key', proposedByUserId: OWNER, baseSequence: 0 },
  });
  const r = await acceptCanvasBatch(db as never, P, { id }, agent('A'), noGit);
  assertEquals(r.status, 'merged', JSON.stringify(r));
  assertSound(db);
  assertEquals(latest(db).graph_data.nodes[API].artifacts, [file]);
});

Deno.test('AL.28 two old-shape links to one node from the same read: the second is set aside as a stale read, never unlinking the first', async () => {
  const db = world();
  const meta = (summary: string) => ({ id: crypto.randomUUID(), actorType: 'ai', summary, timestamp: T });
  const fileOld = (who: Agent, path: string) => {
    const id = crypto.randomUUID(), file = crypto.randomUUID();
    db.rowsOf('ai_proposals').push({
      id, status: 'pending', source_branch_id: B, reviewed_at: null, merged_at: null, created_at: new Date(Date.parse(T) + db.rowsOf('ai_proposals').length).toISOString(),
      patches: [
        { patch: { type: 'add_artifact', metadata: meta(`add ${path}`), payload: { id: file, nodeId: WEB, kind: 'doc', path, content: '#', language: 'markdown', status: 'draft', createdAt: T, updatedAt: T } }, status: 'pending', explanation: 'x' },
        { patch: { type: 'update_node', metadata: meta(`link ${path}`), payload: { id: WEB, changes: { artifacts: [file] } } }, status: 'pending', explanation: 'x' },
      ],
      metadata: { source: 'mcp-server', credential: `key:${KEYS[who]}`, apiKeyId: KEYS[who], authMethod: 'api_key', proposedByUserId: OWNER, baseSequence: 0 },
    });
    return { id, file };
  };
  const first = fileOld('A', 'docs/a.md');
  const second = fileOld('B', 'docs/b.md');
  const swept = await sweepAuto(db as never, P, noGit);
  assertEquals(swept.applied.map((a) => a.proposalId), [first.id]);
  assertEquals(swept.setAside.map((s) => s.proposalId), [second.id]);
  assert(swept.setAside[0].reason.startsWith('Stale read:'), swept.setAside[0].reason);
  assertSound(db);
  assertEquals(latest(db).graph_data.nodes[WEB].artifacts, [first.file], 'the first file stays linked');
});

Deno.test('AL.28 without the link step a plan for a locked node still waits for the person, and applies once unlocked', async () => {
  // The lock used to catch the plan through its update_node; the file's own
  // node is what it targets now.
  const db = world();
  (db.rowsOf('project_specifications')[0] as Row).locked_nodes = [WEB];
  assert((await plan(db, 'A', 'REQ-001')).success);
  const held = await sweepAuto(db as never, P, noGit);
  assertEquals([held.applied.length, held.waiting.length], [0, 1], JSON.stringify(held));
  assert(held.waiting[0].reason.startsWith('Locked node:'), held.waiting[0].reason);
  assertEquals(db.rowsOf('graph_patches').length, 0, 'nothing lands on a locked node');

  (db.rowsOf('project_specifications')[0] as Row).locked_nodes = [];
  const freed = await sweepAuto(db as never, P, noGit);
  assertEquals(freed.applied.length, 1, JSON.stringify(freed));
  assertSound(db);
});

// AL.29 (bench round 2, 2026-10-09): a push regenerated a stale task doc in
// memory and wrote it to git while NodeSpec kept the stale copy, so the file in
// git and the one NodeSpec serves differed (the bench added a criterion, then
// pushed). The push now saves what it regenerated: one proposal on the
// sequence it read, applied at Auto. Run over the in-memory database with the
// real refresh gate, the real filing and the real Auto apply.
import { refreshTaskPackets } from '../_shared/packet-freshness.ts';
import { savePushRefresh } from '../mcp-server/tools/push-save.ts';
import { handleGenerateTaskDocs } from '../mcp-server/tools/tasks.ts';
import { handleGetTestPlan } from '../mcp-server/tools/context.ts';
import { sweepAuto } from '../mcp-server/tools/auto-apply.ts';
import { applyPatches } from '../_shared/core-engine/patch-engine.ts';
import { createEmptyGraph } from '../_shared/core-engine/utils.ts';
import type { CanvasAcceptDeps } from '../mcp-server/tools/canvas-accept.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { MemorySupabase, migrationColumns, assert, assertEquals, type Row } from './helpers.ts';

const P = 'a2940000-0000-4000-8000-000000000001';
const B = 'a2940000-0000-4000-8000-000000000002';
const OWNER = 'a2940000-0000-4000-8000-000000000003';
const SPEC = 'a2940000-0000-4000-8000-000000000004';
const REQ_ROW = 'a2940000-0000-4000-8000-000000000005';
const N_DB = 'a2940000-0000-4000-8000-0000000000a1';
const KEY = { userId: OWNER, keyId: 'a2940000-0000-4000-8000-0000000000b1', authMethod: 'api_key', scopes: ['read', 'write', 'propose'] } as AuthResult;
const noGit: CanvasAcceptDeps = { repoReader: () => Promise.resolve(null), ancestry: () => Promise.resolve(async () => 'ahead' as const) };
const T = '2026-10-09T00:00:00.000Z';
const C1 = 'a nightly backup of the task store is taken';
const C2 = 'a backup can be restored to a fresh instance';
const C0 = 'backups are encrypted at rest';
const STEP = '  - [ ] Schedule pg_dump at 02:00 UTC';
// C1 was proven by a tick in git: a regenerated document must not make it stale.
const GIT_TICKED = { text: C1, met: true, provenance: { source: 'git', commitSha: 'abc1234', at: T } };

function world(policy: Record<string, number>) {
  const db = new MemorySupabase();
  for (const t of ['ai_proposals', 'graph_patches', 'graph_snapshots', 'specification_mappings', 'branches']) db.columns(t, migrationColumns(t));
  const base = applyPatches(createEmptyGraph(), [
    { type: 'add_node', metadata: { id: crypto.randomUUID(), actorType: 'human', summary: 'add', timestamp: T }, payload: { id: N_DB, type: 'database', label: 'Orders DB' } },
  ] as never).graph!;
  db.table('projects', [{ id: P, name: 'Bakery', owner_id: OWNER, automation_policy: { architecture: 2, tasks: 2 }, metadata: {} }]);
  db.table('branches', [{ id: B, project_id: P, name: 'main', is_primary: true }]);
  db.table('graph_snapshots', [{ id: crypto.randomUUID(), project_id: P, branch_id: B, graph_data: base, version: base.version, hash: base.hash, patch_sequence: 0, created_at: T }]);
  db.table('project_specifications', [{ id: SPEC, project_id: P, vision: '', locked_nodes: [], preferences: {}, created_at: T }]);
  db.table('specification_requirements', [{ id: REQ_ROW, specification_id: SPEC, requirement_id: 'REQ-003', name: 'Back up tasks', description: 'The task store is backed up', category: 'functional', status: 'pending', acceptance_criteria: [GIT_TICKED, { text: C2 }], confirmed: false, locked: false }]);
  db.table('specification_mappings', [{ id: crypto.randomUUID(), specification_id: SPEC, requirement_id: REQ_ROW, node_id: N_DB, mapping_type: 'implements', created_at: T }]);
  for (const t of ['ai_proposals', 'ai_runs', 'graph_patches', 'test_cases', 'task_items', 'agent_checkouts', 'project_members', 'git_change_events', 'work_plans',
    'node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes',
    'project_constraints', 'workflows', 'workflow_steps', 'requirement_candidates', 'stripe_subscriptions', 'user_settings', 'outcome_derivations']) db.table(t, []);
  db.table('mcp_api_keys', [{ id: KEY.keyId, user_id: OWNER, scopes: ['read', 'write', 'propose'], revoked_at: null, expires_at: null }]);
  db.unique('graph_patches', ['branch_id', 'sequence']);
  db.fn('get_next_patch_sequence', (p, d) => Math.max(0, ...d.rowsOf('graph_patches').filter((r) => r.branch_id === p.p_branch_id).map((r) => Number(r.sequence))) + 1);
  const criteriaOps: unknown[] = [];
  db.fn('apply_criteria_ops', (p) => { criteriaOps.push(p); return { criteria: [] }; });
  db.fn('graph_reference_ids', () => ({ nodes: [N_DB], contracts: [] }));
  return { db, criteriaOps, setPolicy: () => { db.rowsOf('projects')[0].automation_policy = policy; } };
}
const head = (db: MemorySupabase) => db.rowsOf('graph_snapshots').slice().sort((a, b) => Number(b.patch_sequence) - Number(a.patch_sequence))[0] as { graph_data: { artifacts: Record<string, Row & { content: string; kind: string; path: string }> }; patch_sequence: number };
const storedDoc = (db: MemorySupabase) => Object.values(head(db).graph_data.artifacts).find((a) => a.kind === 'task')!;

const storedPlan = (db: MemorySupabase) => Object.values(head(db).graph_data.artifacts).find((a) => a.kind === 'test-plan')!;

/** A stored doc with the agent's step and a stored plan, made stale by a criterion inserted first. */
async function staleDoc(policy: Record<string, number>) {
  const w = world(policy);
  assert((await handleGenerateTaskDocs(w.db as never, KEY, { project_id: P, branch_id: B } as never)).success);
  assert((await handleGetTestPlan(w.db as never, KEY, { project_id: P, requirement_id: 'REQ-003' })).success);
  await sweepAuto(w.db as never, P, noGit);
  assert(storedPlan(w.db), 'setup: the plan is stored');
  const doc = storedDoc(w.db);
  const lines = doc.content.split('\n');
  const at = lines.findIndex((l) => l.startsWith('- [') && l.includes(`"${C2}"`));
  lines.splice(at + 1, 0, STEP);
  doc.content = lines.join('\n');
  w.db.rowsOf('specification_requirements')[0].acceptance_criteria = [{ text: C0 }, GIT_TICKED, { text: C2 }];
  w.setPolicy();
  return w;
}
/** What git-push does: refresh the graph it read, then save what was regenerated. */
async function push(db: MemorySupabase, between?: () => Promise<void>) {
  const read = head(db);
  const graph = structuredClone(read.graph_data);
  const refresh = await refreshTaskPackets(db as never, P, graph, B);
  if (between) await between();
  const saved = await savePushRefresh(db as never, { projectId: P, branchId: B, userId: OWNER, saves: refresh.saves, baseSequence: read.patch_sequence, deps: noGit });
  const pushedOf = (kind: string) => Object.values(graph.artifacts).find((a) => a.kind === kind)!.content;
  return { refresh, saved, pushed: pushedOf('task'), pushedPlan: pushedOf('test-plan') };
}

Deno.test('AL.29 push: at Auto NodeSpec stores the regenerated doc it pushed, the agent\'s step kept, and the git-ticked criterion is not made stale', async () => {
  const { db, criteriaOps } = await staleDoc({ architecture: 2, tasks: 2 });
  const before = storedDoc(db).content;
  const planBefore = storedPlan(db).content;
  const { refresh, saved, pushed, pushedPlan } = await push(db);
  assertEquals([refresh.refreshed, refresh.testPlansRefreshed, refresh.saves.map((s) => s.kind)], [1, 1, ['task', 'test-plan']], JSON.stringify(refresh).slice(0, 300));
  assert(pushed !== before && pushed.includes(C0), 'the push regenerated the doc');
  assert(pushedPlan !== planBefore && pushedPlan.includes(C0), 'and the plan');
  assertEquals(saved?.status, 'applied', JSON.stringify(saved));
  assertEquals(storedDoc(db).content, pushed, 'NodeSpec stores the doc git got');
  assertEquals(storedPlan(db).content, pushedPlan, 'and the plan');
  assert(storedDoc(db).content.includes(STEP), 'the agent\'s step is kept');
  assertEquals(criteriaOps.filter((p) => JSON.stringify(p).includes('mark_stale')), [], 'no criterion was marked stale by a document');

  // The next push finds the doc fresh: nothing regenerated, nothing filed.
  const proposals = db.rowsOf('ai_proposals').length;
  const again = await push(db);
  assertEquals([again.refresh.refreshed, again.saved], [0, null]);
  assertEquals(db.rowsOf('ai_proposals').length, proposals);
});

Deno.test('AL.29 push: with Architecture at Propose the push files nothing and says NodeSpec\'s copy waits for the refresh lanes', async () => {
  const { db } = await staleDoc({ architecture: 1, tasks: 1 });
  const before = storedDoc(db).content;
  const proposals = db.rowsOf('ai_proposals').length;
  const { saved, pushed } = await push(db);
  assertEquals([saved?.status, saved?.proposalId], ['not saved', null], JSON.stringify(saved));
  assert(/Architecture is not at Auto/.test(String(saved?.reason)) && /generate_task_docs or get_test_plan/.test(String(saved?.reason)), String(saved?.reason));
  assertEquals(db.rowsOf('ai_proposals').length, proposals, 'no proposal is left waiting on a push');
  assert(pushed !== before, 'git still gets the regenerated doc');
  assertEquals(storedDoc(db).content, before);
});

Deno.test('AL.29 push: at Auto a file a waiting proposal already changes is left to it; the others are saved', async () => {
  const { db } = await staleDoc({ architecture: 2, tasks: 2 });
  const doc = storedDoc(db);
  const waitingId = crypto.randomUUID();
  // an agent's edit filed with a key that may only propose: it waits for the person
  db.rowsOf('ai_proposals').push({
    id: waitingId, status: 'pending', source_branch_id: B, reviewed_at: null, merged_at: null, created_at: new Date().toISOString(),
    patches: [{ patch: { type: 'update_artifact', metadata: { id: crypto.randomUUID(), actorType: 'ai', actorId: 'agent', summary: 'steps', timestamp: T }, payload: { id: doc.id, changes: { content: doc.content + '\n  - [ ] waiting step\n' } } }, explanation: 'x', status: 'pending' }],
    metadata: { source: 'mcp-server', authMethod: 'api_key', proposedByUserId: OWNER },
  });
  const before = doc.content;
  const { saved, pushedPlan } = await push(db);
  assertEquals(saved?.leftToWaiting, [{ path: doc.path, proposalId: waitingId }]);
  assertEquals(saved?.status, 'applied', JSON.stringify(saved));
  const filed = db.rowsOf('ai_proposals').find((r) => r.id === saved!.proposalId)!;
  assertEquals((filed.patches as Array<{ patch: { payload: { id: string } } }>).map((e) => e.patch.payload.id), [storedPlan(db).id], 'only the plan is in the save');
  assertEquals((filed.metadata as Row).baseSequence, head(db).patch_sequence - 1, 'on the sequence the push read');
  assertEquals(storedPlan(db).content, pushedPlan);
  assertEquals(storedDoc(db).content, before, 'the doc is left to the waiting proposal');
});

Deno.test('AL.29 push: an agent\'s edit that lands after the push read the branch sets the save aside and stays', async () => {
  const { db } = await staleDoc({ architecture: 2, tasks: 2 });
  const doc = storedDoc(db);
  const edited = doc.content + '\n  - [ ] B: copy the dump off site\n';
  const { saved } = await push(db, async () => {
    db.rowsOf('ai_proposals').push({
      id: crypto.randomUUID(), status: 'pending', source_branch_id: B, reviewed_at: null, merged_at: null, created_at: new Date().toISOString(),
      patches: [{ patch: { type: 'update_artifact', metadata: { id: crypto.randomUUID(), actorType: 'ai', actorId: 'agent', summary: 'steps', timestamp: T }, payload: { id: doc.id, changes: { content: edited } } }, explanation: 'x', status: 'pending' }],
      metadata: { source: 'mcp-server', credential: `key:${KEY.keyId}`, apiKeyId: KEY.keyId, authMethod: 'api_key', proposedByUserId: OWNER, baseSequence: head(db).patch_sequence },
    });
    await sweepAuto(db as never, P, noGit);
  });
  assertEquals(saved?.status, 'set aside', JSON.stringify(saved));
  assert(/Stale read/.test(String(saved?.reason)), String(saved?.reason));
  assertEquals(storedDoc(db).content, edited, 'the agent\'s edit stands');
});

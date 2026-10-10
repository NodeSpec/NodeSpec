// AL.29 (bench, 2026-10-09): two agents wrote steps into one task doc from
// the same read, each with base_sequence. Under Auto both filings answered
// "applied", yet only one agent's steps were in the doc: the server checked
// the base, then read the branch and wrote, and the other agent's apply landed
// in between, so a whole document was written over an edit the check never saw.
//
// These interleave the two applies deterministically: the second runs to the
// end at the moment the first writes its patches. graph_patches is unique on
// (branch, sequence), as in production.
import { acceptCanvasBatch, type CanvasAcceptDeps } from '../mcp-server/tools/canvas-accept.ts';
import { applyPatches } from '../_shared/core-engine/patch-engine.ts';
import { createEmptyGraph } from '../_shared/core-engine/utils.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { MemorySupabase, migrationColumns, assert, assertEquals, type Row } from './helpers.ts';

const P = 'a2900000-0000-4000-8000-000000000001';
const B = 'a2900000-0000-4000-8000-000000000002';
const OWNER = 'a2900000-0000-4000-8000-000000000003';
const KEY = 'a2900000-0000-4000-8000-000000000005';
const N1 = 'a2900000-0000-4000-8000-0000000000a1';
const DOC = 'a2900000-0000-4000-8000-0000000000d1';
const DOC2 = 'a2900000-0000-4000-8000-0000000000d2';
const T = '2026-10-09T00:00:00.000Z';
const AUTH = { userId: OWNER, keyId: KEY, authMethod: 'api_key', scopes: ['read', 'write', 'propose'] } as AuthResult;
const noGit: CanvasAcceptDeps = { repoReader: () => Promise.resolve(null), ancestry: () => Promise.resolve(async () => 'ahead' as const) };
const BASE_DOC = '# Task: Orders DB\n\n## Implementation Tasks\n\n- [ ] **T1 \u2014 Take the nightly backup** <!-- t:aaaa0001 -->\n- [ ] **T2 \u2014 Restore from a backup** <!-- t:aaaa0002 -->\n';

const meta = (summary: string) => ({ id: crypto.randomUUID(), actorType: 'ai', actorId: 'agent', summary, timestamp: T });
const addDoc = (id: string, path: string) => ({ type: 'add_artifact', metadata: meta(`add ${path}`), payload: { id, nodeId: N1, kind: 'task', path, content: BASE_DOC, language: 'markdown', status: 'draft', createdAt: T, updatedAt: T } });
const edit = (id: string, content: string) => ({ type: 'update_artifact', metadata: meta('write steps'), payload: { id, changes: { content } } });

function world() {
  const db = new MemorySupabase();
  for (const t of ['ai_proposals', 'graph_patches', 'graph_snapshots', 'specification_mappings', 'branches']) db.columns(t, migrationColumns(t));
  const base = applyPatches(createEmptyGraph(), [
    { type: 'add_node', metadata: meta('add Orders DB'), payload: { id: N1, type: 'database', label: 'Orders DB' } },
    addDoc(DOC, '.nodespec/tasks/orders-db.task.md'),
    addDoc(DOC2, '.nodespec/tasks/orders-db-ops.task.md'),
  ] as never).graph!;
  db.table('projects', [{ id: P, name: 'Bakery', owner_id: OWNER, automation_policy: { architecture: 2, tasks: 2 } }]);
  db.table('branches', [{ id: B, project_id: P, name: 'main', is_primary: true }]);
  db.table('graph_snapshots', [{ id: crypto.randomUUID(), project_id: P, branch_id: B, graph_data: base, version: base.version, hash: base.hash, patch_sequence: 0, created_at: T }]);
  db.table('project_specifications', [{ id: 'spec-1', project_id: P, locked_nodes: [], preferences: {}, created_at: T }]);
  for (const t of ['ai_proposals', 'graph_patches', 'specification_requirements', 'specification_mappings', 'agent_checkouts', 'project_members', 'git_change_events', 'test_cases']) db.table(t, []);
  db.table('mcp_api_keys', [{ id: KEY, user_id: OWNER, scopes: ['read', 'write', 'propose'], revoked_at: null, expires_at: null }]);
  db.unique('graph_patches', ['branch_id', 'sequence']);
  db.fn('get_next_patch_sequence', (p, d) => Math.max(0, ...d.rowsOf('graph_patches').filter((r) => r.branch_id === p.p_branch_id).map((r) => Number(r.sequence))) + 1);
  db.fn('apply_criteria_ops', () => ({ criteria: [] }));
  return db;
}

/** What propose_patches stores: one patch, filed on a read at sequence 0. */
function file(db: MemorySupabase, patch: unknown): string {
  const id = crypto.randomUUID();
  db.rowsOf('ai_proposals').push({
    id, status: 'pending', source_branch_id: B, reviewed_at: null, merged_at: null, created_at: new Date().toISOString(),
    patches: [{ patch, explanation: 'x', status: 'pending' }],
    metadata: { source: 'mcp-server', credential: `key:${KEY}`, apiKeyId: KEY, authMethod: 'api_key', proposedByUserId: OWNER, baseSequence: 0 },
  });
  return id;
}

/** The other agent's apply runs to the end at the moment this one writes its patches. */
function landsInBetween(db: MemorySupabase, other: string): void {
  let fired = false;
  const from = db.from.bind(db);
  db.from = ((table: string) => {
    const q = from(table);
    if (table !== 'graph_patches') return q;
    return { ...q, insert: (payload: unknown) => ({
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => (async () => {
        if (!fired) { fired = true; await acceptCanvasBatch(db as never, P, { id: other }, AUTH, noGit); }
        return await from(table).insert(payload);
      })().then(ok, bad),
    }) };
  }) as typeof db.from;
}

const status = (db: MemorySupabase, id: string) => db.rowsOf('ai_proposals').find((r) => r.id === id) as Row & { metadata: Row };
const head = (db: MemorySupabase) => db.rowsOf('graph_snapshots').slice().sort((a, b) => Number(b.patch_sequence) - Number(a.patch_sequence))[0] as { graph_data: { artifacts: Record<string, { content: string }> }; patch_sequence: number };
function assertReplays(db: MemorySupabase) {
  const log = db.rowsOf('graph_patches').slice().sort((a, b) => Number(a.sequence) - Number(b.sequence));
  assertEquals(log.map((r) => Number(r.sequence)), log.map((_, i) => i + 1), 'the log is numbered 1..n');
  assertEquals(head(db).patch_sequence, log.length, 'the newest snapshot is the head of the log');
  const base = db.rowsOf('graph_snapshots').find((s) => s.patch_sequence === 0)!.graph_data as never;
  const replay = applyPatches(base, log.map((r) => r.payload) as never);
  assert(replay.success, JSON.stringify(replay.error));
  assertEquals((replay.graph!.artifacts as Record<string, { content: string }>)[DOC].content, head(db).graph_data.artifacts[DOC].content, 'the snapshot is what the log replays to');
}

Deno.test('AL.29: two agents write one document from one read; the second to land is set aside as a stale read, never written over the first', async () => {
  const db = world();
  const a = file(db, edit(DOC, BASE_DOC + '  - [ ] A: run pg_dump at 02:00\n'));
  const b = file(db, edit(DOC, BASE_DOC + '  - [ ] B: copy the dump off site\n'));
  landsInBetween(db, b);
  const r = await acceptCanvasBatch(db as never, P, { id: a }, AUTH, noGit);

  assertEquals(status(db, b).status, 'merged', 'the one that landed first stands');
  assertEquals([r.status, status(db, a).status], ['set aside', 'rejected'], JSON.stringify(r));
  assert(/Stale read/.test(String((r as { reason?: string }).reason)), JSON.stringify(r));
  const content = head(db).graph_data.artifacts[DOC].content;
  assert(content.includes('B: copy the dump off site'), 'B\'s steps are in the document');
  assert(!content.includes('A: run pg_dump'), 'A, told it was set aside, is not half in');
  assertEquals(db.rowsOf('graph_patches').length, 1, 'only what landed is in the log');
  assertReplays(db);
});

Deno.test('AL.29: two agents write different documents from one read; both land, the later one on top of the earlier', async () => {
  const db = world();
  const a = file(db, edit(DOC, BASE_DOC + '  - [ ] A: run pg_dump at 02:00\n'));
  const b = file(db, edit(DOC2, BASE_DOC + '  - [ ] B: page the on-call on failure\n'));
  landsInBetween(db, b);
  const r = await acceptCanvasBatch(db as never, P, { id: a }, AUTH, noGit);

  assertEquals([r.status, status(db, a).status, status(db, b).status], ['merged', 'merged', 'merged'], JSON.stringify(r));
  const g = head(db).graph_data;
  assert(g.artifacts[DOC].content.includes('A: run pg_dump'), 'A landed');
  assert(g.artifacts[DOC2].content.includes('B: page the on-call'), 'B is still there');
  assertEquals(db.rowsOf('graph_patches').map((p) => [Number(p.sequence), (p.payload as { payload: { id: string } }).payload.id]), [[1, DOC2], [2, DOC]]);
  assertReplays(db);
});

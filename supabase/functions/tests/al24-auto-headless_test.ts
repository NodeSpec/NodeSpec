// AL.24 (owner 2026-10-05): "even when i select auto for agents approval,
// there are proposals that sit primarily for Requirement or architecture
// addition ... ensure that upon toggle, the backend logic remains headless so
// the user doesn't have to have the app open, as well as we don't have a race
// condition if the user then clicks reject or approve while the function is
// completing auto approval."
//
// A canvas proposal under Auto applied only from a poller in the open app,
// with no claim. These run the server's own accept against an in-memory
// database: nothing of the app is loaded, so what passes here passes with
// the app closed.
import { acceptCanvasBatch, type CanvasAcceptDeps } from '../mcp-server/tools/canvas-accept.ts';
import { autoRule, sweepAuto } from '../mcp-server/tools/auto-apply.ts';
import { credentialRights, filerFromProposal, type Filer } from '../mcp-server/tools/auto-filer.ts';
import { handleResolveProposal, BEING_DECIDED } from '../mcp-server/tools/approvals.ts';
import { handleResolveChange } from '../mcp-server/tools/git.ts';
import { applyPatches } from '../_shared/core-engine/patch-engine.ts';
import { createEmptyGraph } from '../_shared/core-engine/utils.ts';
import { GIT_CONTENT_SENTINEL } from '../_shared/core-engine/proposal-git-content.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { MemorySupabase, migrationColumns, assert, assertEquals, type Row } from './helpers.ts';

const P = 'a2400000-0000-4000-8000-000000000001';
const B = 'a2400000-0000-4000-8000-000000000002';
const OWNER = 'a2400000-0000-4000-8000-000000000003';
const MEMBER = 'a2400000-0000-4000-8000-000000000004';
const KEY = 'a2400000-0000-4000-8000-000000000005';
const PROPOSE_KEY = 'a2400000-0000-4000-8000-000000000006';
const SPEC = 'a2400000-0000-4000-8000-000000000007';
const REQ = 'a2400000-0000-4000-8000-000000000008';
const N1 = 'a2400000-0000-4000-8000-0000000000a1';
const N2 = 'a2400000-0000-4000-8000-0000000000a2';
const OLD = 'a'.repeat(40), HEAD = 'b'.repeat(40);
const T = '2026-10-05T00:00:00.000Z';
const OWNER_JWT = { userId: OWNER, authMethod: 'jwt', scopes: ['read', 'write', 'propose'] } as AuthResult;

const meta = (summary: string) => ({ id: crypto.randomUUID(), actorType: 'ai', actorId: 'site-builder', summary, timestamp: T });
const addNode = (id: string, label: string) => ({ type: 'add_node', metadata: meta(`add ${label}`), payload: { id, type: 'backend-service', label } });
const rename = (id: string, label: string) => ({ type: 'update_node', metadata: meta(`rename to ${label}`), payload: { id, changes: { label } } });

function world(policy: Record<string, number> = { architecture: 2, requirements: 2, candidates: 2, tasks: 2 }) {
  const db = new MemorySupabase();
  for (const t of ['ai_proposals', 'graph_patches', 'graph_snapshots', 'specification_mappings', 'branches', 'git_change_events']) db.columns(t, migrationColumns(t));
  const base = applyPatches(createEmptyGraph(), [addNode(N1, 'Orders API') as never]).graph!;
  db.table('projects', [{ id: P, name: 'Bakery', owner_id: OWNER, automation_policy: policy }]);
  db.table('branches', [{ id: B, project_id: P, name: 'main', is_primary: true, last_synced_commit: OLD }]);
  db.table('ai_proposals', []);
  db.table('graph_patches', []);
  db.table('graph_snapshots', [{ id: crypto.randomUUID(), project_id: P, branch_id: B, graph_data: base, version: base.version, hash: base.hash, patch_sequence: 0, created_at: T }]);
  db.table('project_specifications', [{ id: SPEC, project_id: P, locked_nodes: [], preferences: {}, created_at: T }]);
  db.table('specification_requirements', [{ id: REQ, specification_id: SPEC, requirement_id: 'REQ-001', name: 'Customers order pickup', description: 'Pickup orders are taken online', category: 'functional', acceptance_criteria: [{ text: 'A pickup order is stored' }] }]);
  db.table('specification_mappings', []);
  db.table('agent_checkouts', []);
  db.table('project_members', []);
  db.table('git_change_events', []);
  db.table('work_plans', []);
  db.table('mcp_api_keys', [
    { id: KEY, user_id: OWNER, scopes: ['read', 'write', 'propose'], revoked_at: null, expires_at: null },
    { id: PROPOSE_KEY, user_id: OWNER, scopes: ['read', 'propose'], revoked_at: null, expires_at: null },
  ]);
  db.unique('graph_patches', ['branch_id', 'sequence']);
  db.fn('get_next_patch_sequence', (p, d) => Math.max(0, ...d.rowsOf('graph_patches').filter((r) => r.branch_id === p.p_branch_id).map((r) => Number(r.sequence))) + 1);
  db.fn('apply_criteria_ops', () => ({ criteria: [] }));
  return db;
}

/** A proposal an agent filed earlier, as propose_patches stores it. */
function file(db: MemorySupabase, patches: unknown[], extra: Row = {}, credential = `key:${KEY}`): string {
  const id = crypto.randomUUID();
  db.rowsOf('ai_proposals').push({
    id, status: 'pending', source_branch_id: B, reviewed_at: null, merged_at: null, created_at: new Date().toISOString(),
    patches: patches.map((patch) => ({ patch, explanation: 'x', status: 'pending' })),
    metadata: { source: 'mcp-server', credential, apiKeyId: credential.slice(4), authMethod: 'api_key', proposedByUserId: OWNER, baseSequence: 0, ...extra },
  });
  return id;
}
const proposal = (db: MemorySupabase, id: string) => db.rowsOf('ai_proposals').find((r) => r.id === id) as Row & { metadata: Row };
const latestGraph = (db: MemorySupabase) => {
  const snaps = db.rowsOf('graph_snapshots').slice().sort((a, b) => Number(b.patch_sequence) - Number(a.patch_sequence));
  return snaps[0] as { graph_data: { nodes: Record<string, { label: string }>; artifacts: Record<string, { content: string; path: string }> }; patch_sequence: number };
};
const ownerKey = { auth: { userId: OWNER, keyId: KEY, authMethod: 'api_key', scopes: ['read', 'write', 'propose'] } as AuthResult, role: 'owner', write: true } as Filer;
const noGit: CanvasAcceptDeps = { repoReader: () => Promise.resolve(null), ancestry: () => Promise.resolve(async () => 'ahead' as const) };

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

// ── headless: the server applies a canvas proposal under Auto ─────────────

Deno.test('AL.24 a canvas proposal under Auto applies on the server: in the log, in the snapshot, mapped, merged as applied', async () => {
  const db = world();
  const id = file(db, [addNode(N2, 'Pickup Orders Service')]);
  const swept = await sweepAuto(db as never, P, noGit);
  assertEquals(swept.applied, [{ proposalId: id, plane: 'canvas' }]);
  assertEquals([swept.waiting, swept.setAside, swept.busy], [[], [], []]);

  const log = db.rowsOf('graph_patches');
  assertEquals(log.map((r) => [r.sequence, r.patch_type, r.branch_id]), [[1, 'add_node', B]]);
  const snap = latestGraph(db);
  assertEquals(snap.patch_sequence, 1);
  assertEquals(Object.values(snap.graph_data.nodes).map((n) => n.label).sort(), ['Orders API', 'Pickup Orders Service']);
  const p = proposal(db, id);
  assertEquals([p.status, p.metadata.resolvedBy, p.metadata.auto], ['merged', 'auto', true]);
  assert(typeof p.merged_at === 'string', 'merged_at is set');
  // the app's keyword mapping, run by the server: "pickup", "orders" overlap REQ-001
  assertEquals(db.rowsOf('specification_mappings').map((m) => [m.node_id, m.requirement_id, m.mapping_type]), [[N2, REQ, 'implements']]);
  // a second sweep finds nothing to do and writes nothing
  const again = await sweepAuto(db as never, P, noGit);
  assertEquals(again.applied.length + again.waiting.length, 0);
  assertEquals(db.rowsOf('graph_patches').length, 1);
});

Deno.test('AL.24 under Propose the same proposal is left exactly as filed', async () => {
  const db = world({ architecture: 1 });
  const id = file(db, [addNode(N2, 'Kitchen printer')]);
  const swept = await sweepAuto(db as never, P, noGit);
  assertEquals(swept.applied.length + swept.waiting.length, 0);
  assertEquals([proposal(db, id).status, proposal(db, id).reviewed_at, proposal(db, id).metadata.autoWait], ['pending', null, undefined]);
  assertEquals(db.rowsOf('graph_patches').length, 0);
});

Deno.test('AL.24 the sweep leaves the account\'s example as it ships: its waiting proposals are part of the tour', async () => {
  const db = world();
  (db.rowsOf('projects')[0] as Row).metadata = { example: 'living-cascade' };
  const id = file(db, [addNode(N2, 'Kitchen printer')]);
  const swept = await sweepAuto(db as never, P, noGit);
  assertEquals(swept.applied.length + swept.waiting.length, 0);
  assertEquals([proposal(db, id).status, proposal(db, id).metadata.autoWait], ['pending', undefined]);
});

// ── no race: one decider at a time ─────────────────────────────────────────

Deno.test('AL.24 a person\'s reject arriving while the server applies is refused, and the apply completes', async () => {
  const db = world();
  const id = file(db, [addNode(N2, 'Kitchen printer')]);
  let midway: { success: boolean; error?: string } | null = null;
  // the person clicks Reject while the accept is writing its patches
  beforePatchWrite(db, async () => {
    midway = await handleResolveProposal(db as never, OWNER_JWT, { project_id: P, proposal_id: id, action: 'reject', note: 'not now' });
  });
  const r = await acceptCanvasBatch(db as never, P, { id }, ownerKey.auth, noGit);
  assertEquals(r.status, 'merged');
  assertEquals(midway, { success: false, error: BEING_DECIDED });
  assertEquals(proposal(db, id).status, 'merged');
  assertEquals(db.rowsOf('graph_patches').length, 1);
});

Deno.test('AL.24 a proposal a person is deciding is not touched by the server, and one they rejected first never applies', async () => {
  const db = world();
  const held = file(db, [addNode(N2, 'Kitchen printer')]);
  proposal(db, held).reviewed_at = new Date().toISOString(); // the app's accept holds it
  assertEquals((await acceptCanvasBatch(db as never, P, { id: held }, ownerKey.auth, noGit)).status, 'busy');
  assertEquals([proposal(db, held).status, db.rowsOf('graph_patches').length], ['pending', 0]);

  const rejected = file(db, [addNode(crypto.randomUUID(), 'Label printer')]);
  const r = await handleResolveProposal(db as never, OWNER_JWT, { project_id: P, proposal_id: rejected, action: 'reject', note: 'no' });
  assertEquals(r.success, true, JSON.stringify(r));
  const swept = await sweepAuto(db as never, P, noGit);
  assert(!swept.applied.some((a) => a.proposalId === rejected), 'a rejected proposal is not pending');
  assertEquals(proposal(db, rejected).status, 'rejected');
  assertEquals(db.rowsOf('graph_patches').length, 0, 'the held one waits for its decider; the rejected one never lands');
});

Deno.test('AL.24 a reject written without the claim right after the server claims (an app tab from before AL.24) is honoured: nothing applies', async () => {
  const db = world();
  const id = file(db, [addNode(N2, 'Kitchen printer')]);
  let calls = 0;
  // the first ai_proposals call is the claim; the old tab's unconditional reject lands before the re-read
  const hooked = new Proxy(db, {
    get(target, key) {
      if (key !== 'from') return Reflect.get(target, key);
      return (table: string) => {
        if (table === 'ai_proposals' && ++calls === 2) Object.assign(proposal(db, id), { status: 'rejected', reviewed_at: '2026-10-05T01:00:00.000Z' });
        return target.from(table);
      };
    },
  });
  assertEquals((await acceptCanvasBatch(hooked as never, P, { id }, ownerKey.auth, noGit)).status, 'busy');
  assertEquals([proposal(db, id).status, db.rowsOf('graph_patches').length], ['rejected', 0]);
});

Deno.test('AL.24 a claim a crashed decider left behind lapses after five minutes, and the server applies then', async () => {
  const db = world();
  const id = file(db, [addNode(N2, 'Kitchen printer')]);
  proposal(db, id).reviewed_at = new Date(Date.now() - 6 * 60_000).toISOString();
  assertEquals((await acceptCanvasBatch(db as never, P, { id }, ownerKey.auth, noGit)).status, 'merged');
});

// ── what it does instead of applying ───────────────────────────────────────

Deno.test('AL.24 a read the branch moved under is set aside with the reason; nothing lands', async () => {
  const db = world();
  db.rowsOf('graph_patches').push({ id: crypto.randomUUID(), branch_id: B, sequence: 1, patch_type: 'update_node', actor_type: 'human', summary: 'renamed', payload: rename(N1, 'Order API') });
  const id = file(db, [rename(N1, 'Orders Service')]);
  const r = await acceptCanvasBatch(db as never, P, { id }, ownerKey.auth, noGit);
  assertEquals(r.status, 'set aside');
  const p = proposal(db, id);
  assertEquals([p.status, p.metadata.resolvedBy], ['rejected', 'auto']);
  assert(String(p.metadata.resolveNote).startsWith(`Stale read: patch[0] update_node targets ${N1}, which the user changed at sequence 1`), String(p.metadata.resolveNote));
  assertEquals(db.rowsOf('graph_patches').length, 1, 'only the person\'s patch');
});

Deno.test('AL.24 a patch the engine refuses is set aside with the engine\'s reason, and the log is untouched', async () => {
  const db = world();
  const id = file(db, [rename(N2, 'Nothing here')]);
  const r = await acceptCanvasBatch(db as never, P, { id }, ownerKey.auth, noGit);
  assertEquals(r.status, 'set aside');
  assert(String(proposal(db, id).metadata.resolveNote).startsWith('A patch will not apply: '), String(proposal(db, id).metadata.resolveNote));
  assertEquals([db.rowsOf('graph_patches').length, db.rowsOf('graph_snapshots').length], [0, 1]);
});

Deno.test('AL.24 a node locked since filing waits for the person: the reason on the proposal, the claim released', async () => {
  const db = world();
  (db.rowsOf('project_specifications')[0] as Row).locked_nodes = [N1];
  const id = file(db, [rename(N1, 'Orders Service')]);
  const r = await acceptCanvasBatch(db as never, P, { id }, ownerKey.auth, noGit);
  assertEquals(r.status, 'waiting');
  const p = proposal(db, id);
  assertEquals([p.status, p.reviewed_at], ['pending', null]);
  assert(String((p.metadata.autoWait as Row).reason).startsWith(`Locked node: patch[0] update_node targets node ${N1}.`), JSON.stringify(p.metadata.autoWait));
  assertEquals(db.rowsOf('graph_patches').length, 0);
});

Deno.test('AL.24 a file bound by reference is read from git at accept; one git has not got waits, saying which', async () => {
  const bound = (path: string) => ({
    type: 'add_artifact', metadata: meta(`bind ${path}`),
    payload: { id: crypto.randomUUID(), nodeId: N1, kind: 'source', path, content: GIT_CONTENT_SENTINEL, createdAt: T, updatedAt: T, metadata: { contentSource: { type: 'git', ref: HEAD } } },
  });
  const reads: string[] = [];
  const git: CanvasAcceptDeps = {
    ...noGit,
    repoReader: () => Promise.resolve(async (path: string, ref: string) => {
      reads.push(`${path}@${ref}`);
      return path === 'src/orders.ts' ? { status: 'found' as const, text: 'export const orders = [];' } : { status: 'absent' as const };
    }),
  };
  const db = world();
  const ok = file(db, [bound('src/orders.ts')]);
  assertEquals((await acceptCanvasBatch(db as never, P, { id: ok }, ownerKey.auth, git)).status, 'merged');
  assertEquals(reads, [`src/orders.ts@${HEAD}`]);
  assertEquals(Object.values(latestGraph(db).graph_data.artifacts).map((a) => [a.path, a.content]), [['src/orders.ts', 'export const orders = [];']]);

  const missing = file(db, [bound('src/missing.ts')]);
  const r = await acceptCanvasBatch(db as never, P, { id: missing }, ownerKey.auth, git);
  assertEquals(r, { status: 'waiting', reason: `Git has no src/missing.ts at ${HEAD}: push the commit its content_ref names.` });
  assertEquals([proposal(db, missing).status, proposal(db, missing).reviewed_at], ['pending', null]);
  assertEquals(db.rowsOf('graph_patches').length, 1, 'nothing more landed');
});

Deno.test('AL.24 a wait never writes over a decision another decider made meanwhile', async () => {
  const db = world();
  const bound = { type: 'add_artifact', metadata: meta('bind'), payload: { id: crypto.randomUUID(), nodeId: N1, kind: 'source', path: 'src/x.ts', content: GIT_CONTENT_SENTINEL, createdAt: T, updatedAt: T, metadata: { contentSource: { type: 'git', ref: HEAD } } } };
  const id = file(db, [bound]);
  const decidedAt = '2026-10-05T01:00:00.000Z';
  // while git is read (a slow provider), the claim lapses and a person rejects it
  const git: CanvasAcceptDeps = {
    ...noGit,
    repoReader: () => Promise.resolve(async () => {
      Object.assign(proposal(db, id), { status: 'rejected', reviewed_at: decidedAt });
      return { status: 'absent' as const };
    }),
  };
  const r = await acceptCanvasBatch(db as never, P, { id }, ownerKey.auth, git);
  assertEquals(r.status, 'waiting');
  const p = proposal(db, id);
  assertEquals([p.status, p.reviewed_at, p.metadata.autoWait], ['rejected', decidedAt, undefined], 'the person\'s decision stands');
});

Deno.test('AL.24 a set-aside never writes over a decision another decider made meanwhile', async () => {
  const db = world();
  const id = file(db, [rename(N2, 'Nothing here')]); // the engine refuses it
  const decidedAt = '2026-10-05T01:00:00.000Z';
  let fired = false;
  // the lease read is the last read before the apply: a person decides then
  const hooked = new Proxy(db, {
    get(target, key) {
      if (key !== 'from') return Reflect.get(target, key);
      return (table: string) => {
        if (table === 'agent_checkouts' && !fired) {
          fired = true;
          Object.assign(proposal(db, id), { status: 'merged', reviewed_at: decidedAt });
        }
        return target.from(table);
      };
    },
  });
  const r = await acceptCanvasBatch(hooked as never, P, { id }, ownerKey.auth, noGit);
  assertEquals(r.status, 'set aside');
  const p = proposal(db, id);
  assertEquals([p.status, p.reviewed_at, p.metadata.resolveNote], ['merged', decidedAt, undefined], 'the other decision stands');
});

Deno.test('AL.24 the merge is written only under the claim that applied it', async () => {
  const db = world();
  const id = file(db, [addNode(N2, 'Pickup Orders Service')]);
  const decidedAt = '2026-10-05T01:00:00.000Z';
  let fired = false;
  // the claim lapsed mid-apply (a stalled worker) and a person rejected it
  const hooked = new Proxy(db, {
    get(target, key) {
      if (key !== 'from') return Reflect.get(target, key);
      return (table: string) => {
        if (table === 'specification_mappings' && !fired) {
          fired = true;
          Object.assign(proposal(db, id), { status: 'rejected', reviewed_at: decidedAt });
        }
        return target.from(table);
      };
    },
  });
  await acceptCanvasBatch(hooked as never, P, { id }, ownerKey.auth, noGit);
  const p = proposal(db, id);
  assertEquals([p.status, p.reviewed_at, p.metadata.auto], ['rejected', decidedAt, undefined], 'the person\'s reject is not overwritten');

  // or another decider holds it now: still pending, under their claim
  const db2 = world();
  const id2 = file(db2, [addNode(N2, 'Pickup Orders Service')]);
  let fired2 = false;
  const hooked2 = new Proxy(db2, {
    get(target, key) {
      if (key !== 'from') return Reflect.get(target, key);
      return (table: string) => {
        if (table === 'specification_mappings' && !fired2) {
          fired2 = true;
          proposal(db2, id2).reviewed_at = decidedAt;
        }
        return target.from(table);
      };
    },
  });
  await acceptCanvasBatch(hooked2 as never, P, { id: id2 }, ownerKey.auth, noGit);
  assertEquals([proposal(db2, id2).status, proposal(db2, id2).reviewed_at], ['pending', decidedAt], 'their claim is theirs to finish');
});

Deno.test('AL.24 a reconcile applied under Auto resolves the change card it answers and moves the last sync', async () => {
  const db = world();
  const card = crypto.randomUUID();
  db.rowsOf('git_change_events').push({ id: card, project_id: P, status: 'pending', commit_sha: HEAD, metadata: {} });
  const id = file(db, [rename(N1, 'Orders Service')], { reconcilesChange: { eventId: card, commitSha: HEAD } });
  const r = await acceptCanvasBatch(db as never, P, { id }, ownerKey.auth, noGit);
  assertEquals(r.status, 'merged', JSON.stringify(r));
  const c = db.rowsOf('git_change_events')[0];
  assertEquals([c.status, (c.metadata as Row).reconciledByProposal, c.resolved_by], ['accepted', id, OWNER]);
  assertEquals(db.rowsOf('branches')[0].last_synced_commit, HEAD);
});

Deno.test('AL.24 resolve_change under Auto: the reconcile applies as it files and the card resolves, through propose_patches itself', async () => {
  const run = async (lastSynced: string | null) => {
    const db = world();
    for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'cloud_provider_patterns', 'scope_archetypes', 'ai_runs', 'stripe_subscriptions', 'project_constraints', 'workflows', 'requirement_candidates', 'artifacts', 'repo_index_files', 'git_integrations']) db.table(t, []);
    db.rowsOf('branches')[0].last_synced_commit = lastSynced;
    db.fn('graph_reference_ids', () => ({ nodes: [N1], contracts: [] }));
    db.rowsOf('git_change_events').push({ id: 'e1', project_id: P, status: 'pending', commit_sha: HEAD, metadata: {} });
    const r = await handleResolveChange(db as never, ownerKey.auth, {
      change_event_id: 'e1', commit_sha: HEAD, resolution: 'accepted',
      patches: [{ type: 'update_node', payload: { id: N1, changes: { label: 'Orders Service' } } }],
    });
    return { db, r: r as { success: boolean; data: { resolution: string; routed: string; message: string; proposalId: string } } };
  };
  // the branch's first sync: the card resolves and the last sync is its commit
  const first = await run(null);
  assertEquals(first.r.success, true, JSON.stringify(first.r));
  assertEquals([first.r.data.routed, first.r.data.resolution], ['applied', 'accepted']);
  assert(first.r.data.message.endsWith('The change resolved.'), first.r.data.message);
  assertEquals(proposal(first.db, first.r.data.proposalId).status, 'merged');
  assertEquals(Object.values(latestGraph(first.db).graph_data.nodes).map((n) => n.label), ['Orders Service']);
  const card = first.db.rowsOf('git_change_events')[0];
  assertEquals([card.status, (card.metadata as Row).reconcileProposalId], ['accepted', first.r.data.proposalId]);
  assertEquals(first.db.rowsOf('branches')[0].last_synced_commit, HEAD);
  // a provider that cannot confirm the move: applied, and the card stays for the person, saying why
  const unsure = await run(OLD);
  assertEquals([unsure.r.data.routed, unsure.r.data.resolution], ['applied', 'pending']);
  assert(unsure.r.data.message.includes('The change card it answers stays pending: The git provider could not confirm'), unsure.r.data.message);
  assertEquals(unsure.db.rowsOf('git_change_events')[0].status, 'pending');
});

// ── the rule, and who it covers ────────────────────────────────────────────

Deno.test('AL.24 the Auto rule: lanes, what is always the person\'s, and who filed it', () => {
  const at = { architecture: 2, requirements: 2, candidates: 2, tasks: 2, tests: 2, code: 0 } as const;
  assertEquals(autoRule({ ...at, architecture: 1 }, ['add_node'], {}, ownerKey), 'off');
  assertEquals(autoRule(at, ['add_node'], {}, ownerKey), null);
  assertEquals(autoRule(at, ['update_vision', 'create_candidate'], {}, ownerKey), null, 'owner ruling: the vision applies too');
  assertEquals(autoRule(at, ['add_node'], { finalization: {} }, ownerKey), 'A repository import is reviewed in its import panel, at every autonomy level.');
  assertEquals(autoRule(at, ['add_node'], { source: 'git-load' }, ownerKey), 'It loads the design from git, which replaces design on the canvas: a load always waits for you.');
  assertEquals(autoRule(at, ['promote_candidate'], {}, ownerKey), 'It promotes, attaches or settles an outcome: that is always your decision.');
  assertEquals(autoRule(at, ['delete_constraint'], {}, ownerKey), 'It changes or retires a constraint: weakening what the build is held to is always your decision.');
  assertEquals(autoRule(at, ['add_node'], {}, { ...ownerKey, write: false, why: 'the key it used was revoked' }), 'Its agent may only propose: the key it used was revoked.');
  assertEquals(autoRule(at, ['add_node'], {}, { ...ownerKey, role: 'maintainer' }), 'Its agent acts for a member who is not the project owner, and a member\'s agent never applies a change: you decide it.');
  assertEquals(autoRule(at, ['add_node'], {}, { ...ownerKey, role: 'maintainer', auth: { ...ownerKey.auth, authMethod: 'jwt' } }), null, 'a maintainer in the app decides');
  assertEquals(autoRule(at, ['add_node'], {}, { ...ownerKey, role: null }), 'Its agent no longer has a seat on this project.');
});

Deno.test('AL.24 the sweep reads who filed each proposal as it stands now: a propose-only key, a revoked key and a member\'s agent wait, each saying why', async () => {
  const db = world();
  db.rowsOf('mcp_api_keys').push({ id: 'a2400000-0000-4000-8000-0000000000b1', user_id: OWNER, scopes: ['read', 'write', 'propose'], revoked_at: T, expires_at: null });
  db.rowsOf('mcp_api_keys').push({ id: 'a2400000-0000-4000-8000-0000000000b2', user_id: MEMBER, scopes: ['read', 'write', 'propose'], revoked_at: null, expires_at: null });
  const proposeOnly = file(db, [addNode(crypto.randomUUID(), 'A')], {}, `key:${PROPOSE_KEY}`);
  const revoked = file(db, [addNode(crypto.randomUUID(), 'B')], {}, 'key:a2400000-0000-4000-8000-0000000000b1');
  const member = file(db, [addNode(crypto.randomUUID(), 'C')], { proposedByUserId: MEMBER }, 'key:a2400000-0000-4000-8000-0000000000b2');
  const swept = await sweepAuto(db as never, P, noGit);
  assertEquals(swept.applied, []);
  const reasons = Object.fromEntries(swept.waiting.map((w) => [w.proposalId, w.reason]));
  assertEquals(reasons[proposeOnly], 'Its agent may only propose: the key it used may only propose.');
  assertEquals(reasons[revoked], 'Its agent may only propose: the key it used was revoked.');
  assertEquals(reasons[member], 'Its agent no longer has a seat on this project.');
  for (const id of [proposeOnly, revoked, member]) {
    assertEquals((proposal(db, id).metadata.autoWait as Row).reason, reasons[id], 'its card says why');
  }
  assertEquals(db.rowsOf('graph_patches').length, 0);
});

Deno.test('AL.24 a credential is read as it stands: a write key, an expired one, an OAuth client by its latest live token, a revoked connection, a person', async () => {
  const db = world();
  db.rowsOf('mcp_api_keys').push({ id: 'a2400000-0000-4000-8000-0000000000c1', user_id: OWNER, scopes: ['read', 'write'], revoked_at: null, expires_at: '2026-01-01T00:00:00Z' });
  db.table('mcp_oauth_tokens', [
    { user_id: OWNER, client_id: 'claude', scopes: ['read', 'write', 'propose'], revoked_at: null, created_at: '2026-09-01T00:00:00Z' },
    { user_id: OWNER, client_id: 'claude', scopes: ['read', 'propose'], revoked_at: null, created_at: '2026-10-01T00:00:00Z' },
  ]);
  assertEquals(await credentialRights(db as never, `key:${KEY}`, null), { userId: OWNER, channel: 'api_key', keyId: KEY, write: true });
  assertEquals((await credentialRights(db as never, 'key:a2400000-0000-4000-8000-0000000000c1', null)).why, 'the key it used has expired');
  assertEquals(await credentialRights(db as never, `oauth:${OWNER}:claude`, null), { userId: OWNER, channel: 'oauth_token', clientId: 'claude', write: false, why: 'its connection may only propose' });
  // a disconnected client: its latest token is revoked, so no write remains
  db.rowsOf('mcp_oauth_tokens').push({ user_id: OWNER, client_id: 'cursor', scopes: ['read', 'write', 'propose'], revoked_at: '2026-10-02T00:00:00Z', created_at: '2026-10-01T00:00:00Z' });
  assertEquals(await credentialRights(db as never, `oauth:${OWNER}:cursor`, null), { userId: OWNER, channel: 'oauth_token', clientId: 'cursor', write: false, why: 'its connection was revoked' });
  assertEquals(await credentialRights(db as never, `user:${OWNER}`, null), { userId: OWNER, channel: 'jwt', write: true });
  const f = await filerFromProposal(db as never, P, OWNER, { credential: `key:${KEY}`, proposedByUserId: OWNER, authMethod: 'api_key' });
  assertEquals([f.role, f.write, f.auth.keyId, f.auth.authMethod], ['owner', true, KEY, 'api_key']);
});

Deno.test('AL.24 resolve_proposal auto is the sweep, the owner\'s to run; a viewer is refused before anything is read', async () => {
  const db = world();
  const id = file(db, [addNode(N2, 'Kitchen printer')]);
  db.rowsOf('project_members').push({ project_id: P, user_id: MEMBER, role: 'viewer' });
  const viewer = await handleResolveProposal(db as never, { userId: MEMBER, authMethod: 'jwt', scopes: ['read', 'write', 'propose'] } as AuthResult, { project_id: P, action: 'auto' });
  assertEquals(viewer.success, false);
  assertEquals(proposal(db, id).status, 'pending');
  const r = await handleResolveProposal(db as never, OWNER_JWT, { project_id: P, action: 'auto' });
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as { applied: Array<{ proposalId: string }>; message: string };
  assertEquals(data.applied.map((a) => a.proposalId), [id]);
  assertEquals(data.message, 'Applied 1 waiting proposal the Auto lanes cover.');
  assertEquals(proposal(db, id).status, 'merged');
  const none = await handleResolveProposal(db as never, OWNER_JWT, { project_id: P, action: 'accept' });
  assertEquals(none, { success: false, error: 'proposal_id is required to accept or reject a proposal.' });
});

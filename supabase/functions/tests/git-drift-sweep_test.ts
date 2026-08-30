// P1-7 R2: the on-connect drift sweep + adopt-on-connect. Pure decision helpers (throttle,
// self-push detection, residue classification) are tested directly; runDriftSweep's early exits
// are exercised over FakeSupabase — every path tested here returns BEFORE any provider fetch, so
// the suite stays fully offline. anchorToPatches is validated against PatchOperationSchema: the
// adopt path must emit patches the normal apply pipeline accepts without special-casing.
import {
  shouldRunSweep,
  isSelfPushOnly,
  classifySweepFiles,
  runDriftSweep,
  SWEEP_THROTTLE_MS,
  SELF_PUSH_PREFIX,
  type ChangedFile,
} from '../_shared/git-drift.ts';
import { serializeModel, parseModel, anchorToPatches } from '../_shared/model-anchor.ts';
import { PatchOperationSchema } from '../_shared/patch-schema.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

// ── pure sweep decision helpers ───────────────────────────────────────────────────────

Deno.test('shouldRunSweep: null/invalid baseline always sweeps; throttle window holds', () => {
  const now = 1_000_000_000_000;
  assert(shouldRunSweep(null, now), 'never checked → sweep');
  assert(shouldRunSweep(undefined, now), 'undefined → sweep');
  assert(shouldRunSweep('garbage-timestamp', now), 'unparseable → sweep');
  const recent = new Date(now - SWEEP_THROTTLE_MS + 5_000).toISOString();
  assert(!shouldRunSweep(recent, now), 'inside throttle window → skip');
  const stale = new Date(now - SWEEP_THROTTLE_MS - 5_000).toISOString();
  assert(shouldRunSweep(stale, now), 'outside throttle window → sweep');
});

Deno.test('isSelfPushOnly: all-NodeSpec ranges fast-forward; mixed or empty do not', () => {
  const self = (n: number) => ({ message: `${SELF_PUSH_PREFIX} push ${n}` });
  assert(isSelfPushOnly([self(1), self(2)]), 'all self-pushes');
  assert(!isSelfPushOnly([]), 'empty range is NOT self-push (nothing to attribute)');
  assert(!isSelfPushOnly([self(1), { message: 'fix: hand-edited hotfix' }]), 'mixed range');
  assert(!isSelfPushOnly([{ message: 'feat: out-of-band work' }]), 'external only');
});

Deno.test('classifySweepFiles: anchor flags modelChanged; matched/removed/system paths are not residue', () => {
  const files: ChangedFile[] = [
    { path: '.nodespec/model.json', action: 'modified' },
    { path: 'ARCHITECTURE.md', action: 'modified' },
    { path: 'src/api/index.ts', action: 'modified' },   // matched artifact
    { path: 'src/api/old.ts', action: 'removed' },      // removals are not residue
    { path: 'services/new-svc/main.go', action: 'added' }, // true residue
  ];
  const { modelChanged, residuePaths } = classifySweepFiles(files, new Set(['src/api/index.ts']));
  assert(modelChanged, 'anchor change detected');
  assertEquals(residuePaths, ['services/new-svc/main.go'], 'only the unattributed added path');

  // R7c added `specChanged` — the spec plane is a SEPARATE question from the
  // architecture, so this whole-object pin gained a third field.
  const clean = classifySweepFiles([{ path: 'src/api/index.ts', action: 'modified' }], new Set(['src/api/index.ts']));
  assertEquals(clean, { modelChanged: false, specChanged: false, residuePaths: [] });
});

Deno.test('moved files: artifact bound to the OLD path matches as a move, not residue', async () => {
  const sb = new FakeSupabase();
  const graph = {
    nodes: { [N2]: { id: N2, type: 'backend-service', label: 'API' } },
    artifacts: { [A1]: { id: A1, nodeId: N2, path: 'src/api/index.ts', kind: 'source' } },
    edges: {}, contracts: {},
  };
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: graph }, error: null });

  const files: ChangedFile[] = [
    { path: 'src/api/v2/index.ts', action: 'modified', oldPath: 'src/api/index.ts' }, // git-side move
    { path: 'src/other/new.ts', action: 'added' },                                     // true residue
  ];
  const { matchFilesToArtifacts } = await import('../_shared/git-drift.ts');
  const r = await matchFilesToArtifacts(sb as never, 'proj-1', files);
  assertEquals(r.matches.length, 1, 'old-path binding recognized');
  assertEquals(r.matches[0].path, 'src/api/v2/index.ts', 'match reports the NEW location');
  assertEquals(r.matches[0].movedFrom, 'src/api/index.ts', 'and carries where it moved from');

  // The moved file's new path is matched, so classification must not call it residue.
  const { residuePaths } = classifySweepFiles(files, new Set(r.matches.map((m) => m.path)));
  assertEquals(residuePaths, ['src/other/new.ts'], 'only the genuinely unattributed path');
});

// ── runDriftSweep early exits (offline: each path returns before any provider fetch) ──

Deno.test('runDriftSweep: no integration → no_integration, nothing else touched', async () => {
  const sb = new FakeSupabase();
  sb.script('git_integrations', 'select', { data: null, error: null });
  const r = await runDriftSweep(sb as never, 'proj-1');
  assertEquals(r.status, 'no_integration');
  assertEquals(sb.callsTo('branches').length, 0, 'never reached the branch lookup');
});

Deno.test('runDriftSweep: recent check → throttled, throttle claim NOT rewritten', async () => {
  const sb = new FakeSupabase();
  sb.script('git_integrations', 'select', {
    data: { id: 'int-1', provider: 'github', repo_owner: 'o', repo_name: 'r', default_branch: 'main', base_url: null, access_token_encrypted: 'tok', last_drift_check_at: new Date().toISOString() },
    error: null,
  });
  const r = await runDriftSweep(sb as never, 'proj-1');
  assertEquals(r.status, 'throttled');
  assertEquals(sb.callsTo('git_integrations', 'update').length, 0, 'throttled exit precedes the claim write');
});

Deno.test('runDriftSweep: bound branch without baseline → unbaselined, after WINNING the atomic claim', async () => {
  const sb = new FakeSupabase();
  sb.script('git_integrations', 'select', {
    data: { id: 'int-1', provider: 'github', repo_owner: 'o', repo_name: 'r', default_branch: 'main', base_url: null, access_token_encrypted: 'tok', last_drift_check_at: null },
    error: null,
  });
  sb.script('git_integrations', 'update', { data: [{ id: 'int-1' }], error: null }); // claim won
  sb.script('branches', 'select', { data: { id: 'b1', git_ref: 'main', last_synced_commit: null }, error: null });

  const r = await runDriftSweep(sb as never, 'proj-1');
  assertEquals(r.status, 'unbaselined');

  const claim = sb.callsTo('git_integrations', 'update');
  assertEquals(claim.length, 1, 'throttle slot claimed exactly once');
  assert(
    claim[0].filters.some((f) => f.method === 'eq' && f.args[0] === 'id' && f.args[1] === 'int-1'),
    'claim scoped to the integration row',
  );
  assert(
    claim[0].filters.some((f) => f.method === 'is' && f.args[0] === 'last_drift_check_at' && f.args[1] === null),
    'claim is compare-and-set against the value we read (null → IS NULL guard)',
  );
  const branchCall = sb.callsTo('branches', 'select')[0];
  assert(
    branchCall.filters.some((f) => f.method === 'eq' && f.args[0] === 'name' && f.args[1] === 'main'),
    'main branch resolved by name (never is_main)',
  );
});

Deno.test('runDriftSweep: losing the claim race → throttled, sweep goes no further (no duplicate cards)', async () => {
  const sb = new FakeSupabase();
  sb.script('git_integrations', 'select', {
    data: { id: 'int-1', provider: 'github', repo_owner: 'o', repo_name: 'r', default_branch: 'main', base_url: null, access_token_encrypted: 'tok', last_drift_check_at: null },
    error: null,
  });
  sb.script('git_integrations', 'update', { data: [], error: null }); // another sweep claimed first

  const r = await runDriftSweep(sb as never, 'proj-1');
  assertEquals(r.status, 'throttled');
  assertEquals(sb.callsTo('branches').length, 0, 'loser never proceeds to the branch lookup');
  assertEquals(sb.callsTo('git_change_events').length, 0, 'loser can never create an event');
});

// ── one cumulative card, and healing of race-created duplicates ───────────────────────

const SWEEP_META = { source: 'sweep', branch: 'main', baseSha: 'base1' };

Deno.test('upsertCumulativeSweepEvent: no existing card → insert one pending event', async () => {
  const { upsertCumulativeSweepEvent } = await import('../_shared/git-drift.ts');
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', { data: [], error: null });
  sb.script('git_change_events', 'insert', { data: { id: 'ev-new' }, error: null });

  const id = await upsertCumulativeSweepEvent(sb as never, {
    integrationId: 'int-1', projectId: 'proj-1', headSha: 'head2', summary: 's',
    files: [], metadata: SWEEP_META,
  });
  assertEquals(id, 'ev-new');
  assertEquals(sb.callsTo('git_change_events', 'insert').length, 1);
  assertEquals(sb.callsTo('git_change_events', 'update').length, 0);
});

Deno.test('upsertCumulativeSweepEvent: existing card → superseded in place, never a second insert', async () => {
  const { upsertCumulativeSweepEvent } = await import('../_shared/git-drift.ts');
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', { data: [{ id: 'ev-1', metadata: SWEEP_META }], error: null });

  const id = await upsertCumulativeSweepEvent(sb as never, {
    integrationId: 'int-1', projectId: 'proj-1', headSha: 'head3', summary: '2 commits',
    files: [{ path: 'a.ts', action: 'modified' }], metadata: SWEEP_META,
  });
  assertEquals(id, 'ev-1');
  assertEquals(sb.callsTo('git_change_events', 'insert').length, 0, 'cumulative, not stacking');
  const upd = sb.callsTo('git_change_events', 'update');
  assertEquals(upd.length, 1);
  assert((upd[0].payload as { commit_sha: string }).commit_sha === 'head3', 'card advanced to the new HEAD');
});

Deno.test('upsertCumulativeSweepEvent: race-created duplicates are healed — one survivor, extras dismissed', async () => {
  const { upsertCumulativeSweepEvent } = await import('../_shared/git-drift.ts');
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', {
    data: [
      { id: 'ev-1', metadata: SWEEP_META },
      { id: 'ev-dup', metadata: SWEEP_META },
      { id: 'ev-webhook', metadata: { source: 'webhook' } }, // untouched — not a sweep card
    ],
    error: null,
  });

  const id = await upsertCumulativeSweepEvent(sb as never, {
    integrationId: 'int-1', projectId: 'proj-1', headSha: 'head4', summary: 's',
    files: [], metadata: SWEEP_META,
  });
  assertEquals(id, 'ev-1', 'first card survives');
  const updates = sb.callsTo('git_change_events', 'update');
  assertEquals(updates.length, 2, 'one dismissal + one supersede');
  const dismissal = updates.find((u) => (u.payload as { status?: string }).status === 'dismissed');
  assert(dismissal, 'duplicate auto-dismissed');
  assert(
    dismissal!.filters.some((f) => f.method === 'eq' && f.args[1] === 'ev-dup'),
    'dismissal targets the duplicate, never the webhook event',
  );
  assertEquals(
    (dismissal!.payload as { metadata: { supersededBy: string } }).metadata.supersededBy,
    'ev-1',
  );
});

// ── anchorToPatches: adoption emits pipeline-valid patches in dependency order ─────────

const N1 = '11111111-1111-4111-8111-111111111111';
const N2 = '22222222-2222-4222-8222-222222222222';
const N0 = '00000000-aaaa-4aaa-8aaa-000000000000'; // child with id BEFORE its parent (order test)
const E1 = '33333333-3333-4333-8333-333333333333';
const C1 = '44444444-4444-4444-8444-444444444444';
const A1 = '55555555-5555-4555-8555-555555555555';
const P1 = '66666666-6666-4666-8666-666666666666';
const P2 = '77777777-7777-4777-8777-777777777777';

function adoptGraph() {
  return {
    nodes: {
      [N1]: { id: N1, type: 'frontend-app', technology: 'react', label: 'Web', ports: [{ id: P1, name: 'out', direction: 'out' }] },
      [N2]: { id: N2, type: 'backend-service', technology: 'express', label: 'API', ports: [{ id: P2, name: 'in', direction: 'in' }] },
      [N0]: { id: N0, type: 'backend-service', label: 'Worker', parentId: N2, ports: [] },
    },
    edges: { [E1]: { id: E1, source: N1, target: N2, contractId: C1, sourcePortId: P1, targetPortId: P2, label: 'calls' } },
    contracts: { [C1]: { id: C1, kind: 'rest', name: 'Web to API' } },
    artifacts: { [A1]: { id: A1, nodeId: N2, path: '/src/api/index.ts', kind: 'source' } },
  };
}

Deno.test('anchorToPatches: every patch validates against PatchOperationSchema', async () => {
  const parsed = parseModel(await serializeModel(adoptGraph()));
  assert(parsed.ok, 'anchor parses');
  const patches = anchorToPatches(parsed.model);
  assertEquals(patches.length, 6, '1 contract + 3 nodes + 1 edge + 1 artifact');
  for (const p of patches) {
    const v = PatchOperationSchema.safeParse(p);
    assert(v.success, `patch ${p.type} must satisfy the apply pipeline schema: ${v.success ? '' : JSON.stringify(v.error.issues)}`);
  }
});

Deno.test('anchorToPatches: dependency order — contracts, then parents before children, edges, artifacts', async () => {
  const parsed = parseModel(await serializeModel(adoptGraph()));
  assert(parsed.ok);
  const patches = anchorToPatches(parsed.model);
  assertEquals(patches.map((p) => p.type), [
    'add_contract', 'add_node', 'add_node', 'add_node', 'add_edge', 'add_artifact',
  ]);
  const nodeIds = patches.filter((p) => p.type === 'add_node').map((p) => p.payload.id);
  assert(
    nodeIds.indexOf(N2) < nodeIds.indexOf(N0),
    'parent N2 applied before child N0 even though the child id sorts first',
  );
  const adopted = patches.find((p) => p.type === 'add_node');
  assertEquals(adopted?.payload.status, 'draft', 'adopted nodes land as drafts');
  assertEquals(adopted?.metadata.actorType, 'system');
  assertEquals(adopted?.metadata.actorId, 'git-adopt');
});

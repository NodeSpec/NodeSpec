// V3 AD.1b (owner 2026-09-24): NodeSpec knows its own commits by recorded sha
// and blob, a push never writes over a file git changed since the last sync,
// and the baseline follows a push only when the push was built on it.
// Findings D1, D2 and D12 on board section AD; invariants I4 and I9.
import {
  gitBlobSha, splitOwnChanges, foreignPaths, planPush, planAttempt, baselineAfterPush,
  loadNodeSpecPushes, readRange, SKIP_REASON, type NodeSpecPush,
} from '../_shared/push-plan.ts';
import { FakeSupabase, MemorySupabase, migrationColumns, assert, assertEquals } from './helpers.ts';

// ── git's own blob ids ───────────────────────────────────────────────────────

Deno.test('AD.1 (I9): a blob id is the one git computes', async () => {
  assertEquals(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assertEquals(await gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assertEquals(await gitBlobSha('café\n'), '572eb43fe8e34fb87d01c69e01151ff696022924', 'bytes, not characters');
});

// ── own or foreign ───────────────────────────────────────────────────────────

const OWN: NodeSpecPush[] = [{ sha: 's1', branchId: 'b1', blobs: { 'src/a.ts': 'blobA', '.nodespec/model.json': 'blobM' }, deleted: ['old.ts'] }];

Deno.test('AD.1 (I9): a file is NodeSpec\'s only when its head blob is one NodeSpec wrote', () => {
  const { foreign, own } = splitOwnChanges([
    { path: 'src/a.ts', action: 'modified', blob: 'blobA' },          // NodeSpec's
    { path: '.nodespec/model.json', action: 'modified', blob: 'X' },  // edited since: foreign
    { path: 'src/b.ts', action: 'added', blob: 'blobB' },             // never written: foreign
    { path: 'src/c.ts', action: 'modified' },                         // no blob given: foreign
    { path: 'old.ts', action: 'removed' },                            // NodeSpec deleted it
    { path: 'gone.ts', action: 'removed' },                           // someone else did
    { path: 'src/new.ts', action: 'modified', oldPath: 'src/a.ts', blob: 'blobA' }, // a move: foreign
  ], OWN);
  assertEquals(own.map((f) => f.path), ['src/a.ts', 'old.ts']);
  assertEquals(foreign.map((f) => f.path), ['.nodespec/model.json', 'src/b.ts', 'src/c.ts', 'gone.ts', 'src/new.ts']);
  assertEquals([...foreignPaths(foreign)].sort(), ['.nodespec/model.json', 'gone.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/new.ts'],
    'a move touches both ends');
});

// ── the plan ─────────────────────────────────────────────────────────────────

Deno.test('AD.1 (I4, D1): a push never writes or deletes a file git changed since the baseline, reference files included', () => {
  const plan = planPush({
    files: [
      { path: 'src/a.ts', content: 'a' },
      { path: 'src/b.ts', content: 'b' },
      { path: '.nodespec/BOARD.md', content: 'board' },
      { path: '.nodespec/spec.json', content: '{}' },
    ],
    stalePaths: ['src/old.ts', 'src/b-old.ts'],
    foreign: new Set(['src/b.ts', '.nodespec/BOARD.md', '.nodespec/spec.json', 'src/b-old.ts']),
  });
  assertEquals(plan.write.map((f) => f.path), ['src/a.ts']);
  assertEquals(plan.deletions, ['src/old.ts']);
  assertEquals(plan.skipped.map((s) => s.path), ['src/b.ts', '.nodespec/BOARD.md', '.nodespec/spec.json', 'src/b-old.ts']);
  assert(plan.skipped.every((s) => s.reason === SKIP_REASON));
});

Deno.test('AD.1: with nothing foreign, a push writes and deletes everything it planned', () => {
  const plan = planPush({ files: [{ path: 'x', content: '1' }], stalePaths: ['y'], foreign: new Set() });
  assertEquals(plan, { write: [{ path: 'x', content: '1' }], skipped: [], deletions: ['y'] });
});

Deno.test('AD.1 (D2): the baseline follows a push only when the push was built on it', () => {
  assertEquals(baselineAfterPush({ baseline: 'B', parent: 'B', newSha: 'N', unchanged: false }), { move: true, reason: 'built-on-baseline' });
  assertEquals(baselineAfterPush({ baseline: 'B', parent: 'F', newSha: 'N', unchanged: false }), { move: false, reason: 'foreign-commits-between' });
  assertEquals(baselineAfterPush({ baseline: null, parent: 'F', newSha: 'N', unchanged: false }), { move: true, reason: 'first' });
  assertEquals(baselineAfterPush({ baseline: 'B', parent: 'B', newSha: 'B', unchanged: true }), { move: false, reason: 'same' });
  assertEquals(baselineAfterPush({ baseline: 'B', parent: 'F', newSha: 'F', unchanged: true }), { move: false, reason: 'foreign-commits-between' },
    'an unchanged push onto foreign commits never claims them');
});

// ── the record ───────────────────────────────────────────────────────────────

Deno.test('AD.1 (I9): only recorded, not-failed NodeSpec pushes count', async () => {
  const sb = new FakeSupabase();
  sb.script('git_sync_log', 'select', {
    data: [
      { commit_sha: 's1', branch_id: 'b1', status: 'success', metadata: { nodespecPush: true, blobs: { a: 'x' }, deleted: [] } },
      { commit_sha: 's2', branch_id: 'b1', status: 'pending', metadata: { nodespecPush: true, blobs: {}, deleted: ['d'] } },
      { commit_sha: 's3', branch_id: 'b1', status: 'failed', metadata: { nodespecPush: true, blobs: {} } },
      { commit_sha: 's4', branch_id: 'b1', status: 'success', metadata: { unchanged: true } },
    ],
  });
  const pushes = await loadNodeSpecPushes(sb, 'int-1', ['s1', 's2', 's3', 's4']);
  assertEquals(pushes.map((p) => p.sha), ['s1', 's2'], 'a pending record counts (written before the ref moves); a failed or unchanged one never');
  assertEquals((await loadNodeSpecPushes(new FakeSupabase(), 'int-1', [])).length, 0);
});

async function withFetch<T>(respond: (url: string, init?: RequestInit) => Response, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(respond(String(input instanceof Request ? input.url : input), init))) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = real; }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const RANGE = { provider: 'github', apiBase: 'https://api', owner: 'o', repo: 'r', token: 't', integrationId: 'int-1', branchId: 'b1', base: 'B', head: 'H' };

Deno.test('AD.1: the range splits NodeSpec\'s writing from this branch out of what git changed', async () => {
  const sb = new FakeSupabase();
  sb.script('git_sync_log', 'select', {
    data: [
      { commit_sha: 'n1', branch_id: 'b1', status: 'success', metadata: { nodespecPush: true, blobs: { 'src/a.ts': 'blobA' }, deleted: [] } },
      { commit_sha: 'n2', branch_id: 'other', status: 'success', metadata: { nodespecPush: true, blobs: { 'src/b.ts': 'blobB' }, deleted: [] } },
    ],
  });
  const range = await withFetch(() => json({
    status: 'ahead',
    files: [
      { filename: 'src/a.ts', status: 'modified', sha: 'blobA' },
      { filename: 'src/b.ts', status: 'modified', sha: 'blobB' },
      { filename: 'src/c.ts', status: 'added', sha: 'blobC' },
    ],
    commits: [{ sha: 'n1', commit: { message: 'x' }, parents: [{}] }, { sha: 'n2', commit: { message: 'y' }, parents: [{}] }, { sha: 'f1', commit: { message: 'Update from NodeSpec: spoof' }, parents: [{}] }],
  }), () => readRange(sb, RANGE));
  assert(range.ok);
  if (!range.ok) return;
  assertEquals(range.own.map((f) => f.path), ['src/a.ts']);
  assertEquals(range.foreign.map((f) => f.path), ['src/b.ts', 'src/c.ts'], 'another branch\'s writing is foreign here');
  assertEquals([...range.recorded].sort(), ['n1', 'n2'], 'the spoofed message is not recorded');
});

Deno.test('AD.1: a range the provider cannot compare is unknown, never empty', async () => {
  const range = await withFetch(() => json({}, 404), () => readRange(new FakeSupabase(), RANGE));
  assertEquals(range.ok, false);
});

Deno.test('AD.1: GitLab blobs come from the files API where its compare gives none', async () => {
  const sb = new FakeSupabase();
  sb.script('git_sync_log', 'select', {
    data: [{ commit_sha: 'n1', branch_id: 'b1', status: 'success', metadata: { nodespecPush: true, blobs: { 'src/a.ts': 'blobA' }, deleted: [] } }],
  });
  const range = await withFetch((url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'x-gitlab-blob-id': 'blobA' } });
    return json({ diffs: [{ new_path: 'src/a.ts', old_path: 'src/a.ts' }, { new_path: 'src/z.ts', old_path: 'src/z.ts', new_file: true }], commits: [{ id: 'n1', parent_ids: ['B'] }] });
  }, () => readRange(sb, { ...RANGE, provider: 'gitlab' }));
  assert(range.ok);
  if (!range.ok) return;
  assertEquals(range.own.map((f) => f.path), ['src/a.ts']);
  assertEquals(range.foreign.map((f) => f.path), ['src/z.ts']);
});

Deno.test('AD.1 (D12): a squash or rebase of NodeSpec\'s writing from another branch arrives as a merge; a spoofed message never does', async () => {
  // Bench 2026-09-25: a MemorySupabase applies the filters, so the feature
  // push is found only if it is looked up by blob: its commit (w1) is not in
  // the range, which holds the squash or rebase commit git minted.
  const log = () => {
    // The table's real columns: a query on one it lacks fails, as it does live.
    const sb = new MemorySupabase().columns('git_sync_log', migrationColumns('git_sync_log'));
    sb.table('git_sync_log', [
      { id: 'l1', integration_id: 'int-1', direction: 'push', commit_sha: 'w1', branch_id: 'feature', status: 'success', started_at: '2026-09-25T10:00:00Z', metadata: { nodespecPush: true, blobs: { 'src/a.ts': 'blobA', '.nodespec/model.json': 'blobM' }, deleted: [] } },
      { id: 'l2', integration_id: 'int-1', direction: 'push', commit_sha: 'm0', branch_id: 'b1', status: 'success', started_at: '2026-09-25T09:00:00Z', metadata: { nodespecPush: true, blobs: { 'src/old.ts': 'blobOld' }, deleted: [] } },
      { id: 'l3', integration_id: 'int-2', direction: 'push', commit_sha: 'x1', branch_id: 'elsewhere', status: 'success', started_at: '2026-09-25T11:00:00Z', metadata: { nodespecPush: true, blobs: { 'src/z.ts': 'blobZ' }, deleted: [] } },
    ]);
    return sb;
  };
  for (const minted of [['squash1'], ['rebase1', 'rebase2']]) {
    const merged = await withFetch(() => json({
      files: [{ filename: 'src/a.ts', status: 'modified', sha: 'blobA' }, { filename: '.nodespec/model.json', status: 'modified', sha: 'blobM' }],
      commits: minted.map((sha) => ({ sha, commit: { message: 'Design push (#12)' } })),
    }), () => readRange(log(), RANGE));
    assert(merged.ok, 'compared');
    if (!merged.ok) return;
    assertEquals(merged.foreign.length, 2, 'not this branch\'s own writing');
    assertEquals(merged.foreignAnyBranch.length, 0, `but NodeSpec's from another branch, so a merge arrived (${minted.join(', ')})`);
  }

  const notOurs = await withFetch(() => json({
    files: [{ filename: 'src/old.ts', status: 'modified', sha: 'blobOld' }, { filename: 'src/z.ts', status: 'modified', sha: 'blobZ' }],
    commits: [{ sha: 'r1', commit: { message: 'revert' } }],
  }), () => readRange(log(), RANGE));
  assert(notOurs.ok, 'compared');
  if (!notOurs.ok) return;
  assertEquals(notOurs.foreignAnyBranch.map((f) => f.path), ['src/old.ts', 'src/z.ts'],
    'content this branch wrote before, and another integration\'s pushes, are not a merge arriving');

  const faked = await withFetch(() => json({
    files: [{ filename: 'src/a.ts', status: 'modified', sha: 'agentEdit' }],
    commits: [{ sha: 'f1', commit: { message: 'Update from NodeSpec: 3 files from main' } }],
  }), () => readRange(log(), RANGE));
  assert(faked.ok, 'compared');
  if (!faked.ok) return;
  assertEquals(faked.foreignAnyBranch.map((f) => f.path), ['src/a.ts'], 'the message counts for nothing');
});

Deno.test('AD.1b x B3: the bindings manifest derived from the head it builds on is written even though git changed it', () => {
  const files = [{ path: '.nodespec/bindings.json', content: '{}' }, { path: 'src/a.ts', content: 'x' }];
  const foreign = new Set(['.nodespec/bindings.json', 'src/a.ts']);
  const merged = planPush({ files, stalePaths: [], foreign, mergedAtHead: new Set(['.nodespec/bindings.json']) });
  assertEquals(merged.write.map((f) => f.path), ['.nodespec/bindings.json']);
  assertEquals(merged.skipped.map((f) => f.path), ['src/a.ts'], 'everything else git changed is still skipped');
  const readElsewhere = planPush({ files, stalePaths: [], foreign });
  assertEquals(readElsewhere.write, [], 'without the head match it is skipped like any file');
});

// Bench 2026-09-28 (bindings-edge-cases): the manifest was read at a head taken
// before the push loop and the commit built on a later one, so the author's
// cleaned manifest was read as its flagged body and never rewritten.
const MANIFEST = '.nodespec/bindings.json';
const OLD_HEAD = 'a'.repeat(40);
const NEW_HEAD = 'b'.repeat(40);
const BOUND = { path: 'src/api/index.ts', node: 'API Service', kind: 'source' };
const DIRTY = JSON.stringify({ version: 1, bindings: [BOUND, { path: 'docs/fake.task.md', node: 'API Service', kind: 'task' }] });
const CLEAN = JSON.stringify({ version: 1, bindings: [BOUND] });

function attempt(head: string | null, manifests: Record<string, string>, reads: string[] = []) {
  return planAttempt({
    files: [{ path: 'src/a.ts', content: 'x' }],
    stalePaths: [],
    foreign: head ? new Set([MANIFEST]) : new Set(),
    head,
    ref: 'main',
    boundPaths: new Set(['src/api/index.ts']),
    readManifest: (at) => { reads.push(at); return Promise.resolve(manifests[at] ?? null); },
  });
}

Deno.test('AD.1b x B3: an attempt reads the manifest at the head it builds on and writes it although git changed it', async () => {
  // The ref name still serves the older body; the sha the commit builds on holds the cleaned one.
  const reads: string[] = [];
  const plan = await attempt(NEW_HEAD, { [OLD_HEAD]: DIRTY, main: DIRTY, [NEW_HEAD]: CLEAN }, reads);
  assertEquals(reads, [NEW_HEAD], 'read once, at the head the commit builds on');
  const manifest = plan.write.find((f) => f.path === MANIFEST);
  assert(manifest, 'the consumed declaration is written out');
  assertEquals(JSON.parse(manifest.content).bindings, [], 'the file is the empty envelope');
  assertEquals(plan.skipped, [], 'written although git changed it: it keeps what git changed');
});

Deno.test('AD.1b x B3: at a head whose manifest has a flagged row, the file is left alone', async () => {
  const plan = await attempt(OLD_HEAD, { [OLD_HEAD]: DIRTY, [NEW_HEAD]: CLEAN });
  assertEquals(plan.write.map((f) => f.path), ['src/a.ts']);
});

Deno.test('AD.1b x B3: a first push reads by the ref name; a failed read never fails the push', async () => {
  const reads: string[] = [];
  const first = await attempt(null, { main: CLEAN }, reads);
  assertEquals(reads, ['main']);
  assert(first.write.some((f) => f.path === MANIFEST));
  const failed = await planAttempt({
    files: [{ path: 'src/a.ts', content: 'x' }], stalePaths: [], foreign: new Set([MANIFEST]), head: NEW_HEAD, ref: 'main',
    boundPaths: new Set(['src/api/index.ts']), readManifest: () => Promise.reject(new Error('provider down')),
  });
  assertEquals(failed.write.map((f) => f.path), ['src/a.ts']);
});

// ── the push and the sync check use all of it ────────────────────────────────

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

Deno.test('AD.1 (D1, I4): the push reads the range, puts it on a card, and writes only the plan', () => {
  const push = src('../git-push/index.ts');
  const preflight = push.slice(push.indexOf('for (let attempt = 0; attempt < 2 && !pushResult; attempt++)'), push.indexOf('if (!pushResult) {'));
  assert(preflight.indexOf('readRange(serviceClient') > 0, 'the range is read');
  assert(/if \(!range\.ok\)[\s\S]{0,400}409/.test(preflight), 'an unknown range writes nothing');
  assert(preflight.indexOf('runDriftSweep(serviceClient') < preflight.indexOf('pushToGitHub('), 'the change is on its card first');
  assert(/planAttempt\(\{\s*files, stalePaths, foreign, head,/.test(preflight), 'each attempt plans at the head it read');
  // AD.4: on the head that was read, or the open pull request's work branch head.
  assert(/commitMessageFor\(plan\.write\.length\), plan\.write, plan\.deletions, buildOn, record/.test(preflight), 'GitHub builds on the head that was read');
  assert(/let buildOn: string \| null = head;/.test(preflight), 'the tracked head unless a pull request is open');
  assert(/if \(attemptResult\.moved\)[\s\S]{0,300}continue;/.test(preflight), 'a moved branch reruns the preflight');
});

Deno.test('AD.1 (I9, D12): NodeSpec records its commit before the ref moves, and never claims an unchanged head', () => {
  const push = src('../git-push/index.ts');
  const gh = push.slice(push.indexOf('async function pushToGitHub('), push.indexOf('async function pushToGitLab('));
  assert(gh.indexOf('await onCommitCreated(') > 0 && gh.indexOf('await onCommitCreated(') < gh.indexOf('git/refs/heads/${branch}`, {\n      method: "PATCH"'),
    'recorded before the PATCH');
  assert(!gh.includes('_staleHeadRetry'), 'no silent rebuild on a fresh head');
  assert(/metadata: \{\s*nodespecPush: true, parent, blobs, deleted: deletedPaths,/.test(push), 'the push record');
  assert(/unchanged \? \{ unchanged: true \} : \{ nodespecPush: true/.test(push), 'an unchanged push records no NodeSpec commit');
  assert(/baselineAfterPush\(\{ baseline: baselineAtStart, parent: pushResult\.parent, newSha: commitSha, unchanged \}\)/.test(push));
});

Deno.test('AD.1 (D12): the sync check drops NodeSpec\'s own writing and judges merges by blob', () => {
  const drift = src('../_shared/git-drift.ts');
  const sweep = drift.slice(drift.indexOf('export async function runDriftSweep('), drift.indexOf('// ── R7c: plane-aware card resolution'));
  assert(sweep.includes('await readRange(supabase'), 'the range is read with NodeSpec\'s writing told apart');
  assert(/range\.ok && range\.foreign\.length === 0[\s\S]{0,400}advanceBaseline/.test(sweep), 'all own: forward, nothing to review');
  assert(sweep.includes('if (range.ok && range.foreignAnyBranch.length === 0) {'), 'a merge arrives by blob');
  assert(!sweep.includes('isNodeSpecMergeArrival('), 'never by message');
  assert(/const files: ChangedFile\[\] = range\.ok \? range\.foreign : \[\];/.test(sweep), 'only foreign files reach the card');
});

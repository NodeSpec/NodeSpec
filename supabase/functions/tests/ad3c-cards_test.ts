// V3 AD.3c (owner 2026-09-24, finding D23): a change card says who. The sync
// check groups the card's files by the author of the commits that changed
// them (commits NodeSpec did not write, newest first, capped), the held-work
// warning names the holder only for someone else's commits (a holder's own
// reported commits are its work, not a collision), and a heartbeat keeps
// every commit its holder reports.
import { groupFilesByAuthor, authorLine, UNKNOWN_AUTHOR } from '../_shared/commit-authors.ts';
import { collisionsBetween, ownCommits } from '../_shared/lease-collisions.ts';
import { fetchCompare, fetchCommitFiles } from '../_shared/git-provider.ts';
import { upsertCumulativeSweepEvent } from '../_shared/git-drift.ts';
import { handleCheckoutHeartbeat } from '../mcp-server/tools/checkouts.ts';
import { handleGetPendingChanges } from '../mcp-server/tools/git.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

const MINE_SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const THEIRS_SHA = 'f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1';

// ── grouping ─────────────────────────────────────────────────────────────

Deno.test('AD.3c: files are grouped by the author of the commits that changed them; nothing is guessed', () => {
  const r = groupFilesByAuthor([
    { sha: 'c1', author: 'alice', files: ['src/a.ts', 'README.md'] },
    { sha: 'c2', author: 'claude-agent', files: ['src/b.ts'] },
    { sha: 'c3', author: 'alice', files: ['src/b.ts'] },
    { sha: 'c4', author: null, files: ['src/c.ts'] },
    { sha: 'c5', author: 'bob', files: null }, // the provider could not say
  ], ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
  assertEquals(r.authors, [
    { author: 'alice', commits: ['c1', 'c3'], files: ['src/a.ts', 'src/b.ts'] },
    { author: 'claude-agent', commits: ['c2'], files: ['src/b.ts'] },
    { author: UNKNOWN_AUTHOR, commits: ['c4'], files: ['src/c.ts'] },
  ]);
  assertEquals(r.unattributed, ['src/d.ts'], 'no read commit accounts for it');
  assertEquals(authorLine(r.authors), 'alice and 2 more');
  assertEquals(authorLine([r.authors[0]]), 'alice');
  assertEquals(authorLine([]), null);
});

// ── the held-work warning ────────────────────────────────────────────────

const lease = (meta: Record<string, unknown>) => ({
  id: 'L1', level: 'code', holder_label: 'claude · api', task_item_id: null, artifact_id: 'A1', meta,
});
const artifacts = [{ id: 'A1', node_id: 'N1', path: 'src/api.ts' }];
const change = (authors: Array<{ author: string; commits: string[]; files: string[] }> | null) => ({
  changeEventId: 'E1', commitSha: THEIRS_SHA, author: 'alice', changedFiles: [{ path: 'src/api.ts' }], authors,
});

Deno.test('AD.3c: a holder\'s own reported commit on its held file is its work, not a collision', () => {
  const own = collisionsBetween([change([{ author: 'claude-agent', commits: [MINE_SHA], files: ['src/api.ts'] }])],
    [lease({ commits: [MINE_SHA.slice(0, 7)] })], [], artifacts);
  assertEquals(own, []);
  const viaHeartbeat = collisionsBetween([change([{ author: 'claude-agent', commits: [MINE_SHA], files: ['src/api.ts'] }])],
    [lease({ commitSha: MINE_SHA })], [], artifacts);
  assertEquals(viaHeartbeat, [], 'the heartbeat\'s commitSha counts');
  const viaEvidence = collisionsBetween([change([{ author: 'claude-agent', commits: [MINE_SHA], files: ['src/api.ts'] }])],
    [lease({ verified: { commitSha: MINE_SHA } })], [], artifacts);
  assertEquals(viaEvidence, [], 'and so does the verified exit\'s');
});

Deno.test('AD.3c: someone else\'s commit on a held file is a collision that names them', () => {
  const r = collisionsBetween([change([
    { author: 'claude-agent', commits: [MINE_SHA], files: ['src/api.ts'] },
    { author: 'alice', commits: [THEIRS_SHA], files: ['src/api.ts'] },
  ])], [lease({ commits: [MINE_SHA] })], [], artifacts);
  assertEquals(r.length, 1);
  assertEquals(r[0].by, ['alice']);
  assertEquals(r[0].holder, 'claude · api');
  assertEquals(r[0].paths, ['src/api.ts']);
});

Deno.test('AD.3c: a file the card cannot attribute, or a card without attribution, still warns', () => {
  const unattributed = collisionsBetween([change([{ author: 'alice', commits: [THEIRS_SHA], files: ['README.md'] }])],
    [lease({ commits: [MINE_SHA] })], [], artifacts);
  assertEquals(unattributed.map((c) => [c.paths, c.by]), [[['src/api.ts'], []]], 'nobody can say it was the holder\'s');
  const legacy = collisionsBetween([change(null)], [lease({ commits: [MINE_SHA] })], [], artifacts);
  assertEquals(legacy.length, 1, 'an older card warns as before');
  assertEquals(ownCommits({ commits: ['not-a-sha', MINE_SHA], commitSha: 'ABC1234', verified: { commitSha: 7 } }), [MINE_SHA, 'abc1234']);
});

// ── the provider reads ───────────────────────────────────────────────────

function stub(routes: Array<[RegExp, unknown, number?]>) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    for (const [re, body, status] of routes) if (re.test(url)) return new Response(JSON.stringify(body), { status: status ?? 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

Deno.test('AD.3c: the compare carries each commit\'s author, and a commit gives its files (a rename counts both paths)', async () => {
  let restore = stub([
    [/\/compare\//, { files: [], commits: [
      { sha: 'c1', commit: { message: 'm', author: { name: 'Alice Smith' } }, author: { login: 'alice' } },
      { sha: 'c2', commit: { message: 'm', author: { name: 'Bot' } }, author: null },
    ] }],
    [/\/commits\/c1$/, { files: [{ filename: 'src/new.ts', previous_filename: 'src/old.ts' }, { filename: 'README.md' }] }],
  ]);
  try {
    const cmp = await fetchCompare('github', 'https://api.github.com', 'o', 'r', 'a', 'b', 't');
    assertEquals(cmp!.commits.map((c) => c.author), ['alice', 'Bot'], 'the login, else the commit\'s author name');
    assertEquals(await fetchCommitFiles('github', 'https://api.github.com', 'o', 'r', 'c1', 't'), ['src/new.ts', 'src/old.ts', 'README.md']);
    assertEquals(await fetchCommitFiles('github', 'https://api.github.com', 'o', 'r', 'zz', 't'), null, 'not knowing is null, never no files');
  } finally { restore(); }
  restore = stub([
    [/\/repository\/compare\?/, { diffs: [], commits: [{ id: 'g1', message: 'm', author_name: 'Gil' }] }],
    [/\/repository\/commits\/g1\/diff/, [{ new_path: 'a.rb', old_path: 'a.rb' }]],
  ]);
  try {
    const cmp = await fetchCompare('gitlab', 'https://gitlab.com/api/v4', 'o', 'r', 'a', 'b', 't');
    assertEquals(cmp!.commits[0].author, 'Gil');
    assertEquals(await fetchCommitFiles('gitlab', 'https://gitlab.com/api/v4', 'o', 'r', 'g1', 't'), ['a.rb']);
  } finally { restore(); }
});

// ── the card and the reads ───────────────────────────────────────────────

Deno.test('AD.3c: the sweep card records who in its header column and its metadata; get_pending_changes serves it', async () => {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', { data: [], error: null });
  sb.script('git_change_events', 'insert', { data: { id: 'E1' }, error: null });
  const authors = [{ author: 'alice', commits: ['c1'], files: ['src/a.ts'] }];
  await upsertCumulativeSweepEvent(sb as never, {
    integrationId: 'I', projectId: 'P', headSha: 'h', summary: 's', files: [{ path: 'src/a.ts', action: 'modified' }] as never,
    author: 'alice', metadata: { source: 'sweep', branchName: 'main', authors },
  });
  const row = sb.callsTo('git_change_events', 'insert')[0].payload as Any;
  assertEquals(row.author, 'alice');
  assertEquals(row.metadata.authors, authors);

  const read = new FakeSupabase();
  const P = '11111111-1111-4111-8111-111111111111';
  read.script('projects', 'select', { data: { id: P, name: 'Demo' }, error: null });
  read.script('git_change_events', 'select', {
    data: [{ id: 'E1', commit_sha: 'h', commit_message: 's', author: 'alice', changed_files: [], status: 'pending', metadata: { authors }, created_at: 't' }],
    error: null,
  });
  const r = await handleGetPendingChanges(read as never, { userId: 'user-1', scopes: ['read'], authMethod: 'api_key' } as never, { project_id: P });
  assertEquals(((r.data as Any).pendingChanges[0]).authors, authors);
});

Deno.test('AD.3c: a heartbeat keeps every commit its holder reports, so the card can tell them apart', async () => {
  const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('agent_checkouts', 'select', {
    data: { id: 'L1', level: 'task', holder_label: 'claude · bench', holder_key_id: 'k1', holder_delegate: 'key:k1', node_id: 'N1', meta: { commits: ['aaaaaaa'], tests: ['T1'] } },
    error: null,
  });
  sb.script('agent_checkouts', 'update', { data: { id: 'L1', heartbeat_at: 'now' }, error: null });
  const r = await handleCheckoutHeartbeat(sb as never, { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] } as never, {
    project_id: PROJECT.id, checkout_id: 'L1', meta: { commitSha: 'BBBBBBB1' },
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const written = sb.callsTo('agent_checkouts', 'update')[0].payload as Any;
  assertEquals(written.meta.commits, ['aaaaaaa', 'bbbbbbb1']);
  assertEquals(written.meta.tests, ['T1'], 'the rest of the meta stays');
});

Deno.test('AD.3c wiring: the sync check attributes the card\'s files before it writes the card', () => {
  const drift = Deno.readTextFileSync(new URL('../_shared/git-drift.ts', import.meta.url));
  const at = drift.indexOf('authors = groupFilesByAuthor(withFiles, files.map((f) => f.path)).authors;');
  assert(at > 0, 'the sweep groups the files');
  assert(drift.indexOf('author: authorLine(authors),') > at, 'and writes the header line');
  assert(/range\.compare\.commits\.filter\(\(c\) => !range\.recorded\.has\(c\.sha\)\)\.slice\(-MAX_ATTRIBUTED_COMMITS\)/.test(drift), 'NodeSpec\'s own commits are not asked, and the newest are');
});

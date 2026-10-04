// V3 AD.4 (findings D14 to D17, ruling 6): the git cleanup.
import { assert, assertEquals } from './helpers.ts';
import { isWorkBranch, WORK_BRANCH_PREFIX, workBranchName } from '../_shared/commit-mode.ts';

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

// ── AD.4a: what 2.2's one branch no longer uses ─────────────────────────────

Deno.test('AD.4a (D16): a pull request work branch is never a branch a project tracks', () => {
  assert(isWorkBranch(workBranchName('main')), 'every work branch carries the prefix');
  assert(isWorkBranch(`${WORK_BRANCH_PREFIX}release-1-x`), 'the prefix alone makes a work branch');
  for (const ref of ['main', 'master', 'feature/nodespec/push-x', 'nodespec/other', '', null, undefined]) {
    assertEquals(isWorkBranch(ref), false, String(ref));
  }
  const save = src('../save-git-integration/index.ts');
  const guard = save.indexOf('if (isWorkBranch(defaultBranch)) {');
  assert(guard > 0, 'save refuses it');
  assert(guard < save.indexOf('.from("git_integrations")'), 'before anything is read or written');
  assert(/if \(isWorkBranch\(defaultBranch\)\) \{[\s\S]{0,300}status: 400/.test(save), 'refused with a 400');
});

Deno.test('AD.4a: the webhook re-exports nothing it no longer uses', () => {
  const handlers = src('../git-webhook/handlers.ts');
  assert(!handlers.includes('SELF_PUSH_PREFIX'), 'the webhook reads no commit message');
});

// ── AD.4b: the primary branch by its flag ───────────────────────────────────

import { MemorySupabase, migrationColumns } from './helpers.ts';
import { runDriftSweep, upsertCumulativeSweepEvent, matchFilesToArtifacts } from '../_shared/git-drift.ts';
import { handleGetPendingChanges } from '../mcp-server/tools/git.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';

function renamedPrimary(): MemorySupabase {
  const sb = new MemorySupabase();
  // Connect renamed the primary to the git default's name; a stray row still
  // carries the old name without the flag.
  sb.table('branches', [
    { id: 'b-dev', project_id: PROJECT, name: 'develop', is_primary: true, git_ref: 'develop', last_synced_commit: null },
    { id: 'b-old', project_id: PROJECT, name: 'main', is_primary: false, git_ref: null, last_synced_commit: 'aaaaaaa' },
  ]);
  sb.table('git_integrations', [{ id: 'int-1', project_id: PROJECT, provider: 'github', repo_owner: 'o', repo_name: 'r', default_branch: 'develop', base_url: null, access_token_encrypted: 't', last_drift_check_at: null }]);
  return sb;
}

Deno.test('AD.4b (D15): a sync check with no branch named reads the primary by its flag, not a row called main', async () => {
  const sb = renamedPrimary();
  const r = await runDriftSweep(sb, PROJECT, { force: true });
  // develop has no baseline yet; the stray 'main' row (baselined) is never read.
  assertEquals(r.status, 'unbaselined');
  sb.rowsOf('branches').splice(0, 2);
  const none = await runDriftSweep(sb, PROJECT, { force: true });
  assertEquals(none, { status: 'error', detail: 'No primary branch' });
});

Deno.test('AD.4b (D15): a card from before R3-3c is the primary\'s, whatever it is named', async () => {
  const sb = new MemorySupabase();
  const events = sb.table('git_change_events', [
    { id: 'legacy', project_id: PROJECT, status: 'pending', metadata: { source: 'sweep' } },
  ]);
  const meta = { source: 'sweep', branchName: 'develop' };
  // On the primary: the legacy card is superseded in place.
  const id = await upsertCumulativeSweepEvent(sb, { integrationId: 'int-1', projectId: PROJECT, headSha: 'h1', summary: 's', files: [], metadata: meta, isPrimary: true });
  assertEquals(id, 'legacy');
  assertEquals(events.length, 1);
  // On another branch: never the primary's card.
  events[0].metadata = { source: 'sweep' };
  await upsertCumulativeSweepEvent(sb, { integrationId: 'int-1', projectId: PROJECT, headSha: 'h2', summary: 's', files: [], metadata: { source: 'sweep', branchName: 'feature' }, isPrimary: false });
  assertEquals(events.length, 2, 'a second card for the other branch');
  // An unmapped ref's card is nobody's.
  events.splice(0, events.length, { id: 'u', project_id: PROJECT, status: 'pending', metadata: { source: 'sweep', unmappedRef: 'x' } });
  await upsertCumulativeSweepEvent(sb, { integrationId: 'int-1', projectId: PROJECT, headSha: 'h3', summary: 's', files: [], metadata: meta, isPrimary: true });
  assertEquals(events.length, 2);
});

Deno.test('AD.4b (D15): the matcher with no branch named reads the primary by its flag', async () => {
  const sb = renamedPrimary();
  sb.table('graph_snapshots', [
    { id: 's-dev', project_id: PROJECT, branch_id: 'b-dev', version: 1, created_at: '2026-09-25T00:00:00Z', graph_data: { nodes: { n1: { id: 'n1', label: 'API' } }, edges: {}, artifacts: { a1: { id: 'a1', nodeId: 'n1', path: 'src/api.ts' } } } },
    { id: 's-old', project_id: PROJECT, branch_id: 'b-old', version: 1, created_at: '2026-09-25T00:00:00Z', graph_data: { nodes: {}, edges: {}, artifacts: {} } },
  ]);
  const r = await matchFilesToArtifacts(sb, PROJECT, [{ path: 'src/api.ts', action: 'modified' }]);
  assertEquals(r.matches.map((m) => m.path), ['src/api.ts']);
});

Deno.test('AD.4b (D15): get_pending_changes names a legacy card after the primary; an unmapped ref stays unnamed', async () => {
  const sb = renamedPrimary();
  sb.table('git_change_events', [
    { id: 'legacy', project_id: PROJECT, status: 'pending', created_at: '2026-09-25T00:00:00Z', metadata: { source: 'sweep' } },
    { id: 'unmapped', project_id: PROJECT, status: 'pending', created_at: '2026-09-25T00:00:01Z', metadata: { source: 'webhook', unmappedRef: 'x' } },
  ]);
  sb.table('projects', [{ id: PROJECT, name: 'Shop', owner_id: 'u1' }]);
  sb.table('project_members', [{ project_id: PROJECT, user_id: 'u1', role: 'owner' }]);
  sb.table('checkouts', []);
  const r = await handleGetPendingChanges(sb as never, { userId: 'u1', scopes: ['read'] } as never, { project_id: PROJECT });
  assert(r.success, JSON.stringify(r));
  const byId = Object.fromEntries((r.data as { pendingChanges: Array<{ changeEventId: string; branchName: string | null }> }).pendingChanges.map((c) => [c.changeEventId, c.branchName]));
  assertEquals(byId, { unmapped: null, legacy: 'develop' });
});

Deno.test('AD.4b (D15): no git lane on the server falls back to the literal main', () => {
  for (const f of ['../_shared/git-drift.ts', '../git-pull/index.ts', '../git-push/index.ts', '../mcp-server/tools/git.ts']) {
    const code = src(f).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    assert(!/\?\? ["']main["']|\|\| ["']main["']|= ["']main["']/.test(code), `${f} has no literal main default`);
  }
  const pull = src('../git-pull/index.ts');
  assert(pull.includes("const target = branchName ?? (await getPrimaryBranch(serviceClient, integration.project_id, 'id, name, is_primary'))?.name;"), 'a load with no branch targets the primary');
  assert(/if \(!target\) return jsonResponse\(\{ error: 'This project has no primary branch to load into\.' \}, 404\);/.test(pull), 'no primary: a 404 that says so');
});

// ── AD.4c: pull request mode, one open pull request per branch ─────────────

import { readRange, newestPerPath } from '../_shared/push-plan.ts';
import { listPullRequests, resetRemoteBranch } from '../_shared/git-provider.ts';

async function withFetch<T>(respond: (url: string, init?: RequestInit) => Response, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(respond(String(input instanceof Request ? input.url : input), init))) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = real; }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function prLog(): MemorySupabase {
  // The table's real columns: a query on one it lacks fails, as it does live.
  const sb = new MemorySupabase().columns('git_sync_log', migrationColumns('git_sync_log'));
  const row = (id: string, sha: string, at: string, prNumber: number, blobs: Record<string, string>) => ({
    id, integration_id: 'int-1', direction: 'push', commit_sha: sha, branch_id: 'b1', status: 'success', started_at: at,
    metadata: { nodespecPush: true, blobs, deleted: [], workBranch: 'nodespec/push-main', prNumber },
  });
  sb.table('git_sync_log', [
    row('p0', 'w0', '2026-09-25T08:00:00Z', 6, { 'src/old.ts': 'o6' }),
    row('p1', 'w1', '2026-09-25T10:00:00Z', 7, { 'src/a.ts': 'a1', '.nodespec/model.json': 'm1' }),
    row('p2', 'w2', '2026-09-25T11:00:00Z', 7, { 'src/a.ts': 'a2' }),
  ]);
  return sb;
}
const PR_RANGE = { provider: 'github', apiBase: 'https://api', owner: 'o', repo: 'r', token: 't', integrationId: 'int-1', branchId: 'b1', base: 'B', head: 'H' };
const merged = async () => [{ number: 7, url: null, mergeShas: ['sq7'] }, { number: 6, url: null, mergeShas: ['old6'] }];
const squashed = (files: Array<{ filename: string; sha: string }>) => () => json({
  files: files.map((f) => ({ ...f, status: 'modified' })),
  commits: [{ sha: 'sq7', commit: { message: 'Design (#7)' } }],
});

Deno.test('AD.4c (D14): a squash of this branch\'s pull request is NodeSpec\'s own writing, by the blobs its pushes recorded', async () => {
  const r = await withFetch(squashed([{ filename: 'src/a.ts', sha: 'a2' }, { filename: '.nodespec/model.json', sha: 'm1' }]),
    () => readRange(prLog(), { ...PR_RANGE, ref: 'main', mergedPullRequests: merged }));
  assert(r.ok, 'compared');
  if (!r.ok) return;
  assertEquals(r.foreign.map((f) => f.path), [], 'nothing to review: the sync check moves forward');
  assertEquals(r.foreignAnyBranch.map((f) => f.path), []);
});

Deno.test('AD.4c (D14): only the newest content of a pull request that merged in this range counts', async () => {
  const run = (files: Array<{ filename: string; sha: string }>, opts: Record<string, unknown>) =>
    withFetch(squashed(files), () => readRange(prLog(), { ...PR_RANGE, ...opts }));
  // an older push of the same pull request is not what it merged
  let r = await run([{ filename: 'src/a.ts', sha: 'a1' }], { ref: 'main', mergedPullRequests: merged });
  assert(r.ok && r.foreign.map((f) => f.path).join() === 'src/a.ts', 'an older push of the pull request is foreign');
  // a pull request that merged before this range: a revert to its content is foreign
  r = await run([{ filename: 'src/old.ts', sha: 'o6' }], { ref: 'main', mergedPullRequests: merged });
  assert(r.ok && r.foreign.map((f) => f.path).join() === 'src/old.ts', 'an earlier pull request is not this merge');
  // the provider could not be read: every file stays foreign
  r = await run([{ filename: 'src/a.ts', sha: 'a2' }], { ref: 'main', mergedPullRequests: async () => null });
  assert(r.ok && r.foreign.length === 1, 'unknown is never own');
  // not merged in the range (still open, or merged elsewhere)
  r = await run([{ filename: 'src/a.ts', sha: 'a2' }], { ref: 'main', mergedPullRequests: async () => [{ number: 7, url: null, mergeShas: ['elsewhere'] }] });
  assert(r.ok && r.foreign.length === 1, 'a pull request not merged here brings nothing');
  // a range read without its ref asks no provider
  let asked = false;
  r = await run([{ filename: 'src/a.ts', sha: 'a2' }], { mergedPullRequests: async () => { asked = true; return []; } });
  assert(r.ok && r.foreign.length === 1 && !asked, 'no ref, no pull request lookup');
});

Deno.test('AD.4c: newestPerPath keeps each path\'s newest push, a deletion included', () => {
  const out = newestPerPath([
    { sha: 'n', branchId: 'b1', blobs: { 'a.ts': 'new' }, deleted: ['gone.ts'] },
    { sha: 'o', branchId: 'b1', blobs: { 'a.ts': 'old', 'gone.ts': 'was', 'b.ts': 'b1' }, deleted: [] },
  ]);
  assertEquals(out.blobs, { 'a.ts': 'new', 'b.ts': 'b1' });
  assertEquals(out.deleted, ['gone.ts']);
});

Deno.test('AD.4c: the provider names open and merged pull requests; unreadable is null, never none', async () => {
  const urls: string[] = [];
  const gh = await withFetch((url) => {
    urls.push(url);
    return json(url.includes('state=open')
      ? [{ number: 7, html_url: 'https://gh/pr/7', merge_commit_sha: 'tmp' }]
      : [{ number: 6, html_url: 'u6', merged_at: '2026-09-24', merge_commit_sha: 'sq6' }, { number: 5, html_url: 'u5', merged_at: null, merge_commit_sha: 'x' }]);
  }, async () => [
    await listPullRequests('github', 'https://api', 'o', 'r', 'nodespec/push-main', 'main', 't', 'open'),
    await listPullRequests('github', 'https://api', 'o', 'r', 'nodespec/push-main', 'main', 't', 'merged'),
  ]);
  assertEquals(gh, [[{ number: 7, url: 'https://gh/pr/7', mergeShas: [] }], [{ number: 6, url: 'u6', mergeShas: ['sq6'] }]], 'a closed pull request that never merged is not merged');
  assert(urls[0].includes('head=o%3Anodespec%2Fpush-main') && urls[0].includes('base=main'), urls[0]);
  const gl = await withFetch(() => json([{ iid: 3, web_url: 'u3', squash_commit_sha: 'sq3', merge_commit_sha: null, sha: 'h3' }]),
    () => listPullRequests('gitlab', 'https://gl/api/v4', 'o', 'r', 'nodespec/push-main', 'main', 't', 'merged'));
  assertEquals(gl, [{ number: 3, url: 'u3', mergeShas: ['sq3', 'h3'] }]);
  assertEquals(await withFetch(() => json({ message: 'nope' }, 500), () => listPullRequests('github', 'https://api', 'o', 'r', 'w', 'main', 't', 'open')), null);
});

Deno.test('AD.4c: a work branch with no open pull request starts again at the tracked head', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const record = (url: string, init?: RequestInit) => { calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null }); };
  const gh = await withFetch((url, init) => { record(url, init); return json({}); },
    () => resetRemoteBranch('github', 'https://api', 'o', 'r', 'nodespec/push-main', 'H1', 't'));
  assert(gh.ok, 'reset');
  assertEquals(calls[0], { url: 'https://api/repos/o/r/git/refs/heads/nodespec/push-main', method: 'PATCH', body: { sha: 'H1', force: true } });
  calls.length = 0;
  const gl = await withFetch((url, init) => { record(url, init); return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ commit: { id: 'H1' } }); },
    () => resetRemoteBranch('gitlab', 'https://gl/api/v4', 'o', 'r', 'nodespec/push-main', 'H1', 't'));
  assert(gl.ok, 'recut');
  assertEquals(calls.map((c) => c.method), ['DELETE', 'POST'], 'GitLab removes the branch and cuts it again');
});

Deno.test('AD.4c (D14, ruling 6): a push adds to the open pull request, or starts the work branch again and opens one', () => {
  const push = src('../git-push/index.ts');
  const preflight = push.slice(push.indexOf('for (let attempt = 0; attempt < 2 && !pushResult; attempt++)'), push.indexOf('if (!pushResult) {'));
  assert(preflight.includes('prWorkBranch = workBranchName(targetRef);'), 'one work branch per tracked ref');
  assert(/listPullRequests\([\s\S]{0,160}prWorkBranch, targetRef, token, "open",?\s*\)/.test(preflight), 'the open pull request is read');
  assert(/if \(!open\) \{\s*return json\(/.test(preflight), 'an unreadable provider writes nothing');
  assert(/if \(open\.length > 0 && workHead\.sha\) \{\s*openPr = open\[0\];\s*buildOn = workHead\.sha;/.test(preflight), 'while open: build on the work branch');
  assert(/\} else \{[\s\S]{0,300}resetRemoteBranch\([\s\S]{0,160}prWorkBranch, head, token,/.test(preflight), 'none open: start again at the tracked head');
  assert(preflight.indexOf('createRemoteBranch(') === -1, 'never a new branch per push');
  assert(/workBranch: prWorkBranch, \.\.\.\(openPr \? \{ prNumber: openPr\.number \} : \{\}\)/.test(push), 'the push record names its pull request');
  assert(push.includes('prInfo = { url: openPr.url ?? "", number: openPr.number, reused: true };'), 'no second pull request');
  assert(/\.\.\.\(typeof prInfo\.number === "number" \? \{ prNumber: prInfo\.number \} : \{\}\)/.test(push), 'a new pull request is recorded on its first push');
  const drift = src('../_shared/git-drift.ts');
  assert(drift.includes('integrationId: integration.id, branchId: branch.id, base: baseline, head, ref,'), 'the sync check reads merged pull requests on its ref');
  assert(/branchId: branch\.id, base: baselineAtStart, head, ref: targetRef,/.test(push), 'so does the push preflight');
});

// ── AD.4d: GitLab parity ────────────────────────────────────────────────────

import { gitLabChanges, gitLabActions, gitLabBranchMoved } from '../_shared/push-plan.ts';

Deno.test('AD.4d (D17): a GitLab commit changes only what differs from the head the preflight read', () => {
  const files = [
    { path: 'same.ts', content: 'a' }, { path: 'edited.ts', content: 'b2' }, { path: 'new.ts', content: 'c' },
  ];
  const blobs = { 'same.ts': 'blob-a', 'edited.ts': 'blob-b2', 'new.ts': 'blob-c' };
  const existing = new Map([['same.ts', 'blob-a'], ['edited.ts', 'blob-b1'], ['old.ts', 'blob-o']]);
  const changes = gitLabChanges({ files, blobs, existing, stalePaths: ['old.ts', 'never-there.ts'] });
  assertEquals(changes.creates.map((f) => f.path), ['new.ts']);
  assertEquals(changes.updates.map((f) => f.path), ['edited.ts'], 'an identical blob is left out');
  assertEquals(changes.deletes, ['old.ts'], 'only a path the branch has is deleted');
  assertEquals(
    gitLabChanges({ files: [files[0]], blobs, existing, stalePaths: [] }),
    { creates: [], updates: [], deletes: [] },
    'nothing to change: an unchanged push',
  );
});

Deno.test('AD.4d (D17): an update or delete names the commit that last changed its file', () => {
  const actions = gitLabActions(
    { creates: [{ path: 'n.ts', content: 'n' }], updates: [{ path: 'e.ts', content: 'e' }], deletes: ['o.ts'] },
    new Map([['e.ts', 'c-e'], ['o.ts', 'c-o']]),
  );
  assertEquals(actions, [
    { action: 'create', file_path: 'n.ts', content: 'n' },
    { action: 'update', file_path: 'e.ts', content: 'e', last_commit_id: 'c-e' },
    { action: 'delete', file_path: 'o.ts', last_commit_id: 'c-o' },
  ]);
  assert(gitLabBranchMoved(400, '{"message":"The file has changed since you started editing it: e.ts"}'), 'a changed file');
  assert(gitLabBranchMoved(400, '{"message":"A file with this name already exists"}'), 'a file that appeared');
  assert(gitLabBranchMoved(400, '{"message":"A file with this name doesn\'t exist"}'), 'a file that went');
  assert(!gitLabBranchMoved(400, '{"message":"branch is protected"}'), 'any other refusal is an error');
  assert(!gitLabBranchMoved(500, 'changed since you started editing'), 'a server error is an error');
});

Deno.test('AD.4d (D17): the GitLab push lists every page at the head it builds on, and reruns when a file changed', () => {
  const push = src('../git-push/index.ts');
  const gl = push.slice(push.indexOf('async function pushToGitLab('), push.indexOf('function generateArchitectureDocument('));
  assert(gl.includes('await fetchFullGitLabTree(apiBase, owner, repo, parent, token)'), 'every page, at the head read');
  assert(!gl.includes('per_page=100`'), 'no single-page listing');
  assert(gl.includes('{ method: "HEAD", headers: { "PRIVATE-TOKEN": token } }') && gl.includes('x-gitlab-last-commit-id'), 'last commit per file');
  assert(/if \(!resp\.ok \|\| !id\) throw new Error\(/.test(gl), 'an unreadable file stops the push');
  assert(/if \(gitLabBranchMoved\(commitResponse\.status, errorText\)\) \{[\s\S]{0,200}moved: true/.test(gl), 'a refusal for a changed file is a moved branch');
  assert(gl.includes('return { sha: parent, parent, deletedPaths: [], unchanged: true };'), 'nothing to change mints no commit');
  const preflight = push.slice(push.indexOf('for (let attempt = 0; attempt < 2 && !pushResult; attempt++)'), push.indexOf('if (!pushResult) {'));
  assert(/pushToGitLab\([\s\S]{0,200}plan\.deletions, buildOn, blobs,\s*\);\s*[\s\S]{0,200}if \(attemptResult\.moved\) continue;/.test(preflight), 'GitLab reruns the preflight like GitHub');
});

// ── Bench 2026-09-25, second run ────────────────────────────────────────────

Deno.test('bench 2026-09-25: the recent-pushes read uses the columns git_sync_log has', async () => {
  const cols = migrationColumns('git_sync_log');
  assert(cols.includes('started_at') && !cols.includes('created_at'), cols.join(','));
  // A query on a column the table lacks fails as PostgREST fails it.
  const sb = new MemorySupabase().columns('git_sync_log', cols);
  sb.table('git_sync_log', []);
  const bad = await sb.from('git_sync_log').select('id').order('created_at', { ascending: false });
  assertEquals(bad.error?.code, '42703');
  const good = await sb.from('git_sync_log').select('commit_sha, branch_id, status, metadata').eq('direction', 'push').order('started_at', { ascending: false });
  assertEquals(good.error, null);
  const plan = src('../_shared/push-plan.ts');
  assert(plan.includes('.order("started_at", { ascending: false })') && !plan.includes('"created_at"'), 'ordered by started_at');
});

Deno.test('bench 2026-09-25: a recognised merge that still ends as a card says why', () => {
  const drift = src('../_shared/git-drift.ts');
  assert(drift.includes("mergeNotFiled = `NodeSpec merge arrived on ${ref} but git's model was not filed (${filed.code}: ${filed.message}); the change card asks instead`;"), 'the reason is kept');
  assert(drift.includes('...(mergeNotFiled ? { detail: mergeNotFiled } : {}),'), 'and returned on the drift result');
});

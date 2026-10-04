// V3 AD.1a (owner 2026-09-24): the one forward-only baseline writer, the one
// card resolver, reads that say found / absent / failed, a connect that never
// moves a baselined branch, and deletions only from a verified anchor.
// Findings D5, D8, D10, D11 on board section AD; invariants I3, I5 and I8.
import { decideBaselineMove, advanceBaseline, isCommitSha, type AncestryFn } from '../_shared/baseline.ts';
import { resolveCard, cardBaselineTarget } from '../_shared/card-resolve.ts';
import { readRepoFile, fetchAncestry } from '../_shared/git-provider.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const says = (answer: 'ahead' | 'identical' | 'behind' | 'diverged' | null): AncestryFn => async () => answer;
const never: AncestryFn = async () => { throw new Error('ancestry must not be asked'); };

// ── the decision ─────────────────────────────────────────────────────────────

Deno.test('AD.1 (I3): the baseline only moves forward', () => {
  assertEquals(decideBaselineMove({ current: A, to: B, ancestry: 'ahead' }), { move: true, outcome: 'forward' });
  assertEquals(decideBaselineMove({ current: A, to: B, ancestry: 'behind' }), { move: false, outcome: 'behind' });
  assertEquals(decideBaselineMove({ current: A, to: B, ancestry: 'diverged' }), { move: false, outcome: 'diverged' });
  assertEquals(decideBaselineMove({ current: A, to: B, ancestry: 'identical' }), { move: false, outcome: 'same' });
  assertEquals(decideBaselineMove({ current: A, to: A, ancestry: null }), { move: false, outcome: 'same' });
});

Deno.test('AD.1 (I3): a provider that cannot say moves nothing, even for a person', () => {
  assertEquals(decideBaselineMove({ current: A, to: B, ancestry: null }), { move: false, outcome: 'unknown' });
  assertEquals(decideBaselineMove({ current: A, to: B, ancestry: null, reanchor: true }), { move: false, outcome: 'unknown' });
});

Deno.test('AD.1: only a person loading the model crosses rewritten or rewound history', () => {
  assertEquals(decideBaselineMove({ current: A, to: B, ancestry: 'diverged', reanchor: true }), { move: true, outcome: 'reanchored' });
  assertEquals(decideBaselineMove({ current: A, to: B, ancestry: 'behind', reanchor: true }), { move: true, outcome: 'reanchored' });
});

Deno.test('AD.1: a first baseline is set freely; a non-sha never is', () => {
  assertEquals(decideBaselineMove({ current: null, to: A, ancestry: null }), { move: true, outcome: 'first' });
  assertEquals(decideBaselineMove({ current: A, to: 'unknown', ancestry: 'ahead' }), { move: false, outcome: 'invalid' });
  assert(isCommitSha('abc1234') && !isCommitSha('abc') && !isCommitSha('unknown') && !isCommitSha(null));
});

// ── the write ────────────────────────────────────────────────────────────────

function branchDb(current: string | null, updated: unknown[] = [{ id: 'b1' }]) {
  const sb = new FakeSupabase();
  sb.script('branches', 'select', { data: { id: 'b1', last_synced_commit: current } });
  sb.script('branches', 'update', { data: updated });
  return sb;
}

Deno.test('AD.1: a forward move writes only if the baseline is still the one it read', async () => {
  const sb = branchDb(A);
  const r = await advanceBaseline(sb, { branchId: 'b1', to: B, ancestry: says('ahead') });
  assertEquals(r, { moved: true, outcome: 'forward', from: A });
  const [write] = sb.callsTo('branches', 'update');
  assertEquals((write.payload as Record<string, unknown>).last_synced_commit, B);
  assert(write.filters.some((f) => f.method === 'eq' && f.args[0] === 'last_synced_commit' && f.args[1] === A), 'conditional on the value read');
});

Deno.test('AD.1: a first baseline writes only while there is none', async () => {
  const sb = branchDb(null);
  const r = await advanceBaseline(sb, { branchId: 'b1', to: A, ancestry: never });
  assertEquals(r.outcome, 'first');
  const [write] = sb.callsTo('branches', 'update');
  assert(write.filters.some((f) => f.method === 'is' && f.args[0] === 'last_synced_commit' && f.args[1] === null));
});

Deno.test('AD.1 (I3): behind, diverged and unknown write nothing', async () => {
  for (const answer of ['behind', 'diverged', null] as const) {
    const sb = branchDb(A);
    const r = await advanceBaseline(sb, { branchId: 'b1', to: B, ancestry: says(answer) });
    assertEquals(r.moved, false, String(answer));
    assertEquals(sb.callsTo('branches', 'update').length, 0, `${answer}: no write`);
  }
});

Deno.test('AD.1: a baseline that moved meanwhile is left alone (raced)', async () => {
  const sb = branchDb(A, []);
  const r = await advanceBaseline(sb, { branchId: 'b1', to: B, ancestry: says('ahead') });
  assertEquals(r, { moved: false, outcome: 'raced', from: A });
});

// ── the card resolver ────────────────────────────────────────────────────────

const PROJECT = 'proj-1';
function cardDb(card: Record<string, unknown>, opts: { branch?: Record<string, unknown> | null; cardWrite?: unknown[]; branchWrite?: unknown[] } = {}) {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', { data: { id: 'e1', project_id: PROJECT, status: 'pending', metadata: {}, ...card } });
  // getPrimaryBranch (no branchName on the card), then the plan's read
  sb.script('branches', 'select', { data: opts.branch === null ? null : { id: 'b1' } });
  sb.script('branches', 'select', { data: opts.branch === null ? null : { id: 'b1', last_synced_commit: A, ...(opts.branch ?? {}) } });
  sb.script('git_change_events', 'update', { data: opts.cardWrite ?? [{ id: 'e1' }] });
  sb.script('branches', 'update', { data: opts.branchWrite ?? [{ id: 'b1' }] });
  return sb;
}
const resolveArgs = (over: Record<string, unknown> = {}) => ({
  projectId: PROJECT, eventId: 'e1', resolution: 'accepted' as const, expectedCommitSha: B,
  resolvedBy: 'user-1', ancestry: says('ahead'), ...over,
});

Deno.test('AD.1 (D8): a card resolves as the version read and moves its baseline forward', async () => {
  const sb = cardDb({ commit_sha: B });
  const r = await resolveCard(sb, resolveArgs());
  assertEquals(r, { ok: true, baseline: { moved: true, outcome: 'forward' } });
  const [cardWrite] = sb.callsTo('git_change_events', 'update');
  assert(cardWrite.filters.some((f) => f.method === 'eq' && f.args[0] === 'status' && f.args[1] === 'pending'), 'only while pending');
  assert(cardWrite.filters.some((f) => f.method === 'eq' && f.args[0] === 'commit_sha' && f.args[1] === B), 'only as the version read');
});

Deno.test('AD.1 (D8): a card rewritten since it was read is refused, nothing written', async () => {
  const sb = cardDb({ commit_sha: C });
  const r = await resolveCard(sb, resolveArgs());
  assertEquals(r.ok, false);
  assertEquals(!r.ok && r.code, 'changed');
  assertEquals(sb.calls.filter((c) => c.op !== 'select').length, 0);
});

Deno.test('AD.1 (D8): a resolved card, a card of another project, and an unconfirmable move are refused', async () => {
  const done = await resolveCard(cardDb({ commit_sha: B, status: 'accepted' }), resolveArgs());
  assertEquals(!done.ok && done.code, 'not-pending');
  const other = await resolveCard(cardDb({ commit_sha: B, project_id: 'proj-2' }), resolveArgs());
  assertEquals(!other.ok && other.code, 'not-found');
  const sb = cardDb({ commit_sha: B });
  const unsure = await resolveCard(sb, resolveArgs({ ancestry: says(null) }));
  assertEquals(!unsure.ok && unsure.code, 'unconfirmed');
  assertEquals(sb.calls.filter((c) => c.op !== 'select').length, 0, 'the card stays pending');
});

Deno.test('AD.1 (D8): a card the baseline already passed resolves without moving it backwards', async () => {
  const sb = cardDb({ commit_sha: B });
  const r = await resolveCard(sb, resolveArgs({ ancestry: says('behind') }));
  assertEquals(r, { ok: true, baseline: { moved: false, outcome: 'behind' } });
  assertEquals(sb.callsTo('branches', 'update').length, 0);
});

Deno.test('AD.1: a raced card write resolves nothing and moves nothing', async () => {
  const sb = cardDb({ commit_sha: B }, { cardWrite: [] });
  const r = await resolveCard(sb, resolveArgs());
  assertEquals(!r.ok && r.code, 'raced');
  assertEquals(sb.callsTo('branches', 'update').length, 0);
});

Deno.test('AD.1: which cards move which baseline', () => {
  assertEquals(cardBaselineTarget({ commit_sha: B, metadata: { branchName: 'feature' } }, 'accepted'), { branchName: 'feature' });
  assertEquals(cardBaselineTarget({ commit_sha: B, metadata: {} }, 'dismissed'), { branchName: null }, 'primary branch');
  assertEquals(cardBaselineTarget({ commit_sha: B, metadata: { source: 'ref-deleted' } }, 'accepted'), null);
  assertEquals(cardBaselineTarget({ commit_sha: B, metadata: { unmappedRef: 'topic' } }, 'accepted'), null);
  assertEquals(cardBaselineTarget({ commit_sha: B, metadata: { source: 'connect-anchor-mismatch' } }, 'dismissed'), null,
    'dismissing the mismatch keeps the push guard armed');
  assertEquals(cardBaselineTarget({ commit_sha: B, metadata: { source: 'connect-anchor-mismatch' } }, 'accepted'), { branchName: null });
  assertEquals(cardBaselineTarget({ commit_sha: 'unknown', metadata: {} }, 'accepted'), null);
});

Deno.test('AD.1: a ref-deleted card reads no branch at all', async () => {
  const sb = new FakeSupabase();
  sb.script('git_change_events', 'select', { data: { id: 'e1', project_id: PROJECT, status: 'pending', commit_sha: B, metadata: { source: 'ref-deleted' } } });
  sb.script('git_change_events', 'update', { data: [{ id: 'e1' }] });
  const r = await resolveCard(sb, resolveArgs({ ancestry: never }));
  assertEquals(r, { ok: true, baseline: { moved: false, outcome: 'none' } });
  assertEquals(sb.callsTo('branches', 'select').length, 0);
});

// ── reads say found, absent or failed; ancestry from the provider ────────────

async function withFetch<T>(respond: (url: string) => Response | Promise<Response>, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => Promise.resolve(respond(String(input instanceof Request ? input.url : input)))) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = real; }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.test('AD.1 (I8, D11): a 404 is absent; any other failure is failed, never absent', async () => {
  const read = (status: number) => withFetch(() => json({}, status), () => readRepoFile('github', 'https://api', 'o', 'r', '.nodespec/model.json', 'main', 't'));
  assertEquals((await read(404)).status, 'absent');
  assertEquals((await read(500)).status, 'failed');
  assertEquals((await read(401)).status, 'failed');
  const thrown = await withFetch(() => { throw new Error('network down'); }, () => readRepoFile('github', 'https://api', 'o', 'r', 'x', 'main', 't'));
  assertEquals(thrown.status, 'failed');
  const found = await withFetch(() => json({ encoding: 'base64', content: btoa('hello') }), () => readRepoFile('github', 'https://api', 'o', 'r', 'x', 'main', 't'));
  assertEquals(found, { status: 'found', text: 'hello' });
  const gitlab404 = await withFetch(() => new Response('', { status: 404 }), () => readRepoFile('gitlab', 'https://gl', 'o', 'r', 'x', 'main', 't'));
  assertEquals(gitlab404.status, 'absent');
});

Deno.test('AD.1: ancestry reads GitHub\'s compare status and GitLab\'s merge base', async () => {
  for (const status of ['ahead', 'behind', 'diverged', 'identical'] as const) {
    assertEquals(await withFetch(() => json({ status }), () => fetchAncestry('github', 'https://api', 'o', 'r', A, B, 't')), status);
  }
  assertEquals(await withFetch(() => json({}, 404), () => fetchAncestry('github', 'https://api', 'o', 'r', A, B, 't')), null);
  assertEquals(await withFetch(() => json({ id: A }), () => fetchAncestry('gitlab', 'https://gl', 'o', 'r', A, B, 't')), 'ahead');
  assertEquals(await withFetch(() => json({ id: B }), () => fetchAncestry('gitlab', 'https://gl', 'o', 'r', A, B, 't')), 'behind');
  assertEquals(await withFetch(() => json({ id: C }), () => fetchAncestry('gitlab', 'https://gl', 'o', 'r', A, B, 't')), 'diverged');
  assertEquals(await fetchAncestry('github', 'https://api', 'o', 'r', A, A, 't'), 'identical', 'no call for the same commit');
});

// ── every writer goes through the one function ───────────────────────────────

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

Deno.test('AD.1 (I3): nothing outside baseline.ts writes a baseline, bar clearing it on a new repository', () => {
  const files = [
    '../git-push/index.ts', '../git-pull/index.ts', '../git-webhook/handlers.ts',
    '../mcp-server/tools/git.ts', '../_shared/git-drift.ts', '../save-git-integration/index.ts',
  ];
  for (const f of files) {
    const writes = src(f).match(/last_synced_commit:\s*[^,}\s]+/g) ?? [];
    const allowed = f.endsWith('save-git-integration/index.ts') ? writes.filter((w) => !/last_synced_commit:\s*null/.test(w)) : writes;
    assertEquals(allowed, [], `${f} writes a baseline directly: ${allowed.join(' | ')}`);
  }
  const app = Deno.readTextFileSync(new URL('../../../src/ui/services/GitService.ts', import.meta.url));
  assert(!/update\(\{[^}]*last_synced_commit/.test(app), 'the app never writes a baseline');
  assert(/mode: 'resolve-change'/.test(app), 'the app resolves on the server');
});

Deno.test('AD.1 (D11): the unbaselined push guard fails closed on a failed read', () => {
  const push = src('../git-push/index.ts');
  assert(/guardRead\.status === "failed"[\s\S]{0,300}status: 502/.test(push));
});

Deno.test('AD.1 (I5, D5): a push deletes only what a hash-verified anchor names', () => {
  const push = src('../git-push/index.ts');
  const lane = push.slice(push.indexOf('const oldRead = await readRepoFile('), push.indexOf('const { data: patches }'));
  assert(lane.indexOf('verifyModelHash(oldParsed.model)') > 0, 'the hash is checked');
  assert(lane.indexOf('verifyModelHash(oldParsed.model)') < lane.indexOf('computeStalePaths('), 'before any deletion is computed');
  assert(/oldRead\.status === "failed"/.test(lane), 'a failed read names no deletion');
});

Deno.test('AD.1 (D5, D10, D11): connect adopts without a baseline, re-saves leave one alone, failed reads adopt nothing', () => {
  const save = src('../save-git-integration/index.ts');
  const adopt = save.slice(save.indexOf('const patches = anchorToPatches('), save.indexOf('// ── R7b: adopt the SPEC plane'));
  assert(!/advanceBaseline|last_synced_commit/.test(adopt), 'the adopt sets no baseline');
  assert(/\.\.\.\(adoptHeadSha \? \{ adoptHeadSha \} : \{\}\)/.test(adopt), 'the proposal carries the commit it was read at');
  assert(/anchorRead\.status === "failed"/.test(save), 'a failed model read adopts, compares and imports nothing');
  assert(/specRead\.status === "failed"/.test(save), 'a failed spec read adopts nothing');
  const proposals = Deno.readTextFileSync(new URL('../../../src/ui/services/ProposalService.ts', import.meta.url));
  assert(/source === 'git-adopt' \|\| proposal\.metadata\?\.source === 'git-load' \|\| proposal\.metadata\?\.reconcilesChange[\s\S]{0,600}proposalBaseline\(integration\.id, proposalId\)/.test(proposals), 'accepting the adopt sets the baseline');
});

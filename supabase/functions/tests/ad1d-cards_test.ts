// V3 AD.1d (owner 2026-09-24): ticks are never dropped, a load answers only
// its own cards, and a load moves the last sync only as far as it answers git.
// The resolver and the load helpers run on a MemorySupabase that applies
// every filter, so a conditional write that misses really misses; the
// provider's compare is stubbed at fetch.
import { resolveCard, unappliedTicks, hasUnappliedTicks, ticksPhrase } from '../_shared/card-resolve.ts';
import {
  cardAnsweredByLoads, cardOnBranch, planCardsAfterLoad, loadCoversRange, resolveCardsAfterRestore,
  moveBaselineAfterLoad, decideBranchFreshness, LOAD_KEPT_BASELINE_NOTE,
} from '../_shared/git-drift.ts';
import type { BaselinePlan } from '../_shared/baseline.ts';
import { MemorySupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const MAIN = '22222222-2222-4222-8222-222222222222';
const FEATURE = '22222222-2222-4222-8222-333333333333';
const INTEGRATION = '44444444-4444-4444-8444-444444444444';
const BASE = 'a'.repeat(40);
const CARD_SHA = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const ahead = async () => 'ahead' as const;

const TICKS = {
  criterionDeltas: {
    deltas: [
      { requirementId: 'REQ-001', text: 'signs in', direction: 'tick' },
      { requirementId: 'REQ-002', text: 'signs out', direction: 'untick' },
    ],
    flagged: [],
  },
  taskDeltas: { deltas: [{ nodeId: 'n1', key: 'k1', displayId: 'T1', title: 'wire auth', direction: 'tick' }], flagged: [] },
};

function world(cards: Array<Record<string, unknown>> = []) {
  const sb = new MemorySupabase();
  sb.table('branches', [
    { id: MAIN, project_id: PROJECT, name: 'main', is_primary: true, last_synced_commit: BASE },
    { id: FEATURE, project_id: PROJECT, name: 'feature', is_primary: false, last_synced_commit: BASE },
  ]);
  sb.table('git_change_events', cards.map((c) => ({ project_id: PROJECT, status: 'pending', commit_sha: CARD_SHA, ...c })));
  sb.table('git_sync_log', []);
  return sb;
}
const card = (sb: MemorySupabase, id: string) => sb.rowsOf('git_change_events').find((r) => r.id === id)!;
const baselineOf = (sb: MemorySupabase, id = MAIN) => sb.rowsOf('branches').find((r) => r.id === id)!.last_synced_commit;

// ── ticks ────────────────────────────────────────────────────────────────

Deno.test('AD.1d (D6): unapplied ticks count ticks only, and each stamp clears its kind', () => {
  assertEquals(unappliedTicks(TICKS), { criteria: 1, tasks: 1 }, 'an untick never counts');
  assertEquals(unappliedTicks({ ...TICKS, criteriaApplied: { at: 't', count: 1 } }), { criteria: 0, tasks: 1 });
  assertEquals(unappliedTicks({ ...TICKS, ticksApplied: { at: 't', count: 1 } }), { criteria: 1, tasks: 0 });
  assertEquals(hasUnappliedTicks({}), false);
  assertEquals(ticksPhrase({ criteria: 2, tasks: 1 }), '2 criterion ticks and 1 task tick');
});

Deno.test('AD.1d (D6, I7): accepting a card with ticks nobody applied is refused; the card and the baseline stay', async () => {
  const sb = world([{ id: 'e1', metadata: { source: 'sweep', branchName: 'main', ...TICKS } }]);
  const r = await resolveCard(sb as never, {
    projectId: PROJECT, eventId: 'e1', resolution: 'accepted', expectedCommitSha: CARD_SHA, resolvedBy: 'u', ancestry: ahead,
  });
  assertEquals(r.ok, false);
  assertEquals((r as { code: string }).code, 'ticks-unapplied');
  assert((r as { message: string }).message.includes('1 criterion tick and 1 task tick'), 'names them');
  assertEquals(card(sb, 'e1').status, 'pending');
  assertEquals(baselineOf(sb), BASE);
});

Deno.test('AD.1d: an accept whose stamps apply every tick resolves in the same write and moves the baseline', async () => {
  const sb = world([{ id: 'e1', metadata: { source: 'sweep', branchName: 'main', ...TICKS } }]);
  const r = await resolveCard(sb as never, {
    projectId: PROJECT, eventId: 'e1', resolution: 'accepted', expectedCommitSha: CARD_SHA, resolvedBy: 'u', ancestry: ahead,
    metadataPatch: { criteriaApplied: { at: 't', count: 1 }, ticksApplied: { at: 't', count: 1 } },
  });
  assertEquals(r.ok, true, JSON.stringify(r));
  assertEquals(card(sb, 'e1').status, 'accepted');
  assertEquals((card(sb, 'e1').metadata as { ticksApplied: unknown }).ticksApplied, { at: 't', count: 1 });
  assertEquals(baselineOf(sb), CARD_SHA);
});

Deno.test('AD.1d (D6): a dismiss names the ticks it sets aside on the card; a card without ticks records none', async () => {
  const sb = world([
    { id: 'e1', metadata: { source: 'sweep', branchName: 'main', ...TICKS } },
    { id: 'e2', metadata: { source: 'sweep', branchName: 'feature' } },
  ]);
  const r1 = await resolveCard(sb as never, { projectId: PROJECT, eventId: 'e1', resolution: 'dismissed', expectedCommitSha: CARD_SHA, resolvedBy: 'u', ancestry: ahead });
  assertEquals(r1.ok, true);
  const dismissed = card(sb, 'e1').metadata as { ticksDismissed: { criteria: number; tasks: number } };
  assertEquals(card(sb, 'e1').status, 'dismissed');
  assertEquals([dismissed.ticksDismissed.criteria, dismissed.ticksDismissed.tasks], [1, 1]);
  const r2 = await resolveCard(sb as never, { projectId: PROJECT, eventId: 'e2', resolution: 'dismissed', expectedCommitSha: CARD_SHA, resolvedBy: 'u', ancestry: ahead });
  assertEquals(r2.ok, true);
  assert(!('ticksDismissed' in (card(sb, 'e2').metadata as Record<string, unknown>)), 'nothing to name');
});

// ── a load answers only its own cards ────────────────────────────────────

Deno.test('AD.1d (D7): a load answers a card only when every flagged plane is loaded and nothing else is left on it', () => {
  assertEquals(cardAnsweredByLoads({ source: 'sweep', modelChanged: false }, ['model']), false, 'a content-only card flags no plane');
  assertEquals(cardAnsweredByLoads({ source: 'sweep', modelChanged: true }, ['model']), true);
  assertEquals(cardAnsweredByLoads({ source: 'connect-anchor-mismatch' }, ['model']), true);
  assertEquals(cardAnsweredByLoads({ source: 'sweep', modelChanged: true, specChanged: true }, ['model']), false, 'the spec question is live');
  assertEquals(cardAnsweredByLoads({ source: 'sweep', modelChanged: true, specChanged: true }, ['model', 'spec']), true);
  assertEquals(cardAnsweredByLoads({ source: 'sweep', modelChanged: true, artifactMatches: [{ path: 'src/a.ts' }] }, ['model']), false, 'bound files wait for their accept');
  assertEquals(cardAnsweredByLoads({ source: 'sweep', modelChanged: true, residuePaths: ['x.md'] }, ['model']), false, 'residue waits');
  assertEquals(cardAnsweredByLoads({ source: 'sweep', modelChanged: true, residuePaths: ['x.md'], ignoredResidue: ['x.md'] }, ['model']), true, 'ignored residue is answered');
  assertEquals(cardAnsweredByLoads({ source: 'sweep', modelChanged: true, ...TICKS }, ['model']), false, 'ticks wait');
});

Deno.test('AD.1d (D7): a card belongs to its named branch; an unnamed one to the primary; an unmapped ref to none', () => {
  const main = { name: 'main', isPrimary: true };
  const feature = { name: 'feature', isPrimary: false };
  assertEquals(cardOnBranch({ branchName: 'feature' }, feature), true);
  assertEquals(cardOnBranch({ branchName: 'feature' }, main), false);
  assertEquals(cardOnBranch({}, main), true);
  assertEquals(cardOnBranch({}, feature), false);
  assertEquals(cardOnBranch({ unmappedRef: true }, main), false);
});

Deno.test('AD.1d (D7): planCardsAfterLoad touches only this branch\'s cards that flagged the plane', () => {
  const cards = [
    { id: 'answered', commit_sha: CARD_SHA, metadata: { source: 'sweep', branchName: 'main', modelChanged: true } },
    { id: 'other-branch', commit_sha: CARD_SHA, metadata: { source: 'sweep', branchName: 'feature', modelChanged: true } },
    { id: 'content-only', commit_sha: CARD_SHA, metadata: { source: 'sweep', branchName: 'main', modelChanged: false } },
    { id: 'webhook', commit_sha: CARD_SHA, metadata: { branchName: 'main' } },
    { id: 'both-planes', commit_sha: CARD_SHA, metadata: { source: 'sweep', branchName: 'main', modelChanged: true, specChanged: true } },
    { id: 'with-files', commit_sha: CARD_SHA, metadata: { source: 'sweep', branchName: 'main', modelChanged: true, artifactMatches: [{ path: 'a' }] } },
    { id: 'with-ticks', commit_sha: CARD_SHA, metadata: { source: 'sweep', branchName: 'main', modelChanged: true, ...TICKS } },
  ];
  const plan = planCardsAfterLoad(cards, 'model', { name: 'main', isPrimary: true }, HEAD);
  assertEquals(plan.answered.map((c) => c.id), ['answered']);
  assertEquals(plan.progressed.map((c) => c.id), ['both-planes', 'with-files', 'with-ticks']);
  assertEquals(plan.answered[0].metadata.resolution, 'restored-from-repo');
  assertEquals(plan.progressed[0].metadata.restoredPlanes, ['model']);
  assert(!('resolution' in plan.progressed[0].metadata), 'a half-answered card is not marked resolved');
  const spec = planCardsAfterLoad(cards, 'spec', { name: 'main', isPrimary: true }, HEAD);
  assertEquals(spec.answered.map((c) => c.id), [], 'the model question is still live on both-planes');
  assertEquals(spec.progressed.map((c) => c.id), ['both-planes']);
});

Deno.test('AD.1d (D7): a model load then a spec load answer a two-plane card; the other branch\'s card stays; no baseline moves here', async () => {
  const sb = world([
    { id: 'both', metadata: { source: 'sweep', branchName: 'main', modelChanged: true, specChanged: true } },
    { id: 'feature', metadata: { source: 'sweep', branchName: 'feature', modelChanged: true } },
  ]);
  const main = { name: 'main', isPrimary: true };
  assertEquals(await resolveCardsAfterRestore(sb as never, PROJECT, HEAD, 'model', main), { answered: 0, progressed: 1 });
  assertEquals(card(sb, 'both').status, 'pending');
  assertEquals((card(sb, 'both').metadata as { restoredPlanes: string[] }).restoredPlanes, ['model']);
  assertEquals(await resolveCardsAfterRestore(sb as never, PROJECT, HEAD, 'spec', main), { answered: 1, progressed: 0 });
  assertEquals(card(sb, 'both').status, 'accepted');
  assertEquals(card(sb, 'feature').status, 'pending', 'another branch\'s card is never answered');
  assertEquals(baselineOf(sb), BASE, 'the load decides the baseline, not the card');
});

Deno.test('AD.1d: a card the sync check rewrote since the load read it is not accepted', async () => {
  const sb = world([{ id: 'e1', metadata: { source: 'sweep', branchName: 'main', modelChanged: true } }]);
  // The load plans against the card as read, then the sweep rewrites it.
  const plan = planCardsAfterLoad(sb.rowsOf('git_change_events').map((r) => ({ ...r })), 'model', { name: 'main', isPrimary: true }, HEAD);
  card(sb, 'e1').commit_sha = HEAD;
  const [answered] = plan.answered;
  const { data } = await (sb as never as { from: (t: string) => any }).from('git_change_events')
    .update({ status: 'accepted', metadata: answered.metadata })
    .eq('id', answered.id).eq('status', 'pending').eq('commit_sha', answered.commitSha).select('id');
  assertEquals((data as unknown[]).length, 0, 'the conditional write misses');
  assertEquals(card(sb, 'e1').status, 'pending');
  const drift = Deno.readTextFileSync(new URL('../_shared/git-drift.ts', import.meta.url));
  const fn = drift.slice(drift.indexOf('export async function resolveCardsAfterRestore('), drift.indexOf('export async function moveBaselineAfterLoad('));
  assertEquals((fn.match(/\.eq\("commit_sha", card\.commitSha\)/g) ?? []).length, 2, 'both writes are conditional on the version read');
});

// ── a load moves the last sync only as far as it answers git ─────────────

Deno.test('AD.1d (I3): loadCoversRange is true only when the range is the loaded anchor', () => {
  assertEquals(loadCoversRange([], '.nodespec/model.json'), true);
  assertEquals(loadCoversRange([{ path: '.nodespec/model.json' }], '.nodespec/model.json'), true);
  assertEquals(loadCoversRange([{ path: '.nodespec/model.json' }, { path: 'src/a.ts' }], '.nodespec/model.json'), false);
  assertEquals(loadCoversRange([{ path: '.nodespec/spec.json' }], '.nodespec/model.json'), false);
  assertEquals(loadCoversRange([{ path: '.nodespec/model.json', oldPath: 'x.json' }], '.nodespec/model.json'), false);
});

function stubCompare(files: Array<Record<string, unknown>> | null): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    files === null
      ? new Response('down', { status: 500 })
      : new Response(JSON.stringify({ files, commits: [{ sha: 'd'.repeat(40), commit: { message: 'm' } }] }), { status: 200 })
  ) as typeof fetch;
  return () => { globalThis.fetch = real; };
}
const forward = (current: string | null = BASE): BaselinePlan => ({
  branchId: MAIN, current, to: HEAD, decision: current ? { move: true, outcome: 'forward' } : { move: true, outcome: 'first' },
});
const loadArgs = (plan: BaselinePlan) => ({
  plan, anchorPath: '.nodespec/model.json', provider: 'github', apiBase: 'https://api.github.test',
  owner: 'o', repo: 'r', token: 't', integrationId: INTEGRATION,
});

Deno.test('AD.1d (I3): a forward load moves the baseline when model.json is all git changed', async () => {
  const sb = world();
  const restore = stubCompare([{ filename: '.nodespec/model.json', status: 'modified', sha: 'f1' }]);
  try {
    const r = await moveBaselineAfterLoad(sb as never, loadArgs(forward()));
    assertEquals(r, { moved: true, note: null });
    assertEquals(baselineOf(sb), HEAD);
  } finally { restore(); }
});

Deno.test('AD.1d (I3): a forward load keeps the baseline when git also changed a file the load does not bring', async () => {
  const sb = world();
  const restore = stubCompare([
    { filename: '.nodespec/model.json', status: 'modified', sha: 'f1' },
    { filename: 'src/a.ts', status: 'modified', sha: 'f2' },
  ]);
  try {
    const r = await moveBaselineAfterLoad(sb as never, loadArgs(forward()));
    assertEquals(r, { moved: false, note: LOAD_KEPT_BASELINE_NOTE });
    assertEquals(baselineOf(sb), BASE);
  } finally { restore(); }
});

Deno.test('AD.1d (I3): a file NodeSpec itself wrote from another branch does not hold the baseline (a merge arriving)', async () => {
  const sb = world();
  sb.rowsOf('git_sync_log').push({
    integration_id: INTEGRATION, direction: 'push', status: 'success', commit_sha: 'd'.repeat(40), branch_id: FEATURE,
    metadata: { nodespecPush: true, blobs: { 'src/a.ts': 'f2' }, deleted: [] },
  });
  const restore = stubCompare([
    { filename: '.nodespec/model.json', status: 'modified', sha: 'f1' },
    { filename: 'src/a.ts', status: 'modified', sha: 'f2' },
  ]);
  try {
    const r = await moveBaselineAfterLoad(sb as never, loadArgs(forward()));
    assertEquals(r.moved, true);
    assertEquals(baselineOf(sb), HEAD);
  } finally { restore(); }
});

Deno.test('AD.1d (I3, I8): a range the provider cannot compare keeps the baseline; a first baseline needs no compare', async () => {
  const sb = world();
  const restore = stubCompare(null);
  try {
    assertEquals((await moveBaselineAfterLoad(sb as never, loadArgs(forward()))).moved, false);
    assertEquals(baselineOf(sb), BASE);
    sb.rowsOf('branches').find((r) => r.id === MAIN)!.last_synced_commit = null;
    assertEquals((await moveBaselineAfterLoad(sb as never, loadArgs(forward(null)))).moved, true, 'first');
    assertEquals(baselineOf(sb), HEAD);
  } finally { restore(); }
});

// ── the sync check never runs an automatic lane past ticks or bound files ──

Deno.test('AD.1d: neither automatic lane runs past ticks; auto-restore never past bound-file edits; a matched spec fast-forwards', () => {
  const base = {
    refDeleted: false, refMoved: true, modelChanged: true, canvasMatchesHead: false, canvasMatchesBaseline: false,
    matchedArtifactCount: 0, residueCount: 0, userInitiated: true,
  };
  assertEquals(decideBranchFreshness({ ...base, canvasMatchesHead: true }), 'baseline-fast-forward');
  assertEquals(decideBranchFreshness({ ...base, canvasMatchesHead: true, carriesTicks: true }), 'card');
  assertEquals(decideBranchFreshness({ ...base, canvasMatchesBaseline: true }), 'auto-restore');
  assertEquals(decideBranchFreshness({ ...base, canvasMatchesBaseline: true, carriesTicks: true }), 'card');
  assertEquals(decideBranchFreshness({ ...base, canvasMatchesBaseline: true, matchedArtifactCount: 1 }), 'card', 'a load brings no file content');
  const specOnly = { ...base, modelChanged: false, specChanged: true, specDivergent: false };
  assertEquals(decideBranchFreshness(specOnly), 'baseline-fast-forward', 'the requirements already match');
  assertEquals(decideBranchFreshness({ ...specOnly, specDivergent: true }), 'card');
  assertEquals(decideBranchFreshness({ ...specOnly, matchedArtifactCount: 1 }), 'card');
});

// ── wiring ───────────────────────────────────────────────────────────────

Deno.test('AD.1d wiring: both loads decide the baseline from the range and answer only this branch\'s cards', () => {
  const drift = Deno.readTextFileSync(new URL('../_shared/git-drift.ts', import.meta.url));
  // AD.2b: the model load is a proposal; its baseline and cards move when a
  // person accepts it (git-pull proposal-baseline), through the same rules.
  const pull = Deno.readTextFileSync(new URL('../git-pull/index.ts', import.meta.url));
  const accept = pull.slice(pull.indexOf('async function handleProposalBaseline('), pull.indexOf('async function handleTreeScan('));
  assert(/moveBaselineAfterLoad\(serviceClient, \{\s*plan, anchorPath: MODEL_ANCHOR_PATH/.test(accept), 'the accepted load moves by the range rule');
  assert(/resolveCardsAfterRestore\(serviceClient, integration\.project_id, loads\.headSha, "model", \{\s*name: branch\.name, isPrimary: isPrimaryRow\(branch\)/.test(accept));
  const spec = drift.slice(drift.indexOf('export async function restoreSpecFromRef('), drift.indexOf('export type ModelLoadResult'));
  assert(/specRead\.status === "failed"/.test(spec), 'an unreadable spec is not an absent one');
  assert(/if \(branch\.last_synced_commit\) \{[\s\S]{0,600}anchorPath: SPEC_ANCHOR_PATH/.test(spec), 'a spec load sets no first baseline');
  assert(/resolveCardsAfterRestore\(supabase, projectId, headSha, "spec", \{/.test(spec));
  const own = drift.slice(drift.indexOf('async function dismissCardsCoveredByOwnRange('), drift.indexOf('export type DriftSweepStatus'));
  assert(/hasUnappliedTicks\(card\?\.metadata\)\) continue/.test(own), 'the own-range dismiss keeps a card with ticks');
  assert(/carriesTicks: hasUnappliedTicks\(\{ criterionDeltas, taskDeltas \}\)/.test(drift), 'the sweep feeds the ladder its ticks');
});

Deno.test('AD.1d wiring: an accepted reconcile proposal resolves its card as the version the agent read', () => {
  const pull = Deno.readTextFileSync(new URL('../git-pull/index.ts', import.meta.url));
  const fn = pull.slice(pull.indexOf('async function handleProposalBaseline('), pull.indexOf('async function handleTreeScan('));
  assert(/proposal\.status !== "merged" && proposal\.status !== "accepted"/.test(fn), 'only an accepted proposal');
  assert(/resolveCard\(serviceClient, \{[\s\S]{0,300}expectedCommitSha: String\(reconciles\.commitSha/.test(fn));
  assert(/advanceBaseline\(serviceClient, \{ branchId: branch\.id, to: sha, ancestry \}\)/.test(fn), 'the adopt path is unchanged');
  assert(!/adopt-baseline/.test(pull), 'the old mode name is gone');
});

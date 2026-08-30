// R3-5 · Repository activity panel (owner 2026-07-30: "an intuitive side panel
// that tracks drift/commit actions… where the user can see where maybe they
// accidentally didn't approve or bind an artifact after merge… ensure that if
// they do this later, it's not creating another race condition that diverges
// from how git versioning works").
//
// Two halves are pinned here:
//   1. the PURE derivation (deriveUnfinishedBusiness / mergeRepoActivity) — the
//      "did I forget to bind?" logic, testable without a DOM;
//   2. the panel's race-safety contract — the ONLY two writes it makes, and the
//      late-action rule it deliberately does NOT implement.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  deriveUnfinishedBusiness, mergeRepoActivity, formatActivityTime, shortSha, changeBranch,
  deriveAheadOfGit, shouldAutoPushOnAccept,
} from '../ui/components/panels/repoActivity.js';
import type { GitChangeEvent, RepoSyncEvent } from '../ui/services/GitService.js';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');

const card = (over: Partial<GitChangeEvent> = {}): GitChangeEvent => ({
  id: 'card-1',
  commitSha: 'abcdef1234567890',
  commitMessage: 'Update from NodeSpec: 2 files from feature-x',
  author: 'someone',
  changedFiles: [{ path: 'src/a.ts', action: 'modified' }],
  status: 'pending',
  createdAt: '2026-07-30T10:00:00.000Z',
  ...over,
});

const sync = (over: Partial<RepoSyncEvent> = {}): RepoSyncEvent => ({
  id: 'sync-1',
  direction: 'push',
  commitSha: '1111111222222',
  status: 'success',
  startedAt: '2026-07-30T11:00:00.000Z',
  patchesSynced: 0,
  metadata: {},
  ...over,
});

describe('deriveUnfinishedBusiness — the "I forgot to finish this" surface', () => {
  it('a pending card on this branch is an unanswered detection', () => {
    const items = deriveUnfinishedBusiness({ changes: [card()], branchName: 'main' });
    expect(items.filter(i => i.kind === 'unanswered')).toHaveLength(1);
    expect(items[0].sha).toBe('abcdef1234567890');
  });

  it('cards belonging to ANOTHER design branch are not this branch\'s business', () => {
    const items = deriveUnfinishedBusiness({
      changes: [card({ branchName: 'feature-x' })], branchName: 'main',
    });
    expect(items).toHaveLength(0);
  });

  it('a legacy card with no branchName belongs to main (R3-3c convention)', () => {
    expect(changeBranch(card())).toBe('main');
    expect(deriveUnfinishedBusiness({ changes: [card()], branchName: 'main' })).toHaveLength(1);
  });

  // THE owner case: a merge landed, the user never bound the new file, and then
  // the card got resolved — the bind question survived its card.
  it('unbound residue on a RESOLVED card still counts — resolving never answered the bind', () => {
    const items = deriveUnfinishedBusiness({
      changes: [card({ status: 'accepted', residuePaths: ['docs/new.md', 'src/b.ts'] })],
      branchName: 'main',
    });
    const unbound = items.filter(i => i.kind === 'unbound');
    expect(unbound).toHaveLength(1);
    expect(unbound[0].title).toContain('2 files');
    expect(unbound[0].detail).toContain('accepted');
    expect(unbound[0].detail).toContain('docs/new.md');
  });

  it('residue the user explicitly ignored is not unfinished business', () => {
    const items = deriveUnfinishedBusiness({
      changes: [card({
        status: 'dismissed',
        residuePaths: ['docs/new.md', 'src/b.ts'],
        ignoredResidue: ['docs/new.md', 'src/b.ts'],
      })],
      branchName: 'main',
    });
    expect(items.filter(i => i.kind === 'unbound')).toHaveLength(0);
  });

  it('partially-ignored residue reports only what is still unbound', () => {
    const items = deriveUnfinishedBusiness({
      changes: [card({ status: 'accepted', residuePaths: ['a.md', 'b.md'], ignoredResidue: ['a.md'] })],
      branchName: 'main',
    });
    const unbound = items.filter(i => i.kind === 'unbound')[0];
    expect(unbound.title).toContain('1 file');
    expect(unbound.detail).toContain('b.md');
    expect(unbound.detail).not.toContain('a.md,');
  });

  it('a behind sweep raises the "load the model" prompt; a clean one does not', () => {
    expect(deriveUnfinishedBusiness({ changes: [], branchName: 'main', sweepStatus: 'behind_in_sync' })
      .some(i => i.kind === 'behind')).toBe(true);
    expect(deriveUnfinishedBusiness({ changes: [], branchName: 'main', sweepStatus: 'drift' })
      .some(i => i.kind === 'behind')).toBe(true);
    expect(deriveUnfinishedBusiness({ changes: [], branchName: 'main', sweepStatus: 'clean' })
      .some(i => i.kind === 'behind')).toBe(false);
    // A bookkeeping fast-forward is not "behind" — nothing for the user to do.
    expect(deriveUnfinishedBusiness({ changes: [], branchName: 'main', sweepStatus: 'fast_forwarded' })
      .some(i => i.kind === 'behind')).toBe(false);
  });

  it('nothing outstanding yields an empty list (the section renders only when non-empty)', () => {
    const items = deriveUnfinishedBusiness({
      changes: [card({ status: 'accepted' })], branchName: 'main', sweepStatus: 'clean',
    });
    expect(items).toEqual([]);
  });
});

describe('mergeRepoActivity — one honest record of what happened', () => {
  it('a push reads as a commit and reports the stale files it cleaned', () => {
    const [entry] = mergeRepoActivity({
      syncEvents: [sync({ metadata: { fileCount: 3, deletedPaths: ['src/old.ts'] } })],
      changes: [], branchName: 'main',
    });
    expect(entry.kind).toBe('commit');
    expect(entry.title).toContain('3 files');
    expect(entry.detail).toContain('removed 1 stale file');
  });

  it('a skipped cleanup is surfaced, not swallowed', () => {
    const [entry] = mergeRepoActivity({
      syncEvents: [sync({ metadata: { fileCount: 1, cleanupSkipped: 'unreadable-anchor' } })],
      changes: [], branchName: 'main',
    });
    expect(entry.detail).toContain('cleanup skipped');
    expect(entry.detail).toContain('unreadable-anchor');
  });

  it('the two pull lanes are distinguished: a model load vs a file read', () => {
    const entries = mergeRepoActivity({
      syncEvents: [
        sync({ id: 's1', direction: 'pull', metadata: {} }),
        sync({ id: 's2', direction: 'pull', startedAt: '2026-07-30T09:00:00.000Z', metadata: { fileCount: 4, subPath: '/' } }),
      ],
      changes: [], branchName: 'main',
    });
    expect(entries.find(e => e.id === 's1')?.kind).toBe('load');
    expect(entries.find(e => e.id === 's1')?.title).toContain('Loaded the repository model');
    expect(entries.find(e => e.id === 's2')?.kind).toBe('fetch');
    expect(entries.find(e => e.id === 's2')?.title).toContain('4 files');
  });

  it('a failed sync is reported as failed, not as a successful commit', () => {
    const [entry] = mergeRepoActivity({
      syncEvents: [sync({ status: 'failed', errorMessage: 'provider 403\nmore detail' })],
      changes: [], branchName: 'main',
    });
    expect(entry.kind).toBe('failed');
    expect(entry.detail).toBe('provider 403');
  });

  it('sync rows stamped for another design branch are excluded; project-level rows are kept', () => {
    const entries = mergeRepoActivity({
      syncEvents: [
        sync({ id: 'mine', branchId: 'b-1' }),
        sync({ id: 'theirs', branchId: 'b-2' }),
        sync({ id: 'project-level', branchId: null }),
      ],
      changes: [], branchName: 'main', branchId: 'b-1',
    });
    expect(entries.map(e => e.id).sort()).toEqual(['mine', 'project-level']);
  });

  it('change events fold their resolution into the entry kind', () => {
    const entries = mergeRepoActivity({
      syncEvents: [],
      changes: [
        card({ id: 'c1', status: 'pending' }),
        card({ id: 'c2', status: 'accepted', createdAt: '2026-07-30T09:00:00.000Z' }),
        card({ id: 'c3', status: 'dismissed', createdAt: '2026-07-30T08:00:00.000Z' }),
      ],
      branchName: 'main',
    });
    expect(entries.map(e => e.kind)).toEqual(['detected', 'accepted', 'dismissed']);
    expect(entries[2].title).toContain('the canvas version won');
  });

  it('commits and detections interleave strictly newest-first', () => {
    const entries = mergeRepoActivity({
      syncEvents: [sync({ id: 'push-late', startedAt: '2026-07-30T12:00:00.000Z' })],
      changes: [card({ id: 'card-early', createdAt: '2026-07-30T10:00:00.000Z' })],
      branchName: 'main',
    });
    expect(entries.map(e => e.id)).toEqual(['push-late', 'card-early']);
  });

  it('the timeline is capped', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      sync({ id: `s${i}`, startedAt: `2026-07-30T${String(i % 24).padStart(2, '0')}:00:00.000Z` }));
    expect(mergeRepoActivity({ syncEvents: many, changes: [], branchName: 'main', limit: 10 })).toHaveLength(10);
  });
});

describe('formatting helpers', () => {
  it('shortSha is 7 chars and tolerates nothing', () => {
    expect(shortSha('abcdef1234567')).toBe('abcdef1');
    expect(shortSha(null)).toBe('');
  });

  it('relative time degrades to an absolute stamp past a day', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');
    expect(formatActivityTime('2026-07-30T11:59:40.000Z', now)).toBe('just now');
    expect(formatActivityTime('2026-07-30T11:30:00.000Z', now)).toBe('30m ago');
    expect(formatActivityTime('2026-07-30T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatActivityTime('2026-07-25T09:00:00.000Z', now)).not.toContain('ago');
  });
});

// ── The race-safety contract (owner's explicit constraint) ────────────────────
describe('R3-5 panel: the only two writes, and the one it deliberately omits', () => {
  it('the Changes home is a SIDE panel with three tabs', () => {
    const source = read('ui/components/panels/ChangesPanel.tsx');
    expect(source).toContain("position: 'fixed', top: '68px', right: '12px', bottom: '12px'");
    expect(source).toContain("tabButton('pending'");
    expect(source).toContain("tabButton('repository'");
    expect(source).toContain("tabButton('history'");
  });

  it('"Check for changes now" is the same forced, branch-scoped sweep the page load runs', () => {
    const source = read('ui/components/panels/ChangesPanel.tsx');
    expect(source).toContain("gitService.detectDrift(integration.id, { branchName: branchName || 'main', force: true })");
  });

  // The banked gap closed here: the R3-1 loader used to exist ONLY on a detection
  // card, so a swallowed merge needed SQL to recover.
  it('"Load repo model onto canvas" is card-independent and resolves the CURRENT head', () => {
    const source = read('ui/components/panels/ChangesPanel.tsx');
    expect(source).toContain('Load repo model onto canvas');
    // restoreModel resolves the ref's head server-side — no sha is ever passed in
    // from a card, so a stale record can never be replayed.
    expect(source).toContain("gitService.restoreModel(integration.id, branchName || 'main')");
    expect(source).not.toContain('restoreModel(integration.id, branchName, change');
  });

  it('the panel never resolves a card and never writes a baseline itself', () => {
    const source = read('ui/components/panels/ChangesPanel.tsx');
    // Resolving stays in the Git panel: re-resolving a stale card would REGRESS
    // the sync baseline (the recovery lane's rule, restated for this surface).
    expect(source).not.toContain('resolveChangeEvent');
    expect(source).not.toContain('last_synced_commit');
    expect(source).toContain('Open the Git panel to resolve');
  });

  it('the load action confirms what it replaces before running', () => {
    const source = read('ui/components/panels/ChangesPanel.tsx');
    expect(source).toContain('window.confirm(');
    expect(source).toContain('Your git history is untouched');
  });

  it('GraphEditor gives the panel the branch it reports on and a canvas refresh', () => {
    const source = read('ui/components/GraphEditor.tsx');
    expect(source).toContain('onModelRestored={refreshGraph}');
    expect(source).toContain('onOpenGitPanel={() => setShowGitModal(true)}');
    expect(source).toContain("branchName={branchName || 'main'}");
  });

  it('the panel reads resolved cards too — otherwise unbound residue vanishes with the card', () => {
    const service = read('ui/services/GitService.ts');
    expect(service).toContain('async getRecentChangeEvents(');
    expect(service).toContain('async getRepoSyncEvents(');
    // No status filter on the recent-events read.
    const block = service.slice(service.indexOf('async getRecentChangeEvents('), service.indexOf('async getRepoSyncEvents('));
    expect(block).not.toContain(".eq('status'");
    expect(block).not.toContain(".in('status'");
  });
});

// ── R4: auto-push on accept + the "ahead of git" indicator ────────────────────

describe('shouldAutoPushOnAccept — the guard that must not be automated away', () => {
  it('a baselined branch with applied patches auto-commits', () => {
    expect(shouldAutoPushOnAccept({ hasGitIntegration: true, lastSyncedCommit: 'abc', appliedPatchCount: 3 }))
      .toEqual({ push: true });
  });

  // THE rule. The R2.2 overwrite guard exists so a HUMAN confirms overwriting a
  // repo this project never synced with; an automatic action must never be the
  // thing that confirms it.
  it('an UNBASELINED branch never auto-pushes', () => {
    expect(shouldAutoPushOnAccept({ hasGitIntegration: true, lastSyncedCommit: null, appliedPatchCount: 3 }))
      .toEqual({ push: false, reason: 'unbaselined' });
  });

  it('no integration and nothing-applied both decline', () => {
    expect(shouldAutoPushOnAccept({ hasGitIntegration: false, lastSyncedCommit: 'abc', appliedPatchCount: 3 }).push).toBe(false);
    expect(shouldAutoPushOnAccept({ hasGitIntegration: true, lastSyncedCommit: 'abc', appliedPatchCount: 0 }))
      .toEqual({ push: false, reason: 'nothing-applied' });
  });
});

describe('deriveAheadOfGit — derived from reality, not from a flag we set', () => {
  const push = (at: string, over: Partial<RepoSyncEvent> = {}): RepoSyncEvent => ({
    id: `p-${at}`, direction: 'push', commitSha: 'sha', status: 'success', startedAt: at, metadata: {}, ...over,
  });

  it('a patch applied after the last commit reads as ahead', () => {
    expect(deriveAheadOfGit({
      syncEvents: [push('2026-07-31T10:00:00.000Z')],
      latestPatchAt: '2026-07-31T11:00:00.000Z',
    }).ahead).toBe(true);
  });

  it('a commit after the last patch is up to date', () => {
    expect(deriveAheadOfGit({
      syncEvents: [push('2026-07-31T12:00:00.000Z')],
      latestPatchAt: '2026-07-31T11:00:00.000Z',
    }).ahead).toBe(false);
  });

  it('a FAILED push does not count as having published anything', () => {
    expect(deriveAheadOfGit({
      syncEvents: [push('2026-07-31T12:00:00.000Z', { status: 'failed' })],
      latestPatchAt: '2026-07-31T11:00:00.000Z',
    }).ahead).toBe(false);
  });

  it('a never-pushed branch is NOT reported as ahead — that is a different sentence', () => {
    expect(deriveAheadOfGit({ syncEvents: [], latestPatchAt: '2026-07-31T11:00:00.000Z' }).ahead).toBe(false);
  });

  it('another branch\'s commits do not clear this branch\'s ahead state', () => {
    expect(deriveAheadOfGit({
      syncEvents: [push('2026-07-31T12:00:00.000Z', { branchId: 'other' })],
      branchId: 'mine',
      latestPatchAt: '2026-07-31T11:00:00.000Z',
    }).ahead).toBe(false);
  });

  it('the unfinished-business list names it', () => {
    const items = deriveUnfinishedBusiness({
      changes: [], branchName: 'main',
      aheadOfGit: { ahead: true, lastPushAt: '2026-07-31T10:00:00.000Z' },
    });
    expect(items.filter(i => i.kind === 'ahead')).toHaveLength(1);
    expect(items[0].title).toContain('ahead of its git branch');
  });
});

describe('R4 wiring', () => {
  it('the accept path auto-pushes and never blocks on it', () => {
    const source = read('ui/components/GraphEditor.tsx');
    expect(source).toContain('void autoPushAfterAccept(');
    // fire-and-forget AFTER the accept has already succeeded
    expect(source.indexOf('await proposalService.acceptProposal(activeProposal.id)'))
      .toBeLessThan(source.indexOf('void autoPushAfterAccept('));
  });

  it('auto-push NEVER confirms the overwrite guard', () => {
    const source = read('ui/components/GraphEditor.tsx');
    expect(source).toContain('gitService.push(projectId, branchName || \'main\', integration.id, false, title)');
    expect(source).not.toContain('integration.id, true, title');
  });

  it('the commit subject is the proposal title, and the prefix stays server-side', () => {
    const source = read('ui/components/GraphEditor.tsx');
    expect(source).toContain('const proposalTitle = (p: AIProposal): string =>');
    // The client must never construct the self-push prefix itself.
    expect(source).not.toContain('Update from NodeSpec:');
  });

  it('a push failure reports "ahead of git" instead of failing the accept', () => {
    const source = read('ui/components/GraphEditor.tsx');
    expect(source).toContain('Your design is ahead of git');
  });
});

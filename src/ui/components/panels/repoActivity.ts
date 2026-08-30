// R3-5 · Repository activity panel — the PURE half.
//
// Everything the Repository tab shows is derived from records that already
// exist: `git_sync_log` (commits pushed, models loaded) and `git_change_events`
// (detections and how they were resolved). Keeping the derivation here — no
// React, no Supabase — is what makes "did I forget to bind a file after that
// merge?" a testable question instead of a rendering accident.
//
// RACE SAFETY (owner constraint, 2026-07-30): nothing in this module writes.
// It reports. The panel's only two writes are the forced drift sweep and the
// R3-1 model load, both of which resolve the ref's CURRENT head — so a late
// action converges on git's own state instead of replaying a stale one.
import type { GitChangeEvent, RepoSyncEvent } from '../../services/GitService.js';

export type { RepoSyncEvent };

export type RepoActivityKind = 'commit' | 'load' | 'fetch' | 'detected' | 'accepted' | 'dismissed' | 'failed';

export interface RepoActivityEntry {
  id: string;
  kind: RepoActivityKind;
  at: string;
  sha: string | null;
  title: string;
  detail?: string;
}

export type UnfinishedKind = 'unanswered' | 'unbound' | 'behind' | 'ahead';

export interface UnfinishedItem {
  id: string;
  kind: UnfinishedKind;
  title: string;
  detail: string;
  sha?: string | null;
}

/** Legacy cards carry no branchName — they belong to main (R3-3c convention). */
export function changeBranch(change: GitChangeEvent): string {
  return change.branchName || 'main';
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '';
}

function firstLine(text: string | undefined | null): string {
  if (!text) return '';
  const line = text.split('\n')[0].trim();
  return line.length > 96 ? `${line.slice(0, 93)}…` : line;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The owner's question: "where maybe they accidentally didn't approve or bind an
 * artifact after merge".
 *
 * Three kinds, deliberately no more:
 *  - `unanswered` — a card on this branch is still pending; nobody chose a side.
 *  - `unbound`    — files a commit brought in that belong to no node and were
 *                   never explicitly ignored. Derived from EVERY card, resolved
 *                   ones included: residue is recorded ON the card, so resolving
 *                   the card does not answer the bind question, and that is
 *                   exactly the case that used to disappear from the UI.
 *  - `behind`     — the last sweep said this branch's canvas is behind its ref
 *                   and no load has happened since.
 */
export function deriveUnfinishedBusiness(opts: {
  changes: GitChangeEvent[];
  branchName: string;
  /** Last sweep status for this branch, if one has run this session. */
  sweepStatus?: string | null;
  headSha?: string | null;
  /** R4: accepted design changes that have not reached git yet. */
  aheadOfGit?: { ahead: boolean; lastPushAt: string | null };
}): UnfinishedItem[] {
  const { changes, branchName, sweepStatus, headSha, aheadOfGit } = opts;
  const mine = changes.filter((c) => changeBranch(c) === branchName);
  const items: UnfinishedItem[] = [];

  for (const change of mine) {
    if (change.status !== 'pending') continue;
    items.push({
      id: `unanswered:${change.id}`,
      kind: 'unanswered',
      title: `Detected change you haven't answered — ${plural(change.changedFiles.length, 'file')}`,
      detail: firstLine(change.commitMessage) || 'No commit message',
      sha: change.commitSha,
    });
  }

  for (const change of mine) {
    const ignored = new Set(change.ignoredResidue || []);
    const unbound = (change.residuePaths || []).filter((p) => !ignored.has(p));
    if (unbound.length === 0) continue;
    items.push({
      id: `unbound:${change.id}`,
      kind: 'unbound',
      title: `${plural(unbound.length, 'file')} detected but never bound to a node`,
      // The resolved case is the one worth naming out loud — it is the state
      // that had no surface at all before this panel.
      detail:
        (change.status === 'pending'
          ? 'On an open detection: '
          : `Left over from a ${change.status} detection: `) + unbound.join(', '),
      sha: change.commitSha,
    });
  }

  if (sweepStatus === 'drift' || sweepStatus === 'behind_in_sync') {
    items.push({
      id: 'behind:current',
      kind: 'behind',
      title: 'This canvas is behind its git branch',
      detail:
        sweepStatus === 'behind_in_sync'
          ? 'The working copy is untouched since its baseline — loading the repository model is safe.'
          : 'The repository moved and this canvas has local changes. Review the detected change before loading.',
      sha: headSha ?? null,
    });
  }

  // R4: the other direction. `behind` says git moved without you; `ahead` says you
  // moved without git — an accepted change that never reached the repository, which
  // is precisely what a failed auto-push leaves behind.
  if (aheadOfGit?.ahead) {
    items.push({
      id: 'ahead:current',
      kind: 'ahead',
      title: 'This design is ahead of its git branch',
      detail: aheadOfGit.lastPushAt
        ? `Changes were applied after the last commit (${new Date(aheadOfGit.lastPushAt).toLocaleString()}). Commit from the Git panel to publish them.`
        : 'Applied changes have not been committed. Commit from the Git panel to publish them.',
    });
  }

  return items;
}

/**
 * R4: "the design is ahead of git" — accepted changes that have not been
 * committed. Derived, never stored: the newest applied patch on this branch is
 * later than this branch's newest successful push. No new column, and it stays
 * true for MANUAL edits too, not only for a failed auto-push — the indicator
 * describes reality rather than the outcome of one code path.
 *
 * Never-pushed branches are NOT reported as ahead: "you have not connected this
 * yet" is a different sentence, and the Status block above already says it.
 */
export function deriveAheadOfGit(opts: {
  syncEvents: RepoSyncEvent[];
  branchId?: string | null;
  /** ISO timestamp of the newest applied patch on this branch, if any. */
  latestPatchAt?: string | null;
}): { ahead: boolean; lastPushAt: string | null } {
  const { syncEvents, branchId, latestPatchAt } = opts;
  const pushes = syncEvents.filter((e) =>
    e.direction === 'push' && e.status === 'success' &&
    (!e.branchId || !branchId || e.branchId === branchId)
  );
  const lastPushAt = pushes.reduce<string | null>(
    (acc, e) => (acc === null || e.startedAt > acc ? e.startedAt : acc),
    null,
  );
  if (!latestPatchAt || !lastPushAt) return { ahead: false, lastPushAt };
  return { ahead: latestPatchAt > lastPushAt, lastPushAt };
}

/**
 * R4: may an accept auto-commit to git?
 *
 * The hard rule is the third condition. An UNBASELINED branch is exactly the case
 * the R2.2 overwrite guard exists for — pushing there would overwrite a repo
 * anchor this project has never synced with, and the guard's whole point is that a
 * HUMAN confirms that. An automatic action must never be the thing that confirms
 * it, so auto-push declines and the change simply reads as ahead-of-git until the
 * user commits explicitly.
 */
export function shouldAutoPushOnAccept(opts: {
  hasGitIntegration: boolean;
  lastSyncedCommit: string | null;
  appliedPatchCount: number;
}): { push: boolean; reason?: 'no-integration' | 'unbaselined' | 'nothing-applied' } {
  if (!opts.hasGitIntegration) return { push: false, reason: 'no-integration' };
  if (opts.appliedPatchCount <= 0) return { push: false, reason: 'nothing-applied' };
  if (!opts.lastSyncedCommit) return { push: false, reason: 'unbaselined' };
  return { push: true };
}

/**
 * One newest-first record of what this project did with its repository.
 *
 * Change events are stamped at the time the card was RAISED (their resolution
 * timestamp is not carried on the mapped row) — so a resolved card appears once,
 * at its detection time, labelled with how it ended. Inventing a second
 * timestamp would be a nicer-looking lie.
 */
export function mergeRepoActivity(opts: {
  syncEvents: RepoSyncEvent[];
  changes: GitChangeEvent[];
  branchName: string;
  /** Design-branch id for the current branch — scopes the sync log. */
  branchId?: string | null;
  limit?: number;
}): RepoActivityEntry[] {
  const { syncEvents, changes, branchName, branchId, limit = 40 } = opts;
  const entries: RepoActivityEntry[] = [];

  for (const e of syncEvents) {
    // Project-level rows (selective fetch writes no branch_id) stay visible;
    // rows stamped for ANOTHER design branch do not.
    if (e.branchId && branchId && e.branchId !== branchId) continue;
    const meta = (e.metadata || {}) as Record<string, unknown>;
    const fileCount = typeof meta.fileCount === 'number' ? meta.fileCount : (e.patchesSynced ?? 0);

    if (e.status === 'failed') {
      entries.push({
        id: e.id,
        kind: 'failed',
        at: e.startedAt,
        sha: e.commitSha,
        title: e.direction === 'push' ? 'Commit failed' : 'Repository read failed',
        detail: firstLine(e.errorMessage) || undefined,
      });
      continue;
    }

    if (e.direction === 'push') {
      const deleted = Array.isArray(meta.deletedPaths) ? (meta.deletedPaths as string[]) : [];
      const skipped = typeof meta.cleanupSkipped === 'string' ? meta.cleanupSkipped : null;
      const bits: string[] = [];
      if (deleted.length > 0) bits.push(`removed ${plural(deleted.length, 'stale file')}`);
      if (skipped) bits.push(`stale-file cleanup skipped (${skipped})`);
      entries.push({
        id: e.id,
        kind: 'commit',
        at: e.startedAt,
        sha: e.commitSha,
        title: `Committed ${plural(fileCount, 'file')} to the repository`,
        detail: bits.length > 0 ? bits.join(' · ') : undefined,
      });
      continue;
    }

    // Two different pull lanes share direction='pull': the R3-1 model load
    // (no subPath) and the selective file fetch (always records subPath).
    const isFetch = typeof meta.subPath === 'string';
    entries.push({
      id: e.id,
      kind: isFetch ? 'fetch' : 'load',
      at: e.startedAt,
      sha: e.commitSha,
      title: isFetch
        ? `Read ${plural(fileCount, 'file')} from the repository`
        : 'Loaded the repository model onto the canvas',
    });
  }

  for (const c of changes) {
    if (changeBranch(c) !== branchName) continue;
    const kind: RepoActivityKind =
      c.status === 'accepted' ? 'accepted' : c.status === 'dismissed' ? 'dismissed' : 'detected';
    const title =
      kind === 'accepted'
        ? `Accepted an external change — ${plural(c.changedFiles.length, 'file')}`
        : kind === 'dismissed'
          ? `Dismissed an external change — ${plural(c.changedFiles.length, 'file')} (the canvas version won)`
          : `External change detected — ${plural(c.changedFiles.length, 'file')}`;
    entries.push({
      id: c.id,
      kind,
      at: c.createdAt,
      sha: c.commitSha,
      title,
      detail: firstLine(c.commitMessage) || undefined,
    });
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return entries.slice(0, limit);
}

export function formatActivityTime(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const mins = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (Number.isNaN(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  return then.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

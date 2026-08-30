// N6.2(c) rev 2 — ONE permanent home for changes, matching the git button
// pattern: a header Changes button (badge when proposals are pending — TopBar
// renders it, this component reports the count) opens this panel.
//   Pending    — proposals awaiting review (Review opens the side review panel)
//   Repository — R3-5: what this branch did with its git repo, and what is still
//                hanging (unanswered detections, files never bound)
//   History    — the applied patch log, newest first, names not UUIDs
// Nothing floats over the canvas unless the user opened it or is reviewing.
//
// R3-5 (owner 2026-07-30) moved this from a docked bottom sheet to a right-edge
// SIDE PANEL: the dock's 46vh ceiling could not hold a timeline, and the bottom
// strip belongs to the CanvasDock. Pending/History behavior is unchanged.
import { useState, useEffect, useCallback } from 'react';
import {
  X, GitPullRequestArrow, History, GitBranch, RefreshCw, DownloadCloud,
  AlertTriangle, GitCommitHorizontal, Link2Off, ArrowDownToLine, ArrowUpFromLine, CircleAlert, ListChecks,
} from 'lucide-react';
import { useProposal, usePatch } from '../../context/ServiceContext.js';
import type { AIProposal } from '@nodespec/core/ai-proposal.js';
import type { Graph } from '@nodespec/core/types.js';
import type { PersistedPatch } from '../../../persistence/types.js';
import { describePatch } from '../proposal/PatchDiffView.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { GitService } from '../../services/GitService.js';
import type { GitChangeEvent, RepoSyncEvent } from '../../services/GitService.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import {
  deriveUnfinishedBusiness, mergeRepoActivity, formatActivityTime, shortSha, deriveAheadOfGit,
  type RepoActivityEntry, type UnfinishedItem,
} from './repoActivity.js';

const POLL_MS = 30_000;
const HISTORY_LIMIT = 50;

type Tab = 'pending' | 'repository' | 'history';

export function ChangesPanel({
  isOpen,
  onClose,
  projectId,
  branchId,
  branchName,
  hasGitIntegration,
  graph,
  refreshCounter,
  autoApprove,
  onReviewProposal,
  onPendingCountChange,
  onOpenGitPanel,
  onModelRestored,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  branchId: string | null;
  /** R3-5: the design branch whose repo lane this panel reports on. */
  branchName?: string;
  hasGitIntegration?: boolean;
  graph: Graph;
  /** Bump = reload (proposal accepted/declined, graph refreshed). */
  refreshCounter?: number;
  /** UX-1.1a: the opt-in auto-approve setting (project-level, default OFF). */
  autoApprove?: { enabled: boolean; onToggle: (enabled: boolean) => void };
  onReviewProposal: (proposal: AIProposal) => void;
  /** Reports the pending count upward for the header badge + arrival toast. */
  onPendingCountChange?: (count: number) => void;
  /** R3-5: jump to the reconciliation surface — the panel itself never resolves. */
  onOpenGitPanel?: () => void;
  /** R3-5: the R3-1 load succeeded — re-read the canvas. */
  onModelRestored?: () => void;
}) {
  const proposalService = useProposal();
  const patchService = usePatch();
  const [gitService] = useState(() => new GitService(getSupabaseClient()));
  const { theme } = useTheme();
  const c = theme.colors;
  const [tab, setTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<AIProposal[]>([]);
  const [history, setHistory] = useState<PersistedPatch[]>([]);

  // ── Repository tab state ────────────────────────────────────────────────────
  const [repoLoading, setRepoLoading] = useState(false);
  const [changes, setChanges] = useState<GitChangeEvent[]>([]);
  const [syncEvents, setSyncEvents] = useState<RepoSyncEvent[]>([]);
  const [sweepStatus, setSweepStatus] = useState<string | null>(null);
  const [headSha, setHeadSha] = useState<string | null>(null);
  const [gitRef, setGitRef] = useState<string | null>(null);
  // R4: newest applied patch on this branch — the "design ahead of git" input.
  const [latestPatchAt, setLatestPatchAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'load' | 'spec' | null>(null);
  const [repoNote, setRepoNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const loadPending = useCallback(async () => {
    if (!branchId) { setPending([]); onPendingCountChange?.(0); return; }
    try {
      const proposals = await proposalService.listProposalsByBranch(branchId, 'pending');
      // UX-1.2 (owner spec 2026-08-21): the queue reads newest-first so
      // recency is legible at a glance; each row shows its timestamp below.
      proposals.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      setPending(proposals);
      onPendingCountChange?.(proposals.length);
    } catch {
      setPending([]);
    }
  }, [branchId, proposalService, onPendingCountChange]);

  // Poll even while closed — the header badge and arrival toast depend on it.
  useEffect(() => {
    loadPending();
    const t = setInterval(loadPending, POLL_MS);
    return () => clearInterval(t);
  }, [loadPending, refreshCounter]);

  useEffect(() => {
    if (!isOpen || tab !== 'history' || !branchId) return;
    let cancelled = false;
    (async () => {
      try {
        const patches = await patchService.loadPatches(branchId);
        if (!cancelled) setHistory(patches.slice(-HISTORY_LIMIT).reverse());
      } catch {
        if (!cancelled) setHistory([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, tab, branchId, patchService, refreshCounter]);

  // R3-5: pure reads. Opening the Repository tab must never move a baseline —
  // the sweep only runs when the user asks for it.
  const loadRepoRecords = useCallback(async () => {
    if (!projectId) return;
    setRepoLoading(true);
    try {
      const [events, syncs, ref, patches] = await Promise.all([
        gitService.getRecentChangeEvents(projectId).catch(() => [] as GitChangeEvent[]),
        gitService.getRepoSyncEvents(projectId).catch(() => [] as RepoSyncEvent[]),
        gitService.getBranchGitRef(projectId, branchName || 'main').catch(() => null),
        branchId ? patchService.loadPatches(branchId).catch(() => []) : Promise.resolve([]),
      ]);
      setChanges(events);
      setSyncEvents(syncs);
      setGitRef(ref);
      setLatestPatchAt(patches.length > 0 ? patches[patches.length - 1].createdAt : null);
    } finally {
      setRepoLoading(false);
    }
  }, [projectId, branchName, branchId, gitService, patchService]);

  useEffect(() => {
    if (!isOpen || tab !== 'repository') return;
    void loadRepoRecords();
  }, [isOpen, tab, loadRepoRecords, refreshCounter]);

  // Default to whichever tab has something to say.
  useEffect(() => {
    if (isOpen) setTab(pending.length > 0 ? 'pending' : 'repository');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /**
   * RACE SAFETY (owner constraint): a forced, branch-scoped sweep — exactly the
   * call the page load and a branch switch already make. It only raises cards or
   * advances through the audited freshness ladder; it never auto-restores, so
   * running it late can add information but cannot move the canvas.
   */
  const handleCheckNow = useCallback(async () => {
    if (!projectId) return;
    setBusy('check');
    setRepoNote(null);
    try {
      const integration = await gitService.getIntegration(projectId);
      if (!integration) { setRepoNote({ tone: 'warn', text: 'No git integration is configured for this project.' }); return; }
      const sweep = await gitService.detectDrift(integration.id, { branchName: branchName || 'main', force: true });
      const status = (sweep?.status as string | undefined) ?? null;
      setSweepStatus(status);
      setHeadSha((sweep?.headSha as string | undefined) ?? null);
      await loadRepoRecords();
      if (status === 'drift' || status === 'behind_in_sync') {
        setRepoNote({ tone: 'warn', text: 'This branch is behind its git branch — see below.' });
      } else if (status === 'clean' || status === 'fast_forwarded') {
        setRepoNote({ tone: 'ok', text: 'Up to date with the repository.' });
      } else if (status === 'ref_deleted') {
        setRepoNote({ tone: 'warn', text: 'The git branch for this design branch no longer exists.' });
      } else {
        setRepoNote({ tone: 'ok', text: 'Checked.' });
      }
    } catch (err) {
      setRepoNote({ tone: 'warn', text: err instanceof Error ? err.message : 'Check failed' });
    } finally {
      setBusy(null);
    }
  }, [projectId, branchName, gitService, loadRepoRecords]);

  /**
   * RACE SAFETY: the card-independent R3-1 loader (previously reachable ONLY
   * from a detection card, which is why a swallowed merge needed SQL to
   * recover). It resolves the ref's CURRENT head and sets the baseline to
   * exactly the commit it loaded — it can never load from a stale recorded sha,
   * and it can never advance a baseline past content this canvas has not seen.
   * Forward-only, so a late run converges: a second run finds head === baseline
   * and is a no-op.
   */
  const handleLoadRepoModel = useCallback(async () => {
    if (!projectId) return;
    if (!window.confirm(
      `Load the repository's model for "${branchName || 'main'}" onto this canvas?\n\n` +
      'The design stored in the repository becomes this branch\'s canvas. Unpushed local ' +
      'changes on this branch are replaced. Your git history is untouched.'
    )) return;
    setBusy('load');
    setRepoNote(null);
    try {
      const integration = await gitService.getIntegration(projectId);
      if (!integration) { setRepoNote({ tone: 'warn', text: 'No git integration is configured for this project.' }); return; }
      const result = await gitService.restoreModel(integration.id, branchName || 'main');
      setSweepStatus(null);
      setHeadSha(result?.headSha ?? null);
      onModelRestored?.();
      await loadRepoRecords();
      setRepoNote({ tone: 'ok', text: `Loaded the repository model at ${shortSha(result?.headSha ?? null) || 'HEAD'}.` });
    } catch (err) {
      setRepoNote({ tone: 'warn', text: err instanceof Error ? err.message : 'Load failed' });
    } finally {
      setBusy(null);
    }
  }, [projectId, branchName, gitService, loadRepoRecords, onModelRestored]);

  /**
   * R7c: the spec plane's card-independent loader, for the same reason the model
   * one exists — a requirements change with no card left is otherwise unreachable.
   * Independent of the model load: taking the repo's requirements must not force a
   * canvas replacement. Upsert preserves `met` for unchanged criterion text, so
   * evidence an AI produced survives; requirements the repo dropped are kept.
   */
  const handleLoadRepoSpec = useCallback(async () => {
    if (!projectId) return;
    if (!window.confirm(
      `Load the repository's requirements for "${branchName || 'main'}"?\n\n` +
      'Requirements and acceptance criteria are taken from the repository. Criteria you have ' +
      'already met keep their evidence unless their text changed. Requirements the repository ' +
      'does not have are kept, not deleted.'
    )) return;
    setBusy('spec');
    setRepoNote(null);
    try {
      const integration = await gitService.getIntegration(projectId);
      if (!integration) { setRepoNote({ tone: 'warn', text: 'No git integration is configured for this project.' }); return; }
      const result = await gitService.restoreSpec(integration.id, branchName || 'main');
      const c = result.counts ?? { mappings: 0 };
      const detail = result.mode === 'adopted'
        ? `${c.requirements ?? 0} requirement(s) imported`
        : `${c.added ?? 0} added, ${c.updated ?? 0} updated, ${c.criteriaPreserved ?? 0} met criterion(s) kept their evidence`;
      const kept = result.keptLocal?.length ? ` ${result.keptLocal.length} of yours kept (not in the repo).` : '';
      await loadRepoRecords();
      setRepoNote({ tone: 'ok', text: `Requirements loaded — ${detail}.${kept}` });
    } catch (err) {
      setRepoNote({ tone: 'warn', text: err instanceof Error ? err.message : 'Requirements load failed' });
    } finally {
      setBusy(null);
    }
  }, [projectId, branchName, gitService, loadRepoRecords]);

  if (!isOpen) return null;

  const currentBranch = branchName || 'main';
  const unfinished: UnfinishedItem[] = deriveUnfinishedBusiness({
    changes, branchName: currentBranch, sweepStatus, headSha,
    // R4: the other direction — accepted changes that never reached git.
    aheadOfGit: deriveAheadOfGit({ syncEvents, branchId, latestPatchAt }),
  });
  const activity: RepoActivityEntry[] = mergeRepoActivity({
    syncEvents, changes, branchName: currentBranch, branchId,
  });

  const titleOf = (p: AIProposal): string => {
    const meta = p.metadata as Record<string, unknown> | undefined;
    if (typeof meta?.title === 'string' && meta.title) return meta.title;
    if (meta?.source === 'git-adopt') return 'Restore design from repository model';
    if (typeof meta?.source === 'string' && meta.source) return `Proposal (${meta.source})`;
    return 'Architecture change proposal';
  };

  const tabButton = (key: Tab, label: string, icon: React.ReactNode, count?: number) => (
    <button
      onClick={() => setTab(key)}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '8px 10px', fontSize: '12px', fontWeight: tab === key ? 600 : 400,
        color: tab === key ? c.primary : c.textMuted,
        backgroundColor: 'transparent', border: 'none',
        borderBottom: tab === key ? `2px solid ${c.primary}` : '2px solid transparent',
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span style={{
          padding: '1px 6px', borderRadius: '8px', fontSize: '10px', fontWeight: 700,
          backgroundColor: 'rgba(37, 99, 235, 0.15)', color: c.primary,
        }}>
          {count}
        </span>
      )}
    </button>
  );

  const actionButton = (
    label: string, icon: React.ReactNode, onClick: () => void, opts?: { primary?: boolean; disabled?: boolean },
  ) => (
    <button
      onClick={onClick}
      disabled={opts?.disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', flex: 1, justifyContent: 'center',
        padding: '7px 10px', fontSize: '11.5px', fontWeight: 600,
        borderRadius: '6px', cursor: opts?.disabled ? 'not-allowed' : 'pointer',
        opacity: opts?.disabled ? 0.55 : 1,
        border: opts?.primary ? 'none' : `1px solid ${c.border}`,
        backgroundColor: opts?.primary ? c.primary : 'transparent',
        color: opts?.primary ? '#fff' : c.text,
      }}
    >
      {icon}
      {label}
    </button>
  );

  const unfinishedIcon = (kind: UnfinishedItem['kind']) =>
    kind === 'unbound' ? <Link2Off size={13} />
      : kind === 'behind' ? <ArrowDownToLine size={13} />
        : kind === 'ahead' ? <ArrowUpFromLine size={13} />
          : <CircleAlert size={13} />;

  const activityIcon = (kind: RepoActivityEntry['kind']) => {
    switch (kind) {
      case 'commit': return <GitCommitHorizontal size={13} />;
      case 'load': return <DownloadCloud size={13} />;
      case 'fetch': return <DownloadCloud size={13} />;
      case 'failed': return <AlertTriangle size={13} />;
      default: return <GitBranch size={13} />;
    }
  };

  const activityColor = (kind: RepoActivityEntry['kind']) => {
    switch (kind) {
      case 'commit': return '#059669';
      case 'load': case 'fetch': return c.primary;
      case 'accepted': return '#059669';
      case 'dismissed': return c.textMuted;
      case 'failed': return '#dc2626';
      default: return '#d97706';
    }
  };

  const sectionHeading = (text: string) => (
    <div style={{
      padding: '10px 14px 6px', fontSize: '10.5px', fontWeight: 700,
      letterSpacing: '0.05em', textTransform: 'uppercase', color: c.textMuted,
    }}>
      {text}
    </div>
  );

  const repositoryTab = (
    <div>
      {/* ── Status + the two actions ─────────────────────────────────────── */}
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: c.text, marginBottom: '4px' }}>
          <GitBranch size={13} />
          <strong>{currentBranch}</strong>
          {gitRef && gitRef !== currentBranch && (
            <span style={{ color: c.textMuted }}>→ {gitRef}</span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '10px' }}>
          {hasGitIntegration
            ? 'Commits, model loads and detected changes for this branch.'
            : 'No repository is connected to this project yet.'}
        </div>
        {hasGitIntegration && (
          <div style={{ display: 'flex', gap: '8px' }}>
            {actionButton(
              busy === 'check' ? 'Checking…' : 'Check for changes now',
              <RefreshCw size={13} />, handleCheckNow, { disabled: busy !== null },
            )}
            {actionButton(
              busy === 'load' ? 'Loading…' : 'Load repo model onto canvas',
              <DownloadCloud size={13} />, handleLoadRepoModel, { primary: true, disabled: busy !== null },
            )}
          </div>
        )}
        {/* R7c: the spec plane's own loader — the two anchors move independently,
            so taking the repo's requirements never touches the canvas. */}
        {hasGitIntegration && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            {actionButton(
              busy === 'spec' ? 'Loading…' : 'Load requirements from repo',
              <ListChecks size={13} />, handleLoadRepoSpec, { disabled: busy !== null },
            )}
          </div>
        )}
        {repoNote && (
          <div style={{
            marginTop: '8px', fontSize: '11px',
            color: repoNote.tone === 'warn' ? '#b45309' : '#059669',
          }}>
            {repoNote.text}
          </div>
        )}
      </div>

      {/* ── Unfinished business ──────────────────────────────────────────── */}
      {unfinished.length > 0 && (
        <div style={{ borderBottom: `1px solid ${c.border}`, backgroundColor: 'rgba(217, 119, 6, 0.06)' }}>
          {sectionHeading('Unfinished business')}
          {unfinished.map((item) => (
            <div key={item.id} style={{ display: 'flex', gap: '8px', padding: '8px 14px', alignItems: 'flex-start' }}>
              <span style={{ color: '#b45309', flexShrink: 0, marginTop: '2px' }}>{unfinishedIcon(item.kind)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: c.text }}>{item.title}</div>
                <div style={{ fontSize: '11px', color: c.textMuted, wordBreak: 'break-word' }}>{item.detail}</div>
                {item.sha && (
                  <div style={{ fontSize: '10px', color: c.textMuted, fontFamily: 'monospace', marginTop: '2px' }}>
                    {shortSha(item.sha)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {onOpenGitPanel && (
            <div style={{ padding: '2px 14px 10px' }}>
              <button
                onClick={() => { onClose(); onOpenGitPanel(); }}
                style={{
                  padding: '5px 12px', fontSize: '11.5px', fontWeight: 600,
                  border: `1px solid ${c.border}`, borderRadius: '6px', cursor: 'pointer',
                  backgroundColor: 'transparent', color: c.text,
                }}
              >
                Open the Git panel to resolve
              </button>
              {/* Deliberate: resolving happens THERE. Acting on a stale card must
                  never re-resolve it — that would regress the sync baseline. */}
            </div>
          )}
        </div>
      )}

      {/* ── Activity ─────────────────────────────────────────────────────── */}
      {sectionHeading('Activity')}
      {repoLoading && activity.length === 0 ? (
        <div style={{ padding: '16px', fontSize: '12px', color: c.textMuted, textAlign: 'center' }}>Loading…</div>
      ) : activity.length === 0 ? (
        <div style={{ padding: '16px', fontSize: '12px', color: c.textMuted, textAlign: 'center' }}>
          No repository activity recorded for this branch yet.
        </div>
      ) : (
        activity.map((entry) => (
          <div key={entry.id} style={{ display: 'flex', gap: '8px', padding: '7px 14px', borderBottom: `1px solid ${c.border}`, alignItems: 'flex-start' }}>
            <span style={{ color: activityColor(entry.kind), flexShrink: 0, marginTop: '2px' }}>{activityIcon(entry.kind)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: c.text }}>{entry.title}</div>
              {entry.detail && (
                <div style={{ fontSize: '11px', color: c.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.detail}
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: c.textMuted }}>{formatActivityTime(entry.at)}</div>
              {entry.sha && (
                <div style={{ fontSize: '10px', color: c.textMuted, fontFamily: 'monospace' }}>{shortSha(entry.sha)}</div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div style={{
      position: 'fixed', top: '68px', right: '12px', bottom: '12px',
      width: 'min(420px, 94vw)',
      display: 'flex', flexDirection: 'column',
      backgroundColor: c.surface, border: `1px solid ${c.border}`, borderRadius: '12px',
      boxShadow: theme.mode === 'dark' ? '0 12px 48px rgba(0,0,0,0.5)' : '0 12px 48px rgba(0,0,0,0.16)',
      overflow: 'hidden', zIndex: 300,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: `1px solid ${c.border}`, backgroundColor: c.backgroundSecondary,
        paddingRight: '4px',
      }}>
        {tabButton('pending', 'Pending', <GitPullRequestArrow size={13} />, pending.length)}
        {tabButton('repository', 'Repository', <GitBranch size={13} />, unfinished.length)}
        {tabButton('history', 'History', <History size={13} />)}
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: c.textMuted, cursor: 'pointer', padding: '6px' }}
          title="Close"
        >
          <X size={15} />
        </button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {tab === 'pending' && autoApprove && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '9px 14px', borderBottom: `1px solid ${c.border}`,
            fontSize: '11.5px', color: c.textMuted, cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={autoApprove.enabled}
              onChange={(e) => autoApprove.onToggle(e.target.checked)}
              style={{ accentColor: c.primary, cursor: 'pointer' }}
            />
            <span>
              Auto-approve incoming proposals
              <span style={{ opacity: 0.75 }}> — applies immediately with the same validation and locked-node guards; import reviews still ask</span>
            </span>
          </label>
        )}
        {tab === 'pending' ? (
          pending.length === 0 ? (
            <div style={{ padding: '20px', fontSize: '12px', color: c.textMuted, textAlign: 'center' }}>
              No pending change proposals. Your AI's proposed changes (via MCP) and
              repository restore offers appear here for review.
            </div>
          ) : (
            pending.map((p) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 14px', borderBottom: `1px solid ${c.border}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 500, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {titleOf(p)}
                  </div>
                  <div style={{ fontSize: '11px', color: c.textMuted }}>
                    {p.patches.length} change{p.patches.length !== 1 ? 's' : ''}
                    {p.createdAt ? ` · ${new Date(p.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => { onClose(); onReviewProposal(p); }}
                  style={{
                    padding: '5px 14px', fontSize: '12px', fontWeight: 600,
                    border: 'none', borderRadius: '6px', cursor: 'pointer',
                    backgroundColor: c.primary, color: '#fff', flexShrink: 0,
                  }}
                >
                  Review
                </button>
              </div>
            ))
          )
        ) : tab === 'repository' ? (
          repositoryTab
        ) : (
          history.length === 0 ? (
            <div style={{ padding: '20px', fontSize: '12px', color: c.textMuted, textAlign: 'center' }}>
              No applied changes recorded on this branch yet.
            </div>
          ) : (
            history.map((p) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'baseline', gap: '10px',
                padding: '7px 14px', borderBottom: `1px solid ${c.border}`,
              }}>
                <span style={{
                  fontSize: '10px', fontWeight: 600, flexShrink: 0, width: '52px',
                  color: p.actorType === 'human' ? '#059669' : p.actorType === 'ai' ? '#7c3aed' : c.textMuted,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {p.actorType}
                </span>
                <span style={{ fontSize: '12px', color: c.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {describePatch(p.payload, graph) || p.summary}
                </span>
                <span style={{ fontSize: '10px', color: c.textMuted, flexShrink: 0 }}>
                  {new Date(p.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}

// N6.2(c) rev 2 — ONE permanent home for changes, matching the git button
// pattern: a header button (badge when anything waits — TopBar renders it,
// this component reports the count) opens this panel. Owner 2026-09-20: the
// header button is Agents, and this is the one Agents surface.
//   Proposals  — V3 4.3: everything a person has to decide, in two origin
//                sections: what your agents proposed (every kind, the plan
//                included) and what the import left (candidates, mappings
//                to review, open questions). One act per row. Named Needs
//                you by the design; renamed Proposals (owner 2026-09-20).
//   Autonomy   — 8.2: what the agents may do on each tier without asking.
//                Was a popover on its own header button; one pane now.
//   Connected  — V3 I (owner 2026-09-21): the person's connected agents,
//                keys and OAuth clients in one list, with the plan's
//                allowance; connect with a one-time key, revoke in the row.
//   Repository — R3-5: what this branch did with its git repo, and what is still
//                hanging (unanswered detections, files never bound)
//   History    — the applied patch log, newest first, names not UUIDs
// Nothing floats over the canvas unless the user opened it or is reviewing.
//
// R3-5 (owner 2026-07-30) moved this from a docked bottom sheet to a right-edge
// SIDE PANEL. V3 4.3 made it the width of the canvas; the owner (2026-09-20)
// put it back beside the canvas: one side popup, the same in every view,
// like the node sidepane. The header count is the Proposals count.
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, GitPullRequestArrow, History, GitBranch, RefreshCw, DownloadCloud, SlidersHorizontal, Plug,
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
import { isSpecPlaneProposal } from '../../utils/proposal-plane.js';
import {
  deriveUnfinishedBusiness, mergeRepoActivity, formatActivityTime, shortSha, deriveAheadOfGit,
  loadModelMessage, loadSpecMessage, type RepoActivityEntry, type UnfinishedItem,
} from './repoActivity.js';
// R17: approvals and agent presence live HERE. The Ideation popup and the
// Agents button's roster both folded into this panel — one room, one door.
import { useApprovalsQueue, queuePlanFrom } from '../ideation/useApprovalsQueue.js';
import { useProjectFeatureGate } from '../../hooks/useProjectFeatureGate.js';
import { ApprovalsWaiting, ApprovalsHistory } from '../ideation/ApprovalsQueue.js';
import { AutonomyOverlay } from '../ideation/AutonomyOverlay.js';
import { DecisionPage } from '../ideation/DecisionPage.js';
import type { WorkTarget } from '../work/work-focus.js';
import { useAutonomySettings } from '../ideation/useAutonomySettings.js';
import { policySummary } from '../../utils/autonomy.js';
import { useAgentPresence } from '../ideation/useAgentPresence.js';
import { roster } from '../ideation/agent-roster.js';
import { AgentAvatars } from './AgentAvatars.js';
import { AgentRoster } from './AgentRoster.js';
import { useAgentConnections } from '../ideation/useAgentConnections.js';
import { ConnectedAgents } from '../ideation/ConnectedAgents.js';
import { SIDE_POPUP_TOP, SIDE_POPUP_Z } from '../common/canvas-chrome.js';
import { everyVisible } from '../../hooks/useSharedPoll.js';

const POLL_MS = 30_000;
const HISTORY_LIMIT = 50;

type Tab = 'pending' | 'autonomy' | 'connected' | 'repository' | 'history';
/** AK: a tab another surface opens the panel on (the header's MCP button, the walkthrough). */
export type AgentsTab = Tab;

/** The tab the panel opens on: Proposals when anything waits for a decision
 *  (the count the header's Agents badge shows, every kind) or the panel was
 *  opened on a proposal; Repository otherwise. */
export function openingTab(waiting: number, openedOnProposal: boolean): 'pending' | 'repository' {
  return waiting > 0 || openedOnProposal ? 'pending' : 'repository';
}

export function ChangesPanel({
  isOpen,
  onClose,
  projectId,
  branchId,
  branchName,
  hasGitIntegration,
  graph,
  refreshCounter,
  onReviewProposal,
  onPendingCountChange,
  onOpenGitPanel,
  focusProposalId,
  onSpecDecided,
  onOpenArchitecture,
  onOpenWork,
  openOn,
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
  onReviewProposal: (proposal: AIProposal) => void;
  /** Reports the pending count upward for the header badge + arrival toast. */
  onPendingCountChange?: (count: number) => void;
  /** R3-5: jump to the reconciliation surface — the panel itself never resolves. */
  onOpenGitPanel?: () => void;
  /** R17: opened from an agent card — that proposal's row is marked. */
  focusProposalId?: string | null;
  /** R17: a spec-plane decision landed — the boards behind re-read. */
  onSpecDecided?: () => void;
  /** V3 4.3: an open question is answered by an edit in Architecture; this goes there. */
  onOpenArchitecture?: (nodeId?: string) => void;
  /** The decision page's Edit first: the outcome under Work. */
  onOpenWork?: (target: WorkTarget) => void;
  /** AK: open on this tab (each new `at` asks again), over the tab the panel would pick. */
  openOn?: { tab: Tab; at: number } | null;
}) {
  const proposalService = useProposal();
  const patchService = usePatch();
  const [gitService] = useState(() => new GitService(getSupabaseClient()));
  const { theme } = useTheme();
  const c = theme.colors;
  const [tab, setTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<AIProposal[]>([]);
  const [history, setHistory] = useState<PersistedPatch[]>([]);
  // R17: the one approvals lane — every kind, grouped; decisions inline.
  // V3 4.3: the graph answers the import's open questions by derivation.
  // Q: the queue reads and shows only the lanes the project's plan carries (decision 1: its owner's).
  const gate = useProjectFeatureGate(projectId);
  const queue = useApprovalsQueue(projectId, queuePlanFrom(gate));
  const nodeLabels = useMemo(() => new Map(Object.values(graph.nodes).map((n) => [n.id, n.label])), [graph]);
  const presence = useAgentPresence(projectId);
  const agents = roster(presence.holds);
  const [agentsOpen, setAgentsOpen] = useState(false);
  // The Autonomy tab: the one control over what agents may do (one writer,
  // useAutonomySettings). The design's aside ends in "Autonomy settings",
  // and that chip opens this tab.
  const autonomy = useAutonomySettings(projectId);
  // V3 I: the person's connected agents (user-wide, not per project), read
  // through list_api_keys when the panel opens so the tab shows the count.
  const connections = useAgentConnections(isOpen);
  // The design's One decision: a promotion is read on its own page before
  // it is decided. Read it on the card opens it; so does arriving here on
  // a promotion (Work's Review on the row that says proposal waiting).
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const decisionItem = useMemo(() => (decisionId ? queue.items.find((i) => i.proposalId === decisionId && i.kind === 'promotion' && i.pending) ?? null : null), [queue.items, decisionId]);
  useEffect(() => {
    if (!isOpen) { setDecisionId(null); setDecisionError(null); return; }
    if (!focusProposalId) return;
    const it = queue.items.find((i) => i.proposalId === focusProposalId);
    if (it?.kind === 'promotion' && it.pending) setDecisionId(focusProposalId);
  }, [isOpen, focusProposalId, queue.items]);
  const afterDecision = () => { void queue.refresh(); void loadPending(); void presence.refresh(); onSpecDecided?.(); };

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
      // 8.1: this lane is the canvas — graph proposals only. Spec-plane rows
      // belong to the Ideation approvals queue (resolve_proposal refuses
      // graph ops; the canvas accept would mangle spec ops).
      const graphOnly = proposals.filter((p) => !isSpecPlaneProposal(p));
      setPending(graphOnly);
    } catch {
      setPending([]);
    }
  }, [branchId, proposalService]);

  // R17: the header badge counts everything awaiting a decision. V3 4.3:
  // that is the whole Proposals list, the import's leftovers included.
  useEffect(() => { onPendingCountChange?.(queue.pending); }, [queue.pending, onPendingCountChange]);

  // Poll even while closed — the header badge and arrival toast depend on it.
  // AL.20: not while the tab is hidden; coming back reads once.
  useEffect(() => {
    loadPending();
    return everyVisible(loadPending, POLL_MS);
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
        (branchName ? gitService.getBranchGitRef(projectId, branchName).catch(() => null) : Promise.resolve(null)),
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

  // Default to whichever tab has something to say. The queue counts every
  // kind waiting (the badge's number); `pending` is the canvas lane alone,
  // so an outcome or a promotion used to open the panel on Repository.
  useEffect(() => {
    if (isOpen) setTab(openOn?.tab ?? openingTab(queue.pending + pending.length, !!focusProposalId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  // Asked again while already open (the walkthrough moving from Connected to Autonomy).
  useEffect(() => {
    if (isOpen && openOn) setTab(openOn.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOn?.at]);

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
      const sweep = await gitService.detectDrift(integration.id, { ...(branchName ? { branchName } : {}), force: true });
      const status = (sweep?.status as string | undefined) ?? null;
      setSweepStatus(status);
      setHeadSha((sweep?.headSha as string | undefined) ?? null);
      await loadRepoRecords();
      if (status === 'drift' || status === 'behind_in_sync') {
        setRepoNote({ tone: 'warn', text: 'This branch is behind its git branch — see below.' });
      } else if (status === 'load_proposed') {
        // V3 AD.2b: a merged pull request came home and was filed, not loaded.
        setRepoNote({ tone: 'warn', text: "A merged change arrived: the repository's model is waiting in Proposals." });
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
    // V3 AD.2b: the load is filed as a proposal the person reviews, so there
    // is nothing to confirm here: nothing changes until they accept it.
    setBusy('load');
    setRepoNote(null);
    try {
      const integration = await gitService.getIntegration(projectId);
      if (!integration) { setRepoNote({ tone: 'warn', text: 'No git integration is configured for this project.' }); return; }
      const result = await gitService.restoreModel(integration.id, branchName || undefined);
      setSweepStatus(null);
      setHeadSha(result?.headSha ?? null);
      await loadRepoRecords();
      setRepoNote({ tone: 'ok', text: loadModelMessage(result) });
    } catch (err) {
      setRepoNote({ tone: 'warn', text: err instanceof Error ? err.message : 'Load failed' });
    } finally {
      setBusy(null);
    }
  }, [projectId, branchName, gitService, loadRepoRecords]);

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
      `Load the repository's requirements${branchName ? ` for "${branchName}"` : ''}?\n\n` +
      'Requirements and acceptance criteria are taken from the repository. Criteria you have ' +
      'already met keep their evidence unless their text changed. Requirements the repository ' +
      'does not have are kept, not deleted, and locked requirements stay as they are.'
    )) return;
    setBusy('spec');
    setRepoNote(null);
    try {
      const integration = await gitService.getIntegration(projectId);
      if (!integration) { setRepoNote({ tone: 'warn', text: 'No git integration is configured for this project.' }); return; }
      const result = await gitService.restoreSpec(integration.id, branchName || undefined);
      await loadRepoRecords();
      setRepoNote({ tone: 'ok', text: loadSpecMessage(result) });
    } catch (err) {
      setRepoNote({ tone: 'warn', text: err instanceof Error ? err.message : 'Requirements load failed' });
    } finally {
      setBusy(null);
    }
  }, [projectId, branchName, gitService, loadRepoRecords]);

  if (!isOpen) return null;

  // AD.4 (D15): the open branch, named by the editor (the primary's real
  // name when none is open); never the literal 'main'.
  const currentBranch = branchName ?? '';
  const unfinished: UnfinishedItem[] = deriveUnfinishedBusiness({
    changes, branchName: currentBranch, sweepStatus, headSha,
    // R4: the other direction — accepted changes that never reached git.
    aheadOfGit: deriveAheadOfGit({ syncEvents, branchId, latestPatchAt }),
  });
  const activity: RepoActivityEntry[] = mergeRepoActivity({
    syncEvents, changes, branchName: currentBranch, branchId,
  });


  const tabButton = (key: Tab, label: string, icon: React.ReactNode, count?: number, note?: string) => (
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
      {note && <span data-testid={`changes-tab-note-${key}`} style={{ fontSize: '10.5px', fontWeight: 700, opacity: 0.8 }}>· {note}</span>}
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
    <div data-testid="proposals-panel" data-tour="agents-panel" style={{
      // A side popup beside the canvas, the same in every view (owner
      // 2026-09-20): the node sidepane's anchor and height, wider for the
      // cards; never the width of the canvas.
      position: 'fixed', right: '20px', top: `${SIDE_POPUP_TOP}px`, width: 'min(540px, calc(100vw - 40px))', height: `calc(100vh - ${SIDE_POPUP_TOP + 20}px)`,
      display: 'flex', flexDirection: 'column',
      backgroundColor: c.surface, border: `1px solid ${c.border}`, borderRadius: '12px',
      boxShadow: theme.mode === 'dark' ? '0 12px 48px rgba(0,0,0,0.5)' : '0 12px 48px rgba(0,0,0,0.16)',
      overflow: 'hidden', zIndex: SIDE_POPUP_Z,
    }}>
      {/* R17: who is working, ambient across every tab. The stack expands
          into the full roster; the roster's own queue link is off because
          this panel IS the queue. */}
      {agents.length > 0 && (
        <div style={{ borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
          <button
            data-testid="changes-agents-strip"
            aria-expanded={agentsOpen}
            onClick={() => setAgentsOpen((v) => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: '9px',
              padding: '8px 14px', border: 'none', background: 'transparent',
              color: c.text, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <AgentAvatars principals={agents} />
            <span style={{ fontSize: '11.5px', fontWeight: 600 }}>
              {agents.length} agent{agents.length === 1 ? '' : 's'} at work
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '10px', color: c.textMuted }}>{agentsOpen ? '▾' : '▸'}</span>
          </button>
          {agentsOpen && (
            // A long roster scrolls in place; it never pushes the tabs and the
            // close button out of the panel.
            <div style={{ padding: '0 14px 12px', maxHeight: '30vh', overflowY: 'auto' }}>
              <AgentRoster presence={presence} showQueueLink={false} />
            </div>
          )}
        </div>
      )}
      <div data-testid="changes-header" style={{
        display: 'flex', alignItems: 'flex-start', flexShrink: 0,
        borderBottom: `1px solid ${c.border}`, backgroundColor: c.backgroundSecondary,
        paddingRight: '4px',
      }}>
        {/* The tabs wrap onto a second row when the panel is narrow, and the
            close button sits outside them, so it stays in view at any width
            (owner 2026-09-29: the X was pushed off the panel). */}
        <div data-testid="changes-tabs" style={{ display: 'flex', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          {tabButton('pending', 'Proposals', <GitPullRequestArrow size={13} />, queue.pending)}
          {projectId && tabButton('autonomy', 'Autonomy', <SlidersHorizontal size={13} />, undefined, autonomy.loading ? undefined : policySummary(autonomy.policy))}
          {tabButton('connected', 'Connected', <Plug size={13} />, undefined, connections.loading || connections.error ? undefined : `${connections.active} of ${connections.limit}`)}
          {tabButton('repository', 'Repository', <GitBranch size={13} />, unfinished.length)}
          {tabButton('history', 'History', <History size={13} />)}
        </div>
        <button
          data-testid="changes-close"
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: c.textMuted, cursor: 'pointer', padding: '6px', marginTop: '3px', flexShrink: 0 }}
          title="Close"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* R23: the auto-approve toggle that sat here was a SECOND control
            over the same state as the Autonomy settings (the architecture
            lane's Auto-apply mirrors the same metadata key). One meaning per
            control: the Autonomy tab is the one writer; the Proposals tab
            only lists and decides. */}
        {tab === 'autonomy' ? (
          <div data-testid="proposals-autonomy-page" style={{ padding: '14px' }}>
            <AutonomyOverlay settings={autonomy} onClose={() => setTab('pending')} />
          </div>
        ) : tab === 'connected' ? (
          <div data-testid="agents-connected-page" style={{ padding: '14px' }}>
            <ConnectedAgents connections={connections} holds={presence.holds} />
          </div>
        ) : tab === 'pending' && decisionItem ? (
          <DecisionPage
            item={decisionItem}
            projectId={projectId}
            graph={graph}
            workflows={!gate.loading && gate.can('workflow_space')}
            busy={queue.busyId === decisionItem.proposalId}
            error={decisionError}
            onDecide={(action) => {
              setDecisionError(null);
              void queue.resolve(decisionItem.proposalId, action).then((r) => {
                if (!r.ok) { setDecisionError(r.error ?? 'The decision did not apply.'); return; }
                setDecisionId(null);
                afterDecision();
              });
            }}
            onBack={() => { setDecisionId(null); setDecisionError(null); }}
            onEditFirst={onOpenWork ? (candidateId) => { onClose(); onOpenWork({ kind: 'outcome', id: candidateId }); } : undefined}
            onOpenArchitecture={onOpenArchitecture ? (nodeId) => { onClose(); onOpenArchitecture(nodeId); } : undefined}
          />
        ) : tab === 'pending' ? (
          /* R17: ONE waiting list, every kind, grouped by what deciding it
             does. Canvas changes hand off to the side review (the panel
             closes so the review has the room); everything else decides
             inline through resolve_proposal. */
          <ApprovalsWaiting
            queue={queue}
            focusProposalId={focusProposalId}
            nodeLabels={nodeLabels}
            onOpenAutonomy={projectId ? () => setTab('autonomy') : undefined}
            onReadDecision={(proposalId) => { setDecisionError(null); setDecisionId(proposalId); }}
            onOpenWork={onOpenWork ? (target) => { onClose(); onOpenWork(target); } : undefined}
            onReviewCanvas={(proposalId) => {
              const p = pending.find((x) => x.id === proposalId);
              if (p) { onClose(); onReviewProposal(p); }
            }}
            onDecided={afterDecision}
          />
        ) : tab === 'repository' ? (
          repositoryTab
        ) : (<>
          <ApprovalsHistory queue={queue} />
          <div style={{ padding: '9px 14px 5px', fontSize: '10px', fontWeight: 700, letterSpacing: '.07em', color: c.textMuted, textTransform: 'uppercase', borderBottom: `1px solid ${c.border}` }}>
            Applied changes
          </div>
          {history.length === 0 ? (
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
          )}
        </>)}
      </div>
    </div>
  );
}

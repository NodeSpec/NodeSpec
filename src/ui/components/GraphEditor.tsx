import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PatchOperation, ActorType, Graph } from '@nodespec/core/types.js';
import { createUpdateArtifactPatch, createRemoveArtifactPatch } from '@nodespec/core/patch-factory.js';
import { buildNodeAnchorSlice, serializeNodeAnchorSlice } from '@nodespec/core/anchor-slice.js';
import { computeContentHash, now as nowIso } from '@nodespec/core/utils.js';
import { GitService } from '../services/GitService.js';
import { openBranchName } from '../services/project-branch.js';
import { TabbedSidebar, Canvas } from './layout/index.js';
import { TopBar, ProjectExplorer, ProjectCreatePopup } from './panels/index.js';
import { ChangesPanel, type AgentsTab } from './panels/ChangesPanel.js';
import { shouldAutoPushOnAccept, pushSkipNote, pushWithheldNote } from './panels/repoActivity.js';
import { flagNodeEvidenceStale } from '../services/evidenceStale.js';
import type { ProjectCreateResult, WorkflowOrigin } from './panels/index.js';
import { readStagedSpecImport } from '../utils/spec-import-staging.js';
import type { StagedSpecImport } from '../utils/spec-import-staging.js';
import { pruneStagedExplodes, readStagedExplodes, stageExplode, withdrawExplode, type StagedExplode } from '../utils/explode-staging.js';
import { NodeSidepane } from './panels/NodeSidepane.js';
import { TeamPopup, useTeamBelowPlan } from './panels/TeamPopup.js';
import type { WorkFocus, WorkTarget } from './work/work-focus.js';
import { seenWalkthrough, surfaceTarget, type WalkthroughSurface } from './common/walkthrough.js';
import type { SidepaneTab } from './panels/NodeSidepane.js';
import { ToastContainer, useToast, OnboardingModal, NodeExportModal, ProjectExportModal, ProjectStartPopup, startCardShows, SpecImportStagingPopup } from './common/index.js';
import type { BranchStore, BranchStoreState } from '../store/branch-store.js';
import { ThemeProvider, useTheme } from '../theme/ThemeContext.js';
import { useProject, useBranch, usePatch, useSpecification, useProposal, useTestCase } from '../context/ServiceContext.js';
import type { ProjectSpecification } from '../services/SpecificationService.js';
import { useSmoothRefresh } from '../hooks/useSmoothRefresh.js';
import { useProjectFeatureGate } from '../hooks/useProjectFeatureGate.js';
import { useRealtimeSpecification } from '../hooks/useRealtimeSpecification.js';
import { useRealtimeMappings } from '../hooks/useRealtimeMappings.js';
import { ImportReviewPanel } from './proposal/ImportReviewPanel.js';
import type { AIProposal, MergeResult } from '@nodespec/core/ai-proposal.js';
import { buildNodeExportContext, buildProjectExport } from '../utils/export-context.js';
import { buildGitAcceptPatch, buildResidueBindPatches } from '../utils/git-accept.js';
import { getContainerTypeById } from '@nodespec/core/container-types.js';
import type { NodeExportContext, ProjectExportData, ProjectExportSpecification } from '../utils/export-context.js';
import type { TestSummaryByNodeId } from '../adapters/graph-to-reactflow.js';
import { isExplodedNode } from '../adapters/graph-to-reactflow.js';
import { getSupabaseClient } from '../../persistence/supabase/client.js';
import { isHostedEdition } from '../config/edition.js';
import { PublishTemplateModal } from './templates/PublishTemplateModal.js';
import { useGitAutoSync } from '../hooks/useGitAutoSync.js';
import { useProposalAutoApprove } from '../hooks/useProposalAutoApprove.js';
import { useAgentPresence } from './ideation/useAgentPresence.js';
import { nodeLeases, leasedEditRefusal } from './ideation/node-leases.js';
import { ImportIntentPopup } from './common/ImportIntentPopup.js';
import { ChangeScopeLine } from './common/ChangeScopeLine.js';
import { useChangeScope } from './ideation/useChangeScope.js';
import { canvasScope } from './ideation/change-scope-model.js';
import { insertChange } from './ideation/useWorkflowLanes.js';
import { isChangeIntent, type ImportIntent } from '../utils/change-intent.js';

interface GraphEditorProps {
  store: BranchStore;
  actorType?: ActorType;
  userId?: string;
  userEmail?: string;
  projectId?: string | null;
  projectName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  onSwitchProject?: (projectId: string) => void;
  onCreateProject?: (name: string, metadata?: Record<string, unknown>) => void;
  onRenameProject?: (newName: string) => void;
  onDeleteCurrentProject?: () => void;
}

function GraphEditorInner({
  store,
  actorType = 'human',
  userId,
  userEmail,
  projectId,
  projectName,
  branchId,
  branchName,
  onSwitchProject,
  onCreateProject,
  onRenameProject,
  onDeleteCurrentProject,
}: GraphEditorProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [storeState, setStoreState] = useState<BranchStoreState>(store.getState);
  const { messages, showError, showWarning, showSuccess, dismissToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const checkoutHandled = useRef(false);
  const projectService = useProject();
  const branchService = useBranch();
  const patchService = usePatch();
  const specificationService = useSpecification();
  const proposalService = useProposal();
  const testCaseService = useTestCase();
  // Decision 1: inside a project, what it carries is its owner's plan.
  const gate = useProjectFeatureGate(projectId);

  useEffect(() => {
    if (checkoutHandled.current) return;
    if (searchParams.get('checkout') === 'success') {
      checkoutHandled.current = true;
      showSuccess('Subscription activated! Your plan is being confirmed...', 6000);
      setSearchParams({}, { replace: true });
      gate.refreshUntilActive();
    }
  }, [searchParams, setSearchParams, showSuccess, gate.refreshUntilActive]);

  // Owner 2026-07-30 (detection latency): ONE badge-count refresher, used by the
  // initial load, the realtime channel, AND the background sweep below (self-hosted
  // benches often lack the realtime publication for this table — the poll is the
  // floor, realtime is the accelerator). Toasts when the count RISES after the
  // first load, so a webhook/sweep detection surfaces without opening anything.
  const prevGitCountRef = useRef<number | null>(null);
  const refreshPendingGitCount = useCallback(() => {
    if (!projectId) return;
    getSupabaseClient()
      .from('git_change_events')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', 'pending')
      .then(({ count }) => {
        const next = count || 0;
        if (prevGitCountRef.current !== null && next > prevGitCountRef.current) {
          showWarning('External git change detected — open the Git panel to review');
        }
        prevGitCountRef.current = next;
        setPendingGitChanges(next);
      });
  }, [projectId, showWarning]);

  useEffect(() => {
    if (!projectId) return;
    const supabase = getSupabaseClient();
    refreshPendingGitCount();

    const channel = supabase
      .channel(`git-changes-${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'git_change_events', filter: `project_id=eq.${projectId}` },
        () => refreshPendingGitCount()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, refreshPendingGitCount]);

  // AL.21: read again when the Git window closes, so the start card says the
  // repository it connected.
  const loadGitIntegration = useCallback(() => {
    if (!projectId) return;
    const supabase = getSupabaseClient();
    supabase
      .from('git_integrations')
      .select('id, default_branch, auto_sync, repo_owner, repo_name')
      .eq('project_id', projectId)
      .maybeSingle()
      .then(({ data }) => {
        setHasGitIntegration(!!data);
        setConnectedRepo(data?.repo_owner && data?.repo_name ? `${data.repo_owner}/${data.repo_name}` : null);
        // Owner 2026-07-30: display-only — the header annotates main with its
        // bound git ref (e.g. main → master) when they differ.
        setGitDefaultBranch(data?.default_branch ?? null);
        // B2: pre-migration rows read undefined → the column default (on).
        setGitAutoSync(data ? { integrationId: data.id, enabled: data.auto_sync !== false } : null);
      });
  }, [projectId]);
  useEffect(() => { loadGitIntegration(); }, [loadGitIntegration]);

  const [importProposal, setImportProposal] = useState<AIProposal | null>(null);
  const [importApplying, setImportApplying] = useState(false);
  const [importApplyingMessage, setImportApplyingMessage] = useState('');
  const [activeProposal, setActiveProposal] = useState<AIProposal | null>(null);
  const [currentSpecification, setCurrentSpecification] = useState<ProjectSpecification | null>(null);
  const specId = currentSpecification?.id ?? null;
  const specRealtimeData = useRealtimeSpecification(specId);
  // M.2 (owner's report 2026-09-22): specification_requirements is in the
  // realtime publication and this subscription is live, but Work's reads run
  // off refreshCounter (the GRAPH refresh) and never heard it — so a lock an
  // agent set over MCP stayed invisible in Work until something else
  // refreshed. Every realtime batch bumps a signal Work folds into its own
  // data version.
  const [specSignal, setSpecSignal] = useState(0);
  useEffect(() => { setSpecSignal((v) => v + 1); }, [specRealtimeData.requirements]);
  const specMappingsData = useRealtimeMappings(specId);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showProjectExplorer, setShowProjectExplorer] = useState(false);
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  // Owner spike 2026-09-04: the start path is chosen ON the canvas after
  // creation (ProjectStartPopup); a pasted specification is STAGED on the
  // project for the user's AI (SpecImportStagingPopup → get_project_status).
  const [showSpecStaging, setShowSpecStaging] = useState(false);
  const [stagedSpec, setStagedSpec] = useState<StagedSpecImport | null>(null);
  // AE.6: the explode requests the Expand button staged for the agent.
  const [stagedExplodes, setStagedExplodes] = useState<StagedExplode[]>([]);
  const [startDismissed, setStartDismissed] = useState(false);
  const [showGitModal, setShowGitModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [hasGitIntegration, setHasGitIntegration] = useState(false);
  const [connectedRepo, setConnectedRepo] = useState<string | null>(null);
  const [gitDefaultBranch, setGitDefaultBranch] = useState<string | null>(null);
  // B2: auto-sync gate — null until the integration row loads.
  const [gitAutoSync, setGitAutoSync] = useState<{ integrationId: string; enabled: boolean } | null>(null);
  // UX-1.1a → R23: OPT-IN auto-approval of incoming canvas proposals —
  // project-level, default OFF, stored in projects.metadata.
  // autoApproveProposals. The ONE control is the Agents button's Autonomy
  // settings (the architecture lane's Auto-apply writes the mirror); the
  // editor only READS it, live via the row subscription below.
  const [autoApproveProposals, setAutoApproveProposals] = useState(false);
  const autoApproveRef = useRef(false);
  autoApproveRef.current = autoApproveProposals;
  const [pendingGitChanges, setPendingGitChanges] = useState(0);
  // N6.2(c) rev 2: permanent Changes home — header badge count + arrival toast.
  const [changesPanelOpen, setChangesPanelOpen] = useState(false);
  // AK: the tab another surface asks the Agents panel to open on (the
  // header's MCP button: Connected; the walkthrough: Connected, Autonomy).
  // Opening it any other way lets the panel pick its own tab.
  const [agentsOpenOn, setAgentsOpenOn] = useState<{ tab: AgentsTab; at: number } | null>(null);
  const openAgents = useCallback((tab?: AgentsTab) => {
    setAgentsOpenOn(tab ? { tab, at: Date.now() } : null);
    setChangesPanelOpen(true);
  }, []);
  // AE.4: the Team popup beside Agents (a Team plan; the TopBar draws the button).
  const [teamOpen, setTeamOpen] = useState(false);
  // AL.3: below Team the Team button stays while the owner still has seats
  // to remove or hand over to; re-read when the popup closes.
  const [teamCheck, setTeamCheck] = useState(0);
  const teamBelowPlan = useTeamBelowPlan(projectId, gate, teamCheck);
  // R17: opened from an agent card in the Workflow inspector — the Changes
  // panel marks that proposal so the user lands on the thing they clicked.
  const [changesFocusProposal, setChangesFocusProposal] = useState<string | null>(null);
  // The Architecture rail's rows open Work on that record; Work's Lives on
  // chips open Architecture on that node. Two doors, one state each.
  const [workFocus, setWorkFocus] = useState<WorkFocus | null>(null);
  // UX-1.1a → R23: read the auto-approve mirror with the project and keep
  // it live — the writer is useAutonomySettings (the Agents overlay), which
  // may flip it while the editor is mounted, so the driver follows the row.
  useEffect(() => {
    if (!projectId) { setAutoApproveProposals(false); return; }
    const supabase = getSupabaseClient();
    const readFlag = (metadata: unknown) =>
      setAutoApproveProposals((metadata as Record<string, unknown> | null)?.autoApproveProposals === true);
    supabase
      .from('projects')
      .select('metadata')
      .eq('id', projectId)
      .maybeSingle()
      .then(({ data }) => readFlag(data?.metadata ?? null));
    const channel = supabase
      .channel(`project-autonomy-${projectId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        (payload) => readFlag((payload.new as { metadata?: unknown } | null)?.metadata ?? null))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [projectId]);

  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const prevProposalCountRef = useRef(0);
  const handlePendingCountChange = useCallback((count: number) => {
    setPendingProposalCount(count);
    if (count > prevProposalCountRef.current) {
      // A finalized repo-import lands straight in its review panel — the whole
      // point of the AI-driven lane is that the user's next act is reviewing.
      void (async () => {
        try {
          if (!branchId) return;
          const pending = await proposalService.listProposalsByBranch(branchId, 'pending');
          const importProp = pending.find(pr => pr.metadata && 'finalization' in (pr.metadata as Record<string, unknown>));
          if (importProp) {
            setImportProposal(importProp);
            return;
          }
        } catch { /* fall through to the toast */ }
        // UX-1.1a: with auto-approve ON the driver is about to apply these —
        // a "come review" toast would be noise (the applied toast follows).
        if (!autoApproveRef.current) {
          showWarning(`New proposal${count > 1 ? 's' : ''} waiting: open Agents in the header to review`);
        }
      })();
    }
    prevProposalCountRef.current = count;
  }, [showWarning, branchId, proposalService]);
  // V3 P3 (task 3.1): the two-view shell — Ideation | Architecture. The
  // retired specification view's dirty-guard and test-suite cache went with
  // it (R4); the project export assembles its own test suite on demand.
  const [viewMode, setViewMode] = useState<'ideation' | 'architecture'>('ideation');
  const handleViewModeChange = useCallback((mode: 'ideation' | 'architecture') => {
    setViewMode(mode);
  }, []);
  const [availableBranches, setAvailableBranches] = useState<Array<{ id: string; name: string; isPrimary: boolean }>>([]);
  // Item 16: the open branch as the database names it now (connect renames
  // the primary to the tracked git branch; the name it opened with goes stale).
  const openName = useMemo(() => openBranchName(availableBranches, branchId, branchName), [availableBranches, branchId, branchName]);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set());
  // N5.5: one sidepane; the workbench is its Files tab.
  const [sidepaneTab, setSidepaneTab] = useState<SidepaneTab>('details');
  const [nodeExportContext, setNodeExportContext] = useState<NodeExportContext | null>(null);
  const [projectExportData, setProjectExportData] = useState<ProjectExportData | null>(null);
  const [workbenchInitialArtifactId, setWorkbenchInitialArtifactId] = useState<string | null>(null);
  // WS4: the Regenerate lane (this counter's only writer) is gone — test results
  // arrive over MCP via realtime; the counter stays as the downstream refresh hook.
  const [testRefreshCounter] = useState(0);
  const { refreshGraph, isRefreshing, refreshCounter } = useSmoothRefresh({
    store,
    projectId,
    branchId,
    onError: showError,
  });

  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);
  const [pendingProjectCreateAfterOnboarding, setPendingProjectCreateAfterOnboarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadFlag = async () => {
      const localFlag = localStorage.getItem('specgraph_onboarding_seen') === 'true';
      if (!userId) {
        if (!cancelled) setHasSeenOnboarding(localFlag);
        return;
      }
      try {
        const supabase = getSupabaseClient();
        const read = await supabase
          .from('user_settings')
          .select('has_seen_onboarding')
          .eq('user_id', userId)
          .maybeSingle();
        // Owner bug 2026-08-14: `remoteFlag || localFlag` made the walkthrough
        // per-BROWSER — any machine that ever completed it marked every NEW
        // account as seen, and then upserted that lie into the new user's
        // user_settings. Signed-in truth is the user's own record; this
        // browser's flag decides only when there is no answer (seenWalkthrough).
        if (!cancelled) setHasSeenOnboarding(seenWalkthrough(read, localFlag));
      } catch {
        if (!cancelled) setHasSeenOnboarding(seenWalkthrough(null, localFlag));
      }
    };
    loadFlag();
    return () => { cancelled = true; };
  }, [userId]);

  // Owner flow ruling 2026-08-14: signup → project wizard → CANVAS → the
  // walkthrough engages here, gated at the MCP step. The project already
  // exists by the time the canvas mounts (the wizard ran first), so closing
  // must NOT queue another project-create — that pending flag is only set by
  // the explicit new-project path in ProjectExplorer.
  useEffect(() => {
    if (hasSeenOnboarding === false && !showOnboarding) {
      setShowOnboarding(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSeenOnboarding]);

  const loadBranches = useCallback(async () => {
    if (!projectId) return;

    try {
      // Item 16: the rows only. This used to load every branch's whole patch
      // log to count it, and nothing showed the count.
      const rows = await projectService.listBranches(projectId);
      setAvailableBranches(rows.map(b => ({ id: b.id, name: b.name, isPrimary: b.isPrimary })));
    } catch (error) {
      console.error('Failed to load branches:', error);
    }
  }, [projectId, projectService]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const [projectWorkflowOrigin, setProjectWorkflowOrigin] = useState<WorkflowOrigin | undefined>(undefined);

  useEffect(() => {
    setStartDismissed(false);
    setShowSpecStaging(false);
    const loadProjectMetadata = async () => {
      if (!projectId) {
        setProjectWorkflowOrigin(undefined);
        setStagedSpec(null);
        setStagedExplodes([]);
        return;
      }
      try {
        const project = await projectService.getProject(projectId);
        const origin = project.metadata?.workflowOrigin;
        if (origin === 'idea' || origin === 'code' || origin === 'import-spec') {
          setProjectWorkflowOrigin(origin);
        } else {
          setProjectWorkflowOrigin(undefined);
        }
        setStagedSpec(readStagedSpecImport(project.metadata));
        setStagedExplodes(readStagedExplodes(project.metadata));
      } catch {
        setProjectWorkflowOrigin(undefined);
        setStagedSpec(null);
        setStagedExplodes([]);
      }
    };
    loadProjectMetadata();
  }, [projectId, projectService]);

  // Read-modify-write on projects.metadata so sibling keys (autoApproveProposals,
  // publishedTemplateId, …) survive a start-path or staging write.
  const patchProjectMetadata = useCallback(async (patch: Record<string, unknown>) => {
    if (!projectId) throw new Error('No project open');
    const supabase = getSupabaseClient();
    const { data, error: readError } = await supabase.from('projects').select('metadata').eq('id', projectId).maybeSingle();
    if (readError) throw new Error(readError.message);
    const next = { ...((data?.metadata as Record<string, unknown>) ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    const { error: writeError } = await supabase.from('projects').update({ metadata: next }).eq('id', projectId);
    if (writeError) throw new Error(writeError.message);
  }, [projectId]);

  const stampWorkflowOrigin = useCallback((origin: WorkflowOrigin) => {
    setProjectWorkflowOrigin(origin);
    patchProjectMetadata({ workflowOrigin: origin }).catch((err) => {
      console.error('Failed to record the start path:', err);
    });
  }, [patchProjectMetadata]);

  const handleStageSpec = useCallback(async (staged: StagedSpecImport) => {
    await patchProjectMetadata({ stagedSpecImport: staged, workflowOrigin: 'import-spec' });
    setStagedSpec(staged);
    setProjectWorkflowOrigin('import-spec');
  }, [patchProjectMetadata]);

  const handleClearStagedSpec = useCallback(async () => {
    await patchProjectMetadata({ stagedSpecImport: undefined });
    setStagedSpec(null);
  }, [patchProjectMetadata]);

  // AE.6: the Expand button stages an explode request the agent picks up
  // over MCP (get_project_status leads with it). A write also drops requests
  // whose node is gone; the key is removed when nothing is staged.
  const writeStagedExplodes = useCallback(async (next: StagedExplode[]) => {
    const kept = pruneStagedExplodes(next, storeState.derivedGraph, { dropAbsent: true });
    await patchProjectMetadata({ stagedExplodes: kept.length > 0 ? kept : undefined });
    setStagedExplodes(kept);
  }, [patchProjectMetadata, storeState.derivedGraph]);
  const handleRequestExplode = useCallback((nodeId: string) => {
    const node = storeState.derivedGraph.nodes[nodeId];
    if (!node) return;
    writeStagedExplodes(stageExplode(stagedExplodes, { id: node.id, label: node.label })).catch((err) => {
      console.error('Could not stage the expansion request:', err);
    });
  }, [stagedExplodes, storeState.derivedGraph.nodes, writeStagedExplodes]);
  const handleWithdrawExplode = useCallback((nodeId: string) => {
    writeStagedExplodes(withdrawExplode(stagedExplodes, nodeId)).catch((err) => {
      console.error('Could not withdraw the expansion request:', err);
    });
  }, [stagedExplodes, writeStagedExplodes]);
  // Once the parts land (the agent's proposal accepted), the request is done.
  useEffect(() => {
    if (stagedExplodes.length === 0) return;
    const pruned = pruneStagedExplodes(stagedExplodes, storeState.derivedGraph);
    if (pruned.length !== stagedExplodes.length) {
      writeStagedExplodes(pruned).catch((err) => console.error('Could not drop a fulfilled expansion request:', err));
    }
  }, [stagedExplodes, storeState.derivedGraph, writeStagedExplodes]);

  useEffect(() => {
    const loadSpecification = async () => {
      if (!projectId) {
        setCurrentSpecification(null);
        return;
      }

      try {
        const specs = await specificationService.getSpecificationsByProject(projectId);
        if (specs.length > 0) {
          setCurrentSpecification(specs[0]);
        } else {
          setCurrentSpecification(null);
        }
      } catch (error) {
        console.error('[GraphEditor] Failed to load specification:', error);
        setCurrentSpecification(null);
      }
    };

    loadSpecification();
  }, [projectId, specificationService, refreshCounter]);

  // The walkthrough takes the app to the surface a stop explains.
  const handleWalkthroughSurface = useCallback((surface: WalkthroughSurface) => {
    if (surface.view === 'agents') { openAgents(surface.tab); return; }
    setChangesPanelOpen(false);
    const target = surfaceTarget(surface, Date.now());
    handleViewModeChange(target.view);
    if (target.focus) setWorkFocus(target.focus);
  }, [handleViewModeChange, openAgents]);

  const handleCloseOnboarding = useCallback(() => {
    setShowOnboarding(false);
    localStorage.setItem('specgraph_onboarding_seen', 'true');
    setHasSeenOnboarding(true);
    if (userId) {
      const supabase = getSupabaseClient();
      supabase
        .from('user_settings')
        .upsert({ user_id: userId, has_seen_onboarding: true }, { onConflict: 'user_id' })
        .then(() => {});
    }
    if (pendingProjectCreateAfterOnboarding) {
      setPendingProjectCreateAfterOnboarding(false);
      setShowProjectCreate(true);
    }
  }, [userId, pendingProjectCreateAfterOnboarding]);
  // AJ.6: the tour over the example ends by starting the account's own project.
  const handleWalkthroughCreateProject = useCallback(() => {
    handleCloseOnboarding();
    setShowProjectCreate(true);
  }, [handleCloseOnboarding]);

  useEffect(() => {
    return store.subscribe(setStoreState);
  }, [store]);

  useEffect(() => {
    document.documentElement.style.setProperty('--theme-background', c.background);
    document.documentElement.style.setProperty('--theme-surface', c.surface);
    document.documentElement.style.setProperty('--theme-border', c.border);
    document.documentElement.style.setProperty('--theme-text', c.text);
    document.documentElement.style.setProperty('--theme-text-secondary', c.textSecondary);
    document.documentElement.style.setProperty('--theme-text-muted', c.textMuted);
  }, [c]);

  const handleWarning = useCallback(
    (message: string) => {
      console.warn('[SpecGraph]', message);
      showWarning(message);
    },
    [showWarning]
  );

  const handleError = useCallback(
    (message: string) => {
      console.error('[SpecGraph]', message);
      showError(message);
    },
    [showError]
  );

  // AA.5 (owner 2026-09-23): "if a node is leased, then it is locked." A
  // person's edit to a node someone else holds a fresh lease on (the node,
  // or work inside it) is refused here, before it reaches the draft, naming
  // the holder. Moving a node is layout and passes. The database refuses the
  // same edit if anything gets past this (migration 20260923140000).
  const leaseBoard = useAgentPresence(projectId);
  const leases = useMemo(() => nodeLeases(leaseBoard.holds, userId ? `user:${userId}` : null), [leaseBoard.holds, userId]);
  const leasesRef = useRef(leases);
  leasesRef.current = leases;

  // AA.2: the change a person is making to an imported system, on the
  // canvas: one line names it with its proof count and shows its scope.
  const changeBoard = useChangeScope(projectId, branchId, storeState.derivedGraph, gate.can('workflow_space'), refreshCounter + specSignal);
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null);
  const [changeScopeOn, setChangeScopeOn] = useState(false);
  const activeChange = changeBoard.changes.find((ch) => ch.id === activeChangeId) ?? changeBoard.changes[0] ?? null;
  const shownScope = useMemo(
    () => (activeChange && changeScopeOn && activeChange.scope.nodeIds.length > 0
      ? canvasScope(activeChange, (id) => storeState.derivedGraph.nodes[id]?.parentId)
      : null),
    [activeChange, changeScopeOn, storeState.derivedGraph.nodes],
  );
  const graphForLeasesRef = useRef<Graph | null>(null);
  graphForLeasesRef.current = storeState.derivedGraph;
  const handlePatchesGeneratedInternal = useCallback(
    (patches: PatchOperation[]) => {
      const g = graphForLeasesRef.current;
      const refusal = leasedEditRefusal(patches, leasesRef.current, {
        resolve: (id) => {
          const edge = g?.edges?.[id];
          if (edge) return [edge.source, edge.target];
          const artifact = g?.artifacts?.[id] as { nodeId?: string } | undefined;
          return artifact?.nodeId ? [artifact.nodeId] : [];
        },
        labelOf: (nodeId) => g?.nodes?.[nodeId]?.label ?? 'This node',
        // AA.3: an exploded node's lease covers its parts.
        boxOf: (nodeId) => {
          const parentId = g?.nodes?.[nodeId]?.parentId;
          const parent = parentId ? g?.nodes?.[parentId] : undefined;
          return parent && g && isExplodedNode(parent, g) ? parent.id : null;
        },
      });
      if (refusal) {
        showWarning(refusal);
        return;
      }
      const result = store.proposePatches(patches);
      if (!result.success && result.error) {
        showError(result.error);
      }
    },
    [store, showError, showWarning]
  );

  // N6.1 (owner: "add undo and redo functionality that can revert the canvas since
  // canvas changes are not automatic pushes to git"). The store restores whole-graph
  // snapshots; persistence of the restored graph is handled by the graphRevision
  // effect below (autosave alone only fires while pending patches exist).
  const handleUndo = useCallback(() => {
    if (!store.undo()) showWarning('Nothing to undo');
  }, [store, showWarning]);

  const handleRedo = useCallback(() => {
    if (!store.redo()) showWarning('Nothing to redo');
  }, [store, showWarning]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
        return;
      }
      // Cmd/Ctrl+Z undo · Cmd/Ctrl+Shift+Z or Ctrl+Y redo.
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'Z' || e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      store.setSelectedNode(nodeId);
      setHighlightedNodeIds(new Set());
    },
    [store]
  );

  const handleEdgeSelect = useCallback(
    (edgeId: string) => {
      store.setSelectedEdge(edgeId);
      // N5.5: edges have no Files tab — snap the sidepane back to Details.
      setSidepaneTab('details');
      setWorkbenchInitialArtifactId(null);
    },
    [store]
  );

  const handleBackgroundClick = useCallback(() => {
    store.clearSelection();
    setHighlightedNodeIds(new Set());
    setSidepaneTab('details');
    setWorkbenchInitialArtifactId(null);
  }, [store]);

  // The door into Work from another surface (the Architecture rail's rows,
  // the decision page's Edit first): the record becomes Work's focus, the
  // panel and the node selection close, the view switches.
  const openWork = useCallback((target: WorkTarget) => {
    setWorkFocus({ ...target, at: Date.now() });
    setChangesPanelOpen(false); setChangesFocusProposal(null);
    handleBackgroundClick();
    handleViewModeChange('ideation');
  }, [handleBackgroundClick, handleViewModeChange]);

  // N6: SpecificationEditorPanel + its editingSpecification gate deleted — the gate
  // was never set non-null, so the panel could never render (dead mount since audit).
  const handleUpdateCurrentSpecification = useCallback(async (updated: ProjectSpecification) => {
    if (!updated.id) return;

    try {
      const updateInput = {
        vision: updated.vision,
        constraints: updated.constraints,
        preferences: updated.preferences,
        metadata: updated.metadata,
        lockedNodes: updated.lockedNodes,
      };
      const updatedSpec = await specificationService.updateSpecification(updated.id, updateInput);
      setCurrentSpecification(updatedSpec);
    } catch (error) {
      showError('Failed to update specification: ' + (error instanceof Error ? error.message : 'Unknown error'));
      console.error('[GraphEditor] Failed to update specification:', error);
    }
  }, [specificationService, showError]);

  const handleArtifactClick = useCallback((artifactId: string, _autoGenerate = false) => {
    setWorkbenchInitialArtifactId(artifactId);
    setSidepaneTab('files');
  }, []);

  const handleRepoFileSelect = useCallback((artifactId: string, nodeId: string) => {
    setHighlightedNodeIds(new Set([nodeId]));
    store.setSelectedNode(nodeId);
    // N5.5: clicking a file opens the sidepane's Files tab focused on it — the sidebar
    // used to only select the node, leaving the file one more click away.
    handleArtifactClick(artifactId);
  }, [store, handleArtifactClick]);

  // P1-7 R2.1: hydrate a content-less bound artifact from the repo. The anchor is a MAP —
  // adoption materializes {path, kind, hash} bindings without bodies (git owns file content),
  // and until this existed there was NO way to pull a body in (import is blocked on anchored
  // repos; per-file Accept only covers post-adoption changes).
  const [gitService] = useState(() => new GitService(getSupabaseClient()));
  const handleLoadArtifactFromRepo = useCallback(async (artifactId: string): Promise<boolean> => {
    const artifact = storeState.derivedGraph.artifacts[artifactId];
    if (!artifact?.path || !projectId) return false;
    try {
      const integration = await gitService.getIntegration(projectId);
      if (!integration) {
        showWarning('Connect a git repository first (Git panel) — this file\'s content lives in your repo.');
        return false;
      }
      const path = artifact.path.startsWith('/') ? artifact.path.slice(1) : artifact.path;
      // Owner bench 2026-07-29: fetch from the ACTIVE branch's bound ref — the
      // default-branch fetch errored whenever you worked on a feature branch.
      const files = await gitService.fetchFileContent(integration.id, [path], openName ?? undefined);
      const file = files.find(f => f.path === path) ?? files[0];
      if (!file || file.content === undefined) {
        showError(`File not found in the repo at ${path}. It may not exist on the ${openName || integration.defaultBranch} branch.`);
        return false;
      }
      const fetchedHash = computeContentHash(file.content);
      if (artifact.contentHash && artifact.contentHash !== fetchedHash) {
        // Anchor hash mismatch = the repo file changed since the anchor was written. Git owns
        // content, so we load it anyway — but say so instead of pretending they match.
        showWarning(`Loaded ${path}: repo content is newer than the design anchor recorded (hash differs).`);
      }
      const patch = createUpdateArtifactPatch(
        artifactId,
        { content: file.content, contentHash: fetchedHash, updatedAt: nowIso() },
        { actorType: 'human', summary: `Load ${path} from repository` }
      );
      const result = store.proposePatches([patch]);
      if (!result.success && result.error) {
        showError(result.error);
        return false;
      } else if (!(artifact.contentHash && artifact.contentHash !== fetchedHash)) {
        showWarning(`Loaded ${path} from the repository`);
      }
      return true;
    } catch (error) {
      showError('Failed to load from repo: ' + (error instanceof Error ? error.message : 'Unknown error'));
      return false;
    }
  }, [storeState.derivedGraph.artifacts, projectId, openName, gitService, store, showWarning, showError]);

  // P1-7 C2: export one node's context as a strict slice of the model anchor — the same
  // shapes and hashes that land in .nodespec/model.json, plus REQ-### references and the
  // task-doc packet pointer. Feed this + the task doc to an external AI for
  // component-local work; no catalog guidance is ever included (IP boundary).
  const handleExportNodeContext = useCallback(async (nodeId: string) => {
    const node = storeState.derivedGraph.nodes[nodeId];
    if (!node) return;
    const gateCheck = gate.check('node_context_export');
    if (!gateCheck.allowed) {
      showWarning(gateCheck.rule.upgradeMessage);
      return;
    }
    try {
      let requirements: string[] = [];
      if (specId) {
        const [mappings, reqs] = await Promise.all([
          specificationService.getMappingsByNode(nodeId),
          specificationService.getRequirementsBySpecification(specId),
        ]);
        const humanById = new Map(reqs.map(r => [r.id, r.requirementId]));
        requirements = [...new Set(
          mappings
            .filter(m => m.specificationId === specId && m.requirementId)
            .map(m => humanById.get(m.requirementId!))
            .filter((x): x is string => Boolean(x))
        )];
      }
      const taskDoc = Object.values(storeState.derivedGraph.artifacts).find(
        a => a.nodeId === nodeId && a.kind === 'task' && a.path
      );
      const slice = await buildNodeAnchorSlice(storeState.derivedGraph, nodeId, {
        requirements,
        taskDocPath: taskDoc?.path ?? null,
      });
      if (!slice) return;
      const blob = new Blob([serializeNodeAnchorSlice(slice)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const slug = node.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
      link.download = `${slug}.context.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showError('Failed to export node context: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }, [storeState.derivedGraph, gate, specId, specificationService, showWarning, showError]);

  const { derivedGraph, activeBranch, selectedNodeId, selectedEdgeId, selectedArtifactId, graphRevision } = storeState;

  // Owner spike 2026-08-23: the trunk is identified by the flag, never the
  // literal name 'main' — connect renames the trunk row to the bound git
  // branch, and every merge/switch/guard lane targets THIS name. AD.4 (D15):
  // null until the branches load; a git lane with no branch named lets the
  // server find the primary by its flag.
  const primaryBranchName = useMemo<string | null>(
    () => availableBranches.find(b => b.isPrimary)?.name ?? null,
    [availableBranches],
  );
  /** The branch the git lanes act on: the open one, else the primary. */
  const gitBranchName: string | null = openName || primaryBranchName;
  const primaryBranchNameRef = useRef(primaryBranchName);
  primaryBranchNameRef.current = primaryBranchName;


  const handlePatchesGenerated = useCallback(
    (patches: PatchOperation[]) => {
      handlePatchesGeneratedInternal(patches);
    },
    [handlePatchesGeneratedInternal]
  );

  const handlePatchGenerated = useCallback(
    (patch: PatchOperation) => {
      handlePatchesGenerated([patch]);
    },
    [handlePatchesGenerated]
  );

  // P1-7 C1.2: single save path shared by the Save Draft button, the debounced autosave, and
  // the pre-push guard. `silent` suppresses toasts (autosave must not spam); the ref lock
  // prevents overlapping saves (autosave firing while a manual save is in flight). Returns
  // whether the draft is persisted after the call — true when there was nothing to save.
  const isSavingRef = useRef(false);
  // Live mirror of the pending patch list. A save takes several network round-trips; any
  // patch proposed DURING that window (bench-caught 2026-07-18: an artifact unlock landing
  // while an autosave was in flight) must survive the save's completion — the old code reset
  // the list to [] and silently destroyed mid-save work.
  const livePatchesRef = useRef<PatchOperation[]>([]);
  useEffect(() => {
    livePatchesRef.current = activeBranch.patches;
  }, [activeBranch.patches]);
  const saveDraftInternal = useCallback(async (opts: { silent?: boolean } = {}): Promise<boolean> => {
    const silent = opts.silent ?? false;
    if (!projectId || !userId) {
      if (!silent) showWarning('Cannot save: missing project information');
      return false;
    }

    if (!branchId) {
      if (!silent) showError('This project has no branch open. Reopen the project to save.');
      return false;
    }

    if (activeBranch.patches.length === 0) {
      if (!silent) showWarning('No changes to save');
      return true;
    }

    if (isSavingRef.current) return false;
    isSavingRef.current = true;
    try {
      // APPEND-ONLY (2026-07-19). The old clear-then-reappend reset graph_patches sequences
      // to 1 on every save, while accepted proposals stamped snapshots with LARGER
      // patch_sequence values — so loadSnapshot (patch_sequence DESC) returned an old accept
      // snapshot forever and newly accepted artifacts never reached the canvas. It also
      // re-chained the P0-5 hash chain from scratch each save and violated the documented
      // realtime contract (monotonic sequences). Now: dedup already-persisted patch ids
      // (idempotent retry after a failed save), append the rest, and stamp the snapshot with
      // the TRUE max sequence so snapshot ordering is monotonic across saves AND accepts.
      const existingRows = await patchService.loadPatches(branchId);
      const existingIds = new Set(existingRows.map(p => p.id));
      const toAppend = activeBranch.patches.filter(p => !existingIds.has(p.metadata.id));
      const persisted = toAppend.length > 0
        ? await patchService.appendPatches(branchId, toAppend, userId)
        : [];
      const maxSequence = Math.max(
        0,
        ...existingRows.map(p => p.sequence),
        ...persisted.map(p => p.sequence),
      );

      const snapshot = await projectService.saveSnapshot(
        projectId,
        branchId,
        derivedGraph,
        maxSequence
      );

      await branchService.updateBranchBaseSnapshot(branchId, snapshot.id);

      // Only clear what THIS save persisted. Patches proposed while the save was in flight
      // (the closure captured the list at save start) are carried forward and replayed on
      // the new base — never silently destroyed. Patches are append-only between saves, so
      // the slice is exactly the unsaved suffix.
      // N6.1 fix (owner-caught): this used to be setBaseSnapshot + switchToBranch, and
      // BOTH clear the undo/redo stacks — so undo went dead ~3s after every edit. A save
      // is bookkeeping on the same canvas, not a canvas change: commitSavedSnapshot
      // advances the base and keeps the history.
      const unsavedDuringSave = livePatchesRef.current.slice(activeBranch.patches.length);
      store.commitSavedSnapshot(derivedGraph, unsavedDuringSave);

      if (!silent) showWarning(`Saved ${activeBranch.patches.length} changes to ${openName ?? activeBranch.name}`);
      await loadBranches();

      specificationService.getSpecificationsByProject(projectId).then(specs => {
        if (specs.length > 0) {
          specificationService.runOrphanMappingSync(specs[0].id).catch(() => {});
        }
      }).catch(() => {});
      return true;
    } catch (error) {
      if (silent) {
        console.warn('[GraphEditor] autosave failed (changes stay pending in memory):', error);
      } else {
        showError('Failed to save: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
      return false;
    } finally {
      isSavingRef.current = false;
    }
  }, [projectId, branchId, userId, openName, activeBranch, derivedGraph, store, showWarning, showError, loadBranches, projectService, patchService, branchService, specificationService]);

  // P1-7 C1.2: debounced autosave — a manual canvas edit is an in-memory patch until saved,
  // and git-push reads only the persisted snapshot. Every new patch resets the timer (the
  // patches array identity changes per proposePatches); a completed save empties the array,
  // which cancels the pending timer via cleanup.
  useEffect(() => {
    if (activeBranch.patches.length === 0) return;
    const timer = setTimeout(() => {
      void saveDraftInternal({ silent: true });
    }, 3000);
    return () => clearTimeout(timer);
  }, [activeBranch.patches, saveDraftInternal]);

  // N6.1: an undo/redo replaces the canvas WITHOUT producing patches, so the debounced
  // autosave (which only runs while patches exist) would never persist it and a reload
  // would resurrect the reverted state. Persist the restored graph as a snapshot —
  // no patch append, so the append-only hash chain is untouched (guardrail i); the log
  // keeps every forward edit and the snapshot is what moves back.
  const lastPersistedRevisionRef = useRef(0);
  useEffect(() => {
    if (graphRevision === lastPersistedRevisionRef.current) return;
    lastPersistedRevisionRef.current = graphRevision;
    if (!projectId || !branchId) return;
    const graphToPersist = derivedGraph;
    void (async () => {
      try {
        const existingRows = await patchService.loadPatches(branchId);
        const maxSequence = Math.max(0, ...existingRows.map(p => p.sequence));
        const snapshot = await projectService.saveSnapshot(projectId, branchId, graphToPersist, maxSequence);
        await branchService.updateBranchBaseSnapshot(branchId, snapshot.id);
      } catch (error) {
        console.warn('[GraphEditor] failed to persist reverted canvas (state stays in memory):', error);
      }
    })();
  }, [graphRevision, projectId, branchId, derivedGraph, patchService, projectService, branchService]);

  // P1-7 C1.2: pre-push guard — makes sure everything on the canvas is in the snapshot the
  // push will read. True = safe to push (saved, or nothing pending).
  const ensureDraftSaved = useCallback(async (): Promise<boolean> => {
    if (activeBranch.patches.length === 0) return true;
    return saveDraftInternal({ silent: true });
  }, [activeBranch.patches.length, saveDraftInternal]);



  // R3-3c: switching to a git-bound branch checks THAT branch's ref for freshness
  // (the R3 core loop: git is the durable model store, the canvas a working copy).
  // Best-effort and fire-and-forget — switching must never fail on provider reach.
  const checkBranchFreshness = useCallback((named: string | null) => {
    if (!projectId) return;
    void (async () => {
      try {
        const integration = await gitService.getIntegration(projectId);
        if (!integration) return;
        const sweep = await gitService.detectDrift(integration.id, { ...(named ? { branchName: named } : {}), force: true });
        const label = named ? `"${named}"` : 'The primary branch';
        const status = sweep?.status as string | undefined;
        if (status === 'behind_in_sync') {
          // V3 AD.2b (D4): the working copy is untouched since its baseline and
          // the ref moved. Nothing loads under an open editor: git's model is
          // filed as a proposal the person accepts. An automatic load never
          // re-anchors a rewritten history.
          const filed = await gitService.restoreModel(integration.id, named ?? undefined, { automatic: true });
          if (filed.status !== 'identical') {
            showWarning(`${label} is behind its git branch: the repository's model is waiting in Proposals.`);
          }
        } else if (status === 'load_proposed') {
          // A merged NodeSpec pull request came home; the sync check filed it.
          showWarning(`${label} received a merged pull request: the repository's model is waiting in Proposals.`);
        } else if (status === 'ref_deleted') {
          showWarning(`The git branch for ${named ? `"${named}"` : 'the primary branch'} no longer exists (likely merged and deleted). Open the Git panel to archive or keep this design branch.`);
        }
        // 'drift' raised the standard card — the header Git badge surfaces it.
      } catch (err) {
        console.warn('[GraphEditor] branch freshness check failed:', err);
      }
    })();
  }, [projectId, gitService, refreshGraph, showWarning]);

  // Owner 2026-07-30 (detection latency): a page LOAD runs the same forced,
  // branch-scoped freshness check a branch SWITCH runs — refresh is now a
  // reliable detector (incl. the behind-in-sync auto-load), webhook or not.
  const initialFreshnessRanRef = useRef(false);
  useEffect(() => {
    if (initialFreshnessRanRef.current) return;
    if (!projectId || !hasGitIntegration) return;
    initialFreshnessRanRef.current = true;
    checkBranchFreshness(openName || primaryBranchNameRef.current);
    // count refresh rides the sweep result landing in the DB
    setTimeout(() => refreshPendingGitCount(), 4000);
  }, [projectId, hasGitIntegration, openName, checkBranchFreshness, refreshPendingGitCount]);

  // …and while the tab is VISIBLE, a non-forced sweep runs each minute. The
  // server's 60s claim throttle dedupes concurrent tabs/pollers, so this costs
  // at most one provider round per window — cards appear within ~a minute of an
  // out-of-band commit without opening the Git panel or switching branches.
  // Deliberately non-forced and no auto-restore here: background polling only
  // ever RAISES cards; loading a model stays a user-initiated act.
  const branchNameRef = useRef(openName);
  branchNameRef.current = openName;
  useEffect(() => {
    if (!projectId || !hasGitIntegration) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        try {
          const integration = await gitService.getIntegration(projectId);
          if (!integration) return;
          await gitService.detectDrift(integration.id, { branchName: branchNameRef.current || primaryBranchNameRef.current || undefined });
          refreshPendingGitCount();
        } catch { /* background poll — never surfaces */ }
      })();
    }, 60_000);
    return () => clearInterval(timer);
  }, [projectId, hasGitIntegration, gitService, refreshPendingGitCount]);

  // R3-3c: the ref-deleted card's Archive action — the ONE lane where a design
  // branch row (and, inside deleteBranch, its patch log) goes away after a merge.
  const handleArchiveBranch = useCallback(async (name: string) => {
    if (name === primaryBranchName) throw new Error('Cannot archive the primary branch');
    const entry = availableBranches.find(b => b.name === name);
    if (!entry) throw new Error(`Design branch "${name}" not found`);
    await branchService.deleteBranch(entry.id);
    await loadBranches();
  }, [availableBranches, branchService, loadBranches, primaryBranchName]);


  // R3-4b: the accept lane stamps provenance (origin + commit sha) and promotes a
  // suggested artifact to draft — see buildGitAcceptPatch for the full rationale.
  // Owner 2026-07-30: returns null on success or a user-visible error string —
  // a LOCKED (complete) artifact used to fail the patch while the modal consumed
  // the card row anyway, resolving the card and advancing the baseline: the
  // external change vanished with neither side winning, and the next push
  // silently overwrote the repo's copy. Failure now keeps the card alive with
  // the reason on it (same contract as onBindResidueFile).
  const handleAcceptGitChange = useCallback((artifactId: string, newContent: string, path: string, sourceCommit?: string): string | null => {
    const artifact = derivedGraph.artifacts[artifactId];
    if (artifact?.status === 'complete') {
      return `"${path}" is locked (Complete). Unlock it in the Files tab first, then accept — or dismiss the card to keep the canvas version (your next push overwrites the repo's change; the commit stays recoverable under Recently resolved).`;
    }
    const patch = buildGitAcceptPatch(artifact, artifactId, newContent, path, sourceCommit);
    const result = store.proposePatches([patch]);
    if (result.success) {
      showWarning(`Updated artifact from external change: ${path}`);
      // R5e: the implementation this node's git-ticked criteria vouched for just
      // changed — their evidence proved the OLD code. Flag "re-verify" on those
      // criteria (met stays true; stale is a prompt, not a retraction).
      // Fire-and-forget: a flag failure must never affect the accept (the R4
      // auto-push contract). Deterministic chain: file→artifact→node→criterion.
      if (projectId && artifact?.nodeId) {
        void flagNodeEvidenceStale(getSupabaseClient(), projectId, artifact.nodeId, sourceCommit)
          .then(({ flagged }) => {
            if (flagged.length > 0) {
              const reqs = [...new Set(flagged.map((f) => f.requirementId))].join(', ');
              showWarning(`${flagged.length} met acceptance criterion(s) on ${reqs} now read "evidence stale — re-verify": their proof predates this change.`);
            }
          })
          .catch(() => { /* accept already succeeded; staleness is best-effort */ });
      }
      return null;
    }
    return result.error ?? 'Patch failed for an unknown reason';
  }, [store, derivedGraph.artifacts, showWarning, projectId]);

  const handleDeleteGitArtifact = useCallback((artifactId: string, path: string): string | null => {
    const artifact = derivedGraph.artifacts[artifactId];
    if (artifact?.status === 'complete') {
      return `"${path}" is locked (Complete). Unlock it in the Files tab first, then apply the deletion — or dismiss the card to keep the canvas version.`;
    }
    const patch = createRemoveArtifactPatch(
      artifactId,
      { actorType: 'human' as ActorType, summary: `Accepted deletion of ${path}` }
    );
    const result = store.proposePatches([patch]);
    if (result.success) {
      showWarning(`Removed artifact from external deletion: ${path}`);
      return null;
    }
    return result.error ?? 'Patch failed for an unknown reason';
  }, [store, derivedGraph.artifacts, showWarning]);

  // R3-4c: the manual attribution lane — bind an unattributed repo file (residue)
  // to a node. The modal fetched the content; this applies the binding pair.
  // Returns null on success, or a user-visible error string (owner bench
  // 2026-07-29: a failed bind was INVISIBLE — the error toast rendered behind the
  // modal and the void callback let the modal mark the row handled anyway).
  const handleBindResidueFile = useCallback((path: string, nodeId: string, content: string, sourceCommit?: string): string | null => {
    const node = derivedGraph.nodes[nodeId];
    if (!node) {
      return 'Cannot bind: node not found on the canvas';
    }
    // Sequential IN ORDER, one patch per call — see buildResidueBindPatches (batch
    // reorder trap + the heal-first sequence for pre-existing stale references,
    // the owner-bench silent-bind failure).
    const liveIds = new Set(Object.keys(derivedGraph.artifacts));
    const patches = buildResidueBindPatches(node, path, content, sourceCommit, liveIds);
    for (const patch of patches) {
      const result = store.proposePatches([patch]);
      if (!result.success) {
        return `Bind failed at "${patch.metadata.summary}": ${result.error ?? 'unknown patch error'}`;
      }
    }
    showWarning(`Bound "${path}" to node "${node.label}"`);
    return null;
  }, [derivedGraph.nodes, derivedGraph.artifacts, store, showWarning]);

  const bindTargetNodes = useMemo(() =>
    Object.values(derivedGraph.nodes)
      .filter(n => !getContainerTypeById(n.type))
      .map(n => ({ id: n.id, label: n.label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  [derivedGraph.nodes]);

  // B2+B3 (docs/WORK_LOOP_PLAN.md): content-only change cards auto-accept and
  // declared new files auto-bind through the SAME lanes the buttons drive —
  // patch pipeline, provenance, R5e evidence-staleness — then the card
  // resolves with an autoSynced stamp. Everything that carries a question
  // (deletes, moves, unattributed residue, model/spec, ticks, locks,
  // generator docs, flagged declarations) keeps its card; see
  // isAutoSyncEligible. Mounted BELOW both handler definitions (TDZ).
  useGitAutoSync({
    enabled: gitAutoSync?.enabled === true && hasGitIntegration && !!gitBranchName,
    projectId: projectId ?? null,
    integrationId: gitAutoSync?.integrationId ?? null,
    branchName: gitBranchName ?? '',
    gitService,
    artifactsById: derivedGraph.artifacts,
    onAcceptArtifact: handleAcceptGitChange,
    onBindFile: handleBindResidueFile,
    pendingSignal: pendingGitChanges,
    onSynced: showWarning,
  });

  // UX-1.1a: opt-in auto-approval — routes through acceptProposal (locked-node
  // filtering, validation, C1 materialization all intact); import-lane
  // finalization proposals are skipped inside the hook (human review by
  // design); failures leave the proposal pending, once per session.
  useProposalAutoApprove({
    enabled: autoApproveProposals,
    branchId: branchId ?? null,
    listPending: (bid) => proposalService.listProposalsByBranch(bid, 'pending'),
    accept: (proposalId) => proposalService.acceptProposal(proposalId),
    stampAutoApproved: (proposalId) => proposalService.markAutoApproved(proposalId),
    onApplied: (proposal) => {
      showSuccess(`Auto-approved proposal (${proposal.patches.length} change${proposal.patches.length !== 1 ? 's' : ''}) — applied to the canvas`);
      void refreshGraph();
    },
    onFailed: (_proposal, message) => {
      showError(`Auto-approve failed (proposal left pending for manual review): ${message}`);
    },
  });

  const handleNodeExport = useCallback((nodeId: string) => {
    // UX-1.3: the export modal is a node's ONE export surface now (the gated
    // right-click JSON export folded into it), so the gate that guarded that
    // path applies here — the toolbar must not be an ungated side door.
    const gateCheck = gate.check('node_context_export');
    if (!gateCheck.allowed) {
      showWarning(gateCheck.rule.upgradeMessage);
      return;
    }
    const ctx = buildNodeExportContext(nodeId, derivedGraph, { includeArtifactContent: true });
    if (ctx) {
      setNodeExportContext(ctx);
    }
  }, [derivedGraph, gate, showWarning]);

  const handleExportProject = useCallback(async () => {
    const requirements = specRealtimeData.requirements;
    const sections = specRealtimeData.sections;
    const spec = specRealtimeData.specification;
    let testSuiteData: import('../utils/export-context.js').ProjectExportTestCase[] = [];

    if (requirements.length > 0) {
      try {
        const reqIds = requirements.map(r => r.id);
        const allTests = await testCaseService.getTestCasesByRequirementIds(reqIds);
        const reqMap = new Map(requirements.map(r => [r.id, r]));
        testSuiteData = allTests.map(tc => {
          const req = reqMap.get(tc.requirementId);
          return {
            testId: tc.testId,
            name: tc.name,
            testType: tc.testType,
            framework: tc.framework,
            status: tc.status,
            expectedResult: tc.expectedResult,
            requirementName: req?.name || tc.requirementId,
            requirementId: req?.requirementId || tc.requirementId,
          };
        });
      } catch {
        // proceed without test data
      }
    }

    // AA.0: constraints come from the one store; the export proceeds without
    // them only when they cannot be read. AC: below Indie they do not exist,
    // so they are not read and no file or count names them.
    const constraintsCarried = gate.can('workflow_space');
    let exportConstraints: import('../utils/export-constraints.js').ExportConstraint[] = [];
    if (projectId && constraintsCarried) {
      try {
        const { loadExportConstraints } = await import('../utils/export-constraints.js');
        exportConstraints = await loadExportConstraints(projectId);
      } catch {
        // proceed without constraints
      }
    }

    let specExport: ProjectExportSpecification | undefined;
    if (spec?.vision) {
      const sectionMap = new Map(sections.map(s => [s.id, s.name]));
      specExport = {
        vision: spec.vision,
        sections: sections.map(s => ({ name: s.name, description: s.description || undefined })),
        requirements: requirements.map(r => ({
          requirementId: r.requirementId,
          name: r.name,
          description: r.description,
          category: r.category,
          status: r.status,
          sectionName: r.sectionId ? sectionMap.get(r.sectionId) : undefined,
          acceptanceCriteria: r.acceptanceCriteria.map(ac => ({ text: ac.text, met: ac.met })),
        })),
        ...(constraintsCarried ? { constraints: exportConstraints } : {}),
        preferences: spec.preferences || {},
      };
    }

    const data = buildProjectExport(derivedGraph, projectName || 'Untitled Project', testSuiteData, specExport);
    setProjectExportData(data);
  }, [derivedGraph, projectId, projectName, specRealtimeData.requirements, specRealtimeData.sections, specRealtimeData.specification, testCaseService, gate]);

  // AA.2: after an import is accepted, ask once what the person is here to
  // do (workflows are Indie and above). The answer lives on the project so
  // the agent reads it and never asks twice.
  const [askImportIntent, setAskImportIntent] = useState(false);
  const askImportIntentOnce = useCallback(async () => {
    if (!projectId || !gate.can('workflow_space')) return;
    const { data } = await getSupabaseClient().from('projects').select('metadata').eq('id', projectId).maybeSingle();
    const answered = (data?.metadata as { importIntent?: unknown } | null)?.importIntent;
    if (!answered) setAskImportIntent(true);
  }, [projectId, gate]);

  const handleImportIntent = useCallback(async (intent: ImportIntent, name: string | null) => {
    if (!projectId) throw new Error('No project open');
    const supabase = getSupabaseClient();
    let workflowId: string | undefined;
    if (isChangeIntent(intent)) {
      const { data: last } = await supabase.from('workflows').select('sort_order')
        .eq('project_id', projectId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
      const made = await insertChange(supabase, projectId, name ?? '', intent, (((last as { sort_order?: number } | null)?.sort_order) ?? -1) + 1);
      if ('error' in made) throw new Error(made.error);
      workflowId = made.id;
    }
    // AL.21: the popup stays open on what was staged and the note that sends
    // the agent to it; nothing here starts the agent, so no toast says so.
    await patchProjectMetadata({ importIntent: { intent, ...(workflowId ? { workflowId } : {}), at: new Date().toISOString() } });
  }, [projectId, patchProjectMetadata]);

  const handleImportProposalMerge = useCallback(async (result: MergeResult, _mergedOps: PatchOperation[]) => {
    if (!branchId || !projectId || !importProposal) return;

    setImportApplying(true);
    setImportApplyingMessage('Merging patches...');
    try {
      const mergedIdSet = new Set(result.mergedPatches);
      const updatedPatches = importProposal.patches.map(pp => ({
        ...pp,
        status: mergedIdSet.has(pp.patch.metadata.id) ? 'approved' as const : pp.status === 'conflicted' ? 'conflicted' as const : 'rejected' as const,
      }));

      setImportApplyingMessage('Saving to project...');
      await proposalService.updateProposalPatches(importProposal.id, updatedPatches);

      await proposalService.acceptProposal(importProposal.id);

      setImportApplyingMessage('Refreshing canvas...');
      await refreshGraph();
      showWarning('Import applied successfully');
      void askImportIntentOnce().catch(() => {});

      setImportApplyingMessage('Syncing specifications...');
      specificationService.getSpecificationsByProject(projectId).then(async (specs) => {
        if (specs.length === 0) return;
        const spec = specs[0];
        specificationService.runOrphanMappingSync(spec.id).catch(() => {});
        try {
          const reqs = await specificationService.getRequirementsBySpecification(spec.id);
          if (reqs.length === 0) {
            // An import that carried no requirements starts architecture-first.
            // It used to also switch the spec "off" through a preference the
            // retired Spec tab read; nothing turns the specification off now.
            await specificationService.setPhaseStatus(spec.id, 'architecture_first');
            setCurrentSpecification(spec);
          }
        } catch {}
      }).catch(() => {});
    } catch (err) {
      showError('Failed to apply import: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setImportProposal(null);
      setImportApplying(false);
      setImportApplyingMessage('');
    }
  }, [branchId, projectId, importProposal, proposalService, refreshGraph, showWarning, showError, specificationService, askImportIntentOnce]);

  const handleImportProposalReject = useCallback(async (reason: string) => {
    if (!importProposal) return;
    try {
      // AE.12: the reason rides the proposal; the agent reads it as reviewNote.
      await proposalService.rejectProposal(importProposal.id, reason);
    } catch {
    }
    setImportProposal(null);
    showWarning('Import proposal rejected');
  }, [importProposal, proposalService, showWarning]);

  // R4: the commit subject. The self-push prefix is prepended SERVER-side — a
  // message without it would make NodeSpec read its own commit as out-of-band drift.
  const proposalTitle = (p: AIProposal): string => {
    const meta = p.metadata as Record<string, unknown> | undefined;
    if (typeof meta?.title === 'string' && meta.title.trim()) return meta.title.trim();
    if (typeof meta?.source === 'string' && meta.source) return `accepted ${meta.source} proposal`;
    return 'accepted architecture change';
  };

  /**
   * R4: auto-commit an accepted proposal to git.
   *
   * Three rules, all load-bearing:
   *  1. It NEVER blocks or reverses the accept — the accept is already committed
   *     to the patch ledger before this runs, and a git problem is a git problem.
   *  2. It NEVER passes confirmOverwrite. An unbaselined branch is exactly what
   *     the R2.2 overwrite guard is for, and an automatic action must not be the
   *     thing that confirms overwriting a repo this project never synced with —
   *     `shouldAutoPushOnAccept` declines that case up front.
   *  3. On failure it says so ONCE and leaves the design ahead of git, which the
   *     Repository panel derives from the data rather than from a flag we set.
   */
  const autoPushAfterAccept = useCallback(async (appliedPatchCount: number, title: string) => {
    if (!projectId || !gitBranchName) return;
    try {
      const syncState = await gitService.getBranchSyncState(projectId, gitBranchName).catch(() => null);
      const decision = shouldAutoPushOnAccept({
        hasGitIntegration,
        lastSyncedCommit: syncState?.lastSyncedCommit ?? null,
        appliedPatchCount,
      });
      if (!decision.push) {
        if (decision.reason === 'unbaselined') {
          showWarning('Change applied. It was NOT committed: this branch has never synced with the repository — commit once from the Git panel to establish a baseline.');
        }
        return;
      }
      const integration = await gitService.getIntegration(projectId);
      if (!integration) return;
      const result = await gitService.push(projectId, gitBranchName, integration.id, false, title);
      showWarning(`Change applied and committed to git (${result.commitSha.slice(0, 8)}).${pushSkipNote(result)}${pushWithheldNote(result)}`);
      refreshPendingGitCount();
    } catch (err) {
      showWarning(
        'Change applied, but committing it to git failed: ' +
        (err instanceof Error ? err.message : 'unknown error') +
        '. Your design is ahead of git — commit from the Git panel when ready.',
      );
    }
  }, [projectId, gitBranchName, hasGitIntegration, gitService, showWarning, refreshPendingGitCount]);

  const handleActiveProposalMerge = useCallback(async (result: MergeResult, _mergedOps: PatchOperation[]) => {
    if (!branchId || !projectId || !activeProposal) return;

    try {
      const mergedIdSet = new Set(result.mergedPatches);
      const updatedPatches = activeProposal.patches.map(pp => ({
        ...pp,
        status: mergedIdSet.has(pp.patch.metadata.id) ? 'approved' as const : pp.status === 'conflicted' ? 'conflicted' as const : 'rejected' as const,
      }));
      await proposalService.updateProposalPatches(activeProposal.id, updatedPatches);

      await proposalService.acceptProposal(activeProposal.id);
      await refreshGraph();

      // R4: an accepted change belongs in git. Fire-and-forget by design — the
      // accept has ALREADY succeeded and must never be undone or blocked by a
      // push problem; a failure just leaves the design "ahead of git", which the
      // Changes → Repository panel reports.
      void autoPushAfterAccept(result.mergedPatches.length, proposalTitle(activeProposal));

      specificationService.getSpecificationsByProject(projectId).then(specs => {
        if (specs.length > 0) specificationService.runOrphanMappingSync(specs[0].id).catch(() => {});
      }).catch(() => {});
    } catch (err) {
      showError('Failed to apply changes: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setActiveProposal(null);
    }
  }, [branchId, projectId, activeProposal, proposalService, refreshGraph, showError, specificationService]);

  const handleActiveProposalReject = useCallback(async (reason: string) => {
    if (!activeProposal) return;
    try {
      // AE.12: the reason rides the proposal; the agent reads it as reviewNote.
      await proposalService.rejectProposal(activeProposal.id, reason);
    } catch {}
    setActiveProposal(null);
  }, [activeProposal, proposalService]);

  const handleReviewProposal = useCallback((proposal: AIProposal) => {
    // Owner UX ruling 2026-08-12: finalized repo-import proposals review in the
    // ImportReviewPanel (side panel, summary-card, bulk apply) — never the
    // per-item dock.
    if (proposal.metadata && 'finalization' in (proposal.metadata as Record<string, unknown>)) {
      setImportProposal(proposal);
    } else {
      setActiveProposal(proposal);
    }
  }, []);

  // const deriveProjectName = useCallback((understanding: string): string => {
  //   const words = understanding.split(' ').slice(0, 5);
  //   let name = words.join(' ');

  //   name = name.replace(/[.,;:].*$/, '');

  //   name = name.split(' ').map(w =>
  //     w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  //   ).join(' ');

  //   if (!name || name.length < 3) {
  //     name = 'Generated Project';
  //   }

  //   if (name.length > 50) {
  //     name = name.substring(0, 50).trim();
  //   }

  //   return name;
  // }, []);

  const criteriaByNodeId = useMemo(() => {
    const map = new Map<string, Array<{ text: string; met?: boolean; testId?: string }>>();
    if (!specRealtimeData.requirements.length || !specMappingsData.mappingsByRequirement) return map;

    for (const req of specRealtimeData.requirements) {
      if (!req.acceptanceCriteria || req.acceptanceCriteria.length === 0) continue;
      const mappings = specMappingsData.mappingsByRequirement.get(req.id);
      if (!mappings) continue;
      for (const mapping of mappings) {
        const existing = map.get(mapping.nodeId);
        if (existing) {
          map.set(mapping.nodeId, [...existing, ...req.acceptanceCriteria]);
        } else {
          map.set(mapping.nodeId, [...req.acceptanceCriteria]);
        }
      }
    }
    return map;
  }, [specRealtimeData.requirements, specMappingsData.mappingsByRequirement]);

  const [testSummaryByNodeId, setTestSummaryByNodeId] = useState<TestSummaryByNodeId>({});

  useEffect(() => {
    if (!specRealtimeData.requirements.length || !specMappingsData.mappingsByRequirement) {
      setTestSummaryByNodeId({});
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const reqIds = specRealtimeData.requirements.map(r => r.id);
        const allTests = await testCaseService.getTestCasesByRequirementIds(reqIds);
        if (cancelled) return;

        const testsByReq = new Map<string, Array<{ status: string }>>();
        for (const tc of allTests) {
          const arr = testsByReq.get(tc.requirementId) || [];
          arr.push({ status: tc.status });
          testsByReq.set(tc.requirementId, arr);
        }

        const summaryMap: TestSummaryByNodeId = {};

        for (const req of specRealtimeData.requirements) {
          const tests = testsByReq.get(req.id);
          if (!tests || tests.length === 0) continue;

          const total = tests.length;
          const passed = tests.filter(t => t.status === 'passed').length;
          const failed = tests.filter(t => t.status === 'failed').length;
          const summary = { total, passed, failed };

          const mappings = specMappingsData.mappingsByRequirement.get(req.id);
          if (mappings) {
            for (const mapping of mappings) {
              const existing = summaryMap[mapping.nodeId];
              if (existing) {
                existing.total += total;
                existing.passed += passed;
                existing.failed += failed;
              } else {
                summaryMap[mapping.nodeId] = { ...summary };
              }
            }
          }
        }

        if (!cancelled) {
          setTestSummaryByNodeId(summaryMap);
        }
      } catch {
        if (!cancelled) setTestSummaryByNodeId({});
      }
    })();

    return () => { cancelled = true; };
  }, [specRealtimeData.requirements, specMappingsData.mappingsByRequirement, testCaseService, refreshCounter, testRefreshCounter]);

  const editorStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    backgroundColor: c.background,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    overflow: 'hidden',
  };

  const mainStyles: React.CSSProperties = {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  };

  return (
    <div style={editorStyles}>
      <TopBar
        branchName={openName || activeBranch.name}
        hasUnsavedChanges={activeBranch.patches.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={store.canUndo()}
        canRedo={store.canRedo()}
        onShowHelp={() => setShowOnboarding(true)}
        userEmail={userEmail}
        projectName={projectName || undefined}
        projectId={projectId || undefined}
        onOpenProjects={() => setShowProjectExplorer(true)}
        ensureDraftSaved={ensureDraftSaved}
        availableBranches={availableBranches}
        onGitIntegrationClosed={() => { loadBranches(); loadGitIntegration(); }}
        openGitIntegration={showGitModal}
        onGitIntegrationOpened={() => setShowGitModal(false)}
        onArchiveBranch={handleArchiveBranch}
        featureGate={gate}
        onProjectRenamed={onRenameProject}
        onAcceptGitChange={handleAcceptGitChange}
        onDeleteGitArtifact={handleDeleteGitArtifact}
        onBindResidueFile={handleBindResidueFile}
        bindTargetNodes={bindTargetNodes}
        graphArtifacts={derivedGraph.artifacts as Record<string, { path?: string; content?: string; nodeId?: string }>}
        pendingGitChanges={pendingGitChanges}
        gitDefaultBranch={gitDefaultBranch}
        pendingProposals={pendingProposalCount}
        onOpenChanges={() => openAgents()}
        onOpenConnected={() => openAgents('connected')}
        onOpenTeam={() => setTeamOpen(true)}
        teamBelowPlan={teamBelowPlan}
      />
      {teamOpen && projectId && (
        <TeamPopup projectId={projectId} projectName={projectName || undefined} onClose={() => { setTeamOpen(false); setTeamCheck((n) => n + 1); }} example={!!gate.example} viewOnly={!!gate.viewOnly?.('team_lanes')} belowPlan={teamBelowPlan} />
      )}
      <div style={mainStyles}>
        <TabbedSidebar
          graph={derivedGraph}
          onFileSelect={handleRepoFileSelect}
          selectedArtifactId={selectedArtifactId}
          projectId={projectId}
          refreshCounter={refreshCounter}
        />
        <div
          style={{
            position: 'relative',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              position: 'relative',
              // Owner bug 2026-09-01: a flex item's min-height is AUTO, so tall
              // intrinsic content (proven on the since-retired Work Board) grew
              // this wrapper past the overflow-hidden ancestor — clipped, no
              // scrollbar anywhere. min-height: 0 lets the chain bound it so
              // scrollable panes (V3: the ideation modes) actually scroll.
              // Monaco/ReactFlow never exposed this (no intrinsic height).
              minHeight: 0,
              opacity: isRefreshing ? 0.5 : 1,
              transition: 'opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)',
              filter: isRefreshing ? 'blur(2px)' : 'none',
            }}
          >
            <Canvas
              graph={derivedGraph}
              leases={leases}
              changeScope={shownScope}
              changeLine={activeChange ? (
                <ChangeScopeLine
                  changes={changeBoard.changes}
                  activeId={activeChange.id}
                  scopeOn={!!shownScope}
                  onPick={(id) => setActiveChangeId(id)}
                  onToggleScope={() => setChangeScopeOn((on) => !on)}
                />
              ) : null}
              onPatchesGenerated={handlePatchesGenerated}
              onWarning={handleWarning}
              onError={handleError}
              onNodeSelect={handleNodeSelect}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              onEdgeSelect={handleEdgeSelect}
              onBackgroundClick={handleBackgroundClick}
              actorType={actorType}
              highlightedNodeIds={highlightedNodeIds}
              projectId={projectId}
              specification={currentSpecification ?? undefined}
              onEditSpecification={handleUpdateCurrentSpecification}
              isRefreshing={isRefreshing}
              refreshCounter={refreshCounter}
              specSignal={specSignal}
              onNodeExport={handleNodeExport}
              onOpenFile={handleRepoFileSelect}
              criteriaByNodeId={criteriaByNodeId}
              testSummaryByNodeId={testSummaryByNodeId}
              onExportProject={handleExportProject}
              onOpenChanges={(focusProposalId?: string) => { setChangesFocusProposal(focusProposalId ?? null); openAgents(); }}
              branchId={branchId}
              onOpenArchitecture={(nodeId) => { handleViewModeChange('architecture'); handleNodeSelect(nodeId); }}
              workFocus={workFocus}
            />
          </div>
          {/* Owner spike 2026-09-04: the in-canvas start card and the staging
              window float over the canvas — no overlay, nothing blocked. */}
          {startCardShows({
            projectId, walkthroughOpen: showOnboarding, creatingProject: showProjectCreate, stagingSpec: showSpecStaging,
            dismissed: startDismissed, loading: specRealtimeData.loading, vision: specRealtimeData.specification?.vision,
            requirements: specRealtimeData.requirements.length, nodes: Object.keys(derivedGraph.nodes).length,
          }) && (
            <ProjectStartPopup
              projectName={projectName || ''}
              stagedSpec={stagedSpec}
              workflowOrigin={projectWorkflowOrigin}
              onStartNew={() => stampWorkflowOrigin('idea')}
              onImportSpecification={() => setShowSpecStaging(true)}
              onDismiss={() => setStartDismissed(true)}
              canImportRepository={!gate.loading && gate.can('repo_import') && !gate.viewOnly?.('repo_import')}
              connectedRepository={connectedRepo}
              onImportRepository={() => stampWorkflowOrigin('code')}
              onConnectRepository={() => setShowGitModal(true)}
            />
          )}
          {projectId && askImportIntent && !showSpecStaging && (
            <ImportIntentPopup
              projectName={projectName || ''}
              onAnswer={handleImportIntent}
              onClose={() => setAskImportIntent(false)}
            />
          )}
          {projectId && showSpecStaging && (
            <SpecImportStagingPopup
              projectName={projectName || ''}
              staged={stagedSpec}
              onStage={handleStageSpec}
              onClear={handleClearStagedSpec}
              onClose={() => setShowSpecStaging(false)}
            />
          )}
          {showProjectCreate && onCreateProject && (
            <ProjectCreatePopup
              onConfirm={({ name }: ProjectCreateResult) => {
                setShowProjectCreate(false);
                onCreateProject(name, {});
              }}
              onClose={() => setShowProjectCreate(false)}
            />
          )}
          {/* N6.2(c) rev 2: the permanent Changes home — always mounted (polls for
              the header badge), renders the docked two-tab sheet only when opened. */}
          {projectId && (
            <ChangesPanel
              isOpen={changesPanelOpen && !activeProposal && !importProposal}
              onClose={() => { setChangesPanelOpen(false); setChangesFocusProposal(null); }}
              projectId={projectId}
              branchId={branchId ?? null}
              branchName={gitBranchName ?? undefined}
              hasGitIntegration={hasGitIntegration}
              graph={derivedGraph}
              refreshCounter={refreshCounter}
              onReviewProposal={handleReviewProposal}
              onPendingCountChange={handlePendingCountChange}
              onOpenGitPanel={() => setShowGitModal(true)}
              focusProposalId={changesFocusProposal}
              onSpecDecided={() => { void refreshGraph(); }}
              onOpenArchitecture={(nodeId) => { setChangesPanelOpen(false); setChangesFocusProposal(null); handleViewModeChange('architecture'); if (nodeId) handleNodeSelect(nodeId); }}
              onOpenWork={openWork}
              openOn={agentsOpenOn}
            />
          )}
        </div>
        {projectId && (
          <NodeSidepane
            projectId={projectId}
            branchId={branchId}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            graph={derivedGraph}
            onPatchGenerated={handlePatchGenerated}
            tab={sidepaneTab}
            onTabChange={(t) => {
              setSidepaneTab(t);
              if (t === 'details') setWorkbenchInitialArtifactId(null);
            }}
            focusArtifactId={workbenchInitialArtifactId}
            onLoadFromRepo={handleLoadArtifactFromRepo}
            onOpenWork={openWork}
            onOpenChanges={() => openAgents()}
            stagedExplodes={stagedExplodes}
            onRequestExplode={handleRequestExplode}
            onWithdrawExplode={handleWithdrawExplode}
          />
        )}
      </div>
      <ToastContainer messages={messages} onDismiss={dismissToast} />
      {showOnboarding && (
        <OnboardingModal
          onClose={handleCloseOnboarding}
          firstRun={hasSeenOnboarding === false}
          featureGate={gate}
          onSurface={handleWalkthroughSurface}
          onCreateProject={onCreateProject ? handleWalkthroughCreateProject : undefined}
        />
      )}
      {/* Owner UX ruling 2026-08-12: import review is a ChangesPanel-style side
          panel — summary card + bulk apply, theme-aware, canvas stays visible. */}
      {importProposal && (
        <ImportReviewPanel
          proposal={importProposal}
          graph={storeState.derivedGraph}
          onMerge={handleImportProposalMerge}
          onReject={handleImportProposalReject}
          onClose={() => setImportProposal(null)}
        />
      )}
      {importApplying && (
        <div style={{
          position: 'fixed', inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10003,
        }}>
          <div style={{
            backgroundColor: c.surface,
            borderRadius: '16px',
            padding: '40px 48px',
            maxWidth: '420px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
          }}>
            <style>{`
              @keyframes importSpinner { to { transform: rotate(360deg); } }
              @keyframes importBarShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
            `}</style>
            <div style={{
              width: '40px', height: '40px', margin: '0 auto 20px',
              border: `3px solid ${c.border}`,
              borderTopColor: c.primary,
              borderRadius: '50%',
              animation: 'importSpinner 0.8s linear infinite',
            }} />
            <div style={{ fontSize: '16px', fontWeight: 600, color: c.text, marginBottom: '8px' }}>
              Applying Import to Canvas
            </div>
            <div style={{ fontSize: '13px', color: c.textMuted, lineHeight: 1.5, marginBottom: '20px' }}>
              This may take a moment while we update your architecture. Please don't close this window.
            </div>
            <div style={{
              height: '4px', borderRadius: '2px',
              backgroundColor: c.border, overflow: 'hidden',
              marginBottom: '12px',
            }}>
              <div style={{
                width: '40%', height: '100%', borderRadius: '2px',
                backgroundColor: c.primary,
                animation: 'importBarShimmer 1.5s ease-in-out infinite',
              }} />
            </div>
            <div style={{ fontSize: '12px', color: c.textSecondary, fontWeight: 500 }}>
              {importApplyingMessage || 'Processing...'}
            </div>
          </div>
        </div>
      )}
      {/* Owner ruling 2026-08-12: ONE review surface — the old dark-only bottom
          dock is retired; ordinary proposals use the same side panel imports do. */}
      {activeProposal && (
        <ImportReviewPanel
          variant="proposal"
          proposal={activeProposal}
          graph={storeState.derivedGraph}
          onMerge={handleActiveProposalMerge}
          onReject={handleActiveProposalReject}
          onClose={() => setActiveProposal(null)}
        />
      )}
      {showProjectExplorer && (
        <ProjectExplorer
          currentProjectId={projectId || null}
          onSelectProject={(id) => {
            setShowProjectExplorer(false);
            onSwitchProject?.(id);
          }}
          onCreateProject={() => {
            // The dialog calls this only under the plan's project cap
            // (owner 2026-09-28: free on a self-hosted build, capped on the
            // managed site's Free plan); the database refuses past it too.
            setShowProjectExplorer(false);
            if (hasSeenOnboarding === false) {
              setPendingProjectCreateAfterOnboarding(true);
              setShowOnboarding(true);
            } else {
              setShowProjectCreate(true);
            }
          }}
          onDeleteCurrentProject={onDeleteCurrentProject}
          onClose={() => setShowProjectExplorer(false)}
          featureGate={gate}
        />
      )}
      {nodeExportContext && (
        <NodeExportModal
          context={nodeExportContext}
          projectName={projectName || undefined}
          onClose={() => setNodeExportContext(null)}
          onDownloadAnchorSlice={() => { void handleExportNodeContext(nodeExportContext.node.id); }}
        />
      )}
      {projectExportData && (
        <ProjectExportModal
          data={projectExportData}
          onClose={() => setProjectExportData(null)}
          hasGitIntegration={hasGitIntegration}
          onPushToGit={() => { setProjectExportData(null); setShowGitModal(true); }}
          onPublishToMarketplace={isHostedEdition && projectId
            ? () => { setProjectExportData(null); setShowPublishModal(true); }
            : undefined}
        />
      )}
      {isHostedEdition && showPublishModal && projectId && (
        <PublishTemplateModal
          graph={derivedGraph}
          projectId={projectId}
          projectName={projectName || 'Untitled Project'}
          specification={specRealtimeData.specification}
          requirements={specRealtimeData.requirements}
          mappingsByRequirement={specMappingsData.mappingsByRequirement}
          onClose={() => setShowPublishModal(false)}
        />
      )}
    </div>
  );
}

function GraphEditorComponent(props: GraphEditorProps) {
  return (
    <ThemeProvider>
      <GraphEditorInner {...props} />
    </ThemeProvider>
  );
}

export const GraphEditor = memo(GraphEditorComponent);

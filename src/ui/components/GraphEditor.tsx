import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PatchOperation, ActorType } from '@nodespec/core/types.js';
import { createUpdateArtifactPatch, createRemoveArtifactPatch } from '@nodespec/core/patch-factory.js';
import { buildNodeAnchorSlice, serializeNodeAnchorSlice } from '@nodespec/core/anchor-slice.js';
import { computeContentHash, now as nowIso } from '@nodespec/core/utils.js';
import { GitService } from '../services/GitService.js';
import { TabbedSidebar, Canvas } from './layout/index.js';
import { TopBar, ProjectExplorer, ProjectOnboardingWizard } from './panels/index.js';
import { ChangesPanel } from './panels/ChangesPanel.js';
import { shouldAutoPushOnAccept } from './panels/repoActivity.js';
import { flagNodeEvidenceStale } from '../services/evidenceStale.js';
import type { OnboardingResult, WorkflowOrigin } from './panels/index.js';
import { NodeSidepane } from './panels/NodeSidepane.js';
import type { SidepaneTab } from './panels/NodeSidepane.js';
import { ToastContainer, useToast, OnboardingModal, NodeExportModal, ProjectExportModal } from './common/index.js';
import type { BranchStore, BranchStoreState } from '../store/branch-store.js';
import { ThemeProvider, useTheme } from '../theme/ThemeContext.js';
import { useProject, useBranch, usePatch, useSpecification, useProposal, useTestCase } from '../context/ServiceContext.js';
import type { ProjectSpecification } from '../services/SpecificationService.js';
import { useSmoothRefresh } from '../hooks/useSmoothRefresh.js';
import { useFeatureGate } from '../hooks/useFeatureGate.js';
import { useRealtimeSpecification } from '../hooks/useRealtimeSpecification.js';
import { useRealtimeMappings } from '../hooks/useRealtimeMappings.js';
import type { Feature } from '../hooks/useFeatureGate.js';
import { ImportReviewPanel } from './proposal/ImportReviewPanel.js';
import type { AIProposal, MergeResult } from '@nodespec/core/ai-proposal.js';
import { buildNodeExportContext, buildProjectExport } from '../utils/export-context.js';
import { buildGitAcceptPatch, buildResidueBindPatches } from '../utils/git-accept.js';
import { getContainerTypeById } from '@nodespec/core/container-types.js';
import type { NodeExportContext, ProjectExportData, ProjectExportSpecification } from '../utils/export-context.js';
import type { TestSummaryByNodeId } from '../adapters/graph-to-reactflow.js';
import { getSupabaseClient } from '../../persistence/supabase/client.js';
import { isHostedEdition } from '../config/edition.js';
import { PublishTemplateModal } from './templates/PublishTemplateModal.js';
import { useGitAutoSync } from '../hooks/useGitAutoSync.js';
import { useProposalAutoApprove } from '../hooks/useProposalAutoApprove.js';

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
  onSwitchBranch?: (branchName: string) => void;
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
  onSwitchBranch,
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
  const gate = useFeatureGate();

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

  useEffect(() => {
    if (!projectId) return;
    const supabase = getSupabaseClient();
    supabase
      .from('git_integrations')
      .select('id, default_branch, auto_sync')
      .eq('project_id', projectId)
      .maybeSingle()
      .then(({ data }) => {
        setHasGitIntegration(!!data);
        // Owner 2026-07-30: display-only — the header annotates main with its
        // bound git ref (e.g. main → master) when they differ.
        setGitDefaultBranch(data?.default_branch ?? null);
        // B2: pre-migration rows read undefined → the column default (on).
        setGitAutoSync(data ? { integrationId: data.id, enabled: data.auto_sync !== false } : null);
      });
  }, [projectId]);

  // Post-cutover (owner ruling 2026-08-12): no plan-gated features remain — the
  // Feature vocabulary stays for call-site clarity, but nothing paywalls. The
  // only surviving scale gate is the 3-project Community cap (projectLimitReached).
  const requireFeature = useCallback((feature: Feature): boolean => {
    return !gate.loading && gate.can(feature);
  }, [gate]);
  const [importProposal, setImportProposal] = useState<AIProposal | null>(null);
  const [importApplying, setImportApplying] = useState(false);
  const [importApplyingMessage, setImportApplyingMessage] = useState('');
  const [activeProposal, setActiveProposal] = useState<AIProposal | null>(null);
  const [currentSpecification, setCurrentSpecification] = useState<ProjectSpecification | null>(null);
  const specId = currentSpecification?.id ?? null;
  const specRealtimeData = useRealtimeSpecification(specId);
  const specMappingsData = useRealtimeMappings(specId);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showProjectExplorer, setShowProjectExplorer] = useState(false);
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const [pendingWorkflow, setPendingWorkflow] = useState<WorkflowOrigin | null>(null);
  const [showGitModal, setShowGitModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [hasGitIntegration, setHasGitIntegration] = useState(false);
  const [gitDefaultBranch, setGitDefaultBranch] = useState<string | null>(null);
  // B2: auto-sync gate — null until the integration row loads.
  const [gitAutoSync, setGitAutoSync] = useState<{ integrationId: string; enabled: boolean } | null>(null);
  // UX-1.1a: OPT-IN auto-approval of incoming proposals — project-level,
  // default OFF, stored in projects.metadata.autoApproveProposals.
  const [autoApproveProposals, setAutoApproveProposals] = useState(false);
  const autoApproveRef = useRef(false);
  autoApproveRef.current = autoApproveProposals;
  const [pendingGitChanges, setPendingGitChanges] = useState(0);
  // N6.2(c) rev 2: permanent Changes home — header badge count + arrival toast.
  const [changesPanelOpen, setChangesPanelOpen] = useState(false);
  // UX-1.1a: load the auto-approve setting with the project.
  useEffect(() => {
    if (!projectId) { setAutoApproveProposals(false); return; }
    const supabase = getSupabaseClient();
    supabase
      .from('projects')
      .select('metadata')
      .eq('id', projectId)
      .maybeSingle()
      .then(({ data }) => {
        setAutoApproveProposals((data?.metadata as Record<string, unknown> | null)?.autoApproveProposals === true);
      });
  }, [projectId]);

  const handleToggleAutoApprove = useCallback(async (enabled: boolean) => {
    if (!projectId) return;
    setAutoApproveProposals(enabled);
    try {
      const supabase = getSupabaseClient();
      // Read-modify-write so sibling metadata keys survive the toggle.
      const { data } = await supabase.from('projects').select('metadata').eq('id', projectId).maybeSingle();
      await supabase
        .from('projects')
        .update({ metadata: { ...((data?.metadata as Record<string, unknown>) ?? {}), autoApproveProposals: enabled } })
        .eq('id', projectId);
    } catch {
      setAutoApproveProposals(!enabled);
      showError('Could not save the auto-approve setting');
    }
  }, [projectId, showError]);

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
          showWarning(`New change proposal${count > 1 ? 's' : ''} — open Changes (header) to review`);
        }
      })();
    }
    prevProposalCountRef.current = count;
  }, [showWarning, branchId, proposalService]);
  const [viewMode, setViewMode] = useState<'decomposition' | 'architecture' | 'specification'>('decomposition');
  const [cachedTestSuite, setCachedTestSuite] = useState<import('../utils/export-context.js').ProjectExportTestCase[]>([]);
  const specViewDirtyRef = useRef(false);
  const handleSpecDirtyChange = useCallback((dirty: boolean) => {
    specViewDirtyRef.current = dirty;
  }, []);
  const handleViewModeChange = useCallback((mode: 'decomposition' | 'architecture' | 'specification') => {
    if (viewMode === 'specification' && mode !== 'specification' && specViewDirtyRef.current) {
      showWarning('Unsaved specification edits were discarded');
      specViewDirtyRef.current = false;
    }
    setViewMode(mode);
  }, [viewMode, showWarning]);
  const [availableBranches, setAvailableBranches] = useState<Array<{ id: string; name: string; patchCount: number; isPrimary: boolean }>>([]);
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
        const { data } = await supabase
          .from('user_settings')
          .select('has_seen_onboarding')
          .eq('user_id', userId)
          .maybeSingle();
        const remoteFlag = data?.has_seen_onboarding === true;
        // Owner bug 2026-08-14: `remoteFlag || localFlag` made the walkthrough
        // per-BROWSER — any machine that ever completed it marked every NEW
        // account as seen, and then upserted that lie into the new user's
        // user_settings. Signed-in truth is the user's own record, full stop;
        // the localStorage key remains only as the logged-out fallback below.
        if (!cancelled) setHasSeenOnboarding(remoteFlag);
      } catch {
        if (!cancelled) setHasSeenOnboarding(localFlag);
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
      const branchesWithCounts = await branchService.listBranchesWithPatchCounts(projectId);
      setAvailableBranches(branchesWithCounts.map(b => ({
        id: b.branch.id,
        name: b.branch.name,
        patchCount: b.patchCount,
        isPrimary: b.branch.isPrimary,
      })));
    } catch (error) {
      console.error('Failed to load branches:', error);
    }
  }, [projectId, branchService]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    if (!pendingWorkflow || !projectId) return;

    if (pendingWorkflow === 'code') {
      setShowGitModal(true);
    } else if (pendingWorkflow === 'import-spec') {
      setViewMode('specification');
    } else if (pendingWorkflow === 'idea') {
    }
    setPendingWorkflow(null);
  }, [pendingWorkflow, projectId]);

  const [projectWorkflowOrigin, setProjectWorkflowOrigin] = useState<WorkflowOrigin | undefined>(undefined);

  useEffect(() => {
    const loadProjectMetadata = async () => {
      if (!projectId) {
        setProjectWorkflowOrigin(undefined);
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
      } catch {
        setProjectWorkflowOrigin(undefined);
      }
    };
    loadProjectMetadata();
  }, [projectId, projectService]);

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

  const handlePatchesGeneratedInternal = useCallback(
    (patches: PatchOperation[]) => {
      const result = store.proposePatches(patches);
      if (!result.success && result.error) {
        showError(result.error);
      }
    },
    [store, showError]
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
  const handleLoadArtifactFromRepo = useCallback(async (artifactId: string): Promise<void> => {
    const artifact = storeState.derivedGraph.artifacts[artifactId];
    if (!artifact?.path || !projectId) return;
    try {
      const integration = await gitService.getIntegration(projectId);
      if (!integration) {
        showWarning('Connect a git repository first (Git panel) — this file\'s content lives in your repo.');
        return;
      }
      const path = artifact.path.startsWith('/') ? artifact.path.slice(1) : artifact.path;
      // Owner bench 2026-07-29: fetch from the ACTIVE branch's bound ref — the
      // default-branch fetch errored whenever you worked on a feature branch.
      const files = await gitService.fetchFileContent(integration.id, [path], branchName ?? undefined);
      const file = files.find(f => f.path === path) ?? files[0];
      if (!file || file.content === undefined) {
        showError(`File not found in the repo at ${path} — it may not exist on the ${branchName || integration.defaultBranch} branch's ref.`);
        return;
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
      } else if (!(artifact.contentHash && artifact.contentHash !== fetchedHash)) {
        showWarning(`Loaded ${path} from the repository`);
      }
    } catch (error) {
      showError('Failed to load from repo: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }, [storeState.derivedGraph.artifacts, projectId, branchName, gitService, store, showWarning, showError]);

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
  // branch, and every merge/switch/guard lane targets THIS name.
  const primaryBranchName = useMemo(
    () => availableBranches.find(b => b.isPrimary)?.name ?? 'main',
    [availableBranches],
  );
  const primaryBranchNameRef = useRef(primaryBranchName);
  primaryBranchNameRef.current = primaryBranchName;

  const availableBranchesFormatted = useMemo(() => {
    return availableBranches.map(branch => {
      if (branch.name === activeBranch.name) {
        return { ...branch, patchCount: activeBranch.patches.length };
      }
      return branch;
    });
  }, [availableBranches, activeBranch.name, activeBranch.patches.length]);


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
      if (!silent) showError('Branch ID is missing. Please switch to a valid branch.');
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

      if (!silent) showWarning(`Saved ${activeBranch.patches.length} changes to ${branchName}`);
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
  }, [projectId, branchId, userId, branchName, activeBranch, derivedGraph, store, showWarning, showError, loadBranches, projectService, patchService, branchService, specificationService]);

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

  const handleCreateBranch = useCallback(async () => {
    if (!projectId || !userId) {
      showWarning('Cannot create branch: missing project information');
      return;
    }

    if (activeBranch.patches.length > 0) {
      showError('Please save or discard your changes before creating a new branch');
      return;
    }

    const branchNameInput = window.prompt('Enter new branch name:');
    if (!branchNameInput || branchNameInput.trim() === '') {
      return;
    }

    const newBranchName = branchNameInput.trim();

    if (newBranchName === 'main' || newBranchName === primaryBranchName) {
      showError(`Cannot name branch "${newBranchName}" - reserved for the primary branch`);
      return;
    }

    try {
      const existing = await projectService.getBranchByName(projectId, newBranchName);
      if (existing) {
        showError(`Branch "${newBranchName}" already exists`);
        return;
      }

      await branchService.createBranch(projectId, newBranchName, userId, derivedGraph, 0);

      // R3-3a: a NodeSpec branch maps 1:1 to a git ref — when the project is
      // git-connected, creating a design branch creates the REAL git branch (from
      // the current NodeSpec branch's bound ref) and binds git_ref + baseline.
      // Best-effort: an offline provider degrades to a local-only branch, honestly.
      try {
        const { GitService } = await import('../services/GitService.js');
        const gitService = new GitService(getSupabaseClient());
        const integration = await gitService.getIntegration(projectId);
        if (integration) {
          const result = await gitService.createRemoteBranch(projectId, integration.id, newBranchName, branchName || primaryBranchName);
          showWarning(`Branch "${newBranchName}" created and bound to git ref "${result.ref}"${result.alreadyExists ? ' (ref already existed — bound to it)' : ''}`);
        } else {
          showWarning(`Branch "${newBranchName}" created (no git integration — local only)`);
        }
      } catch (gitErr) {
        showWarning(`Branch "${newBranchName}" created locally, but the git ref could not be created: ${gitErr instanceof Error ? gitErr.message : 'provider unreachable'}. Re-try by pushing from that branch.`);
      }
      await loadBranches();

      if (onSwitchBranch) {
        onSwitchBranch(newBranchName);
      }
    } catch (error) {
      showError('Failed to create branch: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }, [projectId, userId, branchId, branchName, primaryBranchName, derivedGraph, activeBranch.patches.length, onSwitchBranch, showWarning, showError, loadBranches, projectService, branchService]);

  // R3-3b: a design merge IS a git merge, and the DEFAULT vehicle is a pull request
  // (owner-directed: "merge must be safer and, just like a code workflow, a pull
  // request — or at least an option; no stray path"). The old DB snapshot-copy merge
  // (BranchService.mergeBranchToMain + store.mergeToMain) is DELETED — after R3-3a's
  // real refs it desynced git from the canvas. Flow: save → dialog (PR primary /
  // direct secondary) → push through THE normal lane → provider PR or merge →
  // convergence via the R3-1 loader / drift-card machinery. Deletes nothing.
  const [mergeDialog, setMergeDialog] = useState<null | { integrationId: string; busy: 'pr' | 'direct' | null }>(null);

  const handleRequestMerge = useCallback(async () => {
    if (!projectId || !branchId || !userId || !branchName) {
      showWarning('Cannot merge: missing branch information');
      return;
    }

    if (branchName === primaryBranchName) {
      showWarning('Already on the primary branch');
      return;
    }

    const saved = await ensureDraftSaved();
    if (!saved) {
      showError('Could not save your pending changes — resolve that before merging.');
      return;
    }

    try {
      const integration = await gitService.getIntegration(projectId);
      if (!integration) {
        showWarning('Merging a design branch requires a git connection — a design merge is a git merge (a pull request). Connect a repository via the Git button first.');
        return;
      }
      setMergeDialog({ integrationId: integration.id, busy: null });
    } catch (error) {
      showError('Failed to prepare merge: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }, [projectId, branchId, userId, branchName, primaryBranchName, ensureDraftSaved, gitService, showWarning, showError]);

  const runMerge = useCallback(async (mode: 'pr' | 'direct') => {
    if (!mergeDialog || !projectId || !branchName) return;
    const integrationId = mergeDialog.integrationId;
    setMergeDialog({ integrationId, busy: mode });
    try {
      // Pre-R3-3a branches may carry no bound git ref — bind one now through the
      // existing create-branch lane (already-exists is a bindable outcome).
      const ref = await gitService.getBranchGitRef(projectId, branchName);
      if (!ref) {
        await gitService.createRemoteBranch(projectId, integrationId, branchName, primaryBranchName);
      }

      // THE normal push lane — overwrite guard and packet freshness gate run here.
      await gitService.push(projectId, branchName, integrationId);

      if (mode === 'pr') {
        const pr = await gitService.openPullRequest(projectId, branchName, integrationId, primaryBranchName);
        window.open(pr.prUrl, '_blank', 'noopener');
        showWarning(pr.alreadyExists
          ? `Pull request already open — this push updated it: ${pr.prUrl}`
          : `Pull request opened: ${pr.prUrl}`);
        // The branch row stays — a PR can stay open for days; the branch stays switchable.
      } else {
        const res = await gitService.mergeBranchDirect(projectId, branchName, integrationId, primaryBranchName);
        if (res.alreadyMerged) {
          showWarning(`Nothing to merge — ${primaryBranchName} already contains "${branchName}".`);
        } else if (res.targetInSync) {
          // User-initiated merge + undiverged target = no question to ask: load the
          // merged model onto main through the R3-1 loader and go there.
          await gitService.restoreModel(integrationId, primaryBranchName);
          showWarning(`Merged "${branchName}" into ${primaryBranchName} and loaded the result onto its canvas.`);
          await loadBranches();
          setMergeDialog(null);
          if (onSwitchBranch) onSwitchBranch(primaryBranchName);
          return;
        } else {
          showWarning(`Merged "${branchName}" into ${primaryBranchName} in git. Its canvas has local changes — the next sync check will offer reconciliation there.`);
        }
      }
      await loadBranches();
      setMergeDialog(null);
    } catch (error) {
      setMergeDialog(null);
      showError('Merge failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }, [mergeDialog, projectId, branchName, primaryBranchName, gitService, loadBranches, onSwitchBranch, showWarning, showError]);

  // R3-3c: switching to a git-bound branch checks THAT branch's ref for freshness
  // (the R3 core loop: git is the durable model store, the canvas a working copy).
  // Best-effort and fire-and-forget — switching must never fail on provider reach.
  const checkBranchFreshness = useCallback((name: string) => {
    if (!projectId) return;
    void (async () => {
      try {
        const integration = await gitService.getIntegration(projectId);
        if (!integration) return;
        const sweep = await gitService.detectDrift(integration.id, { branchName: name, force: true });
        const status = sweep?.status as string | undefined;
        if (status === 'behind_in_sync') {
          // Working copy untouched since its baseline + the ref moved: run the R3-1
          // loader — user-initiated switch + undiverged working copy = no question
          // to ask (the same principle as merge convergence).
          await gitService.restoreModel(integration.id, name);
          await refreshGraph();
          showWarning(`"${name}" was behind its git branch — loaded the latest model from the repository.`);
        } else if (status === 'fast_forwarded' && sweep?.restoredModel === true) {
          // Owner bench 2026-07-30: the merge-arrival lane (a merged NodeSpec PR
          // coming home) restores the model SERVER-side and reports
          // fast_forwarded. Only 'behind_in_sync' was handled here, so the DB
          // moved while the canvas kept rendering the old model — the R3-3c
          // auto-load step looked broken. The plain bookkeeping fast-forward
          // (self-push-only ranges) carries no flag and still stays silent.
          await refreshGraph();
          showWarning(`"${name}" picked up the merged pull request — loaded the latest model from the repository.`);
        } else if (status === 'ref_deleted') {
          showWarning(`The git branch for "${name}" no longer exists (likely merged and deleted). Open the Git panel to archive or keep this design branch.`);
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
    checkBranchFreshness(branchName || primaryBranchNameRef.current);
    // count refresh rides the sweep result landing in the DB
    setTimeout(() => refreshPendingGitCount(), 4000);
  }, [projectId, hasGitIntegration, branchName, checkBranchFreshness, refreshPendingGitCount]);

  // …and while the tab is VISIBLE, a non-forced sweep runs each minute. The
  // server's 60s claim throttle dedupes concurrent tabs/pollers, so this costs
  // at most one provider round per window — cards appear within ~a minute of an
  // out-of-band commit without opening the Git panel or switching branches.
  // Deliberately non-forced and no auto-restore here: background polling only
  // ever RAISES cards; loading a model stays a user-initiated act.
  const branchNameRef = useRef(branchName);
  branchNameRef.current = branchName;
  useEffect(() => {
    if (!projectId || !hasGitIntegration) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        try {
          const integration = await gitService.getIntegration(projectId);
          if (!integration) return;
          await gitService.detectDrift(integration.id, { branchName: branchNameRef.current || primaryBranchNameRef.current });
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
    const entry = availableBranchesFormatted.find(b => b.name === name);
    if (!entry) throw new Error(`Design branch "${name}" not found`);
    await branchService.deleteBranch(entry.id);
    await loadBranches();
    if (branchName === name && onSwitchBranch) onSwitchBranch(primaryBranchName);
  }, [availableBranchesFormatted, branchService, loadBranches, branchName, primaryBranchName, onSwitchBranch]);

  const handleDeleteBranch = useCallback(async (deleteBranchId: string, deleteBranchName: string) => {
    if (!projectId) {
      showWarning('Cannot delete branch: missing project information');
      return;
    }

    if (deleteBranchName === primaryBranchName) {
      showWarning('Cannot delete the primary branch');
      return;
    }

    try {
      await branchService.deleteBranch(deleteBranchId);

      showWarning(`Successfully deleted branch "${deleteBranchName}"`);
      await loadBranches();

      if (deleteBranchId === branchId) {
        if (onSwitchBranch) {
          onSwitchBranch(primaryBranchName);
        }
      }
    } catch (error) {
      showError('Failed to delete branch: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }, [projectId, branchId, primaryBranchName, showWarning, showError, loadBranches, onSwitchBranch, branchService]);

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
    enabled: gitAutoSync?.enabled === true && hasGitIntegration,
    projectId: projectId ?? null,
    integrationId: gitAutoSync?.integrationId ?? null,
    branchName: branchName || 'main',
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
        constraints: spec.constraints || [],
        preferences: spec.preferences || {},
      };
    }

    const data = buildProjectExport(derivedGraph, projectName || 'Untitled Project', testSuiteData, specExport);
    setProjectExportData(data);
  }, [derivedGraph, projectName, specRealtimeData.requirements, specRealtimeData.sections, specRealtimeData.specification, testCaseService]);

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

      setImportApplyingMessage('Syncing specifications...');
      specificationService.getSpecificationsByProject(projectId).then(async (specs) => {
        if (specs.length === 0) return;
        const spec = specs[0];
        specificationService.runOrphanMappingSync(spec.id).catch(() => {});
        try {
          const reqs = await specificationService.getRequirementsBySpecification(spec.id);
          if (reqs.length === 0) {
            const currentPrefs = spec.preferences || {};
            await specificationService.updateSpecification(spec.id, {
              preferences: { ...currentPrefs, specEnabled: false },
            });
            await specificationService.setPhaseStatus(spec.id, 'architecture_first');
            setCurrentSpecification({ ...spec, preferences: { ...currentPrefs, specEnabled: false } });
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
  }, [branchId, projectId, importProposal, proposalService, refreshGraph, showWarning, showError, specificationService]);

  const handleImportProposalReject = useCallback(async () => {
    if (!importProposal) return;
    try {
      await proposalService.updateProposalStatus(importProposal.id, 'rejected');
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
    if (!projectId) return;
    try {
      const syncState = await gitService.getBranchSyncState(projectId, branchName || 'main').catch(() => null);
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
      const result = await gitService.push(projectId, branchName || 'main', integration.id, false, title);
      showWarning(`Change applied and committed to git (${result.commitSha.slice(0, 8)}).`);
      refreshPendingGitCount();
    } catch (err) {
      showWarning(
        'Change applied, but committing it to git failed: ' +
        (err instanceof Error ? err.message : 'unknown error') +
        '. Your design is ahead of git — commit from the Git panel when ready.',
      );
    }
  }, [projectId, branchName, hasGitIntegration, gitService, showWarning, refreshPendingGitCount]);

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

  const handleActiveProposalReject = useCallback(async () => {
    if (!activeProposal) return;
    try {
      await proposalService.updateProposalStatus(activeProposal.id, 'rejected');
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

  useEffect(() => {
    if (viewMode !== 'specification') return;
    if (!specRealtimeData.requirements.length) {
      setCachedTestSuite([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const reqIds = specRealtimeData.requirements.map(r => r.id);
        const allTests = await testCaseService.getTestCasesByRequirementIds(reqIds);
        if (cancelled) return;
        const reqMap = new Map(specRealtimeData.requirements.map(r => [r.id, r]));
        setCachedTestSuite(allTests.map(tc => {
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
        }));
      } catch {
        if (!cancelled) setCachedTestSuite([]);
      }
    })();
    return () => { cancelled = true; };
  }, [viewMode, specRealtimeData.requirements, testCaseService]);

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
        branchName={branchName || activeBranch.name}
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
        onSwitchBranch={async (branchId, branchName) => {
          try {
            const persistedPatches = await patchService.loadPatches(branchId);
            const patches = persistedPatches.map(p => p.payload);

            store.switchToBranch(branchId, branchName, patches);
            if (onSwitchBranch) {
              onSwitchBranch(branchName);
            }
            // R3-3c: is this branch's working copy fresh against its git ref?
            checkBranchFreshness(branchName);
          } catch (error) {
            showError('Failed to switch branch: ' + (error instanceof Error ? error.message : 'Unknown error'));
          }
        }}
        onCreateBranch={handleCreateBranch}
        onMergeBranch={handleRequestMerge}
        onDeleteBranch={handleDeleteBranch}
        availableBranches={availableBranchesFormatted}
        primaryBranchName={primaryBranchName}
        onGitIntegrationClosed={loadBranches}
        openGitIntegration={showGitModal}
        onGitIntegrationOpened={() => setShowGitModal(false)}
        onModelRestored={refreshGraph}
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
        onOpenChanges={() => setChangesPanelOpen(true)}
      />
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
              // intrinsic content (the Work Board with long requirements) grew
              // this wrapper past the overflow-hidden ancestor — clipped, no
              // scrollbar anywhere. min-height: 0 lets the chain bound it so
              // the board's own overflowY: auto region actually scrolls.
              // Monaco/ReactFlow never exposed this (no intrinsic height).
              minHeight: 0,
              opacity: isRefreshing ? 0.5 : 1,
              transition: 'opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)',
              filter: isRefreshing ? 'blur(2px)' : 'none',
            }}
          >
            <Canvas
              graph={derivedGraph}
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
              onNodeExport={handleNodeExport}
              workflowOrigin={projectWorkflowOrigin}
              criteriaByNodeId={criteriaByNodeId}
              testSummaryByNodeId={testSummaryByNodeId}
              testRefreshCounter={testRefreshCounter}
              onExportProject={handleExportProject}
              specRealtimeData={specRealtimeData}
              projectName={projectName || undefined}
              testSuiteData={cachedTestSuite}
              onSpecDirtyChange={handleSpecDirtyChange}
              branchId={branchId}
              onSpecImportComplete={() => {
                setViewMode('decomposition');
                refreshGraph();
              }}
            />
          </div>
          {/* N6.2(c) rev 2: the permanent Changes home — always mounted (polls for
              the header badge), renders the docked two-tab sheet only when opened. */}
          {projectId && (
            <ChangesPanel
              isOpen={changesPanelOpen && !activeProposal && !importProposal}
              onClose={() => setChangesPanelOpen(false)}
              projectId={projectId}
              branchId={branchId ?? null}
              branchName={branchName || 'main'}
              hasGitIntegration={hasGitIntegration}
              graph={derivedGraph}
              refreshCounter={refreshCounter}
              autoApprove={{ enabled: autoApproveProposals, onToggle: handleToggleAutoApprove }}
              onReviewProposal={handleReviewProposal}
              onPendingCountChange={handlePendingCountChange}
              onOpenGitPanel={() => setShowGitModal(true)}
              onModelRestored={refreshGraph}
            />
          )}
        </div>
        {projectId && (
          <NodeSidepane
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            graph={derivedGraph}
            onPatchGenerated={handlePatchGenerated}
            onPatchesGenerated={handlePatchesGenerated}
            tab={sidepaneTab}
            onTabChange={(t) => {
              setSidepaneTab(t);
              if (t === 'details') setWorkbenchInitialArtifactId(null);
            }}
            focusArtifactId={workbenchInitialArtifactId}
            onLoadFromRepo={handleLoadArtifactFromRepo}
          />
        )}
      </div>
      <ToastContainer messages={messages} onDismiss={dismissToast} />
      {/* R3-3b merge dialog: PR is the default vehicle; direct merge is the explicit
          secondary. Modal is right here — it is a blocking decision, not a review. */}
      {mergeDialog && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10005,
        }}>
          <div style={{
            width: 'min(440px, 92vw)', backgroundColor: '#ffffff', borderRadius: '12px',
            boxShadow: '0 16px 48px rgba(0,0,0,0.3)', padding: '20px', color: '#111827',
          }}>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>
              Merge "{branchName}" into main
            </div>
            <div style={{ fontSize: '12.5px', color: '#4b5563', lineHeight: 1.55, marginBottom: '16px' }}>
              A design merge is a git merge. Your branch's latest state will be committed to its
              git ref first, then:
            </div>
            <button
              disabled={mergeDialog.busy !== null}
              onClick={() => runMerge('pr')}
              style={{
                width: '100%', padding: '10px 14px', marginBottom: '8px', textAlign: 'left',
                backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px',
                cursor: mergeDialog.busy ? 'wait' : 'pointer', opacity: mergeDialog.busy && mergeDialog.busy !== 'pr' ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 600 }}>
                {mergeDialog.busy === 'pr' ? 'Opening pull request…' : 'Open Pull Request (recommended)'}
              </div>
              <div style={{ fontSize: '11.5px', opacity: 0.85, marginTop: '2px' }}>
                Review the design change where code review happens — main updates when the PR merges.
              </div>
            </button>
            <button
              disabled={mergeDialog.busy !== null}
              onClick={() => runMerge('direct')}
              style={{
                width: '100%', padding: '10px 14px', marginBottom: '12px', textAlign: 'left',
                backgroundColor: '#ffffff', color: '#111827', border: '1px solid #d1d5db', borderRadius: '8px',
                cursor: mergeDialog.busy ? 'wait' : 'pointer', opacity: mergeDialog.busy && mergeDialog.busy !== 'direct' ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 600 }}>
                {mergeDialog.busy === 'direct' ? 'Merging…' : 'Merge directly (no PR)'}
              </div>
              <div style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '2px' }}>
                Creates a real merge commit in git immediately. A conflict is resolved in git, never here.
              </div>
            </button>
            <button
              disabled={mergeDialog.busy !== null}
              onClick={() => setMergeDialog(null)}
              style={{
                width: '100%', padding: '8px', backgroundColor: 'transparent', color: '#6b7280',
                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12.5px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {showOnboarding && <OnboardingModal onClose={handleCloseOnboarding} gateOnMcp={hasSeenOnboarding === false} />}
      {/* Owner UX ruling 2026-08-12: import review is a ChangesPanel-style side
          panel — summary card + bulk apply, theme-aware, canvas stays visible. */}
      {importProposal && (
        <ImportReviewPanel
          proposal={importProposal}
          graph={storeState.derivedGraph}
          targetBranch={{ id: branchId || '', name: branchName || 'main', baseSnapshotId: '', patches: [], createdAt: '' }}
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
            if (requireFeature('unlimited_projects')) {
              setShowProjectExplorer(false);
              if (hasSeenOnboarding === false) {
                setPendingProjectCreateAfterOnboarding(true);
                setShowOnboarding(true);
              } else {
                setShowProjectCreate(true);
              }
            }
          }}
          onDeleteCurrentProject={onDeleteCurrentProject}
          onClose={() => setShowProjectExplorer(false)}
          featureGate={gate}
        />
      )}
      {showProjectCreate && onCreateProject && (
        <ProjectOnboardingWizard
          onConfirm={({ name, workflowOrigin }: OnboardingResult) => {
            setShowProjectCreate(false);
            const metadata = { workflowOrigin };
            onCreateProject(name, metadata);
            setPendingWorkflow(workflowOrigin);
          }}
          onClose={() => setShowProjectCreate(false)}
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
          featureGate={gate}
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

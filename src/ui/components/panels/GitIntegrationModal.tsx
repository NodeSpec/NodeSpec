import { useState, useEffect, useCallback } from 'react';
import { usePersistence } from '../../context/ServiceContext.js';
import { GitService, PushOverwriteBlockedError } from '../../services/GitService.js';
import type { GitIntegration, AnchorAdoptResult } from '../../services/GitService.js';
import { GitBranch, Upload, Download, Settings, X, Check, CircleAlert as AlertCircle, Loader as Loader2, ChevronRight, ChevronDown, ArrowLeft, Bell, Circle as XCircle, TriangleAlert as AlertTriangle } from 'lucide-react';
import type { GitChangeEvent } from '../../services/GitService.js';
import type { FeatureGate } from '../../hooks/useFeatureGate.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { ImportJobService } from '../../services/ImportJobService.js';
import { useProposal } from '../../context/ServiceContext.js';
import type { ImportJobView } from '../../services/ImportJobService.js';

interface GitIntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  currentBranch: string;
  featureGate?: FeatureGate;
  /** Owner 2026-07-30: returns null on success, or a user-visible error that KEEPS
   *  the card row (a locked file used to fail silently while the row vanished). */
  onAcceptChange?: (artifactId: string, newContent: string, path: string, sourceCommit?: string) => string | null;
  onDeleteArtifact?: (artifactId: string, path: string) => string | null;
  graphArtifacts?: Record<string, { path?: string; content?: string; nodeId?: string }>;
  /** P1-7 C1.2: pre-push guard — persists unsaved canvas patches so the push snapshot is current. */
  ensureDraftSaved?: () => Promise<boolean>;
  /** R3-1: called after a successful restore-from-anchor so the canvas reloads the new snapshot. */
  onModelRestored?: () => void | Promise<void>;
  /** R3-3c: the ref-deleted lifecycle card's Archive action — deletes the NodeSpec design branch. */
  onArchiveBranch?: (branchName: string) => Promise<void>;
  /** R3-4c: bind an unattributed repo file (residue) to a node. */
  onBindResidueFile?: (path: string, nodeId: string, content: string, sourceCommit?: string) => string | null;
  /** R3-4c: bindable (non-container) nodes for the residue picker. */
  bindTargetNodes?: Array<{ id: string; label: string }>;
}

type View = 'overview' | 'setup' | 'pushing' | 'reconciliation';
type Provider = 'github' | 'gitlab';

export function GitIntegrationModal({
  isOpen,
  onClose,
  projectId,
  currentBranch,
  onAcceptChange,
  onDeleteArtifact,
  graphArtifacts,
  ensureDraftSaved,
  onModelRestored,
  onArchiveBranch,
  onBindResidueFile,
  bindTargetNodes,
}: GitIntegrationModalProps) {
  const persistence = usePersistence();
  const [gitService] = useState(() => new GitService(persistence.getSupabaseClient()));
  const [view, setView] = useState<View>('overview');
  const [integration, setIntegration] = useState<GitIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [provider, setProvider] = useState<Provider>('github');
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  // R3-3d: still seeded 'main' (the overwhelmingly common case, and an empty field
  // is worse UX), but this is no longer the last word: the server now REFUSES to
  // bind a ref that does not exist and names the repository's real default in the
  // error. A master-default repo therefore fails loudly at Save instead of binding
  // main's git_ref to a branch that isn't there and failing silently forever after.
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [accessToken, setAccessToken] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const [pushProgress, setPushProgress] = useState('');
  // R2.2: the push overwrite guard's 409 payload — non-null renders the explicit
  // confirmation panel instead of a generic error.
  const [overwritePrompt, setOverwritePrompt] = useState<{ reason?: string; repoAnchor?: AnchorAdoptResult['repoAnchor'] } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<GitChangeEvent[]>([]);
  const [resolvedChanges, setResolvedChanges] = useState<GitChangeEvent[]>([]);

  // Import status surface (owner UX ruling 2026-08-12): the app never drives
  // the pipeline anymore — the user's AI does, over MCP (run_repo_import).
  // This modal only WATCHES the latest job (realtime + poll floor) and the
  // proposal it stages, so the section below can show live state.
  const [importJobService] = useState(() => new ImportJobService(persistence.getSupabaseClient()));
  const [importJob, setImportJob] = useState<ImportJobView | null>(null);
  const [importProposalStatus, setImportProposalStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!integration) { setImportJob(null); return; }
    let cancelled = false;
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const job = await importJobService.getLatestJobForProject(projectId);
        if (cancelled) return;
        setImportJob(job);
        if (job && !['completed', 'cancelled', 'failed'].includes(job.status)) {
          unsub = importJobService.subscribe(job.id, (j) => setImportJob(j));
        }
      } catch { /* best-effort status surface */ }
    })();
    return () => { cancelled = true; if (unsub) unsub(); };
  }, [integration, projectId, importJobService]);

  useEffect(() => {
    const proposalId = importJob?.proposal_id;
    if (!proposalId) { setImportProposalStatus(null); return; }
    const supabase = getSupabaseClient();
    let stop = false;
    const read = async () => {
      const { data } = await supabase
        .from('ai_proposals').select('status').eq('id', proposalId).maybeSingle();
      if (!stop) setImportProposalStatus((data as { status: string } | null)?.status ?? null);
    };
    void read();
    const timer = setInterval(read, 5000);
    return () => { stop = true; clearInterval(timer); };
  }, [importJob?.proposal_id]);

  const loadIntegration = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await gitService.getIntegration(projectId);
      setIntegration(result);
      if (result) {
        // P1-7 R2: sweep remote HEAD vs baseline BEFORE reading pending changes, so drift
        // detected right now appears on open. Non-fatal (throttled/offline just reads existing) —
        // but a sweep-side ERROR is surfaced instead of silently showing "no changes".
        const sweep = await gitService.detectDrift(result.id);
        if (sweep && sweep.status === 'error') {
          setError(`Change detection could not run: ${String(sweep.detail ?? 'unknown error')}. Existing pending changes are still shown.`);
        }
      }
      const changes = await gitService.getPendingChanges(projectId).catch(() => [] as GitChangeEvent[]);
      setPendingChanges(changes);
      // Owner 2026-07-30 (recovery lane): resolved cards stay reachable.
      const resolved = await gitService.getResolvedChanges(projectId).catch(() => [] as GitChangeEvent[]);
      setResolvedChanges(resolved);
      if (result) {
        setProvider(result.provider);
        setRepoOwner(result.repoOwner);
        setRepoName(result.repoName);
        setDefaultBranch(result.defaultBranch);
        setBaseUrl(result.baseUrl ?? '');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, gitService]);

  useEffect(() => {
    if (isOpen) {
      loadIntegration();
      setView('overview');
      setError(null);
      setSuccessMsg(null);
      setAccessToken('');
    }
  }, [isOpen, loadIntegration]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const anchorAdopt = await gitService.saveIntegration(projectId, {
        provider, repoOwner, repoName, defaultBranch, accessToken,
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      });
      setAccessToken('');
      await loadIntegration();
      setView('overview');
      // R2.2: connecting to a repo that carries a NodeSpec model is NEVER silent —
      // the owner's disaster-recovery test connected to the last surviving copy of
      // a graph and heard nothing.
      // R7b (owner 2026-07-31: "requirements/acceptance criteria and spec are not
      // imported at all"): the spec plane travels in its OWN anchor and reports
      // separately, so "nodes came in but requirements did not" is visible rather
      // than something the user has to notice by its absence.
      // R3-6: name the design branches this connect materialized from the repo.
      const bd = anchorAdopt.branchDetect;
      const branchNote = bd && bd.created.length > 0
        ? ` Detected ${bd.created.length} design branch(es) from the repository: ${bd.created.map(b => b.name).join(', ')} — they are in the Branches menu with their models loaded.`
        : '';

      const spec = anchorAdopt.spec;
      const specNote = spec?.counts
        ? ` Requirements imported: ${spec.counts.requirements} requirement(s), ${spec.counts.criteria} acceptance criteria, ${spec.counts.mappings} node mapping(s).`
        : spec?.detected && spec.skipped
          ? ` Requirements NOT imported: ${spec.skipped}.`
          : spec?.detected === false
            ? ' This repo carries no requirements file — the Spec view stays empty until you push one from here.'
            : '';

      if (anchorAdopt.importJob) {
        // C3: brownfield entry — no anchor, empty graph. Drive the server-side
        // pipeline; the result lands as ONE reviewable proposal.
        setSuccessMsg(`Integration saved. ${anchorAdopt.importJob.resumed ? 'An import is already in progress' : 'No NodeSpec model found'}. Next: tell your AI to call run_repo_import (details below).${specNote}${branchNote}`);
      } else if (anchorAdopt.proposalId) {
        const c = anchorAdopt.counts;
        setSuccessMsg(`Integration saved. This repo carries a NodeSpec model (${c?.nodes ?? '?'} nodes, ${c?.edges ?? '?'} edges) — a RESTORE proposal was created; review and accept it in AI Proposals to load the design onto the canvas.${specNote}${branchNote}`);
      } else if (anchorAdopt.mismatchCardId) {
        setSuccessMsg(`Integration saved. This repo carries a NodeSpec model that differs from this project — see the pending change card below before pushing.${specNote}${branchNote}`);
      } else if (anchorAdopt.detected && anchorAdopt.skipped) {
        // R2.2 observability (owner bench): "no card" must be distinguishable from
        // "didn't check" — surface the server's exact outcome (e.g. "repo anchor
        // matches this project's model — baseline re-established").
        setSuccessMsg(`Integration saved. ${anchorAdopt.skipped}${specNote}${branchNote}`);
      } else if (specNote) {
        setSuccessMsg(`Integration saved.${specNote}${branchNote}`);
      } else {
        setSuccessMsg('Integration saved successfully');
        setTimeout(() => setSuccessMsg(null), 3000);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // R3-1 THE LOADER: git wins — replace the canvas graph with the repo's model
  // anchor. Explicit invocation only (card button / blocked-push panel). The server
  // resolves pending model cards and re-baselines; we reload both the card list and
  // the canvas.
  const handleRestoreModel = async () => {
    if (!integration) return;
    setError(null);
    setOverwritePrompt(null);
    try {
      const result = await gitService.restoreModel(integration.id);
      setSuccessMsg(`Loaded the repo model onto the canvas: ${result.counts.nodes} node(s), ${result.counts.edges} edge(s), ${result.counts.contracts} contract(s). ${result.note ?? ''}`);
      await onModelRestored?.();
      await loadIntegration();
      setView('overview');
    } catch (err: any) {
      setError(`Restore failed: ${err.message}`);
    }
  };

  // R7c: the spec plane's twin. Reports what it did in the terms that matter —
  // how many requirements arrived or changed, how much EVIDENCE survived, and
  // which of your requirements the repo does not mention (kept, never deleted).
  const handleRestoreSpec = async () => {
    if (!integration) return;
    setError(null);
    try {
      const result = await gitService.restoreSpec(integration.id, currentBranch);
      const c = result.counts ?? {};
      const parts: string[] = [];
      if (result.mode === 'adopted') {
        parts.push(`${c.requirements ?? 0} requirement(s), ${c.criteria ?? 0} acceptance criteria`);
      } else {
        if (c.added) parts.push(`${c.added} added`);
        if (c.updated) parts.push(`${c.updated} updated`);
        parts.push(`${c.criteriaPreserved ?? 0} met criterion(s) kept their evidence`);
      }
      const kept = result.keptLocal?.length
        ? ` Your ${result.keptLocal.length} requirement(s) the repo does not mention were KEPT, not deleted: ${result.keptLocal.join(', ')}.`
        : '';
      setSuccessMsg(`Loaded requirements from the repository — ${parts.join(', ')}.${kept}`);
      await loadIntegration();
      setView('overview');
    } catch (err: any) {
      setError(`Requirements load failed: ${err.message}`);
    }
  };

  // R5c: apply a card's ticked acceptance criteria. Owner rule (2026-07-21): git
  // ticks flow VIA THE CARD — one approval, never silent. A repository file must
  // not be able to mutate the spec plane on its own.
  const handleApplyCriteria = async (changeEventId: string) => {
    if (!integration) return;
    setError(null);
    try {
      const result = await gitService.applyCriterionDeltas(integration.id, changeEventId);
      setSuccessMsg(
        result.applied > 0
          ? `Marked ${result.applied} acceptance criterion(s) met from this commit (${result.requirements.join(', ')}). The Spec view now shows the evidence.`
          : 'No criteria were newly met by this commit.',
      );
      await loadIntegration();
    } catch (err: any) {
      setError(`Applying acceptance criteria failed: ${err.message}`);
    }
  };

  const handlePush = async (confirmOverwrite?: boolean) => {
    if (!integration) return;
    // Strict === true: this is also used as onClick={handlePush}, where React passes
    // a MouseEvent — a truthy event object must NEVER read as overwrite consent.
    const confirmed = confirmOverwrite === true;
    setView('pushing');
    setError(null);
    setOverwritePrompt(null);
    // P1-7 C1.2: git-push reads the persisted snapshot, so unsaved canvas patches would
    // silently miss the commit. Save them first; if that fails, don't push a stale graph.
    if (ensureDraftSaved) {
      setPushProgress('Saving draft...');
      const saved = await ensureDraftSaved();
      if (!saved) {
        setPushProgress('');
        setError('Could not save your unsaved canvas changes — push cancelled so it would not ship a stale design.');
        setView('overview');
        return;
      }
    }
    setPushProgress('Committing artifact files to the repository...');
    try {
      const result = await gitService.push(projectId, currentBranch, integration.id, confirmed);
      setPushProgress('');
      // Owner 2026-07-30: say what the cleanup lane did — a deletion that
      // silently didn't happen (unreadable repo anchor) was indistinguishable
      // from one that did.
      const deleted = result.deletedPaths?.length
        ? ` Removed ${result.deletedPaths.length} stale file${result.deletedPaths.length !== 1 ? 's' : ''} (renamed/deleted in the model).`
        : '';
      // R7a: the spec plane now travels too — say whether it did, so a project
      // that simply has no requirements yet is distinguishable from a failure.
      const specNote = result.specAnchored ? ' Requirements and acceptance criteria included.' : '';
      // UX-1.1b: in PR mode the target branch has not moved — say where the
      // commit actually went and link the review.
      if (result.commitMode === 'pull-request' && result.prUrl) {
        setSuccessMsg(`Committed ${result.fileCount} files (${result.commitSha.slice(0, 8)}) and opened a pull request${result.prNumber ? ` #${result.prNumber}` : ''}: ${result.prUrl} — the design lands on ${integration.defaultBranch} when it merges.${deleted}${specNote}`);
      } else {
        setSuccessMsg(`Committed ${result.fileCount} files (${result.commitSha.slice(0, 8)}).${deleted}${specNote}`);
      }
      if (result.cleanupSkipped) {
        setError(`Commit succeeded, but rename/delete cleanup could not run: ${result.cleanupSkipped}. Files removed from the model in THIS commit stay in the repo — delete them in git manually. This commit rewrote a valid model anchor, so future commits clean up normally.`);
      }
      setView('overview');
      await loadIntegration();
    } catch (err: any) {
      setPushProgress('');
      if (err instanceof PushOverwriteBlockedError) {
        // R2.2: the guard fired — render the explicit choice, not an error toast.
        setOverwritePrompt({ reason: err.reason, repoAnchor: err.repoAnchor });
        setView('overview');
        return;
      }
      setError(err.message);
      setView('overview');
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#ffffff', borderRadius: '12px',
          maxWidth: '640px',
          width: '92%', maxHeight: '88vh', overflow: 'hidden',
          transition: 'max-width 0.2s ease',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.35)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <ModalHeader
          title={
            view === 'setup' ? 'Configure Repository'
              : view === 'reconciliation' ? 'Reconcile Changes'
              : 'Git Integration'
          }
          onClose={onClose}
          onBack={
            view === 'setup' || view === 'reconciliation' ? () => setView('overview')
              : undefined
          }
        />

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {error && <StatusBanner type="error" message={error} onDismiss={() => setError(null)} />}
          {successMsg && <StatusBanner type="success" message={successMsg} />}

          {/* R2.2: unbaselined-push overwrite guard — the repo already carries a
              NodeSpec model this project never synced with. Explicit choice, never
              a silent overwrite (the repo copy may be the last surviving one). */}
          {overwritePrompt && (
            <div style={{
              padding: '14px 16px', marginBottom: '16px', borderRadius: '8px', fontSize: '13px',
              border: '1px solid #d97706', backgroundColor: 'rgba(217, 119, 6, 0.08)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, marginBottom: '6px' }}>
                <AlertTriangle size={16} color="#d97706" />
                Commit blocked: this repository already carries a NodeSpec model
              </div>
              <div style={{ marginBottom: '10px', lineHeight: 1.5 }}>
                {overwritePrompt.repoAnchor
                  ? `The repo's .nodespec/model.json describes ${overwritePrompt.repoAnchor.nodes} node(s), ${overwritePrompt.repoAnchor.edges} edge(s) (hash ${overwritePrompt.repoAnchor.modelHash.slice(0, 12)}…). `
                  : 'The repo has a .nodespec/model.json this project has never synced with. '}
                Committing will REPLACE it with this project's model — if that file is the only surviving
                copy of a design (e.g. after a database reset), overwriting destroys it. To restore it
                instead, connect this repo to a fresh empty project.
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => handlePush(true)}
                  style={{
                    padding: '6px 14px', borderRadius: '6px', border: '1px solid #d97706',
                    backgroundColor: '#d97706', color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Overwrite the repo model
                </button>
                {/* R3-1: the alternative the panel used to only describe — now a button. */}
                <button
                  onClick={handleRestoreModel}
                  style={{
                    padding: '6px 14px', borderRadius: '6px', border: '1px solid #2563eb',
                    backgroundColor: '#2563eb', color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Restore repo model instead
                </button>
                <button
                  onClick={() => setOverwritePrompt(null)}
                  style={{
                    padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.4)',
                    backgroundColor: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  Cancel push
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <LoadingState />
          ) : view === 'overview' ? (
            <OverviewView
              integration={integration}
              onSetup={() => setView('setup')}
              onPush={handlePush}
              pendingChangesCount={pendingChanges.length}
              onViewChanges={() => setView('reconciliation')}
              importJob={importJob}
              importProposalStatus={importProposalStatus}
              onToggleAutoSync={async (enabled) => {
                if (!integration) return;
                // Optimistic; a failed write reverts on the next integration load.
                setIntegration({ ...integration, autoSync: enabled });
                try { await gitService.setAutoSync(integration.id, enabled); }
                catch { setIntegration({ ...integration }); }
              }}
              onSetCommitMode={async (mode) => {
                if (!integration) return;
                setIntegration({ ...integration, commitMode: mode });
                try { await gitService.setCommitMode(integration.id, mode); }
                catch { setIntegration({ ...integration }); }
              }}
            />
          ) : view === 'setup' ? (
            <SetupView
              provider={provider} onProviderChange={setProvider}
              repoOwner={repoOwner} onRepoOwnerChange={setRepoOwner}
              repoName={repoName} onRepoNameChange={setRepoName}
              defaultBranch={defaultBranch} onDefaultBranchChange={setDefaultBranch}
              gitService={gitService}
              accessToken={accessToken} onAccessTokenChange={setAccessToken}
              baseUrl={baseUrl} onBaseUrlChange={setBaseUrl}
              saving={saving}
              hasExisting={!!integration}
              onSave={handleSave}
            />
          ) : view === 'pushing' ? (
            <ProgressState message={pushProgress} />
          ) : view === 'reconciliation' ? (
            <ReconciliationView
              changes={pendingChanges}
              integration={integration}
              gitService={gitService}
              graphArtifacts={graphArtifacts || {}}
              onResolve={async (changeId, resolution) => {
                try {
                  const resolved = pendingChanges.find(c => c.id === changeId);
                  await gitService.resolveChangeEvent(changeId, resolution);
                  setPendingChanges(prev => prev.filter(c => c.id !== changeId));
                  // R2.2: the mismatch card's effect is invisible bookkeeping (baseline) —
                  // say what actually happened instead of a bare "accepted".
                  if (resolved?.source === 'connect-anchor-mismatch') {
                    setSuccessMsg(resolution === 'accepted'
                      ? 'Repo model acknowledged — sync baseline established. Your project\'s model will replace the repo copy on the next push (no prompt).'
                      : 'Kept the repo model protected — pushes from this project will ask for explicit confirmation before overwriting it.');
                  } else if (resolved?.source === 'ref-deleted') {
                    setSuccessMsg(resolution === 'accepted'
                      ? 'Design branch archived — its merged work lives in git.'
                      : 'Kept the design branch and its local change log.');
                    setTimeout(() => setSuccessMsg(null), 4000);
                  } else {
                    setSuccessMsg(`Change ${resolution === 'accepted' ? 'accepted' : 'dismissed'}`);
                    setTimeout(() => setSuccessMsg(null), 3000);
                  }
                  if (pendingChanges.length <= 1) setView('overview');
                } catch (err: any) {
                  setError(err.message);
                }
              }}
              resolvedChanges={resolvedChanges}
              onAcceptArtifact={onAcceptChange}
              onRestoreModel={handleRestoreModel}
              onRestoreSpec={handleRestoreSpec}
              onApplyCriteria={handleApplyCriteria}
              onDeleteArtifact={onDeleteArtifact}
              onArchiveBranch={onArchiveBranch}
              onBindResidueFile={onBindResidueFile}
              bindTargetNodes={bindTargetNodes}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose, onBack }: { title: string; onClose: () => void; onBack?: () => void }) {
  return (
    <div style={{
      padding: '16px 24px', borderBottom: '1px solid #e5e7eb',
      display: 'flex', alignItems: 'center', gap: '12px',
    }}>
      {onBack && (
        <button onClick={onBack} style={{
          background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280',
          padding: '4px', display: 'flex', borderRadius: '4px',
        }}>
          <ArrowLeft size={18} />
        </button>
      )}
      <GitBranch size={20} style={{ color: '#374151' }} />
      <h2 style={{ margin: 0, fontSize: '17px', fontWeight: '600', color: '#111827', flex: 1 }}>{title}</h2>
      <button onClick={onClose} style={{
        background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af',
        padding: '4px', display: 'flex', borderRadius: '4px',
      }}>
        <X size={18} />
      </button>
    </div>
  );
}

function StatusBanner({ type, message, onDismiss }: { type: 'error' | 'success'; message: string; onDismiss?: () => void }) {
  const isError = type === 'error';
  return (
    <div style={{
      padding: '10px 14px', marginBottom: '16px', borderRadius: '8px', fontSize: '13px',
      display: 'flex', alignItems: 'center', gap: '8px',
      backgroundColor: isError ? '#fef2f2' : '#f0fdf4',
      border: `1px solid ${isError ? '#fecaca' : '#bbf7d0'}`,
      color: isError ? '#b91c1c' : '#15803d',
    }}>
      {isError ? <AlertCircle size={15} /> : <Check size={15} />}
      <span style={{ flex: 1 }}>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} style={{
          background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '2px',
        }}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0', color: '#6b7280' }}>
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
      <span style={{ marginLeft: '10px', fontSize: '14px' }}>Loading...</span>
    </div>
  );
}

function ProgressState({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '12px' }}>
      <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#3b82f6' }} />
      <span style={{ fontSize: '14px', color: '#6b7280' }}>{message}</span>
    </div>
  );
}

// C3: the server-side import pipeline's progress surface. The skeleton lands
// within seconds and renders the provisional component groups WITH their frame
// verdicts — the user sees what the import thinks the repo is about while the
// deep scan is still running. Undetermined frames are flagged, never guessed.
function OverviewView({ integration, onSetup, onPush, pendingChangesCount, onViewChanges, importJob, importProposalStatus, onToggleAutoSync, onSetCommitMode }: {
  integration: GitIntegration | null;
  onSetup: () => void;
  onPush: () => void;
  pendingChangesCount: number;
  onViewChanges: () => void;
  importJob: ImportJobView | null;
  importProposalStatus: string | null;
  /** B2: flip client-side auto-accept of content-only change cards. */
  onToggleAutoSync?: (enabled: boolean) => void;
  /** UX-1.1b: how pushes land — direct commit or a pull request. */
  onSetCommitMode?: (mode: 'direct' | 'pull-request') => void;
}) {
  if (!integration) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <GitBranch size={40} style={{ color: '#d1d5db', marginBottom: '16px' }} />
        <p style={{ fontSize: '15px', color: '#6b7280', marginBottom: '20px' }}>
          Connect a GitHub or GitLab repository to push and pull source code.
        </p>
        <button onClick={onSetup} style={{
          padding: '10px 24px', backgroundColor: '#111827', color: 'white',
          border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500',
        }}>
          Connect Repository
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{
        padding: '14px 16px', backgroundColor: '#f9fafb', borderRadius: '8px',
        border: '1px solid #e5e7eb', marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>
              {integration.repoOwner}/{integration.repoName}
            </span>
            <span style={{
              fontSize: '11px', padding: '2px 6px', borderRadius: '4px',
              backgroundColor: integration.provider === 'github' ? '#f3f4f6' : '#fff7ed',
              color: integration.provider === 'github' ? '#374151' : '#c2410c',
              fontWeight: '500', textTransform: 'uppercase',
            }}>
              {integration.provider}
            </span>
          </div>
          <button onClick={onSetup} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '4px',
          }}>
            <Settings size={16} />
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280' }}>
          Branch: {integration.defaultBranch}
          {integration.lastSyncAt && (
            <> -- Last sync: {new Date(integration.lastSyncAt).toLocaleDateString()}</>
          )}
        </div>
        {onToggleAutoSync && (
          <label
            title="When on, out-of-band commits that only edit already-bound, unlocked files apply to the canvas automatically (with git provenance). Deletions, moves, new files, model/spec changes, and checkbox ticks always wait for review."
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px',
              fontSize: '12px', color: '#374151', cursor: 'pointer', width: 'fit-content',
            }}
          >
            <input
              type="checkbox"
              checked={integration.autoSync}
              onChange={(e) => onToggleAutoSync(e.target.checked)}
              style={{ accentColor: '#2563eb' }}
            />
            Auto-sync edits to bound files (everything else still asks)
          </label>
        )}
        {onSetCommitMode && (
          <label
            title="Direct commit pushes straight to the branch (today's behavior). Pull request commits to a nodespec/push-* work branch and opens a PR — the design lands when it merges, and NodeSpec reconciles automatically. Each push opens a new PR."
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px',
              fontSize: '12px', color: '#374151', width: 'fit-content',
            }}
          >
            Commit mode:
            <select
              value={integration.commitMode}
              onChange={(e) => onSetCommitMode(e.target.value as 'direct' | 'pull-request')}
              style={{
                fontSize: '12px', padding: '3px 6px', borderRadius: '6px',
                border: '1px solid #d1d5db', color: '#374151', backgroundColor: '#fff',
              }}
            >
              <option value="direct">Direct commit</option>
              <option value="pull-request">Open a pull request</option>
            </select>
          </label>
        )}
      </div>

      {pendingChangesCount > 0 && (
        <button
          onClick={onViewChanges}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '12px 16px', marginBottom: '20px',
            border: '1px solid #f59e0b40', borderRadius: '10px',
            backgroundColor: '#fffbeb', cursor: 'pointer', width: '100%',
            textAlign: 'left', transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#f59e0b'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#f59e0b40'}
        >
          <div style={{
            width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#fef3c7',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706', flexShrink: 0,
          }}>
            <Bell size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#92400e' }}>
              {pendingChangesCount} External Change{pendingChangesCount !== 1 ? 's' : ''} Detected
            </div>
            <div style={{ fontSize: '12px', color: '#b45309' }}>
              Review pushed commits and reconcile with your canvas
            </div>
          </div>
          <ChevronRight size={16} style={{ color: '#d97706', flexShrink: 0 }} />
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <ActionButton
          icon={<Upload size={18} />}
          label="Commit to Repository"
          description="Commit canvas artifact files to the remote repository"
          color="#059669"
          onClick={onPush}
        />
        <McpImportSection job={importJob} proposalStatus={importProposalStatus} />
      </div>
    </div>
  );
}

/*
  The import lane (owner UX ruling 2026-08-12): no buttons, no wizard, no
  client-driven stages. The user's AI triggers and drives the deterministic
  pipeline over MCP (run_repo_import end to end — analysis, then decisions);
  this section is a copyable trigger prompt plus a live status readout of the
  latest job — the app watches, it never runs.
*/
function McpImportSection({ job, proposalStatus }: {
  job: ImportJobView | null;
  proposalStatus: string | null;
}) {
  const [promoting, setPromoting] = useState(false);
  const proposalService = useProposal();

  // The no-AI escape hatch stays, quiet by design: promote the staged draft.
  const handleSkipAiReview = async () => {
    if (!job?.proposal_id || promoting) return;
    setPromoting(true);
    try {
      await proposalService.updateProposalStatus(job.proposal_id, 'pending');
    } catch { /* already promoted — the AI finished first */ }
    setPromoting(false);
  };

  // import_jobs.stage records the last COMPLETED serial checkpoint (it is
  // initialized to 'skeleton' before anything runs), so the running label
  // names what the pipeline is doing NOW, one step ahead of the field.
  const stageLabel = (stage: string): string => {
    if (stage === 'skeleton') return 'Scanning structure & downloading the repository';
    if (stage === 'fetch' || stage.startsWith('enrich')) return 'Analyzing component groups';
    if (stage === 'synthesize') return 'Assembling the draft architecture';
    return stage;
  };

  const ready = proposalStatus === 'pending';
  // awaiting_review defaults to the staged copy while the proposal status poll
  // is still in flight — the promoted state flips it to 'ready' on first read.
  const staged = job?.status === 'awaiting_review' && !ready;
  // 'pending' = the job exists but NOTHING has driven it yet — that is a
  // waiting state, never a spinner (owner bug 2026-08-12: 'Scanning repository
  // structure' span forever on a job no AI had touched).
  const waiting = job?.status === 'pending';
  const running = job?.status === 'running';
  const failed = job?.status === 'failed';

  return (
    <div style={{
      padding: '14px 16px', borderRadius: '10px',
      border: '1px solid rgba(139, 143, 230, 0.4)', backgroundColor: 'rgba(139, 143, 230, 0.06)',
    }}>
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
        Trigger import from your AI over MCP
      </div>
      <div style={{ fontSize: '12.5px', color: '#6b7280', lineHeight: 1.5 }}>
        Importing this repo for the first time? Tell your AI to call{' '}
        <code style={{
          padding: '1px 6px', borderRadius: '4px', fontSize: '11.5px',
          backgroundColor: 'rgba(128,128,128,0.1)', border: '1px solid rgba(128,128,128,0.2)',
          fontFamily: 'ui-monospace, monospace', color: '#374151',
        }}>run_repo_import</code>{' '}
        for this project. You review the result as a single proposal here. Skip this if the
        project is already synced with git; later changes arrive through the drift sweep.
      </div>

      {(waiting || running || staged || ready || failed) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px',
          padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px', fontWeight: 600,
          backgroundColor: ready ? 'rgba(21,128,61,0.08)' : failed ? 'rgba(220,38,38,0.06)' : waiting ? 'rgba(217,119,6,0.06)' : 'rgba(128,128,128,0.06)',
          border: `1px solid ${ready ? '#15803d' : failed ? '#fca5a5' : waiting ? 'rgba(217,119,6,0.4)' : 'rgba(128,128,128,0.2)'}`,
          color: ready ? '#15803d' : failed ? '#dc2626' : waiting ? '#b45309' : '#6b7280',
        }}>
          {waiting && <AlertCircle size={14} style={{ flexShrink: 0 }} />}
          {running && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
          {ready && <Check size={14} style={{ flexShrink: 0 }} />}
          {failed && <AlertCircle size={14} style={{ flexShrink: 0 }} />}
          <span style={{ flex: 1, fontWeight: running ? 500 : 600 }}>
            {waiting && 'Not started. Tell your AI to call run_repo_import.'}
            {ready && 'Proposal ready. Open Changes in the header to review it.'}
            {staged && 'Draft staged. Your AI is finalizing it now.'}
            {running && `${stageLabel(job!.stage)}…`}
            {failed && `Import failed: ${job?.error ?? 'unknown error'}. Ask your AI to retry with restart=true.`}
          </span>
          {staged && (
            <button
              onClick={() => { void handleSkipAiReview(); }}
              disabled={promoting}
              style={{
                padding: '2px 0', border: 'none', backgroundColor: 'transparent',
                color: '#9ca3af', fontSize: '11px', cursor: promoting ? 'default' : 'pointer',
                textDecoration: 'underline', flexShrink: 0,
              }}
            >
              {promoting ? 'Promoting…' : 'Skip AI review'}
            </button>
          )}
        </div>
      )}

      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '8px' }}>
        Requires the NodeSpec MCP connection (Docs, MCP page). If your AI can't see the
        tool, reconnect the server to refresh its tool list.
      </div>
    </div>
  );
}
function ReconciliationView({ changes, resolvedChanges = [], onResolve, integration, gitService, graphArtifacts, onAcceptArtifact, onDeleteArtifact, onRestoreModel, onRestoreSpec, onApplyCriteria, onArchiveBranch, onBindResidueFile, bindTargetNodes }: {
  changes: GitChangeEvent[];
  /** Owner 2026-07-30 (recovery lane): recently resolved cards — their content
   *  stays reachable at the recorded commit sha, re-acceptable any time. */
  resolvedChanges?: GitChangeEvent[];
  onResolve: (changeId: string, resolution: 'accepted' | 'dismissed') => Promise<void>;
  integration: GitIntegration | null;
  gitService: GitService;
  graphArtifacts: Record<string, { path?: string; content?: string; nodeId?: string }>;
  onAcceptArtifact?: (artifactId: string, newContent: string, path: string, sourceCommit?: string) => string | null;
  onDeleteArtifact?: (artifactId: string, path: string) => string | null;
  /** R3-1: git wins — load the repo model onto the canvas (shown on model-bearing cards). */
  onRestoreModel?: () => Promise<void>;
  /** R7c: load the repo's requirements. Independent of the model load. */
  onRestoreSpec?: () => Promise<void>;
  /** R5c: apply this card's ticked acceptance criteria to `met`, with provenance. */
  onApplyCriteria?: (changeEventId: string) => Promise<void>;
  /** R3-3c: the ref-deleted lifecycle card's Archive action. */
  onArchiveBranch?: (branchName: string) => Promise<void>;
  /** R3-4c: bind an unattributed repo file (residue) to a node. */
  onBindResidueFile?: (path: string, nodeId: string, content: string, sourceCommit?: string) => string | null;
  /** R3-4c: bindable (non-container) nodes for the residue picker. */
  bindTargetNodes?: Array<{ id: string; label: string }>;
}) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [expandedChange, setExpandedChange] = useState<string | null>(changes.length === 1 ? changes[0].id : null);
  // `resolved: true` = the recovery lane — Accept applies content but never
  // re-resolves the card (re-resolving a stale card would REGRESS the baseline).
  const [comparingFile, setComparingFile] = useState<{ changeId: string; path: string; remoteContent: string; artifactId: string; resolved?: boolean } | null>(null);
  const [fetchingPath, setFetchingPath] = useState<string | null>(null);
  // Owner 2026-07-30: an Accept failure (e.g. locked file) stays ON the card —
  // the row is not consumed, the card is not resolved, the baseline untouched.
  const [acceptErrors, setAcceptErrors] = useState<Record<string, string>>({});

  const artifactByPath = new Map<string, { id: string; content: string; nodeId?: string }>();
  for (const [id, art] of Object.entries(graphArtifacts)) {
    if (art.path) {
      const normalized = art.path.startsWith('/') ? art.path.slice(1) : art.path;
      artifactByPath.set(normalized, { id, content: art.content || '', nodeId: art.nodeId });
    }
  }

  const handleResolve = async (changeId: string, resolution: 'accepted' | 'dismissed') => {
    setResolving(changeId);
    try {
      await onResolve(changeId, resolution);
    } finally {
      setResolving(null);
    }
  };

  // R3-4a card safety: per-file actions mark the FILE applied; the card resolves
  // (and the baseline advances) only when every matched file has been handled —
  // one accepted file no longer waves the whole range through.
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const appliedKey = (changeId: string, path: string) => `${changeId}:${path}`;

  const actionablePathsFor = (change: GitChangeEvent): string[] => {
    const matched = new Set((change.artifactMatches || []).map(m => m.path));
    return change.changedFiles
      .filter(f => matched.has(f.path) || artifactByPath.has(f.path))
      .map(f => f.path);
  };

  const markApplied = async (change: GitChangeEvent, paths: string[]) => {
    if (paths.length === 0) return;
    const next = new Set(applied);
    for (const p of paths) next.add(appliedKey(change.id, p));
    setApplied(next);
    const actionable = actionablePathsFor(change);
    if (actionable.length > 0 && actionable.every(p => next.has(appliedKey(change.id, p)))) {
      await handleResolve(change.id, 'accepted');
    }
  };

  const handleCompare = async (changeId: string, path: string, artifactId: string) => {
    if (!integration) return;
    setFetchingPath(path);
    try {
      // Owner bench 2026-07-29: fetch from the CHANGE's branch, not the default —
      // and an empty result must still open the view (it used to do nothing).
      const change = changes.find(c => c.id === changeId);
      const files = await gitService.fetchFileContent(integration.id, [path], change?.branchName);
      setComparingFile({
        changeId,
        path,
        remoteContent: files.length > 0
          ? files[0].content
          : `(File not found on the ${change?.branchName ?? 'bound'} branch — it may have been renamed or deleted since this change was recorded.)`,
        artifactId,
      });
    } catch (err) {
      setComparingFile({ changeId, path, remoteContent: `(Failed to fetch remote content: ${err instanceof Error ? err.message : 'unknown error'})`, artifactId });
    } finally {
      setFetchingPath(null);
    }
  };

  const handleAcceptFile = async (artifactId: string, newContent: string, path: string, changeId: string, resolvedLane = false) => {
    const change = (resolvedLane ? resolvedChanges : changes).find(c => c.id === changeId);
    // R3-4b: the source commit rides along so the artifact records WHERE the
    // accepted content came from.
    const err = onAcceptArtifact ? onAcceptArtifact(artifactId, newContent, path, change?.commitSha) : 'No accept handler wired';
    if (err) {
      // Owner 2026-07-30: failure keeps the row AND the card — nothing is consumed.
      setAcceptErrors(prev => ({ ...prev, [changeId]: err }));
      setComparingFile(null);
      return;
    }
    setAcceptErrors(prev => {
      const { [changeId]: _gone, ...rest } = prev;
      return rest;
    });
    setComparingFile(null);
    // Recovery lane: the card is ALREADY resolved — re-resolving it would regress
    // the baseline to a stale head. Apply content only.
    if (change && !resolvedLane) await markApplied(change, [path]);
  };

  const handleAcceptDeletion = async (artifactId: string, path: string, changeId: string) => {
    // R3-4a: deleting a binding is destructive — confirm first, always.
    if (!window.confirm(`Remove "${path}" from the canvas? The file was deleted in git; this removes its binding from the node.`)) return;
    const err = onDeleteArtifact ? onDeleteArtifact(artifactId, path) : 'No delete handler wired';
    if (err) {
      setAcceptErrors(prev => ({ ...prev, [changeId]: err }));
      return;
    }
    setAcceptErrors(prev => {
      const { [changeId]: _gone, ...rest } = prev;
      return rest;
    });
    const change = changes.find(c => c.id === changeId);
    if (change) await markApplied(change, [path]);
  };

  const [batchAccepting, setBatchAccepting] = useState<string | null>(null);

  // R3-4a: the batch button applies MODIFICATIONS only — deletions were silently
  // riding along under an "Accept All Matched" label. Matched deletions now have
  // their own explicit button (with confirm) below.
  const handleAcceptAllMatched = async (change: GitChangeEvent) => {
    if (!integration || !onAcceptArtifact) return;
    setBatchAccepting(change.id);
    try {
      const matches = change.artifactMatches || [];
      const matchedPaths = new Set(matches.map(m => m.path));

      const modifiedFiles = change.changedFiles.filter(
        f => f.action !== 'removed' &&
          (matchedPaths.has(f.path) || artifactByPath.has(f.path)) &&
          !applied.has(appliedKey(change.id, f.path))
      );

      const done: string[] = [];
      const failed: string[] = [];
      let lastError: string | null = null;
      if (modifiedFiles.length > 0) {
        const fetched = await gitService.fetchFileContent(
          integration.id,
          modifiedFiles.map(f => f.path),
          change.branchName,
        );
        for (const file of fetched) {
          const match = matches.find(m => m.path === file.path);
          const local = artifactByPath.get(file.path);
          const artifactId = match?.artifactId || local?.id;
          if (artifactId) {
            const err = onAcceptArtifact(artifactId, file.content, file.path, change.commitSha);
            if (err) {
              failed.push(file.path);
              lastError = err;
            } else {
              done.push(file.path);
            }
          }
        }
      }

      if (failed.length > 0 && lastError) {
        setAcceptErrors(prev => ({
          ...prev,
          [change.id]: failed.length === 1 ? lastError : `${failed.length} file(s) not applied. Last error: ${lastError}`,
        }));
      } else {
        setAcceptErrors(prev => {
          const { [change.id]: _gone, ...rest } = prev;
          return rest;
        });
      }
      await markApplied(change, done);
    } finally {
      setBatchAccepting(null);
    }
  };

  const matchedDeletionsFor = (change: GitChangeEvent) => {
    const matches = change.artifactMatches || [];
    const matchedPaths = new Set(matches.map(m => m.path));
    return change.changedFiles.filter(
      f => f.action === 'removed' &&
        (matchedPaths.has(f.path) || artifactByPath.has(f.path)) &&
        !applied.has(appliedKey(change.id, f.path))
    );
  };

  // R3-4c: the residue lanes — bind an unattributed file to a node (content
  // fetched here so the binding lands usable) or persist an ignore on the card.
  // Session-local handled-set updates the UI without a refetch; the sweep drops
  // bound paths naturally on its next pass (the matcher finds the new binding).
  const [residueHandled, setResidueHandled] = useState<Set<string>>(new Set());
  const [bindSelection, setBindSelection] = useState<Record<string, string>>({});
  const [residueBusyPath, setResidueBusyPath] = useState<string | null>(null);
  const [residueError, setResidueError] = useState<string | null>(null);

  const handleBindResidue = async (change: GitChangeEvent, path: string) => {
    const nodeId = bindSelection[appliedKey(change.id, path)];
    if (!nodeId || !onBindResidueFile || !integration) return;
    setResidueBusyPath(path);
    setResidueError(null);
    try {
      let content = '';
      try {
        const files = await gitService.fetchFileContent(integration.id, [path], change.branchName);
        content = files[0]?.content ?? '';
      } catch { /* bind without content — it hydrates later via "Load from repo" */ }
      // Owner bench 2026-07-29: the bind used to be fire-and-forget — a patch
      // failure showed a toast BEHIND this modal while the row vanished as if it
      // succeeded. The callback now returns the error; failure keeps the row and
      // shows the reason right here on the card.
      const bindError = onBindResidueFile(path, nodeId, content, change.commitSha);
      if (bindError) {
        setResidueError(bindError);
        return;
      }
      setResidueHandled(prev => new Set([...prev, appliedKey(change.id, path)]));
    } finally {
      setResidueBusyPath(null);
    }
  };

  const handleIgnoreResidue = async (change: GitChangeEvent, path: string) => {
    setResidueBusyPath(path);
    setResidueError(null);
    try {
      await gitService.ignoreResidueFile(change.id, path);
      setResidueHandled(prev => new Set([...prev, appliedKey(change.id, path)]));
    } catch (err) {
      setResidueError('Ignore failed: ' + (err instanceof Error ? err.message : 'unknown error'));
    } finally {
      setResidueBusyPath(null);
    }
  };

  const handleApplyMatchedDeletions = async (change: GitChangeEvent) => {
    if (!onDeleteArtifact) return;
    const deletions = matchedDeletionsFor(change);
    if (deletions.length === 0) return;
    if (!window.confirm(`Remove ${deletions.length} canvas file(s) deleted in git? This removes their bindings from their nodes.`)) return;
    setBatchAccepting(change.id);
    try {
      const matches = change.artifactMatches || [];
      const done: string[] = [];
      let lastError: string | null = null;
      for (const file of deletions) {
        const match = matches.find(m => m.path === file.path);
        const local = artifactByPath.get(file.path);
        const artifactId = match?.artifactId || local?.id;
        if (artifactId) {
          const err = onDeleteArtifact(artifactId, file.path);
          if (err) lastError = err;
          else done.push(file.path);
        }
      }
      if (lastError) setAcceptErrors(prev => ({ ...prev, [change.id]: lastError as string }));
      await markApplied(change, done);
    } finally {
      setBatchAccepting(null);
    }
  };

  // Owner 2026-07-30 (recovery lane): fetch a resolved change's file content AT
  // the commit its card recorded — reachable even after the branch moved on, and
  // even after the repo copy was overwritten by a later push (git history keeps it).
  const handleViewAtCommit = async (change: GitChangeEvent, path: string, artifactId: string) => {
    if (!integration) return;
    setFetchingPath(`${change.id}:${path}`);
    try {
      const files = await gitService.fetchFileContent(integration.id, [path], undefined, change.commitSha);
      setComparingFile({
        changeId: change.id,
        path,
        remoteContent: files.length > 0
          ? files[0].content
          : `(File not found at commit ${change.commitSha.slice(0, 8)} — it may not have existed there.)`,
        artifactId,
        resolved: true,
      });
    } catch (err) {
      setComparingFile({ changeId: change.id, path, remoteContent: `(Failed to fetch: ${err instanceof Error ? err.message : 'unknown error'})`, artifactId, resolved: true });
    } finally {
      setFetchingPath(null);
    }
  };

  const resolvedSection = resolvedChanges.length > 0 && (
    <div style={{ marginTop: '16px', borderTop: '1px solid #e5e7eb', paddingTop: '12px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: '8px' }}>
        Recently resolved — content stays reachable at its commit
      </div>
      {resolvedChanges.map(change => {
        const files = (change.artifactMatches || []).filter(m => m.artifactId);
        return (
          <div key={change.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px', backgroundColor: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#374151' }}>
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
                backgroundColor: change.status === 'accepted' ? 'rgba(5, 150, 105, 0.1)' : 'rgba(107, 114, 128, 0.12)',
                color: change.status === 'accepted' ? '#059669' : '#6b7280',
                textTransform: 'uppercase',
              }}>
                {change.status}
              </span>
              <code style={{ fontSize: '11px', color: '#6b7280' }}>{change.commitSha?.slice(0, 8)}</code>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#6b7280' }}>
                {change.commitMessage}
              </span>
            </div>
            {files.length > 0 && (
              <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {files.map(m => (
                  <div key={m.path} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                    <code style={{ flex: 1, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.path}</code>
                    <button
                      onClick={() => handleViewAtCommit(change, m.path, m.artifactId)}
                      disabled={fetchingPath === `${change.id}:${m.path}`}
                      style={{
                        padding: '3px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '5px',
                        border: '1px solid #d1d5db', backgroundColor: 'white', color: '#374151', cursor: 'pointer',
                      }}
                    >
                      {fetchingPath === `${change.id}:${m.path}` ? 'Loading…' : 'View at commit'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  if (comparingFile) {
    const canvasArtifact = artifactByPath.get(comparingFile.path);
    return (
      <CompareView
        path={comparingFile.path}
        canvasContent={canvasArtifact?.content || ''}
        remoteContent={comparingFile.remoteContent}
        onAccept={() => handleAcceptFile(comparingFile.artifactId, comparingFile.remoteContent, comparingFile.path, comparingFile.changeId, comparingFile.resolved === true)}
        onDismiss={() => setComparingFile(null)}
        canAccept={!!onAcceptArtifact}
      />
    );
  }

  if (changes.length === 0) {
    return (
      <div>
        <div style={{ textAlign: 'center', padding: '32px 0 16px', color: '#6b7280' }}>
          <Check size={32} style={{ color: '#22c55e', marginBottom: '12px' }} />
          <p style={{ fontSize: '14px', fontWeight: 500 }}>All changes reconciled</p>
        </div>
        {resolvedSection}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
        {changes.length} pending change{changes.length !== 1 ? 's' : ''} from external pushes.
        Review each and accept or dismiss.
      </div>
      {changes.map(change => {
        const isExpanded = expandedChange === change.id;
        const isResolving = resolving === change.id;
        const matches = change.artifactMatches || [];
        const matchedPaths = new Set(matches.map(m => m.path));
        return (
          <div
            key={change.id}
            style={{
              border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden',
              opacity: isResolving ? 0.6 : 1, transition: 'opacity 0.2s',
            }}
          >
            <button
              onClick={() => setExpandedChange(isExpanded ? null : change.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                padding: '12px 14px', border: 'none', background: '#f9fafb',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              {isExpanded
                ? <ChevronDown size={14} style={{ color: '#6b7280', flexShrink: 0 }} />
                : <ChevronRight size={14} style={{ color: '#6b7280', flexShrink: 0 }} />
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '13px', fontWeight: 600, color: '#111827',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {change.commitMessage || 'No commit message'}
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                  {change.author} -- {change.commitSha.slice(0, 8)}
                  {change.branch && <> on {change.branch}</>}
                  {' -- '}{change.changedFiles.length} file{change.changedFiles.length !== 1 ? 's' : ''}
                  {matches.length > 0 && (
                    <span style={{ color: '#059669', fontWeight: 600 }}> -- {matches.length} matched to canvas</span>
                  )}
                </div>
              </div>
            </button>

            {/* R3-3c: the ref-deleted lifecycle card — a bound git ref vanished
                (typically merged + deleted after a PR). Archive removes the NodeSpec
                design branch; Keep leaves everything. NEVER touches any baseline. */}
            {isExpanded && change.source === 'ref-deleted' ? (
              <div style={{ padding: '0 14px 14px' }}>
                {archiveError && (
                  <div style={{
                    padding: '8px 10px', marginTop: '8px', borderRadius: '6px',
                    backgroundColor: '#fef2f2', border: '1px solid #fecaca', fontSize: '12px', color: '#991b1b',
                  }}>
                    {archiveError}
                  </div>
                )}
                <div style={{
                  marginTop: '10px', padding: '10px 12px', borderRadius: '6px',
                  backgroundColor: '#fffbeb', border: '1px solid #fde68a',
                  fontSize: '12px', color: '#92400e', lineHeight: 1.6,
                }}>
                  The git branch bound to design branch <strong>"{change.branchName}"</strong> no
                  longer exists — typically because its pull request was merged and the branch
                  deleted. The merged design lives in git: switch to main and sync to see it.
                  Archiving removes this design branch and its local change log from NodeSpec.
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button
                    onClick={() => handleResolve(change.id, 'dismissed')}
                    disabled={isResolving}
                    style={{
                      flex: 1, padding: '8px 12px', fontSize: '12px', fontWeight: 600,
                      border: '1px solid #d1d5db', borderRadius: '6px',
                      backgroundColor: 'white', color: '#374151',
                      cursor: isResolving ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    }}
                  >
                    <XCircle size={14} />
                    Keep branch
                  </button>
                  {onArchiveBranch && change.branchName && (
                    <button
                      onClick={async () => {
                        setResolving(change.id);
                        setArchiveError(null);
                        try {
                          await onArchiveBranch(change.branchName!);
                          await onResolve(change.id, 'accepted');
                        } catch (err) {
                          setArchiveError('Archive failed: ' + (err instanceof Error ? err.message : 'unknown error'));
                        } finally {
                          setResolving(null);
                        }
                      }}
                      disabled={isResolving}
                      style={{
                        flex: 1, padding: '8px 12px', fontSize: '12px', fontWeight: 600,
                        border: 'none', borderRadius: '6px',
                        backgroundColor: '#d97706', color: 'white',
                        cursor: isResolving ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                      }}
                    >
                      <Check size={14} />
                      Archive design branch
                    </button>
                  )}
                </div>
              </div>
            ) : isExpanded && (
              <div style={{ padding: '0 14px 14px' }}>
                {change.matchError && (
                  <div style={{
                    padding: '8px 10px', marginTop: '8px', borderRadius: '6px',
                    backgroundColor: '#fef2f2', border: '1px solid #fecaca', fontSize: '12px', color: '#991b1b',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                    Artifact matching failed: {change.matchError}
                  </div>
                )}
                {matches.length > 0 && (
                  <div style={{
                    padding: '8px 10px', marginTop: '8px', borderRadius: '6px',
                    backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '12px', color: '#15803d',
                  }}>
                    {matches.length} file{matches.length !== 1 ? 's' : ''} match canvas artifacts. Compare to see what changed.
                  </div>
                )}
                <div style={{
                  maxHeight: '240px', overflowY: 'auto',
                  border: '1px solid #f3f4f6', borderRadius: '6px', marginTop: '8px',
                }}>
                  {change.changedFiles.map((file, idx) => {
                    const isMatched = matchedPaths.has(file.path) || artifactByPath.has(file.path);
                    const match = matches.find(m => m.path === file.path);
                    const localArtifact = artifactByPath.get(file.path);
                    const artifactId = match?.artifactId || localArtifact?.id || '';
                    const isFetching = fetchingPath === file.path;
                    const isApplied = applied.has(appliedKey(change.id, file.path));
                    return (
                      <div key={idx} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '6px 10px', borderBottom: idx < change.changedFiles.length - 1 ? '1px solid #f3f4f6' : 'none',
                        fontSize: '12px', backgroundColor: isMatched ? '#fafff9' : 'transparent',
                      }}>
                        <span style={{
                          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                          padding: '1px 5px', borderRadius: '3px',
                          color: file.action === 'added' ? '#16a34a' : file.action === 'removed' ? '#dc2626' : '#d97706',
                          backgroundColor: file.action === 'added' ? '#dcfce7' : file.action === 'removed' ? '#fef2f2' : '#fefce8',
                        }}>
                          {file.action === 'added' ? 'A' : file.action === 'removed' ? 'D' : 'M'}
                        </span>
                        <span style={{ color: '#374151', fontFamily: 'monospace', fontSize: '12px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {file.path}
                        </span>
                        {isApplied && (
                          <span style={{ fontSize: '10px', fontWeight: 600, color: '#059669', whiteSpace: 'nowrap' }}>
                            Applied ✓
                          </span>
                        )}
                        {!isApplied && isMatched && file.action !== 'removed' && (
                          <button
                            onClick={() => handleCompare(change.id, file.path, artifactId)}
                            disabled={isFetching}
                            style={{
                              padding: '2px 8px', fontSize: '10px', fontWeight: 600,
                              border: '1px solid #059669', borderRadius: '4px',
                              backgroundColor: 'white', color: '#059669',
                              cursor: isFetching ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                            }}
                          >
                            {isFetching ? 'Loading...' : 'Compare'}
                          </button>
                        )}
                        {!isApplied && isMatched && file.action === 'removed' && artifactId && onDeleteArtifact && (
                          <button
                            onClick={() => handleAcceptDeletion(artifactId, file.path, change.id)}
                            style={{
                              padding: '2px 8px', fontSize: '10px', fontWeight: 600,
                              border: '1px solid #dc2626', borderRadius: '4px',
                              backgroundColor: 'white', color: '#dc2626',
                              cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {(() => {
                  // R3-4a: modifications and deletions are separate consents — the old
                  // single button silently deleted bindings under an "Accept" label.
                  const pendingModified = change.changedFiles.filter(
                    f => f.action !== 'removed' &&
                      (matchedPaths.has(f.path) || artifactByPath.has(f.path)) &&
                      !applied.has(appliedKey(change.id, f.path))
                  ).length;
                  const pendingDeletions = matchedDeletionsFor(change).length;
                  const busy = isResolving || batchAccepting === change.id;
                  return (
                    <>
                      {pendingModified > 0 && onAcceptArtifact && (
                        <button
                          onClick={() => handleAcceptAllMatched(change)}
                          disabled={busy}
                          style={{
                            width: '100%', padding: '8px 12px', fontSize: '12px', fontWeight: 600,
                            border: '1px solid #059669', borderRadius: '6px', marginTop: '12px',
                            backgroundColor: '#f0fdf4', color: '#059669',
                            cursor: busy ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                          }}
                        >
                          {batchAccepting === change.id ? (
                            <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Applying changes...</>
                          ) : (
                            <><Check size={14} /> Accept {pendingModified} Changed File{pendingModified !== 1 ? 's' : ''}</>
                          )}
                        </button>
                      )}
                      {pendingDeletions > 0 && onDeleteArtifact && (
                        <button
                          onClick={() => handleApplyMatchedDeletions(change)}
                          disabled={busy}
                          style={{
                            width: '100%', padding: '8px 12px', fontSize: '12px', fontWeight: 600,
                            border: '1px solid #dc2626', borderRadius: '6px', marginTop: '8px',
                            backgroundColor: '#fff', color: '#dc2626',
                            cursor: busy ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                          }}
                        >
                          <XCircle size={14} /> Apply {pendingDeletions} Deletion{pendingDeletions !== 1 ? 's' : ''} (removes bindings)
                        </button>
                      )}
                    </>
                  );
                })()}

                {/* Owner 2026-07-30: an Accept failure (e.g. locked file) stays
                    HERE on the card — the row survives and nothing is consumed. */}
                {acceptErrors[change.id] && (
                  <div style={{
                    marginTop: '8px', padding: '8px 10px', borderRadius: '6px',
                    backgroundColor: 'rgba(220, 38, 38, 0.06)', border: '1px solid rgba(220, 38, 38, 0.25)',
                    fontSize: '12px', color: '#dc2626', lineHeight: 1.5,
                  }}>
                    {acceptErrors[change.id]}
                  </div>
                )}

                {/* R3-4c: unattributed files — the amber block IS the difference
                    between "we looked at this and it's fine" and "this file belongs
                    to no node". Bind creates a draft binding on the chosen node
                    (provenance-stamped); Ignore persists on the card. */}
                {(() => {
                  const ignored = new Set(change.ignoredResidue || []);
                  const residue = (change.residuePaths || []).filter(
                    p => !ignored.has(p) && !residueHandled.has(appliedKey(change.id, p))
                  );
                  if (residue.length === 0) return null;
                  return (
                    <div style={{
                      marginTop: '10px', padding: '10px 12px', borderRadius: '6px',
                      backgroundColor: '#fffbeb', border: '1px solid #fde68a', fontSize: '12px',
                    }}>
                      <div style={{ fontWeight: 600, color: '#92400e' }}>
                        {residue.length} file{residue.length !== 1 ? 's' : ''} belong{residue.length === 1 ? 's' : ''} to no node
                      </div>
                      <div style={{ color: '#a16207', margin: '2px 0 8px', lineHeight: 1.5 }}>
                        New in the repo and not bound to your design. Bind each to the node
                        that owns it, or ignore it (build output, tooling, etc.).
                      </div>
                      {residueError && (
                        <div style={{ color: '#991b1b', marginBottom: '6px' }}>{residueError}</div>
                      )}
                      {residue.map(path => {
                        const key = appliedKey(change.id, path);
                        const busy = residueBusyPath === path;
                        return (
                          <div key={path} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0' }}>
                            <span style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path}>
                              {path}
                            </span>
                            {onBindResidueFile && (bindTargetNodes?.length ?? 0) > 0 && (
                              <>
                                <select
                                  value={bindSelection[key] ?? ''}
                                  onChange={(e) => setBindSelection(prev => ({ ...prev, [key]: e.target.value }))}
                                  style={{
                                    maxWidth: '150px', padding: '2px 4px', fontSize: '11px',
                                    border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: '#fff', color: '#374151',
                                  }}
                                >
                                  <option value="">Bind to…</option>
                                  {bindTargetNodes!.map(n => (
                                    <option key={n.id} value={n.id}>{n.label}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => handleBindResidue(change, path)}
                                  disabled={busy || !bindSelection[key]}
                                  style={{
                                    padding: '2px 10px', fontSize: '10px', fontWeight: 600,
                                    border: '1px solid #d97706', borderRadius: '4px',
                                    backgroundColor: bindSelection[key] ? '#d97706' : '#fff',
                                    color: bindSelection[key] ? '#fff' : '#d97706',
                                    cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                                  }}
                                >
                                  {busy ? '…' : 'Bind'}
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => handleIgnoreResidue(change, path)}
                              disabled={busy}
                              style={{
                                padding: '2px 8px', fontSize: '10px',
                                border: '1px solid #d1d5db', borderRadius: '4px',
                                backgroundColor: '#fff', color: '#6b7280',
                                cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                              }}
                            >
                              Ignore
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* R3-2: entity-level model diff — the Accept/Load choice is informed,
                    not blind. Direction: what LOADING the repo model would do. */}
                {change.modelDiff && !change.modelDiff.identical && (
                  <div style={{
                    marginTop: '10px', padding: '10px 12px', borderRadius: '6px',
                    backgroundColor: 'rgba(37, 99, 235, 0.06)', border: '1px solid rgba(37, 99, 235, 0.25)',
                    fontSize: '12px', lineHeight: 1.6,
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                      Model differences (what "Load repo model" would change on your canvas):
                    </div>
                    {([['Nodes', change.modelDiff.nodes], ['Edges', change.modelDiff.edges], ['Contracts', change.modelDiff.contracts], ['Artifacts', change.modelDiff.artifacts]] as const)
                      .filter(([, b]) => b.addedCount + b.removedCount + b.changedCount > 0)
                      .map(([label, b]) => {
                        const part = (count: number, names: string[], sign: string, verb: string) =>
                          count > 0 ? `${sign}${count} ${verb}${names.length > 0 ? ` (${names.join(', ')}${count > names.length ? ', …' : ''})` : ''}` : '';
                        const parts = [
                          part(b.addedCount, b.added, '+', 'added'),
                          part(b.removedCount, b.removed, '−', 'removed'),
                          part(b.changedCount, b.changed, '~', 'changed'),
                        ].filter(Boolean);
                        return <div key={label}><strong>{label}:</strong> {parts.join(' · ')}</div>;
                      })}
                    <div style={{ marginTop: '4px', opacity: 0.75 }}>
                      Accepting instead keeps your canvas — your next push applies the inverse to the repo.
                    </div>
                  </div>
                )}

                {/* R5c: acceptance criteria ticked in the changed task docs. A task
                    doc renders per-criterion `met` as checkboxes, so a developer or
                    an AI ticking one in git IS the completion signal — but it lands
                    as a PROPOSAL here, never a silent write. */}
                {change.criterionDeltas && change.criterionDeltas.deltas.some(d => d.direction === 'tick') && (
                  <div style={{
                    marginTop: '10px', padding: '10px 12px', borderRadius: '6px',
                    backgroundColor: 'rgba(5, 150, 105, 0.07)', border: '1px solid rgba(5, 150, 105, 0.3)',
                    fontSize: '12px', lineHeight: 1.6,
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                      Acceptance criteria ticked in this commit:
                    </div>
                    {change.criterionDeltas.deltas.filter(d => d.direction === 'tick').map((d, i) => (
                      <div key={`${d.requirementId}-${i}`} style={{ paddingLeft: '2px' }}>
                        ✓ <strong>{d.requirementId}</strong> — {d.text}
                      </div>
                    ))}
                    {change.criterionDeltas.deltas.some(d => d.direction === 'untick') && (
                      <div style={{ marginTop: '4px', opacity: 0.8 }}>
                        Some boxes are UNticked in the doc. Those are not applied — a stale or
                        regenerated document must not retract evidence a test proved.
                      </div>
                    )}
                    {change.criterionDeltas.flagged.length > 0 && (
                      <div style={{ marginTop: '4px', opacity: 0.8 }}>
                        {change.criterionDeltas.flagged.length} line(s) did not match any known criterion
                        (reworded or hand-added) — flagged, never guessed.
                      </div>
                    )}
                    {change.criteriaApplied ? (
                      <div style={{ marginTop: '6px', color: '#059669', fontWeight: 600 }}>
                        Applied ✓ — {change.criteriaApplied.count} criterion(s) marked met.
                      </div>
                    ) : onApplyCriteria && (
                      <button
                        onClick={async () => {
                          setResolving(change.id);
                          try { await onApplyCriteria(change.id); } finally { setResolving(null); }
                        }}
                        disabled={isResolving}
                        style={{
                          marginTop: '6px', padding: '5px 12px', fontSize: '11.5px', fontWeight: 600,
                          border: 'none', borderRadius: '6px', cursor: isResolving ? 'not-allowed' : 'pointer',
                          backgroundColor: '#059669', color: '#fff',
                        }}
                      >
                        Mark these criteria met
                      </button>
                    )}
                  </div>
                )}

                {/* R7c: the spec plane's diff. Separate block from the model diff
                    because they answer separate questions and either can be taken
                    without the other. */}
                {change.specDiff && !change.specDiff.identical && (
                  <div style={{
                    marginTop: '10px', padding: '10px 12px', borderRadius: '6px',
                    backgroundColor: 'rgba(124, 58, 237, 0.06)', border: '1px solid rgba(124, 58, 237, 0.25)',
                    fontSize: '12px', lineHeight: 1.6,
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                      Requirement differences (what "Load requirements from repo" would change):
                    </div>
                    {(() => {
                      const b = change.specDiff!.requirements;
                      const part = (count: number, names: string[], sign: string, verb: string) =>
                        count > 0 ? `${sign}${count} ${verb}${names.length > 0 ? ` (${names.join(', ')}${count > names.length ? ', …' : ''})` : ''}` : '';
                      const parts = [
                        part(b.addedCount, b.added, '+', 'added'),
                        part(b.removedCount, b.removed, '−', 'not in the repo'),
                        part(b.changedCount, b.changed, '~', 'changed'),
                      ].filter(Boolean);
                      return parts.length > 0 ? <div><strong>Requirements:</strong> {parts.join(' · ')}</div> : null;
                    })()}
                    {(change.specDiff.criteria.addedCount > 0 || change.specDiff.criteria.removedCount > 0) && (
                      <div>
                        <strong>Acceptance criteria:</strong>{' '}
                        {[
                          change.specDiff.criteria.addedCount > 0 ? `+${change.specDiff.criteria.addedCount} added` : '',
                          change.specDiff.criteria.removedCount > 0 ? `−${change.specDiff.criteria.removedCount} removed` : '',
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {change.specDiff.visionChanged && <div><strong>Vision:</strong> changed</div>}
                    <div style={{ marginTop: '4px', opacity: 0.75 }}>
                      Criteria you have already met keep their evidence — only criteria whose text
                      changed come back unmet. Requirements the repo does not have are kept, never deleted.
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: matches.length > 0 && onAcceptArtifact ? '8px' : '12px' }}>
                  <button
                    onClick={() => {
                      // Owner 2026-07-30: dismiss = "my canvas wins" — say what
                      // that costs BEFORE it happens, not after the next push.
                      if (!window.confirm('Dismiss keeps YOUR canvas version: your next push will overwrite this out-of-band change in the repository. The commit itself stays in git history and remains viewable under "Recently resolved". Continue?')) return;
                      void handleResolve(change.id, 'dismissed');
                    }}
                    disabled={isResolving}
                    style={{
                      flex: 1, padding: '8px 12px', fontSize: '12px', fontWeight: 600,
                      border: '1px solid #d1d5db', borderRadius: '6px',
                      backgroundColor: 'white', color: '#374151',
                      cursor: isResolving ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    }}
                  >
                    <XCircle size={14} />
                    Dismiss
                  </button>
                  <button
                    onClick={() => handleResolve(change.id, 'accepted')}
                    disabled={isResolving}
                    style={{
                      flex: 1, padding: '8px 12px', fontSize: '12px', fontWeight: 600,
                      border: 'none', borderRadius: '6px',
                      backgroundColor: '#059669', color: 'white',
                      cursor: isResolving ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    }}
                  >
                    <Check size={14} />
                    Accept
                  </button>
                  {/* R3-1: the third option — git wins. Only on cards that carry a
                      model question (connect mismatch, or a sweep range that touched
                      model.json). The restore resolves the card server-side. */}
                  {onRestoreModel && (change.source === 'connect-anchor-mismatch' || change.modelChanged) && (
                    <button
                      onClick={async () => {
                        setResolving(change.id);
                        try { await onRestoreModel(); } finally { setResolving(null); }
                      }}
                      disabled={isResolving}
                      style={{
                        flex: 1.4, padding: '8px 12px', fontSize: '12px', fontWeight: 600,
                        border: '1px solid #2563eb', borderRadius: '6px',
                        backgroundColor: '#2563eb', color: 'white',
                        cursor: isResolving ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                      }}
                    >
                      <Download size={14} />
                      Load repo model onto canvas
                    </button>
                  )}
                  {/* R7c: the spec plane's own question. Separate button because the
                      two anchors move independently — taking the repo's requirements
                      must not force a canvas replacement. */}
                  {onRestoreSpec && change.specChanged && (
                    <button
                      onClick={async () => {
                        setResolving(change.id);
                        try { await onRestoreSpec(); } finally { setResolving(null); }
                      }}
                      disabled={isResolving}
                      style={{
                        flex: 1.4, padding: '8px 12px', fontSize: '12px', fontWeight: 600,
                        border: '1px solid #7c3aed', borderRadius: '6px',
                        backgroundColor: '#7c3aed', color: 'white',
                        cursor: isResolving ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                      }}
                      title="Load the repository's requirements and acceptance criteria. Criteria you have already met keep their evidence."
                    >
                      <Download size={14} />
                      Load requirements from repo
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {resolvedSection}
    </div>
  );
}

function CompareView({ path, canvasContent, remoteContent, onAccept, onDismiss, canAccept }: {
  path: string;
  canvasContent: string;
  remoteContent: string;
  onAccept: () => void;
  onDismiss: () => void;
  canAccept: boolean;
}) {
  const canvasLines = canvasContent.split('\n');
  const remoteLines = remoteContent.split('\n');
  const maxLines = Math.max(canvasLines.length, remoteLines.length);
  const hasChanges = canvasContent !== remoteContent;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', fontFamily: 'monospace' }}>
        {path}
      </div>
      {!hasChanges ? (
        <div style={{
          padding: '16px', textAlign: 'center', borderRadius: '8px',
          backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', fontSize: '13px',
        }}>
          No differences -- canvas artifact matches remote file.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '11px', fontWeight: 600, color: '#6b7280',
              padding: '6px 10px', backgroundColor: '#f9fafb', borderRadius: '6px 6px 0 0',
              borderBottom: '1px solid #e5e7eb',
            }}>
              Canvas (current)
            </div>
            <pre style={{
              margin: 0, padding: '10px', fontSize: '11px', lineHeight: '1.5',
              backgroundColor: '#fefce8', border: '1px solid #fde68a', borderTop: 'none',
              borderRadius: '0 0 6px 6px', overflow: 'auto', maxHeight: '340px',
              fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#374151',
            }}>
              {canvasLines.slice(0, maxLines).map((line, i) => (
                <div key={i} style={{
                  backgroundColor: i < remoteLines.length && line !== remoteLines[i] ? '#fef9c3' : 'transparent',
                  padding: '0 4px',
                }}>
                  <span style={{ color: '#9ca3af', userSelect: 'none', display: 'inline-block', width: '32px', textAlign: 'right', marginRight: '8px' }}>{i + 1}</span>
                  {line}
                </div>
              ))}
            </pre>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '11px', fontWeight: 600, color: '#6b7280',
              padding: '6px 10px', backgroundColor: '#f9fafb', borderRadius: '6px 6px 0 0',
              borderBottom: '1px solid #e5e7eb',
            }}>
              Remote (incoming)
            </div>
            <pre style={{
              margin: 0, padding: '10px', fontSize: '11px', lineHeight: '1.5',
              backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderTop: 'none',
              borderRadius: '0 0 6px 6px', overflow: 'auto', maxHeight: '340px',
              fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#374151',
            }}>
              {remoteLines.slice(0, maxLines).map((line, i) => (
                <div key={i} style={{
                  backgroundColor: i < canvasLines.length && line !== canvasLines[i] ? '#dcfce7' : 'transparent',
                  padding: '0 4px',
                }}>
                  <span style={{ color: '#9ca3af', userSelect: 'none', display: 'inline-block', width: '32px', textAlign: 'right', marginRight: '8px' }}>{i + 1}</span>
                  {line}
                </div>
              ))}
            </pre>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onDismiss}
          style={{
            flex: 1, padding: '8px 12px', fontSize: '12px', fontWeight: 600,
            border: '1px solid #d1d5db', borderRadius: '6px',
            backgroundColor: 'white', color: '#374151', cursor: 'pointer',
          }}
        >
          Back
        </button>
        {hasChanges && canAccept && (
          <button
            onClick={onAccept}
            style={{
              flex: 1, padding: '8px 12px', fontSize: '12px', fontWeight: 600,
              border: 'none', borderRadius: '6px',
              backgroundColor: '#059669', color: 'white', cursor: 'pointer',
            }}
          >
            Accept Remote Version
          </button>
        )}
      </div>
    </div>
  );
}

function ActionButton({ icon, label, description, color, onClick }: {
  icon: React.ReactNode; label: string; description: string; color: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '14px 16px', border: '1px solid #e5e7eb', borderRadius: '10px',
      background: 'white', cursor: 'pointer', textAlign: 'left', width: '100%',
      transition: 'border-color 0.15s',
    }}>
      <div style={{
        width: '36px', height: '36px', borderRadius: '8px',
        backgroundColor: color + '12', display: 'flex',
        alignItems: 'center', justifyContent: 'center', color,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '14px', fontWeight: '500', color: '#111827' }}>{label}</div>
        <div style={{ fontSize: '12px', color: '#6b7280' }}>{description}</div>
      </div>
    </button>
  );
}

function SetupView({ provider, onProviderChange, repoOwner, onRepoOwnerChange, repoName, onRepoNameChange, defaultBranch, onDefaultBranchChange, accessToken, onAccessTokenChange, baseUrl, onBaseUrlChange, saving, hasExisting, onSave, gitService }: {
  provider: Provider; onProviderChange: (p: Provider) => void;
  repoOwner: string; onRepoOwnerChange: (v: string) => void;
  repoName: string; onRepoNameChange: (v: string) => void;
  defaultBranch: string; onDefaultBranchChange: (v: string) => void;
  accessToken: string; onAccessTokenChange: (v: string) => void;
  baseUrl: string; onBaseUrlChange: (v: string) => void;
  saving: boolean; hasExisting: boolean; onSave: () => void;
  gitService: GitService;
}) {
  const canSave = repoOwner && repoName && accessToken;

  // Owner 2026-07-30 (setup UX): select instead of hand-typing. Both pickers are
  // OPTIONAL sugar over the text inputs — a fine-grained token whose repo list
  // reads empty, or a browse failure, degrades to exactly the old manual form.
  // Selecting a repo also has ZERO side effects beyond filling the form fields
  // (no baselines, no writes — the R2.2 connect ladder and push guard own
  // brownfield safety when Save runs, same as manual entry).
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [repoOptions, setRepoOptions] = useState<Array<{ owner: string; name: string; fullName: string; defaultBranch: string; isPrivate: boolean }> | null>(null);
  const [branchOptions, setBranchOptions] = useState<string[] | null>(null);
  const [detectingBranches, setDetectingBranches] = useState(false);

  const handleBrowseRepos = async () => {
    setBrowsing(true);
    setBrowseError(null);
    try {
      const repos = await gitService.listRemoteRepositories(provider, accessToken, baseUrl || undefined);
      setRepoOptions(repos);
      if (repos.length === 0) setBrowseError('The token sees no repositories — fine-grained tokens list only the repos they were granted. Type the owner/name manually below.');
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Repository browse failed');
    } finally {
      setBrowsing(false);
    }
  };

  const handleDetectBranches = async (owner = repoOwner, name = repoName) => {
    if (!owner || !name) return;
    setDetectingBranches(true);
    setBrowseError(null);
    try {
      const { branches, defaultBranch: providerDefault } = await gitService.listRemoteBranches(provider, accessToken, owner, name, baseUrl || undefined);
      setBranchOptions(branches);
      // Preselect the PROVIDER's default (main/master/whatever the repo says) —
      // never invent one; brownfield repos keep their own truth.
      if (providerDefault) onDefaultBranchChange(providerDefault);
    } catch (err) {
      setBranchOptions(null);
      setBrowseError(err instanceof Error ? err.message : 'Branch detection failed');
    } finally {
      setDetectingBranches(false);
    }
  };

  const handleRepoSelect = (fullName: string) => {
    const repo = repoOptions?.find(r => r.fullName === fullName);
    if (!repo) return;
    onRepoOwnerChange(repo.owner);
    onRepoNameChange(repo.name);
    if (repo.defaultBranch) onDefaultBranchChange(repo.defaultBranch);
    void handleDetectBranches(repo.owner, repo.name);
  };

  return (
    <div>
      <label style={labelStyle}>Provider</label>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {(['github', 'gitlab'] as const).map((p) => (
          <button key={p} onClick={() => { onProviderChange(p); setRepoOptions(null); setBranchOptions(null); setBrowseError(null); }} style={{
            flex: 1, padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '500',
            border: `1.5px solid ${provider === p ? (p === 'github' ? '#111827' : '#ea580c') : '#e5e7eb'}`,
            backgroundColor: provider === p ? (p === 'github' ? '#111827' : '#ea580c') : '#f9fafb',
            color: provider === p ? 'white' : '#374151',
            transition: 'all 0.15s',
          }}>
            {p === 'github' ? 'GitHub' : 'GitLab'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>Repository</label>
        <button
          onClick={handleBrowseRepos}
          disabled={!accessToken || browsing}
          title={accessToken ? 'List the repositories this token can see' : 'Enter the access token below first'}
          style={{
            padding: '4px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
            border: '1px solid #d1d5db', backgroundColor: 'white', color: !accessToken || browsing ? '#9ca3af' : '#374151',
            cursor: !accessToken || browsing ? 'not-allowed' : 'pointer',
          }}
        >
          {browsing ? 'Loading…' : 'Browse repositories'}
        </button>
      </div>
      {repoOptions && repoOptions.length > 0 && (
        <select
          value={repoOwner && repoName ? `${repoOwner}/${repoName}` : ''}
          onChange={(e) => handleRepoSelect(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="" disabled>Select a repository…</option>
          {repoOptions.map(r => (
            <option key={r.fullName} value={r.fullName}>{r.fullName}{r.isPrivate ? ' (private)' : ''}</option>
          ))}
        </select>
      )}
      {browseError && (
        <div style={{ fontSize: '12px', color: '#dc2626', marginBottom: '10px' }}>{browseError}</div>
      )}

      <label style={labelStyle}>Repository Owner</label>
      <input type="text" value={repoOwner} onChange={(e) => onRepoOwnerChange(e.target.value)}
        placeholder="username or organization" style={inputStyle} />

      <label style={labelStyle}>Repository Name</label>
      <input type="text" value={repoName} onChange={(e) => onRepoNameChange(e.target.value)}
        placeholder="my-project" style={inputStyle} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>Default Branch</label>
        <button
          onClick={() => void handleDetectBranches()}
          disabled={!accessToken || !repoOwner || !repoName || detectingBranches}
          title={!accessToken ? 'Enter the access token below first' : (!repoOwner || !repoName) ? 'Fill in the repository first' : "List the repo's branches and preselect its default"}
          style={{
            padding: '4px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
            border: '1px solid #d1d5db', backgroundColor: 'white',
            color: !accessToken || !repoOwner || !repoName || detectingBranches ? '#9ca3af' : '#374151',
            cursor: !accessToken || !repoOwner || !repoName || detectingBranches ? 'not-allowed' : 'pointer',
          }}
        >
          {detectingBranches ? 'Detecting…' : 'Detect branches'}
        </button>
      </div>
      {branchOptions && branchOptions.length > 0 ? (
        <select
          value={branchOptions.includes(defaultBranch) ? defaultBranch : ''}
          onChange={(e) => onDefaultBranchChange(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          {!branchOptions.includes(defaultBranch) && <option value="" disabled>Select the default branch…</option>}
          {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      ) : (
        <input type="text" value={defaultBranch} onChange={(e) => onDefaultBranchChange(e.target.value)}
          placeholder="main" style={inputStyle} />
      )}

      <label style={labelStyle}>API Base URL (self-hosted only — leave blank for {provider === 'github' ? 'github.com' : 'gitlab.com'})</label>
      <input type="text" value={baseUrl} onChange={(e) => onBaseUrlChange(e.target.value)}
        placeholder={provider === 'github' ? 'https://ghe.example.com/api/v3' : 'https://gitlab.example.com/api/v4'}
        style={inputStyle} />

      <label style={labelStyle}>
        {hasExisting ? 'New Access Token' : 'Access Token'}
      </label>
      <input type="password" value={accessToken} onChange={(e) => onAccessTokenChange(e.target.value)}
        placeholder={provider === 'github' ? 'ghp_...' : 'glpat_...'}
        style={{ ...inputStyle, fontFamily: 'monospace' }} />
      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '20px', marginTop: '-8px' }}>
        {provider === 'github' ? (
          <>Requires <code style={{ backgroundColor: '#f3f4f6', padding: '1px 4px', borderRadius: '3px', fontSize: '11px' }}>repo</code> scope. <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>Create token</a></>
        ) : (
          <>Requires <code style={{ backgroundColor: '#f3f4f6', padding: '1px 4px', borderRadius: '3px', fontSize: '11px' }}>api</code> scope. Create at GitLab Settings &rarr; Access Tokens</>
        )}
      </div>

      <div style={{
        padding: '10px 14px', backgroundColor: '#eff6ff', borderRadius: '8px', fontSize: '12px',
        color: '#1e40af', marginBottom: '16px', border: '1px solid #bfdbfe',
      }}>
        Your token is encrypted server-side before storage and never returned to the browser.
      </div>

      <button onClick={onSave} disabled={saving || !canSave} style={{
        width: '100%', padding: '11px', backgroundColor: '#111827', color: 'white',
        border: 'none', borderRadius: '8px', cursor: saving || !canSave ? 'not-allowed' : 'pointer',
        fontSize: '14px', fontWeight: '500', opacity: saving || !canSave ? 0.5 : 1,
      }}>
        {saving ? 'Saving...' : hasExisting ? 'Update Integration' : 'Save Integration'}
      </button>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#374151',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', backgroundColor: '#f9fafb',
  border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', color: '#111827',
  marginBottom: '14px', boxSizing: 'border-box',
};

import type { SupabaseClient } from '@supabase/supabase-js';

export interface GitIntegration {
  id: string;
  projectId: string;
  provider: 'github' | 'gitlab';
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  baseUrl: string | null;
  lastSyncAt: string | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  /** B2: client-side auto-accept of content-only change cards (default true). */
  autoSync: boolean;
  /** UX-1.1b: how pushes land — direct commit (default) or a pull request. */
  commitMode: 'direct' | 'pull-request';
}

export interface PulledFile {
  path: string;
  content: string;
  size: number;
  language: string;
}

export interface ArtifactMatch {
  path: string;
  artifactId: string;
  nodeId: string;
  nodeName: string;
  /** R5b: artifact kind rides on the match (a task doc is evidence, not source). */
  kind?: string;
  /** The file was renamed in git; `path` is the NEW location. */
  movedFrom?: string;
}

/** R3-5: one row of `git_sync_log` — what NodeSpec did TO the repository. */
export interface RepoSyncEvent {
  id: string;
  direction: 'push' | 'pull';
  commitSha: string | null;
  status: 'pending' | 'success' | 'failed';
  errorMessage?: string | null;
  patchesSynced?: number | null;
  startedAt: string;
  branchId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface GitChangeEvent {
  id: string;
  commitSha: string;
  commitMessage: string;
  author: string;
  changedFiles: Array<{ path: string; action: 'added' | 'modified' | 'removed' }>;
  status: 'pending' | 'accepted' | 'dismissed';
  branch?: string;
  createdAt: string;
  artifactMatches?: ArtifactMatch[];
  matchError?: string;
  /** R2.2: card provenance — 'sweep' | 'connect-anchor-mismatch' | 'ref-deleted' | undefined (webhook). */
  source?: string;
  /** R3-3c: the NodeSpec branch this card belongs to (legacy cards = main). */
  branchName?: string;
  /** R3-4c: changed files that belong to NO node — the unattributed set awaiting bind/ignore. */
  residuePaths?: string[];
  /** R3-4c: residue paths the user explicitly ignored (persisted on the card). */
  ignoredResidue?: string[];
  /** R3-1: sweep metadata — the range touched .nodespec/model.json (enables Load-from-repo). */
  modelChanged?: boolean;
  /** R5b: acceptance criteria ticked in the changed task docs — evidence awaiting approval. */
  criterionDeltas?: CriterionDeltaPayload;
  /** R5c: this card's criteria were already applied (prevents a double-apply). */
  criteriaApplied?: { at: string; count: number };
  /** A4: anchored implementation-task ticks in the changed task docs. */
  taskDeltas?: TaskDeltaPayload;
  /** A5: this card's task ticks were already applied. */
  ticksApplied?: { at: string; count: number };
  /** B3: resolved `.nodespec/bindings.json` declarations riding this card. */
  bindingResolution?: BindingResolutionPayload;
  /** R7c: the range touched .nodespec/spec.json — the card offers a requirements load. */
  specChanged?: boolean;
  /** R7c: entity-level spec diff (project → repo: what LOADING would do to your requirements). */
  specDiff?: CappedSpecDiff;
  /** R3-2: entity-level anchor diff (project → repo direction: what LOADING would do). */
  modelDiff?: CappedModelDiff;
}

/**
 * R5b: hand-mirrored from `_shared/criterion-deltas.ts` — change the two together.
 * `untick` deltas are REPORTED but never applied (a stale doc must not retract
 * evidence something else proved).
 */
/** B3: server-resolved declarations from `.nodespec/bindings.json`. */
export interface BindingResolutionPayload {
  bind: Array<{ path: string; node: string; nodeId: string; kind: string; language?: string; description?: string }>;
  alreadyBound: Array<{ path: string; node: string; kind: string }>;
  flagged: Array<{ reason: string; detail: string }>;
}

/** A4: the task-checkbox counterpart of CriterionDeltaPayload. */
export interface TaskDeltaPayload {
  deltas: Array<{ nodeId: string; key: string; displayId: string; title: string; direction: 'tick' | 'untick' }>;
  flagged: Array<{ title: string; reason: string }>;
}

export interface CriterionDeltaPayload {
  deltas: Array<{ requirementId: string; text: string; direction: 'tick' | 'untick' }>;
  flagged: Array<{ requirementId: string; text: string; reason: string }>;
}

export interface CappedDiffBucket {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  added: string[];
  removed: string[];
  changed: string[];
}

export interface CappedModelDiff {
  identical: boolean;
  nodes: CappedDiffBucket;
  edges: CappedDiffBucket;
  contracts: CappedDiffBucket;
  artifacts: CappedDiffBucket;
}

/**
 * R7c: hand-mirrored from `_shared/spec-anchor.ts` CappedSpecDiff — change the
 * two together (same standing caveat as CappedModelDiff above).
 */
export interface CappedSpecDiff {
  identical: boolean;
  requirements: CappedDiffBucket;
  criteria: { addedCount: number; removedCount: number; added: string[]; removed: string[] };
  visionChanged: boolean;
  mappingsChanged: boolean;
}

export interface PushResult {
  commitSha: string;
  fileCount: number;
  /** Rename/removal cleanup: paths this commit DELETED (old anchor claimed them; the model no longer does). */
  deletedPaths?: string[];
  /** Set when the cleanup lane could not run (e.g. the repo's anchor was hand-merged/unreadable) — deletions from this round are lost and need manual git cleanup. */
  cleanupSkipped?: string;
  /** R7a: `.nodespec/spec.json` travelled with this commit. False = the project has no spec plane to export. */
  specAnchored?: boolean;
  /** UX-1.1b: set when the integration is in pull-request commit mode. */
  commitMode?: 'pull-request';
  prUrl?: string;
  prNumber?: number;
  workBranch?: string;
  /** Byte-identical tree: commitSha is the EXISTING head, no commit was minted (and no PR opened). */
  unchanged?: boolean;
}

/** R2.2: connect-time anchor outcome returned by save-git-integration. */
export interface AnchorAdoptResult {
  detected: boolean;
  proposalId?: string;
  mismatchCardId?: string;
  repoAnchor?: { modelHash: string; nodes: number; edges: number; contracts: number; artifacts: number };
  counts?: { nodes: number; edges: number; contracts: number; artifacts: number };
  skipped?: string;
  /**
   * R7b: the spec plane adopts through its own anchor (`.nodespec/spec.json`) and
   * reports separately — "nodes came in but requirements did not" must be
   * readable, not inferred.
   */
  spec?: SpecAdoptResult;
  /** R3-6: repo branches materialized as design branches on this connect. */
  branchDetect?: BranchDetectResult;
  /** C3: no anchor + empty graph → the server created (or resumed) an import
   *  job for the brownfield entry; the client drives its stages. */
  importJob?: { id: string; status: string; resumed?: boolean };
}

/** R3-6: connect-time design-branch detection outcome. */
export interface BranchDetectResult {
  created: Array<{ name: string; nodes: number }>;
  skipped: Array<{ name: string; reason: string }>;
  capped?: number;
}

export interface SpecAdoptResult {
  detected: boolean;
  specId?: string;
  counts?: { requirements: number; criteria: number; mappings: number };
  /** Mappings dropped because their requirement or node was not present. */
  skippedMappings?: number;
  skipped?: string;
}

/** R2.2: thrown by push() when the unbaselined-push overwrite guard fires (HTTP 409). */
export class PushOverwriteBlockedError extends Error {
  readonly reason?: string;
  readonly repoAnchor?: AnchorAdoptResult['repoAnchor'];
  constructor(message: string, reason?: string, repoAnchor?: AnchorAdoptResult['repoAnchor']) {
    super(message);
    this.name = 'PushOverwriteBlockedError';
    this.reason = reason;
    this.repoAnchor = repoAnchor;
  }
}

export interface PullResult {
  files: PulledFile[];
  fileCount: number;
  totalMatched: number;
  truncated: boolean;
}

export interface RawTreeScanEntry {
  path: string;
  size: number;
}

export interface TreeScanResponse {
  entries: RawTreeScanEntry[];
  totalEntries: number;
  truncated: boolean;
}

export interface SelectiveFetchResult {
  files: PulledFile[];
  fetchedCount: number;
  requestedCount: number;
  truncatedFiles: string[];
}

export class GitService {
  private supabase: SupabaseClient;
  private baseUrl: string;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.baseUrl = import.meta.env.VITE_SUPABASE_URL;
  }

  private async callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const makeRequest = async (token: string) => {
      const response = await fetch(`${this.baseUrl}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return response;
    };

    const { data: { session } } = await this.supabase.auth.getSession();
    if (!session) {
      throw new Error('Not authenticated. Please sign in again.');
    }

    let response = await makeRequest(session.access_token);

    if (response.status === 401) {
      const { data: { session: refreshed } } = await this.supabase.auth.refreshSession();
      if (!refreshed) {
        throw new Error('Session expired. Please sign in again.');
      }
      response = await makeRequest(refreshed.access_token);
    }

    const responseData = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(responseData.error || responseData.msg || responseData.message || `${name} failed (${response.status})`);
    }
    return responseData as T;
  }

  async getIntegration(projectId: string): Promise<GitIntegration | null> {
    const { data, error } = await this.supabase
      .from('git_integrations')
      .select('id, project_id, provider, repo_owner, repo_name, default_branch, base_url, last_sync_at, sync_status, auto_sync, commit_mode')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      id: data.id,
      projectId: data.project_id,
      provider: data.provider,
      repoOwner: data.repo_owner,
      repoName: data.repo_name,
      defaultBranch: data.default_branch,
      baseUrl: data.base_url ?? null,
      lastSyncAt: data.last_sync_at,
      syncStatus: data.sync_status,
      // Rows read before the 20260815160000 migration applies report undefined;
      // treat as the default (on) so behavior matches the column default.
      autoSync: data.auto_sync !== false,
      // Only an explicit opt-in reads as PR mode — pre-migration rows stay direct.
      commitMode: data.commit_mode === 'pull-request' ? 'pull-request' : 'direct',
    };
  }

  /** B2: flip the per-integration auto-sync flag (Settings row in the Git panel). */
  async setCommitMode(integrationId: string, mode: 'direct' | 'pull-request'): Promise<void> {
    const { error } = await this.supabase
      .from('git_integrations')
      .update({ commit_mode: mode })
      .eq('id', integrationId);
    if (error) throw new Error(`Failed to update commit mode: ${error.message}`);
  }

  async setAutoSync(integrationId: string, enabled: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('git_integrations')
      .update({ auto_sync: enabled })
      .eq('id', integrationId);
    if (error) throw error;
  }

  /**
   * Owner 2026-07-30 (setup UX): browse the token's visible repositories so the
   * user SELECTS instead of hand-typing owner/name. Called ONLY at setup time,
   * straight from the browser with the token the user just typed into the form
   * (it is already in client memory; both provider APIs are CORS-open) — the
   * stored token stays server-side-only as before. Read-only provider calls.
   */
  async listRemoteRepositories(provider: string, accessToken: string, baseUrl?: string): Promise<Array<{ owner: string; name: string; fullName: string; defaultBranch: string; isPrivate: boolean }>> {
    if (provider === 'github') {
      const base = (baseUrl && baseUrl.trim()) || 'https://api.github.com';
      const resp = await fetch(`${base.replace(/\/$/, '')}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github+json' },
      });
      if (!resp.ok) throw new Error(`GitHub repository list failed (${resp.status}) — check the token's scopes`);
      const rows = await resp.json() as Array<{ name: string; full_name: string; default_branch: string; private: boolean; owner: { login: string } }>;
      return rows.map(r => ({ owner: r.owner.login, name: r.name, fullName: r.full_name, defaultBranch: r.default_branch, isPrivate: r.private }));
    }
    if (provider === 'gitlab') {
      const base = (baseUrl && baseUrl.trim()) || 'https://gitlab.com/api/v4';
      const resp = await fetch(`${base.replace(/\/$/, '')}/projects?membership=true&per_page=100&order_by=last_activity_at`, {
        headers: { 'PRIVATE-TOKEN': accessToken },
      });
      if (!resp.ok) throw new Error(`GitLab project list failed (${resp.status}) — check the token's scopes`);
      const rows = await resp.json() as Array<{ path: string; path_with_namespace: string; default_branch: string; visibility: string; namespace: { full_path: string } }>;
      return rows.map(r => ({
        owner: r.namespace.full_path,
        name: r.path,
        fullName: r.path_with_namespace,
        defaultBranch: r.default_branch || 'main',
        isPrivate: r.visibility !== 'public',
      }));
    }
    throw new Error(`Unsupported provider: ${provider}`);
  }

  /** Owner 2026-07-30 (setup UX): list a repository's branches + its provider default, for the default-branch select. Read-only. */
  async listRemoteBranches(provider: string, accessToken: string, owner: string, repo: string, baseUrl?: string): Promise<{ branches: string[]; defaultBranch: string | null }> {
    if (provider === 'github') {
      const base = ((baseUrl && baseUrl.trim()) || 'https://api.github.com').replace(/\/$/, '');
      const headers = { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github+json' };
      const [branchesResp, repoResp] = await Promise.all([
        fetch(`${base}/repos/${owner}/${repo}/branches?per_page=100`, { headers }),
        fetch(`${base}/repos/${owner}/${repo}`, { headers }),
      ]);
      if (!branchesResp.ok) throw new Error(`Branch list failed (${branchesResp.status}) — check owner/name and token access`);
      const branches = (await branchesResp.json() as Array<{ name: string }>).map(b => b.name);
      const defaultBranch = repoResp.ok ? ((await repoResp.json()).default_branch ?? null) : null;
      return { branches, defaultBranch };
    }
    if (provider === 'gitlab') {
      const base = ((baseUrl && baseUrl.trim()) || 'https://gitlab.com/api/v4').replace(/\/$/, '');
      const headers = { 'PRIVATE-TOKEN': accessToken };
      const projectId = encodeURIComponent(`${owner}/${repo}`);
      const [branchesResp, projResp] = await Promise.all([
        fetch(`${base}/projects/${projectId}/repository/branches?per_page=100`, { headers }),
        fetch(`${base}/projects/${projectId}`, { headers }),
      ]);
      if (!branchesResp.ok) throw new Error(`Branch list failed (${branchesResp.status}) — check owner/name and token access`);
      const branches = (await branchesResp.json() as Array<{ name: string }>).map(b => b.name);
      const defaultBranch = projResp.ok ? ((await projResp.json()).default_branch ?? null) : null;
      return { branches, defaultBranch };
    }
    throw new Error(`Unsupported provider: ${provider}`);
  }

  async saveIntegration(projectId: string, config: {
    provider: string;
    repoOwner: string;
    repoName: string;
    defaultBranch: string;
    accessToken: string;
    baseUrl?: string;
  }): Promise<AnchorAdoptResult> {
    // R2.2: the connect-time anchor outcome is USER-FACING now — a repo carrying a
    // NodeSpec model must be surfaced, never silently proposal'd (the owner's
    // disaster-recovery test connected to a surviving anchor and heard nothing).
    const result = await this.callFunction<{ anchorAdopt?: AnchorAdoptResult; specAdopt?: SpecAdoptResult; branchDetect?: BranchDetectResult }>(
      'save-git-integration',
      { projectId, ...config },
    );
    // R7b: fold the spec outcome onto the same result object so every caller
    // reports both planes from one place. R3-6 adds branch detection.
    return {
      ...(result.anchorAdopt ?? { detected: false }),
      spec: result.specAdopt ?? { detected: false },
      ...(result.branchDetect ? { branchDetect: result.branchDetect } : {}),
    };
  }

  /**
   * @param reason R4: what this push is for (an accepted proposal's title). Becomes
   *   the commit subject; the self-push prefix is prepended SERVER-side and is never
   *   the caller's to supply — a message without it would make NodeSpec read its own
   *   commit as out-of-band drift.
   */
  async push(projectId: string, branchName: string, integrationId: string, confirmOverwrite = false, reason?: string): Promise<PushResult> {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { data: { session } } = await this.supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated. Please sign in again.');
    const response = await fetch(`${this.baseUrl}/functions/v1/git-push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId, branchName, integrationId, confirmOverwrite, ...(reason ? { reason } : {}) }),
    });
    const data = await response.json().catch(() => ({}));
    // R2.2: 409 = the unbaselined-push overwrite guard — a typed error the modal
    // turns into an explicit confirmation, never a generic failure toast.
    if (response.status === 409 && data.requiresOverwriteConfirmation) {
      throw new PushOverwriteBlockedError(data.error || 'Push blocked pending overwrite confirmation', data.reason, data.repoAnchor);
    }
    if (!response.ok) {
      throw new Error(data.error || data.message || `git-push failed (${response.status})`);
    }
    return data as PushResult;
  }

  async pull(integrationId: string, path?: string): Promise<PullResult> {
    return this.callFunction<PullResult>('git-pull', {
      integrationId,
      path,
      mode: 'content-fetch',
    });
  }

  async treeScan(integrationId: string, path?: string): Promise<TreeScanResponse> {
    return this.callFunction<TreeScanResponse>('git-pull', {
      integrationId,
      path,
      mode: 'tree-scan',
    });
  }

  async selectiveFetch(
    integrationId: string,
    paths: string[],
    maxContentLength?: number,
  ): Promise<SelectiveFetchResult> {
    return this.callFunction<SelectiveFetchResult>('git-pull', {
      integrationId,
      mode: 'selective-fetch',
      paths,
      maxContentLength,
    });
  }

  /**
   * R3-1 THE LOADER: restore the graph from the repo's model anchor (git→canvas).
   * Whole-graph replace via a new snapshot; graph_patches are never rewritten.
   * Explicit invocation only — a card button or the blocked-push panel.
   */
  async restoreModel(integrationId: string, branchName?: string): Promise<{
    restored: boolean;
    headSha: string;
    modelHash: string;
    counts: { nodes: number; edges: number; contracts: number; artifacts: number };
    note?: string;
  }> {
    return this.callFunction('git-pull', { integrationId, mode: 'restore-model', ...(branchName ? { branchName } : {}) });
  }

  /**
   * R7c: load `.nodespec/spec.json` from the branch's bound ref. Separate action
   * from restoreModel on purpose — taking the repo's requirements must not force
   * a canvas replacement. An upsert PRESERVES per-criterion `met` for unchanged
   * criterion text (evidence survives), and requirements the repo dropped are
   * reported in `keptLocal`, never deleted.
   */
  /**
   * R5c: apply a card's ticked acceptance criteria to `met`, with provenance.
   * Owner rule: git ticks flow VIA THE CARD — one approval, never silent.
   */
  async applyCriterionDeltas(integrationId: string, changeEventId: string): Promise<{
    success: boolean;
    applied: number;
    requirements: string[];
  }> {
    return this.callFunction('git-pull', { integrationId, mode: 'apply-criteria', changeEventId });
  }

  async restoreSpec(integrationId: string, branchName?: string): Promise<{
    success: boolean;
    mode: 'adopted' | 'applied';
    headSha: string;
    specHash: string;
    counts: { added?: number; updated?: number; criteriaPreserved?: number; requirements?: number; criteria?: number; mappings: number };
    keptLocal?: string[];
  }> {
    return this.callFunction('git-pull', { integrationId, mode: 'restore-spec', ...(branchName ? { branchName } : {}) });
  }

  /**
   * R3-3a: create a REAL git branch for a just-created NodeSpec branch (1:1 ref
   * binding) — branched from the source NodeSpec branch's bound ref. Binds git_ref
   * + baseline on the branch row so its first push/sweep is coherent from birth.
   */
  async createRemoteBranch(projectId: string, integrationId: string, newBranchName: string, fromBranchName = 'main'): Promise<{
    created: boolean;
    ref: string;
    sha: string;
    alreadyExists: boolean;
    fromRef: string;
  }> {
    return this.callFunction('git-push', {
      projectId,
      branchName: newBranchName,
      integrationId,
      action: 'create-branch',
      fromBranchName,
    });
  }

  /** R3-3b: the branch's bound git ref (null = local-only / pre-binding branch). */
  /**
   * R4: is this branch baselined, and against what ref? Auto-push refuses to run on
   * an UNBASELINED branch — the overwrite guard exists for exactly that case and an
   * automatic action must never be the thing that confirms it.
   */
  async getBranchSyncState(projectId: string, branchName: string): Promise<{ gitRef: string | null; lastSyncedCommit: string | null } | null> {
    const { data, error } = await this.supabase
      .from('branches')
      .select('git_ref, last_synced_commit')
      .eq('project_id', projectId)
      .eq('name', branchName)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { gitRef: data.git_ref ?? null, lastSyncedCommit: data.last_synced_commit ?? null };
  }

  async getBranchGitRef(projectId: string, branchName: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('branches')
      .select('git_ref')
      .eq('project_id', projectId)
      .eq('name', branchName)
      .maybeSingle();
    if (error) throw error;
    return data?.git_ref ?? null;
  }

  /**
   * R3-3b: a design merge IS a git merge, and the DEFAULT vehicle is a pull request.
   * Call push() first (the normal lane — guard + freshness gate); this only opens the
   * PR with the entity diff as its body. An already-open PR is a bindable outcome.
   */
  async openPullRequest(projectId: string, branchName: string, integrationId: string, targetBranchName = 'main'): Promise<{
    prUrl: string;
    prNumber?: number;
    alreadyExists: boolean;
    sourceRef: string;
    targetRef: string;
  }> {
    return this.callFunction('git-push', {
      projectId, branchName, integrationId,
      action: 'open-pr', targetBranchName,
    });
  }

  /**
   * R3-3b: the explicit secondary option — a REAL provider merge commit, no PR.
   * Never a DB copy; deletes nothing. `targetInSync` = the target's canvas matched
   * its ref before the merge, so the caller may auto-run restoreModel() on it.
   */
  async mergeBranchDirect(projectId: string, branchName: string, integrationId: string, targetBranchName = 'main'): Promise<{
    merged: boolean;
    mergeSha: string | null;
    alreadyMerged: boolean;
    targetInSync: boolean;
    targetRef: string;
    prUrl?: string;
  }> {
    return this.callFunction('git-push', {
      projectId, branchName, integrationId,
      action: 'merge-direct', targetBranchName,
    });
  }

  /**
   * Owner 2026-07-30 (recovery lane): resolved cards are not gone — their
   * content stays reachable at the recorded commit sha. Newest-first, capped.
   */
  async getResolvedChanges(projectId: string, limit = 6): Promise<GitChangeEvent[]> {
    const { data, error } = await this.supabase
      .from('git_change_events')
      .select('id, commit_sha, commit_message, author, changed_files, status, metadata, created_at')
      .eq('project_id', projectId)
      .in('status', ['accepted', 'dismissed'])
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map((e: any) => this.mapChangeEventRow(e));
  }

  /**
   * R3-5: every card regardless of status, newest-first — the Repository panel
   * needs the resolved ones too, because unbound residue is recorded ON the card
   * and resolving the card never answered the bind question.
   */
  async getRecentChangeEvents(projectId: string, limit = 40): Promise<GitChangeEvent[]> {
    const { data, error } = await this.supabase
      .from('git_change_events')
      .select('id, commit_sha, commit_message, author, changed_files, status, metadata, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map((e: any) => this.mapChangeEventRow(e));
  }

  /**
   * R3-5: the durable record of what NodeSpec did TO the repository — commits
   * pushed and models loaded. Read-only; the panel never writes this table.
   */
  async getRepoSyncEvents(projectId: string, limit = 40): Promise<RepoSyncEvent[]> {
    const { data, error } = await this.supabase
      .from('git_sync_log')
      .select('id, direction, commit_sha, status, error_message, patches_synced, started_at, branch_id, metadata')
      .eq('project_id', projectId)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data || []).map((e: any) => ({
      id: e.id,
      direction: e.direction,
      commitSha: e.commit_sha ?? null,
      status: e.status,
      errorMessage: e.error_message,
      patchesSynced: e.patches_synced,
      startedAt: e.started_at,
      branchId: e.branch_id ?? null,
      metadata: e.metadata ?? {},
    }));
  }

  async getPendingChanges(projectId: string): Promise<GitChangeEvent[]> {
    const { data, error } = await this.supabase
      .from('git_change_events')
      .select('id, commit_sha, commit_message, author, changed_files, status, metadata, created_at')
      .eq('project_id', projectId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((e: any) => this.mapChangeEventRow(e));
  }

  // One row mapper for pending AND resolved reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapChangeEventRow(e: any): GitChangeEvent {
    return {
      id: e.id,
      commitSha: e.commit_sha,
      commitMessage: e.commit_message,
      author: e.author,
      changedFiles: e.changed_files || [],
      status: e.status,
      branch: e.metadata?.branch,
      createdAt: e.created_at,
      artifactMatches: e.metadata?.artifactMatches || [],
      matchError: e.metadata?.matchError,
      source: e.metadata?.source,
      branchName: e.metadata?.branchName,
      residuePaths: e.metadata?.residuePaths || [],
      ignoredResidue: e.metadata?.ignoredResidue || [],
      modelChanged: e.metadata?.modelChanged === true,
      modelDiff: e.metadata?.modelDiff,
      specChanged: e.metadata?.specChanged === true,
      specDiff: e.metadata?.specDiff,
      criterionDeltas: e.metadata?.criterionDeltas,
      criteriaApplied: e.metadata?.criteriaApplied,
      taskDeltas: e.metadata?.taskDeltas,
      ticksApplied: e.metadata?.ticksApplied,
      bindingResolution: e.metadata?.bindingResolution,
    };
  }

  /**
   * R3-4c: persist an "ignore this residue file" decision on the card so it stops
   * counting as unattributed (the sweep's supersede preserves the list).
   */
  async ignoreResidueFile(changeEventId: string, path: string): Promise<void> {
    const { data: event, error: readError } = await this.supabase
      .from('git_change_events')
      .select('id, metadata')
      .eq('id', changeEventId)
      .maybeSingle();
    if (readError) throw readError;
    if (!event) throw new Error('Change event not found');
    const meta = (event.metadata ?? {}) as Record<string, unknown>;
    const ignored = Array.isArray(meta.ignoredResidue) ? (meta.ignoredResidue as string[]) : [];
    if (ignored.includes(path)) return;
    const { error } = await this.supabase
      .from('git_change_events')
      .update({ metadata: { ...meta, ignoredResidue: [...ignored, path] } })
      .eq('id', changeEventId);
    if (error) throw error;
  }

  /**
   * Owner bench 2026-07-29: `branchName` scopes the fetch to that NodeSpec
   * branch's bound git ref — without it the server reads the DEFAULT branch,
   * which silently found nothing for files living on a feature branch
   * (Compare did nothing; Load-from-repo errored).
   * Owner 2026-07-30: `atRef` fetches at an EXACT ref/commit sha — the
   * Recently-resolved recovery lane reads a change's content at the commit the
   * card recorded, even after the branch moved on. atRef wins over branchName.
   */
  async fetchFileContent(integrationId: string, paths: string[], branchName?: string, atRef?: string): Promise<Array<{ path: string; content: string }>> {
    const result = await this.callFunction<{ files: Array<{ path: string; content: string }> }>('git-pull', {
      integrationId,
      mode: 'selective-fetch',
      paths,
      maxContentLength: 500000,
      ...(branchName ? { branchName } : {}),
      ...(atRef ? { ref: atRef } : {}),
    });
    return (result.files || []).map(f => ({ path: f.path, content: f.content }));
  }

  async resolveChangeEvent(changeEventId: string, resolution: 'accepted' | 'dismissed', extraMetadata?: Record<string, unknown>): Promise<void> {
    const { data: { user } } = await this.supabase.auth.getUser();
    const { data: event } = await this.supabase
      .from('git_change_events')
      .select('id, project_id, commit_sha, metadata')
      .eq('id', changeEventId)
      .maybeSingle();

    const { error } = await this.supabase
      .from('git_change_events')
      .update({
        status: resolution,
        resolved_by: user?.id,
        resolved_at: new Date().toISOString(),
        // B2: audit stamps (e.g. autoSynced) fold into the SAME resolve write.
        ...(extraMetadata
          ? { metadata: { ...((event?.metadata as Record<string, unknown>) ?? {}), ...extraMetadata } }
          : {}),
      })
      .eq('id', changeEventId);

    if (error) throw error;

    // P1-7 R2: for SWEEP events, advance the sync baseline on accept AND dismiss — a
    // resolved event's range is dealt with either way, and without this the next sweep
    // re-raises the same commits forever.
    // R2.2: the connect-anchor-mismatch card is DIFFERENT — dismiss means "keep the repo
    // copy protected", so only ACCEPT establishes the baseline there; advancing on
    // dismiss would silently disarm the push overwrite guard. And never write a non-sha
    // sentinel as the baseline (early mismatch cards carried "unknown" on HEAD-fetch failure).
    // R3-3c: advance the baseline on the branch the card BELONGS to (metadata.branchName;
    // legacy cards = main) — the unconditional name='main' write would have stamped a
    // feature branch's sha onto main's baseline. ref-deleted lifecycle cards never touch
    // any baseline (their commit_sha is the old baseline itself, not a new sync point).
    const meta = (event as { metadata?: { source?: string; branchName?: string; unmappedRef?: string } } | null)?.metadata;
    const source = meta?.source;
    if (source === 'ref-deleted') return;
    // R3-4a: a webhook card for a ref no NodeSpec branch is bound to — resolving it
    // must not advance ANY branch's baseline (the old default would have moved main).
    if (!meta?.branchName && meta?.unmappedRef) return;
    if (source === 'connect-anchor-mismatch' && resolution === 'dismissed') return;
    if (event?.commit_sha === 'unknown') return;
    if (event?.commit_sha && event?.project_id) {
      await this.supabase
        .from('branches')
        .update({ last_synced_commit: event.commit_sha })
        .eq('project_id', event.project_id)
        .eq('name', meta?.branchName ?? 'main');
    }
  }

  /**
   * P1-7 R2: trigger the on-connect drift sweep (remote HEAD vs last_synced_commit baseline).
   * Non-fatal by design — the git panel must open even when the provider is unreachable.
   * R3-3c: `branchName` scopes the sweep to that branch's ref; `force` (branch switch —
   * an explicit user ask) skips the server-side throttle.
   */
  async detectDrift(integrationId: string, opts?: { branchName?: string; force?: boolean }): Promise<Record<string, unknown> | null> {
    try {
      const result = await this.callFunction<{ sweep?: Record<string, unknown> }>('git-pull', {
        integrationId,
        mode: 'drift-check',
        ...(opts?.branchName ? { branchName: opts.branchName } : {}),
        ...(opts?.force ? { force: true } : {}),
      });
      // Bench observability (2026-07-19): the sweep's outcome was invisible — "no card" could
      // mean throttled, clean, unbaselined, or a provider error, and nobody could tell which.
      console.log('[GitService] Drift sweep result:', result.sweep ?? null);
      return result.sweep ?? null;
    } catch (err) {
      console.warn('[GitService] Drift sweep call failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async getSyncHistory(integrationId: string, limit = 10): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('git_sync_log')
      .select('id, direction, commit_sha, status, error_message, patches_synced, started_at, completed_at')
      .eq('integration_id', integrationId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }
}

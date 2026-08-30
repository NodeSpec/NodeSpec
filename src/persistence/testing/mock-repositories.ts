import type {
  ProjectRepository,
  BranchRepository,
  GraphRepository,
  PatchRepository,
  ArtifactRepository,
  AIRunRepository,
  ProposalRepository,
  RepositoryFactory,
} from '../ports.js';
import type {
  Project,
  PersistedBranch,
  PersistedSnapshot,
  PersistedPatch,
  PersistedArtifact,
  AIRun,
  RepositoryResult,
  RealtimeSubscription,
  PatchEvent,
} from '../types.js';
import { generateUUID, now } from '@nodespec/core/utils.js';

export function createMockProjectRepository(): ProjectRepository & { _data: Map<string, Project> } {
  const data = new Map<string, Project>();

  return {
    _data: data,

    async create(name, ownerId, metadata): Promise<RepositoryResult<Project>> {
      const project: Project = {
        id: generateUUID(),
        name,
        ownerId,
        createdAt: now(),
        updatedAt: now(),
        metadata,
      };
      data.set(project.id, project);
      return { success: true, data: project };
    },

    async getById(id): Promise<RepositoryResult<Project | null>> {
      return { success: true, data: data.get(id) ?? null };
    },

    async listByOwner(ownerId): Promise<RepositoryResult<Project[]>> {
      const projects = Array.from(data.values()).filter((p) => p.ownerId === ownerId);
      return { success: true, data: projects };
    },

    async update(id, updates): Promise<RepositoryResult<Project>> {
      const project = data.get(id);
      if (!project) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } };
      }
      const updated = { ...project, ...updates, updatedAt: now() };
      data.set(id, updated);
      return { success: true, data: updated };
    },

    async delete(id): Promise<RepositoryResult<void>> {
      data.delete(id);
      return { success: true, data: undefined };
    },
  };
}

export function createMockBranchRepository(): BranchRepository & { _data: Map<string, PersistedBranch> } {
  const data = new Map<string, PersistedBranch>();

  return {
    _data: data,

    async create(projectId, name, createdBy, baseSnapshotId, metadata, isPrimary): Promise<RepositoryResult<PersistedBranch>> {
      const existing = Array.from(data.values()).find(
        (b) => b.projectId === projectId && b.name === name
      );
      if (existing) {
        return { success: false, error: { code: 'DUPLICATE', message: 'Branch name already exists' } };
      }

      const branch: PersistedBranch = {
        id: generateUUID(),
        projectId,
        name,
        isPrimary: isPrimary === true || name === 'main',
        baseSnapshotId: baseSnapshotId ?? null,
        createdAt: now(),
        createdBy,
        metadata,
      };
      data.set(branch.id, branch);
      return { success: true, data: branch };
    },

    async getById(id): Promise<RepositoryResult<PersistedBranch | null>> {
      return { success: true, data: data.get(id) ?? null };
    },

    async getByName(projectId, name): Promise<RepositoryResult<PersistedBranch | null>> {
      const branch = Array.from(data.values()).find(
        (b) => b.projectId === projectId && b.name === name
      );
      return { success: true, data: branch ?? null };
    },

    async listByProject(projectId): Promise<RepositoryResult<PersistedBranch[]>> {
      const branches = Array.from(data.values()).filter((b) => b.projectId === projectId);
      return { success: true, data: branches };
    },

    async update(id, updates): Promise<RepositoryResult<PersistedBranch>> {
      const branch = data.get(id);
      if (!branch) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Branch not found' } };
      }
      const updated = { ...branch, ...updates };
      data.set(id, updated);
      return { success: true, data: updated };
    },

    async delete(id): Promise<RepositoryResult<void>> {
      data.delete(id);
      return { success: true, data: undefined };
    },
  };
}

export function createMockGraphRepository(): GraphRepository & { _data: Map<string, PersistedSnapshot> } {
  const data = new Map<string, PersistedSnapshot>();

  return {
    _data: data,

    async loadSnapshot(branchId): Promise<RepositoryResult<PersistedSnapshot | null>> {
      const snapshots = Array.from(data.values())
        .filter((s) => s.branchId === branchId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return { success: true, data: snapshots[0] ?? null };
    },

    async loadSnapshotById(snapshotId): Promise<RepositoryResult<PersistedSnapshot | null>> {
      return { success: true, data: data.get(snapshotId) ?? null };
    },

    async saveSnapshot(projectId, branchId, graph, patchSequence): Promise<RepositoryResult<PersistedSnapshot>> {
      const snapshot: PersistedSnapshot = {
        id: generateUUID(),
        projectId,
        branchId,
        graphData: graph,
        version: graph.version,
        hash: graph.hash,
        createdAt: now(),
        patchSequence,
      };
      data.set(snapshot.id, snapshot);
      return { success: true, data: snapshot };
    },

    async listSnapshots(branchId, limit = 10): Promise<RepositoryResult<PersistedSnapshot[]>> {
      const snapshots = Array.from(data.values())
        .filter((s) => s.branchId === branchId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
      return { success: true, data: snapshots };
    },

    async deleteSnapshot(snapshotId): Promise<RepositoryResult<void>> {
      data.delete(snapshotId);
      return { success: true, data: undefined };
    },
  };
}

export function createMockPatchRepository(): PatchRepository & {
  _data: Map<string, PersistedPatch>;
  _sequences: Map<string, number>;
  _subscribers: Map<string, Set<(event: PatchEvent) => void>>;
} {
  const data = new Map<string, PersistedPatch>();
  const sequences = new Map<string, number>();
  const subscribers = new Map<string, Set<(event: PatchEvent) => void>>();

  function notifySubscribers(branchId: string, patch: PersistedPatch): void {
    const subs = subscribers.get(branchId);
    if (subs) {
      const event: PatchEvent = { type: 'INSERT', patch, timestamp: now() };
      subs.forEach((cb) => cb(event));
    }
  }

  return {
    _data: data,
    _sequences: sequences,
    _subscribers: subscribers,

    async appendPatch(branchId, patch, actorId): Promise<RepositoryResult<PersistedPatch>> {
      if (data.has(patch.metadata.id)) {
        return { success: false, error: { code: 'DUPLICATE_PATCH', message: 'Patch already exists' } };
      }

      const currentSeq = sequences.get(branchId) ?? 0;
      const nextSeq = currentSeq + 1;
      sequences.set(branchId, nextSeq);

      const persisted: PersistedPatch = {
        id: patch.metadata.id,
        branchId,
        sequence: nextSeq,
        patchType: patch.type,
        actorType: patch.metadata.actorType,
        actorId: actorId ?? null,
        summary: patch.metadata.summary,
        payload: patch,
        preconditions: patch.metadata.preconditions,
        createdAt: now(),
        appliedAt: null,
      };

      data.set(persisted.id, persisted);
      notifySubscribers(branchId, persisted);
      return { success: true, data: persisted };
    },

    async appendPatches(branchId, patches, actorId): Promise<RepositoryResult<PersistedPatch[]>> {
      const results: PersistedPatch[] = [];
      for (const patch of patches) {
        const result = await this.appendPatch(branchId, patch, actorId);
        if (!result.success) {
          return result as RepositoryResult<PersistedPatch[]>;
        }
        results.push(result.data);
      }
      return { success: true, data: results };
    },

    async loadPatches(branchId, filter): Promise<RepositoryResult<PersistedPatch[]>> {
      let patches = Array.from(data.values())
        .filter((p) => p.branchId === branchId)
        .sort((a, b) => a.sequence - b.sequence);

      if (filter?.sinceSequence !== undefined) {
        patches = patches.filter((p) => p.sequence > filter.sinceSequence!);
      }

      if (filter?.untilSequence !== undefined) {
        patches = patches.filter((p) => p.sequence <= filter.untilSequence!);
      }

      if (filter?.actorType !== undefined) {
        patches = patches.filter((p) => p.actorType === filter.actorType);
      }

      if (filter?.limit !== undefined) {
        patches = patches.slice(0, filter.limit);
      }

      return { success: true, data: patches };
    },

    async getPatchById(patchId): Promise<RepositoryResult<PersistedPatch | null>> {
      return { success: true, data: data.get(patchId) ?? null };
    },

    async getLatestSequence(branchId): Promise<RepositoryResult<number>> {
      return { success: true, data: sequences.get(branchId) ?? 0 };
    },

    async clearPatches(branchId): Promise<RepositoryResult<void>> {
      const patchesToDelete: string[] = [];
      for (const [patchId, patch] of data.entries()) {
        if (patch.branchId === branchId) {
          patchesToDelete.push(patchId);
        }
      }
      patchesToDelete.forEach(id => data.delete(id));
      sequences.set(branchId, 0);
      return { success: true, data: undefined };
    },

    async markApplied(patchId): Promise<RepositoryResult<void>> {
      const patch = data.get(patchId);
      if (patch) {
        patch.appliedAt = now();
      }
      return { success: true, data: undefined };
    },

    subscribeToPatchStream(branchId, onPatch, sinceSequence): RealtimeSubscription {
      if (!subscribers.has(branchId)) {
        subscribers.set(branchId, new Set());
      }

      const wrappedCallback = (event: PatchEvent) => {
        if (sinceSequence === undefined || event.patch.sequence > sinceSequence) {
          onPatch(event);
        }
      };

      subscribers.get(branchId)!.add(wrappedCallback);

      return {
        unsubscribe: () => {
          subscribers.get(branchId)?.delete(wrappedCallback);
        },
      };
    },
  };
}

export function createMockArtifactRepository(): ArtifactRepository & { _data: Map<string, PersistedArtifact> } {
  const data = new Map<string, PersistedArtifact>();

  return {
    _data: data,

    async saveArtifact(projectId, artifact): Promise<RepositoryResult<PersistedArtifact>> {
      if (data.has(artifact.id)) {
        return { success: false, error: { code: 'DUPLICATE_ARTIFACT', message: 'Artifact already exists' } };
      }

      const persisted: PersistedArtifact = {
        ...artifact,
        projectId,
        createdAt: now(),
        updatedAt: now(),
      };
      data.set(persisted.id, persisted);
      return { success: true, data: persisted };
    },

    async loadArtifact(artifactId): Promise<RepositoryResult<PersistedArtifact | null>> {
      return { success: true, data: data.get(artifactId) ?? null };
    },

    async loadArtifacts(projectId, artifactIds): Promise<RepositoryResult<PersistedArtifact[]>> {
      let artifacts = Array.from(data.values()).filter((a) => a.projectId === projectId);

      if (artifactIds && artifactIds.length > 0) {
        const idSet = new Set(artifactIds);
        artifacts = artifacts.filter((a) => idSet.has(a.id));
      }

      return { success: true, data: artifacts };
    },

    async loadByNodeId(nodeId): Promise<RepositoryResult<PersistedArtifact[]>> {
      const artifacts = Array.from(data.values()).filter((a) => a.nodeId === nodeId);
      return { success: true, data: artifacts };
    },

    async loadByBranchId(branchId): Promise<RepositoryResult<PersistedArtifact[]>> {
      const artifacts = Array.from(data.values()).filter((a) => a.branchId === branchId);
      return { success: true, data: artifacts };
    },

    async searchByLanguage(projectId, language): Promise<RepositoryResult<PersistedArtifact[]>> {
      const artifacts = Array.from(data.values()).filter(
        (a) => a.projectId === projectId && a.language === language
      );
      return { success: true, data: artifacts };
    },

    async searchByPath(projectId, pathPattern): Promise<RepositoryResult<PersistedArtifact[]>> {
      const regex = new RegExp(pathPattern.replace(/%/g, '.*'), 'i');
      const artifacts = Array.from(data.values()).filter(
        (a) => a.projectId === projectId && regex.test(a.path)
      );
      return { success: true, data: artifacts };
    },

    async deleteArtifact(artifactId): Promise<RepositoryResult<void>> {
      data.delete(artifactId);
      return { success: true, data: undefined };
    },

    async updateArtifact(artifactId, updates): Promise<RepositoryResult<PersistedArtifact>> {
      const artifact = data.get(artifactId);
      if (!artifact) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'Artifact not found' } };
      }
      const updated = { ...artifact, ...updates, updatedAt: now() };
      data.set(artifactId, updated);
      return { success: true, data: updated };
    },
  };
}

export function createMockAIRunRepository(): AIRunRepository & { _data: Map<string, AIRun> } {
  const data = new Map<string, AIRun>();

  return {
    _data: data,

    async create(projectId, branchId, model, promptHash, inputSnapshotId, metadata): Promise<RepositoryResult<AIRun>> {
      const run: AIRun = {
        id: generateUUID(),
        projectId,
        branchId,
        model,
        promptHash,
        status: 'pending',
        startedAt: now(),
        completedAt: null,
        inputSnapshotId: inputSnapshotId ?? null,
        outputPatches: null,
        metadata,
      };
      data.set(run.id, run);
      return { success: true, data: run };
    },

    async getById(id): Promise<RepositoryResult<AIRun | null>> {
      return { success: true, data: data.get(id) ?? null };
    },

    async listByBranch(branchId, limit = 20): Promise<RepositoryResult<AIRun[]>> {
      const runs = Array.from(data.values())
        .filter((r) => r.branchId === branchId)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .slice(0, limit);
      return { success: true, data: runs };
    },

    async updateStatus(id, status, outputPatches): Promise<RepositoryResult<AIRun>> {
      const run = data.get(id);
      if (!run) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'AI run not found' } };
      }
      run.status = status;
      if (status === 'completed' || status === 'failed') {
        run.completedAt = now();
      }
      if (outputPatches !== undefined) {
        run.outputPatches = outputPatches;
      }
      return { success: true, data: run };
    },

    async markCompleted(id, outputPatches): Promise<RepositoryResult<AIRun>> {
      return this.updateStatus(id, 'completed', outputPatches);
    },

    async markFailed(id, metadata): Promise<RepositoryResult<AIRun>> {
      const run = data.get(id);
      if (!run) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'AI run not found' } };
      }
      run.status = 'failed';
      run.completedAt = now();
      run.metadata = { ...run.metadata, ...metadata };
      return { success: true, data: run };
    },
  };
}

function createMockProposalRepository(): ProposalRepository {
  return {
    create: async (proposal) => ({ success: true as const, data: proposal }),
    getById: async () => ({ success: true as const, data: null }),
    getByAIRunId: async () => ({ success: true as const, data: null }),
    listByBranch: async () => ({ success: true as const, data: [] }),
    updateStatus: async (proposalId, status) => ({
      success: true as const,
      data: { id: proposalId, status } as any,
    }),
    updatePatches: async (proposalId, patches) => ({
      success: true as const,
      data: { id: proposalId, patches } as any,
    }),
    markReviewed: async (proposalId) => ({
      success: true as const,
      data: { id: proposalId } as any,
    }),
    markMerged: async (proposalId) => ({
      success: true as const,
      data: { id: proposalId, status: 'merged' } as any,
    }),
    delete: async () => ({ success: true as const, data: undefined }),
  };
}

function createMockCodeStructureRepository() {
  return {
    getByArtifactId: async () => null,
    getByNodeId: async () => [],
    getByProjectId: async () => [],
    update: async (_id: string, updates: any) => updates as any,
    delete: async () => {},
  };
}

function createMockTemplateRepository() {
  return {
    getById: async () => ({ success: true as const, data: null }),
    getBySlug: async () => ({ success: true as const, data: null }),
    list: async () => ({ success: true as const, data: [] }),
    listByAuthor: async () => ({ success: true as const, data: [] }),
    create: async (t: any) => ({ success: true as const, data: { ...t, id: crypto.randomUUID(), useCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }),
    update: async (_id: string, updates: any) => ({ success: true as const, data: updates }),
    delete: async () => ({ success: true as const, data: undefined }),
    recordUsage: async (templateId: string, userId: string, projectId?: string) => ({ success: true as const, data: { id: crypto.randomUUID(), templateId, userId, projectId: projectId ?? null, createdAt: new Date().toISOString() } }),
    getUsageByUser: async () => ({ success: true as const, data: [] }),
  };
}

export function createMockRepositoryFactory(): RepositoryFactory {
  return {
    createProjectRepository: () => createMockProjectRepository(),
    createBranchRepository: () => createMockBranchRepository(),
    createGraphRepository: () => createMockGraphRepository(),
    createPatchRepository: () => createMockPatchRepository(),
    createArtifactRepository: () => createMockArtifactRepository(),
    createAIRunRepository: () => createMockAIRunRepository(),
    createProposalRepository: () => createMockProposalRepository(),
    createCodeStructureRepository: () => createMockCodeStructureRepository(),
    createTemplateRepository: () => createMockTemplateRepository(),
    createSpecificationRepository: () => ({} as any),
    createRequirementsRepository: () => ({} as any),
    createSectionsRepository: () => ({} as any),
    createRequirementRelationsRepository: () => ({} as any),
    createMappingsRepository: () => ({} as any),
  };
}

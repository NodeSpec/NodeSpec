import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import type {
  Project,
  PersistedBranch,
  PersistedSnapshot,
  PersistedPatch,
  PersistedArtifact,
  AIRun,
  PatchFilter,
  RepositoryResult,
  RealtimeSubscription,
  PatchEvent,
  ProjectTemplate,
  TemplateUsage,
  TemplateFilters,
} from './types.js';
import type { AIProposal, ProposalPatch, ProposalStatus } from '@nodespec/core/ai-proposal.js';
import type { CodeStructure } from '@nodespec/core/code-structure.js';

export interface ProjectRepository {
  create(name: string, ownerId: string, metadata?: Record<string, unknown>): Promise<RepositoryResult<Project>>;
  getById(id: string): Promise<RepositoryResult<Project | null>>;
  listByOwner(ownerId: string): Promise<RepositoryResult<Project[]>>;
  update(id: string, updates: Partial<Pick<Project, 'name' | 'metadata'>>): Promise<RepositoryResult<Project>>;
  delete(id: string): Promise<RepositoryResult<void>>;
}

export interface BranchRepository {
  create(
    projectId: string,
    name: string,
    createdBy: string,
    baseSnapshotId?: string,
    metadata?: Record<string, unknown>,
    isPrimary?: boolean
  ): Promise<RepositoryResult<PersistedBranch>>;

  getById(id: string): Promise<RepositoryResult<PersistedBranch | null>>;
  getByName(projectId: string, name: string): Promise<RepositoryResult<PersistedBranch | null>>;
  listByProject(projectId: string): Promise<RepositoryResult<PersistedBranch[]>>;
  update(id: string, updates: Partial<Pick<PersistedBranch, 'name' | 'baseSnapshotId' | 'metadata'>>): Promise<RepositoryResult<PersistedBranch>>;
  delete(id: string): Promise<RepositoryResult<void>>;
}

export interface GraphRepository {
  loadSnapshot(branchId: string): Promise<RepositoryResult<PersistedSnapshot | null>>;
  loadSnapshotById(snapshotId: string): Promise<RepositoryResult<PersistedSnapshot | null>>;

  saveSnapshot(
    projectId: string,
    branchId: string,
    graph: Graph,
    patchSequence: number
  ): Promise<RepositoryResult<PersistedSnapshot>>;

  listSnapshots(branchId: string, limit?: number): Promise<RepositoryResult<PersistedSnapshot[]>>;
  deleteSnapshot(snapshotId: string): Promise<RepositoryResult<void>>;
}

export interface PatchRepository {
  appendPatch(
    branchId: string,
    patch: PatchOperation,
    actorId?: string
  ): Promise<RepositoryResult<PersistedPatch>>;

  appendPatches(
    branchId: string,
    patches: PatchOperation[],
    actorId?: string
  ): Promise<RepositoryResult<PersistedPatch[]>>;

  loadPatches(branchId: string, filter?: PatchFilter): Promise<RepositoryResult<PersistedPatch[]>>;
  getPatchById(patchId: string): Promise<RepositoryResult<PersistedPatch | null>>;
  getLatestSequence(branchId: string): Promise<RepositoryResult<number>>;
  clearPatches(branchId: string): Promise<RepositoryResult<void>>;

  markApplied(patchId: string): Promise<RepositoryResult<void>>;

  subscribeToPatchStream(
    branchId: string,
    onPatch: (event: PatchEvent) => void,
    sinceSequence?: number
  ): RealtimeSubscription;
}

export interface ArtifactRepository {
  saveArtifact(
    projectId: string,
    artifact: Omit<PersistedArtifact, 'projectId' | 'createdAt' | 'updatedAt'>
  ): Promise<RepositoryResult<PersistedArtifact>>;

  loadArtifact(artifactId: string): Promise<RepositoryResult<PersistedArtifact | null>>;
  loadArtifacts(projectId: string, artifactIds?: string[]): Promise<RepositoryResult<PersistedArtifact[]>>;
  loadByNodeId(nodeId: string): Promise<RepositoryResult<PersistedArtifact[]>>;
  loadByBranchId(branchId: string): Promise<RepositoryResult<PersistedArtifact[]>>;
  searchByLanguage(projectId: string, language: string): Promise<RepositoryResult<PersistedArtifact[]>>;
  searchByPath(projectId: string, pathPattern: string): Promise<RepositoryResult<PersistedArtifact[]>>;
  deleteArtifact(artifactId: string): Promise<RepositoryResult<void>>;
  updateArtifact(artifactId: string, updates: Partial<PersistedArtifact>): Promise<RepositoryResult<PersistedArtifact>>;
}

export interface AIRunRepository {
  create(
    projectId: string,
    branchId: string,
    model: string,
    promptHash: string,
    inputSnapshotId?: string,
    metadata?: Record<string, unknown>
  ): Promise<RepositoryResult<AIRun>>;

  getById(id: string): Promise<RepositoryResult<AIRun | null>>;
  listByBranch(branchId: string, limit?: number): Promise<RepositoryResult<AIRun[]>>;

  updateStatus(
    id: string,
    status: AIRun['status'],
    outputPatches?: string[]
  ): Promise<RepositoryResult<AIRun>>;

  markCompleted(id: string, outputPatches: string[]): Promise<RepositoryResult<AIRun>>;
  markFailed(id: string, metadata?: Record<string, unknown>): Promise<RepositoryResult<AIRun>>;
}

export interface ProposalRepository {
  create(proposal: AIProposal): Promise<RepositoryResult<AIProposal>>;
  getById(proposalId: string): Promise<RepositoryResult<AIProposal | null>>;
  getByAIRunId(aiRunId: string): Promise<RepositoryResult<AIProposal | null>>;
  listByBranch(branchId: string, status?: ProposalStatus): Promise<RepositoryResult<AIProposal[]>>;
  updateStatus(proposalId: string, status: ProposalStatus): Promise<RepositoryResult<AIProposal>>;
  updatePatches(proposalId: string, patches: ProposalPatch[]): Promise<RepositoryResult<AIProposal>>;
  markReviewed(proposalId: string): Promise<RepositoryResult<AIProposal>>;
  markMerged(proposalId: string): Promise<RepositoryResult<AIProposal>>;
  delete(proposalId: string): Promise<RepositoryResult<void>>;
}

export interface CodeStructureRepository {
  getByArtifactId(artifactId: string): Promise<CodeStructure | null>;
  getByNodeId(nodeId: string): Promise<CodeStructure[]>;
  getByProjectId(projectId: string): Promise<CodeStructure[]>;
  update(id: string, updates: Partial<CodeStructure>): Promise<CodeStructure>;
  delete(id: string): Promise<void>;
}

export interface TemplateRepository {
  getById(id: string): Promise<RepositoryResult<ProjectTemplate | null>>;
  getBySlug(slug: string): Promise<RepositoryResult<ProjectTemplate | null>>;
  list(filters?: TemplateFilters): Promise<RepositoryResult<ProjectTemplate[]>>;
  listByAuthor(authorId: string): Promise<RepositoryResult<ProjectTemplate[]>>;
  create(template: Omit<ProjectTemplate, 'id' | 'useCount' | 'createdAt' | 'updatedAt'>): Promise<RepositoryResult<ProjectTemplate>>;
  update(id: string, updates: Partial<ProjectTemplate>): Promise<RepositoryResult<ProjectTemplate>>;
  delete(id: string): Promise<RepositoryResult<void>>;
  recordUsage(templateId: string, userId: string, projectId?: string): Promise<RepositoryResult<TemplateUsage>>;
  getUsageByUser(userId: string): Promise<RepositoryResult<TemplateUsage[]>>;
}

export interface RepositoryFactory {
  createProjectRepository(): ProjectRepository;
  createBranchRepository(): BranchRepository;
  createGraphRepository(): GraphRepository;
  createPatchRepository(): PatchRepository;
  createArtifactRepository(): ArtifactRepository;
  createAIRunRepository(): AIRunRepository;
  createProposalRepository(): ProposalRepository;
  createCodeStructureRepository(): CodeStructureRepository;
  createTemplateRepository(): TemplateRepository;
  createSpecificationRepository(): any;
  createRequirementsRepository(): any;
  createMappingsRepository(): any;
  createSectionsRepository(): any;
  createRequirementRelationsRepository(): any;
}

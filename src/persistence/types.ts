import type { Graph, PatchOperation, ActorType } from '@nodespec/core/types.js';

export interface Project {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface PersistedBranch {
  id: string;
  projectId: string;
  name: string;
  /** The project's design trunk. Identity lives HERE, not in the name —
   *  connect may rename the trunk row to the git branch it mirrors
   *  (owner spike 2026-08-23). */
  isPrimary: boolean;
  baseSnapshotId: string | null;
  createdAt: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
}

export interface PersistedSnapshot {
  id: string;
  projectId: string;
  branchId: string;
  graphData: Graph;
  version: number;
  hash: string;
  createdAt: string;
  patchSequence: number;
}

export interface PersistedPatch {
  id: string;
  branchId: string;
  sequence: number;
  patchType: string;
  actorType: ActorType;
  actorId: string | null;
  summary: string;
  payload: PatchOperation;
  preconditions?: unknown[];
  createdAt: string;
  appliedAt: string | null;
}

export interface PersistedArtifact {
  id: string;
  projectId: string;
  kind: string;
  nodeId: string;
  branchId?: string;
  path: string;
  contentText?: string;
  contentHash?: string;
  language?: string;
  status: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  /** @deprecated Use `kind` instead */
  type?: string;
  /** @deprecated Use `contentText` instead */
  content?: unknown;
  /** @deprecated */
  uri?: string;
  /** @deprecated */
  storagePath?: string;
}

export interface AIRun {
  id: string;
  projectId: string;
  branchId: string;
  model: string;
  promptHash: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  inputSnapshotId: string | null;
  outputPatches: string[] | null;
  metadata?: Record<string, unknown>;
}

export interface PatchFilter {
  sinceSequence?: number;
  untilSequence?: number;
  actorType?: ActorType;
  limit?: number;
}

export interface RepositoryError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type RepositoryResult<T> =
  | { success: true; data: T }
  | { success: false; error: RepositoryError };

export interface RealtimeSubscription {
  unsubscribe: () => void;
}

export interface PatchEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  patch: PersistedPatch;
  timestamp: string;
}

export type TemplateCategory =
  | 'general'
  | 'saas'
  | 'e-commerce'
  | 'microservices'
  | 'iot'
  | 'mobile'
  | 'data-pipeline'
  | 'real-time'
  | 'ai-ml'
  | 'devops';

export type TemplateAuthorType = 'official' | 'community';

export interface TemplateSpecificationRequirement {
  requirementId: string;
  name: string;
  description: string;
  category: 'functional' | 'non-functional' | 'technical' | 'business';
  acceptanceCriteria: Array<{ text: string }>;
  metadata: Record<string, unknown>;
}

export interface TemplateSpecificationMapping {
  requirementId: string;
  nodeId: string;
  mappingType: 'implements' | 'depends_on' | 'validates' | 'supports';
  confidence: number;
  notes?: string;
}

export interface TemplateSpecification {
  vision: string;
  preferences: {
    languages?: string[];
    frameworks?: string[];
    databases?: string[];
    deploymentTarget?: string;
    architecturePattern?: 'monolith' | 'microservices' | 'serverless' | 'unknown';
  };
  requirements: TemplateSpecificationRequirement[];
  mappings: TemplateSpecificationMapping[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: TemplateCategory;
  graphData: Graph;
  templateSpecification: TemplateSpecification | null;
  thumbnailUrl: string | null;
  /** Owner-curated public source repository for this template; optional so
   *  pre-column rows, mocks and fixtures need no change. */
  repoUrl?: string | null;
  tags: string[];
  technologies: string[];
  nodeCount: number;
  edgeCount: number;
  authorType: TemplateAuthorType;
  authorId: string | null;
  isPublic: boolean;
  isFeatured: boolean;
  useCount: number;
  upvoteCount: number;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateUsage {
  id: string;
  templateId: string;
  userId: string;
  projectId: string | null;
  createdAt: string;
}

export interface TemplateFilters {
  category?: TemplateCategory;
  tags?: string[];
  search?: string;
  authorType?: TemplateAuthorType;
  isFeatured?: boolean;
  sortBy?: 'featured' | 'popular' | 'newest';
  limit?: number;
  offset?: number;
}

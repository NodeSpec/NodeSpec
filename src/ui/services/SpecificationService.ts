import type { PersistenceService } from './PersistenceService.js';
import type { AcceptanceCriterionRecord } from '../../persistence/supabase/requirements-repository.js';
import type { RequirementRelation, CreateRequirementRelationInput } from '../../persistence/supabase/requirement-relations-repository.js';

export type PhaseStatus = 'drafting_requirements' | 'requirements_confirmed' | 'building_architecture' | 'architecture_confirmed' | 'generating_code' | 'architecture_first';

export interface ProjectSpecification {
  id: string;
  projectId: string | null;
  name: string;
  description?: string;
  version?: string;
  status?: 'draft' | 'active' | 'archived';
  vision: string;
  constraints: Array<{
    type: 'technology' | 'architecture' | 'deployment' | 'performance' | 'other';
    description: string;
  }>;
  preferences: {
    languages?: string[];
    frameworks?: string[];
    databases?: string[];
    deploymentTarget?: string;
    architecturePattern?: 'monolith' | 'microservices' | 'serverless' | 'unknown';
    specEnabled?: boolean;
  };
  rawInput?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  metadata: Record<string, any>;
  lockedNodes?: string[];
  phaseStatus?: PhaseStatus;
}

export interface CreateSpecificationInput {
  vision: string;
  constraints?: ProjectSpecification['constraints'];
  preferences?: ProjectSpecification['preferences'];
  rawInput?: string;
  projectId?: string | null;
  createdBy: string;
  metadata?: Record<string, any>;
}

export interface UpdateSpecificationInput {
  vision?: string;
  constraints?: ProjectSpecification['constraints'];
  preferences?: ProjectSpecification['preferences'];
  projectId?: string;
  metadata?: Record<string, any>;
  lockedNodes?: string[];
}

export interface Requirement {
  id: string;
  specificationId: string;
  requirementId: string;
  name: string;
  description: string;
  category: 'functional' | 'non-functional' | 'technical' | 'business';
  status: 'pending' | 'in-progress' | 'implemented' | 'validated' | 'blocked';
  confirmed: boolean;
  locked: boolean;
  sectionId: string | null;
  source: 'manual' | 'ai-generated' | 'imported';
  acceptanceCriteria: AcceptanceCriterionRecord[];
  architectureTrace?: string[];
  metadata: {
    confidence?: number;
    rationale?: string;
    dependencies?: string[];
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}

export interface RequirementMapping {
  id: string;
  specificationId: string;
  requirementId: string | null;
  nodeId: string;
  mappingType: 'implements' | 'depends_on' | 'validates' | 'supports';
  confidence: number;
  notes?: string;
  createdAt: string;
  createdBy: string | null;
  isOrphan?: boolean;
}

export interface SpecificationSection {
  id: string;
  specificationId: string;
  name: string;
  description: string | null;
  orderIndex: number;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSectionInput {
  specificationId: string;
  name: string;
  description?: string;
  orderIndex?: number;
  aiGenerated?: boolean;
}

export interface CreateRequirementInput {
  specificationId: string;
  requirementId: string;
  name: string;
  description: string;
  category: 'functional' | 'non-functional' | 'technical' | 'business';
  priority?: string | null;
  acceptanceCriteria: AcceptanceCriterionRecord[];
  sectionId?: string | null;
  source?: 'ai-generated' | 'manual' | 'refined';
  metadata?: Record<string, any>;
}

export interface UpdateRequirementInput {
  name?: string;
  description?: string;
  category?: Requirement['category'];
  priority?: string | null;
  status?: Requirement['status'];
  locked?: boolean;
  confirmed?: boolean;
  acceptanceCriteria?: Requirement['acceptanceCriteria'];
  architectureTrace?: string[];
  sectionId?: string | null;
  source?: 'ai-generated' | 'manual' | 'refined';
  metadata?: Requirement['metadata'];
}

export class SpecificationService {
  constructor(private persistence: PersistenceService) {}

  async createSpecification(input: CreateSpecificationInput): Promise<ProjectSpecification> {
    const repo = this.persistence.getSpecificationRepository();
    const result = await repo.create(input);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getSpecification(id: string): Promise<ProjectSpecification> {
    const repo = this.persistence.getSpecificationRepository();
    const result = await repo.getById(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getSpecificationsByProject(projectId: string): Promise<ProjectSpecification[]> {
    const repo = this.persistence.getSpecificationRepository();
    const result = await repo.getByProjectId(projectId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async updateSpecification(id: string, input: UpdateSpecificationInput): Promise<ProjectSpecification> {
    const repo = this.persistence.getSpecificationRepository();
    const result = await repo.update(id, input);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async lockNode(specificationId: string, nodeId: string): Promise<ProjectSpecification> {
    const repo = this.persistence.getSpecificationRepository();

    const specResult = await repo.getById(specificationId);
    if (!specResult.success) {
      throw new Error(specResult.error.message);
    }

    const spec = specResult.data;
    const lockedNodes = spec.lockedNodes || [];

    if (!lockedNodes.includes(nodeId)) {
      lockedNodes.push(nodeId);
    }

    const result = await repo.update(specificationId, { lockedNodes });
    if (!result.success) {
      throw new Error(result.error.message);
    }

    return result.data;
  }

  async unlockNode(specificationId: string, nodeId: string): Promise<ProjectSpecification> {
    const repo = this.persistence.getSpecificationRepository();

    const specResult = await repo.getById(specificationId);
    if (!specResult.success) {
      throw new Error(specResult.error.message);
    }

    const spec = specResult.data;
    const lockedNodes = (spec.lockedNodes || []).filter((id: string) => id !== nodeId);

    const result = await repo.update(specificationId, { lockedNodes });
    if (!result.success) {
      throw new Error(result.error.message);
    }

    return result.data;
  }

  async getLockedNodes(specificationId: string): Promise<string[]> {
    const repo = this.persistence.getSpecificationRepository();
    const result = await repo.getById(specificationId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data.lockedNodes || [];
  }

  async deleteSpecification(id: string): Promise<void> {
    const repo = this.persistence.getSpecificationRepository();
    const result = await repo.delete(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async linkSpecificationToProject(specId: string, projectId: string): Promise<void> {
    const repo = this.persistence.getSpecificationRepository();
    const result = await repo.linkToProject(specId, projectId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async getRequirement(id: string): Promise<Requirement> {
    const repo = this.persistence.getRequirementsRepository();
    const result = await repo.getById(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getRequirementsBySpecification(specificationId: string): Promise<Requirement[]> {
    const repo = this.persistence.getRequirementsRepository();
    const result = await repo.getBySpecificationId(specificationId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getMapping(id: string): Promise<RequirementMapping> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.getById(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getMappingsByNode(nodeId: string): Promise<RequirementMapping[]> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.getByNode(nodeId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getMappingsByRequirement(requirementId: string): Promise<RequirementMapping[]> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.getByRequirement(requirementId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async deleteMapping(id: string): Promise<void> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.delete(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async getMappingsBySpecification(specificationId: string): Promise<RequirementMapping[]> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.getBySpecification(specificationId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async createSection(input: CreateSectionInput): Promise<SpecificationSection> {
    const repo = this.persistence.getSectionsRepository();
    const result = await repo.create(input);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async bulkCreateSections(inputs: CreateSectionInput[]): Promise<SpecificationSection[]> {
    const repo = this.persistence.getSectionsRepository();
    const result = await repo.bulkCreate(inputs);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getSection(id: string): Promise<SpecificationSection> {
    const repo = this.persistence.getSectionsRepository();
    const result = await repo.getById(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getSectionsBySpecification(specificationId: string): Promise<SpecificationSection[]> {
    const repo = this.persistence.getSectionsRepository();
    const result = await repo.getBySpecificationId(specificationId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async updateSection(id: string, updates: { name?: string; description?: string; orderIndex?: number }): Promise<SpecificationSection> {
    const repo = this.persistence.getSectionsRepository();
    const result = await repo.update(id, updates);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async deleteSection(id: string): Promise<void> {
    const repo = this.persistence.getSectionsRepository();
    const result = await repo.delete(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async reorderSections(specificationId: string, sectionIds: string[]): Promise<void> {
    const repo = this.persistence.getSectionsRepository();
    const result = await repo.reorder(specificationId, sectionIds);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  // ── R6: authored requirement↔requirement relations ──────────────────────────
  // NodeSpec never writes these on its own: creates come from a user click
  // (source 'user' — the ONLY path from a coupling suggestion to a stored row)
  // or the user's AI over MCP (source 'ai'). Node-overlap coupling stays
  // derived at read time (spec-v3/coupling.ts) and never lands here.

  async getRelationsBySpecification(specificationId: string): Promise<RequirementRelation[]> {
    const repo = this.persistence.getRequirementRelationsRepository();
    const result = await repo.getBySpecificationId(specificationId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async createRequirementRelation(input: CreateRequirementRelationInput): Promise<RequirementRelation | null> {
    const repo = this.persistence.getRequirementRelationsRepository();
    const result = await repo.create(input);
    if (!result.success) {
      // Duplicate = the fact already stands (UNIQUE(from,to,type)) — idempotent, not an error.
      if (result.error.code === '23505') return null;
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async deleteRequirementRelation(id: string): Promise<void> {
    const repo = this.persistence.getRequirementRelationsRepository();
    const result = await repo.delete(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async createRequirement(input: CreateRequirementInput): Promise<Requirement> {
    const repo = this.persistence.getRequirementsRepository();
    const result = await repo.create({
      ...input,
      metadata: {
        ...input.metadata,
        source: input.source || 'manual',
      },
    });
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  /**
   * Discovered #8: auto-numbered creation with the race closed. The next
   * REQ-NNN is computed from the CURRENT rows and the insert retried on the
   * unique-violation (23505) — two concurrent quick-adds can no longer land
   * the same id. Exhaustion surfaces the conflict honestly.
   */
  async createRequirementAutoNumbered(
    input: Omit<CreateRequirementInput, 'requirementId'>,
  ): Promise<Requirement> {
    const repo = this.persistence.getRequirementsRepository();
    const MAX_ATTEMPTS = 3;
    let lastError = 'Unknown error';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const existing = await repo.getBySpecificationId(input.specificationId);
      const nums = (existing.success ? existing.data : [])
        .map((r: { requirementId: string }) => r.requirementId)
        .filter((id: string) => /^REQ-\d+$/.test(id))
        .map((id: string) => parseInt(id.replace('REQ-', ''), 10));
      const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1;
      const requirementId = `REQ-${String(nextNum).padStart(3, '0')}`;

      const result = await repo.create({
        ...input,
        requirementId,
        metadata: { ...input.metadata, source: input.source || 'manual' },
      });
      if (result.success) return result.data;
      lastError = result.error.message;
      if (result.error.code !== '23505') break;
    }
    throw new Error(lastError);
  }

  async bulkCreateRequirements(inputs: CreateRequirementInput[]): Promise<Requirement[]> {
    const repo = this.persistence.getRequirementsRepository();
    const result = await repo.bulkCreate(
      inputs.map(input => ({
        ...input,
        metadata: {
          ...input.metadata,
          source: input.source || 'ai-generated',
        },
      }))
    );
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async updateRequirement(id: string, input: UpdateRequirementInput): Promise<Requirement> {
    const repo = this.persistence.getRequirementsRepository();
    const updates: any = { ...input };
    if (input.sectionId !== undefined || input.source !== undefined) {
      const current = await this.getRequirement(id);
      updates.metadata = {
        ...current.metadata,
        ...input.metadata,
      };
      if (input.source) updates.metadata.source = input.source;
    }
    if (input.architectureTrace !== undefined) {
      updates.architectureTrace = input.architectureTrace;
    }
    const result = await repo.update(id, updates);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async deleteRequirement(id: string, options?: { force?: boolean }): Promise<void> {
    const repo = this.persistence.getRequirementsRepository();
    const result = await repo.delete(id, { force: options?.force ?? true });
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async runOrphanMappingSync(specificationId: string): Promise<{ updatedCount: number; orphanedCount: number }> {
    const supabase = this.persistence.getSupabaseClient();

    const { data: spec, error: specError } = await supabase
      .from('project_specifications')
      .select('project_id')
      .eq('id', specificationId)
      .maybeSingle();

    if (specError || !spec?.project_id) {
      return { updatedCount: 0, orphanedCount: 0 };
    }

    const branchRepo = this.persistence.getBranchRepository();
    const graphRepo = this.persistence.getGraphRepository();
    const branchesResult = await branchRepo.listByProject(spec.project_id);
    if (!branchesResult.success) {
      return { updatedCount: 0, orphanedCount: 0 };
    }

    const mainBranch = branchesResult.data.find((b: any) => b.name === 'main');
    if (!mainBranch) {
      return { updatedCount: 0, orphanedCount: 0 };
    }

    const snapshotResult = await graphRepo.loadSnapshot(mainBranch.id);
    if (!snapshotResult.success || !snapshotResult.data?.graphData) {
      return { updatedCount: 0, orphanedCount: 0 };
    }

    const validNodeIds = Object.keys(snapshotResult.data.graphData.nodes);

    const { data, error } = await supabase.rpc('sync_orphan_mappings', {
      p_specification_id: specificationId,
      p_valid_node_ids: validNodeIds,
    });

    if (error) {
      console.error('[runOrphanMappingSync] RPC error:', error.message);
      return { updatedCount: 0, orphanedCount: 0 };
    }

    const result = {
      updatedCount: data?.[0]?.updated_count || 0,
      orphanedCount: data?.[0]?.orphaned_count || 0,
    };

    if (result.orphanedCount > 0 || result.updatedCount > 0) {
      console.log('[runOrphanMappingSync] Synced orphan mappings:', result);
    }

    return result;
  }

  async getPhaseStatus(specificationId: string): Promise<PhaseStatus> {
    const supabase = this.persistence.getSupabaseClient();
    const { data } = await supabase
      .from('project_specifications')
      .select('phase_status')
      .eq('id', specificationId)
      .maybeSingle();
    return (data?.phase_status as PhaseStatus) || 'drafting_requirements';
  }

  async confirmRequirements(specificationId: string): Promise<void> {
    const supabase = this.persistence.getSupabaseClient();
    const { error } = await supabase
      .from('project_specifications')
      .update({ phase_status: 'requirements_confirmed' })
      .eq('id', specificationId);
    if (error) throw new Error(error.message);
  }

  async setPhaseStatus(specificationId: string, status: PhaseStatus): Promise<void> {
    const supabase = this.persistence.getSupabaseClient();
    const { error } = await supabase
      .from('project_specifications')
      .update({ phase_status: status })
      .eq('id', specificationId);
    if (error) throw new Error(error.message);
  }
}

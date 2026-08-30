import type { Graph } from '@nodespec/core/types.js';
import { migrateGraphToLatest, needsMigration } from '@nodespec/core/migration.js';
import type {
  ProjectTemplate,
  TemplateUsage,
  TemplateFilters,
  TemplateCategory,
  TemplateSpecification,
} from '../../persistence/types.js';
import type { PersistenceService } from './PersistenceService.js';
import type { ProjectWithBranch } from './ProjectService.js';

export interface UseTemplateResult {
  project: ProjectWithBranch;
  usage: TemplateUsage;
}

interface CloneResult {
  graph: Graph;
  idMap: Map<string, string>;
}

export class TemplateService {
  constructor(private persistence: PersistenceService) {}

  async listTemplates(filters?: TemplateFilters): Promise<ProjectTemplate[]> {
    const repo = this.persistence.getTemplateRepository();
    const result = await repo.list(filters);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getTemplate(id: string): Promise<ProjectTemplate | null> {
    const repo = this.persistence.getTemplateRepository();
    const result = await repo.getById(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getTemplateBySlug(slug: string): Promise<ProjectTemplate | null> {
    const repo = this.persistence.getTemplateRepository();
    const result = await repo.getBySlug(slug);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getFeaturedTemplates(): Promise<ProjectTemplate[]> {
    return this.listTemplates({ isFeatured: true, sortBy: 'featured' });
  }

  async getTemplatesByCategory(category: TemplateCategory): Promise<ProjectTemplate[]> {
    return this.listTemplates({ category, sortBy: 'popular' });
  }

  async searchTemplates(query: string): Promise<ProjectTemplate[]> {
    return this.listTemplates({ search: query });
  }

  async useTemplate(
    templateId: string,
    projectName: string,
    userId: string
  ): Promise<UseTemplateResult> {
    const templateRepo = this.persistence.getTemplateRepository();
    const projectRepo = this.persistence.getProjectRepository();
    const branchRepo = this.persistence.getBranchRepository();
    const graphRepo = this.persistence.getGraphRepository();

    const templateResult = await templateRepo.getById(templateId);
    if (!templateResult.success) {
      throw new Error(templateResult.error.message);
    }
    if (!templateResult.data) {
      throw new Error('Template not found');
    }

    const template = templateResult.data;
    const { graph: clonedGraph, idMap } = this.cloneGraphWithFreshIds(template.graphData);
    const graph = needsMigration(clonedGraph) ? migrateGraphToLatest(clonedGraph) : clonedGraph;

    const projectResult = await projectRepo.create(projectName, userId, {
      sourceTemplateId: template.id,
      sourceTemplateSlug: template.slug,
    });
    if (!projectResult.success) {
      throw new Error(projectResult.error.message);
    }
    const project = projectResult.data;

    const branchResult = await branchRepo.create(project.id, 'main', userId);
    if (!branchResult.success) {
      throw new Error(branchResult.error.message);
    }
    const branch = branchResult.data;

    const snapshotResult = await graphRepo.saveSnapshot(project.id, branch.id, graph, 0);
    if (!snapshotResult.success) {
      throw new Error(snapshotResult.error.message);
    }

    const updateResult = await branchRepo.update(branch.id, {
      baseSnapshotId: snapshotResult.data.id,
    });
    if (!updateResult.success) {
      throw new Error(updateResult.error.message);
    }

    const usageResult = await templateRepo.recordUsage(templateId, userId, project.id);
    if (!usageResult.success) {
      throw new Error(usageResult.error.message);
    }

    if (template.templateSpecification) {
      await this.applyTemplateSpecification(
        template.templateSpecification,
        project.id,
        userId,
        idMap
      );
    }

    return {
      project: {
        project,
        branch: updateResult.data,
        graph,
      },
      usage: usageResult.data,
    };
  }

  async overwriteProjectWithTemplate(
    templateId: string,
    projectId: string,
    branchId: string,
    userId: string
  ): Promise<Graph> {
    const templateRepo = this.persistence.getTemplateRepository();
    const graphRepo = this.persistence.getGraphRepository();
    const branchRepo = this.persistence.getBranchRepository();
    const supabase = this.persistence.getSupabaseClient();

    const templateResult = await templateRepo.getById(templateId);
    if (!templateResult.success) {
      throw new Error(templateResult.error.message);
    }
    if (!templateResult.data) {
      throw new Error('Template not found');
    }

    const template = templateResult.data;
    const { graph: clonedGraph, idMap } = this.cloneGraphWithFreshIds(template.graphData);
    const graph = needsMigration(clonedGraph) ? migrateGraphToLatest(clonedGraph) : clonedGraph;

    await supabase.from('project_specifications').delete().eq('project_id', projectId);
    await supabase.from('code_structures').delete().eq('project_id', projectId);
    await supabase.from('conversation_history').delete().eq('project_id', projectId);
    await supabase.from('graph_patches').delete().eq('branch_id', branchId);

    const snapshotResult = await graphRepo.saveSnapshot(projectId, branchId, graph, 0);
    if (!snapshotResult.success) {
      throw new Error(snapshotResult.error.message);
    }

    await branchRepo.update(branchId, { baseSnapshotId: snapshotResult.data.id });

    await templateRepo.recordUsage(templateId, userId, projectId);

    if (template.templateSpecification) {
      await this.applyTemplateSpecification(
        template.templateSpecification,
        projectId,
        userId,
        idMap
      );
    }

    return graph;
  }

  async getMyTemplates(userId: string): Promise<ProjectTemplate[]> {
    const repo = this.persistence.getTemplateRepository();
    const result = await repo.listByAuthor(userId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getMyUsageHistory(userId: string): Promise<TemplateUsage[]> {
    const repo = this.persistence.getTemplateRepository();
    const result = await repo.getUsageByUser(userId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  private async applyTemplateSpecification(
    spec: TemplateSpecification,
    projectId: string,
    userId: string,
    idMap: Map<string, string>
  ): Promise<void> {
    try {
      const specRepo = this.persistence.getSpecificationRepository();
      const reqRepo = this.persistence.getRequirementsRepository();
      const mappingsRepo = this.persistence.getMappingsRepository();

      const specResult = await specRepo.create({
        vision: spec.vision,
        constraints: [],
        preferences: spec.preferences,
        projectId,
        createdBy: userId,
        metadata: { source: 'template' },
      });

      if (!specResult.success) {
        console.warn('Failed to create specification from template:', specResult.error.message);
        return;
      }

      const specification = specResult.data;

      if (spec.requirements.length > 0) {
        const reqInputs = spec.requirements.map(r => ({
          specificationId: specification.id,
          requirementId: r.requirementId,
          name: r.name,
          description: r.description,
          category: r.category,
          source: 'imported' as const,
          acceptanceCriteria: r.acceptanceCriteria,
          metadata: r.metadata,
        }));

        const reqResult = await reqRepo.bulkCreate(reqInputs);

        if (!reqResult.success) {
          console.warn('Failed to create requirements from template:', reqResult.error.message);
          return;
        }

        const createdRequirements = reqResult.data;
        const reqIdToDbId = new Map<string, string>();
        for (const req of createdRequirements) {
          reqIdToDbId.set(req.requirementId, req.id);
        }

        if (spec.mappings.length > 0) {
          const mappingInputs = spec.mappings
            .map(m => {
              const dbReqId = reqIdToDbId.get(m.requirementId);
              const newNodeId = idMap.get(m.nodeId) ?? m.nodeId;
              if (!dbReqId) return null;

              return {
                specificationId: specification.id,
                requirementId: dbReqId,
                nodeId: newNodeId,
                mappingType: m.mappingType,
                confidence: m.confidence,
                notes: m.notes,
                createdBy: userId,
              };
            })
            .filter((m): m is NonNullable<typeof m> => m !== null);

          if (mappingInputs.length > 0) {
            const mapResult = await mappingsRepo.bulkCreate(mappingInputs);
            if (!mapResult.success) {
              console.warn('Failed to create mappings from template:', mapResult.error.message);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Error applying template specification:', error);
    }
  }

  private cloneGraphWithFreshIds(source: Graph): CloneResult {
    const idMap = new Map<string, string>();

    const freshId = (oldId: string): string => {
      if (!idMap.has(oldId)) {
        idMap.set(oldId, crypto.randomUUID());
      }
      return idMap.get(oldId)!;
    };

    const newNodes: Graph['nodes'] = {};
    for (const [oldId, node] of Object.entries(source.nodes)) {
      const newId = freshId(oldId);
      const ports = (node.ports ?? []).map(p => ({
        ...p,
        id: freshId(p.id),
        contractId: p.contractId ? freshId(p.contractId) : undefined,
        schemaRef: p.schemaRef ? freshId(p.schemaRef) : undefined,
      }));
      newNodes[newId] = {
        ...node,
        id: newId,
        ports,
        parentId: node.parentId ? freshId(node.parentId) : undefined,
        artifacts: (node.artifacts ?? []).map(a => freshId(a)),
      };
    }

    const newEdges: Graph['edges'] = {};
    for (const [oldId, edge] of Object.entries(source.edges)) {
      const newId = freshId(oldId);
      newEdges[newId] = {
        ...edge,
        id: newId,
        source: freshId(edge.source),
        target: freshId(edge.target),
        sourcePortId: edge.sourcePortId ? freshId(edge.sourcePortId) : undefined,
        targetPortId: edge.targetPortId ? freshId(edge.targetPortId) : undefined,
        contractId: freshId(edge.contractId),
      };
    }

    const newContracts: Graph['contracts'] = {};
    for (const [oldId, contract] of Object.entries(source.contracts)) {
      const newId = freshId(oldId);
      newContracts[newId] = {
        ...contract,
        id: newId,
        schemaRef: contract.schemaRef ? freshId(contract.schemaRef) : undefined,
      };
    }

    const newArtifacts: Graph['artifacts'] = {};
    for (const [oldId, artifact] of Object.entries(source.artifacts)) {
      const newId = freshId(oldId);
      newArtifacts[newId] = {
        ...artifact,
        id: newId,
        nodeId: freshId(artifact.nodeId),
      };
    }

    const newNodeGroups: Graph['nodeGroups'] = {};
    if (source.nodeGroups) {
      for (const [oldId, group] of Object.entries(source.nodeGroups)) {
        const newId = freshId(oldId);
        newNodeGroups[newId] = {
          ...group,
          id: newId,
          nodeIds: group.nodeIds.map(nid => freshId(nid)),
        };
      }
    }

    return {
      graph: {
        id: crypto.randomUUID(),
        schemaVersion: source.schemaVersion,
        version: 0,
        hash: '',
        nodes: newNodes,
        edges: newEdges,
        contracts: newContracts,
        artifacts: newArtifacts,
        nodeGroups: Object.keys(newNodeGroups).length > 0 ? newNodeGroups : undefined,
        metadata: source.metadata ? { ...source.metadata } : undefined,
      },
      idMap,
    };
  }
}

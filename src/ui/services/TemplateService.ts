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
import { CONSTRAINT_TYPES, constraintIdentity } from '../../../supabase/functions/_shared/constraint-identity.js';
import { featureAvailable, type Edition } from '../config/feature-rules.js';
import { buildEdition, isHostedEdition } from '../config/edition.js';
import type { PlanTier } from '../config/tiers.js';
import { readProjectPlan } from '../hooks/useProjectFeatureGate.js';

/** AL.15: what a template's specification put on the new project. */
export interface TemplateApplySummary {
  requirements: number;
  mappings: number;
  workflows: number;
  outcomes: number;
  constraints: number;
  /** 'all': workflows and constraints landed too. 'requirements': the plan
   *  does not carry Workflows (or the database refused the first workflow),
   *  so only the specification and its requirements applied. 'none': the
   *  template carries no specification, or it could not be created. */
  planes: 'all' | 'requirements' | 'none';
}

export interface UseTemplateResult {
  project: ProjectWithBranch;
  usage: TemplateUsage;
  applied: TemplateApplySummary;
}

/** How the service learns the project's plan and this build's edition;
 *  the defaults read them as the app does, tests pass their own. */
export interface TemplateServiceDeps {
  readPlan: (projectId: string) => Promise<PlanTier | null>;
  edition: Edition;
}

const NONE: TemplateApplySummary = { requirements: 0, mappings: 0, workflows: 0, outcomes: 0, constraints: 0, planes: 'none' };

/** AL.15: what is wrong with a template specification's workflows and
 *  constraints, as lines; none means it applies cleanly. Every outcome sits
 *  on steps of its workflow, derives requirements the template carries, and
 *  has each of its criteria claimed by exactly one of them (so it reads as
 *  derived, never half); a constraint's kind is one the table accepts and
 *  the workflow it names exists. Pure. */
export function templateSpecificationIssues(spec: TemplateSpecification): string[] {
  const issues: string[] = [];
  const reqIds = new Set(spec.requirements.map((r) => r.requirementId));
  const names = new Set<string>();
  const keys = new Set<string>();
  for (const wf of spec.workflows ?? []) {
    if (names.has(wf.name)) issues.push(`workflow "${wf.name}" is named twice`);
    names.add(wf.name);
    if (wf.steps.length === 0) issues.push(`workflow "${wf.name}" has no steps`);
    for (const o of wf.outcomes) {
      if (keys.has(o.key)) issues.push(`outcome key "${o.key}" is used twice`);
      keys.add(o.key);
      const criterionIds = new Set(o.criteria.map((c) => c.id));
      if (criterionIds.size !== o.criteria.length) issues.push(`outcome "${o.key}" repeats a criterion id`);
      if (o.steps.length === 0) issues.push(`outcome "${o.key}" sits on no step`);
      for (const step of o.steps) {
        if (!Number.isInteger(step) || step < 0 || step >= wf.steps.length) issues.push(`outcome "${o.key}" names step ${step}, which "${wf.name}" does not have`);
      }
      const claimed = new Set<string>();
      for (const d of o.derives) {
        if (!reqIds.has(d.requirementId)) issues.push(`outcome "${o.key}" derives ${d.requirementId}, which the template does not carry`);
        for (const c of d.criteria) {
          if (!criterionIds.has(c)) issues.push(`outcome "${o.key}" claims criterion "${c}" for ${d.requirementId}, which it does not have`);
          if (claimed.has(c)) issues.push(`outcome "${o.key}" claims criterion "${c}" twice`);
          claimed.add(c);
        }
      }
      for (const c of criterionIds) if (!claimed.has(c)) issues.push(`outcome "${o.key}" leaves criterion "${c}" unclaimed`);
    }
  }
  for (const k of spec.constraints ?? []) {
    if (!(CONSTRAINT_TYPES as readonly string[]).includes(k.ctype)) issues.push(`constraint "${k.title ?? k.description}" has the kind "${k.ctype}", which the table does not accept`);
    if (k.workflow && !names.has(k.workflow)) issues.push(`constraint "${k.title ?? k.description}" names the workflow "${k.workflow}", which the template does not have`);
    if (!k.description.trim()) issues.push('a constraint has no description');
  }
  return issues;
}

interface CloneResult {
  graph: Graph;
  idMap: Map<string, string>;
}

export class TemplateService {
  private readonly deps: TemplateServiceDeps;

  constructor(private persistence: PersistenceService, deps?: Partial<TemplateServiceDeps>) {
    this.deps = {
      // The plan as the database answers it on hosted; elsewhere the
      // database alone decides (RLS refuses the plane the plan lacks).
      readPlan: deps?.readPlan ?? ((projectId) => (isHostedEdition ? readProjectPlan(projectId, true) : Promise.resolve(null))),
      edition: deps?.edition ?? buildEdition,
    };
  }

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

    // AD.4 (D15): the project's one branch is its primary, by flag.
    const branchResult = await branchRepo.create(project.id, 'main', userId, undefined, undefined, true);
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

    const applied = template.templateSpecification
      ? await this.applyTemplateSpecification(template.templateSpecification, project.id, branch.id, userId, idMap, template.name)
      : NONE;

    return {
      project: {
        project,
        branch: updateResult.data,
        graph,
      },
      usage: usageResult.data,
      applied,
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
    await supabase.from('graph_patches').delete().eq('branch_id', branchId);
    // AL.15: an overwrite replaces what the template puts on the canvas too.
    // Outcomes go before the workflows that home them (the database keeps a
    // workflow while an outcome calls it home); a plane the plan does not
    // carry has nothing to remove, and a refusal there is not a failure.
    for (const [table, column, value] of [
      ['project_constraints', 'project_id', projectId],
      ['requirement_candidates', 'branch_id', branchId],
      ['workflows', 'project_id', projectId],
    ] as const) {
      try {
        await supabase.from(table).delete().eq(column, value);
      } catch {
        /* nothing of that plane to remove */
      }
    }

    const snapshotResult = await graphRepo.saveSnapshot(projectId, branchId, graph, 0);
    if (!snapshotResult.success) {
      throw new Error(snapshotResult.error.message);
    }

    await branchRepo.update(branchId, { baseSnapshotId: snapshotResult.data.id });

    await templateRepo.recordUsage(templateId, userId, projectId);

    if (template.templateSpecification) {
      await this.applyTemplateSpecification(template.templateSpecification, projectId, branchId, userId, idMap, template.name);
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
    branchId: string,
    userId: string,
    idMap: Map<string, string>,
    templateName: string,
  ): Promise<TemplateApplySummary> {
    const summary: TemplateApplySummary = { ...NONE };
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
        return summary;
      }

      const specification = specResult.data;
      const reqIdToDbId = new Map<string, string>();

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
          return summary;
        }

        const createdRequirements = reqResult.data;
        for (const req of createdRequirements) {
          reqIdToDbId.set(req.requirementId, req.id);
        }
        summary.requirements = createdRequirements.length;

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
            } else {
              summary.mappings = mappingInputs.length;
            }
          }
        }
      }

      const canvas = await this.applyWorkflowsAndConstraints(spec, projectId, branchId, userId, reqIdToDbId, templateName);
      summary.workflows = canvas.workflows;
      summary.outcomes = canvas.outcomes;
      summary.constraints = canvas.constraints;
      summary.planes = canvas.planes;
    } catch (error) {
      console.warn('Error applying template specification:', error);
    }
    return summary;
  }

  /** AL.15: the template's workflows, their steps and outcomes (each
   *  outcome filed on its steps and deriving its requirements, as the app's
   *  own writes do), and its constraints, on a plan that carries Workflows.
   *  Below that plan nothing of this is written: the person sees the
   *  requirements, as on any project of theirs. */
  private async applyWorkflowsAndConstraints(
    spec: TemplateSpecification,
    projectId: string,
    branchId: string,
    userId: string,
    reqIdToDbId: ReadonlyMap<string, string>,
    templateName: string,
  ): Promise<Pick<TemplateApplySummary, 'workflows' | 'outcomes' | 'constraints' | 'planes'>> {
    const workflows = spec.workflows ?? [];
    const constraints = spec.constraints ?? [];
    const none = { workflows: 0, outcomes: 0, constraints: 0 };
    if (workflows.length === 0 && constraints.length === 0) return { ...none, planes: 'all' };
    const issues = templateSpecificationIssues(spec);
    if (issues.length > 0) {
      console.warn('Template workflows and constraints not applied:', issues.join('; '));
      return { ...none, planes: 'requirements' };
    }
    const plan = await this.deps.readPlan(projectId);
    if (plan && !featureAvailable(plan, 'workflow_space', this.deps.edition)) return { ...none, planes: 'requirements' };

    const supabase = this.persistence.getSupabaseClient();
    const workflowIdByName = new Map<string, string>();
    let outcomes = 0;
    for (const [sortOrder, wf] of workflows.entries()) {
      const { data: created, error } = await supabase
        .from('workflows')
        .insert({ project_id: projectId, name: wf.name, color: wf.color ?? null, owner_label: wf.ownerLabel ?? null, sort_order: sortOrder, created_by: userId })
        .select('id')
        .single();
      const workflowId = (created as { id?: string } | null)?.id;
      if (error || !workflowId) {
        // The database refuses the plane the plan does not carry; the first
        // refusal answers for every workflow and constraint of the template.
        if (sortOrder === 0) return { ...none, planes: 'requirements' };
        console.warn(`Template workflow "${wf.name}" was not created:`, error?.message);
        continue;
      }
      workflowIdByName.set(wf.name, workflowId);

      const { data: steps } = await supabase
        .from('workflow_steps')
        .insert(wf.steps.map((name, index) => ({ workflow_id: workflowId, name, sort_order: index })))
        .select('id, sort_order');
      const stepIdByIndex = new Map(((steps ?? []) as Array<{ id: string; sort_order: number }>).map((s) => [s.sort_order, s.id]));
      if (wf.outcomes.length === 0) continue;

      const keyed = wf.outcomes.map((o) => ({ o, key: `outcome:${crypto.randomUUID().slice(0, 8)}` }));
      const { data: createdOutcomes } = await supabase
        .from('requirement_candidates')
        .insert(keyed.map(({ o, key }) => ({
          project_id: projectId,
          branch_id: branchId,
          workflow_id: workflowId,
          node_id: null,
          key,
          kind: 'outcome',
          name: o.name,
          description: o.description,
          category: 'functional',
          criteria: o.criteria.map((c) => ({ id: c.id, text: c.text, verification: c.verification ?? 'automated' })),
          evidence: { source: `template: ${templateName}` },
          status: 'pending',
          // The first derivation freezes requirement_row_id, as a promotion does.
          requirement_row_id: reqIdToDbId.get(o.derives[0]?.requirementId ?? '') ?? null,
        })))
        .select('id, key');
      const idByKey = new Map(((createdOutcomes ?? []) as Array<{ id: string; key: string }>).map((c) => [c.key, c.id]));

      const maps: Array<{ branch_id: string; candidate_id: string; step_id: string }> = [];
      const derivations: Array<Record<string, unknown>> = [];
      for (const { o, key } of keyed) {
        const candidateId = idByKey.get(key);
        if (!candidateId) continue;
        outcomes += 1;
        for (const step of new Set(o.steps)) {
          const stepId = stepIdByIndex.get(step);
          if (stepId) maps.push({ branch_id: branchId, candidate_id: candidateId, step_id: stepId });
        }
        const textOf = new Map(o.criteria.map((c) => [c.id, c.text]));
        for (const d of o.derives) {
          const requirementRowId = reqIdToDbId.get(d.requirementId);
          if (!requirementRowId) continue;
          derivations.push({
            project_id: projectId,
            branch_id: branchId,
            candidate_id: candidateId,
            requirement_row_id: requirementRowId,
            criteria_slice: d.criteria.map((id) => ({ id, text: textOf.get(id) ?? '' })),
            proposed_by_kind: 'human',
            proposed_by_id: userId,
            via_proposal_id: null,
            approved_by: userId,
          });
        }
      }
      if (maps.length > 0) await supabase.from('outcome_step_maps').insert(maps);
      if (derivations.length > 0) await supabase.from('outcome_derivations').insert(derivations);
    }

    let landed = 0;
    if (constraints.length > 0) {
      const rows = await Promise.all(constraints.map(async (k) => ({
        project_id: projectId,
        ctype: k.ctype,
        title: k.title ?? null,
        description: k.description,
        rationale: k.rationale ?? null,
        author: templateName,
        workflow_id: k.workflow ? workflowIdByName.get(k.workflow) ?? null : null,
        source_hash: await constraintIdentity(k.ctype, k.description),
      })));
      const { data: createdConstraints, error } = await supabase.from('project_constraints').insert(rows).select('id');
      if (error) console.warn('Template constraints were not created:', error.message);
      else landed = ((createdConstraints ?? []) as unknown[]).length;
    }
    return { workflows: workflowIdByName.size, outcomes, constraints: landed, planes: 'all' };
  }

  private cloneGraphWithFreshIds(source: Graph): CloneResult {
    const idMap = new Map<string, string>();

    const freshId = (oldId: string): string => {
      if (!idMap.has(oldId)) {
        idMap.set(oldId, crypto.randomUUID());
      }
      return idMap.get(oldId)!;
    };

    // AG.13 (owner 2026-09-28): a new project carries no ports. A template's
    // stored ports and edge port ids are left behind, and so is any contract
    // no edge uses (the stubs a port once held); the canvas draws the handles.
    const newNodes: Graph['nodes'] = {};
    for (const [oldId, node] of Object.entries(source.nodes)) {
      const newId = freshId(oldId);
      const { ports: _ports, ...rest } = node;
      newNodes[newId] = {
        ...rest,
        id: newId,
        parentId: node.parentId ? freshId(node.parentId) : undefined,
        artifacts: (node.artifacts ?? []).map(a => freshId(a)),
      };
    }

    const newEdges: Graph['edges'] = {};
    for (const [oldId, edge] of Object.entries(source.edges)) {
      const newId = freshId(oldId);
      const { sourcePortId: _sourcePortId, targetPortId: _targetPortId, ...rest } = edge;
      newEdges[newId] = {
        ...rest,
        id: newId,
        source: freshId(edge.source),
        target: freshId(edge.target),
        contractId: freshId(edge.contractId),
      };
    }

    const edgeContracts = new Set(Object.values(source.edges).map(e => e.contractId));
    const newContracts: Graph['contracts'] = {};
    for (const [oldId, contract] of Object.entries(source.contracts)) {
      if (!edgeContracts.has(oldId)) continue;
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

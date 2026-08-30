import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ProjectRepository,
  BranchRepository,
  GraphRepository,
  PatchRepository,
  ArtifactRepository,
  AIRunRepository,
  ProposalRepository,
  CodeStructureRepository,
  TemplateRepository,
} from '../../persistence/ports.js';
import type { TestCaseRepository } from '../../persistence/supabase/test-case-repository.js';
import { createSupabaseRepositoryFactory } from '../../persistence/supabase/factory.js';
import { createSupabaseTestCaseRepository } from '../../persistence/supabase/test-case-repository.js';

export class PersistenceService {
  private repos: {
    projects: ProjectRepository;
    branches: BranchRepository;
    graphs: GraphRepository;
    patches: PatchRepository;
    artifacts: ArtifactRepository;
    aiRuns: AIRunRepository;
    proposals: ProposalRepository;
    codeStructures: CodeStructureRepository;
    testCases: TestCaseRepository;
    templates: TemplateRepository;
    specifications: any;
    requirements: any;
    mappings: any;
    sections: any;
    requirementRelations: any;
  };

  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
    const factory = createSupabaseRepositoryFactory(supabaseClient);

    this.repos = {
      projects: factory.createProjectRepository(),
      branches: factory.createBranchRepository(),
      graphs: factory.createGraphRepository(),
      patches: factory.createPatchRepository(),
      artifacts: factory.createArtifactRepository(),
      aiRuns: factory.createAIRunRepository(),
      proposals: factory.createProposalRepository(),
      codeStructures: factory.createCodeStructureRepository(),
      testCases: createSupabaseTestCaseRepository(supabaseClient),
      templates: factory.createTemplateRepository(),
      specifications: factory.createSpecificationRepository(),
      requirements: factory.createRequirementsRepository(),
      mappings: factory.createMappingsRepository(),
      sections: factory.createSectionsRepository(),
      requirementRelations: factory.createRequirementRelationsRepository(),
    };
  }

  getProjectRepository(): ProjectRepository {
    return this.repos.projects;
  }

  getBranchRepository(): BranchRepository {
    return this.repos.branches;
  }

  getGraphRepository(): GraphRepository {
    return this.repos.graphs;
  }

  getPatchRepository(): PatchRepository {
    return this.repos.patches;
  }

  getArtifactRepository(): ArtifactRepository {
    return this.repos.artifacts;
  }

  getAIRunRepository(): AIRunRepository {
    return this.repos.aiRuns;
  }

  getProposalRepository(): ProposalRepository {
    return this.repos.proposals;
  }

  getCodeStructureRepository(): CodeStructureRepository {
    return this.repos.codeStructures;
  }

  getTemplateRepository(): TemplateRepository {
    return this.repos.templates;
  }

  getSpecificationRepository(): any {
    return this.repos.specifications;
  }

  getRequirementsRepository(): any {
    return this.repos.requirements;
  }

  getMappingsRepository(): any {
    return this.repos.mappings;
  }

  getSectionsRepository(): any {
    return this.repos.sections;
  }

  getRequirementRelationsRepository(): any {
    return this.repos.requirementRelations;
  }

  getTestCaseRepository(): TestCaseRepository {
    return this.repos.testCases;
  }

  getSupabaseClient(): SupabaseClient {
    return this.supabase;
  }

  async registerForLaunch(email: string): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase
      .from('launch_registrations')
      .insert({ email });

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'This email is already registered!' };
      }
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  async getGitIntegration(projectId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('git_integrations')
      .select('id, project_id, provider, repo_owner, repo_name, default_branch, last_sync_at, sync_status, created_at, metadata')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async saveGitIntegration(projectId: string, config: {
    provider: string;
    repoOwner: string;
    repoName: string;
    defaultBranch: string;
    accessToken: string;
  }): Promise<void> {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-git-integration`;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const payload = JSON.stringify({
      projectId,
      provider: config.provider,
      repoOwner: config.repoOwner,
      repoName: config.repoName,
      defaultBranch: config.defaultBranch,
      accessToken: config.accessToken,
    });

    const { data: { session }, error: refreshError } = await this.supabase.auth.refreshSession();
    if (refreshError || !session) {
      throw new Error('Not authenticated. Please sign in again.');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': anonKey,
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.msg || errorData.message || `Failed to save git integration (${response.status})`);
    }
  }
}

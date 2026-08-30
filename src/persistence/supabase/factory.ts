import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepositoryFactory } from '../ports.js';
import { createSupabaseProjectRepository } from './project-repository.js';
import { createSupabaseBranchRepository } from './branch-repository.js';
import { createSupabaseGraphRepository } from './graph-repository.js';
import { createSupabasePatchRepository } from './patch-repository.js';
import { createSupabaseArtifactRepository } from './artifact-repository.js';
import { createSupabaseAIRunRepository } from './ai-run-repository.js';
import { createSupabaseProposalRepository } from './proposal-repository.js';
import { createCodeStructureRepository } from './code-structure-repository.js';
import { createSupabaseSpecificationRepository } from './specification-repository.js';
import { createSupabaseRequirementsRepository } from './requirements-repository.js';
import { createSupabaseMappingsRepository } from './mappings-repository.js';
import { createSupabaseSectionsRepository } from './sections-repository.js';
import { createSupabaseRequirementRelationsRepository } from './requirement-relations-repository.js';
import { createSupabaseTemplateRepository } from './template-repository.js';

export function createSupabaseRepositoryFactory(client: SupabaseClient): RepositoryFactory {
  return {
    createProjectRepository: () => createSupabaseProjectRepository(client),
    createBranchRepository: () => createSupabaseBranchRepository(client),
    createGraphRepository: () => createSupabaseGraphRepository(client),
    createPatchRepository: () => createSupabasePatchRepository(client),
    createArtifactRepository: () => createSupabaseArtifactRepository(client),
    createAIRunRepository: () => createSupabaseAIRunRepository(client),
    createProposalRepository: () => createSupabaseProposalRepository(client),
    createCodeStructureRepository: () => createCodeStructureRepository(client),
    createTemplateRepository: () => createSupabaseTemplateRepository(client),
    createSpecificationRepository: () => createSupabaseSpecificationRepository(client),
    createRequirementsRepository: () => createSupabaseRequirementsRepository(client),
    createMappingsRepository: () => createSupabaseMappingsRepository(client),
    createSectionsRepository: () => createSupabaseSectionsRepository(client),
    createRequirementRelationsRepository: () => createSupabaseRequirementRelationsRepository(client),
  };
}

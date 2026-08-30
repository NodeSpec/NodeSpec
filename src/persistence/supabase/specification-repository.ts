import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProjectSpecification {
  id: string;
  projectId: string | null;
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
  };
  rawInput?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  metadata: Record<string, any>;
  lockedNodes?: string[]; // Array of node IDs locked from AI modifications
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

export interface SpecificationRepository {
  create(input: CreateSpecificationInput): Promise<Result<ProjectSpecification>>;
  getById(id: string): Promise<Result<ProjectSpecification>>;
  getByProjectId(projectId: string): Promise<Result<ProjectSpecification[]>>;
  update(id: string, input: UpdateSpecificationInput): Promise<Result<ProjectSpecification>>;
  delete(id: string): Promise<Result<void>>;
  linkToProject(specId: string, projectId: string): Promise<Result<void>>;
}

type Result<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string } };

function mapDbToSpec(row: any): ProjectSpecification {
  return {
    id: row.id,
    projectId: row.project_id,
    vision: row.vision,
    constraints: row.constraints || [],
    preferences: row.preferences || {},
    rawInput: row.raw_input,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    metadata: row.metadata || {},
    lockedNodes: row.locked_nodes || [],
  };
}

export function createSupabaseSpecificationRepository(
  supabase: SupabaseClient
): SpecificationRepository {
  return {
    async create(input: CreateSpecificationInput): Promise<Result<ProjectSpecification>> {
      try {
        const { data, error } = await supabase
          .from('project_specifications')
          .insert({
            project_id: input.projectId || null,
            vision: input.vision,
            constraints: input.constraints || [],
            preferences: input.preferences || {},
            raw_input: input.rawInput,
            created_by: input.createdBy,
            metadata: input.metadata || {},
          })
          .select()
          .single();

        if (error) {
          console.error('Failed to create specification:', error);
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToSpec(data) };
      } catch (error) {
        console.error('Unexpected error creating specification:', error);
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getById(id: string): Promise<Result<ProjectSpecification>> {
      try {
        const { data, error } = await supabase
          .from('project_specifications')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return {
              success: false,
              error: { message: 'Specification not found', code: 'NOT_FOUND' },
            };
          }
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToSpec(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getByProjectId(projectId: string): Promise<Result<ProjectSpecification[]>> {
      try {
        const { data, error } = await supabase
          .from('project_specifications')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false });

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: (data || []).map(mapDbToSpec) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async update(id: string, input: UpdateSpecificationInput): Promise<Result<ProjectSpecification>> {
      try {
        const updates: any = {
          updated_at: new Date().toISOString(),
        };

        if (input.vision !== undefined) updates.vision = input.vision;
        if (input.constraints !== undefined) updates.constraints = input.constraints;
        if (input.preferences !== undefined) updates.preferences = input.preferences;
        if (input.projectId !== undefined) updates.project_id = input.projectId;
        if (input.metadata !== undefined) updates.metadata = input.metadata;
        if (input.lockedNodes !== undefined) updates.locked_nodes = input.lockedNodes;

        const { data, error} = await supabase
          .from('project_specifications')
          .update(updates)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToSpec(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async delete(id: string): Promise<Result<void>> {
      try {
        const { error } = await supabase
          .from('project_specifications')
          .delete()
          .eq('id', id);

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: undefined };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async linkToProject(specId: string, projectId: string): Promise<Result<void>> {
      try {
        const { error } = await supabase
          .from('project_specifications')
          .update({ project_id: projectId, updated_at: new Date().toISOString() })
          .eq('id', specId);

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: undefined };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },
  };
}

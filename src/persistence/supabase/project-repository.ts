import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProjectRepository } from '../ports.js';
import type { Project, ProjectRole, RepositoryResult } from '../types.js';

interface ProjectRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata ?? undefined,
  };
}

/** Slices of project_delete_step before the delete is reported as not
 * finished. Each slice removes up to 20,000 rows, so this is ~40M rows. */
export const PROJECT_DELETE_MAX_STEPS = 2000;

export function createSupabaseProjectRepository(client: SupabaseClient): ProjectRepository {
  return {
    async create(name, ownerId, metadata): Promise<RepositoryResult<Project>> {
      const { data, error } = await client
        .from('projects')
        .insert({
          name,
          owner_id: ownerId,
          metadata: metadata ?? {},
        })
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToProject(data) };
    },

    async getById(id): Promise<RepositoryResult<Project | null>> {
      const { data, error } = await client
        .from('projects')
        .select()
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToProject(data) : null };
    },

    async listByOwner(ownerId): Promise<RepositoryResult<Project[]>> {
      const { data, error } = await client
        .from('projects')
        .select()
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToProject) };
    },

    // 7.0: RLS already scopes projects to owner ∪ roster; the embedded seat
    // (filtered to the caller's own row) names the role. Owned rows come
    // back with an empty seat list.
    async listForUser(userId): Promise<RepositoryResult<Project[]>> {
      const { data, error } = await client
        .from('projects')
        .select('*, project_members(role)')
        .eq('project_members.user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      const rows = (data ?? []) as Array<ProjectRow & { project_members?: Array<{ role: string }> | null }>;
      return {
        success: true,
        data: rows.map((row) => ({
          ...rowToProject(row),
          role: row.owner_id === userId ? 'owner' : ((row.project_members?.[0]?.role as ProjectRole | undefined) ?? 'viewer'),
        })),
      };
    },

    async update(id, updates): Promise<RepositoryResult<Project>> {
      const updateData: Record<string, unknown> = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.metadata !== undefined) updateData.metadata = updates.metadata;

      const { data, error } = await client
        .from('projects')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToProject(data) };
    },

    async delete(id, onProgress): Promise<RepositoryResult<void>> {
      // One cascading DELETE of a large imported project outran the 8 s
      // statement timeout in production (2026-09-06). project_delete_step
      // (migration 20260906140000) removes the heavy child tables in bounded
      // slices and the project row last; it is called until it answers done.
      let rowsDeleted = 0;
      for (let step = 0; step < PROJECT_DELETE_MAX_STEPS; step++) {
        const { data, error } = await client.rpc('project_delete_step', { p_project_id: id });
        if (error) {
          // A stack that has not applied the migration yet keeps the direct
          // delete (small projects finish inside the timeout there).
          if (/could not find the function/i.test(error.message ?? '')) break;
          return {
            success: false,
            error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
          };
        }
        const result = (data ?? {}) as { done?: boolean; deleted?: number };
        rowsDeleted += result.deleted ?? 0;
        onProgress?.(rowsDeleted);
        if (result.done !== false) return { success: true, data: undefined };
        if (step === PROJECT_DELETE_MAX_STEPS - 1) {
          return {
            success: false,
            error: { code: 'DB_ERROR', message: `project delete did not finish after ${PROJECT_DELETE_MAX_STEPS} slices (${rowsDeleted} rows removed)` },
          };
        }
      }

      const { error } = await client.from('projects').delete().eq('id', id);

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: undefined };
    },
  };
}

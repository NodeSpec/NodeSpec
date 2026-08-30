import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProjectRepository } from '../ports.js';
import type { Project, RepositoryResult } from '../types.js';

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

    async delete(id): Promise<RepositoryResult<void>> {
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

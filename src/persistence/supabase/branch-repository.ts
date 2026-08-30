import type { SupabaseClient } from '@supabase/supabase-js';
import type { BranchRepository } from '../ports.js';
import type { PersistedBranch, RepositoryResult } from '../types.js';

interface BranchRow {
  id: string;
  project_id: string;
  name: string;
  is_primary?: boolean | null;
  base_snapshot_id: string | null;
  created_at: string;
  created_by: string;
  metadata: Record<string, unknown> | null;
}

function rowToBranch(row: BranchRow): PersistedBranch {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    // Legacy rows created before migration 20260823150000 carry no flag —
    // the naming convention covers exactly them.
    isPrimary: row.is_primary === true || (row.is_primary == null && row.name === 'main'),
    baseSnapshotId: row.base_snapshot_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    metadata: row.metadata ?? undefined,
  };
}

export function createSupabaseBranchRepository(client: SupabaseClient): BranchRepository {
  return {
    async create(projectId, name, createdBy, baseSnapshotId, metadata, isPrimary): Promise<RepositoryResult<PersistedBranch>> {
      const { data, error } = await client
        .from('branches')
        .insert({
          project_id: projectId,
          name,
          created_by: createdBy,
          base_snapshot_id: baseSnapshotId ?? null,
          metadata: metadata ?? {},
          is_primary: isPrimary === true,
        })
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToBranch(data) };
    },

    async getById(id): Promise<RepositoryResult<PersistedBranch | null>> {
      const { data, error } = await client
        .from('branches')
        .select()
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToBranch(data) : null };
    },

    async getByName(projectId, name): Promise<RepositoryResult<PersistedBranch | null>> {
      const { data, error } = await client
        .from('branches')
        .select()
        .eq('project_id', projectId)
        .eq('name', name)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToBranch(data) : null };
    },

    async listByProject(projectId): Promise<RepositoryResult<PersistedBranch[]>> {
      const { data, error } = await client
        .from('branches')
        .select()
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToBranch) };
    },

    async update(id, updates): Promise<RepositoryResult<PersistedBranch>> {
      const updateData: Record<string, unknown> = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.baseSnapshotId !== undefined) updateData.base_snapshot_id = updates.baseSnapshotId;
      if (updates.metadata !== undefined) updateData.metadata = updates.metadata;

      const { data, error } = await client
        .from('branches')
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

      return { success: true, data: rowToBranch(data) };
    },

    async delete(id): Promise<RepositoryResult<void>> {
      const { error } = await client.from('branches').delete().eq('id', id);

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

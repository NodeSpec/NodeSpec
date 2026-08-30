import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIRunRepository } from '../ports.js';
import type { AIRun, RepositoryResult } from '../types.js';

interface AIRunRow {
  id: string;
  project_id: string;
  branch_id: string;
  model: string;
  prompt_hash: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at: string | null;
  input_snapshot_id: string | null;
  output_patches: string[] | null;
  metadata: Record<string, unknown> | null;
}

function rowToAIRun(row: AIRunRow): AIRun {
  return {
    id: row.id,
    projectId: row.project_id,
    branchId: row.branch_id,
    model: row.model,
    promptHash: row.prompt_hash,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    inputSnapshotId: row.input_snapshot_id,
    outputPatches: row.output_patches,
    metadata: row.metadata ?? undefined,
  };
}

export function createSupabaseAIRunRepository(client: SupabaseClient): AIRunRepository {
  return {
    async create(projectId, branchId, model, promptHash, inputSnapshotId, metadata): Promise<RepositoryResult<AIRun>> {
      const { data, error } = await client
        .from('ai_runs')
        .insert({
          project_id: projectId,
          branch_id: branchId,
          model,
          prompt_hash: promptHash,
          status: 'pending',
          input_snapshot_id: inputSnapshotId ?? null,
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

      return { success: true, data: rowToAIRun(data) };
    },

    async getById(id): Promise<RepositoryResult<AIRun | null>> {
      const { data, error } = await client
        .from('ai_runs')
        .select()
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToAIRun(data) : null };
    },

    async listByBranch(branchId, limit = 20): Promise<RepositoryResult<AIRun[]>> {
      const { data, error } = await client
        .from('ai_runs')
        .select()
        .eq('branch_id', branchId)
        .order('started_at', { ascending: false })
        .limit(limit);

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToAIRun) };
    },

    async updateStatus(id, status, outputPatches): Promise<RepositoryResult<AIRun>> {
      const updateData: Record<string, unknown> = { status };

      if (status === 'running') {
        updateData.started_at = new Date().toISOString();
      }

      if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Date().toISOString();
      }

      if (outputPatches !== undefined) {
        updateData.output_patches = outputPatches;
      }

      const { data, error } = await client
        .from('ai_runs')
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

      return { success: true, data: rowToAIRun(data) };
    },

    async markCompleted(id, outputPatches): Promise<RepositoryResult<AIRun>> {
      return this.updateStatus(id, 'completed', outputPatches);
    },

    async markFailed(id, metadata): Promise<RepositoryResult<AIRun>> {
      const { data: current } = await client
        .from('ai_runs')
        .select('metadata')
        .eq('id', id)
        .single();

      const mergedMetadata = {
        ...(current?.metadata ?? {}),
        ...metadata,
      };

      const { data, error } = await client
        .from('ai_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          metadata: mergedMetadata,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToAIRun(data) };
    },
  };
}

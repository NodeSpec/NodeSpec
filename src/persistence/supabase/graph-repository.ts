import type { SupabaseClient } from '@supabase/supabase-js';
import type { Graph } from '@nodespec/core/types.js';
import type { GraphRepository } from '../ports.js';
import type { PersistedSnapshot, RepositoryResult } from '../types.js';
import { GraphSchema } from '@nodespec/core/schemas.js';

interface SnapshotRow {
  id: string;
  project_id: string;
  branch_id: string;
  graph_data: Graph;
  version: number;
  hash: string;
  created_at: string;
  patch_sequence: number;
}

function rowToSnapshot(row: SnapshotRow): PersistedSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    branchId: row.branch_id,
    graphData: row.graph_data,
    version: row.version,
    hash: row.hash,
    createdAt: row.created_at,
    patchSequence: row.patch_sequence,
  };
}

export function createSupabaseGraphRepository(client: SupabaseClient): GraphRepository {
  return {
    async loadSnapshot(branchId): Promise<RepositoryResult<PersistedSnapshot | null>> {
      // Snapshots are INSERTed (one row per save), so "latest" must be deterministic:
      // patch_sequence is the semantic version — order by it first; created_at only breaks ties
      // between rows at the same sequence (e.g. the accept flow's rebuild retry). Ordering by
      // created_at alone let same-tick rows shadow each other nondeterministically (2026-07-16).
      const { data, error } = await client
        .from('graph_snapshots')
        .select()
        .eq('branch_id', branchId)
        .order('patch_sequence', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToSnapshot(data) : null };
    },

    async loadSnapshotById(snapshotId): Promise<RepositoryResult<PersistedSnapshot | null>> {
      const { data, error } = await client
        .from('graph_snapshots')
        .select()
        .eq('id', snapshotId)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToSnapshot(data) : null };
    },

    async saveSnapshot(projectId, branchId, graph, patchSequence): Promise<RepositoryResult<PersistedSnapshot>> {
      const validation = GraphSchema.safeParse(graph);
      if (!validation.success) {
        const issues = validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        console.error('[graph-repository] Graph validation failed before save:', issues);
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid graph data: ${issues}` },
        };
      }

      const { data, error } = await client
        .from('graph_snapshots')
        .insert({
          project_id: projectId,
          branch_id: branchId,
          graph_data: graph,
          version: graph.version,
          hash: graph.hash,
          patch_sequence: patchSequence,
        })
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToSnapshot(data) };
    },

    async listSnapshots(branchId, limit = 10): Promise<RepositoryResult<PersistedSnapshot[]>> {
      const { data, error } = await client
        .from('graph_snapshots')
        .select()
        .eq('branch_id', branchId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToSnapshot) };
    },

    async deleteSnapshot(snapshotId): Promise<RepositoryResult<void>> {
      const { error } = await client
        .from('graph_snapshots')
        .delete()
        .eq('id', snapshotId);

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

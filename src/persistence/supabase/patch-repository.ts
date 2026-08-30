import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { PatchOperation, ActorType } from '@nodespec/core/types.js';
import type { PatchRepository } from '../ports.js';
import type {
  PersistedPatch,
  RepositoryResult,
  RealtimeSubscription,
} from '../types.js';

interface PatchRow {
  id: string;
  branch_id: string;
  sequence: number;
  patch_type: string;
  actor_type: ActorType;
  actor_id: string | null;
  summary: string;
  payload: PatchOperation;
  preconditions: unknown[] | null;
  created_at: string;
  applied_at: string | null;
}

function rowToPatch(row: PatchRow): PersistedPatch {
  return {
    id: row.id,
    branchId: row.branch_id,
    sequence: row.sequence,
    patchType: row.patch_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    summary: row.summary,
    payload: row.payload,
    preconditions: row.preconditions ?? undefined,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

export function createSupabasePatchRepository(client: SupabaseClient): PatchRepository {
  const channels = new Map<string, RealtimeChannel>();

  return {
    async appendPatch(branchId, patch, actorId): Promise<RepositoryResult<PersistedPatch>> {
      const { data: seqData, error: seqError } = await client
        .rpc('get_next_patch_sequence', { p_branch_id: branchId });

      if (seqError) {
        return {
          success: false,
          error: { code: 'SEQUENCE_ERROR', message: seqError.message, details: { pgError: seqError } },
        };
      }

      const sequence = seqData as number;

      const { data, error } = await client
        .from('graph_patches')
        .insert({
          id: patch.metadata.id,
          branch_id: branchId,
          sequence,
          patch_type: patch.type,
          actor_type: patch.metadata.actorType,
          actor_id: actorId ?? null,
          summary: patch.metadata.summary,
          payload: patch,
          preconditions: patch.metadata.preconditions ?? null,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return {
            success: false,
            error: {
              code: 'DUPLICATE_PATCH',
              message: `Patch ${patch.metadata.id} already exists or sequence conflict`,
              details: { pgError: error },
            },
          };
        }
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToPatch(data) };
    },

    async appendPatches(branchId, patches, actorId): Promise<RepositoryResult<PersistedPatch[]>> {
      const results: PersistedPatch[] = [];

      for (const patch of patches) {
        const result = await this.appendPatch(branchId, patch, actorId);
        if (!result.success) {
          return result as RepositoryResult<PersistedPatch[]>;
        }
        results.push(result.data);
      }

      return { success: true, data: results };
    },

    async loadPatches(branchId, filter): Promise<RepositoryResult<PersistedPatch[]>> {
      let query = client
        .from('graph_patches')
        .select()
        .eq('branch_id', branchId)
        .order('sequence', { ascending: true });

      if (filter?.sinceSequence !== undefined) {
        query = query.gt('sequence', filter.sinceSequence);
      }

      if (filter?.untilSequence !== undefined) {
        query = query.lte('sequence', filter.untilSequence);
      }

      if (filter?.actorType !== undefined) {
        query = query.eq('actor_type', filter.actorType);
      }

      if (filter?.limit !== undefined) {
        query = query.limit(filter.limit);
      }

      const { data, error } = await query;

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToPatch) };
    },

    async getPatchById(patchId): Promise<RepositoryResult<PersistedPatch | null>> {
      const { data, error } = await client
        .from('graph_patches')
        .select()
        .eq('id', patchId)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToPatch(data) : null };
    },

    async getLatestSequence(branchId): Promise<RepositoryResult<number>> {
      const { data, error } = await client
        .from('graph_patches')
        .select('sequence')
        .eq('branch_id', branchId)
        .order('sequence', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data?.sequence ?? 0 };
    },

    async clearPatches(branchId): Promise<RepositoryResult<void>> {
      const { error } = await client
        .from('graph_patches')
        .delete()
        .eq('branch_id', branchId);

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: undefined };
    },

    async markApplied(patchId): Promise<RepositoryResult<void>> {
      const { error } = await client
        .from('graph_patches')
        .update({ applied_at: new Date().toISOString() })
        .eq('id', patchId);

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: undefined };
    },

    subscribeToPatchStream(branchId, onPatch, sinceSequence): RealtimeSubscription {
      const channelName = `patches:${branchId}`;

      if (channels.has(channelName)) {
        channels.get(channelName)?.unsubscribe();
        channels.delete(channelName);
      }

      let lastSeenSequence = sinceSequence ?? -1;
      let isSubscribed = true;

      const channel = client
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'graph_patches',
            filter: `branch_id=eq.${branchId}`,
          },
          (payload) => {
            if (!isSubscribed) return;
            const row = payload.new as PatchRow;
            if (row.sequence <= lastSeenSequence) return;
            lastSeenSequence = row.sequence;
            onPatch({
              type: 'INSERT',
              patch: rowToPatch(row),
              timestamp: new Date().toISOString(),
            });
          }
        )
        .subscribe((status) => {
          if (!isSubscribed) return;
          if (status === 'CHANNEL_ERROR') {
            console.warn(`[patch-stream] Channel error for branch ${branchId}, will retry`);
          }
          if (status === 'TIMED_OUT') {
            console.warn(`[patch-stream] Channel timed out for branch ${branchId}, resubscribing`);
            channel.subscribe();
          }
        });

      channels.set(channelName, channel);

      return {
        unsubscribe: () => {
          isSubscribed = false;
          channel.unsubscribe();
          channels.delete(channelName);
        },
      };
    },
  };
}

import { useState, useCallback, useRef } from 'react';
import type { BranchStore } from '../store/branch-store.js';
import { getSupabaseClient } from '../../persistence/supabase/client.js';

interface RefreshOptions {
  store: BranchStore;
  projectId?: string | null;
  branchId?: string | null;
  onError?: (message: string) => void;
}

/**
 * Fix (2026-07-16): whether a freshly fetched snapshot may replace the store's graph.
 *
 * The previous guards compared NODE COUNTS ("refuse an empty snapshot", "refuse a >70% shrink
 * unless remove patches exist after the snapshot") and looked for justifying remove patches in
 * `sinceSequence = the NEW snapshot's patchSequence` — a window that is empty by construction,
 * because the accept flow bakes those patches INTO the snapshot at <= its sequence. Any
 * legitimate mass deletion (e.g. an accepted delete-the-canvas proposal) was therefore refused
 * forever: setBaseSnapshot and the refreshCounter bump were both skipped, the store kept the
 * pre-deletion graph, and every retry hit the identical refusal until a full page reload.
 *
 * The correct client-side check is SEQUENCE MONOTONICITY, not node counts: the patch log is
 * hash-chained server-side (P0-5) and saveSnapshot schema-validates before writing, so a
 * snapshot with patchSequence >= what this client currently shows IS the authoritative newer
 * state — however many nodes it has. Node counts are never evidence of corruption.
 */
export function shouldApplySnapshot(
  lastAppliedSequence: number | null,
  newSequence: number,
): boolean {
  if (lastAppliedSequence === null) return true; // first refresh in this session
  return newSequence >= lastAppliedSequence;
}

export function useSmoothRefresh({ store, projectId, branchId, onError }: RefreshOptions) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const isRefreshingRef = useRef(false);
  // The patch sequence the store's graph currently represents (null until the first refresh —
  // the initial App-load snapshot is trusted the same way the first refresh is).
  const lastAppliedSequenceRef = useRef<number | null>(null);

  const refreshGraph = useCallback(async () => {
    if (!projectId || !branchId) return;
    if (isRefreshingRef.current) return;

    isRefreshingRef.current = true;
    setIsRefreshing(true);

    try {
      const supabase = getSupabaseClient();

      const { createSupabaseGraphRepository } = await import('../../persistence/supabase/graph-repository.js');
      const { createSupabasePatchRepository } = await import('../../persistence/supabase/patch-repository.js');

      const graphRepo = createSupabaseGraphRepository(supabase);
      const patchRepo = createSupabasePatchRepository(supabase);

      const snapshotResult = await graphRepo.loadSnapshot(branchId);
      if (!snapshotResult.success) {
        throw new Error(snapshotResult.error.message);
      }

      const snapshotSequence = snapshotResult.data?.patchSequence ?? 0;

      const patchesResult = await patchRepo.loadPatches(branchId, { sinceSequence: snapshotSequence });
      if (!patchesResult.success) {
        throw new Error(patchesResult.error.message);
      }

      const patches = patchesResult.data;

      if (snapshotResult.data?.graphData) {
        const newGraph = snapshotResult.data.graphData;

        // A genuinely malformed snapshot (server bug) is still an error — but shape only,
        // never node counts.
        if (typeof newGraph.nodes !== 'object' || newGraph.nodes === null) {
          throw new Error('Snapshot graph_data is malformed (nodes is not an object).');
        }

        if (shouldApplySnapshot(lastAppliedSequenceRef.current, snapshotSequence)) {
          store.setBaseSnapshot(newGraph);
          lastAppliedSequenceRef.current = snapshotSequence;
        } else {
          // Stale read (an older snapshot row answered first — e.g. a created_at tie). Skip the
          // swap; the next refresh converges. Do NOT throw: dependent effects must still re-run.
          console.warn(
            `[useSmoothRefresh] Skipping stale snapshot (sequence ${snapshotSequence} < applied ${lastAppliedSequenceRef.current}).`
          );
        }
      }

      if (patches.length > 0) {
        store.proposePatches(patches.map((p: any) => p.payload).filter((p: any) => p !== undefined));
        // Advance past the applied post-snapshot patches so a later stale snapshot can't undo them.
        const maxPatchSequence = Math.max(
          snapshotSequence,
          ...patches.map((p: any) => (typeof p.sequence === 'number' ? p.sequence : 0)),
        );
        if (lastAppliedSequenceRef.current === null || maxPatchSequence > lastAppliedSequenceRef.current) {
          lastAppliedSequenceRef.current = maxPatchSequence;
        }
      }

      setRefreshCounter(prev => prev + 1);
    } catch (error) {
      onError?.(`Failed to refresh: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setTimeout(() => {
        isRefreshingRef.current = false;
        setIsRefreshing(false);
      }, 300);
    }
  }, [store, projectId, branchId, onError]);

  return { refreshGraph, isRefreshing, refreshCounter };
}

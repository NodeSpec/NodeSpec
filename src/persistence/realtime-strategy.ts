/**
 * SpecGraph Realtime Strategy
 *
 * This module documents and implements the strategy for real-time patch
 * synchronization between clients and the server.
 *
 * ## Architecture Overview
 *
 * 1. PATCH ORDERING
 *    - Each patch has a monotonically increasing `sequence` number per branch
 *    - Sequence numbers are assigned server-side via `get_next_patch_sequence()`
 *    - Clients must not assume their local sequence; always use server-assigned
 *    - Patches are applied in sequence order, never out of order
 *
 * 2. CLIENT SUBSCRIPTION MODEL
 *    - Clients subscribe to `postgres_changes` on `graph_patches` table
 *    - Filter: `branch_id=eq.{branchId}`
 *    - On connect, client provides `sinceSequence` to get only new patches
 *    - Supabase Realtime delivers INSERT events in real-time
 *
 * 3. RECOVERY FROM MISSED EVENTS
 *    - Client tracks `lastKnownSequence` locally
 *    - On reconnect, fetch patches with `sequence > lastKnownSequence`
 *    - Apply missed patches in order before processing new realtime events
 *    - If gap detected (next.sequence != last + 1), trigger full resync
 *
 * 4. CONFLICT RESOLUTION
 *    - Optimistic concurrency: client validates patch locally first
 *    - Server is authoritative: if server rejects, client must revert
 *    - Preconditions can enforce expected state before patch application
 *    - Use `hash_match` precondition for critical operations
 *
 * ## Failure Modes
 *
 * ### F1: Patch arrives out of order
 * - Detection: sequence gap (received seq != expected seq)
 * - Response: Queue the patch, fetch missing patches, apply in order
 * - Recovery: Full branch reload if gap cannot be filled
 *
 * ### F2: Patch validation fails on client but passes on server
 * - Detection: Client rejects patch that appears in realtime stream
 * - Response: Client's local state is stale; force snapshot reload
 * - Recovery: Fetch latest snapshot, replay patches from snapshot.patchSequence
 *
 * ### F3: Two users write to same branch concurrently
 * - Detection: DUPLICATE_PATCH error or sequence conflict
 * - Response: Retry with new sequence after fetching latest state
 * - Recovery: Atomic sequence assignment prevents true conflicts
 *
 * ### F4: Network partition / disconnect
 * - Detection: Supabase channel disconnects
 * - Response: Track disconnect time, reconnect with exponential backoff
 * - Recovery: On reconnect, fetch all patches since lastKnownSequence
 *
 * ### F5: Precondition failure
 * - Detection: Server returns PRECONDITION_FAILED
 * - Response: Patch is rejected; client must refresh state and retry
 * - Recovery: Load current state, re-evaluate if patch still makes sense
 */

import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import type { PatchRepository, GraphRepository } from './ports.js';
import type { PersistedPatch, RealtimeSubscription, PatchEvent } from './types.js';
import { applyPatch, validatePatch } from '@nodespec/core/patch-engine.js';

export interface SyncState {
  branchId: string;
  graph: Graph;
  lastKnownSequence: number;
  pendingPatches: Map<number, PersistedPatch>;
  isConnected: boolean;
}

export interface SyncCallbacks {
  onGraphUpdated: (graph: Graph, patch: PersistedPatch) => void;
  onSyncError: (error: SyncError) => void;
  onConnectionChange: (connected: boolean) => void;
}

export interface SyncError {
  code: 'OUT_OF_ORDER' | 'VALIDATION_FAILED' | 'STALE_STATE' | 'NETWORK_ERROR';
  message: string;
  details?: Record<string, unknown>;
}

export interface RealtimeSyncService {
  connect(branchId: string, initialGraph: Graph, sinceSequence: number): Promise<void>;
  disconnect(): void;
  submitPatch(patch: PatchOperation): Promise<PersistedPatch>;
  resync(): Promise<void>;
  getState(): SyncState | null;
}

export function createRealtimeSyncService(
  patchRepo: PatchRepository,
  graphRepo: GraphRepository,
  callbacks: SyncCallbacks
): RealtimeSyncService {
  let state: SyncState | null = null;
  let subscription: RealtimeSubscription | null = null;

  function processIncomingPatch(event: PatchEvent): void {
    if (!state) return;

    const patch = event.patch;
    const expectedSequence = state.lastKnownSequence + 1;

    if (patch.sequence < expectedSequence) {
      return;
    }

    if (patch.sequence > expectedSequence) {
      state.pendingPatches.set(patch.sequence, patch);
      fetchMissingPatches(expectedSequence, patch.sequence - 1);
      return;
    }

    applyAndAdvance(patch);
  }

  function applyAndAdvance(patch: PersistedPatch): void {
    if (!state) return;

    const validation = validatePatch(state.graph, patch.payload);
    if (!validation.valid) {
      callbacks.onSyncError({
        code: 'VALIDATION_FAILED',
        message: `Patch ${patch.id} failed local validation`,
        details: { errors: validation.errors },
      });
      resyncFromServer();
      return;
    }

    const result = applyPatch(state.graph, patch.payload);
    if (!result.success || !result.graph) {
      callbacks.onSyncError({
        code: 'VALIDATION_FAILED',
        message: `Patch ${patch.id} failed to apply`,
        details: { error: result.error },
      });
      resyncFromServer();
      return;
    }

    state.graph = result.graph;
    state.lastKnownSequence = patch.sequence;
    callbacks.onGraphUpdated(state.graph, patch);

    const nextPatch = state.pendingPatches.get(patch.sequence + 1);
    if (nextPatch) {
      state.pendingPatches.delete(patch.sequence + 1);
      applyAndAdvance(nextPatch);
    }
  }

  async function fetchMissingPatches(fromSeq: number, toSeq: number): Promise<void> {
    if (!state) return;

    const result = await patchRepo.loadPatches(state.branchId, {
      sinceSequence: fromSeq - 1,
      untilSequence: toSeq,
    });

    if (!result.success) {
      callbacks.onSyncError({
        code: 'NETWORK_ERROR',
        message: 'Failed to fetch missing patches',
        details: { error: result.error },
      });
      return;
    }

    for (const patch of result.data) {
      if (patch.sequence >= fromSeq && patch.sequence <= toSeq) {
        state.pendingPatches.set(patch.sequence, patch);
      }
    }

    const nextExpected = state.lastKnownSequence + 1;
    const nextPatch = state.pendingPatches.get(nextExpected);
    if (nextPatch) {
      state.pendingPatches.delete(nextExpected);
      applyAndAdvance(nextPatch);
    }
  }

  async function resyncFromServer(): Promise<void> {
    if (!state) return;

    const snapshotResult = await graphRepo.loadSnapshot(state.branchId);
    if (!snapshotResult.success || !snapshotResult.data) {
      callbacks.onSyncError({
        code: 'NETWORK_ERROR',
        message: 'Failed to load snapshot for resync',
      });
      return;
    }

    const snapshot = snapshotResult.data;
    state.graph = snapshot.graphData;
    state.lastKnownSequence = snapshot.patchSequence;
    state.pendingPatches.clear();

    const patchResult = await patchRepo.loadPatches(state.branchId, {
      sinceSequence: snapshot.patchSequence,
    });

    if (patchResult.success) {
      for (const patch of patchResult.data) {
        applyAndAdvance(patch);
      }
    }
  }

  return {
    async connect(branchId, initialGraph, sinceSequence) {
      state = {
        branchId,
        graph: initialGraph,
        lastKnownSequence: sinceSequence,
        pendingPatches: new Map(),
        isConnected: true,
      };

      subscription = patchRepo.subscribeToPatchStream(
        branchId,
        processIncomingPatch,
        sinceSequence
      );

      callbacks.onConnectionChange(true);
    },

    disconnect() {
      if (subscription) {
        subscription.unsubscribe();
        subscription = null;
      }
      if (state) {
        state.isConnected = false;
      }
      callbacks.onConnectionChange(false);
    },

    async submitPatch(patch) {
      if (!state) {
        throw new Error('Not connected to a branch');
      }

      const validation = validatePatch(state.graph, patch);
      if (!validation.valid) {
        throw new Error(`Local validation failed: ${validation.errors[0]?.message}`);
      }

      const result = await patchRepo.appendPatch(state.branchId, patch);
      if (!result.success) {
        if (result.error.code === 'DUPLICATE_PATCH') {
          throw new Error('Patch already exists');
        }
        throw new Error(`Failed to submit patch: ${result.error.message}`);
      }

      return result.data;
    },

    async resync() {
      await resyncFromServer();
    },

    getState() {
      return state;
    },
  };
}

// Fix (2026-07-16): the Architecture canvas went permanently stale after an accepted
// mass-deletion proposal. The old useSmoothRefresh guards compared node counts and looked for
// justifying remove patches AFTER the new snapshot's sequence — an empty-by-construction window
// (the accept flow bakes those patches INTO the snapshot). The fix replaces node-count heuristics
// with sequence monotonicity. These tests pin the pure decision + the deterministic
// latest-snapshot ordering.
import { describe, it, expect, vi } from 'vitest';
import { shouldApplySnapshot } from '../ui/hooks/useSmoothRefresh.js';
import { createSupabaseGraphRepository } from '../persistence/supabase/graph-repository.js';

describe('shouldApplySnapshot (sequence monotonicity — never node counts)', () => {
  it('first refresh in a session always applies', () => {
    expect(shouldApplySnapshot(null, 0)).toBe(true);
    expect(shouldApplySnapshot(null, 42)).toBe(true);
  });

  it('a newer snapshot applies', () => {
    expect(shouldApplySnapshot(5, 6)).toBe(true);
    expect(shouldApplySnapshot(5, 500)).toBe(true);
  });

  it('an equal-sequence snapshot applies (idempotent re-read)', () => {
    expect(shouldApplySnapshot(7, 7)).toBe(true);
  });

  it('an older snapshot is skipped (stale read)', () => {
    expect(shouldApplySnapshot(10, 9)).toBe(false);
    expect(shouldApplySnapshot(10, 0)).toBe(false);
  });

  it('the mass-deletion case: a newer snapshot applies regardless of how much it shrank', () => {
    // The old guard refused newNodeCount === 0 unconditionally. Sequence is the only input now:
    // an accepted delete-everything proposal produces a HIGHER sequence and must apply.
    expect(shouldApplySnapshot(12, 25)).toBe(true);
  });
});

describe('loadSnapshot ordering (deterministic latest)', () => {
  it('orders by patch_sequence desc first, created_at desc as tiebreak', async () => {
    const orderCalls: Array<{ column: string; ascending: boolean }> = [];
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn((column: string, opts: { ascending: boolean }) => {
        orderCalls.push({ column, ascending: opts.ascending });
        return builder;
      }),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    const client: any = { from: vi.fn(() => builder) };

    const repo = createSupabaseGraphRepository(client);
    const result = await repo.loadSnapshot('branch-1');

    expect(result.success).toBe(true);
    expect(orderCalls).toEqual([
      { column: 'patch_sequence', ascending: false },
      { column: 'created_at', ascending: false },
    ]);
  });
});

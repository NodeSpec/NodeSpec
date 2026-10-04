import { describe, it, expect, vi } from 'vitest';

vi.mock('../persistence/supabase/client.js', () => ({ getSupabaseClient: () => ({}) }));
import { liftWaiverFrom } from '../ui/components/ideation/useConstraints.js';

// AL.10 (owner 2026-10-01): lifting a waiver in the app reads the row as it is
// now (not as this screen last read it) and writes only if nobody changed it in
// between, so a waiver accepted from an agent's proposal meanwhile is never
// erased. The server's whole-list writes are in
// supabase/functions/tests/al10-whole-record-writes_test.ts.

type Step = { read?: { waivers: Array<{ id: string; target: string }>; updated_at: string | null } | null; wrote?: unknown[]; error?: string };

function fakeClient(steps: Step[]) {
  const writes: Array<{ payload: { waivers: Array<{ id: string }> }; guard: [string, string, unknown] | null }> = [];
  let reads = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            const step = steps[reads++];
            return { data: step?.read ?? null, error: step?.error ? { message: step.error } : null };
          },
        }),
      }),
      update: (payload: { waivers: Array<{ id: string }> }) => {
        const entry: (typeof writes)[number] = { payload, guard: null };
        writes.push(entry);
        const guarded = {
          select: async () => ({ data: steps[reads - 1]?.wrote ?? [{ id: 'k9' }], error: null }),
        };
        return {
          eq: () => ({
            eq: (c: string, v: unknown) => { entry.guard = ['eq', c, v]; return guarded; },
            is: (c: string, v: unknown) => { entry.guard = ['is', c, v]; return guarded; },
          }),
        };
      },
    }),
  };
  return { client: client as never, writes };
}

const T0 = '2026-10-01T12:00:00.000+00:00';
const T1 = '2026-10-01T12:00:01.000+00:00';

describe('AL.10 · lifting a waiver in the app', () => {
  it('lifts from the row as it is now and writes only on that row', async () => {
    const { client, writes } = fakeClient([{ read: { waivers: [{ id: 'w1', target: 'e1' }, { id: 'w2', target: 'e7' }], updated_at: T0 } }]);
    expect(await liftWaiverFrom(client, 'k9', 'w1')).toBeNull();
    expect(writes.map((w) => w.payload.waivers.map((x) => x.id))).toEqual([['w2']]);
    expect(writes[0].guard).toEqual(['eq', 'updated_at', T0]);
  });

  it('a waiver accepted meanwhile is kept: the row is read again and the lift lands on it', async () => {
    const { client, writes } = fakeClient([
      { read: { waivers: [{ id: 'w1', target: 'e1' }], updated_at: T0 }, wrote: [] },
      { read: { waivers: [{ id: 'w1', target: 'e1' }, { id: 'w3', target: 'e9' }], updated_at: T1 } },
    ]);
    expect(await liftWaiverFrom(client, 'k9', 'w1')).toBeNull();
    expect(writes.map((w) => [w.payload.waivers.map((x) => x.id), w.guard?.[2]])).toEqual([[[], T0], [['w3'], T1]]);
  });

  it('already lifted writes nothing; a gone row and a failed read say so; three moves give up', async () => {
    const lifted = fakeClient([{ read: { waivers: [{ id: 'w2', target: 'e7' }], updated_at: T0 } }]);
    expect(await liftWaiverFrom(lifted.client, 'k9', 'w1')).toBeNull();
    expect(lifted.writes).toEqual([]);

    expect(await liftWaiverFrom(fakeClient([{ read: null }]).client, 'k9', 'w1')).toBe('That constraint is gone.');
    expect(await liftWaiverFrom(fakeClient([{ error: 'timeout' }]).client, 'k9', 'w1')).toBe('timeout');

    const busy = fakeClient([0, 1, 2].map(() => ({ read: { waivers: [{ id: 'w1', target: 'e1' }], updated_at: T0 }, wrote: [] })));
    expect(await liftWaiverFrom(busy.client, 'k9', 'w1')).toBe('This constraint kept changing while the waiver was lifted; nothing was changed. Try again.');
    expect(busy.writes).toHaveLength(3);
  });

  it('a row never stamped is guarded as unstamped', async () => {
    const { client, writes } = fakeClient([{ read: { waivers: [{ id: 'w1', target: 'e1' }], updated_at: null } }]);
    await liftWaiverFrom(client, 'k9', 'w1');
    expect(writes[0].guard).toEqual(['is', 'updated_at', null]);
  });
});

// @vitest-environment jsdom
// AL.20 (owner 2026-10-02: "our production app is really lagging"): production
// logs showed two signed-in people sending about 15,000 requests in six hours.
// Presence was mounted four times and the approvals queue twice, each copy on
// its own 30 second timer, in hidden tabs too, and a burst of change events
// reloaded every copy once per event. These tests count the requests the
// hooks actually send, through a client that records each one.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';

const net = vi.hoisted(() => ({
  log: [] as string[],
  channels: [] as Array<{ name: string; handlers: Array<() => void>; removed: boolean }>,
  leases: [] as Array<Record<string, unknown>>,
  gate: null as Promise<void> | null,
}));

vi.mock('../persistence/supabase/client.js', () => {
  const answer = (table: string) => {
    if (table === 'agent_checkouts') return net.leases;
    if (table === 'branches') return [{ id: 'b-1' }];
    return [];
  };
  const builder = (table: string) => {
    let head = false;
    const b: Record<string, unknown> = {};
    for (const m of ['eq', 'is', 'in', 'order', 'limit', 'neq', 'gt', 'not']) b[m] = () => b;
    b.select = (_cols?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return b; };
    const settle = async (single: boolean) => {
      net.log.push(table);
      if (table === 'agent_checkouts' && net.gate) await net.gate;
      if (head) return { data: null, count: 0, error: null };
      return { data: single ? null : answer(table), error: null };
    };
    b.maybeSingle = () => settle(true);
    b.single = () => settle(true);
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => settle(false).then(res, rej);
    return b;
  };
  return {
    getSupabaseClient: () => ({
      from: (table: string) => builder(table),
      rpc: async (name: string) => { net.log.push(`rpc:${name}`); return { data: [], error: null }; },
      channel: (name: string) => {
        const ch = { name, handlers: [] as Array<() => void>, removed: false };
        net.channels.push(ch);
        const api = {
          on: (_kind: string, _filter: unknown, h: () => void) => { ch.handlers.push(h); return api; },
          subscribe: () => ch,
        };
        return api;
      },
      removeChannel: (ch: { removed: boolean }) => { ch.removed = true; },
    }),
    callEdgeFunction: async () => ({ success: true }),
  };
});

const { useAgentPresence, PRESENCE_REFRESH_MS } = await import('../ui/components/ideation/useAgentPresence.js');
const { useApprovalsQueue } = await import('../ui/components/ideation/useApprovalsQueue.js');
const { useSharedPoll, nextDelay, POKE_DEBOUNCE_MS, POKE_MAX_WAIT_MS } = await import('../ui/hooks/useSharedPoll.js');

const reads = (what: string) => net.log.filter((x) => x === what).length;
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

let hidden = false;
const setHidden = (h: boolean) => { hidden = h; document.dispatchEvent(new Event('visibilitychange')); };

beforeEach(() => {
  vi.useFakeTimers();
  net.log.length = 0;
  net.channels.length = 0;
  net.leases = [];
  net.gate = null;
  hidden = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function FourPresenceMounts({ projectId }: { projectId: string }) {
  // GraphEditor, the Agents panel, the Architecture rail and Work, as on the canvas
  const a = useAgentPresence(projectId);
  const b = useAgentPresence(projectId);
  const c = useAgentPresence(projectId);
  const d = useAgentPresence(projectId);
  return <span data-testid="holds">{[a, b, c, d].map((p) => p.holds.length).join(',')}</span>;
}

describe('AL.20 · one board per project, however many surfaces show it', () => {
  it('four mounts send one load and open one change channel; all four read the same holds', async () => {
    net.leases = [{ id: 'l-1', level: 'requirement', holder_label: 'Claude', requirement_id: null, task_item_id: null, artifact_id: null, candidate_id: null, proposal_id: null, meta: null, since: '2026-10-02T20:00:00Z', heartbeat_at: new Date().toISOString() }];
    const view = render(<FourPresenceMounts projectId="p-1" />);
    await settle();
    expect(reads('agent_checkouts')).toBe(1);
    expect(reads('rpc:mcp_credential_horizons')).toBe(1);
    expect(net.channels.map((c) => c.name)).toEqual(['agent-checkouts-p-1']);
    expect(view.getByTestId('holds').textContent).toBe('1,1,1,1');

    await settle(PRESENCE_REFRESH_MS);
    expect(reads('agent_checkouts')).toBe(2);
  });

  it('two projects keep two boards', async () => {
    render(<><FourPresenceMounts projectId="p-1" /><FourPresenceMounts projectId="p-2" /></>);
    await settle();
    expect(reads('agent_checkouts')).toBe(2);
    expect(net.channels.map((c) => c.name).sort()).toEqual(['agent-checkouts-p-1', 'agent-checkouts-p-2']);
  });

  it('idle for ten minutes: 8 loads where four fixed 30 second timers sent 84', async () => {
    render(<FourPresenceMounts projectId="p-1" />);
    await settle();
    await settle(10 * 60_000);
    // loads at 0, 30, 60, 120, 180, 300, 420 and 540 s: the interval doubles
    // after every two unchanged loads, up to four times
    expect(reads('agent_checkouts')).toBe(8);
    // each load is four requests (leases, credential horizons, branches, the
    // pending count): 32 in ten minutes, against 4 x 21 x 4 = 336 before
    expect(net.log.length).toBe(32);
  });

  it('a change on the board brings the 30 second interval back', async () => {
    render(<FourPresenceMounts projectId="p-1" />);
    await settle();
    await settle(3 * 60_000);
    const before = reads('agent_checkouts');
    net.leases = [{ id: 'l-2', level: 'outcome', holder_label: 'Claude', since: '2026-10-02T20:00:00Z', heartbeat_at: new Date().toISOString() }];
    await settle(2 * 60_000); // the next slow tick sees the change
    const atChange = reads('agent_checkouts');
    expect(atChange).toBeGreaterThan(before);
    await settle(PRESENCE_REFRESH_MS);
    expect(reads('agent_checkouts')).toBe(atChange + 1);
  });
});

describe('AL.20 · a hidden tab sends nothing', () => {
  it('hidden for ten minutes sends no load; coming back loads once at once', async () => {
    render(<FourPresenceMounts projectId="p-1" />);
    await settle();
    expect(reads('agent_checkouts')).toBe(1);
    setHidden(true);
    await settle(10 * 60_000);
    expect(reads('agent_checkouts')).toBe(1);
    setHidden(false);
    await settle();
    expect(reads('agent_checkouts')).toBe(2);
    await settle(PRESENCE_REFRESH_MS - 1);
    expect(reads('agent_checkouts')).toBe(2);
  });

  it('a change event while hidden waits for the tab to come back', async () => {
    render(<FourPresenceMounts projectId="p-1" />);
    await settle();
    setHidden(true);
    net.channels[0].handlers[0]();
    await settle(POKE_DEBOUNCE_MS * 4);
    expect(reads('agent_checkouts')).toBe(1);
    setHidden(false);
    await settle();
    expect(reads('agent_checkouts')).toBe(2);
  });
});

describe('AL.20 · a burst of change events is one reload', () => {
  it('fifty lease events inside a second reload the board once', async () => {
    render(<FourPresenceMounts projectId="p-1" />);
    await settle();
    for (let i = 0; i < 50; i++) { net.channels[0].handlers[0](); await settle(15); }
    await settle(POKE_DEBOUNCE_MS);
    expect(reads('agent_checkouts')).toBe(2);
  });

  it('a steady stream of events still reloads at least every two seconds', async () => {
    render(<FourPresenceMounts projectId="p-1" />);
    await settle();
    for (let i = 0; i < 60; i++) { net.channels[0].handlers[0](); await settle(100); }
    await settle(POKE_DEBOUNCE_MS);
    // six seconds of events: a reload at each two second ceiling, then the last
    const loads = reads('agent_checkouts') - 1;
    expect(loads).toBeGreaterThanOrEqual(3);
    expect(loads).toBeLessThanOrEqual(Math.ceil(6000 / POKE_MAX_WAIT_MS) + 1);
  });
});

describe('AL.20 · after a write, refresh reads what was written', () => {
  it('a refresh during a load waits for a load that starts after it', async () => {
    const { result } = renderHook(() => useAgentPresence('p-1'));
    await settle();
    let open!: () => void;
    net.gate = new Promise<void>((r) => { open = r; });
    void result.current.refresh(); // a load in flight
    await settle();
    net.leases = [{ id: 'l-3', level: 'requirement', holder_label: 'Claude', since: '2026-10-02T20:00:00Z', heartbeat_at: new Date().toISOString() }];
    let done = false;
    const after = result.current.refresh().then(() => { done = true; });
    net.gate = null;
    open();
    await settle();
    await after;
    expect(done).toBe(true);
    expect(reads('agent_checkouts')).toBe(3);
    expect(result.current.holds.map((h) => h.checkoutId)).toEqual(['l-3']);
  });
});

describe('AL.20 · leaving stops the board', () => {
  it('the last unmount closes the channel and the timer; coming back loads afresh', async () => {
    const view = render(<FourPresenceMounts projectId="p-1" />);
    await settle();
    view.unmount();
    expect(net.channels[0].removed).toBe(true);
    await settle(5 * 60_000);
    expect(reads('agent_checkouts')).toBe(1);
    render(<FourPresenceMounts projectId="p-1" />);
    await settle();
    expect(reads('agent_checkouts')).toBe(2);
  });
});

describe('AL.20 · the approvals queue', () => {
  const PLAN = { workflows: true, priority: true, repoImport: true };
  it('the Agents panel and Work share one queue: one proposal list read per load', async () => {
    renderHook(() => { useApprovalsQueue('p-1', PLAN); useApprovalsQueue('p-1', PLAN); });
    await settle();
    expect(reads('ai_proposals')).toBe(1);
    await settle(30_000);
    expect(reads('ai_proposals')).toBe(2);
  });

  it('a different plan is a different queue', async () => {
    renderHook(() => { useApprovalsQueue('p-1', PLAN); useApprovalsQueue('p-1', { ...PLAN, priority: false }); });
    await settle();
    expect(reads('ai_proposals')).toBe(2);
  });

  it('idle, the queue slows to a minute and no further', async () => {
    renderHook(() => useApprovalsQueue('p-1', PLAN));
    await settle();
    await settle(10 * 60_000);
    // 0, 30, 60, then every 60 s to 600: 12 loads, against 21 at a fixed 30 s
    expect(reads('ai_proposals')).toBe(12);
  });
});

describe('AL.20 · the store itself', () => {
  it('the interval doubles after every two unchanged loads, up to the cap', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((n) => nextDelay(30_000, n, 4))).toEqual([30_000, 30_000, 60_000, 60_000, 120_000, 120_000, 120_000, 120_000]);
    expect(nextDelay(30_000, 9, 1)).toBe(30_000);
  });

  it('a failed load keeps what was shown and carries the error', async () => {
    let fail = false;
    const { result } = renderHook(() => useSharedPoll({ key: 'k-1', load: async () => { if (fail) throw new Error('timed out'); return ['row']; }, empty: [] as string[], intervalMs: 1000 }));
    await settle();
    expect(result.current).toMatchObject({ data: ['row'], loading: false, error: null });
    fail = true;
    await settle(1000);
    expect(result.current).toMatchObject({ data: ['row'], loading: false, error: 'timed out' });
  });

  it('no key loads nothing', async () => {
    const load = vi.fn(async () => 1);
    const { result } = renderHook(() => useSharedPoll({ key: null, load, empty: 0, intervalMs: 1000 }));
    await settle(5000);
    expect(load).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ data: 0, loading: false });
  });
});

// @vitest-environment jsdom
// AL.4 (owner 2026-10-01): "Our 3D canvas has to be refreshed or clicked out
// of in order to show new data instead of the data appearing shortly after
// being populated in our backend." Work listens on the open project for
// changes to what it draws and re-reads once a burst of them settles; a
// re-read every half minute while the page is in view stands in for an
// install without change events, and coming back to the tab re-reads.
// The subscription is the Supabase channel itself, recorded here: what it
// listens to, what a change does, and that leaving takes it down.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

type Binding = { event: string; schema: string; table: string; filter?: string };
const rt = vi.hoisted(() => ({
  channels: [] as Array<{ name: string; bindings: Binding[]; handlers: Array<() => void>; subscribed: boolean }>,
  removed: [] as string[],
  gate: Promise.resolve() as Promise<void>,
  reqRows: [] as Array<Record<string, unknown>>,
}));
vi.mock('../persistence/supabase/client.js', () => ({
  getSupabaseClient: () => ({
    channel: (name: string) => {
      const ch = { name, bindings: [] as Binding[], handlers: [] as Array<() => void>, subscribed: false };
      rt.channels.push(ch);
      const api = {
        on: (_kind: string, b: Binding, h: () => void) => { ch.bindings.push(b); ch.handlers.push(h); return api; },
        subscribe: () => { ch.subscribed = true; return ch; },
      };
      return api;
    },
    removeChannel: (ch: { name: string }) => { rt.removed.push(ch.name); },
    // the requirement list's reads; the rows wait on a gate the test opens
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
      b.maybeSingle = async () => ({ data: table === 'project_specifications' ? { id: 'spec-1' } : null, error: null });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        (table === 'specification_requirements' ? rt.gate : Promise.resolve()).then(() => ({ data: table === 'specification_requirements' ? rt.reqRows : [], error: null })).then(res, rej);
      return b;
    },
  }),
}));
const { useWorkLive, workLiveTables, WORK_LIVE_DEBOUNCE_MS, WORK_LIVE_POLL_MS } = await import('../ui/components/work/useWorkLive.js');
const { useRequirementBand } = await import('../ui/components/ideation/useRequirementBand.js');

const P = 'p-1', B = 'b-1';
let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  rt.channels.length = 0; rt.removed.length = 0;
  hidden = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
});
afterEach(() => { vi.useRealTimers(); });

describe('AL.4 · what Work listens to', () => {
  it('the project workflows, stages, outcomes, maps, derivations, constraints, proposals, requirements, tasks, tests and plan; branch tables by the branch', () => {
    expect(workLiveTables(P, B)).toEqual([
      { table: 'workflows', filter: 'project_id=eq.p-1' },
      { table: 'workflow_steps' },
      { table: 'requirement_candidates', filter: 'project_id=eq.p-1' },
      { table: 'outcome_step_maps', filter: 'branch_id=eq.b-1' },
      { table: 'outcome_derivations', filter: 'project_id=eq.p-1' },
      { table: 'project_constraints', filter: 'project_id=eq.p-1' },
      { table: 'ai_proposals', filter: 'source_branch_id=eq.b-1' },
      { table: 'specification_requirements' },
      { table: 'task_items', filter: 'project_id=eq.p-1' },
      { table: 'test_cases' },
      { table: 'work_plans', filter: 'branch_id=eq.b-1' },
    ]);
    // no branch yet: the branch tables are heard unfiltered rather than not at all
    expect(workLiveTables(P, null).filter((t) => ['outcome_step_maps', 'ai_proposals', 'work_plans'].includes(t.table))).toEqual([
      { table: 'outcome_step_maps' }, { table: 'ai_proposals' }, { table: 'work_plans' },
    ]);
  });

  it('one channel on the project, every table bound for every event, subscribed', () => {
    renderHook(() => useWorkLive(P, B, () => {}));
    expect(rt.channels.map((c) => [c.name, c.subscribed])).toEqual([['work-live-p-1', true]]);
    expect(rt.channels[0].bindings).toEqual(workLiveTables(P, B).map((t) => ({ event: '*', schema: 'public', ...t })));
  });

  it('no project, no channel', () => {
    renderHook(() => useWorkLive(null, null, () => {}));
    expect(rt.channels).toEqual([]);
  });
});

describe('AL.4 · what a change does', () => {
  it('a burst of changes re-reads once, after it settles', () => {
    const reread = vi.fn();
    renderHook(() => useWorkLive(P, B, reread));
    const fire = (i: number) => rt.channels[0].handlers[i]();
    fire(0); fire(2); vi.advanceTimersByTime(WORK_LIVE_DEBOUNCE_MS - 1); fire(6);
    vi.advanceTimersByTime(WORK_LIVE_DEBOUNCE_MS - 1);
    expect(reread).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('the latest re-read runs, not the one the channel was opened with', () => {
    const first = vi.fn(), second = vi.fn();
    const { rerender } = renderHook(({ r }) => useWorkLive(P, B, r), { initialProps: { r: first } });
    rerender({ r: second });
    expect(rt.channels.length).toBe(1);
    rt.channels[0].handlers[0]();
    vi.advanceTimersByTime(WORK_LIVE_DEBOUNCE_MS);
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([0, 1]);
  });

  it('with no change heard, it re-reads every half minute while in view, not while hidden; coming back re-reads', () => {
    const reread = vi.fn();
    renderHook(() => useWorkLive(P, B, reread));
    vi.advanceTimersByTime(WORK_LIVE_POLL_MS);
    expect(reread).toHaveBeenCalledTimes(1);
    hidden = true;
    vi.advanceTimersByTime(WORK_LIVE_POLL_MS * 2);
    expect(reread).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(WORK_LIVE_DEBOUNCE_MS);
    expect(reread).toHaveBeenCalledTimes(2);
  });

  it('leaving takes the channel down and nothing re-reads after; another project opens its own', () => {
    const reread = vi.fn();
    const { rerender, unmount } = renderHook(({ p }) => useWorkLive(p, B, reread), { initialProps: { p: P } });
    rerender({ p: 'p-2' });
    expect(rt.removed).toEqual(['work-live-p-1']);
    expect(rt.channels.map((c) => c.name)).toEqual(['work-live-p-1', 'work-live-p-2']);
    expect(rt.channels[1].bindings[0]).toEqual({ event: '*', schema: 'public', table: 'workflows', filter: 'project_id=eq.p-2' });
    rt.channels[1].handlers[0]();
    unmount();
    expect(rt.removed).toEqual(['work-live-p-1', 'work-live-p-2']);
    vi.advanceTimersByTime(WORK_LIVE_POLL_MS * 2);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(WORK_LIVE_DEBOUNCE_MS);
    expect(reread).not.toHaveBeenCalled();
  });
});

describe('AL.4 · a re-read does not blank the requirement list', () => {
  it('the first read of a project says loading; a re-read keeps the rows on screen until the new ones land', async () => {
    vi.useRealTimers();
    let open: () => void = () => {};
    const row = (id: string, ref: string) => ({ id, requirement_id: ref, name: ref, status: null, locked: false, confirmed: false, acceptance_criteria: [], metadata: {}, archived_at: null });
    rt.reqRows = [row('r1', 'REQ-001')];
    rt.gate = new Promise<void>((r) => { open = r; });
    const { result } = renderHook(() => useRequirementBand('p-1', 0));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loading).toBe(true);
    await act(async () => { open(); await rt.gate; });
    await vi.waitFor(() => expect(result.current.rows.map((r) => r.ref)).toEqual(['REQ-001']));
    expect(result.current.loading).toBe(false);

    rt.reqRows = [row('r1', 'REQ-001'), row('r2', 'REQ-002')];
    rt.gate = new Promise<void>((r) => { open = r; });
    let again: Promise<void> = Promise.resolve();
    await act(async () => { again = result.current.refresh(); await Promise.resolve(); });
    expect([result.current.loading, result.current.rows.length]).toEqual([false, 1]);
    await act(async () => { open(); await again; });
    expect(result.current.rows.map((r) => r.ref)).toEqual(['REQ-001', 'REQ-002']);
  });
});

// AL.20 (owner 2026-10-02: "our production app is really lagging across
// multiple functions"). The V3 surfaces each polled the database on their own:
// presence was mounted four times, the approvals queue and the plan board
// twice, every copy on its own 30 second timer, in hidden tabs too, and a burst
// of change events reloaded every copy once per event. Two signed-in people
// sent about 15,000 requests in six hours.
//
// One entry per key now serves every mount of a hook: one load in flight, one
// timer, one change subscription. The timer waits while the tab is hidden and
// catches up when it comes back; it slows down while loads come back
// unchanged; a burst of change events becomes one reload.
import { useCallback, useRef, useSyncExternalStore } from 'react';

export interface SharedPollState<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

export interface SharedPollOptions<T> {
  /** Every mount with the same key shares one entry; null reads `empty` and loads nothing. */
  key: string | null;
  load: () => Promise<T>;
  empty: T;
  intervalMs: number;
  /** While loads come back unchanged the interval doubles, up to intervalMs times this. 1 keeps it fixed. */
  maxBackoff?: number;
  /** Subscribes to change events, calling poke on each; returns the unsubscribe. Called once per entry. */
  listen?: (poke: () => void) => () => void;
}

/** A burst of change events settles this long before the one reload. */
export const POKE_DEBOUNCE_MS = 300;
/** A stream of change events still reloads at least this often. */
export const POKE_MAX_WAIT_MS = 2000;
/** Unchanged loads in a row before the interval doubles. */
export const UNCHANGED_BEFORE_SLOWER = 2;

interface Entry {
  state: SharedPollState<unknown>;
  listeners: Set<() => void>;
  load: () => Promise<unknown>;
  intervalMs: number;
  maxBackoff: number;
  unchanged: number;
  print: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  inflight: Promise<void> | null;
  queued: Promise<void> | null;
  missed: boolean;
  poke: ReturnType<typeof setTimeout> | null;
  pokeFirst: number | null;
  stop: (() => void) | null;
  live: boolean;
}

const entries = new Map<string, Entry>();

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** The wait before the next load: the interval, doubled for every UNCHANGED_BEFORE_SLOWER unchanged loads, capped. Pure. */
export function nextDelay(intervalMs: number, unchanged: number, maxBackoff: number): number {
  return intervalMs * Math.max(1, Math.min(maxBackoff, 2 ** Math.floor(unchanged / UNCHANGED_BEFORE_SLOWER)));
}

function fingerprint(value: unknown): string | null {
  try {
    return JSON.stringify(value, (_k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));
  } catch {
    return null;
  }
}

function emit(e: Entry, next: SharedPollState<unknown>) {
  e.state = next;
  for (const listener of [...e.listeners]) listener();
}

// One load at a time. A call while one is in flight is answered by the next
// load, started after the current one ends, so a caller that just wrote reads
// what it wrote.
function run(e: Entry): Promise<void> {
  if (e.inflight) {
    e.queued ??= e.inflight.then(() => {
      e.queued = null;
      return e.live ? run(e) : undefined;
    });
    return e.queued;
  }
  e.inflight = (async () => {
    try {
      const data = await e.load();
      if (!e.live) return;
      const print = fingerprint(data);
      if (print !== null && print === e.print) {
        e.unchanged += 1;
        if (e.state.loading || e.state.error) emit(e, { ...e.state, loading: false, error: null });
      } else {
        e.unchanged = 0;
        e.print = print;
        emit(e, { data, loading: false, error: null });
      }
    } catch (err) {
      if (!e.live) return;
      emit(e, { ...e.state, loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  })().finally(() => {
    e.inflight = null;
  });
  return e.inflight;
}

function schedule(e: Entry) {
  if (e.timer) clearTimeout(e.timer);
  e.timer = null;
  if (!e.live) return;
  e.timer = setTimeout(() => {
    e.timer = null;
    if (!e.live) return;
    // Hidden: no load and no next timer; coming back to the tab loads once.
    if (isHidden()) { e.missed = true; return; }
    void run(e).then(() => schedule(e));
  }, nextDelay(e.intervalMs, e.unchanged, e.maxBackoff));
}

/** Load now at the base interval: a write, a change event, the tab coming back. */
function fresh(e: Entry): Promise<void> {
  e.unchanged = 0;
  const p = run(e);
  void p.then(() => schedule(e));
  return p;
}

function poke(e: Entry) {
  if (!e.live) return;
  const now = Date.now();
  e.pokeFirst ??= now;
  if (e.poke) clearTimeout(e.poke);
  const wait = Math.max(0, Math.min(POKE_DEBOUNCE_MS, e.pokeFirst + POKE_MAX_WAIT_MS - now));
  e.poke = setTimeout(() => {
    e.poke = null;
    e.pokeFirst = null;
    if (!e.live) return;
    if (isHidden()) { e.missed = true; return; }
    void fresh(e);
  }, wait);
}

let watching = false;
function watchVisibility() {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    if (isHidden()) return;
    for (const e of entries.values()) {
      if (e.missed) { e.missed = false; void fresh(e); }
    }
  });
}

function acquire(key: string, latest: { current: SharedPollOptions<unknown> }): Entry {
  const existing = entries.get(key);
  if (existing) return existing;
  const o = latest.current;
  const e: Entry = {
    state: { data: o.empty, loading: true, error: null },
    listeners: new Set(),
    load: () => latest.current.load(),
    intervalMs: o.intervalMs,
    maxBackoff: Math.max(1, o.maxBackoff ?? 1),
    unchanged: 0,
    print: null,
    timer: null,
    inflight: null,
    queued: null,
    missed: false,
    poke: null,
    pokeFirst: null,
    stop: null,
    live: true,
  };
  entries.set(key, e);
  watchVisibility();
  if (o.listen) {
    try { e.stop = o.listen(() => poke(e)); } catch { e.stop = null; }
  }
  void fresh(e);
  return e;
}

function release(key: string, e: Entry, listener: () => void) {
  e.listeners.delete(listener);
  if (e.listeners.size > 0) return;
  e.live = false;
  if (e.timer) clearTimeout(e.timer);
  if (e.poke) clearTimeout(e.poke);
  try { e.stop?.(); } catch { /* already gone */ }
  if (entries.get(key) === e) entries.delete(key);
}

export function useSharedPoll<T>(options: SharedPollOptions<T>): SharedPollState<T> & { refresh: () => Promise<void> } {
  const latest = useRef(options);
  latest.current = options;
  const { key } = options;

  const subscribe = useCallback((onChange: () => void) => {
    if (!key) return () => {};
    const e = acquire(key, latest as { current: SharedPollOptions<unknown> });
    e.listeners.add(onChange);
    return () => release(key, e, onChange);
  }, [key]);

  const fallback = useRef<{ key: string | null; state: SharedPollState<T> } | null>(null);
  const getSnapshot = useCallback((): SharedPollState<T> => {
    const e = key ? entries.get(key) : undefined;
    if (e) return e.state as SharedPollState<T>;
    if (!fallback.current || fallback.current.key !== key) {
      fallback.current = { key, state: { data: latest.current.empty, loading: key !== null, error: null } };
    }
    return fallback.current.state;
  }, [key]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const refresh = useCallback(async () => {
    const e = key ? entries.get(key) : undefined;
    if (e) await fresh(e);
  }, [key]);
  return { ...state, refresh };
}

/** setInterval for a poll the person reads: skipped while the tab is hidden,
 *  run once on coming back if a tick was skipped. Returns the cleanup. */
export function everyVisible(fn: () => void, ms: number): () => void {
  let missed = false;
  const timer = setInterval(() => {
    if (isHidden()) { missed = true; return; }
    fn();
  }, ms);
  const onVisibility = () => {
    if (!isHidden() && missed) { missed = false; fn(); }
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  return () => {
    clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}

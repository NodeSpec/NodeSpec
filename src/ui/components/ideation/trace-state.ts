// V3 P5 (task 5.2, finding F4): ONE five-state module for Trace. Every
// record the grid renders — criterion, task, test case, source file, test
// file — resolves to exactly one of five states by the pinned precedence
//
//   fail → live → stale → open → ok        (first match wins)
//
// and every rollup (a card, a chain row, the side counts) takes the WORST
// state present by the same order. Pure: no I/O, no clock — the vitest
// matrix pins every rule, and no surface derives a state anywhere else.

import { DONE_WORD } from './done-state.js';
import { STATE_LABEL } from './typography.js';

export type TraceState = 'fail' | 'live' | 'stale' | 'open' | 'ok';

export const TRACE_STATE_ORDER: readonly TraceState[] = ['fail', 'live', 'stale', 'open', 'ok'];

/** The legend the design draws beside the grid. R24: the state NAME only —
 *  the per-kind vocabulary moved to TRACE_STATE_COVERS below, because the
 *  old labels enumerated SOME of the words a card can show and not others
 *  ('unmet', 'orphaned', 'skipped', 'bound' appeared on cards but in no
 *  key, and a manual criterion reads 'awaiting approval' where the key
 *  said 'awaiting action'). */
// 9.8: the words are the ONE table every surface reads; Trace's legend,
// Priority's stripe and the Workflow band cannot drift.
// 9.12: DONE_WORD stays the stored vocabulary (it is shared with the server
// and travels in responses); STATE_LABEL is how those same five are WRITTEN
// for a reader, in sentence case, in one place instead of upper-cased at
// each call site. The keys are the same type, so they cannot diverge.
export const TRACE_STATE_LABEL: Record<TraceState, string> = STATE_LABEL;
/** The stored vocabulary, lower case, as the server speaks it. */
export const TRACE_STATE_STORED_WORD: Record<TraceState, string> = DONE_WORD;

/** R24: the CANONICAL index — every right-edge word a record can show,
 *  filed under the one state that produces it, named against the backend
 *  column that decides it. The legend renders this as each swatch's title,
 *  and trace-state.test.ts asserts the cover is EXHAUSTIVE and DISJOINT
 *  against the words useTraceData actually emits, so a new word cannot
 *  appear on a card without appearing in the key.
 *
 *  Backend vocabulary these resolve from:
 *    test_cases.status   not_started | passed | failed | skipped | running
 *    test_cases.stale    boolean
 *    task_items.done / .orphaned   booleans
 *    criterion.met / .evidenceStale / .verification ('manual')
 *    artifacts           drift / stale (git lane), lease at code level
 *    agent_checkouts     an active lease on the record = 'in work' */
export const TRACE_STATE_COVERS: Record<TraceState, readonly string[]> = {
  ok: ['met', 'passed', 'done', 'done · evidence', 'bound', 'test'],
  stale: ['stale', 'drift', 'orphaned'],
  open: ['unmet', 'open', 'not started', 'skipped'],
  live: ['in work', 'running'],
  fail: ['failed', 'awaiting action', 'awaiting approval'],
};

/** One line per state for the legend's tooltip: what the backend had to
 *  say for a record to read this way. */
export const TRACE_STATE_MEANING: Record<TraceState, string> = {
  ok: 'criterion met · test passed · task done · file bound',
  stale: 'evidence went stale · the repo drifted · the task key is orphaned',
  open: 'not started yet — criterion unmet, test not started or skipped',
  live: 'an agent holds a lease on it · a test is running',
  fail: 'a test failed, or a manual item is waiting on YOU (approval or a step to perform)',
};

/** The short word a record's right edge shows for each state. */
export const TRACE_STATE_WORD: Record<TraceState, string> = {
  ok: 'done', stale: 'stale', open: 'open', live: 'in work', fail: 'awaiting action',
};

/** First flagged state in precedence order; nothing flagged reads open. */
export function resolveTraceState(flags: Partial<Record<TraceState, boolean>>): TraceState {
  for (const s of TRACE_STATE_ORDER) if (flags[s]) return s;
  return 'open';
}

/** The worst state present, by precedence; an empty set reads open. */
export function rollupTraceState(states: readonly TraceState[]): TraceState {
  for (const s of TRACE_STATE_ORDER) if (states.includes(s)) return s;
  return 'open';
}

export function countTraceStates(states: readonly TraceState[]): Record<TraceState, number> {
  const out: Record<TraceState, number> = { fail: 0, live: 0, stale: 0, open: 0, ok: 0 };
  for (const s of states) out[s] += 1;
  return out;
}

/** A criterion: met with fresh evidence is ok; met but evidence-stale is
 *  stale; a manual criterion not yet proven awaits the human (fail — the
 *  design's "awaiting action"); anything else is open. */
export function criterionTraceState(c: { met?: boolean; evidenceStale?: unknown; verification?: string }): TraceState {
  const met = c.met === true;
  return resolveTraceState({
    fail: !met && c.verification === 'manual',
    stale: met && c.evidenceStale != null && c.evidenceStale !== false,
    open: !met,
    ok: met,
  });
}

/** A task: held by an agent is live; a manual task nobody holds and nobody
 *  ticked awaits the human; an orphaned key (the doc no longer emits it)
 *  is drift; ticked or evidence-done is ok. */
export function taskTraceState(t: { done: boolean; evidenceDone?: boolean; orphaned?: boolean; manual?: boolean; live?: string | null }): TraceState {
  const done = t.done || t.evidenceDone === true;
  return resolveTraceState({
    live: !!t.live,
    // the design's manualWaiting: a held manual task is in work, not waiting
    fail: !done && !!t.manual && !t.live,
    stale: !done && t.orphaned === true,
    open: !done,
    ok: done,
  });
}

/** A test case: failed fails; running is live; a stale verdict is stale;
 *  passed is ok; not started / skipped is open. */
export function testTraceState(t: { status: string; stale?: boolean | null }): TraceState {
  return resolveTraceState({
    fail: t.status === 'failed',
    live: t.status === 'running',
    stale: t.stale === true,
    open: t.status !== 'passed',
    ok: t.status === 'passed',
  });
}

/** A bound file: changed in the repo after the last accepted state (drift)
 *  or covering a stale run is stale; held at code level is live; else ok —
 *  a bound file is a settled fact, not open work. */
export function artifactTraceState(a: { drift?: boolean; stale?: boolean; live?: string | null }): TraceState {
  return resolveTraceState({
    live: !!a.live,
    stale: a.drift === true || a.stale === true,
    ok: true,
  });
}

/** The five-state palette, the design's `--st-*` tokens per theme. */
export const TRACE_STATE_COLOR: Record<'dark' | 'light', Record<TraceState, string>> = {
  dark: { ok: '#4fc98f', stale: '#e2c250', open: '#6c748f', live: '#9b9ff0', fail: '#ee6b70' },
  light: { ok: '#1f9d63', stale: '#c9a227', open: '#9a9fb1', live: '#5d5fd0', fail: '#d1454d' },
};

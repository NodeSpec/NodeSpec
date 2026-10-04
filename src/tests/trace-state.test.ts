import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TRACE_STATE_COVERS, TRACE_STATE_MEANING, TRACE_STATE_ORDER,
  criterionTraceState, taskTraceState, testTraceState, artifactTraceState, type TraceState,
} from '../ui/components/ideation/trace-state.js';

// R24 → V3 4.1: the five-state key (Done, Stale, Open, In work, Needs
// action) is canonical for every surface that shows evidence. The grid that
// first drew it retired with V3 4.1; the key, the cover and the state
// functions did not, and Work's requirement rail reads them through the
// verify lane. These do not pin strings: they RUN the state functions over
// the backend's own vocabulary and assert the key covers exactly what comes
// out.

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

describe('R24 · the five-state key is canonical', () => {
  // The vocabulary the database actually permits:
  //   test_cases.status CHECK IN ('not_started','passed','failed','skipped','running')
  //   (supabase/migrations/20260119154603_add_specification_mappings.sql)
  const TEST_STATUSES = ['not_started', 'passed', 'failed', 'skipped', 'running'] as const;

  it('the cover is DISJOINT — no word is filed under two states', () => {
    const seen = new Map<string, TraceState>();
    for (const state of TRACE_STATE_ORDER) {
      for (const word of TRACE_STATE_COVERS[state]) {
        expect(seen.has(word), `"${word}" is filed under both ${seen.get(word)} and ${state}`).toBe(false);
        seen.set(word, state);
      }
    }
  });

  it('every test_cases.status the database permits resolves to a state whose cover names its word', () => {
    const wordOf = (status: string) => status.replace('_', ' '); // useTraceData's own display
    for (const status of TEST_STATUSES) {
      const state = testTraceState({ status, stale: null });
      expect(TRACE_STATE_COVERS[state], `${status} → ${state}`).toContain(wordOf(status));
    }
    // and the stale column overrides the status word, under 'stale'
    expect(testTraceState({ status: 'passed', stale: true })).toBe('stale');
    expect(TRACE_STATE_COVERS.stale).toContain('stale');
  });

  it('every criterion, task and artifact word the grid emits is covered by its own state', () => {
    // criterion (useTraceData: met → 'met'/'stale', manual → 'awaiting approval', else 'unmet')
    expect(TRACE_STATE_COVERS[criterionTraceState({ met: true })]).toContain('met');
    expect(TRACE_STATE_COVERS[criterionTraceState({ met: true, evidenceStale: true })]).toContain('stale');
    expect(TRACE_STATE_COVERS[criterionTraceState({ met: false, verification: 'manual' })]).toContain('awaiting approval');
    expect(TRACE_STATE_COVERS[criterionTraceState({ met: false })]).toContain('unmet');
    // task ('in work' / 'done · evidence' / 'done' / 'awaiting action' / 'orphaned' / 'open')
    expect(TRACE_STATE_COVERS[taskTraceState({ done: false, live: 'agent' })]).toContain('in work');
    expect(TRACE_STATE_COVERS[taskTraceState({ done: false, evidenceDone: true })]).toContain('done · evidence');
    expect(TRACE_STATE_COVERS[taskTraceState({ done: true })]).toContain('done');
    expect(TRACE_STATE_COVERS[taskTraceState({ done: false, manual: true })]).toContain('awaiting action');
    expect(TRACE_STATE_COVERS[taskTraceState({ done: false, orphaned: true })]).toContain('orphaned');
    expect(TRACE_STATE_COVERS[taskTraceState({ done: false })]).toContain('open');
    // artifact ('in work' / 'drift' / 'stale' / 'test' / 'bound')
    expect(TRACE_STATE_COVERS[artifactTraceState({ live: 'agent' })]).toContain('in work');
    expect(TRACE_STATE_COVERS[artifactTraceState({ drift: true })]).toContain('drift');
    expect(TRACE_STATE_COVERS[artifactTraceState({ stale: true })]).toContain('stale');
    expect(TRACE_STATE_COVERS[artifactTraceState({})]).toContain('bound');
    expect(TRACE_STATE_COVERS[artifactTraceState({})]).toContain('test');
  });

  it('the cover is EXHAUSTIVE — every literal word useTraceData assigns to `right` is in the key', () => {
    // Read the emitter itself, so a NEW word cannot reach a card without
    // reaching the key: the words are the string literals in its `right:`
    // expressions (the test lane's dynamic word is proven above).
    const src = read('src/ui/components/ideation/useTraceData.ts');
    // the assignments, not the `right: string` field declaration
    const rightLines = src.split('\n').filter((l) => /^\s*right:/.test(l) && l.includes("'"));
    expect(rightLines.length, 'one right: assignment per record kind (criterion, task, test, artifact)').toBe(4);
    const covered = new Set(TRACE_STATE_ORDER.flatMap((s) => [...TRACE_STATE_COVERS[s]]));
    for (const raw of rightLines) {
      // Only literals in VALUE position are words a card shows. Drop the
      // ones being compared against (`c.verification === 'manual'`) and the
      // .replace() arguments — those are inputs, not output vocabulary.
      const line = raw.replace(/[=!]==\s*'[^']*'/g, '').replace(/\.replace\([^)]*\)/g, '');
      for (const [, word] of line.matchAll(/'([^']+)'/g)) {
        expect(covered, `"${word}" reaches a card but is in no legend entry`).toContain(word);
      }
    }
  });

  it('every state has a meaning line the legend can print', () => {
    for (const s of TRACE_STATE_ORDER) expect(TRACE_STATE_MEANING[s].length).toBeGreaterThan(10);
  });
});

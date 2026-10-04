// V3 9.11 (R4 + R6's app half): the VERIFY LANE, the requirement detail
// surface Trace opens on a REQ card. Pure rows-in, rows-out.
//
// A criterion's binding to a test case is by EXACT text (report_test_results
// matches criterion_text byte for byte against the stored text), and that
// rule is correct and invisible: it is the largest source of silent
// `unbound` receipts. This lane makes it visible. Every criterion arrives in
// one of four buckets, ordered by what needs doing first:
//
//   unbound → red → stale → green
//
// with its binding state in words, the EXACT text an agent must copy, and
// the next step. The red step is named (R6): a `failed` report flips met to
// false with provenance, a genuine, auditable RED, the first half of the TDD
// cycle the lane is built for.
//
// Edits keep identity (v3l): a reword writes the same `id` (materialised
// from the text hash for a row drafted before ids existed) and carries every
// evidence passenger (met, testId, provenance, evidenceStale) untouched, so
// the binding holds by id while the note says the old exact text no longer
// matches. Nothing here writes; the grid does, through one guarded path.

import { criterionIdOf, normalizeCriterionText, newCriterionId } from './criterion-identity.js';
import type { TraceState } from './trace-state.js';

export type VerifyBucket = 'unbound' | 'red' | 'stale' | 'green';
export const VERIFY_ORDER: readonly VerifyBucket[] = ['unbound', 'red', 'stale', 'green'];

/** 9.12: written as a reader sees them. Sentence case, like every other
 *  state word on these surfaces; the KEYS stay the vocabulary. */
export const VERIFY_BUCKET_LABEL: Record<VerifyBucket, string> = {
  unbound: 'Unbound', red: 'Red', stale: 'Stale', green: 'Green',
};

export const VERIFY_BUCKET_MEANING: Record<VerifyBucket, string> = {
  unbound: 'no test names this exact text yet',
  red: 'a test is bound and has not passed',
  stale: 'met, but a source the test covers changed since',
  green: 'met with fresh evidence',
};

/** The bucket's colour is the grid's five-state key, never a sixth palette. */
export const VERIFY_BUCKET_STATE: Record<VerifyBucket, TraceState> = {
  unbound: 'open', red: 'fail', stale: 'stale', green: 'ok',
};

export type VerifyLaneKind = 'automated' | 'manual';

/** One stored criterion, passengers and all. Unknown keys survive a rewrite. */
export interface StoredCriterion {
  id?: string;
  text: string;
  met?: boolean;
  testId?: string;
  verification?: VerifyLaneKind;
  provenance?: { source?: string; commitSha?: string; actor?: string; at?: string; testCaseId?: string } | null;
  evidenceStale?: { at?: string; commitSha?: string; reason?: string } | boolean | null;
  [passenger: string]: unknown;
}

export interface VerifyTest {
  id: string;
  test_id: string;
  name: string;
  status: string;
  stale: boolean | null;
  /** 'manual' when the person added it in Work; agents' cases carry none. */
  source?: string | null;
  /** test_cases.test_type and .framework, when the case names them. */
  testType?: string | null;
  framework?: string | null;
}

/** What the lane needs from a requirement row, carried on its Trace chain. */
export interface VerifySource {
  locked: boolean;
  mark: string | null;
  /** The row's updated_at when Trace read it: the write's concurrency token. */
  updatedAt: string | null;
  criteria: StoredCriterion[];
  tests: VerifyTest[];
  /** 9.10: the Spec sidebar's writes moved here; the lane edits the description too. */
  description: string;
  /** 9.10: the explicit archive (v3y) is toggled here; lineage archive has nothing to clear. */
  archivedAt: string | null;
}

export const EMPTY_VERIFY: VerifySource = { locked: false, mark: null, updatedAt: null, criteria: [], tests: [], description: '', archivedAt: null };

export interface VerifyRow {
  /** The criterion's identity (written id, else the text hash). */
  id: string;
  /** Its position in the stored list: the AC number. */
  index: number;
  text: string;
  /** The text report_test_results matches: whitespace-normalised, trimmed. */
  exact: string;
  lane: VerifyLaneKind;
  bucket: VerifyBucket;
  state: TraceState;
  test: VerifyTest | null;
  /** The binding state, in words. */
  binding: string;
  /** The next step, in words. The red step is named (R6). */
  next: string;
}

const isStale = (c: StoredCriterion, test: VerifyTest | null): boolean =>
  (c.evidenceStale != null && c.evidenceStale !== false) || test?.stale === true;

export function bucketOf(c: StoredCriterion, test: VerifyTest | null): VerifyBucket {
  const met = c.met === true;
  if (c.verification === 'manual') return met ? 'green' : 'unbound';
  if (met) return isStale(c, test) ? 'stale' : 'green';
  return typeof c.testId === 'string' && c.testId.length > 0 ? 'red' : 'unbound';
}

const short = (sha: string | undefined) => (sha ? sha.slice(0, 7) : null);

function bindingOf(c: StoredCriterion, bucket: VerifyBucket, test: VerifyTest | null): string {
  if (c.verification === 'manual') {
    return bucket === 'green'
      ? 'manual lane: proven by the approved task-doc tick'
      : 'manual lane: proven by the task-doc tick and your approval, never by a test';
  }
  if (bucket === 'unbound') return 'not bound: no report has named this exact text';
  if (!test) return 'bound to a case that is retired or gone';
  const ref = `bound to ${test.test_id}`;
  if (bucket === 'stale') return `${ref}, evidence stale`;
  if (bucket === 'green') return `${ref}, passed`;
  if (test.status === 'failed') return `${ref}, failed`;
  if (test.status === 'running') return `${ref}, running`;
  return `${ref}, not run yet`;
}

function nextOf(c: StoredCriterion, bucket: VerifyBucket, test: VerifyTest | null): string {
  if (c.verification === 'manual') {
    return bucket === 'green'
      ? 'Proven by the approved tick. Nothing to do.'
      : "Tick its box in the owning node's task doc and approve the change card.";
  }
  switch (bucket) {
    case 'unbound':
      return 'Write the failing test first and report it: a failed report flips met to false with provenance, a genuine RED. Bind it by passing this exact text as criterion_text.';
    case 'red':
      if (!test) return 'The bound case is gone. Report a fresh run with this exact text to bind a live case.';
      if (test.status === 'failed') return 'RED. The failing test ran first. Fix, run it green, then report again with the same test_id.';
      return 'Bound but not run yet. Run it and report; the first report should be the RED.';
    case 'stale':
      return 'Re-run the bound test and report it; a fresh result re-verifies this criterion.';
    case 'green': {
      const prov = c.provenance ?? null;
      const at = typeof prov?.at === 'string' ? prov.at.slice(0, 10) : null;
      const sha = short(typeof prov?.commitSha === 'string' ? prov.commitSha : undefined);
      const by = [test ? test.test_id : null, sha ? `commit ${sha}` : null, at].filter(Boolean).join(', ');
      return by ? `Proven by ${by}. Nothing to do.` : 'Proven. Nothing to do.';
    }
  }
}

/** Every criterion as a lane row, ordered unbound → red → stale → green,
 *  ties by stored position. */
export function verifyRows(criteria: readonly StoredCriterion[], tests: readonly VerifyTest[]): VerifyRow[] {
  const byId = new Map(tests.map((t) => [t.id, t]));
  const rows = criteria.map((c, index): VerifyRow => {
    const test = typeof c.testId === 'string' ? byId.get(c.testId) ?? null : null;
    const bucket = bucketOf(c, test);
    const lane: VerifyLaneKind = c.verification === 'manual' ? 'manual' : 'automated';
    // A manual criterion awaiting its tick is the design's "awaiting action"
    // (fail) on the grid; the lane keeps that colour.
    const state: TraceState = lane === 'manual' && bucket === 'unbound' ? 'fail' : bucket === 'red' && test?.status !== 'failed' ? 'open' : VERIFY_BUCKET_STATE[bucket];
    return {
      id: criterionIdOf(c), index, text: String(c.text ?? ''), exact: normalizeCriterionText(c.text),
      lane, bucket, state, test,
      binding: bindingOf(c, bucket, test), next: nextOf(c, bucket, test),
    };
  });
  const rank = (b: VerifyBucket) => VERIFY_ORDER.indexOf(b);
  return rows.sort((a, b) => rank(a.bucket) - rank(b.bucket) || a.index - b.index);
}

export function verifyCounts(rows: readonly VerifyRow[]): Record<VerifyBucket, number> {
  const out: Record<VerifyBucket, number> = { unbound: 0, red: 0, stale: 0, green: 0 };
  for (const r of rows) out[r.bucket] += 1;
  return out;
}

/** "2 green · 1 stale · 1 unbound": only the buckets present, in lane order. */
export function verifyCountsLabel(counts: Record<VerifyBucket, number>): string {
  return VERIFY_ORDER.filter((b) => counts[b] > 0).map((b) => `${counts[b]} ${VERIFY_BUCKET_LABEL[b]}`).join(' · ');
}

export type Reword =
  | { changed: true; criteria: StoredCriterion[]; note: string }
  | { changed: false; reason: 'empty' | 'same' | 'missing' };

/** Change ONE criterion's text by identity. The id is written (materialised
 *  from the old text's hash for a pre-v3l row) so the identity survives the
 *  reword; every passenger rides along untouched. The note says what the
 *  agent must now know. */
export function reword(criteria: readonly StoredCriterion[], id: string, text: string, tests: readonly VerifyTest[] = []): Reword {
  const exact = normalizeCriterionText(text);
  if (!exact) return { changed: false, reason: 'empty' };
  const target = criteria.find((c) => criterionIdOf(c) === id);
  if (!target) return { changed: false, reason: 'missing' };
  if (normalizeCriterionText(target.text) === exact) return { changed: false, reason: 'same' };
  const next = criteria.map((c) => (criterionIdOf(c) === id ? { ...c, id: criterionIdOf(c), text: exact } : { ...c }));
  const bound = typeof target.testId === 'string' && target.testId.length > 0
    ? tests.find((t) => t.id === target.testId)?.test_id ?? 'its test case'
    : null;
  const note = bound
    ? `The binding to ${bound} held by id. The old exact text no longer matches: copy the new text for the next report.`
    : 'Text changed. Agents bind by the exact text: copy it from here.';
  return { changed: true, criteria: next, note };
}

/** Switch ONE criterion's verification lane. Manual criteria never bind to
 *  a test, so a binding is released on the way in (met is kept, as the
 *  retire path keeps it); the default lane is the ABSENT key. */
export function setLane(criteria: readonly StoredCriterion[], id: string, lane: VerifyLaneKind): { criteria: StoredCriterion[]; note: string | null } {
  let note: string | null = null;
  const next = criteria.map((c) => {
    if (criterionIdOf(c) !== id) return { ...c };
    const out: StoredCriterion = { ...c, id: criterionIdOf(c) };
    if (lane === 'manual') {
      out.verification = 'manual';
      if (typeof out.testId === 'string' && out.testId.length > 0) {
        delete out.testId;
        note = 'Switched to the manual lane. The test binding is released and met is kept; the task-doc tick proves it from here.';
      }
    } else {
      delete out.verification;
    }
    return out;
  });
  return { criteria: next, note };
}

export function addCriterion(criteria: readonly StoredCriterion[], text: string): StoredCriterion[] | null {
  const exact = normalizeCriterionText(text);
  if (!exact) return null;
  return [...criteria.map((c) => ({ ...c })), { id: newCriterionId(), text: exact, met: false }];
}

export function removeCriterion(criteria: readonly StoredCriterion[], id: string): StoredCriterion[] {
  return criteria.filter((c) => criterionIdOf(c) !== id).map((c) => ({ ...c }));
}

/** The lock's one sentence, shared with the band and the inspector (v3x). */
export const VERIFY_LOCK_NOTE = 'Locked. Every write refuses this requirement, from the app and from every tool, until you unlock it here. Evidence on its criteria still flows.';

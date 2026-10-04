// 9.8 (owner ask 3, 2026-09-16): ONE Done vocabulary and an explicit archive.
//
// "Done" used to be five words — verified (derived requirement status),
// implemented / validated (stored legacy status), settled (outcome), done
// (task), passed (test) — and archive existed for exactly two things. This
// module is the one place every surface asks "is it done, is it archived,
// and which of the five words does it show". The words ARE the R24 key
// (done · stale · open · in work · needs action); Trace's legend, Priority's
// stripe and the Workflow band's stripe all read this table, so no surface
// can say done in a word another surface would not.
//
// Per entity:
//   requirement  done = verified (every criterion met, fresh evidence, no
//                red test); archived = a human archive act (archived_at)
//                OR done AND superseded by lineage (D2, computeArchivedRowIds).
//   outcome      done = settled (a human act) or every derived requirement
//                done (derived, shown as "covered", never auto-settled);
//                archived = dismissed, or settled AND every derived
//                requirement archived.
//   task         done = ticked or evidence; archived = done AND its doc has
//                since regenerated without it (orphaned).
//   test         done = passed and fresh; archived = retired_at.
//
// Shared by both runtimes (the UI imports it through a shim), like
// derive-status.ts beside it.

export type DoneState = 'fail' | 'live' | 'stale' | 'open' | 'ok';
export type DoneWord = 'done' | 'stale' | 'open' | 'in work' | 'needs action';

/** The one word table: state → the word every surface shows. */
export const DONE_WORD: Record<DoneState, DoneWord> = {
  ok: 'done',
  stale: 'stale',
  open: 'open',
  live: 'in work',
  fail: 'needs action',
};

export const DONE_STATE_ORDER: readonly DoneState[] = ['fail', 'live', 'stale', 'open', 'ok'];

/** The worst state present, by precedence; nothing reads open. */
export function worstDoneState(states: readonly DoneState[]): DoneState {
  for (const s of DONE_STATE_ORDER) if (states.includes(s)) return s;
  return 'open';
}

export interface DoneVerdict {
  done: boolean;
  archived: boolean;
  state: DoneState;
  word: DoneWord;
  /** Which rule decided it — for tests and tooltips, never re-derived. */
  driver: string;
}

const verdict = (done: boolean, archived: boolean, state: DoneState, driver: string): DoneVerdict =>
  ({ done, archived, state, word: DONE_WORD[state], driver });

/** A work item's stripe, Priority's rule kept: done wins, then a hold is
 *  in work, then a manual item is waiting on a person, else open. */
export function itemState(input: { done: boolean; held?: boolean; manual?: boolean; orphaned?: boolean }): DoneState {
  if (input.done) return 'ok';
  if (input.held) return 'live';
  if (input.manual) return 'fail';
  if (input.orphaned) return 'stale';
  return 'open';
}

export interface RequirementDoneInput {
  criteria: ReadonlyArray<{ met?: boolean; evidenceStale?: unknown; verification?: string }>;
  tests?: { failed: number; stale: number };
  held?: boolean;
  /** The stored legacy 'blocked' status, the one value still read. */
  blocked?: boolean;
  /** The human archive act (archived_at). */
  archivedAt?: string | null;
  /** D2: a newer requirement `expands` this one (computeArchivedRowIds decides). */
  supersededByLineage?: boolean;
}

export function requirementDone(input: RequirementDoneInput): DoneVerdict {
  const total = input.criteria.length;
  const met = input.criteria.filter((c) => c.met === true).length;
  const stale = input.criteria.filter((c) => c.met === true && c.evidenceStale != null && c.evidenceStale !== false).length;
  const manualWaiting = input.criteria.some((c) => c.met !== true && c.verification === 'manual');
  const tests = input.tests ?? { failed: 0, stale: 0 };
  const done = total > 0 && met === total && stale === 0 && tests.failed === 0 && tests.stale === 0;
  const archived = !!input.archivedAt || (done && input.supersededByLineage === true);
  if (done) return verdict(true, archived, 'ok', archived ? (input.archivedAt ? 'archived-by-act' : 'archived-by-lineage') : 'verified');
  if (input.blocked || tests.failed > 0 || manualWaiting) return verdict(false, archived, 'fail', input.blocked ? 'blocked' : tests.failed > 0 ? 'test-failed' : 'manual-waiting');
  if (input.held) return verdict(false, archived, 'live', 'held');
  if (stale > 0 || tests.stale > 0) return verdict(false, archived, 'stale', 'evidence-stale');
  return verdict(false, archived, 'open', met > 0 ? 'in-progress' : 'pending');
}

export interface OutcomeDoneInput {
  settled: boolean;
  dismissed: boolean;
  /** The verdicts of every requirement this outcome derived. */
  derived: ReadonlyArray<Pick<DoneVerdict, 'done' | 'archived' | 'state'>>;
  held?: boolean;
}

export function outcomeDone(input: OutcomeDoneInput): DoneVerdict & { covered: boolean } {
  const covered = input.derived.length > 0 && input.derived.every((d) => d.done);
  const done = input.settled || covered;
  const archived = input.dismissed || (input.settled && input.derived.length > 0 && input.derived.every((d) => d.archived));
  const state: DoneState = input.derived.length > 0
    ? worstDoneState(input.derived.map((d) => d.state))
    : input.held ? 'live' : input.settled ? 'ok' : 'open';
  const driver = input.dismissed ? 'dismissed' : input.settled ? 'settled' : covered ? 'covered' : input.derived.length > 0 ? 'derived-open' : 'no-derivation';
  return { ...verdict(done, archived, state, driver), covered };
}

export function taskDone(input: { done: boolean; evidenceDone?: boolean; orphaned: boolean; held?: boolean; manual?: boolean }): DoneVerdict {
  const done = input.done || input.evidenceDone === true;
  const archived = done && input.orphaned;
  return verdict(done, archived, itemState({ done, held: input.held, manual: input.manual, orphaned: input.orphaned }), archived ? 'done-and-orphaned' : done ? 'done' : input.orphaned ? 'orphaned' : 'open');
}

export function testDone(input: { status: string; stale?: boolean | null; retiredAt?: string | null; held?: boolean }): DoneVerdict {
  const done = input.status === 'passed' && input.stale !== true;
  const archived = !!input.retiredAt;
  const state: DoneState = done ? 'ok'
    : input.status === 'failed' ? 'fail'
    : input.status === 'running' || input.held ? 'live'
    : input.stale === true ? 'stale'
    : 'open';
  return verdict(done, archived, state, archived ? 'retired' : done ? 'passed' : input.status);
}

// ONE type scale for the ideation surfaces (Workflow, Trace, Priority).
//
// These views grew their own sizes and faces card by card: section labels at
// 9px, 9.5px, 10.5px and 11.5px, state words sometimes lowercase and
// sometimes upper-cased at the call site, and the monospace face used for
// prose as often as for identifiers. Read together it looked unfinished.
//
// The rules, in one place:
//
//   · The app's face is Inter (src/index.css). Everything a person READS uses
//     it. The monospace face is reserved for IDENTIFIERS a person might copy
//     or type back: REQ-001, TC-004, a commit sha, an exact criterion.
//   · Section labels are eyebrows: upper case, tracked, small, bold. They name
//     a region (VISION, STEPS, OUTCOMES, CONSTRAINTS, REQUIREMENTS).
//   · State words are sentence case, never upper case, and never invented at
//     the call site: Done, Stale, Open, In work, Needs action. They are the
//     SAME five words everywhere, so they read as one vocabulary rather than
//     five dialects.
import type { CSSProperties } from 'react';
import type { DoneState } from './done-state.js';

/** Identifiers only: refs, test ids, shas, exact criterion text. */
export const MONO_FACE = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** The region label above a band or a panel. Upper case, tracked. */
export const eyebrow = (color: string): CSSProperties => ({
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color,
  lineHeight: 1.2,
});

/** A card's or lane's name. */
export const title = (color: string): CSSProperties => ({
  fontSize: '13px',
  fontWeight: 650,
  letterSpacing: '-0.005em',
  color,
  lineHeight: 1.35,
});

/** Running text: guidance, notes, refusals. */
export const body = (color: string): CSSProperties => ({
  fontSize: '12.5px',
  fontWeight: 450,
  color,
  lineHeight: 1.55,
});

/** Secondary detail beside a title: counts, origins, bindings. */
export const meta = (color: string): CSSProperties => ({
  fontSize: '11.5px',
  fontWeight: 500,
  color,
  lineHeight: 1.45,
});

/** An age or a timestamp beside a row: the meta register, never bold. */
export const sinceLabelStyle = (color: string): CSSProperties => ({ ...meta(color), fontWeight: 500, whiteSpace: 'nowrap' });

/** An identifier a person may copy: REQ-001, TC-004, a sha. */
export const identifier = (color: string): CSSProperties => ({
  fontFamily: MONO_FACE,
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.01em',
  color,
  lineHeight: 1.3,
});

/** A state word. Sentence case, Inter, never upper case. */
export const stateWord = (color: string): CSSProperties => ({
  fontSize: '11px',
  fontWeight: 650,
  letterSpacing: '0.01em',
  color,
  lineHeight: 1.3,
});

/** The five state words as they are SHOWN. The stored vocabulary stays
 *  lower case (done-state.ts is shared with the server); this is the one
 *  place that decides how they are capitalised for a reader. */
export const STATE_LABEL: Record<DoneState, string> = {
  ok: 'Done',
  stale: 'Stale',
  open: 'Open',
  live: 'In work',
  fail: 'Needs action',
};

/** Sentence case for any single word we show from stored data, without the
 *  per-word capitalisation that `text-transform: capitalize` would impose
 *  ("In Work"). */
export const sentenceCase = (word: string): string =>
  word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);

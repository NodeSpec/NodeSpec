// V3 P4 (task 4.3): the criteria chip vocabulary — CRITERIA[itemId] from
// the Workflow Space design, derived from stored criterion fields only
// (WS3 verification lanes, R5 evidence provenance, E1 staleness marks):
//
//   draft     — a criterion on a CANDIDATE: pre-canonical, no met state,
//               no evidence; promotion mints the canonical copy.
//   manual    — proven by a person (the task-doc tick and approval); a
//               test binding is refused server-side. The other lane, a
//               binding test, is the default and carries no chip: the
//               owner ruled 2026-09-21 that a word nobody can act on
//               ("automated") only confuses.
//   promoted  — the owning requirement was minted from a candidate
//               (metadata.promotion) — lineage, not state.
//   met       — met === true (canonical criteria only).
//   stale     — an evidenceStale mark is standing (re-verification due).
//   evidence  — provenance is stamped; the label names the source
//               (evidence: test / evidence: git).
//
// Pure rows-in, chips-out — pinned in criteria-chips.test.ts; the tier
// planes render exactly this list.

export interface CriterionLike {
  text?: string;
  met?: boolean;
  verification?: string;
  evidenceStale?: unknown;
  provenance?: { source?: string } | null;
}

export interface CriterionChip {
  key: 'draft' | 'manual' | 'promoted' | 'met' | 'stale' | 'evidence';
  label: string;
}

export interface CriterionChipContext {
  tier: 'outcome' | 'req';
  /** req tier: the requirement carries metadata.promotion (minted from a
   *  candidate). Ignored for the outcome tier. */
  promotedOrigin?: boolean;
}

export function criterionChips(ctx: CriterionChipContext, criterion: CriterionLike): CriterionChip[] {
  const chips: CriterionChip[] = [];
  // Only the manual lane is said; a binding test is the default and needs no word.
  const lane: CriterionChip | null = criterion.verification === 'manual' ? { key: 'manual', label: 'proven by a person' } : null;

  if (ctx.tier === 'outcome') {
    // Pre-canonical: the draft chip leads, and no met/stale/evidence chip
    // can exist yet — nothing downstream binds.
    return lane ? [{ key: 'draft', label: 'draft' }, lane] : [{ key: 'draft', label: 'draft' }];
  }

  if (lane) chips.push(lane);
  if (ctx.promotedOrigin) chips.push({ key: 'promoted', label: 'promoted' });
  if (criterion.met === true) chips.push({ key: 'met', label: 'met' });
  if (criterion.evidenceStale != null && criterion.evidenceStale !== false) {
    chips.push({ key: 'stale', label: 'stale' });
  }
  const source = criterion.provenance?.source;
  if (typeof source === 'string' && source.length > 0) {
    chips.push({ key: 'evidence', label: `evidence: ${source}` });
  }
  return chips;
}

/** The chip palette — tones from the design set; draft stays neutral. */
export const CHIP_COLOR: Record<CriterionChip['key'], string> = {
  draft: '#8b93b3',
  manual: '#a78bfa',
  promoted: '#4ade80',
  met: '#4ade80',
  stale: '#fbbf24',
  evidence: '#8b93b3',
};

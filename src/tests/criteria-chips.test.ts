import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { criterionChips, CHIP_COLOR } from '../ui/components/ideation/criteria-chips.js';

// V3 P4 (task 4.3): the criteria chip vocabulary. Pins: the outcome tier
// is DRAFT territory (draft + lane chips only — no met, no stale, no
// evidence can exist pre-canonical); the req tier derives every chip from
// stored fields (WS3 verification lane, met, E1 evidenceStale, R5
// provenance, promotion lineage); absent verification is the default lane
// and carries no chip (owner's ruling 2026-09-21: "automated" was a word
// nobody could act on); and the strip renders exactly this list.

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

describe('outcome tier: pre-canonical drafts', () => {
  it('draft alone: the default lane is unsaid, and no state chip can exist', () => {
    const chips = criterionChips({ tier: 'outcome' }, { text: 'x', met: true, evidenceStale: { at: 't' }, provenance: { source: 'test' } });
    expect(chips.map((chip) => chip.key)).toEqual(['draft']);
    expect(chips.map((chip) => chip.label)).toEqual(['draft']);
  });
  it('a manual draft says who proves it, in words', () => {
    const chips = criterionChips({ tier: 'outcome' }, { text: 'x', verification: 'manual' });
    expect(chips.map((chip) => [chip.key, chip.label])).toEqual([['draft', 'draft'], ['manual', 'proven by a person']]);
  });
});

describe('req tier: chips derive from stored fields only', () => {
  it('absent verification carries no chip; met/stale/evidence stack from their fields', () => {
    const chips = criterionChips({ tier: 'req', promotedOrigin: false }, {
      text: 'x', met: true, evidenceStale: { at: 't', reason: 'case-retired' }, provenance: { source: 'test' },
    });
    expect(chips.map((chip) => chip.key)).toEqual(['met', 'stale', 'evidence']);
    expect(chips.find((chip) => chip.key === 'evidence')!.label).toBe('evidence: test');
  });

  it('manual lane, promotion lineage, and a bare unproven criterion', () => {
    const manual = criterionChips({ tier: 'req', promotedOrigin: true }, { text: 'x', verification: 'manual' });
    expect(manual.map((chip) => chip.key)).toEqual(['manual', 'promoted']);

    const bare = criterionChips({ tier: 'req' }, { text: 'x' });
    expect(bare).toEqual([]);
  });

  it('falsy staleness and empty provenance produce no chip — junk never lights', () => {
    const chips = criterionChips({ tier: 'req' }, { text: 'x', met: false, evidenceStale: false, provenance: { source: '' } });
    expect(chips).toEqual([]);
  });
});

describe('wiring', () => {
  it('every chip key has a palette entry, and the strip renders criterionChips verbatim', () => {
    for (const key of ['draft', 'manual', 'promoted', 'met', 'stale', 'evidence'] as const) {
      expect(CHIP_COLOR[key]).toMatch(/^#/);
    }
    // V3 4.1: the strip rides each draft criterion on Work's outcome rail
    const rail = src('ui/components/work/ItemRail.tsx');
    expect(rail).toContain("criterionChips({ tier: 'outcome' }, k)");
    expect(rail).toContain('CHIP_COLOR[chip.key]');
    expect(rail).toContain("data-testid=\"criteria-strip\"");
  });

  it('the assembly carries the raw criterion rows + promotion lineage for the strip', () => {
    const hook = src('ui/components/ideation/useTierItems.ts');
    expect(hook).toContain("'promotion' in req.metadata");
    expect(hook).toContain('acceptance_criteria, metadata');
  });
});

// R5e · evidence-stale — "the source changed under a proven criterion, re-verify."
//
// Deterministic by construction (file→artifact→node→criterion, all known links),
// and honest by scope: it flags ONLY criteria whose evidence is a git tick.
// Test-evidenced criteria have their own staleness lane (the test_cases trigger),
// and UI-ticked criteria were asserted by a human — second-guessing a person from
// a signal about code would be inference.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { flagStaleCriteria, clearEvidenceStale } from '../ui/services/evidenceStale.js';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');

const MARK = { at: '2026-07-31T12:00:00.000Z', commitSha: 'abc1234', reason: 'source-changed' as const };

describe('flagStaleCriteria — the provenance-gated scope', () => {
  it('flags a met, git-evidenced criterion; met STAYS true', () => {
    const { criteria, flaggedTexts } = flagStaleCriteria(
      [{ text: 'a', met: true, provenance: { source: 'git', commitSha: 'old', at: 'then' } }],
      MARK,
    );
    expect(flaggedTexts).toEqual(['a']);
    expect(criteria[0].met).toBe(true);
    expect(criteria[0].evidenceStale).toEqual(MARK);
    // The original evidence record survives — the audit trail keeps BOTH facts.
    expect((criteria[0].provenance as Record<string, unknown>).commitSha).toBe('old');
  });

  it('an unmet criterion has nothing to go stale', () => {
    const { flaggedTexts } = flagStaleCriteria(
      [{ text: 'a', met: false, provenance: { source: 'git', at: 'then' } }], MARK,
    );
    expect(flaggedTexts).toEqual([]);
  });

  it('UI- and test-evidenced criteria are NOT flagged — different truth owners', () => {
    const { criteria, flaggedTexts } = flagStaleCriteria([
      { text: 'ui', met: true, provenance: { source: 'ui', at: 'then' } },
      { text: 'test', met: true, testId: 'T-1' },
      { text: 'no-prov', met: true },
    ], MARK);
    expect(flaggedTexts).toEqual([]);
    expect(criteria.every(c => !c.evidenceStale)).toBe(true);
  });

  it('idempotent — an already-stale criterion is not re-marked', () => {
    const already = { text: 'a', met: true, provenance: { source: 'git', at: 'then' }, evidenceStale: { at: 'earlier', reason: 'source-changed' } };
    const { criteria, flaggedTexts } = flagStaleCriteria([already], MARK);
    expect(flaggedTexts).toEqual([]);
    expect((criteria[0].evidenceStale as Record<string, unknown>).at).toBe('earlier');
  });

  it('legacy bare strings and malformed input never throw', () => {
    expect(flagStaleCriteria(['bare'], MARK).flaggedTexts).toEqual([]);
    expect(flagStaleCriteria('not an array', MARK).criteria).toEqual([]);
    expect(flagStaleCriteria(null, MARK).criteria).toEqual([]);
  });
});

describe('clearEvidenceStale — a human touch IS the re-verification', () => {
  it('drops the flag and keeps everything else', () => {
    const cleared = clearEvidenceStale({
      text: 'a', met: true, evidenceStale: { at: 'x', reason: 'source-changed' }, provenance: { source: 'git', at: 'then' },
    });
    expect(cleared.evidenceStale).toBeUndefined();
    expect(cleared.met).toBe(true);
    expect(cleared.provenance).toBeDefined();
  });
});

describe('R5e wiring — the accept lane, best-effort, never the accept itself', () => {
  it('the accept handler flags AFTER a successful apply, fire-and-forget', () => {
    const source = read('ui/components/GraphEditor.tsx');
    expect(source).toContain('void flagNodeEvidenceStale(');
    // Inside the success branch, after the patch applied.
    const applyIdx = source.indexOf('Updated artifact from external change');
    const flagIdx = source.indexOf('void flagNodeEvidenceStale(');
    expect(applyIdx).toBeGreaterThan(0);
    expect(flagIdx).toBeGreaterThan(applyIdx);
    expect(source).toContain('evidence stale — re-verify');
  });

  it('the Spec view toggle clears the stale mark and stamps UI provenance', () => {
    const source = read('ui/components/spec-v3/SpecRequirementCard.tsx');
    expect(source).toContain('const { evidenceStale: _cleared, ...rest }');
    expect(source).toContain("provenance: { source: 'ui', at: new Date().toISOString() }");
  });

  it('the criterion row shows the stale chip and drops the settled strikethrough', () => {
    const source = read('ui/components/spec-v3/SpecRequirementCard.tsx');
    expect(source).toContain('evidence stale — re-verify');
    expect(source).toContain("ac.met && !ac.evidenceStale ? 'line-through' : 'none'");
  });
});

describe('R5d wiring (client half) — the declaration badge beside criteria state', () => {
  it('validationStatus flows repository → hook → panel → card', () => {
    expect(read('persistence/supabase/mappings-repository.ts')).toContain('validationStatus: row.validation_status');
    expect(read('ui/hooks/useRealtimeMappings.ts')).toContain('validationStatus: row.validation_status');
    expect(read('ui/components/spec-v3/SpecificationPanelV3.tsx')).toContain('validationStatus: m.validationStatus');
  });

  it('the DONE badge never replaces criteria state, and its tooltip says so', () => {
    const source = read('ui/components/spec-v3/SpecRequirementCard.tsx');
    expect(source).toContain("m.validationStatus === 'valid'");
    expect(source).toContain('This never implies the acceptance criteria are met');
  });
});

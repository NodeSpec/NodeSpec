// R6 commit 8: pins for the scale-surface pure helpers (spec-v3/scale.ts) —
// collapse decision, section met summaries, filter predicates, and the
// authored-relation → decomposition-edge derivation. UI wiring (panel
// collapse behavior, canvas rendering) is the owner's spot-check.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COLLAPSE_THRESHOLD,
  shouldDefaultCollapse,
  computeSectionMetSummary,
  formatSectionSummary,
  isRecentlyAdded,
  computeExpansionOfCompletedIds,
  computeArchivedLineage,
  findTestPlanArtifact,
} from '../ui/components/spec-v3/scale.js';
import type { RequirementRelation } from '../persistence/supabase/requirement-relations-repository.js';

function mkRelation(from: string, to: string, type: RequirementRelation['relationType']): RequirementRelation {
  return {
    id: `${from}->${to}:${type}`,
    specificationId: 's1',
    fromRequirementId: from,
    toRequirementId: to,
    relationType: type,
    source: 'ai',
    createdBy: null,
    notes: null,
    createdAt: 't',
  };
}

describe('shouldDefaultCollapse', () => {
  it('collapses strictly ABOVE the threshold, never at or below it', () => {
    expect(shouldDefaultCollapse(DEFAULT_COLLAPSE_THRESHOLD)).toBe(false);
    expect(shouldDefaultCollapse(DEFAULT_COLLAPSE_THRESHOLD + 1)).toBe(true);
    expect(shouldDefaultCollapse(0)).toBe(false);
    expect(shouldDefaultCollapse(100)).toBe(true);
  });
});

describe('section met summaries', () => {
  it('counts met criteria across the section', () => {
    const summary = computeSectionMetSummary([
      { acceptanceCriteria: [{ text: 'a', met: true }, { text: 'b', met: false }] as never },
      { acceptanceCriteria: [{ text: 'c', met: true }] as never },
      { acceptanceCriteria: [] as never },
    ]);
    expect(summary).toEqual({ reqCount: 3, criteriaMet: 2, criteriaTotal: 3 });
    expect(formatSectionSummary(summary)).toBe('3 reqs · 2/3 criteria met');
  });

  it('omits the criteria clause when there are none; singular req form', () => {
    expect(formatSectionSummary(computeSectionMetSummary([{ acceptanceCriteria: [] as never }])))
      .toBe('1 req');
  });
});

describe('isRecentlyAdded', () => {
  const now = Date.parse('2026-08-05T12:00:00Z');
  it('inside the 7-day window counts; outside does not', () => {
    expect(isRecentlyAdded({ createdAt: '2026-08-01T12:00:00Z' }, now)).toBe(true);
    expect(isRecentlyAdded({ createdAt: '2026-07-29T12:00:00Z' }, now)).toBe(true);  // exactly 7 days
    expect(isRecentlyAdded({ createdAt: '2026-07-29T11:59:59Z' }, now)).toBe(false); // just past
  });
  it('future or unparseable timestamps never count', () => {
    expect(isRecentlyAdded({ createdAt: '2026-08-06T12:00:00Z' }, now)).toBe(false);
    expect(isRecentlyAdded({ createdAt: 'not-a-date' }, now)).toBe(false);
  });
});

describe('computeExpansionOfCompletedIds', () => {
  const completed = new Set(['row-done']);
  const isCompleted = (id: string) => completed.has(id);

  it('expands → completed target puts the FROM row in the set', () => {
    const out = computeExpansionOfCompletedIds([mkRelation('row-new', 'row-done', 'expands')], isCompleted);
    expect(out).toEqual(new Set(['row-new']));
  });

  it('non-expands relations and incomplete targets are excluded', () => {
    const out = computeExpansionOfCompletedIds([
      mkRelation('row-a', 'row-done', 'depends_on'),
      mkRelation('row-b', 'row-pending', 'expands'),
    ], isCompleted);
    expect(out.size).toBe(0);
  });
});

// Section G 7b (supersedes the commit-8 relation edges): supersession is temporal,
// so req→req edges are never drawn — archived versions leave the canvas and the
// superseding card carries the version chain.
describe('computeArchivedLineage', () => {
  const req = (rowId: string, reqId: string, status: 'pending' | 'implemented' | 'validated' = 'pending') => ({
    id: rowId, requirementId: reqId, name: reqId, status,
    acceptanceCriteria: [] as never, updatedAt: 't',
  });

  it('a COMPLETED expands-target is archived; the expander carries the chain', () => {
    const out = computeArchivedLineage(
      [req('row-old', 'REQ-014', 'implemented'), req('row-new', 'REQ-031')],
      [mkRelation('row-new', 'row-old', 'expands')],
    );
    expect(out.archivedRowIds).toEqual(new Set(['row-old']));
    expect(out.chainByRowId.get('row-new')).toEqual([
      { rowId: 'row-old', requirementId: 'REQ-014', name: 'REQ-014', status: 'implemented', updatedAt: 't' },
    ]);
  });

  it('an INCOMPLETE target is active work, never archived', () => {
    const out = computeArchivedLineage(
      [req('row-old', 'REQ-014', 'pending'), req('row-new', 'REQ-031')],
      [mkRelation('row-new', 'row-old', 'expands')],
    );
    expect(out.archivedRowIds.size).toBe(0);
    expect(out.chainByRowId.size).toBe(0);
  });

  it('the chain walks transitively through archived predecessors, direct first', () => {
    const out = computeArchivedLineage(
      [req('v1', 'REQ-014', 'validated'), req('v2', 'REQ-022', 'implemented'), req('v3', 'REQ-031')],
      [mkRelation('v3', 'v2', 'expands'), mkRelation('v2', 'v1', 'expands')],
    );
    expect(out.archivedRowIds).toEqual(new Set(['v1', 'v2']));
    expect(out.chainByRowId.get('v3')!.map(e => e.requirementId)).toEqual(['REQ-022', 'REQ-014']);
    // archived intermediates carry no chip of their own
    expect(out.chainByRowId.has('v2')).toBe(false);
  });

  it('non-expands relations never archive anything', () => {
    const out = computeArchivedLineage(
      [req('a', 'REQ-001', 'implemented'), req('b', 'REQ-002')],
      [mkRelation('b', 'a', 'depends_on')],
    );
    expect(out.archivedRowIds.size).toBe(0);
  });
});

// Plan↔evidence alignment: CLIENT MIRROR of the server's findExistingTestArtifact
// (supabase/functions/_shared/test-document-generator.ts). The match order must
// stay value-identical — a divergence makes the canvas and the MCP lane disagree
// about whether a requirement's plan exists.
describe('findTestPlanArtifact', () => {
  const plan = (path: string, metadata?: Record<string, unknown>) =>
    ({ kind: 'test-plan', path, metadata });

  it('match 1: metadata.requirementId wins — rename-proof, path irrelevant', () => {
    const artifacts = {
      a: plan('.nodespec/tests/somewhere-else.tests.md', { requirementId: 'REQ-014' }),
      b: plan('.nodespec/tests/req-014.tests.md'), // path match exists but metadata wins first
    };
    expect(findTestPlanArtifact(artifacts, 'REQ-014', 'Store tasks')).toBe(artifacts.a);
  });

  it('match 2: the id-only path (.nodespec/tests/<slug>.tests.md) when metadata is absent', () => {
    const artifacts = { a: plan('.nodespec/tests/req-014.tests.md') };
    expect(findTestPlanArtifact(artifacts, 'REQ-014', 'Store tasks')).toBe(artifacts.a);
  });

  it('match 3: the legacy id+name path — pre-C4 plans, findable while the name is unchanged', () => {
    const artifacts = { a: plan('.nodespec/tests/req-014-store-tasks.tests.md') };
    expect(findTestPlanArtifact(artifacts, 'REQ-014', 'Store tasks')).toBe(artifacts.a);
    expect(findTestPlanArtifact(artifacts, 'REQ-014', 'Renamed'), 'legacy path breaks on rename — the pre-C4 status quo').toBeNull();
  });

  it('only kind test-plan is ever considered; no match → null (evidence is an orphan)', () => {
    const artifacts = {
      a: { kind: 'task', path: '.nodespec/tests/req-014.tests.md', metadata: { requirementId: 'REQ-014' } },
    };
    expect(findTestPlanArtifact(artifacts, 'REQ-014', 'Store tasks')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { releaseCriteriaBoundToCase } from '../ui/services/TestCaseService';

// E2 · test-case maintenance on the client — the SAME doctrine as the
// update_test_case MCP tool, through TestCaseService: rename (collision
// refused naming the holder), reassign (deliberately stale + old owner's
// bindings released), retire (soft, never a delete, bindings released),
// un-retire. One inspector serves both surfaces: the Decomposition canvas
// opens TestInspector directly, and the Work Board's test chips open the
// same component.

const SRC = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');

const CASE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('releaseCriteriaBoundToCase — the shared release rule', () => {
  it('strips the binding, preserves met, stamps the R5e-shaped evidenceStale mark', () => {
    const { changed, criteria } = releaseCriteriaBoundToCase(
      [
        { text: 'A holds', met: true, testId: CASE, provenance: { source: 'test', testCaseId: CASE, at: 't0' } },
        { text: 'B holds', met: false, testId: OTHER },
        'plain string criterion',
      ],
      CASE, '2026-08-23T12:00:00Z', 'case-retired',
    );
    expect(changed).toBe(true);
    const a = criteria.find((c) => c.text === 'A holds')!;
    expect(a.testId).toBeUndefined();
    expect(a.met).toBe(true); // evidence-due, never a silent unproof
    expect(a.evidenceStale).toEqual({ at: '2026-08-23T12:00:00Z', reason: 'case-retired' });
    expect(a.provenance).toEqual({ source: 'test', testCaseId: CASE, at: 't0' }); // history preserved
    // Foreign bindings and unbound criteria untouched.
    expect(criteria.find((c) => c.text === 'B holds')!.testId).toBe(OTHER);
    expect(criteria[2]).toEqual({ text: 'plain string criterion' });
  });

  it('reports unchanged when nothing was bound to the case', () => {
    const { changed } = releaseCriteriaBoundToCase([{ text: 'X', testId: OTHER }], CASE, 't', 'case-reassigned');
    expect(changed).toBe(false);
  });
});

describe('service + repository rails', () => {
  it('the repository maps and writes the retirement columns, and list reads exclude retired rows', () => {
    const repo = read('persistence/supabase/test-case-repository.ts');
    expect(repo).toContain("retiredAt: row.retired_at ?? undefined");
    expect(repo).toContain("if (updates.retiredAt !== undefined) updateData.retired_at = updates.retiredAt");
    expect(repo).toContain("if (updates.requirementId !== undefined) updateData.requirement_id = updates.requirementId");
    expect(repo).toContain("if (updates.testId !== undefined) updateData.test_id = updates.testId");
    expect(repo).toContain(".is('retired_at', null)");
  });

  it('TestCaseService lanes mirror update_test_case: reason-required retire, deliberate reassign staleness, named collision refusals', () => {
    const svc = read('ui/services/TestCaseService.ts');
    expect(svc).toContain("throw new Error('A retirement needs a reason");
    expect(svc).toContain('stalenessReason: `Reassigned from ${oldHumanId}`');
    expect(svc).toContain('already has a test case');
    // Both destructive-ish lanes release bindings through the ONE shared rule.
    expect(svc.match(/releaseBindingsOn\(tc\.requirementId, testCaseId, now, 'case-(retired|reassigned)'\)/g)?.length).toBe(2);
    // Un-retire clears BOTH columns.
    expect(svc).toContain('{ retiredAt: null, retiredReason: null }');
  });

  it('TestInspector carries the manage lanes and the retired banner with revival', () => {
    const ti = read('ui/components/panels/TestInspector.tsx');
    expect(ti).toContain('testCaseService.renameTestCase(');
    expect(ti).toContain('testCaseService.reassignTestCase(');
    expect(ti).toContain('testCaseService.retireTestCase(');
    expect(ti).toContain('testCaseService.unretireTestCase(');
    expect(ti).toContain('Retired — excluded from counts, evidence preserved');
    // The reassign affordance teaches the re-run duty (deliberate staleness).
    expect(ti).toContain('re-run it against its new requirement');
  });

  it('the Work Board opens the SAME inspector from its test chips and refreshes on close', () => {
    const wb = read('ui/components/board/WorkBoardView.tsx');
    expect(wb).toContain("import { TestInspector } from '../panels/TestInspector.js'");
    expect(wb).toContain('setInspectTestId(tc.rowId!)');
    expect(wb).toContain('onClose={() => { setInspectTestId(null); refresh(); }}');
  });
});

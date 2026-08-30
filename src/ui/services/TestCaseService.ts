import type { SupabaseClient } from '@supabase/supabase-js';
import type { TestCase, TestCaseRepository } from '../../persistence/supabase/test-case-repository.js';

// WS4: the UI-side generateTestCases/regenerateTestCases lane is gone — test
// plans are drafted and reported over MCP (get_test_plan / report_test_results).
// The `generate-test-cases-v4` edge function itself is untouched (D-series
// decides its fate); this service keeps only the read/CRUD paths.
//
// E2: the maintenance lanes (rename / retire / reassign) mirror the
// update_test_case MCP tool's semantics EXACTLY — one doctrine, two entry
// points. Retire and reassign both RELEASE the affected requirement's
// criterion bindings: testId stripped, met preserved, evidenceStale
// {at, reason} stamped (the R5e object mark) — the board reads evidence-due
// honestly, never proven-by a hidden or foreign case.

/** Strip a case's bindings from a criteria list — met preserved, R5e-shaped
 *  evidenceStale mark. Pure; shared by the retire and reassign lanes. */
export function releaseCriteriaBoundToCase(
  criteria: unknown,
  caseId: string,
  at: string,
  reason: 'case-retired' | 'case-reassigned',
): { changed: boolean; criteria: Array<Record<string, unknown>> } {
  let changed = false;
  const next = (Array.isArray(criteria) ? criteria : []).map((c) => {
    const obj: Record<string, unknown> =
      typeof c === 'string' ? { text: c } : { ...(c as Record<string, unknown>) };
    if (obj.testId !== caseId) return obj;
    changed = true;
    const { testId: _dropped, ...rest } = obj;
    return { ...rest, evidenceStale: { at, reason } };
  });
  return { changed, criteria: next };
}

export class TestCaseService {
  constructor(
    private testCaseRepo: TestCaseRepository,
    private supabase?: SupabaseClient,
  ) {}

  async getTestCasesByRequirementIds(requirementIds: string[]): Promise<TestCase[]> {
    return this.testCaseRepo.getTestCasesByRequirementIds(requirementIds);
  }

  async getTestCase(testCaseId: string): Promise<TestCase | null> {
    return this.testCaseRepo.getTestCase(testCaseId);
  }

  async createTestCase(
    requirementId: string,
    data: Partial<TestCase>,
    criterionIndex?: number,
  ): Promise<TestCase> {
    const tc = await this.testCaseRepo.createTestCase({
      ...data,
      requirementId,
    } as TestCase);

    if (criterionIndex !== undefined && this.supabase) {
      const { data: req } = await this.supabase
        .from('specification_requirements')
        .select('acceptance_criteria')
        .eq('id', requirementId)
        .maybeSingle();

      if (req?.acceptance_criteria && Array.isArray(req.acceptance_criteria)) {
        const criteria = [...req.acceptance_criteria];
        if (criterionIndex >= 0 && criterionIndex < criteria.length) {
          criteria[criterionIndex] = { ...criteria[criterionIndex], testId: tc.id };
          await this.supabase
            .from('specification_requirements')
            .update({ acceptance_criteria: criteria, updated_at: new Date().toISOString() })
            .eq('id', requirementId);
        }
      }
    }
    return tc;
  }

  async updateTestCase(testCaseId: string, data: Partial<TestCase>): Promise<TestCase | null> {
    return this.testCaseRepo.updateTestCase(testCaseId, data);
  }

  /** E2 rename lane: test_id / name / description. A test_id change is
   *  collision-checked against the owning requirement (the UNIQUE constraint
   *  would reject it anyway — this refusal NAMES the holder). */
  async renameTestCase(
    testCaseId: string,
    changes: { testId?: string; name?: string; description?: string },
  ): Promise<TestCase> {
    const tc = await this.mustGet(testCaseId);
    const nextTestId = changes.testId?.trim();
    if (nextTestId && nextTestId !== tc.testId && this.supabase) {
      const { data: holder } = await this.supabase
        .from('test_cases')
        .select('id, name')
        .eq('requirement_id', tc.requirementId)
        .eq('test_id', nextTestId)
        .neq('id', testCaseId)
        .maybeSingle();
      if (holder) {
        throw new Error(`This requirement already has a test case "${nextTestId}" (${holder.name ?? 'unnamed'}). Pick a different id, or retire the obsolete case.`);
      }
    }
    return this.testCaseRepo.updateTestCase(testCaseId, {
      ...(nextTestId ? { testId: nextTestId } : {}),
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
    });
  }

  /** E2 retire lane: soft, NEVER a delete — the row survives, every count
   *  surface excludes it, and its criterion bindings release (met preserved,
   *  evidenceStale stamped). A fresh report_test_results run revives it. */
  async retireTestCase(testCaseId: string, reason: string): Promise<TestCase> {
    if (!reason.trim()) throw new Error('A retirement needs a reason (e.g. "superseded by TC-004") so it stays explainable.');
    const tc = await this.mustGet(testCaseId);
    const now = new Date().toISOString();
    const updated = await this.testCaseRepo.updateTestCase(testCaseId, {
      retiredAt: now, retiredReason: reason.trim(),
    });
    await this.releaseBindingsOn(tc.requirementId, testCaseId, now, 'case-retired');
    return updated;
  }

  async unretireTestCase(testCaseId: string): Promise<TestCase> {
    return this.testCaseRepo.updateTestCase(testCaseId, { retiredAt: null, retiredReason: null });
  }

  /** E2 reassign lane: move the case to the requirement it actually verifies.
   *  It arrives DELIBERATELY stale — whatever it last proved, it proved on the
   *  old requirement — and the old owner's bindings release. */
  async reassignTestCase(testCaseId: string, targetRequirementRowId: string): Promise<TestCase> {
    const tc = await this.mustGet(testCaseId);
    if (tc.requirementId === targetRequirementRowId) {
      throw new Error('The case already belongs to that requirement.');
    }
    let oldHumanId = 'its previous requirement';
    if (this.supabase) {
      const { data: holder } = await this.supabase
        .from('test_cases')
        .select('id, name')
        .eq('requirement_id', targetRequirementRowId)
        .eq('test_id', tc.testId)
        .neq('id', testCaseId)
        .maybeSingle();
      if (holder) {
        throw new Error(`The target requirement already has a test case "${tc.testId}" (${holder.name ?? 'unnamed'}). Rename one of them first, or retire the obsolete one.`);
      }
      const { data: oldReq } = await this.supabase
        .from('specification_requirements')
        .select('requirement_id')
        .eq('id', tc.requirementId)
        .maybeSingle();
      if (oldReq?.requirement_id) oldHumanId = String(oldReq.requirement_id);
    }
    const now = new Date().toISOString();
    const updated = await this.testCaseRepo.updateTestCase(testCaseId, {
      requirementId: targetRequirementRowId,
      stale: true,
      stalenessReason: `Reassigned from ${oldHumanId}`,
    });
    await this.releaseBindingsOn(tc.requirementId, testCaseId, now, 'case-reassigned');
    return updated;
  }

  private async mustGet(testCaseId: string): Promise<TestCase> {
    const tc = await this.testCaseRepo.getTestCase(testCaseId);
    if (!tc) throw new Error('Test case not found.');
    return tc;
  }

  private async releaseBindingsOn(
    requirementRowId: string,
    caseId: string,
    at: string,
    reason: 'case-retired' | 'case-reassigned',
  ): Promise<void> {
    if (!this.supabase) return;
    const { data: req } = await this.supabase
      .from('specification_requirements')
      .select('acceptance_criteria')
      .eq('id', requirementRowId)
      .maybeSingle();
    const release = releaseCriteriaBoundToCase(req?.acceptance_criteria, caseId, at, reason);
    if (!release.changed) return;
    await this.supabase
      .from('specification_requirements')
      .update({ acceptance_criteria: release.criteria, updated_at: at })
      .eq('id', requirementRowId);
  }

  async deleteTestCase(testCaseId: string): Promise<void> {
    if (this.supabase) {
      const tc = await this.testCaseRepo.getTestCase(testCaseId);
      if (tc) {
        if (tc.artifactId) {
          await this.supabase.from('artifacts').delete().eq('id', tc.artifactId);
        }
        if (tc.requirementId) {
          const { data: req } = await this.supabase
            .from('specification_requirements')
            .select('acceptance_criteria')
            .eq('id', tc.requirementId)
            .maybeSingle();

          if (req?.acceptance_criteria && Array.isArray(req.acceptance_criteria)) {
            const criteria = req.acceptance_criteria.map((c: any) =>
              c.testId === testCaseId ? { ...c, testId: undefined } : c
            );
            await this.supabase
              .from('specification_requirements')
              .update({ acceptance_criteria: criteria, updated_at: new Date().toISOString() })
              .eq('id', tc.requirementId);
          }
        }
      }
    }
    return this.testCaseRepo.deleteTestCase(testCaseId);
  }

  async deleteTestCasesForRequirement(requirementId: string): Promise<number> {
    if (this.supabase) {
      const { data: req } = await this.supabase
        .from('specification_requirements')
        .select('acceptance_criteria')
        .eq('id', requirementId)
        .maybeSingle();

      if (req?.acceptance_criteria && Array.isArray(req.acceptance_criteria)) {
        const hasTestIds = req.acceptance_criteria.some((c: any) => c.testId);
        if (hasTestIds) {
          const criteria = req.acceptance_criteria.map((c: any) => ({ ...c, testId: undefined }));
          await this.supabase
            .from('specification_requirements')
            .update({ acceptance_criteria: criteria, updated_at: new Date().toISOString() })
            .eq('id', requirementId);
        }
      }
    }
    return this.testCaseRepo.deleteTestCasesByRequirementId(requirementId);
  }
}

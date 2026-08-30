// D1 (docs/WORK_LOOP_PLAN.md): ONE derived work status per requirement — the
// truth every board projection (the D3 canvas table, the D2 BOARD.md file)
// renders from, so the two surfaces cannot disagree.
//
// Precedence is strict and total — the FIRST rule that fires wins:
//   archived      the requirement left the working set (completed +
//                 superseded lineage — Section G); nothing below applies.
//   blocked       the requirement says so explicitly (status 'blocked').
//                 Explicit only — the board never infers blockage.
//   verified      every criterion met, no evidence stale, no failing or
//                 stale tests. Annotated with a tier (D4): 'smoke' = within
//                 the one-test-per-criterion budget, 'deep' = beyond it.
//                 "verified (smoke)" is a legitimate intermediate state.
//   evidence-due  the work claims more than the evidence proves: a met
//                 criterion went evidence-stale, all criteria are met but a
//                 test fails or is stale, or every task is done while
//                 criteria remain unmet (built, not proven).
//   in-progress   any progress signal at all: requirement status says so,
//                 a criterion is met, a task is done, or a test passed.
//   pending       none of the above.
//
// Pure: no I/O, no clock, no randomness — the vitest matrix pins every rule.

export type WorkStatus =
  | 'archived'
  | 'blocked'
  | 'verified'
  | 'evidence-due'
  | 'in-progress'
  | 'pending';

export type VerifiedTier = 'smoke' | 'deep';

export interface WorkStatusInput {
  archived: boolean;
  /** Requirement.status — only 'blocked' and the progress values are read. */
  requirementStatus: string;
  criteria: Array<{ met?: boolean; evidenceStale?: unknown }>;
  tests: { total: number; passed: number; failed: number; stale: number };
  tasks: { total: number; done: number };
}

export interface WorkStatusResult {
  status: WorkStatus;
  /** Present only when status === 'verified'. */
  tier?: VerifiedTier;
  /** Which rule fired — for tests and the D3 tooltip, never re-derived. */
  driver: string;
  counts: {
    criteriaMet: number;
    criteriaTotal: number;
    evidenceStale: number;
    tasksDone: number;
    tasksTotal: number;
    testsPassed: number;
    testsFailed: number;
    testsStale: number;
    testsTotal: number;
  };
}

const PROGRESS_STATUSES = new Set(['in-progress', 'implemented', 'validated']);

export function deriveWorkStatus(input: WorkStatusInput): WorkStatusResult {
  const criteriaTotal = input.criteria.length;
  const criteriaMet = input.criteria.filter((c) => c.met === true).length;
  const evidenceStale = input.criteria.filter((c) => c.met === true && !!c.evidenceStale).length;
  const counts = {
    criteriaMet,
    criteriaTotal,
    evidenceStale,
    tasksDone: input.tasks.done,
    tasksTotal: input.tasks.total,
    testsPassed: input.tests.passed,
    testsFailed: input.tests.failed,
    testsStale: input.tests.stale,
    testsTotal: input.tests.total,
  };
  const done = (status: WorkStatus, driver: string, tier?: VerifiedTier): WorkStatusResult =>
    ({ status, driver, counts, ...(tier ? { tier } : {}) });

  if (input.archived) return done('archived', 'lineage-archived');
  if (input.requirementStatus === 'blocked') return done('blocked', 'requirement-status-blocked');

  const allCriteriaMet = criteriaTotal > 0 && criteriaMet === criteriaTotal;

  if (allCriteriaMet && evidenceStale === 0 && input.tests.failed === 0 && input.tests.stale === 0) {
    // D4 tier: within the one-binding-test-per-criterion budget = smoke.
    return done('verified', 'all-criteria-met-clean', input.tests.total > criteriaTotal ? 'deep' : 'smoke');
  }

  if (evidenceStale > 0) return done('evidence-due', 'met-criterion-evidence-stale');
  if (allCriteriaMet && (input.tests.failed > 0 || input.tests.stale > 0)) {
    return done('evidence-due', 'met-criteria-but-tests-red');
  }
  if (input.tasks.total > 0 && input.tasks.done === input.tasks.total && !allCriteriaMet) {
    return done('evidence-due', 'tasks-done-criteria-unproven');
  }

  if (
    PROGRESS_STATUSES.has(input.requirementStatus) ||
    criteriaMet > 0 ||
    input.tasks.done > 0 ||
    input.tests.passed > 0
  ) {
    return done('in-progress', 'progress-signal');
  }

  return done('pending', 'no-signal');
}

/**
 * D2: the archived-set rule shared by BOTH projections (BOARD.md and the
 * canvas board) and by the Decomposition canvas's lineage computation —
 * a completed requirement that a newer one 'expands' leaves the working
 * set. Structural inputs so both runtimes can call it.
 */
export function computeArchivedRowIds(
  requirements: Array<{ id: string; status: string; acceptanceCriteria?: Array<{ met?: boolean }> | null }>,
  relations: Array<{ fromRequirementId: string; toRequirementId: string; relationType: string }>,
): Set<string> {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const completed = (id: string): boolean => {
    const r = byId.get(id);
    if (!r) return false;
    if (r.status === 'implemented' || r.status === 'validated') return true;
    const criteria = r.acceptanceCriteria || [];
    return criteria.length > 0 && criteria.every((ac) => ac.met);
  };
  const archived = new Set<string>();
  for (const rel of relations) {
    if (rel.relationType !== 'expands') continue;
    if (!byId.has(rel.fromRequirementId) || !byId.has(rel.toRequirementId)) continue;
    if (completed(rel.toRequirementId)) archived.add(rel.toRequirementId);
  }
  return archived;
}

// ── D4: the test-budget policy (TDD without sprawl) ─────────────────────────
//
// ONE binding test per acceptance criterion is the evidence contract — the
// smoke tier deriveWorkStatus already treats as a legitimate verified state
// ("verified (smoke)"). Deep-tier tests are deferred until a requirement's
// smoke tier is green. The gauge flags SPRAWL: more than
// TEST_BUDGET_SPRAWL_RATIO × criteria cases on one requirement reads as
// scattered evidence to consolidate, not extra rigor. Shared by every
// surface that shows the gauge (get_project_status, report_test_results,
// the Work Board) — one function, so no surface can flag differently.

export const TEST_BUDGET_SPRAWL_RATIO = 2;

export interface TestBudgetAssessment {
  criteriaTotal: number;
  testsTotal: number;
  /** Tests per criterion, one decimal; null when there are no criteria to
   *  budget against (unanchored evidence is a binding gap, not sprawl). */
  testsPerCriterion: number | null;
  overBudget: boolean;
}

export function assessTestBudget(args: {
  criteriaTotal: number;
  testsTotal: number;
}): TestBudgetAssessment {
  const testsPerCriterion = args.criteriaTotal > 0
    ? Math.round((args.testsTotal / args.criteriaTotal) * 10) / 10
    : null;
  return {
    criteriaTotal: args.criteriaTotal,
    testsTotal: args.testsTotal,
    testsPerCriterion,
    overBudget: args.criteriaTotal > 0 &&
      args.testsTotal > args.criteriaTotal * TEST_BUDGET_SPRAWL_RATIO,
  };
}

/** The consolidation nudge every over-budget surface renders — identical
 *  wording on the MCP responses and the board tooltip. */
export function formatTestBudgetNudge(a: TestBudgetAssessment): string {
  return `${a.testsTotal} test case(s) against ${a.criteriaTotal} acceptance criterion(s)` +
    `${a.testsPerCriterion !== null ? ` (${a.testsPerCriterion}× the budget baseline)` : ''}. ` +
    'The budget is ONE binding test per criterion (the smoke tier); consolidate overlapping cases ' +
    'into the strongest one per criterion, and add deep-tier tests only after the requirement ' +
    'reads verified (smoke).';
}

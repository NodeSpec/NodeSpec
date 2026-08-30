// D1/D2 (docs/WORK_LOOP_PLAN.md): ONE deriveWorkStatus for every projection.
// The implementation lives in _shared so the D2 server-side BOARD.md
// generator and this client view derive from literally the same function —
// the same cross-runtime pattern as parseTaskDocTasks. This shim keeps the
// client-side import path stable.
export {
  deriveWorkStatus,
  computeArchivedRowIds,
  assessTestBudget,
  formatTestBudgetNudge,
  TEST_BUDGET_SPRAWL_RATIO,
  type WorkStatus,
  type VerifiedTier,
  type WorkStatusInput,
  type WorkStatusResult,
  type TestBudgetAssessment,
} from '../../../../supabase/functions/_shared/derive-status.js';

// 9.8: ONE Done vocabulary — the implementation lives in _shared so the
// server (BOARD.md, get_project_status) and every client surface derive
// from literally the same function. This shim keeps the client import path
// stable, the same pattern as board/derive-status.ts.
export {
  DONE_WORD,
  DONE_STATE_ORDER,
  worstDoneState,
  itemState,
  requirementDone,
  outcomeDone,
  taskDone,
  testDone,
  type DoneState,
  type DoneWord,
  type DoneVerdict,
  type RequirementDoneInput,
  type OutcomeDoneInput,
} from '../../../../supabase/functions/_shared/done-state.js';

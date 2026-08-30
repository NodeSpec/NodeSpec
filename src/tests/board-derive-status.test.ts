import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { deriveWorkStatus, assessTestBudget, formatTestBudgetNudge, TEST_BUDGET_SPRAWL_RATIO, type WorkStatusInput } from '../ui/components/board/derive-status.js';
import { parseTaskDocTasks, taskAnchorKey } from '../../supabase/functions/_shared/task-deltas.js';

// D1 (docs/WORK_LOOP_PLAN.md): one derived status, strict precedence —
// archived → blocked → verified → evidence-due → in-progress → pending.
// Every projection renders THIS; the matrix below is the contract.

function input(overrides: Partial<WorkStatusInput> = {}): WorkStatusInput {
  return {
    archived: false,
    requirementStatus: 'pending',
    criteria: [{ met: false }, { met: false }],
    tests: { total: 0, passed: 0, failed: 0, stale: 0 },
    tasks: { total: 0, done: 0 },
    ...overrides,
  };
}

describe('deriveWorkStatus — the precedence matrix', () => {
  const met = { met: true };
  const metStale = { met: true, evidenceStale: { at: 't', reason: 'source changed' } };

  const matrix: Array<[string, Partial<WorkStatusInput>, string, string]> = [
    ['nothing at all', {}, 'pending', 'no-signal'],
    ['archived beats everything, even a fully verified state', {
      archived: true, criteria: [met], tests: { total: 1, passed: 1, failed: 0, stale: 0 },
    }, 'archived', 'lineage-archived'],
    ['explicit blocked beats verified', {
      requirementStatus: 'blocked', criteria: [met],
    }, 'blocked', 'requirement-status-blocked'],
    ['all criteria met, clean tests → verified', {
      criteria: [met, met], tests: { total: 2, passed: 2, failed: 0, stale: 0 },
    }, 'verified', 'all-criteria-met-clean'],
    ['zero criteria can never verify', {
      criteria: [], requirementStatus: 'implemented',
    }, 'in-progress', 'progress-signal'],
    ['a met criterion gone evidence-stale → evidence-due', {
      criteria: [met, metStale],
    }, 'evidence-due', 'met-criterion-evidence-stale'],
    ['criteria all met but a test fails → evidence-due, not verified', {
      criteria: [met], tests: { total: 2, passed: 1, failed: 1, stale: 0 },
    }, 'evidence-due', 'met-criteria-but-tests-red'],
    ['criteria all met but a test is stale → evidence-due', {
      criteria: [met], tests: { total: 1, passed: 1, failed: 0, stale: 1 },
    }, 'evidence-due', 'met-criteria-but-tests-red'],
    ['every task done while criteria remain unmet → evidence-due (built, not proven)', {
      tasks: { total: 3, done: 3 },
    }, 'evidence-due', 'tasks-done-criteria-unproven'],
    ['a single done task → in-progress', { tasks: { total: 3, done: 1 } }, 'in-progress', 'progress-signal'],
    ['a single met criterion → in-progress', { criteria: [met, { met: false }] }, 'in-progress', 'progress-signal'],
    ['a passed test → in-progress', { tests: { total: 1, passed: 1, failed: 0, stale: 0 } }, 'in-progress', 'progress-signal'],
    ['requirement status implemented → in-progress (status is a claim, criteria are the proof)', {
      requirementStatus: 'implemented',
    }, 'in-progress', 'progress-signal'],
    ['a failed test alone is not evidence-due — just not-verified work in flight', {
      tests: { total: 1, passed: 0, failed: 1, stale: 0 }, requirementStatus: 'in-progress',
    }, 'in-progress', 'progress-signal'],
  ];

  for (const [label, overrides, status, driver] of matrix) {
    it(label, () => {
      const result = deriveWorkStatus(input(overrides));
      expect(result.status).toBe(status);
      expect(result.driver).toBe(driver);
    });
  }

  it('D4 tier: within one-test-per-criterion = smoke; beyond = deep; absent unless verified', () => {
    const smoke = deriveWorkStatus(input({ criteria: [met, met], tests: { total: 2, passed: 2, failed: 0, stale: 0 } }));
    expect([smoke.status, smoke.tier]).toEqual(['verified', 'smoke']);
    const deep = deriveWorkStatus(input({ criteria: [met], tests: { total: 4, passed: 4, failed: 0, stale: 0 } }));
    expect([deep.status, deep.tier]).toEqual(['verified', 'deep']);
    const notVerified = deriveWorkStatus(input({}));
    expect(notVerified.tier).toBeUndefined();
  });

  it('counts ride every result for the projections to render', () => {
    const r = deriveWorkStatus(input({ criteria: [met, { met: false }], tasks: { total: 2, done: 1 } }));
    expect(r.counts).toMatchObject({ criteriaMet: 1, criteriaTotal: 2, tasksDone: 1, tasksTotal: 2 });
  });
});

describe('D2 — one derivation for BOTH projections', () => {
  it('the client derive-status is a shim over _shared (BOARD.md and the canvas share the function)', () => {
    const shim = readFileSync(resolve(__dirname, '../ui/components/board/derive-status.ts'), 'utf-8');
    expect(shim).toContain("from '../../../../supabase/functions/_shared/derive-status.js'");
    expect(shim).not.toContain('export function deriveWorkStatus');
  });

  it('the archived-set rule is shared too — scale.ts delegates to _shared', () => {
    const scale = readFileSync(resolve(__dirname, '../ui/components/spec-v3/scale.ts'), 'utf-8');
    expect(scale).toContain('computeArchivedRowIds(requirements, relations)');
    expect(scale).not.toMatch(/const completed = \(id: string\): boolean/);
  });
});

describe('D1 — the client parses task docs with the SERVER parser (lockstep by construction)', () => {
  it('the hook imports parseTaskDocTasks from _shared/task-deltas — one parser, both runtimes', () => {
    const hook = readFileSync(resolve(__dirname, '../ui/components/board/useWorkBoardData.ts'), 'utf-8');
    expect(hook).toContain("from '../../../../supabase/functions/_shared/task-deltas.js'");
    expect(hook).not.toMatch(/function parseTask/);
  });

  it('the shared parser behaves under vitest exactly as its Deno pins say', () => {
    const key = taskAnchorKey('Scaffold the API component.');
    const doc = `# Task: API\n\n## Implementation Tasks\n\n- [x] **T1 — Scaffold the API component.** <!-- t:${key} -->\n- [ ] **T2 — No anchor here.**\n\n## Manual Steps\n\n- [ ] other lane\n`;
    const parsed = parseTaskDocTasks(doc);
    expect(parsed.tasks).toEqual([
      { displayId: 'T1', title: 'Scaffold the API component.', key, checked: true },
    ]);
    expect(parsed.flagged).toEqual([{ title: 'No anchor here.', reason: 'no-anchor' }]);
  });
});

describe('D1 — no N+1 in the board data layer', () => {
  const hook = readFileSync(resolve(__dirname, '../ui/components/board/useWorkBoardData.ts'), 'utf-8');

  it('exactly one test_cases select and one task_items select, batched', () => {
    expect((hook.match(/from\('test_cases'\)/g) ?? []).length).toBe(1);
    expect((hook.match(/from\('task_items'\)/g) ?? []).length).toBe(1);
    expect(hook).toContain(".in('requirement_id'");
    expect(hook).toContain(".eq('project_id'");
  });

  it('the spec plane rides the two existing realtime hooks, and the doc parse is memoized', () => {
    expect(hook).toContain('useRealtimeSpecification');
    expect(hook).toContain('useRealtimeMappings');
    expect(hook).toMatch(/const docTasksByNode = useMemo/);
  });

  it('every row status comes from deriveWorkStatus — no projection re-derives', () => {
    expect(hook).toContain('deriveWorkStatus({');
    expect(hook).toContain('archivedRowIds.has(requirement.id)');
  });
});

// D4 (docs/WORK_LOOP_PLAN.md): the test-budget gauge — one binding test per
// criterion is the evidence contract; the SAME assessTestBudget flags sprawl
// on get_project_status, report_test_results, and the Work Board.
describe('D4 — assessTestBudget', () => {
  it('flags sprawl strictly PAST the shared threshold (2x criteria), never at it', () => {
    expect(TEST_BUDGET_SPRAWL_RATIO).toBe(2);
    expect(assessTestBudget({ criteriaTotal: 2, testsTotal: 4 }).overBudget).toBe(false); // exactly 2x
    expect(assessTestBudget({ criteriaTotal: 2, testsTotal: 5 }).overBudget).toBe(true);
    expect(assessTestBudget({ criteriaTotal: 3, testsTotal: 3 })).toEqual({
      criteriaTotal: 3, testsTotal: 3, testsPerCriterion: 1, overBudget: false,
    });
  });

  it('no criteria = no budget to be over — unanchored evidence is a binding gap, not sprawl', () => {
    const a = assessTestBudget({ criteriaTotal: 0, testsTotal: 7 });
    expect(a.overBudget).toBe(false);
    expect(a.testsPerCriterion).toBeNull();
  });

  it('the nudge carries the doctrine: one test per criterion, deep tier after verified (smoke)', () => {
    const nudge = formatTestBudgetNudge(assessTestBudget({ criteriaTotal: 2, testsTotal: 5 }));
    expect(nudge).toContain('5 test case(s) against 2 acceptance criterion(s)');
    expect(nudge).toContain('(2.5\u00d7 the budget baseline)');
    expect(nudge).toContain('ONE binding test per criterion');
    expect(nudge).toContain('verified (smoke)');
  });
});

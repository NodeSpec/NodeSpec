import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  formatProvenance,
  filterBoardRows,
  countByStatus,
  statusChipLabel,
  STATUS_ORDER,
  EMPTY_BOARD_FILTERS,
} from '../ui/components/board/board-view-utils.js';
import type { WorkBoardRow } from '../ui/components/board/useWorkBoardData.js';
import type { WorkStatus } from '../ui/components/board/derive-status.js';

// D3 (docs/WORK_LOOP_PLAN.md, owner refinement 2026-08-21): the Work Board is
// a SUB-VIEW of the Specification view — the board's rows ARE requirements,
// so tracking lives one toggle from authoring. The table renders the rows
// useWorkBoardData shapes (the identical assembly BOARD.md projects) and
// never re-derives a status.

function row(status: WorkStatus, overrides: Partial<{ id: string; name: string; nodeLabel: string; tier: 'smoke' | 'deep' }> = {}): WorkBoardRow {
  return {
    requirement: {
      id: overrides.id ?? `row-${status}`,
      requirementId: overrides.id ?? `REQ-${status}`,
      name: overrides.name ?? 'A requirement',
      sectionId: null,
      status: 'pending',
      acceptanceCriteria: [],
    },
    archived: status === 'archived',
    nodes: [{ id: 'n1', label: overrides.nodeLabel ?? 'API Service' }],
    tests: { total: 0, passed: 0, failed: 0, stale: 0 },
    testCases: [],
    planPath: null,
    tasks: [],
    alignment: { byCriterion: new Map(), generalTasks: [], otherTests: [] },
    status: {
      status,
      driver: 'test',
      ...(overrides.tier ? { tier: overrides.tier } : {}),
      counts: { criteriaMet: 0, criteriaTotal: 0, evidenceStale: 0, tasksDone: 0, tasksTotal: 0, testsPassed: 0, testsFailed: 0, testsStale: 0, testsTotal: 0 },
    },
  } as unknown as WorkBoardRow;
}

describe('board-view-utils', () => {
  it('formatProvenance answers "says who?" compactly, tolerating junk', () => {
    expect(formatProvenance({ source: 'git', commitSha: 'abc1234567890', at: 't' })).toBe('git · abc12345');
    expect(formatProvenance({ source: 'mcp', actor: 'claude-code', at: 't' })).toBe('mcp · claude-code');
    expect(formatProvenance({ at: 't' })).toBe('');
    expect(formatProvenance(null)).toBe('');
  });

  it('archived rows hide by default and appear only when their facet is chosen', () => {
    const rows = [row('verified'), row('archived')];
    expect(filterBoardRows(rows, { ...EMPTY_BOARD_FILTERS, statuses: new Set() }).map(r => r.status.status)).toEqual(['verified']);
    expect(filterBoardRows(rows, { statuses: new Set<WorkStatus>(['archived']), search: '' }).map(r => r.status.status)).toEqual(['archived']);
  });

  it('search matches requirement id, name, and node labels', () => {
    const rows = [row('pending', { id: 'REQ-001', name: 'Login flow' }), row('pending', { id: 'REQ-002', name: 'Exports', nodeLabel: 'Report Builder' })];
    expect(filterBoardRows(rows, { statuses: new Set(), search: 'login' })).toHaveLength(1);
    expect(filterBoardRows(rows, { statuses: new Set(), search: 'report builder' })).toHaveLength(1);
    expect(filterBoardRows(rows, { statuses: new Set(), search: 'REQ-002' })).toHaveLength(1);
  });

  it('facet counts cover every status and the chip shows the verified tier', () => {
    const counts = countByStatus([row('verified', { tier: 'smoke' }), row('pending'), row('pending')]);
    expect(counts.verified).toBe(1);
    expect(counts.pending).toBe(2);
    expect(STATUS_ORDER).toHaveLength(6);
    expect(statusChipLabel(row('verified', { tier: 'smoke' }))).toBe('verified (smoke)');
    expect(statusChipLabel(row('in-progress'))).toBe('in progress');
  });
});

describe('D3 wiring contracts', () => {
  const specView = readFileSync(resolve(__dirname, '../ui/components/layout/SpecificationMarkdownView.tsx'), 'utf-8');
  const board = readFileSync(resolve(__dirname, '../ui/components/board/WorkBoardView.tsx'), 'utf-8');

  it('the Specification view hosts the board as a sub-view toggle', () => {
    expect(specView).toContain("useState<'spec' | 'board'>");
    expect(specView).toContain('<WorkBoardView');
    expect(specView).toContain('Work Board');
    // The board reads the same realtime spec the view already holds.
    expect(specView).toContain('specificationId={specRealtimeData.specification?.id ?? null}');
  });

  it('the board renders the D1 assembly verbatim — no local status derivation', () => {
    expect(board).toContain('useWorkBoardData({ projectId, specificationId, graph })');
    expect(board).not.toContain('deriveWorkStatus(');
    expect(board).toContain('row.status.driver');
    expect(board).toContain('formatProvenance');
  });

  it('criteria read LATERALLY: the row renders the SAME annotation text BOARD.md prints (one function)', () => {
    expect(board).toContain("from '../../../../supabase/functions/_shared/board-alignment.js'");
    expect(board).toContain('row.alignment.byCriterion.get(ac.text)');
    expect(board).toContain('formatCriterionAnnotation(lanes)');
    // Owner refinement 2026-08-22: the expansion is ONE aligned table —
    // Criterion | Architecture | Tasks | Tests — replacing stacked note
    // blocks; unclaimed work/evidence lands on a Requirement-wide row.
    expect(board).toContain("ith('Criterion')");
    expect(board).toContain("ith('Architecture'");
    expect(board).toContain("ith('Tests'");
    expect(board).toContain('Requirement-wide');
    expect(board).toContain('row.alignment.generalTasks.map');
    const hook = readFileSync(resolve(__dirname, '../ui/components/board/useWorkBoardData.ts'), 'utf-8');
    expect(hook).toContain('alignCriterionLanes({');
    expect(hook).toContain('testId: ac.testId');
  });

  it('the row expansion carries the third lane — read-only test cases + the plan path (BOARD.md parity)', () => {
    expect(board).toContain('row.alignment.otherTests.map');
    expect(board).toContain('row.planPath');
    expect(board).toContain('Plan exists — no results reported yet.');
    // Read-only: the view carries no test write path of any kind.
    expect(board).not.toContain("from('test_cases')");
    expect(board).not.toMatch(/update\(|upsert\(|insert\(/);
    const hook = readFileSync(resolve(__dirname, '../ui/components/board/useWorkBoardData.ts'), 'utf-8');
    expect(hook).toContain('findTestPlanArtifact');
    expect(hook).toContain("select('id, requirement_id, test_id, name, status, stale')");
  });

  it('per-section collapse and the derived-status facet bar are present', () => {
    expect(board).toContain('setCollapsed');
    expect(board).toContain('STATUS_ORDER.map');
    expect(board).toContain('filterBoardRows(rows, filters)');
  });

  it('D4: the Tests cell carries the sprawl gauge — the SAME assessTestBudget the MCP surfaces flag with', () => {
    expect(board).toContain('assessTestBudget({ criteriaTotal: k.criteriaTotal, testsTotal: k.testsTotal })');
    expect(board).toContain('formatTestBudgetNudge(budget)');
    expect(board).toContain('sprawl');
  });
});

// ── Owner bug 2026-09-01: long boards must scroll, not clip ──────────────────
describe('board scroll chain', () => {
  it('every flex link between GraphEditor and the board scroll region can shrink (min-height: 0)', () => {
    // A flex item's min-height is AUTO — one link without minHeight: 0 lets
    // tall board content inflate the chain past the overflow-hidden ancestor:
    // clipped rows, no scrollbar (headless-repro-proven: 4322px unscrollable
    // without the GraphEditor link, 634px scrollable with it). Monaco and
    // ReactFlow have no intrinsic height, so only the board exposes a break.
    const board = readFileSync(resolve(__dirname, '../ui/components/board/WorkBoardView.tsx'), 'utf-8');
    expect(board).toContain("flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column'");
    expect(board).toContain("flex: 1, overflowY: 'auto'");
    const editor = readFileSync(resolve(__dirname, '../ui/components/GraphEditor.tsx'), 'utf-8');
    const wrapper = editor.slice(editor.indexOf("filter: isRefreshing ? 'blur(2px)' : 'none'") - 900);
    expect(wrapper.slice(0, 900)).toContain('minHeight: 0');
    const spec = readFileSync(resolve(__dirname, '../ui/components/layout/SpecificationMarkdownView.tsx'), 'utf-8');
    expect(spec).toContain('minHeight: 0');
  });
});

// ── Owner refinement 2026-09-01: evidence-derived task completion (client) ───
describe('evidence-derived task completion', () => {
  it('the client derives with the SAME shared rule and feeds effective done into counts + lanes', () => {
    const hook = readFileSync(resolve(__dirname, '../ui/components/board/useWorkBoardData.ts'), 'utf-8');
    // One cross-runtime function — the app and BOARD.md cannot derive differently.
    expect(hook).toContain("taskEvidenceDone, type AlignedLanes } from '../../../../supabase/functions/_shared/board-alignment.js'");
    // Status counts and the alignment lanes both read done || evidenceDone…
    expect(hook).toContain('done: tasks.filter((t) => t.done || t.evidenceDone).length');
    expect(hook).toContain('done: t.done || t.evidenceDone,');
    // …and the raw tick state is never overwritten (derivation is display-only).
    expect(hook).toContain("done: state?.done ?? docTask.checked");
    const view = readFileSync(resolve(__dirname, '../ui/components/board/WorkBoardView.tsx'), 'utf-8');
    expect(view).toContain('proven by criterion evidence — no tick recorded');
  });

  it('the server projection keeps the tick surface raw while counts/annotations derive', () => {
    const gen = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/board-generator.ts'), 'utf-8');
    expect(gen).toContain('taskEvidenceDone({ requirementId: req.requirementId, criteria: req.criteria, task: t })');
    // The checkbox line renders from the RAW node list, never the derived one.
    expect(gen).toContain('lines.push(`- [${t.done ? "x" : " "}] **${t.displayId} — ${t.title}** <!-- t:${t.key} -->`)');
  });
});

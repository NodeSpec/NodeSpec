import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
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

// D3 (docs/WORK_LOOP_PLAN.md) built the Work Board as a sub-view of the
// Specification view. V3 ruling R4 retired BOTH views; what these pins now
// protect is the data layer that outlived them — useWorkBoardData's D1
// assembly (the identical shape BOARD.md projects), derive-status, and the
// pure board-view-utils Trace (P5) and Priority (P6) reuse.

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

// ── V3 P3 (R4): the Work Board VIEW retired with the specification view —
// these pins now guard the surviving DATA LAYER (useWorkBoardData,
// board-view-utils, board-alignment, board-generator), which Trace (P5)
// and Priority (P6) build on and BOARD.md still projects. ──────────────────
describe('work-board data layer survives the view retirement (R4)', () => {
  it('the retired views are gone; the assembly they rendered is not', () => {
    expect(existsSync(resolve(__dirname, '../ui/components/board/WorkBoardView.tsx'))).toBe(false);
    expect(existsSync(resolve(__dirname, '../ui/components/layout/SpecificationMarkdownView.tsx'))).toBe(false);
    expect(existsSync(resolve(__dirname, '../ui/components/board/useWorkBoardData.ts'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../ui/components/board/board-view-utils.ts'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../ui/components/board/derive-status.ts'))).toBe(true);
  });

  it('the D1 assembly keeps the lateral criterion alignment (one function with BOARD.md)', () => {
    const hook = readFileSync(resolve(__dirname, '../ui/components/board/useWorkBoardData.ts'), 'utf-8');
    expect(hook).toContain('alignCriterionLanes({');
    expect(hook).toContain('testId: ac.testId');
    expect(hook).toContain('findTestPlanArtifact');
    expect(hook).toContain("select('id, requirement_id, test_id, name, status, stale')");
  });
});

// ── Owner bug 2026-09-01: tall content must scroll, not clip ────────────────
describe('scroll chain', () => {
  it('the GraphEditor flex link can shrink (min-height: 0)', () => {
    // A flex item's min-height is AUTO — without minHeight: 0 tall intrinsic
    // content inflates the chain past the overflow-hidden ancestor: clipped
    // rows, no scrollbar (headless-repro-proven on the old board). The V3
    // ideation panes scroll through the same link.
    const editor = readFileSync(resolve(__dirname, '../ui/components/GraphEditor.tsx'), 'utf-8');
    const wrapper = editor.slice(editor.indexOf("filter: isRefreshing ? 'blur(2px)' : 'none'") - 900);
    expect(wrapper.slice(0, 900)).toContain('minHeight: 0');
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
  });

  it('the server projection keeps the tick surface raw while counts/annotations derive', () => {
    const gen = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/board-generator.ts'), 'utf-8');
    expect(gen).toContain('taskEvidenceDone({ requirementId: req.requirementId, criteria: req.criteria, task: t })');
    // The checkbox line renders from the RAW node list, never the derived one.
    expect(gen).toContain('lines.push(`- [${t.done ? "x" : " "}] **${t.displayId} — ${t.title}** <!-- t:${t.key} -->`)');
  });
});

// D3 (docs/WORK_LOOP_PLAN.md, owner refinement 2026-08-21): the Work Board —
// a sub-view of the Specification view. A plain table over the rows
// useWorkBoardData shapes (the IDENTICAL assembly BOARD.md projects, so the
// app view and the git file cannot diverge): grouped by section with
// per-section collapse, columns Requirement | Status | Criteria | Tasks |
// Tests | Nodes, a derived-status facet bar + search, and row expansion
// answering "says who?" with provenance labels (git · abc123 / mcp · agent).
// The view DISPLAYS — every status came from deriveWorkStatus, never
// re-derived here.
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import type { Graph } from '@nodespec/core/types.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { TestInspector } from '../panels/TestInspector.js';
import { useWorkBoardData, type WorkBoardRow } from './useWorkBoardData.js';
import {
  EMPTY_BOARD_FILTERS,
  STATUS_META,
  STATUS_ORDER,
  countByStatus,
  filterBoardRows,
  formatProvenance,
  statusChipLabel,
  type BoardFilters,
} from './board-view-utils.js';
import { assessTestBudget, formatTestBudgetNudge, type WorkStatus } from './derive-status.js';
import {
  formatCriterionAnnotation,
  type AlignableTask,
  type AlignableTest,
} from '../../../../supabase/functions/_shared/board-alignment.js';

const UNSECTIONED = '__unsectioned__';

export function WorkBoardView({ projectId, specificationId, graph }: {
  projectId: string | null;
  specificationId: string | null;
  graph: Graph;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { rows, sections, loading, refresh } = useWorkBoardData({ projectId, specificationId, graph });
  const [filters, setFilters] = useState<BoardFilters>({ ...EMPTY_BOARD_FILTERS, statuses: new Set() });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  // E2: a test chip opens the SAME TestInspector the Decomposition canvas
  // uses — one maintenance surface (rename / reassign / retire), two entries.
  const [inspectTestId, setInspectTestId] = useState<string | null>(null);

  const counts = useMemo(() => countByStatus(rows), [rows]);
  const visible = useMemo(() => filterBoardRows(rows, filters), [rows, filters]);

  const bySection = useMemo(() => {
    const map = new Map<string, WorkBoardRow[]>();
    for (const row of visible) {
      const key = row.requirement.sectionId ?? UNSECTIONED;
      (map.get(key) ?? map.set(key, []).get(key)!).push(row);
    }
    return map;
  }, [visible]);

  const toggleStatus = (status: WorkStatus) => {
    setFilters((prev) => {
      const next = new Set(prev.statuses);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return { ...prev, statuses: next };
    });
  };

  const chip = (label: string, color: string, bg: string, title?: string) => (
    <span title={title} style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
      fontSize: '11px', fontWeight: 600, color, backgroundColor: bg, whiteSpace: 'nowrap',
    }}>{label}</span>
  );

  const th = (label: string, width?: string) => (
    <th style={{
      textAlign: 'left', padding: '8px 10px', fontSize: '11px', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.05em', color: c.textMuted,
      borderBottom: `1px solid ${c.border}`, width, position: 'sticky', top: 0,
      backgroundColor: c.surface, zIndex: 1,
    }}>{label}</th>
  );

  // Inner alignment-table pieces (the row expansion).
  const ith = (label: string, width?: string) => (
    <th key={label} style={{
      textAlign: 'left', padding: '4px 8px', fontSize: '10px', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.05em', color: c.textMuted,
      borderBottom: `1px solid ${c.border}`, width,
    }}>{label}</th>
  );
  const icell: React.CSSProperties = {
    padding: '5px 8px', fontSize: '12px', color: c.text,
    borderBottom: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`,
    verticalAlign: 'top',
  };
  const dash = <span style={{ color: c.textMuted }}>—</span>;
  const laneChips = (chips: React.ReactNode[]) => (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>{chips}</span>
  );
  const nodeChip = (label: string) => (
    <span key={label} style={{
      padding: '1px 7px', borderRadius: '8px', fontSize: '11px',
      backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
      color: c.textSecondary, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
  const testChip = (tc: AlignableTest) => {
    const glyph = tc.status === 'passed' ? '✅' : tc.status === 'failed' ? '❌' : '▫️';
    return (
      <span key={tc.rowId ?? tc.testId}
        title={`${tc.name}${tc.stale ? ' · stale — re-run' : ''}${tc.rowId ? ' · click to inspect / manage' : ''}`}
        onClick={tc.rowId ? (e) => { e.stopPropagation(); setInspectTestId(tc.rowId!); } : undefined}
        style={{
          padding: '1px 7px', borderRadius: '8px', fontSize: '11px', whiteSpace: 'nowrap',
          backgroundColor: tc.status === 'failed' ? 'rgba(220,38,38,0.10)' : tc.status === 'passed' ? 'rgba(22,163,74,0.10)' : (theme.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'),
          color: tc.status === 'failed' ? '#dc2626' : tc.status === 'passed' ? '#16a34a' : c.textSecondary,
          cursor: tc.rowId ? 'pointer' : 'default',
        }}>{tc.testId} {glyph}{tc.stale ? ' ⚠' : ''}</span>
    );
  };

  const renderRow = (row: WorkBoardRow) => {
    const meta = STATUS_META[row.status.status];
    const isOpen = expandedRow === row.requirement.id;
    const { counts: k } = row.status;
    const cell: React.CSSProperties = { padding: '8px 10px', fontSize: '12.5px', color: c.text, borderBottom: `1px solid ${c.border}`, verticalAlign: 'top' };
    // Task chips answer "says who?" from the SAME task rows the summary
    // counts (provenance/orphaned live on WorkBoardTask, not the lane shape).
    const taskInfo = new Map(row.tasks.map((t) => [`${t.displayId}::${t.title}`, t]));
    const taskChip = (t: AlignableTask, idx: number) => {
      const info = taskInfo.get(`${t.displayId}::${t.title}`);
      const prov = formatProvenance(info?.provenance ?? null);
      const tip = [
        t.title, t.nodeLabel, prov,
        t.evidenceDone ? 'proven by criterion evidence — no tick recorded' : '',
        info?.orphaned ? 'orphaned — the doc no longer emits this task; evidence kept' : '',
      ].filter(Boolean).join(' · ');
      return (
        <span key={`${t.displayId || t.title}-${idx}`} title={tip} style={{
          padding: '1px 7px', borderRadius: '8px', fontSize: '11px', whiteSpace: 'nowrap',
          backgroundColor: t.done ? 'rgba(22,163,74,0.10)' : (theme.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'),
          color: t.done ? '#16a34a' : c.textSecondary,
          opacity: info?.orphaned ? 0.6 : 1,
        }}>{t.displayId || (t.title.length > 22 ? `${t.title.slice(0, 22)}…` : t.title)} {t.done ? '☑' : '☐'}</span>
      );
    };
    return (
      <>
        <tr
          key={row.requirement.id}
          onClick={() => setExpandedRow(isOpen ? null : row.requirement.id)}
          style={{ cursor: 'pointer', opacity: row.archived ? 0.55 : 1 }}
        >
          <td style={cell}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {isOpen ? <ChevronDown size={12} style={{ color: c.textMuted }} /> : <ChevronRight size={12} style={{ color: c.textMuted }} />}
              <span style={{ fontWeight: 600 }}>{row.requirement.requirementId}</span>
              <span style={{ color: c.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.requirement.name}</span>
            </span>
          </td>
          <td style={cell}>{chip(statusChipLabel(row), meta.color, meta.bg, `driver: ${row.status.driver}`)}</td>
          <td style={cell} title={k.evidenceStale > 0 ? `${k.evidenceStale} met criterion(s) have stale evidence` : undefined}>
            {k.criteriaMet}/{k.criteriaTotal}{k.evidenceStale > 0 ? ' ⚠' : ''}
          </td>
          <td style={cell}>{k.tasksDone}/{k.tasksTotal}</td>
          <td style={cell} title={`passed / failed / stale of total`}>
            <span style={{ color: '#16a34a' }}>{k.testsPassed}</span>
            {' / '}<span style={{ color: k.testsFailed > 0 ? '#dc2626' : c.textMuted }}>{k.testsFailed}</span>
            {' / '}<span style={{ color: k.testsStale > 0 ? '#d97706' : c.textMuted }}>{k.testsStale}</span>
            <span style={{ color: c.textMuted }}> of {k.testsTotal}</span>
            {/* D4: the sprawl gauge — the SAME assessTestBudget the MCP status
                response flags with (one function, every surface). */}
            {(() => {
              const budget = assessTestBudget({ criteriaTotal: k.criteriaTotal, testsTotal: k.testsTotal });
              return budget.overBudget ? (
                <span title={formatTestBudgetNudge(budget)} style={{
                  marginLeft: '6px', padding: '1px 6px', borderRadius: '8px',
                  fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap',
                  color: '#d97706', backgroundColor: 'rgba(217,119,6,0.10)',
                }}>sprawl {budget.testsPerCriterion}×</span>
              ) : null;
            })()}
          </td>
          <td style={cell}>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {row.nodes.map((n) => (
                <span key={n.id} style={{
                  padding: '1px 7px', borderRadius: '8px', fontSize: '11px',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                  color: c.textSecondary, whiteSpace: 'nowrap',
                }}>{n.label}</span>
              ))}
            </span>
          </td>
        </tr>
        {isOpen && (
          <tr key={`${row.requirement.id}-detail`}>
            <td colSpan={6} style={{ ...cell, backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)', padding: '10px 12px 12px 34px' }}>
              {/* Owner refinement 2026-08-22: the expansion IS the lateral
                  read — one aligned table, criterion → architecture → task
                  work → test evidence per row, replacing the stacked note
                  sprawl. Same linkage as BOARD.md (alignCriterionLanes),
                  and each criterion row carries the exact BOARD.md
                  annotation text as its tooltip (one function, two
                  surfaces). Read-only throughout — ticks flip via the
                  git/MCP lanes, tests via report_test_results, never here.
                  E2 carve-out: clicking a test chip opens the TestInspector
                  for MAINTENANCE (rename/reassign/retire) — evidence still
                  never flips from the board table itself. */}
              {((row.requirement.acceptanceCriteria ?? []).length > 0 || row.alignment.generalTasks.length > 0 || row.alignment.otherTests.length > 0) && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {ith('Criterion')}
                      {ith('Architecture', '160px')}
                      {ith('Tasks', '200px')}
                      {ith('Tests', '170px')}
                    </tr>
                  </thead>
                  <tbody>
                    {(row.requirement.acceptanceCriteria ?? []).map((ac, i) => {
                      const prov = formatProvenance(ac.provenance as Record<string, unknown> | undefined);
                      // D3 refinement 2: the same annotation text BOARD.md
                      // renders under this criterion (same function, same
                      // linkage) — kept as the row tooltip so the app and
                      // the pulled file read identically.
                      const lanes = row.alignment.byCriterion.get(ac.text);
                      const annotation = lanes ? formatCriterionAnnotation(lanes) : '';
                      const archLabels = [...new Set((lanes?.tasks ?? []).map((t) => t.nodeLabel))];
                      return (
                        <tr key={i} title={annotation || undefined}>
                          <td style={icell}>
                            <span style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
                              <span style={{ color: ac.met ? '#16a34a' : c.textMuted, flexShrink: 0 }}>{ac.met ? '☑' : '☐'}</span>
                              <span style={{ color: c.text, textDecoration: ac.evidenceStale ? 'underline dotted #d97706' : 'none' }}
                                title={ac.evidenceStale ? 'evidence stale — re-verify' : undefined}>{ac.text}</span>
                              {prov && <span title={prov} style={{ fontSize: '10.5px', color: c.textMuted, flexShrink: 0 }}>{prov}</span>}
                            </span>
                          </td>
                          <td style={icell}>{archLabels.length > 0 ? laneChips(archLabels.map((label) => nodeChip(label))) : dash}</td>
                          <td style={icell}>{(lanes?.tasks.length ?? 0) > 0 ? laneChips(lanes!.tasks.map((t, j) => taskChip(t, j))) : dash}</td>
                          <td style={icell}>{(lanes?.tests.length ?? 0) > 0 ? laneChips(lanes!.tests.map((tc) => testChip(tc))) : dash}</td>
                        </tr>
                      );
                    })}
                    {(row.alignment.generalTasks.length > 0 || row.alignment.otherTests.length > 0) && (
                      <tr>
                        <td style={icell}>
                          <span style={{ color: c.textMuted, fontStyle: 'italic' }}
                            title="Work and evidence carried by this requirement's nodes without a stored criterion linkage — the board never guesses.">
                            Requirement-wide
                          </span>
                        </td>
                        <td style={icell}>{row.alignment.generalTasks.length > 0
                          ? laneChips([...new Set(row.alignment.generalTasks.map((t) => t.nodeLabel))].map((label) => nodeChip(label)))
                          : dash}</td>
                        <td style={icell}>{row.alignment.generalTasks.length > 0
                          ? laneChips(row.alignment.generalTasks.map((t, j) => taskChip(t, j)))
                          : dash}</td>
                        <td style={icell}>{row.alignment.otherTests.length > 0
                          ? laneChips(row.alignment.otherTests.map((tc) => testChip(tc)))
                          : dash}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {row.planPath && (
                <div style={{ fontSize: '11px', color: c.textMuted, marginTop: '7px' }}>
                  Test plan — {row.planPath}
                  {row.testCases.length === 0 && <span> · Plan exists — no results reported yet.</span>}
                </div>
              )}
              {(row.requirement.acceptanceCriteria ?? []).length === 0 && row.tasks.length === 0 && row.testCases.length === 0 && !row.planPath && (
                <span style={{ fontSize: '12px', color: c.textMuted }}>No criteria or tasks yet.</span>
              )}
            </td>
          </tr>
        )}
      </>
    );
  };

  const sectionName = new Map(sections.map((s) => [s.id, s.name]));

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: c.backgroundTertiary }}>
      {/* facet bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
        padding: '10px 16px', borderBottom: `1px solid ${c.border}`, flexShrink: 0,
      }}>
        {STATUS_ORDER.map((status) => {
          const meta = STATUS_META[status];
          const active = filters.statuses.has(status);
          return (
            <button
              key={status}
              onClick={() => toggleStatus(status)}
              title={status === 'archived' ? 'Archived rows appear only when this facet is on' : undefined}
              style={{
                padding: '3px 10px', borderRadius: '12px', fontSize: '11.5px', fontWeight: 600,
                border: `1px solid ${active ? meta.color : c.border}`,
                backgroundColor: active ? meta.bg : 'transparent',
                color: active ? meta.color : c.textMuted, cursor: 'pointer',
              }}
            >
              {meta.label} {counts[status]}
            </button>
          );
        })}
        <input
          value={filters.search}
          onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          placeholder="Filter requirements, nodes…"
          style={{
            marginLeft: 'auto', padding: '5px 10px', borderRadius: '8px',
            border: `1px solid ${c.border}`, backgroundColor: c.surface, color: c.text,
            fontSize: '12px', width: '200px',
          }}
        />
        <button onClick={refresh} title="Refresh tests and task state" style={{
          background: 'none', border: 'none', color: c.textMuted, cursor: 'pointer', display: 'flex', padding: '4px',
        }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {/* table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && rows.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: c.textMuted, fontSize: '13px' }}>Loading the board…</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: c.textMuted, fontSize: '13px' }}>
            {rows.length === 0 ? 'No requirements yet — the board fills as the spec does.' : 'Nothing matches the current filters.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: c.surface }}>
            <thead>
              <tr>
                {th('Requirement')}
                {th('Status', '130px')}
                {th('Criteria', '80px')}
                {th('Tasks', '70px')}
                {th('Tests', '130px')}
                {th('Nodes', '180px')}
              </tr>
            </thead>
            {[...bySection.entries()].map(([sectionId, sectionRows]) => {
              const isCollapsed = collapsed.has(sectionId);
              const label = sectionId === UNSECTIONED ? 'Unsectioned' : sectionName.get(sectionId) ?? 'Section';
              return (
                <tbody key={sectionId}>
                  <tr>
                    <td colSpan={6} style={{ padding: 0, borderBottom: `1px solid ${c.border}` }}>
                      <button
                        onClick={() => setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(sectionId)) next.delete(sectionId);
                          else next.add(sectionId);
                          return next;
                        })}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
                          padding: '7px 10px', background: theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                          border: 'none', cursor: 'pointer', color: c.textSecondary,
                          fontSize: '12px', fontWeight: 700, textAlign: 'left',
                        }}
                      >
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        {label}
                        <span style={{ fontWeight: 500, color: c.textMuted }}>{sectionRows.length}</span>
                      </button>
                    </td>
                  </tr>
                  {!isCollapsed && sectionRows.map(renderRow)}
                </tbody>
              );
            })}
          </table>
        )}
      </div>

      {/* E2: the same inspector the Decomposition canvas opens — refresh on
          close so a rename/reassign/retire shows up in the row immediately. */}
      {inspectTestId && projectId && (
        <TestInspector
          testCaseId={inspectTestId}
          projectId={projectId}
          onClose={() => { setInspectTestId(null); refresh(); }}
        />
      )}
    </div>
  );
}

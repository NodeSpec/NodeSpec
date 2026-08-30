// D3 (docs/WORK_LOOP_PLAN.md, owner refinement 2026-08-21): the Work Board is
// a SUB-VIEW of the Specification view, not a fourth top-level mode — the
// board's rows ARE requirements, so it lives where requirements live, one
// toggle away from authoring them. Pure helpers so filtering and the
// provenance labels are unit-tested without mounting the table.
import type { WorkBoardRow } from './useWorkBoardData.js';
import type { WorkStatus } from './derive-status.js';

/** "says who?" — the row-expansion answer. Never a raw object dump. */
export function formatProvenance(provenance: Record<string, unknown> | null | undefined): string {
  if (!provenance || typeof provenance !== 'object') return '';
  const source = typeof provenance.source === 'string' ? provenance.source : '';
  const sha = typeof provenance.commitSha === 'string' ? ` · ${provenance.commitSha.slice(0, 8)}` : '';
  const actor = typeof provenance.actor === 'string' ? ` · ${provenance.actor}` : '';
  if (!source) return '';
  return `${source}${sha}${actor}`;
}

export interface BoardFilters {
  /** Empty set = every non-archived status; 'archived' must be chosen explicitly. */
  statuses: Set<WorkStatus>;
  search: string;
}

export const EMPTY_BOARD_FILTERS: BoardFilters = { statuses: new Set(), search: '' };

export function filterBoardRows(rows: WorkBoardRow[], filters: BoardFilters): WorkBoardRow[] {
  const query = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.statuses.size > 0) {
      if (!filters.statuses.has(row.status.status)) return false;
    } else if (row.status.status === 'archived') {
      // Archived rows left the working set — they appear only when asked for.
      return false;
    }
    if (query) {
      const haystack = `${row.requirement.requirementId} ${row.requirement.name} ${row.nodes.map((n) => n.label).join(' ')}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export const STATUS_ORDER: WorkStatus[] = ['blocked', 'evidence-due', 'in-progress', 'pending', 'verified', 'archived'];

export const STATUS_META: Record<WorkStatus, { label: string; color: string; bg: string }> = {
  'blocked': { label: 'blocked', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  'evidence-due': { label: 'evidence due', color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  'in-progress': { label: 'in progress', color: '#2563eb', bg: 'rgba(37,99,235,0.12)' },
  'pending': { label: 'pending', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  'verified': { label: 'verified', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
  'archived': { label: 'archived', color: '#9ca3af', bg: 'rgba(156,163,175,0.10)' },
};

export function statusChipLabel(row: WorkBoardRow): string {
  const meta = STATUS_META[row.status.status];
  return row.status.tier ? `${meta.label} (${row.status.tier})` : meta.label;
}

/** Facet counts for the filter bar — computed over ALL rows so a facet with
 *  zero visible rows still shows what choosing it would reveal. */
export function countByStatus(rows: WorkBoardRow[]): Record<WorkStatus, number> {
  const counts = { 'blocked': 0, 'evidence-due': 0, 'in-progress': 0, 'pending': 0, 'verified': 0, 'archived': 0 } as Record<WorkStatus, number>;
  for (const row of rows) counts[row.status.status] += 1;
  return counts;
}

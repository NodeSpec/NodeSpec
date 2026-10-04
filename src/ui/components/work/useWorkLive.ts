// V3 AL.4 (owner 2026-10-01: "Our 3D canvas has to be refreshed or clicked
// out of in order to show new data instead of the data appearing shortly
// after being populated in our backend"). Work read its tables once, when
// the project opened. Now it listens for changes to what it draws and
// re-reads shortly after one lands: an agent's outcome, a stage a teammate
// added, a proposal filed, a test reported. Change events (Realtime) are
// the prompt path; a re-read every half minute while the page is in view
// is the fallback for an install without them, and coming back to the tab
// re-reads at once. The tables are published by migration 20261001150000;
// Realtime applies each table's row level security, so a person hears only
// about rows they can read.
import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';

/** How long a burst of changes settles before one re-read. */
export const WORK_LIVE_DEBOUNCE_MS = 400;
/** The fallback re-read while the page is in view. */
export const WORK_LIVE_POLL_MS = 30_000;

export interface LiveTable { table: string; filter?: string }

/** What Work listens to on a project. Filtered by the project, or by the
 *  branch where the table is branch-scoped; workflow_steps and the
 *  requirement rows carry neither, so they are heard for every project the
 *  person can read and the re-read sorts it out. Pure. */
export function workLiveTables(projectId: string, branchId: string | null | undefined): LiveTable[] {
  const project = `project_id=eq.${projectId}`;
  const branch = (col: string): string | undefined => (branchId ? `${col}=eq.${branchId}` : undefined);
  return [
    { table: 'workflows', filter: project },
    { table: 'workflow_steps' },
    { table: 'requirement_candidates', filter: project },
    { table: 'outcome_step_maps', filter: branch('branch_id') },
    { table: 'outcome_derivations', filter: project },
    { table: 'project_constraints', filter: project },
    { table: 'ai_proposals', filter: branch('source_branch_id') },
    { table: 'specification_requirements' },
    { table: 'task_items', filter: project },
    { table: 'test_cases' },
    { table: 'work_plans', filter: branch('branch_id') },
  ];
}

type Channel = { on: (...args: unknown[]) => Channel; subscribe: () => unknown };

/** Re-read Work when its data changes elsewhere: `reread` runs once per
 *  burst of change events, every WORK_LIVE_POLL_MS while the page is in
 *  view, and when the page comes back into view. */
export function useWorkLive(projectId: string | null | undefined, branchId: string | null | undefined, reread: () => void): void {
  const latest = useRef(reread);
  latest.current = reread;

  useEffect(() => {
    if (!projectId) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => { pending = null; latest.current(); }, WORK_LIVE_DEBOUNCE_MS);
    };
    const inView = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

    let channel: unknown = null;
    try {
      let ch = getSupabaseClient().channel(`work-live-${projectId}`) as unknown as Channel;
      for (const t of workLiveTables(projectId, branchId)) {
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t.table, ...(t.filter ? { filter: t.filter } : {}) }, soon);
      }
      channel = ch.subscribe();
    } catch { channel = null; }

    const timer = setInterval(() => { if (inView()) latest.current(); }, WORK_LIVE_POLL_MS);
    const onVisible = () => { if (inView()) soon(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (pending) clearTimeout(pending);
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      if (channel) { try { getSupabaseClient().removeChannel(channel as never); } catch { /* gone */ } }
    };
  }, [projectId, branchId]);
}

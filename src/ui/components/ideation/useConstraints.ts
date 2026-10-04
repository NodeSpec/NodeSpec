// V3 P4 (task 4.4): the CONSTRAINTS rail's data lane — v3f
// project_constraints (ruling R2: rows, not widened jsonb). The canonical
// 8-value ctype vocabulary orders the rail; grouping is pure and pinned.
//
// App-authored rows mint the SAME deterministic identity family the v3f
// backfill used — a digest of (ctype, description) — so writing the same
// constraint twice trips UNIQUE(project_id, source_hash) and surfaces as
// "already recorded" instead of silently duplicating. (The backfill used
// md5 in SQL; the app lane uses sha-256 with its own prefix — the two can
// never collide with each other, and each is idempotent within itself.)
//
// Z: the identity lives in _shared/constraint-identity.ts, so an agent's
// create_constraint over MCP mints the same hash for the same constraint.
import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { CONSTRAINT_TYPES, constraintIdentity } from '../../../../supabase/functions/_shared/constraint-identity.js';
import type { CheckSpec, ConstraintOrigin, ConstraintStats, Waiver } from '../../../../supabase/functions/_shared/constraint-rules.js';

export { constraintIdentity };
export const CTYPE_ORDER = CONSTRAINT_TYPES;
export type ConstraintType = typeof CTYPE_ORDER[number];

export interface ConstraintRow {
  id: string;
  ctype: string;
  title: string | null;
  description: string;
  rationale: string | null;
  author: string | null;
  workflow_id: string | null;
  /** 7.3: classification mark (Government) — only cleared viewers ever receive the row. */
  mark?: string | null;
  /** R.2b: guidance (the default) or a check evaluated on the graph. */
  kind?: 'guide' | 'check';
  /** R.2b: project | workflow | role | technology | contract_kind | node. */
  scope_kind?: string;
  scope_value?: string | null;
  check_spec?: CheckSpec | null;
  waivers?: Waiver[];
  /** R.2c: how often it fired, was broken and was waived. */
  stats?: ConstraintStats;
  origin?: ConstraintOrigin | null;
  created_at?: string | null;
}

/** R.2b: what a person files beyond the words: a narrower scope, or a check. */
export interface ConstraintExtra {
  title?: string | null;
  rationale?: string | null;
  scope?: { kind: 'role' | 'technology' | 'contract_kind' | 'node'; value: string } | null;
  check?: CheckSpec | null;
}

export interface ConstraintGroup {
  ctype: ConstraintType;
  rows: ConstraintRow[];
}

type LiftClient = Pick<ReturnType<typeof getSupabaseClient>, 'from'>;

/** AL.10 (owner 2026-10-01): lift a waiver from the row as it is now, not as
 *  this screen last read it, and write only if nobody changed the row in
 *  between: a waiver accepted meanwhile is never erased (three tries). Null
 *  when lifted, or already gone; otherwise what to tell the person. */
export async function liftWaiverFrom(client: LiftClient, id: string, waiverId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: cur, error: readErr } = await client
      .from('project_constraints').select('waivers, updated_at').eq('id', id).maybeSingle();
    if (readErr) return readErr.message;
    if (!cur) return 'That constraint is gone.';
    const row = cur as { waivers?: Waiver[] | null; updated_at?: string | null };
    const waivers = row.waivers ?? [];
    if (!waivers.some((w) => w.id === waiverId)) return null;
    const write = client.from('project_constraints')
      .update({ waivers: waivers.filter((w) => w.id !== waiverId), updated_at: new Date().toISOString() })
      .eq('id', id);
    const { data: wrote, error: err } = await (row.updated_at ? write.eq('updated_at', row.updated_at) : write.is('updated_at', null)).select('id');
    if (err) return err.message;
    if (!(Array.isArray(wrote) && wrote.length === 0)) return null;
  }
  return 'This constraint kept changing while the waiver was lifted; nothing was changed. Try again.';
}

/** Group by ctype in the canonical order; unknown ctypes fold into
 *  'other'; only non-empty groups render. */
export function groupConstraints(rows: ConstraintRow[]): ConstraintGroup[] {
  const byType = new Map<ConstraintType, ConstraintRow[]>();
  for (const row of rows) {
    const ctype = (CTYPE_ORDER as readonly string[]).includes(row.ctype) ? row.ctype as ConstraintType : 'other';
    if (!byType.has(ctype)) byType.set(ctype, []);
    byType.get(ctype)!.push(row);
  }
  return CTYPE_ORDER
    .filter((ctype) => byType.has(ctype))
    .map((ctype) => ({ ctype, rows: byType.get(ctype)! }));
}

export interface ConstraintsApi {
  groups: ConstraintGroup[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** W: the Workflows space files a constraint with its rule (title) and
   *  its reason (rationale) too; the description stays the identity. */
  add: (ctype: ConstraintType, description: string, workflowId?: string | null, extra?: ConstraintExtra) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  /** R.2b: the person lifts a waiver; the check holds against that target again. */
  liftWaiver: (id: string, waiverId: string) => Promise<string | null>;
  /** 7.3: set or clear the classification mark (Government). */
  setMark: (id: string, mark: string | null) => Promise<string | null>;
  /** Ungrouped rows for surfaces that filter by lane themselves. */
  rows: ConstraintRow[];
}

export function useConstraints(projectId: string | null | undefined): ConstraintsApi {
  const [rows, setRows] = useState<ConstraintRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) { setRows([]); setLoading(false); return; }
    try {
      const client = getSupabaseClient();
      let { data, error: err }: { data: unknown; error: { message: string } | null } = await client
        .from('project_constraints')
        .select('id, ctype, title, description, rationale, author, workflow_id, mark, kind, scope_kind, scope_value, check_spec, waivers, stats, origin, created_at')
        .eq('project_id', projectId);
      // A database without migration 20260924120000 has no rule columns: every row is guidance.
      if (err && /column .* does not exist|42703/i.test(err.message)) {
        ({ data, error: err } = await client
          .from('project_constraints')
          .select('id, ctype, title, description, rationale, author, workflow_id, mark')
          .eq('project_id', projectId));
      }
      if (err) throw new Error(err.message);
      setRows((data ?? []) as ConstraintRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load constraints');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const add = useCallback(async (ctype: ConstraintType, description: string, workflowId?: string | null, extra?: ConstraintExtra): Promise<string | null> => {
    if (!projectId) return 'No project.';
    if (!description.trim()) return 'A constraint needs a description.';
    try {
      const source_hash = await constraintIdentity(ctype, description);
      const { error: err } = await getSupabaseClient().from('project_constraints').insert({
        project_id: projectId,
        ctype,
        description: description.trim(),
        source_hash,
        // Lane attribution (Workflow Space: constraints render in the lane's
        // band); NULL stays a project-wide standing condition.
        workflow_id: workflowId ?? null,
        ...(extra?.title?.trim() ? { title: extra.title.trim() } : {}),
        ...(extra?.rationale?.trim() ? { rationale: extra.rationale.trim() } : {}),
        // R.2b: a narrower scope than the project, and a check.
        ...(extra?.scope && !workflowId ? { scope_kind: extra.scope.kind, scope_value: extra.scope.value } : {}),
        ...(extra?.check ? { kind: 'check', check_spec: extra.check } : {}),
      });
      if (err) {
        return err.message.includes('duplicate') || err.message.includes('unique')
          ? 'That constraint is already recorded.'
          : err.message;
      }
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Write failed';
    }
  }, [projectId, refresh]);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    try {
      const { error: err } = await getSupabaseClient().from('project_constraints').delete().eq('id', id);
      if (err) return err.message;
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Delete failed';
    }
  }, [refresh]);

  const liftWaiver = useCallback(async (id: string, waiverId: string): Promise<string | null> => {
    try {
      const failed = await liftWaiverFrom(getSupabaseClient(), id, waiverId);
      if (failed) return failed;
      await refresh();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [refresh]);

  const setMark = useCallback(async (id: string, mark: string | null): Promise<string | null> => {
    try {
      const { error: err } = await getSupabaseClient()
        .from('project_constraints')
        .update({ mark, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (err) return err.message;
      await refresh();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [refresh]);

  return { groups: groupConstraints(rows), total: rows.length, loading, error, refresh, add, remove, liftWaiver, setMark, rows };
}

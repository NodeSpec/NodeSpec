// 9.3: the REQUIREMENTS band, app side. The fourth band under the
// constraints: compact requirement cards (REQ ref, inline rename, criteria
// count, "from: Outcome A · Outcome B", a state stripe) and "+ requirement"
// for the un-derived case — a non-functional requirement is legitimate
// without an outcome. A card click hands off to Trace's REQ row.
//
// The band reads the same rows the Spec panel reads (one select on the
// project's specification) and writes two things: a rename, and a new
// requirement that stands on its own (auto-numbered, the Discovered #8
// 23505 retry). Both meet the v3x lock guard at the database: a locked
// requirement refuses the rename in words, and the band shows those words.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { predictedRef } from './useDecision.js';
import { computeArchivedRowIds } from '../board/derive-status.js';
import { requirementDone, type DoneState } from './done-state.js';

export interface BandRequirement {
  id: string;
  /** REQ-NNN */
  ref: string;
  name: string;
  status: string | null;
  locked: boolean;
  /** V3 4.1: the ladder's middle rung (ruling 3.5). Unconfirmed rows follow
   *  the lane; confirmed rows always come back as a proposal. */
  confirmed: boolean;
  /** metadata.backfill: minted from repository evidence by the import. */
  backfilled: boolean;
  /** The nodes it is mapped to (specification_mappings), in mapping order. */
  nodeIds: string[];
  criteriaCount: number;
  metCount: number;
  /** metadata.promotion or metadata.backfill: minted from an outcome or an import. */
  derived: boolean;
  /** 9.8: the one Done vocabulary (done-state.ts). */
  done: boolean;
  archived: boolean;
  state: DoneState;
  archivedAt: string | null;
  /** 9.9: the REQ refs this requirement `expands` (extension lineage). */
  expands: string[];
}

export interface RequirementBandApi {
  rows: BandRequirement[];
  specId: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** null on success, or the refusal (a locked row says so in words). */
  rename: (id: string, name: string) => Promise<string | null>;
  /** V3 4.1: the one-column act. A locked row refuses in the database's words. */
  confirm: (id: string) => Promise<string | null>;
  /** V3 6.4: the lock's door, the one the refusal sentence names ("the lock
   *  toggle on its rail under Work"). Locking is free; unlocking is the v3x
   *  guard's one exception (locked to false, nothing else changed). No
   *  tool does either. */
  setLocked: (id: string, locked: boolean) => Promise<string | null>;
  /** V3 6.1: New requirement, written by the person: the next REQ ref, one
   *  name, confirmed (they wrote it), no criteria yet. The specification
   *  row is created with it when the project has none. Returns the new
   *  row's id, or the refusal. */
  create: (name: string) => Promise<{ id: string } | { error: string }>;
}

type MappingRow = { requirement_id: string | null; node_id: string | null };

type Row = {
  id: string; requirement_id: string; name: string; status: string | null; locked: boolean | null; confirmed?: boolean | null;
  acceptance_criteria: Array<{ met?: boolean; evidenceStale?: unknown; verification?: string }> | null; metadata: Record<string, unknown> | null;
  archived_at?: string | null;
};
type RelationRow = { from_requirement_id: string; to_requirement_id: string; relation_type: string };

/** requirement row id → the names of the outcomes that derived it, oldest
 *  derivation first. Pure: the board inverts the outcomes it already holds. */
export function originsByRequirement(
  outcomes: ReadonlyArray<{ name: string; derivations: ReadonlyArray<{ requirementRowId: string; createdAt: string }> }>,
): Map<string, string[]> {
  const pairs: Array<{ reqId: string; name: string; at: string }> = [];
  for (const o of outcomes) for (const d of o.derivations) pairs.push({ reqId: d.requirementRowId, name: o.name, at: d.createdAt });
  pairs.sort((a, b) => a.at.localeCompare(b.at));
  const out = new Map<string, string[]>();
  for (const p of pairs) {
    const list = out.get(p.reqId) ?? [];
    if (!list.includes(p.name)) list.push(p.name);
    out.set(p.reqId, list);
  }
  return out;
}

/** The band's row shape from a database row. Pure, pinned. The verdict is
 *  the one module's (done-state): done = verified from the criteria, archived
 *  = the explicit act or done AND superseded by lineage. */
export function toBandRequirement(r: Row, supersededByLineage = false, expands: string[] = [], nodeIds: string[] = []): BandRequirement {
  const criteria = Array.isArray(r.acceptance_criteria) ? r.acceptance_criteria : [];
  const meta = r.metadata ?? {};
  const verdict = requirementDone({ criteria, blocked: r.status === 'blocked', archivedAt: r.archived_at ?? null, supersededByLineage });
  return {
    id: r.id,
    ref: r.requirement_id,
    name: r.name,
    status: r.status ?? null,
    locked: r.locked === true,
    confirmed: r.confirmed === true,
    backfilled: !!meta.backfill,
    nodeIds,
    criteriaCount: criteria.length,
    metCount: criteria.filter((c) => c && c.met === true).length,
    derived: !!meta.promotion || !!meta.backfill,
    done: verdict.done,
    archived: verdict.archived,
    state: verdict.state,
    archivedAt: r.archived_at ?? null,
    expands,
  };
}

/** 9.9: row id → the REQ refs it `expands`, in relation order. Pure. */
export function expandsByRow(rows: ReadonlyArray<Pick<Row, 'id' | 'requirement_id'>>, relations: ReadonlyArray<RelationRow>): Map<string, string[]> {
  const refById = new Map(rows.map((r) => [r.id, r.requirement_id]));
  const out = new Map<string, string[]>();
  for (const rel of relations) {
    if (rel.relation_type !== 'expands') continue;
    const ref = refById.get(rel.to_requirement_id);
    if (!ref || !refById.has(rel.from_requirement_id)) continue;
    const list = out.get(rel.from_requirement_id) ?? [];
    if (!list.includes(ref)) list.push(ref);
    out.set(rel.from_requirement_id, list);
  }
  return out;
}

/** Which rows the lineage rule supersedes (D2, cycle-guarded), by id. */
export function lineageArchived(rows: ReadonlyArray<Pick<Row, 'id' | 'status' | 'acceptance_criteria'>>, relations: ReadonlyArray<RelationRow>): Set<string> {
  return computeArchivedRowIds(
    rows.map((r) => ({ id: r.id, status: r.status ?? 'pending', acceptanceCriteria: Array.isArray(r.acceptance_criteria) ? r.acceptance_criteria : [] })),
    relations.map((rel) => ({ fromRequirementId: rel.from_requirement_id, toRequirementId: rel.to_requirement_id, relationType: rel.relation_type })),
  );
}

export function useRequirementBand(projectId: string | null | undefined, dataVersion?: number): RequirementBandApi {
  const [rows, setRows] = useState<BandRequirement[]>([]);
  const [specId, setSpecId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AL.4: Work re-reads on every change it hears; only the first read of a
  // project says loading, so a re-read does not blank the list.
  const loadedFor = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    if (!projectId) { setRows([]); setSpecId(null); loadedFor.current = null; return; }
    if (loadedFor.current !== projectId) setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data: spec } = await supabase
        .from('project_specifications')
        .select('id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const sid = (spec?.id as string | undefined) ?? null;
      setSpecId(sid);
      if (!sid) { setRows([]); setError(null); return; }
      const [{ data, error: err }, relsRes, mapsRes] = await Promise.all([
        supabase
          .from('specification_requirements')
          .select('id, requirement_id, name, status, locked, confirmed, acceptance_criteria, metadata, archived_at')
          .eq('specification_id', sid)
          .order('requirement_id', { ascending: true }),
        supabase
          .from('specification_requirement_relations')
          .select('from_requirement_id, to_requirement_id, relation_type')
          .eq('specification_id', sid),
        // The mappings give each row the nodes it lives on (Work's Imported lane, the Plan's work lines).
        supabase
          .from('specification_mappings')
          .select('requirement_id, node_id')
          .eq('specification_id', sid),
      ]);
      if (err) throw new Error(err.message);
      const rowsRaw = (data ?? []) as Row[];
      const rels = (relsRes.data ?? []) as RelationRow[];
      const superseded = lineageArchived(rowsRaw, rels);
      const expanding = expandsByRow(rowsRaw, rels);
      const maps = (mapsRes.data ?? []) as MappingRow[];
      const nodesByRow = new Map<string, string[]>();
      for (const m of maps) if (m.requirement_id && m.node_id) nodesByRow.set(m.requirement_id, [...(nodesByRow.get(m.requirement_id) ?? []), m.node_id]);
      setRows(rowsRaw.map((r) => toBandRequirement(r, superseded.has(r.id), expanding.get(r.id) ?? [], nodesByRow.get(r.id) ?? [])));
      setError(null);
      loadedFor.current = projectId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requirements');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh, dataVersion]);

  const rename = useCallback(async (id: string, name: string): Promise<string | null> => {
    const next = name.trim();
    if (!next) return 'A requirement needs a name.';
    try {
      // v3x: a locked row refuses here, in the database's own words.
      const { error: err } = await getSupabaseClient()
        .from('specification_requirements')
        .update({ name: next, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (err) return err.message;
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Rename failed';
    }
  }, [refresh]);

  // V3 4.1: Confirm is one column and one act. It never touches the lock;
  // unlock stays the human act in the app (doctrine 6), and a locked row
  // refuses this write too, in the database's own words.
  const confirm = useCallback(async (id: string): Promise<string | null> => {
    try {
      const { error: err } = await getSupabaseClient()
        .from('specification_requirements')
        .update({ confirmed: true, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (err) return err.message;
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Confirm failed';
    }
  }, [refresh]);

  // V3 6.4: the lock toggle. The guard strips updated_at before it compares,
  // so this write is the pure unlock it allows; a lock lands on any open row.
  const setLocked = useCallback(async (id: string, locked: boolean): Promise<string | null> => {
    try {
      const { error: err } = await getSupabaseClient()
        .from('specification_requirements')
        .update({ locked, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (err) return err.message;
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : (locked ? 'Lock failed' : 'Unlock failed');
    }
  }, [refresh]);

  const create = useCallback(async (name: string): Promise<{ id: string } | { error: string }> => {
    const next = name.trim();
    if (!next) return { error: 'A requirement needs a name.' };
    if (!projectId) return { error: 'No project selected.' };
    try {
      const supabase = getSupabaseClient();
      let sid = specId;
      if (!sid) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { error: 'Not signed in.' };
        const { data: spec, error: specErr } = await supabase.from('project_specifications').insert({ project_id: projectId, vision: '', created_by: user.id }).select('id').single();
        if (specErr) return { error: specErr.message };
        sid = (spec as { id: string }).id;
      }
      const ref = predictedRef(rows.map((r) => r.ref));
      const { data, error: err } = await supabase
        .from('specification_requirements')
        .insert({ specification_id: sid, requirement_id: ref, name: next, source: 'manual', confirmed: true, acceptance_criteria: [] })
        .select('id').single();
      if (err) return { error: err.message };
      await refresh();
      return { id: (data as { id: string }).id };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'The requirement was not created.' };
    }
  }, [projectId, specId, rows, refresh]);

  return { rows, specId, loading, error, refresh, rename, confirm, setLocked, create };
}

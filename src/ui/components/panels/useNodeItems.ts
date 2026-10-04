// V3 4.4: the items on one node, read for the Architecture rail: its
// mappings (with the requirement each maps and its criteria), the
// candidates filed on it that are not dismissed, and the newest completed
// import job (its open questions are attributed to nodes by the rail,
// purely). Three selects, keyed on the node.
import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import type { ImportJobQueueRow } from '../ideation/useApprovalsQueue.js';

export interface NodeRequirementItem {
  mappingId: string;
  requirementRowId: string;
  ref: string;
  name: string;
  confirmed: boolean;
  validationStatus: string | null;
  /** The mapping's confidence, 0 to 1, as the import stored it. */
  confidence: number | null;
  criteriaCount: number;
  metCount: number;
}
export interface NodeCandidateItem { id: string; name: string; kind: string; status: string; criteriaCount: number }
export interface NodeItems { requirements: NodeRequirementItem[]; candidates: NodeCandidateItem[]; job: ImportJobQueueRow | null; loading: boolean; error: string | null }

const EMPTY: NodeItems = { requirements: [], candidates: [], job: null, loading: false, error: null };

/** The items on one node: its mappings (with the requirement they map)
 *  and the candidates filed on it that are not dismissed, plus the newest
 *  completed import job for the node's open questions. Three selects. */
export function useNodeItems(projectId: string | null | undefined, nodeId: string | null | undefined, withImport = true): NodeItems {
  const [state, setState] = useState<NodeItems>(EMPTY);
  useEffect(() => {
    if (!projectId || !nodeId) { setState(EMPTY); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const [mapRes, candRes, jobRes] = await Promise.all([
          supabase.from('specification_mappings').select('id, requirement_id, validation_status, confidence').eq('node_id', nodeId),
          // Q: below Indie (no repo import) only outcomes are read here: the
          // import's candidates and open questions are its own.
          withImport
            ? supabase.from('requirement_candidates').select('id, name, kind, status, criteria').eq('project_id', projectId).eq('node_id', nodeId).neq('status', 'dismissed')
            : supabase.from('requirement_candidates').select('id, name, kind, status, criteria').eq('project_id', projectId).eq('node_id', nodeId).neq('status', 'dismissed').eq('kind', 'outcome'),
          withImport
            ? supabase.from('import_jobs').select('id, open_questions, metrics, created_at, updated_at').eq('project_id', projectId).eq('status', 'completed').order('created_at', { ascending: false }).limit(1).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        if (mapRes.error) throw new Error(mapRes.error.message);
        if (candRes.error) throw new Error(candRes.error.message);
        const maps = (mapRes.data ?? []) as Array<{ id: string; requirement_id: string | null; validation_status: string | null; confidence: number | null }>;
        const reqIds = maps.map((m) => m.requirement_id).filter((x): x is string => !!x);
        type ReqRow = { id: string; requirement_id: string; name: string; confirmed: boolean | null; acceptance_criteria: Array<{ met?: boolean }> | null };
        const reqById = new Map<string, ReqRow>();
        if (reqIds.length > 0) {
          const { data } = await supabase.from('specification_requirements').select('id, requirement_id, name, confirmed, acceptance_criteria').in('id', reqIds);
          for (const r of (data ?? []) as ReqRow[]) reqById.set(r.id, r);
        }
        if (cancelled) return;
        setState({
          requirements: maps.flatMap((m) => {
            const r = m.requirement_id ? reqById.get(m.requirement_id) : null;
            if (!r) return [];
            const criteria = Array.isArray(r.acceptance_criteria) ? r.acceptance_criteria : [];
            return [{
              mappingId: m.id, requirementRowId: m.requirement_id!, ref: r.requirement_id, name: r.name, confirmed: r.confirmed === true,
              validationStatus: m.validation_status ?? null, confidence: typeof m.confidence === 'number' ? m.confidence : null,
              criteriaCount: criteria.length, metCount: criteria.filter((c) => c && c.met === true).length,
            }];
          }).sort((a, b) => a.ref.localeCompare(b.ref)),
          candidates: ((candRes.data ?? []) as Array<{ id: string; name: string; kind: string; status: string; criteria: unknown }>).map((k) => ({
            id: k.id, name: k.name, kind: k.kind, status: k.status, criteriaCount: Array.isArray(k.criteria) ? k.criteria.length : 0,
          })),
          job: (jobRes.data ?? null) as ImportJobQueueRow | null,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (!cancelled) setState({ ...EMPTY, error: err instanceof Error ? err.message : 'Failed to read the node' });
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, nodeId, withImport]);
  return state;
}

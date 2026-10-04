// AA.2: the changes open on a project, read for the canvas. Eight batched
// reads (lanes, steps, outcomes, their step maps, derivations, mappings,
// requirements, constraints); assembly is change-scope-model.ts. Workflows
// are Indie and above: the caller passes enabled=false below it and nothing
// is read.
import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { assembleChanges, type ChangeView } from './change-scope-model.js';

export function useChangeScope(
  projectId: string | null | undefined,
  branchId: string | null | undefined,
  graph: { nodes: Record<string, unknown>; edges: Record<string, { id: string; source: string; target: string }> },
  enabled: boolean,
  refreshSignal: number = 0,
): { changes: ChangeView[]; loading: boolean } {
  const [changes, setChanges] = useState<ChangeView[]>([]);
  const [loading, setLoading] = useState(false);
  const nodeKey = Object.keys(graph.nodes).sort().join(',');
  const edgeKey = Object.keys(graph.edges).sort().join(',');

  const load = useCallback(async () => {
    if (!enabled || !projectId || !branchId) { setChanges([]); return; }
    setLoading(true);
    try {
      const sb = getSupabaseClient();
      const { data: lanes } = await sb.from('workflows').select('id, name, sort_order').eq('project_id', projectId).eq('kind', 'change');
      const laneRows = (lanes ?? []) as Array<{ id: string; name: string; sort_order: number | null }>;
      if (laneRows.length === 0) { setChanges([]); return; }
      const laneIds = laneRows.map((l) => l.id);
      const [{ data: steps }, { data: outcomes }, { data: constraints }] = await Promise.all([
        sb.from('workflow_steps').select('id, workflow_id').in('workflow_id', laneIds),
        sb.from('requirement_candidates').select('id, workflow_id').eq('project_id', projectId).eq('branch_id', branchId).eq('kind', 'outcome').neq('status', 'dismissed'),
        sb.from('project_constraints').select('workflow_id').eq('project_id', projectId).in('workflow_id', laneIds),
      ]);
      const outcomeIds = ((outcomes ?? []) as Array<{ id: string }>).map((o) => o.id);
      const [{ data: stepMaps }, { data: derivations }] = outcomeIds.length > 0
        ? await Promise.all([
          sb.from('outcome_step_maps').select('candidate_id, step_id').eq('branch_id', branchId).in('candidate_id', outcomeIds),
          sb.from('outcome_derivations').select('candidate_id, requirement_row_id').eq('project_id', projectId).in('candidate_id', outcomeIds),
        ])
        : [{ data: [] }, { data: [] }];
      const rowIds = [...new Set(((derivations ?? []) as Array<{ requirement_row_id: string }>).map((d) => d.requirement_row_id))];
      const [{ data: mappings }, { data: requirements }] = rowIds.length > 0
        ? await Promise.all([
          sb.from('specification_mappings').select('requirement_id, node_id').in('requirement_id', rowIds),
          sb.from('specification_requirements').select('id, acceptance_criteria, archived_at').in('id', rowIds),
        ])
        : [{ data: [] }, { data: [] }];
      setChanges(assembleChanges({
        lanes: laneRows,
        steps: (steps ?? []) as Array<{ id: string; workflow_id: string }>,
        outcomes: (outcomes ?? []) as Array<{ id: string; workflow_id: string | null }>,
        stepMaps: (stepMaps ?? []) as Array<{ candidate_id: string; step_id: string }>,
        derivations: (derivations ?? []) as Array<{ candidate_id: string; requirement_row_id: string }>,
        mappings: (mappings ?? []) as Array<{ requirement_id: string; node_id: string }>,
        requirements: (requirements ?? []) as Array<{ id: string; acceptance_criteria?: Array<{ met?: boolean }> | null; archived_at?: string | null }>,
        constraints: (constraints ?? []) as Array<{ workflow_id: string | null }>,
        edges: Object.values(graph.edges).map((e) => ({ id: e.id, source: e.source, target: e.target })),
        liveNodeIds: new Set(Object.keys(graph.nodes)),
      }));
    } catch {
      setChanges([]);
    } finally {
      setLoading(false);
    }
    // nodeKey/edgeKey stand in for the graph: a new node or edge re-derives the scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, branchId, nodeKey, edgeKey, refreshSignal]);

  useEffect(() => { void load(); }, [load]);
  return { changes, loading };
}

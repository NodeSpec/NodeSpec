// AA.2 (owner 2026-09-23): the change on the canvas. Pure.
//
// A change is a workflow of kind 'change'. Its scope is derived, never
// tagged (change-intent.ts, mirrored from the server): the nodes its
// requirements map to and the edges that cross into them. The canvas names
// the active change in one line at the top with its proof count, and turns
// the scope on and off: out of scope fades, crossing edges highlight, and
// the change's constraints show as a marker on each node in scope.
import { changeScope, type ChangeScope, type ScopeInput } from '../../utils/change-intent.js';

export interface ChangeView {
  id: string;
  name: string;
  scope: ChangeScope;
  /** Criteria met of the criteria on the change's requirements. */
  proven: { met: number; total: number };
  /** Constraints scoped to the change's workflow. */
  constraints: number;
}

export interface ChangeRows {
  lanes: Array<{ id: string; name: string; sort_order?: number | null }>;
  steps: Array<{ id: string; workflow_id: string }>;
  outcomes: Array<{ id: string; workflow_id: string | null }>;
  stepMaps: Array<{ candidate_id: string; step_id: string }>;
  derivations: Array<{ candidate_id: string; requirement_row_id: string }>;
  mappings: Array<{ requirement_id: string; node_id: string }>;
  requirements: Array<{ id: string; acceptance_criteria?: Array<{ met?: boolean }> | null; archived_at?: string | null }>;
  constraints: Array<{ workflow_id: string | null }>;
  edges: Array<{ id: string; source: string; target: string }>;
  /** The nodes on the canvas: a mapping to a node that is gone is not scope. */
  liveNodeIds: ReadonlySet<string>;
}

/** Every change with its derived scope, proof and constraints, in lane order. */
export function assembleChanges(rows: ChangeRows): ChangeView[] {
  const stepsOf = new Map<string, string[]>();
  for (const m of rows.stepMaps) stepsOf.set(m.candidate_id, [...(stepsOf.get(m.candidate_id) ?? []), m.step_id]);
  const input: ScopeInput = {
    outcomes: rows.outcomes.map((o) => ({ id: o.id, workflowId: o.workflow_id, stepIds: stepsOf.get(o.id) ?? [] })),
    steps: rows.steps.map((s) => ({ id: s.id, workflowId: s.workflow_id })),
    derivations: rows.derivations.map((d) => ({ candidateId: d.candidate_id, requirementRowId: d.requirement_row_id })),
    mappings: rows.mappings.filter((m) => rows.liveNodeIds.has(m.node_id)).map((m) => ({ requirementRowId: m.requirement_id, nodeId: m.node_id })),
    edges: rows.edges,
  };
  const criteriaOf = new Map(rows.requirements.filter((r) => !r.archived_at).map((r) => [r.id, r.acceptance_criteria ?? []]));
  return [...rows.lanes]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
    .map((lane) => {
      const scope = changeScope(input, lane.id);
      const criteria = scope.requirementRowIds.flatMap((r) => criteriaOf.get(r) ?? []);
      return {
        id: lane.id,
        name: lane.name,
        scope,
        proven: { met: criteria.filter((c) => c.met === true).length, total: criteria.length },
        constraints: rows.constraints.filter((c) => c.workflow_id === lane.id).length,
      };
    });
}

/** The line under the change's name. */
export function changeLineText(change: ChangeView): string {
  const nodes = change.scope.nodeIds.length;
  const parts = [
    change.proven.total > 0 ? `${change.proven.met} of ${change.proven.total} criteria proven` : 'no requirement derived yet',
    `${nodes} node${nodes === 1 ? '' : 's'} in scope`,
  ];
  if (change.constraints > 0) parts.push(`${change.constraints} constraint${change.constraints === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export interface CanvasScope {
  /** The nodes in scope. */
  nodeIds: ReadonlySet<string>;
  /** In scope, and the containers that hold them: none of these fade. */
  keepNodeIds: ReadonlySet<string>;
  crossingEdgeIds: ReadonlySet<string>;
  innerEdgeIds: ReadonlySet<string>;
  /** The change's constraints, marked on each node in scope. */
  constraintsByNode: ReadonlyMap<string, number>;
}

/** What the canvas draws for a change: a container of an in-scope node never fades. */
export function canvasScope(change: ChangeView, parentOf: (id: string) => string | null | undefined): CanvasScope {
  const nodeIds = new Set(change.scope.nodeIds);
  const keep = new Set(nodeIds);
  for (const id of nodeIds) {
    let p = parentOf(id);
    let guard = 0;
    while (p && !keep.has(p) && guard++ < 32) { keep.add(p); p = parentOf(p); }
  }
  return {
    nodeIds,
    keepNodeIds: keep,
    crossingEdgeIds: new Set(change.scope.crossingEdgeIds),
    innerEdgeIds: new Set(change.scope.innerEdgeIds),
    constraintsByNode: new Map(change.constraints > 0 ? [...nodeIds].map((id) => [id, change.constraints]) : []),
  };
}

/** How an edge draws while a scope is shown. */
export function edgeScopeState(scope: CanvasScope | null | undefined, edgeId: string): 'in' | 'crossing' | 'out' | undefined {
  if (!scope) return undefined;
  if (scope.crossingEdgeIds.has(edgeId)) return 'crossing';
  if (scope.innerEdgeIds.has(edgeId)) return 'in';
  return 'out';
}

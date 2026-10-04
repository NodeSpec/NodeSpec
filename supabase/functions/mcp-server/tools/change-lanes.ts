// AA.2 (owner 2026-09-23): the changes open on an imported project, read the
// way the import tools report them. A change is a workflow of kind 'change'
// (change-intent.ts); its scope is derived from the requirements its
// outcomes derived and where they map, never tagged. get_import_context
// reports each change with its scope and the repository's existing tests on
// the in-scope nodes (the baseline's proof); run_repo_import counts coverage
// on the in-scope nodes only while a change is open; backfill_requirements
// runs per node while one is.
//
// Structural supabase param + type-only SupabaseClient, so the module is
// offline-testable against FakeSupabase and MemorySupabase.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { changeScope, BASELINE_STEP } from "../../_shared/change-intent.ts";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

export interface ChangeReport {
  id: string;
  name: string;
  steps: string[];
  outcomes: number;
  /** Outcomes filed on the What works today step (or homed with no step yet). */
  baselineOutcomes: number;
  requirements: number;
  proven: { met: number; total: number };
  scope: { nodes: Array<{ id: string; label: string }>; crossingEdges: number };
  constraints: number;
  /** The repository's test files on the in-scope nodes, from the repo index. */
  baselineTests: { total: number; byNode: Array<{ node: string; files: number; sample: string[] }> };
}

/** Every change on the project with its derived scope. Empty when there is none or a read fails. */
export async function loadChanges(
  supabase: SupabaseClient,
  projectId: string,
  branchId: string,
  graph: { nodes?: Record<string, AnyRecord>; edges?: Record<string, AnyRecord> } | null,
): Promise<ChangeReport[]> {
  const { data: laneRows, error: laneErr } = await supabase
    .from("workflows")
    .select("id, name, sort_order")
    .eq("project_id", projectId)
    .eq("kind", "change");
  if (laneErr || !Array.isArray(laneRows) || laneRows.length === 0) return [];
  const lanes = (laneRows as Array<{ id: string; name: string; sort_order: number }>)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  const laneIds = lanes.map((l) => l.id);

  const { data: stepRows } = await supabase
    .from("workflow_steps")
    .select("id, workflow_id, name, sort_order")
    .in("workflow_id", laneIds);
  const steps = ((stepRows ?? []) as Array<{ id: string; workflow_id: string; name: string; sort_order: number }>)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const { data: outcomeRows } = await supabase
    .from("requirement_candidates")
    .select("id, workflow_id")
    .eq("project_id", projectId)
    .eq("branch_id", branchId)
    .eq("kind", "outcome")
    .neq("status", "dismissed");
  const outcomes = (outcomeRows ?? []) as Array<{ id: string; workflow_id: string | null }>;
  const outcomeIds = outcomes.map((o) => o.id);

  const { data: mapRows } = outcomeIds.length > 0
    ? await supabase.from("outcome_step_maps").select("candidate_id, step_id").eq("branch_id", branchId).in("candidate_id", outcomeIds)
    : { data: [] };
  const stepsOf = new Map<string, string[]>();
  for (const m of (mapRows ?? []) as Array<{ candidate_id: string; step_id: string }>) {
    stepsOf.set(m.candidate_id, [...(stepsOf.get(m.candidate_id) ?? []), m.step_id]);
  }

  const { data: derRows } = outcomeIds.length > 0
    ? await supabase.from("outcome_derivations").select("candidate_id, requirement_row_id").eq("project_id", projectId).in("candidate_id", outcomeIds)
    : { data: [] };
  const derivations = ((derRows ?? []) as Array<{ candidate_id: string; requirement_row_id: string }>)
    .map((d) => ({ candidateId: d.candidate_id, requirementRowId: d.requirement_row_id }));
  const rowIds = [...new Set(derivations.map((d) => d.requirementRowId))];

  let mappings: Array<{ requirementRowId: string; nodeId: string }> = [];
  const criteriaByRow = new Map<string, AnyRecord[]>();
  if (rowIds.length > 0) {
    const [{ data: maps }, { data: reqs }] = await Promise.all([
      supabase.from("specification_mappings").select("requirement_id, node_id").in("requirement_id", rowIds),
      supabase.from("specification_requirements").select("id, acceptance_criteria, archived_at").in("id", rowIds),
    ]);
    const live = new Set(Object.keys(graph?.nodes ?? {}));
    mappings = ((maps ?? []) as Array<{ requirement_id: string; node_id: string }>)
      .filter((m) => live.has(m.node_id))
      .map((m) => ({ requirementRowId: m.requirement_id, nodeId: m.node_id }));
    for (const r of (reqs ?? []) as AnyRecord[]) if (!r.archived_at) criteriaByRow.set(String(r.id), (r.acceptance_criteria ?? []) as AnyRecord[]);
  }

  const { data: conRows } = await supabase
    .from("project_constraints")
    .select("workflow_id")
    .eq("project_id", projectId)
    .in("workflow_id", laneIds);
  const constraintsByLane = new Map<string, number>();
  for (const c of (conRows ?? []) as Array<{ workflow_id: string }>) constraintsByLane.set(c.workflow_id, (constraintsByLane.get(c.workflow_id) ?? 0) + 1);

  const edges = Object.values(graph?.edges ?? {}).map((e) => ({ id: String(e.id), source: String(e.source), target: String(e.target) }));
  const input = {
    outcomes: outcomes.map((o) => ({ id: o.id, workflowId: o.workflow_id, stepIds: stepsOf.get(o.id) ?? [] })),
    steps: steps.map((s) => ({ id: s.id, workflowId: s.workflow_id })),
    derivations,
    mappings,
    edges,
  };

  const scopes = lanes.map((l) => ({ lane: l, scope: changeScope(input, l.id) }));
  const scopeNodes = [...new Set(scopes.flatMap((s) => s.scope.nodeIds))];
  const testsByNode = new Map<string, string[]>();
  if (scopeNodes.length > 0) {
    const { data: testRows } = await supabase
      .from("repo_index")
      .select("path, node_id")
      .eq("branch_id", branchId)
      .eq("role", "test")
      .in("node_id", scopeNodes)
      .limit(500);
    for (const t of (testRows ?? []) as Array<{ path: string; node_id: string }>) {
      testsByNode.set(t.node_id, [...(testsByNode.get(t.node_id) ?? []), t.path]);
    }
  }

  const label = (id: string) => String(graph?.nodes?.[id]?.label ?? id);
  return scopes.map(({ lane, scope }) => {
    const own = steps.filter((s) => s.workflow_id === lane.id);
    const baselineStep = own.find((s) => s.name === BASELINE_STEP) ?? own[0];
    const criteria = scope.requirementRowIds.flatMap((r) => criteriaByRow.get(r) ?? []);
    const byNode = scope.nodeIds
      .map((id) => ({ node: label(id), paths: [...(testsByNode.get(id) ?? [])].sort() }))
      .filter((n) => n.paths.length > 0)
      .map((n) => ({ node: n.node, files: n.paths.length, sample: n.paths.slice(0, 3) }));
    return {
      id: lane.id,
      name: lane.name,
      steps: own.map((s) => s.name),
      outcomes: scope.outcomeIds.length,
      baselineOutcomes: baselineStep
        ? scope.outcomeIds.filter((id) => (stepsOf.get(id) ?? []).includes(baselineStep.id)).length
        : 0,
      requirements: scope.requirementRowIds.filter((r) => criteriaByRow.has(r)).length,
      proven: { met: criteria.filter((c) => c.met === true).length, total: criteria.length },
      scope: { nodes: scope.nodeIds.map((id) => ({ id, label: label(id) })), crossingEdges: scope.crossingEdgeIds.length },
      constraints: constraintsByLane.get(lane.id) ?? 0,
      baselineTests: { total: byNode.reduce((n, b) => n + b.files, 0), byNode },
    };
  });
}

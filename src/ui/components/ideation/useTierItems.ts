// V3 P4 (task 4.2): the tier planes' ONE data assembly — TIERS + ITEMS[]
// from the Workflow Space design, flattened onto real tables:
//
//   outcome — requirement_candidates (pending + accepted; dismissed is
//             terminal and never renders)
//   req     — specification_requirements (canonical)
//   arch    — graph nodes (the same derived graph the editor holds)
//   plan    — task_items
//   code    — artifacts bound to nodes in the graph
//
// PARENT CHAINS point upstream: req → the candidate that minted it
// (requirement_row_id), node → the requirements mapped onto it, task and
// artifact → their node. chainOf() lights the transitive closure both
// ways — the design's "click a card: the chain lights and the rest
// recedes".
//
// STEP-MAP BARS: outcome_step_maps rows resolve through the lane board's
// steps (name + lane color) onto the outcome cards.
//
// TONE is deterministic, rows-not-taste (pinned):
//   gap   — a missing link: candidate with no testable criterion,
//           requirement with no mapped node, node with no requirement.
//   drift — evidence out of date: any criterion carrying evidenceStale,
//           or an orphaned task.
//   ok    — proven/settled: every criterion met (>0), a done task, a
//           promoted candidate.
//   none  — everything else (in progress is the default state of work).
//
// Reads are batched one-per-table; assembly is pure and pinned in
// tier-planes.test.ts.
import { useCallback, useEffect, useState } from 'react';
import type { Graph } from '@nodespec/core/types.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import type { WorkflowLane } from './useWorkflowLanes.js';

export type TierKey = 'outcome' | 'req' | 'arch' | 'plan' | 'code';
export type TierTone = 'ok' | 'drift' | 'gap' | 'none';

export const TIER_ORDER: readonly TierKey[] = ['outcome', 'req', 'arch', 'plan', 'code'];

export const TIER_LABEL: Record<TierKey, string> = {
  outcome: 'Outcomes',
  req: 'Requirements',
  arch: 'Architecture',
  plan: 'Plan',
  code: 'Code',
};

export interface TierItem {
  id: string;
  tier: TierKey;
  label: string;
  sub?: string;
  tone: TierTone;
  /** Upstream links (ids of items one tier up, arch for plan/code). */
  parentIds: string[];
  /** Outcome cards: the steps this outcome maps to (name + lane color). */
  stepRefs?: Array<{ stepId: string; name: string; color: string | null }>;
  /** Candidate/requirement cards: criteria rollup for the card line. */
  criteria?: { total: number; met: number; stale: number };
  /** 4.3: the raw criterion rows + chip context — the detail strip
   *  renders criterionChips() over these when the card is selected. */
  criteriaDetail?: { promotedOrigin: boolean; rows: Array<Record<string, unknown>> };
  /** Outcome cards: promoted → the minted requirement's row id. */
  promotedTo?: string | null;
  /** Outcome cards: the raw candidate row — the promotion gate (4.6)
   *  reads and writes through it. */
  candidate?: CandidateItemRow;
}

export interface CandidateItemRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  kind: string;
  key: string;
  status: string;
  node_id: string | null;
  criteria: Array<{ text?: string; verification?: string }> | null;
  requirement_row_id: string | null;
  /** 9.5 (v3v): the outcome's HOME workflow — exactly one; step maps may still touch other lanes. */
  workflow_id?: string | null;
  /** 7.3: classification mark (Government) — only cleared viewers ever receive the row. */
  mark?: string | null;
  /** V3 4.1: where the candidate came from (the import's source line, or
   *  the owner's note); Work's rail says it in words. */
  evidence?: Record<string, unknown> | null;
}

export interface RequirementItemRow {
  id: string;
  requirement_id: string;
  name: string;
  acceptance_criteria: Array<{ text?: string; met?: boolean; evidenceStale?: unknown }> | null;
  /** metadata.promotion marks a requirement minted from a candidate. */
  metadata?: Record<string, unknown> | null;
  /** 9.8 (v3y): the explicit archive. */
  archived_at?: string | null;
  /** 9.11: the verify lane reads the lock, the mark and the write token. */
  locked?: boolean | null;
  mark?: string | null;
  updated_at?: string | null;
  /** 9.10: the description is edited on the verify lane. */
  description?: string | null;
}

export interface MappingItemRow {
  requirement_id: string | null;
  node_id: string | null;
}

export interface TaskItemItemRow {
  id: string;
  node_id: string;
  display_id: string | null;
  title: string;
  done: boolean;
  orphaned: boolean;
}

export interface StepMapRow {
  candidate_id: string;
  step_id: string;
}

const criteriaRollup = (list: Array<{ met?: boolean; evidenceStale?: unknown }> | null | undefined) => {
  const criteria = Array.isArray(list) ? list : [];
  return {
    total: criteria.length,
    met: criteria.filter((c) => c && c.met === true).length,
    stale: criteria.filter((c) => c && c.evidenceStale != null && c.evidenceStale !== false).length,
  };
};

export function assembleTierItems(input: {
  candidates: CandidateItemRow[];
  requirements: RequirementItemRow[];
  mappings: MappingItemRow[];
  taskItems: TaskItemItemRow[];
  stepMaps: StepMapRow[];
  graph: Graph | null;
  lanes: WorkflowLane[];
}): TierItem[] {
  const items: TierItem[] = [];
  const stepById = new Map<string, { name: string; color: string | null }>();
  for (const lane of input.lanes) {
    for (const s of lane.steps) stepById.set(s.id, { name: s.name, color: lane.color });
  }
  const stepsByCandidate = new Map<string, Array<{ stepId: string; name: string; color: string | null }>>();
  for (const m of input.stepMaps) {
    const step = stepById.get(m.step_id);
    if (!step) continue;
    if (!stepsByCandidate.has(m.candidate_id)) stepsByCandidate.set(m.candidate_id, []);
    stepsByCandidate.get(m.candidate_id)!.push({ stepId: m.step_id, ...step });
  }

  // outcome — dismissed is terminal: it never renders.
  const candidateByReqRow = new Map<string, string>();
  for (const cand of input.candidates) {
    if (cand.status === 'dismissed') continue;
    const rollup = { ...criteriaRollup(cand.criteria as never), met: 0, stale: 0 };
    // v3l (R5): derived at least once — the first derivation freezes this link; status stays pending until settled.
    const promoted = !!cand.requirement_row_id;
    if (promoted) candidateByReqRow.set(cand.requirement_row_id!, cand.id);
    items.push({
      id: cand.id,
      tier: 'outcome',
      label: cand.name,
      sub: cand.kind,
      tone: promoted ? 'ok' : rollup.total === 0 ? 'gap' : 'none',
      parentIds: [],
      stepRefs: stepsByCandidate.get(cand.id) ?? [],
      criteria: rollup,
      criteriaDetail: {
        promotedOrigin: false,
        rows: (Array.isArray(cand.criteria) ? cand.criteria : []) as Array<Record<string, unknown>>,
      },
      promotedTo: promoted ? cand.requirement_row_id : null,
      candidate: cand,
    });
  }

  // req — parents: the candidate that minted it.
  const nodesByReqRow = new Map<string, string[]>();
  for (const m of input.mappings) {
    if (!m.requirement_id || !m.node_id) continue;
    if (!nodesByReqRow.has(m.requirement_id)) nodesByReqRow.set(m.requirement_id, []);
    nodesByReqRow.get(m.requirement_id)!.push(m.node_id);
  }
  for (const req of input.requirements) {
    const rollup = criteriaRollup(req.acceptance_criteria);
    const mapped = nodesByReqRow.get(req.id) ?? [];
    const tone: TierTone = mapped.length === 0
      ? 'gap'
      : rollup.stale > 0
        ? 'drift'
        : rollup.total > 0 && rollup.met === rollup.total
          ? 'ok'
          : 'none';
    const minter = candidateByReqRow.get(req.id);
    const promotedOrigin = !!(req.metadata && typeof req.metadata === 'object' && 'promotion' in req.metadata);
    items.push({
      id: req.id,
      tier: 'req',
      label: req.name,
      sub: req.requirement_id,
      tone,
      parentIds: minter ? [minter] : [],
      criteria: rollup,
      criteriaDetail: {
        promotedOrigin,
        rows: (Array.isArray(req.acceptance_criteria) ? req.acceptance_criteria : []) as Array<Record<string, unknown>>,
      },
    });
  }

  // arch — the graph's nodes; parents: mapped requirements.
  const graphNodes = input.graph ? Object.values(input.graph.nodes ?? {}) : [];
  const nodeIds = new Set(graphNodes.map((n) => n.id));
  const reqsByNode = new Map<string, string[]>();
  for (const m of input.mappings) {
    if (!m.requirement_id || !m.node_id) continue;
    if (!reqsByNode.has(m.node_id)) reqsByNode.set(m.node_id, []);
    reqsByNode.get(m.node_id)!.push(m.requirement_id);
  }
  for (const node of graphNodes) {
    const reqs = reqsByNode.get(node.id) ?? [];
    items.push({
      id: node.id,
      tier: 'arch',
      label: node.label,
      sub: node.type,
      tone: reqs.length === 0 ? 'gap' : 'none',
      parentIds: reqs,
    });
  }

  // plan — task items; parents: their node (only when the node renders).
  for (const task of input.taskItems) {
    items.push({
      id: task.id,
      tier: 'plan',
      label: task.title,
      sub: task.display_id ?? undefined,
      tone: task.done ? 'ok' : task.orphaned ? 'drift' : 'none',
      parentIds: nodeIds.has(task.node_id) ? [task.node_id] : [],
    });
  }

  // code — bound artifacts; parents: their node.
  const artifacts = input.graph ? Object.values(input.graph.artifacts ?? {}) : [];
  for (const artifact of artifacts) {
    items.push({
      id: artifact.id,
      tier: 'code',
      label: artifact.path ?? artifact.id,
      sub: artifact.kind,
      tone: 'none',
      parentIds: artifact.nodeId && nodeIds.has(artifact.nodeId) ? [artifact.nodeId] : [],
    });
  }

  return items;
}

/** The lit set for a selection: the item, its transitive parents, and its
 *  transitive children (children = items whose parentIds include a lit
 *  ancestor). Everything else recedes. */
export function chainOf(items: TierItem[], selectedId: string | null): Set<string> {
  const chain = new Set<string>();
  if (!selectedId) return chain;
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!byId.has(selectedId)) return chain;
  chain.add(selectedId);

  // Upstream: walk parentIds transitively.
  const up = [selectedId];
  while (up.length > 0) {
    const cur = byId.get(up.pop()!);
    for (const pid of cur?.parentIds ?? []) {
      if (!chain.has(pid) && byId.has(pid)) { chain.add(pid); up.push(pid); }
    }
  }
  // A promoted outcome also chains to the requirement it minted.
  const selected = byId.get(selectedId);
  if (selected?.promotedTo && byId.has(selected.promotedTo)) chain.add(selected.promotedTo);

  // Downstream: repeated sweeps until settled (items are few; N is small).
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (chain.has(item.id)) continue;
      if (item.parentIds.some((pid) => chain.has(pid)) || (item.promotedTo && chain.has(item.promotedTo))) {
        chain.add(item.id);
        grew = true;
      }
    }
  }
  return chain;
}

export interface TierItemsApi {
  items: TierItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTierItems(
  projectId: string | null | undefined,
  graph: Graph | null,
  lanes: WorkflowLane[],
): TierItemsApi {
  const [rows, setRows] = useState<{
    candidates: CandidateItemRow[];
    requirements: RequirementItemRow[];
    mappings: MappingItemRow[];
    taskItems: TaskItemItemRow[];
    stepMaps: StepMapRow[];
  }>({ candidates: [], requirements: [], mappings: [], taskItems: [], stepMaps: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      const supabase = getSupabaseClient();
      const { data: cands, error: candErr } = await supabase
        .from('requirement_candidates')
        .select('id, name, description, category, kind, key, status, node_id, criteria, requirement_row_id, workflow_id')
        .eq('project_id', projectId)
        .neq('status', 'dismissed');
      if (candErr) throw new Error(candErr.message);

      const { data: spec } = await supabase
        .from('project_specifications')
        .select('id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let requirements: RequirementItemRow[] = [];
      let mappings: MappingItemRow[] = [];
      if (spec?.id) {
        const { data: reqs, error: reqErr } = await supabase
          .from('specification_requirements')
          .select('id, requirement_id, name, acceptance_criteria, metadata')
          .eq('specification_id', spec.id);
        if (reqErr) throw new Error(reqErr.message);
        requirements = (reqs ?? []) as RequirementItemRow[];
        const { data: maps, error: mapErr } = await supabase
          .from('specification_mappings')
          .select('requirement_id, node_id')
          .eq('specification_id', spec.id);
        if (mapErr) throw new Error(mapErr.message);
        mappings = (maps ?? []) as MappingItemRow[];
      }

      const { data: tasks, error: taskErr } = await supabase
        .from('task_items')
        .select('id, node_id, display_id, title, done, orphaned')
        .eq('project_id', projectId);
      if (taskErr) throw new Error(taskErr.message);

      const candidates = (cands ?? []) as CandidateItemRow[];
      let stepMaps: StepMapRow[] = [];
      if (candidates.length > 0) {
        const { data: maps2, error: smErr } = await supabase
          .from('outcome_step_maps')
          .select('candidate_id, step_id')
          .in('candidate_id', candidates.map((c) => c.id));
        if (smErr) throw new Error(smErr.message);
        stepMaps = (maps2 ?? []) as StepMapRow[];
      }

      setRows({
        candidates,
        requirements,
        mappings,
        taskItems: (tasks ?? []) as TaskItemItemRow[],
        stepMaps,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the chain');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const items = assembleTierItems({ ...rows, graph, lanes });
  return { items, loading, error, refresh };
}

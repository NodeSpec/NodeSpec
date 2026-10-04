// V3 P4 (task 4.1): the lane board's ONE data assembly. LANES are the
// `workflows` table (project-scoped by ruling — business structure,
// stable across branches) and their ordered `workflow_steps` (v3c).
//
// NO N+1: one batched select per table — workflows by project, steps by
// the returned workflow ids. Assembly and ordering are
// PURE exported functions (pinned in workflow-board.test.ts); the hook
// wires them to supabase and owns the CRUD lanes the board renders.
//
// CRUD here is the HUMAN lane: the signed-in owner editing their own
// board under RLS. Agent-side workflow edits travel the change router
// (upsert_workflow patches, candidates tier) — two doors, one table.
// AE.7 (owner 2026-09-25): a TEAMMATE's edit takes the agents' door: in
// propose mode every mutation compiles to the same spec ops and files one
// proposal the owner decides under Proposals (workflow-proposals.ts); the
// lanes on hand do not change until it is accepted.
import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { changeSteps, type ChangeIntent } from '../../utils/change-intent.js';
import { fileWorkflowProposal, laneDelete, laneUpsert, proposalNotice, stepDelete, stepUpsert, type WorkflowSpecPatch } from './workflow-proposals.js';

export interface WorkflowStep {
  id: string;
  name: string;
  sortOrder: number;
}

/** V3 6.6: `workflows.kind`. A `workflow` is one the person made (or the
 *  first lane the home-lane trigger makes for an outcome). `imported` is
 *  the ONE system lane the trigger makes to home import-born candidates
 *  (api, data, behavior); the app never draws it as a workflow row, the
 *  aside's Imported row stands for it. AA.2: a `change` is a change the
 *  person is making to an imported system; it is drawn as a workflow. */
export type WorkflowKind = 'workflow' | 'imported' | 'change';

export interface WorkflowLane {
  id: string;
  name: string;
  kind: WorkflowKind;
  color: string | null;
  ownerLabel: string | null;
  contributors: string[];
  sortOrder: number;
  steps: WorkflowStep[];
}

export interface WorkflowRow {
  id: string;
  name: string;
  /** Absent on a row read before the column existed: reads 'workflow'. */
  kind?: string | null;
  color: string | null;
  owner_label: string | null;
  contributors: string[] | null;
  sort_order: number | null;
}

export interface WorkflowStepRow {
  id: string;
  workflow_id: string;
  name: string;
  sort_order: number | null;
}

const byOrderThenName = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/** Group + order the two batched reads into lanes. Steps whose workflow is
 *  not in the read (a mid-flight delete) drop silently — never a crash. */
export function assembleLanes(workflows: WorkflowRow[], steps: WorkflowStepRow[]): WorkflowLane[] {
  const lanes = workflows.map((w) => ({
    id: w.id,
    name: w.name,
    kind: (w.kind === 'imported' || w.kind === 'change' ? w.kind : 'workflow') as WorkflowKind,
    color: w.color ?? null,
    ownerLabel: w.owner_label ?? null,
    contributors: Array.isArray(w.contributors) ? w.contributors : [],
    sortOrder: w.sort_order ?? 0,
    steps: [] as WorkflowStep[],
  }));
  const byId = new Map(lanes.map((l) => [l.id, l]));
  for (const s of steps) {
    const lane = byId.get(s.workflow_id);
    if (!lane) continue;
    lane.steps.push({ id: s.id, name: s.name, sortOrder: s.sort_order ?? 0 });
  }
  for (const lane of lanes) lane.steps.sort(byOrderThenName);
  return lanes.sort(byOrderThenName);
}

/** V3 6.6: the lanes a person works in, and the import's system lane apart.
 *  Work's aside, its counts, the R1 lane gate and every move target read
 *  `workflows`; `imported` is the lane the trigger homes import-born
 *  candidates in, which the aside's Imported row already lists. Pure. */
export function splitLanes(lanes: readonly WorkflowLane[]): { workflows: WorkflowLane[]; imported: WorkflowLane | null } {
  return {
    workflows: lanes.filter((l) => l.kind !== 'imported'),
    imported: lanes.find((l) => l.kind === 'imported') ?? null,
  };
}

/** AA.2: a change lane and its intent's template steps, What works today
 *  first. The one insert the import question and Work share. */
export async function insertChange(
  supabase: ReturnType<typeof getSupabaseClient>,
  projectId: string,
  name: string,
  intent: ChangeIntent,
  sortOrder: number,
): Promise<{ id: string } | { error: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: 'A change needs a name.' };
  const { data, error } = await supabase.from('workflows').insert({
    project_id: projectId,
    name: trimmed,
    kind: 'change',
    sort_order: sortOrder,
  }).select('id').single();
  if (error) return { error: error.code === '23505' ? `A workflow named "${trimmed}" already exists.` : error.message };
  const id = (data as { id: string }).id;
  const steps = changeSteps(intent);
  if (steps.length > 0) {
    const { error: stepErr } = await supabase.from('workflow_steps')
      .insert(steps.map((step, i) => ({ workflow_id: id, name: step, sort_order: i })));
    if (stepErr) return { error: `The change was started but its steps were not written: ${stepErr.message}` };
  }
  return { id };
}

/** Append position: max + 1 (never reindexes siblings on insert). */
export function nextSortOrder(existing: Array<{ sortOrder: number }>): number {
  return existing.reduce((max, e) => Math.max(max, e.sortOrder), -1) + 1;
}


/** Swap-based reorder: returns the two (id, sortOrder) writes that move
 *  `id` one position in `dir`, or null at the edge. Pure — the hook
 *  persists the pair. */
/** 9.2: the order after dropping `dragId` onto `overId` — before it when
 *  moving up the list, after it when moving down (what a drop reads as). */
export function reorderByDrag(ids: readonly string[], dragId: string, overId: string): string[] {
  const from = ids.indexOf(dragId);
  const over = ids.indexOf(overId);
  if (from < 0 || over < 0 || from === over) return [...ids];
  const next = ids.filter((id) => id !== dragId);
  const at = next.indexOf(overId) + (from < over ? 1 : 0);
  next.splice(at, 0, dragId);
  return next;
}

export function reorderSwap(
  items: Array<{ id: string; sortOrder: number }>,
  id: string,
  dir: 'up' | 'down',
): Array<{ id: string; sortOrder: number }> | null {
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const otherIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (otherIdx < 0 || otherIdx >= items.length) return null;
  const a = items[idx], b = items[otherIdx];
  // Equal orders (legacy rows) would swap into a no-op; disambiguate.
  const aOrder = b.sortOrder === a.sortOrder ? (dir === 'up' ? a.sortOrder - 1 : a.sortOrder + 1) : b.sortOrder;
  return [
    { id: a.id, sortOrder: aOrder },
    { id: b.id, sortOrder: a.sortOrder },
  ];
}

/** AL.5 (owner 2026-10-01: "I can't delete a starting workflow after I
 *  create it"). The database refuses to delete a workflow while an outcome
 *  calls it home (RESTRICT, 9.5), so the delete moves them first. Each
 *  outcome goes to the first other workflow it is already placed on, else
 *  to the first other workflow; the moves keyed by workflow id. With no
 *  other workflow there is nowhere to move them, and the refusal says so.
 *  Pure. */
export function rehomePlan(
  laneId: string,
  lanes: readonly WorkflowLane[],
  homed: ReadonlyArray<{ id: string; stepIds: readonly string[] }>,
): { moves: Map<string, string[]> } | { refusal: string } {
  const moves = new Map<string, string[]>();
  if (homed.length === 0) return { moves };
  const others = lanes.filter((l) => l.id !== laneId);
  if (others.length === 0) {
    const name = lanes.find((l) => l.id === laneId)?.name ?? 'This workflow';
    const n = homed.length;
    return { refusal: `"${name}" is your only workflow and ${n === 1 ? 'an outcome lives' : `${n} outcomes live`} in it. Add another workflow first, so ${n === 1 ? 'it has' : 'they have'} somewhere to go.` };
  }
  for (const o of homed) {
    const to = others.find((l) => l.steps.some((s) => o.stepIds.includes(s.id))) ?? others[0];
    moves.set(to.id, [...(moves.get(to.id) ?? []), o.id]);
  }
  return { moves };
}

/** AE.7: propose (a teammate) instead of writing; the email names the proposal. */
export interface WorkflowLanesOptions { propose?: boolean; email?: string | null }

export interface WorkflowLanesApi {
  /** AE.7: every mutation files a proposal instead of writing. */
  proposing: boolean;
  /** AE.7: the last proposal filed, for the surface's toast. */
  notice: { text: string; at: number } | null;
  /** The person's workflows (kind 'workflow', and AA.2's 'change'); the import's system lane is not among them. */
  lanes: WorkflowLane[];
  /** V3 6.6: the id of the import's system lane (kind 'imported'), when the trigger has made one. */
  importedLaneId: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** The new lane's id, or the refusal in words (a duplicate name is named). */
  createLane: (name: string) => Promise<{ id: string; proposed?: boolean } | { error: string }>;
  /** AA.2: start a change on an imported system, its steps from the intent's template. */
  createChange: (name: string, intent: ChangeIntent) => Promise<{ id: string; proposed?: boolean } | { error: string }>;
  updateLane: (id: string, changes: Partial<Pick<WorkflowLane, 'name' | 'color' | 'ownerLabel' | 'contributors'>>) => Promise<string | null>;
  deleteLane: (id: string) => Promise<string | null>;
  moveLane: (id: string, dir: 'up' | 'down') => Promise<string | null>;
  addStep: (workflowId: string, name: string) => Promise<string | null>;
  renameStep: (stepId: string, name: string) => Promise<string | null>;
  deleteStep: (stepId: string) => Promise<string | null>;
  moveStep: (workflowId: string, stepId: string, dir: 'up' | 'down') => Promise<string | null>;
  /** 9.2: persist a full order (a drag drop) — sort_order = index, only rows that moved. */
  reorderSteps: (workflowId: string, orderedStepIds: readonly string[]) => Promise<string | null>;
}

/** Every mutation returns null on success or the error message — the board
 *  surfaces it and the follow-up refresh keeps the render honest. */
export function useWorkflowLanes(projectId: string | null | undefined, opts: WorkflowLanesOptions = {}): WorkflowLanesApi {
  const proposing = !!opts.propose;
  const email = opts.email ?? null;
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const [lanes, setLanes] = useState<WorkflowLane[]>([]);
  const [importedLaneId, setImportedLaneId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Q: which project the lanes on hand belong to. A caller that switches the
  // project (Work passes null below Indie, the id once the plan resolves)
  // reads loading in the same render, before the fetch effect has run.
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setLanes([]);
      setImportedLaneId(null);
      setLoading(false);
      setLoadedFor(null);
      return;
    }
    try {
      const supabase = getSupabaseClient();
      const { data: wfRows, error: wfErr } = await supabase
        .from('workflows')
        .select('id, name, kind, color, owner_label, contributors, sort_order')
        .eq('project_id', projectId);
      if (wfErr) throw new Error(wfErr.message);
      const workflows = (wfRows ?? []) as WorkflowRow[];
      let steps: WorkflowStepRow[] = [];
      if (workflows.length > 0) {
        const { data: stepRows, error: stepErr } = await supabase
          .from('workflow_steps')
          .select('id, workflow_id, name, sort_order')
          .in('workflow_id', workflows.map((w) => w.id));
        if (stepErr) throw new Error(stepErr.message);
        steps = (stepRows ?? []) as WorkflowStepRow[];
      }
      const split = splitLanes(assembleLanes(workflows, steps));
      setLanes(split.workflows);
      setImportedLaneId(split.imported?.id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflows');
    } finally {
      setLoading(false);
      setLoadedFor(projectId);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // PromiseLike, not Promise: supabase query builders are thenables.
  const run = useCallback(async (op: () => PromiseLike<{ error: { message: string } | null }>): Promise<string | null> => {
    try {
      const { error: opErr } = await op();
      if (opErr) return opErr.message;
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Write failed';
    }
  }, [refresh]);

  // AE.7: one proposal for one edit; null on success, the refusal otherwise.
  const propose = useCallback(async (patches: WorkflowSpecPatch[], explanation: string): Promise<string | null> => {
    if (!projectId) return 'No project open.';
    const r = await fileWorkflowProposal(projectId, patches, explanation, email);
    if ('error' in r) return r.error;
    setNotice({ text: proposalNotice(explanation), at: Date.now() });
    return null;
  }, [projectId, email]);
  const proposeCreate = useCallback(async (patches: WorkflowSpecPatch[], explanation: string): Promise<{ id: string; proposed: true } | { error: string }> => {
    if (!projectId) return { error: 'No project open.' };
    const r = await fileWorkflowProposal(projectId, patches, explanation, email);
    if ('error' in r) return r;
    setNotice({ text: proposalNotice(explanation), at: Date.now() });
    return { id: r.proposalId, proposed: true };
  }, [projectId, email]);

  const createLane = useCallback(async (name: string): Promise<{ id: string; proposed?: boolean } | { error: string }> => {
    const trimmed = name.trim();
    if (!projectId || !trimmed) return { error: 'A workflow needs a name.' };
    if (proposing) return proposeCreate([laneUpsert({ name: trimmed, sortOrder: nextSortOrder(lanes) })], `add the workflow "${trimmed}"`);
    try {
      const { data, error: err } = await getSupabaseClient().from('workflows').insert({
        project_id: projectId,
        name: trimmed,
        sort_order: nextSortOrder(lanes),
      }).select('id').single();
      if (err) return { error: err.code === '23505' ? `A workflow named "${trimmed}" already exists.` : err.message };
      await refresh();
      return { id: (data as { id: string }).id };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'The workflow was not created.' };
    }
  }, [projectId, lanes, refresh, proposing, proposeCreate]);

  /** AA.2: start a change on an imported system. */
  const createChange = useCallback(async (name: string, intent: ChangeIntent): Promise<{ id: string; proposed?: boolean } | { error: string }> => {
    if (!projectId) return { error: 'No project open.' };
    if (proposing) {
      const trimmed = name.trim();
      if (!trimmed) return { error: 'A change needs a name.' };
      return proposeCreate([laneUpsert({ name: trimmed, kind: 'change', intent, sortOrder: nextSortOrder(lanes) })], `start the change "${trimmed}"`);
    }
    try {
      const made = await insertChange(getSupabaseClient(), projectId, name, intent, nextSortOrder(lanes));
      if ('id' in made) await refresh();
      return made;
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'The change was not started.' };
    }
  }, [projectId, lanes, refresh, proposing, proposeCreate]);

  const updateLane = useCallback(async (id: string, changes: Partial<Pick<WorkflowLane, 'name' | 'color' | 'ownerLabel' | 'contributors'>>) => {
    if (proposing) {
      const lane = lanes.find((l) => l.id === id);
      if (!lane) return 'No such workflow.';
      const name = (changes.name ?? lane.name).trim();
      return propose([laneUpsert({ id, name, color: changes.color, ownerLabel: changes.ownerLabel, contributors: changes.contributors })],
        changes.name !== undefined && name !== lane.name ? `rename the workflow "${lane.name}" to "${name}"` : `change the workflow "${lane.name}"`);
    }
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (changes.name !== undefined) {
      if (!changes.name.trim()) return 'A lane needs a name.';
      payload.name = changes.name.trim();
    }
    if (changes.color !== undefined) payload.color = changes.color;
    if (changes.ownerLabel !== undefined) payload.owner_label = changes.ownerLabel?.trim() || null;
    if (changes.contributors !== undefined) payload.contributors = changes.contributors;
    return run(() => getSupabaseClient().from('workflows').update(payload).eq('id', id));
  }, [run, proposing, lanes, propose]);

  const deleteLane = useCallback(async (id: string) => {
    const supabase = getSupabaseClient();
    // 9.5 (v3v): the database RESTRICTs the delete while any outcome calls
    // this lane home.
    if (proposing) {
      // A teammate's proposal carries the delete alone, which the database
      // would refuse at accept; say so in words, with the count, now.
      const { count } = await supabase
        .from('requirement_candidates').select('id', { count: 'exact', head: true }).eq('workflow_id', id);
      if ((count ?? 0) > 0) {
        return `This workflow is home to ${count} outcome${count === 1 ? '' : 's'}. The owner can remove it, moving them to another workflow.`;
      }
      return propose([laneDelete(id)], `remove the workflow "${lanes.find((l) => l.id === id)?.name ?? id}"`);
    }
    // AL.5: the owner's delete moves the lane's outcomes first (rehomePlan),
    // then removes the lane; its stages and their step maps go with it.
    return run(async () => {
      const { data: homedRows, error: homedErr } = await supabase
        .from('requirement_candidates').select('id').eq('workflow_id', id);
      if (homedErr) return { error: homedErr };
      const ids = ((homedRows ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (ids.length > 0) {
        const { data: mapRows, error: mapErr } = await supabase
          .from('outcome_step_maps').select('candidate_id, step_id').in('candidate_id', ids);
        if (mapErr) return { error: mapErr };
        const maps = (mapRows ?? []) as Array<{ candidate_id: string; step_id: string }>;
        const plan = rehomePlan(id, lanes, ids.map((cid) => ({ id: cid, stepIds: maps.filter((m) => m.candidate_id === cid).map((m) => m.step_id) })));
        if ('refusal' in plan) return { error: { message: plan.refusal } };
        for (const [to, moving] of plan.moves) {
          const { error: moveErr } = await supabase.from('requirement_candidates').update({ workflow_id: to }).in('id', moving);
          if (moveErr) return { error: moveErr };
        }
      }
      return supabase.from('workflows').delete().eq('id', id);
    });
  }, [run, proposing, lanes, propose]);

  const moveLane = useCallback(async (id: string, dir: 'up' | 'down') => {
    const writes = reorderSwap(lanes, id, dir);
    if (!writes) return null; // edge — nothing to do
    if (proposing) {
      return propose(writes.map((w) => laneUpsert({ id: w.id, name: lanes.find((l) => l.id === w.id)?.name ?? w.id, sortOrder: w.sortOrder })),
        `move the workflow "${lanes.find((l) => l.id === id)?.name ?? id}" ${dir}`);
    }
    return run(async () => {
      const supabase = getSupabaseClient();
      for (const w of writes) {
        const { error: e } = await supabase.from('workflows').update({ sort_order: w.sortOrder }).eq('id', w.id);
        if (e) return { error: e };
      }
      return { error: null };
    });
  }, [lanes, run, proposing, propose]);

  const addStep = useCallback(async (workflowId: string, name: string) => {
    if (!name.trim()) return 'A step needs a name.';
    const lane = lanes.find((l) => l.id === workflowId);
    if (proposing) return propose([stepUpsert({ workflowId, name: name.trim(), sortOrder: nextSortOrder(lane?.steps ?? []) })], `add the stage "${name.trim()}" to ${lane?.name ?? 'the workflow'}`);
    return run(() => getSupabaseClient().from('workflow_steps').insert({
      workflow_id: workflowId,
      name: name.trim(),
      sort_order: nextSortOrder(lane?.steps ?? []),
    }));
  }, [lanes, run, proposing, propose]);

  /** The lane a step sits on, and the step: the proposal ops name both. */
  const stepHome = useCallback((stepId: string): { lane: WorkflowLane; step: WorkflowStep } | null => {
    for (const lane of lanes) {
      const step = lane.steps.find((s) => s.id === stepId);
      if (step) return { lane, step };
    }
    return null;
  }, [lanes]);

  const renameStep = useCallback(async (stepId: string, name: string) => {
    if (!name.trim()) return 'A step needs a name.';
    if (proposing) {
      const home = stepHome(stepId);
      if (!home) return 'No such stage.';
      return propose([stepUpsert({ id: stepId, workflowId: home.lane.id, name: name.trim() })], `rename the stage "${home.step.name}" to "${name.trim()}"`);
    }
    return run(() => getSupabaseClient().from('workflow_steps')
      .update({ name: name.trim(), updated_at: new Date().toISOString() }).eq('id', stepId));
  }, [run, proposing, stepHome, propose]);

  const deleteStep = useCallback(async (stepId: string) => {
    if (proposing) return propose([stepDelete(stepId)], `remove the stage "${stepHome(stepId)?.step.name ?? stepId}"`);
    return run(() => getSupabaseClient().from('workflow_steps').delete().eq('id', stepId));
  }, [run, proposing, stepHome, propose]);

  const reorderSteps = useCallback(async (workflowId: string, orderedStepIds: readonly string[]) => {
    const lane = lanes.find((l) => l.id === workflowId);
    if (!lane) return null;
    const current = new Map(lane.steps.map((s) => [s.id, s.sortOrder]));
    const writes = orderedStepIds.map((id, i) => ({ id, sortOrder: i })).filter((w) => current.has(w.id) && current.get(w.id) !== w.sortOrder);
    if (writes.length === 0) return null;
    if (proposing) {
      return propose(writes.map((w) => stepUpsert({ id: w.id, workflowId, name: lane.steps.find((s) => s.id === w.id)?.name ?? w.id, sortOrder: w.sortOrder })),
        `reorder the stages of ${lane.name}`);
    }
    return run(async () => {
      const supabase = getSupabaseClient();
      for (const w of writes) {
        const { error: e } = await supabase.from('workflow_steps').update({ sort_order: w.sortOrder }).eq('id', w.id);
        if (e) return { error: e };
      }
      return { error: null };
    });
  }, [lanes, run, proposing, propose]);

  const moveStep = useCallback(async (workflowId: string, stepId: string, dir: 'up' | 'down') => {
    const lane = lanes.find((l) => l.id === workflowId);
    if (!lane) return null;
    const writes = reorderSwap(lane.steps, stepId, dir);
    if (!writes) return null;
    if (proposing) {
      return propose(writes.map((w) => stepUpsert({ id: w.id, workflowId, name: lane.steps.find((s) => s.id === w.id)?.name ?? w.id, sortOrder: w.sortOrder })),
        `move the stage "${lane.steps.find((s) => s.id === stepId)?.name ?? stepId}" ${dir}`);
    }
    return run(async () => {
      const supabase = getSupabaseClient();
      for (const w of writes) {
        const { error: e } = await supabase.from('workflow_steps').update({ sort_order: w.sortOrder }).eq('id', w.id);
        if (e) return { error: e };
      }
      return { error: null };
    });
  }, [lanes, run, proposing, propose]);

  const onHand = loadedFor === (projectId ?? null);
  return { proposing, notice, lanes: onHand ? lanes : [], importedLaneId: onHand ? importedLaneId : null, loading: loading || !onHand, error, refresh, createLane, createChange, updateLane, deleteLane, moveLane, addStep, renameStep, deleteStep, moveStep, reorderSteps };
}

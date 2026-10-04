/*
  Community edition stub. The plan's data hook (get_work_plan with the
  user's session, the proposed plan's items, the accept and reject lanes)
  is not part of the open-source distribution (R1: indie+; available on
  NodeSpec hosted Indie and above and in enterprise builds;
  https://nodespec.io/pricing). Work mounts the hook unconditionally (6.1:
  the record's "Set N in the plan" reads it); here it answers with the
  tier's named refusal and no plan, and the Plan tab stub renders nothing.
*/
import type { PlanView } from './plan-view.js';

export interface ProposedPlan { planId: string; version: number; summary: string | null; proposedBy: string | null; createdAt: string; sourceHash: string; items: Array<{ id: string; layer: number; rank: number; rationale: string | null }>; decisions: Array<{ from: string; to: string; decision: string }> }
export interface TaskRowRef { id: string; node_id: string; task_key: string; provenance: Record<string, unknown> | null }
export interface PriorityBoardApi {
  view: PlanView | null;
  proposed: ProposedPlan | null;
  taskRows: Map<string, TaskRowRef>;
  gated: string | null;
  error: string | null;
  loading: boolean;
  busy: boolean;
  refresh: () => Promise<void>;
  accept: (planId: string) => Promise<{ ok: boolean; error?: string }>;
  reject: (planId: string) => Promise<{ ok: boolean; error?: string }>;
}
const GATED = 'The plan is not included in the community edition.';
export const taskRowKey = (nodeId: string, key: string) => `${nodeId}::${key}`;
export function holdFor(_item: { kind: string; nodeId: string | null; itemKey: string }, _taskRows: Map<string, TaskRowRef>, _holds: unknown[]): null {
  return null;
}
export async function rejectWorkPlan(_planId: string): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: GATED };
}
export function usePriorityBoard(_projectId: string | null | undefined, _branchId: string | null | undefined): PriorityBoardApi {
  return {
    view: null, proposed: null, taskRows: new Map(), gated: GATED, error: null, loading: false, busy: false,
    refresh: async () => {},
    accept: async () => ({ ok: false, error: GATED }),
    reject: async () => ({ ok: false, error: GATED }),
  };
}

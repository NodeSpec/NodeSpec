// The Plan view's shapes as get_work_plan returns them, and the board's tag
// words. Plain types and labels only, so open code (Work, the community
// build's stubs) can name them; the board's model over them
// (priority-board-model.ts) is not part of the community bundle.

export interface PlanViewItem {
  id: string;
  kind: 'task' | 'test';
  nodeId: string | null;
  nodeLabel: string | null;
  itemKey: string;
  displayId: string;
  title: string;
  rank: number;
  layer: number;
  effort: number;
  earliestStart: number;
  slack: number;
  onCriticalPath: boolean;
  done: boolean;
  manual: boolean;
  inCycle: boolean;
  /** 9.8: leaves the working set (a done task whose doc dropped it); shown under Archived (n). */
  archived: boolean;
  requirementIds: string[];
}

export interface PlanViewEdge { from: string; to: string; coupling: 'tight' | 'loose'; rule: string; reason: string; evidence: Record<string, unknown> }

export interface AcceptedPlanView {
  planId: string;
  version: number;
  summary: string | null;
  acceptedAt: string | null;
  sourceHash: string;
  items: Array<{ id: string; rank: number; layer: number; effort: number; slack: number; onCriticalPath: boolean; rationale: string | null }>;
}

export interface PlanView {
  branchId: string;
  source: 'accepted-plan' | 'deterministic';
  sourceHash: string;
  stale: boolean;
  accepted: AcceptedPlanView | null;
  graph: { items: PlanViewItem[]; edges: PlanViewEdge[]; criticalPath: string[]; length: number; openQuestions: Array<{ cycle: string[]; question: string }> };
  requirements: Record<string, string>;
}

export type BoardTag = 'done' | 'critical' | 'blocked' | 'next' | 'manual' | 'queued';

/** 9.12: shown in sentence case, like every other state word in the app. The
 *  tag KEY stays lower case: it is the stored vocabulary. */
export const TAG_LABEL: Record<BoardTag, string> = {
  done: 'Done', critical: 'Critical', blocked: 'Blocked', next: 'Next', manual: 'Manual', queued: 'Queued',
};

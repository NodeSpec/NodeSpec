// The way INTO Work from another surface. The Architecture rail lists the
// requirements and outcomes on a node; clicking one opens Work on that
// record. A focus names the record; resolveWorkFocus (pure) says which list
// to show and what to select, from the rows Work already holds:
//
//   a requirement      All requirements, the row selected: its record pane
//                      opens (6.1)
//   an outcome         its home workflow, the row selected; an imported
//                      candidate (kind api, data, behavior) has no workflow
//                      row and lists under Imported
//   imported           the Imported list
//   a plan             the Plan tab with the proposed plan's diff shown (6.3);
//                      Work applies it before resolving anything here
//   a tab              that tab and nothing selected (the walkthrough); a tab
//                      the plan does not carry is not opened
//
// Nothing here reads a table.
import type { WorkflowLane } from '../ideation/useWorkflowLanes.js';
import type { Outcome } from '../ideation/useOutcomes.js';
import type { WorkSelection } from './work-selection.js';
import type { WorkTab } from './work-tabs.js';

/** The aside's Imported row is a list in the design's sense (a list with a
 *  rail) without being a workflow row; this is its id in the shell. */
export const IMPORTED_LANE = 'imported';

/** 6.1: the aside's first row, every live requirement in one list. */
export const ALL_REQUIREMENTS = 'all';

export interface WorkFocus {
  /** 6.3: 'plan' opens the Plan tab with the proposed plan's diff shown. */
  kind: 'outcome' | 'requirement' | 'imported' | 'plan' | 'tab';
  id?: string;
  /** kind 'tab': the tab to open. */
  tab?: WorkTab;
  /** A clock value; the same record focused twice is applied twice. */
  at: number;
}

/** A record another surface asks Work to open: a focus without its clock. */
export type WorkTarget = { kind: 'outcome' | 'requirement' | 'plan'; id: string };

export interface ResolvedFocus { laneId: string; selection: WorkSelection }

export function resolveWorkFocus(
  focus: WorkFocus,
  lanes: readonly Pick<WorkflowLane, 'id' | 'steps'>[],
  outcomes: readonly Pick<Outcome, 'id' | 'kind' | 'workflowId' | 'stepIds' | 'derivations'>[],
  /** AL.13: the workflow open now; a requirement with outcomes in several lands on its outcome there. */
  preferLaneId: string | null = null,
): ResolvedFocus {
  if (focus.kind === 'outcome' && focus.id) {
    const o = outcomes.find((x) => x.id === focus.id) ?? null;
    if (o && o.kind === 'outcome' && o.workflowId && lanes.some((l) => l.id === o.workflowId)) {
      return { laneId: o.workflowId, selection: { kind: 'row', identity: `outcome:${o.id}`, outcomeId: o.id, requirementRowId: null, stepIndex: 0 } };
    }
    return { laneId: IMPORTED_LANE, selection: { kind: 'lane' } };
  }
  if (focus.kind === 'requirement' && focus.id) {
    const rowId = focus.id;
    const deriving = outcomes.filter((x) => x.derivations.some((d) => d.requirementRowId === rowId));
    const o = deriving.find((x) => preferLaneId !== null && x.workflowId === preferLaneId) ?? deriving[0] ?? null;
    return { laneId: ALL_REQUIREMENTS, selection: { kind: 'row', identity: `req:${rowId}`, outcomeId: o?.id ?? '', requirementRowId: rowId, stepIndex: 0 } };
  }
  return { laneId: IMPORTED_LANE, selection: { kind: 'lane' } };
}

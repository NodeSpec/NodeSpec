import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { outcomesForLane, isVisitingLane, outcomeCountByStep, type Outcome } from '../ui/components/ideation/useOutcomes.js';
import type { WorkflowLane } from '../ui/components/ideation/useWorkflowLanes.js';

// V3 (Workflow Space) → 9.5 (v3v, owner ruling 2026-09-16: "we should not
// have stray mapping of our data within a project where there's orphan
// process"): the OUTCOMES pool. Every outcome has exactly ONE home lane
// (workflow_id, NOT NULL at the database). A lane pools the outcomes that
// live in it, plus the outcomes that TOUCH it through a step map — the JOIN
// seam the demo seed files on purpose (an outcome in the design lane whose
// step map reaches into the delivery lane). An unmapped outcome shows in its
// home lane and nowhere else: no lane is ever a guess. The write lanes are
// pinned by source: create names the focused lane, a lane delete refuses in
// words while any outcome calls it home, and the move re-homes without
// touching a single step map.

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

const lane = (id: string, stepIds: string[]): WorkflowLane => ({
  id, name: id, kind: 'workflow', color: null, ownerLabel: null, contributors: [], sortOrder: 0,
  steps: stepIds.map((sid, i) => ({ id: sid, name: sid, sortOrder: i })),
});

const outcome = (id: string, home: string, stepIds: string[]): Outcome => ({
  id, name: id, description: null, category: null, kind: 'outcome', key: `outcome:${id}`,
  status: 'pending', node_id: null, criteria: [], requirement_row_id: null,
  workflowId: home, stepIds, live: false, promoted: false, reqRef: null,
  derivations: [], claimed: {}, reqRefs: [], settled: false, serves: [],
});

describe('9.5 · outcomesForLane: a home, plus the touches', () => {
  const design = lane('design', ['s1', 's2']);
  const delivery = lane('delivery', ['s3']);
  const outcomes = [
    outcome('o-design', 'design', ['s1']),
    outcome('o-delivery', 'delivery', ['s3']),
    outcome('o-seam', 'design', ['s2', 's3']),      // lives in design, reaches into delivery
    outcome('o-unmapped', 'delivery', []),          // no maps: shows in its home only
  ];

  it('a lane pools its residents and the outcomes that touch it through a step', () => {
    expect(outcomesForLane(outcomes, design).map((o) => o.id)).toEqual(['o-design', 'o-seam']);
    expect(outcomesForLane(outcomes, delivery).map((o) => o.id)).toEqual(['o-delivery', 'o-seam', 'o-unmapped']);
  });

  it('an unmapped outcome is NOT everywhere any more — it is in its home lane', () => {
    expect(outcomesForLane(outcomes, design).map((o) => o.id)).not.toContain('o-unmapped');
    expect(outcomesForLane(outcomes, delivery).map((o) => o.id)).toContain('o-unmapped');
  });

  it('the seam outcome is a resident of one lane and a visitor in the other', () => {
    const seam = outcomes.find((o) => o.id === 'o-seam')!;
    expect(isVisitingLane(seam, 'design')).toBe(false);
    expect(isVisitingLane(seam, 'delivery')).toBe(true);
    // a row somehow without a home (pre-v3v data mid-migration) never reads as visiting
    expect(isVisitingLane({ ...seam, workflowId: null }, 'delivery')).toBe(false);
  });

  it('no lane (empty project) shows everything', () => {
    expect(outcomesForLane(outcomes, null)).toHaveLength(4);
  });
});

describe('outcomeCountByStep: the step cards’ "N outcomes" line', () => {
  it('counts every mapped outcome per step, across lanes', () => {
    const counts = outcomeCountByStep([
      outcome('a', 'design', ['s1', 's3']),
      outcome('b', 'design', ['s1']),
      outcome('c', 'delivery', []),
    ]);
    expect(counts.get('s1')).toBe(2);
    expect(counts.get('s3')).toBe(1);
    expect(counts.get('s2')).toBeUndefined();
  });
});

describe('9.5 · the write lanes, by source', () => {
  const hook = src('ui/components/ideation/useOutcomes.ts');
  const board = src('ui/components/work/WorkSurface.tsx');

  it('an outcome is born into the lane that has focus — never homeless; V3 4.1: and filed on the step it was added from', () => {
    expect(hook).toContain('createOutcome: (name: string, workflowId: string, stepId?: string, serves?: readonly VisionSentence[]) => Promise<string | null>;');
    expect(hook).toContain("if (!workflowId) return 'An outcome needs a workflow — create one first.';");
    expect(hook).toContain('        workflow_id: workflowId,');
    // AC: an outcome is filed on a stage in the Workflows space, the stage it was added from
    expect(src('ui/components/work/workflows/WorkflowsSpace.tsx')).toContain('outcomesApi.createOutcome(text.trim(), focused.id, f.stepId, serves)');
    expect(board).not.toContain('outcomesApi.createOutcome(');
    expect(hook).toContain("from('outcome_step_maps').insert({ branch_id: branchId, candidate_id: created.id as string, step_id: stepId })");
  });

  it('the row and the pool carry the home lane', () => {
    expect(hook).toContain("requirement_row_id, workflow_id, mark, evidence')");
    expect(hook).toContain('workflowId: c.workflow_id ?? null,');
    expect(src('ui/components/ideation/useTierItems.ts')).toContain('workflow_id?: string | null;');
  });

  // AL.5: the owner's lane delete now moves the lane's outcomes first and
  // then deletes; that behaviour is driven in al5-workflow-delete.test.tsx.
  it('the move re-homes outcomes and never touches a step map', () => {
    expect(hook).toContain("moveOutcomes: (fromWorkflowId: string, toWorkflowId: string) => Promise<string | null>;");
    // re-homing never touches a step map: a touch is not a home
    const move = hook.slice(hook.indexOf('const moveOutcomes'), hook.indexOf('}, [projectId, refresh]);', hook.indexOf('const moveOutcomes')));
    expect(move).toContain(".update({ workflow_id: toWorkflowId })");
    expect(move).not.toContain('outcome_step_maps');
  });

  it('V3 4.1: a step shows every outcome filed on it, home lane or not; the model reads the step maps, not the home', () => {
    const model = src('ui/components/work/steps-model.ts');
    expect(model).toContain('if (!o.stepIds.includes(step.id)) continue;');
    expect(model).not.toContain('workflowId ===');
  });
});

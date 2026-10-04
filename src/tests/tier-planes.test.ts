import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Graph } from '@nodespec/core/types.js';
import {
  assembleTierItems,
  chainOf,
  TIER_ORDER,
  type CandidateItemRow,
  type RequirementItemRow,
} from '../ui/components/ideation/useTierItems.js';
import type { WorkflowLane } from '../ui/components/ideation/useWorkflowLanes.js';

// V3 P4 (task 4.2), P5: the tier chain. Pins: the five-tier assembly links
// parents UPSTREAM (req → minting candidate, node → mapped reqs, task and
// artifact → their node); dismissed candidates never render; step-map
// bars resolve through the lane board's steps with the lane color; the
// deterministic tone rules (gap = missing link, drift = stale evidence /
// orphaned task, ok = proven or promoted); and chainOf lights the
// transitive closure BOTH ways — the design's "chain lights, the rest
// recedes" — including the promoted-outcome → requirement link.

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

const CAND = 'c1', REQ = 'r1', NODE = 'n1', TASK = 't1', ART = 'a1';

const graph: Graph = {
  id: '00000000-0000-0000-0000-000000000000',
  schemaVersion: 8, version: 0, hash: 'x',
  nodes: {
    [NODE]: { id: NODE, type: 'backend-service', label: 'API', ports: [], artifacts: [] },
    n2: { id: 'n2', type: 'database', label: 'DB', ports: [], artifacts: [] },
  },
  edges: {}, contracts: {},
  artifacts: {
    [ART]: { id: ART, nodeId: NODE, path: 'src/api.ts', kind: 'source', createdAt: 't', updatedAt: 't' },
  },
} as unknown as Graph;

const lanes: WorkflowLane[] = [{
  id: 'w1', name: 'Buyer', kind: 'workflow', color: '#4ade80', ownerLabel: null, contributors: [], sortOrder: 0,
  steps: [{ id: 's1', name: 'Browse', sortOrder: 0 }, { id: 's2', name: 'Checkout', sortOrder: 1 }],
}];

function fixture(overrides: Partial<Parameters<typeof assembleTierItems>[0]> = {}) {
  return assembleTierItems({
    candidates: [
      { id: CAND, name: 'Offline-first sync', kind: 'outcome', status: 'accepted', criteria: [{ text: 'reconciles in 5s' }], requirement_row_id: REQ },
      { id: 'c-pending', name: 'Faster search', kind: 'outcome', status: 'pending', criteria: [{ text: 'p95 < 200ms' }], requirement_row_id: null },
      { id: 'c-gone', name: 'AI board summarization', kind: 'outcome', status: 'dismissed', criteria: [], requirement_row_id: null },
    ] as CandidateItemRow[],
    requirements: [
      { id: REQ, requirement_id: 'REQ-001', name: 'Store tasks', acceptance_criteria: [{ text: 'x', met: true }] },
    ] as RequirementItemRow[],
    mappings: [{ requirement_id: REQ, node_id: NODE }],
    taskItems: [{ id: TASK, node_id: NODE, display_id: 'T1', title: 'Wire the API', done: false, orphaned: false }],
    stepMaps: [{ candidate_id: 'c-pending', step_id: 's2' }],
    graph,
    lanes,
    ...overrides,
  });
}

describe('assembleTierItems: five tiers, upstream parents', () => {
  it('links req→candidate, node→req, task→node, artifact→node; dismissed never renders', () => {
    const items = fixture();
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(REQ)!.parentIds).toEqual([CAND]);
    expect(byId.get(NODE)!.parentIds).toEqual([REQ]);
    expect(byId.get(TASK)!.parentIds).toEqual([NODE]);
    expect(byId.get(ART)!.parentIds).toEqual([NODE]);
    expect(byId.has('c-gone')).toBe(false);
    expect(byId.get(CAND)!.promotedTo).toBe(REQ);
    // Every rendered tier key is in the design's order.
    for (const item of items) expect(TIER_ORDER).toContain(item.tier);
  });

  it('step-map bars resolve through the lane steps with the lane color; unknown steps drop', () => {
    const items = fixture({ stepMaps: [
      { candidate_id: 'c-pending', step_id: 's2' },
      { candidate_id: 'c-pending', step_id: 'GONE' },
    ] });
    const pending = items.find((i) => i.id === 'c-pending')!;
    expect(pending.stepRefs).toEqual([{ stepId: 's2', name: 'Checkout', color: '#4ade80' }]);
  });
});

describe('tone rules — rows, not taste', () => {
  it('gap: criterionless candidate, unmapped requirement, requirement-less node', () => {
    const items = fixture({
      candidates: [{ id: 'c0', name: 'No outcome', description: null, category: null, kind: 'outcome', key: 'outcome:c0', status: 'pending', node_id: null, criteria: [], requirement_row_id: null }],
      mappings: [],
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get('c0')!.tone).toBe('gap');
    expect(byId.get(REQ)!.tone).toBe('gap');
    expect(byId.get(NODE)!.tone).toBe('gap');
  });

  it('drift: stale criterion evidence, orphaned task; ok: all met, done task, promoted candidate', () => {
    const items = fixture({
      requirements: [
        { id: REQ, requirement_id: 'REQ-001', name: 'Stale one', acceptance_criteria: [{ text: 'x', met: true, evidenceStale: { at: 't' } }] },
      ] as RequirementItemRow[],
      taskItems: [
        { id: TASK, node_id: NODE, display_id: 'T1', title: 'Orphan', done: false, orphaned: true },
        { id: 't-done', node_id: NODE, display_id: 'T2', title: 'Done', done: true, orphaned: false },
      ],
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(REQ)!.tone).toBe('drift');
    expect(byId.get(TASK)!.tone).toBe('drift');
    expect(byId.get('t-done')!.tone).toBe('ok');
    expect(byId.get(CAND)!.tone).toBe('ok'); // promoted

    const allMet = fixture();
    expect(allMet.find((i) => i.id === REQ)!.tone).toBe('ok');
  });
});

describe('chainOf: the transitive closure, both directions', () => {
  it('selecting the node lights its reqs, minting candidate, tasks and artifacts — the DB node stays dim', () => {
    const items = fixture();
    const chain = chainOf(items, NODE);
    expect(chain.has(NODE)).toBe(true);
    expect(chain.has(REQ)).toBe(true);
    expect(chain.has(CAND)).toBe(true);
    expect(chain.has(TASK)).toBe(true);
    expect(chain.has(ART)).toBe(true);
    expect(chain.has('n2')).toBe(false);
    expect(chain.has('c-pending')).toBe(false);
  });

  it('selecting the promoted outcome lights downstream through the requirement it minted', () => {
    const items = fixture();
    const chain = chainOf(items, CAND);
    expect(chain.has(REQ)).toBe(true);
    expect(chain.has(NODE)).toBe(true);
    expect(chain.has(TASK)).toBe(true);
  });

  it('no selection or an unknown id lights nothing', () => {
    const items = fixture();
    expect(chainOf(items, null).size).toBe(0);
    expect(chainOf(items, 'nope').size).toBe(0);
  });
});

describe('wiring pins', () => {
  it('P5: the Trace grid is the chain\u2019s surface — the interim planes retired with it', () => {
    expect(existsSync(resolve(__dirname, '..', 'ui/components/ideation/TraceInterim.tsx'))).toBe(false);
    expect(existsSync(resolve(__dirname, '..', 'ui/components/ideation/TierPlanes.tsx'))).toBe(false);
    // V3 4.1: the grid retired too; the chain is assembled for Work's rail
    expect(existsSync(resolve(__dirname, '..', 'ui/components/ideation/TraceGrid.tsx'))).toBe(false);
    expect(src('ui/components/ideation/useTraceData.ts')).toContain('const items = assembleTierItems({');
    expect(src('ui/components/work/WorkSurface.tsx')).toContain('useTraceData(projectId, graph ?? null, lanesApi.lanes, presence.holds)');
  });

  it('the hook batches one select per table and never renders dismissed candidates', () => {
    const hook = src('ui/components/ideation/useTierItems.ts');
    expect(hook).toContain(".neq('status', 'dismissed')");
    expect(hook).toContain(".in('candidate_id', candidates.map((c) => c.id))");
  });

});

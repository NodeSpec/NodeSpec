// @vitest-environment jsdom
// V3 AE.7 (owner 2026-09-25): a teammate's Workflows edit is a proposal
// the owner decides under Proposals, unless the project's Outcomes &
// workflow setting is Auto-apply; the owner writes directly. In propose
// mode both hooks compile the edit to the spec ops an agent files and call
// propose_patches on the server's session door, named by the person's
// email; nothing is written and the surface toasts the notice. A stage
// that holds outcomes goes on the second press and leaves them for the
// person to place again.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

type Row = Record<string, unknown>;
const fake = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: string; payload?: unknown }>,
  calls: [] as Array<[string, Record<string, unknown>]>,
  refuse: null as string | null,
}));
vi.mock('../persistence/supabase/client.js', () => {
  const builder = (table: string) => {
    let op = 'select';
    let payload: unknown;
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'match']) b[m] = chain;
    b.insert = (p: unknown) => { op = 'insert'; payload = p; fake.writes.push({ table, op, payload }); return b; };
    b.update = (p: unknown) => { op = 'update'; payload = p; fake.writes.push({ table, op, payload }); return b; };
    b.delete = () => { op = 'delete'; fake.writes.push({ table, op }); return b; };
    b.single = async () => ({ data: (fake.rows[table] ?? [])[0] ?? null, error: null });
    b.maybeSingle = async () => ({ data: (fake.rows[table] ?? [])[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(op === 'select' ? { data: fake.rows[table] ?? [], error: null } : { data: null, error: null, count: 0 }).then(res, rej);
    return b;
  };
  return {
    getSupabaseClient: () => ({ from: builder, auth: { getUser: async () => ({ data: { user: { id: 'u-alice', email: 'alice@acme.test' } } }) } }),
    callEdgeFunction: async (fn: string, body: Record<string, unknown>) => {
      fake.calls.push([fn, body]);
      if (fake.refuse) return { success: false, error: fake.refuse };
      return { success: true, data: { proposalId: `p-${fake.calls.length}` } };
    },
  };
});
const { useWorkflowLanes } = await import('../ui/components/ideation/useWorkflowLanes.js');
const { useOutcomes } = await import('../ui/components/ideation/useOutcomes.js');
const { laneUpsert, laneDelete, stepUpsert, stepDelete, stepMaps, proposalNotice } = await import('../ui/components/ideation/workflow-proposals.js');

const W1 = '10000000-0000-4000-8000-000000000001';
const S1 = '20000000-0000-4000-8000-000000000001';
const S2 = '20000000-0000-4000-8000-000000000002';
const O1 = '30000000-0000-4000-8000-000000000001';

beforeEach(() => {
  fake.rows = {
    workflows: [{ id: W1, name: 'Checkout', kind: 'workflow', color: null, owner_label: null, contributors: null, sort_order: 0 }],
    workflow_steps: [{ id: S1, workflow_id: W1, name: 'Browse', sort_order: 0 }, { id: S2, workflow_id: W1, name: 'Pay', sort_order: 1 }],
    requirement_candidates: [{ id: O1, name: 'Pay in one tap', status: 'pending', kind: 'outcome', workflow_id: W1, criteria: [] }],
    outcome_step_maps: [{ id: 'm1', candidate_id: O1, step_id: S1 }],
  };
  fake.writes = [];
  fake.calls = [];
  fake.refuse = null;
});

const lastCall = () => {
  const [fn, body] = fake.calls[fake.calls.length - 1];
  return { fn, tool: body.tool, args: body.arguments as { project_id: string; patches: unknown[]; explanations: string[]; external_agent?: string } };
};

describe('AE.7 builders: the edit as the spec ops an agent files', () => {
  it('compiles lanes, stages and step maps, dropping what was not given', () => {
    expect(laneUpsert({ name: 'Checkout', sortOrder: 2 })).toEqual({ type: 'upsert_workflow', payload: { name: 'Checkout', sortOrder: 2 } });
    expect(laneUpsert({ id: W1, name: 'Checkout', color: null, contributors: ['a'] })).toEqual({ type: 'upsert_workflow', payload: { id: W1, name: 'Checkout', contributors: ['a'] } });
    expect(laneDelete(W1)).toEqual({ type: 'delete_workflow', payload: { id: W1 } });
    expect(stepUpsert({ workflowId: W1, name: 'Ship' })).toEqual({ type: 'upsert_workflow_step', payload: { workflowId: W1, name: 'Ship' } });
    expect(stepDelete(S1)).toEqual({ type: 'delete_workflow_step', payload: { id: S1 } });
    expect(stepMaps({ candidateId: O1, branchId: 'b1', stepIds: [S1] })).toEqual({ type: 'set_outcome_step_maps', payload: { candidateId: O1, branchId: 'b1', stepIds: [S1] } });
    expect(proposalNotice('add the stage "Ship" to Checkout')).toBe('Filed as a proposal: add the stage "Ship" to Checkout. The owner decides it under Proposals.');
  });
});

describe('AE.7 useWorkflowLanes in propose mode', () => {
  it('files one proposal per edit through propose_patches, in the person\'s name, and writes nothing', async () => {
    const { result } = renderHook(() => useWorkflowLanes('p1', { propose: true, email: 'alice@acme.test' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.proposing).toBe(true);
    expect(result.current.lanes.map((l) => l.name)).toEqual(['Checkout']);

    let made: unknown;
    await act(async () => { made = await result.current.createLane('Returns'); });
    expect(made).toEqual({ id: 'p-1', proposed: true });
    // AL.2: a person's edit is filed as a person's (actorType human), and the card reads as a sentence
    expect(lastCall()).toEqual({ fn: 'mcp-server', tool: 'propose_patches', args: { project_id: 'p1', patches: [{ type: 'upsert_workflow', payload: { name: 'Returns', sortOrder: 1 }, metadata: { actorType: 'human' } }], explanations: ['Add the workflow "Returns"'], external_agent: 'alice@acme.test' } });
    expect(result.current.notice?.text).toBe('Filed as a proposal: add the workflow "Returns". The owner decides it under Proposals.');

    let err: string | null = 'x';
    await act(async () => { err = await result.current.addStep(W1, ' Ship '); });
    expect(err).toBeNull();
    expect(lastCall().args.patches).toEqual([{ type: 'upsert_workflow_step', payload: { workflowId: W1, name: 'Ship', sortOrder: 2 }, metadata: { actorType: 'human' } }]);
    await act(async () => { err = await result.current.renameStep(S2, 'Pay now'); });
    expect(lastCall().args.patches).toEqual([{ type: 'upsert_workflow_step', payload: { id: S2, workflowId: W1, name: 'Pay now' }, metadata: { actorType: 'human' } }]);
    expect(lastCall().args.explanations).toEqual(['Rename the stage "Pay" to "Pay now"']);
    await act(async () => { err = await result.current.deleteStep(S1); });
    expect(lastCall().args.patches).toEqual([{ type: 'delete_workflow_step', payload: { id: S1 }, metadata: { actorType: 'human' } }]);
    await act(async () => { err = await result.current.moveStep(W1, S2, 'up'); });
    expect(lastCall().args.patches).toEqual([
      { type: 'upsert_workflow_step', payload: { id: S2, workflowId: W1, name: 'Pay', sortOrder: 0 }, metadata: { actorType: 'human' } },
      { type: 'upsert_workflow_step', payload: { id: S1, workflowId: W1, name: 'Browse', sortOrder: 1 }, metadata: { actorType: 'human' } },
    ]);
    await act(async () => { err = await result.current.updateLane(W1, { name: 'Checkout v2' }); });
    expect(lastCall().args.patches).toEqual([{ type: 'upsert_workflow', payload: { id: W1, name: 'Checkout v2' }, metadata: { actorType: 'human' } }]);
    expect(lastCall().args.explanations).toEqual(['Rename the workflow "Checkout" to "Checkout v2"']);
    await act(async () => { err = await result.current.deleteLane(W1); });
    expect(lastCall().args.patches).toEqual([{ type: 'delete_workflow', payload: { id: W1 }, metadata: { actorType: 'human' } }]);
    expect(err).toBeNull();
    expect(fake.writes).toEqual([]);
    expect(fake.calls.length).toBe(7);
  });

  it('a refusal by the server comes back as the error, and nothing is written', async () => {
    fake.refuse = 'Shaping a workflow (upsert_workflow_step) is Indie and above.';
    const { result } = renderHook(() => useWorkflowLanes('p1', { propose: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let err: string | null = null;
    await act(async () => { err = await result.current.addStep(W1, 'Ship'); });
    expect(err).toBe('Shaping a workflow (upsert_workflow_step) is Indie and above.');
    expect(result.current.notice).toBeNull();
    expect(fake.writes).toEqual([]);
  });

  it('the owner writes directly, as before, and the door is never called', async () => {
    const { result } = renderHook(() => useWorkflowLanes('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.proposing).toBe(false);
    await act(async () => { await result.current.addStep(W1, 'Ship'); });
    expect(fake.writes).toEqual([{ table: 'workflow_steps', op: 'insert', payload: { workflow_id: W1, name: 'Ship', sort_order: 2 } }]);
    expect(fake.calls).toEqual([]);
  });
});

describe('AE.7 useOutcomes in propose mode', () => {
  it('a step map toggle files set_outcome_step_maps with the whole step set after the toggle', async () => {
    const { result } = renderHook(() => useOutcomes('p1', 'b1', true, { propose: true, email: 'alice@acme.test' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let err: string | null = 'x';
    await act(async () => { err = await result.current.toggleStepMap(O1, S2); });
    expect(err).toBeNull();
    expect(lastCall().args.patches).toEqual([{ type: 'set_outcome_step_maps', payload: { candidateId: O1, branchId: 'b1', stepIds: [S1, S2] }, metadata: { actorType: 'human' } }]);
    expect(lastCall().args.external_agent).toBe('alice@acme.test');
    await act(async () => { err = await result.current.toggleStepMap(O1, S1); });
    expect(lastCall().args.patches).toEqual([{ type: 'set_outcome_step_maps', payload: { candidateId: O1, branchId: 'b1', stepIds: [] }, metadata: { actorType: 'human' } }]);
    expect(result.current.notice?.text).toContain('Filed as a proposal: place the outcome "Pay in one tap"');
    expect(fake.writes).toEqual([]);
  });
});

// The surface's decision (owner, Propose, Auto-apply, still reading) is
// driven through the real WorkSurface in work-requirements.test.tsx; the
// space's toast and the second press through the real WorkflowsSpace in
// workflows-space.test.tsx; the live door by bench v3-app-writes.

// @vitest-environment jsdom
// AL.5 (owner 2026-10-01): "I can't delete a starting workflow after I
// create it within our app." The Workflows space could add a workflow and
// had no way to remove one. The database refuses the delete while an
// outcome calls the workflow home (RESTRICT, 9.5), so the owner's delete
// moves those outcomes first: each to the first other workflow it is placed
// on, else to the first other workflow. With no other workflow there is
// nowhere to move them and the refusal says so. A teammate's delete is a
// proposal, and one the database would refuse at accept is refused now.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

type Row = Record<string, unknown>;
type Write = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]> };
const fake = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  writes: [] as Write[],
  calls: [] as Array<[string, Record<string, unknown>]>,
  fail: null as null | { table: string; op: string; message: string },
}));
vi.mock('../persistence/supabase/client.js', () => {
  const builder = (table: string) => {
    let op = 'select';
    let payload: unknown;
    let count = false;
    const filters: Array<[string, string, unknown]> = [];
    const b: Record<string, unknown> = {};
    b.select = (_cols?: string, opts?: { count?: string }) => { if (opts?.count) count = true; return b; };
    b.eq = (col: string, v: unknown) => { filters.push(['eq', col, v]); return b; };
    b.in = (col: string, v: unknown) => { filters.push(['in', col, v]); return b; };
    for (const m of ['neq', 'is', 'order', 'limit', 'match']) b[m] = () => b;
    b.insert = (p: unknown) => { op = 'insert'; payload = p; return b; };
    b.update = (p: unknown) => { op = 'update'; payload = p; return b; };
    b.delete = () => { op = 'delete'; return b; };
    const matches = (r: Row) => filters.every(([k, col, v]) => (k === 'eq' ? r[col] === v : (v as unknown[]).includes(r[col])));
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (fake.fail && fake.fail.table === table && fake.fail.op === op) return Promise.resolve({ data: null, error: { message: fake.fail.message } }).then(res, rej);
      if (op !== 'select') fake.writes.push({ table, op, payload, filters: [...filters] });
      const hit = (fake.rows[table] ?? []).filter(matches);
      return Promise.resolve(op === 'select' ? { data: count ? null : hit, count: count ? hit.length : null, error: null } : { data: null, error: null }).then(res, rej);
    };
    return b;
  };
  return {
    getSupabaseClient: () => ({ from: builder, auth: { getUser: async () => ({ data: { user: { id: 'u-owner', email: 'owner@acme.test' } } }) } }),
    callEdgeFunction: async (fn: string, body: Record<string, unknown>) => {
      fake.calls.push([fn, body]);
      return { success: true, data: { proposalId: `p-${fake.calls.length}` } };
    },
  };
});
const { useWorkflowLanes, rehomePlan } = await import('../ui/components/ideation/useWorkflowLanes.js');
const { workflowRemoval } = await import('../ui/components/work/workflows/space-model.js');

const CHECKOUT = '10000000-0000-4000-8000-000000000001';
const RETURNS = '10000000-0000-4000-8000-000000000002';
const ONBOARD = '10000000-0000-4000-8000-000000000003';
const lane = (id: string, name: string, sortOrder: number, steps: string[]) => ({
  id, name, kind: 'workflow' as const, color: null, ownerLabel: null, contributors: [], sortOrder,
  steps: steps.map((s, i) => ({ id: s, name: s, sortOrder: i })),
});
const LANES = [lane(CHECKOUT, 'Checkout', 0, ['browse', 'pay']), lane(RETURNS, 'Returns', 1, ['request', 'refund']), lane(ONBOARD, 'Onboarding', 2, ['signup'])];

describe('AL.5 · where a removed workflow\'s outcomes go (pure)', () => {
  it('to the first other workflow each is placed on, else to the first other workflow; nothing to move is no move', () => {
    const plan = rehomePlan(CHECKOUT, LANES, [
      { id: 'o-pay', stepIds: ['pay'] },
      { id: 'o-both', stepIds: ['pay', 'signup'] },
      { id: 'o-refund', stepIds: ['refund', 'signup'] },
      { id: 'o-none', stepIds: [] },
    ]);
    // o-pay sits only on Checkout's own stage, o-none on none: both to Returns, the first other
    expect('moves' in plan && Object.fromEntries(plan.moves)).toEqual({ [RETURNS]: ['o-pay', 'o-refund', 'o-none'], [ONBOARD]: ['o-both'] });
    expect(rehomePlan(CHECKOUT, LANES, [])).toEqual({ moves: new Map() });
  });

  it('the only workflow with outcomes in it has nowhere to send them, and says so; an empty one goes', () => {
    const only = [LANES[0]];
    expect(rehomePlan(CHECKOUT, only, [{ id: 'o1', stepIds: [] }])).toEqual({ refusal: '"Checkout" is your only workflow and an outcome lives in it. Add another workflow first, so it has somewhere to go.' });
    expect(rehomePlan(CHECKOUT, only, [{ id: 'o1', stepIds: [] }, { id: 'o2', stepIds: [] }])).toEqual({ refusal: '"Checkout" is your only workflow and 2 outcomes live in it. Add another workflow first, so they have somewhere to go.' });
    expect(rehomePlan(CHECKOUT, only, [])).toEqual({ moves: new Map() });
  });

  it('the word before the second press: what goes with it and where its outcomes move', () => {
    const o = (id: string, workflowId: string, stepIds: string[]) => ({ id, workflowId, stepIds });
    expect(workflowRemoval(LANES[0], LANES, [o('a', CHECKOUT, ['pay']), o('b', CHECKOUT, ['signup']), o('c', RETURNS, ['refund'])])).toEqual({
      note: 'This removes "Checkout" and its 2 stages. Its 2 outcomes move to "Returns" and "Onboarding", to be placed again. Press Remove again to go ahead.',
    });
    expect(workflowRemoval(LANES[2], LANES, [o('a', ONBOARD, [])])).toEqual({
      note: 'This removes "Onboarding" and its stage. Its outcome moves to "Checkout", to be placed again. Press Remove again to go ahead.',
    });
    expect(workflowRemoval(lane(ONBOARD, 'Onboarding', 2, []), LANES, [])).toEqual({ note: 'This removes "Onboarding". Press Remove again to go ahead.' });
    expect(workflowRemoval(LANES[0], [LANES[0]], [o('a', CHECKOUT, [])])).toEqual({
      refusal: '"Checkout" is your only workflow and an outcome lives in it. Add another workflow first, so it has somewhere to go.',
    });
  });
});

beforeEach(() => {
  fake.rows = {
    workflows: [
      { id: CHECKOUT, project_id: 'p1', name: 'Checkout', kind: 'workflow', color: null, owner_label: null, contributors: null, sort_order: 0 },
      { id: RETURNS, project_id: 'p1', name: 'Returns', kind: 'workflow', color: null, owner_label: null, contributors: null, sort_order: 1 },
    ],
    workflow_steps: [
      { id: 'browse', workflow_id: CHECKOUT, name: 'Browse', sort_order: 0 },
      { id: 'pay', workflow_id: CHECKOUT, name: 'Pay', sort_order: 1 },
      { id: 'refund', workflow_id: RETURNS, name: 'Refund', sort_order: 0 },
    ],
    requirement_candidates: [
      { id: 'o-pay', workflow_id: CHECKOUT },
      { id: 'o-refund', workflow_id: CHECKOUT },
      { id: 'o-stays', workflow_id: RETURNS },
    ],
    outcome_step_maps: [
      { candidate_id: 'o-pay', step_id: 'pay' },
      { candidate_id: 'o-refund', step_id: 'refund' },
    ],
  };
  fake.writes = [];
  fake.calls = [];
  fake.fail = null;
});

describe('AL.5 · the owner\'s delete', () => {
  it('moves the workflow\'s outcomes to Returns, then removes the workflow, then re-reads', async () => {
    const { result } = renderHook(() => useWorkflowLanes('p1'));
    await waitFor(() => expect(result.current.lanes.map((l) => l.name)).toEqual(['Checkout', 'Returns']));
    let err: string | null = 'unset';
    await act(async () => { err = await result.current.deleteLane(CHECKOUT); });
    expect(err).toBeNull();
    expect(fake.writes).toEqual([
      { table: 'requirement_candidates', op: 'update', payload: { workflow_id: RETURNS }, filters: [['in', 'id', ['o-pay', 'o-refund']]] },
      { table: 'workflows', op: 'delete', payload: undefined, filters: [['eq', 'id', CHECKOUT]] },
    ]);
    expect(fake.calls).toEqual([]);
  });

  it('outcomes placed on two other workflows each go to theirs, before the delete', async () => {
    fake.rows.workflows.push({ id: ONBOARD, project_id: 'p1', name: 'Onboarding', kind: 'workflow', color: null, owner_label: null, contributors: null, sort_order: 2 });
    fake.rows.workflow_steps.push({ id: 'signup', workflow_id: ONBOARD, name: 'Sign up', sort_order: 0 });
    fake.rows.requirement_candidates.push({ id: 'o-signup', workflow_id: CHECKOUT });
    fake.rows.outcome_step_maps.push({ candidate_id: 'o-signup', step_id: 'signup' });
    const { result } = renderHook(() => useWorkflowLanes('p1'));
    await waitFor(() => expect(result.current.lanes.length).toBe(3));
    await act(async () => { await result.current.deleteLane(CHECKOUT); });
    expect(fake.writes.map((w) => [w.table, w.op, w.payload, w.filters])).toEqual([
      ['requirement_candidates', 'update', { workflow_id: RETURNS }, [['in', 'id', ['o-pay', 'o-refund']]]],
      ['requirement_candidates', 'update', { workflow_id: ONBOARD }, [['in', 'id', ['o-signup']]]],
      ['workflows', 'delete', undefined, [['eq', 'id', CHECKOUT]]],
    ]);
  });

  it('an empty workflow is removed with no move', async () => {
    fake.rows.requirement_candidates = [];
    const { result } = renderHook(() => useWorkflowLanes('p1'));
    await waitFor(() => expect(result.current.lanes.length).toBe(2));
    await act(async () => { await result.current.deleteLane(RETURNS); });
    expect(fake.writes).toEqual([{ table: 'workflows', op: 'delete', payload: undefined, filters: [['eq', 'id', RETURNS]] }]);
  });

  it('the only workflow with outcomes in it: refused in words, nothing written', async () => {
    fake.rows.workflows = fake.rows.workflows.slice(0, 1);
    const { result } = renderHook(() => useWorkflowLanes('p1'));
    await waitFor(() => expect(result.current.lanes.length).toBe(1));
    let err: string | null = null;
    await act(async () => { err = await result.current.deleteLane(CHECKOUT); });
    expect(err).toBe('"Checkout" is your only workflow and 2 outcomes live in it. Add another workflow first, so they have somewhere to go.');
    expect(fake.writes).toEqual([]);
  });

  it('a move the database refuses stops before the delete, and its words come back', async () => {
    fake.fail = { table: 'requirement_candidates', op: 'update', message: 'Workflows are available on Indie and above: an outcome can not be moved to another workflow on this plan.' };
    const { result } = renderHook(() => useWorkflowLanes('p1'));
    await waitFor(() => expect(result.current.lanes.length).toBe(2));
    let err: string | null = null;
    await act(async () => { err = await result.current.deleteLane(CHECKOUT); });
    expect(err).toBe('Workflows are available on Indie and above: an outcome can not be moved to another workflow on this plan.');
    expect(fake.writes.filter((w) => w.table === 'workflows')).toEqual([]);
  });
});

describe('AL.5 · a teammate\'s delete is a proposal', () => {
  it('an empty workflow files delete_workflow; one that homes outcomes is refused before filing', async () => {
    const { result } = renderHook(() => useWorkflowLanes('p1', { propose: true, email: 'mate@acme.test' }));
    await waitFor(() => expect(result.current.lanes.length).toBe(2));
    let err: string | null = null;
    await act(async () => { err = await result.current.deleteLane(CHECKOUT); });
    expect(err).toBe('This workflow is home to 2 outcomes. The owner can remove it, moving them to another workflow.');
    expect(fake.calls).toEqual([]);
    fake.rows.requirement_candidates = [];
    await act(async () => { err = await result.current.deleteLane(RETURNS); });
    expect(err).toBeNull();
    expect((fake.calls[0][1].arguments as { patches: unknown[] }).patches).toEqual([{ type: 'delete_workflow', payload: { id: RETURNS }, metadata: { actorType: 'human' } }]);
    expect(fake.writes).toEqual([]);
  });
});

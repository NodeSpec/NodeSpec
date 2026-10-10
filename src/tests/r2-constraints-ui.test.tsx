// @vitest-environment jsdom
//
// R.2b and R.2c (owner 2026-09-24): "okay as long as the rules are quality
// and contextual to the user's project." In the app a person files guidance
// or a check with scopes and parameters taken from their own graph, sees what
// a check does, how it has been used and where it is waived, and lifts a
// waiver; rejecting an agent's proposal asks why, so the agent learns.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { spaceFixture, type SpaceFixture } from './helpers/space-fixture.js';
import { renderCanvas } from './helpers/reactflow-dom.js';
import { ApprovalsWaiting } from '../ui/components/ideation/ApprovalsQueue.js';
import { describeEntry, targetOf, type QueueItem, type QueueLabels } from '../ui/components/ideation/useApprovalsQueue.js';
import { layerCountLine, scopeOf } from '../ui/components/work/workflows/space-model.js';

const scene = vi.hoisted(() => ({ pick: null as null | ((p: unknown) => void) }));
vi.mock('../ui/components/work/workflows/space-scene.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createSpaceScene: (_host: unknown, onPick: (p: unknown) => void) => {
    scene.pick = onPick;
    return { setModel: () => {}, setFocus: () => {}, settle: () => {}, home: () => {}, recenter: () => {}, dispose: () => {} };
  },
}));
const { default: WorkflowsSpace } = await import('../ui/components/work/workflows/WorkflowsSpace.js');

let f: SpaceFixture;
const ok = () => vi.fn(async () => null as string | null);
const mount = (rows: unknown[], api: Record<string, unknown> = {}) => {
  const constraintsApi = { groups: [], total: rows.length, loading: false, error: null, refresh: vi.fn(async () => {}), add: ok(), remove: ok(), liftWaiver: ok(), setMark: ok(), rows, ...api };
  const lanesApi = { lanes: f.lanes, importedLaneId: null, loading: false, error: null, refresh: vi.fn(async () => {}), createLane: vi.fn(), updateLane: ok(), deleteLane: ok(), moveLane: ok(), addStep: ok(), renameStep: ok(), deleteStep: ok(), moveStep: ok(), reorderSteps: ok() };
  const outcomesApi = { outcomes: f.outcomes, loading: false, error: null, refresh: vi.fn(async () => {}), createOutcome: ok(), fileRequirement: ok(), moveOutcomes: ok(), toggleStepMap: ok(), setCriteria: ok(), updateOutcome: ok(), setServes: ok() };
  const view = render(
    <WorkflowsSpace projectId="p1" graph={f.graph} lanesApi={lanesApi as never} outcomesApi={outcomesApi as never} constraintsApi={constraintsApi as never}
      requirements={f.band} chains={f.chains} candidateActions={{ promote: ok(), settle: ok(), dismiss: ok() } as never} onDeleteRequirement={ok()}
      team={false} onOpenRequirement={vi.fn()} onOpenArchitecture={vi.fn()} />,
  );
  return { ...view, constraintsApi };
};
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); }); };
const pick = async (p: unknown) => { await act(async () => { scene.pick!(p); }); };

beforeEach(() => { f = spaceFixture(); scene.pick = null; });

describe('R.2b · a person files a check with their own graph\'s words', () => {
  it('the form offers only this project\'s technologies; a check is filed with its predicate, parameters and severity, and is not filed half-made', async () => {
    const { getByTestId, getAllByTestId, constraintsApi } = mount(f.constraints);
    await click(getByTestId('space-lens-layer'));
    await click(getAllByTestId('space-layer')[0]);
    await click(getByTestId('space-new-constraint'));
    fireEvent.change(getByTestId('space-con-title'), { target: { value: 'Python services only' } });
    fireEvent.change(getByTestId('space-con-kind'), { target: { value: 'check' } });
    fireEvent.change(getByTestId('space-con-predicate'), { target: { value: 'technology_in_list' } });
    const techs = getByTestId('space-con-techs') as HTMLSelectElement;
    const offered = Array.from(techs.options).map((o) => o.value);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).toEqual([...new Set(Object.values(f.graph.nodes as Record<string, { technology?: string }>).map((n) => n.technology).filter(Boolean) as string[])].sort());
    expect((getByTestId('space-form-save') as HTMLButtonElement).disabled).toBe(true);
    techs.options[0].selected = true;
    fireEvent.change(techs);
    fireEvent.change(getByTestId('space-con-severity'), { target: { value: 'refuse' } });
    expect(getByTestId('space-form-save').textContent).toBe('File the check');
    await click(getByTestId('space-form-save'));
    expect(constraintsApi.add).toHaveBeenCalledWith('technology', 'Python services only', null, {
      title: 'Python services only', rationale: '',
      check: { predicate: 'technology_in_list', severity: 'refuse', params: { technologies: [offered[0]] } },
    });
  });

  it('a scope narrower than the project is "for part of the system", in words', async () => {
    const tech = String(Object.values(f.graph.nodes as Record<string, { technology?: string }>)[0].technology);
    const rows = [...f.constraints, { id: 'k4', ctype: 'technology', title: 'Pinned versions', description: 'Pinned versions', rationale: null, author: null, workflow_id: null, scope_kind: 'technology', scope_value: tech }];
    expect(layerCountLine(rows)).toBe('2 global · 1 for a workflow · 1 for part of the system');
    expect(scopeOf(rows[3], f.lanes).word).toBe(`every node built with ${tech.replace(/[-_]+/g, ' ')}`);
    const { getByTestId, getAllByTestId } = mount(rows);
    await click(getByTestId('space-lens-layer'));
    await click(getAllByTestId('space-layer')[0]);
    expect(getByTestId('space-inspector').textContent).toContain('For part of the system');
  });
});

describe('R.2b and R.2c · what a check does, how it has been used, where it is waived', () => {
  it('the inspector says what it checks and what happens to a change that breaks it, its use, its origin, the waivers with a Lift, and the evidence of use', async () => {
    const node = Object.keys(f.graph.nodes)[0];
    const label = (f.graph.nodes as Record<string, { label: string }>)[node].label;
    const check = {
      id: 'k9', ctype: 'architecture', title: 'Services talk through the queue', description: 'No direct calls', rationale: null, author: null, workflow_id: null,
      kind: 'check', scope_kind: 'project', scope_value: null,
      check_spec: { predicate: 'no_calls_between_roles', severity: 'refuse', params: { from: 'backend-service', to: 'backend-service' } },
      waivers: [{ id: 'w1', target: node, reason: 'Legacy path, retired in Q1', owner: 'person-1', at: '2026-09-01T00:00:00Z' }],
      stats: { fired: 12, violated: 3, waived: 4, lastFiredAt: '2026-09-20T00:00:00Z' },
      origin: { source: 'review', proposalId: '44444444-4444-4444-8444-444444444444' },
      created_at: '2026-08-01T00:00:00Z',
    };
    const { getByTestId, getAllByTestId, constraintsApi } = mount([...f.constraints, check]);
    await click(getByTestId('space-lens-layer'));
    await pick({ kind: 'constraint', id: 'k9' });
    expect(getByTestId('space-constraint-kind').textContent).toBe('Check, refuses');
    expect(getByTestId('space-constraint-check').textContent).toBe('No backend service connects to a backend service directly. A proposal that breaks it is refused.');
    expect(getByTestId('space-constraint-use').textContent).toBe('Held against 12 proposals, broken by 3, waived 4 times, last on 20 Sep.');
    expect(getByTestId('space-constraint-origin').textContent).toBe("From a reviewer's reason for rejecting a proposal.");
    expect(getAllByTestId('space-constraint-signal').map((e) => e.textContent)).toEqual(['Waived 4 times. It may no longer hold as written.']);
    expect(getByTestId('space-constraint-waiver').textContent).toContain(`${label}: Legacy path, retired in Q1`);
    await click(getByTestId('space-lift-waiver'));
    expect(constraintsApi.liftWaiver).toHaveBeenCalledWith('k9', 'w1');
  });
});

describe('R.2c · rejecting an agent\'s proposal asks why', () => {
  const item = (over: Partial<QueueItem> = {}): QueueItem => ({
    proposalId: 'p1', kind: 'requirement', status: 'pending', pending: true, decidedLabel: null, target: 'REQ-001',
    origin: { kind: 'agent', label: 'claude' }, text: 'Tighten the wording', patchCount: 1, createdAt: '2026-09-16T10:00:00Z', reviewInCanvas: false, ...over,
  });
  const api = (items: QueueItem[]) => ({ items, pending: items.length, loading: false, error: null, busyId: null, nextRequirementRef: 'REQ-005', refresh: vi.fn(), resolve: vi.fn(async () => ({ ok: true })) });

  it('Reject opens one line for the reason; the reject carries it; Cancel leaves the card as it was', async () => {
    const q = api([item()]);
    const { container } = renderCanvas(<ApprovalsWaiting queue={q as never} />);
    const get = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    await act(async () => { fireEvent.click(get('approval-reject')!); });
    expect(q.resolve).not.toHaveBeenCalled();
    fireEvent.change(get('approval-reject-why')!, { target: { value: 'We never call the payments provider from the browser.' } });
    await act(async () => { fireEvent.click(get('approval-reject-confirm')!); });
    expect(q.resolve).toHaveBeenLastCalledWith('p1', 'reject', { note: 'We never call the payments provider from the browser.' });

    const q2 = api([item()]);
    const second = renderCanvas(<ApprovalsWaiting queue={q2 as never} />);
    const g2 = (id: string) => second.container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    await act(async () => { fireEvent.click(g2('approval-reject')!); });
    await act(async () => { fireEvent.click(g2('approval-reject-cancel')!); });
    expect(g2('approval-reject-why')).toBeNull();
    expect(g2('approval-reject')!.textContent).toBe('Reject');
    await act(async () => { fireEvent.click(g2('approval-reject')!); });
    await act(async () => { fireEvent.click(g2('approval-reject-confirm')!); });
    expect(q2.resolve).toHaveBeenLastCalledWith('p1', 'reject', undefined);
  });

  it('a candidate from the import still rejects in one click', async () => {
    const q = api([item({ source: 'candidate', kind: 'imported', acts: ['accept', 'reject'] })]);
    const { container } = renderCanvas(<ApprovalsWaiting queue={q as never} />);
    await act(async () => { fireEvent.click(container.querySelector('[data-testid="approval-reject"]')!); });
    expect(q.resolve).toHaveBeenCalledTimes(1);
  });
});

describe('R.2b · the proposal card says what a constraint op does', () => {
  const labels: QueueLabels = { candidates: new Map(), requirements: new Map(), workflows: new Map(), steps: new Map(), constraints: new Map([['c1', 'Services talk through the queue']]) };
  const e = (type: string, payload: Record<string, unknown>) => ({ patch: { type, payload } });

  it('a check, a waiver, a lifted waiver, a changed check and a retirement, each in plain words', () => {
    expect(targetOf(e('create_constraint', { kind: 'check', title: 'Queue only' }), labels)).toBe('New check: Queue only');
    expect(describeEntry(e('create_constraint', { ctype: 'architecture', kind: 'check', check: { predicate: 'no_calls_between_roles', severity: 'refuse', params: { from: 'frontend', to: 'database' } }, scope: { kind: 'role', value: 'frontend' } })))
      .toBe('Add a check that refuses a change breaking it: No frontend connects to a database directly. (on every frontend node)');
    expect(targetOf(e('update_constraint', { constraintId: 'c1' }), labels)).toBe('Services talk through the queue');
    expect(describeEntry(e('update_constraint', { constraintId: 'c1', addWaiver: { target: 'e3-edge-000', reason: 'A spike, retired Friday', expiresAt: '2026-10-01T00:00:00Z' } })))
      .toBe('Waive it for e3-edge-: A spike, retired Friday (until 2026-10-01)');
    expect(describeEntry(e('update_constraint', { constraintId: 'c1', removeWaiver: 'w1' }))).toBe('Lift a waiver');
    expect(describeEntry(e('update_constraint', { constraintId: 'c1', changes: { check: { predicate: 'sync_calls_at_most', severity: 'warn', params: { max: 2 } } } })))
      .toBe('Change the check to: At most 2 synchronous calls out of each node.');
    expect(describeEntry(e('delete_constraint', { constraintId: 'c1', reason: 'Not used since June' }))).toBe('Retire it: Not used since June');
  });
});

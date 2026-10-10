// @vitest-environment jsdom
//
// W (owner 2026-09-23): the Workflows tab, rendered for real against the
// mockup's Incident response workflow, with the 3D scene swapped for a
// recorder (jsdom has no WebGL): the test reads the models the scene was
// handed and picks things the way a click on a card would. Every write is a
// spy on the hook Work already holds, so each act asserts the write it asks
// for, and the refusals land in the space's toast.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, within } from '@testing-library/react';
import { spaceFixture, type SpaceFixture } from './helpers/space-fixture.js';

const scene = vi.hoisted(() => ({
  models: [] as Array<Record<string, any>>, focus: [] as unknown[], settles: [] as unknown[], homes: 0, recenters: 0,
  pick: null as null | ((p: unknown) => void),
}));
vi.mock('../ui/components/work/workflows/space-scene.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createSpaceScene: (_host: unknown, onPick: (p: unknown) => void) => {
    scene.pick = onPick;
    return {
      setModel: (m: Record<string, any>) => { scene.models.push(m); },
      setFocus: (f: unknown) => { scene.focus.push(f); },
      settle: (d: unknown) => { scene.settles.push(d); },
      home: () => { scene.homes += 1; },
      recenter: () => { scene.recenters += 1; },
      dispose: () => {},
    };
  },
}));

const { default: WorkflowsSpace } = await import('../ui/components/work/workflows/WorkflowsSpace.js');
const { proposalNotice } = await import('../ui/components/ideation/workflow-proposals.js');

let f: SpaceFixture;
const ok = () => vi.fn(async () => null as string | null);
const apis = () => ({
  lanesApi: { proposing: false, notice: null, lanes: f.lanes, importedLaneId: null, loading: false, error: null, refresh: vi.fn(async () => {}),
    createLane: vi.fn(async (): Promise<{ id: string } | { error: string }> => ({ id: 'wf-new' })), updateLane: ok(), deleteLane: ok(), moveLane: ok(),
    addStep: ok(), renameStep: ok(), deleteStep: ok(), moveStep: ok(), reorderSteps: ok() },
  outcomesApi: { proposing: false, notice: null, outcomes: f.outcomes, loading: false, error: null, refresh: vi.fn(async () => {}), createOutcome: ok(), fileRequirement: ok(), moveOutcomes: ok(), toggleStepMap: ok(), setCriteria: ok(), updateOutcome: ok(), setServes: ok() },
  constraintsApi: { groups: [], total: f.constraints.length, loading: false, error: null, refresh: vi.fn(async () => {}), add: ok(), remove: ok(), setMark: ok(), rows: f.constraints },
  candidateActions: { promote: ok(), settle: ok(), dismiss: ok() },
  onDeleteRequirement: ok(),
  onOpenRequirement: vi.fn(),
  onOpenArchitecture: vi.fn(),
});
type Apis = ReturnType<typeof apis>;
let a: Apis;
const mount = (team = false, mode?: 'dark' | 'light', extra: Record<string, unknown> = {}) => render(
  <WorkflowsSpace mode={mode} projectId="p1" graph={f.graph} lanesApi={a.lanesApi as never} outcomesApi={a.outcomesApi as never} constraintsApi={a.constraintsApi as never}
    requirements={f.band} chains={f.chains} candidateActions={a.candidateActions as never} onDeleteRequirement={a.onDeleteRequirement}
    team={team} onOpenRequirement={a.onOpenRequirement} onOpenArchitecture={a.onOpenArchitecture} {...extra} />,
);
const pick = async (p: unknown) => { await act(async () => { scene.pick!(p); }); };
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); }); };
const lastModel = () => scene.models[scene.models.length - 1];

beforeEach(() => {
  f = spaceFixture();
  a = apis();
  scene.models.length = 0; scene.focus.length = 0; scene.settles.length = 0; scene.homes = 0; scene.recenters = 0; scene.pick = null;
});

describe('W · the space, as the mockup draws it', () => {
  it('the lens, the journeys, the hint, and a strip box per stage with its line; the scene gets the focused workflow and the rest behind', () => {
    const { getByTestId, getAllByTestId } = mount();
    expect(getByTestId('space-lens-journey').getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('space-lens-layer').textContent).toBe('Constraints');
    expect(getAllByTestId('space-journey').map((b) => b.textContent)).toEqual(['Incident response', 'Purchase order approval']);
    expect(getByTestId('workflows-space').textContent).toContain('A column is a stage. The rows below it are how that stage gets built.');
    const boxes = getAllByTestId('space-stage');
    expect(boxes.map((b) => [b.querySelector('.nm')!.textContent, b.querySelector('.lbl')!.textContent, b.getAttribute('data-state')])).toEqual([
      ['Detect', 'done', 'done'], ['Triage', '1 of 3 proven', 'open'], ['Contain', 'no outcome yet', 'none'], ['Eradicate', 'nothing builds this', 'unimpl'], ['Report', 'ready to close', 'ready'],
    ]);
    expect(boxes[3].className).toContain('loud');
    expect(lastModel().lens).toBe('journey');
    expect(lastModel().focused.id).toBe('wf-ir');
    expect(lastModel().ghosts.map((g: { id: string }) => g.id)).toEqual(['wf-po']);
    // Indie: no teammates on screen
    expect(document.querySelector('[data-testid="space-proposals"]')).toBeNull();
    expect(document.querySelectorAll('.av').length).toBe(0);
  });

  it('no pane ever names a table (the mockup took the "Backed by" lines out)', async () => {
    const { getByTestId, getAllByTestId } = mount();
    const seen: string[] = [];
    const grab = () => seen.push(getByTestId('space-inspector').textContent ?? '');
    await click(getAllByTestId('space-stage')[0]); grab();
    await click(getAllByTestId('space-goto-outcome')[0]); grab();
    await click(getAllByTestId('space-goto-req')[0]); grab();
    await click(getByTestId('space-goto-node')); grab();
    await click(getByTestId('space-goto-artifact')); grab();
    await click(getByTestId('space-lens-layer'));
    await click(getAllByTestId('space-layer')[0]); grab();
    await click(getAllByTestId('space-constraint')[0]); grab();
    expect(seen.length).toBe(7);
    for (const text of seen) {
      expect(text).not.toMatch(/Backed by|workflow_steps|outcome_step_maps|requirement_candidates|outcome_derivations|specification_requirements|project_constraints|work_plan_items|test_cases|ai_proposals|git_change_events/);
    }
  });
});

describe('W · a stage and its outcomes', () => {
  it('a strip box selects its stage and settles the camera; the pane offers Add an outcome, and filing it writes the outcome on that stage', async () => {
    const { getByTestId, getAllByTestId } = mount();
    await click(getAllByTestId('space-stage')[2]);
    expect(scene.settles[scene.settles.length - 1]).toEqual({ kind: 'step', stepId: 's2' });
    const pane = getByTestId('space-inspector');
    expect(pane.getAttribute('data-kind')).toBe('step');
    expect(pane.textContent).toContain('Stage 3');
    expect(pane.textContent).toContain('This stage has no outcome yet. Nothing below it can exist until it does.');
    await click(getByTestId('space-new-outcome'));
    expect(getByTestId('space-inspector').getAttribute('data-kind')).toBe('form:outcome');
    fireEvent.change(getByTestId('space-outcome-text'), { target: { value: 'A compromised session is revoked everywhere in one action' } });
    await click(getByTestId('space-form-save'));
    // AA.1: with no vision there is nothing to cite; the outcome files citing nothing
    expect(a.outcomesApi.createOutcome).toHaveBeenCalledWith('A compromised session is revoked everywhere in one action', 'wf-ir', 's2', []);
    expect(getByTestId('space-toast').textContent).toBe('Outcome filed on Contain. Nothing builds it yet.');
  });

  it('AC: a stage files an existing requirement not yet in its workflow (the act moved here from the Requirements list)', async () => {
    const rows = [...f.band.values()].map((r) => ({ id: r.id, ref: r.ref, name: r.name }));
    const { getByTestId, getAllByTestId, queryByTestId } = mount(false, undefined, { requirementRows: [...rows, { id: 'r-extra', ref: 'REQ-099', name: 'Audit log export' }] });
    await click(getAllByTestId('space-stage')[2]);
    await click(getByTestId('space-file-requirement'));
    expect(getByTestId('space-inspector').getAttribute('data-kind')).toBe('form:file');
    const offered = [...(getByTestId('space-file-requirement-select') as HTMLSelectElement).options].map((o) => o.value);
    // every requirement of Incident response is already here; only the one outside it is offered
    expect(offered).toEqual(['r-extra']);
    await click(getByTestId('space-form-save'));
    expect(a.outcomesApi.fileRequirement).toHaveBeenCalledWith({ rowId: 'r-extra', name: 'Audit log export', ref: 'REQ-099' }, 'wf-ir', 's2');
    expect(getByTestId('space-toast').textContent).toBe('REQ-099 filed on Contain.');
    // with every requirement already in the workflow, the act is not offered
    const full = mount(false, undefined, { requirementRows: rows });
    await click(within(full.container).getAllByTestId('space-stage')[2]);
    expect(within(full.container).queryByTestId('space-file-requirement')).toBeNull();
    expect(queryByTestId('space-file-requirement-select')).toBeNull();
  });

  it('the empty slot under a stage opens that stage\'s outcome form; an empty statement is refused in words', async () => {
    const { getByTestId } = mount();
    await pick({ kind: 'addout', stepId: 's2' });
    expect(getByTestId('space-inspector').getAttribute('data-kind')).toBe('form:outcome');
    expect(getByTestId('space-inspector').textContent).toContain('Contain');
    await click(getByTestId('space-form-save'));
    expect(a.outcomesApi.createOutcome).not.toHaveBeenCalled();
    expect(getByTestId('space-toast').textContent).toBe('An outcome needs a statement.');
  });

  it('a stage head picked in the scene opens the same pane; a click on nothing closes it and recenters', async () => {
    const { getByTestId, queryByTestId } = mount();
    await pick({ kind: 'step', stepId: 's0' });
    expect(getByTestId('space-inspector').textContent).toContain('Everything on this stage is proven and closed.');
    await pick(null);
    expect(queryByTestId('space-inspector')).toBeNull();
    expect(scene.recenters).toBeGreaterThan(0);
  });
});

describe('W · an outcome', () => {
  it('also on, with its unmap; put it on another step; the requirements that build it', async () => {
    const { getByTestId, getAllByTestId } = mount();
    await pick({ kind: 'outcome', stepId: 's4', outcomeId: 'o5' });
    const pane = within(getByTestId('space-inspector'));
    expect(pane.getByText('Derived from the CI job names at import.')).toBeTruthy();
    expect(getAllByTestId('space-also').map((b) => b.textContent)).toEqual(['Purchase order approval · Reconcile×']);
    await click(getByTestId('space-unmap'));
    expect(a.outcomesApi.toggleStepMap).toHaveBeenCalledWith('o5', 'p2');
    await click(getByTestId('space-also-form'));
    const options = [...(getByTestId('space-also-step') as HTMLSelectElement).options].map((o) => o.textContent);
    // every step it does not sit on yet, in every workflow
    expect(options).toEqual(['Incident response · Detect', 'Incident response · Triage', 'Incident response · Contain', 'Incident response · Eradicate', 'Purchase order approval · Request', 'Purchase order approval · Approve']);
    fireEvent.change(getByTestId('space-also-step'), { target: { value: 'p0' } });
    await click(getByTestId('space-form-save'));
    expect(a.outcomesApi.toggleStepMap).toHaveBeenCalledWith('o5', 'p0');
    expect(getByTestId('space-toast').textContent).toBe('Also on Purchase order approval · Request.');
  });

  it('ready to close: Close settles it; the pane says NodeSpec will not close it for you', async () => {
    const { getByTestId } = mount();
    await pick({ kind: 'outcome', stepId: 's4', outcomeId: 'o5' });
    expect(getByTestId('space-inspector').textContent).toContain('NodeSpec will not close it for you.');
    await click(getByTestId('space-close-outcome'));
    expect(a.candidateActions.settle).toHaveBeenCalledWith(expect.objectContaining({ id: 'o5' }));
  });

  it('done is terminal: no edits, no new steps, and it says so', async () => {
    const { getByTestId, queryByTestId } = mount();
    await pick({ kind: 'outcome', stepId: 's0', outcomeId: 'o1' });
    expect(getByTestId('space-inspector').textContent).toContain('Done. Proven by its requirements, and you closed it.');
    expect(getByTestId('space-inspector').textContent).toContain('Closed: it keeps the steps it was closed on.');
    for (const id of ['space-also-form', 'space-new-req', 'space-edit-outcome', 'space-remove-outcome']) expect(queryByTestId(id), id).toBeNull();
  });

  it('nothing builds this: the dead end; Add a requirement adds its criterion to the outcome, then promotes it under the name given', async () => {
    const { getByTestId } = mount();
    await pick({ kind: 'outcome', stepId: 's3', outcomeId: 'o4' });
    expect(getByTestId('space-inspector').textContent).toContain('Nothing builds this. An outcome with no requirement under it is a wish.');
    await click(getByTestId('space-new-req'));
    fireEvent.change(getByTestId('space-req-name'), { target: { value: 'Root cause is recorded' } });
    fireEvent.change(getByTestId('space-req-criterion'), { target: { value: 'The incident names its root cause' } });
    await click(getByTestId('space-form-save'));
    expect(a.outcomesApi.setCriteria).toHaveBeenCalledWith('o4', [expect.objectContaining({ text: 'drafted' }), { text: 'The incident names its root cause' }]);
    expect(a.candidateActions.promote).toHaveBeenCalledWith(expect.objectContaining({ id: 'o4' }), { name: 'Root cause is recorded', description: 'Root cause is recorded' });
    expect(getByTestId('space-toast').textContent).toBe('Requirement added under this outcome.');
  });

  it('a requirement needs a name and a criterion; edit and remove the outcome', async () => {
    const { getByTestId } = mount();
    await pick({ kind: 'outcome', stepId: 's3', outcomeId: 'o4' });
    await click(getByTestId('space-new-req'));
    await click(getByTestId('space-form-save'));
    expect(getByTestId('space-toast').textContent).toBe('A requirement needs a name.');
    fireEvent.change(getByTestId('space-req-name'), { target: { value: 'x' } });
    await click(getByTestId('space-form-save'));
    expect(getByTestId('space-toast').textContent).toBe('A requirement needs at least one criterion.');
    expect(a.candidateActions.promote).not.toHaveBeenCalled();
    await pick({ kind: 'outcome', stepId: 's3', outcomeId: 'o4' });
    await click(getByTestId('space-edit-outcome'));
    fireEvent.change(getByTestId('space-outcome-text'), { target: { value: 'The root cause is gone' } });
    await click(getByTestId('space-form-save'));
    expect(a.outcomesApi.updateOutcome).toHaveBeenCalledWith('o4', { name: 'The root cause is gone' });
    await pick({ kind: 'outcome', stepId: 's3', outcomeId: 'o4' });
    await click(getByTestId('space-remove-outcome'));
    expect(a.candidateActions.dismiss).toHaveBeenCalledWith(expect.objectContaining({ id: 'o4' }));
  });

  it('an outcome that derived something is not removed: its requirements go first', async () => {
    const { getByTestId } = mount();
    await pick({ kind: 'outcome', stepId: 's1', outcomeId: 'o2' });
    await click(getByTestId('space-remove-outcome'));
    expect(a.candidateActions.dismiss).not.toHaveBeenCalled();
    expect(getByTestId('space-toast').textContent).toBe('Remove its requirements first: REQ-021, REQ-022.');
  });
});

describe('W · down the chain', () => {
  it('a requirement: its criteria, the doors to its node and to the Requirements list; removing it asks first', async () => {
    const { getByTestId } = mount();
    await pick({ kind: 'req', stepId: 's0', outcomeId: 'o1', reqId: 'r1' });
    const pane = getByTestId('space-inspector');
    expect(pane.textContent).toContain('REQ-014');
    expect(pane.textContent).toContain('Flags five failed logins in a minute');
    expect(pane.textContent).toContain('TC-004');
    await click(getByTestId('space-open-requirements'));
    expect(a.onOpenRequirement).toHaveBeenCalledWith('wf-ir', 'r1');
    await click(getByTestId('space-remove-req'));
    expect(a.onDeleteRequirement).not.toHaveBeenCalled();
    await click(getByTestId('space-remove-req-confirm'));
    expect(a.onDeleteRequirement).toHaveBeenCalledWith('r1');
    expect(getByTestId('space-toast').textContent).toBe('REQ-014 removed.');
  });

  it('the node: tasks with the commit that ticked them, the test plan, the file it is carried into; the code: folder, file, commit', async () => {
    const { getByTestId } = mount();
    await pick({ kind: 'node', stepId: 's0', outcomeId: 'o1', reqId: 'r1' });
    const node = getByTestId('space-inspector').textContent!;
    expect(node).toContain('Detection Engine');
    expect(node).toContain('sigma-rules');
    expect(node).toContain('ticked at 9e41b07');
    expect(node).toContain('unit · pytest · proves AC1');
    await click(getByTestId('space-open-architecture'));
    expect(a.onOpenArchitecture).toHaveBeenCalledWith('n1');
    await click(getByTestId('space-goto-artifact'));
    const code = getByTestId('space-inspector').textContent!;
    for (const s of ['rules_engine.py', 'services/detection', '9e41b07', '9f2c1ab4e07d', 'python', 'TC-004']) expect(code, s).toContain(s);
    // Item 16 (owner 2026-09-26): the code pane has no Branch row. A project
    // has one branch, the primary, and the git branch it tracks lives in the
    // Git panel and on every change card.
    const rows = [...getByTestId('space-inspector').querySelectorAll('.kv .k')].map((k) => k.textContent);
    expect(rows).toEqual(['Folder', 'File', 'Commit', 'Content hash', 'Language', 'Kind', 'Proven by']);
  });
});

describe('AL.13 · a requirement under outcomes in two workflows', () => {
  it('the pane lists every outcome behind it; the other workflow\'s brings that journey forward on its outcome', async () => {
    const o5 = f.outcomes.find((o) => o.id === 'o5')!;
    o5.stepIds = ['p2'];
    o5.derivations.push({ id: 'd-o5-r1', requirementRowId: 'r1', reqRef: 'REQ-014', criteriaIds: [], proposedByKind: 'agent', createdAt: '2026-09-13T10:00:00Z' });
    const { getByTestId, getAllByTestId, queryByTestId } = mount();
    await pick({ kind: 'req', stepId: 's1', outcomeId: 'o2', reqId: 'r2' });
    expect(within(getByTestId('space-inspector')).getByText('Under the outcome')).toBeTruthy();
    expect(queryByTestId('space-req-also')).toBeNull();
    await pick({ kind: 'req', stepId: 's0', outcomeId: 'o1', reqId: 'r1' });
    const pane = within(getByTestId('space-inspector'));
    expect(pane.getByText('Under the outcomes')).toBeTruthy();
    expect(pane.getAllByTestId('space-req-also').map((b) => b.textContent)).toEqual(['A timeline lands in the incident record automaticallyPurchase order approval, Reconcile']);
    expect(getAllByTestId('space-journey').map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    const homes = scene.homes;
    await click(pane.getByTestId('space-req-also'));
    expect(getAllByTestId('space-journey').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(getByTestId('space-inspector').textContent).toContain('A timeline lands in the incident record automatically');
    expect(scene.homes).toBe(homes + 1);
  });
});

describe('W · the strip edits the stages', () => {
  it('add, rename, move; a stage that holds outcomes is not removed, an empty one is', async () => {
    const { getByTestId, getAllByTestId } = mount();
    await click(getByTestId('space-add-stage'));
    fireEvent.change(getByTestId('space-stage-draft'), { target: { value: 'Recover' } });
    await act(async () => { fireEvent.keyDown(getByTestId('space-stage-draft'), { key: 'Enter' }); });
    expect(a.lanesApi.addStep).toHaveBeenCalledWith('wf-ir', 'Recover');
    expect(getByTestId('space-toast').textContent).toBe('"Recover" added. It has no outcome yet.');
    await click(getAllByTestId('space-stage-rename')[1]);
    const input = getAllByTestId('space-stage')[1].querySelector('input')!;
    fireEvent.change(input, { target: { value: 'Assess' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(a.lanesApi.renameStep).toHaveBeenCalledWith('s1', 'Assess');
    await click(getAllByTestId('space-stage')[1].querySelector('[aria-label="Move later"]')!);
    expect(a.lanesApi.moveStep).toHaveBeenCalledWith('wf-ir', 's1', 'down');
    await click(getAllByTestId('space-stage-remove')[0]);
    expect(a.lanesApi.deleteStep).not.toHaveBeenCalled();
    expect(getByTestId('space-toast').textContent).toBe('"Detect" still holds an outcome. Removing it leaves it without a stage, for you to place again. Press Remove again to go ahead.');
    // AE.7 (ruling 16): the second press removes it; the outcome is left for the person to place again
    await click(getAllByTestId('space-stage-remove')[0]);
    expect(a.lanesApi.deleteStep).toHaveBeenCalledTimes(1);
    await click(getAllByTestId('space-stage-remove')[2]);
    expect(a.lanesApi.deleteStep).toHaveBeenCalledWith('s2');
  });

  it('AE.7: for a teammate the space files and says so: a proposed stage is not announced as added, and the hook\'s notice lands in the toast', async () => {
    a.lanesApi.proposing = true;
    const { getByTestId, queryByTestId, rerender } = mount();
    await click(getByTestId('space-add-stage'));
    fireEvent.change(getByTestId('space-stage-draft'), { target: { value: 'Recover' } });
    await act(async () => { fireEvent.keyDown(getByTestId('space-stage-draft'), { key: 'Enter' }); });
    expect(a.lanesApi.addStep).toHaveBeenCalledWith('wf-ir', 'Recover');
    expect(queryByTestId('space-stage-draft')).toBeNull();
    expect(queryByTestId('space-toast')?.textContent ?? '').not.toContain('added');
    const text = proposalNotice('add the stage "Recover" to Incident response');
    a.lanesApi = { ...a.lanesApi, notice: { text, at: 1 } as never };
    await act(async () => { rerender(
      <WorkflowsSpace projectId="p1" graph={f.graph} lanesApi={a.lanesApi as never} outcomesApi={a.outcomesApi as never} constraintsApi={a.constraintsApi as never}
        requirements={f.band} chains={f.chains} candidateActions={a.candidateActions as never} onDeleteRequirement={a.onDeleteRequirement}
        team={false} onOpenRequirement={a.onOpenRequirement} onOpenArchitecture={a.onOpenArchitecture} />,
    ); });
    expect(getByTestId('space-toast').textContent).toBe('Filed as a proposal: add the stage "Recover" to Incident response. The owner decides it under Proposals.');
  });

  it('a refusal from the database lands in the toast', async () => {
    a.outcomesApi.createOutcome = vi.fn(async (): Promise<string | null> => 'new row violates row-level security policy for table "outcome_step_maps"');
    const { getByTestId } = mount();
    await pick({ kind: 'addout', stepId: 's2' });
    fireEvent.change(getByTestId('space-outcome-text'), { target: { value: 'x' } });
    await click(getByTestId('space-form-save'));
    expect(getByTestId('space-toast').className).toContain('warn');
    expect(getByTestId('space-toast').textContent).toContain('row-level security');
  });

  it('a journey pill brings that workflow forward; + names a new one', async () => {
    const { getByTestId, getAllByTestId } = mount();
    await click(getAllByTestId('space-journey')[1]);
    expect(lastModel().focused.id).toBe('wf-po');
    expect(scene.homes).toBeGreaterThan(0);
    await click(getByTestId('space-add-journey'));
    fireEvent.change(getByTestId('space-journey-draft'), { target: { value: 'Player onboarding' } });
    await act(async () => { fireEvent.keyDown(getByTestId('space-journey-draft'), { key: 'Enter' }); });
    expect(a.lanesApi.createLane).toHaveBeenCalledWith('Player onboarding');
  });

  it('AL.5: the workflow in front has a remove; the first press says what goes and where its outcomes move, the second removes it', async () => {
    const { getByTestId, getAllByTestId, queryAllByTestId } = mount();
    expect(getAllByTestId('space-journey-remove').map((b) => b.getAttribute('aria-label'))).toEqual(['Remove Incident response']);
    await click(getByTestId('space-journey-remove'));
    expect(a.lanesApi.deleteLane).not.toHaveBeenCalled();
    expect(getByTestId('space-toast').textContent).toBe('This removes "Incident response" and its 5 stages. Its 6 outcomes move to "Purchase order approval", to be placed again. Press Remove again to go ahead.');
    await click(getByTestId('space-journey-remove'));
    expect(a.lanesApi.deleteLane).toHaveBeenCalledWith('wf-ir');
    expect(a.outcomesApi.refresh).toHaveBeenCalled();
    expect(getByTestId('space-toast').textContent).toBe('"Incident response" removed.');
    // a pick elsewhere spends the first press
    await click(getAllByTestId('space-journey')[1]);
    expect(queryAllByTestId('space-journey-remove').map((b) => b.getAttribute('aria-label'))).toEqual(['Remove Purchase order approval']);
    await click(getByTestId('space-journey-remove'));
    await click(getAllByTestId('space-journey')[0]);
    await click(getByTestId('space-journey-remove'));
    expect(a.lanesApi.deleteLane).toHaveBeenCalledTimes(1);
  });

  it('AL.5: the only workflow, with outcomes in it, is refused in words; a refusal from the hook lands in the toast; the example offers no remove', async () => {
    a.lanesApi.lanes = [f.lanes[0]];
    const first = mount();
    await click(first.getByTestId('space-journey-remove'));
    await click(first.getByTestId('space-journey-remove'));
    expect(a.lanesApi.deleteLane).not.toHaveBeenCalled();
    expect(first.getByTestId('space-toast').textContent).toBe('"Incident response" is your only workflow and 6 outcomes live in it. Add another workflow first, so they have somewhere to go.');
    first.unmount();

    a.lanesApi.lanes = f.lanes;
    a.lanesApi.deleteLane = vi.fn(async (): Promise<string | null> => 'permission denied for table workflows');
    const second = mount();
    await click(second.getByTestId('space-journey-remove'));
    await click(second.getByTestId('space-journey-remove'));
    expect(second.getByTestId('space-toast').textContent).toBe('permission denied for table workflows');
    expect(lastModel().focused.id).toBe('wf-ir');
    second.unmount();

    const third = mount(false, undefined, { viewOnly: true });
    expect(third.queryAllByTestId('space-journey-remove')).toEqual([]);
  });

  it('no workflow yet: the note says where to start', () => {
    a.lanesApi.lanes = [];
    const { getByTestId } = mount();
    expect(getByTestId('space-empty').textContent).toBe('No workflow yet.Name one with + above, then lay out its stages in the strip.');
  });
});

describe('W · the Constraints lens', () => {
  it('a strip box per layer that holds something; a layer pane with Global and one-workflow rows; the form files a scoped constraint with its rule and its reason', async () => {
    const { getByTestId, getAllByTestId } = mount();
    await click(getByTestId('space-lens-layer'));
    expect(lastModel().lens).toBe('layer');
    expect(getAllByTestId('space-layer').map((b) => [b.querySelector('.nm')!.textContent, b.querySelector('.lbl')!.textContent])).toEqual([['Technology', '2 global'], ['Security', '1 for a workflow']]);
    await click(getAllByTestId('space-layer')[1]);
    expect(getByTestId('space-inspector').textContent).toContain('For one workflow');
    await click(getByTestId('space-new-constraint'));
    fireEvent.change(getByTestId('space-con-title'), { target: { value: 'No agent may revoke a session unattended' } });
    fireEvent.change(getByTestId('space-con-rationale'), { target: { value: 'A person confirms every revoke.' } });
    fireEvent.change(getByTestId('space-con-scope'), { target: { value: 'wf-ir' } });
    await click(getByTestId('space-form-save'));
    expect(a.constraintsApi.add).toHaveBeenCalledWith('security', 'No agent may revoke a session unattended', 'wf-ir', { title: 'No agent may revoke a session unattended', rationale: 'A person confirms every revoke.' });
    expect(getByTestId('space-toast').textContent).toBe('Constraint filed under Security.');
  });

  it('Z: no pane or form carries a line about filing over MCP (the agent files through Proposals, which says so itself)', async () => {
    const { getByTestId, getAllByTestId } = mount();
    const plain = (text: string | null) => expect(text ?? '').not.toMatch(/MCP|agent can file|file one too/i);
    await pick({ kind: 'addout', stepId: 's2' });
    plain(getByTestId('space-inspector').textContent);
    await pick({ kind: 'outcome', stepId: 's3', outcomeId: 'o4' });
    plain(getByTestId('space-inspector').textContent);
    await click(getByTestId('space-new-req'));
    plain(getByTestId('space-inspector').textContent);
    await click(getByTestId('space-lens-layer'));
    await click(getAllByTestId('space-layer')[1]);
    await click(getByTestId('space-new-constraint'));
    expect(getByTestId('space-inspector').getAttribute('data-kind')).toBe('form:constraint');
    plain(getByTestId('space-inspector').textContent);
    expect(document.querySelector('.byagent')).toBeNull();
  });

  it('a constraint: its scope, its reason, and Remove', async () => {
    const { getByTestId } = mount();
    await click(getByTestId('space-lens-layer'));
    await pick({ kind: 'constraint', id: 'k1' });
    const pane = getByTestId('space-inspector').textContent!;
    expect(pane).toContain('Only Incident response');
    expect(pane).toContain('The SOC reads one queue.');
    await click(getByTestId('space-remove-constraint'));
    expect(a.constraintsApi.remove).toHaveBeenCalledWith('k1');
  });
});

describe('W · Team', () => {
  it('the owner\'s initials on the journey and the stage pane; proposals are decided under Agents, not from the space', async () => {
    const { getByTestId, getAllByTestId, container } = mount(true);
    expect(getAllByTestId('space-journey')[0].querySelector('.av')!.textContent).toBe('AK');
    await click(getAllByTestId('space-stage')[0]);
    expect(getByTestId('space-inspector').textContent).toContain('Ana Kohl owns this workflow');
    // AL.23 (owner 2026-10-03): the space's own Proposals button repeated the
    // Agents button in the header, and is gone on every plan.
    expect(container.querySelector('[data-testid="space-proposals"]')).toBeNull();
    expect([...container.querySelectorAll('button')].some((b) => /Proposals/.test(b.textContent ?? ''))).toBe(false);
    expect(lastModel().team).toBe(true);
  });
});

describe('X · light and dark follow the app', () => {
  it('dark by default; light when the app is light: the root, the scene, and the hues on screen', async () => {
    const dark = mount();
    expect(dark.getByTestId('workflows-space').getAttribute('data-mode')).toBe('dark');
    expect(lastModel().mode).toBe('dark');
    dark.unmount();
    const { getByTestId, getAllByTestId } = mount(false, 'light');
    expect(getByTestId('workflows-space').getAttribute('data-mode')).toBe('light');
    expect(lastModel().mode).toBe('light');
    // the Detect box's chain: proven, requirement, node, file, in the light hues
    const segs = [...getAllByTestId('space-stage')[0].querySelectorAll('.chain i')].map((i) => (i as HTMLElement).style.background);
    expect(segs).toEqual(['rgb(31, 125, 82)', 'rgb(43, 123, 189)', 'rgb(31, 138, 92)', 'rgb(154, 79, 199)']);
    await pick({ kind: 'outcome', stepId: 's4', outcomeId: 'o5' });
    expect((getByTestId('space-inspector').querySelector('.cap') as HTMLElement).style.background).toBe('rgb(31, 125, 82)');
  });
});

describe('AA.1 · the space cites the vision', () => {
  const SENTENCES = [{ id: 'v:1a2b3c4d', text: 'Every alert reaches a human in minutes.' }, { id: 'v:5e6f7a8b', text: 'Nothing is contained twice.' }];

  it('a new outcome offers the sentence no outcome serves yet, and files citing the one picked', async () => {
    const { getByTestId } = mount(false, undefined, { sentences: SENTENCES, firstSentenceId: 'v:5e6f7a8b' });
    await pick({ kind: 'addout', stepId: 's2' });
    const select = getByTestId('space-outcome-sentence') as HTMLSelectElement;
    expect(select.value).toBe('v:5e6f7a8b');
    fireEvent.change(getByTestId('space-outcome-text'), { target: { value: 'A compromised session is revoked everywhere in one action' } });
    fireEvent.change(select, { target: { value: 'v:1a2b3c4d' } });
    await click(getByTestId('space-form-save'));
    expect(a.outcomesApi.createOutcome).toHaveBeenCalledWith('A compromised session is revoked everywhere in one action', 'wf-ir', 's2', [SENTENCES[0]]);
  });

  it('an outcome\'s pane says what it serves; a pick re-cites it', async () => {
    const { getByTestId } = mount(false, undefined, { sentences: SENTENCES });
    await pick({ kind: 'outcome', stepId: 's4', outcomeId: 'o5' });
    expect(getByTestId('space-serves').textContent).toContain('Serves no sentence of the vision yet');
    await act(async () => { fireEvent.change(getByTestId('space-serves-select'), { target: { value: 'v:5e6f7a8b' } }); });
    expect(a.outcomesApi.setServes).toHaveBeenCalledWith('o5', [SENTENCES[1]]);
  });

  it('with no vision the form asks nothing and the pane says nothing about it', async () => {
    const { getByTestId, queryByTestId } = mount();
    await pick({ kind: 'addout', stepId: 's2' });
    expect(queryByTestId('space-outcome-sentence')).toBeNull();
    await pick({ kind: 'outcome', stepId: 's4', outcomeId: 'o5' });
    expect(queryByTestId('space-serves')).toBeNull();
    expect(getByTestId('space-inspector')).toBeTruthy();
  });

  it('a constraint says how many node packets carry it', async () => {
    const { getByTestId } = mount(false, undefined, { constraintReach: new Map([['k1', 3], ['k2', 0]]) });
    await click(getByTestId('space-lens-layer'));
    await pick({ kind: 'constraint', id: 'k1' });
    expect(getByTestId('space-constraint-reach').textContent).toBe('In 3 node packets.');
    await pick({ kind: 'constraint', id: 'k2' });
    expect(getByTestId('space-constraint-reach').textContent).toBe('In no node packet yet.');
  });
});

// AJ.6 (owner 2026-09-30): the account's example shows Workflows on every
// plan; below Indie the space reads and draws no act that writes.
describe('AJ.6 · the example below Indie: the space reads, and draws nothing that writes', () => {
  const WRITES = [
    'space-add-journey', 'space-add-stage', 'space-stage-rename', 'space-stage-remove', 'space-add-constraint',
    'space-new-constraint', 'space-lift-waiver', 'space-remove-constraint', 'space-new-outcome', 'space-file-requirement',
    'space-unmap', 'space-also-form', 'space-close-outcome', 'space-new-req', 'space-edit-outcome', 'space-remove-outcome',
    'space-remove-req', 'space-remove-req-confirm',
  ];
  const SENTENCES = [{ id: 'v:1a2b3c4d', text: 'Every alert reaches a human in minutes.' }];
  // a waiver to lift and a requirement to file, so every act has a place to show
  const EXTRA = { sentences: SENTENCES, requirementRows: [{ id: 'row-unfiled', ref: 'REQ-099', name: 'Unfiled requirement' }] };
  const withWaiver = () => {
    const k1 = f.constraints.find((c) => c.id === 'k1') as unknown as { waivers?: unknown[] };
    k1.waivers = [{ id: 'w1', target: 'n-legacy', reason: 'The legacy path keeps its own store until it retires.' }];
  };
  const writesOnScreen = () => WRITES.filter((id) => document.querySelector(`[data-testid="${id}"]`));

  it('every pane reads as before and none offers a write; the scene is told so; an empty stage adds nothing', async () => {
    withWaiver();
    const { getByTestId, getAllByTestId } = mount(true, undefined, { viewOnly: true, ...EXTRA });
    const seen: string[] = [];
    const visit = async (go: () => Promise<void>) => { await go(); seen.push(getByTestId('space-inspector').getAttribute('data-kind') ?? ''); expect(writesOnScreen()).toEqual([]); };
    expect(writesOnScreen()).toEqual([]);
    expect(lastModel().editable).toBe(false);
    // the journeys still switch, and each stage, outcome, requirement, node, file and constraint still opens
    expect(getAllByTestId('space-journey').length).toBe(2);
    await visit(() => click(getAllByTestId('space-stage')[2]));
    await visit(() => pick({ kind: 'outcome', stepId: 's4', outcomeId: 'o5' }));
    expect((getByTestId('space-serves-select') as HTMLSelectElement).disabled).toBe(true);
    expect(getAllByTestId('space-also').length).toBe(1);
    await visit(() => click(getAllByTestId('space-stage')[0]));
    await visit(() => click(getAllByTestId('space-goto-outcome')[0]));
    await visit(() => click(getAllByTestId('space-goto-req')[0]));
    await visit(() => click(getByTestId('space-goto-node')));
    await visit(() => click(getByTestId('space-goto-artifact')));
    await click(getByTestId('space-lens-layer'));
    expect(writesOnScreen()).toEqual([]);
    await visit(() => click(getAllByTestId('space-layer')[0]));
    await visit(() => pick({ kind: 'constraint', id: 'k1' }));
    expect(seen).toEqual(['step', 'outcome', 'step', 'outcome', 'req', 'node', 'artifact', 'layer', 'constraint']);
    // the empty stage's card selects the stage; no form opens
    await click(getByTestId('space-lens-journey'));
    await pick({ kind: 'addout', stepId: 's2' });
    expect(getByTestId('space-inspector').getAttribute('data-kind')).toBe('step');
    // nothing was written
    for (const api of [a.lanesApi, a.outcomesApi, a.constraintsApi] as Array<Record<string, unknown>>) {
      for (const [name, fn] of Object.entries(api)) {
        if (typeof fn === 'function' && 'mock' in fn && name !== 'refresh') expect((fn as ReturnType<typeof vi.fn>).mock.calls, name).toEqual([]);
      }
    }
  });

  it('the same space on a plan that carries it offers every one of those acts somewhere', async () => {
    withWaiver();
    const { getByTestId, getAllByTestId } = mount(true, undefined, EXTRA);
    const offered = new Set<string>(writesOnScreen());
    const look = async (go: () => Promise<void>) => { await go(); writesOnScreen().forEach((id) => offered.add(id)); };
    expect(lastModel().editable).toBe(true);
    await look(() => click(getAllByTestId('space-stage')[2]));
    await look(() => pick({ kind: 'outcome', stepId: 's4', outcomeId: 'o5' }));
    await look(() => pick({ kind: 'outcome', stepId: 's1', outcomeId: 'o2' }));
    await look(() => click(getAllByTestId('space-goto-req')[0]));
    await look(() => click(getByTestId('space-remove-req')));
    await click(getByTestId('space-lens-layer'));
    writesOnScreen().forEach((id) => offered.add(id));
    await look(() => click(getAllByTestId('space-layer')[0]));
    for (const k of ['k1', 'k2', 'k3', 'k4']) await look(() => pick({ kind: 'constraint', id: k }));
    await look(async () => { await pick({ kind: 'step', stepId: 's4' }); });
    expect(WRITES.filter((id) => !offered.has(id))).toEqual([]);
  });
});

// @vitest-environment jsdom
// AL.7 (owner 2026-10-01): "On the Outcome nodes, refine the 'Outcome -
// Agent' to the actual Agent name so it's clear where it originated
// (truncate if the name is long). In the bottom of the node, it says 'also
// on [workflow]'. This isn't helpful and should be 'also on [the workflow
// step]', because they all say the same thing." The outcome now records
// the agent that filed it (al7-outcome-filer_test.ts); the app names it by
// the connection's own name, else the name the agent gave itself, else the
// agent that derived its first requirement.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, within } from '@testing-library/react';
import { agentNameOf, keyIdsNamed, outcomeAgent } from '../ui/components/ideation/useOutcomes.js';
import { buildJourney, outcomeEyebrow, alsoLine, shortName } from '../ui/components/work/workflows/space-model.js';
import { spaceFixture } from './helpers/space-fixture.js';

const scene = vi.hoisted(() => ({ models: [] as Array<Record<string, any>>, pick: null as null | ((p: unknown) => void) }));
vi.mock('../ui/components/work/workflows/space-scene.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createSpaceScene: (_host: unknown, onPick: (p: unknown) => void) => {
    scene.pick = onPick;
    return { setModel: (m: Record<string, any>) => { scene.models.push(m); }, setFocus: () => {}, settle: () => {}, home: () => {}, recenter: () => {}, dispose: () => {} };
  },
}));
const { default: WorkflowsSpace } = await import('../ui/components/work/workflows/WorkflowsSpace.js');

const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const names = new Map([[KEY, 'Claude Desktop']]);

describe('AL.7 · the agent, by name', () => {
  it('a key by its name, a sign-in by its client, a bare key id by its name, else the name it gave itself', () => {
    expect(agentNameOf(`key:${KEY}`, 'site-builder', names)).toBe('Claude Desktop');
    expect(agentNameOf('key:ffffffff-0000-4000-8000-000000000000', 'site-builder', names)).toBe('site-builder');
    expect(agentNameOf('key:ffffffff-0000-4000-8000-000000000000', null, names)).toBe('key ffffffff');
    expect(agentNameOf('oauth:u1:claude-code.4b1c2e9a-1111-4222-8333-444444444444', 'site-builder', names)).toBe('claude-code');
    expect(agentNameOf('oauth:u1:https://cursor.sh/mcp', null, names)).toBe('cursor.sh');
    // an id minted before AL.2 names nothing; the agent's own name is better than its prefix
    expect(agentNameOf('oauth:u1:4b1c2e9a-1111-4222-8333-444444444444', 'site-builder', names)).toBe('site-builder');
    expect(agentNameOf('oauth:u1:4b1c2e9a-1111-4222-8333-444444444444', null, names)).toBe('4b1c2e9a');
    expect(agentNameOf(KEY, null, names)).toBe('Claude Desktop');
    expect(agentNameOf('bakery-site-agent', null, names)).toBe('bakery-site-agent');
    expect(agentNameOf(null, '  ', names)).toBeNull();
  });

  it('the filer wins; else the agent that derived its first requirement; a person\'s outcome names no agent', () => {
    const agentDerived = [{ proposedByKind: 'agent' as const, proposedById: KEY }];
    const humanDerived = [{ proposedByKind: 'human' as const, proposedById: 'user-1' }];
    expect(outcomeAgent({ serves: [], filedBy: { credential: 'oauth:u1:claude-code.4b1c2e9a-1111-4222-8333-444444444444', agent: 'x' } }, agentDerived, names)).toBe('claude-code');
    expect(outcomeAgent({ serves: [] }, agentDerived, names)).toBe('Claude Desktop');
    expect(outcomeAgent({}, [{ proposedByKind: 'agent', proposedById: 'bakery-site-agent' }], names)).toBe('bakery-site-agent');
    expect(outcomeAgent({}, humanDerived, names)).toBeNull();
    expect(outcomeAgent(null, [], names)).toBeNull();
  });

  it('one read of key names covers the filers and the derivations', () => {
    const other = 'cccccccc-0000-4000-8000-000000000000';
    expect(keyIdsNamed(
      [{ evidence: { filedBy: { credential: `key:${KEY}` } } }, { evidence: { serves: [] } }, { evidence: null }],
      [{ proposed_by_kind: 'agent', proposed_by_id: other }, { proposed_by_kind: 'agent', proposed_by_id: 'bakery-site-agent' }, { proposed_by_kind: 'human', proposed_by_id: 'dddddddd-0000-4000-8000-000000000000' }],
    ).sort()).toEqual([KEY, other].sort());
  });
});

describe('AL.7 · the outcome card', () => {
  it('the eyebrow names the agent, cut to fit; only where the team view shows who did what', () => {
    expect(outcomeEyebrow({ byAgent: true, agent: 'claude-code' }, true)).toBe('OUTCOME · claude-code');
    expect(outcomeEyebrow({ byAgent: true, agent: 'The nightly requirements groomer' }, true)).toBe('OUTCOME · The nightly requi…');
    expect(shortName('The nightly requirements groomer')).toHaveLength(18);
    expect(outcomeEyebrow({ byAgent: true, agent: null }, true)).toBe('OUTCOME · AGENT');
    expect(outcomeEyebrow({ byAgent: true, agent: 'claude-code' }, false)).toBe('OUTCOME');
    expect(outcomeEyebrow({ byAgent: false, agent: null }, true)).toBe('OUTCOME');
  });

  it('the foot names the other step, not the workflow; two outcomes in one workflow no longer read alike', () => {
    const f = spaceFixture();
    f.outcomes = f.outcomes.map((o) => (o.id === 'o4' ? { ...o, stepIds: ['s3', 's1'] } : o));
    const j = buildJourney({ lane: f.lanes[0], lanes: f.lanes, outcomes: f.outcomes, requirements: f.band, chains: f.chains, graph: f.graph });
    const o5 = j.stages[4].outcomes[0], o4 = j.stages[3].outcomes[0];
    expect(alsoLine(o5)).toBe('also on Reconcile');
    expect(alsoLine(o4)).toBe('also on Triage');
    expect(alsoLine({ also: [o5.also[0], { ...o5.also[0], stepName: 'Approve' }, { ...o5.also[0], stepName: 'Request' }] })).toBe('also on Reconcile and 2 more');
    expect(alsoLine(j.stages[0].outcomes[0])).toBeNull();
  });

  it('the model carries the name; an agent that filed with no derivation still counts as an agent', () => {
    const f = spaceFixture();
    f.outcomes = f.outcomes.map((o) => (o.id === 'o4' ? { ...o, agent: 'claude-code' } : o));
    const j = buildJourney({ lane: f.lanes[0], lanes: f.lanes, outcomes: f.outcomes, requirements: f.band, chains: f.chains, graph: f.graph });
    expect([j.stages[3].outcomes[0].byAgent, j.stages[3].outcomes[0].agent]).toEqual([true, 'claude-code']);
    expect([j.stages[0].outcomes[0].byAgent, j.stages[0].outcomes[0].agent]).toEqual([false, null]);
  });
});

describe('AL.7 · in the space', () => {
  beforeEach(() => { scene.models.length = 0; scene.pick = null; });
  it('a step\'s pane says which agent each outcome came from', async () => {
    const f = spaceFixture();
    f.outcomes = f.outcomes.map((o) => (o.id === 'o2' ? { ...o, agent: 'claude-code' } : o));
    const ok = () => vi.fn(async () => null as string | null);
    const lanesApi = { proposing: false, notice: null, lanes: f.lanes, importedLaneId: null, loading: false, error: null, refresh: vi.fn(async () => {}), createLane: vi.fn(), updateLane: ok(), deleteLane: ok(), moveLane: ok(), addStep: ok(), renameStep: ok(), deleteStep: ok(), moveStep: ok(), reorderSteps: ok() };
    const outcomesApi = { proposing: false, notice: null, outcomes: f.outcomes, loading: false, error: null, refresh: vi.fn(async () => {}), createOutcome: ok(), fileRequirement: ok(), moveOutcomes: ok(), toggleStepMap: ok(), setCriteria: ok(), updateOutcome: ok(), setServes: ok() };
    const constraintsApi = { groups: [], total: 0, loading: false, error: null, refresh: vi.fn(async () => {}), add: ok(), remove: ok(), setMark: ok(), rows: [] };
    const { getByTestId } = render(
      <WorkflowsSpace projectId="p1" graph={f.graph} lanesApi={lanesApi as never} outcomesApi={outcomesApi as never} constraintsApi={constraintsApi as never}
        requirements={f.band} chains={f.chains} candidateActions={{ promote: ok(), settle: ok(), dismiss: ok() } as never} onDeleteRequirement={ok()}
        team onOpenRequirement={vi.fn()} onOpenArchitecture={vi.fn()} />,
    );
    await act(async () => { scene.pick!({ kind: 'step', stepId: 's1' }); });
    expect(within(getByTestId('space-inspector')).getByText(/from claude-code/)).toBeTruthy();
    // the scene is handed the name with the outcome
    const triage = scene.models[scene.models.length - 1].focused.stages[1].outcomes[0];
    expect([triage.byAgent, triage.agent]).toEqual([true, 'claude-code']);
  });
});

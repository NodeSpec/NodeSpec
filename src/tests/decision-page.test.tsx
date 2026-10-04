// @vitest-environment jsdom
//
// The design's One decision board: the promotion the Shelfie seed leaves
// pending (proposal 613, claude-code asking to derive the privacy
// requirement), read on its own page. The record read is stubbed with
// what the seed writes; everything from the question to the acts is the
// real component. The pure lines are pinned beside it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, within } from '@testing-library/react';
import { renderCanvas } from './helpers/reactflow-dom.js';
import type { Graph } from '@nodespec/core/types.js';
import type { DecisionState } from '../ui/components/ideation/useDecision.js';
import type { QueueItem } from '../ui/components/ideation/useApprovalsQueue.js';

const N = (n: string) => `bf000000-0000-4000-8000-00000000a0${n}`;
const PROPOSAL_613 = 'bf000000-0000-4000-8000-000000000613';
const O302 = 'bf000000-0000-4000-8000-000000000302';

const state: DecisionState = { record: null, loading: false, error: null };
vi.mock('../ui/components/ideation/useDecision.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useDecision: () => state }));

const { DecisionPage } = await import('../ui/components/ideation/DecisionPage.js');
const { predictedRef, stepsPhrase, becomesLine, askedLine, dayMonth } = await import('../ui/components/ideation/useDecision.js');

const seedRecord = () => ({
  proposalId: PROPOSAL_613, agent: 'claude-code', askedAt: '2026-09-15T15:14:00.000Z',
  reason: 'All three criteria are unclaimed and testable as written. This is the outcome the auth change is most likely to break, so it should be a requirement before that work starts. Promotion is yours to make.',
  candidateId: O302, name: 'A shelf is private unless the reader shares it',
  description: "Enforced today entirely by RLS policies reading auth.uid(). Every one of these three criteria has to pass before and after the auth move, which makes them the migration's safety net.",
  criteria: [
    { id: 'sh02c1', text: 'An unshared shelf returns nothing to a signed-out request', verification: 'automated' },
    { id: 'sh02c2', text: 'An unshared shelf returns nothing to a different signed-in reader', verification: 'automated' },
    { id: 'sh02c3', text: 'Publishing a shelf exposes only the books on it, never the reading sessions', verification: 'automated' },
  ],
  nodeId: N('05'), section: 'Supabase Postgres',
  steps: [{ index: 1, name: 'Sign in', lane: 'A reader tracks a book' }, { index: 3, name: 'Move it between shelves', lane: 'A reader tracks a book' }],
  nextRef: 'REQ-005',
});
const item = (): QueueItem => ({
  proposalId: PROPOSAL_613, kind: 'promotion', status: 'pending', pending: true, decidedLabel: null,
  target: 'A shelf is private unless the reader shares it', origin: { kind: 'agent', label: 'claude-code' },
  text: 'the outcome the auth move is most likely to break.', patchCount: 1, candidateId: O302, createdAt: '2026-09-15T15:14:00.000Z', reviewInCanvas: false,
});
const graph = (): Graph => ({
  id: 'g', schemaVersion: 1, version: 1, hash: 'h',
  nodes: { [N('01')]: { id: N('01'), type: 'frontend-app', label: 'Shelfie web app' }, [N('05')]: { id: N('05'), type: 'auth-provider', label: 'Supabase Auth' } },
  edges: { e2: { id: 'e2', source: N('01'), target: N('05'), contractId: 'c2', label: 'Session issued to the browser; its sub is what every RLS policy reads' } },
  contracts: { c2: { id: 'c2', kind: 'rest', name: 'GoTrue session' } } as never,
  artifacts: {},
});

beforeEach(() => { state.record = seedRecord(); state.loading = false; state.error = null; });

describe('One decision · the privacy promotion from the Shelfie seed', () => {
  it('asks the question, says who asked, shows the outcome with its criteria and where it lands, the reason, what it touches, the acts', () => {
    const onDecide = vi.fn();
    const onBack = vi.fn();
    const onEditFirst = vi.fn();
    const onOpenArchitecture = vi.fn();
    const { getByTestId, getAllByTestId, container } = renderCanvas(
      <DecisionPage item={item()} projectId="p" graph={graph()} onDecide={onDecide} onBack={onBack} onEditFirst={onEditFirst} onOpenArchitecture={onOpenArchitecture} />,
    );
    expect(container.querySelector('h1')!.textContent).toBe('Make this a requirement?');
    expect(getByTestId('decision-asked').textContent).toBe('claude-code asked on 15 Sep.');
    // the outcome card: unconfirmed is what a promotion mints
    const card = getByTestId('decision-outcome');
    expect(within(card).getByTestId('decision-becomes-ref').textContent).toBe('Requirement REQ-005, unconfirmed');
    expect(within(card).getByTestId('decision-name').textContent).toBe('A shelf is private unless the reader shares it');
    expect(within(card).getByTestId('decision-description').textContent).toContain('Enforced today entirely by RLS policies reading auth.uid().');
    expect(getAllByTestId('decision-criterion').map((li) => li.textContent)).toEqual([
      'An unshared shelf returns nothing to a signed-out request',
      'An unshared shelf returns nothing to a different signed-in reader',
      'Publishing a shelf exposes only the books on it, never the reading sessions',
    ]);
    expect(within(card).getByTestId('decision-becomes').textContent).toBe('Becomes REQ-005 under Supabase Postgres · unconfirmed · on step 1 Sign in and step 3 Move it between shelves');
    expect(getByTestId('decision-reason').textContent).toContain('Promotion is yours to make.');
    expect(container.textContent).toContain("claude-code's reason");
    // touches: the outcome's node and the far end of the edge that explains it, each a door
    expect(getAllByTestId('decision-touch').map((b) => b.textContent)).toEqual(['Supabase Auth', 'Shelfie web app']);
    fireEvent.click(getAllByTestId('decision-touch')[1]);
    expect(onOpenArchitecture).toHaveBeenCalledWith(N('01'));
    // the acts
    fireEvent.click(getByTestId('decision-accept'));
    expect(onDecide).toHaveBeenCalledWith('accept');
    fireEvent.click(getByTestId('decision-edit'));
    expect(onEditFirst).toHaveBeenCalledWith(O302);
    fireEvent.click(getByTestId('decision-not-yet'));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(getByTestId('decision-reject'));
    expect(onDecide).toHaveBeenCalledWith('reject');
    fireEvent.click(getByTestId('decision-back'));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('without a Work door there is no Edit first; without a node it says where it will land; an error shows', () => {
    state.record = { ...seedRecord(), nodeId: null, steps: [], nextRef: null, section: null };
    const { queryByTestId, getByTestId } = renderCanvas(<DecisionPage item={item()} projectId="p" graph={graph()} onDecide={vi.fn()} onBack={vi.fn()} error="The server refused the decision." />);
    expect(queryByTestId('decision-edit')).toBeNull();
    expect(getByTestId('decision-touch-none')).toBeTruthy();
    expect(getByTestId('decision-becomes').textContent).toBe('Becomes a requirement · unconfirmed · on no step yet');
    expect(getByTestId('decision-becomes-ref').textContent).toBe('Requirement , unconfirmed');
    expect(getByTestId('decision-error').textContent).toBe('The server refused the decision.');
  });

  it('the pure lines: the ref the server would mint, the steps phrase, the asked line', () => {
    expect(predictedRef(['REQ-001', 'REQ-004', 'REQ-003'])).toBe('REQ-005');
    expect(predictedRef([])).toBe('REQ-001');
    expect(predictedRef(['REQ-x', 'SPEC-9', 'REQ-012'])).toBe('REQ-013');
    expect(stepsPhrase([])).toBe('on no step yet');
    expect(stepsPhrase([{ index: 4, name: 'Mark it finished', lane: 'l' }])).toBe('on step 4 Mark it finished');
    expect(stepsPhrase([{ index: 3, name: 'C', lane: 'l' }, { index: 1, name: 'A', lane: 'l' }, { index: 2, name: 'B', lane: 'l' }])).toBe('on step 1 A, step 2 B and step 3 C');
    expect(becomesLine({ nextRef: 'REQ-005', section: 'Supabase Postgres', steps: [{ index: 1, name: 'Sign in', lane: 'l' }] })).toBe('Becomes REQ-005 under Supabase Postgres · unconfirmed · on step 1 Sign in');
    // AC: below Indie no step is named, not even "on no step yet"
    expect(becomesLine({ nextRef: 'REQ-005', section: null, steps: null })).toBe('Becomes REQ-005 · unconfirmed');
    expect(askedLine('hermes', 'not a date')).toBe('hermes asked.');
    expect(dayMonth('2026-09-15T15:14:00.000Z')).toBe('15 Sep');
  });
});

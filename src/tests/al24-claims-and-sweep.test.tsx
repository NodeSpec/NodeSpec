// @vitest-environment jsdom
//
// AL.24 (owner 2026-10-05): "ensure that upon toggle, the backend logic
// remains headless so the user doesn't have to have the app open, as well as
// we don't have a race condition if the user then clicks reject or approve
// while the function is completing auto approval."
//
// The app no longer applies anything under Auto: the server does, and the
// app's own accept and reject take the proposal first (the server's claim on
// reviewed_at), so the two never both decide one. These run the app's code
// against an in-memory database that honours the write conditions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { renderCanvas } from './helpers/reactflow-dom.js';

type Row = Record<string, unknown>;
type Filter = [string, string, unknown];

/** A database that answers selects with the table's rows (filtered by eq/is)
 *  and applies an update only to the rows its filters still match, returning
 *  them when .select() asks, as PostgREST does. */
function memoryDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; payload: Row; filters: Filter[] }> = [];
  const from = (table: string) => {
    let op: 'select' | 'update' = 'select';
    let payload: Row = {};
    let wantRows = false, single = false;
    const filters: Filter[] = [];
    const matches = (r: Row) => filters.every(([m, c, v]) => (m === 'eq' ? r[c] === v : m === 'is' ? (v === null ? r[c] == null : r[c] === v) : m === 'neq' ? r[c] !== v : true));
    const run = () => {
      const rows = (tables[table] ??= []).filter(matches);
      if (op === 'update') {
        for (const r of rows) Object.assign(r, payload);
        writes.push({ table, payload, filters: [...filters] });
        return { data: wantRows ? rows.map((r) => ({ ...r })) : null, error: null };
      }
      return { data: single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r })), error: null };
    };
    const q: Record<string, unknown> = {};
    const chain = (fn: () => void) => () => { fn(); return q; };
    Object.assign(q, {
      select: (..._a: unknown[]) => { if (op === 'update') wantRows = true; return q; },
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return q; },
      neq: (c: string, v: unknown) => { filters.push(['neq', c, v]); return q; },
      is: (c: string, v: unknown) => { filters.push(['is', c, v]); return q; },
      in: () => q, order: () => q, limit: () => q, gt: () => q, gte: () => q, range: () => q,
      maybeSingle: chain(() => { single = true; }),
      single: chain(() => { single = true; }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
    });
    return q;
  };
  return { client: { from, auth: { getUser: async () => ({ data: { user: { id: 'owner-1', email: 'owner@bakery.test' } } }) } }, writes, tables };
}

const shared = vi.hoisted(() => ({ db: null as null | ReturnType<typeof memoryDb>, edge: [] as Array<Record<string, unknown>>, sweep: null as unknown }));
vi.mock('../persistence/supabase/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getSupabaseClient: () => shared.db!.client,
  callEdgeFunction: vi.fn(async (_fn: string, body: Record<string, unknown>) => { shared.edge.push(body); return shared.sweep; }),
}));

const { ProposalService, PROPOSAL_BEING_DECIDED, CLAIM_LAPSES_MS } = await import('../ui/services/ProposalService.js');
const { useAutonomySettings } = await import('../ui/components/ideation/useAutonomySettings.js');
const { assembleQueueItems, useApprovalsQueue } = await import('../ui/components/ideation/useApprovalsQueue.js');
const { ApprovalsWaiting } = await import('../ui/components/ideation/ApprovalsQueue.js');
const { sweepLine } = await import('../ui/services/autoSweep.js');

const P = 'a2400000-0000-4000-8000-0000000000f1';
const proposalRow = (over: Row = {}): Row => ({
  id: 'prop-1', status: 'pending', reviewed_at: null, source_branch_id: 'b1', created_at: '2026-10-05T10:00:00Z',
  patches: [{ patch: { type: 'add_node', metadata: { id: 'x' }, payload: { id: 'n1', type: 'backend-service', label: 'API' } }, status: 'pending' }],
  metadata: { source: 'mcp-server' }, ...over,
});

/** The service over the in-memory database; the accept reads the proposal and its branch through the repositories. */
function service(db: ReturnType<typeof memoryDb>) {
  const persistence = {
    getSupabaseClient: () => db.client,
    getProposalRepository: () => ({
      getById: async (id: string) => {
        const r = db.tables.ai_proposals.find((p) => p.id === id);
        return { success: true, data: r ? { id: r.id, sourceBranchId: r.source_branch_id, status: r.status, patches: r.patches, metadata: r.metadata } : null };
      },
    }),
    getBranchRepository: () => ({ getById: async () => ({ success: true, data: { id: 'b1', projectId: P } }) }),
  };
  return new ProposalService(persistence as never);
}

beforeEach(() => { shared.edge = []; shared.sweep = null; });

describe('AL.24 the app decides only what it holds', () => {
  it('a reject while Auto holds the proposal is refused and writes nothing; the server finishes it', async () => {
    const db = memoryDb({ ai_proposals: [proposalRow({ reviewed_at: new Date().toISOString() })] });
    await expect(service(db).rejectProposal('prop-1', 'not this')).rejects.toThrow(PROPOSAL_BEING_DECIDED);
    expect(db.tables.ai_proposals[0].status).toBe('pending');
    expect(db.writes.filter((w) => 'status' in w.payload)).toEqual([]);
  });

  it('a reject of one Auto already applied says so, and changes nothing', async () => {
    const db = memoryDb({ ai_proposals: [proposalRow({ status: 'merged', reviewed_at: '2026-10-05T10:00:01Z' })] });
    await expect(service(db).rejectProposal('prop-1', 'not this')).rejects.toThrow('This proposal is already applied: it was decided meanwhile.');
    expect(db.tables.ai_proposals[0].status).toBe('merged');
  });

  it('a reject of a free proposal takes it, then rejects it with the reason, under its own claim', async () => {
    const db = memoryDb({ ai_proposals: [proposalRow()] });
    await service(db).rejectProposal('prop-1', 'wrong node');
    const row = db.tables.ai_proposals[0];
    expect([row.status, (row.metadata as Row).resolveNote, (row.metadata as Row).resolvedBy]).toEqual(['rejected', 'wrong node', 'app']);
    const [claim, decision] = db.writes;
    expect(claim.filters).toContainEqual(['is', 'reviewed_at', null]);
    expect(decision.filters).toContainEqual(['eq', 'reviewed_at', claim.payload.reviewed_at]);
  });

  it('a claim left by a decider that died lapses after five minutes', async () => {
    const db = memoryDb({ ai_proposals: [proposalRow({ reviewed_at: new Date(Date.now() - CLAIM_LAPSES_MS - 1000).toISOString() })] });
    await service(db).rejectProposal('prop-1', 'stale claim');
    expect(db.tables.ai_proposals[0].status).toBe('rejected');
  });

  it('an accept while Auto holds the proposal is refused before anything is written, the person\'s choices included', async () => {
    const db = memoryDb({ ai_proposals: [proposalRow({ reviewed_at: new Date().toISOString() })] });
    const decided = [{ patch: (proposalRow().patches as Row[])[0].patch, status: 'approved' }];
    const held = db.tables.ai_proposals[0].reviewed_at;
    await expect(service(db).acceptProposal('prop-1', decided as never)).rejects.toThrow(PROPOSAL_BEING_DECIDED);
    const row = db.tables.ai_proposals[0];
    expect([row.status, row.reviewed_at, row.patches]).toEqual(['pending', held, proposalRow().patches]);
    // the one write tried is the claim, and it matched nothing
    expect(db.writes.map((w) => Object.keys(w.payload))).toEqual([['reviewed_at']]);
  });

  it('an accept that fails lets the proposal go, so Auto or the person can decide it again; the choices were written under the claim', async () => {
    const db = memoryDb({ ai_proposals: [proposalRow()] });
    const rejectedAll = [{ patch: (proposalRow().patches as Row[])[0].patch, status: 'rejected' }];
    await expect(service(db).acceptProposal('prop-1', rejectedAll as never)).rejects.toThrow('No patches to apply');
    const row = db.tables.ai_proposals[0];
    expect([row.status, row.reviewed_at]).toEqual(['pending', null]);
    expect(row.patches).toEqual(rejectedAll);
    const choices = db.writes.find((w) => 'patches' in w.payload)!;
    expect(choices.filters).toContainEqual(['eq', 'status', 'pending']);
    expect(choices.filters.some(([m, c]) => m === 'eq' && c === 'reviewed_at')).toBe(true);
  });

  it('a reject whose write fails lets the proposal go, so it is not held for five minutes', async () => {
    const db = memoryDb({ ai_proposals: [proposalRow()] });
    const from = db.client.from;
    const failing = {
      ...db.client,
      from: (t: string) => {
        const q = from(t) as Record<string, unknown> & { update: (p: Row) => unknown };
        const update = q.update;
        q.update = (p: Row) => {
          if (p.status !== 'rejected') return update(p);
          const fail: Record<string, unknown> = { eq: () => fail, select: () => fail, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'network down' } }).then(res) };
          return fail;
        };
        return q;
      },
    };
    await expect(service({ ...db, client: failing } as never).rejectProposal('prop-1', 'wrong node')).rejects.toThrow('network down');
    expect([db.tables.ai_proposals[0].status, db.tables.ai_proposals[0].reviewed_at]).toEqual(['pending', null]);
  });

  // The accept's steps under its claim (its full run is driven in ag13-ports-out with these stubbed).
  type ClaimSteps = { renewClaim(id: string, c: { at: string }): Promise<boolean>; markMergedUnderClaim(id: string, at: string): Promise<void> };

  it('the claim moves forward before the writes only while this accept holds it', async () => {
    const mine = '2026-10-05T10:00:00.000Z';
    const db = memoryDb({ ai_proposals: [proposalRow({ reviewed_at: mine })] });
    const claim = { at: mine };
    expect(await (service(db) as unknown as ClaimSteps).renewClaim('prop-1', claim)).toBe(true);
    expect(claim.at).not.toBe(mine);
    expect(db.tables.ai_proposals[0].reviewed_at).toBe(claim.at);

    // it lapsed and another decider took it: the accept stops, their claim stands
    const theirs = new Date().toISOString();
    const db2 = memoryDb({ ai_proposals: [proposalRow({ reviewed_at: theirs })] });
    const lost = { at: mine };
    expect(await (service(db2) as unknown as ClaimSteps).renewClaim('prop-1', lost)).toBe(false);
    expect([lost.at, db2.tables.ai_proposals[0].reviewed_at]).toEqual([mine, theirs]);
  });

  it('the accept marks the proposal merged only under its own claim, never over a decision made meanwhile', async () => {
    const mine = '2026-10-05T10:00:00.000Z';
    const db = memoryDb({ ai_proposals: [proposalRow({ reviewed_at: mine })] });
    await (service(db) as unknown as ClaimSteps).markMergedUnderClaim('prop-1', mine);
    expect(db.tables.ai_proposals[0].status).toBe('merged');

    // a reject written without the claim (an app tab from before AL.24) landed mid-accept
    const db2 = memoryDb({ ai_proposals: [proposalRow({ status: 'rejected', reviewed_at: '2026-10-05T10:00:05.000Z' })] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await (service(db2) as unknown as ClaimSteps).markMergedUnderClaim('prop-1', mine);
    warn.mockRestore();
    expect([db2.tables.ai_proposals[0].status, db2.tables.ai_proposals[0].reviewed_at]).toEqual(['rejected', '2026-10-05T10:00:05.000Z']);
  });
});

describe('AL.24 the toggle asks the server to apply the backlog', () => {
  it('raising a lane to Auto runs the sweep once and says what it applied; lowering one never does', async () => {
    shared.db = memoryDb({ projects: [{ id: P, automation_policy: {}, metadata: {} }] });
    shared.sweep = { success: true, data: { applied: [{ proposalId: 'a', plane: 'canvas' }, { proposalId: 'b', plane: 'spec' }], waiting: [{ proposalId: 'c', reason: 'x' }], setAside: [], busy: [], plans: [{ planId: 'p', status: 'accepted' }] } };
    const { result } = renderHook(() => useAutonomySettings(P));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setLane('architecture', 2); });
    expect(shared.edge).toEqual([{ tool: 'resolve_proposal', arguments: { project_id: P, action: 'auto' } }]);
    expect(result.current.sweepNote).toBe('Auto applied 3 waiting proposals.');
    expect(shared.db.tables.projects[0].automation_policy).toEqual({ architecture: 2 });
    await act(async () => { await result.current.setLane('architecture', 1); });
    expect(shared.edge.length).toBe(1);
  });

  it('a refused save runs no sweep', async () => {
    shared.db = memoryDb({ projects: [] });
    const { result } = renderHook(() => useAutonomySettings(P));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setLane('tasks', 2); await result.current.setLane('candidates', 2); });
    expect(shared.edge).toEqual([]);
  });

  it('the sweep\'s line: what applied, what was set aside, nothing when nothing changed', () => {
    const none = { applied: [], waiting: [{ proposalId: 'c', reason: 'x' }], setAside: [], busy: [], plans: [] };
    expect(sweepLine(none)).toBeNull();
    expect(sweepLine(null)).toBeNull();
    expect(sweepLine({ ...none, applied: [{ proposalId: 'a', plane: 'canvas' }], setAside: [{ proposalId: 's', reason: 'stale' }] }))
      .toBe('Auto applied 1 waiting proposal. 1 could not apply and was set aside; its agent reads why.');
  });
});

describe('AL.24 a proposal that waits under Auto says why', () => {
  it('the card carries the server\'s reason while it waits, and drops it once decided', () => {
    const labels = { requirements: new Map(), nodes: new Map(), workflows: new Map(), steps: new Map(), candidates: new Map() } as never;
    const waiting = proposalRow({ metadata: { source: 'mcp-server', autoWait: { reason: 'Its agent may only propose: the key it used may only propose.', at: 'x' } } });
    const decided = proposalRow({ id: 'prop-2', status: 'merged', metadata: { autoWait: { reason: 'old' }, auto: true } });
    const items = assembleQueueItems([waiting, decided] as never, labels);
    expect(items.map((i) => [i.proposalId, i.autoWait])).toEqual([['prop-1', 'Its agent may only propose: the key it used may only propose.'], ['prop-2', null]]);
    const queue = { items, pending: 1, loading: false, error: null, busyId: null, nextRequirementRef: null, refresh: vi.fn(), resolve: vi.fn() };
    const { getByTestId } = renderCanvas(<ApprovalsWaiting queue={queue as never} />);
    expect(getByTestId('approval-autowait').textContent).toBe('Waits for you under Auto: Its agent may only propose: the key it used may only propose.');
  });
});

describe('AL.24 a mapping and a candidate are decided once', () => {
  it('a move lands only while the mapping still needs review; an accepted candidate leaves the queue', async () => {
    shared.db = memoryDb({
      branches: [{ id: 'b1', project_id: P }], ai_proposals: [],
      project_specifications: [{ id: 'spec-1', project_id: P }],
      requirement_candidates: [
        { id: 'c-open', project_id: P, status: 'pending', kind: 'api', key: 'api:n1', name: 'Orders API', description: null, node_id: 'n1', criteria: [], evidence: {}, requirement_row_id: null, created_at: '2026-10-05T09:00:00Z' },
        { id: 'c-taken', project_id: P, status: 'pending', kind: 'api', key: 'api:n2', name: 'Stock API', description: null, node_id: 'n2', criteria: [], evidence: {}, requirement_row_id: 'r9', created_at: '2026-10-05T09:00:00Z' },
      ],
      specification_mappings: [{ id: 'm1', specification_id: 'spec-1', requirement_id: 'r1', node_id: 'n1', notes: null, confidence: 0.6, created_at: '2026-10-05T10:00:00Z', validation_status: 'needs-review' }],
    });
    const { result } = renderHook(() => useApprovalsQueue(P, { workflows: true, priority: false, repoImport: true }));
    await waitFor(() => expect(result.current.items.some((i) => i.proposalId === 'm1')).toBe(true));
    // an accepted candidate (it derived its requirement) is not offered again
    expect(result.current.items.filter((i) => i.source === 'candidate').map((i) => i.proposalId)).toEqual(['c-open']);
    // a teammate confirms it first
    shared.db.tables.specification_mappings[0].validation_status = 'valid';
    let out: { ok: boolean; error?: string } = { ok: true };
    await act(async () => { out = await result.current.resolve('m1', 'move', { nodeId: 'n2' }); });
    expect(out).toEqual({ ok: false, error: 'This mapping was already decided. Look again to see how.' });
    expect(shared.db.tables.specification_mappings[0].node_id).toBe('n1');
  });
});

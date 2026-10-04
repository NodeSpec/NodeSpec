// @vitest-environment jsdom
//
// Q (owner 2026-09-22): Free and Community see and use only what their plan
// carries. The Work surface's render tests pin what shows; these pin what is
// READ, hook by hook, against a recording Supabase client: below the plan a
// paid table is never asked for (the database would refuse a write anyway,
// scripts/db-lane/068), and what is on hand never leaks across a project or
// plan switch. The Git modal's import section has no render harness here and
// is pinned by source; the walkthrough's stops by plan run in walkthrough.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Call = { table: string; chain: Array<[string, unknown[]]> };
const db = vi.hoisted(() => ({ calls: [] as Call[], data: {} as Record<string, unknown> }));
vi.mock('../persistence/supabase/client.js', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const query = (call: Call): unknown => {
    const proxy: unknown = new Proxy({}, {
      get(_t, key) {
        if (key === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: db.data[call.table] ?? null, error: null }).then(res, rej);
        }
        return (...args: unknown[]) => { call.chain.push([String(key), args]); return proxy; };
      },
    });
    return proxy;
  };
  return {
    ...real,
    getSupabaseClient: () => ({
      from: (table: string) => { const call: Call = { table, chain: [] }; db.calls.push(call); return query(call); },
      auth: { getUser: async () => ({ data: { user: null } }) },
    }),
    callEdgeFunction: vi.fn(async () => ({ success: true })),
  };
});

const { useApprovalsQueue, queuePlanFrom, shapesWorkflow, touchesConstraint } = await import('../ui/components/ideation/useApprovalsQueue.js');
const { useWorkflowLanes } = await import('../ui/components/ideation/useWorkflowLanes.js');
const { useNodeItems } = await import('../ui/components/panels/useNodeItems.js');
const { featureAllowed } = await import('../ui/config/feature-rules.js');

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const tables = () => db.calls.map((c) => c.table);
const P = 'bf000000-0000-4000-8000-000000000001';

const workflowProposal = { id: 'wf-1', source_branch_id: 'b1', status: 'pending', created_at: '2026-09-22T10:00:00Z', reviewed_at: null, metadata: {}, patches: [{ patch: { type: 'upsert_workflow', payload: { id: 'w1', name: 'Checkout' } } }] };
// AC: a constraint filed while the owner was on Indie, still pending after a downgrade
const constraintProposal = { id: 'cn-1', source_branch_id: 'b1', status: 'pending', created_at: '2026-09-22T08:00:00Z', reviewed_at: null, metadata: {}, patches: [{ patch: { type: 'create_constraint', payload: { ctype: 'cost', description: 'Under 40 dollars a month' } } }] };
const requirementProposal = { id: 'rq-1', source_branch_id: 'b1', status: 'pending', created_at: '2026-09-22T09:00:00Z', reviewed_at: null, metadata: {}, patches: [{ patch: { type: 'update_requirement', payload: { requirementId: 'REQ-001', changes: { name: 'x' } } } }] };

beforeEach(() => {
  db.calls.length = 0;
  db.data = { branches: [{ id: 'b1' }], ai_proposals: [workflowProposal, requirementProposal, constraintProposal] };
});

describe('Q · the queue reads only the lanes the plan carries', () => {
  it('the plan from the gate: every paid lane off while loading or below it', () => {
    const gate = (plan: 'community' | 'indie', loading = false) => ({ loading, can: (f: Parameters<typeof featureAllowed>[1]) => featureAllowed(plan, f) });
    const none = { workflows: false, priority: false, repoImport: false };
    expect(queuePlanFrom(gate('community'))).toEqual({ ...none, viewOnly: none });
    expect(queuePlanFrom(gate('indie', true))).toEqual({ ...none, viewOnly: none });
    expect(queuePlanFrom(gate('indie'))).toEqual({ workflows: true, priority: true, repoImport: true, viewOnly: none });
    expect(shapesWorkflow(workflowProposal.patches)).toBe(true);
    expect(shapesWorkflow(requirementProposal.patches)).toBe(false);
    expect(shapesWorkflow(null)).toBe(false);
    expect(touchesConstraint(constraintProposal.patches)).toBe(true);
    expect(touchesConstraint([{ patch: { type: 'delete_constraint', payload: {} } }])).toBe(true);
    expect(touchesConstraint(requirementProposal.patches)).toBe(false);
    expect(touchesConstraint(null)).toBe(false);
  });

  it('Community: no plan, no import leftovers, no workflow or constraint proposals or their names', async () => {
    const { result } = renderHook(() => useApprovalsQueue(P, { workflows: false, priority: false, repoImport: false }));
    await waitFor(() => expect(tables()).toContain('project_specifications'));
    for (const paid of ['work_plans', 'work_plan_items', 'import_jobs', 'workflows', 'workflow_steps']) expect(tables(), paid).not.toContain(paid);
    // the only candidate read would be the import's (kind other than outcome): not made
    expect(db.calls.filter((c) => c.table === 'requirement_candidates' && c.chain.some(([m, a]) => m === 'neq' && a[0] === 'kind'))).toEqual([]);
    await waitFor(() => expect(result.current.items.map((i) => i.proposalId)).toEqual(['rq-1']));
    expect(tables()).not.toContain('project_constraints');
  });

  it('Indie: the same queue reads every lane and shows the workflow and constraint proposals', async () => {
    const { result } = renderHook(() => useApprovalsQueue(P));
    await waitFor(() => expect(tables()).toContain('work_plans'));
    // AL.21: the import's open questions show on their node in Architecture,
    // never under Proposals, so the queue does not read the import job
    expect(tables()).not.toContain('import_jobs');
    expect(tables()).toContain('workflows');
    await waitFor(() => expect(result.current.items.map((i) => i.proposalId).sort()).toEqual(['cn-1', 'rq-1', 'wf-1']));
  });

  // AJ.6: the account's example on Free reads every lane, and its workflow and
  // constraint proposals take no act; the rest stay the owner's to decide.
  it('AJ.6: the example below Indie shows the workflow and constraint proposals, view only', async () => {
    const all = { workflows: true, priority: true, repoImport: true };
    const { result } = renderHook(() => useApprovalsQueue(P, { ...all, viewOnly: all }));
    await waitFor(() => expect(result.current.items.map((i) => i.proposalId).sort()).toEqual(['cn-1', 'rq-1', 'wf-1']));
    const by = new Map(result.current.items.map((i) => [i.proposalId, i]));
    expect([by.get('wf-1')!.viewOnly, by.get('wf-1')!.acts]).toEqual(['workflow_space', []]);
    expect([by.get('cn-1')!.viewOnly, by.get('cn-1')!.acts]).toEqual(['workflow_space', []]);
    expect(by.get('rq-1')!.viewOnly).toBeUndefined();
    expect(by.get('rq-1')!.acts).toBeUndefined();
  });
});

describe('Q · the lanes hook never reports stale lanes as loaded', () => {
  it('switching from no project to a project is loading in that same render, and the old lanes are not on hand', async () => {
    db.data = { workflows: [{ id: 'w1', name: 'Checkout', kind: 'workflow', color: null, owner_label: null, contributors: [], sort_order: 0 }], workflow_steps: [] };
    const seen: Array<{ project: string | null; loading: boolean; lanes: number }> = [];
    const { rerender, result } = renderHook(({ project }: { project: string | null }) => {
      const api = useWorkflowLanes(project);
      seen.push({ project, loading: api.loading, lanes: api.lanes.length });
      return api;
    }, { initialProps: { project: null as string | null } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(tables()).not.toContain('workflows');
    rerender({ project: P });
    expect(seen.find((s) => s.project === P)!.loading).toBe(true);
    await waitFor(() => expect(result.current.lanes.length).toBe(1));
    // and back to no project (a plan without Workflows): the lanes are gone in the first render
    const at = seen.length;
    rerender({ project: null });
    expect(seen[at]).toEqual({ project: null, loading: true, lanes: 0 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lanes).toEqual([]);
  });
});

describe('Q · a node reads the import only on a plan with repo import', () => {
  it('below it: outcomes only, and no import job', async () => {
    const { result } = renderHook(() => useNodeItems(P, 'n1', false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(tables()).not.toContain('import_jobs');
    const cand = db.calls.find((c) => c.table === 'requirement_candidates')!;
    expect(cand.chain).toContainEqual(['eq', ['kind', 'outcome']]);
  });

  it('with it: the import job and every candidate kind', async () => {
    const { result } = renderHook(() => useNodeItems(P, 'n1', true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(tables()).toContain('import_jobs');
    expect(db.calls.find((c) => c.table === 'requirement_candidates')!.chain).not.toContainEqual(['eq', ['kind', 'outcome']]);
  });
});

describe('Q · the chrome without a render harness here', () => {
  it('the Git modal watches no job and shows no import section below Indie, and fails closed without a gate', () => {
    const modal = read('src/ui/components/panels/GitIntegrationModal.tsx');
    expect(modal).toContain("const canImport = !!featureGate && !featureGate.loading && featureGate.can('repo_import') && !featureGate.viewOnly?.('repo_import');");
    expect(modal).toContain('if (!integration || !canImport) { setImportJob(null); return; }');
    expect(modal).toContain('{canImport && <McpImportSection job={importJob} proposalStatus={importProposalStatus} intent={importIntent} />}');
    // AL.21: the import intent's status read is behind the same gate
    expect(modal).toContain('if (!isOpen || !integration || !canImport) { setIntent(null); return; }');
  });

  it('the Changes panel reads its queue by plan too', () => {
    expect(read('src/ui/components/panels/ChangesPanel.tsx')).toContain('useApprovalsQueue(projectId, queuePlanFrom(gate))');
  });
});

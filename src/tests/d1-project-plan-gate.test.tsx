// @vitest-environment jsdom
//
// V3 decision 1 (owner ruling 2026-09-26): inside a project, what the project
// carries follows its owner's plan, for everyone seated on it; what is the
// person's (the project count, the agent allowance) follows their own. Seats
// exist on Team and above only: a seat held on a project below Team reaches
// nothing (the database answers no plan for it, lane 088), so the cases here
// are a seat on Team or above, and the owner on their own project.
//
// The app half, driven through the real hooks (useProjectFeatureGate and
// useVariant over the real useFeatureGate): the person's own subscription
// comes from the subscription service, the project's plan from the
// database's answer to project_plan_tier, both stubbed only at those seams.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const world = vi.hoisted(() => ({
  ownPlan: 'community' as string,
  projectPlans: {} as Record<string, string | null>,
  rpcError: false,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

vi.mock('../ui/context/ServiceContext.js', () => {
  const auth = { getSession: async () => ({ user: { id: 'person-1' }, session: { access_token: 't' } }) };
  const subscription = {
    getCurrentSubscription: async () => ({ planName: world.ownPlan, status: 'active' }),
    ensureFreeCustomer: async () => true,
    syncFromStripe: async () => undefined,
  };
  return { useAuth: () => auth, useSubscription: () => subscription };
});

vi.mock('../persistence/supabase/client.js', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    getSupabaseClient: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        world.rpcCalls.push({ fn, args });
        if (world.rpcError) return { data: null, error: { message: 'permission denied' } };
        return { data: world.projectPlans[String(args.p_project_id)] ?? null, error: null };
      },
    }),
  };
});

const TEAM_PROJECT = 'p-team';
const FREE_PROJECT = 'p-free';

async function load(edition: string) {
  vi.stubEnv('VITE_NODESPEC_EDITION', edition);
  vi.stubEnv('VITE_NODESPEC_TEST_TIER', '');
  vi.resetModules();
  const gate = await import('../ui/hooks/useProjectFeatureGate.js');
  const variant = await import('../ui/hooks/useVariant.js');
  gate.forgetProjectPlans();
  return { useProjectFeatureGate: gate.useProjectFeatureGate, useVariant: variant.useVariant };
}

beforeEach(() => {
  world.ownPlan = 'community';
  world.projectPlans = { [TEAM_PROJECT]: 'team', [FREE_PROJECT]: 'community' };
  world.rpcError = false;
  world.rpcCalls = [];
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('decision 1 in the app: the project gate', () => {
  it('a Free person seated on a Team project gets what the project carries, and keeps their own allowance', async () => {
    const { useProjectFeatureGate } = await load('hosted');
    const { result } = renderHook(() => useProjectFeatureGate(TEAM_PROJECT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.can('workflow_space')).toBe(true);
    expect(result.current.can('priority_board')).toBe(true);
    expect(result.current.can('repo_import')).toBe(true);
    expect(result.current.can('unlimited_projects')).toBe(false);
    expect(world.rpcCalls.filter((c) => c.fn === 'project_plan_tier')).toEqual([{ fn: 'project_plan_tier', args: { p_project_id: TEAM_PROJECT } }]);
  });

  it('above Team the project still decides: a Government person seated on a Team project does not bring classification into it, and keeps their own allowance', async () => {
    world.ownPlan = 'government';
    const { useProjectFeatureGate } = await load('hosted');
    const { result } = renderHook(() => useProjectFeatureGate(TEAM_PROJECT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.can('classification')).toBe(false);
    expect(result.current.can('workflow_space')).toBe(true);
    expect(result.current.can('unlimited_projects')).toBe(true);
  });

  it('switching projects re-reads: the gate never carries one project\'s plan into the next', async () => {
    const { useProjectFeatureGate } = await load('hosted');
    const { result, rerender } = renderHook(({ id }: { id: string }) => useProjectFeatureGate(id), { initialProps: { id: TEAM_PROJECT } });
    await waitFor(() => expect(result.current.can('workflow_space')).toBe(true));
    rerender({ id: FREE_PROJECT });
    expect(result.current.can('workflow_space')).toBe(false);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.can('workflow_space')).toBe(false);
  });

  it('with no project, or when the database gives no answer, the person\'s own plan decides', async () => {
    world.ownPlan = 'indie';
    const { useProjectFeatureGate } = await load('hosted');
    const none = renderHook(() => useProjectFeatureGate(null));
    await waitFor(() => expect(none.result.current.loading).toBe(false));
    expect(none.result.current.can('workflow_space')).toBe(true);
    expect(world.rpcCalls).toEqual([]);

    world.rpcError = true;
    const failed = renderHook(() => useProjectFeatureGate(TEAM_PROJECT));
    await waitFor(() => expect(failed.result.current.loading).toBe(false));
    expect(failed.result.current.can('workflow_space')).toBe(true);
    expect(failed.result.current.can('priority_board')).toBe(true);
    expect(failed.result.current.plan).toBe('indie');
  });

  it('a self-hosted build never asks the database: its licence is the plan', async () => {
    const { useProjectFeatureGate } = await load('enterprise');
    const { result } = renderHook(() => useProjectFeatureGate(TEAM_PROJECT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    // AJ.6: only whether it is the account's example, which every build asks
    expect(world.rpcCalls.filter((c) => c.fn !== 'is_example_project')).toEqual([]);
  });

  it('the presentation follows the project too, and is individual while the read is in flight', async () => {
    const { useVariant } = await load('hosted');
    const { result } = renderHook(() => useVariant(TEAM_PROJECT));
    expect(result.current).toEqual({ variant: 'individual', loading: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.variant).toBe('team');
    const own = renderHook(() => useVariant(null));
    await waitFor(() => expect(own.result.current.loading).toBe(false));
    expect(own.result.current.variant).toBe('individual');
  });
});

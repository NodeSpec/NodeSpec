// @vitest-environment jsdom
//
// Item 3 (owner 2026-09-26): "For licensed Enterprise (Team is a managed
// supabase just like Indie and Free), this should show NodeSpec Enterprise".
// A licensed container is NodeSpec Enterprise, or Government when its licence
// says so. The build gives it the name and the layout; its plan is the
// licence, which only the server verifies. Before this, the app read the
// Stripe subscription, which a container never has, and gated every licensed
// deployment as Free.
//
// Driven through the real hooks (useFeatureGate, useProjectFeatureGate) and
// the real MCP client (callMcpToolAsUser). The only stand-in is the MCP
// server's HTTP answer to list_api_keys, whose connections.tier is
// getEffectiveTier on the server: the verified licence on a container. That
// the signer issues Enterprise or Government only is driven in
// selfhost-bundle.test.ts, which stays in the private tree with the signer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const world = vi.hoisted(() => ({
  licence: 'enterprise' as string | null,
  serverDown: false,
  subscriptionReads: 0,
  rpcCalls: 0,
  requests: [] as Array<{ url: string; auth: string | null; body: { method?: string; params?: { name?: string } } }>,
}));

vi.mock('../ui/context/ServiceContext.js', () => {
  const auth = { getSession: async () => ({ user: { id: 'person-1' }, session: { access_token: 'session-token' } }) };
  const subscription = {
    getCurrentSubscription: async () => { world.subscriptionReads += 1; return null; },
    ensureFreeCustomer: async () => true,
    syncFromStripe: async () => undefined,
  };
  return { useAuth: () => auth, useSubscription: () => subscription };
});

vi.mock('../persistence/supabase/client.js', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  // AJ.6: whether the project is the account's example is asked on every build; the plan is what counts here
  return { ...real, getSupabaseClient: () => ({ rpc: async (fn: string) => { if (fn !== 'is_example_project') world.rpcCalls += 1; return { data: null, error: null }; } }) };
});

/** The MCP server, as far as the app can see it: its JSON-RPC answer to list_api_keys. */
function serveMcp(): void {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    world.requests.push({ url: String(url), auth: headers.get('Authorization'), body: JSON.parse(String(init.body)) });
    if (world.serverDown) throw new TypeError('fetch failed');
    const text = JSON.stringify({ apiKeys: [], connections: { tier: world.licence, used: 0, limit: 5 } });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
}

async function build(edition: string) {
  vi.stubEnv('VITE_NODESPEC_EDITION', edition);
  vi.stubEnv('VITE_NODESPEC_TEST_TIER', '');
  vi.stubEnv('VITE_MCP_PUBLIC_URL', 'https://nodespec.acme.internal/functions/v1/mcp-server');
  vi.resetModules();
  const licence = await import('../ui/services/licence-plan.js');
  licence.forgetLicencePlan();
  const gate = await import('../ui/hooks/useFeatureGate.js');
  const project = await import('../ui/hooks/useProjectFeatureGate.js');
  const edition_ = await import('../ui/config/edition.js');
  const variant = await import('../ui/config/variant.js');
  project.forgetProjectPlans();
  return { useFeatureGate: gate.useFeatureGate, useProjectFeatureGate: project.useProjectFeatureGate, edition: edition_, variant };
}

async function settled<T extends { loading: boolean }>(hook: () => T) {
  const r = renderHook(hook);
  await waitFor(() => expect(r.result.current.loading).toBe(false));
  return r.result;
}

beforeEach(() => {
  world.licence = 'enterprise';
  world.serverDown = false;
  world.subscriptionReads = 0;
  world.rpcCalls = 0;
  world.requests = [];
  serveMcp();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('item 3: the Enterprise build runs as the licence the server verified', () => {
  it('an Enterprise licence: the app is NodeSpec Enterprise, with every Enterprise feature and nothing of Government', async () => {
    const { useFeatureGate, edition, variant } = await build('enterprise');
    const gate = await settled(() => useFeatureGate());
    expect(gate.current.plan).toBe('enterprise');
    for (const f of ['workflow_space', 'repo_import', 'team_lanes', 'custom_catalog', 'self_host', 'unlimited_projects'] as const) {
      expect(gate.current.can(f), f).toBe(true);
    }
    expect(gate.current.can('classification')).toBe(false);
    expect(edition.editionLabel).toBe('Enterprise');
    expect(variant.resolveVariant(gate.current.plan)).toBe('team');
    // asked once, of the deployment's own MCP server, as the signed-in person
    expect(world.requests).toEqual([{
      url: 'https://nodespec.acme.internal/functions/v1/mcp-server',
      auth: 'Bearer session-token',
      body: expect.objectContaining({ method: 'tools/call', params: expect.objectContaining({ name: 'list_api_keys' }) }),
    }]);
    // a container has no billing rows, and the app no longer looks for them
    expect(world.subscriptionReads).toBe(0);
  });

  // Owner 2026-09-27: classification is the Government build's alone. The
  // Government build reads its licence as the Enterprise one does, and a
  // Government licence lights classification there and nowhere else.
  it('in the Government build a Government licence lights classification and the government catalog', async () => {
    world.licence = 'government';
    const { useFeatureGate } = await build('government');
    const gate = await settled(() => useFeatureGate());
    expect(gate.current.plan).toBe('government');
    expect(gate.current.can('classification')).toBe(true);
    expect(gate.current.can('gov_catalog')).toBe(true);
    expect(world.requests).toHaveLength(1);
  });

  it('in the Enterprise build a Government licence is the Government plan, and still no classification', async () => {
    world.licence = 'government';
    const { useFeatureGate } = await build('enterprise');
    const gate = await settled(() => useFeatureGate());
    expect(gate.current.plan).toBe('government');
    expect(gate.current.can('classification')).toBe(false);
    expect(gate.current.can('gov_catalog')).toBe(false);
    expect(gate.current.can('self_host')).toBe(true);
  });

  it('no valid licence: the server answers community, and so does the app', async () => {
    world.licence = 'community';
    const { useFeatureGate } = await build('enterprise');
    const gate = await settled(() => useFeatureGate());
    expect(gate.current.plan).toBe('community');
    expect(gate.current.can('workflow_space')).toBe(false);
  });

  it('a server that does not answer leaves the gate at community, and the next gate asks again', async () => {
    world.serverDown = true;
    const { useFeatureGate } = await build('enterprise');
    const first = await settled(() => useFeatureGate());
    expect(first.current.plan).toBe('community');
    world.serverDown = false;
    const second = await settled(() => useFeatureGate());
    expect(second.current.plan).toBe('enterprise');
    expect(world.requests).toHaveLength(2);
  });

  it('one read serves every gate on the page, the project gate included', async () => {
    const { useFeatureGate, useProjectFeatureGate } = await build('enterprise');
    const a = await settled(() => useFeatureGate());
    const b = await settled(() => useFeatureGate());
    const p = await settled(() => useProjectFeatureGate('project-1'));
    expect([a.current.plan, b.current.plan, p.current.plan]).toEqual(['enterprise', 'enterprise', 'enterprise']);
    expect(p.current.can('workflow_space')).toBe(true);
    expect(world.requests).toHaveLength(1);
    expect(world.rpcCalls).toBe(0); // the database holds no licence; it is not asked
  });

  it('the dev test-tier flag still decides over the licence and the subscription (the classification banner is exercised through it, in the Government build)', async () => {
    const government = await build('government');
    vi.stubEnv('VITE_NODESPEC_TEST_TIER', 'government');
    const g = await settled(() => government.useFeatureGate());
    expect(g.current.plan).toBe('government');
    expect(g.current.can('classification')).toBe(true);
    const enterprise = await build('enterprise');
    vi.stubEnv('VITE_NODESPEC_TEST_TIER', 'government');
    const e = await settled(() => enterprise.useFeatureGate());
    expect(e.current.plan).toBe('government');
    expect(e.current.can('classification')).toBe(false);
    const hosted = await build('hosted');
    vi.stubEnv('VITE_NODESPEC_TEST_TIER', 'government');
    const h = await settled(() => hosted.useFeatureGate());
    expect(h.current.plan).toBe('government');
  });

  it('the hosted app and the OSS container never ask for a licence', async () => {
    const hosted = await build('hosted');
    const h = await settled(() => hosted.useFeatureGate());
    expect(h.current.plan).toBe('community');
    expect(world.subscriptionReads).toBeGreaterThan(0); // the hosted plan is the subscription
    const oss = await build('');
    const o = await settled(() => oss.useFeatureGate());
    expect(o.current.plan).toBe('community');
    expect(oss.edition.editionLabel).toBe('OSS Community');
    expect(world.requests).toEqual([]);
  });
});

// P0-8: pins getUserTier's plan-name -> tier mapping (extracted from mcp-server).
import { getUserTier } from '../_shared/user-tier.ts';
import { assertEquals } from './helpers.ts';

function clientReturning(row: { plan_name?: string | null; status?: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: row }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

Deno.test('plan-name mapping: canonical, legacy aliases, decorated, none', async () => {
  // Canonical vocabulary passes through
  assertEquals(await getUserTier(clientReturning({ plan_name: 'team' }), 'u'), 'team');
  assertEquals(await getUserTier(clientReturning({ plan_name: 'indie' }), 'u'), 'indie');
  assertEquals(await getUserTier(clientReturning({ plan_name: 'community' }), 'u'), 'community');
  // Legacy V1 names resolve to their successors (pre-backfill rows, decorated values)
  assertEquals(await getUserTier(clientReturning({ plan_name: 'pro' }), 'u'), 'team');
  assertEquals(await getUserTier(clientReturning({ plan_name: 'Pro Annual' }), 'u'), 'team');
  assertEquals(await getUserTier(clientReturning({ plan_name: 'architect' }), 'u'), 'team');
  assertEquals(await getUserTier(clientReturning({ plan_name: 'starter' }), 'u'), 'team');
  assertEquals(await getUserTier(clientReturning({ plan_name: 'free' }), 'u'), 'community');
  // No row / empty / sentinel → community
  assertEquals(await getUserTier(clientReturning({ plan_name: '' }), 'u'), 'community');
  assertEquals(await getUserTier(clientReturning(null), 'u'), 'community');
  assertEquals(await getUserTier(clientReturning({ plan_name: 'pending' }), 'u'), 'community');
});

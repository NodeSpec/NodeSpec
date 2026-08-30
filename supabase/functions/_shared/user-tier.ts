/*
  P0-8: getUserTier extracted verbatim from mcp-server/index.ts so the plan-name -> tier
  mapping is testable (mcp-server's module top-level Deno.serve blocks importing it).

  The client is a structural parameter (no jsr import) — pure module, offline-testable.
*/
import type { PlanTier } from './tiers.ts';
import { canonicalizeTier } from './tiers.ts';

interface SubscriptionQueryClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        in(column: string, values: string[]): {
          order(column: string, opts: { ascending: boolean }): {
            limit(n: number): {
              maybeSingle(): Promise<{ data: { plan_name?: string | null; status?: string } | null }>;
            };
          };
        };
      };
    };
  };
}

export async function getUserTier(supabase: SubscriptionQueryClient, userId: string): Promise<PlanTier> {
  const { data } = await supabase
    .from('stripe_subscriptions')
    .select('plan_name, status')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle();

  // One shared resolver for canonical AND legacy plan_name values — the old
  // hand-rolled substring ladder here had drifted from the client's
  // exact-equality version; canonicalizeTier is now the single behavior.
  return canonicalizeTier(data?.plan_name) ?? 'community';
}

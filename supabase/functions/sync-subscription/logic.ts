/*
  P0-8: sync-subscription's reconciliation core — plan resolution (via the now-shared
  fallback resolver) and the upsert row construction — extracted verbatim from index.ts
  so it is testable. index.ts keeps auth, the admin gate plumbing, and the DB/Stripe
  side effects.
*/
import { resolvePlanInfoWithFallbacks } from '../_shared/stripe-plans.ts';

// deno-lint-ignore-file no-explicit-any

export interface SyncComputation {
  planName: string;
  status: string;
  upsertData: Record<string, unknown>;
}

export function buildSyncUpsert(
  syncUserId: string,
  customerId: string,
  subscription: any,
): SyncComputation {
  const price = subscription.items.data[0]?.price;
  const priceId = price?.id ?? '';
  const planInfo = price ? resolvePlanInfoWithFallbacks(price) : { name: 'unknown', tokenLimit: 0, amountCents: 0 };
  const billingInterval = price?.recurring?.interval === 'year' ? 'year' : 'month';

  const upsertData: Record<string, unknown> = {
    user_id: syncUserId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    plan_name: planInfo.name,
    amount_cents: planInfo.amountCents,
    currency: subscription.currency,
    status: subscription.status,
    price_id: priceId,
    billing_interval: billingInterval,
    token_limit: planInfo.tokenLimit,
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    cancel_at_period_end: subscription.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };

  if (subscription.default_payment_method && typeof subscription.default_payment_method !== 'string') {
    upsertData.payment_method_brand = subscription.default_payment_method.card?.brand ?? null;
    upsertData.payment_method_last4 = subscription.default_payment_method.card?.last4 ?? null;
  }

  return { planName: planInfo.name, status: subscription.status, upsertData };
}

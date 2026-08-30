/*
  P0-8: stripe-webhook event handling, extracted verbatim from index.ts so it is testable
  under deno test (index.ts reads env and calls Deno.serve at module load, which blocks
  importing it). Dependencies are structural parameters — this module imports nothing but
  the shared plan mapping, so tests run offline against the real shipped logic.

  index.ts keeps: env reads, real Stripe/Supabase client construction, signature
  verification, Deno.serve.
*/
// N6.1: TOKEN_ADDON_* imports left with handleOneTimePayment (token-addon purchasing
// retired). The stripe-plans module keeps them for the subscription plan table.
import { resolvePlanInfoStrict } from '../_shared/stripe-plans.ts';
import { canonicalizeTier } from '../_shared/tiers.ts';

// Structural slices of the Stripe SDK and Supabase client actually used here.
// deno-lint-ignore-file no-explicit-any
export interface WebhookDeps {
  stripe: {
    subscriptions: { list(params: Record<string, unknown>): Promise<{ data: any[] }> };
    checkout: { sessions: { listLineItems(id: string, params: Record<string, unknown>): Promise<{ data: any[] }> } };
  };
  supabase: any;
}

export interface StripeEventLike {
  id: string;
  type: string;
  data?: { object?: Record<string, unknown> };
}

export const SUBSCRIPTION_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);

export async function handleEvent(deps: WebhookDeps, event: StripeEventLike) {
  console.info(`Processing webhook event: ${event.type}`);

  const stripeData: Record<string, unknown> = event?.data?.object ?? {};

  if (!stripeData || !('customer' in stripeData)) {
    console.info(`Ignoring event ${event.type}: no customer field`);
    return;
  }

  if (event.type === 'payment_intent.succeeded' && (stripeData as any).invoice === null) {
    return;
  }

  const { customer: customerId } = stripeData;

  if (!customerId || typeof customerId !== 'string') {
    console.error(`No customer received on event: ${JSON.stringify(event)}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = stripeData as any;
    // N6.1: token-addon purchasing is retired (UI, client session-creator, and the
    // 'payment' checkout mode are all gone), so one-time payments are no longer
    // provisioned here. Subscription handling below is unchanged; the invoice.paid
    // token rollover stays (subscription-side accounting — D-series owns those tables).
    if (session.mode !== 'subscription') {
      console.info(`Ignoring non-subscription checkout for customer: ${customerId}`);
      return;
    }
  }

  if (event.type === 'invoice.paid') {
    await handleInvoicePaid(deps, customerId, stripeData as any, event.id);
  }

  if (SUBSCRIPTION_EVENTS.has(event.type) || event.type.startsWith('customer.subscription.')) {
    console.info(`Syncing subscription for customer: ${customerId} (event: ${event.type})`);
    await syncCustomerFromStripe(deps, customerId, event.id, event.type);
  }
}

async function resolveUserId(deps: WebhookDeps, customerId: string): Promise<string | null> {
  const { data: customerMapping } = await deps.supabase
    .from('stripe_customers')
    .select('user_id')
    .eq('customer_id', customerId)
    .maybeSingle();

  return customerMapping?.user_id ?? null;
}

async function expireStaleTokenEntries(deps: WebhookDeps, userId: string): Promise<void> {
  const now = new Date().toISOString();

  await deps.supabase
    .from('token_addons')
    .update({ status: 'expired' })
    .eq('user_id', userId)
    .eq('status', 'active')
    .lt('expires_at', now);

  await deps.supabase
    .from('token_rollover')
    .update({ status: 'expired' })
    .eq('user_id', userId)
    .eq('status', 'active')
    .lt('expires_at', now);
}

async function handleInvoicePaid(
  deps: WebhookDeps,
  customerId: string,
  invoice: any,
  stripeEventId: string,
): Promise<void> {
  try {
    if (invoice.billing_reason !== 'subscription_cycle') {
      return;
    }

    const userId = await resolveUserId(deps, customerId);
    if (!userId) return;

    const { data: sub } = await deps.supabase
      .from('stripe_subscriptions')
      .select('token_limit, current_period_start, current_period_end, is_lifetime_limit, plan_name')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (!sub || !sub.token_limit || sub.token_limit === 0) return;
    if (sub.is_lifetime_limit) return;
    if (!sub.current_period_start || !sub.current_period_end) return;

    const periodStart = new Date(sub.current_period_start).toISOString();
    const periodEnd = new Date(sub.current_period_end).toISOString();

    const { data: usageRows } = await deps.supabase
      .from('token_usage')
      .select('input_tokens, output_tokens')
      .eq('user_id', userId)
      .eq('source', 'platform')
      .gte('created_at', periodStart)
      .lt('created_at', periodEnd);

    const totalUsed = (usageRows ?? []).reduce(
      (sum: number, row: any) => sum + (row.input_tokens ?? 0) + (row.output_tokens ?? 0),
      0,
    );

    const unusedTokens = Math.max(0, sub.token_limit - totalUsed);
    if (unusedTokens === 0) return;

    const newPeriodEnd = new Date(invoice.period_end * 1000);
    const rolloverExpiry = new Date(newPeriodEnd);
    rolloverExpiry.setMonth(rolloverExpiry.getMonth() + 1);

    const { error: rolloverErr } = await deps.supabase
      .from('token_rollover')
      .insert({
        user_id: userId,
        rollover_tokens: unusedTokens,
        source_period_start: periodStart,
        source_period_end: periodEnd,
        expires_at: rolloverExpiry.toISOString(),
        status: 'active',
      });

    if (rolloverErr) {
      console.error(`[invoice-paid] Failed to insert token rollover for user ${userId}:`, rolloverErr);
    } else {
      console.info(`[invoice-paid] Rolled over ${unusedTokens} unused tokens for user ${userId}, expires ${rolloverExpiry.toISOString()}`);
    }

    await deps.supabase.from('subscription_audit_log').insert({
      user_id: userId,
      source: 'webhook',
      action: 'token_rollover',
      new_values: {
        rollover_tokens: unusedTokens,
        source_period: `${periodStart} - ${periodEnd}`,
        expires_at: rolloverExpiry.toISOString(),
      },
      stripe_event_id: stripeEventId,
      metadata: { event_type: 'invoice.paid', billing_reason: 'subscription_cycle' },
    });

    await expireStaleTokenEntries(deps, userId);
  } catch (error) {
    console.error(`[invoice-paid] Error handling rollover for customer ${customerId}:`, error);
  }
}

export async function syncCustomerFromStripe(
  deps: WebhookDeps,
  customerId: string,
  stripeEventId?: string,
  eventType?: string,
) {
  try {
    const userId = await resolveUserId(deps, customerId);
    if (!userId) {
      console.error(`No user mapping found for Stripe customer: ${customerId}`);
      return;
    }

    const { data: existingRow } = await deps.supabase
      .from('stripe_subscriptions')
      .select('id, plan_name, status, amount_cents, billing_interval, token_limit, cancel_at_period_end')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    const subscriptions = await deps.stripe.subscriptions.list({
      customer: customerId,
      limit: 1,
      status: 'all',
      expand: ['data.default_payment_method'],
    });

    if (subscriptions.data.length === 0) {
      if (existingRow && canonicalizeTier(existingRow.plan_name) === 'community') {
        console.info(`Skipping cancellation for community-plan customer: ${customerId}`);
        return;
      }

      console.info(`No subscriptions found for customer: ${customerId}`);
      const { error } = await deps.supabase
        .from('stripe_subscriptions')
        .upsert(
          {
            user_id: userId,
            stripe_customer_id: customerId,
            status: 'canceled',
          },
          { onConflict: 'stripe_customer_id' },
        );

      if (error) {
        console.error('Error updating subscription status:', error);
      }

      const oldValues = existingRow ? {
        plan_name: existingRow.plan_name,
        status: existingRow.status,
      } : null;

      await deps.supabase.from('subscription_audit_log').insert({
        subscription_id: existingRow?.id ?? null,
        user_id: userId,
        actor_id: null,
        source: 'webhook',
        action: 'status_change',
        old_values: oldValues,
        new_values: { status: 'canceled' },
        stripe_event_id: stripeEventId ?? null,
        metadata: eventType ? { event_type: eventType } : null,
      });

      return;
    }

    const subscription = subscriptions.data[0];
    const price = subscription.items.data[0]?.price;
    const priceId = price?.id ?? '';
    const planInfo = price ? resolvePlanInfoStrict(price) : { name: 'unknown', tokenLimit: 0, amountCents: 0 };
    const billingInterval = price?.recurring?.interval === 'year' ? 'year' : 'month';

    const upsertData: Record<string, unknown> = {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      plan_name: planInfo.name,
      amount_cents: planInfo.amountCents,
      currency: subscription.currency,
      status: subscription.status,
      price_id: priceId,
      billing_interval: billingInterval,
      token_limit: planInfo.tokenLimit,
      is_lifetime_limit: false,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    };

    if (subscription.default_payment_method && typeof subscription.default_payment_method !== 'string') {
      upsertData.payment_method_brand = subscription.default_payment_method.card?.brand ?? null;
      upsertData.payment_method_last4 = subscription.default_payment_method.card?.last4 ?? null;
    }

    const { error: subError } = await deps.supabase
      .from('stripe_subscriptions')
      .upsert(upsertData, { onConflict: 'stripe_customer_id' });

    if (subError) {
      console.error('Error syncing subscription:', subError);
      throw new Error('Failed to sync subscription in database');
    }

    const oldValues = existingRow ? {
      plan_name: existingRow.plan_name,
      status: existingRow.status,
      amount_cents: existingRow.amount_cents,
      billing_interval: existingRow.billing_interval,
      token_limit: existingRow.token_limit,
      cancel_at_period_end: existingRow.cancel_at_period_end,
    } : null;

    let action = 'sync';
    if (!existingRow) {
      action = 'create';
    } else if (existingRow.plan_name !== planInfo.name) {
      action = 'plan_change';
    } else if (existingRow.status !== subscription.status) {
      action = 'status_change';
    }

    await deps.supabase.from('subscription_audit_log').insert({
      subscription_id: existingRow?.id ?? null,
      user_id: userId,
      actor_id: null,
      source: 'webhook',
      action,
      old_values: oldValues,
      new_values: {
        plan_name: planInfo.name,
        status: subscription.status,
        amount_cents: planInfo.amountCents,
        billing_interval: billingInterval,
        token_limit: planInfo.tokenLimit,
        cancel_at_period_end: subscription.cancel_at_period_end,
      },
      stripe_event_id: stripeEventId ?? null,
      metadata: eventType ? { event_type: eventType } : null,
    });

    await expireStaleTokenEntries(deps, userId);

    console.info(`Successfully synced subscription for customer: ${customerId}, plan: ${planInfo.name}`);
  } catch (error) {
    console.error(`Failed to sync subscription for customer ${customerId}:`, error);
    throw error;
  }
}

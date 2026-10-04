/*
  P0-8: stripe-webhook event handling, extracted verbatim from index.ts so it is testable
  under deno test (index.ts reads env and calls Deno.serve at module load, which blocks
  importing it). Dependencies are structural parameters — this module imports nothing but
  the shared plan mapping, so tests run offline against the real shipped logic.

  index.ts keeps: env reads, real Stripe/Supabase client construction, signature
  verification, Deno.serve.
*/
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
    // Only subscriptions are sold; a one-time payment provisions nothing here.
    if (session.mode !== 'subscription') {
      console.info(`Ignoring non-subscription checkout for customer: ${customerId}`);
      return;
    }
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
      .select('id, plan_name, status, amount_cents, billing_interval, cancel_at_period_end')
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
    const planInfo = price ? resolvePlanInfoStrict(price) : { name: 'unknown', amountCents: 0 };
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
        cancel_at_period_end: subscription.cancel_at_period_end,
      },
      stripe_event_id: stripeEventId ?? null,
      metadata: eventType ? { event_type: eventType } : null,
    });

    console.info(`Successfully synced subscription for customer: ${customerId}, plan: ${planInfo.name}`);
  } catch (error) {
    console.error(`Failed to sync subscription for customer ${customerId}:`, error);
    throw error;
  }
}

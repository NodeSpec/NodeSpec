import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const PLATFORM_TRIAL_TOKENS = 600_000;

// Canonicalized 2026-08-25: names come from the shared map (this file held the
// SECOND drifted copy). The cron's one deliberate difference is preserved:
// tokenLimit is flattened to the platform-trial allowance, never the plan's.
import { resolvePlanInfoWithFallbacks } from '../_shared/stripe-plans.ts';
import { canonicalizeTier } from '../_shared/tiers.ts';

function resolvePlanInfo(price: Stripe.Price): { name: string; tokenLimit: number; amountCents: number } {
  const resolved = resolvePlanInfoWithFallbacks(price);
  return {
    name: resolved.name,
    tokenLimit: resolved.name === 'unknown' ? 0 : PLATFORM_TRIAL_TOKENS,
    amountCents: resolved.amountCents,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecret) {
      return jsonResponse({ error: 'Stripe not configured' }, 500);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: 'Database not configured' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      if (token !== supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user || user.app_metadata?.is_admin !== true) {
          return jsonResponse({ error: 'Admin or service role access required' }, 403);
        }
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const stripe = new Stripe(stripeSecret, {
      appInfo: { name: 'NodeSpec Integration', version: '1.0.0' },
    });

    const { data: customers, error: custErr } = await supabase
      .from('stripe_customers')
      .select('user_id, customer_id')
      .is('deleted_at', null);

    if (custErr) {
      console.error('cron-sync: failed to fetch customers', custErr);
      return jsonResponse({ error: 'Failed to fetch customers' }, 500);
    }

    if (!customers || customers.length === 0) {
      return jsonResponse({ synced: 0, errors: 0, message: 'No customers to sync' });
    }

    console.log(`cron-sync: starting sync for ${customers.length} customers`);

    let synced = 0;
    let errors = 0;

    for (const customer of customers) {
      try {
        let stripeSubscriptions: Stripe.ApiList<Stripe.Subscription>;
        try {
          stripeSubscriptions = await stripe.subscriptions.list({
            customer: customer.customer_id,
            limit: 1,
            status: 'all',
            expand: ['data.default_payment_method'],
          });
        } catch (stripeErr: any) {
          console.error(`cron-sync: Stripe API error for ${customer.customer_id}:`, stripeErr.message);
          errors++;
          continue;
        }

        const { data: existingRow } = await supabase
          .from('stripe_subscriptions')
          .select('id, plan_name, status, amount_cents, billing_interval, token_limit, cancel_at_period_end')
          .eq('stripe_customer_id', customer.customer_id)
          .maybeSingle();

        if (stripeSubscriptions.data.length === 0) {
          if (existingRow && canonicalizeTier(existingRow.plan_name) === 'community') {
            synced++;
            continue;
          }
          if (existingRow && existingRow.status !== 'canceled') {
            await supabase
              .from('stripe_subscriptions')
              .update({ status: 'canceled', updated_at: new Date().toISOString() })
              .eq('stripe_customer_id', customer.customer_id);

            await supabase.from('subscription_audit_log').insert({
              subscription_id: existingRow.id,
              user_id: customer.user_id,
              actor_id: null,
              source: 'cron_sync',
              action: 'status_change',
              old_values: { status: existingRow.status },
              new_values: { status: 'canceled' },
            });
          }
          synced++;
          continue;
        }

        const subscription = stripeSubscriptions.data[0];
        const price = subscription.items.data[0]?.price;
        const priceId = price?.id ?? '';
        const planInfo = price ? resolvePlanInfo(price) : { name: 'unknown', tokenLimit: 0, amountCents: 0 };
        const billingInterval = price?.recurring?.interval === 'year' ? 'year' : 'month';

        const upsertData: Record<string, unknown> = {
          user_id: customer.user_id,
          stripe_customer_id: customer.customer_id,
          stripe_subscription_id: subscription.id,
          plan_name: planInfo.name,
          amount_cents: planInfo.amountCents,
          currency: subscription.currency,
          status: subscription.status,
          price_id: priceId,
          billing_interval: billingInterval,
          token_limit: planInfo.tokenLimit,
          is_lifetime_limit: true,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        };

        if (subscription.default_payment_method && typeof subscription.default_payment_method !== 'string') {
          upsertData.payment_method_brand = subscription.default_payment_method.card?.brand ?? null;
          upsertData.payment_method_last4 = subscription.default_payment_method.card?.last4 ?? null;
        }

        const { error: upsertError } = await supabase
          .from('stripe_subscriptions')
          .upsert(upsertData, { onConflict: 'stripe_customer_id' });

        if (upsertError) {
          console.error(`cron-sync: upsert failed for ${customer.customer_id}:`, upsertError);
          errors++;
          continue;
        }

        const oldValues = existingRow ? {
          plan_name: existingRow.plan_name,
          status: existingRow.status,
          amount_cents: existingRow.amount_cents,
          billing_interval: existingRow.billing_interval,
          token_limit: existingRow.token_limit,
          cancel_at_period_end: existingRow.cancel_at_period_end,
        } : null;

        const hasChanges = !existingRow ||
          existingRow.plan_name !== planInfo.name ||
          existingRow.status !== subscription.status ||
          existingRow.amount_cents !== planInfo.amountCents;

        if (hasChanges) {
          await supabase.from('subscription_audit_log').insert({
            subscription_id: existingRow?.id ?? null,
            user_id: customer.user_id,
            actor_id: null,
            source: 'cron_sync',
            action: !existingRow ? 'create' : existingRow.plan_name !== planInfo.name ? 'plan_change' : existingRow.status !== subscription.status ? 'status_change' : 'sync',
            old_values: oldValues,
            new_values: {
              plan_name: planInfo.name,
              status: subscription.status,
              amount_cents: planInfo.amountCents,
              billing_interval: billingInterval,
              token_limit: planInfo.tokenLimit,
              cancel_at_period_end: subscription.cancel_at_period_end,
            },
          });
        }

        synced++;
      } catch (err: any) {
        console.error(`cron-sync: error processing customer ${customer.customer_id}:`, err.message);
        errors++;
      }
    }

    console.log(`cron-sync: completed. synced=${synced}, errors=${errors}`);

    return jsonResponse({ synced, errors, total: customers.length });
  } catch (error: any) {
    console.error('cron-sync unhandled error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});

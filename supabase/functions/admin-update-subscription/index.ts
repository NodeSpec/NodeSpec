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

// Canonicalized 2026-08-25: the map and the checkout-key construction both
// come from the shared module — this file previously held the THIRD drifted
// copy of the price map plus a string-concatenated lookup key.
import { PLAN_BY_LOOKUP_KEY, PLAN_LOOKUP_KEYS } from '../_shared/stripe-plans.ts';

const VALID_PLANS = new Set(Object.keys(PLAN_LOOKUP_KEYS));
const VALID_INTERVALS = new Set(['month', 'year']);

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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const stripe = new Stripe(stripeSecret, {
      appInfo: { name: 'NodeSpec Integration', version: '1.0.0' },
    });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const isAdmin = user.app_metadata?.is_admin === true;
    if (!isAdmin) {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    const { target_user_id, target_plan, target_interval } = await req.json();

    if (!target_user_id || typeof target_user_id !== 'string') {
      return jsonResponse({ error: 'target_user_id is required' }, 400);
    }
    if (!VALID_PLANS.has(target_plan)) {
      return jsonResponse({ error: `Invalid plan: ${target_plan}. Must be one of: ${[...VALID_PLANS].join(', ')}.` }, 400);
    }
    if (!VALID_INTERVALS.has(target_interval)) {
      return jsonResponse({ error: `Invalid interval: ${target_interval}. Must be month or year.` }, 400);
    }

    const { data: customerMapping, error: custErr } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', target_user_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (custErr) {
      return jsonResponse({ error: 'Database error fetching customer' }, 500);
    }
    if (!customerMapping?.customer_id) {
      return jsonResponse({ error: 'No Stripe customer found for this user' }, 404);
    }

    const customerId = customerMapping.customer_id;

    const { data: existingRow } = await supabase
      .from('stripe_subscriptions')
      .select('id, plan_name, status, amount_cents, billing_interval, token_limit, cancel_at_period_end')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 1,
      status: 'active',
    });

    if (subscriptions.data.length === 0) {
      return jsonResponse({ error: 'No active subscription found for this user' }, 404);
    }

    const subscription = subscriptions.data[0];
    const currentItem = subscription.items.data[0];
    if (!currentItem) {
      return jsonResponse({ error: 'Subscription has no items' }, 500);
    }

    const lookupKey = PLAN_LOOKUP_KEYS[target_plan as keyof typeof PLAN_LOOKUP_KEYS][target_interval === 'month' ? 'month' : 'year'];
    const planInfo = PLAN_BY_LOOKUP_KEY[lookupKey];
    if (!planInfo) {
      return jsonResponse({ error: `No plan config for ${lookupKey}` }, 400);
    }

    const prices = await stripe.prices.list({
      lookup_keys: [lookupKey],
      active: true,
      limit: 1,
    });

    if (prices.data.length === 0) {
      return jsonResponse({
        error: `No Stripe price found for lookup key "${lookupKey}". Ensure prices are configured with lookup keys in Stripe.`,
      }, 404);
    }

    const targetPrice = prices.data[0];

    if (currentItem.price.id === targetPrice.id) {
      return jsonResponse({ error: 'User is already on this plan and interval' }, 400);
    }

    console.log(`admin-update-subscription: Changing user ${target_user_id} from price ${currentItem.price.id} to ${targetPrice.id} (${lookupKey})`);

    const updated = await stripe.subscriptions.update(subscription.id, {
      items: [{
        id: currentItem.id,
        price: targetPrice.id,
      }],
      proration_behavior: 'create_prorations',
    });

    const billingInterval = targetPrice.recurring?.interval === 'year' ? 'year' : 'month';
    const amountCents = targetPrice.unit_amount ?? 0;

    const { error: dbError } = await supabase
      .from('stripe_subscriptions')
      .update({
        plan_name: planInfo.name,
        amount_cents: amountCents,
        price_id: targetPrice.id,
        billing_interval: billingInterval,
        token_limit: planInfo.tokenLimit,
        status: updated.status,
        stripe_subscription_id: updated.id,
        current_period_start: new Date(updated.current_period_start * 1000).toISOString(),
        current_period_end: new Date(updated.current_period_end * 1000).toISOString(),
        cancel_at_period_end: updated.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_customer_id', customerId);

    if (dbError) {
      console.error('DB update failed after Stripe update:', dbError);
      return jsonResponse({
        error: 'Stripe updated but local DB sync failed. The webhook will reconcile shortly.',
        stripe_updated: true,
      }, 500);
    }

    const oldValues = existingRow ? {
      plan_name: existingRow.plan_name,
      status: existingRow.status,
      amount_cents: existingRow.amount_cents,
      billing_interval: existingRow.billing_interval,
      token_limit: existingRow.token_limit,
      cancel_at_period_end: existingRow.cancel_at_period_end,
    } : null;

    await supabase.from('subscription_audit_log').insert({
      subscription_id: existingRow?.id ?? null,
      user_id: target_user_id,
      actor_id: user.id,
      source: 'admin_update',
      action: 'plan_change',
      old_values: oldValues,
      new_values: {
        plan_name: planInfo.name,
        status: updated.status,
        amount_cents: amountCents,
        billing_interval: billingInterval,
        token_limit: planInfo.tokenLimit,
        cancel_at_period_end: updated.cancel_at_period_end,
      },
      metadata: {
        stripe_subscription_id: updated.id,
        old_price_id: currentItem.price.id,
        new_price_id: targetPrice.id,
        lookup_key: lookupKey,
      },
    });

    console.log(`admin-update-subscription: Success. User ${target_user_id} now on ${planInfo.name}/${billingInterval}`);

    return jsonResponse({
      success: true,
      plan: planInfo.name,
      interval: billingInterval,
      amount_cents: amountCents,
      status: updated.status,
    });
  } catch (error: any) {
    console.error('admin-update-subscription error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});

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

// P0-8: the plan mapping (previously a drifted duplicate of stripe-webhook's copy) now
// lives in ../_shared/stripe-plans.ts; the reconciliation row construction in ./logic.ts.
import { buildSyncUpsert } from './logic.ts';

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
      console.error('STRIPE_SECRET_KEY is not configured');
      return jsonResponse({ error: 'Stripe not configured' }, 500);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase environment variables not configured');
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
      console.error('Auth failed:', authError?.message ?? 'No user');
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text.trim()) {
        body = JSON.parse(text);
      }
    } catch {
      // empty body is fine for self-sync
    }

    const targetUserId = body.target_user_id as string | undefined;
    let syncUserId = user.id;
    let auditSource = 'user_sync';
    let actorId: string | null = null;

    if (targetUserId && typeof targetUserId === 'string') {
      const isAdmin = user.app_metadata?.is_admin === true;
      if (!isAdmin) {
        return jsonResponse({ error: 'Admin access required to sync another user' }, 403);
      }
      syncUserId = targetUserId;
      auditSource = 'admin_sync';
      actorId = user.id;
      console.log(`sync-subscription: admin ${user.id} syncing target user ${syncUserId}`);
    } else {
      console.log(`sync-subscription: starting self-sync for user ${user.id}`);
    }

    const { data: customerMapping, error: custErr } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', syncUserId)
      .is('deleted_at', null)
      .maybeSingle();

    if (custErr) {
      console.error('Error fetching customer mapping:', custErr);
      return jsonResponse({ error: 'Database error' }, 500);
    }

    if (!customerMapping?.customer_id) {
      console.log(`sync-subscription: no stripe customer found for user ${syncUserId}`);
      return jsonResponse({ synced: false, reason: 'no_stripe_customer' });
    }

    const customerId = customerMapping.customer_id;
    console.log(`sync-subscription: found customer ${customerId}, fetching subscriptions from Stripe`);

    let subscriptions: Stripe.ApiList<Stripe.Subscription>;
    try {
      subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        limit: 1,
        status: 'all',
        expand: ['data.default_payment_method'],
      });
    } catch (stripeErr: any) {
      console.error('Stripe API error:', stripeErr.message);
      return jsonResponse({ error: 'Stripe API error', detail: stripeErr.message }, 502);
    }

    if (subscriptions.data.length === 0) {
      console.log(`sync-subscription: no subscriptions found on Stripe for customer ${customerId}`);
      return jsonResponse({ synced: false, reason: 'no_stripe_subscription' });
    }

    const subscription = subscriptions.data[0];
    const { planName, upsertData } = buildSyncUpsert(syncUserId, customerId, subscription);

    console.log(`sync-subscription: found subscription ${subscription.id}, status=${subscription.status}, plan=${planName}`);

    const { data: existingRow } = await supabase
      .from('stripe_subscriptions')
      .select('id, plan_name, status, amount_cents, billing_interval, token_limit, cancel_at_period_end')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    const { error: upsertError } = await supabase
      .from('stripe_subscriptions')
      .update(upsertData)
      .eq('stripe_customer_id', customerId);

    if (upsertError) {
      console.error('Update failed, trying upsert:', upsertError);

      const { error: fallbackError } = await supabase
        .from('stripe_subscriptions')
        .upsert(upsertData, { onConflict: 'stripe_customer_id' });

      if (fallbackError) {
        console.error('Upsert also failed:', fallbackError);
        return jsonResponse({ error: 'Failed to sync subscription', detail: fallbackError.message }, 500);
      }
    }

    const oldValues = existingRow ? {
      plan_name: existingRow.plan_name,
      status: existingRow.status,
      amount_cents: existingRow.amount_cents,
      billing_interval: existingRow.billing_interval,
      token_limit: existingRow.token_limit,
      cancel_at_period_end: existingRow.cancel_at_period_end,
    } : null;

    const newValues = {
      plan_name: upsertData.plan_name,
      status: subscription.status,
      amount_cents: upsertData.amount_cents,
      billing_interval: upsertData.billing_interval,
      token_limit: upsertData.token_limit,
      cancel_at_period_end: subscription.cancel_at_period_end,
    };

    await supabase.from('subscription_audit_log').insert({
      subscription_id: existingRow?.id ?? null,
      user_id: syncUserId,
      actor_id: actorId,
      source: auditSource,
      action: 'sync',
      old_values: oldValues,
      new_values: newValues,
    });

    console.log(`sync-subscription: successfully synced for user ${syncUserId}, plan=${planName}, status=${subscription.status}`);

    return jsonResponse({
      synced: true,
      plan: planName,
      status: subscription.status,
    });
  } catch (error: any) {
    console.error('sync-subscription unhandled error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});

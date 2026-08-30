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

// P0-8: the cancellation decision (refund window/amount math) lives in ./logic.ts,
// testable under deno test.
import { decideCancellation } from './logic.ts';

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

    console.log(`cancel-subscription: starting for user ${user.id}`);

    const { data: customerMapping, error: custErr } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (custErr) {
      console.error('Error fetching customer mapping:', custErr);
      return jsonResponse({ error: 'Database error' }, 500);
    }

    if (!customerMapping?.customer_id) {
      return jsonResponse({ error: 'No active subscription found' }, 404);
    }

    const customerId = customerMapping.customer_id;

    let subscriptions: Stripe.ApiList<Stripe.Subscription>;
    try {
      subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'active',
        limit: 1,
      });
    } catch (stripeErr: any) {
      console.error('Stripe API error:', stripeErr.message);
      return jsonResponse({ error: 'Stripe API error', detail: stripeErr.message }, 502);
    }

    if (subscriptions.data.length === 0) {
      return jsonResponse({ error: 'No active subscription found on Stripe' }, 404);
    }

    const subscription = subscriptions.data[0];
    const now = new Date();
    const decision = decideCancellation(subscription, now);
    const cancellationType = decision.cancellationType;
    const refundAmountCents = decision.refundAmountCents;
    const effectiveEndDate = decision.effectiveEndDate;

    if (cancellationType === 'immediate_with_refund') {
      console.log(`cancel-subscription: annual refund eligible. Refund: ${refundAmountCents}`);

      await stripe.subscriptions.cancel(subscription.id);

      const latestInvoice = typeof subscription.latest_invoice === 'string'
        ? subscription.latest_invoice
        : subscription.latest_invoice?.id;

      if (latestInvoice && refundAmountCents > 0) {
        const invoice = await stripe.invoices.retrieve(latestInvoice);
        const paymentIntentId = typeof invoice.payment_intent === 'string'
          ? invoice.payment_intent
          : invoice.payment_intent?.id;

        if (paymentIntentId) {
          try {
            await stripe.refunds.create({
              payment_intent: paymentIntentId,
              amount: refundAmountCents,
            });
            console.log(`cancel-subscription: refund of ${refundAmountCents} cents issued`);
          } catch (refundErr: any) {
            console.error('Refund failed:', refundErr.message);
            return jsonResponse({
              error: 'Subscription cancelled but refund failed. Please contact support.',
              detail: refundErr.message,
            }, 500);
          }
        }
      }

      const { error: updateErr } = await supabase
        .from('stripe_subscriptions')
        .update({
          status: 'canceled',
          cancel_at_period_end: false,
          cancelled_at: now.toISOString(),
          cancellation_reason: 'user_requested',
          refund_amount_cents: refundAmountCents,
          updated_at: now.toISOString(),
        })
        .eq('stripe_customer_id', customerId);

      if (updateErr) {
        console.error('Failed to update local subscription:', updateErr);
      }
    } else {
      await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
      });

      const { error: updateErr } = await supabase
        .from('stripe_subscriptions')
        .update({
          cancel_at_period_end: true,
          cancelled_at: now.toISOString(),
          cancellation_reason: 'user_requested',
          updated_at: now.toISOString(),
        })
        .eq('stripe_customer_id', customerId);

      if (updateErr) {
        console.error('Failed to update local subscription:', updateErr);
      }
    }

    console.log(`cancel-subscription: completed for user ${user.id}, type=${cancellationType}`);

    return jsonResponse({
      success: true,
      cancellationType,
      refundAmountCents,
      effectiveEndDate,
    });
  } catch (error: any) {
    console.error('cancel-subscription unhandled error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});

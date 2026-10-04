// The cancel-subscription handler, driven by index.ts with the real
// Supabase and Stripe clients and by the Deno tests with in-memory ones.
// AE.1: a downgrade is refused while the caller owns a project that holds a
// seat, decided after the caller is known and before Stripe is touched.
import { decideCancellation, downgradeRefusal, type CancellationSubscription } from './logic.ts';
import { ownedProjectsWithSeats } from '../_shared/project-membership.ts';

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

type StripeSubscription = CancellationSubscription & {
  id: string;
  latest_invoice?: string | { id: string } | null;
};

/** The Stripe calls cancellation makes. */
export interface CancelStripe {
  subscriptions: {
    list(params: { customer: string; status: 'active'; limit: number }): Promise<{ data: StripeSubscription[] }>;
    cancel(id: string): Promise<unknown>;
    update(id: string, params: { cancel_at_period_end: boolean }): Promise<unknown>;
  };
  invoices: { retrieve(id: string): Promise<{ payment_intent?: string | { id: string } | null }> };
  refunds: { create(params: { payment_intent: string; amount: number }): Promise<unknown> };
}

export interface CancelDeps {
  env: { get(name: string): string | undefined };
  // deno-lint-ignore no-explicit-any
  createClient(url: string, key: string): any;
  stripe(secret: string): CancelStripe;
}

export async function handleCancelSubscription(req: Request, deps: CancelDeps): Promise<Response> {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const supabaseUrl = deps.env.get('SUPABASE_URL');
    const supabaseServiceKey = deps.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase environment variables not configured');
      return jsonResponse({ error: 'Database not configured' }, 500);
    }

    const supabase = deps.createClient(supabaseUrl, supabaseServiceKey);

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

    // AE.1: a Team owner hands each project that still holds seats to one
    // of its accounts before downgrading. Decided before Stripe is touched,
    // so the refusal costs nothing and names the projects.
    const blockers = await ownedProjectsWithSeats(supabase, user.id);
    if (blockers.length > 0) {
      return jsonResponse({ error: downgradeRefusal(blockers), blockers }, 409);
    }

    const stripeSecret = deps.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecret) {
      console.error('STRIPE_SECRET_KEY is not configured');
      return jsonResponse({ error: 'Stripe not configured' }, 500);
    }
    const stripe = deps.stripe(stripeSecret);

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

    let subscriptions: { data: StripeSubscription[] };
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
}

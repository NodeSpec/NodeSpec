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

async function logProvisioningEvent(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  try {
    await supabase.from('subscription_audit_log').insert({
      user_id: userId,
      source: 'create-free-customer',
      action,
      metadata,
    });
  } catch (err: any) {
    console.warn(`[create-free-customer] Failed to write audit log: ${err.message}`);
  }
}

async function findStripeCustomerByEmail(
  stripe: Stripe,
  email: string,
): Promise<Stripe.Customer | null> {
  try {
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data.length > 0 && !customers.data[0].deleted) {
      return customers.data[0];
    }
    return null;
  } catch (err: any) {
    console.warn(`[create-free-customer] Stripe customer search by email failed: ${err.message}`);
    return null;
  }
}

async function findExistingActiveCustomer(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('stripe_customers')
    .select('customer_id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error(`[create-free-customer] Customer lookup failed: ${error.message}`);
    throw error;
  }

  return data && data.length > 0 ? data[0].customer_id : null;
}

async function ensureSubscriptionExists(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  customerId: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from('stripe_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing', 'past_due'])
    .limit(1);

  if (existing && existing.length > 0) return;

  const { error: subErr } = await supabase.rpc('idempotent_free_subscription', {
    p_user_id: userId,
    p_customer_id: customerId,
  });

  if (subErr) {
    if (subErr.message?.includes('unique') || subErr.code === '23505') {
      console.log(`[create-free-customer] Subscription already exists (concurrent insert) for user ${userId}`);
      return;
    }
    console.error(`[create-free-customer] Failed to ensure subscription: ${subErr.message}`);
    throw subErr;
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // SHIP-1(e) live find 2026-08-24: a FRESH signup on a self-hosted
    // deployment reached stripe.customers.create with the dummy key and the
    // app doom-looped on "Account Setup encountered an issue" (the bench
    // never saw it — its seeded user takes the already-provisioned early
    // exit). Self-hosted deployments provision LOCALLY: no Stripe account,
    // no Stripe calls, a synthetic customer id — tiers come from the signed
    // license (_shared/deployment.ts), never from billing rows.
    const selfHosted = Deno.env.get('NODESPEC_DEPLOYMENT') === 'self-hosted';

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecret && !selfHosted) {
      console.error('[create-free-customer] STRIPE_SECRET_KEY is not configured');
      return jsonResponse({ error: 'Stripe not configured' }, 500);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[create-free-customer] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured');
      return jsonResponse({ error: 'Database not configured' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // On self-host the client is never used (the branch below returns first);
    // the placeholder key only satisfies the constructor.
    const stripe = new Stripe(stripeSecret ?? 'sk_unused_selfhost', {
      appInfo: { name: 'NodeSpec Integration', version: '1.0.0' },
    });

    let userId: string;
    let userEmail: string | undefined;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[create-free-customer] Missing Authorization header');
      return jsonResponse({ error: 'Missing authorization' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');

    let body: Record<string, unknown> = {};
    try {
      const text = await req.clone().text();
      if (text) body = JSON.parse(text);
    } catch { /* no body is fine for client calls */ }

    if (body.trigger_source === 'auth_user_insert' && body.user_id && body.user_email) {
      const candidateId = body.user_id as string;
      const { data: { user: verifiedUser }, error: verifyErr } = await supabase.auth.admin.getUserById(candidateId);
      if (verifyErr || !verifiedUser) {
        console.error(`[create-free-customer] Trigger call rejected: user ${candidateId} not found in auth.users`);
        return jsonResponse({ error: 'Invalid user_id' }, 403);
      }
      userId = verifiedUser.id;
      userEmail = verifiedUser.email ?? (body.user_email as string);
      console.log(`[create-free-customer] Server-side trigger for user ${userId} (${userEmail})`);
    } else {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        console.error(`[create-free-customer] Auth failed: ${authError?.message ?? 'No user returned'}`);
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      userId = user.id;
      userEmail = user.email;
      console.log(`[create-free-customer] Client-side call for user ${userId} (${userEmail})`);
    }

    // Self-hosted: local provisioning, Stripe never touched. The synthetic
    // customer id keeps every existing row shape and idempotent RPC intact.
    if (selfHosted) {
      const existing = await findExistingActiveCustomer(supabase, userId);
      const customerId = existing ?? `selfhost_${userId}`;
      if (!existing) {
        const { error: insertErr } = await supabase.rpc('idempotent_customer_insert', {
          p_user_id: userId,
          p_customer_id: customerId,
        });
        if (insertErr && !insertErr.message?.includes('unique') && insertErr.code !== '23505') {
          console.error(`[create-free-customer] Self-host customer insert failed for user ${userId}: ${insertErr.message}`);
          await logProvisioningEvent(supabase, userId, 'provisioning_failed', {
            stage: 'selfhost_customer_insert', error: insertErr.message,
          });
          return jsonResponse({ error: 'Failed to create local customer record' }, 500);
        }
      }
      await ensureSubscriptionExists(supabase, userId, customerId);
      await logProvisioningEvent(supabase, userId, 'provisioning_success', {
        customerId, scenario: 'selfhost_local',
      });
      console.log(`[create-free-customer] Self-host provisioning complete for user ${userId} (${customerId})`);
      return jsonResponse({ created: !existing, existing: !!existing, customerId });
    }

    const existingCustomerId = await findExistingActiveCustomer(supabase, userId);

    if (existingCustomerId) {
      await ensureSubscriptionExists(supabase, userId, existingCustomerId);
      console.log(`[create-free-customer] Customer already exists for user ${userId}: ${existingCustomerId}`);
      return jsonResponse({ created: false, existing: true, customerId: existingCustomerId });
    }

    if (userEmail) {
      const { data: orphanedRows } = await supabase
        .from('stripe_customers')
        .select('customer_id, user_id')
        .neq('user_id', userId)
        .not('deleted_at', 'is', null);

      if (orphanedRows && orphanedRows.length > 0) {
        for (const row of orphanedRows) {
          try {
            const stripeCustomer = await stripe.customers.retrieve(row.customer_id);
            if (!stripeCustomer.deleted && stripeCustomer.email === userEmail) {
              console.log(`[create-free-customer] Found orphaned Stripe customer ${row.customer_id} for email ${userEmail} (old user ${row.user_id}) — deleting from Stripe`);
              await stripe.customers.del(row.customer_id);
            }
          } catch (lookupErr: any) {
            console.warn(`[create-free-customer] Could not check orphaned customer ${row.customer_id}: ${lookupErr.message}`);
          }
        }
      }

      const existingStripeCustomer = await findStripeCustomerByEmail(stripe, userEmail);
      if (existingStripeCustomer) {
        console.log(`[create-free-customer] Found existing Stripe customer ${existingStripeCustomer.id} by email ${userEmail} — reusing for re-registration`);

        await stripe.customers.update(existingStripeCustomer.id, {
          metadata: { userId },
        });

        const { error: insertCustErr } = await supabase.rpc('idempotent_customer_insert', {
          p_user_id: userId,
          p_customer_id: existingStripeCustomer.id,
        });

        if (insertCustErr && !insertCustErr.message?.includes('unique') && insertCustErr.code !== '23505') {
          console.error(`[create-free-customer] DB insert failed for reused customer mapping (user ${userId}, customer ${existingStripeCustomer.id}):`, JSON.stringify(insertCustErr));
          await logProvisioningEvent(supabase, userId, 'provisioning_failed', {
            stage: 'customer_reuse_insert', customerId: existingStripeCustomer.id,
            error: insertCustErr.message,
          });
          return jsonResponse({ error: 'Failed to create customer mapping' }, 500);
        }

        await ensureSubscriptionExists(supabase, userId, existingStripeCustomer.id);

        await logProvisioningEvent(supabase, userId, 'provisioning_success', {
          customerId: existingStripeCustomer.id, scenario: 'reused_stripe_customer_by_email',
        });

        console.log(`[create-free-customer] Reused Stripe customer ${existingStripeCustomer.id} for re-registered user ${userId}`);
        return jsonResponse({ created: false, existing: true, customerId: existingStripeCustomer.id });
      }
    }

    console.log(`[create-free-customer] Creating new Stripe customer for user ${userId} (${userEmail})`);

    let newCustomer: Stripe.Customer;
    try {
      newCustomer = await stripe.customers.create({
        email: userEmail,
        metadata: { userId },
      });
    } catch (stripeErr: any) {
      console.error(`[create-free-customer] Stripe customer creation failed for user ${userId}: ${stripeErr.message}`, stripeErr.type ?? '');
      await logProvisioningEvent(supabase, userId, 'provisioning_failed', {
        stage: 'stripe_customer_create', error: stripeErr.message,
        stripeErrorType: stripeErr.type ?? 'unknown',
      });
      return jsonResponse({ error: 'Stripe customer creation failed' }, 502);
    }

    console.log(`[create-free-customer] Created Stripe customer ${newCustomer.id} for user ${userId}`);

    const { error: insertCustErr } = await supabase.rpc('idempotent_customer_insert', {
      p_user_id: userId,
      p_customer_id: newCustomer.id,
    });

    if (insertCustErr) {
      if (insertCustErr.message?.includes('unique') || insertCustErr.code === '23505') {
        console.log(`[create-free-customer] Customer already inserted by concurrent request for user ${userId}, cleaning up Stripe customer ${newCustomer.id}`);
        try { await stripe.customers.del(newCustomer.id); } catch { /* best effort */ }
        const resolvedId = await findExistingActiveCustomer(supabase, userId);
        if (resolvedId) {
          await ensureSubscriptionExists(supabase, userId, resolvedId);
          return jsonResponse({ created: false, existing: true, customerId: resolvedId });
        }
      }
      console.error(`[create-free-customer] DB insert failed for customer mapping (user ${userId}, customer ${newCustomer.id}):`, JSON.stringify(insertCustErr));
      try {
        await stripe.customers.del(newCustomer.id);
        console.log(`[create-free-customer] Rolled back Stripe customer ${newCustomer.id}`);
      } catch (delErr: any) {
        console.error(`[create-free-customer] CRITICAL: Failed to rollback Stripe customer ${newCustomer.id}: ${delErr.message}`);
      }
      await logProvisioningEvent(supabase, userId, 'provisioning_failed', {
        stage: 'customer_mapping_insert', customerId: newCustomer.id,
        error: insertCustErr.message, rolledBack: true,
      });
      return jsonResponse({ error: 'Failed to create customer mapping' }, 500);
    }

    await ensureSubscriptionExists(supabase, userId, newCustomer.id);

    await logProvisioningEvent(supabase, userId, 'provisioning_success', {
      customerId: newCustomer.id, scenario: 'new_customer',
    });

    console.log(`[create-free-customer] Fully provisioned free customer ${newCustomer.id} for user ${userId}`);

    return jsonResponse({ created: true, existing: false, customerId: newCustomer.id });
  } catch (error: any) {
    console.error(`[create-free-customer] Unhandled error: ${error.message}`, error.stack ?? '');
    return jsonResponse({ error: error.message }, 500);
  }
});

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

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase environment variables not configured');
      return jsonResponse({ error: 'Database not configured' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    const userId = user.id;
    console.log(`delete-account: starting for user ${userId}`);

    if (stripeSecret) {
      const stripe = new Stripe(stripeSecret, {
        appInfo: { name: 'NodeSpec Integration', version: '1.0.0' },
      });

      const { data: customerMapping } = await supabase
        .from('stripe_customers')
        .select('customer_id')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .maybeSingle();

      if (customerMapping?.customer_id) {
        const customerId = customerMapping.customer_id;

        try {
          const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            limit: 10,
          });

          for (const subscription of subscriptions.data) {
            if (subscription.status === 'active' || subscription.status === 'trialing' || subscription.status === 'past_due') {
              await stripe.subscriptions.cancel(subscription.id);
              console.log(`delete-account: cancelled Stripe subscription ${subscription.id} with status ${subscription.status}`);
            }
          }
        } catch (stripeErr: any) {
          console.error('Stripe cancellation error (continuing):', stripeErr.message);
        }

        await supabase
          .from('stripe_customers')
          .update({ deleted_at: new Date().toISOString() })
          .eq('user_id', userId);

        await supabase
          .from('stripe_subscriptions')
          .update({
            status: 'canceled',
            cancelled_at: new Date().toISOString(),
            cancellation_reason: 'account_deleted',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);
      }
    }

    const { error: projectsErr } = await supabase
      .from('projects')
      .delete()
      .eq('owner_id', userId);

    if (projectsErr) {
      console.error('Failed to delete projects:', projectsErr);
      return jsonResponse({ error: 'Failed to delete project data' }, 500);
    }
    console.log(`delete-account: deleted projects for user ${userId}`);

    await supabase.from('user_settings').delete().eq('user_id', userId);
    await supabase.from('ai_generation_context').delete().eq('user_id', userId);
    await supabase.from('token_usage').delete().eq('user_id', userId);
    await supabase.from('token_grants').delete().eq('user_id', userId);
    await supabase.from('bug_reports').delete().eq('user_id', userId);
    await supabase.from('user_feedback').delete().eq('user_id', userId);

    console.log(`delete-account: cleaned up ancillary data for user ${userId}`);

    const { error: deleteUserErr } = await supabase.auth.admin.deleteUser(userId);

    if (deleteUserErr) {
      console.error('Failed to delete auth user:', deleteUserErr);
      return jsonResponse({ error: 'Failed to delete user account' }, 500);
    }

    console.log(`delete-account: successfully deleted user ${userId}`);

    return jsonResponse({ success: true });
  } catch (error: any) {
    console.error('delete-account unhandled error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});

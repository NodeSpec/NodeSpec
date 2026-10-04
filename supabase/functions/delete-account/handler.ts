// The delete-account handler, driven by index.ts with the real Supabase and
// Stripe clients and by the Deno tests with in-memory ones.
// Owner 2026-09-27: an account is not deleted while it owns a project that
// teammates hold seats on; it hands each one over first (the Team popup's
// Make owner). The database refuses the deletion too
// (trg_refuse_account_delete_with_seats), so no door deletes around it.
import { ownedProjectsWithSeats, type SeatedProject } from '../_shared/project-membership.ts';

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

export function accountDeletionRefusal(seated: ReadonlyArray<SeatedProject>): string {
  const list = seated.map((b) => `${b.name} (${b.seats} seat${b.seats === 1 ? '' : 's'})`).join(', ');
  return `Before you delete your account, hand each project that still has seats to one of its accounts: ${list}. ` +
    'Open the project, press Team, and press Make owner on the account that takes it. Nothing was deleted.';
}

/** The Stripe calls a deletion makes. */
export interface DeleteStripe {
  subscriptions: {
    list(params: { customer: string; limit: number }): Promise<{ data: Array<{ id: string; status: string }> }>;
    cancel(id: string): Promise<unknown>;
  };
}

export interface DeleteDeps {
  env: { get(name: string): string | undefined };
  // deno-lint-ignore no-explicit-any
  createClient(url: string, key: string): any;
  stripe(secret: string): DeleteStripe;
}

export async function handleDeleteAccount(req: Request, deps: DeleteDeps): Promise<Response> {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const stripeSecret = deps.env.get('STRIPE_SECRET_KEY');
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

    const userId = user.id;

    // Owner 2026-09-27: an account that owns a project teammates hold seats
    // on is not deleted until each one is handed over. Decided before Stripe
    // or any project is touched, so a refusal costs nothing and names them.
    const seated = await ownedProjectsWithSeats(supabase, userId);
    if (seated.length > 0) {
      return jsonResponse({ error: accountDeletionRefusal(seated), blockers: seated }, 409);
    }
    console.log(`delete-account: starting for user ${userId}`);

    if (stripeSecret) {
      const stripe = deps.stripe(stripeSecret);

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
        } catch (stripeErr) {
          console.error('Stripe cancellation error (continuing):', (stripeErr as Error).message);
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

    // Projects are deleted one bounded slice at a time (project_delete_step,
    // migration 20260906140000): a large repository import leaves hundreds
    // of thousands of child rows, and one cascading DELETE of them all
    // outran the statement timeout in production (2026-09-06).
    const { data: ownedProjects, error: listErr } = await supabase
      .from('projects')
      .select('id')
      .eq('owner_id', userId);
    if (listErr) {
      console.error('Failed to list projects:', listErr);
      return jsonResponse({ error: 'Failed to delete project data' }, 500);
    }
    for (const project of ownedProjects ?? []) {
      let done = false;
      for (let step = 0; step < 10_000 && !done; step++) {
        const { data, error } = await supabase.rpc('project_delete_step', { p_project_id: project.id });
        if (error) {
          console.error(`Failed to delete project ${project.id}:`, error);
          return jsonResponse({ error: 'Failed to delete project data' }, 500);
        }
        done = (data as { done?: boolean } | null)?.done !== false;
      }
      if (!done) {
        console.error(`Project ${project.id} did not finish deleting`);
        return jsonResponse({ error: 'Failed to delete project data' }, 500);
      }
    }
    console.log(`delete-account: deleted ${ownedProjects?.length ?? 0} projects for user ${userId}`);

    await supabase.from('user_settings').delete().eq('user_id', userId);
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
  } catch (error) {
    console.error('delete-account unhandled error:', error);
    return jsonResponse({ error: (error as Error).message }, 500);
  }
}

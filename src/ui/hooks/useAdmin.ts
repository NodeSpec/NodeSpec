import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '../../persistence/supabase/client.js';

export function useIsAdmin(): { isAdmin: boolean; loading: boolean } {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const supabase = getSupabaseClient();
        const { data: { user } } = await supabase.auth.getUser();
        setIsAdmin(user?.app_metadata?.is_admin === true);
      } catch {
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };
    check();
  }, []);

  return { isAdmin, loading };
}

export interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  raw_app_meta_data: Record<string, unknown>;
}

export interface TokenUsageRow {
  id: string;
  user_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  edge_function: string | null;
  project_id: string | null;
  created_at: string;
}

export interface TokenGrant {
  id: string;
  user_id: string;
  granted_by: string | null;
  amount: number;
  reason: string;
  created_at: string;
}

export interface BugReport {
  id: string;
  user_id: string | null;
  title: string;
  description: string;
  severity: string;
  status: string;
  page_url: string;
  browser_info: string;
  admin_notes: string;
  created_at: string;
  updated_at: string;
}

export interface UserFeedback {
  id: string;
  user_id: string | null;
  type: string;
  rating: number | null;
  message: string;
  created_at: string;
}

export interface StripeSubscription {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan_name: string;
  amount_cents: number;
  currency: string;
  status: string;
  price_id: string | null;
  billing_interval: string | null;
  token_limit: number | null;
  cancel_at_period_end: boolean | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionAuditEntry {
  id: string;
  subscription_id: string | null;
  user_id: string;
  actor_id: string | null;
  source: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  stripe_event_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function useAdminData() {
  const supabase = getSupabaseClient();

  const fetchUsers = useCallback(async (): Promise<AdminUser[]> => {
    const { data, error } = await supabase.rpc('get_all_users');
    if (error) throw error;
    return (data || []) as AdminUser[];
  }, [supabase]);

  const fetchTokenUsage = useCallback(async (
    start: Date,
    end: Date
  ): Promise<TokenUsageRow[]> => {
    const { data, error } = await supabase
      .from('token_usage')
      .select('*')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as TokenUsageRow[];
  }, [supabase]);

  const fetchTokenGrants = useCallback(async (): Promise<TokenGrant[]> => {
    const { data, error } = await supabase
      .from('token_grants')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as TokenGrant[];
  }, [supabase]);

  const grantTokens = useCallback(async (
    userId: string,
    amount: number,
    reason: string
  ): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await supabase.from('token_grants').insert({
      user_id: userId,
      granted_by: user.id,
      amount,
      reason,
    });
    if (error) throw error;
  }, [supabase]);

  const fetchBugReports = useCallback(async (): Promise<BugReport[]> => {
    const { data, error } = await supabase
      .from('bug_reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as BugReport[];
  }, [supabase]);

  const updateBugReport = useCallback(async (
    id: string,
    updates: { status?: string; admin_notes?: string }
  ): Promise<void> => {
    const { error } = await supabase
      .from('bug_reports')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }, [supabase]);

  const fetchFeedback = useCallback(async (): Promise<UserFeedback[]> => {
    const { data, error } = await supabase
      .from('user_feedback')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as UserFeedback[];
  }, [supabase]);

  const fetchSubscriptions = useCallback(async (): Promise<StripeSubscription[]> => {
    const { data, error } = await supabase
      .from('stripe_subscriptions')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as StripeSubscription[];
  }, [supabase]);

  const updateUserSubscription = useCallback(async (
    targetUserId: string,
    targetPlan: string,
    targetInterval: string,
  ): Promise<{ success: boolean; plan?: string; interval?: string; error?: string }> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('No admin session');

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const resp = await fetch(`${supabaseUrl}/functions/v1/admin-update-subscription`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': anonKey,
      },
      body: JSON.stringify({
        target_user_id: targetUserId,
        target_plan: targetPlan,
        target_interval: targetInterval,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) return { success: false, error: data.error || 'Update failed' };
    return { success: true, plan: data.plan, interval: data.interval };
  }, [supabase]);

  const syncUserSubscription = useCallback(async (
    targetUserId: string,
  ): Promise<{ synced: boolean; plan?: string; error?: string }> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('No admin session');

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const resp = await fetch(`${supabaseUrl}/functions/v1/sync-subscription`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': anonKey,
      },
      body: JSON.stringify({ target_user_id: targetUserId }),
    });

    const data = await resp.json();
    if (!resp.ok) return { synced: false, error: data.error || 'Sync failed' };
    return { synced: data.synced === true, plan: data.plan };
  }, [supabase]);

  const fetchAuditLog = useCallback(async (
    userId?: string,
    limit = 50,
  ): Promise<SubscriptionAuditEntry[]> => {
    let query = supabase
      .from('subscription_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as SubscriptionAuditEntry[];
  }, [supabase]);

  return {
    fetchUsers,
    fetchTokenUsage,
    fetchTokenGrants,
    grantTokens,
    fetchBugReports,
    updateBugReport,
    fetchFeedback,
    fetchSubscriptions,
    updateUserSubscription,
    syncUserSubscription,
    fetchAuditLog,
  };
}

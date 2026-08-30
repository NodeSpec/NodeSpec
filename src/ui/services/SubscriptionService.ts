import type { SupabaseClient } from '@supabase/supabase-js';

export interface SubscriptionInfo {
  id: string;
  planName: string;
  status: string;
  billingInterval: string;
  tokenLimit: number;
  amountCents: number;
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
}

export interface CancellationResult {
  success: boolean;
  cancellationType: 'immediate_with_refund' | 'end_of_period';
  refundAmountCents: number;
  effectiveEndDate: string;
  error?: string;
}

export interface DeleteAccountResult {
  success: boolean;
  error?: string;
}

let provisioningInflight: Promise<boolean> | null = null;

export function isProvisioningInFlight(): boolean {
  return provisioningInflight !== null;
}

export class SubscriptionService {
  constructor(private supabase: SupabaseClient) {}

  async getCurrentSubscription(userId: string): Promise<SubscriptionInfo | null> {
    const { data, error } = await this.supabase
      .from('stripe_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing', 'past_due', 'not_started'])
      .order('created_at', { ascending: true })
      .limit(1);

    if (error || !data || data.length === 0) return null;

    const row = data[0];

    return {
      id: row.id,
      planName: row.plan_name,
      status: row.status,
      billingInterval: row.billing_interval ?? 'month',
      tokenLimit: row.token_limit ?? 0,
      amountCents: row.amount_cents ?? 0,
      currency: row.currency ?? 'usd',
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
      paymentMethodBrand: row.payment_method_brand,
      paymentMethodLast4: row.payment_method_last4,
    };
  }

  async hasStripeCustomer(userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('stripe_customers')
      .select('id')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .limit(1);

    if (error || !data || data.length === 0) return false;
    return true;
  }

  async createCheckoutSession(
    planId: string,
    interval: 'month' | 'year',
    accessToken: string,
  ): Promise<{ url: string } | { error: string }> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    // Explicit plan → lookup-key map (client mirror of _shared/stripe-plans.ts
    // PLAN_LOOKUP_KEYS). Never string-concatenate a plan id into a price key —
    // the old suffix convention drifted and produced invalid keys.
    const PLAN_LOOKUP_KEYS: Record<string, { month: string; year: string }> = {
      indie: { month: 'price_indie_monthly_new', year: 'price_indie_annual_new' },
      team: { month: 'price_team_monthly', year: 'price_team_annual' },
    };
    const keys = PLAN_LOOKUP_KEYS[planId];
    if (!keys) return { error: `Unknown plan: ${planId}` };
    const priceId = keys[interval === 'month' ? 'month' : 'year'];

    const response = await fetch(`${supabaseUrl}/functions/v1/stripe-checkout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'apikey': anonKey,
      },
      body: JSON.stringify({
        price_id: priceId,
        success_url: `${window.location.origin}/app?checkout=success`,
        cancel_url: `${window.location.origin}/pricing?checkout=cancelled`,
        mode: 'subscription',
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.url) {
      return { error: data.error || 'Failed to create checkout session' };
    }

    return { url: data.url };
  }

  async syncFromStripe(accessToken: string): Promise<boolean> {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/sync-subscription`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'apikey': anonKey,
        },
      });

      if (!response.ok) return false;
      const data = await response.json();
      return data.synced === true;
    } catch {
      return false;
    }
  }

  async cancelSubscription(accessToken: string): Promise<CancellationResult> {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/cancel-subscription`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'apikey': anonKey,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          cancellationType: 'end_of_period',
          refundAmountCents: 0,
          effectiveEndDate: '',
          error: data.error || 'Failed to cancel subscription',
        };
      }

      return {
        success: data.success,
        cancellationType: data.cancellationType,
        refundAmountCents: data.refundAmountCents ?? 0,
        effectiveEndDate: data.effectiveEndDate,
      };
    } catch {
      return {
        success: false,
        cancellationType: 'end_of_period',
        refundAmountCents: 0,
        effectiveEndDate: '',
        error: 'Network error. Please try again.',
      };
    }
  }

  async ensureFreeCustomer(accessToken: string): Promise<boolean> {
    if (provisioningInflight) {
      return provisioningInflight;
    }

    const run = async (): Promise<boolean> => {
      let lastError = '';

      const attempt = async (): Promise<boolean> => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const response = await fetch(`${supabaseUrl}/functions/v1/create-free-customer`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'apikey': anonKey,
          },
        });

        if (!response.ok) {
          const body = await response.text();
          lastError = `HTTP ${response.status}: ${body}`;
          console.error(`[ensureFreeCustomer] failed with status ${response.status}:`, body);
          return false;
        }
        const data = await response.json();
        return data.created === true || data.existing === true;
      };

      try {
        const first = await attempt();
        if (first) return true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error('[ensureFreeCustomer] first attempt threw:', err);
      }

      await new Promise(r => setTimeout(r, 2000));

      try {
        const second = await attempt();
        if (second) return true;
        console.error('[ensureFreeCustomer] retry also failed');
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error('[ensureFreeCustomer] retry threw:', err);
      }

      this.logProvisioningFailure(lastError);
      return false;
    };

    provisioningInflight = run();
    try {
      return await provisioningInflight;
    } finally {
      provisioningInflight = null;
    }
  }

  private logProvisioningFailure(errorDetail: string): void {
    try {
      this.supabase.auth.getUser().then(({ data }) => {
        const userId = data?.user?.id;
        if (!userId) return;
        this.supabase.from('subscription_audit_log').insert({
          user_id: userId,
          source: 'client-ensureFreeCustomer',
          action: 'provisioning_failed_client',
          metadata: { error: errorDetail, timestamp: new Date().toISOString() },
        }).then(({ error }) => {
          if (error) console.warn('[ensureFreeCustomer] Could not write audit log:', error.message);
        });
      });
    } catch {
      // best-effort logging
    }
  }

  async deleteAccount(accessToken: string): Promise<DeleteAccountResult> {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'apikey': anonKey,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to delete account',
        };
      }

      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Network error. Please try again.',
      };
    }
  }
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient } from '../../persistence/supabase/client.js';

const POLL_INTERVAL_MS = 60_000;

interface TokenUsageState {
  totalUsed: number;
  totalLimit: number;
  loading: boolean;
  isLifetimeLimit: boolean;
  planTier: string | null;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    const val = n / 1_000_000;
    return val % 1 === 0 ? `${val}M` : `${val.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const val = n / 1_000;
    return val % 1 === 0 ? `${val}K` : `${val.toFixed(1)}K`;
  }
  return String(n);
}

export function useTokenUsage(): TokenUsageState & { formatted: string; percentUsed: number; isExhausted: boolean; refresh: () => void } {
  const [state, setState] = useState<TokenUsageState>({
    totalUsed: 0,
    totalLimit: 0,
    loading: true,
    isLifetimeLimit: false,
    planTier: null,
  });

  const fetchUsage = useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setState(prev => ({ ...prev, loading: false }));
        return;
      }

      const { data: sub } = await supabase
        .from('stripe_subscriptions')
        .select('token_limit, is_lifetime_limit, current_period_start, current_period_end, plan_name, status')
        .eq('user_id', user.id)
        .in('status', ['active', 'trialing', 'past_due'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const subscriptionTokenLimit = sub?.token_limit ?? 0;
      const isLifetime = sub?.is_lifetime_limit ?? false;
      const planName = sub?.plan_name ?? null;

      let usageQuery = supabase
        .from('token_usage')
        .select('input_tokens, output_tokens')
        .eq('user_id', user.id)
        .eq('source', 'platform');

      if (!isLifetime && sub?.current_period_start && sub?.current_period_end) {
        usageQuery = usageQuery
          .gte('created_at', new Date(sub.current_period_start).toISOString())
          .lt('created_at', new Date(sub.current_period_end).toISOString());
      }

      const { data, error } = await usageQuery;

      if (error) {
        setState(prev => ({ ...prev, loading: false }));
        return;
      }

      let totalUsed = 0;
      if (data) {
        for (const row of data) {
          totalUsed += (row.input_tokens || 0) + (row.output_tokens || 0);
        }
      }

      let baseBudget = subscriptionTokenLimit;

      if (!isLifetime) {
        const { data: rolloverRows } = await supabase
          .from('token_rollover')
          .select('rollover_tokens')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString());

        if (rolloverRows) {
          for (const row of rolloverRows) {
            baseBudget += row.rollover_tokens || 0;
          }
        }
      }

      const { data: addonRows } = await supabase
        .from('token_addons')
        .select('tokens_remaining')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString());

      let addonTokens = 0;
      if (addonRows) {
        for (const row of addonRows) {
          addonTokens += row.tokens_remaining || 0;
        }
      }

      const { data: grants } = await supabase
        .from('token_grants')
        .select('amount')
        .eq('user_id', user.id);

      let grantedExtra = 0;
      if (grants) {
        for (const g of grants) {
          grantedExtra += g.amount || 0;
        }
      }

      setState({
        totalUsed,
        totalLimit: baseBudget + addonTokens + grantedExtra,
        loading: false,
        isLifetimeLimit: isLifetime,
        planTier: planName,
      });
    } catch {
      setState(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchUsage]);

  const percentUsed = state.totalLimit > 0 ? (state.totalUsed / state.totalLimit) * 100 : 0;
  const isExhausted = state.totalLimit > 0 && state.totalUsed >= state.totalLimit;
  const exhaustedEmitted = useRef(false);

  useEffect(() => {
    if (isExhausted && !exhaustedEmitted.current) {
      exhaustedEmitted.current = true;
      window.dispatchEvent(new CustomEvent('platform-tokens-exhausted'));
    }
  }, [isExhausted]);

  const formatted = state.isLifetimeLimit
    ? `${formatTokenCount(state.totalUsed)} / ${formatTokenCount(state.totalLimit)} trial`
    : `${formatTokenCount(state.totalUsed)} / ${formatTokenCount(state.totalLimit)}`;

  return { ...state, formatted, percentUsed, isExhausted, refresh: fetchUsage };
}

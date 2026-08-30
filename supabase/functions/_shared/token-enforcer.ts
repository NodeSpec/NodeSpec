import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface TokenBudgetResult {
  allowed: boolean;
  reason?: string;
  totalBudget?: number;
  totalUsed?: number;
  hasByokKey?: boolean;
}

export interface AIBlockedResult {
  blocked: boolean;
  reason: string;
  hasByokKey: boolean;
  platformExhausted: boolean;
}

async function hasActiveByokKey(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("user_api_keys")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1);
  return (data ?? []).length > 0;
}

export async function checkTokenBudget(
  supabase: SupabaseClient,
  userId: string,
): Promise<TokenBudgetResult> {
  const { data: sub } = await supabase
    .from("stripe_subscriptions")
    .select(
      "token_limit, is_lifetime_limit, current_period_start, current_period_end, status",
    )
    .eq("user_id", userId)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const byokKey = await hasActiveByokKey(supabase, userId);

  if (!sub || !sub.token_limit || sub.token_limit === 0) {
    return { allowed: false, reason: "no_subscription", hasByokKey: byokKey };
  }

  let baseBudget = sub.token_limit;

  let usageQuery = supabase
    .from("token_usage")
    .select("input_tokens, output_tokens")
    .eq("user_id", userId)
    .eq("source", "platform");

  if (sub.is_lifetime_limit) {
    // lifetime cap: count all-time usage
  } else if (sub.current_period_start && sub.current_period_end) {
    usageQuery = usageQuery
      .gte("created_at", new Date(sub.current_period_start).toISOString())
      .lt("created_at", new Date(sub.current_period_end).toISOString());
  }

  const { data: usageRows } = await usageQuery;

  const totalUsed = (usageRows ?? []).reduce(
    (sum, row) => sum + (row.input_tokens ?? 0) + (row.output_tokens ?? 0),
    0,
  );

  const { data: addonRows } = await supabase
    .from("token_addons")
    .select("tokens_remaining")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());

  const addonTokens = (addonRows ?? []).reduce(
    (sum, row) => sum + (row.tokens_remaining ?? 0),
    0,
  );

  const totalBudget = baseBudget + addonTokens;

  if (totalUsed >= totalBudget) {
    return {
      allowed: false,
      reason: "token_limit_exceeded",
      totalBudget,
      totalUsed,
      hasByokKey: byokKey,
    };
  }

  return { allowed: true, totalBudget, totalUsed, hasByokKey: byokKey };
}

export async function isAIBlocked(
  supabase: SupabaseClient,
  userId: string,
): Promise<AIBlockedResult> {
  const budget = await checkTokenBudget(supabase, userId);
  const platformExhausted = !budget.allowed && budget.reason !== "no_subscription"
    ? true
    : budget.reason === "no_subscription";
  const hasByokKey = budget.hasByokKey ?? false;

  if (platformExhausted && !hasByokKey) {
    return {
      blocked: true,
      reason: "ai_blocked",
      hasByokKey,
      platformExhausted: true,
    };
  }

  return {
    blocked: false,
    reason: "",
    hasByokKey,
    platformExhausted,
  };
}

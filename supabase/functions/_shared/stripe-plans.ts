/*
  P0-8: single source of truth for the Stripe price -> plan mapping.

  Previously duplicated in stripe-webhook AND sync-subscription — and the copies had
  ALREADY drifted: sync's resolvePlanInfo gained nickname/amount fallbacks the webhook's
  never had. Both behaviors are preserved here verbatim (strict for the webhook, fallback
  for sync) so this dedupe is a pure move; converging them is a product decision, not a
  test-task side effect.

  CANONICALIZED 2026-08-25 (open-core GTM): plan names emitted here are the
  canonical tier vocabulary (tiers.ts). Grandfathered lookup keys keep billing
  under their old Stripe prices but resolve to the canonical successor
  (starter/architect/pro → team). New products MUST be created in Stripe with
  lookup keys matching PLAN_LOOKUP_KEYS below — plan ids are never string-
  concatenated into keys anymore (the old `price_${plan}_${interval}${suffix}`
  construction broke the moment the suffix convention drifted).

  Pure module (structural price type, no stripe import) — testable offline under deno test.
*/

export interface PlanInfo {
  name: string;
  tokenLimit: number;
}

export interface PriceLike {
  id?: string;
  lookup_key?: string | null;
  unit_amount?: number | null;
  nickname?: string | null;
  product?: unknown;
}

export const PLAN_BY_LOOKUP_KEY: Record<string, PlanInfo> = {
  // Current products
  price_indie_monthly_new: { name: 'indie', tokenLimit: 0 },
  price_indie_annual_new: { name: 'indie', tokenLimit: 0 },
  price_team_monthly: { name: 'team', tokenLimit: 35_000_000 },
  price_team_annual: { name: 'team', tokenLimit: 35_000_000 },
  // Grandfathered V1 products (billing continues; tier resolves to the successor)
  price_starter_monthly: { name: 'team', tokenLimit: 25_000_000 },
  price_starter_annual: { name: 'team', tokenLimit: 25_000_000 },
  price_architect_monthly: { name: 'team', tokenLimit: 25_000_000 },
  price_architect_annual: { name: 'team', tokenLimit: 25_000_000 },
  price_pro_monthly_new: { name: 'team', tokenLimit: 35_000_000 },
  price_pro_annual_new: { name: 'team', tokenLimit: 35_000_000 },
};

/** THE checkout construction map: plan id + interval -> Stripe lookup key.
 *  Mirrored client-side in src/ui/services/SubscriptionService.ts. */
export const PLAN_LOOKUP_KEYS: Record<'indie' | 'team', { month: string; year: string }> = {
  indie: { month: 'price_indie_monthly_new', year: 'price_indie_annual_new' },
  team: { month: 'price_team_monthly', year: 'price_team_annual' },
};

export const TOKEN_ADDON_LOOKUP_KEY = 'price_token_addon_1m';
export const TOKEN_ADDON_AMOUNT = 1_000_000;

/**
 * Owner ruling 2026-08-31 (Stripe catalog reset): the live purchasable catalog
 * is exactly Indie Monthly ($15/mo) and Indie Annual ($144/yr). Team is a
 * placeholder tier (its features are not built; planned separately) and the
 * token add-on product is archived, so CHECKOUT refuses both by name — while
 * PLAN_BY_LOOKUP_KEY keeps resolving every legacy/team key so grandfathered
 * subscriptions bill and classify exactly as before (archiving a product
 * never cancels its subscriptions). When Team ships, add its keys here.
 */
export const CHECKOUT_LOOKUP_KEYS = new Set([
  PLAN_LOOKUP_KEYS.indie.month,
  PLAN_LOOKUP_KEYS.indie.year,
]);

/** Every lookup key the RESOLUTION side recognizes (webhook/sync — includes
 *  grandfathered and placeholder keys checkout no longer sells). */
export const VALID_LOOKUP_KEYS = new Set([
  ...Object.keys(PLAN_BY_LOOKUP_KEY),
  TOKEN_ADDON_LOOKUP_KEY,
]);

/** stripe-webhook behavior: known lookup keys only; anything else is 'unknown'. */
export function resolvePlanInfoStrict(
  price: PriceLike,
): { name: string; tokenLimit: number; amountCents: number } {
  const lookupKey = price.lookup_key ?? '';
  const plan = PLAN_BY_LOOKUP_KEY[lookupKey];
  const amountCents = price.unit_amount ?? 0;

  if (plan) {
    return { ...plan, amountCents };
  }

  const productId = typeof price.product === 'string' ? price.product : price.product?.toString() ?? '';
  console.warn(`Unknown lookup key "${lookupKey}" for price ${price.id} (product: ${productId}), falling back to unknown`);
  return { name: 'unknown', tokenLimit: 0, amountCents };
}

/** sync-subscription behavior: lookup key, then nickname, then amount heuristics. */
export function resolvePlanInfoWithFallbacks(
  price: PriceLike,
): { name: string; tokenLimit: number; amountCents: number } {
  const lookupKey = price.lookup_key ?? '';
  const plan = PLAN_BY_LOOKUP_KEY[lookupKey];
  const amountCents = price.unit_amount ?? 0;
  if (plan) return { ...plan, amountCents };

  const nickname = (price.nickname ?? '').toLowerCase();
  if (nickname.includes('team')) return { name: 'team', tokenLimit: 35_000_000, amountCents };
  if (nickname.includes('pro')) return { name: 'team', tokenLimit: 35_000_000, amountCents };
  if (nickname.includes('architect')) return { name: 'team', tokenLimit: 25_000_000, amountCents };
  if (nickname.includes('starter')) return { name: 'team', tokenLimit: 25_000_000, amountCents };
  if (nickname.includes('indie')) return { name: 'indie', tokenLimit: 0, amountCents };

  // The current Indie amounts by exact value BEFORE the magnitude ladder —
  // Indie Annual is $144 (14400¢), which the >= 7900 team rung would
  // otherwise swallow when a price is missing its lookup key.
  if (amountCents === 1500 || amountCents === 14400) return { name: 'indie', tokenLimit: 0, amountCents };
  if (amountCents >= 7900) return { name: 'team', tokenLimit: 35_000_000, amountCents };
  if (amountCents >= 4000) return { name: 'team', tokenLimit: 25_000_000, amountCents };
  if (amountCents >= 1200) return { name: 'indie', tokenLimit: 0, amountCents };

  return { name: 'unknown', tokenLimit: 0, amountCents };
}

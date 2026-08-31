// P0-8: checkout per-tier validation/session params, the cancellation decision, and
// sync reconciliation — against the REAL extracted logic modules.
import { buildCheckoutSessionParams, validateCheckoutPrice } from '../stripe-checkout/logic.ts';
import { decideCancellation, ANNUAL_REFUND_WINDOW_DAYS } from '../cancel-subscription/logic.ts';
import { buildSyncUpsert } from '../sync-subscription/logic.ts';
import { PLAN_BY_LOOKUP_KEY } from '../_shared/stripe-plans.ts';
import { assert, assertEquals } from './helpers.ts';

// ── stripe-checkout ─────────────────────────────────────────────────────────────────

Deno.test('checkout: ONLY the live Indie prices sell; placeholders refuse by name (owner 2026-08-31)', () => {
  // The live purchasable catalog: Indie monthly + Indie annual.
  assertEquals(validateCheckoutPrice('price_indie_monthly_new'), null);
  assertEquals(validateCheckoutPrice('price_indie_annual_new'), null);
  // Team is a placeholder tier and the token add-on product is archived —
  // both refuse with a message that says WHY, never a generic "invalid".
  for (const key of Object.keys(PLAN_BY_LOOKUP_KEY)) {
    if (key.startsWith('price_indie_')) continue;
    const err = validateCheckoutPrice(key);
    assert(err !== null && err.includes('not available for purchase yet'), `${key}: ${err}`);
  }
  const addonErr = validateCheckoutPrice('price_token_addon_1m');
  assert(addonErr !== null && addonErr.includes('not currently offered'), String(addonErr));
  assert(validateCheckoutPrice('price_free_lunch') !== null, 'unknown key rejected');
  assert(validateCheckoutPrice('')!.includes('Invalid price identifier'), 'error names the problem');
});

Deno.test('checkout: session params carry customer, resolved price, mode and URLs', () => {
  const params = buildCheckoutSessionParams('cus_9', 'price_resolved_1', 'subscription', 'https://ok', 'https://no');
  assertEquals(params.customer, 'cus_9');
  assertEquals(params.line_items, [{ price: 'price_resolved_1', quantity: 1 }]);
  assertEquals(params.mode, 'subscription');
  assertEquals(params.success_url, 'https://ok');
  assertEquals(params.cancel_url, 'https://no');
  assertEquals(params.payment_method_types, ['card']);
});

// ── cancel-subscription ─────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60; // seconds

function subscriptionAt(interval: 'month' | 'year', startedDaysAgo: number, unitAmount = 50000) {
  const nowSec = 1_760_000_000;
  return {
    now: new Date(nowSec * 1000),
    sub: {
      current_period_start: nowSec - startedDaysAgo * DAY,
      current_period_end: nowSec + 300 * DAY,
      items: { data: [{ price: { recurring: { interval }, unit_amount: unitAmount } }] },
    },
  };
}

Deno.test('cancel: monthly plans always cancel at period end, no refund', () => {
  const { now, sub } = subscriptionAt('month', 2);
  const d = decideCancellation(sub, now);
  assertEquals(d.cancellationType, 'end_of_period');
  assertEquals(d.refundAmountCents, 0);
  assertEquals(d.effectiveEndDate, new Date(sub.current_period_end * 1000).toISOString());
});

Deno.test('cancel: annual within the 30-day window -> immediate with 11/12 refund', () => {
  const { now, sub } = subscriptionAt('year', 10, 60000);
  const d = decideCancellation(sub, now);
  assertEquals(d.cancellationType, 'immediate_with_refund');
  assertEquals(d.refundAmountCents, Math.round((60000 * 11) / 12));
  assertEquals(d.effectiveEndDate, now.toISOString());
});

Deno.test('cancel: annual outside the window -> end of period, no refund', () => {
  const { now, sub } = subscriptionAt('year', ANNUAL_REFUND_WINDOW_DAYS + 5);
  const d = decideCancellation(sub, now);
  assertEquals(d.cancellationType, 'end_of_period');
  assertEquals(d.refundAmountCents, 0);
});

Deno.test('cancel: window boundary day still refunds', () => {
  const { now, sub } = subscriptionAt('year', ANNUAL_REFUND_WINDOW_DAYS);
  assertEquals(decideCancellation(sub, now).cancellationType, 'immediate_with_refund');
});

// ── sync-subscription ───────────────────────────────────────────────────────────────

Deno.test('sync: reconciliation row carries resolved plan, interval, periods, payment method', () => {
  const { planName, status, upsertData } = buildSyncUpsert('user-1', 'cus_1', {
    id: 'sub_9',
    status: 'active',
    currency: 'usd',
    current_period_start: 1750000000,
    current_period_end: 1752600000,
    cancel_at_period_end: true,
    default_payment_method: { card: { brand: 'visa', last4: '4242' } },
    items: { data: [{ price: { id: 'price_1', lookup_key: 'price_architect_annual', unit_amount: 50000, recurring: { interval: 'year' } } }] },
  });

  assertEquals(planName, 'team');
  assertEquals(status, 'active');
  assertEquals(upsertData.plan_name, 'team');
  assertEquals(upsertData.billing_interval, 'year');
  assertEquals(upsertData.cancel_at_period_end, true);
  assertEquals(upsertData.payment_method_brand, 'visa');
  assertEquals(upsertData.payment_method_last4, '4242');
  assertEquals(upsertData.current_period_start, new Date(1750000000 * 1000).toISOString());
});

Deno.test('sync: unknown price falls back through nickname heuristics (the sync-only behavior)', () => {
  const { planName } = buildSyncUpsert('user-1', 'cus_1', {
    id: 'sub_9', status: 'active', currency: 'usd',
    current_period_start: 1750000000, current_period_end: 1752600000, cancel_at_period_end: false,
    default_payment_method: null,
    items: { data: [{ price: { id: 'price_x', lookup_key: 'legacy_mystery', nickname: 'Pro Grandfathered', unit_amount: 100, recurring: { interval: 'month' } } }] },
  });
  assertEquals(planName, 'team');
});

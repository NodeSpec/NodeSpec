// P0-8: pins the price -> plan mapping (previously duplicated AND drifted between
// stripe-webhook and sync-subscription; now single-sourced in _shared/stripe-plans.ts).
import {
  CHECKOUT_LOOKUP_KEYS,
  PLAN_BY_LOOKUP_KEY,
  resolvePlanInfoStrict,
  resolvePlanInfoWithFallbacks,
  VALID_LOOKUP_KEYS,
} from '../_shared/stripe-plans.ts';
import { assertEquals, assert } from './helpers.ts';

Deno.test('lookup keys map to the expected tiers', () => {
  assertEquals(PLAN_BY_LOOKUP_KEY['price_indie_monthly_new'].name, 'indie');
  assertEquals(PLAN_BY_LOOKUP_KEY['price_indie_annual_new'].name, 'indie');
  assertEquals(PLAN_BY_LOOKUP_KEY['price_team_monthly'].name, 'team');
  assertEquals(PLAN_BY_LOOKUP_KEY['price_team_annual'].name, 'team');
  // Grandfathered V1 products keep billing but resolve to the successor tier
  assertEquals(PLAN_BY_LOOKUP_KEY['price_starter_monthly'].name, 'team');
  assertEquals(PLAN_BY_LOOKUP_KEY['price_architect_annual'].name, 'team');
  assertEquals(PLAN_BY_LOOKUP_KEY['price_pro_monthly_new'].name, 'team');
  assertEquals(Object.keys(PLAN_BY_LOOKUP_KEY).length, 10);
});

Deno.test('resolution recognizes every key; checkout SELLS only live Indie (owner 2026-08-31)', () => {
  assertEquals(VALID_LOOKUP_KEYS.size, 10);
  assert(!VALID_LOOKUP_KEYS.has('price_token_addon_1m'), 'AH.2: the token add-on is gone');
  assert(!VALID_LOOKUP_KEYS.has('price_enterprise_secret'), 'unknown keys rejected');
  // The purchasable catalog after the Stripe reset: Indie monthly + annual.
  // Team is a placeholder (features unbuilt, planned separately).
  assertEquals([...CHECKOUT_LOOKUP_KEYS].sort(), ['price_indie_annual_new', 'price_indie_monthly_new']);
});

Deno.test('AH.2: a resolved plan carries its name and amount, and no token allowance', () => {
  assertEquals(resolvePlanInfoStrict({ lookup_key: 'price_team_monthly', unit_amount: 7900 }), { name: 'team', amountCents: 7900 });
  assertEquals(resolvePlanInfoWithFallbacks({ nickname: 'Pro Plan', unit_amount: 7900 }), { name: 'team', amountCents: 7900 });
  assertEquals(resolvePlanInfoWithFallbacks({ unit_amount: 14400 }), { name: 'indie', amountCents: 14400 });
  for (const plan of Object.values(PLAN_BY_LOOKUP_KEY)) assertEquals(Object.keys(plan), ['name']);
});

Deno.test('strict resolver (webhook behavior): unknown lookup key -> unknown, no heuristics', () => {
  const r = resolvePlanInfoStrict({ id: 'price_x', lookup_key: 'mystery', unit_amount: 7900, nickname: 'Pro Plan' });
  assertEquals(r.name, 'unknown');
  assertEquals(r.amountCents, 7900);
});

Deno.test('fallback resolver (sync behavior): nickname then amount heuristics', () => {
  assertEquals(resolvePlanInfoWithFallbacks({ lookup_key: 'price_pro_annual_new', unit_amount: 79900 }).name, 'team');
  assertEquals(resolvePlanInfoWithFallbacks({ lookup_key: '', nickname: 'Team Monthly', unit_amount: 100 }).name, 'team');
  assertEquals(resolvePlanInfoWithFallbacks({ lookup_key: '', nickname: 'Architect (legacy)', unit_amount: 100 }).name, 'team');
  assertEquals(resolvePlanInfoWithFallbacks({ lookup_key: '', nickname: 'Starter', unit_amount: 100 }).name, 'team');
  assertEquals(resolvePlanInfoWithFallbacks({ lookup_key: '', nickname: '', unit_amount: 7900 }).name, 'team');
  assertEquals(resolvePlanInfoWithFallbacks({ lookup_key: '', nickname: '', unit_amount: 4000 }).name, 'team');
  assertEquals(resolvePlanInfoWithFallbacks({ lookup_key: '', nickname: '', unit_amount: 1200 }).name, 'indie');
  assertEquals(resolvePlanInfoWithFallbacks({ lookup_key: '', nickname: '', unit_amount: 100 }).name, 'unknown');
  // Current Indie amounts resolve as indie by exact value — Indie Annual is
  // $144 (14400¢), which the >= 7900 team rung would otherwise swallow.
  assertEquals(resolvePlanInfoWithFallbacks({ lookup_key: '', nickname: '', unit_amount: 14400 }).name, 'indie');
  assertEquals(resolvePlanInfoWithFallbacks({ lookup_key: '', nickname: '', unit_amount: 1500 }).name, 'indie');
});

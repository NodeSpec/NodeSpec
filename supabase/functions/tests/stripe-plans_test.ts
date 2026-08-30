// P0-8: pins the price -> plan mapping (previously duplicated AND drifted between
// stripe-webhook and sync-subscription; now single-sourced in _shared/stripe-plans.ts).
import {
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

Deno.test('checkout accepts exactly the plan keys plus the token addon', () => {
  assertEquals(VALID_LOOKUP_KEYS.size, 11);
  assert(VALID_LOOKUP_KEYS.has('price_token_addon_1m'), 'addon key accepted');
  assert(!VALID_LOOKUP_KEYS.has('price_enterprise_secret'), 'unknown keys rejected');
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
});

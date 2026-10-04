// Owner directive 2026-09-15: the tier-specific chrome (Team seats chrome,
// Enterprise, the Government classification banner) must never leak into
// ordinary local testing — it is exercised deliberately, under a SEPARATE
// test configuration flag, one tier at a time.
//
//   VITE_NODESPEC_TEST_TIER=community | indie | team | enterprise | government
//   (.env.local — any spelling canonicalizeTier resolves. R18: the DOWNWARD
//   overrides matter too: the seeded bench account is Team, so presenting a
//   Community or Indie account locally takes an explicit override.)
//
// DEV-ONLY by construction: the override is read behind import.meta.env.DEV,
// so a production bundle ignores the variable entirely — a hosted account's
// tier always comes from the live subscription, a self-hosted one from the
// signed license. This flag changes CLIENT PRESENTATION only; the server
// gates (requireFeature over getEffectiveTier) still resolve the real tier,
// which is why the runbook's server-side Government proof still bumps the
// seeded subscription row.
import { canonicalizeTier, type PlanTier } from './tiers.js';

export function testTierOverride(): PlanTier | null {
  if (!import.meta.env.DEV) return null;
  const raw = import.meta.env.VITE_NODESPEC_TEST_TIER;
  return canonicalizeTier(typeof raw === 'string' ? raw : null);
}

/*
  Canonical tier vocabulary — CLIENT MIRROR of
  supabase/functions/_shared/tiers.ts (open-core GTM, owner ruling 2026-08-25).

  Five tiers, one spelling, everywhere:

      community · indie · team · enterprise · government

  Legacy V1 names (free/indie/architect/pro + the 'starter' alias) resolve at
  read boundaries only; write paths emit canonical IDs. The two copies exist
  because the client bundle cannot import Deno-path modules — they are kept in
  lockstep by src/tests/tiers-parity.test.ts. Change BOTH or the test fails.
*/

export type PlanTier = 'community' | 'indie' | 'team' | 'enterprise' | 'government';

export const CANONICAL_TIERS: PlanTier[] = ['community', 'indie', 'team', 'enterprise', 'government'];

/** Legacy → canonical. starter/architect/pro were the V1 paid ladder; team is
 *  their successor (grandfathered prices keep billing, resolve as team). */
export const LEGACY_TIER_ALIASES: Record<string, PlanTier> = {
  free: 'community',
  starter: 'team',
  architect: 'team',
  pro: 'team',
};

/** Higher rank includes every capability of lower ranks. */
export const TIER_RANK: Record<PlanTier, number> = {
  community: 0,
  indie: 1,
  team: 2,
  enterprise: 3,
  government: 4,
};

/** Hosted Free accounts include two projects (owner ruling 2026-08-31 Stripe
 *  round; supersedes the 1-project 2026-08-25 cap). Self-host deployments are
 *  uncapped at every tier — the container is the free product. */
export const HOSTED_COMMUNITY_PROJECT_LIMIT = 2;

/**
 * Resolve any tier/plan string — canonical, legacy, or a display-decorated
 * plan_name like 'Pro Annual' — to a canonical tier. Substring fallback is
 * deliberate: plan_name is free text and historical rows carry decorations
 * (this replaces the previously DIVERGENT server-substring vs client-equality
 * ladders with one behavior). Sentinels ('pending', 'unknown') and anything
 * unrecognized return null; callers choose their own fail-closed default.
 */
export function canonicalizeTier(raw: string | null | undefined): PlanTier | null {
  const s = (raw ?? '').toLowerCase().trim();
  if (!s) return null;
  if ((CANONICAL_TIERS as string[]).includes(s)) return s as PlanTier;
  if (LEGACY_TIER_ALIASES[s]) return LEGACY_TIER_ALIASES[s];
  if (s.includes('government')) return 'government';
  if (s.includes('enterprise')) return 'enterprise';
  if (s.includes('team')) return 'team';
  if (s.includes('pro') || s.includes('architect') || s.includes('starter')) return 'team';
  if (s.includes('indie')) return 'indie';
  if (s.includes('community') || s.includes('free')) return 'community';
  return null;
}

/** Canonical public display names (legacy inputs resolve first). */
export function tierDisplayName(raw: string | null | undefined): string {
  const tier = canonicalizeTier(raw);
  if (!tier) return raw ? raw : 'No Plan';
  const names: Record<PlanTier, string> = {
    community: 'Community',
    indie: 'Indie',
    team: 'Team',
    enterprise: 'Enterprise',
    government: 'Government',
  };
  return names[tier];
}

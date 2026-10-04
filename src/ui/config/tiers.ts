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

/** Whether this account has used every project it may have. Only the managed
 *  site caps, and only Free; a self-hosted build (the open source container,
 *  a licensed install) has no cap (owner 2026-09-28). The database refuses
 *  the same insert (projects_plan_cap) and so does MCP create_project. */
export function projectCapReached(plan: PlanTier, projectCount: number, hosted: boolean): boolean {
  return hosted && plan === 'community' && projectCount >= HOSTED_COMMUNITY_PROJECT_LIMIT;
}

/** The managed site sells Free, Indie and Team; Enterprise and Government
 *  are licensed installs (owner 2026-09-26, item 3). A hosted account's plan
 *  never resolves above Team, whatever its plan_name says (audit, owner
 *  2026-09-27), so no hosted account reaches an Enterprise or Government
 *  feature. Self-hosted tiers come from the signed licence, not from here. */
export const HOSTED_TIER_CEILING: PlanTier = 'team';

export function hostedTier(tier: PlanTier): PlanTier {
  return TIER_RANK[tier] > TIER_RANK[HOSTED_TIER_CEILING] ? HOSTED_TIER_CEILING : tier;
}

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

/*
  V3 P3 (task 3.3): the UI variant — `individual | team` (Workflow Space
  design: `variant: individual|team`).

  The variant RESOLVES from edition/tier only; there is deliberately no
  setter, no stored preference, no toggle anywhere in this module — an
  Individual account cannot present itself as Team by flipping local
  state, because the variant is presentation shorthand for capabilities
  the SERVER gates anyway (R1: multi-lane + presence is Team+; the P7
  feature rules are the enforcement, this is the display contract).

  What the variant switches (consumed by the P4-P6 boards):
  - individual — single lane, no presence, owner-only chrome.
  - team       — lanes with owners/contributors, presence, the shared
                 approvals surfaces. Government renders the team variant
                 (its classification marks are item DATA gated by tier,
                 P7.3 — never a fourth layout).

  Resolution order:
  1. Self-hosted enterprise edition → team (the licensed customer bundle
     is team-grade; its container has no billing rows to rank).
  2. Otherwise rank the canonical tier: team and above → team;
     community/indie (and anything unresolvable) → individual.
*/
import { TIER_RANK, type PlanTier } from './tiers.js';
import { isEnterpriseEdition } from './edition.js';

export type UIVariant = 'individual' | 'team';

export function resolveVariant(
  plan: PlanTier | null | undefined,
  opts: { enterpriseEdition?: boolean } = {},
): UIVariant {
  const enterprise = opts.enterpriseEdition ?? isEnterpriseEdition;
  if (enterprise) return 'team';
  if (!plan) return 'individual';
  return TIER_RANK[plan] >= TIER_RANK.team ? 'team' : 'individual';
}

/*
  SHIP-1(e) · THE deployment-mode seam (runbook §6: "First SaaS-only
  divergence introduces ONE deployment-mode flag — config, never a branch").

  NODESPEC_DEPLOYMENT=self-hosted is that flag. This module is the ONLY place
  server code branches on it for tier resolution: hosted deployments read the
  Stripe-synced subscription (user-tier.ts, unchanged); self-hosted
  deployments read the signed license (selfhost-license.ts) — same PlanTier
  vocabulary, different source, per the SHIP-1 doctrine. Everything downstream
  keeps speaking PlanTier and never learns where it came from.

  The license verdict is cached per isolate: the license is deployment-wide
  (not per-user), verification is pure CPU, and a warm cache keeps the seam
  free for every tool call.
*/
import type { PlanTier } from './tiers.ts';
import { getUserTier } from './user-tier.ts';
import { resolveSelfHostTier } from './selfhost-license.ts';

type EnvReader = { get(name: string): string | undefined };

export function isSelfHosted(env: EnvReader = Deno.env): boolean {
  return env.get('NODESPEC_DEPLOYMENT') === 'self-hosted';
}

let cachedLicenseTier: { tier: PlanTier; licensee?: string; reason?: string } | null = null;

/** Test seam: the per-isolate license cache. */
export function resetLicenseTierCache(): void {
  cachedLicenseTier = null;
}

export async function getLicenseTier(
  env: EnvReader = Deno.env,
  now: Date = new Date(),
): Promise<{ tier: PlanTier; licensee?: string; reason?: string }> {
  if (!cachedLicenseTier) {
    cachedLicenseTier = await resolveSelfHostTier(
      { license: env.get('NODESPEC_LICENSE'), publicKey: env.get('NODESPEC_LICENSE_PUBLIC_KEY') },
      now,
    );
    if (cachedLicenseTier.reason) {
      // Fail-closed is doctrine, silent is not: the reason names the fix.
      console.warn(`[selfhost-license] running unlicensed (tier 'community'): ${cachedLicenseTier.reason}`);
    }
  }
  return cachedLicenseTier;
}

/**
 * The tier every caller should use. Hosted → Stripe subscription;
 * self-hosted → signed license (fail-closed 'community'). AMENDED 2026-08-25
 * (open-core GTM): tiers now gate two things — the hosted community project
 * cap and repo import (indie+ on hosted; absent from the community bundle).
 */
export async function getEffectiveTier(
  // Structural type mirrors user-tier.ts's SubscriptionQueryClient seam.
  supabase: Parameters<typeof getUserTier>[0],
  userId: string,
  env: EnvReader = Deno.env,
): Promise<PlanTier> {
  if (isSelfHosted(env)) return (await getLicenseTier(env)).tier;
  return getUserTier(supabase, userId);
}

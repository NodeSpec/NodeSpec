import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSubscription, useAuth } from '../context/ServiceContext.js';
import { isProvisioningInFlight } from '../services/SubscriptionService.js';
import type { SubscriptionInfo } from '../services/SubscriptionService.js';

import {
  canonicalizeTier, hostedTier,
  projectCapReached,
} from '../config/tiers.js';
import { FEATURE_RULES, featureAvailable, type Feature, type FeatureRule } from '../config/feature-rules.js';
import { testTierOverride } from '../config/test-tier.js';
import { isHostedEdition, isLicensedEdition, buildEdition } from '../config/edition.js';
import { readLicencePlan } from '../services/licence-plan.js';
import type { PlanTier } from '../config/tiers.js';

export type { PlanTier } from '../config/tiers.js';

// 7.1: the rules live in src/ui/config/feature-rules.ts (the client mirror of
// the server table every closed tool refuses through); this hook binds them
// to the live plan. The Feature vocabulary is the stable surface call sites
// and self-host licensing both speak.
export type { Feature, FeatureRule } from '../config/feature-rules.js';

/** Exported for the AccountPanel build-identity stamp (R18) — one resolver,
 *  so the stamp can never disagree with the gate about what the tier is. */
export function planFromSubscription(sub: SubscriptionInfo | null): PlanTier {
  if (!sub || !['active', 'trialing'].includes(sub.status)) return 'community';
  // Shared resolver — the old exact-equality ladder here disagreed with the
  // server's substring version; canonicalizeTier is now the single behavior.
  // A hosted plan never resolves above Team (audit, owner 2026-09-27).
  return hostedTier(canonicalizeTier(sub.planName) ?? 'community');
}

export interface FeatureGate {
  plan: PlanTier;
  subscription: SubscriptionInfo | null;
  loading: boolean;
  can: (feature: Feature) => boolean;
  check: (feature: Feature) => { allowed: boolean; rule: FeatureRule };
  projectLimitReached: (currentCount: number) => boolean;
  refresh: () => Promise<void>;
  refreshUntilActive: () => void;
  /** AJ.6: the project is the account's example (useProjectFeatureGate only). */
  example?: boolean;
  /** AJ.6: in the example, a feature shown with its data that the owner's
   *  plan does not carry: the surface reads and does not write. */
  viewOnly?: (feature: Feature) => boolean;
}

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 20;

export function useFeatureGate(): FeatureGate {
  const subscriptionService = useSubscription();
  const auth = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  /** Item 3: the Enterprise build's plan, the licence the server verified. */
  const [licencePlan, setLicencePlan] = useState<PlanTier | null>(null);
  const [loading, setLoading] = useState(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);
  const recoveryAttemptedRef = useRef(false);

  const fetchSubscription = useCallback(async () => {
    try {
      const session = await auth.getSession();
      if (!session?.user?.id) return null;
      return await subscriptionService.getCurrentSubscription(session.user.id);
    } catch {
      return null;
    }
  }, [auth, subscriptionService]);

  const attemptRecovery = useCallback(async (): Promise<SubscriptionInfo | null> => {
    // Recovery provisioning is a HOSTED repair path. Self-hosted builds have
    // no billing rows by design (tiers come from the license, server-side) —
    // calling the provisioning function from here just resurrects the
    // "Account setup encountered an issue" class of failure.
    if (!isHostedEdition) return null;
    if (recoveryAttemptedRef.current) return null;
    if (isProvisioningInFlight()) return null;
    recoveryAttemptedRef.current = true;
    try {
      const session = await auth.getSession();
      if (!session?.session?.access_token) return null;
      console.warn('[useFeatureGate] No subscription found, attempting recovery provisioning');
      const ok = await subscriptionService.ensureFreeCustomer(session.session.access_token);
      if (!ok) {
        console.error('[useFeatureGate] Recovery provisioning failed');
        return null;
      }
      return await subscriptionService.getCurrentSubscription(session.user.id);
    } catch (err) {
      console.error('[useFeatureGate] Recovery error:', err);
      return null;
    }
  }, [auth, subscriptionService]);

  const refresh = useCallback(async () => {
    const sub = await fetchSubscription();
    setSubscription(sub);
    setLoading(false);
  }, [fetchSubscription]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollCountRef.current = 0;
  }, []);

  const refreshUntilActive = useCallback(() => {
    stopPolling();
    pollCountRef.current = 0;

    const poll = async () => {
      pollCountRef.current += 1;

      if (pollCountRef.current <= 3) {
        try {
          const session = await auth.getSession();
          if (session?.session?.access_token) {
            await subscriptionService.syncFromStripe(session.session.access_token);
          }
        } catch { /* sync is best-effort */ }
      }

      const sub = await fetchSubscription();
      setSubscription(sub);
      setLoading(false);

      const resolved = sub && ['active', 'trialing'].includes(sub.status) && sub.planName !== 'pending';
      if (resolved || pollCountRef.current >= MAX_POLL_ATTEMPTS) {
        stopPolling();
        return;
      }

      pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();
  }, [auth, subscriptionService, fetchSubscription, stopPolling]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Item 3 (owner 2026-09-26): a licensed container is NodeSpec
      // Enterprise, or Government; it has no Stripe rows, and its plan is
      // the licence, which only the server verifies.
      if (isLicensedEdition) {
        let tier: PlanTier | null = null;
        try {
          const session = await auth.getSession();
          const userId = session?.user?.id;
          const token = session?.session?.access_token;
          if (userId && token) tier = await readLicencePlan(userId, token);
        } catch { /* the gate stays at community, as the server does */ }
        if (cancelled) return;
        setLicencePlan(tier);
        setLoading(false);
        return;
      }

      let sub = await fetchSubscription();
      if (cancelled) return;

      if (!sub) {
        const recovered = await attemptRecovery();
        if (cancelled) return;
        if (recovered) sub = recovered;
      }

      setSubscription(sub);
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [fetchSubscription, stopPolling, attemptRecovery, auth]);

  // Owner 2026-09-15: local tier-variant testing rides an explicit flag
  // (VITE_NODESPEC_TEST_TIER, dev builds only) — never the seeded billing row.
  const plan = useMemo(
    () => testTierOverride() ?? (isLicensedEdition ? licencePlan ?? 'community' : planFromSubscription(subscription)),
    [subscription, licencePlan],
  );

  // R9: BOTH axes. A build that does not carry the code never claims the
  // feature, whatever tier the account resolves to — fail-closed, so a
  // forged or stale subscription cannot light up chrome for a module the
  // community tree does not contain. Planned features are never available.
  const can = useCallback(
    (feature: Feature): boolean => featureAvailable(plan, feature, buildEdition),
    [plan]
  );

  const check = useCallback(
    (feature: Feature) => ({ allowed: featureAvailable(plan, feature, buildEdition), rule: FEATURE_RULES[feature] }),
    [plan]
  );

  // Hosted Free: two projects; Indie and above, and every self-hosted build,
  // are uncapped (projectCapReached; the database and MCP create_project
  // refuse the same).
  const projectLimitReached = useCallback(
    (currentCount: number): boolean => projectCapReached(plan, currentCount, isHostedEdition),
    [plan]
  );

  return { plan, subscription, loading, can, check, projectLimitReached, refresh, refreshUntilActive };
}

export function getFeatureRule(feature: Feature): FeatureRule {
  return FEATURE_RULES[feature];
}

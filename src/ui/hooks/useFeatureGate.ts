import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSubscription, useAuth } from '../context/ServiceContext.js';
import { isProvisioningInFlight } from '../services/SubscriptionService.js';
import type { SubscriptionInfo } from '../services/SubscriptionService.js';

import {
  canonicalizeTier,
  HOSTED_COMMUNITY_PROJECT_LIMIT,
  TIER_RANK,
} from '../config/tiers.js';
import { isHostedEdition } from '../config/edition.js';
import type { PlanTier } from '../config/tiers.js';

export type { PlanTier } from '../config/tiers.js';

export type Feature =
  | 'chat'
  | 'node_generate'
  | 'architecture_generation'
  | 'git_push'
  | 'git_pull'
  | 'repo_import'
  | 'node_context_export'
  | 'unlimited_projects'
  | 'mcp_connectivity'
  | 'mcp_write_scope';

interface FeatureRule {
  minimumTier: PlanTier;
  label: string;
  upgradeMessage: string;
}

// AMENDED 2026-08-25 (open-core GTM): tiers gate again, narrowly. Hosted
// Community includes ONE project (server-enforced in MCP create_project too),
// and repo import is Indie+ on hosted (absent from the community bundle
// entirely). Everything else stays every-tier; the Feature vocabulary is the
// stable surface call sites and self-host licensing both speak.
const FEATURE_RULES: Record<Feature, FeatureRule> = {
  chat: {
    minimumTier: 'community',
    label: 'AI Chat',
    upgradeMessage: 'AI chat is available on all plans.',
  },
  node_generate: {
    minimumTier: 'community',
    label: 'Generate Code',
    upgradeMessage: 'Code generation is available on all plans.',
  },
  architecture_generation: {
    minimumTier: 'community',
    label: 'Architecture Generation',
    upgradeMessage: 'Architecture generation is available on all plans.',
  },
  git_push: {
    minimumTier: 'community',
    label: 'Git Export',
    upgradeMessage: 'Git export is available on all tiers.',
  },
  git_pull: {
    minimumTier: 'community',
    label: 'Git Import',
    upgradeMessage: 'Git import is available on all tiers.',
  },
  repo_import: {
    minimumTier: 'indie',
    label: 'Repo Import',
    upgradeMessage: 'Repo import reverse visualization is available on Indie and above.',
  },
  node_context_export: {
    minimumTier: 'community',
    label: 'Node Context Export',
    upgradeMessage: 'Node context export is available on all tiers.',
  },
  unlimited_projects: {
    minimumTier: 'indie',
    label: 'Multiple Projects',
    upgradeMessage: 'Hosted Community includes 1 project; Indie and above are unlimited.',
  },
  mcp_connectivity: {
    minimumTier: 'community',
    label: 'Agent Connectivity (MCP)',
    upgradeMessage: 'MCP agent connectivity is available on all tiers.',
  },
  mcp_write_scope: {
    minimumTier: 'community',
    label: 'Agent Write Scope',
    upgradeMessage: 'The MCP write scope is available on all tiers.',
  },
};

function planFromSubscription(sub: SubscriptionInfo | null): PlanTier {
  if (!sub || !['active', 'trialing'].includes(sub.status)) return 'community';
  // Shared resolver — the old exact-equality ladder here disagreed with the
  // server's substring version; canonicalizeTier is now the single behavior.
  return canonicalizeTier(sub.planName) ?? 'community';
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
}

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 20;

export function useFeatureGate(): FeatureGate {
  const subscriptionService = useSubscription();
  const auth = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
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
  }, [fetchSubscription, stopPolling, attemptRecovery]);

  const plan = useMemo(() => planFromSubscription(subscription), [subscription]);

  const can = useCallback(
    (feature: Feature): boolean => {
      const rule = FEATURE_RULES[feature];
      return TIER_RANK[plan] >= TIER_RANK[rule.minimumTier];
    },
    [plan]
  );

  const check = useCallback(
    (feature: Feature) => {
      const rule = FEATURE_RULES[feature];
      return { allowed: TIER_RANK[plan] >= TIER_RANK[rule.minimumTier], rule };
    },
    [plan]
  );

  const projectLimitReached = useCallback(
    (currentCount: number): boolean => {
      // Hosted Community: 1 project (2026-08-25 open-core GTM; server mirror
      // in MCP create_project). Indie and above are unlimited. Self-hosted
      // deployments are UNCAPPED — same lift the server applies (projects.ts
      // checks NODESPEC_DEPLOYMENT); without this, the container's users all
      // resolve to 'community' (no billing rows) and hit the hosted-Free cap.
      if (!isHostedEdition) return false;
      if (plan === 'community') return currentCount >= HOSTED_COMMUNITY_PROJECT_LIMIT;
      return false;
    },
    [plan]
  );

  return { plan, subscription, loading, can, check, projectLimitReached, refresh, refreshUntilActive };
}

export function getFeatureRule(feature: Feature): FeatureRule {
  return FEATURE_RULES[feature];
}

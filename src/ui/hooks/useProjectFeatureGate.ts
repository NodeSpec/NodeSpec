// V3 decision 1 (owner ruling 2026-09-26): inside a project, what the
// project carries follows its owner's plan, for everyone seated on it;
// only what is the person's (the project count, the agent allowance, the
// key's scopes) follows their own. This composes the person's gate
// (useFeatureGate) with the project's plan, read once per project from the
// database's answer (project_plan_tier), which is the same owner the RLS
// policies and the MCP server read.
//
// Asked on the hosted edition only: a self-hosted or community build's plan
// is its licence, which the database does not hold (it answers NULL there),
// so those builds keep the person's gate. A failed or empty answer also
// keeps the person's gate: the server and the database enforce the rule
// either way, and the surface is never blanked by a read that did not land.
//
// AJ.6 (owner 2026-09-30): every account has an example project. There the
// gate carries every feature the build ships, so each surface draws with its
// data, and viewOnly(feature) says which of them the owner's plan does not
// carry: those surfaces show and do not write (the database refuses the
// writes either way). Asked on every edition, since the open source and
// Enterprise builds ship the example too. The answer never holds the gate's
// loading: until it lands the project reads as not the example (fail
// closed), and the app primes it from the project row it opens
// (noteProjectExample), so the example draws whole from the first frame.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../persistence/supabase/client.js';
import { useFeatureGate, type FeatureGate } from './useFeatureGate.js';
import { FEATURE_RULES, featureAvailable, featureInEdition, featurePlanned, governedByProject, type Feature } from '../config/feature-rules.js';
import { canonicalizeTier, type PlanTier } from '../config/tiers.js';
import { buildEdition, isHostedEdition } from '../config/edition.js';
import { testTierOverride } from '../config/test-tier.js';

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; plan: Promise<PlanTier | null> }>();

/** The project's plan as the database answers it, or null when it gives
 *  none (not a member, self-hosted, or the read failed). Shared across the
 *  surfaces of one project for a minute. */
export function readProjectPlan(projectId: string, fresh = false): Promise<PlanTier | null> {
  const hit = cache.get(projectId);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.plan;
  const plan = (async () => {
    try {
      const { data, error } = await getSupabaseClient().rpc('project_plan_tier', { p_project_id: projectId });
      if (error || typeof data !== 'string') return null;
      return canonicalizeTier(data);
    } catch {
      return null;
    }
  })();
  cache.set(projectId, { at: Date.now(), plan });
  return plan;
}

const examples = new Map<string, Promise<boolean>>();
const knownExamples = new Map<string, boolean>();

/** The app opened this project and read its row: remember whether it is the
 *  example, so every gate on the page knows before its first render. */
export function noteProjectExample(projectId: string, example: boolean): void {
  knownExamples.set(projectId, example);
  examples.set(projectId, Promise.resolve(example));
}

/** Whether the project is the account's example (projects.metadata.example,
 *  which only the database's ensure_example_project writes). The mark never
 *  changes, so the answer is kept for the session; a failed read is no. */
export function readProjectExample(projectId: string): Promise<boolean> {
  const hit = examples.get(projectId);
  if (hit) return hit;
  const answer = (async () => {
    try {
      const { data, error } = await getSupabaseClient().rpc('is_example_project', { p_project_id: projectId });
      return !error && data === true;
    } catch {
      return false;
    }
  })();
  examples.set(projectId, answer);
  return answer;
}

/** Test seam: forget every cached answer. */
export function forgetProjectPlans(): void {
  cache.clear();
  examples.clear();
  knownExamples.clear();
}

export function useProjectFeatureGate(projectId: string | null | undefined): FeatureGate {
  const own = useFeatureGate();
  const asks = isHostedEdition && !testTierOverride() && !!projectId;
  const [answer, setAnswer] = useState<{ projectId: string; plan: PlanTier | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [exampleAnswer, setExampleAnswer] = useState<{ projectId: string; example: boolean } | null>(null);

  useEffect(() => {
    if (!asks || !projectId) return;
    let cancelled = false;
    readProjectPlan(projectId, nonce > 0).then((plan) => {
      if (!cancelled) setAnswer({ projectId, plan });
    });
    return () => { cancelled = true; };
  }, [asks, projectId, nonce]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    readProjectExample(projectId).then((example) => {
      if (!cancelled) setExampleAnswer({ projectId, example });
    });
    return () => { cancelled = true; };
  }, [projectId]);

  const settled = !asks || answer?.projectId === projectId;
  const projectPlan: PlanTier | null = asks && answer?.projectId === projectId ? answer.plan : null;
  const plan: PlanTier = projectPlan ?? own.plan;
  const example = !!projectId && (knownExamples.get(projectId) ?? (exampleAnswer?.projectId === projectId && exampleAnswer.example));

  /** What the plan carries, the example aside. */
  const carried = useCallback(
    (feature: Feature): boolean => (governedByProject(feature) && projectPlan ? featureAvailable(projectPlan, feature, buildEdition) : own.can(feature)),
    [projectPlan, own],
  );
  /** In the example, every feature the project carries and this build ships. */
  const shown = useCallback(
    (feature: Feature): boolean => example && governedByProject(feature) && !featurePlanned(feature) && featureInEdition(feature, buildEdition),
    [example],
  );
  const can = useCallback((feature: Feature): boolean => carried(feature) || shown(feature), [carried, shown]);
  const viewOnly = useCallback((feature: Feature): boolean => shown(feature) && !carried(feature), [carried, shown]);
  const check = useCallback(
    (feature: Feature) => ({ allowed: can(feature), rule: FEATURE_RULES[feature] }),
    [can],
  );
  const refresh = useCallback(async () => {
    await own.refresh();
    setNonce((n) => n + 1);
  }, [own]);
  const refreshUntilActive = useCallback(() => {
    own.refreshUntilActive();
    setNonce((n) => n + 1);
  }, [own]);

  return useMemo(() => ({
    ...own,
    plan,
    loading: own.loading || !settled,
    can,
    check,
    refresh,
    refreshUntilActive,
    example,
    viewOnly,
  }), [own, plan, settled, can, check, refresh, refreshUntilActive, example, viewOnly]);
}

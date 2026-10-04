// Item 3 (owner 2026-09-26): a licensed self-hosted deployment is NodeSpec
// Enterprise (Team, Indie and Free are managed Supabase only), or Government
// when its licence says so. The Enterprise build's name and layout come from
// the build; its plan comes from the licence, which only the server can
// verify (NODESPEC_LICENSE against the public key, _shared/deployment.ts).
// A container has no Stripe rows, so reading the subscription, as the hosted
// app does, drew every licensed deployment as Free.
//
// The app asks the server that already answers it: list_api_keys, called as
// the signed-in person (the Agents panel's own call), reports the caller's
// plan as `connections.tier`, which is getEffectiveTier: the verified licence
// on a container. An unlicensed, expired or altered licence answers
// community there, and so it does here; a read that fails answers null and
// the gate stays at community, the same fail-closed rule as the server.
import { callMcpToolAsUser, mcpServerUrl, type McpCallDeps } from './agent-connections.js';
import { canonicalizeTier, type PlanTier } from '../config/tiers.js';

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; plan: Promise<PlanTier | null> }>();

/** The deployment's plan as the server verified it for this person, or null
 *  when the server did not answer. Shared by every gate for ten minutes. */
export function readLicencePlan(userId: string, accessToken: string, deps?: Partial<McpCallDeps>): Promise<PlanTier | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.plan;
  const call: McpCallDeps = {
    fetch: deps?.fetch ?? ((...args) => globalThis.fetch(...args)),
    accessToken: deps?.accessToken ?? (async () => accessToken),
    url: deps?.url ?? (() => mcpServerUrl()),
  };
  const plan = (async () => {
    const answer = await callMcpToolAsUser<{ connections?: { tier?: unknown } }>('list_api_keys', {}, call);
    if (!answer.ok) return null;
    const tier = answer.data?.connections?.tier;
    return typeof tier === 'string' ? canonicalizeTier(tier) : null;
  })();
  cache.set(userId, { at: Date.now(), plan });
  plan.then((p) => { if (p === null) cache.delete(userId); }, () => cache.delete(userId));
  return plan;
}

/** Test seam, and sign-out: the next gate asks the server again. */
export function forgetLicencePlan(): void {
  cache.clear();
}

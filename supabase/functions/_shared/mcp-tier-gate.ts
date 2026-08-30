/*
  MCP tier gating.

  HISTORY: P0-6 (2026-07-13) added the paid gate on 'write' for the V1 funnel
  (free = read + propose). RE-RULED 2026-08-10 with the GTM pricing model:
  "all features, every tier" — Community (free) accounts hold every capability;
  tiers differ by scale (the 2-project cap lives in create_project) and by
  deployment, never by feature. Scope-by-tier gating is therefore RETIRED:
  every tier resolves all three scopes.

  VOCABULARY CANONICALIZED 2026-08-25 (open-core GTM): PlanTier now lives in
  tiers.ts as community/indie/team/enterprise/government; legacy V1 names
  resolve through canonicalizeTier at read boundaries. This re-export keeps
  the many existing `import type { PlanTier } from './mcp-tier-gate.ts'`
  sites stable.

  Pure module: no env, no Deno globals — vitest tests the real shipped logic.
*/
import type { PlanTier } from './tiers.ts';

export type { PlanTier } from './tiers.ts';
export type McpScope = 'read' | 'write' | 'propose';

export const ALL_SCOPES: McpScope[] = ['read', 'write', 'propose'];
/** Kept for callers that referenced the old free matrix; identical to ALL_SCOPES
    since the 2026-08-10 all-features ruling. */
export const FREE_TIER_SCOPES: McpScope[] = [...ALL_SCOPES];

/** Gate a tool call. Since the all-features ruling, no scope is tier-restricted. */
export function checkTierForScope(
  _tier: PlanTier,
  _requiredScope: string | undefined,
): { allowed: true } | { allowed: false; error: string } {
  return { allowed: true };
}

/**
 * Resolve the scopes a new API key may carry.
 * - No explicit request: all three scopes, every tier.
 * - Explicit request: honored after vocabulary validation.
 */
export function resolveApiKeyScopesForTier(
  _tier: PlanTier,
  requestedScopes?: string[],
): { scopes: string[] } | { error: string } {
  const validScopes: string[] = ALL_SCOPES;

  if (!requestedScopes || requestedScopes.length === 0) {
    return { scopes: [...ALL_SCOPES] };
  }

  const invalid = requestedScopes.filter((s) => !validScopes.includes(s));
  if (invalid.length > 0) {
    return { error: `Invalid scopes: ${invalid.join(', ')}. Valid scopes: ${validScopes.join(', ')}` };
  }

  return { scopes: [...requestedScopes] };
}

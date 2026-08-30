import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  CANONICAL_TIERS,
  LEGACY_TIER_ALIASES,
  TIER_RANK,
  HOSTED_COMMUNITY_PROJECT_LIMIT,
  canonicalizeTier,
} from '../ui/config/tiers.js';

// The canonical tier vocabulary exists twice on purpose — the client bundle
// cannot import Deno-path modules — and these pins are what keep the copies
// honest. The Deno side is asserted as source text (house pattern), the client
// side by executing the real module.

const ROOT = resolve(__dirname, '..', '..');
const denoSrc = readFileSync(resolve(ROOT, 'supabase/functions/_shared/tiers.ts'), 'utf-8');

describe('canonical tier vocabulary — client/server parity', () => {
  it('both modules carry the same five canonical tiers', () => {
    expect(CANONICAL_TIERS).toEqual(['community', 'indie', 'team', 'enterprise', 'government']);
    expect(denoSrc).toContain(
      "export const CANONICAL_TIERS: PlanTier[] = ['community', 'indie', 'team', 'enterprise', 'government'];",
    );
  });

  it('both modules carry the same legacy alias map', () => {
    expect(LEGACY_TIER_ALIASES).toEqual({ free: 'community', starter: 'team', architect: 'team', pro: 'team' });
    for (const [legacy, canonical] of Object.entries(LEGACY_TIER_ALIASES)) {
      expect(denoSrc).toContain(`${legacy}: '${canonical}',`);
    }
  });

  it('both modules agree on rank order and the hosted community project cap', () => {
    expect(TIER_RANK).toEqual({ community: 0, indie: 1, team: 2, enterprise: 3, government: 4 });
    for (const [tier, rank] of Object.entries(TIER_RANK)) {
      expect(denoSrc).toContain(`${tier}: ${rank},`);
    }
    expect(HOSTED_COMMUNITY_PROJECT_LIMIT).toBe(1);
    expect(denoSrc).toContain('export const HOSTED_COMMUNITY_PROJECT_LIMIT = 1;');
  });

  it('canonicalizeTier resolves canonical, legacy, decorated, and sentinel inputs', () => {
    // canonical passthrough
    for (const t of CANONICAL_TIERS) expect(canonicalizeTier(t)).toBe(t);
    // legacy aliases — including the signed-license case (a 'pro' token
    // issued before the rename must resolve, not fail)
    expect(canonicalizeTier('free')).toBe('community');
    expect(canonicalizeTier('starter')).toBe('team');
    expect(canonicalizeTier('architect')).toBe('team');
    expect(canonicalizeTier('pro')).toBe('team');
    // decorated historical plan_name values
    expect(canonicalizeTier('Pro Annual')).toBe('team');
    expect(canonicalizeTier('Starter (Legacy)')).toBe('team');
    // sentinels and junk return null — callers pick their fail-closed default
    expect(canonicalizeTier('pending')).toBe(null);
    expect(canonicalizeTier('unknown')).toBe(null);
    expect(canonicalizeTier('')).toBe(null);
    expect(canonicalizeTier(null)).toBe(null);
    // the Deno source carries the identical resolution ladder
    expect(denoSrc).toContain("if (s.includes('pro') || s.includes('architect') || s.includes('starter')) return 'team';");
  });
});

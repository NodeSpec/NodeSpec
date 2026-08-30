/*
  MCP tier gate — the 2026-08-10 all-features ruling.

  P0-6's original matrix gated 'write' behind paid plans. The GTM pricing model
  re-ruled tiers as scale/deployment distinctions ("all features, every tier"),
  so the gate now allows every scope on every tier — these pins hold that OPEN
  state deliberately, so a future regression back to feature-gating fails loudly
  against the recorded ruling.
*/
import { describe, it, expect } from 'vitest';
import {
  checkTierForScope,
  resolveApiKeyScopesForTier,
  ALL_SCOPES,
  FREE_TIER_SCOPES,
  type PlanTier,
} from '../../supabase/functions/_shared/mcp-tier-gate.ts';

const TIERS: PlanTier[] = ['community', 'indie', 'team', 'enterprise', 'government'];

describe('all-features ruling: tool-call matrix', () => {
  it('every scope is allowed on every tier — including write on community', () => {
    for (const tier of TIERS) {
      for (const scope of ['read', 'propose', 'write', undefined]) {
        expect(checkTierForScope(tier, scope)).toEqual({ allowed: true });
      }
    }
  });

  it('the free scope list equals the full scope list (scale caps, not feature caps)', () => {
    expect(FREE_TIER_SCOPES).toEqual(ALL_SCOPES);
  });
});

describe('all-features ruling: API key scope minting', () => {
  it('default mint carries all three scopes on every tier', () => {
    for (const tier of TIERS) {
      expect(resolveApiKeyScopesForTier(tier)).toEqual({ scopes: ['read', 'write', 'propose'] });
    }
  });

  it('community tier CAN mint a write-scoped key (the ruling reversal, pinned)', () => {
    const result = resolveApiKeyScopesForTier('community', ['read', 'write']);
    expect(result).toEqual({ scopes: ['read', 'write'] });
  });

  it('explicit scope requests are honored verbatim on every tier', () => {
    for (const tier of TIERS) {
      expect(resolveApiKeyScopesForTier(tier, ['read'])).toEqual({ scopes: ['read'] });
      expect(resolveApiKeyScopesForTier(tier, ['propose', 'read'])).toEqual({ scopes: ['propose', 'read'] });
    }
  });

  it('invalid scope names are still rejected for every tier', () => {
    for (const tier of TIERS) {
      const result = resolveApiKeyScopesForTier(tier, ['read', 'admin']);
      expect('error' in result && result.error).toContain('Invalid scopes: admin');
    }
  });
});

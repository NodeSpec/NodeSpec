import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveVariant } from '../ui/config/variant.js';
import { CANONICAL_TIERS } from '../ui/config/tiers.js';

// V3 P3 (task 3.3): variant + theme plumbing. The variant resolves from
// edition/tier ONLY (design: `variant: individual|team`) — no setter, no
// stored preference, no toggle; Government renders the team variant (its
// classification is item data, P7.3, never a fourth layout). Theme
// dark|light was already riding src/ui/theme — pinned here as the other
// half of the task so a regression names it.

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

describe('resolveVariant: the full tier matrix, edition override, fail-closed default', () => {
  it('community and indie are individual; team, enterprise, government are team', () => {
    expect(resolveVariant('community', { enterpriseEdition: false })).toBe('individual');
    expect(resolveVariant('indie', { enterpriseEdition: false })).toBe('individual');
    expect(resolveVariant('team', { enterpriseEdition: false })).toBe('team');
    expect(resolveVariant('enterprise', { enterpriseEdition: false })).toBe('team');
    expect(resolveVariant('government', { enterpriseEdition: false })).toBe('team');
    // The matrix is total — a new tier must take a side here.
    for (const tier of CANONICAL_TIERS) {
      expect(['individual', 'team']).toContain(resolveVariant(tier, { enterpriseEdition: false }));
    }
  });

  it('no plan (unresolved subscription) fails closed to individual', () => {
    expect(resolveVariant(null, { enterpriseEdition: false })).toBe('individual');
    expect(resolveVariant(undefined, { enterpriseEdition: false })).toBe('individual');
  });

  it('the self-hosted enterprise edition is team regardless of (absent) billing rows', () => {
    expect(resolveVariant(null, { enterpriseEdition: true })).toBe('team');
    expect(resolveVariant('community', { enterpriseEdition: true })).toBe('team');
  });
});

describe('the variant has no client-side escalation surface', () => {
  it('variant.ts exports only the resolver — no setter, no storage, no toggle', () => {
    const module = src('ui/config/variant.ts');
    expect(module).not.toContain('localStorage');
    expect(module).not.toContain('setItem');
    expect(module).not.toMatch(/export function (set|save|toggle)/);
  });

  // useVariant follows the project's plan and is individual while loading:
  // driven through renderHook in d1-project-plan-gate.test.tsx.
});

describe('theme dark|light rides src/ui/theme (the other half of 3.3)', () => {
  it('ThemeContext persists the two-value mode and exposes toggle + set', () => {
    const ctx = src('ui/theme/ThemeContext.tsx');
    expect(ctx).toContain("stored === 'dark' || stored === 'light'");
    expect(ctx).toContain('toggleTheme');
    expect(ctx).toContain('setMode');
    expect(ctx).toContain("localStorage.setItem(STORAGE_KEY, mode)");
  });
});

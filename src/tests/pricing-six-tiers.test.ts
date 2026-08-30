import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { deploymentTiers, COMMUNITY_REPO_URL } from '../ui/components/pricing/pricing-data.js';
import { canonicalizeTier } from '../ui/config/tiers.js';

/*
  Six-card pricing model (owner ruling 2026-08-26): Community (the
  downloadable container) and Free (hosted, 1 project) are separate CARDS of
  the same canonical community plan. The canonical tier vocabulary stays
  five values — nothing billed or persisted changes shape.
*/

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8');

describe('pricing — six display cards', () => {
  it('the card order is Community · Free · Indie · Team · Enterprise · Government', () => {
    expect(deploymentTiers.map((t) => t.id)).toEqual([
      'community', 'free', 'indie', 'team', 'enterprise', 'government',
    ]);
  });

  it('Community is the downloadable container with the owner feature list, CTA → the repository', () => {
    const community = deploymentTiers.find((t) => t.id === 'community')!;
    expect(community.ctaKind).toBe('github');
    expect(community.features).toEqual([
      'MCP-native connection for your AI',
      'Git connection and git provenance',
      'Full spec-driven development engine',
      'Architecture Canvas',
      'Open node technology catalog',
    ]);
    expect(COMMUNITY_REPO_URL).toBe('https://github.com/NodeSpec/NodeSpec');
  });

  it('Free is hosted with up to 1 project and signs up; it resolves to the community plan', () => {
    const free = deploymentTiers.find((t) => t.id === 'free')!;
    expect(free.ctaKind).toBe('signup');
    expect(free.audience.toLowerCase()).toContain('hosted');
    expect(free.features.join(' ')).toContain('1 project');
    // The display card is not a new canonical tier: 'free' aliases community.
    expect(canonicalizeTier('free')).toBe('community');
  });

  it('Indie adds repo import and none of the teamwork features; Team adds teamwork', () => {
    const indie = deploymentTiers.find((t) => t.id === 'indie')!;
    expect(indie.features.join(' ')).toContain('Repo import reverse visualization and deduction');
    expect(indie.features.join(' ')).not.toMatch(/Slack|Notion|Workflow Designer/);
    const team = deploymentTiers.find((t) => t.id === 'team')!;
    expect(team.features.join(' ')).toMatch(/Slack/);
    expect(team.features[0]).toBe('Everything in Indie');
  });

  it('Enterprise is all but Government-specific; Government is all', () => {
    const enterprise = deploymentTiers.find((t) => t.id === 'enterprise')!;
    expect(enterprise.description).toContain('except the Government-specific');
    const government = deploymentTiers.find((t) => t.id === 'government')!;
    expect(government.features[0]).toBe('Everything in Enterprise');
  });

  it('every comparison row carries one value per tier column', () => {
    const table = read('../ui/components/pricing/PricingComparisonTable.tsx');
    const rows = [...table.matchAll(/values: \[([^\]]*)\]/g)]
      .map((m) => m[1].trim())
      .filter((v) => v.length > 0);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      // Top-level comma count — the row literals hold only scalars.
      expect(row.split(',').length, `row [${row}]`).toBe(deploymentTiers.length);
    }
    // The category spacer spans every column plus the label column.
    expect(table).toContain('colSpan={deploymentTiers.length + 1}');
  });

  it('both pricing surfaces route the cards: community → repo, free → signup lane', () => {
    for (const rel of ['../ui/components/pricing/PricingSection.tsx', '../ui/components/pricing/PricingPage.tsx']) {
      const src = read(rel);
      expect(src).toContain("window.open(COMMUNITY_REPO_URL, '_blank', 'noopener,noreferrer')");
      expect(src).toContain("tierId === 'free'");
    }
    // Onboarding welcomes the hosted Free card, never the container card.
    const onboarding = read('../ui/components/pricing/OnboardingPricingStep.tsx');
    expect(onboarding).toContain("deploymentTiers.find((t) => t.id === 'free')");
  });
});

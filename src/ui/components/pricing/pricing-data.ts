/*
  Pricing model (owner design 2026-08-26 — supersedes 2026-08-25):

    Community  — free: the Apache-2.0 downloadable container. MCP-native AI
                 connection, git connection & provenance, the full spec-driven
                 engine, Architecture Canvas, open node technology catalog.
    Free       — free: HOSTED at nodespec.io, up to 2 projects.
    Indie      — $15/mo or $144/yr hosted: all features + repo import reverse
                 visualization and deduction (no teamwork features).
    Team       — $60/user/mo hosted: all features + the teamwork lane
                 (Notion/Atlassian/Slack, Workflow Designer).
    Enterprise — self-hosted, custom: everything except Government-specific.
    Government — self-hosted in compliant enclaves: everything.

  Community and Free are separate CARDS of the same canonical plan: PlanTier
  stays the 5-value vocabulary from src/ui/config/tiers.ts, and the 'free'
  card resolves to the community plan (canonicalizeTier already aliases
  free → community), so nothing billed or persisted changes shape.
*/
import { tierDisplayName } from '../../config/tiers.js';

export type { PlanTier } from '../../config/tiers.js';

/** Display-card ids — canonical tiers plus the hosted 'free' card. */
export type DeploymentTierId = 'community' | 'free' | 'indie' | 'team' | 'enterprise' | 'government';

/** The public repository the Community card links to. */
export const COMMUNITY_REPO_URL = 'https://github.com/NodeSpec/NodeSpec';

export interface DeploymentTier {
  id: DeploymentTierId;
  name: string;
  /** Price line shown under the tier name ("Free", "$300/mo", "Custom"). */
  price: string;
  /** Secondary price context, e.g. the annual value framing. */
  priceNote?: string;
  /** One-line "where it runs / who it's for" shown under the price. */
  audience: string;
  /** Small chip next to the tier name ("Start here", "Coming soon"). */
  badge?: string;
  description: string;
  features: string[];
  cta: string;
  ctaKind: 'signup' | 'contact' | 'government' | 'github';
  highlighted?: boolean;
}

export const deploymentTiers: DeploymentTier[] = [
  {
    id: 'community',
    name: 'Community',
    price: 'Free',
    audience: 'Open-source container · your environment',
    badge: 'Open source',
    description:
      'The Apache-2.0 downloadable container in your own environment — unlimited local projects, no account required.',
    features: [
      'MCP-native connection for your AI',
      'Git connection and git provenance',
      'Full spec-driven development engine',
      'Architecture Canvas',
      'Open node technology catalog',
    ],
    cta: 'Get the Container',
    ctaKind: 'github',
  },
  {
    id: 'free',
    name: 'Free',
    price: 'Free',
    audience: 'Hosted · up to 2 projects',
    badge: 'Start here',
    description:
      'A hosted account at nodespec.io — everything in Community, run for you, with two projects. No card, no trial clock.',
    features: [
      'Everything in Community, hosted',
      'Up to 2 projects',
      'Full hosted technology catalog',
      'No card, no trial clock',
    ],
    cta: 'Create Free Account',
    ctaKind: 'signup',
  },
  {
    id: 'indie',
    name: 'Indie',
    price: '$15/mo',
    priceNote: 'or $144/yr — save 20%',
    audience: 'Hosted · unlimited projects',
    badge: 'Most popular',
    description:
      'The hosted app for individual builders. Everything in Free, unlimited projects, and repo import reverse visualization and deduction.',
    features: [
      'Everything in Free',
      'Unlimited hosted projects',
      'Repo import reverse visualization and deduction',
      'Richer catalog, updated continuously',
      'Feature improvements land here first',
    ],
    cta: 'Start with Indie',
    ctaKind: 'signup',
    highlighted: true,
  },
  {
    id: 'team',
    name: 'Team',
    price: '$60/user/mo',
    audience: 'Hosted · for teams and their agents',
    badge: 'Coming soon',
    description:
      'Everything in Indie, plus the integrations that put your whole team and their agents on one model.',
    features: [
      'Everything in Indie',
      'Notion, Atlassian & Slack integration — tag nodes for human teams and agents to execute',
      'Workflow Designer from UX to Requirements',
    ],
    cta: 'Join the Waitlist',
    ctaKind: 'contact',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    audience: 'Self-hosted',
    description:
      'NodeSpec in your own environment, on your terms — every capability except the Government-specific lane, with custom scale, authentication, catalog, and support commitments.',
    features: [
      'Self-hosted in your environment',
      'Everything in Team and Indie',
      'Internal customer authentication',
      'Custom catalog additions',
      'Dedicated onboarding and optional additional support',
    ],
    cta: 'Contact Us',
    ctaKind: 'contact',
  },
  {
    id: 'government',
    name: 'Government',
    price: 'Custom',
    audience: 'Self-hosted · compliant enclaves',
    description:
      'Everything NodeSpec offers, purpose-built for DoW and federal agencies operating in controlled enclaves with strict compliance requirements.',
    features: [
      'Everything in Enterprise',
      'Deployed as a container to compliant Government cloud enclaves',
      'Custom, gov-only node additions and context',
      'Compliance package builder aligned to tasks.md',
      'Works with any foundational model or open weight performant custom models',
    ],
    cta: 'Request a Briefing',
    ctaKind: 'government',
  },
];

/* ── Display helpers ─────────────────────────────────────────────────────── */

/** Canonical display name; legacy V1 plan names resolve through the shared
 *  alias map (pro/architect/starter → Team, free → Community). */
export function getPlanDisplayName(planName: string | null | undefined): string {
  return tierDisplayName(planName);
}

export function getTokenLimitDisplay(tokens: number): string {
  if (tokens === 0) return 'None';
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000) return `${tokens / 1_000}K`;
  return String(tokens);
}

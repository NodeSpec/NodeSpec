// The homepage's meta and structured data, read by the build-time prerender and by
// the landing page itself, so a crawler that runs no script and one that does see the
// same title, description and schema (AJ.2, owner 2026-09-30). Offers follow the
// pricing page's tiers rather than a copy of them.
import { deploymentTiers } from '../ui/components/pricing/pricing-data.js';
import { BASE_URL, LOGO, SITE_NAME } from './page-head.ts';

export const HOME_SEO = {
  // The headline, the owner's (2026-09-30): "The AI System Design Governance Platform for Agents".
  title: 'NodeSpec - AI System Design Governance Platform for Agents',
  description:
    'Design your architecture visually, govern what your AI builds. NodeSpec gives Claude, Cursor, and any MCP agent scoped task context with git provenance, requirements traceability, and verified tests.',
  keywords:
    'AI system design governance platform, AI governance platform for agents, AI system design, AI governance, AI architecture governance, software architecture for AI agents, AI software design, spec-driven development, MCP context server, Model Context Protocol architecture, AI development governance, architecture provenance, AI coding context, Cursor architecture context, Claude code context, system design for AI, software architecture tool, prevent AI hallucination',
} as const;

export const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: BASE_URL,
  logo: LOGO,
  sameAs: ['https://x.com/NodeSpec', 'https://www.linkedin.com/company/nodespec/'],
} as const;

export const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: BASE_URL,
} as const;

/** The hosted tiers someone can sign up for today, priced as the pricing page prices
 *  them. A waitlist, a contact form or the container is not an offer. */
export function hostedOffers(): object[] {
  return deploymentTiers
    .filter((t) => t.ctaKind === 'signup' && /^(Free|\$\d+(\.\d+)?\/mo)$/.test(t.price))
    .map((t) => {
      const monthly = /^\$(\d+(?:\.\d+)?)\/mo$/.exec(t.price)?.[1];
      return {
        '@type': 'Offer',
        name: t.name,
        price: monthly ?? '0',
        priceCurrency: 'USD',
        description: t.audience,
        ...(monthly ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: monthly, priceCurrency: 'USD', unitText: 'MONTH' } } : {}),
      };
    });
}

export function softwareApplicationJsonLd(): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Software Architecture Tool',
    operatingSystem: 'Web',
    url: BASE_URL,
    description:
      'Architecture, governance and design platform for AI-built software. Your AI connects over MCP and builds from scoped, provenance-tracked task context instead of guessing.',
    offers: hostedOffers(),
    featureList: [
      'Visual architecture canvas',
      'Technology catalog with curated AI context',
      'Requirements, acceptance criteria and traceability',
      'Deterministic task packets and criteria-linked test plans',
      'MCP server for Claude, Cursor, and any AI agent or IDE',
      'Git-native provenance: the model and task packets commit to your repo',
      'Repo import with review-first proposals',
      'Self-hosted Enterprise and Government deployments',
    ],
    publisher: { '@type': 'Organization', name: SITE_NAME, url: BASE_URL, logo: LOGO },
  };
}

export function homeJsonLd(): object[] {
  return [ORGANIZATION_JSON_LD, WEBSITE_JSON_LD, softwareApplicationJsonLd()];
}

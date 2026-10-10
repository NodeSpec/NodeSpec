// The homepage's meta and structured data, read by the build-time prerender and by
// the landing page itself, so a crawler that runs no script and one that does see the
// same title, description and schema (AJ.2, owner 2026-09-30). Offers follow the
// pricing page's tiers rather than a copy of them, and the FAQ schema is the page's
// own questions (landing-content.ts).
import { deploymentTiers } from '../ui/components/pricing/pricing-data.js';
import { FAQ, FOOTER, OPEN_SOURCE } from '../ui/components/auth/landing/landing-content.js';
import { BASE_URL, LOGO, SITE_NAME } from './page-head.ts';

export const HOME_SEO = {
  // The owner's positioning (2026-10-07): "System design and governance platform for
  // developers and the AI agents they run." Title under 60 characters, description
  // under 160, so neither is cut in a result.
  title: 'NodeSpec: AI System Design and Governance Platform',
  description:
    'System design and governance for developers and the AI agents they run. Plug in Claude Code, Cursor or Codex, see how each change fits, and prove it with tests.',
  keywords:
    'AI system design, AI governance platform, system design and governance, AI coding agents, multi-agent development, Claude Code architecture, Cursor architecture context, Codex, MCP server, Model Context Protocol, spec-driven development, requirements traceability, acceptance criteria tests, GitOps, architecture as code, software architecture tool',
} as const;

export const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: BASE_URL,
  logo: LOGO,
  email: FOOTER.email,
  contactPoint: { '@type': 'ContactPoint', email: FOOTER.email, contactType: 'sales' },
  sameAs: [OPEN_SOURCE.repoUrl, 'https://x.com/NodeSpec', 'https://www.linkedin.com/company/nodespec/'],
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
      'System design and governance platform for developers and the AI agents they run. Agents connect over MCP and build from one living model of the system; every change is checked against the architecture and every requirement is proven by a test.',
    offers: hostedOffers(),
    featureList: [
      'Visual architecture canvas',
      'Workflows traced from outcome to requirement to service to code',
      'Requirements with acceptance criteria proven by tests against real commits',
      'MCP server for Claude Code, Cursor, Codex and any MCP client',
      'Per-lane autonomy: ask first, propose or auto-apply',
      'Git-native: design files commit to your repository, outside commits come back as change cards',
      'Repository import with review-first proposals',
      'Technology catalog with guidance for 300+ technologies',
      'Self-hosted Community, Enterprise and Government editions',
    ],
    publisher: { '@type': 'Organization', name: SITE_NAME, url: BASE_URL, logo: LOGO },
  };
}

/** The page's questions and answers, word for word, as a FAQPage. */
export function faqJsonLd(): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

export function homeJsonLd(): object[] {
  return [ORGANIZATION_JSON_LD, WEBSITE_JSON_LD, softwareApplicationJsonLd(), faqJsonLd()];
}

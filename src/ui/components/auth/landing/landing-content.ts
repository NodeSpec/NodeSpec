// The homepage's words, in one place (owner design 2026-10-07, the "Homepage
// Redesign" canvas). The page renders them, the build-time prerender writes them
// into the served HTML for crawlers that run no script, and the FAQ answers become
// the FAQPage structured data, so the three can never say different things.
// Plain TypeScript with no React or asset imports: scripts/prerender.ts reads it.
import { deploymentTiers, type DeploymentTierId } from '../../pricing/pricing-data.js';

export type LandingAction = 'signup' | 'signin' | 'talk' | 'waitlist';

/** A call to action is a page (`href`), a section of this page (`href` '#...'),
 *  or something the page does (`action`). */
export interface LandingLink {
  label: string;
  href?: string;
  action?: LandingAction;
}

export const HERO = {
  title: 'NodeSpec',
  slogan: [['Design', ' Smarter, '], ['Build', ' Better, '], ['Ship', ' Faster']] as const,
  description:
    'System design and governance platform for developers and the AI agents they run. Plug in the agents and models you already use, see how every change fits your architecture, and ship requirements that are proven by tests.',
  primary: { label: 'Get Started Free', action: 'signup' } as LandingLink,
  secondary: { label: 'Talk to Us', action: 'talk' } as LandingLink,
  note: 'No credit card required',
};

/** The product views the hero can show, in the order of its chips. */
export const PRODUCT_VIEWS = [
  { id: 'flows', label: 'Workflows' },
  { id: 'reqs', label: 'Requirements' },
  { id: 'arch', label: 'Architecture' },
] as const;
export type ProductView = (typeof PRODUCT_VIEWS)[number]['id'];

export const HOW = {
  id: 'how',
  eyebrow: 'How it works',
  heading: ['From one model to ', 'tested code your agents can account for'] as const,
  sub: 'Set it up once per system. Every agent your team connects works from it.',
  steps: [
    {
      title: 'Model the system',
      body: ['Requirements, architecture and deployment on one canvas. Or import an existing repository and review what NodeSpec finds.'],
    },
    {
      title: 'Connect your agents',
      body: ["Claude Code, Cursor, Codex or any MCP client reads the context for one task at a time: the node's role, contracts and acceptance criteria. NodeSpec is designed to also allow multi-agent workflows for advanced users employing automated dev teams."],
    },
    {
      title: 'Set the rules and audit your design',
      body: [
        'Per lane, choose Ask first, Propose or Auto-apply. Promotions, confirmed requirements and loads from git always wait for a person.',
        "Review the AI's proposed design in an architecture canvas where each node carries context and logic, with exportable context of the system so smaller models can check out and iterate on the design.",
      ],
    },
    {
      title: 'Review and prove',
      body: ['Approve or reject proposals. A criterion turns met only when a test run reports against a commit that exists.'],
    },
  ],
};

export interface DeveloperCase {
  eyebrow: string;
  title: string;
  body: string;
  link: LandingLink;
  chip?: string;
}

export interface StrategicCase {
  title: string;
  body: string;
  /** The little system the card draws: names, arrows, and the one in focus. */
  flow: Array<{ name: string; focus?: boolean } | '→' | '↔'>;
  link: LandingLink;
  chip?: string;
}

const HOW_LINK: LandingLink = { label: 'See how it works', href: '#how' };
const TALK_LINK: LandingLink = { label: 'Talk to Us', action: 'talk' };

export const USE_CASES = {
  id: 'use-cases',
  eyebrow: 'Use cases',
  heading: 'Where seeing the whole system pays off',
  sub: "The day-to-day of building with agents, and the systems you're accountable for running.",
  modes: [{ id: 'developer', label: 'Developer' }, { id: 'strategic', label: 'Strategic' }] as const,
  developer: [
    {
      eyebrow: 'You inherited a codebase',
      title: 'Map an existing system before you touch it',
      body: 'Import a repository and NodeSpec draws its services, data stores and deployment, with drafted requirements for you to confirm.',
      link: HOW_LINK,
      chip: 'Indie and up',
    },
    {
      eyebrow: "You're starting something new",
      title: 'See the whole design before anyone writes code',
      body: "Lay out what the product does, how it's built and where it runs, then give your agents a build order that follows the design.",
      link: HOW_LINK,
      chip: 'Build order on Indie',
    },
    {
      eyebrow: 'AI agents write the code',
      title: 'See what every agent change touches before it lands',
      body: 'Agents propose changes against the model, so you see the services and requirements each one affects. Routine lanes can apply on their own.',
      link: HOW_LINK,
    },
    {
      eyebrow: 'Your team is growing',
      title: 'New engineers see how everything connects on day one',
      body: "Every service shows its contracts, the requirements it serves and the tests that cover it, so knowledge stops living in a few people's heads.",
      link: HOW_LINK,
    },
    {
      eyebrow: 'Someone asks "is it done?"',
      title: "Show what's built and proven, down to the commit",
      body: 'Each acceptance criterion links to the service that serves it and the test that checks it, and turns met only when results report against a real commit.',
      link: HOW_LINK,
    },
    {
      eyebrow: 'Code and design drift apart',
      title: 'Keep the design true as the code changes',
      body: 'The model lives in your repository. Commits made elsewhere come back as change cards, and an agent proposes how the model should follow.',
      link: HOW_LINK,
    },
  ] satisfies DeveloperCase[],
  strategic: [
    {
      heading: 'Software product companies',
      sub: 'The platform you sell, designed and run as one system.',
      cases: [
        {
          title: 'A multi-tenant SaaS platform',
          body: 'App, API, auth, billing and tenant data on one map, each requirement traced to the services that meet it. Plan a new tier or a migration against the whole platform, not one repository at a time.',
          flow: [{ name: 'web app' }, '→', { name: 'API', focus: true }, '→', { name: 'tenant data' }, { name: 'auth' }, { name: 'billing' }, { name: 'background jobs' }],
          link: { label: 'See the example', href: '/templates/nextjs-supabase-stripe-saas' },
          chip: 'Template: Next.js, Supabase, Stripe',
        },
        {
          title: 'Payments and money movement',
          body: 'Checkout, refunds, ledgers and provider webhooks, every rule tied to the test that proves it and the commit it passed on. Evidence your auditors can follow from requirement to code.',
          flow: [{ name: 'checkout' }, '→', { name: 'payments-api', focus: true }, '→', { name: 'ledger' }, { name: 'provider webhooks' }, { name: 'payouts' }],
          link: TALK_LINK,
        },
        {
          title: 'An AI product on your own data',
          body: 'Ingestion, embeddings, vector search, inference and evaluation laid out as one system, so a model change and a data change are planned together instead of discovered in production.',
          flow: [{ name: 'ingestion' }, '→', { name: 'embeddings' }, '→', { name: 'vector store', focus: true }, { name: 'inference service' }, { name: 'evaluation' }],
          link: TALK_LINK,
        },
      ] satisfies StrategicCase[],
    },
    {
      heading: 'Back-office IT',
      sub: 'The systems the business runs on, and how they connect.',
      cases: [
        {
          title: 'Identity and access across your apps',
          body: 'Directory, single sign-on and provisioning into every tool on one map. See which systems trust which, and what a change to one connector will touch before you make it.',
          flow: [{ name: 'directory' }, '→', { name: 'single sign-on', focus: true }, '→', { name: 'HR' }, { name: 'CRM' }, { name: 'finance' }, { name: 'ticketing' }],
          link: TALK_LINK,
        },
        {
          title: 'Data platform and reporting',
          body: 'Sources, pipelines, warehouse and dashboards drawn as one flow, so you know what feeds every number in the board report before anyone changes a pipeline.',
          flow: [{ name: 'ERP' }, { name: 'CRM' }, '→', { name: 'pipelines', focus: true }, '→', { name: 'warehouse' }, '→', { name: 'dashboards' }],
          link: TALK_LINK,
        },
        {
          title: 'ERP, CRM and finance integrations',
          body: 'Every integration between your systems of record, with the contract each one keeps and the jobs that run it, so a change in one system stops surprising finance.',
          flow: [{ name: 'ERP' }, '↔', { name: 'integration layer', focus: true }, '↔', { name: 'CRM' }, { name: 'payroll' }, { name: 'nightly jobs' }],
          link: TALK_LINK,
        },
      ] satisfies StrategicCase[],
    },
  ],
};

export const CONTROL = {
  id: 'control',
  heading: 'Built for the people who answer for the code',
  sub: 'NodeSpec orchestrates what every agent sees and does, works inside your git flow, and keeps the record of what changed and who let it through.',
  points: [
    { title: 'Govern Context Orchestration', body: 'Each agent gets the slice of the system its task needs, in the planned order, and no two agents change the same node at once.' },
    { title: 'Lives in your git flow', body: 'Commits to your branch or opens a pull request. Commits made outside NodeSpec come back as change cards. GitHub and GitLab.' },
    { title: 'Fast changes, without vibe coding', body: 'Change the design and every agent builds from the update on its next task, checked against the model before it lands.' },
    { title: 'Every change attributed', body: 'Which agent filed it, who or what decided it, and why it waited. NodeSpec runs no AI model of its own.' },
  ],
  waitsLabel: 'Always waits for a person:',
  waits: ['Promotions and settles', 'Confirmed requirements', 'Constraint changes', 'Repository imports', 'Loads from git', 'Locked nodes'],
  legend: {
    code: 'Your agents commit straight to your repository',
    loose: 'NodeSpec links in loosely: context to your agents, design files to git',
  },
};

export const START_POINTS = {
  id: 'start-points',
  eyebrow: 'Where to start',
  heading: 'Pick your starting point',
  cards: [
    {
      title: 'I lead an engineering team',
      bullets: ['See the whole system your team and its agents are building', 'Set what agents may change, per lane', 'Start on Indie at $15/mo. Team seats are coming soon.'],
      link: { label: 'How teams use NodeSpec', href: '#control' } as LandingLink,
      featured: true,
    },
    {
      title: 'I run platform or architecture at a larger company',
      bullets: ['Self-host with your own sign-in', 'Requirements traced to tested commits', 'Custom catalog entries for internal platforms'],
      link: TALK_LINK,
    },
    {
      title: "I'm building on my own",
      bullets: ['Start from a template', 'Free for 2 projects', 'Works with the agent you already use'],
      link: { label: 'Get Started Free', action: 'signup' } as LandingLink,
    },
  ],
};

/** The dollar figure on a card, read from the pricing page's tiers so the two
 *  cannot drift ("$15/mo" -> "$15"). */
function dollars(id: DeploymentTierId): string {
  const tier = deploymentTiers.find((t) => t.id === id);
  const m = tier ? /^\$(\d+(?:\.\d+)?)/.exec(tier.price) : null;
  if (!m) throw new Error(`the ${id} tier has no dollar price`);
  return `$${m[1]}`;
}

/** The yearly price the Indie tier's note gives ("or $144/yr ..." -> "$144"). */
function yearly(id: DeploymentTierId): string {
  const note = deploymentTiers.find((t) => t.id === id)?.priceNote ?? '';
  const m = /\$(\d+(?:\.\d+)?)\/yr/.exec(note);
  if (!m) throw new Error(`the ${id} tier has no yearly price`);
  return `$${m[1]}`;
}

export interface PriceCard {
  id: 'free' | 'indie' | 'team' | 'enterprise';
  name: string;
  amount: string;
  per?: string;
  badge?: string;
  features: string[];
  cta: LandingLink;
  featured?: boolean;
}

export const PRICING = {
  id: 'pricing',
  eyebrow: 'Pricing',
  heading: "Start free. Bring the team when you're ready.",
  cards: [
    { id: 'free', name: 'Free', amount: '$0', features: ['2 hosted projects', 'Full technology catalog', '1 connected agent'], cta: { label: 'Get Started Free', action: 'signup' } },
    { id: 'indie', name: 'Indie', amount: dollars('indie'), per: `per month, or ${yearly('indie')} a year`, badge: 'Recommended', features: ['Unlimited projects', 'Repository import', 'Plan and Workflows', '5 connected agents'], cta: { label: 'Start with Indie', action: 'signup' }, featured: true },
    { id: 'team', name: 'Team', amount: dollars('team'), per: 'per user per month', badge: 'Coming soon', features: ['Everything in Indie', 'Seats: maintainer, contributor, viewer', 'Notion, Atlassian and Slack tagging'], cta: { label: 'Join the waitlist', action: 'waitlist' } },
    { id: 'enterprise', name: 'Enterprise', amount: 'Custom', features: ['Licensed self-hosting', 'Your own sign-in', 'Custom catalog entries', 'Dedicated onboarding'], cta: TALK_LINK },
  ] satisfies PriceCard[],
  compare: { label: 'Compare every plan, including the open-source Community edition and Government', href: '/pricing' } as LandingLink,
};

export const FAQ = {
  id: 'faq',
  eyebrow: 'Questions',
  heading: 'What teams ask before they connect an agent',
  aside: { title: 'Evaluating for a team?', body: "We'll walk through your system with you, including self-hosting and security.", cta: TALK_LINK },
  items: [
    {
      q: 'Is NodeSpec another AI coding agent?',
      a: 'No. NodeSpec orchestrates the agents you already use, whether Claude Code, Cursor, Codex or any MCP client. It decides what context each one gets for each task, sequences the work, checks every change against the design and keeps your repository in step. It runs no model of its own.',
    },
    {
      q: 'How does it fit our git workflow?',
      a: 'Connect a GitHub or GitLab repository and NodeSpec keeps its design files there, beside your code. It commits to your branch or opens a pull request, as you choose. Your agents commit code the way they already do, and commits made outside NodeSpec come back as change cards for an agent to reconcile, so git stays the source of truth.',
    },
    {
      q: 'How do we move fast without losing control?',
      a: 'Set autonomy per lane: Ask first, Propose or Auto-apply. Routine changes can apply on their own, even with the app closed, while promotions, confirmed requirements, constraint changes, repository imports and loads from git always wait for a person. Every change records which agent filed it and who or what decided it.',
    },
    {
      q: 'How is this different from an architecture diagram?',
      a: 'A diagram is a picture that goes stale. NodeSpec is the model your agents build from: each node carries its role, technology, contracts and the requirements it serves, and a requirement counts as met only when a test reports against a real commit. The model lives in git, so it changes with the code instead of drifting from it.',
    },
    {
      q: 'Can it map a system we already have?',
      a: 'Yes. Import a repository and NodeSpec draws its services, data stores and deployment, and drafts requirements for you to review before anything is accepted. Repository import is on Indie and up.',
    },
    {
      q: 'Can we self-host?',
      a: 'Yes. The Community edition is an open-source Apache 2.0 container you can run yourself. Enterprise is a licensed self-hosted deployment with your own sign-in, custom catalog entries and dedicated onboarding, and Government runs in compliant enclaves.',
    },
  ],
};

export const OPEN_SOURCE = {
  eyebrow: 'Open source',
  heading: 'An open core you can read and extend',
  body: 'The spec engine, MCP server, catalog and git sync ship as an Apache 2.0 container you can run and extend.',
  repoUrl: 'https://github.com/NodeSpec/NodeSpec',
  repoLabel: 'github.com/NodeSpec/NodeSpec',
};

export const CATALOG = {
  eyebrow: 'Technology catalog',
  heading: '300+ technologies, each with guidance for your agents',
  body: 'Every entry carries best practices, anti-patterns and setup guidance, so each task is specific to the stack you actually run.',
  examples: ['AWS Lambda', 'Azure Functions', 'Cloud Run', 'PostgreSQL', 'Redis', 'Kafka', 'React', 'Next.js', 'Kubernetes', 'Stripe'],
};

export const FINAL_CTA = {
  line: 'Start free with a template or your own repository, or talk to us about your team.',
  primary: HERO.primary,
  secondary: HERO.secondary,
  note: HERO.note,
};

export const FOOTER = {
  tagline: 'Ship what you designed, with every agent building from one model of your system.',
  email: 'contact@nodespec.io',
  columns: [
    { title: 'Product', links: [{ label: 'Use cases', href: '#use-cases' }, { label: 'How it works', href: '#how' }, { label: 'Pricing', href: '/pricing' }, { label: 'Templates', href: '/templates' }] },
    { title: 'Developers', links: [{ label: 'MCP docs', href: '/docs/mcp' }, { label: 'Open source', href: OPEN_SOURCE.repoUrl }, { label: 'Blog', href: '/blog' }] },
    { title: 'Company', links: [{ label: 'Enterprise', href: '/pricing' }, { label: 'Government', href: '/government' }, TALK_LINK] },
  ] as Array<{ title: string; links: LandingLink[] }>,
  legal: [{ label: 'Privacy', href: '/privacy' }, { label: 'Terms', href: '/terms' }] as LandingLink[],
  copyright: '© 2025-2026 NodeSpec',
};

/** The hosted site's top navigation, in order. A page is a link a crawler can follow. */
export const NAV_LINKS: LandingLink[] = [
  { label: 'Use cases', href: '#use-cases' },
  { label: 'How it works', href: '#how' },
  { label: 'Templates', href: '/templates' },
  { label: 'MCP Docs', href: '/docs/mcp' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Enterprise', href: '/pricing' },
  { label: 'Blog', href: '/blog' },
];

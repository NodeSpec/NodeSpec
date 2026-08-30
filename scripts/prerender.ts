import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'https://nodespec.io';
const SITE_NAME = 'NodeSpec';
const DEFAULT_IMAGE = `${BASE_URL}/og-card.png`;
const DIST_DIR = path.resolve(import.meta.dirname, '..', 'dist');

interface RouteMeta {
  path: string;
  title: string;
  description: string;
  keywords?: string;
  ogType?: string;
  image?: string;
  noIndex?: boolean;
  jsonLd?: object[];
}

const STATIC_ROUTES: RouteMeta[] = [
  {
    path: '/',
    title: 'NodeSpec - AI Architecture, Governance & Design for AI-Built Software',
    description:
      'Design your architecture visually, govern what your AI builds. NodeSpec gives Claude, Cursor, and any MCP agent scoped task context with git provenance, requirements traceability, and verified tests.',
    keywords:
      'AI governance, AI architecture governance, software architecture for AI agents, AI software design, spec-driven development, MCP context server, Model Context Protocol architecture, AI development governance, architecture provenance, AI coding context, Cursor architecture context, Claude code context, system design for AI, software architecture tool, prevent AI hallucination',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'NodeSpec',
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'Software Architecture Tool',
        operatingSystem: 'Web',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          description: 'Community tier: every feature free on the web for up to 3 projects. Enterprise and Government run self-hosted.',
        },
        description:
          'Architecture, governance and design platform for AI-built software. Your AI connects over MCP and builds from scoped, provenance-tracked task context instead of guessing.',
        url: BASE_URL,
        featureList: [
          'Visual architecture canvas with 85+ architectural roles',
          'Technology catalog: 300+ entries with curated AI context',
          'Requirements, acceptance criteria and traceability',
          'Deterministic task packets and criteria-linked test plans',
          'MCP server for Claude, Cursor, and any AI agent or IDE',
          'Git-native provenance: model and packets commit to your repo',
          'Deterministic repo import with review-first proposals',
          'Self-hosted Team and Enterprise deployments',
        ],
        author: {
          '@type': 'Organization',
          name: 'NodeSpec',
          url: BASE_URL,
          logo: DEFAULT_IMAGE,
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'What is NodeSpec?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'NodeSpec is an architecture, governance and design platform for AI-built software. You map your system on a visual canvas with requirements and acceptance criteria; your AI assistant (Claude, Cursor, or any MCP agent) connects over MCP and builds from scoped task packets — with every change tracked as git provenance and every criterion verified by test results.',
            },
          },
          {
            '@type': 'Question',
            name: 'How does NodeSpec work with Cursor and Claude Code?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'NodeSpec is MCP-first: Claude, Cursor, and any Model Context Protocol agent connect directly to the NodeSpec MCP server, pulling architecture topology, requirements, scoped task packets and test plans on demand — and proposing changes you review. Task packets and the architecture model also commit to your GitHub repo, so they travel with the code.',
            },
          },
          {
            '@type': 'Question',
            name: 'What is spec-driven development?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Spec-driven development is a methodology where you define requirements, acceptance criteria, and architecture before writing code. NodeSpec enforces this workflow: you design the system visually, specify what each component must do, then generate or write code that satisfies those specifications. AI agents use this context to produce correct, architecturally-aligned code.',
            },
          },
          {
            '@type': 'Question',
            name: 'Is there a free tier?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes — the Community tier is the full product, free on the web at nodespec.io: every feature, up to 3 projects, no credit card. Your own AI assistant does the building through MCP, so there are no platform token meters. Team (web app for up to 5 users) is coming soon; Enterprise and Government are self-hosted by contact.',
            },
          },
          {
            '@type': 'Question',
            name: 'What is AI architecture governance?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'AI architecture governance means your AI coding agents work inside an explicit, versioned system design instead of improvising one. In NodeSpec that takes four forms: scoped context (each task packet carries exactly one node\u2019s slice of the architecture), git provenance (every model change is a reviewable commit in your repo), traceability (requirements map to nodes and to criteria-linked tests), and verified completion (a criterion is only met through reported test results).',
            },
          },
        ],
      },
    ],
  },
  {
    path: '/pricing',
    title: 'Pricing - NodeSpec',
    description:
      'NodeSpec tiers: Community is the free web app with every feature for up to 3 projects. Team (coming soon) is the web app for teams of up to 5. Enterprise and Government run self-hosted.',
    keywords:
      'NodeSpec pricing, AI architecture tool pricing, self-hosted architecture tool, AI governance platform pricing, free architecture tool, MCP architecture context',
  },
  {
    path: '/templates',
    title: 'Architecture Templates - NodeSpec',
    description:
      'Browse pre-built software architecture templates for SaaS, microservices, AI/ML, e-commerce, and more. Start your next project with a proven architecture blueprint.',
    keywords:
      'software architecture templates, system design templates, microservices template, SaaS architecture, AI ML architecture, cloud architecture blueprint',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Architecture Templates',
        description: 'Pre-built software architecture templates for common patterns and cloud platforms.',
        url: `${BASE_URL}/templates`,
        publisher: {
          '@type': 'Organization',
          name: SITE_NAME,
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'NodeSpec Architecture Templates',
        description: 'Production-ready architecture blueprints with code artifacts and infrastructure-as-code.',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'AWS Full-Stack Web Application',
            description: 'React frontend, Node.js API on ECS, RDS PostgreSQL, ElastiCache, CloudFront CDN, Cognito auth, Terraform IaC',
            url: `${BASE_URL}/templates/aws-fullstack-webapp`,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'GCP Full-Stack Web Application',
            description: 'React frontend, Express on Cloud Run, Cloud SQL, Firebase Auth, Cloud Armor, Load Balancer, Terraform IaC',
            url: `${BASE_URL}/templates/gcp-fullstack-webapp`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: 'Next.js + Supabase + Stripe SaaS',
            description: 'Next.js App Router, Supabase auth/database/storage, Stripe billing, Vercel deployment',
            url: `${BASE_URL}/templates/nextjs-supabase-stripe-saas`,
          },
          {
            '@type': 'ListItem',
            position: 4,
            name: 'AI RAG Pipeline',
            description: 'LangChain orchestration, vector database, embedding pipeline, inference service architecture',
            url: `${BASE_URL}/templates/ai-rag-pipeline`,
          },
        ],
      },
    ],
  },
  {
    path: '/blog',
    title: 'NodeSpec Blog - Software Architecture & AI Development Insights',
    description:
      'Insights on software architecture, AI-driven development, and building better systems. Expert articles from the NodeSpec team.',
    keywords:
      'software architecture, system design, AI development, architecture diagrams, tech blog',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        name: `${SITE_NAME} Blog`,
        description:
          'Insights on software architecture, AI-driven development, and building better systems. Expert articles from the NodeSpec team.',
        url: `${BASE_URL}/blog`,
        publisher: {
          '@type': 'Organization',
          name: SITE_NAME,
          logo: { '@type': 'ImageObject', url: DEFAULT_IMAGE },
        },
      },
    ],
  },
  {
    path: '/government',
    title: 'NodeSpec for Government - AI-Native Architecture for Defense & Federal',
    description:
      'Self-deployed AI architecture platform for government enclaves. Supercharge engineering teams to build scalable systems with approved AI tools or on-premises open-weight models.',
    keywords:
      'government AI architecture, federal software architecture, defense technology, FedRAMP, IL5, air-gapped deployment',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'NodeSpec for Government',
        description: 'Self-deployed AI architecture platform for government enclaves. Works with approved AI tools or on-premises open-weight models in controlled environments.',
        url: `${BASE_URL}/government`,
        specialty: 'Government & Defense Software Architecture',
        audience: {
          '@type': 'Audience',
          audienceType: 'Government agencies, defense contractors, federal IT teams',
        },
        provider: {
          '@type': 'Organization',
          name: SITE_NAME,
          url: BASE_URL,
        },
      },
    ],
  },
  {
    path: '/docs/mcp',
    title: 'MCP Integration Documentation - NodeSpec',
    description:
      'Complete documentation for integrating external AI agents with NodeSpec via the Model Context Protocol (MCP). Learn the tool workflow, authentication methods, and full API reference.',
    keywords:
      'MCP integration, Model Context Protocol, AI agent integration, NodeSpec API, Claude MCP, architecture context API',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy - NodeSpec',
    description:
      'Learn how NodeSpec collects, uses, and protects your personal information. Read our privacy policy for details on data handling practices.',
  },
  {
    path: '/terms',
    title: 'Terms of Service - NodeSpec',
    description:
      'Read the NodeSpec terms of service. Understand your rights and responsibilities when using our software architecture platform.',
  },
];

interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  published_at: string;
  cover_image_url?: string;
  keywords?: string[];
  meta_title?: string;
  meta_description?: string;
}

interface Template {
  slug: string;
  name: string;
  description: string;
}

async function fetchDynamicRoutes(): Promise<RouteMeta[]> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('[prerender] No Supabase credentials found, skipping dynamic routes');
    return [];
  }

  const routes: RouteMeta[] = [];

  try {
    const blogRes = await fetch(
      `${supabaseUrl}/rest/v1/blog_posts?status=eq.published&select=slug,title,excerpt,published_at,cover_image_url,keywords,meta_title,meta_description`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );

    if (blogRes.ok) {
      const posts: BlogPost[] = await blogRes.json();
      for (const post of posts) {
        const pageTitle = post.meta_title || `${post.title} | ${SITE_NAME} Blog`;
        const pageDescription = post.meta_description || post.excerpt || post.title;
        routes.push({
          path: `/blog/${post.slug}`,
          title: pageTitle,
          description: pageDescription.slice(0, 160),
          keywords: post.keywords?.join(', '),
          ogType: 'article',
          image: post.cover_image_url || undefined,
          jsonLd: [
            {
              '@context': 'https://schema.org',
              '@type': 'BlogPosting',
              headline: post.title,
              description: pageDescription,
              image: post.cover_image_url || DEFAULT_IMAGE,
              url: `${BASE_URL}/blog/${post.slug}`,
              datePublished: new Date(post.published_at).toISOString(),
              author: { '@type': 'Organization', name: SITE_NAME, url: BASE_URL },
              publisher: {
                '@type': 'Organization',
                name: SITE_NAME,
                logo: { '@type': 'ImageObject', url: DEFAULT_IMAGE },
              },
            },
          ],
        });
      }
      console.log(`[prerender] Found ${posts.length} blog posts`);
    }
  } catch (e) {
    console.warn('[prerender] Failed to fetch blog posts:', e);
  }

  try {
    const tplRes = await fetch(
      `${supabaseUrl}/rest/v1/project_templates?is_public=eq.true&select=slug,name,description`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );

    if (tplRes.ok) {
      const templates: Template[] = await tplRes.json();
      for (const t of templates) {
        routes.push({
          path: `/templates/${t.slug}`,
          title: `${t.name} - Architecture Template | NodeSpec`,
          description: (t.description || t.name).slice(0, 160),
          keywords: `${t.name}, architecture template, system design`,
          // Live architecture card rendered by the og-image edge function —
          // crawlers fetch it directly (verify_jwt=false), so shares show
          // the actual graph instead of the generic brand card.
          image: `${supabaseUrl}/functions/v1/og-image?template=${encodeURIComponent(t.slug)}`,
        });
      }
      console.log(`[prerender] Found ${templates.length} templates`);
    }
  } catch (e) {
    console.warn('[prerender] Failed to fetch templates:', e);
  }

  try {
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/user_profiles?is_public=eq.true&select=handle,display_name,bio`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );

    if (profileRes.ok) {
      const profiles: Array<{ handle: string; display_name: string | null; bio: string | null }> =
        await profileRes.json();
      for (const p of profiles) {
        routes.push({
          path: `/u/${p.handle}`,
          title: `${p.display_name || p.handle} - Builder Profile | ${SITE_NAME}`,
          description: (p.bio || `Architectures ${p.display_name || p.handle} published to the NodeSpec community marketplace.`).slice(0, 160),
          keywords: 'NodeSpec builder, architecture templates, community',
        });
      }
      console.log(`[prerender] Found ${profiles.length} public profiles`);
    }
  } catch (e) {
    console.warn('[prerender] Failed to fetch profiles:', e);
  }

  return routes;
}

function buildHead(route: RouteMeta): string {
  const canonicalUrl = `${BASE_URL}${route.path}`;
  const image = route.image || DEFAULT_IMAGE;
  const ogType = route.ogType || 'website';

  const lines: string[] = [
    `<title>${escapeHtml(route.title)}</title>`,
    `<meta name="description" content="${escapeAttr(route.description)}" />`,
    `<link rel="canonical" href="${canonicalUrl}" />`,
    route.noIndex
      ? `<meta name="robots" content="noindex, nofollow" />`
      : `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />`,
  ];

  if (route.keywords) {
    lines.push(`<meta name="keywords" content="${escapeAttr(route.keywords)}" />`);
  }

  // Open Graph
  lines.push(
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:title" content="${escapeAttr(route.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(route.description)}" />`,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:alt" content="${escapeAttr(route.title)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en_US" />`,
  );

  // Twitter
  lines.push(
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(route.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(route.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:site" content="@nodespec" />`,
  );

  // JSON-LD
  if (route.jsonLd) {
    for (const data of route.jsonLd) {
      lines.push(
        `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
      );
    }
  }

  return lines.join('\n    ');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function generateHtml(template: string, route: RouteMeta): string {
  const headContent = buildHead(route);

  // Replace the existing <title> and meta tags in the template head
  // We insert our route-specific meta right after <meta charset="UTF-8" />
  let html = template;

  // Remove existing title tag
  html = html.replace(/<title>[^<]*<\/title>/, '');

  // Remove existing meta description
  html = html.replace(/<meta name="description"[^>]*\/>/, '');

  // Remove existing meta keywords
  html = html.replace(/<meta name="keywords"[^>]*\/>/, '');

  // Remove existing meta robots
  html = html.replace(/<meta name="robots"[^>]*\/>/, '');

  // Remove existing canonical
  html = html.replace(/<link rel="canonical"[^>]*\/>/, '');

  // Remove existing OG tags
  html = html.replace(/<meta property="og:[^"]*"[^>]*\/>/g, '');

  // Remove existing Twitter tags
  html = html.replace(/<meta name="twitter:[^"]*"[^>]*\/>/g, '');

  // Remove existing JSON-LD (we'll add route-specific ones)
  html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');

  // Insert our meta tags after the viewport meta
  html = html.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    ${headContent}`,
  );

  return html;
}

async function main() {
  const templatePath = path.join(DIST_DIR, 'index.html');

  if (!fs.existsSync(templatePath)) {
    console.error('[prerender] dist/index.html not found. Run vite build first.');
    process.exit(1);
  }

  const template = fs.readFileSync(templatePath, 'utf-8');
  const dynamicRoutes = await fetchDynamicRoutes();
  const allRoutes = [...STATIC_ROUTES, ...dynamicRoutes];

  let count = 0;
  for (const route of allRoutes) {
    const html = generateHtml(template, route);
    const routePath = route.path === '/' ? '/index.html' : `${route.path}/index.html`;
    const filePath = path.join(DIST_DIR, routePath);
    const dir = path.dirname(filePath);

    fs.mkdirSync(dir, { recursive: true });

    if (route.path === '/') {
      // Overwrite the root index.html
      fs.writeFileSync(filePath, html);
    } else {
      fs.writeFileSync(filePath, html);
    }
    count++;
  }

  console.log(`[prerender] Generated ${count} HTML files`);
}

main().catch((err) => {
  console.error('[prerender] Fatal error:', err);
  process.exit(1);
});

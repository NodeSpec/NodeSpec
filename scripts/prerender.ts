import fs from 'node:fs';
import path from 'node:path';
import {
  BASE_URL, LOGO, SITE_NAME, BLOG_POST_SELECT, applyHead, blogPostRoute, noIndexShell, withSnapshot, type BlogPostRow, type RouteMeta,
} from '../src/seo/page-head.ts';
import { HOME_SEO, homeJsonLd } from '../src/seo/site-meta.ts';
import { landingSnapshotHtml } from '../src/seo/landing-snapshot.ts';

const DIST_DIR = path.resolve(import.meta.dirname, '..', 'dist');

const STATIC_ROUTES: RouteMeta[] = [
  {
    path: '/',
    ...HOME_SEO,
    jsonLd: homeJsonLd(),
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
          logo: { '@type': 'ImageObject', url: LOGO },
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
      `${supabaseUrl}/rest/v1/blog_posts?status=eq.published&select=${BLOG_POST_SELECT}`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );

    if (blogRes.ok) {
      const posts: BlogPostRow[] = await blogRes.json();
      for (const post of posts) routes.push(blogPostRoute(post));
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

async function main() {
  const templatePath = path.join(DIST_DIR, 'index.html');

  if (!fs.existsSync(templatePath)) {
    console.error('[prerender] dist/index.html not found. Run vite build first.');
    process.exit(1);
  }

  const template = fs.readFileSync(templatePath, 'utf-8');

  // Only the managed site is for search engines. A self-hosted, Enterprise or
  // Government build, or a deploy preview, keeps nodespec.io's canonical and indexing
  // out of its pages and prerenders none of the marketing routes (AJ.2).
  if (process.env.VITE_NODESPEC_EDITION !== 'hosted') {
    fs.writeFileSync(templatePath, noIndexShell(template));
    console.log('[prerender] Not the hosted edition: the shell says noindex and no routes are prerendered');
    return;
  }

  const dynamicRoutes = await fetchDynamicRoutes();
  const allRoutes = [...STATIC_ROUTES, ...dynamicRoutes];

  let count = 0;
  for (const route of allRoutes) {
    // The homepage carries its words for crawlers that run no script; no other page does.
    const html = route.path === '/' ? withSnapshot(applyHead(template, route), landingSnapshotHtml()) : applyHead(template, route);
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

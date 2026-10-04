// The <head> a crawler reads, built one way for the build-time prerender
// (scripts/prerender.ts) and the managed site's blog edge function
// (src/seo/blog-meta.ts), so a post published from the CMS after a deploy gets
// the same title, canonical, Open Graph and structured data as one the build saw
// (AJ.2, owner 2026-09-30). Plain TypeScript with no imports: Netlify's edge
// runtime bundles it as it is.

export const BASE_URL = 'https://nodespec.io';
export const SITE_NAME = 'NodeSpec';
export const DEFAULT_IMAGE = `${BASE_URL}/og-card.png`;
/** The real size of og-card.png, the 1.91:1 card link previews expect; a declared
 *  size that differs makes crawlers crop it. */
export const DEFAULT_IMAGE_SIZE = { width: 1200, height: 630 } as const;
/** The square mark (the wordmark file is a wide canvas, mostly empty). */
export const LOGO = `${BASE_URL}/icon-512.png`;

export interface RouteMeta {
  path: string;
  title: string;
  description: string;
  keywords?: string;
  ogType?: string;
  image?: string;
  /** Set when the image's size is known; the default image's always is. */
  imageSize?: { width: number; height: number };
  noIndex?: boolean;
  jsonLd?: object[];
}

/** A published row of blog_posts, as the prerender and the edge function select it. */
export interface BlogPostRow {
  slug: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
  updated_at?: string | null;
  cover_image_url: string | null;
  keywords: string[] | null;
  meta_title: string | null;
  meta_description: string | null;
}

export const BLOG_POST_SELECT =
  'slug,title,excerpt,published_at,updated_at,cover_image_url,keywords,meta_title,meta_description';

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

/** JSON inside <script>: "<" is escaped so no value can end the script. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function blogPostRoute(post: BlogPostRow): RouteMeta {
  const url = `${BASE_URL}/blog/${post.slug}`;
  const title = post.meta_title || `${post.title} | ${SITE_NAME} Blog`;
  const description = (post.meta_description || post.excerpt || post.title).slice(0, 160);
  const published = isoOrNull(post.published_at);
  const modified = isoOrNull(post.updated_at) ?? published;
  const image = post.cover_image_url || undefined;
  return {
    path: `/blog/${post.slug}`,
    title,
    description,
    keywords: post.keywords?.length ? post.keywords.join(', ') : undefined,
    ogType: 'article',
    image,
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description,
      image: image ?? DEFAULT_IMAGE,
      url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      ...(published ? { datePublished: published } : {}),
      ...(modified ? { dateModified: modified } : {}),
      ...(post.keywords?.length ? { keywords: post.keywords.join(', ') } : {}),
      author: { '@type': 'Organization', name: SITE_NAME, url: BASE_URL },
      publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: LOGO } },
    }],
  };
}

export function notFoundRoute(path: string): RouteMeta {
  return {
    path,
    title: `Post not found | ${SITE_NAME} Blog`,
    description: 'This post does not exist or is no longer published.',
    noIndex: true,
  };
}

export function buildHead(route: RouteMeta): string {
  const canonicalUrl = `${BASE_URL}${route.path}`;
  const image = route.image || DEFAULT_IMAGE;
  const size = route.imageSize ?? (image === DEFAULT_IMAGE ? DEFAULT_IMAGE_SIZE : undefined);
  const lines: string[] = [
    `<title>${escapeHtml(route.title)}</title>`,
    `<meta name="description" content="${escapeAttr(route.description)}" />`,
    `<link rel="canonical" href="${escapeAttr(canonicalUrl)}" />`,
    route.noIndex
      ? `<meta name="robots" content="noindex, nofollow" />`
      : `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />`,
  ];
  if (route.keywords) lines.push(`<meta name="keywords" content="${escapeAttr(route.keywords)}" />`);
  lines.push(
    `<meta property="og:type" content="${escapeAttr(route.ogType || 'website')}" />`,
    `<meta property="og:title" content="${escapeAttr(route.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(route.description)}" />`,
    `<meta property="og:url" content="${escapeAttr(canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeAttr(image)}" />`,
    `<meta property="og:image:alt" content="${escapeAttr(route.title)}" />`,
  );
  if (size) {
    lines.push(
      `<meta property="og:image:width" content="${size.width}" />`,
      `<meta property="og:image:height" content="${size.height}" />`,
    );
  }
  lines.push(
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(route.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(route.description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
    `<meta name="twitter:site" content="@nodespec" />`,
  );
  for (const data of route.jsonLd ?? []) {
    lines.push(`<script type="application/ld+json">${scriptJson(data)}</script>`);
  }
  return lines.join('\n    ');
}

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1.0" />';

/** The shell with its route meta replaced by this route's: whatever head the shell
 *  carried (the homepage's, or a post's from an older build) is removed first. */
export function applyHead(shell: string, route: RouteMeta): string {
  if (!shell.includes(VIEWPORT)) throw new Error('the page shell has no viewport meta to anchor the head');
  const html = shell
    .replace(/<title>[^<]*<\/title>/g, '')
    .replace(/<meta name="(description|keywords|robots)"[^>]*\/>/g, '')
    .replace(/<link rel="canonical"[^>]*\/>/g, '')
    .replace(/<meta property="og:[^"]*"[^>]*\/>/g, '')
    .replace(/<meta name="twitter:[^"]*"[^>]*\/>/g, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  return html.replace(VIEWPORT, `${VIEWPORT}\n    ${buildHead(route)}`);
}

/** The shell for a build that is not the managed site: no canonical, no og:url, and
 *  a noindex robots line, so a self-hosted install never presents itself as
 *  nodespec.io or gets indexed. */
export function noIndexShell(shell: string): string {
  const stripped = shell
    .replace(/<link rel="canonical"[^>]*\/>\s*/g, '')
    .replace(/<meta property="og:url"[^>]*\/>\s*/g, '')
    .replace(/<meta name="robots"[^>]*\/>\s*/g, '');
  return stripped.replace(VIEWPORT, `${VIEWPORT}\n    <meta name="robots" content="noindex, nofollow" />`);
}

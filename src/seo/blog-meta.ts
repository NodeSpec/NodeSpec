// The blog's head at request time on the managed site (AJ.2, owner 2026-09-30: "I
// will begin to add content via our CMS"). The build prerenders the posts it can
// see; a post published, edited or taken down afterwards would otherwise be served
// the homepage shell with the homepage's title and canonical until the next deploy.
// netlify/edge-functions/blog-meta.ts calls this for /blog/*: a published post gets
// its own head, a slug with no published post gets a 404 with noindex, and when
// the database cannot be asked the static page is served as it is.
import { applyHead, blogPostRoute, notFoundRoute, BLOG_POST_SELECT, type BlogPostRow } from './page-head.ts';

const POST_PATH = /^\/blog\/([a-z0-9][a-z0-9-]{0,200})\/?$/;
const LOOKUP_TIMEOUT_MS = 3000;

export type EnvReader = (name: string) => string | undefined;

/** A Response, or undefined to let the static site answer as it would have. */
export async function blogMetaResponse(
  request: Request,
  next: () => Promise<Response>,
  env: EnvReader,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | undefined> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
  const url = new URL(request.url);
  const slug = POST_PATH.exec(url.pathname)?.[1];
  if (!slug) return undefined;
  const supabaseUrl = env('VITE_SUPABASE_URL');
  const anonKey = env('VITE_SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return undefined;

  let rows: BlogPostRow[];
  try {
    const res = await fetchImpl(
      `${supabaseUrl}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=${BLOG_POST_SELECT}&limit=1`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
    );
    if (!res.ok) return undefined;
    rows = await res.json();
    if (!Array.isArray(rows)) return undefined;
  } catch {
    return undefined;
  }

  const shell = await next();
  if (!(shell.headers.get('content-type') ?? '').includes('text/html')) return shell;
  const html = await shell.text();
  const post = rows[0];
  let body: string;
  try {
    body = applyHead(html, post ? blogPostRoute(post) : notFoundRoute(`/blog/${slug}`));
  } catch {
    return new Response(html, { status: shell.status, headers: shell.headers });
  }
  const headers = new Headers(shell.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('content-length');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  if (post) {
    headers.set('netlify-cdn-cache-control', 'public, s-maxage=300, stale-while-revalidate=86400');
    return new Response(body, { status: 200, headers });
  }
  headers.set('netlify-cdn-cache-control', 'public, s-maxage=60');
  headers.set('x-robots-tag', 'noindex, nofollow');
  return new Response(body, { status: 404, headers });
}

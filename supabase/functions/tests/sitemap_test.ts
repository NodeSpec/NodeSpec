// AJ.2 (owner 2026-09-30): the sitemap is how a crawler finds a post published from the
// CMS. nodespec.io/sitemap.xml proxies to this function; a static public/sitemap.xml used
// to answer instead, so no post ever reached it. It lists what is really there: published
// posts dated by their last change, and no page that only redirects.
import { assert, assertEquals } from './helpers.ts';

type Handler = (req: Request) => Promise<Response>;

let handler: Handler | undefined;

/** The module registers its handler once, on first import. */
async function loadSitemap(): Promise<Handler> {
  if (handler) return handler;
  const deno = Deno as unknown as { serve: unknown };
  const serve = deno.serve;
  deno.serve = (h: Handler) => { handler = h; return {}; };
  try {
    await import('../sitemap/index.ts');
  } finally {
    deno.serve = serve;
  }
  if (!handler) throw new Error('the sitemap function registered no handler');
  return handler;
}

const ROWS: Record<string, unknown[]> = {
  blog_posts: [
    { slug: 'mapping-a-large-crm', title: 'Mapping a <large> CRM', published_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-20T08:30:00Z', cover_image_url: 'https://cdn.example/c.png?w=1&h=2' },
    { slug: 'first-post', title: 'First', published_at: '2026-08-01T10:00:00Z', updated_at: null, cover_image_url: null },
  ],
  project_templates: [{ slug: 'saas-starter', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-05T00:00:00Z' }],
  user_profiles: [{ handle: 'ada', created_at: '2026-06-01T00:00:00Z', updated_at: null }],
};

async function sitemap(): Promise<{ xml: string; asked: URL[] }> {
  Deno.env.set('SUPABASE_URL', 'http://supabase.test');
  Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
  const asked: URL[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url);
    const table = url.pathname.split('/').pop()!;
    return new Response(JSON.stringify(ROWS[table] ?? []), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const handler = await loadSitemap();
    const res = await handler(new Request('http://localhost/functions/v1/sitemap'));
    assertEquals(res.status, 200);
    assert(res.headers.get('content-type')?.startsWith('application/xml'));
    return { xml: await res.text(), asked };
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Each <url> entry, by its <loc>. */
function entries(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([^<]*)<\/loc>/.exec(m[1])![1];
    out.set(loc, m[1]);
  }
  return out;
}

Deno.test('the sitemap lists published posts dated by their last change, and asks only for published ones', async () => {
  const { xml, asked } = await sitemap();
  const byLoc = entries(xml);
  const post = byLoc.get('https://nodespec.io/blog/mapping-a-large-crm')!;
  assert(post, 'the post is listed');
  assert(post.includes('<lastmod>2026-09-20</lastmod>'), 'dated by updated_at');
  assert(post.includes('<image:loc>https://cdn.example/c.png?w=1&amp;h=2</image:loc>'), 'the cover is listed, escaped');
  assert(post.includes('<image:title>Mapping a &lt;large&gt; CRM</image:title>'));
  assert(byLoc.get('https://nodespec.io/blog/first-post')!.includes('<lastmod>2026-08-01</lastmod>'), 'never edited: its publish date');
  assert(byLoc.has('https://nodespec.io/templates/saas-starter'));
  assert(byLoc.has('https://nodespec.io/u/ada'));
  const blogQuery = asked.find((u) => u.pathname.endsWith('/blog_posts'))!;
  assertEquals(blogQuery.searchParams.get('status'), 'eq.published');
});

Deno.test('fixed pages carry no invented date, and no page that only redirects is listed', async () => {
  const { xml } = await sitemap();
  const byLoc = entries(xml);
  for (const page of ['/', '/templates', '/blog', '/government', '/docs/mcp', '/privacy', '/terms']) {
    const entry = byLoc.get(`https://nodespec.io${page}`);
    assert(entry, `${page} is listed`);
    assert(!entry.includes('<lastmod>'), `${page} has no lastmod`);
  }
  assert(!byLoc.has('https://nodespec.io/pricing'), 'signed out, /pricing sends the visitor to the homepage');
});

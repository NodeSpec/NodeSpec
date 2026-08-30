import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE_URL = 'https://nodespec.io';

const STATIC_URLS = [
  { loc: `${BASE_URL}/`, changefreq: 'weekly', priority: '1.0' },
  { loc: `${BASE_URL}/templates`, changefreq: 'weekly', priority: '0.8' },
  { loc: `${BASE_URL}/blog`, changefreq: 'daily', priority: '0.9' },
  { loc: `${BASE_URL}/pricing`, changefreq: 'monthly', priority: '0.7' },
  { loc: `${BASE_URL}/government`, changefreq: 'monthly', priority: '0.7' },
  { loc: `${BASE_URL}/docs/mcp`, changefreq: 'monthly', priority: '0.6' },
  { loc: `${BASE_URL}/privacy`, changefreq: 'monthly', priority: '0.3' },
  { loc: `${BASE_URL}/terms`, changefreq: 'monthly', priority: '0.3' },
];

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const [blogResult, templateResult, profileResult] = await Promise.all([
      supabase
        .from('blog_posts')
        .select('slug, title, published_at, updated_at, cover_image_url')
        .eq('status', 'published')
        .order('published_at', { ascending: false }),
      supabase
        .from('project_templates')
        .select('slug, created_at, updated_at')
        .eq('is_public', true)
        .order('created_at', { ascending: false }),
      // Anon RLS already trims to public profiles.
      supabase
        .from('user_profiles')
        .select('handle, created_at, updated_at')
        .eq('is_public', true)
        .order('created_at', { ascending: false }),
    ]);

    const posts = blogResult.data ?? [];
    const templates = templateResult.data ?? [];
    const profiles = profileResult.data ?? [];
    const today = new Date().toISOString().split('T')[0];

    const staticEntries = STATIC_URLS.map(
      (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
    ).join('\n');

    const postEntries = posts.map((post: { slug: string; title: string; published_at: string; updated_at?: string; cover_image_url?: string }) => {
      const lastmod = (post.updated_at || post.published_at).split('T')[0];
      const imageTag = post.cover_image_url
        ? `\n    <image:image>\n      <image:loc>${escapeXml(post.cover_image_url)}</image:loc>\n      <image:title>${escapeXml(post.title)}</image:title>\n    </image:image>`
        : '';
      return `  <url>
    <loc>${escapeXml(`${BASE_URL}/blog/${post.slug}`)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>${imageTag}
  </url>`;
    }).join('\n');

    const templateEntries = templates.map((t: { slug: string; created_at: string; updated_at?: string }) => {
      const lastmod = (t.updated_at || t.created_at).split('T')[0];
      return `  <url>
    <loc>${escapeXml(`${BASE_URL}/templates/${t.slug}`)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`;
    }).join('\n');

    const profileEntries = profiles.map((p: { handle: string; created_at: string; updated_at?: string }) => {
      const lastmod = (p.updated_at || p.created_at).split('T')[0];
      return `  <url>
    <loc>${escapeXml(`${BASE_URL}/u/${p.handle}`)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>`;
    }).join('\n');

    const allEntries = [staticEntries, postEntries, templateEntries, profileEntries]
      .filter(Boolean)
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${allEntries}
</urlset>`;

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('Sitemap error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
});

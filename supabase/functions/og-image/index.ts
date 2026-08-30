// Social share card renderer: GET ?template=<slug> → 1200×630 PNG.
//
// LinkedIn/X/iMessage crawlers fetch og:image with no credentials, so this
// function is deployed with verify_jwt = false (config.toml) and reads only
// public template rows via the service client. The card is a real render of
// the template's architecture: the shared preview layout positions nodes,
// og-svg draws them (tech icons inlined as data URIs — resvg cannot fetch
// the network), and the vendored resvg wasm + Inter fonts (SIL OFL,
// static_files in config.toml) rasterize to PNG with zero cold-start
// network dependencies.
//
// Any failure — unknown slug, wasm init, icon trouble — 302s to the static
// brand card so a share preview never breaks.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildTemplateOgSvg, type OgSvgNode } from "../_shared/og-svg.ts";
import type { OgLayoutEdge } from "../_shared/og-preview-layout.ts";

const FALLBACK_IMAGE = "https://nodespec.io/og-card.png";
const MAX_ICON_TECHS = 12;
const MAX_ICON_BYTES = 120_000;

// deno-lint-ignore no-explicit-any
let resvgModule: Promise<any> | null = null;
let wasmReady: Promise<void> | null = null;
let fontsPromise: Promise<Uint8Array[]> | null = null;
// Per-isolate icon cache: technology id → data URI (or null = known-missing).
const iconCache = new Map<string, string | null>();

/**
 * The renderer is loaded LAZILY, on the first request that actually needs it —
 * never at module load.
 *
 * `@resvg/resvg-wasm` is this repo's only npm dependency outside `_shared`, and
 * a static import made every consumer of the functions tree resolve it at boot:
 * `supabase functions serve` bundles all functions up front, so on a machine
 * whose Deno cache lacks the package (or whose container cannot reach the
 * registry) the WHOLE local stack failed to come up — one optional share-card
 * feature taking down the bench and every other function with it. A dynamic
 * import scopes that failure to og-image alone, where the existing 302
 * fallback already turns it into a plain brand card instead of an outage.
 */
// deno-lint-ignore no-explicit-any
function loadResvg(): Promise<any> {
  if (!resvgModule) resvgModule = import("npm:@resvg/resvg-wasm@2.6.2");
  return resvgModule;
}

async function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    const { initWasm } = await loadResvg();
    wasmReady = Deno.readFile(new URL("./resvg.wasm", import.meta.url)).then(
      (bytes: Uint8Array) => initWasm(bytes)
    );
  }
  return wasmReady;
}

function loadFonts(): Promise<Uint8Array[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      Deno.readFile(new URL("./Inter-Regular.ttf", import.meta.url)),
      Deno.readFile(new URL("./Inter-SemiBold.ttf", import.meta.url)),
    ]);
  }
  return fontsPromise;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchIconDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/image\/(png|jpeg|webp)/.test(type)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
    const mime = type.includes("jpeg") ? "image/jpeg" : type.includes("webp") ? "image/webp" : "image/png";
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const fallback = () =>
    new Response(null, {
      status: 302,
      headers: { Location: FALLBACK_IMAGE, "Cache-Control": "public, max-age=300" },
    });

  try {
    if (req.method !== "GET") return fallback();
    const slug = new URL(req.url).searchParams.get("template");
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) return fallback();

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return fallback();
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: template } = await supabase
      .from("project_templates")
      .select("name, graph_data, node_count, edge_count, author_id, author_type, is_public")
      .eq("slug", slug)
      .eq("is_public", true)
      .maybeSingle();
    if (!template) return fallback();

    let authorLabel: string | undefined;
    if (template.author_type === "community" && template.author_id) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name, handle, is_public")
        .eq("user_id", template.author_id)
        .maybeSingle();
      if (profile?.is_public) {
        authorLabel = profile.display_name || `@${profile.handle}`;
      }
    }

    const graph = (template.graph_data ?? {}) as {
      nodes?: Record<string, { id: string; label?: string; parentId?: string; technology?: string }>;
      edges?: Record<string, { source: string; target: string }>;
    };
    const rawNodes = Object.values(graph.nodes ?? {});
    if (rawNodes.length === 0) return fallback();

    // Icons for the distinct technologies (capped): catalog icon_url → data
    // URI, cached per isolate so repeat renders skip the storage round-trips.
    const technologies = [
      ...new Set(
        rawNodes
          .map((n) => (typeof n.technology === "string" ? n.technology : ""))
          .filter((t) => t.length > 0)
      ),
    ].slice(0, MAX_ICON_TECHS);
    const uncached = technologies.filter((t) => !iconCache.has(t));
    if (uncached.length > 0) {
      const { data: catalogRows } = await supabase
        .from("technology_catalog")
        .select("id, icon_url")
        .in("id", uncached);
      const urlById = new Map(
        (catalogRows ?? []).map((r: { id: string; icon_url: string | null }) => [r.id, r.icon_url])
      );
      await Promise.all(
        uncached.map(async (tech) => {
          const url = urlById.get(tech);
          iconCache.set(tech, url ? await fetchIconDataUri(url) : null);
        })
      );
    }

    const nodes: OgSvgNode[] = rawNodes.map((n) => ({
      id: n.id,
      label: n.label ?? "",
      parentId: n.parentId,
      iconDataUri:
        (typeof n.technology === "string" && iconCache.get(n.technology)) || undefined,
    }));
    const edges: OgLayoutEdge[] = Object.values(graph.edges ?? {}).map((e) => ({
      source: e.source,
      target: e.target,
    }));

    const svg = buildTemplateOgSvg({
      name: template.name,
      authorLabel,
      nodeCount: template.node_count ?? rawNodes.length,
      edgeCount: template.edge_count ?? edges.length,
      nodes,
      edges,
    });

    await ensureWasm();
    const { Resvg } = await loadResvg();
    const fonts = await loadFonts();
    const resvg = new Resvg(svg, {
      fitTo: { mode: "original" },
      font: {
        fontBuffers: fonts,
        defaultFontFamily: "Inter",
        loadSystemFonts: false,
      },
      background: "#f8f9fc",
    });
    const png = resvg.render().asPng();

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        // Fresh-ish for humans, a day at the CDN — republish bumps content
        // within the s-maxage window at worst.
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (err) {
    console.error("og-image render failed:", err instanceof Error ? err.message : err);
    return fallback();
  }
});

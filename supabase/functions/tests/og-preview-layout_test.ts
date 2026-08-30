// Cross-runtime layout parity. The og-image function carries a copy of the
// client's computePreviewLayout (React Flow types made portable); this test
// pins the copy to the SAME fixture that src/tests/preview-layout-parity
// .test.ts asserts against the original — if either side changes, both
// suites fail together and the fixture gets regenerated deliberately.
import {
  computeOgPreviewLayout,
  resolveAbsolutePositions,
  toLayoutNodes,
} from "../_shared/og-preview-layout.ts";
import { buildTemplateOgSvg } from "../_shared/og-svg.ts";
import { assert, assertEquals } from "./helpers.ts";

const fixture = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/og-preview-layout-fixture.json", import.meta.url)
  )
) as {
  nodes: Array<{ id: string; type: string; parentId?: string }>;
  edges: Array<{ source: string; target: string }>;
  positions: Array<{ id: string; x: number; y: number }>;
  sizes: Array<{ id: string; width: number; height: number }>;
};

Deno.test("Deno layout copy matches the client golden exactly", () => {
  const layoutNodes = toLayoutNodes(fixture.nodes);
  const result = computeOgPreviewLayout(layoutNodes, fixture.edges);
  assertEquals(
    result.positions,
    fixture.positions,
    "positions drifted from the client layout — regenerate the fixture AND update the vitest parity suite"
  );
  assertEquals(result.sizes, fixture.sizes, "sizes drifted from the client layout");
});

Deno.test("toLayoutNodes derives container-ness from parentId references", () => {
  const layoutNodes = toLayoutNodes(fixture.nodes);
  const byId = new Map(layoutNodes.map((n) => [n.id, n]));
  assert(byId.get("frontend")!.isContainer, "frontend should be a container");
  assert(byId.get("jobs")!.isContainer, "nested jobs should be a container");
  assert(!byId.get("api")!.isContainer, "api is a leaf");
  assert(!byId.get("cdn")!.isContainer, "top-level cdn is a leaf");
});

Deno.test("resolveAbsolutePositions composes ancestor offsets", () => {
  const layoutNodes = toLayoutNodes(fixture.nodes);
  const layout = computeOgPreviewLayout(layoutNodes, fixture.edges);
  const absolute = resolveAbsolutePositions(layoutNodes, layout);
  const rel = new Map(layout.positions.map((p) => [p.id, p]));

  // worker sits inside jobs inside backend: absolute = sum of the chain.
  const worker = absolute.get("worker")!;
  const expectedX = rel.get("worker")!.x + rel.get("jobs")!.x + rel.get("backend")!.x;
  const expectedY = rel.get("worker")!.y + rel.get("jobs")!.y + rel.get("backend")!.y;
  assertEquals(worker.x, expectedX, "worker absolute x");
  assertEquals(worker.y, expectedY, "worker absolute y");

  // A parentId cycle must not hang.
  const cyclic = toLayoutNodes([
    { id: "a", parentId: "b" },
    { id: "b", parentId: "a" },
  ]);
  const cyclicAbs = resolveAbsolutePositions(cyclic, { positions: [], sizes: [] });
  assert(cyclicAbs.has("a") && cyclicAbs.has("b"), "cycle resolved without hanging");
});

Deno.test("buildTemplateOgSvg emits a self-contained 1200x630 card", () => {
  const svg = buildTemplateOgSvg({
    name: 'My "SaaS" <Starter> & Co',
    authorLabel: "@jane",
    nodeCount: fixture.nodes.length,
    edgeCount: fixture.edges.length,
    nodes: fixture.nodes.map((n) => ({
      id: n.id,
      label: n.id.toUpperCase(),
      parentId: n.parentId,
      iconDataUri:
        n.id === "api"
          ? "data:image/png;base64,iVBORw0KGgo="
          : n.id === "db"
            ? "https://evil.example.com/icon.png" // must NOT be embedded
            : undefined,
    })),
    edges: fixture.edges,
  });

  assert(svg.startsWith("<svg"), "not an svg");
  assert(svg.includes('width="1200"') && svg.includes('height="630"'), "wrong card size");
  // Self-contained: the only hrefs are safe data URIs.
  const hrefs = [...svg.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert(hrefs.length > 0, "expected the api icon to embed");
  assert(
    hrefs.every((h) => h.startsWith("data:image/")),
    `external href leaked into the card: ${hrefs.find((h) => !h.startsWith("data:image/"))}`
  );
  // XML-escaped title, containers drawn, edges drawn.
  assert(svg.includes("&quot;SaaS&quot; &lt;Starter&gt; &amp; Co"), "title not escaped");
  assert((svg.match(/<rect/g) ?? []).length >= 4, "expected container + tile rects");
  assert((svg.match(/<line/g) ?? []).length >= 3, "expected leaf edges");
  assert(svg.includes("NodeSpec"), "wordmark missing");
});

Deno.test("og-image loads the renderer lazily — no boot-time npm dependency", () => {
  // Regression guard (owner bench 2026-08-17): a STATIC `npm:@resvg/resvg-wasm`
  // import made every consumer of the functions tree resolve that package at
  // boot. `supabase functions serve` bundles all functions up front, so on a
  // machine whose Deno cache lacked it — or whose container could not reach the
  // registry — the entire local stack failed with "name resolution failed" and
  // took the bench down with it. og-image is optional; it must never be able to
  // break stack boot again.
  const src = Deno.readTextFileSync(new URL("../og-image/index.ts", import.meta.url));
  const staticImports = [...src.matchAll(/^import\s.*$/gm)].map((m) => m[0]);
  assert(
    staticImports.every((line) => !line.includes("npm:")),
    `og-image must not statically import an npm specifier: ${staticImports.find((l) => l.includes("npm:"))}`,
  );
  assert(src.includes('import("npm:@resvg/resvg-wasm@2.6.2")'), "renderer must load via dynamic import");
  assert(/function loadResvg\(\)/.test(src), "lazy loader helper missing");
  // The fallback stays the safety net: a renderer that cannot load must degrade
  // to the static brand card, never surface an error to a crawler.
  assert(src.includes("FALLBACK_IMAGE"), "302 fallback must remain");
});

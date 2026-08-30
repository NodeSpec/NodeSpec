// R3-3b: a design merge IS a git merge, and the DEFAULT vehicle is a pull request.
// The PR body is the R3-2 entity diff rendered as markdown — design review lands
// where code review happens. Direction pin: the body is diffAnchors(target, source)
// = "what merging the source INTO the target does to the target".
import { assert, assertEquals } from "./helpers.ts";
import { serializeModel, parseModel, diffAnchors, renderAnchorDiffMarkdown } from "../_shared/model-anchor.ts";

const S = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const U = "99999999-9999-4999-8999-999999999999";

// deno-lint-ignore no-explicit-any
function graph(mutate?: (g: any) => void): any {
  // deno-lint-ignore no-explicit-any
  const g: any = {
    nodes: {
      [S]: { id: S, type: "backend-service", label: "Api", technology: "python-backend", metadata: {}, ports: [] },
      [T]: { id: T, type: "database", label: "Db", metadata: {}, ports: [] },
    },
    edges: { e1: { id: "66666666-6666-4666-8666-666666666666", source: S, target: T, contractId: "77777777-7777-4777-8777-777777777777", metadata: {} } },
    contracts: { c1: { id: "77777777-7777-4777-8777-777777777777", kind: "sql", name: "Api → Db", schema: {} } },
    artifacts: {},
  };
  mutate?.(g);
  return g;
}

// deno-lint-ignore no-explicit-any
async function anchor(g: any) {
  const parsed = parseModel(await serializeModel(g));
  if (!parsed.ok) throw new Error("fixture anchor failed to parse");
  return parsed.model;
}

Deno.test("identical branches render an honest no-change PR body", async () => {
  const target = await anchor(graph());
  const source = await anchor(graph());
  const md = renderAnchorDiffMarkdown(diffAnchors(target, source), "feature-x", "main");
  assert(md.includes("Merging design branch `feature-x` into `main`"));
  assert(md.includes("No model changes"));
  assert(md.includes("entity-level design diff, not a text diff"));
});

Deno.test("PR body direction = what the merge does to the TARGET (+added on source-only entities)", async () => {
  const target = await anchor(graph());
  const source = await anchor(graph((g) => {
    g.nodes[U] = { id: U, type: "cache", label: "Redis Cache", metadata: {}, ports: [] }; // feature adds a node
    g.nodes[S].technology = "rust";                                                      // feature changes a node
  }));

  const md = renderAnchorDiffMarkdown(diffAnchors(target, source), "feature-x", "main");
  assert(md.includes("### Nodes (+1 / −0 / ~1)"), `counts header missing:\n${md}`);
  assert(md.includes("- + Redis Cache"), "source-only entity reads as ADDED to the target");
  assert(md.includes("- ~ Api"), "hash-moved entity reads as CHANGED");
  // Untouched buckets stay silent — no empty Connections/Contracts/Files sections.
  assert(!md.includes("### Connections"));
  assert(!md.includes("### Contracts"));
});

Deno.test("long entity lists truncate with an honest overflow line, counts stay full", async () => {
  const target = await anchor(graph());
  // deno-lint-ignore no-explicit-any
  const big = graph((g: any) => {
    for (let i = 0; i < 25; i++) {
      const hex = i.toString(16).padStart(2, "0");
      const id = `aaaaaa${hex}-0000-4000-8000-0000000000${hex}`;
      g.nodes[id] = { id, type: "worker", label: `Worker ${i}`, metadata: {}, ports: [] };
    }
  });
  const md = renderAnchorDiffMarkdown(diffAnchors(target, await anchor(big)), "feature-x", "main", 20);
  assert(md.includes("### Nodes (+25 / −0 / ~0)"), "full count survives in the header");
  assert(md.includes("- + … and 5 more"), `overflow line missing:\n${md}`);
});

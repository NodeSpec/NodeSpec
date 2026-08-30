// R3-2: entity-level anchor diff — reconciliation is SET ARITHMETIC on the
// anchor's per-entity contentHashes, never a text merge. Direction convention:
// diffAnchors(ours, theirs) buckets read as "what LOADING theirs would do to ours"
// (added = theirs-only, removed = ours-only, changed = both, different hash).
import { assert, assertEquals } from "./helpers.ts";
import { serializeModel, parseModel, diffAnchors, capAnchorDiff } from "../_shared/model-anchor.ts";

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

Deno.test("identical anchors diff to identical", async () => {
  const a = await anchor(graph());
  const b = await anchor(graph());
  const d = diffAnchors(a, b);
  assert(d.identical);
});

Deno.test("added / removed / changed classify per entity with readable labels", async () => {
  const ours = await anchor(graph());
  const theirs = await anchor(graph((g) => {
    g.nodes[S].technology = "rust";                       // changed
    g.nodes[U] = { id: U, type: "cache", label: "Redis Cache", metadata: {}, ports: [] }; // added
    delete g.edges.e1;                                    // removed (edge)
  }));

  const d = diffAnchors(ours, theirs);
  assert(!d.identical);
  assertEquals(d.nodes.changed.map((e) => e.label), ["Api"], "technology change moves the node contentHash");
  assertEquals(d.nodes.added.map((e) => e.label), ["Redis Cache"]);
  assertEquals(d.nodes.removed, []);
  assertEquals(d.edges.removed.map((e) => e.label), ["Api → Db"], "edge label resolves endpoint NAMES");
  // Deleting the edge orphans its contract, and the C-fix reachability filter drops
  // orphans from the anchor — so the contract honestly reads as removed too.
  assertEquals(d.contracts.removed.map((c) => c.label), ["Api → Db"]);
  assertEquals(d.contracts.added, []);
});

Deno.test("capAnchorDiff keeps full counts when name lists truncate", async () => {
  const ours = await anchor(graph());
  // deno-lint-ignore no-explicit-any
  const big = graph((g: any) => {
    for (let i = 0; i < 12; i++) {
      const id = `aaaaaaa${i.toString(16)}-0000-4000-8000-00000000000${i.toString(16)}`;
      g.nodes[id] = { id, type: "worker", label: `Worker ${i}`, metadata: {}, ports: [] };
    }
  });
  const d = capAnchorDiff(diffAnchors(ours, await anchor(big)), 8);
  assertEquals(d.nodes.addedCount, 12, "count survives");
  assertEquals(d.nodes.added.length, 8, "names cap at 8");
  assertEquals(d.identical, false);
});

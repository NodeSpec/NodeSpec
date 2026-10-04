// AA.3 with AA.5 (owner 2026-09-23): a box and its parts under the lease, and
// the explode signal. The box's lease covers its parts; a part's lease waits
// for the box, and the reverse. The atomic check is the database's (lane
// 077); here: the claim passes the box and the parts, the refusal says which,
// propose_patches refuses a part of a held box, and a collision on a node
// whose files split into groups with no imports between them suggests
// exploding it.
import { explodeSignalLine, fileGroups } from "../_shared/explode-signal.ts";
import { handleCheckoutTask, refusalMessage } from "../mcp-server/tools/checkouts.ts";
import { refuseLeasedNodeTargets } from "../mcp-server/tools/proposals.ts";
import { FakeSupabase, assert, assertEquals } from "./helpers.ts";

const PROJECT = { id: "11111111-1111-4111-8111-111111111111", name: "Bench" };
const BRANCH = "22222222-2222-4222-8222-222222222222";
const BOX = "33333333-3333-4333-8333-333333333333";
const PART = "44444444-4444-4444-8444-444444444444";
const LONE = "55555555-5555-4555-8555-555555555555";
const AUTH = { userId: "user-1", authMethod: "api_key", keyId: "k1", scopes: ["read", "write", "propose"] } as never;
const fresh = () => new Date().toISOString();

const GRAPH = {
  graph_data: {
    nodes: {
      [BOX]: { id: BOX, type: "backend-service", label: "Checkout API" },
      [PART]: { id: PART, type: "part-handler", label: "Routes", parentId: BOX },
      [LONE]: { id: LONE, type: "backend-service", label: "Catalog API" },
    },
  },
};
const ROLES = [
  { id: "backend-service", capability_tags: [], can_contain: ["part-handler", "part-module"] },
  { id: "part-handler", capability_tags: ["part"], can_contain: [] },
  { id: "part-module", capability_tags: ["part"], can_contain: [] },
];

Deno.test("AA.3 explode signal: files split by their imports into groups; lone files do not count", () => {
  const groups = fileGroups(
    ["src/cart/a.ts", "src/cart/b.ts", "src/cart/c.ts", "src/search/x.ts", "src/search/y.ts", "src/util.ts"],
    [
      { from: "src/cart/a.ts", to: "src/cart/b.ts" },
      { from: "src/cart/c.ts", to: "src/cart/b.ts" },
      { from: "src/search/y.ts", to: "src/search/x.ts" },
      { from: "src/cart/a.ts", to: "lib/outside.ts" },
    ],
  );
  assertEquals(groups, [
    { size: 3, sample: ["src/cart/a.ts", "src/cart/b.ts", "src/cart/c.ts"] },
    { size: 2, sample: ["src/search/x.ts", "src/search/y.ts"] },
  ]);
  const line = explodeSignalLine(groups, "Catalog API")!;
  assert(line.startsWith(`"Catalog API"'s files fall into 2 groups with no imports between them (src/cart/a.ts and 2 more; src/search/x.ts and 1 more).`), line);
  assert(line.includes("explode it (explode_node)"), line);
  assertEquals(explodeSignalLine(groups.slice(0, 1), "Catalog API"), null, "one group is no signal");
  // One import joining the groups makes them one.
  assertEquals(fileGroups(["a", "b", "c", "d"], [{ from: "a", to: "b" }, { from: "c", to: "d" }, { from: "b", to: "c" }]).length, 1);
});

Deno.test("AA.3 the refusal says whether the box or a part holds it", () => {
  const box = refusalMessage({ conflict: "node", relation: "box", heldNode: BOX, heldBy: "agent-a", since: "t" }, "node");
  assert(box.startsWith(`The node this one is a part of (${BOX}) is leased by agent-a (since t): a box's lease covers its parts`), box);
  const part = refusalMessage({ conflict: "node", relation: "part", heldNode: PART, heldBy: "agent-b", since: "t" }, "node");
  assert(part.startsWith(`One of this node's parts (${PART}) is leased by agent-b (since t)`), part);
});

Deno.test("AA.3 a claim on a part names its box; a claim on a box names its parts", async () => {
  const onPart = new FakeSupabase();
  onPart.script("projects", "select", { data: PROJECT, error: null });
  onPart.script("rpc", "graph_reference_ids", { data: { nodes: [BOX, PART] }, error: null });
  onPart.script("graph_snapshots", "select", { data: GRAPH, error: null });
  onPart.script("node_roles", "select", { data: ROLES, error: null });
  onPart.script("rpc", "agent_checkout_claim", { data: { claimed: false, conflict: "node", relation: "box", heldNode: BOX, heldBy: "agent-a", since: "t" }, error: null });
  const r = await handleCheckoutTask(onPart as never, AUTH, { project_id: PROJECT.id, level: "node", node_id: PART, branch_id: BRANCH });
  const payload = onPart.callsTo("rpc", "agent_checkout_claim")[0].payload as Record<string, unknown>;
  assertEquals([payload.p_box, payload.p_parts], [BOX, undefined]);
  assert(String((r.data as { message: string }).message).includes("a box's lease covers its parts"), JSON.stringify(r.data));
  assertEquals((r.data as { explodeSignal?: unknown }).explodeSignal, undefined, "an exploded family gets no explode signal");

  const onBox = new FakeSupabase();
  onBox.script("projects", "select", { data: PROJECT, error: null });
  onBox.script("rpc", "graph_reference_ids", { data: { nodes: [BOX, PART] }, error: null });
  onBox.script("graph_snapshots", "select", { data: GRAPH, error: null });
  onBox.script("node_roles", "select", { data: ROLES, error: null });
  onBox.script("rpc", "agent_checkout_claim", { data: { claimed: true, checkoutId: "c1", advisory: false }, error: null });
  await handleCheckoutTask(onBox as never, AUTH, { project_id: PROJECT.id, level: "node", node_id: BOX, branch_id: BRANCH });
  const boxPayload = onBox.callsTo("rpc", "agent_checkout_claim")[0].payload as Record<string, unknown>;
  assertEquals([boxPayload.p_box, boxPayload.p_parts], [undefined, [PART]]);
});

Deno.test("AA.3 a collision on a node whose files split carries the explode signal", async () => {
  const sb = new FakeSupabase();
  sb.script("projects", "select", { data: PROJECT, error: null });
  sb.script("rpc", "graph_reference_ids", { data: { nodes: [LONE] }, error: null });
  sb.script("graph_snapshots", "select", { data: GRAPH, error: null });
  sb.script("node_roles", "select", { data: ROLES, error: null });
  sb.script("rpc", "agent_checkout_claim", { data: { claimed: false, conflict: "work", heldBy: "agent-a", since: "t", heldReach: ["*"] }, error: null });
  sb.script("repo_index", "select", { data: ["src/cart/a.ts", "src/cart/b.ts", "src/search/x.ts", "src/search/y.ts"].map((path) => ({ path })), error: null });
  sb.script("repo_index_edges", "select", { data: [{ from_path: "src/cart/a.ts", to_path: "src/cart/b.ts" }, { from_path: "src/search/x.ts", to_path: "src/search/y.ts" }], error: null });
  const r = await handleCheckoutTask(sb as never, AUTH, { project_id: PROJECT.id, level: "node", node_id: LONE, branch_id: BRANCH });
  const data = r.data as { message: string; explodeSignal?: Array<{ size: number }> };
  assertEquals(data.explodeSignal?.map((g) => g.size), [2, 2]);
  assert(data.message.includes(`"Catalog API"'s files fall into 2 groups with no imports between them`), data.message);
  assert(data.message.startsWith("Work inside this node is held by agent-a"), "the refusal still leads");
});

Deno.test("AA.3 propose_patches: a part of a box someone else holds is locked", async () => {
  const sb = new FakeSupabase();
  sb.script("agent_checkouts", "select", {
    data: [{ id: "l1", level: "node", node_id: BOX, holder_label: "agent-b", holder_key_id: "kb", holder_delegate: "key:kb", since: "2026-09-23T10:00:00Z", heartbeat_at: fresh() }],
    error: null,
  });
  sb.script("graph_snapshots", "select", { data: GRAPH, error: null });
  sb.script("node_roles", "select", { data: ROLES.map(({ id, capability_tags }) => ({ id, capability_tags })), error: null });
  const refusal = await refuseLeasedNodeTargets(sb as never, AUTH, PROJECT.id, [
    { type: "update_node", payload: { id: PART, changes: { label: "Handlers" } } },
  ], BRANCH);
  assert(refusal !== null && refusal.includes(`changes node ${PART}, a part of node ${BOX}, which is leased by agent-b`), String(refusal));
  // A node outside the box is free.
  const free = new FakeSupabase();
  free.script("agent_checkouts", "select", { data: [{ id: "l1", level: "node", node_id: BOX, holder_label: "agent-b", holder_key_id: "kb", holder_delegate: "key:kb", since: "t", heartbeat_at: fresh() }], error: null });
  free.script("graph_snapshots", "select", { data: GRAPH, error: null });
  free.script("node_roles", "select", { data: [], error: null });
  assertEquals(await refuseLeasedNodeTargets(free as never, AUTH, PROJECT.id, [{ type: "update_node", payload: { id: LONE, changes: { label: "x" } } }], BRANCH), null);
});

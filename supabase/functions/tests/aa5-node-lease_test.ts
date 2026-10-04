// AA.5 (owner 2026-09-23): a lease is a lock; work inside a node runs in
// parallel. The reach (pure), the claim's node level and its reach, the
// refusals in words, the hand-off note, the heartbeat that extends or flags,
// the propose-time lock on a leased node, and the commit check against reach.
// The atomic comparison itself is the database's (lane 072).
import { leaseReach, reachOverlap, outsideReach, reachOf, normalizePath, criterionToken, taskToken, REACH_CAP, WHOLE_NODE } from "../_shared/lease-reach.ts";
import { handleCheckoutTask, handleReleaseCheckout, handleCheckoutHeartbeat, refusalMessage } from "../mcp-server/tools/checkouts.ts";
import { refuseLeasedNodeTargets } from "../mcp-server/tools/proposals.ts";
import { collisionsBetween } from "../_shared/lease-collisions.ts";
import { FakeSupabase, assert, assertEquals } from "./helpers.ts";

const PROJECT = { id: "11111111-1111-4111-8111-111111111111", name: "Bench" };
const BRANCH = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";
const TASK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHECKOUT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AUTH = { userId: "user-1", authMethod: "api_key", keyId: "k1", scopes: ["read", "write", "propose"] } as never;
const fresh = () => new Date().toISOString();

// ── the reach, pure ─────────────────────────────────────────────────────────

Deno.test("AA.5 reach: no files named is the whole node; named files add their imports inside the node and what the same tests verify", () => {
  const nodeFiles = ["src/cart.ts", "src/price.ts", "src/tax.ts", "src/receipt.ts", "src/util.ts"];
  assertEquals(leaseReach({ touches: [], nodeFiles, edges: [], testGroups: [] }), [WHOLE_NODE]);
  const reach = leaseReach({
    touches: ["./src/cart.ts"],
    nodeFiles,
    edges: [
      { from: "src/cart.ts", to: "src/price.ts" }, // cart imports price
      { from: "src/receipt.ts", to: "src/cart.ts" }, // receipt imports cart
      { from: "src/cart.ts", to: "lib/outside.ts" }, // outside the node: not reached
      { from: "src/price.ts", to: "src/tax.ts" }, // two hops: not reached
    ],
    testGroups: [["src/cart.ts", "src/util.ts"], ["src/tax.ts"]],
  });
  assertEquals(reach, ["src/cart.ts", "src/price.ts", "src/receipt.ts", "src/util.ts"]);
  assertEquals(normalizePath("/src\\a.ts"), "src/a.ts");
});

Deno.test("AA.5 reach: a greenfield task reaches the criteria it serves, else itself; past the cap it is the whole node", () => {
  const tokens = [criterionToken("REQ-001", "Totals include tax"), criterionToken("REQ-001", "  totals  include TAX ")];
  assertEquals(tokens[0], tokens[1], "the token survives case and spacing");
  assertEquals(leaseReach({ touches: [], nodeFiles: [], edges: [], testGroups: [], greenfield: [tokens[0]] }), [tokens[0]]);
  assertEquals(leaseReach({ touches: [], nodeFiles: [], edges: [], testGroups: [], greenfield: [taskToken("a3f19c02")] }), ["task:a3f19c02"]);
  assertEquals(leaseReach({ touches: [], nodeFiles: [], edges: [], testGroups: [] }), [WHOLE_NODE]);
  const many = Array.from({ length: REACH_CAP + 1 }, (_, i) => `f${i}.ts`);
  assertEquals(leaseReach({ touches: many, nodeFiles: many, edges: [], testGroups: [] }), [WHOLE_NODE]);
});

Deno.test("AA.5 overlap: the coupling token, '*' when either names no files; outside and legacy reaches", () => {
  assertEquals(reachOverlap(["a.ts", "b.ts"], ["c.ts"]), null);
  assertEquals(reachOverlap(["a.ts", "b.ts"], ["c.ts", "b.ts"]), "b.ts");
  assertEquals(reachOverlap([WHOLE_NODE], ["c.ts"]), WHOLE_NODE);
  assertEquals(outsideReach(["a.ts"], ["a.ts", "./b.ts"]), ["b.ts"]);
  assertEquals(outsideReach([WHOLE_NODE], ["b.ts"]), []);
  assertEquals(reachOf({}), [WHOLE_NODE], "a lease from before AA.5 reaches the whole node");
  assertEquals(reachOf({ reach: ["a.ts"] }), ["a.ts"]);
});

// ── the claim ───────────────────────────────────────────────────────────────

Deno.test("AA.5 claim: a node lease needs a node that exists on the branch, and locks it", async () => {
  const none = new FakeSupabase();
  none.script("projects", "select", { data: PROJECT, error: null });
  const missing = await handleCheckoutTask(none as never, AUTH, { project_id: PROJECT.id, level: "node" });
  assertEquals(missing.success, false);
  assert(String(missing.error).includes("needs node_id"), String(missing.error));

  const gone = new FakeSupabase();
  gone.script("projects", "select", { data: PROJECT, error: null });
  gone.script("rpc", "graph_reference_ids", { data: { nodes: ["99999999-9999-4999-8999-999999999999"] }, error: null });
  const g = await handleCheckoutTask(gone as never, AUTH, { project_id: PROJECT.id, level: "node", node_id: NODE, branch_id: BRANCH });
  assertEquals(g.success, false);
  assertEquals(gone.callsTo("rpc", "agent_checkout_claim").length, 0);

  const sb = new FakeSupabase();
  sb.script("projects", "select", { data: PROJECT, error: null });
  sb.script("rpc", "graph_reference_ids", { data: { nodes: [NODE] }, error: null });
  sb.script("rpc", "agent_checkout_claim", { data: { claimed: true, checkoutId: CHECKOUT, advisory: false }, error: null });
  const r = await handleCheckoutTask(sb as never, AUTH, { project_id: PROJECT.id, level: "node", node_id: NODE, branch_id: BRANCH, external_agent: "claude · lead" });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const params = sb.callsTo("rpc", "agent_checkout_claim")[0].payload as any;
  assertEquals([params.p_level, params.p_ref_id, params.p_node_id, params.p_reach], ["node", null, NODE, undefined]);
  assert(String((r.data as { message: string }).message).startsWith("Claimed: this node is locked for you."));
});

Deno.test("AA.5 claim: a task lease sends its node and its reach; the response says what it reaches and passes on the last hand-off", async () => {
  const sb = new FakeSupabase();
  sb.script("projects", "select", { data: PROJECT, error: null });
  sb.script("task_items", "select", { data: { node_id: NODE, task_key: "a3f19c02" }, error: null });
  sb.script("artifacts", "select", { data: [
    { id: "art-cart", path: "src/cart.ts", kind: "source" },
    { id: "art-price", path: "src/price.ts", kind: "source" },
    { id: "art-doc", path: ".nodespec/tasks/cart.task.md", kind: "task" },
  ], error: null });
  sb.script("repo_index", "select", { data: [{ path: "src/tax.ts" }], error: null });
  sb.script("repo_index_edges", "select", { data: [{ from_path: "src/cart.ts", to_path: "src/price.ts" }], error: null });
  sb.script("repo_index_edges", "select", { data: [], error: null });
  sb.script("test_cases", "select", { data: [], error: null });
  sb.script("rpc", "agent_checkout_claim", { data: { claimed: true, checkoutId: CHECKOUT, advisory: false }, error: null });
  sb.script("agent_checkouts", "select", { data: { holder_label: "codex · earlier", released_at: "2026-09-23T10:00:00Z", meta: { handoff: { note: "Totals work; tax rounding is next." } } }, error: null });
  const r = await handleCheckoutTask(sb as never, AUTH, { project_id: PROJECT.id, task_item_id: TASK, branch_id: BRANCH, touches: ["src/cart.ts"] });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const params = sb.callsTo("rpc", "agent_checkout_claim")[0].payload as any;
  assertEquals(params.p_node_id, NODE);
  assertEquals(params.p_reach, ["src/cart.ts", "src/price.ts"]);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.reach, ["src/cart.ts", "src/price.ts"]);
  assertEquals(data.handoff, { note: "Totals work; tax rounding is next.", from: "codex · earlier", at: "2026-09-23T10:00:00Z" });
  assert(String(data.message).includes("Your reach is 2 files"), data.message);
});

Deno.test("AA.5 claim: with no files named the task reaches the whole node, and the response says why to name them", async () => {
  const sb = new FakeSupabase();
  sb.script("projects", "select", { data: PROJECT, error: null });
  sb.script("task_items", "select", { data: { node_id: NODE, task_key: "a3f19c02" }, error: null });
  sb.script("artifacts", "select", { data: [{ id: "art-cart", path: "src/cart.ts", kind: "source" }], error: null });
  sb.script("rpc", "agent_checkout_claim", { data: { claimed: true, checkoutId: CHECKOUT, advisory: false }, error: null });
  const r = await handleCheckoutTask(sb as never, AUTH, { project_id: PROJECT.id, task_item_id: TASK, branch_id: BRANCH });
  // deno-lint-ignore no-explicit-any
  assertEquals((sb.callsTo("rpc", "agent_checkout_claim")[0].payload as any).p_reach, [WHOLE_NODE]);
  assert(String((r.data as { message: string }).message).includes("No files were named, so this lease reaches the whole node"));
});

Deno.test("AA.5 refusals say who holds what and what couples you", () => {
  const base = { claimed: false, heldBy: "codex · other", since: "2026-09-23T09:00:00Z" };
  assert(refusalMessage({ ...base, conflict: "node" }, "task").startsWith("The node is leased by codex · other (since 2026-09-23T09:00:00Z): its structure is locked"));
  assert(refusalMessage({ ...base, conflict: "work", heldReach: ["src/cart.ts"] }, "node").includes("on src/cart.ts. A node lease waits for the work inside the node to end."));
  assertEquals(refusalMessage({ ...base, conflict: "reach", heldReach: ["src/cart.ts", "src/price.ts"], coupling: "src/price.ts" }, "task"),
    "codex · other (since 2026-09-23T09:00:00Z) holds src/cart.ts, src/price.ts; your reach meets it at src/price.ts. Narrow your touches away from it, wait for that lease, or coordinate with the holder.");
  assert(refusalMessage({ ...base, conflict: "reach", heldReach: [WHOLE_NODE], coupling: WHOLE_NODE }, "task").includes("the whole node (no files named)"));
});

// ── release and heartbeat ───────────────────────────────────────────────────

const MINE = { id: CHECKOUT, level: "task", holder_label: "claude · bench", holder_key_id: "k1", holder_delegate: "key:k1", node_id: NODE, meta: { reach: ["src/cart.ts"] } };

Deno.test("AA.5 release: your own hand-off needs a note, recorded on the lease for the next claim", async () => {
  const bare = new FakeSupabase();
  bare.script("projects", "select", { data: PROJECT, error: null });
  bare.script("agent_checkouts", "select", { data: MINE, error: null });
  const r = await handleReleaseCheckout(bare as never, AUTH, { project_id: PROJECT.id, checkout_id: CHECKOUT });
  assertEquals(r.success, false);
  assertEquals(bare.callsTo("agent_checkouts", "update").length, 0);

  const sb = new FakeSupabase();
  sb.script("projects", "select", { data: PROJECT, error: null });
  sb.script("agent_checkouts", "select", { data: MINE, error: null });
  sb.script("agent_checkouts", "update", { data: { id: CHECKOUT }, error: null });
  const ok = await handleReleaseCheckout(sb as never, AUTH, { project_id: PROJECT.id, checkout_id: CHECKOUT, note: "Cart totals done; receipts next." });
  assertEquals(ok.success, true, JSON.stringify(ok));
  const written = sb.callsTo("agent_checkouts", "update")[0].payload as { meta: { handoff: { note: string }; reach: string[] } };
  assertEquals(written.meta.handoff.note, "Cart totals done; receipts next.");
  assertEquals(written.meta.reach, ["src/cart.ts"], "the rest of the lease's meta stays");

  // evidence ends it without a note
  const v = new FakeSupabase();
  v.script("projects", "select", { data: PROJECT, error: null });
  v.script("agent_checkouts", "select", { data: MINE, error: null });
  v.script("agent_checkouts", "update", { data: { id: CHECKOUT }, error: null });
  assertEquals((await handleReleaseCheckout(v as never, AUTH, { project_id: PROJECT.id, checkout_id: CHECKOUT, reason: "verified" })).success, true);
});

Deno.test("AA.5 heartbeat: a touched file outside the reach extends it when free and is flagged when someone's work reaches it", async () => {
  const sb = new FakeSupabase();
  sb.script("projects", "select", { data: PROJECT, error: null });
  sb.script("agent_checkouts", "select", { data: MINE, error: null });
  sb.script("agent_checkouts", "select", { data: [
    { ...MINE },
    { id: "other", level: "task", holder_label: "codex · other", holder_key_id: "k2", holder_delegate: "key:k2", heartbeat_at: fresh(), meta: { reach: ["src/receipt.ts"] } },
  ], error: null });
  sb.script("agent_checkouts", "update", { data: { id: CHECKOUT, heartbeat_at: fresh() }, error: null });
  const r = await handleCheckoutHeartbeat(sb as never, AUTH, { project_id: PROJECT.id, checkout_id: CHECKOUT, meta: { touches: ["src/cart.ts", "src/util.ts", "src/receipt.ts"] } });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.reachExtended, ["src/util.ts"]);
  assertEquals(data.outsideScope, [{ path: "src/receipt.ts", heldBy: "codex · other" }]);
  assert(String(data.warning).includes("src/receipt.ts (held by codex · other)"));
  const written = sb.callsTo("agent_checkouts", "update")[0].payload as { meta: { reach: string[]; touches: string[] } };
  assertEquals(written.meta.reach, ["src/cart.ts", "src/util.ts"]);
  assertEquals(written.meta.touches.length, 3, "the touches merge as display state too");
});

// ── the lock where a change is filed ────────────────────────────────────────

Deno.test("AA.5 propose: a graph change to a node someone else holds is refused whole; your own lease, a stale one and spec ops pass", async () => {
  const others = [
    { id: "l1", level: "node", node_id: NODE, holder_label: "codex · lead", holder_key_id: "k2", holder_delegate: "key:k2", since: "2026-09-23T09:00:00Z", heartbeat_at: fresh() },
  ];
  const sb = new FakeSupabase();
  sb.script("agent_checkouts", "select", { data: others, error: null });
  sb.script("artifacts", "select", { data: [{ id: "44444444-4444-4444-8444-444444444444", node_id: NODE }], error: null });
  const refusal = await refuseLeasedNodeTargets(sb as never, AUTH, PROJECT.id, [
    { type: "create_requirement", payload: { name: "x", description: "y" } },
    { type: "update_node", payload: { id: NODE, changes: { technology: "fastify" } } },
    { type: "update_artifact", payload: { id: "44444444-4444-4444-8444-444444444444", changes: { content: "..." } } },
  ]);
  assert(refusal !== null && refusal.startsWith(`Leased node: patch[1] update_node changes node ${NODE}, leased by codex · lead since 2026-09-23T09:00:00Z; patch[2] update_artifact`), String(refusal));
  assert(refusal!.endsWith("Nothing was created."));

  const mine = new FakeSupabase();
  mine.script("agent_checkouts", "select", { data: [{ ...others[0], holder_key_id: "k1", holder_delegate: "key:k1" }], error: null });
  assertEquals(await refuseLeasedNodeTargets(mine as never, AUTH, PROJECT.id, [{ type: "update_node", payload: { id: NODE, changes: {} } }]), null);

  const stale = new FakeSupabase();
  stale.script("agent_checkouts", "select", { data: [{ ...others[0], heartbeat_at: "2026-09-23T00:00:00Z" }], error: null });
  assertEquals(await refuseLeasedNodeTargets(stale as never, AUTH, PROJECT.id, [{ type: "update_node", payload: { id: NODE, changes: {} } }]), null);

  const specOnly = new FakeSupabase();
  assertEquals(await refuseLeasedNodeTargets(specOnly as never, AUTH, PROJECT.id, [{ type: "create_requirement", payload: {} }]), null);
  assertEquals(specOnly.calls.length, 0, "no graph change, no read");

  // an edge to the node is its structure too
  const edge = new FakeSupabase();
  edge.script("agent_checkouts", "select", { data: others, error: null });
  const e = await refuseLeasedNodeTargets(edge as never, AUTH, PROJECT.id, [{ type: "add_edge", payload: { id: "e1", source: "55555555-5555-4555-8555-555555555555", target: NODE, contractId: "c1" } }]);
  assert(e !== null && e.includes("patch[0] add_edge"), String(e));
});

// ── the commit check reads the reach ────────────────────────────────────────

Deno.test("AA.5 collisions: a work lease is matched against its reach; a node lease holds every file bound to its node", () => {
  const change = { changeEventId: "e1", commitSha: "abc1234", author: "dev", changedFiles: ["src/price.ts", "src/receipt.ts"] };
  const tasks = [{ id: "t1", node_id: NODE, display_id: "T1", title: "Price the cart" }];
  const artifacts = [
    { id: "a1", node_id: NODE, path: "src/cart.ts" },
    { id: "a2", node_id: NODE, path: "src/receipt.ts" },
    { id: "a3", node_id: "other-node", path: "src/other.ts" },
  ];
  const out = collisionsBetween([change], [
    { id: "reach", level: "task", holder_label: "a", task_item_id: "t1", artifact_id: null, meta: { reach: ["src/cart.ts", "src/price.ts"] } },
    { id: "whole", level: "task", holder_label: "b", task_item_id: "t1", artifact_id: null, meta: { reach: ["*"] } },
    { id: "node", level: "node", holder_label: "c", task_item_id: null, artifact_id: null, node_id: NODE },
  ], tasks, artifacts);
  assertEquals(out.map((c) => [c.checkoutId, c.paths]), [
    ["reach", ["src/price.ts"]],
    ["whole", ["src/receipt.ts"]],
    ["node", ["src/receipt.ts"]],
  ]);
});

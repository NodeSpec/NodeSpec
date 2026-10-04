// AA.3 (owner 2026-09-23): explode a node one level, and collapse it back.
//
// The agent names the parts (label, role, files, why); the server checks
// the proposal and compiles it: parts as children, files to their part, the
// repo index following on accept, one edge and contract per pair of parts
// whose files import each other, outside edges on the node unless a part
// takes one. collapse_node is the exact inverse. propose_patches needs the
// caller to hold the node's lease, records the repo index moves on the
// proposal, and returns the suggestions.
import { compileCollapse, compileExplode, type ExplodeContext } from "../_shared/explode.ts";
import { generateTaskDocument, computeTaskContextFingerprint } from "../_shared/task-document-generator.ts";
import { handleProposePatches } from "../mcp-server/tools/proposals.ts";
import { FakeSupabase, assert, assertEquals, completeRole } from "./helpers.ts";

const NODE = "10000000-0000-4000-8000-000000000001";
const WEB = "10000000-0000-4000-8000-000000000002";
const DB = "10000000-0000-4000-8000-000000000003";
const E_IN = "20000000-0000-4000-8000-000000000001";
const E_OUT = "20000000-0000-4000-8000-000000000002";
const A_ROUTES = "30000000-0000-4000-8000-000000000001";
const A_REPO = "30000000-0000-4000-8000-000000000002";
const A_DOC = "30000000-0000-4000-8000-000000000003";
const PROJECT = "40000000-0000-4000-8000-000000000001";
const BRANCH = "40000000-0000-4000-8000-000000000002";

function ids() { let n = 0; return () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`; }

const PARTS: Record<string, string[]> = {
  "backend-service": ["part-handler", "part-worker", "part-repository", "part-module"],
  "database": ["part-table-group"],
};

function context(): ExplodeContext {
  return {
    nodes: {
      [NODE]: { id: NODE, type: "backend-service", label: "Checkout API", technology: "node" },
      [WEB]: { id: WEB, type: "frontend-app", label: "Web" },
      [DB]: { id: DB, type: "database", label: "Orders DB" },
    },
    edges: {
      [E_IN]: { id: E_IN, source: WEB, target: NODE, contractId: "c-in" },
      [E_OUT]: { id: E_OUT, source: NODE, target: DB, contractId: "c-out" },
    },
    artifacts: {
      [A_ROUTES]: { id: A_ROUTES, nodeId: NODE, path: "src/routes/orders.ts", kind: "source" },
      [A_REPO]: { id: A_REPO, nodeId: NODE, path: "src/db/orders.ts", kind: "source" },
      [A_DOC]: { id: A_DOC, nodeId: NODE, path: "docs/tasks/checkout-api.md", kind: "task" },
    },
    indexed: [
      { path: "src/routes/orders.ts", nodeId: NODE },
      { path: "src/routes/carts.ts", nodeId: NODE },
      { path: "src/db/orders.ts", nodeId: NODE },
      { path: "src/util.ts", nodeId: NODE },
    ],
    imports: [
      { from: "src/routes/orders.ts", to: "src/db/orders.ts" },
      { from: "src/routes/carts.ts", to: "src/db/orders.ts" },
      { from: "src/routes/orders.ts", to: "src/util.ts" },
    ],
    proofs: [
      { requirement: 'REQ-001 "Place an order"', nodeId: NODE, paths: ["src/routes/orders.ts", "src/routes/carts.ts"] },
      { requirement: 'REQ-002 "Totals"', nodeId: NODE, paths: ["src/routes/orders.ts", "src/db/orders.ts"] },
    ],
    partsOf: (r) => PARTS[r] ?? [],
    isPart: (r) => r.startsWith("part-"),
  };
}

const INTENT = {
  nodeId: NODE,
  parts: [
    { label: "Routes", role: "part-handler", files: ["src/routes/orders.ts", "src/routes/carts.ts"], why: "the order and cart routes", takes: [E_IN] },
    { label: "Data access", role: "part-repository", files: ["src/db/orders.ts"], why: "the order queries", takes: [{ edgeId: E_OUT }] },
  ],
};

Deno.test("explode_node: parts as children, files to their part, one edge per importing pair, outside edges taken", () => {
  const c = compileExplode(INTENT, context(), ids());
  assert(!("error" in c), JSON.stringify(c));
  const [routes, data, contract, edge] = ["aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "aaaaaaaa-aaaa-4aaa-8aaa-000000000002", "aaaaaaaa-aaaa-4aaa-8aaa-000000000003", "aaaaaaaa-aaaa-4aaa-8aaa-000000000004"];
  assertEquals(c.patches.map((p) => p.type), ["add_node", "update_artifact", "update_edge", "add_node", "update_artifact", "update_edge", "add_contract", "add_edge"]);
  assertEquals(c.patches[0].payload, { id: routes, type: "part-handler", label: "Routes", parentId: NODE, metadata: { description: "the order and cart routes" } });
  assertEquals(c.patches[1].payload, { id: A_ROUTES, changes: { nodeId: routes } });
  assertEquals(c.patches[2].payload, { id: E_IN, changes: { target: routes } }, "the end on the node moves; the edge keeps its id and contract");
  assertEquals(c.patches[5].payload, { id: E_OUT, changes: { source: data } });
  assertEquals(c.patches[6].payload, { id: contract, kind: "dependency", name: "Routes uses Data access" });
  const e = c.patches[7].payload as Record<string, unknown>;
  assertEquals([e.id, e.source, e.target, e.contractId, e.label], [edge, routes, data, contract, "imports"]);
  assertEquals((e.metadata as { imports: number }).imports, 2, "two imports cross, one edge");
  // The task document is NodeSpec's own: it stays with the node.
  assert(!c.patches.some((p) => (p.payload as { id?: string }).id === A_DOC), "the node's task doc does not move");
  // Files bound only through the repo index follow on accept.
  assertEquals(c.repoIndexMoves, [
    { path: "src/routes/orders.ts", from: NODE, to: routes },
    { path: "src/routes/carts.ts", from: NODE, to: routes },
    { path: "src/db/orders.ts", from: NODE, to: data },
  ]);
  assertEquals(c.ids, { nodeId: NODE, partIds: [routes, data], edgeIds: [edge], contractIds: [contract] });
  assertEquals(c.summary, 'explode "Checkout API" into "Routes", "Data access"');
  // util.ts stays on the node, and REQ-001's proof all sits in Routes.
  assertEquals(c.suggestions[0], '1 of "Checkout API"\'s 4 files stay on the node itself.');
  assert(c.suggestions[1].startsWith('REQ-001 "Place an order" is proven only by files in "Routes".'), c.suggestions[1]);
  assertEquals(c.suggestions.length, 2, "REQ-002 spans two parts, so its mapping stays without a suggestion");
});

Deno.test("explode_node: the server checks the proposal the agent made", () => {
  const ctx = context();
  const refuse = (intent: Record<string, unknown>, c: ExplodeContext = ctx) => {
    const r = compileExplode(intent, c, ids());
    assert("error" in r, `expected a refusal for ${JSON.stringify(intent)}`);
    return r.error;
  };
  const part = (over: Record<string, unknown>) => ({ nodeId: NODE, parts: [{ label: "Routes", role: "part-handler", files: ["src/routes/orders.ts"], why: "routes", ...over }] });

  assert(refuse(part({ role: "part-table-group" })).includes("which a backend-service does not list. Its parts are part-handler, part-worker, part-repository, part-module"), "a role the depth rule refuses");
  assert(refuse(part({ why: undefined })).includes(".why is required"), "why is required");
  assert(refuse(part({ files: ["src/other.ts"] })).includes('"src/other.ts" is not one of "Checkout API"\'s files'), "a file that is not the node's");
  assert(refuse(part({ files: ["docs/tasks/checkout-api.md"] })).includes("is not one of"), "the node's task doc is not a file a part can take");
  assert(refuse(part({ files: [] })).includes("owns none of"), "no part without files when the node has files");
  assert(refuse({ nodeId: NODE, parts: [
    { label: "A", role: "part-handler", files: ["src/util.ts"], why: "a" },
    { label: "B", role: "part-module", files: ["src/util.ts"], why: "b" },
  ] }).includes("a file belongs to one part"), "a file named twice");
  assert(refuse({ nodeId: NODE, parts: [
    { label: "A", role: "part-handler", files: ["src/util.ts"], why: "a" },
    { label: "a", role: "part-module", files: ["src/db/orders.ts"], why: "b" },
  ] }).includes("two parts are labelled"), "labels are unique");
  assert(refuse(part({ takes: ["20000000-0000-4000-8000-00000000dead"] })).includes("names no edge"), "an edge that does not exist");
  assert(refuse({ nodeId: WEB, parts: [{ label: "Page", role: "part-page", why: "p" }] }).includes("that role lists no parts"), "a role with no parts cannot be exploded");

  // Already exploded: collapse first.
  const exploded = context();
  exploded.nodes["p1"] = { id: "p1", type: "part-handler", label: "Routes", parentId: NODE };
  assert(refuse(part({}), exploded).includes("already has 1 part"), "already exploded");
  const partNode = context();
  const PART = "10000000-0000-4000-8000-0000000000a1";
  partNode.nodes[PART] = { id: PART, type: "part-handler", label: "Routes", parentId: NODE };
  assert(refuse({ nodeId: PART, parts: [{ label: "x", role: "part-module", why: "x" }] }, partNode).includes("is itself a part"), "a part holds nothing");
  // A greenfield node (no files) explodes into parts that name none.
  const green = context();
  green.artifacts = {}; green.indexed = [];
  const g = compileExplode({ nodeId: NODE, parts: [{ label: "Routes", role: "part-handler", why: "the routes it will have" }] }, green, ids());
  assert(!("error" in g) && g.patches.length === 1 && g.repoIndexMoves.length === 0, JSON.stringify(g));
});

Deno.test("collapse_node: the exact inverse of the explode", () => {
  const exploded = context();
  const R = "50000000-0000-4000-8000-000000000001";
  const D = "50000000-0000-4000-8000-000000000002";
  const INNER = "50000000-0000-4000-8000-000000000003";
  exploded.nodes[R] = { id: R, type: "part-handler", label: "Routes", parentId: NODE };
  exploded.nodes[D] = { id: D, type: "part-repository", label: "Data access", parentId: NODE };
  exploded.artifacts[A_ROUTES].nodeId = R;
  exploded.artifacts[A_REPO].nodeId = D;
  exploded.edges[E_IN].target = R;
  exploded.edges[E_OUT].source = D;
  exploded.edges[INNER] = { id: INNER, source: R, target: D, contractId: "c-inner" };
  exploded.indexed = [
    { path: "src/routes/orders.ts", nodeId: R }, { path: "src/routes/carts.ts", nodeId: R },
    { path: "src/db/orders.ts", nodeId: D }, { path: "src/util.ts", nodeId: NODE },
  ];
  exploded.proofs = [{ requirement: 'REQ-001 "Place an order"', nodeId: R, paths: [] }];

  const c = compileCollapse({ nodeId: NODE }, exploded);
  assert(!("error" in c), JSON.stringify(c));
  assertEquals(c.patches.map((p) => p.type), ["update_artifact", "update_artifact", "update_edge", "update_edge", "remove_edge", "remove_node", "remove_node"]);
  assertEquals(c.patches[0].payload, { id: A_ROUTES, changes: { nodeId: NODE } });
  assertEquals(c.patches[2].payload, { id: E_IN, changes: { target: NODE } });
  assertEquals(c.patches[3].payload, { id: E_OUT, changes: { source: NODE } });
  assertEquals(c.patches[4].payload, { id: INNER }, "the edge between parts goes (its contract with it, by the engine's GC)");
  assertEquals(c.repoIndexMoves, [
    { path: "src/routes/orders.ts", from: R, to: NODE }, { path: "src/routes/carts.ts", from: R, to: NODE },
    { path: "src/db/orders.ts", from: D, to: NODE },
  ]);
  assert(c.suggestions[0].startsWith('REQ-001 "Place an order" is mapped to the part "Routes".'), c.suggestions[0]);
  const none = compileCollapse({ nodeId: NODE }, context());
  assert("error" in none && none.error.includes("has no parts"), JSON.stringify(none));
});

Deno.test("the exploded node's task document is its integration document, and the parts stale it", () => {
  const catalogs = {
    nodeRoles: {
      "backend-service": { id: "backend-service", label: "Backend Service", nature: "build", is_container: false, can_contain: PARTS["backend-service"], capability_tags: [] },
      "part-handler": { id: "part-handler", label: "Handler", nature: "build", is_container: false, can_contain: [], capability_tags: ["part"] },
      "part-repository": { id: "part-repository", label: "Repository", nature: "build", is_container: false, can_contain: [], capability_tags: ["part"] },
    },
    technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {}, catalogIssues: [],
  };
  const R = "50000000-0000-4000-8000-000000000001";
  const D = "50000000-0000-4000-8000-000000000002";
  const node = { id: NODE, type: "backend-service", label: "Checkout API" };
  const before = { nodes: { [NODE]: node }, edges: {}, contracts: {}, artifacts: {} };
  const after = {
    nodes: {
      [NODE]: node,
      [R]: { id: R, type: "part-handler", label: "Routes", parentId: NODE, metadata: { description: "the order routes" } },
      [D]: { id: D, type: "part-repository", label: "Data access", parentId: NODE },
    },
    edges: { e1: { id: "e1", source: R, target: D, contractId: "c1", label: "imports" } },
    contracts: { c1: { id: "c1", kind: "dependency", name: "Routes uses Data access" } },
    artifacts: { [A_ROUTES]: { id: A_ROUTES, nodeId: R, path: "src/routes/orders.ts", kind: "source" } },
  };
  // deno-lint-ignore no-explicit-any
  const doc = generateTaskDocument({ node, graph: after, catalogs, requirements: [] } as any);
  assert(doc.includes("## Parts"), "a Parts section");
  assert(doc.includes("This node is exploded into 2 parts."), doc.slice(doc.indexOf("## Parts"), doc.indexOf("## Parts") + 300));
  assert(doc.includes("- **Routes** (Handler): the order routes (1 file)"), "each part with its role, why and files");
  assert(doc.includes("- Routes uses Data access (imports)"), "the edges between the parts");
  assert(!doc.includes("**Contains:**"), "parts are not listed twice");
  // deno-lint-ignore no-explicit-any
  const fp = (g: any) => computeTaskContextFingerprint(node as any, g, [], "", catalogs as any).fingerprint;
  assert(fp(before) !== fp(after), "exploding the node stales its task document");
  // deno-lint-ignore no-explicit-any
  const unexploded = computeTaskContextFingerprint(node as any, before as any, [], "", catalogs as any).fields as Record<string, unknown>;
  assert(!("partsSignature" in unexploded), "a node never exploded keeps its fingerprint fields");
});

// ── propose_patches end to end ───────────────────────────────────────────────

function roleRow(id: string, extra: Record<string, unknown> = {}) {
  return completeRole({ id, nature: "build", interface_kind: "service", is_container: false, container_layer: null, container_style: null, can_contain: [], metadata_schema: {}, suggested_contracts: [], sort_order: 1, capability_tags: [], default_technology: null, ...extra });
}

function scriptPropose(sb: FakeSupabase, leases: unknown[]) {
  const ctx = context();
  const graph = { nodes: ctx.nodes, edges: Object.fromEntries(Object.values(ctx.edges).map((e) => [e.id, e])), artifacts: ctx.artifacts, contracts: {} };
  sb.script("projects", "select", { data: { id: PROJECT, name: "Shop" }, error: null });
  sb.script("node_roles", "select", {
    data: [
      roleRow("backend-service", { can_contain: PARTS["backend-service"] }),
      roleRow("frontend-app"), roleRow("database", { palette_category: "Database", interface_kind: "data", can_contain: ["part-table-group"] }),
      ...["part-handler", "part-worker", "part-repository", "part-module"].map((id) => roleRow(id, { palette_category: "Logical", capability_tags: ["part"] })),
      roleRow("part-table-group", { palette_category: "Database", interface_kind: "data", capability_tags: ["part"] }),
    ],
    error: null,
  });
  for (const t of ["technology_catalog", "deployment_targets", "cloud_provider_patterns", "scope_archetypes"]) sb.script(t, "select", { data: [], error: null });
  sb.script("graph_snapshots", "select", { data: { graph_data: graph }, error: null });
  sb.script("repo_index", "select", { data: ctx.indexed.map((r) => ({ path: r.path, node_id: r.nodeId })), error: null });
  sb.script("repo_index_edges", "select", { data: ctx.imports.map((i) => ({ from_path: i.from, to_path: i.to })), error: null });
  sb.script("specification_mappings", "select", { data: [], error: null });
  sb.script("agent_checkouts", "select", { data: leases, error: null });
  sb.script("branches", "select", { data: { id: BRANCH }, error: null });
  sb.script("rpc", "graph_reference_ids", { data: { found: true, nodes: [NODE, WEB, DB], contracts: ["c-in", "c-out"] }, error: null });
  sb.script("agent_checkouts", "select", { data: leases, error: null });
  sb.script("graph_snapshots", "select", { data: { graph_data: graph }, error: null });
}

const AUTH = { userId: "user-1", scopes: ["read", "propose", "write"], authMethod: "api_key", keyId: "key-1" };
const MY_LEASE = { id: "l1", level: "node", node_id: NODE, holder_label: "claude", holder_key_id: "key-1", holder_delegate: "key:key-1", since: new Date().toISOString(), heartbeat_at: new Date().toISOString() };

Deno.test("propose_patches: explode_node needs the node's lease", async () => {
  const sb = new FakeSupabase();
  scriptPropose(sb, []);
  const r = await handleProposePatches(sb as never, AUTH as never, { project_id: PROJECT, branch_id: BRANCH, intents: [{ kind: "explode_node", ...INTENT }] });
  assertEquals(r.success, false);
  assert((r.error ?? "").includes(`claim it with checkout_task (level "node", node_id "${NODE}")`), r.error ?? "");
  assertEquals(sb.callsTo("ai_proposals", "insert").length, 0);
});

Deno.test("propose_patches: an explode files one proposal with the repo index moves and returns the suggestions", async () => {
  const sb = new FakeSupabase();
  scriptPropose(sb, [MY_LEASE]);
  const r = await handleProposePatches(sb as never, AUTH as never, { project_id: PROJECT, branch_id: BRANCH, intents: [{ kind: "explode_node", ...INTENT }] });
  assert(r.success, r.error ?? "");
  const insert = sb.callsTo("ai_proposals", "insert")[0].payload as { patches: Array<{ patch: { type: string; payload: { parentId?: string; type?: string } } }>; metadata: { repoIndexMoves: Array<{ path: string }>; intents: Array<{ kind: string }> } };
  assertEquals(insert.metadata.intents[0].kind, "explode_node");
  assertEquals(insert.metadata.repoIndexMoves.map((m) => m.path), ["src/routes/orders.ts", "src/routes/carts.ts", "src/db/orders.ts"]);
  const parts = insert.patches.filter((e) => e.patch.type === "add_node").map((e) => e.patch.payload);
  assertEquals(parts.map((p) => [p.type, p.parentId]), [["part-handler", NODE], ["part-repository", NODE]], "the depth rule let the parts in");
  assertEquals((r.data as { suggestions?: string[] }).suggestions, ['1 of "Checkout API"\'s 4 files stay on the node itself.']);
});

// ── AA.3b: a database explodes into groups ───────────────────────────────────

const PG = "60000000-0000-4000-8000-000000000001";
const API = "60000000-0000-4000-8000-000000000002";
const E_API_PG = "60000000-0000-4000-8000-000000000003";

function database(model: string | null = "relational"): ExplodeContext {
  return {
    nodes: {
      [PG]: { id: PG, type: "database", label: "Supabase Postgres", technology: "supabase-db" },
      [API]: { id: API, type: "backend-service", label: "Checkout API" },
    },
    edges: { [E_API_PG]: { id: E_API_PG, source: API, target: PG, contractId: "c-sql", metadata: { evidence: "orm" } } },
    artifacts: {},
    indexed: [
      { path: "supabase/migrations/0003_books.sql", nodeId: PG },
      { path: "supabase/migrations/0002_profiles.sql", nodeId: PG },
      { path: "supabase/migrations/0001_auth.sql", nodeId: PG },
    ],
    imports: [{ from: "supabase/migrations/0003_books.sql", to: "supabase/migrations/0001_auth.sql" }],
    proofs: [],
    partsOf: (r) => PARTS[r] ?? [],
    isPart: (r) => r.startsWith("part-"),
    isDataPart: (r) => r === "part-table-group",
    dataModelOf: (t) => (t === "supabase-db" ? model : null),
  };
}

const DB_INTENT = {
  nodeId: PG,
  parts: [
    {
      label: "public", role: "part-table-group", why: "the app's own tables",
      files: ["supabase/migrations/0003_books.sql", "supabase/migrations/0002_profiles.sql"],
      tables: [
        { name: "books", columns: 12, file: "supabase/migrations/0003_books.sql" },
        { name: "profiles", columns: 8, file: "supabase/migrations/0002_profiles.sql" },
      ],
      references: [{ part: "auth", via: "foreign_key", note: "profiles.id references auth.users.id" }],
      takes: [{ edgeId: E_API_PG, access: "both" }],
    },
    {
      label: "auth", role: "part-table-group", why: "managed by Supabase Auth",
      files: ["supabase/migrations/0001_auth.sql"],
      tables: [{ name: "users", columns: 34, note: "managed by Supabase Auth" }],
    },
  ],
};

Deno.test("AA.3b explode a database: groups list their tables, a service edge says how it uses its group, a foreign key joins two groups", () => {
  const c = compileExplode(DB_INTENT, database(), ids());
  assert(!("error" in c), JSON.stringify(c));
  const pub = c.patches.find((p) => p.type === "add_node" && p.payload.label === "public")!.payload as { id: string; metadata: { tables: unknown[] } };
  assertEquals(pub.metadata.tables, [
    { name: "books", columns: 12, file: "supabase/migrations/0003_books.sql" },
    { name: "profiles", columns: 8, file: "supabase/migrations/0002_profiles.sql" },
  ]);
  const take = c.patches.find((p) => p.type === "update_edge")!.payload as { changes: { target: string; metadata: Record<string, unknown> } };
  assertEquals(take.changes.target, pub.id);
  assertEquals(take.changes.metadata, { evidence: "orm", access: "both" }, "the edge keeps its metadata and gains its access");
  // No edge from the file import between the two groups: the reference the agent named is the edge.
  const edges = c.patches.filter((p) => p.type === "add_edge").map((p) => p.payload as Record<string, unknown>);
  assertEquals(edges.length, 1);
  assertEquals([edges[0].label, (edges[0].metadata as Record<string, unknown>).reference, (edges[0].metadata as Record<string, unknown>).note], ["foreign key", "foreign_key", "profiles.id references auth.users.id"]);
  const contract = c.patches.find((p) => p.type === "add_contract")!.payload as { kind: string; name: string };
  assertEquals([contract.kind, contract.name], ["sql", "public references auth"], "a relational store's references are sql");
  // A document store's reference kept in code is nosql.
  const doc = compileExplode({ ...DB_INTENT, parts: [{ ...DB_INTENT.parts[0], references: [{ part: "auth", via: "code" }] }, DB_INTENT.parts[1]] }, database("document"), ids());
  assert(!("error" in doc));
  assertEquals((doc.patches.find((p) => p.type === "add_contract")!.payload as { kind: string }).kind, "nosql");
  assertEquals((doc.patches.find((p) => p.type === "add_edge")!.payload as { label: string }).label, "reference kept in code");
});

Deno.test("AA.3b the server checks what a group lists and names", () => {
  const refuse = (intent: Record<string, unknown>) => {
    const r = compileExplode(intent, database(), ids());
    assert("error" in r, `expected a refusal for ${JSON.stringify(intent).slice(0, 120)}`);
    return r.error;
  };
  const group = (over: Record<string, unknown>) => ({ nodeId: PG, parts: [{ ...DB_INTENT.parts[0], references: [], ...over }, DB_INTENT.parts[1]] });
  // Item 25: a table names the file that defines it wherever it lives in the project; only an unknown path is refused.
  assert(refuse(group({ tables: [{ name: "books", file: "supabase/migrations/0009_nowhere.sql" }] })).includes("is no file of this project"), "a table's file is one the project knows");
  assert(refuse(group({ tables: [{ columns: 3 }] })).includes(".name is required"), "a table has a name");
  assert(refuse(group({ tables: [{ name: "books", columns: -1 }] })).includes("whole number"), "columns is a count");
  assert(refuse(group({ references: [{ part: "nowhere", via: "foreign_key" }] })).includes('references "nowhere", which is not another group'), "a reference names another group");
  assert(refuse(group({ references: [{ part: "auth", via: "join" }] })).includes("via must be foreign_key or code"), "a reference is a foreign key or kept in code");
  assert(refuse(group({ takes: [{ edgeId: E_API_PG, access: "sometimes" }] })).includes("access must be read, write or both"), "access is read, write or both");
  const handler = compileExplode({ nodeId: NODE, parts: [{ label: "Routes", role: "part-handler", files: ["src/routes/orders.ts"], why: "routes", tables: [{ name: "x" }] }] }, context(), ids());
  assert("error" in handler && handler.error.includes("only a group of a data store lists tables"), JSON.stringify(handler));
});

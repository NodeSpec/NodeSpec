// N8.1b (owner-corrected 2026-07-26): configuration is a per-node CHOICE and the node
// CARRIES its service's API reference.
//  - metadata.configSource 'ai' = explicit delegation → the packet SAYS so (never the
//    "no configuration recorded" placeholder — delegation is a decision, not a gap).
//  - ai_context.apiReference + the user's config.apiAreas multiselect → ONLY the
//    selected areas' curated endpoints render in the packet (no external fetch).
import { assert, assertEquals } from "./helpers.ts";
import { generateTaskDocument } from "../_shared/task-document-generator.ts";
import { buildNodeContext } from "../_shared/mcp-context-assembly.ts";

const N1 = "11111111-1111-1111-1111-111111111111";

// deno-lint-ignore no-explicit-any
const catalogs: any = {
  nodeRoles: {
    "backend-service": {
      id: "backend-service", label: "Backend Service", kind: "app_service",
      is_container: false, treatment_mode: "leaf",
    },
  },
  technologies: {
    stripe: {
      id: "stripe", name: "Stripe", role_affinities: ["backend-service"],
      ai_context: {
        purpose: "Payments platform.",
        apiReference: {
          docsUrl: "https://docs.stripe.com/api",
          areas: {
            payments: { docsUrl: "https://docs.stripe.com/api/payment_intents", endpoints: ["`POST /v1/payment_intents` — create"] },
            webhooks: { docsUrl: "https://docs.stripe.com/webhooks", endpoints: ["Verify Stripe-Signature"] },
            connect: { endpoints: ["`POST /v1/accounts`"] },
          },
        },
      },
      suggested_files: [], metadata_schema: {}, default_metadata: {}, common_connections: [],
    },
  },
};

// deno-lint-ignore no-explicit-any
const graphWith = (metadata: Record<string, unknown>): any => ({
  nodes: { [N1]: { id: N1, type: "backend-service", label: "Billing", technology: "stripe", metadata, ports: [] } },
  edges: {}, contracts: {}, artifacts: {},
});

Deno.test("apiReference: selected areas render; unselected are listed as available-not-selected", () => {
  const graph = graphWith({ config: { apiAreas: ["payments", "webhooks"] } });
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(doc.includes("**API Reference**"), "reference block renders");
  assert(doc.includes("#### payments — https://docs.stripe.com/api/payment_intents"), "selected area heading + docs url");
  assert(doc.includes("`POST /v1/payment_intents` — create"), "curated endpoint line verbatim");
  assert(doc.includes("#### webhooks"), "second selected area");
  assert(!doc.includes("#### connect"), "unselected area does NOT render its endpoints");
  assert(doc.includes("Not selected for this component (available if scope grows): connect"), "unselected areas named");
});

Deno.test("provenance: the trust signal travels WITH the reference (N8.1c)", () => {
  // deno-lint-ignore no-explicit-any
  const withProv: any = JSON.parse(JSON.stringify(catalogs));
  withProv.technologies.stripe.ai_context.provenance = { verifiedAt: "2026-07-27", sources: ["https://docs.stripe.com/api"], method: "model-knowledge" };
  const graph = graphWith({ config: { apiAreas: ["payments"] } });
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs: withProv, requirements: [] });
  assert(doc.includes("_Reference provenance: verified 2026-07-27 · model-knowledge._"), "footer under the reference block");

  const bare = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(!bare.includes("Reference provenance"), "no fabricated provenance when the row has none");
});

Deno.test("apiReference with NO selection: areas listed, AI told to confirm with the user", () => {
  const graph = graphWith({});
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(doc.includes("Available areas — the user has not selected"), "prompt line");
  assert(doc.includes("payments, webhooks, connect"), "all areas named");
  assert(!doc.includes("#### payments"), "no endpoint dump without selection");
});

Deno.test("configSource 'ai': packet states the delegation — never silent", () => {
  const graph = graphWith({ configSource: "ai" });
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(doc.includes("## Configuration"), "section renders for the delegation");
  assert(doc.includes("**Delegated to you (user choice):**"), "delegation statement");
  assert(!doc.includes("[PLACEHOLDER: config"), "no config placeholder — delegation is a decision, not a gap");
});

// The T1 config note only renders on declarative deliverables (sizing/wiring choices
// live there) — pin the delegated variant on an S3-style node.
// deno-lint-ignore no-explicit-any
const s3Catalogs: any = {
  nodeRoles: {
    "object-storage": { id: "object-storage", label: "Object Storage", kind: "app_service", is_container: false, treatment_mode: "leaf" },
  },
  technologies: {
    "aws-s3": { id: "aws-s3", name: "Amazon S3", role_affinities: ["object-storage"], ai_context: { configMode: "declarative" }, suggested_files: [], metadata_schema: {}, default_metadata: {}, common_connections: [] },
  },
};
// deno-lint-ignore no-explicit-any
const s3Graph = (metadata: Record<string, unknown>): any => ({
  nodes: { [N1]: { id: N1, type: "object-storage", label: "Media Bucket", technology: "aws-s3", metadata, ports: [] } },
  edges: {}, contracts: {}, artifacts: {},
});

Deno.test("N8.4a-3b: the MCP node context carries the inspector configuration (owner-found traceability bug)", () => {
  // "the node's context json doesn't reflect any of these specific configurations…
  // for all the nodes" — buildNodeContext (get_project_context) omitted metadata.config
  // while packets and the client export carried it.
  const g = graphWith({ config: { apiAreas: ["payments"], mode: "test" } });
  const ctx = buildNodeContext(g.nodes[N1], g, catalogs);
  assertEquals(ctx.configuration, { apiAreas: ["payments"], mode: "test" });
  assertEquals(ctx.configurationSource, "user-specified");

  const delegated = graphWith({ configSource: "ai" });
  const ctx2 = buildNodeContext(delegated.nodes[N1], delegated, catalogs);
  assertEquals(ctx2.configuration, null);
  assertEquals(ctx2.configurationSource, "delegated-to-ai");

  const unchosen = graphWith({});
  const ctx3 = buildNodeContext(unchosen.nodes[N1], unchosen, catalogs);
  assertEquals(ctx3.configuration, null);
  assertEquals(ctx3.configurationSource, null);
});

Deno.test("declarative T1: delegation replaces the missing-config placeholder in the work order", () => {
  const delegated = generateTaskDocument({ node: s3Graph({ configSource: "ai" }).nodes[N1], graph: s3Graph({ configSource: "ai" }), catalogs: s3Catalogs, requirements: [] });
  assert(delegated.includes("Configuration delegated by the user"), "T1 work-order note");
  assert(!delegated.includes("[PLACEHOLDER: config"), "no placeholder when delegated");

  const unchosen = generateTaskDocument({ node: s3Graph({}).nodes[N1], graph: s3Graph({}), catalogs: s3Catalogs, requirements: [] });
  assert(unchosen.includes("[PLACEHOLDER: config"), "unchosen config still surfaces as a placeholder (unchanged)");
  assert(!unchosen.includes("Delegated to you"), "no delegation text without the choice");
});

// REVERSED 2026-07-30 (owner bug: "after I click 'I'll specify' and make a manual
// change, I cannot click 'AI Decides'"). This used to assert values supersede the
// toggle — the same values-win precedence that pinned the inspector to manual and
// made the delegation unreachable. `configSource` is written ONLY by an explicit
// click, so it is the user's decision and it wins; the values stay in the model,
// dormant, and return intact if the user switches back.
Deno.test("explicit delegation wins over dormant values: delegated text, no honor-choices", () => {
  const graph = graphWith({ configSource: "ai", config: { mode: "test" } });
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(doc.includes("**Delegated to you (user choice):**"), "the explicit choice is honored");
  assert(!doc.includes("User-selected configuration for this component (honor these choices):"),
    "dormant leftovers must not render as chosen");
  assert(!doc.includes("- **mode:** test"), "dormant value is not emitted");
  assertEquals(doc.includes("[PLACEHOLDER: config"), false);
});

Deno.test("explicit 'manual' keeps the user's values (round-trip back from delegation)", () => {
  const graph = graphWith({ configSource: "manual", config: { mode: "test" } });
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(doc.includes("User-selected configuration for this component (honor these choices):"));
  assert(doc.includes("- **mode:** test"));
  assert(!doc.includes("Delegated to you"));
});

// Back-compat: nodes that predate the toggle carry values but NO configSource —
// they must still read as user-specified, never as delegated or unchosen.
Deno.test("legacy node (values, no recorded choice) still reads as user-specified", () => {
  const graph = graphWith({ config: { mode: "test" } });
  const doc = generateTaskDocument({ node: graph.nodes[N1], graph, catalogs, requirements: [] });
  assert(doc.includes("User-selected configuration for this component (honor these choices):"));
  assert(!doc.includes("Delegated to you"));
  assertEquals(doc.includes("[PLACEHOLDER: config"), false);
});

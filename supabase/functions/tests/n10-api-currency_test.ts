// N10(b) — the API-currency directive (owner ruling 2026-08-10): for external
// services/SaaS/integrations, the most current vendor documentation is PARAMOUNT.
// The packet must say so: live docs outrank the curated snapshot, with the docsUrl
// as the pointer. Non-external technologies keep the N8.1b carried-reference
// doctrine (the snapshot spares a fetch).
import { assert } from "./helpers.ts";
import { generateTaskDocument } from "../_shared/task-document-generator.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// deno-lint-ignore no-explicit-any
function render(aiContext: Record<string, unknown>): string {
  const graph: any = {
    nodes: { [A]: { id: A, type: "external-service", label: "Payments", technology: "stripe", metadata: {}, ports: [] } },
    edges: {}, contracts: {}, artifacts: {},
  };
  const catalogs: any = {
    nodeRoles: { "external-service": { id: "external-service", label: "External Service", nature: "call", interface_kind: "service", description: "Third-party service" } },
    technologies: { stripe: { id: "stripe", name: "Stripe", role_affinities: ["external-service"], ai_context: aiContext, metadata_schema: {}, suggested_files: [] } },
    deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {},
  };
  return generateTaskDocument({ node: graph.nodes[A], graph, catalogs, requirements: [] as never, projectVision: "Bench." });
}

Deno.test("external configMode: the packet carries the API-currency directive with the docsUrl, and live docs WIN", () => {
  const doc = render({
    purpose: "Payments",
    configMode: "external",
    apiReference: { docsUrl: "https://docs.stripe.com", areas: { payments: { endpoints: ["/v1/charges"] } } },
  });
  assert(doc.includes("API currency (third-party integration)"), "directive present");
  assert(doc.includes("consult the current documentation at https://docs.stripe.com"), "the pointer travels in the directive");
  assert(doc.includes("the live docs win"), "authority order stated");
  assert(doc.includes("curated snapshot — verify against the live docs"), "the reference header flips for externals");
  assert(!doc.includes("do not fetch externally"), "the old directive never renders for an external service");
});

Deno.test("external without a docsUrl still gets the directive (generic form)", () => {
  const doc = render({ purpose: "Payments", configMode: "external" });
  assert(doc.includes("API currency (third-party integration)"), "directive present even with no pointer");
  assert(doc.includes("consult the current documentation;"), "generic phrasing when no docsUrl exists");
});

Deno.test("non-external technology keeps the N8.1b carried-reference doctrine", () => {
  const doc = render({
    purpose: "SDK-style row",
    configMode: "code",
    apiReference: { docsUrl: "https://example.dev/docs", areas: { core: { endpoints: ["init()"] } } },
  });
  assert(doc.includes("do not fetch externally"), "the carried-reference wording stays for non-externals");
  assert(!doc.includes("API currency"), "no currency directive where the snapshot is the spare-a-fetch mechanism");
});

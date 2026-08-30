// N10(b) — the enrichment blind spot, closed. The task fingerprint tracked technology
// BY ID ONLY, so C1's push-time freshness gate never noticed catalog enrichment:
// already-pushed packets stayed thin until someone happened to re-run
// generate_task_docs (the coupling audit's finding #2, 2026-07-25). Discovered while
// building it: the generator branches on the PARENT (rent-by-placement reads its
// role's nature) yet parentId was in NO fingerprint field — reparenting flipped the
// deliverable class without staling the packet. Both close here; the field-set change
// takes the same precedented one-time re-stale round as configSignature/visionHash,
// and the content-diff guard keeps unchanged renders from rewriting files.
import { assert, assertEquals } from "./helpers.ts";
import { computeTaskContextFingerprint } from "../_shared/task-document-generator.ts";
import { computeTestContextFingerprint } from "../_shared/test-document-generator.ts";

const S = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";

// deno-lint-ignore no-explicit-any
function graph(nodeExtra: Record<string, unknown> = {}): any {
  return {
    nodes: {
      [S]: { id: S, type: "backend-service", label: "Api", technology: "express", metadata: {}, ports: [], ...nodeExtra },
      [T]: { id: T, type: "database", label: "Db", technology: "postgresql", metadata: {}, ports: [] },
      [P]: { id: P, type: "docker-container", label: "Box", metadata: {}, ports: [] },
    },
    edges: { e1: { id: "e1", source: S, target: T, contractId: "c1" } },
    contracts: { c1: { id: "c1", kind: "database_connection", name: "Api → Db", schema: {} } },
    artifacts: {},
  };
}

// deno-lint-ignore no-explicit-any
function catalogs(over: { express?: Record<string, unknown>; postgresql?: Record<string, unknown>; role?: Record<string, unknown> } = {}): any {
  return {
    nodeRoles: {
      "backend-service": { id: "backend-service", nature: "build", interface_kind: "service", description: "Server-side service", ...over.role },
      "database": { id: "database", nature: "build", interface_kind: "data", description: "Relational store" },
      "docker-container": { id: "docker-container", nature: "build", is_container: true, container_style: "hosting", description: "Container" },
    },
    technologies: {
      express: { id: "express", name: "Express", ai_context: { bestPractices: ["validate input"] }, metadata_schema: {}, suggested_files: [], ...over.express },
      postgresql: { id: "postgresql", name: "PostgreSQL", ai_context: { apiReference: { docsUrl: "https://postgresql.org/docs" } }, metadata_schema: {}, ...over.postgresql },
    },
    deploymentTargets: {},
    cloudProviderPatterns: [],
    scopeArchetypes: {},
  };
}

// deno-lint-ignore no-explicit-any
const fp = (g: any, c?: any) => computeTaskContextFingerprint(g.nodes[S], g, [], "", c).fingerprint;

Deno.test("N10(b): enriching the node's technology ai_context STALES the packet", () => {
  const base = fp(graph(), catalogs());
  assertEquals(fp(graph(), catalogs()), base, "same catalog → same fingerprint");
  const enriched = catalogs({ express: { ai_context: { bestPractices: ["validate input", "use helmet"] } } });
  assert(fp(graph(), enriched) !== base, "a bestPractices addition must reach committed docs via the freshness gate");
});

Deno.test("N10(b): cosmetic catalog columns (icon, color, sort_order) never re-stale", () => {
  const base = fp(graph(), catalogs());
  const cosmetic = catalogs();
  cosmetic.technologies.express.icon_url = "https://cdn/express.svg";
  cosmetic.technologies.express.color = "#000000";
  cosmetic.nodeRoles["backend-service"].icon_name = "server";
  cosmetic.nodeRoles["backend-service"].sort_order = 42;
  assertEquals(fp(graph(), cosmetic), base, "non-rendering columns are excluded by design");
});

Deno.test("N10(b): a COUNTERPARTY's apiReference edit stales this node's packet (the packet renders it)", () => {
  const base = fp(graph(), catalogs());
  const depEnriched = catalogs({ postgresql: { ai_context: { apiReference: { docsUrl: "https://postgresql.org/docs", endpoints: [{ path: "/query" }] } } } });
  assert(fp(graph(), depEnriched) !== base, "buildApiSurface renders the neighbor's endpoints");
  // …but a counterparty edit OUTSIDE apiReference does not (nothing of it renders here).
  const depOther = catalogs({ postgresql: { ai_context: { apiReference: { docsUrl: "https://postgresql.org/docs" }, bestPractices: ["use indexes"] } } });
  assertEquals(fp(graph(), depOther), base, "neighbor bestPractices never reach this packet");
});

Deno.test("N10(b): role text/axis edits stale the packet; unknown role/tech degrade to null-hash, never throw", () => {
  const base = fp(graph(), catalogs());
  assert(fp(graph(), catalogs({ role: { description: "Rewritten role description" } })) !== base, "roleRow.description renders in the packet");
  const sparse = catalogs();
  delete sparse.nodeRoles["backend-service"];
  delete sparse.technologies.express;
  const sparseFp = fp(graph(), sparse);
  assert(typeof sparseFp === "string" && sparseFp.length > 0, "missing rows hash as null, no throw");
});

Deno.test("N10(b): REPARENTING stales the packet — with and without catalogs (rent-by-placement)", () => {
  const noCat = fp(graph());
  const reparented = fp(graph({ parentId: P }));
  assert(reparented !== noCat, "parentSignature is graph-derived: a parent change flips the deliverable class");
  const withCat = fp(graph(), catalogs());
  assert(fp(graph({ parentId: P }), catalogs()) !== withCat, "and with catalogs the parent ROLE's axes participate too");
});

Deno.test("N10(b): no catalogs → catalogSignature empty (legacy callers stay computable)", () => {
  const result = computeTaskContextFingerprint(graph().nodes[S], graph(), [], "");
  assertEquals(result.fields.catalogSignature, "");
  assert(result.fields.parentSignature === "", "unparented node → empty parentSignature");
});

// ── test-plan fingerprint: the NARROW catalog surface ─────────────────────────────────

Deno.test("N10(b): test plans re-stale ONLY on testingPatterns — broad enrichment must not churn plans", () => {
  const req = { requirementId: "REQ-001", name: "R", description: "", category: "functional", acceptanceCriteria: [{ text: "works" }] };
  const mapped = [{ nodeId: S, label: "Api", role: "backend-service", technology: "express" }];
  // deno-lint-ignore no-explicit-any
  const tfp = (c: any) => computeTestContextFingerprint(req as any, mapped as any, [], graph(), "", c).fingerprint;

  const base = tfp(catalogs());
  const withPatterns = tfp(catalogs({ express: { ai_context: { testingPatterns: { framework: "vitest" } } } }));
  assert(withPatterns !== base, "a testingPatterns addition changes the framework recommendation → plan stales");
  const broadEnrichment = tfp(catalogs({ express: { ai_context: { bestPractices: ["a", "b", "c"], securityGuidance: ["s"] } } }));
  assertEquals(broadEnrichment, base, "bestPractices/security enrichment renders nowhere in the plan — no churn");
  // deno-lint-ignore no-explicit-any
  const legacy = computeTestContextFingerprint(req as any, mapped as any, [], graph(), "");
  assertEquals(legacy.fields.catalogSignature, "", "no catalogs → empty signature, legacy computable");
});

// N8.5″(a) — the M5 read gate, SERVER side. Until this change, loadCatalogs read
// every catalog row with a raw `as` cast (the exact pattern the M5 schema header
// condemns): the parse gate ran CLIENT-ONLY, so a malformed row the client skipped
// still flowed into task packets, MCP context, and import synthesis unchecked.
// Semantics pinned here are the CLIENT'S, verbatim: validate the raw row, skip and
// report on failure, keep the raw row on success, never throw.
import { FakeSupabase, assert, assertEquals, completeRole } from "./helpers.ts";
import { loadCatalogs } from "../_shared/catalog-loader.ts";

function scriptTables(sb: FakeSupabase, roles: unknown[], techs: unknown[]) {
  sb.script("node_roles", "select", { data: roles, error: null });
  sb.script("technology_catalog", "select", { data: techs, error: null });
  for (const t of ["deployment_targets", "legacy_type_mappings", "cloud_provider_patterns", "scope_archetypes"]) {
    sb.script(t, "select", { data: [], error: null });
  }
}

Deno.test("server read gate: malformed rows are SKIPPED and reported; valid rows keep flowing; never throws", async () => {
  const sb = new FakeSupabase();
  scriptTables(sb, [
    completeRole({ id: "backend-service", nature: "build", is_container: false }),
    // Malformed: rf_visual_type outside the enum — the drift class M5 exists for.
    { id: "drifted-role", label: "Drifted", description: "", icon_name: "x", color: "#000", rf_visual_type: "cylinder", palette_category: "Services", is_container: false, sort_order: 1 },
  ], [
    { id: "express", name: "Express", role_affinities: ["backend-service"] },
    // Malformed: name missing entirely.
    { id: "broken-tech" },
  ]);

  const catalogs = await loadCatalogs(sb as never);
  assert(!!catalogs.nodeRoles["backend-service"], "valid role loaded");
  assertEquals(catalogs.nodeRoles["drifted-role"], undefined, "malformed role SKIPPED, not cast through");
  assert(!!catalogs.technologies["express"], "valid technology loaded");
  assertEquals(catalogs.technologies["broken-tech"], undefined, "malformed technology SKIPPED");
  assertEquals(catalogs.catalogIssues?.length, 2, "both skips counted");
  assert(catalogs.catalogIssues!.some((i) => i.includes("drifted-role")), "issue names the role row");
  assert(catalogs.catalogIssues!.some((i) => i.includes("broken-tech")), "issue names the tech row");
});

Deno.test("server read gate: a fully valid catalog reports zero issues (no false degradation)", async () => {
  const sb = new FakeSupabase();
  scriptTables(sb, [completeRole({ id: "backend-service" })], [{ id: "express", name: "Express" }]);
  const catalogs = await loadCatalogs(sb as never);
  assertEquals(catalogs.catalogIssues, [], "clean catalog, clean report");
  assert(!!catalogs.nodeRoles["backend-service"] && !!catalogs.technologies["express"]);
});

Deno.test("client parity: completeRole output passes the same parseRole gate real DB rows pass", async () => {
  // The fixture helper must never drift ahead of the schema — if this fails, the
  // helper is producing rows the gate rejects and every fixture site breaks silently.
  const { parseRole } = await import("../_shared/catalog-schemas.ts");
  const minimal = parseRole(completeRole({ id: "x", is_container: true, container_style: "logical-boundary" }));
  assert(minimal.ok, minimal.issues.join("; "));
  const coerced = parseRole(completeRole({ id: "y", palette_category: "Frontend", rf_visual_type: "" }));
  assert(coerced.ok, "pre-M free-text enum values are coerced, not passed through");
});

// ── N8.5″(c): the blanket fallback is machine-detectable, and the live lane refuses it ──
Deno.test("N8.5(c): unknown type → blanket flag set; normalization derives a technology role instead of the backend-service lie", async () => {
  const { validateAndCorrectNodeType } = await import("../_shared/role-registry.ts");
  const { normalizeProposedNode } = await import("../_shared/catalog-node-normalization.ts");
  // deno-lint-ignore no-explicit-any
  const catalogs: any = {
    nodeRoles: {
      "backend-service": { id: "backend-service", label: "Backend Service", palette_category: "Services", is_container: false },
      "frontend-app": { id: "frontend-app", label: "Frontend App", palette_category: "Services", is_container: false },
    },
    technologies: { react: { id: "react", name: "React", role_affinities: ["frontend-app"] } },
    deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {},
  };

  const c = validateAndCorrectNodeType(catalogs, "zzz-utterly-unknown-role-zzz");
  assertEquals(c.blanket, true, "last resort carries the structural flag");
  assertEquals(c.type, "backend-service");
  // A real Levenshtein correction is NOT blanket.
  const real = validateAndCorrectNodeType(catalogs, "backend-servic");
  assert(real.corrected && !real.blanket, JSON.stringify(real));

  // The live propose_patches lane: the blanket is refused; the technology's own
  // affinity decides, with a reported note — never a silent backend-service.
  const n = normalizeProposedNode(catalogs, "zzz-utterly-unknown-role-zzz", "react");
  assertEquals(n.type, "frontend-app", "technology affinity wins over the blanket");
  assert(n.notes.some((x: { field: string }) => x.field === "type"), "the correction is REPORTED");
});

// ── N8.5″(d): loadCatalogs seeds provider inference on the server runtime ──────────────
Deno.test("N8.5(d): a provider-stamped role row registers its family through loadCatalogs — one row, zero code", async () => {
  const { inferProviderFromId, resetRegisteredProviderFamilies } = await import("../_shared/provider-inference.ts");
  resetRegisteredProviderFamilies();
  assertEquals(inferProviderFromId("digitalocean-spaces"), null, "unknown before the catalog loads");

  const sb = new FakeSupabase();
  scriptTables(sb, [
    completeRole({ id: "digitalocean", nature: "host", is_container: true, container_style: "hosting", provider: "digitalocean" }),
  ], []);
  await loadCatalogs(sb as never);
  assertEquals(inferProviderFromId("digitalocean-spaces"), "digitalocean", "the catalog row IS the registration");
  assertEquals(inferProviderFromId("aws-lambda"), "aws", "static floor untouched");
  resetRegisteredProviderFamilies();
});

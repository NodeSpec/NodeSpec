// AG.0 (owner 2026-09-28): the safety net before any catalog change. Import
// names catalog ids in its own tables (the role and host families, the
// manifest technologies, the backing services it places by their first
// role). `catalogDrift` says which of them the loaded catalog cannot honour,
// so a catalog edit that quietly degrades an import shows on the job; and a
// proposal naming an unknown type never falls to a retired role.
import { catalogDrift } from "../_shared/catalog-driven-resolver.ts";
import { genericRoleForCategory } from "../_shared/catalog-node-normalization.ts";
import type { CatalogData } from "../_shared/catalog-loader.ts";
import { assert, assertEquals, completeRole } from "./helpers.ts";

const leaf = (id: string, over: Record<string, unknown> = {}) =>
  completeRole({ id, palette_category: "Services", nature: "build", can_contain: [], ...over });
const hostRole = (id: string, over: Record<string, unknown> = {}) =>
  completeRole({ id, palette_category: "Infrastructure", nature: "build", is_container: true, container_style: "hosting", can_contain: [], ...over });
const tech = (id: string, role_affinities: string[], over: Record<string, unknown> = {}) =>
  ({ id, name: id, role_affinities, ai_context: {}, is_user_contributed: false, project_id: null, ...over });

function catalog(roles: Array<Record<string, unknown>>, techs: Array<Record<string, unknown>> = []): CatalogData {
  return {
    nodeRoles: Object.fromEntries(roles.map((r) => [r.id, r])),
    technologies: Object.fromEntries(techs.map((t) => [t.id, t])),
    deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {},
  } as unknown as CatalogData;
}

Deno.test("AG.0b: a role a family prefers is reported when the catalog lacks it or has retired it, and not when it is live", () => {
  const drift = catalogDrift(catalog([leaf("backend-service"), leaf("frontend-app", { deprecated: true })]));
  assert(drift.includes("role family database: database is missing"), drift.join("\n"));
  assert(drift.includes("role family frontend: frontend-app is retired"), drift.join("\n"));
  assert(!drift.some((d) => d.startsWith("role family backend:")), "a live preferred role is not drift");
});

Deno.test("AG.0b: a host family's role must be a live hosting container", () => {
  const drift = catalogDrift(catalog([
    hostRole("desktop-device"),
    leaf("edge-device"),
    hostRole("mobile-device", { container_style: "logical-boundary" }),
  ]));
  assert(!drift.some((d) => d.startsWith("host family desktop:")), drift.join("\n"));
  assert(drift.includes("host family edge: edge-device is not a hosting container"), drift.join("\n"));
  assert(drift.includes("host family mobile: mobile-device is not a hosting container"), drift.join("\n"));
  assert(drift.includes("host family compose: docker-compose is missing"), drift.join("\n"));
});

Deno.test("AG.0b: a manifest technology must exist, be a catalog row, and take its family's role", () => {
  const drift = catalogDrift(catalog(
    [leaf("desktop-app"), leaf("mobile-app"), leaf("firmware-service", { palette_category: "Hardware" })],
    [
      tech("electron", ["frontend-app"]),
      tech("tauri", ["desktop-app"]),
      tech("swift-ios", ["mobile-app"], { is_user_contributed: true, project_id: "p1" }),
      tech("arduino", ["firmware-service"]),
    ],
  ));
  assert(drift.includes("manifest desktop-electron: electron does not take desktop-app"), drift.join("\n"));
  assert(!drift.some((d) => d.includes(": tauri ")), "tauri takes desktop-app");
  assert(drift.includes("manifest ios-app: swift-ios is a custom row"), drift.join("\n"));
  assert(drift.includes("manifest android-app: kotlin-android is missing"), drift.join("\n"));
  assert(!drift.some((d) => d.includes(": arduino ")), "arduino takes firmware-service");
});

Deno.test("AG.0b: a placed backing service must exist and its first role must be live", () => {
  const drift = catalogDrift(
    catalog(
      [leaf("database", { deprecated: true }), leaf("cache")],
      [tech("postgresql", ["database"]), tech("redis", ["cache", "database"]), tech("mystery", []), tech("private-db", ["cache"], { is_user_contributed: true, project_id: "p1" })],
    ),
    ["postgresql", "redis", "ghost", "mystery", "private-db", "redis"],
  );
  assert(drift.includes("backing service postgresql places on database, which is retired"), drift.join("\n"));
  assert(!drift.some((d) => d.startsWith("backing service redis")), "redis places on a live cache, and is listed once");
  assert(drift.includes("backing service ghost is missing"), drift.join("\n"));
  assert(drift.includes("backing service mystery has no role"), drift.join("\n"));
  assert(drift.includes("backing service private-db is a custom row"), drift.join("\n"));
});

Deno.test("AG.0b: an empty catalog (the offline paths) reports nothing", () => {
  assertEquals(catalogDrift(catalog([]), ["postgresql"]), []);
});

Deno.test("AG.0e: a proposal's unknown type never falls to a retired role in its category", () => {
  const c = catalog([
    leaf("embedded-device", { palette_category: "Hardware", sort_order: 1, deprecated: true }),
    leaf("firmware-service", { palette_category: "Hardware", sort_order: 5 }),
    leaf("backend-service", { deprecated: true }),
    leaf("worker", { sort_order: 9 }),
  ]);
  assertEquals(genericRoleForCategory(c, "Hardware"), "firmware-service");
  // Services prefers backend-service by name; a retired preference falls to the category's live generic.
  assertEquals(genericRoleForCategory(c, "Services"), "worker");
});

// N8.3′ — the ai_context write gate on the SERVER mirror, plus the mirror contract
// itself pinned mechanically: core/src/catalog-schemas.ts and
// _shared/catalog-schemas.ts must stay byte-identical after their import lines
// (headers name each other; the body is ONE definition in two runtimes). A drifted
// mirror is how the client and server would come to disagree about what a valid
// catalog row IS — the exact disease M5 exists to prevent.
import { assert, assertEquals } from "./helpers.ts";
import { validateTechnologyFiling } from "../_shared/catalog-schemas.ts";

const KNOWN = { knownRoleIds: new Set(["backend-service"]) };
// deno-lint-ignore no-explicit-any
const tech = (over: Record<string, any> = {}) => ({
  id: "express", name: "Express", role_affinities: ["backend-service"], ...over,
});
const PROV = { verifiedAt: "2026-08-09", method: "live-docs" };

Deno.test("N8.3 mirror gate: dialect-B + documentationUrls rejected by name; enrichment demands provenance", () => {
  const dialectB = validateTechnologyFiling(tech({ ai_context: { summary: "s" } }), KNOWN);
  assert(dialectB.some((e) => e.includes('"summary"') && e.includes("dialect-B")), JSON.stringify(dialectB));
  const docs = validateTechnologyFiling(tech({ ai_context: { documentationUrls: ["https://x"] } }), KNOWN);
  assert(docs.some((e) => e.includes("apiReference.docsUrl")), JSON.stringify(docs));
  const orphan = validateTechnologyFiling(tech({ ai_context: { apiReference: { docsUrl: "https://d" } } }), KNOWN);
  assert(orphan.some((e) => e.includes("NO provenance")), JSON.stringify(orphan));
  const stamped = validateTechnologyFiling(tech({ ai_context: { apiReference: { docsUrl: "https://d" }, provenance: PROV } }), KNOWN);
  assertEquals(stamped, []);
});

Deno.test("N8.3 mirror gate: one metadata_schema shape — flat field map only", () => {
  const flat = validateTechnologyFiling(tech({
    metadata_schema: { region: { type: "enum", label: "Region", options: ["us-east-1"] } },
  }), KNOWN);
  assertEquals(flat, []);
  const jsonSchema = validateTechnologyFiling(tech({
    metadata_schema: { properties: { region: { type: "string" } } },
  }), KNOWN);
  assert(jsonSchema.some((e) => e.includes("metadata_schema.properties")), JSON.stringify(jsonSchema));
});

Deno.test("M5 mirror contract: catalog-schemas bodies are byte-identical after the import line", async () => {
  const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));
  const core = await read("../../../core/src/catalog-schemas.ts");
  const mirror = await read("../_shared/catalog-schemas.ts");
  const coreBody = core.split("import { z } from 'zod';\n")[1];
  const mirrorBody = mirror.split('import { z } from "npm:zod@3.22.4";\n')[1];
  assert(typeof coreBody === "string" && coreBody.length > 0, "core import-line anchor moved — update this pin");
  assert(typeof mirrorBody === "string" && mirrorBody.length > 0, "mirror import-line anchor moved — update this pin");
  assertEquals(mirrorBody, coreBody, "the mirror drifted from core — re-sync the body, they are ONE definition");
});

// N8.4a-1b — stray technology-id normalization (owner: "consistent naming/id
// references … within each chunk … between the database references, zod schema, and
// frontend reference"). The DB renamed aurora/dynamodb/ec2 to aws-* ids; these pins
// hold the two runtime seams: READ tolerance (alias keys share the canonical row) and
// WRITE canonicalization (proposals carrying a legacy id land with the canonical id).
import { assert, assertEquals } from "./helpers.ts";
import { registerTechnologyAliases, TECHNOLOGY_ID_ALIASES } from "../_shared/catalog-loader.ts";
import { normalizeProposedNode } from "../_shared/catalog-node-normalization.ts";

Deno.test("alias map: every retired stray points at its canonical row", () => {
  assertEquals(TECHNOLOGY_ID_ALIASES, {
    aurora: "aws-aurora",
    dynamodb: "aws-dynamodb",
    ec2: "aws-ec2",
    elasticache: "aws-elasticache",
    cosmosdb: "azure-cosmos-db",
    // 4b-3: merged duplicate — both rows were named "Microsoft Entra ID".
    "azure-ad-b2c": "azure-entra-id",
    // 4c-1: GCP had four un-prefixed rows; two were duplicate pairs.
    gcs: "gcp-cloud-storage",
    "gcp-cloud-storage-for-archive": "gcp-cloud-storage",
    firestore: "gcp-firestore",
    "firebase-firestore": "gcp-firestore",
    "gce-instance": "gcp-compute-engine",
    // 4c-5 owner rulings: Vertex arbiter merge + dead-product retirement.
    "gcp-cloud-natural-language-api": "gcp-vertex-ai",
    "openai-assistants": "openai",
  });
});

Deno.test("read seam: alias keys resolve to the SAME canonical row object", () => {
  // deno-lint-ignore no-explicit-any
  const map: any = { "aws-ec2": { id: "aws-ec2", name: "Amazon EC2", role_affinities: [], ai_context: {} } };
  registerTechnologyAliases(map);
  assert(map.ec2 === map["aws-ec2"], "same object, no copy");
  assertEquals(map.ec2.id, "aws-ec2", "row id stays canonical");
});

Deno.test("read seam: a genuine row is never shadowed by an alias", () => {
  // deno-lint-ignore no-explicit-any
  const map: any = {
    "aws-ec2": { id: "aws-ec2", role_affinities: [], ai_context: {} },
    ec2: { id: "ec2", role_affinities: [], ai_context: {} }, // pre-migration bench
  };
  registerTechnologyAliases(map);
  assertEquals(map.ec2.id, "ec2", "existing key wins — alias only fills gaps");
});

Deno.test("write seam: a proposal carrying the legacy id lands with the canonical id", () => {
  // deno-lint-ignore no-explicit-any
  const catalogs: any = {
    nodeRoles: {
      "backend-service": { id: "backend-service", label: "Backend Service", kind: "app_service", is_container: false, treatment_mode: "leaf", deprecated: false, capability_tags: [], palette_category: "Services" },
    },
    technologies: registerTechnologyAliases({
      "aws-ec2": { id: "aws-ec2", name: "Amazon EC2", role_affinities: ["backend-service"], ai_context: {} },
    }),
    legacyTypeMappings: {},
    deploymentTargets: {},
  };
  const normalized = normalizeProposedNode(catalogs, "backend-service", "ec2");
  assertEquals(normalized.technology, "aws-ec2", "legacy id canonicalized at the write boundary");
  const cased = normalizeProposedNode(catalogs, "backend-service", "EC2");
  assertEquals(cased.technology, "aws-ec2", "case-insensitive path canonicalizes too");
});

// N8.4c-1 — server mirror of the Firebase→GCP provider-family fix. The MCP evaluator
// (canContainerAcceptChild) refused Firebase children inside a Google Cloud container
// for the same reason the canvas did: `firebase-` inferred the bare prefix.
import { assertEquals } from "./helpers.ts";
import { canContainerAcceptChild, inferProviderPrefix, normalizeProviderFamily } from "../_shared/role-registry.ts";

// deno-lint-ignore no-explicit-any
const catalogs: any = {
  nodeRoles: {
    gcp: { id: "gcp", label: "Google Cloud", kind: "platform", provider: "gcp", is_container: true, can_contain: { providers: ["gcp"] }, treatment_mode: "container" },
    firebase: { id: "firebase", label: "Firebase", kind: "platform", provider: "firebase", is_container: true, can_contain: { providers: ["gcp"] }, treatment_mode: "container" },
    aws: { id: "aws", label: "AWS", kind: "platform", provider: "aws", is_container: true, can_contain: { providers: ["aws"] }, treatment_mode: "container" },
    "auth-provider": { id: "auth-provider", label: "Auth Provider", kind: "app_service", provider: null, is_container: false, can_contain: [], treatment_mode: "leaf" },
    database: { id: "database", label: "Database", kind: "data_store", provider: null, is_container: false, can_contain: [], treatment_mode: "leaf" },
  },
  technologies: {
    "firebase-auth": { id: "firebase-auth", name: "Firebase Auth", role_affinities: ["auth-provider"], ai_context: {} },
    "gcp-firestore": { id: "gcp-firestore", name: "Google Cloud Firestore", role_affinities: ["database"], ai_context: {} },
    "aws-dynamodb": { id: "aws-dynamodb", name: "AWS DynamoDB", role_affinities: ["database"], ai_context: {} },
  },
};

Deno.test("firebase- infers the gcp provider family", () => {
  assertEquals(inferProviderPrefix("firebase-auth"), "gcp");
  assertEquals(inferProviderPrefix("gcp-firestore"), "gcp");
  assertEquals(inferProviderPrefix("aws-s3"), "aws");
  assertEquals(normalizeProviderFamily("firebase"), "gcp");
  assertEquals(normalizeProviderFamily("aws"), "aws");
  assertEquals(normalizeProviderFamily(null), null);
});

Deno.test("MCP: Firebase Auth is accepted inside a Google Cloud container", () => {
  assertEquals(canContainerAcceptChild(catalogs, "gcp", "auth-provider", "firebase-auth").allowed, true);
});

Deno.test("MCP: a GCP technology is accepted inside a legacy Firebase container", () => {
  assertEquals(canContainerAcceptChild(catalogs, "firebase", "database", "gcp-firestore").allowed, true);
});

Deno.test("MCP: cross-provider containment is still refused", () => {
  const refused = canContainerAcceptChild(catalogs, "aws", "auth-provider", "firebase-auth");
  assertEquals(refused.allowed, false);
  assertEquals(refused.reason?.includes("Cross-provider"), true);
  assertEquals(canContainerAcceptChild(catalogs, "gcp", "database", "aws-dynamodb").allowed, false);
});

// N8.1 — containment audit rails + server rule-object enforcement.
// Owner (2026-07-26): containment must be auditable + scalable; "I already see errors
// here." The audit found 8 deprecated ids across 20/29 containers AND that the server
// treated rule-object can_contain (aws/azure/gcp) as allow-everything, so platform
// containment held on the canvas but not over propose_patches.
import { assert, assertEquals } from "./helpers.ts";
import { auditContainmentMatrix } from "../_shared/containment-audit.ts";
import { canContainerAcceptChild } from "../_shared/role-registry.ts";

// deno-lint-ignore no-explicit-any
// M7: the audit reads `nature` + derived treatment; `kind`/`treatment_mode` are dropped
// columns and setting them here pinned nothing.
const role = (over: Record<string, unknown>): any => ({
  label: over.id, nature: "build", interface_palette_category: "Services",
  is_container: false, deprecated: false, can_contain: [], ...over,
});

Deno.test("audit: dead-ref — deprecated id still listed (the shipped-catalog defect class)", () => {
  const findings = auditContainmentMatrix([
    role({ id: "vpc", is_container: true, container_style: "hosting", can_contain: ["websocket-server", "backend-service"] }),
    role({ id: "websocket-server", deprecated: true }),
    role({ id: "backend-service" }),
  ]);
  const dead = findings.filter((f) => f.kind === "dead-ref");
  assertEquals(dead.length, 1);
  assertEquals(dead[0].severity, "error");
  assertEquals(dead[0].roleId, "vpc");
  assert(dead[0].detail.includes("websocket-server"));
});

Deno.test("audit: unknown-ref — id that exists nowhere", () => {
  const findings = auditContainmentMatrix([
    role({ id: "vpc", is_container: true, container_style: "hosting", can_contain: ["no-such-role"] }),
  ]);
  assertEquals(findings.filter((f) => f.kind === "unknown-ref").length, 1);
});

Deno.test("audit: starved-role — live leaf admitted by zero live containers (the realtime-service case)", () => {
  const findings = auditContainmentMatrix([
    role({ id: "vpc", is_container: true, container_style: "hosting", can_contain: ["backend-service"] }),
    role({ id: "realtime-service" }),
    role({ id: "backend-service" }),
  ]);
  const starved = findings.filter((f) => f.kind === "starved-role");
  assertEquals(starved.map((f) => f.roleId), ["realtime-service"]);
});

// N11(b) 2026-08-09: the requirement/"requirements" exemption line is gone WITH the role —
// spec-plane rows are no longer catalog citizens, so the audit has nothing to exempt.
Deno.test("audit: starvation exemptions — boundary treatment, boundary kinds, platform/logical", () => {
  const findings = auditContainmentMatrix([
    role({ id: "vpc", is_container: true, container_style: "hosting", can_contain: ["backend-service"] }),
    role({ id: "backend-service" }),
    role({ id: "scheduled-trigger", nature: "engine" }),                    // boundary by nature
    role({ id: "aws-lambda", nature: "integrate" }),                        // boundary by nature
    role({ id: "n8n-flow", nature: "engine" }),                             // boundary by nature
    role({ id: "aws", nature: "host", is_container: true, container_style: "hosting" }),                                  // root-level by design
    role({ id: "group", palette_category: "Logical" }),
  ]);
  assertEquals(findings.filter((f) => f.kind === "starved-role").length, 0);
});

Deno.test("audit: rule-object admission counts — provider prefix satisfies starvation", () => {
  const findings = auditContainmentMatrix([
    role({ id: "aws", is_container: true, nature: "host", is_container: true, container_style: "hosting", can_contain: { roleIds: ["aws-lambda"], providers: ["aws"] } }),
    role({ id: "aws-s3-role", interface_kind: "data" }), // admitted via aws- prefix on providers
  ]);
  assertEquals(findings.filter((f) => f.kind === "starved-role").length, 0);
});

Deno.test("audit: clean matrix produces zero findings (post-migration state)", () => {
  const findings = auditContainmentMatrix([
    role({ id: "vpc", is_container: true, container_style: "hosting", can_contain: ["backend-service", "realtime-service"] }),
    role({ id: "backend-service" }),
    role({ id: "realtime-service" }),
  ]);
  assertEquals(findings, []);
});

// ── server rule-object enforcement (the propose_patches hole) ────────────────────────

// deno-lint-ignore no-explicit-any
const catalogs: any = {
  nodeRoles: {
    aws: role({ id: "aws", label: "AWS", nature: "host", is_container: true, container_style: "hosting", can_contain: { roleIds: ["aws-lambda"], providers: ["aws"] } }),
    "aws-lambda": role({ id: "aws-lambda", nature: "integrate" }),
    "backend-service": role({ id: "backend-service" }),
    database: role({ id: "database", interface_kind: "data" }),
    "gcp-cloud-run": role({ id: "gcp-cloud-run", nature: "build", provider: "gcp" }),
  },
  technologies: {
    "aws-s3": { id: "aws-s3", name: "S3", role_affinities: [], ai_context: {} },
    react: { id: "react", name: "React", role_affinities: [], ai_context: {} },
  },
};

Deno.test("N8.1: rule-object roleIds allowlist admits its members", () => {
  assertEquals(canContainerAcceptChild(catalogs, "aws", "aws-lambda").allowed, true);
});

Deno.test("N8.1: providers allowlist admits by technology prefix", () => {
  assertEquals(canContainerAcceptChild(catalogs, "aws", "database", "aws-s3").allowed, true);
});

Deno.test("N8.1: providers allowlist REJECTS a non-provider leaf (was allowed:true before the fix)", () => {
  const verdict = canContainerAcceptChild(catalogs, "aws", "backend-service", "react");
  assertEquals(verdict.allowed, false);
  assert(verdict.reason?.includes("providers: aws"), "reason names the rule");
});

Deno.test("N8.1: providers allowlist rejects a DIFFERENT provider's role", () => {
  assertEquals(canContainerAcceptChild(catalogs, "aws", "gcp-cloud-run").allowed, false);
});

Deno.test("N8.1: provider column on the child role satisfies providers when it matches", () => {
  // deno-lint-ignore no-explicit-any
  const withProvider: any = { ...catalogs, nodeRoles: { ...catalogs.nodeRoles, "aurora-role": role({ id: "aurora-role", provider: "aws" }) } };
  assertEquals(canContainerAcceptChild(withProvider, "aws", "aurora-role").allowed, true);
});

// ── N8.4b-1b: platform-in-platform invariant (owner CRITICAL 2026-07-27) ────────────
// "Azure services cannot be contained by AWS projects, AWS nodes cannot be contained by
// Azure projects, GCP in azure or AWS, etc." Platforms are account/subscription
// boundaries — peers, never nested. Checked before the permissive unknown-container
// fallback so no path (propose_patches included) can bypass it.
// deno-lint-ignore no-explicit-any
const platformCatalogs: any = {
  nodeRoles: {
    aws: role({ id: "aws", label: "AWS", nature: "host", is_container: true, container_style: "hosting", can_contain: { roleIds: ["aws-lambda"], providers: ["aws"] } }),
    azure: role({ id: "azure", label: "Azure", nature: "host", is_container: true, container_style: "hosting", is_container: true, can_contain: { roleIds: [], providers: ["azure"] } }),
    gcp: role({ id: "gcp", label: "GCP", nature: "host", is_container: true, container_style: "hosting", is_container: true, can_contain: { providers: ["gcp"] } }),
    "k8s-cluster": role({ id: "k8s-cluster", container_style: "hosting", is_container: true }),
  },
  technologies: { "azure-kubernetes-service": { id: "azure-kubernetes-service", name: "AKS", role_affinities: [], ai_context: {} } },
};

Deno.test("N8.4b-1b: propose_patches cannot nest a platform inside another platform", () => {
  for (const [container, child] of [["aws", "azure"], ["azure", "aws"], ["aws", "gcp"], ["gcp", "azure"], ["aws", "aws"]]) {
    const verdict = canContainerAcceptChild(platformCatalogs, container, child);
    assertEquals(verdict.allowed, false, `${container} must not contain ${child}`);
    // N8.4g-3 broadened the invariant (platforms are vendor-operated — nothing hosts
    // them, not just other platforms); the reason text moved with it.
    assert(verdict.reason?.includes("managed platform"), "reason explains the invariant");
  }
});

Deno.test("N8.4b-1b: the invariant does not block a provider service under ITS platform", () => {
  assertEquals(canContainerAcceptChild(platformCatalogs, "azure", "k8s-cluster", "azure-kubernetes-service").allowed, true);
});

Deno.test("N8.4b-1c: cross-provider containment refused inside a generic container (the AWS-VPC case)", () => {
  // deno-lint-ignore no-explicit-any
  const c: any = {
    nodeRoles: {
      vpc: role({ id: "vpc", container_style: "hosting", is_container: true, can_contain: ["backend-service", "k8s-cluster"] }),
      "k8s-cluster": role({ id: "k8s-cluster", container_style: "hosting", is_container: true }),
      "backend-service": role({ id: "backend-service" }),
    },
    technologies: {
      "azure-kubernetes-service": { id: "azure-kubernetes-service", role_affinities: [], ai_context: {} },
      "aws-eks": { id: "aws-eks", role_affinities: [], ai_context: {} },
    },
  };
  const refused = canContainerAcceptChild(c, "vpc", "k8s-cluster", "azure-kubernetes-service", "aws-vpc");
  assertEquals(refused.allowed, false, "azure child inside an aws VPC");
  assert(refused.reason?.includes("Cross-provider"), "reason names the invariant");
  // Same provider, and provider-neutral children, still pass.
  assertEquals(canContainerAcceptChild(c, "vpc", "k8s-cluster", "aws-eks", "aws-vpc").allowed, true);
  assertEquals(canContainerAcceptChild(c, "vpc", "backend-service", undefined, "aws-vpc").allowed, true);
});

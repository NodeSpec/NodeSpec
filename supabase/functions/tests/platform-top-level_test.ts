// N8.4g-3 (owner ruling): "The Supabase managed [platform] cannot be contained by any
// container nodes because it's managed by supabase." Generalized: a platform-kind role
// is vendor-operated — nothing HOSTS it. Refused in every container except a purely
// organizational logical group (N5.16: only logical Structure is organizational).
import { assert, assertEquals } from "./helpers.ts";
import { canContainerAcceptChild } from "../_shared/role-registry.ts";

// deno-lint-ignore no-explicit-any
const catalogs: any = {
  nodeRoles: {
    supabase: { id: "supabase", label: "Supabase (Managed)", nature: "host", is_container: true, provider: "supabase", can_contain: { roleIds: [], providers: ["supabase"], natures: ["build"], interfaceKinds: ["service", "data"] } },
    aws: { id: "aws", label: "AWS", nature: "host", is_container: true, provider: "aws", can_contain: { roleIds: [], providers: ["aws"], natures: ["build"], interfaceKinds: ["service"] } },
    "docker-container": { id: "docker-container", label: "Docker Container", nature: "host", is_container: true, can_contain: { roleIds: [], providers: [], natures: ["build", "host"], interfaceKinds: ["service"] } },
    group: { id: "group", label: "Group", nature: "build", is_container: true, container_style: "logical-boundary" },
    "auth-provider": { id: "auth-provider", label: "Auth Provider", nature: "integrate", is_container: false },
  },
  technologies: {},
};

Deno.test("platform child refused inside a hosting container (even when enumerated)", () => {
  // docker-container's natures allowlist above deliberately INCLUDES 'host' — the
  // invariant must win over the enumeration, not depend on allowlist hygiene.
  const res = canContainerAcceptChild(catalogs, "docker-container", "supabase");
  assertEquals(res.allowed, false);
  assert(res.reason?.includes("managed platform"), "reason names the invariant");
});

Deno.test("platform-in-platform still refused (subsumed by the broader rule)", () => {
  const res = canContainerAcceptChild(catalogs, "aws", "supabase");
  assertEquals(res.allowed, false);
});

Deno.test("platform allowed inside a purely organizational logical group", () => {
  const res = canContainerAcceptChild(catalogs, "group", "supabase");
  assertEquals(res.allowed, true);
});

Deno.test("non-platform children unaffected (auth-provider into supabase container)", () => {
  const res = canContainerAcceptChild(catalogs, "supabase", "auth-provider");
  assertEquals(res.allowed, true);
});

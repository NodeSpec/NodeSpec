// N8.4r — the container's configuration has to SCOPE its children. Platform containers
// have carried an account/subscription/project schema since 4a-4c, but every AI-facing
// surface printed the parent's label and type and stopped: the configured region,
// environment and IAM baseline reached no packet and no node context. The user filled in
// a form that changed no output.
import { assertEquals } from "./helpers.ts";
import {
  collectInheritedScopes,
  effectiveInheritedValues,
  renderInheritedContext,
} from "../_shared/inherited-context.ts";

// deno-lint-ignore no-explicit-any
const graph: any = {
  nodes: {
    aws: {
      id: "aws", label: "Acme Prod (AWS)", type: "aws",
      metadata: { config: { primaryRegion: "us-east-1", environment: "production", costTags: true } },
    },
    vpc: {
      id: "vpc", label: "Core VPC", type: "vpc", parentId: "aws",
      metadata: { config: { cidrBlock: "10.0.0.0/16", primaryRegion: "us-west-2" } },
    },
    svc: { id: "svc", label: "Orders API", type: "backend-service", parentId: "vpc", metadata: {} },
    orphan: { id: "orphan", label: "Loose Node", type: "backend-service" },
    blankcfg: {
      id: "blankcfg", label: "Empty Group", type: "cloud-project",
      metadata: { config: { accountAlias: "", primaryRegion: null } },
    },
    under_blank: { id: "under_blank", label: "Child", type: "backend-service", parentId: "blankcfg" },
  },
};

Deno.test("walks the whole ancestor chain, outermost first", () => {
  const scopes = collectInheritedScopes(graph, "svc");
  assertEquals(scopes.map((s) => s.containerId), ["aws", "vpc"]);
  assertEquals(scopes[0].values, { primaryRegion: "us-east-1", environment: "production", costTags: true });
  assertEquals(scopes[1].values, { cidrBlock: "10.0.0.0/16", primaryRegion: "us-west-2" });
});

Deno.test("the innermost container wins a key collision", () => {
  const effective = effectiveInheritedValues(collectInheritedScopes(graph, "svc"));
  assertEquals(effective.primaryRegion, "us-west-2", "the VPC's region overrides the account default");
  assertEquals(effective.environment, "production", "and the account-level value still comes through");
});

Deno.test("no parent, or nothing configured, yields nothing to render", () => {
  assertEquals(collectInheritedScopes(graph, "orphan"), []);
  assertEquals(renderInheritedContext([]), "", "no hollow heading when there is nothing to say");
});

Deno.test("blank values are 'not answered', not 'answered with empty'", () => {
  // The inspector writes '' when a user focuses a field and leaves it — rendering that
  // as inherited truth would tell an AI the region is the empty string.
  assertEquals(collectInheritedScopes(graph, "under_blank"), []);
});

Deno.test("a parent cycle terminates instead of hanging", () => {
  // deno-lint-ignore no-explicit-any
  const cyclic: any = {
    nodes: {
      a: { id: "a", label: "A", type: "x", parentId: "b", metadata: { config: { k: 1 } } },
      b: { id: "b", label: "B", type: "x", parentId: "a", metadata: { config: { k: 2 } } },
    },
  };
  const scopes = collectInheritedScopes(cyclic, "a");
  assertEquals(scopes.length <= 2, true);
});

Deno.test("render names each container and warns about precedence only when it matters", () => {
  const one = renderInheritedContext(collectInheritedScopes(graph, "vpc"));
  assertEquals(one.includes("Acme Prod (AWS)"), true);
  assertEquals(one.includes("primaryRegion: us-east-1"), true);
  assertEquals(one.includes("innermost container wins"), false, "one scope cannot conflict");

  const two = renderInheritedContext(collectInheritedScopes(graph, "svc"));
  assertEquals(two.includes("innermost container wins"), true);
});

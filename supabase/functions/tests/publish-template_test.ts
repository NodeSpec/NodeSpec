// Community publish pipeline (hosted-edition social round). The pure core is
// what stands between a user's project graph — which embeds their generated
// source code in artifacts[].content — and a PUBLIC project_templates row,
// so the sanitizer pins are the ones that matter most here.
import {
  bumpPatchVersion,
  computeTemplateFacts,
  deriveHandleBase,
  graphHasArtifactContent,
  RESERVED_HANDLES,
  sanitizeGraphForPublish,
  sanitizeTemplateSpecification,
  slugifyTemplateName,
  validatePublishFields,
  VALID_TEMPLATE_CATEGORIES,
} from "../_shared/publish-template-core.ts";
import { assert, assertEquals } from "./helpers.ts";

function sampleGraph(): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    schemaVersion: 8,
    version: 3,
    hash: "abc",
    nodes: {
      "22222222-2222-4222-8222-222222222222": {
        id: "22222222-2222-4222-8222-222222222222",
        type: "role.web-frontend",
        label: "Web App",
        technology: "react",
      },
      "33333333-3333-4333-8333-333333333333": {
        id: "33333333-3333-4333-8333-333333333333",
        type: "role.api-service",
        label: "API",
        technology: "fastapi",
      },
      "44444444-4444-4444-8444-444444444444": {
        id: "44444444-4444-4444-8444-444444444444",
        type: "role.database",
        label: "DB",
      },
    },
    edges: {
      "55555555-5555-4555-8555-555555555555": {
        id: "55555555-5555-4555-8555-555555555555",
        source: "22222222-2222-4222-8222-222222222222",
        target: "33333333-3333-4333-8333-333333333333",
        contractId: "66666666-6666-4666-8666-666666666666",
      },
    },
    contracts: {},
    artifacts: {
      "77777777-7777-4777-8777-777777777777": {
        id: "77777777-7777-4777-8777-777777777777",
        nodeId: "33333333-3333-4333-8333-333333333333",
        kind: "source",
        path: "api/main.py",
        language: "python",
        content: "SECRET_KEY = 'do-not-publish-me'",
        contentHash: "deadbeef",
        contentUrl: "https://example.com/private/main.py",
        uri: "git://private-repo/api/main.py",
        sourceProvenance: "repo-import",
        metadata: { privateNote: "internal" },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    },
    sourceContext: { repoUrl: "https://github.com/owner/private-repo" },
  };
}

Deno.test("sanitizeGraphForPublish strips artifact content and provenance but keeps identity", () => {
  const graph = sampleGraph();
  const clean = sanitizeGraphForPublish(graph);

  assert(!graphHasArtifactContent(clean), "sanitized graph still leaks artifact content");
  const artifact = (clean.artifacts as Record<string, Record<string, unknown>>)[
    "77777777-7777-4777-8777-777777777777"
  ];
  assertEquals(artifact.path, "api/main.py");
  assertEquals(artifact.kind, "source");
  assertEquals(artifact.language, "python");
  assertEquals(artifact.nodeId, "33333333-3333-4333-8333-333333333333");
  assert(!("content" in artifact), "content survived sanitize");
  assert(!("contentHash" in artifact), "contentHash survived sanitize");
  assert(!("contentUrl" in artifact), "contentUrl survived sanitize");
  assert(!("uri" in artifact), "uri survived sanitize");
  assert(!("sourceProvenance" in artifact), "sourceProvenance survived sanitize");
  assert(!("metadata" in artifact), "artifact metadata survived sanitize");
  assert(!("sourceContext" in clean), "sourceContext survived sanitize");

  // The input graph must not be mutated (defense-in-depth callers reuse it).
  assert(graphHasArtifactContent(graph), "sanitize mutated its input");
});

Deno.test("computeTemplateFacts counts nodes/edges and collects distinct sorted technologies", () => {
  const facts = computeTemplateFacts(sanitizeGraphForPublish(sampleGraph()));
  assertEquals(facts.nodeCount, 3);
  assertEquals(facts.edgeCount, 1);
  assertEquals(facts.technologies, ["fastapi", "react"]);
});

Deno.test("slugifyTemplateName normalizes and falls back", () => {
  assertEquals(slugifyTemplateName("My SaaS  Starter!"), "my-saas-starter");
  assertEquals(slugifyTemplateName("--Ünicode--"), "nicode");
  assertEquals(slugifyTemplateName("???"), "template");
  const long = slugifyTemplateName("a".repeat(90));
  assert(long.length <= 60, "slug not capped");
});

Deno.test("bumpPatchVersion bumps semver and leaves non-semver alone", () => {
  assertEquals(bumpPatchVersion("1.0.0"), "1.0.1");
  assertEquals(bumpPatchVersion("2.10.19"), "2.10.20");
  assertEquals(bumpPatchVersion("v2"), "v2");
});

Deno.test("validatePublishFields enforces category, tags, and repo host", () => {
  const good = validatePublishFields({
    name: "  My Template  ",
    description: "A starter",
    category: "saas",
    tags: ["react", "react", "  ", "x".repeat(50), "api"],
    repoUrl: "https://github.com/owner/repo",
  });
  assert(good.fields !== undefined, good.errors.join("; "));
  assertEquals(good.fields!.name, "My Template");
  assertEquals(good.fields!.tags, ["react", "api"]);
  assertEquals(good.fields!.repoUrl, "https://github.com/owner/repo");

  const badCategory = validatePublishFields({
    name: "T",
    description: "d",
    category: "not-a-category",
  });
  assert(badCategory.fields === undefined, "invalid category accepted");

  const badHost = validatePublishFields({
    name: "T",
    description: "d",
    category: "general",
    repoUrl: "https://evil.example.com/owner/repo",
  });
  assert(badHost.fields === undefined, "non-github/gitlab host accepted");

  const httpUrl = validatePublishFields({
    name: "T",
    description: "d",
    category: "general",
    repoUrl: "http://github.com/owner/repo",
  });
  assert(httpUrl.fields === undefined, "plain http accepted");

  const noRepo = validatePublishFields({
    name: "T",
    description: "d",
    category: "general",
  });
  assert(noRepo.fields !== undefined, "absent repoUrl should be fine");
  assertEquals(noRepo.fields!.repoUrl, null);
});

Deno.test("category enum matches the project_templates CHECK constraint", () => {
  assertEquals(VALID_TEMPLATE_CATEGORIES.length, 10);
  assert(VALID_TEMPLATE_CATEGORIES.includes("ai-ml"));
  assert(VALID_TEMPLATE_CATEGORIES.includes("general"));
});

Deno.test("sanitizeTemplateSpecification rebuilds structurally and drops requirement metadata", () => {
  const result = sanitizeTemplateSpecification({
    vision: "Ship it",
    preferences: {
      languages: ["typescript", 42],
      frameworks: ["react"],
      architecturePattern: "microservices",
      secretDeployKey: "leak-me",
    },
    requirements: [
      {
        requirementId: "88888888-8888-4888-8888-888888888888",
        name: "Login",
        description: "Users can log in",
        category: "functional",
        acceptanceCriteria: [{ text: "Login form renders" }, "String criterion", { nope: true }],
        metadata: { internalTicket: "JIRA-123" },
      },
    ],
    mappings: [
      {
        requirementId: "88888888-8888-4888-8888-888888888888",
        nodeId: "22222222-2222-4222-8222-222222222222",
        mappingType: "implements",
        confidence: 0.9,
      },
      {
        requirementId: "99999999-9999-4999-8999-999999999999",
        nodeId: "22222222-2222-4222-8222-222222222222",
        mappingType: "implements",
        confidence: 1,
      },
    ],
  });

  assert(result.specification !== undefined, result.errors.join("; "));
  const spec = result.specification!;
  const prefs = spec.preferences as Record<string, unknown>;
  assert(!("secretDeployKey" in prefs), "unknown preference key survived");
  assertEquals(prefs.languages, ["typescript"]);

  const reqs = spec.requirements as Record<string, unknown>[];
  assertEquals(reqs.length, 1);
  assertEquals(reqs[0].metadata, {});
  assertEquals(reqs[0].acceptanceCriteria, [
    { text: "Login form renders" },
    { text: "String criterion" },
  ]);

  // The dangling mapping (unknown requirementId) is dropped, not fatal.
  const maps = spec.mappings as Record<string, unknown>[];
  assertEquals(maps.length, 1);
  assertEquals(maps[0].nodeId, "22222222-2222-4222-8222-222222222222");
});

Deno.test("deriveHandleBase yields valid unreserved handles from any identity", () => {
  const HANDLE = /^[a-z0-9][a-z0-9-]{2,29}$/;
  const cases: Array<[string | null, string | null]> = [
    ["Jane Doe", null],
    [null, "jane.doe@example.com"],
    [null, "x@example.com"],
    [null, "admin@example.com"],
    [null, null],
  ];
  for (const [name, email] of cases) {
    const base = deriveHandleBase(name, email);
    assert(HANDLE.test(base), `invalid handle: ${base}`);
    assert(!RESERVED_HANDLES.has(base), `reserved handle: ${base}`);
    assert(HANDLE.test(`${base}-20`), `suffix overflows: ${base}-20`);
  }
  assertEquals(deriveHandleBase("Jane Doe", null), "jane-doe");
});

Deno.test("sanitizeTemplateSpecification rejects a broken shape", () => {
  const noVision = sanitizeTemplateSpecification({
    preferences: {},
    requirements: [],
    mappings: [],
  });
  assert(noVision.specification === undefined, "missing vision accepted");

  const badRequirements = sanitizeTemplateSpecification({
    vision: "v",
    preferences: {},
    requirements: "nope",
    mappings: [],
  });
  assert(badRequirements.specification === undefined, "non-array requirements accepted");
});

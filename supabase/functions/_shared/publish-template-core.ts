// Pure pipeline pieces for community template publishing (hosted-edition
// social round). Everything here is deterministic and I/O-free so the Deno
// test suite exercises the exact logic the publish-template function runs.
//
// The security-critical piece is sanitizeGraphForPublish: a user's project
// graph embeds their generated source code inside artifacts[].content (and
// hashes/URLs/provenance beside it), and repo imports leave private repo
// context in graph.sourceContext. Publishing puts the graph into a PUBLIC
// row, so those fields must be stripped server-side — the client also
// strips before sending, but the server copy is the one that counts.

export const VALID_TEMPLATE_CATEGORIES = [
  "general",
  "saas",
  "e-commerce",
  "microservices",
  "iot",
  "mobile",
  "data-pipeline",
  "real-time",
  "ai-ml",
  "devops",
] as const;

export type TemplateCategory = (typeof VALID_TEMPLATE_CATEGORIES)[number];

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const ALLOWED_REPO_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
]);

export interface PublishFields {
  name: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  repoUrl: string | null;
}

/** Validate the scalar publish fields; returns normalized values or errors. */
export function validatePublishFields(input: Record<string, unknown>): {
  fields?: PublishFields;
  errors: string[];
} {
  const errors: string[] = [];

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) errors.push("name is required");
  else if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name must be at most ${MAX_NAME_LENGTH} characters`);
  }

  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  if (!description) errors.push("description is required");
  else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
  }

  const category = input.category;
  if (
    typeof category !== "string" ||
    !VALID_TEMPLATE_CATEGORIES.includes(category as TemplateCategory)
  ) {
    errors.push(`category must be one of: ${VALID_TEMPLATE_CATEGORIES.join(", ")}`);
  }

  let tags: string[] = [];
  if (input.tags !== undefined && input.tags !== null) {
    if (!Array.isArray(input.tags)) {
      errors.push("tags must be an array of strings");
    } else {
      const cleaned = input.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH);
      tags = [...new Set(cleaned)].slice(0, MAX_TAGS);
    }
  }

  let repoUrl: string | null = null;
  if (
    input.repoUrl !== undefined &&
    input.repoUrl !== null &&
    input.repoUrl !== ""
  ) {
    if (typeof input.repoUrl !== "string") {
      errors.push("repoUrl must be a string");
    } else {
      try {
        const parsed = new URL(input.repoUrl.trim());
        if (parsed.protocol !== "https:" || !ALLOWED_REPO_HOSTS.has(parsed.hostname)) {
          errors.push("repoUrl must be an https GitHub or GitLab URL");
        } else {
          repoUrl = parsed.toString();
        }
      } catch {
        errors.push("repoUrl must be a valid URL");
      }
    }
  }

  if (errors.length > 0) return { errors };
  return {
    fields: {
      name,
      description,
      category: category as TemplateCategory,
      tags,
      repoUrl,
    },
    errors,
  };
}

/**
 * Strip everything from a graph that could leak the author's private work
 * into the public template row. Artifacts keep their architectural identity
 * (id, nodeId, kind, path, language, type, timestamps, status, description,
 * generatedBy) and lose content, contentHash, contentUrl, uri,
 * sourceProvenance, and free-form metadata. graph.sourceContext (repo-import
 * context: file lists, repo URLs) is dropped entirely.
 *
 * Returns a new object; the input is not mutated.
 */
export function sanitizeGraphForPublish(
  graph: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { ...graph };
  delete sanitized.sourceContext;

  const artifacts = graph.artifacts as Record<string, Record<string, unknown>> | undefined;
  if (artifacts && typeof artifacts === "object") {
    const cleanArtifacts: Record<string, Record<string, unknown>> = {};
    for (const [key, artifact] of Object.entries(artifacts)) {
      if (!artifact || typeof artifact !== "object") continue;
      const {
        content: _content,
        contentHash: _contentHash,
        contentUrl: _contentUrl,
        uri: _uri,
        sourceProvenance: _sourceProvenance,
        metadata: _metadata,
        ...kept
      } = artifact;
      cleanArtifacts[key] = kept;
    }
    sanitized.artifacts = cleanArtifacts;
  }

  return sanitized;
}

/** True when any artifact still carries a leak-prone field (test/assert helper). */
export function graphHasArtifactContent(graph: Record<string, unknown>): boolean {
  const artifacts = graph.artifacts as Record<string, Record<string, unknown>> | undefined;
  if (!artifacts || typeof artifacts !== "object") return false;
  return Object.values(artifacts).some(
    (a) =>
      a &&
      typeof a === "object" &&
      ("content" in a || "contentHash" in a || "contentUrl" in a ||
        "uri" in a || "sourceProvenance" in a)
  );
}

/** Distinct node technologies + counts, computed server-side (display facts). */
export function computeTemplateFacts(graph: Record<string, unknown>): {
  nodeCount: number;
  edgeCount: number;
  technologies: string[];
} {
  const nodes = (graph.nodes ?? {}) as Record<string, Record<string, unknown>>;
  const edges = (graph.edges ?? {}) as Record<string, unknown>;
  const technologies = [
    ...new Set(
      Object.values(nodes)
        .map((n) => (typeof n?.technology === "string" ? n.technology.trim() : ""))
        .filter((t) => t.length > 0)
    ),
  ].sort();
  return {
    nodeCount: Object.keys(nodes).length,
    edgeCount: Object.keys(edges).length,
    technologies,
  };
}

/** Lowercase-hyphen slug from a template name; empty input falls back to "template". */
export function slugifyTemplateName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  return slug || "template";
}

/** Patch-bump a semver string; non-semver input is returned unchanged. */
export function bumpPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return version;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

// Mirrors the user_profiles CHECK constraints (20260815130000) and the
// client's ProfileService.deriveHandleBase — publishing lazily provisions a
// profile so community templates always have an attributable author.
export const RESERVED_HANDLES = new Set([
  "admin", "nodespec", "official", "api", "app", "templates", "blog",
  "pricing", "settings", "support", "u", "www", "root", "moderator",
  "help", "about", "terms", "privacy", "docs", "government",
]);

/** `Jane Doe` / `jane.doe@x.com` → `jane-doe`; satisfies the handle CHECK. */
export function deriveHandleBase(fullName: string | null, email: string | null): string {
  const source = fullName?.trim() || email?.split("@")[0] || "builder";
  let base = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24)
    .replace(/-$/, "");
  if (base.length < 3) base = `${base}xyz`.slice(0, 3);
  if (RESERVED_HANDLES.has(base)) base = `${base}-1`;
  return base;
}

const REQUIREMENT_CATEGORIES = new Set([
  "functional",
  "non-functional",
  "technical",
  "business",
]);
const MAPPING_TYPES = new Set([
  "implements",
  "depends_on",
  "validates",
  "supports",
]);
const PREFERENCE_ARRAY_KEYS = ["languages", "frameworks", "databases"] as const;
const ARCHITECTURE_PATTERNS = new Set([
  "monolith",
  "microservices",
  "serverless",
  "unknown",
]);

/**
 * Structurally rebuild a template specification, copying ONLY known fields —
 * a whitelist by construction. Free-form requirement metadata is dropped
 * (leak hygiene: it can carry anything from the source project); acceptance
 * criteria are reduced to their text. Returns errors when the overall shape
 * is wrong; unknown keys are silently discarded, not errors.
 */
export function sanitizeTemplateSpecification(
  spec: Record<string, unknown>
): { specification?: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];

  const vision = typeof spec.vision === "string" ? spec.vision.trim() : "";
  if (!vision) errors.push("templateSpecification.vision is required");

  const rawPrefs = spec.preferences;
  if (!rawPrefs || typeof rawPrefs !== "object" || Array.isArray(rawPrefs)) {
    errors.push("templateSpecification.preferences must be an object");
  }
  if (!Array.isArray(spec.requirements)) {
    errors.push("templateSpecification.requirements must be an array");
  }
  if (!Array.isArray(spec.mappings)) {
    errors.push("templateSpecification.mappings must be an array");
  }
  if (errors.length > 0) return { errors };

  const prefsIn = rawPrefs as Record<string, unknown>;
  const preferences: Record<string, unknown> = {};
  for (const key of PREFERENCE_ARRAY_KEYS) {
    const value = prefsIn[key];
    if (Array.isArray(value)) {
      preferences[key] = value.filter((v): v is string => typeof v === "string");
    }
  }
  if (typeof prefsIn.deploymentTarget === "string") {
    preferences.deploymentTarget = prefsIn.deploymentTarget;
  }
  if (
    typeof prefsIn.architecturePattern === "string" &&
    ARCHITECTURE_PATTERNS.has(prefsIn.architecturePattern)
  ) {
    preferences.architecturePattern = prefsIn.architecturePattern;
  }

  const requirements: Record<string, unknown>[] = [];
  for (const raw of spec.requirements as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const req = raw as Record<string, unknown>;
    if (
      typeof req.requirementId !== "string" ||
      typeof req.name !== "string" ||
      req.name.trim().length === 0
    ) {
      errors.push("each requirement needs requirementId and name");
      continue;
    }
    const category =
      typeof req.category === "string" && REQUIREMENT_CATEGORIES.has(req.category)
        ? req.category
        : "functional";
    const criteria = Array.isArray(req.acceptanceCriteria)
      ? (req.acceptanceCriteria as unknown[])
          .map((c) => {
            if (typeof c === "string") return { text: c };
            if (c && typeof c === "object" && typeof (c as Record<string, unknown>).text === "string") {
              return { text: (c as Record<string, unknown>).text as string };
            }
            return null;
          })
          .filter((c): c is { text: string } => c !== null && c.text.trim().length > 0)
      : [];
    requirements.push({
      requirementId: req.requirementId,
      name: req.name.trim(),
      description: typeof req.description === "string" ? req.description : "",
      category,
      acceptanceCriteria: criteria,
      metadata: {},
    });
  }

  const requirementIds = new Set(requirements.map((r) => r.requirementId as string));
  const mappings: Record<string, unknown>[] = [];
  for (const raw of spec.mappings as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const map = raw as Record<string, unknown>;
    if (
      typeof map.requirementId !== "string" ||
      typeof map.nodeId !== "string" ||
      !requirementIds.has(map.requirementId)
    ) {
      continue; // dangling mappings are dropped, not fatal
    }
    const mappingType =
      typeof map.mappingType === "string" && MAPPING_TYPES.has(map.mappingType)
        ? map.mappingType
        : "implements";
    const confidence =
      typeof map.confidence === "number" && map.confidence >= 0 && map.confidence <= 1
        ? map.confidence
        : 1;
    const entry: Record<string, unknown> = {
      requirementId: map.requirementId,
      nodeId: map.nodeId,
      mappingType,
      confidence,
    };
    if (typeof map.notes === "string" && map.notes.trim().length > 0) {
      entry.notes = map.notes.trim();
    }
    mappings.push(entry);
  }

  if (errors.length > 0) return { errors };
  return {
    specification: { vision, preferences, requirements, mappings },
    errors,
  };
}

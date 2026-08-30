import { PALETTE_CATEGORIES } from "../_shared/palette-categories.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { loadCatalogs, CatalogData } from "../_shared/catalog-loader.ts";
import { validateGraphData } from "../_shared/graph-schema.ts";
import {
  CONTRACT_KIND_VALUES,
  INTERACTION_KIND_VALUES,
  TRANSPORT_KIND_VALUES,
  SPEC_FORMAT_VALUES,
  PLACEMENT_KIND_VALUES,
  ARTIFACT_KIND_VALUES,
  ENTITY_STATUS_VALUES,
  EDGE_DIRECTION_VALUES,
  EDGE_CRITICALITY_VALUES,
} from "../_shared/enums.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

const VALID_CATEGORIES = [
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

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface MCPRequest {
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

// ─── Auth ───────────────────────────────────────────────────────────────────

async function authenticateAdmin(
  req: Request
): Promise<{ userId: string; supabase: SupabaseClient } | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    return errorResponse("Server configuration missing", 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse("Authentication required", 401);
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return errorResponse("Invalid authentication token", 401);
  }

  const isAdmin = user.app_metadata?.is_admin === true;
  if (!isAdmin) {
    return errorResponse("Admin access required", 403);
  }

  return { userId: user.id, supabase };
}

// ─── Tool: get_template_authoring_context ───────────────────────────────────

async function handleGetTemplateAuthoringContext(
  supabase: SupabaseClient
): Promise<Response> {
  const catalogs: CatalogData = await loadCatalogs(supabase);

  const nodeRoleSummary = Object.values(catalogs.nodeRoles).map((r) => ({
    id: r.id,
    label: r.label,
    nature: r.nature,
    description: r.description,
    isContainer: r.is_container,
    containerLayer: r.container_layer,
    paletteCategory: r.palette_category,
    defaultPorts: r.default_ports,
    suggestedContracts: r.suggested_contracts,
    capabilityTags: r.capability_tags,
    defaultTechnology: r.default_technology,
  }));

  const technologySummary = Object.values(catalogs.technologies).map((t) => ({
    id: t.id,
    name: t.name,
    displayName: t.display_name,
    roleAffinities: t.role_affinities,
    commonConnections: t.common_connections,
    suggestedFiles: t.suggested_files,
    aiContext: t.ai_context,
  }));

  const deploymentTargetSummary = Object.values(
    catalogs.deploymentTargets
  ).map((d) => ({
    id: d.id,
    label: d.label,
    description: d.description,
    compatibleRoles: d.compatible_roles,
  }));

  const scopeArchetypeSummary = Object.values(catalogs.scopeArchetypes).map(
    (s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      specGuidance: s.spec_guidance,
      architectureGuidance: s.architecture_guidance,
      relevantCategories: s.relevant_categories,
      requirementCountRange: s.requirement_count_range,
    })
  );

  const context = {
    enums: {
      contractKinds: CONTRACT_KIND_VALUES,
      interactionKinds: INTERACTION_KIND_VALUES,
      transportKinds: TRANSPORT_KIND_VALUES,
      specFormats: SPEC_FORMAT_VALUES,
      placementKinds: PLACEMENT_KIND_VALUES,
      artifactKinds: ARTIFACT_KIND_VALUES,
      entityStatuses: ENTITY_STATUS_VALUES,
      edgeDirections: EDGE_DIRECTION_VALUES,
      edgeCriticalities: EDGE_CRITICALITY_VALUES,
    },
    validCategories: VALID_CATEGORIES,
    nodeRoles: nodeRoleSummary,
    technologies: technologySummary,
    deploymentTargets: deploymentTargetSummary,
    scopeArchetypes: scopeArchetypeSummary,
    cloudProviderPatterns: catalogs.cloudProviderPatterns,
    // M2: from the shared vocabulary module — the palette_categories table is gone.
    paletteCategories: PALETTE_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    graphDataSchema: {
      description:
        "Graph data must conform to GraphDataSchema. Key requirements: all IDs are UUIDs, nodes/edges/contracts/artifacts are Record<string, Object>, schemaVersion is positive integer, version is non-negative integer, hash is a string.",
      requiredTopLevelFields: [
        "id",
        "schemaVersion",
        "version",
        "hash",
        "nodes",
        "edges",
        "contracts",
        "artifacts",
      ],
      nodeFields:
        "id, type (must match a node_role id), label, technology?, deploymentTarget?, ports?, data?, artifacts?, metadata?, status?, parentId?, placementKind?",
      edgeFields:
        "id, source (node uuid), target (node uuid), sourcePortId?, targetPortId?, contractId (must reference a contract), label?, metadata?, direction?, criticality?",
      contractFields:
        "id, kind (from contractKinds), interactionKind?, transport?, specFormat?, name, schema?, schemaRef?, metadata?, status?",
      artifactFields:
        "id, nodeId (node uuid or empty string), kind (from artifactKinds), path, content?, contentHash?, language?, type?, uri?, createdAt, updatedAt, metadata?, status?, description?, generatedBy?, sourceProvenance?, contentUrl?",
    },
    templateSpecificationSchema: {
      description:
        "Optional but recommended. Provides vision, preferences, requirements, and mappings.",
      fields: {
        vision: "string - project vision statement",
        preferences:
          "{ languages?: string[], frameworks?: string[], databases?: string[], deploymentTarget?: string, architecturePattern?: 'monolith'|'microservices'|'serverless'|'unknown' }",
        requirements:
          "Array<{ requirementId: string(uuid), name: string, description: string, category: 'functional'|'non-functional'|'technical'|'business', acceptanceCriteria: Array<{text: string}>, metadata: Record<string,unknown> }>",
        mappings:
          "Array<{ requirementId: string(uuid), nodeId: string(uuid), mappingType: 'implements'|'depends_on'|'validates'|'supports', confidence: number(0-1), notes?: string }>",
      },
    },
  };

  return jsonResponse({
    result: context,
  });
}

// ─── Tool: validate_template ────────────────────────────────────────────────

function handleValidateTemplate(args: Record<string, unknown>): Response {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { name, slug, description, category, graph_data, template_specification, tags, technologies } = args;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    errors.push("name is required and must be a non-empty string");
  }

  if (!slug || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
    errors.push(
      "slug is required and must contain only lowercase letters, numbers, and hyphens"
    );
  }

  if (!description || typeof description !== "string") {
    errors.push("description is required");
  }

  if (!category || !VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
    errors.push(
      `category must be one of: ${VALID_CATEGORIES.join(", ")}`
    );
  }

  if (!graph_data || typeof graph_data !== "object") {
    errors.push("graph_data is required and must be an object");
  } else {
    const validation = validateGraphData(graph_data);
    if (!validation.valid && validation.errors) {
      errors.push(...validation.errors.map((e) => `graph_data: ${e}`));
    }
  }

  if (template_specification !== undefined && template_specification !== null) {
    const spec = template_specification as Record<string, unknown>;
    if (typeof spec.vision !== "string" || spec.vision.trim().length === 0) {
      errors.push("template_specification.vision is required when spec is provided");
    }
    if (!spec.preferences || typeof spec.preferences !== "object") {
      errors.push("template_specification.preferences is required");
    }
    if (!Array.isArray(spec.requirements)) {
      errors.push("template_specification.requirements must be an array");
    }
    if (!Array.isArray(spec.mappings)) {
      errors.push("template_specification.mappings must be an array");
    }
  } else {
    warnings.push(
      "template_specification is null - template will have no requirements/mappings"
    );
  }

  if (tags !== undefined && !Array.isArray(tags)) {
    errors.push("tags must be an array of strings");
  }
  if (technologies !== undefined && !Array.isArray(technologies)) {
    errors.push("technologies must be an array of strings");
  }

  return jsonResponse({
    result: {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  });
}

// ─── Tool: publish_template ─────────────────────────────────────────────────

async function handlePublishTemplate(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>
): Promise<Response> {
  const {
    name,
    slug,
    description,
    category,
    graph_data,
    template_specification,
    tags,
    technologies,
    thumbnail_url,
    is_public,
    is_featured,
    version,
  } = args;

  if (
    !name ||
    !slug ||
    !category ||
    !graph_data ||
    typeof graph_data !== "object"
  ) {
    return errorResponse(
      "name, slug, category, and graph_data are required"
    );
  }

  if (!/^[a-z0-9-]+$/.test(slug as string)) {
    return errorResponse(
      "slug must contain only lowercase letters, numbers, and hyphens"
    );
  }

  const validation = validateGraphData(graph_data);
  if (!validation.valid) {
    return errorResponse(
      `Invalid graph_data: ${validation.errors?.join("; ")}`
    );
  }

  const graphObj = graph_data as Record<string, unknown>;
  const nodeCount = Object.keys(
    (graphObj.nodes as Record<string, unknown>) || {}
  ).length;
  const edgeCount = Object.keys(
    (graphObj.edges as Record<string, unknown>) || {}
  ).length;

  const { data, error } = await supabase
    .from("project_templates")
    .insert({
      name,
      slug,
      description: description || "",
      category,
      graph_data,
      template_specification: template_specification || null,
      tags: tags || [],
      technologies: technologies || [],
      thumbnail_url: thumbnail_url || null,
      node_count: nodeCount,
      edge_count: edgeCount,
      author_type: "official",
      author_id: userId,
      is_public: is_public !== false,
      is_featured: is_featured === true,
      version: version || "1.0.0",
    })
    .select("id, slug, name, category, node_count, edge_count, is_public, is_featured, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return errorResponse(
        `A template with slug "${slug}" already exists. Use update_template instead.`,
        409
      );
    }
    return errorResponse(`Database error: ${error.message}`, 500);
  }

  return jsonResponse({ result: { published: true, template: data } });
}

// ─── Tool: update_template ──────────────────────────────────────────────────

async function handleUpdateTemplate(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<Response> {
  const { id, slug: lookupSlug, ...updates } = args;

  if (!id && !lookupSlug) {
    return errorResponse("Either id or slug is required to identify the template");
  }

  let query = supabase.from("project_templates").select("id, slug").limit(1);
  if (id) {
    query = query.eq("id", id);
  } else {
    query = query.eq("slug", lookupSlug);
  }

  const { data: existing, error: lookupError } = await query.maybeSingle();
  if (lookupError) {
    return errorResponse(`Lookup error: ${lookupError.message}`, 500);
  }
  if (!existing) {
    return errorResponse("Template not found", 404);
  }

  const allowedFields = [
    "name",
    "description",
    "category",
    "graph_data",
    "template_specification",
    "tags",
    "technologies",
    "thumbnail_url",
    "is_public",
    "is_featured",
    "version",
  ];

  const updatePayload: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in updates) {
      updatePayload[field] = updates[field];
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return errorResponse("No valid fields to update");
  }

  if (updatePayload.graph_data) {
    const validation = validateGraphData(updatePayload.graph_data);
    if (!validation.valid) {
      return errorResponse(
        `Invalid graph_data: ${validation.errors?.join("; ")}`
      );
    }
    const graphObj = updatePayload.graph_data as Record<string, unknown>;
    updatePayload.node_count = Object.keys(
      (graphObj.nodes as Record<string, unknown>) || {}
    ).length;
    updatePayload.edge_count = Object.keys(
      (graphObj.edges as Record<string, unknown>) || {}
    ).length;
  }

  if (
    updatePayload.category &&
    !VALID_CATEGORIES.includes(updatePayload.category as typeof VALID_CATEGORIES[number])
  ) {
    return errorResponse(
      `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`
    );
  }

  updatePayload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("project_templates")
    .update(updatePayload)
    .eq("id", existing.id)
    .select("id, slug, name, category, node_count, edge_count, is_public, is_featured, updated_at")
    .single();

  if (error) {
    return errorResponse(`Update failed: ${error.message}`, 500);
  }

  return jsonResponse({ result: { updated: true, template: data } });
}

// ─── Tool: list_templates_admin ─────────────────────────────────────────────

async function handleListTemplatesAdmin(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<Response> {
  const { category, author_type, is_public, limit: rawLimit, offset: rawOffset } = args;

  let query = supabase
    .from("project_templates")
    .select(
      "id, name, slug, description, category, tags, technologies, node_count, edge_count, author_type, author_id, is_public, is_featured, use_count, upvote_count, version, created_at, updated_at"
    );

  if (category) {
    query = query.eq("category", category);
  }
  if (author_type) {
    query = query.eq("author_type", author_type);
  }
  if (is_public !== undefined) {
    query = query.eq("is_public", is_public);
  }

  const limit = typeof rawLimit === "number" ? Math.min(rawLimit, 100) : 50;
  const offset = typeof rawOffset === "number" ? rawOffset : 0;

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return errorResponse(`Query failed: ${error.message}`, 500);
  }

  return jsonResponse({
    result: {
      templates: data,
      count: data?.length ?? 0,
      offset,
      limit,
    },
  });
}

// ─── Tool: delete_template ──────────────────────────────────────────────────

async function handleDeleteTemplate(
  supabase: SupabaseClient,
  args: Record<string, unknown>
): Promise<Response> {
  const { id, slug: lookupSlug } = args;

  if (!id && !lookupSlug) {
    return errorResponse("Either id or slug is required");
  }

  let query = supabase.from("project_templates").select("id, slug, name").limit(1);
  if (id) {
    query = query.eq("id", id);
  } else {
    query = query.eq("slug", lookupSlug);
  }

  const { data: existing, error: lookupError } = await query.maybeSingle();
  if (lookupError) {
    return errorResponse(`Lookup error: ${lookupError.message}`, 500);
  }
  if (!existing) {
    return errorResponse("Template not found", 404);
  }

  // Delete related usage records first
  await supabase.from("template_usage").delete().eq("template_id", existing.id);

  // Delete upvotes if table exists
  await supabase.from("template_upvotes").delete().eq("template_id", existing.id);

  const { error } = await supabase
    .from("project_templates")
    .delete()
    .eq("id", existing.id);

  if (error) {
    return errorResponse(`Delete failed: ${error.message}`, 500);
  }

  return jsonResponse({
    result: { deleted: true, template: { id: existing.id, slug: existing.slug, name: existing.name } },
  });
}

// ─── Tool definitions for tools/list ────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: "get_template_authoring_context",
    description:
      "Returns the full catalog context needed for template authoring: node roles, technologies, deployment targets, scope archetypes, cloud provider patterns, enum values, and schema documentation. Call this first to understand the domain before creating templates.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "validate_template",
    description:
      "Validates a template payload against all constraints before publishing. Returns detailed errors and warnings. Use this to check your template before calling publish_template.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Template display name" },
        slug: {
          type: "string",
          description: "URL-friendly identifier (lowercase, hyphens only)",
        },
        description: { type: "string", description: "Full template description" },
        category: {
          type: "string",
          enum: VALID_CATEGORIES,
          description: "Template category",
        },
        graph_data: {
          type: "object",
          description: "Full graph data object conforming to GraphDataSchema",
        },
        template_specification: {
          type: "object",
          description:
            "Optional specification with vision, preferences, requirements, and mappings",
          nullable: true,
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Array of tags",
        },
        technologies: {
          type: "array",
          items: { type: "string" },
          description: "Array of technology catalog IDs",
        },
      },
      required: ["name", "slug", "category", "graph_data"],
    },
  },
  {
    name: "publish_template",
    description:
      "Publishes a new template to the marketplace with author_type='official'. Validates graph_data against schema, computes node/edge counts, and inserts into database. Returns the created template record.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Template display name" },
        slug: {
          type: "string",
          description: "URL-friendly identifier (lowercase, hyphens only)",
        },
        description: { type: "string", description: "Full template description" },
        category: {
          type: "string",
          enum: VALID_CATEGORIES,
          description: "Template category",
        },
        graph_data: {
          type: "object",
          description: "Full graph data object conforming to GraphDataSchema",
        },
        template_specification: {
          type: "object",
          description: "Optional specification object",
          nullable: true,
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Array of tags",
        },
        technologies: {
          type: "array",
          items: { type: "string" },
          description: "Array of technology catalog IDs",
        },
        thumbnail_url: {
          type: "string",
          description: "Optional preview image URL",
          nullable: true,
        },
        is_public: {
          type: "boolean",
          description: "Whether template is publicly visible (default: true)",
        },
        is_featured: {
          type: "boolean",
          description: "Whether template is featured (default: false)",
        },
        version: {
          type: "string",
          description: "Version string (default: '1.0.0')",
        },
      },
      required: ["name", "slug", "category", "graph_data"],
    },
  },
  {
    name: "update_template",
    description:
      "Updates an existing template by id or slug. Only provided fields are modified. If graph_data is updated, it is re-validated and counts are recomputed.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template UUID (alternative to slug)" },
        slug: {
          type: "string",
          description: "Template slug (alternative to id)",
        },
        name: { type: "string" },
        description: { type: "string" },
        category: { type: "string", enum: VALID_CATEGORIES },
        graph_data: { type: "object" },
        template_specification: { type: "object", nullable: true },
        tags: { type: "array", items: { type: "string" } },
        technologies: { type: "array", items: { type: "string" } },
        thumbnail_url: { type: "string", nullable: true },
        is_public: { type: "boolean" },
        is_featured: { type: "boolean" },
        version: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "list_templates_admin",
    description:
      "Lists all templates with optional filters. Returns metadata without graph_data for efficiency.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: VALID_CATEGORIES },
        author_type: { type: "string", enum: ["official", "community"] },
        is_public: { type: "boolean" },
        limit: {
          type: "number",
          description: "Max results (default 50, max 100)",
        },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: [],
    },
  },
  {
    name: "delete_template",
    description:
      "Permanently deletes a template and its associated usage/upvote records. Identify by id or slug.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template UUID" },
        slug: { type: "string", description: "Template slug" },
      },
      required: [],
    },
  },
];

// ─── MCP Protocol Router ────────────────────────────────────────────────────

async function handleMCPRequest(
  mcpReq: MCPRequest,
  supabase: SupabaseClient,
  userId: string
): Promise<Response> {
  switch (mcpReq.method) {
    case "initialize":
      return jsonResponse({
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "nodespec-admin-template",
          version: "1.0.0",
        },
      });

    case "tools/list":
      return jsonResponse({ tools: TOOL_DEFINITIONS });

    case "tools/call": {
      const toolName = mcpReq.params?.name;
      const toolArgs = mcpReq.params?.arguments || {};

      switch (toolName) {
        case "get_template_authoring_context":
          return await handleGetTemplateAuthoringContext(supabase);
        case "validate_template":
          return handleValidateTemplate(toolArgs);
        case "publish_template":
          return await handlePublishTemplate(supabase, userId, toolArgs);
        case "update_template":
          return await handleUpdateTemplate(supabase, toolArgs);
        case "list_templates_admin":
          return await handleListTemplatesAdmin(supabase, toolArgs);
        case "delete_template":
          return await handleDeleteTemplate(supabase, toolArgs);
        default:
          return errorResponse(`Unknown tool: ${toolName}`, 404);
      }
    }

    default:
      return errorResponse(`Unknown method: ${mcpReq.method}`, 404);
  }
}

// ─── Entry Point ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const authResult = await authenticateAdmin(req);
    if (authResult instanceof Response) {
      return authResult;
    }

    const { userId, supabase } = authResult;
    const body = await req.json();

    return await handleMCPRequest(body, supabase, userId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("mcp-admin-template error:", err);
    return errorResponse(message, 500);
  }
});

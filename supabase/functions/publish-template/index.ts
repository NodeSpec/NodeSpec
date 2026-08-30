// Community template publishing (hosted-edition social round).
//
// The publish flow runs through this function rather than a direct PostgREST
// insert because the server must never trust the client's copy of the graph:
// artifacts embed the user's generated source code, and repo imports leave
// private repo context behind. This function strips those server-side,
// computes the display facts (counts, technologies), owns slug generation
// and collision handling, and — on the hosted site — pings the Netlify build
// hook so the prerendered share pages regenerate within minutes.
//
// Auth: gateway-verified JWT (default verify_jwt; deliberately NO
// config.toml exemption) + supabase.auth.getUser, then authorship enforced
// in code. Uses the service-role client because column-level UPDATE grants
// (20260815110000) fence `authenticated` off counters this function must
// still recompute (node_count/edge_count on republish).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { validateGraphData } from "../_shared/graph-schema.ts";
import {
  bumpPatchVersion,
  computeTemplateFacts,
  deriveHandleBase,
  sanitizeGraphForPublish,
  sanitizeTemplateSpecification,
  slugifyTemplateName,
  validatePublishFields,
} from "../_shared/publish-template-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

interface AuthedUser {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
}

async function authenticate(
  req: Request
): Promise<{ user: AuthedUser; supabase: SupabaseClient } | Response> {
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
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      fullName:
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        null,
      avatarUrl:
        (typeof meta.avatar_url === "string" && meta.avatar_url) ||
        (typeof meta.picture === "string" && meta.picture) ||
        null,
    },
    supabase,
  };
}

/**
 * Lazy author-profile provisioning: community templates should always have
 * an attributable author page, so a first publish seeds user_profiles from
 * OAuth metadata. Best-effort — a profile failure never blocks a publish.
 */
async function ensureAuthorProfile(
  supabase: SupabaseClient,
  user: AuthedUser
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("user_profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) return;

    const base = deriveHandleBase(user.fullName, user.email);
    for (let attempt = 1; attempt <= 20; attempt++) {
      const handle = attempt === 1 ? base : `${base}-${attempt}`;
      const { error } = await supabase.from("user_profiles").insert({
        user_id: user.id,
        handle,
        display_name: user.fullName,
        avatar_url: user.avatarUrl,
      });
      if (!error) return;
      if (error.code !== "23505") return; // CHECK/other failure — give up quietly
    }
  } catch {
    // Never let profile provisioning break a publish.
  }
}

/** Base slug, then -2, -3, … until free; 409s after 20 tries. */
async function resolveFreeSlug(
  supabase: SupabaseClient,
  baseSlug: string
): Promise<string | Response> {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const candidate = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const { data, error } = await supabase
      .from("project_templates")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (error) return errorResponse(`Slug lookup failed: ${error.message}`, 500);
    if (!data) return candidate;
  }
  return errorResponse(
    "Could not find a free slug for this template name; try a different name",
    409
  );
}

function fireBuildHook(): void {
  const hook = Deno.env.get("NETLIFY_BUILD_HOOK_URL");
  if (!hook) return; // local / self-hosted: no hook configured, publish still succeeds
  fetch(hook, { method: "POST" }).catch((err) => {
    console.warn("Netlify build hook failed (non-fatal):", err?.message ?? err);
  });
}

const TEMPLATE_RETURN_COLUMNS =
  "id, slug, name, category, version, node_count, edge_count, is_public, created_at, updated_at";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { user, supabase } = auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const mode = body.mode === "update" ? "update" : "create";

  const fieldCheck = validatePublishFields(body);
  if (!fieldCheck.fields) {
    return errorResponse(fieldCheck.errors.join("; "));
  }
  const { name, description, category, tags, repoUrl } = fieldCheck.fields;

  const graphData = body.graphData;
  if (!graphData || typeof graphData !== "object" || Array.isArray(graphData)) {
    return errorResponse("graphData is required and must be an object");
  }
  const validation = validateGraphData(graphData);
  if (!validation.valid) {
    return errorResponse(`Invalid graphData: ${validation.errors?.join("; ")}`);
  }

  // Server-side strip is authoritative — the client also strips, but a
  // hand-rolled request must not be able to publish source code.
  const publishGraph = sanitizeGraphForPublish(graphData as Record<string, unknown>);
  const facts = computeTemplateFacts(publishGraph);
  if (facts.nodeCount === 0) {
    return errorResponse("Cannot publish an empty architecture");
  }

  let templateSpecification: Record<string, unknown> | null = null;
  if (body.templateSpecification !== undefined && body.templateSpecification !== null) {
    const spec = body.templateSpecification;
    if (typeof spec !== "object" || Array.isArray(spec)) {
      return errorResponse("templateSpecification must be an object");
    }
    const specCheck = sanitizeTemplateSpecification(spec as Record<string, unknown>);
    if (!specCheck.specification) {
      return errorResponse(specCheck.errors.join("; "));
    }
    templateSpecification = specCheck.specification;
  }

  const explicitVersion =
    typeof body.version === "string" && /^\d+\.\d+\.\d+$/.test(body.version.trim())
      ? body.version.trim()
      : null;

  if (mode === "create") {
    const slug = await resolveFreeSlug(supabase, slugifyTemplateName(name));
    if (slug instanceof Response) return slug;

    const { data, error } = await supabase
      .from("project_templates")
      .insert({
        name,
        slug,
        description,
        category,
        graph_data: publishGraph,
        template_specification: templateSpecification,
        tags,
        technologies: facts.technologies,
        repo_url: repoUrl,
        node_count: facts.nodeCount,
        edge_count: facts.edgeCount,
        author_type: "community",
        author_id: user.id,
        is_public: true,
        is_featured: false,
        version: explicitVersion ?? "1.0.0",
      })
      .select(TEMPLATE_RETURN_COLUMNS)
      .single();

    if (error) {
      return errorResponse(`Publish failed: ${error.message}`, 500);
    }
    await ensureAuthorProfile(supabase, user);
    fireBuildHook();
    return jsonResponse({ template: data });
  }

  // mode === 'update'
  const templateId = body.templateId;
  if (typeof templateId !== "string" || templateId.length === 0) {
    return errorResponse("templateId is required for update");
  }
  const { data: existing, error: lookupError } = await supabase
    .from("project_templates")
    .select("id, author_id, author_type, version")
    .eq("id", templateId)
    .maybeSingle();
  if (lookupError) {
    return errorResponse(`Template lookup failed: ${lookupError.message}`, 500);
  }
  if (!existing) {
    return errorResponse("Template not found", 404);
  }
  if (existing.author_id !== user.id || existing.author_type !== "community") {
    return errorResponse("You can only update your own community templates", 403);
  }

  const { data, error } = await supabase
    .from("project_templates")
    .update({
      name,
      description,
      category,
      graph_data: publishGraph,
      template_specification: templateSpecification,
      tags,
      technologies: facts.technologies,
      repo_url: repoUrl,
      node_count: facts.nodeCount,
      edge_count: facts.edgeCount,
      version: explicitVersion ?? bumpPatchVersion(existing.version ?? "1.0.0"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId)
    .select(TEMPLATE_RETURN_COLUMNS)
    .single();

  if (error) {
    return errorResponse(`Update failed: ${error.message}`, 500);
  }
  fireBuildHook();
  return jsonResponse({ template: data });
});

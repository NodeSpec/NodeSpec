// N3.6: catalog discovery for the EXTERNAL AI — the missing read lane. Until now the 23
// MCP tools carried zero catalog listing/search: external AIs designed blind and leaned on
// silent normalization. These two READ tools expose the same retrieval the internal agent
// had (weighted FTS on technology_catalog + in-memory role match), now via
// _shared/catalog-search.ts (extracted so it survives the D-series deletion of the
// internal loop). Results carry when_to_use + the plain-language nature line — the
// signals for good architecture recommendations.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { loadCatalogs } from "../../_shared/catalog-loader.ts";
import { ownersCarryingSeats } from "../../_shared/deployment.ts";
import { searchCatalog } from "../../_shared/catalog-search.ts";
import { lookupCatalog } from "../../_shared/role-registry.ts";
import { wrapUntrusted } from "../../_shared/untrusted-data.ts";
import { checkScope } from "../shared.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";

export async function handleSearchCatalog(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { query: string; max_results?: number },
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }
  const query = String(args.query ?? '').trim();
  if (query.length < 2) {
    return { success: false, error: 'query must be at least 2 characters' };
  }

  const catalogs = await loadCatalogs(supabase);
  const result = await searchCatalog(supabase, catalogs, query, args.max_results ?? 10);
  if (!result.success) return { success: false, error: result.error };

  return {
    success: true,
    data: {
      ...result.data,
      // N3.7: THE single vocabulary legend. Reason and propose with the enums; the
      // `description` field is a human gloss — never echo it as a category.
      guidance: 'Use role ids as node `type` and technology ids as node `technology` in propose_patches. ' +
        'Vocabulary (enums are authoritative): treatment: leaf = you author its code; boundary = you configure/call it, NEVER author its internals; container = it holds other nodes, and each role\'s `holds` line says how (runs = hosts them, places = they name it in their configuration, groups = organization only) and what it may hold. ' +
        'ownership — build (yours) | rent (managed, provider runs it) | call (external, consumed by contract) | host (platform hosting other nodes). ' +
        'configMode — definition-as-code (its definition is a repo file, e.g. workflows/DAGs) | declarative (IaC provisioning) | external (console-configured; connection config only). ' +
        'The `description` field is a human-readable gloss of these enums — do not treat it as a separate category. ' +
        'Provider-branded managed services (technology ids prefixed aws-/azure-/gcp-/supabase-/firebase-/cloudflare-) belong INSIDE their provider platform node (role id = the provider, e.g. `aws`) — parent them there, creating the platform node first if absent. ' +
        'Logical groups (application-module, bounded-context, microservice-boundary, software-layer) are OPTIONAL organization: nothing runs in them. A node has one parent; a group whose nodes all run on one host sits inside that host. Do not nest nodes in groups unless the user models it that way. ' +
        'If nothing fits, the user can define a custom node in the app — do not invent catalog ids.',
    },
  };
}

export async function handleLookupCatalog(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { role_id?: string; technology_id?: string; category?: string },
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }
  const roleId = args.role_id?.trim();
  const technologyId = args.technology_id?.trim();
  const category = args.category?.trim();
  if (!roleId && !technologyId && !category) {
    return { success: false, error: 'Provide at least one of: role_id, technology_id, category' };
  }

  const catalogs = await loadCatalogs(supabase, { projectIds: await callerProjectIds(supabase, auth.userId) });
  const detail = lookupCatalog(catalogs, { roleId, technologyId, category });

  // P0-7: user-contributed technology rows carry user-authored text — envelope them.
  const tech = technologyId ? catalogs.technologies[technologyId.toLowerCase()] : undefined;
  const isUserContributed = Boolean(tech?.is_user_contributed);

  return {
    success: true,
    data: {
      catalog: isUserContributed ? wrapUntrusted(detail) : detail,
      userContributed: isUserContributed,
    },
  };
}

/** AG.6c (2026-09-28): the projects whose custom technology rows this caller may read:
 * the ones they own, and the ones they hold a seat on while the owner's plan carries
 * seats (decision 1). The server reads with the service role, so without this a lookup
 * by id returned any project's custom row. */
async function callerProjectIds(supabase: SupabaseClient, userId: string | undefined): Promise<string[]> {
  if (!userId) return [];
  const [{ data: owned }, { data: seats }] = await Promise.all([
    supabase.from('projects').select('id').eq('owner_id', userId),
    supabase.from('project_members').select('projects!inner(id, owner_id)').eq('user_id', userId),
  ]);
  const seatProjects = ((seats ?? []) as unknown as Array<{ projects: { id: string; owner_id: string } | null }>)
    .map((r) => r.projects).filter((p): p is { id: string; owner_id: string } => !!p);
  const carried = seatProjects.length > 0 ? await ownersCarryingSeats(supabase, seatProjects.map((p) => p.owner_id)) : new Map();
  return [
    ...((owned ?? []) as Array<{ id: string }>).map((p) => p.id),
    ...seatProjects.filter((p) => carried.has(p.owner_id)).map((p) => p.id),
  ];
}

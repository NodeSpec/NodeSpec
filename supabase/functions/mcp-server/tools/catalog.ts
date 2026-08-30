// N3.6: catalog discovery for the EXTERNAL AI — the missing read lane. Until now the 23
// MCP tools carried zero catalog listing/search: external AIs designed blind and leaned on
// silent normalization. These two READ tools expose the same retrieval the internal agent
// had (weighted FTS on technology_catalog + in-memory role match), now via
// _shared/catalog-search.ts (extracted so it survives the D-series deletion of the
// internal loop). Results carry when_to_use + the plain-language nature line — the
// signals for good architecture recommendations.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { loadCatalogs } from "../../_shared/catalog-loader.ts";
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
        'Vocabulary (enums are authoritative): treatment — leaf = you author its code; boundary = you configure/call it, NEVER author its internals; container = structural grouping. ' +
        'ownership — build (yours) | rent (managed, provider runs it) | call (external, consumed by contract) | host (platform hosting other nodes). ' +
        'configMode — definition-as-code (its definition is a repo file, e.g. workflows/DAGs) | declarative (IaC provisioning) | external (console-configured; connection config only). ' +
        'The `description` field is a human-readable gloss of these enums — do not treat it as a separate category. ' +
        'Provider-branded managed services (technology ids prefixed aws-/azure-/gcp-/supabase-/firebase-/cloudflare-) belong INSIDE their provider platform node (role id = the provider, e.g. `aws`) — parent them there, creating the platform node first if absent. ' +
        'Logical groups (container roles with style logical-boundary: application-module, bounded-context, …) are OPTIONAL organization — nothing runs in them, and a node’s parent is either a group or a hosting container, never both; do not nest nodes in groups unless the user models it that way. ' +
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

  const catalogs = await loadCatalogs(supabase);
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

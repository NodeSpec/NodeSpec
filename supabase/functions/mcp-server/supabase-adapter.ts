// S1-4 c1: the sole Supabase implementation of the mcp-server repository ports. Queries are
// moved VERBATIM from the tool handlers (no semantic change — same tables, columns, filters,
// row shapes), so the FakeSupabase test harness keeps working: constructing these repos over the
// fake issues exactly the queries the handlers used to issue inline. When S1-4 completes, this
// adapter is the only mcp-server file that imports the Supabase client type or names a table.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getEffectiveTier } from "../_shared/deployment.ts";
import type { Repos, RepoResult, CreatedApiKeyRow, ApiKeyListRow, RevokedApiKeyRow } from "./ports.ts";

function toRepoResult<T>(r: { data: unknown; error: { message?: string; code?: string } | null }): RepoResult<T> {
  return {
    data: (r.data ?? null) as T | null,
    error: r.error ? { message: r.error.message ?? 'Unknown database error', code: r.error.code } : null,
  };
}

export function createRepos(supabase: SupabaseClient): Repos {
  return {
    apiKeys: {
      async create(row): Promise<RepoResult<CreatedApiKeyRow>> {
        const r = await supabase
          .from('mcp_api_keys')
          .insert({
            user_id: row.user_id,
            name: row.name,
            key_hash: row.key_hash,
            key_prefix: row.key_prefix,
            scopes: row.scopes,
            expires_at: row.expires_at,
          })
          .select('id, name, key_prefix, scopes, expires_at, created_at')
          .single();
        return toRepoResult<CreatedApiKeyRow>(r);
      },

      async listByUser(userId): Promise<RepoResult<ApiKeyListRow[]>> {
        const r = await supabase
          .from('mcp_api_keys')
          .select('id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        return toRepoResult<ApiKeyListRow[]>(r);
      },

      async revoke(keyId, userId, revokedAtIso): Promise<RepoResult<RevokedApiKeyRow>> {
        const r = await supabase
          .from('mcp_api_keys')
          .update({ revoked_at: revokedAtIso })
          .eq('id', keyId)
          .eq('user_id', userId)
          .select('id, name, revoked_at')
          .maybeSingle();
        return toRepoResult<RevokedApiKeyRow>(r);
      },
    },

    tier: {
      getUserTier(userId) {
        // SHIP-1(e): the deployment seam — hosted reads Stripe, self-hosted
        // reads the signed license. Same PlanTier out either way.
        return getEffectiveTier(supabase, userId);
      },
    },
  };
}

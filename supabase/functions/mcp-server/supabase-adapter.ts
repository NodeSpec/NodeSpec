// S1-4 c1: the sole Supabase implementation of the mcp-server repository ports. Queries are
// moved VERBATIM from the tool handlers (no semantic change — same tables, columns, filters,
// row shapes), so the FakeSupabase test harness keeps working: constructing these repos over the
// fake issues exactly the queries the handlers used to issue inline. When S1-4 completes, this
// adapter is the only mcp-server file that imports the Supabase client type or names a table.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { oauthClientKnownName } from "../_shared/oauth-client.ts";
import { getEffectiveTier } from "../_shared/deployment.ts";
import type { Repos, RepoResult, CreatedApiKeyRow, ApiKeyListRow, RevokedApiKeyRow, OAuthClientConnectionRow } from "./ports.ts";

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

    checkouts: {
      async releaseByKey(keyId, releasedAtIso): Promise<RepoResult<number>> {
        const r = await supabase
          .from('agent_checkouts')
          .update({ released_at: releasedAtIso, released_reason: 'released' })
          .eq('holder_key_id', keyId)
          .is('released_at', null)
          .select('id');
        if (r.error) return { data: null, error: { message: r.error.message } };
        return { data: ((r.data ?? []) as unknown[]).length, error: null };
      },

      async releaseByDelegate(delegate, releasedAtIso): Promise<RepoResult<number>> {
        const r = await supabase
          .from('agent_checkouts')
          .update({ released_at: releasedAtIso, released_reason: 'released' })
          .eq('holder_delegate', delegate)
          .is('released_at', null)
          .select('id');
        if (r.error) return { data: null, error: { message: r.error.message } };
        return { data: ((r.data ?? []) as unknown[]).length, error: null };
      },
    },

    connections: {
      async count(userId, exceptClientId = null): Promise<RepoResult<number>> {
        const r = await supabase.rpc('agent_connection_count', { p_user_id: userId, p_except_client_id: exceptClientId });
        if (r.error) return { data: null, error: { message: r.error.message ?? 'Unknown database error', code: r.error.code } };
        const n = typeof r.data === 'number' ? r.data : Number(r.data ?? 0);
        return { data: Number.isFinite(n) ? n : 0, error: null };
      },

      async listOAuthClients(userId): Promise<RepoResult<OAuthClientConnectionRow[]>> {
        const t = await supabase
          .from('mcp_oauth_tokens')
          .select('client_id, expires_at, refresh_expires_at, last_used_at, created_at')
          .eq('user_id', userId)
          .is('revoked_at', null);
        if (t.error) return { data: null, error: { message: t.error.message ?? 'Unknown database error', code: t.error.code } };
        type TokenRow = { client_id: string; expires_at: string; refresh_expires_at: string | null; last_used_at: string | null; created_at: string };
        const now = Date.now();
        const byClient = new Map<string, OAuthClientConnectionRow>();
        for (const row of (t.data ?? []) as TokenRow[]) {
          const horizon = row.refresh_expires_at ?? row.expires_at;
          if (!horizon || new Date(horizon).getTime() <= now) continue;
          const cur = byClient.get(row.client_id);
          if (!cur) {
            byClient.set(row.client_id, { client_id: row.client_id, client_name: oauthClientKnownName(row.client_id), last_used_at: row.last_used_at, expires_at: horizon, created_at: row.created_at });
            continue;
          }
          if (row.last_used_at && (!cur.last_used_at || row.last_used_at > cur.last_used_at)) cur.last_used_at = row.last_used_at;
          if (!cur.expires_at || horizon > cur.expires_at) cur.expires_at = horizon;
          if (row.created_at < cur.created_at) cur.created_at = row.created_at;
        }
        // Dynamic client registration is stateless (mcp_oauth_clients was
        // dropped 2026-04-27). Since AL.2 the client's registered name rides
        // in the id we mint ("claude-code.<uuid>"), so the name is read back
        // out of it; an older id reads as its prefix.
        return { data: [...byClient.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)), error: null };
      },

      async revokeOAuthClient(userId, clientId, revokedAtIso): Promise<RepoResult<number>> {
        const r = await supabase
          .from('mcp_oauth_tokens')
          .update({ revoked_at: revokedAtIso })
          .eq('user_id', userId)
          .eq('client_id', clientId)
          .is('revoked_at', null)
          .select('id');
        if (r.error) return { data: null, error: { message: r.error.message ?? 'Unknown database error', code: r.error.code } };
        return { data: ((r.data ?? []) as unknown[]).length, error: null };
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

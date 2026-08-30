// S1-3: the `keys` tool bucket — create/list/revoke MCP API keys.
// PARKED LANE (owner ruling 2026-08-30): the Account-panel key UI was removed
// (it read as a V1 BYOK hangover) but these tools stay registered and working
// in every edition — an OAuth-connected assistant is now the only way users
// mint or revoke ns_live_ keys, and the auth lane (auth.ts) still honors
// them. Placeholder for a future dedicated headless/CI surface — do not
// delete or deregister without an owner ruling.
// S1-4 c1: converted to the repository seam — handlers consume `Repos` (./ports.ts) instead of a
// raw Supabase client; the former inline queries moved verbatim into ./supabase-adapter.ts. All
// guards, scope resolution, key minting, and response shaping are unchanged. Tests exercise the
// real handlers through the real adapter over a FakeSupabase (same scripted queries as before).
import { resolveApiKeyScopesForTier } from "../../_shared/mcp-tier-gate.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { sha256Hex } from "../shared.ts";
import type { Repos } from "../ports.ts";

export async function handleCreateApiKey(
  repos: Repos,
  auth: AuthResult,
  args: { name: string; scopes?: string[]; expires_in_days?: number }
): Promise<MCPResponse> {
  if (auth.authMethod !== 'jwt') {
    return { success: false, error: 'API key creation requires JWT authentication (login via NodeSpec UI)' };
  }

  if (!args.name) {
    return { success: false, error: 'name is required for the API key' };
  }

  // 2026-08-10 all-features ruling: every tier mints every scope; the resolver
  // now only validates scope vocabulary.
  const tier = await repos.tier.getUserTier(auth.userId);
  const scopeResult = resolveApiKeyScopesForTier(tier, args.scopes);
  if ('error' in scopeResult) {
    return { success: false, error: scopeResult.error };
  }
  const requestedScopes = scopeResult.scopes;

  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  const keyBody = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const apiKey = `ns_live_${keyBody}`;
  const keyPrefix = apiKey.slice(0, 16);

  const keyHash = await sha256Hex(apiKey);

  let expiresAt: string | null = null;
  if (args.expires_in_days && args.expires_in_days > 0) {
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + args.expires_in_days);
    expiresAt = expDate.toISOString();
  }

  const { data, error } = await repos.apiKeys.create({
    user_id: auth.userId,
    name: args.name,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    scopes: requestedScopes,
    expires_at: expiresAt,
  });

  if (error) {
    return { success: false, error: `Failed to create API key: ${error.message}` };
  }
  if (!data) {
    return { success: false, error: 'Failed to create API key: no row returned' };
  }

  return {
    success: true,
    data: {
      keyId: data.id,
      name: data.name,
      apiKey,
      keyPrefix: data.key_prefix,
      scopes: data.scopes,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
      warning: 'Store this API key securely. It will not be shown again.',
    },
  };
}

export async function handleListApiKeys(
  repos: Repos,
  auth: AuthResult
): Promise<MCPResponse> {
  if (auth.authMethod !== 'jwt') {
    return { success: false, error: 'API key listing requires JWT authentication (login via NodeSpec UI)' };
  }

  const { data, error } = await repos.apiKeys.listByUser(auth.userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: {
      apiKeys: (data ?? []).map((k) => ({
        keyId: k.id,
        name: k.name,
        keyPrefix: k.key_prefix,
        scopes: k.scopes,
        lastUsedAt: k.last_used_at,
        expiresAt: k.expires_at,
        revokedAt: k.revoked_at,
        createdAt: k.created_at,
        isActive: !k.revoked_at && (!k.expires_at || new Date(k.expires_at) > new Date()),
      })),
    },
  };
}

export async function handleRevokeApiKey(
  repos: Repos,
  auth: AuthResult,
  args: { key_id: string }
): Promise<MCPResponse> {
  if (auth.authMethod !== 'jwt') {
    return { success: false, error: 'API key revocation requires JWT authentication (login via NodeSpec UI)' };
  }

  if (!args.key_id) {
    return { success: false, error: 'key_id is required' };
  }

  const { data, error } = await repos.apiKeys.revoke(args.key_id, auth.userId, new Date().toISOString());

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data) {
    return { success: false, error: 'API key not found or access denied' };
  }

  return {
    success: true,
    data: {
      keyId: data.id,
      name: data.name,
      revokedAt: data.revoked_at,
      message: 'API key has been revoked and can no longer be used.',
    },
  };
}

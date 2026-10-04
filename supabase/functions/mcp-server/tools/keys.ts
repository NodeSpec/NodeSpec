// S1-3: the `keys` tool bucket — create/list/revoke MCP API keys.
//
// V3 I (owner ruling 2026-09-21): the connection surface is back. The
// Account-panel key UI was parked on 2026-08-30 (it read as a V1 BYOK
// hangover); the ruling of 2026-09-21 delineated the tiers by connections
// (community one agent, Indie five, Team five per seat holder) and put the
// person's connected agents under Agents, Connected, in the app. These
// three tools are that tab's server half and the way an OAuth-connected
// assistant manages keys for the person:
//   create_api_key   mints a key for one agent, JWT only (a key never mints
//                    a sibling), refused at the plan's allowance and on a
//                    name that is already live.
//   list_api_keys    the person's keys AND OAuth-connected clients, with
//                    the allowance, so one list is the truth on both lanes.
//   revoke_api_key   a key by key_id or an OAuth client by client_id; the
//                    credential's live leases end now, audited as released.
// S1-4 c1: handlers consume `Repos` (./ports.ts); the queries live in
// ./supabase-adapter.ts. Tests exercise the real handlers through the real
// adapter over a FakeSupabase.
import { resolveApiKeyScopesForTier } from "../../_shared/mcp-tier-gate.ts";
import { agentConnectionAllowanceLine, agentConnectionCapMessage, agentConnectionLimit } from "../../_shared/feature-rules.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { sha256Hex } from "../shared.ts";
import type { Repos } from "../ports.ts";

/** The sentence a live-name collision speaks, on both lanes (23505 on the partial unique index). */
export function connectionNameTakenMessage(name: string): string {
  return `An agent named "${name}" is already connected. Revoke it under Agents, Connected, or pick another name.`;
}

export async function handleCreateApiKey(
  repos: Repos,
  auth: AuthResult,
  args: { name: string; scopes?: string[]; expires_in_days?: number }
): Promise<MCPResponse> {
  if (auth.authMethod !== 'jwt') {
    return { success: false, error: 'API key creation requires JWT authentication (login via NodeSpec UI)' };
  }

  const name = String(args.name ?? '').trim();
  if (!name) {
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

  // I.1: a new key is a new connection. The plan's allowance is compared with
  // what the person already has live (keys and OAuth clients alike), and a
  // count the database cannot give refuses rather than minting blind.
  const counted = await repos.connections.count(auth.userId);
  if (counted.error) {
    return { success: false, error: `Could not count your connected agents: ${counted.error.message}` };
  }
  if ((counted.data ?? 0) >= agentConnectionLimit(tier)) {
    return { success: false, error: agentConnectionCapMessage(tier) };
  }

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
    name,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    scopes: requestedScopes,
    expires_at: expiresAt,
  });

  if (error) {
    // I.1: the partial unique index (one live name per person) answers 23505.
    if (error.code === '23505') {
      return { success: false, error: connectionNameTakenMessage(name) };
    }
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

  const now = new Date();
  const apiKeys = (data ?? []).map((k) => ({
    keyId: k.id,
    name: k.name,
    keyPrefix: k.key_prefix,
    scopes: k.scopes,
    lastUsedAt: k.last_used_at,
    expiresAt: k.expires_at,
    revokedAt: k.revoked_at,
    createdAt: k.created_at,
    isActive: !k.revoked_at && (!k.expires_at || new Date(k.expires_at) > now),
  }));

  // I.2: the OAuth lane sits in the same list, so the Connected tab and an
  // assistant asking "what is connected" read one truth. A failure on that
  // side is reported, never hidden behind an empty array.
  const oauth = await repos.connections.listOAuthClients(auth.userId);
  if (oauth.error) {
    return { success: false, error: `Could not read your OAuth-connected clients: ${oauth.error.message}` };
  }
  const oauthClients = (oauth.data ?? []).map((c) => ({
    clientId: c.client_id,
    clientName: c.client_name,
    lastUsedAt: c.last_used_at,
    expiresAt: c.expires_at,
    createdAt: c.created_at,
    isActive: true,
  }));

  const tier = await repos.tier.getUserTier(auth.userId);
  const active = apiKeys.filter((k) => k.isActive).length + oauthClients.length;
  return {
    success: true,
    data: {
      apiKeys,
      oauthClients,
      connections: {
        active,
        limit: agentConnectionLimit(tier),
        tier,
        allowance: agentConnectionAllowanceLine(tier),
      },
    },
  };
}

export async function handleRevokeApiKey(
  repos: Repos,
  auth: AuthResult,
  args: { key_id?: string; client_id?: string }
): Promise<MCPResponse> {
  if (auth.authMethod !== 'jwt') {
    return { success: false, error: 'API key revocation requires JWT authentication (login via NodeSpec UI)' };
  }

  const nowIso = new Date().toISOString();

  // I.2: an OAuth-connected client is revoked by its client_id: every live
  // token the person holds for it ends, and so do the holds it took.
  if (args.client_id) {
    const clientId = String(args.client_id).trim();
    const revoked = await repos.connections.revokeOAuthClient(auth.userId, clientId, nowIso);
    if (revoked.error) {
      return { success: false, error: revoked.error.message };
    }
    if (!revoked.data) {
      return { success: false, error: 'No live connection for that client, or access denied' };
    }
    const released = await repos.checkouts.releaseByDelegate(`oauth:${auth.userId}:${clientId}`, nowIso);
    const leasesReleased = released.data ?? 0;
    return {
      success: true,
      data: {
        clientId,
        revokedAt: nowIso,
        tokensRevoked: revoked.data,
        leasesReleased,
        message: `The client's connection has been revoked; it must sign in again to reconnect.${leasesReleased > 0 ? ` ${leasesReleased} active lease(s) it held were released.` : ''}`,
      },
    };
  }

  if (!args.key_id) {
    return { success: false, error: 'key_id is required (or client_id for an OAuth-connected client)' };
  }

  const { data, error } = await repos.apiKeys.revoke(args.key_id, auth.userId, nowIso);

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data) {
    return { success: false, error: 'API key not found or access denied' };
  }

  // 4b.4: the key cannot heartbeat any more — its leases end now, audited,
  // rather than blocking others for the 30-minute stale window.
  const released = await repos.checkouts.releaseByKey(data.id, data.revoked_at);
  const leasesReleased = released.data ?? 0;

  return {
    success: true,
    data: {
      keyId: data.id,
      name: data.name,
      revokedAt: data.revoked_at,
      leasesReleased,
      message: `API key has been revoked and can no longer be used.${leasesReleased > 0 ? ` ${leasesReleased} active lease(s) it held were released.` : ''}`,
    },
  };
}

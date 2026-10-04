// S1-3 chunk 7: the authentication family, moved verbatim from mcp-server/index.ts (no logic
// change) — SENSITIVE (production auth must not drift). Resolves an incoming request to an
// AuthResult via X-MCP-API-Key / Bearer (api key, OAuth access token, or Supabase JWT).
// Edge-safe: type-only SupabaseClient + relative ./shared.ts specifiers.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sha256Hex } from "./shared.ts";
import type { AuthResult } from "./shared.ts";

export async function authenticateWithApiKey(
  supabase: SupabaseClient,
  apiKey: string
): Promise<AuthResult> {
  const keyHash = await sha256Hex(apiKey);

  const { data, error } = await supabase.rpc('validate_mcp_api_key', {
    p_key_hash: keyHash,
  });

  if (error) {
    throw new Error(`API key validation failed: ${error.message}`);
  }

  const result = data?.[0];
  if (!result || !result.is_valid) {
    throw new Error(`Authentication failed: ${result?.rejection_reason || 'Invalid API key'}`);
  }

  return {
    userId: result.user_id,
    keyId: result.key_id,
    scopes: result.scopes || ['read'],
    authMethod: 'api_key',
    // O.2: the key's name rides the validation answer (migration
    // 20260922100000) so every write can be labelled without a second read.
    ...(typeof result.key_name === 'string' && result.key_name ? { keyName: result.key_name } : {}),
  };
}

async function authenticateWithJWT(
  supabase: SupabaseClient,
  token: string
): Promise<AuthResult> {
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error(`Authentication failed: ${error?.message || 'Invalid token'}`);
  }

  return {
    userId: user.id,
    scopes: ['read', 'write', 'propose'],
    authMethod: 'jwt',
    ...(user.email ? { email: user.email } : {}),
  };
}

export async function authenticateWithOAuthToken(
  supabase: SupabaseClient,
  token: string
): Promise<AuthResult> {
  const tokenHash = await sha256Hex(token);

  const { data, error } = await supabase
    .from('mcp_oauth_tokens')
    .select('user_id, client_id, scopes, expires_at, revoked_at')
    .eq('access_token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) {
    throw new Error('Authentication failed: Invalid access token');
  }

  if (data.revoked_at) {
    throw new Error('Authentication failed: Token has been revoked');
  }

  if (new Date(data.expires_at) < new Date()) {
    throw new Error('Authentication failed: Token has expired');
  }

  return {
    userId: data.user_id,
    clientId: data.client_id ?? undefined,
    scopes: data.scopes || ['read'],
    authMethod: 'oauth_token',
  };
}

export async function authenticate(req: Request, supabase: SupabaseClient): Promise<AuthResult> {
  const mcpApiKey = req.headers.get('X-MCP-API-Key') || req.headers.get('x-mcp-api-key');
  if (mcpApiKey) {
    return authenticateWithApiKey(supabase, mcpApiKey);
  }

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader) {
    throw new Error('Authentication required');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Invalid authorization header format: Must start with "Bearer "');
  }

  const token = authHeader.replace('Bearer ', '');

  // API-key lane. Parked from 2026-08-30 (the Account "Agents" tab read as
  // a V1 BYOK hangover) and back by owner ruling 2026-09-21 (V3 I): a key
  // is one connected agent of one person, minted under Agents, Connected,
  // or by an OAuth-connected assistant through the key tools
  // (tools/keys.ts). The plan caps how many a person keeps live; this lane
  // only judges the presented key.
  if (token.startsWith('ns_live_')) {
    return authenticateWithApiKey(supabase, token);
  }

  if (token.startsWith('nst_')) {
    return authenticateWithOAuthToken(supabase, token);
  }

  return authenticateWithJWT(supabase, token);
}

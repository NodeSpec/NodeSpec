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

  // PARKED LANE (owner ruling 2026-08-30): API-key auth stays FUNCTIONAL —
  // already-issued ns_live_ keys, the Worker's advertised X-MCP-API-Key
  // header, and headless clients keep working — but the frontend no longer
  // surfaces key management (the Account "Agents" tab read as a V1 BYOK
  // hangover and confused users; OAuth via the consent page is the one
  // connection story now). Keys are still managed through the MCP tools
  // themselves (create_api_key / list_api_keys / revoke_api_key,
  // tools/keys.ts) by an already-connected assistant. Placeholder for a
  // future dedicated headless/CI surface — do not delete.
  if (token.startsWith('ns_live_')) {
    return authenticateWithApiKey(supabase, token);
  }

  if (token.startsWith('nst_')) {
    return authenticateWithOAuthToken(supabase, token);
  }

  return authenticateWithJWT(supabase, token);
}

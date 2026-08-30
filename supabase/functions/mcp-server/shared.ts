// S1-3: cross-cutting types, constants, and utilities shared across the mcp-server
// modules (index composition, auth, transport, tool handlers). Extracted verbatim from
// index.ts so sibling modules can import them without importing index.ts itself — whose
// top-level Deno.serve fires on import and blocks unit testing. The only import is a
// type-only SupabaseClient (erased at runtime), so this module type-checks and runs
// offline and needs no jsr resolution.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-MCP-API-Key",
};

export interface MCPRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface MCPResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AuthResult {
  userId: string;
  keyId?: string;
  scopes: string[];
  authMethod: 'jwt' | 'api_key' | 'oauth_token';
}

export function getBaseUrl(): string {
  return Deno.env.get('MCP_PUBLIC_URL') || `${Deno.env.get('SUPABASE_URL')}/functions/v1/mcp-server`;
}

export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function checkScope(auth: AuthResult, requiredScope: string): boolean {
  return auth.scopes.includes(requiredScope);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve a project by UUID or (unique) name for the authenticated user. Shared by every
// tool bucket that takes a `project_id`. Structural supabase param; type-only client.
export async function resolveProjectByName(
  supabase: SupabaseClient,
  userId: string,
  identifier: string
): Promise<{ project: { id: string; name: string } } | { error: MCPResponse }> {
  if (!identifier) {
    return { error: { success: false, error: 'project_id is required' } };
  }

  if (UUID_RE.test(identifier)) {
    const { data } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', identifier)
      .eq('owner_id', userId)
      .maybeSingle();

    if (!data) {
      return { error: { success: false, error: 'Project not found or access denied' } };
    }
    return { project: data };
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, updated_at')
    .eq('name', identifier)
    .eq('owner_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    return { error: { success: false, error: error.message } };
  }

  if (!data || data.length === 0) {
    return { error: { success: false, error: `No project found with name '${identifier}'. Use list_projects to see your available projects.` } };
  }

  if (data.length > 1) {
    const list = data.map((p: { id: string; updated_at: string }) => `  ${p.id} (updated ${p.updated_at})`).join('\n');
    return { error: { success: false, error: `Multiple projects found with name '${identifier}'. Please specify the project UUID:\n${list}` } };
  }

  return { project: { id: data[0].id, name: data[0].name } };
}

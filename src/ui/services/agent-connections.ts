// V3 I (owner ruling 2026-09-21): the app's client for the person's connected
// agents. The Connected tab under Agents lists, mints and revokes through the
// SAME three MCP tools an OAuth-connected assistant uses (create_api_key,
// list_api_keys, revoke_api_key), called over the MCP server's JSON-RPC door
// with the signed-in session as the bearer. One truth on both lanes: the
// server counts the plan's allowance and refuses with the one sentence; the
// app never computes a cap of its own, never reads the key tables directly
// (mcp_oauth_tokens has no client SELECT policy, by design), and never sees a
// secret except the one the mint returns once.
import { getSupabaseClient } from '../../persistence/supabase/client.js';

/** The MCP server URL, the same one the connect guide prints: the public
 *  address when the deployment names one, else the Supabase function. */
export function mcpServerUrl(env: { VITE_MCP_PUBLIC_URL?: string; VITE_SUPABASE_URL?: string } = import.meta.env): string {
  return env.VITE_MCP_PUBLIC_URL || `${env.VITE_SUPABASE_URL ?? ''}/functions/v1/mcp-server`;
}

export type McpToolResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface McpCallDeps {
  fetch: typeof fetch;
  /** The session whose access token is the bearer; null means signed out. */
  accessToken: () => Promise<string | null>;
  url: () => string;
}

const defaultDeps: McpCallDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  accessToken: async () => {
    const { data: { session } } = await getSupabaseClient().auth.getSession();
    return session?.access_token ?? null;
  },
  url: () => mcpServerUrl(),
};

/** tools/call as the signed-in person, decoded the way an MCP client reads it. */
export async function callMcpToolAsUser<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
  deps: McpCallDeps = defaultDeps,
): Promise<McpToolResult<T>> {
  let token: string | null;
  try {
    token = await deps.accessToken();
  } catch {
    token = null;
  }
  if (!token) return { ok: false, error: 'Sign in to manage your connected agents.' };

  let res: Response;
  try {
    res = await deps.fetch(deps.url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
  } catch (e) {
    return { ok: false, error: `The MCP server did not answer: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (res.status === 401) return { ok: false, error: 'Your session was not accepted by the MCP server. Sign in again.' };
  if (!res.ok) return { ok: false, error: `The MCP server answered ${res.status}.` };

  let body: { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } };
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: 'The MCP server answered with something that was not JSON.' };
  }
  if (body.error) return { ok: false, error: body.error.message ?? 'The MCP server refused the call.' };
  const text = body.result?.content?.[0]?.text ?? '';
  if (body.result?.isError) return { ok: false, error: text.replace(/^Error:\s*/, '') || 'The MCP server refused the call.' };
  try {
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch {
    return { ok: false, error: 'The MCP server answered with something that was not JSON.' };
  }
}

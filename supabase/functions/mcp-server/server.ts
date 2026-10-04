// The MCP server's HTTP router, as one function a test can call with a
// Request (2026-09-21). Everything that used to sit inside Deno.serve in
// index.ts is here, verbatim: sub-path resolution, the OAuth 2.1 endpoints
// (./oauth.ts), the unauthenticated discovery document, authentication
// (./auth.ts) with the 401 contract MCP clients start OAuth from, the 405
// and 400 answers, and the hand-off of JSON-RPC and legacy bodies to the
// transport (./transport.ts). index.ts reads the environment, builds the
// service-role client and serves this; the Deno suite drives it with a
// MemorySupabase as two connecting agents (tests/mcp-two-agents_test.ts).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, getBaseUrl, holderIdentity } from "./shared.ts";
import type { MCPRequest, AuthResult } from "./shared.ts";
import { createRateLimiter, MCP_RATE_LIMIT, rateLimitMessage, takeRateLimit } from "../_shared/rate-limit.ts";
import { authenticate } from "./auth.ts";
import { getOAuthCorsHeaders, handleOAuthMetadata, handleProtectedResourceMetadata, handleClientRegistration, handleAuthorizeGet, handleOAuthResume, handleTokenExchange } from "./oauth.ts";
import { handleMCPProtocol, handleMCPRequest } from "./transport.ts";
import { toolsForTier } from "./tool-surface.ts";
import type { JsonRpcRequest } from "./transport.ts";

export function getSubPath(req: Request): string {
  const url = new URL(req.url);

  // 1. Explicit _path query param takes highest priority (used by proxied clients)
  const queryPath = url.searchParams.get('_path');
  if (queryPath) {
    return queryPath.startsWith('/') ? queryPath : `/${queryPath}`;
  }

  // 2. Full Supabase URL: /functions/v1/mcp-server/authorize -> /authorize
  const fnPrefix = '/functions/v1/mcp-server';
  const idx = url.pathname.indexOf(fnPrefix);
  if (idx !== -1) {
    return url.pathname.slice(idx + fnPrefix.length) || '';
  }

  // 3. Internal Supabase routing: /mcp-server/authorize -> /authorize
  const internalPrefix = '/mcp-server';
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname === internalPrefix) {
    return '';
  }
  if (pathname.startsWith(internalPrefix + '/')) {
    return pathname.slice(internalPrefix.length);
  }

  return pathname || '';
}

/** AE.5: the shared count is the database's (takeRateLimit); this isolate's
 *  own bucket decides only when the database cannot answer.
 *  `resetRateLimiter` is the test seam. */
const fallbackLimiter = createRateLimiter(MCP_RATE_LIMIT);
export function resetRateLimiter(): void { fallbackLimiter.reset(); }

export async function handleRequest(req: Request, supabase: SupabaseClient): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const subPath = getSubPath(req);

    if (subPath === '/.well-known/oauth-authorization-server' || subPath === '/.well-known/oauth-protected-resource') {
      if (subPath.includes('protected-resource')) {
        return handleProtectedResourceMetadata(req);
      }
      return handleOAuthMetadata(req);
    }

    if (subPath === '/authorize') {
      if (req.method === 'GET') {
        return await handleAuthorizeGet(req, supabase);
      }
      return new Response('Method not allowed', { status: 405, headers: getOAuthCorsHeaders(req) });
    }

    // Constant-URL return leg of the Google consent lane (GoTrue's redirect
    // allowlist needs an exact, query-free match — see handleOAuthResume).
    if (subPath === '/authorize/resume') {
      if (req.method === 'GET') {
        return handleOAuthResume(req);
      }
      return new Response('Method not allowed', { status: 405, headers: getOAuthCorsHeaders(req) });
    }

    if (subPath === '/token') {
      if (req.method === 'POST') {
        return await handleTokenExchange(req, supabase);
      }
      return new Response('Method not allowed', { status: 405, headers: getOAuthCorsHeaders(req) });
    }

    if (subPath === '/register') {
      if (req.method === 'POST') {
        return await handleClientRegistration(req);
      }
      return new Response('Method not allowed', { status: 405, headers: getOAuthCorsHeaders(req) });
    }

    // Unauthenticated discovery endpoint -- lets Claude Desktop verify the server is reachable before starting OAuth
    if (req.method === 'GET' && (subPath === '' || subPath === '/')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            name: 'NodeSpec MCP Server',
            version: '1.0.0',
            description: 'MCP server for external agents to interact with NodeSpec architecture diagrams and specifications',
            documentation_url: 'https://nodespec.dev/docs/mcp',
            authentication: {
              methods: ['api_key', 'jwt', 'oauth'],
              apiKeyHeader: 'X-MCP-API-Key',
              jwtHeader: 'Authorization: Bearer <token>',
            },
            workflow: {
              description: 'Recommended tool call sequence for new sessions. YOU design the architecture: read the spec, propose the architecture as patches, and make it traceable — the user reviews and approves in the NodeSpec UI.',
              steps: [
                { order: 1, tool: 'list_projects', purpose: 'Discover projects and obtain a project_id' },
                { order: 2, tool: 'get_project_status', purpose: 'Understand current phase and what action is needed next' },
                { order: 3, tool: 'list_requirements', purpose: 'Inspect the full specification before taking action' },
                { order: 4, tool: 'get_architecture_overview', purpose: 'Read the current architecture (roles, technologies, edges, containment) before proposing changes' },
                { order: 5, tool: 'search_catalog', purpose: 'Resolve the ROLE id (node type) and TECHNOLOGY id for every component you are about to propose. These ids are the vocabulary propose_patches expects; the response also carries the treatment/ownership/configMode legend. Never invent an id.' },
                { order: 6, tool: 'lookup_catalog', purpose: 'For each id you chose, the detail that shapes the design: purpose, config mode, best practices, security guidance, integration patterns and the docs URL' },
                { order: 7, tool: 'propose_patches', purpose: 'Design and submit architecture or code changes: say it with intents[] and the server writes the patches, or send patches[] yourself (add_contract for each interaction first, then add_node per component, then add_edge referencing the contract ids). The user approves/rejects in the UI.' },
                { order: 8, tool: 'map_requirement', purpose: 'After approval, link each requirement to the node(s) that implement it so the architecture is traceable' },
              ],
              tips: [
                'get_project_status returns a next_action field that tells you exactly what to do next',
                'Edges REQUIRE a contractId — always create the contract in the same batch before the edge that references it',
                'Node `type` is a catalog ROLE id and `technology` is a catalog TECHNOLOGY id — search_catalog returns both; a guessed id is normalized server-side at best and wrong at worst',
                'Generate your own UUIDs for every entity and keep them consistent across patches in a batch (edge.source must equal a node id you proposed)',
                'propose_patches validates before writing and names the exact offending fields — fix and resubmit',
                'Poll get_proposal_status to learn whether the user accepted your proposal',
              ],
            },
            // Q: an unauthenticated caller has no plan, so discovery shows
            // the Community list; a signed-in tools/list shows the caller's.
            tools: toolsForTier('community'),
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let auth: AuthResult;
    try {
      auth = await authenticate(req, supabase);
    } catch (_authErr) {
      const baseUrl = getBaseUrl();
      return new Response(
        JSON.stringify({ error: 'unauthorized', error_description: 'Authentication required' }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
          },
        }
      );
    }

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // AE.5: the rate limit, per credential, once the caller is known and
    // before any body is read, counted in the database so every isolate
    // shares it. A 429 carries Retry-After in seconds.
    const limited = await takeRateLimit(
      supabase as never, holderIdentity(auth) ?? `user:${auth.userId}`, auth.userId, MCP_RATE_LIMIT, fallbackLimiter,
    );
    if (!limited.allowed) {
      return new Response(
        JSON.stringify({ error: 'rate_limited', error_description: rateLimitMessage(MCP_RATE_LIMIT, limited.retryAfterSeconds) }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(limited.retryAfterSeconds) },
        }
      );
    }

    // C3 (docs/WORK_LOOP_PLAN.md): a truncated request body dies HERE as a
    // JSON parse error — say so honestly instead of a generic 500, and name
    // the chunked continuation path. Nothing was received or stored.
    let body: unknown;
    try {
      body = await req.json();
    } catch (parseErr) {
      const detail = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Request body is not valid JSON (${detail}). A large payload may have been truncated in transit — ` +
            `nothing was received or stored. For large propose_patches calls, stream a chunked session instead: ` +
            `finalize: false to start, append batches with the returned proposal_id, finalize: true to submit.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Detect JSON-RPC protocol (standard MCP clients like Claude Desktop)
    const isJsonRpc = Array.isArray(body)
      ? body.length > 0 && body[0].jsonrpc === '2.0'
      : body && typeof body === 'object' && body.jsonrpc === '2.0';

    if (isJsonRpc) {
      return await handleMCPProtocol(req, supabase, auth, body as JsonRpcRequest | JsonRpcRequest[]);
    }

    // Legacy custom format (API key clients)
    const mcpBody = body as MCPRequest;
    if (!mcpBody.tool) {
      return new Response(
        JSON.stringify({ success: false, error: 'tool field is required in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const response = await handleMCPRequest(supabase, auth, mcpBody);
    const status = response.success ? 200 : 400;

    return new Response(
      JSON.stringify(response),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.includes('Authentication') ? 401 : 500;
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

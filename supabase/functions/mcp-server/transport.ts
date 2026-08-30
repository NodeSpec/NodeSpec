// S1-3 chunk 8 (final): the MCP transport + tool-dispatch layer, moved verbatim from
// mcp-server/index.ts (no logic change). Owns the JSON-RPC 2.0 protocol (initialize / tools/list
// / tools/call), the MCP_TOOLS registry, and handleMCPRequest — the single dispatch choke point
// where the P0-6 tier gate runs and each tool name routes to its bucket. index.ts keeps only the
// Deno.serve HTTP router (CORS, OAuth endpoints, auth, and handing JSON-RPC bodies here).
// Edge-safe: type-only SupabaseClient + relative specifiers.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { checkTierForScope } from "../_shared/mcp-tier-gate.ts";
import { corsHeaders, checkScope } from "./shared.ts";
import type { MCPRequest, MCPResponse, AuthResult } from "./shared.ts";
import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey } from "./tools/keys.ts";
import { createRepos } from "./supabase-adapter.ts";
import { handleProposePatches, handleGetProposalStatus } from "./tools/proposals.ts";
import { handleGenerateTaskDocs, handleGetBuildReadiness } from "./tools/tasks.ts";
import { handleGetPendingChanges, handleResolveChange } from "./tools/git.ts";
import { handleCreateRequirement, handleUpdateRequirement, handleDeleteRequirement, handleSetRequirementLock, handleListRequirements, handleMapRequirement, handleMarkEntityComplete } from "./tools/requirements.ts";
import { handleReportTestResults, handleUpdateTestCase, type ReportedTestResult, type UpdateTestCaseArgs } from "./tools/test-results.ts";
import { handleListProjects, handleListBranches, handleGetProjectStatus, handleCreateProject } from "./tools/projects.ts";
import { handleGetProjectContext, handleGetTestPlan, handleGetArchitectureOverview } from "./tools/context.ts";
import { handleSearchCatalog, handleLookupCatalog } from "./tools/catalog.ts";
import { handleRunRepoImport } from "./tools/import-analysis.ts";
import { handleUpdateVision } from "./tools/vision.ts";
import { handleRelateRequirements } from "./tools/relations.ts";

export async function handleMCPRequest(
  supabase: SupabaseClient,
  auth: AuthResult,
  request: MCPRequest
): Promise<MCPResponse> {
  // S1-4: the repository seam. Built once per request; converted buckets receive repos and
  // never see the client. Unconverted buckets still take `supabase` until their chunk lands.
  const repos = createRepos(supabase);

  // P0-6: tier gate at the single choke point both entry paths funnel through
  // (JSON-RPC tools/call and the direct request path). Only write-scoped tools are
  // tier-restricted; read + propose are free-tier features by design (the V2 funnel).
  const toolDef = MCP_TOOLS.find((t) => t.name === request.tool);
  if (toolDef?.requiredScope === 'write') {
    const tier = await repos.tier.getUserTier(auth.userId);
    const gate = checkTierForScope(tier, toolDef.requiredScope);
    if (!gate.allowed) {
      return { success: false, error: gate.error };
    }
  }

  switch (request.tool) {
    case 'list_projects':
      return handleListProjects(supabase, auth);

    case 'list_branches':
      return handleListBranches(supabase, auth, request.arguments as { project_id: string });

    case 'get_project_context':
      return handleGetProjectContext(supabase, auth, request.arguments as {
        project_id: string;
        branch_id: string;
        target_type: string;
        target_id: string;
      });

    case 'generate_task_docs':
      return handleGenerateTaskDocs(supabase, auth, request.arguments as {
        project_id: string; branch_id: string; node_ids?: string[]; external_agent?: string;
      });
    case 'get_build_readiness':
      return handleGetBuildReadiness(supabase, auth, request.arguments as {
        project_id: string; branch_id: string; node_ids?: string[];
      });
    case 'run_repo_import':
      return handleRunRepoImport(supabase, auth, request.arguments as {
        project_id: string; restart?: boolean;
        decisions?: import("./tools/import-analysis.ts").ImportDecisions;
      });
    case 'update_vision':
      return handleUpdateVision(supabase, auth, request.arguments as {
        project_id: string; vision: string;
      });
    case 'propose_patches':
      return handleProposePatches(supabase, auth, request.arguments as {
        project_id: string;
        branch_id: string;
        patches: unknown[];
        explanations?: string[];
        external_agent?: string;
      });

    case 'get_proposal_status':
      return handleGetProposalStatus(supabase, auth, request.arguments as { proposal_id: string });

    case 'create_api_key':
      return handleCreateApiKey(repos, auth, request.arguments as {
        name: string;
        scopes?: string[];
        expires_in_days?: number;
      });

    case 'list_api_keys':
      return handleListApiKeys(repos, auth);

    case 'revoke_api_key':
      return handleRevokeApiKey(repos, auth, request.arguments as { key_id: string });

    case 'get_pending_changes':
      return handleGetPendingChanges(supabase, auth, request.arguments as { project_id: string });

    case 'resolve_change':
      return handleResolveChange(supabase, auth, request.arguments as {
        change_event_id: string;
        resolution: 'accepted' | 'dismissed';
        patches?: unknown[];
        apply_ticks?: boolean;
      });

    case 'get_project_status':
      return handleGetProjectStatus(supabase, auth, request.arguments as { project_id: string });

    case 'get_architecture_overview':
      return handleGetArchitectureOverview(supabase, auth, request.arguments as { project_id: string; branch_id?: string });

    case 'search_catalog':
      return handleSearchCatalog(supabase, auth, request.arguments as { query: string; max_results?: number });

    case 'lookup_catalog':
      return handleLookupCatalog(supabase, auth, request.arguments as { role_id?: string; technology_id?: string; category?: string });

    case 'create_project':
      return handleCreateProject(supabase, auth, request.arguments as {
        name: string;
        description?: string;
      });

    case 'create_requirement':
      return handleCreateRequirement(supabase, auth, request.arguments as {
        project_id: string;
        name: string;
        description: string;
        category?: string;
        acceptance_criteria?: string[];
        requirement_id?: string;
      });

    case 'update_requirement':
      return handleUpdateRequirement(supabase, auth, request.arguments as {
        project_id: string;
        requirement_id: string;
        name?: string;
        description?: string;
        category?: string;
        status?: string;
        acceptance_criteria?: string[];
      });

    case 'delete_requirement':
      return handleDeleteRequirement(supabase, auth, request.arguments as {
        project_id: string;
        requirement_id: string;
        force?: boolean;
      });

    case 'set_requirement_lock':
      return handleSetRequirementLock(supabase, auth, request.arguments as {
        project_id: string;
        requirement_id: string;
        locked: boolean;
      });

    case 'get_test_plan':
      return handleGetTestPlan(supabase, auth, request.arguments as {
        project_id: string;
        branch_id: string;
        requirement_id: string;
      });



    case 'list_requirements':
      return handleListRequirements(supabase, auth, request.arguments as {
        project_id: string;
        category?: string;
        status?: string;
      });

    case 'map_requirement':
      return handleMapRequirement(supabase, auth, request.arguments as {
        project_id: string;
        requirement_id: string;
        node_ids: string[];
        branch_id?: string;
        mapping_type?: string;
        mode?: string;
      });

    case 'relate_requirements':
      return handleRelateRequirements(supabase, auth, request.arguments as {
        project_id: string;
        from_requirement_id: string;
        to_requirement_id: string;
        relation_type: string;
        mode?: 'add' | 'remove';
        notes?: string;
      });

    case 'report_test_results':
      return handleReportTestResults(supabase, auth, request.arguments as unknown as {
        project_id: string;
        requirement_id: string;
        results: ReportedTestResult[];
        external_agent?: string;
      });

    case 'update_test_case':
      return handleUpdateTestCase(supabase, auth, request.arguments as unknown as UpdateTestCaseArgs);

    case 'mark_entity_complete':
      return handleMarkEntityComplete(supabase, auth, request.arguments as {
        project_id: string;
        node_id: string;
        branch_id?: string;
        complete?: boolean;
        note?: string;
        external_agent?: string;
      });

    default:
      return {
        success: false,
        error: `Unknown tool: ${request.tool}. Available tools: list_projects, create_project, list_branches, list_requirements, create_requirement, update_requirement, delete_requirement, set_requirement_lock, map_requirement, get_project_context, get_architecture_overview, get_project_status, propose_patches, get_proposal_status, create_api_key, list_api_keys, revoke_api_key, get_pending_changes, resolve_change`,
      };
  }
}

// The tool registry lives in tool-registry.ts (pure data, zero imports) so the test
// suite can parse and shape-check it without pulling this file's jsr-dependent handler
// graph. Re-exported here so index.ts and existing importers are unchanged.
import { MCP_TOOLS } from "./tool-registry.ts";
export { MCP_TOOLS };

// --- MCP JSON-RPC 2.0 Protocol (Streamable HTTP Transport) ---

const MCP_PROTOCOL_VERSION = '2025-03-26';
const MCP_SERVER_INFO = {
  name: 'nodespec-mcp-server',
  version: '1.0.0',
};

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

export async function handleMCPProtocol(
  req: Request,
  supabase: SupabaseClient,
  auth: AuthResult,
  body: JsonRpcRequest | JsonRpcRequest[]
): Promise<Response> {
  const sessionId = req.headers.get('mcp-session-id') || generateSessionId();
  const baseHeaders = {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Mcp-Session-Id': sessionId,
  };

  // Handle batch requests
  if (Array.isArray(body)) {
    const responses: JsonRpcResponse[] = [];
    for (const item of body) {
      const result = await processJsonRpcMessage(supabase, auth, item);
      if (result !== null) responses.push(result);
    }
    if (responses.length === 0) {
      return new Response(null, { status: 202, headers: baseHeaders });
    }
    return new Response(JSON.stringify(responses), { status: 200, headers: baseHeaders });
  }

  // Handle single request
  const result = await processJsonRpcMessage(supabase, auth, body);
  if (result === null) {
    // Notification - no response body
    return new Response(null, { status: 202, headers: baseHeaders });
  }
  return new Response(JSON.stringify(result), { status: 200, headers: baseHeaders });
}

async function processJsonRpcMessage(
  supabase: SupabaseClient,
  auth: AuthResult,
  msg: JsonRpcRequest
): Promise<JsonRpcResponse | null> {
  // Notifications have no id - return null (no response)
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case 'initialize':
      return jsonRpcSuccess(msg.id ?? null, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: MCP_SERVER_INFO,
      });

    case 'notifications/initialized':
    case 'initialized':
      return null; // Notification, no response

    case 'ping':
      return jsonRpcSuccess(msg.id ?? null, {});

    case 'tools/list': {
      const tools = MCP_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return jsonRpcSuccess(msg.id ?? null, { tools });
    }

    case 'tools/call': {
      const params = msg.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        return jsonRpcError(msg.id ?? null, -32602, 'Missing tool name in params');
      }

      const toolDef = MCP_TOOLS.find(t => t.name === params.name);
      if (!toolDef) {
        return jsonRpcError(msg.id ?? null, -32602, `Unknown tool: ${params.name}`);
      }

      // Check scope
      if (toolDef.requiredScope && !checkScope(auth, toolDef.requiredScope)) {
        return jsonRpcSuccess(msg.id ?? null, {
          content: [{ type: 'text', text: `Error: insufficient scope. Required: ${toolDef.requiredScope}` }],
          isError: true,
        });
      }

      const mcpRequest: MCPRequest = {
        tool: params.name,
        arguments: params.arguments || {},
      };

      const response = await handleMCPRequest(supabase, auth, mcpRequest);

      if (!response.success) {
        return jsonRpcSuccess(msg.id ?? null, {
          content: [{ type: 'text', text: `Error: ${response.error}` }],
          isError: true,
        });
      }

      // WS1: compact stringify — the 2-space indent was pure-whitespace token cost on
      // EVERY tool response (measured on the owner's bench fixture; readers are AIs).
      return jsonRpcSuccess(msg.id ?? null, {
        content: [{ type: 'text', text: JSON.stringify(response.data) }],
      });
    }

    default:
      if (isNotification) return null;
      return jsonRpcError(msg.id ?? null, -32601, `Method not found: ${msg.method}`);
  }
}

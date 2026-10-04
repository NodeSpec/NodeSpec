// S1-3 chunk 8 (final): the MCP transport + tool-dispatch layer, moved verbatim from
// mcp-server/index.ts (no logic change). Owns the JSON-RPC 2.0 protocol (initialize / tools/list
// / tools/call), the MCP_TOOLS registry, and handleMCPRequest — the single dispatch choke point
// where the P0-6 tier gate runs and each tool name routes to its bucket. index.ts keeps only the
// Deno.serve HTTP router (CORS, OAuth endpoints, auth, and handing JSON-RPC bodies here).
// Edge-safe: type-only SupabaseClient + relative specifiers.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { checkTierForScope } from "../_shared/mcp-tier-gate.ts";
import { corsHeaders, checkScope, resolveProjectByName, roleForScope, roleAtLeast, roleRefusal, UUID_RE } from "./shared.ts";
import { readClearance, redactByClearance, withheldNote } from "../_shared/classification.ts";
import type { MCPRequest, MCPResponse, AuthResult } from "./shared.ts";
import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey } from "./tools/keys.ts";
import { createRepos } from "./supabase-adapter.ts";
import { handleProposePatches, handleGetProposalStatus } from "./tools/proposals.ts";
import { handleGenerateTaskDocs, handleGetBuildReadiness } from "./tools/tasks.ts";
import { handleGetPendingChanges, handleResolveChange } from "./tools/git.ts";
import { handleCreateRequirement, handleUpdateRequirement, handleDeleteRequirement, handleListRequirements, handleMapRequirement, handleMarkEntityComplete } from "./tools/requirements.ts";
import { handleReportTestResults, handleUpdateTestCase, type ReportedTestResult, type UpdateTestCaseArgs } from "./tools/test-results.ts";
import { handleListProjects, handleGetProjectStatus, handleCreateProject } from "./tools/projects.ts";
import { handleGetProjectContext, handleGetTestPlan, handleGetArchitectureOverview } from "./tools/context.ts";
import { handleSearchCatalog, handleLookupCatalog } from "./tools/catalog.ts";
import { handleRunRepoImport } from "./tools/import-analysis.ts";
import { handleGetNodeContext, handleSearchRepoIndex, handleGetImportContext } from "./tools/repo-index.ts";
import { handleBackfillRequirements } from "./tools/backfill.ts";
import { handleUpdateVision } from "./tools/vision.ts";
import { handleRelateRequirements } from "./tools/relations.ts";
import { handleCheckoutTask, handleReleaseCheckout, handleCheckoutHeartbeat, handleGetWorkQueue } from "./tools/checkouts.ts";
import { handleGetOutcomeBoard } from "./tools/outcome-board.ts";
import { handleGetWorkPlan, handleProposeWorkPlan, handleAcceptWorkPlan, type ProposeWorkPlanArgs } from "./tools/work-plan.ts";
import { routeToolCall } from "./tools/change-router.ts";
import { handleResolveProposal } from "./tools/approvals.ts";
import { handleListProjectMembers, handleSetProjectMember } from "./tools/members.ts";
import { toolsForTier, planRefusal, unknownToolMessage, TOOL_FEATURE } from "./tool-surface.ts";
import type { PlanTier } from "../_shared/tiers.ts";
import { getProjectTier, getReachTier } from "../_shared/deployment.ts";

/** Q: the caller's plan, read once per request where the surface needs it.
 *  A failed read fails closed to community (it lists less, never more). */
async function callerTier(supabase: SupabaseClient, auth: AuthResult): Promise<PlanTier> {
  try {
    return await createRepos(supabase).tier.getUserTier(auth.userId);
  } catch {
    return 'community';
  }
}

/** Decision 1 (owner 2026-09-26): what a credential is SHOWN is the best
 *  plan its person works under anywhere (their own, or a project they are
 *  seated on); what a call may DO is the plan of the project it names. */
async function reachTier(supabase: SupabaseClient, auth: AuthResult): Promise<PlanTier> {
  try {
    return await getReachTier(supabase, auth.userId);
  } catch {
    return callerTier(supabase, auth);
  }
}

/** The plan a paid tool's call is decided by: the named project's (its
 *  owner's). A project the caller is not on answers null: the handler
 *  refuses it as not found, never as a plan. No project named: the
 *  caller's own. A read of an example project answers at Team (AJ.6). */
async function callTier(supabase: SupabaseClient, auth: AuthResult, projectArg: unknown, read: boolean): Promise<PlanTier | null> {
  if (typeof projectArg !== 'string' || !projectArg) return callerTier(supabase, auth);
  const resolved = await resolveProjectByName(supabase, auth.userId, projectArg);
  if ('error' in resolved) return null;
  try {
    return await getProjectTier(supabase, resolved.project.id, auth.userId, { role: resolved.project.role, read });
  } catch {
    return 'community';
  }
}

export async function handleMCPRequest(
  supabase: SupabaseClient,
  auth: AuthResult,
  request: MCPRequest
): Promise<MCPResponse> {
  const response = await dispatchMCPRequest(supabase, auth, request);
  // 7.3: the classification boundary. The server reads with the service
  // role (RLS bypassed), so before a project-scoped read leaves, every item
  // carrying a mark the caller is not cleared for is removed — never
  // greyed — and the count rides back as `withheld`. The owner is cleared
  // for everything (one PK read, no walk); a seat's clearance is the roster's.
  const toolDef = MCP_TOOLS.find((t) => t.name === request.tool);
  const projectArg = request.arguments?.project_id;
  if (response.success && toolDef?.requiredScope === 'read' && typeof projectArg === 'string' && projectArg && response.data && typeof response.data === 'object') {
    const projectId = (response.data as { projectId?: unknown }).projectId;
    const resolvedId = typeof projectId === 'string' && projectId ? projectId : null;
    const target = resolvedId ?? (UUID_RE.test(projectArg) ? projectArg : null);
    if (target) {
      const clearance = await readClearance(supabase, target, auth.userId);
      if (clearance && !clearance.all) {
        const { value, withheld } = redactByClearance(response.data, clearance);
        return withheld > 0
          ? { ...response, data: { ...(value as Record<string, unknown>), withheld, withheldNote: withheldNote(withheld) } }
          : { ...response, data: value };
      }
    }
  }
  return response;
}

async function dispatchMCPRequest(
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

  // Q: a tool that IS a paid capability is refused below its plan, here, so
  // both doors (tools/call and the app's direct request path) answer the
  // same. tools/list does not show it below the plan either.
  if (toolDef && TOOL_FEATURE[request.tool]) {
    const tier = await callTier(supabase, auth, request.arguments?.project_id, toolDef.requiredScope === 'read');
    const refusal = tier ? planRefusal(request.tool, tier) : null;
    if (refusal) return { success: false, error: refusal };
  }

  // 7.0: membership at the same choke point. A project-scoped propose/write
  // tool needs a contributor seat (read tools resolve through any seat inside
  // resolveProjectByName; the roster tools check owner themselves). One PK
  // read for the owner — the common case; the handler's own resolve repeats it.
  const projectArg = request.arguments?.project_id;
  if (toolDef && toolDef.requiredScope !== 'read' && typeof projectArg === 'string' && projectArg) {
    const access = await resolveProjectByName(supabase, auth.userId, projectArg);
    if ('error' in access) return access.error;
    const need = roleForScope(toolDef.requiredScope);
    if (!roleAtLeast(access.project.role, need)) {
      return { success: false, error: roleRefusal(request.tool, access.project.name, access.project.role, need) };
    }
  }

  switch (request.tool) {
    case 'list_projects':
      return handleListProjects(supabase, auth);

    case 'list_project_members':
      return handleListProjectMembers(supabase, auth, request.arguments as { project_id: string });

    case 'set_project_member':
      return handleSetProjectMember(supabase, auth, request.arguments as { project_id: string; email: string; role: string });

    case 'get_project_context':
      return handleGetProjectContext(supabase, auth, request.arguments as {
        project_id: string;
        branch_id: string;
        target_type: string;
        target_id: string;
        view?: string;
        budget?: number;
        since?: string;
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
    case 'get_node_context':
      return handleGetNodeContext(supabase, auth, request.arguments as {
        project_id: string; node_id: string; branch_id?: string; hub_limit?: number;
      });
    case 'search_repo_index':
      return handleSearchRepoIndex(supabase, auth, request.arguments as {
        project_id: string; query: string; node_id?: string; branch_id?: string; max_results?: number;
      });
    case 'get_import_context':
      return handleGetImportContext(supabase, auth, request.arguments as { project_id: string; branch_id?: string });
    case 'backfill_requirements':
      return handleBackfillRequirements(supabase, auth, request.arguments as {
        project_id: string; node_id?: string; whole_system?: boolean; branch_id?: string; accept?: string[]; dismiss?: string[];
      });
    case 'update_vision': {
      const a = request.arguments as { project_id: string; vision: string };
      return routeToolCall(supabase, auth, 'update_vision', a as unknown as Record<string, unknown>, () => handleUpdateVision(supabase, auth, a));
    }
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
      return handleRevokeApiKey(repos, auth, request.arguments as { key_id?: string; client_id?: string });

    case 'get_pending_changes':
      return handleGetPendingChanges(supabase, auth, request.arguments as { project_id: string; change_event_id?: string });

    case 'resolve_change':
      return handleResolveChange(supabase, auth, request.arguments as {
        change_event_id: string;
        resolution: 'accepted' | 'dismissed';
        patches?: unknown[];
        intents?: unknown[];
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

    case 'create_requirement': {
      const a = request.arguments as { project_id: string; name: string; description: string; category?: string; acceptance_criteria?: string[]; requirement_id?: string; section?: string };
      return routeToolCall(supabase, auth, 'create_requirement', a as unknown as Record<string, unknown>, () => handleCreateRequirement(supabase, auth, a));
    }

    case 'update_requirement': {
      const a = request.arguments as { project_id: string; requirement_id: string; name?: string; description?: string; category?: string; status?: string; acceptance_criteria?: string[] };
      return routeToolCall(supabase, auth, 'update_requirement', a as unknown as Record<string, unknown>, () => handleUpdateRequirement(supabase, auth, a));
    }

    case 'delete_requirement': {
      const a = request.arguments as { project_id: string; requirement_id: string; force?: boolean };
      return routeToolCall(supabase, auth, 'delete_requirement', a as unknown as Record<string, unknown>, () => handleDeleteRequirement(supabase, auth, a));
    }

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

    case 'map_requirement': {
      const a = request.arguments as { project_id: string; requirement_id: string; node_ids: string[]; branch_id?: string; mapping_type?: string; mode?: string };
      return routeToolCall(supabase, auth, 'map_requirement', a as unknown as Record<string, unknown>, () => handleMapRequirement(supabase, auth, a));
    }

    case 'relate_requirements': {
      const a = request.arguments as { project_id: string; from_requirement_id: string; to_requirement_id: string; relation_type: string; mode?: 'add' | 'remove'; notes?: string };
      return routeToolCall(supabase, auth, 'relate_requirements', a as unknown as Record<string, unknown>, () => handleRelateRequirements(supabase, auth, a));
    }

    case 'report_test_results':
      return handleReportTestResults(supabase, auth, request.arguments as unknown as {
        project_id: string;
        requirement_id: string;
        results: ReportedTestResult[];
        external_agent?: string;
        git?: { commit_sha?: string; branch?: string };
      });

    case 'update_test_case':
      return handleUpdateTestCase(supabase, auth, request.arguments as unknown as UpdateTestCaseArgs);

    case 'resolve_proposal':
      return handleResolveProposal(supabase, auth, request.arguments as {
        project_id: string;
        proposal_id: string;
        action: string;
        note?: string;
      });

    case 'get_work_queue':
      return handleGetWorkQueue(supabase, auth, request.arguments as {
        project_id: string;
        branch_id?: string;
        limit?: number;
      });

    case 'get_work_plan':
      return handleGetWorkPlan(supabase, auth, request.arguments as { project_id: string; branch_id?: string });

    case 'propose_work_plan':
      return handleProposeWorkPlan(supabase, auth, request.arguments as unknown as ProposeWorkPlanArgs);

    case 'accept_work_plan':
      return handleAcceptWorkPlan(supabase, auth, request.arguments as { project_id: string; plan_id: string });

    case 'get_outcome_board':
      return handleGetOutcomeBoard(supabase, auth, request.arguments as {
        project_id: string;
        branch_id?: string;
        include_settled?: boolean;
      });

    case 'checkout_task':
      return handleCheckoutTask(supabase, auth, request.arguments as {
        project_id: string;
        level?: string;
        task_item_id?: string;
        node_id?: string;
        task_key?: string;
        ref_id?: string;
        branch_id?: string;
        proposal_id?: string;
        external_agent?: string;
        meta?: Record<string, unknown>;
        touches?: string[];
      });

    case 'checkout_heartbeat':
      return handleCheckoutHeartbeat(supabase, auth, request.arguments as {
        project_id: string;
        checkout_id: string;
        meta?: Record<string, unknown>;
      });

    case 'release_checkout':
      return handleReleaseCheckout(supabase, auth, request.arguments as {
        project_id: string;
        checkout_id: string;
        reason?: string;
        note?: string;
      });

    case 'mark_entity_complete':
      return handleMarkEntityComplete(supabase, auth, request.arguments as {
        project_id: string;
        node_id: string;
        branch_id?: string;
        complete?: boolean;
        note?: string;
        external_agent?: string;
      });

    default: {
      // R19: the refusal derives from the registry. The hand-kept name list
      // that used to sit here had drifted to 19 of 44 tools, so a typo'd
      // call taught the agent that every V3 lane was missing. The
      // dispatch-parity test keeps this switch and MCP_TOOLS identical.
      // Q: suggestions come from the caller's own list, never a hidden tool.
      return { success: false, error: unknownToolMessage(request.tool, await reachTier(supabase, auth)) };
    }
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
  const incomingSession = req.headers.get('mcp-session-id');
  const sessionId = incomingSession || generateSessionId();
  const conn: Connection = { sessionId, incoming: incomingSession };
  const baseHeaders = {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Mcp-Session-Id': sessionId,
  };

  // Handle batch requests
  if (Array.isArray(body)) {
    const responses: JsonRpcResponse[] = [];
    for (const item of body) {
      const result = await processJsonRpcMessage(supabase, auth, item, conn);
      if (result !== null) responses.push(result);
    }
    if (responses.length === 0) {
      return new Response(null, { status: 202, headers: baseHeaders });
    }
    return new Response(JSON.stringify(responses), { status: 200, headers: baseHeaders });
  }

  // Handle single request
  const result = await processJsonRpcMessage(supabase, auth, body, conn);
  if (result === null) {
    // Notification - no response body
    return new Response(null, { status: 202, headers: baseHeaders });
  }
  return new Response(JSON.stringify(result), { status: 200, headers: baseHeaders });
}

type Connection = { sessionId: string; incoming: string | null };
type KeyConnection = { session: string; client: string | null; since: string };

/** AL.9 (owner 2026-10-01: "no two agents should share the same key"). A key
 *  serves one connection: the one that initialized with it last, recorded on
 *  the key (metadata.connection; no column). A restart is a new connection
 *  and takes the key over. A tool call from any other connection on the key
 *  is refused, naming the connection that holds it, so two agents sharing a
 *  key find out on their next call instead of working as one holder to every
 *  lease. A call that carries no session (a client without sessions, a
 *  script) cannot be told apart and is not checked. */
async function readKeyMetadata(supabase: SupabaseClient, keyId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('mcp_api_keys').select('metadata').eq('id', keyId).maybeSingle();
  if (error || !data) return null;
  const m = (data as { metadata?: unknown }).metadata;
  return m && typeof m === 'object' && !Array.isArray(m) ? m as Record<string, unknown> : {};
}

async function bindKeyConnection(supabase: SupabaseClient, keyId: string, connection: KeyConnection, metadata?: Record<string, unknown> | null): Promise<void> {
  const current = metadata ?? (await readKeyMetadata(supabase, keyId)) ?? {};
  await supabase.from('mcp_api_keys').update({ metadata: { ...current, connection } }).eq('id', keyId);
}

export async function keyHeldElsewhere(supabase: SupabaseClient, auth: AuthResult, conn: Connection): Promise<string | null> {
  if (auth.authMethod !== 'api_key' || !auth.keyId || !conn.incoming) return null;
  const metadata = await readKeyMetadata(supabase, auth.keyId);
  if (!metadata) return null; // a failed read never stops a call; the key itself was valid
  const held = metadata.connection as Partial<KeyConnection> | undefined;
  if (!held?.session) {
    // connected before this rule: the first session to call holds the key
    await bindKeyConnection(supabase, auth.keyId, { session: conn.incoming, client: null, since: new Date().toISOString() }, metadata);
    return null;
  }
  if (held.session === conn.incoming) return null;
  const who = held.client ? `${held.client}, ` : '';
  return `This key is connected to another agent now (${who}connected ${held.since ?? 'recently'}). A key serves one agent: ` +
    `connect this agent with its own key (Agents, Connected, Connect an agent). If this is the same agent restarted, reconnect it and it takes the key back. Nothing was done.`;
}

async function processJsonRpcMessage(
  supabase: SupabaseClient,
  auth: AuthResult,
  msg: JsonRpcRequest,
  conn: Connection = { sessionId: generateSessionId(), incoming: null },
): Promise<JsonRpcResponse | null> {
  // Notifications have no id - return null (no response)
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case 'initialize':
      // AL.9: this connection now holds the key
      if (auth.authMethod === 'api_key' && auth.keyId) {
        const info = (msg.params as { clientInfo?: { name?: unknown } } | undefined)?.clientInfo;
        try {
          await bindKeyConnection(supabase, auth.keyId, {
            session: conn.sessionId,
            client: typeof info?.name === 'string' && info.name ? info.name.slice(0, 80) : null,
            since: new Date().toISOString(),
          });
        } catch { /* recording the connection never fails the handshake */ }
      }
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
      // Q: the list is the plan: a paid tool is absent below its tier, and
      // open tools lose the sentences and fields about paid ones. Decision 1:
      // the best plan the person reaches (own, or a project they are seated on).
      const tools = toolsForTier(await reachTier(supabase, auth));
      return jsonRpcSuccess(msg.id ?? null, { tools });
    }

    case 'tools/call': {
      const params = msg.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        return jsonRpcError(msg.id ?? null, -32602, 'Missing tool name in params');
      }

      const toolDef = MCP_TOOLS.find(t => t.name === params.name);
      if (!toolDef) {
        // R19: this is the door an MCP client's typo actually hits (the
        // dispatch default below is the app/bench transport's) — same
        // registry-derived suggestions on both.
        return jsonRpcError(msg.id ?? null, -32602, unknownToolMessage(params.name, await reachTier(supabase, auth)));
      }

      // Check scope
      if (toolDef.requiredScope && !checkScope(auth, toolDef.requiredScope)) {
        return jsonRpcSuccess(msg.id ?? null, {
          content: [{ type: 'text', text: `Error: insufficient scope. Required: ${toolDef.requiredScope}` }],
          isError: true,
        });
      }

      // AL.9: one agent per key
      const elsewhere = await keyHeldElsewhere(supabase, auth, conn).catch(() => null);
      if (elsewhere) {
        return jsonRpcSuccess(msg.id ?? null, { content: [{ type: 'text', text: `Error: ${elsewhere}` }], isError: true });
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

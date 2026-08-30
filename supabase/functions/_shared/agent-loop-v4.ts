import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { SSEEmitter } from "./streaming.ts";
import {
  ToolContext,
  PatchOperation,
  executeTool,
  loadGraphState,
  loadLockedNodeIds,
  ProjectPhase,
  getToolsForPhase,
  GraphState,
} from "./tool-executor.ts";
import { getCatalogSummaryForPrompt, buildCatalogDeploymentGuidance, buildPlatformCoexistenceGuidance } from "./role-registry.ts";
import type { ProjectRelevanceFilter } from "./role-registry.ts";
import { resolveRelevantTechnologies, buildTieredTechnologyGuidance } from "./technology-relevance.ts";
import type { RelevanceResult } from "./technology-relevance.ts";
import { loadCatalogs } from "./catalog-loader.ts";
import type { CatalogData } from "./catalog-loader.ts";
import {
  INTERACTION_KIND_VALUES,
  TRANSPORT_KIND_VALUES,
  SPEC_FORMAT_VALUES,
  PLACEMENT_KIND_VALUES,
  CONTRACT_KIND_VALUES,
} from "./enums.ts";
import { getInteractionIntent } from "./ai-context-helpers.ts";
import { runStructuralValidation, buildValidationPrompt, ValidationReport } from "./architecture-validator.ts";
import { generateTaskDocument, getTaskDocumentPath, findExistingTaskArtifact, computeTaskContextFingerprint } from "./task-document-generator.ts";
import { generateTestDocument, getTestDocumentPath, findExistingTestArtifact, computeTestContextFingerprint } from "./test-document-generator.ts";
import {
  sendChatCompletion,
  toNormalizedMessages,
  isLlmTimeoutError,
  type ProviderConfig,
  type ChatMessage,
  type ToolDefinition,
  type ChatCompletionResult,
  type SendCompletionConfig,
} from "./ai-provider.ts";

export interface AgentRequestV4 {
  userId: string;
  projectId: string;
  branchId: string;
  specificationId?: string;
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  systemPromptOverride?: string;
  maxTurns?: number;
  model?: string;
  temperature?: number;
  providerConfig: ProviderConfig;
  sessionId?: string;
  resumeCheckpoint?: AgentCheckpoint | null;
  /** When true, this is the last allowed automatic attempt: the loop must NOT
   * pause again. It finalizes whatever work exists into a reviewable (possibly
   * partial) proposal instead of emitting another continue_needed. */
  isFinalAttempt?: boolean;
}

export interface AgentResult {
  summary: string;
  patches: PatchOperation[];
  toolCallCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  paused?: boolean;
  checkpointId?: string;
  partial?: boolean;
}

type ResumeStage = "phases" | "validation" | "tasks";

export interface AgentCheckpoint {
  id: string;
  sessionId: string;
  attemptCount: number;
  stage: ResumeStage;
  currentPhase: ProjectPhase;
  autoProgress: boolean;
  intent: UserIntent;
  specificationId: string | null;
  patches: PatchOperation[];
  graphSnapshot: GraphState | null;
  archSession: ArchSessionState | null;
  counters: {
    totalToolCalls: number;
    totalTurns: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  summaryParts: string[];
  currentMessage: string;
  /** Compact work-log of prior reasoning + actions, restored on resume. */
  transcript: string[];
}

export const AGENT_CONTINUATION_MESSAGE =
  "Job is larger than normal and requires more turns. Proposed architecture will be pushed for review once the agent completes.";

export const PARTIAL_PROPOSAL_MESSAGE =
  "This is a partial proposal. The job was large enough that the agent reached its automatic-continuation limit before fully finishing. The work completed so far is ready for your review -- you can accept it and ask me to continue refining specific areas.";

export const PARTIAL_NO_PROGRESS_MESSAGE =
  "I ran out of time before I could produce a reviewable proposal for this job -- the architecture step is heavy enough that no components were finalized yet. Nothing has been lost: send another message (for example \"continue\") and I'll resume from where I left off.";

const WALL_CLOCK_BUDGET_MS = 140_000;
const MIN_TIME_RESERVE_MS = 30_000;
const MIN_TOOL_EXEC_RESERVE_MS = 8_000;

class DeadlineController {
  private start = Date.now();
  private lastCallMs = 0;
  constructor(
    private budgetMs: number = WALL_CLOCK_BUDGET_MS,
    private minReserveMs: number = MIN_TIME_RESERVE_MS
  ) {}
  elapsed(): number {
    return Date.now() - this.start;
  }
  remaining(): number {
    return this.budgetMs - this.elapsed();
  }
  recordCall(ms: number): void {
    this.lastCallMs = ms;
  }
  private reserve(): number {
    return Math.max(this.lastCallMs * 1.3, this.minReserveMs);
  }
  shouldPause(): boolean {
    return this.remaining() < this.reserve();
  }
}

interface ProjectContext {
  specification: {
    vision: string;
    constraints: Array<{ type: string; description: string }>;
    preferences: Record<string, unknown>;
  } | null;
  requirements: Array<{
    id: string;
    requirement_id: string;
    name: string;
    description: string | null;
    category: string;
    acceptance_criteria: Array<{ text: string; met?: boolean; testId?: string }> | null;
  }>;
}

type PhaseStatus = 'drafting_requirements' | 'requirements_confirmed' | 'building_architecture' | 'architecture_confirmed' | 'generating_code' | 'architecture_first';

async function loadProjectContext(
  supabase: SupabaseClient,
  specificationId?: string
): Promise<ProjectContext> {
  const empty: ProjectContext = { specification: null, requirements: [] };
  if (!specificationId) return empty;

  const [specResult, reqResult] = await Promise.all([
    supabase
      .from("project_specifications")
      .select("vision, constraints, preferences")
      .eq("id", specificationId)
      .maybeSingle(),
    supabase
      .from("specification_requirements")
      .select("id, requirement_id, name, description, category, acceptance_criteria")
      .eq("specification_id", specificationId)
      .order("created_at"),
  ]);

  return {
    specification: specResult.data ?? null,
    requirements: reqResult.data ?? [],
  };
}

async function loadPhaseStatus(supabase: SupabaseClient, specificationId?: string): Promise<PhaseStatus> {
  if (!specificationId) return 'generating_code';
  const { data } = await supabase
    .from("project_specifications")
    .select("phase_status")
    .eq("id", specificationId)
    .maybeSingle();

  const stored = data?.phase_status as PhaseStatus | null;
  if (stored === 'architecture_first') return 'architecture_first';
  if (stored && stored !== 'drafting_requirements') return stored;

  const { count: nodeCount } = await supabase
    .from("graph_nodes")
    .select("id", { count: "exact", head: true })
    .eq("project_id", specificationId);

  if ((nodeCount || 0) > 0) return 'architecture_confirmed';

  return 'drafting_requirements';
}

async function updatePhaseStatus(supabase: SupabaseClient, specificationId: string, status: PhaseStatus): Promise<void> {
  await supabase
    .from("project_specifications")
    .update({ phase_status: status })
    .eq("id", specificationId);
}

type UserIntent = "generate_all" | "specification" | "architecture" | "reverse_engineer" | "question" | "chat" | "refinement" | "clarification";

interface IntentResult {
  intent: UserIntent;
  confidence: "high" | "medium" | "low";
}

function detectUserIntent(message: string): IntentResult {
  const lower = message.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  const chatPatterns = [
    /^(hi|hello|hey|yo|sup|greetings|good\s+(morning|afternoon|evening))\b/,
    /^(thanks|thank\s*you|thx|ty|cheers|cool|ok|okay|got\s*it|understood|nice|great|awesome|perfect|sounds\s*good)\b/,
    /^(who\s+are\s+you|what\s+can\s+you\s+do|help\s*$)/,
    /^(test|testing|ping|hello\s*world)\s*[.!?]*$/,
  ];
  if (chatPatterns.some((p) => p.test(lower))) return { intent: "chat", confidence: "high" };

  const buildPatterns = [
    /^(build|create|design|make|develop|architect|plan|set\s*up|scaffold|start)\s+(me\s+)?(a|an|the|my)\s+/,
    /^i\s+(want|need|would like|'?d like)\s+to\s+(build|create|make|develop|design)/,
    /^(let'?s|can you|please)\s+(build|create|design|make|develop|start)/,
    /^(generate|create)\s+(a\s+)?(full|complete|entire|whole)\s+/,
    /^i\s+(need|want)\s+(a|an)\s+\w+.*\b(with|that\s+has|including|featuring|and)\b/,
    /^(we('re|\s+are)\s+(building|creating|making|developing)|i('m|\s+am)\s+(building|creating|making|developing))/,
    /\b(saas|platform|application|app|system|portal|marketplace|dashboard)\b.*\b(with|that|for|featuring|including)\b.*\b(auth|billing|payment|api|database|users?|accounts?)\b/,
    /\b(e-?commerce|social\s+media|crm|erp|cms|lms|fintech|healthtech)\b.*\b(platform|app|system|site|application)\b/,
    /^(?:a|an|the|my)\s+\w+.*\b(platform|app|application|system|service)\b.*\b(that|with|for|featuring)\b/,
  ];
  if (buildPatterns.some((p) => p.test(lower))) return { intent: "generate_all", confidence: "high" };

  if (
    /\b(add|create|update|modify|change|edit|new)\b.*\b(requirement|spec(ification)?|constraint|vision)\b/.test(lower) ||
    /\b(requirement|spec(ification)?)\b.*\b(add|create|update|modify|new)\b/.test(lower)
  )
    return { intent: "specification", confidence: "high" };

  if (
    /\breverse[\s-]?engineer\b/.test(lower) ||
    /\b(generate|create|write|build)\b.*\b(spec|specs|specification|requirements?)\b.*\b(from|based\s+on|for)\b.*\b(architecture|canvas|graph|nodes?|components?)\b/.test(lower) ||
    /\b(document|analyze)\b.*\b(this\s+)?(architecture|canvas|graph)\b/.test(lower) ||
    /\b(requirements?|specs?)\b.*\b(from|based\s+on)\b.*\b(architecture|canvas|graph|nodes?)\b/.test(lower)
  )
    return { intent: "reverse_engineer", confidence: "high" };

  if (
    /\b(generate|create|scaffold)\b.*\b(source\s*code|code|artifacts?|configuration|initial)\b.*\bfor\b/.test(lower) ||
    /\b(generate|refine)\b.*\bartifacts?\b/.test(lower)
  )
    return { intent: "architecture", confidence: "high" };

  if (
    /\b(add|create|remove|connect|refine|improve|optimize|scale)\b.*\b(node|service|component|database|api|edge|architecture|backend|frontend)\b/.test(lower) ||
    /\b(generate|design|build|refine|improve)\b.*\barchitecture\b/.test(lower)
  )
    return { intent: "architecture", confidence: "high" };

  if (
    /^(what|how|why|when|where|can|could|should|is|are|do|does|explain|tell|describe|show|list)\b/.test(lower) ||
    lower.endsWith("?")
  )
    return { intent: "question", confidence: "high" };

  const hasActionVerb =
    /\b(add|create|remove|delete|update|modify|change|move|rename|connect|disconnect|replace|swap|split|merge|generate|scaffold|refine|improve|optimize|scale|migrate|deploy|set\s*up|configure|implement|integrate)\b/.test(lower);

  if (!hasActionVerb && wordCount <= 3) return { intent: "chat", confidence: "high" };

  if (!hasActionVerb && wordCount <= 6) {
    return { intent: "clarification", confidence: "low" };
  }

  if (hasActionVerb && wordCount >= 6) return { intent: "refinement", confidence: "high" };

  return { intent: "refinement", confidence: "medium" };
}

async function classifyAmbiguousIntent(
  providerConfig: ProviderConfig,
  model: string,
  message: string
): Promise<UserIntent> {
  const classificationPrompt = `Classify this user message into exactly one category. Respond with ONLY the category name, nothing else.

Categories:
- generate_all: User wants to build/create a new application, platform, or system from scratch
- specification: User wants to add/modify requirements or specifications
- architecture: User wants to modify existing architecture components, nodes, edges, or generate code
- question: User is asking a question about their project or architecture
- chat: Casual greeting, acknowledgment, or off-topic message
- refinement: User wants to iterate on or improve existing work
- clarification: Message is too vague to determine intent confidently

User message: "${message}"

Category:`;

  try {
    const result = await sendChatCompletion(providerConfig, {
      model,
      temperature: 0,
      messages: [{ role: "user", content: classificationPrompt }],
      maxTokens: 50,
      thinking: "off",
    });

    const raw = (result.content || "").trim().toLowerCase().replace(/[^a-z_]/g, "");
    const validIntents: UserIntent[] = ["generate_all", "specification", "architecture", "question", "chat", "refinement", "clarification"];
    if (validIntents.includes(raw as UserIntent)) return raw as UserIntent;
    return "clarification";
  } catch {
    return "clarification";
  }
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  save_specification: "Saving project specification...",
  create_section: "Organizing requirements into sections...",
  create_requirement: "Defining project requirements...",
  get_requirements: "Reviewing project requirements...",
  get_specification: "Reading project specification...",
  add_node: "Adding architecture component...",
  update_node: "Updating architecture component...",
  remove_node: "Removing architecture component...",
  add_edge: "Connecting components...",
  remove_edge: "Removing connection...",
  add_contract: "Defining interface contract...",
  add_port: "Adding component interface...",
  set_parent: "Organizing component hierarchy...",
  add_artifact: "Generating source code...",
  update_artifact: "Updating source code...",
  read_graph: "Analyzing current architecture...",
  read_hierarchy: "Reviewing component hierarchy...",
  get_node: "Inspecting component details...",
  link_schema_artifact: "Linking schema to contract...",
  lookup_catalog: "Looking up catalog details...",
  generate_acceptance_criteria: "Generating acceptance criteria...",
  set_acceptance_criteria: "Setting acceptance criteria...",
  evaluate_criteria: "Evaluating acceptance criterion...",
  verify_requirement: "Verifying requirement implementation...",
  generate_tests: "Generating test plan...",
};

function getToolDisplayName(toolName: string, isValidation = false): string {
  const prefix = isValidation ? "Fixing: " : "";
  return prefix + (TOOL_DISPLAY_NAMES[toolName] || `Processing ${toolName.replace(/_/g, " ")}...`);
}

interface ScaffoldIntent {
  isScaffold: boolean;
  targetNode?: string;
  isConfiguration?: boolean;
  isIteration?: boolean;
}

function detectScaffoldIntent(message: string): ScaffoldIntent {
  const patterns: Array<{ re: RegExp; config?: boolean; iteration?: boolean }> = [
    { re: /^Generate initial source code artifacts?\s+for\s+"?([^"(]+?)"?\s*(?:\(|$)/i },
    { re: /^Generate source code\s+for\s+"?([^"(]+?)"?\s*(?:\(|$)/i },
    { re: /^Generate configuration(?:\s+artifacts?)?\s+for\s+"?([^"(]+?)"?\s*(?:\(|$)/i, config: true },
    { re: /^Refine the source code artifacts?\s+for\s+"?([^"(]+?)"?\s*(?:\(|$)/i, iteration: true },
    { re: /^Refine the configuration artifacts?\s+for\s+"?([^"(]+?)"?\s*(?:\(|$)/i, config: true, iteration: true },
    { re: /^(?:Create|Generate|Scaffold)\s+(?:code|artifacts?|files?)\s+for\s+"?([^"(]+?)"?\s*$/i },
    { re: /^Generate\s+(?:source\s+)?(?:code|artifacts?)\s+for\s+"?([^"(]+?)"?\s*$/i },
  ];

  for (const { re, config, iteration } of patterns) {
    const match = message.match(re);
    if (match) {
      return {
        isScaffold: true,
        targetNode: match[1].trim(),
        isConfiguration: config ?? false,
        isIteration: iteration ?? false,
      };
    }
  }

  return { isScaffold: false };
}

function detectDataPhase(projectContext: ProjectContext, graph?: GraphState, phaseStatus?: PhaseStatus): ProjectPhase {
  if (phaseStatus === 'architecture_first') return "architecture";

  const hasRequirements = projectContext.requirements.length > 0;
  const hasGraphNodes = graph ? Object.keys(graph.nodes).length > 0 : false;

  if (hasGraphNodes && !hasRequirements) return "architecture";

  const hasSpec = !!projectContext.specification;
  if (!hasSpec || !hasRequirements) return "specification";
  return "architecture";
}

function resolvePhase(dataPhase: ProjectPhase, intent: UserIntent, phaseStatus?: PhaseStatus): ProjectPhase {
  if (intent === "reverse_engineer") return "specification";
  if (phaseStatus === 'architecture_first') {
    if (intent === "specification") return "specification";
    return "architecture";
  }
  if (intent === "specification") return "specification";
  if (intent === "architecture") return dataPhase;
  return dataPhase;
}

function shouldAutoProgress(intent: UserIntent, dataPhase: ProjectPhase): boolean {
  if (intent === "generate_all") return true;
  if (intent === "reverse_engineer") return true;
  if (intent === "refinement" && dataPhase !== "architecture") return true;
  return false;
}

function getNextPhase(current: ProjectPhase): ProjectPhase | null {
  if (current === "specification") return "architecture";
  return null;
}

const CHARS_PER_TOKEN = 4;
const PROJECT_CONTEXT_CHAR_CAP = 6_000;
const PROJECT_CONTEXT_CHAR_CAP_ARCHITECTURE = 10_000;

interface ArchSessionState {
  cachedTechGuidance?: string;
  techGuidanceKey?: string;
  cachedDeploymentGuidance?: string;
  relevanceResult?: RelevanceResult;
}

function formatProjectContext(ctx: ProjectContext): string {
  const sections: string[] = [];

  if (ctx.specification) {
    sections.push(`PROJECT VISION:\n${ctx.specification.vision}`);
    if (ctx.specification.preferences) {
      const p = ctx.specification.preferences as Record<string, unknown>;
      const prefParts: string[] = [];
      if (Array.isArray(p.languages) && p.languages.length) prefParts.push(`Languages: ${p.languages.join(", ")}`);
      if (Array.isArray(p.frameworks) && p.frameworks.length) prefParts.push(`Frameworks: ${p.frameworks.join(", ")}`);
      if (Array.isArray(p.databases) && p.databases.length) prefParts.push(`Databases: ${p.databases.join(", ")}`);
      if (p.architecturePattern && p.architecturePattern !== "unknown") prefParts.push(`Pattern: ${p.architecturePattern}`);
      if (p.deploymentTarget) prefParts.push(`Deployment: ${p.deploymentTarget}`);
      if (Array.isArray(p.scopeArchetypes) && p.scopeArchetypes.length) prefParts.push(`Scope Archetypes: ${p.scopeArchetypes.join(", ")}`);
      if (prefParts.length) sections.push(`TECHNOLOGY PREFERENCES:\n${prefParts.join("\n")}`);
    }
    if (Array.isArray(ctx.specification.constraints) && ctx.specification.constraints.length) {
      const lines = ctx.specification.constraints.map((c) => `  - [${c.type}] ${c.description}`).join("\n");
      sections.push(`CONSTRAINTS:\n${lines}`);
    }
  }

  if (ctx.requirements.length > 0) {
    const lines = ctx.requirements
      .map((r) => {
        let line = `  - ${r.requirement_id}: ${r.name} (${r.category})${r.description ? " -- " + r.description : ""}`;
        const criteria = r.acceptance_criteria;
        if (Array.isArray(criteria) && criteria.length > 0) {
          const criteriaLines = criteria.map((c, i) => {
            const check = c.met ? "x" : " ";
            return `      [${check}] AC${i}: ${c.text}`;
          });
          line += "\n" + criteriaLines.join("\n");
        }
        return line;
      })
      .join("\n");
    sections.push(`REQUIREMENTS (${ctx.requirements.length} total):\n${lines}`);
  }

  return sections.join("\n\n");
}

function buildSmartGraphContext(ctx: ToolContext, options?: { userMessage?: string }): string {
  const nodeList = Object.values(ctx.graph.nodes);
  const edgeList = Object.values(ctx.graph.edges);

  if (nodeList.length === 0) return "The architecture graph is currently empty.";

  const DETAIL_THRESHOLD = 15;

  if (nodeList.length <= DETAIL_THRESHOLD) {
    return buildCompactGraphContext(ctx);
  }

  return buildSummarizedGraphContext(ctx, options?.userMessage);
}

function buildCompactGraphContext(ctx: ToolContext): string {
  const nodeList = Object.values(ctx.graph.nodes);
  const edgeList = Object.values(ctx.graph.edges);

  const nodeLines = nodeList.map((n) => {
    const locked = ctx.lockedNodeIds.has(n.id) ? " [LOCKED]" : "";
    const tech = n.technology ? `/${n.technology}` : "";
    const placementSuffix = (n as Record<string, unknown>).placementKind && (n as Record<string, unknown>).placementKind !== 'contains' ? `[${(n as Record<string, unknown>).placementKind}]` : '';
    const parent = n.parentId ? ` in:"${ctx.graph.nodes[n.parentId]?.label || "?"}"${placementSuffix}` : "";
    const isContainer = edgeList.length > 0 && Object.values(ctx.graph.nodes).some((c) => c.parentId === n.id);
    const edgeCount = edgeList.filter((e) => e.source === n.id || e.target === n.id).length;
    const disconnected = !isContainer && edgeCount === 0 ? " [DISCONNECTED]" : "";
    return `  "${n.label}" (${n.type}${tech}${parent})${locked}${disconnected}`;
  }).join("\n");

  const edgeLines = edgeList.map((e) => {
    const src = ctx.graph.nodes[e.source];
    const tgt = ctx.graph.nodes[e.target];
    const contract = ctx.graph.contracts[e.contractId];
    const intent = contract ? getInteractionIntent(contract, { direction: 'out' }) : '?';
    return `  ${src?.label || "?"} -> ${tgt?.label || "?"} [${contract?.kind || "?"}:"${contract?.name || "?"}" intent:${intent}]`;
  }).join("\n");

  return `Graph: ${nodeList.length} nodes, ${edgeList.length} edges\n\n${nodeLines}\n\nEdges:\n${edgeLines || "  (none)"}`;
}

function buildSummarizedGraphContext(ctx: ToolContext, userMessage?: string): string {
  const nodeList = Object.values(ctx.graph.nodes);
  const edgeList = Object.values(ctx.graph.edges);

  const roleCounts: Record<string, number> = {};
  const topLevelNodes: typeof nodeList = [];
  const childMap: Record<string, typeof nodeList> = {};

  for (const n of nodeList) {
    roleCounts[n.type] = (roleCounts[n.type] || 0) + 1;
    if (!n.parentId) {
      topLevelNodes.push(n);
    } else {
      if (!childMap[n.parentId]) childMap[n.parentId] = [];
      childMap[n.parentId].push(n);
    }
  }

  function walkHierarchy(node: typeof nodeList[0], depth: number, lines: string[]) {
    const indent = "  ".repeat(depth);
    const tech = node.technology ? ` (${node.technology})` : "";
    const childCount = childMap[node.id]?.length || 0;
    const childSuffix = childCount > 0 ? ` [${childCount} children]` : "";
    const locked = ctx.lockedNodeIds.has(node.id) ? " [LOCKED]" : "";
    lines.push(`${indent}- "${node.label}" (${node.type}${tech})${childSuffix}${locked}`);
    const children = childMap[node.id];
    if (children) {
      if (depth < 2) {
        for (const child of children) walkHierarchy(child, depth + 1, lines);
      } else {
        lines.push(`${"  ".repeat(depth + 1)}... ${children.length} children`);
      }
    }
  }

  const hierarchyLines: string[] = [];
  for (const n of topLevelNodes) walkHierarchy(n, 1, hierarchyLines);

  const edgeLines = edgeList.map((e) => {
    const src = ctx.graph.nodes[e.source];
    const tgt = ctx.graph.nodes[e.target];
    const contract = ctx.graph.contracts[e.contractId];
    const intent = contract ? getInteractionIntent(contract, { direction: 'out' }) : '?';
    return `  ${src?.label || "?"} -> ${tgt?.label || "?"} [${contract?.kind || "?"}:"${contract?.name || "?"}" intent:${intent}]`;
  });

  const rolesSummary = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => `${role}: ${count}`)
    .join(", ");

  let detail = "";
  if (userMessage) {
    const mentionedNodes = nodeList.filter((n) =>
      userMessage.toLowerCase().includes(n.label.toLowerCase())
    );
    if (mentionedNodes.length > 0) {
      const detailLines = mentionedNodes.map((n) => {
        const tech = n.technology ? `, technology: ${n.technology}` : "";
        const parent = n.parentId ? `, parent: "${ctx.graph.nodes[n.parentId]?.label || "?"}"` : "";
        const relatedEdges = edgeList.filter((e) => e.source === n.id || e.target === n.id);
        const edgeDetail = relatedEdges.map((e) => {
          const src = ctx.graph.nodes[e.source];
          const tgt = ctx.graph.nodes[e.target];
          const contract = ctx.graph.contracts[e.contractId];
          return `    ${src?.label || "?"} -> ${tgt?.label || "?"} via "${contract?.name || "?"}" (${contract?.kind || "?"})`;
        }).join("\n");
        return `  "${n.label}" (role: ${n.type}${tech}${parent})\n  Edges:\n${edgeDetail || "    (none)"}`;
      }).join("\n\n");
      detail = `\n\nDETAILED VIEW (nodes mentioned in your request):\n${detailLines}`;
    }
  }

  return `Current graph has ${nodeList.length} nodes and ${edgeList.length} edges.

SUMMARY BY ROLE: ${rolesSummary}

CONTAINER HIERARCHY:
${hierarchyLines.join("\n")}

EDGES:
${edgeLines.length > 0 ? edgeLines.join("\n") : "  (none)"}${detail}

Use read_graph or get_node tools for full details on specific nodes.`;
}

function scopeProjectContext(ctx: ProjectContext, userMessage?: string): ProjectContext {
  if (!userMessage || ctx.requirements.length <= 10) return ctx;

  const lower = userMessage.toLowerCase();
  const mentionedReqs = ctx.requirements.filter((r) =>
    lower.includes(r.name.toLowerCase()) || lower.includes(r.requirement_id.toLowerCase())
  );

  if (mentionedReqs.length === 0) return ctx;

  return { specification: ctx.specification, requirements: mentionedReqs };
}

function formatScopedProjectContext(fullCtx: ProjectContext, scopedCtx: ProjectContext, charCap = PROJECT_CONTEXT_CHAR_CAP): string {
  const sections: string[] = [];

  if (fullCtx.specification) {
    sections.push(`PROJECT VISION:\n${fullCtx.specification.vision}`);
    if (fullCtx.specification.preferences) {
      const p = fullCtx.specification.preferences as Record<string, unknown>;
      const prefParts: string[] = [];
      if (Array.isArray(p.languages) && p.languages.length) prefParts.push(`Languages: ${p.languages.join(", ")}`);
      if (Array.isArray(p.frameworks) && p.frameworks.length) prefParts.push(`Frameworks: ${p.frameworks.join(", ")}`);
      if (Array.isArray(p.databases) && p.databases.length) prefParts.push(`Databases: ${p.databases.join(", ")}`);
      if (p.architecturePattern && p.architecturePattern !== "unknown") prefParts.push(`Pattern: ${p.architecturePattern}`);
      if (p.deploymentTarget) prefParts.push(`Deployment: ${p.deploymentTarget}`);
      if (Array.isArray(p.scopeArchetypes) && p.scopeArchetypes.length) prefParts.push(`Scope Archetypes: ${p.scopeArchetypes.join(", ")}`);
      if (prefParts.length) sections.push(`TECHNOLOGY PREFERENCES:\n${prefParts.join("\n")}`);
    }
    if (Array.isArray(fullCtx.specification.constraints) && fullCtx.specification.constraints.length) {
      const lines = fullCtx.specification.constraints.map((c) => `  - [${c.type}] ${c.description}`).join("\n");
      sections.push(`CONSTRAINTS:\n${lines}`);
    }
  }

  const isScoped = scopedCtx !== fullCtx;
  const reqs = isScoped ? scopedCtx.requirements : fullCtx.requirements;

  const currentLen = sections.reduce((acc, s) => acc + s.length, 0);
  const budgetRemaining = charCap - currentLen;
  const useCompact = budgetRemaining < 2_000 && reqs.length > 15;

  if (reqs.length > 0) {
    const scopeNote = isScoped
      ? ` (${reqs.length} relevant of ${fullCtx.requirements.length} total -- use get_requirements for full list)`
      : ` (${reqs.length} total)`;
    const lines = useCompact
      ? reqs.map((r) => `  - ${r.requirement_id}: ${r.name} (${r.category})`).join("\n")
      : reqs.map((r) => `  - ${r.requirement_id}: ${r.name} (${r.category})${r.description ? " -- " + r.description : ""}`).join("\n");
    const compactNote = useCompact ? " -- use get_requirements for descriptions" : "";
    sections.push(`REQUIREMENTS${scopeNote}${compactNote}:\n${lines}`);
  } else if (fullCtx.requirements.length > 0) {
    sections.push(`REQUIREMENTS (${fullCtx.requirements.length} total -- use get_requirements for details)`);
  }

  return sections.join("\n\n");
}

const ARTIFACT_TOOL_PATTERN = /(?:add_artifact|update_artifact).*?"nodeLabel"\s*:\s*"([^"]+)".*?"path"\s*:\s*"([^"]+)"/g;

function extractArtifactSummary(content: string): string[] {
  const artifacts: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(ARTIFACT_TOOL_PATTERN.source, "g");
  while ((match = regex.exec(content)) !== null) {
    artifacts.push(`${match[1]}:${match[2]}`);
  }
  return artifacts;
}

function summarizeConversationHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  maxRecentMessages = 4,
  maxSummaryTokens = 1500
): Array<{ role: "user" | "assistant"; content: string }> {
  if (history.length <= maxRecentMessages) return history;

  const older = history.slice(0, history.length - maxRecentMessages);
  const recent = history.slice(history.length - maxRecentMessages);

  const decisions: string[] = [];
  const rejections: string[] = [];
  const nodesCreated: string[] = [];
  const nodesModified: string[] = [];
  const nodesRemoved: string[] = [];
  const techChoices: string[] = [];
  const constraints: string[] = [];
  const allGeneratedArtifacts: string[] = [];

  for (const msg of older) {
    const content = msg.content;

    const artifacts = extractArtifactSummary(content);
    if (artifacts.length > 0) allGeneratedArtifacts.push(...artifacts);

    if (msg.role === "user") {
      const rejectionPatterns = /\b(don'?t|do not|no|never|avoid|skip|remove|not)\b\s+\b(want|use|need|like|include|add)\b\s+(.{5,60})/gi;
      let match: RegExpExecArray | null;
      while ((match = rejectionPatterns.exec(content)) !== null) {
        const rejection = match[0].trim();
        if (rejection.length < 80) rejections.push(rejection);
      }

      const constraintPatterns = /\b(must|always|require|need|should|has to|have to)\b\s+(.{5,80})/gi;
      while ((match = constraintPatterns.exec(content)) !== null) {
        const constraint = match[0].trim();
        if (constraint.length < 100 && !constraints.includes(constraint)) {
          constraints.push(constraint);
        }
      }
    }

    if (msg.role === "assistant") {
      const addNodePattern = /(?:add_node|Created|Adding).*?"?label"?\s*[:=]\s*"([^"]+)"/gi;
      let match: RegExpExecArray | null;
      while ((match = addNodePattern.exec(content)) !== null) {
        if (!nodesCreated.includes(match[1])) nodesCreated.push(match[1]);
      }

      const removePattern = /(?:remove_node|Removed|Removing).*?"?label"?\s*[:=]\s*"([^"]+)"/gi;
      while ((match = removePattern.exec(content)) !== null) {
        if (!nodesRemoved.includes(match[1])) nodesRemoved.push(match[1]);
      }

      const updatePattern = /(?:update_node|Updated|Modifying).*?"?label"?\s*[:=]\s*"([^"]+)"/gi;
      while ((match = updatePattern.exec(content)) !== null) {
        if (!nodesModified.includes(match[1])) nodesModified.push(match[1]);
      }

      const techPattern = /\b(?:using|chose|selected|technology|tech)\b[:\s]+([A-Z][a-zA-Z0-9.]+(?:\s+[A-Z][a-zA-Z0-9.]+)?)/g;
      while ((match = techPattern.exec(content)) !== null) {
        if (!techChoices.includes(match[1])) techChoices.push(match[1]);
      }

      const decidedPattern = /(?:decided|choosing|going with|selected|using)\s+(.{5,60}?)(?:\.|,|$)/gi;
      while ((match = decidedPattern.exec(content)) !== null) {
        const d = match[1].trim();
        if (d.length < 60 && !decisions.includes(d)) decisions.push(d);
      }
    }
  }

  const summaryParts: string[] = ["[SESSION DECISIONS]"];

  if (decisions.length > 0) {
    summaryParts.push(`Decided: ${decisions.slice(0, 8).join("; ")}`);
  }
  if (rejections.length > 0) {
    summaryParts.push(`Rejected: ${[...new Set(rejections)].slice(0, 5).join("; ")}`);
  }
  if (constraints.length > 0) {
    summaryParts.push(`Constraints: ${constraints.slice(0, 5).join("; ")}`);
  }
  if (techChoices.length > 0) {
    summaryParts.push(`Technologies: ${[...new Set(techChoices)].slice(0, 10).join(", ")}`);
  }
  if (nodesCreated.length > 0) {
    summaryParts.push(`Created nodes: ${[...new Set(nodesCreated)].slice(0, 15).join(", ")}`);
  }
  if (nodesModified.length > 0) {
    summaryParts.push(`Modified nodes: ${[...new Set(nodesModified)].slice(0, 10).join(", ")}`);
  }
  if (nodesRemoved.length > 0) {
    summaryParts.push(`Removed nodes: ${[...new Set(nodesRemoved)].join(", ")}`);
  }
  if (allGeneratedArtifacts.length > 0) {
    const uniqueArtifacts = [...new Set(allGeneratedArtifacts)].slice(0, 10);
    summaryParts.push(`Generated artifacts: ${uniqueArtifacts.join(", ")}`);
  }

  if (summaryParts.length === 1) {
    const briefSummary = older.map((msg) => {
      const prefix = msg.role === "user" ? "User:" : "Assistant:";
      const truncated = msg.content.length > 150 ? msg.content.slice(0, 150) + "..." : msg.content;
      return `${prefix} ${truncated}`;
    }).join("\n");
    summaryParts.push(briefSummary);
  }

  let summaryText = summaryParts.join("\n");
  const maxChars = maxSummaryTokens * CHARS_PER_TOKEN;
  if (summaryText.length > maxChars) {
    summaryText = summaryText.slice(0, maxChars) + "\n... (earlier decisions truncated)";
  }

  return [{ role: "user" as const, content: summaryText }, ...recent];
}

function extractScopeArchetypes(projectContext: ProjectContext): string[] {
  const prefs = projectContext.specification?.preferences as Record<string, unknown> | null;
  if (prefs && Array.isArray(prefs.scopeArchetypes) && prefs.scopeArchetypes.length > 0) {
    return prefs.scopeArchetypes as string[];
  }
  return ["simple-web-app"];
}

function buildSpecificationPrompt(projectContext: ProjectContext, catalogs?: CatalogData, ctx?: ToolContext, phaseStatus?: PhaseStatus): string {
  const existingContext = formatProjectContext(projectContext);
  const hasPartialSpec = !!projectContext.specification;
  const graphNodeCount = ctx ? Object.keys(ctx.graph.nodes).length : 0;
  const isArchitectureFirst = phaseStatus === 'architecture_first' || (graphNodeCount > 0 && projectContext.requirements.length === 0);

  let archetypeListing = "";
  let reqCountGuidance = "";
  const archetypeRows = catalogs?.scopeArchetypes
    ? Object.values(catalogs.scopeArchetypes).sort((a, b) => a.sort_order - b.sort_order)
    : [];

  if (archetypeRows.length > 0) {
    archetypeListing = archetypeRows.map((a) => `- ${a.id}: ${a.description}`).join("\n");
    const seenGuidance = new Set<string>();
    const guidanceLines: string[] = [];
    for (const a of archetypeRows) {
      if (a.spec_guidance && !seenGuidance.has(a.spec_guidance)) {
        seenGuidance.add(a.spec_guidance);
        guidanceLines.push(`   - ${a.spec_guidance}`);
      }
    }
    guidanceLines.push("   - Multi-archetype projects: scale to the most complex archetype");
    reqCountGuidance = guidanceLines.join("\n");
  } else {
    archetypeListing = `- simple-web-app: Traditional web application with frontend + backend + database. DEFAULT when no other archetype clearly applies.
- cloud-native: Distributed systems designed for cloud elasticity.
- desktop-app: Native or hybrid desktop application.
- mobile-app: Native or cross-platform mobile application.
- iot-embedded: Hardware-integrated systems, sensor networks, firmware.
- data-pipeline: ETL, analytics, ML training, data warehouse.
- enterprise-platform: Large-scale multi-domain system with complex business rules.`;
    reqCountGuidance = `   - simple-web-app alone: 5-10 requirements
   - cloud-native, enterprise-platform: 10-20 requirements
   - desktop-app, mobile-app alone: 6-12 requirements
   - iot-embedded: 6-14 requirements
   - data-pipeline: 5-10 requirements
   - Multi-archetype projects: scale to the most complex archetype`;
  }

  const graphContext = isArchitectureFirst && ctx ? buildSmartGraphContext(ctx) : "";

  return `You are an expert software architect helping define a project specification. Your job is to understand what the user wants to build and create a structured specification with requirements.

${existingContext ? `EXISTING PROJECT STATE:\n${existingContext}\n` : "This is a brand new project with no specification yet.\n"}
${isArchitectureFirst && graphContext ? `EXISTING ARCHITECTURE (${graphNodeCount} components):\n${graphContext}\n` : ""}
THE WORKFLOW (Specification -> Requirements -> Architecture):
This project needs a specification and requirements before architecture can be generated. You are in the specification phase.

YOUR TASK:
${isArchitectureFirst
    ? `An architecture with ${graphNodeCount} components already exists. If the user wants to generate requirements, analyze the existing nodes and reverse-engineer requirements based on what each component does, its technology, and its connections. Map each generated requirement back to the node(s) that implement it using the requirement description. Create sections that mirror the architecture's logical groupings.`
    : hasPartialSpec
    ? "A specification exists but needs more requirements. Review what exists and add missing requirements based on the user's request."
    : "No specification exists yet. You need to create one."}

WORKFLOW:
1. Understand what the user wants to build from their message.
2. Determine the project's scope archetype(s) -- see SCOPE ARCHETYPE DETECTION below.
3. Call save_specification with a clear vision statement, technology preferences (including scopeArchetypes), and constraints.
4. Create logical sections to organize requirements (e.g., "User Management", "Core Features", "Data & Storage").
5. Create specific, testable requirements (REQ-001, REQ-002, etc.) organized into sections.
6. Each requirement should have a clear name, description, category, and 2-3 acceptance criteria.
7. Scale the number of requirements to the project's scope archetype(s). Simple projects need fewer requirements; complex projects need more.
8. After creating all requirements, provide a summary of what was created including the detected archetype(s).

MANUAL REQUIREMENT PRESERVATION:
CRITICAL: When get_requirements returns requirements with source="manual" or locked=true, you MUST NOT overwrite them with create_requirement using the same requirementId. These were created by the user and must be preserved.

SCOPE ARCHETYPE DETECTION:
Every project maps to one or more scope archetypes. You MUST set scopeArchetypes in the preferences when calling save_specification.

AVAILABLE ARCHETYPES:
${archetypeListing}

DETECTION RULES:
1. A project can have MULTIPLE archetypes. Set ALL that apply.
2. When the user's description is vague or simple, default to ["simple-web-app"].
3. Look for explicit signals first, then implicit signals.
4. Do NOT over-classify.
5. The archetype(s) influence requirement count:
${reqCountGuidance}

REQUIREMENT CATEGORIES:
- functional: What the system does (user-facing features)
- non-functional: How the system performs (scalability, security, performance)
- technical: Technology-specific constraints (language, framework, infrastructure)
- business: Business rules and logic

RULES:
- Be thorough but focused. Cover all aspects the user mentions.
- Infer reasonable requirements from the project description.
- Use descriptive requirement IDs: REQ-001, REQ-002, etc.
- Each requirement should be independently testable.
- Do NOT create architecture nodes. Only specification + requirements at this stage.
- Do NOT create requirements for platform-provided capabilities unless the user explicitly asks.`;
}

function extractDeploymentTarget(projectContext: ProjectContext): string {
  const prefs = projectContext.specification?.preferences as Record<string, unknown> | null;
  return String(prefs?.deploymentTarget || "").toLowerCase();
}

function detectCloudProvider(deploymentTarget: string): string | null {
  if (/\b(aws|amazon)\b/.test(deploymentTarget)) return "aws";
  if (/\b(azure|microsoft)\b/.test(deploymentTarget)) return "azure";
  if (/\b(gcp|google)\b/.test(deploymentTarget)) return "gcp";
  if (/\b(vercel)\b/.test(deploymentTarget)) return "vercel";
  if (/\b(netlify)\b/.test(deploymentTarget)) return "netlify";
  if (/\b(docker|self.?host|on.?prem)\b/.test(deploymentTarget)) return "self-hosted";
  return null;
}

function buildDeploymentTargetGuidance(deploymentTarget: string, archetypes: string[], catalogs?: CatalogData): string {
  const provider = detectCloudProvider(deploymentTarget);
  if (!provider) return "";
  const guidanceText = catalogs ? buildCatalogDeploymentGuidance(catalogs, provider, archetypes) : "";
  if (!guidanceText) return "";
  return `\nDEPLOYMENT TARGET: ${deploymentTarget.toUpperCase()}\n\n${guidanceText}`;
}

function buildArchetypeArchitectureGuidance(archetypes: string[], _projectContext: ProjectContext, catalogs?: CatalogData): string {
  const parts: string[] = [];
  for (const arch of archetypes) {
    const row = catalogs?.scopeArchetypes[arch];
    if (row?.architecture_guidance) {
      parts.push(row.architecture_guidance);
    }
  }

  if (archetypes.length > 1) {
    const multiGuidance = catalogs?.scopeArchetypes[archetypes[0]]?.multi_archetype_architecture_guidance;
    if (multiGuidance) {
      parts.push(multiGuidance.replace("${archetypes}", archetypes.join(" + ")));
    } else {
      parts.push(`MULTI-ARCHETYPE: This project spans ${archetypes.join(" + ")}. Each archetype's nodes are visually grouped in their own logical boundary or container hierarchy. Shared infrastructure wraps ALL archetype domains.`);
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : "";
}

function findTaskDocumentForNode(ctx: ToolContext, nodeLabel: string): string | null {
  const normalizedLabel = nodeLabel.toLowerCase().trim();
  for (const artifact of Object.values(ctx.graph.artifacts)) {
    if (artifact.kind !== "task") continue;
    const ownerNode = ctx.graph.nodes[artifact.nodeId];
    if (ownerNode && ownerNode.label.toLowerCase().trim() === normalizedLabel && artifact.content) {
      return artifact.content;
    }
  }
  return null;
}

function ensureTaskDocumentForNode(ctx: ToolContext, nodeLabel: string, projectContext: ProjectContext): string | null {
  const existing = findTaskDocumentForNode(ctx, nodeLabel);
  if (existing) return existing;

  const normalizedLabel = nodeLabel.toLowerCase().trim();
  const targetNode = Object.values(ctx.graph.nodes).find(
    (n) => n.label.toLowerCase().trim() === normalizedLabel
  );
  if (!targetNode || !ctx.catalogs) return null;

  const reqs = (projectContext.requirements || [])
    .filter((r: { nodeIds?: string[] }) => r.nodeIds?.includes(targetNode.id))
    .map((r: { requirementId?: string; name: string; description: string; category: string; status: string; acceptanceCriteria?: Array<{ text: string; met?: boolean }> }) => ({
      requirementId: r.requirementId || r.name,
      name: r.name,
      description: r.description || "",
      category: r.category || "functional",
      status: r.status || "draft",
      acceptanceCriteria: r.acceptanceCriteria || [],
    }));

  const requirementNodeMap: Record<string, string[]> = {};
  for (const r of (projectContext.requirements || []) as Array<{ requirementId?: string; name: string; nodeIds?: string[] }>) {
    if (r.nodeIds && r.nodeIds.length > 0) {
      requirementNodeMap[r.requirementId || r.name] = r.nodeIds;
    }
  }

  const content = generateTaskDocument({
    node: {
      id: targetNode.id,
      label: targetNode.label,
      type: targetNode.type,
      technology: targetNode.technology,
      parentId: targetNode.parentId,
      ports: targetNode.ports,
      metadata: targetNode.metadata,
    },
    graph: ctx.graph,
    catalogs: ctx.catalogs,
    requirements: reqs,
    projectVision: projectContext.specification?.vision || undefined,
    requirementNodeMap,
  });

  const now = new Date().toISOString();
  const artifactId = crypto.randomUUID();
  const taskPath = getTaskDocumentPath(targetNode.label, targetNode.id);
  ctx.graph.artifacts[artifactId] = {
    id: artifactId,
    nodeId: targetNode.id,
    kind: "task",
    path: taskPath,
    content,
    language: "markdown",
    status: "draft",
    description: `Implementation task document for ${targetNode.label}`,
    createdAt: now,
    updatedAt: now,
  };

  return content;
}

function buildScaffoldContextBlock(scaffold: ScaffoldIntent, ctx?: ToolContext, projectContext?: ProjectContext): string {
  const target = scaffold.targetNode || "the target node";
  const genType = scaffold.isConfiguration ? "configuration" : "source code";

  let taskDocSection = "";
  if (ctx && projectContext && scaffold.targetNode) {
    const taskContent = ensureTaskDocumentForNode(ctx, scaffold.targetNode, projectContext);
    if (taskContent) {
      taskDocSection = `
TASK DOCUMENT (PRIMARY CONTEXT BRIEF)
The following task document is the authoritative specification for this component. Use it as your primary guide for understanding what to build, which contracts to implement, and what technology conventions to follow.

<task-document>
${taskContent}
</task-document>

`;
    }
  }

  return `
CODE GENERATION MODE -- ACTIVE

The user has requested ${genType} generation for "${target}". This is your PRIMARY and ONLY task.
${scaffold.isIteration ? "This is an ITERATION request -- the node already has artifacts. Read them first via get_node, then use read_artifact to inspect existing code before generating updates." : ""}
${taskDocSection}
MANDATORY WORKFLOW:
1. Call get_node with label "${target}" to load the node's context, connections, and artifact list.
2. For each connected node, call read_artifact on any schema/source artifacts to understand the contract interfaces this node must implement or consume. Cross-reference these with the Interface Contracts section of the task document above.
3. ${scaffold.isIteration ? "Call read_artifact on the target node's existing artifacts to understand current code before making changes." : "Generate artifacts using add_artifact for each file."}
4. For existing files that need changes, use update_artifact. For new files, use add_artifact.
5. Do NOT create or modify architecture nodes, edges, or containers. ONLY generate artifacts.

CONTENT RULES -- NON-NEGOTIABLE:
- Each add_artifact or update_artifact call MUST contain the FULL file content, not a snippet or partial excerpt.
- NEVER output abbreviated code such as "// ... rest of implementation", "// TODO: implement", "/* existing code */", or similar placeholders. Every function body must be complete and runnable.
- Generated code MUST import from and reference the actual types/schemas defined on connected edges. Use the contract schemas you read in step 2.
- Use the node's technology to determine the language and conventions.

MINIMUM FILE CHECKLIST (adapt to the node's role and technology):
- backend-service: entry point, route handlers, types/interfaces, error handling module
- frontend-app: main entry, core page/component, API client with typed methods, shared types
- database: schema migration file, seed data if applicable
- rest-api / graphql: schema definition, resolver/handler stubs with full signatures

QUALITY REQUIREMENTS:
- Production-quality structure: proper imports, error handling, type safety
- Each file should have a single responsibility
- Name files using the convention of the target language`;
}

function buildWorkflowSection(ctx: ToolContext, intent?: UserIntent): string {
  const nodeCount = Object.keys(ctx.graph.nodes).length;
  const isExistingArchitecture = nodeCount > 0;
  const isRefinement = isExistingArchitecture && (intent === "refinement" || intent === "architecture");
  const isGeneration = !isExistingArchitecture || intent === "generate_all";

  if (isRefinement) {
    return `WORKFLOW (REFINEMENT MODE -- architecture already has ${nodeCount} nodes):
1. Read the user's message carefully. They are asking for a SPECIFIC change, not a full rebuild.
2. Use read_graph or read_hierarchy to understand the current state if needed.
3. Make ONLY the changes the user requested.
4. If the user's request is unclear, respond with a text summary asking for clarification.
5. After making changes, briefly summarize what you changed and why.

REFINEMENT RULES:
- Do NOT run a completeness check or fill coverage gaps unless explicitly asked.
- Do NOT add nodes for uncovered requirements unless asked.
- Do NOT reorganize containment hierarchy unless asked.
- Do NOT touch nodes, edges, or containers unrelated to the request.
- Prefer minimal, surgical changes over sweeping restructuring.`;
  }

  if (isGeneration) {
    return `WORKFLOW (INITIAL GENERATION):
1. Review the specification and requirements.
2. Plan the architecture covering all requirements.
3. Create all primary nodes (Tier 1) with add_node.
4. Create logical boundaries (Tier 2), then use set_parent to nest primary nodes inside them.
5. If deployment is in scope: create infrastructure containers (Tier 3) and nest boundaries inside them.
6. Call add_edge for EVERY runtime connection.
7. Use remove_node/remove_edge ONLY when the user explicitly asks.
8. Before finishing, run a COMPLETENESS CHECK:
   - Every requirement must be traceable to at least one implementing architecture node.
   - A web application must include at least one frontend or client-facing component.
   - Every database/storage node must be reachable from at least one service via an edge.
   - Every container node must have at least one child.
   - Every non-container node must have at least one edge.
   Fix any gaps found before summarizing.
9. Summarize what was created vs. what already existed.`;
  }

  return `WORKFLOW:
1. Review the specification, requirements, and the existing architecture.
2. Identify what the user wants changed or added based on their message.
3. Make targeted changes: add, update, or remove only the nodes and edges relevant to the request.
4. After changes, verify the affected area is consistent.
5. Summarize what was changed.`;
}

function buildArchitecturePrompt(ctx: ToolContext, projectContext: ProjectContext, userMessage?: string, sessionState?: ArchSessionState, intent?: UserIntent): string {
  const graphContext = buildSmartGraphContext(ctx, { userMessage });

  const lockedCount = ctx.lockedNodeIds.size;
  const lockedSection = lockedCount > 0 ? `
LOCKED NODES (${lockedCount} total):
Nodes marked [LOCKED] are user-protected. You MUST NOT update or remove them.
You MAY create new edges connecting to/from locked nodes.
` : "";

  const archetypes = extractScopeArchetypes(projectContext);
  const existingRoleIds = [...new Set(Object.values(ctx.graph.nodes).map((n) => n.type))];
  const filter: ProjectRelevanceFilter = { archetypes, existingRoleIds };

  const scopedCtx = scopeProjectContext(projectContext, userMessage);
  const projectContextText = formatScopedProjectContext(projectContext, scopedCtx, PROJECT_CONTEXT_CHAR_CAP_ARCHITECTURE);

  let technologyGuidance: string;
  let inContextTechIds: Set<string> | undefined;
  if (sessionState?.cachedTechGuidance !== undefined) {
    technologyGuidance = sessionState.cachedTechGuidance;
    if (sessionState.relevanceResult) {
      inContextTechIds = new Set([
        ...sessionState.relevanceResult.mustInclude,
        ...sessionState.relevanceResult.stronglyRelevant,
        ...sessionState.relevanceResult.contextuallyRelevant,
      ]);
    }
  } else if (sessionState?.relevanceResult) {
    technologyGuidance = buildTieredTechnologyGuidance(ctx.catalogs!, sessionState.relevanceResult);
    inContextTechIds = new Set([
      ...sessionState.relevanceResult.mustInclude,
      ...sessionState.relevanceResult.stronglyRelevant,
      ...sessionState.relevanceResult.contextuallyRelevant,
    ]);
    if (sessionState) sessionState.cachedTechGuidance = technologyGuidance;
  } else {
    technologyGuidance = "";
  }

  const catalogListing = getCatalogSummaryForPrompt(ctx.catalogs!, filter, inContextTechIds);
  const archetypeGuidance = buildArchetypeArchitectureGuidance(archetypes, projectContext, ctx.catalogs);

  let deploymentBlock = "";
  if (sessionState?.cachedDeploymentGuidance !== undefined) {
    deploymentBlock = sessionState.cachedDeploymentGuidance;
  } else {
    const deploymentTarget = extractDeploymentTarget(projectContext);
    if (deploymentTarget) {
      deploymentBlock = buildDeploymentTargetGuidance(deploymentTarget, archetypes, ctx.catalogs);
    }
    if (sessionState) sessionState.cachedDeploymentGuidance = deploymentBlock;
  }

  return `You are an expert software architect that designs system architectures by creating and connecting components on a visual graph.

${projectContextText}

PROJECT SCOPE ARCHETYPE(S): ${archetypes.join(", ")}

CURRENT GRAPH STATE:
${graphContext}
${lockedSection}
ARCHETYPE REFERENCE ARCHITECTURE:
${archetypeGuidance}

The reference architecture above is your PRIMARY design guide.
${deploymentBlock}
${buildPlatformCoexistenceGuidance()}

ROLE-BASED NODE MODEL:
Every node has two independent dimensions:
1. **role** (required) -- the architectural purpose
2. **technology** (optional) -- the implementation choice

CATALOG SUMMARY:
${catalogListing}
${technologyGuidance}
Use lookup_catalog to get detailed role descriptions, technology lists, best practices, and anti-patterns.

NODE TAXONOMY -- Three tiers:

KEY DISTINCTION: Roles marked [LOGICAL BOUNDARY] are purely visual grouping -- they have NO runtime, deployment, or hosting semantics. They do not represent a process, a network, or a deployment unit. Only roles marked [HOSTING CONTAINER] represent where code actually runs.

TIER 1 -- PRIMARY NODES (Leaf Components):
Roles NOT marked [HOSTING CONTAINER] or [LOGICAL BOUNDARY]. Create ALL primary nodes FIRST. Always include rationale.

TIER 2 -- LOGICAL BOUNDARIES (Visual Grouping Only):
Roles marked [LOGICAL BOUNDARY]. Group related primary nodes for visual clarity. They are organizational labels on the canvas, not infrastructure. A microservice-boundary does NOT mean the services inside share a process, deployment unit, or network boundary -- it only means they belong to the same domain visually.

TIER 3 -- INFRASTRUCTURE CONTAINERS (Deployment Topology):
Roles marked [HOSTING CONTAINER]. Represent WHERE things run. Create when deployment or infrastructure is part of the project scope. These have real runtime meaning -- a vpc is a network boundary, a k8s-namespace is a scheduling scope, a docker-container is a process.

GENERATION STRATEGY -- SKELETON FIRST:
Build the complete architecture skeleton before deep per-component detailing. Work in this order:
1. Create the full set of Tier 1 primary nodes covering every requirement, then Tier 2 logical boundaries, then Tier 3 infrastructure containers.
2. Add the initial edge logic (the primary runtime communication paths between nodes) so the system's shape is connected end-to-end.
3. ONLY AFTER the connected skeleton exists, go back and enrich components with detailed contracts, specs, and rationale.
Do NOT fully detail one component before the rest of the skeleton exists -- breadth before depth. Do NOT generate or populate task documents here; task generation is deterministic and happens after the architecture nodes exist.
Run the requirement-coverage sweep only after the connected skeleton is in place. If budget runs low, it is acceptable to leave the coverage sweep or deep detailing for a later resume rather than blocking -- prior progress is preserved and continued on resume.

CONTAINMENT RULES:
- NEVER create an edge between a container and its children. Parent-child = parentId only.
- Edges represent runtime communication, NOT containment.
- Only roles marked [HOSTING CONTAINER] or [LOGICAL BOUNDARY] can accept children.
- When using set_parent, you can specify placementKind to describe the semantic relationship:
  Allowed values: ${PLACEMENT_KIND_VALUES.join(', ')}
  - "hosts" -- infrastructure that runs code (VPC hosts a service, k8s-namespace hosts a pod)
  - "deployed_to" -- deployment target relationship (service deployed to a cloud region)
  - "scopes" -- logical boundary providing organizational grouping (microservice-boundary scopes related services)
  - "contains" -- generic grouping (default if omitted)
- If omitted, placementKind is auto-inferred: infrastructure containers default to "hosts", logical boundaries to "scopes".

CONTRACTS & INTERACTION KINDS:
When adding edges or contracts, use interactionKind to describe the communication pattern precisely:
Allowed interactionKind values: ${INTERACTION_KIND_VALUES.join(', ')}
- request_response: synchronous call expecting a reply (REST, GraphQL, gRPC)
- event: async or realtime event-driven communication (WebSocket, SSE, Kafka, EventBridge, SNS, pub/sub)
- queue: queued work items with guaranteed delivery (SQS, RabbitMQ, NATS, AMQP)
- data_read: reading from a data store (SQL SELECT, cache GET, document fetch)
- data_write: writing to a data store (SQL INSERT/UPDATE, cache SET, document put)
- data_sync: replication or sync protocols between data stores
- file_transfer: blob/object storage operations (S3, GCS, file upload/download)
- auth: authentication and authorization flows (OAuth, SAML, token verification)
- telemetry: observability signals -- metrics, logs, traces
- ipc: inter-process communication, hardware I/O, local sockets
- dependency: compile-time or package dependency (not runtime communication)

Transport and specFormat are auto-inferred from interactionKind but can be overridden:
- transport (allowed): ${TRANSPORT_KIND_VALUES.join(', ')}
- specFormat (allowed): ${SPEC_FORMAT_VALUES.join(', ')}

Legacy contractKind values (${CONTRACT_KIND_VALUES.join(', ')}) are still accepted and automatically resolved to the correct triple.

${buildWorkflowSection(ctx, intent)}

RULES:
- Reference nodes by their exact label (case-insensitive).
- The source of an edge is the node that initiates communication; the target receives it.
- When refining, make targeted changes that address the user's specific request.
- For locked nodes: you cannot update or remove them, but you CAN create edges to/from them.
- If no existing role precisely fits a component the user described, use backend-service and explain in the rationale why. Do not invent role IDs that are not in the catalog.`;
}

function buildSystemPrompt(phase: ProjectPhase, ctx: ToolContext, projectContext: ProjectContext, scaffold?: ScaffoldIntent, userMessage?: string, sessionState?: ArchSessionState, intent?: UserIntent, phaseStatus?: PhaseStatus): string {
  switch (phase) {
    case "specification":
      return buildSpecificationPrompt(projectContext, ctx.catalogs, ctx, phaseStatus);
    case "architecture": {
      const base = buildArchitecturePrompt(ctx, projectContext, userMessage, sessionState, intent);
      if (scaffold?.isScaffold) {
        return base + "\n" + buildScaffoldContextBlock(scaffold, ctx, projectContext);
      }
      return base;
    }
  }
}

const PHASE_STATUS_MESSAGES: Record<ProjectPhase, string> = {
  specification: "Analyzing project requirements...",
  architecture: "Designing architecture...",
};

const AUTO_PROGRESS_MESSAGES: Record<string, string> = {
  architecture: "Specification complete. Now designing the architecture...",
};

function buildArchitectureKickoffMessage(
  projectContext: ProjectContext,
  originalUserMessage: string
): string {
  const reqs = projectContext.requirements;
  const spec = projectContext.specification;

  if (reqs.length === 0 && !spec) {
    return `The user asked: "${originalUserMessage}". Now proceed with the architecture phase. Create architecture nodes based on the conversation so far. Focus on producing a coherent, implementable architecture.`;
  }

  const categoryMap: Record<string, number> = {};
  let totalAC = 0;
  for (const r of reqs) {
    categoryMap[r.category] = (categoryMap[r.category] || 0) + 1;
    if (r.acceptance_criteria) totalAC += r.acceptance_criteria.length;
  }

  const categoryBreakdown = Object.entries(categoryMap)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, count]) => `${cat}: ${count}`)
    .join(", ");

  const archetypes = extractScopeArchetypes(projectContext);

  const prefs = spec?.preferences as Record<string, unknown> | null;
  const techParts: string[] = [];
  if (prefs) {
    if (prefs.language) techParts.push(`Language: ${prefs.language}`);
    if (prefs.framework) techParts.push(`Framework: ${prefs.framework}`);
    if (prefs.deploymentTarget) techParts.push(`Deployment: ${prefs.deploymentTarget}`);
    if (prefs.database) techParts.push(`Database: ${prefs.database}`);
    if (Array.isArray(prefs.additionalTechnologies) && prefs.additionalTechnologies.length) {
      techParts.push(`Additional: ${(prefs.additionalTechnologies as string[]).join(", ")}`);
    }
  }

  const reqList = reqs.map((r) => {
    const acCount = r.acceptance_criteria?.length || 0;
    return `- [${r.category}] ${r.name} (${acCount} AC)`;
  }).join("\n");

  const sections: string[] = [];
  sections.push(`ARCHITECTURE KICKOFF: The user originally asked: "${originalUserMessage}".`);
  sections.push(`\nSPECIFICATION SUMMARY:`);
  sections.push(`- ${reqs.length} requirements with ${totalAC} acceptance criteria total`);
  sections.push(`- Categories: ${categoryBreakdown}`);
  sections.push(`- Scope archetype(s): ${archetypes.join(", ")}`);

  if (techParts.length > 0) {
    sections.push(`- Technology preferences: ${techParts.join(" | ")}`);
  }

  if (spec?.vision) {
    const visionSnippet = spec.vision.length > 300 ? spec.vision.substring(0, 300) + "..." : spec.vision;
    sections.push(`- Vision: ${visionSnippet}`);
  }

  sections.push(`\nREQUIREMENTS TO IMPLEMENT:\n${reqList}`);

  sections.push(`\nINSTRUCTIONS:`);
  sections.push(`Create architecture nodes that implement these requirements. Every functional requirement must trace to at least one primary node.`);
  sections.push(`Do NOT call get_requirements -- all requirements are listed above.`);
  sections.push(`Scale architectural complexity to match: ${reqs.length} requirements, ${totalAC} acceptance criteria, archetype(s) ${archetypes.join(" + ")}.`);

  return sections.join("\n");
}

interface PhaseResult {
  summary: string;
  toolCallCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  paused?: boolean;
  /** Accumulated compact work-log for resumable runs (see MAX_TRANSCRIPT_ENTRIES). */
  transcript?: string[];
}

const MAX_TRANSCRIPT_ENTRIES = 80;
const TRANSCRIPT_REASONING_CAP = 280;

function describeToolCallForLog(fnName: string, args: Record<string, unknown>): string {
  const src = typeof args.sourceLabel === "string" ? args.sourceLabel : "";
  const dst = typeof args.targetLabel === "string" ? args.targetLabel : "";
  const label =
    (typeof args.label === "string" && args.label) ||
    (typeof args.name === "string" && args.name) ||
    (typeof args.nodeLabel === "string" && args.nodeLabel) ||
    (typeof args.path === "string" && args.path) ||
    (src && dst ? `${src} -> ${dst}` : "") ||
    (typeof args.nodeId === "string" && args.nodeId) ||
    "";
  return label ? `${fnName}: ${label}` : fnName;
}

function appendTurnToLog(
  workLog: string[],
  reasoning: string | null,
  actions: string[]
): void {
  const parts: string[] = [];
  if (reasoning && reasoning.trim()) {
    const trimmed = reasoning.trim().slice(0, TRANSCRIPT_REASONING_CAP);
    parts.push(`Reasoning: ${trimmed}`);
  }
  if (actions.length > 0) {
    parts.push(`Actions: ${actions.join("; ")}`);
  }
  if (parts.length === 0) return;
  workLog.push(parts.join(" | "));
  if (workLog.length > MAX_TRANSCRIPT_ENTRIES) {
    workLog.splice(0, workLog.length - MAX_TRANSCRIPT_ENTRIES);
  }
}

const TRUNCATION_REASONS = new Set(["length", "max_tokens", "MAX_TOKENS"]);
const DEFAULT_MAX_TOKENS = 16384;
const RETRY_MAX_TOKENS = 32768;

function isTruncated(finishReason: string): boolean {
  return TRUNCATION_REASONS.has(finishReason);
}

async function runSinglePhaseV4(
  providerConfig: ProviderConfig,
  model: string,
  temperature: number,
  maxTurns: number,
  ctx: ToolContext,
  phase: ProjectPhase,
  projectContext: ProjectContext,
  userMessage: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> | undefined,
  systemPromptOverride?: string,
  scaffold?: ScaffoldIntent,
  sessionState?: ArchSessionState,
  intent?: UserIntent,
  phaseStatus?: PhaseStatus,
  deadline?: DeadlineController,
  priorTranscript?: string[]
): Promise<PhaseResult> {
  const tools = getToolsForPhase(phase) as ToolDefinition[];
  const systemPrompt = systemPromptOverride || buildSystemPrompt(phase, ctx, projectContext, scaffold, userMessage, sessionState, intent, phaseStatus);
  const isHeavyPhase = phase === "architecture";
  const workLog: string[] = priorTranscript ? [...priorTranscript] : [];

  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  if (conversationHistory && conversationHistory.length > 0) {
    const summarized = summarizeConversationHistory(conversationHistory);
    for (const msg of summarized) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // On resume the prior message history is gone, but the work-log lets the model
  // pick up its own reasoning trail instead of re-planning from scratch. Fold it
  // into the kickoff user message so roles stay clean.
  const leadUserMessage = workLog.length > 0
    ? `${userMessage}\n\nPROGRESS SO FAR (already completed earlier in this run -- do NOT recreate these nodes/edges/artifacts; continue from here):\n${workLog.join("\n")}`
    : userMessage;
  messages.push({ role: "user", content: leadUserMessage });

  let turnCount = 0;
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  let retryWithHigherLimit = false;

  while (turnCount < maxTurns) {
    if (deadline && turnCount > 0 && deadline.shouldPause()) {
      return {
        summary: "Paused to continue in the next turn.",
        toolCallCount,
        turnCount,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        paused: true,
        transcript: workLog,
      };
    }

    turnCount++;

    const maxTokens = retryWithHigherLimit ? RETRY_MAX_TOKENS : DEFAULT_MAX_TOKENS;
    retryWithHigherLimit = false;

    const callStart = Date.now();
    let result: ChatCompletionResult;
    try {
      result = await sendChatCompletion(providerConfig, {
        model,
        temperature,
        messages,
        tools,
        toolChoice: "auto",
        maxTokens,
        maxDurationMs: deadline?.remaining(),
        // Heavy architecture turns get bounded adaptive thinking + a cached prompt
        // prefix; light phases skip thinking (and caching) to land more turns.
        thinking: isHeavyPhase ? "adaptive" : "off",
        effort: isHeavyPhase ? "medium" : undefined,
        enablePromptCache: isHeavyPhase,
      });
    } catch (err) {
      if (deadline && isLlmTimeoutError(err)) {
        // Budget-driven abort: convert the platform hard-kill risk into a clean,
        // resumable pause instead of a fatal error.
        deadline.recordCall(Date.now() - callStart);
        return {
          summary: "Paused to continue in the next turn.",
          toolCallCount,
          turnCount,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          paused: true,
          transcript: workLog,
        };
      }
      throw err;
    }
    deadline?.recordCall(Date.now() - callStart);

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;

    if (isTruncated(result.finishReason)) {
      console.warn(`[agent-loop] Output truncated (finish_reason=${result.finishReason}), retrying with higher limit`);
      ctx.emitter.status("Response was cut short, retrying with more capacity...");
      retryWithHigherLimit = true;
      continue;
    }

    messages.push(toNormalizedMessages(result));

    if (result.finishReason === "stop" || result.toolCalls.length === 0) {
      return {
        summary: result.content || "Phase completed.",
        toolCallCount,
        turnCount,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        transcript: workLog,
      };
    }

    const turnActions: string[] = [];

    for (const toolCall of result.toolCalls) {
      // Mid-turn deadline guard: do not start a new (possibly slow) tool once the
      // remaining budget is below the reserve. Mutations already applied are
      // persisted on the pause checkpoint, so dropping the rest is safe.
      if (deadline && deadline.remaining() < MIN_TOOL_EXEC_RESERVE_MS) {
        appendTurnToLog(workLog, result.content, turnActions);
        deadline.recordCall(Date.now() - callStart);
        return {
          summary: "Paused mid-turn to continue in the next turn.",
          toolCallCount,
          turnCount,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          paused: true,
          transcript: workLog,
        };
      }

      toolCallCount++;
      const fnName = toolCall.function.name;

      let args: Record<string, unknown> = {};
      let parseFailed = false;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        parseFailed = true;
      }

      if (parseFailed) {
        console.warn(`[agent-loop] JSON parse failed for tool ${fnName}, likely truncated output`);
        messages.push({
          role: "tool",
          content: JSON.stringify({ error: `Tool call '${fnName}' failed: the arguments JSON was malformed or truncated. This usually means the output was cut off. Please retry this specific call with complete content.` }),
          tool_call_id: toolCall.id,
        });
        retryWithHigherLimit = true;
        continue;
      }

      ctx.emitter.thinking(getToolDisplayName(fnName));
      const toolResult = await executeTool(ctx, fnName, args);

      if (!(toolResult && typeof toolResult === "object" && "error" in toolResult)) {
        turnActions.push(describeToolCallForLog(fnName, args));
      }

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
        tool_call_id: toolCall.id,
      });
    }

    appendTurnToLog(workLog, result.content, turnActions);

    // Record the full-turn duration (LLM + tools) so the reserve estimate that
    // drives shouldPause() reflects real turn cost, not just the LLM call.
    deadline?.recordCall(Date.now() - callStart);
  }

  return {
    summary: "Reached turn limit for this phase.",
    toolCallCount,
    turnCount,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    transcript: workLog,
  };
}

async function runValidationPassV4(
  providerConfig: ProviderConfig,
  model: string,
  ctx: ToolContext,
  projectContext: ProjectContext,
  userMessage?: string
): Promise<{ toolCallCount: number; turnCount: number; inputTokens: number; outputTokens: number; report: ValidationReport }> {
  const spec = {
    vision: projectContext.specification?.vision || "",
    preferences: (projectContext.specification?.preferences || {}) as Record<string, unknown>,
    constraints: (projectContext.specification?.constraints || []) as Array<{ type: string; description: string }>,
    requirements: projectContext.requirements.map((r) => ({
      id: r.id,
      requirement_id: r.requirement_id,
      name: r.name,
      category: r.category,
    })),
  };

  const report = runStructuralValidation(ctx.graph, ctx.catalogs, spec);

  const errors = report.issues.filter((i) => i.severity === "error");
  const warnings = report.issues.filter((i) => i.severity === "warning");

  if (errors.length === 0) {
    if (warnings.length > 0) {
      ctx.emitter.status(`Architecture has ${warnings.length} warning(s) -- no auto-fix needed.`);
    }
    return { toolCallCount: 0, turnCount: 0, inputTokens: 0, outputTokens: 0, report };
  }

  ctx.emitter.validationStarted(errors.length);
  ctx.emitter.status(`Fixing ${errors.length} architecture error(s)...`);

  const errorOnlyReport: ValidationReport = { issues: errors, nodeCount: report.nodeCount, edgeCount: report.edgeCount, containerCount: report.containerCount, orphanCount: report.orphanCount };
  const validationPrompt = buildValidationPrompt(ctx.graph, errorOnlyReport, spec);

  const userContext = userMessage
    ? `\nORIGINAL USER REQUEST: "${userMessage}"\nDo not undo intentional design choices that serve this request.`
    : "";

  const tools = getToolsForPhase("architecture") as ToolDefinition[];
  const messages: ChatMessage[] = [
    { role: "system", content: validationPrompt },
    { role: "user", content: `Fix the ${errors.length} validation error(s) listed above. Make the minimum corrective changes.${userContext}` },
  ];

  let turnCount = 0;
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const maxTurns = 8;
  let retryWithHigherLimit = false;

  while (turnCount < maxTurns) {
    turnCount++;

    const maxTokens = retryWithHigherLimit ? RETRY_MAX_TOKENS : DEFAULT_MAX_TOKENS;
    retryWithHigherLimit = false;

    const result = await sendChatCompletion(providerConfig, {
      model,
      temperature: 0.2,
      messages,
      tools,
      toolChoice: "auto",
      maxTokens,
      thinking: "adaptive",
      effort: "medium",
      enablePromptCache: true,
    });

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;

    if (isTruncated(result.finishReason)) {
      console.warn(`[agent-loop] Validation output truncated (finish_reason=${result.finishReason}), retrying with higher limit`);
      ctx.emitter.status("Validation response was cut short, retrying...");
      retryWithHigherLimit = true;
      continue;
    }

    messages.push(toNormalizedMessages(result));

    if (result.finishReason === "stop" || result.toolCalls.length === 0) break;

    for (const toolCall of result.toolCalls) {
      toolCallCount++;
      const fnName = toolCall.function.name;

      let args: Record<string, unknown> = {};
      let parseFailed = false;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        parseFailed = true;
      }

      if (parseFailed) {
        console.warn(`[agent-loop] JSON parse failed for validation tool ${fnName}, likely truncated output`);
        messages.push({
          role: "tool",
          content: JSON.stringify({ error: "Your previous tool call was truncated and produced invalid JSON. Please retry with the complete content." }),
          tool_call_id: toolCall.id,
        });
        retryWithHigherLimit = true;
        continue;
      }

      ctx.emitter.thinking(getToolDisplayName(fnName, true));
      const toolResult = await executeTool(ctx, fnName, args);

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
        tool_call_id: toolCall.id,
      });
    }
  }

  const postReport = runStructuralValidation(ctx.graph, ctx.catalogs, spec);
  const issuesFixed = report.issues.length - postReport.issues.length;
  ctx.emitter.validationComplete(Math.max(issuesFixed, 0), postReport.issues.length);

  return { toolCallCount, turnCount, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, report: postReport };
}

function buildChatGraphContext(graph: GraphState): string {
  const nodeList = Object.values(graph.nodes);
  const edgeList = Object.values(graph.edges);

  if (nodeList.length === 0) return "The architecture graph is currently empty.";

  const childMap: Record<string, typeof nodeList> = {};
  const topLevel: typeof nodeList = [];
  for (const n of nodeList) {
    if (!n.parentId) {
      topLevel.push(n);
    } else {
      if (!childMap[n.parentId]) childMap[n.parentId] = [];
      childMap[n.parentId].push(n);
    }
  }

  function walk(node: (typeof nodeList)[0], depth: number, lines: string[]) {
    const indent = "  ".repeat(depth);
    const tech = node.technology ? ` (${node.technology})` : "";
    const rationale = typeof node.metadata?.rationale === "string" ? node.metadata.rationale : "";
    let line = `${indent}- "${node.label}" [${node.type}${tech}]`;
    if (rationale) line += `\n${indent}  Purpose: ${rationale}`;
    lines.push(line);
    const children = childMap[node.id];
    if (children) {
      for (const child of children) walk(child, depth + 1, lines);
    }
  }

  const hierarchyLines: string[] = [];
  for (const n of topLevel) walk(n, 1, hierarchyLines);

  const edgeLines = edgeList.map((e) => {
    const src = graph.nodes[e.source];
    const tgt = graph.nodes[e.target];
    const contract = graph.contracts[e.contractId];
    return `  ${src?.label || "?"} -> ${tgt?.label || "?"} [${contract?.kind || "?"}: "${contract?.name || "?"}"]`;
  });

  const sections = [`Architecture: ${nodeList.length} nodes, ${edgeList.length} edges`, `\nHierarchy:\n${hierarchyLines.join("\n")}`];
  if (edgeLines.length > 0) {
    sections.push(`\nConnections:\n${edgeLines.join("\n")}`);
  }
  return sections.join("\n");
}

async function runChatResponseV4(
  providerConfig: ProviderConfig,
  model: string,
  temperature: number,
  projectContext: ProjectContext,
  graph: GraphState,
  userMessage: string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ summary: string; inputTokens: number; outputTokens: number }> {
  const projectContextText = formatProjectContext(projectContext);
  const graphContext = buildChatGraphContext(graph);

  const systemPrompt = `You are a helpful software architecture assistant. You are embedded in a visual architecture design tool called NodeSpec.

${projectContextText ? `PROJECT CONTEXT:\n${projectContextText}\n` : "This project has no specification yet.\n"}
CURRENT ARCHITECTURE:
${graphContext}

You are in CONVERSATION mode. The user is chatting, asking a question, or greeting you. Respond naturally and helpfully.

RULES:
- Do NOT make any changes to the architecture, specification, or any project data.
- If the user seems to want changes but phrased it ambiguously, ask them to clarify what they'd like you to do.
- If the user asks about the project, answer using the full project context and architecture details above. Reference specific nodes, requirements, and connections by name when relevant.
- If the user asks "why" a component exists, reference its rationale and the requirement it traces to.
- If the user asks what could be added or improved, base your suggestions on gaps between the requirements and the current architecture.
- If the user greets you, respond warmly and briefly mention what you can help with.
- Keep responses concise and friendly.`;

  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  if (conversationHistory && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-4);
    for (const msg of recent) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: "user", content: userMessage });

  const result = await sendChatCompletion(providerConfig, { model, temperature, messages, thinking: "off" });

  return {
    summary: result.content || "Hello! I can help you design and refine your architecture. What would you like to do?",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

interface CheckpointSaveInput {
  supabase: SupabaseClient;
  request: AgentRequestV4;
  sessionId: string;
  existing: AgentCheckpoint | null;
  stage: ResumeStage;
  currentPhase: ProjectPhase;
  autoProgress: boolean;
  intent: UserIntent;
  patches: PatchOperation[];
  graph: GraphState;
  archSession: ArchSessionState;
  counters: {
    totalToolCalls: number;
    totalTurns: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  summaryParts: string[];
  currentMessage: string;
  transcript: string[];
}

async function saveCheckpoint(input: CheckpointSaveInput): Promise<{ id: string; attemptCount: number }> {
  const attemptCount = (input.existing?.attemptCount ?? 0) + 1;
  const row = {
    session_id: input.sessionId,
    project_id: input.request.projectId,
    branch_id: input.request.branchId,
    user_id: input.request.userId,
    status: "paused",
    attempt_count: attemptCount,
    current_phase: input.currentPhase,
    detected_intent: input.intent,
    specification_id: input.request.specificationId ?? null,
    patches: input.patches,
    graph_snapshot: input.graph,
    arch_session: input.archSession,
    counters: {
      ...input.counters,
      stage: input.stage,
      autoProgress: input.autoProgress,
      summaryParts: input.summaryParts,
      currentMessage: input.currentMessage,
    },
    summary: input.summaryParts[input.summaryParts.length - 1] ?? null,
    user_message: input.request.userMessage,
    transcript: input.transcript,
    updated_at: new Date().toISOString(),
  };

  if (input.existing) {
    await input.supabase
      .from("agent_run_checkpoints")
      .update(row)
      .eq("id", input.existing.id);
    return { id: input.existing.id, attemptCount };
  }

  const { data } = await input.supabase
    .from("agent_run_checkpoints")
    .insert(row)
    .select("id")
    .maybeSingle();
  return { id: (data?.id as string) ?? crypto.randomUUID(), attemptCount };
}

async function markCheckpointComplete(
  supabase: SupabaseClient,
  checkpointId: string
): Promise<void> {
  await supabase
    .from("agent_run_checkpoints")
    .update({ status: "complete", updated_at: new Date().toISOString() })
    .eq("id", checkpointId);
}

export async function loadCheckpoint(
  supabase: SupabaseClient,
  checkpointId: string,
  userId: string
): Promise<AgentCheckpoint | null> {
  const { data } = await supabase
    .from("agent_run_checkpoints")
    .select("*")
    .eq("id", checkpointId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data || data.status === "complete") return null;

  const counters = (data.counters ?? {}) as Record<string, unknown>;
  return {
    id: data.id as string,
    sessionId: data.session_id as string,
    attemptCount: (data.attempt_count as number) ?? 0,
    stage: (counters.stage as ResumeStage) ?? "phases",
    currentPhase: (data.current_phase as ProjectPhase) ?? "architecture",
    autoProgress: (counters.autoProgress as boolean) ?? false,
    intent: (data.detected_intent as UserIntent) ?? "architecture",
    specificationId: (data.specification_id as string) ?? null,
    patches: (data.patches as PatchOperation[]) ?? [],
    graphSnapshot: (data.graph_snapshot as GraphState) ?? null,
    archSession: (data.arch_session as ArchSessionState) ?? null,
    counters: {
      totalToolCalls: (counters.totalToolCalls as number) ?? 0,
      totalTurns: (counters.totalTurns as number) ?? 0,
      totalInputTokens: (counters.totalInputTokens as number) ?? 0,
      totalOutputTokens: (counters.totalOutputTokens as number) ?? 0,
    },
    summaryParts: (counters.summaryParts as string[]) ?? [],
    currentMessage: (counters.currentMessage as string) ?? (data.user_message as string) ?? "",
    transcript: (data.transcript as string[]) ?? [],
  };
}

export async function runAgentLoopV4(
  supabase: SupabaseClient,
  request: AgentRequestV4,
  emitter: SSEEmitter
): Promise<AgentResult> {
  const providerConfig = request.providerConfig;
  const maxTurns = request.maxTurns ?? 30;
  const model = request.model ?? providerConfig.model;
  const heavyModel = providerConfig.heavyModel || model;
  const temperature = request.temperature ?? 0.4;

  const resume = request.resumeCheckpoint ?? null;
  const sessionId = request.sessionId ?? resume?.sessionId ?? crypto.randomUUID();
  const isFinalAttempt = request.isFinalAttempt ?? false;
  const deadline = new DeadlineController();
  let checkpoint: AgentCheckpoint | null = resume;

  emitter.status(resume ? "Resuming previous work..." : "Loading project context...");
  const [graph, lockedNodeIds, projectContext, catalogs] = await Promise.all([
    loadGraphState(supabase, request.projectId, request.branchId),
    loadLockedNodeIds(supabase, request.projectId, request.specificationId),
    loadProjectContext(supabase, request.specificationId),
    loadCatalogs(supabase),
  ]);

  const ctx: ToolContext = {
    supabase,
    userId: request.userId,
    projectId: request.projectId,
    branchId: request.branchId,
    specificationId: request.specificationId,
    graph: resume?.graphSnapshot ?? graph,
    lockedNodeIds,
    patches: resume?.patches ?? [],
    pendingTraceUpdates: [],
    emitter,
    catalogs,
    providerConfig,
  };

  // Scaffold detection runs FIRST - these are structured messages from the UI
  const scaffold = detectScaffoldIntent(request.userMessage);
  const phaseStatus = await loadPhaseStatus(supabase, request.specificationId);

  let intent: UserIntent;
  if (resume) {
    intent = resume.intent;
  } else {
    // Resolve intent with confidence scoring
    const intentResult = detectUserIntent(request.userMessage);
    intent = intentResult.intent;

    // For low/medium confidence, use LLM classification fallback
    if (intentResult.confidence === "low" || (intentResult.confidence === "medium" && !scaffold.isScaffold)) {
      const llmIntent = await classifyAmbiguousIntent(providerConfig, model, request.userMessage);
      intent = llmIntent;
    }

    // If scaffold is detected, override intent to architecture
    if (scaffold.isScaffold) {
      intent = "architecture";
    }
  }

  const isConfirmation = !resume
    && phaseStatus === "drafting_requirements"
    && projectContext.requirements.length > 0
    && /\b(confirm|proceed|go\s*ahead|looks?\s*good|sounds?\s*good|yes|approve|lgtm|ship\s*it|continue|ready|let'?s\s*go)\b/i.test(request.userMessage);

  if (isConfirmation && (intent === "chat" || intent === "refinement")) {
    if (request.specificationId) {
      await updatePhaseStatus(supabase, request.specificationId, "requirements_confirmed");
    }
    intent = "generate_all";
  }

  if (!resume && intent === "clarification") {
    emitter.status("Thinking...");
    const clarificationMsg = "I'd like to help, but I need a bit more detail. Could you tell me more about what you'd like to accomplish? For example:\n- Are you looking to build a new application or system?\n- Do you want to modify something in your existing architecture?\n- Do you have a question about your project?";
    emitter.complete(clarificationMsg, []);
    return {
      summary: clarificationMsg,
      patches: [],
      toolCallCount: 0,
      turnCount: 1,
      inputTokens: 0,
      outputTokens: 0,
      model,
    };
  }

  if (!resume && (intent === "chat" || intent === "question")) {
    emitter.status("Thinking...");
    const chatResult = await runChatResponseV4(providerConfig, model, temperature, projectContext, graph, request.userMessage, request.conversationHistory);
    emitter.complete(chatResult.summary, []);
    return {
      summary: chatResult.summary,
      patches: [],
      toolCallCount: 0,
      turnCount: 1,
      inputTokens: chatResult.inputTokens,
      outputTokens: chatResult.outputTokens,
      model,
    };
  }

  const dataPhase = detectDataPhase(projectContext, graph, phaseStatus);
  let currentPhase = resume
    ? resume.currentPhase
    : request.systemPromptOverride ? dataPhase : resolvePhase(dataPhase, intent, phaseStatus);
  let autoProgress = resume
    ? resume.autoProgress
    : !request.systemPromptOverride && shouldAutoProgress(intent, dataPhase);

  if (isConfirmation) {
    currentPhase = resolvePhase(dataPhase, intent, phaseStatus);
    autoProgress = shouldAutoProgress(intent, dataPhase);
  }

  emitter.status(PHASE_STATUS_MESSAGES[currentPhase]);

  let totalToolCalls = resume?.counters.totalToolCalls ?? 0;
  let totalTurns = resume?.counters.totalTurns ?? 0;
  let totalInputTokens = resume?.counters.totalInputTokens ?? 0;
  let totalOutputTokens = resume?.counters.totalOutputTokens ?? 0;
  const summaryParts: string[] = resume?.summaryParts ?? [];
  let currentContext = projectContext;
  let currentMessage = resume?.currentMessage ?? request.userMessage;
  let currentTranscript: string[] = resume?.transcript ?? [];
  let stage: ResumeStage = resume?.stage ?? "phases";
  const isRefinementIntent = intent === "refinement";
  const scaffoldTurnCap = 15;
  const refinementTurnCap = 8;
  const baseTurnsPerPhase = autoProgress ? Math.floor(maxTurns / 3) + 2 : maxTurns;
  const turnsPerPhase = scaffold.isScaffold
    ? Math.max(baseTurnsPerPhase, scaffoldTurnCap)
    : isRefinementIntent && dataPhase === "architecture"
      ? Math.min(baseTurnsPerPhase, refinementTurnCap)
      : baseTurnsPerPhase;
  const archSession: ArchSessionState = resume?.archSession ?? {};

  if (!resume) {
    const relevancePromise = resolveRelevantTechnologies(supabase, catalogs, {
      graphNodes: ctx.graph.nodes,
      specPreferences: projectContext.specification?.preferences as Record<string, unknown> | null,
      userMessage: request.userMessage,
      requirements: projectContext.requirements.map((r) => ({ name: r.name, description: r.description })),
      archetypes: extractScopeArchetypes(projectContext),
    });
    archSession.relevanceResult = await relevancePromise;
  }

  const pauseRun = async (pauseStage: ResumeStage, pausePhase: ProjectPhase): Promise<AgentResult> => {
    const continuationMessage = pauseStage === "phases"
      ? `Continue the architecture work already in progress. The current graph already contains the nodes and edges created previously -- do NOT recreate existing nodes or duplicate work. Review the current architecture and continue where you left off. The user originally asked: "${request.userMessage}".`
      : currentMessage;
    const saved = await saveCheckpoint({
      supabase,
      request,
      sessionId,
      existing: checkpoint,
      stage: pauseStage,
      currentPhase: pausePhase,
      autoProgress,
      intent,
      patches: ctx.patches,
      graph: ctx.graph,
      archSession,
      counters: { totalToolCalls, totalTurns, totalInputTokens, totalOutputTokens },
      summaryParts,
      currentMessage: continuationMessage,
      transcript: currentTranscript,
    });
    emitter.continueNeeded({
      checkpointId: saved.id,
      sessionId,
      attemptCount: saved.attemptCount,
      phase: pausePhase,
      patchCount: ctx.patches.length,
      message: AGENT_CONTINUATION_MESSAGE,
    });
    return {
      summary: summaryParts[summaryParts.length - 1] || AGENT_CONTINUATION_MESSAGE,
      patches: ctx.patches,
      toolCallCount: totalToolCalls,
      turnCount: totalTurns,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      model,
      paused: true,
      checkpointId: saved.id,
    };
  };

  const finalize = async (partial: boolean): Promise<AgentResult> => {
    const noProgress = partial && ctx.patches.length === 0;
    // Keep the checkpoint resumable when we produced nothing to review, so a
    // follow-up "continue" picks up the in-flight architecture instead of
    // starting over. Only mark complete once there is reviewable work.
    if (checkpoint && !noProgress) {
      await markCheckpointComplete(supabase, checkpoint.id);
    }
    let summary = summaryParts[summaryParts.length - 1] || "Changes completed.";
    if (noProgress) {
      summary = PARTIAL_NO_PROGRESS_MESSAGE;
    } else if (partial) {
      const base = summary && summary !== AGENT_CONTINUATION_MESSAGE ? `${summary}\n\n` : "";
      summary = `${base}${PARTIAL_PROPOSAL_MESSAGE}`;
    }
    if (ctx.patches.length > 0) {
      const labels = Object.values(ctx.graph.nodes)
        .map((n) => n.label)
        .filter((l): l is string => Boolean(l));
      if (labels.length > 0) {
        const shown = labels.slice(0, 12);
        const extra = labels.length > shown.length ? `, and ${labels.length - shown.length} more` : "";
        summary = `${summary}\n\nArchitecture components so far: ${shown.join(", ")}${extra}.`;
      }
    }
    emitter.complete(summary, ctx.patches, ctx.pendingTraceUpdates, partial);
    return {
      summary,
      patches: ctx.patches,
      toolCallCount: totalToolCalls,
      turnCount: totalTurns,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      model,
      partial,
    };
  };

  // On the final allowed attempt we must never pause again: finalize whatever
  // work exists into a reviewable (partial) proposal instead.
  const pauseOrFinalize = async (pauseStage: ResumeStage, pausePhase: ProjectPhase): Promise<AgentResult> => {
    if (isFinalAttempt) return await finalize(true);
    return await pauseRun(pauseStage, pausePhase);
  };

  if (stage === "phases") {
    while (true) {
      if (deadline.shouldPause()) {
        return await pauseOrFinalize("phases", currentPhase);
      }

      emitter.status(PHASE_STATUS_MESSAGES[currentPhase]);

      const isInitialPhase = !resume && currentPhase === resolvePhase(dataPhase, intent, phaseStatus);
      const phaseModel = currentPhase === "architecture" ? heavyModel : model;
      const phaseResult = await runSinglePhaseV4(
        providerConfig,
        phaseModel,
        temperature,
        turnsPerPhase,
        ctx,
        currentPhase,
        currentContext,
        currentMessage,
        isInitialPhase ? request.conversationHistory : undefined,
        isInitialPhase ? request.systemPromptOverride : undefined,
        isInitialPhase && scaffold.isScaffold ? scaffold : undefined,
        currentPhase === "architecture" ? archSession : undefined,
        isInitialPhase ? intent : undefined,
        phaseStatus,
        deadline,
        currentTranscript
      );

      totalToolCalls += phaseResult.toolCallCount;
      totalTurns += phaseResult.turnCount;
      totalInputTokens += phaseResult.inputTokens;
      totalOutputTokens += phaseResult.outputTokens;
      if (phaseResult.transcript) currentTranscript = phaseResult.transcript;
      if (!phaseResult.paused) summaryParts.push(phaseResult.summary);

      if (phaseResult.paused) {
        return await pauseOrFinalize("phases", currentPhase);
      }

      if (!autoProgress) break;

      const nextPhase = getNextPhase(currentPhase);
      if (!nextPhase) break;

      const updatedContext = await loadProjectContext(supabase, ctx.specificationId);
      const updatedDataPhase = detectDataPhase(updatedContext, ctx.graph, phaseStatus);

      if (updatedDataPhase === currentPhase) break;

      if (currentPhase === "specification" && phaseStatus === "drafting_requirements" && ctx.specificationId) {
        const reqCount = updatedContext.requirements.length;
        const confirmationMsg = `I've created ${reqCount} requirement${reqCount !== 1 ? "s" : ""} with acceptance criteria. Please review them in the Specification panel. When you're satisfied, confirm to proceed -- architecture and test cases will then be generated.`;
        summaryParts.push(confirmationMsg);
        break;
      }

      currentPhase = nextPhase;
      currentContext = updatedContext;

      if (nextPhase === "architecture" && ctx.specificationId) {
        await updatePhaseStatus(supabase, ctx.specificationId, "building_architecture");
      }

      if (nextPhase === "architecture") {
        const refreshedGraph = await loadGraphState(supabase, request.projectId, request.branchId);
        ctx.graph = refreshedGraph;
      }

      const progressMsg = AUTO_PROGRESS_MESSAGES[nextPhase] || `Continuing to ${nextPhase} phase...`;
      emitter.status(progressMsg);

      if (nextPhase === "architecture") {
        currentMessage = buildArchitectureKickoffMessage(currentContext, request.userMessage);
      } else {
        currentMessage = `Continue from the previous phase. The user originally asked: "${request.userMessage}". Now proceed with the ${nextPhase} phase.`;
      }
    }
    stage = "validation";
  }

  const finalPhase = currentPhase;
  const skipValidation = (isRefinementIntent && !autoProgress) || scaffold.isScaffold;

  if (stage === "validation") {
    if (finalPhase === "architecture" && Object.keys(ctx.graph.nodes).length > 0 && !skipValidation) {
      if (deadline.remaining() < 60_000) {
        return await pauseOrFinalize("validation", finalPhase);
      }
      const latestContext = autoProgress ? currentContext : projectContext;
      try {
        const validation = await runValidationPassV4(providerConfig, heavyModel, ctx, latestContext, request.userMessage);
        totalToolCalls += validation.toolCallCount;
        totalTurns += validation.turnCount;
        totalInputTokens += validation.inputTokens;
        totalOutputTokens += validation.outputTokens;

        if (validation.toolCallCount > 0) {
          const remaining = validation.report.issues.filter((i) => i.severity === "error").length;
          if (remaining === 0) {
            summaryParts.push("Architecture passed quality validation after corrections.");
          } else {
            summaryParts.push(`Architecture validation made corrections but ${remaining} issue(s) may need manual review.`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown validation error";
        emitter.error(`Validation pass failed: ${msg}`);
      }
    }
    stage = "tasks";
  }

  if (stage === "tasks") {
    if (finalPhase === "architecture" && Object.keys(ctx.graph.nodes).length > 0 && ctx.patches.length > 0) {
      if (deadline.remaining() < 45_000) {
        // Not enough budget for task-doc generation. On the final attempt the
        // architecture itself is complete, so skip the supplementary docs and
        // finalize normally; otherwise pause and resume for them.
        if (!isFinalAttempt) {
          return await pauseRun("tasks", finalPhase);
        }
      } else {
        if (ctx.specificationId) {
          await updatePhaseStatus(supabase, ctx.specificationId, "architecture_confirmed");
        }
        try {
          const taskCount = await generateTaskDocumentsForGraph(ctx, projectContext);
          if (taskCount > 0) {
            emitter.status(`Generated ${taskCount} task document${taskCount > 1 ? "s" : ""}...`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.warn(`[agent-loop] Task document generation failed: ${msg}`);
        }
      }
    }
  }

  return await finalize(false);
}

async function generateTaskDocumentsForGraph(
  ctx: ToolContext,
  projectContext: ProjectContext
): Promise<number> {
  const leafNodes = Object.values(ctx.graph.nodes).filter((n) => {
    const role = ctx.catalogs?.nodeRoles[n.type];
    return !role?.is_container;
  });

  if (leafNodes.length === 0) return 0;

  let requirementsByNode: Record<string, Array<{
    requirementId: string;
    name: string;
    description: string;
    category: string;
    status: string;
    acceptanceCriteria: Array<{ text: string; met?: boolean }>;
  }>> = {};
  const requirementNodeMap: Record<string, string[]> = {};

  if (ctx.specificationId) {
    const { data: mappings } = await ctx.supabase
      .from("specification_mappings")
      .select("requirement_id, node_id")
      .eq("specification_id", ctx.specificationId);

    if (mappings && mappings.length > 0) {
      const reqIds = [...new Set(mappings.map((m: { requirement_id: string }) => m.requirement_id))];
      const { data: reqs } = await ctx.supabase
        .from("specification_requirements")
        .select("id, requirement_id, name, description, category, status, acceptance_criteria")
        .in("id", reqIds);

      const reqMap = new Map((reqs || []).map((r: { id: string }) => [r.id, r]));
      for (const m of mappings as Array<{ requirement_id: string; node_id: string }>) {
        if (!requirementsByNode[m.node_id]) requirementsByNode[m.node_id] = [];
        const req = reqMap.get(m.requirement_id);
        if (req) {
          const humanReqId = (req as { requirement_id: string }).requirement_id;
          if (!requirementNodeMap[humanReqId]) requirementNodeMap[humanReqId] = [];
          if (!requirementNodeMap[humanReqId].includes(m.node_id)) {
            requirementNodeMap[humanReqId].push(m.node_id);
          }
          requirementsByNode[m.node_id].push({
            requirementId: humanReqId,
            name: (req as { name: string }).name,
            description: (req as { description: string }).description || "",
            category: (req as { category: string }).category,
            status: (req as { status: string }).status,
            acceptanceCriteria: (req as { acceptance_criteria: Array<{ text: string; met?: boolean }> }).acceptance_criteria || [],
          });
        }
      }
    }
  }

  let count = 0;
  const now = new Date().toISOString();
  const vision = projectContext.specification?.vision || undefined;

  for (const node of leafNodes) {
    const reqs = requirementsByNode[node.id] || [];

    const nodeForGen = {
      id: node.id,
      label: node.label,
      type: node.type,
      technology: node.technology,
      parentId: node.parentId,
      ports: node.ports,
      metadata: node.metadata,
    };

    const content = generateTaskDocument({
      node: nodeForGen,
      graph: ctx.graph,
      catalogs: ctx.catalogs!,
      requirements: reqs,
      projectVision: vision,
      requirementNodeMap,
    });

    const fingerprint = computeTaskContextFingerprint(nodeForGen, ctx.graph, reqs, vision, ctx.catalogs!);

    // P0-4: look up by nodeId + kind, never by recomputed path — a rename used to
    // change the recomputed path, miss here, and create a duplicate artifact.
    const existing = findExistingTaskArtifact(ctx.graph.artifacts, node.id);

    if (existing) {
      if (existing.content === content) continue;

      existing.content = content;
      existing.status = "draft";
      existing.metadata = { ...(existing.metadata || {}), taskContextFingerprint: fingerprint, stale: false };
      ctx.patches.push({
        type: "update_artifact",
        metadata: {
          id: crypto.randomUUID(),
          actorType: "system" as const,
          actorId: "task-generator",
          summary: `Update task document for ${node.label}`,
          timestamp: now,
        },
        payload: {
          id: existing.id,
          nodeId: node.id,
          changes: {
            content,
            status: "draft",
            updatedAt: now,
            metadata: { ...(existing.metadata || {}), taskContextFingerprint: fingerprint, stale: false },
          },
        },
      });
    } else {
      // P0-4: the path is computed only here, at first creation; updates above keep
      // the artifact's persisted path.
      const taskPath = getTaskDocumentPath(node.label, node.id);
      const artifactId = crypto.randomUUID();
      const artifactMetadata = { taskContextFingerprint: fingerprint };
      const artifact = {
        id: artifactId,
        nodeId: node.id,
        kind: "task",
        path: taskPath,
        content,
        language: "markdown",
        status: "draft",
        description: `Implementation task document for ${node.label}`,
        createdAt: now,
        updatedAt: now,
        metadata: artifactMetadata,
      };

      ctx.graph.artifacts[artifactId] = artifact;
      if (!node.artifacts) node.artifacts = [];
      node.artifacts.push(artifactId);

      ctx.patches.push({
        type: "add_artifact",
        metadata: {
          id: crypto.randomUUID(),
          actorType: "system" as const,
          actorId: "task-generator",
          summary: `Generate task document for ${node.label}`,
          timestamp: now,
        },
        payload: {
          id: artifactId,
          nodeId: node.id,
          kind: "task",
          path: taskPath,
          content,
          language: "markdown",
          status: "draft",
          description: `Implementation task document for ${node.label}`,
          createdAt: now,
          updatedAt: now,
          metadata: artifactMetadata,
        },
      });
    }

    count++;
  }

  // Generate test plan documents for requirements mapped to nodes
  if (ctx.specificationId) {
    const reqsWithMappings = new Map<string, { requirement: typeof requirementsByNode[string][number]; mappedNodeIds: string[] }>();

    for (const [nodeId, reqs] of Object.entries(requirementsByNode)) {
      for (const req of reqs) {
        const existing = reqsWithMappings.get(req.requirementId);
        if (existing) {
          existing.mappedNodeIds.push(nodeId);
        } else {
          reqsWithMappings.set(req.requirementId, { requirement: req, mappedNodeIds: [nodeId] });
        }
      }
    }

    for (const [, { requirement, mappedNodeIds }] of reqsWithMappings) {
      const testPath = getTestDocumentPath(requirement.requirementId, requirement.name);

      const mappedNodes = mappedNodeIds
        .map((nid) => ctx.graph.nodes[nid])
        .filter(Boolean)
        .map((n) => ({
          nodeId: n.id,
          label: n.label,
          role: n.type,
          technology: n.technology,
        }));

      const sourceArtifacts = Object.values(ctx.graph.artifacts).filter(
        (a) => mappedNodeIds.includes(a.nodeId) && a.kind === "source" && a.status !== "suggested"
      );

      const content = generateTestDocument({
        requirement: {
          requirementId: requirement.requirementId,
          name: requirement.name,
          description: requirement.description,
          category: requirement.category,
          acceptanceCriteria: requirement.acceptanceCriteria,
        },
        graph: ctx.graph,
        catalogs: ctx.catalogs!,
        mappedNodes,
        sourceArtifacts,
        projectVision: vision,
      });

      const fingerprint = computeTestContextFingerprint(
        {
          requirementId: requirement.requirementId,
          name: requirement.name,
          description: requirement.description,
          category: requirement.category,
          acceptanceCriteria: requirement.acceptanceCriteria,
        },
        mappedNodes,
        sourceArtifacts,
        ctx.graph,
        vision,
        ctx.catalogs!,
      );

      const primaryNodeId = mappedNodeIds[0];
      // C4 step 5: lookup by metadata.requirementId → id-only path → legacy path, never
      // a recomputed path alone (renames must not orphan-and-duplicate the plan).
      const existingArtifact = findExistingTestArtifact(
        ctx.graph.artifacts,
        requirement.requirementId,
        requirement.name,
      );

      if (existingArtifact) {
        if (existingArtifact.content === content) continue;

        existingArtifact.content = content;
        existingArtifact.status = "draft";
        existingArtifact.metadata = { ...(existingArtifact.metadata || {}), testContextFingerprint: fingerprint, requirementId: requirement.requirementId, stale: false };
        ctx.patches.push({
          type: "update_artifact",
          metadata: {
            id: crypto.randomUUID(),
            actorType: "system" as const,
            actorId: "test-plan-generator",
            summary: `Update test plan for ${requirement.name}`,
            timestamp: now,
          },
          payload: {
            id: existingArtifact.id,
            nodeId: existingArtifact.nodeId,
            changes: {
              content,
              status: "draft",
              updatedAt: now,
              metadata: { ...(existingArtifact.metadata || {}), testContextFingerprint: fingerprint, requirementId: requirement.requirementId, stale: false },
            },
          },
        });
      } else {
        const artifactId = crypto.randomUUID();
        const artifact = {
          id: artifactId,
          nodeId: primaryNodeId,
          kind: "test-plan",
          path: testPath,
          content,
          language: "markdown",
          status: "draft",
          description: `Test plan for requirement: ${requirement.name}`,
          createdAt: now,
          updatedAt: now,
          metadata: { testContextFingerprint: fingerprint, requirementId: requirement.requirementId },
        };

        ctx.graph.artifacts[artifactId] = artifact;
        const primaryNode = ctx.graph.nodes[primaryNodeId];
        if (primaryNode) {
          if (!primaryNode.artifacts) primaryNode.artifacts = [];
          primaryNode.artifacts.push(artifactId);
        }

        ctx.patches.push({
          type: "add_artifact",
          metadata: {
            id: crypto.randomUUID(),
            actorType: "system" as const,
            actorId: "test-plan-generator",
            summary: `Generate test plan for ${requirement.name}`,
            timestamp: now,
          },
          payload: {
            id: artifactId,
            nodeId: primaryNodeId,
            kind: "test-plan",
            path: testPath,
            content,
            language: "markdown",
            status: "draft",
            description: `Test plan for requirement: ${requirement.name}`,
            createdAt: now,
            updatedAt: now,
            metadata: { testContextFingerprint: fingerprint, requirementId: requirement.requirementId },
          },
        });
      }

      count++;
    }
  }

  return count;
}

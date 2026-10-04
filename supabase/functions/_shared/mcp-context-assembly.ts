// type-only: a VALUE import of the jsr package makes this module untestable offline
// (deno test --no-check still fetches runtime imports; jsr is 403 in the sandbox).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { loadCatalogs, CatalogData, NodeRoleRow } from "./catalog-loader.ts";
import { resolveConfigChoice } from "./config-choice.ts";
// P0-7: envelope for user-authored content. This module's exclusive consumer is the
// mcp-server; do NOT move these imports into shared helpers used by the agent loop.
import { UNTRUSTED_ADVISORY, wrapField, wrapFieldNullable, wrapUntrusted } from "./untrusted-data.ts";
import { generateTaskDocument, simpleHash } from "./task-document-generator.ts";
import { collectInheritedScopes, type InheritedScope } from "./inherited-context.ts";
import { generateTestDocument, getTestDocumentPath, findExistingTestArtifact, computeTestContextFingerprint, preserveTestStrategySection } from "./test-document-generator.ts";
import { liveNodeIdSet } from "./mapping-liveness.ts";
import { loadNodeConstraints, loadConstraintsAndRules, constraintRef, type NodeConstraint } from "./node-constraints.ts";
import { effectiveTreatment, treatmentForRole } from "./ontology.ts";
import { holdingLine } from "./role-registry.ts";
import { loadServedVision, servedVisionLines, type ServedVision } from "./served-vision.ts";

export interface CodingTaskTarget {
  type: 'node' | 'artifact' | 'requirement';
  id: string;
}

export interface AssembledContext {
  projectName: string;
  branchName: string;
  specification: SpecificationContext | null;
  target: TargetContext;
  architecture: ArchitectureContext;
  existingArtifacts: ArtifactContext[];
  promptDocument: string;
  /** P0-7: one-line advisory explaining the <untrusted-data> envelope on user content. */
  untrustedDataAdvisory: string;
  /** RI-9: for an imported node, files whose blob sha moved since the
   *  indexed head (from repo_index_freshness) — the brief says which of the
   *  "existing implementation" files it cannot vouch for. */
  repoFreshness?: RepoFreshnessContext;
}

export interface RepoFreshnessContext {
  modified: number;
  deleted: number;
  added: number;
  unverified: number;
  samplePaths: string[];
}

/** Read the node's freshness findings (RI-9). Empty when the node was never
 *  imported or nothing moved. Never throws — a brief is never blocked by it. */
export async function loadRepoFreshness(
  supabase: SupabaseClient,
  branchId: string,
  nodeId: string,
): Promise<RepoFreshnessContext | undefined> {
  try {
    const { data } = await supabase
      .from('repo_index_freshness')
      .select('path, status')
      .eq('branch_id', branchId)
      .eq('node_id', nodeId)
      .order('path')
      .limit(200);
    const rows = (data ?? []) as Array<{ path: string; status: string }>;
    if (rows.length === 0) return undefined;
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return {
      modified: count('modified'),
      deleted: count('deleted'),
      added: count('added'),
      unverified: count('unverified'),
      samplePaths: rows.filter((r) => r.status !== 'added').slice(0, 8).map((r) => `${r.path} (${r.status})`),
    };
  } catch {
    return undefined;
  }
}

/** AA.0 (R.2a): a constraint as the context carries it, from project_constraints.
 *  `mark` rides along so the transport's redactByClearance removes what the
 *  caller is not cleared for. */
export type ContextConstraint = NodeConstraint & { ref: string };

export interface SpecificationContext {
  /** The whole vision; null for a node target, which carries `visionServed` instead (AA.6). */
  vision: string | null;
  /** AA.6: a node target's vision is the sentences its outcomes cite (served-vision.ts). */
  visionServed?: ServedVision;
  relevantRequirements: RequirementContext[];
  /** A node target: the constraints that apply to it; otherwise the project's.
   *  AC: absent when the project carries no constraints (below Indie). */
  constraints?: ContextConstraint[];
  preferences: Record<string, unknown>;
  /** Human requirement id (e.g. "REQ-001") -> all node ids mapped via specification_mappings. */
  requirementNodeMap: Record<string, string[]>;
}

export interface RequirementContext {
  requirementId: string;
  name: string;
  description: string;
  category: string;
  status: string;
  /** WS3: verification 'manual' = R5 tick+approval lane; absent = automated (D-2).
   *  Widened so ensureTestDocumentForRequirement forwards the lane to the generator. */
  acceptanceCriteria: Array<{ text: string; met?: boolean; verification?: string }>;
}

export interface TargetContext {
  type: 'node' | 'artifact' | 'requirement';
  id: string;
  node?: NodeContext;
  requirement?: RequirementContext;
}

export interface ResolvedCapability {
  platformCapabilityRole: string;
  platformCapabilityLabel: string;
  provider: string;
  equivalenceNote: string;
}

export interface NodeContext {
  id: string;
  label: string;
  role: string;
  roleDescription: string;
  /** N2: boundary = engine owning its internals; consumers must treat the node as
   *  interface-only (contracts + connection config, no internal codegen). */
  treatmentMode: 'leaf' | 'container' | 'boundary';
  technology: string | null;
  technologyContext: TechnologyContext | null;
  resolvedCapability: ResolvedCapability | null;
  rationale: string | null;
  /** N8.4a-3b: the inspector's schema-driven configuration — values an implementing AI
   *  must HONOR; null when none set. */
  configuration: Record<string, unknown> | null;
  /** 'user-specified' (values present) · 'delegated-to-ai' (N8.1b "AI decides") · null. */
  configurationSource: 'user-specified' | 'delegated-to-ai' | null;
  contracts: ContractContext[];
  /** AG.12a: the parent, how it holds this node (placementKind) and what it may hold. */
  parentNode: { id: string; label: string; role: string; placementKind: string | null; holds: string | null } | null;
  /** AG.12a (owner 2026-09-28): how this node's type holds, and what it may hold, so an
   *  agent reads the canvas rule before a proposal is refused by it. */
  holds: string | null;
  /** N8.4r: configuration set on the CONTAINERS this node lives in — region, environment,
   *  IAM baseline, tagging policy. Outermost first; the innermost wins a key collision.
   *  Before this the parent contributed only a label, so a scoped account context reached
   *  nothing that builds. */
  inheritedContext: InheritedScope[];
  childNodes: Array<{ id: string; label: string; role: string }>;
}

export interface TechnologyContext {
  name: string;
  purpose: string;
  bestPractices: string[];
  antiPatterns: string[];
  suggestedFiles: Array<{ path: string; kind: string }>;
  setupInstructions: Array<{ title: string; type: string; instructions: string; commands?: string[]; url?: string; required: boolean }>;
  /** N10(d): consistency with the task packet — the security posture and the docs
   *  pointer render on EVERY surface an AI builds from, not just the committed packet. */
  securityGuidance: string;
  docsUrl: string | null;
  configMode: string | null;
  migrationTarget: string | null;
  lifecycle: string | null;
}

export interface ContractContext {
  id: string;
  name: string;
  kind: string;
  /** N8.6(C): the packet and MCP context speak the same detail level — descriptors
   *  and edge criticality included here too, null when unset. */
  interactionKind: string | null;
  transport: string | null;
  specFormat: string | null;
  criticality: string | null;
  direction: 'incoming' | 'outgoing';
  connectedNode: { id: string; label: string; role: string; technology: string | null };
  schemaContent: string | null;
  /** WS1 token diet: presence + bounded preview + content hash ride every view; the
   *  full body ships only in view:'full' (context.ts nulls schemaContent for
   *  'structured'). Hash is the same h8 the fingerprint lane derives from identical
   *  content, so "did the schema move?" is answerable without re-reading the body. */
  schemaPresent: boolean;
  schemaPreview: string | null;
  schemaHash: string | null;
}

export interface ArchitectureContext {
  connectedNodes: ConnectedNodeSummary[];
  siblingNodes: Array<{ id: string; label: string; role: string }>;
}

export interface ConnectedNodeSummary {
  id: string;
  label: string;
  role: string;
  technology: string | null;
  relationship: 'upstream' | 'downstream' | 'peer';
  contractKind: string;
  contractName: string;
}

export interface ArtifactContext {
  id: string;
  path: string;
  kind: string;
  language: string | null;
  status: string;
  contentPreview: string | null;
}

interface GraphData {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  contracts: Record<string, GraphContract>;
  artifacts: Record<string, GraphArtifact>;
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  technology?: string;
  parentId?: string;
  metadata?: {
    rationale?: string;
    domainMetadata?: unknown;
    [key: string]: unknown;
  };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  contractId: string;
  direction?: string;
  criticality?: string;
}

interface GraphContract {
  id: string;
  name: string;
  kind: string;
  interactionKind?: string;
  transport?: string;
  specFormat?: string;
  schema?: Record<string, unknown>;
  schemaRef?: string;
}

interface GraphArtifact {
  id: string;
  nodeId: string;
  path: string;
  kind: string;
  status: string;
  content?: string;
  language?: string;
  metadata?: { testContextFingerprint?: unknown; stale?: boolean; [key: string]: unknown };
}

export async function loadGraphData(
  supabase: SupabaseClient,
  branchId: string
): Promise<GraphData | null> {
  const { data, error } = await supabase
    .from('graph_snapshots')
    .select('graph_data')
    .eq('branch_id', branchId)
    .order('patch_sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.graph_data as GraphData;
}

export async function loadSpecificationContext(
  supabase: SupabaseClient,
  projectId: string,
  targetNodeId?: string,
  // Node ids present in the branch graph being assembled. Mappings are spec-global but nodes
  // are branch-local, so mappings pointing at nodes absent from this branch (deleted, or on
  // another branch) are dropped here — the only branch-correct place to do it. Omitted → no
  // liveness filtering (back-compat for callers without a graph).
  liveNodeIds?: Set<string>,
  // AA.6: the branch whose outcomes a node target's served vision is read from.
  branchId?: string,
  /** R.2b: the branch graph, for constraints scoped to a role, technology, contract kind or node. */
  graph?: unknown,
): Promise<SpecificationContext | null> {
  const { data: spec } = await supabase
    .from('project_specifications')
    .select('id, vision, constraints, preferences')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!spec) return null;

  const [reqResult, mappingsResult] = await Promise.all([
    supabase
      .from('specification_requirements')
      .select('id, requirement_id, name, description, category, status, acceptance_criteria')
      .eq('specification_id', spec.id),
    supabase
      .from('specification_mappings')
      .select('requirement_id, node_id')
      .eq('specification_id', spec.id),
  ]);

  const requirements = reqResult.data || [];
  const rawMappings = (mappingsResult.data || []) as Array<{ requirement_id: string; node_id: string }>;

  // Drop mappings whose node no longer exists in the branch being read (deleted here, or only
  // ever lived on another branch). When no live set is supplied, keep all (back-compat).
  const allMappings = liveNodeIds
    ? rawMappings.filter((m) => liveNodeIds.has(m.node_id))
    : rawMappings;

  // Mappings carry the requirement row's uuid; translate to the human id (e.g. "REQ-001").
  const dbIdToHumanId = new Map<string, string>(
    requirements.map((r: { id: string; requirement_id: string }): [string, string] => [r.id, r.requirement_id])
  );
  const requirementNodeMap: Record<string, string[]> = {};
  for (const m of allMappings) {
    const humanId = dbIdToHumanId.get(m.requirement_id);
    if (!humanId) continue;
    if (!requirementNodeMap[humanId]) requirementNodeMap[humanId] = [];
    if (!requirementNodeMap[humanId].includes(m.node_id)) requirementNodeMap[humanId].push(m.node_id);
  }

  const mappedReqIds = new Set(
    targetNodeId
      ? allMappings.filter((m) => m.node_id === targetNodeId).map((m) => m.requirement_id)
      : []
  );

  // AA.0: a node's context carries the node's requirements and nothing else;
  // a node with none mapped says so with an empty list (it used to fall back
  // to the project's first ten, which were neither scoped nor chosen). A read
  // with no node keeps the project-level sample.
  const relevantRequirements = targetNodeId
    ? requirements.filter((r: { id: string }) => mappedReqIds.has(r.id))
    : requirements.slice(0, 10);

  // AA.0 (R.2a): constraints come from the one store, scoped to the node.
  // AC: below Indie there are none to carry, and the field is left out.
  let constraintRows: NodeConstraint[] | undefined;
  if (targetNodeId) {
    constraintRows = (await loadNodeConstraints(supabase, projectId, [targetNodeId], undefined, graph)).get(targetNodeId);
  } else {
    const read = await loadConstraintsAndRules(supabase, projectId);
    constraintRows = read.carried ? read.constraints : undefined;
  }

  // AA.6: a node carries the sentences its outcomes cite, not the whole vision.
  // When they cannot be read the read falls back to the whole vision rather
  // than telling the agent the node serves nothing.
  let visionServed: ServedVision | undefined;
  if (targetNodeId) {
    try {
      visionServed = (await loadServedVision(supabase, projectId, branchId ?? null, spec.vision, new Map([[targetNodeId, [...mappedReqIds]]]))).get(targetNodeId);
    } catch { visionServed = undefined; }
  }

  return {
    vision: visionServed ? null : spec.vision,
    ...(visionServed ? { visionServed } : {}),
    relevantRequirements: relevantRequirements.map((r: {
      requirement_id: string;
      name: string;
      description: string;
      category: string;
      status: string;
      acceptance_criteria: Array<{ text: string; met?: boolean }>;
    }) => ({
      requirementId: r.requirement_id,
      name: r.name,
      description: r.description || '',
      category: r.category,
      status: r.status,
      acceptanceCriteria: r.acceptance_criteria || [],
    })),
    ...(constraintRows ? { constraints: constraintRows.map((c) => ({ ...c, ref: constraintRef(c.id) })) } : {}),
    preferences: (spec.preferences as Record<string, unknown>) || {},
    requirementNodeMap,
  };
}

export function resolveNodeFromGraph(
  graph: GraphData,
  targetType: string,
  targetId: string
): GraphNode | null {
  if (targetType === 'node') {
    for (const node of Object.values(graph.nodes)) {
      if (node.label === targetId || node.id === targetId) {
        return node;
      }
    }
  }
  return null;
}

// M6 BUGFIX: this copy had the prefixes but NOT the family mapping, so a firebase-*
// technology inferred provider `firebase` while its platform parent is `gcp` (N4.7 merged
// the family). The equivalence note below is shipped to the user's AI, and it read "a
// managed FIREBASE service … running inside its provider's platform" while naming Google
// Cloud as the platform. Now one table, in provider-inference.ts.
import { inferProviderFromId as inferProviderFromTechnology } from "./provider-inference.ts";

function resolveCapabilityEquivalence(
  node: GraphNode,
  graph: GraphData,
  catalogs: CatalogData,
  roleRow: NodeRoleRow | null
): ResolvedCapability | null {
  if (!node.technology || !node.parentId) return null;
  if (roleRow?.nature === 'integrate') return null;

  const provider = inferProviderFromTechnology(node.technology);
  if (!provider) return null;

  const parent = graph.nodes[node.parentId];
  if (!parent) return null;

  const parentRole = catalogs.nodeRoles[parent.type];
  if (!parentRole || parentRole.nature !== 'host') return null;

  // M1b: sourced from the TECHNOLOGY row, not from a same-named capability ROLE.
  // The old lookup fired only for the 13 technologies that happened to have a matching
  // platform_capability role — aws-lambda got the note, aws-dynamodb did not, from the
  // same AWS family. The technology row carries the label for all 297, so the note is
  // now uniform. (This is what let the capability roles retire; see NODE_REFERENCE §4.)
  const techRow = catalogs.technologies[node.technology];
  if (!techRow) return null;
  const label = techRow.display_name || techRow.name;

  return {
    platformCapabilityRole: techRow.id,
    platformCapabilityLabel: label,
    provider,
    equivalenceNote: `This node is a managed ${provider.toUpperCase()} service ("${label}", ${techRow.id}) running inside its provider's platform. Treat it as provider-operated for spec generation, code scaffolding, and architecture decisions — you configure it, you do not author its internals.`,
  };
}

/** WS1: schemaPreview cap — enough to see the shape, never the whole spec body. */
const SCHEMA_PREVIEW_CHARS = 600;

export function buildNodeContext(
  node: GraphNode,
  graph: GraphData,
  catalogs: CatalogData
): NodeContext {
  // M4: node.type IS the role id (N9a); the legacy-type fallback is gone with the table.
  const roleRow = catalogs.nodeRoles[node.type] ?? null;
  const techRow = node.technology ? catalogs.technologies[node.technology] : null;

  const contracts: ContractContext[] = [];
  for (const edge of Object.values(graph.edges)) {
    if (edge.source !== node.id && edge.target !== node.id) continue;

    const contract = graph.contracts[edge.contractId];
    if (!contract) continue;

    const isOutgoing = edge.source === node.id;
    const connectedNodeId = isOutgoing ? edge.target : edge.source;
    const connectedNode = graph.nodes[connectedNodeId];

    // WS1 inline-schema-first fix: this read honored only schemaRef, so a contract
    // whose schema lives INLINE (contract.schema — what update_contract {schema}
    // writes) reported as schemaless here while the task generator rendered it.
    // Same precedence as buildContractSection in task-document-generator.ts.
    let schemaContent: string | null = null;
    if (contract.schema && Object.keys(contract.schema).length > 0) {
      schemaContent = JSON.stringify(contract.schema, null, 2);
    } else if (contract.schemaRef) {
      const schemaArtifact = graph.artifacts[contract.schemaRef];
      if (schemaArtifact?.content) {
        schemaContent = typeof schemaArtifact.content === 'string'
          ? schemaArtifact.content
          : JSON.stringify(schemaArtifact.content, null, 2);
      }
    }

    contracts.push({
      id: contract.id,
      name: contract.name,
      kind: contract.kind,
      interactionKind: contract.interactionKind || null,
      transport: contract.transport || null,
      specFormat: contract.specFormat || null,
      criticality: edge.criticality || null,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      connectedNode: {
        id: connectedNodeId,
        label: connectedNode?.label || connectedNodeId,
        role: connectedNode?.type || 'unknown',
        technology: connectedNode?.technology || null,
      },
      schemaContent,
      schemaPresent: schemaContent !== null,
      schemaPreview: schemaContent
        ? (schemaContent.length > SCHEMA_PREVIEW_CHARS
          ? schemaContent.slice(0, SCHEMA_PREVIEW_CHARS) + '\n... (truncated)'
          : schemaContent)
        : null,
      schemaHash: schemaContent ? simpleHash(schemaContent) : null,
    });
  }

  // AG.12a: the holding lines come from the catalog; a failed load leaves them null.
  const holds = (roleId: string) => (catalogs.nodeRoles[roleId] ? holdingLine(catalogs, roleId) : null);
  let parentNode: NodeContext['parentNode'] = null;
  if (node.parentId) {
    const parent = graph.nodes[node.parentId];
    if (parent) {
      parentNode = {
        id: parent.id, label: parent.label, role: parent.type,
        placementKind: (node as { placementKind?: string }).placementKind ?? null, holds: holds(parent.type),
      };
    }
  }

  const childNodes: Array<{ id: string; label: string; role: string }> = [];
  for (const n of Object.values(graph.nodes)) {
    if (n.parentId === node.id) {
      childNodes.push({ id: n.id, label: n.label, role: n.type });
    }
  }

  const resolvedCapability = resolveCapabilityEquivalence(node, graph, catalogs, roleRow);

  return {
    id: node.id,
    label: node.label,
    role: node.type,
    roleDescription: roleRow?.description || '',
    // N2.2: effective treatment folds in a boundary-engine technology's override.
    treatmentMode: effectiveTreatment(
      treatmentForRole({ nature: roleRow?.nature, is_container: roleRow?.is_container }),
      (techRow?.ai_context as Record<string, unknown> | undefined)?.treatmentOverride as string | undefined,
    ),
    technology: node.technology || null,
    technologyContext: techRow ? {
      name: techRow.name,
      purpose: techRow.ai_context?.purpose || '',
      bestPractices: techRow.ai_context?.bestPractices || [],
      antiPatterns: techRow.ai_context?.antiPatterns || [],
      suggestedFiles: techRow.suggested_files || [],
      setupInstructions: techRow.ai_context?.setupInstructions || [],
      securityGuidance: (techRow.ai_context as Record<string, unknown> | undefined)?.securityGuidance as string || '',
      docsUrl: ((techRow.ai_context as Record<string, unknown> | undefined)?.apiReference as { docsUrl?: string } | undefined)?.docsUrl || null,
      configMode: (techRow.ai_context as Record<string, unknown> | undefined)?.configMode as string || null,
      migrationTarget: (techRow.ai_context as Record<string, unknown> | undefined)?.migrationTarget as string || null,
      lifecycle: (techRow.ai_context as Record<string, unknown> | undefined)?.lifecycle as string || null,
    } : null,
    resolvedCapability,
    rationale: node.metadata?.rationale || null,
    // N8.4a-3b (owner-found traceability bug 2026-07-27: "the node's context json
    // doesn't reflect any of these specific configurations… for all the nodes"):
    // the inspector's schema-driven choices (metadata.config) reached task packets and
    // the client export but NOT this — the primary surface the user's AI reads.
    // `configuration` = the values to HONOR; `configurationSource` says whether the
    // user specified them or explicitly delegated to the AI (N8.1b toggle).
    // Owner 2026-07-30: THE config-choice rule — a delegated node never emits
    // dormant leftovers as if the user had chosen them.
    configuration: resolveConfigChoice(node.metadata as Record<string, unknown> | undefined) !== 'delegated' &&
      (node.metadata?.config && Object.keys(node.metadata.config as Record<string, unknown>).length > 0)
      ? node.metadata.config as Record<string, unknown>
      : null,
    configurationSource: resolveConfigChoice(node.metadata as Record<string, unknown> | undefined) === 'delegated'
      ? 'delegated-to-ai'
      : (node.metadata?.config && Object.keys(node.metadata.config as Record<string, unknown>).length > 0)
      ? 'user-specified'
      : null,
    contracts,
    parentNode,
    holds: holds(node.type),
    inheritedContext: collectInheritedScopes(graph, node.id),
    childNodes,
  };
}

export function buildArchitectureContext(
  targetNode: GraphNode,
  graph: GraphData
): ArchitectureContext {
  const connectedNodes: ConnectedNodeSummary[] = [];
  const seenNodeIds = new Set<string>();

  for (const edge of Object.values(graph.edges)) {
    if (edge.source !== targetNode.id && edge.target !== targetNode.id) continue;

    const isOutgoing = edge.source === targetNode.id;
    const connectedId = isOutgoing ? edge.target : edge.source;
    if (seenNodeIds.has(connectedId)) continue;
    seenNodeIds.add(connectedId);

    const connectedNode = graph.nodes[connectedId];
    const contract = graph.contracts[edge.contractId];

    connectedNodes.push({
      id: connectedId,
      label: connectedNode?.label || connectedId,
      role: connectedNode?.type || 'unknown',
      technology: connectedNode?.technology || null,
      relationship: isOutgoing ? 'downstream' : 'upstream',
      contractKind: contract?.kind || 'custom',
      contractName: contract?.name || 'unnamed',
    });
  }

  const siblingNodes: Array<{ id: string; label: string; role: string }> = [];
  if (targetNode.parentId) {
    for (const node of Object.values(graph.nodes)) {
      if (node.parentId === targetNode.parentId && node.id !== targetNode.id) {
        siblingNodes.push({
          id: node.id,
          label: node.label,
          role: node.type,
        });
      }
    }
  }

  return { connectedNodes, siblingNodes };
}

export function collectExistingArtifacts(
  graph: GraphData,
  targetNodeId: string
): ArtifactContext[] {
  const artifacts: ArtifactContext[] = [];

  for (const artifact of Object.values(graph.artifacts)) {
    if (artifact.nodeId !== targetNodeId) continue;
    if (artifact.status === 'suggested') continue;
    // WS1 D2 (owner-measured ~33k tokens/get_project_context — the task doc shipped up
    // to THREE times per call): task docs travel as promptDocument and test plans via
    // get_test_plan; previewing them here again was the duplicate payload.
    if (artifact.kind === 'task' || artifact.kind === 'test-plan') continue;

    let contentPreview: string | null = null;
    if (artifact.content) {
      const content = typeof artifact.content === 'string'
        ? artifact.content
        : JSON.stringify(artifact.content, null, 2);
      contentPreview = content.length > 2000
        ? content.slice(0, 2000) + '\n... (truncated)'
        : content;
    }

    artifacts.push({
      id: artifact.id,
      path: artifact.path,
      kind: artifact.kind,
      language: artifact.language || null,
      status: artifact.status,
      contentPreview,
    });
  }

  return artifacts;
}

export function formatPromptDocument(context: AssembledContext): string {
  const lines: string[] = [];

  lines.push(`# Coding Task Context for "${context.target.node?.label || context.target.id}"`);
  lines.push('');
  lines.push(`Project: ${context.projectName}`);
  lines.push(`Branch: ${context.branchName}`);
  lines.push('');

  if (context.specification) {
    if (context.specification.visionServed) {
      lines.push(...servedVisionLines(context.specification.visionServed));
    } else if (context.specification.vision) {
      lines.push('## Project Vision');
      lines.push(context.specification.vision);
      lines.push('');
    }

    if (context.specification.relevantRequirements.length > 0) {
      lines.push('## Relevant Requirements');
      for (const req of context.specification.relevantRequirements) {
        lines.push(`### ${req.requirementId}: ${req.name}`);
        lines.push(`Category: ${req.category} | Status: ${req.status}`);
        if (req.description) lines.push(req.description);
        if (req.acceptanceCriteria.length > 0) {
          lines.push('Acceptance Criteria:');
          for (const ac of req.acceptanceCriteria) {
            const status = ac.met ? '[x]' : '[ ]';
            lines.push(`  ${status} ${ac.text}`);
          }
        }
        lines.push('');
      }
    }

    if ((context.specification.constraints?.length ?? 0) > 0) {
      lines.push('## Constraints');
      for (const c of context.specification.constraints ?? []) {
        lines.push(`- [${c.ctype}] ${c.title ? `${c.title}: ` : ''}${c.description} (${c.ref})`);
      }
      lines.push('');
    }
  }

  if (context.target.node) {
    const node = context.target.node;
    lines.push('## Target Component');
    lines.push(`Name: ${node.label}`);
    lines.push(`Role: ${node.role}`);
    if (node.roleDescription) lines.push(`Description: ${node.roleDescription}`);
    if (node.technology) lines.push(`Technology: ${node.technology}`);
    if (node.rationale) lines.push(`Rationale: ${node.rationale}`);
    // N8.4a-3b: the inspector's configuration IS build truth — render it wherever the
    // node context renders.
    if (node.configuration) {
      lines.push('Configuration (user-selected — honor these choices):');
      for (const [k, v] of Object.entries(node.configuration)) {
        lines.push(`  - ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
      }
    } else if (node.configurationSource === 'delegated-to-ai') {
      lines.push('Configuration: delegated to the implementing AI (user choice) — select sensible defaults and record them.');
    }
    // N8.4r: the containers' configuration scopes this node — surface it here too, or the
    // account/subscription/project settings are a form that changes no output.
    if (node.inheritedContext.length > 0) {
      lines.push('Inherited from its containers (honor these — innermost wins a conflict):');
      for (const scope of node.inheritedContext) {
        const pairs = Object.entries(scope.values)
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
          .join(', ');
        lines.push(`  - ${scope.containerLabel} (${scope.containerType}): ${pairs}`);
      }
    }
    lines.push('');

    if (node.technologyContext) {
      const tech = node.technologyContext;
      lines.push('### Technology Context');
      // N10(d): lifecycle steering renders FIRST — before any content invites building
      // on a superseded row.
      if (tech.migrationTarget) {
        lines.push(`Catalog status: MIGRATED — superseded by ${tech.migrationTarget}. Prefer the successor for new work.`);
      } else if (tech.lifecycle === 'retired') {
        lines.push('Catalog status: RETIRED — no named successor. Confirm with the user before new work.');
      }
      if (tech.purpose) lines.push(`Purpose: ${tech.purpose}`);
      // N10(d): the docs pointer and security posture reach every build surface. For
      // externals the live docs WIN over curated content (owner ruling 2026-08-10).
      if (tech.docsUrl) {
        lines.push(tech.configMode === 'external'
          ? `Docs: ${tech.docsUrl} — third-party service: consult the live documentation before implementing; where it contradicts curated guidance, the live docs win.`
          : `Docs: ${tech.docsUrl}`);
      }
      if (tech.securityGuidance) lines.push(`Security: ${tech.securityGuidance}`);
      if (tech.bestPractices.length > 0) {
        lines.push('Best Practices:');
        for (const bp of tech.bestPractices) {
          lines.push(`  - ${bp}`);
        }
      }
      if (tech.antiPatterns.length > 0) {
        lines.push('Anti-Patterns to Avoid:');
        for (const ap of tech.antiPatterns) {
          lines.push(`  - ${ap}`);
        }
      }
      if (tech.suggestedFiles.length > 0) {
        lines.push('Suggested File Structure:');
        for (const sf of tech.suggestedFiles) {
          lines.push(`  - ${sf.path} (${sf.kind})`);
        }
      }
      if (tech.setupInstructions.length > 0) {
        lines.push('');
        lines.push('### Manual Setup Checklist');
        lines.push('> These steps require manual action and cannot be automated by AI.');
        for (const step of tech.setupInstructions) {
          const marker = step.required ? '[REQUIRED]' : '[OPTIONAL]';
          lines.push(`${marker} ${step.title}: ${step.instructions}`);
          if (step.commands && step.commands.length > 0) {
            for (const cmd of step.commands) {
              lines.push(`  $ ${cmd}`);
            }
          }
          if (step.url) {
            lines.push(`  Reference: ${step.url}`);
          }
        }
      }
      lines.push('');
    }

    if (node.resolvedCapability) {
      lines.push('### Platform Capability Equivalence');
      lines.push(node.resolvedCapability.equivalenceNote);
      lines.push(`Equivalent Role: ${node.resolvedCapability.platformCapabilityRole} (${node.resolvedCapability.platformCapabilityLabel})`);
      lines.push(`Provider: ${node.resolvedCapability.provider}`);
      lines.push('');
    }

    if (node.contracts.length > 0) {
      lines.push('### Interface Contracts');
      for (const contract of node.contracts) {
        const arrow = contract.direction === 'incoming' ? '<-' : '->';
        const transportSuffix = contract.transport ? `/${contract.transport}` : '';
        const specSuffix = contract.specFormat && contract.specFormat !== 'none' ? ` (${contract.specFormat})` : '';
        const critSuffix = contract.criticality && contract.criticality !== 'required' ? ` [${contract.criticality}]` : '';
        lines.push(`${arrow} ${contract.connectedNode.label} via ${contract.kind}${transportSuffix}${specSuffix}${critSuffix} "${contract.name}"`);
        if (contract.schemaContent) {
          lines.push('Schema:');
          lines.push('```');
          lines.push(contract.schemaContent);
          lines.push('```');
        }
      }
      lines.push('');
    }

    if (node.parentNode) {
      lines.push(`Parent Container: ${node.parentNode.label} (${node.parentNode.role})`);
    }
    if (node.childNodes.length > 0) {
      lines.push(`Contains: ${node.childNodes.map(c => c.label).join(', ')}`);
    }
    lines.push('');
  }

  if (context.architecture.connectedNodes.length > 0) {
    lines.push('## Connected Components');
    for (const conn of context.architecture.connectedNodes) {
      const arrow = conn.relationship === 'upstream' ? 'receives from' : 'sends to';
      const tech = conn.technology ? ` (${conn.technology})` : '';
      lines.push(`- ${arrow} ${conn.label}${tech} via ${conn.contractKind}`);
    }
    lines.push('');
  }

  if (context.existingArtifacts.length > 0) {
    lines.push('## Existing Artifacts');
    for (const artifact of context.existingArtifacts) {
      lines.push(`### ${artifact.path}`);
      lines.push(`Kind: ${artifact.kind} | Status: ${artifact.status}`);
      if (artifact.contentPreview) {
        lines.push('```' + (artifact.language || ''));
        lines.push(artifact.contentPreview);
        lines.push('```');
      }
      lines.push('');
    }
  }

  // RI-9: the repo moved under the index — say so before the brief treats
  // the existing files as current.
  const fresh = context.repoFreshness;
  if (fresh && (fresh.modified + fresh.deleted + fresh.unverified + fresh.added) > 0) {
    lines.push('## Repository Freshness');
    lines.push(
      `Since this component was indexed, the repository changed: ${fresh.modified} file(s) modified, ` +
      `${fresh.deleted} removed, ${fresh.added} added, ${fresh.unverified} unverified. ` +
      'Treat the existing implementation as possibly stale for these paths; call get_node_context / search_repo_index for the current index.',
    );
    for (const p of fresh.samplePaths) lines.push(`- ${p}`);
    lines.push('');
  }

  return lines.join('\n');
}

function findStoredTaskDocument(
  graphData: GraphData,
  targetNode: GraphNode
): string | null {
  for (const artifact of Object.values(graphData.artifacts)) {
    if (artifact.nodeId === targetNode.id && artifact.kind === 'task' && artifact.content) {
      return artifact.content;
    }
  }
  return null;
}

function generateAndStoreTaskDocument(
  targetNode: GraphNode,
  graphData: GraphData,
  catalogs: CatalogData,
  specification: SpecificationContext | null
): string {
  const requirements = (specification?.relevantRequirements || []).map((r) => ({
    requirementId: r.requirementId,
    name: r.name,
    description: r.description || '',
    category: r.category,
    status: r.status,
    acceptanceCriteria: r.acceptanceCriteria || [],
  }));

  return generateTaskDocument({
    node: {
      id: targetNode.id,
      label: targetNode.label,
      type: targetNode.type,
      technology: targetNode.technology,
      parentId: targetNode.parentId,
      metadata: targetNode.metadata,
    },
    graph: graphData,
    catalogs,
    requirements,
    // AA.6: the sentences this node serves (loaded for the node target).
    servedVision: specification?.visionServed,
    projectVision: specification?.vision || undefined,
    requirementNodeMap: specification?.requirementNodeMap,
    // AA.0: the node's constraints (the context loaded them for this node).
    constraints: specification?.constraints ? specification.constraints.map(({ ref: _ref, ...c }) => c) : undefined,
  });
}

export async function assembleContextForTarget(
  supabase: SupabaseClient,
  projectId: string,
  branchId: string,
  targetType: string,
  targetId: string,
  userId?: string,
  // Q: the repo index is repo import's, Indie and above. The caller says
  // whether the plan carries it; absent means no (a Free brief never points
  // at get_node_context or search_repo_index).
  opts: { repoIndex?: boolean } = {},
): Promise<AssembledContext> {
  const projectQuery = userId
    ? supabase.from('projects').select('name, owner_id').eq('id', projectId).eq('owner_id', userId).maybeSingle()
    : supabase.from('projects').select('name').eq('id', projectId).maybeSingle();

  const [projectResult, branchResult, graphData, catalogs] = await Promise.all([
    projectQuery,
    supabase.from('branches').select('name').eq('id', branchId).eq('project_id', projectId).maybeSingle(),
    loadGraphData(supabase, branchId),
    loadCatalogs(supabase, { projectIds: [projectId] }),
  ]);

  // 7.0: not the owner — a roster seat reads (the tool already resolved the
  // project through membership; this is the assembler's own guard).
  let projectRow: { name?: string } | null = projectResult.data as { name?: string } | null;
  if (userId && !projectRow) {
    const { data: seat } = await supabase
      .from('project_members')
      .select('role, projects!inner(name)')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    const via = (seat as { projects?: { name?: string } | null } | null)?.projects;
    if (via) projectRow = { name: via.name };
  }
  if (userId && !projectRow) {
    throw new Error('Project not found or access denied');
  }

  const projectName = projectRow?.name || 'Unknown Project';
  const branchName = branchResult.data?.name || 'main';

  let targetNode: GraphNode | null = null;
  let nodeContext: NodeContext | null = null;

  if (graphData && targetType === 'node') {
    targetNode = resolveNodeFromGraph(graphData, targetType, targetId);
    if (targetNode) {
      nodeContext = buildNodeContext(targetNode, graphData, catalogs);
    }
  }

  // Filter requirement→node mappings to nodes actually present in this branch's graph
  // (mappings are spec-global; nodes are branch-local — see mapping-liveness.ts).
  const specification = await loadSpecificationContext(
    supabase, projectId, targetNode?.id, liveNodeIdSet(graphData?.nodes), branchId, graphData,
  );

  const architecture = targetNode && graphData
    ? buildArchitectureContext(targetNode, graphData)
    : { connectedNodes: [], siblingNodes: [] };

  const existingArtifacts = targetNode && graphData
    ? collectExistingArtifacts(graphData, targetNode.id)
    : [];
  const fromRepo = opts.repoIndex === true && targetNode?.metadata?.importedFromRepo === true;
  const repoFreshness = targetNode && fromRepo
    ? await loadRepoFreshness(supabase, branchId, targetNode.id)
    : undefined;

  const context: AssembledContext = {
    projectName,
    branchName,
    specification,
    target: {
      type: targetType as 'node' | 'artifact' | 'requirement',
      id: targetId,
      node: nodeContext || undefined,
    },
    architecture,
    existingArtifacts,
    promptDocument: '',
    untrustedDataAdvisory: UNTRUSTED_ADVISORY,
    ...(repoFreshness ? { repoFreshness } : {}),
  };

  let promptDocument: string | null = null;
  if (targetNode && graphData) {
    promptDocument = findStoredTaskDocument(graphData, targetNode);
    if (!promptDocument) {
      promptDocument = generateAndStoreTaskDocument(targetNode, graphData, catalogs, specification);
    }
  }

  // P0-7: wrap AFTER formatPromptDocument has consumed the bare fields — the envelope is
  // applied exactly once, at this mcp-server-exclusive boundary. Structural fields (ids,
  // roles, statuses, counts) stay bare by design.
  context.promptDocument = wrapUntrusted(promptDocument || formatPromptDocument(context));
  applyUntrustedFieldWrapping(context);

  return context;
}

/** P0-7: wrap the user-authored string fields of an assembled context in place. */
function applyUntrustedFieldWrapping(context: AssembledContext): void {
  if (context.specification) {
    if (context.specification.vision) context.specification.vision = wrapField(context.specification.vision);
    for (const v of context.specification.visionServed?.sentences ?? []) v.text = wrapField(v.text);
    for (const req of context.specification.relevantRequirements) {
      req.name = wrapField(req.name);
      req.description = req.description ? wrapField(req.description) : req.description;
      for (const ac of req.acceptanceCriteria || []) {
        ac.text = wrapField(ac.text);
      }
    }
    // AA.0: constraints are user-authored text too.
    for (const c of context.specification.constraints ?? []) {
      c.description = wrapField(c.description);
      c.title = wrapFieldNullable(c.title);
      c.rationale = wrapFieldNullable(c.rationale);
    }
  }

  const node = context.target.node;
  if (node) {
    node.label = wrapField(node.label);
    node.rationale = wrapFieldNullable(node.rationale);
    if (node.parentNode) node.parentNode.label = wrapField(node.parentNode.label);
    for (const child of node.childNodes) child.label = wrapField(child.label);
    for (const contract of node.contracts) {
      contract.name = wrapField(contract.name);
      contract.connectedNode.label = wrapField(contract.connectedNode.label);
      contract.schemaContent = wrapFieldNullable(contract.schemaContent);
      // WS1: the preview is user-authored schema text too — same envelope; the hash
      // and presence flag are structural and stay bare by design.
      contract.schemaPreview = wrapFieldNullable(contract.schemaPreview);
    }
  }

  const req = context.target.requirement;
  if (req) {
    req.name = wrapField(req.name);
    req.description = req.description ? wrapField(req.description) : req.description;
    for (const ac of req.acceptanceCriteria || []) {
      ac.text = wrapField(ac.text);
    }
  }

  for (const connected of context.architecture.connectedNodes) {
    connected.label = wrapField(connected.label);
    connected.contractName = wrapField(connected.contractName);
  }
  for (const sibling of context.architecture.siblingNodes) {
    sibling.label = wrapField(sibling.label);
  }

  for (const artifact of context.existingArtifacts) {
    artifact.contentPreview = wrapFieldNullable(artifact.contentPreview);
  }
}

export function findStoredTestDocument(
  graphData: GraphData,
  requirementId: string,
  requirementName: string,
): { content: string; fingerprint?: unknown; stale?: boolean } | null {
  // C4 step 5: lookup goes through findExistingTestArtifact (metadata.requirementId →
  // id-only path → legacy id+name path), never a recomputed path alone — renaming a
  // requirement must not orphan its stored plan.
  const artifact = findExistingTestArtifact(graphData.artifacts, requirementId, requirementName);
  if (artifact?.content) {
    return {
      // P0-7: this function is mcp-server-exclusive (verified); the stored artifact
      // itself is never mutated — only the returned copy is wrapped.
      content: wrapUntrusted(artifact.content),
      fingerprint: artifact.metadata?.testContextFingerprint,
      stale: artifact.metadata?.stale === true,
    };
  }
  return null;
}

export function ensureTestDocumentForRequirement(
  graphData: GraphData,
  catalogs: CatalogData,
  requirement: RequirementContext,
  mappedNodeIds: string[],
  projectVision?: string,
): { content: string; fingerprint: unknown; isNew: boolean; refreshed?: boolean; rawContent?: string; path?: string } {
  const existing = findStoredTestDocument(graphData, requirement.requirementId, requirement.name);
  // Dogfood find 2026-09-02 (#3): a stored plan was served AS-IS on the word
  // of its stored stale flag, so five plans kept reporting "noschema" after
  // the schema landed — the read path never compared fingerprints, while the
  // task-doc lane recomputes on every generate call. The freshness decision
  // moves below, AFTER the current fingerprint exists to compare against.

  const mappedNodes = mappedNodeIds
    .map((nid) => graphData.nodes[nid])
    .filter(Boolean)
    .map((n) => ({
      nodeId: n.id,
      label: n.label,
      role: n.type,
      technology: n.technology,
    }));

  const sourceArtifacts = Object.values(graphData.artifacts).filter(
    (a) => mappedNodeIds.includes(a.nodeId) && a.kind === 'source' && a.status !== 'suggested'
  );

  const reqForGen = {
    requirementId: requirement.requirementId,
    name: requirement.name,
    description: requirement.description || '',
    category: requirement.category,
    acceptanceCriteria: requirement.acceptanceCriteria || [],
  };

  const fingerprint = computeTestContextFingerprint(
    reqForGen, mappedNodes, sourceArtifacts, graphData, projectVision, catalogs,
  );

  if (existing) {
    const storedHash = (existing.fingerprint as { fingerprint?: string } | undefined)?.fingerprint;
    if (!storedHash || storedHash === fingerprint.fingerprint) {
      // Inputs unchanged -- the stored plan is current, serve it untouched.
      // (No comparable hash = legacy pre-fingerprint artifact: keep serving
      // it rather than churn every old plan; the push-time freshness gate
      // migrates those on the next push.)
      return { content: existing.content, fingerprint: existing.fingerprint, isNew: false };
    }
    // Fingerprint moved (a schema landed, criteria changed, topology
    // shifted): regenerate NOW so a read never serves stale contract facts,
    // carrying the user-edited Test Strategy section forward verbatim --
    // exactly what the push-time gate does. Persistence still belongs to
    // that gate; this is a read.
    const rawStored = findExistingTestArtifact(graphData.artifacts, requirement.requirementId, requirement.name);
    const regenerated = generateTestDocument({
      requirement: reqForGen, graph: graphData, catalogs, mappedNodes, sourceArtifacts, projectVision,
    });
    const merged = rawStored?.content
      ? preserveTestStrategySection(regenerated, rawStored.content)
      : regenerated;
    return {
      content: wrapUntrusted(merged),
      fingerprint,
      isNew: false,
      refreshed: true,
      rawContent: merged,
      path: getTestDocumentPath(requirement.requirementId, requirement.name),
    };
  }

  const content = generateTestDocument({
    requirement: reqForGen, graph: graphData, catalogs, mappedNodes, sourceArtifacts, projectVision,
  });

  // P0-7: wrap the returned copy only (mcp-server-exclusive path; wrapUntrusted is
  // idempotent, so the stored-plan return above is safe too).
  // C4 step 1: rawContent/path ride along so the caller can PERSIST the fresh plan via
  // the patch lane (the artifact must store the unwrapped document; the envelope is a
  // transport concern, never storage).
  return {
    content: wrapUntrusted(content),
    fingerprint,
    isNew: true,
    rawContent: content,
    path: getTestDocumentPath(requirement.requirementId, requirement.name),
  };
}


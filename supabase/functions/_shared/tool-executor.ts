import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { SSEEmitter } from "./streaming.ts";
import type { ProviderConfig } from "./ai-provider.ts";
import { sendChatCompletion, resolvePlatformConfig } from "./ai-provider.ts";
import { isValidNodeType, validateAndCorrectNodeType, validateTechnology, isContainerTechnologyMismatch, getTechnologyHints, buildPlaceholderTechnology, registerPlaceholderTechnology, getRoleDefinition, canContainerAcceptChild, lookupCatalog } from "./role-registry.ts";
import { validateOrderIndex } from "./validation.ts";
import { effectiveTreatment } from "./ontology.ts";
import { validateGraphDataTopLevel } from "./graph-schema.ts";
import type { CatalogData } from "./catalog-loader.ts";
import { CONTRACT_KIND_VALUES, INTERACTION_KIND_VALUES, TRANSPORT_KIND_VALUES, SPEC_FORMAT_VALUES } from "./enums.ts";
import { KIND_TO_INTERACTION_FIELDS, INTERACTION_KIND_DEFAULTS, LEGACY_ALIAS_MAP, contractKindForInteraction } from "./legacy-mappings.ts";
import { generateTestDocument, getTestDocumentPath } from "./test-document-generator.ts";

export interface GraphState {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  contracts: Record<string, GraphContract>;
  artifacts: Record<string, GraphArtifact>;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  technology?: string;
  deploymentTarget?: string;
  ports: GraphPort[];
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: string;
  parentId?: string;
  artifacts?: string[];
}

export interface GraphPort {
  id: string;
  name: string;
  direction: 'in' | 'out';
  contractId?: string;
  schemaRef?: string;
  required?: boolean;
  status?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourcePortId?: string;
  targetPortId?: string;
  contractId: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphContract {
  id: string;
  kind: string;
  interactionKind?: string;
  transport?: string;
  specFormat?: string;
  name: string;
  schema?: Record<string, unknown>;
  schemaRef?: string;
  metadata?: Record<string, unknown>;
  status?: string;
}

export interface GraphArtifact {
  id: string;
  nodeId: string;
  kind: string;
  path: string;
  content?: string;
  language?: string;
  type?: string;
  description?: string;
  status?: string;
}

export interface PatchOperation {
  type: string;
  metadata: {
    id: string;
    actorType: 'ai';
    actorId: string;
    summary: string;
    timestamp: string;
  };
  payload: Record<string, unknown>;
}

export interface PendingTraceUpdate {
  nodeId: string;
  nodeLabel: string;
}

export interface ToolContext {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  branchId: string;
  specificationId?: string;
  graph: GraphState;
  lockedNodeIds: Set<string>;
  patches: PatchOperation[];
  pendingTraceUpdates: PendingTraceUpdate[];
  emitter: SSEEmitter;
  catalogs?: CatalogData;
  providerConfig?: ProviderConfig;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

const VALID_CONTRACT_KINDS: readonly string[] = CONTRACT_KIND_VALUES;
const VALID_INTERACTION_KINDS: readonly string[] = INTERACTION_KIND_VALUES;
const VALID_TRANSPORTS: readonly string[] = TRANSPORT_KIND_VALUES;
const VALID_SPEC_FORMATS: readonly string[] = SPEC_FORMAT_VALUES;

const KIND_FIELDS: Record<string, { interactionKind: string; transport: string; specFormat: string }> = KIND_TO_INTERACTION_FIELDS;
const INTERACTION_DEFAULTS: Record<string, { transport: string; specFormat: string }> = INTERACTION_KIND_DEFAULTS;

interface ResolvedInteraction {
  kind: string;
  interactionKind: string;
  transport: string;
  specFormat: string;
}

function resolveInteraction(args: {
  interactionKind?: string;
  transport?: string;
  specFormat?: string;
  contractKind?: string;
  kind?: string;
}): ResolvedInteraction {
  const rawInteraction = args.interactionKind?.toLowerCase().replace(/[-\s]/g, '');
  const rawTransport = args.transport?.toLowerCase().replace(/[-\s]/g, '');
  const rawSpecFormat = args.specFormat?.toLowerCase().replace(/[-\s]/g, '');
  const rawKind = (args.contractKind || args.kind || '').toLowerCase().replace(/[-\s]/g, '');

  if (rawInteraction && VALID_INTERACTION_KINDS.includes(rawInteraction)) {
    const defaults = INTERACTION_DEFAULTS[rawInteraction] || { transport: 'http', specFormat: 'none' };
    const transport = (rawTransport && VALID_TRANSPORTS.includes(rawTransport)) ? rawTransport : defaults.transport;
    const specFormat = (rawSpecFormat && VALID_SPEC_FORMATS.includes(rawSpecFormat)) ? rawSpecFormat : defaults.specFormat;
    const kind = contractKindForInteraction(rawInteraction, transport);
    return { kind, interactionKind: rawInteraction, transport, specFormat };
  }

  if (rawKind) {
    const resolvedKind = LEGACY_ALIAS_MAP[rawKind] || (VALID_CONTRACT_KINDS.includes(rawKind) ? rawKind : 'custom');
    const fields = KIND_FIELDS[resolvedKind] || KIND_FIELDS['custom'];
    const transport = (rawTransport && VALID_TRANSPORTS.includes(rawTransport)) ? rawTransport : fields.transport;
    const specFormat = (rawSpecFormat && VALID_SPEC_FORMATS.includes(rawSpecFormat)) ? rawSpecFormat : fields.specFormat;
    return { kind: resolvedKind, interactionKind: fields.interactionKind, transport, specFormat };
  }

  const fallback = KIND_FIELDS['custom'];
  return { kind: 'custom', interactionKind: fallback.interactionKind, transport: fallback.transport, specFormat: fallback.specFormat };
}

// M6: this file's private copy of the interaction+transport -> kind table is gone. It was
// the transport-AWARE half of a two-table disagreement; the client's blind half has been
// unified onto it, and the one definition now lives in shared/legacy-mappings alongside
// every other kind-mapping table. Behavior here is unchanged — this WAS the survivor.

function enrichContractFields(contract: GraphContract): void {
  if (contract.interactionKind) return;
  const fields = KIND_FIELDS[contract.kind];
  if (fields) {
    contract.interactionKind = fields.interactionKind;
    contract.transport = fields.transport;
    contract.specFormat = fields.specFormat;
  }
}

function findNodeByLabel(graph: GraphState, label: string): GraphNode | undefined {
  const lower = label.toLowerCase();
  return Object.values(graph.nodes).find(n => n.label.toLowerCase() === lower);
}

function makePatchMeta(ctx: ToolContext, summary: string): PatchOperation['metadata'] {
  return {
    id: crypto.randomUUID(),
    actorType: 'ai',
    actorId: ctx.userId,
    summary,
    timestamp: new Date().toISOString(),
  };
}

function isNodeLocked(ctx: ToolContext, nodeId: string): boolean {
  return ctx.lockedNodeIds.has(nodeId);
}

function toolReadGraph(ctx: ToolContext): ToolResult {
  const nodes = Object.values(ctx.graph.nodes).map(n => {
    const entry: Record<string, unknown> = {
      id: n.id, label: n.label, type: n.type, locked: isNodeLocked(ctx, n.id),
      ports: (n.ports || []).map(p => ({ id: p.id, name: p.name, direction: p.direction })),
    };
    if (n.parentId) {
      entry.parent = ctx.graph.nodes[n.parentId]?.label || n.parentId;
    }
    return entry;
  });
  const edges = Object.values(ctx.graph.edges).map(e => {
    const src = ctx.graph.nodes[e.source];
    const tgt = ctx.graph.nodes[e.target];
    const contract = ctx.graph.contracts[e.contractId];
    return {
      id: e.id,
      source: src?.label || e.source,
      target: tgt?.label || e.target,
      contract: contract?.name || e.contractId,
    };
  });
  return { success: true, data: { nodeCount: nodes.length, edgeCount: edges.length, nodes, edges } };
}

function toolGetNode(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const label = String(args.label || '');
  const node = findNodeByLabel(ctx.graph, label);
  if (!node) return { success: false, error: `Node "${label}" not found` };
  const nodeEdges = Object.values(ctx.graph.edges).filter(e => e.source === node.id || e.target === node.id);
  const artifacts = Object.values(ctx.graph.artifacts).filter(a => a.nodeId === node.id);
  const parentLabel = node.parentId ? (ctx.graph.nodes[node.parentId]?.label || null) : null;
  const children = Object.values(ctx.graph.nodes).filter(n => n.parentId === node.id);
  return {
    success: true,
    data: {
      ...node,
      parent: parentLabel,
      children: children.map(c => ({ id: c.id, label: c.label, type: c.type })),
      connections: nodeEdges.map(e => {
        const other = e.source === node.id ? ctx.graph.nodes[e.target] : ctx.graph.nodes[e.source];
        const contract = ctx.graph.contracts[e.contractId];
        return { direction: e.source === node.id ? 'outgoing' : 'incoming', node: other?.label, contract: contract?.name, contractKind: contract?.kind };
      }),
      artifacts: artifacts.map(a => ({ id: a.id, kind: a.kind, path: a.path, language: a.language })),
    },
  };
}

const READ_ARTIFACT_MAX_CHARS = 8000;

function toolReadArtifact(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const nodeLabel = args.nodeLabel ? String(args.nodeLabel) : undefined;
  const path = args.path ? String(args.path) : undefined;
  const artifactId = args.artifactId ? String(args.artifactId) : undefined;

  let artifact: GraphArtifact | undefined;

  if (artifactId) {
    artifact = ctx.graph.artifacts[artifactId];
  } else if (nodeLabel && path) {
    const node = findNodeByLabel(ctx.graph, nodeLabel);
    if (!node) return { success: false, error: `Node "${nodeLabel}" not found` };
    artifact = Object.values(ctx.graph.artifacts).find(
      a => a.nodeId === node.id && a.path === path
    );
  } else {
    return { success: false, error: 'Provide either artifactId, or both nodeLabel and path' };
  }

  if (!artifact) return { success: false, error: 'Artifact not found' };

  const ownerNode = ctx.graph.nodes[artifact.nodeId];
  let content = artifact.content || '';
  let truncated = false;
  if (content.length > READ_ARTIFACT_MAX_CHARS) {
    content = content.slice(0, READ_ARTIFACT_MAX_CHARS);
    truncated = true;
  }

  return {
    success: true,
    data: {
      id: artifact.id,
      nodeLabel: ownerNode?.label || artifact.nodeId,
      kind: artifact.kind,
      path: artifact.path,
      language: artifact.language,
      description: artifact.description,
      content,
      truncated,
      totalLength: (artifact.content || '').length,
    },
  };
}

function toolReadHierarchy(ctx: ToolContext): ToolResult {
  const nodeList = Object.values(ctx.graph.nodes);
  if (nodeList.length === 0) {
    return { success: true, data: { hierarchy: '(empty graph)' } };
  }

  const childMap: Record<string, GraphNode[]> = {};
  const topLevel: GraphNode[] = [];

  for (const n of nodeList) {
    if (!n.parentId) {
      topLevel.push(n);
    } else {
      if (!childMap[n.parentId]) childMap[n.parentId] = [];
      childMap[n.parentId].push(n);
    }
  }

  const lines: string[] = [];

  function walk(node: GraphNode, depth: number) {
    const indent = '  '.repeat(depth);
    const tech = node.technology ? ` [${node.technology}]` : '';
    const locked = ctx.lockedNodeIds.has(node.id) ? ' (LOCKED)' : '';
    const edgeCount = Object.values(ctx.graph.edges).filter(
      e => e.source === node.id || e.target === node.id
    ).length;
    const edgeSuffix = ` {${edgeCount} edges}`;
    lines.push(`${indent}- "${node.label}" (${node.type}${tech})${locked}${edgeSuffix}`);
    const children = childMap[node.id];
    if (children) {
      for (const child of children.sort((a, b) => a.label.localeCompare(b.label))) {
        walk(child, depth + 1);
      }
    }
  }

  for (const n of topLevel.sort((a, b) => a.label.localeCompare(b.label))) {
    walk(n, 0);
  }

  return {
    success: true,
    data: {
      hierarchy: lines.join('\n'),
      nodeCount: nodeList.length,
      topLevelCount: topLevel.length,
    },
  };
}

async function toolGetRequirements(ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.specificationId) return { success: true, data: { requirements: [] } };
  const { data, error } = await ctx.supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, description, category, section_id, source, locked')
    .eq('specification_id', ctx.specificationId)
    .order('created_at');
  if (error) return { success: false, error: error.message };
  return { success: true, data: { requirements: data || [] } };
}

async function toolGetSpecification(ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.specificationId) return { success: true, data: { specification: null } };
  const { data, error } = await ctx.supabase
    .from('project_specifications')
    .select('id, project_id, vision, constraints, preferences')
    .eq('id', ctx.specificationId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  return { success: true, data: { specification: data } };
}

async function toolAddNode(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const label = String(args.label || '');
  let role = String(args.role || args.type || 'backend-service');
  const description = String(args.description || '');
  const rationale = args.rationale ? String(args.rationale) : undefined;
  let technology = args.technology ? String(args.technology) : undefined;
  let deploymentTarget = args.deploymentTarget ? String(args.deploymentTarget) : undefined;
  const parentLabel = args.parentId ? String(args.parentId) : undefined;
  const extraMetadata = (args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata))
    ? args.metadata as Record<string, unknown>
    : undefined;

  if (!label) return { success: false, error: 'label is required' };

  let resolvedParentId: string | undefined;
  if (parentLabel) {
    const parentNode = findNodeByLabel(ctx.graph, parentLabel);
    if (!parentNode) return { success: false, error: `Parent node "${parentLabel}" not found` };
    if (ctx.catalogs) {
      const parentRole = getRoleDefinition(ctx.catalogs, parentNode.type);
      if (parentRole && !parentRole.isContainer) {
        return { success: false, error: `Node "${parentLabel}" (role: ${parentNode.type}) is not a container and cannot hold child nodes` };
      }
    }
    resolvedParentId = parentNode.id;
  }

  const existing = findNodeByLabel(ctx.graph, label);

  if (existing && isNodeLocked(ctx, existing.id)) {
    return {
      success: true,
      data: {
        id: existing.id,
        label: existing.label,
        type: existing.type,
        action: 'exists_locked',
        message: `Node "${label}" is locked. Use this ID for edge connections.`,
      },
    };
  }

  if (existing) {
    const correction = validateAndCorrectNodeType(ctx.catalogs!, role);
    if (correction.corrected) {
      role = correction.type;
      if (!technology && correction.technologyHint) technology = correction.technologyHint;
      if (!deploymentTarget && correction.deploymentTargetHint) deploymentTarget = correction.deploymentTargetHint;
    } else if (!isValidNodeType(ctx.catalogs!, role)) {
      role = existing.type;
    }

    if (technology) {
      const containerCheck = isContainerTechnologyMismatch(ctx.catalogs!, technology, role);
      if (containerCheck.mismatch) {
        console.warn(`[toolAddNode] Stripped mismatched technology "${technology}" from container "${label}" (${role}): ${containerCheck.reason}`);
        technology = undefined;
      } else {
        const techValidation = validateTechnology(ctx.catalogs!, technology, role);
        if (techValidation.corrected) {
          technology = techValidation.technology;
        } else if (!ctx.catalogs!.technologies[technology]) {
          const placeholder = buildPlaceholderTechnology(technology, role, ctx.projectId, ctx.userId);
          const reg = await registerPlaceholderTechnology(ctx.supabase, ctx.catalogs!, placeholder);
          technology = reg.techId;
        }
      }
    }

    const changes: Record<string, unknown> = {};

    if (role !== existing.type) {
      changes.type = role;
      existing.type = role;
    }
    if (technology && existing.technology !== technology) {
      changes.technology = technology;
      existing.technology = technology;
    }
    if (deploymentTarget && existing.deploymentTarget !== deploymentTarget) {
      changes.deploymentTarget = deploymentTarget;
      existing.deploymentTarget = deploymentTarget;
    }
    if (description && description !== (existing.data as Record<string, unknown>)?.description) {
      existing.data = { ...existing.data, description };
      changes.data = existing.data;
    }
    if (rationale && rationale !== (existing.metadata as Record<string, unknown>)?.rationale) {
      existing.metadata = { ...existing.metadata, rationale };
      changes.metadata = existing.metadata;
    }
    if (resolvedParentId && existing.parentId !== resolvedParentId) {
      changes.parentId = resolvedParentId;
      existing.parentId = resolvedParentId;
    }

    if (Object.keys(changes).length > 0) {
      ctx.patches.push({
        type: 'update_node',
        metadata: makePatchMeta(ctx, `Update existing node: ${label}`),
        payload: { id: existing.id, changes },
      });
      ctx.emitter.nodeUpdated({ id: existing.id, label: existing.label, changes: Object.keys(changes) });
    }

    return {
      success: true,
      data: {
        id: existing.id,
        label: existing.label,
        role: existing.type,
        technology: existing.technology,
        action: Object.keys(changes).length > 0 ? 'updated' : 'unchanged',
      },
    };
  }

  const correction = validateAndCorrectNodeType(ctx.catalogs!, role);
  let roleFallbackIntent: string | undefined;
  if (correction.corrected) {
    role = correction.type;
    if (!technology && correction.technologyHint) technology = correction.technologyHint;
    if (!deploymentTarget && correction.deploymentTargetHint) deploymentTarget = correction.deploymentTargetHint;
  } else if (!isValidNodeType(ctx.catalogs!, role)) {
    roleFallbackIntent = role;
    role = 'backend-service';
  }

  if (technology) {
    const containerCheck = isContainerTechnologyMismatch(ctx.catalogs!, technology, role);
    if (containerCheck.mismatch) {
      console.warn(`[toolAddNode] Stripped mismatched technology "${technology}" from new container "${label}" (${role}): ${containerCheck.reason}`);
      technology = undefined;
    } else {
      const techValidation = validateTechnology(ctx.catalogs!, technology, role);
      if (techValidation.corrected) {
        technology = techValidation.technology;
      } else if (!ctx.catalogs!.technologies[technology]) {
        const placeholder = buildPlaceholderTechnology(technology, role, ctx.projectId, ctx.userId);
        const reg = await registerPlaceholderTechnology(ctx.supabase, ctx.catalogs!, placeholder);
        technology = reg.techId;
      }
    }
  }

  if (!technology && ctx.catalogs) {
    const roleRow = ctx.catalogs.nodeRoles[role];
    if (roleRow?.default_technology) {
      technology = roleRow.default_technology;
    }
  }

  if (resolvedParentId && ctx.catalogs) {
    const parentNode = ctx.graph.nodes[resolvedParentId];
    if (parentNode) {
      const containCheck = canContainerAcceptChild(ctx.catalogs, parentNode.type, role, technology, parentNode.technology);
      if (!containCheck.allowed) {
        return { success: false, error: containCheck.reason || `Container "${parentNode.label}" cannot hold "${role}" nodes` };
      }
    }
  }

  const nodeId = crypto.randomUUID();
  const inPortId = crypto.randomUUID();
  const outPortId = crypto.randomUUID();

  const metadata: Record<string, unknown> = {};
  if (extraMetadata) {
    Object.assign(metadata, extraMetadata);
  }
  if (rationale) {
    metadata.rationale = rationale;
  }
  if (roleFallbackIntent) {
    metadata.suggestedRole = true;
    metadata.originalIntent = roleFallbackIntent;
  }

  const node: GraphNode = {
    id: nodeId,
    type: role,
    label,
    technology,
    deploymentTarget,
    ports: [
      { id: inPortId, name: 'input', direction: 'in' },
      { id: outPortId, name: 'output', direction: 'out' },
    ],
    data: description ? { description } : {},
    metadata,
    status: 'draft',
    artifacts: [],
  };
  if (resolvedParentId) node.parentId = resolvedParentId;

  ctx.graph.nodes[nodeId] = node;

  const payload: Record<string, unknown> = {
    id: nodeId,
    type: role,
    label,
    ports: node.ports,
    data: node.data,
    metadata: node.metadata,
    status: 'draft',
    artifacts: [],
  };
  if (technology) payload.technology = technology;
  if (deploymentTarget) payload.deploymentTarget = deploymentTarget;
  if (resolvedParentId) payload.parentId = resolvedParentId;

  const patch: PatchOperation = {
    type: 'add_node',
    metadata: makePatchMeta(ctx, `Add node: ${label}`),
    payload,
  };
  ctx.patches.push(patch);
  ctx.emitter.nodeCreated({ id: nodeId, label, type: role });

  const responseData: Record<string, unknown> = { id: nodeId, label, role, technology, action: 'created' };

  if (technology && ctx.catalogs) {
    const hints = getTechnologyHints(ctx.catalogs, technology);
    if (hints) {
      if (hints.suggested_files.length > 0) responseData.suggested_files = hints.suggested_files;
      if (hints.common_connections.length > 0) responseData.common_connections = hints.common_connections;
    }
  }

  return { success: true, data: responseData };
}

function toolUpdateNode(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const label = String(args.label || '');
  const node = findNodeByLabel(ctx.graph, label);
  if (!node) return { success: false, error: `Node "${label}" not found` };
  if (isNodeLocked(ctx, node.id)) return { success: false, error: `Node "${label}" is locked by the user and cannot be modified` };

  const changes: Record<string, unknown> = {};
  if (args.newLabel && String(args.newLabel) !== node.label) {
    changes.label = String(args.newLabel);
    node.label = String(args.newLabel);
  }
  const roleArg = args.role || args.type;
  if (roleArg) {
    const correction = validateAndCorrectNodeType(ctx.catalogs!, String(roleArg));
    const newType = correction.corrected ? correction.type : String(roleArg);
    if (isValidNodeType(ctx.catalogs!, newType)) {
      changes.type = newType;
      node.type = newType;
    }
  }
  if (args.technology) {
    const roleForValidation = (changes.type as string) || node.type;
    const techValidation = validateTechnology(ctx.catalogs!, String(args.technology), roleForValidation);
    const newTech = techValidation.corrected ? techValidation.technology : String(args.technology);
    changes.technology = newTech;
    node.technology = newTech;
  }
  if (args.deploymentTarget) {
    changes.deploymentTarget = String(args.deploymentTarget);
    node.deploymentTarget = String(args.deploymentTarget);
  }
  if (args.description) {
    node.data = { ...node.data, description: String(args.description) };
    changes.data = node.data;
  }
  if (args.rationale) {
    node.metadata = { ...node.metadata, rationale: String(args.rationale) };
    changes.metadata = node.metadata;
  }
  if (args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)) {
    node.metadata = { ...node.metadata, ...(args.metadata as Record<string, unknown>) };
    changes.metadata = node.metadata;
  }

  if (Object.keys(changes).length === 0) return { success: false, error: 'No changes specified' };

  const patch: PatchOperation = {
    type: 'update_node',
    metadata: makePatchMeta(ctx, `Update node: ${label}`),
    payload: { id: node.id, changes },
  };
  ctx.patches.push(patch);
  ctx.emitter.nodeUpdated({ id: node.id, label: node.label, changes: Object.keys(changes) });

  return { success: true, data: { id: node.id, updated: Object.keys(changes) } };
}

function toolRemoveNode(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const label = String(args.label || '');
  const node = findNodeByLabel(ctx.graph, label);
  if (!node) return { success: false, error: `Node "${label}" not found` };
  if (isNodeLocked(ctx, node.id)) return { success: false, error: `Node "${label}" is locked by the user and cannot be removed` };

  const connectedEdges = Object.values(ctx.graph.edges).filter(
    e => e.source === node.id || e.target === node.id
  );
  for (const edge of connectedEdges) {
    delete ctx.graph.edges[edge.id];
    ctx.patches.push({
      type: 'remove_edge',
      metadata: makePatchMeta(ctx, `Remove edge connected to deleted node: ${label}`),
      payload: { id: edge.id },
    });
    ctx.emitter.edgeRemoved({ id: edge.id });
  }

  delete ctx.graph.nodes[node.id];
  const patch: PatchOperation = {
    type: 'remove_node',
    metadata: makePatchMeta(ctx, `Remove node: ${label}`),
    payload: { id: node.id },
  };
  ctx.patches.push(patch);
  ctx.emitter.nodeRemoved({ id: node.id, label });

  return { success: true, data: { id: node.id, removedEdges: connectedEdges.length } };
}

function toolAddEdge(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const sourceLabel = String(args.source || '');
  const targetLabel = String(args.target || '');
  const contractName = String(args.contractName || `${sourceLabel}-to-${targetLabel}`);
  const edgeLabel = args.label ? String(args.label) : undefined;
  const schema = args.schema && typeof args.schema === 'object' ? args.schema as Record<string, unknown> : undefined;

  const resolved = resolveInteraction({
    interactionKind: args.interactionKind ? String(args.interactionKind) : undefined,
    transport: args.transport ? String(args.transport) : undefined,
    specFormat: args.specFormat ? String(args.specFormat) : undefined,
    contractKind: args.contractKind ? String(args.contractKind) : undefined,
  });

  const sourceNode = findNodeByLabel(ctx.graph, sourceLabel);
  const targetNode = findNodeByLabel(ctx.graph, targetLabel);
  if (!sourceNode) return { success: false, error: `Source node "${sourceLabel}" not found` };
  if (!targetNode) return { success: false, error: `Target node "${targetLabel}" not found` };

  const existingEdge = Object.values(ctx.graph.edges).find(
    e => e.source === sourceNode.id && e.target === targetNode.id
  );

  if (existingEdge) {
    const existingContract = ctx.graph.contracts[existingEdge.contractId];
    if (schema && existingContract && !existingContract.schema) {
      existingContract.schema = schema;
      ctx.patches.push({
        type: 'update_contract',
        metadata: makePatchMeta(ctx, `Set schema on contract: ${existingContract.name}`),
        payload: { id: existingContract.id, changes: { schema } },
      });
    }
    return {
      success: true,
      data: {
        id: existingEdge.id,
        contractId: existingEdge.contractId,
        contractName: existingContract?.name || 'unknown',
        action: 'exists',
        message: `Edge from "${sourceLabel}" to "${targetLabel}" already exists.`,
      },
    };
  }

  let contract = Object.values(ctx.graph.contracts).find(
    c => c.name.toLowerCase() === contractName.toLowerCase()
  );

  if (!contract) {
    const contractId = crypto.randomUUID();
    contract = {
      id: contractId,
      kind: resolved.kind,
      name: contractName,
      status: 'draft',
      interactionKind: resolved.interactionKind,
      transport: resolved.transport,
      specFormat: resolved.specFormat,
    };
    if (schema) contract.schema = schema;
    ctx.graph.contracts[contractId] = contract;
    const contractPayload: Record<string, unknown> = {
      id: contractId,
      kind: resolved.kind,
      name: contractName,
      status: 'draft',
      interactionKind: resolved.interactionKind,
      transport: resolved.transport,
      specFormat: resolved.specFormat,
    };
    if (schema) contractPayload.schema = schema;
    ctx.patches.push({
      type: 'add_contract',
      metadata: makePatchMeta(ctx, `Add contract: ${contractName}`),
      payload: contractPayload,
    });
    ctx.emitter.contractCreated({ id: contractId, name: contractName, kind: resolved.kind });
  } else if (schema && !contract.schema) {
    contract.schema = schema;
    ctx.patches.push({
      type: 'update_contract',
      metadata: makePatchMeta(ctx, `Set schema on contract: ${contractName}`),
      payload: { id: contract.id, changes: { schema } },
    });
  }

  const sourcePort = (sourceNode.ports || []).find(p => p.direction === 'out') || sourceNode.ports?.[0];
  const targetPort = (targetNode.ports || []).find(p => p.direction === 'in') || targetNode.ports?.[0];

  const edgeId = crypto.randomUUID();
  const edge: GraphEdge = {
    id: edgeId,
    source: sourceNode.id,
    target: targetNode.id,
    sourcePortId: sourcePort?.id,
    targetPortId: targetPort?.id,
    contractId: contract.id,
    label: edgeLabel,
  };
  ctx.graph.edges[edgeId] = edge;

  ctx.patches.push({
    type: 'add_edge',
    metadata: makePatchMeta(ctx, `Add edge: ${sourceLabel} -> ${targetLabel}`),
    payload: edge,
  });
  ctx.emitter.edgeCreated({ id: edgeId, sourceLabel, targetLabel, contractName: contract.name });

  return { success: true, data: { id: edgeId, contractId: contract.id, contractName: contract.name, action: 'created' } };
}

function toolRemoveEdge(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const sourceLabel = String(args.source || '');
  const targetLabel = String(args.target || '');

  const sourceNode = findNodeByLabel(ctx.graph, sourceLabel);
  const targetNode = findNodeByLabel(ctx.graph, targetLabel);
  if (!sourceNode || !targetNode) return { success: false, error: `One or both nodes not found` };

  const edge = Object.values(ctx.graph.edges).find(
    e => e.source === sourceNode.id && e.target === targetNode.id
  );
  if (!edge) return { success: false, error: `No edge from "${sourceLabel}" to "${targetLabel}"` };

  delete ctx.graph.edges[edge.id];
  ctx.patches.push({
    type: 'remove_edge',
    metadata: makePatchMeta(ctx, `Remove edge: ${sourceLabel} -> ${targetLabel}`),
    payload: { id: edge.id },
  });
  ctx.emitter.edgeRemoved({ id: edge.id });

  return { success: true, data: { id: edge.id } };
}

function toolAddContract(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const name = String(args.name || '');
  const schema = args.schema && typeof args.schema === 'object' ? args.schema as Record<string, unknown> : undefined;
  if (!name) return { success: false, error: 'name is required' };

  const resolved = resolveInteraction({
    interactionKind: args.interactionKind ? String(args.interactionKind) : undefined,
    transport: args.transport ? String(args.transport) : undefined,
    specFormat: args.specFormat ? String(args.specFormat) : undefined,
    contractKind: args.kind ? String(args.kind) : undefined,
  });

  const existing = Object.values(ctx.graph.contracts).find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (schema && !existing.schema) {
      existing.schema = schema;
      ctx.patches.push({
        type: 'update_contract',
        metadata: makePatchMeta(ctx, `Set schema on contract: ${name}`),
        payload: { id: existing.id, changes: { schema } },
      });
    }
    return {
      success: true,
      data: { id: existing.id, name: existing.name, kind: existing.kind, action: existing.schema === schema ? 'exists' : 'updated' },
    };
  }

  const contractId = crypto.randomUUID();
  const contract: GraphContract = {
    id: contractId,
    kind: resolved.kind,
    name,
    status: 'draft',
    interactionKind: resolved.interactionKind,
    transport: resolved.transport,
    specFormat: resolved.specFormat,
  };
  if (schema) contract.schema = schema;
  ctx.graph.contracts[contractId] = contract;

  const payload: Record<string, unknown> = {
    id: contractId,
    kind: resolved.kind,
    name,
    status: 'draft',
    interactionKind: resolved.interactionKind,
    transport: resolved.transport,
    specFormat: resolved.specFormat,
  };
  if (schema) payload.schema = schema;

  ctx.patches.push({
    type: 'add_contract',
    metadata: makePatchMeta(ctx, `Add contract: ${name}`),
    payload,
  });
  ctx.emitter.contractCreated({ id: contractId, name, kind: resolved.kind });

  return { success: true, data: { id: contractId, name, kind: resolved.kind, action: 'created' } };
}

function toolAddPort(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const nodeLabel = String(args.nodeLabel || '');
  const portName = String(args.portName || '');
  const direction = String(args.direction || 'in') as 'in' | 'out';

  const node = findNodeByLabel(ctx.graph, nodeLabel);
  if (!node) return { success: false, error: `Node "${nodeLabel}" not found` };
  if (!portName) return { success: false, error: 'portName is required' };

  const portId = crypto.randomUUID();
  const port: GraphPort = { id: portId, name: portName, direction };

  if (!node.ports) node.ports = [];
  node.ports.push(port);

  ctx.patches.push({
    type: 'add_port',
    metadata: makePatchMeta(ctx, `Add port "${portName}" to ${nodeLabel}`),
    payload: { nodeId: node.id, port: { id: portId, name: portName, direction } },
  });
  ctx.emitter.portAdded({ nodeId: node.id, nodeLabel, portName, direction });

  return { success: true, data: { portId, nodeId: node.id } };
}

export function inferPlacementKind(ctx: ToolContext, parentType: string, childType?: string, childTechnology?: string): string {
  if (!ctx.catalogs) return 'contains';
  const parentRole = getRoleDefinition(ctx.catalogs, parentType);
  if (!parentRole) return 'contains';
  if (parentRole.containerLayer === 'infrastructure') return 'hosts';
  // N2/N2.3: an EFFECTIVE-boundary child (role default, or raised by a boundary-engine
  // technology) is an engine NodeSpec wires up, not code it contains — unless genuinely
  // hosted (above), its membership in a container is scoping only.
  if (childType) {
    const childRole = getRoleDefinition(ctx.catalogs, childType);
    const techRow = childTechnology ? ctx.catalogs.technologies[childTechnology] : undefined;
    const techOverride = (techRow?.ai_context as Record<string, unknown> | undefined)?.treatmentOverride as string | undefined;
    if (childRole?.treatmentMode !== 'container' &&
        effectiveTreatment(childRole?.treatmentMode ?? 'leaf', techOverride) === 'boundary') {
      return 'scopes';
    }
  }
  if (parentRole.containerLayer === 'logical') return 'scopes';
  return 'contains';
}

const VALID_PLACEMENT_KINDS = new Set(['contains', 'hosts', 'deployed_to', 'scopes']);

function toolSetParent(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const nodeLabel = String(args.nodeLabel || '');
  const parentLabel = args.parentLabel != null ? String(args.parentLabel) : null;
  const explicitPlacement = args.placementKind ? String(args.placementKind) : null;

  if (explicitPlacement && !VALID_PLACEMENT_KINDS.has(explicitPlacement)) {
    return { success: false, error: `Invalid placementKind "${explicitPlacement}". Must be one of: contains, hosts, deployed_to, scopes` };
  }

  const node = findNodeByLabel(ctx.graph, nodeLabel);
  if (!node) return { success: false, error: `Node "${nodeLabel}" not found` };
  if (isNodeLocked(ctx, node.id)) return { success: false, error: `Node "${nodeLabel}" is locked and cannot be modified` };

  if (parentLabel === null || parentLabel === '' || parentLabel.toLowerCase() === 'null') {
    if (!node.parentId) return { success: true, data: { id: node.id, parentId: null, action: 'unchanged' } };

    const oldParentId = node.parentId;
    delete node.parentId;
    delete (node as Record<string, unknown>).placementKind;

    ctx.patches.push({
      type: 'update_node',
      metadata: makePatchMeta(ctx, `Unparent node: ${nodeLabel}`),
      payload: { id: node.id, changes: { parentId: null, placementKind: null } },
    });
    ctx.emitter.nodeUpdated({ id: node.id, label: node.label, changes: ['parentId', 'placementKind'] });

    return { success: true, data: { id: node.id, oldParentId, parentId: null, action: 'unparented' } };
  }

  const parentNode = findNodeByLabel(ctx.graph, parentLabel);
  if (!parentNode) return { success: false, error: `Parent node "${parentLabel}" not found` };

  if (parentNode.id === node.id) return { success: false, error: 'A node cannot be its own parent' };

  if (ctx.catalogs) {
    const parentRole = getRoleDefinition(ctx.catalogs, parentNode.type);
    if (parentRole && !parentRole.isContainer) {
      return { success: false, error: `Node "${parentLabel}" (role: ${parentNode.type}) is not a container and cannot hold child nodes` };
    }
    const containCheck = canContainerAcceptChild(ctx.catalogs, parentNode.type, node.type, node.technology, parentNode.technology);
    if (!containCheck.allowed) {
      return { success: false, error: containCheck.reason || `Container "${parentLabel}" cannot hold "${node.type}" nodes` };
    }
  }

  const placementKind = explicitPlacement || inferPlacementKind(ctx, parentNode.type, node.type, node.technology);

  if (node.parentId === parentNode.id && (node as Record<string, unknown>).placementKind === placementKind) {
    return { success: true, data: { id: node.id, parentId: parentNode.id, placementKind, action: 'unchanged' } };
  }

  const oldParentId = node.parentId;
  node.parentId = parentNode.id;
  (node as Record<string, unknown>).placementKind = placementKind;

  ctx.patches.push({
    type: 'update_node',
    metadata: makePatchMeta(ctx, `Move "${nodeLabel}" into "${parentLabel}" (${placementKind})`),
    payload: { id: node.id, changes: { parentId: parentNode.id, placementKind } },
  });
  ctx.emitter.nodeUpdated({ id: node.id, label: node.label, changes: ['parentId', 'placementKind'] });

  return { success: true, data: { id: node.id, oldParentId: oldParentId ?? null, parentId: parentNode.id, parentLabel, placementKind, action: 'reparented' } };
}

async function toolSaveSpecification(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const vision = String(args.vision || '');
  const constraints = (args.constraints || []) as Array<{ type: string; description: string }>;
  const preferences = (args.preferences || {}) as Record<string, unknown>;

  if (!vision) return { success: false, error: 'vision is required' };

  if (ctx.specificationId) {
    const { data, error } = await ctx.supabase
      .from('project_specifications')
      .update({ vision, constraints, preferences, updated_at: new Date().toISOString() })
      .eq('id', ctx.specificationId)
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    ctx.emitter.specificationSaved({ specificationId: data.id, vision });
    return { success: true, data: { specificationId: data.id, action: 'updated' } };
  }

  const { data, error } = await ctx.supabase
    .from('project_specifications')
    .insert({
      project_id: ctx.projectId,
      vision,
      constraints,
      preferences,
      raw_input: vision,
      created_by: ctx.userId,
    })
    .select('id')
    .single();

  if (error) return { success: false, error: error.message };
  ctx.specificationId = data.id;
  ctx.emitter.specificationSaved({ specificationId: data.id, vision });
  return { success: true, data: { specificationId: data.id, action: 'created' } };
}

async function toolCreateSection(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.specificationId) return { success: false, error: 'Save the specification first.' };

  const name = String(args.name || '');
  const description = args.description ? String(args.description) : null;
  const orderIndex = validateOrderIndex(args.orderIndex);

  if (!name) return { success: false, error: 'name is required' };

  const { data, error } = await ctx.supabase
    .from('specification_sections')
    .insert({ specification_id: ctx.specificationId, name, description, order_index: orderIndex, ai_generated: true })
    .select('id, name, order_index')
    .single();

  if (error) return { success: false, error: error.message };
  ctx.emitter.sectionCreated({ sectionId: data.id, name: data.name, orderIndex: data.order_index });
  return { success: true, data: { sectionId: data.id, name: data.name } };
}

async function toolCreateRequirement(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.specificationId) return { success: false, error: 'Save the specification first.' };

  const requirementId = String(args.requirementId || '');
  const name = String(args.name || '');
  const description = args.description ? String(args.description) : null;
  const category = String(args.category || 'functional');
  const sectionName = args.sectionName ? String(args.sectionName) : undefined;
  const acceptanceCriteria = (args.acceptanceCriteria || []) as Array<{ text: string }>;

  if (!requirementId || !name) return { success: false, error: 'requirementId and name are required' };

  const allowedCategories = ['functional', 'non-functional', 'technical', 'business'];
  const normalizedCategory = allowedCategories.includes(category.toLowerCase()) ? category.toLowerCase() : 'functional';

  const { data: existing } = await ctx.supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, source, locked')
    .eq('specification_id', ctx.specificationId)
    .eq('requirement_id', requirementId)
    .maybeSingle();

  if (existing && (existing.source === 'manual' || existing.locked)) {
    return {
      success: true,
      data: {
        id: existing.id,
        requirementId: existing.requirement_id,
        name: existing.name,
        action: 'preserved',
        message: `Requirement "${existing.requirement_id}" was manually created and cannot be overwritten by AI. Use a different requirementId or ask the user to modify it.`,
      },
    };
  }

  let sectionId: string | null = null;
  if (sectionName) {
    const { data: section } = await ctx.supabase
      .from('specification_sections')
      .select('id')
      .eq('specification_id', ctx.specificationId)
      .eq('name', sectionName)
      .maybeSingle();
    sectionId = section?.id || null;
  }

  const { data, error } = await ctx.supabase
    .from('specification_requirements')
    .upsert(
      {
        specification_id: ctx.specificationId,
        requirement_id: requirementId,
        name,
        description,
        category: normalizedCategory,
        status: 'pending',
        acceptance_criteria: acceptanceCriteria,
        section_id: sectionId,
        source: 'ai-generated',
      },
      { onConflict: 'specification_id,requirement_id', ignoreDuplicates: false }
    )
    .select('id, requirement_id, name, category')
    .single();

  if (error) return { success: false, error: error.message };
  ctx.emitter.requirementCreated({ requirementId: data.requirement_id, name: data.name, category: data.category });
  return { success: true, data: { id: data.id, requirementId: data.requirement_id, name: data.name } };
}

async function toolGenerateAcceptanceCriteria(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.specificationId) return { success: false, error: 'No specification context available.' };

  const requirementId = String(args.requirementId || '');
  if (!requirementId) return { success: false, error: 'requirementId is required' };

  const { data: req, error: fetchErr } = await ctx.supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, description, category, acceptance_criteria')
    .eq('specification_id', ctx.specificationId)
    .eq('requirement_id', requirementId)
    .maybeSingle();

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!req) return { success: false, error: `Requirement "${requirementId}" not found` };

  const existingCriteria = Array.isArray(req.acceptance_criteria) ? req.acceptance_criteria : [];
  if (existingCriteria.length > 0) {
    return {
      success: true,
      data: {
        requirementId: req.requirement_id,
        name: req.name,
        action: 'already_exists',
        criteriaCount: existingCriteria.length,
        criteria: existingCriteria,
        message: `Requirement "${req.requirement_id}" already has ${existingCriteria.length} acceptance criteria. Use create_requirement to replace them or evaluate_criteria to update their status.`,
      },
    };
  }

  const { data: spec } = await ctx.supabase
    .from('project_specifications')
    .select('vision, preferences')
    .eq('id', ctx.specificationId)
    .maybeSingle();

  const provider = ctx.providerConfig ?? resolvePlatformConfig();

  const specContext = spec
    ? `Project Vision: ${spec.vision || "not set"}\nPreferences: ${JSON.stringify(spec.preferences || {})}`
    : "";

  const prompt = `Generate acceptance criteria for this software requirement.

${specContext ? `PROJECT CONTEXT:\n${specContext}\n` : ""}
REQUIREMENT: ${req.requirement_id} - "${req.name}"
Description: "${req.description || "none"}"
Category: ${req.category}

Generate 2-5 specific, testable acceptance criteria. Each criterion should:
- Be independently verifiable
- Use clear, measurable language (e.g., "Given... When... Then..." or "The system must...")
- Cover the key behaviors and edge cases of this requirement
- Be concrete enough that a test case could be written for it

Respond ONLY with valid JSON: { "criteria": [{ "text": "..." }, ...] }`;

  let content: string | null;
  try {
    const result = await sendChatCompletion(provider, {
      model: provider.model,
      temperature: 0.3,
      messages: [
        { role: "system", content: "You are a requirements engineer. Generate precise, testable acceptance criteria. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
    });
    content = result.content;
  } catch (err) {
    return { success: false, error: `AI API error: ${(err as Error).message}` };
  }

  if (!content) return { success: false, error: 'No AI response' };

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { success: false, error: 'Invalid JSON from AI' };

  let aiResult: { criteria: Array<{ text: string }> };
  try {
    aiResult = JSON.parse(jsonMatch[0]);
  } catch {
    return { success: false, error: 'Failed to parse AI response as JSON' };
  }

  const newCriteria = (aiResult.criteria || [])
    .filter((c: { text?: string }) => c.text && typeof c.text === 'string')
    .slice(0, 5)
    .map((c: { text: string }) => ({ text: c.text }));

  if (newCriteria.length === 0) {
    return { success: false, error: 'AI did not generate any valid acceptance criteria' };
  }

  const { error: updateErr } = await ctx.supabase
    .from('specification_requirements')
    .update({ acceptance_criteria: newCriteria, updated_at: new Date().toISOString() })
    .eq('id', req.id);

  if (updateErr) return { success: false, error: updateErr.message };

  return {
    success: true,
    data: {
      requirementId: req.requirement_id,
      name: req.name,
      criteriaCount: newCriteria.length,
      criteria: newCriteria,
    },
  };
}

async function toolSetAcceptanceCriteria(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.specificationId) return { success: false, error: 'No specification context available.' };

  const requirementId = String(args.requirementId || '');
  if (!requirementId) return { success: false, error: 'requirementId is required' };

  const rawCriteria = args.criteria;
  if (!Array.isArray(rawCriteria) || rawCriteria.length === 0) {
    return { success: false, error: 'criteria must be a non-empty array of objects with a "text" field' };
  }

  const criteria = rawCriteria
    .filter((c: unknown) => c && typeof c === 'object' && 'text' in (c as Record<string, unknown>) && typeof (c as Record<string, string>).text === 'string')
    .slice(0, 10)
    .map((c: unknown) => ({ text: (c as Record<string, string>).text }));

  if (criteria.length === 0) {
    return { success: false, error: 'No valid criteria provided. Each must have a "text" field.' };
  }

  const { data: req, error: fetchErr } = await ctx.supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, acceptance_criteria')
    .eq('specification_id', ctx.specificationId)
    .eq('requirement_id', requirementId)
    .maybeSingle();

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!req) return { success: false, error: `Requirement "${requirementId}" not found` };

  const mode = String(args.mode || 'replace');
  let finalCriteria: Array<{ text: string; met?: boolean; testId?: string }>;

  if (mode === 'append') {
    const existing = Array.isArray(req.acceptance_criteria) ? req.acceptance_criteria : [];
    finalCriteria = [...existing, ...criteria];
  } else {
    finalCriteria = criteria;
  }

  const { error: updateErr } = await ctx.supabase
    .from('specification_requirements')
    .update({ acceptance_criteria: finalCriteria, updated_at: new Date().toISOString() })
    .eq('id', req.id);

  if (updateErr) return { success: false, error: updateErr.message };

  return {
    success: true,
    data: {
      requirementId: req.requirement_id,
      name: req.name,
      mode,
      criteriaCount: finalCriteria.length,
      criteria: finalCriteria,
    },
  };
}

async function toolEvaluateCriteria(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.specificationId) return { success: false, error: 'No specification context available.' };

  const requirementId = String(args.requirementId || '');
  const criterionIndex = typeof args.criterionIndex === 'number' ? args.criterionIndex : parseInt(String(args.criterionIndex ?? ''), 10);
  const met = args.met === true || args.met === 'true';
  const evidence = args.evidence ? String(args.evidence) : undefined;

  if (!requirementId) return { success: false, error: 'requirementId is required' };
  if (isNaN(criterionIndex) || criterionIndex < 0) return { success: false, error: 'criterionIndex must be a non-negative integer' };

  const { data: req, error: fetchErr } = await ctx.supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, acceptance_criteria')
    .eq('specification_id', ctx.specificationId)
    .eq('requirement_id', requirementId)
    .maybeSingle();

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!req) return { success: false, error: `Requirement "${requirementId}" not found` };

  const criteria = Array.isArray(req.acceptance_criteria) ? [...req.acceptance_criteria] : [];
  if (criterionIndex >= criteria.length) {
    return { success: false, error: `criterionIndex ${criterionIndex} out of range (${criteria.length} criteria exist)` };
  }

  criteria[criterionIndex] = {
    ...criteria[criterionIndex],
    met,
    ...(evidence ? { evidence } : {}),
  };

  const { error: updateErr } = await ctx.supabase
    .from('specification_requirements')
    .update({ acceptance_criteria: criteria })
    .eq('id', req.id);

  if (updateErr) return { success: false, error: updateErr.message };

  return {
    success: true,
    data: {
      requirementId: req.requirement_id,
      requirementName: req.name,
      criterionIndex,
      criterionText: criteria[criterionIndex].text,
      met,
      evidence: evidence || null,
      totalCriteria: criteria.length,
      metCount: criteria.filter((c: { met?: boolean }) => c.met === true).length,
    },
  };
}

async function toolVerifyRequirement(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.specificationId) return { success: false, error: 'No specification context available.' };

  const requirementId = String(args.requirementId || '');
  if (!requirementId) return { success: false, error: 'requirementId is required' };

  const { data: req, error: fetchErr } = await ctx.supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, description, category, status, acceptance_criteria')
    .eq('specification_id', ctx.specificationId)
    .eq('requirement_id', requirementId)
    .maybeSingle();

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!req) return { success: false, error: `Requirement "${requirementId}" not found` };

  const { data: mappings } = await ctx.supabase
    .from('specification_mappings')
    .select('id, node_id, mapping_type, confidence, is_orphan')
    .eq('specification_id', ctx.specificationId)
    .eq('requirement_id', req.id);

  const validMappings = (mappings || []).filter((m: { is_orphan?: boolean }) => !m.is_orphan);

  const nodeEvidence: Array<{
    nodeLabel: string;
    nodeType: string;
    mappingType: string;
    confidence: number;
    artifacts: Array<{ path: string; kind: string; status: string }>;
  }> = [];

  for (const mapping of validMappings) {
    const node = ctx.graph.nodes[mapping.node_id];
    if (!node) continue;

    const nodeArtifacts = Object.values(ctx.graph.artifacts)
      .filter(a => a.nodeId === node.id)
      .map(a => ({ path: a.path, kind: a.kind, status: a.status || 'draft' }));

    nodeEvidence.push({
      nodeLabel: node.label,
      nodeType: node.type,
      mappingType: mapping.mapping_type,
      confidence: mapping.confidence,
      artifacts: nodeArtifacts,
    });
  }

  const criteria = Array.isArray(req.acceptance_criteria) ? req.acceptance_criteria : [];
  const criteriaStatus = criteria.map((c: { text: string; met?: boolean; evidence?: string }, i: number) => ({
    index: i,
    text: c.text,
    met: c.met === true,
    evidence: c.evidence || null,
  }));

  return {
    success: true,
    data: {
      requirementId: req.requirement_id,
      name: req.name,
      description: req.description,
      status: req.status,
      criteria: {
        total: criteriaStatus.length,
        met: criteriaStatus.filter((c: { met: boolean }) => c.met).length,
        items: criteriaStatus,
      },
      implementingNodes: nodeEvidence,
      totalMappings: validMappings.length,
      orphanedMappings: (mappings || []).length - validMappings.length,
    },
  };
}

async function toolGenerateTests(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.specificationId) return { success: false, error: 'No specification context available.' };

  const requirementId = String(args.requirementId || '');
  if (!requirementId) return { success: false, error: 'requirementId is required' };

  const { data: req, error: fetchErr } = await ctx.supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, description, category, acceptance_criteria')
    .eq('specification_id', ctx.specificationId)
    .eq('requirement_id', requirementId)
    .maybeSingle();

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!req) return { success: false, error: `Requirement "${requirementId}" not found` };

  const criteria = Array.isArray(req.acceptance_criteria) ? req.acceptance_criteria : [];
  if (criteria.length === 0) {
    return { success: true, data: { message: 'No acceptance criteria to generate test plan for', requirementId: req.requirement_id } };
  }

  // Gather mapped nodes
  const { data: mappings } = await ctx.supabase
    .from('specification_mappings')
    .select('node_id, mapping_type')
    .eq('requirement_id', req.id);

  const mappedNodeIds = (mappings || []).map((m: { node_id: string }) => m.node_id);
  const mappedNodes: Array<{ nodeId: string; label: string; role: string; technology?: string }> = [];

  for (const nodeId of mappedNodeIds) {
    const n = ctx.graph.nodes[nodeId];
    if (!n) continue;
    mappedNodes.push({
      nodeId,
      label: n.label,
      role: n.type || 'unknown',
      technology: n.technology,
    });
  }

  // Collect source artifacts from graph
  const sourceArtifacts: Array<{ id: string; nodeId: string; kind: string; path: string; content?: string; language?: string; status?: string; description?: string }> = [];
  for (const [artId, art] of Object.entries(ctx.graph.artifacts)) {
    if (art.nodeId && mappedNodeIds.includes(art.nodeId) && art.kind === 'source' && art.status !== 'suggested') {
      sourceArtifacts.push({
        id: artId,
        nodeId: art.nodeId,
        kind: art.kind,
        path: art.path,
        content: typeof art.content === 'string' ? art.content : undefined,
        language: art.language,
        status: art.status,
        description: art.description,
      });
    }
  }

  // Get project vision
  let projectVision: string | undefined;
  if (ctx.specificationId) {
    const { data: specVision } = await ctx.supabase
      .from('project_specifications')
      .select('vision')
      .eq('id', ctx.specificationId)
      .maybeSingle();
    if (specVision?.vision) {
      projectVision = specVision.vision;
    }
  }

  // Generate the test plan document
  const content = generateTestDocument({
    requirement: {
      requirementId: req.requirement_id,
      name: req.name,
      description: req.description || '',
      category: req.category,
      acceptanceCriteria: criteria.map((c: { text: string; met?: boolean }) => ({ text: c.text, met: c.met })),
    },
    graph: {
      nodes: ctx.graph.nodes as any,
      edges: ctx.graph.edges as any,
      contracts: ctx.graph.contracts as any,
      artifacts: ctx.graph.artifacts as any,
    },
    catalogs: ctx.catalogs || { roles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} },
    mappedNodes,
    sourceArtifacts,
    projectVision,
  });

  const testDocPath = getTestDocumentPath(req.requirement_id, req.name);
  const primaryNodeId = mappedNodes.length > 0 ? mappedNodes[0].nodeId : null;

  // Check if a test-plan artifact already exists
  const { data: existingArtifact } = await ctx.supabase
    .from('artifacts')
    .select('id')
    .eq('project_id', ctx.projectId)
    .eq('kind', 'test-plan')
    .eq('path', testDocPath)
    .maybeSingle();

  let artifactId: string;

  if (existingArtifact) {
    await ctx.supabase
      .from('artifacts')
      .update({
        content_text: content,
        status: 'draft',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingArtifact.id);
    artifactId = existingArtifact.id;
  } else {
    const { data: newArtifact } = await ctx.supabase
      .from('artifacts')
      .insert({
        project_id: ctx.projectId,
        kind: 'test-plan',
        path: testDocPath,
        content_text: content,
        language: 'markdown',
        node_id: primaryNodeId,
        status: 'draft',
        description: `Test Plan: ${req.requirement_id} - ${req.name}`,
      })
      .select('id')
      .single();
    artifactId = newArtifact?.id || '';
  }

  return {
    success: true,
    data: {
      requirementId: req.requirement_id,
      requirementName: req.name,
      testPlanGenerated: true,
      artifactId,
      path: testDocPath,
      criteriaCount: criteria.length,
      mappedNodeCount: mappedNodes.length,
    },
  };
}

function evaluateContractStatus(ctx: ToolContext, nodeId: string): void {
  const nodeEdges = Object.values(ctx.graph.edges).filter(
    e => e.source === nodeId || e.target === nodeId
  );
  const nodeArtifacts = Object.values(ctx.graph.artifacts).filter(a => a.nodeId === nodeId);
  const hasSource = nodeArtifacts.some(a => a.kind === 'source');
  const hasSchema = nodeArtifacts.some(a => a.kind === 'schema');
  const nodeLabel = ctx.graph.nodes[nodeId]?.label || nodeId;

  for (const edge of nodeEdges) {
    const contract = ctx.graph.contracts[edge.contractId];
    if (!contract || contract.status === 'complete') continue;

    let implemented = false;
    switch (contract.kind) {
      case 'grpc':
        implemented = hasSchema || hasSource;
        break;
      case 'graphql':
        implemented = hasSchema || hasSource;
        break;
      default:
        implemented = hasSource;
        break;
    }

    if (implemented && contract.status !== 'complete') {
      contract.status = 'complete';
      ctx.patches.push({
        type: 'update_contract',
        metadata: makePatchMeta(ctx, `Contract "${contract.name}" implemented by ${nodeLabel}`),
        payload: { id: contract.id, changes: { status: 'complete' } },
      });
    }
  }
}

function detectLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    kt: 'kotlin', swift: 'swift', cs: 'csharp', cpp: 'cpp', c: 'c',
    php: 'php', sql: 'sql', yaml: 'yaml', yml: 'yaml', json: 'json',
    toml: 'toml', xml: 'xml', html: 'html', css: 'css', scss: 'scss',
    proto: 'protobuf', graphql: 'graphql', gql: 'graphql',
    dockerfile: 'dockerfile', tf: 'terraform', hcl: 'terraform',
    sh: 'shell', bash: 'shell', md: 'markdown',
  };
  if (path.toLowerCase().includes('dockerfile')) return 'dockerfile';
  return langMap[ext || ''] || 'text';
}

function toolAddArtifact(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const nodeLabel = String(args.nodeLabel || '');
  const path = String(args.path || '');
  const kind = String(args.kind || 'source');
  const content = String(args.content || '');
  const description = args.description ? String(args.description) : undefined;
  const language = args.language ? String(args.language) : detectLanguageFromPath(path);

  if (!nodeLabel) return { success: false, error: 'nodeLabel is required' };
  if (!path) return { success: false, error: 'path is required' };
  if (!content) return { success: false, error: 'content is required' };

  const node = findNodeByLabel(ctx.graph, nodeLabel);
  if (!node) return { success: false, error: `Node "${nodeLabel}" not found` };

  const validKinds = ['source', 'schema', 'config', 'build', 'doc', 'design', 'task'];
  const normalizedKind = validKinds.includes(kind.toLowerCase()) ? kind.toLowerCase() : 'source';

  const existingArtifact = Object.values(ctx.graph.artifacts).find(
    a => a.nodeId === node.id && a.path === path
  );

  if (existingArtifact) {
    const updatedAt = new Date().toISOString();
    existingArtifact.content = content;
    existingArtifact.status = 'draft';
    existingArtifact.updatedAt = updatedAt;
    if (language) existingArtifact.language = language;

    ctx.patches.push({
      type: 'update_artifact',
      metadata: makePatchMeta(ctx, `Update artifact: ${path} on ${nodeLabel}`),
      payload: {
        id: existingArtifact.id,
        nodeId: node.id,
        changes: {
          content,
          language,
          status: 'draft',
          updatedAt,
        },
      },
    });
    ctx.emitter.emit('artifact_updated', { id: existingArtifact.id, nodeLabel, path, kind: existingArtifact.kind });
    evaluateContractStatus(ctx, node.id);

    return {
      success: true,
      data: { id: existingArtifact.id, path, action: 'updated' },
    };
  }

  const artifactId = crypto.randomUUID();
  const now = new Date().toISOString();
  const artifact: GraphArtifact = {
    id: artifactId,
    nodeId: node.id,
    kind: normalizedKind,
    path,
    content,
    language,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  if (description) (artifact as Record<string, unknown>).description = description;

  ctx.graph.artifacts[artifactId] = artifact;
  if (!node.artifacts) node.artifacts = [];
  node.artifacts.push(artifactId);

  ctx.patches.push({
    type: 'add_artifact',
    metadata: makePatchMeta(ctx, `Add artifact: ${path} to ${nodeLabel}`),
    payload: {
      id: artifactId,
      nodeId: node.id,
      kind: normalizedKind,
      path,
      content,
      language,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      description,
    },
  });
  ctx.emitter.emit('artifact_created', { id: artifactId, nodeLabel, path, kind: normalizedKind });
  evaluateContractStatus(ctx, node.id);

  return {
    success: true,
    data: { id: artifactId, path, kind: normalizedKind, language, action: 'created' },
  };
}

function toolUpdateArtifact(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const nodeLabel = String(args.nodeLabel || '');
  const path = String(args.path || '');
  const content = String(args.content || '');
  const description = args.description ? String(args.description) : undefined;

  if (!nodeLabel) return { success: false, error: 'nodeLabel is required' };
  if (!path) return { success: false, error: 'path is required' };
  if (!content) return { success: false, error: 'content is required' };

  const node = findNodeByLabel(ctx.graph, nodeLabel);
  if (!node) return { success: false, error: `Node "${nodeLabel}" not found` };

  const artifact = Object.values(ctx.graph.artifacts).find(
    a => a.nodeId === node.id && a.path === path
  );
  if (!artifact) return { success: false, error: `Artifact "${path}" not found on node "${nodeLabel}"` };

  const updatedAt = new Date().toISOString();
  artifact.content = content;
  artifact.status = 'draft';
  artifact.updatedAt = updatedAt;
  if (description) (artifact as Record<string, unknown>).description = description;

  const changes: Record<string, unknown> = {
    content,
    status: 'draft',
    updatedAt,
  };
  if (description) changes.description = description;

  ctx.patches.push({
    type: 'update_artifact',
    metadata: makePatchMeta(ctx, `Update artifact: ${path} on ${nodeLabel}`),
    payload: { id: artifact.id, nodeId: node.id, changes },
  });
  ctx.emitter.emit('artifact_updated', { id: artifact.id, nodeLabel, path, kind: artifact.kind });
  evaluateContractStatus(ctx, node.id);

  return {
    success: true,
    data: { id: artifact.id, path, action: 'updated' },
  };
}

async function toolSearchCatalog(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query || '').trim();
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);

  if (!query || query.length < 2) return { success: false, error: 'query must be at least 2 characters' };

  const { data, error } = await ctx.supabase.rpc('search_relevant_technologies', {
    query_text: query,
    max_results: limit,
  });

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return { success: true, data: { results: [], message: 'No matching technologies found. Try different keywords or use lookup_catalog with a category.' } };

  const results = data.map((row: { tech_id: string; rank: number }) => {
    const tech = ctx.catalogs?.technologies[row.tech_id];
    if (!tech) return { id: row.tech_id, rank: row.rank };
    return {
      id: tech.id,
      name: tech.name,
      purpose: tech.ai_context?.purpose || null,
      roleAffinities: tech.role_affinities,
      rank: row.rank,
    };
  });

  return { success: true, data: { results } };
}

function toolLookupCatalog(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  if (!ctx.catalogs) return { success: false, error: 'Catalog not loaded' };

  const category = args.category ? String(args.category) : undefined;
  const roleId = args.roleId ? String(args.roleId) : undefined;
  const technologyId = args.technologyId ? String(args.technologyId) : undefined;

  if (!category && !roleId && !technologyId) {
    const legacy = args.categoryOrRole ? String(args.categoryOrRole) : '';
    if (!legacy) return { success: false, error: 'Provide at least one of: category, roleId, or technologyId' };
    const lower = legacy.toLowerCase();
    if (ctx.catalogs.nodeRoles[lower]) {
      return { success: true, data: { catalog: lookupCatalog(ctx.catalogs, { roleId: lower }) } };
    }
    return { success: true, data: { catalog: lookupCatalog(ctx.catalogs, { category: lower }) } };
  }

  const result = lookupCatalog(ctx.catalogs, { category, roleId, technologyId });
  return { success: true, data: { catalog: result } };
}

function toolLinkSchemaArtifact(ctx: ToolContext, args: Record<string, unknown>): ToolResult {
  const contractName = String(args.contractName || '');
  const artifactId = String(args.artifactId || '');
  const nodeLabel = args.nodeLabel ? String(args.nodeLabel) : undefined;
  const artifactPath = args.artifactPath ? String(args.artifactPath) : undefined;

  if (!contractName) return { success: false, error: 'contractName is required' };

  const contract = Object.values(ctx.graph.contracts).find(
    c => c.name.toLowerCase() === contractName.toLowerCase()
  );
  if (!contract) return { success: false, error: `Contract "${contractName}" not found` };

  let resolvedArtifactId = artifactId;

  if (!resolvedArtifactId && nodeLabel && artifactPath) {
    const node = findNodeByLabel(ctx.graph, nodeLabel);
    if (!node) return { success: false, error: `Node "${nodeLabel}" not found` };
    const artifact = Object.values(ctx.graph.artifacts).find(
      a => a.nodeId === node.id && a.path === artifactPath
    );
    if (!artifact) return { success: false, error: `Artifact "${artifactPath}" not found on node "${nodeLabel}"` };
    resolvedArtifactId = artifact.id;
  }

  if (!resolvedArtifactId) {
    return { success: false, error: 'Provide either artifactId, or both nodeLabel and artifactPath to identify the schema artifact' };
  }

  const artifact = ctx.graph.artifacts[resolvedArtifactId];
  if (!artifact) return { success: false, error: `Artifact with ID "${resolvedArtifactId}" not found in graph` };

  contract.schemaRef = resolvedArtifactId;

  ctx.patches.push({
    type: 'update_contract',
    metadata: makePatchMeta(ctx, `Link schema artifact to contract: ${contractName}`),
    payload: { id: contract.id, changes: { schemaRef: resolvedArtifactId } },
  });

  return {
    success: true,
    data: {
      contractId: contract.id,
      contractName: contract.name,
      schemaRef: resolvedArtifactId,
      artifactPath: artifact.path,
      artifactKind: artifact.kind,
      action: 'linked',
    },
  };
}

export async function executeTool(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  ctx.emitter.toolCall(toolName, args);

  let result: ToolResult;

  switch (toolName) {
    case 'read_graph':
      result = toolReadGraph(ctx);
      break;
    case 'get_node':
      result = toolGetNode(ctx, args);
      break;
    case 'get_requirements':
      result = await toolGetRequirements(ctx);
      break;
    case 'get_specification':
      result = await toolGetSpecification(ctx);
      break;
    case 'save_specification':
      result = await toolSaveSpecification(ctx, args);
      break;
    case 'create_section':
      result = await toolCreateSection(ctx, args);
      break;
    case 'create_requirement':
      result = await toolCreateRequirement(ctx, args);
      break;
    case 'generate_acceptance_criteria':
      result = await toolGenerateAcceptanceCriteria(ctx, args);
      break;
    case 'set_acceptance_criteria':
      result = await toolSetAcceptanceCriteria(ctx, args);
      break;
    case 'add_node':
      result = await toolAddNode(ctx, args);
      break;
    case 'update_node':
      result = toolUpdateNode(ctx, args);
      break;
    case 'remove_node':
      result = toolRemoveNode(ctx, args);
      break;
    case 'add_edge':
      result = toolAddEdge(ctx, args);
      break;
    case 'remove_edge':
      result = toolRemoveEdge(ctx, args);
      break;
    case 'add_contract':
      result = toolAddContract(ctx, args);
      break;
    case 'add_port':
      result = toolAddPort(ctx, args);
      break;
    case 'set_parent':
      result = toolSetParent(ctx, args);
      break;
    case 'add_artifact':
      result = toolAddArtifact(ctx, args);
      break;
    case 'update_artifact':
      result = toolUpdateArtifact(ctx, args);
      break;
    case 'read_hierarchy':
      result = toolReadHierarchy(ctx);
      break;
    case 'read_artifact':
      result = toolReadArtifact(ctx, args);
      break;
    case 'link_schema_artifact':
      result = toolLinkSchemaArtifact(ctx, args);
      break;
    case 'lookup_catalog':
      result = toolLookupCatalog(ctx, args);
      break;
    case 'search_catalog':
      result = await toolSearchCatalog(ctx, args);
      break;
    case 'evaluate_criteria':
      result = await toolEvaluateCriteria(ctx, args);
      break;
    case 'verify_requirement':
      result = await toolVerifyRequirement(ctx, args);
      break;
    case 'generate_tests':
      result = await toolGenerateTests(ctx, args);
      break;
    default:
      result = { success: false, error: `Unknown tool: ${toolName}` };
  }

  ctx.emitter.toolResult(toolName, result);
  return result;
}

export type ProjectPhase = 'specification' | 'architecture';

const SPEC_CREATION_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'save_specification',
      description: 'Create or update the project specification with vision, constraints, and preferences. Must be called before creating sections or requirements.',
      parameters: {
        type: 'object',
        properties: {
          vision: { type: 'string', description: 'The project vision statement' },
          constraints: {
            type: 'array',
            items: { type: 'object', properties: { type: { type: 'string', enum: ['technology', 'architecture', 'deployment', 'performance', 'security', 'compliance', 'cost', 'other'] }, description: { type: 'string' } }, required: ['type', 'description'] },
            description: 'Project constraints',
          },
          preferences: {
            type: 'object',
            properties: {
              languages: { type: 'array', items: { type: 'string' } },
              frameworks: { type: 'array', items: { type: 'string' } },
              databases: { type: 'array', items: { type: 'string' } },
              deploymentTarget: { type: 'string' },
              architecturePattern: { type: 'string', enum: ['monolith', 'microservices', 'serverless', 'event-driven', 'layered', 'unknown'] },
              scopeArchetypes: {
                type: 'array',
                items: { type: 'string', enum: ['simple-web-app', 'cloud-native', 'desktop-app', 'mobile-app', 'iot-embedded', 'data-pipeline', 'enterprise-platform'] },
                description: 'One or more project scope archetypes that characterize this project. Most projects have one; complex projects may combine archetypes (e.g., a cloud-native mobile-app). Drives downstream feature and architecture complexity.',
              },
            },
          },
        },
        required: ['vision'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_section',
      description: 'Create a logical section to group related requirements.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Section name (e.g., "User Management", "Data Processing")' },
          description: { type: 'string', description: 'What this section covers' },
          orderIndex: { type: 'number', description: 'Display order (0-based)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_requirement',
      description: 'Create a specific, testable requirement within the specification.',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string', description: 'Unique ID like REQ-001, REQ-002' },
          name: { type: 'string', description: 'Short descriptive name' },
          description: { type: 'string', description: 'Detailed description of the requirement' },
          category: { type: 'string', enum: ['functional', 'non-functional', 'technical', 'business'] },
          sectionName: { type: 'string', description: 'Name of the section this belongs to' },
          acceptanceCriteria: {
            type: 'array',
            items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            description: '2-5 acceptance criteria',
          },
        },
        required: ['requirementId', 'name', 'description', 'category'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_acceptance_criteria',
      description: 'Generate acceptance criteria for a requirement that has none. Uses AI to produce 2-5 specific, testable acceptance criteria based on the requirement description and project context. Only works on requirements with no existing criteria.',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string', description: 'The requirement ID (e.g., "REQ-001")' },
        },
        required: ['requirementId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_acceptance_criteria',
      description: 'Set or append specific acceptance criteria on an existing requirement. Use this when the user provides explicit acceptance criteria text, or when you need to write specific criteria based on the conversation. Supports "replace" (default) to overwrite all criteria, or "append" to add to existing ones.',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string', description: 'The requirement ID (e.g., "REQ-001")' },
          criteria: {
            type: 'array',
            items: { type: 'object', properties: { text: { type: 'string', description: 'A specific, testable acceptance criterion statement' } }, required: ['text'] },
            description: 'Array of acceptance criteria to set on the requirement',
          },
          mode: { type: 'string', enum: ['replace', 'append'], description: 'Whether to replace all existing criteria or append to them. Defaults to "replace".' },
        },
        required: ['requirementId', 'criteria'],
      },
    },
  },
];

const ARCHITECTURE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_graph',
      description: 'Read the current architecture graph including all nodes, edges, and their connections.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_node',
      description: 'Get detailed information about a specific node including its connections, ports, and artifacts.',
      parameters: {
        type: 'object',
        properties: { label: { type: 'string', description: 'The label/name of the node to look up' } },
        required: ['label'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_requirements',
      description: 'Get all project requirements from the specification.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_specification',
      description: 'Get the project specification including vision, goals, constraints, and tech stack.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_node',
      description: 'Add a new architectural component to the graph. Pick the role first (what it does), then the technology (how it does it).',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Human-readable name for the node (e.g., "User Authentication API", "Product Database")' },
          role: { type: 'string', description: 'Architectural role ID -- what this component does (e.g., "frontend-app", "backend-service", "database", "cache", "rest-api", "auth-provider")' },
          technology: { type: 'string', description: 'Technology ID -- how it is implemented (e.g., "react", "nodejs", "postgresql", "redis"). Pick from the role\'s technology list.' },
          deploymentTarget: { type: 'string', description: 'Where this runs (e.g., "browser", "container", "serverless", "managed-cloud")' },
          description: { type: 'string', description: 'Brief description of the component purpose' },
          rationale: { type: 'string', description: 'Explanation of WHY this node exists and WHAT logic/responsibilities it handles. This context is shown to users and used when generating code artifacts.' },
          parentId: { type: 'string', description: 'Label of the parent container node. Sets this node as a child of that container. Only valid when the parent is a container-type node.' },
          metadata: { type: 'object', description: 'Additional metadata for the node. For databases: { tables: [{ name: "users", fields: ["id", "email", "created_at"] }] }. For caches: { keyPrefix: "app:", evictionPolicy: "lru" }. For graph DBs: { nodeLabels: ["User", "Post"], relationshipTypes: ["FOLLOWS", "LIKES"] }.' },
        },
        required: ['label', 'role'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_node',
      description: 'Update an existing node by its label. Can change label, role, technology, description, or rationale.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Current label of the node to update' },
          newLabel: { type: 'string', description: 'New label for the node' },
          role: { type: 'string', description: 'New architectural role ID (e.g., "frontend-app", "backend-service")' },
          technology: { type: 'string', description: 'New technology ID (e.g., "react", "nodejs")' },
          deploymentTarget: { type: 'string', description: 'New deployment target' },
          description: { type: 'string', description: 'New description' },
          rationale: { type: 'string', description: 'Explanation of WHY this node exists and WHAT logic/responsibilities it handles' },
          metadata: { type: 'object', description: 'Additional metadata to merge. For databases: { tables: [...] }. For caches: { keyPrefix, evictionPolicy }.' },
        },
        required: ['label'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remove_node',
      description: 'Remove a node and all its connected edges from the architecture.',
      parameters: {
        type: 'object',
        properties: { label: { type: 'string', description: 'Label of the node to remove' } },
        required: ['label'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_edge',
      description: 'Add a connection between two nodes. Automatically creates a contract if one does not exist. Prefer interactionKind over contractKind for precise semantics.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Label of the source node' },
          target: { type: 'string', description: 'Label of the target node' },
          contractName: { type: 'string', description: 'Name for the contract (e.g., "User API", "Auth Events")' },
          interactionKind: { type: 'string', description: 'Interaction pattern: request_response, event, queue, data_read, data_write, data_sync, file_transfer, auth, telemetry, ipc, dependency' },
          transport: { type: 'string', description: 'Wire protocol (auto-inferred if omitted): http, graphql, grpc, websocket, sse, amqp, mqtt, kafka, nats, sqs, eventbridge, sql, redis, ipc, tcp, udp' },
          specFormat: { type: 'string', description: 'Interface definition format (auto-inferred if omitted): openapi, graphql_schema, protobuf, asyncapi, json_schema, sql_ddl, avro, oauth_oidc, telemetry_schema, terraform_hcl, helm_chart, dockerfile, object_storage_contract, hardware_protocol_contract, custom, none' },
          contractKind: { type: 'string', description: 'Contract kind: rest, graphql, grpc, websocket, sse, kafka, amqp, sql, nosql, ipc, dependency, custom' },
          label: { type: 'string', description: 'Optional edge label' },
          schema: { type: 'object', description: 'Optional contract schema defining endpoints, request/response types, message formats, or table schemas. Attached to the auto-created or existing contract.' },
        },
        required: ['source', 'target'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remove_edge',
      description: 'Remove a connection between two nodes.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Label of the source node' },
          target: { type: 'string', description: 'Label of the target node' },
        },
        required: ['source', 'target'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_contract',
      description: 'Add a standalone contract/interface definition. Prefer interactionKind over kind for precise semantics. Optionally include a schema describing the contract structure.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Contract name' },
          interactionKind: { type: 'string', description: 'Interaction pattern: request_response, event, queue, data_read, data_write, data_sync, file_transfer, auth, telemetry, ipc, dependency' },
          transport: { type: 'string', description: 'Wire protocol (auto-inferred if omitted): http, graphql, grpc, websocket, sse, amqp, mqtt, kafka, nats, sqs, eventbridge, sql, redis, ipc, tcp, udp' },
          specFormat: { type: 'string', description: 'Interface definition format (auto-inferred if omitted): openapi, graphql_schema, protobuf, asyncapi, json_schema, sql_ddl, avro, oauth_oidc, telemetry_schema, terraform_hcl, helm_chart, dockerfile, object_storage_contract, hardware_protocol_contract, custom, none' },
          kind: { type: 'string', description: 'Contract kind: rest, graphql, grpc, websocket, sse, kafka, amqp, sql, nosql, ipc, dependency, custom' },
          schema: { type: 'object', description: 'Optional contract schema defining the structure (e.g., endpoints, request/response types, message formats, table schemas). This is stored on the contract and used during code generation.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_port',
      description: 'Add a port (input or output interface) to an existing node.',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: 'Label of the node to add the port to' },
          portName: { type: 'string', description: 'Name of the port' },
          direction: { type: 'string', enum: ['in', 'out'], description: 'Port direction: in or out' },
        },
        required: ['nodeLabel', 'portName', 'direction'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_parent',
      description: 'Move an existing node into a container, or remove it from its current container. Use this to reorganize nodes into containers without recreating them. Optionally specify the placement semantics.',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: 'Label of the node to move' },
          parentLabel: { type: 'string', description: 'Label of the target container node, or "null" to remove from current parent' },
          placementKind: { type: 'string', enum: ['contains', 'hosts', 'deployed_to', 'scopes'], description: 'Semantic relationship: "hosts" for infrastructure running code, "deployed_to" for deployment targets, "scopes" for logical boundaries, "contains" for generic grouping. Auto-inferred from parent role if omitted.' },
        },
        required: ['nodeLabel', 'parentLabel'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_artifact',
      description: 'Create a source code or configuration file artifact on a node. The content should be complete, production-quality code that respects the node\'s contracts/interfaces. If an artifact with the same path already exists on the node, it will be updated instead.',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: 'Label of the node to attach the artifact to' },
          path: { type: 'string', description: 'File path for the artifact (e.g., "src/auth/routes.ts", "Dockerfile")' },
          kind: { type: 'string', enum: ['source', 'schema', 'config', 'build', 'doc', 'design', 'task'], description: 'Artifact kind. Use "source" for application code, "schema" for data models/protos, "config" for configuration files, "build" for Dockerfiles/CI, "doc" for documentation, "task" for implementation task documents.' },
          content: { type: 'string', description: 'The full file content' },
          language: { type: 'string', description: 'Programming language (auto-detected from path if omitted)' },
          description: { type: 'string', description: 'Brief description of what this file does' },
        },
        required: ['nodeLabel', 'path', 'kind', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_artifact',
      description: 'Read the full content of an existing artifact (source file, schema, config, etc.). Use this to inspect existing code, contract schemas on connected nodes, or any artifact before generating or updating code. Returns content capped at 8000 chars with a truncation indicator.',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: 'Label of the node that owns the artifact' },
          path: { type: 'string', description: 'File path of the artifact (e.g., "src/routes.ts")' },
          artifactId: { type: 'string', description: 'UUID of the artifact. Alternative to nodeLabel+path.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_artifact',
      description: 'Update the content of an existing artifact on a node. Use this when iterating on previously generated code.',
      parameters: {
        type: 'object',
        properties: {
          nodeLabel: { type: 'string', description: 'Label of the node that owns the artifact' },
          path: { type: 'string', description: 'File path of the existing artifact to update' },
          content: { type: 'string', description: 'The new full file content' },
          description: { type: 'string', description: 'Updated description' },
        },
        required: ['nodeLabel', 'path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_hierarchy',
      description: 'Get the full containment hierarchy as an indented outline. Shows parent-child nesting, roles, technologies, lock status, and edge counts without serializing every field. Use this for a quick structural overview.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'link_schema_artifact',
      description: 'Link an existing schema artifact to a contract, establishing the contract-to-artifact linkage. The referenced artifact (kind: "schema", "source", "config", etc.) becomes the authoritative definition for that contract. During code generation, linked schema artifacts are used to generate type-safe implementations.',
      parameters: {
        type: 'object',
        properties: {
          contractName: { type: 'string', description: 'Name of the contract to link the schema to' },
          artifactId: { type: 'string', description: 'UUID of the artifact to link. Provide this OR nodeLabel+artifactPath.' },
          nodeLabel: { type: 'string', description: 'Label of the node that owns the artifact. Use with artifactPath as an alternative to artifactId.' },
          artifactPath: { type: 'string', description: 'File path of the artifact on the node. Use with nodeLabel as an alternative to artifactId.' },
        },
        required: ['contractName'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'lookup_catalog',
      description: 'Look up detailed catalog information. Query by category to list all roles and their technologies, by roleId to get a single role with full technology list and ai_context, or by technologyId to get detailed guidance including suggested_files and common_connections. Provide exactly one parameter per call. Use this when you need details beyond the catalog summary in the system prompt.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'A palette category key (e.g., "data", "api", "messaging", "infrastructure", "auth", "ai") to list all roles and technologies in that category.' },
          roleId: { type: 'string', description: 'A specific role ID (e.g., "backend-service", "database", "cache") to get full role details including description, capabilities, all technologies with ai_context summaries, and suggested contracts.' },
          technologyId: { type: 'string', description: 'A specific technology ID (e.g., "postgresql", "react", "redis") to get full ai_context guidance, suggested_files, and common_connections.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_catalog',
      description: 'Search the technology catalog by keywords when you need to discover technologies by description rather than exact ID. Returns a ranked list of matching technologies with their ID, name, role affinities, and one-line purpose. Example: search_catalog({query: "real-time messaging"}) returns relevant message brokers and event streaming technologies.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query (e.g., "real-time messaging", "graph database", "container orchestration")' },
          limit: { type: 'number', description: 'Maximum number of results to return (default 10, max 25)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_acceptance_criteria',
      description: 'Generate acceptance criteria for a requirement that has none. Uses AI to produce 2-5 specific, testable acceptance criteria based on the requirement description and project context. Only works on requirements with no existing criteria.',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string', description: 'The requirement ID (e.g., "REQ-001")' },
        },
        required: ['requirementId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_acceptance_criteria',
      description: 'Set or append specific acceptance criteria on an existing requirement. Use this when the user provides explicit acceptance criteria text, or when you need to write specific criteria based on the conversation. Supports "replace" (default) to overwrite all criteria, or "append" to add to existing ones.',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string', description: 'The requirement ID (e.g., "REQ-001")' },
          criteria: {
            type: 'array',
            items: { type: 'object', properties: { text: { type: 'string', description: 'A specific, testable acceptance criterion statement' } }, required: ['text'] },
            description: 'Array of acceptance criteria to set on the requirement',
          },
          mode: { type: 'string', enum: ['replace', 'append'], description: 'Whether to replace all existing criteria or append to them. Defaults to "replace".' },
        },
        required: ['requirementId', 'criteria'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'evaluate_criteria',
      description: 'Mark a single acceptance criterion on a requirement as met or unmet, with evidence. Use after verifying that an artifact, test, or node satisfies the criterion.',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string', description: 'The requirement ID (e.g., "REQ-001")' },
          criterionIndex: { type: 'number', description: 'Zero-based index of the acceptance criterion to evaluate (shown as AC0, AC1, ... in the requirements context)' },
          met: { type: 'boolean', description: 'Whether the criterion is satisfied' },
          evidence: { type: 'string', description: 'Brief explanation of why this criterion is met or unmet (e.g., node label, artifact path, or test case reference)' },
        },
        required: ['requirementId', 'criterionIndex', 'met'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'verify_requirement',
      description: 'Inspect the implementation evidence for a requirement. Returns all mapped nodes, their artifacts, and the current status of each acceptance criterion. Use this to understand what has been built before evaluating individual criteria.',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string', description: 'The requirement ID (e.g., "REQ-001")' },
        },
        required: ['requirementId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_tests',
      description: 'Generate a test plan document for a requirement. Creates a detailed markdown test plan with acceptance criteria assessment, recommended test types, architecture context, interface contracts, and BDD scenarios. The plan is stored as a test-plan artifact for use by external AI tools to implement actual test code. Use this when the user asks to generate tests or after defining requirements with acceptance criteria.',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string', description: 'The requirement ID (e.g., "REQ-001")' },
        },
        required: ['requirementId'],
      },
    },
  },
];

export function getToolsForPhase(phase: ProjectPhase) {
  switch (phase) {
    case 'specification':
      return SPEC_CREATION_TOOLS;
    case 'architecture':
      return ARCHITECTURE_TOOLS;
  }
}

export const TOOL_DEFINITIONS = ARCHITECTURE_TOOLS;

export async function loadGraphState(
  supabase: SupabaseClient,
  projectId: string,
  branchId: string
): Promise<GraphState> {
  const { data: snapshots } = await supabase
    .from('graph_snapshots')
    .select('graph_data')
    .eq('project_id', projectId)
    .eq('branch_id', branchId)
    .order('version', { ascending: false })
    .limit(1);

  if (snapshots && snapshots.length > 0 && snapshots[0].graph_data) {
    const raw = snapshots[0].graph_data as Record<string, unknown>;
    const check = validateGraphDataTopLevel(raw);
    if (!check.valid) {
      console.warn('[loadGraphState] graph_data failed top-level validation:', check.errors);
    }
    return {
      nodes: (raw.nodes && typeof raw.nodes === 'object' ? raw.nodes : {}) as Record<string, GraphNode>,
      edges: (raw.edges && typeof raw.edges === 'object' ? raw.edges : {}) as Record<string, GraphEdge>,
      contracts: (raw.contracts && typeof raw.contracts === 'object' ? raw.contracts : {}) as Record<string, GraphContract>,
      artifacts: (raw.artifacts && typeof raw.artifacts === 'object' ? raw.artifacts : {}) as Record<string, GraphArtifact>,
    };
  }

  return { nodes: {}, edges: {}, contracts: {}, artifacts: {} };
}

export async function loadLockedNodeIds(
  supabase: SupabaseClient,
  projectId: string,
  specificationId?: string
): Promise<Set<string>> {
  let specId = specificationId;
  if (!specId) {
    const { data: spec } = await supabase
      .from('project_specifications')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    specId = spec?.id;
  }

  if (!specId) return new Set();

  const { data: spec } = await supabase
    .from('project_specifications')
    .select('locked_nodes')
    .eq('id', specId)
    .maybeSingle();

  if (spec?.locked_nodes && Array.isArray(spec.locked_nodes)) {
    return new Set(spec.locked_nodes as string[]);
  }

  return new Set();
}

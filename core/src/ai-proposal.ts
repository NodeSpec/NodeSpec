import { z } from 'zod';
import { PatchOperationSchema } from './schemas.js';
import type { Graph, PatchOperation, Branch, Contract, Artifact } from './types.js';
import { createBranch, addPatchToBranch } from './branch.js';
import { applyPatch, applyPatches, validatePatch, sortPatchesByDependencyOrder } from './patch-engine.js';
import { generateUUID, now } from './utils.js';

export const AIOutputSchema = z.object({
  patches: z.array(PatchOperationSchema),
  explanations: z.array(z.string()),
  validation_expectations: z.array(z.string()),
});

export type AIOutput = z.infer<typeof AIOutputSchema>;

export type ProposalStatus = 'pending' | 'reviewing' | 'merged' | 'rejected' | 'partial';

export type PatchStatus = 'pending' | 'approved' | 'rejected' | 'conflicted' | 'merged';

export interface ProposalPatch {
  patch: PatchOperation;
  explanation: string;
  status: PatchStatus;
  conflictReason?: string;
  previewBefore?: unknown;
  previewAfter?: unknown;
}

export interface AIProposal {
  id: string;
  aiRunId: string;
  sourceBranchId: string;
  proposalBranchId: string;
  status: ProposalStatus;
  patches: ProposalPatch[];
  validationExpectations: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  reviewedAt?: string;
  mergedAt?: string;
}

export interface AIInputContext {
  graphSummary: GraphSummary;
  selectedContext?: SelectedContext;
  relevantContracts: Contract[];
  relevantArtifacts: Artifact[];
  hardRules: string[];
}

export interface GraphSummary {
  nodeCount: number;
  edgeCount: number;
  contractCount: number;
  nodeTypes: Record<string, number>;
  contractKinds: Record<string, number>;
  nodes: NodeSummary[];
  edges: EdgeSummary[];
}

export interface NodeSummary {
  id: string;
  type: string;
  label: string;
  connectionCount: number;
}

export interface EdgeSummary {
  id: string;
  sourceLabel: string;
  targetLabel: string;
  contractName: string;
}

export interface SelectedContext {
  nodeIds: string[];
  edgeIds: string[];
  contractIds: string[];
}

export interface ConflictInfo {
  patchId: string;
  patchIndex: number;
  reason: string;
  preconditionsFailed: string[];
}

// P0-10: a schema-invalid patch used to surface as a bare "Patch does not match schema" in
// the review UI. Pull the zod field errors out of the validation details so the skip reason
// names the offending fields.
export function formatValidationConflictReason(
  errors: Array<{ message: string; details?: unknown }>
): string {
  const first = errors[0];
  if (!first) return 'Validation failed during merge';

  const zodErrors = (first.details as { zodErrors?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } } | undefined)?.zodErrors;
  const fieldParts: string[] = [];
  if (zodErrors?.fieldErrors) {
    for (const [path, messages] of Object.entries(zodErrors.fieldErrors).slice(0, 5)) {
      if (messages && messages.length > 0) fieldParts.push(`${path}: ${messages[0]}`);
    }
  }
  if (fieldParts.length === 0 && zodErrors?.formErrors?.length) {
    fieldParts.push(zodErrors.formErrors[0]);
  }

  return fieldParts.length > 0 ? `${first.message} (${fieldParts.join('; ')})` : first.message;
}

export interface MergeResult {
  success: boolean;
  mergedPatches: string[];
  skippedPatches: string[];
  conflicts: ConflictInfo[];
  finalGraph?: Graph;
}

export function buildGraphSummary(graph: Graph): GraphSummary {
  const nodes = Object.values(graph.nodes);
  const edges = Object.values(graph.edges);
  const contracts = Object.values(graph.contracts);

  const nodeTypes: Record<string, number> = {};
  const contractKinds: Record<string, number> = {};

  for (const node of nodes) {
    nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
  }

  for (const contract of contracts) {
    contractKinds[contract.kind] = (contractKinds[contract.kind] || 0) + 1;
  }

  const nodeConnectionCounts = new Map<string, number>();
  for (const edge of edges) {
    nodeConnectionCounts.set(edge.source, (nodeConnectionCounts.get(edge.source) || 0) + 1);
    nodeConnectionCounts.set(edge.target, (nodeConnectionCounts.get(edge.target) || 0) + 1);
  }

  const nodeSummaries: NodeSummary[] = nodes.map((node) => ({
    id: node.id,
    type: node.type,
    label: node.label,
    connectionCount: nodeConnectionCounts.get(node.id) || 0,
  }));

  const edgeSummaries: EdgeSummary[] = edges.map((edge) => ({
    id: edge.id,
    sourceLabel: graph.nodes[edge.source]?.label || 'Unknown',
    targetLabel: graph.nodes[edge.target]?.label || 'Unknown',
    contractName: graph.contracts[edge.contractId]?.name || 'Unknown',
  }));

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    contractCount: contracts.length,
    nodeTypes,
    contractKinds,
    nodes: nodeSummaries,
    edges: edgeSummaries,
  };
}

export function buildAIInputContext(
  graph: Graph,
  selectedContext?: SelectedContext,
  hardRules: string[] = []
): AIInputContext {
  const graphSummary = buildGraphSummary(graph);

  const relevantContracts: Contract[] = [];
  const relevantArtifacts: Artifact[] = [];

  if (selectedContext) {
    for (const contractId of selectedContext.contractIds) {
      const contract = graph.contracts[contractId];
      if (contract) relevantContracts.push(contract);
    }

    for (const nodeId of selectedContext.nodeIds) {
      const node = graph.nodes[nodeId];
      if (node?.artifacts) {
        for (const artifactId of node.artifacts) {
          const artifact = graph.artifacts[artifactId];
          if (artifact && !relevantArtifacts.some((a) => a.id === artifactId)) {
            relevantArtifacts.push(artifact);
          }
        }
      }
    }

    for (const edgeId of selectedContext.edgeIds) {
      const edge = graph.edges[edgeId];
      if (edge) {
        const contract = graph.contracts[edge.contractId];
        if (contract && !relevantContracts.some((c) => c.id === contract.id)) {
          relevantContracts.push(contract);
        }
      }
    }
  } else {
    relevantContracts.push(...Object.values(graph.contracts));
    relevantArtifacts.push(...Object.values(graph.artifacts));
  }

  return {
    graphSummary,
    selectedContext,
    relevantContracts,
    relevantArtifacts,
    hardRules,
  };
}

export function validateAIOutput(output: unknown): { valid: boolean; data?: AIOutput; error?: string } {
  const result = AIOutputSchema.safeParse(output);
  if (!result.success) {
    return {
      valid: false,
      error: `Invalid AI output: ${result.error.message}`,
    };
  }
  return { valid: true, data: result.data };
}

export function createProposalBranch(
  sourceBranch: Branch,
  aiRunId: string
): Branch {
  const proposalName = `ai-proposal/${aiRunId.slice(0, 8)}`;
  return createBranch(proposalName, sourceBranch.baseSnapshotId, [...sourceBranch.patches]);
}

export function createProposal(
  aiRunId: string,
  sourceBranchId: string,
  proposalBranch: Branch,
  aiOutput: AIOutput
): AIProposal {
  const patches: ProposalPatch[] = aiOutput.patches.map((patch, index) => ({
    patch,
    explanation: aiOutput.explanations[index] || 'No explanation provided',
    status: 'pending' as PatchStatus,
  }));

  return {
    id: generateUUID(),
    aiRunId,
    sourceBranchId,
    proposalBranchId: proposalBranch.id,
    status: 'pending',
    patches,
    validationExpectations: aiOutput.validation_expectations,
    createdAt: now(),
  };
}

export function detectConflicts(
  graph: Graph,
  patches: PatchOperation[]
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  let currentGraph = graph;

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const validation = validatePatch(currentGraph, patch);

    if (!validation.valid) {
      const preconditionErrors = validation.errors
        .filter((e) => e.code === 'PRECONDITION_FAILED')
        .map((e) => e.message);

      conflicts.push({
        patchId: patch.metadata.id,
        patchIndex: i,
        reason: validation.errors[0]?.message || 'Unknown validation error',
        preconditionsFailed: preconditionErrors,
      });
    } else {
      const result = applyPatch(currentGraph, patch);
      if (result.success && result.graph) {
        currentGraph = result.graph;
      }
    }
  }

  return conflicts;
}

export function computePatchPreview(
  graph: Graph,
  patch: PatchOperation
): { before: unknown; after: unknown } | null {
  const validation = validatePatch(graph, patch);
  if (!validation.valid) {
    return null;
  }

  let before: unknown = null;
  let after: unknown = null;

  switch (patch.type) {
    case 'add_node':
      before = null;
      after = patch.payload;
      break;
    case 'update_node':
      before = graph.nodes[patch.payload.id];
      after = { ...graph.nodes[patch.payload.id], ...patch.payload.changes };
      break;
    case 'remove_node':
      before = graph.nodes[patch.payload.id];
      after = null;
      break;
    case 'add_edge':
      before = null;
      after = patch.payload;
      break;
    case 'update_edge':
      before = graph.edges[patch.payload.id];
      after = { ...graph.edges[patch.payload.id], ...patch.payload.changes };
      break;
    case 'remove_edge':
      before = graph.edges[patch.payload.id];
      after = null;
      break;
    case 'add_contract':
      before = null;
      after = patch.payload;
      break;
    case 'update_contract':
      before = graph.contracts[patch.payload.id];
      after = { ...graph.contracts[patch.payload.id], ...patch.payload.changes };
      break;
    case 'remove_contract':
      before = graph.contracts[patch.payload.id];
      after = null;
      break;
    case 'add_artifact':
      before = null;
      after = patch.payload;
      break;
    case 'update_artifact':
      before = graph.artifacts[patch.payload.id];
      after = { ...graph.artifacts[patch.payload.id], ...patch.payload.changes };
      break;
    case 'remove_artifact':
      before = graph.artifacts[patch.payload.id];
      after = null;
      break;
    case 'update_graph_metadata':
      before = graph.metadata;
      after = { ...graph.metadata, ...patch.payload.changes };
      break;
  }

  return { before, after };
}

export function enrichProposalWithPreviews(
  proposal: AIProposal,
  graph: Graph
): AIProposal {
  let currentGraph = graph;

  const sortedOps = sortPatchesByDependencyOrder(proposal.patches.map(p => p.patch));
  const patchById = new Map(proposal.patches.map(p => [p.patch.metadata.id, p]));
  const sortedProposalPatches = sortedOps.map(op => patchById.get(op.metadata.id)!).filter(Boolean);

  const enrichedPatches: ProposalPatch[] = [];

  for (const proposalPatch of sortedProposalPatches) {
    const preview = computePatchPreview(currentGraph, proposalPatch.patch);

    if (preview) {
      enrichedPatches.push({
        ...proposalPatch,
        previewBefore: preview.before,
        previewAfter: preview.after,
      });

      const result = applyPatch(currentGraph, proposalPatch.patch);
      if (result.success && result.graph) {
        currentGraph = result.graph;
      }
    } else {
      const conflicts = detectConflicts(currentGraph, [proposalPatch.patch]);
      enrichedPatches.push({
        ...proposalPatch,
        status: 'conflicted',
        conflictReason: conflicts[0]?.reason || 'Validation failed',
      });
    }
  }

  return {
    ...proposal,
    patches: enrichedPatches,
    status: enrichedPatches.some((p) => p.status === 'conflicted') ? 'reviewing' : 'pending',
  };
}

export function cherryPickProposalPatches(
  proposal: AIProposal,
  patchIds: string[]
): AIProposal {
  const patchIdSet = new Set(patchIds);

  const updatedPatches = proposal.patches.map((p) => ({
    ...p,
    status: patchIdSet.has(p.patch.metadata.id)
      ? ('approved' as PatchStatus)
      : p.status === 'approved'
        ? ('pending' as PatchStatus)
        : p.status,
  }));

  return {
    ...proposal,
    patches: updatedPatches,
  };
}

export function approveAllPatches(proposal: AIProposal): AIProposal {
  const updatedPatches = proposal.patches.map((p) => ({
    ...p,
    status: p.status === 'conflicted' ? p.status : ('approved' as PatchStatus),
  }));

  return {
    ...proposal,
    patches: updatedPatches,
  };
}

export function rejectProposal(proposal: AIProposal): AIProposal {
  return {
    ...proposal,
    status: 'rejected',
    reviewedAt: now(),
  };
}

export function mergeApprovedPatches(
  proposal: AIProposal,
  targetBranch: Branch,
  graph: Graph
): MergeResult {
  const approvedPatches = proposal.patches.filter((p) => p.status === 'approved');
  const patchOps = approvedPatches.map(p => p.patch);

  const batchResult = applyPatches(graph, patchOps);
  if (batchResult.success && batchResult.graph) {
    return {
      success: true,
      mergedPatches: patchOps.map(p => p.metadata.id),
      skippedPatches: [],
      conflicts: [],
      finalGraph: batchResult.graph,
    };
  }

  const sortedOps = sortPatchesByDependencyOrder(patchOps);
  const patchById = new Map(approvedPatches.map(p => [p.patch.metadata.id, p]));
  const sortedApproved = sortedOps.map(op => patchById.get(op.metadata.id)!).filter(Boolean);

  const mergedPatches: string[] = [];
  const skippedPatches: string[] = [];
  const conflicts: ConflictInfo[] = [];

  let currentGraph = graph;
  let currentBranch = targetBranch;

  for (let i = 0; i < sortedApproved.length; i++) {
    const proposalPatch = sortedApproved[i];
    const patch = proposalPatch.patch;

    const validation = validatePatch(currentGraph, patch);

    if (!validation.valid) {
      const preconditionErrors = validation.errors
        .filter((e) => e.code === 'PRECONDITION_FAILED')
        .map((e) => e.message);

      conflicts.push({
        patchId: patch.metadata.id,
        patchIndex: i,
        reason: formatValidationConflictReason(validation.errors),
        preconditionsFailed: preconditionErrors,
      });
      skippedPatches.push(patch.metadata.id);
      continue;
    }

    const result = applyPatch(currentGraph, patch);

    if (result.success && result.graph) {
      currentGraph = result.graph;
      currentBranch = addPatchToBranch(currentBranch, patch);
      mergedPatches.push(patch.metadata.id);
    } else {
      conflicts.push({
        patchId: patch.metadata.id,
        patchIndex: i,
        reason: result.error?.message || 'Failed to apply patch',
        preconditionsFailed: [],
      });
      skippedPatches.push(patch.metadata.id);
    }
  }

  return {
    success: conflicts.length === 0,
    mergedPatches,
    skippedPatches,
    conflicts,
    finalGraph: currentGraph,
  };
}

export function formatAIInputForPrompt(context: AIInputContext): string {
  const lines: string[] = [];

  lines.push('## Graph Summary');
  lines.push(`- Nodes: ${context.graphSummary.nodeCount}`);
  lines.push(`- Edges: ${context.graphSummary.edgeCount}`);
  lines.push(`- Contracts: ${context.graphSummary.contractCount}`);

  if (Object.keys(context.graphSummary.nodeTypes).length > 0) {
    lines.push('\n### Node Types');
    for (const [type, count] of Object.entries(context.graphSummary.nodeTypes)) {
      lines.push(`- ${type}: ${count}`);
    }
  }

  if (context.graphSummary.nodes.length > 0) {
    lines.push('\n### Nodes');
    for (const node of context.graphSummary.nodes) {
      lines.push(`- [${node.type}] ${node.label} (${node.connectionCount} connections)`);
    }
  }

  if (context.graphSummary.edges.length > 0) {
    lines.push('\n### Connections');
    for (const edge of context.graphSummary.edges) {
      lines.push(`- ${edge.sourceLabel} -> ${edge.targetLabel} (${edge.contractName})`);
    }
  }

  if (context.selectedContext) {
    lines.push('\n## Selected Context');
    if (context.selectedContext.nodeIds.length > 0) {
      lines.push(`- Selected Nodes: ${context.selectedContext.nodeIds.join(', ')}`);
    }
    if (context.selectedContext.edgeIds.length > 0) {
      lines.push(`- Selected Edges: ${context.selectedContext.edgeIds.join(', ')}`);
    }
  }

  if (context.relevantContracts.length > 0) {
    lines.push('\n## Relevant Contracts');
    for (const contract of context.relevantContracts) {
      lines.push(`- ${contract.name} (${contract.kind})`);
      if (contract.schema && Object.keys(contract.schema).length > 0) {
        lines.push(`  Schema: ${JSON.stringify(contract.schema)}`);
      }
    }
  }

  if (context.hardRules.length > 0) {
    lines.push('\n## HARD RULES (MUST FOLLOW)');
    for (const rule of context.hardRules) {
      lines.push(`- ${rule}`);
    }
  }

  return lines.join('\n');
}

export const DEFAULT_HARD_RULES = [
  'All patches MUST include valid UUIDs for entity IDs',
  'Edges MUST reference existing nodes (source and target)',
  'Edges MUST reference existing contracts',
  'Nodes cannot be removed if they have connected edges',
  'Contracts cannot be removed if they are referenced by edges',
  'All patches MUST have actor_type set to "ai"',
  'Provide clear explanations for each patch',
];

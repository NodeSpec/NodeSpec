// import type only — a VALUE import of jsr makes this module untestable offline
// (403 at resolve time; same landmine fixed in mcp-context-assembly).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { loadGraphData } from "./mcp-context-assembly.ts";
import type { CatalogData } from "./catalog-loader.ts";
import { formatGraphAsMermaidWithMeta } from "./mermaid-formatter.ts";
// P0-7: envelope for user-authored content. This module's exclusive consumer is the
// mcp-server; do NOT move these imports into shared helpers used by the agent loop.
import { UNTRUSTED_ADVISORY, wrapField, wrapFieldNullable, wrapUntrusted } from "./untrusted-data.ts";

export interface ArchitectureOverview {
  summary: {
    totalNodes: number;
    totalEdges: number;
    totalContracts: number;
    roleDistribution: Record<string, number>;
  };
  nodes: OverviewNode[];
  edges: OverviewEdge[];
  containers: OverviewContainer[];
  completeness: OverviewCompleteness[];
  mermaid: string;
  mermaidMeta: {
    direction: "LR" | "TD";
    compact: boolean;
    nodeCount: number;
  };
  /** P0-7: one-line advisory explaining the <untrusted-data> envelope on user content. */
  untrustedDataAdvisory: string;
}

export interface OverviewNode {
  id: string;
  label: string;
  role: string;
  technology: string | null;
  parentId: string | null;
  status: string;
  artifactCount: number;
  hasSourceArtifact: boolean;
  artifactKinds: string[];
}

export interface OverviewEdge {
  id: string;
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  contractKind: string | null;
  contractName: string | null;
}

export interface OverviewContainer {
  id: string;
  label: string;
  childLabels: string[];
}

export interface OverviewCompleteness {
  nodeId: string;
  label: string;
  role: string;
  status: string;
  hasArtifacts: boolean;
  artifactKinds: string[];
}

export async function assembleArchitectureOverview(
  supabase: SupabaseClient,
  _projectId: string,
  branchId: string,
  catalogs?: CatalogData
): Promise<ArchitectureOverview | null> {
  const graphData = await loadGraphData(supabase, branchId);
  if (!graphData) return null;

  const nodeEntries = Object.values(graphData.nodes);
  const edgeEntries = Object.values(graphData.edges);
  const contractEntries = Object.values(graphData.contracts);
  const artifactEntries = Object.values(graphData.artifacts);

  const roleDistribution: Record<string, number> = {};
  for (const node of nodeEntries) {
    roleDistribution[node.type] = (roleDistribution[node.type] || 0) + 1;
  }

  const containerIds = new Set<string>();
  for (const node of nodeEntries) {
    if (node.parentId && graphData.nodes[node.parentId]) {
      containerIds.add(node.parentId);
    }
  }

  const nodes: OverviewNode[] = nodeEntries.map((node) => {
    const nodeArtifacts = artifactEntries.filter((a) => a.nodeId === node.id);
    const artifactKinds = [...new Set(nodeArtifacts.map((a) => a.kind))];
    const hasSourceArtifact = nodeArtifacts.some((a) => a.kind === "source");
    return {
      id: node.id,
      label: wrapField(node.label),
      role: node.type,
      technology: node.technology || null,
      parentId: node.parentId || null,
      status: (node as Record<string, unknown>).status as string || "draft",
      artifactCount: nodeArtifacts.length,
      hasSourceArtifact,
      artifactKinds,
    };
  });

  const edges: OverviewEdge[] = edgeEntries.map((edge) => {
    const sourceNode = graphData.nodes[edge.source];
    const targetNode = graphData.nodes[edge.target];
    const contract = edge.contractId
      ? graphData.contracts[edge.contractId]
      : undefined;
    return {
      id: edge.id,
      sourceId: edge.source,
      sourceLabel: wrapField(sourceNode?.label || "Unknown"),
      targetId: edge.target,
      targetLabel: wrapField(targetNode?.label || "Unknown"),
      contractKind: contract?.kind || null,
      contractName: wrapFieldNullable(contract?.name || null),
    };
  });

  const containers: OverviewContainer[] = [...containerIds].map((cId) => {
    const containerNode = graphData.nodes[cId];
    const childLabels = nodeEntries
      .filter((n) => n.parentId === cId)
      .map((n) => n.label);
    return {
      id: cId,
      label: wrapField(containerNode.label),
      childLabels: childLabels.map(wrapField),
    };
  });

  const completeness: OverviewCompleteness[] = nodeEntries
    .filter((n) => !containerIds.has(n.id))
    .map((node) => {
      const nodeArtifacts = artifactEntries.filter((a) => a.nodeId === node.id);
      const hasArtifacts = nodeArtifacts.length > 0;
      const artifactKinds = [...new Set(nodeArtifacts.map((a) => a.kind))];
      return {
        nodeId: node.id,
        label: wrapField(node.label),
        role: node.type,
        status: (node as Record<string, unknown>).status as string || "draft",
        hasArtifacts,
        artifactKinds,
      };
    });

  let mermaid: string;
  let mermaidMeta: { direction: "LR" | "TD"; compact: boolean; nodeCount: number };
  try {
    const result = formatGraphAsMermaidWithMeta(graphData, { direction: "LR", maxDepth: 3 });
    mermaid = result.diagram;
    mermaidMeta = { direction: result.direction, compact: result.compact, nodeCount: result.nodeCount };
  } catch {
    mermaid = 'graph LR\n  error["Mermaid generation failed"]';
    mermaidMeta = { direction: "LR", compact: false, nodeCount: nodeEntries.length };
  }

  return {
    summary: {
      totalNodes: nodeEntries.length,
      totalEdges: edgeEntries.length,
      totalContracts: contractEntries.length,
      roleDistribution,
    },
    nodes,
    edges,
    containers,
    completeness,
    // P0-7: the diagram embeds user-authored labels — enveloped as one prose payload.
    mermaid: wrapUntrusted(mermaid),
    mermaidMeta,
    untrustedDataAdvisory: UNTRUSTED_ADVISORY,
  };
}

import type { Graph, Node, Edge, Contract, Artifact, Port } from './types';

export interface GraphNodeContext {
  node: Node;
  ports: Port[];
  artifacts: Artifact[];
  incomingEdges: Edge[];
  outgoingEdges: Edge[];
  dependencies: Array<{
    node: Node;
    contract: Contract;
    port?: Port;
  }>;
  dependents: Array<{
    node: Node;
    contract: Contract;
    port?: Port;
  }>;
}

export interface GraphContext {
  graph: Graph;
  totalNodes: number;
  totalEdges: number;
  totalArtifacts: number;
  nodesByType: Record<string, Node[]>;
  contractsByKind: Record<string, Contract[]>;
  architecturePatterns: string[];
  technologiesUsed: string[];
}

export interface ArchitectureAnalysis {
  layerStructure: {
    frontend: Node[];
    backend: Node[];
    data: Node[];
    external: Node[];
  };
  dataFlow: Array<{
    from: string;
    to: string;
    contractKind: string;
    interactionKind?: string;
    transport?: string;
    hasSchema: boolean;
  }>;
  completeness: {
    nodesWithArtifacts: number;
    nodesWithoutArtifacts: number;
    edgesWithSchemas: number;
    edgesWithoutSchemas: number;
  };
  recommendations: string[];
}

export function buildGraphNodeContext(nodeId: string, graph: Graph): GraphNodeContext {
  const node = graph.nodes[nodeId];
  if (!node) {
    throw new Error(`Node ${nodeId} not found`);
  }

  const ports = node.ports || [];
  const artifacts = (node.artifacts || [])
    .map((aid) => graph.artifacts[aid])
    .filter((a) => !!a);

  const allEdges = Object.values(graph.edges);
  const incomingEdges = allEdges.filter((e) => e.target === nodeId);
  const outgoingEdges = allEdges.filter((e) => e.source === nodeId);

  const dependencies = incomingEdges
    .map((edge) => {
      const sourceNode = graph.nodes[edge.source];
      const contract = graph.contracts[edge.contractId];
      const port = ports.find((p) => p.id === edge.targetPortId);
      return sourceNode && contract
        ? { node: sourceNode, contract, port }
        : null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const dependents = outgoingEdges
    .map((edge) => {
      const targetNode = graph.nodes[edge.target];
      const contract = graph.contracts[edge.contractId];
      const port = ports.find((p) => p.id === edge.sourcePortId);
      return targetNode && contract
        ? { node: targetNode, contract, port }
        : null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  return {
    node,
    ports,
    artifacts,
    incomingEdges,
    outgoingEdges,
    dependencies,
    dependents,
  };
}

export function buildGraphContext(graph: Graph): GraphContext {
  const nodes = Object.values(graph.nodes);
  const edges = Object.values(graph.edges);
  const artifacts = Object.values(graph.artifacts);
  const contracts = Object.values(graph.contracts);

  const nodesByType: Record<string, Node[]> = {};
  for (const node of nodes) {
    if (!nodesByType[node.type]) {
      nodesByType[node.type] = [];
    }
    nodesByType[node.type].push(node);
  }

  const contractsByKind: Record<string, Contract[]> = {};
  for (const contract of contracts) {
    if (!contractsByKind[contract.kind]) {
      contractsByKind[contract.kind] = [];
    }
    contractsByKind[contract.kind].push(contract);
  }

  const architecturePatterns: string[] = [];
  // TODO(cleanup): These reference pre-Phase-1 dotted type names (e.g. 'frontend.app').
  // All graphs migrated to V3+ use role IDs (e.g. 'frontend-app'). Remove once legacy graphs are fully migrated.
  if (nodesByType['frontend.app']) architecturePatterns.push('Frontend Application');
  if (nodesByType['web.rest-api'] || nodesByType['web.graphql-api'])
    architecturePatterns.push('API Gateway');
  if (Object.keys(nodesByType).some((t) => t.startsWith('database.')))
    architecturePatterns.push('Data Layer');
  if (nodesByType['external.service'])
    architecturePatterns.push('External Integrations');

  const technologiesUsed: Set<string> = new Set();
  for (const node of nodes) {
    if (node.metadata?.framework) technologiesUsed.add(node.metadata.framework as string);
    if (node.metadata?.dbType) technologiesUsed.add(node.metadata.dbType as string);
    if (node.metadata?.provider) technologiesUsed.add(node.metadata.provider as string);
  }

  return {
    graph,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    totalArtifacts: artifacts.length,
    nodesByType,
    contractsByKind,
    architecturePatterns,
    technologiesUsed: Array.from(technologiesUsed),
  };
}

export function analyzeArchitecture(graph: Graph): ArchitectureAnalysis {
  const nodes = Object.values(graph.nodes);
  const edges = Object.values(graph.edges);
  const contracts = graph.contracts;

  // TODO(cleanup): These reference pre-Phase-1 dotted type names. Graphs V3+ use role IDs (e.g. 'frontend-app').
  const layerStructure = {
    frontend: nodes.filter((n) => n.type.startsWith('frontend.')),
    backend: nodes.filter((n) => n.type.startsWith('web.')),
    data: nodes.filter((n) => n.type.startsWith('database.')),
    external: nodes.filter((n) => n.type.startsWith('external.')),
  };

  const dataFlow = edges.map((edge) => {
    const contract = contracts[edge.contractId];
    return {
      from: edge.source,
      to: edge.target,
      contractKind: contract?.kind || 'unknown',
      interactionKind: contract?.interactionKind,
      transport: contract?.transport,
      hasSchema: !!(contract?.schema || contract?.schemaRef),
    };
  });

  const nodesWithArtifacts = nodes.filter(
    (n) => n.artifacts && n.artifacts.length > 0
  ).length;
  const nodesWithoutArtifacts = nodes.length - nodesWithArtifacts;

  const edgesWithSchemas = edges.filter((e) => {
    const contract = contracts[e.contractId];
    return contract && (contract.schema || contract.schemaRef);
  }).length;
  const edgesWithoutSchemas = edges.length - edgesWithSchemas;

  const recommendations: string[] = [];

  if (nodesWithoutArtifacts > 0) {
    recommendations.push(
      `${nodesWithoutArtifacts} node(s) have no artifacts. Consider adding implementation files.`
    );
  }

  if (edgesWithoutSchemas > 0) {
    recommendations.push(
      `${edgesWithoutSchemas} connection(s) lack schema definitions. Add schemas for better documentation.`
    );
  }

  const frontendNodes = layerStructure.frontend;
  const backendNodes = layerStructure.backend;
  if (frontendNodes.length > 0 && backendNodes.length === 0) {
    recommendations.push(
      'Frontend detected without backend services. Consider adding API layer.'
    );
  }

  const dataNodes = layerStructure.data;
  if (backendNodes.length > 0 && dataNodes.length === 0) {
    recommendations.push(
      'Backend services detected without data layer. Consider adding database.'
    );
  }

  return {
    layerStructure,
    dataFlow,
    completeness: {
      nodesWithArtifacts,
      nodesWithoutArtifacts,
      edgesWithSchemas,
      edgesWithoutSchemas,
    },
    recommendations,
  };
}

export function buildAIPromptContext(nodeId: string | null, graph: Graph): string {
  const graphContext = buildGraphContext(graph);
  const analysis = analyzeArchitecture(graph);

  let context = `# Architecture Context\n\n`;
  context += `## Overview\n`;
  context += `- Total Nodes: ${graphContext.totalNodes}\n`;
  context += `- Total Connections: ${graphContext.totalEdges}\n`;
  context += `- Total Artifacts: ${graphContext.totalArtifacts}\n`;
  context += `- Architecture Patterns: ${graphContext.architecturePatterns.join(', ')}\n`;
  context += `- Technologies: ${graphContext.technologiesUsed.join(', ')}\n\n`;

  context += `## Layer Structure\n`;
  context += `- Frontend: ${analysis.layerStructure.frontend.length} node(s)\n`;
  context += `- Backend: ${analysis.layerStructure.backend.length} node(s)\n`;
  context += `- Data: ${analysis.layerStructure.data.length} node(s)\n`;
  context += `- External: ${analysis.layerStructure.external.length} node(s)\n\n`;

  if (nodeId) {
    const nodeContext = buildGraphNodeContext(nodeId, graph);
    context += `## Focused Node: ${nodeContext.node.label}\n`;
    context += `Type: ${nodeContext.node.type}\n`;
    context += `Status: ${nodeContext.node.status || 'draft'}\n`;
    context += `Connection Points: ${nodeContext.ports.length}\n`;
    context += `Artifacts: ${nodeContext.artifacts.length}\n`;
    context += `Dependencies: ${nodeContext.dependencies.length}\n`;
    context += `Dependents: ${nodeContext.dependents.length}\n\n`;

    if (nodeContext.dependencies.length > 0) {
      context += `### Depends On:\n`;
      for (const dep of nodeContext.dependencies) {
        const transport = dep.contract.transport ? ` via ${dep.contract.transport}` : '';
        context += `- ${dep.node.label} (${dep.contract.interactionKind || dep.contract.kind}${transport})\n`;
      }
      context += `\n`;
    }

    if (nodeContext.dependents.length > 0) {
      context += `### Used By:\n`;
      for (const dep of nodeContext.dependents) {
        const transport = dep.contract.transport ? ` via ${dep.contract.transport}` : '';
        context += `- ${dep.node.label} (${dep.contract.interactionKind || dep.contract.kind}${transport})\n`;
      }
      context += `\n`;
    }

    if (nodeContext.artifacts.length > 0) {
      context += `### Artifacts:\n`;
      for (const artifact of nodeContext.artifacts) {
        context += `- ${artifact.path} (${artifact.kind})\n`;
      }
      context += `\n`;
    }
  }

  if (analysis.recommendations.length > 0) {
    context += `## Recommendations\n`;
    for (const rec of analysis.recommendations) {
      context += `- ${rec}\n`;
    }
  }

  return context;
}

import type { Graph, Node } from './types.js';
import { getContainerTypeById } from './container-types.js';

interface ConnectionSummary {
  direction: 'IN' | 'OUT';
  nodeLabel: string;
  nodeRole: string;
  nodeTechnology: string | null;
  contractKind: string;
  interactionKind: string | null;
  transport: string | null;
  contractName: string;
}

function resolveConnections(graph: Graph, nodeId: string): ConnectionSummary[] {
  const connections: ConnectionSummary[] = [];

  for (const edge of Object.values(graph.edges)) {
    if (edge.source !== nodeId && edge.target !== nodeId) continue;
    const contract = graph.contracts[edge.contractId];
    const isOutgoing = edge.source === nodeId;
    const otherNodeId = isOutgoing ? edge.target : edge.source;
    const otherNode = graph.nodes[otherNodeId];

    connections.push({
      direction: isOutgoing ? 'OUT' : 'IN',
      nodeLabel: otherNode?.label || otherNodeId,
      nodeRole: otherNode?.type || 'unknown',
      nodeTechnology: otherNode?.technology || null,
      contractKind: contract?.kind || 'custom',
      interactionKind: contract?.interactionKind || null,
      transport: contract?.transport || null,
      contractName: contract?.name || 'unnamed',
    });
  }

  return connections;
}

function getChildNodes(graph: Graph, parentId: string): Node[] {
  return Object.values(graph.nodes).filter(n => n.parentId === parentId);
}

function isInfrastructureContainer(nodeType: string): boolean {
  const containerDef = getContainerTypeById(nodeType);
  if (containerDef) {
    return containerDef.layer === 'infrastructure' ||
           containerDef.layer === 'orchestration' ||
           containerDef.layer === 'runtime';
  }
  return false;
}

function formatConnectionLine(conn: ConnectionSummary): string {
  const techSuffix = conn.nodeTechnology ? ` (${conn.nodeTechnology})` : '';
  const protocol = conn.transport ? `/${conn.transport}` : '';
  const interaction = conn.interactionKind || conn.contractKind;
  return `- ${conn.direction}: [${conn.nodeLabel}] role=${conn.nodeRole}${techSuffix} via ${interaction}${protocol} "${conn.contractName}"`;
}

function extractRationale(node: Node): string | undefined {
  return (node.metadata as Record<string, unknown>)?.rationale as string | undefined;
}

function buildFunctionalPrompt(node: Node, connections: ConnectionSummary[], existingArtifactPaths: string[]): string {
  const tech = node.technology || node.type.split('.').pop()?.replace(/-/g, ' ') || 'unknown';
  const role = node.type.split('.').pop()?.replace(/-/g, ' ') || 'component';
  const isIteration = existingArtifactPaths.length > 0;

  const lines: string[] = [];

  if (isIteration) {
    lines.push(`Refine the source code artifacts for "${node.label}" (${tech} ${role}).`);
    lines.push(`Existing files: ${existingArtifactPaths.join(', ')}`);
  } else {
    lines.push(`Generate initial source code artifacts for "${node.label}" (${tech} ${role}).`);
  }

  const rationale = extractRationale(node);
  if (rationale) {
    lines.push('');
    lines.push(`Rationale: ${rationale}`);
  }

  if (connections.length > 0) {
    lines.push('');
    lines.push('Interfaces:');
    for (const conn of connections) {
      lines.push(formatConnectionLine(conn));
    }
  }

  lines.push('');
  lines.push('Additional context: ');

  return lines.join('\n');
}

function buildInfrastructurePrompt(node: Node, children: Node[], existingArtifactPaths: string[]): string {
  const tech = node.technology || node.type.split('.').pop()?.replace(/-/g, ' ') || 'infrastructure';
  const isIteration = existingArtifactPaths.length > 0;

  const lines: string[] = [];

  if (isIteration) {
    lines.push(`Refine the configuration artifacts for "${node.label}" (${tech}).`);
    lines.push(`Existing files: ${existingArtifactPaths.join(', ')}`);
  } else {
    lines.push(`Generate configuration artifacts for "${node.label}" (${tech}).`);
  }

  if (children.length > 0) {
    lines.push(`Contains: ${children.map(c => c.label).join(', ')}`);
  }

  lines.push('');
  lines.push('Additional context: ');

  return lines.join('\n');
}

export function buildScaffoldPrompt(graph: Graph, nodeId: string): string {
  const node = graph.nodes[nodeId];
  if (!node) return '';

  const existingArtifacts = Object.values(graph.artifacts)
    .filter(a => a.nodeId === nodeId && a.status !== 'suggested');
  const existingPaths = existingArtifacts.map(a => a.path);

  if (isInfrastructureContainer(node.type)) {
    const children = getChildNodes(graph, nodeId);
    return buildInfrastructurePrompt(node, children, existingPaths);
  }

  const connections = resolveConnections(graph, nodeId);
  return buildFunctionalPrompt(node, connections, existingPaths);
}

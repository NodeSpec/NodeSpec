export interface MermaidGraphData {
  nodes: Record<string, { id: string; label: string; type: string; technology?: string; parentId?: string }>;
  edges: Record<string, { id: string; source: string; target: string; contractId: string }>;
  contracts: Record<string, { id: string; kind: string; name: string }>;
}

export interface MermaidOptions {
  direction?: "LR" | "TD";
  maxDepth?: number;
  compact?: boolean;
}

export interface MermaidResult {
  diagram: string;
  direction: "LR" | "TD";
  compact: boolean;
  nodeCount: number;
}

interface NodeEntry {
  id: string;
  label: string;
  technology?: string;
  role: string;
  parentId?: string;
  shortId: string;
  resolvedDepth: number;
}

interface ContainerTree {
  id: string;
  shortId: string;
  label: string;
  children: string[];
  subContainers: string[];
  depth: number;
}

// Semantic layout partitions, mirroring the client's shared table
// (src/ui/utils/layout-partition.ts getStaticPartition): nodes are emitted
// clients -> edge -> services -> messaging -> data -> external -> ops so
// Mermaid's layered renderer produces the same left-to-right flow the
// canvas ELK layout shows. Ordered — first match wins.
const PARTITION_HEURISTICS: Array<[RegExp, number]> = [
  [/gateway|ingress|load-?balancer|\bcdn\b|reverse-?proxy|api-?edge/, 1],
  [/frontend|web-?app|mobile|desktop|\bcli\b|\bspa\b|static-?site|\bui\b/, 0],
  [/queue|broker|kafka|topic|event-?(bus|stream)|pub-?sub/, 3],
  [/database|\bdb\b|cache|redis|storage|object-?store|search-?engine|warehouse|vector/, 4],
  [/external|third-?party|stripe|payment|webhook-?provider/, 5],
  [/monitor|logging|observab|\bci\b|\bcd\b|pipeline|testing|deploy|terraform|infra/, 6],
  [/auth/, 1],
  [/backend|service|worker|server|api/, 2],
];

function partitionOf(typeId: string): number {
  const id = (typeId || "").toLowerCase();
  for (const [pattern, partition] of PARTITION_HEURISTICS) {
    if (pattern.test(id)) return partition;
  }
  return 2.5; // unknown: between services and messaging
}

function sortIdsByPartition(ids: string[], typeOf: (id: string) => string): string[] {
  return [...ids].sort((a, b) => partitionOf(typeOf(a)) - partitionOf(typeOf(b)));
}

export function formatGraphAsMermaid(
  graph: MermaidGraphData,
  options?: MermaidOptions
): string {
  return formatGraphAsMermaidWithMeta(graph, options).diagram;
}

export function formatGraphAsMermaidWithMeta(
  graph: MermaidGraphData,
  options?: MermaidOptions
): MermaidResult {
  const direction = options?.direction ?? "LR";
  const maxDepth = options?.maxDepth ?? 3;
  const nodeCount = Object.keys(graph.nodes).length;
  const compact = options?.compact ?? nodeCount >= 50;

  if (nodeCount === 0) {
    return {
      diagram: `graph ${direction}\n  empty["No nodes in architecture"]`,
      direction,
      compact,
      nodeCount: 0,
    };
  }

  const diagram = compact
    ? buildCompactDiagram(graph, direction, maxDepth)
    : buildFullDiagram(graph, direction, maxDepth);

  return { diagram, direction, compact, nodeCount };
}

function buildFullDiagram(
  graph: MermaidGraphData,
  direction: "LR" | "TD",
  maxDepth: number
): string {
  const nodes = graph.nodes;
  const edges = graph.edges;
  const contracts = graph.contracts;

  const nodeIds = Object.keys(nodes);
  const shortIdMap = buildShortIdMap(nodeIds);

  const nodeEntries: Record<string, NodeEntry> = {};
  for (const [id, node] of Object.entries(nodes)) {
    nodeEntries[id] = {
      id,
      label: node.label,
      technology: node.technology,
      role: node.type,
      parentId: node.parentId,
      shortId: shortIdMap[id],
      resolvedDepth: 0,
    };
  }

  const containerIds = new Set<string>();
  for (const entry of Object.values(nodeEntries)) {
    if (entry.parentId && nodes[entry.parentId]) {
      containerIds.add(entry.parentId);
    }
  }

  // Compute depth for every node and reparent depth-4+ nodes to their depth-3 ancestor
  for (const entry of Object.values(nodeEntries)) {
    const ancestors = getAncestorChain(entry.id, nodeEntries);
    entry.resolvedDepth = ancestors.length;
  }

  reparentDeepNodes(nodeEntries, containerIds, maxDepth);

  const containers = buildContainerHierarchy(nodeEntries, containerIds);
  const lines: string[] = [`graph ${direction}`];
  const renderedNodes = new Set<string>();

  // Sort every container's members by semantic partition so the emitted
  // order (which Mermaid's renderer respects) reads left-to-right.
  for (const container of Object.values(containers)) {
    container.children = sortIdsByPartition(container.children, (id) => nodeEntries[id]?.role ?? "");
    container.subContainers = sortIdsByPartition(container.subContainers, (id) => nodeEntries[id]?.role ?? "");
  }

  const rootContainers = Object.values(containers).filter(
    (c) => !nodeEntries[c.id].parentId || !containerIds.has(nodeEntries[c.id].parentId!)
  );

  for (const container of rootContainers) {
    renderSubgraph(container, containers, nodeEntries, containerIds, renderedNodes, lines, 1, maxDepth);
  }

  const orphanEntries = Object.values(nodeEntries)
    .filter((entry) => !renderedNodes.has(entry.id))
    .sort((a, b) => partitionOf(a.role) - partitionOf(b.role));
  for (const entry of orphanEntries) {
    lines.push(`  ${formatNodeDeclaration(entry)}`);
    renderedNodes.add(entry.id);
  }

  for (const edge of Object.values(edges)) {
    const sourceEntry = nodeEntries[edge.source];
    const targetEntry = nodeEntries[edge.target];
    if (!sourceEntry || !targetEntry) continue;

    const contract = edge.contractId ? contracts[edge.contractId] : undefined;
    if (contract) {
      const edgeLabel = sanitizeLabel(`${contract.kind}: ${contract.name}`);
      lines.push(`  ${sourceEntry.shortId} -->|${edgeLabel}| ${targetEntry.shortId}`);
    } else {
      lines.push(`  ${sourceEntry.shortId} --> ${targetEntry.shortId}`);
    }
  }

  return lines.join("\n");
}

function buildCompactDiagram(
  graph: MermaidGraphData,
  direction: "LR" | "TD",
  maxDepth: number
): string {
  const nodes = graph.nodes;
  const edges = graph.edges;
  const contracts = graph.contracts;

  const nodeIds = Object.keys(nodes);
  const shortIdMap = buildShortIdMap(nodeIds);

  const containerIds = new Set<string>();
  for (const node of Object.values(nodes)) {
    if (node.parentId && nodes[node.parentId]) {
      containerIds.add(node.parentId);
    }
  }

  // In compact mode, containers become single nodes with child count annotations
  const lines: string[] = [`graph ${direction}`];

  // Identify top-level containers and standalone nodes
  const topLevelContainers = [...containerIds].filter((cId) => {
    const node = nodes[cId];
    return !node.parentId || !containerIds.has(node.parentId);
  });

  const renderedNodes = new Set<string>();

  // Render each top-level container as a subgraph with only direct service nodes
  for (const cId of topLevelContainers) {
    const container = nodes[cId];
    const sid = shortIdMap[cId];
    const allDescendants = getDescendantIds(cId, nodes);
    const leafNodes = allDescendants.filter((id) => !containerIds.has(id));
    const subContainers = allDescendants.filter((id) => containerIds.has(id));

    if (leafNodes.length <= 5 && subContainers.length === 0) {
      // Small container: render normally (partition-ordered)
      lines.push(`  subgraph ${sid}["${sanitizeLabel(container.label)}"]`);
      for (const childId of sortIdsByPartition(leafNodes, (id) => nodes[id]?.type ?? "")) {
        const child = nodes[childId];
        const childSid = shortIdMap[childId];
        const tech = child.technology ? `\\n${sanitizeLabel(child.technology)}` : "";
        lines.push(`    ${childSid}["${sanitizeLabel(child.label)}${tech}"]`);
        renderedNodes.add(childId);
      }
      lines.push(`  end`);
    } else {
      // Large container: collapse internals, show container + count
      const childCount = leafNodes.length + subContainers.length;
      lines.push(`  subgraph ${sid}["${sanitizeLabel(container.label)} (${childCount} components)"]`);

      // Show up to 3 representative leaf nodes (partition-ordered)
      const shown = sortIdsByPartition(leafNodes, (id) => nodes[id]?.type ?? "").slice(0, 3);
      for (const childId of shown) {
        const child = nodes[childId];
        const childSid = shortIdMap[childId];
        const tech = child.technology ? `\\n${sanitizeLabel(child.technology)}` : "";
        lines.push(`    ${childSid}["${sanitizeLabel(child.label)}${tech}"]`);
        renderedNodes.add(childId);
      }

      if (leafNodes.length > 3) {
        const moreCount = leafNodes.length - 3 + subContainers.length;
        lines.push(`    ${sid}_more["... +${moreCount} more"]`);
      }

      // Render nested containers as flat entries (capped at maxDepth)
      for (const subCId of subContainers.slice(0, maxDepth)) {
        const subNode = nodes[subCId];
        const subSid = shortIdMap[subCId];
        const subDescendants = getDescendantIds(subCId, nodes).filter((id) => !containerIds.has(id));
        lines.push(`    ${subSid}["${sanitizeLabel(subNode.label)} (${subDescendants.length})"]`);
        renderedNodes.add(subCId);
      }

      lines.push(`  end`);
    }
    renderedNodes.add(cId);
  }

  // Render orphan nodes (no parent, not containers), partition-ordered
  const orphanIds = sortIdsByPartition(
    Object.keys(nodes).filter((id) => {
      const node = nodes[id];
      if (renderedNodes.has(id) || containerIds.has(id)) return false;
      if (node.parentId && containerIds.has(node.parentId)) return false;
      return true;
    }),
    (id) => nodes[id]?.type ?? "",
  );
  for (const id of orphanIds) {
    const node = nodes[id];
    const sid = shortIdMap[id];
    const tech = node.technology ? `\\n${sanitizeLabel(node.technology)}` : "";
    lines.push(`  ${sid}["${sanitizeLabel(node.label)}${tech}"]`);
    renderedNodes.add(id);
  }

  // Edges: resolve through container boundaries in compact mode
  for (const edge of Object.values(edges)) {
    const sourceNode = nodes[edge.source];
    const targetNode = nodes[edge.target];
    if (!sourceNode || !targetNode) continue;

    const sourceRendered = renderedNodes.has(edge.source) ? shortIdMap[edge.source] : resolveToRenderedAncestor(edge.source, nodes, containerIds, shortIdMap, renderedNodes);
    const targetRendered = renderedNodes.has(edge.target) ? shortIdMap[edge.target] : resolveToRenderedAncestor(edge.target, nodes, containerIds, shortIdMap, renderedNodes);

    if (!sourceRendered || !targetRendered || sourceRendered === targetRendered) continue;

    const contract = edge.contractId ? contracts[edge.contractId] : undefined;
    if (contract) {
      const edgeLabel = sanitizeLabel(`${contract.kind}: ${contract.name}`);
      lines.push(`  ${sourceRendered} -->|${edgeLabel}| ${targetRendered}`);
    } else {
      lines.push(`  ${sourceRendered} --> ${targetRendered}`);
    }
  }

  return lines.join("\n");
}

function resolveToRenderedAncestor(
  nodeId: string,
  nodes: MermaidGraphData["nodes"],
  containerIds: Set<string>,
  shortIdMap: Record<string, string>,
  renderedNodes: Set<string>
): string | null {
  let current = nodeId;
  while (current) {
    if (renderedNodes.has(current)) return shortIdMap[current];
    const node = nodes[current];
    if (!node?.parentId) return null;
    current = node.parentId;
  }
  return null;
}

function getDescendantIds(
  containerId: string,
  nodes: MermaidGraphData["nodes"]
): string[] {
  const result: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    if (id === containerId) continue;
    let current = node.parentId;
    while (current) {
      if (current === containerId) {
        result.push(id);
        break;
      }
      current = nodes[current]?.parentId;
    }
  }
  return result;
}

function reparentDeepNodes(
  nodeEntries: Record<string, NodeEntry>,
  containerIds: Set<string>,
  maxDepth: number
): void {
  for (const entry of Object.values(nodeEntries)) {
    if (entry.resolvedDepth <= maxDepth) continue;

    // Walk up to find the ancestor at exactly maxDepth
    const ancestors = getAncestorChain(entry.id, nodeEntries);
    // ancestors[0] is the immediate parent, ancestors[ancestors.length-1] is the root
    // We want the ancestor at depth = maxDepth, which means (entry.resolvedDepth - maxDepth) levels up
    const levelsUp = entry.resolvedDepth - maxDepth;
    const targetAncestorId = ancestors[levelsUp - 1];

    if (targetAncestorId && containerIds.has(targetAncestorId)) {
      entry.parentId = targetAncestorId;
    }
  }
}

function getAncestorChain(
  nodeId: string,
  nodeEntries: Record<string, NodeEntry>
): string[] {
  const chain: string[] = [];
  let current = nodeEntries[nodeId]?.parentId;
  const visited = new Set<string>();
  while (current && nodeEntries[current] && !visited.has(current)) {
    chain.push(current);
    visited.add(current);
    current = nodeEntries[current].parentId;
  }
  return chain;
}

function renderSubgraph(
  container: ContainerTree,
  allContainers: Record<string, ContainerTree>,
  nodeEntries: Record<string, NodeEntry>,
  containerIds: Set<string>,
  renderedNodes: Set<string>,
  lines: string[],
  currentDepth: number,
  maxDepth: number
): void {
  const entry = nodeEntries[container.id];
  const indent = "  ".repeat(currentDepth);

  lines.push(`${indent}subgraph ${entry.shortId}["${sanitizeLabel(entry.label)}"]`);
  renderedNodes.add(container.id);

  if (currentDepth < maxDepth) {
    for (const subId of container.subContainers) {
      const subContainer = allContainers[subId];
      if (subContainer) {
        renderSubgraph(subContainer, allContainers, nodeEntries, containerIds, renderedNodes, lines, currentDepth + 1, maxDepth);
      }
    }
  } else {
    // At maxDepth: flatten all deeper containers and their children into this level
    for (const subId of container.subContainers) {
      const subEntry = nodeEntries[subId];
      if (subEntry && !renderedNodes.has(subId)) {
        lines.push(`${indent}  ${formatNodeDeclaration(subEntry)}`);
        renderedNodes.add(subId);
      }
      flattenDeepDescendants(subId, allContainers, nodeEntries, renderedNodes, lines, indent);
    }
  }

  for (const childId of container.children) {
    const childEntry = nodeEntries[childId];
    if (childEntry && !renderedNodes.has(childId)) {
      lines.push(`${indent}  ${formatNodeDeclaration(childEntry)}`);
      renderedNodes.add(childId);
    }
  }

  lines.push(`${indent}end`);
}

function flattenDeepDescendants(
  containerId: string,
  allContainers: Record<string, ContainerTree>,
  nodeEntries: Record<string, NodeEntry>,
  renderedNodes: Set<string>,
  lines: string[],
  indent: string
): void {
  const container = allContainers[containerId];
  if (!container) return;

  for (const childId of container.children) {
    const childEntry = nodeEntries[childId];
    if (childEntry && !renderedNodes.has(childId)) {
      lines.push(`${indent}  ${formatNodeDeclaration(childEntry)}`);
      renderedNodes.add(childId);
    }
  }

  for (const subId of container.subContainers) {
    const subEntry = nodeEntries[subId];
    if (subEntry && !renderedNodes.has(subId)) {
      lines.push(`${indent}  ${formatNodeDeclaration(subEntry)}`);
      renderedNodes.add(subId);
    }
    flattenDeepDescendants(subId, allContainers, nodeEntries, renderedNodes, lines, indent);
  }
}

function formatNodeDeclaration(entry: NodeEntry): string {
  const tech = entry.technology ? `\\n${sanitizeLabel(entry.technology)}` : "";
  const nodeLabel = `${sanitizeLabel(entry.label)}${tech}`;

  const role = entry.role.toLowerCase();
  if (role.includes("database") || role === "vector_database") {
    return `${entry.shortId}[("${nodeLabel}")]`;
  }
  if (role.includes("external") || role === "external_service") {
    return `${entry.shortId}(["${nodeLabel}"])`;
  }
  if (role === "gateway" || role === "load_balancer" || role === "api_gateway") {
    return `${entry.shortId}{{"${nodeLabel}"}}`;
  }
  if (role === "queue" || role === "message_queue" || role === "event_bus") {
    return `${entry.shortId}[/"${nodeLabel}"\\]`;
  }

  return `${entry.shortId}["${nodeLabel}"]`;
}

function buildContainerHierarchy(
  nodeEntries: Record<string, NodeEntry>,
  containerIds: Set<string>
): Record<string, ContainerTree> {
  const containers: Record<string, ContainerTree> = {};

  for (const containerId of containerIds) {
    const entry = nodeEntries[containerId];
    if (!entry) continue;

    const ancestors = getAncestorChain(containerId, nodeEntries);
    containers[containerId] = {
      id: containerId,
      shortId: entry.shortId,
      label: entry.label,
      children: [],
      subContainers: [],
      depth: ancestors.length,
    };
  }

  for (const entry of Object.values(nodeEntries)) {
    if (!entry.parentId) continue;
    const parentContainer = containers[entry.parentId];
    if (!parentContainer) continue;

    if (containerIds.has(entry.id)) {
      parentContainer.subContainers.push(entry.id);
    } else {
      parentContainer.children.push(entry.id);
    }
  }

  return containers;
}

function buildShortIdMap(nodeIds: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < nodeIds.length; i++) {
    map[nodeIds[i]] = `n${i}`;
  }
  return map;
}

function sanitizeLabel(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "'")
    .replace(/[[\]{}()]/g, "")
    .replace(/[<>]/g, "")
    .replace(/&/g, "and")
    .replace(/\n/g, " ")
    .replace(/;/g, ",")
    .replace(/#/g, "")
    .replace(/\|/g, "-")
    .replace(/`/g, "'");
}

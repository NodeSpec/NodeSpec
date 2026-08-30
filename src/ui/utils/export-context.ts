import type { Graph } from '@nodespec/core/types.js';
import { collectInheritedScopes } from '@nodespec/core/inherited-context.js';
import { CONTRACT_KIND_VALUES, ARTIFACT_KIND_VALUES } from '@nodespec/core/shared/enums.js';
import { resolveConfigChoice } from '@nodespec/core/config-choice.js';

export interface NodeExportOptions {
  includeArtifactContent: boolean;
}

export interface NodeExportContext {
  node: {
    id: string;
    label: string;
    type: string;
    technology?: string;
    deploymentTarget?: string;
    status?: string;
    rationale?: string;
    /** N8.4a-3c (owner-found, second half of the traceability bug): the inspector's
     *  schema-driven configuration — values an implementing AI must HONOR. The
     *  per-node export omitted ALL node metadata while the project export carried it. */
    configuration?: Record<string, unknown>;
    configurationSource?: 'user-specified' | 'delegated-to-ai';
  };
  parentContainer?: {
    id: string;
    label: string;
    type: string;
  };
  /** N8.4r — client mirror of _shared/inherited-context.ts. Configuration set on the
   *  CONTAINERS this node lives in (region, environment, IAM baseline, tagging policy):
   *  outermost first, innermost wins a key collision. The parent used to contribute only
   *  a label, so a configured account/subscription/project scope reached nothing. */
  inheritedContext?: Array<{
    containerId: string;
    containerLabel: string;
    containerType: string;
    values: Record<string, unknown>;
  }>;
  connections: {
    incoming: Array<{
      fromNode: string;
      fromNodeType: string;
      contract: { name: string; kind: string; interactionKind?: string; transport?: string; specFormat?: string; schema?: Record<string, unknown> };
      edgeLabel?: string;
    }>;
    outgoing: Array<{
      toNode: string;
      toNodeType: string;
      contract: { name: string; kind: string; interactionKind?: string; transport?: string; specFormat?: string; schema?: Record<string, unknown> };
      edgeLabel?: string;
    }>;
  };
  artifacts: Array<{
    path: string;
    kind: string;
    language?: string;
    content?: string;
  }>;
  requirements?: Array<{
    name: string;
    description: string;
    category: string;
    acceptanceCriteria: string[];
  }>;
  testCases?: Array<{
    testId: string;
    name: string;
    testType: string;
    framework?: string;
    status: string;
    expectedResult?: string;
    linkedCriterionText?: string;
  }>;
}

export function buildNodeExportContext(
  nodeId: string,
  graph: Graph,
  options: NodeExportOptions,
  relatedRequirements?: Array<{ name: string; description: string; category: string; acceptanceCriteria: string[] }>,
  testCases?: NodeExportContext['testCases'],
): NodeExportContext | null {
  const node = graph.nodes[nodeId];
  if (!node) return null;

  let parentContainer: NodeExportContext['parentContainer'];
  if (node.parentId && graph.nodes[node.parentId]) {
    const parent = graph.nodes[node.parentId];
    parentContainer = { id: parent.id, label: parent.label, type: parent.type };
  }

  const inheritedContext = collectInheritedScopes(graph, nodeId);

  const incoming: NodeExportContext['connections']['incoming'] = [];
  const outgoing: NodeExportContext['connections']['outgoing'] = [];

  for (const edge of Object.values(graph.edges)) {
    const contract = graph.contracts[edge.contractId];
    if (!contract) continue;

    if (edge.target === nodeId) {
      const sourceNode = graph.nodes[edge.source];
      if (sourceNode) {
        incoming.push({
          fromNode: sourceNode.label,
          fromNodeType: sourceNode.type,
          contract: { name: contract.name, kind: contract.kind, interactionKind: contract.interactionKind, transport: contract.transport, specFormat: contract.specFormat, schema: contract.schema },
          edgeLabel: edge.label,
        });
      }
    }
    if (edge.source === nodeId) {
      const targetNode = graph.nodes[edge.target];
      if (targetNode) {
        outgoing.push({
          toNode: targetNode.label,
          toNodeType: targetNode.type,
          contract: { name: contract.name, kind: contract.kind, interactionKind: contract.interactionKind, transport: contract.transport, specFormat: contract.specFormat, schema: contract.schema },
          edgeLabel: edge.label,
        });
      }
    }
  }

  const artifacts: NodeExportContext['artifacts'] = [];
  for (const artifactId of node.artifacts ?? []) {
    const artifact = graph.artifacts[artifactId];
    if (!artifact) continue;
    artifacts.push({
      path: artifact.path,
      kind: artifact.kind,
      language: artifact.language,
      content: options.includeArtifactContent ? artifact.content : undefined,
    });
  }

  const meta = node.metadata as Record<string, unknown> | undefined;
  const config = (meta?.config && typeof meta.config === 'object' && Object.keys(meta.config as Record<string, unknown>).length > 0)
    ? meta.config as Record<string, unknown>
    : undefined;
  const configChoice = resolveConfigChoice(meta);

  return {
    node: {
      id: node.id,
      label: node.label,
      type: node.type,
      technology: node.technology,
      deploymentTarget: node.deploymentTarget,
      status: node.status,
      rationale: typeof meta?.rationale === 'string' && meta.rationale ? meta.rationale : undefined,
      // Owner 2026-07-30: THE config-choice rule (core/src/config-choice.ts) — an
      // explicit delegation wins over dormant values, so a delegated node never
      // exports leftovers as if the user had chosen them.
      configuration: configChoice === 'delegated' ? undefined : config,
      configurationSource: configChoice === 'delegated'
        ? 'delegated-to-ai'
        : config ? 'user-specified' : undefined,
    },
    parentContainer,
    inheritedContext: inheritedContext.length > 0 ? inheritedContext : undefined,
    connections: { incoming, outgoing },
    artifacts,
    requirements: relatedRequirements,
    testCases,
  };
}

export function formatNodeExportAsPrompt(ctx: NodeExportContext, projectName?: string): string {
  const lines: string[] = [];

  if (projectName) {
    lines.push(`# Project: ${projectName}`);
    lines.push('');
  }

  lines.push(`## Node: ${ctx.node.label}`);
  lines.push(`- Type: ${ctx.node.type}`);
  if (ctx.node.technology) lines.push(`- Technology: ${ctx.node.technology}`);
  if (ctx.node.deploymentTarget) lines.push(`- Deployment: ${ctx.node.deploymentTarget}`);
  if (ctx.node.status) lines.push(`- Status: ${ctx.node.status}`);
  if (ctx.node.rationale) lines.push(`- Rationale: ${ctx.node.rationale}`);
  lines.push('');

  if (ctx.node.configuration) {
    lines.push('### Configuration (user-selected — honor these choices)');
    for (const [k, v] of Object.entries(ctx.node.configuration)) {
      lines.push(`- **${k}:** ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    }
    lines.push('');
  } else if (ctx.node.configurationSource === 'delegated-to-ai') {
    lines.push('### Configuration');
    lines.push('Delegated to the implementing AI (user choice) — select sensible defaults and record them.');
    lines.push('');
  }

  if (ctx.parentContainer) {
    lines.push(`### Container`);
    lines.push(`Part of **${ctx.parentContainer.label}** (${ctx.parentContainer.type})`);
    if (ctx.inheritedContext?.length) {
      lines.push('');
      lines.push('Inherited configuration (honor these — innermost container wins a conflict):');
      for (const scope of ctx.inheritedContext) {
        const pairs = Object.entries(scope.values)
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
          .join(', ');
        lines.push(`- ${scope.containerLabel} (${scope.containerType}): ${pairs}`);
      }
    }
    lines.push('');
  }

  if (ctx.connections.incoming.length > 0 || ctx.connections.outgoing.length > 0) {
    lines.push('### Connections');
    lines.push('');

    if (ctx.connections.incoming.length > 0) {
      lines.push('**Incoming:**');
      for (const conn of ctx.connections.incoming) {
        const transport = conn.contract.transport ? `/${conn.contract.transport}` : '';
        const spec = conn.contract.specFormat && conn.contract.specFormat !== 'none' ? ` (${conn.contract.specFormat})` : '';
        lines.push(`- From \`${conn.fromNode}\` via ${conn.contract.kind}${transport}${spec} "${conn.contract.name}"`);
        if (conn.contract.schema && Object.keys(conn.contract.schema).length > 0) {
          lines.push('  ```json');
          lines.push(`  ${JSON.stringify(conn.contract.schema, null, 2).split('\n').join('\n  ')}`);
          lines.push('  ```');
        }
      }
      lines.push('');
    }

    if (ctx.connections.outgoing.length > 0) {
      lines.push('**Outgoing:**');
      for (const conn of ctx.connections.outgoing) {
        const transport = conn.contract.transport ? `/${conn.contract.transport}` : '';
        const spec = conn.contract.specFormat && conn.contract.specFormat !== 'none' ? ` (${conn.contract.specFormat})` : '';
        lines.push(`- To \`${conn.toNode}\` via ${conn.contract.kind}${transport}${spec} "${conn.contract.name}"`);
        if (conn.contract.schema && Object.keys(conn.contract.schema).length > 0) {
          lines.push('  ```json');
          lines.push(`  ${JSON.stringify(conn.contract.schema, null, 2).split('\n').join('\n  ')}`);
          lines.push('  ```');
        }
      }
      lines.push('');
    }
  }

  if (ctx.requirements && ctx.requirements.length > 0) {
    lines.push('### Related Requirements');
    for (const req of ctx.requirements) {
      lines.push(`- **${req.name}** (${req.category}): ${req.description}`);
      if (req.acceptanceCriteria.length > 0) {
        for (const ac of req.acceptanceCriteria) {
          lines.push(`  - AC: ${ac}`);
        }
      }
    }
    lines.push('');
  }

  if (ctx.testCases && ctx.testCases.length > 0) {
    lines.push('### Test Cases');
    lines.push('');
    for (const tc of ctx.testCases) {
      const statusLabel = tc.status === 'passed' ? '[PASS]'
        : tc.status === 'failed' ? '[FAIL]'
        : '[PENDING]';
      lines.push(`#### ${statusLabel} ${tc.testId}: ${tc.name}`);
      lines.push(`- Type: ${tc.testType}${tc.framework ? ` | Framework: ${tc.framework}` : ''}`);
      if (tc.expectedResult) {
        lines.push(`- Expected: ${tc.expectedResult}`);
      }
      if (tc.linkedCriterionText) {
        lines.push(`- Criterion: ${tc.linkedCriterionText}`);
      }
      lines.push('');
    }
  }

  if (ctx.artifacts.length > 0) {
    lines.push('### Artifacts');
    for (const art of ctx.artifacts) {
      lines.push(`- \`${art.path}\` (${art.kind}${art.language ? ', ' + art.language : ''})`);
      if (art.content) {
        const lang = art.language || art.path.split('.').pop() || '';
        lines.push(`  \`\`\`${lang}`);
        lines.push(`  ${art.content.split('\n').join('\n  ')}`);
        lines.push('  ```');
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export interface ProjectExportTestCase {
  testId: string;
  name: string;
  testType: string;
  framework?: string;
  status: string;
  expectedResult?: string;
  requirementName: string;
  requirementId: string;
}

export interface ProjectExportSpecification {
  vision: string;
  sections: Array<{
    name: string;
    description?: string;
  }>;
  requirements: Array<{
    requirementId: string;
    name: string;
    description: string;
    category: string;
    status: string;
    sectionName?: string;
    acceptanceCriteria: Array<{ text: string; met?: boolean }>;
  }>;
  constraints: Array<{
    type: string;
    description: string;
  }>;
  preferences: {
    languages?: string[];
    frameworks?: string[];
    databases?: string[];
    deploymentTarget?: string;
    architecturePattern?: string;
  };
}

export interface ProjectExportData {
  meta: {
    projectName: string;
    exportedAt: string;
    schemaVersion: number;
    graphHash: string;
    nodeCount: number;
    edgeCount: number;
    contractCount: number;
    artifactCount: number;
    testCount: number;
  };
  specification?: ProjectExportSpecification;
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    technology?: string;
    deploymentTarget?: string;
    parentId?: string;
    status?: string;
    artifactPaths: string[];
    rationale?: string;
    metadata?: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    sourceNode: string;
    targetNode: string;
    contractId: string;
    contractName: string;
    contractKind: string;
    transport?: string;
    interactionKind?: string;
    specFormat?: string;
    direction?: string;
    criticality?: string;
    label?: string;
  }>;
  contracts: Array<{
    id: string;
    name: string;
    kind: string;
    interactionKind?: string;
    transport?: string;
    specFormat?: string;
    schema?: Record<string, unknown>;
  }>;
  artifacts: Array<{
    id: string;
    nodeId: string;
    nodeLabel: string;
    path: string;
    kind: string;
    language?: string;
    content?: string;
  }>;
  testSuite: ProjectExportTestCase[];
}

export function buildProjectExport(
  graph: Graph,
  projectName: string,
  testSuite?: ProjectExportTestCase[],
  specification?: ProjectExportSpecification,
): ProjectExportData {
  const nodes = Object.values(graph.nodes).map(n => {
    const meta = n.metadata as Record<string, unknown> | undefined;
    return {
      id: n.id,
      label: n.label,
      type: n.type,
      technology: n.technology,
      deploymentTarget: n.deploymentTarget,
      parentId: n.parentId,
      status: n.status,
      artifactPaths: (n.artifacts ?? []).map(aid => graph.artifacts[aid]?.path).filter(Boolean) as string[],
      rationale: meta?.rationale as string | undefined,
      // N5.5: metadata.config (schema-driven DynamicMetadataForm values) is the LIVE
      // configuration representation; domainMetadata is read-compat for old nodes.
      metadata: (meta?.config ?? meta?.domainMetadata) as Record<string, unknown> | undefined,
    };
  });

  const edges = Object.values(graph.edges).map(e => {
    const contract = graph.contracts[e.contractId];
    const sourceNode = graph.nodes[e.source];
    const targetNode = graph.nodes[e.target];
    return {
      id: e.id,
      sourceId: e.source,
      targetId: e.target,
      sourceNode: sourceNode?.label ?? e.source,
      targetNode: targetNode?.label ?? e.target,
      contractId: e.contractId,
      contractName: contract?.name ?? 'unknown',
      contractKind: contract?.kind ?? 'custom',
      transport: contract?.transport,
      interactionKind: contract?.interactionKind,
      specFormat: contract?.specFormat,
      direction: e.direction,
      criticality: e.criticality,
      label: e.label,
    };
  });

  // N8.6(C-fix): exports carry REACHABLE contracts only (referenced by an edge) —
  // same rule as model.json. Snapshots accumulate orphaned stubs and palette-drop
  // suggested-contract rows; they are canvas-side scaffolding, not model.
  const referencedContractIds = new Set(Object.values(graph.edges).map(e => e.contractId));
  const contracts = Object.values(graph.contracts)
    .filter(c => referencedContractIds.has(c.id))
    .map(c => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      interactionKind: c.interactionKind,
      transport: c.transport,
      specFormat: c.specFormat,
      schema: c.schema,
    }));

  const artifacts = Object.values(graph.artifacts).map(a => ({
    id: a.id,
    nodeId: a.nodeId,
    nodeLabel: graph.nodes[a.nodeId]?.label ?? a.nodeId,
    path: a.path,
    kind: a.kind,
    language: a.language,
    content: a.content,
  }));

  const tests = testSuite ?? [];

  return {
    meta: {
      projectName,
      exportedAt: new Date().toISOString(),
      schemaVersion: graph.schemaVersion,
      graphHash: graph.hash,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      contractCount: contracts.length,
      artifactCount: artifacts.length,
      testCount: tests.length,
    },
    specification,
    nodes,
    edges,
    contracts,
    artifacts,
    testSuite: tests,
  };
}

export function formatProjectExportAsMarkdown(data: ProjectExportData): string {
  const lines: string[] = [];

  const contractById = new Map(data.contracts.map(c => [c.id, c]));

  lines.push(`# ${data.meta.projectName} - Architecture Export`);
  lines.push('');
  lines.push(`> Exported: ${data.meta.exportedAt}`);
  lines.push(`> Schema v${data.meta.schemaVersion} | graph_hash: \`${data.meta.graphHash}\``);
  lines.push(`> ${data.meta.nodeCount} nodes | ${data.meta.edgeCount} edges | ${data.meta.contractCount} contracts | ${data.meta.artifactCount} artifacts | ${data.meta.testCount} tests`);
  lines.push('');

  lines.push('## Schema Ontology');
  lines.push('');
  lines.push('- **Node**: A system component with a `type` (e.g. "service", "database", "frontend-app"), optional `technology`, optional `deploymentTarget`. Nodes can be nested -- a node with a `parentId` is a child component of the parent container node.');
  lines.push('- **Edge**: A directed connection from a source node to a target node, mediated by exactly one contract. Represents a dependency or data flow.');
  // M7: was a hand-written list that omitted `dependency`. This text ships to external AI
  // tools and RAG, so a missing kind is a kind the consuming model does not know exists.
  lines.push(`- **Contract**: The interface agreement between two nodes. \`kind\` is one of: ${CONTRACT_KIND_VALUES.map(k => '`' + k + '`').join(', ')}. May include a JSON schema describing the payload.`);
  // M7: was 6 of the 8 kinds (`task` and `test-plan` were missing). Generated now.
  lines.push(`- **Artifact**: A file belonging to a specific node. \`kind\` is one of: ${ARTIFACT_KIND_VALUES.map(k => '`' + k + '`').join(', ')}.`);
  lines.push('- **Requirement**: A specification-level statement mapping to the architecture.');
  lines.push('');

  lines.push('## Nodes');
  lines.push('');
  const containerNodes = data.nodes.filter(n => !n.parentId);
  const childNodes = data.nodes.filter(n => n.parentId);
  for (const node of containerNodes) {
    lines.push(`### ${node.label} <!-- node:${node.id} -->`);
    lines.push(`- Type: \`${node.type}\``);
    if (node.technology) lines.push(`- Technology: ${node.technology}`);
    if (node.deploymentTarget) lines.push(`- Deployment: ${node.deploymentTarget}`);
    if (node.artifactPaths.length > 0) {
      lines.push(`- Files: ${node.artifactPaths.map(p => `\`${p}\``).join(', ')}`);
    }

    const children = childNodes.filter(c => c.parentId === node.id);
    if (children.length > 0) {
      lines.push('');
      lines.push('**Children:**');
      for (const child of children) {
        lines.push(`  - **${child.label}** <!-- node:${child.id} --> (\`${child.type}\`${child.technology ? ', ' + child.technology : ''})`);
        if (child.artifactPaths.length > 0) {
          lines.push(`    Files: ${child.artifactPaths.map(p => `\`${p}\``).join(', ')}`);
        }
      }
    }
    lines.push('');
  }

  const orphanChildren = childNodes.filter(c => !containerNodes.some(p => p.id === c.parentId));
  if (orphanChildren.length > 0) {
    for (const node of orphanChildren) {
      lines.push(`### ${node.label} <!-- node:${node.id} -->`);
      lines.push(`- Type: \`${node.type}\``);
      if (node.technology) lines.push(`- Technology: ${node.technology}`);
      if (node.artifactPaths.length > 0) {
        lines.push(`- Files: ${node.artifactPaths.map(p => `\`${p}\``).join(', ')}`);
      }
      lines.push('');
    }
  }

  if (data.edges.length > 0) {
    lines.push('## Connections');
    lines.push('');
    for (const edge of data.edges) {
      const transportSuffix = edge.transport ? `/${edge.transport}` : '';
      const specSuffix = edge.specFormat && edge.specFormat !== 'none' ? ` (${edge.specFormat})` : '';
      // N8.6(C): behavior annotations — only when set (required/unidirectional are the defaults)
      const behaviorBits = [
        edge.direction === 'bidirectional' ? 'bidirectional' : '',
        edge.criticality && edge.criticality !== 'required' ? edge.criticality : '',
      ].filter(Boolean);
      const behaviorSuffix = behaviorBits.length > 0 ? ` [${behaviorBits.join(', ')}]` : '';
      lines.push(`- **${edge.sourceNode}** -> **${edge.targetNode}** via \`${edge.contractKind}${transportSuffix}\`${specSuffix}${behaviorSuffix} "${edge.contractName}" <!-- edge:${edge.id} -->`);
      const contract = contractById.get(edge.contractId) ?? data.contracts.find(c => c.name === edge.contractName && c.kind === edge.contractKind);
      if (contract?.schema && Object.keys(contract.schema).length > 0) {
        lines.push('  ```json');
        lines.push(`  ${JSON.stringify(contract.schema, null, 2).split('\n').join('\n  ')}`);
        lines.push('  ```');
      }
    }
    lines.push('');
  }

  if (data.artifacts.length > 0) {
    lines.push('## Artifacts');
    lines.push('');
    for (const artifact of data.artifacts) {
      lines.push(`### \`${artifact.path}\` (${artifact.nodeLabel})`);
      lines.push(`- Kind: ${artifact.kind}${artifact.language ? ' | Language: ' + artifact.language : ''}`);
      if (artifact.content) {
        const lang = artifact.language || artifact.path.split('.').pop() || '';
        lines.push(`\`\`\`${lang}`);
        lines.push(artifact.content);
        lines.push('```');
      }
      lines.push('');
    }
  }

  if (data.testSuite && data.testSuite.length > 0) {
    lines.push('## Test Suite');
    lines.push('');

    const passed = data.testSuite.filter(t => t.status === 'passed').length;
    const failed = data.testSuite.filter(t => t.status === 'failed').length;
    const pending = data.testSuite.filter(t => t.status === 'not_started').length;
    lines.push(`> ${data.testSuite.length} tests | ${passed} passed | ${failed} failed | ${pending} pending`);
    lines.push('');

    const byRequirement = new Map<string, ProjectExportTestCase[]>();
    for (const tc of data.testSuite) {
      const key = tc.requirementName || tc.requirementId;
      if (!byRequirement.has(key)) byRequirement.set(key, []);
      byRequirement.get(key)!.push(tc);
    }

    for (const [reqName, tests] of byRequirement) {
      lines.push(`### ${reqName}`);
      lines.push('');
      for (const tc of tests) {
        const statusLabel = tc.status === 'passed' ? '[PASS]'
          : tc.status === 'failed' ? '[FAIL]'
          : '[PENDING]';
        lines.push(`- ${statusLabel} ${tc.testId}: ${tc.name} (${tc.testType}${tc.framework ? `, ${tc.framework}` : ''})`);
        if (tc.expectedResult) {
          lines.push(`  - Expected: ${tc.expectedResult}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export interface GraphRefExport {
  schemaVersion: number;
  graphHash: string;
  exportedAt: string;
  nodeIndex: Record<string, { label: string; type: string; technology?: string; parentId?: string }>;
  edges: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    contractId: string;
    direction?: string;
    criticality?: string;
    label?: string;
  }>;
  contractIndex: Record<string, { kind: string; name: string; interactionKind?: string; transport?: string; specFormat?: string; schema?: Record<string, unknown> }>;
  artifactIndex: Record<string, { nodeId: string; path: string; kind: string; language?: string }>;
}

export function buildGraphRefExport(data: ProjectExportData): GraphRefExport {
  const nodeIndex: GraphRefExport['nodeIndex'] = {};
  for (const node of data.nodes) {
    nodeIndex[node.id] = {
      label: node.label,
      type: node.type,
      technology: node.technology,
      parentId: node.parentId,
    };
  }

  const contractIndex: GraphRefExport['contractIndex'] = {};
  for (const contract of data.contracts) {
    contractIndex[contract.id] = {
      kind: contract.kind,
      name: contract.name,
      interactionKind: contract.interactionKind,
      transport: contract.transport,
      specFormat: contract.specFormat,
      schema: contract.schema,
    };
  }

  const artifactIndex: GraphRefExport['artifactIndex'] = {};
  for (const artifact of data.artifacts) {
    artifactIndex[artifact.id] = {
      nodeId: artifact.nodeId,
      path: artifact.path,
      kind: artifact.kind,
      language: artifact.language,
    };
  }

  return {
    schemaVersion: data.meta.schemaVersion,
    graphHash: data.meta.graphHash,
    exportedAt: data.meta.exportedAt,
    nodeIndex,
    edges: data.edges.map(e => ({
      id: e.id,
      sourceId: e.sourceId,
      targetId: e.targetId,
      contractId: e.contractId,
      direction: e.direction,
      criticality: e.criticality,
      label: e.label,
    })),
    contractIndex,
    artifactIndex,
  };
}

export function downloadAsFile(content: string, filename: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

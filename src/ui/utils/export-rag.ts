import type { ProjectExportData } from './export-context.js';

interface RagEntry {
  path: string;
  content: string;
}

function sanitizeFilename(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'unnamed';
}

function buildTaskBrief(
  node: ProjectExportData['nodes'][number],
  data: ProjectExportData,
): string[] {
  const lines: string[] = [];
  lines.push('## Task Brief');
  lines.push('');

  // Responsibility paragraph
  const techStr = node.technology ? ` using ${node.technology}` : '';
  const incoming = data.edges.filter(e => e.targetId === node.id);
  const outgoing = data.edges.filter(e => e.sourceId === node.id);
  const peerCount = new Set([...incoming.map(e => e.sourceNode), ...outgoing.map(e => e.targetNode)]).size;
  const parentNode = node.parentId ? data.nodes.find(n => n.id === node.parentId) : undefined;
  const containerContext = parentNode ? ` within the ${parentNode.label} container` : '';

  lines.push(
    `This ${node.type}${techStr} is responsible for ${node.label}${containerContext}. ` +
    `It integrates with ${peerCount} other component${peerCount !== 1 ? 's' : ''} in the system.`,
  );
  lines.push('');

  // Integration summary (framed as receives/sends)
  if (incoming.length > 0 || outgoing.length > 0) {
    lines.push('**Integrations:**');
    for (const edge of incoming) {
      const transport = edge.transport ? `/${edge.transport}` : '';
      lines.push(`- Receives from ${edge.sourceNode} via ${edge.contractKind}${transport} ("${edge.contractName}")`);
    }
    for (const edge of outgoing) {
      const transport = edge.transport ? `/${edge.transport}` : '';
      lines.push(`- Sends to ${edge.targetNode} via ${edge.contractKind}${transport} ("${edge.contractName}")`);
    }
    lines.push('');
  }

  // Outstanding work: unmet acceptance criteria
  const spec = data.specification;
  if (spec) {
    const linkedReqs = spec.requirements ?? [];

    const unmetCriteria = linkedReqs.flatMap(
      r => r.acceptanceCriteria.filter(ac => !ac.met).map(ac => ({ req: r.name, text: ac.text })),
    );

    const pendingTests = data.testSuite.filter(tc => {
      const linkedReqIds = new Set(linkedReqs.map(r => r.requirementId));
      return linkedReqIds.has(tc.requirementId) && tc.status !== 'passed';
    });

    if (unmetCriteria.length > 0 || pendingTests.length > 0) {
      lines.push('**Outstanding Work:**');
      for (const item of unmetCriteria) {
        lines.push(`- [ ] ${item.text} *(${item.req})*`);
      }
      for (const tc of pendingTests) {
        lines.push(`- [ ] Test: ${tc.name} (${tc.testType}, ${tc.status})`);
      }
      lines.push('');
    }
  }

  // Configuration requirements from domain metadata
  if (node.metadata) {
    const meta = node.metadata as Record<string, unknown>;
    const configFields: string[] = [];

    if (meta.type === 'managed-service' || meta.type === 'auth-provider') {
      const metaData = meta.data as Record<string, unknown> | undefined;
      if (metaData) {
        for (const [key, value] of Object.entries(metaData)) {
          if (value === null || value === undefined || value === '') {
            configFields.push(key);
          }
        }
      }
    }

    if (meta.metadata_schema) {
      const schema = meta.metadata_schema as Record<string, unknown>;
      for (const key of Object.keys(schema)) {
        if (!configFields.includes(key)) configFields.push(key);
      }
    }

    if (configFields.length > 0) {
      lines.push(`**Requires manual setup:** ${configFields.join(', ')}`);
      lines.push('');
    }
  }

  // Rationale
  if (node.rationale) {
    lines.push(`**Rationale:** ${node.rationale}`);
    lines.push('');
  }

  return lines;
}

function formatNodeRagContext(
  node: ProjectExportData['nodes'][number],
  data: ProjectExportData,
): string {
  const lines: string[] = [];

  // Header metadata
  lines.push(`# ${node.label}`);
  lines.push('');
  lines.push(`- Type: ${node.type}`);
  if (node.technology) lines.push(`- Technology: ${node.technology}`);
  if (node.deploymentTarget) lines.push(`- Deployment: ${node.deploymentTarget}`);
  if (node.status) lines.push(`- Status: ${node.status}`);
  lines.push('');

  // Task Brief (at the top, after metadata)
  lines.push(...buildTaskBrief(node, data));

  // Container context
  if (node.parentId) {
    const parent = data.nodes.find(n => n.id === node.parentId);
    if (parent) {
      lines.push(`## Container`);
      lines.push(`Part of **${parent.label}** (${parent.type})`);
      lines.push('');
    }
  }

  const children = data.nodes.filter(n => n.parentId === node.id);
  if (children.length > 0) {
    lines.push('## Children');
    for (const child of children) {
      const tech = child.technology ? ` [${child.technology}]` : '';
      lines.push(`- **${child.label}**${tech} -- ${child.type}`);
    }
    lines.push('');
  }

  // Connections with contract details
  const incoming = data.edges.filter(e => e.targetId === node.id);
  const outgoing = data.edges.filter(e => e.sourceId === node.id);

  if (incoming.length > 0 || outgoing.length > 0) {
    lines.push('## Connections');
    lines.push('');

    if (incoming.length > 0) {
      lines.push('**Incoming:**');
      for (const edge of incoming) {
        const contract = data.contracts.find(c => c.id === edge.contractId);
        const transport = edge.transport ? `/${edge.transport}` : '';
        const spec = edge.specFormat && edge.specFormat !== 'none' ? ` (${edge.specFormat})` : '';
        lines.push(`- From \`${edge.sourceNode}\` via ${edge.contractKind}${transport}${spec} "${edge.contractName}"`);
        if (contract?.schema && Object.keys(contract.schema).length > 0) {
          lines.push('  ```json');
          lines.push(`  ${JSON.stringify(contract.schema, null, 2).split('\n').join('\n  ')}`);
          lines.push('  ```');
        }
      }
      lines.push('');
    }

    if (outgoing.length > 0) {
      lines.push('**Outgoing:**');
      for (const edge of outgoing) {
        const contract = data.contracts.find(c => c.id === edge.contractId);
        const transport = edge.transport ? `/${edge.transport}` : '';
        const spec = edge.specFormat && edge.specFormat !== 'none' ? ` (${edge.specFormat})` : '';
        lines.push(`- To \`${edge.targetNode}\` via ${edge.contractKind}${transport}${spec} "${edge.contractName}"`);
        if (contract?.schema && Object.keys(contract.schema).length > 0) {
          lines.push('  ```json');
          lines.push(`  ${JSON.stringify(contract.schema, null, 2).split('\n').join('\n  ')}`);
          lines.push('  ```');
        }
      }
      lines.push('');
    }
  }

  // Requirements
  const spec = data.specification;
  if (spec) {
    const linkedReqs = spec.requirements ?? [];
    if (linkedReqs.length > 0) {
      lines.push('## Requirements');
      for (const req of linkedReqs) {
        lines.push(`- **${req.name}** (${req.category}): ${req.description}`);
        if (req.acceptanceCriteria.length > 0) {
          for (const ac of req.acceptanceCriteria) {
            const check = ac.met ? '[x]' : '[ ]';
            lines.push(`  - ${check} ${ac.text}`);
          }
        }
      }
      lines.push('');
    }
  }

  // Test cases
  const nodeTests = data.testSuite.filter(tc => {
    if (!spec) return false;
    const linkedReqIds = new Set(spec.requirements?.map(r => r.requirementId) ?? []);
    return linkedReqIds.has(tc.requirementId);
  });

  if (nodeTests.length > 0) {
    lines.push('## Test Cases');
    lines.push('');
    for (const tc of nodeTests) {
      const statusLabel = tc.status === 'passed' ? '[PASS]'
        : tc.status === 'failed' ? '[FAIL]'
        : '[PENDING]';
      lines.push(`### ${statusLabel} ${tc.testId}: ${tc.name}`);
      lines.push(`- Type: ${tc.testType}${tc.framework ? ` | Framework: ${tc.framework}` : ''}`);
      if (tc.expectedResult) {
        lines.push(`- Expected: ${tc.expectedResult}`);
      }
      lines.push('');
    }
  }

  // Artifacts
  const nodeArtifacts = data.artifacts.filter(a => a.nodeId === node.id);
  if (nodeArtifacts.length > 0) {
    lines.push('## Artifacts');
    for (const art of nodeArtifacts) {
      if (art.content) {
        const lang = art.language || art.path.split('.').pop() || '';
        lines.push(`\`${art.path}\` (${art.kind})`);
        lines.push('');
        lines.push(`\`\`\`${lang}`);
        lines.push(art.content);
        lines.push('```');
        lines.push('');
      } else {
        lines.push(`- \`${art.path}\` (${art.kind}${art.language ? ', ' + art.language : ''})`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildNodeRagContexts(data: ProjectExportData): RagEntry[] {
  const entries: RagEntry[] = [];
  const usedFilenames = new Set<string>();

  for (const node of data.nodes) {
    let filename = sanitizeFilename(node.label);
    if (usedFilenames.has(filename)) {
      filename = `${filename}-${node.id.slice(0, 6)}`;
    }
    usedFilenames.add(filename);

    const content = formatNodeRagContext(node, data);
    entries.push({
      path: `.nodespec/context/${filename}.md`,
      content,
    });
  }

  if (entries.length > 0) {
    const indexLines: string[] = [];
    indexLines.push(`# ${data.meta.projectName} -- Module Context Index`);
    indexLines.push('');
    indexLines.push('Per-node context files for RAG ingestion. Each file contains the full');
    indexLines.push('architectural context for a single component: connections, requirements,');
    indexLines.push('features, test cases, and artifacts.');
    indexLines.push('');
    indexLines.push('## Nodes');
    indexLines.push('');
    for (const entry of entries) {
      const node = data.nodes.find(n =>
        entry.path === `.nodespec/context/${sanitizeFilename(n.label)}.md`
        || entry.path.startsWith(`.nodespec/context/${sanitizeFilename(n.label)}-`),
      );
      if (node) {
        const tech = node.technology ? ` [${node.technology}]` : '';
        indexLines.push(`- [${node.label}](${entry.path.replace('.nodespec/context/', '')})${tech} -- ${node.type}`);
      }
    }
    indexLines.push('');

    entries.push({
      path: '.nodespec/context/INDEX.md',
      content: indexLines.join('\n'),
    });
  }

  return entries;
}

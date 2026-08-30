import type { ProjectExportData } from './export-context.js';

function extractTechStack(data: ProjectExportData): {
  languages: string[];
  frameworks: string[];
  databases: string[];
  deploymentTarget?: string;
  architecturePattern?: string;
} {
  const spec = data.specification;
  if (spec?.preferences) {
    return {
      languages: spec.preferences.languages ?? [],
      frameworks: spec.preferences.frameworks ?? [],
      databases: spec.preferences.databases ?? [],
      deploymentTarget: spec.preferences.deploymentTarget,
      architecturePattern: spec.preferences.architecturePattern,
    };
  }
  const techs = new Set<string>();
  const deploys = new Set<string>();
  for (const node of data.nodes) {
    if (node.technology) techs.add(node.technology);
    if (node.deploymentTarget) deploys.add(node.deploymentTarget);
  }
  return {
    languages: [],
    frameworks: Array.from(techs),
    databases: [],
    deploymentTarget: deploys.size > 0 ? Array.from(deploys).join(', ') : undefined,
  };
}

function extractContainerTopology(data: ProjectExportData): Array<{
  id: string;
  label: string;
  type: string;
  technology?: string;
  childCount: number;
}> {
  const containers = data.nodes.filter(n => !n.parentId);
  return containers.map(c => ({
    id: c.id,
    label: c.label,
    type: c.type,
    technology: c.technology,
    childCount: data.nodes.filter(n => n.parentId === c.id).length,
  }));
}

function extractConnectionPatterns(data: ProjectExportData): string[] {
  const patterns = new Set<string>();
  for (const edge of data.edges) {
    const transport = edge.transport ? `/${edge.transport}` : '';
    patterns.add(`${edge.sourceNode} -> ${edge.targetNode} (${edge.contractKind}${transport})`);
  }
  return Array.from(patterns);
}


function extractConstraints(data: ProjectExportData): string[] {
  if (!data.specification?.constraints) return [];
  return data.specification.constraints.map(c => `${c.type}: ${c.description}`);
}

function extractGlobPatterns(data: ProjectExportData): string[] {
  const dirPrefixes = new Set<string>();
  for (const artifact of data.artifacts) {
    if (!artifact.path) continue;
    const parts = artifact.path.replace(/^\/+/, '').split('/');
    if (parts.length >= 2) {
      dirPrefixes.add(parts[0] + '/**');
    } else {
      const ext = artifact.path.split('.').pop();
      if (ext) dirPrefixes.add(`*.${ext}`);
    }
  }
  return Array.from(dirPrefixes).sort();
}

export function formatAsClaude(data: ProjectExportData): string {
  const lines: string[] = [];
  const connections = extractConnectionPatterns(data);
  const constraints = extractConstraints(data);

  const vision = data.specification?.vision ?? '';
  lines.push(`# ${data.meta.projectName}${vision ? ' -- ' + vision.split('.')[0] + '.' : ''}`);
  lines.push('');

  lines.push('## Architecture');
  lines.push('');
  lines.push('| Node | Role | Technology | Integrates With |');
  lines.push('|------|------|------------|-----------------|');
  for (const node of data.nodes) {
    const inEdges = data.edges.filter(e => e.targetId === node.id);
    const outEdges = data.edges.filter(e => e.sourceId === node.id);
    const peers = [
      ...inEdges.map(e => e.sourceNode),
      ...outEdges.map(e => e.targetNode),
    ];
    const uniquePeers = [...new Set(peers)].join(', ') || '-';
    lines.push(`| ${node.label} | ${node.type} | ${node.technology ?? '-'} | ${uniquePeers} |`);
  }
  lines.push('');

  if (constraints.length > 0) {
    lines.push('## Constraints');
    lines.push('');
    for (const c of constraints) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  if (connections.length > 0) {
    lines.push('## Patterns');
    lines.push('');
    for (const conn of connections) {
      lines.push(`- ${conn}`);
    }
    lines.push('');
  }

  const unmetRequirements = (data.specification?.requirements ?? []).filter(
    r => r.acceptanceCriteria.some(ac => !ac.met),
  );

  if (unmetRequirements.length > 0) {
    lines.push('## Tasks');
    lines.push('');
    for (const req of unmetRequirements) {
      const unmet = req.acceptanceCriteria.filter(ac => !ac.met).map(ac => ac.text);
      lines.push(`- **${req.name}**: ${unmet[0] ?? req.description}`);
    }
    lines.push('');
  }

  const artifactsByNode = new Map<string, string[]>();
  for (const art of data.artifacts) {
    if (!art.path) continue;
    if (!artifactsByNode.has(art.nodeLabel)) artifactsByNode.set(art.nodeLabel, []);
    artifactsByNode.get(art.nodeLabel)!.push(art.path);
  }

  if (artifactsByNode.size > 0) {
    lines.push('## File Ownership');
    lines.push('');
    for (const [nodeLabel, paths] of artifactsByNode) {
      lines.push(`- **${nodeLabel}**: ${paths.map(p => `\`${p}\``).join(', ')}`);
    }
    lines.push('');
  }

  if (data.nodes.length > 0) {
    lines.push('## Deep Context');
    lines.push('');
    lines.push('Per-node context is available via @import:');
    lines.push('');
    for (const node of data.nodes) {
      const slug = node.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      lines.push(`@.nodespec/context/${slug}.md`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatAsCursorRules(data: ProjectExportData): string {
  const lines: string[] = [];
  const stack = extractTechStack(data);
  const topology = extractContainerTopology(data);
  const globs = extractGlobPatterns(data);
  const constraints = extractConstraints(data);

  // Frontmatter -- Cursor expects globs as a single comma-separated string
  lines.push('---');
  lines.push(`description: "${data.meta.projectName} architecture context -- applies when editing project source files"`);
  if (globs.length > 0) {
    lines.push(`globs: "${globs.join(', ')}"`);
  }
  lines.push('alwaysApply: false');
  lines.push('---');
  lines.push('');

  lines.push(`# ${data.meta.projectName}`);
  lines.push('');
  if (data.specification?.vision) {
    lines.push(`> ${data.specification.vision}`);
    lines.push('');
  }

  // Stack (compact)
  const stackParts: string[] = [];
  if (stack.languages.length > 0) stackParts.push(stack.languages.join(', '));
  if (stack.frameworks.length > 0) stackParts.push(stack.frameworks.join(', '));
  if (stack.databases.length > 0) stackParts.push(stack.databases.join(', '));
  if (stackParts.length > 0) {
    lines.push(`**Stack:** ${stackParts.join(' | ')}${stack.deploymentTarget ? ` | Deploy: ${stack.deploymentTarget}` : ''}`);
    lines.push('');
  }

  // Constraints as terse directives
  if (constraints.length > 0) {
    lines.push('## Constraints');
    lines.push('');
    for (const c of constraints) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  // Component map
  if (topology.length > 0) {
    lines.push('## Components');
    lines.push('');
    const childNodes = data.nodes.filter(n => n.parentId);
    for (const container of topology) {
      const tech = container.technology ? ` [${container.technology}]` : '';
      lines.push(`- **${container.label}**${tech}: ${container.type}`);
      const children = childNodes.filter(c => c.parentId === container.id);
      for (const child of children) {
        const childTech = child.technology ? ` [${child.technology}]` : '';
        lines.push(`  - ${child.label}${childTech}: ${child.type}`);
      }
    }
    const orphans = childNodes.filter(c => !topology.some(t => t.id === c.parentId));
    for (const orphan of orphans) {
      const tech = orphan.technology ? ` [${orphan.technology}]` : '';
      lines.push(`- ${orphan.label}${tech}: ${orphan.type}`);
    }
    lines.push('');
  }

  // Connection rules -- framed as awareness directives
  if (data.edges.length > 0) {
    lines.push('## Integration Rules');
    lines.push('');
    const edgesBySource = new Map<string, typeof data.edges>();
    for (const edge of data.edges) {
      const group = edgesBySource.get(edge.sourceNode) ?? [];
      group.push(edge);
      edgesBySource.set(edge.sourceNode, group);
    }
    for (const [sourceNode, edges] of edgesBySource) {
      const targets = edges.map(e => {
        const transport = e.transport ? `/${e.transport}` : '';
        return `${e.targetNode} (${e.contractKind}${transport})`;
      }).join(', ');
      lines.push(`- When editing **${sourceNode}**: integrates with ${targets}`);
    }
    // Also show inbound for nodes that only receive
    const targetOnly = new Set<string>();
    for (const edge of data.edges) {
      if (!edgesBySource.has(edge.targetNode)) targetOnly.add(edge.targetNode);
    }
    for (const targetNode of targetOnly) {
      const inbound = data.edges.filter(e => e.targetNode === targetNode);
      const sources = inbound.map(e => {
        const transport = e.transport ? `/${e.transport}` : '';
        return `${e.sourceNode} (${e.contractKind}${transport})`;
      }).join(', ');
      lines.push(`- When editing **${targetNode}**: receives from ${sources}`);
    }
    lines.push('');
  }

  // File ownership
  const artifactsByNode = new Map<string, string[]>();
  for (const artifact of data.artifacts) {
    if (!artifact.path) continue;
    if (!artifactsByNode.has(artifact.nodeLabel)) artifactsByNode.set(artifact.nodeLabel, []);
    artifactsByNode.get(artifact.nodeLabel)!.push(artifact.path);
  }

  if (artifactsByNode.size > 0) {
    lines.push('## File Ownership');
    lines.push('');
    for (const [nodeLabel, paths] of artifactsByNode) {
      lines.push(`- **${nodeLabel}**: ${paths.map(p => `\`${p}\``).join(', ')}`);
    }
    lines.push('');
  }

  // Deep context references
  if (data.nodes.length > 0) {
    lines.push('## Deep Context');
    lines.push('');
    lines.push('Per-node architectural context (integrations, requirements, test cases):');
    lines.push('');
    for (const node of data.nodes) {
      const slug = node.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      lines.push(`- @.nodespec/context/${slug}.md`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatAsAgents(data: ProjectExportData): string {
  const lines: string[] = [];
  const stack = extractTechStack(data);
  const topology = extractContainerTopology(data);
  const connections = extractConnectionPatterns(data);
  const constraints = extractConstraints(data);

  // Project overview
  lines.push(`# ${data.meta.projectName}`);
  lines.push('');
  if (data.specification?.vision) {
    lines.push(data.specification.vision);
    lines.push('');
  }

  // Tech stack
  lines.push('## Tech Stack');
  lines.push('');
  if (stack.languages.length > 0) lines.push(`- Languages: ${stack.languages.join(', ')}`);
  if (stack.frameworks.length > 0) lines.push(`- Frameworks: ${stack.frameworks.join(', ')}`);
  if (stack.databases.length > 0) lines.push(`- Databases: ${stack.databases.join(', ')}`);
  if (stack.deploymentTarget) lines.push(`- Deployment: ${stack.deploymentTarget}`);
  if (stack.architecturePattern && stack.architecturePattern !== 'unknown') {
    lines.push(`- Architecture: ${stack.architecturePattern}`);
  }
  lines.push('');

  // Architecture topology (compact container hierarchy)
  lines.push('## Architecture');
  lines.push('');
  if (topology.length > 0) {
    const childNodes = data.nodes.filter(n => n.parentId);
    for (const container of topology) {
      const tech = container.technology ? ` [${container.technology}]` : '';
      lines.push(`- **${container.label}**${tech} (${container.type})`);
      const children = childNodes.filter(c => c.parentId === container.id);
      for (const child of children) {
        const childTech = child.technology ? ` [${child.technology}]` : '';
        lines.push(`  - ${child.label}${childTech} (${child.type})`);
      }
    }
    const orphanChildren = childNodes.filter(c => !topology.some(t => t.id === c.parentId));
    for (const orphan of orphanChildren) {
      const tech = orphan.technology ? ` [${orphan.technology}]` : '';
      lines.push(`- ${orphan.label}${tech} (${orphan.type})`);
    }
    lines.push('');
  }

  // Integration contracts (no inline JSON schemas)
  if (connections.length > 0) {
    lines.push('## Integration Contracts');
    lines.push('');
    for (const conn of connections) {
      lines.push(`- ${conn}`);
    }
    lines.push('');
  }

  // Components -- per-node task context
  if (data.nodes.length > 0) {
    lines.push('## Components');
    lines.push('');
    for (const node of data.nodes) {
      const tech = node.technology ? ` [${node.technology}]` : '';
      lines.push(`### ${node.label}${tech}`);
      lines.push('');
      lines.push(`Role: ${node.type}${node.deploymentTarget ? ` | Deployment: ${node.deploymentTarget}` : ''}`);

      // Integrations
      const inEdges = data.edges.filter(e => e.targetId === node.id);
      const outEdges = data.edges.filter(e => e.sourceId === node.id);
      if (inEdges.length > 0 || outEdges.length > 0) {
        const parts: string[] = [];
        for (const e of inEdges) {
          const transport = e.transport ? `/${e.transport}` : '';
          parts.push(`<- ${e.sourceNode} (${e.contractKind}${transport})`);
        }
        for (const e of outEdges) {
          const transport = e.transport ? `/${e.transport}` : '';
          parts.push(`-> ${e.targetNode} (${e.contractKind}${transport})`);
        }
        lines.push(`Integrations: ${parts.join(', ')}`);
      }

      // Key files
      const nodeArtifacts = data.artifacts.filter(a => a.nodeId === node.id && a.path);
      if (nodeArtifacts.length > 0) {
        lines.push(`Files: ${nodeArtifacts.map(a => `\`${a.path}\``).join(', ')}`);
      }

      // Linked requirements
      const linkedReqs = (data.specification?.requirements ?? []).filter(
        r => (r.sectionName ?? '') === node.label,
      );
      if (linkedReqs.length > 0) {
        lines.push(`Requirements: ${linkedReqs.map(r => r.name).join(', ')}`);
      }

      if (node.rationale) {
        lines.push(`Rationale: ${node.rationale}`);
      }
      lines.push('');
    }
  }

  // Constraints and decisions
  if (constraints.length > 0) {
    lines.push('## Constraints');
    lines.push('');
    for (const c of constraints) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  // Testing instructions
  const testFrameworks = new Set<string>();
  for (const tc of data.testSuite ?? []) {
    if (tc.framework) testFrameworks.add(tc.framework);
  }
  if (testFrameworks.size > 0 || (data.testSuite ?? []).length > 0) {
    lines.push('## Testing');
    lines.push('');
    if (testFrameworks.size > 0) {
      lines.push(`Frameworks: ${[...testFrameworks].join(', ')}`);
    }
    lines.push(`Test cases: ${(data.testSuite ?? []).length}`);
    lines.push('');
  }

  // Requirements summary (compact)
  if (data.specification?.requirements && data.specification.requirements.length > 0) {
    lines.push('## Requirements');
    lines.push('');
    for (const req of data.specification.requirements) {
      const unmetCount = req.acceptanceCriteria.filter(ac => !ac.met).length;
      const statusTag = unmetCount > 0 ? ` [${unmetCount} unmet]` : ' [done]';
      lines.push(`- **${req.name}** (${req.category})${statusTag}: ${req.description}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`Generated by NodeSpec | ${data.meta.nodeCount} nodes, ${data.meta.edgeCount} edges, ${data.meta.contractCount} contracts`);
  lines.push('');

  return lines.join('\n');
}

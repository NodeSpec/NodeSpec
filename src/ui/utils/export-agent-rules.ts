// The THREE agent files: CLAUDE.md, AGENTS.md and .cursor/rules/nodespec.mdc.
//
// 9.13 (owner review): they had drifted into carrying different DATA when the
// only thing that should differ is the MECHANISM each tool reads them by.
// CLAUDE.md alone listed open work, and only the first unmet criterion of
// each requirement. AGENTS.md alone carried the tech stack, and reduced the
// criteria to an "[n unmet]" tag. Cursor's rules carried no open work at all.
// An agent's answer to "what am I building, and how do I know it is done"
// therefore depended on which tool the reader happened to be.
//
// One core, three renderings. The core is what any coding agent needs:
//
//   what it is · the stack · the architecture and how it connects ·
//   the constraints that bind · the OPEN WORK, with every unmet acceptance
//   criterion in full · which node owns which files · where deeper context is
//
// What legitimately differs is HOW each file is read:
//
//   CLAUDE.md  read whole, every session, and supports @import, so its deep
//              context is a list of imports the reader actually follows.
//   AGENTS.md  read by ~20 tools with no import mechanism, so it is the
//              self-contained one: per-component detail is inline.
//   Cursor     auto-attached by glob WHILE a file is being edited, so it is
//              the terse one: directives, not documentation, and it points at
//              the context directory rather than listing every file in it.
//
// The human-facing document is Specification.md (export-specification.ts).
// It is the only one that carries MET criteria, test coverage and progress
// tables, because those answer "where are we", which is a question a reader
// asks and an agent does not.
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

/** A requirement with work left on it, and EVERY criterion still unmet.
 *  This is the one thing an agent cannot infer from the architecture: what
 *  "done" means for the thing it is being asked to build. All three files
 *  carry it, in full, because a truncated list of criteria is worse than
 *  none — it reads as complete. */
export interface OpenRequirement {
  requirementId: string;
  name: string;
  description: string;
  category: string;
  /** The node it is filed under, when it is filed. */
  sectionName?: string;
  unmet: string[];
  metCount: number;
  totalCount: number;
}

export function extractOpenWork(data: ProjectExportData): OpenRequirement[] {
  return (data.specification?.requirements ?? [])
    .map((r) => ({
      requirementId: r.requirementId,
      name: r.name,
      description: r.description,
      category: r.category,
      sectionName: r.sectionName,
      unmet: r.acceptanceCriteria.filter((ac) => !ac.met).map((ac) => ac.text),
      metCount: r.acceptanceCriteria.filter((ac) => ac.met).length,
      totalCount: r.acceptanceCriteria.length,
    }))
    .filter((r) => r.unmet.length > 0);
}

/** node label → the paths it owns. Shared by all three files. */
export function extractFileOwnership(data: ProjectExportData): Map<string, string[]> {
  const byNode = new Map<string, string[]>();
  for (const artifact of data.artifacts) {
    if (!artifact.path) continue;
    if (!byNode.has(artifact.nodeLabel)) byNode.set(artifact.nodeLabel, []);
    byNode.get(artifact.nodeLabel)!.push(artifact.path);
  }
  return byNode;
}

/** The stack, as one line. */
function stackLine(stack: ReturnType<typeof extractTechStack>): string | null {
  const parts: string[] = [];
  if (stack.languages.length > 0) parts.push(stack.languages.join(', '));
  if (stack.frameworks.length > 0) parts.push(stack.frameworks.join(', '));
  if (stack.databases.length > 0) parts.push(stack.databases.join(', '));
  if (parts.length === 0 && !stack.deploymentTarget) return null;
  return `${parts.join(' | ')}${stack.deploymentTarget ? `${parts.length ? ' | ' : ''}Deploy: ${stack.deploymentTarget}` : ''}`;
}

/** The Open Work section, rendered the same way wherever it appears. A
 *  checkbox per unmet criterion: an agent can tick them off, and the next
 *  export regenerates the list from the criteria themselves. */
function openWorkSection(open: OpenRequirement[]): string[] {
  if (open.length === 0) return [];
  const lines: string[] = [];
  lines.push('## Open Work');
  lines.push('');
  lines.push('Each requirement below has acceptance criteria that are not met yet. A criterion is the definition of done -- treat the wording as exact.');
  lines.push('');
  for (const r of open) {
    lines.push(`### ${r.requirementId} -- ${r.name}${r.sectionName ? ` (${r.sectionName})` : ''}`);
    lines.push('');
    if (r.description) {
      lines.push(r.description);
      lines.push('');
    }
    for (const text of r.unmet) lines.push(`- [ ] ${text}`);
    if (r.metCount > 0) lines.push(`- ${r.metCount} of ${r.totalCount} criteria already met.`);
    lines.push('');
  }
  return lines;
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
  const stack = stackLine(extractTechStack(data));
  const open = extractOpenWork(data);

  const vision = data.specification?.vision ?? '';
  lines.push(`# ${data.meta.projectName}`);
  lines.push('');
  // The vision in FULL, not its first sentence. Truncating at the first
  // period cut the half of it that said what the product is for.
  if (vision) {
    lines.push(vision);
    lines.push('');
  }
  if (stack) {
    lines.push(`**Stack:** ${stack}`);
    lines.push('');
  }

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

  // Was "## Tasks", and it printed the FIRST unmet criterion of each
  // requirement and dropped the rest — an agent read it as the whole job.
  lines.push(...openWorkSection(open));

  const artifactsByNode = extractFileOwnership(data);

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
  const open = extractOpenWork(data);

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
  const compactStack = stackLine(stack);
  if (compactStack) {
    lines.push(`**Stack:** ${compactStack}`);
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
  const artifactsByNode = extractFileOwnership(data);

  if (artifactsByNode.size > 0) {
    lines.push('## File Ownership');
    lines.push('');
    for (const [nodeLabel, paths] of artifactsByNode) {
      lines.push(`- **${nodeLabel}**: ${paths.map(p => `\`${p}\``).join(', ')}`);
    }
    lines.push('');
  }

  // 9.13: this file is attached by glob WHILE a file is being edited, so it
  // carries the open work in its terse form — the criterion text, which is
  // what the edit has to satisfy, without the per-requirement prose that the
  // other two files have room for.
  if (open.length > 0) {
    lines.push('## Open Work');
    lines.push('');
    lines.push('Unmet acceptance criteria. Treat the wording as exact.');
    lines.push('');
    for (const r of open) {
      lines.push(`- **${r.requirementId} ${r.name}**${r.sectionName ? ` (${r.sectionName})` : ''}`);
      for (const text of r.unmet) lines.push(`  - [ ] ${text}`);
    }
    lines.push('');
  }

  // Deep context: a POINTER, not a listing. Cursor re-reads this file on
  // every matching edit, and one line per node turned a rules file into a
  // directory index.
  if (data.nodes.length > 0) {
    lines.push('## Deep Context');
    lines.push('');
    lines.push(`Per-node architectural context for all ${data.nodes.length} components is in \`.nodespec/context/\` (one file per node, slugged from its label).`);
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
  const open = extractOpenWork(data);

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

  // 9.13: the requirement list used to reduce every criterion to a count —
  // "[3 unmet]" told an agent that work remained and nothing about what it
  // was. The open work now carries the criteria; the settled requirements
  // stay as a one-line roll so the agent knows what is already proved and
  // does not redo it.
  lines.push(...openWorkSection(open));

  const settled = (data.specification?.requirements ?? []).filter(
    (r) => r.acceptanceCriteria.length > 0 && r.acceptanceCriteria.every((ac) => ac.met),
  );
  if (settled.length > 0) {
    lines.push('## Met Requirements');
    lines.push('');
    lines.push('Already proved. Do not rebuild these; changing them means changing their criteria first.');
    lines.push('');
    for (const req of settled) {
      lines.push(`- **${req.requirementId} ${req.name}** (${req.category}): ${req.description}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`Generated by NodeSpec | ${data.meta.nodeCount} nodes, ${data.meta.edgeCount} edges, ${data.meta.contractCount} contracts`);
  lines.push('');

  return lines.join('\n');
}

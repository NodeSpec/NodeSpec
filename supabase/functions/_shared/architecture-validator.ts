import { ToolContext, GraphNode, GraphState } from "./tool-executor.ts";
import type { CatalogData } from "./catalog-loader.ts";
import { getRoleDefinition, getRolesWithCapability, isContainerTechnologyMismatch, canContainerAcceptChild } from "./role-registry.ts";

export interface ValidationIssue {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  nodeIds?: string[];
}

export interface ValidationReport {
  issues: ValidationIssue[];
  nodeCount: number;
  edgeCount: number;
  containerCount: number;
  orphanCount: number;
}

interface SpecContext {
  vision: string;
  preferences: Record<string, unknown>;
  constraints: Array<{ type: string; description: string }>;
  requirements?: Array<{
    id: string;
    requirement_id: string;
    name: string;
    category: string;
  }>;
}

function isContainer(catalogs: CatalogData | undefined, nodeType: string): boolean {
  if (!catalogs) return false;
  const role = getRoleDefinition(catalogs, nodeType);
  return role?.isContainer ?? false;
}

function getChildren(graph: GraphState, parentId: string): GraphNode[] {
  return Object.values(graph.nodes).filter(n => n.parentId === parentId);
}

function getAllDescendants(graph: GraphState, containerId: string): Set<string> {
  const descendants = new Set<string>();
  const queue = [containerId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const n of Object.values(graph.nodes)) {
      if (n.parentId === current && !descendants.has(n.id)) {
        descendants.add(n.id);
        queue.push(n.id);
      }
    }
  }
  return descendants;
}

function getTopLevelNodes(graph: GraphState): GraphNode[] {
  return Object.values(graph.nodes).filter(n => !n.parentId);
}

function hasDeploymentSignal(spec: SpecContext): boolean {
  const prefs = spec.preferences || {};
  if (prefs.deploymentTarget) return true;

  const constraintText = (spec.constraints || []).map(c => `${c.type} ${c.description}`).join(' ').toLowerCase();
  return /\b(aws|azure|gcp|cloud|kubernetes|k8s|docker|deploy|host)\b/.test(constraintText);
}

function isWebApplication(spec: SpecContext): boolean {
  const text = `${spec.vision} ${(spec.constraints || []).map(c => c.description).join(' ')}`.toLowerCase();
  return /\b(web\s*(app|application|site|platform|portal)|spa|frontend|user\s*interface|ui)\b/.test(text);
}

export function runStructuralValidation(
  graph: GraphState,
  catalogs: CatalogData | undefined,
  spec: SpecContext
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const nodes = Object.values(graph.nodes);
  const edges = Object.values(graph.edges);

  const containers = nodes.filter(n => isContainer(catalogs, n.type));
  const infraContainers = containers.filter(n => {
    const role = catalogs ? getRoleDefinition(catalogs, n.type) : null;
    return role?.containerLayer === 'infrastructure' || role?.containerLayer === 'orchestration';
  });
  const logicalBoundaries = containers.filter(n => {
    const role = catalogs ? getRoleDefinition(catalogs, n.type) : null;
    return role?.containerLayer === 'logical';
  });
  const topLevel = getTopLevelNodes(graph);

  const emptyContainers = containers.filter(c => getChildren(graph, c.id).length === 0);
  for (const c of emptyContainers) {
    issues.push({
      severity: 'error',
      rule: 'no-empty-containers',
      message: `Container "${c.label}" (${c.type}) has no children. Either populate it or remove it.`,
      nodeIds: [c.id],
    });
  }

  if (catalogs) {
    for (const node of nodes) {
      if (!node.parentId) continue;
      const parent = graph.nodes[node.parentId];
      if (!parent) continue;
      const check = canContainerAcceptChild(catalogs, parent.type, node.type, node.technology, parent.technology);
      if (!check.allowed) {
        issues.push({
          severity: 'error',
          rule: 'containment-mismatch',
          message: `Node "${node.label}" (${node.type}) is inside "${parent.label}" (${parent.type}), which cannot contain it. Move it to an appropriate container or unparent it.`,
          nodeIds: [node.id, parent.id],
        });
      }
    }
  }

  if (infraContainers.length > 0) {
    const orphanBoundaries = logicalBoundaries.filter(lb => !lb.parentId);
    for (const lb of orphanBoundaries) {
      issues.push({
        severity: 'error',
        rule: 'boundaries-inside-infrastructure',
        message: `Logical boundary "${lb.label}" is a top-level orphan but infrastructure containers exist. It should be nested inside an infrastructure container.`,
        nodeIds: [lb.id],
      });
    }
  }

  const primaryNodes = nodes.filter(n => !isContainer(catalogs, n.type));
  const orphanPrimary = primaryNodes.filter(n => !n.parentId);
  if (orphanPrimary.length > 0 && containers.length > 0) {
    for (const n of orphanPrimary) {
      issues.push({
        severity: 'warning',
        rule: 'no-orphan-primary-nodes',
        message: `Primary node "${n.label}" (${n.type}) is not inside any container or boundary.`,
        nodeIds: [n.id],
      });
    }
  }

  if (isWebApplication(spec)) {
    const clientFacingRoles = catalogs
      ? new Set(getRolesWithCapability(catalogs, 'client-facing'))
      : new Set(['frontend-app', 'static-site', 'mobile-app']);
    const hasFrontend = nodes.some(n => clientFacingRoles.has(n.type));
    if (!hasFrontend) {
      issues.push({
        severity: 'error',
        rule: 'web-app-needs-frontend',
        message: 'This is a web application but no frontend or client-facing component exists.',
      });
    }
  }

  const dataStoreRoles = catalogs
    ? new Set(getRolesWithCapability(catalogs, 'data-store'))
    : new Set(['database', 'graph-db', 'time-series-db']);
  const dbNodes = nodes.filter(n => dataStoreRoles.has(n.type));
  for (const db of dbNodes) {
    const hasIncoming = edges.some(e => e.target === db.id);
    if (!hasIncoming) {
      issues.push({
        severity: 'warning',
        rule: 'database-reachable',
        message: `Database "${db.label}" has no incoming edges -- no service connects to it.`,
        nodeIds: [db.id],
      });
    }
  }

  const connectedNodeIds = new Set<string>();
  for (const e of edges) {
    connectedNodeIds.add(e.source);
    connectedNodeIds.add(e.target);
  }
  const disconnectedPrimary = primaryNodes.filter(n => !connectedNodeIds.has(n.id));
  for (const n of disconnectedPrimary) {
    issues.push({
      severity: 'error',
      rule: 'node-connectivity',
      message: `Node "${n.label}" (${n.type}) has zero edges -- it is completely disconnected from the rest of the architecture. Every component must have at least one runtime connection.`,
      nodeIds: [n.id],
    });
  }

  for (const boundary of logicalBoundaries) {
    const descendants = getAllDescendants(graph, boundary.id);
    if (descendants.size === 0) continue;
    const hasCrossingEdge = edges.some(e => {
      const srcInside = descendants.has(e.source);
      const tgtInside = descendants.has(e.target);
      return srcInside !== tgtInside;
    });
    if (!hasCrossingEdge) {
      issues.push({
        severity: 'error',
        rule: 'boundary-integration',
        message: `Boundary "${boundary.label}" (${boundary.type}) has ${descendants.size} children but no edges cross its boundary. At least one edge must connect an internal node to an external node so the boundary is not functionally isolated.`,
        nodeIds: [boundary.id],
      });
    }
  }

  if (hasDeploymentSignal(spec) && infraContainers.length === 0) {
    issues.push({
      severity: 'warning',
      rule: 'deployment-signal-no-infrastructure',
      message: `The specification mentions deployment/hosting but no infrastructure containers were created.`,
    });
  }

  const deploymentTarget = String(spec.preferences?.deploymentTarget || '').toLowerCase();
  if (deploymentTarget) {
    const providerKeywords: Record<string, string[]> = {
      aws: ['aws', 'amazon'],
      azure: ['azure', 'microsoft'],
      gcp: ['gcp', 'google cloud', 'google'],
    };

    let detectedProvider = '';
    for (const [provider, keywords] of Object.entries(providerKeywords)) {
      if (keywords.some(k => deploymentTarget.includes(k))) {
        detectedProvider = provider;
        break;
      }
    }

    if (detectedProvider) {
      const genericTechs: Record<string, string> = {
        nginx: 'load balancer',
        haproxy: 'load balancer',
        'self-hosted-db': 'database',
      };

      for (const node of nodes) {
        if (node.technology && genericTechs[node.technology]) {
          issues.push({
            severity: 'warning',
            rule: 'prefer-provider-native-tech',
            message: `Node "${node.label}" uses generic technology "${node.technology}" for ${genericTechs[node.technology]}, but deployment target is ${detectedProvider.toUpperCase()}. Consider using a provider-native managed service instead.`,
            nodeIds: [node.id],
          });
        }
      }
    }
  }

  if (catalogs) {
    for (const node of containers) {
      if (node.technology) {
        const check = isContainerTechnologyMismatch(catalogs, node.technology, node.type);
        if (check.mismatch) {
          issues.push({
            severity: 'error',
            rule: 'container-technology-mismatch',
            message: `Container "${node.label}" (${node.type}) has leaf-service technology "${node.technology}" assigned. ${check.suggestion || 'Remove the technology or use a cloud provider identifier (aws, azure, gcp).'}`,
            nodeIds: [node.id],
          });
        }
      }
    }
  }

  return {
    issues,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    containerCount: containers.length,
    orphanCount: orphanPrimary.length,
  };
}

export function buildValidationPrompt(
  graph: GraphState,
  report: ValidationReport,
  spec: SpecContext
): string {
  const nodes = Object.values(graph.nodes);
  const edges = Object.values(graph.edges);

  const nodeLines = nodes.map(n => {
    const parent = n.parentId ? `, parent: "${graph.nodes[n.parentId]?.label || n.parentId}"` : ', parent: NONE';
    const tech = n.technology ? `, tech: ${n.technology}` : '';
    const feat = n.metadata?.featureId ? ` [${n.metadata.featureId}]` : '';
    return `  - "${n.label}" (role: ${n.type}${tech}${parent})${feat}`;
  }).join('\n');

  const edgeLines = edges.map(e => {
    const src = graph.nodes[e.source];
    const tgt = graph.nodes[e.target];
    const contract = graph.contracts[e.contractId];
    return `  - "${src?.label || '?'}" -> "${tgt?.label || '?'}" via "${contract?.name || '?'}"`;
  }).join('\n');

  const issueLines = report.issues.map(i => {
    const affectedNodes = i.nodeIds?.map(id => graph.nodes[id]?.label || id).join(', ') || '';
    return `  [${i.severity.toUpperCase()}] ${i.rule}: ${i.message}${affectedNodes ? ` (nodes: ${affectedNodes})` : ''}`;
  }).join('\n');

  const prefs = spec.preferences || {};
  const deployTarget = prefs.deploymentTarget ? `Deployment Target: ${prefs.deploymentTarget}` : '';
  const constraintLines = (spec.constraints || []).map(c => `  - [${c.type}] ${c.description}`).join('\n');

  return `You are an architecture quality reviewer. An AI architect has just generated the architecture below. Your job is to fix structural problems identified by automated validation.

PROJECT CONTEXT:
Vision: ${spec.vision}
${deployTarget}
${constraintLines ? `Constraints:\n${constraintLines}` : ''}

GENERATED ARCHITECTURE (${nodes.length} nodes, ${edges.length} edges):
Nodes:
${nodeLines || '  (none)'}

Edges:
${edgeLines || '  (none)'}

VALIDATION ISSUES FOUND (${report.issues.length}):
${issueLines || '  No issues found.'}

YOUR TASK:
Review each issue and make the minimum corrective tool calls to fix them. Follow these rules:
1. For "no-empty-containers": Either use set_parent to move appropriate nodes into the empty container, or use remove_node to delete it.
2. For "boundaries-inside-infrastructure": Use set_parent to move the orphan boundary into the appropriate infrastructure container.
3. For "no-orphan-primary-nodes": Use set_parent to move orphan nodes into the most appropriate existing boundary.
4. For "web-app-needs-frontend": Use add_node to create a frontend-app or static-site component.
5. For "database-reachable": Use add_edge to connect the database to the service that should use it.
6. For "deployment-signal-no-infrastructure": Create appropriate infrastructure containers (a platform container like aws, azure, or gcp, or a vpc) and nest existing boundaries inside them.
7. For "prefer-provider-native-tech": Use update_node to change the technology to the provider's native equivalent.
8. For "container-technology-mismatch": Use update_node to change the technology to a valid cloud provider identifier (aws, azure, gcp) or remove it. Platform and infrastructure containers (aws, azure, gcp, vpc) should use the cloud provider technology, NOT leaf-service technologies like sqs, aurora, or postgresql.
9. For "containment-mismatch": Use set_parent to move the node to a valid container. Only set parentLabel to "null" as a LAST RESORT when no valid container exists. Browser-deployed apps (frontend-app, static-site, mobile-app) do not run inside VPCs or Kubernetes clusters -- place them inside a platform container (aws, azure, gcp) or a logical boundary instead. Logical boundaries (microservice-boundary, bounded-context, application-module, software-layer) CAN be nested inside hosting containers (docker-compose, k8s-cluster, vpc, etc.).
10. For "node-connectivity": Use add_edge to connect the isolated node to the service, entry point, or data store it logically communicates with. Every non-container node must have at least one edge (incoming or outgoing). Think about what this component does at runtime -- a database receives queries from a service, a backend calls an API gateway, a frontend calls a backend. Create the edge that represents that runtime communication.
11. For "boundary-integration": Use add_edge to create at least one cross-boundary edge connecting a node inside the boundary to a node outside it. Identify which internal service exposes an API or consumes an external dependency, then connect it to the appropriate external node (e.g., an API gateway, a frontend, a shared database, or another boundary's service).

CONSTRAINTS:
- Make the MINIMUM changes needed. Do not redesign the architecture.
- Do not remove nodes that have children or edges unless replacing them.
- Do not create duplicate nodes.
- Preserve all existing edges and contracts.
- NEVER unparent a node (set_parent with parentLabel "null") as a fix for boundary-integration, node-connectivity, or no-empty-containers errors. Those rules require add_edge or set_parent to a VALID container -- not orphaning.
- When a logical boundary exists inside an infrastructure container and its children need deployment hosting, nest the logical boundary inside the hosting container rather than moving individual children out of the boundary.
- If there are no issues, respond with a brief confirmation that the architecture passed validation.`;
}

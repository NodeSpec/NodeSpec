import type { Graph, Node } from './types.js';
import type { Requirement, RequirementMapping } from './specification.js';

export interface PersistedRequirement extends Requirement {
  id: string;
  specificationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedRequirementMapping extends RequirementMapping {
  id: string;
  specificationId: string;
  createdAt: string;
  createdBy: string | null;
}

export interface DriftIssue {
  type: 'orphaned_requirement' | 'unmapped_node' | 'incomplete_requirement' | 'deleted_node' | 'user_extension';
  severity: 'critical' | 'warning' | 'info';
  requirementId?: string;
  nodeId?: string;
  message: string;
  suggestedAction?: string;
  confidence?: number;
}

export interface DriftReport {
  driftScore: number;
  totalIssues: number;
  criticalIssues: number;
  warningIssues: number;
  infoIssues: number;
  issues: DriftIssue[];
  summary: string;
  timestamp: string;
}

export interface DriftMetrics {
  orphanedRequirements: number;
  unmappedNodes: number;
  userExtensionNodes: number;
  requirementsCoverage: number;
  nodesCoverage: number;
  overallHealth: 'healthy' | 'needs-attention' | 'critical';
}

export function detectDrift(
  graph: Graph,
  requirements: PersistedRequirement[],
  mappings: PersistedRequirementMapping[]
): DriftReport {
  const issues: DriftIssue[] = [];
  const timestamp = new Date().toISOString();

  const mappingsByRequirement = new Map<string, PersistedRequirementMapping[]>();
  const mappingsByNode = new Map<string, PersistedRequirementMapping[]>();

  for (const mapping of mappings) {
    if (mapping.requirementId) {
      if (!mappingsByRequirement.has(mapping.requirementId)) {
        mappingsByRequirement.set(mapping.requirementId, []);
      }
      mappingsByRequirement.get(mapping.requirementId)!.push(mapping);
    }

    if (!mappingsByNode.has(mapping.nodeId)) {
      mappingsByNode.set(mapping.nodeId, []);
    }
    mappingsByNode.get(mapping.nodeId)!.push(mapping);
  }

  for (const requirement of requirements) {
    const reqMappings = mappingsByRequirement.get(requirement.id) || [];

    if (reqMappings.length === 0) {
      issues.push({
        type: 'orphaned_requirement',
        severity: 'warning',
        requirementId: requirement.id,
        message: `Requirement "${requirement.name}" (${requirement.requirementId}) has no implementing nodes`,
        suggestedAction: 'Create nodes to implement this requirement or remove if no longer needed',
      });
    }

    const nodeIds = reqMappings.map(m => m.nodeId);
    const existingNodes = nodeIds.filter(nodeId => graph.nodes[nodeId]);

    if (requirement.status === 'implemented' && existingNodes.length === 0) {
      issues.push({
        type: 'incomplete_requirement',
        severity: 'critical',
        requirementId: requirement.id,
        message: `Requirement "${requirement.name}" is marked as implemented but has no nodes`,
        suggestedAction: 'Update requirement status to pending or restore implementing nodes',
      });
    }

    if (existingNodes.length < nodeIds.length) {
      const deletedCount = nodeIds.length - existingNodes.length;
      issues.push({
        type: 'deleted_node',
        severity: 'warning',
        requirementId: requirement.id,
        message: `Requirement "${requirement.name}" had ${deletedCount} implementing node(s) deleted`,
        suggestedAction: 'Update requirement status or create replacement nodes',
      });
    }
  }

  const graphNodeIds = Object.keys(graph.nodes);
  for (const nodeId of graphNodeIds) {
    const node = graph.nodes[nodeId];
    const nodeMappings = mappingsByNode.get(nodeId) || [];

    if (nodeMappings.length === 0) {
      const isUserExtension = node.metadata?.userAdded === true || node.metadata?.specificationGenerated === false;

      if (isUserExtension) {
        issues.push({
          type: 'user_extension',
          severity: 'info',
          nodeId,
          message: `Node "${node.label}" is a user extension not linked to any requirement`,
          suggestedAction: 'Link to existing requirement or create new requirement for this functionality',
          confidence: 0.7,
        });
      } else {
        issues.push({
          type: 'unmapped_node',
          severity: 'warning',
          nodeId,
          message: `Node "${node.label}" is not mapped to any requirement`,
          suggestedAction: 'Create mapping to relevant requirement',
        });
      }
    }
  }

  const criticalIssues = issues.filter(i => i.severity === 'critical').length;
  const warningIssues = issues.filter(i => i.severity === 'warning').length;
  const infoIssues = issues.filter(i => i.severity === 'info').length;

  const totalElements = requirements.length + graphNodeIds.length;
  const driftScore = totalElements > 0 ? (issues.filter(i => i.severity !== 'info').length / totalElements) * 100 : 0;

  const summary = generateDriftSummary(driftScore, criticalIssues, warningIssues, infoIssues);

  return {
    driftScore: Math.min(driftScore, 100),
    totalIssues: issues.length,
    criticalIssues,
    warningIssues,
    infoIssues,
    issues,
    summary,
    timestamp,
  };
}

export function calculateDriftMetrics(
  graph: Graph,
  requirements: PersistedRequirement[],
  mappings: PersistedRequirementMapping[]
): DriftMetrics {
  const mappingsByRequirement = new Map<string, PersistedRequirementMapping[]>();
  const mappingsByNode = new Map<string, PersistedRequirementMapping[]>();

  for (const mapping of mappings) {
    if (mapping.requirementId) {
      if (!mappingsByRequirement.has(mapping.requirementId)) {
        mappingsByRequirement.set(mapping.requirementId, []);
      }
      mappingsByRequirement.get(mapping.requirementId)!.push(mapping);
    }

    if (!mappingsByNode.has(mapping.nodeId)) {
      mappingsByNode.set(mapping.nodeId, []);
    }
    mappingsByNode.get(mapping.nodeId)!.push(mapping);
  }

  const orphanedRequirements = requirements.filter(
    req => (mappingsByRequirement.get(req.id) || []).length === 0
  ).length;

  const graphNodeIds = Object.keys(graph.nodes);
  let unmappedNodes = 0;
  let userExtensionNodes = 0;

  for (const nodeId of graphNodeIds) {
    const node = graph.nodes[nodeId];
    const nodeMappings = mappingsByNode.get(nodeId) || [];

    if (nodeMappings.length === 0) {
      if (node.metadata?.userAdded === true || node.metadata?.specificationGenerated === false) {
        userExtensionNodes++;
      } else {
        unmappedNodes++;
      }
    }
  }

  const requirementsCoverage = requirements.length > 0
    ? ((requirements.length - orphanedRequirements) / requirements.length) * 100
    : 100;

  const nodesCoverage = graphNodeIds.length > 0
    ? ((graphNodeIds.length - unmappedNodes - userExtensionNodes) / graphNodeIds.length) * 100
    : 100;

  const overallDrift = 100 - ((requirementsCoverage + nodesCoverage) / 2);

  let overallHealth: 'healthy' | 'needs-attention' | 'critical';
  if (overallDrift < 10) {
    overallHealth = 'healthy';
  } else if (overallDrift < 30) {
    overallHealth = 'needs-attention';
  } else {
    overallHealth = 'critical';
  }

  return {
    orphanedRequirements,
    unmappedNodes,
    userExtensionNodes,
    requirementsCoverage,
    nodesCoverage,
    overallHealth,
  };
}

function generateDriftSummary(
  driftScore: number,
  criticalIssues: number,
  warningIssues: number,
  infoIssues: number
): string {
  if (driftScore < 10) {
    return 'Implementation closely aligned with specification';
  } else if (driftScore < 30) {
    const parts: string[] = [];
    if (criticalIssues > 0) parts.push(`${criticalIssues} critical`);
    if (warningIssues > 0) parts.push(`${warningIssues} warning`);
    if (infoIssues > 0) parts.push(`${infoIssues} info`);
    return `Minor drift detected: ${parts.join(', ')} issue(s)`;
  } else {
    return `Significant drift: ${criticalIssues} critical, ${warningIssues} warning issues need attention`;
  }
}

export interface ReconciliationSuggestion {
  type: 'create_requirement' | 'create_mapping' | 'update_status' | 'create_node';
  priority: 'high' | 'medium' | 'low';
  description: string;
  requirementId?: string;
  nodeId?: string;
  suggestedRequirement?: {
    name: string;
    description: string;
    category: Requirement['category'];
  };
  suggestedMapping?: {
    requirementId: string;
    nodeId: string;
    mappingType: RequirementMapping['mappingType'];
    confidence: number;
  };
  confidence: number;
}

export function generateReconciliationSuggestions(
  driftReport: DriftReport,
  graph: Graph,
  requirements: PersistedRequirement[]
): ReconciliationSuggestion[] {
  const suggestions: ReconciliationSuggestion[] = [];

  for (const issue of driftReport.issues) {
    if (issue.type === 'user_extension' && issue.nodeId) {
      const node = graph.nodes[issue.nodeId];
      if (node) {
        suggestions.push({
          type: 'create_requirement',
          priority: 'medium',
          description: `Create requirement for user-added node "${node.label}"`,
          nodeId: issue.nodeId,
          suggestedRequirement: {
            name: `Support ${node.label}`,
            description: `System should provide ${node.label} functionality as implemented`,
            category: inferCategoryFromNodeType(node.type),
          },
          confidence: 0.75,
        });
      }
    }

    if (issue.type === 'unmapped_node' && issue.nodeId) {
      const node = graph.nodes[issue.nodeId];
      if (node) {
        const matchingReqs = findMatchingRequirements(node, requirements);
        for (const req of matchingReqs.slice(0, 3)) {
          suggestions.push({
            type: 'create_mapping',
            priority: 'high',
            description: `Map "${node.label}" to requirement "${req.requirement.name}"`,
            nodeId: issue.nodeId,
            requirementId: req.requirement.id,
            suggestedMapping: {
              requirementId: req.requirement.id,
              nodeId: issue.nodeId,
              mappingType: 'implements',
              confidence: req.confidence,
            },
            confidence: req.confidence,
          });
        }
      }
    }

    if (issue.type === 'orphaned_requirement' && issue.requirementId) {
      const req = requirements.find(r => r.id === issue.requirementId);
      if (req && req.status !== 'pending') {
        suggestions.push({
          type: 'update_status',
          priority: 'medium',
          description: `Update requirement "${req.name}" status to pending since it has no implementing nodes`,
          requirementId: issue.requirementId,
          confidence: 0.9,
        });
      }
    }
  }

  suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.confidence - a.confidence;
  });

  return suggestions;
}

function inferCategoryFromNodeType(nodeType: string): Requirement['category'] {
  if (nodeType.startsWith('web.') || nodeType.startsWith('frontend.') || nodeType.startsWith('mobile.')) {
    return 'functional';
  }
  if (nodeType.startsWith('database.') || nodeType.startsWith('cache.')) {
    return 'technical';
  }
  if (nodeType.startsWith('auth.') || nodeType.startsWith('monitoring.')) {
    return 'non-functional';
  }
  return 'functional';
}

function findMatchingRequirements(
  node: Node,
  requirements: PersistedRequirement[]
): Array<{ requirement: PersistedRequirement; confidence: number }> {
  const matches: Array<{ requirement: PersistedRequirement; confidence: number }> = [];

  const nodeLabel = node.label.toLowerCase();
  const nodeType = node.type.toLowerCase();

  for (const req of requirements) {
    let confidence = 0;

    const reqName = req.name.toLowerCase();
    const reqDesc = req.description.toLowerCase();

    if (reqName.includes(nodeLabel) || nodeLabel.includes(reqName.split(' ')[0])) {
      confidence += 0.4;
    }

    if (reqDesc.includes(nodeLabel)) {
      confidence += 0.3;
    }

    const nodeWords = nodeLabel.split(/[\s-_]+/);
    const reqWords = reqName.split(/[\s-_]+/);
    const commonWords = nodeWords.filter(w => w.length > 3 && reqWords.includes(w));
    confidence += commonWords.length * 0.1;

    if (nodeType.includes('api') && (reqDesc.includes('api') || reqDesc.includes('endpoint'))) {
      confidence += 0.2;
    }
    if (nodeType.includes('database') && (reqDesc.includes('store') || reqDesc.includes('persist'))) {
      confidence += 0.2;
    }
    if (nodeType.includes('auth') && (reqDesc.includes('auth') || reqDesc.includes('login'))) {
      confidence += 0.3;
    }

    if (confidence > 0.3) {
      matches.push({ requirement: req, confidence: Math.min(confidence, 1.0) });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

export function shouldTriggerDriftDetection(patchCount: number, lastDetectionTime: Date | null): boolean {
  if (!lastDetectionTime) {
    return patchCount >= 5;
  }

  const timeSinceLastDetection = Date.now() - lastDetectionTime.getTime();
  const twoMinutes = 2 * 60 * 1000;

  return patchCount >= 5 || timeSinceLastDetection >= twoMinutes;
}

export interface DriftSnapshot {
  timestamp: string;
  driftScore: number;
  totalIssues: number;
  criticalIssues: number;
  warningIssues: number;
  infoIssues: number;
  summary: string;
  issues: DriftIssue[];
}

export function createDriftSnapshot(driftReport: DriftReport): DriftSnapshot {
  return {
    timestamp: driftReport.timestamp,
    driftScore: driftReport.driftScore,
    totalIssues: driftReport.totalIssues,
    criticalIssues: driftReport.criticalIssues,
    warningIssues: driftReport.warningIssues,
    infoIssues: driftReport.infoIssues,
    summary: driftReport.summary,
    issues: driftReport.issues,
  };
}

export function addDriftSnapshotToMetadata(
  specificationMetadata: Record<string, any>,
  snapshot: DriftSnapshot,
  maxSnapshots: number = 50
): Record<string, any> {
  const driftHistory = (specificationMetadata.driftHistory || []) as DriftSnapshot[];

  const updatedHistory = [snapshot, ...driftHistory].slice(0, maxSnapshots);

  return {
    ...specificationMetadata,
    driftHistory: updatedHistory,
    lastDriftCheck: snapshot.timestamp,
    currentDriftScore: snapshot.driftScore,
  };
}

export function getDriftHistory(specificationMetadata: Record<string, any>): DriftSnapshot[] {
  return (specificationMetadata.driftHistory || []) as DriftSnapshot[];
}

export function getDriftTrend(
  specificationMetadata: Record<string, any>,
  periodDays: number = 7
): 'improving' | 'stable' | 'degrading' | 'unknown' {
  const history = getDriftHistory(specificationMetadata);

  if (history.length < 2) {
    return 'unknown';
  }

  const cutoffTime = new Date();
  cutoffTime.setDate(cutoffTime.getDate() - periodDays);

  const recentSnapshots = history.filter(
    s => new Date(s.timestamp) >= cutoffTime
  );

  if (recentSnapshots.length < 2) {
    return 'unknown';
  }

  const scores = recentSnapshots.map(s => s.driftScore);
  const avgFirst = scores.slice(0, Math.ceil(scores.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(scores.length / 2);
  const avgLast = scores.slice(Math.floor(scores.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(scores.length / 2);

  const change = avgLast - avgFirst;

  if (Math.abs(change) < 5) {
    return 'stable';
  } else if (change < 0) {
    return 'improving';
  } else {
    return 'degrading';
  }
}

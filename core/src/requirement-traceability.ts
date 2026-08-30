/**
 * Domain logic for Requirements → Features → Nodes → Artifacts traceability
 *
 * This module defines the complete traceability chain that connects
 * business requirements to implementation artifacts, providing full
 * visibility into how requirements are implemented.
 */

export interface RequirementTrace {
  requirementId: string;
  requirement: {
    id: string;
    requirementId: string;
    name: string;
    description: string;
    category: 'functional' | 'non-functional' | 'technical' | 'business';
    status: 'pending' | 'in-progress' | 'implemented' | 'validated' | 'blocked';
    locked: boolean;
  };
  coverageScore: number;
}

export interface NodeTrace {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  mappingType: 'implements' | 'depends_on' | 'validates' | 'supports';
  confidence: number;
  artifacts: ArtifactTrace[];
}

export interface ArtifactTrace {
  artifactId: string;
  name: string;
  type: string;
  status: 'pending' | 'draft' | 'final';
}

export interface TraceabilityMatrix {
  specificationId: string;
  requirements: RequirementTrace[];
  unmappedRequirements: string[];
  orphanedNodes: string[];
  stats: TraceabilityStats;
}

export interface TraceabilityStats {
  totalRequirements: number;
  mappedRequirements: number;
  unmappedRequirements: number;
  partiallyImplemented: number;
  fullyImplemented: number;
  totalNodes: number;
  totalArtifacts: number;
  averageCoverage: number;
  overallHealth: 'critical' | 'warning' | 'good' | 'excellent';
}

export interface ArchitectureGenerationPlan {
  specificationId: string;
  projectId: string;
  requirements: Array<{
    id: string;
    requirementId: string;
    name: string;
    description: string;
  }>;
  existingNodes: Array<{
    id: string;
    label: string;
    nodeType: string;
  }>;
  generationStrategy: 'extend' | 'create-new' | 'hybrid';
}

export interface GeneratedArchitectureResult {
  newNodes: Array<{
    nodeType: string;
    label: string;
    description: string;
    position: { x: number; y: number };
    metadata: Record<string, unknown>;
    artifacts: Array<{
      name: string;
      type: string;
      content?: string;
      language?: string;
    }>;
  }>;
  edges: Array<{
    sourceId: string;
    targetId: string;
    label?: string;
    contractType?: string;
  }>;
  requirementMappings: Array<{
    requirementId: string;
    nodeId: string;
    mappingType: 'implements' | 'supports';
    confidence: number;
  }>;
  rationale: string;
}

/**
 * Calculate coverage score for a requirement based on its implementation
 */
export function calculateRequirementCoverage(trace: RequirementTrace): number {
  return trace.coverageScore;
}

/**
 * Calculate overall traceability health score
 */
export function calculateTraceabilityHealth(stats: TraceabilityStats): TraceabilityStats['overallHealth'] {
  const mappedRatio = stats.totalRequirements > 0
    ? stats.mappedRequirements / stats.totalRequirements
    : 0;

  const implementedRatio = stats.totalRequirements > 0
    ? stats.fullyImplemented / stats.totalRequirements
    : 0;

  if (mappedRatio >= 0.9 && implementedRatio >= 0.7) {
    return 'excellent';
  } else if (mappedRatio >= 0.7 && implementedRatio >= 0.5) {
    return 'good';
  } else if (mappedRatio >= 0.5 && implementedRatio >= 0.3) {
    return 'warning';
  } else {
    return 'critical';
  }
}

/**
 * Validate that a generated architecture plan is sound
 */
export function validateArchitecturePlan(plan: ArchitectureGenerationPlan): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (plan.requirements.length === 0) {
    errors.push('No requirements provided');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Build traceability matrix from components
 */
export function buildTraceabilityMatrix(
  specificationId: string,
  requirements: RequirementTrace['requirement'][],
  mappings: Array<{ requirementId: string; nodeId: string; mappingType: string; confidence: number }>,
  nodes: Array<{ id: string; label: string; nodeType: string }>,
  artifacts: Array<{ id: string; nodeId: string; name: string; type: string; status: string }>
): TraceabilityMatrix {
  const requirementTraces: RequirementTrace[] = [];
  const unmappedRequirements: string[] = [];

  for (const req of requirements) {
    const reqMappings = mappings.filter(m => m.requirementId === req.id);

    if (reqMappings.length === 0) {
      unmappedRequirements.push(req.requirementId);
    }

    const trace: RequirementTrace = {
      requirementId: req.requirementId,
      requirement: req,
      coverageScore: 0,
    };

    trace.coverageScore = calculateRequirementCoverage(trace);
    requirementTraces.push(trace);
  }

  // Calculate stats
  const mappedRequirements = requirementTraces.filter(r => r.coverageScore > 0).length;
  const fullyImplemented = requirementTraces.filter(r => r.coverageScore === 100).length;
  const partiallyImplemented = requirementTraces.filter(r => r.coverageScore > 0 && r.coverageScore < 100).length;

  const totalNodes = new Set(mappings.map(m => m.nodeId)).size;
  const totalArtifacts = artifacts.length;
  const averageCoverage = requirementTraces.length > 0
    ? requirementTraces.reduce((sum, r) => sum + r.coverageScore, 0) / requirementTraces.length
    : 0;

  const stats: TraceabilityStats = {
    totalRequirements: requirements.length,
    mappedRequirements,
    unmappedRequirements: unmappedRequirements.length,
    partiallyImplemented,
    fullyImplemented,
    totalNodes,
    totalArtifacts,
    averageCoverage,
    overallHealth: 'critical',
  };

  stats.overallHealth = calculateTraceabilityHealth(stats);

  // Find orphaned nodes (nodes with mappings but no longer in graph)
  const mappedNodeIds = new Set(mappings.map(m => m.nodeId));
  const actualNodeIds = new Set(nodes.map(n => n.id));
  const orphanedNodes = Array.from(mappedNodeIds).filter(id => !actualNodeIds.has(id));

  return {
    specificationId,
    requirements: requirementTraces,
    unmappedRequirements,
    orphanedNodes,
    stats,
  };
}

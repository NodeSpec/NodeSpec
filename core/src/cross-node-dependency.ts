import type { CodeStructure, CodeRelationship, RelationshipType } from './code-structure.js';
import type { ContractKind } from './types.js';

export interface DetectedEdge {
  sourceNodeId: string;
  targetNodeId: string;
  contractKind: ContractKind;
  confidence: number;
  importCount: number;
  relationshipTypes: RelationshipType[];
  evidence: EdgeEvidence[];
}

export interface EdgeEvidence {
  fromEntity: string;
  toEntity: string;
  relationshipType: RelationshipType;
  artifactPath?: string;
}

export interface DependencyReport {
  projectId: string;
  edges: DetectedEdge[];
  totalRelationshipsAnalyzed: number;
  crossNodeRelationships: number;
  intraNodeRelationships: number;
}

interface GraphSnapshot {
  nodes: Record<string, { id: string; artifacts?: string[] }>;
  artifacts: Record<string, { id: string; nodeId: string; path?: string }>;
}

function buildEntityToNodeIndex(
  codeStructures: CodeStructure[],
  graph: GraphSnapshot,
): { entityToNode: Map<string, string>; entityToArtifactPath: Map<string, string> } {
  const entityToNode = new Map<string, string>();
  const entityToArtifactPath = new Map<string, string>();

  const artifactToNode = new Map<string, string>();
  for (const artifact of Object.values(graph.artifacts)) {
    if (artifact.nodeId) {
      artifactToNode.set(artifact.id, artifact.nodeId);
    }
  }

  for (const cs of codeStructures) {
    const nodeId = cs.nodeId || artifactToNode.get(cs.artifactId);
    if (!nodeId) continue;

    const artifactPath = graph.artifacts[cs.artifactId]?.path || '';

    for (const entity of cs.entities) {
      entityToNode.set(entity.id, nodeId);
      entityToArtifactPath.set(entity.id, artifactPath);
    }
  }

  return { entityToNode, entityToArtifactPath };
}

export function aggregateArtifactRelationships(
  codeStructures: CodeStructure[],
  graph: GraphSnapshot,
): DependencyReport {
  const { entityToNode, entityToArtifactPath } = buildEntityToNodeIndex(codeStructures, graph);

  const edgeMap = new Map<string, {
    sourceNodeId: string;
    targetNodeId: string;
    relationships: CodeRelationship[];
    evidence: EdgeEvidence[];
  }>();

  let totalRelationships = 0;
  let crossNode = 0;
  let intraNode = 0;

  for (const cs of codeStructures) {
    for (const rel of cs.relationships) {
      totalRelationships++;

      const sourceNode = entityToNode.get(rel.from);
      const targetNode = entityToNode.get(rel.to);

      if (!sourceNode || !targetNode) continue;

      if (sourceNode === targetNode) {
        intraNode++;
        continue;
      }

      crossNode++;

      const edgeKey = `${sourceNode}:${targetNode}`;
      let entry = edgeMap.get(edgeKey);
      if (!entry) {
        entry = {
          sourceNodeId: sourceNode,
          targetNodeId: targetNode,
          relationships: [],
          evidence: [],
        };
        edgeMap.set(edgeKey, entry);
      }

      entry.relationships.push(rel);

      if (entry.evidence.length < 5) {
        entry.evidence.push({
          fromEntity: rel.from,
          toEntity: rel.to,
          relationshipType: rel.type,
          artifactPath: entityToArtifactPath.get(rel.from),
        });
      }
    }
  }

  const edges: DetectedEdge[] = [];
  for (const entry of edgeMap.values()) {
    const relationshipTypes = [...new Set(entry.relationships.map(r => r.type))];
    const contractKind = inferContractKind(entry.relationships);
    const confidence = computeEdgeConfidence(entry.relationships.length, relationshipTypes);

    edges.push({
      sourceNodeId: entry.sourceNodeId,
      targetNodeId: entry.targetNodeId,
      contractKind,
      confidence,
      importCount: entry.relationships.length,
      relationshipTypes,
      evidence: entry.evidence,
    });
  }

  edges.sort((a, b) => b.confidence - a.confidence);

  const projectId = codeStructures[0]?.projectId || '';

  return {
    projectId,
    edges,
    totalRelationshipsAnalyzed: totalRelationships,
    crossNodeRelationships: crossNode,
    intraNodeRelationships: intraNode,
  };
}

export function inferContractKind(relationships: CodeRelationship[]): ContractKind {
  const typeCounts: Record<string, number> = {};
  for (const rel of relationships) {
    typeCounts[rel.type] = (typeCounts[rel.type] || 0) + 1;
  }

  const hasImports = (typeCounts['imports'] || 0) > 0;
  const hasCalls = (typeCounts['calls'] || 0) > 0;
  const hasExtends = (typeCounts['extends'] || 0) > 0;
  const hasImplements = (typeCounts['implements'] || 0) > 0;
  const hasComposes = (typeCounts['composes'] || 0) > 0;

  const entityNames = relationships.map(r => r.to.toLowerCase());
  const hasHttpPattern = entityNames.some(n =>
    n.includes('fetch') || n.includes('axios') || n.includes('http') ||
    n.includes('request') || n.includes('endpoint') || n.includes('client')
  );
  const hasEventPattern = entityNames.some(n =>
    n.includes('emit') || n.includes('event') || n.includes('publish') ||
    n.includes('subscribe') || n.includes('listener') || n.includes('handler')
  );
  const hasSqlPattern = entityNames.some(n =>
    n.includes('query') || n.includes('repository') || n.includes('model') ||
    n.includes('schema') || n.includes('migration') || n.includes('prisma') ||
    n.includes('knex') || n.includes('sequelize') || n.includes('typeorm')
  );

  if (hasHttpPattern && hasCalls) return 'rest';
  if (hasEventPattern) return 'kafka';
  if (hasSqlPattern) return 'sql';
  if (hasCalls && !hasImports) return 'ipc';
  if (hasExtends || hasImplements) return 'custom';
  if (hasComposes) return 'custom';

  return 'custom';
}

export function computeEdgeConfidence(
  importCount: number,
  relationshipTypes: RelationshipType[],
): number {
  let score = 0.3;

  if (importCount >= 10) score += 0.3;
  else if (importCount >= 5) score += 0.2;
  else if (importCount >= 2) score += 0.1;

  if (relationshipTypes.length >= 3) score += 0.2;
  else if (relationshipTypes.length >= 2) score += 0.1;

  if (relationshipTypes.includes('extends') || relationshipTypes.includes('implements')) {
    score += 0.1;
  }

  const hasTight = importCount >= 5 &&
    (relationshipTypes.includes('extends') || relationshipTypes.includes('composes'));
  if (hasTight) score += 0.1;

  return Math.min(score, 1.0);
}

import type { PersistenceService } from './PersistenceService.js';
import type { Graph, Node } from '@nodespec/core/types.js';

export interface RequirementMapping {
  id: string;
  specificationId: string;
  requirementId: string | null;
  nodeId: string;
  mappingType: 'implements' | 'depends_on' | 'validates' | 'supports';
  confidence: number;
  notes?: string;
  createdAt: string;
  createdBy: string | null;
  isOrphan?: boolean;
  lastValidatedAt?: string;
  /** R5d: 'valid' = the implementer declared this node's side complete. NEVER implies criteria are met. */
  validationStatus?: 'pending' | 'valid' | 'needs-review' | 'invalid';
  /** R5d: who declared it, from where, when (R3-4b two-half convention). */
  validationProvenance?: { source: string; actor?: string; at: string; note?: string } | null;
}

export interface CreateMappingInput {
  specificationId: string;
  requirementId?: string | null;
  nodeId: string;
  mappingType: RequirementMapping['mappingType'];
  confidence?: number;
  notes?: string;
  createdBy?: string;
}

export interface MappingSuggestion {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  confidence: number;
  rationale: string;
}

export interface OrphanSyncResult {
  updatedCount: number;
  orphanedCount: number;
}

export class MappingService {
  constructor(private persistence: PersistenceService) {}

  async createMapping(input: CreateMappingInput): Promise<RequirementMapping> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.create(input);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async bulkCreateMappings(inputs: CreateMappingInput[]): Promise<RequirementMapping[]> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.bulkCreate(inputs);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getMapping(id: string): Promise<RequirementMapping> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.getById(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getMappingsByNode(nodeId: string): Promise<RequirementMapping[]> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.getByNode(nodeId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getMappingsByRequirement(requirementId: string): Promise<RequirementMapping[]> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.getByRequirement(requirementId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getMappingsBySpecification(specificationId: string): Promise<RequirementMapping[]> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.getBySpecificationId(specificationId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async updateMapping(
    id: string,
    updates: {
      mappingType?: RequirementMapping['mappingType'];
      confidence?: number;
      notes?: string;
    }
  ): Promise<RequirementMapping> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.update(id, updates);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async deleteMapping(id: string): Promise<void> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.delete(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async deleteMappingsByNode(nodeId: string): Promise<void> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.deleteByNode(nodeId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async deleteMappingsByRequirement(requirementId: string): Promise<void> {
    const repo = this.persistence.getMappingsRepository();
    const result = await repo.deleteByRequirement(requirementId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async validateMapping(mappingId: string, graph: Graph): Promise<boolean> {
    const mapping = await this.getMapping(mappingId);
    const nodes = Object.values(graph.nodes);
    const nodeExists = nodes.some((node: Node) => node.id === mapping.nodeId);
    return nodeExists;
  }

  async syncOrphanMappings(
    specificationId: string,
    validNodeIds: string[]
  ): Promise<OrphanSyncResult> {
    const client = this.persistence.getSupabaseClient();
    const { data, error } = await client.rpc('sync_orphan_mappings', {
      p_specification_id: specificationId,
      p_valid_node_ids: validNodeIds,
    });

    if (error) {
      throw new Error(`Failed to sync orphan mappings: ${error.message}`);
    }

    return {
      updatedCount: data[0]?.updated_count || 0,
      orphanedCount: data[0]?.orphaned_count || 0,
    };
  }

  suggestMappingsForNode(node: Node, allRequirements: any[]): MappingSuggestion[] {
    const suggestions: MappingSuggestion[] = [];

    const nodeLabel = typeof node.data === 'object' && node.data !== null && 'label' in node.data
      ? String(node.data.label)
      : '';
    const nodeNameLower = nodeLabel.toLowerCase();
    const nodeType = node.type;

    for (const requirement of allRequirements) {
      const reqNameLower = requirement.name.toLowerCase();
      const reqDescLower = requirement.description?.toLowerCase() || '';

      let confidence = 0;
      const rationales: string[] = [];

      if (nodeNameLower.includes(reqNameLower) || reqNameLower.includes(nodeNameLower)) {
        confidence += 0.4;
        rationales.push('Name similarity');
      }

      if (reqDescLower.includes(nodeNameLower)) {
        confidence += 0.3;
        rationales.push('Description matches node name');
      }

      if (requirement.category === 'technical' && nodeType === 'service') {
        confidence += 0.2;
        rationales.push('Technical requirement for service');
      }

      if (requirement.category === 'functional' &&
          (nodeType === 'api' || nodeType === 'frontend' || nodeType === 'service')) {
        confidence += 0.1;
        rationales.push('Functional requirement for user-facing component');
      }

      if (confidence > 0.3) {
        suggestions.push({
          nodeId: node.id,
          nodeName: nodeLabel || node.id,
          nodeType: nodeType,
          confidence: Math.min(confidence, 1.0),
          rationale: rationales.join(', '),
        });
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  }

  suggestNodesForRequirement(requirement: any, graph: Graph): MappingSuggestion[] {
    const suggestions: MappingSuggestion[] = [];

    const reqNameLower = requirement.name.toLowerCase();
    const reqDescLower = requirement.description?.toLowerCase() || '';
    const category = requirement.category;

    const nodes = Object.values(graph.nodes);
    for (const node of nodes) {
      const nodeLabel = typeof node.data === 'object' && node.data !== null && 'label' in node.data
        ? String(node.data.label)
        : '';
      const nodeNameLower = nodeLabel.toLowerCase();
      let confidence = 0;
      const rationales: string[] = [];

      if (nodeNameLower.includes(reqNameLower) || reqNameLower.includes(nodeNameLower)) {
        confidence += 0.4;
        rationales.push('Name matches requirement');
      }

      if (reqDescLower.includes(nodeNameLower)) {
        confidence += 0.3;
        rationales.push('Requirement description mentions this component');
      }

      const keywords = reqNameLower.split(/\s+/);
      const matchedKeywords = keywords.filter((kw: string) =>
        kw.length > 3 && nodeNameLower.includes(kw)
      );
      if (matchedKeywords.length > 0) {
        confidence += 0.2 * (matchedKeywords.length / keywords.length);
        rationales.push(`Matches keywords: ${matchedKeywords.join(', ')}`);
      }

      if (category === 'technical' && node.type === 'service') {
        confidence += 0.15;
        rationales.push('Technical requirement aligns with service');
      }

      if (category === 'functional' &&
          (node.type === 'api' || node.type === 'frontend' || node.type === 'service')) {
        confidence += 0.1;
        rationales.push('Functional requirement for user-facing component');
      }

      if (confidence > 0.3) {
        suggestions.push({
          nodeId: node.id,
          nodeName: nodeLabel || node.id,
          nodeType: node.type,
          confidence: Math.min(confidence, 1.0),
          rationale: rationales.join(', '),
        });
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  }
}

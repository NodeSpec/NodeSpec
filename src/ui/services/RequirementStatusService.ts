import type { PersistenceService } from './PersistenceService.js';

export interface RequirementCoverage {
  totalRequirements: number;
  mappedRequirements: number;
  unmappedRequirements: number;
  orphanedMappings: number;
  coveragePercentage: number;
}

export interface UnmappedRequirement {
  requirementId: string;
  requirementName: string;
  requirementDescription: string;
  category: string;
  priority: string;
  sectionName: string | null;
}

export interface OrphanNode {
  nodeId: string;
  mappingCount: number;
  orphanedSince: string;
}

export interface RequirementStatus {
  requirementId: string;
  status: 'unmapped' | 'partially-mapped' | 'fully-mapped' | 'validated';
  mappingCount: number;
  nodeIds: string[];
  averageConfidence: number;
}

export class RequirementStatusService {
  private coverageCache: Map<string, { data: RequirementCoverage; timestamp: number }> = new Map();
  private cacheTTL = 30000;

  constructor(private persistence: PersistenceService) {}

  async calculateCoverage(specificationId: string, skipCache = false): Promise<RequirementCoverage> {
    if (!skipCache) {
      const cached = this.coverageCache.get(specificationId);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    const client = this.persistence.getSupabaseClient();
    const { data, error } = await client.rpc('calculate_requirement_coverage', {
      p_specification_id: specificationId,
    });

    if (error) {
      throw new Error(`Failed to calculate coverage: ${error.message}`);
    }

    const coverage: RequirementCoverage = {
      totalRequirements: Number(data[0]?.total_requirements || 0),
      mappedRequirements: Number(data[0]?.mapped_requirements || 0),
      unmappedRequirements: Number(data[0]?.unmapped_requirements || 0),
      orphanedMappings: Number(data[0]?.orphaned_mappings || 0),
      coveragePercentage: Number(data[0]?.coverage_percentage || 0),
    };

    this.coverageCache.set(specificationId, {
      data: coverage,
      timestamp: Date.now(),
    });

    return coverage;
  }

  async getUnmappedRequirements(specificationId: string): Promise<UnmappedRequirement[]> {
    const client = this.persistence.getSupabaseClient();
    const { data, error } = await client.rpc('get_unmapped_requirements', {
      p_specification_id: specificationId,
    });

    if (error) {
      throw new Error(`Failed to get unmapped requirements: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      requirementId: row.requirement_id,
      requirementName: row.requirement_name,
      requirementDescription: row.requirement_description,
      category: row.category,
      priority: row.priority,
      sectionName: row.section_name,
    }));
  }

  async getOrphanNodes(specificationId: string): Promise<OrphanNode[]> {
    const client = this.persistence.getSupabaseClient();
    const { data, error } = await client.rpc('get_orphan_nodes', {
      p_specification_id: specificationId,
    });

    if (error) {
      throw new Error(`Failed to get orphan nodes: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      nodeId: row.node_id,
      mappingCount: Number(row.mapping_count),
      orphanedSince: row.orphaned_since,
    }));
  }

  async calculateRequirementStatus(
    requirementId: string,
    mappings: Array<{ confidence: number; nodeId: string; isOrphan?: boolean }>
  ): Promise<RequirementStatus> {
    const validMappings = mappings.filter(m => !m.isOrphan);

    if (validMappings.length === 0) {
      return {
        requirementId,
        status: 'unmapped',
        mappingCount: 0,
        nodeIds: [],
        averageConfidence: 0,
      };
    }

    const avgConfidence =
      validMappings.reduce((sum, m) => sum + m.confidence, 0) / validMappings.length;

    const status = avgConfidence >= 0.8 ? 'fully-mapped' : 'partially-mapped';

    return {
      requirementId,
      status,
      mappingCount: validMappings.length,
      nodeIds: validMappings.map(m => m.nodeId),
      averageConfidence: avgConfidence,
    };
  }

  async getRequirementStatusForSpecification(
    specificationId: string
  ): Promise<Map<string, RequirementStatus>> {
    const requirementsRepo = this.persistence.getRequirementsRepository();
    const mappingsRepo = this.persistence.getMappingsRepository();

    const [reqsResult, mappingsResult] = await Promise.all([
      requirementsRepo.getBySpecificationId(specificationId),
      mappingsRepo.getBySpecificationId(specificationId),
    ]);

    if (!reqsResult.success) {
      throw new Error(reqsResult.error.message);
    }

    if (!mappingsResult.success) {
      throw new Error(mappingsResult.error.message);
    }

    const requirements = reqsResult.data;
    const allMappings = mappingsResult.data;

    const mappingsByRequirement = new Map<string, typeof allMappings>();
    for (const mapping of allMappings) {
      if (!mapping.requirementId) continue;
      const existing = mappingsByRequirement.get(mapping.requirementId) || [];
      existing.push(mapping);
      mappingsByRequirement.set(mapping.requirementId, existing);
    }

    const statusMap = new Map<string, RequirementStatus>();
    for (const req of requirements) {
      const mappings = mappingsByRequirement.get(req.id) || [];
      const status = await this.calculateRequirementStatus(req.id, mappings);
      statusMap.set(req.id, status);
    }

    return statusMap;
  }

  invalidateCache(specificationId: string): void {
    this.coverageCache.delete(specificationId);
  }

  clearCache(): void {
    this.coverageCache.clear();
  }
}

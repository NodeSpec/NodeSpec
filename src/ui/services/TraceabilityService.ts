/**
 * Service Layer: Traceability Matrix Building
 *
 * Orchestrates the construction of Requirements → Features → Nodes → Artifacts
 * traceability matrix by coordinating between multiple repositories.
 *
 * Architectural Position: Service Layer
 * - Depends on: Repositories (persistence layer)
 * - Used by: UI components
 * - Contains: Business logic for traceability analysis
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MappingsRepository } from '../../persistence/supabase/mappings-repository.js';
import type { Graph } from '@nodespec/core/types.js';
import {
  buildTraceabilityMatrix,
  type TraceabilityMatrix,
} from '@nodespec/core/requirement-traceability.js';

export interface SpecificationData {
  id: string;
  vision: string;
  requirements: Array<{
    id: string;
    requirementId: string;
    name: string;
    description: string;
    category: 'functional' | 'non-functional' | 'technical' | 'business';
    priority?: 'high' | 'medium' | 'low' | null;
    status: 'pending' | 'in-progress' | 'implemented' | 'validated' | 'blocked';
    locked: boolean;
  }>;
}

export class TraceabilityService {
  constructor(
    private supabase: SupabaseClient,
    private mappingsRepository: MappingsRepository
  ) {}

  /**
   * Build complete traceability matrix for a specification
   */
  async buildMatrix(
    specificationId: string,
    graph: Graph
  ): Promise<TraceabilityMatrix | null> {
    try {
      // Fetch specification with requirements
      const { data: specData, error: specError } = await this.supabase
        .from('project_specifications')
        .select('*, specification_requirements(*)')
        .eq('id', specificationId)
        .single();

      if (specError || !specData) {
        console.error('Failed to load specification:', specError);
        return null;
      }

      const spec: SpecificationData = {
        id: specData.id,
        vision: specData.vision,
        requirements: (specData.specification_requirements || []).map((r: any) => ({
          id: r.id,
          requirementId: r.requirement_id,
          name: r.name,
          description: r.description || '',
          category: r.category,
          priority: r.priority,
          status: r.status,
          locked: r.locked ?? false,
        })),
      };

      // Fetch all mappings for this specification
      const mappingsResult = await this.mappingsRepository.getBySpecification(specificationId);
      if (!mappingsResult.success) {
        console.error('Failed to load mappings:', mappingsResult.error);
        return null;
      }

      const mappings = mappingsResult.data.map(m => ({
        requirementId: m.requirementId || '',
        nodeId: m.nodeId,
        mappingType: m.mappingType,
        confidence: m.confidence,
      }));

      // Extract nodes from graph
      const nodes = Object.values(graph.nodes).map((n: any) => ({
        id: n.id,
        label: n.label,
        nodeType: n.nodeType,
      }));

      // Extract artifacts from graph
      const artifacts = Object.values(graph.nodes).flatMap((n: any) =>
        (n.artifacts || []).map((a: any) => ({
          id: a.id,
          nodeId: n.id,
          name: a.name,
          type: a.type,
          status: a.status || 'pending',
        }))
      );

      // Build the traceability matrix using domain logic
      const matrix = buildTraceabilityMatrix(
        specificationId,
        spec.requirements,
        mappings,
        nodes,
        artifacts
      );

      return matrix;
    } catch (error) {
      console.error('Error building traceability matrix:', error);
      return null;
    }
  }

  /**
   * Get unmapped requirements for a specification
   */
  async getUnmappedRequirements(specificationId: string): Promise<string[]> {
    try {
      const { data: requirements, error: reqError } = await this.supabase
        .from('specification_requirements')
        .select('id, requirement_id')
        .eq('specification_id', specificationId);

      if (reqError || !requirements) {
        console.error('Failed to load requirements:', reqError);
        return [];
      }

      const mappingsResult = await this.mappingsRepository.getBySpecification(specificationId);
      if (!mappingsResult.success) {
        return requirements.map(r => r.requirement_id);
      }

      const mappedReqIds = new Set(
        mappingsResult.data
          .filter(m => m.requirementId)
          .map(m => m.requirementId)
      );

      return requirements
        .filter(r => !mappedReqIds.has(r.id))
        .map(r => r.requirement_id);
    } catch (error) {
      console.error('Error getting unmapped requirements:', error);
      return [];
    }
  }

  /**
   * Validate all mappings for a specification
   * Checks for orphaned nodes and invalid references
   */
  async validateMappings(
    specificationId: string,
    graph: Graph
  ): Promise<{
    valid: boolean;
    orphanedMappings: string[];
    invalidReferences: string[];
  }> {
    try {
      const mappingsResult = await this.mappingsRepository.getBySpecification(specificationId);
      if (!mappingsResult.success) {
        return { valid: false, orphanedMappings: [], invalidReferences: [] };
      }

      const graphNodeIds = new Set(Object.keys(graph.nodes));
      const orphanedMappings: string[] = [];
      const invalidReferences: string[] = [];

      for (const mapping of mappingsResult.data) {
        if (!graphNodeIds.has(mapping.nodeId)) {
          orphanedMappings.push(mapping.id);
        }

        if (mapping.requirementId) {
          const { data: requirement, error } = await this.supabase
            .from('specification_requirements')
            .select('id')
            .eq('id', mapping.requirementId)
            .maybeSingle();

          if (error || !requirement) {
            invalidReferences.push(mapping.id);
          }
        }
      }

      return {
        valid: orphanedMappings.length === 0 && invalidReferences.length === 0,
        orphanedMappings,
        invalidReferences,
      };
    } catch (error) {
      console.error('Error validating mappings:', error);
      return { valid: false, orphanedMappings: [], invalidReferences: [] };
    }
  }
}

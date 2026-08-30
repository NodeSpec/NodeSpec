import type { SupabaseClient } from '@supabase/supabase-js';

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

export interface UpdateMappingInput {
  mappingType?: RequirementMapping['mappingType'];
  confidence?: number;
  notes?: string;
}

export interface MappingStats {
  totalRequirements: number;
  mappedRequirements: number;
  unmappedRequirements: number;
  totalNodes: number;
  mappedNodes: number;
  unmappedNodes: number;
  averageConfidence: number;
  coveragePercentage: number;
}

type Result<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string } };

function mapDbToMapping(row: any): RequirementMapping {
  return {
    id: row.id,
    specificationId: row.specification_id,
    requirementId: row.requirement_id,
    nodeId: row.node_id,
    mappingType: row.mapping_type,
    confidence: row.confidence,
    notes: row.notes,
    createdAt: row.created_at,
    createdBy: row.created_by,
    isOrphan: row.is_orphan ?? false,
    // R5d: the completion declaration + its audit trail.
    validationStatus: row.validation_status ?? undefined,
    validationProvenance: row.validation_provenance ?? null,
  };
}

export interface MappingsRepository {
  create(input: CreateMappingInput): Promise<Result<RequirementMapping>>;
  bulkCreate(inputs: CreateMappingInput[]): Promise<Result<RequirementMapping[]>>;
  getById(id: string): Promise<Result<RequirementMapping>>;
  getByRequirement(requirementId: string): Promise<Result<RequirementMapping[]>>;
  getByNode(nodeId: string): Promise<Result<RequirementMapping[]>>;
  getBySpecification(specificationId: string): Promise<Result<RequirementMapping[]>>;
  getBySpecificationId(specificationId: string): Promise<Result<RequirementMapping[]>>;
  update(id: string, input: UpdateMappingInput): Promise<Result<RequirementMapping>>;
  updateConfidence(id: string, confidence: number): Promise<Result<RequirementMapping>>;
  delete(id: string): Promise<Result<void>>;
  deleteByNode(nodeId: string): Promise<Result<void>>;
  deleteByRequirement(requirementId: string): Promise<Result<void>>;
  getStats(specificationId: string): Promise<Result<MappingStats>>;
  checkDuplicates(nodeId: string, requirementId: string): Promise<Result<boolean>>;
}

export function createSupabaseMappingsRepository(
  supabase: SupabaseClient
): MappingsRepository {
  return {
    async create(input: CreateMappingInput): Promise<Result<RequirementMapping>> {
      try {
        const existing = await this.checkDuplicates(input.nodeId, input.requirementId || '');
        if (existing.success && existing.data) {
          return {
            success: false,
            error: {
              message: 'Mapping already exists',
              code: 'DUPLICATE_MAPPING',
            },
          };
        }

        const { data, error } = await supabase
          .from('specification_mappings')
          .insert({
            specification_id: input.specificationId,
            requirement_id: input.requirementId || null,
            node_id: input.nodeId,
            mapping_type: input.mappingType,
            confidence: input.confidence || 1.0,
            notes: input.notes,
            created_by: input.createdBy || null,
          })
          .select()
          .single();

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToMapping(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async bulkCreate(inputs: CreateMappingInput[]): Promise<Result<RequirementMapping[]>> {
      try {
        const records = inputs.map(input => ({
          specification_id: input.specificationId,
          requirement_id: input.requirementId || null,
          node_id: input.nodeId,
          mapping_type: input.mappingType,
          confidence: input.confidence || 1.0,
          notes: input.notes,
          created_by: input.createdBy || null,
        }));

        const { data, error } = await supabase
          .from('specification_mappings')
          .insert(records)
          .select();

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: (data || []).map(mapDbToMapping) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getById(id: string): Promise<Result<RequirementMapping>> {
      try {
        const { data, error } = await supabase
          .from('specification_mappings')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return {
              success: false,
              error: { message: 'Mapping not found', code: 'NOT_FOUND' },
            };
          }
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToMapping(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getByRequirement(requirementId: string): Promise<Result<RequirementMapping[]>> {
      try {
        const { data, error } = await supabase
          .from('specification_mappings')
          .select('*')
          .eq('requirement_id', requirementId)
          .order('created_at', { ascending: false });

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: (data || []).map(mapDbToMapping) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getByNode(nodeId: string): Promise<Result<RequirementMapping[]>> {
      try {
        const { data, error } = await supabase
          .from('specification_mappings')
          .select('*')
          .eq('node_id', nodeId)
          .order('created_at', { ascending: false });

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: (data || []).map(mapDbToMapping) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getBySpecification(specificationId: string): Promise<Result<RequirementMapping[]>> {
      try {
        const { data, error } = await supabase
          .from('specification_mappings')
          .select('*')
          .eq('specification_id', specificationId)
          .order('created_at', { ascending: false });

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: (data || []).map(mapDbToMapping) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getBySpecificationId(specificationId: string): Promise<Result<RequirementMapping[]>> {
      return this.getBySpecification(specificationId);
    },

    async update(id: string, input: UpdateMappingInput): Promise<Result<RequirementMapping>> {
      try {
        const updates: any = {};

        if (input.mappingType !== undefined) updates.mapping_type = input.mappingType;
        if (input.confidence !== undefined) updates.confidence = input.confidence;
        if (input.notes !== undefined) updates.notes = input.notes;

        const { data, error } = await supabase
          .from('specification_mappings')
          .update(updates)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToMapping(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async updateConfidence(id: string, confidence: number): Promise<Result<RequirementMapping>> {
      return this.update(id, { confidence });
    },

    async delete(id: string): Promise<Result<void>> {
      try {
        const { error } = await supabase
          .from('specification_mappings')
          .delete()
          .eq('id', id);

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: undefined };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async deleteByNode(nodeId: string): Promise<Result<void>> {
      try {
        const { error } = await supabase
          .from('specification_mappings')
          .delete()
          .eq('node_id', nodeId);

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: undefined };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async deleteByRequirement(requirementId: string): Promise<Result<void>> {
      try {
        const { error } = await supabase
          .from('specification_mappings')
          .delete()
          .eq('requirement_id', requirementId);

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: undefined };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getStats(specificationId: string): Promise<Result<MappingStats>> {
      try {
        const [reqsResult, mappingsResult] = await Promise.all([
          supabase
            .from('specification_requirements')
            .select('id')
            .eq('specification_id', specificationId),
          supabase
            .from('specification_mappings')
            .select('*')
            .eq('specification_id', specificationId),
        ]);

        if (reqsResult.error) {
          return {
            success: false,
            error: { message: reqsResult.error.message, code: reqsResult.error.code },
          };
        }

        if (mappingsResult.error) {
          return {
            success: false,
            error: { message: mappingsResult.error.message, code: mappingsResult.error.code },
          };
        }

        const totalRequirements = reqsResult.data?.length || 0;
        const mappings = mappingsResult.data || [];

        const uniqueRequirements = new Set(
          mappings.filter(m => m.requirement_id).map(m => m.requirement_id)
        );
        const uniqueNodes = new Set(mappings.map(m => m.node_id));

        const mappedRequirements = uniqueRequirements.size;
        const mappedNodes = uniqueNodes.size;

        const averageConfidence = mappings.length > 0
          ? mappings.reduce((sum, m) => sum + m.confidence, 0) / mappings.length
          : 0;

        const coveragePercentage = totalRequirements > 0
          ? (mappedRequirements / totalRequirements) * 100
          : 0;

        return {
          success: true,
          data: {
            totalRequirements,
            mappedRequirements,
            unmappedRequirements: totalRequirements - mappedRequirements,
            totalNodes: mappedNodes,
            mappedNodes,
            unmappedNodes: 0,
            averageConfidence,
            coveragePercentage,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async checkDuplicates(nodeId: string, requirementId: string): Promise<Result<boolean>> {
      try {
        if (!requirementId) {
          return { success: true, data: false };
        }

        const { data, error } = await supabase
          .from('specification_mappings')
          .select('id')
          .eq('node_id', nodeId)
          .eq('requirement_id', requirementId)
          .maybeSingle();

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: !!data };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },
  };
}

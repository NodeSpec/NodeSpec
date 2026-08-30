// R6: authored requirement↔requirement relations (expands / depends_on /
// relates_to). Doctrine (inversion): NodeSpec never writes a row here on its
// own — creates come only from a user click (source 'user') or the user's AI
// over MCP (source 'ai'); deterministic node-overlap coupling stays derived
// at read time (spec-v3/coupling.ts) and never lands in this table. Rows are
// add/remove facts — there is no update lane (the table has no UPDATE policy).
import type { SupabaseClient } from '@supabase/supabase-js';

export type RequirementRelationType = 'expands' | 'depends_on' | 'relates_to';

export interface RequirementRelation {
  id: string;
  specificationId: string;
  /** Row uuid of the relating requirement (for 'expands': the NEW one). */
  fromRequirementId: string;
  /** Row uuid of the related requirement (for 'expands': the older one). */
  toRequirementId: string;
  relationType: RequirementRelationType;
  source: 'user' | 'ai';
  createdBy: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CreateRequirementRelationInput {
  specificationId: string;
  fromRequirementId: string;
  toRequirementId: string;
  relationType: RequirementRelationType;
  source: 'user' | 'ai';
  createdBy?: string | null;
  notes?: string | null;
}

type Result<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string } };

export function mapDbToRequirementRelation(row: any): RequirementRelation {
  return {
    id: row.id,
    specificationId: row.specification_id ?? row.specificationId,
    fromRequirementId: row.from_requirement_id ?? row.fromRequirementId,
    toRequirementId: row.to_requirement_id ?? row.toRequirementId,
    relationType: row.relation_type ?? row.relationType,
    source: row.source,
    createdBy: row.created_by ?? row.createdBy ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at ?? row.createdAt,
  };
}

export interface RequirementRelationsRepository {
  getBySpecificationId(specificationId: string): Promise<Result<RequirementRelation[]>>;
  create(input: CreateRequirementRelationInput): Promise<Result<RequirementRelation>>;
  delete(id: string): Promise<Result<void>>;
}

export function createSupabaseRequirementRelationsRepository(
  supabase: SupabaseClient
): RequirementRelationsRepository {
  return {
    async getBySpecificationId(specificationId: string): Promise<Result<RequirementRelation[]>> {
      try {
        const { data, error } = await supabase
          .from('specification_requirement_relations')
          .select('*')
          .eq('specification_id', specificationId)
          .order('created_at', { ascending: true });

        if (error) {
          return { success: false, error: { message: error.message, code: error.code } };
        }
        return { success: true, data: (data || []).map(mapDbToRequirementRelation) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async create(input: CreateRequirementRelationInput): Promise<Result<RequirementRelation>> {
      try {
        const { data, error } = await supabase
          .from('specification_requirement_relations')
          .insert({
            specification_id: input.specificationId,
            from_requirement_id: input.fromRequirementId,
            to_requirement_id: input.toRequirementId,
            relation_type: input.relationType,
            source: input.source,
            created_by: input.createdBy ?? null,
            notes: input.notes ?? null,
          })
          .select()
          .single();

        if (error) {
          // Duplicate = the fact already stands (UNIQUE(from,to,type)) — surface
          // the code so callers can treat it as idempotent success if they want.
          return { success: false, error: { message: error.message, code: error.code } };
        }
        return { success: true, data: mapDbToRequirementRelation(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async delete(id: string): Promise<Result<void>> {
      try {
        const { error } = await supabase
          .from('specification_requirement_relations')
          .delete()
          .eq('id', id);

        if (error) {
          return { success: false, error: { message: error.message, code: error.code } };
        }
        return { success: true, data: undefined };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },
  };
}

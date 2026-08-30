import type { SupabaseClient } from '@supabase/supabase-js';

export interface SpecificationSection {
  id: string;
  specificationId: string;
  name: string;
  description: string | null;
  orderIndex: number;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSectionInput {
  specificationId: string;
  name: string;
  description?: string;
  orderIndex?: number;
  aiGenerated?: boolean;
}

export interface UpdateSectionInput {
  name?: string;
  description?: string;
  orderIndex?: number;
}

type Result<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string } };

function mapDbToSection(row: any): SpecificationSection {
  return {
    id: row.id,
    specificationId: row.specification_id,
    name: row.name,
    description: row.description,
    orderIndex: row.order_index,
    aiGenerated: row.ai_generated,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SectionsRepository {
  create(input: CreateSectionInput): Promise<Result<SpecificationSection>>;
  bulkCreate(inputs: CreateSectionInput[]): Promise<Result<SpecificationSection[]>>;
  getById(id: string): Promise<Result<SpecificationSection>>;
  getBySpecificationId(specificationId: string): Promise<Result<SpecificationSection[]>>;
  update(id: string, input: UpdateSectionInput): Promise<Result<SpecificationSection>>;
  delete(id: string): Promise<Result<void>>;
  reorder(specificationId: string, sectionIds: string[]): Promise<Result<void>>;
}

export function createSupabaseSectionsRepository(
  supabase: SupabaseClient
): SectionsRepository {
  return {
    async create(input: CreateSectionInput): Promise<Result<SpecificationSection>> {
      try {
        const { data, error } = await supabase
          .from('specification_sections')
          .insert({
            specification_id: input.specificationId,
            name: input.name,
            description: input.description || null,
            order_index: input.orderIndex ?? 0,
            ai_generated: input.aiGenerated ?? false,
          })
          .select()
          .single();

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToSection(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async bulkCreate(inputs: CreateSectionInput[]): Promise<Result<SpecificationSection[]>> {
      try {
        const records = inputs.map((input) => ({
          specification_id: input.specificationId,
          name: input.name,
          description: input.description || null,
          order_index: input.orderIndex ?? 0,
          ai_generated: input.aiGenerated ?? false,
        }));

        const { data, error } = await supabase
          .from('specification_sections')
          .insert(records)
          .select();

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: (data || []).map(mapDbToSection) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getById(id: string): Promise<Result<SpecificationSection>> {
      try {
        const { data, error } = await supabase
          .from('specification_sections')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return {
              success: false,
              error: { message: 'Section not found', code: 'NOT_FOUND' },
            };
          }
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToSection(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getBySpecificationId(specificationId: string): Promise<Result<SpecificationSection[]>> {
      try {
        const { data, error } = await supabase
          .from('specification_sections')
          .select('*')
          .eq('specification_id', specificationId)
          .order('order_index', { ascending: true });

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: (data || []).map(mapDbToSection) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async update(id: string, input: UpdateSectionInput): Promise<Result<SpecificationSection>> {
      try {
        const updates: any = {};

        if (input.name !== undefined) updates.name = input.name;
        if (input.description !== undefined) updates.description = input.description;
        if (input.orderIndex !== undefined) updates.order_index = input.orderIndex;

        const { data, error } = await supabase
          .from('specification_sections')
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

        return { success: true, data: mapDbToSection(data) };
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
          .from('specification_sections')
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

    async reorder(specificationId: string, sectionIds: string[]): Promise<Result<void>> {
      try {
        const updates = sectionIds.map((id, index) => ({
          id,
          order_index: index,
        }));

        for (const update of updates) {
          const { error } = await supabase
            .from('specification_sections')
            .update({ order_index: update.order_index })
            .eq('id', update.id)
            .eq('specification_id', specificationId);

          if (error) {
            return {
              success: false,
              error: { message: error.message, code: error.code },
            };
          }
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

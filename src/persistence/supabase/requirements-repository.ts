import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * R5c/R5e: one criterion record, evidence audit trail included. `provenance` says
 * where a met flag came from (git tick / UI toggle / MCP completion);
 * `evidenceStale` marks a still-met criterion whose source changed since its git
 * tick — a prompt to re-verify, never a retraction. Both are optional jsonb
 * passengers: the DB round-trip is raw (no zod strip), so they survive edits.
 */
export interface AcceptanceCriterionRecord {
  text: string;
  met?: boolean;
  testId?: string;
  provenance?: { source: string; commitSha?: string; actor?: string; at: string };
  evidenceStale?: { at: string; commitSha?: string; reason: string };
  /** C4/WS4: how this criterion is verified. 'manual' marks criteria the test
   *  lane deliberately skips — read-only jsonb passenger, no UI writer yet. */
  verification?: string;
}

export interface Requirement {
  id: string;
  specificationId: string;
  requirementId: string;
  name: string;
  description: string;
  category: 'functional' | 'non-functional' | 'technical' | 'business';
  status: 'pending' | 'in-progress' | 'implemented' | 'validated' | 'blocked';
  sectionId: string | null;
  source: 'manual' | 'ai-generated' | 'imported';
  locked: boolean;
  /** R6 (Discovered #7 adjacent): the DB column existed since 20260126 but
   *  neither mapper carried it — reads silently dropped it. */
  confirmed?: boolean;
  acceptanceCriteria: AcceptanceCriterionRecord[];
  architectureTrace?: string[];
  metadata: {
    confidence?: number;
    rationale?: string;
    dependencies?: string[];
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateRequirementInput {
  specificationId: string;
  requirementId: string;
  name: string;
  description: string;
  category: Requirement['category'];
  sectionId?: string | null;
  source?: Requirement['source'];
  acceptanceCriteria: Requirement['acceptanceCriteria'];
  metadata?: Requirement['metadata'];
}

export interface UpdateRequirementInput {
  name?: string;
  description?: string;
  category?: Requirement['category'];
  status?: Requirement['status'];
  locked?: boolean;
  sectionId?: string | null;
  acceptanceCriteria?: Requirement['acceptanceCriteria'];
  architectureTrace?: string[];
  metadata?: Requirement['metadata'];
  expectedUpdatedAt?: string;
}

export interface RequirementFilter {
  specificationId?: string;
  status?: Requirement['status'] | Requirement['status'][];
  category?: Requirement['category'] | Requirement['category'][];
}

type Result<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string } };

function mapDbToRequirement(row: any): Requirement {
  return {
    id: row.id,
    specificationId: row.specification_id,
    requirementId: row.requirement_id,
    name: row.name,
    description: row.description || '',
    category: row.category,
    status: row.status,
    sectionId: row.section_id || null,
    source: row.source || 'manual',
    locked: row.locked ?? false,
    confirmed: row.confirmed ?? false,
    acceptanceCriteria: row.acceptance_criteria || [],
    architectureTrace: row.architecture_trace || [],
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface RequirementsRepository {
  create(input: CreateRequirementInput): Promise<Result<Requirement>>;
  bulkCreate(inputs: CreateRequirementInput[]): Promise<Result<Requirement[]>>;
  getById(id: string): Promise<Result<Requirement>>;
  getBySpecificationId(specificationId: string): Promise<Result<Requirement[]>>;
  getByRequirementId(requirementId: string, specificationId: string): Promise<Result<Requirement>>;
  query(filter: RequirementFilter): Promise<Result<Requirement[]>>;
  update(id: string, input: UpdateRequirementInput): Promise<Result<Requirement>>;
  delete(id: string, options?: { force?: boolean }): Promise<Result<void>>;
  getUnmapped(specificationId: string): Promise<Result<Requirement[]>>;
  search(specificationId: string, searchText: string): Promise<Result<Requirement[]>>;
  getDependencies(requirementId: string): Promise<Result<Requirement[]>>;
}

function sanitizeCategory(category: string): 'functional' | 'non-functional' | 'technical' | 'business' {
  const validCategories = ['functional', 'non-functional', 'technical', 'business'];
  const normalized = category.toLowerCase().trim();

  if (validCategories.includes(normalized)) {
    return normalized as 'functional' | 'non-functional' | 'technical' | 'business';
  }

  console.warn(`Invalid category "${category}", defaulting to "functional"`);
  return 'functional';
}

/** Discovered #8 (ordering half): requirement ids sort lexicographically in
 *  the DB, which breaks at REQ-1000 (sorts before REQ-999). Natural sort —
 *  applied after every list read; the DB order stays as a stable pre-sort. */
export function sortRequirementsNaturally(reqs: Requirement[]): Requirement[] {
  return reqs.sort((a, b) =>
    String(a.requirementId).localeCompare(String(b.requirementId), undefined, { numeric: true }));
}

export function createSupabaseRequirementsRepository(
  supabase: SupabaseClient
): RequirementsRepository {
  return {
    async create(input: CreateRequirementInput): Promise<Result<Requirement>> {
      try {
        const sanitizedCategory = sanitizeCategory(input.category);

        const { data, error} = await supabase
          .from('specification_requirements')
          .insert({
            specification_id: input.specificationId,
            requirement_id: input.requirementId,
            name: input.name,
            description: input.description,
            category: sanitizedCategory,
            status: 'pending',
            section_id: input.sectionId || null,
            source: input.source || 'manual',
            acceptance_criteria: input.acceptanceCriteria,
            metadata: input.metadata || {},
          })
          .select()
          .single();

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToRequirement(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async bulkCreate(inputs: CreateRequirementInput[]): Promise<Result<Requirement[]>> {
      try {
        const records = inputs.map(input => ({
          specification_id: input.specificationId,
          requirement_id: input.requirementId,
          name: input.name,
          description: input.description,
          category: sanitizeCategory(input.category),
          status: 'pending',
          section_id: input.sectionId || null,
          source: input.source || 'manual',
          acceptance_criteria: input.acceptanceCriteria,
          metadata: input.metadata || {},
        }));

        const { data, error } = await supabase
          .from('specification_requirements')
          .insert(records)
          .select();

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: sortRequirementsNaturally((data || []).map(mapDbToRequirement)) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getById(id: string): Promise<Result<Requirement>> {
      try {
        const { data, error } = await supabase
          .from('specification_requirements')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return {
              success: false,
              error: { message: 'Requirement not found', code: 'NOT_FOUND' },
            };
          }
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToRequirement(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getBySpecificationId(specificationId: string): Promise<Result<Requirement[]>> {
      try {
        const { data, error } = await supabase
          .from('specification_requirements')
          .select('*')
          .eq('specification_id', specificationId)
          .order('requirement_id', { ascending: true });

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: sortRequirementsNaturally((data || []).map(mapDbToRequirement)) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getByRequirementId(requirementId: string, specificationId: string): Promise<Result<Requirement>> {
      try {
        const { data, error } = await supabase
          .from('specification_requirements')
          .select('*')
          .eq('requirement_id', requirementId)
          .eq('specification_id', specificationId)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return {
              success: false,
              error: { message: 'Requirement not found', code: 'NOT_FOUND' },
            };
          }
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: mapDbToRequirement(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async query(filter: RequirementFilter): Promise<Result<Requirement[]>> {
      try {
        let query = supabase.from('specification_requirements').select('*');

        if (filter.specificationId) {
          query = query.eq('specification_id', filter.specificationId);
        }

        if (filter.status) {
          if (Array.isArray(filter.status)) {
            query = query.in('status', filter.status);
          } else {
            query = query.eq('status', filter.status);
          }
        }


        if (filter.category) {
          if (Array.isArray(filter.category)) {
            query = query.in('category', filter.category);
          } else {
            query = query.eq('category', filter.category);
          }
        }

        const { data, error } = await query.order('requirement_id', { ascending: true });

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: sortRequirementsNaturally((data || []).map(mapDbToRequirement)) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async update(id: string, input: UpdateRequirementInput): Promise<Result<Requirement>> {
      try {
        if (input.expectedUpdatedAt) {
          const { data: currentData, error: checkError } = await supabase
            .from('specification_requirements')
            .select('updated_at')
            .eq('id', id)
            .single();

          if (checkError) {
            return {
              success: false,
              error: { message: checkError.message, code: checkError.code },
            };
          }

          if (currentData.updated_at !== input.expectedUpdatedAt) {
            return {
              success: false,
              error: {
                message: 'Concurrent modification detected. Requirement was updated by another user.',
                code: 'CONCURRENT_MODIFICATION',
              },
            };
          }
        }

        const updates: any = {
          updated_at: new Date().toISOString(),
        };

        if (input.name !== undefined) updates.name = input.name;
        if (input.description !== undefined) updates.description = input.description;
        if (input.category !== undefined) updates.category = input.category;
        if (input.status !== undefined) updates.status = input.status;
        if (input.acceptanceCriteria !== undefined) updates.acceptance_criteria = input.acceptanceCriteria;
        if (input.locked !== undefined) updates.locked = input.locked;
        if (input.sectionId !== undefined) updates.section_id = input.sectionId;
        if (input.architectureTrace !== undefined) updates.architecture_trace = input.architectureTrace;
        if (input.metadata !== undefined) updates.metadata = input.metadata;

        const { data, error } = await supabase
          .from('specification_requirements')
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

        return { success: true, data: mapDbToRequirement(data) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async delete(id: string, options?: { force?: boolean }): Promise<Result<void>> {
      try {
        const force = options?.force ?? false;

        const { data: mappingsData, error: mappingsError } = await supabase
          .from('specification_mappings')
          .select('id, node_id')
          .eq('requirement_id', id);

        if (mappingsError && mappingsError.code !== 'PGRST116') {
          return {
            success: false,
            error: { message: mappingsError.message, code: mappingsError.code },
          };
        }

        const mappingsCount = mappingsData?.length || 0;
        if (mappingsCount > 0 && !force) {
          return {
            success: false,
            error: {
              message: `Cannot delete requirement: it has ${mappingsCount} node mapping(s). Use force delete to remove mappings automatically.`,
              code: 'HAS_DEPENDENCIES',
            },
          };
        }

        if (mappingsCount > 0 && force) {
          const { error: delMappingsErr } = await supabase
            .from('specification_mappings')
            .delete()
            .eq('requirement_id', id);

          if (delMappingsErr) {
            return {
              success: false,
              error: { message: delMappingsErr.message, code: delMappingsErr.code },
            };
          }
        }

        const { error } = await supabase
          .from('specification_requirements')
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

    async getUnmapped(specificationId: string): Promise<Result<Requirement[]>> {
      try {
        const { data, error } = await supabase.rpc('get_unmapped_requirements', {
          p_specification_id: specificationId,
        });

        if (error) {
          console.warn('RPC not available, falling back to query:', error);

          const { data: allReqs, error: reqError } = await supabase
            .from('specification_requirements')
            .select('*')
            .eq('specification_id', specificationId);

          if (reqError) {
            return {
              success: false,
              error: { message: reqError.message, code: reqError.code },
            };
          }

          const { data: mappings, error: mapError } = await supabase
            .from('specification_mappings')
            .select('requirement_id')
            .eq('specification_id', specificationId);

          if (mapError) {
            return {
              success: false,
              error: { message: mapError.message, code: mapError.code },
            };
          }

          const mappedIds = new Set((mappings || []).map(m => m.requirement_id));
          const unmapped = (allReqs || []).filter(req => !mappedIds.has(req.id));

          return { success: true, data: unmapped.map(mapDbToRequirement) };
        }

        return { success: true, data: sortRequirementsNaturally((data || []).map(mapDbToRequirement)) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async search(specificationId: string, searchText: string): Promise<Result<Requirement[]>> {
      try {
        const searchPattern = `%${searchText}%`;

        const { data, error } = await supabase
          .from('specification_requirements')
          .select('*')
          .eq('specification_id', specificationId)
          .or(`name.ilike.${searchPattern},description.ilike.${searchPattern},requirement_id.ilike.${searchPattern}`)
          .order('requirement_id', { ascending: true });

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: sortRequirementsNaturally((data || []).map(mapDbToRequirement)) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },

    async getDependencies(requirementId: string): Promise<Result<Requirement[]>> {
      try {
        const { data: requirement, error: reqError } = await supabase
          .from('specification_requirements')
          .select('metadata, specification_id')
          .eq('requirement_id', requirementId)
          .single();

        if (reqError) {
          return {
            success: false,
            error: { message: reqError.message, code: reqError.code },
          };
        }

        const dependencies = requirement.metadata?.dependencies || [];

        if (dependencies.length === 0) {
          return { success: true, data: [] };
        }

        const { data, error } = await supabase
          .from('specification_requirements')
          .select('*')
          .eq('specification_id', requirement.specification_id)
          .in('requirement_id', dependencies);

        if (error) {
          return {
            success: false,
            error: { message: error.message, code: error.code },
          };
        }

        return { success: true, data: sortRequirementsNaturally((data || []).map(mapDbToRequirement)) };
      } catch (error) {
        return {
          success: false,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },
  };
}

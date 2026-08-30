import type { SupabaseClient } from '@supabase/supabase-js';
import type { TemplateRepository } from '../ports.js';
import type {
  ProjectTemplate,
  TemplateUsage,
  TemplateCategory,
  TemplateAuthorType,
  TemplateSpecification,
  RepositoryResult,
} from '../types.js';
import type { Graph } from '@nodespec/core/types.js';

interface TemplateRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  graph_data: Graph;
  template_specification: TemplateSpecification | null;
  thumbnail_url: string | null;
  /** Owner-curated public source repo for the template (2026-08-14). */
  repo_url: string | null;
  tags: string[];
  technologies: string[];
  node_count: number;
  edge_count: number;
  author_type: string;
  author_id: string | null;
  is_public: boolean;
  is_featured: boolean;
  use_count: number;
  upvote_count: number;
  version: string;
  created_at: string;
  updated_at: string;
}

interface TemplateUsageRow {
  id: string;
  template_id: string;
  user_id: string;
  project_id: string | null;
  created_at: string;
}

function rowToTemplate(row: TemplateRow): ProjectTemplate {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category as TemplateCategory,
    graphData: row.graph_data,
    templateSpecification: row.template_specification ?? null,
    thumbnailUrl: row.thumbnail_url,
    repoUrl: row.repo_url ?? null,
    tags: row.tags ?? [],
    technologies: row.technologies ?? [],
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
    authorType: row.author_type as TemplateAuthorType,
    authorId: row.author_id,
    isPublic: row.is_public,
    isFeatured: row.is_featured,
    useCount: row.use_count,
    upvoteCount: row.upvote_count ?? 0,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToUsage(row: TemplateUsageRow): TemplateUsage {
  return {
    id: row.id,
    templateId: row.template_id,
    userId: row.user_id,
    projectId: row.project_id,
    createdAt: row.created_at,
  };
}

export function createSupabaseTemplateRepository(client: SupabaseClient): TemplateRepository {
  return {
    async getById(id): Promise<RepositoryResult<ProjectTemplate | null>> {
      const { data, error } = await client
        .from('project_templates')
        .select()
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToTemplate(data) : null };
    },

    async getBySlug(slug): Promise<RepositoryResult<ProjectTemplate | null>> {
      const { data, error } = await client
        .from('project_templates')
        .select()
        .eq('slug', slug)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToTemplate(data) : null };
    },

    async list(filters): Promise<RepositoryResult<ProjectTemplate[]>> {
      let query = client
        .from('project_templates')
        .select()
        .eq('is_public', true);

      if (filters?.category) {
        query = query.eq('category', filters.category);
      }

      if (filters?.authorType) {
        query = query.eq('author_type', filters.authorType);
      }

      if (filters?.isFeatured !== undefined) {
        query = query.eq('is_featured', filters.isFeatured);
      }

      if (filters?.tags && filters.tags.length > 0) {
        query = query.contains('tags', filters.tags);
      }

      if (filters?.search) {
        query = query.or(`name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
      }

      const sortBy = filters?.sortBy ?? 'featured';
      if (sortBy === 'featured') {
        query = query
          .order('is_featured', { ascending: false })
          .order('use_count', { ascending: false });
      } else if (sortBy === 'popular') {
        query = query.order('use_count', { ascending: false });
      } else {
        query = query.order('created_at', { ascending: false });
      }

      if (filters?.limit) {
        const offset = filters.offset ?? 0;
        query = query.range(offset, offset + filters.limit - 1);
      }

      const { data, error } = await query;

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: (data ?? []).map(rowToTemplate) };
    },

    async listByAuthor(authorId): Promise<RepositoryResult<ProjectTemplate[]>> {
      const { data, error } = await client
        .from('project_templates')
        .select()
        .eq('author_id', authorId)
        .order('created_at', { ascending: false });

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: (data ?? []).map(rowToTemplate) };
    },

    async create(template): Promise<RepositoryResult<ProjectTemplate>> {
      const { data, error } = await client
        .from('project_templates')
        .insert({
          name: template.name,
          slug: template.slug,
          description: template.description ?? '',
          category: template.category,
          graph_data: template.graphData,
          thumbnail_url: template.thumbnailUrl ?? null,
          tags: template.tags ?? [],
          technologies: template.technologies ?? [],
          node_count: template.nodeCount ?? 0,
          edge_count: template.edgeCount ?? 0,
          author_type: template.authorType,
          author_id: template.authorId ?? null,
          is_public: template.isPublic ?? true,
          is_featured: template.isFeatured ?? false,
          version: template.version ?? '1.0.0',
        })
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToTemplate(data) };
    },

    async update(id, updates): Promise<RepositoryResult<ProjectTemplate>> {
      const updateData: Record<string, unknown> = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.slug !== undefined) updateData.slug = updates.slug;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.graphData !== undefined) updateData.graph_data = updates.graphData;
      if (updates.thumbnailUrl !== undefined) updateData.thumbnail_url = updates.thumbnailUrl;
      if (updates.tags !== undefined) updateData.tags = updates.tags;
      if (updates.technologies !== undefined) updateData.technologies = updates.technologies;
      if (updates.nodeCount !== undefined) updateData.node_count = updates.nodeCount;
      if (updates.edgeCount !== undefined) updateData.edge_count = updates.edgeCount;
      if (updates.isPublic !== undefined) updateData.is_public = updates.isPublic;
      if (updates.isFeatured !== undefined) updateData.is_featured = updates.isFeatured;
      if (updates.version !== undefined) updateData.version = updates.version;
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await client
        .from('project_templates')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToTemplate(data) };
    },

    async delete(id): Promise<RepositoryResult<void>> {
      const { error } = await client
        .from('project_templates')
        .delete()
        .eq('id', id);

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: undefined };
    },

    async recordUsage(templateId, userId, projectId): Promise<RepositoryResult<TemplateUsage>> {
      const { data, error } = await client
        .from('template_usage')
        .insert({
          template_id: templateId,
          user_id: userId,
          project_id: projectId ?? null,
        })
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      await client.rpc('increment_template_use_count', { tid: templateId });

      return { success: true, data: rowToUsage(data) };
    },

    async getUsageByUser(userId): Promise<RepositoryResult<TemplateUsage[]>> {
      const { data, error } = await client
        .from('template_usage')
        .select()
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: (data ?? []).map(rowToUsage) };
    },
  };
}

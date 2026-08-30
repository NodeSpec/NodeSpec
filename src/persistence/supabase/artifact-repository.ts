import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArtifactRepository } from '../ports.js';
import type { PersistedArtifact, RepositoryResult } from '../types.js';

interface ArtifactRow {
  id: string;
  project_id: string;
  kind: string | null;
  node_id: string | null;
  branch_id: string | null;
  path: string | null;
  content_text: string | null;
  content_hash: string | null;
  language: string | null;
  status: string | null;
  description: string | null;
  created_at: string;
  updated_at: string | null;
  metadata: Record<string, unknown> | null;
  type: string | null;
  uri: string | null;
  content: unknown | null;
  storage_path: string | null;
}

const SELECT_COLUMNS = 'id, project_id, kind, node_id, branch_id, path, content_text, content_hash, language, status, description, created_at, updated_at, metadata, type, uri, content, storage_path';

function rowToArtifact(row: ArtifactRow): PersistedArtifact {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind ?? row.type ?? 'source',
    nodeId: row.node_id ?? '',
    branchId: row.branch_id ?? undefined,
    path: row.path ?? row.uri ?? '',
    contentText: row.content_text ?? undefined,
    contentHash: row.content_hash ?? undefined,
    language: row.language ?? undefined,
    status: row.status ?? 'draft',
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    metadata: row.metadata ?? undefined,
    type: row.type ?? undefined,
    content: row.content ?? undefined,
    uri: row.uri ?? undefined,
    storagePath: row.storage_path ?? undefined,
  };
}

export function createSupabaseArtifactRepository(client: SupabaseClient): ArtifactRepository {
  return {
    async saveArtifact(projectId, artifact): Promise<RepositoryResult<PersistedArtifact>> {
      const { data, error } = await client
        .from('artifacts')
        .insert({
          id: artifact.id,
          project_id: projectId,
          kind: artifact.kind,
          node_id: artifact.nodeId || null,
          branch_id: artifact.branchId || null,
          path: artifact.path,
          content_text: artifact.contentText ?? null,
          content_hash: artifact.contentHash ?? null,
          language: artifact.language ?? null,
          status: artifact.status ?? 'draft',
          description: artifact.description ?? null,
          metadata: artifact.metadata ?? {},
          type: artifact.kind,
          updated_at: new Date().toISOString(),
        })
        .select(SELECT_COLUMNS)
        .single();

      if (error) {
        if (error.code === '23505') {
          return {
            success: false,
            error: {
              code: 'DUPLICATE_ARTIFACT',
              message: `Artifact ${artifact.id} already exists`,
              details: { pgError: error },
            },
          };
        }
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToArtifact(data) };
    },

    async loadArtifact(artifactId): Promise<RepositoryResult<PersistedArtifact | null>> {
      const { data, error } = await client
        .from('artifacts')
        .select(SELECT_COLUMNS)
        .eq('id', artifactId)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data ? rowToArtifact(data) : null };
    },

    async loadArtifacts(projectId, artifactIds): Promise<RepositoryResult<PersistedArtifact[]>> {
      let query = client
        .from('artifacts')
        .select(SELECT_COLUMNS)
        .eq('project_id', projectId);

      if (artifactIds && artifactIds.length > 0) {
        query = query.in('id', artifactIds);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToArtifact) };
    },

    async loadByNodeId(nodeId): Promise<RepositoryResult<PersistedArtifact[]>> {
      const { data, error } = await client
        .from('artifacts')
        .select(SELECT_COLUMNS)
        .eq('node_id', nodeId)
        .order('path', { ascending: true });

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToArtifact) };
    },

    async loadByBranchId(branchId): Promise<RepositoryResult<PersistedArtifact[]>> {
      const { data, error } = await client
        .from('artifacts')
        .select(SELECT_COLUMNS)
        .eq('branch_id', branchId)
        .order('path', { ascending: true });

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToArtifact) };
    },

    async searchByLanguage(projectId, language): Promise<RepositoryResult<PersistedArtifact[]>> {
      const { data, error } = await client
        .from('artifacts')
        .select(SELECT_COLUMNS)
        .eq('project_id', projectId)
        .eq('language', language)
        .order('path', { ascending: true });

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToArtifact) };
    },

    async searchByPath(projectId, pathPattern): Promise<RepositoryResult<PersistedArtifact[]>> {
      const { data, error } = await client
        .from('artifacts')
        .select(SELECT_COLUMNS)
        .eq('project_id', projectId)
        .ilike('path', pathPattern)
        .order('path', { ascending: true });

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: data.map(rowToArtifact) };
    },

    async deleteArtifact(artifactId): Promise<RepositoryResult<void>> {
      const { error } = await client
        .from('artifacts')
        .delete()
        .eq('id', artifactId);

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: undefined };
    },

    async updateArtifact(artifactId, updates): Promise<RepositoryResult<PersistedArtifact>> {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (updates.kind !== undefined) {
        updateData.kind = updates.kind;
        updateData.type = updates.kind;
      }
      if (updates.nodeId !== undefined) updateData.node_id = updates.nodeId;
      if (updates.branchId !== undefined) updateData.branch_id = updates.branchId;
      if (updates.path !== undefined) updateData.path = updates.path;
      if (updates.contentText !== undefined) updateData.content_text = updates.contentText;
      if (updates.contentHash !== undefined) updateData.content_hash = updates.contentHash;
      if (updates.language !== undefined) updateData.language = updates.language;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.metadata !== undefined) updateData.metadata = updates.metadata;

      const { data, error } = await client
        .from('artifacts')
        .update(updateData)
        .eq('id', artifactId)
        .select(SELECT_COLUMNS)
        .single();

      if (error) {
        return {
          success: false,
          error: { code: 'DB_ERROR', message: error.message, details: { pgError: error } },
        };
      }

      return { success: true, data: rowToArtifact(data) };
    },
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CodeStructure, ParseCodeStructureRequest, ParseCodeStructureResponse } from '@nodespec/core/code-structure.js';
import { hashContent } from '@nodespec/core/code-structure.js';
import { callEdgeFunction } from './client.js';

export interface CodeStructureRepository {
  getByArtifactId(artifactId: string): Promise<CodeStructure | null>;
  getByNodeId(nodeId: string): Promise<CodeStructure[]>;
  getByProjectId(projectId: string): Promise<CodeStructure[]>;
  parseAndStore(request: ParseCodeStructureRequest, nodeId: string, projectId: string): Promise<CodeStructure>;
  update(id: string, updates: Partial<CodeStructure>): Promise<CodeStructure>;
  delete(id: string): Promise<void>;
}

export function createCodeStructureRepository(supabase: SupabaseClient): CodeStructureRepository {
  return {
    async getByArtifactId(artifactId: string): Promise<CodeStructure | null> {
      const { data, error } = await supabase
        .from('code_structures')
        .select('*')
        .eq('artifact_id', artifactId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching code structure:', error);
        throw new Error(`Failed to fetch code structure: ${error.message}`);
      }

      if (!data) {
        return null;
      }

      return {
        id: data.id,
        artifactId: data.artifact_id,
        nodeId: data.node_id,
        projectId: data.project_id,
        entities: data.entities || [],
        relationships: data.relationships || [],
        modules: data.modules || [],
        metrics: data.metrics,
        language: data.language,
        parseDepth: data.parse_depth,
        contentHash: data.content_hash,
        parsedAt: data.parsed_at,
        parserVersion: data.parser_version,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },

    async getByNodeId(nodeId: string): Promise<CodeStructure[]> {
      const { data, error } = await supabase
        .from('code_structures')
        .select('*')
        .eq('node_id', nodeId);

      if (error) {
        console.error('Error fetching code structures for node:', error);
        throw new Error(`Failed to fetch code structures: ${error.message}`);
      }

      return (data || []).map(row => ({
        id: row.id,
        artifactId: row.artifact_id,
        nodeId: row.node_id,
        projectId: row.project_id,
        entities: row.entities || [],
        relationships: row.relationships || [],
        modules: row.modules || [],
        metrics: row.metrics,
        language: row.language,
        parseDepth: row.parse_depth,
        contentHash: row.content_hash,
        parsedAt: row.parsed_at,
        parserVersion: row.parser_version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },

    async getByProjectId(projectId: string): Promise<CodeStructure[]> {
      const { data, error } = await supabase
        .from('code_structures')
        .select('*')
        .eq('project_id', projectId);

      if (error) {
        console.error('Error fetching code structures for project:', error);
        throw new Error(`Failed to fetch code structures: ${error.message}`);
      }

      return (data || []).map(row => ({
        id: row.id,
        artifactId: row.artifact_id,
        nodeId: row.node_id,
        projectId: row.project_id,
        entities: row.entities || [],
        relationships: row.relationships || [],
        modules: row.modules || [],
        metrics: row.metrics,
        language: row.language,
        parseDepth: row.parse_depth,
        contentHash: row.content_hash,
        parsedAt: row.parsed_at,
        parserVersion: row.parser_version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },

    async parseAndStore(
      request: ParseCodeStructureRequest,
      nodeId: string,
      projectId: string
    ): Promise<CodeStructure> {
      const contentHashValue = hashContent(request.artifactContent);

      const existing = await this.getByArtifactId(request.artifactId);
      if (existing && existing.contentHash === contentHashValue) {
        return existing;
      }

      const result = await callEdgeFunction<ParseCodeStructureResponse>(
        'parse-code-structure-v4',
        request as unknown as Record<string, unknown>
      );

      if (!result.success) {
        throw new Error('Code structure parsing failed');
      }

      const { data, error } = await supabase
        .from('code_structures')
        .upsert({
          artifact_id: request.artifactId,
          node_id: nodeId,
          project_id: projectId,
          entities: result.structure.entities,
          relationships: result.structure.relationships,
          modules: result.structure.modules,
          metrics: result.structure.metrics,
          language: request.language,
          parse_depth: request.parseDepth || 'shallow',
          content_hash: contentHashValue,
          parser_version: 'v1',
        }, {
          onConflict: 'artifact_id',
        })
        .select()
        .single();

      if (error) {
        console.error('Error storing code structure:', error);
        throw new Error(`Failed to store code structure: ${error.message}`);
      }

      return {
        id: data.id,
        artifactId: data.artifact_id,
        nodeId: data.node_id,
        projectId: data.project_id,
        entities: data.entities || [],
        relationships: data.relationships || [],
        modules: data.modules || [],
        metrics: data.metrics,
        language: data.language,
        parseDepth: data.parse_depth,
        contentHash: data.content_hash,
        parsedAt: data.parsed_at,
        parserVersion: data.parser_version,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },

    async update(id: string, updates: Partial<CodeStructure>): Promise<CodeStructure> {
      const { data, error } = await supabase
        .from('code_structures')
        .update({
          entities: updates.entities,
          relationships: updates.relationships,
          modules: updates.modules,
          metrics: updates.metrics,
          parse_depth: updates.parseDepth,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Error updating code structure:', error);
        throw new Error(`Failed to update code structure: ${error.message}`);
      }

      return {
        id: data.id,
        artifactId: data.artifact_id,
        nodeId: data.node_id,
        projectId: data.project_id,
        entities: data.entities || [],
        relationships: data.relationships || [],
        modules: data.modules || [],
        metrics: data.metrics,
        language: data.language,
        parseDepth: data.parse_depth,
        contentHash: data.content_hash,
        parsedAt: data.parsed_at,
        parserVersion: data.parser_version,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },

    async delete(id: string): Promise<void> {
      const { error } = await supabase
        .from('code_structures')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting code structure:', error);
        throw new Error(`Failed to delete code structure: ${error.message}`);
      }
    },
  };
}

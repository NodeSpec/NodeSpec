import { useState, useCallback } from 'react';
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';
import type { CodeStructure, CodeEntity, CodeRelationship } from '@nodespec/core/code-structure.js';
import { getRelationshipColor } from '@nodespec/core/code-structure.js';
import { callEdgeFunction } from '../../persistence/supabase/client.js';

interface UseCodeExplosionProps {
  supabaseClient: any;
}

interface CodeExplosionState {
  explodedNodes: Set<string>;
  codeStructures: Map<string, CodeStructure>;
}

export function useCodeExplosion({ supabaseClient }: UseCodeExplosionProps) {
  const [state, setState] = useState<CodeExplosionState>({
    explodedNodes: new Set(),
    codeStructures: new Map(),
  });

  const parseNodeCodeStructure = useCallback(
    async (
      nodeId: string,
      projectId: string,
      artifacts: Array<{ id: string; content: string; path: string; kind: string }>
    ): Promise<void> => {
      console.log('[useCodeExplosion] Starting parse for node:', nodeId);
      console.log('[useCodeExplosion] Artifacts:', artifacts.length);

      const sourceArtifacts = artifacts.filter((a) => a.kind === 'source');

      if (sourceArtifacts.length === 0) {
        console.warn('[useCodeExplosion] No source artifacts to parse');
        throw new Error('No source code artifacts found for this node');
      }

      for (const artifact of sourceArtifacts) {
        console.log('[useCodeExplosion] Parsing artifact:', artifact.path);
        try {
          await parseCodeStructure(
            supabaseClient,
            artifact.id,
            artifact.content,
            detectLanguage(artifact.path),
            projectId,
            nodeId
          );
          console.log('[useCodeExplosion] Successfully parsed artifact:', artifact.id);
        } catch (error) {
          console.error('[useCodeExplosion] Failed to parse artifact:', artifact.id, error);
          throw error;
        }
      }
    },
    [supabaseClient]
  );

  const explodeNode = useCallback(
    async (
      nodeId: string,
      projectId: string,
      artifacts: Array<{ id: string; content: string; path: string; kind: string }>,
      existingNodes: RFNode[],
      existingEdges: RFEdge[]
    ): Promise<{ nodes: RFNode[]; edges: RFEdge[] }> => {
      try {
        console.log('[useCodeExplosion] Starting explosion for node:', nodeId);
        console.log('[useCodeExplosion] Artifacts:', artifacts.length);

        const parentNode = existingNodes.find((n) => n.id === nodeId);
        if (!parentNode) {
          throw new Error('Parent node not found');
        }

        const sourceArtifacts = artifacts.filter((a) => a.kind === 'source');

        if (sourceArtifacts.length === 0) {
          console.warn('[useCodeExplosion] No source artifacts to explode');
          throw new Error('No source code artifacts found for this node');
        }

        const structures: CodeStructure[] = [];

        // Try to fetch existing structures
        for (const artifact of sourceArtifacts) {
          console.log('[useCodeExplosion] Checking for existing structure for artifact:', artifact.id);
          const { data, error } = await supabaseClient
            .from('code_structures')
            .select('*')
            .eq('artifact_id', artifact.id)
            .maybeSingle();

          if (error) {
            console.error('[useCodeExplosion] Error fetching code structure:', error);
          }

          if (data) {
            console.log('[useCodeExplosion] Found existing structure for artifact:', artifact.id);
            structures.push(mapDbRowToCodeStructure(data));
          }
        }

        // If no structures found, parse them now
        if (structures.length === 0) {
          console.log('[useCodeExplosion] No existing structures found, parsing now...');

          for (const artifact of sourceArtifacts) {
            console.log('[useCodeExplosion] Parsing artifact:', artifact.path);
            try {
              const parsedStructure = await parseCodeStructure(
                supabaseClient,
                artifact.id,
                artifact.content,
                detectLanguage(artifact.path),
                projectId,
                nodeId
              );
              structures.push(parsedStructure);
              console.log('[useCodeExplosion] Successfully parsed artifact:', artifact.id);
            } catch (error) {
              console.error('[useCodeExplosion] Failed to parse artifact:', artifact.id, error);
              // Continue with other artifacts even if one fails
            }
          }
        }

        if (structures.length === 0) {
          console.error('[useCodeExplosion] No structures could be parsed or found');
          throw new Error('Failed to parse code structure. Please check console for details.');
        }

        const mergedStructure = mergeCodeStructures(structures);

        const { childNodes, childEdges } = convertCodeStructureToRFElements(
          mergedStructure,
          nodeId,
          parentNode
        );

        setState((prev) => ({
          explodedNodes: new Set([...prev.explodedNodes, nodeId]),
          codeStructures: new Map([...prev.codeStructures, [nodeId, mergedStructure]]),
        }));

        const newNodes = [...existingNodes, ...childNodes];

        const updatedParentNode = existingNodes.find((n) => n.id === nodeId);
        if (updatedParentNode && updatedParentNode.data) {
          updatedParentNode.data = {
            ...updatedParentNode.data,
            exploded: true,
          };
        }

        const newEdges = [...existingEdges, ...childEdges];

        return { nodes: newNodes, edges: newEdges };
      } catch (error) {
        console.error('Error exploding node:', error);
        throw error;
      }
    },
    [supabaseClient]
  );

  const collapseNode = useCallback(
    (
      nodeId: string,
      existingNodes: RFNode[],
      existingEdges: RFEdge[]
    ): { nodes: RFNode[]; edges: RFEdge[] } => {
      const childPrefix = `${nodeId}-entity-`;

      const filteredNodes = existingNodes.filter((n) => !n.id.startsWith(childPrefix));

      const filteredEdges = existingEdges.filter(
        (e) => !e.id.startsWith(childPrefix) && !e.source.startsWith(childPrefix) && !e.target.startsWith(childPrefix)
      );

      const updatedParentNode = filteredNodes.find((n) => n.id === nodeId);
      if (updatedParentNode && updatedParentNode.data) {
        updatedParentNode.data = {
          ...updatedParentNode.data,
          exploded: false,
        };
      }

      setState((prev) => {
        const newExplodedNodes = new Set(prev.explodedNodes);
        newExplodedNodes.delete(nodeId);
        return {
          ...prev,
          explodedNodes: newExplodedNodes,
        };
      });

      return { nodes: filteredNodes, edges: filteredEdges };
    },
    []
  );

  const isNodeExploded = useCallback(
    (nodeId: string): boolean => {
      return state.explodedNodes.has(nodeId);
    },
    [state.explodedNodes]
  );

  return {
    explodeNode,
    collapseNode,
    isNodeExploded,
    parseNodeCodeStructure,
    codeStructures: state.codeStructures,
  };
}

function mapDbRowToCodeStructure(row: any): CodeStructure {
  return {
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
  };
}

function mergeCodeStructures(structures: CodeStructure[]): CodeStructure {
  const allEntities: CodeEntity[] = [];
  const allRelationships: CodeRelationship[] = [];

  for (const structure of structures) {
    allEntities.push(...structure.entities);
    allRelationships.push(...structure.relationships);
  }

  return {
    ...structures[0],
    entities: allEntities,
    relationships: allRelationships,
    metrics: structures[0].metrics,
  };
}

function convertCodeStructureToRFElements(
  structure: CodeStructure,
  parentNodeId: string,
  parentNode: RFNode
): { childNodes: RFNode[]; childEdges: RFEdge[] } {
  const childNodes: RFNode[] = [];
  const childEdges: RFEdge[] = [];

  const baseX = (parentNode.position?.x || 0) + 20;
  const baseY = (parentNode.position?.y || 0) + 60;
  const spacing = 180;
  const verticalSpacing = 120;

  structure.entities.forEach((entity, index) => {
    const row = Math.floor(index / 3);
    const col = index % 3;

    const nodeType =
      entity.type === 'class'
        ? 'classNode'
        : entity.type === 'function'
        ? 'functionNode'
        : entity.type === 'method'
        ? 'methodNode'
        : entity.type === 'interface'
        ? 'interfaceNode'
        : entity.type === 'module'
        ? 'moduleNode'
        : 'functionNode';

    childNodes.push({
      id: `${parentNodeId}-entity-${entity.id}`,
      type: nodeType,
      position: {
        x: baseX + col * spacing,
        y: baseY + row * verticalSpacing,
      },
      parentId: parentNodeId,
      extent: 'parent' as const,
      data: {
        entity,
        label: entity.name,
        complexity: entity.complexity,
        isExported: entity.isExported,
        visibility: entity.visibility,
        parameters: entity.parameters,
        returnType: entity.returnType,
        lineRange: `${entity.lineStart}-${entity.lineEnd}`,
      },
    });
  });

  structure.relationships.forEach((rel, index) => {
    const sourceId = `${parentNodeId}-entity-${rel.from}`;
    const targetId = `${parentNodeId}-entity-${rel.to}`;

    if (childNodes.find((n) => n.id === sourceId) && childNodes.find((n) => n.id === targetId)) {
      childEdges.push({
        id: `${parentNodeId}-entity-edge-${index}`,
        source: sourceId,
        target: targetId,
        type: 'smoothstep',
        animated: rel.strength === 'tight',
        style: {
          stroke: getRelationshipColor(rel.type),
          strokeWidth: rel.strength === 'tight' ? 2 : 1,
        },
        label: rel.type,
        labelStyle: { fontSize: 10, fill: '#666' },
      });
    }
  });

  return { childNodes, childEdges };
}

async function parseCodeStructure(
  supabaseClient: any,
  artifactId: string,
  content: string,
  language: string,
  projectId: string,
  nodeId: string
): Promise<CodeStructure> {
  const result = await callEdgeFunction<{ success: boolean; error?: string; structure: { entities: any[]; relationships: any[]; modules: any[]; metrics: any } }>(
    'parse-code-structure-v4',
    {
      artifactId,
      artifactContent: content,
      language,
      parseDepth: 'shallow',
    }
  );

  if (!result.success) {
    throw new Error(result.error || 'Failed to parse code structure');
  }

  const contentHash = await hashContent(content);

  // Check if artifact exists in database
  const { data: artifactExists } = await supabaseClient
    .from('artifacts')
    .select('id')
    .eq('id', artifactId)
    .maybeSingle();

  console.log('[parseCodeStructure] Artifact exists in DB:', !!artifactExists);

  // Prepare the data object, only include artifact_id if it exists
  const codeStructureData: any = {
    node_id: nodeId,
    project_id: projectId,
    entities: result.structure.entities,
    relationships: result.structure.relationships,
    modules: result.structure.modules,
    metrics: result.structure.metrics,
    language,
    parse_depth: 'shallow',
    content_hash: contentHash,
    parser_version: '1.0.0',
    updated_at: new Date().toISOString(),
  };

  // Only include artifact_id if it exists in the database
  if (artifactExists) {
    codeStructureData.artifact_id = artifactId;
  }

  // Store in database (upsert to handle duplicates)
  // Use content_hash as conflict key when artifact doesn't exist
  const upsertOptions = artifactExists
    ? { onConflict: 'artifact_id' }
    : undefined;

  const { data: upsertedData, error: upsertError } = await supabaseClient
    .from('code_structures')
    .upsert(codeStructureData, upsertOptions)
    .select()
    .single();

  if (upsertError) {
    console.error('[parseCodeStructure] Failed to upsert code structure:', upsertError);
    throw new Error('Failed to store code structure');
  }

  return mapDbRowToCodeStructure(upsertedData);
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    java: 'java',
    go: 'go',
    rs: 'rust',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
  };

  return languageMap[ext || ''] || 'typescript';
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

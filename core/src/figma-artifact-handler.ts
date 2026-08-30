import type { Artifact } from './types.js';
import type { FigmaSyncedNode } from './node-metadata.js';
import { generateUUID, computeContentHash, now } from './utils.js';

export interface FigmaArtifactMetadata extends Record<string, unknown> {
  figmaNodeId: string;
  figmaNodeName: string;
  figmaNodeType: 'FRAME' | 'COMPONENT' | 'INSTANCE' | 'GROUP' | 'PAGE';
  figmaFileKey?: string;
  syncedAt: string;
  exportFormat?: 'png' | 'svg' | 'jpg';
  width?: number;
  height?: number;
}

export function createFigmaArtifact(
  nodeId: string,
  syncedNode: FigmaSyncedNode,
  fileKey?: string
): Artifact {
  const artifactId = generateUUID();
  const path = `designs/${syncedNode.nodeName.toLowerCase().replace(/\s+/g, '-')}.${syncedNode.exportFormat || 'png'}`;

  const metadata: FigmaArtifactMetadata = {
    figmaNodeId: syncedNode.figmaNodeId,
    figmaNodeName: syncedNode.nodeName,
    figmaNodeType: syncedNode.nodeType,
    figmaFileKey: fileKey,
    syncedAt: syncedNode.syncedAt,
    exportFormat: syncedNode.exportFormat,
    width: syncedNode.width,
    height: syncedNode.height,
  };

  const content = JSON.stringify({
    type: 'figma-design',
    nodeId: syncedNode.figmaNodeId,
    nodeName: syncedNode.nodeName,
    imageUrl: syncedNode.imageUrl,
    syncedAt: syncedNode.syncedAt,
  }, null, 2);

  return {
    id: artifactId,
    nodeId,
    kind: 'design',
    path,
    content,
    contentHash: computeContentHash(content),
    uri: syncedNode.imageUrl,
    language: 'json',
    type: 'figma-design',
    createdAt: now(),
    updatedAt: now(),
    metadata,
    status: 'complete',
  };
}

export function isFigmaArtifact(artifact: Artifact): boolean {
  return (
    artifact.kind === 'design' &&
    artifact.type === 'figma-design' &&
    !!artifact.metadata?.figmaNodeId
  );
}

export function getFigmaMetadata(artifact: Artifact): FigmaArtifactMetadata | null {
  if (!isFigmaArtifact(artifact)) {
    return null;
  }
  return artifact.metadata as unknown as FigmaArtifactMetadata;
}

export function updateFigmaArtifact(
  artifact: Artifact,
  syncedNode: FigmaSyncedNode
): Partial<Artifact> {
  const metadata: FigmaArtifactMetadata = {
    ...(artifact.metadata as unknown as FigmaArtifactMetadata),
    syncedAt: syncedNode.syncedAt,
    width: syncedNode.width,
    height: syncedNode.height,
  };

  const content = JSON.stringify({
    type: 'figma-design',
    nodeId: syncedNode.figmaNodeId,
    nodeName: syncedNode.nodeName,
    imageUrl: syncedNode.imageUrl,
    syncedAt: syncedNode.syncedAt,
  }, null, 2);

  return {
    content,
    contentHash: computeContentHash(content),
    uri: syncedNode.imageUrl,
    updatedAt: now(),
    metadata,
  };
}

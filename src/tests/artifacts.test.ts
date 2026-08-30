import { describe, it, expect } from 'vitest';
import { createEmptyGraph, generateUUID, computeContentHash, now } from '@nodespec/core/utils.js';
import {
  createAddNodePatch,
  createAddArtifactPatch,
  createUpdateArtifactPatch,
  createRemoveArtifactPatch,
  createRemoveNodePatch,
} from '@nodespec/core/patch-factory.js';
import { applyPatches } from '@nodespec/core/patch-engine.js';
import type { Node, Artifact } from '@nodespec/core/types.js';

function createTestNode(id: string): Node {
  return {
    id,
    type: 'service',
    label: `Service ${id.slice(0, 8)}`,
    ports: [],
    metadata: {},
  };
}

function createTestArtifact(id: string, nodeId: string, path: string, content: string = ''): Artifact {
  return {
    id,
    nodeId,
    kind: 'source',
    path,
    content,
    contentHash: computeContentHash(content),
    language: 'typescript',
    createdAt: now(),
    updatedAt: now(),
    metadata: {},
  };
}

describe('Artifact Operations', () => {
  describe('add_artifact', () => {
    it('should add an artifact to a node', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();
      const content = 'console.log("hello");';
      const artifact = createTestArtifact(artifactId, nodeId, 'src/index.ts', content);

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(artifact, {
          actorType: 'human',
          summary: 'Add artifact',
        }),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifactId]).toBeDefined();
      expect(result.graph?.artifacts[artifactId].nodeId).toBe(nodeId);
      expect(result.graph?.artifacts[artifactId].path).toBe('src/index.ts');
      expect(result.graph?.artifacts[artifactId].content).toBe(content);
      expect(result.graph?.artifacts[artifactId].contentHash).toBe(computeContentHash(content));
    });

    it('should reject add_artifact on non-existent node', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();
      const artifact = createTestArtifact(artifactId, nodeId, 'src/index.ts');

      const result = applyPatches(graph, [
        createAddArtifactPatch(artifact, {
          actorType: 'human',
          summary: 'Add artifact',
        }),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NODE_NOT_FOUND');
    });

    it('should upsert duplicate artifact paths on same node', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifact1Id = generateUUID();
      const artifact2Id = generateUUID();
      const path = 'src/index.ts';

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(createTestArtifact(artifact1Id, nodeId, path), {
          actorType: 'human',
          summary: 'Add artifact 1',
        }),
        createAddArtifactPatch(createTestArtifact(artifact2Id, nodeId, path), {
          actorType: 'human',
          summary: 'Add artifact 2',
        }),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph!.artifacts[artifact2Id]).toBeDefined();
      expect(result.graph!.artifacts[artifact1Id]).toBeUndefined();
      expect(result.graph!.nodes[nodeId].artifacts).toEqual([artifact2Id]);
    });

    it('should allow same path on different nodes', () => {
      const graph = createEmptyGraph();
      const node1Id = generateUUID();
      const node2Id = generateUUID();
      const artifact1Id = generateUUID();
      const artifact2Id = generateUUID();
      const path = 'src/index.ts';

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(node1Id), {
          actorType: 'human',
          summary: 'Add node 1',
        }),
        createAddNodePatch(createTestNode(node2Id), {
          actorType: 'human',
          summary: 'Add node 2',
        }),
        createAddArtifactPatch(createTestArtifact(artifact1Id, node1Id, path), {
          actorType: 'human',
          summary: 'Add artifact 1',
        }),
        createAddArtifactPatch(createTestArtifact(artifact2Id, node2Id, path), {
          actorType: 'human',
          summary: 'Add artifact 2',
        }),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifact1Id]).toBeDefined();
      expect(result.graph?.artifacts[artifact2Id]).toBeDefined();
    });
  });

  describe('update_artifact', () => {
    it('should update artifact content and recompute contentHash', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();
      const initialContent = 'console.log("hello");';
      const updatedContent = 'console.log("goodbye");';

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(
          createTestArtifact(artifactId, nodeId, 'src/index.ts', initialContent),
          { actorType: 'human', summary: 'Add artifact' }
        ),
        createUpdateArtifactPatch(
          artifactId,
          { content: updatedContent },
          { actorType: 'human', summary: 'Update content' }
        ),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifactId].content).toBe(updatedContent);
      expect(result.graph?.artifacts[artifactId].contentHash).toBe(
        computeContentHash(updatedContent)
      );
      expect(result.graph?.artifacts[artifactId].contentHash).not.toBe(
        computeContentHash(initialContent)
      );
    });

    it('should update artifact path', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(
          createTestArtifact(artifactId, nodeId, 'src/old.ts'),
          { actorType: 'human', summary: 'Add artifact' }
        ),
        createUpdateArtifactPatch(
          artifactId,
          { path: 'src/new.ts' },
          { actorType: 'human', summary: 'Rename file' }
        ),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifactId].path).toBe('src/new.ts');
    });

    it('should reject path update if new path already exists on same node', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifact1Id = generateUUID();
      const artifact2Id = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(
          createTestArtifact(artifact1Id, nodeId, 'src/file1.ts'),
          { actorType: 'human', summary: 'Add artifact 1' }
        ),
        createAddArtifactPatch(
          createTestArtifact(artifact2Id, nodeId, 'src/file2.ts'),
          { actorType: 'human', summary: 'Add artifact 2' }
        ),
        createUpdateArtifactPatch(
          artifact1Id,
          { path: 'src/file2.ts' },
          { actorType: 'human', summary: 'Rename to existing path' }
        ),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ARTIFACT_PATH_EXISTS');
    });

    it('should update artifact kind and language', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(
          createTestArtifact(artifactId, nodeId, 'README.md'),
          { actorType: 'human', summary: 'Add artifact' }
        ),
        createUpdateArtifactPatch(
          artifactId,
          { kind: 'doc', language: 'markdown' },
          { actorType: 'human', summary: 'Update type' }
        ),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifactId].kind).toBe('doc');
      expect(result.graph?.artifacts[artifactId].language).toBe('markdown');
    });

    it('should reject update on non-existent artifact', () => {
      const graph = createEmptyGraph();
      const artifactId = generateUUID();

      const result = applyPatches(graph, [
        createUpdateArtifactPatch(
          artifactId,
          { content: 'new content' },
          { actorType: 'human', summary: 'Update artifact' }
        ),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ARTIFACT_NOT_FOUND');
    });
  });

  describe('delete_artifact', () => {
    it('should delete an artifact', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(
          createTestArtifact(artifactId, nodeId, 'src/index.ts'),
          { actorType: 'human', summary: 'Add artifact' }
        ),
        createRemoveArtifactPatch(artifactId, {
          actorType: 'human',
          summary: 'Delete artifact',
        }),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifactId]).toBeUndefined();
    });

    it('should reject delete on non-existent artifact', () => {
      const graph = createEmptyGraph();
      const artifactId = generateUUID();

      const result = applyPatches(graph, [
        createRemoveArtifactPatch(artifactId, {
          actorType: 'human',
          summary: 'Delete artifact',
        }),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ARTIFACT_NOT_FOUND');
    });
  });

  describe('node deletion with artifacts', () => {
    it('should cascade-delete artifacts when removing node that owns them', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(
          createTestArtifact(artifactId, nodeId, 'src/index.ts'),
          { actorType: 'human', summary: 'Add artifact' }
        ),
        createRemoveNodePatch(nodeId, {
          actorType: 'human',
          summary: 'Delete node',
        }),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.nodes[nodeId]).toBeUndefined();
      expect(result.graph?.artifacts[artifactId]).toBeUndefined();
    });

    it('should allow node deletion after artifacts are deleted', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const result = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(
          createTestArtifact(artifactId, nodeId, 'src/index.ts'),
          { actorType: 'human', summary: 'Add artifact' }
        ),
        createRemoveArtifactPatch(artifactId, {
          actorType: 'human',
          summary: 'Delete artifact',
        }),
        createRemoveNodePatch(nodeId, {
          actorType: 'human',
          summary: 'Delete node',
        }),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.nodes[nodeId]).toBeUndefined();
      expect(result.graph?.artifacts[artifactId]).toBeUndefined();
    });
  });

  describe('precondition validation', () => {
    it('should reject update with mismatched contentHash precondition', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();
      const initialContent = 'initial';

      const intermediate = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(
          createTestArtifact(artifactId, nodeId, 'src/index.ts', initialContent),
          { actorType: 'human', summary: 'Add artifact' }
        ),
        createUpdateArtifactPatch(
          artifactId,
          { content: 'modified by someone else' },
          { actorType: 'human', summary: 'Update content' }
        ),
      ]);

      expect(intermediate.success).toBe(true);

      const result = applyPatches(intermediate.graph!, [
        createUpdateArtifactPatch(
          artifactId,
          { content: 'my changes' },
          {
            actorType: 'human',
            summary: 'Update content with stale hash',
            preconditions: [
              {
                type: 'value_equals',
                path: `artifacts.${artifactId}.contentHash`,
                expected: computeContentHash(initialContent),
              },
            ],
          }
        ),
      ]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PRECONDITION_FAILED');
    });

    it('should accept update with correct contentHash precondition', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();
      const initialContent = 'initial';

      const intermediate = applyPatches(graph, [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(
          createTestArtifact(artifactId, nodeId, 'src/index.ts', initialContent),
          { actorType: 'human', summary: 'Add artifact' }
        ),
      ]);

      expect(intermediate.success).toBe(true);

      const currentHash = intermediate.graph!.artifacts[artifactId].contentHash;
      const updatedContent = 'updated';

      const result = applyPatches(intermediate.graph!, [
        createUpdateArtifactPatch(
          artifactId,
          { content: updatedContent },
          {
            actorType: 'human',
            summary: 'Update content with correct hash',
            preconditions: [
              {
                type: 'value_equals',
                path: `artifacts.${artifactId}.contentHash`,
                expected: currentHash,
              },
            ],
          }
        ),
      ]);

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifactId].content).toBe(updatedContent);
      expect(result.graph?.artifacts[artifactId].contentHash).toBe(computeContentHash(updatedContent));
    });
  });

  describe('branch replay consistency', () => {
    it('should replay artifact operations consistently', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      const patches = [
        createAddNodePatch(createTestNode(nodeId), {
          actorType: 'human',
          summary: 'Add node',
        }),
        createAddArtifactPatch(
          createTestArtifact(artifactId, nodeId, 'src/index.ts', 'v1'),
          { actorType: 'human', summary: 'Create artifact' }
        ),
        createUpdateArtifactPatch(
          artifactId,
          { content: 'v2' },
          { actorType: 'human', summary: 'Update to v2' }
        ),
        createUpdateArtifactPatch(
          artifactId,
          { content: 'v3' },
          { actorType: 'human', summary: 'Update to v3' }
        ),
      ];

      const result1 = applyPatches(graph, patches);
      const result2 = applyPatches(graph, patches);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      expect(result1.graph?.artifacts[artifactId].content).toBe('v3');
      expect(result2.graph?.artifacts[artifactId].content).toBe('v3');

      expect(result1.graph?.artifacts[artifactId].contentHash).toBe(computeContentHash('v3'));
      expect(result2.graph?.artifacts[artifactId].contentHash).toBe(computeContentHash('v3'));

      expect(result1.graph?.artifacts[artifactId].nodeId).toBe(nodeId);
      expect(result2.graph?.artifacts[artifactId].nodeId).toBe(nodeId);

      expect(result1.graph?.artifacts[artifactId].path).toBe('src/index.ts');
      expect(result2.graph?.artifacts[artifactId].path).toBe('src/index.ts');
    });
  });
});

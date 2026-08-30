import { describe, it, expect, beforeEach } from 'vitest';
import { createEmptyGraph, computeContentHash, generateUUID, now } from '@nodespec/core/utils.js';
import { applyPatch } from '@nodespec/core/patch-engine.js';
import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import { createPatchMetadata, createAddArtifactPatch, createUpdateArtifactPatch, createRemoveArtifactPatch } from '@nodespec/core/patch-factory.js';

describe('Artifact Workbench - Domain Layer', () => {
  let graph: Graph;
  let nodeId: string;

  beforeEach(() => {
    graph = createEmptyGraph();
    nodeId = generateUUID();

    const addNodePatch: PatchOperation = {
      type: 'add_node',
      metadata: createPatchMetadata({
        actorType: 'human',
        summary: 'Add test node',
      }),
      payload: {
        id: nodeId,
        type: 'service',
        label: 'Test Node',
        artifacts: [],
        ports: [],
        status: 'draft',
      },
    };

    const result = applyPatch(graph, addNodePatch);
    if (!result.success || !result.graph) {
      throw new Error('Failed to add node');
    }
    graph = result.graph;
  });

  describe('Artifact Content Hash Preconditions', () => {
    it('should accept update when contentHash matches', () => {
      const artifactId = generateUUID();
      const content = 'initial content';
      const contentHash = computeContentHash(content);

      const addPatch = createAddArtifactPatch(
        {
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'test.ts',
          content,
          contentHash,
          createdAt: now(),
          updatedAt: now(),
          status: 'draft',
        },
        { actorType: 'human', summary: 'Add artifact' }
      );

      let result = applyPatch(graph, addPatch);
      expect(result.success).toBe(true);
      graph = result.graph!;

      const newContent = 'updated content';
      const newContentHash = computeContentHash(newContent);

      const updatePatch = createUpdateArtifactPatch(
        artifactId,
        { content: newContent, contentHash: newContentHash, updatedAt: now() },
        {
          actorType: 'human',
          summary: 'Update content',
          preconditions: [{
            type: 'value_equals',
            path: `artifacts.${artifactId}.contentHash`,
            expected: contentHash,
          }],
        }
      );

      result = applyPatch(graph, updatePatch);
      expect(result.success).toBe(true);
      expect(result.graph!.artifacts[artifactId].content).toBe(newContent);
      expect(result.graph!.artifacts[artifactId].contentHash).toBe(newContentHash);
    });

    it('should reject update when contentHash does not match', () => {
      const artifactId = generateUUID();
      const content = 'initial content';
      const contentHash = computeContentHash(content);

      const addPatch = createAddArtifactPatch(
        {
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'test.ts',
          content,
          contentHash,
          createdAt: now(),
          updatedAt: now(),
          status: 'draft',
        },
        { actorType: 'human', summary: 'Add artifact' }
      );

      let result = applyPatch(graph, addPatch);
      graph = result.graph!;

      const newContent = 'updated content';
      const newContentHash = computeContentHash(newContent);

      const updatePatch = createUpdateArtifactPatch(
        artifactId,
        { content: newContent, contentHash: newContentHash, updatedAt: now() },
        {
          actorType: 'human',
          summary: 'Update content',
          preconditions: [{
            type: 'value_equals',
            path: `artifacts.${artifactId}.contentHash`,
            expected: 'wrong-hash',
          }],
        }
      );

      result = applyPatch(graph, updatePatch);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PRECONDITION_FAILED');
    });
  });

  describe('Artifact Deletion Guards', () => {
    it('should block deletion when artifact is referenced by contract schemaRef', () => {
      const artifactId = generateUUID();
      const contractId = generateUUID();

      const addArtifactPatch = createAddArtifactPatch(
        {
          id: artifactId,
          nodeId,
          kind: 'schema',
          path: 'schema.json',
          content: '{}',
          contentHash: computeContentHash('{}'),
          createdAt: now(),
          updatedAt: now(),
          status: 'draft',
        },
        { actorType: 'human', summary: 'Add schema artifact' }
      );

      let result = applyPatch(graph, addArtifactPatch);
      graph = result.graph!;

      const addContractPatch: PatchOperation = {
        type: 'add_contract',
        metadata: createPatchMetadata({
          actorType: 'human',
          summary: 'Add contract',
        }),
        payload: {
          id: contractId,
          kind: 'rest',
          name: 'Test Contract',
          schemaRef: artifactId,
          status: 'draft',
        },
      };

      result = applyPatch(graph, addContractPatch);
      graph = result.graph!;

      const deletePatch = createRemoveArtifactPatch(artifactId, {
        actorType: 'human',
        summary: 'Delete artifact',
      });

      result = applyPatch(graph, deletePatch);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ARTIFACT_REFERENCED_BY_CONTRACT_SCHEMA');
    });

    it('should block deletion when artifact is set as primary for a node', () => {
      const artifactId = generateUUID();

      const addArtifactPatch = createAddArtifactPatch(
        {
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'main.ts',
          content: '',
          contentHash: computeContentHash(''),
          createdAt: now(),
          updatedAt: now(),
          status: 'draft',
        },
        { actorType: 'human', summary: 'Add artifact' }
      );

      let result = applyPatch(graph, addArtifactPatch);
      graph = result.graph!;

      const updateNodePatch: PatchOperation = {
        type: 'update_node',
        metadata: createPatchMetadata({
          actorType: 'human',
          summary: 'Set primary artifact',
        }),
        payload: {
          id: nodeId,
          changes: {
            metadata: {
              primaryArtifacts: {
                source: artifactId,
              },
            },
          },
        },
      };

      result = applyPatch(graph, updateNodePatch);
      graph = result.graph!;

      const deletePatch = createRemoveArtifactPatch(artifactId, {
        actorType: 'human',
        summary: 'Delete artifact',
      });

      result = applyPatch(graph, deletePatch);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ARTIFACT_IS_PRIMARY');
    });

    it('should allow deletion when artifact has no references', () => {
      const artifactId = generateUUID();

      const addArtifactPatch = createAddArtifactPatch(
        {
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'test.ts',
          content: '',
          contentHash: computeContentHash(''),
          createdAt: now(),
          updatedAt: now(),
          status: 'draft',
        },
        { actorType: 'human', summary: 'Add artifact' }
      );

      let result = applyPatch(graph, addArtifactPatch);
      graph = result.graph!;

      const deletePatch = createRemoveArtifactPatch(artifactId, {
        actorType: 'human',
        summary: 'Delete artifact',
      });

      result = applyPatch(graph, deletePatch);
      expect(result.success).toBe(true);
      expect(result.graph!.artifacts[artifactId]).toBeUndefined();
    });
  });

  describe('Contract Schema Reference Validation', () => {
    it('should accept schemaRef when artifact exists', () => {
      const artifactId = generateUUID();
      const contractId = generateUUID();

      const addArtifactPatch = createAddArtifactPatch(
        {
          id: artifactId,
          nodeId,
          kind: 'schema',
          path: 'schema.json',
          content: '{}',
          contentHash: computeContentHash('{}'),
          createdAt: now(),
          updatedAt: now(),
          status: 'draft',
        },
        { actorType: 'human', summary: 'Add schema artifact' }
      );

      let result = applyPatch(graph, addArtifactPatch);
      graph = result.graph!;

      const addContractPatch: PatchOperation = {
        type: 'add_contract',
        metadata: createPatchMetadata({
          actorType: 'human',
          summary: 'Add contract',
        }),
        payload: {
          id: contractId,
          kind: 'rest',
          name: 'Test Contract',
          schemaRef: artifactId,
          status: 'draft',
        },
      };

      result = applyPatch(graph, addContractPatch);
      expect(result.success).toBe(true);
      expect(result.graph!.contracts[contractId].schemaRef).toBe(artifactId);
    });

    it('should reject schemaRef when artifact does not exist', () => {
      const contractId = generateUUID();
      const nonExistentArtifactId = generateUUID();

      const addContractPatch: PatchOperation = {
        type: 'add_contract',
        metadata: createPatchMetadata({
          actorType: 'human',
          summary: 'Add contract',
        }),
        payload: {
          id: contractId,
          kind: 'rest',
          name: 'Test Contract',
          schemaRef: nonExistentArtifactId,
          status: 'draft',
        },
      };

      const result = applyPatch(graph, addContractPatch);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SCHEMA_ARTIFACT_NOT_FOUND');
    });

    it('should allow updating schemaRef to valid artifact', () => {
      const artifactId = generateUUID();
      const contractId = generateUUID();

      const addContractPatch: PatchOperation = {
        type: 'add_contract',
        metadata: createPatchMetadata({
          actorType: 'human',
          summary: 'Add contract',
        }),
        payload: {
          id: contractId,
          kind: 'rest',
          name: 'Test Contract',
          status: 'draft',
        },
      };

      let result = applyPatch(graph, addContractPatch);
      graph = result.graph!;

      const addArtifactPatch = createAddArtifactPatch(
        {
          id: artifactId,
          nodeId,
          kind: 'schema',
          path: 'schema.json',
          content: '{}',
          contentHash: computeContentHash('{}'),
          createdAt: now(),
          updatedAt: now(),
          status: 'draft',
        },
        { actorType: 'human', summary: 'Add schema artifact' }
      );

      result = applyPatch(graph, addArtifactPatch);
      graph = result.graph!;

      const updateContractPatch: PatchOperation = {
        type: 'update_contract',
        metadata: createPatchMetadata({
          actorType: 'human',
          summary: 'Set schemaRef',
        }),
        payload: {
          id: contractId,
          changes: {
            schemaRef: artifactId,
          },
        },
      };

      result = applyPatch(graph, updateContractPatch);
      expect(result.success).toBe(true);
      expect(result.graph!.contracts[contractId].schemaRef).toBe(artifactId);
    });
  });

  describe('Deterministic Content Hash', () => {
    it('should produce same hash for same content', () => {
      const content = 'test content';
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different content', () => {
      const hash1 = computeContentHash('content1');
      const hash2 = computeContentHash('content2');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty content', () => {
      const hash = computeContentHash('');
      expect(hash).toBeDefined();
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle unicode content', () => {
      const content = '\u4F60\u597D\u4E16\u754C \uD83C\uDF0D';
      const hash = computeContentHash(content);
      expect(hash).toBeDefined();
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe('Branch Replay with Artifact Edits', () => {
    it('should replay artifact creation and updates correctly', () => {
      const artifactId = generateUUID();
      const content1 = 'version 1';
      const content2 = 'version 2';

      const patches: PatchOperation[] = [
        createAddArtifactPatch(
          {
            id: artifactId,
            nodeId,
            kind: 'source',
            path: 'test.ts',
            content: content1,
            contentHash: computeContentHash(content1),
            createdAt: now(),
            updatedAt: now(),
            status: 'draft',
          },
          { actorType: 'human', summary: 'Add artifact' }
        ),
        createUpdateArtifactPatch(
          artifactId,
          {
            content: content2,
            contentHash: computeContentHash(content2),
            updatedAt: now(),
          },
          { actorType: 'human', summary: 'Update content' }
        ),
      ];

      let currentGraph = graph;
      for (const patch of patches) {
        const result = applyPatch(currentGraph, patch);
        expect(result.success).toBe(true);
        currentGraph = result.graph!;
      }

      expect(currentGraph.artifacts[artifactId]).toBeDefined();
      expect(currentGraph.artifacts[artifactId].content).toBe(content2);
      expect(currentGraph.artifacts[artifactId].contentHash).toBe(computeContentHash(content2));
    });
  });
});

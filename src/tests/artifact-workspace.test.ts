import { describe, test, expect } from 'vitest';
import { createEmptyGraph, generateUUID, computeContentHash, now } from '@nodespec/core/utils.js';
import { applyPatch } from '@nodespec/core/patch-engine.js';
import {
  createAddNodePatch,
  createAddArtifactPatch,
  createUpdateArtifactPatch,
  createRemoveArtifactPatch,
  createUpdateNodePatch,
} from '@nodespec/core/patch-factory.js';
import type { Artifact } from '@nodespec/core/types.js';

describe('Artifact Workspace Tests', () => {
  describe('Domain Layer - Artifact Creation', () => {
    test('add_artifact creates artifact with correct hash', () => {
      const graph = createEmptyGraph();

      const nodeId = generateUUID();
      const nodeResult = applyPatch(graph, createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test Service',
      }, {
        actorType: 'human',
        summary: 'Add test node',
      }));
      expect(nodeResult.success).toBe(true);

      const content = 'console.log("Hello World");';
      const artifactId = generateUUID();
      const artifact: Artifact = {
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content,
        contentHash: computeContentHash(content),
        createdAt: now(),
        updatedAt: now(),
        metadata: {},
        status: 'draft',
      };

      const result = applyPatch(nodeResult.graph!, createAddArtifactPatch(artifact, {
        actorType: 'human',
        summary: 'Add artifact',
      }));

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifactId]).toBeDefined();
      expect(result.graph?.artifacts[artifactId].contentHash).toBe(computeContentHash(content));
    });

    test('add_artifact fails when node does not exist', () => {
      const graph = createEmptyGraph();
      const artifactId = generateUUID();
      const nonExistentNodeId = generateUUID();

      const artifact: Artifact = {
        id: artifactId,
        nodeId: nonExistentNodeId,
        kind: 'source',
        path: 'main.ts',
        content: '',
        contentHash: computeContentHash(''),
        createdAt: now(),
        updatedAt: now(),
      };

      const result = applyPatch(graph, createAddArtifactPatch(artifact, {
        actorType: 'human',
        summary: 'Add artifact',
      }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NODE_NOT_FOUND');
    });

    test('add_artifact upserts when artifact id already exists', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const nodeResult = applyPatch(graph, createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      }));

      const artifactId = generateUUID();
      const artifact: Artifact = {
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: '',
        contentHash: computeContentHash(''),
        createdAt: now(),
        updatedAt: now(),
      };

      const firstResult = applyPatch(nodeResult.graph!, createAddArtifactPatch(artifact, {
        actorType: 'human',
        summary: 'Add artifact',
      }));
      expect(firstResult.success).toBe(true);

      const secondResult = applyPatch(firstResult.graph!, createAddArtifactPatch(artifact, {
        actorType: 'human',
        summary: 'Add duplicate artifact',
      }));
      expect(secondResult.success).toBe(true);
      expect(secondResult.graph!.artifacts[artifact.id]).toBeDefined();
    });

    test('add_artifact upserts when path already exists on same node', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const nodeResult = applyPatch(graph, createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      }));

      const artifact1: Artifact = {
        id: generateUUID(),
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: '',
        contentHash: computeContentHash(''),
        createdAt: now(),
        updatedAt: now(),
      };

      const firstResult = applyPatch(nodeResult.graph!, createAddArtifactPatch(artifact1, {
        actorType: 'human',
        summary: 'Add artifact 1',
      }));
      expect(firstResult.success).toBe(true);

      const artifact2: Artifact = {
        id: generateUUID(),
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: 'different content',
        contentHash: computeContentHash('different content'),
        createdAt: now(),
        updatedAt: now(),
      };

      const secondResult = applyPatch(firstResult.graph!, createAddArtifactPatch(artifact2, {
        actorType: 'human',
        summary: 'Add artifact 2 with same path',
      }));
      expect(secondResult.success).toBe(true);
      expect(secondResult.graph!.artifacts[artifact2.id]).toBeDefined();
      expect(secondResult.graph!.artifacts[artifact1.id]).toBeUndefined();
    });
  });

  describe('Domain Layer - Artifact Updates', () => {
    test('update_artifact recomputes hash deterministically', () => {
      let graph = createEmptyGraph();
      const nodeId = generateUUID();

      let result = applyPatch(graph, createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      }));
      graph = result.graph!;

      const artifactId = generateUUID();
      const initialContent = 'initial';
      result = applyPatch(graph, createAddArtifactPatch({
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: initialContent,
        contentHash: computeContentHash(initialContent),
        createdAt: now(),
        updatedAt: now(),
      }, {
        actorType: 'human',
        summary: 'Add artifact',
      }));
      graph = result.graph!;

      const newContent = 'updated content';
      result = applyPatch(graph, createUpdateArtifactPatch(artifactId, {
        content: newContent,
      }, {
        actorType: 'human',
        summary: 'Update artifact',
      }));

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifactId].content).toBe(newContent);
      expect(result.graph?.artifacts[artifactId].contentHash).toBe(computeContentHash(newContent));

      const secondUpdateResult = applyPatch(result.graph!, createUpdateArtifactPatch(artifactId, {
        content: newContent,
      }, {
        actorType: 'human',
        summary: 'Update with same content',
      }));
      expect(secondUpdateResult.graph?.artifacts[artifactId].contentHash).toBe(computeContentHash(newContent));
    });

    test('update_artifact with precondition succeeds when hash matches', () => {
      let graph = createEmptyGraph();
      const nodeId = generateUUID();

      let result = applyPatch(graph, createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      }));
      graph = result.graph!;

      const artifactId = generateUUID();
      const initialContent = 'initial';
      const initialHash = computeContentHash(initialContent);
      result = applyPatch(graph, createAddArtifactPatch({
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: initialContent,
        contentHash: initialHash,
        createdAt: now(),
        updatedAt: now(),
      }, {
        actorType: 'human',
        summary: 'Add artifact',
      }));
      graph = result.graph!;

      const newContent = 'updated';
      result = applyPatch(graph, createUpdateArtifactPatch(artifactId, {
        content: newContent,
      }, {
        actorType: 'human',
        summary: 'Update with precondition',
        preconditions: [
          {
            type: 'value_equals',
            path: `artifacts.${artifactId}.contentHash`,
            expected: initialHash,
          },
        ],
      }));

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifactId].content).toBe(newContent);
    });

    test('update_artifact with precondition fails when hash mismatch', () => {
      let graph = createEmptyGraph();
      const nodeId = generateUUID();

      let result = applyPatch(graph, createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      }));
      graph = result.graph!;

      const artifactId = generateUUID();
      const initialContent = 'initial';
      result = applyPatch(graph, createAddArtifactPatch({
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: initialContent,
        contentHash: computeContentHash(initialContent),
        createdAt: now(),
        updatedAt: now(),
      }, {
        actorType: 'human',
        summary: 'Add artifact',
      }));
      graph = result.graph!;

      const intermediateContent = 'someone else updated this';
      result = applyPatch(graph, createUpdateArtifactPatch(artifactId, {
        content: intermediateContent,
      }, {
        actorType: 'human',
        summary: 'Update by someone else',
      }));
      graph = result.graph!;

      const myNewContent = 'my update';
      const wrongHash = computeContentHash('initial');
      result = applyPatch(graph, createUpdateArtifactPatch(artifactId, {
        content: myNewContent,
      }, {
        actorType: 'human',
        summary: 'Update with stale precondition',
        preconditions: [
          {
            type: 'value_equals',
            path: `artifacts.${artifactId}.contentHash`,
            expected: wrongHash,
          },
        ],
      }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PRECONDITION_FAILED');
      expect(graph.artifacts[artifactId].content).toBe(intermediateContent);
    });
  });

  describe('Domain Layer - Artifact Deletion', () => {
    test('remove_artifact succeeds even when referenced by node', () => {
      let graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      let result = applyPatch(graph, createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
        artifacts: [],
      }, {
        actorType: 'human',
        summary: 'Add node',
      }));
      graph = result.graph!;

      result = applyPatch(graph, createAddArtifactPatch({
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: '',
        contentHash: computeContentHash(''),
        createdAt: now(),
        updatedAt: now(),
      }, {
        actorType: 'human',
        summary: 'Add artifact',
      }));
      graph = result.graph!;

      result = applyPatch(graph, createUpdateNodePatch(nodeId, {
        artifacts: [artifactId],
      }, {
        actorType: 'human',
        summary: 'Link artifact to node',
      }));
      graph = result.graph!;

      result = applyPatch(graph, createRemoveArtifactPatch(artifactId, {
        actorType: 'human',
        summary: 'Remove artifact',
      }));

      expect(result.success).toBe(true);
      expect(result.graph!.artifacts[artifactId]).toBeUndefined();
    });

    test('remove_artifact succeeds when not referenced', () => {
      let graph = createEmptyGraph();
      const nodeId = generateUUID();
      const artifactId = generateUUID();

      let result = applyPatch(graph, createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      }));
      graph = result.graph!;

      result = applyPatch(graph, createAddArtifactPatch({
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: '',
        contentHash: computeContentHash(''),
        createdAt: now(),
        updatedAt: now(),
      }, {
        actorType: 'human',
        summary: 'Add artifact',
      }));
      graph = result.graph!;

      result = applyPatch(graph, createRemoveArtifactPatch(artifactId, {
        actorType: 'human',
        summary: 'Remove artifact',
      }));

      expect(result.success).toBe(true);
      expect(result.graph?.artifacts[artifactId]).toBeUndefined();
    });
  });

  describe('Helper Functions', () => {
    test('computeContentHash is deterministic', () => {
      const content = 'test content';
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);
      expect(hash1).toBe(hash2);
    });

    test('computeContentHash produces different hashes for different content', () => {
      const content1 = 'test content 1';
      const content2 = 'test content 2';
      const hash1 = computeContentHash(content1);
      const hash2 = computeContentHash(content2);
      expect(hash1).not.toBe(hash2);
    });
  });
});

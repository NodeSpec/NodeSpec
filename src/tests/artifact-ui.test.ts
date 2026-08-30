import { describe, test, expect } from 'vitest';
import { createBranchStore } from '../ui/store/branch-store.js';
import { createEmptyGraph, generateUUID, computeContentHash, now } from '@nodespec/core/utils.js';
import {
  createAddNodePatch,
  createAddArtifactPatch,
  createUpdateArtifactPatch,
  createUpdateNodePatch,
} from '@nodespec/core/patch-factory.js';

describe('Artifact UI Tests', () => {
  describe('BranchStore - Ephemeral Editor State', () => {
    test('openArtifact sets selectedArtifactId and initializes editor buffer', () => {
      const graph = createEmptyGraph();
      const store = createBranchStore(graph);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      })]);

      const artifactId = generateUUID();
      const content = 'initial content';
      store.proposePatches([createAddArtifactPatch({
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content,
        contentHash: computeContentHash(content),
        createdAt: now(),
        updatedAt: now(),
      }, {
        actorType: 'human',
        summary: 'Add artifact',
      })]);

      store.openArtifact(artifactId);

      const state = store.getState();
      expect(state.selectedArtifactId).toBe(artifactId);
      expect(state.editorBuffer.get(artifactId)).toBe(content);
    });

    test('openArtifact emits NO patches', () => {
      const graph = createEmptyGraph();
      const store = createBranchStore(graph);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      })]);

      const artifactId = generateUUID();
      store.proposePatches([createAddArtifactPatch({
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: 'test',
        contentHash: computeContentHash('test'),
        createdAt: now(),
        updatedAt: now(),
      }, {
        actorType: 'human',
        summary: 'Add artifact',
      })]);

      const initialPatchCount = store.getState().activeBranch.patches.length;
      store.openArtifact(artifactId);
      const finalPatchCount = store.getState().activeBranch.patches.length;

      expect(finalPatchCount).toBe(initialPatchCount);
    });

    test('setEditorContent updates editorBuffer only, no graph mutation', () => {
      const graph = createEmptyGraph();
      const store = createBranchStore(graph);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      })]);

      const artifactId = generateUUID();
      const initialContent = 'initial';
      store.proposePatches([createAddArtifactPatch({
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
      })]);

      store.openArtifact(artifactId);

      const newContent = 'updated content';
      store.setEditorContent(artifactId, newContent);

      const state = store.getState();
      expect(state.editorBuffer.get(artifactId)).toBe(newContent);
      expect(state.derivedGraph.artifacts[artifactId].content).toBe(initialContent);
      expect(state.editorDirty.get(artifactId)).toBe(true);
    });

    test('isEditorDirty returns true when content changed', () => {
      const graph = createEmptyGraph();
      const store = createBranchStore(graph);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      })]);

      const artifactId = generateUUID();
      const initialContent = 'initial';
      store.proposePatches([createAddArtifactPatch({
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
      })]);

      store.openArtifact(artifactId);
      expect(store.isEditorDirty(artifactId)).toBe(false);

      store.setEditorContent(artifactId, 'updated');
      expect(store.isEditorDirty(artifactId)).toBe(true);

      store.setEditorContent(artifactId, initialContent);
      expect(store.isEditorDirty(artifactId)).toBe(false);
    });

    test('closeArtifact clears selectedArtifactId but preserves buffer', () => {
      const graph = createEmptyGraph();
      const store = createBranchStore(graph);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      })]);

      const artifactId = generateUUID();
      store.proposePatches([createAddArtifactPatch({
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: 'test',
        contentHash: computeContentHash('test'),
        createdAt: now(),
        updatedAt: now(),
      }, {
        actorType: 'human',
        summary: 'Add artifact',
      })]);

      store.openArtifact(artifactId);
      store.setEditorContent(artifactId, 'modified');

      store.closeArtifact();

      const state = store.getState();
      expect(state.selectedArtifactId).toBeNull();
      expect(state.editorBuffer.get(artifactId)).toBe('modified');
    });
  });

  describe('BranchStore - Artifact Patch Operations', () => {
    test('saving emits update_artifact patch with precondition', () => {
      const graph = createEmptyGraph();
      const store = createBranchStore(graph);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      })]);

      const artifactId = generateUUID();
      const initialContent = 'initial';
      const initialHash = computeContentHash(initialContent);
      store.proposePatches([createAddArtifactPatch({
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
      })]);

      const newContent = 'updated content';
      const updatePatch = createUpdateArtifactPatch(artifactId, {
        content: newContent,
      }, {
        actorType: 'human',
        summary: 'Update artifact',
        preconditions: [
          {
            type: 'value_equals',
            path: `artifacts.${artifactId}.contentHash`,
            expected: initialHash,
          },
        ],
      });

      const result = store.proposePatches([updatePatch]);
      expect(result.success).toBe(true);

      const state = store.getState();
      expect(state.derivedGraph.artifacts[artifactId].content).toBe(newContent);
      expect(state.derivedGraph.artifacts[artifactId].contentHash).toBe(computeContentHash(newContent));
    });

    test('precondition failure results in patch rejected', () => {
      const graph = createEmptyGraph();
      const store = createBranchStore(graph);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      })]);

      const artifactId = generateUUID();
      const initialContent = 'initial';
      store.proposePatches([createAddArtifactPatch({
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
      })]);

      store.proposePatches([createUpdateArtifactPatch(artifactId, {
        content: 'someone else updated',
      }, {
        actorType: 'human',
        summary: 'Update by someone else',
      })]);

      const myUpdate = createUpdateArtifactPatch(artifactId, {
        content: 'my update',
      }, {
        actorType: 'human',
        summary: 'My update',
        preconditions: [
          {
            type: 'value_equals',
            path: `artifacts.${artifactId}.contentHash`,
            expected: computeContentHash(initialContent),
          },
        ],
      });

      const result = store.proposePatches([myUpdate]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Precondition failed');

      const state = store.getState();
      expect(state.derivedGraph.artifacts[artifactId].content).toBe('someone else updated');
      expect(state.lastError).not.toBeNull();
    });

    test('local edits retained after precondition failure', () => {
      const graph = createEmptyGraph();
      const store = createBranchStore(graph);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      })]);

      const artifactId = generateUUID();
      store.proposePatches([createAddArtifactPatch({
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: 'original',
        contentHash: computeContentHash('original'),
        createdAt: now(),
        updatedAt: now(),
      }, {
        actorType: 'human',
        summary: 'Add artifact',
      })]);

      store.openArtifact(artifactId);
      const myLocalEdit = 'my local changes';
      store.setEditorContent(artifactId, myLocalEdit);

      store.proposePatches([createUpdateArtifactPatch(artifactId, {
        content: 'server update',
      }, {
        actorType: 'ai',
        summary: 'Server update',
      })]);

      const myUpdatePatch = createUpdateArtifactPatch(artifactId, {
        content: myLocalEdit,
      }, {
        actorType: 'human',
        summary: 'My update',
        preconditions: [
          {
            type: 'value_equals',
            path: `artifacts.${artifactId}.contentHash`,
            expected: computeContentHash('original'),
          },
        ],
      });

      const result = store.proposePatches([myUpdatePatch]);
      expect(result.success).toBe(false);

      const state = store.getState();
      expect(state.editorBuffer.get(artifactId)).toBe(myLocalEdit);
      expect(state.derivedGraph.artifacts[artifactId].content).toBe('server update');
    });
  });

  describe('BranchStore - resetBranch clears editor state', () => {
    test('resetBranch clears all editor state', () => {
      const graph = createEmptyGraph();
      const store = createBranchStore(graph);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
      }, {
        actorType: 'human',
        summary: 'Add node',
      })]);

      const artifactId = generateUUID();
      store.proposePatches([createAddArtifactPatch({
        id: artifactId,
        nodeId,
        kind: 'source',
        path: 'main.ts',
        content: 'test',
        contentHash: computeContentHash('test'),
        createdAt: now(),
        updatedAt: now(),
      }, {
        actorType: 'human',
        summary: 'Add artifact',
      })]);

      store.openArtifact(artifactId);
      store.setEditorContent(artifactId, 'modified');

      store.resetBranch();

      const state = store.getState();
      expect(state.selectedArtifactId).toBeNull();
      expect(state.editorBuffer.size).toBe(0);
      expect(state.editorDirty.size).toBe(0);
    });
  });

  describe('Artifact Linking to Nodes', () => {
    test('artifact is added to node artifacts array on creation', () => {
      const graph = createEmptyGraph();
      const store = createBranchStore(graph);

      const nodeId = generateUUID();
      store.proposePatches([createAddNodePatch({
        id: nodeId,
        type: 'service',
        label: 'Test',
        artifacts: [],
      }, {
        actorType: 'human',
        summary: 'Add node',
      })]);

      const artifactId = generateUUID();
      store.proposePatches([
        createAddArtifactPatch({
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'main.ts',
          content: 'test',
          contentHash: computeContentHash('test'),
          createdAt: now(),
          updatedAt: now(),
        }, {
          actorType: 'human',
          summary: 'Add artifact',
        }),
        createUpdateNodePatch(nodeId, {
          artifacts: [artifactId],
        }, {
          actorType: 'human',
          summary: 'Link artifact to node',
        })
      ]);

      const state = store.getState();
      const node = state.derivedGraph.nodes[nodeId];
      expect(node.artifacts).toContain(artifactId);
    });
  });
});

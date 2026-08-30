import { describe, it, expect } from 'vitest';
import { createEmptyGraph, generateUUID, now, computeContentHash } from '@nodespec/core/utils.js';
import { applyPatch } from '@nodespec/core/patch-engine.js';
import {
  createAddArtifactPatch,
  createUpdateArtifactPatch,
  createRemoveArtifactPatch,
  createAddNodePatch,
} from '@nodespec/core/patch-factory.js';
import type { Artifact, Node } from '@nodespec/core/types.js';

describe('Artifact Lifecycle', () => {
  it('should add artifact with all supported kinds', () => {
    let graph = createEmptyGraph();

    const nodeId = generateUUID();
    const node: Node = {
      id: nodeId,
      type: 'service',
      label: 'Test Service',
      status: 'draft',
    };

    const addNodePatch = createAddNodePatch(node, {
      actorType: 'human',
      summary: 'Add test node',
    });

    const result = applyPatch(graph, addNodePatch);
    expect(result.success).toBe(true);
    graph = result.graph!;

    const kinds = ['source', 'schema', 'doc', 'config', 'build'] as const;

    for (const kind of kinds) {
      const artifact: Artifact = {
        id: generateUUID(),
        nodeId,
        kind,
        path: `test.${kind}`,
        content: `${kind} content`,
        contentHash: computeContentHash(`${kind} content`),
        createdAt: now(),
        updatedAt: now(),
        status: 'draft',
      };

      const patch = createAddArtifactPatch(artifact, {
        actorType: 'human',
        summary: `Add ${kind} artifact`,
      });

      const addResult = applyPatch(graph, patch);
      expect(addResult.success).toBe(true);
      graph = addResult.graph!;

      expect(graph.artifacts[artifact.id]).toBeDefined();
      expect(graph.artifacts[artifact.id].kind).toBe(kind);
    }
  });

  it('should mark artifact as complete', () => {
    let graph = createEmptyGraph();

    const nodeId = generateUUID();
    const node: Node = {
      id: nodeId,
      type: 'service',
      label: 'Test Service',
      status: 'draft',
    };

    const addNodePatch = createAddNodePatch(node, {
      actorType: 'human',
      summary: 'Add test node',
    });

    let result = applyPatch(graph, addNodePatch);
    graph = result.graph!;

    const artifact: Artifact = {
      id: generateUUID(),
      nodeId,
      kind: 'source',
      path: 'main.ts',
      content: 'console.log("hello")',
      contentHash: computeContentHash('console.log("hello")'),
      createdAt: now(),
      updatedAt: now(),
      status: 'draft',
    };

    const addArtifactPatch = createAddArtifactPatch(artifact, {
      actorType: 'human',
      summary: 'Add artifact',
    });

    result = applyPatch(graph, addArtifactPatch);
    graph = result.graph!;

    const markCompletePatch = createUpdateArtifactPatch(
      artifact.id,
      { status: 'complete' },
      {
        actorType: 'human',
        summary: 'Mark artifact complete',
      }
    );

    result = applyPatch(graph, markCompletePatch);
    expect(result.success).toBe(true);
    graph = result.graph!;
    expect(graph.artifacts[artifact.id].status).toBe('complete');
  });

  it('should prevent updating completed artifacts', () => {
    let graph = createEmptyGraph();

    const nodeId = generateUUID();
    const node: Node = {
      id: nodeId,
      type: 'service',
      label: 'Test Service',
      status: 'draft',
    };

    const addNodePatch = createAddNodePatch(node, {
      actorType: 'human',
      summary: 'Add test node',
    });

    let result = applyPatch(graph, addNodePatch);
    graph = result.graph!;

    const artifact: Artifact = {
      id: generateUUID(),
      nodeId,
      kind: 'source',
      path: 'main.ts',
      content: 'original content',
      contentHash: computeContentHash('original content'),
      createdAt: now(),
      updatedAt: now(),
      status: 'complete',
    };

    const addArtifactPatch = createAddArtifactPatch(artifact, {
      actorType: 'human',
      summary: 'Add complete artifact',
    });

    result = applyPatch(graph, addArtifactPatch);
    graph = result.graph!;

    const updatePatch = createUpdateArtifactPatch(
      artifact.id,
      { content: 'new content' },
      {
        actorType: 'human',
        summary: 'Try to update complete artifact',
      }
    );

    result = applyPatch(graph, updatePatch);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ARTIFACT_IMMUTABLE');
  });

  it('should allow reverting complete artifact to draft', () => {
    let graph = createEmptyGraph();

    const nodeId = generateUUID();
    const node: Node = {
      id: nodeId,
      type: 'service',
      label: 'Test Service',
      status: 'draft',
    };

    const addNodePatch = createAddNodePatch(node, {
      actorType: 'human',
      summary: 'Add test node',
    });

    let result = applyPatch(graph, addNodePatch);
    graph = result.graph!;

    const artifact: Artifact = {
      id: generateUUID(),
      nodeId,
      kind: 'source',
      path: 'main.ts',
      content: 'original content',
      contentHash: computeContentHash('original content'),
      createdAt: now(),
      updatedAt: now(),
      status: 'complete',
    };

    const addArtifactPatch = createAddArtifactPatch(artifact, {
      actorType: 'human',
      summary: 'Add complete artifact',
    });

    result = applyPatch(graph, addArtifactPatch);
    graph = result.graph!;

    const revertPatch = createUpdateArtifactPatch(
      artifact.id,
      { status: 'draft' },
      {
        actorType: 'human',
        summary: 'Revert to draft',
      }
    );

    result = applyPatch(graph, revertPatch);
    expect(result.success).toBe(true);
    graph = result.graph!;
    expect(graph.artifacts[artifact.id].status).toBe('draft');

    const updatePatch = createUpdateArtifactPatch(
      artifact.id,
      { content: 'new content' },
      {
        actorType: 'human',
        summary: 'Update artifact',
      }
    );

    result = applyPatch(graph, updatePatch);
    expect(result.success).toBe(true);
    graph = result.graph!;
    expect(graph.artifacts[artifact.id].content).toBe('new content');
  });

  it('should prevent deleting completed artifacts', () => {
    let graph = createEmptyGraph();

    const nodeId = generateUUID();
    const node: Node = {
      id: nodeId,
      type: 'service',
      label: 'Test Service',
      status: 'draft',
    };

    const addNodePatch = createAddNodePatch(node, {
      actorType: 'human',
      summary: 'Add test node',
    });

    let result = applyPatch(graph, addNodePatch);
    graph = result.graph!;

    const artifact: Artifact = {
      id: generateUUID(),
      nodeId,
      kind: 'source',
      path: 'main.ts',
      content: 'content',
      contentHash: computeContentHash('content'),
      createdAt: now(),
      updatedAt: now(),
      status: 'complete',
    };

    const addArtifactPatch = createAddArtifactPatch(artifact, {
      actorType: 'human',
      summary: 'Add complete artifact',
    });

    result = applyPatch(graph, addArtifactPatch);
    graph = result.graph!;

    const removePatch = createRemoveArtifactPatch(artifact.id, {
      actorType: 'human',
      summary: 'Try to remove complete artifact',
    });

    result = applyPatch(graph, removePatch);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ARTIFACT_IMMUTABLE');
  });

  it('should prevent deleting artifacts referenced by contracts', () => {
    let graph = createEmptyGraph();

    const nodeId = generateUUID();
    const node: Node = {
      id: nodeId,
      type: 'service',
      label: 'Test Service',
      status: 'draft',
    };

    const addNodePatch = createAddNodePatch(node, {
      actorType: 'human',
      summary: 'Add test node',
    });

    let result = applyPatch(graph, addNodePatch);
    graph = result.graph!;

    const artifact: Artifact = {
      id: generateUUID(),
      nodeId,
      kind: 'schema',
      path: 'schema.json',
      content: '{}',
      contentHash: computeContentHash('{}'),
      createdAt: now(),
      updatedAt: now(),
      status: 'draft',
    };

    const addArtifactPatch = createAddArtifactPatch(artifact, {
      actorType: 'human',
      summary: 'Add schema artifact',
    });

    result = applyPatch(graph, addArtifactPatch);
    graph = result.graph!;

    const contractId = generateUUID();
    graph.contracts[contractId] = {
      id: contractId,
      kind: 'rest',
      name: 'Test Contract',
      metadata: {
        artifactId: artifact.id,
      },
    };

    const removePatch = createRemoveArtifactPatch(artifact.id, {
      actorType: 'human',
      summary: 'Try to remove referenced artifact',
    });

    result = applyPatch(graph, removePatch);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ARTIFACT_REFERENCED_BY_CONTRACT');
  });

  it('should upsert add_artifact when a suggested artifact already exists with same path on node', () => {
    let graph = createEmptyGraph();

    const nodeId = generateUUID();
    const node: Node = {
      id: nodeId,
      type: 'service',
      label: 'Test Service',
      status: 'draft',
    };

    const addNodePatch = createAddNodePatch(node, {
      actorType: 'human',
      summary: 'Add test node',
    });

    let result = applyPatch(graph, addNodePatch);
    graph = result.graph!;

    const suggestedArtifact: Artifact = {
      id: generateUUID(),
      nodeId,
      kind: 'source',
      path: 'src/index.ts',
      content: undefined,
      contentHash: undefined,
      createdAt: now(),
      updatedAt: now(),
      status: 'suggested',
      description: 'Application entry point',
    };

    const addSuggestedPatch = createAddArtifactPatch(suggestedArtifact, {
      actorType: 'human',
      summary: 'Add suggested artifact',
    });

    result = applyPatch(graph, addSuggestedPatch);
    expect(result.success).toBe(true);
    graph = result.graph!;

    const duplicateArtifact: Artifact = {
      id: generateUUID(),
      nodeId,
      kind: 'source',
      path: 'src/index.ts',
      content: '',
      contentHash: computeContentHash(''),
      createdAt: now(),
      updatedAt: now(),
      status: 'draft',
    };

    const addDuplicatePatch = createAddArtifactPatch(duplicateArtifact, {
      actorType: 'human',
      summary: 'Try to add duplicate path',
    });

    result = applyPatch(graph, addDuplicatePatch);
    expect(result.success).toBe(true);
    graph = result.graph!;
    expect(graph.artifacts[duplicateArtifact.id]).toBeDefined();
    expect(graph.artifacts[suggestedArtifact.id]).toBeUndefined();
  });

  it('should promote suggested artifact to draft via update_artifact', () => {
    let graph = createEmptyGraph();

    const nodeId = generateUUID();
    const node: Node = {
      id: nodeId,
      type: 'service',
      label: 'Test Service',
      status: 'draft',
    };

    const addNodePatch = createAddNodePatch(node, {
      actorType: 'human',
      summary: 'Add test node',
    });

    let result = applyPatch(graph, addNodePatch);
    graph = result.graph!;

    const suggestedArtifact: Artifact = {
      id: generateUUID(),
      nodeId,
      kind: 'source',
      path: 'src/index.ts',
      content: undefined,
      contentHash: undefined,
      createdAt: now(),
      updatedAt: now(),
      status: 'suggested',
      description: 'Application entry point',
    };

    const addSuggestedPatch = createAddArtifactPatch(suggestedArtifact, {
      actorType: 'human',
      summary: 'Add suggested artifact',
    });

    result = applyPatch(graph, addSuggestedPatch);
    expect(result.success).toBe(true);
    graph = result.graph!;
    expect(graph.artifacts[suggestedArtifact.id].status).toBe('suggested');

    const promotePatch = createUpdateArtifactPatch(
      suggestedArtifact.id,
      { status: 'draft' },
      {
        actorType: 'human',
        summary: 'Promote suggested artifact to draft',
      }
    );

    result = applyPatch(graph, promotePatch);
    expect(result.success).toBe(true);
    graph = result.graph!;
    expect(graph.artifacts[suggestedArtifact.id].status).toBe('draft');
    expect(graph.artifacts[suggestedArtifact.id].path).toBe('src/index.ts');
  });

  it('should allow adding artifact after suggested one with same path is removed', () => {
    let graph = createEmptyGraph();

    const nodeId = generateUUID();
    const node: Node = {
      id: nodeId,
      type: 'service',
      label: 'Test Service',
      status: 'draft',
    };

    const addNodePatch = createAddNodePatch(node, {
      actorType: 'human',
      summary: 'Add test node',
    });

    let result = applyPatch(graph, addNodePatch);
    graph = result.graph!;

    const suggestedArtifact: Artifact = {
      id: generateUUID(),
      nodeId,
      kind: 'source',
      path: 'src/index.ts',
      content: undefined,
      contentHash: undefined,
      createdAt: now(),
      updatedAt: now(),
      status: 'suggested',
    };

    const addSuggestedPatch = createAddArtifactPatch(suggestedArtifact, {
      actorType: 'human',
      summary: 'Add suggested artifact',
    });

    result = applyPatch(graph, addSuggestedPatch);
    graph = result.graph!;

    const removePatch = createRemoveArtifactPatch(suggestedArtifact.id, {
      actorType: 'human',
      summary: 'Remove suggested artifact',
    });

    result = applyPatch(graph, removePatch);
    expect(result.success).toBe(true);
    graph = result.graph!;

    const newArtifact: Artifact = {
      id: generateUUID(),
      nodeId,
      kind: 'source',
      path: 'src/index.ts',
      content: '',
      contentHash: computeContentHash(''),
      createdAt: now(),
      updatedAt: now(),
      status: 'draft',
    };

    const addNewPatch = createAddArtifactPatch(newArtifact, {
      actorType: 'human',
      summary: 'Add fresh artifact after removal',
    });

    result = applyPatch(graph, addNewPatch);
    expect(result.success).toBe(true);
    graph = result.graph!;
    expect(graph.artifacts[newArtifact.id].status).toBe('draft');
    expect(graph.artifacts[newArtifact.id].path).toBe('src/index.ts');
  });
});

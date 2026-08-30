import { describe, it, expect } from 'vitest';
import { createEmptyGraph, generateUUID, computeContentHash, now } from '@nodespec/core/utils.js';
import { createAddNodePatch, createAddArtifactPatch } from '@nodespec/core/patch-factory.js';
import { applyPatches } from '@nodespec/core/patch-engine.js';
import { validateAIPatches, sanitizeAIPatchMetadata } from '@nodespec/core/ai-validation.js';
import type { Artifact } from '@nodespec/core/types.js';

describe('AI Integration Flow', () => {
  it('should apply AI-generated update_artifact patches correctly', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    const artifactId = generateUUID();
    const initialContent = 'const x = 1;';
    const updatedContent = 'const x = 1;\nconst y = 2;';

    const artifact: Artifact = {
      id: artifactId,
      nodeId,
      kind: 'source',
      path: 'index.ts',
      content: initialContent,
      contentHash: computeContentHash(initialContent),
      createdAt: now(),
      updatedAt: now(),
    };

    const setupResult = applyPatches(graph, [
      createAddNodePatch(
        {
          id: nodeId,
          type: 'service',
          label: 'Test Service',
        },
        { actorType: 'human', summary: 'Add node' }
      ),
      createAddArtifactPatch(artifact, { actorType: 'human', summary: 'Add artifact' }),
    ]);

    expect(setupResult.success).toBe(true);
    expect(setupResult.graph?.artifacts[artifactId].content).toBe(initialContent);

    const aiGeneratedPatch = {
      type: 'update_artifact',
      metadata: {
        id: generateUUID(),
        actorType: 'ai',
        summary: `AI improve: index.ts`,
        timestamp: now(),
      },
      payload: {
        id: artifactId,
        changes: {
          content: updatedContent,
          contentHash: computeContentHash(updatedContent),
          updatedAt: now(),
        },
      },
    };

    const validation = validateAIPatches([aiGeneratedPatch]);
    console.log('Validation result:', JSON.stringify(validation, null, 2));

    expect(validation.valid).toBe(true);
    expect(validation.validPatches.length).toBe(1);

    const sanitized = validation.validPatches.map(sanitizeAIPatchMetadata);

    const updateResult = applyPatches(setupResult.graph!, sanitized);
    console.log('Update result:', updateResult);

    if (!updateResult.success) {
      console.error('Update failed:', updateResult.error);
    }

    expect(updateResult.success).toBe(true);
    expect(updateResult.graph?.artifacts[artifactId].content).toBe(updatedContent);
  });

  it('should match exact format of AI edge function patches', () => {
    const graph = createEmptyGraph();
    const nodeId = generateUUID();
    const artifactId = generateUUID();
    const originalContent = 'function hello() {}';
    const trimmedContent = 'function hello() {\n  console.log("improved");\n}';
    const timestamp = new Date().toISOString();

    const artifact: Artifact = {
      id: artifactId,
      nodeId,
      kind: 'source',
      path: 'test.js',
      content: originalContent,
      contentHash: computeContentHash(originalContent),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const setupResult = applyPatches(graph, [
      createAddNodePatch(
        { id: nodeId, type: 'service', label: 'Test' },
        { actorType: 'human', summary: 'Add node' }
      ),
      createAddArtifactPatch(artifact, { actorType: 'human', summary: 'Add artifact' }),
    ]);

    expect(setupResult.success).toBe(true);

    const patch = {
      type: 'update_artifact',
      metadata: {
        id: generateUUID(),
        actorType: 'ai',
        summary: `AI improve: test.js`,
        timestamp,
      },
      payload: {
        id: artifactId,
        changes: {
          content: trimmedContent,
          contentHash: computeContentHash(trimmedContent),
          updatedAt: timestamp,
        },
      },
    };

    const validation = validateAIPatches([patch]);
    expect(validation.valid).toBe(true);

    const result = applyPatches(setupResult.graph!, validation.validPatches);
    expect(result.success).toBe(true);
    expect(result.graph?.artifacts[artifactId].content).toBe(trimmedContent);
  });
});

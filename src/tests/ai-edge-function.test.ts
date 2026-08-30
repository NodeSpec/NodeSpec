import { describe, it, expect } from 'vitest';
import { PatchOperationSchema } from '@nodespec/core/schemas.js';
import type { UpdateArtifactPatch } from '@nodespec/core/types.js';
import { computeContentHash, generateUUID } from '@nodespec/core/utils.js';

describe('AI Edge Function Patch Format', () => {
  it('should generate valid update_artifact patch structure', () => {
    const artifactId = generateUUID();
    const content = 'function test() { return 42; }';
    const contentHash = computeContentHash(content);
    const timestamp = new Date().toISOString();

    const patch = {
      type: 'update_artifact',
      metadata: {
        id: generateUUID(),
        actorType: 'ai',
        summary: 'AI improve: test.ts',
        timestamp,
      },
      payload: {
        id: artifactId,
        changes: {
          content,
          contentHash,
          updatedAt: timestamp,
        },
      },
    };

    const result = PatchOperationSchema.safeParse(patch);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.type).toBe('update_artifact');
      expect(result.data.metadata.actorType).toBe('ai');
      const updatePatch = result.data as UpdateArtifactPatch;
      expect(updatePatch.payload.id).toBe(artifactId);
      expect(updatePatch.payload.changes.content).toBe(content);
      expect(updatePatch.payload.changes.contentHash).toBe(contentHash);
    }
  });

  it('should reject invalid patch type', () => {
    const patch = {
      type: 'update_artifact_content',
      metadata: {
        id: generateUUID(),
        actorType: 'ai',
        summary: 'AI improve: test.ts',
        timestamp: new Date().toISOString(),
      },
      payload: {
        artifactId: generateUUID(),
        content: 'test',
        contentHash: '',
        updatedAt: new Date().toISOString(),
      },
    };

    const result = PatchOperationSchema.safeParse(patch);
    expect(result.success).toBe(false);
  });

  it('should reject patch with missing metadata.id', () => {
    const patch = {
      type: 'update_artifact',
      metadata: {
        actorType: 'ai',
        summary: 'AI improve: test.ts',
        timestamp: new Date().toISOString(),
      },
      payload: {
        id: generateUUID(),
        changes: {
          content: 'test',
          contentHash: computeContentHash('test'),
          updatedAt: new Date().toISOString(),
        },
      },
    };

    const result = PatchOperationSchema.safeParse(patch);
    expect(result.success).toBe(false);
  });

  it('should reject patch with wrong payload structure', () => {
    const patch = {
      type: 'update_artifact',
      metadata: {
        id: generateUUID(),
        actorType: 'ai',
        summary: 'AI improve: test.ts',
        timestamp: new Date().toISOString(),
      },
      payload: {
        artifactId: generateUUID(),
        content: 'test',
        contentHash: computeContentHash('test'),
      },
    };

    const result = PatchOperationSchema.safeParse(patch);
    expect(result.success).toBe(false);
  });

  it('should validate contentHash matches content', () => {
    const content = 'const x = 42;';
    const correctHash = computeContentHash(content);
    const wrongHash = computeContentHash('different content');

    expect(correctHash).not.toBe(wrongHash);

    const patch1 = {
      type: 'update_artifact',
      metadata: {
        id: generateUUID(),
        actorType: 'ai',
        summary: 'AI improve: test.ts',
        timestamp: new Date().toISOString(),
      },
      payload: {
        id: generateUUID(),
        changes: {
          content,
          contentHash: correctHash,
          updatedAt: new Date().toISOString(),
        },
      },
    };

    const result1 = PatchOperationSchema.safeParse(patch1);
    expect(result1.success).toBe(true);

    if (result1.success) {
      const updatePatch = result1.data as UpdateArtifactPatch;
      const actualHash = computeContentHash(updatePatch.payload.changes.content!);
      expect(actualHash).toBe(updatePatch.payload.changes.contentHash);
    }
  });

  it('should support optional fields in changes', () => {
    const artifactId = generateUUID();

    const minimalPatch = {
      type: 'update_artifact',
      metadata: {
        id: generateUUID(),
        actorType: 'ai',
        summary: 'AI improve: test.ts',
        timestamp: new Date().toISOString(),
      },
      payload: {
        id: artifactId,
        changes: {
          status: 'draft' as const,
        },
      },
    };

    const result = PatchOperationSchema.safeParse(minimalPatch);
    expect(result.success).toBe(true);

    if (result.success) {
      const updatePatch = result.data as UpdateArtifactPatch;
      expect(updatePatch.payload.changes.status).toBe('draft');
      expect(updatePatch.payload.changes.content).toBeUndefined();
    }
  });

  it('should validate complete AI response format', () => {
    const response = {
      patches: [
        {
          type: 'update_artifact',
          metadata: {
            id: generateUUID(),
            actorType: 'ai',
            summary: 'AI improve: index.ts',
            timestamp: new Date().toISOString(),
          },
          payload: {
            id: generateUUID(),
            changes: {
              content: 'export function hello() { return "world"; }',
              contentHash: computeContentHash('export function hello() { return "world"; }'),
              updatedAt: new Date().toISOString(),
            },
          },
        },
      ],
      explanation: 'Improved code quality and added type safety',
    };

    expect(response.patches).toHaveLength(1);

    const patchResult = PatchOperationSchema.safeParse(response.patches[0]);
    expect(patchResult.success).toBe(true);
    expect(response.explanation).toBeTruthy();
  });
});

import { describe, it, expect } from 'vitest';
import { PatchOperationSchema, AddArtifactPatchSchema } from '@nodespec/core/schemas.js';
import type { AddArtifactPatch, UpdateArtifactPatch } from '@nodespec/core/types.js';
import { computeContentHash, generateUUID, now } from '@nodespec/core/utils.js';

describe('Artifact Tool Patch Format', () => {
  describe('add_artifact patch', () => {
    it('generates a valid add_artifact patch structure', () => {
      const artifactId = generateUUID();
      const nodeId = generateUUID();
      const content = 'export function handler(req, res) { return res.json({ ok: true }); }';
      const timestamp = new Date().toISOString();

      const patch = {
        type: 'add_artifact',
        metadata: {
          id: generateUUID(),
          actorType: 'ai',
          summary: 'Add artifact: src/auth/routes.ts to Auth API',
          timestamp,
        },
        payload: {
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'src/auth/routes.ts',
          content,
          contentHash: computeContentHash(content),
          status: 'draft',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      };

      const result = PatchOperationSchema.safeParse(patch);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.type).toBe('add_artifact');
        expect(result.data.metadata.actorType).toBe('ai');
        const addPatch = result.data as AddArtifactPatch;
        expect(addPatch.payload.id).toBe(artifactId);
        expect(addPatch.payload.nodeId).toBe(nodeId);
        expect(addPatch.payload.kind).toBe('source');
        expect(addPatch.payload.path).toBe('src/auth/routes.ts');
      }
    });

    it('supports all valid artifact kinds', () => {
      const kinds = ['source', 'schema', 'config', 'build', 'doc', 'design'];

      for (const kind of kinds) {
        const patch = {
          type: 'add_artifact',
          metadata: {
            id: generateUUID(),
            actorType: 'ai',
            summary: `Add ${kind} artifact`,
            timestamp: now(),
          },
          payload: {
            id: generateUUID(),
            nodeId: generateUUID(),
            kind,
            path: `test/${kind}.ts`,
            content: '// content',
            contentHash: computeContentHash('// content'),
            status: 'draft',
            createdAt: now(),
            updatedAt: now(),
          },
        };

        const result = PatchOperationSchema.safeParse(patch);
        expect(result.success, `kind "${kind}" should be valid`).toBe(true);
      }
    });

    it('includes language field when provided', () => {
      const patch = {
        type: 'add_artifact',
        metadata: {
          id: generateUUID(),
          actorType: 'ai',
          summary: 'Add artifact',
          timestamp: now(),
        },
        payload: {
          id: generateUUID(),
          nodeId: generateUUID(),
          kind: 'source',
          path: 'src/index.ts',
          content: 'console.log("hello");',
          contentHash: computeContentHash('console.log("hello");'),
          language: 'typescript',
          status: 'draft',
          createdAt: now(),
          updatedAt: now(),
        },
      };

      const result = PatchOperationSchema.safeParse(patch);
      expect(result.success).toBe(true);
    });
  });

  describe('update_artifact patch', () => {
    it('generates a valid update_artifact patch structure', () => {
      const artifactId = generateUUID();
      const newContent = 'export function handler(req, res) { return res.json({ ok: true, v: 2 }); }';
      const timestamp = new Date().toISOString();

      const patch = {
        type: 'update_artifact',
        metadata: {
          id: generateUUID(),
          actorType: 'ai',
          summary: 'Update artifact: src/auth/routes.ts on Auth API',
          timestamp,
        },
        payload: {
          id: artifactId,
          changes: {
            content: newContent,
            contentHash: computeContentHash(newContent),
            status: 'draft',
            updatedAt: timestamp,
          },
        },
      };

      const result = PatchOperationSchema.safeParse(patch);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.type).toBe('update_artifact');
        const updatePatch = result.data as UpdateArtifactPatch;
        expect(updatePatch.payload.id).toBe(artifactId);
        expect(updatePatch.payload.changes.content).toBe(newContent);
      }
    });

    it('can update description alongside content', () => {
      const patch = {
        type: 'update_artifact',
        metadata: {
          id: generateUUID(),
          actorType: 'ai',
          summary: 'Update artifact',
          timestamp: now(),
        },
        payload: {
          id: generateUUID(),
          changes: {
            content: 'updated code',
            contentHash: computeContentHash('updated code'),
            updatedAt: now(),
            description: 'Updated route handlers with pagination support',
          },
        },
      };

      const result = PatchOperationSchema.safeParse(patch);
      expect(result.success).toBe(true);
    });
  });

  describe('patch rejection', () => {
    it('rejects add_artifact with missing required path', () => {
      const patch = {
        type: 'add_artifact',
        metadata: {
          id: generateUUID(),
          actorType: 'ai',
          summary: 'Add artifact',
          timestamp: now(),
        },
        payload: {
          id: generateUUID(),
          nodeId: generateUUID(),
          kind: 'source',
          content: '// code',
          contentHash: computeContentHash('// code'),
          status: 'draft',
          createdAt: now(),
          updatedAt: now(),
        },
      };

      const result = AddArtifactPatchSchema.safeParse(patch);
      expect(result.success).toBe(false);
    });
  });
});

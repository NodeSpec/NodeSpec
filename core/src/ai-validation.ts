import { PatchOperationSchema } from './schemas.js';
import type { PatchOperation } from './types.js';
import { z } from 'zod';

export interface ValidationResult {
  valid: boolean;
  validPatches: PatchOperation[];
  invalidPatches: Array<{ patch: any; error: string }>;
  summary: string;
}

export function validateAIPatches(patches: unknown[]): ValidationResult {
  const validPatches: PatchOperation[] = [];
  const invalidPatches: Array<{ patch: any; error: string }> = [];

  for (const patch of patches) {
    try {
      const validated = PatchOperationSchema.parse(patch);
      validPatches.push(validated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        invalidPatches.push({ patch, error: errorMessage });
      } else {
        invalidPatches.push({ patch, error: 'Unknown validation error' });
      }
    }
  }

  const total = patches.length;
  const validCount = validPatches.length;
  const invalidCount = invalidPatches.length;

  let summary = '';
  if (invalidCount === 0) {
    summary = `All ${total} patches validated successfully`;
  } else if (validCount === 0) {
    summary = `All ${total} patches failed validation`;
  } else {
    summary = `${validCount}/${total} patches valid, ${invalidCount} failed validation`;
  }

  return {
    valid: invalidCount === 0,
    validPatches,
    invalidPatches,
    summary,
  };
}

export function sanitizeAIPatchMetadata(patch: PatchOperation): PatchOperation {
  return {
    ...patch,
    metadata: {
      ...patch.metadata,
      actorType: 'ai',
      timestamp: patch.metadata.timestamp || new Date().toISOString(),
    },
  };
}

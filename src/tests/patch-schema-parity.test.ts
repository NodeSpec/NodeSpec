// P0-10: external proposals must be validated against the SAME patch schema the app
// enforces at approve time.
//
// The mcp-server (Deno) uses a mirror at supabase/functions/_shared/patch-schema.ts
// until S1-2 wires it to @nodespec/core directly. Test 1 makes silent drift impossible:
// the mirror must be byte-identical to core/src/schemas.ts (moved from src/domain by
// S1-1) except for the import specifiers. The remaining tests pin the schema behavior
// the propose path enforces and the field-level skip reasons the review UI shows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PatchOperationSchema } from '@nodespec/core/schemas';
import { validatePatch } from '@nodespec/core/patch-engine';
import { formatValidationConflictReason } from '@nodespec/core/ai-proposal';
import type { Graph } from '@nodespec/core/types';

describe('P0-10: _shared/patch-schema.ts is an exact mirror of core/src/schemas.ts', () => {
  it('files are identical modulo the zod and enums import specifiers', () => {
    const canonical = readFileSync('core/src/schemas.ts', 'utf8');
    const mirror = readFileSync('supabase/functions/_shared/patch-schema.ts', 'utf8');

    const normalize = (src: string) =>
      src
        .replace(`import { z } from 'zod';`, 'IMPORT_ZOD')
        .replace(`import { z } from "npm:zod@3.22.4";`, 'IMPORT_ZOD')
        .replace(`from './shared/enums.js';`, 'IMPORT_ENUMS')
        .replace(`from './enums.ts';`, 'IMPORT_ENUMS');

    expect(normalize(mirror)).toBe(normalize(canonical));
  });
});

const VALID_METADATA = {
  id: 'b0000000-0000-4000-8000-00000000f001',
  actorType: 'ai' as const,
  actorId: 'claude-code',
  summary: 'test patch',
  timestamp: '2026-07-13T00:00:00.000Z',
};

describe('P0-10: the schema the propose path now enforces', () => {
  it('accepts a canonical add_node patch', () => {
    const result = PatchOperationSchema.safeParse({
      type: 'add_node',
      metadata: VALID_METADATA,
      payload: { id: 'b0000000-0000-4000-8000-000000000a99', type: 'backend-service', label: 'New Service' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an add_artifact payload missing required fields, naming them', () => {
    const result = PatchOperationSchema.safeParse({
      type: 'add_artifact',
      metadata: VALID_METADATA,
      // What a naive agent sends: no createdAt/updatedAt, no nodeId
      payload: { id: 'b0000000-0000-4000-8000-000000000b99', kind: 'source', path: 'src/index.ts', content: 'x' },
    });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('payload.nodeId');
    expect(paths).toContain('payload.createdAt');
    expect(paths).toContain('payload.updatedAt');
  });

  it('rejects non-UUID entity ids, naming the field', () => {
    const result = PatchOperationSchema.safeParse({
      type: 'add_node',
      metadata: VALID_METADATA,
      payload: { id: 'my-new-node', type: 'backend-service', label: 'New Service' },
    });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('payload.id');
  });
});

describe('P0-10: approve-time skip reasons carry field detail', () => {
  const emptyGraph: Graph = {
    id: 'b0000000-0000-4000-8000-000000000100',
    schemaVersion: 8,
    version: 0,
    hash: 'x',
    nodes: {},
    edges: {},
    contracts: {},
    artifacts: {},
  } as Graph;

  it('a real INVALID_PATCH_SCHEMA validation error formats with field names', () => {
    const validation = validatePatch(emptyGraph, {
      type: 'add_artifact',
      metadata: VALID_METADATA,
      payload: { id: 'b0000000-0000-4000-8000-000000000b99', kind: 'source', path: 'src/index.ts' },
    } as never);

    expect(validation.valid).toBe(false);
    const reason = formatValidationConflictReason(validation.errors);
    expect(reason).toContain('Patch does not match schema');
    expect(reason).toContain('payload');
    expect(reason.length).toBeGreaterThan('Patch does not match schema'.length);
  });

  it('errors without zod details fall back to the plain message', () => {
    expect(formatValidationConflictReason([{ message: 'Node X already exists' }])).toBe('Node X already exists');
    expect(formatValidationConflictReason([])).toBe('Validation failed during merge');
  });
});

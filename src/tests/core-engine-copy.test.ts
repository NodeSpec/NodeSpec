// AL.24: the server applies an agent's canvas proposal under Auto with the
// patch engine the app runs. It runs a generated Deno copy of core
// (scripts/sync-core-engine.mjs); these hold the copy to core, so the two
// can never apply a patch differently.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error a plain .mjs script, run by node
import { drift, closure, denoSource } from '../../scripts/sync-core-engine.mjs';
import { proposeArchitectureMappings, extractMatchTerms } from '@nodespec/core/architecture-mapping.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('AL.24 the server\'s copy of the patch engine is core', () => {
  it('no file differs, none is missing, none is extra', () => {
    expect(drift()).toEqual({ stale: [], extra: [] });
  });

  it('it is the engine\'s whole import closure, and only the import specifiers differ', () => {
    const files: string[] = closure();
    expect(files.slice(0, 5)).toEqual(['patch-engine.ts', 'without-ports.ts', 'proposal-git-content.ts', 'architecture-mapping.ts', 'evidence-stale.ts']);
    expect(files).toEqual(expect.arrayContaining(['schemas.ts', 'types.ts', 'utils.ts', 'shared/enums.ts', 'container-types.ts', 'node-types.ts']));
    const normalize = (src: string) => src
      .replace(/^\/\/ GENERATED from .*\n\/\/ change core .*\n/, '')
      .replace(/from "npm:zod@3\.22\.4"/g, "from 'zod'")
      .replace(/(from\s*|import\s*)'(\.{1,2}\/[^']+)\.ts'/g, "$1'$2.js'");
    for (const f of files) {
      expect(normalize(read(`supabase/functions/_shared/core-engine/${f}`)), f).toBe(read(`core/src/${f}`));
    }
  });

  it('the generator rewrites relative imports and zod, and leaves code that merely says "from" alone', () => {
    const src = "import { z } from 'zod';\nimport type { A } from './a.js';\nexport { b } from '../b.js';\nconst s = 'from ' + x.includes('y.js');\n";
    expect(denoSource(src, 'x.ts')).toBe(
      '// GENERATED from core/src/x.ts by scripts/sync-core-engine.mjs. Do not edit:\n' +
      '// change core and run the script; src/tests/core-engine-copy.test.ts fails on drift.\n' +
      "import { z } from \"npm:zod@3.22.4\";\nimport type { A } from './a.ts';\nexport { b } from '../b.ts';\nconst s = 'from ' + x.includes('y.js');\n",
    );
  });
});

describe('AL.24 the mapping heuristic, moved to core so the server maps as the app does', () => {
  const reqs = [
    { id: 'r-pickup', name: 'Customers order pickup', description: 'Pickup orders are taken online', category: 'functional', acceptanceCriteria: [{ text: 'A pickup order is stored' }] },
    { id: 'r-stock', name: 'Stock levels', description: 'Flour and sugar stock is tracked', category: 'functional', acceptanceCriteria: [] },
  ];
  const isContainer = (t: string) => t === 'kubernetes-cluster';

  it('each new node goes to the requirement its words overlap best, at a score of two or more', () => {
    expect(proposeArchitectureMappings([{ id: 'n1', label: 'Pickup Orders Service', type: 'backend-service' }], reqs, new Set(), isContainer)).toEqual([
      { requirementId: 'r-pickup', nodeId: 'n1', mappingType: 'implements', confidence: 0.9, notes: 'Auto-mapped by keyword heuristic (score: 4)' },
    ]);
    // one shared word scores 2: mapped at 0.7
    expect(proposeArchitectureMappings([{ id: 'n2', label: 'Stock', type: 'database' }], reqs, new Set(), isContainer)[0])
      .toMatchObject({ requirementId: 'r-stock', confidence: 0.7 });
    // a partial match alone scores 1: not mapped
    expect(proposeArchitectureMappings([{ id: 'n3', label: 'Stocking', type: 'x1' }], reqs, new Set(), isContainer)).toEqual([]);
  });

  it('a container, a node already mapped, and a node with no words are never mapped', () => {
    const nodes = [
      { id: 'k', label: 'Pickup Orders Cluster', type: 'kubernetes-cluster' },
      { id: 'm', label: 'Pickup Orders Service', type: 'backend-service' },
      { id: 'e', label: '', type: '' },
    ];
    expect(proposeArchitectureMappings(nodes, reqs, new Set(['m']), isContainer)).toEqual([]);
  });

  it('terms drop stop words and short tokens, lowercased', () => {
    expect(extractMatchTerms('The Pickup API for all orders', 'is', 'db')).toEqual(['pickup', 'api', 'orders']);
  });
});

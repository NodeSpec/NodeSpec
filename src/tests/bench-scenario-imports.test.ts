import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bench round 2026-09-02: two scenarios reached the owner's live run calling
// lib helpers (`sleep`, `until`) they never imported — `node --check` passes
// (valid syntax) and the ReferenceError only fires mid-scenario, after the
// sandbox reset and the setup push. This pins, offline, that every lib.mjs
// helper a scenario CALLS is in its import line. Runs over whatever
// scenarios exist in the tree (the community export ships a subset).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCENARIOS = resolve(ROOT, 'scripts/bench/scenarios');

const libExports = (): string[] => {
  const src = readFileSync(resolve(ROOT, 'scripts/bench/lib.mjs'), 'utf-8');
  const names = new Set<string>();
  for (const m of src.matchAll(/^export (?:async )?function (\w+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export const (\w+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export class (\w+)/gm)) names.add(m[1]);
  return [...names];
};

describe('bench scenarios import every lib helper they call', () => {
  const helpers = libExports();
  const files = readdirSync(SCENARIOS).filter((f) => f.endsWith('.mjs'));

  it('finds the lib surface and at least one scenario', () => {
    expect(helpers).toEqual(expect.arrayContaining(['sleep', 'until', 'mcpCall', 'callFn', 'rest', 'github', 'Scenario']));
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file}: no lib helper is called without being imported`, () => {
      const src = readFileSync(resolve(SCENARIOS, file), 'utf-8');
      const importLine = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/lib\.mjs'/);
      const imported = new Set((importLine?.[1] ?? '').split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean));
      // Strip comments and string bodies so prose never counts as a call.
      const body = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
      const missing: string[] = [];
      for (const h of helpers) {
        const called = new RegExp(`(?<![\\w.])${h}\\s*\\(`).test(body) || new RegExp(`\\bnew\\s+${h}\\b`).test(body);
        // A local definition with the same name is fine (e.g. a scenario's own `sweep`).
        const locallyDefined = new RegExp(`\\b(?:const|let|function|async function)\\s+${h}\\b`).test(body);
        if (called && !imported.has(h) && !locallyDefined) missing.push(h);
      }
      expect(missing, `${file} calls ${missing.join(', ')} without importing from ../lib.mjs`).toEqual([]);
    });
  }
});

#!/usr/bin/env node
// AL.24 (owner 2026-10-05: Auto must apply "headless so the user doesn't
// have to have the app open"): the server applies an agent's canvas
// proposal under Auto, so it runs the same patch engine the app runs. This
// writes the Deno copy of that part of core: the closure of ROOTS under
// core/src, byte for byte except the import specifiers (./x.js becomes
// ./x.ts; zod becomes the npm: specifier the functions pin).
//
//   node scripts/sync-core-engine.mjs           write the copy
//   node scripts/sync-core-engine.mjs --check   exit 1 when the copy differs
//
// src/tests/core-engine-copy.test.ts runs the check, so a change to core
// that is not copied fails the gates.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = 'core/src';
export const OUT = 'supabase/functions/_shared/core-engine';
export const ROOTS = ['patch-engine.ts', 'without-ports.ts', 'proposal-git-content.ts', 'architecture-mapping.ts', 'evidence-stale.ts'];

const HEADER = (file) =>
  `// GENERATED from core/src/${file} by scripts/sync-core-engine.mjs. Do not edit:\n` +
  '// change core and run the script; src/tests/core-engine-copy.test.ts fails on drift.\n';

// A static import or export (the statement's own `from`, across lines) or a
// side-effect import. Core's engine has no dynamic import; closure() refuses one.
const SPECIFIER = /^(\s*(?:import|export)\b[^'";]*?\bfrom\s*|\s*import\s*)(['"])([^'"]+)\2/gm;
const DYNAMIC = /\bimport\s*\(\s*['"]/;

/** The Deno spelling of one core file. */
export function denoSource(source, file) {
  const body = source.replace(SPECIFIER, (whole, lead, _q, spec) => {
    if (spec === 'zod') return `${lead}"npm:zod@3.22.4"`;
    if (spec.startsWith('.') && spec.endsWith('.js')) return `${lead}'${spec.slice(0, -3)}.ts'`;
    return whole;
  });
  return HEADER(file) + body;
}

/** The core files ROOTS import, ROOTS first, as paths under core/src. */
export function closure(root = ROOT) {
  const seen = [];
  const queue = [...ROOTS];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.includes(file)) continue;
    seen.push(file);
    const source = readFileSync(join(root, SRC, file), 'utf8');
    if (DYNAMIC.test(source)) throw new Error(`core/src/${file} has a dynamic import: the server copy follows static imports only`);
    for (const m of source.matchAll(SPECIFIER)) {
      const spec = m[3];
      if (!spec.startsWith('.')) {
        if (spec !== 'zod') throw new Error(`core/src/${file} imports "${spec}": the server copy carries zod only`);
        continue;
      }
      queue.push(posix.normalize(posix.join(posix.dirname(file), spec.replace(/\.js$/, '.ts'))));
    }
  }
  return seen;
}

/** Every file the copy holds, as it should read. */
export function expectedCopy(root = ROOT) {
  const out = new Map();
  for (const file of closure(root)) out.set(file, denoSource(readFileSync(join(root, SRC, file), 'utf8'), file));
  return out;
}

function listCopy(root) {
  const dir = join(root, OUT);
  if (!existsSync(dir)) return [];
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return files.sort();
}

/** What differs between the copy on disk and core: files to write, files to remove. */
export function drift(root = ROOT) {
  const want = expectedCopy(root);
  const stale = [...want].filter(([file, text]) => {
    const p = join(root, OUT, file);
    return !existsSync(p) || readFileSync(p, 'utf8') !== text;
  }).map(([file]) => file);
  const extra = listCopy(root).filter((file) => !want.has(file));
  return { stale, extra };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { stale, extra } = drift();
  if (process.argv.includes('--check')) {
    if (stale.length + extra.length > 0) {
      console.error(`The server copy of core differs: ${[...stale, ...extra.map((f) => `${f} (not in core)`)].join(', ')}. Run node scripts/sync-core-engine.mjs.`);
      process.exit(1);
    }
    console.log('The server copy of core matches.');
  } else {
    const want = expectedCopy();
    for (const file of stale) {
      const p = join(ROOT, OUT, file);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, want.get(file));
    }
    for (const file of extra) rmSync(join(ROOT, OUT, file));
    console.log(`Wrote ${stale.length} file(s), removed ${extra.length}; the copy holds ${want.size}.`);
  }
}

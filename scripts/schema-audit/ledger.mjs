// Schema audit — the STATIC half. Pure functions over the migration chain and
// the source tree, shared by the vitest parity gate
// (src/tests/schema-code-parity.test.ts) and the full audit runner
// (scripts/schema-audit/run.mjs). No database needed.
//
// The ledger replays CREATE TABLE / DROP TABLE / RENAME in file order and
// returns the table set the chain ends with — the only thing a `.from('x')`
// in application code may legally name. Every statement is anchored at a
// line start (allowing an `EXECUTE '` prefix) so DDL quoted inside catalog
// seed JSON (pgvector snippets and the like) never counts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Tables code may name BEFORE a migration creates them — each behind a
// try/catch at the call site. P6 (work plans) probes these from
// supabase/functions/mcp-server/tools/checkouts.ts. The audit fails the day
// the chain creates one of these, so the entry is removed with the migration.
// v3o (2026-09-14) created work_plans / work_plan_items — nothing is forward today.
export const FORWARD_REFS = new Set([]);

const CREATE_RE = /^\s*(?:EXECUTE\s+')?CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/i;
const DROP_RE = /^\s*(?:EXECUTE\s+')?DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;']+?)\s*(?:CASCADE|RESTRICT)?\s*'?\s*;/i;
const RENAME_RE = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+RENAME\s+TO\s+"?([a-z_][a-z0-9_]*)"?/i;

const bare = (name) => name.trim().replace(/^public\./i, '').replace(/"/g, '').toLowerCase();

// Template seeds embed whole schema files as multi-line '...'::text literals,
// and their CREATE TABLE lines start at column 0 like real DDL. Yield only
// the lines outside multi-line single-quoted literals; DDL that matters is
// either bare or inside a one-line EXECUTE '...' (dollar-quoted DO bodies
// stay visible). Comments are stripped first so an apostrophe in prose can
// never open a phantom literal.
function* ddlLines(sql) {
  const noBlockComments = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  let inLiteral = false;
  for (const raw of noBlockComments.split('\n')) {
    const line = inLiteral ? raw : raw.replace(/--.*$/, '');
    const quotes = (line.match(/'/g) ?? []).length;
    const opensOrCloses = quotes % 2 === 1;
    if (!inLiteral) yield line;
    if (opensOrCloses) inLiteral = !inLiteral;
  }
}

/** Apply one migration's DDL to a running table set (mutates and returns it). */
export function applyMigration(sql, tables) {
  for (const line of ddlLines(sql)) {
    const created = CREATE_RE.exec(line);
    if (created) { tables.add(created[1].toLowerCase()); continue; }
    const renamed = RENAME_RE.exec(line);
    if (renamed) { tables.delete(renamed[1].toLowerCase()); tables.add(renamed[2].toLowerCase()); continue; }
    const dropped = DROP_RE.exec(line);
    if (dropped) {
      for (const name of dropped[1].split(',')) tables.delete(bare(name));
    }
  }
  return tables;
}

/** The table set the migration chain ends with. */
export function finalTables(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const tables = new Set();
  for (const f of files) applyMigration(readFileSync(join(migrationsDir, f), 'utf-8'), tables);
  return tables;
}

// `.from('x')` — but never `storage.from('bucket')` (on one line or wrapped),
// which names a bucket.
const FROM_RE = /(?<!storage\s*)\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*\)/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) yield full;
  }
}

/** Every table name application code asks PostgREST for → where it does so. */
export function codeTableRefs(root, dirs, { skipTests = true } = {}) {
  const refs = new Map();
  for (const dir of dirs) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file);
      if (skipTests && /(^|\/)(tests?|__tests__)\//.test(rel)) continue;
      if (skipTests && /\.(test|spec)\.[tj]sx?$|_test\.ts$/.test(rel)) continue;
      const src = readFileSync(file, 'utf-8');
      for (const m of src.matchAll(FROM_RE)) {
        const line = src.slice(0, m.index).split('\n').length;
        const list = refs.get(m[1]) ?? [];
        list.push(`${rel}:${line}`);
        refs.set(m[1], list);
      }
    }
  }
  return refs;
}

/** Code references whose table the chain never ends with (minus an allowlist). */
export function missingTableRefs(refs, tables, allow = new Set()) {
  const missing = [];
  for (const [table, sites] of refs) {
    if (tables.has(table) || allow.has(table)) continue;
    missing.push({ table, sites });
  }
  return missing.sort((a, b) => a.table.localeCompare(b.table));
}

#!/usr/bin/env node
// NodeSpec SQL test lane.
//
// Runs every scripts/db-lane/*.sql file, in name order, against a REAL
// Postgres with the migration chain applied, and reports PASS or FAIL per
// file. Each file is a self-contained behaviour test: it opens a
// transaction, builds its own fixture, exercises a function or trigger the
// way the app and the MCP server do, asserts with RAISE EXCEPTION, and
// rolls back, so the database is exactly as it was afterwards.
//
// This lane exists because the unit gates cannot see the database. A
// vitest pin that asserts a migration file contains a string passes when
// the function it names does not exist on any stack, which is how the
// graph_reference_ids RPC shipped dangling. A file here fails instead.
//
//   npm run test:db                         the local stack (supabase start)
//   DATABASE_URL=... npm run test:db        another local database, host psql
//   DB_LANE_CONTAINER=name npm run test:db  psql inside that Docker container
//   npm run test:db -- --only=delete        substring filter on file names
//   npm run test:db -- --list               print the files, run nothing
//   DB_LANE_SEED_USER=1 npm run test:db     CI: seed one fixture user first
//
// Where it runs, in order: DATABASE_URL with the host's psql (the PR gate);
// DB_LANE_CONTAINER; the running Supabase CLI database container for this
// project (supabase_db_<project_id>), with the psql inside it, so Docker is
// the only thing a machine needs; else the CLI's default URL with the
// host's psql. Node, not bash, so it runs the same from PowerShell.
//
// Refuses any host that is not local unless ALLOW_NONLOCAL=1 is set, the
// same rule scripts/bench/lib.mjs applies. Never point this at production.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DIR, '../..');
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const PSQL_FLAGS = ['-v', 'ON_ERROR_STOP=1', '-q', '-X'];
const SEED_USER_SQL = "INSERT INTO auth.users (id, email) SELECT 'db1a0e00-0000-4000-8000-000000000001', 'db-lane@nodespec.local' WHERE NOT EXISTS (SELECT 1 FROM auth.users);";

const fail = (msg) => { process.stderr.write(`db-lane: ${msg}\n`); process.exit(2); };

let only = '';
let list = false;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--only=')) only = arg.slice('--only='.length);
  else if (arg === '--list') list = true;
  else fail(`unknown argument '${arg}'`);
}

// host part of a URL; empty for a unix-socket URL (?host=/path).
function urlHost(url) {
  const m = /^[a-z]+:\/\/([^@/]*@)?([^/:?]*)/.exec(url);
  return m ? m[2] : '';
}

function refuseNonLocal(url) {
  const host = urlHost(url);
  if (host && host !== '127.0.0.1' && host !== 'localhost' && process.env.ALLOW_NONLOCAL !== '1') {
    fail(`DATABASE_URL points at '${host}', which is not a local stack. Refusing. Set ALLOW_NONLOCAL=1 only if you are absolutely sure.`);
  }
}

const runs = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf-8' });
  return r.error ? null : r;
};

// The Supabase CLI names its database container supabase_db_<project_id>.
function cliContainer() {
  const config = resolve(ROOT, 'supabase/config.toml');
  const id = existsSync(config) ? /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf-8'))?.[1] : undefined;
  const ps = runs('docker', ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}']);
  if (!ps || ps.status !== 0) return null;
  const names = ps.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (id && names.includes(`supabase_db_${id}`)) return `supabase_db_${id}`;
  return names.length === 1 ? names[0] : null;
}

// psql's \ir and \i read from the file system psql runs on. Inside a
// container that is not this checkout, so the included files are inlined.
function inline(file, seen = new Set()) {
  if (seen.has(file)) fail(`${basename(file)} includes itself`);
  seen.add(file);
  return readFileSync(file, 'utf-8').split(/\r?\n/).map((line) => {
    const m = /^\\(ir?)\s+(\S+)\s*$/.exec(line);
    if (!m) return line;
    const target = resolve(m[1] === 'ir' ? dirname(file) : process.cwd(), m[2]);
    if (!existsSync(target)) fail(`${basename(file)} includes ${m[2]}, which does not exist`);
    return inline(target, new Set(seen));
  }).join('\n');
}

function resolveTarget() {
  if (process.env.DATABASE_URL) {
    return { kind: 'url', url: process.env.DATABASE_URL, label: `DATABASE_URL (${urlHost(process.env.DATABASE_URL) || 'unix socket'})` };
  }
  if (process.env.DB_LANE_CONTAINER) return { kind: 'container', name: process.env.DB_LANE_CONTAINER, label: `the container ${process.env.DB_LANE_CONTAINER}` };
  const found = cliContainer();
  if (found) return { kind: 'container', name: found, label: `the container ${found}` };
  if (runs('psql', ['--version'])?.status === 0) return { kind: 'url', url: DEFAULT_URL, label: 'the Supabase CLI default (127.0.0.1:54322)' };
  fail('no database to run against. Start the local stack (npx supabase start, or npx supabase db start), '
    + 'set DB_LANE_CONTAINER to a running Postgres container, or set DATABASE_URL and install the Postgres client (psql).');
}

// One psql run. `file` runs a lane; `sql` runs a statement.
function psql(target, { file, sql }) {
  if (target.kind === 'url') {
    const args = [target.url, ...PSQL_FLAGS, ...(file ? ['-f', file] : ['-c', sql])];
    const r = spawnSync('psql', args, { encoding: 'utf-8' });
    if (r.error) fail(`psql could not start (${r.error.code ?? r.error.message}). Install the Postgres client, or unset DATABASE_URL to run inside the stack's container.`);
    return r;
  }
  // Inside the container: its own psql, its own password, over its own loopback.
  const inner = `PGPASSWORD="\${POSTGRES_PASSWORD:-postgres}" exec psql -h 127.0.0.1 -p "\${PGPORT:-5432}" -U postgres -d postgres ${PSQL_FLAGS.join(' ')} -f -`;
  const r = spawnSync('docker', ['exec', '-i', target.name, 'sh', '-c', inner], {
    input: file ? inline(file) : sql,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) fail(`docker could not start (${r.error.code ?? r.error.message}). Is Docker running?`);
  return r;
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => !only || f.includes(only))
  .map((f) => resolve(DIR, f));

// A remote DATABASE_URL is refused before anything else, a listing included.
if (process.env.DATABASE_URL) refuseNonLocal(process.env.DATABASE_URL);

if (list) {
  for (const f of files) process.stdout.write(`${basename(f)}\n`);
  process.exit(0);
}
if (files.length === 0) fail('no files matched.');

const target = resolveTarget();
process.stdout.write(`db-lane: against ${target.label}\n`);

// A fresh chain (CI applies the migrations and nothing else) has no
// auth.users row, and some lanes borrow one to own their fixture. With
// DB_LANE_SEED_USER=1 the runner creates a throwaway user first, outside the
// lanes' transactions, only when the table is empty. A seeded local stack
// already has bench@nodespec.local and is left alone.
if (process.env.DB_LANE_SEED_USER === '1') {
  const r = psql(target, { sql: SEED_USER_SQL });
  if (r.status !== 0) fail(`could not seed the fixture user.\n${r.stderr}`);
}

let pass = 0;
let failed = 0;
for (const f of files) {
  const name = basename(f);
  const start = Date.now();
  const r = psql(target, { file: f });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.split(/\r?\n/);
  if (r.status === 0) {
    pass += 1;
    process.stdout.write(`PASS  ${name}  (${Date.now() - start} ms)\n`);
    for (const line of out.filter((l) => l.includes('NOTICE:  db-lane'))) {
      process.stdout.write(`      ${line.replace(/^psql:[^:]+:[0-9]+: NOTICE: {2}/, '')}\n`);
    }
  } else {
    failed += 1;
    process.stdout.write(`FAIL  ${name}\n`);
    // psql's own failures (no server, a refused login) are not ERROR lines: show what it said.
    const reported = out.filter((l) => /ERROR|DETAIL|HINT|LINE/.test(l));
    for (const line of (reported.length ? reported : out.filter((l) => l.trim())).slice(0, 8)) {
      process.stdout.write(`      ${line}\n`);
    }
  }
}

process.stdout.write(`db-lane: ${pass} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

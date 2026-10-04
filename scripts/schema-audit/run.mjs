#!/usr/bin/env node
// Schema audit runner — `npm run schema:audit`.
//
// Two halves, one verdict:
//   static  — the migration ledger (scripts/schema-audit/ledger.mjs) replays
//             CREATE / DROP / RENAME across supabase/migrations and every
//             `.from('x')` in src/ + supabase/functions/ must name a table
//             the chain ends with (forward references only via FORWARD_REFS).
//   catalog — audit.sql against a database that has the chain applied:
//             functions naming relations that do not exist, duplicate
//             trigger functions, unindexed FK columns, RLS-on-with-no-
//             policies tables that do not say so, plus inventory.
//
// Point DATABASE_URL at the local Supabase stack (the default is the CLI's
// standard port) after `supabase db reset`, or at the stock-Postgres replay
// (see replay/README). `--static-only` skips the database half. `--json`
// prints the raw report. Exit 1 on any HARD finding. Dependency-free on
// purpose: the PR gate's migration job runs it without `npm ci`.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FORWARD_REFS, codeTableRefs, finalTables, missingTableRefs } from './ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DEFAULT_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** The static half: ledger ↔ code. Pure over the tree. */
export function staticReport(root = ROOT) {
  const ledger = finalTables(resolve(root, 'supabase/migrations'));
  const refs = codeTableRefs(root, ['src', 'supabase/functions']);
  return {
    ledger_tables: [...ledger].sort(),
    code_refs: refs.size,
    missing_table_refs: missingTableRefs(refs, ledger, FORWARD_REFS),
    stale_forward_refs: [...FORWARD_REFS].filter((t) => ledger.has(t)),
  };
}

/** The catalog half: audit.sql over DATABASE_URL, parsed. */
export function catalogReport(databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DB) {
  const out = execFileSync('psql', [databaseUrl, '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-f', resolve(HERE, 'audit.sql')], {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out.trim());
}

/** Ledger ↔ live catalog: tables that exist on only one side are drift. */
export function driftBetween(ledgerTables, dbTables) {
  const l = new Set(ledgerTables); const d = new Set(dbTables);
  return {
    in_db_not_in_migrations: [...d].filter((t) => !l.has(t)).sort(),
    in_migrations_not_in_db: [...l].filter((t) => !d.has(t)).sort(),
  };
}

/** HARD findings fail the run; the rest is printed for the reader. Pure. */
export function classify(report) {
  const hard = [];
  const warn = [];
  const s = report.static;
  const c = report.catalog;
  for (const m of s?.missing_table_refs ?? []) {
    hard.push(`code names table "${m.table}" that the migration chain never ends with — ${m.sites.join(', ')}`);
  }
  for (const t of s?.stale_forward_refs ?? []) {
    hard.push(`FORWARD_REFS still lists "${t}" but the chain now creates it — remove it from ledger.mjs`);
  }
  if (c) {
    for (const f of c.functions_missing_relations ?? []) {
      hard.push(`function ${f.function} names relation "${f.relation}" that does not exist`);
    }
    for (const group of c.duplicate_trigger_functions ?? []) {
      hard.push(`identical trigger functions: ${group.join(', ')} — keep one`);
    }
    for (const fk of c.unindexed_fks ?? []) {
      hard.push(`FK column ${fk.table}.${fk.column} (→ ${fk.references}) has no index`);
    }
    for (const t of c.rls_no_policy_uncommented ?? []) {
      hard.push(`${t}: RLS enabled with zero policies and no comment saying "service role only" — document the posture or add policies`);
    }
    for (const t of c.rls_disabled ?? []) hard.push(`${t}: row-level security is DISABLED`);
    const drift = report.drift ?? {};
    for (const t of drift.in_db_not_in_migrations ?? []) hard.push(`table "${t}" exists in the database but no migration creates it`);
    for (const t of drift.in_migrations_not_in_db ?? []) hard.push(`table "${t}" ends the migration chain but is missing from the database`);
    for (const t of c.uncommented_tables ?? []) warn.push(`${t}: no table comment`);
    for (const i of c.islands ?? []) if (!i.commented) warn.push(`${i.table}: no foreign keys in or out and no comment explaining why`);
    for (const col of c.soft_id_columns ?? []) if (!col.commented) warn.push(`${col.table}.${col.column} (${col.type}) looks like a reference but has no FK and no comment`);
  }
  return { hard, warn };
}

function main(argv) {
  const staticOnly = argv.includes('--static-only');
  const asJson = argv.includes('--json');
  const report = { static: staticReport() };
  if (!staticOnly) {
    try {
      report.catalog = catalogReport();
      report.drift = driftBetween(report.static.ledger_tables, report.catalog.db_tables);
    } catch (err) {
      // ENOENT is psql missing from PATH, not a database that will not answer
      // — a different fix, and the common one on Windows, where the Supabase
      // CLI runs Postgres in Docker and installs no client.
      if (err?.code === 'ENOENT') {
        console.error('schema-audit: `psql` is not on PATH — the catalog half shells out to it.\n' +
          'Install the Postgres client (Windows: the EDB installer\'s command-line tools, or `winget install PostgreSQL.psql`;\n' +
          'macOS: `brew install libpq`), or run the audit inside the CLI\'s container:\n' +
          '  docker exec -i supabase_db_<project> psql -U postgres -X -tA < scripts/schema-audit/audit.sql\n' +
          'Pass --static-only to skip the database half entirely.');
        process.exit(2);
      }
      const msg = String(err?.stderr ?? err?.message ?? err);
      console.error(`schema-audit: could not query the database (${process.env.DATABASE_URL ?? DEFAULT_DB}):\n${msg}\n` +
        'Start the local stack (`supabase db reset`) or set DATABASE_URL; pass --static-only to skip this half.');
      process.exit(2);
    }
  }
  const verdict = classify(report);
  if (asJson) {
    console.log(JSON.stringify({ ...report, verdict }, null, 2));
  } else {
    const c = report.catalog;
    console.log(`schema-audit: ${report.static.ledger_tables.length} tables end the migration chain; ${report.static.code_refs} distinct tables named by code` +
      (c ? `; database has ${c.tables} tables, ${c.functions} functions, ${c.triggers} triggers` : ' (static only)'));
    for (const h of verdict.hard) console.log(`  HARD  ${h}`);
    for (const w of verdict.warn) console.log(`  warn  ${w}`);
    console.log(verdict.hard.length === 0 ? `schema-audit: OK (${verdict.warn.length} advisory)` : `schema-audit: ${verdict.hard.length} hard finding(s)`);
  }
  process.exit(verdict.hard.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));

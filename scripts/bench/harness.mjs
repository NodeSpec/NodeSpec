// The live bench's runner, shared by run.mjs (every scenario) and oss-run.mjs
// (the community set): the preflight that proves the stack is the one this
// checkout describes before anything runs, the run loop, the summary and the
// report (UAT hardening, owner 2026-09-27: "robustly harden our test bench
// ... for functional tests (not just testing itself but actual tests)").
//
// Preflight stops the run with a named problem and exit code 3 when the
// stack cannot answer for this checkout: nothing listening, a rejected key,
// a database behind the migrations, the edge functions not served, the
// bench account not signing in, the MCP key unknown, or the sandbox repo not
// writable. A run that starts can therefore only fail on the product.
//
// Each scenario gets a fresh sign-in, a reset sandbox and a time budget. Its
// status is one of PASS (checks made, none failed), FAIL (a check failed, it
// made none, or an MCP call failed below the tool), SKIP (it could not run
// on this stack and said why) or ERROR (the harness could not set it up).
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigration } from '../schema-audit/ledger.mjs';
import { Scenario, assertServiceKey, signIn, timedFetch, requestTimeoutMs, mcpRpc, mcpCallAs, parseMcp, rest, sleep, isStackError } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(HERE, '../../supabase/migrations');
export const REPORT_DIR = join(HERE, 'out');

// ── what the migrations say the database holds ───────────────────────────────

const FN_CREATE = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/i;
const FN_DROP = /^\s*DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/i;
const FN_GRANT = /GRANT\s+(?:EXECUTE|ALL(?:\s+PRIVILEGES)?)\s+ON\s+FUNCTION\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\([^)]*\)\s+TO\s+([^;]+);/gi;
// A drop in a loop: a DO block finds a function's overloads in pg_proc by name
// and EXECUTEs a DROP FUNCTION for each (AH.2 drops one whose argument type
// only exists where pgvector does). A block that only reads pg_proc drops nothing.
const DO_OPEN = /^\s*DO\s+(\$[a-z_]*\$)/i;
const LOOP_DROP = /\bEXECUTE\b.*\bDROP\s+FUNCTION\b/i;
const PRONAME = /proname\s*(?:=\s*'([a-z_][a-z0-9_]*)'|IN\s*\(([^)]*)\))/gi;
const pronames = (block) => [...block.matchAll(PRONAME)].flatMap((m) =>
  m[1] ? [m[1]] : [...m[2].matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map((q) => q[1])).map((n) => n.toLowerCase());
// The community export replaces the chain with one schema dump, which quotes
// every name ("public"."projects"); read both spellings the same way.
const unquote = (sql) => sql.replace(/"public"\."([a-z_][a-z0-9_]*)"/gi, 'public.$1');
// Only public functions; a CREATE in another schema names its schema.
const OTHER_SCHEMA = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?!public\.)[a-z_]+\./i;

// A table created under its schema's name (the chain sometimes, a dump always).
const TABLE_QUALIFIED = /^\s*CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z_][a-z0-9_]*)\s*\(/i;
// A function and what it returns; PostgREST never serves a trigger function.
const FN_RETURNS = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([\s\S]*?\)\s*RETURNS\s+(?:SETOF\s+)?([a-z_]+)/gi;

/**
 * The tables and service-role functions the migration chain ends with, each
 * with the migration that last made it. Tables come from the schema audit's
 * own ledger (scripts/schema-audit/ledger.mjs) and any table created under
 * its schema's name; a function counts when the chain creates it in public,
 * grants it to service_role by name, and never drops it, and it is not a
 * trigger. The community export's one schema dump is read for its tables
 * alone: a dump grants every function, triggers included, so its grants say
 * nothing about what PostgREST serves.
 */
export function expectedSchema(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const tables = new Set();
  const tableFrom = new Map();
  const fnFrom = new Map();
  const granted = new Set();
  const triggers = new Set();
  for (const f of files) {
    const sql = unquote(readFileSync(join(dir, f), 'utf-8'));
    const dump = /PostgreSQL database dump/.test(sql);
    const before = new Set(tables);
    if (!dump) applyMigration(sql, tables);
    for (const line of sql.split('\n')) {
      const t = TABLE_QUALIFIED.exec(line);
      if (t) tables.add(t[1].toLowerCase());
    }
    for (const t of tables) if (!before.has(t)) tableFrom.set(t, f);
    for (const t of [...tableFrom.keys()]) if (!tables.has(t)) tableFrom.delete(t);
    if (dump) continue;
    let tag = null;
    let block = '';
    for (const line of sql.split('\n')) {
      const open = tag ? null : DO_OPEN.exec(line);
      if (open) { tag = open[1]; block = ''; }
      if (tag) {
        block += `${line}\n`;
        if (LOOP_DROP.test(line)) for (const n of pronames(block)) fnFrom.delete(n);
        if (line.split(tag).length > (open ? 2 : 1)) tag = null;
      }
      if (OTHER_SCHEMA.test(line)) continue;
      const made = FN_CREATE.exec(line);
      if (made) { fnFrom.set(made[1].toLowerCase(), f); continue; }
      const dropped = FN_DROP.exec(line);
      if (dropped) fnFrom.delete(dropped[1].toLowerCase());
    }
    for (const m of sql.matchAll(FN_RETURNS)) {
      if (/^(trigger|event_trigger)$/i.test(m[2])) triggers.add(m[1].toLowerCase());
      else triggers.delete(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(FN_GRANT)) {
      if (/\bservice_role\b/i.test(m[2])) granted.add(m[1].toLowerCase());
    }
  }
  const functions = new Map([...fnFrom].filter(([name]) => granted.has(name) && !triggers.has(name)));
  return { tables: tableFrom, functions, newest: files[files.length - 1] ?? null };
}

/** What PostgREST serves, from its OpenAPI listing (as the service role). */
export async function liveSchema(env) {
  const resp = await timedFetch(`${env.SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/openapi+json' },
  }, 20000);
  if (!resp.ok) return null;
  const doc = await resp.json().catch(() => null);
  if (!doc || typeof doc !== 'object' || !doc.paths) return null;
  const tables = new Set(Object.keys(doc.definitions ?? {}));
  const functions = new Set(Object.keys(doc.paths).filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5)));
  return { tables, functions };
}

/** The objects the chain ends with that the database does not serve. */
export function schemaGaps(expected, live) {
  const missing = [];
  for (const [t, file] of expected.tables) if (!live.tables.has(t)) missing.push({ kind: 'table', name: t, file });
  for (const [f, file] of expected.functions) if (!live.functions.has(f)) missing.push({ kind: 'function', name: f, file });
  return missing.sort((a, b) => a.file.localeCompare(b.file));
}

// ── preflight ────────────────────────────────────────────────────────────────

export const KEY_PREFIX = 'bench-conn-';

/**
 * Every problem that would make a run fail for a reason other than the
 * product, found before any scenario runs. Returns { fatal, warnings, info };
 * the runner stops on any fatal problem.
 */
export async function preflight(env, { github: gh = null, log = console.log } = {}) {
  const fatal = [];
  const warnings = [];
  const info = {};
  const stop = () => ({ fatal, warnings, info });

  // 1. Something answers at SUPABASE_URL.
  try {
    await timedFetch(`${env.SUPABASE_URL}/auth/v1/health`, { headers: { apikey: env.SUPABASE_ANON_KEY } }, 10000);
  } catch (err) {
    fatal.push(`Nothing answers at SUPABASE_URL=${env.SUPABASE_URL} (${err?.cause?.code ?? err?.message ?? err}). ` +
      'Start the stack first: `npx supabase start` for the dev stack, or `docker compose up -d` in deploy/community.');
    return stop();
  }

  // 2. The service key.
  try { await assertServiceKey(env); } catch (err) { fatal.push(err.message); return stop(); }

  // 3. The database carries every table and service-role function the
  //    migrations in this checkout end with.
  try {
    const expected = expectedSchema();
    const live = await liveSchema(env);
    info.newestMigration = expected.newest;
    if (!live) {
      warnings.push('PostgREST did not return its schema listing, so the schema check was skipped; a database behind the migrations would fail mid-run.');
    } else {
      const gaps = schemaGaps(expected, live);
      const total = expected.tables.size + expected.functions.size;
      if (gaps.length > total / 2) {
        // The projects table answered (step 2), so the database is not empty:
        // a listing this thin is PostgREST's OpenAPI mode, not the schema.
        warnings.push(`PostgREST's schema listing shows fewer than half of the ${total} objects the migrations make, so the schema check was skipped.`);
      } else if (gaps.length > 0) {
        const shown = gaps.slice(0, 8).map((g) => `${g.kind} ${g.name} (${g.file})`).join('; ');
        fatal.push(`The database is behind this checkout: ${gaps.length} object${gaps.length === 1 ? '' : 's'} missing, ${shown}${gaps.length > 8 ? '; ...' : ''}. ` +
          'Apply the migrations: `npx supabase migration up` (or `npx supabase db reset`, which also reseeds). ' +
          'The Docker quick start applies migrations only on its first boot.');
      }
    }
  } catch (err) {
    warnings.push(`The schema check could not run (${err?.message ?? err}).`);
  }

  // 4. The edge functions are served.
  try {
    const r = await timedFetch(`${env.SUPABASE_URL}/functions/v1/mcp-server`, { headers: { apikey: env.SUPABASE_ANON_KEY } }, 20000);
    const body = await r.json().catch(() => null);
    if (r.status !== 200 || !body?.data?.name) {
      fatal.push(`The edge functions are not being served at ${env.SUPABASE_URL}/functions/v1 (mcp-server answered ${r.status}). ` +
        'The dev stack serves them with `npx supabase start`; check `npx supabase status` and the edge runtime logs.');
    }
  } catch (err) {
    fatal.push(`The edge functions did not answer (${err?.message ?? err}).`);
  }

  // 5. The bench account signs in.
  let session = null;
  try { session = await signIn(env); info.userId = session.userId; } catch (err) { fatal.push(err.message); }

  if (session) {
    // 6. Leftovers of an interrupted run: minted keys hold connection slots.
    try {
      const db = rest(env);
      await db.delete('mcp_api_keys', `user_id=eq.${session.userId}&name=like.${KEY_PREFIX}*`);
      await db.update('mcp_oauth_tokens', `user_id=eq.${session.userId}&client_id=like.${KEY_PREFIX}*&revoked_at=is.null`, { revoked_at: new Date().toISOString() });
    } catch (err) {
      warnings.push(`Could not clear keys a previous run minted (${err?.message ?? err}).`);
    }
    // 7. The account's plan and connection headroom, as the person.
    const me = parseMcp(await mcpCallAs(env, { accessToken: session.accessToken }, 'list_api_keys', {}).catch((err) => ({ status: 0, data: { error: String(err) } })));
    const conn = me?.connections;
    if (conn && typeof conn.tier === 'string') {
      info.tier = conn.tier;
      info.connections = conn;
      if (typeof conn.limit === 'number' && typeof conn.used === 'number' && conn.limit - conn.used < 2) {
        warnings.push(`The bench account uses ${conn.used} of ${conn.limit} agent connections; v3-connections and checkout-loop each mint one more. Revoke one in the app (Agents, Connected).`);
      }
      if (!['team', 'enterprise', 'government'].includes(conn.tier)) {
        warnings.push(`The bench account is on ${conn.tier}. Scenarios written for a Team seat report SKIP for what this plan cannot do; \`npx supabase db reset\` restores the seeded Team account.`);
      }
    } else {
      warnings.push(`list_api_keys did not answer the account's plan as the signed-in person (${String(me?.raw ?? '').slice(0, 160)}).`);
    }
  }

  // 8. The MCP key is a key on this stack.
  try {
    const ping = await mcpRpc(env, { apiKey: env.MCP_API_KEY }, 'ping', {});
    if (ping.status === 401 || ping.status === 403) {
      fatal.push(`MCP_API_KEY is not a key on this stack (${ping.status}). Mint one in the app (Agents, Connected, Connect an agent) for ${env.BENCH_USER} and put it in scripts/bench/.env.bench.`);
    } else if (ping.status !== 200) {
      fatal.push(`The MCP server answered ${ping.status} to a ping with MCP_API_KEY: ${JSON.stringify(ping.data).slice(0, 200)}`);
    }
  } catch (err) {
    fatal.push(`The MCP server did not answer a ping (${err?.message ?? err}).`);
  }

  // 9. The sandbox repository is writable, with room under GitHub's limit.
  if (gh) {
    try {
      const repo = await gh.call('GET', gh.repo);
      if (repo.status === 401) fatal.push('GITHUB_TOKEN is rejected by GitHub (401). Make a token with contents and pull requests read/write on the sandbox repo.');
      else if (repo.status === 404) fatal.push(`BENCH_REPO ${env.BENCH_REPO} was not found, or GITHUB_TOKEN cannot see it.`);
      else if (repo.status !== 200) fatal.push(`GitHub answered ${repo.status} for ${env.BENCH_REPO}: ${JSON.stringify(repo.data).slice(0, 200)}`);
      else if (repo.data?.permissions && repo.data.permissions.push !== true) fatal.push(`GITHUB_TOKEN cannot push to ${env.BENCH_REPO}; the sandbox is reset by force-push before every scenario.`);
      const limit = await gh.call('GET', 'https://api.github.com/rate_limit');
      const remaining = limit.data?.resources?.core?.remaining;
      if (typeof remaining === 'number') {
        info.githubRemaining = remaining;
        if (remaining < 500) warnings.push(`GitHub allows ${remaining} more API calls this hour; a full run makes several hundred.`);
      }
    } catch (err) {
      fatal.push(`GitHub did not answer (${err?.message ?? err}).`);
    }
  }

  for (const w of warnings) log(`  warning: ${w}`);
  return stop();
}

// ── the run loop ─────────────────────────────────────────────────────────────

export function scenarioTimeoutMin(sc) {
  const n = Number(process.env.BENCH_SCENARIO_TIMEOUT_MIN);
  const base = Number.isFinite(n) && n > 0 ? n : 12;
  return typeof sc.timeoutMin === 'number' ? Math.max(sc.timeoutMin, base) : base;
}

class SetupError extends Error {}

function withTimeout(promise, ms, name) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} did not finish within ${Math.round(ms / 60000)} min (BENCH_SCENARIO_TIMEOUT_MIN). Its remaining calls may still land during the next scenario.`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** A scenario's status from its record. */
export function statusOf(s, { setupFailed = false } = {}) {
  if (setupFailed) return 'ERROR';
  // Only the stack or the harness failed (every failed check is marked so):
  // ERROR. Any product check failing makes it the product's: FAIL.
  if (s.failed.length > 0) return s.failed.every((c) => c.stack) ? 'ERROR' : 'FAIL';
  if (s.checks.length === 0) return s.skips.length > 0 ? 'SKIP' : 'FAIL';
  return 'PASS';
}

const SLOW_SETUP_MS = 20000;
const seconds = (ms) => `${Math.round(ms / 1000)} s`;

/** After a call the stack never answered: does it answer now? One health
 *  read, so the report says whether the stack stalled and came back or is
 *  still down. */
async function stackNow(env) {
  const t = Date.now();
  try {
    const r = await timedFetch(`${env.SUPABASE_URL}/auth/v1/health`, { headers: { apikey: env.SUPABASE_ANON_KEY } }, Math.min(10000, requestTimeoutMs()));
    return `afterwards the stack answered its health check (${r.status}) in ${Date.now() - t} ms, so it stalled and came back`;
  } catch (err) {
    return `afterwards the stack still gave no answer to its health check (${err?.message ?? err})`;
  }
}

/**
 * Run the scenarios one after another. Each gets a fresh session and a reset
 * sandbox (set-up failures are ERROR, not the product's), a time budget, and
 * keeps every check it made even when it throws.
 */
export async function runScenarios(scenarios, { env, freshSession, resetSandbox, log = console.log, onHeader = null }) {
  const results = [];
  for (const sc of scenarios) {
    if (onHeader) onHeader(sc);
    log(`━━ ${sc.name}`);
    const started = Date.now();
    Scenario.current = null;
    let s = null;
    let setupFailed = false;
    const setup = { signInMs: 0, resetMs: 0 };
    try {
      let session;
      try {
        let t = Date.now();
        session = await freshSession();
        setup.signInMs = Date.now() - t;
        t = Date.now();
        await resetSandbox();
        setup.resetMs = Date.now() - t;
      } catch (err) {
        throw new SetupError(`set-up failed before the scenario ran: ${err?.message ?? err}`);
      }
      // UAT 2026-09-27: a scenario took 382 s for one 60 s timeout; the rest
      // was spent before it started. A slow set-up is said, so a stalled
      // stack reads as one.
      if (setup.signInMs + setup.resetMs > SLOW_SETUP_MS) {
        log(`    set-up took ${seconds(setup.signInMs + setup.resetMs)} (sign-in ${seconds(setup.signInMs)}, sandbox reset ${seconds(setup.resetMs)})`);
      }
      const out = await withTimeout(Promise.resolve().then(() => sc.run(env, session)), scenarioTimeoutMin(sc) * 60000, sc.name);
      s = out?.s ?? Scenario.current;
    } catch (err) {
      setupFailed = err instanceof SetupError;
      s = Scenario.current ?? new Scenario(sc.name, sc.boxes);
      const detail = err?.stack ?? String(err);
      const stalled = isStackError(err);
      if (setupFailed) s.stackFailure('the harness set the scenario up', stalled ? `${detail}\n${await stackNow(env)}` : detail);
      // A request the stack never answered is the stack's; any other throw
      // (a budget overrun included: the product may have stalled) is the scenario's.
      else if (stalled) s.stackFailure('the stack answered every call of the scenario', `${detail}\n${await stackNow(env)}`);
      else s.check('scenario ran to completion', false, detail);
    }
    if (!s) {
      s = new Scenario(sc.name, sc.boxes);
      s.stackFailure('the scenario returned its record', 'run() returned nothing and made no Scenario');
    }
    if (s.transport.length > 0) {
      s.stackFailure('every MCP call reached its tool', s.transport.slice(0, 5).join('\n'));
    }
    if (s.checks.length === 0 && s.skips.length === 0) {
      s.stackFailure('the scenario made at least one check', 'it returned without checking anything');
    }
    results.push({ name: sc.name, boxes: sc.boxes ?? [], scenario: s, status: statusOf(s, { setupFailed }), ms: Date.now() - started, setup });
    Scenario.current = null;
    log('');
  }
  return results;
}

// ── summary, report, exit code ───────────────────────────────────────────────

/** Each checklist box and how the scenarios covering it came out. */
export function boxTally(results) {
  const byBox = new Map();
  const rank = { ERROR: 3, FAIL: 2, SKIP: 1, PASS: 0 };
  for (const r of results) {
    for (const box of r.boxes) {
      const prev = byBox.get(box);
      if (!prev || rank[r.status] > rank[prev]) byBox.set(box, r.status);
    }
  }
  return byBox;
}

export function exitCodeOf(results) {
  if (results.some((r) => r.status === 'FAIL')) return 1;
  if (results.some((r) => r.status === 'ERROR')) return 3;
  return 0;
}

/** Print the summary; returns the exit code. */
export function summarize(results, { log = console.log, groupOf = null } = {}) {
  const line = '━'.repeat(56);
  log(line);
  let group = null;
  for (const r of results) {
    const g = groupOf ? groupOf(r.name) : null;
    if (g && g !== group) { group = g; log(`  ${g}`); }
    const checks = r.scenario.checks;
    const failed = r.scenario.failed.length;
    const skips = r.scenario.skips.length;
    log(`  [${r.status.padEnd(5)}] ${r.name.padEnd(26)} ${checks.length - failed}/${checks.length} checks${skips ? `, ${skips} skipped` : ''}   ${Math.round(r.ms / 1000)} s`);
  }
  log(line);
  const counts = results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  log(`  ${results.length} scenarios: ${['PASS', 'FAIL', 'SKIP', 'ERROR'].filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(', ')}`);
  const boxes = boxTally(results);
  const notPassing = [...boxes].filter(([, st]) => st !== 'PASS');
  log(`  ${boxes.size} checklist boxes: ${boxes.size - notPassing.length} passing${notPassing.length ? `; not passing: ${notPassing.map(([b, st]) => `${b} (${st})`).join(', ')}` : ''}`);
  const code = exitCodeOf(results);
  if (counts.FAIL) log('\nA FAIL is a live bug report: the check, its payload and the scenario are above. Re-run one with -- --only=<name>.');
  if (counts.ERROR) log('\nAn ERROR is the stack or the harness, not the product: a call that never answered or failed below its tool, a set-up that failed, or a scenario that checked nothing. Every product check in it held. Re-run it with -- --only=<name>; if it repeats, the stack needs looking at.');
  if (code === 0) log(counts.SKIP ? '\nNothing failed. The SKIP lines say what this stack could not run, and why.' : '\nAll scenarios passed.');
  return code;
}

/** Write the run as JSON (scripts/bench/out is ignored by git). */
export function writeReport(results, { env, startedAt, runner, dir = REPORT_DIR }) {
  mkdirSync(dir, { recursive: true });
  const report = {
    runner, startedAt, finishedAt: new Date().toISOString(),
    stack: env.SUPABASE_URL, repo: env.BENCH_REPO, exitCode: exitCodeOf(results),
    scenarios: results.map((r) => ({
      name: r.name, boxes: r.boxes, status: r.status, ms: r.ms, setup: r.setup,
      checks: r.scenario.checks, skips: r.scenario.skips, transport: r.scenario.transport,
    })),
    boxes: Object.fromEntries(boxTally(results)),
  };
  const path = join(dir, 'bench-report.json');
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}

/** Stop the run before any scenario when the preflight found a problem. */
export function reportPreflight(result, { log = console.error } = {}) {
  if (result.fatal.length === 0) return false;
  log('\nThe bench cannot run against this stack yet:\n');
  for (const f of result.fatal) log(`  - ${f}`);
  log('\nNothing ran. Fix the above and run again (exit code 3).');
  return true;
}

export { sleep };

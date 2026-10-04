// The live bench's harness (owner 2026-09-27: "robustly harden our test
// bench ... for functional tests (not just testing itself but actual
// tests)"). The bench itself runs against the owner's stack; its harness is
// driven here against a small local HTTP server that answers the way the
// stack does, so the real code (scripts/bench/lib.mjs, harness.mjs) makes
// real requests: a stall is cut off, a 429 is waited out, an MCP call that
// fails below the tool fails its scenario, a scenario that throws keeps its
// checks, a scenario that checks nothing is not a pass, a SKIP is not a
// pass, and the preflight stops a run on a stack that is down, a database
// behind the migrations or an unknown key, naming the problem.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

// @ts-expect-error: plain ESM module without a declaration file
const lib = await import('../../scripts/bench/lib.mjs');
// @ts-expect-error: plain ESM module without a declaration file
const harness = await import('../../scripts/bench/harness.mjs');
// The run loop's answer, as far as these tests read it.
type RunCheck = { label: string; pass: boolean; detail?: unknown };
type RunResult = { name: string; status: 'PASS' | 'FAIL' | 'SKIP' | 'ERROR'; scenario: { checks: RunCheck[] } };

let server: Server;
let base = '';
let handler: Handler = (_req, _body, res) => { res.statusCode = 404; res.end(); };
const hits: Array<{ method: string; url: string; headers: IncomingMessage['headers']; body: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { hits.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body }); handler(req, body, res); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => { hits.length = 0; lib.Scenario.current = null; delete process.env.BENCH_SCENARIO_TIMEOUT_MIN; });

const json = (res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
};
const env = () => ({ SUPABASE_URL: base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', MCP_API_KEY: 'ns_live_key', BENCH_USER: 'bench@nodespec.local', BENCH_PASS: 'pw', BENCH_REPO: 'me/sandbox' });
const quiet = () => {};

describe('requests have a ceiling', () => {
  it('a call the stack never answers is cut off and names what stalled', async () => {
    handler = () => { /* never answers */ };
    const t0 = Date.now();
    await expect(lib.timedFetch(`${base}/functions/v1/mcp-server?x=1`, { method: 'POST' }, 300)).rejects.toThrow(`no answer within 0 s: POST ${base}/functions/v1/mcp-server`);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('a .env.bench value loses its quotes and a trailing comment', () => {
    expect([lib.envValue('"ghp_abc"'), lib.envValue("'x y'"), lib.envValue('value # note'), lib.envValue('a#b')]).toEqual(['ghp_abc', 'x y', 'value', 'a#b']);
  });
});

describe('the MCP door', () => {
  it('a 429 is waited out once (Retry-After) and the call sent again; the rate-limit scenario can ask for the raw 429', async () => {
    let n = 0;
    handler = (_req, _body, res) => (++n === 1 ? json(res, 429, { error: 'rate_limited' }, { 'Retry-After': '1' }) : json(res, 200, { jsonrpc: '2.0', id: 1, result: {} }));
    const t0 = Date.now();
    const r = await lib.mcpRpc(env(), { apiKey: 'k' }, 'ping', {});
    expect(r.status).toBe(200);
    expect(n).toBe(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    n = 0;
    const raw = await lib.mcpRpc(env(), { apiKey: 'k' }, 'ping', {}, { noRetry: true });
    expect([raw.status, n]).toEqual([429, 1]);
  });

  it('a call that failed below the tool is an error, and the running scenario records it', async () => {
    handler = (_req, _body, res) => json(res, 401, { error: 'unauthorized' });
    const s = new lib.Scenario('probe', []);
    const answer = lib.parseMcp(await lib.mcpCall(env(), 'list_projects', {}));
    expect(answer).toMatchObject({ isError: true, transport: true, status: 401 });
    expect(s.transport).toHaveLength(1);
    expect(s.transport[0]).toContain('HTTP 401');
  });

  it('a gateway page is read as its status and first bytes, not as {}', async () => {
    handler = (_req, _body, res) => { res.writeHead(502, { 'Content-Type': 'text/html' }); res.end('<html>Bad Gateway</html>'); };
    const answer = lib.parseMcp(await lib.mcpCall(env(), 'list_projects', {}));
    expect(answer.raw).toBe('HTTP 502, non-JSON body: <html>Bad Gateway</html>');
    const fn = await lib.callFn(env(), { accessToken: 't' }, 'git-push', {});
    expect(fn).toEqual({ status: 502, data: { nonJson: true, status: 502, body: '<html>Bad Gateway</html>' } });
  });

  it('a tool\'s own answer is read as it was: JSON parsed, a refusal an error, no transport record', async () => {
    const s = new lib.Scenario('probe', []);
    handler = (_req, _body, res) => json(res, 200, { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"projects":[]}' }] } });
    expect(lib.parseMcp(await lib.mcpCall(env(), 'list_projects', {}))).toEqual({ projects: [] });
    handler = (_req, _body, res) => json(res, 200, { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Not on this plan.' }], isError: true } });
    expect(lib.parseMcp(await lib.mcpCall(env(), 'upsert_workflow', {}))).toMatchObject({ raw: 'Not on this plan.', isError: true });
    expect(s.transport).toEqual([]);
  });
});

describe('the run loop', () => {
  const run = (scenarios: unknown[], over: Record<string, unknown> = {}): Promise<RunResult[]> =>
    harness.runScenarios(scenarios, { env: env(), freshSession: async () => ({ accessToken: 't', userId: 'u' }), resetSandbox: async () => {}, log: quiet, ...over });
  const sc = (name: string, body: (s: InstanceType<typeof lib.Scenario>) => unknown | Promise<unknown>, extra: Record<string, unknown> = {}) => ({
    name, boxes: [`box ${name}`], ...extra,
    run: async () => { const s = new lib.Scenario(name, [`box ${name}`]); await body(s); return { s }; },
  });

  it('PASS, FAIL, SKIP and ERROR mean what they say; the exit code follows', async () => {
    handler = (_req, _body, res) => json(res, 401, { error: 'unauthorized' });
    const results = await run([
      sc('passes', (s) => { s.check('a real check', true); }),
      sc('fails', (s) => { s.check('a real check', false, 'the payload'); }),
      sc('checks-nothing', () => {}),
      sc('skips', (s) => { s.skip('the Team seat', 'the bench account is on community'); }),
      sc('throws-late', (s) => { s.check('first', true); s.check('second', true); throw new Error('boom'); }),
      sc('hides-a-401', async (s) => { lib.parseMcp(await lib.mcpCall(env(), 'list_projects', {})); s.check('a check that would pass anyway', true); }),
    ]);
    const by = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(by.passes.status).toBe('PASS');
    expect(by.fails.status).toBe('FAIL');
    expect(by['checks-nothing'].status).toBe('ERROR');
    expect(by['checks-nothing'].scenario.checks.map((c) => c.label)).toEqual(['the scenario made at least one check']);
    expect(by.skips.status).toBe('SKIP');
    expect(by['throws-late'].status).toBe('FAIL');
    expect(by['throws-late'].scenario.checks.map((c) => [c.label, c.pass])).toEqual([['first', true], ['second', true], ['scenario ran to completion', false]]);
    expect(by['hides-a-401'].status).toBe('ERROR');
    expect(by['hides-a-401'].scenario.checks.at(-1)).toMatchObject({ label: 'every MCP call reached its tool', pass: false });
    expect(harness.exitCodeOf(results)).toBe(1);
    expect(harness.exitCodeOf(results.filter((r) => ['passes', 'skips'].includes(r.name)))).toBe(0);
  });

  it('a call the stack never answers is the stack\'s ERROR; a product check failing beside it is still a FAIL', async () => {
    handler = () => { /* never answers */ };
    process.env.BENCH_REQUEST_TIMEOUT_MS = '200';
    try {
      const results = await run([
        sc('stack-hangs', async (s) => { s.check('got going', true); await lib.mcpRpc(env(), { apiKey: 'k' }, 'ping', undefined, { noRetry: true }); s.check('never reached', true); }),
        sc('product-and-stack', async (s) => {
          s.check('the rule held', false, 'the product broke');
          await lib.mcpRpc(env(), { apiKey: 'k' }, 'ping', undefined, { noRetry: true });
        }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['ERROR', 'FAIL']);
      expect(results[0].scenario.checks.map((c) => [c.label, c.pass])).toEqual([['got going', true], ['the stack answered every call of the scenario', false]]);
      expect(String(results[0].scenario.checks[1].detail)).toContain('no answer within');
      // and it says whether the stack came back: here it still does not answer
      expect(String(results[0].scenario.checks[1].detail)).toContain('afterwards the stack still gave no answer to its health check');
      expect(harness.exitCodeOf([results[0]])).toBe(3);
      expect(harness.exitCodeOf(results)).toBe(1);
      const lines: string[] = [];
      harness.summarize(results, { log: (l: string) => lines.push(l) });
      const text = lines.join('\n');
      expect(text).toContain('A FAIL is a live bug report');
      expect(text).toContain('An ERROR is the stack or the harness, not the product');
    } finally {
      delete process.env.BENCH_REQUEST_TIMEOUT_MS;
    }
  });

  it('a sandbox that cannot be reset is the harness\'s ERROR, not the product\'s FAIL, and the next scenario still runs', async () => {
    let resets = 0;
    const results = await run([sc('a', (s) => s.check('x', true)), sc('b', (s) => s.check('x', true))], {
      resetSandbox: async () => { if (++resets === 1) throw new Error('GitHub 401'); },
    });
    expect(results.map((r) => r.status)).toEqual(['ERROR', 'PASS']);
    expect(results[0].scenario.checks[0]).toMatchObject({ label: 'the harness set the scenario up', pass: false });
    expect(harness.exitCodeOf(results)).toBe(3);
  });

  it('set-up is timed apart from the scenario, so a stalled stack reads as one', async () => {
    const lines: string[] = [];
    const results = await run([sc('a', (s) => s.check('x', true))], {
      freshSession: async () => { await new Promise((r) => setTimeout(r, 60)); return { accessToken: 't', userId: 'u' }; },
      resetSandbox: async () => { await new Promise((r) => setTimeout(r, 40)); },
      log: (l: string) => lines.push(l),
    });
    const setup = (results[0] as unknown as { setup: { signInMs: number; resetMs: number } }).setup;
    expect(setup.signInMs).toBeGreaterThanOrEqual(50);
    expect(setup.resetMs).toBeGreaterThanOrEqual(30);
    expect(lines.some((l) => l.includes('set-up took'))).toBe(false); // quick set-ups stay quiet
    const { mkdtempSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = harness.writeReport(results, { env: env(), startedAt: 'now', runner: 'test', dir: mkdtempSync(`${tmpdir()}/bench-report-`) });
    expect(JSON.parse(readFileSync(path, 'utf-8')).scenarios[0].setup).toEqual(setup);
  });

  it('after a stack failure the harness checks whether the stack came back', async () => {
    let calls = 0;
    handler = (req, _body, res) => {
      if ((req.url ?? '').startsWith('/auth/v1/health')) return json(res, 200, { name: 'GoTrue' });
      calls++; // the scenario's call is never answered
    };
    process.env.BENCH_REQUEST_TIMEOUT_MS = '200';
    try {
      const [r] = await run([sc('stalls', async () => { await lib.mcpRpc(env(), { apiKey: 'k' }, 'ping', undefined, { noRetry: true }); })]);
      expect(r.status).toBe('ERROR');
      expect(String(r.scenario.checks[0].detail)).toMatch(/afterwards the stack answered its health check \(200\) in \d+ ms, so it stalled and came back/);
      expect(calls).toBe(1);
    } finally {
      delete process.env.BENCH_REQUEST_TIMEOUT_MS;
    }
  });

  it('every scenario signs in afresh', async () => {
    let signIns = 0;
    await run([sc('a', (s) => s.check('x', true)), sc('b', (s) => s.check('x', true))], { freshSession: async () => ({ accessToken: `t${++signIns}`, userId: 'u' }) });
    expect(signIns).toBe(2);
  });

  it('a scenario that never finishes is stopped at its budget and the run goes on', async () => {
    process.env.BENCH_SCENARIO_TIMEOUT_MIN = String(0.3 / 60);
    const results = await run([
      sc('hangs', async (s) => { s.check('got going', true); await new Promise(() => {}); }),
      sc('after', (s) => s.check('x', true)),
    ]);
    expect(results.map((r) => r.status)).toEqual(['FAIL', 'PASS']);
    expect(results[0].scenario.checks.map((c) => c.label)).toEqual(['got going', 'scenario ran to completion']);
    expect(String(results[0].scenario.checks[1].detail)).toContain('hangs did not finish within');
  });

  it('the summary tallies the checklist boxes, and the report is written', async () => {
    const results = await run([sc('passes', (s) => s.check('x', true)), sc('fails', (s) => s.check('x', false, 'p'))]);
    const lines: string[] = [];
    expect(harness.summarize(results, { log: (l: string) => lines.push(l) })).toBe(1);
    expect(lines.join('\n')).toContain('2 checklist boxes: 1 passing; not passing: box fails (FAIL)');
    const { mkdtempSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/bench-report-`);
    const path = harness.writeReport(results, { env: env(), startedAt: 'now', runner: 'test', dir });
    const report = JSON.parse(readFileSync(path, 'utf-8'));
    expect(report.exitCode).toBe(1);
    expect(report.boxes).toEqual({ 'box passes': 'PASS', 'box fails': 'FAIL' });
    expect(report.scenarios[1].checks[0]).toMatchObject({ label: 'x', pass: false, detail: 'p' });
  });
});

describe('the preflight', () => {
  const expected = harness.expectedSchema();
  const openapi = (drop: string[] = []) => ({
    swagger: '2.0',
    definitions: Object.fromEntries([...expected.tables.keys()].filter((t) => !drop.includes(t)).map((t) => [t, {}])),
    paths: Object.fromEntries([...expected.functions.keys()].filter((f) => !drop.includes(f)).map((f) => [`/rpc/${f}`, {}])),
  });
  /** A stack that answers the way a healthy dev stack does; `over` breaks one part. */
  const stack = (over: { schemaDrop?: string[]; keyRejected?: boolean; tier?: string; used?: number } = {}): Handler => (req, body, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/auth/v1/health')) return json(res, 200, { name: 'GoTrue' });
    if (url.startsWith('/auth/v1/token')) return json(res, 200, { access_token: 'jwt', user: { id: 'u1' } });
    if (url === '/rest/v1/') return json(res, 200, openapi(over.schemaDrop));
    if (url.startsWith('/rest/v1/projects')) return json(res, 200, []);
    if (url.startsWith('/rest/v1/mcp_api_keys')) { res.statusCode = 204; return res.end(); }
    if (url.startsWith('/rest/v1/mcp_oauth_tokens')) return json(res, 200, []);
    if (url.startsWith('/functions/v1/mcp-server') && req.method === 'GET') return json(res, 200, { success: true, data: { name: 'NodeSpec MCP Server' } });
    if (url.startsWith('/functions/v1/mcp-server')) {
      const rpc = JSON.parse(body || '{}');
      if (rpc.method === 'ping') return over.keyRejected ? json(res, 401, { error: 'unauthorized' }) : json(res, 200, { jsonrpc: '2.0', id: 1, result: {} });
      if (rpc.params?.name === 'list_api_keys') {
        return json(res, 200, { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ apiKeys: [], connections: { tier: over.tier ?? 'team', used: over.used ?? 1, limit: 5 } }) }] } });
      }
    }
    return json(res, 404, {});
  };
  const gh = (push = true) => ({ repo: 'repo', call: async (_m: string, url: string) => (url.endsWith('rate_limit') ? { status: 200, data: { resources: { core: { remaining: 4800 } } } } : { status: 200, data: { permissions: { push } } }) });

  it('reads the migration chain: tables made and dropped, functions granted to the service role and never dropped, never a trigger', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/bench-chain-`);
    writeFileSync(`${dir}/001_first.sql`, [
      'CREATE TABLE IF NOT EXISTS gone (id uuid);',
      'CREATE UNLOGGED TABLE public.buckets (holder text PRIMARY KEY);',
      'CREATE OR REPLACE FUNCTION public.kept(p_id uuid)',
      'RETURNS jsonb LANGUAGE sql AS $$ SELECT \'{}\'::jsonb $$;',
      'GRANT EXECUTE ON FUNCTION public.kept(uuid) TO authenticated, service_role;',
      'CREATE OR REPLACE FUNCTION public.dropped() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;',
      'GRANT EXECUTE ON FUNCTION public.dropped() TO service_role;',
      'CREATE OR REPLACE FUNCTION public.on_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;',
      'GRANT EXECUTE ON FUNCTION public.on_insert() TO service_role;',
      'CREATE OR REPLACE FUNCTION public.private_helper() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;',
    ].join('\n'));
    writeFileSync(`${dir}/002_second.sql`, 'DROP TABLE IF EXISTS gone;\nCREATE TABLE projects (id uuid);\nDROP FUNCTION IF EXISTS public.dropped();\n');
    const chain = harness.expectedSchema(dir);
    expect(Object.fromEntries(chain.tables)).toEqual({ buckets: '001_first.sql', projects: '002_second.sql' });
    expect(Object.fromEntries(chain.functions)).toEqual({ kept: '001_first.sql' });
    expect(chain.newest).toBe('002_second.sql');
  });

  it('a function dropped in a loop over its overloads is gone; a block that only reads pg_proc drops nothing; one made again after the loop stays', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/bench-loop-`);
    writeFileSync(`${dir}/001_first.sql`, ['searched', 'checked', 'remade'].flatMap((n) => [
      `CREATE OR REPLACE FUNCTION public.${n}() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`,
      `GRANT EXECUTE ON FUNCTION public.${n}() TO service_role;`,
    ]).join('\n'));
    writeFileSync(`${dir}/002_second.sql`, [
      'DO $$',
      'DECLARE r record;',
      'BEGIN',
      '  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace',
      "    WHERE n.nspname = 'public' AND p.proname IN ('searched',",
      "      'remade')",
      '  LOOP',
      "    EXECUTE format('DROP FUNCTION %s', r.sig);",
      '  END LOOP;',
      'END $$;',
      'CREATE OR REPLACE FUNCTION public.remade() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;',
      'DO $$',
      'BEGIN',
      "  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'checked') THEN RAISE NOTICE 'still here'; END IF;",
      "  EXECUTE 'SELECT 1';",
      'END $$;',
    ].join('\n'));
    expect(Object.fromEntries(harness.expectedSchema(dir).functions)).toEqual({ checked: '001_first.sql', remade: '002_second.sql' });
    // AH.2 drops the meaning search that way; a stack that applied it is not behind this checkout
    expect(expected.functions.has('repo_index_semantic_search')).toBe(false);
    expect(expected.functions.has('repo_index_semantics_available')).toBe(false);
  });

  it('reads the community export\'s schema dump for its tables, quoted names and all, and asks nothing of its functions', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/bench-dump-`);
    writeFileSync(`${dir}/00000000000001_schema.sql`, [
      '-- PostgreSQL database dump',
      'CREATE TABLE IF NOT EXISTS "public"."projects" (',
      '    "id" "uuid" NOT NULL',
      ');',
      'CREATE OR REPLACE FUNCTION "public"."node_memory"("p_node" "uuid") RETURNS "jsonb"',
      '    LANGUAGE "sql" AS $$ SELECT \'{}\'::jsonb $$;',
      'GRANT ALL ON FUNCTION "public"."node_memory"("p_node" "uuid") TO "service_role";',
    ].join('\n'));
    const dump = harness.expectedSchema(dir);
    expect([...dump.tables.keys()]).toEqual(['projects']);
    expect(dump.functions.size).toBe(0);
  });

  it('this tree\'s own migrations promise the tables the bench leans on', () => {
    expect(expected.tables.size).toBeGreaterThan(30);
    for (const t of ['projects', 'branches', 'mcp_api_keys', 'mcp_rate_buckets']) expect(expected.tables.has(t), t).toBe(true);
    expect(expected.tables.has('audit_log')).toBe(false); // dropped by the chain (V3 1.3)
  });

  it('a healthy stack: nothing fatal, the plan read as the person, the keys a previous run minted cleared', async () => {
    handler = stack();
    const r = await harness.preflight(env(), { github: gh(), log: quiet });
    expect(r.fatal).toEqual([]);
    expect(r.info).toMatchObject({ tier: 'team', userId: 'u1', githubRemaining: 4800 });
    expect(hits.some((h) => h.method === 'DELETE' && h.url.includes('mcp_api_keys') && h.url.includes('name=like.bench-conn-*'))).toBe(true);
  });

  it('nothing listening: the run stops naming SUPABASE_URL and how to start the stack', async () => {
    const r = await harness.preflight({ ...env(), SUPABASE_URL: 'http://127.0.0.1:1' }, { log: quiet });
    expect(r.fatal).toHaveLength(1);
    expect(r.fatal[0]).toContain('Nothing answers at SUPABASE_URL=http://127.0.0.1:1');
    expect(r.fatal[0]).toContain('npx supabase start');
  });

  it('a database behind the checkout: the run stops naming what is missing and the migration that makes it', async () => {
    handler = stack({ schemaDrop: ['mcp_rate_buckets'] });
    const r = await harness.preflight(env(), { log: quiet });
    expect(r.fatal).toHaveLength(1);
    expect(r.fatal[0]).toContain('The database is behind this checkout: 1 object missing');
    expect(r.fatal[0]).toContain(`table mcp_rate_buckets (${expected.tables.get('mcp_rate_buckets')})`);
    expect(r.fatal[0]).toContain('npx supabase migration up');
  });

  it('a thin schema listing is PostgREST\'s mode, not the schema: a warning, not a stop', async () => {
    handler = stack({ schemaDrop: [...expected.tables.keys(), ...expected.functions.keys()].slice(0, 100) });
    const r = await harness.preflight(env(), { log: quiet });
    expect(r.fatal).toEqual([]);
    expect(r.warnings.join(' ')).toContain('fewer than half');
  });

  it('an MCP key the stack does not know stops the run and says where to mint one', async () => {
    handler = stack({ keyRejected: true });
    const r = await harness.preflight(env(), { log: quiet });
    expect(r.fatal).toEqual([expect.stringContaining('MCP_API_KEY is not a key on this stack (401)')]);
  });

  it('a sandbox the token cannot push to stops the run', async () => {
    handler = stack();
    const r = await harness.preflight(env(), { github: gh(false), log: quiet });
    expect(r.fatal).toEqual(['GITHUB_TOKEN cannot push to me/sandbox; the sandbox is reset by force-push before every scenario.']);
  });

  it('a Free account and a full connection allowance are warned about before they make SKIPs and failures', async () => {
    handler = stack({ tier: 'community', used: 4 });
    const r = await harness.preflight(env(), { log: quiet });
    expect(r.fatal).toEqual([]);
    expect(r.warnings.join(' ')).toContain('uses 4 of 5 agent connections');
    expect(r.warnings.join(' ')).toContain('The bench account is on community');
  });

  it('a stopped preflight prints every problem and asks for exit code 3', () => {
    const lines: string[] = [];
    expect(harness.reportPreflight({ fatal: ['one', 'two'], warnings: [], info: {} }, { log: (l: string) => lines.push(l) })).toBe(true);
    expect(lines.join('\n')).toContain('  - one\n  - two');
    expect(harness.reportPreflight({ fatal: [], warnings: [], info: {} }, { log: quiet })).toBe(false);
  });
});

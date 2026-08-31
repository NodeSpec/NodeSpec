// SB-4 · live bench harness — shared plumbing.
//
// Zero dependencies by design: built-in fetch (Node >= 18) + node:crypto. Runs
// on the bench machine (Windows included) against the LOCAL Supabase stack and
// the dedicated GitHub sandbox repo. Nothing here ever talks to production —
// refuse to run if the URL is not local unless explicitly overridden.
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── env ───────────────────────────────────────────────────────────────────────

export function loadEnv({ dryRun = false } = {}) {
  const envPath = join(HERE, '.env.bench');
  const fromFile = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) fromFile[m[1]] = m[2];
    }
  }
  // A blank "KEY=" line (as shipped in .env.bench.example) must count as absent,
  // not as an empty-string value — PostgREST would otherwise get "Bearer " and
  // fail mid-run with PGRST301 "Empty JWT" instead of a named config error here.
  const pick = (v) => (v === undefined || String(v).trim() === '' ? undefined : v);
  const get = (k, fallback) => pick(process.env[k]) ?? pick(fromFile[k]) ?? fallback;

  const env = {
    SUPABASE_URL: (get('SUPABASE_URL', 'http://127.0.0.1:54321')).replace(/\/+$/, ''),
    SUPABASE_ANON_KEY: get('SUPABASE_ANON_KEY', dryRun ? 'dry-anon' : undefined),
    SUPABASE_SERVICE_ROLE_KEY: get('SUPABASE_SERVICE_ROLE_KEY', dryRun ? 'dry-service' : undefined),
    GITHUB_TOKEN: get('GITHUB_TOKEN', dryRun ? 'dry-token' : undefined),
    BENCH_REPO: get('BENCH_REPO', dryRun ? 'owner/nodespec-bench-sandbox' : undefined),
    // The SB-3 seeded staging identity (supabase/seed.sql).
    BENCH_USER: get('BENCH_USER', 'bench@nodespec.local'),
    BENCH_PASS: get('BENCH_PASS', 'benchpass123'),
    // The SB-3 pre-minted MCP API key (plaintext; sha256 stored in mcp_api_keys).
    MCP_API_KEY: get('MCP_API_KEY', 'ns_live_staging_bench_00000000000000000000000000000000'),
    ALLOW_NONLOCAL: get('ALLOW_NONLOCAL', '') === '1',
  };

  const missing = Object.entries(env)
    .filter(([k, v]) => v === undefined && k !== 'ALLOW_NONLOCAL')
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `Missing or blank bench config: ${missing.join(', ')}. Copy scripts/bench/.env.bench.example ` +
      `to scripts/bench/.env.bench and fill in EVERY blank value — a bare "KEY=" line counts as missing. ` +
      `The Supabase keys are printed by \`npx supabase status\`: anon/Publishable (sb_publishable_…) → ` +
      `SUPABASE_ANON_KEY, service_role/Secret (sb_secret_…) → SUPABASE_SERVICE_ROLE_KEY. ` +
      `Self-hosted compose stacks keep them in the stack's .env.`,
    );
  }
  // New-format key sanity: catch a publishable/secret swap before any network
  // call — a swapped pair fails much later with an opaque permission error.
  if (env.SUPABASE_ANON_KEY.startsWith('sb_secret_')) {
    throw new Error(
      'SUPABASE_ANON_KEY holds a SECRET key (sb_secret_…). The Publishable key (sb_publishable_…) ' +
      'goes in SUPABASE_ANON_KEY; the Secret key goes in SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_publishable_')) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY holds a PUBLISHABLE key (sb_publishable_…). The Secret key ' +
      '(sb_secret_…) goes in SUPABASE_SERVICE_ROLE_KEY; the Publishable key goes in SUPABASE_ANON_KEY.',
    );
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.SUPABASE_URL + '/') && !env.ALLOW_NONLOCAL) {
    // Guardrail 9: verification runs on the bench, never production.
    throw new Error(
      `SUPABASE_URL "${env.SUPABASE_URL}" is not local. The harness churns projects and force-pushes ` +
      `the sandbox repo — refusing. Set ALLOW_NONLOCAL=1 only if you are absolutely sure.`,
    );
  }
  if (!/^[^/]+\/[^/]+$/.test(env.BENCH_REPO)) {
    throw new Error(`BENCH_REPO must be "owner/name", got "${env.BENCH_REPO}"`);
  }
  const [repoOwner, repoName] = env.BENCH_REPO.split('/');
  return { ...env, repoOwner, repoName };
}

// ── supabase: auth, edge functions, PostgREST ────────────────────────────────

/**
 * Validate the service key with one cheap PostgREST call BEFORE any scenario
 * runs — a wrong key would otherwise surface as a PGRST301 deep inside cleanup
 * with nothing naming the misconfigured variable.
 */
export async function assertServiceKey(env) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/projects?select=id&limit=1`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY was rejected by PostgREST (${resp.status}): ${body.slice(0, 200)}. ` +
      `Copy the service_role key (older CLI) or Secret key (sb_secret_…, newer CLI) printed by ` +
      `\`npx supabase status\` into scripts/bench/.env.bench.`,
    );
  }
}

export async function signIn(env) {
  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: env.BENCH_USER, password: env.BENCH_PASS }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(`Sign-in as ${env.BENCH_USER} failed (${resp.status}): ${JSON.stringify(data).slice(0, 300)}. ` +
      `Did \`supabase db reset\` run the SB-3 seed?`);
  }
  return { accessToken: data.access_token, userId: data.user?.id };
}

/** Call a deployed edge function exactly the way the client does. */
export async function callFn(env, session, name, body) {
  const resp = await fetch(`${env.SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      apikey: env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

/** PostgREST with the service key — assertions and fixture writes. */
export function rest(env) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  const base = `${env.SUPABASE_URL}/rest/v1`;
  return {
    async select(table, query) {
      const resp = await fetch(`${base}/${table}?${query}`, { headers });
      if (!resp.ok) throw new Error(`SELECT ${table}?${query} → ${resp.status}: ${await resp.text()}`);
      return resp.json();
    },
    async insert(table, rows) {
      const resp = await fetch(`${base}/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(rows),
      });
      if (!resp.ok) throw new Error(`INSERT ${table} → ${resp.status}: ${await resp.text()}`);
      return resp.json();
    },
    async update(table, query, patch) {
      const resp = await fetch(`${base}/${table}?${query}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) throw new Error(`UPDATE ${table}?${query} → ${resp.status}: ${await resp.text()}`);
      return resp.json();
    },
    async delete(table, query) {
      const resp = await fetch(`${base}/${table}?${query}`, { method: 'DELETE', headers });
      if (!resp.ok) throw new Error(`DELETE ${table}?${query} → ${resp.status}: ${await resp.text()}`);
    },
  };
}

/** MCP tools/call over HTTP with the seeded API key. */
export async function mcpCall(env, toolName, args) {
  const resp = await fetch(`${env.SUPABASE_URL}/functions/v1/mcp-server`, {
    method: 'POST',
    headers: {
      'X-MCP-API-Key': env.MCP_API_KEY,
      apikey: env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

// ── GitHub API (the out-of-band half) ─────────────────────────────────────────

export function github(env) {
  const base = 'https://api.github.com';
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'nodespec-bench',
    'Content-Type': 'application/json',
  };
  const repo = `${base}/repos/${env.repoOwner}/${env.repoName}`;
  // Transient network faults (undici "fetch failed", connection resets, DNS
  // hiccups) killed a live scenario mid-settle-poll; a bench run must absorb
  // them, not report them as product bugs. HTTP error statuses still return
  // normally — only a thrown fetch is retried.
  const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR|socket/i;
  const call = async (method, url, body) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
        const text = await resp.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
        return { status: resp.status, data };
      } catch (err) {
        const detail = `${err?.message ?? err} ${err?.cause?.code ?? err?.cause?.message ?? ''}`;
        if (attempt >= 3 || !TRANSIENT.test(detail)) throw err;
        await sleep(1000 * 2 ** attempt);
      }
    }
  };
  return {
    call, repo,
    /** File content at a ref (decoded), or null when absent. */
    async getFile(path, ref) {
      const r = await call('GET', `${repo}/contents/${encodeURIComponent(path).replaceAll('%2F', '/')}?ref=${encodeURIComponent(ref)}`);
      if (r.status === 404) return null;
      if (r.status !== 200) throw new Error(`getFile ${path}@${ref} → ${r.status}`);
      return { sha: r.data.sha, content: Buffer.from(r.data.content, 'base64').toString('utf-8') };
    },
    /**
     * getFile with retries. The contents API serves STALE responses (including
     * 404s for files that verifiably exist in the pushed commit's tree) for a
     * few seconds after a force-push — and resetSandbox force-resets main
     * before every scenario. Any read-after-own-push must poll, not trust the
     * first answer; the live run proved it by 404ing model.json in one
     * scenario and spec.json in another, nondeterministically. Returns null
     * only after the file stayed absent for the whole window.
     *
     * CAVEAT (live find 2026-08-23): the polling predicate is EXISTENCE ONLY —
     * stale-but-existing content satisfies it on the first probe. A read of a
     * file your own push just MUTATED must go by the push's commit sha (or a
     * content-predicated until), never by branch ref.
     */
    async getFileEventually(path, ref, { timeoutMs = 45000 } = {}) {
      return until(() => this.getFile(path, ref), { timeoutMs });
    },
    /** Create/update a file on a branch (an out-of-band commit). Returns the commit sha. */
    async putFile(path, branch, content, message) {
      const put = (sha) => call('PUT', `${repo}/contents/${encodeURIComponent(path).replaceAll('%2F', '/')}`, {
        message, branch, content: Buffer.from(content, 'utf-8').toString('base64'),
        ...(sha ? { sha } : {}),
      });
      const existing = await this.getFile(path, branch);
      let r = await put(existing?.sha);
      // The write-side of the stale-contents race: the sha probe above can 404
      // (or return an OLD sha) for a few seconds after a force-push even though
      // the file exists — GitHub then rejects with 422 "sha wasn't supplied" /
      // 409 conflict. Re-probe through the polling read and retry once.
      if (r.status === 422 || r.status === 409) {
        const fresh = await this.getFileEventually(path, branch);
        if (fresh && fresh.sha !== existing?.sha) r = await put(fresh.sha);
      }
      if (r.status !== 200 && r.status !== 201) throw new Error(`putFile ${path}@${branch} → ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
      return r.data.commit?.sha;
    },
    async headSha(branch) {
      const r = await call('GET', `${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
      if (r.status !== 200) return null;
      return r.data.object?.sha ?? null;
    },
    async mergePr(number, method) {
      return call('PUT', `${repo}/pulls/${number}/merge`, { merge_method: method });
    },
    /**
     * Reset the sandbox to a single orphan README commit on the default branch
     * and delete every other ref. The whole point of the dedicated repo.
     */
    async resetSandbox(defaultBranch = 'main') {
      const tree = await call('POST', `${repo}/git/trees`, {
        tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: `bench sandbox reset ${new Date().toISOString()}\n` }],
      });
      if (tree.status === 409 && /empty/i.test(tree.data?.message ?? '')) {
        // Brand-new sandbox with ZERO commits: the Git Data API cannot write
        // until the first commit exists. The Contents API can — and its result
        // (a single README commit on the default branch, no other refs) IS the
        // reset contract's end-state, so we're done. Every later reset finds a
        // non-empty repo and takes the orphan-commit path below.
        const boot = await call('PUT', `${repo}/contents/README.md`, {
          message: 'bench: sandbox bootstrap',
          branch: defaultBranch,
          content: Buffer.from(`bench sandbox reset ${new Date().toISOString()}\n`, 'utf-8').toString('base64'),
        });
        if (boot.status !== 200 && boot.status !== 201) {
          throw new Error(`sandbox reset: empty-repo bootstrap → ${boot.status}: ${JSON.stringify(boot.data).slice(0, 200)}`);
        }
        return boot.data.commit?.sha;
      }
      if (tree.status !== 201) throw new Error(`sandbox reset: tree → ${tree.status}: ${JSON.stringify(tree.data).slice(0, 200)}`);
      const commit = await call('POST', `${repo}/git/commits`, {
        message: 'bench: sandbox reset', tree: tree.data.sha, parents: [],
      });
      if (commit.status !== 201) throw new Error(`sandbox reset: commit → ${commit.status}`);
      const patch = await call('PATCH', `${repo}/git/refs/heads/${encodeURIComponent(defaultBranch)}`, {
        sha: commit.data.sha, force: true,
      });
      if (patch.status !== 200) {
        // Ref may not exist on a brand-new repo — create it.
        const create = await call('POST', `${repo}/git/refs`, { ref: `refs/heads/${defaultBranch}`, sha: commit.data.sha });
        if (create.status !== 201) throw new Error(`sandbox reset: ref → ${patch.status}/${create.status}`);
      }
      const refs = await call('GET', `${repo}/git/refs/heads`);
      if (refs.status === 200 && Array.isArray(refs.data)) {
        for (const ref of refs.data) {
          const name = ref.ref?.replace('refs/heads/', '');
          if (name && name !== defaultBranch) {
            await call('DELETE', `${repo}/git/refs/heads/${encodeURIComponent(name)}`);
          }
        }
      }
      // SETTLE (bench-audit round 15): the provider serves PRE-reset content for a
      // few seconds after the force-push. A scenario that connects during that
      // window reads the PREVIOUS scenario's anchor and raises a spurious
      // connect-anchor-mismatch card (live-caught: legacy-anchor-compat failed on a
      // modelDiff whose added and removed edges carried the SAME labels — the old
      // project's uuids against the new one's). Reset is not done until the
      // provider agrees main is the orphan commit with NO anchor.
      const settled = await until(async () => {
        const head = await this.headSha(defaultBranch);
        if (head !== commit.data.sha) return null;
        const anchor = await this.getFile('.nodespec/model.json', defaultBranch);
        return anchor === null ? true : null;
      }, { timeoutMs: 30000, everyMs: 2000 });
      if (!settled) {
        throw new Error('sandbox reset never settled — the provider still serves pre-reset content (head or stale anchor); rerun');
      }
      return commit.data.sha;
    },
  };
}

// ── webhook forging ───────────────────────────────────────────────────────────

/**
 * POST an HMAC-SHA256-signed GitHub push payload to the LOCAL git-webhook.
 * GitHub can never reach a localhost bench; a locally-forged valid signature
 * exercises the identical verification path — this makes the webhook lane
 * testable for the first time.
 */
export async function postSignedWebhook(env, integrationId, secret, payload, { badSignature = false } = {}) {
  const body = JSON.stringify(payload);
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  const resp = await fetch(`${env.SUPABASE_URL}/functions/v1/git-webhook?integration_id=${integrationId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'push',
      'X-Hub-Signature-256': badSignature ? 'sha256=' + '0'.repeat(64) : sig,
      // Local gateway may require an api key; real GitHub deliveries cannot send
      // one, which is why git-webhook is verify_jwt=false — harmless here.
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
    body,
  });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

// ── assertions + reporting ────────────────────────────────────────────────────

export class Scenario {
  constructor(name, boxes) {
    this.name = name;
    this.boxes = boxes; // checklist box refs this scenario covers
    this.checks = [];
  }
  check(label, cond, detail) {
    this.checks.push({ label, pass: !!cond, detail: cond ? undefined : detail });
    const mark = cond ? 'PASS' : 'FAIL';
    console.log(`    [${mark}] ${label}${cond ? '' : `\n           ${String(detail).slice(0, 500)}`}`);
    return !!cond;
  }
  get failed() { return this.checks.filter((c) => !c.pass); }
}

export const uid = () => randomUUID();
export const short = (s) => (s ? String(s).slice(0, 8) : 'null');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn() is truthy or timeout — provider eventual-consistency helper. */
/** Failure-detail digest for BOARD.md checks: the summary rows + section
 *  status lines — the bytes that decide derived-status assertions — instead
 *  of the file head (which is all header boilerplate). */
export function boardDigest(content) {
  if (!content) return '(absent)';
  const lines = content.split('\n');
  const rows = lines.filter((l) => l.startsWith('| ['));
  const sections = lines.filter((l) => l.startsWith('## ') || l.startsWith('status: ') || l.startsWith('  ↳'));
  return ['ROWS:', ...rows, 'SECTIONS:', ...sections].join('\n').slice(0, 1200);
}

export async function until(fn, { timeoutMs = 15000, everyMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(everyMs);
  }
}

/**
 * Re-run a drift sweep until pred(result) holds, returning the LAST result
 * either way (so a failing check still shows the real final state). The
 * provider can serve a stale head for a few seconds after an out-of-band
 * commit; a stale sweep reads `clean` — head==baseline, git-drift.ts:636,
 * which advances NOTHING — so retrying is lossless. The post-merge live run
 * proved it: the sweep reported clean on a spec edit that restore-spec then
 * read and applied perfectly well seconds later.
 */
export async function sweepUntil(sweepFn, pred, { timeoutMs = 30000, everyMs = 3000 } = {}) {
  let last = null;
  const hit = await until(async () => {
    last = await sweepFn();
    return pred(last) ? last : null;
  }, { timeoutMs, everyMs });
  return hit ?? last;
}

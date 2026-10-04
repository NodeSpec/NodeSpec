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

// ── time limits (UAT hardening, owner 2026-09-27) ────────────────────────────
// Every request the bench makes has a ceiling, so one stalled call can never
// hang a run: BENCH_REQUEST_TIMEOUT_MS (default 60 s), read when the call is
// made so a value in .env.bench counts.
export function requestTimeoutMs() {
  const n = Number(process.env.BENCH_REQUEST_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 60000;
}

/** fetch with the bench's ceiling; a stall names the call it stalled on. */
export async function timedFetch(url, init = {}, ms = requestTimeoutMs()) {
  try {
    return await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(ms) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`no answer within ${Math.round(ms / 1000)} s: ${init.method ?? 'GET'} ${String(url).split('?')[0]}`);
    }
    throw err;
  }
}

/** A .env.bench value: surrounding quotes removed, a trailing " # comment" dropped. */
export function envValue(raw) {
  const v = String(raw ?? '').trim();
  const quoted = /^(["'])(.*)\1$/.exec(v);
  if (quoted) return quoted[2];
  return v.replace(/\s+#.*$/, '').trim();
}

// ── env ───────────────────────────────────────────────────────────────────────

export function loadEnv({ dryRun = false } = {}) {
  const envPath = join(HERE, '.env.bench');
  const fromFile = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m && !line.trim().startsWith('#')) fromFile[m[1]] = envValue(m[2]);
    }
    // A scenario's own settings (BENCH_LIVE_REPO, BENCH_DRIVE, the time
    // limits...) are read from process.env; a value in .env.bench counts too.
    for (const [k, v] of Object.entries(fromFile)) {
      if (process.env[k] === undefined && v !== '') process.env[k] = v;
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
    // GL-1: the LIVE import scenario can point at a GitLab project instead
    // (BENCH_LIVE_PROVIDER=gitlab + GITLAB_TOKEN; BENCH_LIVE_BASE_URL for a
    // self-managed instance, e.g. https://gitlab.example.com/api/v4). The
    // sandbox repo above stays GitHub — only the live import is provider-aware.
    BENCH_LIVE_PROVIDER: get('BENCH_LIVE_PROVIDER', 'github'),
    GITLAB_TOKEN: get('GITLAB_TOKEN', null),
    BENCH_LIVE_BASE_URL: get('BENCH_LIVE_BASE_URL', null),
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
  if (!['github', 'gitlab'].includes(env.BENCH_LIVE_PROVIDER)) {
    throw new Error(`BENCH_LIVE_PROVIDER must be "github" or "gitlab", got "${env.BENCH_LIVE_PROVIDER}"`);
  }
  if (env.BENCH_LIVE_PROVIDER === 'gitlab' && !env.GITLAB_TOKEN) {
    throw new Error('BENCH_LIVE_PROVIDER=gitlab needs GITLAB_TOKEN (a personal access token with read_api + read_repository).');
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
  const resp = await timedFetch(`${env.SUPABASE_URL}/rest/v1/projects?select=id&limit=1`, {
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
  const resp = await timedFetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
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
  const resp = await timedFetch(`${env.SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      apikey: env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: resp.status, data: await readBody(resp) };
}

/** A response body as JSON; a non-JSON body (a gateway 502 page, a worker
 *  killed mid-call) keeps its status and first bytes instead of reading {}. */
async function readBody(resp) {
  const text = await resp.text().catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { nonJson: true, status: resp.status, body: text.slice(0, 300) }; }
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
      const resp = await timedFetch(`${base}/${table}?${query}`, { headers });
      if (!resp.ok) throw new Error(`SELECT ${table}?${query} → ${resp.status}: ${await resp.text()}`);
      return resp.json();
    },
    async insert(table, rows) {
      const resp = await timedFetch(`${base}/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(rows),
      });
      if (!resp.ok) throw new Error(`INSERT ${table} → ${resp.status}: ${await resp.text()}`);
      return resp.json();
    },
    async update(table, query, patch) {
      const resp = await timedFetch(`${base}/${table}?${query}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) throw new Error(`UPDATE ${table}?${query} → ${resp.status}: ${await resp.text()}`);
      return resp.json();
    },
    async delete(table, query) {
      const resp = await timedFetch(`${base}/${table}?${query}`, { method: 'DELETE', headers });
      if (!resp.ok) throw new Error(`DELETE ${table}?${query} → ${resp.status}: ${await resp.text()}`);
    },
    /** Exact row count for a filter WITHOUT paging rows through the 1000-row
     *  cap (HEAD + Prefer: count=exact → Content-Range "0-0/N"). */
    async count(table, query = '') {
      const resp = await timedFetch(`${base}/${table}?select=*${query ? `&${query}` : ''}`, {
        method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' },
      });
      if (!resp.ok) throw new Error(`COUNT ${table}?${query} → ${resp.status}: ${await resp.text()}`);
      const range = resp.headers.get('content-range') ?? '';
      const total = parseInt(range.split('/')[1] ?? '', 10);
      return Number.isFinite(total) ? total : 0;
    },
    /** POST /rest/v1/rpc/<fn> with the service key. */
    async rpc(fn, args = {}) {
      const resp = await timedFetch(`${base}/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
      const text = await resp.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (!resp.ok) throw new Error(`RPC ${fn} → ${resp.status}: ${text.slice(0, 300)}`);
      return data;
    },
  };
}

/**
 * PostgREST AS THE SIGNED-IN PERSON: the app's own door, under the RLS
 * policies. Never throws on a refusal; the status and body ARE the result,
 * because a refused write is exactly what a seat check asserts. `rest()`
 * above is the service key (fixtures and assertions, RLS bypassed); this is
 * what the browser does.
 */
export function restAs(env, session) {
  const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' };
  const base = `${env.SUPABASE_URL}/rest/v1`;
  const send = async (method, url, body, prefer) => {
    const resp = await timedFetch(url, {
      method,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await resp.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
    return { status: resp.status, ok: resp.ok, data: resp.ok ? data : null, error: resp.ok ? null : data };
  };
  return {
    select: (table, query) => send('GET', `${base}/${table}?${query}`),
    insert: (table, rows) => send('POST', `${base}/${table}`, rows, 'return=representation'),
    update: (table, query, patch) => send('PATCH', `${base}/${table}?${query}`, patch, 'return=representation'),
    delete: (table, query) => send('DELETE', `${base}/${table}?${query}`, undefined, 'return=representation'),
    rpc: (fn, args = {}) => send('POST', `${base}/rpc/${fn}`, args),
  };
}

/** The MCP door's headers for one credential: an API key (`{ apiKey }`,
 *  the X-MCP-API-Key lane) or a bearer (`{ accessToken }`: a signed-in
 *  session's JWT, the way the Connected tab calls, or an OAuth nst_ token). */
function mcpHeaders(env, credential) {
  const headers = { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (credential?.accessToken) headers.Authorization = `Bearer ${credential.accessToken}`;
  else headers['X-MCP-API-Key'] = credential?.apiKey ?? env.MCP_API_KEY;
  return headers;
}

/** Any JSON-RPC method at the MCP door (initialize, ping, tools/list,
 *  tools/call) as ONE credential. V3 I: two agents on the bench are two
 *  credentials, so the helpers take the credential rather than assuming
 *  the seeded key. */
export async function mcpRpc(env, credential, method, params, { noRetry = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    const resp = await timedFetch(`${env.SUPABASE_URL}/functions/v1/mcp-server`, {
      method: 'POST',
      headers: mcpHeaders(env, credential),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) }),
    });
    // A non-JSON body (gateway 502/504 HTML, an edge-runtime worker killed
    // mid-call) used to collapse into `{}` and a check that printed nothing
    // (bench 2026-09-06: the approve step "failed" with `{}`). Keep the status
    // and the first bytes so the failure names itself.
    const data = await readBody(resp);
    // AE.5: the MCP door has a rate limit, and every call with one credential
    // shares its bucket. A refused call ran nothing (the limit is checked
    // before dispatch), so it is waited out once and sent again, loudly; the
    // rate-limit scenario asks for the raw 429 (noRetry).
    if (resp.status === 429 && !noRetry && attempt === 0) {
      const wait = Math.min(15, Math.max(1, Number(resp.headers.get('retry-after')) || 2));
      console.log(`    [rate limited] ${method}${params?.name ? ` ${params.name}` : ''}: waiting ${wait} s, then once more`);
      await sleep(wait * 1000);
      continue;
    }
    return { status: resp.status, data, headers: resp.headers };
  }
}

/**
 * A tools/call answer, read strictly (UAT hardening 2026-09-27). The tool's
 * text, parsed when it is JSON. When there is no tool text the call never
 * reached a tool: a 401, a 429, a 5xx or a gateway page. That answer says
 * isError and transport, and the running scenario records it, so a check
 * written as "not an error" can never pass on a call that failed below the
 * tool.
 */
export function parseMcp(r) {
  const status = r?.status;
  const text = r?.data?.result?.content?.[0]?.text;
  if (typeof text !== 'string') {
    const below = status !== 200 || !!r?.data?.nonJson;
    const raw = r?.data?.nonJson
      ? `HTTP ${status}, non-JSON body: ${r.data.body}`
      : `HTTP ${status}: ${JSON.stringify(r?.data ?? null).slice(0, 300)}`;
    if (below) Scenario.current?.noteTransport(raw);
    return { raw, isError: true, status, ...(below ? { transport: true } : {}), ...(r?.data?.error ? { rpcError: r.data.error } : {}) };
  }
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError === true, status }; }
}

/** MCP tools/call as one credential (see mcpRpc). */
export function mcpCallAs(env, credential, toolName, args) {
  return mcpRpc(env, credential, 'tools/call', { name: toolName, arguments: args });
}

/** MCP tools/call over HTTP with the seeded API key. */
export function mcpCall(env, toolName, args) {
  return mcpCallAs(env, { apiKey: env.MCP_API_KEY }, toolName, args);
}

// ── A second person ───────────────────────────────────────────────────────────

/** A confirmed account made through the admin API; returns its id. */
export async function adminCreateUser(env, email, password) {
  const resp = await timedFetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.id) throw new Error(`admin create user ${email} → ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.id;
}

export async function adminDeleteUser(env, id) {
  await timedFetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  }).catch(() => {});
}

/** A password sign-in; the access token works as an MCP credential. */
export async function signInAs(env, email, password) {
  const resp = await timedFetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) throw new Error(`sign-in as ${email} → ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return { accessToken: data.access_token, userId: data.user?.id };
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
  const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR|socket|no answer within/i;
  const call = async (method, url, body) => {
    for (let attempt = 0; ; attempt++) {
      let resp; let text;
      try {
        resp = await timedFetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
        text = await resp.text();
      } catch (err) {
        const detail = `${err?.message ?? err} ${err?.cause?.code ?? err?.cause?.message ?? ''}`;
        if (attempt >= 3 || !TRANSIENT.test(detail)) throw err;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      // GitHub's rate limits (primary and the content-creation secondary one)
      // answer 403 or 429; a UAT rerun inside the hour can meet them. Wait
      // what GitHub asks, up to 90 s, twice at most; longer is reported.
      if ((resp.status === 403 || resp.status === 429) && attempt < 2) {
        const retryAfter = Number(resp.headers.get('retry-after'));
        const remaining = resp.headers.get('x-ratelimit-remaining');
        const reset = Number(resp.headers.get('x-ratelimit-reset'));
        if ((Number.isFinite(retryAfter) && retryAfter > 0) || remaining === '0' || /rate limit/i.test(text)) {
          const wait = retryAfter > 0 ? retryAfter : remaining === '0' && reset > 0 ? Math.max(1, reset - Math.floor(Date.now() / 1000)) : 30;
          if (wait <= 90) {
            console.log(`    [github] rate limited: waiting ${wait} s`);
            await sleep(wait * 1000);
            continue;
          }
        }
      }
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      return { status: resp.status, data };
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
    /**
     * How `head` stands against `base` by commit history ('ahead', 'behind',
     * 'identical', 'diverged'), or null when either is unknown. A ref read
     * right after a push can be served stale; the history comparison cannot
     * say a commit is off a branch it landed on.
     */
    async compareStatus(base, head) {
      const r = await call('GET', `${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
      return r.status === 200 ? r.data.status ?? null : null;
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
      const refs = await call('GET', `${repo}/git/refs/heads?per_page=100`);
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
  // AD.0: the handler refuses a delivery for a repository other than the
  // integration's; GitHub names it on every push, so the bench does too.
  const body = JSON.stringify(payload.repository ? payload : { ...payload, repository: { full_name: `${env.repoOwner}/${env.repoName}` } });
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  const resp = await timedFetch(`${env.SUPABASE_URL}/functions/v1/git-webhook?integration_id=${integrationId}`, {
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
  return { status: resp.status, data: await readBody(resp) };
}

// ── assertions + reporting ────────────────────────────────────────────────────

export class Scenario {
  /** The scenario being run: the harness keeps its checks when it throws, and
   *  parseMcp records a call that failed below the tool on it. */
  static current = null;

  constructor(name, boxes) {
    this.name = name;
    this.boxes = boxes; // checklist box refs this scenario covers
    this.checks = [];
    this.skips = [];
    this.transport = [];
    Scenario.current = this;
  }
  check(label, cond, detail) {
    const shown = detail === undefined ? '(no detail recorded)' : String(detail);
    this.checks.push({ label, pass: !!cond, detail: cond ? undefined : shown });
    const mark = cond ? 'PASS' : 'FAIL';
    console.log(`    [${mark}] ${label}${cond ? '' : `\n           ${shown.slice(0, 2000)}`}`);
    return !!cond;
  }
  /** A check this stack cannot run (the account's plan, a missing provider):
   *  reported as SKIP with its reason, never counted as a pass. */
  skip(label, reason) {
    this.skips.push({ label, reason });
    console.log(`    [SKIP] ${label}\n           ${reason}`);
  }
  /** A failure of the stack or the harness, not the product: a call that
   *  never answered, a set-up that failed. A scenario whose only failures are
   *  these ends ERROR, never FAIL (harness.mjs statusOf). */
  stackFailure(label, detail) {
    const shown = detail === undefined ? '(no detail recorded)' : String(detail);
    this.checks.push({ label, pass: false, detail: shown, stack: true });
    console.log(`    [ERROR] ${label}\n           ${shown.slice(0, 2000)}`);
    return false;
  }
  /** An MCP call that never reached its tool (see parseMcp). */
  noteTransport(raw) {
    this.transport.push(raw);
    console.log(`    [MCP ] a call failed below the tool: ${String(raw).slice(0, 300)}`);
  }
  get failed() { return this.checks.filter((c) => !c.pass); }
}

/** A thrown error that says the stack did not answer (a request past its
 *  time limit, a refused or reset connection), as opposed to a product error. */
export const isStackError = (err) =>
  /no answer within|fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|UND_ERR/i
    .test(`${err?.message ?? err} ${err?.cause?.code ?? ''} ${err?.cause?.message ?? ''}`);

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

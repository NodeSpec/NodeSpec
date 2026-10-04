// P0-9: git-webhook suites against the REAL handlers (git-webhook/handlers.ts) under the
// P0-8 harness. Signatures are computed with real HMAC-SHA256 in the tests — no stubs.
import {
  matchFilesToArtifacts,
  processWebhook,
  verifyGitHubSignatureHmac,
} from '../git-webhook/handlers.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const SECRET = 'whsec_test_secret';
// R3-3d: `default_branch` is NOT NULL DEFAULT 'main' in the schema and the handler
// selects it — the fixture omitted it, which only worked while the handler guessed
// `?? "main"`. That guess is gone (it mismapped master-default repos), so the
// fixture now carries the column a real row always has.
// AD.0: a delivery must name the integration's repository, so the fixture
// carries the two columns a real row always has and the payloads name them.
const INTEGRATION = { id: 'int-1', project_id: 'proj-1', provider: 'github', webhook_secret: SECRET, default_branch: 'main', repo_owner: 'acme', repo_name: 'store' };

async function realSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return 'sha256=' + Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function pushPayload(message: string, files: string[] = ['src/index.ts']) {
  return JSON.stringify({
    ref: 'refs/heads/main',
    after: 'abc123',
    head_commit: { id: 'abc123', message, author: { username: 'dev' }, modified: files },
    repository: { full_name: 'acme/store' },
  });
}

function webhookRequest(body: string, headers: Record<string, string>) {
  return new Request('https://x.test/git-webhook?integration_id=int-1', {
    method: 'POST',
    headers,
    body,
  });
}

function dbWithIntegration(integration: Record<string, unknown> = INTEGRATION) {
  const db = new FakeSupabase();
  db.script('git_integrations', 'select', { data: integration });
  // R3-4a: the ref→branch mapping (list).
  db.script('branches', 'select', { data: [{ name: 'main', git_ref: null }] });
  return db;
}

// AD.1: a delivery wakes the sync check; tests see what it was asked.
function fakeSweep() {
  const calls: Array<{ projectId: string; opts: unknown }> = [];
  const runDriftSweep = ((_sb: unknown, projectId: string, opts?: unknown) => {
    calls.push({ projectId, opts });
    return Promise.resolve({ status: 'drift', eventId: 'card-1' });
  }) as never;
  return { calls, deps: { runDriftSweep } };
}

// ── HMAC verifier ───────────────────────────────────────────────────────────────────

Deno.test('HMAC: a genuine signature verifies; tampered payload or signature fails', async () => {
  const payload = pushPayload('normal commit');
  const sig = await realSignature(payload, SECRET);

  assertEquals(await verifyGitHubSignatureHmac(payload, sig, SECRET), true);
  assertEquals(await verifyGitHubSignatureHmac(payload + 'x', sig, SECRET), false);
  assertEquals(await verifyGitHubSignatureHmac(payload, sig.slice(0, -2) + '00', SECRET), false);
  assertEquals(await verifyGitHubSignatureHmac(payload, sig, 'wrong-secret'), false);
  assertEquals(await verifyGitHubSignatureHmac(payload, 'sha1=abcdef', SECRET), false);
});

// ── full request flow ───────────────────────────────────────────────────────────────

Deno.test('bad signature: rejected 401 BEFORE any DB write', async () => {
  const db = dbWithIntegration();
  const body = pushPayload('normal commit');
  const res = await processWebhook(db, webhookRequest(body, {
    'X-GitHub-Event': 'push',
    'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64),
  }));

  assertEquals(res.status, 401);
  assertEquals(db.callsTo('git_change_events', 'insert').length, 0);
  assertEquals(db.calls.filter((c) => c.op !== 'select').length, 0, 'zero writes of any kind');
});

Deno.test('AD.1: a verified push runs the sync check for the mapped branch, forced, and writes no card itself', async () => {
  const db = dbWithIntegration();
  const sweep = fakeSweep();
  const body = pushPayload('feat: real work', ['src/index.ts', 'README.md']);
  const res = await processWebhook(db, webhookRequest(body, {
    'X-GitHub-Event': 'push',
    'X-Hub-Signature-256': await realSignature(body, SECRET),
  }), sweep.deps);

  assertEquals(res.status, 200);
  assertEquals(sweep.calls, [{ projectId: 'proj-1', opts: { branchName: 'main', force: true } }]);
  const json = await res.json();
  assertEquals(json.sweep, { status: 'drift', eventId: 'card-1' });
  assertEquals(db.calls.filter((c) => c.op !== 'select').length, 0, 'the sync check is the only writer');
});

// AD.1 (D12): the old self-push skip trusted the head commit's message, which
// hid any commits under it and let anyone's commit pass as NodeSpec's. The
// sync check now tells NodeSpec's writing apart by recorded sha and blob.
Deno.test('AD.1 (D12): a head commit that says "Update from NodeSpec" is not trusted; the sync check still runs', async () => {
  for (const message of ['Update from NodeSpec: 3 files from main', 'Update from Nodal: 3 files from main']) {
    const db = dbWithIntegration();
    const sweep = fakeSweep();
    const body = pushPayload(message);
    const res = await processWebhook(db, webhookRequest(body, {
      'X-GitHub-Event': 'push',
      'X-Hub-Signature-256': await realSignature(body, SECRET),
    }), sweep.deps);
    assertEquals(res.status, 200);
    assertEquals(sweep.calls.length, 1, message);
  }
});

Deno.test('AD.1: a push to a ref no NodeSpec branch is bound to is ignored, nothing run or written', async () => {
  const db = dbWithIntegration();
  const sweep = fakeSweep();
  const body = JSON.stringify({ ...JSON.parse(pushPayload('topic work')), ref: 'refs/heads/topic' });
  const res = await processWebhook(db, webhookRequest(body, {
    'X-GitHub-Event': 'push',
    'X-Hub-Signature-256': await realSignature(body, SECRET),
  }), sweep.deps);
  assertEquals(res.status, 200);
  assert(/not bound to a NodeSpec branch/.test((await res.json()).message));
  assertEquals(sweep.calls.length, 0);
  assertEquals(db.calls.filter((c) => c.op !== 'select').length, 0);
});

Deno.test('ping event acknowledges without writing', async () => {
  const db = dbWithIntegration();
  // AD.0: GitHub signs its ping once a secret is set, and an unsigned one is refused.
  const res = await processWebhook(db, webhookRequest('{}', {
    'X-GitHub-Event': 'ping', 'X-Hub-Signature-256': await realSignature('{}', SECRET),
  }));
  assertEquals(res.status, 200);
  assertEquals(db.callsTo('git_change_events', 'insert').length, 0);
});

// ── AD.0 (S2): every delivery proves it knows the secret ────────────────────────────

Deno.test('AD.0: an integration with no secret on file refuses every delivery, nothing written', async () => {
  const db = new FakeSupabase();
  db.script('git_integrations', 'select', { data: { ...INTEGRATION, webhook_secret: null } });
  const body = pushPayload('feat: forged');
  const res = await processWebhook(db, webhookRequest(body, {
    'X-GitHub-Event': 'push', 'X-Hub-Signature-256': await realSignature(body, 'anything'),
  }));
  assertEquals(res.status, 401);
  assert(/Save the integration in NodeSpec/.test((await res.json()).error), 'says how to get a secret');
  assertEquals(db.calls.filter((c) => c.op !== 'select').length, 0);
});

Deno.test('AD.0: a delivery with no signature is refused, nothing written', async () => {
  const db = dbWithIntegration();
  const res = await processWebhook(db, webhookRequest(pushPayload('feat: unsigned'), { 'X-GitHub-Event': 'push' }));
  assertEquals(res.status, 401);
  assertEquals(db.calls.filter((c) => c.op !== 'select').length, 0);
});

Deno.test('AD.0: a signed delivery for another repository is refused, nothing written', async () => {
  const db = dbWithIntegration();
  const body = JSON.stringify({ ...JSON.parse(pushPayload('feat: elsewhere')), repository: { full_name: 'acme/other' } });
  const res = await processWebhook(db, webhookRequest(body, {
    'X-GitHub-Event': 'push', 'X-Hub-Signature-256': await realSignature(body, SECRET),
  }));
  assertEquals(res.status, 401);
  assertEquals(db.callsTo('git_change_events', 'insert').length, 0);
});

Deno.test('AD.0: gitlab without a token is refused', async () => {
  const db = new FakeSupabase();
  db.script('git_integrations', 'select', { data: { ...INTEGRATION, provider: 'gitlab' } });
  const res = await processWebhook(db, webhookRequest('{}', { 'X-Gitlab-Event': 'Push Hook' }));
  assertEquals(res.status, 401);
  assertEquals(db.calls.filter((c) => c.op !== 'select').length, 0);
});

Deno.test('gitlab: token mismatch rejected, matching token accepted', async () => {
  const gitlabIntegration = { ...INTEGRATION, provider: 'gitlab' };
  const body = JSON.stringify({
    ref: 'refs/heads/main', after: 'sha9',
    commits: [{ id: 'sha9', message: 'work', author: { name: 'dev' }, modified: ['a.ts'] }],
    project: { path_with_namespace: 'acme/store' },
  });

  const dbBad = new FakeSupabase();
  dbBad.script('git_integrations', 'select', { data: gitlabIntegration });
  const bad = await processWebhook(dbBad, webhookRequest(body, {
    'X-Gitlab-Event': 'Push Hook', 'X-Gitlab-Token': 'wrong',
  }));
  assertEquals(bad.status, 401);
  assertEquals(dbBad.callsTo('git_change_events', 'insert').length, 0);

  const dbGood = dbWithIntegration(gitlabIntegration);
  const sweep = fakeSweep();
  const good = await processWebhook(dbGood, webhookRequest(body, {
    'X-Gitlab-Event': 'Push Hook', 'X-Gitlab-Token': SECRET,
  }), sweep.deps);
  assertEquals(good.status, 200);
  assertEquals(sweep.calls.length, 1, 'a verified GitLab push runs the sync check');
});

Deno.test('unknown integration id -> 404, nothing written', async () => {
  const db = new FakeSupabase();
  db.script('git_integrations', 'select', { data: null });
  const res = await processWebhook(db, webhookRequest('{}', { 'X-GitHub-Event': 'push' }));
  assertEquals(res.status, 404);
  assertEquals(db.calls.filter((c) => c.op !== 'select').length, 0);
});

// ── file -> artifact matching ───────────────────────────────────────────────────────

const GRAPH = {
  nodes: { n1: { id: 'n1', label: 'API Service' }, n2: { id: 'n2', label: 'Worker' } },
  artifacts: {
    a1: { id: 'a1', nodeId: 'n1', path: '/src/api.ts' },     // leading slash normalized
    a2: { id: 'a2', nodeId: 'n2', path: 'src/worker.ts' },
    a3: { id: 'a3', nodeId: 'n2', path: 'src/api.ts' },      // second artifact, same path
    a4: { id: 'a4', nodeId: 'n1', path: '' },                // pathless: never matches
  },
};

function matchDb() {
  const db = new FakeSupabase();
  db.script('branches', 'select', { data: { id: 'b1' } });
  db.script('graph_snapshots', 'select', { data: { graph_data: GRAPH } });
  return db;
}

Deno.test('matching: exact hit, multi-artifact same path, miss, slash normalization', async () => {
  const result = await matchFilesToArtifacts(matchDb(), 'proj-1', [
    { path: 'src/api.ts', action: 'modified' },
    { path: 'docs/readme.md', action: 'modified' }, // miss
  ]);

  assertEquals(result.error, undefined);
  assertEquals(result.matches.length, 2, 'both artifacts sharing the path match');
  const ids = result.matches.map((m) => m.artifactId).sort();
  assertEquals(ids, ['a1', 'a3']);
  assertEquals(result.matches.find((m) => m.artifactId === 'a1')!.nodeName, 'API Service');
});

Deno.test('matching: no main branch or no snapshot -> empty result, no error', async () => {
  const noBranch = new FakeSupabase();
  noBranch.script('branches', 'select', { data: null });
  assertEquals((await matchFilesToArtifacts(noBranch, 'p', [{ path: 'x', action: 'added' }])).matches, []);

  const noSnap = new FakeSupabase();
  noSnap.script('branches', 'select', { data: { id: 'b1' } });
  noSnap.script('graph_snapshots', 'select', { data: null });
  assertEquals((await matchFilesToArtifacts(noSnap, 'p', [{ path: 'x', action: 'added' }])).matches, []);
});

// ── AD.1: the webhook is a wake-up, never a second card producer ──────────────
// A3 had the webhook compute ticks, bindings and board deltas itself, a second
// producer beside the sync check. Both now come from the one sync check, whose
// own tests pin them (git-drift-sweep, board-generator, binding-manifest).

const handlerSource = Deno.readTextFileSync(new URL('../git-webhook/handlers.ts', import.meta.url));

Deno.test('AD.1 (D13, D20): the webhook writes no card and loads no model; it runs the sync check', () => {
  assert(!handlerSource.includes('from("git_change_events")'), 'no card written by the webhook');
  assert(!handlerSource.includes('restoreBranchModelFromRef'), 'no model loaded by the webhook');
  assert(!handlerSource.includes('isSelfPushMessage'), 'no trust in a commit message');
  assert(handlerSource.includes('await deps.runDriftSweep(supabase, integration.project_id, { branchName: mappedBranchName, force: true })'));
});

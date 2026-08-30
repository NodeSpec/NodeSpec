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
const INTEGRATION = { id: 'int-1', project_id: 'proj-1', provider: 'github', webhook_secret: SECRET, default_branch: 'main' };

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
  });
}

function webhookRequest(body: string, headers: Record<string, string>) {
  return new Request('https://x.test/git-webhook?integration_id=int-1', {
    method: 'POST',
    headers,
    body,
  });
}

function dbWithIntegration(graphData: unknown = null) {
  const db = new FakeSupabase();
  db.script('git_integrations', 'select', { data: INTEGRATION });
  // R3-4a: the handler's first branches query is the ref→branch mapping (list);
  // the second is the matcher's single-row lookup for the mapped branch.
  db.script('branches', 'select', { data: [{ name: 'main', git_ref: null }] });
  db.script('branches', 'select', { data: { id: 'branch-main' } });
  db.script('graph_snapshots', 'select', { data: graphData ? { graph_data: graphData } : null });
  return db;
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

Deno.test('valid push: creates a pending git_change_events row with matches in metadata', async () => {
  const db = dbWithIntegration({
    nodes: { n1: { id: 'n1', label: 'API Service' } },
    artifacts: { a1: { id: 'a1', nodeId: 'n1', path: '/src/index.ts' } },
  });
  const body = pushPayload('feat: real work', ['src/index.ts', 'README.md']);
  const res = await processWebhook(db, webhookRequest(body, {
    'X-GitHub-Event': 'push',
    'X-Hub-Signature-256': await realSignature(body, SECRET),
  }));

  assertEquals(res.status, 200);
  const inserts = db.callsTo('git_change_events', 'insert');
  assertEquals(inserts.length, 1);
  const row = inserts[0].payload as Record<string, unknown>;
  assertEquals(row.status, 'pending');
  assertEquals(row.commit_sha, 'abc123');
  assertEquals(row.project_id, 'proj-1');
  const meta = row.metadata as Record<string, unknown>;
  assertEquals(meta.fileCount, 2);
  assertEquals((meta.artifactMatches as unknown[]).length, 1);
  // R3-4a webhook parity: the same classification signals sweep cards carry.
  assertEquals(meta.modelChanged, false);
  assertEquals(meta.residuePaths, ['README.md'], 'unmatched file reads as residue');
  assertEquals(meta.branchName, 'main', 'pushed default-branch ref maps to the main NodeSpec branch');
});

Deno.test('self-push ("Update from NodeSpec:") is skipped with 200 and no row', async () => {
  const db = dbWithIntegration();
  const body = pushPayload('Update from NodeSpec: 3 files from main');
  const res = await processWebhook(db, webhookRequest(body, {
    'X-GitHub-Event': 'push',
    'X-Hub-Signature-256': await realSignature(body, SECRET),
  }));

  assertEquals(res.status, 200);
  assertEquals((await res.json()).message, 'Self-push ignored');
  assertEquals(db.callsTo('git_change_events', 'insert').length, 0);
});

// Rebrand 2026-07-30 compat pin: existing repos carry history under the OLD app
// name — the legacy prefix must stay recognized FOREVER or old self-pushes would
// start raising false drift cards.
Deno.test('LEGACY self-push ("Update from Nodal:") is still skipped', async () => {
  const db = dbWithIntegration();
  const body = pushPayload('Update from Nodal: 3 files from main');
  const res = await processWebhook(db, webhookRequest(body, {
    'X-GitHub-Event': 'push',
    'X-Hub-Signature-256': await realSignature(body, SECRET),
  }));

  assertEquals(res.status, 200);
  assertEquals((await res.json()).message, 'Self-push ignored');
  assertEquals(db.callsTo('git_change_events', 'insert').length, 0);
});

Deno.test('ping event acknowledges without writing', async () => {
  const db = dbWithIntegration();
  const res = await processWebhook(db, webhookRequest('{}', { 'X-GitHub-Event': 'ping' }));
  assertEquals(res.status, 200);
  assertEquals(db.callsTo('git_change_events', 'insert').length, 0);
});

Deno.test('gitlab: token mismatch rejected, matching token accepted', async () => {
  const gitlabIntegration = { ...INTEGRATION, provider: 'gitlab' };
  const body = JSON.stringify({
    ref: 'refs/heads/main', after: 'sha9',
    commits: [{ id: 'sha9', message: 'work', author: { name: 'dev' }, modified: ['a.ts'] }],
  });

  const dbBad = new FakeSupabase();
  dbBad.script('git_integrations', 'select', { data: gitlabIntegration });
  const bad = await processWebhook(dbBad, webhookRequest(body, {
    'X-Gitlab-Event': 'Push Hook', 'X-Gitlab-Token': 'wrong',
  }));
  assertEquals(bad.status, 401);
  assertEquals(dbBad.callsTo('git_change_events', 'insert').length, 0);

  const dbGood = new FakeSupabase();
  dbGood.script('git_integrations', 'select', { data: gitlabIntegration });
  dbGood.script('branches', 'select', { data: null });
  const good = await processWebhook(dbGood, webhookRequest(body, {
    'X-Gitlab-Event': 'Push Hook', 'X-Gitlab-Token': SECRET,
  }));
  assertEquals(good.status, 200);
  assertEquals(dbGood.callsTo('git_change_events', 'insert').length, 1);
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

// ── A3: webhook-time criterion deltas (docs/WORK_LOOP_PLAN.md) ────────────────
// Before A3 only the 60s drift sweep computed deltas — a tick arriving by
// webhook waited for a later sweep. These pins hold the webhook to the sweep's
// exact semantics: task-kind matches only, best-effort (a delta failure never
// drops the card), and the same metadata shape either producer writes.

const handlerSource = Deno.readTextFileSync(new URL('../git-webhook/handlers.ts', import.meta.url));
const driftSource = Deno.readTextFileSync(new URL('../_shared/git-drift.ts', import.meta.url));

Deno.test('A3: webhook selects the columns delta computation needs', () => {
  assert(handlerSource.includes('access_token_encrypted'), 'token column not selected');
  assert(handlerSource.includes('repo_owner, repo_name, base_url'), 'repo columns not selected');
});

Deno.test('A3: only TASK-kind matches are read, mirroring the R5b sweep rule', () => {
  assert(handlerSource.includes('.filter((m) => m.kind === "task")'),
    'a ticked box in ordinary source is prose, not evidence');
});

Deno.test('A3: delta computation is best-effort — a failure never drops the card', () => {
  assert(/try\s*\{[\s\S]{0,400}computeWebhookCriterionDeltas[\s\S]{0,600}card still lands/.test(handlerSource),
    'the delta block must be guarded so the change event always inserts');
});

Deno.test('A3: webhook cards carry criterionDeltas in the same shape as sweep cards', () => {
  const spread = 'criterionDeltas.deltas.length > 0 || criterionDeltas.flagged.length > 0';
  assert(handlerSource.includes(spread), 'webhook metadata spread missing');
  assert(driftSource.includes(spread), 'sweep metadata spread missing');
});

Deno.test('A3: the wrapper reuses the sweep computation (no second matcher)', () => {
  assert(/computeWebhookCriterionDeltas[\s\S]{0,900}computeSweepCriterionDeltas\(/.test(driftSource),
    'webhook deltas must delegate to the sweep path, not fork it');
  assert(/computeWebhookCriterionDeltas[\s\S]{0,600}isEncrypted\(token\)/.test(driftSource),
    'the wrapper owns token decryption');
});

Deno.test('A3: a push with NO task-doc matches still creates a plain pending card', async () => {
  // Regression guard for the wiring itself: source-kind match only — the delta
  // block must not run (no network, no token needed) and the card must land
  // without a criterionDeltas key.
  const db = dbWithIntegration({
    nodes: { n1: { id: 'n1', label: 'API Service' } },
    artifacts: { a1: { id: 'a1', nodeId: 'n1', path: '/src/index.ts' } },
  });
  const body = pushPayload('external edit', ['src/index.ts']);
  const res = await processWebhook(db, webhookRequest(body, {
    'X-GitHub-Event': 'push',
    'X-Hub-Signature-256': await realSignature(body, SECRET),
  }));
  assertEquals(res.status, 200);
  const inserts = db.callsTo('git_change_events', 'insert');
  assertEquals(inserts.length, 1, 'pending card must insert');
  const metadata = (inserts[0].payload as { metadata: Record<string, unknown> }).metadata;
  assert(!('criterionDeltas' in metadata), 'no task docs -> no deltas key');
});

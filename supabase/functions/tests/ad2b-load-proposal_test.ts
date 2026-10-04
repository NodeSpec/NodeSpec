// V3 AD.2b (owner 2026-09-24, findings D3 and D4): a load is a diff filed as a
// proposal, and nothing loads silently. The filer runs on a MemorySupabase
// that applies every filter, with the provider stubbed at fetch; the diff's
// rules are pure. The round trip through the real patch engine is in
// src/tests/ad2b-load-roundtrip.test.ts.
import { anchorLoadPatches, GIT_CONTENT_SENTINEL } from '../_shared/anchor-load.ts';
import { fileModelLoadProposal } from '../_shared/git-drift.ts';
import { serializeModel, parseModel, type ModelAnchor } from '../_shared/model-anchor.ts';
import { WITHHELD } from '../_shared/credential-withhold.ts';
import { GIT_CONTENT_SENTINEL as MCP_SENTINEL } from '../mcp-server/tools/proposals.ts';
import { MemorySupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const INTEGRATION = '33333333-3333-4333-8333-333333333333';
const BASE = 'a'.repeat(40);
const HEAD = 'c'.repeat(40);
const NEWER = 'd'.repeat(40);

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const K = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const K2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const E1 = '12121212-1212-4212-8212-121212121212';
const E2 = '13131313-1313-4313-8313-131313131313';
const F1 = '14141414-1414-4414-8414-141414141414';
const F2 = '15151515-1515-4515-8515-151515151515';

// deno-lint-ignore no-explicit-any
type G = any;
const NOW = '2026-09-24T12:00:00.000Z';

function canvas(): G {
  return {
    nodes: {
      [A]: { id: A, type: 'backend-service', label: 'Orders API', technology: 'node', ports: [{ id: P, name: 'out', direction: 'out', required: true }],
        metadata: { position: { x: 10, y: 20 }, config: { region: 'eu-west-1', dbPassword: 'hunter2' }, configSource: 'manual', note: 'kept' } },
      [B]: { id: B, type: 'database', label: 'Orders DB', ports: [], metadata: { position: { x: 300, y: 20 } } },
    },
    edges: { [E1]: { id: E1, source: A, target: B, contractId: K, sourcePortId: P } },
    contracts: { [K]: { id: K, kind: 'data', name: 'orders', schema: { type: 'object', properties: { token: { type: 'string', default: 'hunter3' } } } } },
    artifacts: { [F1]: { id: F1, nodeId: A, path: 'src/api.ts', kind: 'source', content: 'local content', status: 'draft' } },
  };
}

async function anchorOf(g: G): Promise<ModelAnchor> {
  const parsed = parseModel(await serializeModel(g));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.model;
}

// ── the diff ────────────────────────────────────────────────────────────

Deno.test('AD.2b: a load names only what git changed; positions, other metadata, port details and file content stay', async () => {
  const git = canvas();
  git.nodes[A].label = 'Orders Service';
  git.nodes[A].metadata.config = { region: 'eu-west-2', dbPassword: 'other-secret' };
  const repo = await anchorOf(git);
  const plan = await anchorLoadPatches(canvas(), repo, { actorId: 'git-load', sourceCommit: HEAD, nowIso: NOW });
  assertEquals(plan.patches.map((p) => p.type), ['update_node']);
  const changes = plan.patches[0].payload.changes;
  assertEquals(changes.label, 'Orders Service');
  assertEquals(changes.metadata, { config: { dbPassword: 'hunter2', region: 'eu-west-2' } }, 'git withheld the password: the canvas keeps its own');
  assert(!('position' in changes.metadata) && !('ports' in changes), 'nothing else is touched');
  assertEquals(plan.patches[0].metadata.actorType, 'system');
  assertEquals(plan.explanations, ['Git\'s model changes node Orders API']);
});

Deno.test('AD.2b: additions come parents first; removals take files, then connections, then nodes, children first', async () => {
  const cur = canvas();
  cur.nodes[C] = { id: C, type: 'worker', label: 'Old worker', parentId: B, ports: [], metadata: {} };
  cur.artifacts[F2] = { id: F2, nodeId: C, path: 'src/worker.ts', kind: 'source', content: 'x' };
  const git = canvas();
  delete git.nodes[B];
  delete git.edges[E1];
  delete git.contracts[K];
  git.nodes[C] = { id: C, type: 'cluster', label: 'Cluster', ports: [], metadata: {} };
  git.nodes[K2] = { id: K2, type: 'worker', label: 'Job', parentId: C, ports: [], metadata: {} };
  git.edges[E2] = { id: E2, source: A, target: K2, contractId: K };
  git.contracts[K] = { id: K, kind: 'event', name: 'jobs' };
  git.artifacts[F2] = { id: F2, nodeId: K2, path: 'src/job.ts', kind: 'source', content: 'x' };
  const plan = await anchorLoadPatches(cur, await anchorOf(git), { actorId: 'git-load', sourceCommit: HEAD, nowIso: NOW });
  assertEquals(plan.patches.map((p) => `${p.type}:${p.payload.id}`), [
    `update_contract:${K}`, // contracts first: the new connection uses it
    `add_node:${K2}`,
    `update_node:${C}`,
    `add_edge:${E2}`,
    `update_artifact:${F2}`, // the binding follows its file to the new node
    `remove_node:${B}`, // last; its connection goes with it, never removed twice
  ]);
  assertEquals(plan.counts, { added: 2, changed: 3, removed: 1 });
  assertEquals(plan.notApplied, [
    'Contract orders: git has no schema for it; the canvas keeps its schema.',
    'Node Old worker: git moved it out of its container; the canvas keeps it where it is.',
  ], 'named as the canvas names them, never guessed');
});

Deno.test('AD.2b: a new binding takes its content from git at accept, and never fails the accept for a file git lacks', async () => {
  const git = canvas();
  git.artifacts[F2] = { id: F2, nodeId: A, path: 'src/new.ts', kind: 'source', content: 'x' };
  const plan = await anchorLoadPatches(canvas(), await anchorOf(git), { actorId: 'git-load', sourceCommit: HEAD, nowIso: NOW });
  const add = plan.patches.find((p) => p.type === 'add_artifact')!;
  assertEquals(add.payload.content, GIT_CONTENT_SENTINEL);
  assertEquals(add.payload.metadata.contentSource, { type: 'git', ref: HEAD, optional: true });
  assertEquals(GIT_CONTENT_SENTINEL, MCP_SENTINEL, 'the server\'s two sentinels agree');
  const app = Deno.readTextFileSync(new URL('../../../src/ui/utils/proposal-git-content.ts', import.meta.url));
  assert(app.includes(`export const GIT_CONTENT_SENTINEL = '${GIT_CONTENT_SENTINEL}'`), 'and the app\'s');
});

Deno.test('AD.2b: a file marked complete is never removed by a load; it is named', async () => {
  const cur = canvas();
  cur.artifacts[F1].status = 'complete';
  const git = canvas();
  delete git.artifacts[F1];
  const plan = await anchorLoadPatches(cur, await anchorOf(git), { actorId: 'git-load', sourceCommit: HEAD, nowIso: NOW });
  assertEquals(plan.patches.filter((p) => p.type === 'remove_artifact').length, 0);
  assert(plan.notApplied.some((n) => n.includes('src/api.ts')));
});

Deno.test('AD.2b: a version 1 model leaves configuration and schemas as the canvas has them, and says when a schema moved', async () => {
  const git = canvas();
  git.contracts[K].schema = { type: 'object', properties: { id: { type: 'string' } } };
  git.nodes[A].metadata.config = { region: 'us-east-1' };
  const v2 = await anchorOf(git);
  const strip = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([k]) => !['config', 'configSource', 'configHash', 'schema'].includes(k)));
  // the schema hash a version 1 file carries is over the schema as the canvas had it
  const v1 = { ...v2, modelVersion: 1, nodes: v2.nodes.map(strip), contracts: v2.contracts.map(strip) } as ModelAnchor;
  const plan = await anchorLoadPatches(canvas(), v1, { actorId: 'git-load', sourceCommit: HEAD, nowIso: NOW });
  assertEquals(plan.patches.length, 0, 'nothing to change: git says nothing about configuration');
  assert(plan.notApplied.some((n) => n.includes('orders') && n.includes('version 1')), 'the schema change is named');
});

Deno.test('AD.2b: loading the same design twice proposes nothing', async () => {
  const plan = await anchorLoadPatches(canvas(), await anchorOf(canvas()), { actorId: 'git-load', sourceCommit: HEAD, nowIso: NOW });
  assertEquals(plan.patches.length, 0);
  assertEquals(plan.notApplied, []);
  assert(!JSON.stringify(plan).includes(WITHHELD));
});

// ── the filer ───────────────────────────────────────────────────────────

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

function stubGitHub(files: { head: string; anchors: Record<string, string | null>; range?: Array<Record<string, unknown>> | null }) {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes('/git/ref/heads/')) return json({ object: { sha: files.head } });
    const content = url.match(/\/contents\/\.nodespec\/model\.json\?ref=([0-9a-f]+)/);
    if (content) {
      const text = files.anchors[content[1]];
      return text === undefined ? json({}, 500) : text === null ? json({ message: 'Not Found' }, 404) : json({ encoding: 'base64', content: b64(text) });
    }
    if (url.includes('/compare/') && url.includes('per_page=1')) return json({ status: 'ahead' });
    if (url.includes('/compare/')) return files.range === null ? json({}, 500) : json({ files: files.range ?? [], commits: [{ sha: 'e'.repeat(40), commit: { message: 'm' } }] });
    return json({}, 404);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

function world(graph: G, cards: Array<Record<string, unknown>> = []) {
  const sb = new MemorySupabase();
  sb.table('git_integrations', [{
    id: INTEGRATION, project_id: PROJECT, provider: 'github', repo_owner: 'o', repo_name: 'r',
    default_branch: 'main', base_url: null, access_token_encrypted: 'tok',
  }]);
  sb.table('branches', [{ id: BRANCH, project_id: PROJECT, name: 'main', is_primary: true, git_ref: 'main', last_synced_commit: BASE }]);
  sb.table('graph_snapshots', [{ id: 's1', project_id: PROJECT, branch_id: BRANCH, graph_data: graph, patch_sequence: 7, created_at: '2026-09-24T00:00:00Z' }]);
  sb.table('ai_runs', []);
  sb.table('ai_proposals', []);
  sb.table('git_sync_log', []);
  sb.table('git_change_events', cards.map((c) => ({ project_id: PROJECT, status: 'pending', commit_sha: HEAD, ...c })));
  return sb;
}

Deno.test('AD.2b: a load files one pending proposal with the commit it read and the canvas it compared; nothing else is written', async () => {
  const git = canvas();
  git.nodes[A].label = 'Orders Service';
  const gh = stubGitHub({ head: HEAD, anchors: { [HEAD]: await serializeModel(git) } });
  try {
    const sb = world(canvas());
    const r = await fileModelLoadProposal(sb as never, PROJECT, 'main', { requestedBy: 'person' });
    assertEquals(r.ok && r.status, 'filed', JSON.stringify(r));
    const [row] = sb.rowsOf('ai_proposals');
    assertEquals(row.status, 'pending');
    const meta = row.metadata as Record<string, any>;
    assertEquals(meta.source, 'git-load');
    assertEquals(meta.loadsModel, { headSha: HEAD, branchName: 'main', modelHash: parseModel(await serializeModel(git)).ok ? (parseModel(await serializeModel(git)) as any).model.modelHash : '', reanchor: true });
    assertEquals(meta.baseSequence, 7, 'a later canvas change to the same entities conflicts at accept');
    assertEquals((row.patches as any[]).map((e) => [e.patch.type, e.status, e.explanation]), [['update_node', 'pending', 'Git\'s model changes node Orders API']]);
    assertEquals(sb.rowsOf('ai_runs').length, 1);
    assertEquals(sb.rowsOf('graph_snapshots').length, 1, 'no snapshot is written from git');
    assertEquals(sb.rowsOf('branches')[0].last_synced_commit, BASE, 'the last sync waits for the accept');
  } finally { gh.restore(); }
});

Deno.test('AD.2b: one pending load per branch: the same head is the same proposal; a newer head replaces the older', async () => {
  const git = canvas();
  git.nodes[A].label = 'Orders Service';
  const sb = world(canvas());
  let gh = stubGitHub({ head: HEAD, anchors: { [HEAD]: await serializeModel(git) } });
  try {
    const first = await fileModelLoadProposal(sb as never, PROJECT, 'main', { requestedBy: 'automatic' });
    const again = await fileModelLoadProposal(sb as never, PROJECT, 'main', { requestedBy: 'person' });
    assertEquals(again.ok && again.status, 'already-filed');
    assertEquals(again.ok && 'proposalId' in again && again.proposalId, first.ok && 'proposalId' in first && first.proposalId);
    assertEquals(sb.rowsOf('ai_proposals').length, 1);
    assertEquals((sb.rowsOf('ai_proposals')[0].metadata as any).loadsModel.reanchor, true, 'a person asking makes the load theirs');
  } finally { gh.restore(); }
  git.nodes[A].label = 'Orders Platform';
  gh = stubGitHub({ head: NEWER, anchors: { [NEWER]: await serializeModel(git) } });
  try {
    const newer = await fileModelLoadProposal(sb as never, PROJECT, 'main', { requestedBy: 'automatic' });
    assertEquals(newer.ok && newer.status, 'filed');
    const rows = sb.rowsOf('ai_proposals');
    assertEquals(rows.map((r) => r.status).sort(), ['pending', 'rejected']);
    const old = rows.find((r) => r.status === 'rejected')!;
    assert(String((old.metadata as any).resolveNote).includes(NEWER.slice(0, 8)), 'the older load says what replaced it');
  } finally { gh.restore(); }
});

Deno.test('AD.2b: when the canvas already holds git\'s design nothing is filed; the load\'s cards are answered and the last sync moves', async () => {
  const gh = stubGitHub({
    head: HEAD,
    anchors: { [HEAD]: await serializeModel(canvas()) },
    range: [{ filename: '.nodespec/model.json', status: 'modified', sha: 'f1' }],
  });
  try {
    const sb = world(canvas(), [{ id: 'card', metadata: { source: 'sweep', branchName: 'main', modelChanged: true } }]);
    const r = await fileModelLoadProposal(sb as never, PROJECT, 'main', { requestedBy: 'person' });
    assertEquals(r.ok && r.status, 'identical');
    assertEquals(sb.rowsOf('ai_proposals').length, 0);
    assertEquals(sb.rowsOf('branches')[0].last_synced_commit, HEAD);
    assertEquals(sb.rowsOf('git_change_events')[0].status, 'accepted');
  } finally { gh.restore(); }
});

Deno.test('AD.2b: an arriving merge files only while the canvas still equals its baseline; reads say failed; a tampered model is refused', async () => {
  const git = canvas();
  git.nodes[A].label = 'Merged';
  const baselineGraph = canvas();
  baselineGraph.nodes[B].label = 'Something else';
  let gh = stubGitHub({ head: HEAD, anchors: { [HEAD]: await serializeModel(git), [BASE]: await serializeModel(baselineGraph) } });
  try {
    const sb = world(canvas());
    const r = await fileModelLoadProposal(sb as never, PROJECT, 'main', { requestedBy: 'automatic', requireCanvasMatchesBaseline: true });
    assertEquals(!r.ok && r.code, 'guard-failed');
    assertEquals(sb.rowsOf('ai_proposals').length, 0);
  } finally { gh.restore(); }
  gh = stubGitHub({ head: HEAD, anchors: {} });
  try {
    const r = await fileModelLoadProposal(world(canvas()) as never, PROJECT, 'main', { requestedBy: 'person' });
    assertEquals(!r.ok && r.code, 'read-failed', 'an outage is not an absent file');
  } finally { gh.restore(); }
  const tampered = JSON.parse(await serializeModel(git));
  tampered.nodes[0].label = 'Hand edited';
  gh = stubGitHub({ head: HEAD, anchors: { [HEAD]: JSON.stringify(tampered) } });
  try {
    const r = await fileModelLoadProposal(world(canvas()) as never, PROJECT, 'main', { requestedBy: 'person' });
    assertEquals(!r.ok && r.code, 'hash-failed');
  } finally { gh.restore(); }
});

// ── wiring ──────────────────────────────────────────────────────────────

Deno.test('AD.2b wiring: no path writes a snapshot from git; the sync check and restore-model file proposals', () => {
  for (const f of ['../_shared/git-drift.ts', '../git-pull/index.ts', '../git-webhook/handlers.ts', '../save-git-integration/index.ts']) {
    const src = Deno.readTextFileSync(new URL(f, import.meta.url));
    assert(!/from\("graph_snapshots"\)\s*\.insert/.test(src), `${f} writes no snapshot`);
    assert(!/restoreBranchModelFromRef|anchorToGraph|detectRepoDesignBranches/.test(src), `${f} calls nothing retired`);
  }
  const drift = Deno.readTextFileSync(new URL('../_shared/git-drift.ts', import.meta.url));
  assert(/fileModelLoadProposal\(supabase, projectId, branchName, \{\s*requestedBy: "automatic", requireCanvasMatchesBaseline: true,/.test(drift), 'a merge arrival files');
  assert(/status: "load_proposed"/.test(drift));
  const pull = Deno.readTextFileSync(new URL('../git-pull/index.ts', import.meta.url));
  assert(/fileModelLoadProposal\(serviceClient, integration\.project_id, branchName, \{\s*requestedBy: automatic \? "automatic" : "person",/.test(pull));
  const anchor = Deno.readTextFileSync(new URL('../_shared/model-anchor.ts', import.meta.url));
  assert(!/export function anchorToGraph\(/.test(anchor), 'the whole-graph loader is gone');
});

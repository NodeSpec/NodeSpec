// AL.11 (owner 2026-10-01: "Fix task document checkout, this is critical").
// A task document changes only when nobody else is working from it:
//   - generate_task_docs leaves the document of a node another agent holds
//     (the node, or task or code work in it; a box's lease covers its parts)
//     as it is, says who holds it, and generates the rest;
//   - a waiting proposal holds the document it changes: a second generation,
//     or a propose_patches edit of the same file, is not filed;
//   - the proposal records the graph version it was generated from, so the
//     accept applies nothing when the document or its node changed since;
//   - a failed read generates nothing rather than writing over someone.
// The accept side is in src/tests/al11-task-doc-checkout.test.ts.
import { handleGenerateTaskDocs } from '../mcp-server/tools/tasks.ts';
import { handleProposePatches } from '../mcp-server/tools/proposals.ts';
import { artifactTargetsOf, overlapRefusal } from '../mcp-server/tools/change-router.ts';
import { FakeSupabase, assert, assertEquals, completeRole } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N_API = '33333333-3333-4333-8333-333333333333';
const N_BOX = '44444444-4444-4444-8444-444444444444';
const REQ_ROW = '55555555-5555-4555-8555-555555555555';
const DOC = '66666666-6666-4666-8666-666666666666';

const AGENT = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'propose'] } as never;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

// deno-lint-ignore no-explicit-any
function graph(withDoc = false): any {
  return {
    nodes: {
      [N_API]: { id: N_API, type: 'backend-service', label: 'API Service', technology: 'express', parentId: N_BOX, ports: [] },
      [N_BOX]: { id: N_BOX, type: 'k8s-cluster', label: 'Cluster', ports: [] },
    },
    edges: {}, contracts: {},
    artifacts: withDoc ? {
      [DOC]: { id: DOC, nodeId: N_API, kind: 'task', path: '.nodespec/tasks/api-service.task.md', content: 'OLD', metadata: { taskContextFingerprint: { fingerprint: 'stale' } } },
    } : {},
  };
}

type Setup = {
  withDoc?: boolean;
  leases?: unknown[] | { error: string };
  waiting?: unknown[] | { error: string };
  head?: number | { error: string };
  snapshotSequence?: number;
  apiIsPart?: boolean;
};

function scripted(o: Setup = {}): FakeSupabase {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: graph(o.withDoc), ...(o.snapshotSequence !== undefined ? { patch_sequence: o.snapshotSequence } : {}) }, error: null });
  const head = o.head ?? 41;
  sb.script('graph_patches', 'select', typeof head === 'number' ? { data: { sequence: head }, error: null } : { data: null, error: { message: head.error } });
  sb.script('node_roles', 'select', {
    data: [
      { id: 'k8s-cluster', is_container: true },
      ...(o.apiIsPart ? [{ id: 'backend-service', capability_tags: ['part'] }] : []),
    ].map(completeRole),
    error: null,
  });
  for (const t of ['technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: 'A CRM for small teams' }, error: null });
  sb.script('specification_mappings', 'select', { data: [{ requirement_id: REQ_ROW, node_id: N_API }], error: null });
  sb.script('specification_requirements', 'select', {
    data: [{ id: REQ_ROW, requirement_id: 'REQ-001', name: 'Health endpoint', description: 'The API must expose /health', category: 'technical', status: 'pending', acceptance_criteria: [{ text: 'GET /health returns 200' }] }],
    error: null,
  });
  const leases = o.leases ?? [];
  sb.script('agent_checkouts', 'select', Array.isArray(leases) ? { data: leases, error: null } : { data: null, error: { message: leases.error } });
  const waiting = o.waiting ?? [];
  sb.script('ai_proposals', 'select', Array.isArray(waiting) ? { data: waiting, error: null } : { data: null, error: { message: waiting.error } });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  return sb;
}

const workOn = (nodeId: string, over: Record<string, unknown> = {}) => ({
  id: 'l1', level: 'task', node_id: nodeId, holder_label: 'codex · lead', holder_key_id: 'k2', holder_delegate: 'key:k2', since: ago(12), heartbeat_at: ago(1), ...over,
});

const generate = (sb: FakeSupabase, nodeIds?: string[]) =>
  handleGenerateTaskDocs(sb as never, AGENT, { project_id: PROJECT.id, branch_id: BRANCH, ...(nodeIds ? { node_ids: nodeIds } : {}) });

// deno-lint-ignore no-explicit-any
const filed = (sb: FakeSupabase): any => sb.callsTo('ai_proposals', 'insert')[0]?.payload;
// deno-lint-ignore no-explicit-any
const docNodes = (sb: FakeSupabase): string[] => (filed(sb)?.patches ?? []).map((e: any) => e.patch).filter((p: any) => p.type === 'add_artifact' || p.type === 'update_artifact').map((p: any) => p.payload.nodeId ?? (p.payload.id === DOC ? N_API : '?'));
const touchedTaskItemsOf = (sb: FakeSupabase, nodeId: string) =>
  sb.callsTo('task_items').filter((c) => c.filters.some((f) => f.args[0] === 'node_id' && f.args[1] === nodeId)).length;

Deno.test('AL.11 a node another agent works in keeps its task document; the rest are generated, and the proposal records its base', async () => {
  const sb = scripted({ leases: [workOn(N_API)] });
  const r = await generate(sb);
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as { held: Array<Record<string, unknown>>; skipped: string[]; baseSequence: number };
  assertEquals(data.held.map((h) => [h.nodeId, h.by, h.level]), [[N_API, 'codex · lead', 'task']]);
  assert(data.skipped.some((s) => s.startsWith('API Service: codex · lead holds task work in it since ') && s.includes('left as it is')), data.skipped.join(' | '));
  assertEquals(docNodes(sb), [N_BOX], 'only the free node is generated');
  assertEquals(touchedTaskItemsOf(sb, N_API), 0, 'the held node\'s task items are not reconciled');
  assertEquals([filed(sb).metadata.baseSequence, data.baseSequence], [41, 41]);
});

Deno.test('AL.11 the caller\'s own hold, a stale hold and a hold elsewhere leave the document free', async () => {
  for (const lease of [workOn(N_API, { holder_key_id: 'k1', holder_delegate: 'key:k1' }), workOn(N_API, { heartbeat_at: ago(45) }), workOn('99999999-9999-4999-8999-999999999999')]) {
    const sb = scripted({ leases: [lease] });
    const r = await generate(sb);
    assertEquals(r.success, true, JSON.stringify(r));
    assertEquals(docNodes(sb).sort(), [N_API, N_BOX].sort(), JSON.stringify(lease));
  }
});

Deno.test('AL.11 a node lease on a box covers its parts; a node lease on the node itself holds it', async () => {
  const box = scripted({ leases: [workOn(N_BOX, { level: 'node' })], apiIsPart: true });
  const r = await generate(box);
  assertEquals(r.success, false, 'both are held: the box itself and its part');
  assert(String(r.error).includes('API Service: codex · lead holds the node it is a part of'), String(r.error));
  assert(String(r.error).includes('Cluster: codex · lead holds the node since'), String(r.error));

  const notPart = scripted({ leases: [workOn(N_BOX, { level: 'node' })] });
  const r2 = await generate(notPart);
  assertEquals(docNodes(notPart), [N_API], 'a hosted child that is not a part is its own node');
  assertEquals(r2.success, true);
});

Deno.test('AL.11 a waiting proposal holds the document it changes: a regeneration and a first generation alike', async () => {
  const regen = scripted({ withDoc: true, waiting: [{ id: 'prop-docs', patches: [{ patch: { type: 'update_artifact', payload: { id: DOC, changes: {} } } }], metadata: { requestedBy: 'claude · docs' } }] });
  const r = await generate(regen);
  assertEquals(r.success, true);
  const held = (r.data as { held: Array<Record<string, unknown>> }).held;
  assertEquals(held.map((h) => [h.nodeId, h.proposalId, h.by]), [[N_API, 'prop-docs', 'claude · docs']]);
  assertEquals(docNodes(regen), [N_BOX]);

  const first = scripted({ waiting: [{ id: 'prop-first', patches: [{ patch: { type: 'add_artifact', payload: { id: 'x', nodeId: N_API, kind: 'task' } } }], metadata: { credentialLabel: 'key · ci' } }] });
  const r2 = await generate(first, [N_API]);
  assertEquals(r2.success, false);
  assert(String(r2.error).startsWith('No task document was generated. API Service: proposal prop-first (from key · ci) already changes its task document'), String(r2.error));
  assertEquals(first.callsTo('ai_proposals', 'insert').length, 0, 'nothing filed');
  assertEquals(touchedTaskItemsOf(first, N_API), 0);
});

Deno.test('AL.11 a waiting proposal on another file holds nothing here', async () => {
  const sb = scripted({ withDoc: true, waiting: [{ id: 'p', patches: [{ patch: { type: 'update_artifact', payload: { id: 'other-file', changes: {} } } }, { patch: { type: 'add_artifact', payload: { id: 'y', nodeId: N_API, kind: 'code' } } }], metadata: {} }] });
  const r = await generate(sb);
  assertEquals(r.success, true);
  assertEquals(docNodes(sb).sort(), [N_API, N_BOX].sort());
});

Deno.test('AL.11 a failed read generates nothing: the holds, the waiting proposals, the head', async () => {
  for (const [setup, says] of [
    [{ leases: { error: 'timeout' } }, 'Could not read who holds these nodes, so no task document was generated: timeout'],
    [{ waiting: { error: 'timeout' } }, 'Could not read the waiting proposals, so no task document was generated.'],
    [{ head: { error: 'timeout' } }, "Could not read the branch's head, so no task document was generated: timeout"],
  ] as Array<[Setup, string]>) {
    const sb = scripted(setup);
    const r = await generate(sb);
    assertEquals(r.success, false);
    assert(String(r.error).startsWith(says), String(r.error));
    assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);
  }
});

Deno.test('AL.11 the base is the older of the snapshot and the head, so nothing between them is missed', async () => {
  const lagging = scripted({ head: 41, snapshotSequence: 37 });
  await generate(lagging);
  assertEquals(filed(lagging).metadata.baseSequence, 37);
  const ahead = scripted({ head: 41, snapshotSequence: 44 });
  await generate(ahead);
  assertEquals(filed(ahead).metadata.baseSequence, 41);
});

Deno.test('AL.11 what a file patch holds while it waits', () => {
  assertEquals(artifactTargetsOf({ type: 'update_artifact', payload: { id: DOC } }), [`artifact:${DOC}`]);
  assertEquals(artifactTargetsOf({ type: 'remove_artifact', payload: { id: DOC } }), [`artifact:${DOC}`]);
  assertEquals(artifactTargetsOf({ type: 'add_artifact', payload: { id: DOC, nodeId: N_API, kind: 'task' } }), [`taskdoc:${N_API}`]);
  assertEquals(artifactTargetsOf({ type: 'add_artifact', payload: { id: DOC, nodeId: N_API, kind: 'code' } }), []);
  assertEquals(artifactTargetsOf({ type: 'update_node', payload: { id: N_API } }), []);
  assertEquals(overlapRefusal({ proposalId: 'p', by: 'codex', key: `taskdoc:${N_API}`, type: 'add_artifact' }).startsWith(`Proposal p (from codex) is already waiting on the task document of node ${N_API}`), true);
});

Deno.test('AL.11 propose_patches will not file an edit to a task document a waiting proposal changes', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: PROJECT.id, name: PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('ai_proposals', 'select', { data: [{ id: 'prop-docs', patches: [{ patch: { type: 'update_artifact', payload: { id: DOC, changes: {} } } }], metadata: { requestedBy: 'claude · docs' } }], error: null });
  const r = await handleProposePatches(sb as never, { userId: 'user-1', authMethod: 'api_key', keyId: 'k3', scopes: ['read', 'propose'] } as never, {
    project_id: PROJECT.id, branch_id: BRANCH,
    patches: [{ type: 'update_artifact', payload: { id: DOC, changes: { content: '# expanded work orders' } } }],
  });
  assertEquals(r.success, false);
  assert(String(r.error).startsWith(`Proposal prop-docs (from claude · docs) is already waiting on the file ${DOC}, so this update_artifact was not filed`), String(r.error));
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);
});

// P1-7 C1.3: generate_task_docs — the deterministic packet-creation lane over MCP
// (internal-agent parity post-inversion). Pins: leaf-only targeting, real generated content
// (not a requirements dump), fingerprint stamping, add-vs-refresh behavior, node linkage,
// and the no-op path when everything is fresh.
import { handleGenerateTaskDocs } from '../mcp-server/tools/tasks.ts';
import { PatchOperationSchema } from '../_shared/patch-schema.ts';
import { FakeSupabase, assert, assertEquals, completeRole } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N_API = '33333333-3333-4333-8333-333333333333';
const N_BOX = '44444444-4444-4444-8444-444444444444';
const REQ_ROW = '55555555-5555-4555-8555-555555555555';

const PROPOSE_AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'propose'] } as never;

const N_GRP = '88888888-8888-4888-8888-888888888888';

// N5.16: API Service is HOSTED inside the cluster (the container doc must account
// for it); a logical Group is present to pin the organizational skip.
// deno-lint-ignore no-explicit-any
function graph(withExistingDoc?: { id: string; content: string; fingerprint?: any }): any {
  return {
    nodes: {
      [N_API]: { id: N_API, type: 'backend-service', label: 'API Service', technology: 'express', parentId: N_BOX, ports: [] },
      [N_BOX]: { id: N_BOX, type: 'k8s-cluster', label: 'Cluster', ports: [] },
      [N_GRP]: { id: N_GRP, type: 'domain-module', label: 'Grouping', ports: [] },
    },
    edges: {}, contracts: {},
    artifacts: withExistingDoc ? {
      [withExistingDoc.id]: {
        id: withExistingDoc.id, nodeId: N_API, kind: 'task',
        path: '.nodespec/tasks/api-service.task.md', content: withExistingDoc.content,
        metadata: withExistingDoc.fingerprint ? { taskContextFingerprint: withExistingDoc.fingerprint } : {},
      },
    } : {},
  };
}

// deno-lint-ignore no-explicit-any
function script(sb: FakeSupabase, g: any) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: g }, error: null });
  sb.script('node_roles', 'select', {
    data: [
      { id: 'k8s-cluster', is_container: true },
      { id: 'domain-module', is_container: true, container_style: 'logical-boundary' },
    ].map(completeRole),
    error: null,
  });
  for (const t of ['technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: 'A CRM for small teams' }, error: null });
  sb.script('specification_mappings', 'select', {
    data: [
      { requirement_id: REQ_ROW, node_id: N_API },
      // N5.13: stale mapping to a deleted node — pruned at read time, so the packet's
      // "Shared with" can never carry a phantom UUID.
      { requirement_id: REQ_ROW, node_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    ],
    error: null,
  });
  sb.script('specification_requirements', 'select', {
    data: [{ id: REQ_ROW, requirement_id: 'REQ-001', name: 'Health endpoint', description: 'The API must expose /health', category: 'technical', status: 'pending', acceptance_criteria: [{ text: 'GET /health returns 200' }] }],
    error: null,
  });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
}

Deno.test('generate_task_docs: leaf AND hosting container get packets; logical group skipped (N5.16)', async () => {
  const sb = new FakeSupabase();
  script(sb, graph());

  const r = await handleGenerateTaskDocs(sb as never, PROPOSE_AUTH, { project_id: PROJECT.id, branch_id: BRANCH });
  assertEquals(r.success, true);
  const data = r.data as Record<string, unknown>;
  assertEquals(data.generated, 2, 'leaf + hosting container each get a doc');
  assertEquals(data.refreshed, 0);
  assert((data.skipped as string[]).some((s) => s.includes('Grouping') && s.includes('organizational group')), 'logical group skipped with honest reason');

  const insert = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { type: string; payload: Record<string, unknown>; metadata: Record<string, unknown> } }>;
  };
  const addArtifact = insert.patches.find((p) => p.patch.type === 'add_artifact' && p.patch.payload.nodeId === N_API)!.patch;
  const content = String(addArtifact.payload.content);

  // N5.16: the container's doc — provisioning deliverable + hosted-children work order.
  const containerDoc = String(insert.patches.find((p) => p.patch.type === 'add_artifact' && p.patch.payload.nodeId === N_BOX)!.patch.payload.content);
  assert(containerDoc.includes('provisions the runtime context for the components inside it'), 'container-true deliverable phrasing');
  assert(containerDoc.includes("Account for every hosted component in this container's definition."), 'hosted-children work order present');
  assert(containerDoc.includes('Hosted here: API Service'), 'work order names the hosted child');
  assert(!containerDoc.includes('provider-managed service'), 'no provider-service phrasing on a self-provisioned container');
  assert(content.includes('API Service'), 'doc names the node');
  assert(content.includes('REQ-001') || content.includes('Health endpoint'), 'doc carries the mapped requirement');
  // Structural richness: purpose/context/acceptance sections, not a bare requirements list.
  // (Full richness — technology guidance, contracts — comes from catalog rows, empty in this
  // fixture; the live bench asserts that side via the C1.3 procedure.)
  assert(content.includes('# Task:'), 'build-brief heading');
  assert(content.includes('Component Purpose'), 'purpose section present');
  assert(content.includes('Acceptance criteria — your task boxes'), 'scoped criteria task boxes present (N5.7)');
  assert(!content.includes('dddddddd'), 'stale mapping to a deleted node never renders as a phantom UUID (N5.13)');
  assert((addArtifact.payload.metadata as Record<string, unknown>).taskContextFingerprint, 'fingerprint stamped → C1 freshness manages it');
  assertEquals(addArtifact.metadata.actorId, 'task-generator');
  assert(String(addArtifact.payload.path).startsWith('.nodespec/tasks/'), 'packet lives in the namespaced home');

  const link = insert.patches.find((p) => p.patch.type === 'update_node')!.patch;
  assertEquals(link.payload.id, N_API, 'artifact linked onto the node');

  for (const p of insert.patches) {
    assert(PatchOperationSchema.safeParse(p.patch).success, `${p.patch.type} valid for the apply pipeline`);
  }
});

Deno.test('generate_task_docs: existing managed doc with changed context → update_artifact refresh, no duplicate add', async () => {
  const sb = new FakeSupabase();
  const DOC = '66666666-6666-4666-8666-666666666666';
  script(sb, graph({ id: DOC, content: 'OLD STALE DOC', fingerprint: { fingerprint: 'stale' } }));

  const r = await handleGenerateTaskDocs(sb as never, PROPOSE_AUTH, { project_id: PROJECT.id, branch_id: BRANCH });
  assertEquals(r.success, true);
  const data = r.data as Record<string, unknown>;
  assertEquals(data.generated, 1, 'the container doc is new (N5.16)');
  assertEquals(data.refreshed, 1);

  const insert = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { type: string; payload: Record<string, unknown> } }>;
  };
  const upd = insert.patches.find((p) => p.patch.type === 'update_artifact')!.patch;
  assertEquals(upd.type, 'update_artifact');
  assertEquals(upd.payload.id, DOC, 'targets the existing artifact by id (P0-4: never by recomputed path)');
  const changes = upd.payload.changes as Record<string, unknown>;
  assert(String(changes.content).includes('API Service'), 'regenerated content');
  assert((changes.metadata as Record<string, unknown>).taskContextFingerprint, 'fingerprint advanced');
});

Deno.test('generate_task_docs: everything fresh → success, zero patches, NO proposal row', async () => {
  const sb = new FakeSupabase();
  // First run captures what the generator produces so we can plant BOTH existing docs
  // (leaf + container, N5.16).
  const probe = new FakeSupabase();
  script(probe, graph());
  await handleGenerateTaskDocs(probe as never, PROPOSE_AUTH, { project_id: PROJECT.id, branch_id: BRANCH });
  const probeInsert = probe.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { type: string; payload: Record<string, unknown> } }>;
  };
  const apiContent = String(probeInsert.patches.find((p) => p.patch.type === 'add_artifact' && p.patch.payload.nodeId === N_API)!.patch.payload.content);
  const boxContent = String(probeInsert.patches.find((p) => p.patch.type === 'add_artifact' && p.patch.payload.nodeId === N_BOX)!.patch.payload.content);

  const DOC1 = '77777777-7777-4777-8777-777777777777';
  const DOC2 = '99999999-9999-4999-8999-999999999999';
  // deno-lint-ignore no-explicit-any
  const g: any = graph({ id: DOC1, content: apiContent });
  g.artifacts[DOC2] = { id: DOC2, nodeId: N_BOX, kind: 'task', path: '.nodespec/tasks/cluster.task.md', content: boxContent, metadata: {} };
  script(sb, g);
  const r = await handleGenerateTaskDocs(sb as never, PROPOSE_AUTH, { project_id: PROJECT.id, branch_id: BRANCH });
  assertEquals(r.success, true);
  const data = r.data as Record<string, unknown>;
  assertEquals(data.alreadyFresh, 2);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0, 'no empty proposal created');
});

Deno.test('generate_task_docs: requires propose scope; node_ids filter matches by label', async () => {
  const sb = new FakeSupabase();
  const r = await handleGenerateTaskDocs(sb as never, { userId: 'u', authMethod: 'api_key', scopes: ['read'] } as never, {
    project_id: PROJECT.id, branch_id: BRANCH,
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('propose scope'));

  const sb2 = new FakeSupabase();
  script(sb2, graph());
  const r2 = await handleGenerateTaskDocs(sb2 as never, PROPOSE_AUTH, {
    project_id: PROJECT.id, branch_id: BRANCH, node_ids: ['api service'],
  });
  assertEquals(r2.success, true);
  assertEquals((r2.data as Record<string, unknown>).generated, 1, 'case-insensitive label match');
});

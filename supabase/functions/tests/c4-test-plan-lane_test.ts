// C4 steps 1+2+5 — test-plan lane unification.
//
// Step 5 (Discovered #4): the test-plan path keys on the requirement id ONLY, and
// lookups go through findExistingTestArtifact (metadata.requirementId → id-only path →
// legacy id+name path) — renaming a requirement must neither move nor orphan its plan
// (the exact analogue of the task-doc P0-4 pins).
// Step 2: packet-freshness extends to kind='test-plan' with the SAME provenance guard
// (no fingerprint = user-authored = never touched), plus one extra respect: the plan's
// editable "## Test Strategy" section survives regeneration.
// Step 1: get_test_plan no longer discards a fresh generation — it parks it as a
// pending proposal in the generate_task_docs mold ('test-plan-generator' actor).
import {
  generateTestDocument,
  getTestDocumentPath,
  findExistingTestArtifact,
  preserveTestStrategySection,
  computeTestContextFingerprint,
} from '../_shared/test-document-generator.ts';
import { refreshTaskPackets } from '../_shared/packet-freshness.ts';
import { handleGetTestPlan } from '../mcp-server/tools/context.ts';
import { PatchOperationSchema } from '../_shared/patch-schema.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N1 = '33333333-3333-4333-8333-333333333333';
const REQ_ROW = '55555555-5555-4555-8555-555555555555';
const TP = '66666666-6666-4666-8666-666666666666';

const READ_AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read'] } as never;

// deno-lint-ignore no-explicit-any
function baseGraph(): any {
  return {
    nodes: {
      [N1]: { id: N1, label: 'API Service', type: 'backend-service', technology: 'express', ports: [], artifacts: [] },
    },
    edges: {}, contracts: {}, artifacts: {},
  };
}

const MAPPED = [{ nodeId: N1, label: 'API Service', role: 'backend-service', technology: 'express' }];
// deno-lint-ignore no-explicit-any
const EMPTY_CATALOGS: any = { nodeRoles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} };

// deno-lint-ignore no-explicit-any
function reqForGen(criteria: Array<{ text: string; met?: boolean }>): any {
  return {
    requirementId: 'REQ-001', name: 'Health endpoint', description: 'The API must expose /health',
    category: 'functional', status: 'pending', acceptanceCriteria: criteria,
  };
}

// ── Step 5: path stability (Discovered #4) ────────────────────────────────────

Deno.test('C4: test-plan path keys on the requirement id only — a rename cannot move it', () => {
  assertEquals(getTestDocumentPath('REQ-001', 'Old Name'), '.nodespec/tests/req-001.tests.md');
  assertEquals(
    getTestDocumentPath('REQ-001', 'Completely Different Name'),
    getTestDocumentPath('REQ-001', 'Old Name'),
    'the mutable name must never participate in the slug',
  );
});

Deno.test('findExistingTestArtifact: metadata.requirementId wins — a renamed requirement still finds its plan under a legacy path', () => {
  const plan = {
    id: TP, nodeId: N1, kind: 'test-plan', path: '.nodespec/tests/req-001-old-name.tests.md',
    content: 'PLAN', metadata: { requirementId: 'REQ-001' },
  };
  const artifacts = { [TP]: plan, other: { id: 'other', nodeId: N1, kind: 'source', path: '.nodespec/tests/req-001.tests.md', metadata: {} } };
  // deno-lint-ignore no-explicit-any
  assertEquals(findExistingTestArtifact(artifacts as any, 'REQ-001', 'New Name'), plan as never);
  // deno-lint-ignore no-explicit-any
  assertEquals(findExistingTestArtifact(artifacts as any, 'REQ-002', 'x'), null, 'kind guard: the source artifact squatting on the new-form path is never a match');
});

Deno.test('findExistingTestArtifact: pre-C4 plans keep being found — legacy id+name path and new id-only path both match', () => {
  const legacy = { id: 'a', nodeId: N1, kind: 'test-plan', path: '.nodespec/tests/req-001-health-endpoint.tests.md', metadata: {} };
  const newForm = { id: 'b', nodeId: N1, kind: 'test-plan', path: '.nodespec/tests/req-002.tests.md', metadata: {} };
  // deno-lint-ignore no-explicit-any
  assertEquals(findExistingTestArtifact({ a: legacy } as any, 'REQ-001', 'Health endpoint'), legacy as never, 'legacy path still found');
  // deno-lint-ignore no-explicit-any
  assertEquals(findExistingTestArtifact({ b: newForm } as any, 'REQ-002', 'Anything At All'), newForm as never, 'id-only path found regardless of name');
});

// ── Step 2: the Test-Strategy-preserving merge ────────────────────────────────

Deno.test('preserveTestStrategySection: user edits ride into the regenerated plan; derived sections refresh', () => {
  const generated = '# T\n\n## Acceptance Criteria\n\nnew derived\n\n## Test Strategy\n\nplaceholder body\n';
  const stored = '# T\n\n## Acceptance Criteria\n\nold derived\n\n## Test Strategy\n\nMY EDITED STRATEGY\n\n### Custom Fixtures\n\n- seeded users\n';
  const merged = preserveTestStrategySection(generated, stored);
  assert(merged.includes('new derived'), 'derived section regenerates');
  assert(!merged.includes('old derived'), 'stale derived content gone');
  assert(merged.includes('MY EDITED STRATEGY'), 'user strategy body preserved');
  assert(merged.includes('### Custom Fixtures'), 'user subsections preserved');
  assert(!merged.includes('placeholder body'), 'generated placeholder replaced by the user body');
});

Deno.test('preserveTestStrategySection: pristine or absent stored section → generated wins unchanged', () => {
  const generated = '# T\n\n## Test Strategy\n\nsame body\n';
  assertEquals(preserveTestStrategySection(generated, '# T\n\n## Test Strategy\n\nsame body\n'), generated);
  assertEquals(preserveTestStrategySection(generated, '# T\n\nno strategy heading here\n'), generated);
});

// ── Step 2: freshness gate over test plans ────────────────────────────────────

function scriptSpecPlane(sb: FakeSupabase, criteria: Array<{ text: string; met?: boolean }>) {
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: null }, error: null });
  sb.script('specification_mappings', 'select', { data: [{ requirement_id: 'row-1', node_id: N1 }], error: null });
  sb.script('specification_requirements', 'select', {
    data: [{ id: 'row-1', requirement_id: 'REQ-001', name: 'Health endpoint', description: 'The API must expose /health', category: 'functional', status: 'pending', acceptance_criteria: criteria }],
    error: null,
  });
}

Deno.test('freshness: stale test-plan regenerates with the user Test Strategy preserved; legacy path recovered; requirementId stamped', async () => {
  const sb = new FakeSupabase();
  const oldCriteria = [{ text: 'GET /health returns 200', met: false }];
  const newCriteria = [...oldCriteria, { text: 'NEW LATENCY CRITERION under 100ms', met: false }];
  scriptSpecPlane(sb, newCriteria);

  const graph = baseGraph();
  // Stored plan was generated against the OLD criteria, then the user edited the
  // editable section. No metadata.requirementId (pre-C4 plan) → legacy-path recovery.
  const storedContent = generateTestDocument({
    requirement: reqForGen(oldCriteria), graph, catalogs: EMPTY_CATALOGS, mappedNodes: MAPPED as never, sourceArtifacts: [],
  }).replace('- [ ] Define test data fixtures', '- [ ] MY CUSTOM FIXTURE PLAN');
  const oldFp = computeTestContextFingerprint(reqForGen(oldCriteria), MAPPED as never, [], graph);
  graph.artifacts[TP] = {
    id: TP, nodeId: N1, kind: 'test-plan', path: '.nodespec/tests/req-001-health-endpoint.tests.md',
    content: storedContent, language: 'markdown', status: 'draft',
    metadata: { testContextFingerprint: oldFp },
  };

  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assertEquals(r.testPlansChecked, 1);
  assertEquals(r.testPlansRefreshed, 1);
  assertEquals(r.testPlansRefreshedPaths, ['.nodespec/tests/req-001-health-endpoint.tests.md'], 'persisted path kept — never recomputed on refresh');
  const a = graph.artifacts[TP];
  assert(a.content.includes('NEW LATENCY CRITERION'), 'derived sections regenerated from the current spec plane');
  assert(a.content.includes('MY CUSTOM FIXTURE PLAN'), 'the user-edited Test Strategy body survived the regenerate');
  assert(!a.content.includes('- [ ] Define test data fixtures'), 'the generated placeholder did not clobber the edit');
  assert(a.metadata.testContextFingerprint.fingerprint !== oldFp.fingerprint, 'fingerprint advanced');
  assertEquals(a.metadata.requirementId, 'REQ-001', 'recovered plan gains the rename-proof key');
  assertEquals(a.metadata.stale, false);
});

Deno.test('freshness: fresh test-plan fingerprint → checked, content untouched', async () => {
  const sb = new FakeSupabase();
  const criteria = [{ text: 'GET /health returns 200', met: false }];
  scriptSpecPlane(sb, criteria);
  const graph = baseGraph();
  // N10(b): stamp with the same empty catalogs the freshness run loads, or the
  // catalogSignature field-set change reads as stale.
  // deno-lint-ignore no-explicit-any
  const emptyCatalogs: any = { nodeRoles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} };
  const fp = computeTestContextFingerprint(reqForGen(criteria), MAPPED as never, [], graph, undefined, emptyCatalogs);
  graph.artifacts[TP] = {
    id: TP, nodeId: N1, kind: 'test-plan', path: '.nodespec/tests/req-001.tests.md',
    content: 'CURRENT PLAN', metadata: { testContextFingerprint: fp, requirementId: 'REQ-001' },
  };
  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assertEquals(r.testPlansChecked, 1);
  assertEquals(r.testPlansRefreshed, 0);
  assertEquals(graph.artifacts[TP].content, 'CURRENT PLAN');
});

Deno.test('freshness: unmanaged test-plan (no fingerprint = user-authored) is skipped, counted, and costs no DB traffic', async () => {
  const sb = new FakeSupabase();
  const graph = baseGraph();
  graph.artifacts[TP] = { id: TP, nodeId: N1, kind: 'test-plan', path: 'docs/my-own-plan.md', content: 'HAND WRITTEN', metadata: {} };
  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assertEquals(r.testPlansSkippedUnmanaged, 1);
  assertEquals(r.testPlansChecked, 0);
  assertEquals(graph.artifacts[TP].content, 'HAND WRITTEN', 'provenance guard held');
  assertEquals(sb.calls.length, 0, 'nothing managed → no catalog/spec load');
});

// ── Step 1: get_test_plan persists a fresh generation as a pending proposal ──

// deno-lint-ignore no-explicit-any
function scriptGetTestPlan(sb: FakeSupabase, g: any, opts?: { skipCatalogs?: boolean }) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: REQ_ROW, requirement_id: 'REQ-001', name: 'Health endpoint', description: 'The API must expose /health', category: 'functional', status: 'pending', acceptance_criteria: [{ text: 'GET /health returns 200' }], specification_id: 'spec-1' },
    error: null,
  });
  sb.script('graph_snapshots', 'select', { data: { graph_data: g }, error: null });
  sb.script('specification_mappings', 'select', { data: [{ node_id: N1 }], error: null });
  if (!opts?.skipCatalogs) {
    for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
      sb.script(t, 'select', { data: [], error: null });
    }
    sb.script('ai_runs', 'insert', { data: null, error: null });
    sb.script('ai_proposals', 'insert', { data: null, error: null });
  }
  sb.script('test_cases', 'select', { data: [], error: null });
}

Deno.test('get_test_plan: fresh generation is parked as a proposal — add_artifact + node link, test-plan-generator actor', async () => {
  const sb = new FakeSupabase();
  scriptGetTestPlan(sb, baseGraph());

  const r = await handleGetTestPlan(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, requirement_id: REQ_ROW });
  assertEquals(r.success, true);
  const data = r.data as Record<string, unknown>;
  assertEquals(data.testPlanIsNew, true);
  assert(typeof data.proposalId === 'string', 'response carries the parked proposal id');
  assert(String(data.note).includes('accepted'), 'one-line note says the plan persists on acceptance');
  assert(String(data.testPlanContent).includes('<untrusted-data>'), 'response content stays enveloped (P0-7)');

  const run = sb.callsTo('ai_runs', 'insert')[0].payload as Record<string, unknown>;
  assertEquals(run.model, 'test-plan-generator');
  assertEquals(run.prompt_hash, 'mcp-test-plan');

  const insert = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { type: string; payload: Record<string, unknown>; metadata: Record<string, unknown> } }>;
  };
  const add = insert.patches.find((p) => p.patch.type === 'add_artifact')!.patch;
  assertEquals(add.payload.kind, 'test-plan');
  assertEquals(add.payload.nodeId, N1, 'attached to mappedNodeIds[0]');
  assertEquals(add.payload.path, '.nodespec/tests/req-001.tests.md', 'id-only path (Discovered #4)');
  assert(!String(add.payload.content).includes('<untrusted-data>'), 'the STORED artifact is never enveloped — transport concern only');
  const meta = add.payload.metadata as Record<string, unknown>;
  assert(meta.testContextFingerprint, 'fingerprint stamped → the freshness gate manages it');
  assertEquals(meta.requirementId, 'REQ-001', 'rename-proof lookup key stamped at birth');
  assertEquals(add.metadata.actorId, 'test-plan-generator');

  const link = insert.patches.find((p) => p.patch.type === 'update_node')!.patch;
  assertEquals(link.payload.id, N1, 'companion link patch targets the primary mapped node');
  assert((link.payload.changes as Record<string, unknown[]>).artifacts.includes(add.payload.id), 'node gains the artifact id');

  for (const p of insert.patches) {
    assert(PatchOperationSchema.safeParse(p.patch).success, `${p.patch.type} valid for the apply pipeline`);
  }
});

Deno.test('get_test_plan: stored plan found via metadata.requirementId after a rename → returned as-is, NO proposal', async () => {
  const sb = new FakeSupabase();
  const g = baseGraph();
  g.artifacts[TP] = {
    id: TP, nodeId: N1, kind: 'test-plan', path: '.nodespec/tests/req-001-old-name.tests.md',
    content: 'STORED PLAN BODY', status: 'draft',
    metadata: { testContextFingerprint: { fingerprint: 'f1' }, requirementId: 'REQ-001' },
  };
  scriptGetTestPlan(sb, g, { skipCatalogs: true });

  const r = await handleGetTestPlan(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, requirement_id: REQ_ROW });
  assertEquals(r.success, true);
  const data = r.data as Record<string, unknown>;
  assertEquals(data.testPlanIsNew, false);
  assert(String(data.testPlanContent).includes('STORED PLAN BODY'), 'rename did not orphan the stored plan');
  assertEquals(data.proposalId, undefined, 'nothing generated → nothing parked');
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);
  assertEquals(sb.callsTo('ai_runs', 'insert').length, 0);
});

// ── Wiring pins (jsr-403 blocks `deno check`; source pins hold the wiring) ────

const source = (rel: string) => Deno.readTextFileSync(new URL(rel, import.meta.url));

Deno.test('C4 wiring: test-plan generation + parking live ONLY in get_test_plan; get_project_context reads plan state (WS1 read purity)', () => {
  const src = source('../mcp-server/tools/context.ts');
  const calls = src.split('assembleTestPlanForRequirement(').length - 1;
  assertEquals(calls, 2, 'declared once, called ONLY from get_test_plan — a context READ must not generate or park proposals');
  assert(src.includes('findExistingTestArtifact('), 'the requirement branch reports stored-plan state via the rename-proof lookup');
  assert(src.includes("actorId: 'test-plan-generator'"), 'the proposal wears the generator actor');
  assert(src.includes("model: 'test-plan-generator'") && src.includes("prompt_hash: 'mcp-test-plan'"), 'ai_runs row matches the task-doc mold');
  assert(src.includes('if (runError) return null;') && src.includes('if (proposalError) return null;'),
    'a failed persist degrades to the pre-C4 read, never fails get_test_plan');
});

Deno.test('C4 wiring: agent-loop lane finds plans through findExistingTestArtifact and stamps requirementId', () => {
  const src = source('../_shared/agent-loop-v4.ts');
  assert(src.includes('findExistingTestArtifact('), 'no recomputed-path lookup left in the agent loop');
  assert(src.includes('requirementId: requirement.requirementId'), 'new/updated plans gain the rename-proof key');
});

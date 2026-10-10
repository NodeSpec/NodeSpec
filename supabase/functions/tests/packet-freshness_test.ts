// P1-7 C1: the packet freshness gate. Pins the core-value contract: a push never ships a
// stale generator-managed task doc, and NEVER touches a user-authored one (no fingerprint =
// not managed = hands off). Fully offline — catalog + spec loads run over FakeSupabase.
import { refreshTaskPackets } from '../_shared/packet-freshness.ts';
import { computeTaskContextFingerprint } from '../_shared/task-document-generator.ts';
import { servedSentences, servedVisionText } from '../_shared/served-vision.ts';
import { visionSentenceId } from '../_shared/vision-sentences.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const N1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const N2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const E1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const C1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TASK = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const USER_DOC = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

// deno-lint-ignore no-explicit-any
function baseGraph(withEdge: boolean): any {
  return {
    nodes: {
      [N1]: { id: N1, type: 'backend-service', label: 'API Service', technology: 'express', ports: [] },
      [N2]: { id: N2, type: 'database', label: 'Store', technology: 'postgres', ports: [] },
    },
    edges: withEdge
      ? { [E1]: { id: E1, source: N1, target: N2, contractId: C1 } }
      : {},
    contracts: withEdge
      ? { [C1]: { id: C1, kind: 'sql', name: 'API to Store' } }
      : {},
    artifacts: {},
  };
}

// deno-lint-ignore no-explicit-any
// N10(b): the freshness run computes with the LOADED catalogs (empty maps under the
// scripted selects), so a stamp meant to read FRESH must hash the same empty shape.
// deno-lint-ignore no-explicit-any
const EMPTY_CATALOGS: any = { nodeRoles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} };

// deno-lint-ignore no-explicit-any
function managedTaskArtifact(graph: any, staleAgainst: any): any {
  const node = graph.nodes[N1];
  const fp = computeTaskContextFingerprint(
    { id: node.id, label: node.label, type: node.type, technology: node.technology, ports: node.ports },
    staleAgainst,
    [],
    undefined,
    EMPTY_CATALOGS,
  );
  return {
    id: TASK, nodeId: N1, kind: 'task', path: '.nodespec/tasks/api-service.task.md',
    content: 'OLD GENERATED CONTENT', language: 'markdown', status: 'draft',
    metadata: { taskContextFingerprint: fp },
  };
}

function scriptCatalogAndSpec(sb: FakeSupabase) {
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: null, error: null });
}

Deno.test('no task artifacts → empty result, no DB traffic at all', async () => {
  const sb = new FakeSupabase();
  const graph = baseGraph(true);
  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assertEquals(r, {
    checked: 0, refreshed: 0, refreshedPaths: [], skippedUnmanaged: 0,
    testPlansChecked: 0, testPlansRefreshed: 0, testPlansRefreshedPaths: [], testPlansSkippedUnmanaged: 0,
    saves: [],
  });
  assertEquals(sb.calls.length, 0, 'early exit before any load');
});

Deno.test('user-authored task doc (no fingerprint) is never touched — and costs no DB loads', async () => {
  const sb = new FakeSupabase();
  const graph = baseGraph(true);
  graph.artifacts[USER_DOC] = { id: USER_DOC, nodeId: N1, kind: 'task', path: 'docs/my-own-notes.task.md', content: 'HAND WRITTEN', metadata: {} };
  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assertEquals(r.skippedUnmanaged, 1);
  assertEquals(r.checked, 0);
  assertEquals(graph.artifacts[USER_DOC].content, 'HAND WRITTEN', 'provenance guard held');
  assertEquals(sb.calls.length, 0, 'no managed packets → no catalog/spec load');
});

Deno.test('fresh fingerprint → checked but not regenerated; content byte-identical', async () => {
  const sb = new FakeSupabase();
  scriptCatalogAndSpec(sb);
  const graph = baseGraph(true);
  graph.artifacts[TASK] = managedTaskArtifact(graph, graph); // fingerprint computed against CURRENT graph
  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assertEquals(r.checked, 1);
  assertEquals(r.refreshed, 0);
  assertEquals(graph.artifacts[TASK].content, 'OLD GENERATED CONTENT', 'fresh packet untouched');
});

Deno.test('stale fingerprint (edge added since generation) → regenerated in memory, fingerprint advanced', async () => {
  const sb = new FakeSupabase();
  scriptCatalogAndSpec(sb);
  const graph = baseGraph(true);
  // Stored fingerprint was computed when the graph had NO edge — scenario 2's ripple.
  graph.artifacts[TASK] = managedTaskArtifact(graph, baseGraph(false));
  graph.artifacts[USER_DOC] = { id: USER_DOC, nodeId: N2, kind: 'task', path: 'docs/notes.task.md', content: 'HAND WRITTEN', metadata: {} };
  const before = graph.artifacts[TASK].metadata.taskContextFingerprint.fingerprint;

  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assertEquals(r.checked, 1);
  assertEquals(r.refreshed, 1);
  assertEquals(r.refreshedPaths, ['.nodespec/tasks/api-service.task.md']);
  assertEquals(r.skippedUnmanaged, 1);
  const a = graph.artifacts[TASK];
  assert(a.content !== 'OLD GENERATED CONTENT', 'content regenerated');
  assert(a.content.includes('API Service'), 'regenerated doc is the real deterministic doc');
  assert(a.metadata.taskContextFingerprint.fingerprint !== before, 'fingerprint advanced');
  assertEquals(a.metadata.stale, false);
  assertEquals(graph.artifacts[USER_DOC].content, 'HAND WRITTEN', 'unmanaged sibling untouched');
});

Deno.test('fingerprint: requirement CONTENT participates — text edits and met flips are visible', () => {
  // Before 2026-07-21 the server signature was the sorted REQ ids only, so editing a
  // requirement's name/description/criteria never refreshed the packet. `met` is included
  // deliberately: an accepted completion tick must re-render the derived checkboxes.
  const graph = baseGraph(false);
  const node = graph.nodes[N1];
  const nodeForGen = { id: node.id, label: node.label, type: node.type, technology: node.technology, ports: node.ports };
  const base = [{ requirementId: 'REQ-001', name: 'Auth', description: 'd', acceptanceCriteria: [{ text: 'login works', met: false }] }];
  // deno-lint-ignore no-explicit-any
  const fp = (reqs: any) => computeTaskContextFingerprint(nodeForGen as any, graph, reqs).fingerprint;
  assertEquals(fp(base), fp(structuredClone(base)), 'deterministic for identical content');
  assert(fp(base) !== fp([{ ...base[0], description: 'd2' }]), 'description edit changes it');
  assert(fp(base) !== fp([{ ...base[0], acceptanceCriteria: [{ text: 'login MUST work', met: false }] }]), 'criterion text edit changes it');
  assert(fp(base) !== fp([{ ...base[0], acceptanceCriteria: [{ text: 'login works', met: true }] }]), 'met flip changes it');
  assert(fp(['REQ-001']) !== fp(base), 'legacy bare-id form still accepted, distinct from content form');
});

Deno.test('requirement edit alone (criterion met flipped in DB) marks the packet stale at push', async () => {
  const sb = new FakeSupabase();
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: null }, error: null });
  sb.script('specification_mappings', 'select', { data: [{ requirement_id: 'row-1', node_id: N1 }], error: null });
  sb.script('specification_requirements', 'select', {
    data: [{ id: 'row-1', requirement_id: 'REQ-001', name: 'Auth', description: 'd', category: 'functional', status: 'pending', acceptance_criteria: [{ text: 'login works', met: true }] }],
    error: null,
  });

  const graph = baseGraph(true);
  const node = graph.nodes[N1];
  // Stored fingerprint was computed when the criterion was UNMET; the DB now says met.
  const storedFp = computeTaskContextFingerprint(
    // deno-lint-ignore no-explicit-any
    { id: node.id, label: node.label, type: node.type, technology: node.technology, ports: node.ports } as any,
    graph,
    [{ requirementId: 'REQ-001', name: 'Auth', description: 'd', acceptanceCriteria: [{ text: 'login works', met: false }] }],
  );
  graph.artifacts[TASK] = {
    id: TASK, nodeId: N1, kind: 'task', path: '.nodespec/tasks/api-service.task.md',
    content: 'OLD GENERATED CONTENT', language: 'markdown', status: 'draft',
    metadata: { taskContextFingerprint: storedFp },
  };

  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assertEquals(r.checked, 1);
  assertEquals(r.refreshed, 1, 'met flip alone triggers regeneration');
  assert(graph.artifacts[TASK].content.includes('[x] login works'), 'regenerated doc renders the tick from ac.met');
});

// ── R6 (Discovered #9): the vision is packet content, so it is fingerprint content ──

function scriptCatalogAndSpecWithVision(sb: FakeSupabase, vision: string) {
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision }, error: null });
  sb.script('specification_mappings', 'select', { data: [], error: null });
}

// AA.6: a packet carries the vision sentences its node's outcomes cite, and
// its freshness hashes that block (servedVisionText), not the whole vision.
function scriptServedChain(sb: FakeSupabase, sentence: string) {
  sb.script('specification_mappings', 'select', { data: [{ requirement_id: 'r1', node_id: N1 }], error: null });
  sb.script('specification_requirements', 'select', { data: [{ id: 'r1', requirement_id: 'REQ-001', name: 'Auth', description: 'd', category: 'functional', status: 'pending', acceptance_criteria: [] }], error: null });
  sb.script('outcome_derivations', 'select', { data: [{ candidate_id: 'o1', requirement_row_id: 'r1' }], error: null });
  sb.script('requirement_candidates', 'select', { data: [{ id: 'o1', status: 'pending', evidence: { serves: [{ id: visionSentenceId(sentence), text: sentence }] } }], error: null });
}

Deno.test('R6 + AA.6: an edit to a sentence the node serves stales the packet and the regen carries the new words', async () => {
  const sb = new FakeSupabase();
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  // Same sentence id (case and punctuation), new words on the page.
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: 'Tasks for SMALL teams! Nothing else.' }, error: null });
  scriptServedChain(sb, 'Tasks for small teams.');
  const graph = baseGraph(true);
  const node = graph.nodes[N1];
  const reqs = [{ requirementId: 'REQ-001', name: 'Auth', description: 'd', category: 'functional', status: 'pending', acceptanceCriteria: [] }];
  const old = servedSentences('Tasks for small teams. Nothing else.', [{ serves: [visionSentenceId('Tasks for small teams.')] }]);
  const fp = computeTaskContextFingerprint(
    { id: node.id, label: node.label, type: node.type, technology: node.technology, ports: node.ports },
    graph, reqs, servedVisionText(old), EMPTY_CATALOGS,
  );
  graph.artifacts[TASK] = {
    id: TASK, nodeId: N1, kind: 'task', path: '.nodespec/tasks/api-service.task.md',
    content: 'OLD GENERATED CONTENT', language: 'markdown', status: 'draft',
    metadata: { taskContextFingerprint: fp },
  };

  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assertEquals(r.checked, 1);
  assertEquals(r.refreshed, 1, 'the served sentence changed on the page: the packet is stale');
  const a = graph.artifacts[TASK];
  assert(a.content.includes('- Tasks for SMALL teams!'), 'the regenerated packet carries the new words');
  assert(!a.content.includes('Nothing else.'), 'and not the sentence the node does not serve');
  assert(a.metadata.taskContextFingerprint.fingerprint !== fp.fingerprint, 'fingerprint advanced');
});

Deno.test('R6 + AA.6: an edit to a sentence the node does not serve leaves the packet fresh', async () => {
  const sb = new FakeSupabase();
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: 'THE SAME VISION. A reworded second sentence.' }, error: null });
  sb.script('specification_mappings', 'select', { data: [], error: null });
  const graph = baseGraph(true);
  const node = graph.nodes[N1];
  const fp = computeTaskContextFingerprint(
    { id: node.id, label: node.label, type: node.type, technology: node.technology, ports: node.ports },
    graph, [], servedVisionText(servedSentences('THE SAME VISION. The second sentence.', [])), EMPTY_CATALOGS,
  );
  graph.artifacts[TASK] = {
    id: TASK, nodeId: N1, kind: 'task', path: '.nodespec/tasks/api-service.task.md',
    content: 'OLD GENERATED CONTENT', language: 'markdown', status: 'draft',
    metadata: { taskContextFingerprint: fp },
  };
  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assertEquals(r.checked, 1);
  assertEquals(r.refreshed, 0, 'the node serves no sentence, so a vision edit is not its content');
  assertEquals(graph.artifacts[TASK].content, 'OLD GENERATED CONTENT');
});

Deno.test('R6: task fingerprint — vision present vs absent vs changed all hash apart', () => {
  const graph = baseGraph(false);
  const node = graph.nodes[N1];
  const shape = { id: node.id, label: node.label, type: node.type, technology: node.technology, ports: node.ports };
  const none = computeTaskContextFingerprint(shape, graph, []);
  const a = computeTaskContextFingerprint(shape, graph, [], 'vision A');
  const a2 = computeTaskContextFingerprint(shape, graph, [], 'vision A');
  const b = computeTaskContextFingerprint(shape, graph, [], 'vision B');
  assert(none.fingerprint !== a.fingerprint, 'absent vs present differ');
  assertEquals(a.fingerprint, a2.fingerprint, 'deterministic');
  assert(a.fingerprint !== b.fingerprint, 'edits move it');
  assertEquals(none.fields.visionHash, '');
});

Deno.test('catalog load failure → error reported, nothing mutated, never throws', async () => {
  const sb = new FakeSupabase();
  sb.script('node_roles', 'select', { data: null, error: { message: 'catalog down' } });
  for (const t of ['technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  const graph = baseGraph(true);
  graph.artifacts[TASK] = managedTaskArtifact(graph, baseGraph(false)); // stale, would regenerate
  const r = await refreshTaskPackets(sb as never, 'proj-1', graph);
  assert(r.error?.includes('node_roles'), 'failure surfaced, not thrown');
  assertEquals(graph.artifacts[TASK].content, 'OLD GENERATED CONTENT', 'no partial mutation on failure');
});

// ── Configuration participates in freshness (owner-directed 2026-07-30) ──────────
// Found while fixing the "can't click AI Decides" toggle: the packet RENDERS
// configuration three ways (values block / delegation statement / unchosen
// placeholder) but the fingerprint covered none of it, so a config edit shipped a
// stale task doc on the next commit. The signature is content-equivalent BY
// CONSTRUCTION — it moves only when the rendered text moves.

// deno-lint-ignore no-explicit-any
function nodeWith(metadata: any): any {
  return { id: N1, label: 'API Service', type: 'backend-service', technology: 'express', ports: [], metadata };
}
// deno-lint-ignore no-explicit-any
const fpOf = (metadata: any) => computeTaskContextFingerprint(nodeWith(metadata), baseGraph(true), []).fingerprint;

Deno.test('config VALUES are covered: editing a value stales the packet', () => {
  const before = fpOf({ configSource: 'manual', config: { memory: 512 } });
  const after = fpOf({ configSource: 'manual', config: { memory: 1024 } });
  assert(before !== after, 'a changed config value must move the fingerprint');
});

Deno.test('the CHOICE is covered: delegating stales the packet', () => {
  const specified = fpOf({ configSource: 'manual', config: { memory: 512 } });
  const delegated = fpOf({ configSource: 'ai', config: { memory: 512 } });
  assert(specified !== delegated, 'manual → AI decides changes what the packet says');
});

Deno.test('no spurious staleness: dormant values under delegation do not move it', () => {
  // Delegated packets render neither the values nor a values block, so changing
  // them changes no rendered text — regenerating would be pure churn.
  const a = fpOf({ configSource: 'ai', config: { memory: 512 } });
  const b = fpOf({ configSource: 'ai', config: { memory: 1024 } });
  assertEquals(a, b, 'dormant values render nowhere — they must not stale the packet');
});

Deno.test('no spurious staleness: config key ORDER is irrelevant', () => {
  const a = fpOf({ configSource: 'manual', config: { alpha: 1, beta: { x: 1, y: 2 } } });
  const b = fpOf({ configSource: 'manual', config: { beta: { y: 2, x: 1 }, alpha: 1 } });
  assertEquals(a, b, 'stable serialization at every depth');
});

Deno.test('unchosen and "I\'ll specify with nothing typed" hash alike (same placeholder)', () => {
  assertEquals(fpOf({}), fpOf({ configSource: 'manual' }), 'both render the unchosen placeholder');
  assertEquals(fpOf({}), fpOf({ configSource: 'manual', config: {} }));
});

Deno.test('legacy node (values, no recorded choice) is covered like user-specified', () => {
  const legacy = fpOf({ config: { memory: 512 } });
  assertEquals(legacy, fpOf({ configSource: 'manual', config: { memory: 512 } }), 'same rendered packet, same signature');
  assert(legacy !== fpOf({}), 'and it is distinct from unchosen');
});

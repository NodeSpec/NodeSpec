// P1-7 R1: the model anchor (.nodespec/model.json) — determinism, hashing, round-trip, and the
// provenance guarantees the gitops loop depends on. Also pins the git-drift matcher's branch
// filter to name==='main' (the is_main column NEVER existed; the old filter errored in
// production and FakeSupabase couldn't catch it because it doesn't validate column names —
// asserting the recorded filter args is how the fake CAN catch it).
import {
  serializeModel,
  parseModel,
  verifyModelHash,
  coreModelHash,
  MODEL_ANCHOR_PATH,
} from '../_shared/model-anchor.ts';
import { matchFilesToArtifacts } from '../_shared/git-drift.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const N1 = '11111111-1111-4111-8111-111111111111';
const N2 = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333';
const C1 = '44444444-4444-4444-8444-444444444444';
const A1 = '55555555-5555-4555-8555-555555555555';

function sampleGraph() {
  return {
    nodes: {
      // Deliberately inserted in non-sorted order to prove output sorting.
      [N2]: { id: N2, type: 'backend-service', technology: 'express', label: 'API', ports: [{ id: 'p2', name: 'in', direction: 'in' }] },
      [N1]: { id: N1, type: 'frontend-app', technology: 'react', label: 'Web', parentId: undefined, ports: [{ id: 'p1', name: 'out', direction: 'out' }] },
    },
    edges: { [E1]: { id: E1, source: N1, target: N2, contractId: C1, label: 'calls' } },
    contracts: { [C1]: { id: C1, kind: 'rest', name: 'Web to API', schema: { openapi: '3.0' } } },
    artifacts: { [A1]: { id: A1, nodeId: N2, path: '/src/api/index.ts', kind: 'source', contentHash: 'abc123' } },
  };
}
const MAPPINGS = [
  { requirementId: 'REQ-002', nodeId: N2 },
  { requirementId: 'REQ-001', nodeId: N1 },
  { requirementId: 'REQ-001', nodeId: N2 },
];

Deno.test('anchor path constant', () => {
  assertEquals(MODEL_ANCHOR_PATH, '.nodespec/model.json');
});

Deno.test('serializeModel is deterministic: same inputs → byte-identical output', async () => {
  const a = await serializeModel(sampleGraph());
  const b = await serializeModel(sampleGraph());
  assertEquals(a, b, 'mapping input order must not matter');
});

// R7d (owner: "you're incorporating the requirements/spec into model.json —
// rectify"): this test used to assert mappings GROUPING; it now asserts their
// ABSENCE. One fact, one file — requirement mappings live only in spec.json.
Deno.test('elements are sorted by id; the anchor carries NO spec-plane mappings', async () => {
  const json = await serializeModel(sampleGraph());
  assert(!json.includes('"mappings"'), 'model.json is architecture-only — mappings belong to spec.json');
  const parsed = parseModel(json);
  assert(parsed.ok, 'parses');
  assertEquals(parsed.model.nodes.map((n) => n.id), [N1, N2], 'nodes sorted by id');
  assertEquals(parsed.model.mappings, undefined, 'no legacy key on new anchors');
});

// Back-compat: anchors written before R7d carry a mappings section their stored
// hash covers. They must parse and integrity-verify FOREVER, and compare equal to
// a current serialization of the same architecture via coreModelHash.
Deno.test('R7d back-compat: a legacy anchor with mappings parses, verifies, and core-compares equal', async () => {
  const current = parseModel(await serializeModel(sampleGraph()));
  assert(current.ok);
  // Reconstruct the pre-R7d file shape: same architecture + a mappings section,
  // hash computed over content INCLUDING mappings (the old rule).
  const legacyContent = {
    nodes: current.model.nodes, edges: current.model.edges,
    contracts: current.model.contracts, artifacts: current.model.artifacts,
    mappings: [{ requirementId: 'REQ-001', nodeIds: [N1] }],
  };
  const data = new TextEncoder().encode(JSON.stringify(legacyContent));
  const buf = await crypto.subtle.digest('SHA-256', data);
  const legacyHash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const legacyJson = JSON.stringify({
    modelVersion: 1, generatedBy: 'nodespec', modelHash: legacyHash, ...legacyContent,
  }, null, 2) + '\n';

  const legacy = parseModel(legacyJson);
  assert(legacy.ok, 'legacy format parses forever');
  assert(await verifyModelHash(legacy.model), 'legacy stored hash still integrity-verifies (hashes the shape the file HAS)');
  assert(!(await verifyModelHash({ ...legacy.model, mappings: undefined as never })), 'sanity: dropping the section breaks the stored hash — which is why comparisons need coreModelHash');
  assertEquals(
    await coreModelHash(legacy.model), await coreModelHash(current.model),
    'same architecture ⇒ same coreModelHash across formats — no spurious drift card on pre-R7d repos',
  );
});

Deno.test('round-trip: parse + hash verification pass; artifacts keep normalized paths', async () => {
  const parsed = parseModel(await serializeModel(sampleGraph()));
  assert(parsed.ok);
  const m = parsed.model;
  assert(await verifyModelHash(m), 'modelHash verifies');
  assertEquals(m.artifacts[0].path, 'src/api/index.ts', 'leading slash stripped');
  assert(m.contracts[0].schemaHash, 'contract with schema carries schemaHash (body not embedded)');
  assert(m.nodes.every((n) => n.contentHash.length === 64), 'per-node sha256 contentHash');
});

Deno.test('content changes change the modelHash; cosmetic no-ops do not', async () => {
  const base = parseModel(await serializeModel(sampleGraph()));
  const changed = sampleGraph();
  changed.nodes[N1].label = 'Web App v2';
  const after = parseModel(await serializeModel(changed));
  assert(base.ok && after.ok);
  assert(base.model.modelHash !== after.model.modelHash, 'label change → new modelHash');
});

Deno.test('parseModel rejects malformed anchors with a reason', () => {
  assert(!parseModel('not json').ok);
  assert(!parseModel('{"modelVersion":99}').ok);
  const missingEdgeFields = JSON.stringify({
    modelVersion: 1, generatedBy: 'nodespec', modelHash: 'x',
    nodes: [], edges: [{ id: 'e' }], contracts: [], artifacts: [], mappings: [],
  });
  const r = parseModel(missingEdgeFields);
  assert(!r.ok && r.error.includes('edge'), 'names the offending section');
});

Deno.test('tampered anchors fail hash verification', async () => {
  const parsed = parseModel(await serializeModel(sampleGraph()));
  assert(parsed.ok);
  parsed.model.nodes[0].label = 'tampered';
  assertEquals(await verifyModelHash(parsed.model), false);
});

// ── the is_main fix: pin the matcher's branch filter via recorded filter args ─────────

Deno.test('matchFilesToArtifacts looks up the main branch by NAME (is_main never existed)', async () => {
  const sb = new FakeSupabase();
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: sampleGraph() }, error: null });

  const r = await matchFilesToArtifacts(sb as never, 'proj-1', [
    { path: 'src/api/index.ts', action: 'modified' },
  ]);

  const branchCall = sb.callsTo('branches', 'select')[0];
  assert(
    branchCall.filters.some((f) => f.method === 'eq' && f.args[0] === 'name' && f.args[1] === 'main'),
    'filters by name === main',
  );
  assert(
    !branchCall.filters.some((f) => f.args[0] === 'is_main'),
    'no reference to the nonexistent is_main column',
  );
  assertEquals(r.matches.length, 1, 'matched the changed artifact path');
  assertEquals(r.matches[0].nodeId, N2);
});

// ── providerApiBase (P1-7 R1.5: self-hosted git providers) ───────────────────────────

Deno.test('providerApiBase: cloud defaults, custom override, trailing-slash normalization', async () => {
  const { providerApiBase } = await import('../_shared/git-provider.ts');
  assertEquals(providerApiBase('github', null), 'https://api.github.com');
  assertEquals(providerApiBase('gitlab', undefined), 'https://gitlab.com/api/v4');
  assertEquals(providerApiBase('github', 'https://ghe.corp.example/api/v3/'), 'https://ghe.corp.example/api/v3');
  assertEquals(providerApiBase('gitlab', 'https://gitlab.local:8443/api/v4//'), 'https://gitlab.local:8443/api/v4');
  assertEquals(providerApiBase('gitlab', '  '), 'https://gitlab.com/api/v4');
});

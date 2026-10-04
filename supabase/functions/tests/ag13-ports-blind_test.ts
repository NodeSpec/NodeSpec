// AG.13 (owner 2026-09-28, "drop the ports and simplify"): ports never make
// two designs differ. A model.json an earlier release wrote with ports
// (version 2) and the same design written now (version 3, no ports) compare
// equal on every Git lane (the drift check, the push guard, the connect check
// and the diff), and neither a load nor an adopt writes ports.
import { anchorLoadPatches } from '../_shared/anchor-load.ts';
import {
  anchorToPatches, coreModelHash, diffAnchors, MODEL_ANCHOR_VERSION, parseModel, sameDesign, serializeModel,
  SUPPORTED_MODEL_VERSIONS, type ModelAnchor,
} from '../_shared/model-anchor.ts';
import { assert, assertEquals } from './helpers.ts';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PA = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const PB = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const K = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const E1 = '12121212-1212-4212-8212-121212121212';
const E2 = '13131313-1313-4313-8313-131313131313';
const NOW = '2026-09-28T12:00:00.000Z';

// deno-lint-ignore no-explicit-any
type G = any;

/** The design as a canvas stored it before ports came out. */
function withPorts(): G {
  return {
    nodes: {
      [A]: { id: A, type: 'backend-service', label: 'Orders API', technology: 'node', ports: [{ id: PA, name: 'out', direction: 'out' }], metadata: { config: { region: 'eu-west-1' }, configSource: 'manual' } },
      [B]: { id: B, type: 'database', label: 'Orders DB', ports: [{ id: PB, name: 'in', direction: 'in' }], metadata: {} },
    },
    edges: { [E1]: { id: E1, source: A, target: B, contractId: K, sourcePortId: PA, targetPortId: PB, label: 'writes' } },
    contracts: { [K]: { id: K, kind: 'data', name: 'orders' } },
    artifacts: {},
  };
}

/** The same design with no ports anywhere. */
function withoutPorts(): G {
  const g = withPorts();
  for (const n of Object.values(g.nodes) as G[]) delete n.ports;
  for (const e of Object.values(g.edges) as G[]) { delete e.sourcePortId; delete e.targetPortId; }
  return g;
}

async function anchorOf(g: G): Promise<ModelAnchor> {
  const parsed = parseModel(await serializeModel(g));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.model;
}

/** The file an earlier release wrote for the same design: version 2, each
 *  node's ports and each edge's port ids in it (their contentHash left as
 *  written now, which comparisons leave out). */
async function legacyV2Of(g: G): Promise<ModelAnchor> {
  const raw = JSON.parse(await serializeModel(g));
  raw.modelVersion = 2;
  for (const n of raw.nodes) n.ports = (g.nodes[n.id].ports ?? []).map((p: G) => ({ id: p.id, name: p.name, direction: p.direction }));
  for (const e of raw.edges) {
    if (g.edges[e.id].sourcePortId) e.sourcePortId = g.edges[e.id].sourcePortId;
    if (g.edges[e.id].targetPortId) e.targetPortId = g.edges[e.id].targetPortId;
  }
  const parsed = parseModel(JSON.stringify(raw));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.model;
}

Deno.test('AG.13: a file written with ports and the same design written now are the same design', async () => {
  const before = await legacyV2Of(withPorts());
  const after = await anchorOf(withoutPorts());
  assert(JSON.stringify(before) !== JSON.stringify(after), 'the two files differ in their ports and version');
  assertEquals(await sameDesign(before, after), true, 'the drift check and the push guard see no change');
  assertEquals(await coreModelHash(before), await coreModelHash(after), 'the architecture hash ignores ports');
  assertEquals(diffAnchors(before, after).identical, true, 'the diff shows no change');
});

Deno.test('AG.13: model.json is written as version 3, with no ports even from a canvas that stored them', async () => {
  assertEquals(MODEL_ANCHOR_VERSION, 3);
  const text = await serializeModel(withPorts());
  assertEquals(JSON.parse(text).modelVersion, 3);
  assert(!text.includes('"ports"'), 'no node ports');
  assert(!text.includes('PortId'), 'no edge port ids');
  assertEquals(text, await serializeModel(withoutPorts()), 'the stored ports change nothing in the file');
});

Deno.test('AG.13: a real change still reads as one, with or without ports', async () => {
  const changed = withoutPorts();
  changed.nodes[A].label = 'Orders Service';
  changed.edges[E1].label = 'reads';
  const before = await legacyV2Of(withPorts());
  const after = await anchorOf(changed);
  assertEquals(await sameDesign(before, after), false);
  assert(await coreModelHash(before) !== await coreModelHash(after), 'a label is architecture');
  const diff = diffAnchors(before, after);
  assertEquals(diff.nodes.changed.map((d) => d.id), [A]);
  assertEquals(diff.edges.changed.map((d) => d.id), [E1]);
});

Deno.test('AG.13: every version still parses', () => {
  assertEquals([...SUPPORTED_MODEL_VERSIONS], [1, 2, 3]);
});

Deno.test('AG.13: a load names no port change and writes no ports', async () => {
  // Git still carries ports (version 2); the canvas stored none.
  const repo = await legacyV2Of(withPorts());
  const same = await anchorLoadPatches(withoutPorts(), repo, { actorId: 'git-load', sourceCommit: 'c'.repeat(40), nowIso: NOW });
  assertEquals(same.patches, [], 'nothing to load');
  assertEquals(same.notApplied, [], 'no "git cleared its port" notes');

  // A version 3 file against a canvas that still stores ports: nothing either.
  const v3 = await anchorOf(withoutPorts());
  const legacy = await anchorLoadPatches(withPorts(), v3, { actorId: 'git-load', sourceCommit: 'c'.repeat(40), nowIso: NOW });
  assertEquals(legacy.patches, []);
  assertEquals(legacy.notApplied, []);

  // Git adds a node and an edge carrying ports: they land without them.
  const grown = withPorts();
  grown.nodes[C] = { id: C, type: 'backend-service', label: 'Billing', ports: [{ id: 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', name: 'out', direction: 'out' }], metadata: {} };
  grown.edges[E2] = { id: E2, source: C, target: B, contractId: K, sourcePortId: 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', targetPortId: PB };
  const plan = await anchorLoadPatches(withoutPorts(), await legacyV2Of(grown), { actorId: 'git-load', sourceCommit: 'c'.repeat(40), nowIso: NOW });
  assertEquals(plan.patches.map((p) => p.type).sort(), ['add_edge', 'add_node']);
  assert(!JSON.stringify(plan.patches).includes('"ports"'), 'no ports');
  assert(!JSON.stringify(plan.patches).includes('PortId'), 'no port ids');
});

Deno.test('AG.13: an adopt writes no ports', async () => {
  const patches = anchorToPatches(await legacyV2Of(withPorts()), 'git-adopt');
  assertEquals(patches.filter((p) => p.type === 'add_node').length, 2);
  assertEquals(patches.filter((p) => p.type === 'add_edge').length, 1);
  assert(!JSON.stringify(patches).includes('"ports"'), 'no ports');
  assert(!JSON.stringify(patches).includes('PortId'), 'no port ids');
});

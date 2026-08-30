// Fix (2026-07-15): requirement→node mappings are spec-global but nodes are branch-local, so
// a mapping can reference a node deleted from (or never present on) the branch being read. The
// read path must drop those. This pins the pure liveness helpers; the assembly module that
// calls them can't import in the offline harness (transitive value jsr imports), so its wiring
// is bench-verified.
import {
  liveNodeIdSet,
  filterMappingsToLiveNodes,
  pruneRequirementNodeMap,
} from '../_shared/mapping-liveness.ts';
import { assert, assertEquals } from './helpers.ts';

Deno.test('liveNodeIdSet: keys of the graph node map; empty/nullish → empty set', () => {
  assertEquals([...liveNodeIdSet({ a: {}, b: {} })].sort(), ['a', 'b']);
  assertEquals(liveNodeIdSet(null).size, 0);
  assertEquals(liveNodeIdSet(undefined).size, 0);
  assertEquals(liveNodeIdSet({}).size, 0);
});

Deno.test('filterMappingsToLiveNodes: drops mappings whose node_id is not live', () => {
  const live = liveNodeIdSet({ live1: {}, live2: {} });
  const mappings = [
    { node_id: 'live1', requirement_id: 'r1' },
    { node_id: 'dead1', requirement_id: 'r1' },
    { node_id: 'live2', requirement_id: 'r2' },
  ];
  const kept = filterMappingsToLiveNodes(mappings, live);
  assertEquals(kept.map((m) => m.node_id), ['live1', 'live2']);
});

Deno.test('filterMappingsToLiveNodes: empty live set drops everything', () => {
  const mappings = [{ node_id: 'a' }, { node_id: 'b' }];
  assertEquals(filterMappingsToLiveNodes(mappings, new Set()).length, 0);
});

Deno.test('pruneRequirementNodeMap: keeps only live node ids, drops emptied requirements', () => {
  const live = liveNodeIdSet({ n1: {}, n3: {} });
  const map = {
    'REQ-001': ['n1', 'n2'], // n2 dead → keep [n1]
    'REQ-002': ['n2'],       // all dead → dropped entirely
    'REQ-003': ['n3'],       // all live → unchanged
  };
  const pruned = pruneRequirementNodeMap(map, live);
  assertEquals(pruned, { 'REQ-001': ['n1'], 'REQ-003': ['n3'] });
});

Deno.test('pruneRequirementNodeMap: does not mutate the input map', () => {
  const live = liveNodeIdSet({ n1: {} });
  const map = { 'REQ-001': ['n1', 'n2'] };
  pruneRequirementNodeMap(map, live);
  assertEquals(map, { 'REQ-001': ['n1', 'n2'] }, 'original untouched');
});

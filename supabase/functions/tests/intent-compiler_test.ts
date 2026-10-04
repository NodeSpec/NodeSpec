// V3 3.1 (2026-09-19): each intent kind compiles to the patch batch the agent
// would otherwise hand-assemble, in the order the batch rules demand, with
// the ids it minted named back. Errors name the intent and the field.
import { compileIntent, compileIntents, intentsTitle } from '../_shared/intent-compiler.ts';
import { assert, assertEquals } from './helpers.ts';

const BRANCH = '22222222-2222-4222-8222-222222222222';
const N1 = '33333333-3333-4333-8333-333333333333';
const N2 = '44444444-4444-4444-8444-444444444444';
const C1 = '55555555-5555-4555-8555-555555555555';
const E1 = '66666666-6666-4666-8666-666666666666';
const CAND = '77777777-7777-4777-8777-777777777777';
const STEP = '88888888-8888-4888-8888-888888888888';
function ctx() { let n = 0; return { branchId: BRANCH, newId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, '0')}` }; }

Deno.test('add_node: one add_node patch with a minted id; description rides metadata', () => {
  const c = compileIntent({ kind: 'add_node', label: 'Cache', type: 'cache', technology: 'redis', description: 'hot reads' }, 0, ctx());
  assert(!('error' in c), JSON.stringify(c));
  assertEquals(c.patches, [{ type: 'add_node', payload: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', type: 'cache', label: 'Cache', technology: 'redis', metadata: { description: 'hot reads' } } }]);
  assertEquals(c.ids, { nodeId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001' });
  assertEquals(c.summary, 'add a node "Cache" (cache, redis)');
  const bad = compileIntent({ kind: 'add_node', label: 'Cache' }, 2, ctx());
  assert('error' in bad && bad.error.startsWith('intent[2] (add_node): type is required'), JSON.stringify(bad));
});

Deno.test('connect_nodes: contract first, then the edge that references it; an existing contract compiles to the edge alone', () => {
  const c = compileIntent({ kind: 'connect_nodes', source: N1, target: N2, sourceLabel: 'API', targetLabel: 'Cache', contract: { kind: 'rest', name: 'Cache API', schema: { get: '/v' } } }, 0, ctx());
  assert(!('error' in c), JSON.stringify(c));
  assertEquals(c.patches.map((p) => p.type), ['add_contract', 'add_edge']);
  assertEquals(c.patches[0].payload, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', kind: 'rest', name: 'Cache API', schema: { get: '/v' } });
  assertEquals(c.patches[1].payload, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', source: N1, target: N2, contractId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002' });
  assertEquals(c.summary, 'connect "API" to "Cache" over a rest contract "Cache API"');
  const existing = compileIntent({ kind: 'connect_nodes', source: N1, target: N2, contract: { id: C1 } }, 0, ctx());
  assert(!('error' in existing));
  assertEquals(existing.patches.map((p) => p.type), ['add_edge']);
  assertEquals((existing.patches[0].payload as { contractId: string }).contractId, C1);
  const same = compileIntent({ kind: 'connect_nodes', source: N1, target: N1, contract: { id: C1 } }, 1, ctx());
  assert('error' in same && same.error.includes('must differ'));
});

Deno.test('split_node is retired into explode_node and kept as its alias (AA.3): it needs the graph, and compiles as an explode', () => {
  // Without the graph (the caller loads it for these kinds) nothing compiles.
  const blind = compileIntent({ kind: 'split_node', nodeId: N1, into: [{ label: 'Orders', type: 'part-handler', why: 'routes' }] }, 0, ctx());
  assert('error' in blind && blind.error.startsWith('intent[0] (split_node): the graph could not be read'), JSON.stringify(blind));
  const explode = {
    nodes: { [N1]: { id: N1, type: 'backend-service', label: 'Monolith' }, [N2]: { id: N2, type: 'frontend-app', label: 'Web' } },
    edges: { [E1]: { id: E1, source: N2, target: N1, contractId: C1 } },
    artifacts: {}, indexed: [], imports: [], proofs: [],
    partsOf: (r: string) => (r === 'backend-service' ? ['part-handler', 'part-module'] : []),
    isPart: (r: string) => r.startsWith('part-'),
  };
  const c = compileIntent({ kind: 'split_node', nodeId: N1, into: [
    { label: 'Orders', type: 'part-handler', why: 'the order routes', takes: [{ edgeId: E1, side: 'target' }] },
    { label: 'Billing', type: 'part-module', why: 'the billing rules' },
  ] }, 0, { ...ctx(), explode });
  assert(!('error' in c), JSON.stringify(c));
  assertEquals(c.kind, 'explode_node');
  assertEquals(c.patches.map((p) => p.type), ['add_node', 'update_edge', 'add_node']);
  assertEquals((c.patches[0].payload as { parentId: string }).parentId, N1, 'a part is a child of the node, not a sibling');
  assertEquals(c.patches[1].payload, { id: E1, changes: { target: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001' } });
  assertEquals(c.summary, 'explode "Monolith" into "Orders", "Billing"');
  const bad = compileIntent({ kind: 'split_node', nodeId: N1, into: [{ label: 'X', type: 'part-handler', why: 'x', takes: [{ edgeId: E1, side: 'source' }] }] }, 0, { ...ctx(), explode });
  assert('error' in bad && bad.error.includes('has its target on "Monolith", not its source'), JSON.stringify(bad));
});

Deno.test('set_contract_schema and place_on_step compile to one op each; the step map carries the branch', () => {
  const s = compileIntent({ kind: 'set_contract_schema', contractId: C1, contractName: 'Cache API', schema: { get: '/v' }, specFormat: 'openapi' }, 0, ctx());
  assert(!('error' in s));
  assertEquals(s.patches, [{ type: 'update_contract', payload: { id: C1, changes: { schema: { get: '/v' }, specFormat: 'openapi' } } }]);
  const empty = compileIntent({ kind: 'set_contract_schema', contractId: C1, schema: {} }, 0, ctx());
  assert('error' in empty && empty.error.includes('non-empty JSON object'));
  const p = compileIntent({ kind: 'place_on_step', candidateId: CAND, candidateName: 'Export', stepIds: [STEP] }, 0, ctx());
  assert(!('error' in p));
  assertEquals(p.patches, [{ type: 'set_outcome_step_maps', payload: { candidateId: CAND, branchId: BRANCH, stepIds: [STEP] } }]);
  assertEquals(p.summary, 'place outcome "Export" on 1 step');
});

Deno.test('compileIntents: patches in intent order with their origins; an unknown kind names the choices; the title reads as a sentence', () => {
  const batch = compileIntents([
    { kind: 'add_node', label: 'Cache', type: 'cache' },
    { kind: 'connect_nodes', source: N1, target: N2, contract: { kind: 'rest', name: 'Cache API' } },
  ], ctx());
  assert(!('error' in batch));
  assertEquals(batch.patches.map((p) => p.type), ['add_node', 'add_contract', 'add_edge']);
  assertEquals(batch.originOf, [0, 1, 1]);
  assertEquals(batch.explanations.length, 3);
  const bad = compileIntents([{ kind: 'rename_node' }], ctx());
  assert('error' in bad && bad.error.includes('Expected one of add_node | connect_nodes'), JSON.stringify(bad));
  assertEquals(intentsTitle(batch.intents), 'Wants to add a node "Cache" (cache), and connect "' + N1 + '" to "' + N2 + '" over a rest contract "Cache API"');
  assertEquals(intentsTitle([]), null);
});

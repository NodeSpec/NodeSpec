// AA.3 (owner 2026-09-23): the depth rule on the app side. A node may have a
// child only if its role lists the child's role in can_contain; a part lives
// only under a role naming it, and holds nothing. Checked by the containment
// rule every placement uses (canContainerHoldNode), by the patch engine on a
// new write (never on a replay of the patch log, which applies history as it
// was written), and by the validator.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canContainerHoldNode, depthRuleRefusal, populateContainerTypes, setRoleResolver,
  type ContainerTypeDefinition, type RoleInfo,
} from '@nodespec/core/container-types.js';
import { applyPatches, validatePatch } from '@nodespec/core/patch-engine.js';
import { createAddNodePatch, createUpdateNodePatch } from '@nodespec/core/patch-factory.js';
import { createEmptyGraph } from '@nodespec/core/utils.js';
import { VALIDATION_RULES } from '@nodespec/core/validation/rules.js';
import type { Graph, Node } from '@nodespec/core/types.js';

const ROLES: Record<string, RoleInfo> = {
  'backend-service': { id: 'backend-service', nature: 'build', provider: null, isContainer: false, canContain: ['part-handler', 'part-worker', 'part-repository', 'part-module'] },
  database: { id: 'database', nature: 'build', provider: null, isContainer: false, canContain: ['part-table-group'] },
  'api-gateway': { id: 'api-gateway', nature: 'build', provider: null, isContainer: false, canContain: [] },
  'part-handler': { id: 'part-handler', nature: 'build', provider: null, isContainer: false, canContain: [], isPart: true },
  'part-module': { id: 'part-module', nature: 'build', provider: null, isContainer: false, canContain: [], isPart: true },
  'part-table-group': { id: 'part-table-group', nature: 'build', provider: null, isContainer: false, canContain: [], isPart: true },
  'docker-container': { id: 'docker-container', nature: 'build', provider: null, isContainer: true, containerStyle: 'hosting', treatmentMode: 'container', canContain: ['backend-service', 'database'] },
  aws: { id: 'aws', nature: 'host', provider: 'aws', isContainer: true, containerStyle: 'hosting', treatmentMode: 'container', canContain: { natures: ['build'], providers: ['aws'] } },
  // A resolver that does not carry can_contain for a role: the old behaviour holds.
  'legacy-leaf': { id: 'legacy-leaf', nature: 'build', provider: null, isContainer: false },
};

const CONTAINERS: ContainerTypeDefinition[] = [
  { id: 'docker-container', label: 'Docker', layer: 'runtime', containerStyle: 'hosting', canContain: ['backend-service', 'database'] } as unknown as ContainerTypeDefinition,
  { id: 'aws', label: 'AWS', layer: 'infrastructure', containerStyle: 'hosting', canContain: { natures: ['build'], providers: ['aws'] } } as unknown as ContainerTypeDefinition,
];

const API = '00000000-0000-4000-8000-000000000001';
const HANDLER = '00000000-0000-4000-8000-000000000002';
const NEW = '00000000-0000-4000-8000-000000000003';
const opts = { actorType: 'human' as const, summary: 'test' };

const node = (id: string, type: string, label: string, parentId?: string): Node =>
  ({ id, type, label, data: {}, metadata: {}, ...(parentId ? { parentId } : {}) }) as Node;

function graph(): Graph {
  const g = createEmptyGraph();
  g.nodes[API] = node(API, 'backend-service', 'Checkout API');
  g.nodes[HANDLER] = node(HANDLER, 'part-handler', 'Routes', API);
  return g;
}

beforeEach(() => {
  populateContainerTypes(CONTAINERS);
  setRoleResolver((id) => ROLES[id] ?? null);
});
afterEach(() => setRoleResolver(null));

describe('AA.3 the depth rule', () => {
  it('a node that is not a container holds only the parts its role lists', () => {
    expect(canContainerHoldNode('backend-service', 'part-handler')).toBe(true);
    expect(canContainerHoldNode('database', 'part-table-group')).toBe(true);
    // The hole it closes: `if (!containerDef) return true` let a leaf hold anything.
    expect(canContainerHoldNode('backend-service', 'database')).toBe(false);
    expect(depthRuleRefusal('backend-service', 'database')).toContain('holds only its parts (part-handler, part-worker, part-repository, part-module)');
    expect(canContainerHoldNode('api-gateway', 'backend-service')).toBe(false);
    expect(depthRuleRefusal('api-gateway', 'backend-service')).toContain('lists no parts');
  });

  it('a part holds nothing and lives only under a role naming it', () => {
    expect(canContainerHoldNode('part-handler', 'part-module')).toBe(false);
    expect(canContainerHoldNode('database', 'part-handler')).toBe(false);
    expect(canContainerHoldNode('docker-container', 'part-handler')).toBe(false);
    // aws admits 'build' by nature; a part is 'build' and is still refused.
    expect(canContainerHoldNode('aws', 'part-module')).toBe(false);
    expect(depthRuleRefusal('aws', 'part-module')).toContain('is a part');
  });

  it('containers keep their own rules, and an unknown role is never refused by it', () => {
    expect(canContainerHoldNode('docker-container', 'backend-service')).toBe(true);
    expect(canContainerHoldNode('docker-container', 'api-gateway')).toBe(false);
    expect(depthRuleRefusal('no-such-role', 'database')).toBeNull();
    expect(canContainerHoldNode('no-such-role', 'database')).toBe(true);
    // A resolver that carries no can_contain for the parent: permissive, as before.
    expect(canContainerHoldNode('legacy-leaf', 'database')).toBe(true);
    // Before the catalog loads there is no resolver at all.
    setRoleResolver(null);
    expect(depthRuleRefusal('backend-service', 'database')).toBeNull();
  });
});

describe('AA.3 the patch engine: a new write is checked, a replay is not', () => {
  it('refuses add_node under a parent whose role does not list it, on a new write', () => {
    const add = createAddNodePatch(node(NEW, 'database', 'Orders', API), opts);
    const r = validatePatch(graph(), add, { placement: true });
    expect(r.valid).toBe(false);
    expect(r.errors[0].code).toBe('PLACEMENT_REFUSED');
    expect(r.errors[0].message).toContain('"Checkout API" cannot hold');
    expect(validatePatch(graph(), createAddNodePatch(node(NEW, 'part-module', 'Pricing', API), opts), { placement: true }).valid).toBe(true);
  });

  it('refuses update_node moving a node under a part', () => {
    const move = createUpdateNodePatch(API, { parentId: HANDLER }, opts);
    const r = validatePatch(graph(), move, { placement: true });
    expect(r.valid).toBe(false);
    expect(r.errors[0].path).toBe(`nodes.${API}.parentId`);
  });

  it('replays history as it was written: the same patch applies without the option', () => {
    const add = createAddNodePatch(node(NEW, 'database', 'Orders', API), opts);
    expect(validatePatch(graph(), add).valid).toBe(true);
    const replay = applyPatches(graph(), [add]);
    expect(replay.success).toBe(true);
    expect(replay.graph?.nodes[NEW]?.parentId).toBe(API);
  });
});

describe('AA.3 the validator', () => {
  const rule = VALIDATION_RULES.find((r) => r.id === 'containment-mismatch')!;
  const check = (g: Graph, id: string) => rule.check({ graph: g, node: g.nodes[id], allArtifacts: new Map(), allEdges: [] });

  it('flags a node inside a parent whose role does not list it, and passes a listed part', () => {
    const g = graph();
    g.nodes[NEW] = node(NEW, 'database', 'Orders', API);
    expect(check(g, NEW)).toHaveLength(1);
    expect(check(g, NEW)[0].severity).toBe('error');
    expect(check(g, HANDLER)).toHaveLength(0);
  });
});

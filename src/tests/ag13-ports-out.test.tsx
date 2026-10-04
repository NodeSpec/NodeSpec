// @vitest-environment jsdom
// AG.13 (owner 2026-09-28, "drop the ports and simplify"): nothing the app
// writes carries ports, a proposal filed before ports came out lands without
// them, and the canvas draws its handles from the component. Stored history is
// never rewritten: the engine still replays every old port patch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import './fixtures/legacy-node-type-fixture.js';
import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import { nodeTypes } from '../ui/components/nodes/SpecializedNodes.js';
import { ProposalService } from '../ui/services/ProposalService.js';
import { buildNodePatchesFromRole } from '../ui/utils/node-creation.js';
import type { PersistenceService } from '../ui/services/PersistenceService.js';
import type { NodeRole } from '../persistence/supabase/catalog-repository.js';
import type { PersistedPatch } from '../persistence/types.js';
import type { AIProposal } from '@nodespec/core/ai-proposal.js';
import { applyPatches } from '@nodespec/core/patch-engine.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import { createAddNodePatch, createNodeFromTemplatePatch, createPatchMetadata } from '@nodespec/core/patch-factory.js';
import type { Graph, PatchOperation } from '@nodespec/core/types.js';

const BRANCH = '0a000000-0000-4000-8000-000000000001';
const PROJECT = '0a000000-0000-4000-8000-000000000002';
const A = '0a000000-0000-4000-8000-00000000000a';
const B = '0a000000-0000-4000-8000-00000000000b';
const C = '0a000000-0000-4000-8000-00000000000c';
const A_OUT = '0a000000-0000-4000-8000-0000000000a1';
const A_OUT2 = '0a000000-0000-4000-8000-0000000000a2';
const B_OUT = '0a000000-0000-4000-8000-0000000000b1';
const C_IN = '0a000000-0000-4000-8000-0000000000c1';
const K1 = '0a000000-0000-4000-8000-0000000000f1';
const K2 = '0a000000-0000-4000-8000-0000000000f2';
const E1 = '0a000000-0000-4000-8000-0000000000e1';
const E2 = '0a000000-0000-4000-8000-0000000000e2';

const meta = (summary: string) => createPatchMetadata({ actorType: 'ai', summary });
const contract = (id: string, name: string) => ({ id, kind: 'rest' as const, name, metadata: {} });

/** The graph before the proposal: two nodes written when nodes still carried ports. */
function legacyBase(): PatchOperation[] {
  return [
    { type: 'add_node', metadata: meta('add A'), payload: { id: A, type: 'backend-service', label: 'Orders', metadata: {}, ports: [{ id: A_OUT, name: 'out', direction: 'out' }] } },
    { type: 'add_node', metadata: meta('add B'), payload: { id: B, type: 'backend-service', label: 'Billing', metadata: {}, ports: [{ id: B_OUT, name: 'out', direction: 'out' }] } },
  ] as PatchOperation[];
}

/** A proposal filed before ports came out: every way a patch used to carry them. */
function legacyProposalPatches(): PatchOperation[] {
  return [
    { type: 'add_node', metadata: meta('add C'), payload: { id: C, type: 'database', label: 'Orders DB', metadata: {}, ports: [{ id: C_IN, name: 'in', direction: 'in' }] } },
    { type: 'add_port', metadata: meta('port on A'), payload: { nodeId: A, port: { id: A_OUT2, name: 'events', direction: 'out' } } },
    { type: 'mark_entity_complete', metadata: meta('port done'), payload: { entityType: 'port', entityId: A_OUT2, nodeId: A } },
    { type: 'connect_ports', metadata: meta('A to C'), payload: { sourceNodeId: A, sourcePortId: A_OUT, targetNodeId: C, targetPortId: C_IN, edgeId: E1, contractId: K1, contract: contract(K1, 'Orders SQL'), label: 'writes' } },
    { type: 'add_contract', metadata: meta('contract B to C'), payload: contract(K2, 'Billing SQL') },
    { type: 'add_edge', metadata: meta('B to C'), payload: { id: E2, source: B, target: C, sourcePortId: B_OUT, targetPortId: C_IN, contractId: K2, metadata: {} } },
    { type: 'update_node', metadata: meta('rename A'), payload: { id: A, changes: { label: 'Orders API', ports: [] } } },
  ] as PatchOperation[];
}

/** An in-memory branch: the patch log and the graph the engine builds from it. */
function memoryBranch(proposal: AIProposal) {
  const stored: PersistedPatch[] = [];
  const append = (ps: PatchOperation[]) => ps.map((p) => {
    const row: PersistedPatch = {
      id: p.metadata.id, branchId: BRANCH, sequence: stored.length + 1, patchType: p.type,
      actorType: p.metadata.actorType, actorId: null, summary: p.metadata.summary ?? '',
      payload: p, createdAt: '', appliedAt: null,
    };
    stored.push(row);
    return row;
  });
  const graphNow = (): Graph => {
    const r = applyPatches(createEmptyGraph(), stored.map((s) => s.payload));
    if (!r.success || !r.graph) throw new Error(`the log does not replay: ${JSON.stringify(r.error)}`);
    return r.graph;
  };
  const appendPatches = vi.fn(async (_branchId: string, ps: PatchOperation[]) => ({ success: true, data: append(ps) }));
  const persistence = {
    getProposalRepository: () => ({ getById: async () => ({ success: true, data: proposal }) }),
    getBranchRepository: () => ({ getById: async () => ({ success: true, data: { id: BRANCH, projectId: PROJECT } }) }),
    getSpecificationRepository: () => ({ getByProjectId: async () => ({ success: true, data: [] }) }),
    getSupabaseClient: () => { throw new Error('no database here'); },
    getGraphRepository: () => ({ loadSnapshot: async () => ({ success: true, data: { graphData: graphNow() } }) }),
    getPatchRepository: () => ({ loadPatches: async () => ({ success: true, data: [...stored] }), appendPatches }),
  } as unknown as PersistenceService;
  return { persistence, stored, append, graphNow, appendPatches };
}

function acceptingService(persistence: PersistenceService, onRebuild: () => void) {
  const svc = new ProposalService(persistence);
  const internals = svc as unknown as Record<string, () => Promise<void>>;
  vi.spyOn(internals, 'rebuildSnapshot').mockImplementation(async () => { onRebuild(); });
  vi.spyOn(internals, 'createArchitectureMappings').mockResolvedValue(undefined);
  vi.spyOn(svc, 'updateProposalStatus').mockResolvedValue({} as AIProposal);
  return svc;
}

describe('AG.13 a proposal filed with ports lands without them', () => {
  const filed = legacyProposalPatches();
  const proposal = {
    id: generateUUID(), aiRunId: generateUUID(), sourceBranchId: BRANCH, proposalBranchId: BRANCH,
    status: 'pending', validationExpectations: [], createdAt: '', metadata: {},
    patches: filed.map((patch) => ({ patch, explanation: '', status: 'pending' as const })),
  } as AIProposal;

  it('appends no port op, no ports and no port ids; connect_ports lands as its contract and edge', async () => {
    const branch = memoryBranch(proposal);
    branch.append(legacyBase());
    let rebuilt: Graph | null = null;
    const svc = acceptingService(branch.persistence, () => { rebuilt = branch.graphNow(); });

    await svc.acceptProposal(proposal.id);

    const landed = branch.stored.slice(2).map((s) => s.payload);
    expect(landed.map((p) => p.type)).toEqual(['add_node', 'add_contract', 'add_edge', 'add_contract', 'add_edge', 'update_node']);
    const text = JSON.stringify(landed);
    expect(text).not.toContain('"ports"');
    expect(text).not.toContain('PortId');

    // The edge connect_ports meant, keeping its patch id; its contract rides ahead of it.
    const connect = filed[3];
    const edgePatch = landed.find((p) => p.type === 'add_edge' && (p.payload as { id: string }).id === E1)!;
    expect(edgePatch.metadata.id).toBe(connect.metadata.id);
    expect(edgePatch.payload).toEqual({ id: E1, source: A, target: C, contractId: K1, label: 'writes', metadata: {} });

    // The whole log (old ports and all) still replays, and what landed is portless.
    const g = rebuilt as unknown as Graph;
    expect(g.edges[E1]).toMatchObject({ source: A, target: C, contractId: K1 });
    expect(g.edges[E1].sourcePortId).toBeUndefined();
    expect(g.contracts[K1].name).toBe('Orders SQL');
    expect(g.edges[E2]).toMatchObject({ source: B, target: C, contractId: K2 });
    expect(g.edges[E2].targetPortId).toBeUndefined();
    expect(g.nodes[C].ports).toBeUndefined();
    expect(g.nodes[A].label).toBe('Orders API');
    // A's stored port is history: the accept neither added to it nor rewrote it.
    expect(g.nodes[A].ports).toEqual([{ id: A_OUT, name: 'out', direction: 'out' }]);
  });

  it('accepting the same proposal twice appends nothing the second time', async () => {
    const branch = memoryBranch(proposal);
    branch.append(legacyBase());
    const svc = acceptingService(branch.persistence, () => { branch.graphNow(); });

    await svc.acceptProposal(proposal.id);
    const afterFirst = branch.stored.length;
    await svc.acceptProposal(proposal.id);

    expect(branch.stored.length).toBe(afterFirst);
    expect(branch.appendPatches).toHaveBeenCalledTimes(1);
  });
});

function role(id: string): NodeRole {
  return {
    id, label: id, description: '', whenToUse: null, iconName: 'box', color: '#000',
    rfVisualType: 'service', paletteCategory: 'Services', nature: 'build', interfaceKind: 'service',
    provider: null, capabilityTags: [], isContainer: false, containerLayer: null, containerStyle: null,
    canContain: [], metadataSchema: null, suggestedContracts: [], sortOrder: 1, deprecated: false,
    defaultTechnology: null,
  } as NodeRole;
}

describe('AG.13 a dropped node is the node alone', () => {
  it('a palette drop writes one add_node with no ports and no contract', () => {
    const id = generateUUID();
    const patches = buildNodePatchesFromRole(role('backend-service'), id, 'Orders', { actorType: 'human' });
    expect(patches.map((p) => p.type)).toEqual(['add_node']);
    expect(patches[0].payload).not.toHaveProperty('ports');
    const r = applyPatches(createEmptyGraph(), patches);
    expect(r.success).toBe(true);
    expect(r.graph!.nodes[id].ports).toBeUndefined();
    expect(Object.keys(r.graph!.contracts)).toEqual([]);
  });

  it('a template drop writes a node with no ports and no stub contracts', () => {
    const id = generateUUID();
    const patch = createNodeFromTemplatePatch('rest-service', id, 'Auth API', { actorType: 'human', summary: 'drop' });
    expect(patch.payload.node).not.toHaveProperty('ports');
    expect(patch.payload.contracts).toEqual([]);
    const r = applyPatches(createEmptyGraph(), [patch]);
    expect(r.success).toBe(true);
    expect(r.graph!.nodes[id].label).toBe('Auth API');
    expect(Object.keys(r.graph!.contracts)).toEqual([]);
  });

  it('an add_node built by the factory carries no ports', () => {
    const p = createAddNodePatch({ id: generateUUID(), type: 'backend-service', label: 'X', metadata: {} }, { actorType: 'human', summary: 'x' });
    expect(p.payload).not.toHaveProperty('ports');
  });
});

describe('AG.13 the canvas draws its handles from the component', () => {
  afterEach(cleanup);

  const draw = (type: keyof typeof nodeTypes, data: Record<string, unknown>) => {
    const Component = nodeTypes[type] as unknown as React.ComponentType<Record<string, unknown>>;
    const props = {
      id: generateUUID(), type, selected: false, dragging: false, zIndex: 1, isConnectable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
      data: { label: 'N', nodeType: 'backend-service', artifacts: [], metadata: {}, hasError: false, isDraft: false, ...data },
    };
    const { container } = render(
      <ThemeProvider>
        <ReactFlowProvider>
          <Component {...props} />
        </ReactFlowProvider>
      </ThemeProvider>,
    );
    const handles = [...container.querySelectorAll('.react-flow__handle')];
    return {
      container,
      handles,
      connectable: handles.filter((h) => h.classList.contains('connectable')),
      targets: handles.filter((h) => h.classList.contains('target')),
      sources: handles.filter((h) => h.classList.contains('source')),
    };
  };

  // Stored ports on the node's data are ignored: they no longer draw handles.
  const legacyPorts = [
    { id: generateUUID(), name: 'in', direction: 'in' },
    { id: generateUUID(), name: 'out', direction: 'out' },
    { id: generateUUID(), name: 'events', direction: 'out' },
  ];

  it('a leaf draws one handle in and one out, both connectable, whatever ports it stored', () => {
    for (const type of ['service', 'database', 'icon', 'library'] as const) {
      const d = draw(type, { ports: legacyPorts });
      expect(d.handles, type).toHaveLength(2);
      expect(d.connectable, type).toHaveLength(2);
      expect(d.targets, type).toHaveLength(1);
      expect(d.sources, type).toHaveLength(1);
      for (const h of d.handles) expect(h.getAttribute('data-handleid'), type).toBeNull();
      cleanup();
    }
  });

  it('a container draws only handles nothing can be dragged from or to', () => {
    const d = draw('container', { nodeType: 'aws-vpc', ports: legacyPorts });
    expect(d.handles.length).toBeGreaterThan(0);
    expect(d.connectable).toHaveLength(0);
  });

  it('an exploded node is a leaf: its box takes connections', () => {
    const d = draw('container', { nodeType: 'backend-service', exploded: true });
    expect(d.connectable).toHaveLength(2);
    expect(d.targets).toHaveLength(1);
    expect(d.sources).toHaveLength(1);
  });

  it('a logical boundary draws the invisible pair only, open or closed', () => {
    for (const containerExpanded of [true, false]) {
      const d = draw('logicalBoundary', { nodeType: 'bounded-context', metadata: { containerExpanded } });
      expect(d.targets, String(containerExpanded)).toHaveLength(1);
      expect(d.sources, String(containerExpanded)).toHaveLength(1);
      expect(d.connectable, String(containerExpanded)).toHaveLength(0);
      cleanup();
    }
  });

  it('a library shows exports and dependencies only when it declares them', () => {
    const bare = draw('library', {}).container.textContent;
    expect(bare).not.toContain('Exports');
    expect(bare).not.toContain('Deps');
    cleanup();
    const d = draw('library', { metadata: { exportedModules: ['parse', 'format'], peerDependencies: ['react'] } });
    expect(d.container.textContent).toContain('Exports');
    expect(d.container.textContent).toContain('Deps');
  });
});

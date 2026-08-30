import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Graph } from '@nodespec/core/types.js';
import type { SpecGraphRFNode, SpecGraphRFEdge } from '../ui/adapters/graph-to-reactflow.js';
import {
  snapshotCurrentPositions,
  identifyContainerIds,
  planFlatToNested,
  planNestedToFlat,
  ENTER_DURATION_MS,
  EXIT_DURATION_MS,
  SETTLE_DELAY_MS,
} from '../ui/utils/layer-transition.js';
import {
  saveModePositions,
  loadModePositions,
  hasModePositions,
} from '../ui/utils/mode-position-cache.js';

function makeCatalog() {
  return {
    resolveNodeType: (type: string) => {
      if (type.startsWith('orchestration.')) {
        return {
          role: {
            id: type.split('.')[1],
            label: type.split('.')[1],
            category: 'container',
            rfVisualType: 'container',
            canContain: ['*'],
            paletteCategory: 'orchestration',
          },
          technology: null,
        };
      }
      return {
        role: {
          id: type.split('.')[1] ?? type,
          label: type,
          category: 'node',
          rfVisualType: 'base',
          paletteCategory: 'backend',
        },
        technology: null,
      };
    },
    getRole: () => null,
    getTechnologiesForRole: () => [],
    getAllRoles: () => [],
    getAllTechnologies: () => [],
  } as any;
}

function makeGraph(opts?: {
  withContainers?: boolean;
  withEdges?: boolean;
}): Graph {
  const nodes: Record<string, any> = {};
  const edges: Record<string, any> = {};
  const contracts: Record<string, any> = {};

  nodes['svc-a'] = {
    id: 'svc-a',
    type: 'backend.web-service',
    label: 'Service A',
    ports: [],
    data: {},
    parentId: opts?.withContainers ? 'vpc-1' : undefined,
  };
  nodes['svc-b'] = {
    id: 'svc-b',
    type: 'backend.web-service',
    label: 'Service B',
    ports: [],
    data: {},
    parentId: opts?.withContainers ? 'vpc-1' : undefined,
  };
  nodes['svc-c'] = {
    id: 'svc-c',
    type: 'backend.web-service',
    label: 'Service C',
    ports: [],
    data: {},
    parentId: opts?.withContainers ? 'vpc-2' : undefined,
  };

  if (opts?.withContainers) {
    nodes['vpc-1'] = {
      id: 'vpc-1',
      type: 'orchestration.kubernetes-cluster',
      label: 'VPC 1',
      ports: [],
      data: {},
      metadata: { containerExpanded: true },
    };
    nodes['vpc-2'] = {
      id: 'vpc-2',
      type: 'orchestration.kubernetes-cluster',
      label: 'VPC 2',
      ports: [],
      data: {},
      metadata: { containerExpanded: true },
    };
  }

  if (opts?.withEdges) {
    contracts['c1'] = { id: 'c1', name: 'REST API', kind: 'rest', definition: '' };
    edges['e1'] = {
      id: 'e1',
      source: 'svc-a',
      target: 'svc-b',
      contractId: 'c1',
      label: 'A to B',
    };
    edges['e2'] = {
      id: 'e2',
      source: 'svc-a',
      target: 'svc-c',
      contractId: 'c1',
      label: 'A to C',
    };
  }

  return {
    id: 'test-graph',
    schemaVersion: '1.0.0',
    version: 1,
    hash: 'test',
    nodes,
    edges,
    contracts,
    artifacts: {},
    metadata: { version: '1.0.0' },
  } as unknown as Graph;
}

function makeRFNodes(graph: Graph): SpecGraphRFNode[] {
  return Object.values(graph.nodes).map(n => ({
    id: n.id,
    type: 'base',
    position: { x: Math.random() * 400, y: Math.random() * 400 },
    data: {
      label: n.label,
      nodeType: n.type,
      artifacts: [],
      ports: [],
      metadata: {},
      hasError: false,
      isDraft: false,
    },
  })) as SpecGraphRFNode[];
}

function makeRFEdges(graph: Graph): SpecGraphRFEdge[] {
  return Object.values(graph.edges).map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'default',
    data: {
      contract: null,
      hasError: false,
      hasWarning: false,
    },
  })) as SpecGraphRFEdge[];
}

const storageMap = new Map<string, string>();

beforeEach(() => {
  storageMap.clear();
  (globalThis as any).localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => { storageMap.set(key, value); },
    removeItem: (key: string) => { storageMap.delete(key); },
    clear: () => { storageMap.clear(); },
    get length() { return storageMap.size; },
    key: (i: number) => Array.from(storageMap.keys())[i] ?? null,
  };
});

describe('Mode Position Cache', () => {
  it('should save and load flat positions', () => {
    const positions = new Map([
      ['node-1', { x: 100, y: 200 }],
      ['node-2', { x: 300, y: 400 }],
    ]);

    saveModePositions('flat', positions);

    expect(hasModePositions('flat')).toBe(true);
    expect(hasModePositions('nested')).toBe(false);

    const loaded = loadModePositions('flat');
    expect(loaded.size).toBe(2);
    expect(loaded.get('node-1')).toEqual({ x: 100, y: 200 });
    expect(loaded.get('node-2')).toEqual({ x: 300, y: 400 });
  });

  it('should save and load nested positions separately', () => {
    const flatPositions = new Map([['a', { x: 10, y: 20 }]]);
    const nestedPositions = new Map([['a', { x: 50, y: 60 }]]);

    saveModePositions('flat', flatPositions);
    saveModePositions('nested', nestedPositions);

    const flat = loadModePositions('flat');
    const nested = loadModePositions('nested');

    expect(flat.get('a')).toEqual({ x: 10, y: 20 });
    expect(nested.get('a')).toEqual({ x: 50, y: 60 });
  });

  it('should return empty map for uncached mode', () => {
    expect(loadModePositions('flat').size).toBe(0);
    expect(hasModePositions('flat')).toBe(false);
  });
});

describe('snapshotCurrentPositions', () => {
  it('should snapshot positions from localPositions map', () => {
    const graph = makeGraph();
    const rfNodes = makeRFNodes(graph);
    const localPositions = new Map([
      ['svc-a', { x: 100, y: 200 }],
      ['svc-b', { x: 300, y: 400 }],
      ['svc-c', { x: 500, y: 600 }],
    ]);

    const snapshot = snapshotCurrentPositions(rfNodes, localPositions);

    expect(snapshot.size).toBe(3);
    expect(snapshot.get('svc-a')).toEqual({ x: 100, y: 200 });
    expect(snapshot.get('svc-b')).toEqual({ x: 300, y: 400 });
  });

  it('should fall back to node.position when localPositions is missing', () => {
    const graph = makeGraph();
    const rfNodes = makeRFNodes(graph);
    rfNodes[0].position = { x: 42, y: 99 };

    const localPositions = new Map([
      ['svc-b', { x: 300, y: 400 }],
      ['svc-c', { x: 500, y: 600 }],
    ]);

    const snapshot = snapshotCurrentPositions(rfNodes, localPositions);
    expect(snapshot.get(rfNodes[0].id)).toEqual({ x: 42, y: 99 });
  });
});

describe('identifyContainerIds', () => {
  it('should return empty set when no containers exist', () => {
    const graph = makeGraph();
    const catalog = makeCatalog();
    const ids = identifyContainerIds(graph, catalog);
    expect(ids.size).toBe(0);
  });

  it('should identify container nodes', () => {
    const graph = makeGraph({ withContainers: true });
    const catalog = makeCatalog();
    const ids = identifyContainerIds(graph, catalog);
    expect(ids.has('vpc-1')).toBe(true);
    expect(ids.has('vpc-2')).toBe(true);
    expect(ids.has('svc-a')).toBe(false);
  });
});

describe('planFlatToNested', () => {
  it('should save current positions as flat cache', () => {
    const graph = makeGraph({ withContainers: true, withEdges: true });
    const catalog = makeCatalog();
    const rfNodes = makeRFNodes(graph);
    const rfEdges = makeRFEdges(graph);
    const localPositions = new Map<string, { x: number; y: number }>();
    rfNodes.forEach(n => localPositions.set(n.id, n.position));

    planFlatToNested(graph, catalog, rfNodes, rfEdges, localPositions);

    expect(hasModePositions('flat')).toBe(true);
    const flatCache = loadModePositions('flat');
    expect(flatCache.size).toBeGreaterThan(0);
  });

  it('should return entering-nested phase', () => {
    const graph = makeGraph({ withContainers: true });
    const catalog = makeCatalog();
    const rfNodes = makeRFNodes(graph);
    const rfEdges = makeRFEdges(graph);
    const localPositions = new Map<string, { x: number; y: number }>();
    rfNodes.forEach(n => localPositions.set(n.id, n.position));

    const plan = planFlatToNested(graph, catalog, rfNodes, rfEdges, localPositions);

    expect(plan.phase).toBe('entering-nested');
    expect(plan.targetMode).toBe('nested');
    expect(plan.containerIds.has('vpc-1')).toBe(true);
    expect(plan.containerIds.has('vpc-2')).toBe(true);
  });

  it('should compute target positions for nested layout', () => {
    const graph = makeGraph({ withContainers: true, withEdges: true });
    const catalog = makeCatalog();
    const rfNodes = makeRFNodes(graph);
    const rfEdges = makeRFEdges(graph);
    const localPositions = new Map<string, { x: number; y: number }>();
    rfNodes.forEach(n => localPositions.set(n.id, n.position));

    const plan = planFlatToNested(graph, catalog, rfNodes, rfEdges, localPositions);

    expect(plan.targetPositions.size).toBeGreaterThan(0);
    for (const [, pos] of plan.targetPositions) {
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
    }
  });

  it('should override cached child positions with fresh layout when cached nested positions exist', () => {
    const graph = makeGraph({ withContainers: true });
    const catalog = makeCatalog();
    const rfNodes = makeRFNodes(graph);
    const rfEdges = makeRFEdges(graph);
    const localPositions = new Map<string, { x: number; y: number }>();
    rfNodes.forEach(n => localPositions.set(n.id, n.position));

    const cachedNested = new Map([
      ['svc-a', { x: 999, y: 888 }],
      ['svc-b', { x: 777, y: 666 }],
      ['vpc-1', { x: 50, y: 50 }],
    ]);
    saveModePositions('nested', cachedNested);

    const plan = planFlatToNested(graph, catalog, rfNodes, rfEdges, localPositions);

    expect(plan.targetPositions.has('svc-a')).toBe(true);
    expect(plan.targetPositions.has('svc-b')).toBe(true);
    expect(plan.targetPositions.get('vpc-1')).toEqual({ x: 50, y: 50 });
  });
});

describe('planNestedToFlat', () => {
  it('should save current positions as nested cache', () => {
    const graph = makeGraph({ withContainers: true, withEdges: true });
    const catalog = makeCatalog();
    const rfNodes = makeRFNodes(graph);
    const rfEdges = makeRFEdges(graph);
    const localPositions = new Map<string, { x: number; y: number }>();
    rfNodes.forEach(n => localPositions.set(n.id, n.position));

    planNestedToFlat(graph, catalog, rfNodes, rfEdges, localPositions);

    expect(hasModePositions('nested')).toBe(true);
  });

  it('should return exiting-nested phase', () => {
    const graph = makeGraph({ withContainers: true });
    const catalog = makeCatalog();
    const rfNodes = makeRFNodes(graph);
    const rfEdges = makeRFEdges(graph);
    const localPositions = new Map<string, { x: number; y: number }>();
    rfNodes.forEach(n => localPositions.set(n.id, n.position));

    const plan = planNestedToFlat(graph, catalog, rfNodes, rfEdges, localPositions);

    expect(plan.phase).toBe('exiting-nested');
    expect(plan.targetMode).toBe('flat');
  });

  it('should compute flat layout positions excluding containers', () => {
    const graph = makeGraph({ withContainers: true, withEdges: true });
    const catalog = makeCatalog();
    const rfNodes = makeRFNodes(graph);
    const rfEdges = makeRFEdges(graph);
    const localPositions = new Map<string, { x: number; y: number }>();
    rfNodes.forEach(n => localPositions.set(n.id, n.position));

    const plan = planNestedToFlat(graph, catalog, rfNodes, rfEdges, localPositions);

    expect(plan.targetPositions.size).toBeGreaterThan(0);
    expect(plan.targetPositions.has('svc-a')).toBe(true);
  });

  it('should restore cached flat positions when available', () => {
    const graph = makeGraph({ withContainers: true });
    const catalog = makeCatalog();
    const rfNodes = makeRFNodes(graph);
    const rfEdges = makeRFEdges(graph);
    const localPositions = new Map<string, { x: number; y: number }>();
    rfNodes.forEach(n => localPositions.set(n.id, n.position));

    const cachedFlat = new Map([
      ['svc-a', { x: 111, y: 222 }],
      ['svc-b', { x: 333, y: 444 }],
      ['svc-c', { x: 555, y: 666 }],
    ]);
    saveModePositions('flat', cachedFlat);

    const plan = planNestedToFlat(graph, catalog, rfNodes, rfEdges, localPositions);

    expect(plan.targetPositions.get('svc-a')).toEqual({ x: 111, y: 222 });
    expect(plan.targetPositions.get('svc-b')).toEqual({ x: 333, y: 444 });
  });
});

describe('Transition Constants', () => {
  it('should have valid timing constants', () => {
    expect(ENTER_DURATION_MS).toBe(300);
    expect(EXIT_DURATION_MS).toBe(250);
    expect(SETTLE_DELAY_MS).toBe(80);
    expect(ENTER_DURATION_MS).toBeGreaterThan(0);
    expect(EXIT_DURATION_MS).toBeGreaterThan(0);
    expect(SETTLE_DELAY_MS).toBeGreaterThan(0);
  });

  it('should have enter duration longer than exit for perceived smoothness', () => {
    expect(ENTER_DURATION_MS).toBeGreaterThan(EXIT_DURATION_MS);
  });
});

describe('Round-trip position preservation', () => {
  it('should preserve flat positions through flat→nested→flat cycle', () => {
    const graph = makeGraph({ withContainers: true, withEdges: true });
    const catalog = makeCatalog();
    const rfNodes = makeRFNodes(graph);
    const rfEdges = makeRFEdges(graph);

    const originalFlat = new Map([
      ['svc-a', { x: 100, y: 200 }],
      ['svc-b', { x: 300, y: 400 }],
      ['svc-c', { x: 500, y: 600 }],
      ['vpc-1', { x: 0, y: 0 }],
      ['vpc-2', { x: 700, y: 0 }],
    ]);

    planFlatToNested(graph, catalog, rfNodes, rfEdges, originalFlat);

    const nestedPositions = new Map<string, { x: number; y: number }>();
    rfNodes.forEach(n => nestedPositions.set(n.id, { x: 50, y: 50 }));

    const flatPlan = planNestedToFlat(graph, catalog, rfNodes, rfEdges, nestedPositions);

    expect(flatPlan.targetPositions.get('svc-a')).toEqual({ x: 100, y: 200 });
    expect(flatPlan.targetPositions.get('svc-b')).toEqual({ x: 300, y: 400 });
    expect(flatPlan.targetPositions.get('svc-c')).toEqual({ x: 500, y: 600 });
  });

  it('should preserve container positions through nested->flat->nested cycle', () => {
    const graph = makeGraph({ withContainers: true });
    const catalog = makeCatalog();
    const rfNodes = makeRFNodes(graph);
    const rfEdges = makeRFEdges(graph);

    const originalNested = new Map([
      ['svc-a', { x: 60, y: 80 }],
      ['svc-b', { x: 320, y: 80 }],
      ['svc-c', { x: 60, y: 80 }],
      ['vpc-1', { x: 100, y: 100 }],
      ['vpc-2', { x: 700, y: 100 }],
    ]);

    planNestedToFlat(graph, catalog, rfNodes, rfEdges, originalNested);

    const flatPositions = new Map<string, { x: number; y: number }>();
    rfNodes.forEach(n => flatPositions.set(n.id, { x: 200, y: 200 }));

    const nestedPlan = planFlatToNested(graph, catalog, rfNodes, rfEdges, flatPositions);

    expect(nestedPlan.targetPositions.get('vpc-1')).toEqual({ x: 100, y: 100 });
    expect(nestedPlan.targetPositions.get('vpc-2')).toEqual({ x: 700, y: 100 });
    expect(nestedPlan.targetPositions.has('svc-a')).toBe(true);
    expect(nestedPlan.targetPositions.has('svc-b')).toBe(true);
  });
});

describe('Source file integrity - Drift Prevention', () => {
  function readSource(relativePath: string): string {
    return readFileSync(resolve(__dirname, '..', relativePath), 'utf-8');
  }

  it('Canvas.tsx should import layer-transition utilities', () => {
    const source = readSource('ui/components/layout/Canvas.tsx');
    expect(source).toContain("from '../../utils/layer-transition.js'");
    expect(source).toContain('planFlatToNested');
    expect(source).toContain('planNestedToFlat');
  });

  it('Canvas.tsx should have transitionPhase state', () => {
    const source = readSource('ui/components/layout/Canvas.tsx');
    expect(source).toContain('transitionPhase');
    expect(source).toContain("useState<TransitionPhase>('idle')");
  });

  it('Canvas.tsx should use handleLayerModeToggle instead of raw setLayerMode for toggle', () => {
    const source = readSource('ui/components/layout/Canvas.tsx');
    expect(source).toContain('handleLayerModeToggle');
    expect(source).toContain('onToggle={handleLayerModeToggle}');
  });

  it('Canvas.tsx should pass transitionPhase to node data', () => {
    const source = readSource('ui/components/layout/Canvas.tsx');
    expect(source).toContain('transitionPhase,');
    expect(source).toContain('transitionPhase !== \'idle\'');
  });

  // B.2d design import (2026-07-29): the LayerModeToggle pill stack was
  // superseded by the unified CanvasDock — the disabled-during-transition
  // contract carries over to the dock's layer segment.
  it('CanvasDock should support disabled prop', () => {
    const source = readSource('ui/components/common/CanvasDock.tsx');
    expect(source).toContain('disabled');
  });

  it('ContainerNode.tsx should read transitionPhase from data', () => {
    const source = readSource('ui/components/nodes/ContainerNode.tsx');
    expect(source).toContain('data.transitionPhase');
    expect(source).toContain('containerEnter');
    expect(source).toContain('containerExit');
  });

  it('ContainerNode.tsx should apply CSS animation properties', () => {
    const source = readSource('ui/components/nodes/ContainerNode.tsx');
    expect(source).toContain('animationName');
    expect(source).toContain('animationDuration');
    expect(source).toContain('animationFillMode');
  });

  it('RFNodeData should include transitionPhase field', () => {
    const source = readSource('ui/adapters/graph-to-reactflow.ts');
    expect(source).toContain("transitionPhase?: 'idle' | 'entering-nested' | 'exiting-nested'");
  });

  it('index.css should define containerEnter and containerExit keyframes', () => {
    const source = readSource('index.css');
    expect(source).toContain('@keyframes containerEnter');
    expect(source).toContain('@keyframes containerExit');
    expect(source).toContain('scale(0.95)');
  });

  it('mode-position-cache.ts should use separate localStorage keys', () => {
    const source = readSource('ui/utils/mode-position-cache.ts');
    expect(source).toContain('specgraph_flat_positions');
    expect(source).toContain('specgraph_nested_positions');
  });

  it('layer-transition.ts should export timing constants', () => {
    const source = readSource('ui/utils/layer-transition.ts');
    expect(source).toContain('ENTER_DURATION_MS');
    expect(source).toContain('EXIT_DURATION_MS');
    expect(source).toContain('SETTLE_DELAY_MS');
  });

  it('Canvas.tsx should not have old previousLayerModeRef flat→nested effect', () => {
    const source = readSource('ui/components/layout/Canvas.tsx');
    expect(source).not.toContain('previousLayerModeRef');
  });

  it('utils/index.ts should export transition utilities', () => {
    const source = readSource('ui/utils/index.ts');
    expect(source).toContain('planFlatToNested');
    expect(source).toContain('planNestedToFlat');
    expect(source).toContain('saveModePositions');
    expect(source).toContain('loadModePositions');
  });

  it('CSS should add transition to edges for smooth visibility changes', () => {
    const source = readSource('index.css');
    expect(source).toContain('.react-flow__edge');
    expect(source).toContain('transition: opacity');
  });
});

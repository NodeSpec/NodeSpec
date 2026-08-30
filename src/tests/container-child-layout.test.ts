import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Graph } from '@nodespec/core/types.js';
import {
  layoutContainerChildren,
  calculateFlowAwareContainerSize,
  computeAllContainerLayouts,
  DEFAULT_CONFIG,
} from '../ui/utils/container-child-layout.js';

const emptyGraph: Graph = {
  id: '00000000-0000-0000-0000-000000000000',
  schemaVersion: 1,
  version: 1,
  hash: 'test',
  nodes: {},
  edges: {},
  contracts: {},
  artifacts: {},
  nodeGroups: {},
};

function makeContainerWithChildren(childCount: number, edgePairs: [number, number][] = []): Graph {
  const nodes: Graph['nodes'] = {
    'vpc-1': {
      id: 'vpc-1',
      type: 'infrastructure.vpc',
      label: 'VPC',
      ports: [],
      artifacts: [],
    },
  };

  for (let i = 0; i < childCount; i++) {
    nodes[`svc-${i}`] = {
      id: `svc-${i}`,
      type: 'backend.backend-service',
      label: `Service ${i}`,
      ports: [],
      artifacts: [],
      parentId: 'vpc-1',
    };
  }

  const edges: Graph['edges'] = {};
  const contracts: Graph['contracts'] = {};

  for (const [src, tgt] of edgePairs) {
    const edgeId = `e-${src}-${tgt}`;
    const contractId = `c-${src}-${tgt}`;
    edges[edgeId] = {
      id: edgeId,
      source: `svc-${src}`,
      target: `svc-${tgt}`,
      contractId,
    };
    contracts[contractId] = {
      id: contractId,
      name: `Contract ${src}-${tgt}`,
      kind: 'rest',
      schema: {},
    };
  }

  return { ...emptyGraph, nodes, edges, contracts };
}

function makeNestedContainerGraph(): Graph {
  return {
    ...emptyGraph,
    nodes: {
      'cluster': {
        id: 'cluster',
        type: 'orchestration.k8s-cluster',
        label: 'K8s Cluster',
        ports: [],
        artifacts: [],
      },
      'ns-a': {
        id: 'ns-a',
        type: 'orchestration.k8s-namespace',
        label: 'Namespace A',
        ports: [],
        artifacts: [],
        parentId: 'cluster',
      },
      'svc-1': {
        id: 'svc-1',
        type: 'backend.backend-service',
        label: 'Service 1',
        ports: [],
        artifacts: [],
        parentId: 'cluster',
      },
    },
    edges: {},
    contracts: {},
  };
}

describe('layoutContainerChildren', () => {
  it('returns empty positions for a container with no children', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'vpc-1': { id: 'vpc-1', type: 'infrastructure.vpc', label: 'VPC', ports: [], artifacts: [] },
      },
    };
    const result = layoutContainerChildren('vpc-1', graph);
    expect(result.positions).toHaveLength(0);
    expect(result.sizing.width).toBeGreaterThanOrEqual(500);
    expect(result.sizing.height).toBeGreaterThanOrEqual(350);
  });

  it('positions a single child inside the container', () => {
    const graph = makeContainerWithChildren(1);
    const result = layoutContainerChildren('vpc-1', graph);
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].id).toBe('svc-0');
    expect(result.positions[0].x).toBeGreaterThan(0);
    expect(result.positions[0].y).toBeGreaterThan(0);
  });

  it('positions multiple children with flow-aware ranks based on edges', () => {
    const graph = makeContainerWithChildren(3, [[0, 1], [1, 2]]);
    const result = layoutContainerChildren('vpc-1', graph);

    expect(result.positions).toHaveLength(3);

    const posMap = new Map(result.positions.map(p => [p.id, p]));
    const svc0 = posMap.get('svc-0')!;
    const svc1 = posMap.get('svc-1')!;
    const svc2 = posMap.get('svc-2')!;

    expect(svc0.x).toBeLessThan(svc1.x);
    expect(svc1.x).toBeLessThan(svc2.x);
  });

  // The shipped algorithm is a topologically-ORDERED wrapped grid (max 4 columns), not
  // the old rank-per-column layout this test originally pinned (uniqueXs <= 2): edges
  // decide the placement ORDER, the grid decides the coordinates. Unconnected children
  // therefore fill a compact grid row-by-row instead of stacking in one x-column.
  it('places children without edges in a compact grid (single row for 3 children)', () => {
    const graph = makeContainerWithChildren(3);
    const result = layoutContainerChildren('vpc-1', graph);

    // 3 children -> maxColumns = min(4, ceil(sqrt(3 * 1.5))) = 3 -> one row of three.
    const uniqueYs = new Set(result.positions.map(p => p.y));
    expect(uniqueYs.size).toBe(1);
    const uniqueXs = new Set(result.positions.map(p => p.x));
    expect(uniqueXs.size).toBe(3);
  });

  it('produces sizing that accommodates all children', () => {
    const graph = makeContainerWithChildren(6, [[0, 1], [1, 2], [3, 4], [4, 5]]);
    const result = layoutContainerChildren('vpc-1', graph);

    // Sizing floor is 300x250 (module constants); the old >= 500x350 pin belonged to a
    // pre-repo iteration with larger node boxes. Accommodation is asserted for real:
    // every child's full extent (position + node box) fits inside the computed sizing.
    expect(result.sizing.width).toBeGreaterThanOrEqual(300);
    expect(result.sizing.height).toBeGreaterThanOrEqual(250);

    for (const pos of result.positions) {
      expect(pos.x + DEFAULT_CONFIG.nodeWidth).toBeLessThanOrEqual(result.sizing.width);
      expect(pos.y + DEFAULT_CONFIG.nodeHeight).toBeLessThanOrEqual(result.sizing.height);
    }
  });

  it('handles containers with nested container children', () => {
    const graph = makeNestedContainerGraph();
    const result = layoutContainerChildren('cluster', graph);

    expect(result.positions.length).toBeGreaterThanOrEqual(1);
    const ids = result.positions.map(p => p.id);
    expect(ids).toContain('svc-1');
    expect(ids).toContain('ns-a');
  });
});

describe('calculateFlowAwareContainerSize', () => {
  it('returns minimum size for zero children', () => {
    // The rendering-floor minimum is 300x250. NOTE the deliberate asymmetry with
    // layoutContainerChildren, whose empty-container AUTO-FIT result is a roomier
    // 500x350 drop target (pinned in the layoutContainerChildren suite above); this
    // function is the passive min-size floor used by graph-to-reactflow.
    const size = calculateFlowAwareContainerSize(0, false);
    expect(size.width).toBe(300);
    expect(size.height).toBe(250);
  });

  it('grows width with more children', () => {
    const small = calculateFlowAwareContainerSize(2, false);
    const large = calculateFlowAwareContainerSize(8, false);
    expect(large.width).toBeGreaterThanOrEqual(small.width);
  });

  it('grows height with more children', () => {
    const small = calculateFlowAwareContainerSize(1, false);
    const large = calculateFlowAwareContainerSize(6, false);
    expect(large.height).toBeGreaterThanOrEqual(small.height);
  });

  it('accounts for nested containers in sizing', () => {
    const withoutNested = calculateFlowAwareContainerSize(3, false);
    const withNested = calculateFlowAwareContainerSize(3, true, 2);
    expect(withNested.width).toBeGreaterThan(withoutNested.width);
  });

  it('produces sensible sizes for containers with only nested containers', () => {
    const size = calculateFlowAwareContainerSize(2, true, 2);
    expect(size.width).toBeGreaterThanOrEqual(500);
    expect(size.height).toBeGreaterThanOrEqual(350);
  });
});

describe('computeAllContainerLayouts', () => {
  it('computes layouts for all containers with children', () => {
    const graph = makeContainerWithChildren(3, [[0, 1], [1, 2]]);
    const layouts = computeAllContainerLayouts(graph);
    expect(layouts.has('vpc-1')).toBe(true);
    expect(layouts.get('vpc-1')!.positions).toHaveLength(3);
  });

  it('skips containers without children', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'vpc-empty': { id: 'vpc-empty', type: 'infrastructure.vpc', label: 'Empty VPC', ports: [], artifacts: [] },
      },
    };
    const layouts = computeAllContainerLayouts(graph);
    expect(layouts.has('vpc-empty')).toBe(false);
  });

  it('handles multiple containers independently', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'vpc-a': { id: 'vpc-a', type: 'infrastructure.vpc', label: 'VPC A', ports: [], artifacts: [] },
        'vpc-b': { id: 'vpc-b', type: 'infrastructure.vpc', label: 'VPC B', ports: [], artifacts: [] },
        'svc-a1': { id: 'svc-a1', type: 'backend.backend-service', label: 'Svc A1', ports: [], artifacts: [], parentId: 'vpc-a' },
        'svc-a2': { id: 'svc-a2', type: 'backend.backend-service', label: 'Svc A2', ports: [], artifacts: [], parentId: 'vpc-a' },
        'svc-b1': { id: 'svc-b1', type: 'backend.backend-service', label: 'Svc B1', ports: [], artifacts: [], parentId: 'vpc-b' },
      },
    };
    const layouts = computeAllContainerLayouts(graph);
    expect(layouts.size).toBe(2);
    expect(layouts.get('vpc-a')!.positions).toHaveLength(2);
    expect(layouts.get('vpc-b')!.positions).toHaveLength(1);
  });
});

describe('Container Child Layout - Source File Integrity', () => {
  it('graph-to-reactflow uses calculateFlowAwareContainerSize instead of inline grid sizing', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/adapters/graph-to-reactflow.ts'),
      'utf-8'
    );
    expect(source).toContain('calculateFlowAwareContainerSize');
    expect(source).not.toContain('calculateOptimalSize');
  });

  it('RFNodeData includes onFitChildren callback', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/adapters/graph-to-reactflow.ts'),
      'utf-8'
    );
    expect(source).toContain('onFitChildren');
  });

  it('ContainerNode renders a fit-children button', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/nodes/ContainerNode.tsx'),
      'utf-8'
    );
    // The button uses inline styles (no `fitChildrenButtonStyles` constant has ever
    // existed in this repo's ContainerNode); pin the wiring and the accessible title.
    expect(source).toContain('data.onFitChildren?.()');
    expect(source).toContain('Auto-layout children');
  });

  it('Canvas uses transition engine for flat-to-nested transition', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/layout/Canvas.tsx'),
      'utf-8'
    );
    expect(source).toContain('planFlatToNested');
    expect(source).toContain('planNestedToFlat');
    expect(source).toContain('handleLayerModeToggle');
  });

  it('Canvas wires handleFitChildren into node data', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/layout/Canvas.tsx'),
      'utf-8'
    );
    expect(source).toContain('handleFitChildren');
    expect(source).toContain('layoutContainerChildren');
  });

  it('auto-layout integrates with flow-aware container layout when graph is provided', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/utils/auto-layout.ts'),
      'utf-8'
    );
    expect(source).toContain('layoutContainerChildren');
    expect(source).toContain('graph?: Graph');
  });
});

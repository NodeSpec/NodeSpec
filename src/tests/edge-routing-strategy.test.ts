import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Graph } from '@nodespec/core/types.js';
import {
  classifyEdge,
  findDirectContainerId,
  findRootContainerId,
  computeCrossContainerSummaries,
  mapGraphToRFEdges,
  mapEdgeToRFEdge,
  deriveRFState,
} from '../ui/adapters/graph-to-reactflow.js';

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

function makeTwoContainerGraph(): Graph {
  return {
    ...emptyGraph,
    nodes: {
      'vpc-a': {
        id: 'vpc-a',
        type: 'infrastructure.vpc',
        label: 'VPC Alpha',
        ports: [],
        artifacts: [],
      },
      'vpc-b': {
        id: 'vpc-b',
        type: 'infrastructure.vpc',
        label: 'VPC Beta',
        ports: [],
        artifacts: [],
      },
      'svc-a1': {
        id: 'svc-a1',
        type: 'backend.backend-service',
        label: 'API Alpha',
        ports: [],
        artifacts: [],
        parentId: 'vpc-a',
      },
      'svc-a2': {
        id: 'svc-a2',
        type: 'backend.backend-service',
        label: 'Worker Alpha',
        ports: [],
        artifacts: [],
        parentId: 'vpc-a',
      },
      'svc-b1': {
        id: 'svc-b1',
        type: 'backend.backend-service',
        label: 'API Beta',
        ports: [],
        artifacts: [],
        parentId: 'vpc-b',
      },
      'svc-free': {
        id: 'svc-free',
        type: 'backend.backend-service',
        label: 'Standalone Service',
        ports: [],
        artifacts: [],
      },
    },
    edges: {
      'e-intra': {
        id: 'e-intra',
        source: 'svc-a1',
        target: 'svc-a2',
        contractId: 'c-1',
      },
      'e-cross': {
        id: 'e-cross',
        source: 'svc-a1',
        target: 'svc-b1',
        contractId: 'c-2',
      },
      'e-ext-to-container': {
        id: 'e-ext-to-container',
        source: 'svc-free',
        target: 'svc-a1',
        contractId: 'c-3',
      },
      'e-ext-free': {
        id: 'e-ext-free',
        source: 'svc-free',
        target: 'svc-free',
        contractId: 'c-4',
      },
    },
    contracts: {
      'c-1': { id: 'c-1', name: 'Internal RPC', kind: 'grpc', schema: {} },
      'c-2': { id: 'c-2', name: 'Cross API', kind: 'rest', schema: {} },
      'c-3': { id: 'c-3', name: 'External Call', kind: 'rest', schema: {} },
      'c-4': { id: 'c-4', name: 'Self Loop', kind: 'rest', schema: {} },
    },
  };
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
      'ns-b': {
        id: 'ns-b',
        type: 'orchestration.k8s-namespace',
        label: 'Namespace B',
        ports: [],
        artifacts: [],
        parentId: 'cluster',
      },
      'pod-a1': {
        id: 'pod-a1',
        type: 'backend.backend-service',
        label: 'Pod A1',
        ports: [],
        artifacts: [],
        parentId: 'ns-a',
      },
      'pod-b1': {
        id: 'pod-b1',
        type: 'backend.backend-service',
        label: 'Pod B1',
        ports: [],
        artifacts: [],
        parentId: 'ns-b',
      },
    },
    edges: {
      'e-within-cluster': {
        id: 'e-within-cluster',
        source: 'pod-a1',
        target: 'pod-b1',
        contractId: 'c-1',
      },
    },
    contracts: {
      'c-1': { id: 'c-1', name: 'Inter-NS', kind: 'grpc', schema: {} },
    },
  };
}

describe('Edge Classification - findDirectContainerId', () => {
  it('returns null for nodes without a parent', () => {
    const graph = makeTwoContainerGraph();
    expect(findDirectContainerId('svc-free', graph)).toBeNull();
  });

  it('returns the direct container parent', () => {
    const graph = makeTwoContainerGraph();
    expect(findDirectContainerId('svc-a1', graph)).toBe('vpc-a');
  });

  it('returns null for a node whose parent is not a container', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'group-1': { id: 'group-1', type: 'backend.backend-service', label: 'Group', ports: [], artifacts: [] },
        'child-1': { id: 'child-1', type: 'backend.backend-service', label: 'Child', ports: [], artifacts: [], parentId: 'group-1' },
      },
    };
    expect(findDirectContainerId('child-1', graph)).toBeNull();
  });
});

describe('Edge Classification - findRootContainerId', () => {
  it('returns the top-level container for deeply nested nodes', () => {
    const graph = makeNestedContainerGraph();
    expect(findRootContainerId('pod-a1', graph)).toBe('cluster');
  });

  it('returns direct parent when there is only one level of nesting', () => {
    const graph = makeTwoContainerGraph();
    expect(findRootContainerId('svc-a1', graph)).toBe('vpc-a');
  });

  it('returns null for nodes without a container parent', () => {
    const graph = makeTwoContainerGraph();
    expect(findRootContainerId('svc-free', graph)).toBeNull();
  });
});

describe('Edge Classification - classifyEdge', () => {
  it('classifies intra-container edges (same direct container)', () => {
    const graph = makeTwoContainerGraph();
    expect(classifyEdge(graph.edges['e-intra'], graph)).toBe('intra-container');
  });

  it('classifies cross-container edges (different containers)', () => {
    const graph = makeTwoContainerGraph();
    expect(classifyEdge(graph.edges['e-cross'], graph)).toBe('cross-container');
  });

  it('classifies edges involving uncontained nodes as external', () => {
    const graph = makeTwoContainerGraph();
    expect(classifyEdge(graph.edges['e-ext-to-container'], graph)).toBe('external');
  });

  it('classifies edges between two uncontained nodes as external', () => {
    const graph = makeTwoContainerGraph();
    expect(classifyEdge(graph.edges['e-ext-free'], graph)).toBe('external');
  });

  it('classifies edges between sibling namespaces under the same cluster as cross-container', () => {
    const graph = makeNestedContainerGraph();
    expect(classifyEdge(graph.edges['e-within-cluster'], graph)).toBe('cross-container');
  });
});

describe('Edge Routing - mapGraphToRFEdges with layer modes', () => {
  // Owner 2026-07-29: nodes draw ABOVE edges — every edge zIndex sits strictly
  // between container fills (1) and leaf nodes (10). Relative ordering among
  // edge kinds is preserved (containment < intra < external < cross).
  it('nested mode: cross-container edges are visible, below leaf nodes', () => {
    const graph = makeTwoContainerGraph();
    const rfEdges = mapGraphToRFEdges(graph, 'nested');
    const crossEdge = rfEdges.find(e => e.id === 'e-cross');
    expect(crossEdge?.hidden).toBeFalsy();
    expect(crossEdge?.data?.edgeVisibility).toBe('cross-container');
    expect(crossEdge?.zIndex).toBe(7);
  });

  it('nested mode: shows intra-container edges with lower zIndex', () => {
    const graph = makeTwoContainerGraph();
    const rfEdges = mapGraphToRFEdges(graph, 'nested');
    const intraEdge = rfEdges.find(e => e.id === 'e-intra');
    expect(intraEdge?.hidden).toBeFalsy();
    expect(intraEdge?.data?.edgeVisibility).toBe('intra-container');
    expect(intraEdge?.zIndex).toBe(4);
  });

  it('nested mode: shows external edges normally, still under nodes', () => {
    const graph = makeTwoContainerGraph();
    const rfEdges = mapGraphToRFEdges(graph, 'nested');
    const extEdge = rfEdges.find(e => e.id === 'e-ext-to-container');
    expect(extEdge?.hidden).toBeFalsy();
    expect(extEdge?.data?.edgeVisibility).toBe('external');
    expect(extEdge?.zIndex).toBe(5);
  });

  it('every edge kind renders BELOW leaf nodes (zIndex 10) and above containers (1)', () => {
    const graph = makeTwoContainerGraph();
    const rfEdges = mapGraphToRFEdges(graph, 'nested');
    for (const e of rfEdges) {
      expect(e.zIndex, `edge ${e.id}`).toBeLessThan(10);
      expect(e.zIndex, `edge ${e.id}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('flat mode: all edges have external visibility and are visible', () => {
    const graph = makeTwoContainerGraph();
    const rfEdges = mapGraphToRFEdges(graph, 'flat');
    for (const edge of rfEdges) {
      expect(edge.data?.edgeVisibility).toBe('external');
      expect(edge.hidden).toBeFalsy();
    }
  });

  it('passes layerMode through to each RFEdge data', () => {
    const graph = makeTwoContainerGraph();
    const nestedEdges = mapGraphToRFEdges(graph, 'nested');
    const flatEdges = mapGraphToRFEdges(graph, 'flat');
    for (const edge of nestedEdges) {
      expect(edge.data?.layerMode).toBe('nested');
    }
    for (const edge of flatEdges) {
      expect(edge.data?.layerMode).toBe('flat');
    }
  });
});

describe('Edge Routing - mapEdgeToRFEdge classification fields', () => {
  it('includes edgeVisibility and layerMode in data', () => {
    const graph = makeTwoContainerGraph();
    const edge = graph.edges['e-intra'];
    const rfEdge = mapEdgeToRFEdge(edge, graph, 0, 'intra-container', 'nested');
    expect(rfEdge.data!.edgeVisibility).toBe('intra-container');
    expect(rfEdge.data!.layerMode).toBe('nested');
  });
});

describe('Cross-Container Summaries', () => {
  it('computes summaries for containers with cross-container edges', () => {
    const graph = makeTwoContainerGraph();
    const summaries = computeCrossContainerSummaries(graph);

    const vpcASummaries = summaries.get('vpc-a');
    expect(vpcASummaries).toBeDefined();
    expect(vpcASummaries!.length).toBe(1);
    expect(vpcASummaries![0].targetContainerId).toBe('vpc-b');
    expect(vpcASummaries![0].edges.length).toBe(1);
    expect(vpcASummaries![0].edges[0].edgeId).toBe('e-cross');
  });

  it('provides bidirectional summaries (both containers get the summary)', () => {
    const graph = makeTwoContainerGraph();
    const summaries = computeCrossContainerSummaries(graph);

    expect(summaries.get('vpc-a')).toBeDefined();
    expect(summaries.get('vpc-b')).toBeDefined();
    expect(summaries.get('vpc-a')![0].targetContainerLabel).toBe('VPC Beta');
    expect(summaries.get('vpc-b')![0].targetContainerLabel).toBe('VPC Alpha');
  });

  it('returns empty map for graphs with no cross-container edges', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'vpc-a': { id: 'vpc-a', type: 'infrastructure.vpc', label: 'VPC', ports: [], artifacts: [] },
        'svc-a': { id: 'svc-a', type: 'backend.backend-service', label: 'Svc', ports: [], artifacts: [], parentId: 'vpc-a' },
      },
      edges: {},
      contracts: {},
    };
    const summaries = computeCrossContainerSummaries(graph);
    expect(summaries.size).toBe(0);
  });

  it('does not produce summaries for external edges', () => {
    const graph = makeTwoContainerGraph();
    const summaries = computeCrossContainerSummaries(graph);
    expect(summaries.has('svc-free')).toBe(false);
  });

  it('handles nested containers: produces cross-container summaries for sibling namespaces under same cluster', () => {
    const graph = makeNestedContainerGraph();
    const summaries = computeCrossContainerSummaries(graph);
    expect(summaries.has('ns-a')).toBe(true);
    expect(summaries.has('ns-b')).toBe(true);
  });
});

describe('deriveRFState - Edge integration with layerMode', () => {
  it('nested mode: cross-container edges are visible, intra edges are visible', () => {
    const graph = makeTwoContainerGraph();
    const state = deriveRFState(graph, 'nested');

    const crossEdge = state.edges.find(e => e.id === 'e-cross');
    const intraEdge = state.edges.find(e => e.id === 'e-intra');

    expect(crossEdge?.hidden).toBeFalsy();
    expect(crossEdge?.data?.edgeVisibility).toBe('cross-container');
    expect(intraEdge?.hidden).toBeFalsy();
  });

  it('flat mode: all edges visible', () => {
    const graph = makeTwoContainerGraph();
    const state = deriveRFState(graph, 'flat');

    for (const edge of state.edges) {
      expect(edge.hidden).toBeFalsy();
    }
  });
});

describe('Edge Routing - Source File Integrity', () => {
  it('RFEdgeData includes edgeVisibility and layerMode fields', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/adapters/graph-to-reactflow.ts'),
      'utf-8'
    );
    expect(source).toContain("edgeVisibility?: EdgeVisibility");
    expect(source).toContain("layerMode?: ArchitectureLayerMode");
  });

  it('EdgeVisibility type has all required classifications', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/adapters/graph-to-reactflow.ts'),
      'utf-8'
    );
    expect(source).toContain("'intra-container' | 'cross-container' | 'containment' | 'external'");
  });

  it('CustomEdge imports and uses EdgeVisibility from the adapter', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/edges/CustomEdge.tsx'),
      'utf-8'
    );
    expect(source).toContain('EdgeVisibility');
    expect(source).toContain('edgeVisibility');
    expect(source).toContain('isIntraContainer');
  });

  it('ContainerNode imports and uses ContainerConnectionBadge', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/nodes/ContainerNode.tsx'),
      'utf-8'
    );
    expect(source).toContain('ContainerConnectionBadge');
    expect(source).toContain('crossContainerSummaries');
  });

  it('Canvas.tsx computes cross-container summaries and passes them to nodes', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/layout/Canvas.tsx'),
      'utf-8'
    );
    expect(source).toContain('computeCrossContainerSummaries');
    expect(source).toContain('crossContainerSummaries');
    expect(source).toContain('layerMode');
  });

  it('mapGraphToRFEdges accepts layerMode and catalog parameters', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/adapters/graph-to-reactflow.ts'),
      'utf-8'
    );
    expect(source).toMatch(/mapGraphToRFEdges\(graph.*layerMode.*catalog/);
  });
});

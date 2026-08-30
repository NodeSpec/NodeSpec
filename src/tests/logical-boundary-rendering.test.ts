import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Graph } from '@nodespec/core/types.js';
import {
  mapNodeToRFNode,
  mapGraphToRFNodes,
  deriveRFState,
  isAncestorCollapsed,
  computeNestingDepth,
  computeMaxNestingDepth,
} from '../ui/adapters/graph-to-reactflow.js';
import {
  resolveRFVisualType,
  isContainerType,
  isLogicalBoundaryType,
} from '../ui/adapters/rf-visual-type-resolver.js';
import { getContainerTypeById } from '@nodespec/core/container-types.js';

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

// N10(c) 2026-08-09: 'service-mesh' left this list with its re-filing — it is a
// Networking LEAF now (migration 20260810100000), not a logical boundary.
const LOGICAL_BOUNDARY_TYPES = [
  'microservice-boundary',
  'bounded-context',
  'application-module',
  'software-layer',
];

const HOSTING_CONTAINER_TYPES = [
  'vpc',
  'k8s-cluster',
  'k8s-namespace',
  'docker-container',
  'docker-compose',
];

function makeBoundaryGraph(boundaryType: string = 'bounded-context'): Graph {
  return {
    ...emptyGraph,
    nodes: {
      'boundary-1': {
        id: 'boundary-1',
        type: boundaryType,
        label: 'Order Domain',
        ports: [],
        artifacts: [],
      },
      'svc-1': {
        id: 'svc-1',
        type: 'backend.backend-service',
        label: 'Order Service',
        ports: [],
        artifacts: [],
        parentId: 'boundary-1',
      },
      'svc-2': {
        id: 'svc-2',
        type: 'backend.backend-service',
        label: 'Payment Service',
        ports: [],
        artifacts: [],
        parentId: 'boundary-1',
      },
      'svc-3': {
        id: 'svc-3',
        type: 'backend.backend-service',
        label: 'External Service',
        ports: [],
        artifacts: [],
      },
    },
  };
}

function makeMixedGraph(): Graph {
  return {
    ...emptyGraph,
    nodes: {
      'vpc-1': {
        id: 'vpc-1',
        type: 'infrastructure.vpc',
        label: 'Prod VPC',
        ports: [],
        artifacts: [],
      },
      'boundary-1': {
        id: 'boundary-1',
        type: 'bounded-context',
        label: 'Order Domain',
        ports: [],
        artifacts: [],
      },
      'svc-vpc': {
        id: 'svc-vpc',
        type: 'backend.backend-service',
        label: 'VPC Service',
        ports: [],
        artifacts: [],
        parentId: 'vpc-1',
      },
      'svc-boundary': {
        id: 'svc-boundary',
        type: 'backend.backend-service',
        label: 'Boundary Service',
        ports: [],
        artifacts: [],
        parentId: 'boundary-1',
      },
    },
  };
}

describe('Logical Boundary Type Resolution', () => {
  it.each(LOGICAL_BOUNDARY_TYPES)('resolves %s as logicalBoundary RF type', (type) => {
    expect(resolveRFVisualType(type)).toBe('logicalBoundary');
  });

  it.each(LOGICAL_BOUNDARY_TYPES)('isContainerType returns true for %s', (type) => {
    expect(isContainerType(type)).toBe(true);
  });

  it.each(LOGICAL_BOUNDARY_TYPES)('isLogicalBoundaryType returns true for %s', (type) => {
    expect(isLogicalBoundaryType(type)).toBe(true);
  });

  it.each(HOSTING_CONTAINER_TYPES)('isLogicalBoundaryType returns false for hosting type %s', (type) => {
    expect(isLogicalBoundaryType(type)).toBe(false);
  });

  it.each(HOSTING_CONTAINER_TYPES)('resolves hosting type %s as container (not logicalBoundary)', (type) => {
    expect(resolveRFVisualType(type)).toBe('container');
  });

  it('resolves legacy prefixed types correctly', () => {
    expect(resolveRFVisualType('logical.bounded-context')).toBe('logicalBoundary');
    expect(resolveRFVisualType('logical.software-layer')).toBe('logicalBoundary');
    expect(resolveRFVisualType('logical.application-module')).toBe('logicalBoundary');
  });

  it.each(LOGICAL_BOUNDARY_TYPES)('static container def for %s has containerStyle logical-boundary', (type) => {
    const def = getContainerTypeById(type);
    expect(def).toBeDefined();
    expect(def!.containerStyle).toBe('logical-boundary');
    expect(def!.layer).toBe('logical');
  });
});

describe('Logical Boundary - Flat Mode Behavior', () => {
  it('logical boundary is NOT hidden in flat mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'flat');
    expect(rfNode.hidden).toBeFalsy();
  });

  it('logical boundary type is logicalBoundary in flat mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'flat');
    expect(rfNode.type).toBe('logicalBoundary');
  });

  it('logical boundary gets width/height sizing in flat mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'flat');
    expect(rfNode.width).toBeGreaterThan(0);
    expect(rfNode.height).toBeGreaterThan(0);
  });

  it('children of logical boundary have parentId set in flat mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'flat');
    expect(rfNode.parentId).toBe('boundary-1');
  });

  it('children of logical boundary have extent parent in flat mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'flat');
    expect(rfNode.extent).toBe('parent');
  });

  it('children of logical boundary do NOT get containerParentLabel in flat mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'flat');
    expect(rfNode.data.containerParentLabel).toBeUndefined();
  });

  it('hosting container IS hidden in flat mode (contrast)', () => {
    const graph = makeMixedGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['vpc-1'], graph, 'flat');
    expect(rfNode.hidden).toBe(true);
  });

  it('child of hosting container does NOT get parentId in flat mode (contrast)', () => {
    const graph = makeMixedGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-vpc'], graph, 'flat');
    expect(rfNode.parentId).toBeUndefined();
  });
});

describe('Logical Boundary - Nested Mode Behavior', () => {
  it('logical boundary is visible in nested mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'nested');
    expect(rfNode.hidden).toBeFalsy();
  });

  it('logical boundary type is logicalBoundary in nested mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'nested');
    expect(rfNode.type).toBe('logicalBoundary');
  });

  it('children of logical boundary keep their resolved type (not compactIcon)', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'nested');
    expect(rfNode.type).not.toBe('compactIcon');
  });

  it('children of logical boundary have parentId set in nested mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'nested');
    expect(rfNode.parentId).toBe('boundary-1');
  });

  it('children of logical boundary have extent parent in nested mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'nested');
    expect(rfNode.extent).toBe('parent');
  });

  it('children of hosting container use icon type in nested mode (contrast)', () => {
    const graph = makeMixedGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-vpc'], graph, 'nested');
    expect(rfNode.type).toBe('icon');
  });

  it('children of hosting container have extent parent in nested mode (contrast)', () => {
    const graph = makeMixedGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-vpc'], graph, 'nested');
    expect(rfNode.extent).toBe('parent');
  });

  it('logical boundary gets width/height in nested mode', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'nested');
    expect(rfNode.width).toBeGreaterThan(0);
    expect(rfNode.height).toBeGreaterThan(0);
  });
});

describe('Logical Boundary - Mixed Container Graph', () => {
  it('flat mode: hosting container hidden, logical boundary visible', () => {
    const graph = makeMixedGraph();
    const nodes = mapGraphToRFNodes(graph, 'flat');

    const vpc = nodes.find(n => n.id === 'vpc-1');
    const boundary = nodes.find(n => n.id === 'boundary-1');

    expect(vpc?.hidden).toBe(true);
    expect(boundary?.hidden).toBeFalsy();
  });

  it('nested mode: both container types visible', () => {
    const graph = makeMixedGraph();
    const nodes = mapGraphToRFNodes(graph, 'nested');

    const vpc = nodes.find(n => n.id === 'vpc-1');
    const boundary = nodes.find(n => n.id === 'boundary-1');

    expect(vpc?.hidden).toBeFalsy();
    expect(boundary?.hidden).toBeFalsy();
    expect(vpc?.type).toBe('container');
    expect(boundary?.type).toBe('logicalBoundary');
  });

  it('deriveRFState includes logical boundaries in both modes', () => {
    const graph = makeBoundaryGraph();
    const flatState = deriveRFState(graph, 'flat');
    const nestedState = deriveRFState(graph, 'nested');

    const flatBoundary = flatState.nodes.find(n => n.id === 'boundary-1');
    const nestedBoundary = nestedState.nodes.find(n => n.id === 'boundary-1');

    expect(flatBoundary?.hidden).toBeFalsy();
    expect(nestedBoundary?.hidden).toBeFalsy();
    expect(flatBoundary?.type).toBe('logicalBoundary');
    expect(nestedBoundary?.type).toBe('logicalBoundary');
  });

  it('all nodes accounted for in both modes with logical boundaries', () => {
    const graph = makeBoundaryGraph();
    const flatNodes = mapGraphToRFNodes(graph, 'flat');
    const nestedNodes = mapGraphToRFNodes(graph, 'nested');

    expect(flatNodes.length).toBe(Object.keys(graph.nodes).length);
    expect(nestedNodes.length).toBe(Object.keys(graph.nodes).length);
  });
});

describe('Logical Boundary - zIndex and Layering', () => {
  it('logical boundary has low zIndex (background)', () => {
    const graph = makeBoundaryGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'nested');
    expect(rfNode.zIndex).toBeLessThanOrEqual(1);
  });

  it('children of logical boundary have higher zIndex', () => {
    const graph = makeBoundaryGraph();
    const boundary = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'nested');
    const child = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'nested');
    expect(child.zIndex!).toBeGreaterThan(boundary.zIndex!);
  });
});

describe('Logical Boundary - Source File Integrity', () => {
  function readSource(relativePath: string): string {
    return readFileSync(resolve(__dirname, '..', relativePath), 'utf-8');
  }

  it('rf-visual-type-resolver includes logicalBoundary in VALID_RF_TYPES', () => {
    const source = readSource('ui/adapters/rf-visual-type-resolver.ts');
    expect(source).toContain("'logicalBoundary'");
  });

  it('rf-visual-type-resolver exports isLogicalBoundaryType', () => {
    const source = readSource('ui/adapters/rf-visual-type-resolver.ts');
    expect(source).toContain('export function isLogicalBoundaryType');
  });

  it('graph-to-reactflow imports isLogicalBoundaryType', () => {
    const source = readSource('ui/adapters/graph-to-reactflow.ts');
    expect(source).toContain('isLogicalBoundaryType');
  });

  it('graph-to-reactflow does not hide logical boundaries in flat mode', () => {
    const source = readSource('ui/adapters/graph-to-reactflow.ts');
    expect(source).toContain('!nodeIsLogicalBoundary');
  });

  it('LogicalBoundaryNode component exists with dashed border', () => {
    const source = readSource('ui/components/nodes/LogicalBoundaryNode.tsx');
    expect(source).toContain('dashed');
    expect(source).toContain('LogicalBoundaryNode');
  });

  it('nodeTypes map includes logicalBoundary entry', () => {
    const source = readSource('ui/components/nodes/SpecializedNodes.tsx');
    expect(source).toContain('logicalBoundary:');
    expect(source).toContain('LogicalBoundaryNode');
  });

  it('LogicalBoundaryNode supports resize and collapse toggle', () => {
    const source = readSource('ui/components/nodes/LogicalBoundaryNode.tsx');
    expect(source).toContain('NodeResizer');
    expect(source).toContain('handleResize');
    expect(source).toContain('containerExpanded');
    expect(source).toContain('handleToggleExpand');
  });
});

describe('Logical Boundary - Collapse/Expand Behavior', () => {
  function makeCollapsibleBoundaryGraph(expanded: boolean): Graph {
    return {
      ...emptyGraph,
      nodes: {
        'boundary-1': {
          id: 'boundary-1',
          type: 'bounded-context',
          label: 'Order Domain',
          ports: [],
          artifacts: [],
          metadata: { containerExpanded: expanded },
        },
        'svc-1': {
          id: 'svc-1',
          type: 'backend.backend-service',
          label: 'Order Service',
          ports: [],
          artifacts: [],
          parentId: 'boundary-1',
        },
        'svc-2': {
          id: 'svc-2',
          type: 'backend.backend-service',
          label: 'Payment Service',
          ports: [],
          artifacts: [],
          parentId: 'boundary-1',
        },
      },
    };
  }

  it('collapsed logical boundary gets compact dimensions in nested mode', () => {
    const graph = makeCollapsibleBoundaryGraph(false);
    const rfNode = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'nested');
    expect(rfNode.width).toBe(220);
    expect(rfNode.height).toBe(56);
  });

  it('expanded logical boundary gets full dimensions in nested mode', () => {
    const graph = makeCollapsibleBoundaryGraph(true);
    const rfNode = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'nested');
    expect(rfNode.width).toBeGreaterThan(220);
    expect(rfNode.height).toBeGreaterThan(56);
  });

  it('children of collapsed logical boundary are hidden in nested mode', () => {
    const graph = makeCollapsibleBoundaryGraph(false);
    const svc1 = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'nested');
    const svc2 = mapNodeToRFNode(graph.nodes['svc-2'], graph, 'nested');
    expect(svc1.hidden).toBe(true);
    expect(svc2.hidden).toBe(true);
  });

  it('children of expanded logical boundary are visible in nested mode', () => {
    const graph = makeCollapsibleBoundaryGraph(true);
    const svc1 = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'nested');
    const svc2 = mapNodeToRFNode(graph.nodes['svc-2'], graph, 'nested');
    expect(svc1.hidden).toBeFalsy();
    expect(svc1.parentId).toBe('boundary-1');
    expect(svc2.hidden).toBeFalsy();
    expect(svc2.parentId).toBe('boundary-1');
  });

  it('children of collapsed logical boundary are hidden in flat mode', () => {
    const graph = makeCollapsibleBoundaryGraph(false);
    const svc1 = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'flat');
    const svc2 = mapNodeToRFNode(graph.nodes['svc-2'], graph, 'flat');
    expect(svc1.hidden).toBe(true);
    expect(svc2.hidden).toBe(true);
  });

  it('children of expanded logical boundary have parentId in flat mode', () => {
    const graph = makeCollapsibleBoundaryGraph(true);
    const svc1 = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'flat');
    expect(svc1.parentId).toBe('boundary-1');
    expect(svc1.hidden).toBeFalsy();
  });

  it('collapsed logical boundary gets compact dimensions in flat mode', () => {
    const graph = makeCollapsibleBoundaryGraph(false);
    const rfNode = mapNodeToRFNode(graph.nodes['boundary-1'], graph, 'flat');
    expect(rfNode.width).toBe(220);
    expect(rfNode.height).toBe(56);
  });
});

describe('Cascading Collapse - isAncestorCollapsed', () => {
  it('returns false when no ancestors are collapsed', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'vpc-1': {
          id: 'vpc-1',
          type: 'infrastructure.vpc',
          label: 'VPC',
          ports: [],
          artifacts: [],
          metadata: { containerExpanded: true },
        },
        'boundary-1': {
          id: 'boundary-1',
          type: 'bounded-context',
          label: 'Domain',
          ports: [],
          artifacts: [],
          parentId: 'vpc-1',
          metadata: { containerExpanded: true },
        },
        'svc-1': {
          id: 'svc-1',
          type: 'backend.backend-service',
          label: 'Service',
          ports: [],
          artifacts: [],
          parentId: 'boundary-1',
        },
      },
    };
    expect(isAncestorCollapsed('svc-1', graph)).toBe(false);
  });

  it('returns true when grandparent is collapsed', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'vpc-1': {
          id: 'vpc-1',
          type: 'infrastructure.vpc',
          label: 'VPC',
          ports: [],
          artifacts: [],
          metadata: { containerExpanded: false },
        },
        'boundary-1': {
          id: 'boundary-1',
          type: 'bounded-context',
          label: 'Domain',
          ports: [],
          artifacts: [],
          parentId: 'vpc-1',
          metadata: { containerExpanded: true },
        },
        'svc-1': {
          id: 'svc-1',
          type: 'backend.backend-service',
          label: 'Service',
          ports: [],
          artifacts: [],
          parentId: 'boundary-1',
        },
      },
    };
    expect(isAncestorCollapsed('svc-1', graph)).toBe(true);
  });

  it('returns false for top-level nodes', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'svc-1': {
          id: 'svc-1',
          type: 'backend.backend-service',
          label: 'Service',
          ports: [],
          artifacts: [],
        },
      },
    };
    expect(isAncestorCollapsed('svc-1', graph)).toBe(false);
  });
});

describe('Nesting Depth Computation', () => {
  function makeDeepGraph(): Graph {
    return {
      ...emptyGraph,
      nodes: {
        'cloud-1': {
          id: 'cloud-1',
          type: 'infrastructure.vpc',
          label: 'Cloud',
          ports: [],
          artifacts: [],
        },
        'vpc-1': {
          id: 'vpc-1',
          type: 'infrastructure.vpc',
          label: 'VPC',
          ports: [],
          artifacts: [],
          parentId: 'cloud-1',
        },
        'docker-1': {
          id: 'docker-1',
          type: 'docker-container',
          label: 'Docker',
          ports: [],
          artifacts: [],
          parentId: 'vpc-1',
        },
        'boundary-1': {
          id: 'boundary-1',
          type: 'bounded-context',
          label: 'Domain',
          ports: [],
          artifacts: [],
          parentId: 'docker-1',
        },
        'svc-1': {
          id: 'svc-1',
          type: 'backend.backend-service',
          label: 'Service',
          ports: [],
          artifacts: [],
          parentId: 'boundary-1',
        },
        'standalone': {
          id: 'standalone',
          type: 'backend.backend-service',
          label: 'Standalone',
          ports: [],
          artifacts: [],
        },
      },
    };
  }

  it('top-level node has depth 0', () => {
    const graph = makeDeepGraph();
    expect(computeNestingDepth('cloud-1', graph)).toBe(0);
    expect(computeNestingDepth('standalone', graph)).toBe(0);
  });

  it('first-level child has depth 1', () => {
    const graph = makeDeepGraph();
    expect(computeNestingDepth('vpc-1', graph)).toBe(1);
  });

  it('second-level child has depth 2', () => {
    const graph = makeDeepGraph();
    expect(computeNestingDepth('docker-1', graph)).toBe(2);
  });

  it('deeply nested node has depth 4', () => {
    const graph = makeDeepGraph();
    expect(computeNestingDepth('svc-1', graph)).toBe(4);
  });

  it('computeMaxNestingDepth returns the maximum depth in the graph', () => {
    const graph = makeDeepGraph();
    expect(computeMaxNestingDepth(graph)).toBe(4);
  });

  it('computeMaxNestingDepth returns 0 for flat graph', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'a': { id: 'a', type: 'backend.backend-service', label: 'A', ports: [], artifacts: [] },
        'b': { id: 'b', type: 'backend.backend-service', label: 'B', ports: [], artifacts: [] },
      },
    };
    expect(computeMaxNestingDepth(graph)).toBe(0);
  });
});

describe('Depth Limit Filtering', () => {
  function makeDepth3Graph(): Graph {
    return {
      ...emptyGraph,
      nodes: {
        'vpc-1': {
          id: 'vpc-1',
          type: 'infrastructure.vpc',
          label: 'VPC',
          ports: [],
          artifacts: [],
        },
        'k8s-1': {
          id: 'k8s-1',
          type: 'k8s-cluster',
          label: 'K8s',
          ports: [],
          artifacts: [],
          parentId: 'vpc-1',
        },
        'svc-1': {
          id: 'svc-1',
          type: 'backend.backend-service',
          label: 'Service',
          ports: [],
          artifacts: [],
          parentId: 'k8s-1',
        },
        'standalone': {
          id: 'standalone',
          type: 'backend.backend-service',
          label: 'Standalone',
          ports: [],
          artifacts: [],
        },
      },
    };
  }

  it('maxDepth=1 hides nodes with depth > 1 in nested mode', () => {
    const graph = makeDepth3Graph();
    const nodes = mapGraphToRFNodes(graph, 'nested', null, 1);
    const vpc = nodes.find(n => n.id === 'vpc-1');
    const k8s = nodes.find(n => n.id === 'k8s-1');
    const svc = nodes.find(n => n.id === 'svc-1');
    const standalone = nodes.find(n => n.id === 'standalone');

    expect(vpc?.hidden).toBeFalsy();
    expect(standalone?.hidden).toBeFalsy();
    expect(k8s?.hidden).toBe(true);
    expect(svc?.hidden).toBe(true);
  });

  it('maxDepth=2 shows depth 0 and 1, hides depth 2 in nested mode', () => {
    const graph = makeDepth3Graph();
    const nodes = mapGraphToRFNodes(graph, 'nested', null, 2);
    const vpc = nodes.find(n => n.id === 'vpc-1');
    const k8s = nodes.find(n => n.id === 'k8s-1');
    const svc = nodes.find(n => n.id === 'svc-1');

    expect(vpc?.hidden).toBeFalsy();
    expect(k8s?.hidden).toBeFalsy();
    expect(svc?.hidden).toBe(true);
  });

  it('maxDepth=undefined shows all nodes', () => {
    const graph = makeDepth3Graph();
    const nodes = mapGraphToRFNodes(graph, 'nested', null, undefined);
    const hiddenNodes = nodes.filter(n => n.hidden);
    expect(hiddenNodes.length).toBe(0);
  });

  it('depth filtering does not apply in flat mode', () => {
    const graph = makeDepth3Graph();
    const nodes = mapGraphToRFNodes(graph, 'flat', null, 1);
    const svc = nodes.find(n => n.id === 'svc-1');
    expect(svc?.hidden).toBeFalsy();
  });

  it('deriveRFState with maxDepth option hides deep nodes', () => {
    const graph = makeDepth3Graph();
    const result = deriveRFState(graph, 'nested', null, { maxDepth: 1 });
    const k8s = result.nodes.find(n => n.id === 'k8s-1');
    const svc = result.nodes.find(n => n.id === 'svc-1');
    expect(k8s?.hidden).toBe(true);
    expect(svc?.hidden).toBe(true);
  });

  it('deriveRFState reports detectedMaxDepth', () => {
    const graph = makeDepth3Graph();
    const result = deriveRFState(graph, 'nested');
    expect(result.detectedMaxDepth).toBe(2);
  });
});

describe('Smart Auto-Collapse on Deep Nesting', () => {
  function makeDeep4Graph(): Graph {
    return {
      ...emptyGraph,
      nodes: {
        'cloud-1': {
          id: 'cloud-1',
          type: 'infrastructure.vpc',
          label: 'Cloud',
          ports: [],
          artifacts: [],
        },
        'vpc-1': {
          id: 'vpc-1',
          type: 'infrastructure.vpc',
          label: 'VPC',
          ports: [],
          artifacts: [],
          parentId: 'cloud-1',
        },
        'docker-1': {
          id: 'docker-1',
          type: 'docker-container',
          label: 'Docker',
          ports: [],
          artifacts: [],
          parentId: 'vpc-1',
        },
        'boundary-1': {
          id: 'boundary-1',
          type: 'bounded-context',
          label: 'Domain',
          ports: [],
          artifacts: [],
          parentId: 'docker-1',
        },
        'svc-1': {
          id: 'svc-1',
          type: 'backend.backend-service',
          label: 'Service',
          ports: [],
          artifacts: [],
          parentId: 'boundary-1',
        },
      },
    };
  }

  it('detects auto-collapse candidates when depth > 3', () => {
    const graph = makeDeep4Graph();
    const result = deriveRFState(graph, 'nested', null, { autoCollapseDepth: 3 });
    expect(result.autoCollapsedNodeIds.length).toBeGreaterThan(0);
  });

  it('auto-collapse candidates are containers at or beyond the threshold', () => {
    const graph = makeDeep4Graph();
    const result = deriveRFState(graph, 'nested', null, { autoCollapseDepth: 3 });
    for (const nodeId of result.autoCollapsedNodeIds) {
      const depth = computeNestingDepth(nodeId, graph);
      expect(depth).toBeGreaterThanOrEqual(3);
    }
  });

  it('does not flag nodes that already have containerExpanded set', () => {
    const graph = makeDeep4Graph();
    graph.nodes['boundary-1'].metadata = { containerExpanded: true };
    const result = deriveRFState(graph, 'nested', null, { autoCollapseDepth: 3 });
    expect(result.autoCollapsedNodeIds).not.toContain('boundary-1');
  });

  it('does not flag non-container nodes for auto-collapse', () => {
    const graph = makeDeep4Graph();
    const result = deriveRFState(graph, 'nested', null, { autoCollapseDepth: 3 });
    expect(result.autoCollapsedNodeIds).not.toContain('svc-1');
  });

  it('returns empty autoCollapsedNodeIds when depth does not exceed threshold', () => {
    const graph = makeBoundaryGraph();
    const result = deriveRFState(graph, 'nested', null, { autoCollapseDepth: 3 });
    expect(result.autoCollapsedNodeIds).toEqual([]);
  });

  it('returns empty autoCollapsedNodeIds in flat mode', () => {
    const graph = makeDeep4Graph();
    const result = deriveRFState(graph, 'flat', null, { autoCollapseDepth: 3 });
    expect(result.autoCollapsedNodeIds).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Graph } from '@nodespec/core/types.js';
import {
  mapNodeToRFNode,
  mapGraphToRFNodes,
  deriveRFState,
  type CanvasViewMode,
  type ArchitectureLayerMode,
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

function makeContainerGraph(): Graph {
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
      'svc-1': {
        id: 'svc-1',
        type: 'backend.backend-service',
        label: 'API Service',
        ports: [],
        artifacts: [],
        parentId: 'vpc-1',
      },
      'svc-2': {
        id: 'svc-2',
        type: 'backend.backend-service',
        label: 'Auth Service',
        ports: [],
        artifacts: [],
      },
    },
  };
}

describe('View Architecture - Type Safety', () => {
  it('CanvasViewMode only allows decomposition and architecture', () => {
    const validModes: CanvasViewMode[] = ['decomposition', 'architecture'];
    expect(validModes).toHaveLength(2);
    expect(validModes).toContain('decomposition');
    expect(validModes).toContain('architecture');
  });

  it('ArchitectureLayerMode only allows flat and nested', () => {
    const validModes: ArchitectureLayerMode[] = ['flat', 'nested'];
    expect(validModes).toHaveLength(2);
    expect(validModes).toContain('flat');
    expect(validModes).toContain('nested');
  });
});

describe('View Architecture - Flat/Nested Layer Mode Behavior', () => {
  it('flat mode hides containers', () => {
    const graph = makeContainerGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['vpc-1'], graph, 'flat');
    expect(rfNode.hidden).toBe(true);
  });

  it('flat mode shows non-container nodes', () => {
    const graph = makeContainerGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'flat');
    expect(rfNode.hidden).toBeFalsy();
  });

  it('flat mode adds containerParentLabel for children of containers', () => {
    const graph = makeContainerGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'flat');
    expect(rfNode.data.containerParentLabel).toBe('Prod VPC');
  });

  it('flat mode does not assign parentId to React Flow nodes', () => {
    const graph = makeContainerGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'flat');
    expect(rfNode.parentId).toBeUndefined();
  });

  it('nested mode shows containers as container type', () => {
    const graph = makeContainerGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['vpc-1'], graph, 'nested');
    expect(rfNode.type).toBe('container');
    expect(rfNode.hidden).toBeFalsy();
  });

  it('nested mode nests children inside parent via parentId', () => {
    const graph = makeContainerGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'nested');
    expect(rfNode.parentId).toBe('vpc-1');
    expect(rfNode.extent).toBe('parent');
  });

  // Icon demotion contract (N4/N4.5): in nested mode every non-container,
  // non-logical-boundary node demotes to the 'icon' RF type. 'compactIcon' is a
  // separate node-size rendering (data.nodeSize, toggled via the CanvasDock in flat
  // view) — it has never been what mapNodeToRFNode assigns to nested children.
  it('nested mode demotes child nodes to the icon type', () => {
    const graph = makeContainerGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'nested');
    expect(rfNode.type).toBe('icon');
  });

  it('nested mode does not hide orphan (non-parented) nodes', () => {
    const graph = makeContainerGraph();
    const rfNode = mapNodeToRFNode(graph.nodes['svc-2'], graph, 'nested');
    expect(rfNode.hidden).toBeFalsy();
  });

  it('deriveRFState defaults to nested layer mode', () => {
    const graph = makeContainerGraph();
    const state = deriveRFState(graph);
    const vpcNode = state.nodes.find(n => n.id === 'vpc-1');
    expect(vpcNode?.type).toBe('container');
  });
});

describe('View Architecture - Transition Completeness', () => {
  it('same graph produces different RF output for flat vs nested', () => {
    const graph = makeContainerGraph();
    const flatState = deriveRFState(graph, 'flat');
    const nestedState = deriveRFState(graph, 'nested');

    const flatVpc = flatState.nodes.find(n => n.id === 'vpc-1');
    const nestedVpc = nestedState.nodes.find(n => n.id === 'vpc-1');

    expect(flatVpc?.hidden).toBe(true);
    expect(nestedVpc?.hidden).toBeFalsy();
    expect(nestedVpc?.type).toBe('container');
  });

  it('all nodes accounted for in both modes', () => {
    const graph = makeContainerGraph();
    const flatNodes = mapGraphToRFNodes(graph, 'flat');
    const nestedNodes = mapGraphToRFNodes(graph, 'nested');

    expect(flatNodes.length).toBe(nestedNodes.length);
    expect(flatNodes.length).toBe(Object.keys(graph.nodes).length);
  });

  it('edges are identical regardless of layer mode', () => {
    const graph: Graph = {
      ...makeContainerGraph(),
      edges: {
        'e-1': {
          id: 'e-1',
          source: 'svc-1',
          target: 'svc-2',
          contractId: 'c-1',
        },
      },
      contracts: {
        'c-1': {
          id: 'c-1',
          name: 'HTTP',
          kind: 'rest',
          schema: {},
        },
      },
    };

    const flatState = deriveRFState(graph, 'flat');
    const nestedState = deriveRFState(graph, 'nested');

    expect(flatState.edges.length).toBe(nestedState.edges.length);
  });
});

describe('View Architecture - Source File Integrity', () => {
  it('ViewToggle exports only decomposition and architecture modes', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/common/ViewToggle.tsx'),
      'utf-8'
    );
    expect(source).toContain("'decomposition' | 'architecture'");
    expect(source).not.toContain("'nodes'");
    expect(source).not.toContain("'deployment'");
  });

  it('graph-to-reactflow adapter uses ArchitectureLayerMode not old CanvasViewMode', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/adapters/graph-to-reactflow.ts'),
      'utf-8'
    );
    expect(source).toContain("ArchitectureLayerMode = 'flat' | 'nested'");
    expect(source).not.toMatch(/viewMode.*=.*'deployment'/);
    expect(source).not.toMatch(/viewMode.*=.*'nodes'/);
  });

  it('Canvas.tsx does not import DeploymentCanvas', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/layout/Canvas.tsx'),
      'utf-8'
    );
    expect(source).not.toContain('DeploymentCanvas');
    expect(source).toContain('LayerModeToggle');
  });

  it('Canvas.tsx uses layerMode state for architecture sub-toggle', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/layout/Canvas.tsx'),
      'utf-8'
    );
    expect(source).toContain("useState<ArchitectureLayerMode>('flat')");
    expect(source).toContain('deriveRFState(effectiveGraph, layerMode, catalog, deriveOptions)');
  });

  it('layout barrel export does not export DeploymentCanvas', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/layout/index.ts'),
      'utf-8'
    );
    expect(source).not.toContain('DeploymentCanvas');
  });

  it('GraphEditor uses two-state view mode', () => {
    const source = readFileSync(
      resolve(__dirname, '../ui/components/GraphEditor.tsx'),
      'utf-8'
    );
    expect(source).toContain("'decomposition' | 'architecture'");
    expect(source).not.toMatch(/useState.*'nodes'/);
  });
});

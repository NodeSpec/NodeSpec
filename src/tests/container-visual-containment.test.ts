import { describe, it, expect } from 'vitest';
import { getContainerTypeById, getCanContainRoleIds } from '@nodespec/core/container-types.js';
import { mapGraphToRFNodes } from '../ui/adapters/graph-to-reactflow.js';
import type { Graph } from '@nodespec/core/types.js';

describe('Container Visual Containment', () => {
  describe('Container Type Registration', () => {
    it('should have K8s namespace as container', () => {
      const container = getContainerTypeById('k8s-namespace');
      expect(container).toBeDefined();
      expect(container?.layer).toBe('orchestration');
      expect(getCanContainRoleIds(container!).length).toBeGreaterThan(0);
    });

    it('should have VPC as container', () => {
      const container = getContainerTypeById('vpc');
      expect(container).toBeDefined();
      expect(container?.layer).toBe('infrastructure');
      expect(getCanContainRoleIds(container!).length).toBeGreaterThan(0);
    });

    it('should resolve Azure VNet to vpc container role', () => {
      const container = getContainerTypeById('infrastructure.vpc');
      expect(container).toBeDefined();
      expect(container?.id).toBe('vpc');
      expect(container?.layer).toBe('infrastructure');
      expect(getCanContainRoleIds(container!).length).toBeGreaterThan(0);
    });

    it('should resolve Google Cloud VPC to vpc container role', () => {
      const container = getContainerTypeById('infrastructure.vpc');
      expect(container).toBeDefined();
      expect(container?.id).toBe('vpc');
      expect(container?.layer).toBe('infrastructure');
      expect(getCanContainRoleIds(container!).length).toBeGreaterThan(0);
    });
  });

  describe('ReactFlow Parent Node Mapping', () => {
    it('should map K8s namespace to container type with sizing', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test',
        nodes: {
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Production',
            ports: [],
            artifacts: [],
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const rfNodes = mapGraphToRFNodes(graph);
      const nsNode = rfNodes[0];

      expect(nsNode.type).toBe('container');
      expect(nsNode.width).toBeGreaterThan(0);
      expect(nsNode.height).toBeGreaterThan(0);
    });

    it('should map AWS VPC to container type with sizing', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test',
        nodes: {
          'vpc-1': {
            id: 'vpc-1',
            type: 'infrastructure.vpc',
            label: 'Production VPC',
            ports: [],
            artifacts: [],
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const rfNodes = mapGraphToRFNodes(graph);
      const vpcNode = rfNodes[0];

      expect(vpcNode.type).toBe('container');
      expect(vpcNode.width).toBeGreaterThan(0);
      expect(vpcNode.height).toBeGreaterThan(0);
    });

    it('should map Azure VNet to container type with sizing', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test',
        nodes: {
          'vnet-1': {
            id: 'vnet-1',
            type: 'infrastructure.vpc',
            label: 'Production VNet',
            ports: [],
            artifacts: [],
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const rfNodes = mapGraphToRFNodes(graph);
      const vnetNode = rfNodes[0];

      expect(vnetNode.type).toBe('container');
      expect(vnetNode.width).toBeGreaterThan(0);
      expect(vnetNode.height).toBeGreaterThan(0);
    });

    it('should map Google Cloud VPC to container type with sizing', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test',
        nodes: {
          'gcp-vpc-1': {
            id: 'gcp-vpc-1',
            type: 'infrastructure.vpc',
            label: 'Production VPC',
            ports: [],
            artifacts: [],
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const rfNodes = mapGraphToRFNodes(graph);
      const gcpVpcNode = rfNodes[0];

      expect(gcpVpcNode.type).toBe('container');
      expect(gcpVpcNode.width).toBeGreaterThan(0);
      expect(gcpVpcNode.height).toBeGreaterThan(0);
    });
  });

  describe('Parent-Child Visual Containment', () => {
    it('should contain children within K8s namespace', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test',
        nodes: {
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Production',
            ports: [],
            artifacts: [],
          },
          'deploy-1': {
            id: 'deploy-1',
            type: 'backend-service',
            label: 'API',
            ports: [],
            artifacts: [],
            parentId: 'ns-1',
          },
          'deploy-2': {
            id: 'deploy-2',
            type: 'backend-service',
            label: 'Worker',
            ports: [],
            artifacts: [],
            parentId: 'ns-1',
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const rfNodes = mapGraphToRFNodes(graph);

      const parent = rfNodes.find(n => n.id === 'ns-1');
      const child1 = rfNodes.find(n => n.id === 'deploy-1');
      const child2 = rfNodes.find(n => n.id === 'deploy-2');

      expect(parent?.type).toBe('container');
      expect(parent?.data.metadata.childCount).toBe(2);
      // M4: two LEAF children. This asserted >600 only because the deleted
      // NODE_TYPE_TO_ROLE map resolved `runtime.kubernetes-deployment` to a CONTAINER
      // role, inflating nestedContainerCount — a k8s deployment is a workload, not a
      // container, so the old number was sizing for a mis-resolution.
      expect(parent?.width).toBeGreaterThanOrEqual(300);

      expect(child1?.parentId).toBe('ns-1');
      expect(child1?.extent).toBe('parent');

      expect(child2?.parentId).toBe('ns-1');
      expect(child2?.extent).toBe('parent');
    });

    it('should contain children within AWS VPC', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test',
        nodes: {
          'vpc-1': {
            id: 'vpc-1',
            type: 'infrastructure.vpc',
            label: 'Production VPC',
            ports: [],
            artifacts: [],
          },
          'subnet-1': {
            id: 'subnet-1',
            type: 'infrastructure.subnet',
            label: 'Public Subnet',
            ports: [],
            artifacts: [],
            parentId: 'vpc-1',
          },
          'cluster-1': {
            id: 'cluster-1',
            type: 'orchestration.k8s-cluster',
            label: 'EKS',
            ports: [],
            artifacts: [],
            parentId: 'vpc-1',
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const rfNodes = mapGraphToRFNodes(graph);

      const vpc = rfNodes.find(n => n.id === 'vpc-1');
      const subnet = rfNodes.find(n => n.id === 'subnet-1');
      const cluster = rfNodes.find(n => n.id === 'cluster-1');

      expect(vpc?.type).toBe('container');
      expect(vpc?.data.metadata.childCount).toBe(2);

      expect(subnet?.parentId).toBe('vpc-1');
      expect(subnet?.extent).toBe('parent');

      expect(cluster?.parentId).toBe('vpc-1');
      expect(cluster?.extent).toBe('parent');
    });

    it('should support nested containers (VPC > K8s > Namespace > Deployment)', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test',
        nodes: {
          'vpc-1': {
            id: 'vpc-1',
            type: 'infrastructure.vpc',
            label: 'VPC',
            ports: [],
            artifacts: [],
          },
          'cluster-1': {
            id: 'cluster-1',
            type: 'orchestration.k8s-cluster',
            label: 'EKS',
            ports: [],
            artifacts: [],
            parentId: 'vpc-1',
          },
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Production',
            ports: [],
            artifacts: [],
            parentId: 'cluster-1',
          },
          'deploy-1': {
            id: 'deploy-1',
            type: 'backend-service',
            label: 'API',
            ports: [],
            artifacts: [],
            parentId: 'ns-1',
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const rfNodes = mapGraphToRFNodes(graph);

      const vpc = rfNodes.find(n => n.id === 'vpc-1');
      const cluster = rfNodes.find(n => n.id === 'cluster-1');
      const namespace = rfNodes.find(n => n.id === 'ns-1');
      const deployment = rfNodes.find(n => n.id === 'deploy-1');

      expect(vpc?.type).toBe('container');
      expect(cluster?.type).toBe('container');
      expect(namespace?.type).toBe('container');

      expect(vpc?.data.metadata.childCount).toBe(1);
      expect(cluster?.data.metadata.childCount).toBe(1);
      expect(namespace?.data.metadata.childCount).toBe(1);

      expect(cluster?.parentId).toBe('vpc-1');
      expect(cluster?.extent).toBe('parent');

      expect(namespace?.parentId).toBe('cluster-1');
      expect(namespace?.extent).toBe('parent');

      expect(deployment?.parentId).toBe('ns-1');
      expect(deployment?.extent).toBe('parent');
    });
  });

  describe('Enriched Metadata', () => {
    it('should have production-ready K8s namespace metadata', () => {
      const container = getContainerTypeById('k8s-namespace');

      expect(container?.defaultMetadata.resourceQuota).toBe(true);
      expect(container?.defaultMetadata.cpuLimit).toBe('10');
      expect(container?.defaultMetadata.memoryLimit).toBe('20Gi');
      expect(container?.defaultMetadata.rbacEnabled).toBe(true);
      expect(container?.defaultMetadata.networkPolicies).toContain('deny-all-ingress');
    });

    it('should have production-ready VPC metadata', () => {
      const container = getContainerTypeById('vpc');

      expect(container?.defaultMetadata.cidrBlock).toBe('10.0.0.0/16');
      expect(container?.defaultMetadata.internetGateway).toBe(true);
      expect(container?.defaultMetadata.natGateway).toBe(true);
      expect(container?.defaultMetadata.flowLogsEnabled).toBe(true);
    });

    it('should resolve cloud variants to same VPC role with consistent metadata', () => {
      const awsVpc = getContainerTypeById('infrastructure.vpc');
      const azureVnet = getContainerTypeById('infrastructure.vpc');
      const gcpVpc = getContainerTypeById('infrastructure.vpc');

      expect(awsVpc?.defaultMetadata.cidrBlock).toBe('10.0.0.0/16');
      expect(azureVnet?.defaultMetadata.cidrBlock).toBe('10.0.0.0/16');
      expect(gcpVpc?.defaultMetadata.cidrBlock).toBe('10.0.0.0/16');
    });
  });

  describe('Size Calculation for Children', () => {
    it('should expand container size based on child count', () => {
      const graphWith0Children: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test',
        nodes: {
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Empty',
            ports: [],
            artifacts: [],
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const graphWith5Children: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test',
        nodes: {
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Full',
            ports: [],
            artifacts: [],
          },
          ...Object.fromEntries(
            Array.from({ length: 5 }, (_, i) => [
              `deploy-${i}`,
              {
                id: `deploy-${i}`,
                type: 'backend-service',
                label: `Deploy ${i}`,
                ports: [],
                artifacts: [],
                parentId: 'ns-1',
              },
            ])
          ),
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const rfNodesEmpty = mapGraphToRFNodes(graphWith0Children);
      const rfNodesFull = mapGraphToRFNodes(graphWith5Children);

      const emptyContainer = rfNodesEmpty[0];
      const fullContainer = rfNodesFull[0];

      const emptyHeight = typeof emptyContainer.height === 'number' ? emptyContainer.height : 0;
      const fullHeight = typeof fullContainer.height === 'number' ? fullContainer.height : 0;
      expect(emptyHeight).toBeLessThan(fullHeight);
      expect(fullContainer.data.metadata.childCount).toBe(5);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { getContainerTypeById, canContainerHoldNode } from '@nodespec/core/container-types.js';
import { mapGraphToRFNodes } from '../ui/adapters/graph-to-reactflow.js';
import type { Graph, Node } from '@nodespec/core/types.js';

describe('K8s Namespace Containment', () => {
  describe('Container Definition', () => {
    it('should have K8s namespace defined as container', () => {
      const namespace = getContainerTypeById('k8s-namespace');

      expect(namespace).toBeDefined();
      expect(namespace?.layer).toBe('orchestration');
      expect(namespace?.canContain).toContain('docker-container');
      expect(namespace?.canContain).toContain('backend-service');
    });

    it('should resolve legacy dotted IDs', () => {
      const namespace = getContainerTypeById('orchestration.k8s-namespace');
      expect(namespace).toBeDefined();
      expect(namespace?.id).toBe('k8s-namespace');
    });

    it('should accept K8s deployments via role resolution', () => {
      expect(canContainerHoldNode('k8s-namespace', 'runtime.backend-service')).toBe(true);
      
    });

    it('should have production-ready metadata', () => {
      const namespace = getContainerTypeById('k8s-namespace');

      expect(namespace?.defaultMetadata.resourceQuota).toBe(true);
      expect(namespace?.defaultMetadata.cpuLimit).toBe('10');
      expect(namespace?.defaultMetadata.memoryLimit).toBe('20Gi');
      expect(Array.isArray(namespace?.defaultMetadata.networkPolicies)).toBe(true);
    });
  });

  describe('Parent-Child Relationships', () => {
    it('should store parentId in node schema', () => {
      const deployment: Node = {
        id: 'deploy-1',
        type: 'runtime.backend-service',
        label: 'API Deployment',
        ports: [],
        artifacts: [],
        parentId: 'ns-1',
      };

      expect(deployment.parentId).toBe('ns-1');
    });

    it('should map parentId to ReactFlow parent property', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test-hash',
        nodes: {
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Production Namespace',
            ports: [],
            artifacts: [],
          },
          'deploy-1': {
            id: 'deploy-1',
            type: 'runtime.backend-service',
            label: 'API Deployment',
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

      const namespaceNode = rfNodes.find(n => n.id === 'ns-1');
      const deploymentNode = rfNodes.find(n => n.id === 'deploy-1');

      expect(namespaceNode).toBeDefined();
      expect(namespaceNode?.type).toBe('container');

      expect(deploymentNode).toBeDefined();
      expect(deploymentNode?.parentId).toBe('ns-1');
      expect(deploymentNode?.extent).toBe('parent');
    });

    it('should handle multiple children in same namespace', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test-hash',
        nodes: {
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Production Namespace',
            ports: [],
            artifacts: [],
          },
          'deploy-1': {
            id: 'deploy-1',
            type: 'runtime.backend-service',
            label: 'API Deployment',
            ports: [],
            artifacts: [],
            parentId: 'ns-1',
          },
          'deploy-2': {
            id: 'deploy-2',
            type: 'runtime.backend-service',
            label: 'Worker Deployment',
            ports: [],
            artifacts: [],
            parentId: 'ns-1',
          },
          'svc-1': {
            id: 'svc-1',
            type: 'runtime.kubernetes-service',
            label: 'API Service',
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

      const children = rfNodes.filter(n => n.parentId === 'ns-1');
      expect(children).toHaveLength(3);

      children.forEach(child => {
        expect(child.extent).toBe('parent');
      });
    });

    it('should handle nested containers (cluster > namespace > deployment)', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test-hash',
        nodes: {
          'cluster-1': {
            id: 'cluster-1',
            type: 'orchestration.k8s-cluster',
            label: 'EKS Cluster',
            ports: [],
            artifacts: [],
          },
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Production Namespace',
            ports: [],
            artifacts: [],
            parentId: 'cluster-1',
          },
          'deploy-1': {
            id: 'deploy-1',
            type: 'runtime.backend-service',
            label: 'API Deployment',
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

      const cluster = rfNodes.find(n => n.id === 'cluster-1');
      const namespace = rfNodes.find(n => n.id === 'ns-1');
      const deployment = rfNodes.find(n => n.id === 'deploy-1');

      expect(cluster?.type).toBe('container');
      expect(cluster?.parentId).toBeUndefined();

      expect(namespace?.type).toBe('container');
      expect(namespace?.parentId).toBe('cluster-1');
      expect(namespace?.extent).toBe('parent');

      expect(deployment?.parentId).toBe('ns-1');
      expect(deployment?.extent).toBe('parent');
    });
  });

  describe('Child Count Calculation', () => {
    it('should calculate child count from graph', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test-hash',
        nodes: {
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Production Namespace',
            ports: [],
            artifacts: [],
          },
          'deploy-1': {
            id: 'deploy-1',
            type: 'runtime.backend-service',
            label: 'API Deployment',
            ports: [],
            artifacts: [],
            parentId: 'ns-1',
          },
          'deploy-2': {
            id: 'deploy-2',
            type: 'runtime.backend-service',
            label: 'Worker Deployment',
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

      const children = Object.values(graph.nodes).filter(n => n.parentId === 'ns-1');
      expect(children).toHaveLength(2);
    });
  });

  describe('Container Rendering Properties', () => {
    it('should map container with proper RF node properties', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test-hash',
        nodes: {
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Production Namespace',
            ports: [],
            artifacts: [],
            metadata: {
              resourceQuota: true,
              cpuLimit: '10',
              memoryLimit: '20Gi',
            },
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const rfNodes = mapGraphToRFNodes(graph);
      const namespace = rfNodes[0];

      expect(namespace.type).toBe('container');
      expect(namespace.data.nodeType).toBe('orchestration.k8s-namespace');
      expect(namespace.data.metadata.resourceQuota).toBe(true);
      expect(namespace.data.metadata.cpuLimit).toBe('10');
      expect(namespace.data.metadata.memoryLimit).toBe('20Gi');
    });

    it('should preserve metadata through the adapter', () => {
      const graph: Graph = {
        id: '00000000-0000-0000-0000-000000000000',
        schemaVersion: 1,
        version: 1,
        hash: 'test-hash',
        nodes: {
          'ns-1': {
            id: 'ns-1',
            type: 'orchestration.k8s-namespace',
            label: 'Production Namespace',
            ports: [],
            artifacts: [],
            metadata: {
              resourceQuota: true,
              cpuLimit: '10',
              memoryLimit: '20Gi',
              networkPolicies: ['deny-all', 'allow-dns'],
              customField: 'custom-value',
            },
          },
        },
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const rfNodes = mapGraphToRFNodes(graph);
      const namespace = rfNodes[0];

      expect(namespace.data.metadata).toEqual({
        resourceQuota: true,
        cpuLimit: '10',
        memoryLimit: '20Gi',
        networkPolicies: ['deny-all', 'allow-dns'],
        customField: 'custom-value',
        childCount: 0,
      });
    });
  });

  describe('Integration with AI Generation', () => {
    it('should validate parent-child relationships via canContainerHoldNode', () => {
      expect(canContainerHoldNode('orchestration.k8s-namespace', 'runtime.backend-service')).toBe(true);
      expect(canContainerHoldNode('k8s-namespace', 'docker-container')).toBe(true);
      expect(canContainerHoldNode('k8s-namespace', 'backend-service')).toBe(true);
    });

    it('should reject types not in canContain', () => {
      expect(canContainerHoldNode('k8s-namespace', 'frontend-app')).toBe(false);
      expect(canContainerHoldNode('k8s-namespace', 'desktop-app')).toBe(false);
    });
  });
});

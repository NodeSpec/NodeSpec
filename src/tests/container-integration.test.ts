import { describe, it, expect } from 'vitest';
import { BUILTIN_CONTAINER_TYPES, getContainerTypeById, canContainerHoldNode, getCanContainRoleIds } from '@nodespec/core/container-types.js';
import { mapNodeToRFNode } from '../ui/adapters/graph-to-reactflow.js';
import type { Graph, Node } from '@nodespec/core/types.js';

describe('Container Integration Tests', () => {
  // N11(c) 2026-08-09: serverless-function left this list with its static entry — the DB
  // reclassified it as a LEAF role (20260512025200), so it has no container definition.
  const testContainerRoles = [
    'vpc',
    'k8s-cluster',
    'docker-container',
    'microservice-boundary',
    'mobile-device',
  ];

  describe('Container Type Definitions', () => {
    it('should have all 5 test container types defined', () => {
      for (const roleId of testContainerRoles) {
        const containerDef = getContainerTypeById(roleId);
        expect(containerDef).toBeDefined();
        expect(containerDef?.id).toBe(roleId);
        expect(containerDef?.label).toBeTruthy();
        expect(containerDef?.description).toBeTruthy();
        expect(containerDef?.icon).toBeTruthy();
        expect(containerDef?.layer).toBeTruthy();
      }
    });

    it('should have correct layer classifications', () => {
      expect(getContainerTypeById('vpc')?.layer).toBe('infrastructure');
      expect(getContainerTypeById('k8s-cluster')?.layer).toBe('orchestration');
      expect(getContainerTypeById('docker-container')?.layer).toBe('runtime');
      expect(getContainerTypeById('microservice-boundary')?.layer).toBe('logical');
      expect(getContainerTypeById('mobile-device')?.layer).toBe('runtime');
    });

    it('should have enriched metadata schemas', () => {
      for (const roleId of testContainerRoles) {
        const containerDef = getContainerTypeById(roleId);
        expect(containerDef?.metadataSchema).toBeDefined();
        expect(Object.keys(containerDef?.metadataSchema || {}).length).toBeGreaterThan(0);
      }
    });

    it('VPC should have infrastructure metadata fields', () => {
      const vpc = getContainerTypeById('vpc');
      expect(vpc?.metadataSchema.cidrBlock).toBeDefined();
      expect(vpc?.metadataSchema.region).toBeDefined();
      expect(vpc?.metadataSchema.internetGateway).toBeDefined();
      expect(vpc?.metadataSchema.tags).toBeDefined();
    });

    it('K8s Cluster should have orchestration metadata fields', () => {
      const k8s = getContainerTypeById('k8s-cluster');
      expect(k8s?.metadataSchema.version).toBeDefined();
      expect(k8s?.metadataSchema.nodeCount).toBeDefined();
      expect(k8s?.metadataSchema.networking).toBeDefined();
      expect(k8s?.metadataSchema.monitoring).toBeDefined();
    });

    it('Docker Container should have runtime metadata fields', () => {
      const docker = getContainerTypeById('docker-container');
      expect(docker?.metadataSchema.baseImage).toBeDefined();
      expect(docker?.metadataSchema.ports).toBeDefined();
      expect(docker?.metadataSchema.environmentVariables).toBeDefined();
    });

    it('Microservice Boundary should have logical metadata fields', () => {
      const boundary = getContainerTypeById('microservice-boundary');
      expect(boundary?.metadataSchema.domain).toBeDefined();
      expect(boundary?.metadataSchema.communicationProtocol).toBeDefined();
      expect(boundary?.metadataSchema.authenticationMethod).toBeDefined();
    });

  });

  describe('Dotted-type tolerance (M4: table-free)', () => {
    // M4 deleted CONTAINER_LEGACY_ID_MAPPING. What survives is LAST-SEGMENT resolution:
    // `infrastructure.vpc` -> `vpc`. What does NOT survive is many-to-one ALIASING
    // (`infrastructure.azure-vnet` -> `vpc`, `runtime.lambda-function` ->
    // `serverless-function`) — that was backward compatibility for pre-N9b graphs, which
    // the no-BC ruling released. Recorded as a deliberate capability reduction, not an
    // oversight: N9b already converted every stored snapshot, and replayed patches carry
    // the prefix.segment shape this still handles.
    it('resolves a dotted container id by its last segment', () => {
      expect(getContainerTypeById('infrastructure.vpc')?.id).toBe('vpc');
      expect(getContainerTypeById('runtime.docker-container')?.id).toBe('docker-container');
      expect(getContainerTypeById('logical.microservice-boundary')?.id).toBe('microservice-boundary');
      expect(getContainerTypeById('runtime.mobile-device')?.id).toBe('mobile-device');
    });

    it('a plain role id still resolves directly', () => {
      expect(getContainerTypeById('vpc')?.id).toBe('vpc');
      expect(getContainerTypeById('k8s-cluster')?.id).toBe('k8s-cluster');
    });

    it('an unresolvable dotted id returns undefined rather than guessing', () => {
      expect(getContainerTypeById('infrastructure.azure-vnet')).toBeUndefined();
      expect(getContainerTypeById('made.up.container')).toBeUndefined();
    });
  });

  describe('Frontend Adapter Detection', () => {
    const mockGraph: Graph = {
      id: '00000000-0000-0000-0000-000000000000',
      schemaVersion: 1,
      version: 1,
      hash: 'test-hash',
      nodes: {},
      edges: {},
      contracts: {},
      artifacts: {},
      nodeGroups: {},
    };

    it('should detect container types as "container" or "logicalBoundary" RF node type via dotted IDs', () => {
      const hostingContainerTypes = [
        'infrastructure.vpc',
        'orchestration.k8s-cluster',
        'orchestration.k8s-namespace',
        'orchestration.docker-compose',
        'runtime.mobile-device',
      ];

      for (const typeId of hostingContainerTypes) {
        const node: Node = {
          id: `test-${typeId}`,
          type: typeId,
          label: `Test ${typeId}`,
          ports: [],
          artifacts: [],
        };

        const rfNode = mapNodeToRFNode(node, mockGraph);
        expect(rfNode.type).toBe('container');
        expect(rfNode.data.nodeType).toBe(typeId);
      }

      const logicalBoundaryTypes = [
        'logical.microservice-boundary',
      ];

      for (const typeId of logicalBoundaryTypes) {
        const node: Node = {
          id: `test-${typeId}`,
          type: typeId,
          label: `Test ${typeId}`,
          ports: [],
          artifacts: [],
        };

        const rfNode = mapNodeToRFNode(node, mockGraph);
        expect(rfNode.type).toBe('logicalBoundary');
        expect(rfNode.data.nodeType).toBe(typeId);
      }
    });

    it('should pass metadata through to RF node', () => {
      const node: Node = {
        id: 'vpc-1',
        type: 'infrastructure.vpc',
        label: 'Production VPC',
        ports: [],
        artifacts: [],
        metadata: {
          cidrBlock: '10.0.0.0/16',
          region: 'us-east-1',
          internetGateway: true,
        },
      };

      const rfNode = mapNodeToRFNode(node, mockGraph);

      expect(rfNode.data.metadata.cidrBlock).toBe('10.0.0.0/16');
      expect(rfNode.data.metadata.region).toBe('us-east-1');
      expect(rfNode.data.metadata.internetGateway).toBe(true);
      expect(rfNode.data.metadata.childCount).toBe(0);
    });

    it('should handle empty metadata gracefully', () => {
      const node: Node = {
        id: 'k8s-1',
        type: 'orchestration.k8s-cluster',
        label: 'EKS Cluster',
        ports: [],
        artifacts: [],
        metadata: {},
      };

      const rfNode = mapNodeToRFNode(node, mockGraph);

      expect(rfNode.data.metadata).toEqual({ childCount: 0 });
      expect(rfNode.type).toBe('container');
    });

    it('should handle missing metadata gracefully', () => {
      const node: Node = {
        id: 'compose-1',
        type: 'orchestration.docker-compose',
        label: 'Docker Compose Stack',
        ports: [],
        artifacts: [],
      };

      const rfNode = mapNodeToRFNode(node, mockGraph);

      expect(rfNode.data.metadata).toBeDefined();
      expect(rfNode.type).toBe('container');
    });
  });

  describe('Container Type Registry', () => {
    it('should have at least 16 built-in container types (N11(c) shed the DB leaves; N10(c) re-filed service-mesh as a Networking leaf)', () => {
      expect(BUILTIN_CONTAINER_TYPES.length).toBeGreaterThanOrEqual(16);
    });

    it('should have unique container type IDs', () => {
      const ids = BUILTIN_CONTAINER_TYPES.map(ct => ct.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have at least one container from each layer', () => {
      const layers = BUILTIN_CONTAINER_TYPES.map(ct => ct.layer);
      expect(layers).toContain('infrastructure');
      expect(layers).toContain('orchestration');
      expect(layers).toContain('runtime');
      expect(layers).toContain('logical');
    });

    it('should have valid canContain relationships using role IDs', () => {
      for (const container of BUILTIN_CONTAINER_TYPES) {
        const roleIds = getCanContainRoleIds(container);
        expect(Array.isArray(roleIds)).toBe(true);
        expect(roleIds).toBeDefined();
        for (const childRole of roleIds) {
          expect(childRole).not.toContain('.');
        }
      }
    });
  });

  describe('canContainerHoldNode with role resolution', () => {
    it('should resolve dotted node types to role IDs for containment checks', () => {
      // M4: last-segment tolerance. `web.backend-service` resolves; `web.rest-api` does not
      // (rest-api was DELETED in M3 — protocol lives on the edge contract now).
      expect(canContainerHoldNode('vpc', 'web.backend-service')).toBe(true);
      expect(canContainerHoldNode('vpc', 'database.database')).toBe(true);
    });

    it('should work with dotted container IDs and dotted node types', () => {
      expect(canContainerHoldNode('infrastructure.vpc', 'web.backend-service')).toBe(true);
      expect(canContainerHoldNode('orchestration.k8s-namespace', 'backend.backend-service')).toBe(true);
    });

    it('should work with role IDs for both container and node', () => {
      // M7: `rest-api` was deleted in M3; `backend-service` is its successor.
      expect(canContainerHoldNode('vpc', 'backend-service')).toBe(true);
      expect(canContainerHoldNode('k8s-cluster', 'backend-service')).toBe(true);
      expect(canContainerHoldNode('docker-compose', 'database')).toBe(true);
    });
  });

  describe('Multi-Cloud Support', () => {
    it('should have AWS-compatible container types', () => {
      expect(getContainerTypeById('vpc')).toBeDefined();
      expect(getContainerTypeById('ecs-cluster')).toBeDefined();
    });

    it('should support Kubernetes', () => {
      expect(getContainerTypeById('k8s-cluster')).toBeDefined();
      expect(getContainerTypeById('k8s-namespace')).toBeDefined();
    });

    it('should support Docker', () => {
      expect(getContainerTypeById('docker-container')).toBeDefined();
      expect(getContainerTypeById('docker-compose')).toBeDefined();
      expect(getContainerTypeById('docker-swarm')).toBeDefined();
    });

    it('should have cloud-agnostic logical boundaries', () => {
      const logicalTypes = BUILTIN_CONTAINER_TYPES.filter(ct => ct.layer === 'logical');
      expect(logicalTypes.length).toBeGreaterThan(0);
    });
  });

  describe('Metadata Production-Readiness', () => {
    it('VPC should have production-ready defaults', () => {
      const vpc = getContainerTypeById('vpc');
      expect(vpc?.defaultMetadata.cidrBlock).toBeTruthy();
      expect(vpc?.defaultMetadata.region).toBeTruthy();
      expect(vpc?.defaultMetadata.internetGateway).toBeDefined();
      expect(vpc?.defaultMetadata.tags).toBeDefined();
    });

    it('K8s Cluster should have production-ready defaults', () => {
      const k8s = getContainerTypeById('k8s-cluster');
      expect(k8s?.defaultMetadata.version).toBeTruthy();
      expect(k8s?.defaultMetadata.nodeCount).toBeGreaterThan(0);
      expect(k8s?.defaultMetadata.networking).toBeTruthy();
      expect(k8s?.defaultMetadata.rbacEnabled).toBe(true);
    });

    it('Docker Container should have sensible defaults', () => {
      const docker = getContainerTypeById('docker-container');
      expect(docker?.defaultMetadata.baseImage).toBeTruthy();
      expect(Array.isArray(docker?.defaultMetadata.ports)).toBe(true);
      expect(typeof docker?.defaultMetadata.environmentVariables).toBe('object');
    });

  });

  describe('Edge Cases', () => {
    it('should handle unknown container type gracefully', () => {
      const result = getContainerTypeById('unknown.container.type');
      expect(result).toBeUndefined();
    });

    it('should handle null/undefined input', () => {
      expect(getContainerTypeById(null as any)).toBeUndefined();
      expect(getContainerTypeById(undefined as any)).toBeUndefined();
      expect(getContainerTypeById('')).toBeUndefined();
    });

    it('should not detect non-container types as containers', () => {
      const mockGraph: Graph = {
        id: '00000000-0000-0000-0000-000000000001',
        schemaVersion: 1,
        version: 1,
        hash: 'test-hash-2',
        nodes: {},
        edges: {},
        contracts: {},
        artifacts: {},
        nodeGroups: {},
      };

      const nonContainerTypes = [
        'frontend.react',
        'web.rest-api',
        'database.postgresql',
        'cache.redis',
      ];

      for (const typeId of nonContainerTypes) {
        const node: Node = {
          id: `test-${typeId}`,
          type: typeId,
          label: `Test ${typeId}`,
          ports: [],
          artifacts: [],
        };

        const rfNode = mapNodeToRFNode(node, mockGraph);

        expect(rfNode.type).not.toBe('container');
      }
    });
  });
});

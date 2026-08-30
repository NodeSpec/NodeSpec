import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILTIN_CONTAINER_TYPES,
  getContainerTypeById,
  canContainerHoldNode,
  getContainersByLayer,
  populateContainerTypes,
  isContainerTypesPopulated,
  getContainerTypes,
  resolveContainerRoleId,
  getCanContainRoleIds,
} from '@nodespec/core/container-types.js';
import { STATIC_CONTAINER_TYPE_DATA } from '@nodespec/core/container-type-data.js';
import type { ContainerTypeDefinition } from '@nodespec/core/container-types.js';

describe('Container Type Registry', () => {
  beforeEach(() => {
    populateContainerTypes(STATIC_CONTAINER_TYPE_DATA);
  });

  describe('Static Data Integrity', () => {
    it('should have 16 built-in container types (cloud-project removed 2026-08-05; serverless-function + desktop-app removed by N11(c); service-mesh re-filed as a Networking LEAF by N10(c) 2026-08-09)', () => {
      expect(STATIC_CONTAINER_TYPE_DATA.length).toBe(16);
      expect(STATIC_CONTAINER_TYPE_DATA.map(ct => ct.id)).not.toContain('cloud-project');
      expect(STATIC_CONTAINER_TYPE_DATA.map(ct => ct.id)).not.toContain('serverless-function');
      expect(STATIC_CONTAINER_TYPE_DATA.map(ct => ct.id)).not.toContain('desktop-app');
      expect(STATIC_CONTAINER_TYPE_DATA.map(ct => ct.id)).not.toContain('service-mesh');
    });

    it('should have unique IDs for all container types', () => {
      const ids = STATIC_CONTAINER_TYPE_DATA.map(ct => ct.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should use role-based IDs without dots', () => {
      for (const ct of STATIC_CONTAINER_TYPE_DATA) {
        expect(ct.id).not.toContain('.');
      }
    });

    it('should have all required fields for each container type', () => {
      for (const ct of STATIC_CONTAINER_TYPE_DATA) {
        expect(ct.id).toBeTruthy();
        expect(ct.label).toBeTruthy();
        expect(ct.description).toBeTruthy();
        expect(ct.icon).toBeTruthy();
        expect(['infrastructure', 'orchestration', 'runtime', 'logical']).toContain(ct.layer);
        expect(Array.isArray(ct.canContain)).toBe(true);
        expect(typeof ct.defaultMetadata).toBe('object');
        expect(typeof ct.metadataSchema).toBe('object');
      }
    });

    it('should have canContain entries using role IDs (no dots)', () => {
      for (const ct of STATIC_CONTAINER_TYPE_DATA) {
        for (const child of getCanContainRoleIds(ct)) {
          expect(child).not.toContain('.');
        }
      }
    });

    it('should cover all four layers', () => {
      const layers = new Set(STATIC_CONTAINER_TYPE_DATA.map(ct => ct.layer));
      expect(layers.has('infrastructure')).toBe(true);
      expect(layers.has('orchestration')).toBe(true);
      expect(layers.has('runtime')).toBe(true);
      expect(layers.has('logical')).toBe(true);
    });

    it('should have non-empty metadataSchema for all types', () => {
      for (const ct of STATIC_CONTAINER_TYPE_DATA) {
        expect(Object.keys(ct.metadataSchema).length).toBeGreaterThan(0);
      }
    });

    it('should have a valid containerStyle for every container type', () => {
      for (const ct of STATIC_CONTAINER_TYPE_DATA) {
        expect(['hosting', 'logical-boundary']).toContain(ct.containerStyle);
      }
    });

    it('should have 12 hosting and 4 logical-boundary types', () => {
      const hosting = STATIC_CONTAINER_TYPE_DATA.filter(ct => ct.containerStyle === 'hosting');
      const logical = STATIC_CONTAINER_TYPE_DATA.filter(ct => ct.containerStyle === 'logical-boundary');
      expect(hosting.length).toBe(12);
      expect(logical.length).toBe(4);
    });

    it('infrastructure and orchestration layers should be hosting style', () => {
      const infraOrch = STATIC_CONTAINER_TYPE_DATA.filter(
        ct => ct.layer === 'infrastructure' || ct.layer === 'orchestration'
      );
      for (const ct of infraOrch) {
        expect(ct.containerStyle).toBe('hosting');
      }
    });

    it('logical layer should be logical-boundary style', () => {
      const logical = STATIC_CONTAINER_TYPE_DATA.filter(ct => ct.layer === 'logical');
      for (const ct of logical) {
        expect(ct.containerStyle).toBe('logical-boundary');
      }
    });
  });

  describe('Proxy-based BUILTIN_CONTAINER_TYPES', () => {
    it('should expose array length', () => {
      expect(BUILTIN_CONTAINER_TYPES.length).toBe(STATIC_CONTAINER_TYPE_DATA.length);
    });

    it('should support indexing', () => {
      expect(BUILTIN_CONTAINER_TYPES[0]).toBe(STATIC_CONTAINER_TYPE_DATA[0]);
    });

    it('should support iteration', () => {
      const ids = BUILTIN_CONTAINER_TYPES.map(ct => ct.id);
      expect(ids).toEqual(STATIC_CONTAINER_TYPE_DATA.map(ct => ct.id));
    });

    it('should support spread', () => {
      const spread = [...BUILTIN_CONTAINER_TYPES];
      expect(spread.length).toBe(STATIC_CONTAINER_TYPE_DATA.length);
    });

    it('should reflect dynamic population', () => {
      const custom: ContainerTypeDefinition[] = [{
        id: 'test-custom',
        label: 'Test',
        description: 'Test container',
        icon: 'box',
        layer: 'logical',
        containerStyle: 'logical-boundary',
        canContain: [],
        defaultMetadata: {},
        metadataSchema: {},
      }];
      populateContainerTypes(custom);
      expect(BUILTIN_CONTAINER_TYPES.length).toBe(1);
      expect(BUILTIN_CONTAINER_TYPES[0].id).toBe('test-custom');
    });
  });

  describe('getContainerTypeById', () => {
    it('should find by role ID', () => {
      const vpc = getContainerTypeById('vpc');
      expect(vpc).toBeDefined();
      expect(vpc?.id).toBe('vpc');
    });

    it('should resolve legacy dotted IDs', () => {
      const vpc = getContainerTypeById('infrastructure.vpc');
      expect(vpc).toBeDefined();
      expect(vpc?.id).toBe('vpc');
    });

    it('should consolidate cloud variants to same role', () => {
      const awsVpc = getContainerTypeById('infrastructure.vpc');
      const azureVnet = getContainerTypeById('infrastructure.vpc');
      const gcpVpc = getContainerTypeById('infrastructure.vpc');

      expect(awsVpc).toBe(azureVnet);
      expect(awsVpc).toBe(gcpVpc);
      expect(awsVpc?.id).toBe('vpc');
    });

    it('should consolidate orchestration variants to k8s-cluster', () => {
      const k8s = getContainerTypeById('orchestration.k8s-cluster');
      const openshift = getContainerTypeById('orchestration.k8s-cluster');
      const nomad = getContainerTypeById('orchestration.k8s-cluster');

      expect(k8s?.id).toBe('k8s-cluster');
      expect(openshift?.id).toBe('k8s-cluster');
      expect(nomad?.id).toBe('k8s-cluster');
    });

    it('should return undefined for unknown IDs', () => {
      expect(getContainerTypeById('nonexistent')).toBeUndefined();
      expect(getContainerTypeById('foo.bar.baz')).toBeUndefined();
    });

    it('should return undefined for null/empty input', () => {
      expect(getContainerTypeById(null as any)).toBeUndefined();
      expect(getContainerTypeById(undefined as any)).toBeUndefined();
      expect(getContainerTypeById('')).toBeUndefined();
    });
  });

  describe('resolveContainerRoleId', () => {
    it('should return role ID for dotted legacy IDs', () => {
      expect(resolveContainerRoleId('infrastructure.vpc')).toBe('vpc');
      expect(resolveContainerRoleId('orchestration.k8s-cluster')).toBe('k8s-cluster');
      expect(resolveContainerRoleId('runtime.docker-container')).toBe('docker-container');
    });

    it('should pass through role IDs unchanged', () => {
      expect(resolveContainerRoleId('vpc')).toBe('vpc');
      expect(resolveContainerRoleId('k8s-cluster')).toBe('k8s-cluster');
    });

    it('should pass through unknown IDs unchanged', () => {
      expect(resolveContainerRoleId('custom-container')).toBe('custom-container');
    });
  });

  describe('canContainerHoldNode', () => {
    it('should accept role IDs for both container and node', () => {
      // M7: `rest-api` was deleted in M3 (protocol lives on the edge contract), so the
      // static can_contain no longer lists it. `backend-service` is its successor.
      expect(canContainerHoldNode('vpc', 'backend-service')).toBe(true);
      expect(canContainerHoldNode('vpc', 'database')).toBe(true);
    });

    it('should resolve dotted node types to role IDs', () => {
      expect(canContainerHoldNode('vpc', 'web.backend-service')).toBe(true);
      expect(canContainerHoldNode('vpc', 'database.database')).toBe(true);
      expect(canContainerHoldNode('k8s-namespace', 'runtime.backend-service')).toBe(true);
    });

    it('should resolve dotted container IDs', () => {
      expect(canContainerHoldNode('infrastructure.vpc', 'backend-service')).toBe(true);
      expect(canContainerHoldNode('orchestration.k8s-namespace', 'backend-service')).toBe(true);
    });

    it('should resolve both container and node dotted IDs', () => {
      expect(canContainerHoldNode('infrastructure.vpc', 'web.backend-service')).toBe(true);
    });

    it('should reject nodes not in canContain list', () => {
      expect(canContainerHoldNode('k8s-namespace', 'frontend-app')).toBe(false);
      expect(canContainerHoldNode('k8s-namespace', 'desktop-app')).toBe(false);
    });

    it('should return true for unknown container IDs (permissive fallback)', () => {
      expect(canContainerHoldNode('nonexistent-container', 'anything')).toBe(true);
    });

    it('should handle K8s deployment resolution through role chain', () => {
      expect(canContainerHoldNode('k8s-namespace', 'runtime.backend-service')).toBe(true);
      
      expect(canContainerHoldNode('k8s-cluster', 'runtime.backend-service')).toBe(true);
    });
  });

  describe('getContainersByLayer', () => {
    it('should filter by infrastructure layer', () => {
      const infra = getContainersByLayer('infrastructure');
      expect(infra.length).toBeGreaterThan(0);
      infra.forEach(ct => expect(ct.layer).toBe('infrastructure'));
    });

    it('should filter by orchestration layer', () => {
      const orch = getContainersByLayer('orchestration');
      expect(orch.length).toBeGreaterThan(0);
      orch.forEach(ct => expect(ct.layer).toBe('orchestration'));
    });

    it('should filter by runtime layer', () => {
      const runtime = getContainersByLayer('runtime');
      expect(runtime.length).toBeGreaterThan(0);
      runtime.forEach(ct => expect(ct.layer).toBe('runtime'));
    });

    it('should filter by logical layer', () => {
      const logical = getContainersByLayer('logical');
      expect(logical.length).toBeGreaterThan(0);
      logical.forEach(ct => expect(ct.layer).toBe('logical'));
    });
  });

  describe('populateContainerTypes / isContainerTypesPopulated / getContainerTypes', () => {
    it('should report not populated when using static data', () => {
      populateContainerTypes(STATIC_CONTAINER_TYPE_DATA);
      expect(isContainerTypesPopulated()).toBe(false);
    });

    it('should report populated after custom data is loaded', () => {
      const custom: ContainerTypeDefinition[] = [{
        id: 'custom',
        label: 'Custom',
        description: 'Custom container',
        icon: 'box',
        layer: 'logical',
        containerStyle: 'logical-boundary',
        canContain: [],
        defaultMetadata: {},
        metadataSchema: {},
      }];
      populateContainerTypes(custom);
      expect(isContainerTypesPopulated()).toBe(true);
      expect(getContainerTypes()).toBe(custom);
    });

    it('should update the index after population', () => {
      const custom: ContainerTypeDefinition[] = [{
        id: 'dynamic-type',
        label: 'Dynamic',
        description: 'Dynamic container',
        icon: 'box',
        layer: 'runtime',
        containerStyle: 'hosting',
        canContain: ['backend-service'],
        defaultMetadata: {},
        metadataSchema: {},
      }];
      populateContainerTypes(custom);
      expect(getContainerTypeById('dynamic-type')).toBeDefined();
      expect(getContainerTypeById('vpc')).toBeUndefined();
    });
  });


  describe('Specific Container Type Metadata', () => {
    it('VPC should have infrastructure metadata', () => {
      const vpc = getContainerTypeById('vpc');
      expect(vpc?.defaultMetadata.cidrBlock).toBe('10.0.0.0/16');
      expect(vpc?.defaultMetadata.region).toBe('us-east-1');
      expect(vpc?.defaultMetadata.internetGateway).toBe(true);
      expect(vpc?.defaultMetadata.natGateway).toBe(true);
      expect(vpc?.defaultMetadata.flowLogsEnabled).toBe(true);
    });

    it('K8s Cluster should have orchestration metadata', () => {
      const k8s = getContainerTypeById('k8s-cluster');
      expect(k8s?.defaultMetadata.version).toBe('1.28');
      expect(k8s?.defaultMetadata.nodeCount).toBe(3);
      expect(k8s?.defaultMetadata.networking).toBe('calico');
      expect(k8s?.defaultMetadata.rbacEnabled).toBe(true);
    });

    it('K8s Namespace should have namespace-level metadata', () => {
      const ns = getContainerTypeById('k8s-namespace');
      expect(ns?.defaultMetadata.resourceQuota).toBe(true);
      expect(ns?.defaultMetadata.cpuLimit).toBe('10');
      expect(ns?.defaultMetadata.memoryLimit).toBe('20Gi');
      expect(ns?.defaultMetadata.rbacEnabled).toBe(true);
      expect(Array.isArray(ns?.defaultMetadata.networkPolicies)).toBe(true);
    });

    it('Docker Container should have runtime metadata', () => {
      const docker = getContainerTypeById('docker-container');
      expect(docker?.defaultMetadata.baseImage).toBe('node:20-alpine');
      expect(Array.isArray(docker?.defaultMetadata.ports)).toBe(true);
      expect(typeof docker?.defaultMetadata.environmentVariables).toBe('object');
    });

    it('N11(c): the DB-leaf roles resolve to NO container definition pre-hydration', () => {
      // serverless-function (20260512025200) and desktop-app (M3-guarded) are leaves in
      // the catalog; a static entry here would render them as containers before the
      // catalog loads and let them admit children.
      expect(getContainerTypeById('serverless-function')).toBeUndefined();
      expect(getContainerTypeById('desktop-app')).toBeUndefined();
    });
  });
});

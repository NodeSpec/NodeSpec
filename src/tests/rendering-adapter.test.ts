import { describe, it, expect } from 'vitest';
import {
  resolveRFVisualType,
  isContainerType,
  populateRFVisualTypes,
  isRFTypesPopulated,
} from '../ui/adapters/rf-visual-type-resolver.js';
import {
  getTechnologyLogo,
  getTechnologyColors,
  populateTechnologyVisuals,
  TECHNOLOGY_LOGO_MAP,
} from '../ui/utils/technology-logo-map.js';
import { mapNodeToRFNode } from '../ui/adapters/graph-to-reactflow.js';
import type { Graph, Node } from '@nodespec/core/types.js';
import type { CatalogResolver, NodeRole, TechnologyCatalogEntry } from '../persistence/supabase/catalog-repository.js';

function makeMockCatalog(overrides: {
  roles?: NodeRole[];
  technologies?: TechnologyCatalogEntry[];
} = {}): CatalogResolver {
  const roles = overrides.roles ?? [];
  const techs = overrides.technologies ?? [];

  const roleIndex = new Map(roles.map(r => [r.id, r]));
  const techIndex = new Map(techs.map(t => [t.id, t]));

  return {
    resolveNodeType(roleId: string) {
      const role = roleIndex.get(roleId);
      return role ? { role, technology: null, deploymentTarget: null } : null;
    },
    getRole(roleId: string) { return roleIndex.get(roleId) ?? null; },
    getTechnology(techId: string) { return techIndex.get(techId) ?? null; },
    getDeploymentTarget() { return null; },
    getAllRoles() { return roles; },
    getAllTechnologies() { return techs; },
    getAllDeploymentTargets() { return []; },
    getRolesByCategory(category: string) { return roles.filter(r => r.paletteCategory === category); },
    getTechnologiesForRole(roleId: string) { return techs.filter(t => t.roleAffinities.includes(roleId)); },
  };
}

function makeRole(id: string, rfVisualType: string, opts: Partial<NodeRole> = {}): NodeRole {
  return {
    id,
    label: opts.label ?? id,
    description: opts.description ?? '',
    iconName: opts.iconName ?? 'box',
    color: opts.color ?? '#888',
    rfVisualType,
    paletteCategory: opts.paletteCategory ?? 'general',
    nature: opts.nature ?? 'build',
    interfaceKind: opts.interfaceKind ?? 'service',
    provider: opts.provider ?? null,
    capabilityTags: opts.capabilityTags ?? [],
    isContainer: opts.isContainer ?? false,
    containerLayer: opts.containerLayer ?? null,
    containerStyle: opts.containerStyle ?? null,
    canContain: opts.canContain ?? [],
    metadataSchema: opts.metadataSchema ?? null,
    defaultPorts: opts.defaultPorts ?? [],
    suggestedContracts: opts.suggestedContracts ?? [],
    sortOrder: opts.sortOrder ?? 0,
    deprecated: opts.deprecated ?? false,
    whenToUse: opts.whenToUse ?? null,
    defaultTechnology: opts.defaultTechnology ?? null,
  };
}

function makeTech(id: string, opts: Partial<TechnologyCatalogEntry> = {}): TechnologyCatalogEntry {
  return {
    id,
    name: opts.name ?? id,
    iconUrl: opts.iconUrl ?? null,
    brandColor: opts.brandColor ?? '#000',
    secondaryColor: opts.secondaryColor ?? null,
    displayName: opts.displayName ?? null,
    roleAffinities: opts.roleAffinities ?? [],
    aiContext: opts.aiContext ?? {},
    suggestedFiles: opts.suggestedFiles ?? null,
        metadataSchema: opts.metadataSchema ?? null,
    commonConnections: opts.commonConnections ?? null,
    isUserContributed: opts.isUserContributed ?? false,
    projectId: opts.projectId ?? null,
    createdBy: opts.createdBy ?? null,
  };
}

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

describe('RF Visual Type Resolver', () => {
  describe('resolveRFVisualType without catalog', () => {
    it('returns "container" for known container types via getContainerTypeById', () => {
      // M4/M6: container ids are ROLE IDS. The dotted forms (`infrastructure.vpc`,
      // `orchestration.docker-compose`) went with CONTAINER_LEGACY_ID_MAPPING — dotted
      // tolerance now lives on the catalog path (resolveNodeType), not here.
      expect(resolveRFVisualType('vpc')).toBe('container');
      expect(resolveRFVisualType('k8s-cluster')).toBe('container');
      expect(resolveRFVisualType('docker-compose')).toBe('container');
      expect(resolveRFVisualType('k8s-namespace')).toBe('container');
    });

    it('returns "service" as default fallback for unknown types', () => {
      expect(resolveRFVisualType('some.unknown.type')).toBe('service');
      expect(resolveRFVisualType('custom-thing')).toBe('service');
    });

    it('returns static type for bare role names', () => {
      // M6: `database` maps to 'service', not 'database'. The live `database` role carries
      // rf_visual_type='service' and the static index has always redirected the key — the
      // old assertion pinned an rf type that ZERO roles carry (M5 removed it entirely).
      expect(resolveRFVisualType('database')).toBe('service');
      expect(resolveRFVisualType('api')).toBe('api');
      expect(resolveRFVisualType('queue')).toBe('queue');
      expect(resolveRFVisualType('cache')).toBe('cache');
      expect(resolveRFVisualType('external')).toBe('external');
      expect(resolveRFVisualType('service')).toBe('service');
      expect(resolveRFVisualType('container')).toBe('container');
    });
  });

  describe('resolveRFVisualType with catalog', () => {
    it('uses catalog rfVisualType when available', () => {
      const catalog = makeMockCatalog({
        roles: [makeRole('cache', 'cache')],
      });

      expect(resolveRFVisualType('cache', catalog)).toBe('cache');
    });

    it('falls back to static index when catalog has no mapping', () => {
      const catalog = makeMockCatalog({ roles: [] });
      expect(resolveRFVisualType('vpc', catalog)).toBe('container');
    });

    it('resolves icon type from catalog when role specifies it', () => {
      const catalog = makeMockCatalog({
        roles: [makeRole('backend-service', 'service')],
      });

      expect(resolveRFVisualType('backend-service', catalog)).toBe('service');
    });
  });

  describe('isContainerType', () => {
    it('detects container types without catalog', () => {
      expect(isContainerType('vpc')).toBe(true);
      expect(isContainerType('k8s-cluster')).toBe(true);
      expect(isContainerType('docker-compose')).toBe(true);
    });

    it('rejects non-container types without catalog', () => {
      expect(isContainerType('frontend-app')).toBe(false);
      expect(isContainerType('database')).toBe(false);
      expect(isContainerType('some-unknown')).toBe(false);
    });

    it('uses catalog isContainer + canContain for detection', () => {
      const catalog = makeMockCatalog({
        roles: [makeRole('vpc', 'container', { isContainer: true, canContain: ['backend-service', 'database'] })],
      });

      expect(isContainerType('vpc', catalog)).toBe(true);
    });

    it('rejects role with isContainer=true but empty canContain', () => {
      const catalog = makeMockCatalog({
        roles: [makeRole('weird-role', 'service', { isContainer: true, canContain: [] })],
      });

      expect(isContainerType('weird-role', catalog)).toBe(false);
    });
  });

  describe('populateRFVisualTypes', () => {
    it('populates the index by role id', () => {
      const catalog = makeMockCatalog({
        roles: [
          makeRole('database', 'service'),
          makeRole('rest-api', 'api'),
          makeRole('backend-service', 'service'),
        ],
      });

      populateRFVisualTypes(catalog);
      expect(isRFTypesPopulated()).toBe(true);

      // M4: the index is keyed by ROLE ID. Without a catalog argument the dotted forms
      // no longer resolve (that tolerance lives in resolveNodeType, on the catalog path),
      // so they fall through to the 'service' default.
      expect(resolveRFVisualType('rest-api')).toBe('api');
      expect(resolveRFVisualType('backend-service')).toBe('service');
      expect(resolveRFVisualType('web.rest-api')).toBe('service');
    });

    it('drops an rf type outside the accepted set', () => {
      // M5/M6: `database` is no longer accepted — the DB CHECK forbids it and zero roles
      // carry it. A role declaring it is not indexed, so it falls back to 'service'.
      populateRFVisualTypes(makeMockCatalog({ roles: [makeRole('odd-role', 'database')] }));
      expect(resolveRFVisualType('odd-role')).toBe('service');
    });

    it('also indexes by role ID', () => {
      const catalog = makeMockCatalog({
        roles: [
          makeRole('database', 'service'),
          makeRole('cache', 'cache'),
        ],
      });

      populateRFVisualTypes(catalog);

      expect(resolveRFVisualType('database')).toBe('service');
      expect(resolveRFVisualType('cache')).toBe('cache');
    });
  });

});

describe('Technology Logo Map', () => {
  // M6: this block used to assert a hardcoded 12-entry map and a `legacyNodeType` fallback.
  // Both are gone: the map is POPULATED FROM THE CATALOG (populateTechnologyVisuals), and
  // the fallback resolved against `_legacyToTech`, which was fed by legacy_type_mappings —
  // the table M4 deleted. Every caller was passing a node type into a permanently empty
  // lookup. The tests now exercise what the functions actually do.
  const catalog = makeMockCatalog({
    technologies: [
      makeTech('mongodb', { iconUrl: 'https://cdn.test/mongo.svg', brandColor: '#47A248', secondaryColor: '#116149' }),
      makeTech('react', { iconUrl: 'https://cdn.test/react.svg', brandColor: '#61DAFB' }),
      makeTech('postgresql', { iconUrl: null, brandColor: '#336791' }),
    ],
  });

  describe('getTechnologyLogo', () => {
    it('returns the logo for a technology that has an iconUrl', () => {
      populateTechnologyVisuals(catalog);
      expect(getTechnologyLogo('mongodb')).toBe('https://cdn.test/mongo.svg');
      expect(getTechnologyLogo('react')).toBe('https://cdn.test/react.svg');
    });

    it('returns undefined for a technology with no iconUrl, and for an unknown id', () => {
      populateTechnologyVisuals(catalog);
      expect(getTechnologyLogo('postgresql')).toBeUndefined();
      expect(getTechnologyLogo('unknown-tech')).toBeUndefined();
      expect(getTechnologyLogo(undefined)).toBeUndefined();
    });

    it('indexes only the technologies that carry an icon', () => {
      populateTechnologyVisuals(catalog);
      expect(Object.keys(TECHNOLOGY_LOGO_MAP).sort()).toEqual(['mongodb', 'react']);
    });

    it('a repopulate REPLACES the previous catalog rather than merging', () => {
      populateTechnologyVisuals(catalog);
      populateTechnologyVisuals(makeMockCatalog({
        technologies: [makeTech('vue', { iconUrl: 'https://cdn.test/vue.svg' })],
      }));
      expect(getTechnologyLogo('mongodb')).toBeUndefined();
      expect(getTechnologyLogo('vue')).toBe('https://cdn.test/vue.svg');
    });
  });

  describe('getTechnologyColors', () => {
    it('returns brand colours, defaulting secondary to primary', () => {
      populateTechnologyVisuals(catalog);
      expect(getTechnologyColors('mongodb')).toEqual({ primary: '#47A248', secondary: '#116149' });
      expect(getTechnologyColors('react')).toEqual({ primary: '#61DAFB', secondary: '#61DAFB' });
    });

    it('returns colours even when the technology has no logo', () => {
      populateTechnologyVisuals(catalog);
      expect(getTechnologyColors('postgresql')?.primary).toBe('#336791');
    });

    it('returns undefined for unknown', () => {
      populateTechnologyVisuals(catalog);
      expect(getTechnologyColors('nope')).toBeUndefined();
    });
  });
});

describe('Rendering Adapter Integration', () => {
  it('maps container node to "container" RF type without catalog', () => {
    const node: Node = {
      id: 'vpc-1',
      type: 'vpc',
      label: 'Prod VPC',
      ports: [],
      artifacts: [],
    };

    const rfNode = mapNodeToRFNode(node, emptyGraph);
    expect(rfNode.type).toBe('container');
  });

  it('maps non-container node to resolved RF type with catalog', () => {
    const catalog = makeMockCatalog({
      roles: [makeRole('cache', 'cache')],
    });

    const node: Node = {
      id: 'db-1',
      type: 'cache',
      label: 'Primary DB',
      ports: [],
      artifacts: [],
    };

    // In `flat` mode the catalog's rf type survives…
    expect(mapNodeToRFNode(node, emptyGraph, 'flat', catalog).type).toBe('cache');
    // …while `nested` deliberately collapses every non-container to the compact icon form,
    // so the container's contents stay readable. The rf type is still what decides the
    // node's identity everywhere else.
    expect(mapNodeToRFNode(node, emptyGraph, 'nested', catalog).type).toBe('icon');
  });

  it('passes technology and catalog metadata through to RF node data', () => {
    const catalog = makeMockCatalog({
      roles: [makeRole('database', 'service', { label: 'Database', color: '#336791' })],
      technologies: [makeTech('mongodb', { iconUrl: 'https://example.com/mongo.png', brandColor: '#47A248' })],
    });

    const node: Node = {
      id: 'mongo-1',
      type: 'database',
      label: 'Mongo Primary',
      ports: [],
      artifacts: [],
      technology: 'mongodb',
    };

    const rfNode = mapNodeToRFNode(node, emptyGraph, 'nested', catalog);
    expect(rfNode.data.nodeTypeLabel).toBe('Database');
    expect(rfNode.data.color).toBe('#47A248');
    expect(rfNode.data.icon).toBe('https://example.com/mongo.png');
    expect(rfNode.data.technology).toBe('mongodb');
  });

  it('hides containers in flat layer mode', () => {
    const node: Node = {
      id: 'vpc-1',
      type: 'vpc',
      label: 'VPC',
      ports: [],
      artifacts: [],
    };

    const rfNode = mapNodeToRFNode(node, emptyGraph, 'flat');
    expect(rfNode.hidden).toBe(true);
  });

  it('shows containerParentLabel in flat layer mode for contained children', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'vpc-1': {
          id: 'vpc-1',
          type: 'vpc',
          label: 'Prod VPC',
          ports: [],
          artifacts: [],
        },
        'svc-1': {
          id: 'svc-1',
          type: 'backend-service',
          label: 'API Service',
          ports: [],
          artifacts: [],
          parentId: 'vpc-1',
        },
      },
    };

    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'flat');
    expect(rfNode.data.containerParentLabel).toBe('Prod VPC');
  });

  // M6: this asserted 'compactIcon'. mapNodeToRFNode has never produced that value — it
  // emits 'icon' for every non-container in nested mode. `compactIcon` survives only as a
  // registered React Flow node type, reachable through other paths.
  it('maps child in nested layer mode to the compact icon form when parent is container', () => {
    const graph: Graph = {
      ...emptyGraph,
      nodes: {
        'vpc-1': {
          id: 'vpc-1',
          type: 'vpc',
          label: 'Prod VPC',
          ports: [],
          artifacts: [],
        },
        'svc-1': {
          id: 'svc-1',
          type: 'backend-service',
          label: 'API Service',
          ports: [],
          artifacts: [],
          parentId: 'vpc-1',
        },
      },
    };

    const rfNode = mapNodeToRFNode(graph.nodes['svc-1'], graph, 'nested');
    expect(rfNode.type).toBe('icon');
  });
});

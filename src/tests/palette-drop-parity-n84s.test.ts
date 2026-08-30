// N8.4s — owner bench 2026-07-27: "Some of these nodes like VPC nodes are not even
// adding to the canvas now… there's a Structure Google Cloud Platform overall node, then
// there's the branded actual node… that either won't drop on the canvas at all."
//
// Root cause: the palette LISTED rows using liveDropAffinities (which allows container
// roles — the 4a-1c fix that made aws-ec2 visible) while the Canvas drop handler had its
// OWN copy of the rule that filtered `!isContainer`. aws-vpc / azure-vnet / gcp-vpc have
// affinities [vpc, subnet] — both containers — so they listed and then silently produced
// nothing. These pins hold the two rules together.
import { describe, it, expect } from 'vitest';
import { buildTechnologyListItems, liveDropAffinities } from '../ui/utils/palette-list.js';
import type { CatalogResolver, NodeRole, TechnologyCatalogEntry } from '../persistence/supabase/catalog-repository.js';

function role(id: string, over: Partial<NodeRole> = {}): NodeRole {
  return {
    id, label: id, description: '', iconName: 'Box', color: '#000', rfVisualType: 'icon',
    paletteCategory: 'Infrastructure',
    nature: 'build', provider: null, capabilityTags: [],
    isContainer: false, containerLayer: null, containerStyle: null, canContain: [],
    metadataSchema: null, defaultPorts: [], suggestedContracts: [], sortOrder: 0,
    deprecated: false, whenToUse: null, defaultTechnology: null, ...over,
  };
}

function tech(id: string, name: string, affinities: string[]): TechnologyCatalogEntry {
  return {
    id, name, iconUrl: null, brandColor: '#111', secondaryColor: null, displayName: null, roleAffinities: affinities, aiContext: { purpose: `${name} purpose.` },
    suggestedFiles: null, metadataSchema: null, commonConnections: null,
    isUserContributed: false, projectId: null, createdBy: null,
  };
}

const ROLES: Record<string, NodeRole> = {
  vpc: role('vpc', { isContainer: true, nature: 'build',  }),
  subnet: role('subnet', { isContainer: true, nature: 'build',  }),
  gcp: role('gcp', { isContainer: true, nature: 'host', provider: 'gcp',  }),
  'cloud-project': role('cloud-project', { isContainer: true, nature: 'build', deprecated: true }),
  'backend-service': role('backend-service'),
};

const TECHS: TechnologyCatalogEntry[] = [
  tech('gcp-vpc', 'Google Cloud VPC', ['vpc', 'subnet']),
  tech('gcp', 'Google Cloud Platform', ['gcp']),
  tech('gcp-cloud-run', 'Google Cloud Run', ['backend-service']),
];

const resolver = {
  getRole: (id: string) => ROLES[id] ?? null,
  getAllTechnologies: () => TECHS,
  getAllRoles: () => Object.values(ROLES),
} as unknown as CatalogResolver;

describe('a listed technology is always droppable (list/drop parity)', () => {
  it('gcp-vpc offers its CONTAINER roles instead of nothing', () => {
    const roles = liveDropAffinities(TECHS[0], resolver);
    expect(roles.map(r => r.id)).toEqual(['vpc', 'subnet']);
  });

  it('every row the palette lists resolves to at least one drop role', () => {
    for (const item of buildTechnologyListItems(resolver)) {
      const t = TECHS.find(x => x.id === item.id)!;
      expect(liveDropAffinities(t, resolver).length).toBeGreaterThan(0);
    }
  });

  it('deprecated roles are still excluded from the options', () => {
    const withDeprecated = tech('legacy', 'Legacy', ['cloud-project', 'backend-service']);
    expect(liveDropAffinities(withDeprecated, resolver).map(r => r.id)).toEqual(['backend-service']);
  });
});

describe('the provider platform lists ONCE', () => {
  it('suppresses the branded platform technology row (Structure already has the role)', () => {
    const names = buildTechnologyListItems(resolver).map(i => i.name);
    expect(names).not.toContain('Google Cloud Platform');
    expect(names).toContain('Google Cloud VPC');
    expect(names).toContain('Google Cloud Run');
  });
});

// ── The data half: what the corrected platform roles unlock ────────────────────────
// Before the migration all six platform roles had provider = NULL and azure/gcp were
// kind='build', so (a) the cross-provider guard silently skipped whenever the drop
// TARGET was a platform container, and (b) platform-in-platform was only refused for AWS.
import { canContainerHoldNode, setRoleResolver, populateContainerTypes, type RoleInfo } from '@nodespec/core/container-types.js';

const PLATFORM_ROLES: Record<string, RoleInfo> = {
  aws: { id: 'aws', nature: 'host', provider: 'aws', isContainer: true },
  gcp: { id: 'gcp', nature: 'host', provider: 'gcp', isContainer: true },
  database: { id: 'database', nature: 'build', provider: null,  },
};

const PLATFORM_RULE = {
  roleIds: ['aws-lambda'],
  providers: ['aws'],
  natures: ['build', 'data', 'messaging', 'deployment_container'],
  interfaceKinds: ['service', 'data', 'infrastructure'],
};

describe('platform containers after the role-identity fix', () => {
  it('accepts a plain technology-less child through the ontology axes', () => {
    populateContainerTypes([{
      id: 'aws', label: 'AWS', description: '', icon: 'Cloud', layer: 'infrastructure',
      containerStyle: 'hosting', canContain: PLATFORM_RULE, defaultMetadata: {}, metadataSchema: {},
    }]);
    setRoleResolver((id) => PLATFORM_ROLES[id] ?? null);
    try {
      // A bare Database dropped into the AWS project: no technology, so the `providers`
      // allowlist could never match it and the enumerated roleIds are the dead
      // platform_capability list. It was refused; now `kinds` covers it.
      expect(canContainerHoldNode('aws', 'database')).toBe(true);
    } finally {
      setRoleResolver(null);
    }
  });

  it('still refuses a cross-provider child when the TARGET is the platform itself', () => {
    populateContainerTypes([{
      id: 'aws', label: 'AWS', description: '', icon: 'Cloud', layer: 'infrastructure',
      containerStyle: 'hosting', canContain: PLATFORM_RULE, defaultMetadata: {}, metadataSchema: {},
    }]);
    setRoleResolver((id) => PLATFORM_ROLES[id] ?? null);
    try {
      // This is the case the missing provider column silently allowed.
      expect(canContainerHoldNode('aws', 'database', undefined, 'gcp-firestore')).toBe(false);
    } finally {
      setRoleResolver(null);
    }
  });

  it('refuses platform-in-platform now that azure/gcp are kind=platform', () => {
    populateContainerTypes([{
      id: 'aws', label: 'AWS', description: '', icon: 'Cloud', layer: 'infrastructure',
      containerStyle: 'hosting', canContain: PLATFORM_RULE, defaultMetadata: {}, metadataSchema: {},
    }]);
    setRoleResolver((id) => PLATFORM_ROLES[id] ?? null);
    try {
      expect(canContainerHoldNode('aws', 'gcp')).toBe(false);
    } finally {
      setRoleResolver(null);
    }
  });
});

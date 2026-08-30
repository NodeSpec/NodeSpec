import { describe, it, expect } from 'vitest';
import { getLayoutPartition, getStaticPartition, LAYOUT_PARTITIONS } from '../ui/utils/layout-partition.js';
import type { CatalogResolver, NodeRole } from '../../src/persistence/supabase/catalog-repository.js';

function makeRole(overrides: Partial<NodeRole>): NodeRole {
  return {
    id: 'test-role',
    label: 'Test',
    description: '',
    iconName: 'box',
    color: '#000',
    rfVisualType: 'base',
    paletteCategory: 'services',
    nature: 'build',
    interfaceKind: 'service',
    provider: null,
    capabilityTags: [],
    isContainer: false,
    containerLayer: null,
    containerStyle: null,
    canContain: [],
    metadataSchema: null,
    defaultPorts: [],
    suggestedContracts: [],
    sortOrder: 0,
    deprecated: false,
    whenToUse: null,
    defaultTechnology: null,
    ...overrides,
  };
}

function makeCatalog(role: NodeRole | null): CatalogResolver {
  return {
    resolveNodeType: () => (role ? { role, technology: null, deploymentTarget: null } : null),
  } as unknown as CatalogResolver;
}

describe('getLayoutPartition', () => {
  // M1c: columns now key on interface_kind (what an edge into the node MEANS) and nature,
  // not the retired `kind`. Same columns, better-fitting axis — layout is about data flow.
  it('maps interface_kind / nature to their columns', () => {
    expect(getLayoutPartition('x', makeCatalog(makeRole({ interfaceKind: 'queue' })))).toBe(LAYOUT_PARTITIONS.messaging);
    expect(getLayoutPartition('x', makeCatalog(makeRole({ interfaceKind: 'event_bus' })))).toBe(LAYOUT_PARTITIONS.messaging);
    expect(getLayoutPartition('x', makeCatalog(makeRole({ interfaceKind: 'data' })))).toBe(LAYOUT_PARTITIONS.data);
    expect(getLayoutPartition('x', makeCatalog(makeRole({ interfaceKind: 'object_store' })))).toBe(LAYOUT_PARTITIONS.data);
    expect(getLayoutPartition('x', makeCatalog(makeRole({ interfaceKind: 'telemetry' })))).toBe(LAYOUT_PARTITIONS.operations);
    expect(getLayoutPartition('x', makeCatalog(makeRole({ nature: 'call' })))).toBe(LAYOUT_PARTITIONS.external);
    expect(getLayoutPartition('x', makeCatalog(makeRole({ nature: 'engine' })))).toBe(LAYOUT_PARTITIONS.operations);
  });

  // M1c: the old test pinned `paletteCategory.includes('frontend')` — a DEAD check, since
  // the v3 restructure left no category by that name (the audit's §4.3 finding). The live
  // mechanism is the role-id heuristic, which is what this now pins.
  it('puts frontend apps in the client column via the role-id heuristic', () => {
    expect(getLayoutPartition('x', makeCatalog(makeRole({ id: 'frontend-app' })))).toBe(LAYOUT_PARTITIONS.client);
    expect(getLayoutPartition('x', makeCatalog(makeRole({ paletteCategory: 'Hardware', id: 'zz' })))).toBe(LAYOUT_PARTITIONS.client);
  });

  it('disambiguates app_service roles by role id', () => {
    expect(getLayoutPartition('x', makeCatalog(makeRole({ id: 'api-gateway' })))).toBe(LAYOUT_PARTITIONS.edge);
    expect(getLayoutPartition('x', makeCatalog(makeRole({ id: 'backend-service' })))).toBe(LAYOUT_PARTITIONS.service);
  });

  it('returns null (no opinion) for containers, platforms, and logical groups', () => {
    expect(getLayoutPartition('x', makeCatalog(makeRole({ isContainer: true })))).toBeNull();
    // Platforms and logical groups ARE containers, so the isContainer guard above already
    // covers them — the old explicit kind list was redundant with it (and its only
    // non-container member, platform_capability, retired in M1b).
    expect(getLayoutPartition('x', makeCatalog(makeRole({ nature: 'host', isContainer: true, id: 'zz-unmatchable' })))).toBeNull();
    expect(getLayoutPartition('x', makeCatalog(makeRole({ isContainer: true, containerStyle: 'logical-boundary', id: 'zz-unmatchable' })))).toBeNull();
  });

  it('falls back to type-id heuristics without a catalog', () => {
    expect(getLayoutPartition('backend.nodejs-service', null)).toBe(LAYOUT_PARTITIONS.service);
    expect(getLayoutPartition('database.postgres', null)).toBe(LAYOUT_PARTITIONS.data);
    expect(getLayoutPartition('frontend.react-app', null)).toBe(LAYOUT_PARTITIONS.client);
    expect(getLayoutPartition('message-queue', null)).toBe(LAYOUT_PARTITIONS.messaging);
  });
});

describe('getStaticPartition', () => {
  it('orders edge/gateway matches before generic service matches', () => {
    expect(getStaticPartition('api-gateway-service')).toBe(LAYOUT_PARTITIONS.edge);
    expect(getStaticPartition('event-bus')).toBe(LAYOUT_PARTITIONS.messaging);
    expect(getStaticPartition('ci-pipeline')).toBe(LAYOUT_PARTITIONS.operations);
  });

  it('returns null for unknown ids', () => {
    expect(getStaticPartition('mystery-widget')).toBeNull();
    expect(getStaticPartition('')).toBeNull();
  });
});

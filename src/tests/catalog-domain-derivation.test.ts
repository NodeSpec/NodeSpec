// N5.15 (core/ static-data audit — owner: "multiple sources of truth"): the domain
// registry is DERIVED from DB palette categories and can never silently drop one.
// The old PALETTE_CATEGORY_TO_DOMAIN keyed on pre-v3 category names (Frontend/Backend)
// and buildDomainsFromCatalog skipped every category it didn't know — roles filed under
// Services/Networking/Automation (migration 20260624200858) never got domains built,
// leaving inspector/canvas lookups on the fossilized static registry.
import { describe, it, expect } from 'vitest';
import { buildDomainsFromCatalog } from '../ui/services/CatalogService.js';
import type { CatalogResolver, NodeRole } from '../../src/persistence/supabase/catalog-repository.js';

function role(id: string, paletteCategory: string, overrides: Partial<NodeRole> = {}): NodeRole {
  return {
    id,
    label: id,
    description: `${id} role`,
    iconName: 'box',
    color: '#888888',
    rfVisualType: 'default',
    paletteCategory,
    paletteCategoryLabel: paletteCategory,
    kind: 'app_service',
    isContainer: false,
    containerLayer: null,
    containerStyle: null,
    canContain: null,
    metadataSchema: null,
    defaultPorts: [],
    suggestedContracts: [],
    sortOrder: 1,
    capabilityTags: [],
    defaultTechnology: null,
    altitude: 'service',
    treatmentMode: 'leaf',
    functionalKind: null,
    provider: null,
    whenToUse: null,
    deprecated: false,
    ...overrides,
  } as NodeRole;
}

function fakeResolver(roles: NodeRole[]): CatalogResolver {
  return {
    getAllRoles: () => roles,
    getRole: (id: string) => roles.find(r => r.id === id) ?? null,
    getAllLegacyMappings: () => [],
    getTechnology: () => null,
    getAllTechnologies: () => [],
    getAllDeploymentTargets: () => [],
  } as unknown as CatalogResolver;
}

describe('N5.15 — domains derived from DB categories, no silent drop', () => {
  it('builds domains for the v3 categories the old map dropped (Services/Networking/Automation)', () => {
    const domains = buildDomainsFromCatalog(fakeResolver([
      role('frontend-app', 'Services'),
      role('api-gateway-role', 'Networking'),
      role('ci-pipeline', 'Automation'),
    ]));
    const ids = domains.map(d => d.id).sort();
    expect(ids).toEqual(['automation', 'build', 'networking']);
    expect(domains.find(d => d.id === 'build')!.nodeTypes.map(n => n.id)).toContain('frontend-app');
  });

  it('a NOVEL category is synthesized, never dropped', () => {
    const domains = buildDomainsFromCatalog(fakeResolver([
      role('quantum-thing', 'Quantum Computing'),
    ]));
    expect(domains).toHaveLength(1);
    expect(domains[0].id).toBe('quantum-computing');
    expect(domains[0].label).toBe('Quantum Computing');
    expect(domains[0].nodeTypes.map(n => n.id)).toContain('quantum-thing');
  });

  it('pre-v3 alias categories merge into their v3 domain (read-compat)', () => {
    const domains = buildDomainsFromCatalog(fakeResolver([
      role('old-web', 'Frontend'),
      role('new-web', 'Services'),
    ]));
    expect(domains).toHaveLength(1);
    expect(domains[0].id).toBe('build');
    expect(domains[0].nodeTypes.map(n => n.id).sort()).toEqual(['new-web', 'old-web']);
  });

  it('deprecated roles still excluded; containers without mappings still excluded', () => {
    const domains = buildDomainsFromCatalog(fakeResolver([
      role('dead-role', 'Services', { deprecated: true }),
      role('a-container', 'Infrastructure', { isContainer: true }),
      role('live-role', 'Services'),
    ]));
    expect(domains).toHaveLength(1);
    expect(domains[0].nodeTypes.map(n => n.id)).toEqual(['live-role']);
  });
});

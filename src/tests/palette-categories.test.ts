// M6: was `palette-axis-lens.test.ts`. The axis pivots ('ownership'), the browse bands, and
// the project-context lens they covered are DELETED — no palette surface used them after
// N4.7 made the sidebar three sections, and the lens was broken besides (it matched category
// labels against agent aliases, so it could never activate). What survives is the behavior
// that still has a consumer: how buildPaletteCategories groups and filters roles, and the
// N4.4 logical-group collapse.
import { describe, expect, it } from 'vitest';
import { buildPaletteCategories } from '../ui/utils/palette-roles.js';
import type { CatalogResolver } from '../persistence/supabase/catalog-repository.js';

function role(over: Record<string, unknown>) {
  return {
    id: 'r', label: 'R', description: '', whenToUse: null, iconName: 'box', color: '#000',
    rfVisualType: 'service', paletteCategory: 'Services',
    nature: 'build', provider: null, capabilityTags: [],
    isContainer: false, containerLayer: null, containerStyle: null, canContain: [],
    metadataSchema: null, defaultPorts: [], suggestedContracts: [], sortOrder: 1,
    deprecated: false, defaultTechnology: null,
    ...over,
  };
}

const ROLES = [
  role({ id: 'backend-service', label: 'Backend Service', paletteCategory: 'Services', nature: 'build' }),
  role({ id: 'primary-db', label: 'Database', paletteCategory: 'Database', nature: 'build' }),
  role({ id: 'external-service', label: 'External Service', paletteCategory: 'External', nature: 'call' }),
  role({ id: 'aws', label: 'AWS', paletteCategory: 'Platform', nature: 'host', isContainer: true }),
  role({ id: 'cap', label: 'Capability', nature: 'integrate' }), // always filtered
];

const resolver = {
  getAllRoles: () => ROLES,
  getAllTechnologies: () => [],
} as unknown as CatalogResolver;

describe('buildPaletteCategories — grouping and filtering', () => {
  it('groups by palette_category in sort order, and drops `integrate` roles', () => {
    const cats = buildPaletteCategories(resolver);
    expect(cats.map(c => c.label)).toEqual(['Services', 'Database', 'Platform', 'External']);
    expect(cats.find(c => c.label === 'Services')!.isPrimary).toBe(true);
    // M1c RULE B: `integrate` roles are reached through their platform, never browsed loose.
    expect(cats.flatMap(c => c.roles.map(r => r.id))).not.toContain('cap');
  });
});

describe('N4.4 — logical group flavors collapse to ONE recognition-time entry', () => {
  const logicalRoles = [
    role({ id: 'application-module', label: 'Application Module', paletteCategory: 'Logical', nature: 'build', isContainer: true, containerStyle: 'logical-boundary' }),
    role({ id: 'bounded-context', label: 'Bounded Context (DDD)', paletteCategory: 'Logical', nature: 'build', isContainer: true, containerStyle: 'logical-boundary' }),
    role({ id: 'software-layer', label: 'Software Layer', paletteCategory: 'Logical', nature: 'build', isContainer: true, containerStyle: 'logical-boundary' }),
  ];
  const withLogical = {
    ...resolver,
    getAllRoles: () => [...ROLES, ...logicalRoles],
  } as unknown as CatalogResolver;

  it('browse shows ONE "Group" row (dragging application-module); flavors stay out of browse', () => {
    const cats = buildPaletteCategories(withLogical);
    const logical = cats.find(c => c.label === 'Logical');
    expect(logical).toBeDefined();
    expect(logical!.roles).toHaveLength(1);
    expect(logical!.roles[0].label).toBe('Group');
    expect(logical!.roles[0].id).toBe('application-module');
    expect(logical!.roles[0].description).toContain('Optional');
    // the flavors stay individually reachable by SEARCH, not by browse
    expect(cats.flatMap(c => c.roles.map(r => r.label))).not.toContain('Bounded Context (DDD)');
  });
});

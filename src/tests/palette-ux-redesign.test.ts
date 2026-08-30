import { describe, it, expect } from 'vitest';
import type { CatalogResolver, NodeRole, TechnologyCatalogEntry } from '../persistence/supabase/catalog-repository.js';
import { buildPaletteCategories, resolveNodeCreationParams, getRoleIcon } from '../ui/utils/palette-roles.js';

function makeRole(id: string, opts: Partial<NodeRole> = {}): NodeRole {
  return {
    id,
    label: opts.label ?? id,
    description: opts.description ?? '',
    iconName: opts.iconName ?? 'server',
    color: opts.color ?? '#3b82f6',
    rfVisualType: opts.rfVisualType ?? 'icon',
    isContainer: opts.isContainer ?? false,
    sortOrder: opts.sortOrder ?? 0,
    paletteCategory: opts.paletteCategory ?? 'Services',
    nature: opts.nature ?? 'build',
    interfaceKind: opts.interfaceKind ?? 'service',
    provider: opts.provider ?? null,
    capabilityTags: opts.capabilityTags ?? [],
    canContain: opts.canContain ?? [],
    containerLayer: opts.containerLayer ?? null,
    containerStyle: opts.containerStyle ?? null,
    metadataSchema: opts.metadataSchema ?? null,
    defaultPorts: opts.defaultPorts ?? [],
    suggestedContracts: opts.suggestedContracts ?? [],
    deprecated: opts.deprecated ?? false,
    whenToUse: opts.whenToUse ?? null,
    defaultTechnology: opts.defaultTechnology ?? null,
    ...opts,
  };
}

function makeTech(id: string, name: string, roleAffinities: string[], opts: Partial<TechnologyCatalogEntry> = {}): TechnologyCatalogEntry {
  return {
    id,
    name,
    roleAffinities,
    brandColor: opts.brandColor ?? '#000000',
    secondaryColor: opts.secondaryColor ?? null,
    displayName: opts.displayName ?? null,
    iconUrl: opts.iconUrl ?? null,
    aiContext: opts.aiContext ?? {},
    suggestedFiles: opts.suggestedFiles ?? null,
        metadataSchema: opts.metadataSchema ?? null,
    commonConnections: opts.commonConnections ?? null,
    isUserContributed: opts.isUserContributed ?? false,
    projectId: opts.projectId ?? null,
    createdBy: opts.createdBy ?? null,
    ...opts,
  };
}

function buildCatalog(
  roles: NodeRole[],
  technologies: TechnologyCatalogEntry[],
): CatalogResolver {
  const roleIndex = new Map(roles.map(r => [r.id, r]));
  const techIndex = new Map(technologies.map(t => [t.id, t]));

  return {
    resolveNodeType(roleId: string) {
      const role = roleIndex.get(roleId);
      return role ? { role, technology: null, deploymentTarget: null } : null;
    },
    getRole(roleId: string) { return roleIndex.get(roleId) ?? null; },
    getTechnology(techId: string) { return techIndex.get(techId) ?? null; },
    getDeploymentTarget() { return null; },
    getAllRoles() { return roles; },
    getAllTechnologies() { return technologies; },
    getAllDeploymentTargets() { return []; },
    getRolesByCategory(category: string) { return roles.filter(r => r.paletteCategory === category); },
    getTechnologiesForRole(roleId: string) {
      return technologies.filter(t => t.roleAffinities.includes(roleId));
    },
  };
}

describe('Phase 8: Palette UX Redesign', () => {
  describe('buildPaletteCategories', () => {
    it('groups roles by palette_category', () => {
      const catalog = buildCatalog([
        makeRole('frontend-app', { paletteCategory: 'Services', sortOrder: 1 }),
        makeRole('backend-service', { paletteCategory: 'Services', sortOrder: 2 }),
        makeRole('database', { paletteCategory: 'Database', sortOrder: 1 }),
      ], []);

      const categories = buildPaletteCategories(catalog);

      expect(categories.length).toBe(2);
      const servicesCat = categories.find(c => c.id === 'services');
      expect(servicesCat).toBeDefined();
      expect(servicesCat!.roles.length).toBe(2);
      expect(servicesCat!.roles[0].id).toBe('frontend-app');
    });

    it('sorts categories by sortOrder', () => {
      const catalog = buildCatalog([
        makeRole('backend-service', { paletteCategory: 'Services', sortOrder: 1 }),
        makeRole('database', { paletteCategory: 'Database', sortOrder: 1 }),
        makeRole('api-gateway', { paletteCategory: 'Networking', sortOrder: 1 }),
      ], []);

      const categories = buildPaletteCategories(catalog);
      const ids = categories.map(c => c.id);

      expect(ids.indexOf('services')).toBeLessThan(ids.indexOf('database'));
      expect(ids.indexOf('database')).toBeLessThan(ids.indexOf('networking'));
    });

    it('sorts roles within a category by sortOrder', () => {
      const catalog = buildCatalog([
        makeRole('rest-api', { paletteCategory: 'Messaging', sortOrder: 2 }),
        makeRole('graphql-api', { paletteCategory: 'Messaging', sortOrder: 1 }),
      ], []);

      const categories = buildPaletteCategories(catalog);
      const msgCat = categories.find(c => c.label === 'Messaging');
      expect(msgCat!.roles[0].id).toBe('graphql-api');
      expect(msgCat!.roles[1].id).toBe('rest-api');
    });

    it('counts technologies per role from roleAffinities', () => {
      const catalog = buildCatalog(
        [makeRole('backend-service', { paletteCategory: 'Services' })],
        [
          makeTech('nodejs', 'Node.js', ['backend-service']),
          makeTech('python', 'Python', ['backend-service']),
          makeTech('go', 'Go', ['backend-service']),
          makeTech('react', 'React', ['frontend-app']),
        ],
      );

      const categories = buildPaletteCategories(catalog);
      const servicesCat = categories.find(c => c.id === 'services');
      expect(servicesCat!.roles[0].technologyCount).toBe(3);
    });

    it('places roles with unknown palette categories at the end', () => {
      const catalog = buildCatalog([
        makeRole('backend-service', { paletteCategory: 'Services' }),
        makeRole('unknown-role', { paletteCategory: 'NonExistentCategory' }),
      ], []);

      const categories = buildPaletteCategories(catalog);
      const servicesCat = categories.find(c => c.id === 'services')!;
      const unknownCat = categories.find(c => c.roles.some(r => r.id === 'unknown-role'))!;
      expect(servicesCat.sortOrder).toBeLessThan(unknownCat.sortOrder);
    });
  });

  describe('resolveNodeCreationParams', () => {
    // N9a: node.type = role id ALWAYS — a legacy mapping no longer changes the emitted
    // type (dotted grammar is read-compat only). Canvas- and MCP-created nodes speak one
    // grammar; the AI never sees `backend.nodejs` and `backend-service` for one concept.
    it('emits the role id (N9a)', () => {
      const catalog = buildCatalog(
        [makeRole('backend-service', { label: 'Backend Service' })],
        [makeTech('nodejs', 'Node.js', ['backend-service'])],
      );

      const result = resolveNodeCreationParams('backend-service', 'nodejs', catalog);
      expect(result.nodeType).toBe('backend-service');
      expect(result.technology).toBe('nodejs');
      expect(result.displayName).toBe('Node.js');
    });

    it('N9a pin: a canvas-created React node is frontend-app + react', () => {
      const catalog = buildCatalog(
        [makeRole('frontend-app', { label: 'Frontend App' })],
        [makeTech('react', 'React', ['frontend-app'])],
      );

      const result = resolveNodeCreationParams('frontend-app', 'react', catalog);
      expect(result.nodeType).toBe('frontend-app');
      expect(result.technology).toBe('react');
    });

    it('role ID also used when no legacy mapping exists', () => {
      const catalog = buildCatalog(
        [makeRole('backend-service', { label: 'Backend Service' })],
        [makeTech('elixir', 'Elixir', ['backend-service'])],
      );

      const result = resolveNodeCreationParams('backend-service', 'elixir', catalog);
      expect(result.nodeType).toBe('backend-service');
      expect(result.technology).toBe('elixir');
      expect(result.displayName).toBe('Elixir');
    });

    it('uses role label when no technology is selected', () => {
      const catalog = buildCatalog(
        [makeRole('backend-service', { label: 'Backend Service' })],
        [],
      );

      const result = resolveNodeCreationParams('backend-service', null, catalog);
      expect(result.nodeType).toBe('backend-service');
      expect(result.technology).toBeUndefined();
      expect(result.displayName).toBe('Backend Service');
    });

    it('handles unknown role gracefully', () => {
      const catalog = buildCatalog([], []);

      const result = resolveNodeCreationParams('nonexistent', 'nodejs', catalog);
      expect(result.nodeType).toBe('nonexistent');
      expect(result.technology).toBe('nodejs');
      expect(result.displayName).toBe('nonexistent');
    });
  });

  describe('getTechnologiesForRole', () => {
    it('returns technologies with matching role affinity', () => {
      const catalog = buildCatalog(
        [makeRole('backend-service')],
        [
          makeTech('nodejs', 'Node.js', ['backend-service', 'worker']),
          makeTech('python', 'Python', ['backend-service']),
          makeTech('react', 'React', ['frontend-app']),
        ],
      );

      const techs = catalog.getTechnologiesForRole('backend-service');
      expect(techs.length).toBe(2);
      expect(techs.map(t => t.id)).toContain('nodejs');
      expect(techs.map(t => t.id)).toContain('python');
    });

    it('returns empty array for role with no technologies', () => {
      const catalog = buildCatalog(
        [makeRole('custom-role')],
        [makeTech('react', 'React', ['frontend-app'])],
      );

      const techs = catalog.getTechnologiesForRole('custom-role');
      expect(techs.length).toBe(0);
    });
  });

  describe('getRoleIcon', () => {
    it('returns mapped icon for known icon names', () => {
      const icon = getRoleIcon('server');
      expect(icon).toBeDefined();
      expect(icon).toBeTruthy();
    });

    it('returns fallback Box icon for unknown names', () => {
      const icon = getRoleIcon('nonexistent-icon');
      expect(icon).toBeDefined();
    });
  });


  describe('technology picker threshold logic', () => {
    it('role with 0 technologies should auto-create without picker', () => {
      const catalog = buildCatalog(
        [makeRole('custom-service')],
        [],
      );

      const techs = catalog.getTechnologiesForRole('custom-service');
      expect(techs.length).toBe(0);
      expect(techs.length < 2).toBe(true);
    });

    it('role with 1 technology should auto-assign without picker', () => {
      const catalog = buildCatalog(
        [makeRole('k8s-cluster')],
        [makeTech('kubernetes', 'Kubernetes', ['k8s-cluster'])],
      );

      const techs = catalog.getTechnologiesForRole('k8s-cluster');
      expect(techs.length).toBe(1);
      expect(techs.length < 2).toBe(true);
      expect(techs[0].id).toBe('kubernetes');
    });

    it('role with 2+ technologies should trigger picker', () => {
      const catalog = buildCatalog(
        [makeRole('backend-service')],
        [
          makeTech('nodejs', 'Node.js', ['backend-service']),
          makeTech('python', 'Python', ['backend-service']),
        ],
      );

      const techs = catalog.getTechnologiesForRole('backend-service');
      expect(techs.length).toBe(2);
      expect(techs.length >= 2).toBe(true);
    });
  });

  describe('extensibility', () => {
    it('new technology automatically appears for roles via roleAffinities', () => {
      const catalog = buildCatalog(
        [makeRole('backend-service', { paletteCategory: 'Services' })],
        [
          makeTech('nodejs', 'Node.js', ['backend-service']),
          makeTech('zig', 'Zig', ['backend-service']),
        ],
      );

      const techs = catalog.getTechnologiesForRole('backend-service');
      expect(techs.map(t => t.name)).toContain('Zig');
    });

    it('new role with existing category appears in palette', () => {
      const catalog = buildCatalog([
        makeRole('backend-service', { paletteCategory: 'Services', sortOrder: 1 }),
        makeRole('batch-processor', { paletteCategory: 'Services', sortOrder: 2, label: 'Batch Processor' }),
      ], []);

      const categories = buildPaletteCategories(catalog);
      const servicesCat = categories.find(c => c.id === 'services');
      expect(servicesCat!.roles.length).toBe(2);
      expect(servicesCat!.roles[1].label).toBe('Batch Processor');
    });

    it('resolveNodeCreationParams works for newly added tech without legacy mapping', () => {
      const catalog = buildCatalog(
        [makeRole('backend-service', { label: 'Backend Service' })],
        [makeTech('bun', 'Bun', ['backend-service'])],
      );

      const result = resolveNodeCreationParams('backend-service', 'bun', catalog);
      expect(result.nodeType).toBe('backend-service');
      expect(result.technology).toBe('bun');
      expect(result.displayName).toBe('Bun');
    });
  });
});

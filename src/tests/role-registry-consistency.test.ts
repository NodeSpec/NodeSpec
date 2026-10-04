import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf-8');
}

describe('Role Registry Catalog-Backed Architecture', () => {
  const source = loadFile('../../supabase/functions/_shared/role-registry.ts');

  it('imports CatalogData from catalog-loader', () => {
    expect(source).toContain('from "./catalog-loader.ts"');
    expect(source).toContain('CatalogData');
  });

  it('no longer contains hardcoded ROLE_DEFINITIONS constant', () => {
    expect(source).not.toContain('const ROLE_DEFINITIONS:');
  });

  it('no longer contains hardcoded ROLE_TECHNOLOGY_MAP constant', () => {
    expect(source).not.toContain('const ROLE_TECHNOLOGY_MAP:');
  });

  it('no longer contains hardcoded CATEGORY_LABELS constant', () => {
    expect(source).not.toContain('const CATEGORY_LABELS:');
  });

  it('no longer contains hardcoded ALL_TECHNOLOGY_IDS constant', () => {
    expect(source).not.toContain('const ALL_TECHNOLOGY_IDS:');
  });

  it('exports catalog-backed isValidRoleId with catalogs parameter', () => {
    expect(source).toContain('export function isValidRoleId(catalogs: CatalogData');
  });

  it('exports catalog-backed isValidNodeType with catalogs parameter', () => {
    expect(source).toContain('export function isValidNodeType(catalogs: CatalogData');
  });

  it('exports catalog-backed isValidTechnologyId with catalogs parameter', () => {
    expect(source).toContain('export function isValidTechnologyId(catalogs: CatalogData');
  });

  it('exports catalog-backed validateAndCorrectNodeType with catalogs parameter', () => {
    expect(source).toContain('export function validateAndCorrectNodeType(\n  catalogs: CatalogData');
  });

  it('exports catalog-backed validateTechnology with catalogs parameter', () => {
    expect(source).toContain('export function validateTechnology(\n  catalogs: CatalogData');
  });

  it('exports getValidRoleIds and getValidNodeTypes helpers', () => {
    expect(source).toContain('export function getValidRoleIds(catalogs: CatalogData');
    expect(source).toContain('export function getValidNodeTypes(catalogs: CatalogData');
  });

  it('isValidRoleId checks catalogs.nodeRoles', () => {
    expect(source).toContain('catalogs.nodeRoles');
  });

  it('isValidTechnologyId checks catalogs.technologies and role_affinities', () => {
    expect(source).toContain('catalogs.technologies');
    expect(source).toContain('role_affinities');
  });

  it('getTechnologiesForRole filters by role_affinities', () => {
    expect(source).toContain('t.role_affinities.includes(roleId)');
  });
});

describe('Role Registry Preserved Behaviors', () => {
  const source = loadFile('../../supabase/functions/_shared/role-registry.ts');

  it('preserves Levenshtein fuzzy matching logic', () => {
    expect(source).toContain('levenshteinDistance');
    expect(source).toContain('findClosestRoleId');
    expect(source).toContain('findClosestTechnologyId');
  });

  it('preserves distance threshold of 3 for fuzzy matching', () => {
    expect(source).toContain('distance <= 3');
  });

  it('resolves a dotted type TABLE-FREE, by last segment', () => {
    // M4: the 429-row legacy_type_mappings lookup is gone. The last segment of a dotted
    // type IS its role id under the retired grammar, which is all the tolerance a replayed
    // hash-chained patch needs.
    expect(source).toContain("nodeType.includes('.') ? nodeType.split('.').pop()!");
    expect(source).not.toContain('catalogs.legacyTypeMappings');
  });

  it('no longer contains hardcoded LEGACY_DOTTED_PREFIX_TO_ROLE', () => {
    expect(source).not.toContain('LEGACY_DOTTED_PREFIX_TO_ROLE');
  });

  it('preserves backend-service as ultimate fallback', () => {
    expect(source).toContain("'backend-service'");
  });

  it('preserves the TechnologyOption interface', () => {
    expect(source).toContain('export interface TechnologyOption');
  });
});

// M4/M7: the "Phase 6" block asserted the DB-backed legacy layer in detail —
// LegacyTypeMappingRow, CatalogData.legacyTypeMappings, the legacy_type_mappings query, and
// resolveLegacyDottedType's exact/prefix match cascade. M4 DELETED all of it (429 rows, the
// table, and both TS maps). This file was uncollectable at the time, so nothing noticed.
// Replaced with pins on the absence, so the layer cannot quietly come back.
describe('M4: the legacy type layer is gone, not hidden', () => {
  const catalogLoaderSource = loadFile('../../supabase/functions/_shared/catalog-loader.ts');
  const registrySource = loadFile('../../supabase/functions/_shared/role-registry.ts');

  it('catalog-loader no longer queries or types legacy_type_mappings', () => {
    expect(catalogLoaderSource).not.toContain('legacy_type_mappings');
    expect(catalogLoaderSource).not.toContain('LegacyTypeMappingRow');
    expect(catalogLoaderSource).not.toContain('legacyTypeMappings');
  });

  it('resolveLegacyDottedType is gone from the registry', () => {
    expect(registrySource).not.toContain('resolveLegacyDottedType');
  });

  it('backend-service is still the ultimate fallback for an unresolvable type', () => {
    // The fallback SURVIVES the table's deletion — an unknown type must still land
    // somewhere honest rather than dropping the node.
    expect(registrySource).toContain("'backend-service'");
  });
});

// AH.2: the in-app agent (tool-executor) and the prompt builders only it called are
// deleted: the Phase 3, 4 and 5 pins on add_node, the prompt listing, the technology
// hints and the placeholder technologies went with them.
describe('Role Registry: dotted input tolerance', () => {
  describe('backward compatibility for dotted strings', () => {
    const roleRegistrySource = loadFile('../../supabase/functions/_shared/role-registry.ts');

    it('validateAndCorrectNodeType handles dotted legacy strings', () => {
      expect(roleRegistrySource).toContain("nodeType.includes('.')");
    });
  });

});

describe('technology_catalog carries user-contributed rows', () => {
  it('CatalogData TechnologyRow includes is_user_contributed field', () => {
    const catalogLoader = loadFile('../../supabase/functions/_shared/catalog-loader.ts');
    expect(catalogLoader).toContain('is_user_contributed: boolean');
  });

  it('CatalogData TechnologyRow includes project_id field', () => {
    const catalogLoader = loadFile('../../supabase/functions/_shared/catalog-loader.ts');
    expect(catalogLoader).toContain('project_id: string | null');
  });

  it('CatalogData TechnologyRow includes created_by field', () => {
    const catalogLoader = loadFile('../../supabase/functions/_shared/catalog-loader.ts');
    expect(catalogLoader).toContain('created_by: string | null');
  });

  it('loadCatalogs selects is_user_contributed, project_id, created_by', () => {
    const catalogLoader = loadFile('../../supabase/functions/_shared/catalog-loader.ts');
    expect(catalogLoader).toContain('is_user_contributed');
    expect(catalogLoader).toContain('project_id');
    expect(catalogLoader).toContain('created_by');
  });
});

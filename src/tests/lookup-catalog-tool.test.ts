import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf-8');
}

// AH.2: the in-app agent's lookup_catalog tool went with the old agent; the MCP tool
// of the same name reads lookupCatalog below (ag12a-placement-over-mcp_test.ts runs it).
describe('lookupCatalog Function in role-registry.ts', () => {
  const registrySource = loadFile('../../supabase/functions/_shared/role-registry.ts');

  it('exports CatalogLookupParams interface', () => {
    expect(registrySource).toContain('export interface CatalogLookupParams');
  });

  it('CatalogLookupParams has category, roleId, technologyId fields', () => {
    expect(registrySource).toContain('category?: string');
    expect(registrySource).toContain('roleId?: string');
    expect(registrySource).toContain('technologyId?: string');
  });

  it('exports lookupCatalog function accepting CatalogLookupParams', () => {
    expect(registrySource).toContain('export function lookupCatalog(');
    expect(registrySource).toContain('params: CatalogLookupParams');
  });

  it('dispatches to lookupTechnology when technologyId provided', () => {
    expect(registrySource).toContain('if (params.technologyId)');
    expect(registrySource).toContain('return lookupTechnology(catalogs, params.technologyId)');
  });

  it('dispatches to lookupRole when roleId provided', () => {
    expect(registrySource).toContain('if (params.roleId)');
    expect(registrySource).toContain('return lookupRole(catalogs, params.roleId');
  });

  it('dispatches to lookupCategory when category provided', () => {
    expect(registrySource).toContain('if (params.category)');
    expect(registrySource).toContain('return lookupCategory(catalogs, params.category');
  });
});

describe('lookupTechnology Returns Rich Data', () => {
  const registrySource = loadFile('../../supabase/functions/_shared/role-registry.ts');

  it('returns ai_context purpose', () => {
    expect(registrySource).toContain('ctx.purpose');
  });

  it('returns ai_context bestPractices', () => {
    expect(registrySource).toContain('ctx.bestPractices');
  });

  it('returns ai_context antiPatterns', () => {
    expect(registrySource).toContain('ctx.antiPatterns');
  });

  it('returns suggested_files', () => {
    expect(registrySource).toContain('tech.suggested_files');
    expect(registrySource).toContain('Suggested files:');
  });

  it('returns common_connections', () => {
    expect(registrySource).toContain('tech.common_connections');
    expect(registrySource).toContain('Common connections:');
  });

  it('returns role_affinities', () => {
    expect(registrySource).toContain('tech.role_affinities.join');
  });

  it('suggests close matches when technology not found', () => {
    expect(registrySource).toContain('Did you mean:');
  });
});

describe('lookupRole Returns Rich Data', () => {
  const registrySource = loadFile('../../supabase/functions/_shared/role-registry.ts');

  it('returns role description', () => {
    expect(registrySource).toContain('Description: ${role.description}');
  });

  it('returns category label', () => {
    // M2: categoryLabel comes from the shared palette-categories module, not a DB table,
    // so it no longer takes a `catalogs` argument.
    expect(registrySource).toContain('Category: ${categoryLabel(role.palette_category)}');
  });

  // AG.12c: how a role holds and what it may hold is read through the real lookup in
  // Deno (ag12a-placement-over-mcp_test.ts), not pinned in this file's source.

  it('returns capability_tags', () => {
    expect(registrySource).toContain('Capabilities: ${role.capability_tags.join');
  });

  it('returns technologies with ai_context purpose summaries', () => {
    expect(registrySource).toContain('t.ai_context?.purpose');
  });

  it('returns suggested_contracts', () => {
    expect(registrySource).toContain('Suggested contracts:');
    expect(registrySource).toContain('role.suggested_contracts');
  });
});

describe('lookupCategory Returns Rich Data', () => {
  const registrySource = loadFile('../../supabase/functions/_shared/role-registry.ts');

  it('lists all roles in the category', () => {
    expect(registrySource).toContain('r.palette_category === displayKey');
  });

  it('includes technologies for each role', () => {
    expect(registrySource).toContain("Technologies: ${techs.map(t => t.id).join(', ')}");
  });

  it('includes capability_tags for roles', () => {
    expect(registrySource).toContain("Capabilities: ${row.capability_tags.join(', ')}");
  });

  it('respects project relevance filter', () => {
    expect(registrySource).toContain('relevantRoleIds');
  });
});


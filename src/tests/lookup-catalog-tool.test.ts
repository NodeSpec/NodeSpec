import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf-8');
}

describe('lookup_catalog Tool Definition', () => {
  const toolExecutorSource = loadFile('../../supabase/functions/_shared/tool-executor.ts');

  it('defines lookup_catalog in ARCHITECTURE_TOOLS', () => {
    expect(toolExecutorSource).toContain("name: 'lookup_catalog'");
  });

  it('has category parameter', () => {
    expect(toolExecutorSource).toContain("category: { type: 'string'");
  });

  it('has roleId parameter', () => {
    expect(toolExecutorSource).toContain("roleId: { type: 'string'");
  });

  it('has technologyId parameter', () => {
    expect(toolExecutorSource).toContain("technologyId: { type: 'string'");
  });

  it('has no required parameters (all optional)', () => {
    expect(toolExecutorSource).toMatch(/name: 'lookup_catalog'[\s\S]*?required: \[\]/);
  });

  it('imports lookupCatalog from role-registry', () => {
    expect(toolExecutorSource).toContain('lookupCatalog');
    expect(toolExecutorSource).toContain('from "./role-registry.ts"');
  });
});

describe('toolLookupCatalog Implementation', () => {
  const toolExecutorSource = loadFile('../../supabase/functions/_shared/tool-executor.ts');

  it('extracts category from args', () => {
    expect(toolExecutorSource).toContain("args.category ? String(args.category)");
  });

  it('extracts roleId from args', () => {
    expect(toolExecutorSource).toContain("args.roleId ? String(args.roleId)");
  });

  it('extracts technologyId from args', () => {
    expect(toolExecutorSource).toContain("args.technologyId ? String(args.technologyId)");
  });

  it('supports legacy categoryOrRole fallback', () => {
    expect(toolExecutorSource).toContain('args.categoryOrRole');
  });

  it('returns error when catalog is not loaded', () => {
    expect(toolExecutorSource).toContain("error: 'Catalog not loaded'");
  });

  it('returns error when no parameters provided', () => {
    expect(toolExecutorSource).toContain('Provide at least one of: category, roleId, or technologyId');
  });
});

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

  it('preserves backward-compatible lookupCatalogCategory', () => {
    expect(registrySource).toContain('export function lookupCatalogCategory(');
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

  it('returns container info when applicable', () => {
    // M1c/M2: the flat [CONTAINER] tag became containerTag(role), which distinguishes
    // hosting containers from logical boundaries.
    expect(registrySource).toContain('${containerTag(role)} - layer:');
    expect(registrySource).toContain('Can contain:');
  });

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

  it('marks container roles', () => {
    expect(registrySource).toContain('containerTag(row)');
  });

  it('respects project relevance filter', () => {
    expect(registrySource).toContain('relevantRoleIds');
  });
});

describe('agent-loop-v4 lookup_catalog integration', () => {
  const agentSource = loadFile('../../supabase/functions/_shared/agent-loop-v4.ts');

  it('has lookup_catalog in TOOL_DISPLAY_NAMES', () => {
    expect(agentSource).toContain('lookup_catalog: "Looking up catalog details..."');
  });

  it('references lookup_catalog in catalog summary prompt', () => {
    expect(agentSource).toContain('lookup_catalog');
  });
});

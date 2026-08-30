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

  it('exports catalog-backed getAllNodeTypesForPrompt with catalogs parameter', () => {
    expect(source).toContain('export function getAllNodeTypesForPrompt(catalogs: CatalogData');
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

  it('preserves RoleDefinition and TechnologyOption interfaces', () => {
    expect(source).toContain('export interface RoleDefinition');
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

describe('Phase 4: Tool Interface Contract', () => {
  const toolExecutorSource = loadFile('../../supabase/functions/_shared/tool-executor.ts');
  const agentLoopSource = loadFile('../../supabase/functions/_shared/agent-loop-v4.ts');

  describe('add_node tool definition uses role param', () => {
    it('tool schema has "role" as a required property', () => {
      expect(toolExecutorSource).toContain("required: ['label', 'role']");
    });

    it('tool schema describes role as architectural role ID', () => {
      expect(toolExecutorSource).toContain('Architectural role ID');
    });

    it('tool schema properties include role, not a standalone type property', () => {
      const addNodeBlock = toolExecutorSource.match(/name:\s*'add_node'[\s\S]*?required:\s*\[.*?\]/);
      expect(addNodeBlock).toBeTruthy();
      const propsSection = addNodeBlock![0];
      expect(propsSection).toContain('role: {');
      expect(propsSection).not.toMatch(/\btype: \{ type: 'string'/);
    });
  });

  describe('update_node tool definition uses role param', () => {
    it('tool schema has "role" property', () => {
      const updateNodeBlock = toolExecutorSource.match(/name:\s*'update_node'[\s\S]*?required:\s*\[.*?\]/);
      expect(updateNodeBlock).toBeTruthy();
      expect(updateNodeBlock![0]).toContain('role:');
    });
  });

  describe('executor reads args.role with args.type fallback', () => {
    it('toolAddNode reads args.role with args.type fallback', () => {
      expect(toolExecutorSource).toContain('args.role || args.type');
    });

    it('toolUpdateNode reads args.role with args.type fallback', () => {
      expect(toolExecutorSource).toContain('args.role || args.type');
    });
  });

  describe('executor passes catalogs to registry functions', () => {
    it('validates node types via ctx.catalogs', () => {
      expect(toolExecutorSource).toContain('validateAndCorrectNodeType(ctx.catalogs!');
      expect(toolExecutorSource).toContain('isValidNodeType(ctx.catalogs!');
      expect(toolExecutorSource).toContain('validateTechnology(ctx.catalogs!');
    });
  });

  describe('AI system prompt uses role-first language', () => {
    it('prompt explains role-based node model', () => {
      expect(agentLoopSource).toContain('ROLE-BASED NODE MODEL');
    });

    // M7: the three assertions here pinned v3 prompt WORDING ("Pick the architectural role
    // FIRST", "validated by our backend schema") that the v4 loop states differently. Pinned
    // on the semantics instead, which is what actually has to hold.
    it('prompt presents role as required and technology as optional', () => {
      expect(agentLoopSource).toContain('**role** (required)');
      expect(agentLoopSource).toContain('**technology** (optional)');
    });

    it('prompt distinguishes logical boundaries from hosting containers', () => {
      expect(agentLoopSource).toContain('[LOGICAL BOUNDARY]');
      expect(agentLoopSource).toContain('[HOSTING CONTAINER]');
    });

    it('graph state shows nodes with role notation', () => {
      expect(agentLoopSource).toContain('(role: ${n.type}');
    });

    it('getCatalogSummaryForPrompt receives catalogs', () => {
      expect(agentLoopSource).toContain('getCatalogSummaryForPrompt(ctx.catalogs!');
    });
  });

  describe('backward compatibility for dotted strings', () => {
    const roleRegistrySource = loadFile('../../supabase/functions/_shared/role-registry.ts');

    it('validateAndCorrectNodeType handles dotted legacy strings', () => {
      expect(roleRegistrySource).toContain("nodeType.includes('.')");
    });
  });

});

describe('Phase 3: getAllNodeTypesForPrompt from Database', () => {
  const source = loadFile('../../supabase/functions/_shared/role-registry.ts');

  it('groups roles by palette_category from catalogs.nodeRoles', () => {
    expect(source).toContain('row.palette_category');
    expect(source).toContain('byCategory[row.palette_category]');
  });

  it('sorts roles within each category by sort_order', () => {
    expect(source).toContain('a.sort_order - b.sort_order');
  });

  it('pulls technologies via getTechnologiesForRole using role_affinities', () => {
    expect(source).toContain('getTechnologiesForRole(catalogs, row.id)');
  });

  it('uses a stable category display order for prompt consistency', () => {
    // M2: the order comes from the static palette-categories module, not a DB table —
    // getCategoryDisplayOrder takes no catalogs argument any more.
    expect(source).toContain('getCategoryDisplayOrder()');
    expect(source).toContain('displayOrder');
    expect(source).toContain('knownSet');
  });

  it('appends unknown categories after the known order', () => {
    expect(source).toContain('extraCategories');
    expect(source).toContain('!knownSet.has(c)');
  });

  it('maps category keys to human-readable labels from the shared module', () => {
    // M2: `palette_categories` (the table) is dropped; categoryLabel lives in
    // palette-categories.ts, mirrored on both runtimes.
    expect(source).toContain('categoryLabel');
    expect(source).toContain('from "./palette-categories.ts"');
    expect(source).not.toContain('catalogs.paletteCategories');
  });

  it('preserves the output format: role ID, description, technology list, container flag', () => {
    expect(source).toContain('`- ${row.id}: ${row.description}`');
    expect(source).toContain("Technologies:");
    // M1c/M2: the flat `[CONTAINER]` tag became containerTag(row), which distinguishes
    // [HOSTING CONTAINER] from [LOGICAL BOUNDARY] — the distinction that decides whether the
    // node owns a provisioning deliverable or none.
    expect(source).toContain('${containerTag(row)} - can hold child nodes');
  });

  it('iterates NodeRoleRow objects directly (not a hardcoded constant)', () => {
    expect(source).toContain('Object.values(catalogs.nodeRoles)');
    expect(source).not.toContain('ROLE_DEFINITIONS');
  });

  it('agent-loop.ts passes ctx.catalogs to getCatalogSummaryForPrompt', () => {
    const agentLoop = loadFile('../../supabase/functions/_shared/agent-loop-v4.ts');
    expect(agentLoop).toContain('getCatalogSummaryForPrompt(ctx.catalogs!');
  });
});

describe('Phase 4: Selective AI Context Injection', () => {
  const registrySource = loadFile('../../supabase/functions/_shared/role-registry.ts');
  const agentLoopSource = loadFile('../../supabase/functions/_shared/agent-loop-v4.ts');
  const toolExecutorSource = loadFile('../../supabase/functions/_shared/tool-executor.ts');

  describe('Tier 1: Lean role+tech IDs in getAllNodeTypesForPrompt', () => {
    it('outputs role ID and description per role', () => {
      expect(registrySource).toContain('`- ${row.id}: ${row.description}`');
    });

    it('outputs technology IDs (not full objects) for each role', () => {
      expect(registrySource).toContain('techs.map(t => t.id).join');
    });

    it('does not include ai_context in the role listing', () => {
      const promptFn = registrySource.match(/export function getAllNodeTypesForPrompt[\s\S]*?^}/m);
      expect(promptFn).toBeTruthy();
      expect(promptFn![0]).not.toContain('ai_context');
      expect(promptFn![0]).not.toContain('bestPractices');
      expect(promptFn![0]).not.toContain('antiPatterns');
    });
  });

  describe('Tier 2: Focused Technology Guidance', () => {
    // M7: this block pinned collectInScopeTechnologies + buildTechnologyGuidance, the v3
    // pair. The v4 loop uses buildTieredTechnologyGuidance (technology-relevance.ts) fed by
    // resolveRelevantTechnologies — same job, relevance-tiered. The v3 pair still EXISTS in
    // role-registry but has no caller anywhere; recorded as dead code rather than pinned.
    const relevanceSource = loadFile('../../supabase/functions/_shared/technology-relevance.ts');

    it('agent-loop-v4 imports the tiered guidance builder', () => {
      expect(agentLoopSource).toContain('buildTieredTechnologyGuidance');
      expect(agentLoopSource).toContain('resolveRelevantTechnologies');
    });

    it('the architecture prompt injects the guidance it builds', () => {
      expect(agentLoopSource).toContain('technologyGuidance = buildTieredTechnologyGuidance(');
      expect(agentLoopSource).toContain('${technologyGuidance}');
    });

    it('the guidance reads ai_context purpose / bestPractices / antiPatterns from the catalog', () => {
      expect(relevanceSource).toContain('purpose');
      expect(relevanceSource).toContain('bestPractices');
      expect(relevanceSource).toContain('antiPatterns');
    });
  });

  describe('Tier 3: On-Demand Technology Hints in Tool Responses', () => {
    it('exports getTechnologyHints from role-registry', () => {
      expect(registrySource).toContain('export function getTechnologyHints(');
    });

    it('getTechnologyHints returns suggested_files from catalog', () => {
      expect(registrySource).toContain('tech.suggested_files');
    });

    it('getTechnologyHints returns common_connections from catalog', () => {
      expect(registrySource).toContain('tech.common_connections');
    });

    // N8.4q: technology_catalog.default_metadata was DROPPED as an orphan column
    // (migration 20260728020000) — nothing in the packet/context/readiness pipeline
    // read it. These pins keep it from creeping back into the hint lane.
    it('getTechnologyHints no longer reads the dropped default_metadata column', () => {
      expect(registrySource).not.toContain('tech.default_metadata');
    });

    it('tool-executor imports getTechnologyHints', () => {
      expect(toolExecutorSource).toContain('getTechnologyHints');
      expect(toolExecutorSource).toContain('from "./role-registry.ts"');
    });

    it('toolAddNode calls getTechnologyHints when creating a node with technology', () => {
      expect(toolExecutorSource).toContain('getTechnologyHints(ctx.catalogs');
    });

    it('toolAddNode includes suggested_files in response when available', () => {
      expect(toolExecutorSource).toContain('responseData.suggested_files = hints.suggested_files');
    });

    it('toolAddNode includes common_connections in response when available', () => {
      expect(toolExecutorSource).toContain('responseData.common_connections = hints.common_connections');
    });

    it('toolAddNode no longer emits the dropped default_metadata field', () => {
      expect(toolExecutorSource).not.toContain('responseData.default_metadata');
    });

    it('hints are only added for newly created nodes (action: created), not updated ones', () => {
      const addNodeFn = toolExecutorSource.match(/function toolAddNode[\s\S]*?^}/m);
      expect(addNodeFn).toBeTruthy();
      const afterCreated = addNodeFn![0].indexOf("action: 'created'");
      const hintsCall = addNodeFn![0].indexOf('getTechnologyHints');
      expect(hintsCall).toBeGreaterThan(afterCreated);
    });
  });

  describe('no hardcoded ai_context in prompts', () => {
    it('agent-loop does not contain hardcoded technology best practices', () => {
      expect(agentLoopSource).not.toContain('bestPractices:');
      expect(agentLoopSource).not.toContain('antiPatterns:');
    });

    it('role-registry builds guidance dynamically from catalog ai_context field', () => {
      expect(registrySource).toContain('tech.ai_context');
    });
  });
});

describe('Phase 5: User-Specified / Unknown Technologies', () => {
  const registrySource = loadFile('../../supabase/functions/_shared/role-registry.ts');
  const toolExecutorSource = loadFile('../../supabase/functions/_shared/tool-executor.ts');

  describe('Placeholder technology creation in role-registry', () => {
    it('exports buildPlaceholderTechnology function', () => {
      expect(registrySource).toContain('export function buildPlaceholderTechnology(');
    });

    it('exports registerPlaceholderTechnology function', () => {
      expect(registrySource).toContain('export async function registerPlaceholderTechnology(');
    });

    it('buildPlaceholderTechnology normalizes the raw name into a kebab-case ID', () => {
      expect(registrySource).toContain("rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-')");
    });

    it('buildPlaceholderTechnology sets is_user_contributed = true', () => {
      expect(registrySource).toContain('is_user_contributed: true');
    });

    it('buildPlaceholderTechnology sets the project_id from the caller', () => {
      expect(registrySource).toContain('project_id: projectId');
    });

    it('buildPlaceholderTechnology sets the created_by from the caller', () => {
      expect(registrySource).toContain('created_by: userId');
    });

    it('buildPlaceholderTechnology sets the role in role_affinities', () => {
      expect(registrySource).toContain('role_affinities: [roleId]');
    });

    it('buildPlaceholderTechnology sets empty ai_context', () => {
      expect(registrySource).toContain('ai_context: {}');
    });

    it('buildPlaceholderTechnology sets empty suggested_files', () => {
      const fn = registrySource.match(/export function buildPlaceholderTechnology[\s\S]*?^}/m);
      expect(fn).toBeTruthy();
      expect(fn![0]).toContain('suggested_files: []');
    });

    it('registerPlaceholderTechnology checks if tech already exists in catalog before inserting', () => {
      expect(registrySource).toContain('catalogs.technologies[placeholder.id]');
    });

    it('registerPlaceholderTechnology upserts to technology_catalog table', () => {
      expect(registrySource).toContain("from('technology_catalog')");
      expect(registrySource).toContain('.upsert(');
    });

    it('registerPlaceholderTechnology adds the placeholder to the in-memory catalog', () => {
      expect(registrySource).toContain('catalogs.technologies[placeholder.id] = placeholder');
    });

    it('registerPlaceholderTechnology uses ignoreDuplicates to avoid overwriting curated entries', () => {
      expect(registrySource).toContain('ignoreDuplicates: true');
    });

    it('registerPlaceholderTechnology appends role affinity if tech exists but role is missing', () => {
      expect(registrySource).toContain('existing.role_affinities.includes(placeholder.role_affinities[0])');
    });
  });

  describe('Tier 2 guidance for user-contributed technologies', () => {
    it('buildTechnologyGuidance checks is_user_contributed flag on each technology', () => {
      expect(registrySource).toContain('tech.is_user_contributed');
    });

    it('includes [user-specified] tag in guidance for user-contributed technologies', () => {
      expect(registrySource).toContain('[user-specified]');
    });

    it('includes the general engineering principles note for user-contributed technologies', () => {
      expect(registrySource).toContain('user-specified technology without curated best practices');
      expect(registrySource).toContain('Apply general software engineering principles');
    });

    it('builds sections in order with user-contributed after curated', () => {
      expect(registrySource).toContain('buildTechSection(tech)');
      expect(registrySource).toContain('[user-specified]');
    });
  });

  describe('toolAddNode integration with placeholder technologies', () => {
    it('tool-executor imports buildPlaceholderTechnology', () => {
      expect(toolExecutorSource).toContain('buildPlaceholderTechnology');
    });

    it('tool-executor imports registerPlaceholderTechnology', () => {
      expect(toolExecutorSource).toContain('registerPlaceholderTechnology');
    });

    it('toolAddNode is async to support database placeholder registration', () => {
      expect(toolExecutorSource).toContain('async function toolAddNode(');
    });

    it('toolAddNode is awaited in executeTool switch', () => {
      expect(toolExecutorSource).toContain('result = await toolAddNode(ctx, args)');
    });

    it('toolAddNode creates a placeholder when technology is not in catalog and not correctable', () => {
      expect(toolExecutorSource).toContain('buildPlaceholderTechnology(technology, role, ctx.projectId, ctx.userId)');
    });

    it('toolAddNode registers the placeholder via registerPlaceholderTechnology', () => {
      expect(toolExecutorSource).toContain('registerPlaceholderTechnology(ctx.supabase, ctx.catalogs!, placeholder)');
    });

    it('toolAddNode updates technology to the registered ID after placeholder creation', () => {
      expect(toolExecutorSource).toContain('technology = reg.techId');
    });

    it('placeholder creation happens for both new-node and existing-node update paths', () => {
      const matches = toolExecutorSource.match(/buildPlaceholderTechnology\(/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('technology_catalog table supports user-contributed entries', () => {
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
});


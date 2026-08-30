import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

function loadFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf-8');
}

describe('Catalog Loader Module Structure', () => {
  const source = loadFile('../../supabase/functions/_shared/catalog-loader.ts');

  it('exports NodeRoleRow interface', () => {
    expect(source).toContain('export interface NodeRoleRow');
  });

  it('exports TechnologyRow interface', () => {
    expect(source).toContain('export interface TechnologyRow');
  });

  it('exports DeploymentTargetRow interface', () => {
    expect(source).toContain('export interface DeploymentTargetRow');
  });

  it('exports CatalogData interface with three indexed collections', () => {
    expect(source).toContain('export interface CatalogData');
    expect(source).toContain('nodeRoles: Record<string, NodeRoleRow>');
    expect(source).toContain('technologies: Record<string, TechnologyRow>');
    expect(source).toContain('deploymentTargets: Record<string, DeploymentTargetRow>');
  });

  it('exports loadCatalogs async function', () => {
    expect(source).toContain('export async function loadCatalogs');
  });

  it('queries all three tables in parallel via Promise.all', () => {
    expect(source).toContain('Promise.all');
    expect(source).toContain("from('node_roles')");
    expect(source).toContain("from('technology_catalog')");
    expect(source).toContain("from('deployment_targets')");
  });

  it('throws on query errors instead of silently returning empty', () => {
    expect(source).toContain('rolesResult.error');
    expect(source).toContain('techResult.error');
    expect(source).toContain('targetsResult.error');
    expect(source).toContain('throw new Error');
  });

  it('NodeRoleRow includes AI-relevant fields', () => {
    expect(source).toContain('palette_category: string');
    expect(source).toContain('is_container: boolean');
    expect(source).toContain('container_layer: string | null');
    expect(source).toContain('default_ports:');
    expect(source).toContain('suggested_contracts:');
  });

  it('NodeRoleRow includes container_style field', () => {
    expect(source).toContain("container_style: 'hosting' | 'logical-boundary' | null");
  });

  it('loadCatalogs SELECT query includes container_style', () => {
    expect(source).toContain('container_style');
  });

  it('TechnologyRow types ai_context via the unified AiContext (N8.3 — the inline shape moved to catalog-schemas)', () => {
    expect(source).toContain('ai_context: AiContext');
    expect(source).toContain('from "./catalog-schemas.ts"');
    expect(source).toContain('role_affinities:');
  });

  it('TechnologyRow supports user-contributed technologies', () => {
    expect(source).toContain('is_user_contributed: boolean');
    expect(source).toContain('project_id: string | null');
  });
});

describe('ToolContext Catalog Integration', () => {
  const toolExecutorSource = loadFile('../../supabase/functions/_shared/tool-executor.ts');

  it('imports CatalogData type from catalog-loader', () => {
    expect(toolExecutorSource).toContain('from "./catalog-loader.ts"');
    expect(toolExecutorSource).toContain('CatalogData');
  });

  it('ToolContext interface includes optional catalogs field', () => {
    expect(toolExecutorSource).toContain('catalogs?: CatalogData');
  });
});

describe('Agent Loop Catalog Wiring', () => {
  const agentLoopSource = loadFile('../../supabase/functions/_shared/agent-loop-v4.ts');

  it('imports loadCatalogs from catalog-loader', () => {
    expect(agentLoopSource).toContain('import { loadCatalogs } from "./catalog-loader.ts"');
  });

  it('calls loadCatalogs in the main Promise.all block alongside other loaders', () => {
    const allBlocks = [...agentLoopSource.matchAll(/Promise\.all\(\[([\s\S]*?)\]\)/g)];
    const mainBlock = allBlocks.find(m =>
      m[1].includes('loadGraphState') || m[1].includes('loadCatalogs')
    );
    expect(mainBlock).toBeTruthy();
    expect(mainBlock![1]).toContain('loadGraphState');
    expect(mainBlock![1]).toContain('loadLockedNodeIds');
    expect(mainBlock![1]).toContain('loadProjectContext');
    expect(mainBlock![1]).toContain('loadCatalogs');
  });

  it('destructures catalogs from Promise.all result', () => {
    expect(agentLoopSource).toContain('graph, lockedNodeIds, projectContext, catalogs');
  });

  it('passes catalogs into ToolContext construction', () => {
    const ctxBlock = agentLoopSource.match(/const ctx:\s*ToolContext\s*=\s*\{([\s\S]*?)\};/);
    expect(ctxBlock).toBeTruthy();
    expect(ctxBlock![1]).toContain('catalogs');
  });
});

describe('Database Catalog Data Integrity', () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const canConnect = !!(supabaseUrl && serviceRoleKey);

  it.skipIf(!canConnect)('node_roles table has entries with required fields', async () => {
    const supabase = createClient(supabaseUrl!, serviceRoleKey!);
    const { data, error } = await supabase
      .from('node_roles')
      .select('id, label, palette_category, is_container')
      .limit(5);

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBeGreaterThan(0);

    for (const row of data!) {
      expect(row.id).toBeTruthy();
      expect(row.label).toBeTruthy();
      expect(row.palette_category).toBeTruthy();
      expect(typeof row.is_container).toBe('boolean');
    }
  });

  it.skipIf(!canConnect)('technology_catalog has entries with ai_context populated', async () => {
    const supabase = createClient(supabaseUrl!, serviceRoleKey!);
    const { data, error } = await supabase
      .from('technology_catalog')
      .select('id, name, role_affinities, ai_context')
      .limit(5);

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBeGreaterThan(0);

    for (const row of data!) {
      expect(row.id).toBeTruthy();
      expect(row.name).toBeTruthy();
      expect(Array.isArray(row.role_affinities)).toBe(true);
      expect(row.ai_context).toBeTruthy();
      expect(typeof row.ai_context).toBe('object');
    }
  });

  it.skipIf(!canConnect)('deployment_targets has entries with compatible_roles', async () => {
    const supabase = createClient(supabaseUrl!, serviceRoleKey!);
    const { data, error } = await supabase
      .from('deployment_targets')
      .select('id, label, compatible_roles')
      .limit(5);

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBeGreaterThan(0);

    for (const row of data!) {
      expect(row.id).toBeTruthy();
      expect(row.label).toBeTruthy();
      expect(Array.isArray(row.compatible_roles)).toBe(true);
    }
  });

  it.skipIf(!canConnect)('every technology role_affinity references a valid node_role', async () => {
    const supabase = createClient(supabaseUrl!, serviceRoleKey!);

    const [rolesResult, techResult] = await Promise.all([
      supabase.from('node_roles').select('id'),
      supabase.from('technology_catalog').select('id, name, role_affinities'),
    ]);

    expect(rolesResult.error).toBeNull();
    expect(techResult.error).toBeNull();

    const validRoleIds = new Set(rolesResult.data!.map(r => r.id));
    const violations: string[] = [];

    for (const tech of techResult.data!) {
      for (const affinity of (tech.role_affinities as string[])) {
        if (!validRoleIds.has(affinity)) {
          violations.push(`${tech.name} (${tech.id}) references unknown role "${affinity}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it.skipIf(!canConnect)('container roles have container_style populated', async () => {
    const supabase = createClient(supabaseUrl!, serviceRoleKey!);
    const { data, error } = await supabase
      .from('node_roles')
      .select('id, label, is_container, container_style')
      .eq('is_container', true);

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBeGreaterThan(0);

    for (const row of data!) {
      expect(
        row.container_style === 'hosting' || row.container_style === 'logical-boundary'
      ).toBe(true);
    }
  });

  it.skipIf(!canConnect)('catalog counts match expected minimums', async () => {
    const supabase = createClient(supabaseUrl!, serviceRoleKey!);

    const [rolesResult, techResult, targetsResult] = await Promise.all([
      supabase.from('node_roles').select('id', { count: 'exact', head: true }),
      supabase.from('technology_catalog').select('id', { count: 'exact', head: true }),
      supabase.from('deployment_targets').select('id', { count: 'exact', head: true }),
    ]);

    expect(rolesResult.count).toBeGreaterThanOrEqual(40);
    expect(techResult.count).toBeGreaterThanOrEqual(50);
    expect(targetsResult.count).toBeGreaterThanOrEqual(10);
  });
});

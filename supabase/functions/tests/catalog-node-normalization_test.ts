// Fix (2026-07-15): IP-safe server-side normalization of externally-proposed node
// type/technology. The external AI proposes catalog-blind (e.g. type:"service",
// technology:"React"); this conforms it to the catalog deterministically. Unit tests against
// a fixture CatalogData (Deno tests have no DB).
import {
  normalizeProposedNode,
  genericRoleForCategory,
  GLOBAL_GENERIC_ROLE,
  PREFERRED_GENERIC_BY_CATEGORY,
} from '../_shared/catalog-node-normalization.ts';
import type { CatalogData, NodeRoleRow, TechnologyRow } from '../_shared/catalog-loader.ts';
import { assert, assertEquals } from './helpers.ts';

function role(id: string, palette_category: string, extra: Partial<NodeRoleRow> = {}): NodeRoleRow {
  return {
    id, label: id, description: '', icon_name: '', color: '', rf_visual_type: '',
    palette_category, nature: 'build', interface_kind: 'service', is_container: false, container_layer: null,
    container_style: null, can_contain: [], metadata_schema: {},
    suggested_contracts: [], sort_order: 0, capability_tags: [], default_technology: null,
    when_to_use: null, deprecated: false,
    ...extra,
  };
}
function tech(id: string, role_affinities: string[]): TechnologyRow {
  return {
    id, name: id, icon_url: null, brand_color: '', secondary_color: null, display_name: null,
    node_shape: null, role_affinities, ai_context: {}, suggested_files: [], default_metadata: {},
    metadata_schema: {}, common_connections: [], is_user_contributed: false, project_id: null,
    created_by: null,
  };
}

// Fixture: a handful of roles across categories + techs with role affinities.
const CATALOG: CatalogData = {
  nodeRoles: {
    'backend-service': role('backend-service', 'Services', { sort_order: 1 }),
    'websocket-server': role('websocket-server', 'Services', { sort_order: 5 }),
    'frontend-app': role('frontend-app', 'Frontend', { sort_order: 1 }),
    'spa': role('spa', 'Frontend', { sort_order: 3 }),
    'database': role('database', 'Database', { sort_order: 1 }),
    'region': role('region', 'Infrastructure', { is_container: true, sort_order: 1 }),
    'api-gateway': role('api-gateway', 'Infrastructure', { sort_order: 2 }),
  },
  technologies: {
    'react': tech('react', ['frontend-app']),
    'postgres': tech('postgres', ['database']),
    'express': tech('express', ['backend-service']),
  },
  deploymentTargets: {},
  legacyTypeMappings: {},
  cloudProviderPatterns: [],
  scopeArchetypes: {},
};

// ── normalizeProposedNode ─────────────────────────────────────────────────────────────

Deno.test('valid type + valid tech pass through unchanged (no notes)', () => {
  const r = normalizeProposedNode(CATALOG, 'backend-service', 'express');
  assertEquals(r.type, 'backend-service');
  assertEquals(r.technology, 'express');
  assertEquals(r.notes.length, 0);
});

Deno.test('the live bug: type "service" + tech "React" → frontend generic + "react"', () => {
  const r = normalizeProposedNode(CATALOG, 'service', 'React');
  // "service" is not a role; category inferred from react → frontend-app affinity → Frontend
  // → generic frontend role (lowest sort_order = frontend-app).
  assertEquals(r.type, 'frontend-app');
  assertEquals(r.technology, 'react'); // case-corrected
  assert(r.notes.some((n) => n.field === 'type'), 'records a type normalization');
  assert(r.notes.some((n) => n.field === 'technology'), 'records a tech correction');
});

Deno.test('unknown type + no technology → global generic role', () => {
  const r = normalizeProposedNode(CATALOG, 'thingamajig', undefined);
  assertEquals(r.type, GLOBAL_GENERIC_ROLE);
  assertEquals(r.technology, undefined);
});

Deno.test('unknown type + unknown tech → global generic + raw tech kept', () => {
  const r = normalizeProposedNode(CATALOG, 'whatsit', 'NovelFramework');
  // Unknown tech gives no affinity → category unknown → global generic.
  assertEquals(r.type, GLOBAL_GENERIC_ROLE);
  assertEquals(r.technology, 'NovelFramework'); // kept as-is, no placeholder
  assert(r.notes.some((n) => n.reason.includes('not in catalog')), 'notes the unknown tech');
});

Deno.test('category inferred from a known tech even when the type is junk', () => {
  const r = normalizeProposedNode(CATALOG, 'datastore', 'postgres');
  // postgres → database affinity → Database category → generic = database.
  assertEquals(r.type, 'database');
  assertEquals(r.technology, 'postgres');
});

Deno.test('empty/undefined type with a known tech still resolves via affinity', () => {
  const r = normalizeProposedNode(CATALOG, '', 'react');
  assertEquals(r.type, 'frontend-app');
});

Deno.test('technology case-correction alone (valid type)', () => {
  const r = normalizeProposedNode(CATALOG, 'database', 'Postgres');
  assertEquals(r.type, 'database');
  assertEquals(r.technology, 'postgres');
});

Deno.test('the "react" bug: type "react" alone → frontend-app + adopted react technology', () => {
  // The AI puts a technology name in the type slot with no separate technology. The tech's
  // OWN primary affinity role is used directly (frontend-app), NOT a category round-trip that
  // could mis-resolve (the bench bug produced ai-service). Technology is adopted from the type.
  const r = normalizeProposedNode(CATALOG, 'react', undefined);
  assertEquals(r.type, 'frontend-app');
  assertEquals(r.technology, 'react');
  assert(r.notes.some((n) => n.field === 'technology' && n.to === 'react'), 'adopts technology from type');
});

Deno.test('affinity role is used directly, never a category round-trip', () => {
  // Even though react is a Frontend tech, we do NOT go tech→category→generic; we use the
  // affinity role frontend-app itself. Guards against the shared-category mis-pick.
  const r = normalizeProposedNode(CATALOG, 'not-a-role', 'react');
  assertEquals(r.type, 'frontend-app');
});

Deno.test('affinity that is a container is skipped in favor of a non-container affinity', () => {
  // A tech affinity'd to [container-role, frontend-app] resolves to the non-container one.
  const catalog: CatalogData = {
    ...CATALOG,
    technologies: { ...CATALOG.technologies, 'weird': tech('weird', ['region', 'frontend-app']) },
  };
  const r = normalizeProposedNode(catalog, 'nonsense', 'weird');
  assertEquals(r.type, 'frontend-app'); // region (container) skipped
});

// ── genericRoleForCategory ────────────────────────────────────────────────────────────

Deno.test('genericRoleForCategory: preferred override wins when present', () => {
  // PREFERRED_GENERIC_BY_CATEGORY maps Services → backend-service, which is in the fixture.
  assertEquals(genericRoleForCategory(CATALOG, 'Services'), 'backend-service');
});

Deno.test('genericRoleForCategory: falls back to lowest-sort-order non-container role', () => {
  // Frontend has no preferred entry → lowest sort_order non-container = frontend-app.
  assertEquals(genericRoleForCategory(CATALOG, 'Frontend'), 'frontend-app');
  // Infrastructure: 'region' is a container (excluded) → api-gateway.
  assertEquals(genericRoleForCategory(CATALOG, 'Infrastructure'), 'api-gateway');
});

Deno.test('genericRoleForCategory: unknown category → undefined (caller uses global generic)', () => {
  assertEquals(genericRoleForCategory(CATALOG, 'NoSuchCategory'), undefined);
  assertEquals(genericRoleForCategory(CATALOG, undefined), undefined);
});

// ── coverage: every category present in the catalog resolves to a valid non-container role ──

Deno.test('coverage: every palette_category resolves to a real non-container role', () => {
  const categories = new Set(Object.values(CATALOG.nodeRoles).map((r) => r.palette_category));
  for (const cat of categories) {
    const generic = genericRoleForCategory(CATALOG, cat);
    // Infrastructure's only non-container role is api-gateway; all others have one too.
    assert(generic !== undefined, `category "${cat}" has a generic role`);
    const row = CATALOG.nodeRoles[generic!];
    assert(row && !row.is_container, `generic for "${cat}" (${generic}) is a real non-container role`);
  }
});

Deno.test('PREFERRED_GENERIC_BY_CATEGORY values are non-empty role-id strings', () => {
  for (const [cat, roleId] of Object.entries(PREFERRED_GENERIC_BY_CATEGORY)) {
    assert(typeof cat === 'string' && cat.length > 0, 'category key non-empty');
    assert(typeof roleId === 'string' && roleId.length > 0, `preferred role for ${cat} non-empty`);
  }
});


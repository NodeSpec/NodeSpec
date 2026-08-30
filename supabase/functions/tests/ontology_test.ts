// N1: the ontology derivation rules, pinned to the cross-runtime golden. The same fixture is
// asserted by vitest against core/src/ontology.ts — the Deno and browser mirrors cannot
// drift silently. The golden also encodes the canonical filings that motivated the model:
// Airflow self-hosted (build) vs platform-hosted (integrate), Supabase capability (integrate),
// Stripe (call regardless of placement).
import {
  treatmentForRole,
  paletteOwnershipDefault,
  deriveOwnership,
  effectiveTreatment,
} from '../_shared/ontology.ts';
import { loadCatalogs } from '../_shared/catalog-loader.ts';
import { FakeSupabase, assert, assertEquals, completeRole } from './helpers.ts';

const golden = JSON.parse(
  await Deno.readTextFile(new URL('./fixtures/ontology-golden.json', import.meta.url)),
);

Deno.test('treatment defaults match the golden (and the migration backfill rules)', () => {
  for (const c of golden.treatment) {
    assertEquals(treatmentForRole(c.in), c.out, JSON.stringify(c.in));
  }
});

Deno.test('palette-time ownership defaults match the golden', () => {
  for (const c of golden.paletteOwnership) {
    assertEquals(paletteOwnershipDefault(c.in), c.out, String(c.in));
  }
});

Deno.test('derived ownership: the counterexamples that killed a stored column', () => {
  for (const c of golden.ownership) {
    assertEquals(deriveOwnership(c.node, c.ctx), c.out, c.name);
  }
});

Deno.test('effective treatment: a boundary-engine technology raises a leaf role (N2.2)', () => {
  for (const c of golden.effectiveTreatment) {
    assertEquals(effectiveTreatment(c.role, c.tech), c.out, c.name);
  }
});

Deno.test('catalog loader carries the new axes through to CatalogData', async () => {
  const sb = new FakeSupabase();
  sb.script('node_roles', 'select', {
    data: [completeRole({ id: 'workflow-thing', nature: 'engine', interface_kind: 'service', kind: 'automation_pipeline', is_container: false, altitude: 'service', treatment_mode: 'boundary', sort_order: 1 })],
    error: null,
  });
  for (const t of ['technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  const catalogs = await loadCatalogs(sb as never);
  assertEquals(catalogs.nodeRoles['workflow-thing'].nature, 'engine');
  assertEquals(catalogs.nodeRoles['workflow-thing'].interface_kind, 'service');
  const sel = sb.callsTo('node_roles', 'select')[0];
  assert(String(sel.payload).includes('nature') && String(sel.payload).includes('interface_kind'),
    'select list requests the M1b axes (explicit-list loader must be taught)');
});

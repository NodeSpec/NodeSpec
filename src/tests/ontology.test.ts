// N1: core mirror of the ontology derivation rules, asserted against the SAME golden fixture
// as the Deno suite (supabase/functions/tests/ontology_test.ts) — the two implementations
// cannot drift silently.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  treatmentForRole,
  paletteOwnershipDefault,
  deriveOwnership,
  effectiveTreatment,
} from '@nodespec/core/ontology.js';

const golden = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../supabase/functions/tests/fixtures/ontology-golden.json'),
    'utf-8',
  ),
);

describe('ontology derivation (core mirror, golden-pinned)', () => {
  it('treatment defaults', () => {
    for (const c of golden.treatment) {
      expect(treatmentForRole(c.in), JSON.stringify(c.in)).toBe(c.out);
    }
  });

  it('palette ownership defaults', () => {
    for (const c of golden.paletteOwnership) {
      expect(paletteOwnershipDefault(c.in), String(c.in)).toBe(c.out);
    }
  });

  it('derived ownership — Airflow/Supabase/Stripe counterexamples', () => {
    for (const c of golden.ownership) {
      expect(deriveOwnership(c.node, c.ctx), c.name).toBe(c.out);
    }
  });

  it('effective treatment — boundary-engine tech raises a leaf role (N2.2)', () => {
    for (const c of golden.effectiveTreatment) {
      expect(effectiveTreatment(c.role, c.tech), c.name).toBe(c.out);
    }
  });
});

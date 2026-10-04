import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  groupConstraints,
  constraintIdentity,
  CTYPE_ORDER,
  type ConstraintRow,
} from '../ui/components/ideation/useConstraints.js';

// V3 P4 (task 4.4): the constraints rail. Pins: grouping follows the
// CANONICAL 8-value ctype order (R2 — the design draws four, stored data
// uses all eight, data wins) with unknown ctypes folding into 'other';
// the app-lane identity is deterministic per (ctype, description) so the
// same constraint written twice trips UNIQUE(project_id, source_hash)
// instead of duplicating — and it can never collide with the v3f
// backfill's md5 family.

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

const row = (id: string, ctype: string, description: string): ConstraintRow =>
  ({ id, ctype, description, title: null, rationale: null, author: null, workflow_id: null });

describe('groupConstraints', () => {
  it('canonical order, only non-empty groups, unknown ctypes fold into other', () => {
    const groups = groupConstraints([
      row('1', 'cost', 'Stay under $50/mo'),
      row('2', 'technology', 'Postgres only'),
      row('3', 'vibes', 'Junk ctype from a dirty row'),
      row('4', 'technology', 'TypeScript everywhere'),
    ]);
    expect(groups.map((g) => g.ctype)).toEqual(['technology', 'cost', 'other']);
    expect(groups[0].rows.map((r) => r.description)).toEqual(['Postgres only', 'TypeScript everywhere']);
    expect(groups[2].rows[0].description).toBe('Junk ctype from a dirty row');
  });

  it('the vocabulary is the canonical eight', () => {
    expect([...CTYPE_ORDER]).toEqual([
      'technology', 'architecture', 'deployment', 'performance',
      'security', 'compliance', 'cost', 'other',
    ]);
  });
});

describe('constraintIdentity: deterministic, trim-stable, family-prefixed', () => {
  it('same (ctype, description) → same hash; whitespace never mints a new identity', async () => {
    const a = await constraintIdentity('technology', 'Postgres only');
    const b = await constraintIdentity('technology', '  Postgres only  ');
    const c = await constraintIdentity('cost', 'Postgres only');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^app-sha256:[0-9a-f]{64}$/);
  });
});

describe('wiring pins — the CONSTRAINTS band (Workflow Space)', () => {
  it('AC: constraints are filed and removed in the Workflows space only, and read only on Indie and above', () => {
    // AC (owner 2026-09-24): no constraint CRUD in the Requirements view, on any plan
    const list = src('ui/components/work/RequirementsList.tsx');
    expect(list).not.toContain('data-testid="work-constraint"');
    expect(list).not.toContain('data-testid="work-add-constraint"');
    expect(list).not.toContain('constraints.add(');
    expect(list).not.toContain('constraints.remove(');
    const space = src('ui/components/work/workflows/WorkflowsSpace.tsx');
    expect(space).toContain('constraintsApi.add(');
    expect(space).toContain('constraintsApi.remove(id)');
    expect(src('ui/components/work/WorkSurface.tsx')).toContain('useConstraints(canWorkflows ? projectId : null)');
  });

  it('the duplicate refusal and identity survive the re-layout', () => {
    const hook = src('ui/components/ideation/useConstraints.ts');
    expect(hook).toContain('That constraint is already recorded.');
    expect(hook).toContain('source_hash');
    expect(hook).toContain('workflow_id: workflowId ?? null');
  });
});

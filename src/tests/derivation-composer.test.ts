import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promotionGate } from '../ui/components/ideation/useCandidateActions.js';
import { assembleDerivations } from '../ui/components/ideation/useOutcomes.js';
import { fnv1a32, criterionIdOf, identifyCriteria, identifiedFromRow } from '../ui/components/ideation/criterion-identity.js';

// V3 4b.2 (R5): the derivation composer, app side. Pins: the app's
// criterion identity is byte-identical to the server's; the gate works per
// SLICE (claimed criteria refuse by REQ, an exhausted outcome points at
// settle, an empty selection asks for one); derivations assemble into the
// claimed map; the inspector renders the composer (checkbox rows, claimed
// chips, its own name, Derived requirements (N), settle two-step) and the
// pool chip counts REQS; the app settle mirrors the server's.

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

describe('criterion identity: the app mirrors the server byte for byte', () => {
  it('the pure section is identical in both files', () => {
    const app = read('src/ui/components/ideation/criterion-identity.ts');
    const deno = read('supabase/functions/_shared/criterion-identity.ts');
    const pure = (s: string) => s.slice(s.indexOf('export interface IdentifiedCriterion'));
    expect(pure(app)).toBe(pure(deno));
  });

  it('resolves the same ids the server resolves', () => {
    expect(fnv1a32('Export completes under 60s')).toMatch(/^[0-9a-f]{8}$/);
    expect(criterionIdOf({ text: ' Export   completes under 60s ' })).toBe(`h${fnv1a32('Export completes under 60s')}`);
    expect(criterionIdOf({ id: 'c1', text: 'x' })).toBe('c1');
    const saved = identifyCriteria([{ text: 'legacy' }, 'new one'], [{ text: 'legacy' }]);
    expect(saved[0].id).toBe(`h${fnv1a32('legacy')}`);
    expect(saved[1].id).toMatch(/^[0-9a-f]{8}$/);
    expect(identifiedFromRow([{ id: 'a', text: 'A' }, { text: '' }]).map((c) => c.id)).toEqual(['a']);
  });
});

describe('promotionGate: per slice', () => {
  const outcome = { name: 'Tenants export their data', status: 'pending', criteria: [{ id: 'c1', text: 'A' }, { id: 'c2', text: 'B' }, { id: 'c3', text: 'C' }] };

  it('default slice is every unclaimed criterion', () => {
    const gate = promotionGate(outcome, { claimed: { c1: 'REQ-004' } });
    expect(gate.allowed).toBe(true);
    expect(gate.slice!.map((c) => c.id)).toEqual(['c2', 'c3']);
  });

  it('a selection narrows the slice; a claimed id in it refuses naming the REQ', () => {
    expect(promotionGate(outcome, { claimed: { c1: 'REQ-004' }, selectedIds: ['c3'] }).slice!.map((c) => c.id)).toEqual(['c3']);
    const clash = promotionGate(outcome, { claimed: { c1: 'REQ-004' }, selectedIds: ['c1', 'c2'] });
    expect(clash.allowed).toBe(false);
    expect(clash.reason).toContain('"A" is already derived into REQ-004');
  });

  it('an exhausted outcome points at settle; an empty selection asks for one; no criteria keeps the shared sentence', () => {
    const exhausted = promotionGate(outcome, { claimed: { c1: 'REQ-004', c2: 'REQ-005', c3: 'REQ-005' } });
    expect(exhausted.allowed).toBe(false);
    expect(exhausted.reason).toContain('already derived (REQ-004, REQ-005)');
    expect(exhausted.reason).toContain('settle the outcome');
    const none = promotionGate(outcome, { claimed: {}, selectedIds: [] });
    expect(none.reason).toContain('Select at least one unclaimed criterion');
    expect(promotionGate({ ...outcome, criteria: [] }).reason).toContain('has no testable outcome');
  });

  it('legacy criteria (no ids) claim by text hash, so a backfilled derivation still holds them', () => {
    const legacy = { name: 'x', status: 'pending', criteria: [{ text: 'A' }, { text: 'B' }] };
    const gate = promotionGate(legacy, { claimed: { [`h${fnv1a32('A')}`]: 'REQ-001' } });
    expect(gate.slice!.map((c) => c.text)).toEqual(['B']);
  });
});

describe('assembleDerivations: the claimed map', () => {
  it('groups per candidate oldest-first, resolves REQ refs, claims by id (hash for legacy slices)', () => {
    const refs = new Map([['r1', 'REQ-004'], ['r2', 'REQ-005']]);
    const out = assembleDerivations([
      { id: 'd2', candidate_id: 'o1', requirement_row_id: 'r2', criteria_slice: [{ id: 'c2', text: 'B' }], proposed_by_kind: 'agent', created_at: '2026-09-14T02:00:00Z' },
      { id: 'd1', candidate_id: 'o1', requirement_row_id: 'r1', criteria_slice: [{ text: 'A' }], proposed_by_kind: 'human', created_at: '2026-09-14T01:00:00Z' },
      { id: 'd3', candidate_id: 'o2', requirement_row_id: 'gone', criteria_slice: [], proposed_by_kind: 'human', created_at: '2026-09-14T03:00:00Z' },
    ], refs);
    const o1 = out.get('o1')!;
    expect(o1.derivations.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(o1.derivations[0].reqRef).toBe('REQ-004');
    expect(o1.claimed).toEqual({ [`h${fnv1a32('A')}`]: 'REQ-004', c2: 'REQ-005' });
    expect(out.get('o2')!.derivations[0].reqRef).toBeNull();
  });
});

describe('the rail derives, the model counts REQS (V3 4.1: one act, every unclaimed criterion)', () => {
  const rail = read('src/ui/components/work/ItemRail.tsx');
  const hook = read('src/ui/components/ideation/useOutcomes.ts');
  const actions = read('src/ui/components/ideation/useCandidateActions.ts');

  it('claimed chips on the criteria, the gate before the write, a promote over what is unclaimed', () => {
    expect(rail).toContain('data-testid="claimed-chip"');
    expect(rail).toContain('const gate = promotionGate(outcome, { claimed: outcome.claimed });');
    expect(rail).toContain("if (!gate.allowed) { setNote(gate.reason ?? null); return; } void run(() => candidateActions.promote(outcome)); }");
    // the outcome stays selected after a derivation — it is still a source
    expect(rail).not.toContain("candidateActions.promote(outcome), () => onSelect({ kind: 'lane' })");
    // a partial derivation says what is left
    expect(rail).toContain('{unclaimed.length} still unclaimed.');
  });

  it('a derived outcome shows its requirements as rows; the model keeps the outcome while criteria are unclaimed', () => {
    const model = read('src/ui/components/work/steps-model.ts');
    expect(model).toContain('for (const d of o.derivations) {');
    expect(model).toContain('const unclaimed = all.filter((c) => !o.claimed[c.id]);');
    expect(model).toContain('if (!o.settled && (!derivedSomething || unclaimed.length > 0)) {');
  });

  it('settle is a two-step act that names terminality and needs a derivation', () => {
    expect(rail).toContain('data-testid="work-act-settle"');
    expect(rail).toContain('Settle it as fully covered? It derives no further.');
    expect(rail).toContain('derived > 0 ? (');
    expect(actions).toContain('has derived nothing yet');
    expect(actions).toContain(".update({ status: 'accepted', decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })");
    // the server's settle shares both sentences
    const server = read('supabase/functions/mcp-server/tools/spec-patch-apply.ts');
    expect(server).toContain('has derived nothing yet');
  });

  it('useOutcomes reads derivations in one batch and writes criterion ids', () => {
    expect(hook).toContain("from('outcome_derivations')");
    expect(hook).toMatch(/\.in\('candidate_id', rows\.map\(\(c\) => c\.id\)\)/);
    expect(hook).toContain('identifyCriteria(criteria, Array.isArray(current?.criteria)');
    expect(hook).toContain("settled: c.status === 'accepted'");
    expect(hook).toContain('promoted: !!c.requirement_row_id || d.derivations.length > 0');
  });

  it('the trace tone reads "derived at least once" from the frozen first link', () => {
    expect(read('src/ui/components/ideation/useTierItems.ts')).toContain('const promoted = !!cand.requirement_row_id;');
  });
});

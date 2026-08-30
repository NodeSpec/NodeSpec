// Owner bug 2026-08-23: phase_status told a well-progressed project it was
// still "drafting_requirements" — the wizard column is written only by the
// app's spec flow, never by the MCP/git lanes that actually progress a
// project. deriveProjectPhase reads the phase from live facts, keeping the
// stored value only as a never-demote floor and as plausibility-gated
// intent/transient markers.
import { deriveProjectPhase, phaseAtLeast } from '../_shared/project-phase.ts';
import { assertEquals } from './helpers.ts';

Deno.test('THE bug: stale drafting_requirements + real progress derives forward', () => {
  // Architecture on the canvas → past drafting.
  assertEquals(
    deriveProjectPhase({ stored: 'drafting_requirements', reqCount: 8, archNodeCount: 12, testCount: 0 }),
    'architecture_confirmed',
  );
  // Reported test evidence → the build/verify loop is underway.
  assertEquals(
    deriveProjectPhase({ stored: 'drafting_requirements', reqCount: 8, archNodeCount: 12, testCount: 20 }),
    'generating_code',
  );
});

Deno.test('a genuinely early project still reads drafting_requirements', () => {
  assertEquals(deriveProjectPhase({ stored: 'drafting_requirements', reqCount: 0, archNodeCount: 0, testCount: 0 }), 'drafting_requirements');
  assertEquals(deriveProjectPhase({ stored: null, reqCount: 3, archNodeCount: 0, testCount: 0 }), 'drafting_requirements');
});

Deno.test('the stored value is a FLOOR — derivation never demotes an explicit confirmation', () => {
  // Confirmed in the app, architecture not landed yet.
  assertEquals(deriveProjectPhase({ stored: 'requirements_confirmed', reqCount: 5, archNodeCount: 0, testCount: 0 }), 'requirements_confirmed');
  // generating_code stored; nodes deleted / tests reset — never walked back.
  assertEquals(deriveProjectPhase({ stored: 'generating_code', reqCount: 5, archNodeCount: 3, testCount: 0 }), 'generating_code');
  assertEquals(deriveProjectPhase({ stored: 'architecture_confirmed', reqCount: 5, archNodeCount: 0, testCount: 0 }), 'architecture_confirmed');
});

Deno.test('intent/transient markers hold only while plausible', () => {
  // architecture_first sticks until requirements exist (the backfill), then
  // the normal ladder applies.
  assertEquals(deriveProjectPhase({ stored: 'architecture_first', reqCount: 0, archNodeCount: 6, testCount: 0 }), 'architecture_first');
  assertEquals(deriveProjectPhase({ stored: 'architecture_first', reqCount: 4, archNodeCount: 6, testCount: 0 }), 'architecture_confirmed');
  assertEquals(deriveProjectPhase({ stored: 'architecture_first', reqCount: 4, archNodeCount: 6, testCount: 9 }), 'generating_code');
  // building_architecture sticks until nodes land.
  assertEquals(deriveProjectPhase({ stored: 'building_architecture', reqCount: 4, archNodeCount: 0, testCount: 0 }), 'building_architecture');
  assertEquals(deriveProjectPhase({ stored: 'building_architecture', reqCount: 4, archNodeCount: 2, testCount: 0 }), 'architecture_confirmed');
  // An implausible marker contributes NO floor — facts alone decide.
  assertEquals(deriveProjectPhase({ stored: 'building_architecture', reqCount: 4, archNodeCount: 0, testCount: 0 }), 'building_architecture');
});

Deno.test('unknown or absent stored values are treated as drafting, never crash', () => {
  assertEquals(deriveProjectPhase({ stored: 'weird_legacy_value', reqCount: 0, archNodeCount: 0, testCount: 0 }), 'drafting_requirements');
  assertEquals(deriveProjectPhase({ stored: undefined, reqCount: 0, archNodeCount: 4, testCount: 1 }), 'generating_code');
});

Deno.test('phaseAtLeast floors stale values and passes higher ones through', () => {
  assertEquals(phaseAtLeast('drafting_requirements', 'architecture_confirmed'), 'architecture_confirmed');
  assertEquals(phaseAtLeast('generating_code', 'architecture_confirmed'), 'generating_code');
  assertEquals(phaseAtLeast('architecture_first', 'architecture_confirmed'), 'architecture_first');
  assertEquals(phaseAtLeast(null, 'architecture_confirmed'), 'architecture_confirmed');
  assertEquals(phaseAtLeast('nonsense', 'architecture_confirmed'), 'architecture_confirmed');
});

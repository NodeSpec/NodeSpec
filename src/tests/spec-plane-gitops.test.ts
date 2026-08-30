// R7a/R7b (client half) — owner 2026-07-31: "upon connecting to git, if a
// model.json is detected, our tool renders the nodes correctly after a proposal is
// generated. However, requirements/acceptance criteria and spec are not imported
// at all."
//
// The server halves (spec anchor format, adopt ratchet, no-second-writer rule)
// are pinned in supabase/functions/tests/spec-anchor_test.ts. These hold the
// client contract: both planes report separately, and neither outcome is
// something the user has to infer from an absence.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');

describe('connect reports the spec plane separately from the architecture', () => {
  it('saveIntegration folds specAdopt onto the result', () => {
    const source = read('ui/services/GitService.ts');
    expect(source).toContain('specAdopt?: SpecAdoptResult');
    expect(source).toContain('spec: result.specAdopt ?? { detected: false }');
    expect(source).toContain('export interface SpecAdoptResult');
  });

  it('the connect message names what came in — requirements, criteria and mappings', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('Requirements imported:');
    expect(source).toContain('acceptance criteria');
    expect(source).toContain('node mapping(s)');
  });

  it('"detected but not imported" and "repo has none" are DIFFERENT messages', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    // The owner's report was exactly this failure mode: nodes arrived, the Spec
    // view was empty, and nothing said why.
    expect(source).toContain('Requirements NOT imported:');
    expect(source).toContain('This repo carries no requirements file');
  });

  it('the spec note rides EVERY connect outcome, not just the restore-proposal one', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    const occurrences = source.split('${specNote}').length - 1;
    // restore-proposal, mismatch-card, skipped-with-reason, and the spec-only case
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });
});

describe('push reports whether the spec plane travelled', () => {
  it('PushResult carries specAnchored', () => {
    const source = read('ui/services/GitService.ts');
    expect(source).toContain('specAnchored?: boolean');
  });

  it('the commit toast says so — no spec is distinguishable from a failed export', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('result.specAnchored');
    expect(source).toContain('Requirements and acceptance criteria included.');
  });
});

// ── R7c: the spec drift lane (client half) ───────────────────────────────────

describe('R7c: the card offers a requirements load, independent of the model load', () => {
  it('GitService exposes restore-spec as its own git-pull mode', () => {
    const source = read('ui/services/GitService.ts');
    expect(source).toContain("mode: 'restore-spec'");
    expect(source).toContain('async restoreSpec(');
    // Separate call from restoreModel — taking the repo's requirements must not
    // force a canvas replacement.
    expect(source).toContain("mode: 'restore-model'");
  });

  it('the card surfaces specChanged and its diff', () => {
    const service = read('ui/services/GitService.ts');
    expect(service).toContain('specChanged?: boolean');
    expect(service).toContain('specDiff?: CappedSpecDiff');
    expect(service).toContain('specChanged: e.metadata?.specChanged === true');
    expect(service).toContain('specDiff: e.metadata?.specDiff');
  });

  it('the load button is gated on specChanged and is NOT the model button', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('onRestoreSpec && change.specChanged');
    expect(source).toContain('Load requirements from repo');
    expect(source).toContain('Load repo model onto canvas');
  });

  it('the diff readout states the evidence rule and the no-delete rule', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('Criteria you have already met keep their evidence');
    expect(source).toContain('Requirements the repo does not have are kept, never deleted');
  });

  it('the result message reports how much evidence survived', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('met criterion(s) kept their evidence');
    expect(source).toContain('were KEPT, not deleted');
  });

  it('the Repository panel carries the card-independent spec loader too', () => {
    const source = read('ui/components/panels/ChangesPanel.tsx');
    expect(source).toContain('Load requirements from repo');
    expect(source).toContain('gitService.restoreSpec(integration.id');
    expect(source).toContain('are kept, not deleted');
  });
});

// ── R5a-c: completion provenance (client half) ───────────────────────────────

describe('R5c: a git tick becomes evidence only through an approval', () => {
  it('the card surfaces the deltas and the already-applied marker', () => {
    const service = read('ui/services/GitService.ts');
    expect(service).toContain('criterionDeltas?: CriterionDeltaPayload');
    expect(service).toContain('criteriaApplied?: { at: string; count: number }');
    expect(service).toContain("mode: 'apply-criteria'");
  });

  it('the block lists the ticked criteria with their REQ ids', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('Acceptance criteria ticked in this commit:');
    expect(source).toContain('Mark these criteria met');
  });

  it('the UI states both refusals out loud', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    // Unticks are never applied…
    expect(source).toContain('must not retract evidence a test proved');
    // …and unrecognized lines are flagged, not guessed.
    expect(source).toContain('flagged, never guessed');
  });

  it('an already-applied card shows the result instead of the button', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('change.criteriaApplied ?');
    expect(source).toContain('criterion(s) marked met');
  });
});

// ── R3-6: second-project branch safety (client half) ─────────────────────────

describe('R3-6: connect names the design branches it materialized', () => {
  it('the service folds branchDetect onto the connect result', () => {
    const service = read('ui/services/GitService.ts');
    expect(service).toContain('branchDetect?: BranchDetectResult');
    expect(service).toContain('...(result.branchDetect ? { branchDetect: result.branchDetect } : {})');
  });

  it('the connect message lists them by name', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    expect(source).toContain('Detected ${bd.created.length} design branch(es) from the repository');
    expect(source).toContain('they are in the Branches menu with their models loaded');
  });

  it('the branch note rides the connect outcomes, NOT the commit toast', () => {
    const source = read('ui/components/panels/GitIntegrationModal.tsx');
    const occurrences = source.split('${branchNote}').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
    // The commit toast is a different handler with no branch detection in scope.
    expect(source).toContain('.${deleted}${specNote}`');
  });
});

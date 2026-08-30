// B2 (docs/WORK_LOOP_PLAN.md) · auto-sync eligibility — the gate that decides
// whether a pending change card may be accepted WITHOUT a human click.
//
// Doctrine: auto-sync exists for exactly one case — an out-of-band commit
// that edits nothing but already-bound, unlocked, user-owned files. That case
// has no question in it: the binding was approved when the file was bound,
// and a content edit to a bound file is evidence of work, not a design
// decision. EVERYTHING that carries a question keeps its card:
//
//  · deletions and moves (structural — "is this file really gone?")
//  · residue (unattributed files need a human/AI to classify)
//  · model.json / spec.json changes (which side wins is the drift question)
//  · checkbox ticks (criterion/task evidence REQUIRES approval — R5 doctrine;
//    auto-resolving the card would strand the ticks unapplied)
//  · locked (complete) artifacts (the lock is the user's explicit freeze)
//  · generator-owned docs (task/test-plan artifacts are NodeSpec's to write;
//    hand-edits to them deserve eyes)
//  · cards for other branches (the accept lane writes into the OPEN canvas)
//  · anything with a match error or unusual provenance
//
// Pure function: decisions are unit-tested as a matrix, and every refusal is
// named so the modal can explain why a card was left for the human.

import type { GitChangeEvent } from '../services/GitService.js';

/** Generator-owned artifact kinds — hand-edits to these always card. */
const GENERATOR_OWNED_KINDS = new Set(['task', 'test-plan']);

/** Card sources eligible for auto-sync: plain webhook (undefined) or sweep. */
const ELIGIBLE_SOURCES = new Set([undefined, 'sweep']);

export interface AutoSyncArtifactView {
  status?: string;
  kind?: string;
}

export interface AutoSyncDecision {
  eligible: boolean;
  /** Named refusal (stable strings — tested and shown in the modal). */
  reason:
    | 'eligible'
    | 'not-pending'
    | 'ineligible-source'
    | 'other-branch'
    | 'model-changed'
    | 'spec-changed'
    | 'unhandled-residue'
    | 'match-error'
    | 'carries-ticks'
    | 'has-deletions-or-moves'
    | 'unmatched-files'
    | 'no-matches'
    | 'locked-artifact'
    | 'generator-owned-doc'
    | 'unknown-artifact';
}

export function isAutoSyncEligible(
  change: GitChangeEvent,
  currentBranchName: string,
  artifactsById: Record<string, AutoSyncArtifactView | undefined>,
): AutoSyncDecision {
  if (change.status !== 'pending') return { eligible: false, reason: 'not-pending' };
  if (!ELIGIBLE_SOURCES.has(change.source)) return { eligible: false, reason: 'ineligible-source' };
  // The accept lane patches the OPEN canvas; a card for another branch waits
  // until that branch is open (or a human/AI resolves it explicitly).
  if ((change.branchName ?? 'main') !== currentBranchName) {
    return { eligible: false, reason: 'other-branch' };
  }
  if (change.modelChanged) return { eligible: false, reason: 'model-changed' };
  if (change.specChanged) return { eligible: false, reason: 'spec-changed' };
  if (change.matchError) return { eligible: false, reason: 'match-error' };

  // B3: a residue path covered by a fully-RESOLVED declaration is answered —
  // the AI already said which node owns it, and the driver binds it. Flagged
  // declarations (unknown/ambiguous node, bad kind) cover nothing: their
  // paths stay residue and the card stays for a human/AI.
  const declaredBindPaths = new Set(
    (change.bindingResolution?.bind ?? []).map((b) => b.path),
  );

  const ignored = new Set(change.ignoredResidue ?? []);
  const unhandledResidue = (change.residuePaths ?? []).filter(
    (p) => !ignored.has(p) && !declaredBindPaths.has(p),
  );
  if (unhandledResidue.length > 0) return { eligible: false, reason: 'unhandled-residue' };

  // Evidence requires approval: a card carrying criterion or task deltas must
  // stay pending so the tick-apply lanes (UI button / resolve_change
  // apply_ticks) can run — auto-resolving would strand the ticks.
  if (change.criterionDeltas && (change.criterionDeltas.deltas?.length ?? 0) > 0) {
    return { eligible: false, reason: 'carries-ticks' };
  }
  if (change.taskDeltas && (change.taskDeltas.deltas?.length ?? 0) > 0) {
    return { eligible: false, reason: 'carries-ticks' };
  }

  const files = change.changedFiles ?? [];
  if (files.some((f) => f.action === 'removed')) {
    return { eligible: false, reason: 'has-deletions-or-moves' };
  }

  const matches = change.artifactMatches ?? [];
  // A bindings-only push (new declared files + the declaration file itself)
  // has zero matches and is still the exact case B3 exists for.
  if (matches.length === 0 && declaredBindPaths.size === 0) {
    return { eligible: false, reason: 'no-matches' };
  }
  if (matches.some((m) => m.movedFrom)) {
    return { eligible: false, reason: 'has-deletions-or-moves' };
  }

  // EVERY changed file must be either bound or covered by a resolved
  // declaration — one unmatched file means the push contains something nobody
  // classified, and the whole card keeps its question. (Residue normally
  // catches these; this guard also covers paths residue exempts, like
  // ARCHITECTURE.md.)
  const matchedPaths = new Set(matches.map((m) => m.path));
  const unmatched = files.filter(
    (f) => !matchedPaths.has(f.path) && !declaredBindPaths.has(f.path) && !f.path.startsWith('.nodespec/'),
  );
  if (unmatched.length > 0) return { eligible: false, reason: 'unmatched-files' };

  for (const match of matches) {
    const artifact = artifactsById[match.artifactId];
    if (!artifact) return { eligible: false, reason: 'unknown-artifact' };
    if (artifact.status === 'complete') return { eligible: false, reason: 'locked-artifact' };
    const kind = artifact.kind ?? match.kind;
    if (kind && GENERATOR_OWNED_KINDS.has(kind)) {
      return { eligible: false, reason: 'generator-owned-doc' };
    }
  }

  return { eligible: true, reason: 'eligible' };
}

// Owner bug 2026-08-23: get_project_status told a well-progressed project it
// was still "drafting_requirements". Root cause: project_specifications.
// phase_status is a wizard-era column that only the APP's spec flow ever
// advances (requirements_confirmed on the confirm button, architecture_first
// on the skip-spec path, transient states from the import/convert agent) —
// the MCP and git lanes that actually progress a project never write it, so
// on any asynchronously-driven project the stored value is a snapshot of
// whichever surface touched it last, i.e. usually the day it was created.
//
// Doctrine (same as deriveWorkStatus, coupling, and the board projections):
// STORED STATE THAT MULTIPLE ASYNC WRITERS WOULD HAVE TO MAINTAIN IS DERIVED
// AT READ TIME INSTEAD. The stored column survives only as:
//   · a FLOOR — an explicit confirmation is never demoted by derivation
//     (deleting nodes doesn't un-confirm a decision a human made);
//   · an intent/transient marker while it is still PLAUSIBLE —
//     architecture_first holds only until requirements exist (after the
//     backfill the normal ladder applies), building_architecture holds only
//     until nodes actually land.
// Live facts then set the ladder: architecture on the canvas means the
// project is past drafting; reported test evidence means the verification
// loop is underway.

export type ProjectPhase =
  | 'drafting_requirements'
  | 'requirements_confirmed'
  | 'building_architecture'
  | 'architecture_confirmed'
  | 'generating_code'
  | 'architecture_first';

const PHASE_RANK: Record<ProjectPhase, number> = {
  drafting_requirements: 0,
  requirements_confirmed: 1,
  building_architecture: 2,
  architecture_confirmed: 3,
  architecture_first: 3, // the parallel entry point at the architecture level
  generating_code: 4,
};

function knownPhase(stored: string | null | undefined): ProjectPhase {
  return stored && stored in PHASE_RANK ? (stored as ProjectPhase) : 'drafting_requirements';
}

/** The stored phase, floored at `floor` — for surfaces whose CALL is itself
 *  evidence (a resolved architecture-plane target means the project is past
 *  drafting, whatever the wizard column says). */
export function phaseAtLeast(stored: string | null | undefined, floor: ProjectPhase): ProjectPhase {
  const s = knownPhase(stored);
  return PHASE_RANK[s] >= PHASE_RANK[floor] ? s : floor;
}

export function deriveProjectPhase(args: {
  stored: string | null | undefined;
  reqCount: number;
  archNodeCount: number;
  testCount: number;
}): ProjectPhase {
  const stored = knownPhase(args.stored);

  // Intent/transient markers hold only while still plausible.
  if (stored === 'architecture_first' && args.reqCount === 0) return 'architecture_first';
  if (stored === 'building_architecture' && args.archNodeCount === 0) return 'building_architecture';

  // The live ladder: canvas architecture beats "drafting", test evidence
  // means the build/verify loop is underway.
  const live: ProjectPhase = args.archNodeCount > 0
    ? (args.testCount > 0 ? 'generating_code' : 'architecture_confirmed')
    : 'drafting_requirements';

  // A no-longer-plausible marker contributes no floor; every other stored
  // value is a floor the derivation never demotes below.
  const base: ProjectPhase =
    stored === 'architecture_first' || stored === 'building_architecture'
      ? 'drafting_requirements'
      : stored;
  return PHASE_RANK[live] >= PHASE_RANK[base] ? live : base;
}

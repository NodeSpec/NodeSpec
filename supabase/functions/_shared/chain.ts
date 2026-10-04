// AA.1 (owner 2026-09-23): the chain, by plan.
//
// "The only thing that makes these optional is the tiering of the user's
// plan." Where the plan carries a link, a missing link is a readiness gap:
//
//   vision       every plan: the project has one, and outcomes cite it
//   off-vision   every plan: an outcome cites no sentence of the current vision
//   origin       every plan: a requirement derives from no outcome
//   no-step      Workflows plans (Indie and above): an outcome sits on no step
//   unserved     advisory: a vision sentence no outcome serves
//
// Constraints are never a gap (owner ruling 2026-09-23): none recorded, or
// one that reaches no node, is a note.
//
// Readiness reports the chain; nothing else waits on it. Task documents,
// test plans, the queue, checkouts and test reports stay open, so an agent
// is never deadlocked while it closes a gap.
//
// Which candidates are outcomes here: every `kind: 'outcome'` row, and an
// import-born candidate (api, data, behavior) once it has derived a
// requirement. Until then an import-born row is evidence the import found,
// counted by the "candidates open" advisory, not a link of the chain.
//
// Pure: the reads live with the caller (get_build_readiness).
import { resolveServes, visionSentences, type VisionSentence } from "./vision-sentences.ts";

export type ChainGapKind = "vision" | "off-vision" | "origin" | "no-step" | "unserved";

/** One thing a gap names. `mark` rides along so the MCP boundary withholds what the caller is not cleared for. */
export interface ChainItem { id: string; label: string; mark?: string | null; was?: string }

export interface ChainGap { kind: ChainGapKind; detail: string; items?: ChainItem[]; more?: number }

export interface ChainOutcome {
  id: string;
  key: string;
  name: string;
  kind: string;
  /** pending or accepted (settled); dismissed rows are not read. */
  status: string;
  mark: string | null;
  serves: VisionSentence[];
  /** Requirements it derived (outcome_derivations rows). */
  derived: number;
  /** On a workflow step (outcome_step_maps). Read only on plans with Workflows. */
  onStep: boolean;
}

export interface ChainRequirement { requirementId: string; name: string; mark: string | null; hasOrigin: boolean }

export interface ChainReport {
  ready: boolean;
  counts: {
    visionSentences: number;
    sentencesServed: number;
    outcomes: number;
    outcomesCitingVision: number;
    requirements: number;
    requirementsWithOrigin: number;
  };
  blockers: ChainGap[];
  advisories: ChainGap[];
  notes: string[];
}

/** Items a gap lists before it counts the rest. */
export const CHAIN_ITEM_CAP = 25;

export const NO_CONSTRAINTS_NOTE =
  "No constraints are recorded. Standing conditions the build must honour (security, compliance, cost, technology and the like) can be filed with a create_constraint patch.";

export function unreachedConstraintsNote(refs: string[]): string {
  return `${refs.length === 1 ? "Constraint" : "Constraints"} ${refs.join(", ")} ${refs.length === 1 ? "reaches" : "reach"} no node yet: no requirement mapped to a node derives from an outcome on ${refs.length === 1 ? "its workflow" : "their workflows"}.`;
}

/** An outcome is a link of the chain when it was filed as one, or once it derived a requirement. */
export function inChain(o: Pick<ChainOutcome, "kind" | "derived">): boolean {
  return o.kind === "outcome" || o.derived > 0;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function capped(kind: ChainGapKind, detail: string, items: ChainItem[]): ChainGap {
  return {
    kind,
    detail,
    items: items.slice(0, CHAIN_ITEM_CAP),
    ...(items.length > CHAIN_ITEM_CAP ? { more: items.length - CHAIN_ITEM_CAP } : {}),
  };
}

export function chainReport(input: {
  vision: string | null | undefined;
  /** The plan carries Workflows (Indie and above). */
  workflows: boolean;
  outcomes: ChainOutcome[];
  requirements: ChainRequirement[];
  /** Constraints recorded on the project; null when they were not read. */
  constraintsRecorded: number | null;
  /** Refs of constraints that apply to no node (computed on a whole-project read only). */
  unreachedConstraints?: string[];
}): ChainReport {
  const sentences = visionSentences(input.vision);
  const live = new Set(sentences.map((s) => s.id));
  const outcomes = input.outcomes.filter(inChain);

  const served = new Set<string>();
  const offVision: ChainItem[] = [];
  let lost = 0;
  for (const o of outcomes) {
    const cited = o.serves.filter((s) => live.has(s.id));
    for (const s of cited) served.add(s.id);
    if (cited.length > 0) continue;
    const was = o.serves.map((s) => s.text).filter(Boolean).join(" / ");
    if (o.serves.length > 0) lost++;
    offVision.push({ id: o.id, label: o.name, mark: o.mark, ...(was ? { was } : {}) });
  }

  const blockers: ChainGap[] = [];
  const advisories: ChainGap[] = [];
  if (sentences.length === 0) {
    blockers.push({ kind: "vision", detail: "The project has no vision. Outcomes cite its sentences, so it comes first." });
  } else {
    if (served.size === 0) {
      blockers.push({ kind: "vision", detail: "No outcome cites the vision, so nothing built traces back to it." });
    }
    if (offVision.length > 0) {
      const tail = lost === 0 ? ""
        : offVision.length === 1 ? " It cites a sentence the vision no longer has (`was` holds the words it cited)."
        : ` ${lost} of them ${lost === 1 ? "cites" : "cite"} a sentence the vision no longer has (\`was\` holds the words ${lost === 1 ? "it" : "each"} cited).`;
      blockers.push(capped("off-vision", `${plural(offVision.length, "outcome cites", "outcomes cite")} no sentence of the current vision.${tail}`, offVision));
    }
    const unserved = sentences.filter((s) => !served.has(s.id));
    if (served.size > 0 && unserved.length > 0) {
      advisories.push(capped("unserved", `${plural(unserved.length, "vision sentence is", "vision sentences are")} served by no outcome.`, unserved.map((s) => ({ id: s.id, label: s.text }))));
    }
  }

  const reqs = input.requirements;
  const orphans = reqs.filter((r) => !r.hasOrigin);
  if (orphans.length > 0) {
    blockers.push(capped("origin", `${plural(orphans.length, "requirement derives", "requirements derive")} from no outcome.`, orphans.map((r) => ({ id: r.requirementId, label: r.name, mark: r.mark }))));
  }

  // A settled outcome keeps the steps it was filed on (the terminal rule on
  // step maps), so only a pending one can be placed, and only it is a gap.
  if (input.workflows) {
    const loose = outcomes.filter((o) => !o.onStep && o.status === "pending");
    if (loose.length > 0) {
      blockers.push(capped("no-step", `${plural(loose.length, "outcome sits", "outcomes sit")} on no workflow step.`, loose.map((o) => ({ id: o.id, label: o.name, mark: o.mark }))));
    }
  }

  const notes: string[] = [];
  if (input.constraintsRecorded === 0) notes.push(NO_CONSTRAINTS_NOTE);
  if (input.unreachedConstraints && input.unreachedConstraints.length > 0) notes.push(unreachedConstraintsNote(input.unreachedConstraints));

  return {
    ready: blockers.length === 0,
    counts: {
      visionSentences: sentences.length,
      sentencesServed: served.size,
      outcomes: outcomes.length,
      outcomesCitingVision: sentences.length === 0 ? 0 : outcomes.length - offVision.length,
      requirements: reqs.length,
      requirementsWithOrigin: reqs.length - orphans.length,
    },
    blockers,
    advisories,
    notes,
  };
}

/** One resolution per chain gap kind, stated once (the readiness remediations map). */
export const CHAIN_REMEDIATIONS: Record<ChainGapKind, string> = {
  vision: "Draft the vision with the user, in their words, and propose update_vision. Then cite it: each outcome names the sentence or sentences it serves (create_candidate or update_candidate with serves; get_outcome_board lists the sentences with their ids).",
  "off-vision": "For each named outcome, propose update_candidate { candidateId, changes: { serves: [sentence ids] } } with the vision sentence or sentences it serves (get_outcome_board lists them). If it serves none, ask the user whether the vision is missing a sentence (update_vision) or the outcome no longer belongs (they dismiss or settle it in the app).",
  origin: "Each named requirement needs the outcome it serves. Propose attach_candidate { candidateId, requirementId } against an outcome that exists, or file the outcome first (create_candidate with serves) and attach in a later proposal. Derivations are the user's act: they accept them in the app.",
  "no-step": "Place each named outcome on the workflow step it belongs to with set_outcome_step_maps (upsert_workflow_step first when the step does not exist). get_outcome_board lists the lanes and their steps.",
  unserved: "A vision sentence no outcome serves: draft the outcome that serves it (create_candidate with serves), or ask the user whether the sentence still belongs in the vision.",
};

// ── citing: the write side of the chain ────────────────────────────────────
// create_candidate and update_candidate resolve `serves` here, at propose
// (against the batch's own update_vision when it has one) and at apply.

/** Resolve an outcome's serves refs, or the refusal naming what is not in the vision. Pure. */
export function citeVision(
  op: string,
  refs: string[],
  vision: string,
): { served: VisionSentence[] } | { error: string } {
  const sentences = visionSentences(vision);
  if (sentences.length === 0) {
    return { error: `${op} refused: the project has no vision to cite yet. Put an update_vision earlier in the same proposal, then cite its sentences.` };
  }
  const { served, unknown } = resolveServes(refs, sentences);
  if (unknown.length > 0) {
    const named = unknown.slice(0, 3).map((u) => `"${u.length > 80 ? `${u.slice(0, 77)}...` : u}"`).join(", ");
    return { error: `${op} refused: ${named}${unknown.length > 3 ? ` and ${unknown.length - 3} more` : ""} ${unknown.length === 1 ? "is not a sentence" : "are not sentences"} of the current vision. get_outcome_board lists the vision's sentences with their ids.` };
  }
  return { served };
}

export const NO_ORIGIN_NOTE =
  "This requirement derives from no outcome yet, so get_build_readiness reports it as origin until it does: propose attach_candidate { candidateId, requirementId } against the outcome it serves (the user accepts derivations in the app).";

export const OFF_VISION_NOTE =
  "This outcome cites no vision sentence, so get_build_readiness reports it as off vision until it does: update_candidate with serves.";

// R5a · the checkbox-delta parser — the git→evidence half of the completion loop.
//
// Owner requirement: a task marked complete — in NodeSpec, in git (dev or AI), or
// over MCP — must trace backwards to the origin requirement's acceptance criteria.
// The truth already has one home: the per-criterion `met` flags on
// `specification_requirements.acceptance_criteria`. Task docs RENDER those flags as
// `- [x]` / `- [ ]` checkboxes, and a task doc is a normal repo file, so a developer
// or an AI ticking a box in git is already producing the signal. Nothing read it.
//
// This module reads it. It is deliberately PURE and deliberately literal:
//
//  · EXACT text match only. A criterion is identified by its text, never by
//    position — reordering the list must not silently re-target a tick, and a
//    REWORDED line is a different criterion whose old evidence does not transfer.
//  · No inference. An edited or unrecognizable line yields NO delta and a `flagged`
//    note instead. Guessing what a human meant is exactly the inversion this
//    project forbids: NodeSpec never interprets, it only reconciles what it can
//    prove.
//  · Untick is reported but NEVER auto-applied by the caller — see the note on
//    `CriterionDelta.direction`.

export interface ParsedCriterion {
  text: string;
  checked: boolean;
}

export interface ParsedTaskDoc {
  /** REQ-### → its checkbox list, in document order. */
  requirements: Record<string, ParsedCriterion[]>;
}

const REQ_HEADING = /^###\s+(REQ-[A-Za-z0-9_.-]+)\s*:/;
// Top-level checkbox only. Sub-lines under a criterion are indented back-references
// ("  → covered by Task T-1"), never criteria.
const CHECKBOX = /^-\s+\[([ xX])\]\s+(.*)$/;
const SECTION = /^##\s+/;

/**
 * Parse the `## Requirements` section of a generated task doc.
 * Anything outside that section is ignored — a checkbox in a Manual Steps list is
 * not a criterion, and treating it as one would fabricate evidence.
 */
export function parseTaskDocCriteria(markdown: string): ParsedTaskDoc {
  const requirements: Record<string, ParsedCriterion[]> = {};
  if (!markdown) return { requirements };

  const lines = markdown.split(/\r?\n/);
  let inRequirements = false;
  let currentReq: string | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (SECTION.test(line)) {
      inRequirements = /^##\s+Requirements\b/.test(line);
      currentReq = null;
      continue;
    }
    if (!inRequirements) continue;

    const heading = REQ_HEADING.exec(line);
    if (heading) {
      currentReq = heading[1];
      if (!requirements[currentReq]) requirements[currentReq] = [];
      continue;
    }
    if (!currentReq) continue;

    const box = CHECKBOX.exec(line);
    if (box) {
      const text = box[2].trim();
      if (text) requirements[currentReq].push({ text, checked: box[1].toLowerCase() === "x" });
    }
  }
  return { requirements };
}

export interface CriterionDelta {
  requirementId: string;
  /** The criterion's exact text — the only identity it has. */
  text: string;
  /**
   * `tick` = the doc says met, the database says not. This is the direction the
   * accept lane applies.
   *
   * `untick` is REPORTED so the card can show it, but the caller must not apply it:
   * a regenerated or stale task doc legitimately shows an unticked box for a
   * criterion whose evidence lives elsewhere (a passing test case), and letting a
   * file's checkbox retract proven evidence would make the weakest source of truth
   * the deciding one.
   */
  direction: "tick" | "untick";
}

export interface CriterionFlag {
  requirementId: string;
  text: string;
  reason: "unknown-criterion" | "unknown-requirement";
}

export interface CriterionDeltaResult {
  deltas: CriterionDelta[];
  /** Lines that could not be matched — surfaced, never inferred. */
  flagged: CriterionFlag[];
}

export interface CurrentCriterion {
  text: string;
  met?: boolean;
}

/**
 * Diff a parsed task doc against the CURRENT database state.
 *
 * @param current REQ-### → the criteria as stored today. A requirement the doc
 *   mentions but the database does not know is flagged, never created: task docs
 *   are DERIVED artifacts and must never become a back door for authoring
 *   requirements (that is the spec plane's job, R7).
 */
export function computeCriterionDeltas(
  parsed: ParsedTaskDoc,
  current: Record<string, CurrentCriterion[]>,
): CriterionDeltaResult {
  const deltas: CriterionDelta[] = [];
  const flagged: CriterionFlag[] = [];

  for (const [requirementId, boxes] of Object.entries(parsed.requirements)) {
    const known = current[requirementId];
    if (!known) {
      for (const box of boxes) {
        flagged.push({ requirementId, text: box.text, reason: "unknown-requirement" });
      }
      continue;
    }
    const byText = new Map(known.map((c) => [c.text, c]));
    for (const box of boxes) {
      // Exact match first; then retry with ONE trailing " (manual)" stripped.
      // The generator renders manual-lane criteria as `text (manual)` (the
      // row-level cue for the tick+approval lane) but the database stores the
      // bare text — without the retry, ticking a manual criterion's box is
      // flagged unknown-criterion and can never flip, even though the docs
      // say that tick is the ONLY way a manual criterion flips. A criterion
      // whose genuine stored text ends in "(manual)" still exact-matches
      // first, so the retry never mis-targets it. This is suffix-stripping of
      // a marker WE rendered, not inference about what a human meant.
      let match = byText.get(box.text);
      let storedText = box.text;
      if (!match && box.text.endsWith(" (manual)")) {
        const stripped = box.text.slice(0, -" (manual)".length).trimEnd();
        const alt = byText.get(stripped);
        if (alt) {
          match = alt;
          storedText = stripped;
        }
      }
      if (!match) {
        // Reworded, reformatted, or hand-added. No delta: the evidence proved the
        // OLD wording, and inferring which criterion was meant is inference.
        flagged.push({ requirementId, text: box.text, reason: "unknown-criterion" });
        continue;
      }
      // Deltas carry the STORED text — applyTickDeltas matches against the
      // database's wording, so a delta carrying the doc's suffixed rendering
      // would silently apply to nothing.
      const met = match.met === true;
      if (box.checked && !met) deltas.push({ requirementId, text: storedText, direction: "tick" });
      else if (!box.checked && met) deltas.push({ requirementId, text: storedText, direction: "untick" });
    }
  }
  return { deltas, flagged };
}

/** Only the deltas an accept may apply. See `CriterionDelta.direction`. */
export function applicableDeltas(result: CriterionDeltaResult): CriterionDelta[] {
  return result.deltas.filter((d) => d.direction === "tick");
}

export function summarizeDeltas(result: CriterionDeltaResult): string {
  const ticks = result.deltas.filter((d) => d.direction === "tick").length;
  const unticks = result.deltas.filter((d) => d.direction === "untick").length;
  const parts: string[] = [];
  if (ticks > 0) parts.push(`${ticks} criterion${ticks !== 1 ? "s" : ""} newly met`);
  if (unticks > 0) parts.push(`${unticks} unticked in the doc (not applied)`);
  if (result.flagged.length > 0) parts.push(`${result.flagged.length} unrecognized line(s)`);
  return parts.join(" · ");
}

/**
 * Apply the tick deltas: set `met: true` and stamp provenance, preserving every
 * other field on the criterion object.
 *
 * Provenance follows the same two-half convention the artifact lanes use (R3-4b):
 * the flag says WHAT, the provenance record says WHERE IT CAME FROM. Without it,
 * "met" is an assertion nobody can audit.
 */
export function applyTickDeltas(
  stored: unknown,
  ticks: CriterionDelta[],
  provenance: { source: "git"; commitSha?: string; actor?: string; at: string },
): { criteria: Array<Record<string, unknown>>; applied: number } {
  const wanted = new Set(ticks.map((d) => d.text));
  let applied = 0;
  const criteria = (Array.isArray(stored) ? stored : []).map((c) => {
    const obj: Record<string, unknown> = typeof c === "string" ? { text: c } : { ...(c as Record<string, unknown>) };
    if (typeof obj.text === "string" && wanted.has(obj.text) && obj.met !== true) {
      obj.met = true;
      obj.provenance = { ...provenance };
      applied++;
    }
    return obj;
  });
  return { criteria, applied };
}

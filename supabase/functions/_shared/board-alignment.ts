// D3 refinement 2 (owner ruling 2026-08-21): "I need to see the spec criteria
// with LATERAL alignment to specific tasks and tests, not overall summary in
// the actual rows."
//
// The alignment is EXACT, never heuristic, because both linkages are stored:
//   · task → criterion: the generator emits `↳ serves: REQ-### "text"` under
//     each work order (SynthTask.serves), and the shared task-doc parser
//     reads it back — matched here by (requirement id, exact criterion text),
//     the R5a binding rule;
//   · test → criterion: report_test_results stamps criterion.testId with the
//     test_cases ROW uuid — matched here by that uuid.
// A criterion with no stored linkage shows nothing — the board never guesses.
//
// ZERO imports: both runtimes (the BOARD.md generator and the app board) call
// THIS function, so the two projections cannot align differently.

export interface AlignableTask {
  displayId: string;
  title: string;
  done: boolean;
  nodeLabel: string;
  serves?: Array<{ reqId: string; text: string }>;
  /** Owner refinement 2026-09-01: set when `done` is DERIVED from criterion
   *  evidence (taskEvidenceDone) rather than a recorded tick — display
   *  surfaces mark the difference; tick surfaces never render this. */
  evidenceDone?: boolean;
}

export interface AlignableTest {
  /** test_cases ROW uuid — what criterion.testId points at. */
  rowId?: string;
  testId: string;
  name: string;
  status: string;
  stale: boolean;
}

export interface CriterionAlignment {
  tasks: AlignableTask[];
  tests: AlignableTest[];
}

export interface AlignedLanes {
  /** criterion text → its aligned tasks and tests (exact matches only). */
  byCriterion: Map<string, CriterionAlignment>;
  /** Tasks serving no criterion OF THIS REQUIREMENT (scaffolding, work for
   *  other requirements a shared node carries) — still real work, listed
   *  in the general Tasks sections. */
  generalTasks: AlignableTask[];
  /** Test cases no criterion points at — shown so evidence never hides. */
  otherTests: AlignableTest[];
}

export function alignCriterionLanes(args: {
  requirementId: string;
  criteria: Array<{ text: string; testId?: string }>;
  tasks: AlignableTask[];
  tests: AlignableTest[];
}): AlignedLanes {
  const byCriterion = new Map<string, CriterionAlignment>();
  for (const c of args.criteria) byCriterion.set(c.text, { tasks: [], tests: [] });

  const generalTasks: AlignableTask[] = [];
  for (const task of args.tasks) {
    // A task may serve several criteria — it reads under each (annotations
    // are pointers, not duplicates; the tick surface stays single).
    const served = (task.serves ?? []).filter(
      (s) => s.reqId === args.requirementId && byCriterion.has(s.text),
    );
    if (served.length === 0) {
      generalTasks.push(task);
      continue;
    }
    for (const s of served) byCriterion.get(s.text)!.tasks.push(task);
  }

  const claimed = new Set<string>();
  for (const c of args.criteria) {
    if (!c.testId) continue;
    const hit = args.tests.find((t) => t.rowId && t.rowId === c.testId);
    if (hit) {
      byCriterion.get(c.text)!.tests.push(hit);
      claimed.add(hit.rowId!);
    }
  }
  const otherTests = args.tests.filter((t) => !t.rowId || !claimed.has(t.rowId));

  return { byCriterion, generalTasks, otherTests };
}

/**
 * Owner refinement 2026-09-01: evidence-derived task completion, DISPLAY ONLY.
 *
 * The task checklist has exactly one write lane (git ticks + user approval),
 * so in the MCP loop a requirement reads "verified · 0/N tasks" forever —
 * stale declarations beside proven outcomes. Evidence is strictly stronger
 * than the declaration a tick would carry: a task whose EVERY served
 * criterion is met with non-stale evidence is proven complete. This derives
 * that state at render time — no task_items write, so it self-heals when
 * evidence goes stale (the derived ☑ disappears with it, which a stamped row
 * could not do).
 *
 * Strictly conservative — derives ONLY when:
 *   · the task is not already ticked (nothing to derive) and not orphaned;
 *   · it serves ≥1 criterion, and every serves entry targets THIS requirement
 *     (cross-requirement work stays undecided — this row cannot see the other
 *     requirement's evidence);
 *   · every served text matches a CURRENT criterion (a reworded criterion
 *     breaks the linkage — the board never guesses);
 *   · every served criterion is met with evidence not stale.
 * General/requirement-wide tasks never derive. deriveWorkStatus output is
 * provably unchanged by this (derivation requires all served criteria met,
 * which already implies a progress signal) — only the COUNTS move.
 */
export function taskEvidenceDone(args: {
  requirementId: string;
  criteria: Array<{ text: string; met?: boolean; evidenceStale?: unknown }>;
  task: { done: boolean; orphaned?: boolean; serves?: Array<{ reqId: string; text: string }> };
}): boolean {
  const { task } = args;
  if (task.done || task.orphaned) return false;
  const serves = task.serves ?? [];
  if (serves.length === 0) return false;
  const byText = new Map(args.criteria.map((c) => [c.text, c]));
  for (const s of serves) {
    if (s.reqId !== args.requirementId) return false;
    const criterion = byText.get(s.text);
    if (!criterion) return false;
    if (criterion.met !== true || criterion.evidenceStale) return false;
  }
  return true;
}

const TEST_GLYPHS: Record<string, string> = { passed: "✅", failed: "❌" };

/** The one-line lateral annotation rendered under a criterion — identical in
 *  BOARD.md and mirrored by the app row. Empty string when nothing aligns. */
export function formatCriterionAnnotation(alignment: CriterionAlignment): string {
  const parts: string[] = [];
  if (alignment.tasks.length > 0) {
    parts.push(
      "tasks: " + alignment.tasks
        // "(by evidence)" marks a derived ☑ — the task's checkbox below is
        // still unticked; its served criteria's evidence proves the work.
        .map((t) => `${t.displayId} ${t.done ? "☑" : "☐"}${t.done && t.evidenceDone ? " (by evidence)" : ""} (${t.nodeLabel})`)
        .join(", "),
    );
  }
  if (alignment.tests.length > 0) {
    parts.push(
      "tests: " + alignment.tests
        .map((t) => `${t.testId} ${TEST_GLYPHS[t.status] ?? "▫️"}${t.stale ? " (stale)" : ""}`)
        .join(", "),
    );
  }
  return parts.length > 0 ? `↳ ${parts.join(" · ")}` : "";
}

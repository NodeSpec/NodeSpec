// A4 (docs/WORK_LOOP_PLAN.md) · the T-task return path — parallel to
// criterion-deltas.ts, for the OTHER checkbox family.
//
// `- [ ] **T1 — title**` implementation tasks in .task.md docs had no
// identity (positional ids that renumber on every regeneration) and no
// reader — out-of-band progress was invisible, and every regen visually
// wiped ticks. This module gives each task a stable, content-derived anchor
// key rendered as a trailing HTML comment (`<!-- t:<hex8> -->`), parses it
// back, diffs against task_items state, and applies TICKS ONLY.
//
// Doctrine carried over verbatim from the criterion lane:
//  · Identity is content (the task title), never position — a reordered or
//    renumbered list keeps its keys; a REWORDED task is a NEW task whose old
//    state does not transfer.
//  · No inference. A task line without an anchor (a pre-A4 doc, or a
//    hand-added line) yields NO delta and a `no-anchor` flag — the
//    push-freshness lane retrofits anchors in one regen round.
//  · Unticks are reported, never applied: a regenerated doc legitimately
//    renders `[ ]` when state was recorded elsewhere, and the weakest source
//    must not retract evidence.

export interface TaskFlag {
  title: string;
  reason: "no-anchor";
}

export interface ParsedTask {
  displayId: string;
  title: string;
  /** Stable anchor key, or null when the line carries none (flagged). */
  key: string | null;
  checked: boolean;
  /** D3 alignment: criteria this work order serves, read back from the
   *  generator's `↳ serves: REQ-### "text"` detail lines. VERIFIED serves
   *  only — the `(unverified match)` variant never aligns anything. */
  serves?: Array<{ reqId: string; text: string }>;
  /** Y: a person added it in Work (the doc's `## Added Tasks` section). */
  added?: boolean;
}

export interface ParsedTaskDocTasks {
  tasks: ParsedTask[];
  flagged: TaskFlag[];
}

/**
 * FNV-1a 32-bit over the task title, hex8. Deterministic across runtimes
 * (pure integer math), stable across regenerations because titles are
 * synthesized from model content (contract names, criterion texts, component
 * names) — the same task keeps its title, and therefore its key, no matter
 * where it lands in the list.
 */
export function taskAnchorKey(title: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) {
    hash ^= title.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Keys for an ordered title list, with duplicate titles disambiguated by an
 * occurrence suffix (`-2`, `-3`, …). Suffixing by occurrence order is stable
 * as long as duplicates keep their relative order — and duplicate titles only
 * arise from genuinely identical work orders, which the synthesizer does not
 * reorder among themselves.
 */
export function assignTaskKeys(titles: string[]): string[] {
  const seen = new Map<string, number>();
  return titles.map((title) => {
    const base = taskAnchorKey(title);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

const SECTION = /^##\s+/;
const TASK_LINE = /^-\s+\[([ xX])\]\s+\*\*(T\d+)\s+—\s+(.+?)\*\*\s*(?:<!--\s*t:([a-f0-9]{8}(?:-\d+)?)\s*-->)?\s*$/;
const SERVES_LINE = /^\s*↳ serves: (\S+) "(.+?)"/;

/**
 * Parse the `## Implementation Tasks` section of a generated task doc, and
 * the person's `## Added Tasks` section after it (same line format, marked
 * `added`). Checkbox lines anywhere else (Requirements criteria, Manual
 * Steps) belong to other lanes and are ignored here.
 */
export function parseTaskDocTasks(markdown: string): ParsedTaskDocTasks {
  const tasks: ParsedTask[] = [];
  const flagged: TaskFlag[] = [];
  if (!markdown) return { tasks, flagged };

  let inTasks = false;
  let inAdded = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (SECTION.test(line)) {
      inAdded = ADDED_SECTION.test(line);
      inTasks = inAdded || /^##\s+Implementation Tasks\b/.test(line);
      continue;
    }
    if (!inTasks) continue;

    const match = TASK_LINE.exec(line);
    if (!match) {
      // D3 alignment: a verified serves-line attributes the PRECEDING task to
      // a criterion. Format is the generator's own detail line; the
      // `(unverified match)` variant is deliberately ignored.
      const serves = SERVES_LINE.exec(line);
      if (serves && tasks.length > 0) {
        const last = tasks[tasks.length - 1];
        (last.serves ??= []).push({ reqId: serves[1], text: serves[2] });
      }
      continue;
    }
    const [, box, displayId, title, key] = match;
    if (!key) {
      flagged.push({ title: title.trim(), reason: "no-anchor" });
      continue;
    }
    tasks.push({
      displayId,
      title: title.trim(),
      key,
      checked: box.toLowerCase() === "x",
      ...(inAdded ? { added: true } : {}),
    });
  }
  return { tasks, flagged };
}

/**
 * AL.27 (owner 2026-10-08): what each work order SAYS, read from the doc: the
 * indented lines under a task line (the generator's details, or the steps the
 * agent expanded it into), keyed by the task's anchor key. The serves-lines
 * are left out (they are the task's criteria, read by parseTaskDocTasks), as
 * are bare HTML comments; blank lines are skipped; the first line that is not
 * indented ends the task. The base indent is removed and any deeper indent
 * kept, so a nested list stays nested. A task line with no anchor has no key
 * to carry its lines and is skipped, as parseTaskDocTasks skips it.
 */
export function taskDocDetails(markdown: string): Map<string, string[]> {
  const details = new Map<string, string[]>();
  if (!markdown) return details;
  let inTasks = false;
  let current: string[] | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (SECTION.test(line)) {
      inTasks = ADDED_SECTION.test(line) || /^##\s+Implementation Tasks\b/.test(line);
      current = null;
      continue;
    }
    if (!inTasks) continue;
    const match = TASK_LINE.exec(line);
    if (match) {
      const key = match[4];
      current = key ? [] : null;
      if (key) details.set(key, current!);
      continue;
    }
    if (!current || line.trim() === '') continue;
    if (!/^\s/.test(line)) { current = null; continue; }
    if (/^\s*↳ serves:/.test(line) || /^\s*<!--.*-->\s*$/.test(line)) continue;
    current.push(line.replace(/^ {1,2}/, '').replace(/^\t/, ''));
  }
  return details;
}

// ── AL.29 (gap 2): the steps an agent writes under a work order ───────────────
//
// The generator writes a work order as its task line, details and serves-lines,
// never a checkbox under it. The agent expands it into steps: indented checkbox
// lines under the task line ("  - [ ] ..."), with any lines indented further
// under a step. Regeneration used to drop them (only Implementation Context and
// Added Tasks survived). keepWorkOrderSteps carries them by the work order's
// anchor key. The steps of a work order the regeneration no longer has (its
// criterion was reworded or removed, so its title and key changed) go to
// "Steps to review" at the end of the section, under the work order they were
// written for, and stay there until someone moves or deletes them.
const STEP_LINE = /^(\s+)- \[[ xX]\] /;
const IMPLEMENTATION_TASKS = /^##\s+Implementation Tasks\b/;
export const STEPS_TO_REVIEW_HEADING = "### Steps to review";
const STEPS_REVIEW_NOTE = "Kept from a work order that was reworded or removed. Move each under a work order above, or delete it.";

export interface WorkOrderSteps {
  /** anchor key -> the work order as stored and the step lines under it, verbatim. */
  byKey: Map<string, { displayId: string; title: string; lines: string[] }>;
  /** The review block's lines as stored, without its heading and note. */
  review: string[];
}

/** The steps under each work order of `## Implementation Tasks`, and the review block. */
export function workOrderSteps(markdown: string): WorkOrderSteps {
  const byKey: WorkOrderSteps["byKey"] = new Map();
  const review: string[] = [];
  let inTasks = false;
  let inReview = false;
  let current: { displayId: string; title: string; lines: string[] } | null = null;
  let stepIndent: number | null = null;
  for (const raw of (markdown ?? "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (SECTION.test(line)) {
      inTasks = IMPLEMENTATION_TASKS.test(line);
      inReview = false;
      current = null;
      continue;
    }
    if (!inTasks) continue;
    if (line === STEPS_TO_REVIEW_HEADING) { inReview = true; current = null; continue; }
    if (inReview) { if (line !== STEPS_REVIEW_NOTE) review.push(line); continue; }
    const task = TASK_LINE.exec(line);
    if (task) {
      current = task[4] ? { displayId: task[2], title: task[3].trim(), lines: [] } : null;
      if (current) byKey.set(task[4], current);
      stepIndent = null;
      continue;
    }
    if (!current || line.trim() === "") continue;
    if (!/^\s/.test(line)) { current = null; continue; }
    const step = STEP_LINE.exec(line);
    if (step) { current.lines.push(line); stepIndent = step[1].length; continue; }
    if (stepIndent !== null && line.length - line.trimStart().length > stepIndent) { current.lines.push(line); continue; }
    stepIndent = null;
  }
  while (review.length > 0 && review[0].trim() === "") review.shift();
  while (review.length > 0 && review[review.length - 1].trim() === "") review.pop();
  return { byKey, review };
}

/**
 * Carry the stored doc's steps into a regenerated one: under the work order
 * with the same key, after its own lines; the steps of a work order no longer
 * listed, and the stored review block, into "Steps to review" at the end of
 * the section. A regeneration of an unchanged doc gives it back byte for byte.
 */
export function keepWorkOrderSteps(generated: string, stored: string): string {
  const kept = workOrderSteps(stored);
  if (kept.review.length === 0 && ![...kept.byKey.values()].some((w) => w.lines.length > 0)) return generated;
  const lines = generated.split("\n");
  const span = level2Span(lines, IMPLEMENTATION_TASKS);
  if (!span) return generated;

  const section: string[] = [];
  const listed = new Set<string>();
  for (let i = span.start; i < span.end; i++) {
    section.push(lines[i]);
    const task = TASK_LINE.exec(lines[i].trimEnd());
    if (!task || !task[4]) continue;
    listed.add(task[4]);
    while (i + 1 < span.end && /^\s+\S/.test(lines[i + 1])) section.push(lines[++i]);
    section.push(...(kept.byKey.get(task[4])?.lines ?? []));
  }
  const gone = [...kept.byKey].filter(([key, w]) => !listed.has(key) && w.lines.length > 0);
  if (gone.length > 0 || kept.review.length > 0) {
    while (section.length > 1 && section[section.length - 1].trim() === "") section.pop();
    section.push("", STEPS_TO_REVIEW_HEADING, "", STEPS_REVIEW_NOTE, "",
      ...kept.review,
      ...gone.flatMap(([, w]) => [`Written for ${w.displayId}: ${w.title}`, ...w.lines]),
      "");
  }
  return [...lines.slice(0, span.start), ...section, ...lines.slice(span.end)].join("\n");
}

/** AL.29: a checkbox line, a step under a work order or a statement under a test
 *  case: whether it is ticked, and its text. Null for any other line. */
export function checkboxOf(line: string): { done: boolean; text: string } | null {
  const m = /^\s*- \[([ xX])\] (.*)$/.exec(line);
  return m ? { done: m[1] !== " ", text: m[2] } : null;
}

/** How an agent writes a work order's steps; generate_task_docs serves it beside the gaps. */
export const STEP_FORMAT = "Under a work order's task line, one indented checkbox line per step (\"  - [ ] <step>\"), with any detail indented further under its step. Write them into the stored doc with propose_patches update_artifact, passing base_sequence (the headSequence you read the doc at). Steps stay with their work order when the doc regenerates; the steps of a work order that was reworded or removed move to \"### Steps to review\", each group under \"Written for T<n>: <title>\": move each step under a work order, or delete it.";

/**
 * AL.29: what a task doc still asks of an agent: the open work orders of
 * Implementation Tasks with no step under them (a ticked one is done), in the
 * doc's order, and how many steps wait under "Steps to review".
 */
export function stepGaps(markdown: string): { withoutSteps: Array<{ id: string; key: string; title: string }>; toReview: number } {
  const kept = workOrderSteps(markdown);
  const withoutSteps: Array<{ id: string; key: string; title: string }> = [];
  let inTasks = false;
  for (const raw of (markdown ?? "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (SECTION.test(line)) { inTasks = IMPLEMENTATION_TASKS.test(line); continue; }
    if (!inTasks) continue;
    const task = TASK_LINE.exec(line);
    if (!task || !task[4] || task[1] !== " ") continue;
    if ((kept.byKey.get(task[4])?.lines.length ?? 0) === 0) withoutSteps.push({ id: task[2], key: task[4], title: task[3].trim() });
  }
  return { withoutSteps, toReview: kept.review.filter((l) => STEP_LINE.test(l)).length };
}

// ── Y (owner 2026-09-23): tasks a person adds by hand ──────────────────────────
//
// The task list is the agent's: generate_task_docs writes the work orders and
// rewrites them on every regeneration. A person can still add one from the
// Requirements record. It lands in its OWN section, `## Added Tasks`, right
// after the generated list, in the same line format (anchor key from the
// title, a serves-line naming the criterion it serves), so every reader of
// the list (trace, plan, board, tick deltas) sees it with no second source.
// The section is person-owned the way Implementation Context is AI-owned:
// regeneration carries it verbatim (preserveAddedTasksSection), renumbering
// its display ids after the generated ones. It is not a fingerprint input,
// so adding a task never re-stales the packet.
export const ADDED_TASKS_HEADING = "## Added Tasks";
export const ADDED_TASKS_NOTE =
  "<!-- PERSON-ADDED SECTION: a person added these tasks in NodeSpec. Regeneration carries them verbatim. Build them like the work orders above; each one keeps its anchor and serves-line. -->";
const ADDED_SECTION = /^##\s+Added Tasks\b/;
const TASK_ID_ON_LINE = /^(-\s+\[[ xX]\]\s+\*\*)T(\d+)(\s+—\s+)/;

/** A level-2 section's line span: its `## ` heading to the next `## ` heading. */
function level2Span(lines: string[], heading: RegExp): { start: number; end: number } | null {
  const start = lines.findIndex((l) => heading.test(l.trimEnd()));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

/** One line, no bold markers or comment fences: the title must survive TASK_LINE. */
export function cleanTaskTitle(title: string): string {
  return title.replace(/\*+/g, "").replace(/<!--|-->/g, "").replace(/\s+/g, " ").trim();
}

function highestTaskNumber(lines: string[]): number {
  let max = 0;
  for (const l of lines) {
    const m = TASK_ID_ON_LINE.exec(l);
    if (m) max = Math.max(max, Number(m[2]));
  }
  return max;
}

/** The display id the next added task takes in this doc ("T1" for none). */
export function nextAddedTaskId(markdown: string | null | undefined): string {
  return `T${highestTaskNumber((markdown ?? "").split("\n")) + 1}`;
}

export type AddTaskResult =
  | { ok: true; content: string; displayId: string; key: string }
  | { ok: false; refusal: string };

/**
 * Append a person's task to a node's task doc. The task serves one
 * criterion; a title the doc already lists (same anchor key) is refused.
 * With no doc yet, a minimal one is started (the agent's next
 * generate_task_docs fills the rest in around it).
 */
export function appendAddedTask(
  markdown: string | null | undefined,
  input: { nodeLabel: string; title: string; serves: { reqId: string; text: string } },
): AddTaskResult {
  const title = cleanTaskTitle(input.title);
  if (!title) return { ok: false, refusal: "A task needs a title." };
  const key = taskAnchorKey(title);
  const existing = markdown ? parseTaskDocTasks(markdown).tasks.find((t) => t.key === key) : undefined;
  if (existing) return { ok: false, refusal: `${existing.displayId} on ${input.nodeLabel} already says that.` };

  const base = markdown && markdown.trim() ? markdown : `# Task: ${input.nodeLabel}\n`;
  const lines = base.split("\n");
  const displayId = `T${highestTaskNumber(lines) + 1}`;
  const entry = [
    `- [ ] **${displayId} — ${title}** <!-- t:${key} -->`,
    `  ↳ serves: ${input.serves.reqId} "${input.serves.text}"`,
  ];

  const added = level2Span(lines, ADDED_SECTION);
  if (added) {
    let at = added.end;
    while (at > added.start + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, ...entry);
  } else {
    const section = [ADDED_TASKS_HEADING, "", ADDED_TASKS_NOTE, ...entry, ""];
    const generated = level2Span(lines, /^##\s+Implementation Tasks\b/);
    if (generated) {
      lines.splice(generated.end, 0, ...section);
    } else {
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push("", ...section);
    }
  }
  return { ok: true, content: lines.join("\n"), displayId, key };
}

/**
 * Regeneration keeps the person's section. The stored `## Added Tasks` goes
 * back in right after the generated `## Implementation Tasks` (or at the end
 * when the doc has none), its display ids renumbered after the generated
 * ones. A task the generated list now carries under the same title (same
 * key) is dropped from the section: it is listed above and its state follows
 * the key.
 */
export function preserveAddedTasksSection(generated: string, stored: string): string {
  const storedLines = (stored ?? "").split("\n");
  const span = level2Span(storedLines, ADDED_SECTION);
  if (!span) return generated;

  const genLines = generated.split("\n");
  const genKeys = new Set(parseTaskDocTasks(generated).tasks.map((t) => t.key));
  let next = highestTaskNumber(genLines);
  const carried: string[] = [];
  let dropping = false;
  for (const line of storedLines.slice(span.start, span.end)) {
    const task = TASK_LINE.exec(line.trimEnd());
    if (task) {
      dropping = !!task[4] && genKeys.has(task[4]);
      if (dropping) continue;
      next += 1;
      carried.push(line.replace(TASK_ID_ON_LINE, `$1T${next}$3`));
      continue;
    }
    // AL.29: a blank line inside a dropped task does not end it; only the next
    // line that is not indented does (its later details used to land under the
    // task before it).
    if (dropping && (/^\s+\S/.test(line) || line.trim() === "")) continue;
    dropping = false;
    carried.push(line);
  }
  if (!carried.some((l) => TASK_LINE.test(l.trimEnd()))) return generated;
  while (carried.length > 0 && carried[carried.length - 1].trim() === "") carried.pop();
  carried.push("");

  const genTasks = level2Span(genLines, /^##\s+Implementation Tasks\b/);
  if (genTasks) {
    return [...genLines.slice(0, genTasks.end), ...carried, ...genLines.slice(genTasks.end)].join("\n");
  }
  const tail = [...genLines];
  while (tail.length > 0 && tail[tail.length - 1].trim() === "") tail.pop();
  return [...tail, "", ...carried].join("\n");
}

// P0-4: the path carries a short node-id suffix and is used ONLY to seed the FIRST
// creation of a node's task doc. It is never recomputed to find an existing doc —
// lookups go through findExistingTaskArtifact (nodeId + kind), so renaming a node
// neither moves its doc nor duplicates it, and docs stored under legacy label-only
// paths keep their persisted path on update. (Y: lives here so the app, which
// starts a doc when a person adds the first task by hand, reads the same rule.)
export function getTaskDocumentPath(nodeLabel: string, nodeId: string): string {
  const slug = nodeLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const idSuffix = nodeId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return `.nodespec/tasks/${slug}-${idSuffix}.task.md`;
}

export interface TaskDelta {
  nodeId: string;
  key: string;
  displayId: string;
  title: string;
  /** Same asymmetry as CriterionDelta: only `tick` is ever applied. */
  direction: "tick" | "untick";
}

export interface TaskDeltaResult {
  deltas: TaskDelta[];
  flagged: TaskFlag[];
}

/**
 * Diff a parsed doc against current done-state for its node. A key with no
 * task_items row reads as not-done — the first tick CREATES the row (state
 * is an upsert, not an update of pre-registered tasks).
 */
export function computeTaskDeltas(
  nodeId: string,
  parsed: ParsedTaskDocTasks,
  currentDone: Map<string, boolean>,
): TaskDeltaResult {
  const deltas: TaskDelta[] = [];
  for (const task of parsed.tasks) {
    if (!task.key) continue;
    const done = currentDone.get(task.key) === true;
    if (task.checked && !done) {
      deltas.push({ nodeId, key: task.key, displayId: task.displayId, title: task.title, direction: "tick" });
    } else if (!task.checked && done) {
      deltas.push({ nodeId, key: task.key, displayId: task.displayId, title: task.title, direction: "untick" });
    }
  }
  return { deltas, flagged: [...parsed.flagged] };
}

/** Only the deltas an accept may apply. */
export function applicableTaskDeltas(result: TaskDeltaResult): TaskDelta[] {
  return result.deltas.filter((d) => d.direction === "tick");
}

/**
 * Sweep/webhook lane: fetch each changed task doc at the ref, parse, and diff
 * against ONE batch read of the project's task_items. Files carry the nodeId
 * their artifact match resolved — the doc's tasks belong to that node.
 * Dedupe on (nodeId, key): the same doc reached via two matches must not
 * report a tick twice.
 */
// deno-lint-ignore no-explicit-any
export async function computeSweepTaskDeltas(supabase: any, projectId: string, args: {
  // deno-lint-ignore no-explicit-any
  integration: any;
  apiBase: string;
  token: string;
  ref: string;
  files: Array<{ path: string; nodeId: string }>;
  fetchFile: (
    provider: string, apiBase: string, owner: string, repo: string,
    path: string, ref: string, token: string,
  ) => Promise<string | null>;
}): Promise<TaskDeltaResult> {
  const { integration, apiBase, token, ref, files, fetchFile } = args;

  const { data: stateRows } = await supabase
    .from("task_items")
    .select("node_id, task_key, done")
    .eq("project_id", projectId);
  const doneByNodeKey = new Map<string, boolean>(
    (Array.isArray(stateRows) ? stateRows : []).map(
      (r: { node_id: string; task_key: string; done: boolean }) => [`${r.node_id}::${r.task_key}`, r.done === true],
    ),
  );

  const merged: TaskDeltaResult = { deltas: [], flagged: [] };
  for (const file of files) {
    if (!file.nodeId) continue; // a pathological unbound artifact cannot own task state
    const content = await fetchFile(
      integration.provider, apiBase, integration.repo_owner, integration.repo_name, file.path, ref, token,
    );
    if (!content) continue;
    const parsed = parseTaskDocTasks(content);
    const perNode = new Map<string, boolean>();
    for (const task of parsed.tasks) {
      if (task.key) perNode.set(task.key, doneByNodeKey.get(`${file.nodeId}::${task.key}`) === true);
    }
    const result = computeTaskDeltas(file.nodeId, parsed, perNode);
    merged.deltas.push(...result.deltas);
    merged.flagged.push(...result.flagged);
  }

  const seen = new Set<string>();
  merged.deltas = merged.deltas.filter((d) => {
    const key = `${d.nodeId}::${d.key}::${d.direction}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const seenFlags = new Set<string>();
  merged.flagged = merged.flagged.filter((f) => {
    if (seenFlags.has(f.title)) return false;
    seenFlags.add(f.title);
    return true;
  });
  return merged;
}

export interface ApplyTaskResult {
  applied: number;
}

/**
 * Apply tick deltas into task_items — tick-only upsert on
 * (project_id, node_id, task_key). Rows already done are skipped (natural
 * idempotency: re-opening a card cannot double-stamp), and applying a tick
 * un-orphans a key the generator later re-emits.
 */
// deno-lint-ignore no-explicit-any
export async function applyTaskDeltas(supabase: any, projectId: string, opts: {
  deltas: TaskDeltaResult;
  commitSha?: string;
  actor?: string;
  source?: "git" | "mcp";
}): Promise<ApplyTaskResult> {
  const ticks = applicableTaskDeltas(opts.deltas);
  if (ticks.length === 0) return { applied: 0 };

  const { data: existing } = await supabase
    .from("task_items")
    .select("node_id, task_key, done")
    .eq("project_id", projectId)
    .in("task_key", ticks.map((t) => t.key));
  const alreadyDone = new Set(
    (Array.isArray(existing) ? existing : [])
      .filter((r: { done: boolean }) => r.done === true)
      .map((r: { node_id: string; task_key: string }) => `${r.node_id}::${r.task_key}`),
  );

  const provenance = {
    source: opts.source ?? "git",
    ...(opts.commitSha ? { commitSha: opts.commitSha } : {}),
    ...(opts.actor ? { actor: opts.actor } : {}),
    at: new Date().toISOString(),
  };
  const rows = ticks
    .filter((t) => !alreadyDone.has(`${t.nodeId}::${t.key}`))
    .map((t) => ({
      project_id: projectId,
      node_id: t.nodeId,
      task_key: t.key,
      done: true,
      provenance,
      display_id: t.displayId,
      title: t.title,
      orphaned: false,
    }));
  if (rows.length === 0) return { applied: 0 };

  const { error } = await supabase
    .from("task_items")
    .upsert(rows, { onConflict: "project_id,node_id,task_key" });
  if (error) throw new Error(`task_items upsert failed: ${error.message}`);
  return { applied: rows.length };
}

/**
 * One batch read of a project's task state for the generator call sites:
 * nodeId → (anchor key → done). Generators pass the per-node map as
 * `taskState` so regenerated docs render recorded ticks.
 */
// deno-lint-ignore no-explicit-any
export async function loadTaskStateByNode(supabase: any, projectId: string): Promise<Map<string, Map<string, boolean>>> {
  const { data: rows } = await supabase
    .from("task_items")
    .select("node_id, task_key, done")
    .eq("project_id", projectId);
  const byNode = new Map<string, Map<string, boolean>>();
  for (const row of (Array.isArray(rows) ? rows : []) as Array<{ node_id: string; task_key: string; done: boolean }>) {
    const perNode = byNode.get(row.node_id) ?? new Map<string, boolean>();
    perNode.set(row.task_key, row.done === true);
    byNode.set(row.node_id, perNode);
  }
  return byNode;
}

/**
 * After a regeneration, reconcile the node's task_items against the keys the
 * doc actually emits: state for a key the generator no longer produces is
 * ORPHANED (flagged, never deleted — evidence survives doc churn), and a
 * key that reappears is restored. Best-effort at call sites: reconciliation
 * failure must never fail a generation.
 */
// deno-lint-ignore no-explicit-any
export async function reconcileTaskItemOrphans(supabase: any, projectId: string, nodeId: string, docContent: string): Promise<{ orphaned: number; restored: number }> {
  const emitted = new Set(
    parseTaskDocTasks(docContent).tasks
      .map((t) => t.key)
      .filter((k): k is string => k !== null),
  );
  const { data: rows } = await supabase
    .from("task_items")
    .select("id, task_key, orphaned")
    .eq("project_id", projectId)
    .eq("node_id", nodeId);
  const all = (Array.isArray(rows) ? rows : []) as Array<{ id: string; task_key: string; orphaned: boolean }>;
  const toOrphan = all.filter((r) => !emitted.has(r.task_key) && r.orphaned !== true).map((r) => r.id);
  const toRestore = all.filter((r) => emitted.has(r.task_key) && r.orphaned === true).map((r) => r.id);
  if (toOrphan.length > 0) {
    await supabase.from("task_items").update({ orphaned: true }).in("id", toOrphan);
  }
  if (toRestore.length > 0) {
    await supabase.from("task_items").update({ orphaned: false }).in("id", toRestore);
  }
  return { orphaned: toOrphan.length, restored: toRestore.length };
}

export function summarizeTaskDeltas(result: TaskDeltaResult): string {
  const ticks = result.deltas.filter((d) => d.direction === "tick").length;
  const unticks = result.deltas.filter((d) => d.direction === "untick").length;
  const parts: string[] = [];
  if (ticks > 0) parts.push(`${ticks} task${ticks !== 1 ? "s" : ""} newly done`);
  if (unticks > 0) parts.push(`${unticks} unticked in the doc (not applied)`);
  if (result.flagged.length > 0) parts.push(`${result.flagged.length} pre-anchor task line(s)`);
  return parts.join(" · ");
}

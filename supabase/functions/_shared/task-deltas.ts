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
 * Parse the `## Implementation Tasks` section of a generated task doc.
 * Checkbox lines anywhere else (Requirements criteria, Manual Steps) belong
 * to other lanes and are ignored here.
 */
export function parseTaskDocTasks(markdown: string): ParsedTaskDocTasks {
  const tasks: ParsedTask[] = [];
  const flagged: TaskFlag[] = [];
  if (!markdown) return { tasks, flagged };

  let inTasks = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (SECTION.test(line)) {
      inTasks = /^##\s+Implementation Tasks\b/.test(line);
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
    });
  }
  return { tasks, flagged };
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

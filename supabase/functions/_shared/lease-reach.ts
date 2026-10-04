// AA.5 (owner 2026-09-23): a work lease's reach, pure.
//
// "If a node is leased, then it is locked." A node lease locks the node's
// structure; work inside the node (the task and code levels) runs in
// parallel as long as the pieces of work cannot collide. A work lease's
// reach is what it could collide on:
//
//   - the files it declared at claim (`touches`), and
//   - the files one import away inside the node, in either direction
//     (repo_index_edges), and
//   - the files verified by the same test as a declared file
//     (test_cases.source_artifact_ids).
//
// With no files declared the lease reaches the whole node ('*'), so an agent
// has a reason to name its scope. On a node with no files yet (greenfield),
// a task reaches the criteria it serves ('criterion:' tokens) or, serving
// none, only itself ('task:' token): two tasks collide there only when they
// serve the same criterion.
//
// The claim RPC compares reaches under the project row lock (migration
// 20260923130000); this module computes them. Pure and dependency-free past
// fnv1a32.
import { fnv1a32 } from "./criterion-identity.ts";

export const WHOLE_NODE = "*";
/** A reach never lists more than this; past it, the lease reaches the whole node. */
export const REACH_CAP = 200;

/** One spelling for a repository path: no leading ./ or /, forward slashes. */
export function normalizePath(p: string): string {
  return String(p ?? "").trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
}

/** The greenfield token a served criterion becomes. */
export function criterionToken(reqId: string, text: string): string {
  return `criterion:${reqId}:${fnv1a32(String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase())}`;
}

export function taskToken(taskKey: string): string {
  return `task:${taskKey}`;
}

export function leaseReach(input: {
  /** The files the work declared. */
  touches: readonly string[];
  /** Every file bound to the node. */
  nodeFiles: readonly string[];
  /** Import edges with at least one end in `touches`. */
  edges: ReadonlyArray<{ from: string; to: string }>;
  /** The source files each test verifies, one list per test. */
  testGroups: ReadonlyArray<readonly string[]>;
  /** A greenfield task's tokens (the criteria it serves, else itself). */
  greenfield?: readonly string[];
}): string[] {
  const touches = [...new Set(input.touches.map(normalizePath).filter(Boolean))];
  const inNode = new Set(input.nodeFiles.map(normalizePath).filter(Boolean));
  if (inNode.size === 0) {
    const tokens = [...touches, ...(input.greenfield ?? [])];
    return tokens.length > 0 ? [...new Set(tokens)].sort() : [WHOLE_NODE];
  }
  if (touches.length === 0) return [WHOLE_NODE];
  const reach = new Set(touches);
  const declared = new Set(touches);
  for (const e of input.edges) {
    const from = normalizePath(e.from), to = normalizePath(e.to);
    if (declared.has(from) && inNode.has(to)) reach.add(to);
    if (declared.has(to) && inNode.has(from)) reach.add(from);
  }
  for (const group of input.testGroups) {
    const files = group.map(normalizePath);
    if (!files.some((f) => declared.has(f))) continue;
    for (const f of files) if (inNode.has(f)) reach.add(f);
  }
  if (reach.size > REACH_CAP) return [WHOLE_NODE];
  return [...reach].sort();
}

/** The token two reaches share ('*' when either is the whole node), or null. The RPC's rule, in TypeScript. */
export function reachOverlap(a: readonly string[], b: readonly string[]): string | null {
  if (a.length === 0 || b.length === 0 || a.includes(WHOLE_NODE) || b.includes(WHOLE_NODE)) return WHOLE_NODE;
  const other = new Set(b);
  return [...a].sort().find((x) => other.has(x)) ?? null;
}

/** The paths a heartbeat reports that the lease's reach does not cover. */
export function outsideReach(reach: readonly string[], paths: readonly string[]): string[] {
  if (reach.includes(WHOLE_NODE)) return [];
  const have = new Set(reach);
  return [...new Set(paths.map(normalizePath).filter(Boolean))].filter((p) => !have.has(p)).sort();
}

/** A lease's recorded reach; one recorded before AA.5 reaches the whole node. */
export function reachOf(meta: Record<string, unknown> | null | undefined): string[] {
  const r = meta?.reach;
  return Array.isArray(r) && r.length > 0 ? r.map(String) : [WHOLE_NODE];
}

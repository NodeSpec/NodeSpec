// B1 (docs/WORK_LOOP_PLAN.md) · `.nodespec/bindings.json` — the AI's
// declaration channel for files it created out of band.
//
// WHY THIS IS NOT A MANIFEST MIRROR. `.nodespec/model.json` already records
// every file-backed artifact as { id, nodeId, path, kind, contentHash } — it
// is generated on every push, committed, and hash-verified. A second file
// restating path→node would be a duplicate source of truth that can disagree
// with the first, which is exactly the divergence this project refuses.
//
// The genuine gap is one-directional: model.json is generated FROM the canvas,
// so a file the AI just wrote is not in it yet and nothing in git says which
// node owns it — the only way to bind it today is a proposal round-trip.
// bindings.json closes that gap as a HAND-OFF, not a mirror:
//
//   · the AI APPENDS an entry when it creates a file (one line in the skill,
//     zero extra tool calls — it is already writing files in that commit);
//   · NodeSpec CONSUMES entries on push, binds the artifacts, and the next
//     generated model.json carries them permanently;
//   · a consumed entry is therefore transient — the file trends back to empty.
//
// Already-bound paths never appear here: model.json owns them from then on.
// This module is pure parse/validate/normalize; B3 wires the consumption.

import { ARTIFACT_KIND_VALUES } from "./enums.ts";

/**
 * Kinds an AI may DECLARE — deliberately narrower than ARTIFACT_KIND_VALUES.
 * `task` and `test-plan` are generator-owned, and the evidence lanes parse
 * checkbox state out of task-kind artifacts (R5/A4): letting a declaration
 * mint a task-kind binding would let a hand-authored file's checkboxes read
 * as criterion/task evidence. The skill documents exactly this six-kind list;
 * the parser must refuse what the skill promises it refuses.
 */
export const DECLARABLE_KINDS = ARTIFACT_KIND_VALUES.filter(
  (k) => k !== "task" && k !== "test-plan",
);

export const BINDINGS_PATH = ".nodespec/bindings.json";
export const BINDINGS_VERSION = 1;

/** Cap: a declaration file is a hand-off queue, not a repository index. */
const MAX_ENTRIES = 500;
const MAX_PATH_LENGTH = 400;

export interface BindingDeclaration {
  /** Repo-relative path, leading slash stripped. */
  path: string;
  /** Node UUID or label — resolved against the live graph at consumption. */
  node: string;
  kind: string;
  language?: string;
  description?: string;
}

export interface BindingParseResult {
  entries: BindingDeclaration[];
  /** Rejected rows, surfaced to the card — never silently dropped. */
  flagged: Array<{ reason: string; detail: string }>;
}

const VALID_KINDS = new Set<string>(DECLARABLE_KINDS);

function normalizePath(raw: string): string {
  return raw.trim().replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Parse `.nodespec/bindings.json`. Tolerant of an absent/empty file (the
 * normal state) and of both shapes an AI plausibly writes: the documented
 * `{version, bindings: [...]}` envelope, or a bare array.
 *
 * Every rejection is REPORTED, never inferred away — a malformed entry must
 * be visible to the user, not quietly skipped, or the AI never learns the
 * declaration failed and the file silently rots.
 */
export function parseBindingManifest(raw: string | null | undefined): BindingParseResult {
  const result: BindingParseResult = { entries: [], flagged: [] };
  if (!raw || raw.trim().length === 0) return result;

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    result.flagged.push({
      reason: "invalid-json",
      detail: `${BINDINGS_PATH} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
    return result;
  }

  const rows = Array.isArray(doc)
    ? doc
    : (doc && typeof doc === "object" && Array.isArray((doc as Record<string, unknown>).bindings))
      ? ((doc as Record<string, unknown>).bindings as unknown[])
      : null;
  if (!rows) {
    result.flagged.push({
      reason: "invalid-shape",
      detail: `${BINDINGS_PATH} must be {"version":${BINDINGS_VERSION},"bindings":[…]} or a bare array`,
    });
    return result;
  }

  if (rows.length > MAX_ENTRIES) {
    result.flagged.push({
      reason: "too-many-entries",
      detail: `${rows.length} declarations exceeds the ${MAX_ENTRIES} cap; only the first ${MAX_ENTRIES} are read`,
    });
  }

  const seen = new Set<string>();
  for (const row of rows.slice(0, MAX_ENTRIES)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      result.flagged.push({ reason: "invalid-entry", detail: "declaration is not an object" });
      continue;
    }
    const entry = row as Record<string, unknown>;

    const rawPath = typeof entry.path === "string" ? normalizePath(entry.path) : "";
    if (!rawPath) {
      result.flagged.push({ reason: "missing-path", detail: JSON.stringify(entry).slice(0, 120) });
      continue;
    }
    if (rawPath.length > MAX_PATH_LENGTH) {
      result.flagged.push({ reason: "path-too-long", detail: rawPath.slice(0, 80) + "…" });
      continue;
    }
    // A declaration may not reach outside the repo or claim NodeSpec's own
    // generated files — those are ours to write, never bindable by hand.
    // Segment check, not substring: `src/foo..bar.ts` is a legal filename.
    if (rawPath.split("/").some((segment) => segment === "..")) {
      result.flagged.push({ reason: "path-escape", detail: rawPath });
      continue;
    }
    if (rawPath.startsWith(".nodespec/")) {
      result.flagged.push({
        reason: "reserved-path",
        detail: `${rawPath} is NodeSpec-generated; it is bound by the generator, not by declaration`,
      });
      continue;
    }

    // `node` is the AI-facing key; `nodeId` accepted as a synonym because the
    // rest of the tool surface names it that way.
    const nodeRef = typeof entry.node === "string" && entry.node.trim()
      ? entry.node.trim()
      : typeof entry.nodeId === "string" && entry.nodeId.trim()
        ? entry.nodeId.trim()
        : "";
    if (!nodeRef) {
      result.flagged.push({ reason: "missing-node", detail: rawPath });
      continue;
    }

    const kind = typeof entry.kind === "string" ? entry.kind.trim() : "source";
    if (!VALID_KINDS.has(kind)) {
      result.flagged.push({
        reason: "invalid-kind",
        detail: `${rawPath}: kind "${kind}" is not one of ${DECLARABLE_KINDS.join(", ")}`,
      });
      continue;
    }

    if (seen.has(rawPath)) {
      result.flagged.push({ reason: "duplicate-path", detail: rawPath });
      continue;
    }
    seen.add(rawPath);

    result.entries.push({
      path: rawPath,
      node: nodeRef,
      kind,
      ...(typeof entry.language === "string" && entry.language.trim()
        ? { language: entry.language.trim() }
        : {}),
      ...(typeof entry.description === "string" && entry.description.trim()
        ? { description: entry.description.trim() }
        : {}),
    });
  }

  return result;
}

export interface ResolvedBinding extends BindingDeclaration {
  /** The live node UUID the declaration resolved to. */
  nodeId: string;
}

export interface BindingResolution {
  bind: ResolvedBinding[];
  /** Declarations for paths the graph already binds — the hand-off is done. */
  alreadyBound: BindingDeclaration[];
  flagged: Array<{ reason: string; detail: string }>;
}

/**
 * Resolve declarations against the live graph.
 *
 * A `node` may be a UUID or a label (the same either-or every MCP tool
 * accepts). An unknown node is FLAGGED, never created: bindings.json declares
 * where an existing component's file lives, and must never become a back door
 * for authoring architecture — that is the proposal flow's job.
 *
 * An ambiguous label (two nodes share it) is also flagged: guessing which
 * component owns a file is exactly the inference this project refuses.
 */
export function resolveBindings(
  parsed: BindingParseResult,
  graph: {
    nodes?: Record<string, { id: string; label?: string }>;
    artifacts?: Record<string, { path?: string }>;
  },
): BindingResolution {
  const resolution: BindingResolution = {
    bind: [],
    alreadyBound: [],
    flagged: [...parsed.flagged],
  };

  const nodes = Object.values(graph.nodes ?? {});
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byLabel = new Map<string, Array<{ id: string }>>();
  for (const n of nodes) {
    const label = (n.label ?? "").trim().toLowerCase();
    if (!label) continue;
    const list = byLabel.get(label) ?? [];
    list.push(n);
    byLabel.set(label, list);
  }

  const boundPaths = new Set(
    Object.values(graph.artifacts ?? {})
      .map((a) => (typeof a?.path === "string" ? normalizePath(a.path) : ""))
      .filter((p) => p.length > 0),
  );

  for (const entry of parsed.entries) {
    if (boundPaths.has(entry.path)) {
      resolution.alreadyBound.push(entry);
      continue;
    }

    const direct = byId.get(entry.node);
    if (direct) {
      resolution.bind.push({ ...entry, nodeId: direct.id });
      continue;
    }
    const matches = byLabel.get(entry.node.toLowerCase()) ?? [];
    if (matches.length === 1) {
      resolution.bind.push({ ...entry, nodeId: matches[0].id });
      continue;
    }
    resolution.flagged.push({
      reason: matches.length > 1 ? "ambiguous-node" : "unknown-node",
      detail: matches.length > 1
        ? `${entry.path}: "${entry.node}" matches ${matches.length} nodes — declare the node id instead`
        : `${entry.path}: no node "${entry.node}" in this branch's model`,
    });
  }

  return resolution;
}

/**
 * B3 push-side clearing — the bind-then-clear invariant: an entry leaves the
 * file ONLY when its path is actually bound in the graph being pushed. An
 * unresolved or not-yet-consumed declaration is never dropped, so a failed
 * bind can never silently lose a declaration.
 *
 * The caller must also skip the rewrite entirely when the parse produced
 * flagged rows: a malformed row is invisible to this function (the parser
 * rejected it), and rewriting from the parsed entries would silently delete
 * it before the author ever saw the flag.
 */
export function computeRemainingBindings(
  parsed: BindingParseResult,
  boundPaths: ReadonlySet<string>,
): { remaining: BindingDeclaration[]; consumed: BindingDeclaration[] } {
  const remaining: BindingDeclaration[] = [];
  const consumed: BindingDeclaration[] = [];
  for (const entry of parsed.entries) {
    if (boundPaths.has(entry.path)) consumed.push(entry);
    else remaining.push(entry);
  }
  return { remaining, consumed };
}

/** One-line human summary for a change card. */
export function summarizeBindings(resolution: BindingResolution): string {
  const parts: string[] = [];
  if (resolution.bind.length > 0) {
    parts.push(`${resolution.bind.length} file(s) declared for binding`);
  }
  if (resolution.alreadyBound.length > 0) {
    parts.push(`${resolution.alreadyBound.length} already bound`);
  }
  if (resolution.flagged.length > 0) {
    parts.push(`${resolution.flagged.length} declaration issue(s)`);
  }
  return parts.join(" · ");
}

/**
 * Render the file NodeSpec writes back after consuming declarations. Consumed
 * entries are removed; anything still unresolved stays so the user and the AI
 * can see what did not bind. An empty queue renders the documented empty
 * envelope rather than deleting the file — a present, empty file teaches the
 * shape better than an absent one.
 */
export function renderBindingManifest(remaining: BindingDeclaration[]): string {
  return JSON.stringify(
    {
      version: BINDINGS_VERSION,
      // Guidance travels WITH the file: an AI that opens it learns the
      // contract without reading the skill.
      note: "Declare files you create so NodeSpec can bind them to their component on push. Entries are consumed and removed automatically; already-bound files live in .nodespec/model.json.",
      bindings: remaining.map((b) => ({
        path: b.path,
        node: b.node,
        kind: b.kind,
        ...(b.language ? { language: b.language } : {}),
        ...(b.description ? { description: b.description } : {}),
      })),
    },
    null,
    2,
  ) + "\n";
}

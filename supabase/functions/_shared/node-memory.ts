// AA.7 (owner 2026-09-23): memory on the node. No new table.
//
// What the project already records about one node, as one list, newest
// first, each entry with who, which proposal and which commit:
//
//   decision  an accepted proposal's patch on the node, with its explanation
//   change    a person's own edit to it (layout moves left out)
//   handoff   the note a lease's holder left when it let the work go
//   learning  the task document's authored Implementation Context
//   proven    a criterion of its requirements a test proved, at a commit
//
// The database gathers the first four kinds but learnings (node_memory,
// migration 20260923210000); the task document supplies the learning and the
// fingerprints it has carried. An entry is flagged for review when the
// node's fingerprint flipped after it: a note (hand-off) when the context
// changed after it was written; a decision or change when the context
// changed again after the packet took it in; a learning when the task
// document marks it REVIEW NEEDED; a proof when its evidence went stale.
//
// Pure. The app keeps a byte-identical copy from the first export on
// (src/ui/utils/node-memory.ts): the rail's History section and the node's
// context read the same memory.

export const IMPLEMENTATION_CONTEXT_HEADING = "## Implementation Context";
export const IMPLEMENTATION_CONTEXT_PLACEHOLDER = "_Not yet authored._";
export const IMPLEMENTATION_CONTEXT_REVIEW_PREFIX = "> ⚠ REVIEW NEEDED";
export const FINGERPRINT_HISTORY_MAX = 12;
const TEXT_MAX = 280;

export interface RawDecision { proposalId: string; at: string; who: string | null; explanations: string[]; explanationCount?: number; intents: Array<{ kind?: string; summary?: string }>; commit: string | null }
export interface RawChange { patchId: string; at: string; actorId: string | null; summary: string | null; type: string; commit: string | null }
export interface RawHandoff { checkoutId: string; at: string; who: string | null; level: string; reason: string | null; note: string; proposalId: string | null; commit: string | null }
export interface RawProven { requirementId: string; text: string; testCaseId: string | null; source: string | null; at: string | null; commit: string | null; evidenceStale: boolean }
export interface RawNodeMemory { decisions: RawDecision[]; changes: RawChange[]; handoffs: RawHandoff[]; proven: RawProven[] }

export type MemoryKind = "decision" | "change" | "handoff" | "learning" | "proven";

export interface MemoryEntry {
  kind: MemoryKind;
  /** When it happened; null for the learning, which stands until rewritten. */
  at: string | null;
  who: string | null;
  text: string;
  proposalId?: string;
  commit?: string;
  /** Why it needs a second look; absent when it still holds. */
  review?: string;
}

export interface FingerprintMark { fingerprint: string; since: string }

export interface NodeMemory {
  entries: MemoryEntry[];
  flagged: number;
  /** When the node's fingerprint last flipped, or null. */
  contextChangedAt: string | null;
}

const clip = (s: string, max = TEXT_MAX) => (s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s);
/** Item 27: a decision carries its first reasons and how many there were; the
 *  line says how many it does not show, and that survives the clip. */
function decisionText(d: RawDecision): string {
  const shown = (d.explanations ?? []).filter(Boolean);
  const more = Math.max(0, (typeof d.explanationCount === "number" ? d.explanationCount : shown.length) - shown.length);
  const why = shown.join("; ") || (d.intents ?? []).map((i) => i.summary).filter(Boolean).join("; ") || "Accepted.";
  if (more === 0) return clip(why);
  const tail = `; and ${more} more`;
  return `${clip(why, TEXT_MAX - tail.length)}${tail}`;
}
const time = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
};
const day = (s: string) => s.slice(0, 10);

/** The fingerprints a task document has carried, oldest first, each with
 *  since when. A document written before the history existed knows one. */
export function fingerprintHistory(meta: Record<string, unknown> | null | undefined): FingerprintMark[] {
  const list = Array.isArray(meta?.fingerprintHistory)
    ? (meta!.fingerprintHistory as unknown[]).filter((m): m is FingerprintMark =>
      !!m && typeof (m as FingerprintMark).fingerprint === "string" && typeof (m as FingerprintMark).since === "string")
    : [];
  if (list.length > 0) return list;
  const current = meta?.taskContextFingerprint as { fingerprint?: unknown; timestamp?: unknown } | undefined;
  return typeof current?.fingerprint === "string" && typeof current.timestamp === "string"
    ? [{ fingerprint: current.fingerprint, since: current.timestamp }]
    : [];
}

/** A task document's metadata after a (re)generation: the new fingerprint,
 *  and the history grown by one only when the fingerprint flipped. */
export function recordFingerprint(
  meta: Record<string, unknown> | null | undefined,
  fp: { fingerprint: string; timestamp: string },
): Record<string, unknown> {
  const history = fingerprintHistory(meta);
  const last = history[history.length - 1];
  const next = last && last.fingerprint === fp.fingerprint
    ? history
    : [...history, { fingerprint: fp.fingerprint, since: fp.timestamp }].slice(-FINGERPRINT_HISTORY_MAX);
  return { ...(meta ?? {}), taskContextFingerprint: fp, fingerprintHistory: next };
}

/** The authored Implementation Context, or null while it is the placeholder. */
export function learningOf(content: unknown): { text: string; review: boolean } | null {
  if (typeof content !== "string" || !content) return null;
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trim() === IMPLEMENTATION_CONTEXT_HEADING);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^## (?!#)/.test(lines[i])) { end = i; break; }
  const body = lines.slice(start + 1, end);
  if (body.join("\n").includes(IMPLEMENTATION_CONTEXT_PLACEHOLDER)) return null;
  const review = body.some((l) => l.trim().startsWith(IMPLEMENTATION_CONTEXT_REVIEW_PREFIX));
  const text = body.filter((l) => !l.trim().startsWith("<!--") && !l.trim().startsWith(IMPLEMENTATION_CONTEXT_REVIEW_PREFIX)).join("\n").trim();
  return text ? { text, review } : null;
}

/** The node's memory: the database's entries, the task document's learning,
 *  and the review flags from the fingerprints it has carried. Pure. */
export function nodeMemory(
  raw: RawNodeMemory | null | undefined,
  taskDoc: { content?: unknown; metadata?: Record<string, unknown> | null } | null | undefined,
  opts: { you?: string | null } = {},
): NodeMemory {
  const history = fingerprintHistory(taskDoc?.metadata ?? null);
  const flips = history.slice(1).map((h) => h.since).filter((s) => time(s) !== null);
  const contextChangedAt = flips.length > 0 ? flips[flips.length - 1] : null;
  const flippedAfter = (at: string | null) => {
    const t = time(at);
    return t === null ? null : flips.find((f) => time(f)! > t) ?? null;
  };
  // A change is taken in by the first fingerprint at or after it; a second
  // one after that means the context moved on without it.
  const movedOnAfter = (at: string | null) => {
    const t = time(at);
    if (t === null) return null;
    const since = history.filter((h) => (time(h.since) ?? -Infinity) >= t);
    return since.length >= 2 ? since[1].since : null;
  };

  const entries: MemoryEntry[] = [];
  const learning = learningOf(taskDoc?.content);
  if (learning) {
    entries.push({
      kind: "learning", at: null, who: null, text: clip(learning.text),
      ...(learning.review ? { review: "The task document's derived sections changed after this was written: re-verify it." } : {}),
    });
  }
  const events: MemoryEntry[] = [];
  for (const d of raw?.decisions ?? []) {
    const moved = movedOnAfter(d.at);
    events.push({
      kind: "decision", at: d.at, who: d.who ?? null, text: decisionText(d), proposalId: d.proposalId,
      ...(d.commit ? { commit: d.commit } : {}),
      ...(moved ? { review: `The node's context changed again after this was taken in (${day(moved)}).` } : {}),
    });
  }
  for (const c of raw?.changes ?? []) {
    const moved = movedOnAfter(c.at);
    events.push({
      kind: "change", at: c.at, who: c.actorId && opts.you && c.actorId === opts.you ? "you" : "a person",
      text: clip(c.summary || c.type), ...(c.commit ? { commit: c.commit } : {}),
      ...(moved ? { review: `The node's context changed again after this was taken in (${day(moved)}).` } : {}),
    });
  }
  for (const h of raw?.handoffs ?? []) {
    const flipped = flippedAfter(h.at);
    events.push({
      kind: "handoff", at: h.at, who: h.who ?? null, text: clip(h.note),
      ...(h.proposalId ? { proposalId: h.proposalId } : {}), ...(h.commit ? { commit: h.commit } : {}),
      ...(flipped ? { review: `The node's context changed after this note was left (${day(flipped)}).` } : {}),
    });
  }
  for (const p of raw?.proven ?? []) {
    events.push({
      kind: "proven", at: p.at ?? null, who: null, text: clip(`${p.requirementId}: ${p.text}`),
      ...(p.commit ? { commit: p.commit } : {}),
      ...(p.evidenceStale ? { review: "The criterion changed after this test proved it." } : {}),
    });
  }
  events.sort((a, b) => (time(b.at) ?? 0) - (time(a.at) ?? 0));
  entries.push(...events);
  return { entries, flagged: entries.filter((e) => e.review).length, contextChangedAt };
}

/** The database's answer, read defensively. */
export function rawNodeMemory(value: unknown): RawNodeMemory {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const list = <T>(k: string) => (Array.isArray(v[k]) ? (v[k] as T[]).filter((x) => !!x && typeof x === "object") : []);
  return { decisions: list<RawDecision>("decisions"), changes: list<RawChange>("changes"), handoffs: list<RawHandoff>("handoffs"), proven: list<RawProven>("proven") };
}

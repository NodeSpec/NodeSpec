// AA.1 (owner 2026-09-23): the vision as sentences an outcome can cite.
//
// "Having vision with zero downstream provenance makes the field and data
// useless." So the vision is split into sentences, each with a stable id (a
// hash of its normalized text, the criterion-identity pattern), and every
// outcome cites the sentence or sentences it serves. The citation is stored
// on the outcome (`requirement_candidates.evidence.serves`, no column) as
// `{ id, text }`: the id is what the chain checks, the text is what the
// sentence said when it was cited, so a vision edit that drops or rewords
// it can say which one the outcome lost.
//
// An id survives edits that do not change the words: case, spacing, emphasis
// and trailing punctuation. Rewording a sentence makes it a new sentence;
// the outcomes that cited the old one read as off vision until they cite
// again, which is the "marks for review" the board asks for, derived rather
// than written.
//
// Pure and dependency-free past fnv1a32. The app mirrors this file byte for
// byte from the first export on (src/ui/utils/vision-sentences.ts,
// cross-pinned), so a sentence picked in the browser carries the id the
// server checks.
import { fnv1a32 } from "./criterion-identity.ts";

export interface VisionSentence { id: string; text: string }

/** What a sentence's id hashes: lower case, one space, no emphasis marks, no trailing punctuation. */
export function normalizeVisionSentence(text: string): string {
  return String(text ?? "")
    .replace(/[*_`]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\s.!?;:,]+$/, "")
    .toLowerCase();
}

/** The id a sentence answers to: `v:` and 8 hex of its normalized text. */
export function visionSentenceId(text: string): string {
  return `v:${fnv1a32(normalizeVisionSentence(text))}`;
}

export const VISION_SENTENCE_ID = /^v:[0-9a-f]{8}$/;

/**
 * The vision's sentences, in order, each once. Lines are read one by one;
 * headings and rules are skipped, a list marker is dropped, and a line
 * splits after `.`, `!` or `?` when the next word starts a sentence.
 */
export function visionSentences(vision: string | null | undefined): VisionSentence[] {
  const out: VisionSentence[] = [];
  const seen = new Set<string>();
  for (const raw of String(vision ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line) || /^([-*_])\1{2,}$/.test(line)) continue;
    const body = line.replace(/^(?:[-*+•]\s+|\d+[.)]\s+|>\s*)/, "");
    const pieces = body.replace(/([.!?])\s+(?=["'“‘(\[]?[A-Z0-9])/g, "$1\n").split("\n");
    for (const piece of pieces) {
      const text = piece.trim().replace(/\s+/g, " ");
      if (normalizeVisionSentence(text).length === 0) continue;
      const id = visionSentenceId(text);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, text });
    }
  }
  return out;
}

/**
 * Resolve what an outcome says it serves against the current vision. Each
 * ref is a sentence id (`v:1a2b3c4d`) or the sentence's words (matched after
 * normalizing). Order follows the refs; repeats collapse. `unknown` keeps
 * the refs that name no sentence of this vision, as given.
 */
export function resolveServes(refs: string[], sentences: VisionSentence[]): { served: VisionSentence[]; unknown: string[] } {
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const byText = new Map(sentences.map((s) => [normalizeVisionSentence(s.text), s]));
  const served: VisionSentence[] = [];
  const unknown: string[] = [];
  const taken = new Set<string>();
  for (const ref of refs) {
    const r = String(ref ?? "").trim();
    if (!r) continue;
    const hit = VISION_SENTENCE_ID.test(r) ? byId.get(r) : byText.get(normalizeVisionSentence(r));
    if (!hit) { unknown.push(r); continue; }
    if (taken.has(hit.id)) continue;
    taken.add(hit.id);
    served.push(hit);
  }
  return { served, unknown };
}

/** The citations stored on an outcome's evidence. Tolerates a bare id list and a missing key. */
export function servesOf(evidence: unknown): VisionSentence[] {
  const list = (evidence && typeof evidence === "object") ? (evidence as { serves?: unknown }).serves : undefined;
  if (!Array.isArray(list)) return [];
  const out: VisionSentence[] = [];
  for (const item of list) {
    if (typeof item === "string" && VISION_SENTENCE_ID.test(item)) out.push({ id: item, text: "" });
    else if (item && typeof item === "object" && typeof (item as VisionSentence).id === "string") {
      out.push({ id: (item as VisionSentence).id, text: String((item as VisionSentence).text ?? "") });
    }
  }
  return out;
}

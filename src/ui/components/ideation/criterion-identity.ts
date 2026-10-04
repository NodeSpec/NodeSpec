// Criterion identity — the APP mirror of
// supabase/functions/_shared/criterion-identity.ts (R5, pinned semantics
// "Criterion identity"). The pure section below is byte-identical to the
// Deno file and cross-pinned in derivation-composer.test.ts, so a claim
// computed in the browser resolves to the same id the server resolves.
// Written ids are uuid8 minted at draft time; rows drafted before v3l
// answer to 'h' + FNV-1a-32 of their normalized text.

export interface IdentifiedCriterion { id: string; text: string; verification?: string }

/** FNV-1a, 32-bit, as 8 lowercase hex chars. */
export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const normalizeCriterionText = (t: unknown): string => String(t ?? "").trim().replace(/\s+/g, " ");

/** The id a stored criterion answers to: its written id, else its text hash. */
export function criterionIdOf(c: { id?: unknown; text?: unknown }): string {
  return typeof c.id === "string" && c.id.length > 0 ? c.id : `h${fnv1a32(normalizeCriterionText(c.text))}`;
}

export const newCriterionId = (): string => crypto.randomUUID().slice(0, 8);

type CriterionInput = string | { id?: string; text: string; verification?: string };

/** Normalize an input list to identified criteria (blank text drops).
 *  Ids that arrive survive; a criterion without one takes the id of the
 *  existing criterion with the same text (keeps claims stable across a
 *  re-save of a legacy row), else a fresh uuid8. */
export function identifyCriteria(
  input: CriterionInput[] | undefined,
  existing: Array<{ id?: unknown; text?: unknown }> = [],
): IdentifiedCriterion[] {
  const byText = new Map<string, string>();
  for (const e of existing) {
    const t = normalizeCriterionText(e.text);
    if (t && !byText.has(t)) byText.set(t, criterionIdOf(e));
  }
  const out: IdentifiedCriterion[] = [];
  for (const raw of input ?? []) {
    const obj = typeof raw === "string" ? { text: raw } : raw;
    const text = normalizeCriterionText(obj.text);
    if (!text) continue;
    const id = typeof obj.id === "string" && obj.id.length > 0 ? obj.id : (byText.get(text) ?? newCriterionId());
    out.push({ id, text, ...(obj.verification ? { verification: obj.verification } : {}) });
  }
  return out;
}

/** Read a stored criteria array as identified criteria (no minting). */
export function identifiedFromRow(stored: unknown): IdentifiedCriterion[] {
  if (!Array.isArray(stored)) return [];
  const out: IdentifiedCriterion[] = [];
  for (const c of stored as Array<{ id?: unknown; text?: unknown; verification?: unknown }>) {
    const text = normalizeCriterionText(c?.text);
    if (!text) continue;
    out.push({ id: criterionIdOf(c), text, ...(typeof c.verification === "string" && c.verification ? { verification: c.verification } : {}) });
  }
  return out;
}

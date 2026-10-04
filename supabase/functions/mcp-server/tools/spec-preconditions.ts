// V3 P2 (task 2.7): multi-agent preconditions on the spec plane — the
// graph vocabulary's hash_match | value_exists | value_equals, evaluated
// against the CURRENT database row before a spec patch applies. Stale
// proposals and overlapping level-2 writes fail LOUDLY, naming the path
// and the current state — never last-write-wins.
//
// Enforcement points (both by construction, one evaluator):
// - applySpecPatch calls this first, so the approvals ACCEPT lane and the
//   router's propose→accept round trip are covered wherever they run.
// - routeToolCall's level-2 APPLY lane calls it before the handler when a
//   direct tool call carries `preconditions` args.
//
// SUPPORTED TYPES are a table, not taste: the ops whose target row exists
// before the patch does (update_requirement, delete_requirement,
// update_candidate, and since v3l promote_candidate / settle_candidate).
// A precondition on any other spec op is REFUSED, never silently ignored —
// a caller who asked for protection must never believe they have it when
// they don't. `updated_at` is the cheap optimistic-concurrency token:
// value_equals on it guards the whole row — too coarse for a derivation,
// where two agents claiming DISJOINT criteria slices must not collide:
// there, hash_match the claimed texts by criterion id.
//
// Evaluation semantics (pinned):
// - path: dot-walk from the row ('name', 'updated_at', 'criteria.0.text');
//   an array segment may address an element by id — 'criteria[id=3fa9c2d1].text'
//   (a written id, or the text-hash id a legacy criterion answers to).
// - value_exists: the value is present and non-null (expected is ignored).
// - value_equals: exact-serialization equality (JSON.stringify both sides)
//   — primitives compare naturally; object key order matters, documented.
// - hash_match: expected is the sha256 hex of the value's canonical string
//   (string values hashed as-is, everything else JSON.stringify'd).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { SpecPatchOperation } from "../../_shared/spec-patch-schema.ts";
import { criterionIdOf } from "../../_shared/criterion-identity.ts";
import { resolveSpecForProject } from "./requirements.ts";

export interface SpecPrecondition {
  type: "hash_match" | "value_exists" | "value_equals";
  path: string;
  expected?: unknown;
}

export type PreconditionCheck = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ops that accept preconditions — rows, not branches. */
export const PRECONDITION_TYPES: ReadonlySet<string> = new Set([
  "update_requirement",
  "delete_requirement",
  "update_candidate",
  "promote_candidate",
  "attach_candidate",
  "settle_candidate",
]);

const CANDIDATE_TARGETED: ReadonlySet<string> = new Set(["update_candidate", "promote_candidate", "attach_candidate", "settle_candidate"]);

const ID_SEGMENT = /^([A-Za-z_][A-Za-z0-9_]*)\[id=([^\]]+)\]$/;

export function preconditionsOf(patch: SpecPatchOperation): SpecPrecondition[] {
  const meta = patch.metadata as { preconditions?: unknown };
  return Array.isArray(meta.preconditions) ? (meta.preconditions as SpecPrecondition[]) : [];
}

export function readPath(row: Record<string, unknown>, path: string): unknown {
  let cur: unknown = row;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    const byId = ID_SEGMENT.exec(seg);
    if (byId) {
      const list = (cur as Record<string, unknown>)[byId[1]];
      if (!Array.isArray(list)) return undefined;
      cur = list.find((el) => el && typeof el === "object" && criterionIdOf(el as { id?: unknown; text?: unknown }) === byId[2]);
      continue;
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

const canonical = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v) ?? "");

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const describe = (v: unknown): string => {
  if (v === undefined) return "absent";
  const s = canonical(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
};

/** Evaluate one precondition list against a live row. First failure wins
 *  and its message names the path and the current state — the caller's
 *  remediation is always the same: re-read, re-draft, re-submit. */
export async function evaluatePreconditions(
  row: Record<string, unknown>,
  preconditions: SpecPrecondition[],
): Promise<PreconditionCheck> {
  for (const pre of preconditions) {
    if (!pre || typeof pre.path !== "string" || pre.path.length === 0) {
      return { ok: false, error: "Precondition malformed: every precondition needs a non-empty path." };
    }
    const current = readPath(row, pre.path);
    switch (pre.type) {
      case "value_exists": {
        if (current === undefined || current === null) {
          return {
            ok: false,
            error: `Precondition failed (value_exists on "${pre.path}"): the value is ${describe(current)}. ` +
              `The row changed since this patch was drafted — re-read it and re-submit.`,
          };
        }
        break;
      }
      case "value_equals": {
        if (JSON.stringify(current) !== JSON.stringify(pre.expected)) {
          return {
            ok: false,
            error: `Precondition failed (value_equals on "${pre.path}"): expected ${describe(pre.expected)} ` +
              `but the current value is ${describe(current)}. The row changed since this patch was drafted — ` +
              `re-read it and re-submit against the current state.`,
          };
        }
        break;
      }
      case "hash_match": {
        const actual = await sha256Hex(canonical(current));
        if (actual !== String(pre.expected ?? "").toLowerCase()) {
          return {
            ok: false,
            error: `Precondition failed (hash_match on "${pre.path}"): the current value hashes to ${actual}, ` +
              `not the expected ${describe(pre.expected)}. The row changed since this patch was drafted — ` +
              `re-read it and re-submit against the current state.`,
          };
        }
        break;
      }
      default:
        return { ok: false, error: `Precondition malformed: unknown type "${(pre as { type?: unknown }).type}".` };
    }
  }
  return { ok: true };
}

/** Resolve the patch's target row and evaluate its preconditions. No
 *  preconditions → ok without a read. Preconditions on an unsupported op
 *  refuse loudly; a target row that no longer exists IS a failed
 *  precondition (the strongest possible staleness). */
export async function checkSpecPreconditions(
  supabase: SupabaseClient,
  projectId: string,
  patch: SpecPatchOperation,
  /** V3 2.4: the router already resolved the requirement row for the
   *  ladder; hand it in so the same row is judged and nothing is read twice. */
  preloaded?: { spec: { id: string } | null; row: Record<string, unknown> | null },
): Promise<PreconditionCheck> {
  const preconditions = preconditionsOf(patch);
  if (preconditions.length === 0) return { ok: true };

  if (!PRECONDITION_TYPES.has(patch.type)) {
    return {
      ok: false,
      error: `Preconditions are not supported on ${patch.type} — they guard rows that exist before the patch does ` +
        `(update_requirement, delete_requirement, update_candidate, promote_candidate, attach_candidate, settle_candidate). Remove them, or target one of those ops.`,
    };
  }

  let row: Record<string, unknown> | null = null;
  let label = "";
  if (CANDIDATE_TARGETED.has(patch.type)) {
    const candidateId = (patch.payload as { candidateId: string }).candidateId;
    const { data } = await supabase
      .from("requirement_candidates")
      .select("*")
      .eq("id", candidateId)
      .eq("project_id", projectId)
      .maybeSingle();
    row = (data as Record<string, unknown> | null) ?? null;
    label = `candidate ${candidateId}`;
  } else if (patch.type === "update_requirement" || patch.type === "delete_requirement") {
    const spec = preloaded ? preloaded.spec : await resolveSpecForProject(supabase, projectId);
    if (!spec) {
      return { ok: false, error: "Precondition failed: this project has no specification — the target row cannot exist." };
    }
    const ref = patch.payload.requirementId;
    if (preloaded) {
      row = preloaded.row;
    } else {
      const column = UUID_RE.test(ref) ? "id" : "requirement_id";
      const { data } = await supabase
        .from("specification_requirements")
        .select("*")
        .eq("specification_id", spec.id)
        .eq(column, ref)
        .maybeSingle();
      row = (data as Record<string, unknown> | null) ?? null;
    }
    label = `requirement ${ref}`;
  } else {
    // Unreachable: PRECONDITION_TYPES gates above. Kept exhaustive for TS.
    return { ok: false, error: `Preconditions are not supported on ${patch.type}.` };
  }

  if (!row) {
    return {
      ok: false,
      error: `Precondition failed: ${label} no longer exists in this project — ` +
        `the row was deleted since this patch was drafted.`,
    };
  }
  return evaluatePreconditions(row, preconditions);
}

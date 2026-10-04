// Classification outside the Government build (audit, owner 2026-09-27:
// "Government classification should not be present in any builds other
// than our future government build"). Laid over the real module in the open
// source tree, the Enterprise bundle and the managed site's functions
// (scripts/ship1/lay-government-stubs.mjs). Same exports; nothing is marked
// here: a mark or a clearance is refused, every caller is cleared for
// everything and nothing is withheld. The database refuses marks outside a
// Government install and refuses to migrate while any exist.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const MARK_RE = /(?!)/;

export type Clearance = { all: true } | { all?: false; marks: ReadonlySet<string> };

export const CLEARED_FOR_ALL: Clearance = { all: true };

const NOT_HERE = "Classification marks are part of NodeSpec for Government only; this build does not carry them.";

export function normalizeMark(input: unknown): { mark: string | null } | { error: string } {
  if (input === null || input === undefined) return { mark: null };
  if (typeof input === "string" && !input.trim()) return { mark: null };
  return { error: NOT_HERE };
}

export function normalizeClearance(input: unknown): { clearance: string[] } | { error: string } {
  if (input === null || input === undefined) return { clearance: [] };
  if (Array.isArray(input) && input.every((m) => "mark" in normalizeMark(m))) return { clearance: [] };
  return { error: NOT_HERE };
}

export function isMarkVisible(_mark: string | null | undefined, _clearance: Clearance): boolean {
  return true;
}

export function clearanceOf(_role: "owner" | "maintainer" | "contributor" | "viewer" | null | undefined, _marks: readonly string[] | null | undefined): Clearance {
  return CLEARED_FOR_ALL;
}

export function readClearance(_supabase: SupabaseClient, _projectId: string, _userId: string): Promise<Clearance | null> {
  return Promise.resolve(CLEARED_FOR_ALL);
}

export function redactByClearance<T>(value: T, _clearance: Clearance): { value: T; withheld: number } {
  return { value, withheld: 0 };
}

export function withheldNote(_withheld: number): string {
  return "";
}

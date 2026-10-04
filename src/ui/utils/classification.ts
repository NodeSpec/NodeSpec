// Classification outside the Government build (audit, owner 2026-09-27):
// laid over the real module by scripts/ship1/lay-government-stubs.mjs in
// every other build. Same exports; no mark is accepted and no banner is drawn.

export const MARK_RE = /(?!)/;

const NOT_HERE = 'Classification marks are part of NodeSpec for Government only; this build does not carry them.';

export function normalizeMark(input: unknown): { mark: string | null } | { error: string } {
  if (input === null || input === undefined) return { mark: null };
  if (typeof input === 'string' && !input.trim()) return { mark: null };
  return { error: NOT_HERE };
}

export function bannerText(_marks: readonly string[]): string | null {
  return null;
}

export function displayMark(mark: string): string {
  return mark;
}

export function withheldLabel(_withheld: number): string | null {
  return null;
}

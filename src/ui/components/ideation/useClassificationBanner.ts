// Classification outside the Government build (audit, owner 2026-09-27):
// laid over the real hook by scripts/ship1/lay-government-stubs.mjs in every
// other build. Same exports; no marks, nothing withheld, no database read.

export interface ClassificationSummary {
  marks: string[];
  withheld: number;
}

export const EMPTY_SUMMARY: ClassificationSummary = { marks: [], withheld: 0 };

const refresh = (): Promise<void> => Promise.resolve();

export function useClassificationBanner(_projectId: string | null | undefined, _dataVersion = 0): ClassificationSummary & { refresh: () => Promise<void> } {
  return { ...EMPTY_SUMMARY, refresh };
}

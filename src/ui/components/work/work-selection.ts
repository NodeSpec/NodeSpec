// V3 4.1 → 6.1: what Work has selected. A row is a requirement (its row
// id) or an outcome not yet a requirement (its outcome id); nothing
// selected on a workflow shows the workflow's own rail. The vision and
// the constraints are no longer selections: they sit above the All list
// with their acts (6.1).

export type WorkSelection =
  | { kind: 'lane' }
  | { kind: 'row'; identity: string; outcomeId: string; requirementRowId: string | null; stepIndex: number };

export const sameSelection = (a: WorkSelection, b: WorkSelection): boolean =>
  a.kind === b.kind && (a.kind !== 'row' || b.kind !== 'row' || a.identity === b.identity);

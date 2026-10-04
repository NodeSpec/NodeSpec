// V3 4.1 → 6.1: the Work view's tab vocabulary and its per-project
// persistence. Work is one of the two views (Work | Architecture); INSIDE
// it two tabs share one surface: Requirements (the list and the record,
// 6.1; grouped by a workflow's steps, 6.2) and Plan (the order of
// operations, 4.2 → 6.3). W (owner 2026-09-23) puts Workflows first, the
// 3D space the approved mockup draws (Indie and above, like Plan; below it
// neither tab shows and there is no tab bar at all). The Steps tab this
// replaced (4.1) read as an
// outcome-per-step board; the owner ruled (2026-09-21) that the daily
// chain is requirement → tasks → tests → code, so the list is requirements
// and the steps are a grouping of it.
//
// Pure module by design: normalization and key-building carry no DOM so
// they pin under the node test environment; the storage parameter is
// injectable for the same reason, defaulting to localStorage when the
// browser provides one and degrading to the default tab when it does not
// (private windows, blocked site data: never a crash).

export type WorkTab = 'workflows' | 'requirements' | 'plan';

export const WORK_TABS: readonly WorkTab[] = ['workflows', 'requirements', 'plan'];

export const DEFAULT_WORK_TAB: WorkTab = 'requirements';

export const WORK_TAB_LABEL: Record<WorkTab, string> = { workflows: 'Workflows', requirements: 'Requirements', plan: 'Plan' };

const STORAGE_PREFIX = 'nodespec_work_tab';

/** Anything that is not exactly a known tab falls back to the default. The
 *  retired words ('steps', 'workflow', 'trace', 'priority') land here too;
 *  'workflows' (plural) is the W tab. */
export function normalizeWorkTab(raw: unknown): WorkTab {
  return (WORK_TABS as readonly unknown[]).includes(raw) ? (raw as WorkTab) : DEFAULT_WORK_TAB;
}

/** Persisted PER PROJECT: two projects keep independent tabs; the
 *  projectless editor shares one anonymous slot. */
export function workTabStorageKey(projectId?: string | null): string {
  return projectId ? `${STORAGE_PREFIX}_${projectId}` : STORAGE_PREFIX;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadWorkTab(projectId?: string | null, storage: StorageLike | null = defaultStorage()): WorkTab {
  try {
    return normalizeWorkTab(storage?.getItem(workTabStorageKey(projectId)));
  } catch {
    return DEFAULT_WORK_TAB;
  }
}

export function saveWorkTab(tab: WorkTab, projectId?: string | null, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(workTabStorageKey(projectId), tab);
  } catch {
    // Persistence is a convenience. Losing it never breaks the switch.
  }
}

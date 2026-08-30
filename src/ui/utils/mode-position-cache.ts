const FLAT_POSITIONS_KEY = 'specgraph_flat_positions';
const NESTED_POSITIONS_KEY = 'specgraph_nested_positions';

export type PositionMode = 'flat' | 'nested';

export interface CachedPosition {
  x: number;
  y: number;
}

function storageKey(mode: PositionMode): string {
  return mode === 'flat' ? FLAT_POSITIONS_KEY : NESTED_POSITIONS_KEY;
}

export function saveModePositions(
  mode: PositionMode,
  positions: Map<string, CachedPosition>,
): void {
  try {
    const obj: Record<string, CachedPosition> = {};
    for (const [id, pos] of positions) {
      obj[id] = pos;
    }
    localStorage.setItem(storageKey(mode), JSON.stringify(obj));
  } catch {
    // storage full or unavailable
  }
}

export function loadModePositions(mode: PositionMode): Map<string, CachedPosition> {
  try {
    const raw = localStorage.getItem(storageKey(mode));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, CachedPosition>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function hasModePositions(mode: PositionMode): boolean {
  try {
    const raw = localStorage.getItem(storageKey(mode));
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}

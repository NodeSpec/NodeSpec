export interface ArchitectureTraceEntry {
  nodeId: string;
  label: string;
}

export function validateArchitectureTrace(raw: unknown): ArchitectureTraceEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is ArchitectureTraceEntry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.nodeId === 'string' &&
      typeof entry.label === 'string'
  );
}

export function validateOrderIndex(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 0;
  return n;
}

export function validateStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

export function validateJsonbArray(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw;
}

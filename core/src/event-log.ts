import type {
  PatchOperation,
  ActorType,
  Precondition,
  Branch,
} from './types.js';

export interface EventLogEntry {
  patchId: string;
  actorType: ActorType;
  summary: string;
  timestamp: string;
  patchType: string;
  preconditions?: Precondition[];
}

export function extractEventLog(patches: PatchOperation[]): EventLogEntry[] {
  return patches.map((patch) => ({
    patchId: patch.metadata.id,
    actorType: patch.metadata.actorType,
    summary: patch.metadata.summary,
    timestamp: patch.metadata.timestamp,
    patchType: patch.type,
    preconditions: patch.metadata.preconditions,
  }));
}

export function extractBranchEventLog(branch: Branch): EventLogEntry[] {
  return extractEventLog(branch.patches);
}

export function filterEventLogByActor(
  entries: EventLogEntry[],
  actorType: ActorType
): EventLogEntry[] {
  return entries.filter((entry) => entry.actorType === actorType);
}

export function filterEventLogByTimeRange(
  entries: EventLogEntry[],
  start: Date,
  end: Date
): EventLogEntry[] {
  return entries.filter((entry) => {
    const timestamp = new Date(entry.timestamp);
    return timestamp >= start && timestamp <= end;
  });
}

export function filterEventLogByPatchType(
  entries: EventLogEntry[],
  patchType: string
): EventLogEntry[] {
  return entries.filter((entry) => entry.patchType === patchType);
}

export function groupEventLogByActor(
  entries: EventLogEntry[]
): Record<ActorType, EventLogEntry[]> {
  return entries.reduce(
    (acc, entry) => {
      if (!acc[entry.actorType]) {
        acc[entry.actorType] = [];
      }
      acc[entry.actorType].push(entry);
      return acc;
    },
    {} as Record<ActorType, EventLogEntry[]>
  );
}

export function getEventLogSummary(entries: EventLogEntry[]): {
  totalPatches: number;
  byActorType: Record<string, number>;
  byPatchType: Record<string, number>;
  timeRange: { earliest: string | null; latest: string | null };
} {
  const byActorType: Record<string, number> = {};
  const byPatchType: Record<string, number> = {};
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const entry of entries) {
    byActorType[entry.actorType] = (byActorType[entry.actorType] || 0) + 1;
    byPatchType[entry.patchType] = (byPatchType[entry.patchType] || 0) + 1;

    if (!earliest || entry.timestamp < earliest) {
      earliest = entry.timestamp;
    }
    if (!latest || entry.timestamp > latest) {
      latest = entry.timestamp;
    }
  }

  return {
    totalPatches: entries.length,
    byActorType,
    byPatchType,
    timeRange: { earliest, latest },
  };
}

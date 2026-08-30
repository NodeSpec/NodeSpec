import type { InteractionKind } from '@nodespec/core/shared/enums.js';

export interface ContractInfo {
  kind?: string;
  interactionKind?: string;
  transport?: string;
}

export type PortDirection = 'in' | 'out' | 'bidirectional';

const INTERACTION_LABELS: Record<InteractionKind, { source: string; target: string }> = {
  request_response: { source: 'Calls', target: 'Serves' },
  event: { source: 'Publishes', target: 'Subscribes' },
  queue: { source: 'Enqueues', target: 'Consumes' },
  data_read: { source: 'Reads from', target: 'Provides data' },
  data_write: { source: 'Writes to', target: 'Accepts writes' },
  data_sync: { source: 'Syncs to', target: 'Syncs from' },
  file_transfer: { source: 'Uploads to', target: 'Stores for' },
  auth: { source: 'Authenticates via', target: 'Validates for' },
  telemetry: { source: 'Reports to', target: 'Monitors' },
  ipc: { source: 'Sends to', target: 'Receives from' },
  dependency: { source: 'Depends on', target: 'Used by' },
};

export function deriveInspectorLabel(
  interactionKind: string | undefined,
  portDirection: PortDirection | undefined,
  contract?: ContractInfo,
): string {
  const ik = (interactionKind ?? contract?.interactionKind ?? 'request_response') as InteractionKind;
  const labels = INTERACTION_LABELS[ik] ?? INTERACTION_LABELS.request_response;

  if (portDirection === 'bidirectional') {
    return `${labels.source} / ${labels.target}`;
  }

  if (portDirection === 'out') {
    return labels.source;
  }

  return labels.target;
}

export function deriveEdgeLabel(
  interactionKind: string | undefined,
  contract?: ContractInfo,
): string {
  const ik = (interactionKind ?? contract?.interactionKind ?? 'request_response') as InteractionKind;

  const EDGE_LABELS: Record<InteractionKind, string> = {
    request_response: 'Request / Response',
    event: 'Event',
    queue: 'Queue',
    data_read: 'Read',
    data_write: 'Write',
    data_sync: 'Sync',
    file_transfer: 'File Transfer',
    auth: 'Auth',
    telemetry: 'Telemetry',
    ipc: 'IPC',
    dependency: 'Dependency',
  };

  return EDGE_LABELS[ik] ?? ik;
}

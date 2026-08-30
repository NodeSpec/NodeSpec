// Helpers for reconstructing fine-grained intent labels from compressed InteractionKind.
// Used in AI prompt construction to provide the v5-style granular vocabulary.

import type { InteractionKind } from "./enums.ts";

export interface ContractContext {
  interactionKind?: string;
  transport?: string;
  kind?: string;
}

export interface PortContext {
  direction?: 'in' | 'out' | 'bidirectional';
}

/**
 * Derives a fine-grained intent label from compressed interactionKind + port direction.
 * Returns v5-style vocabulary for AI prompt readability:
 *   event → event_publish / event_subscribe
 *   queue → message_enqueue / message_consume
 *   auth → auth_flow / authorization_check
 *   data_read → data_read (unchanged)
 *   data_write → data_write (unchanged)
 *   telemetry → observability_signal
 *   ipc → ipc or hardware_io (based on transport)
 */
export function getInteractionIntent(
  contract: ContractContext,
  port?: PortContext,
): string {
  const ik = contract.interactionKind as InteractionKind | undefined;
  if (!ik) return 'request_response';

  const direction = port?.direction ?? 'out';

  switch (ik) {
    case 'event':
      if (contract.transport === 'websocket' || contract.transport === 'sse') {
        return 'realtime_channel';
      }
      return direction === 'in' ? 'event_subscribe' : 'event_publish';

    case 'queue':
      return direction === 'in' ? 'message_consume' : 'message_enqueue';

    case 'auth':
      if (contract.kind === 'oauth' || contract.transport === 'http') {
        return direction === 'in' ? 'authorization_check' : 'auth_flow';
      }
      return 'auth_flow';

    case 'telemetry':
      return 'observability_signal';

    case 'ipc':
      if (contract.transport && ['i2c', 'spi', 'uart', 'can', 'dds', 'mavlink'].includes(contract.transport)) {
        return 'hardware_io';
      }
      return 'ipc';

    case 'data_read':
    case 'data_write':
    case 'data_sync':
    case 'file_transfer':
    case 'dependency':
    case 'request_response':
      return ik;

    default:
      return ik;
  }
}

/**
 * Builds a human-readable intent description for AI prompts.
 */
export function describeInteractionIntent(intent: string): string {
  const descriptions: Record<string, string> = {
    request_response: 'synchronous call expecting a reply',
    realtime_channel: 'persistent bidirectional connection',
    event_publish: 'publishes events asynchronously',
    event_subscribe: 'subscribes to events asynchronously',
    message_enqueue: 'enqueues work items for processing',
    message_consume: 'consumes queued work items',
    data_read: 'reads from data store',
    data_write: 'writes to data store',
    data_sync: 'replication or sync protocol',
    file_transfer: 'blob/object storage operation',
    auth_flow: 'authentication handshake',
    authorization_check: 'permission verification',
    observability_signal: 'metrics, logs, or traces',
    hardware_io: 'physical device communication',
    ipc: 'inter-process communication',
    dependency: 'compile-time or package dependency',
  };
  return descriptions[intent] ?? intent;
}

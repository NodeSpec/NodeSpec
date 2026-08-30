// M1c: the NODE_KIND_LABELS/COLORS maps are GONE with the inspector kind chip and the
// `kind` column itself (NODE_REFERENCE §12.4). What remains is the contract-kind vocabulary.
// N5 chunk 2: port-contract helpers, extracted verbatim from
// SimplifiedInspector (shared by the inspector shell, ConnectionPointsEditor, and
// ConnectionDetails).
import type { Edge, Graph } from '@nodespec/core/types.js';

// M6: re-exported, not redefined. This file held one of three byte-identical copies; the
// single table now lives in core (repo-import needed it too) and is typed against the enum.
import { contractKindLabel } from '@nodespec/core/contract-labels.js';
export { CONTRACT_KIND_LABELS, contractKindLabel } from '@nodespec/core/contract-labels.js';

// N8.6(B): THE contract-kind color table — theme-aware, one copy. Previously three:
// CustomEdge.tsx and EdgeLegend.tsx each carried this exact table privately, and this
// file carried a THIRD flat-hex palette that disagreed with both (kafka rendered
// #231f20 on badges and #a78bfa on edges). EdgeLegend's private dash table had also
// drifted to a subset (data_sync and ipc missing) — the drift class this kills.
export const CONTRACT_KIND_EDGE_COLORS: Record<string, { dark: string; light: string }> = {
  rest: { dark: '#38bdf8', light: '#0284c7' },
  graphql: { dark: '#e879f9', light: '#a21caf' },
  grpc: { dark: '#34d399', light: '#059669' },
  websocket: { dark: '#fbbf24', light: '#d97706' },
  sse: { dark: '#fb923c', light: '#c2410c' },
  kafka: { dark: '#a78bfa', light: '#6d28d9' },
  amqp: { dark: '#f472b6', light: '#be185d' },
  sql: { dark: '#60a5fa', light: '#2563eb' },
  nosql: { dark: '#2dd4bf', light: '#0d9488' },
  ipc: { dark: '#94a3b8', light: '#64748b' },
  dependency: { dark: '#d97706', light: '#92400e' },
  custom: { dark: '#cbd5e1', light: '#475569' },
};

export function getContractKindColor(kind: string, mode: 'dark' | 'light'): string {
  const pair = CONTRACT_KIND_EDGE_COLORS[kind];
  return pair ? pair[mode] : (mode === 'dark' ? '#94a3b8' : '#6b7280');
}

// Dash pattern per interaction kind (solid = undefined). Full 11-value table —
// consumers must not subset it.
export const INTERACTION_KIND_DASH: Record<string, string | undefined> = {
  request_response: undefined,
  event: '8,4',
  queue: '4,4',
  data_read: '12,4,4,4',
  data_write: '12,4,4,4',
  data_sync: '6,3',
  file_transfer: '10,6',
  auth: '2,4',
  telemetry: '4,8',
  ipc: undefined,
  dependency: '2,2',
};

/** Pre-existing name kept for its call sites; `contractKindLabel` is the same function. */
export function getContractKindLabel(kind: string): string {
  return contractKindLabel(kind);
}

// N8.6(A): the 12-kind picker structure — previously hand-copied as two identical
// <optgroup> blocks in ConnectionDetails and ConnectionPointsEditor. The select-facing
// labels are deliberately longer than the CONTRACT_KIND_LABELS chips (a picker explains,
// a badge abbreviates). Grouping is the user-facing taxonomy, not the enum order.
export const CONTRACT_KIND_GROUPS: ReadonlyArray<{
  group: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}> = [
  { group: 'Synchronous', options: [
    { value: 'rest', label: 'REST API' },
    { value: 'graphql', label: 'GraphQL' },
    { value: 'grpc', label: 'gRPC' },
  ]},
  { group: 'Realtime', options: [
    { value: 'websocket', label: 'WebSocket' },
    { value: 'sse', label: 'Server-Sent Events' },
  ]},
  { group: 'Messaging', options: [
    { value: 'kafka', label: 'Kafka / Event Stream' },
    { value: 'amqp', label: 'AMQP / Message Queue' },
  ]},
  { group: 'Data', options: [
    { value: 'sql', label: 'SQL Database' },
    { value: 'nosql', label: 'NoSQL / Document Store' },
  ]},
  { group: 'Build-time', options: [
    { value: 'dependency', label: 'Library / Dependency' },
  ]},
  { group: 'System', options: [
    { value: 'ipc', label: 'IPC / Internal' },
    { value: 'custom', label: 'Custom' },
  ]},
];

// N8.6(B): a port's kind comes from its connected edge's CONTRACT — the only truth.
// The old fallback guessed the kind from the port NAME prefix ("REST Input" → rest),
// which only ever matched names the dead ConnectionPointsEditor kind-select generated;
// both halves of that hack are gone. Unconnected ports honestly show no kind badge.
export function getPortContractKind(portId: string, edges: Edge[], graph: Graph): string | null {
  for (const edge of edges) {
    if (edge.sourcePortId === portId || edge.targetPortId === portId) {
      const contract = graph.contracts[edge.contractId];
      if (contract) return contract.kind;
    }
  }
  return null;
}

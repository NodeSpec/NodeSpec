/*
  M6 — THE contract-kind display label table.

  There were three byte-identical copies: `kind-maps.ts` (the inspector's),
  `ContainerSummaryEdge.tsx`, and `repo-import/dependency-to-patches.ts`. N8.6(B) consolidated
  the colour and dash tables and believed it had done the labels too; it had not. They agreed
  today by luck, not by construction — nothing pinned them together, which is exactly how the
  colour tables drifted before N8.6(B) caught them (kafka rendered #231f20 on badges and
  #a78bfa on edges).

  This lives in core rather than the UI because `dependency-to-patches` is a core module and
  was one of the three copies — a UI-side home is why it had its own in the first place.

  `Record<ContractKind, string>` is the actual guard: adding a contract kind to
  CONTRACT_KIND_VALUES without labelling it is now a COMPILE error, not a label that silently
  falls through to the raw enum token in the UI.
*/
import type { ContractKind } from './shared/enums.js';

export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  rest: 'REST',
  graphql: 'GraphQL',
  grpc: 'gRPC',
  websocket: 'WebSocket',
  sse: 'SSE',
  kafka: 'Kafka',
  amqp: 'AMQP',
  sql: 'SQL',
  nosql: 'NoSQL',
  ipc: 'IPC',
  dependency: 'Dependency',
  custom: 'Custom',
};

/** Unknown kinds fall back to the raw token — honest, and the only sane thing to show for a
 *  value that reached the UI without passing the enum. */
export function contractKindLabel(kind: string): string {
  return CONTRACT_KIND_LABELS[kind as ContractKind] ?? kind;
}

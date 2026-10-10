// GENERATED from core/src/without-ports.ts by scripts/sync-core-engine.mjs. Do not edit:
// change core and run the script; src/tests/core-engine-copy.test.ts fails on drift.
import type { PatchOperation } from './types.ts';

// AG.13 (owner 2026-09-28, "drop the ports and simplify"): a change filed
// before ports came out (a staged import draft, a Git adopt, an agent's
// connect_ports) still carries them. This is applied where a proposal is
// accepted, so what lands is portless:
// - add_port, update_port, delete_port and a port's mark_entity_complete go;
// - add_node, create_node_from_template and update_node lose `ports`;
// - add_edge and update_edge lose their port ids;
// - connect_ports becomes the add_contract (when it carried one inline) and
//   the add_edge it always meant. The edge keeps the patch's own id and the
//   contract's patch id is derived from it, so accepting twice stays idempotent.
// Stored history is never rewritten: the patch engine still replays every
// port patch exactly as before.

const PORT_ONLY = new Set(['add_port', 'update_port', 'delete_port']);

function omit<T extends Record<string, unknown>>(obj: T, keys: string[]): T {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

/** A second uuid, fixed by the first: its first 24 characters and 12 from the contract id. */
function derivedId(patchId: string, contractId: string): string {
  return `${patchId.slice(0, 24)}${contractId.replace(/-/g, '').slice(0, 12)}`;
}

export function withoutPorts(patches: PatchOperation[]): PatchOperation[] {
  const out: PatchOperation[] = [];
  for (const patch of patches) {
    const p = patch as { type: string; metadata: PatchOperation['metadata']; payload: Record<string, unknown> };
    if (PORT_ONLY.has(p.type)) continue;
    if (p.type === 'mark_entity_complete' && p.payload.entityType === 'port') continue;
    if (p.type === 'add_node') {
      out.push({ ...p, payload: omit(p.payload, ['ports']) } as PatchOperation);
    } else if (p.type === 'create_node_from_template') {
      const node = p.payload.node as Record<string, unknown> | undefined;
      out.push({ ...p, payload: { ...p.payload, ...(node ? { node: omit(node, ['ports']) } : {}) } } as PatchOperation);
    } else if (p.type === 'update_node') {
      const changes = (p.payload.changes ?? {}) as Record<string, unknown>;
      out.push({ ...p, payload: { ...p.payload, changes: omit(changes, ['ports']) } } as PatchOperation);
    } else if (p.type === 'add_edge') {
      out.push({ ...p, payload: omit(p.payload, ['sourcePortId', 'targetPortId']) } as PatchOperation);
    } else if (p.type === 'update_edge') {
      const changes = (p.payload.changes ?? {}) as Record<string, unknown>;
      out.push({ ...p, payload: { ...p.payload, changes: omit(changes, ['sourcePortId', 'targetPortId']) } } as PatchOperation);
    } else if (p.type === 'connect_ports') {
      const pl = p.payload as {
        sourceNodeId: string; targetNodeId: string; edgeId: string; contractId: string;
        contract?: Record<string, unknown>; label?: string;
      };
      if (pl.contract) {
        out.push({
          type: 'add_contract',
          metadata: { ...p.metadata, id: derivedId(p.metadata.id, pl.contractId) },
          payload: pl.contract,
        } as PatchOperation);
      }
      out.push({
        type: 'add_edge',
        metadata: p.metadata,
        payload: {
          id: pl.edgeId,
          source: pl.sourceNodeId,
          target: pl.targetNodeId,
          contractId: pl.contractId,
          ...(pl.label ? { label: pl.label } : {}),
          metadata: {},
        },
      } as PatchOperation);
    } else {
      out.push(patch);
    }
  }
  return out;
}

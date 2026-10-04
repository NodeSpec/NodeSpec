import type { PatchOperation, ActorType } from '@nodespec/core/types.js';
import type { NodeRole } from '../../persistence/supabase/catalog-repository.js';
import { createAddNodePatch } from '@nodespec/core/patch-factory.js';

// AG.13 (owner 2026-09-28): a dropped node is the node alone. It carries no
// ports and no stub contracts; a contract is born when an edge is drawn, from
// the edge's target (inferConnectContract), and the canvas draws the handles.
export function buildNodePatchesFromRole(
  role: NodeRole,
  nodeId: string,
  displayName: string,
  options: { actorType: ActorType; technology?: string; parentContainerId?: string },
): PatchOperation[] {
  return [createAddNodePatch(
    {
      id: nodeId,
      type: role.id,
      label: displayName,
      technology: options.technology,
      data: {},
      metadata: {},
      status: 'draft',
      parentId: options.parentContainerId,
    },
    { actorType: options.actorType, summary: `Add ${displayName} node` },
  )];
}

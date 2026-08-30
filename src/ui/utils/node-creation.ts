import type { PatchOperation, ActorType, Port, Contract } from '@nodespec/core/types.js';
import type { NodeRole } from '../../persistence/supabase/catalog-repository.js';
import type { PortTemplate } from '@nodespec/core/node-types.js';
import { generateUUID } from '@nodespec/core/utils.js';
import { createAddNodePatch, createAddContractPatch } from '@nodespec/core/patch-factory.js';
import { resolveContractFields } from '@nodespec/core/interaction-resolution.js';

export function buildNodePatchesFromRole(
  role: NodeRole,
  nodeId: string,
  displayName: string,
  options: { actorType: ActorType; technology?: string; parentContainerId?: string },
): PatchOperation[] {
  const patches: PatchOperation[] = [];

  const ports: Port[] = (role.defaultPorts as PortTemplate[]).map((pt) => ({
    id: generateUUID(),
    name: pt.name,
    direction: pt.direction,
    required: pt.required,
    schemaRef: pt.schemaRef,
    status: 'draft' as const,
  }));

  const contracts: Contract[] = [];
  const rawContracts = (role.suggestedContracts as string[]) || [];

  if (rawContracts.length > 0) {
    const hasInPort = ports.some(p => p.direction === 'in');
    const hasOutPort = ports.some(p => p.direction === 'out');

    for (const rawKind of rawContracts) {
      const resolved = resolveContractFields(rawKind);
      const contractId = generateUUID();

      const contract: Contract = {
        id: contractId,
        kind: resolved.kind,
        name: `${resolved.kind} contract`,
        schema: {},
        metadata: {},
        status: 'draft',
        ...(resolved.interactionKind && { interactionKind: resolved.interactionKind }),
        ...(resolved.transport && { transport: resolved.transport }),
        ...(resolved.specFormat && { specFormat: resolved.specFormat }),
      };
      contracts.push(contract);

      const targetPort = hasInPort
        ? ports.find(p => p.direction === 'in' && !p.contractId)
        : hasOutPort
          ? ports.find(p => p.direction === 'out' && !p.contractId)
          : undefined;

      if (targetPort) {
        targetPort.contractId = contractId;
      }
    }
  }

  patches.push(createAddNodePatch(
    {
      id: nodeId,
      type: role.id,
      label: displayName,
      technology: options.technology,
      ports,
      data: {},
      metadata: {},
      status: 'draft',
      parentId: options.parentContainerId,
    },
    { actorType: options.actorType, summary: `Add ${displayName} node` },
  ));

  for (const contract of contracts) {
    patches.push(createAddContractPatch(
      contract,
      { actorType: options.actorType, summary: `Add ${contract.name}` },
    ));
  }

  return patches;
}

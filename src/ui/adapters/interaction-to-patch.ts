/**
 * React Flow Interaction → Patch Adapter
 *
 * ARCHITECTURE NOTES:
 * - Translates user interactions into domain PatchOperations
 * - No side effects - pure functions that return patches
 * - Callers are responsible for applying patches to the graph
 * - Uses safe patch builders that guarantee schema correctness
 *
 * INTERACTION MAPPING:
 * - Node drag → NO PATCH (position is UI-only ephemeral state)
 * - Connection → add_contract + add_edge (AG.13: nodes carry no ports)
 * - Delete node → removeNode patch
 * - Delete edge → removeEdge patch
 *
 * POSITION HANDLING:
 * - Node X/Y positions are NOT versioned or persisted
 * - Positions exist only in ReactFlow's UI state
 * - Moving nodes does NOT create patches or change graph history
 * - Future: Container-based layout will replace absolute positioning
 */

import type { Connection, NodeChange, EdgeChange } from '@xyflow/react';
import type { Graph, PatchOperation, ActorType } from '@nodespec/core/types.js';
import {
  buildRemoveNodePatch,
  buildRemoveEdgePatch,
  buildAddContractPatch,
  buildAddEdgePatch,
  PatchBuilderError,
} from '../builders/patchBuilders.js';
import { createRemoveArtifactPatch, createUpdateArtifactPatch } from '@nodespec/core/patch-factory.js';
import { generateUUID } from '@nodespec/core/utils.js';
import { inferConnectContract } from '@nodespec/core/interaction-resolution.js';
import { resolveRoleInfo } from '@nodespec/core/container-types.js';

export interface PatchOptions {
  actorType: ActorType;
  actorId?: string;
}

export interface InteractionResult {
  patches: PatchOperation[];
  warnings: string[];
  blocked: boolean;
  blockReason?: string;
}

export function mapNodeChangesToPatches(
  changes: NodeChange[],
  graph: Graph,
  options: PatchOptions
): InteractionResult {
  const patches: PatchOperation[] = [];
  const warnings: string[] = [];
  let blocked = false;
  let blockReason: string | undefined;

  for (const change of changes) {
    // Position changes are ignored - they're UI-only and don't create patches
    if (change.type === 'position') {
      continue;
    }

    if (change.type === 'remove') {
      const node = graph.nodes[change.id];
      if (!node) {
        warnings.push(`Cannot remove non-existent node ${change.id}`);
        continue;
      }

      const connectedEdges = Object.values(graph.edges).filter(
        (edge) => edge.source === change.id || edge.target === change.id
      );

      if (connectedEdges.length > 0) {
        blocked = true;
        blockReason = `Cannot delete node "${node.label}": it has ${connectedEdges.length} connected edge(s). Delete edges first.`;
        continue;
      }

      try {
        const ownedArtifacts = Object.entries(graph.artifacts).filter(
          ([_, artifact]) => artifact.nodeId === change.id
        );

        for (const [artifactId, artifact] of ownedArtifacts) {
          if (artifact.status === 'complete') {
            patches.push(
              createUpdateArtifactPatch(artifactId, { status: 'draft' }, {
                actorType: options.actorType,
                summary: `Revert artifact "${artifact.path}" to draft (cascade from node "${node.label}")`,
              })
            );
          }
          patches.push(
            createRemoveArtifactPatch(artifactId, {
              actorType: options.actorType,
              summary: `Delete artifact "${artifact.path}" (cascade from node "${node.label}")`,
            })
          );
        }

        patches.push(
          buildRemoveNodePatch({
            nodeId: change.id,
            actor: options.actorType,
            summary: `Delete node "${node.label}"`,
          })
        );
      } catch (err) {
        if (err instanceof PatchBuilderError) {
          warnings.push(`Failed to create remove patch: ${err.message}`);
        } else {
          throw err;
        }
      }
    }
  }

  return { patches, warnings, blocked, blockReason };
}

export function mapEdgeChangesToPatches(
  changes: EdgeChange[],
  graph: Graph,
  options: PatchOptions
): InteractionResult {
  const patches: PatchOperation[] = [];
  const warnings: string[] = [];

  for (const change of changes) {
    if (change.type === 'remove') {
      const edge = graph.edges[change.id];
      if (!edge) {
        warnings.push(`Cannot remove non-existent edge ${change.id}`);
        continue;
      }

      try {
        patches.push(
          buildRemoveEdgePatch({
            edgeId: change.id,
            actor: options.actorType,
            summary: `Delete edge "${edge.label ?? change.id}"`,
          })
        );
      } catch (err) {
        if (err instanceof PatchBuilderError) {
          warnings.push(`Failed to create edge remove patch: ${err.message}`);
        } else {
          throw err;
        }
      }
    }
  }

  return { patches, warnings, blocked: false };
}

export function mapConnectionToPatches(
  connection: Connection,
  graph: Graph,
  options: PatchOptions
): InteractionResult {
  const patches: PatchOperation[] = [];
  const warnings: string[] = [];

  if (!connection.source || !connection.target) {
    return {
      patches: [],
      warnings: ['Invalid connection: missing source or target'],
      blocked: true,
      blockReason: 'Connection requires both source and target nodes',
    };
  }

  const sourceNode = graph.nodes[connection.source];
  const targetNode = graph.nodes[connection.target];

  if (!sourceNode) {
    return {
      patches: [],
      warnings: [`Source node ${connection.source} not found`],
      blocked: true,
      blockReason: 'Source node does not exist',
    };
  }

  if (!targetNode) {
    return {
      patches: [],
      warnings: [`Target node ${connection.target} not found`],
      blocked: true,
      blockReason: 'Target node does not exist',
    };
  }

  // N8.6(A): the birth defect fix — edges were hardcoded `kind:'sql'` in BOTH
  // branches below (a React→API edge filed as a SQL contract). The TARGET role's
  // functional kind decides what calling it means; fallback is rest/request_response,
  // never sql. Silent by design — the inspector's Connection Type is the rebind.
  const inferred = inferConnectContract(resolveRoleInfo(targetNode.type));

  // AG.13 (owner 2026-09-28): a connection is a contract and an edge between
  // two nodes. The handle it was drawn between carries no meaning; the
  // contract says what the connection is.
  try {
    const contractId = generateUUID();

    const contractPatch = buildAddContractPatch({
      contract: {
        id: contractId,
        kind: inferred.kind,
        interactionKind: inferred.interactionKind,
        transport: inferred.transport,
        specFormat: inferred.specFormat,
        name: `${sourceNode.label} → ${targetNode.label}`,
        schema: {},
        metadata: {
          autoGenerated: true,
          sourceNodeId: connection.source,
          targetNodeId: connection.target,
        },
      },
      actor: options.actorType,
      summary: `Create contract for connection ${sourceNode.label} → ${targetNode.label}`,
    });

    const edgePatch = buildAddEdgePatch({
      edge: {
        source: connection.source,
        target: connection.target,
        contractId: contractId,
        label: `${sourceNode.label} → ${targetNode.label}`,
        metadata: {},
      },
      actor: options.actorType,
      summary: `Connect ${sourceNode.label} to ${targetNode.label}`,
    });

    patches.push(contractPatch, edgePatch);
  } catch (err) {
    if (err instanceof PatchBuilderError) {
      return {
        patches: [],
        warnings: [`Failed to create connection: ${err.message}`],
        blocked: true,
        blockReason: err.message,
      };
    }
    throw err;
  }

  return { patches, warnings, blocked: false };
}

export function mapDeleteSelectionToPatches(
  selectedNodeIds: string[],
  selectedEdgeIds: string[],
  graph: Graph,
  options: PatchOptions
): InteractionResult {
  const patches: PatchOperation[] = [];
  const warnings: string[] = [];
  let blocked = false;
  let blockReason: string | undefined;

  for (const edgeId of selectedEdgeIds) {
    const edge = graph.edges[edgeId];
    if (!edge) {
      warnings.push(`Edge ${edgeId} not found`);
      continue;
    }

    try {
      patches.push(
        buildRemoveEdgePatch({
          edgeId,
          actor: options.actorType,
          summary: `Delete edge "${edge.label ?? edgeId}"`,
        })
      );
    } catch (err) {
      if (err instanceof PatchBuilderError) {
        warnings.push(`Failed to create edge delete patch: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  for (const nodeId of selectedNodeIds) {
    const node = graph.nodes[nodeId];
    if (!node) {
      warnings.push(`Node ${nodeId} not found`);
      continue;
    }

    const connectedEdges = Object.values(graph.edges).filter(
      (edge) => edge.source === nodeId || edge.target === nodeId
    );

    const remainingConnectedEdges = connectedEdges.filter(
      (edge) => !selectedEdgeIds.includes(edge.id)
    );

    if (remainingConnectedEdges.length > 0) {
      blocked = true;
      blockReason = `Cannot delete node "${node.label}": still has ${remainingConnectedEdges.length} connected edge(s)`;
      continue;
    }

    try {
      const ownedArtifacts = Object.entries(graph.artifacts).filter(
        ([_, artifact]) => artifact.nodeId === nodeId
      );

      for (const [artifactId, artifact] of ownedArtifacts) {
        if (artifact.status === 'complete') {
          patches.push(
            createUpdateArtifactPatch(artifactId, { status: 'draft' }, {
              actorType: options.actorType,
              summary: `Revert artifact "${artifact.path}" to draft (cascade from node "${node.label}")`,
            })
          );
        }
        patches.push(
          createRemoveArtifactPatch(artifactId, {
            actorType: options.actorType,
            summary: `Delete artifact "${artifact.path}" (cascade from node "${node.label}")`,
          })
        );
      }

      patches.push(
        buildRemoveNodePatch({
          nodeId,
          actor: options.actorType,
          summary: `Delete node "${node.label}"`,
        })
      );
    } catch (err) {
      if (err instanceof PatchBuilderError) {
        warnings.push(`Failed to create node delete patch: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  return { patches, warnings, blocked, blockReason };
}

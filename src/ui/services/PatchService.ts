import type { PatchOperation } from '@nodespec/core/types.js';
import type { PersistedPatch, RealtimeSubscription, PatchFilter } from '../../persistence/types.js';
import type { PersistenceService } from './PersistenceService.js';

export class PatchService {
  constructor(private persistence: PersistenceService) {}

  async appendPatch(
    branchId: string,
    patch: PatchOperation,
    actorId?: string
  ): Promise<PersistedPatch> {
    const repo = this.persistence.getPatchRepository();
    const result = await repo.appendPatch(branchId, patch, actorId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async appendPatches(
    branchId: string,
    patches: PatchOperation[],
    actorId?: string
  ): Promise<PersistedPatch[]> {
    const repo = this.persistence.getPatchRepository();
    const result = await repo.appendPatches(branchId, patches, actorId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async loadPatches(branchId: string, filter?: PatchFilter): Promise<PersistedPatch[]> {
    const repo = this.persistence.getPatchRepository();
    const result = await repo.loadPatches(branchId, filter);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getPatch(patchId: string): Promise<PersistedPatch | null> {
    const repo = this.persistence.getPatchRepository();
    const result = await repo.getPatchById(patchId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getLatestSequence(branchId: string): Promise<number> {
    const repo = this.persistence.getPatchRepository();
    const result = await repo.getLatestSequence(branchId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async clearPatches(branchId: string): Promise<void> {
    const repo = this.persistence.getPatchRepository();
    const result = await repo.clearPatches(branchId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  async markPatchApplied(patchId: string): Promise<void> {
    const repo = this.persistence.getPatchRepository();
    const result = await repo.markApplied(patchId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }

  subscribeToPatchStream(
    branchId: string,
    callback: (event: { type: string; patch: PersistedPatch; timestamp: string }) => void,
    sinceSequence?: number
  ): RealtimeSubscription {
    const repo = this.persistence.getPatchRepository();
    return repo.subscribeToPatchStream(branchId, callback, sinceSequence);
  }

  /**
   * @deprecated CANONICAL ARCHITECTURE VIOLATION
   *
   * This method directly saves architecture to graph_patches, bypassing the proposal system.
   *
   * ❌ PROBLEMS:
   * - No human review gate
   * - Violates canonical architecture (patches should only be created via proposal acceptance)
   * - Creates referential integrity issues when mappings are saved before nodes exist
   * - No validation or traceability checks
   *
   * ✅ CORRECT FLOW:
   * 1. Create proposal: ProposalService.createArchitectureProposal()
   * 2. User reviews in UI
   * 3. User accepts: ProposalService.acceptProposal()
   * 4. Patches applied via this.appendPatches()
   *
   * DO NOT USE THIS METHOD. Use ProposalService instead.
   *
   * This method is kept temporarily for backward compatibility only.
   * It will be removed in a future version.
   */
  async saveArchitectureFromGeneration(projectId: string, architecture: any, specificationId: string): Promise<string[]> {
    console.warn('⚠️ DEPRECATED: saveArchitectureFromGeneration called. This violates canonical architecture.');
    console.warn('⚠️ Use ProposalService.createArchitectureProposal() instead.');
    console.warn('⚠️ Called from:', new Error().stack);

    console.log('[saveArchitectureFromGeneration] Starting:', {
      projectId,
      specificationId,
      nodesCount: architecture.nodes?.length || 0,
      edgesCount: architecture.edges?.length || 0,
      contractsCount: architecture.contracts?.length || 0,
    });

    // Get the main branch for this project
    const branchesResult = await this.persistence.getBranchRepository().listByProject(projectId);

    if (!branchesResult.success) {
      throw new Error('Failed to get branches: ' + branchesResult.error.message);
    }

    const mainBranch = branchesResult.data.find((b: any) => b.name === 'main');

    if (!mainBranch) {
      throw new Error('Main branch not found for project');
    }

    console.log('[saveArchitectureFromGeneration] Found main branch:', {
      branchId: mainBranch.id,
      branchName: mainBranch.name,
    });

    const patches: PatchOperation[] = [];
    const nodeIds: string[] = [];
    const { generateUUID, now } = await import('@nodespec/core/utils.js');

    // CRITICAL: Create contracts FIRST before nodes, because ports reference contracts
    console.log('[saveArchitectureFromGeneration] Creating contract patches first...');
    if (architecture.contracts && Array.isArray(architecture.contracts)) {
      for (const contract of architecture.contracts) {
        console.log('[saveArchitectureFromGeneration] Adding contract:', contract.id, contract.name);
        patches.push({
          type: 'add_contract',
          metadata: {
            id: generateUUID(),
            actorType: 'ai' as const,
            summary: `Add contract: ${contract.name}`,
            timestamp: now(),
          },
          payload: {
            id: contract.id,
            name: contract.name,
            kind: contract.kind,
            schema: contract.schema,
            schemaRef: contract.schemaRef,
            metadata: contract.metadata || {},
          },
        });
      }
    }

    // Create patches for nodes (which may have ports that reference contracts)
    for (const nodeData of architecture.nodes) {
      // parseAIResponse returns {node: {...}, artifacts: [...]}
      const node = nodeData.node || nodeData;
      const nodeId = node.id;
      nodeIds.push(nodeId);
      const timestamp = now();

      console.log('[saveArchitectureFromGeneration] Creating node patch:', {
        nodeId,
        label: node.label,
        type: node.type,
        hasArtifacts: !!(nodeData.artifacts && nodeData.artifacts.length > 0),
        rawNodeData: nodeData,
        extractedNode: node,
      });

      patches.push({
        type: 'add_node',
        metadata: {
          id: generateUUID(),
          actorType: 'ai' as const,
          summary: `Add node: ${node.label || 'Unnamed Node'}`,
          timestamp,
        },
        payload: {
          id: nodeId,
          label: node.label || 'Unnamed Node',
          type: node.type || 'component',
          parentId: node.parentId || undefined,
          status: 'draft' as const,
          metadata: {
            ...node.metadata,
            position: node.metadata?.position || { x: 0, y: 0 },
            generatedByAI: true,
            specificationId,
          },
          ports: node.ports || [],
        },
      });

      // Create patches for artifacts
      if (nodeData.artifacts && Array.isArray(nodeData.artifacts)) {
        for (const artifact of nodeData.artifacts) {
          patches.push({
            type: 'add_artifact',
            metadata: {
              id: generateUUID(),
              actorType: 'ai' as const,
              summary: `Add artifact: ${artifact.path}`,
              timestamp: now(),
            },
            payload: {
              id: artifact.id,
              nodeId,
              kind: artifact.kind,
              path: artifact.path,
              language: artifact.metadata?.language || 'typescript',
              content: artifact.content || '',
              createdAt: artifact.createdAt,
              updatedAt: artifact.updatedAt,
              metadata: artifact.metadata || {},
            },
          });
        }
      }
    }

    // Contracts already created before nodes (above)

    // Create patches for edges
    if (architecture.edges && Array.isArray(architecture.edges)) {
      for (const edge of architecture.edges) {
        patches.push({
          type: 'add_edge',
          metadata: {
            id: generateUUID(),
            actorType: 'ai' as const,
            summary: `Add edge`,
            timestamp: now(),
          },
          payload: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            contractId: edge.contractId,
            sourcePortId: edge.sourcePortId,
            targetPortId: edge.targetPortId,
            metadata: edge.metadata || {},
          },
        });
      }
    }

    // Apply all patches
    console.log('[saveArchitectureFromGeneration] Created patches:', {
      totalPatches: patches.length,
      nodePatches: patches.filter(p => p.type === 'add_node').length,
      edgePatches: patches.filter(p => p.type === 'add_edge').length,
      contractPatches: patches.filter(p => p.type === 'add_contract').length,
      artifactPatches: patches.filter(p => p.type === 'add_artifact').length,
      sampleNodeIds: nodeIds.slice(0, 3),
    });

    if (patches.length > 0) {
      await this.appendPatches(mainBranch.id, patches);
      console.log('[saveArchitectureFromGeneration] Patches applied successfully');
    } else {
      console.warn('[saveArchitectureFromGeneration] No patches created!');
    }

    console.log('[saveArchitectureFromGeneration] Returning node IDs:', {
      count: nodeIds.length,
      ids: nodeIds,
    });

    // After applying patches, create a snapshot so the graph is visible in all views
    console.log('[saveArchitectureFromGeneration] Creating snapshot with architecture...');

    try {
      const { applyPatches } = await import('@nodespec/core/patch-engine.js');
      const { createEmptyGraph } = await import('@nodespec/core/utils.js');
      const graphRepo = this.persistence.getGraphRepository();
      const patchRepo = this.persistence.getPatchRepository();

      let finalGraph: any = null;
      let totalPatchCount = 0;

      const snapshotResult = await graphRepo.loadSnapshot(mainBranch.id);
      if (snapshotResult.success && snapshotResult.data) {
        const baseSequence = snapshotResult.data.patchSequence;
        const patchesResult = await patchRepo.loadPatches(mainBranch.id, { sinceSequence: baseSequence });
        if (patchesResult.success && patchesResult.data.length > 0) {
          const result = applyPatches(snapshotResult.data.graphData, patchesResult.data.map((p: any) => p.payload));
          if (result.success && result.graph) {
            finalGraph = result.graph;
            totalPatchCount = baseSequence + patchesResult.data.length;
          }
        } else if (patchesResult.success && patchesResult.data.length === 0) {
          // No patches after snapshot - check for sequence mismatch
          const latestSeqResult = await patchRepo.getLatestSequence(mainBranch.id);
          const actualMax = latestSeqResult.success ? latestSeqResult.data : 0;
          if (baseSequence > actualMax && actualMax > 0) {
            // Snapshot has inflated sequence - use existing graph and correct the sequence
            finalGraph = snapshotResult.data.graphData;
            totalPatchCount = actualMax;
            console.warn('[saveArchitectureFromGeneration] Correcting inflated snapshot sequence:', baseSequence, '->', actualMax);
          }
        }
      }

      if (!finalGraph) {
        console.log('[saveArchitectureFromGeneration] Falling back to full replay');
        const patchesResult = await patchRepo.loadPatches(mainBranch.id, { sinceSequence: 0 });
        if (patchesResult.success && patchesResult.data.length > 0) {
          const result = applyPatches(createEmptyGraph(), patchesResult.data.map((p: any) => p.payload));
          if (result.success && result.graph) {
            finalGraph = result.graph;
            totalPatchCount = patchesResult.data.length;
          }
        }
      }

      if (finalGraph) {
        // Safety: don't save if regression detected
        const existingNodeCount = snapshotResult.success && snapshotResult.data?.graphData?.nodes
          ? Object.keys(snapshotResult.data.graphData.nodes).length
          : 0;
        const newNodeCount = Object.keys(finalGraph.nodes).length;

        if (existingNodeCount > 0 && newNodeCount < existingNodeCount * 0.5) {
          console.error('[saveArchitectureFromGeneration] Snapshot regression blocked:', existingNodeCount, '->', newNodeCount, 'nodes');
        } else {
          const snapshotSaveResult = await graphRepo.saveSnapshot(
            projectId, mainBranch.id, finalGraph, totalPatchCount
          );
          if (snapshotSaveResult.success) {
            console.log('[saveArchitectureFromGeneration] Snapshot created:', {
              nodeCount: newNodeCount,
              sequence: totalPatchCount,
            });
          }
        }
      }
    } catch (snapshotError) {
      console.error('[saveArchitectureFromGeneration] Snapshot creation error:', snapshotError);
    }

    return nodeIds;
  }
}

import type { AIProposal, ProposalStatus, ProposalPatch } from '@nodespec/core/ai-proposal.js';
import type { PersistenceService } from './PersistenceService.js';
import { getContainerTypeById } from '@nodespec/core/container-types.js';
import { normalizePatch } from '@nodespec/core/patch-engine.js';
import { withoutPorts } from '@nodespec/core/without-ports.js';
import { conflictsSince, describeConflicts } from '@nodespec/core/patch-targets.js';
import { acceptLeaseRefusal, leasesFromRows, type LeaseRowLite } from '../components/ideation/node-leases.js';
import { resolveContractFields } from '@nodespec/core/interaction-resolution.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been',
  'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'it',
  'that', 'this', 'can', 'will', 'should', 'must', 'may', 'all', 'each',
  'has', 'have', 'had', 'not', 'but', 'if', 'its', 'into', 'new', 'any',
]);

function extractMatchTerms(...inputs: string[]): string[] {
  const terms = new Set<string>();
  for (const input of inputs) {
    if (!input) continue;
    const tokens = input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP_WORDS.has(t));
    for (const t of tokens) terms.add(t);
  }
  return Array.from(terms);
}

function computeOverlapScore(nodeTerms: string[], reqTerms: string[]): number {
  const reqSet = new Set(reqTerms);
  let exact = 0;
  let partial = 0;
  for (const nt of nodeTerms) {
    if (reqSet.has(nt)) {
      exact++;
    } else {
      for (const rt of reqTerms) {
        if ((nt.length >= 4 && rt.includes(nt)) || (rt.length >= 4 && nt.includes(rt))) {
          partial++;
          break;
        }
      }
    }
  }
  return exact * 2 + partial;
}

export class ProposalService {
  constructor(private persistence: PersistenceService) {}

  async createProposal(proposal: AIProposal): Promise<AIProposal> {
    const repo = this.persistence.getProposalRepository();

    // Strip content from add_artifact patches to avoid PostgREST ~1MB limit.
    // Content is stored separately in ai_proposal_artifacts.
    const artifactContents: { artifactId: string; content: string; contentHash?: string }[] = [];
    const strippedPatches = proposal.patches.map(pp => {
      if (pp.patch.type === 'add_artifact' && pp.patch.payload?.content) {
        const payload = pp.patch.payload;
        const content = payload.content as string;
        artifactContents.push({
          artifactId: payload.id,
          content,
          contentHash: payload.contentHash,
        });
        return {
          ...pp,
          patch: {
            ...pp.patch,
            payload: { ...payload, content: '__stored_externally__' },
          },
        };
      }
      return pp;
    });

    const strippedProposal = artifactContents.length > 0
      ? { ...proposal, patches: strippedPatches }
      : proposal;

    const result = await repo.create(strippedProposal);
    if (!result.success) {
      throw new Error(result.error.message);
    }

    // Batch-insert artifact content into the side table
    if (artifactContents.length > 0) {
      const client = this.persistence.getSupabaseClient();
      const BATCH_SIZE = 50;
      for (let i = 0; i < artifactContents.length; i += BATCH_SIZE) {
        const batch = artifactContents.slice(i, i + BATCH_SIZE).map(a => ({
          proposal_id: result.data.id,
          artifact_id: a.artifactId,
          content: a.content,
          content_hash: a.contentHash ?? null,
        }));
        const { error } = await client
          .from('ai_proposal_artifacts')
          .upsert(batch, { onConflict: 'proposal_id,artifact_id' });
        if (error) {
          console.error('[ProposalService] Failed to store artifact content:', error.message);
        }
      }
    }

    return result.data;
  }

  async getProposal(proposalId: string): Promise<AIProposal | null> {
    const repo = this.persistence.getProposalRepository();
    const result = await repo.getById(proposalId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async getProposalByAIRun(aiRunId: string): Promise<AIProposal | null> {
    const repo = this.persistence.getProposalRepository();
    const result = await repo.getByAIRunId(aiRunId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async listProposalsByBranch(branchId: string, status?: ProposalStatus): Promise<AIProposal[]> {
    const repo = this.persistence.getProposalRepository();
    const result = await repo.listByBranch(branchId, status);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async updateProposalStatus(proposalId: string, status: ProposalStatus): Promise<AIProposal> {
    const repo = this.persistence.getProposalRepository();
    const result = await repo.updateStatus(proposalId, status);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  /** AE.12: a rejection in the canvas carries the person's reason. Stored as
   *  metadata.resolveNote, the key the server's resolve_proposal writes and
   *  get_proposal_status serves as reviewNote, with who decided (app). */
  async rejectProposal(proposalId: string, reason: string): Promise<AIProposal> {
    const note = reason.trim();
    if (!note) throw new Error('A rejection needs a reason: the agent reads it.');
    const client = this.persistence.getSupabaseClient();
    const { data } = await client
      .from('ai_proposals')
      .select('metadata')
      .eq('id', proposalId)
      .maybeSingle();
    await client
      .from('ai_proposals')
      .update({ metadata: { ...((data?.metadata as Record<string, unknown>) ?? {}), resolveNote: note, resolvedBy: 'app' } })
      .eq('id', proposalId);
    return this.updateProposalStatus(proposalId, 'rejected');
  }

  /** UX-1.1a: audit stamp for auto-approved proposals — merged into metadata
   *  after acceptProposal succeeds, so the history answers "who applied this". */
  async markAutoApproved(proposalId: string): Promise<void> {
    const client = this.persistence.getSupabaseClient();
    const { data } = await client
      .from('ai_proposals')
      .select('metadata')
      .eq('id', proposalId)
      .maybeSingle();
    await client
      .from('ai_proposals')
      .update({ metadata: { ...((data?.metadata as Record<string, unknown>) ?? {}), autoApproved: { at: new Date().toISOString() } } })
      .eq('id', proposalId);
  }

  async updateProposalPatches(proposalId: string, patches: ProposalPatch[]): Promise<AIProposal> {
    const repo = this.persistence.getProposalRepository();

    // For large patch sets, the JSON payload can exceed Supabase limits
    // Chunk into sequential updates if needed
    const CHUNK_THRESHOLD = 200;
    if (patches.length > CHUNK_THRESHOLD) {
      console.log(`[ProposalService] Large patch set (${patches.length}), writing in chunks`);
      // Write all patches in a single update but log warning for monitoring
      // The JSONB column handles large arrays, but we log for observability
      if (patches.length > 500) {
        console.warn(`[ProposalService] Very large patch set: ${patches.length} patches. Consider splitting proposals.`);
      }
    }

    const result = await repo.updatePatches(proposalId, patches);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async markReviewed(proposalId: string): Promise<AIProposal> {
    const repo = this.persistence.getProposalRepository();
    const result = await repo.markReviewed(proposalId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async mergeProposal(proposalId: string): Promise<AIProposal> {
    const repo = this.persistence.getProposalRepository();
    const result = await repo.markMerged(proposalId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async createArchitectureProposal(
    projectId: string,
    sourceBranchId: string,
    architecture: any,
    specificationId: string,
    _userId: string,
    mode?: 'create' | 'refine',
    lockedNodes?: string[]
  ): Promise<AIProposal> {
    const { generateUUID, now } = await import('@nodespec/core/utils.js');

    // Create an AI run first to satisfy the foreign key constraint
    const aiRunRepo = this.persistence.getAIRunRepository();
    const runResult = await aiRunRepo.create(
      projectId,
      sourceBranchId,
      'agent-orchestrator-v4',
      'architecture-generation',
      undefined,
      {
        type: 'architecture-generation',
        specificationId,
        nodeCount: architecture.nodes?.length || 0,
        edgeCount: architecture.edges?.length || 0,
        mode: mode || 'create',
        lockedNodesCount: lockedNodes?.length || 0,
      }
    );

    if (!runResult.success) {
      throw new Error(`Failed to create AI run: ${runResult.error.message}`);
    }

    const aiRun = runResult.data;

    // Create patches from architecture
    const patches: any[] = [];
    const lockedNodesSet = new Set(lockedNodes || []);

    // REFINE MODE: Delete existing AI-generated unlocked nodes before adding new ones
    if (mode === 'refine') {
      console.log('[ProposalService] Refine mode: Fetching existing graph to determine nodes to remove');

      // Get current graph state
      const graphRepo = this.persistence.getGraphRepository();
      const snapshotResult = await graphRepo.loadSnapshot(sourceBranchId);

      if (snapshotResult.success && snapshotResult.data?.graphData) {
        const currentGraph = snapshotResult.data.graphData as any;
        const newNodeIds = new Set(architecture.nodes.map((n: any) => (n.node || n).id));

        // REFINE MODE LOGIC: Remove all nodes except:
        // 1. Locked nodes (user explicitly protected)
        // 2. Nodes in the new architecture (being kept/updated)
        if (currentGraph.nodes) {
          for (const [nodeId, node] of Object.entries(currentGraph.nodes)) {
            const nodeData = node as any;
            const isLocked = lockedNodesSet.has(nodeId);
            const isInNewArch = newNodeIds.has(nodeId);

            // In refine mode, remove all unlocked nodes not in the new architecture
            // Origin (AI vs user-created) is irrelevant - only lock status matters
            if (!isLocked && !isInNewArch) {
              console.log(`[ProposalService] Removing node in refine mode: ${nodeId} (${nodeData.label})`);
              patches.push({
                type: 'delete_node',
                metadata: {
                  id: generateUUID(),
                  actorType: 'ai' as const,
                  summary: `Remove node: ${nodeData.label || nodeId}`,
                  timestamp: now(),
                },
                payload: {
                  id: nodeId,
                },
              });
            }
          }
        }

        // Remove edges that connect to deleted nodes or aren't in the new architecture
        // The AI can generate new edges connecting to locked nodes if needed
        const newEdgeIds = new Set(architecture.edges?.map((e: any) => e.id) || []);
        const deletedNodeIds = new Set(
          patches.filter(p => p.type === 'delete_node').map(p => p.payload.id)
        );

        if (currentGraph.edges) {
          for (const [edgeId, edge] of Object.entries(currentGraph.edges)) {
            const edgeData = edge as any;
            const connectsToDeletedNode = deletedNodeIds.has(edgeData.source) || deletedNodeIds.has(edgeData.target);
            const isInNewArch = newEdgeIds.has(edgeId);

            // Remove edge if it connects to deleted node OR is not in new architecture
            if (connectsToDeletedNode || !isInNewArch) {
              console.log(`[ProposalService] Removing edge in refine mode: ${edgeId}`);
              patches.push({
                type: 'delete_edge',
                metadata: {
                  id: generateUUID(),
                  actorType: 'ai' as const,
                  summary: `Remove edge: ${edgeData.source} → ${edgeData.target}`,
                  timestamp: now(),
                },
                payload: {
                  id: edgeId,
                },
              });
            }
          }
        }

        // Remove contracts that aren't in the new architecture
        // Contracts don't have a "locked" concept - they're replaced with the architecture
        const newContractIds = new Set(architecture.contracts?.map((c: any) => c.id) || []);
        if (currentGraph.contracts) {
          for (const [contractId, contract] of Object.entries(currentGraph.contracts)) {
            const contractData = contract as any;
            const isInNewArch = newContractIds.has(contractId);

            if (!isInNewArch) {
              console.log(`[ProposalService] Removing contract in refine mode: ${contractId}`);
              patches.push({
                type: 'delete_contract',
                metadata: {
                  id: generateUUID(),
                  actorType: 'ai' as const,
                  summary: `Remove contract: ${contractData.name || contractId}`,
                  timestamp: now(),
                },
                payload: {
                  id: contractId,
                },
              });
            }
          }
        }

        console.log(`[ProposalService] Refine mode: ${patches.length} deletion patches created`);
      }
    }

    // Contracts first - with normalization (last line of defense)
    if (architecture.contracts && Array.isArray(architecture.contracts)) {
      console.log('[ProposalService] Processing contracts:', {
        total: architecture.contracts.length,
        kinds: architecture.contracts.map((c: any) => `${c.name}: ${c.kind}`),
      });

      for (const contract of architecture.contracts) {
        const originalKind = contract.kind || 'rest';
        const resolved = resolveContractFields(originalKind);

        if (originalKind !== resolved.kind) {
          console.log(`[ProposalService] Normalized contract kind: "${contract.name}" from "${originalKind}" to "${resolved.kind}"`);
        }

        const payload: Record<string, unknown> = {
          id: contract.id,
          name: contract.name,
          kind: resolved.kind,
          schema: contract.schema,
          schemaRef: contract.schemaRef,
          metadata: contract.metadata || {},
        };
        if (contract.interactionKind || resolved.interactionKind) payload.interactionKind = contract.interactionKind || resolved.interactionKind;
        if (contract.transport || resolved.transport) payload.transport = contract.transport || resolved.transport;
        if (contract.specFormat || resolved.specFormat) payload.specFormat = contract.specFormat || resolved.specFormat;

        patches.push({
          type: 'add_contract',
          metadata: {
            id: generateUUID(),
            actorType: 'ai' as const,
            summary: `Add contract: ${contract.name}`,
            timestamp: now(),
          },
          payload,
        });
      }

      console.log('[ProposalService] Normalized and validated all contracts successfully');
    }

    // Nodes
    for (const nodeData of architecture.nodes) {
      const node = nodeData.node || nodeData;
      patches.push({
        type: 'add_node',
        metadata: {
          id: generateUUID(),
          actorType: 'ai' as const,
          summary: `Add node: ${node.label || 'Unnamed Node'}`,
          timestamp: now(),
        },
        payload: {
          id: node.id,
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
        },
      });

      // Artifacts for this node
      if (nodeData.artifacts && Array.isArray(nodeData.artifacts)) {
        for (const artifact of nodeData.artifacts) {
          // Handle both old format (name/type) and new format (path/kind)
          const artifactPath = artifact.path || (artifact as any).name || `${node.label.toLowerCase().replace(/\s+/g, '-')}.ts`;
          const artifactKind = artifact.kind || ((artifact as any).type === 'code' ? 'source' :
                                                 (artifact as any).type === 'documentation' ? 'doc' :
                                                 (artifact as any).type || 'source');

          // Ensure kind is valid
          const validKinds = ['source', 'schema', 'doc', 'config', 'build', 'design', 'task'];
          const finalKind = validKinds.includes(artifactKind) ? artifactKind : 'source';

          patches.push({
            type: 'add_artifact',
            metadata: {
              id: generateUUID(),
              actorType: 'ai' as const,
              summary: `Add artifact: ${artifactPath}`,
              timestamp: now(),
            },
            payload: {
              id: artifact.id || generateUUID(),
              nodeId: node.id,
              kind: finalKind,
              path: artifactPath,
              content: artifact.content || '',
              language: artifact.language || artifact.metadata?.language || 'typescript',
              createdAt: artifact.createdAt || now(),
              updatedAt: artifact.updatedAt || now(),
              metadata: artifact.metadata || {},
            },
          });
        }
      }
    }

    // Edges - comprehensive validation including node existence
    if (architecture.edges && Array.isArray(architecture.edges)) {
      // Collect all node IDs that will exist after this proposal is applied:
      // new architecture nodes + any existing nodes that aren't being deleted
      const nodeIdsInProposal = new Set(architecture.nodes.map((n: any) => (n.node || n).id));
      const deletedNodePatchIds = new Set(
        patches.filter(p => p.type === 'delete_node').map(p => p.payload.id)
      );
      if (mode === 'refine') {
        try {
          const graphRepo = this.persistence.getGraphRepository();
          const snap = await graphRepo.loadSnapshot(sourceBranchId);
          if (snap.success && snap.data?.graphData) {
            const g = snap.data.graphData as any;
            if (g.nodes) {
              for (const nodeId of Object.keys(g.nodes)) {
                if (!deletedNodePatchIds.has(nodeId)) {
                  nodeIdsInProposal.add(nodeId);
                }
              }
            }
          }
        } catch (e) {
          console.warn('[ProposalService] Could not load snapshot for edge validation:', e);
        }
      }

      console.log('[ProposalService] Processing edges:', {
        total: architecture.edges.length,
        nodeIdsInProposal: Array.from(nodeIdsInProposal),
        sample: architecture.edges.slice(0, 2).map((e: any) => ({
          source: e.source,
          target: e.target,
          contractId: e.contractId,
          hasContract: !!e.contractId,
        })),
      });

      for (const edge of architecture.edges) {
        // Validate required fields
        if (!edge.id) {
          console.error('[ProposalService] Edge missing id:', edge);
          throw new Error('Edge validation failed: missing id');
        }
        if (!edge.source) {
          console.error('[ProposalService] Edge missing source:', edge);
          throw new Error(`Edge validation failed: missing source for edge ${edge.id}`);
        }
        if (!edge.target) {
          console.error('[ProposalService] Edge missing target:', edge);
          throw new Error(`Edge validation failed: missing target for edge ${edge.id}`);
        }

        // CRITICAL: Validate that source and target nodes exist in this proposal
        if (!nodeIdsInProposal.has(edge.source)) {
          console.error('[ProposalService] Edge references non-existent source node:', {
            edgeId: edge.id,
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
            availableNodeIds: Array.from(nodeIdsInProposal),
          });
          throw new Error(
            `Edge validation failed: source node ${edge.source} does not exist in this proposal. ` +
            `This edge cannot be created because its source node is missing. ` +
            `Available node IDs: ${Array.from(nodeIdsInProposal).join(', ')}`
          );
        }

        if (!nodeIdsInProposal.has(edge.target)) {
          console.error('[ProposalService] Edge references non-existent target node:', {
            edgeId: edge.id,
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
            availableNodeIds: Array.from(nodeIdsInProposal),
          });
          throw new Error(
            `Edge validation failed: target node ${edge.target} does not exist in this proposal. ` +
            `This edge cannot be created because its target node is missing. ` +
            `Available node IDs: ${Array.from(nodeIdsInProposal).join(', ')}`
          );
        }

        // contractId is required by EdgeSchema
        if (!edge.contractId) {
          console.error('[ProposalService] Edge missing contractId:', {
            edgeId: edge.id,
            source: edge.source,
            target: edge.target,
            edge,
          });
          throw new Error(
            `Edge validation failed: missing contractId for edge ${edge.id} (${edge.source} → ${edge.target}). ` +
            `This indicates the AI did not create a contract for this connection. ` +
            `All edges must have a corresponding contract.`
          );
        }

        patches.push({
          type: 'add_edge',
          metadata: {
            id: generateUUID(),
            actorType: 'ai' as const,
            summary: `Add edge: ${edge.source} → ${edge.target}`,
            timestamp: now(),
          },
          payload: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            contractId: edge.contractId,
            metadata: edge.metadata || {},
          },
        });
      }

      console.log('[ProposalService] Validated all edges successfully');
    }

    // Create ProposalPatch array
    const proposalPatches = patches.map(patch => ({
      patch,
      explanation: patch.metadata.summary,
      status: 'pending' as const,
    }));

    // Create AIProposal
    const proposal: AIProposal = {
      id: generateUUID(),
      aiRunId: aiRun.id,
      sourceBranchId,
      proposalBranchId: sourceBranchId, // For now, use same branch - will be improved later
      status: 'pending',
      patches: proposalPatches,
      validationExpectations: [],
      createdAt: now(),
    };

    // Mark AI run as completed
    await aiRunRepo.markCompleted(aiRun.id, proposalPatches.map(p => p.patch.metadata.id));

    // Save proposal to DB
    return await this.createProposal(proposal);
  }

  async createProposalFromAgentPatches(
    projectId: string,
    branchId: string,
    patches: any[],
    summary: string,
    pendingTraceUpdates?: any[]
  ): Promise<AIProposal> {
    const { generateUUID, now } = await import('@nodespec/core/utils.js');

    const aiRunRepo = this.persistence.getAIRunRepository();
    const runResult = await aiRunRepo.create(
      projectId,
      branchId,
      'agent-orchestrator-v4',
      'architecture-agent',
      undefined,
      {
        type: 'agent-architecture',
        patchCount: patches.length,
        summary,
      }
    );

    if (!runResult.success) {
      throw new Error(`Failed to create AI run: ${runResult.error.message}`);
    }

    const aiRun = runResult.data;

    const normalizedPatches = patches.map(p => normalizePatch(p));
    const proposalPatches = normalizedPatches.map(patch => ({
      patch,
      explanation: patch.metadata?.summary || patch.type,
      status: 'pending' as const,
    }));

    const proposal: AIProposal = {
      id: generateUUID(),
      aiRunId: aiRun.id,
      sourceBranchId: branchId,
      proposalBranchId: branchId,
      status: 'pending',
      patches: proposalPatches,
      validationExpectations: [],
      metadata: pendingTraceUpdates && pendingTraceUpdates.length > 0
        ? { pendingTraceUpdates }
        : undefined,
      createdAt: now(),
    };

    await aiRunRepo.markCompleted(aiRun.id, proposalPatches.map(p => p.patch.metadata?.id).filter(Boolean));

    return await this.createProposal(proposal);
  }

  /**
   * Validate that all edges in patches reference nodes that exist either
   * in the proposal's add_node patches OR in the existing graph.
   */
  private validatePatchNodeReferences(
    patches: any[],
    existingNodeIds?: Set<string>,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const nodeIds = new Set<string>(existingNodeIds);
    for (const patch of patches) {
      if (patch.type === 'add_node' && patch.payload?.id) {
        nodeIds.add(patch.payload.id);
      }
      if (patch.type === 'create_node_from_template' && patch.payload?.nodeId) {
        nodeIds.add(patch.payload.nodeId);
      }
    }

    for (const patch of patches) {
      if (patch.type === 'add_edge') {
        const source = patch.payload?.source;
        const target = patch.payload?.target;

        if (source && !nodeIds.has(source)) {
          errors.push(`Edge ${patch.payload?.id || 'unknown'} references non-existent source node ${source}`);
        }
        if (target && !nodeIds.has(target)) {
          errors.push(`Edge ${patch.payload?.id || 'unknown'} references non-existent target node ${target}`);
        }
      }

      if (patch.type === 'update_node' && patch.payload?.id) {
        if (!nodeIds.has(patch.payload.id)) {
          errors.push(`update_node references non-existent node ${patch.payload.id}`);
        }
      }

      if (patch.type === 'add_artifact' && patch.payload?.nodeId) {
        if (patch.payload.nodeId !== '' && !nodeIds.has(patch.payload.nodeId)) {
          errors.push(`add_artifact references non-existent node ${patch.payload.nodeId}`);
        }
      }

      if (patch.type === 'add_port' && patch.payload?.nodeId) {
        if (!nodeIds.has(patch.payload.nodeId)) {
          errors.push(`add_port references non-existent node ${patch.payload.nodeId}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async acceptProposal(proposalId: string): Promise<void> {
    console.log('[ProposalService] Accepting proposal:', proposalId);

    // Get proposal
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      throw new Error('Proposal not found');
    }

    // Get source branch to check locked nodes
    const branchRepo = this.persistence.getBranchRepository();
    const branchResult = await branchRepo.getById(proposal.sourceBranchId);
    if (!branchResult.success || !branchResult.data) {
      throw new Error('Source branch not found');
    }
    const branch = branchResult.data;

    // Get locked nodes from specification
    let lockedNodeIds: Set<string> = new Set();
    const { SpecificationService } = await import('./SpecificationService.js');
    const specService = new SpecificationService(this.persistence);
    try {
      const specs = await specService.getSpecificationsByProject(branch.projectId);
      const spec = specs.length > 0 ? specs[0] : null;
      if (spec?.lockedNodes && Array.isArray(spec.lockedNodes)) {
        lockedNodeIds = new Set(spec.lockedNodes);
        console.log(`[ProposalService] Found ${lockedNodeIds.size} locked nodes`);
      }
    } catch (err) {
      console.warn('[ProposalService] Could not load specification for locked nodes check:', err);
    }

    let approvedPatches = proposal.patches
      .filter(p => p.status === 'approved')
      .map(p => p.patch);

    if (approvedPatches.length === 0) {
      approvedPatches = proposal.patches
        .filter(p => p.status === 'pending')
        .map(p => p.patch);
    }

    if (approvedPatches.length === 0) {
      throw new Error('No patches to apply');
    }

    // V3 2.1 (2026-09-19): the second check of base_sequence. A patch already
    // marked conflicted blocks the accept until the person rejects it (edits
    // it out) or the agent re-proposes; and the read is checked again now,
    // because the branch may have moved since the proposal was filed. Never
    // partial: one conflict and nothing is applied.
    const alreadyConflicted = proposal.patches.filter(p => p.status === 'conflicted');
    if (alreadyConflicted.length > 0) {
      throw new Error(`${alreadyConflicted.length} patch(es) in this proposal conflict with later changes on the branch. Reject those patches to edit them out, or ask the agent to re-propose against the current head.`);
    }
    const baseSequence = typeof proposal.metadata?.baseSequence === 'number' ? proposal.metadata.baseSequence : null;
    if (baseSequence !== null) {
      const { PatchService: PatchServiceForCheck } = await import('./PatchService.js');
      const later = await new PatchServiceForCheck(this.persistence).loadPatches(proposal.sourceBranchId, { sinceSequence: baseSequence });
      const conflicts = conflictsSince(approvedPatches, later.map(l => ({
        sequence: l.sequence,
        type: l.payload.type,
        payload: l.payload.payload,
        actorType: l.payload.metadata?.actorType ?? l.actorType ?? null,
        summary: l.payload.metadata?.summary ?? l.summary ?? null,
      })));
      if (conflicts.length > 0) {
        const conflictedIds = new Set(conflicts.map(c => c.patchId).filter((x): x is string => x !== null));
        const marked = proposal.patches.map(p => conflictedIds.has(p.patch.metadata.id)
          ? { ...p, status: 'conflicted' as const, conflictReason: describeConflicts(conflicts.filter(c => c.patchId === p.patch.metadata.id)) }
          : p);
        const repo = this.persistence.getProposalRepository();
        await repo.updatePatches(proposalId, marked);
        try {
          const client = this.persistence.getSupabaseClient();
          await client.from('ai_proposals').update({ metadata: { ...(proposal.metadata ?? {}), conflicts, headSequence: later.length > 0 ? later[later.length - 1].sequence : baseSequence } }).eq('id', proposalId);
        } catch { /* the patch statuses carry the verdict; the metadata copy is for get_proposal_status */ }
        throw new Error(`Stale read: ${describeConflicts(conflicts)} Nothing was applied. Reject the conflicted patch(es) to edit them out, or ask the agent to re-propose against the current head.`);
      }
    }

    // AA.5 (owner 2026-09-23): a leased node is locked. A proposal that changes
    // a node someone other than its author (or the person accepting) holds a
    // fresh lease on is refused here, before anything is applied. The author
    // is the credential propose_patches recorded on the proposal.
    {
      let refusal: string | null = null;
      try {
        const client = this.persistence.getSupabaseClient();
        const { data: leaseRows } = await client
          .from('agent_checkouts')
          .select('level, node_id, holder_label, holder_delegate, holder_key_id, since, heartbeat_at')
          .eq('project_id', branch.projectId)
          .in('level', ['node', 'task', 'code'])
          .is('released_at', null);
        if (Array.isArray(leaseRows) && leaseRows.length > 0) {
          const { data: who } = await client.auth.getUser();
          const author = typeof proposal.metadata?.credential === 'string' ? proposal.metadata.credential : null;
          const exempt = [author, who?.user?.id ? `user:${who.user.id}` : null];
          // AL.11: a file or an edge is checked as its node, so the graph is
          // read whenever someone else holds something; AA.3: a box's node
          // lease covers its parts.
          if ([...leasesFromRows(leaseRows as LeaseRowLite[], exempt).values()].some((l) => !l.mine)) {
            const snap = await this.persistence.getGraphRepository().loadSnapshot(proposal.sourceBranchId);
            const g = snap.success ? snap.data?.graphData ?? null : null;
            const { isExplodedNode } = await import('../adapters/graph-to-reactflow.js');
            refusal = acceptLeaseRefusal(approvedPatches, leaseRows as LeaseRowLite[], exempt, g,
              g ? (nodeId) => !!g.nodes[nodeId] && isExplodedNode(g.nodes[nodeId], g) : undefined);
          }
        }
      } catch {
        refusal = null; // the lease read failing never blocks an accept; propose_patches checked at filing
      }
      if (refusal) throw new Error(`${refusal} Nothing was applied.`);
    }

    // Restore externally-stored artifact content before applying
    const hasExternalContent = approvedPatches.some(
      p => p.type === 'add_artifact' && p.payload?.content === '__stored_externally__'
    );
    if (hasExternalContent) {
      const client = this.persistence.getSupabaseClient();
      const { data: artifactRows, error: artifactErr } = await client
        .from('ai_proposal_artifacts')
        .select('artifact_id, content')
        .eq('proposal_id', proposalId);

      if (artifactErr) {
        console.error('[ProposalService] Failed to load artifact content:', artifactErr.message);
      }

      const contentMap = new Map<string, string>();
      if (artifactRows) {
        for (const row of artifactRows) {
          contentMap.set(row.artifact_id, row.content);
        }
      }

      approvedPatches = approvedPatches.map(patch => {
        if (patch.type === 'add_artifact' && patch.payload?.content === '__stored_externally__') {
          const restored = contentMap.get(patch.payload.id);
          if (restored) {
            return { ...patch, payload: { ...patch.payload, content: restored } };
          }
          console.warn(`[ProposalService] Missing stored content for artifact ${patch.payload.id}`);
        }
        return patch;
      });
    }

    // C1 (docs/WORK_LOOP_PLAN.md): materialize content-by-reference artifacts —
    // propose_patches stamped them with a sentinel + contentSource {type:'git',
    // ref}; pull the real bytes from git NOW, before any patch lands. Any file
    // that cannot be fetched aborts the accept loudly (nothing applied yet, so
    // fixing the ref/pushing the commit and re-accepting resumes cleanly) —
    // a bindings-only artifact must never land empty or as the sentinel.
    {
      const { collectGitContentRequests, injectGitContent } = await import('../utils/proposal-git-content.js');
      const { requests, malformed } = collectGitContentRequests(approvedPatches);
      if (malformed.length > 0) {
        throw new Error(`Bindings-only artifacts carry no usable git reference: ${malformed.join(', ')} — resubmit the proposal with content_ref (or inline content)`);
      }
      if (requests.length > 0) {
        const client = this.persistence.getSupabaseClient();
        const { data: integration } = await client
          .from('git_integrations')
          .select('id')
          .eq('project_id', branch.projectId)
          .maybeSingle();
        if (!integration) {
          throw new Error(`This proposal pulls ${requests.length} file(s) from git at accept, but the project has no git integration — reconnect the repository and accept again`);
        }
        const { GitService } = await import('./GitService.js');
        const gitService = new GitService(client);
        const files = new Map<string, string>();
        // Group by ref (normally one — the commit the AI pushed).
        const byRef = new Map<string, string[]>();
        for (const r of requests) byRef.set(r.ref, [...(byRef.get(r.ref) ?? []), r.path]);
        for (const [ref, paths] of byRef) {
          const fetched = await gitService.fetchFileContent(integration.id, paths, undefined, ref);
          for (const f of fetched) files.set(f.path, f.content);
        }
        const injected = injectGitContent(approvedPatches, requests, files);
        if (injected.missing.length > 0) {
          throw new Error(`Content not found in git for: ${injected.missing.join(', ')} — push the commit named by content_ref, then accept again`);
        }
        approvedPatches = injected.patches;
        console.log(`[ProposalService] Materialized ${requests.length} artifact(s) from git`);
      }
    }

    // AG.13: what lands carries no ports, whenever the proposal was filed.
    approvedPatches = withoutPorts(approvedPatches);

    // DEFENSIVE CHECK: Filter out any patches that try to remove locked nodes or their edges
    // This prevents issues when old proposals were created before locked node logic was fixed
    // V3 2.4 (2026-09-19): the server now refuses a batch against a locked
    // node when it is filed (propose_patches, refuseLockedNodeTargets), so a
    // proposal reaching this point was filed before the lock or before that
    // release. This filter stays one release as belt and braces; delete it
    // with the next accept-path change once no pre-2.4 proposals remain.
    const originalCount = approvedPatches.length;

    // First pass: identify nodes being removed (for edge filtering)
    const nodesBeingRemoved = new Set<string>();
    approvedPatches.forEach(patch => {
      const patchType = patch.type;
      if ((patchType === 'remove_node' || patchType === 'delete_node') && 'id' in patch.payload) {
        const nodeId = (patch.payload as { id: string }).id;
        if (nodeId) {
          nodesBeingRemoved.add(nodeId);
        }
      }
    });

    // Second pass: filter out locked node removals and their related edges
    approvedPatches = approvedPatches.filter(patch => {
      const patchType = patch.type;

      // Filter out patches removing locked nodes (handle both remove_node and delete_node)
      if ((patchType === 'remove_node' || patchType === 'delete_node') && 'id' in patch.payload) {
        const nodeId = (patch.payload as { id: string }).id;
        if (nodeId && lockedNodeIds.has(nodeId)) {
          console.warn(`[ProposalService] Filtering out patch that attempts to remove locked node: ${nodeId}`);
          return false;
        }
      }

      // Filter out edges being removed if they connect to a locked node being removed
      if ((patchType === 'remove_edge' || patchType === 'delete_edge') && 'source' in patch.payload && 'target' in patch.payload) {
        const source = patch.payload.source;
        const target = patch.payload.target;
        if (typeof source === 'string' && lockedNodeIds.has(source) && nodesBeingRemoved.has(source)) {
          console.warn(`[ProposalService] 🔒 Filtering out edge removal connected to locked node: ${source}`);
          return false;
        }
        if (typeof target === 'string' && lockedNodeIds.has(target) && nodesBeingRemoved.has(target)) {
          console.warn(`[ProposalService] 🔒 Filtering out edge removal connected to locked node: ${target}`);
          return false;
        }
      }

      return true;
    });

    const filteredCount = originalCount - approvedPatches.length;
    if (filteredCount > 0) {
      console.log(`[ProposalService] 🔒 Filtered out ${filteredCount} patches targeting locked nodes or their edges`);
    }

    if (approvedPatches.length === 0) {
      throw new Error('No valid patches to apply (all patches targeted locked nodes)');
    }

    // Load existing graph nodes so edge validation includes them
    let existingNodeIds = new Set<string>();
    // AD.3 (D22): the files as they were, to tell which ones this accept changes.
    let artifactsBefore: Record<string, { nodeId?: string | null; content?: string; contentHash?: string }> = {};
    try {
      const graphRepo = this.persistence.getGraphRepository();
      const snapshotResult = await graphRepo.loadSnapshot(proposal.sourceBranchId);
      if (snapshotResult.success && snapshotResult.data?.graphData) {
        const currentGraph = snapshotResult.data.graphData as any;
        if (currentGraph.nodes) {
          existingNodeIds = new Set(Object.keys(currentGraph.nodes));
        }
        if (currentGraph.artifacts) artifactsBefore = currentGraph.artifacts;
      }
    } catch (err) {
      console.warn('[ProposalService] Could not load snapshot for node validation:', err);
    }

    console.log('[ProposalService] Validating patch references...');
    const validation = this.validatePatchNodeReferences(approvedPatches, existingNodeIds);
    if (!validation.valid) {
      console.warn(`[ProposalService] Filtering ${validation.errors.length} patches with invalid node references:`, validation.errors.slice(0, 5));
      // Filter out invalid patches instead of throwing
      const invalidPatchIds = new Set<string>();
      for (const patch of approvedPatches) {
        if (patch.type === 'add_edge') {
          const source = patch.payload?.source;
          const target = patch.payload?.target;
          if ((source && !existingNodeIds.has(source)) || (target && !existingNodeIds.has(target))) {
            // Check if source/target is being created by another patch
            const createdByOtherPatch = approvedPatches.some(p =>
              (p.type === 'add_node' && p.payload?.id === source) ||
              (p.type === 'add_node' && p.payload?.id === target) ||
              (p.type === 'create_node_from_template' && p.payload?.nodeId === source) ||
              (p.type === 'create_node_from_template' && p.payload?.nodeId === target)
            );
            if (!createdByOtherPatch && patch.metadata?.id) {
              invalidPatchIds.add(patch.metadata.id);
            }
          }
        }
      }
      if (invalidPatchIds.size > 0) {
        approvedPatches = approvedPatches.filter(p => !invalidPatchIds.has(p.metadata?.id));
        console.warn(`[ProposalService] Removed ${invalidPatchIds.size} invalid patches, ${approvedPatches.length} remaining`);
      }
    }
    if (approvedPatches.length === 0) {
      throw new Error('No valid patches to apply after filtering invalid references');
    }
    console.log('[ProposalService] Patch references validated successfully');

    // Log critical patch types before deduplication
    const criticalPatchSummary = {
      total: approvedPatches.length,
      add_node: approvedPatches.filter(p => p.type === 'add_node').length,
      add_edge: approvedPatches.filter(p => p.type === 'add_edge').length,
      add_contract: approvedPatches.filter(p => p.type === 'add_contract').length,
      add_artifact: approvedPatches.filter(p => p.type === 'add_artifact').length,
    };
    console.log('[ProposalService] Applying patches:', {
      ...criticalPatchSummary,
      branchId: proposal.sourceBranchId,
    });

    // Filter out patches that already exist (idempotent acceptance)
    const { PatchService } = await import('./PatchService.js');
    const patchService = new PatchService(this.persistence);
    const existingPatches = await patchService.loadPatches(proposal.sourceBranchId);
    const existingPatchIds = new Set(existingPatches.map(p => p.id));

    const newPatches = approvedPatches.filter(p => !existingPatchIds.has(p.metadata.id));

    // Log if any add_node patches were filtered by deduplication
    const dedupedNodes = approvedPatches.filter(p => p.type === 'add_node' && existingPatchIds.has(p.metadata.id));
    if (dedupedNodes.length > 0) {
      console.warn(`[ProposalService] DEDUP removed ${dedupedNodes.length} add_node patches:`, dedupedNodes.map(p => ({
        id: p.metadata.id,
        label: (p.payload as any)?.label,
        nodeId: (p.payload as any)?.id,
      })));
    }

    console.log('[ProposalService] Patch status:', {
      total: approvedPatches.length,
      alreadyExists: approvedPatches.length - newPatches.length,
      toInsert: newPatches.length,
      newAddNodes: newPatches.filter(p => p.type === 'add_node').length,
    });

    // Insert patches in batches to avoid Supabase row limits
    if (newPatches.length > 0) {
      const APPEND_BATCH_SIZE = 500;
      if (newPatches.length > APPEND_BATCH_SIZE) {
        console.log(`[ProposalService] Inserting ${newPatches.length} patches in batches of ${APPEND_BATCH_SIZE}`);
        for (let i = 0; i < newPatches.length; i += APPEND_BATCH_SIZE) {
          const batch = newPatches.slice(i, i + APPEND_BATCH_SIZE);
          await patchService.appendPatches(proposal.sourceBranchId, batch);
          console.log(`[ProposalService] Inserted batch ${Math.floor(i / APPEND_BATCH_SIZE) + 1}/${Math.ceil(newPatches.length / APPEND_BATCH_SIZE)} (${Math.min(i + APPEND_BATCH_SIZE, newPatches.length)}/${newPatches.length})`);
        }
      } else {
        await patchService.appendPatches(proposal.sourceBranchId, newPatches);
      }
      console.log('[ProposalService] New patches applied');
    } else {
      console.log('[ProposalService] All patches already exist, skipping insertion');
    }

    console.log('[ProposalService] Rebuilding snapshot...');

    // Get projectId from branch (reuse branch from earlier)
    const projectId = branch.projectId;

    // Rebuild with a large-import-sized timeout and single retry (owner bug
    // 2026-08-12: a 1100-file proposal blew the old 45s ceiling AFTER patches
    // were inserted, stranding the accept mid-way; patch insertion above is
    // idempotent, so a re-accept resumes at this rebuild).
    const REBUILD_TIMEOUT_MS = 150_000;
    const rebuildWithTimeout = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REBUILD_TIMEOUT_MS);
      try {
        await Promise.race([
          this.rebuildSnapshot(projectId, proposal.sourceBranchId),
          new Promise((_, reject) => {
            controller.signal.addEventListener('abort', () =>
              reject(new Error('Snapshot rebuild timed out — click Apply again to resume; already-applied changes are kept, not duplicated'))
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    };

    try {
      await rebuildWithTimeout();
    } catch (err) {
      console.warn('[ProposalService] First rebuild attempt failed, retrying:', err instanceof Error ? err.message : String(err));
      await rebuildWithTimeout();
    }

    console.log('[ProposalService] Snapshot rebuilt, creating specification mappings...');

    // Create specification_mappings for architecture nodes
    await this.createArchitectureMappings(projectId, proposal);

    console.log('[ProposalService] Marking proposal as merged');

    // Mark as merged
    await this.updateProposalStatus(proposalId, 'merged');

    // V3 AD.1 (D5, D8): a baseline riding on this proposal moves now that
    // its design is on the canvas: an adopt at connect sets the branch's
    // first baseline, an agent's reconcile resolves the change card it
    // answered, and (AD.2b) a load of git's model moves the last sync to the
    // commit it read and answers the cards it answers. Best-effort: otherwise
    // nothing moves, and the push guard or the card keeps asking.
    if (proposal.metadata?.source === 'git-adopt' || proposal.metadata?.source === 'git-load' || proposal.metadata?.reconcilesChange) {
      try {
        const client = this.persistence.getSupabaseClient();
        const { data: integration } = await client
          .from('git_integrations').select('id').eq('project_id', branch.projectId).maybeSingle();
        if (integration?.id) {
          const { GitService } = await import('./GitService.js');
          await new GitService(client).proposalBaseline(integration.id, proposalId);
        }
      } catch (err) {
        console.warn('[ProposalService] proposal baseline not moved (the card or the push guard keeps asking):', err instanceof Error ? err.message : String(err));
      }
    }

    // V3 AD.3 (D22): a file this accept changed on the canvas makes the
    // evidence its node's git-ticked criteria gave go stale ("re-verify"),
    // exactly as the Git panel's file accept does: every lane that brings a
    // file change onto the canvas, not only the buttons. Best-effort.
    {
      const { nodesWithChangedFiles, flagNodeEvidenceStale } = await import('./evidenceStale.js');
      const changedNodes = nodesWithChangedFiles(approvedPatches, artifactsBefore);
      if (changedNodes.length > 0) {
        const meta = (proposal.metadata ?? {}) as { reconcilesChange?: { commitSha?: string }; loadsModel?: { headSha?: string } };
        const sourceCommit = meta.reconcilesChange?.commitSha ?? meta.loadsModel?.headSha ?? undefined;
        const client = this.persistence.getSupabaseClient();
        for (const nodeId of changedNodes) {
          try {
            await flagNodeEvidenceStale(client, branch.projectId, nodeId, sourceCommit);
          } catch (err) {
            console.warn('[ProposalService] Evidence staleness was not recorded for', nodeId, err);
          }
        }
      }
    }

    // RI-12 (2026-09-05): for a repo-import proposal the accept trigger only
    // RECORDS the repo-index promotion (a one-statement write of a large
    // repository's rows outran the statement timeout on Twenty); the
    // repo-import chain writes the index in pages. Kick it now so the index
    // lands right behind the canvas — best-effort: run_repo_import re-kicks
    // a stalled promotion on its next poll, so a failed kick costs latency,
    // never the index.
    const jobId = proposal.metadata?.jobId;
    if (typeof jobId === 'string' && jobId) {
      try {
        const { ImportJobService } = await import('./ImportJobService.js');
        await new ImportJobService(this.persistence.getSupabaseClient()).startChain(jobId, 'promote');
      } catch (err) {
        console.warn('[ProposalService] repo index promotion kick failed (run_repo_import re-kicks it):', err instanceof Error ? err.message : String(err));
      }
    }

    console.log('[ProposalService] ✅ Proposal accepted successfully');
  }

  /**
   * Create specification_mappings after architecture is applied.
   * Links architecture nodes to features and requirements.
   */
  private async createArchitectureMappings(projectId: string, proposal: any): Promise<void> {
    try {
      // Check if this proposal has architecture nodes
      // Patches use domain format: { patch: { type: 'add_node', payload: {...} }, status: 'pending' }
      const hasArchitectureNodes = proposal.patches.some((p: any) =>
        p.patch?.type === 'add_node'
      );

      if (!hasArchitectureNodes) {
        console.log('[ProposalService] No architecture nodes in proposal, skipping mappings');
        return;
      }

      console.log('[ProposalService] Found architecture nodes in proposal');

      // Get specification for this project
      const { SpecificationService } = await import('./SpecificationService.js');
      const specService = new SpecificationService(this.persistence);

      const specifications = await specService.getSpecificationsByProject(projectId);
      if (!specifications || specifications.length === 0) {
        console.log('[ProposalService] No specification for project, skipping mappings');
        return;
      }

      const specification = specifications[0];
      const specificationId = specification.id;

      if (specification.preferences?.specEnabled === false) {
        console.log('[ProposalService] Spec disabled (architecture-first), skipping mappings');
        return;
      }

      console.log('[ProposalService] Creating mappings for specification:', specificationId);

      const mappingsRepo = this.persistence.getMappingsRepository();

      const requirements = await specService.getRequirementsBySpecification(specificationId);

      if (!requirements || requirements.length === 0) {
        console.log('[ProposalService] No requirements found, skipping mappings');
        return;
      }

      console.log(`[ProposalService] Found ${requirements.length} requirements`);

      const allNodePatches = proposal.patches.filter((p: any) => p.patch?.type === 'add_node');
      const implementationNodeIds = allNodePatches
        .filter((p: any) => {
          const nodeType = p.patch.payload?.type || '';
          const containerDef = getContainerTypeById(nodeType);
          const isContainer = !!containerDef;
          if (isContainer) {
            console.log(`[ProposalService] Filtering out container node: ${p.patch.payload?.label} (${nodeType})`);
          }
          return !isContainer;
        })
        .map((p: any) => p.patch.payload?.id)
        .filter(Boolean);

      console.log(`[ProposalService] Extracted ${implementationNodeIds.length} implementation node IDs (filtered ${allNodePatches.length - implementationNodeIds.length} container nodes)`);
      const nodeIds = implementationNodeIds;

      // Check for existing mappings to avoid duplicates
      const existingMappingsResult = await mappingsRepo.getBySpecification(specificationId);
      const existingNodeIds = new Set(
        existingMappingsResult.success
          ? existingMappingsResult.data.map((m: any) => m.nodeId)
          : []
      );

      // Build a lookup of node payloads from proposal patches for heuristic matching
      const nodePayloadMap = new Map<string, { label: string; type: string; technology?: string }>();
      for (const p of allNodePatches) {
        const payload = p.patch?.payload;
        if (payload?.id) {
          nodePayloadMap.set(payload.id, {
            label: payload.label || '',
            type: payload.type || '',
            technology: payload.technology || '',
          });
        }
      }

      // Create mappings: heuristic keyword matching between nodes and requirements
      const mappings: any[] = [];
      for (const nodeId of nodeIds) {
        if (existingNodeIds.has(nodeId)) continue;

        const nodeInfo = nodePayloadMap.get(nodeId);
        if (!nodeInfo) continue;

        const nodeTerms = extractMatchTerms(
          nodeInfo.label,
          nodeInfo.type,
          nodeInfo.technology || ''
        );
        if (nodeTerms.length === 0) continue;

        let bestMatch: { reqId: string; score: number } | null = null;

        for (const req of requirements) {
          const reqTerms = extractMatchTerms(
            req.name,
            req.description || '',
            req.category,
            ...(req.acceptanceCriteria || []).map((ac: { text: string }) => ac.text)
          );

          const score = computeOverlapScore(nodeTerms, reqTerms);
          if (score > 0 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { reqId: req.id, score };
          }
        }

        if (bestMatch && bestMatch.score >= 2) {
          const confidence = Math.min(0.9, 0.5 + bestMatch.score * 0.1);
          mappings.push({
            specificationId,
            requirementId: bestMatch.reqId,
            nodeId,
            mappingType: 'implements' as const,
            confidence: Math.round(confidence * 100) / 100,
            notes: `Auto-mapped by keyword heuristic (score: ${bestMatch.score})`,
          });
        }
      }

      if (mappings.length > 0) {
        console.log(`[ProposalService] Creating ${mappings.length} specification_mappings...`);
        const result = await mappingsRepo.bulkCreate(mappings);
        if (result.success) {
          console.log('[ProposalService] ✅ Specification mappings created successfully');
        } else {
          console.error('[ProposalService] ❌ Failed to create mappings:', result.error);
        }
      } else {
        console.log('[ProposalService] No mappings to create');
      }
    } catch (error) {
      console.error('[ProposalService] Error creating architecture mappings:', error);
      // Don't fail the whole proposal acceptance if mappings fail
    }
  }

  /**
   * Rebuild graph snapshot after patches are applied.
   * This ensures the canvas can load the updated graph.
   */
  private async rebuildSnapshot(projectId: string, branchId: string): Promise<void> {
    console.log('[ProposalService] Rebuilding snapshot for branch:', branchId);

    const { applyPatches } = await import('@nodespec/core/patch-engine.js');
    const { createEmptyGraph } = await import('@nodespec/core/utils.js');
    const graphRepo = this.persistence.getGraphRepository();
    const patchRepo = this.persistence.getPatchRepository();

    const BATCH_SIZE = 50;

    const applyInBatches = async (baseGraph: any, patches: any[]): Promise<{ graph: any; patchCount: number } | null> => {
      if (patches.length === 0) return null;

      let currentGraph = baseGraph;
      for (let i = 0; i < patches.length; i += BATCH_SIZE) {
        const batch = patches.slice(i, i + BATCH_SIZE);
        const result = applyPatches(currentGraph, batch);
        if (!result.success || !result.graph) {
          // One patch in the batch failed; re-apply one at a time so the
          // offender is named instead of the whole batch being blamed.
          console.warn(`[ProposalService] Batch ${i}-${i + batch.length} failed, isolating the failing patch`);
          for (const patch of batch) {
            const singleResult = applyPatches(currentGraph, [patch]);
            if (singleResult.success && singleResult.graph) {
              currentGraph = singleResult.graph;
              continue;
            }
            // Hard fail (2026-09-18). A patch that would not apply used to be
            // counted into droppedCount and tolerated beneath a ratio/count
            // threshold, reported only to the console. That is how an explode
            // silently lost seven edges on a production project: the seven
            // remove_edge patches retiring the old container applied, the
            // seven add_edge patches meant to replace them failed
            // CONTRACT_NOT_FOUND (they referenced contracts no add_contract
            // ever created), and the approval reported success with the edges
            // gone from the canvas and still sitting in graph_patches. Seven
            // out of ~135 was 5.2%, under both thresholds, so nothing
            // surfaced. Nothing is discarded now: the accept fails, names the
            // patch and the reason, and the snapshot is left alone so it can
            // never disagree with the patch log.
            const err = singleResult.error;
            throw new Error(
              `Patch application failed — no patch was discarded and the snapshot was NOT saved. ` +
              `Offending patch: ${patch?.type ?? 'unknown type'}` +
              (patch?.payload?.id ? ` ${patch.payload.id}` : '') +
              ` — ${err?.code ?? 'UNKNOWN'}: ${err?.message ?? 'no error reported'}` +
              (err?.path ? ` (at ${err.path})` : '') +
              `. Resolve what the patch references (a contract, node or artifact that does not exist in the graph) and re-accept.`
            );
          }
        } else {
          currentGraph = result.graph;
        }
        if (patches.length > BATCH_SIZE) {
          console.log(`[ProposalService] Applying patches (${Math.min(i + BATCH_SIZE, patches.length)}/${patches.length})...`);
        }
        if (i + BATCH_SIZE < patches.length) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      return { graph: currentGraph, patchCount: patches.length };
    };

    try {
      let finalGraph: any = null;
      let totalPatchCount = 0;

      const snapshotResult = await graphRepo.loadSnapshot(branchId);
      const existingSnapshot = snapshotResult.success ? snapshotResult.data : null;
      const existingNodeCount = existingSnapshot?.graphData?.nodes
        ? Object.keys(existingSnapshot.graphData.nodes).length
        : 0;

      if (existingSnapshot) {
        const baseGraph = existingSnapshot.graphData;
        const baseSequence = existingSnapshot.patchSequence;
        console.log('[ProposalService] Trying incremental rebuild from snapshot at seq', baseSequence, 'with', existingNodeCount, 'nodes');

        const patchesResult = await patchRepo.loadPatches(branchId, { sinceSequence: baseSequence });

        if (patchesResult.success && patchesResult.data.length > 0) {
          const patchPayloads = patchesResult.data.map((p: any) => p.payload);
          const incrementalResult = await applyInBatches(baseGraph, patchPayloads);
          if (incrementalResult) {
            finalGraph = incrementalResult.graph;
            totalPatchCount = baseSequence + incrementalResult.patchCount;
            console.log('[ProposalService] Incremental rebuild succeeded');
          }
        } else if (patchesResult.success && patchesResult.data.length === 0) {
          // No patches after snapshot sequence - check for sequence mismatch
          const latestSeqResult = await patchRepo.getLatestSequence(branchId);
          const actualMaxSeq = latestSeqResult.success ? latestSeqResult.data : 0;

          if (baseSequence > actualMaxSeq && actualMaxSeq > 0) {
            // Snapshot has inflated sequence (created outside patch flow)
            // Use existing snapshot as base and apply patches since actual max - batch size
            console.warn(`[ProposalService] Sequence mismatch detected: snapshot seq=${baseSequence}, actual max=${actualMaxSeq}. Using snapshot as-is with incremental from actual patches.`);
            const recentPatches = await patchRepo.loadPatches(branchId, { sinceSequence: Math.max(0, actualMaxSeq - 50) });
            if (recentPatches.success && recentPatches.data.length > 0) {
              const patchPayloads = recentPatches.data.map((p: any) => p.payload);
              // applyInBatches throws on a patch that will not apply, so
              // reaching here means every recent patch landed.
              const patchResult = await applyInBatches(baseGraph, patchPayloads);
              if (patchResult) {
                finalGraph = patchResult.graph;
                totalPatchCount = actualMaxSeq;
                console.log('[ProposalService] Mismatch recovery: applied recent patches on existing snapshot');
              } else {
                finalGraph = baseGraph;
                totalPatchCount = actualMaxSeq;
                console.log('[ProposalService] Mismatch recovery: no recent patches, correcting sequence only');
              }
            } else {
              // No patches to apply - just re-save with correct sequence
              finalGraph = baseGraph;
              totalPatchCount = actualMaxSeq;
              console.log('[ProposalService] Mismatch recovery: re-saving snapshot with corrected sequence');
            }
          } else {
            // Snapshot is current, nothing to rebuild
            console.log('[ProposalService] Snapshot is already current, no rebuild needed');
            return;
          }
        }

        if (!finalGraph) {
          console.warn('[ProposalService] Incremental rebuild failed, falling back to full replay');
        }
      }

      if (!finalGraph) {
        console.log('[ProposalService] Full replay from empty graph');
        const emptyGraph = createEmptyGraph();
        const patchesResult = await patchRepo.loadPatches(branchId, { sinceSequence: 0 });
        if (patchesResult.success && patchesResult.data.length > 0) {
          const patchPayloads = patchesResult.data.map((p: any) => p.payload);
          // A full replay only runs when there is no snapshot to build on, so
          // it replays the branch's whole history. applyInBatches throws on
          // the first patch that will not apply: a log carrying history that
          // no longer replays cleanly is a real defect and is reported, never
          // absorbed into a quietly degraded snapshot.
          const fullResult = await applyInBatches(emptyGraph, patchPayloads);
          if (fullResult) {
            finalGraph = fullResult.graph;
            totalPatchCount = fullResult.patchCount;
            console.log('[ProposalService] Full replay succeeded');
          }
        }
      }

      if (!finalGraph) {
        console.warn('[ProposalService] No patches to apply, snapshot unchanged');
        return;
      }

      // Safety guard: prevent snapshot regression
      const newNodeCount = Object.keys(finalGraph.nodes).length;
      const edgeCount = Object.keys(finalGraph.edges).length;
      console.log('[ProposalService] Rebuilt graph:', { nodeCount: newNodeCount, edgeCount });

      if (existingNodeCount > 0 && newNodeCount < existingNodeCount) {
        const lostNodes = existingNodeCount - newNodeCount;
        const lostRatio = lostNodes / existingNodeCount;

        // Check if there were explicit remove_node patches that justify the loss
        const allPatches = await patchRepo.loadPatches(branchId, { sinceSequence: existingSnapshot!.patchSequence });
        const removeNodePatches = allPatches.success
          ? allPatches.data.filter((p: any) => p.payload?.type === 'remove_node' || p.payload?.type === 'delete_node').length
          : 0;

        if (lostNodes > removeNodePatches && lostRatio > 0.5) {
          // Throw, not return (2026-07-16): a silent return here left the system in a partial
          // commit — patches already appended to graph_patches, snapshot save skipped, proposal
          // still marked merged — with the persisted snapshot permanently behind the patch log
          // and no user-visible error. Failing loudly surfaces it through acceptProposal's
          // existing error path instead. (Note: this guard cannot fire on a well-formed
          // remove_node deletion — each remove_node removes exactly one node, so
          // lostNodes <= removeNodePatches always; it only fires on genuinely unaccounted loss.)
          throw new Error(
            `Snapshot regression blocked: rebuilding would lose ${lostNodes} nodes (${existingNodeCount} -> ${newNodeCount}) with only ${removeNodePatches} explicit remove patches. Snapshot NOT saved; the patch log is ahead of the persisted snapshot — investigate before re-accepting.`
          );
        }

        if (lostNodes > removeNodePatches) {
          console.warn(`[ProposalService] Node count decreased by ${lostNodes} (${existingNodeCount} -> ${newNodeCount}) with only ${removeNodePatches} explicit removals. Proceeding with caution.`);
        }
      }

      const snapshotSaveResult = await graphRepo.saveSnapshot(
        projectId, branchId, finalGraph, totalPatchCount
      );

      if (snapshotSaveResult.success) {
        console.log('[ProposalService] Snapshot saved:', {
          snapshotId: snapshotSaveResult.data.id,
          sequence: totalPatchCount, nodeCount: newNodeCount, edgeCount,
        });
      } else {
        throw new Error('Failed to save snapshot: ' + snapshotSaveResult.error.message);
      }
    } catch (error) {
      console.error('[ProposalService] Error rebuilding snapshot:', error);
      throw error;
    }
  }


  async deleteProposal(proposalId: string): Promise<void> {
    const repo = this.persistence.getProposalRepository();
    const result = await repo.delete(proposalId);
    if (!result.success) {
      throw new Error(result.error.message);
    }
  }
}

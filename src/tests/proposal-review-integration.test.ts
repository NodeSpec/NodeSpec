import { describe, it, expect } from 'vitest';
import {
  cherryPickProposalPatches,
  approveAllPatches,
  mergeApprovedPatches,
  computePatchPreview,
  enrichProposalWithPreviews,
  createProposal,
  createProposalBranch,
  rejectProposal,
} from '@nodespec/core/ai-proposal.js';
import type { AIProposal, ProposalPatch, AIOutput } from '@nodespec/core/ai-proposal.js';
import { createEmptyGraph, generateUUID, now } from '@nodespec/core/utils.js';
import { createBranch } from '@nodespec/core/branch.js';
import type { PatchOperation } from '@nodespec/core/types.js';

function makeAddNodePatch(nodeId: string, label: string): PatchOperation {
  return {
    type: 'add_node',
    metadata: {
      id: generateUUID(),
      actorType: 'ai',
      summary: `Add node: ${label}`,
      timestamp: now(),
    },
    payload: {
      id: nodeId,
      type: 'backend-service',
      label,
      status: 'draft',
      metadata: {},
    },
  } as PatchOperation;
}

function makeAddContractPatch(contractId: string, name: string): PatchOperation {
  return {
    type: 'add_contract',
    metadata: {
      id: generateUUID(),
      actorType: 'ai',
      summary: `Add contract: ${name}`,
      timestamp: now(),
    },
    payload: {
      id: contractId,
      kind: 'rest',
      name,
      schema: {},
      metadata: {},
    },
  } as PatchOperation;
}

function makeAddEdgePatch(sourceId: string, targetId: string, contractId: string): PatchOperation {
  return {
    type: 'add_edge',
    metadata: {
      id: generateUUID(),
      actorType: 'ai',
      summary: `Add edge`,
      timestamp: now(),
    },
    payload: {
      id: generateUUID(),
      source: sourceId,
      target: targetId,
      contractId,
      metadata: {},
    },
  } as PatchOperation;
}

function makeAddArtifactPatch(nodeId: string, path: string): PatchOperation {
  return {
    type: 'add_artifact',
    metadata: {
      id: generateUUID(),
      actorType: 'ai',
      summary: `Add artifact: ${path}`,
      timestamp: now(),
    },
    payload: {
      id: generateUUID(),
      nodeId,
      kind: 'source',
      path,
      content: `// ${path}`,
      language: 'typescript',
      createdAt: now(),
      updatedAt: now(),
      metadata: {},
    },
  } as PatchOperation;
}

function createArchitectureProposal(opts: {
  nodes: number;
  contracts: number;
  edges: number;
  artifacts: number;
}): AIProposal {
  const nodeIds: string[] = [];
  const contractIds: string[] = [];
  const patches: ProposalPatch[] = [];

  for (let i = 0; i < opts.contracts; i++) {
    const cid = generateUUID();
    contractIds.push(cid);
    patches.push({
      patch: makeAddContractPatch(cid, `API Contract ${i + 1}`),
      explanation: `REST API contract for service communication`,
      status: 'pending',
    });
  }

  for (let i = 0; i < opts.nodes; i++) {
    const nid = generateUUID();
    nodeIds.push(nid);
    patches.push({
      patch: makeAddNodePatch(nid, `Service ${i + 1}`),
      explanation: `Backend service for handling domain logic`,
      status: 'pending',
    });

    const artifactsPerNode = Math.ceil(opts.artifacts / opts.nodes);
    for (let j = 0; j < artifactsPerNode; j++) {
      patches.push({
        patch: makeAddArtifactPatch(nid, `src/service-${i + 1}/handler-${j + 1}.ts`),
        explanation: `Handler implementation`,
        status: 'pending',
      });
    }
  }

  for (let i = 0; i < opts.edges && nodeIds.length >= 2; i++) {
    const srcIdx = i % nodeIds.length;
    const tgtIdx = (i + 1) % nodeIds.length;
    if (srcIdx !== tgtIdx && contractIds.length > 0) {
      patches.push({
        patch: makeAddEdgePatch(nodeIds[srcIdx], nodeIds[tgtIdx], contractIds[i % contractIds.length]),
        explanation: `Service dependency`,
        status: 'pending',
      });
    }
  }

  return {
    id: generateUUID(),
    aiRunId: generateUUID(),
    sourceBranchId: generateUUID(),
    proposalBranchId: generateUUID(),
    status: 'pending',
    patches,
    validationExpectations: ['All services should be connected', 'Contracts should define REST endpoints'],
    createdAt: now(),
  };
}

describe('Architecture Proposal Review Integration', () => {
  describe('AI Generation Proposal Flow', () => {
    it('should create a proposal from AI output with proper structure', () => {
      const sourceBranch = createBranch('main', null, []);
      const aiRunId = generateUUID();
      const proposalBranch = createProposalBranch(sourceBranch, aiRunId);

      const nodeId = generateUUID();
      const contractId = generateUUID();
      const aiOutput: AIOutput = {
        patches: [
          makeAddContractPatch(contractId, 'User API'),
          makeAddNodePatch(nodeId, 'User Service'),
        ],
        explanations: [
          'REST API contract for user management',
          'Backend service handling user logic',
        ],
        validation_expectations: ['User Service should handle CRUD operations'],
      };

      const proposal = createProposal(aiRunId, sourceBranch.id, proposalBranch, aiOutput);

      expect(proposal.patches.length).toBe(2);
      expect(proposal.patches.every(p => p.status === 'pending')).toBe(true);
      expect(proposal.validationExpectations).toContain('User Service should handle CRUD operations');
      expect(proposal.aiRunId).toBe(aiRunId);
      expect(proposal.status).toBe('pending');
    });

    it('should support approve-all then merge for architecture generation', () => {
      const graph = createEmptyGraph();
      const branch = createBranch('main', null, []);
      const proposal = createArchitectureProposal({ nodes: 3, contracts: 2, edges: 2, artifacts: 6 });

      const approved = approveAllPatches(proposal);
      const approvedCount = approved.patches.filter(p => p.status === 'approved').length;
      expect(approvedCount).toBe(approved.patches.length);

      const result = mergeApprovedPatches(approved, branch, graph);
      expect(result.success).toBe(true);
      expect(result.mergedPatches.length).toBe(approved.patches.length);
      expect(result.finalGraph).toBeDefined();
      expect(Object.keys(result.finalGraph!.nodes).length).toBe(3);
      expect(Object.keys(result.finalGraph!.contracts).length).toBe(2);
    });

    it('should support reject proposal for architecture generation', () => {
      const proposal = createArchitectureProposal({ nodes: 2, contracts: 1, edges: 1, artifacts: 4 });

      const rejected = rejectProposal(proposal);
      expect(rejected.status).toBe('rejected');
      expect(rejected.reviewedAt).toBeDefined();
    });
  });

  describe('Per-Patch Cherry-Pick for Architecture Proposals', () => {
    it('should allow approving only node patches from architecture proposal', () => {
      const proposal = createArchitectureProposal({ nodes: 3, contracts: 2, edges: 2, artifacts: 6 });
      const nodePatches = proposal.patches.filter(p => p.patch.type === 'add_node');
      const nodePatchIds = nodePatches.map(p => p.patch.metadata.id);

      const updated = cherryPickProposalPatches(proposal, nodePatchIds);

      const approved = updated.patches.filter(p => p.status === 'approved');
      expect(approved.length).toBe(3);
      expect(approved.every(p => p.patch.type === 'add_node')).toBe(true);

      const pending = updated.patches.filter(p => p.status === 'pending');
      expect(pending.length).toBe(proposal.patches.length - 3);
    });

    it('should allow approving contracts + nodes but not edges', () => {
      const proposal = createArchitectureProposal({ nodes: 2, contracts: 1, edges: 1, artifacts: 4 });

      const contractAndNodeIds = proposal.patches
        .filter(p => p.patch.type === 'add_contract' || p.patch.type === 'add_node')
        .map(p => p.patch.metadata.id);

      const updated = cherryPickProposalPatches(proposal, contractAndNodeIds);

      const approvedTypes = new Set(
        updated.patches.filter(p => p.status === 'approved').map(p => p.patch.type)
      );
      expect(approvedTypes.has('add_contract')).toBe(true);
      expect(approvedTypes.has('add_node')).toBe(true);
      expect(approvedTypes.has('add_edge')).toBe(false);
      expect(approvedTypes.has('add_artifact')).toBe(false);
    });

    it('should toggle individual patches on and off', () => {
      const proposal = createArchitectureProposal({ nodes: 3, contracts: 1, edges: 1, artifacts: 3 });
      const firstPatchId = proposal.patches[0].patch.metadata.id;
      const secondPatchId = proposal.patches[1].patch.metadata.id;

      const withFirst = cherryPickProposalPatches(proposal, [firstPatchId]);
      expect(withFirst.patches.find(p => p.patch.metadata.id === firstPatchId)?.status).toBe('approved');
      expect(withFirst.patches.find(p => p.patch.metadata.id === secondPatchId)?.status).toBe('pending');

      const withBoth = cherryPickProposalPatches(withFirst, [firstPatchId, secondPatchId]);
      expect(withBoth.patches.find(p => p.patch.metadata.id === firstPatchId)?.status).toBe('approved');
      expect(withBoth.patches.find(p => p.patch.metadata.id === secondPatchId)?.status).toBe('approved');

      const withOnlySecond = cherryPickProposalPatches(withBoth, [secondPatchId]);
      expect(withOnlySecond.patches.find(p => p.patch.metadata.id === firstPatchId)?.status).toBe('pending');
      expect(withOnlySecond.patches.find(p => p.patch.metadata.id === secondPatchId)?.status).toBe('approved');
    });
  });

  describe('Conflict Detection in Architecture Proposals', () => {
    it('should detect conflicts when a node already exists', () => {
      const graph = createEmptyGraph();
      const existingNodeId = generateUUID();
      graph.nodes[existingNodeId] = {
        id: existingNodeId,
        type: 'backend-service',
        label: 'Existing Service',
        metadata: {},
      };

      const branch = createBranch('main', null, []);
      const proposal = createArchitectureProposal({ nodes: 2, contracts: 1, edges: 1, artifacts: 2 });

      proposal.patches.unshift({
        patch: makeAddNodePatch(existingNodeId, 'Conflicting Service'),
        explanation: 'This will conflict',
        status: 'pending',
      });

      const approved = approveAllPatches(proposal);
      const result = mergeApprovedPatches(approved, branch, graph);

      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.skippedPatches.length).toBeGreaterThan(0);
      expect(result.mergedPatches.length).toBeGreaterThan(0);
    });

    it('should enrich proposal with conflict markers', () => {
      const graph = createEmptyGraph();
      const existingNodeId = generateUUID();
      graph.nodes[existingNodeId] = {
        id: existingNodeId,
        type: 'backend-service',
        label: 'Existing',
        metadata: {},
      };

      const proposal: AIProposal = {
        id: generateUUID(),
        aiRunId: generateUUID(),
        sourceBranchId: generateUUID(),
        proposalBranchId: generateUUID(),
        status: 'pending',
        patches: [
          {
            patch: makeAddNodePatch(existingNodeId, 'Duplicate'),
            explanation: 'Will conflict',
            status: 'pending',
          },
          {
            patch: makeAddNodePatch(generateUUID(), 'New Service'),
            explanation: 'No conflict',
            status: 'pending',
          },
        ],
        validationExpectations: [],
        createdAt: now(),
      };

      const enriched = enrichProposalWithPreviews(proposal, graph);

      const conflicted = enriched.patches.filter(p => p.status === 'conflicted');
      expect(conflicted.length).toBe(1);
      expect(conflicted[0].conflictReason).toBeDefined();

      const nonConflicted = enriched.patches.filter(p => p.status !== 'conflicted');
      expect(nonConflicted.length).toBe(1);
      expect(nonConflicted[0].previewAfter).toBeDefined();
    });

    it('should not allow merging conflicted patches even if approved', () => {
      const graph = createEmptyGraph();
      const existingNodeId = generateUUID();
      graph.nodes[existingNodeId] = {
        id: existingNodeId,
        type: 'backend-service',
        label: 'Existing',
        metadata: {},
      };

      const proposal: AIProposal = {
        id: generateUUID(),
        aiRunId: generateUUID(),
        sourceBranchId: generateUUID(),
        proposalBranchId: generateUUID(),
        status: 'pending',
        patches: [{
          patch: makeAddNodePatch(existingNodeId, 'Duplicate'),
          explanation: 'Will conflict',
          status: 'approved',
        }],
        validationExpectations: [],
        createdAt: now(),
      };

      const branch = createBranch('main', null, []);
      const result = mergeApprovedPatches(proposal, branch, graph);

      expect(result.success).toBe(false);
      expect(result.conflicts.length).toBe(1);
      expect(result.mergedPatches.length).toBe(0);
    });
  });

  describe('Preview Computation for Architecture Changes', () => {
    it('should compute before/after previews for add_node', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const patch = makeAddNodePatch(nodeId, 'New Service');

      const preview = computePatchPreview(graph, patch);
      expect(preview).not.toBeNull();
      expect(preview!.before).toBeNull();
      expect(preview!.after).toBeDefined();
      expect((preview!.after as any).label).toBe('New Service');
    });

    it('should compute before/after previews for add_contract', () => {
      const graph = createEmptyGraph();
      const contractId = generateUUID();
      const patch = makeAddContractPatch(contractId, 'User API');

      const preview = computePatchPreview(graph, patch);
      expect(preview).not.toBeNull();
      expect(preview!.before).toBeNull();
      expect(preview!.after).toBeDefined();
      expect((preview!.after as any).name).toBe('User API');
    });

    it('should enrich all proposal patches with previews in dependency order', () => {
      const graph = createEmptyGraph();
      const proposal = createArchitectureProposal({ nodes: 3, contracts: 2, edges: 2, artifacts: 6 });

      const enriched = enrichProposalWithPreviews(proposal, graph);

      const withPreviews = enriched.patches.filter(
        p => p.previewAfter !== undefined || p.previewBefore !== undefined
      );
      expect(withPreviews.length).toBeGreaterThan(0);

      const conflicted = enriched.patches.filter(p => p.status === 'conflicted');
      expect(conflicted.length).toBe(0);
    });
  });

  describe('Category Grouping for Architecture Proposals', () => {
    function categorize(patches: ProposalPatch[]) {
      const cats: Record<string, ProposalPatch[]> = {
        nodes: [], edges: [], contracts: [], artifacts: [], ports: [], other: [],
      };
      for (const pp of patches) {
        const type = pp.patch.type;
        if (type.includes('node') && !type.includes('group')) cats.nodes.push(pp);
        else if (type.includes('edge')) cats.edges.push(pp);
        else if (type.includes('contract')) cats.contracts.push(pp);
        else if (type.includes('artifact')) cats.artifacts.push(pp);
        else if (type.includes('port')) cats.ports.push(pp);
        else cats.other.push(pp);
      }
      return cats;
    }

    it('should categorize architecture proposal patches correctly', () => {
      const proposal = createArchitectureProposal({ nodes: 4, contracts: 3, edges: 3, artifacts: 8 });
      const cats = categorize(proposal.patches);

      expect(cats.nodes.length).toBe(4);
      expect(cats.contracts.length).toBe(3);
      expect(cats.edges.length).toBe(3);
      expect(cats.artifacts.length).toBe(8);
      expect(cats.ports.length).toBe(0);
      expect(cats.other.length).toBe(0);
    });

    it('should build summary text from categorized patches', () => {
      const proposal = createArchitectureProposal({ nodes: 3, contracts: 2, edges: 2, artifacts: 6 });
      const cats = categorize(proposal.patches);

      const parts: string[] = [];
      if (cats.nodes.length > 0) parts.push(`${cats.nodes.length} nodes`);
      if (cats.artifacts.length > 0) parts.push(`${cats.artifacts.length} artifacts`);
      if (cats.contracts.length > 0) parts.push(`${cats.contracts.length} contracts`);
      if (cats.edges.length > 0) parts.push(`${cats.edges.length} edges`);
      const summary = parts.join(', ');

      expect(summary).toContain('3 nodes');
      expect(summary).toContain('6 artifacts');
      expect(summary).toContain('2 contracts');
      expect(summary).toContain('2 edges');
    });

    it('should allow per-category approve then partial merge', () => {
      const graph = createEmptyGraph();
      const branch = createBranch('main', null, []);
      const proposal = createArchitectureProposal({ nodes: 3, contracts: 2, edges: 2, artifacts: 6 });
      const cats = categorize(proposal.patches);

      const contractAndNodeIds = [
        ...cats.contracts.map(p => p.patch.metadata.id),
        ...cats.nodes.map(p => p.patch.metadata.id),
      ];

      const partialApproved = cherryPickProposalPatches(proposal, contractAndNodeIds);
      const result = mergeApprovedPatches(partialApproved, branch, graph);

      expect(result.success).toBe(true);
      expect(result.mergedPatches.length).toBe(contractAndNodeIds.length);
      expect(Object.keys(result.finalGraph!.nodes).length).toBe(3);
      expect(Object.keys(result.finalGraph!.contracts).length).toBe(2);
      expect(Object.keys(result.finalGraph!.edges).length).toBe(0);
    });
  });

  describe('Large Architecture Proposal Handling', () => {
    it('should handle proposal with 20+ nodes and 60+ patches', () => {
      const graph = createEmptyGraph();
      const branch = createBranch('main', null, []);
      const proposal = createArchitectureProposal({ nodes: 20, contracts: 10, edges: 15, artifacts: 40 });

      expect(proposal.patches.length).toBeGreaterThan(60);

      const approved = approveAllPatches(proposal);
      const result = mergeApprovedPatches(approved, branch, graph);

      expect(result.success).toBe(true);
      expect(Object.keys(result.finalGraph!.nodes).length).toBe(20);
      expect(Object.keys(result.finalGraph!.contracts).length).toBe(10);
    });

    it('should maintain patch ordering integrity during enrichment', () => {
      const graph = createEmptyGraph();
      const proposal = createArchitectureProposal({ nodes: 5, contracts: 3, edges: 4, artifacts: 10 });

      const enriched = enrichProposalWithPreviews(proposal, graph);

      expect(enriched.patches.length).toBe(proposal.patches.length);

      const originalIds = new Set(proposal.patches.map(p => p.patch.metadata.id));
      const enrichedIds = new Set(enriched.patches.map(p => p.patch.metadata.id));
      expect(originalIds.size).toBe(enrichedIds.size);
      for (const id of originalIds) {
        expect(enrichedIds.has(id)).toBe(true);
      }
    });
  });

  describe('Validation Expectations', () => {
    it('should preserve validation expectations through the proposal lifecycle', () => {
      const proposal = createArchitectureProposal({ nodes: 2, contracts: 1, edges: 1, artifacts: 2 });

      expect(proposal.validationExpectations.length).toBe(2);
      expect(proposal.validationExpectations[0]).toContain('connected');

      const approved = approveAllPatches(proposal);
      expect(approved.validationExpectations).toEqual(proposal.validationExpectations);

      const cherryPicked = cherryPickProposalPatches(proposal, [proposal.patches[0].patch.metadata.id]);
      expect(cherryPicked.validationExpectations).toEqual(proposal.validationExpectations);
    });
  });
});

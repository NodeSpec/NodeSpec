import { describe, it, expect } from 'vitest';
import {
  buildGraphSummary,
  buildAIInputContext,
  validateAIOutput,
  createProposal,
  detectConflicts,
  computePatchPreview,
  enrichProposalWithPreviews,
  cherryPickProposalPatches,
  approveAllPatches,
  mergeApprovedPatches,
  formatAIInputForPrompt,
  createProposalBranch,
  DEFAULT_HARD_RULES,
} from '@nodespec/core/ai-proposal.js';
import { createBranch } from '@nodespec/core/branch.js';
import {
  createAddNodePatch,
  createUpdateNodePatch,
  createRemoveNodePatch,
} from '@nodespec/core/patch-factory.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Node, Contract, Graph } from '@nodespec/core/types.js';

const actorOptions = { actorType: 'ai' as const, summary: 'AI generated patch' };

function createTestNode(id: string, type = 'service'): Node {
  return {
    id,
    type,
    label: `Node ${id.slice(0, 8)}`,
    metadata: {},
  };
}

function createTestContract(id: string): Contract {
  return {
    id,
    kind: 'sql',
    name: `Contract ${id.slice(0, 8)}`,
    schema: {},
    metadata: {},
  };
}

function createPopulatedGraph(): Graph {
  const graph = createEmptyGraph();
  const node1Id = generateUUID();
  const node2Id = generateUUID();
  const contractId = generateUUID();

  graph.nodes[node1Id] = createTestNode(node1Id, 'api');
  graph.nodes[node2Id] = createTestNode(node2Id, 'database');
  graph.contracts[contractId] = createTestContract(contractId);
  graph.edges[generateUUID()] = {
    id: generateUUID(),
    source: node1Id,
    target: node2Id,
    contractId,
    label: 'connection',
    metadata: {},
  };

  return graph;
}

describe('AI Proposal System', () => {
  describe('buildGraphSummary', () => {
    it('should create accurate summary of graph', () => {
      const graph = createPopulatedGraph();
      const summary = buildGraphSummary(graph);

      expect(summary.nodeCount).toBe(2);
      expect(summary.edgeCount).toBe(1);
      expect(summary.contractCount).toBe(1);
      expect(summary.nodeTypes.api).toBe(1);
      expect(summary.nodeTypes.database).toBe(1);
      expect(summary.nodes).toHaveLength(2);
      expect(summary.edges).toHaveLength(1);
    });

    it('should calculate connection counts correctly', () => {
      const graph = createPopulatedGraph();
      const summary = buildGraphSummary(graph);

      const connectedNodes = summary.nodes.filter((n) => n.connectionCount > 0);
      expect(connectedNodes).toHaveLength(2);
    });
  });

  describe('buildAIInputContext', () => {
    it('should build context with all components', () => {
      const graph = createPopulatedGraph();
      const context = buildAIInputContext(graph, undefined, DEFAULT_HARD_RULES);

      expect(context.graphSummary).toBeDefined();
      expect(context.relevantContracts.length).toBeGreaterThan(0);
      expect(context.hardRules.length).toBeGreaterThan(0);
    });

    it('should filter by selected context when provided', () => {
      const graph = createPopulatedGraph();
      const nodeIds = Object.keys(graph.nodes);
      const selectedContext = {
        nodeIds: [nodeIds[0]],
        edgeIds: [],
        contractIds: [],
      };

      const context = buildAIInputContext(graph, selectedContext);

      expect(context.selectedContext).toBeDefined();
      expect(context.selectedContext?.nodeIds).toHaveLength(1);
    });
  });

  describe('validateAIOutput', () => {
    it('should accept valid AI output', () => {
      const nodeId = generateUUID();
      const validOutput = {
        patches: [createAddNodePatch(createTestNode(nodeId), actorOptions)],
        explanations: ['Adding a new service node'],
        validation_expectations: ['Node should be visible in graph'],
      };

      const result = validateAIOutput(validOutput);
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should reject invalid AI output', () => {
      const invalidOutput = {
        patches: 'not an array',
        explanations: [],
      };

      const result = validateAIOutput(invalidOutput);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('createProposal', () => {
    it('should create proposal with all patches', () => {
      const sourceBranch = createBranch('main');
      const proposalBranch = createProposalBranch(sourceBranch, generateUUID());
      const aiRunId = generateUUID();
      const nodeId = generateUUID();

      const aiOutput = {
        patches: [createAddNodePatch(createTestNode(nodeId), actorOptions)],
        explanations: ['Adding node'],
        validation_expectations: ['Check node exists'],
      };

      const proposal = createProposal(aiRunId, sourceBranch.id, proposalBranch, aiOutput);

      expect(proposal.patches).toHaveLength(1);
      expect(proposal.patches[0].status).toBe('pending');
      expect(proposal.patches[0].explanation).toBe('Adding node');
      expect(proposal.status).toBe('pending');
    });
  });

  describe('detectConflicts', () => {
    it('should detect no conflicts for valid patches', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      const patches = [createAddNodePatch(createTestNode(nodeId), actorOptions)];
      const conflicts = detectConflicts(graph, patches);

      expect(conflicts).toHaveLength(0);
    });

    it('should detect conflicts for invalid patches', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      const patches = [createUpdateNodePatch(nodeId, { label: 'Updated' }, actorOptions)];
      const conflicts = detectConflicts(graph, patches);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].patchId).toBe(patches[0].metadata.id);
    });

    it('should not detect conflicts when removing node with edges (cascade deletion)', () => {
      const graph = createPopulatedGraph();
      const nodeIds = Object.keys(graph.nodes);

      const patches = [createRemoveNodePatch(nodeIds[0], actorOptions)];
      const conflicts = detectConflicts(graph, patches);

      expect(conflicts).toHaveLength(0);
    });
  });

  describe('computePatchPreview', () => {
    it('should compute preview for add operations', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);
      const patch = createAddNodePatch(node, actorOptions);

      const preview = computePatchPreview(graph, patch);

      expect(preview).not.toBeNull();
      expect(preview?.before).toBeNull();
      expect(preview?.after).toEqual(node);
    });

    it('should compute preview for update operations', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();
      const node = createTestNode(nodeId);
      graph.nodes[nodeId] = node;

      const patch = createUpdateNodePatch(nodeId, { label: 'New Label' }, actorOptions);
      const preview = computePatchPreview(graph, patch);

      expect(preview).not.toBeNull();
      expect(preview?.before).toEqual(node);
      expect((preview?.after as Node).label).toBe('New Label');
    });

    it('should return null for invalid patches', () => {
      const graph = createEmptyGraph();
      const nodeId = generateUUID();

      const patch = createUpdateNodePatch(nodeId, { label: 'Updated' }, actorOptions);
      const preview = computePatchPreview(graph, patch);

      expect(preview).toBeNull();
    });
  });

  describe('enrichProposalWithPreviews', () => {
    it('should add previews to all valid patches', () => {
      const graph = createEmptyGraph();
      const sourceBranch = createBranch('main');
      const proposalBranch = createProposalBranch(sourceBranch, generateUUID());
      const nodeId = generateUUID();

      const aiOutput = {
        patches: [createAddNodePatch(createTestNode(nodeId), actorOptions)],
        explanations: ['Adding node'],
        validation_expectations: [],
      };

      const proposal = createProposal(generateUUID(), sourceBranch.id, proposalBranch, aiOutput);
      const enriched = enrichProposalWithPreviews(proposal, graph);

      expect(enriched.patches[0].previewBefore).toBeNull();
      expect(enriched.patches[0].previewAfter).toBeDefined();
    });

    it('should mark conflicting patches', () => {
      const graph = createEmptyGraph();
      const sourceBranch = createBranch('main');
      const proposalBranch = createProposalBranch(sourceBranch, generateUUID());
      const nodeId = generateUUID();

      const aiOutput = {
        patches: [createUpdateNodePatch(nodeId, { label: 'Updated' }, actorOptions)],
        explanations: ['Updating non-existent node'],
        validation_expectations: [],
      };

      const proposal = createProposal(generateUUID(), sourceBranch.id, proposalBranch, aiOutput);
      const enriched = enrichProposalWithPreviews(proposal, graph);

      expect(enriched.patches[0].status).toBe('conflicted');
      expect(enriched.patches[0].conflictReason).toBeDefined();
    });
  });

  describe('cherryPickProposalPatches', () => {
    it('should approve selected patches', () => {
      const sourceBranch = createBranch('main');
      const proposalBranch = createProposalBranch(sourceBranch, generateUUID());
      const nodeId1 = generateUUID();
      const nodeId2 = generateUUID();

      const aiOutput = {
        patches: [
          createAddNodePatch(createTestNode(nodeId1), actorOptions),
          createAddNodePatch(createTestNode(nodeId2), actorOptions),
        ],
        explanations: ['Adding node 1', 'Adding node 2'],
        validation_expectations: [],
      };

      const proposal = createProposal(generateUUID(), sourceBranch.id, proposalBranch, aiOutput);
      const cherryPicked = cherryPickProposalPatches(proposal, [
        aiOutput.patches[0].metadata.id,
      ]);

      expect(cherryPicked.patches[0].status).toBe('approved');
      expect(cherryPicked.patches[1].status).toBe('pending');
    });
  });

  describe('approveAllPatches', () => {
    it('should approve all non-conflicting patches', () => {
      const sourceBranch = createBranch('main');
      const proposalBranch = createProposalBranch(sourceBranch, generateUUID());
      const nodeId = generateUUID();

      const aiOutput = {
        patches: [createAddNodePatch(createTestNode(nodeId), actorOptions)],
        explanations: ['Adding node'],
        validation_expectations: [],
      };

      const proposal = createProposal(generateUUID(), sourceBranch.id, proposalBranch, aiOutput);
      const approved = approveAllPatches(proposal);

      expect(approved.patches.every((p) => p.status === 'approved')).toBe(true);
    });

    it('should not approve conflicted patches', () => {
      const sourceBranch = createBranch('main');
      const proposalBranch = createProposalBranch(sourceBranch, generateUUID());

      const aiOutput = {
        patches: [createAddNodePatch(createTestNode(generateUUID()), actorOptions)],
        explanations: ['Adding node'],
        validation_expectations: [],
      };

      const proposal = createProposal(generateUUID(), sourceBranch.id, proposalBranch, aiOutput);
      proposal.patches[0].status = 'conflicted';

      const approved = approveAllPatches(proposal);
      expect(approved.patches[0].status).toBe('conflicted');
    });
  });

  describe('mergeApprovedPatches', () => {
    it('should merge approved patches to target branch', () => {
      const graph = createEmptyGraph();
      const sourceBranch = createBranch('main');
      const proposalBranch = createProposalBranch(sourceBranch, generateUUID());
      const nodeId = generateUUID();

      const aiOutput = {
        patches: [createAddNodePatch(createTestNode(nodeId), actorOptions)],
        explanations: ['Adding node'],
        validation_expectations: [],
      };

      let proposal = createProposal(generateUUID(), sourceBranch.id, proposalBranch, aiOutput);
      proposal = approveAllPatches(proposal);

      const result = mergeApprovedPatches(proposal, sourceBranch, graph);

      expect(result.success).toBe(true);
      expect(result.mergedPatches).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);
      expect(result.finalGraph?.nodes[nodeId]).toBeDefined();
    });

    it('should handle conflicts during merge', () => {
      const emptyGraph = createEmptyGraph();
      const sourceBranch = createBranch('main');
      const proposalBranch = createProposalBranch(sourceBranch, generateUUID());
      const nodeId = generateUUID();

      const aiOutput = {
        patches: [createUpdateNodePatch(nodeId, { label: 'Updated' }, actorOptions)],
        explanations: ['Updating node'],
        validation_expectations: [],
      };

      let proposal = createProposal(generateUUID(), sourceBranch.id, proposalBranch, aiOutput);
      proposal.patches[0].status = 'approved';

      const result = mergeApprovedPatches(proposal, sourceBranch, emptyGraph);

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.skippedPatches).toHaveLength(1);
    });
  });

  describe('formatAIInputForPrompt', () => {
    it('should format context for AI consumption', () => {
      const graph = createPopulatedGraph();
      const context = buildAIInputContext(graph, undefined, DEFAULT_HARD_RULES);
      const formatted = formatAIInputForPrompt(context);

      expect(formatted).toContain('Graph Summary');
      expect(formatted).toContain('Nodes:');
      expect(formatted).toContain('HARD RULES');
    });

    it('should include hard rules', () => {
      const graph = createEmptyGraph();
      const context = buildAIInputContext(graph, undefined, DEFAULT_HARD_RULES);
      const formatted = formatAIInputForPrompt(context);

      expect(formatted).toContain('HARD RULES');
      expect(formatted).toContain('actor_type');
    });
  });

  describe('createProposalBranch', () => {
    it('should create branch with proposal prefix', () => {
      const sourceBranch = createBranch('main');
      const aiRunId = generateUUID();
      const proposalBranch = createProposalBranch(sourceBranch, aiRunId);

      expect(proposalBranch.name).toContain('ai-proposal/');
      expect(proposalBranch.name).toContain(aiRunId.slice(0, 8));
    });

    it('should copy patches from source branch', () => {
      const nodeId = generateUUID();
      const patch = createAddNodePatch(createTestNode(nodeId), {
        actorType: 'human',
        summary: 'Test',
      });
      const sourceBranch = createBranch('main', null, [patch]);
      const proposalBranch = createProposalBranch(sourceBranch, generateUUID());

      expect(proposalBranch.patches).toHaveLength(1);
    });
  });
});

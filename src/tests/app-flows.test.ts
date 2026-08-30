// N9b-3: hydrates the retired static registry (test-only fixture) — these suites
// were authored against the pre-DB type definitions.
import './fixtures/legacy-node-type-fixture.js';
/**
 * App Functionality Tests - Golden Flows
 *
 * End-to-end style tests validating complete user workflows without Playwright.
 * Tests run at the store + adapter + component boundary level using Vitest.
 *
 * Flows tested:
 * - Flow A: Create + Connect + Validate
 * - Flow B: Artifact Workbench Editing + Patch Emission
 * - Flow C: AI Improve → Proposal Branch → Merge
 * - Flow D: Persistence + Reload Replay
 */

import { describe, it, expect } from 'vitest';
import {
  createTestAppState,
  applyAndExpectSuccess,
  applyAndExpectAllSuccess,
  applyAndExpectFailure,
  selectNodeAndOpenWorkbench,
  editArtifactContent,
  mockAIResponse,
  persistPatches,
  persistSnapshot,
  replayFromPersistence,
  createNodeFromTemplate,
  getCurrentGraph,
  getPatchLog,
  createProposalBranch,
  mergeProposalPatches,
  verifyActorAttribution,
  verifyDeterministicHash,
  getPersistedPatches,
} from './app-harness.js';
import { mapConnectionToPatches } from '../ui/adapters/interaction-to-patch.js';
import { deriveNodeObligations } from '@nodespec/core/obligations.js';
import { validateNodeArtifactsAgainstObligations } from '@nodespec/core/artifact-validation.js';
import { createUpdateArtifactPatch, createAddArtifactPatch } from '@nodespec/core/patch-factory.js';
import { generateUUID, computeHash, now, computeContentHash } from '@nodespec/core/utils.js';
import type { Artifact } from '@nodespec/core/types.js';

// Helper to create artifact with timestamps
function makeArtifact(data: Omit<Artifact, 'createdAt' | 'updatedAt'>): Artifact {
  const timestamp = now();
  return {
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('App Flows - End-to-End Functionality', () => {
  describe('Flow A - Create + Connect + Validate', () => {
    it('REST → Frontend connect creates contract+edge and obligations', () => {
      const state = createTestAppState();

      // Step 1: Create REST Service node from template
      const restNodeId = createNodeFromTemplate(state, 'rest-service', 'Auth API');

      // Step 2: Create Frontend Module node from template
      const frontendNodeId = createNodeFromTemplate(state, 'frontend-module', 'Login UI');

      // Step 3: Verify nodes exist
      const graph = getCurrentGraph(state);
      expect(graph.nodes[restNodeId]).toBeDefined();
      expect(graph.nodes[frontendNodeId]).toBeDefined();
      expect(graph.nodes[restNodeId].label).toBe('Auth API');
      expect(graph.nodes[frontendNodeId].label).toBe('Login UI');

      // Step 4: Connect output → input via ports
      const restNode = graph.nodes[restNodeId];
      const frontendNode = graph.nodes[frontendNodeId];

      const restOutputPort = restNode.ports?.find((p) => p.direction === 'out');
      const frontendInputPort = frontendNode.ports?.find((p) => p.direction === 'in');

      expect(restOutputPort).toBeDefined();
      expect(frontendInputPort).toBeDefined();

      const connection = {
        source: restNodeId,
        target: frontendNodeId,
        sourceHandle: restOutputPort!.id,
        targetHandle: frontendInputPort!.id,
      };

      const connectionResult = mapConnectionToPatches(connection, graph, {
        actorType: 'human',
      });

      expect(connectionResult.blocked).toBe(false);
      expect(connectionResult.patches.length).toBeGreaterThan(0);

      // Apply connection patches
      applyAndExpectAllSuccess(state, connectionResult.patches);

      // Step 5: Verify contract exists and is referenced by edge
      const updatedGraph = getCurrentGraph(state);
      const edges = Object.values(updatedGraph.edges);
      const newEdge = edges.find(
        (e) => e.source === restNodeId && e.target === frontendNodeId
      );

      expect(newEdge).toBeDefined();
      expect(newEdge!.contractId).toBeDefined();
      expect(updatedGraph.contracts[newEdge!.contractId]).toBeDefined();

      const contract = updatedGraph.contracts[newEdge!.contractId];
      expect(contract.kind).toBeDefined();
      expect(contract.name).toContain('Auth API');
      expect(contract.name).toContain('Login UI');

      // Step 6: Verify obligations derive correctly
      const restObligations = deriveNodeObligations(updatedGraph, restNodeId);
      const frontendObligations = deriveNodeObligations(updatedGraph, frontendNodeId);

      expect(restObligations.length).toBeGreaterThan(0);
      expect(frontendObligations.length).toBeGreaterThan(0);

      // Step 7: Verify artifact-validation reports expected issues (non-blocking)
      const restValidation = validateNodeArtifactsAgainstObligations(
        updatedGraph,
        restNodeId
      );
      const frontendValidation = validateNodeArtifactsAgainstObligations(
        updatedGraph,
        frontendNodeId
      );

      // REST service should have warnings about missing schema artifacts
      expect(restValidation.issues.length).toBeGreaterThan(0);

      // Frontend module might have warnings (if no artifacts attached yet)
      // Issues should be warnings (non-blocking), not errors
      const allIssues = [
        ...restValidation.issues,
        ...frontendValidation.issues,
      ];
      const hasOnlyWarnings = allIssues.every((issue) => issue.severity === 'warning');
      expect(hasOnlyWarnings).toBe(true);
    });

    it('ensures no schema mismatch errors in UI boundary calls', () => {
      const state = createTestAppState();

      // Create node and connect - all schema validation should pass
      const nodeId1 = createNodeFromTemplate(state, 'rest-service', 'Service A');
      const nodeId2 = createNodeFromTemplate(state, 'event-consumer', 'Consumer B');

      const graph = getCurrentGraph(state);
      const node1 = graph.nodes[nodeId1];
      const node2 = graph.nodes[nodeId2];

      const connection = {
        source: nodeId1,
        target: nodeId2,
        sourceHandle: node1.ports?.[0].id ?? null,
        targetHandle: node2.ports?.[0].id ?? null,
      };

      // This should not throw schema validation errors
      expect(() => {
        const result = mapConnectionToPatches(connection, graph, {
          actorType: 'human',
        });
        expect(result).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('Flow B - Artifact Workbench Editing + Patch Emission', () => {
    it('Artifact Workbench edit emits update_artifact with correct hash', () => {
      const state = createTestAppState();

      // Step 1: Create node from template
      const nodeId = createNodeFromTemplate(state, 'rest-service', 'User Service');

      // Step 2: Add an artifact
      const artifactId = generateUUID();
      const addArtifactPatch = createAddArtifactPatch(
        makeArtifact({
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'src/routes.ts',
          content: 'export const routes = [];',
          contentHash: computeHash('export const routes = [];'),
          status: 'draft',
        }),
        {
          actorType: 'human',
          summary: 'Add routes artifact',
        }
      );

      applyAndExpectSuccess(state, addArtifactPatch);

      // Step 3: Select node and open Artifact Workbench
      selectNodeAndOpenWorkbench(state, nodeId, artifactId);

      // Verify artifact is opened in editor
      const storeState = state.store.getState();
      expect(storeState.selectedArtifactId).toBe(artifactId);
      expect(storeState.selectedNodeId).toBe(nodeId);

      // Step 4: Edit content in the editor
      const newContent = 'export const routes = [\n  { path: "/users", handler: getUsers }\n];';
      const updatePatch = editArtifactContent(state, artifactId, newContent);

      // Step 5: Verify patch type is exactly update_artifact
      expect(updatePatch.type).toBe('update_artifact');

      // Step 6: Apply the update patch
      applyAndExpectSuccess(state, updatePatch);

      // Step 7: Verify contentHash is recomputed deterministically
      const updatedGraph = getCurrentGraph(state);
      const updatedArtifact = updatedGraph.artifacts[artifactId];

      expect(updatedArtifact.content).toBe(newContent);
      expect(updatedArtifact.contentHash).toBe(computeContentHash(newContent));

      // Verify hash is deterministic
      const expectedHash = computeContentHash(newContent);
      expect(updatedArtifact.contentHash).toBe(expectedHash);

      // Step 8: Validate artifact completeness warnings behave as expected
      const validation = validateNodeArtifactsAgainstObligations(updatedGraph, nodeId);

      // Should have warnings about missing schema artifacts for REST service
      const hasSchemaWarning = validation.issues.some(
        (issue) =>
          issue.severity === 'warning' && issue.message.includes('schema')
      );
      expect(hasSchemaWarning).toBe(true);
    });

    it('editor dirty state tracks correctly', () => {
      const state = createTestAppState();

      const nodeId = createNodeFromTemplate(state, 'frontend-module', 'Dashboard');

      const artifactId = generateUUID();
      const addPatch = createAddArtifactPatch(
        makeArtifact({
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'src/Dashboard.tsx',
          content: 'export const Dashboard = () => <div>Dashboard</div>;',
          contentHash: computeHash('export const Dashboard = () => <div>Dashboard</div>;'),
          status: 'draft',
        }),
        { actorType: 'human', summary: 'Add Dashboard component' }
      );

      applyAndExpectSuccess(state, addPatch);
      selectNodeAndOpenWorkbench(state, nodeId, artifactId);

      // Initially not dirty
      expect(state.store.isEditorDirty(artifactId)).toBe(false);

      // Edit content
      state.store.setEditorContent(artifactId, 'export const Dashboard = () => <div>Updated</div>;');

      // Now should be dirty
      expect(state.store.isEditorDirty(artifactId)).toBe(true);
    });
  });

  describe('Flow C - AI Improve → Proposal Branch → Merge', () => {
    it('AI Improve creates proposal branch and merges into main', async () => {
      const state = createTestAppState();

      // Step 1: Create node with artifact
      const nodeId = createNodeFromTemplate(state, 'rest-service', 'Payment API');

      const artifactId = generateUUID();
      const addPatch = createAddArtifactPatch(
        makeArtifact({
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'src/payment.ts',
          content: 'function processPayment() { /* TODO */ }',
          contentHash: computeHash('function processPayment() { /* TODO */ }'),
          status: 'draft',
        }),
        { actorType: 'human', summary: 'Add payment stub' }
      );

      applyAndExpectSuccess(state, addPatch);

      // Step 2: Trigger AI Improve (mock edge function response)
      const improvedContent = `function processPayment(amount: number, currency: string) {
  // Validate input
  if (amount <= 0) throw new Error('Invalid amount');

  // Process payment
  return { success: true, transactionId: generateId() };
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}`;

      const aiPatch = createUpdateArtifactPatch(
        artifactId,
        { content: improvedContent },
        {
          actorType: 'ai',
          actorId: 'test-ai-run-123',
          summary: 'AI improved payment processing function',
        }
      );

      // Step 3: Ensure AI output produces valid update_artifact patches only
      expect(aiPatch.type).toBe('update_artifact');
      expect(aiPatch.metadata.actorType).toBe('ai');

      // Step 4: Create proposal branch
      await persistSnapshot(state);

      const snapshotResult = await state.repos.graphs.loadSnapshot(state.branchId);
      expect(snapshotResult.success).toBe(true);

      if (!snapshotResult.success || !snapshotResult.data) {
        throw new Error('Failed to load snapshot');
      }

      const proposalBranchId = await createProposalBranch(
        state,
        `proposal/${Date.now()}`,
        snapshotResult.data.id
      );

      expect(proposalBranchId).toBeDefined();

      // Step 5: Apply AI patches to proposal branch (simulate in main store for testing)
      const mockResponse = mockAIResponse([aiPatch], 'Improved payment processing with validation');
      expect(mockResponse.patches.length).toBe(1);

      // Step 6: Merge approved patches into main branch
      const mergeResult = mergeProposalPatches(state, mockResponse.patches);
      expect(mergeResult.success).toBe(true);

      // Step 7: Verify main branch graph now reflects changes
      const updatedGraph = getCurrentGraph(state);
      const updatedArtifact = updatedGraph.artifacts[artifactId];
      expect(updatedArtifact.content).toBe(improvedContent);

      // Step 8: Verify patch log records actorType=ai correctly
      const patchLog = getPatchLog(state);
      const aiPatches = patchLog.filter((p) => p.metadata.actorType === 'ai');
      expect(aiPatches.length).toBeGreaterThan(0);

      const lastAIPatch = aiPatches[aiPatches.length - 1];
      expect(verifyActorAttribution(lastAIPatch, 'ai')).toBe(true);
      expect(lastAIPatch.metadata.actorId).toBe('test-ai-run-123');
    });

    it('conflicts are surfaced if preconditions fail', () => {
      const state = createTestAppState();

      const nodeId = createNodeFromTemplate(state, 'event-producer', 'Order Events');

      const artifactId = generateUUID();
      const addPatch = createAddArtifactPatch(
        makeArtifact({
          id: artifactId,
          nodeId,
          kind: 'schema',
          path: 'schemas/order.json',
          content: '{ "type": "object" }',
          contentHash: computeHash('{ "type": "object" }'),
          status: 'draft',
        }),
        { actorType: 'human', summary: 'Add order schema' }
      );

      applyAndExpectSuccess(state, addPatch);

      // User edits the artifact
      const userContent = '{ "type": "object", "properties": { "orderId": { "type": "string" } } }';
      const userPatch = createUpdateArtifactPatch(
        artifactId,
        { content: userContent },
        { actorType: 'human', summary: 'User adds orderId field' }
      );

      applyAndExpectSuccess(state, userPatch);

      // AI generates patch with precondition expecting old content
      const aiContent = '{ "type": "object", "properties": { "amount": { "type": "number" } } }';
      const aiPatch = createUpdateArtifactPatch(
        artifactId,
        {
          content: aiContent,
        },
        {
          actorType: 'ai',
          summary: 'AI adds amount field',
          preconditions: [
            {
              type: 'hash_match',
              path: `artifacts.${artifactId}.contentHash`,
              expected: computeHash('{ "type": "object" }'),
            },
          ],
        }
      );

      // This should fail due to precondition mismatch
      // The patch should fail validation, not necessarily with "hash" in the message
      const result = applyAndExpectFailure(state, aiPatch);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.failedPatchId).toBe(aiPatch.metadata.id);
    });
  });

  describe('Flow D - Persistence + Reload Replay', () => {
    it('Reload from persisted patches yields identical graph hash', async () => {
      const state = createTestAppState();

      // Step 1: Create multiple nodes and connections
      const node1Id = createNodeFromTemplate(state, 'rest-service', 'API Gateway');
      const node2Id = createNodeFromTemplate(state, 'event-producer', 'Event Bus');
      const node3Id = createNodeFromTemplate(state, 'event-consumer', 'Analytics');

      // Add artifacts
      const artifact1Id = generateUUID();
      const addArtifact1 = createAddArtifactPatch(
        makeArtifact({
          id: artifact1Id,
          nodeId: node1Id,
          kind: 'source',
          path: 'src/gateway.ts',
          content: 'export const gateway = {}',
          contentHash: computeHash('export const gateway = {}'),
        }),
        { actorType: 'human', summary: 'Add gateway code' }
      );

      applyAndExpectSuccess(state, addArtifact1);

      const artifact2Id = generateUUID();
      const addArtifact2 = createAddArtifactPatch(
        makeArtifact({
          id: artifact2Id,
          nodeId: node2Id,
          kind: 'schema',
          path: 'schemas/events.json',
          content: '{"events": []}',
          contentHash: computeHash('{"events": []}'),
        }),
        { actorType: 'human', summary: 'Add event schema' }
      );

      applyAndExpectSuccess(state, addArtifact2);

      // Step 2: Get current graph state
      const originalGraph = getCurrentGraph(state);
      const originalHash = originalGraph.hash;

      // Step 3: Persist patches to mock PatchRepository with sequence ordering
      await persistPatches(state);

      // Verify patches are persisted with correct sequence
      const persistedPatches = await getPersistedPatches(state);
      expect(persistedPatches.length).toBeGreaterThan(0);

      // Verify sequence ordering
      for (let i = 1; i < persistedPatches.length; i++) {
        expect(persistedPatches[i].sequence).toBeGreaterThan(
          persistedPatches[i - 1].sequence
        );
      }

      // Step 4: Persist snapshot
      await persistSnapshot(state);

      // Step 5: Reload branch from repositories (simulate app reload)
      const replayedGraph = await replayFromPersistence(state);

      // Step 6: Assert deterministic resulting graph hash
      expect(verifyDeterministicHash(originalGraph, replayedGraph)).toBe(true);
      expect(replayedGraph.hash).toBe(originalHash);

      // Verify all nodes are present
      expect(replayedGraph.nodes[node1Id]).toBeDefined();
      expect(replayedGraph.nodes[node2Id]).toBeDefined();
      expect(replayedGraph.nodes[node3Id]).toBeDefined();

      // Verify all artifacts are present
      expect(replayedGraph.artifacts[artifact1Id]).toBeDefined();
      expect(replayedGraph.artifacts[artifact2Id]).toBeDefined();

      // Verify content is identical
      expect(replayedGraph.artifacts[artifact1Id].content).toBe(
        originalGraph.artifacts[artifact1Id].content
      );
      expect(replayedGraph.artifacts[artifact2Id].content).toBe(
        originalGraph.artifacts[artifact2Id].content
      );
    });

    it('deterministic replay with complex patch sequence', async () => {
      const state = createTestAppState();

      // Create a complex sequence of patches
      const nodeId = createNodeFromTemplate(state, 'frontend-module', 'App Shell');

      const artifactId = generateUUID();
      let content = 'version 1';

      // Add initial artifact
      const addPatch = createAddArtifactPatch(
        makeArtifact({
          id: artifactId,
          nodeId,
          kind: 'source',
          path: 'src/AppShell.tsx',
          content,
          contentHash: computeHash(content),
        }),
        { actorType: 'human', summary: 'Add App component' }
      );

      applyAndExpectSuccess(state, addPatch);

      // Apply multiple updates
      for (let i = 2; i <= 5; i++) {
        content = `version ${i}`;
        const updatePatch = createUpdateArtifactPatch(
          artifactId,
          { content },
          { actorType: 'human', summary: `Update to version ${i}` }
        );

        applyAndExpectSuccess(state, updatePatch);
      }

      const finalGraph = getCurrentGraph(state);
      const finalHash = finalGraph.hash;

      // Persist and replay
      await persistPatches(state);
      await persistSnapshot(state);

      const replayedGraph = await replayFromPersistence(state);

      // Verify deterministic hash
      expect(replayedGraph.hash).toBe(finalHash);
      expect(replayedGraph.artifacts[artifactId].content).toBe('version 5');
      expect(replayedGraph.version).toBe(finalGraph.version);
    });
  });

  describe('Flow Integration - Precondition failure produces conflicted state', () => {
    it('Precondition failure produces conflicted patch state and does not corrupt branch', () => {
      const state = createTestAppState();

      const nodeId = createNodeFromTemplate(state, 'rest-service', 'Config Service');

      const artifactId = generateUUID();
      const initialContent = 'CONFIG_VERSION=1';

      const addPatch = createAddArtifactPatch(
        makeArtifact({
          id: artifactId,
          nodeId,
          kind: 'config',
          path: 'config/.env',
          content: initialContent,
          contentHash: computeHash(initialContent),
        }),
        { actorType: 'human', summary: 'Add config file' }
      );

      applyAndExpectSuccess(state, addPatch);

      // Get the graph state before conflict
      const graphBeforeConflict = getCurrentGraph(state);
      const hashBeforeConflict = graphBeforeConflict.hash;

      // Apply an update
      const updateContent = 'CONFIG_VERSION=2';
      const updatePatch = createUpdateArtifactPatch(
        artifactId,
        { content: updateContent },
        { actorType: 'human', summary: 'Update config to v2' }
      );

      applyAndExpectSuccess(state, updatePatch);

      // Now try to apply a patch with wrong precondition
      const conflictingContent = 'CONFIG_VERSION=3';
      const conflictingPatch = createUpdateArtifactPatch(
        artifactId,
        { content: conflictingContent },
        {
          actorType: 'ai',
          summary: 'AI tries to update to v3',
          preconditions: [
            {
              type: 'hash_match',
              path: `artifacts.${artifactId}.contentHash`,
              expected: computeHash(initialContent), // Wrong! Should be hash of v2
            },
          ],
        }
      );

      // This should fail
      const conflictResult = applyAndExpectFailure(state, conflictingPatch);

      expect(conflictResult.success).toBe(false);

      // Verify branch is not corrupted
      const graphAfterFailure = getCurrentGraph(state);

      // Graph should still have v2 content
      expect(graphAfterFailure.artifacts[artifactId].content).toBe(updateContent);

      // Verify graph integrity is maintained
      expect(graphAfterFailure.hash).not.toBe(hashBeforeConflict); // Changed by v2 update
      expect(Object.keys(graphAfterFailure.nodes).length).toBe(
        Object.keys(graphBeforeConflict.nodes).length
      );

      // Verify error is recorded
      const lastError = state.store.getState().lastError;
      expect(lastError).not.toBeNull();
      expect(lastError?.patchId).toBe(conflictingPatch.metadata.id);
    });
  });
});

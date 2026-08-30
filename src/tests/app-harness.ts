/**
 * App Functionality Test Harness
 *
 * Provides test utilities for end-to-end style tests that validate golden flows.
 * Tests run at the "store + adapter + component boundary" level using Vitest.
 *
 * Architecture:
 * - Uses in-memory mock repositories for deterministic testing
 * - Combines BranchStore with domain layer and UI adapters
 * - No schema changes, no new patch types, no position persistence
 */

import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import type { BranchStore, ProposeResult } from '../ui/store/branch-store.js';
import type { PersistedPatch } from '../persistence/types.js';
import { createBranchStore } from '../ui/store/branch-store.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import { createNodeFromTemplatePatch, createUpdateArtifactPatch } from '@nodespec/core/patch-factory.js';
import { applyPatches } from '@nodespec/core/patch-engine.js';
import {
  createMockProjectRepository,
  createMockBranchRepository,
  createMockGraphRepository,
  createMockPatchRepository,
  createMockArtifactRepository,
  createMockAIRunRepository,
} from '../persistence/testing/mock-repositories.js';

export interface TestAppState {
  store: BranchStore;
  repos: {
    projects: ReturnType<typeof createMockProjectRepository>;
    branches: ReturnType<typeof createMockBranchRepository>;
    graphs: ReturnType<typeof createMockGraphRepository>;
    patches: ReturnType<typeof createMockPatchRepository>;
    artifacts: ReturnType<typeof createMockArtifactRepository>;
    aiRuns: ReturnType<typeof createMockAIRunRepository>;
  };
  projectId: string;
  branchId: string;
  ownerId: string;
}

/**
 * Creates a complete test app state with in-memory repositories and a BranchStore.
 */
export function createTestAppState(initialGraph?: Graph): TestAppState {
  const graph = initialGraph ?? createEmptyGraph();
  const store = createBranchStore(graph);

  const ownerId = generateUUID();
  const projectId = generateUUID();
  const branchId = generateUUID();

  const repos = {
    projects: createMockProjectRepository(),
    branches: createMockBranchRepository(),
    graphs: createMockGraphRepository(),
    patches: createMockPatchRepository(),
    artifacts: createMockArtifactRepository(),
    aiRuns: createMockAIRunRepository(),
  };

  // Initialize project and branch in repositories
  repos.projects.create('Test Project', ownerId, {});
  repos.branches.create(projectId, 'main', ownerId, undefined, {});
  repos.graphs.saveSnapshot(projectId, branchId, graph, 0);

  return {
    store,
    repos,
    projectId,
    branchId,
    ownerId,
  };
}

/**
 * Applies a patch and asserts it succeeds.
 */
export function applyAndExpectSuccess(
  state: TestAppState,
  patch: PatchOperation
): ProposeResult {
  const result = state.store.proposePatches([patch]);
  if (!result.success) {
    throw new Error(
      `Expected patch to succeed but got error: ${result.error}\n` +
        `Patch: ${JSON.stringify(patch, null, 2)}`
    );
  }
  return result;
}

/**
 * Applies multiple patches and asserts they all succeed.
 */
export function applyAndExpectAllSuccess(
  state: TestAppState,
  patches: PatchOperation[]
): ProposeResult {
  const result = state.store.proposePatches(patches);
  if (!result.success) {
    throw new Error(
      `Expected all patches to succeed but got error: ${result.error}\n` +
        `Applied: ${result.appliedCount}/${patches.length}\n` +
        `Failed patch ID: ${result.failedPatchId}`
    );
  }
  return result;
}

/**
 * Applies a patch and expects it to fail with a specific error message pattern.
 */
export function applyAndExpectFailure(
  state: TestAppState,
  patch: PatchOperation,
  errorPattern?: string | RegExp
): ProposeResult {
  const result = state.store.proposePatches([patch]);
  if (result.success) {
    throw new Error(
      `Expected patch to fail but it succeeded.\n` +
        `Patch: ${JSON.stringify(patch, null, 2)}`
    );
  }

  if (errorPattern && result.error) {
    const matches =
      typeof errorPattern === 'string'
        ? result.error.includes(errorPattern)
        : errorPattern.test(result.error);

    if (!matches) {
      throw new Error(
        `Expected error to match pattern "${errorPattern}" but got: "${result.error}"`
      );
    }
  }

  return result;
}

/**
 * Selects a node and opens the workbench with a specific artifact.
 */
export function selectNodeAndOpenWorkbench(
  state: TestAppState,
  nodeId: string,
  artifactId: string
): void {
  state.store.setSelectedNode(nodeId);
  state.store.openArtifact(artifactId);
}

/**
 * Edits an artifact's content in the editor buffer and returns the update patch.
 */
export function editArtifactContent(
  state: TestAppState,
  artifactId: string,
  newContent: string
): PatchOperation {
  const graph = state.store.getState().derivedGraph;
  const artifact = graph.artifacts[artifactId];

  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found in graph`);
  }

  state.store.setEditorContent(artifactId, newContent);

  const patch = createUpdateArtifactPatch(
    artifactId,
    { content: newContent },
    {
      actorType: 'human',
      summary: `Update artifact ${artifact.path}`,
    }
  );

  return patch;
}

/**
 * Mocks an AI response with patches and explanation.
 */
export interface MockAIResponse {
  patches: PatchOperation[];
  explanation: string;
  proposalBranchName: string;
}

export function mockAIResponse(
  patches: PatchOperation[],
  explanation: string
): MockAIResponse {
  const timestamp = Date.now();
  return {
    patches,
    explanation,
    proposalBranchName: `proposal/${timestamp}`,
  };
}

/**
 * Persists all patches from the store to the patch repository.
 */
export async function persistPatches(state: TestAppState): Promise<void> {
  const storeState = state.store.getState();
  const patches = storeState.activeBranch.patches;

  for (const patch of patches) {
    await state.repos.patches.appendPatch(state.branchId, patch, state.ownerId);
  }
}

/**
 * Persists the current graph as a snapshot.
 */
export async function persistSnapshot(state: TestAppState): Promise<void> {
  const storeState = state.store.getState();
  const graph = storeState.derivedGraph;
  const patchSequence = storeState.activeBranch.patches.length;

  await state.repos.graphs.saveSnapshot(
    state.projectId,
    state.branchId,
    graph,
    patchSequence
  );
}

/**
 * Reloads branch from persistence (simulates app reload).
 * Returns the reconstructed graph for verification.
 */
export async function replayFromPersistence(state: TestAppState): Promise<Graph> {
  // Load base snapshot
  const snapshotResult = await state.repos.graphs.loadSnapshot(state.branchId);
  if (!snapshotResult.success || !snapshotResult.data) {
    throw new Error('Failed to load snapshot from repository');
  }

  const baseGraph = snapshotResult.data.graphData;
  const baseSequence = snapshotResult.data.patchSequence;

  // Load patches since snapshot
  const patchesResult = await state.repos.patches.loadPatches(state.branchId, {
    sinceSequence: baseSequence,
  });

  if (!patchesResult.success) {
    throw new Error('Failed to load patches from repository');
  }

  const patches = patchesResult.data.map((p) => p.payload);

  // Replay patches
  const result = applyPatches(baseGraph, patches);
  if (!result.success || !result.graph) {
    throw new Error(`Failed to replay patches: ${result.error?.message}`);
  }

  return result.graph;
}

/**
 * Creates a node from a template and returns its ID.
 */
export function createNodeFromTemplate(
  state: TestAppState,
  templateId: string,
  label: string
): string {
  const nodeId = generateUUID();
  const patch = createNodeFromTemplatePatch(
    templateId,
    nodeId,
    label,
    {
      actorType: 'human',
      summary: `Create ${label} from template`,
    }
  );

  applyAndExpectSuccess(state, patch);
  return nodeId;
}

/**
 * Gets the current derived graph from the store.
 */
export function getCurrentGraph(state: TestAppState): Graph {
  return state.store.getState().derivedGraph;
}

/**
 * Gets all patches from the store's patch log.
 */
export function getPatchLog(state: TestAppState): PatchOperation[] {
  return state.store.getState().activeBranch.patches;
}

/**
 * Gets the last error from the store.
 */
export function getLastError(state: TestAppState): { patchId?: string; message: string } | null {
  return state.store.getState().lastError;
}

/**
 * Verifies that a graph hash is deterministic (same content = same hash).
 */
export function verifyDeterministicHash(graph1: Graph, graph2: Graph): boolean {
  return graph1.hash === graph2.hash;
}

/**
 * Creates a proposal branch in the repository.
 */
export async function createProposalBranch(
  state: TestAppState,
  proposalName: string,
  baseSnapshotId: string
): Promise<string> {
  const result = await state.repos.branches.create(
    state.projectId,
    proposalName,
    state.ownerId,
    baseSnapshotId,
    { type: 'proposal' }
  );

  if (!result.success) {
    throw new Error(`Failed to create proposal branch: ${result.error?.message}`);
  }

  return result.data.id;
}

/**
 * Simulates merging patches from a proposal branch into the main branch.
 */
export function mergeProposalPatches(
  state: TestAppState,
  patches: PatchOperation[]
): ProposeResult {
  return state.store.proposePatches(patches);
}

/**
 * Verifies actor attribution in a patch.
 */
export function verifyActorAttribution(
  patch: PatchOperation,
  expectedActorType: 'human' | 'ai' | 'system'
): boolean {
  return patch.metadata.actorType === expectedActorType;
}

/**
 * Gets all persisted patches for a branch from the repository.
 */
export async function getPersistedPatches(
  state: TestAppState
): Promise<PersistedPatch[]> {
  const result = await state.repos.patches.loadPatches(state.branchId, {});
  if (!result.success) {
    throw new Error('Failed to load patches from repository');
  }
  return result.data;
}

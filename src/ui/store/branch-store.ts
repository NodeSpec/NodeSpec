import type { Graph, PatchOperation, ValidationError } from '@nodespec/core/types.js';
import { applyPatch, applyPatches, validatePatch } from '@nodespec/core/patch-engine.js';
import { createEmptyGraph, generateUUID, now, deepClone } from '@nodespec/core/utils.js';
import { migrateGraphToLatest, needsMigration } from '@nodespec/core/migration.js';

export interface PatchLogEntry {
  patch: PatchOperation;
  status: 'applied' | 'rejected';
  error?: ValidationError;
  appliedAt: string;
}

/** N6.1: undo/redo operate on whole-GRAPH snapshots, not on the patch list.
 *  Two forces make this the only correct model:
 *   · the 3-second autosave flattens pending patches into a new base snapshot and
 *     clears them, so a patch-list undo dies seconds after any edit;
 *   · `graph_patches` is append-only and hash-chained (guardrail i) — an already
 *     persisted patch can never be un-persisted.
 *  So the log keeps every forward edit and the SNAPSHOT moves back; the next push
 *  serializes the restored snapshot, which is what the R1 anchor reads. */
export interface UndoSnapshot {
  graph: Graph;
}

export interface BranchStoreState {
  baseSnapshotGraph: Graph;
  activeBranch: {
    id: string;
    name: string;
    patches: PatchOperation[];
  };
  derivedGraph: Graph;
  lastError: { patchId?: string; message: string } | null;
  patchLog: PatchLogEntry[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  selectedArtifactId: string | null;
  editorDirty: Map<string, boolean>;
  editorBuffer: Map<string, string>;
  availableBranches: Array<{ id: string; name: string; patchCount: number }>;
  undoStack: UndoSnapshot[];
  redoStack: UndoSnapshot[];
  /** Bumps on every undo/redo so the editor can persist a snapshot-only revert
   *  (autosave alone only fires while pending patches exist). */
  graphRevision: number;
}

export interface ProposeResult {
  success: boolean;
  appliedCount: number;
  failedPatchId?: string;
  error?: string;
}

export type BranchStoreListener = (state: BranchStoreState) => void;

export interface BranchStore {
  getState(): BranchStoreState;
  subscribe(listener: BranchStoreListener): () => void;
  proposePatches(patches: PatchOperation[]): ProposeResult;
  /** Restore the previous canvas state. Returns false when the stack is empty. */
  undo(): boolean;
  /** Re-apply the state undone last. Returns false when the stack is empty. */
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  resetBranch(): void;
  setBaseSnapshot(graph: Graph): void;
  /** Autosave commit on the current canvas — preserves undo/redo history. */
  commitSavedSnapshot(savedGraph: Graph, remainingPatches: PatchOperation[]): void;
  setSelectedNode(id: string | null): void;
  setSelectedEdge(id: string | null): void;
  clearSelection(): void;
  openArtifact(artifactId: string): void;
  closeArtifact(): void;
  setEditorContent(artifactId: string, content: string): void;
  getEditorContent(artifactId: string): string | undefined;
  isEditorDirty(artifactId: string): boolean;
  createBranchFromMain(branchName: string): void;
  switchToBranch(branchId: string, branchName: string, patches: PatchOperation[]): void;
  setAvailableBranches(branches: Array<{ id: string; name: string; patchCount: number }>): void;
}

function recomputeDerivedGraph(baseGraph: Graph, patches: PatchOperation[]): Graph {
  if (patches.length === 0) {
    return deepClone(baseGraph);
  }

  const result = applyPatches(baseGraph, patches);
  if (result.success && result.graph) {
    return result.graph;
  }

  console.warn('[BranchStore] Sorted replay failed, retrying in chronological order:', result.error);
  let fallbackGraph = deepClone(baseGraph);
  for (const patch of patches) {
    const patchResult = applyPatch(fallbackGraph, patch);
    if (patchResult.success && patchResult.graph) {
      fallbackGraph = patchResult.graph;
    } else {
      console.warn('[BranchStore] Skipping patch during chronological replay:', patch.type, patchResult.error);
    }
  }
  return fallbackGraph;
}

function ensureMigratedGraph(graph: Graph | undefined): Graph {
  if (!graph) {
    return createEmptyGraph();
  }
  if (needsMigration(graph)) {
    return migrateGraphToLatest(graph);
  }
  return graph;
}

export function createBranchStore(initialGraph?: Graph): BranchStore {
  const baseSnapshotGraph = ensureMigratedGraph(initialGraph);

  let state: BranchStoreState = {
    baseSnapshotGraph,
    activeBranch: {
      id: generateUUID(),
      name: 'main',
      patches: [],
    },
    derivedGraph: deepClone(baseSnapshotGraph),
    lastError: null,
    patchLog: [],
    selectedNodeId: null,
    selectedEdgeId: null,
    selectedArtifactId: null,
    editorDirty: new Map(),
    editorBuffer: new Map(),
    availableBranches: [],
    undoStack: [],
    redoStack: [],
    graphRevision: 0,
  };

  const listeners = new Set<BranchStoreListener>();

  function notify() {
    listeners.forEach((listener) => listener(state));
  }

  function getState(): BranchStoreState {
    return state;
  }

  function subscribe(listener: BranchStoreListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // N6.1: deep enough to be a real canvas safety net (the old depth of 2 existed only
  // to unwind an in-flight patch batch).
  const MAX_UNDO_DEPTH = 25;

  function pushUndoSnapshot(): void {
    const stack = [...state.undoStack, { graph: deepClone(state.derivedGraph) }];
    if (stack.length > MAX_UNDO_DEPTH) {
      stack.splice(0, stack.length - MAX_UNDO_DEPTH);
    }
    // A fresh edit forks history: whatever was undone is no longer reachable forward.
    state = { ...state, undoStack: stack, redoStack: [] };
  }

  function canUndo(): boolean {
    return state.undoStack.length > 0;
  }

  function canRedo(): boolean {
    return state.redoStack.length > 0;
  }

  /** Swap the canvas to `target`, banking the current graph on the opposite stack.
   *  Pending (unsaved) patches are dropped: the restored graph BECOMES the base, so
   *  replaying them would re-apply the very edits being reverted. Already-persisted
   *  patches stay in the append-only log untouched — the snapshot is what moves. */
  function restoreGraph(target: Graph, from: 'undo' | 'redo'): boolean {
    const sourceStack = from === 'undo' ? state.undoStack : state.redoStack;
    const nextSource = [...sourceStack];
    nextSource.pop();
    const banked = { graph: deepClone(state.derivedGraph) };
    const restored = deepClone(target);

    state = {
      ...state,
      baseSnapshotGraph: deepClone(restored),
      activeBranch: { ...state.activeBranch, patches: [] },
      derivedGraph: restored,
      lastError: null,
      undoStack: from === 'undo' ? nextSource : [...state.undoStack, banked],
      redoStack: from === 'undo' ? [...state.redoStack, banked] : nextSource,
      graphRevision: state.graphRevision + 1,
    };
    notify();
    return true;
  }

  function undo(): boolean {
    const top = state.undoStack[state.undoStack.length - 1];
    if (!top) return false;
    return restoreGraph(top.graph, 'undo');
  }

  function redo(): boolean {
    const top = state.redoStack[state.redoStack.length - 1];
    if (!top) return false;
    return restoreGraph(top.graph, 'redo');
  }

  function proposePatches(patches: PatchOperation[]): ProposeResult {
    if (patches.length === 0) {
      return { success: true, appliedCount: 0 };
    }

    pushUndoSnapshot();

    let currentGraph = state.derivedGraph;
    const appliedPatches: PatchOperation[] = [];
    const newLogEntries: PatchLogEntry[] = [];

    for (const patch of patches) {
      const validation = validatePatch(currentGraph, patch);

      if (!validation.valid) {
        const error = validation.errors[0];
        newLogEntries.push({
          patch,
          status: 'rejected',
          error,
          appliedAt: now(),
        });

        const newPatches = [...state.activeBranch.patches, ...appliedPatches];
        const derivedGraph = appliedPatches.length > 0
          ? recomputeDerivedGraph(state.baseSnapshotGraph, newPatches)
          : state.derivedGraph;

        state = {
          ...state,
          activeBranch: {
            ...state.activeBranch,
            patches: newPatches,
          },
          derivedGraph,
          lastError: {
            patchId: patch.metadata.id,
            message: error.message,
          },
          patchLog: [...newLogEntries.reverse(), ...state.patchLog],
        };
        notify();

        return {
          success: false,
          appliedCount: appliedPatches.length,
          failedPatchId: patch.metadata.id,
          error: error.message,
        };
      }

      const result = applyPatches(currentGraph, [patch]);
      if (!result.success || !result.graph) {
        const errorMessage = result.error?.message ?? 'Unknown error applying patch';
        newLogEntries.push({
          patch,
          status: 'rejected',
          error: result.error,
          appliedAt: now(),
        });

        const newPatches = [...state.activeBranch.patches, ...appliedPatches];
        const derivedGraph = appliedPatches.length > 0
          ? recomputeDerivedGraph(state.baseSnapshotGraph, newPatches)
          : state.derivedGraph;

        state = {
          ...state,
          activeBranch: {
            ...state.activeBranch,
            patches: newPatches,
          },
          derivedGraph,
          lastError: {
            patchId: patch.metadata.id,
            message: errorMessage,
          },
          patchLog: [...newLogEntries.reverse(), ...state.patchLog],
        };
        notify();

        return {
          success: false,
          appliedCount: appliedPatches.length,
          failedPatchId: patch.metadata.id,
          error: errorMessage,
        };
      }

      currentGraph = result.graph;
      appliedPatches.push(patch);
      newLogEntries.push({
        patch,
        status: 'applied',
        appliedAt: now(),
      });
    }

    const newPatches = [...state.activeBranch.patches, ...appliedPatches];

    state = {
      ...state,
      activeBranch: {
        ...state.activeBranch,
        patches: newPatches,
      },
      derivedGraph: currentGraph,
      lastError: null,
      patchLog: [...newLogEntries.reverse(), ...state.patchLog],
    };
    notify();

    return {
      success: true,
      appliedCount: appliedPatches.length,
    };
  }

  function resetBranch(): void {
    state = {
      ...state,
      activeBranch: {
        id: generateUUID(),
        name: 'main',
        patches: [],
      },
      derivedGraph: deepClone(state.baseSnapshotGraph),
      lastError: null,
      patchLog: [],
      selectedArtifactId: null,
      editorDirty: new Map(),
      editorBuffer: new Map(),
      undoStack: [],
      redoStack: [],
    };
    notify();
  }

  function setBaseSnapshot(graph: Graph): void {
    const migratedGraph = ensureMigratedGraph(graph);
    state = {
      ...state,
      baseSnapshotGraph: deepClone(migratedGraph),
      activeBranch: {
        id: generateUUID(),
        name: 'main',
        patches: [],
      },
      derivedGraph: deepClone(migratedGraph),
      lastError: null,
      patchLog: [],
      selectedArtifactId: null,
      editorDirty: new Map(),
      editorBuffer: new Map(),
      undoStack: [],
      redoStack: [],
    };
    notify();
  }

  function setSelectedNode(id: string | null): void {
    state = {
      ...state,
      selectedNodeId: id,
      selectedEdgeId: null,
    };
    notify();
  }

  function setSelectedEdge(id: string | null): void {
    state = {
      ...state,
      selectedNodeId: null,
      selectedEdgeId: id,
    };
    notify();
  }

  function clearSelection(): void {
    state = {
      ...state,
      selectedNodeId: null,
      selectedEdgeId: null,
    };
    notify();
  }

  function openArtifact(artifactId: string): void {
    const artifact = state.derivedGraph.artifacts[artifactId];
    if (!artifact) {
      return;
    }

    if (!state.editorBuffer.has(artifactId)) {
      state.editorBuffer.set(artifactId, artifact.content || '');
    }

    state = {
      ...state,
      selectedArtifactId: artifactId,
    };
    notify();
  }

  function closeArtifact(): void {
    state = {
      ...state,
      selectedArtifactId: null,
    };
    notify();
  }

  function setEditorContent(artifactId: string, content: string): void {
    const artifact = state.derivedGraph.artifacts[artifactId];
    if (!artifact) {
      return;
    }

    state.editorBuffer.set(artifactId, content);
    state.editorDirty.set(artifactId, content !== (artifact.content || ''));

    state = { ...state };
    notify();
  }

  function getEditorContent(artifactId: string): string | undefined {
    return state.editorBuffer.get(artifactId);
  }

  function isEditorDirty(artifactId: string): boolean {
    return state.editorDirty.get(artifactId) ?? false;
  }

  function createBranchFromMain(branchName: string): void {
    if (state.activeBranch.name !== 'main') {
      return;
    }

    state = {
      ...state,
      activeBranch: {
        id: generateUUID(),
        name: branchName,
        patches: [],
      },
      };
    notify();
  }

  /** N6.1 fix (owner-caught): the autosave commit is persistence bookkeeping on the
   *  SAME canvas — it must NOT erase undo history. It previously reused
   *  setBaseSnapshot + switchToBranch, both of which clear the stacks, so undo went
   *  dead ~3 seconds after every edit. `savedGraph` becomes the new base (what the DB
   *  now holds) and `remainingPatches` are the edits proposed while the save was in
   *  flight; undo/redo stacks and graphRevision survive untouched. */
  function commitSavedSnapshot(savedGraph: Graph, remainingPatches: PatchOperation[]): void {
    const migrated = ensureMigratedGraph(savedGraph);
    state = {
      ...state,
      baseSnapshotGraph: deepClone(migrated),
      activeBranch: { ...state.activeBranch, patches: remainingPatches },
      derivedGraph: recomputeDerivedGraph(migrated, remainingPatches),
      lastError: null,
    };
    notify();
  }

  function switchToBranch(branchId: string, branchName: string, patches: PatchOperation[]): void {
    const derivedGraph = recomputeDerivedGraph(state.baseSnapshotGraph, patches);

    state = {
      ...state,
      activeBranch: {
        id: branchId,
        name: branchName,
        patches,
      },
      derivedGraph,
      lastError: null,
      undoStack: [],
      redoStack: [],
    };
    notify();
  }

  // R3-3b: mergeToMain() DELETED (the stray-path kill list). The in-memory merge
  // algebra bypassed git entirely; a design merge is now a git merge (PR by
  // default). Branch state changes arrive through switchToBranch after the
  // provider merge + R3-1 loader have moved the real model.

  function setAvailableBranches(branches: Array<{ id: string; name: string; patchCount: number }>): void {
    state = {
      ...state,
      availableBranches: branches,
    };
    notify();
  }

  return {
    getState,
    subscribe,
    proposePatches,
    undo,
    redo,
    canUndo,
    canRedo,
    resetBranch,
    setBaseSnapshot,
    commitSavedSnapshot,
    setSelectedNode,
    setSelectedEdge,
    clearSelection,
    openArtifact,
    closeArtifact,
    setEditorContent,
    getEditorContent,
    isEditorDirty,
    createBranchFromMain,
    switchToBranch,
    setAvailableBranches,
  };
}

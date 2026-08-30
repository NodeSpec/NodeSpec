import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { Graph, Artifact, PatchOperation, ArtifactKind } from '@nodespec/core/types.js';
import { createUpdateArtifactPatch, createRemoveArtifactPatch, createAddArtifactPatch } from '@nodespec/core/patch-factory.js';
import { computeContentHash, generateUUID, now } from '@nodespec/core/utils.js';
import { buildUpdateNodePatch } from '../../builders/patchBuilders.js';
import { getContainerTypeById } from '@nodespec/core/container-types.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { Tooltip } from '../common/Tooltip.js';
import { buildNodeExportContext } from '../../utils/export-context.js';
import { copyToClipboard } from '../../utils/export-context.js';

interface ArtifactWorkbenchPanelProps {
  selectedNodeId: string | null;
  graph: Graph;
  onPatchGenerated: (patch: PatchOperation) => void;
  initialArtifactId?: string | null;
  /** P1-7 R2.1: hydrate a content-less bound artifact (e.g. adopted from the anchor) from the repo. */
  onLoadFromRepo?: (artifactId: string) => Promise<void>;
}

export function ArtifactWorkbenchPanel({
  selectedNodeId,
  graph,
  onPatchGenerated,
  initialArtifactId,
  onLoadFromRepo,
}: ArtifactWorkbenchPanelProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const selectedNode = selectedNodeId ? graph.nodes[selectedNodeId] : null;
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newArtifactPath, setNewArtifactPath] = useState('');
  const [newArtifactKind, setNewArtifactKind] = useState<ArtifactKind>('source');
  const [activeTab, setActiveTab] = useState<'editor' | 'context'>('editor');
  const [contextCopied, setContextCopied] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState('');
  const renameTabInputRef = useRef<HTMLInputElement>(null);

  const nodeArtifacts = useMemo(() => {
    if (!selectedNode) return [];
    return Object.values(graph.artifacts)
      .filter(a => a.nodeId === selectedNode.id && a.status !== 'suggested')
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [graph.artifacts, selectedNode]);

  // N5.5: the suggested-file Accept/Dismiss flow moved here from the inspector —
  // Accept is the LIVE gate (suggested→draft is what makes a file visible to task
  // packets and MCP context).
  const suggestedArtifacts = useMemo(() => {
    if (!selectedNode) return [];
    return Object.values(graph.artifacts)
      .filter(a => a.nodeId === selectedNode.id && a.status === 'suggested')
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [graph.artifacts, selectedNode]);

  const handleAcceptSuggested = useCallback((artifact: Artifact) => {
    onPatchGenerated(createUpdateArtifactPatch(
      artifact.id,
      { status: 'draft' },
      { actorType: 'human', summary: `Accept suggested file ${artifact.path}` },
    ));
  }, [onPatchGenerated]);

  const handleDismissSuggested = useCallback((artifact: Artifact) => {
    onPatchGenerated(createRemoveArtifactPatch(artifact.id, {
      actorType: 'human',
      summary: `Dismiss suggested file ${artifact.path}`,
    }));
  }, [onPatchGenerated]);

  const activeArtifact = activeArtifactId ? graph.artifacts[activeArtifactId] : null;

  // Owner bench 2026-07-29: a body-less binding hydrates ITSELF when opened —
  // the user shouldn't have to find and click "Load from repo" (the button stays
  // as the manual retry for when the auto-attempt fails). One attempt per
  // artifact per mount; a failure surfaces via the caller's toast.
  const autoHydrateAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeArtifact || !onLoadFromRepo) return;
    if (activeArtifact.content || !activeArtifact.path) return;
    if (autoHydrateAttemptedRef.current.has(activeArtifact.id)) return;
    autoHydrateAttemptedRef.current.add(activeArtifact.id);
    void onLoadFromRepo(activeArtifact.id);
  }, [activeArtifact, onLoadFromRepo]);

  useEffect(() => {
    if (activeArtifact) {
      setEditorContent(activeArtifact.content || '');
      setLastSaved(null);
    } else {
      setEditorContent('');
    }
  }, [activeArtifactId, activeArtifact]);

  useEffect(() => {
    if (initialArtifactId && graph.artifacts[initialArtifactId]) {
      setActiveArtifactId(initialArtifactId);
    } else if (nodeArtifacts.length > 0) {
      setActiveArtifactId(nodeArtifacts[0].id);
    } else {
      setActiveArtifactId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  const handleContentChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setEditorContent(value);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeArtifact || editorContent === (activeArtifact.content ?? '')) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const newContentHash = computeContentHash(editorContent);
      const patch = createUpdateArtifactPatch(
        activeArtifact.id,
        {
          content: editorContent,
          contentHash: newContentHash,
          updatedAt: now(),
        },
        {
          actorType: 'human',
          summary: `Update artifact ${activeArtifact.path}`,
          preconditions: [{
            type: 'value_equals',
            path: `artifacts.${activeArtifact.id}.contentHash`,
            expected: activeArtifact.contentHash,
          }],
        }
      );

      onPatchGenerated(patch);
      setLastSaved(new Date().toLocaleTimeString());
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [activeArtifact, editorContent, onPatchGenerated]);

  useEffect(() => {
    if (!activeArtifact) {
      return;
    }

    // Normalize undefined -> '' : a content-less artifact (e.g. MCP-proposed file pointer)
    // must not trigger a spurious empty-content save just from being OPENED — the editor
    // initializes to '' and ('' !== undefined) used to fire this autosave immediately.
    if (editorContent === (activeArtifact.content ?? '')) {
      return;
    }

    const timer = setTimeout(() => {
      if (activeArtifact && editorContent !== (activeArtifact.content ?? '')) {
        handleSave();
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [editorContent, activeArtifact, handleSave]);

  const handleCreateArtifact = useCallback(() => {
    if (!selectedNode || !newArtifactPath.trim()) return;

    const artifactId = generateUUID();
    const content = '';
    const artifact: Artifact = {
      id: artifactId,
      nodeId: selectedNode.id,
      kind: newArtifactKind,
      path: newArtifactPath.trim(),
      content,
      contentHash: computeContentHash(content),
      createdAt: now(),
      updatedAt: now(),
      metadata: {},
      status: 'draft',
    };

    const addArtifactPatch = createAddArtifactPatch(artifact, {
      actorType: 'human',
      summary: `Create artifact ${artifact.path}`,
    });

    const currentArtifacts = selectedNode.artifacts || [];
    const updateNodePatch = buildUpdateNodePatch({
      nodeId: selectedNode.id,
      updates: {
        artifacts: [...currentArtifacts, artifactId],
      },
      actor: 'human',
      summary: `Link artifact ${artifact.path} to node ${selectedNode.label}`,
    });

    onPatchGenerated(addArtifactPatch);
    onPatchGenerated(updateNodePatch);
    setActiveArtifactId(artifactId);
    setNewArtifactPath('');
    setIsCreating(false);
  }, [selectedNode, newArtifactPath, newArtifactKind, onPatchGenerated]);

  const handleDeleteArtifact = useCallback((artifactId: string) => {
    if (!selectedNode) return;
    if (!confirm('Are you sure you want to delete this artifact?')) return;

    const currentArtifacts = selectedNode.artifacts || [];
    const updateNodePatch = buildUpdateNodePatch({
      nodeId: selectedNode.id,
      updates: {
        artifacts: currentArtifacts.filter(id => id !== artifactId),
      },
      actor: 'human',
      summary: `Unlink artifact from node ${selectedNode.label}`,
    });

    const deleteArtifactPatch = createRemoveArtifactPatch(artifactId, {
      actorType: 'human',
      summary: `Delete artifact`,
    });

    onPatchGenerated(updateNodePatch);
    onPatchGenerated(deleteArtifactPatch);

    if (activeArtifactId === artifactId) {
      setActiveArtifactId(null);
    }
  }, [selectedNode, activeArtifactId, onPatchGenerated]);

  const handleToggleStatus = useCallback(() => {
    if (!activeArtifact) return;

    const newStatus = activeArtifact.status === 'complete' ? 'draft' : 'complete';
    const patch = createUpdateArtifactPatch(
      activeArtifact.id,
      { status: newStatus },
      {
        actorType: 'human',
        summary: `Mark artifact ${activeArtifact.path} as ${newStatus}`,
      }
    );

    onPatchGenerated(patch);
  }, [activeArtifact, onPatchGenerated]);

  const handleChangeKind = useCallback((newKind: ArtifactKind) => {
    if (!activeArtifact) return;

    const patch = createUpdateArtifactPatch(
      activeArtifact.id,
      { kind: newKind, updatedAt: now() },
      {
        actorType: 'human',
        summary: `Change artifact kind to ${newKind}`,
      }
    );
    onPatchGenerated(patch);
  }, [activeArtifact, onPatchGenerated]);

  const handleStartTabRename = useCallback((artifact: Artifact) => {
    setRenamingTabId(artifact.id);
    setRenamingPath(artifact.path);
  }, []);

  const handleCommitTabRename = useCallback((artifactId: string) => {
    const trimmed = renamingPath.trim();
    const artifact = nodeArtifacts.find(a => a.id === artifactId);
    if (!trimmed || !artifact || trimmed === artifact.path) {
      setRenamingTabId(null);
      return;
    }
    const duplicate = nodeArtifacts.find(a => a.id !== artifactId && a.path === trimmed);
    if (duplicate) {
      alert(`An artifact with path "${trimmed}" already exists on this node`);
      return;
    }
    const patch = createUpdateArtifactPatch(artifactId, { path: trimmed }, {
      actorType: 'human',
      summary: `Rename artifact to ${trimmed}`,
    });
    onPatchGenerated(patch);
    setRenamingTabId(null);
  }, [renamingPath, nodeArtifacts, onPatchGenerated]);

  useEffect(() => {
    if (renamingTabId && renameTabInputRef.current) {
      renameTabInputRef.current.focus();
      renameTabInputRef.current.select();
    }
  }, [renamingTabId]);

  const moveTargetNodes = useMemo(() => {
    return Object.values(graph.nodes)
      .filter(n => !getContainerTypeById(n.type) && n.id !== selectedNodeId)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [graph.nodes, selectedNodeId]);

  const handleMoveArtifact = useCallback((artifactId: string, newNodeId: string) => {
    const targetNode = graph.nodes[newNodeId];
    if (!targetNode) return;
    const patch = createUpdateArtifactPatch(artifactId, { nodeId: newNodeId }, {
      actorType: 'human',
      summary: `Move artifact to ${targetNode.label}`,
    });
    onPatchGenerated(patch);
  }, [graph.nodes, onPatchGenerated]);

  const detectLanguage = useCallback((path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'json': 'json',
      'md': 'markdown',
      'yml': 'yaml',
      'yaml': 'yaml',
      'html': 'html',
      'css': 'css',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
    };
    return languageMap[ext || ''] || 'plaintext';
  }, []);

  const nodeExportJson = useMemo(() => {
    if (!selectedNodeId) return '';
    const ctx = buildNodeExportContext(selectedNodeId, graph, { includeArtifactContent: true });
    return ctx ? JSON.stringify(ctx, null, 2) : '';
  }, [selectedNodeId, graph]);

  const handleCopyContext = useCallback(async () => {
    const success = await copyToClipboard(nodeExportJson);
    if (success) {
      setContextCopied(true);
      setTimeout(() => setContextCopied(false), 2000);
    }
  }, [nodeExportJson]);

  if (!selectedNode) return null;

  // M6: the `!embedded` shell is gone. NodeSidepane is the ONLY mount and always passes
  // `embedded` — this was the same dead-shell class N8.6(B) removed from
  // SimplifiedInspector, never applied here.
  const panelStyles: React.CSSProperties = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' };

  const headerStyles: React.CSSProperties = {
    padding: '16px 20px',
    borderBottom: `1px solid ${c.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: c.backgroundSecondary,
    borderRadius: '12px 12px 0 0',
  };


  const tabsContainerStyles: React.CSSProperties = {
    display: 'flex',
    overflowX: 'auto',
    borderBottom: `1px solid ${c.border}`,
    backgroundColor: c.backgroundSecondary,
    padding: '8px 12px 0 12px',
    gap: '4px',
  };

  const tabStyles = (isActive: boolean): React.CSSProperties => ({
    padding: '8px 12px',
    fontSize: '12px',
    backgroundColor: isActive ? c.surface : 'transparent',
    border: isActive ? `1px solid ${c.border}` : '1px solid transparent',
    borderBottom: isActive ? `1px solid ${c.surface}` : `1px solid transparent`,
    borderRadius: '6px 6px 0 0',
    cursor: 'pointer',
    color: isActive ? c.text : c.textMuted,
    fontWeight: isActive ? 600 : 400,
    whiteSpace: 'nowrap',
    marginBottom: '-1px',
    transition: 'all 0.15s ease',
  });

  const editorContainerStyles: React.CSSProperties = {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  };

  const statusBarStyles: React.CSSProperties = {
    padding: '8px 16px',
    borderTop: `1px solid ${c.border}`,
    fontSize: '11px',
    color: c.textMuted,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: c.backgroundSecondary,
  };

  const buttonStyles: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };

  return (
    <div style={panelStyles}>
      <div style={{ ...headerStyles, borderRadius: 0, padding: '8px 16px' }}>
        <span style={{ fontSize: '11px', color: c.textMuted }}>
          {nodeArtifacts.length} {nodeArtifacts.length === 1 ? 'file' : 'files'}
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* Owner-directed (2026-07-28): the per-file actions live UP HERE next to
              + New, not buried in the bottom status bar (which is status-only now). */}
          {activeTab === 'editor' && activeArtifact && (
            <>
              {!activeArtifact.content && onLoadFromRepo && (
                <Tooltip content="This file is a binding without a body (e.g. adopted from the design anchor). Pull its content from your connected git repository.">
                  <button
                    style={{
                      ...buttonStyles,
                      padding: '6px 10px',
                      backgroundColor: 'transparent',
                      color: c.primary,
                      border: `1px solid ${c.primary}`,
                    }}
                    onClick={() => { void onLoadFromRepo(activeArtifact.id); }}
                  >
                    Load from repo
                  </button>
                </Tooltip>
              )}
              <Tooltip content={activeArtifact.status === 'complete' ? 'Mark as draft to edit again' : 'Locks this file as finalized and read-only'}>
                <button
                  style={{
                    ...buttonStyles,
                    padding: '6px 10px',
                    backgroundColor: 'transparent',
                    color: activeArtifact.status === 'complete' ? c.warning : c.success,
                    border: `1px solid ${activeArtifact.status === 'complete' ? c.warning : c.success}`,
                  }}
                  onClick={handleToggleStatus}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = activeArtifact.status === 'complete' ? c.warningBg : c.successBg;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {activeArtifact.status === 'complete' ? 'Unlock' : 'Complete'}
                </button>
              </Tooltip>
              <button
                style={{
                  ...buttonStyles,
                  padding: '6px 10px',
                  backgroundColor: 'transparent',
                  color: c.error,
                  border: `1px solid ${c.error}`,
                }}
                onClick={() => handleDeleteArtifact(activeArtifact.id)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = c.errorBg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                Delete
              </button>
            </>
          )}
          <button
            style={{
              ...buttonStyles,
              backgroundColor: c.primary,
              color: 'white',
            }}
            onClick={() => setIsCreating(!isCreating)}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.9';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
          >
            + New
          </button>
        </div>
      </div>

      {isCreating && (
        <div style={{
          padding: '16px',
          backgroundColor: c.background,
          borderBottom: `1px solid ${c.border}`,
        }}>
          <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '12px', fontStyle: 'italic' }}>
            📁 Creating artifact for <strong style={{ color: c.text }}>{selectedNode.label}</strong>
          </div>
          <div style={{ marginBottom: '8px' }}>
            <select
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: c.backgroundSecondary,
                border: `1px solid ${c.border}`,
                borderRadius: '4px',
                color: c.text,
                fontSize: '12px',
                marginBottom: '8px',
              }}
              value={newArtifactKind}
              onChange={(e) => setNewArtifactKind(e.target.value as ArtifactKind)}
            >
              <option value="task">Task Document</option>
              <option value="source">Source Code</option>
              <option value="schema">Schema</option>
              <option value="doc">Documentation</option>
              <option value="config">Configuration</option>
              <option value="build">Build Script</option>
            </select>
            <input
              type="text"
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: c.backgroundSecondary,
                border: `1px solid ${c.border}`,
                borderRadius: '4px',
                color: c.text,
                fontSize: '12px',
              }}
              placeholder="Path (e.g., src/index.ts)"
              value={newArtifactPath}
              onChange={(e) => setNewArtifactPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateArtifact();
                }
                if (e.key === 'Escape') {
                  setIsCreating(false);
                  setNewArtifactPath('');
                }
              }}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={{
                ...buttonStyles,
                flex: 1,
                backgroundColor: c.primary,
                color: 'white',
              }}
              onClick={handleCreateArtifact}
            >
              Create
            </button>
            <button
              style={{
                ...buttonStyles,
                flex: 1,
                backgroundColor: c.backgroundTertiary,
                color: c.text,
              }}
              onClick={() => {
                setIsCreating(false);
                setNewArtifactPath('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {suggestedArtifacts.length > 0 && (
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${c.border}`, backgroundColor: c.background }}>
          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: c.textMuted, marginBottom: '6px' }}>
            Suggested files
          </div>
          {suggestedArtifacts.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: '12px', color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.description || a.path}>
                {a.path}
              </span>
              <button
                style={{ padding: '2px 10px', fontSize: '11px', fontWeight: 600, border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: c.primary, color: 'white' }}
                onClick={() => handleAcceptSuggested(a)}
                title="Accept — the file becomes visible to task packets and the AI"
              >
                Accept
              </button>
              <button
                style={{ padding: '2px 10px', fontSize: '11px', border: `1px solid ${c.border}`, borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent', color: c.textMuted }}
                onClick={() => handleDismissSuggested(a)}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${c.border}`,
        backgroundColor: c.backgroundSecondary,
        padding: '0 16px',
      }}>
        {(['editor', 'context'] as const).map((tab) => (
          <button
            key={tab}
            style={{
              padding: '10px 16px',
              fontSize: '12px',
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? c.primary : c.textMuted,
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? `2px solid ${c.primary}` : '2px solid transparent',
              cursor: 'pointer',
              textTransform: 'capitalize',
              marginBottom: '-1px',
            }}
            onClick={() => setActiveTab(tab as typeof activeTab)}
            onMouseEnter={(e) => {
              if (activeTab !== tab) {
                e.currentTarget.style.color = c.text;
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab) {
                e.currentTarget.style.color = c.textMuted;
              }
            }}
          >
            {tab === 'editor' && `Editor (${nodeArtifacts.length})`}
            {tab === 'context' && 'Context'}
          </button>
        ))}
      </div>

      {/* Editor Tab */}
      {activeTab === 'editor' && nodeArtifacts.length > 0 && (
        <>
          <div style={tabsContainerStyles}>
            {nodeArtifacts.map((artifact) => {
              const isActive = artifact.id === activeArtifactId;
              const isRenaming = renamingTabId === artifact.id;
              return (
                <div
                  key={artifact.id}
                  style={tabStyles(isActive)}
                  onClick={() => setActiveArtifactId(artifact.id)}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = c.backgroundTertiary;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isRenaming ? (
                      <input
                        ref={renameTabInputRef}
                        type="text"
                        value={renamingPath}
                        onChange={(e) => setRenamingPath(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCommitTabRename(artifact.id);
                          else if (e.key === 'Escape') setRenamingTabId(null);
                          e.stopPropagation();
                        }}
                        onBlur={() => handleCommitTabRename(artifact.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: '12px',
                          fontFamily: 'inherit',
                          background: c.backgroundSecondary,
                          border: `1px solid ${c.primary}`,
                          borderRadius: '3px',
                          color: c.text,
                          padding: '1px 4px',
                          outline: 'none',
                          width: '140px',
                        }}
                      />
                    ) : (
                      <span>{artifact.path.split('/').pop()}</span>
                    )}
                    {artifact.status === 'complete' && (
                      <span style={{ fontSize: '10px', opacity: 0.6 }}>✓</span>
                    )}
                    {isActive && artifact.status !== 'complete' && !isRenaming && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartTabRename(artifact);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '0 2px',
                          fontSize: '11px',
                          color: c.textMuted,
                          lineHeight: 1,
                        }}
                        title="Rename artifact"
                        onMouseEnter={(e) => { e.currentTarget.style.color = c.text; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = c.textMuted; }}
                      >
                        ✏
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {activeArtifact && (
            <>
              <div style={editorContainerStyles}>
                <Editor
                  key={activeArtifactId}
                  height="100%"
                  language={detectLanguage(activeArtifact.path)}
                  value={editorContent}
                  onChange={handleContentChange}
                  theme={theme.mode === 'dark' ? 'vs-dark' : 'light'}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    readOnly: activeArtifact.status === 'complete',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              </div>

              <div style={statusBarStyles}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <span>
                    {isSaving && 'Saving...'}
                    {!isSaving && lastSaved && `Saved at ${lastSaved}`}
                    {!isSaving && !lastSaved && editorContent === activeArtifact.content && 'All changes saved'}
                    {saveError && <span style={{ color: c.error }}>{saveError}</span>}
                  </span>
                  <span style={{ fontSize: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {activeArtifact.status !== 'complete' ? (
                      <select
                        style={{
                          padding: '2px 4px',
                          backgroundColor: c.backgroundTertiary,
                          border: `1px solid ${c.border}`,
                          borderRadius: '4px',
                          color: c.text,
                          fontSize: '10px',
                          cursor: 'pointer',
                        }}
                        value={activeArtifact.kind}
                        onChange={(e) => handleChangeKind(e.target.value as ArtifactKind)}
                        title="Change artifact type"
                      >
                        <option value="task">task</option>
                        <option value="source">source</option>
                        <option value="schema">schema</option>
                        <option value="doc">doc</option>
                        <option value="config">config</option>
                        <option value="build">build</option>
                      </select>
                    ) : (
                      activeArtifact.kind
                    )}
                    <span>•</span>
                    <span>{activeArtifact.status || 'draft'}</span>
                    <span>•</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      Node:
                      {activeArtifact.status !== 'complete' ? (
                        <select
                          style={{
                            padding: '2px 4px',
                            backgroundColor: c.backgroundTertiary,
                            border: `1px solid ${c.border}`,
                            borderRadius: '4px',
                            color: c.text,
                            fontSize: '10px',
                            cursor: 'pointer',
                            maxWidth: '120px',
                          }}
                          value={activeArtifact.nodeId}
                          onChange={(e) => handleMoveArtifact(activeArtifact.id, e.target.value)}
                          title="Move artifact to another node"
                        >
                          <option value={activeArtifact.nodeId}>
                            {selectedNode?.label || 'Current'}
                          </option>
                          {moveTargetNodes.map(n => (
                            <option key={n.id} value={n.id}>{n.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span>{selectedNode?.label || 'Unknown'}</span>
                      )}
                    </span>
                  </span>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Context Tab */}
      {activeTab === 'context' && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${c.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: '12px', color: c.textMuted }}>
              Node export context (JSON)
            </span>
            <button
              style={{
                ...buttonStyles,
                padding: '4px 12px',
                backgroundColor: contextCopied ? c.success : c.primary,
                color: 'white',
                fontSize: '11px',
              }}
              onClick={handleCopyContext}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              {contextCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Editor
              key="context-json"
              height="100%"
              language="json"
              value={nodeExportJson}
              theme={theme.mode === 'dark' ? 'vs-dark' : 'light'}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
              }}
            />
          </div>
        </div>
      )}

      {activeTab === 'editor' && nodeArtifacts.length === 0 && !isCreating && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: c.textMuted,
          fontSize: '13px',
          fontStyle: 'italic',
        }}>
          No artifacts yet. Click "+ New" to create one.
        </div>
      )}

    </div>
  );
}

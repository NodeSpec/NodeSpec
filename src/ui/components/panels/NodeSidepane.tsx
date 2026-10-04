// N5.5 (owner direction 2026-07-24): ONE popup sidepane. The node Inspector and the
// Artifact Workbench were two mutually-exclusive fixed cards at the same anchor; this
// shell merges them behind two tabs — Details (the simplified inspector) and Files
// (the workbench: Monaco tabs + create/rename/delete;
// its internal editor|context toggle is the context view). Edges show Details only.
// Selection drives visibility, exactly as the inspector always behaved.
import { useTheme } from '../../theme/ThemeContext.js';
import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import { SimplifiedInspector } from './SimplifiedInspector.js';
import { ArtifactWorkbenchPanel } from './ArtifactWorkbenchPanel.js';
import { getTechnologyLogo } from '../../utils/technology-logo-map.js';
import { getNodeTypeById } from '@nodespec/core/node-types.js';
import { NodeIcon } from '../common/index.js';
import { getContractKindLabel, getContractKindColor } from './inspector/kind-maps.js';
import { ArchitectureRail, type WorkTarget } from './ArchitectureRail.js';
import type { StagedExplode } from '../../utils/explode-staging.js';

export type SidepaneTab = 'details' | 'files';

interface NodeSidepaneProps {
  /** V3 4.4: the rail reads the node's items and holds per project. */
  projectId?: string | null;
  /** AA.7: the branch the rail reads the node's history on. */
  branchId?: string | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  graph: Graph;
  onPatchGenerated: (patch: PatchOperation) => void;
  tab: SidepaneTab;
  onTabChange: (tab: SidepaneTab) => void;
  focusArtifactId?: string | null;
  onLoadFromRepo?: (artifactId: string) => Promise<boolean | void>;
  /** Details only, no tab bar (kept for embedded hosts; the retired
   *  DecompositionCanvas was its original user). */
  detailsOnly?: boolean;
  /** The rail's Work here rows open Work on that record. */
  onOpenWork?: (target: WorkTarget) => void;
  /** An imported candidate on the node is decided under Proposals. */
  onOpenChanges?: () => void;
  /** AE.6: the explode requests staged on the project, and the two presses. */
  stagedExplodes?: readonly StagedExplode[];
  onRequestExplode?: (nodeId: string) => void;
  onWithdrawExplode?: (nodeId: string) => void;
}

export function NodeSidepane({
  projectId,
  branchId,
  selectedNodeId,
  selectedEdgeId,
  graph,
  onPatchGenerated,
  tab,
  onTabChange,
  focusArtifactId,
  onLoadFromRepo,
  detailsOnly,
  onOpenWork,
  onOpenChanges,
  stagedExplodes,
  onRequestExplode,
  onWithdrawExplode,
}: NodeSidepaneProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const selectedNode = selectedNodeId ? graph.nodes[selectedNodeId] : null;
  const selectedEdge = selectedEdgeId ? graph.edges[selectedEdgeId] : null;
  if (!selectedNode && !selectedEdge) return null;

  const showTabs = !detailsOnly && !!selectedNode;
  const activeTab: SidepaneTab = showTabs ? tab : 'details';
  const wide = activeTab === 'files';

  // Owner-directed (2026-07-28): the panel's head starts BELOW the floating view
  // pill (Specification/Decomposition/Architecture/Export — TopBar 56px + pill top
  // 16px + pill ~50px ≈ 122px), so the two never overlap on the right edge.
  const panelStyles: React.CSSProperties = {
    position: 'fixed',
    right: '20px',
    top: '128px',
    width: wide ? 'min(600px, calc(100vw - 40px))' : 'min(380px, calc(100vw - 40px))',
    height: 'calc(100vh - 148px)',
    maxHeight: 'calc(100vh - 148px)',
    backgroundColor: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: '12px',
    boxShadow: theme.mode === 'dark'
      ? '0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3)'
      : '0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)',
    color: c.textSecondary,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 201,
    transition: 'width 0.15s ease',
  };

  return (
    <div style={panelStyles}>
      <div style={{
        padding: '12px 16px',
        borderBottom: showTabs ? 'none' : `1px solid ${c.border}`,
        fontSize: '14px',
        fontWeight: 600,
        color: c.text,
        backgroundColor: c.backgroundSecondary,
        borderRadius: '12px 12px 0 0',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        {selectedNode && (() => {
          const techLogo = getTechnologyLogo(selectedNode.technology);
          if (techLogo) {
            return <img src={techLogo} alt={selectedNode.technology || selectedNode.type} style={{ width: '20px', height: '20px', objectFit: 'contain' }} />;
          }
          const nodeType = getNodeTypeById(selectedNode.type);
          return <NodeIcon nodeType={selectedNode.type} emojiIcon={nodeType?.icon} size={20} position="center" />;
        })()}
        {/* N8.6(B): edge selection gets IDENTITY — both endpoints + the kind chip —
            instead of the bare word "Connection". */}
        {selectedNode ? (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedNode.label}
          </span>
        ) : selectedEdge ? (() => {
          const sourceLabel = graph.nodes[selectedEdge.source]?.label || 'Unknown';
          const targetLabel = graph.nodes[selectedEdge.target]?.label || 'Unknown';
          const kind = graph.contracts[selectedEdge.contractId]?.kind;
          const kindColor = kind ? getContractKindColor(kind, theme.mode) : null;
          return (
            <>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                {sourceLabel} → {targetLabel}
              </span>
              {kind && kindColor && (
                <span style={{
                  padding: '2px 8px',
                  fontSize: '10px',
                  fontWeight: 600,
                  color: kindColor,
                  backgroundColor: kindColor + '14',
                  borderRadius: '4px',
                  border: `1px solid ${kindColor}30`,
                  letterSpacing: '0.02em',
                  flexShrink: 0,
                }}>
                  {getContractKindLabel(kind)}
                </span>
              )}
            </>
          );
        })() : null}
      </div>

      {showTabs && (
        <div style={{
          display: 'flex',
          borderBottom: `1px solid ${c.border}`,
          backgroundColor: c.backgroundSecondary,
          padding: '0 12px',
          flexShrink: 0,
        }}>
          {(['details', 'files'] as const).map(t => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              style={{
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: activeTab === t ? 600 : 400,
                color: activeTab === t ? c.primary : c.textMuted,
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: activeTab === t ? `2px solid ${c.primary}` : '2px solid transparent',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'details' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {/* V3 4.4: what lives on the node, who holds it, what it connects to. */}
          {selectedNodeId && selectedNode && <ArchitectureRail projectId={projectId} branchId={branchId} nodeId={selectedNodeId} graph={graph} onOpenWork={onOpenWork} onOpenChanges={onOpenChanges} stagedExplodes={stagedExplodes} onRequestExplode={onRequestExplode} onWithdrawExplode={onWithdrawExplode} />}
          <SimplifiedInspector
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            graph={graph}
            onPatchGenerated={onPatchGenerated}
          />
        </div>
      )}

      {activeTab === 'files' && selectedNodeId && (
        <ArtifactWorkbenchPanel
          selectedNodeId={selectedNodeId}
          graph={graph}
          onPatchGenerated={onPatchGenerated}
          initialArtifactId={focusArtifactId}
          onLoadFromRepo={onLoadFromRepo}
        />
      )}
    </div>
  );
}

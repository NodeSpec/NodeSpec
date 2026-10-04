import { memo } from 'react';
import { LeafHandles } from './LeafHandles.js';
import { NodeActionToolbar, useNodeToolbarHover } from './NodeActionToolbar.js';
import { BookOpen } from 'lucide-react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { ContainerBadge } from './ContainerBadge.js';
import { getTechnologyLogo, getTechnologyColors, getTechnologyDisplayName } from '../../utils/technology-logo-map.js';

interface LibraryNodeProps {
  data: RFNodeData;
  selected?: boolean;
}


function LibraryNodeComponent({ data, selected }: LibraryNodeProps) {
  // UX-1.3: the action pane shows on hover as well as selection.
  const toolbarHover = useNodeToolbarHover();
  const { theme } = useTheme();
  const c = theme.colors;

  const techColors = getTechnologyColors(data.technology);
  const accentColor = techColors?.primary || '#0ea5e9';
  const techLogo = getTechnologyLogo(data.technology);
  const techName = getTechnologyDisplayName(data.technology) || data.technology;

  const version = (data.metadata?.version as string) || '';
  const libraryName = (data.metadata?.libraryName as string) || '';
  const HIGHLIGHT_COLOR = '#22c55e';

  // V3 task 0.3: the export-surface panel read code_structures (dropped in
  // 20260913150000) via useLibraryExports. AG.13: the counts fell back to the
  // type's port list, which said 1 and 1 for every library; now each shows
  // only when the node declares it, and the row only when one is declared.
  const exportedModules = Array.isArray(data.metadata?.exportedModules) ? data.metadata.exportedModules as string[] : null;
  const peerDependencies = Array.isArray(data.metadata?.peerDependencies) ? data.metadata.peerDependencies as string[] : null;

  const containerStyles: React.CSSProperties = {
    minWidth: '190px',
    maxWidth: '240px',
    backgroundColor: c.surface,
    borderRadius: '10px',
    borderLeft: `5px solid ${accentColor}`,
    border: `1px solid ${c.border}`,
    borderLeftWidth: '5px',
    borderLeftColor: accentColor,
    boxShadow: selected
      ? `0 0 0 3px ${c.primary}40, 0 8px 24px rgba(0, 0, 0, 0.15)`
      : data.highlighted
        ? `0 0 0 3px ${HIGHLIGHT_COLOR}30, 0 8px 24px rgba(0, 0, 0, 0.15)`
        : '0 4px 12px rgba(0, 0, 0, 0.08)',
    position: 'relative',
    overflow: 'visible',
  };

  return (
    <div style={containerStyles} className="library-node" {...toolbarHover.nodeHoverProps}>
      <NodeActionToolbar visible={!!selected || toolbarHover.hoverVisible} data={data} bridgeProps={toolbarHover.bridgeProps} />

      {version && (
        <div style={{
          position: 'absolute',
          top: '-8px',
          left: '12px',
          fontSize: '9px',
          fontWeight: 600,
          padding: '1px 6px',
          borderRadius: '4px',
          backgroundColor: `${accentColor}15`,
          color: accentColor,
          border: `1px solid ${accentColor}30`,
          zIndex: 10,
        }}>
          v{version}
        </div>
      )}

      <LeafHandles
        style={{
          width: '12px',
          height: '12px',
          backgroundColor: c.surface,
          border: `3px solid ${accentColor}`,
          top: '50%',
          boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        }}
        targetStyle={{ left: '-6px' }}
        sourceStyle={{ right: '-6px' }}
      />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '14px 16px',
      }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '8px',
          backgroundColor: `${accentColor}15`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1.5px solid ${accentColor}40`,
          flexShrink: 0,
        }}>
          {techLogo ? (
            <img src={techLogo} alt="" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
          ) : (
            <BookOpen size={18} color={accentColor} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600,
            fontSize: '13px',
            color: c.text,
            marginBottom: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {data.label}
          </div>
          <div style={{
            fontSize: '10px',
            color: c.textMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {libraryName || techName || 'Library'}
          </div>
        </div>
      </div>

      {data.containerParentLabel && (
        <div style={{ padding: '0 16px 4px' }}>
          <ContainerBadge label={data.containerParentLabel} placementKind={data.containerPlacementKind} />
        </div>
      )}

      {(exportedModules || peerDependencies) && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-around',
          padding: '0 16px 10px',
          borderTop: `1px solid ${c.border}`,
          marginTop: '2px',
          paddingTop: '8px',
        }}>
          {exportedModules && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: accentColor }}>
                {String(exportedModules.length)}
              </div>
              <div style={{ fontSize: '9px', color: c.textMuted, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                Exports
              </div>
            </div>
          )}
          {exportedModules && peerDependencies && <div style={{ width: '1px', backgroundColor: c.border }} />}
          {peerDependencies && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: c.text }}>
                {String(peerDependencies.length)}
              </div>
              <div style={{ fontSize: '9px', color: c.textMuted, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                Deps
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const LibraryNode = memo(LibraryNodeComponent);

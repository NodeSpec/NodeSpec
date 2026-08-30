import { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { NodeIcon } from '../common/index.js';
import { getTechnologyLogo, getTechnologyColors, getTechnologyDisplayName } from '../../utils/technology-logo-map.js';
import { FallbackHandles } from './FallbackHandles.js';
import { NodeActionToolbar, useNodeToolbarHover } from './NodeActionToolbar.js';
import { CatalogService } from '../../services/CatalogService.js';

interface CompactIconNodeProps {
  data: RFNodeData;
  selected?: boolean;
}

function CompactIconNodeComponent({ data, selected }: CompactIconNodeProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [hovered, setHovered] = useState(false);
  // UX-1.3: the action pane shows on hover as well as selection.
  const toolbarHover = useNodeToolbarHover();

  const iconSrc = getTechnologyLogo(data.technology);
  const techColors = getTechnologyColors(data.technology);
  const techName = getTechnologyDisplayName(data.technology);
  const colors = techColors ? { primary: techColors.primary } : { primary: (data.color as string) || c.primary };
  const artifactCount = data.artifactCount || 0;
  const hasArtifacts = artifactCount > 0;
  const HIGHLIGHT_COLOR = '#22c55e';

  const inputPorts = data.ports.filter(p => p.direction === 'in');
  const outputPorts = data.ports.filter(p => p.direction === 'out');

  const tooltipLabel = techName ? `${data.label} (${techName})` : data.label;

  // N8.5″(c): a node whose type resolves to NO catalog role used to render a
  // prettified raw string indistinguishable from a healthy node (the silent
  // leaf-treatment class). Only claim "unknown" once the catalog has actually
  // settled — before that, null just means "not loaded yet".
  const loadState = CatalogService.getLoadState().state;
  const catalogSettled = loadState === 'ready' || loadState === 'degraded';
  const unknownRole = catalogSettled && !CatalogService.getRoleForNodeType(data.nodeType);

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => { setHovered(true); toolbarHover.nodeHoverProps.onMouseEnter(); }}
      onMouseLeave={() => { setHovered(false); toolbarHover.nodeHoverProps.onMouseLeave(); }}
    >
      <NodeActionToolbar visible={!!selected || toolbarHover.hoverVisible} data={data} bridgeProps={toolbarHover.bridgeProps} />
      <div
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '12px',
          backgroundColor: c.surface,
          border: `2px solid ${colors.primary}`,
          boxShadow: selected
            ? `0 0 0 3px ${c.primary}40, 0 4px 12px rgba(0, 0, 0, 0.15)`
            : data.highlighted
              ? `0 0 0 3px ${HIGHLIGHT_COLOR}30, 0 4px 12px rgba(0, 0, 0, 0.12)`
              : '0 3px 10px rgba(0, 0, 0, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'all 0.2s ease',
          cursor: 'pointer',
        }}
        title={tooltipLabel}
      >
        <FallbackHandles showTarget={inputPorts.length === 0} showSource={outputPorts.length === 0} />
        {inputPorts.map((port) => (
          <Handle
            key={port.id}
            type="target"
            position={Position.Left}
            id={port.id}
            style={{
              width: '8px',
              height: '8px',
              backgroundColor: c.surface,
              border: `2px solid ${colors.primary}`,
              top: '50%',
              left: '-4px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
            title={port.name}
          />
        ))}

        {outputPorts.map((port) => (
          <Handle
            key={port.id}
            type="source"
            position={Position.Right}
            id={port.id}
            style={{
              width: '8px',
              height: '8px',
              backgroundColor: c.surface,
              border: `2px solid ${colors.primary}`,
              top: '50%',
              right: '-4px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
            title={port.name}
          />
        ))}

        {iconSrc ? (
          <img
            src={iconSrc}
            alt={data.technology || data.nodeType}
            style={{
              width: '28px',
              height: '28px',
              objectFit: 'contain',
            }}
          />
        ) : data.icon && (data.icon.startsWith('http') || data.icon.startsWith('/')) ? (
          <img src={data.icon} alt={data.nodeType} style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
        ) : (
          // Owner 2026-07-29: unmatched node types fall back to the CATEGORICAL
          // icon (NodeIcon's N4.8 chain), never a generic invented glyph.
          <NodeIcon nodeType={data.nodeType} technology={data.technology} emojiIcon={data.icon} size={20} />
        )}

        {hasArtifacts && (
          <div style={{
            position: 'absolute',
            bottom: '-4px',
            right: '-4px',
            fontSize: '8px',
            fontWeight: 700,
            padding: '1px 4px',
            borderRadius: '6px',
            backgroundColor: theme.mode === 'dark' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(59, 130, 246, 0.15)',
            color: theme.mode === 'dark' ? '#93c5fd' : '#2563eb',
            border: `1px solid ${theme.mode === 'dark' ? 'rgba(59, 130, 246, 0.4)' : 'rgba(59, 130, 246, 0.25)'}`,
            zIndex: 10,
          }}>
            {artifactCount}
          </div>
        )}
      </div>

      {hovered && (
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: '6px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            pointerEvents: 'auto',
          }}
        >
          <div style={{
            backgroundColor: theme.mode === 'dark' ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.97)',
            border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
            borderRadius: '10px',
            padding: '8px 12px',
            boxShadow: theme.mode === 'dark'
              ? '0 8px 24px rgba(0, 0, 0, 0.5)'
              : '0 8px 24px rgba(0, 0, 0, 0.12)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
            minWidth: '100px',
          }}>
            <div style={{
              fontSize: '11px',
              fontWeight: 600,
              color: c.text,
              textAlign: 'center',
              lineHeight: '1.3',
            }}>
              {data.label}
            </div>

            <div style={{
              fontSize: '9px',
              color: unknownRole ? '#d97706' : colors.primary,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.4px',
            }}
            title={unknownRole ? `Type "${data.nodeType}" is not in the catalog — this node renders generically and its packet carries no role guidance. Rebind it via the AI patch lane or recreate it from the palette.` : undefined}
            >
              {data.nodeTypeLabel || techName || data.nodeType.split('.').pop()?.replace(/-/g, ' ')}
              {unknownRole ? ' · ⚠ unknown role' : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const CompactIconNode = memo(CompactIconNodeComponent);

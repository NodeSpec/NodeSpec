import { memo, useState } from 'react';
import { FallbackHandles } from './FallbackHandles.js';
import { NodeActionToolbar, useNodeToolbarHover } from './NodeActionToolbar.js';
import { Handle, Position, useNodeId } from '@xyflow/react';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { ContainerBadge } from './ContainerBadge.js';
import { getTechnologyLogo, getTechnologyColors, getTechnologyDisplayName } from '../../utils/technology-logo-map.js';
import { useLibraryExports, type ExportGroup } from '../../hooks/useLibraryExports.js';

interface LibraryNodeProps {
  data: RFNodeData;
  selected?: boolean;
}

const ENTITY_ICONS: Record<string, string> = {
  class: 'C',
  interface: 'I',
  function: 'f',
  module: 'M',
  struct: 'S',
  trait: 'T',
  method: 'm',
};

const MAX_VISIBLE_ENTITIES = 3;

function ExportGroupRow({ group, accentColor, textColor, mutedColor }: {
  group: ExportGroup;
  accentColor: string;
  textColor: string;
  mutedColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleEntities = expanded ? group.entities : group.entities.slice(0, MAX_VISIBLE_ENTITIES);
  const hasMore = group.entities.length > MAX_VISIBLE_ENTITIES;

  return (
    <div style={{ marginBottom: '4px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          cursor: hasMore ? 'pointer' : 'default',
          padding: '2px 0',
        }}
        onClick={(e) => {
          if (hasMore) {
            e.stopPropagation();
            setExpanded(!expanded);
          }
        }}
      >
        {hasMore && (
          expanded
            ? <ChevronDown size={9} color={mutedColor} />
            : <ChevronRight size={9} color={mutedColor} />
        )}
        <span style={{ fontSize: '9px', fontWeight: 600, color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
          {group.label}
        </span>
        <span style={{ fontSize: '9px', color: accentColor, fontWeight: 700, marginLeft: 'auto' }}>
          {group.entities.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', paddingLeft: hasMore ? '13px' : '0' }}>
        {visibleEntities.map((entity, i) => (
          <div key={entity.id || i} style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '10px', color: textColor, lineHeight: '16px',
          }}>
            <span style={{
              width: '14px', height: '14px', borderRadius: '3px',
              backgroundColor: `${accentColor}15`, color: accentColor,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '8px', fontWeight: 700, flexShrink: 0,
              border: `1px solid ${accentColor}30`,
            }}>
              {ENTITY_ICONS[entity.type] || '?'}
            </span>
            <span style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: '120px',
            }}>
              {entity.name}
            </span>
          </div>
        ))}
        {!expanded && hasMore && (
          <div style={{ fontSize: '9px', color: mutedColor, fontStyle: 'italic', paddingLeft: '18px' }}>
            +{group.entities.length - MAX_VISIBLE_ENTITIES} more
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryNodeComponent({ data, selected }: LibraryNodeProps) {
  // UX-1.3: the action pane shows on hover as well as selection.
  const toolbarHover = useNodeToolbarHover();
  const { theme } = useTheme();
  const c = theme.colors;
  const nodeId = useNodeId();
  const libraryExports = useLibraryExports(nodeId);

  const techColors = getTechnologyColors(data.technology);
  const accentColor = techColors?.primary || '#0ea5e9';
  const techLogo = getTechnologyLogo(data.technology);
  const techName = getTechnologyDisplayName(data.technology) || data.technology;

  const version = (data.metadata?.version as string) || '';
  const libraryName = (data.metadata?.libraryName as string) || '';
  const HIGHLIGHT_COLOR = '#22c55e';

  const hasExports = libraryExports.groups.length > 0 && !libraryExports.loading;
  const exportCount = hasExports ? libraryExports.totalExported : (
    data.metadata?.exportedModules
      ? (data.metadata.exportedModules as string[]).length
      : data.ports.filter(p => p.direction === 'out').length
  );

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

  const inputPorts = data.ports.filter(p => p.direction === 'in');
  const outputPorts = data.ports.filter(p => p.direction === 'out');

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

      <FallbackHandles showTarget={inputPorts.length === 0} showSource={outputPorts.length === 0} />
      {inputPorts.map((port) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{
            width: '12px',
            height: '12px',
            backgroundColor: c.surface,
            border: `3px solid ${accentColor}`,
            top: '50%',
            left: '-6px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
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
            width: '12px',
            height: '12px',
            backgroundColor: c.surface,
            border: `3px solid ${accentColor}`,
            top: '50%',
            right: '-6px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          }}
          title={port.name}
        />
      ))}

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

      {hasExports && (
        <div style={{
          padding: '6px 12px 8px',
          borderTop: `1px solid ${c.border}`,
          maxHeight: '140px',
          overflowY: 'auto',
        }}>
          <div style={{
            fontSize: '9px', fontWeight: 700, color: accentColor,
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px',
          }}>
            Export Surface
          </div>
          {libraryExports.groups.map(group => (
            <ExportGroupRow
              key={group.type}
              group={group}
              accentColor={accentColor}
              textColor={c.text}
              mutedColor={c.textMuted}
            />
          ))}
        </div>
      )}

      <div style={{
        display: 'flex',
        justifyContent: 'space-around',
        padding: '0 16px 10px',
        borderTop: `1px solid ${c.border}`,
        marginTop: '2px',
        paddingTop: '8px',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: accentColor }}>
            {String(exportCount)}
          </div>
          <div style={{ fontSize: '9px', color: c.textMuted, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            Exports
          </div>
        </div>
        <div style={{ width: '1px', backgroundColor: c.border }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: c.text }}>
            {String(data.metadata?.peerDependencies
              ? (data.metadata.peerDependencies as string[]).length
              : data.ports.filter(p => p.direction === 'in').length)}
          </div>
          <div style={{ fontSize: '9px', color: c.textMuted, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            Deps
          </div>
        </div>
      </div>
    </div>
  );
}

export const LibraryNode = memo(LibraryNodeComponent);

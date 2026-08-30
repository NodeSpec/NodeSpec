import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';

interface NodeGroupProps {
  data: RFNodeData;
  selected?: boolean;
}

function NodeGroupComponent({ data }: NodeGroupProps) {
  const { theme } = useTheme();
  const isDarkMode = theme.mode === 'dark';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'none',
      }}
    >
      {/* Boundary port (Section G 7c): bundled edges land on the GROUP, one per
          source, instead of fanning N×M into the cards inside. A group without a
          handle silently drops any edge targeting it (the SB-3 invisible-edge
          class), so the port must exist even though it is visually subtle. */}
      <Handle
        type="target"
        position={Position.Left}
        id="in-0"
        style={{
          width: '8px',
          height: '8px',
          top: '24px',
          backgroundColor: isDarkMode ? 'rgba(148, 163, 184, 0.6)' : 'rgba(99, 102, 241, 0.45)',
          border: 'none',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          padding: '12px 16px',
          fontSize: '13px',
          fontWeight: 700,
          color: isDarkMode ? '#ffffff' : '#1e293b',
          borderBottom: `2px solid ${isDarkMode ? 'rgba(148, 163, 184, 0.3)' : 'rgba(99, 102, 241, 0.2)'}`,
          backgroundColor: isDarkMode ? 'rgba(148, 163, 184, 0.15)' : 'rgba(99, 102, 241, 0.05)',
          borderRadius: '8px 8px 0 0',
          userSelect: 'none',
          backdropFilter: 'blur(8px)',
          pointerEvents: 'all',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{data.label}</span>
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          padding: '4px 8px',
          borderRadius: '6px',
          backgroundColor: isDarkMode ? 'rgba(148, 163, 184, 0.25)' : 'rgba(99, 102, 241, 0.15)',
          color: isDarkMode ? '#ffffff' : 'inherit',
        }}>
          {data.nodeTypeLabel}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          position: 'relative',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

export const NodeGroup = memo(NodeGroupComponent);

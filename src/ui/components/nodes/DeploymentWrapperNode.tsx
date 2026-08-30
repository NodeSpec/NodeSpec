import { memo } from 'react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';

interface DeploymentWrapperNodeProps {
  data: RFNodeData;
}

// Owner refinement 2026-08-22 (Decomposition canvas): deployment is no longer
// its own column — it reads as a LIGHT wrapper drawn around the architecture
// nodes it hosts, carrying the deployment method's iconography. Pure chrome:
// no handles (nothing connects to it), no pointer events (clicks fall through
// to the wrapped nodes), just a dashed boundary + a slim icon header.
function DeploymentWrapperNodeComponent({ data }: DeploymentWrapperNodeProps) {
  const { theme } = useTheme();
  const isDarkMode = theme.mode === 'dark';
  const layer = (data.metadata?.layer as string) ?? '';
  const layerLabel = layer ? layer.charAt(0).toUpperCase() + layer.slice(1) : '';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'none',
        border: `1.5px dashed ${isDarkMode ? 'rgba(168, 85, 247, 0.45)' : 'rgba(168, 85, 247, 0.35)'}`,
        borderRadius: '10px',
        backgroundColor: isDarkMode ? 'rgba(168, 85, 247, 0.05)' : 'rgba(168, 85, 247, 0.03)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 10px',
          fontSize: '11px',
          fontWeight: 600,
          color: isDarkMode ? 'rgba(216, 180, 254, 0.95)' : 'rgba(126, 34, 206, 0.9)',
          userSelect: 'none',
        }}
        title={data.nodeTypeLabel ? `${data.label} — ${data.nodeTypeLabel}` : data.label}
      >
        <span style={{ fontSize: '13px', lineHeight: 1 }}>{(data.metadata?.icon as string) ?? '📦'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</span>
        {layerLabel && (
          <span style={{
            marginLeft: 'auto',
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            padding: '2px 6px',
            borderRadius: '5px',
            backgroundColor: isDarkMode ? 'rgba(168, 85, 247, 0.18)' : 'rgba(168, 85, 247, 0.10)',
            flexShrink: 0,
          }}>
            {layerLabel}
          </span>
        )}
      </div>
      <div style={{ flex: 1, pointerEvents: 'none' }} />
    </div>
  );
}

export const DeploymentWrapperNode = memo(DeploymentWrapperNodeComponent);

import { memo } from 'react';
import { LeafHandles } from './LeafHandles.js';
import { NodeActionToolbar, useNodeToolbarHover } from './NodeActionToolbar.js';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { LucideIcon, NodeIcon, isLucideIconName } from '../common/index.js';
import { ContainerBadge } from './ContainerBadge.js';
import { getTechnologyLogo, getTechnologyColors, getTechnologyDisplayName } from '../../utils/technology-logo-map.js';

interface BaseNodeProps {
  data: RFNodeData;
  selected?: boolean;
  accentColor?: string;
  highlighted?: boolean;
}

function BaseNodeComponent({ data, selected, accentColor, highlighted }: BaseNodeProps) {
  // UX-1.3: the action pane shows on hover as well as selection.
  const toolbarHover = useNodeToolbarHover();
  const { theme } = useTheme();
  const c = theme.colors;

  const techLogo = getTechnologyLogo(data.technology);
  const techColors = getTechnologyColors(data.technology);
  const techDisplayName = getTechnologyDisplayName(data.technology);
  const effectiveAccent = techColors?.primary ?? accentColor;

  const baseNodeStyles: React.CSSProperties = {
    padding: '12px 16px',
    borderRadius: '8px',
    border: `2px solid ${c.border}`,
    backgroundColor: c.surface,
    color: c.text,
    minWidth: '160px',
    fontSize: '13px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    position: 'relative',
  };

  const errorNodeStyles: React.CSSProperties = {
    ...baseNodeStyles,
    borderColor: c.error,
    backgroundColor: c.errorBg,
  };

  const handleStyles: React.CSSProperties = {
    width: '10px',
    height: '10px',
    backgroundColor: effectiveAccent ?? c.primary,
    border: `2px solid ${effectiveAccent ?? c.primary}`,
  };

  const HIGHLIGHT_COLOR = '#22c55e';

  const styles: React.CSSProperties = {
    ...(data.hasError ? errorNodeStyles : baseNodeStyles),
    borderColor: selected
      ? c.primary
      : highlighted
        ? HIGHLIGHT_COLOR
        : data.hasError
          ? c.error
          : effectiveAccent ?? c.border,
    borderStyle: 'solid',
    borderWidth: highlighted ? '3px' : '2px',
    boxShadow: selected ? `0 0 0 2px ${c.primary}40` : highlighted ? `0 0 0 2px ${HIGHLIGHT_COLOR}30` : undefined,
  };

  const frameworkContainerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px',
    minHeight: '40px',
  };

  return (
    <div style={styles} {...toolbarHover.nodeHoverProps}>
      <NodeActionToolbar visible={!!selected || toolbarHover.hoverVisible} data={data} bridgeProps={toolbarHover.bridgeProps} />

      <LeafHandles style={handleStyles} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexDirection: 'column', width: '100%' }}>
        <div style={frameworkContainerStyles}>
          {!techLogo && isLucideIconName(data.icon) ? (
            <LucideIcon name={data.icon} size={28} color={effectiveAccent ?? c.textMuted} />
          ) : !techLogo && data.icon && (data.icon.startsWith('http') || data.icon.startsWith('/')) ? (
            <img src={data.icon} alt={data.nodeType} style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
          ) : (
            // The technology's logo, and when it has none (a custom technology, or
            // no icon in storage) or it fails to load, the role icon and then the
            // palette category icon: the chain the compact node uses (N4.8).
            <NodeIcon nodeType={data.nodeType} technology={data.technology} emojiIcon={data.icon} size={28} />
          )}
        </div>
        <span style={{ fontWeight: 500, fontSize: '12px', textAlign: 'center', width: '100%', lineHeight: '1.3' }}>{data.label}</span>
        {techDisplayName && (
          <span style={{
            fontSize: '10px',
            color: effectiveAccent ?? c.textMuted,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            padding: '2px 8px',
            backgroundColor: `${effectiveAccent ?? c.textMuted}15`,
            borderRadius: '4px',
          }}>
            {techDisplayName}
          </span>
        )}
        {data.containerParentLabel && (
          <ContainerBadge label={data.containerParentLabel} placementKind={data.containerPlacementKind} />
        )}
      </div>

      {data.hasError && data.errorMessage && (
        <div
          style={{
            marginTop: '6px',
            fontSize: '11px',
            color: theme.mode === 'dark' ? '#fca5a5' : c.error,
          }}
        >
          {data.errorMessage}
        </div>
      )}
    </div>
  );
}

export const BaseNode = memo(BaseNodeComponent);

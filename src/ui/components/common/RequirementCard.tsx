import { memo, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { Requirement } from '../../../persistence/supabase/requirements-repository.js';
import { Lock, Unlock } from 'lucide-react';

interface RequirementCardProps {
  requirement: Requirement;
  mappedNodeCount: number;
  onClick?: () => void;
  isHighlighted?: boolean;
}

function RequirementCardComponent({
  requirement,
  mappedNodeCount,
  onClick,
  isHighlighted = false,
}: RequirementCardProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [isHovered, setIsHovered] = useState(false);

  const getLockIcon = () => {
    if (requirement.locked) {
      return <Lock size={16} style={{ color: '#d97706' }} />;
    }
    return <Unlock size={16} style={{ color: c.textMuted }} />;
  };

  const getCategoryLabel = (): string => {
    const labels: Record<string, string> = {
      functional: 'FR',
      'non-functional': 'NFR',
      technical: 'TR',
      business: 'BR',
    };
    return labels[requirement.category] || requirement.category.substring(0, 2).toUpperCase();
  };

  const cardStyles: React.CSSProperties = {
    backgroundColor: isHighlighted
      ? (theme.mode === 'dark' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.1)')
      : (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.95)'),
    border: isHighlighted
      ? `2px solid ${c.primary}`
      : `1px solid ${c.border}`,
    borderRadius: '12px',
    padding: '12px',
    width: '100%',
    cursor: onClick ? 'pointer' : 'default',
    transition: 'all 0.2s ease',
    boxShadow: isHovered
      ? (theme.mode === 'dark' ? '0 8px 24px rgba(0, 0, 0, 0.6)' : '0 8px 24px rgba(0, 0, 0, 0.15)')
      : (theme.mode === 'dark' ? '0 4px 12px rgba(0, 0, 0, 0.4)' : '0 4px 12px rgba(0, 0, 0, 0.1)'),
    transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
    backdropFilter: 'blur(8px)',
    boxSizing: 'border-box',
  };

  const headerStyles: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  };

  const requirementIdStyles: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    color: c.primary,
    fontFamily: 'monospace',
    padding: '4px 8px',
    borderRadius: '6px',
    backgroundColor: `${c.primary}20`,
  };

  const titleStyles: React.CSSProperties = {
    fontSize: '15px',
    fontWeight: 600,
    color: c.text,
    marginBottom: '8px',
    lineHeight: '1.4',
  };

  const descriptionStyles: React.CSSProperties = {
    fontSize: '13px',
    color: c.textSecondary,
    lineHeight: '1.5',
    marginBottom: '12px',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };

  const metaRowStyles: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '12px',
  };

  const badgeStyles: React.CSSProperties = {
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
    padding: '4px 8px',
    borderRadius: '6px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  };

  const footerStyles: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '12px',
    borderTop: `1px solid ${c.border}`,
  };

  const nodeCountStyles: React.CSSProperties = {
    fontSize: '12px',
    color: mappedNodeCount > 0 ? '#10b981' : '#ef4444',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  };

  return (
    <div
      style={cardStyles}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={headerStyles}>
        <span style={requirementIdStyles}>{requirement.requirementId}</span>
        {getLockIcon()}
      </div>

      <div style={titleStyles}>{requirement.name}</div>

      <div style={descriptionStyles}>{requirement.description}</div>

      <div style={metaRowStyles}>
        <span
          style={{
            ...badgeStyles,
            color: c.textSecondary,
            backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
          }}
        >
          {getCategoryLabel()}
        </span>
      </div>

      <div style={footerStyles}>
        <span style={nodeCountStyles}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
          {mappedNodeCount} {mappedNodeCount === 1 ? 'node' : 'nodes'}
        </span>
        <span style={{
          fontSize: '11px',
          color: requirement.locked ? '#d97706' : c.textMuted,
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}>
          {requirement.locked ? <Lock size={12} /> : <Unlock size={12} />}
          {requirement.locked ? 'Locked' : 'Unlocked'}
        </span>
      </div>
    </div>
  );
}

export const RequirementCard = memo(RequirementCardComponent);

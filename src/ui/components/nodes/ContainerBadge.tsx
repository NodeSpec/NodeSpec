import { memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';

interface ContainerBadgeProps {
  label: string;
  placementKind?: string;
}

const PLACEMENT_PREFIX: Record<string, string> = {
  hosts: 'Hosted in',
  deployed_to: 'Deployed to',
  scopes: 'Scoped by',
  contains: 'In',
};

function ContainerBadgeComponent({ label, placementKind }: ContainerBadgeProps) {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const prefix = PLACEMENT_PREFIX[placementKind || 'contains'] || 'In';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '9px',
        fontWeight: 500,
        color: isDark ? 'rgba(148,163,184,0.8)' : 'rgba(100,116,139,0.85)',
        backgroundColor: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(100,116,139,0.07)',
        border: `1px solid ${isDark ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.12)'}`,
        borderRadius: '4px',
        padding: '2px 6px',
        maxWidth: '180px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
        lineHeight: 1.4,
      }}
      title={`${prefix}: ${label}`}
    >
      <svg
        width="8"
        height="8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, opacity: 0.7 }}
      >
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <line x1="3" y1="9" x2="21" y2="9" />
      </svg>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  );
}

export const ContainerBadge = memo(ContainerBadgeComponent);

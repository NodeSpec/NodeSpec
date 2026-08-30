// N3.7: drop-time role disambiguation in USAGE terms. When a dragged technology maps to
// several roles, the user answers "what will it do here?" — phrased from each role's
// curated when_to_use (usagePhraseForRole), never in role-taxonomy vocabulary. The role
// remains the system's filing, resolved by this one plain question.
import { memo, useEffect, useRef } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';

export interface UsageOption {
  roleId: string;
  phrase: string;
}

interface UsagePickerProps {
  position: { x: number; y: number };
  technologyName: string;
  options: UsageOption[];
  onSelect: (roleId: string) => void;
  onCancel: () => void;
}

function UsagePickerComponent({ position, technologyName, options, onSelect, onCancel }: UsagePickerProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) onCancel();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onCancel]);

  const adjustedX = Math.min(position.x, window.innerWidth - 340);
  const adjustedY = Math.min(position.y, window.innerHeight - (90 + options.length * 56));

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        zIndex: 10000,
        backgroundColor: theme.mode === 'dark' ? 'rgba(30, 41, 59, 0.98)' : 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${c.border}`,
        borderRadius: '12px',
        boxShadow: theme.mode === 'dark'
          ? '0 12px 48px rgba(0, 0, 0, 0.5)'
          : '0 12px 48px rgba(0, 0, 0, 0.15)',
        width: '320px',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${c.border}` }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>
          What will {technologyName} do here?
        </div>
      </div>
      <div style={{ padding: '6px' }}>
        {options.map(opt => (
          <button
            key={opt.roleId}
            onClick={() => onSelect(opt.roleId)}
            style={{
              width: '100%', display: 'block', textAlign: 'left', padding: '10px 12px',
              borderRadius: '8px', border: 'none', backgroundColor: 'transparent',
              color: c.text, cursor: 'pointer', fontSize: '12px', lineHeight: 1.4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            {opt.phrase}
          </button>
        ))}
      </div>
    </div>
  );
}

export const UsagePicker = memo(UsagePickerComponent);

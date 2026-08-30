import { memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { BYOKKeyInput } from './BYOKKeyInput.js';

interface BYOKRequiredModalProps {
  onClose: () => void;
  onKeyConfigured?: () => void;
}

function BYOKRequiredModalComponent({ onClose, onKeyConfigured }: BYOKRequiredModalProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const handleKeyConfigured = () => {
    onKeyConfigured?.();
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: '16px',
          padding: '32px',
          maxWidth: '480px',
          width: '90%',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.3)',
        }}
      >
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{
            margin: 0,
            fontSize: '18px',
            fontWeight: 700,
            color: c.text,
            lineHeight: 1.3,
          }}>
            Platform Trial Tokens Exhausted
          </h2>
          <p style={{
            margin: '10px 0 0',
            fontSize: '13px',
            color: c.textMuted,
            lineHeight: 1.6,
          }}>
            Your 600K platform trial tokens have been used. To continue using AI features,
            connect your own API key from any supported provider below.
          </p>
        </div>

        <BYOKKeyInput onKeyConfigured={handleKeyConfigured} />

        <div style={{
          marginTop: '20px',
          paddingTop: '16px',
          borderTop: `1px solid ${c.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: `1px solid ${c.border}`,
              backgroundColor: 'transparent',
              color: c.textMuted,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
          <span style={{ fontSize: '11px', color: c.textMuted }}>
            Or purchase token add-ons in Account Settings
          </span>
        </div>
      </div>
    </div>
  );
}

export const BYOKRequiredModal = memo(BYOKRequiredModalComponent);

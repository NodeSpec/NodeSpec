import { useTheme } from '../../theme/ThemeContext';

interface AIThinkingIndicatorProps {
  action: 'explaining' | 'improving' | 'generating' | 'validating';
  artifactPath?: string;
}

export function AIThinkingIndicator({ action, artifactPath }: AIThinkingIndicatorProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const actionText = {
    explaining: 'Analyzing code',
    improving: 'Improving code',
    generating: 'Generating code',
    validating: 'Validating implementation',
  }[action];

  const overlayStyles: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  };

  const cardStyles: React.CSSProperties = {
    backgroundColor: c.surface,
    borderRadius: '12px',
    padding: '32px',
    boxShadow:
      theme.mode === 'dark'
        ? '0 20px 60px rgba(0, 0, 0, 0.6)'
        : '0 20px 60px rgba(0, 0, 0, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    maxWidth: '400px',
  };

  const spinnerStyles: React.CSSProperties = {
    width: '48px',
    height: '48px',
    border: `4px solid ${c.border}`,
    borderTop: `4px solid ${c.primary}`,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  };

  return (
    <>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <div style={overlayStyles}>
        <div style={cardStyles}>
          <div style={spinnerStyles} />
          <div
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: c.text,
              textAlign: 'center',
            }}
          >
            {actionText}...
          </div>
          {artifactPath && (
            <div
              style={{
                fontSize: '13px',
                color: c.textMuted,
                textAlign: 'center',
                fontFamily: 'monospace',
                animation: 'pulse 2s ease-in-out infinite',
              }}
            >
              {artifactPath}
            </div>
          )}
          <div
            style={{
              fontSize: '12px',
              color: c.textSecondary,
              textAlign: 'center',
              lineHeight: '1.5',
            }}
          >
            This may take a moment...
          </div>
        </div>
      </div>
    </>
  );
}

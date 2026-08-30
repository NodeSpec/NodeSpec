import { memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';

interface AddSectionButtonNodeProps {
  data: {
    onClick: () => void;
    isCreating: boolean;
    newSectionName: string;
    onNameChange: (name: string) => void;
    onConfirm: () => void;
    onCancel: () => void;
  };
}

function AddSectionButtonNodeComponent({ data }: AddSectionButtonNodeProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  if (data.isCreating) {
    return (
      <div style={{
        padding: '12px',
        border: `1px solid ${theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)'}`,
        borderRadius: '8px',
        backgroundColor: theme.mode === 'dark' ? 'rgba(30, 30, 30, 0.98)' : 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxShadow: theme.mode === 'dark' ? '0 4px 12px rgba(0, 0, 0, 0.5)' : '0 4px 12px rgba(0, 0, 0, 0.1)',
      }}>
        <input
          type="text"
          value={data.newSectionName}
          onChange={(e) => data.onNameChange(e.target.value)}
          placeholder="Section name..."
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') data.onConfirm();
            if (e.key === 'Escape') data.onCancel();
          }}
          style={{
            padding: '8px 12px',
            border: `1px solid ${theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)'}`,
            borderRadius: '6px',
            backgroundColor: c.background,
            color: c.text,
            fontSize: '13px',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={(e) => {
              console.log('[AddSectionButtonNode] Create button clicked', {
                newSectionName: data.newSectionName,
                trimmed: data.newSectionName.trim(),
                onConfirmType: typeof data.onConfirm,
                onConfirm: data.onConfirm,
              });
              e.preventDefault();
              e.stopPropagation();
              if (data.onConfirm) {
                data.onConfirm();
              }
            }}
            disabled={!data.newSectionName.trim()}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: 'none',
              borderRadius: '6px',
              backgroundColor: c.primary,
              color: '#ffffff',
              cursor: data.newSectionName.trim() ? 'pointer' : 'not-allowed',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              opacity: data.newSectionName.trim() ? 1 : 0.5,
            }}
          >
            <span>✓</span>
            Create
          </button>
          <button
            onClick={data.onCancel}
            style={{
              padding: '8px 12px',
              border: `1px solid ${theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)'}`,
              borderRadius: '6px',
              backgroundColor: 'transparent',
              color: c.textMuted,
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      style={{
        width: '100%',
        padding: '12px 16px',
        border: `1px dashed ${theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)'}`,
        borderRadius: '8px',
        backgroundColor: theme.mode === 'dark' ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        color: c.primary,
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        transition: 'all 0.2s ease',
        backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => {
        console.log('[AddSectionButtonNode] New Section button clicked', {
          onClickType: typeof data.onClick,
        });
        e.preventDefault();
        e.stopPropagation();
        if (data.onClick) {
          data.onClick();
        }
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)';
        e.currentTarget.style.borderColor = c.primary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)';
        e.currentTarget.style.borderColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)';
      }}
    >
      <span style={{ fontSize: '16px' }}>+</span>
      <span>New Section</span>
    </button>
  );
}

export const AddSectionButtonNode = memo(AddSectionButtonNodeComponent);

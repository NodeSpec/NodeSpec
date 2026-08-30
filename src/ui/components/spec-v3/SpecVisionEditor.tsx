import { useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { Eye, ChevronDown, ChevronRight } from 'lucide-react';
import { InlineEditableText } from './InlineEditableText.js';

interface SpecVisionEditorProps {
  vision: string;
  onSaveVision: (vision: string) => Promise<void>;
}

export function SpecVisionEditor({ vision, onSaveVision }: SpecVisionEditorProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{
      borderBottom: `1px solid ${c.border}`,
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          color: c.text,
          fontSize: '12px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          transition: 'background-color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Eye size={14} style={{ color: c.primary }} />
        <span>Vision</span>
      </button>

      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>
          <InlineEditableText
            value={vision}
            onSave={onSaveVision}
            placeholder="Describe the project vision..."
            multiline
            fontSize={13}
            maxRows={6}
          />
        </div>
      )}
    </div>
  );
}

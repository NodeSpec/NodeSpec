import { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { Check, X, Pencil } from 'lucide-react';

interface InlineEditableTextProps {
  value: string;
  onSave: (value: string) => Promise<void>;
  placeholder?: string;
  multiline?: boolean;
  fontSize?: number;
  fontWeight?: number;
  maxRows?: number;
  disabled?: boolean;
}

export function InlineEditableText({
  value,
  onSave,
  placeholder = 'Click to edit...',
  multiline = false,
  fontSize = 13,
  fontWeight = 400,
  maxRows = 4,
  disabled = false,
}: InlineEditableTextProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraft(value);
    }
  }, [value, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      const el = inputRef.current;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
      }
    }
  }, [isEditing]);

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1500);
    } catch {
      setDraft(value);
    } finally {
      setSaving(false);
      setIsEditing(false);
    }
  }, [draft, value, onSave]);

  const handleCancel = useCallback(() => {
    setDraft(value);
    setIsEditing(false);
  }, [value]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    }
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Enter' && e.metaKey && multiline) {
      e.preventDefault();
      handleSave();
    }
  }, [handleCancel, handleSave, multiline]);

  if (disabled) {
    return (
      <span style={{ fontSize, fontWeight, color: c.text, lineHeight: 1.5 }}>
        {value || <span style={{ color: c.textMuted, fontStyle: 'italic' }}>{placeholder}</span>}
      </span>
    );
  }

  if (isEditing) {
    const inputStyles: React.CSSProperties = {
      width: '100%',
      padding: '6px 8px',
      fontSize,
      fontWeight,
      fontFamily: 'inherit',
      color: c.text,
      backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : '#fff',
      border: `1.5px solid ${c.primary}`,
      borderRadius: '6px',
      outline: 'none',
      resize: multiline ? 'vertical' : 'none',
      lineHeight: 1.5,
      boxSizing: 'border-box' as const,
    };

    return (
      <div style={{ position: 'relative' }}>
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            rows={maxRows}
            style={inputStyles}
            placeholder={placeholder}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            style={inputStyles}
            placeholder={placeholder}
          />
        )}
        <div style={{
          display: 'flex',
          gap: '4px',
          position: 'absolute',
          right: '4px',
          bottom: multiline ? '8px' : '50%',
          transform: multiline ? 'none' : 'translateY(50%)',
        }}>
          <button
            onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
            style={{
              padding: '2px',
              border: 'none',
              borderRadius: '4px',
              backgroundColor: saving ? c.textMuted : c.success,
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Check size={12} />
          </button>
          <button
            onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
            style={{
              padding: '2px',
              border: 'none',
              borderRadius: '4px',
              backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              color: c.textMuted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      style={{
        cursor: 'pointer',
        position: 'relative',
        padding: '4px 6px',
        margin: '-4px -6px',
        borderRadius: '6px',
        transition: 'background-color 0.15s ease',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        minHeight: fontSize + 8,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <span style={{
        fontSize,
        fontWeight,
        color: value ? c.text : c.textMuted,
        fontStyle: value ? 'normal' : 'italic',
        lineHeight: 1.5,
        flex: 1,
        wordBreak: 'break-word',
      }}>
        {value || placeholder}
      </span>
      <Pencil size={12} style={{ color: c.textMuted, opacity: 0.4, flexShrink: 0, marginTop: 4 }} />
      {showSaved && (
        <span style={{
          position: 'absolute',
          right: 0,
          top: -18,
          fontSize: 10,
          color: c.success,
          fontWeight: 600,
          animation: 'fadeOut 1.5s ease forwards',
        }}>
          Saved
        </span>
      )}
    </div>
  );
}

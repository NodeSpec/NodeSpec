import { useState } from 'react';
import { useTheme } from '../../theme/ThemeContext';
import type { PatchOperation } from '@nodespec/core/types';

interface CodeDiffPreviewProps {
  artifactPath: string;
  originalContent: string;
  proposedContent: string;
  action: 'explain' | 'improve' | 'generate';
  explanation?: string;
  patches: PatchOperation[]; // eslint-disable-line @typescript-eslint/no-unused-vars
  onAccept: () => void;
  onReject: () => void;
}

export function CodeDiffPreview({
  artifactPath,
  originalContent,
  proposedContent,
  action,
  explanation,
  patches: _patches,
  onAccept,
  onReject,
}: CodeDiffPreviewProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');

  const overlayStyles: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px',
  };

  const modalStyles: React.CSSProperties = {
    backgroundColor: c.surface,
    borderRadius: '12px',
    boxShadow:
      theme.mode === 'dark'
        ? '0 20px 60px rgba(0, 0, 0, 0.6)'
        : '0 20px 60px rgba(0, 0, 0, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    width: '90vw',
    maxWidth: '1200px',
    height: '80vh',
    maxHeight: '800px',
  };

  const headerStyles: React.CSSProperties = {
    padding: '20px 24px',
    borderBottom: `1px solid ${c.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const buttonStyles: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  };

  const actionLabels = {
    explain: 'Code Explanation',
    improve: 'Proposed Improvements',
    generate: 'Generated Code',
  };

  const originalLines = originalContent.split('\n');
  const proposedLines = proposedContent.split('\n');

  return (
    <div style={overlayStyles} onClick={(e) => e.stopPropagation()}>
      <div style={modalStyles}>
        <div style={headerStyles}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: c.text, marginBottom: '4px' }}>
              {actionLabels[action]}
            </div>
            <div style={{ fontSize: '13px', color: c.textMuted, fontFamily: 'monospace' }}>
              {artifactPath}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={{
                ...buttonStyles,
                backgroundColor: c.backgroundSecondary,
                color: c.text,
                border: `1px solid ${c.border}`,
              }}
              onClick={() => setViewMode(viewMode === 'split' ? 'unified' : 'split')}
            >
              {viewMode === 'split' ? 'Unified View' : 'Split View'}
            </button>
          </div>
        </div>

        {explanation && action === 'explain' && (
          <div
            style={{
              padding: '20px 24px',
              backgroundColor: c.backgroundSecondary,
              borderBottom: `1px solid ${c.border}`,
            }}
          >
            <div style={{ fontSize: '14px', color: c.text, lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
              {explanation}
            </div>
          </div>
        )}

        {(action === 'improve' || action === 'generate') && (
          <>
            {explanation && (
              <div
                style={{
                  padding: '16px 24px',
                  backgroundColor: c.backgroundSecondary,
                  borderBottom: `1px solid ${c.border}`,
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 600, color: c.textMuted, marginBottom: '8px' }}>
                  What Changed:
                </div>
                <div style={{ fontSize: '13px', color: c.text, lineHeight: '1.6' }}>{explanation}</div>
              </div>
            )}

            <div style={{ flex: 1, overflow: 'auto', padding: '16px 0' }}>
              {viewMode === 'split' ? (
                <div style={{ display: 'flex', height: '100%' }}>
                  <div style={{ flex: 1, borderRight: `1px solid ${c.border}`, padding: '0 16px' }}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: c.error,
                        marginBottom: '12px',
                        textTransform: 'uppercase',
                      }}
                    >
                      Original
                    </div>
                    <pre
                      style={{
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        color: c.text,
                        lineHeight: '1.6',
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {originalContent}
                    </pre>
                  </div>
                  <div style={{ flex: 1, padding: '0 16px' }}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: c.success,
                        marginBottom: '12px',
                        textTransform: 'uppercase',
                      }}
                    >
                      Proposed
                    </div>
                    <pre
                      style={{
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        color: c.text,
                        lineHeight: '1.6',
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {proposedContent}
                    </pre>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '0 24px' }}>
                  <DiffView
                    originalLines={originalLines}
                    proposedLines={proposedLines}
                    colors={c}
                  />
                </div>
              )}
            </div>

            <div
              style={{
                padding: '16px 24px',
                borderTop: `1px solid ${c.border}`,
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
                backgroundColor: c.backgroundSecondary,
              }}
            >
              <button
                style={{
                  ...buttonStyles,
                  backgroundColor: 'transparent',
                  color: c.text,
                  border: `1px solid ${c.border}`,
                }}
                onClick={onReject}
              >
                Reject
              </button>
              <button
                style={{
                  ...buttonStyles,
                  backgroundColor: c.success,
                  color: 'white',
                }}
                onClick={onAccept}
              >
                Accept Changes
              </button>
            </div>
          </>
        )}

        {action === 'explain' && (
          <div
            style={{
              padding: '16px 24px',
              borderTop: `1px solid ${c.border}`,
              display: 'flex',
              justifyContent: 'flex-end',
              backgroundColor: c.backgroundSecondary,
            }}
          >
            <button
              style={{
                ...buttonStyles,
                backgroundColor: c.primary,
                color: 'white',
              }}
              onClick={onReject}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DiffView({
  originalLines,
  proposedLines,
  colors,
}: {
  originalLines: string[];
  proposedLines: string[];
  colors: any;
}) {
  const maxLines = Math.max(originalLines.length, proposedLines.length);
  const lines: Array<{ type: 'same' | 'removed' | 'added'; original?: string; proposed?: string }> = [];

  for (let i = 0; i < maxLines; i++) {
    const original = originalLines[i];
    const proposed = proposedLines[i];

    if (original === proposed) {
      lines.push({ type: 'same', original, proposed });
    } else if (original && !proposed) {
      lines.push({ type: 'removed', original });
    } else if (!original && proposed) {
      lines.push({ type: 'added', proposed });
    } else {
      lines.push({ type: 'removed', original });
      lines.push({ type: 'added', proposed });
    }
  }

  return (
    <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>
      {lines.map((line, idx) => {
        const bgColor =
          line.type === 'removed'
            ? colors.errorBg
            : line.type === 'added'
            ? colors.successBg
            : 'transparent';

        const textColor =
          line.type === 'removed'
            ? colors.error
            : line.type === 'added'
            ? colors.success
            : colors.text;

        const prefix = line.type === 'removed' ? '- ' : line.type === 'added' ? '+ ' : '  ';
        const content = line.original || line.proposed || '';

        return (
          <div
            key={idx}
            style={{
              backgroundColor: bgColor,
              color: textColor,
              padding: '2px 8px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <span style={{ color: colors.textMuted, marginRight: '8px', userSelect: 'none' }}>
              {prefix}
            </span>
            {content}
          </div>
        );
      })}
    </div>
  );
}

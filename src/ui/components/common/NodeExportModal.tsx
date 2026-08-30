import { useState, memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { NodeExportContext } from '../../utils/export-context.js';
import { formatNodeExportAsPrompt, downloadAsFile, copyToClipboard } from '../../utils/export-context.js';

interface NodeExportModalProps {
  context: NodeExportContext;
  projectName?: string;
  onClose: () => void;
  /** UX-1.3: the anchor-slice download lived only in the deprecated
   *  right-click menu — this modal is a node's ONE export surface now. */
  onDownloadAnchorSlice?: () => void;
}

function NodeExportModalComponent({ context, projectName, onClose, onDownloadAnchorSlice }: NodeExportModalProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [includeCode, setIncludeCode] = useState(false);
  const [includeTests, setIncludeTests] = useState(true);
  const [selectedArtifacts, setSelectedArtifacts] = useState<Set<string>>(
    new Set(context.artifacts.map(a => a.path))
  );
  const [copied, setCopied] = useState(false);
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown');

  const toggleArtifact = (path: string) => {
    setSelectedArtifacts(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedArtifacts.size === context.artifacts.length) {
      setSelectedArtifacts(new Set());
    } else {
      setSelectedArtifacts(new Set(context.artifacts.map(a => a.path)));
    }
  };

  const buildExportContent = (): string => {
    const filtered: NodeExportContext = {
      ...context,
      artifacts: context.artifacts
        .filter(a => selectedArtifacts.has(a.path))
        .map(a => ({
          ...a,
          content: includeCode ? a.content : undefined,
        })),
      testCases: includeTests ? context.testCases : undefined,
    };

    if (format === 'json') {
      return JSON.stringify(filtered, null, 2);
    }
    return formatNodeExportAsPrompt(filtered, projectName);
  };

  const handleCopy = async () => {
    const content = buildExportContent();
    const success = await copyToClipboard(content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const content = buildExportContent();
    const ext = format === 'json' ? 'json' : 'md';
    const mime = format === 'json' ? 'application/json' : 'text/markdown';
    const safeName = context.node.label.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    downloadAsFile(content, `${safeName}-context.${ext}`, mime);
  };

  const overlayStyles: React.CSSProperties = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 10000,
  };

  const modalStyles: React.CSSProperties = {
    width: '540px', maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
    backgroundColor: c.surface, borderRadius: '12px', border: `1px solid ${c.border}`,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  };

  const headerStyles: React.CSSProperties = {
    padding: '16px 20px', borderBottom: `1px solid ${c.border}`,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  };

  const bodyStyles: React.CSSProperties = {
    padding: '16px 20px', overflowY: 'auto', flex: 1,
  };

  const footerStyles: React.CSSProperties = {
    padding: '12px 20px', borderTop: `1px solid ${c.border}`,
    display: 'flex', gap: '8px', justifyContent: 'flex-end',
  };

  const btnBase: React.CSSProperties = {
    padding: '8px 16px', fontSize: '13px', fontWeight: 500, borderRadius: '8px',
    cursor: 'pointer', transition: 'all 0.15s',
  };

  const sectionLabel: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.5px', color: c.textMuted, marginBottom: '8px',
  };

  return (
    <div style={overlayStyles} onClick={onClose}>
      <div style={modalStyles} onClick={e => e.stopPropagation()}>
        <div style={headerStyles}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: c.text }}>
              Export: {context.node.label}
            </div>
            <div style={{ fontSize: '12px', color: c.textMuted, marginTop: '2px' }}>
              {context.node.type}{context.node.technology ? ` / ${context.node.technology}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: '18px',
            color: c.textMuted, cursor: 'pointer', padding: '4px',
          }}>&times;</button>
        </div>

        <div style={bodyStyles}>
          <div style={{ marginBottom: '16px' }}>
            <div style={sectionLabel}>Format</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['markdown', 'json'] as const).map(f => (
                <button key={f} onClick={() => setFormat(f)} style={{
                  ...btnBase, padding: '6px 14px', fontSize: '12px',
                  fontWeight: format === f ? 600 : 400,
                  backgroundColor: format === f ? c.primary : c.background,
                  color: format === f ? '#fff' : c.textSecondary,
                  border: `1px solid ${format === f ? c.primary : c.border}`,
                }}>
                  {f === 'markdown' ? 'Markdown (Prompt)' : 'JSON (Structured)'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={sectionLabel}>Summary</div>
            <div style={{ fontSize: '12px', color: c.textSecondary, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span>{context.connections.incoming.length} incoming + {context.connections.outgoing.length} outgoing connections</span>
              {context.requirements && context.requirements.length > 0 && (
                <span>{context.requirements.length} related requirement{context.requirements.length !== 1 ? 's' : ''}</span>
              )}
              <span>{context.artifacts.length} artifact{context.artifacts.length !== 1 ? 's' : ''}</span>
              {context.testCases && context.testCases.length > 0 && (
                <span>{context.testCases.length} test case{context.testCases.length !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>

          {context.artifacts.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ ...sectionLabel, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Artifacts</span>
                <button onClick={toggleAll} style={{
                  background: 'none', border: 'none', fontSize: '11px',
                  color: c.primary, cursor: 'pointer', fontWeight: 500,
                  textTransform: 'none', letterSpacing: '0',
                }}>
                  {selectedArtifacts.size === context.artifacts.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div style={{
                border: `1px solid ${c.border}`, borderRadius: '8px',
                maxHeight: '160px', overflowY: 'auto',
              }}>
                {context.artifacts.map(art => (
                  <label key={art.path} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 12px', fontSize: '12px', color: c.text,
                    borderBottom: `1px solid ${c.border}`, cursor: 'pointer',
                  }}>
                    <input
                      type="checkbox"
                      checked={selectedArtifacts.has(art.path)}
                      onChange={() => toggleArtifact(art.path)}
                      style={{ accentColor: c.primary }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{art.path}</span>
                    <span style={{ fontSize: '10px', color: c.textMuted, marginLeft: 'auto' }}>{art.kind}</span>
                  </label>
                ))}
              </div>

              {selectedArtifacts.size > 0 && (
                <label style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  marginTop: '10px', fontSize: '12px', color: c.text, cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={includeCode}
                    onChange={() => setIncludeCode(!includeCode)}
                    style={{ accentColor: c.primary }}
                  />
                  Include full source code in export
                </label>
              )}
            </div>
          )}

          {context.testCases && context.testCases.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                fontSize: '12px', color: c.text, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={includeTests}
                  onChange={() => setIncludeTests(!includeTests)}
                  style={{ accentColor: c.primary }}
                />
                Include {context.testCases.length} test case{context.testCases.length !== 1 ? 's' : ''} in export
              </label>
            </div>
          )}
        </div>

        <div style={footerStyles}>
          <button onClick={onClose} style={{
            ...btnBase, color: c.text, backgroundColor: c.background,
            border: `1px solid ${c.border}`,
          }}>
            Cancel
          </button>
          <button onClick={handleDownload} style={{
            ...btnBase, color: c.text, backgroundColor: c.background,
            border: `1px solid ${c.border}`,
          }}>
            Download .{format === 'json' ? 'json' : 'md'}
          </button>
          {onDownloadAnchorSlice && (
            <button
              onClick={onDownloadAnchorSlice}
              title="Download this node's model-anchor slice — the .nodespec-shaped JSON an implementing AI consumes"
              style={{
                ...btnBase, color: c.text, backgroundColor: c.background,
                border: `1px solid ${c.border}`,
              }}
            >
              Anchor slice (.json)
            </button>
          )}
          <button onClick={handleCopy} style={{
            ...btnBase, color: '#fff', backgroundColor: copied ? '#16a34a' : c.primary,
            border: 'none', fontWeight: 600,
          }}>
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const NodeExportModal = memo(NodeExportModalComponent);

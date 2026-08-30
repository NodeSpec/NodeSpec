import { memo } from 'react';
import type { PatchLogEntry } from '../../store/branch-store.js';

const panelStyles: React.CSSProperties = {
  width: '280px',
  backgroundColor: '#1e293b',
  borderLeft: '1px solid #334155',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyles: React.CSSProperties = {
  padding: '16px',
  borderBottom: '1px solid #334155',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const titleStyles: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#f1f5f9',
};

const countStyles: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
};

const listStyles: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '8px',
};

const entryStyles: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: '6px',
  marginBottom: '6px',
  fontSize: '12px',
};

const appliedEntryStyles: React.CSSProperties = {
  ...entryStyles,
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
};

const rejectedEntryStyles: React.CSSProperties = {
  ...entryStyles,
  backgroundColor: '#450a0a',
  border: '1px solid #dc2626',
};

const entryHeaderStyles: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '4px',
};

const statusBadgeBase: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: '4px',
  textTransform: 'uppercase',
};

const appliedBadgeStyles: React.CSSProperties = {
  ...statusBadgeBase,
  backgroundColor: '#166534',
  color: '#86efac',
};

const rejectedBadgeStyles: React.CSSProperties = {
  ...statusBadgeBase,
  backgroundColor: '#991b1b',
  color: '#fca5a5',
};

const patchTypeStyles: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 500,
  color: '#3b82f6',
};

const summaryStyles: React.CSSProperties = {
  color: '#cbd5e1',
  lineHeight: '1.4',
  wordBreak: 'break-word',
};

const metaStyles: React.CSSProperties = {
  marginTop: '6px',
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
};

const metaItemStyles: React.CSSProperties = {
  fontSize: '10px',
  color: '#64748b',
};

const errorStyles: React.CSSProperties = {
  marginTop: '6px',
  padding: '6px 8px',
  backgroundColor: '#7f1d1d',
  borderRadius: '4px',
  color: '#fca5a5',
  fontSize: '11px',
};

const emptyStyles: React.CSSProperties = {
  padding: '24px 16px',
  textAlign: 'center',
  color: '#64748b',
  fontSize: '13px',
};

interface PatchLogPanelProps {
  entries: PatchLogEntry[];
  lastError: { patchId?: string; message: string } | null;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatPatchType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function PatchLogPanelComponent({ entries, lastError }: PatchLogPanelProps) {
  const appliedCount = entries.filter((e) => e.status === 'applied').length;
  const rejectedCount = entries.filter((e) => e.status === 'rejected').length;

  return (
    <div style={panelStyles}>
      <div style={headerStyles}>
        <span style={titleStyles}>Patch Log</span>
        <span style={countStyles}>
          {appliedCount} applied{rejectedCount > 0 ? `, ${rejectedCount} rejected` : ''}
        </span>
      </div>

      {lastError && (
        <div style={{ ...errorStyles, margin: '8px', marginBottom: 0 }}>
          <strong>Last Error:</strong> {lastError.message}
        </div>
      )}

      <div style={listStyles}>
        {entries.length === 0 ? (
          <div style={emptyStyles}>
            No patches yet. Drag nodes or connect them to see patches.
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.patch.metadata.id}
              style={entry.status === 'applied' ? appliedEntryStyles : rejectedEntryStyles}
            >
              <div style={entryHeaderStyles}>
                <span style={patchTypeStyles}>
                  {formatPatchType(entry.patch.type)}
                </span>
                <span style={entry.status === 'applied' ? appliedBadgeStyles : rejectedBadgeStyles}>
                  {entry.status}
                </span>
              </div>
              <div style={summaryStyles}>{entry.patch.metadata.summary}</div>
              <div style={metaStyles}>
                <span style={metaItemStyles}>
                  {entry.patch.metadata.actorType}
                </span>
                <span style={metaItemStyles}>
                  {formatTime(entry.appliedAt)}
                </span>
                <span style={metaItemStyles}>
                  {entry.patch.metadata.id.slice(0, 8)}
                </span>
              </div>
              {entry.error && (
                <div style={errorStyles}>{entry.error.message}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export const PatchLogPanel = memo(PatchLogPanelComponent);

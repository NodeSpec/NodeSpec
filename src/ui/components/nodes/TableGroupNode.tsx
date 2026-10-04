// AA.3b (owner 2026-09-23, mockup approved): a group of an exploded database,
// drawn as a card inside the database's box. It lists what the group holds:
// tables with their column counts (SQL), collections with their key fields
// (document), key patterns with their kind (key-value). A row whose file is
// bound opens it on the node that holds it (item 25: the group, the database,
// or a service); any other row names where it is defined in its title.
import { memo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { SpecGraphRFNode } from '../../adapters/graph-to-reactflow.js';
import { entryMeta, groupMetaText, nounsFor, ROWS_SHOWN, type GroupEntry } from '../../adapters/data-shape.js';
import { FallbackHandles } from './FallbackHandles.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function TableGroupNodeComponent({ id, data, selected }: NodeProps<SpecGraphRFNode>) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [showAll, setShowAll] = useState(false);
  const model = data.group?.model ?? null;
  const entries = data.group?.entries ?? [];
  const shown = showAll ? entries : entries.slice(0, ROWS_SHOWN);
  const hidden = entries.length - shown.length;
  const twoLine = model === 'document';
  const onOpenFile = data.onOpenFile as ((artifactId: string, nodeId: string) => void) | undefined;

  const rowStyle = (clickable: boolean): React.CSSProperties => ({
    display: 'flex',
    flexDirection: twoLine ? 'column' : 'row',
    justifyContent: 'space-between',
    alignItems: twoLine ? 'flex-start' : 'center',
    gap: twoLine ? 2 : 8,
    minHeight: 32,
    padding: twoLine ? '6px 8px' : '0 8px',
    borderRadius: 7,
    border: 'none',
    background: 'transparent',
    color: c.text,
    cursor: clickable ? 'pointer' : 'default',
    fontSize: 12.5,
    textAlign: 'left',
    width: '100%',
    boxSizing: 'border-box',
  });

  const rowBody = (entry: GroupEntry) => {
    const meta = entryMeta(model, entry);
    return (
      <>
        <span style={{ fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{entry.name}</span>
        {meta && <span style={{ color: c.textMuted, fontSize: twoLine ? 11.5 : 12.5, fontFamily: twoLine ? MONO : undefined, whiteSpace: 'nowrap' }}>{meta}</span>}
      </>
    );
  };

  return (
    <div
      data-testid="table-group"
      style={{
        width: 340,
        boxSizing: 'border-box',
        borderRadius: 12,
        background: c.surface,
        border: `1px solid ${selected ? c.primary : c.border}`,
        padding: '12px 12px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        color: c.text,
      }}
    >
      <FallbackHandles showTarget showSource />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 4px 10px' }}>
        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO }}>{data.label}</span>
        <span style={{ fontSize: 12, color: c.textMuted }}>{groupMetaText(model, entries.length)}</span>
      </div>
      {shown.map((entry) => {
        const opens = !!entry.artifactId && !!onOpenFile;
        const title = entry.file ?? entry.note;
        return opens ? (
          <button
            key={entry.name}
            type="button"
            className="nodrag"
            title={`Opens ${entry.file}`}
            style={rowStyle(true)}
            onMouseEnter={(e) => { e.currentTarget.style.background = c.surfaceHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={(e) => { e.stopPropagation(); onOpenFile!(entry.artifactId!, entry.artifactNodeId ?? id); }}
          >
            {rowBody(entry)}
          </button>
        ) : (
          <div key={entry.name} title={title} style={rowStyle(false)}>{rowBody(entry)}</div>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          className="nodrag"
          style={{ ...rowStyle(true), flexDirection: 'row', alignItems: 'center', padding: '0 8px' }}
          onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
        >
          <span>{hidden} more {hidden === 1 ? nounsFor(model).item : nounsFor(model).items}</span>
          <span style={{ color: c.textMuted }}>show</span>
        </button>
      )}
      {showAll && entries.length > ROWS_SHOWN && (
        <button
          type="button"
          className="nodrag"
          style={{ ...rowStyle(true), flexDirection: 'row', alignItems: 'center', padding: '0 8px', color: c.textMuted }}
          onClick={(e) => { e.stopPropagation(); setShowAll(false); }}
        >
          Show fewer
        </button>
      )}
      {entries.length === 0 && (
        <div style={{ fontSize: 12, color: c.textMuted, padding: '4px 8px' }}>
          No {nounsFor(model).items} listed yet
        </div>
      )}
    </div>
  );
}

export const TableGroupNode = memo(TableGroupNodeComponent);

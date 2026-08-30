import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { CircleCheck as CheckCircle2, CircleX, Circle, TriangleAlert } from 'lucide-react';

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  not_started: { color: '#6b7280', label: 'Not Started' },
  passed: { color: '#10b981', label: 'Passed' },
  failed: { color: '#ef4444', label: 'Failed' },
  skipped: { color: '#f59e0b', label: 'Skipped' },
  running: { color: '#3b82f6', label: 'Running' },
};

interface TestNodeProps {
  data: RFNodeData;
  selected?: boolean;
  highlighted?: boolean;
}

const ACCENT = '#06b6d4';
const HIGHLIGHT_COLOR = '#22c55e';

function TestNodeComponent({ data, selected, highlighted }: TestNodeProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const metadata = data.metadata || {};
  const testId = metadata.testId as string || 'TEST-???';
  const testType = metadata.testType as string || 'acceptance';
  const framework = metadata.framework as string | undefined;
  const status = metadata.status as string || 'not_started';
  const artifactPath = metadata.artifactPath as string | undefined;
  const stale = metadata.stale as boolean | undefined;

  const statusConf = STATUS_CONFIG[status] || STATUS_CONFIG.not_started;

  const StatusIcon = status === 'passed' ? CheckCircle2
    : status === 'failed' ? CircleX
    : Circle;

  const STALE_COLOR = '#f59e0b';
  const borderAccent = stale ? STALE_COLOR : selected ? c.primary : highlighted ? HIGHLIGHT_COLOR : ACCENT;

  const containerStyles: React.CSSProperties = {
    padding: '0',
    borderRadius: '8px',
    border: `1.5px solid ${borderAccent}`,
    backgroundColor: c.surface,
    width: '100%',
    height: '100%',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    position: 'relative',
    boxShadow: stale
      ? `0 2px 8px ${STALE_COLOR}25, 0 0 0 1.5px ${STALE_COLOR}18`
      : selected
      ? `0 2px 8px ${c.primary}25, 0 0 0 1.5px ${c.primary}18`
      : highlighted
      ? `0 2px 8px ${HIGHLIGHT_COLOR}25, 0 0 0 1.5px ${HIGHLIGHT_COLOR}18`
      : theme.mode === 'dark'
        ? '0 1px 4px rgba(0, 0, 0, 0.25)'
        : '0 1px 4px rgba(0, 0, 0, 0.08)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  const inputPorts = data.ports?.filter(p => p.direction === 'in') || [];

  const handleStyles: React.CSSProperties = {
    width: '8px',
    height: '8px',
    backgroundColor: ACCENT,
    border: `2px solid ${ACCENT}`,
  };

  // Section G 7c: a canvas card shows STATE, never identifiers-as-prose. ONE dense
  // row — status dot, test id, name. Framework, type, and artifact path are inspector
  // content; they survive here only in the hover tooltip.
  const tooltip = [data.label, testType, framework, artifactPath, stale ? 'STALE — re-run and report' : null]
    .filter(Boolean).join(' · ');

  return (
    <div style={containerStyles} title={tooltip}>
      {inputPorts.map((_, index) => (
        <Handle
          key={`in-${index}`}
          type="target"
          position={Position.Left}
          id={`in-${index}`}
          style={{
            ...handleStyles,
            top: `${((index + 1) * 100) / (inputPorts.length + 1)}%`,
          }}
        />
      ))}

      <div style={{
        padding: '0 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        flex: 1,
        minWidth: 0,
      }}>
        <StatusIcon size={13} style={{ color: statusConf.color, flexShrink: 0 }} />
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          color: stale ? STALE_COLOR : ACCENT,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          letterSpacing: '0.3px',
          flexShrink: 0,
        }}>
          {testId}
        </span>
        <span style={{
          fontSize: '11px',
          fontWeight: 500,
          color: c.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}>
          {data.label}
        </span>
        {stale && <TriangleAlert size={12} style={{ color: STALE_COLOR, flexShrink: 0 }} />}
      </div>
    </div>
  );
}

export const TestNode = memo(TestNodeComponent);

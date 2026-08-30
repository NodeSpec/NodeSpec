import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { Lock, LockOpen as Unlock, ShieldCheck, TestTube as TestTube2 } from 'lucide-react';

interface RequirementNodeProps {
  data: RFNodeData;
  selected?: boolean;
  highlighted?: boolean;
}

function RequirementNodeComponent({ data, selected, highlighted }: RequirementNodeProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const metadata = data.metadata || {};
  const requirementId = metadata.requirementId as string || 'REQ-???';
  const isLocked = metadata.locked as boolean || false;
  const category = metadata.category as string || 'functional';
  const description = metadata.description as string || '';
  const sectionName = metadata.sectionName as string || '';
  const onClick = metadata.onClick as (() => void) | undefined;

  const rawCriteria = metadata.acceptanceCriteria as Array<{ text: string; met?: boolean }> | undefined;
  const criteriaCount = rawCriteria?.length ?? 0;
  const criteriaMet = rawCriteria?.filter(ac => ac.met).length ?? 0;
  const allCriteriaMet = criteriaCount > 0 && criteriaMet === criteriaCount;

  const testSummary = metadata.testSummary as { total: number; passed: number; failed: number } | undefined;
  const lineage = metadata.lineage as Array<{ requirementId: string }> | null | undefined;
  const archived = metadata.archived as boolean | undefined;
  const onLineageClick = metadata.onLineageClick as (() => void) | undefined;

  const getCategoryColor = () => {
    switch (category) {
      case 'functional':
        return '#3b82f6';
      case 'non-functional':
        return '#8b5cf6';
      case 'technical':
        return '#10b981';
      case 'business':
        return '#f59e0b';
      default:
        return c.primary;
    }
  };

  const getLockIcon = () => {
    if (isLocked) {
      return <Lock size={14} style={{ color: '#d97706' }} />;
    }
    return <Unlock size={14} style={{ color: c.textMuted }} />;
  };

  const categoryColor = getCategoryColor();
  const HIGHLIGHT_COLOR = '#22c55e';

  const containerStyles: React.CSSProperties = {
    padding: '0',
    borderRadius: '10px',
    border: `2px solid ${selected ? c.primary : highlighted ? HIGHLIGHT_COLOR : c.border}`,
    backgroundColor: c.surface,
    minWidth: '220px',
    maxWidth: '280px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    position: 'relative',
    boxShadow: selected
      ? `0 4px 12px ${c.primary}30, 0 0 0 2px ${c.primary}20`
      : highlighted
      ? `0 4px 12px ${HIGHLIGHT_COLOR}30, 0 0 0 2px ${HIGHLIGHT_COLOR}20`
      : '0 2px 8px rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
    cursor: onClick ? 'pointer' : 'default',
  };

  const headerStyles: React.CSSProperties = {
    padding: '10px 12px',
    backgroundColor: `${categoryColor}15`,
    borderBottom: `2px solid ${categoryColor}`,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const reqIdStyles: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    color: theme.mode === 'dark' ? categoryColor : categoryColor,
    fontFamily: 'monospace',
    letterSpacing: '0.5px',
  };

  const categoryBadgeStyles: React.CSSProperties = {
    marginLeft: 'auto',
    fontSize: '9px',
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: '4px',
    backgroundColor: `${categoryColor}20`,
    color: categoryColor,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  const bodyStyles: React.CSSProperties = {
    padding: '12px',
  };

  const titleStyles: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: c.text,
    marginBottom: '8px',
    lineHeight: '1.4',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };

  const descriptionStyles: React.CSSProperties = {
    fontSize: '11px',
    color: c.textMuted,
    lineHeight: '1.5',
    marginBottom: '10px',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };

  const footerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    paddingTop: '8px',
    borderTop: `1px solid ${c.border}`,
  };

  const statusBadgeStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '10px',
    color: c.textMuted,
  };

  const sectionBadgeStyles: React.CSSProperties = {
    fontSize: '9px',
    padding: '3px 8px',
    borderRadius: '4px',
    backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
    color: c.textSecondary,
    maxWidth: '100px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const handleStyles: React.CSSProperties = {
    width: '8px',
    height: '8px',
    backgroundColor: categoryColor,
    border: `2px solid ${categoryColor}`,
  };

  const inputPorts = data.ports?.filter(p => p.direction === 'in') || [];
  const outputPorts = data.ports?.filter(p => p.direction === 'out') || [];

  return (
    <div style={containerStyles} onClick={onClick}>
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

      <div style={headerStyles}>
        <span style={reqIdStyles}>{requirementId}</span>
        <span style={categoryBadgeStyles}>{category}</span>
      </div>

      <div style={bodyStyles}>
        <div style={titleStyles} title={data.label}>
          {data.label}
        </div>

        {description && (
          <div style={descriptionStyles} title={description}>
            {description}
          </div>
        )}

        {criteriaCount > 0 && (
          <div style={{
            padding: '8px 10px',
            marginBottom: '8px',
            borderRadius: '6px',
            backgroundColor: allCriteriaMet
              ? (theme.mode === 'dark' ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.06)')
              : (theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
            border: `1px solid ${allCriteriaMet ? '#22c55e30' : (theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)')}`,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '6px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ShieldCheck size={11} style={{ color: allCriteriaMet ? '#22c55e' : c.textMuted }} />
                <span style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: allCriteriaMet ? '#22c55e' : c.textSecondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                }}>
                  Criteria
                </span>
              </div>
              <span style={{
                fontSize: '10px',
                fontWeight: 700,
                color: allCriteriaMet ? '#22c55e' : criteriaMet > 0 ? '#3b82f6' : c.textMuted,
                padding: '1px 6px',
                borderRadius: '8px',
                backgroundColor: allCriteriaMet ? '#22c55e18' : criteriaMet > 0 ? '#3b82f618' : 'transparent',
              }}>
                {criteriaMet}/{criteriaCount}
              </span>
            </div>
            <div style={{
              height: '4px',
              borderRadius: '2px',
              backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${(criteriaMet / criteriaCount) * 100}%`,
                backgroundColor: allCriteriaMet ? '#22c55e' : '#3b82f6',
                borderRadius: '2px',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}

        {testSummary && testSummary.total > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            marginBottom: '8px',
            borderRadius: '6px',
            backgroundColor: testSummary.failed > 0
              ? (theme.mode === 'dark' ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)')
              : testSummary.passed === testSummary.total
              ? (theme.mode === 'dark' ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.04)')
              : (theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
            border: `1px solid ${
              testSummary.failed > 0 ? '#ef444420'
              : testSummary.passed === testSummary.total ? '#10b98120'
              : (theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)')
            }`,
          }}>
            <TestTube2 size={11} style={{
              color: testSummary.failed > 0 ? '#ef4444'
                : testSummary.passed === testSummary.total ? '#10b981'
                : c.textMuted,
            }} />
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              color: testSummary.failed > 0 ? '#ef4444'
                : testSummary.passed === testSummary.total ? '#10b981'
                : c.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
            }}>
              Tests
            </span>
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              marginLeft: 'auto',
              color: testSummary.failed > 0 ? '#ef4444'
                : testSummary.passed === testSummary.total ? '#10b981'
                : c.textMuted,
              padding: '1px 6px',
              borderRadius: '8px',
              backgroundColor: testSummary.failed > 0 ? '#ef444418'
                : testSummary.passed === testSummary.total ? '#10b98118'
                : 'transparent',
            }}>
              {testSummary.passed}/{testSummary.total}
            </span>
          </div>
        )}

        <div style={footerStyles}>
          {/* Section G 7b: supersession is a chip, never an edge. Click opens the
              version chain; archived predecessors stay out of the graph. */}
          {lineage && lineage.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onLineageClick?.(); }}
              title={`Supersedes ${lineage.map(l => l.requirementId).join(', ')} — click to view the version chain`}
              style={{
                display: 'flex', alignItems: 'center', gap: '3px',
                border: 'none', cursor: 'pointer',
                fontSize: '9px', fontWeight: 700,
                padding: '2px 7px', borderRadius: '8px',
                color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.10)',
              }}
            >
              ⟲ supersedes {lineage.length}
            </button>
          )}
          {archived && (
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.4px',
              padding: '2px 7px', borderRadius: '8px',
              color: c.textMuted, backgroundColor: 'rgba(128,128,128,0.15)',
            }}>
              ARCHIVED
            </span>
          )}
          {sectionName && <span style={sectionBadgeStyles} title={sectionName}>{sectionName}</span>}
          <div style={{ ...statusBadgeStyles, marginLeft: 'auto', color: isLocked ? '#d97706' : c.textMuted }}>
            {getLockIcon()}
            <span>{isLocked ? 'Locked' : 'Unlocked'}</span>
          </div>
        </div>
      </div>

      {outputPorts.map((_, index) => (
        <Handle
          key={`out-${index}`}
          type="source"
          position={Position.Right}
          id={`out-${index}`}
          style={{
            ...handleStyles,
            top: `${((index + 1) * 100) / (outputPorts.length + 1)}%`,
          }}
        />
      ))}
    </div>
  );
}

export const RequirementNode = memo(RequirementNodeComponent);

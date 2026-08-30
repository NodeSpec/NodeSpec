import { memo, useState } from 'react';
import { ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import type { ProposalPatch, PatchStatus } from '@nodespec/core/ai-proposal.js';
import type { PatchOperation, Graph } from '@nodespec/core/types.js';

const statusColors: Record<PatchStatus, { bg: string; text: string; border: string }> = {
  pending: { bg: '#1e293b', text: '#94a3b8', border: '#334155' },
  approved: { bg: 'rgba(34, 197, 94, 0.08)', text: '#22c55e', border: 'rgba(34, 197, 94, 0.3)' },
  rejected: { bg: 'rgba(239, 68, 68, 0.08)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
  conflicted: { bg: 'rgba(245, 158, 11, 0.08)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
  merged: { bg: 'rgba(59, 130, 246, 0.08)', text: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' },
};

function getActionVerb(type: string): string {
  if (type.startsWith('add_') || type.startsWith('create_') || type.startsWith('instantiate_') || type.startsWith('attach_') || type.startsWith('connect_')) return 'Add';
  if (type.startsWith('update_') || type.startsWith('mark_')) return 'Update';
  if (type.startsWith('remove_') || type.startsWith('delete_')) return 'Remove';
  return 'Change';
}

function getActionColor(type: string): string {
  const verb = getActionVerb(type);
  if (verb === 'Add') return '#22c55e';
  if (verb === 'Update') return '#3b82f6';
  if (verb === 'Remove') return '#ef4444';
  return '#94a3b8';
}

// Owner-directed (2026-07-28): change rows name the ACTUAL thing being changed —
// node labels, edge endpoints, contract names, artifact paths — never a UUID prefix.
// The graph resolves ids; a truncated id remains only the last-resort fallback for
// entities that exist in neither the graph nor the payload.
export function describePatch(patch: PatchOperation, graph?: Graph): string {
  const payload = patch.payload as Record<string, unknown>;
  const type = patch.type;

  const nodeName = (id: unknown): string =>
    (graph?.nodes?.[String(id)]?.label) || String(id || '').slice(0, 8);
  const edgeName = (id: unknown): string => {
    const edge = graph?.edges?.[String(id)];
    if (edge) return `${nodeName(edge.source)} → ${nodeName(edge.target)}`;
    return String(id || '').slice(0, 8);
  };
  const contractName = (id: unknown): string =>
    (graph?.contracts?.[String(id)]?.name) || String(id || '').slice(0, 8);
  const artifactName = (id: unknown): string =>
    (graph?.artifacts?.[String(id)]?.path) || String(id || '').slice(0, 8);

  if (type === 'add_node' || type === 'create_node_from_template') {
    const label = payload.label || payload.name || 'unnamed';
    const nodeType = payload.type || '';
    return `Add "${label}" ${nodeType ? `(${String(nodeType).replace(/_/g, ' ')})` : 'node'}`;
  }

  if (type === 'update_node') {
    const changes = payload.changes as Record<string, unknown> | undefined;
    const name = nodeName(payload.id);
    if (changes?.label) return `Rename "${name}" to "${changes.label}"`;
    if (changes?.technology) return `Set technology to "${changes.technology}" on "${name}"`;
    const keys = changes ? Object.keys(changes).filter(k => k !== 'updatedAt').join(', ') : '';
    return `Update "${name}"${keys ? ` (${keys})` : ''}`;
  }

  if (type === 'remove_node' || type === 'delete_node') {
    return `Remove "${nodeName(payload.id)}"`;
  }

  if (type === 'add_edge') {
    // Contract name only when it RESOLVES — a UUID prefix here would be noise.
    const contract = graph?.contracts?.[String(payload.contractId)]?.name;
    return `Connect "${nodeName(payload.source)}" to "${nodeName(payload.target)}"${contract ? ` (${contract})` : ''}`;
  }

  if (type === 'update_edge') {
    return `Update connection ${edgeName(payload.id)}`;
  }

  if (type === 'remove_edge' || type === 'delete_edge') {
    return payload.id && graph?.edges?.[String(payload.id)]
      ? `Remove connection ${edgeName(payload.id)}`
      : `Remove connection from "${nodeName(payload.source)}"`;
  }

  if (type === 'add_contract') {
    const name = payload.name || payload.label || '';
    const kind = payload.kind || '';
    return `Add ${kind ? String(kind) + ' ' : ''}contract${name ? ` "${name}"` : ''}`;
  }

  if (type === 'update_contract') {
    return `Update contract "${contractName(payload.id)}"`;
  }

  if (type === 'remove_contract' || type === 'delete_contract') {
    return `Remove contract "${contractName(payload.id)}"`;
  }

  if (type === 'add_artifact') {
    const path = payload.path || '';
    const kind = payload.kind || '';
    return `Add ${kind ? String(kind) + ' ' : ''}file "${path}"`;
  }

  if (type === 'update_artifact') {
    const changes = payload.changes as Record<string, unknown> | undefined;
    const hasContent = changes?.content !== undefined;
    return `Update file "${artifactName(payload.id)}"${hasContent ? ' (content changed)' : ''}`;
  }

  if (type === 'remove_artifact' || type === 'delete_artifact') {
    return `Remove file "${artifactName(payload.id)}"`;
  }

  if (type === 'add_port') {
    const label = payload.label || payload.name || '';
    return `Add port${label ? ` "${label}"` : ''}`;
  }

  if (type === 'connect_ports') {
    return 'Connect ports';
  }

  if (type === 'add_node_group' || type === 'update_node_group' || type === 'remove_node_group') {
    return `${getActionVerb(type)} node group`;
  }

  if (type === 'update_graph_metadata') {
    return 'Update project metadata';
  }

  if (type === 'instantiate_contract_stub') {
    return 'Add contract stub';
  }

  if (type === 'attach_artifact_stub') {
    return 'Attach artifact stub';
  }

  if (type === 'mark_entity_complete') {
    return `Mark ${String(payload.entityType || 'entity')} as complete`;
  }

  return patch.type.replace(/_/g, ' ');
}

interface PatchDiffViewProps {
  proposalPatch: ProposalPatch;
  index: number;
  onToggleApproval?: (patchId: string, approved: boolean) => void;
  selectable?: boolean;
  /** Resolves ids to labels/names/paths in the row summary (names, never UUIDs). */
  graph?: Graph;
}

function PatchDiffViewComponent({
  proposalPatch,
  index,
  onToggleApproval,
  selectable = true,
  graph,
}: PatchDiffViewProps) {
  const { patch, explanation, status, conflictReason, previewBefore, previewAfter } = proposalPatch;
  const [expanded, setExpanded] = useState(false);
  const colors = statusColors[status];
  const isConflicted = status === 'conflicted';
  const isApproved = status === 'approved';
  const actionColor = getActionColor(patch.type);
  const summary = describePatch(patch, graph);

  const handleApprove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleApproval && !isConflicted) {
      onToggleApproval(patch.metadata.id, true);
    }
  };

  const handleReject = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleApproval && !isConflicted) {
      onToggleApproval(patch.metadata.id, false);
    }
  };

  const hasDetails = explanation || previewBefore !== undefined || previewAfter !== undefined || conflictReason;

  return (
    <div style={{
      backgroundColor: colors.bg,
      borderRadius: '6px',
      overflow: 'hidden',
      marginBottom: '4px',
      border: `1px solid ${colors.border}`,
      transition: 'border-color 0.15s ease',
    }}>
      <div
        onClick={() => hasDetails && setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          cursor: hasDetails ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        {hasDetails && (
          expanded
            ? <ChevronDown size={12} style={{ color: '#64748b', flexShrink: 0 }} />
            : <ChevronRight size={12} style={{ color: '#64748b', flexShrink: 0 }} />
        )}
        {!hasDetails && <span style={{ width: 12, flexShrink: 0 }} />}

        <span style={{
          fontSize: '11px',
          color: '#475569',
          fontWeight: 600,
          flexShrink: 0,
          width: '20px',
          textAlign: 'right',
        }}>
          {index + 1}
        </span>

        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: actionColor,
          backgroundColor: `${actionColor}15`,
          padding: '2px 6px',
          borderRadius: '3px',
          flexShrink: 0,
        }}>
          {getActionVerb(patch.type)}
        </span>

        <span style={{
          fontSize: '13px',
          color: '#e2e8f0',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {summary}
        </span>

        {isConflicted && (
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: '3px',
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            color: '#f59e0b',
            flexShrink: 0,
          }}>
            CONFLICT
          </span>
        )}

        {selectable && !isConflicted && (
          <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
            <button
              onClick={handleApprove}
              title="Approve this change"
              style={{
                width: '26px',
                height: '26px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: isApproved ? 'rgba(34, 197, 94, 0.25)' : 'transparent',
                color: isApproved ? '#22c55e' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              <Check size={14} />
            </button>
            <button
              onClick={handleReject}
              title="Reject this change"
              style={{
                width: '26px',
                height: '26px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: status === 'rejected' ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
                color: status === 'rejected' ? '#ef4444' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {expanded && hasDetails && (
        <div style={{
          padding: '8px 12px 10px 52px',
          borderTop: '1px solid rgba(51, 65, 85, 0.5)',
          fontSize: '12px',
          lineHeight: 1.5,
        }}>
          {explanation && (
            <div style={{ color: '#94a3b8', marginBottom: conflictReason || (previewBefore !== undefined || previewAfter !== undefined) ? '8px' : 0 }}>
              {explanation}
            </div>
          )}

          {isConflicted && conflictReason && (
            <div style={{
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: '4px',
              padding: '8px',
              color: '#fbbf24',
              fontSize: '12px',
            }}>
              {conflictReason}
            </div>
          )}

          {!isConflicted && (previewBefore !== undefined || previewAfter !== undefined) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
            }}>
              <div style={{
                backgroundColor: '#0f172a',
                borderRadius: '4px',
                padding: '8px',
                overflow: 'auto',
                maxHeight: '160px',
              }}>
                <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px', color: '#ef4444' }}>Before</div>
                <pre style={{ fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: previewBefore ? '#cbd5e1' : '#475569', margin: 0 }}>
                  {previewBefore ? JSON.stringify(previewBefore, null, 2) : '(none)'}
                </pre>
              </div>
              <div style={{
                backgroundColor: '#0f172a',
                borderRadius: '4px',
                padding: '8px',
                overflow: 'auto',
                maxHeight: '160px',
              }}>
                <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px', color: '#22c55e' }}>After</div>
                <pre style={{ fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: previewAfter ? '#cbd5e1' : '#475569', margin: 0 }}>
                  {previewAfter ? JSON.stringify(previewAfter, null, 2) : '(removed)'}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const PatchDiffView = memo(PatchDiffViewComponent);

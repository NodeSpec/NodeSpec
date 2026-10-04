/*
  THE proposal review surface (owner rulings 2026-08-12): a theme-aware
  right-edge side panel in the ChangesPanel pattern. Born for repo imports;
  the same day the owner retired the old dark-only bottom dock
  (ProposalReview.tsx, deleted) and made this panel the ONLY review UI —
  variant 'proposal' serves ordinary architecture proposals.

  The tedium fix: everything arrives PRE-APPROVED and one button applies it.
  Fine-grained control survives one level down — category checkboxes exclude a
  whole group, and expanding a group exposes per-item toggles — but on a large
  change set the happy path is read the summary, glance at the groups, Apply.
*/
import { useCallback, useMemo, useState } from 'react';
import { X, Box, GitBranch, Link2, FileCode, Layers, Check, ChevronDown, ChevronRight, Loader as Loader2 } from 'lucide-react';
import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import type { AIProposal, ProposalPatch, MergeResult } from '@nodespec/core/ai-proposal.js';
import { approveAllPatches, cherryPickProposalPatches } from '@nodespec/core/ai-proposal.js';
import { describePatch } from './PatchDiffView.js';
import { buildProposalGraphOverlay, formatProposalTimestamp } from '../../utils/proposal-display.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { RejectReason } from './RejectReason.js';

type CategoryKey = 'nodes' | 'contracts' | 'edges' | 'artifacts' | 'ports' | 'other';

const CATEGORY_META: Record<CategoryKey, { label: string; icon: typeof Box }> = {
  nodes: { label: 'Components', icon: Box },
  contracts: { label: 'Contracts', icon: FileCode },
  edges: { label: 'Connections', icon: GitBranch },
  artifacts: { label: 'Files', icon: Layers },
  ports: { label: 'Ports', icon: Link2 },
  other: { label: 'Other changes', icon: Layers },
};

const CATEGORY_ORDER: CategoryKey[] = ['nodes', 'contracts', 'edges', 'artifacts', 'ports', 'other'];

function categoryOf(pp: ProposalPatch): CategoryKey {
  const type = pp.patch.type;
  if (type.includes('node') && !type.includes('group')) return 'nodes';
  if (type.includes('edge')) return 'edges';
  if (type.includes('contract')) return 'contracts';
  if (type.includes('artifact')) return 'artifacts';
  if (type.includes('port')) return 'ports';
  return 'other';
}

// UX-1.2 (owner spec 2026-08-21): rows name the ACTUAL entity. The payload
// fast path only serves add_* ops (update/remove payloads are {id, changes});
// everything else resolves through describePatch against the OVERLAY graph —
// live graph + this proposal's own additions — so "no idea what I'm approving"
// UUIDs cannot appear even for intra-proposal references.
function itemLabel(pp: ProposalPatch, lookup: Graph): string {
  const payload = pp.patch.payload as Record<string, unknown>;
  const label = (payload?.label ?? payload?.name ?? payload?.path) as string | undefined;
  if (label) return String(label);
  return describePatch(pp.patch, lookup);
}

export function ImportReviewPanel({ proposal: initialProposal, graph, variant = 'import', onMerge, onReject, onClose }: {
  proposal: AIProposal;
  graph: Graph;
  /** Accepted for call-site compatibility; acceptance validates server-side. */
  /** 'import' = repo-import framing; 'proposal' = ordinary change proposals. */
  variant?: 'import' | 'proposal';
  onMerge: (result: MergeResult, mergedOps: PatchOperation[]) => Promise<void> | void;
  /** AE.12: the person's reason, never blank; the agent reads it as reviewNote. */
  onReject: (reason: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  // Everything starts approved — the whole point of the redesign.
  const [proposal, setProposal] = useState<AIProposal>(() => approveAllPatches(initialProposal));
  const [expanded, setExpanded] = useState<CategoryKey | null>(null);
  const [applying, setApplying] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [askingReason, setAskingReason] = useState(false);

  const byCategory = useMemo(() => {
    const map = new Map<CategoryKey, ProposalPatch[]>();
    for (const key of CATEGORY_ORDER) map.set(key, []);
    for (const pp of proposal.patches) map.get(categoryOf(pp))!.push(pp);
    return map;
  }, [proposal]);

  // Name-resolution lookup: live graph + this proposal's own additions.
  const lookup = useMemo(
    () => buildProposalGraphOverlay(proposal.patches.map(pp => pp.patch), graph),
    [proposal, graph],
  );

  const approvedIds = useMemo(
    () => proposal.patches.filter(p => p.status === 'approved').map(p => p.patch.metadata.id),
    [proposal],
  );

  const setApproval = useCallback((ids: string[], approved: boolean) => {
    setProposal(current => {
      const idSet = new Set(ids);
      const keep = current.patches
        .filter(p => (idSet.has(p.patch.metadata.id) ? approved : p.status === 'approved'))
        .map(p => p.patch.metadata.id);
      return cherryPickProposalPatches(current, keep);
    });
  }, []);

  const handleApply = useCallback(async () => {
    if (applying || approvedIds.length === 0) return;
    setApplying(true);
    try {
      // No client-side merge simulation (owner bug 2026-08-12: on a large
      // import, a rebuild timeout after partial application made the retry's
      // simulation read every already-applied node as a CONFLICT, shrinking
      // the merge set and stamping the survivors rejected). acceptProposal
      // owns validation, locked-node filtering, and patch-id dedup — and is
      // idempotent, so clicking Apply again simply resumes.
      const approvedSet = new Set(approvedIds);
      const mergedOps = proposal.patches
        .filter(p => approvedSet.has(p.patch.metadata.id))
        .map(p => p.patch);
      const result: MergeResult = {
        success: true,
        mergedPatches: [...approvedIds],
        skippedPatches: [],
        conflicts: [],
        finalGraph: graph,
      };
      await onMerge(result, mergedOps);
    } finally {
      setApplying(false);
    }
  }, [applying, approvedIds, proposal, graph, onMerge]);

  const handleReject = useCallback(async (reason: string) => {
    if (rejecting) return;
    setRejecting(true);
    try {
      await onReject(reason);
      setAskingReason(false);
    } finally {
      setRejecting(false);
    }
  }, [rejecting, onReject]);

  const summaryText = typeof proposal.metadata?.summary === 'string'
    ? proposal.metadata.summary
    : variant === 'import'
      ? 'Imported from your repository. Uncheck anything you do not want, then apply.'
      : 'Proposed changes to your architecture. Uncheck anything you do not want, then apply.';

  const total = proposal.patches.length;

  return (
    <div style={{
      position: 'fixed', top: '68px', right: '12px', bottom: '12px',
      width: 'min(440px, 94vw)',
      display: 'flex', flexDirection: 'column',
      backgroundColor: c.surface,
      border: `1px solid ${c.border}`,
      borderRadius: '12px',
      boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
      zIndex: 10002,
      overflow: 'hidden',
    }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '14px 16px', borderBottom: `1px solid ${c.border}`, flexShrink: 0,
      }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '8px',
          backgroundColor: 'rgba(139,143,230,0.14)', color: '#8B8FE6',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <GitBranch size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: c.text }}>
            {variant === 'import' ? 'Repository Import' : 'Change Proposal'}
          </div>
          <div style={{ fontSize: '11.5px', color: c.textMuted }}>
            {approvedIds.length} of {total} change{total !== 1 ? 's' : ''} selected
            {proposal.createdAt ? ` · proposed ${formatProposalTimestamp(proposal.createdAt)}` : ''}
          </div>
        </div>
        <button
          onClick={onClose}
          title="Close. Reopen it from Agents, Proposals."
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.textMuted, padding: '4px', display: 'flex' }}
        >
          <X size={16} />
        </button>
      </div>

      {/* summary card */}
      <div style={{ padding: '14px 16px 6px', flexShrink: 0 }}>
        <div style={{
          padding: '12px 14px', borderRadius: '10px',
          border: '1px solid rgba(139,143,230,0.3)', backgroundColor: 'rgba(139,143,230,0.06)',
          fontSize: '12.5px', color: c.text, lineHeight: 1.55,
        }}>
          {summaryText}
        </div>
      </div>

      {/* category groups */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 12px' }}>
        {CATEGORY_ORDER.map(key => {
          const items = byCategory.get(key)!;
          if (items.length === 0) return null;
          const meta = CATEGORY_META[key];
          const Icon = meta.icon;
          const approvedInGroup = items.filter(p => p.status === 'approved').length;
          const allOn = approvedInGroup === items.length;
          const noneOn = approvedInGroup === 0;
          const isExpanded = expanded === key;
          const groupIds = items.map(p => p.patch.metadata.id);
          return (
            <div key={key} style={{
              marginBottom: '8px', borderRadius: '10px',
              border: `1px solid ${c.border}`,
              backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px' }}>
                <button
                  onClick={() => setApproval(groupIds, !allOn)}
                  title={allOn ? 'Exclude this group' : 'Include this group'}
                  style={{
                    width: '18px', height: '18px', borderRadius: '5px', flexShrink: 0,
                    border: `1.5px solid ${noneOn ? c.border : '#8B8FE6'}`,
                    backgroundColor: noneOn ? 'transparent' : allOn ? '#8B8FE6' : 'rgba(139,143,230,0.35)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', padding: 0,
                  }}
                >
                  {!noneOn && <Check size={12} strokeWidth={3} />}
                </button>
                <button
                  onClick={() => setExpanded(isExpanded ? null : key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', flex: 1,
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    color: c.text, textAlign: 'left',
                  }}
                >
                  <Icon size={14} style={{ color: c.textMuted, flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>{meta.label}</span>
                  <span style={{ fontSize: '11.5px', color: c.textMuted }}>
                    {allOn ? items.length : `${approvedInGroup}/${items.length}`}
                  </span>
                  <span style={{ marginLeft: 'auto', color: c.textMuted, display: 'flex' }}>
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </button>
              </div>
              {isExpanded && (
                <div style={{ borderTop: `1px solid ${c.border}`, maxHeight: '220px', overflowY: 'auto' }}>
                  {items.map(pp => {
                    const on = pp.status === 'approved';
                    const id = pp.patch.metadata.id;
                    return (
                      <button
                        key={id}
                        onClick={() => setApproval([id], !on)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '9px', width: '100%',
                          padding: '7px 12px 7px 40px', background: 'none', border: 'none',
                          cursor: 'pointer', textAlign: 'left',
                          opacity: on ? 1 : 0.45,
                        }}
                      >
                        <span style={{
                          width: '14px', height: '14px', borderRadius: '4px', flexShrink: 0,
                          border: `1.5px solid ${on ? '#8B8FE6' : c.border}`,
                          backgroundColor: on ? '#8B8FE6' : 'transparent',
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {on && <Check size={10} strokeWidth={3} />}
                        </span>
                        <span style={{
                          fontSize: '12px', color: c.text, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {itemLabel(pp, lookup)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* footer */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '12px 16px', borderTop: `1px solid ${c.border}`, flexShrink: 0,
      }}>
        <button
          onClick={() => { void handleApply(); }}
          disabled={applying || approvedIds.length === 0}
          style={{
            flex: 1, padding: '10px 16px', borderRadius: '8px', border: 'none',
            backgroundColor: '#8B8FE6', color: '#fff', fontSize: '13px', fontWeight: 700,
            cursor: applying || approvedIds.length === 0 ? 'not-allowed' : 'pointer',
            opacity: applying || approvedIds.length === 0 ? 0.6 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
          }}
        >
          {applying && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
          {applying
            ? 'Applying…'
            : approvedIds.length === total
              ? `Apply all ${total} changes`
              : `Apply ${approvedIds.length} of ${total}`}
        </button>
        <button
          data-testid="review-reject"
          onClick={() => setAskingReason(true)}
          disabled={rejecting || askingReason}
          style={{
            padding: '10px 14px', borderRadius: '8px',
            border: `1px solid ${c.border}`, backgroundColor: 'transparent',
            color: c.textMuted, fontSize: '12.5px', fontWeight: 600,
            cursor: rejecting || askingReason ? 'default' : 'pointer',
          }}
        >
          Reject
        </button>
      </div>
      {askingReason && (
        <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${c.border}` }}>
          <div style={{ paddingTop: '12px' }}>
            <RejectReason
              busy={rejecting}
              onReject={(reason) => { void handleReject(reason); }}
              onKeep={() => setAskingReason(false)}
              colors={{ border: c.border, text: c.text, textMuted: c.textMuted, surface: c.surface }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

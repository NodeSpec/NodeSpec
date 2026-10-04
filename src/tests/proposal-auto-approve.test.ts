import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isAutoApprovable } from '../ui/hooks/useProposalAutoApprove.js';
import type { AIProposal } from '@nodespec/core/ai-proposal.js';

// UX-1.1a (docs/V2_TASKS.md, owner spec 2026-08-21): SELECTABLE auto-approval
// of incoming proposals — "Not default." The automation drives the EXISTING
// accept lane so every guard a manual accept has still applies.

describe('isAutoApprovable', () => {
  it('ordinary MCP proposals qualify; import-lane finalization drafts never do', () => {
    const ordinary = { id: 'p1', metadata: { source: 'mcp-server' } } as unknown as AIProposal;
    const importDraft = { id: 'p2', metadata: { finalization: true } } as unknown as AIProposal;
    const bare = { id: 'p3' } as unknown as AIProposal;
    expect(isAutoApprovable(ordinary)).toBe(true);
    expect(isAutoApprovable(bare)).toBe(true);
    expect(isAutoApprovable(importDraft)).toBe(false);
  });

  it('8.1: spec-plane proposals never auto-approve here — the approvals queue resolves them server-side', () => {
    const spec = { id: 'p4', metadata: { source: 'mcp-server' }, patches: [{ patch: { type: 'update_requirement' }, status: 'pending' }] } as unknown as AIProposal;
    const promo = { id: 'p5', patches: [{ patch: { type: 'promote_candidate' }, status: 'pending' }] } as unknown as AIProposal;
    const graph = { id: 'p6', patches: [{ patch: { type: 'add_node' }, status: 'pending' }] } as unknown as AIProposal;
    expect(isAutoApprovable(spec)).toBe(false);
    expect(isAutoApprovable(promo)).toBe(false);
    expect(isAutoApprovable(graph)).toBe(true);
  });
});

describe('UX-1.1a wiring contracts', () => {
  const hook = readFileSync(resolve(__dirname, '../ui/hooks/useProposalAutoApprove.ts'), 'utf-8');
  const editor = readFileSync(resolve(__dirname, '../ui/components/GraphEditor.tsx'), 'utf-8');
  const panel = readFileSync(resolve(__dirname, '../ui/components/panels/ChangesPanel.tsx'), 'utf-8');
  const service = readFileSync(resolve(__dirname, '../ui/services/ProposalService.ts'), 'utf-8');

  it('OFF by default: state starts false and only an explicit true in project metadata enables it', () => {
    expect(editor).toContain('const [autoApproveProposals, setAutoApproveProposals] = useState(false)');
    expect(editor).toContain("metadata as Record<string, unknown> | null)?.autoApproveProposals === true");
  });

  it('the driver routes through acceptProposal — the existing lane, never a parallel one', () => {
    expect(editor).toContain('accept: (proposalId) => proposalService.acceptProposal(proposalId)');
    expect(hook).not.toContain('appendPatches');
    expect(hook).not.toContain('graph_snapshots');
  });

  it('one attempt per proposal per session; a failure leaves the proposal pending', () => {
    expect(hook).toContain('attempted.current.has(proposal.id)');
    expect(editor).toContain('left pending for manual review');
  });

  it('a successful auto-approve stamps the audit trail', () => {
    expect(service).toContain('async markAutoApproved');
    expect(service).toContain('autoApproved: { at:');
    expect(editor).toContain('stampAutoApproved: (proposalId) => proposalService.markAutoApproved(proposalId)');
  });

  it('R23: ONE control — the Changes panel no longer carries a toggle; the Autonomy overlay is the writer', () => {
    // The Waiting tab's checkbox was a second control over the same state
    // as the Agents button's Autonomy settings (architecture lane Auto-apply
    // mirrors metadata.autoApproveProposals). The panel now only lists and
    // decides; the editor only reads.
    expect(panel).not.toContain('Auto-approve incoming proposals');
    expect(panel).not.toContain('autoApprove');
    expect(editor).not.toContain('handleToggleAutoApprove');
    // the one writer: useAutonomySettings keeps the mirror in lockstep
    const hook2 = readFileSync(resolve(__dirname, '../ui/components/ideation/useAutonomySettings.ts'), 'utf-8');
    expect(hook2).toContain('autoApproveProposals: next.architecture === 2');
  });

  it('R23: the editor follows the row live — the Autonomy overlay can flip the lane while the editor is mounted', () => {
    expect(editor).toContain("channel(`project-autonomy-${projectId}`)");
    expect(editor).toContain("{ event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` }");
    expect(editor).toContain('removeChannel(channel)');
  });

  it('with auto-approve ON the "come review" arrival toast is suppressed', () => {
    expect(editor).toContain('if (!autoApproveRef.current) {');
  });
});

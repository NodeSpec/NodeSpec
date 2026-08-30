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

  it('the toggle lives in the Changes panel and persists via metadata read-modify-write', () => {
    expect(panel).toContain('Auto-approve incoming proposals');
    expect(editor).toContain('autoApproveProposals: enabled');
    // Sibling metadata keys (publishedTemplateId, …) must survive the toggle.
    expect(editor).toMatch(/metadata: \{ \.\.\.\(\(data\?\.metadata as Record<string, unknown>\) \?\? \{\}\), autoApproveProposals/);
  });

  it('with auto-approve ON the "come review" arrival toast is suppressed', () => {
    expect(editor).toContain('if (!autoApproveRef.current) {');
  });
});

// UX-1.1a (docs/V2_TASKS.md, owner spec 2026-08-21): OPT-IN auto-approval of
// incoming proposals — default OFF, a project-level setting the user flips.
//
// The B2 lesson applies verbatim: automation drives the EXISTING human lane,
// never a parallel one. Everything routes through acceptProposal, so locked-
// node filtering, patch validation, idempotent dedup, and C1 git-content
// materialization all still guard the write — a failed materialization leaves
// the proposal pending exactly like a failed manual accept. Import-lane
// finalization proposals are SKIPPED: their whole point is human review in
// the ImportReviewPanel.
import { useEffect, useRef } from 'react';
import type { AIProposal } from '@nodespec/core/ai-proposal.js';

const POLL_MS = 30_000;

export interface ProposalAutoApproveArgs {
  enabled: boolean;
  branchId: string | null;
  listPending: (branchId: string) => Promise<AIProposal[]>;
  accept: (proposalId: string) => Promise<void>;
  /** Audit stamp folded into the proposal's metadata after a successful accept. */
  stampAutoApproved: (proposalId: string) => Promise<void>;
  onApplied: (proposal: AIProposal) => void;
  onFailed: (proposal: AIProposal, message: string) => void;
}

/** Import-lane drafts land in the review panel by design — never auto-approve. */
export function isAutoApprovable(proposal: AIProposal): boolean {
  const meta = (proposal.metadata ?? {}) as Record<string, unknown>;
  return !('finalization' in meta);
}

export function useProposalAutoApprove(args: ProposalAutoApproveArgs) {
  // One attempt per proposal per session — a failure needs a human, not a
  // retry loop hammering the same error every 30 seconds.
  const attempted = useRef<Set<string>>(new Set());
  const running = useRef(false);
  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(() => {
    if (!args.enabled || !args.branchId) return;

    const tick = async () => {
      const { enabled, branchId, listPending, accept, stampAutoApproved, onApplied, onFailed } = argsRef.current;
      if (!enabled || !branchId || running.current) return;
      running.current = true;
      try {
        const pending = await listPending(branchId);
        for (const proposal of pending) {
          if (attempted.current.has(proposal.id)) continue;
          if (!isAutoApprovable(proposal)) continue;
          attempted.current.add(proposal.id);
          try {
            await accept(proposal.id);
            // Best-effort audit stamp — the accept is the source of truth.
            try { await stampAutoApproved(proposal.id); } catch { /* non-fatal */ }
            onApplied(proposal);
          } catch (err) {
            onFailed(proposal, err instanceof Error ? err.message : String(err));
          }
        }
      } catch { /* listing failed — next tick retries */ }
      finally { running.current = false; }
    };

    void tick();
    const interval = setInterval(() => { void tick(); }, POLL_MS);
    return () => clearInterval(interval);
  }, [args.enabled, args.branchId]);
}

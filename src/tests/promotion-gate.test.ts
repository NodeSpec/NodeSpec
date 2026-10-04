import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { promotionGate } from '../ui/components/ideation/useCandidateActions.js';

// V3 P4 (task 4.6) → 4b.2 (R5): the promotion gate, app side. Pins: the
// deterministic precondition (≥1 testable criterion IN THE SLICE —
// whitespace is not an outcome); dismissed is terminal, settled derives no
// further; the app's write sequence mirrors the server's promote_candidate
// lane (same source, same metadata.promotion shape incl. derivationId,
// mapping only when the candidate carries a node, the derivation row
// recorded, the first link frozen, NEVER a status write on promote); and
// the two implementations carry the SAME gate sentence so they can never
// drift silently.

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

describe('promotionGate: deterministic, human judgment stays in the click', () => {
  it('pending with a testable criterion passes', () => {
    const gate = promotionGate({ name: 'Offline-first sync', status: 'pending', criteria: [{ text: 'reconciles in 5s' }] });
    expect(gate.allowed).toBe(true);
    expect(gate.slice!.map((c) => c.text)).toEqual(['reconciles in 5s']);
  });

  it('no testable outcome refuses by rule — empty, missing, and whitespace-only all fail', () => {
    for (const criteria of [[], null, [{ text: '' }], [{ text: '   ' }]]) {
      const gate = promotionGate({ name: 'AI board summarization', status: 'pending', criteria: criteria as never });
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain('no testable outcome');
    }
  });

  it('dismissed is terminal; settled (accepted) derives no further', () => {
    const dismissed = promotionGate({ name: 'x', status: 'dismissed', criteria: [{ text: 'y' }] });
    expect(dismissed.allowed).toBe(false);
    expect(dismissed.reason).toContain('terminal');
    const settled = promotionGate({ name: 'x', status: 'accepted', criteria: [{ text: 'y' }] });
    expect(settled.allowed).toBe(false);
    expect(settled.reason).toContain('settled outcomes derive no further');
  });
});

describe('the app lane mirrors the server lane', () => {
  const app = src('ui/components/ideation/useCandidateActions.ts');
  const server = readFileSync(
    resolve(__dirname, '../../supabase/functions/mcp-server/tools/spec-patch-apply.ts'), 'utf-8');

  it('both carry the SAME gate sentence — drift breaks this pin', () => {
    for (const text of [app, server]) {
      expect(text).toContain('has no testable outcome');
      expect(text).toContain('at least one acceptance criterion');
    }
  });

  it('the app write shape matches the canonical decide lane', () => {
    expect(app).toContain("source: 'ai-generated'");
    expect(app).toContain('promotion: { candidateId: candidate.id, key: live.key, kind: live.kind, promotedAt, derivationId, criterionIds:');
    expect(app).toContain('if (live.node_id)');
    expect(app).toContain("mapping_type: 'implements'");
    // R5: the derivation row is the record; the first link freezes; promote never writes accepted.
    expect(app).toContain(".from('outcome_derivations').insert({");
    expect(app).toContain("proposed_by_kind: 'human'");
    expect(app).toContain('if (!live.requirement_row_id) {');
    expect(app).toContain('.update({ requirement_row_id: createdReq.id, updated_at: promotedAt })');
    const promoteBody = app.slice(app.indexOf('const promote = useCallback'), app.indexOf('const settle = useCallback'));
    expect(promoteBody).not.toContain("status: 'accepted'");
    expect(app).toMatch(/\.eq\('status', 'pending'\)/);
    // REQ numbering keeps the Discovered #8 retry.
    expect(app).toContain("reqErr?.code !== '23505'");
  });

  it('9.3: attach is the server lane only (debt 7.9 ruling, 2026-09-20): an agent proposes attach_candidate, a person accepts it under Proposals; the app promotes whole outcomes', () => {
    expect(app).not.toContain('const attach = useCallback');
    expect(app).not.toContain('AttachOptions');
    expect(app).not.toContain('PromoteOptions');
    // W (2026-09-23): the Workflows space names the requirement it makes;
    // the naming carries no criterion ids, so a person still promotes the
    // whole outcome as it stands and a slice stays an agent's proposal.
    expect(app).toContain('promote: (candidate: CandidateItemRow, as?: PromoteAs) => Promise<string | null>;');
    expect(app).toContain('export interface PromoteAs { name?: string; description?: string }');
    const serverAttach = server.slice(server.indexOf('case "attach_candidate"'), server.indexOf('case "settle_candidate"'));
    expect(serverAttach).toContain('if (target.locked) return refuse(lockedRefusal(target.requirement_id));');
    expect(serverAttach).toContain('Attach across branches is refused');
    expect(serverAttach).toContain('if (prior.some((d) => d.requirement_row_id === target.id)) {');
    expect(serverAttach).toContain('if (derErr.code === "23505") {');
    expect(serverAttach).not.toContain('.from("specification_requirements")\n        .insert');
  });

  it('dismiss is pending-only and stamps decided_at', () => {
    expect(app).toContain("dismissed is terminal; a refile is a new row");
    expect(app).toContain(".update({ status: 'dismissed', decided_at: new Date().toISOString() })");
  });
});

describe('board wiring', () => {
  it('the composer renders the refusal reason and the dismiss confirm names terminality (4b.2 moved the gate into the board)', () => {
    const board = src('ui/components/work/ItemRail.tsx');
    expect(board).toContain('promotionGate(');
    expect(board).toContain('Dismissed is terminal');
  });
});

// V3 P4 (task 4.6) → 4b.2 (R5/R6): the promotion gate, app side. Crossing
// the promotion line is a HUMAN act at every autonomy level — over MCP a
// key can only PROPOSE it (the router forces the proposal lane and only
// the app's session may accept); HERE the signed-in owner clicking Promote
// IS the human act, so the app applies it directly.
//
// Promotion DERIVES (R5): each promote claims a SLICE of the outcome's
// draft criteria (default: every unclaimed one), mints one requirement
// that copies the slice, records the derivation, and leaves the outcome
// PENDING — promotable again from what is left. A claimed criterion
// refuses a second claim naming the REQ that holds it. Settle is the
// explicit "fully covered" (terminal accepted); dismiss stays terminal.
//
// The gate is deterministic and identical to the server's: at least one
// testable criterion IN THE SLICE, or the promotion refuses — "AI board
// summarization" is refused by rule, not by taste.
//
// The write sequence MIRRORS applySpecPatch's promote_candidate /
// settle_candidate cases (supabase/functions/mcp-server/tools/
// spec-patch-apply.ts). Change BOTH when the shape moves; the pins in
// promotion-gate.test.ts and derivation-composer.test.ts hold the two to
// the same rules.
import { useCallback } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { identifiedFromRow, type IdentifiedCriterion } from './criterion-identity.js';
import type { CandidateItemRow } from './useTierItems.js';

export interface PromotionGateResult {
  allowed: boolean;
  reason?: string;
  /** The criteria this promotion would claim (when allowed). */
  slice?: IdentifiedCriterion[];
}

export interface PromotionGateContext {
  /** criterion id → REQ-NNN that already claimed it. */
  claimed?: Record<string, string>;
  /** The composer's selection; absent = every unclaimed criterion. */
  selectedIds?: string[];
}

/** The deterministic precondition, per slice. Human judgment lives in the
 *  click that follows — never in this check. */
export function promotionGate(
  candidate: Pick<CandidateItemRow, 'name' | 'criteria' | 'status'>,
  ctx: PromotionGateContext = {},
): PromotionGateResult {
  if (candidate.status === 'dismissed') {
    return { allowed: false, reason: 'This candidate is dismissed — dismissed is terminal. Refile as a new candidate instead.' };
  }
  if (candidate.status !== 'pending') {
    return { allowed: false, reason: `This outcome is ${candidate.status} — settled outcomes derive no further. Refile a new outcome for new intent.` };
  }
  const claimed = ctx.claimed ?? {};
  const all = identifiedFromRow(candidate.criteria);
  const unclaimed = all.filter((c) => !claimed[c.id]);
  let slice = unclaimed;
  if (ctx.selectedIds) {
    slice = [];
    for (const id of ctx.selectedIds) {
      const c = all.find((x) => x.id === id);
      if (!c) continue;
      if (claimed[id]) {
        return { allowed: false, reason: `Criterion "${c.text}" is already derived into ${claimed[id]} — choose unclaimed criteria, or draft new ones on the outcome.` };
      }
      slice.push(c);
    }
  }
  if (slice.length === 0) {
    if (all.length === 0) {
      return {
        allowed: false,
        reason: `"${candidate.name}" has no testable outcome — the promotion gate needs at least one acceptance criterion. Draft criteria on the candidate, then promote.`,
      };
    }
    if (unclaimed.length === 0) {
      return {
        allowed: false,
        reason: `Every criterion of "${candidate.name}" is already derived (${[...new Set(Object.values(claimed))].join(', ')}) — draft new criteria to derive more, or settle the outcome.`,
      };
    }
    return { allowed: false, reason: 'Select at least one unclaimed criterion to derive a requirement from.' };
  }
  return { allowed: true, slice };
}

/** v3x (doctrine 6): ONE refusal sentence for every lock — the database's
 *  own (public.requirement_lock_message) and the server's (lockedRefusal in
 *  requirements.ts), byte for byte. Unlock is a human act in the app: V3 7.8,
 *  the toggle on the requirement's rail under Work. */
export function lockedRefusal(requirementRef: string): string {
  return `${requirementRef} is locked. Unlock it in the app (the lock toggle on its rail under Work), then retry. No tool unlocks.`;
}

/** W: the Workflows space's "Add a requirement" names the requirement it
 *  makes (the outcome is what should happen, the requirement what must hold
 *  for it to). Without it the requirement takes the outcome's own words. */
export interface PromoteAs { name?: string; description?: string }

export interface CandidateActions {
  /** The whole outcome as it stands becomes a requirement (every unclaimed
   *  criterion); a slice is an agent's proposal (promote_candidate with
   *  criteriaIds), decided under Proposals. Debt 7.9 ruling, 2026-09-20. */
  promote: (candidate: CandidateItemRow, as?: PromoteAs) => Promise<string | null>;
  settle: (candidate: CandidateItemRow) => Promise<string | null>;
  dismiss: (candidate: CandidateItemRow) => Promise<string | null>;
}

type LiveCandidate = {
  status: string; criteria: unknown; name: string; description: string | null; category: string | null;
  key: string; kind: string; node_id: string | null; branch_id: string; requirement_row_id: string | null;
};
type DerivationRow = { id: string; requirement_row_id: string; criteria_slice: Array<{ id?: string; text?: string }> | null };

export function useCandidateActions(projectId: string | null | undefined, onApplied?: () => void): CandidateActions {
  const promote = useCallback(async (candidate: CandidateItemRow, as?: PromoteAs): Promise<string | null> => {
    if (!projectId) return 'No project.';
    try {
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 'Sign in to promote — the click is the human act.';

      // Terminal check against the LIVE row — the board may be stale.
      const { data: liveRow } = await supabase
        .from('requirement_candidates')
        .select('status, criteria, name, description, category, key, kind, node_id, branch_id, requirement_row_id')
        .eq('id', candidate.id)
        .eq('project_id', projectId)
        .maybeSingle();
      if (!liveRow) return 'Candidate not found in this project.';
      const live = liveRow as LiveCandidate;

      // What this outcome already derived, and which criteria those claimed.
      const { data: priorRows } = await supabase
        .from('outcome_derivations')
        .select('id, requirement_row_id, criteria_slice')
        .eq('candidate_id', candidate.id);
      const prior = (priorRows ?? []) as DerivationRow[];
      const reqRefOf = new Map<string, string>();
      if (prior.length > 0) {
        const { data: reqs } = await supabase
          .from('specification_requirements')
          .select('id, requirement_id')
          .in('id', prior.map((d) => d.requirement_row_id));
        for (const r of (reqs ?? []) as Array<{ id: string; requirement_id: string }>) reqRefOf.set(r.id, r.requirement_id);
      }
      const claimed: Record<string, string> = {};
      for (const d of prior) {
        for (const c of identifiedFromRow(d.criteria_slice)) claimed[c.id] = reqRefOf.get(d.requirement_row_id) ?? d.requirement_row_id;
      }
      const gate = promotionGate({ name: live.name, criteria: live.criteria as never, status: live.status }, { claimed });
      if (!gate.allowed || !gate.slice) return gate.reason!;
      const slice = gate.slice;

      // Spec: newest, or mint a minimal one (the server does the same).
      const { data: spec } = await supabase
        .from('project_specifications')
        .select('id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      let specId = spec?.id as string | undefined;
      if (!specId) {
        const { data: created, error: specErr } = await supabase
          .from('project_specifications')
          .insert({ project_id: projectId, vision: '', raw_input: '', phase_status: 'drafting_requirements' })
          .select('id')
          .single();
        if (specErr || !created) return `Failed to create specification: ${specErr?.message ?? 'unknown error'}`;
        specId = created.id as string;
      }

      const derivationId = crypto.randomUUID();
      const promotedAt = new Date().toISOString();
      // REQ-NNN with the 23505 retry (Discovered #8 — same race, same fix).
      let createdReq: { id: string; requirement_id: string } | null = null;
      let lastError = 'unknown error';
      for (let attempt = 0; attempt < 3 && !createdReq; attempt++) {
        const { data: existing } = await supabase
          .from('specification_requirements')
          .select('requirement_id')
          .eq('specification_id', specId)
          .like('requirement_id', 'REQ-%');
        let maxNum = 0;
        for (const row of (existing ?? []) as Array<{ requirement_id: string }>) {
          const num = parseInt(String(row.requirement_id).slice(4), 10);
          if (!Number.isNaN(num) && num > maxNum) maxNum = num;
        }
        const { data: req, error: reqErr } = await supabase
          .from('specification_requirements')
          .insert({
            specification_id: specId,
            requirement_id: `REQ-${String(maxNum + 1).padStart(3, '0')}`,
            name: as?.name?.trim() || live.name,
            description: as?.description?.trim() || live.description || '',
            category: live.category ?? 'functional',
            status: 'pending',
            // The REQ owns its COPY of the slice from here on (R5).
            acceptance_criteria: slice.map((c) => ({ text: c.text, met: false, ...(c.verification ? { verification: c.verification } : {}) })),
            source: 'ai-generated',
            confirmed: false,
            locked: false,
            metadata: {
              promotion: { candidateId: candidate.id, key: live.key, kind: live.kind, promotedAt, derivationId, criterionIds: slice.map((c) => c.id) },
            },
          })
          .select('id, requirement_id')
          .single();
        if (req) { createdReq = req as { id: string; requirement_id: string }; break; }
        lastError = reqErr?.message ?? 'insert failed';
        if (reqErr?.code !== '23505') break;
      }
      if (!createdReq) return `Promotion failed: ${lastError}`;

      // Import-derived candidates carry their node — map exactly as the
      // server does; ideation-born outcomes map later, never fabricated.
      if (live.node_id) {
        await supabase.from('specification_mappings').insert({
          specification_id: specId,
          requirement_id: createdReq.id,
          node_id: live.node_id,
          mapping_type: 'implements',
          confidence: 0.6,
          notes: `promoted candidate ${live.key}`,
        });
      }

      // The derivation row IS the record (R5): slice, proposer, approver —
      // here both the signed-in owner.
      const { error: derErr } = await supabase.from('outcome_derivations').insert({
        id: derivationId,
        project_id: projectId,
        branch_id: live.branch_id,
        candidate_id: candidate.id,
        requirement_row_id: createdReq.id,
        criteria_slice: slice,
        proposed_by_kind: 'human',
        proposed_by_id: user.id,
        via_proposal_id: null,
        approved_by: user.id,
      });
      if (derErr) return `Requirement ${createdReq.requirement_id} created but the derivation could not be recorded: ${derErr.message}`;

      // The first derivation freezes requirement_row_id; the outcome stays
      // PENDING — settle is a separate act.
      if (!live.requirement_row_id) {
        const { error: markErr } = await supabase
          .from('requirement_candidates')
          .update({ requirement_row_id: createdReq.id, updated_at: promotedAt })
          .eq('id', candidate.id)
          .eq('status', 'pending');
        if (markErr) return `Requirement ${createdReq.requirement_id} created but the candidate could not be linked: ${markErr.message}`;
      }
      // Sibling derivations relate — best effort, never fails the promote.
      for (const d of prior) {
        await supabase.from('specification_requirement_relations').insert({
          specification_id: specId,
          from_requirement_id: createdReq.id,
          to_requirement_id: d.requirement_row_id,
          relation_type: 'relates_to',
          source: 'user',
          notes: `derived from outcome ${live.key}`,
        });
      }

      onApplied?.();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Promotion failed';
    }
  }, [projectId, onApplied]);

  const settle = useCallback(async (candidate: CandidateItemRow): Promise<string | null> => {
    if (!projectId) return 'No project.';
    if (candidate.status !== 'pending') {
      return `This outcome is already ${candidate.status} — a refile is a new row.`;
    }
    try {
      const supabase = getSupabaseClient();
      const { data: derived } = await supabase
        .from('outcome_derivations')
        .select('id')
        .eq('candidate_id', candidate.id);
      if (((derived ?? []) as unknown[]).length === 0) {
        return `"${candidate.name}" has derived nothing yet — settle means "fully covered": promote at least one criteria slice first, or dismiss the outcome.`;
      }
      const { error: err } = await supabase
        .from('requirement_candidates')
        .update({ status: 'accepted', decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', candidate.id)
        .eq('project_id', projectId)
        .eq('status', 'pending');
      if (err) return err.message;
      onApplied?.();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Settle failed';
    }
  }, [projectId, onApplied]);

  const dismiss = useCallback(async (candidate: CandidateItemRow): Promise<string | null> => {
    if (!projectId) return 'No project.';
    if (candidate.status !== 'pending') {
      return `This candidate is already ${candidate.status} — dismissed is terminal; a refile is a new row.`;
    }
    try {
      const supabase = getSupabaseClient();
      // 9.8: dismiss is for outcomes that derived nothing — mirrors the server.
      const { data: derivedRows } = await supabase
        .from('outcome_derivations')
        .select('id')
        .eq('candidate_id', candidate.id);
      const derivedCount = ((derivedRows ?? []) as unknown[]).length;
      if (derivedCount > 0) {
        return `"${candidate.name}" derived ${derivedCount} requirement${derivedCount === 1 ? '' : 's'} — dismiss is for outcomes that derived nothing. Settle it when it is fully covered; the derived requirements keep it as their origin.`;
      }
      const { error: err } = await supabase
        .from('requirement_candidates')
        .update({ status: 'dismissed', decided_at: new Date().toISOString() })
        .eq('id', candidate.id)
        .eq('project_id', projectId)
        .eq('status', 'pending');
      if (err) return err.message;
      onApplied?.();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Dismiss failed';
    }
  }, [projectId, onApplied]);

  return { promote, settle, dismiss };
}

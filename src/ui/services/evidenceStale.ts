// R5e · evidence-stale — "the source changed under a proven criterion, re-verify."
//
// The scenario: a criterion was marked met via a git tick (R5c). Later, an
// out-of-band change to one of that node's bound artifacts is ACCEPTED from the
// sweep — the implementation the tick vouched for has moved. The criterion is not
// UNMET (nothing disproved it), but its evidence is stale: it proved the old code.
//
// Deterministic by construction: the file→artifact→node→criterion chain is fully
// known (artifact binding + specification_mappings), so no inference is involved.
// This is the analogue of the existing `test_cases` source-change staleness
// trigger (migration 20260325192007), for criteria whose evidence is a git tick
// rather than a test — which is why the scope below is provenance-gated.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface EvidenceStaleMark {
  at: string;
  commitSha?: string;
  reason: 'source-changed';
}

export interface StaleCriterion {
  requirementId: string;
  text: string;
}

/**
 * Flag the met criteria whose evidence is a GIT TICK. Pure.
 *
 * Scope, deliberately narrow (each exclusion is a different truth-owner):
 *  - `met !== true`            → nothing to go stale.
 *  - `provenance.source !== 'git'` → test-evidenced criteria already have their
 *    own staleness lane (the test_cases source-change trigger), and UI-ticked
 *    criteria were asserted by a human, not derived from the file that changed —
 *    flagging those would second-guess a person from a signal about code.
 *  - already flagged           → idempotent; re-accepting more changes must not
 *    stack marks or churn the row.
 *
 * `met` STAYS TRUE. Stale evidence is a prompt to re-verify, not a retraction —
 * the same asymmetry R5a applies to unticks.
 */
export function flagStaleCriteria(
  stored: unknown,
  mark: EvidenceStaleMark,
): { criteria: Array<Record<string, unknown>>; flaggedTexts: string[] } {
  const flaggedTexts: string[] = [];
  const criteria = (Array.isArray(stored) ? stored : []).map((c) => {
    const obj: Record<string, unknown> =
      typeof c === 'string' ? { text: c } : { ...(c as Record<string, unknown>) };
    const provenance = obj.provenance as { source?: string } | undefined;
    if (
      obj.met === true &&
      provenance?.source === 'git' &&
      !obj.evidenceStale &&
      typeof obj.text === 'string'
    ) {
      obj.evidenceStale = { ...mark };
      flaggedTexts.push(obj.text);
    }
    return obj;
  });
  return { criteria, flaggedTexts };
}

/**
 * The accept-lane entry point: an out-of-band change to `nodeId`'s artifact was
 * just accepted — walk this node's mapped requirements and flag their git-evidenced
 * met criteria. Fire-and-forget from the caller; a failure here must never affect
 * the accept itself (same contract as R4's auto-push).
 */
export async function flagNodeEvidenceStale(
  supabase: SupabaseClient,
  projectId: string,
  nodeId: string,
  commitSha?: string,
): Promise<{ flagged: StaleCriterion[] }> {
  const flagged: StaleCriterion[] = [];

  const { data: spec } = await supabase
    .from('project_specifications')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!spec) return { flagged };

  const { data: mappingRows } = await supabase
    .from('specification_mappings')
    .select('requirement_id')
    .eq('specification_id', spec.id)
    .eq('node_id', nodeId);
  const requirementRowIds = [...new Set(
    ((mappingRows ?? []) as Array<{ requirement_id: string | null }>)
      .map((m) => m.requirement_id)
      .filter((id): id is string => !!id),
  )];
  if (requirementRowIds.length === 0) return { flagged };

  const { data: reqRows } = await supabase
    .from('specification_requirements')
    .select('id, requirement_id, acceptance_criteria')
    .in('id', requirementRowIds);

  const at = new Date().toISOString();
  for (const row of (reqRows ?? []) as Array<{ id: string; requirement_id: string; acceptance_criteria: unknown }>) {
    const { criteria, flaggedTexts } = flagStaleCriteria(row.acceptance_criteria, {
      at,
      ...(commitSha ? { commitSha } : {}),
      reason: 'source-changed',
    });
    if (flaggedTexts.length === 0) continue;
    const { error } = await supabase
      .from('specification_requirements')
      .update({ acceptance_criteria: criteria, updated_at: at })
      .eq('id', row.id);
    if (error) {
      console.warn(`[evidenceStale] flag write failed for ${row.requirement_id}: ${error.message}`);
      continue;
    }
    for (const text of flaggedTexts) flagged.push({ requirementId: row.requirement_id, text });
  }
  return { flagged };
}

/**
 * A human touching a stale criterion IS the re-verification. Used by the Spec
 * view's criterion toggle: any explicit met change clears the stale mark (and a
 * re-tick records UI provenance, so the audit trail says who re-verified).
 */
export function clearEvidenceStale(criterion: Record<string, unknown>): Record<string, unknown> {
  const { evidenceStale: _dropped, ...rest } = criterion;
  return rest;
}

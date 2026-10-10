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
import { flagStaleCriteria } from '@nodespec/core/evidence-stale.js';

export { flagStaleCriteria, nodesWithChangedFiles, clearEvidenceStale, type EvidenceStaleMark } from '@nodespec/core/evidence-stale.js';

export interface StaleCriterion {
  requirementId: string;
  text: string;
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
    // flagStaleCriteria still decides WHICH criteria are due; the array it
    // builds is no longer what gets written.
    const { flaggedTexts } = flagStaleCriteria(row.acceptance_criteria, {
      at,
      ...(commitSha ? { commitSha } : {}),
      reason: 'source-changed',
    });
    if (flaggedTexts.length === 0) continue;
    // R2: the marks travel as OPS to the one locked writer (through the member
    // wrapper, which re-checks membership and clearance). Writing the array
    // here would clobber any met flip that landed between the read above and
    // this write — exactly the lost update the concurrency review reproduced.
    const { error } = await supabase.rpc('apply_criteria_ops_as_member', {
      p_requirement_id: row.id,
      p_ops: flaggedTexts.map((text) => ({
        op: 'mark_stale',
        criterion_text: text,
        value: { at, ...(commitSha ? { commitSha } : {}), reason: 'source-changed' },
      })),
    });
    if (error) {
      console.warn(`[evidenceStale] flag write failed for ${row.requirement_id}: ${error.message}`);
      continue;
    }
    for (const text of flaggedTexts) flagged.push({ requirementId: row.requirement_id, text });
  }
  return { flagged };
}

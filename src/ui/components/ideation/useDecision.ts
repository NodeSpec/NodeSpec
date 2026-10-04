// The record behind one promotion, read for the decision page (the
// design's One decision board): the proposal's payload and the agent's
// reason, the outcome it names with the criteria slice it would take, the
// steps the outcome is filed on (by lane, numbered as Work numbers them;
// AC: only on a plan with Workflows, and below it no step is read or named),
// and the ref the requirement will take (the same rule the server mints
// by: the highest REQ number plus one). Pure helpers first; one hook.
import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { identifiedFromRow, type IdentifiedCriterion } from './criterion-identity.js';
import { proposalOrigin } from '../../utils/proposal-plane.js';

export interface DecisionStep { index: number; name: string; lane: string }

export interface DecisionRecord {
  proposalId: string;
  agent: string;
  askedAt: string;
  /** The agent's explanation, when it gave one. */
  reason: string | null;
  candidateId: string;
  name: string;
  description: string | null;
  /** The criteria the requirement takes: the payload's slice, else all of them. */
  criteria: IdentifiedCriterion[];
  nodeId: string | null;
  /** The payload's section: where the requirement lands in the specification. */
  section: string | null;
  /** null below Indie: steps do not exist on the plan and are not named. */
  steps: DecisionStep[] | null;
  /** The REQ ref it will take, predicted the server's way. */
  nextRef: string | null;
}

/** The server's nextRequirementId, mirrored: the highest REQ number plus
 *  one, three digits. Pure. */
export function predictedRef(refs: readonly string[]): string {
  let max = 0;
  for (const r of refs) {
    if (!r.startsWith('REQ-')) continue;
    const n = parseInt(r.slice(4), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `REQ-${String(max + 1).padStart(3, '0')}`;
}

/** "on step 1 Sign in and step 3 Move it between shelves" · "on step 4 Mark it finished" · "on no step yet". Pure. */
export function stepsPhrase(steps: readonly DecisionStep[]): string {
  const list = [...steps].sort((a, b) => a.index - b.index).map((s) => `step ${s.index} ${s.name}`);
  if (list.length === 0) return 'on no step yet';
  if (list.length === 1) return `on ${list[0]}`;
  return `on ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** "Becomes REQ-005 under Supabase Postgres · unconfirmed · on step 1 Sign in
 *  and step 3 Move it between shelves". A promotion mints the requirement
 *  UNCONFIRMED (the ladder's middle rung). Pure. */
export function becomesLine(r: Pick<DecisionRecord, 'nextRef' | 'section' | 'steps'>): string {
  return `Becomes ${r.nextRef ?? 'a requirement'}${r.section ? ` under ${r.section}` : ''} · unconfirmed${r.steps ? ` · ${stepsPhrase(r.steps)}` : ''}`;
}

/** "claude-code asked on 15 Sep. Promoting an outcome is never automatic, at any autonomy level. Only you can answer." Pure. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "15 Sep": the design's day-first form, the same in every locale. Pure. */
export function dayMonth(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function askedLine(agent: string, iso: string): string {
  const when = dayMonth(iso);
  return `${agent} asked${when ? ` on ${when}` : ''}.`;
}

export interface DecisionState { record: DecisionRecord | null; loading: boolean; error: string | null }

type Entry = { patch?: { type?: string; payload?: Record<string, unknown> }; explanation?: string };

export function useDecision(projectId: string | null | undefined, proposalId: string | null | undefined, workflows: boolean): DecisionState {
  const [state, setState] = useState<DecisionState>({ record: null, loading: false, error: null });
  useEffect(() => {
    if (!projectId || !proposalId) { setState({ record: null, loading: false, error: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data: row, error: rowErr } = await supabase.from('ai_proposals').select('id, patches, metadata, created_at').eq('id', proposalId).maybeSingle();
        if (rowErr) throw new Error(rowErr.message);
        if (!row) throw new Error('That proposal is gone.');
        const r = row as { id: string; patches: unknown; metadata: Record<string, unknown> | null; created_at: string };
        const entries = (Array.isArray(r.patches) ? r.patches : []) as Entry[];
        const first = entries.find((e) => e.patch?.type === 'promote_candidate') ?? entries[0];
        const p = (first?.patch?.payload ?? {}) as Record<string, unknown>;
        const candidateId = typeof p.candidateId === 'string' ? p.candidateId : null;
        if (!candidateId) throw new Error('This proposal names no outcome.');
        const explanation = typeof first?.explanation === 'string' && first.explanation !== 'No explanation provided' ? first.explanation : null;
        // AL.2: the page names who filed it the way the card does (the proven credential).
        const agent = proposalOrigin(r.metadata).label;

        const [candRes, mapRes, specRes] = await Promise.all([
          supabase.from('requirement_candidates').select('id, name, description, criteria, node_id').eq('id', candidateId).maybeSingle(),
          workflows ? supabase.from('outcome_step_maps').select('step_id').eq('candidate_id', candidateId) : Promise.resolve({ data: [] }),
          supabase.from('project_specifications').select('id').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (candRes.error) throw new Error(candRes.error.message);
        const cand = candRes.data as { id: string; name: string; description: string | null; criteria: unknown; node_id: string | null } | null;
        if (!cand) throw new Error('The outcome this proposal names is gone.');

        const stepIds = ((mapRes.data ?? []) as Array<{ step_id: string }>).map((m) => m.step_id);
        let steps: DecisionStep[] | null = null;
        if (workflows) {
          const found: DecisionStep[] = [];
          if (stepIds.length > 0) {
            const { data: mine } = await supabase.from('workflow_steps').select('id, workflow_id, name, sort_order').in('id', stepIds);
            const laneIds = [...new Set(((mine ?? []) as Array<{ workflow_id: string }>).map((s) => s.workflow_id))];
            const [{ data: all }, { data: lanes }] = await Promise.all([
              supabase.from('workflow_steps').select('id, workflow_id, name, sort_order').in('workflow_id', laneIds).order('sort_order', { ascending: true }),
              supabase.from('workflows').select('id, name').in('id', laneIds),
            ]);
            const laneName = new Map(((lanes ?? []) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name]));
            const byLane = new Map<string, Array<{ id: string; name: string }>>();
            for (const s of (all ?? []) as Array<{ id: string; workflow_id: string; name: string }>) byLane.set(s.workflow_id, [...(byLane.get(s.workflow_id) ?? []), s]);
            for (const [laneId, list] of byLane) list.forEach((s, i) => { if (stepIds.includes(s.id)) found.push({ index: i + 1, name: s.name, lane: laneName.get(laneId) ?? '' }); });
          }
          steps = found.sort((a, b) => a.lane.localeCompare(b.lane) || a.index - b.index);
        }

        let nextRef: string | null = null;
        if (specRes.data?.id) {
          const { data: refs } = await supabase.from('specification_requirements').select('requirement_id').eq('specification_id', specRes.data.id).like('requirement_id', 'REQ-%');
          nextRef = predictedRef(((refs ?? []) as Array<{ requirement_id: string }>).map((x) => x.requirement_id));
        }

        const all = identifiedFromRow(cand.criteria);
        const slice = Array.isArray(p.criteriaIds) ? (p.criteriaIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        const criteria = slice.length > 0 ? all.filter((c) => slice.includes(c.id)) : all;
        if (cancelled) return;
        setState({
          record: {
            proposalId: r.id, agent, askedAt: r.created_at, reason: explanation, candidateId,
            name: typeof p.name === 'string' && p.name ? p.name : cand.name,
            description: typeof p.description === 'string' && p.description ? p.description : cand.description,
            criteria, nodeId: cand.node_id ?? null, section: typeof p.section === 'string' && p.section ? p.section : null, steps, nextRef,
          },
          loading: false, error: null,
        });
      } catch (err) {
        if (!cancelled) setState({ record: null, loading: false, error: err instanceof Error ? err.message : 'The decision could not be read.' });
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, proposalId, workflows]);
  return state;
}

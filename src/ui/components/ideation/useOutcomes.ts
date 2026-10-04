// V3 P4 (Workflow mode, per Workflow Space.dc.html): the OUTCOMES pool's
// data lane. Outcomes are requirement_candidates (kind outcome; dismissed
// is terminal and never renders); their lane membership is DERIVED from
// outcome_step_maps through the lane's steps — an outcome renders in the
// pool of every lane whose steps it maps to, and an UNMAPPED outcome
// renders in the focused lane's pool so it stays visible and mappable
// ("what this workflow should achieve, mapped to the steps it touches").
//
// Step mapping is a TOGGLE, exactly the design's gesture: select an
// outcome, click a step — the map row appears or disappears (v3e,
// branch-scoped). The live dot is an active outcome-level agent checkout.
//
// v3l (R5): promotion DERIVES. An outcome carries its derivations (read in
// one batch from outcome_derivations) and the map of which criterion id
// each one claimed; a pending outcome with derivations stays pending and
// promotable from what is unclaimed; 'accepted' is the explicit settle.
import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { fileWorkflowProposal, proposalNotice, stepMaps } from './workflow-proposals.js';
import { identifyCriteria, criterionIdOf, identifiedFromRow } from './criterion-identity.js';
import { servesOf, type VisionSentence } from '../../utils/vision-sentences.js';
import { oauthClientKnownName, oauthClientName } from '../../../../supabase/functions/_shared/oauth-client.js';
import type { CandidateItemRow } from './useTierItems.js';
import type { WorkflowLane } from './useWorkflowLanes.js';

export interface OutcomeStepMapRow {
  id: string;
  candidate_id: string;
  step_id: string;
}

export interface OutcomeDerivation {
  id: string;
  requirementRowId: string;
  /** REQ-NNN of the derived requirement (null when the row is gone). */
  reqRef: string | null;
  /** The criterion ids this derivation claimed (written, or text-hash). */
  criteriaIds: string[];
  proposedByKind: 'human' | 'agent';
  /** Who proposed it: an agent's key id or the name it gave itself, a person's id. */
  proposedById?: string | null;
  createdAt: string;
}

export interface Outcome extends CandidateItemRow {
  /** 9.5: the HOME lane (v3v, never null on a live row). */
  workflowId: string | null;
  /** Step ids this outcome maps to (any lane — a touch, not a home). */
  stepIds: string[];
  /** Active outcome-level agent hold (the design's live dot). */
  live: boolean;
  /** Derived at least once (the first derivation froze requirement_row_id). */
  promoted: boolean;
  /** The FIRST derived requirement's REQ-NNN (the design's ref chip). */
  reqRef: string | null;
  /** Every derivation, oldest first (R5). */
  derivations: OutcomeDerivation[];
  /** criterion id → REQ-NNN that claimed it. */
  claimed: Record<string, string>;
  /** REQ refs of every derivation, in order. */
  reqRefs: string[];
  /** The owner settled it ("fully covered") — terminal 'accepted'. */
  settled: boolean;
  /** AA.1: the vision sentences it cites (evidence.serves), as cited. */
  serves: VisionSentence[];
  /** AL.7: the agent it came from, by name: the agent that filed it
   *  (evidence.filedBy), else the agent that derived its first requirement.
   *  Null for a person's outcome, or an agent the app cannot name. */
  agent?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** AL.7: an agent's name from what was recorded about it: its credential
 *  ("key:<id>" by the key's name, "oauth:<user>:<client>" by the client's
 *  name), a bare key id, or the name it gave itself. The connection's name
 *  wins over the self-given one; null when nothing names it. Pure. */
export function agentNameOf(credential: string | null | undefined, nickname: string | null | undefined, keyNames: ReadonlyMap<string, string>): string | null {
  const nick = typeof nickname === 'string' && nickname.trim() ? nickname.trim() : null;
  const c = typeof credential === 'string' ? credential.trim() : '';
  if (c.startsWith('key:')) return keyNames.get(c.slice(4)) ?? nick ?? `key ${c.slice(4, 12)}`;
  if (c.startsWith('oauth:')) {
    const client = c.split(':').slice(2).join(':');
    return oauthClientKnownName(client) ?? nick ?? oauthClientName(client);
  }
  if (UUID.test(c)) return keyNames.get(c) ?? nick;
  return c || nick;
}

/** The key ids an outcome's record names, for one read of their names. Pure. */
export function keyIdsNamed(rows: ReadonlyArray<{ evidence?: unknown }>, derivations: ReadonlyArray<{ proposed_by_kind: string; proposed_by_id?: string | null }>): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    const cred = ((r.evidence ?? {}) as { filedBy?: { credential?: unknown } }).filedBy?.credential;
    if (typeof cred === 'string' && cred.startsWith('key:')) ids.add(cred.slice(4));
  }
  for (const d of derivations) if (d.proposed_by_kind === 'agent' && typeof d.proposed_by_id === 'string' && UUID.test(d.proposed_by_id)) ids.add(d.proposed_by_id);
  return [...ids];
}

/** AL.7: the name of the agent an outcome came from (see Outcome.agent). Pure. */
export function outcomeAgent(evidence: unknown, derivations: ReadonlyArray<Pick<OutcomeDerivation, 'proposedByKind' | 'proposedById'>>, keyNames: ReadonlyMap<string, string>): string | null {
  const filed = ((evidence ?? {}) as { filedBy?: { credential?: unknown; agent?: unknown } }).filedBy;
  if (filed && typeof filed === 'object') {
    const name = agentNameOf(typeof filed.credential === 'string' ? filed.credential : null, typeof filed.agent === 'string' ? filed.agent : null, keyNames);
    if (name) return name;
  }
  const first = derivations[0];
  return first?.proposedByKind === 'agent' ? agentNameOf(first.proposedById ?? null, null, keyNames) : null;
}

type DerivationRow = {
  id: string; candidate_id: string; requirement_row_id: string;
  criteria_slice: Array<{ id?: string; text?: string }> | null;
  proposed_by_kind: 'human' | 'agent'; proposed_by_id?: string | null; created_at: string;
};

/** Group derivation rows per candidate, resolving REQ refs; the claimed
 *  map answers "which requirement holds this criterion" by id. */
export function assembleDerivations(
  rows: DerivationRow[],
  reqRefById: Map<string, string>,
): Map<string, { derivations: OutcomeDerivation[]; claimed: Record<string, string> }> {
  const out = new Map<string, { derivations: OutcomeDerivation[]; claimed: Record<string, string> }>();
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const r of sorted) {
    const entry = out.get(r.candidate_id) ?? { derivations: [], claimed: {} };
    const reqRef = reqRefById.get(r.requirement_row_id) ?? null;
    const criteriaIds = (r.criteria_slice ?? []).map((c) => criterionIdOf(c));
    entry.derivations.push({ id: r.id, requirementRowId: r.requirement_row_id, reqRef, criteriaIds, proposedByKind: r.proposed_by_kind, proposedById: r.proposed_by_id ?? null, createdAt: r.created_at });
    for (const id of criteriaIds) entry.claimed[id] = reqRef ?? r.requirement_row_id;
    out.set(r.candidate_id, entry);
  }
  return out;
}

/** The pool for one lane (9.5): the outcomes whose HOME is this lane, plus
 *  the outcomes that TOUCH it through a step map (the JOIN seam — filed
 *  elsewhere, reaching in). An unmapped outcome shows in its home lane and
 *  nowhere else: no lane is ever a guess. */
export function outcomesForLane(outcomes: Outcome[], lane: WorkflowLane | null): Outcome[] {
  if (!lane) return outcomes;
  const laneSteps = new Set(lane.steps.map((s) => s.id));
  return outcomes.filter((o) => o.workflowId === lane.id || o.stepIds.some((id) => laneSteps.has(id)));
}

/** 9.5: an outcome that touches this lane but lives in another one. */
export function isVisitingLane(o: Outcome, laneId: string): boolean {
  return o.workflowId !== null && o.workflowId !== laneId;
}

/** Outcomes mapped to a given step — the step card's count line. */
export function outcomeCountByStep(outcomes: Outcome[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of outcomes) {
    for (const stepId of o.stepIds) counts.set(stepId, (counts.get(stepId) ?? 0) + 1);
  }
  return counts;
}

export interface OutcomesApi {
  /** AE.7: a step map toggle files a proposal instead of writing. */
  proposing: boolean;
  /** AE.7: the last proposal filed, for the surface's toast. */
  notice: { text: string; at: number } | null;
  outcomes: Outcome[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** 9.5: born into a lane — the one with focus. V3 4.1: and filed on a
   *  step in the same act when Work adds it from an empty step. */
  createOutcome: (name: string, workflowId: string, stepId?: string, serves?: readonly VisionSentence[]) => Promise<string | null>;
  /** AA.1: an outcome on the project, citing the vision. The database homes
   *  it (below Indie there is no workflow to name). Resolves to its id. */
  fileOutcome: (name: string, serves: readonly VisionSentence[]) => Promise<{ id: string } | { error: string }>;
  /** AA.1: replace what an outcome cites. A citation is provenance, so a
   *  settled outcome takes it too; a dismissed one is terminal. */
  setServes: (candidateId: string, serves: readonly VisionSentence[]) => Promise<string | null>;
  /** AA.1: a requirement derives from an outcome the person picks (the
   *  attach: one human derivation claiming the outcome's unclaimed criteria;
   *  the outcome stays pending). */
  attachRequirement: (candidateId: string, requirementRowId: string) => Promise<string | null>;
  /** K.2 (owner's live report 2026-09-21): file an EXISTING requirement on a
   *  workflow's step. The alignment is outcome-mediated (the grouped view
   *  reads outcomes' derivations), so this writes the wrapper the model
   *  already understands: a candidate named after the requirement, filed on
   *  the step while pending (the terminal rule allows filing only then), a
   *  human derivation pointing at the requirement, and the settle. */
  fileRequirement: (requirement: { rowId: string; name: string; ref: string }, workflowId: string, stepId: string) => Promise<string | null>;
  /** 9.5: re-home every outcome of one lane into another (a lane delete's first step). */
  moveOutcomes: (fromWorkflowId: string, toWorkflowId: string) => Promise<string | null>;
  /** Toggle an outcome↔step map (branch-scoped, v3e). */
  toggleStepMap: (candidateId: string, stepId: string) => Promise<string | null>;
  /** Replace the candidate's draft criteria (the promotion gate's food).
   *  Ids survive; a criterion without one takes the existing criterion's id
   *  when the text matches, else a fresh uuid8 — same rule as the server. */
  setCriteria: (candidateId: string, criteria: Array<{ id?: string; text: string; verification?: string }>) => Promise<string | null>;
  /** Rename / re-describe a PENDING outcome (decided is terminal). */
  updateOutcome: (candidateId: string, changes: { name?: string; description?: string; mark?: string | null }) => Promise<string | null>;
}

export function useOutcomes(
  projectId: string | null | undefined,
  branchId: string | null | undefined,
  /** AC: the plan has Workflows. Below it no step map is read: steps do not exist there. */
  readSteps = true,
  /** AE.7: propose (a teammate) instead of writing a step map; the email names the proposal. */
  opts: { propose?: boolean; email?: string | null } = {},
): OutcomesApi {
  const proposing = !!opts.propose;
  const proposerEmail = opts.email ?? null;
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [maps, setMaps] = useState<OutcomeStepMapRow[]>([]);

  const refresh = useCallback(async () => {
    if (!projectId) { setOutcomes([]); setLoading(false); return; }
    try {
      const supabase = getSupabaseClient();
      const { data: cands, error: candErr } = await supabase
        .from('requirement_candidates')
        .select('id, name, description, category, kind, key, status, node_id, criteria, requirement_row_id, workflow_id, mark, evidence')
        .eq('project_id', projectId)
        .neq('status', 'dismissed');
      if (candErr) throw new Error(candErr.message);
      const rows = (cands ?? []) as CandidateItemRow[];

      let mapRows: OutcomeStepMapRow[] = [];
      if (readSteps && rows.length > 0) {
        const { data: sm, error: smErr } = await supabase
          .from('outcome_step_maps')
          .select('id, candidate_id, step_id')
          .in('candidate_id', rows.map((c) => c.id));
        if (smErr) throw new Error(smErr.message);
        mapRows = (sm ?? []) as OutcomeStepMapRow[];
      }

      // The live dot: active outcome-level holds (advisory drafting leases).
      const { data: leases } = await supabase
        .from('agent_checkouts')
        .select('candidate_id')
        .eq('project_id', projectId)
        .eq('level', 'outcome')
        .is('released_at', null);
      const liveIds = new Set(((leases ?? []) as Array<{ candidate_id: string | null }>)
        .map((l) => l.candidate_id).filter(Boolean) as string[]);

      // v3l: every derivation, one batch.
      let derivationRows: DerivationRow[] = [];
      if (rows.length > 0) {
        const { data: ders } = await supabase
          .from('outcome_derivations')
          .select('id, candidate_id, requirement_row_id, criteria_slice, proposed_by_kind, proposed_by_id, created_at')
          .in('candidate_id', rows.map((c) => c.id));
        derivationRows = (ders ?? []) as DerivationRow[];
      }

      // AL.7: the names of the keys that filed or derived these outcomes.
      const keyNames = new Map<string, string>();
      const keyIds = keyIdsNamed(rows, derivationRows);
      if (keyIds.length > 0) {
        const { data: keys } = await supabase.from('mcp_api_keys').select('id, name').in('id', keyIds);
        for (const k of (keys ?? []) as Array<{ id: string; name: string | null }>) if (k.name) keyNames.set(k.id, k.name);
      }

      // The design's ref chips: derived outcomes carry their REQ-NNNs.
      const reqRowIds = [...new Set([
        ...rows.map((c) => c.requirement_row_id).filter(Boolean) as string[],
        ...derivationRows.map((d) => d.requirement_row_id),
      ])];
      const reqRefById = new Map<string, string>();
      if (reqRowIds.length > 0) {
        const { data: reqs } = await supabase
          .from('specification_requirements')
          .select('id, requirement_id')
          .in('id', reqRowIds);
        for (const r of (reqs ?? []) as Array<{ id: string; requirement_id: string }>) {
          reqRefById.set(r.id, r.requirement_id);
        }
      }

      const derived = assembleDerivations(derivationRows, reqRefById);
      setMaps(mapRows);
      setOutcomes(rows.map((c) => {
        const d = derived.get(c.id) ?? { derivations: [], claimed: {} };
        return {
          ...c,
          workflowId: c.workflow_id ?? null,
          stepIds: mapRows.filter((m) => m.candidate_id === c.id).map((m) => m.step_id),
          live: liveIds.has(c.id),
          promoted: !!c.requirement_row_id || d.derivations.length > 0,
          reqRef: c.requirement_row_id ? (reqRefById.get(c.requirement_row_id) ?? null) : (d.derivations[0]?.reqRef ?? null),
          derivations: d.derivations,
          claimed: d.claimed,
          reqRefs: d.derivations.map((x) => x.reqRef).filter(Boolean) as string[],
          settled: c.status === 'accepted',
          serves: servesOf(c.evidence),
          agent: outcomeAgent(c.evidence, d.derivations, keyNames),
        };
      }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load outcomes');
    } finally {
      setLoading(false);
    }
  }, [projectId, readSteps]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const createOutcome = useCallback(async (name: string, workflowId: string, stepId?: string, serves?: readonly VisionSentence[]): Promise<string | null> => {
    if (!projectId || !branchId) return 'No project or branch.';
    if (!name.trim()) return 'An outcome needs a name.';
    // 9.5: an outcome is born into the lane that has focus — never homeless.
    if (!workflowId) return 'An outcome needs a workflow — create one first.';
    try {
      const supabase = getSupabaseClient();
      const { data: created, error: err } = await supabase.from('requirement_candidates').insert({
        project_id: projectId,
        branch_id: branchId,
        workflow_id: workflowId,
        node_id: null,
        key: `outcome:${crypto.randomUUID().slice(0, 8)}`,
        kind: 'outcome',
        name: name.trim(),
        description: '',
        category: 'functional',
        criteria: [],
        ...(serves && serves.length > 0 ? { evidence: { serves: serves.map((v) => ({ id: v.id, text: v.text })) } } : {}),
      }).select('id').single();
      if (err) return err.message;
      // V3 4.1: added from a step, it is filed on that step at birth.
      if (stepId && created?.id) {
        const { error: mapErr } = await supabase.from('outcome_step_maps').insert({ branch_id: branchId, candidate_id: created.id as string, step_id: stepId });
        if (mapErr) { await refresh(); return mapErr.message; }
      }
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Write failed';
    }
  }, [projectId, branchId, refresh]);

  const fileOutcome = useCallback(async (name: string, serves: readonly VisionSentence[]): Promise<{ id: string } | { error: string }> => {
    if (!projectId || !branchId) return { error: 'No project or branch.' };
    if (!name.trim()) return { error: 'An outcome needs a name.' };
    try {
      const { data: created, error: err } = await getSupabaseClient().from('requirement_candidates').insert({
        project_id: projectId,
        branch_id: branchId,
        node_id: null,
        key: `outcome:${crypto.randomUUID().slice(0, 8)}`,
        kind: 'outcome',
        name: name.trim(),
        description: '',
        category: 'functional',
        criteria: [],
        ...(serves.length > 0 ? { evidence: { serves: serves.map((v) => ({ id: v.id, text: v.text })) } } : {}),
      }).select('id').single();
      if (err || !created) return { error: err?.message ?? 'Could not file the outcome.' };
      await refresh();
      return { id: created.id as string };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Write failed' };
    }
  }, [projectId, branchId, refresh]);

  const setServes = useCallback(async (candidateId: string, serves: readonly VisionSentence[]): Promise<string | null> => {
    const current = outcomes.find((o) => o.id === candidateId);
    if (!current) return 'That outcome is gone. Refresh and try again.';
    const evidence = { ...(current.evidence ?? {}), serves: serves.map((v) => ({ id: v.id, text: v.text })) };
    try {
      const { error: err } = await getSupabaseClient()
        .from('requirement_candidates')
        .update({ evidence, updated_at: new Date().toISOString() })
        .eq('id', candidateId)
        .neq('status', 'dismissed');
      if (err) return err.message;
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Write failed';
    }
  }, [outcomes, refresh]);

  const attachRequirement = useCallback(async (candidateId: string, requirementRowId: string): Promise<string | null> => {
    if (!projectId || !branchId) return 'No project or branch.';
    try {
      const supabase = getSupabaseClient();
      // Read the row: an outcome filed a moment ago is not in this closure's state yet.
      const { data: row } = await supabase.from('requirement_candidates')
        .select('id, name, status, criteria, requirement_row_id')
        .eq('id', candidateId)
        .maybeSingle();
      const current = row as { id: string; name: string; status: string; criteria: unknown; requirement_row_id: string | null } | null;
      if (!current) return 'That outcome is gone. Refresh and try again.';
      if (current.status !== 'pending') return `"${current.name}" is closed: a closed outcome derives nothing more. Pick an open one, or file a new outcome.`;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 'Sign in to link a requirement.';
      const claimed = outcomes.find((o) => o.id === candidateId)?.claimed ?? {};
      const slice = identifiedFromRow(current.criteria).filter((k) => !claimed[k.id]);
      const { error: derErr } = await supabase.from('outcome_derivations').insert({
        project_id: projectId,
        branch_id: branchId,
        candidate_id: candidateId,
        requirement_row_id: requirementRowId,
        criteria_slice: slice,
        proposed_by_kind: 'human',
        proposed_by_id: user.id,
        via_proposal_id: null,
        approved_by: user.id,
      });
      if (derErr && derErr.code !== '23505') return derErr.message;
      // The first derivation freezes requirement_row_id; the outcome stays pending.
      if (!current.requirement_row_id) {
        const { error: markErr } = await supabase.from('requirement_candidates')
          .update({ requirement_row_id: requirementRowId, updated_at: new Date().toISOString() })
          .eq('id', candidateId);
        if (markErr) { await refresh(); return markErr.message; }
      }
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Write failed';
    }
  }, [projectId, branchId, outcomes, refresh]);

  // K.2: an existing requirement, aligned to a workflow's step by the person.
  // Order matters and is the one the terminal rule permits: the wrapper
  // candidate is filed on the step WHILE PENDING, the derivation records the
  // requirement it stands for, and only then does it settle. A failure after
  // the candidate exists deletes it (the map and derivation cascade), so a
  // half-filed requirement never lingers.
  const fileRequirement = useCallback(async (requirement: { rowId: string; name: string; ref: string }, workflowId: string, stepId: string): Promise<string | null> => {
    if (!projectId || !branchId) return 'No project or branch.';
    if (!workflowId || !stepId) return 'A requirement is filed on a workflow step.';
    try {
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 'Sign in to file a requirement.';

      // Already in this workflow? The list only offers unfiled requirements,
      // but two quick clicks race: ask the derivations before writing.
      const { data: priorDer } = await supabase
        .from('outcome_derivations')
        .select('candidate_id')
        .eq('requirement_row_id', requirement.rowId);
      const priorIds = ((priorDer ?? []) as Array<{ candidate_id: string }>).map((d) => d.candidate_id);
      if (priorIds.length > 0) {
        const { data: inLane } = await supabase
          .from('requirement_candidates')
          .select('id')
          .in('id', priorIds)
          .eq('workflow_id', workflowId)
          .limit(1);
        if ((inLane ?? []).length > 0) return `${requirement.ref} is already in this workflow.`;
      }

      // AA.1: the wrapper is a link of the chain, so it cites what the
      // requirement's outcomes already cite (none: the rail offers the pick).
      const inherited = new Map<string, VisionSentence>();
      for (const o of outcomes) {
        if (!o.derivations.some((d) => d.requirementRowId === requirement.rowId)) continue;
        for (const v of o.serves) if (!inherited.has(v.id)) inherited.set(v.id, v);
      }
      const { data: created, error: candErr } = await supabase.from('requirement_candidates').insert({
        project_id: projectId,
        branch_id: branchId,
        workflow_id: workflowId,
        node_id: null,
        key: `outcome:${crypto.randomUUID().slice(0, 8)}`,
        kind: 'outcome',
        name: requirement.name,
        description: '',
        category: 'functional',
        criteria: [],
        ...(inherited.size > 0 ? { evidence: { serves: [...inherited.values()].map((v) => ({ id: v.id, text: v.text })) } } : {}),
      }).select('id').single();
      if (candErr || !created) return candErr?.message ?? 'Could not file the requirement.';
      const candidateId = created.id as string;
      const undo = () => supabase.from('requirement_candidates').delete().eq('id', candidateId);

      const { error: mapErr } = await supabase.from('outcome_step_maps').insert({ branch_id: branchId, candidate_id: candidateId, step_id: stepId });
      if (mapErr) { await undo(); return mapErr.message; }

      const { error: derErr } = await supabase.from('outcome_derivations').insert({
        project_id: projectId,
        branch_id: branchId,
        candidate_id: candidateId,
        requirement_row_id: requirement.rowId,
        criteria_slice: [],
        proposed_by_kind: 'human',
        proposed_by_id: user.id,
        via_proposal_id: null,
        approved_by: user.id,
      });
      if (derErr) { await undo(); return derErr.message; }

      const { error: settleErr } = await supabase.from('requirement_candidates')
        .update({ status: 'accepted', requirement_row_id: requirement.rowId, decided_at: new Date().toISOString() })
        .eq('id', candidateId);
      // A failed settle leaves a PENDING wrapper whose derivation already
      // points at the requirement: the row still renders on its step, so
      // report it rather than tearing the filing down.
      await refresh();
      if (settleErr) return `${requirement.ref} is filed, but the wrapper outcome did not settle: ${settleErr.message}`;
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Write failed';
    }
  }, [projectId, branchId, outcomes, refresh]);

  /** 9.5: re-home every outcome of one lane into another — what a lane
   *  delete needs first (the database RESTRICTs a delete while any outcome
   *  calls the lane home). Step maps are untouched: a touch is not a home. */
  const moveOutcomes = useCallback(async (fromWorkflowId: string, toWorkflowId: string): Promise<string | null> => {
    if (!projectId) return 'No project.';
    if (fromWorkflowId === toWorkflowId) return null;
    try {
      const { error: err } = await getSupabaseClient()
        .from('requirement_candidates')
        .update({ workflow_id: toWorkflowId })
        .eq('project_id', projectId)
        .eq('workflow_id', fromWorkflowId);
      if (err) return err.message;
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Write failed';
    }
  }, [projectId, refresh]);

  const toggleStepMap = useCallback(async (candidateId: string, stepId: string): Promise<string | null> => {
    if (!branchId) return 'No branch.';
    // Decided is terminal for step maps too (v3t enforces it at the database in
    // every lane). Checking here is not the guarantee — it is how the board
    // says so without a round trip, and it keeps this hook honest for any
    // caller that is not the step pill.
    const candidate = outcomes.find((o) => o.id === candidateId);
    if (candidate && candidate.status !== 'pending') {
      return `This outcome is ${candidate.status} — decided outcomes keep the steps they were filed on. Create a new outcome to map different steps.`;
    }
    if (proposing) {
      // AE.7: the whole step set after the toggle, as set_outcome_step_maps takes it.
      if (!projectId) return 'No project open.';
      const mine = maps.filter((m) => m.candidate_id === candidateId).map((m) => m.step_id);
      const next = mine.includes(stepId) ? mine.filter((s) => s !== stepId) : [...mine, stepId];
      const explanation = `place the outcome "${candidate?.name ?? candidateId}" on ${next.length === 1 ? 'its step' : `${next.length} steps`}`;
      const r = await fileWorkflowProposal(projectId, [stepMaps({ candidateId, branchId, stepIds: next })], explanation, proposerEmail);
      if ('error' in r) return r.error;
      setNotice({ text: proposalNotice(explanation), at: Date.now() });
      return null;
    }
    try {
      const supabase = getSupabaseClient();
      const existing = maps.find((m) => m.candidate_id === candidateId && m.step_id === stepId);
      if (existing) {
        const { error: err } = await supabase.from('outcome_step_maps').delete().eq('id', existing.id);
        if (err) return err.message;
      } else {
        const { error: err } = await supabase.from('outcome_step_maps').insert({
          branch_id: branchId,
          candidate_id: candidateId,
          step_id: stepId,
        });
        if (err) return err.message;
      }
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Write failed';
    }
  }, [branchId, maps, outcomes, refresh, proposing, projectId, proposerEmail]);

  const setCriteria = useCallback(async (
    candidateId: string,
    criteria: Array<{ id?: string; text: string; verification?: string }>,
  ): Promise<string | null> => {
    try {
      const current = outcomes.find((o) => o.id === candidateId);
      const cleaned = identifyCriteria(criteria, Array.isArray(current?.criteria) ? current!.criteria! : []);
      const { error: err } = await getSupabaseClient()
        .from('requirement_candidates')
        .update({ criteria: cleaned, updated_at: new Date().toISOString() })
        .eq('id', candidateId)
        .eq('status', 'pending'); // decided candidates are terminal
      if (err) return err.message;
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Write failed';
    }
  }, [refresh, outcomes]);

  const updateOutcome = useCallback(async (
    candidateId: string,
    changes: { name?: string; description?: string; mark?: string | null },
  ): Promise<string | null> => {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    // 7.3: a mark change (Government) — the restrictive policy refuses a mark the user is not cleared for
    if (changes.mark !== undefined) payload.mark = changes.mark;
    if (changes.name !== undefined) {
      if (!changes.name.trim()) return 'An outcome needs a name.';
      payload.name = changes.name.trim();
    }
    if (changes.description !== undefined) payload.description = changes.description.trim();
    try {
      const { error: err } = await getSupabaseClient()
        .from('requirement_candidates')
        .update(payload)
        .eq('id', candidateId)
        .eq('status', 'pending');
      if (err) return err.message;
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Write failed';
    }
  }, [refresh]);

  return { proposing, notice, outcomes, loading, error, refresh, createOutcome, fileOutcome, setServes, attachRequirement, fileRequirement, moveOutcomes, toggleStepMap, setCriteria, updateOutcome };
}

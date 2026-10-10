// S1-3: the `projects` tool bucket (non-heavy) — list_projects,
// get_project_status, create_project. Moved verbatim from index.ts (no logic change),
// along with their internal helpers (computeNextAction for status; computeGraphHash +
// GRAPH_SCHEMA_VERSION + createEmptyGraphForProject for create). The assembly-heavy
// project reads (get_project_context, get_architecture_overview) stay in index.ts for the
// later heavy chunk. Structural supabase param + type-only SupabaseClient so it's
// offline-testable.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getEffectiveTier, getProjectTier, isExampleMetadata, ownersCarryingSeats } from "../../_shared/deployment.ts";
import { HOSTED_COMMUNITY_PROJECT_LIMIT } from "../../_shared/tiers.ts";
import { featureAllowed } from "../../_shared/feature-rules.ts";
// D4: the test-budget gauge is ONE shared function across every surface that
// shows it (this status response, report_test_results, the Work Board).
import { assessTestBudget, formatTestBudgetNudge } from "../../_shared/derive-status.ts";
// Owner bug 2026-08-23: the stored phase_status column goes stale on
// MCP/git-driven projects — the phase is DERIVED from live progress now.
import { deriveProjectPhase } from "../../_shared/project-phase.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";
import { findExistingTestArtifact } from "../../_shared/test-document-generator.ts";
import { liveStagedExplodes, loadPendingProposals, readStagedExplodes, stagedExplodeLead, type LiveStagedExplode } from "../../_shared/staged-explodes.ts";
import { importIntentLead, loadImportIntentState, readImportIntent, type ImportIntentState } from "../../_shared/staged-import-intent.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, isProjectRole, type ProjectRole } from "../shared.ts";

function computeNextAction(phaseStatus: string, reqCount: number, archNodeCount: number, testCount: number, hasVision: boolean): string {
  switch (phaseStatus) {
    case 'drafting_requirements':
      // R6 instruction stitching: the vision is the anchoring FIRST step — a
      // vision-less, requirement-less project must not be told to draft
      // requirements into a vacuum. No phase enum; the directive carries it.
      if (reqCount === 0 && !hasVision) return 'This project has no vision and no requirements. FIRST ask the USER for their vision — in their words, what this project is and why — and record it with update_vision. THEN draft requirements with create_requirement (or the user can draft them in the app) before designing architecture.';
      if (reqCount === 0) return 'No requirements yet. Create them with create_requirement (or the user can draft them in the app) before designing architecture.';
      return `Project has ${reqCount} requirement${reqCount !== 1 ? 's' : ''} ready for review. Refine them with update_requirement; the user confirms and locks them in the app. When the user is satisfied, design the architecture yourself and submit it with propose_patches (create contracts first, then nodes, then edges referencing them), then link nodes to the requirements they implement with map_requirement.`;
    case 'requirements_confirmed':
      return 'Requirements confirmed — design the architecture now. Read the full spec with list_requirements, then propose_patches the architecture: add_contract for each interaction, add_node for each component (one node per responsibility; every requirement should map to at least one node), add_edge to wire them (edges require a contractId). After approval, use map_requirement to make each requirement traceable to its implementing nodes.';
    case 'building_architecture':
      return 'Architecture is currently being generated. Wait for completion, then call get_project_status again.';
    case 'architecture_first':
      return `Architecture is populated with ${archNodeCount} node${archNodeCount !== 1 ? 's' : ''}. You can refine it directly, or enable the specification workflow to generate requirements and traceability.`;
    case 'architecture_confirmed':
      if (testCount === 0) return `Architecture is ready with ${archNodeCount} node${archNodeCount !== 1 ? 's' : ''}. Call get_build_readiness for the gap check and build order, get_project_context per node for the implementation brief, then get_test_plan per requirement and report every run via report_test_results — the evidence lane that flips acceptance criteria.`;
      return `Architecture is ready with ${archNodeCount} node${archNodeCount !== 1 ? 's' : ''} and ${testCount} test case${testCount !== 1 ? 's' : ''}. Call get_project_context for any node to get implementation context, then propose_patches to submit code.`;
    case 'generating_code':
      return `Build/verify loop underway (${archNodeCount} node${archNodeCount !== 1 ? 's' : ''}, ${testCount} test case${testCount !== 1 ? 's' : ''}). Call get_build_readiness for what remains, get_project_context per node for the brief, and keep reporting runs via report_test_results until every criterion is proven.`;
    default:
      return 'Call get_project_context for a specific node to get implementation context.';
  }
}

function computeGraphHash(obj: Record<string, unknown>): string {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// Mirrors src/domain/schemas.ts CURRENT_GRAPH_SCHEMA_VERSION and
// src/domain/utils.ts createEmptyGraph().
const GRAPH_SCHEMA_VERSION = 8;

function createEmptyGraphForProject(): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    schemaVersion: GRAPH_SCHEMA_VERSION,
    version: 0,
    hash: computeGraphHash({}),
    nodes: {},
    edges: {},
    contracts: {},
    artifacts: {},
    metadata: {},
  };
}

export async function handleListProjects(
  supabase: SupabaseClient,
  auth: AuthResult
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  // projects has no description column; the description lives in metadata.
  type Row = { id: string; name: string; metadata: Record<string, unknown> | null; created_at: string; updated_at: string };
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, metadata, created_at, updated_at')
    .eq('owner_id', auth.userId)
    .order('updated_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  // 7.0: the projects this account holds a seat on ride along, role per row;
  // only those whose owner's plan carries seats (below Team a project is its
  // owner's alone, owner 2026-09-26).
  const rows: Array<Row & { role: ProjectRole }> = ((data ?? []) as Row[]).map((p) => ({ ...p, role: 'owner' as const }));
  const { data: seats } = await supabase
    .from('project_members')
    .select('role, projects!inner(id, name, owner_id, metadata, created_at, updated_at)')
    .eq('user_id', auth.userId);
  const seatRows = (seats ?? []) as Array<{ role: unknown; projects: (Row & { owner_id?: string }) | null }>;
  const carried = seatRows.length > 0 ? await ownersCarryingSeats(supabase, seatRows.map((r) => r.projects?.owner_id ?? '')) : new Map();
  for (const seat of seatRows) {
    if (seat.projects && isProjectRole(seat.role) && carried.has(seat.projects.owner_id ?? '') && !rows.some((r) => r.id === seat.projects!.id)) {
      const { owner_id: _owner, ...project } = seat.projects;
      rows.push({ ...project, role: seat.role });
    }
  }
  rows.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));

  return {
    success: true,
    data: {
      projects: rows.map((p) => ({
        projectId: p.id,
        name: p.name,
        description: typeof p.metadata?.description === 'string' ? p.metadata.description : null,
        role: p.role,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
    },
  };
}

export async function handleGetProjectStatus(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  const { data: spec } = await supabase
    .from('project_specifications')
    .select('id, phase_status, vision')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const storedPhaseStatus = spec?.phase_status || 'drafting_requirements';
  // R6: the selected vision column finally gets read — the vision-first gate.
  const hasVision = !!(spec?.vision && String(spec.vision).trim());

  const { count: reqCount } = await supabase
    .from('specification_requirements')
    .select('id', { count: 'exact', head: true })
    .eq('specification_id', spec?.id || '00000000-0000-0000-0000-000000000000');

  const branches = await getPrimaryBranch(supabase, projectId, 'id, name, is_primary');

  let archNodeCount = 0;
  let staleTestPlanCount = 0;
  // AL.28: the artifacts, for the plan count below.
  let graphArtifacts: Record<string, { kind: string; path?: string; metadata?: Record<string, unknown> | null }> = {};
  // AE.6: the nodes, kept for the staged explode requests below.
  let graphNodes: Record<string, { id?: string; label?: string; parentId?: string | null }> | null = null;
  if (branches) {
    const { data: snapshot } = await supabase
      .from('graph_snapshots')
      .select('graph_data')
      .eq('branch_id', branches.id)
      .order('patch_sequence', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapshot?.graph_data?.nodes) {
      archNodeCount = Object.keys(snapshot.graph_data.nodes).length;
      graphNodes = snapshot.graph_data.nodes;
    }
    if (snapshot?.graph_data?.artifacts) {
      graphArtifacts = snapshot.graph_data.artifacts;
      for (const artifact of Object.values(snapshot.graph_data.artifacts) as Array<{ kind?: string; metadata?: { stale?: boolean } }>) {
        if (artifact.kind === 'test-plan') {
          // C4 Discovered #3: plan staleness truth is metadata.stale — owned by the
          // freshness lane and the source-change triggers. The old read looked for a
          // metadata.fingerprint key the generator never writes (it stamps
          // testContextFingerprint) and layered an age>7d heuristic on top; both lied.
          if (artifact.metadata?.stale === true) staleTestPlanCount++;
        }
      }
    }
  }

  // C4 Discovered #2: test_cases has NO specification_id column — the old filter
  // matched nothing (every count read 0 forever). Join through the spec's requirement
  // ROW ids: requirements by specification_id, then cases by requirement_id.
  // C4 Discovered #1: the staleness column is `stale`, not `is_stale`.
  let testCount = 0;
  let staleTestCaseCount = 0;
  let failedTestCaseCount = 0;
  const { data: reqRows } = await supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, acceptance_criteria')
    .eq('specification_id', spec?.id || '00000000-0000-0000-0000-000000000000');
  const specReqRows = (reqRows ?? []) as Array<{
    id: string;
    requirement_id: string;
    name?: string | null;
    acceptance_criteria: unknown;
  }>;
  // AL.28: a requirement has a plan when the lookup get_test_plan and
  // report_test_results use finds one. Counting every test-plan file said 16
  // while get_test_plan found none of them, and a second plan for one
  // requirement counted twice.
  const requirementsWithTestPlans = specReqRows.filter((r) =>
    !!r.requirement_id && !!findExistingTestArtifact(graphArtifacts, String(r.requirement_id), String(r.name ?? ''), String(r.id))
  ).length;
  const reqRowIds = specReqRows.map((r) => r.id);
  const testsByReqRow = new Map<string, number>();
  if (reqRowIds.length > 0) {
    const { data: caseRows } = await supabase
      .from('test_cases')
      .select('id, status, stale, requirement_id')
      .in('requirement_id', reqRowIds)
      .is('retired_at', null);
    for (const c of ((caseRows ?? []) as Array<{ status: string; stale: boolean; requirement_id: string }>)) {
      testCount++;
      if (c.stale === true) staleTestCaseCount++;
      if (c.status === 'failed') failedTestCaseCount++;
      testsByReqRow.set(c.requirement_id, (testsByReqRow.get(c.requirement_id) ?? 0) + 1);
    }
  }

  // D4: the sprawl gauge — tests-per-criterion, project-wide and per
  // requirement, with a consolidation nudge past the shared threshold. The
  // budget doctrine: one binding test per criterion is the evidence contract
  // (the smoke tier); deep-tier tests come after smoke reads green.
  let criteriaTotal = 0;
  const overTested: Array<{ requirementId: string; criteria: number; tests: number; testsPerCriterion: number | null }> = [];
  for (const req of specReqRows) {
    const criteria = Array.isArray(req.acceptance_criteria) ? req.acceptance_criteria.length : 0;
    criteriaTotal += criteria;
    const budget = assessTestBudget({ criteriaTotal: criteria, testsTotal: testsByReqRow.get(req.id) ?? 0 });
    if (budget.overBudget) {
      overTested.push({
        requirementId: req.requirement_id,
        criteria: budget.criteriaTotal,
        tests: budget.testsTotal,
        testsPerCriterion: budget.testsPerCriterion,
      });
    }
  }
  const projectBudget = assessTestBudget({ criteriaTotal, testsTotal: testCount });

  // The phase the response reports is DERIVED from live progress (the stored
  // wizard column is only a floor / plausibility-gated marker — see
  // _shared/project-phase.ts). storedPhaseStatus is surfaced whenever the
  // column lags so nothing is hidden.
  const phaseStatus = deriveProjectPhase({
    stored: storedPhaseStatus,
    reqCount: reqCount || 0,
    archNodeCount,
    testCount,
  });

  // R4 loop stitching: an out-of-band commit raises a pending card, and until now
  // the AI had no way to LEARN that from status — it only found out if the user
  // happened to mention it. Surfacing the count here (and directing the next action
  // at it) is what makes the reconciliation loop engaged rather than merely
  // available. Read-only: status never resolves anything.
  const { count: pendingChangeCount } = await supabase
    .from('git_change_events')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'pending');

  // Import-finalization stitching (owner bug 2026-08-11: the deterministic import
  // staged its draft and NOTHING routed the user's AI through finalization — the
  // lane existed but was unreachable from status). A staged/running import outranks
  // phase advice the same way pending changes do: an unfinalized draft means the
  // graph the phase advice reasons about does not exist yet.
  let stagedImportLead = '';
  // Owner audit 2026-08-13: the 'Import a specification' wizard lane used to
  // feed the internal agent; after inversion NOTHING routed it to the user's
  // AI — the project opened on an empty spec panel and the promise died. The
  // origin rides projects.metadata.workflowOrigin; while such a project has no
  // requirements, the status lead IS the trigger: the AI arriving over MCP
  // learns to ask for the document and convert it through the spec tools.
  // Owner spike 2026-09-04: the app's import window no longer converts the
  // document itself (that lane streamed to a retired agent endpoint). It
  // STAGES the document in projects.metadata.stagedSpecImport and the user is
  // told to have their AI call THIS tool: the document rides the response as
  // stagedSpecification, and the lead prescribes the conversion. Both the
  // staged lead and the bare-origin lead retire once requirements exist.
  // One read of the project's metadata serves both staged lanes: the spec
  // document (while there are no requirements) and the explode requests
  // (AE.6, at any phase).
  const { data: projRow } = await supabase
    .from('projects')
    .select('metadata')
    .eq('id', projectId)
    .maybeSingle();
  const projectMetadata = (projRow as { metadata?: Record<string, unknown> } | null)?.metadata ?? {};
  let specImportLead = '';
  let stagedSpecification: { text: string; chars: number; stagedAt: string | null } | null = null;
  if ((reqCount || 0) === 0) {
    const metadata = projectMetadata;
    const origin = metadata.workflowOrigin;
    const staged = readStagedSpecification(metadata);
    if (staged) {
      stagedSpecification = staged;
      specImportLead =
        `A SPECIFICATION DOCUMENT IS STAGED for import (${staged.chars} characters` +
        `${staged.stagedAt ? `, staged ${staged.stagedAt}` : ''}). It is in this response as ` +
        'stagedSpecification.text — do not ask the user to paste it again. Convert it FAITHFULLY now: ' +
        'update_vision with the document\'s intent (confirm the wording with the user), create_requirement ' +
        'for each requirement it contains with its acceptance criteria (criteria start unmet), ' +
        'relate_requirements where the document implies structure, and map_requirement once architecture ' +
        'exists. Do not invent content the document does not contain — gaps are questions for the user, ' +
        'not blanks to fill. ';
    } else if (origin === 'import-spec') {
      specImportLead =
        'This project was created to IMPORT AN EXISTING SPECIFICATION document. Ask the user to paste ' +
        'their spec/PRD into this chat, then convert it FAITHFULLY: update_vision with the document\'s ' +
        'intent (confirm the wording with the user), create_requirement for each requirement it contains ' +
        'with its acceptance criteria (criteria start unmet), relate_requirements where the document ' +
        'implies structure, and map_requirement once architecture exists. Do not invent content the ' +
        'document does not contain — gaps are questions for the user, not blanks to fill. ';
    }
  }
  // Q: repo import is Indie and above. Below it the status never points the
  // agent at run_repo_import (a job left from a paid period included).
  let importAllowed = false;
  let workflowsAllowed = false;
  try {
    const tier = await getProjectTier(supabase, projectId, auth.userId, { role: resolved.project.role });
    importAllowed = featureAllowed(tier, 'repo_import');
    workflowsAllowed = featureAllowed(tier, 'workflow_space');
  } catch { /* fail closed */ }
  const { data: importJobRow } = importAllowed
    ? await supabase
      .from('import_jobs')
      .select('id, status, stage, proposal_id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    : { data: null };
  const importJob = importJobRow as { id: string; status: string; stage: string | null; proposal_id: string | null } | null;
  if (importJob && archNodeCount === 0) {
    if (importJob.status === 'awaiting_review' && importJob.proposal_id) {
      stagedImportLead =
        'A repository import is staged awaiting FINALIZATION: a deterministic draft proposal exists but no judgment has been applied — call run_repo_import for the full package (frames, draft, signals, doctrine), answer its open questions, then call it again with a decisions object to promote it for the user. ';
    } else if (importJob.status === 'pending' || importJob.status === 'running') {
      stagedImportLead = `A repository import is waiting to be driven (stage: ${importJob.stage ?? 'starting'}) — call run_repo_import to advance it to the staged draft before designing by hand (missing from your tool list? reconnect the NodeSpec MCP server to refresh it). `;
    } else if (importJob.status === 'failed') {
      stagedImportLead = 'The last repository import FAILED — call run_repo_import for the error, then again with restart=true to retry, before designing by hand. ';
    }
  } else if (!importJob && importAllowed && archNodeCount === 0 && projectMetadata.workflowOrigin === 'code') {
    // AL.21 (owner 2026-10-03): the start card offers Import a repository
    // again. Choosing it records the origin; until a job exists the status
    // says what the import waits on: the repository, or the agent.
    const { data: repo } = await supabase
      .from('git_integrations')
      .select('repo_owner, repo_name')
      .eq('project_id', projectId)
      .maybeSingle();
    const r = repo as { repo_owner?: string; repo_name?: string } | null;
    stagedImportLead = r
      ? `This project was created to IMPORT A REPOSITORY, and ${r.repo_owner}/${r.repo_name} is connected. Call run_repo_import to start the import and follow each response's nextAction until the draft waits for the user's review. Do not design by hand meanwhile. `
      : 'This project was created to IMPORT A REPOSITORY, and none is connected yet. Ask the user to connect it in the app (the Git button in the toolbar), then call run_repo_import. Do not design by hand meanwhile. ';
  }

  // AE.6: the Expand button staged an explode request; the agent learns of it
  // here (MCP is not event driven). A request whose node is gone or already
  // exploded is not served; one the agent has proposed reads as waiting.
  let stagedExplodes: LiveStagedExplode[] = [];
  let explodeLead = '';
  // One read of the pending proposals serves both staged lanes, and their
  // patches are read only when the import intent needs them.
  const stagedIntent = importAllowed && workflowsAllowed ? readImportIntent(projectMetadata) : null;
  let pendingRead: Promise<Awaited<ReturnType<typeof loadPendingProposals>>> | null = null;
  const pendingProposals = () => (pendingRead ??= loadPendingProposals(supabase, projectId, { patches: !!stagedIntent }));
  {
    const staged = readStagedExplodes(projectMetadata);
    if (staged.length > 0 && graphNodes) {
      // A read that fails must not read as "nothing proposed": that would
      // ask the agent for the explode again. Say so and serve no lead.
      try {
        stagedExplodes = liveStagedExplodes(staged, graphNodes, await pendingProposals());
        explodeLead = stagedExplodeLead(stagedExplodes);
      } catch (err) {
        explodeLead = `The user asked from the canvas for ${staged.length === 1 ? 'a node' : `${staged.length} nodes`} to be exploded, but the pending proposals could not be read (${err instanceof Error ? err.message : String(err)}); call get_project_status again before proposing one. `;
      }
    }
  }

  // AL.21: what the person said they are here to do as they accepted the
  // import, until the agent has filed outcomes for it. Workflows and repo
  // import are both on the plan, or the answer is not served.
  let importIntent: ImportIntentState | null = null;
  let intentLead = '';
  if (stagedIntent) {
    try {
      importIntent = await loadImportIntentState(supabase, projectId, stagedIntent, pendingProposals);
      intentLead = importIntentLead(importIntent, hasVision);
    } catch (err) {
      intentLead = `The user chose what this import is for in the app, but it could not be read (${err instanceof Error ? err.message : String(err)}); call get_project_status again before asking them. `;
    }
  }

  // Pending reconciliation OUTRANKS the phase-based advice: designing further on
  // top of an unreconciled repository change is how the two sides diverge.
  const importLeads = `${stagedImportLead}${specImportLead}${intentLead}${explodeLead}`;
  const nextAction = (pendingChangeCount || 0) > 0
    ? `${importLeads}${pendingChangeCount} unreconciled repository change${pendingChangeCount !== 1 ? 's' : ''} detected. ` +
      'Call get_pending_changes FIRST: for each change, decide whether the repository or the design wins, ' +
      'bind any unattributed files to the node that owns them, then resolve_change. ' +
      'Reconcile before proposing further design work — building on an unreconciled change is what makes the two sides diverge. ' +
      `Then: ${computeNextAction(phaseStatus, reqCount || 0, archNodeCount, testCount || 0, hasVision)}`
    : importLeads
      ? `${importLeads}Then: ${computeNextAction(phaseStatus, reqCount || 0, archNodeCount, testCount || 0, hasVision)}`
      : computeNextAction(phaseStatus, reqCount || 0, archNodeCount, testCount || 0, hasVision);

  return {
    success: true,
    data: {
      projectName: resolved.project.name,
      phaseStatus,
      ...(phaseStatus !== storedPhaseStatus ? { storedPhaseStatus } : {}),
      hasSpecification: !!spec,
      /** R6: the vision-first gate — false directs the AI to ask the user and
       *  update_vision before drafting requirements. */
      hasVision,
      /** R4: unreconciled out-of-band repository changes awaiting a decision. */
      pendingRepositoryChanges: pendingChangeCount || 0,
      /** Owner spike 2026-09-04: the document the app's import window staged
       *  for conversion — present only while the project has no requirements. */
      ...(stagedSpecification ? { stagedSpecification } : {}),
      /** AE.6: the nodes the user asked from the canvas to explode into parts,
       *  each with the pending proposal that already answers it, if any. */
      ...(stagedExplodes.length > 0 ? { stagedExplodes } : {}),
      /** AL.21: what the user chose in the app as they accepted the import,
       *  and whether the agent has filed outcomes for it yet. */
      ...(importIntent ? { importIntent } : {}),
      counts: {
        requirements: reqCount || 0,
        architectureNodes: archNodeCount,
        testCases: testCount || 0,
      },
      testCoverage: {
        requirementsWithTestPlans,
        requirementsWithoutTestPlans: Math.max(0, (reqCount || 0) - requirementsWithTestPlans),
        requirementsWithGeneratedTests: testCount,
        staleTestPlans: staleTestPlanCount,
        staleTestCases: staleTestCaseCount,
        /** C4: the verification backlog's other half — failing cases need re-work, stale ones need re-runs. */
        failedTestCases: failedTestCaseCount,
      },
      /** D4: the test-budget gauge. One binding test per criterion is the
       *  evidence contract; "verified (smoke)" is a legitimate state. */
      testBudget: {
        policy: 'One binding test per acceptance criterion is the evidence contract (the smoke tier). ' +
          'Defer deep-tier tests until a requirement reads verified (smoke) on the board.',
        criteriaTotal,
        testCases: testCount,
        testsPerCriterion: projectBudget.testsPerCriterion,
        overTested,
        ...(overTested.length > 0
          ? {
            nudge: 'Test sprawl detected on ' +
              overTested.map((o) => `${o.requirementId} (${o.tests} tests / ${o.criteria} criteria)`).join(', ') +
              '. ' + formatTestBudgetNudge(projectBudget),
          }
          : {}),
      },
      nextAction,
    },
  };
}

/** The staged-document shape the app writes to projects.metadata.stagedSpecImport
 *  (src/ui/utils/spec-import-staging.ts is the writer). Tolerates anything else. */
export function readStagedSpecification(
  metadata: Record<string, unknown> | null | undefined,
): { text: string; chars: number; stagedAt: string | null } | null {
  const raw = metadata?.stagedSpecImport;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || !r.text.trim()) return null;
  return {
    text: r.text,
    chars: typeof r.chars === 'number' ? r.chars : r.text.length,
    stagedAt: typeof r.stagedAt === 'string' ? r.stagedAt : null,
  };
}

export async function handleCreateProject(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { name: string; description?: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'write')) {
    return { success: false, error: 'Insufficient permissions: write scope required' };
  }

  const name = (args.name || '').trim();
  if (!name) {
    return { success: false, error: 'Project name is required.' };
  }

  // Free-tier scale cap (owner ruling 2026-08-31 Stripe round: hosted Free
  // includes TWO projects — Indie unlocks unlimited; supersedes the
  // 1-project 2026-08-25 cap). Server-side because the UI check alone
  // would not bind the MCP surface. Admins are exempt, and a self-hosted
  // deployment lifts the cap entirely (NODESPEC_DEPLOYMENT is THE
  // deployment-mode flag — config, never a fork, per the SHIP-1 doctrine).
  const tier = await getEffectiveTier(supabase as never, auth.userId);
  if (tier === 'community' && Deno.env.get('NODESPEC_DEPLOYMENT') !== 'self-hosted') {
    // Admin is the account's app_metadata, which only the service sets; a person writes
    // their own user_settings row, so its is_admin column is no authority (RLS audit).
    const { data: who } = await supabase.auth.admin.getUserById(auth.userId);
    if (who?.user?.app_metadata?.is_admin !== true) {
      // The account's example project (AJ.6) is not counted.
      const { data: held } = await supabase
        .from('projects')
        .select('id, metadata')
        .eq('owner_id', auth.userId);
      const count = ((held ?? []) as Array<{ metadata?: unknown }>).filter((p) => !isExampleMetadata(p.metadata)).length;
      if (count >= HOSTED_COMMUNITY_PROJECT_LIMIT) {
        return {
          success: false,
          error:
            `Free accounts include ${HOSTED_COMMUNITY_PROJECT_LIMIT} projects and this account already has ${count}. ` +
            'Delete a project you no longer need, or upgrade to Indie for unlimited projects and repo import — https://nodespec.io/pricing',
        };
      }
    }
  }

  const { data: existing } = await supabase
    .from('projects')
    .select('id')
    .eq('owner_id', auth.userId)
    .eq('name', name)
    .maybeSingle();
  if (existing) {
    return { success: false, error: `A project named "${name}" already exists.` };
  }

  // Same creation sequence as the app (src/App.tsx handleCreateProject):
  // projects -> branches 'main' -> empty graph_snapshots -> link base_snapshot_id.
  const metadata: Record<string, unknown> = { workflowOrigin: 'idea', createdVia: 'mcp' };
  if (args.description) metadata.description = args.description;

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({ name, owner_id: auth.userId, metadata })
    .select('id, name')
    .single();
  if (projectError || !project) {
    return { success: false, error: `Failed to create project: ${projectError?.message || 'unknown error'}` };
  }

  const { data: branch, error: branchError } = await supabase
    .from('branches')
    .insert({
      is_primary: true, project_id: project.id, name: 'main', created_by: auth.userId, base_snapshot_id: null, metadata: {} })
    .select('id')
    .single();
  if (branchError || !branch) {
    await supabase.from('projects').delete().eq('id', project.id);
    return { success: false, error: `Failed to create main branch: ${branchError?.message || 'unknown error'}` };
  }

  const emptyGraph = createEmptyGraphForProject();
  const { data: snapshot, error: snapshotError } = await supabase
    .from('graph_snapshots')
    .insert({
      project_id: project.id,
      branch_id: branch.id,
      graph_data: emptyGraph,
      version: 0,
      hash: emptyGraph.hash,
      patch_sequence: 0,
    })
    .select('id')
    .single();
  if (snapshotError || !snapshot) {
    await supabase.from('branches').delete().eq('id', branch.id);
    await supabase.from('projects').delete().eq('id', project.id);
    return { success: false, error: `Failed to create initial snapshot: ${snapshotError?.message || 'unknown error'}` };
  }

  await supabase.from('branches').update({ base_snapshot_id: snapshot.id }).eq('id', branch.id);

  return {
    success: true,
    data: {
      projectId: project.id,
      name: project.name,
      branchId: branch.id,
      message: `Project "${project.name}" created with an empty canvas on branch "main". Use create_requirement to start the specification.`,
    },
  };
}

// S1-3: the `projects` tool bucket (non-heavy) — list_projects, list_branches,
// get_project_status, create_project. Moved verbatim from index.ts (no logic change),
// along with their internal helpers (computeNextAction for status; computeGraphHash +
// GRAPH_SCHEMA_VERSION + createEmptyGraphForProject for create). The assembly-heavy
// project reads (get_project_context, get_architecture_overview) stay in index.ts for the
// later heavy chunk. Structural supabase param + type-only SupabaseClient so it's
// offline-testable.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getEffectiveTier } from "../../_shared/deployment.ts";
import { HOSTED_COMMUNITY_PROJECT_LIMIT } from "../../_shared/tiers.ts";
// D4: the test-budget gauge is ONE shared function across every surface that
// shows it (this status response, report_test_results, the Work Board).
import { assessTestBudget, formatTestBudgetNudge } from "../../_shared/derive-status.ts";
// Owner bug 2026-08-23: the stored phase_status column goes stale on
// MCP/git-driven projects — the phase is DERIVED from live progress now.
import { deriveProjectPhase } from "../../_shared/project-phase.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName } from "../shared.ts";

function computeNextAction(phaseStatus: string, reqCount: number, archNodeCount: number, testCount: number, hasVision: boolean): string {
  switch (phaseStatus) {
    case 'drafting_requirements':
      // R6 instruction stitching: the vision is the anchoring FIRST step — a
      // vision-less, requirement-less project must not be told to draft
      // requirements into a vacuum. No phase enum; the directive carries it.
      if (reqCount === 0 && !hasVision) return 'This project has no vision and no requirements. FIRST ask the USER for their vision — in their words, what this project is and why — and record it with update_vision. THEN draft requirements with create_requirement (or the user can draft them in the app) before designing architecture.';
      if (reqCount === 0) return 'No requirements yet. Create them with create_requirement (or the user can draft them in the app) before designing architecture.';
      return `Project has ${reqCount} requirement${reqCount !== 1 ? 's' : ''} ready for review. Refine them with update_requirement and lock finalized ones with set_requirement_lock. When the user is satisfied, design the architecture yourself and submit it with propose_patches (create contracts first, then nodes, then edges referencing them), then link nodes to the requirements they implement with map_requirement.`;
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
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, metadata, created_at, updated_at')
    .eq('owner_id', auth.userId)
    .order('updated_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: {
      projects: data.map((p: { id: string; name: string; metadata: Record<string, unknown> | null; created_at: string; updated_at: string }) => ({
        projectId: p.id,
        name: p.name,
        description: typeof p.metadata?.description === 'string' ? p.metadata.description : null,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
    },
  };
}

export async function handleListBranches(
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

  const { data: branches, error } = await supabase
    .from('branches')
    .select('id, name, created_at, is_primary')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: {
      branches: branches.map((b: { id: string; name: string; created_at: string; is_primary?: boolean | null }) => ({
        branchId: b.id,
        name: b.name,
        // Identity, not naming: the trunk may be renamed to its bound git
        // branch at connect (legacy rows without the flag keep the old rule).
        isMain: b.is_primary === true || (b.is_primary == null && b.name === 'main'),
        createdAt: b.created_at,
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
  let testPlanArtifactCount = 0;
  let staleTestPlanCount = 0;
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
    }
    if (snapshot?.graph_data?.artifacts) {
      for (const artifact of Object.values(snapshot.graph_data.artifacts) as Array<{ kind?: string; metadata?: { stale?: boolean } }>) {
        if (artifact.kind === 'test-plan') {
          testPlanArtifactCount++;
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
    .select('id, requirement_id, acceptance_criteria')
    .eq('specification_id', spec?.id || '00000000-0000-0000-0000-000000000000');
  const specReqRows = (reqRows ?? []) as Array<{
    id: string;
    requirement_id: string;
    acceptance_criteria: unknown;
  }>;
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
  let specImportLead = '';
  if ((reqCount || 0) === 0) {
    const { data: projRow } = await supabase
      .from('projects')
      .select('metadata')
      .eq('id', projectId)
      .maybeSingle();
    const origin = (projRow as { metadata?: { workflowOrigin?: string } } | null)?.metadata?.workflowOrigin;
    if (origin === 'import-spec') {
      specImportLead =
        'This project was created to IMPORT AN EXISTING SPECIFICATION document. Ask the user to paste ' +
        'their spec/PRD into this chat, then convert it FAITHFULLY: update_vision with the document\'s ' +
        'intent (confirm the wording with the user), create_requirement for each requirement it contains ' +
        'with its acceptance criteria (criteria start unmet), relate_requirements where the document ' +
        'implies structure, and map_requirement once architecture exists. Do not invent content the ' +
        'document does not contain — gaps are questions for the user, not blanks to fill. ';
    }
  }
  const { data: importJobRow } = await supabase
    .from('import_jobs')
    .select('id, status, stage, proposal_id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
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
  }

  // Pending reconciliation OUTRANKS the phase-based advice: designing further on
  // top of an unreconciled repository change is how the two sides diverge.
  const importLeads = `${stagedImportLead}${specImportLead}`;
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
      counts: {
        requirements: reqCount || 0,
        architectureNodes: archNodeCount,
        testCases: testCount || 0,
      },
      testCoverage: {
        requirementsWithTestPlans: testPlanArtifactCount,
        requirementsWithoutTestPlans: (reqCount || 0) - testPlanArtifactCount,
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

  // Community-tier scale cap (owner ruling 2026-08-25, open-core GTM: hosted
  // community includes ONE project — Indie unlocks unlimited; supersedes the
  // 3-project 2026-08-12 design). Server-side because the UI check alone
  // would not bind the MCP surface. Admins are exempt, and a self-hosted
  // deployment lifts the cap entirely (NODESPEC_DEPLOYMENT is THE
  // deployment-mode flag — config, never a fork, per the SHIP-1 doctrine).
  const tier = await getEffectiveTier(supabase, auth.userId);
  if (tier === 'community' && Deno.env.get('NODESPEC_DEPLOYMENT') !== 'self-hosted') {
    const { data: settings } = await supabase
      .from('user_settings')
      .select('is_admin')
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (settings?.is_admin !== true) {
      const { count } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', auth.userId);
      if ((count ?? 0) >= HOSTED_COMMUNITY_PROJECT_LIMIT) {
        return {
          success: false,
          error:
            `Community accounts include ${HOSTED_COMMUNITY_PROJECT_LIMIT} project and this account already has ${count}. ` +
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

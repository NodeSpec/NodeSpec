// S1-3 chunk 6: the heavy assembly *read* bucket — get_project_context, get_test_plan,
// get_architecture_overview. Moved verbatim from index.ts (no logic change). These call the
// _shared assembly modules (mcp-context-assembly, mcp-overview-assembly) + loadCatalogs, all
// edge-safe. Structural supabase param + type-only SupabaseClient so the module is
// offline-testable; the assembly reads themselves are bench-verified (their DB-shape goldens
// are brittle to stub), so the FakeSupabase coverage here is scope/guard-focused.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { assembleContextForTarget, findStoredTestDocument, ensureTestDocumentForRequirement } from "../../_shared/mcp-context-assembly.ts";
import { assembleArchitectureOverview } from "../../_shared/mcp-overview-assembly.ts";
import { loadCatalogs } from "../../_shared/catalog-loader.ts";
import { PatchOperationSchema } from "../../_shared/patch-schema.ts";
// WS1 read purity: get_project_context reports stored test-plan STATE only — the
// rename-proof lookup is the only piece of the test-doc module it needs. WS3:
// get_test_plan additionally reports contractSchemaGaps (the shared readiness
// predicate over the mapped nodes' contracts) as schemaBlockedContracts.
import { findExistingTestArtifact, contractSchemaGaps } from "../../_shared/test-document-generator.ts";
// P0-7: mcp-server-exclusive return path — allowed to wrap (see untrusted-data.ts).
import { wrapField } from "../../_shared/untrusted-data.ts";
import { phaseAtLeast } from "../../_shared/project-phase.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName } from "../shared.ts";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

interface RequirementRow {
  id: string;
  requirement_id: string;
  name: string;
  description: string | null;
  category: string;
  status: string;
  acceptance_criteria: Array<{ text: string; met?: boolean; verification?: string }> | null;
  specification_id: string;
}

interface AssembledTestPlan {
  content: string;
  fingerprint: unknown;
  isNew: boolean;
  stale: boolean;
  mappedNodeIds: string[];
  /** WS3 plans-follow-schemas: contracts on the mapped nodes with no resolvable
   *  schema — the plan's scenarios for them are [blocked by schema: …] one-liners.
   *  Same predicate as get_build_readiness (shared contractSchemaGaps helper). */
  schemaBlockedContracts: string[];
  testCaseSummary: { total: number; passed: number; failed: number; stale: number };
  /** C4 step 1: set when a freshly generated plan was parked as a pending proposal. */
  proposalId?: string;
  persistNote?: string;
}

// C4 step 1: the ONE requirement-scoped test-plan assembly — get_test_plan's lane
// (WS1 read purity moved get_project_context's requirement branch to a stored-state
// summary; generation + parking happen ONLY here). When no stored
// plan exists the generated one no longer evaporates with the response: it is parked as
// a single pending proposal in the handleGenerateTaskDocs mold (add_artifact
// kind 'test-plan' + companion update_node link), so acceptance persists it into the
// graph where git-push and the freshness gate can see it. Persistence is best-effort —
// this is a READ tool, so a failed proposal insert degrades to today's behavior
// (content still returned) rather than failing the read.
async function assembleTestPlanForRequirement(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  branchId: string,
  requirement: RequirementRow,
): Promise<AssembledTestPlan> {
  const { data: snapshot } = await supabase
    .from('graph_snapshots')
    .select('graph_data')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const graphData = snapshot?.graph_data || { nodes: {}, edges: {}, contracts: {}, artifacts: {} };

  const { data: mappings } = await supabase
    .from('specification_mappings')
    .select('node_id')
    .eq('requirement_id', requirement.id)
    .eq('specification_id', requirement.specification_id);

  const mappedNodeIds = (mappings || []).map((m: { node_id: string }) => m.node_id);

  const stored = findStoredTestDocument(graphData, requirement.requirement_id, requirement.name);

  let content: string;
  let fingerprint: unknown;
  let isNew = false;
  let stale = false;
  let proposalId: string | undefined;
  let persistNote: string | undefined;

  if (stored) {
    content = stored.content;
    fingerprint = stored.fingerprint;
    stale = stored.stale || false;
  } else {
    const catalogs = await loadCatalogs(supabase);
    const result = ensureTestDocumentForRequirement(
      graphData,
      catalogs,
      {
        requirementId: requirement.requirement_id,
        name: requirement.name,
        description: requirement.description || '',
        category: requirement.category,
        status: requirement.status,
        acceptanceCriteria: requirement.acceptance_criteria || [],
      },
      mappedNodeIds,
      undefined,
    );
    content = result.content;
    fingerprint = result.fingerprint;
    isNew = result.isNew;

    if (result.isNew && result.rawContent && result.path) {
      const persisted = await persistGeneratedTestPlan(
        supabase, auth, projectId, branchId, requirement, graphData as AnyRecord,
        mappedNodeIds, result.rawContent, result.path, result.fingerprint,
      );
      if (persisted) {
        proposalId = persisted;
        persistNote = 'This plan was generated fresh and parked as a pending proposal — it persists (and ships on push) once the proposal is accepted in NodeSpec.';
      }
    }
  }

  // C4 Discovered #1: the column is `stale` — `is_stale` does not exist on
  // test_cases, so this select errored and the summary silently read empty.
  const { data: testCases } = await supabase
    .from('test_cases')
    .select('id, status, stale')
    .eq('requirement_id', requirement.id)
    .is('retired_at', null);

  const cases = testCases || [];
  return {
    content,
    fingerprint,
    isNew,
    stale,
    mappedNodeIds,
    // deno-lint-ignore no-explicit-any
    schemaBlockedContracts: contractSchemaGaps(graphData as any, mappedNodeIds).map((g) => g.contractName),
    testCaseSummary: {
      total: cases.length,
      passed: cases.filter((t: { status: string }) => t.status === 'passed').length,
      failed: cases.filter((t: { status: string }) => t.status === 'failed').length,
      stale: cases.filter((t: { stale: boolean }) => t.stale).length,
    },
    proposalId,
    persistNote,
  };
}

// The persistence half, mirroring handleGenerateTaskDocs: one add_artifact patch
// carrying the deterministic content + fingerprint (+ requirementId, the rename-proof
// lookup key), a companion update_node appending the artifact to the primary mapped
// node's artifact list when that node exists, schema-validated, recorded as an
// ai_runs/ai_proposals pair under the 'test-plan-generator' actor. Returns the
// proposalId, or null when persistence was not possible (best-effort).
async function persistGeneratedTestPlan(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  branchId: string,
  requirement: RequirementRow,
  graphData: AnyRecord,
  mappedNodeIds: string[],
  rawContent: string,
  path: string,
  fingerprint: unknown,
): Promise<string | null> {
  try {
    const now = new Date().toISOString();
    const artifactId = crypto.randomUUID();
    const primaryNodeId = mappedNodeIds[0];
    const primaryNode = primaryNodeId ? (graphData.nodes ?? {})[primaryNodeId] : undefined;

    const meta = (summary: string) => ({
      id: crypto.randomUUID(),
      timestamp: now,
      actorType: 'system',
      actorId: 'test-plan-generator',
      summary,
    });

    const patches: AnyRecord[] = [{
      type: 'add_artifact',
      metadata: meta(`Generate test plan for ${requirement.name}`),
      payload: {
        id: artifactId,
        nodeId: primaryNodeId ?? '',
        kind: 'test-plan',
        path,
        content: rawContent,
        language: 'markdown',
        status: 'draft',
        description: `Test plan for requirement: ${requirement.name}`,
        createdAt: now,
        updatedAt: now,
        metadata: { testContextFingerprint: fingerprint, requirementId: requirement.requirement_id },
      },
    }];
    const explanations: string[] = [
      `Generated test plan for ${requirement.requirement_id} (${requirement.name}): acceptance-criteria scenarios, contract validation tests, and framework guidance`,
    ];

    if (primaryNode) {
      const currentLinks = Array.isArray(primaryNode.artifacts) ? primaryNode.artifacts : [];
      patches.push({
        type: 'update_node',
        metadata: meta(`Link test plan to ${primaryNode.label}`),
        payload: { id: primaryNodeId, changes: { artifacts: [...currentLinks, artifactId] } },
      });
      explanations.push(`Link the test plan artifact to ${primaryNode.label}`);
    }

    // Defensive, same as the task-doc lane: the generator's output must satisfy the
    // schema the apply pipeline enforces — refuse to park an unappliable proposal.
    for (const p of patches) {
      if (!PatchOperationSchema.safeParse(p).success) return null;
    }

    const aiRunId = crypto.randomUUID();
    const { error: runError } = await supabase.from('ai_runs').insert({
      id: aiRunId, project_id: projectId, branch_id: branchId,
      model: 'test-plan-generator', prompt_hash: 'mcp-test-plan', status: 'completed',
      completed_at: now,
      metadata: { source: 'mcp-test-plan', requirementId: requirement.requirement_id, patchCount: patches.length, authMethod: auth.authMethod, apiKeyId: auth.keyId || null },
    });
    if (runError) return null;

    const proposalId = crypto.randomUUID();
    const { error: proposalError } = await supabase.from('ai_proposals').insert({
      id: proposalId, ai_run_id: aiRunId,
      source_branch_id: branchId, proposal_branch_id: branchId,
      status: 'pending',
      patches: patches.map((patch, i) => ({ patch, status: 'pending', explanation: explanations[i] ?? patch.metadata.summary })),
      validation_expectations: [],
      metadata: { source: 'mcp-test-plan', requirementId: requirement.requirement_id, authMethod: auth.authMethod, apiKeyId: auth.keyId || null },
    });
    if (proposalError) return null;

    return proposalId;
  } catch (_err) {
    return null;
  }
}

export async function handleGetProjectContext(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id: string; target_type: string; target_id: string; view?: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  if (!args.project_id || !args.branch_id || !args.target_type || !args.target_id) {
    return { success: false, error: 'project_id, branch_id, target_type, and target_id are required' };
  }

  // WS1 views (owner-measured ~33k tokens/call — the task doc used to ship up to
  // THREE times: context.promptDocument, the top-level re-emit, and the task
  // artifact's contentPreview). brief (default) = the build brief alone; structured =
  // machine-readable model truth, schemas as presence/preview/hash, NO prompt
  // document; full = structured with complete schema bodies + the document exactly
  // ONCE at top level.
  const view = args.view ?? 'brief';
  if (view !== 'brief' && view !== 'structured' && view !== 'full') {
    return { success: false, error: "view must be one of 'brief' | 'structured' | 'full'" };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', args.branch_id)
    .eq('project_id', projectId)
    .maybeSingle();

  if (!branch) {
    return { success: false, error: 'Branch not found' };
  }

  const context = await assembleContextForTarget(
    supabase,
    projectId,
    args.branch_id,
    args.target_type,
    args.target_id,
    auth.userId
  );

  const { data: spec } = await supabase
    .from('project_specifications')
    .select('phase_status')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Owner bug 2026-08-23: the stored wizard column goes stale on MCP/git-
  // driven projects. This call RESOLVED a concrete architecture-plane target
  // — that is itself evidence the project is past drafting, so the phase is
  // floored there instead of parroting the column. (Requirement targets
  // carry no such evidence; the stored value stands, and get_project_status
  // does the full live derivation.)
  const storedPhase = spec?.phase_status || 'drafting_requirements';
  const phaseStatus = args.target_type === 'requirement'
    ? storedPhase
    : phaseAtLeast(storedPhase, 'architecture_confirmed');

  let testPlan: {
    exists: boolean;
    path?: string;
    stale?: boolean;
    fingerprint?: unknown;
    testCaseSummary: { total: number; passed: number; failed: number; stale: number };
    note: string;
  } | undefined;
  let requirementLabel: string | undefined;

  if (args.target_type === 'requirement') {
    const { data: requirement } = await supabase
      .from('specification_requirements')
      .select('id, requirement_id, name, description, category, status, acceptance_criteria, specification_id')
      .eq('id', args.target_id)
      .maybeSingle();

    if (requirement) {
      requirementLabel = wrapField(String(requirement.name ?? requirement.requirement_id));
      // WS1 READ PURITY: a context read reports stored-plan STATE only — it never
      // generates a plan and never parks a proposal (a read that writes surprised the
      // owner's live run). C4 generation + proposal parking stay in get_test_plan
      // (assembleTestPlanForRequirement), which remains the lane for the plan body.
      const { data: snapshot } = await supabase
        .from('graph_snapshots')
        .select('graph_data')
        .eq('branch_id', args.branch_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const artifacts = ((snapshot?.graph_data as AnyRecord | undefined)?.artifacts ?? {}) as Record<
        string,
        { kind: string; path?: string; content?: string; metadata?: Record<string, unknown> | null }
      >;
      const stored = findExistingTestArtifact(artifacts, String(requirement.requirement_id), String(requirement.name ?? ''));

      const { data: testCases } = await supabase
        .from('test_cases')
        .select('id, status, stale')
        .eq('requirement_id', requirement.id)
        .is('retired_at', null);
      const cases = testCases || [];

      testPlan = {
        exists: !!stored,
        ...(stored
          ? {
            path: stored.path,
            stale: (stored.metadata as AnyRecord | undefined)?.stale === true,
            fingerprint: (stored.metadata as AnyRecord | undefined)?.testContextFingerprint,
          }
          : {}),
        testCaseSummary: {
          total: cases.length,
          passed: cases.filter((t: { status: string }) => t.status === 'passed').length,
          failed: cases.filter((t: { status: string }) => t.status === 'failed').length,
          stale: cases.filter((t: { stale: boolean }) => t.stale).length,
        },
        note: 'Plan state only — call get_test_plan for the full plan (it also generates and parks one as a pending proposal when none is stored).',
      };
    }
  }

  const processHints = {
    currentPhase: phaseStatus,
    nextStep: phaseStatus === 'drafting_requirements'
      ? 'Requirements are still being drafted. Review and refine them with create_requirement / update_requirement, lock finalized ones with set_requirement_lock, then design the architecture yourself and submit it via propose_patches (contracts first, then nodes, then edges), linking nodes to requirements with map_requirement.'
      : phaseStatus === 'architecture_confirmed' || phaseStatus === 'generating_code' || phaseStatus === 'architecture_first'
        ? 'Use the promptDocument (view brief/full) as the implementation brief. Submit code via propose_patches when ready.'
        : 'Architecture is being set up. Call get_project_status to check progress.',
  };

  // D1: promptDocument is never re-emitted inside context — one copy max, top-level.
  const { promptDocument, ...modelContext } = context;

  if (view === 'brief') {
    return {
      success: true,
      data: {
        view,
        target: {
          id: context.target.node?.id ?? args.target_id,
          label: context.target.node?.label ?? requirementLabel ?? args.target_id,
          type: args.target_type,
        },
        promptDocument,
        ...(testPlan ? { testPlan } : {}),
        processHints,
        untrustedDataAdvisory: context.untrustedDataAdvisory,
      },
    };
  }

  if (view === 'structured' && modelContext.target.node) {
    // Schemas travel as presence/preview/hash in structured; the body is full-only.
    modelContext.target.node = {
      ...modelContext.target.node,
      contracts: modelContext.target.node.contracts.map((c) => ({ ...c, schemaContent: null })),
    };
  }

  return {
    success: true,
    data: {
      view,
      context: modelContext,
      ...(view === 'full' ? { promptDocument } : {}),
      ...(testPlan ? { testPlan } : {}),
      processHints,
    },
  };
}

export async function handleGetTestPlan(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id: string; requirement_id: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  if (!args.project_id || !args.branch_id || !args.requirement_id) {
    return { success: false, error: 'project_id, branch_id, and requirement_id are required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  const { data: requirement } = await supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, description, category, status, acceptance_criteria, specification_id')
    .eq('id', args.requirement_id)
    .maybeSingle();

  if (!requirement) {
    return { success: false, error: 'Requirement not found' };
  }

  const assembled = await assembleTestPlanForRequirement(supabase, auth, projectId, args.branch_id, requirement as RequirementRow);

  return {
    success: true,
    data: {
      requirementId: requirement.requirement_id,
      requirementName: requirement.name,
      testPlanContent: assembled.content,
      testPlanIsNew: assembled.isNew,
      testPlanStale: assembled.stale,
      fingerprint: assembled.fingerprint,
      mappedNodeCount: assembled.mappedNodeIds.length,
      // WS3 plans-follow-schemas: the gap list (shared readiness predicate) + the
      // one-line ordering doctrine, so the caller never has to infer either from prose.
      schemaBlockedContracts: assembled.schemaBlockedContracts,
      doctrine: 'Plans follow schemas (contract-first TDD): resolve schemaBlockedContracts first via get_build_readiness draftInputs + propose_patches update_contract (the plan refreshes itself), then implement and run the automated scenarios and report every outcome via report_test_results; manual criteria are proven via the task-doc tick + user approval, never test results.',
      testCaseSummary: assembled.testCaseSummary,
      // C4 step 1: a fresh generation no longer evaporates — it is parked as a pending
      // proposal; the plan persists into the graph when that proposal is accepted.
      ...(assembled.proposalId ? { proposalId: assembled.proposalId, note: assembled.persistNote } : {}),
    },
  };
}

export async function handleGetArchitectureOverview(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id?: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  if (!args.project_id) {
    return { success: false, error: 'project_id is required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  let branchId = args.branch_id;
  let branchName = 'main';

  if (!branchId) {
    const mainBranch = await getPrimaryBranch(supabase, projectId, 'id, name, is_primary');

    if (!mainBranch) {
      return { success: false, error: 'No primary branch found for this project' };
    }
    branchId = mainBranch.id;
    branchName = mainBranch.name;
  } else {
    const { data: branch } = await supabase
      .from('branches')
      .select('id, name')
      .eq('id', branchId)
      .eq('project_id', projectId)
      .maybeSingle();

    if (!branch) {
      return { success: false, error: 'Branch not found' };
    }
    branchName = branch.name;
  }

  // N4.1: catalogs are optional — altitude enrichment only; the overview must not fail
  // if the catalog read does.
  const catalogs = await loadCatalogs(supabase).catch(() => undefined);
  const overview = await assembleArchitectureOverview(supabase, projectId, branchId, catalogs);
  if (!overview) {
    return {
      success: true,
      data: {
        projectName: resolved.project.name,
        branchName,
        summary: { totalNodes: 0, totalEdges: 0, totalContracts: 0, roleDistribution: {} },
        nodes: [],
        edges: [],
        containers: [],
        completeness: [],
        mermaid: 'graph LR\n  empty["No architecture yet"]',
      },
    };
  }

  return {
    success: true,
    data: {
      projectName: resolved.project.name,
      branchName,
      ...overview,
    },
  };
}

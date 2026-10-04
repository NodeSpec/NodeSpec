// S1-3 chunk 6: the heavy assembly *read* bucket — get_project_context, get_test_plan,
// get_architecture_overview. Moved verbatim from index.ts (no logic change). These call the
// _shared assembly modules (mcp-context-assembly, mcp-overview-assembly) + loadCatalogs, all
// edge-safe. Structural supabase param + type-only SupabaseClient so the module is
// offline-testable; the assembly reads themselves are bench-verified (their DB-shape goldens
// are brittle to stub), so the FakeSupabase coverage here is scope/guard-focused.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { assembleContextForTarget, findStoredTestDocument, ensureTestDocumentForRequirement, loadGraphData, resolveNodeFromGraph } from "../../_shared/mcp-context-assembly.ts";
import {
  approxTokens, buildNodeSlice, byDesignLeftOut, deltaSince, fitToBudget, loadSliceInputs, parseSliceFingerprint,
  sectionHashes, sizeOf, sliceFingerprint, type LeftOut, type NodeSlice, type SliceGraph,
} from "../../_shared/node-slice.ts";
import { assembleArchitectureOverview } from "../../_shared/mcp-overview-assembly.ts";
import { loadCatalogs, type CatalogData } from "../../_shared/catalog-loader.ts";
import { PatchOperationSchema } from "../../_shared/patch-schema.ts";
// WS1 read purity: get_project_context reports stored test-plan STATE only — the
// rename-proof lookup is the only piece of the test-doc module it needs. WS3:
// get_test_plan additionally reports contractSchemaGaps (the shared readiness
// predicate over the mapped nodes' contracts) as schemaBlockedContracts.
import { findExistingTestArtifact, contractSchemaGaps } from "../../_shared/test-document-generator.ts";
// P0-7: mcp-server-exclusive return path — allowed to wrap (see untrusted-data.ts).
import { UNTRUSTED_ADVISORY, wrapField, wrapFieldNullable } from "../../_shared/untrusted-data.ts";
import { phaseAtLeast } from "../../_shared/project-phase.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";
import { liveStagedExplodes, readStagedExplodes } from "../../_shared/staged-explodes.ts";
import { explodesIntoTableGroups } from "./explode-context.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, resolveBranchId, holderIdentity, UUID_RE, credentialOf } from "../shared.ts";
import { getProjectTier } from "../../_shared/deployment.ts";
import { featureAllowed } from "../../_shared/feature-rules.ts";

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
  /** Dogfood #3: true when the stored plan's fingerprint no longer matched the
   *  live graph and this response is a read-time regeneration (Test Strategy
   *  edits preserved; nothing persisted — the push gate owns the artifact). */
  refreshed: boolean;
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

  // Dogfood find 2026-09-02 (#3): the stored branch used to serve the artifact
  // AS-IS on the word of its stored stale flag — five plans kept reporting
  // "noschema" after the schema landed, and a read could never self-correct.
  // Every read now goes through ensureTestDocumentForRequirement, which
  // compares the CURRENT fingerprint against the stored one and regenerates
  // on mismatch (user-edited Test Strategy carried forward verbatim), exactly
  // like the task-doc lane.
  // Catalog load is BEST-EFFORT on this read (it feeds the framework
  // recommendation and the fingerprint's narrow catalogSignature): a failed
  // load degrades to empty catalogs — the legacy-signature behavior — and
  // never turns a read into a 500.
  let catalogs: CatalogData;
  try {
    catalogs = await loadCatalogs(supabase, { projectIds: [projectId] });
  } catch {
    catalogs = { nodeRoles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} };
  }
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
  const content = result.content;
  const fingerprint = result.fingerprint;
  const isNew = result.isNew;
  // Served content is fresh BY CONSTRUCTION now — stale only ever reports
  // false; the field survives for response-shape compatibility.
  const stale = false;
  let proposalId: string | undefined;
  let persistNote: string | undefined;
  if (result.refreshed) {
    persistNote = 'The stored plan was stale (its inputs changed — e.g. a schema landed); this response is a fresh regeneration with your Test Strategy edits preserved. The stored artifact updates on the next git push via the freshness gate.';
  }

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
    refreshed: result.refreshed === true,
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
      metadata: { source: 'mcp-test-plan', requirementId: requirement.requirement_id, patchCount: patches.length, authMethod: auth.authMethod, apiKeyId: auth.keyId || null, credential: credentialOf(auth).delegate, credentialLabel: credentialOf(auth).label },
    });
    if (runError) return null;

    const proposalId = crypto.randomUUID();
    const { error: proposalError } = await supabase.from('ai_proposals').insert({
      id: proposalId, ai_run_id: aiRunId,
      source_branch_id: branchId, proposal_branch_id: branchId,
      status: 'pending',
      patches: patches.map((patch, i) => ({ patch, status: 'pending', explanation: explanations[i] ?? patch.metadata.summary })),
      validation_expectations: [],
      // AL.2: the proven credential, so the card names who asked for the plan.
      metadata: { source: 'mcp-test-plan', requirementId: requirement.requirement_id, authMethod: auth.authMethod, apiKeyId: auth.keyId || null, credential: credentialOf(auth).delegate, credentialLabel: credentialOf(auth).label },
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
  args: { project_id: string; branch_id?: string; target_type: string; target_id: string; view?: string; budget?: number; since?: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  if (!args.project_id || !args.target_type || !args.target_id) {
    return { success: false, error: 'project_id, target_type, and target_id are required (branch_id is optional and defaults to the primary branch)' };
  }

  // WS1 views (owner-measured ~33k tokens/call — the task doc used to ship up to
  // THREE times: context.promptDocument, the top-level re-emit, and the task
  // artifact's contentPreview). brief (default) = the build brief alone; structured =
  // machine-readable model truth, schemas as presence/preview/hash, NO prompt
  // document; full = structured with complete schema bodies + the document exactly
  // ONCE at top level.
  const view = args.view ?? 'brief';
  if (view !== 'brief' && view !== 'structured' && view !== 'full' && view !== 'slice') {
    return { success: false, error: "view must be one of 'brief' | 'structured' | 'full' | 'slice'" };
  }
  // AA.6: the slice is a node's own context, measured.
  if (view === 'slice' && args.target_type !== 'node') {
    return { success: false, error: "view 'slice' reads one node: pass target_type 'node' and the node's id or label." };
  }
  if (args.budget !== undefined && (typeof args.budget !== 'number' || !Number.isFinite(args.budget) || args.budget < 100)) {
    return { success: false, error: 'budget is approximate tokens for the whole answer: a number of 100 or more.' };
  }
  if ((args.budget !== undefined || args.since !== undefined) && view !== 'slice') {
    return { success: false, error: "budget and since apply to view 'slice' only." };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;
  // V3 3.2: branch_id is optional; the primary branch is the default.
  const branchId = await resolveBranchId(supabase, projectId, args.branch_id);
  if (!branchId) return { success: false, error: 'No primary branch found for this project' };

  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', branchId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (!branch) {
    return { success: false, error: 'Branch not found' };
  }

  if (view === 'slice') {
    return await readNodeSlice(supabase, auth, projectId, branchId, args.target_id, args.budget ?? null, args.since ?? null);
  }

  // Q: repo-index enrichment (freshness, hub summary) is repo import's.
  let repoIndex = false;
  try { repoIndex = featureAllowed(await getProjectTier(supabase, projectId, auth.userId, { role: resolved.project.role }), 'repo_import'); } catch { /* fail closed */ }
  const context = await assembleContextForTarget(
    supabase,
    projectId,
    branchId,
    args.target_type,
    args.target_id,
    auth.userId,
    { repoIndex },
  );

  const { data: spec } = await supabase
    .from('project_specifications')
    .select('id, phase_status')
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
    // UAT bench 2026-09-27: the target is REQ-NNN or the row uuid, and only
    // ever a requirement of THIS project's specification. The lookup used to
    // take the uuid alone, unscoped: REQ-001 found nothing, and another
    // project's uuid answered with that project's requirement name.
    const { data: requirement } = spec?.id
      ? await supabase
        .from('specification_requirements')
        .select('id, requirement_id, name, description, category, status, acceptance_criteria, specification_id')
        .eq('specification_id', spec.id)
        .eq(UUID_RE.test(args.target_id) ? 'id' : 'requirement_id', args.target_id)
        .maybeSingle()
      : { data: null };

    if (requirement) {
      requirementLabel = wrapField(String(requirement.name ?? requirement.requirement_id));
      // WS1 READ PURITY: a context read reports stored-plan STATE only — it never
      // generates a plan and never parks a proposal (a read that writes surprised the
      // owner's live run). C4 generation + proposal parking stay in get_test_plan
      // (assembleTestPlanForRequirement), which remains the lane for the plan body.
      const { data: snapshot } = await supabase
        .from('graph_snapshots')
        .select('graph_data')
        .eq('branch_id', branchId)
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
      ? 'Requirements are still being drafted. Review and refine them with create_requirement / update_requirement (the user confirms and locks them in the app), then design the architecture yourself and submit it via propose_patches (contracts first, then nodes, then edges), linking nodes to requirements with map_requirement.'
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

/** P0-7: the user-authored words in a slice, in the envelope; ids, states and hashes stay bare. */
function wrapSliceFields(sections: NodeSlice['sections']): void {
  // deno-lint-ignore no-explicit-any
  const s = sections as Record<string, any>;
  const ref = (r: AnyRecord | null | undefined) => { if (r?.label) r.label = wrapField(String(r.label)); };
  if (s.node) {
    ref(s.node);
    ref(s.node.parent);
    for (const c of s.node.children ?? []) ref(c);
    for (const i of s.node.inherited ?? []) i.container = wrapField(String(i.container));
  }
  for (const e of s.edges ?? []) {
    ref(e.neighbour);
    if (e.contract) {
      e.contract.name = wrapField(String(e.contract.name));
      e.contract.schema = wrapFieldNullable(e.contract.schema);
    }
  }
  for (const b of s.beyond ?? []) {
    ref(b.via); ref(b.node);
    if (b.contract) b.contract.name = wrapField(String(b.contract.name));
  }
  for (const c of s.consumers ?? []) {
    ref(c.node);
    for (const x of c.expects ?? []) x.text = wrapField(String(x.text));
  }
  for (const r of s.requirements ?? []) {
    r.name = wrapField(String(r.name));
    for (const c of r.criteria ?? []) c.text = wrapField(String(c.text));
  }
  for (const t of s.tasks ?? []) t.title = wrapField(String(t.title));
  for (const t of s.tests ?? []) t.name = wrapField(String(t.name));
  for (const l of s.leases ?? []) { ref(l.node); l.holder = wrapField(String(l.holder)); }
  for (const c of s.constraints ?? []) {
    c.description = wrapField(String(c.description));
    if (c.title) c.title = wrapField(String(c.title));
  }
  for (const v of s.vision?.sentences ?? []) v.text = wrapField(String(v.text));
  // AA.7: memory is what people and agents wrote.
  for (const m of s.memory ?? []) {
    m.text = wrapField(String(m.text));
    if (m.who) m.who = wrapField(String(m.who));
  }
}

/** AA.7: the reader's own live leases on this node (or on work inside it)
 *  carry what it just read, so the Agents panel can say it per read. Best
 *  effort: never fails the read. */
async function stampContextRead(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  node: { id: string; label?: string },
  tokens: number,
  wholeSpecTokens: number,
): Promise<void> {
  const me = holderIdentity(auth);
  if (!me && !auth.keyId) return;
  try {
    const { data } = await supabase
      .from('agent_checkouts')
      .select('id, meta, holder_key_id, holder_delegate')
      .eq('project_id', projectId)
      .eq('node_id', node.id)
      .is('released_at', null);
    const at = new Date().toISOString();
    for (const l of (data ?? []) as Array<{ id: string; meta: AnyRecord | null; holder_key_id: string | null; holder_delegate: string | null }>) {
      const mine = (!!auth.keyId && l.holder_key_id === auth.keyId) || (!!me && l.holder_delegate === me);
      if (!mine) continue;
      await supabase
        .from('agent_checkouts')
        .update({ meta: { ...(l.meta ?? {}), contextRead: { nodeId: node.id, label: String(node.label ?? ''), tokens, wholeSpecTokens, at } } })
        .eq('id', l.id)
        .is('released_at', null);
    }
  } catch { /* the read stands without the stamp */ }
}

/**
 * AA.6: get_project_context(view: 'slice'). One node's own context, every
 * answer measured: `size` (characters and approximate tokens), `leftOut`
 * (what it does not carry and where to read it), `fingerprint` (pass it back
 * as `since` and only the sections that changed come back).
 */
async function readNodeSlice(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  branchId: string,
  targetId: string,
  budget: number | null,
  since: string | null,
): Promise<MCPResponse> {
  const graph = await loadGraphData(supabase, branchId) as unknown as SliceGraph | null;
  if (!graph) return { success: false, error: 'This branch has no architecture yet: propose one with propose_patches first.' };
  const node = resolveNodeFromGraph(graph as never, 'node', targetId);
  if (!node) return { success: false, error: `No node "${targetId}" on this branch. Check the id or label against get_architecture_overview.` };

  let loaded: Awaited<ReturnType<typeof loadSliceInputs>>;
  try {
    loaded = await loadSliceInputs(supabase, projectId, branchId, graph, node.id);
  } catch (err) {
    return { success: false, error: `Could not read this node's slice: ${err instanceof Error ? err.message : String(err)}` };
  }
  // AG.12a: the catalog says how the node and its parent hold; a failed load omits it.
  const catalogs = await loadCatalogs(supabase, { projectIds: [projectId] }).catch(() => null);
  const built = buildNodeSlice({ ...loaded.inputs, catalogs });
  wrapSliceFields(built.sections);
  const notes = [...built.notes, ...loaded.notes];

  // AE.6: the person asked from the canvas for this node to be exploded.
  const { data: projRow } = await supabase.from('projects').select('metadata').eq('id', projectId).maybeSingle();
  const [explodeRequested] = liveStagedExplodes(
    readStagedExplodes((projRow as { metadata?: Record<string, unknown> } | null)?.metadata).filter((e) => e.nodeId === node.id),
    graph.nodes as never, [],
  );
  if (explodeRequested) {
    notes.push(`The user asked from the canvas for this node to be exploded into its parts${explodeRequested.note ? ` (they say: "${explodeRequested.note}")` : ''}: ` +
      'claim its lease (checkout_task level node) and propose_patches with one explode_node intent; get_project_status says whether that proposal is already filed.');
    // Item 25 (owner 2026-09-27): read, write or both is the agent's to state.
    if (await explodesIntoTableGroups(supabase, String(node.type ?? '')).catch(() => false)) {
      notes.push('It is a data store, so its parts are table groups (part-table-group). Give each group its tables, each with the file that defines it wherever that file lives ' +
        '(a service\'s migrations, one shared schema file), the references between groups, and on each service edge a group takes, access: read, write or both, ' +
        'as that service\'s queries use it (with no code yet, as the design intends).');
    }
  }

  const hasTaskDoc = Object.values(graph.artifacts ?? {}).some((a) => a?.nodeId === node.id && a?.kind === 'task' && a?.content);
  const files = Object.values(graph.artifacts ?? {}).filter((a) => a?.nodeId === node.id && a?.kind !== 'task' && a?.kind !== 'test-plan' && a?.status !== 'suggested').length;
  const designed: LeftOut[] = byDesignLeftOut({ hasTaskDoc, visionRecorded: loaded.inputs.vision?.recorded === true, files });

  // The frame around the sections, measured once so the budget covers the whole answer.
  const frame = { view: 'slice', target: { id: node.id, label: wrapField(node.label), type: 'node' }, fingerprint: 'x'.repeat(100), size: { chars: 0, approxTokens: 0, budget }, leftOut: designed, notes };
  const fitted = fitToBudget({ sections: built.sections, notes }, budget, sizeOf(frame));
  const hashes = sectionHashes(fitted.slice.sections);
  const fingerprint = sliceFingerprint(hashes);
  const previous = since ? parseSliceFingerprint(since) : null;
  const delta = previous ? deltaSince(fitted.slice.sections, hashes, previous) : null;
  if (since && !previous) notes.push('`since` is not a fingerprint this view wrote, so the whole slice is returned.');
  if (!fitted.fits) notes.push(`Even with every cut the answer is over the budget of ${budget} tokens; the node, its edges, leases${built.sections.constraints ? ', constraints' : ''} and vision are never cut.`);

  // A delta that sends nothing sends no notes and no advisory either: the
  // caller has them from the read it names.
  const sendsNothing = !!delta && Object.keys(delta.sections).length === 0;
  const data: AnyRecord = {
    view: 'slice',
    target: { id: node.id, label: wrapField(node.label), type: 'node' },
    fingerprint,
    ...(delta ? { unchanged: delta.unchanged, ...(delta.gone.length > 0 ? { gone: delta.gone } : {}) } : {}),
    slice: delta ? delta.sections : fitted.slice.sections,
    ...(explodeRequested ? { explodeRequested: { stagedAt: explodeRequested.stagedAt, note: explodeRequested.note } } : {}),
    leftOut: [...designed, ...fitted.cuts],
    ...(notes.length > 0 && !sendsNothing ? { notes } : {}),
    ...(sendsNothing ? { message: 'Nothing in this slice changed since that read.' } : { untrustedDataAdvisory: UNTRUSTED_ADVISORY }),
  };
  const chars = sizeOf(data);
  // AA.7: beside this read, what the whole specification would have been
  // (every node, edge, contract and requirement, as JSON).
  const wholeChars = sizeOf({ nodes: graph.nodes, edges: graph.edges, contracts: graph.contracts }) + sizeOf(loaded.inputs.requirements);
  data.size = { chars, approxTokens: approxTokens(chars), budget, wholeSpec: { chars: wholeChars, approxTokens: approxTokens(wholeChars) } };
  await stampContextRead(supabase, auth, projectId, node, approxTokens(chars), approxTokens(wholeChars));
  return { success: true, data };
}

export async function handleGetTestPlan(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id?: string; requirement_id: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  if (!args.project_id || !args.requirement_id) {
    return { success: false, error: 'project_id and requirement_id are required (branch_id is optional and defaults to the primary branch)' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;
  // V3 3.2: branch_id is optional; the primary branch is the default.
  const branchId = await resolveBranchId(supabase, projectId, args.branch_id);
  if (!branchId) return { success: false, error: 'No primary branch found for this project' };

  const { data: requirement } = await supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, description, category, status, acceptance_criteria, specification_id')
    .eq('id', args.requirement_id)
    .maybeSingle();

  if (!requirement) {
    return { success: false, error: 'Requirement not found' };
  }

  const assembled = await assembleTestPlanForRequirement(supabase, auth, projectId, branchId, requirement as RequirementRow);

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
      ...(assembled.proposalId ? { proposalId: assembled.proposalId } : {}),
      // Dogfood #3 follow-up: a read-time refresh must SAY so — persistNote was
      // set on refresh but only shipped beside proposalId (which a refresh never
      // has), so the caller got a silently different plan with no explanation.
      ...(assembled.refreshed ? { testPlanRefreshed: true } : {}),
      ...(assembled.persistNote ? { note: assembled.persistNote } : {}),
    },
  };
}

/** V3 2.2: how many patches a since_sequence answer lists at most. */
const SINCE_SEQUENCE_LIMIT = 500;

export async function handleGetArchitectureOverview(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id?: string; since_sequence?: number }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  if (!args.project_id) {
    return { success: false, error: 'project_id is required' };
  }
  if (args.since_sequence !== undefined && (!Number.isInteger(args.since_sequence) || (args.since_sequence as number) < 0)) {
    return { success: false, error: 'since_sequence must be a non-negative integer: a headSequence this tool answered earlier.' };
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

  // V3 2.2 (2026-09-19): the branch head rides every answer (pass it back as
  // propose_patches' base_sequence). With since_sequence the answer also
  // lists what was appended after that read, the user's canvas edits
  // included, so an agent can ask "what changed since I looked" at the top
  // of every task for almost nothing.
  const { data: headRow } = await supabase
    .from('graph_patches')
    .select('sequence')
    .eq('branch_id', branchId)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  const headSequence = Number((headRow as { sequence?: unknown } | null)?.sequence ?? 0) || 0;
  let since: { sinceSequence: number; patches: Array<{ sequence: number; actorType: string | null; type: string; summary: string | null }>; truncated: boolean } | null = null;
  if (args.since_sequence !== undefined) {
    const { data: rows } = await supabase
      .from('graph_patches')
      .select('sequence, patch_type, actor_type, summary')
      .eq('branch_id', branchId)
      .gt('sequence', args.since_sequence)
      .order('sequence', { ascending: true })
      .limit(SINCE_SEQUENCE_LIMIT);
    const list = ((rows ?? []) as Array<{ sequence: number | string; patch_type: string; actor_type: string | null; summary: string | null }>);
    since = {
      sinceSequence: args.since_sequence,
      patches: list.map((r) => ({ sequence: Number(r.sequence), actorType: r.actor_type ?? null, type: r.patch_type, summary: r.summary ?? null })),
      truncated: list.length >= SINCE_SEQUENCE_LIMIT,
    };
  }

  // N4.1: catalogs are optional — altitude enrichment only; the overview must not fail
  // if the catalog read does.
  const catalogs = await loadCatalogs(supabase, { projectIds: [projectId] }).catch(() => undefined);
  const overview = await assembleArchitectureOverview(supabase, projectId, branchId, catalogs);
  if (!overview) {
    return {
      success: true,
      data: {
        projectName: resolved.project.name,
        branchName,
        headSequence,
        ...(since ? { since } : {}),
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
      headSequence,
      ...(since ? { since } : {}),
      ...overview,
    },
  };
}

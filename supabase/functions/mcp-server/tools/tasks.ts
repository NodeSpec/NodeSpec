// P1-7 C1.3: the `tasks` tool bucket — generate_task_docs, the deterministic packet-creation
// lane over MCP. Task documents are DERIVED, never authored (authority table, V2_PLAN §1.C):
// the server-side generator has catalog context (L2/L3) that deliberately never crosses the
// MCP boundary, so an external AI structurally cannot hand-write a packet as good as the
// generator's — bench-observed as thin "requirements dump" docs. This tool restores
// internal-agent parity post-inversion: the user's AI REQUESTS generation; the server runs
// `generateTaskDocument` deterministically (no LLM) and emits the results as an ordinary
// pending proposal (add/update_artifact patches carrying content + the context fingerprint),
// which the user accepts in the UI. C1's freshness gate then keeps the packets true at push.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { loadCatalogs } from "../../_shared/catalog-loader.ts";
import {
  generateTaskDocument,
  getTaskDocumentPath,
  findExistingTaskArtifact,
  computeTaskContextFingerprint,
  preserveImplementationContextSection,
  classifyNodeDeliverable,
  assessNodeReadiness,
  type ReadinessGap,
} from "../../_shared/task-document-generator.ts";
import { PatchOperationSchema } from "../../_shared/patch-schema.ts";
import { loadTaskStateByNode, reconcileTaskItemOrphans } from "../../_shared/task-deltas.ts";
import { liveNodeIdSet, filterMappingsToLiveNodes } from "../../_shared/mapping-liveness.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, UUID_RE } from "../shared.ts";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

// Spec plane loading shared by generate_task_docs and get_build_readiness: requirements
// grouped per node + the REQ -> nodes map (same shape the generator's original internal
// caller used). N5.13 (bench AI finding): mappings are spec-global and can reference
// nodes deleted from THIS branch — filter rows against the live node set so phantom
// UUIDs never reach packets or readiness reports (read-time pruning per
// mapping-liveness.ts; write-time cascade is wrong across branches).
async function loadSpecPlane(supabase: SupabaseClient, projectId: string, liveNodeIds: Set<string>): Promise<{
  vision: string | undefined;
  requirementsByNode: Record<string, AnyRecord[]>;
  requirementNodeMap: Record<string, string[]>;
  /** C4: human REQ id → requirement ROW uuid. test_cases.requirement_id is the ROW
   *  uuid, so the tests-triage query needs this map; kept OUT of the requirement
   *  entries themselves so generator inputs (and their fingerprints) are untouched. */
  requirementRowIdMap: Record<string, string>;
}> {
  let vision: string | undefined;
  const requirementsByNode: Record<string, AnyRecord[]> = {};
  const requirementNodeMap: Record<string, string[]> = {};
  const requirementRowIdMap: Record<string, string> = {};
  const { data: spec } = await supabase
    .from('project_specifications')
    .select('id, vision')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (spec) {
    vision = spec.vision || undefined;
    const { data: rawMappings } = await supabase
      .from('specification_mappings')
      .select('requirement_id, node_id')
      .eq('specification_id', spec.id);
    const mappings = filterMappingsToLiveNodes((rawMappings ?? []) as Array<{ requirement_id: string; node_id: string }>, liveNodeIds);
    if (mappings && mappings.length > 0) {
      const reqRowIds = [...new Set((mappings as AnyRecord[]).map((m) => m.requirement_id))];
      const { data: reqs } = await supabase
        .from('specification_requirements')
        .select('id, requirement_id, name, description, category, status, acceptance_criteria')
        .in('id', reqRowIds);
      const reqMap = new Map(((reqs ?? []) as AnyRecord[]).map((r) => [r.id, r]));
      for (const m of mappings as AnyRecord[]) {
        const req = reqMap.get(m.requirement_id);
        if (!req) continue;
        const humanId = String(req.requirement_id);
        requirementRowIdMap[humanId] = String(req.id);
        if (!requirementNodeMap[humanId]) requirementNodeMap[humanId] = [];
        if (!requirementNodeMap[humanId].includes(m.node_id)) requirementNodeMap[humanId].push(m.node_id);
        if (!requirementsByNode[m.node_id]) requirementsByNode[m.node_id] = [];
        requirementsByNode[m.node_id].push({
          requirementId: humanId,
          name: String(req.name ?? ''),
          description: String(req.description ?? ''),
          category: String(req.category ?? ''),
          status: String(req.status ?? ''),
          acceptanceCriteria: req.acceptance_criteria ?? [],
        });
      }
    }
  }
  return { vision, requirementsByNode, requirementNodeMap, requirementRowIdMap };
}

export async function handleGenerateTaskDocs(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id: string; node_ids?: string[]; external_agent?: string },
): Promise<MCPResponse> {
  if (!checkScope(auth, 'propose')) {
    return { success: false, error: 'Insufficient permissions: propose scope required' };
  }
  if (!args.project_id || !args.branch_id) {
    return { success: false, error: 'project_id and branch_id are required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId!, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', args.branch_id)
    .eq('project_id', projectId)
    .maybeSingle();
  if (!branch) return { success: false, error: 'Branch not found' };

  const { data: snapshot } = await supabase
    .from('graph_snapshots')
    .select('graph_data')
    .eq('branch_id', args.branch_id)
    .order('patch_sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const graph = (snapshot?.graph_data ?? {}) as AnyRecord;
  const nodes = Object.values((graph.nodes ?? {}) as AnyRecord) as AnyRecord[];
  if (nodes.length === 0) {
    return { success: false, error: 'Branch has no nodes — propose an architecture first, then generate task docs.' };
  }

  const catalogs = await loadCatalogs(supabase);

  const { vision, requirementsByNode, requirementNodeMap } = await loadSpecPlane(supabase, projectId, liveNodeIdSet(graph.nodes as Record<string, unknown>));

  // Target selection: every node with a deliverable — N5.16 (owner): HOSTING
  // containers carry task docs too (VPC gateways, compose definitions); only the
  // logical Structure set is organizational, and the classifier's 'none' skip below
  // handles that. Optionally narrowed by node_ids (uuid or case-insensitive label).
  const filter = (args.node_ids ?? []).map((s) => String(s));
  const wanted = (n: AnyRecord) =>
    filter.length === 0 ||
    filter.some((f) => (UUID_RE.test(f) ? n.id === f : String(n.label ?? '').toLowerCase() === f.toLowerCase()));
  const leafNodes = nodes.filter((n) => wanted(n));
  if (leafNodes.length === 0) {
    return { success: false, error: 'No matching nodes. Check node_ids against get_architecture_overview.' };
  }

  const now = new Date().toISOString();
  const patches: AnyRecord[] = [];
  const explanations: string[] = [];
  // N5.16: skip messages go in their OWN list — pushing them into `explanations`
  // without a paired patch shifted every later patch's explanation by one (latent
  // since the N5.8 none-skip; containers made it likely).
  const skipped: string[] = [];
  let created = 0, refreshed = 0, alreadyFresh = 0;

  // A4 (docs/WORK_LOOP_PLAN.md): one batch read of recorded task done-state so
  // regenerated docs render `[x]` for done tasks instead of wiping progress.
  // Best-effort: with no state (or a read failure) generation renders every
  // box unticked — the pre-A4 output, never an error.
  let taskStateByNode = new Map<string, Map<string, boolean>>();
  try {
    taskStateByNode = await loadTaskStateByNode(supabase, projectId);
  } catch { /* generation proceeds stateless */ }

  const meta = (summary: string) => ({
    id: crypto.randomUUID(),
    timestamp: now,
    actorType: 'system',
    actorId: 'task-generator',
    summary,
  });

  for (const node of leafNodes) {
    const reqs = requirementsByNode[node.id] ?? [];
    // N5.8: taskless nodes — a node whose classified deliverable is 'none' (account-
    // access-only; configMode 'none') carries NO task doc at all. It stays in the model
    // for architectural truth; generating an empty directive would be noise.
    const roleRowForNode = catalogs.nodeRoles[node.type];
    const techRowForNode = node.technology ? catalogs.technologies[node.technology] : null;
    // M7 BUGFIX: this read `?.kind` and passed it as classifyNodeDeliverable's
    // `parentNature`. deriveOwnership tests `parentNature === 'host'` to make a node inside
    // a platform container own as `integrate` (→ provisioning IaC rather than working code).
    // `kind` never held 'host' — it held 'platform' before M1c dropped it, and undefined
    // after — so the hosted-placement rule NEVER fired on this path, and a node dropped
    // inside an AWS/GCP platform got a write-the-code packet. The sibling call site in
    // task-document-generator.ts:113 already read `.nature`; only this one drifted.
    const parentNature = node.parentId ? catalogs.nodeRoles[(nodes.find((p: AnyRecord) => p.id === node.parentId) ?? {}).type]?.nature ?? null : null;
    // deno-lint-ignore no-explicit-any
    const deliverableKind = classifyNodeDeliverable(roleRowForNode as any, (techRowForNode as AnyRecord | null)?.ai_context as any, node as any, parentNature);
    if (deliverableKind === 'none') {
      const why = roleRowForNode?.is_container ? 'organizational group' : 'account-access only';
      skipped.push(`${node.label}: no deliverable (${why}) — no task doc generated`);
      continue;
    }
    const nodeForGen = {
      id: node.id, label: node.label, type: node.type,
      technology: node.technology, parentId: node.parentId,
      ports: node.ports, metadata: node.metadata,
    };
    // deno-lint-ignore no-explicit-any
    const content = generateTaskDocument({
      node: nodeForGen, graph, catalogs, requirements: reqs,
      projectVision: vision, requirementNodeMap,
      taskState: taskStateByNode.get(node.id),
      // deno-lint-ignore no-explicit-any
    } as any);
    // A4: reconcile state rows against the keys this regeneration actually
    // emits — vanished keys are ORPHANED (never deleted), reappearing keys
    // restored. Best-effort: reconciliation must never fail a generation.
    try {
      await reconcileTaskItemOrphans(supabase, projectId, node.id, content);
    } catch { /* non-fatal */ }
    // deno-lint-ignore no-explicit-any
    const fp = computeTaskContextFingerprint(nodeForGen as any, graph as any, reqs as any, vision, catalogs as any);

    const existing = findExistingTaskArtifact((graph.artifacts ?? {}) as AnyRecord, node.id) as AnyRecord | null;
    if (existing) {
      // N5.17: authored Implementation Context survives regeneration; REVIEW-NEEDED
      // is flagged only when the derived context actually changed (fingerprint flip),
      // not on a generator-version content diff.
      const preserved = preserveImplementationContextSection(
        content, String(existing.content ?? ''),
        { flagReview: fp.fingerprint !== existing.metadata?.taskContextFingerprint?.fingerprint },
      );
      if (existing.content === preserved) { alreadyFresh++; continue; }
      patches.push({
        type: 'update_artifact',
        metadata: meta(`Refresh task document for ${node.label}`),
        payload: {
          id: existing.id,
          changes: {
            content: preserved, status: 'draft', updatedAt: now,
            metadata: { ...(existing.metadata ?? {}), taskContextFingerprint: fp, stale: false },
          },
        },
      });
      explanations.push(`Regenerated task packet for ${node.label} (context changed since last generation)`);
      refreshed++;
    } else {
      const artifactId = crypto.randomUUID();
      patches.push({
        type: 'add_artifact',
        metadata: meta(`Generate task document for ${node.label}`),
        payload: {
          id: artifactId, nodeId: node.id, kind: 'task',
          path: getTaskDocumentPath(String(node.label ?? 'node'), String(node.id)),
          content, language: 'markdown', status: 'draft',
          description: `Implementation task document for ${node.label}`,
          createdAt: now, updatedAt: now,
          metadata: { taskContextFingerprint: fp },
        },
      });
      explanations.push(`Generated task packet for ${node.label}: mapped requirements, contracts, neighbors, and technology context`);
      created++;
      const currentLinks = Array.isArray(node.artifacts) ? node.artifacts : [];
      patches.push({
        type: 'update_node',
        metadata: meta(`Link task document to ${node.label}`),
        payload: { id: node.id, changes: { artifacts: [...currentLinks, artifactId] } },
      });
      explanations.push(`Link the task document artifact to ${node.label}`);
    }
  }

  if (patches.length === 0) {
    return {
      success: true,
      data: {
        generated: 0, refreshed: 0, alreadyFresh, skipped,
        message: 'All matching nodes already have up-to-date task documents.',
        nextAction: 'Nothing to accept. Push to ship the current packets; C1 keeps them fresh automatically.',
      },
    };
  }

  // Defensive: the generator's output must satisfy the same schema the apply pipeline
  // enforces — fail loudly here rather than in the approve dialog.
  for (const p of patches) {
    const parsed = PatchOperationSchema.safeParse(p);
    if (!parsed.success) {
      return { success: false, error: `Generated patch failed schema validation (server bug — report this): ${parsed.error.issues[0]?.message}` };
    }
  }

  const externalAgent = args.external_agent || 'external-mcp-agent';
  const aiRunId = crypto.randomUUID();
  const { error: runError } = await supabase.from('ai_runs').insert({
    id: aiRunId, project_id: projectId, branch_id: args.branch_id,
    model: 'task-generator', prompt_hash: 'mcp-task-docs', status: 'completed',
    completed_at: now,
    metadata: { source: 'mcp-task-docs', requestedBy: externalAgent, patchCount: patches.length, authMethod: auth.authMethod, apiKeyId: auth.keyId || null },
  });
  if (runError) return { success: false, error: `Failed to create AI run: ${runError.message}` };

  const proposalId = crypto.randomUUID();
  const { error: proposalError } = await supabase.from('ai_proposals').insert({
    id: proposalId, ai_run_id: aiRunId,
    source_branch_id: args.branch_id, proposal_branch_id: args.branch_id,
    status: 'pending',
    patches: patches.map((patch, i) => ({ patch, status: 'pending', explanation: explanations[i] ?? patch.metadata.summary })),
    validation_expectations: [],
    metadata: { source: 'mcp-task-docs', requestedBy: externalAgent, authMethod: auth.authMethod, apiKeyId: auth.keyId || null },
  });
  if (proposalError) return { success: false, error: `Failed to create proposal: ${proposalError.message}` };

  return {
    success: true,
    data: {
      proposalId, aiRunId,
      generated: created, refreshed, alreadyFresh, skipped,
      patchCount: patches.length,
      status: 'pending',
      message: `Deterministic task documents prepared for ${created + refreshed} node(s) as a pending proposal.`,
      nextAction: 'Ask the user to accept the proposal in NodeSpec, then push to git — the .nodespec/tasks/*.task.md packets ship with full content and stay fresh automatically. Before implementing, call get_build_readiness to surface any blocking gaps (undefined schemas, unresolved ownership) with their resolution actions. To ADD guidance beyond the generated brief, propose update_artifact patches on top after acceptance rather than replacing the document.',
    },
  };
}

// ── N5.12: get_build_readiness — the build preflight ────────────────────────────────
// Owner direction 2026-07-24: when the user asks their AI to build code/config/schema
// artifacts, the AI must not leave them hanging on undefined interface contracts. This
// READ-scope tool turns the packet's `[PLACEHOLDER: …]` gaps into a machine-readable
// punch list — per-node blockers/advisories, a top-level remediations map, and a
// dependency-ordered build sequence. Model-plane gaps come from assessNodeReadiness
// (the same module that renders the placeholders); the doc-plane checks (missing/stale
// task doc) live here because they need graph.artifacts + the fingerprint.

// WS1 readiness diet (owner-measured ~15k tokens on an unscoped call): resolveWith was
// constant boilerplate repeated verbatim on every gap of a kind. It is hoisted here to
// ONE remediations map keyed by gap kind (built only for kinds present in the
// response); emitted gaps keep {kind, detail, relatedNodeIds?, draftInputs?}. The
// shared module keeps ReadinessGap.resolveWith for the doc lane — these texts are that
// boilerplate, stated once per kind.
const GAP_REMEDIATIONS: Record<string, string> = {
  schema: "Draft each missing schema YOURSELF from the gap's draftInputs (both technologies, counterparty API endpoints, unmet criteria, suggestedSpecFormat), then submit ONE propose_patches batch of update_contract patches ({schema} inline JSON object, or {schemaRef} of an ACCEPTED kind='schema' artifact, plus specFormat) for the user to accept — never build against an undefined interface. A BROKEN reference (detail names the missing artifact) re-links the same way.",
  owner: "Decide the owning node with the user, then record it via map_requirement (mode 'remove' also prunes stale links; or adjust the requirement upstream with update_requirement).",
  doc: "Regenerate with generate_task_docs for the flagged nodes and ask the user to accept the proposal — covers missing AND stale docs.",
  config: "Ask the user to set their choices in the node inspector (Configuration) — the packet folds them in as decisions to honor.",
  classification: "Verify the catalog filing with the user (the N8 filing gate owns configMode correctness); if wrong, the catalog row's ai_context.configMode needs fixing — do not silently build to the suspicious deliverable.",
  technology: "Ask the user which technology the component uses (search_catalog to explore options), then bind it via the inspector — or confirm it is intentionally technology-neutral.",
  mapping: "Map existing requirements with map_requirement, or add missing ones upstream with create_requirement, then regenerate the task doc.",
  tests: "Call get_test_plan for each named requirement, re-run the failing/stale tests, and report outcomes via report_test_results — a fresh passing result flips the criterion met and clears staleness.",
};

// The emitted gap shape: resolveWith stripped (see GAP_REMEDIATIONS), everything else kept.
function stripGap(g: ReadinessGap): AnyRecord {
  return {
    kind: g.kind,
    detail: g.detail,
    ...(g.relatedNodeIds ? { relatedNodeIds: g.relatedNodeIds } : {}),
    ...(g.draftInputs ? { draftInputs: g.draftInputs } : {}),
  };
}

function countByKind(gaps: ReadinessGap[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const g of gaps) counts[g.kind] = (counts[g.kind] ?? 0) + 1;
  return counts;
}

export async function handleGetBuildReadiness(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id: string; node_ids?: string[]; detail?: 'summary' | 'full' },
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }
  if (!args.project_id || !args.branch_id) {
    return { success: false, error: 'project_id and branch_id are required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId!, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', args.branch_id)
    .eq('project_id', projectId)
    .maybeSingle();
  if (!branch) return { success: false, error: 'Branch not found' };

  const { data: snapshot } = await supabase
    .from('graph_snapshots')
    .select('graph_data')
    .eq('branch_id', args.branch_id)
    .order('patch_sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const graph = (snapshot?.graph_data ?? {}) as AnyRecord;
  const nodes = Object.values((graph.nodes ?? {}) as AnyRecord) as AnyRecord[];
  if (nodes.length === 0) {
    return { success: false, error: 'Branch has no nodes — propose an architecture first.' };
  }

  const catalogs = await loadCatalogs(supabase);
  // R6: vision joins the destructure — the readiness staleness check must hash
  // the SAME fields the generators stamp, or every packet reads stale forever.
  const { vision, requirementsByNode, requirementNodeMap, requirementRowIdMap } = await loadSpecPlane(supabase, projectId, liveNodeIdSet(graph.nodes as Record<string, unknown>));

  // C4 step 4: tests triage — the verification backlog, batch-queried ONCE for every
  // mapped requirement row uuid. Failing cases mean the criterion's evidence says
  // "broken"; stale cases mean the recorded verdict may no longer hold (source /
  // requirement / mapping changed since the run). Column is `stale` (never is_stale);
  // test_cases key by the requirement ROW uuid, hence requirementRowIdMap.
  const testStatsByReqRow = new Map<string, { failed: number; stale: number }>();
  const allReqRowIds = [...new Set(Object.values(requirementRowIdMap))];
  if (allReqRowIds.length > 0) {
    const { data: caseRows } = await supabase
      .from('test_cases')
      .select('requirement_id, status, stale')
      .in('requirement_id', allReqRowIds)
      .is('retired_at', null);
    for (const c of ((caseRows ?? []) as Array<{ requirement_id: string; status: string; stale: boolean }>)) {
      const s = testStatsByReqRow.get(c.requirement_id) ?? { failed: 0, stale: 0 };
      if (c.status === 'failed') s.failed++;
      if (c.stale === true) s.stale++;
      testStatsByReqRow.set(c.requirement_id, s);
    }
  }

  // N5.16: containers with deliverables are assessed too (the classifier returns
  // 'none' for logical groups and they drop below).
  const filter = (args.node_ids ?? []).map((s) => String(s));
  const wanted = (n: AnyRecord) =>
    filter.length === 0 ||
    filter.some((f) => (UUID_RE.test(f) ? n.id === f : String(n.label ?? '').toLowerCase() === f.toLowerCase()));
  const leafNodes = nodes.filter((n) => wanted(n));
  if (leafNodes.length === 0) {
    return { success: false, error: 'No matching nodes. Check node_ids against get_architecture_overview.' };
  }

  const results: AnyRecord[] = [];
  const upstreamByNode = new Map<string, string[]>();
  for (const node of leafNodes) {
    const reqs = requirementsByNode[node.id] ?? [];
    // deno-lint-ignore no-explicit-any
    const readiness = assessNodeReadiness({ node, graph, catalogs, requirements: reqs, requirementNodeMap } as any);
    if (readiness.deliverable === 'none') continue; // account-access-only: nothing to build

    const blockers: ReadinessGap[] = [...readiness.blockers];
    // Doc plane: a missing or stale task doc means the build brief itself is not ready.
    const existing = findExistingTaskArtifact((graph.artifacts ?? {}) as AnyRecord, node.id) as AnyRecord | null;
    if (!existing) {
      blockers.push({
        kind: 'doc',
        detail: 'No task document exists for this node',
        resolveWith: 'Call generate_task_docs for this node and ask the user to accept the proposal.',
      });
    } else {
      // deno-lint-ignore no-explicit-any
      const fp = computeTaskContextFingerprint(node as any, graph as any, reqs as any, vision, catalogs as any);
      const storedFpRaw = (existing.metadata as AnyRecord | undefined)?.taskContextFingerprint;
      // The stamp is an object ({fingerprint, timestamp, fields}); compare the hash,
      // tolerating a legacy raw-string form.
      const storedHash = storedFpRaw && typeof storedFpRaw === 'object' ? storedFpRaw.fingerprint : storedFpRaw;
      if (storedHash && String(storedHash) !== String(fp.fingerprint)) {
        blockers.push({
          kind: 'doc',
          detail: 'The task document is STALE — requirements or architecture changed since it was generated',
          resolveWith: 'Regenerate with generate_task_docs and ask the user to accept the refresh before building.',
        });
      }
    }

    // C4: tests advisory — failed/stale cases on this node's requirements are the
    // verification backlog. ADVISORY, not blocker: the build brief is complete; it is
    // the EVIDENCE that is behind. Counts aggregate across the node's mapped
    // requirements; the detail names the requirement ids so the AI can re-run
    // exactly those plans.
    const advisories: ReadinessGap[] = [...readiness.advisories];
    let failedCases = 0;
    let staleCases = 0;
    const affectedReqIds: string[] = [];
    for (const r of reqs) {
      const rowId = requirementRowIdMap[String(r.requirementId)];
      const stat = rowId ? testStatsByReqRow.get(rowId) : undefined;
      if (stat && (stat.failed > 0 || stat.stale > 0)) {
        failedCases += stat.failed;
        staleCases += stat.stale;
        affectedReqIds.push(String(r.requirementId));
      }
    }
    if (failedCases > 0 || staleCases > 0) {
      advisories.push({
        kind: 'tests',
        detail: `${failedCases} failing and ${staleCases} stale test case(s) on this node's requirement(s): ${affectedReqIds.join(', ')}`,
        resolveWith: 'Call get_test_plan for each named requirement, re-run the failing/stale tests, and report outcomes via report_test_results — a fresh passing result flips the criterion met and clears staleness.',
      });
    }

    // N5.16: a hosted component builds AFTER its container (the VPC/compose definition
    // must exist before the things it runs) — the parent joins the upstream set.
    const upstream = [...readiness.upstreamNodeIds];
    if (node.parentId) upstream.push(node.parentId);
    upstreamByNode.set(node.id, upstream);
    results.push({
      nodeId: node.id,
      label: node.label,
      deliverable: readiness.deliverable,
      ready: blockers.length === 0,
      blockers,
      advisories,
    });
  }

  // Build order: repeatedly take nodes whose in-scope upstream targets are already
  // placed (Kahn-style); any cycle remainder is appended alphabetically with a note.
  const inScope = new Set(results.map((r) => r.nodeId as string));
  const placed = new Set<string>();
  const buildOrder: string[] = [];
  let remaining = results.slice();
  let cyclic = false;
  while (remaining.length > 0) {
    const next = remaining.filter((r) =>
      (upstreamByNode.get(r.nodeId as string) ?? []).every((up) => !inScope.has(up) || placed.has(up))
    );
    if (next.length === 0) {
      cyclic = true;
      remaining.sort((a, b) => String(a.label).localeCompare(String(b.label)));
      for (const r of remaining) buildOrder.push(String(r.label));
      break;
    }
    next.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    for (const r of next) {
      placed.add(r.nodeId as string);
      buildOrder.push(String(r.label));
    }
    remaining = remaining.filter((r) => !placed.has(r.nodeId as string));
  }

  const blockedCount = results.filter((r) => !r.ready).length;

  // WS1 two-step protocol: unscoped calls default to SUMMARY rows (counts by kind);
  // scoped calls default to FULL gap objects. An explicit `detail` arg overrides either
  // default. remediations carries the one resolution action per gap kind present.
  const detailLevel: 'summary' | 'full' = args.detail === 'summary' || args.detail === 'full'
    ? args.detail
    : (filter.length > 0 ? 'full' : 'summary');
  const remediations: Record<string, string> = {};
  for (const r of results) {
    for (const g of [...(r.blockers as ReadinessGap[]), ...(r.advisories as ReadinessGap[])]) {
      if (GAP_REMEDIATIONS[g.kind]) remediations[g.kind] = GAP_REMEDIATIONS[g.kind];
    }
  }
  const nodeRows = results.map((r) => detailLevel === 'full'
    ? {
      nodeId: r.nodeId, label: r.label, deliverable: r.deliverable, ready: r.ready,
      blockers: (r.blockers as ReadinessGap[]).map(stripGap),
      advisories: (r.advisories as ReadinessGap[]).map(stripGap),
    }
    : {
      nodeId: r.nodeId, label: r.label, deliverable: r.deliverable, ready: r.ready,
      blockerCounts: countByKind(r.blockers as ReadinessGap[]),
      advisoryCounts: countByKind(r.advisories as ReadinessGap[]),
    });

  return {
    success: true,
    data: {
      detail: detailLevel,
      nodes: nodeRows,
      remediations,
      buildOrder,
      ...(cyclic ? { buildOrderNote: 'Contract cycle detected — the tail of buildOrder is alphabetical, not topological.' } : {}),
      message: blockedCount === 0
        ? `All ${results.length} node(s) are ready to build. Follow buildOrder.`
        : `${blockedCount} of ${results.length} node(s) have blocking gaps.`,
      // WS1: ~120 chars — the how lives in remediations, keyed by gap kind.
      nextAction: blockedCount === 0
        ? 'Implement in buildOrder per each node\'s task document, expanding its work orders first.'
        : 'Fix per remediations (keyed by gap kind), then re-check blocked nodes with node_ids for full gap detail.',
    },
  };
}

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
  carryAgentTaskContent,
  classifyNodeDeliverable,
  assessNodeReadiness,
  type ReadinessGap,
} from "../../_shared/task-document-generator.ts";
import { recordFingerprint } from "../../_shared/node-memory.ts";
import { PatchOperationSchema } from "../../_shared/patch-schema.ts";
import { loadTaskStateByNode, reconcileTaskItemOrphans, stepGaps, STEP_FORMAT } from "../../_shared/task-deltas.ts";
import { loadNodeConstraints, loadConstraintsAndRules, constraintRef, countConstraintUse, asRuleGraph, workflowsServedByNodes, type NodeConstraint } from "../../_shared/node-constraints.ts";
import { evaluateChecks, ruleSignals, repeatedLearnings, RECURRING_GAP_AT, SIGNAL_ASKS, type RuleView, type Violation } from "../../_shared/constraint-rules.ts";
import { learningOf } from "../../_shared/node-memory.ts";
import { chainReport, CHAIN_REMEDIATIONS, type ChainGap, type ChainOutcome, type ChainReport } from "../../_shared/chain.ts";
import { servesOf } from "../../_shared/vision-sentences.ts";
import { loadServedVision, servedVisionText, type ServedVision } from "../../_shared/served-vision.ts";
import { getEffectiveTier, getProjectTier } from "../../_shared/deployment.ts";
import { workflowsAllowed } from "../../_shared/workflow-gate.ts";
import { UNTRUSTED_ADVISORY, wrapField } from "../../_shared/untrusted-data.ts";
import { liveNodeIdSet, filterMappingsToLiveNodes } from "../../_shared/mapping-liveness.ts";
import { findExistingTestArtifact, statementGaps } from "../../_shared/plan-cases.ts";
import { testPlanFingerprint, type RequirementContext } from "../../_shared/mcp-context-assembly.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, resolveBranchId, UUID_RE, actorLabel, credentialOf } from "../shared.ts";
import { nodeLeasesOfOthers } from "./checkouts.ts";
import { waitingProposals } from "./change-router.ts";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

// Spec plane loading shared by generate_task_docs and get_build_readiness: requirements
// grouped per node + the REQ -> nodes map (same shape the generator's original internal
// caller used). N5.13 (bench AI finding): mappings are spec-global and can reference
// nodes deleted from THIS branch — filter rows against the live node set so phantom
// UUIDs never reach packets or readiness reports (read-time pruning per
// mapping-liveness.ts; write-time cascade is wrong across branches).
async function loadSpecPlane(supabase: SupabaseClient, projectId: string, liveNodeIds: Set<string>): Promise<{
  /** AA.1: the chain reads every requirement of this specification, mapped or not. */
  specId: string | null;
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
  return { specId: spec ? String(spec.id) : null, vision, requirementsByNode, requirementNodeMap, requirementRowIdMap };
}

/** AA.6: node id → the requirement ROW uuids mapped to it, for loadServedVision. */
function requirementRowsByNode(nodes: AnyRecord[], requirementsByNode: Record<string, AnyRecord[]>, requirementRowIdMap: Record<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const n of nodes) {
    const id = String(n.id);
    out.set(id, (requirementsByNode[id] ?? []).map((r) => requirementRowIdMap[String(r.requirementId)]).filter((x): x is string => !!x));
  }
  return out;
}

export async function handleGenerateTaskDocs(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id?: string; node_ids?: string[]; external_agent?: string },
): Promise<MCPResponse> {
  if (!checkScope(auth, 'propose')) {
    return { success: false, error: 'Insufficient permissions: propose scope required' };
  }
  if (!args.project_id) {
    return { success: false, error: 'project_id is required (branch_id is optional and defaults to the primary branch)' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId!, args.project_id);
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
  if (!branch) return { success: false, error: 'Branch not found' };

  const { data: snapshot } = await supabase
    .from('graph_snapshots')
    .select('graph_data, patch_sequence')
    .eq('branch_id', branchId)
    .order('patch_sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const graph = (snapshot?.graph_data ?? {}) as AnyRecord;
  const nodes = Object.values((graph.nodes ?? {}) as AnyRecord) as AnyRecord[];
  if (nodes.length === 0) {
    return { success: false, error: 'Branch has no nodes — propose an architecture first, then generate task docs.' };
  }
  // AL.11: the graph version these documents are generated from. The accept
  // compares the branch's later patches against it and applies nothing when
  // one changed a document or its node meanwhile. Not best-effort: without it
  // a later accept would overwrite whatever landed in between.
  const { data: headRow, error: headError } = await supabase
    .from('graph_patches').select('sequence').eq('branch_id', branchId)
    .order('sequence', { ascending: false }).limit(1).maybeSingle();
  if (headError) {
    return { success: false, error: `Could not read the branch's head, so no task document was generated: ${headError.message}` };
  }
  const head = typeof (headRow as { sequence?: unknown } | null)?.sequence === 'number' ? (headRow as { sequence: number }).sequence : 0;
  const snapshotSequence = (snapshot as { patch_sequence?: unknown } | null)?.patch_sequence;
  const baseSequence = typeof snapshotSequence === 'number' && snapshotSequence < head ? snapshotSequence : head;

  const catalogs = await loadCatalogs(supabase, { projectIds: [projectId] });

  const { vision, requirementsByNode, requirementNodeMap, requirementRowIdMap } = await loadSpecPlane(supabase, projectId, liveNodeIdSet(graph.nodes as Record<string, unknown>));

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
  const packetNodes: string[] = [];

  // A4 (docs/WORK_LOOP_PLAN.md): one batch read of recorded task done-state so
  // regenerated docs render `[x]` for done tasks instead of wiping progress.
  // Best-effort: with no state (or a read failure) generation renders every
  // box unticked — the pre-A4 output, never an error.
  let taskStateByNode = new Map<string, Map<string, boolean>>();
  try {
    taskStateByNode = await loadTaskStateByNode(supabase, projectId);
  } catch { /* generation proceeds stateless */ }

  // AA.0 (R.2a): the constraints each node must honour, in one batch. Unlike
  // task state this is not best-effort: a doc generated without them would
  // tell the agent there are none.
  let constraintsByNode: Map<string, NodeConstraint[]>;
  try {
    constraintsByNode = await loadNodeConstraints(supabase, projectId, leafNodes.map((n: AnyRecord) => String(n.id)), undefined, graph);
  } catch (err) {
    return { success: false, error: `Could not read the project's constraints, so no task document was generated: ${err instanceof Error ? err.message : String(err)}` };
  }

  // AA.6: the vision sentences each node serves. Not best-effort either: a doc
  // generated without them would say the node serves nothing.
  let servedByNode: Map<string, ServedVision>;
  try {
    servedByNode = await loadServedVision(supabase, projectId, branchId, vision, requirementRowsByNode(leafNodes, requirementsByNode, requirementRowIdMap));
  } catch (err) {
    return { success: false, error: `Could not read which vision sentences these nodes serve, so no task document was generated: ${err instanceof Error ? err.message : String(err)}` };
  }

  // AL.11 (owner 2026-10-01: "Fix task document checkout, this is critical"):
  // a task document changes only when nobody else is working from it. A node
  // another agent holds (the node itself, or task or code work inside it)
  // keeps its document as it is, and so does a node whose document a waiting
  // proposal already changes. The other nodes are generated; each one held
  // back says by whom. Neither read is best-effort: a failed read generates
  // nothing rather than writing over someone's work.
  const leases = await nodeLeasesOfOthers(supabase, auth, projectId);
  if (leases.error) {
    return { success: false, error: `Could not read who holds these nodes, so no task document was generated: ${leases.error}` };
  }
  const waiting = await waitingProposals(supabase, projectId);
  if (!waiting) {
    return { success: false, error: 'Could not read the waiting proposals, so no task document was generated. Try again.' };
  }
  const waitingOn = new Map<string, { id: string; by: string }>();
  for (const w of waiting) for (const k of w.keys) if (!waitingOn.has(k)) waitingOn.set(k, { id: w.id, by: w.by });
  const held: AnyRecord[] = [];
  // AL.29: what each doc still asks of the agent, as it stands after this call:
  // the open work orders with no step under them and the steps kept for review.
  const workOrdersWithoutSteps: AnyRecord[] = [];
  const stepsToReview: AnyRecord[] = [];
  const noteSteps = (node: AnyRecord, artifactId: string, path: string, doc: string) => {
    const gaps = stepGaps(doc);
    const at = { nodeId: String(node.id), label: node.label, artifactId, path };
    if (gaps.withoutSteps.length > 0) {
      workOrdersWithoutSteps.push({ ...at, workOrders: gaps.withoutSteps.map((w) => ({ id: w.id, key: w.key, title: wrapField(w.title) })) });
    }
    if (gaps.toReview > 0) stepsToReview.push({ ...at, steps: gaps.toReview });
  };
  const stepFields = (): AnyRecord => ({
    ...(workOrdersWithoutSteps.length > 0 ? { workOrdersWithoutSteps } : {}),
    ...(stepsToReview.length > 0 ? { stepsToReview } : {}),
    ...(workOrdersWithoutSteps.length > 0 || stepsToReview.length > 0 ? { stepFormat: STEP_FORMAT } : {}),
  });

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
    const existingDoc = findExistingTaskArtifact((graph.artifacts ?? {}) as AnyRecord, node.id) as AnyRecord | null;
    const lease = leases.byNode.get(String(node.id))
      ?? (node.parentId && leases.byNode.get(String(node.parentId))?.level === 'node'
        && (catalogs.nodeRoles[node.type]?.capability_tags ?? []).includes('part')
        ? leases.byNode.get(String(node.parentId)) : undefined);
    if (lease) {
      const where = lease.node_id === node.id ? (lease.level === 'node' ? 'holds the node' : `holds ${lease.level} work in it`) : 'holds the node it is a part of';
      const line = `${node.label}: ${lease.holder_label} ${where} since ${lease.since}, so its task document was left as it is. Ask them, or regenerate it once the hold ends.`;
      held.push({ nodeId: node.id, label: node.label, by: lease.holder_label, since: lease.since, level: lease.level, line });
      skipped.push(line);
      continue;
    }
    const waits = (existingDoc ? waitingOn.get(`artifact:${existingDoc.id}`) : undefined) ?? waitingOn.get(`taskdoc:${node.id}`);
    if (waits) {
      const line = `${node.label}: proposal ${waits.id} (from ${waits.by}) already changes its task document, so it was left as it is. The user accepts or rejects that one first.`;
      held.push({ nodeId: node.id, label: node.label, by: waits.by, proposalId: waits.id, line });
      skipped.push(line);
      continue;
    }
    const nodeForGen = {
      id: node.id, label: node.label, type: node.type,
      technology: node.technology, parentId: node.parentId,
      metadata: node.metadata,
    };
    // deno-lint-ignore no-explicit-any
    const served = servedByNode.get(String(node.id));
    const content = generateTaskDocument({
      node: nodeForGen, graph, catalogs, requirements: reqs,
      servedVision: served, requirementNodeMap,
      taskState: taskStateByNode.get(node.id),
      constraints: constraintsByNode.get(node.id),
      // deno-lint-ignore no-explicit-any
    } as any);
    // deno-lint-ignore no-explicit-any
    const fp = computeTaskContextFingerprint(nodeForGen as any, graph as any, reqs as any, servedVisionText(served), catalogs as any, constraintsByNode.get(node.id));

    const existing = existingDoc;
    // N5.17: authored Implementation Context survives regeneration; REVIEW-NEEDED
    // is flagged only when the derived context actually changed (fingerprint flip),
    // not on a generator-version content diff. Y: so does the person's Added Tasks.
    // AL.29: and so do the steps the agent wrote under each work order.
    const preserved = existing
      ? carryAgentTaskContent(content, String(existing.content ?? ''), {
        flagReview: fp.fingerprint !== existing.metadata?.taskContextFingerprint?.fingerprint,
      })
      : content;
    // A4: reconcile state rows against the keys this regeneration actually
    // emits — vanished keys are ORPHANED (never deleted), reappearing keys
    // restored. Y: against the doc as it will be stored, Added Tasks included,
    // so a person's task is never orphaned by the list regenerating around it.
    // Best-effort: reconciliation must never fail a generation.
    try {
      await reconcileTaskItemOrphans(supabase, projectId, node.id, preserved);
    } catch { /* non-fatal */ }

    if (existing) {
      noteSteps(node, String(existing.id), String(existing.path ?? ''), preserved);
      if (existing.content === preserved) { alreadyFresh++; continue; }
      patches.push({
        type: 'update_artifact',
        metadata: meta(`Refresh task document for ${node.label}`),
        payload: {
          id: existing.id,
          changes: {
            content: preserved, status: 'draft', updatedAt: now,
            // AA.7: the fingerprints the document has carried, for the node's memory flags.
            metadata: { ...recordFingerprint(existing.metadata as Record<string, unknown> | undefined, fp), stale: false },
          },
        },
      });
      explanations.push(`Regenerated task packet for ${node.label} (context changed since last generation)`);
      refreshed++;
      packetNodes.push(String(node.id));
    } else {
      const artifactId = crypto.randomUUID();
      const path = getTaskDocumentPath(String(node.label ?? 'node'), String(node.id));
      noteSteps(node, artifactId, path, content);
      patches.push({
        type: 'add_artifact',
        metadata: meta(`Generate task document for ${node.label}`),
        payload: {
          id: artifactId, nodeId: node.id, kind: 'task',
          path,
          content, language: 'markdown', status: 'draft',
          description: `Implementation task document for ${node.label}`,
          createdAt: now, updatedAt: now,
          metadata: recordFingerprint({}, fp),
        },
      });
      explanations.push(`Generated task packet for ${node.label}: mapped requirements, contracts, neighbors, and technology context`);
      created++;
      packetNodes.push(String(node.id));
      // AL.28: the add_artifact links the node itself; no update_node setting the
      // node's whole list from this read (it failed under Auto, and could unlink
      // a file another agent added to the node meanwhile).
    }
  }

  // R.2c: guidance is used when it reaches a packet; its count says so.
  const guided: Record<string, { fired: number }> = {};
  for (const id of packetNodes) for (const c of constraintsByNode.get(id) ?? []) if (c.kind !== 'check') guided[c.id] = { fired: 1 };
  await countConstraintUse(supabase, projectId, guided);

  if (patches.length === 0 && held.length > 0) {
    return {
      success: false,
      error: `No task document was generated. ${held.map((h) => h.line).join(' ')}`,
      data: { generated: 0, refreshed: 0, alreadyFresh, held, skipped },
    };
  }
  if (patches.length === 0) {
    return {
      success: true,
      data: {
        generated: 0, refreshed: 0, alreadyFresh, skipped,
        ...stepFields(),
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

  // O.2: the nickname when given, else the proven credential. Never 'external-mcp-agent'.
  const externalAgent = actorLabel(auth, args.external_agent);
  const cred = credentialOf(auth);
  const aiRunId = crypto.randomUUID();
  const { error: runError } = await supabase.from('ai_runs').insert({
    id: aiRunId, project_id: projectId, branch_id: branchId,
    model: 'task-generator', prompt_hash: 'mcp-task-docs', status: 'completed',
    completed_at: now,
    metadata: { source: 'mcp-task-docs', requestedBy: externalAgent, patchCount: patches.length, authMethod: auth.authMethod, apiKeyId: auth.keyId || null, credential: cred.delegate, credentialLabel: cred.label },
  });
  if (runError) return { success: false, error: `Failed to create AI run: ${runError.message}` };

  const proposalId = crypto.randomUUID();
  const { error: proposalError } = await supabase.from('ai_proposals').insert({
    id: proposalId, ai_run_id: aiRunId,
    source_branch_id: branchId, proposal_branch_id: branchId,
    status: 'pending',
    patches: patches.map((patch, i) => ({ patch, status: 'pending', explanation: explanations[i] ?? patch.metadata.summary })),
    validation_expectations: [],
    metadata: { source: 'mcp-task-docs', requestedBy: externalAgent, authMethod: auth.authMethod, apiKeyId: auth.keyId || null, credential: cred.delegate, credentialLabel: cred.label, baseSequence },
  });
  if (proposalError) return { success: false, error: `Failed to create proposal: ${proposalError.message}` };

  return {
    success: true,
    data: {
      proposalId, aiRunId,
      generated: created, refreshed, alreadyFresh, skipped,
      ...(held.length > 0 ? { held } : {}),
      ...stepFields(),
      baseSequence,
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
  "container-edge": "An edge ends on a container (a host, a place or a group) instead of a node. Ask the user which node inside is meant, then propose update_edge moving that end to it (relatedNodeIds are the nodes inside). Stored edges are never rewritten for you.",
  // AL.29 (5.1): the project rows for the bullets an agent writes.
  steps: "Write each work order's steps under its task line in the node's task document, in the stepFormat generate_task_docs returns, and send them with propose_patches update_artifact passing base_sequence.",
  statements: "Call get_test_plan for each named requirement and write a statement under each case in its testCasesWithoutStatements, in its statementFormat; send them with propose_patches update_artifact passing base_sequence.",
  review: "Move each line under \"Steps to review\" or \"Statements to review\" to the work order or test case it now belongs to, or delete it, in the same update_artifact as other edits to that document.",
  "test-plans": "Call get_test_plan for each named requirement: it serves the plan regenerated, with the statements and Test Strategy kept, and files the refresh for the user to accept.",
  constraint: "Each names a check this project holds to that the architecture breaks now. Change the architecture so it holds (propose_patches), or, when the break is intended, ask the user and file update_constraint { constraintId, addWaiver: { target, reason } } for them to accept. A refusing check stops only a proposal that adds a break; one already standing is reported here.",
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
  args: { project_id: string; branch_id?: string; node_ids?: string[]; detail?: 'summary' | 'full' },
  /** AA.1: the work queue reads only buildOrder, so it skips the chain's reads. */
  opts: { chain?: boolean } = {},
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }
  if (!args.project_id) {
    return { success: false, error: 'project_id is required (branch_id is optional and defaults to the primary branch)' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId!, args.project_id);
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
  if (!branch) return { success: false, error: 'Branch not found' };

  const { data: snapshot } = await supabase
    .from('graph_snapshots')
    .select('graph_data')
    .eq('branch_id', branchId)
    .order('patch_sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const graph = (snapshot?.graph_data ?? {}) as AnyRecord;
  const nodes = Object.values((graph.nodes ?? {}) as AnyRecord) as AnyRecord[];
  if (nodes.length === 0) {
    return { success: false, error: 'Branch has no nodes — propose an architecture first.' };
  }

  const catalogs = await loadCatalogs(supabase, { projectIds: [projectId] });
  // R6: vision joins the destructure — the readiness staleness check must hash
  // the SAME fields the generators stamp, or every packet reads stale forever.
  const { specId, vision, requirementsByNode, requirementNodeMap, requirementRowIdMap } = await loadSpecPlane(supabase, projectId, liveNodeIdSet(graph.nodes as Record<string, unknown>));

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

  // AA.0: the fingerprint hashes the constraints that apply, so readiness reads
  // them the way generation does, or every doc would read as stale.
  let readinessConstraints = new Map<string, NodeConstraint[]>();
  let projectConstraints: NodeConstraint[] | null = null;
  // R.2b: the same read gives the checks (one read of project_constraints).
  // AC: below Indie there are none: no note, no advisory, no signal.
  let rules: RuleView[] = [];
  let carried = false;
  try {
    const read = await loadConstraintsAndRules(supabase, projectId);
    carried = read.carried;
    if (carried) {
      ({ constraints: projectConstraints, rules } = read);
      readinessConstraints = await loadNodeConstraints(supabase, projectId, leafNodes.map((n: AnyRecord) => String(n.id)), projectConstraints, graph);
    }
  } catch { /* staleness is then judged without them; generation refuses loudly */ }
  // AA.6: and the vision sentences each node serves, the same way; read only
  // for the nodes that have a document to judge.
  let readinessServed = new Map<string, ServedVision>();
  try {
    const withDoc = leafNodes.filter((n: AnyRecord) => findExistingTaskArtifact((graph.artifacts ?? {}) as AnyRecord, n.id));
    readinessServed = await loadServedVision(supabase, projectId, branchId, vision, requirementRowsByNode(withDoc, requirementsByNode, requirementRowIdMap));
  } catch { /* judged as serving nothing; generation refuses loudly */ }

  // R.2b: the project's checks on the graph as it stands. A break is an
  // advisory on the nodes it touches, never a blocker: a refusing check
  // stops a proposal that adds a break, and nothing here waits on it.
  const checkRules = rules.filter((r) => r.kind === 'check');
  const breaksByNode = new Map<string, Violation[]>();
  if (checkRules.length > 0) {
    const rg = asRuleGraph(graph)!;
    const lanes = checkRules.some((r) => r.scopeKind === 'workflow')
      ? await workflowsServedByNodes(supabase, projectId, Object.keys(rg.nodes))
      : undefined;
    for (const v of evaluateChecks(checkRules, rg, lanes).violations) {
      for (const id of v.nodeIds) (breaksByNode.get(id) ?? breaksByNode.set(id, []).get(id)!).push(v);
    }
  }
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const breakDetail = (v: Violation) => {
    const r = ruleById.get(v.constraintId);
    const named = r && !r.mark && r.title ? ` "${r.title}"` : '';
    return `Breaks ${constraintRef(v.constraintId)}${named} (${v.severity === 'refuse' ? 'refuses' : 'warns'}): ${v.message}`;
  };

  const results: AnyRecord[] = [];
  const upstreamByNode = new Map<string, string[]>();
  // AL.29 (5.1): what the task docs and test plans of the nodes read here still
  // ask of an agent, counted with the readers generate_task_docs and
  // get_test_plan answer with; a plan is out of date by get_test_plan's rule.
  const asks = {
    withoutSteps: 0, stepDocs: [] as string[],
    withoutStatements: 0, statementPlans: [] as string[],
    toReview: 0, reviewIn: [] as string[],
    stalePlans: [] as string[],
  };
  const plansRead = new Set<string>();
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
      const fp = computeTaskContextFingerprint(node as any, graph as any, reqs as any, servedVisionText(readinessServed.get(String(node.id))), catalogs as any, readinessConstraints.get(String(node.id)));
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

    if (typeof existing?.content === 'string') {
      const gaps = stepGaps(existing.content);
      if (gaps.withoutSteps.length > 0) { asks.withoutSteps += gaps.withoutSteps.length; asks.stepDocs.push(String(node.label)); }
      if (gaps.toReview > 0) { asks.toReview += gaps.toReview; asks.reviewIn.push(String(node.label)); }
    }
    for (const r of reqs) {
      const reqId = String(r.requirementId);
      if (plansRead.has(reqId)) continue;
      plansRead.add(reqId);
      const plan = findExistingTestArtifact((graph.artifacts ?? {}) as Record<string, AnyRecord>, reqId, String(r.name), requirementRowIdMap[reqId]);
      if (typeof plan?.content !== 'string') continue;
      const gaps = statementGaps(plan.content);
      if (gaps.withoutStatements.length > 0) { asks.withoutStatements += gaps.withoutStatements.length; asks.statementPlans.push(reqId); }
      if (gaps.toReview > 0) { asks.toReview += gaps.toReview; asks.reviewIn.push(reqId); }
      const storedHash = (plan.metadata?.testContextFingerprint as AnyRecord | undefined)?.fingerprint;
      // deno-lint-ignore no-explicit-any
      if (storedHash && storedHash !== testPlanFingerprint(graph as any, catalogs, { ...(r as RequirementContext), rowId: requirementRowIdMap[reqId] }, requirementNodeMap[reqId] ?? []).fingerprint) {
        asks.stalePlans.push(reqId);
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
    for (const v of breaksByNode.get(String(node.id)) ?? []) {
      advisories.push({
        kind: 'constraint',
        detail: breakDetail(v),
        resolveWith: '',
        ...(v.nodeIds.length > 1 ? { relatedNodeIds: v.nodeIds.filter((id) => id !== node.id) } : {}),
      });
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

  // 8.3: the project-level advisory row — candidates (outcomes and imported
  // candidates alike) that were never promoted: still pending on this branch.
  // Advisory, never a blocker: the build brief is complete; the IDEATION is
  // ahead of the specification. One count, one row, the resolution named.
  const { count: candidatesOpen } = await supabase
    .from('requirement_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('branch_id', branchId)
    .eq('status', 'pending');
  const openCandidates = candidatesOpen ?? 0;
  const projectAdvisories: Array<{ kind: string; count: number; detail: string }> = openCandidates > 0
    ? [{ kind: 'candidates', count: openCandidates, detail: `${openCandidates} outcome${openCandidates === 1 ? '' : 's'} under Work ${openCandidates === 1 ? 'has' : 'have'} never been made a requirement` }]
    : [];
  // AL.29 (5.1): the bullets still to write, and the plans to refresh.
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (asks.withoutSteps > 0) projectAdvisories.push({ kind: 'steps', count: asks.withoutSteps, detail: `${plural(asks.withoutSteps, 'work order has', 'work orders have')} no step under ${asks.withoutSteps === 1 ? 'it' : 'them'} (task documents of ${asks.stepDocs.join(', ')})` });
  if (asks.withoutStatements > 0) projectAdvisories.push({ kind: 'statements', count: asks.withoutStatements, detail: `${plural(asks.withoutStatements, 'test case has', 'test cases have')} no statement under ${asks.withoutStatements === 1 ? 'it' : 'them'} (test plans of ${asks.statementPlans.join(', ')})` });
  if (asks.toReview > 0) projectAdvisories.push({ kind: 'review', count: asks.toReview, detail: `${plural(asks.toReview, 'step or statement waits', 'steps or statements wait')} for review, kept from a work order or criterion that was reworded or removed (${asks.reviewIn.join(', ')})` });
  if (asks.stalePlans.length > 0) projectAdvisories.push({ kind: 'test-plans', count: asks.stalePlans.length, detail: `${plural(asks.stalePlans.length, 'stored test plan is', 'stored test plans are')} out of date (${asks.stalePlans.join(', ')})` });

  // AA.1: the chain, by plan. Project-wide on every call (a node filter
  // narrows the node rows, never the chain). Reported, never enforced: no
  // node's `ready` moves and no other tool waits on it. A constraint that
  // reaches no node is judged on a whole-project read only.
  let chain: ChainReport | null = null;
  if (opts.chain !== false) {
    let unreached: string[] | undefined;
    if (filter.length === 0 && projectConstraints) {
      const reached = new Set<string>();
      for (const list of readinessConstraints.values()) for (const c of list) reached.add(c.id);
      unreached = projectConstraints.filter((c) => !reached.has(c.id)).map((c) => constraintRef(c.id));
    }
    chain = await loadChain(supabase, auth, projectId, resolved.project.role, branchId, specId, vision, projectConstraints ? projectConstraints.length : null, unreached);
  }

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
  if (chain) {
    for (const g of [...chain.blockers, ...chain.advisories]) remediations[g.kind] = CHAIN_REMEDIATIONS[g.kind];
  }
  for (const a of projectAdvisories) if (GAP_REMEDIATIONS[a.kind]) remediations[a.kind] = GAP_REMEDIATIONS[a.kind];
  if (openCandidates > 0) {
    remediations.candidates = 'Read get_outcome_board: each pending candidate is an outcome the user has not decided on. Propose a promotion (checkout_task at level outcome, then propose_patches with promote_candidate) or ask the user to settle or dismiss it in the Work view of the app; nothing here blocks the build.';
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

  // R.2c: what this project's own use says about its constraints, on a
  // whole-project read. Evidence and an ask; the agent drafts, the user decides.
  const constraintSignals: Array<Record<string, unknown>> = [];
  if (filter.length === 0 && carried) {
    for (const sig of ruleSignals(rules)) {
      const r = ruleById.get(sig.constraintId);
      constraintSignals.push({ signal: sig.signal, constraintId: sig.constraintId, ref: constraintRef(sig.constraintId), ...(r && !r.mark && r.title ? { title: r.title } : {}), evidence: sig.detail, ask: SIGNAL_ASKS[sig.signal] });
    }
    const schemaNodes = results.filter((r) => (r.blockers as ReadinessGap[]).some((g) => g.kind === 'schema')).map((r) => String(r.nodeId));
    const hasSchemaCheck = rules.some((r) => r.check?.predicate === 'contract_has_schema');
    if (schemaNodes.length >= RECURRING_GAP_AT && !hasSchemaCheck) {
      constraintSignals.push({ signal: 'recurring_gap', gap: 'schema', nodeIds: schemaNodes, evidence: `${schemaNodes.length} nodes build against a connection with no contract schema.`, ask: SIGNAL_ASKS.recurring_gap });
    }
    const learned = nodes
      .map((n) => ({ nodeId: String(n.id), doc: findExistingTaskArtifact((graph.artifacts ?? {}) as AnyRecord, n.id) as AnyRecord | null }))
      .map(({ nodeId, doc }) => ({ nodeId, text: learningOf(doc?.content)?.text ?? '' }))
      .filter((e) => e.text);
    for (const hit of repeatedLearnings(learned)) {
      constraintSignals.push({ signal: 'repeated_learning', text: hit.text, nodeIds: hit.nodeIds, evidence: `Written in the Implementation Context of ${hit.nodeIds.length} nodes.`, ask: SIGNAL_ASKS.repeated_learning });
    }
  }

  const chainGaps = chain ? chain.blockers.length : 0;
  return {
    success: true,
    data: {
      detail: detailLevel,
      nodes: nodeRows,
      // 8.3: the Readiness · CANDIDATES OPEN row — advisory, project-wide.
      candidatesOpen: openCandidates,
      projectAdvisories,
      ...(chain ? { chain: shapeChain(chain, detailLevel), untrustedDataAdvisory: UNTRUSTED_ADVISORY } : {}),
      ...(constraintSignals.length > 0 ? { constraintSignals } : {}),
      remediations,
      buildOrder,
      ...(cyclic ? { buildOrderNote: 'Contract cycle detected — the tail of buildOrder is alphabetical, not topological.' } : {}),
      message: (blockedCount === 0
        ? `All ${results.length} node(s) are ready to build. Follow buildOrder.`
        : `${blockedCount} of ${results.length} node(s) have blocking gaps.`)
        + (openCandidates > 0 ? ` ${openCandidates} outcome${openCandidates === 1 ? '' : 's'} under Work ${openCandidates === 1 ? 'has' : 'have'} never been made a requirement (advisory).` : '')
        + (chainGaps > 0 ? ` The chain from vision to requirements has ${chainGaps} blocking gap${chainGaps === 1 ? '' : 's'} (${chain!.blockers.map((g) => g.kind).join(', ')}); nothing waits on ${chainGaps === 1 ? 'it' : 'them'}, so close ${chainGaps === 1 ? 'it' : 'them'} alongside the build.` : ''),
      // WS1: ~120 chars — the how lives in remediations, keyed by gap kind.
      nextAction: blockedCount === 0
        ? (chainGaps > 0
          ? 'Implement in buildOrder per each node\'s task document; alongside, close the chain gaps per remediations.'
          : 'Implement in buildOrder per each node\'s task document, expanding its work orders first.')
        : 'Fix per remediations (keyed by gap kind), then re-check blocked nodes with node_ids for full gap detail.',
    },
  };
}

// ── AA.1: the chain's reads ─────────────────────────────────────────────────
// All batch, none per row: the outcomes on the branch, every derivation of
// the project, every live requirement of the specification, and (on plans
// with Workflows) the branch's step maps. The rules are pure, in
// _shared/chain.ts. A failed outcome read reports no chain rather than a
// wrong one.
async function loadChain(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  role: string | undefined,
  branchId: string,
  specId: string | null,
  vision: string | undefined,
  constraintsRecorded: number | null,
  unreachedConstraints: string[] | undefined,
): Promise<ChainReport | null> {
  let tier: Awaited<ReturnType<typeof getEffectiveTier>> = 'community';
  try { tier = await getProjectTier(supabase, projectId, auth.userId, { role }); } catch { /* fail closed */ }
  const workflows = workflowsAllowed(tier);

  const { data: candRows, error: candErr } = await supabase
    .from('requirement_candidates')
    .select('id, key, kind, name, status, evidence, mark')
    .eq('project_id', projectId)
    .eq('branch_id', branchId)
    .neq('status', 'dismissed');
  if (candErr) return null;
  const candidates = (Array.isArray(candRows) ? candRows : []) as Array<{ id: string; key: string; kind: string; name: string; status: string; evidence: unknown; mark: string | null }>;

  const { data: derRows } = await supabase
    .from('outcome_derivations')
    .select('candidate_id, requirement_row_id')
    .eq('project_id', projectId);
  const derivations = (Array.isArray(derRows) ? derRows : []) as Array<{ candidate_id: string; requirement_row_id: string }>;
  const derivedBy = new Map<string, number>();
  const withOrigin = new Set<string>();
  for (const d of derivations) {
    derivedBy.set(d.candidate_id, (derivedBy.get(d.candidate_id) ?? 0) + 1);
    withOrigin.add(d.requirement_row_id);
  }

  let requirements: Array<{ id: string; requirement_id: string; name: string; mark: string | null; archived_at: string | null }> = [];
  if (specId) {
    const { data: reqRows } = await supabase
      .from('specification_requirements')
      .select('id, requirement_id, name, mark, archived_at')
      .eq('specification_id', specId);
    requirements = ((Array.isArray(reqRows) ? reqRows : []) as typeof requirements).filter((r) => !r.archived_at);
  }

  const onStep = new Set<string>();
  if (workflows && candidates.length > 0) {
    const { data: mapRows } = await supabase
      .from('outcome_step_maps')
      .select('candidate_id')
      .eq('branch_id', branchId);
    for (const m of (Array.isArray(mapRows) ? mapRows : []) as Array<{ candidate_id: string }>) onStep.add(m.candidate_id);
  }

  const outcomes: ChainOutcome[] = candidates.map((c) => ({
    id: c.id, key: c.key, name: c.name, kind: c.kind, status: c.status, mark: c.mark ?? null,
    serves: servesOf(c.evidence), derived: derivedBy.get(c.id) ?? 0, onStep: onStep.has(c.id),
  }));
  return chainReport({
    vision,
    workflows,
    outcomes,
    requirements: requirements.map((r) => ({ requirementId: r.requirement_id, name: r.name, mark: r.mark ?? null, hasOrigin: withOrigin.has(r.id) })),
    constraintsRecorded,
    unreachedConstraints,
  });
}

/** The chain as readiness emits it: user-authored words in the envelope; items only at detail 'full'. */
function shapeChain(chain: ChainReport, detail: 'summary' | 'full'): AnyRecord {
  const gap = (g: ChainGap): AnyRecord => {
    const count = (g.items?.length ?? 0) + (g.more ?? 0);
    if (!g.items) return { kind: g.kind, detail: g.detail };
    if (detail === 'summary') return { kind: g.kind, detail: g.detail, count };
    return {
      kind: g.kind,
      detail: g.detail,
      count,
      items: g.items.map((i) => ({ id: i.id, label: wrapField(i.label), ...(i.was ? { was: wrapField(i.was) } : {}), ...(i.mark ? { mark: i.mark } : {}) })),
      ...(g.more ? { more: g.more } : {}),
    };
  };
  return {
    ready: chain.ready,
    counts: chain.counts,
    blockers: chain.blockers.map(gap),
    advisories: chain.advisories.map(gap),
    notes: chain.notes,
  };
}

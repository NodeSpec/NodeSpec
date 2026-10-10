// P1-7 C1: the packet freshness gate. The product's core value is that the user's AI works
// from SMALL context packets — a node's task doc carries exactly the REQs, contracts, and
// neighbors that one component needs. Those packets are DERIVED, never authored (see the
// authority table in docs/GITOPS_README.md), so the push must never ship a stale one: when an
// accepted proposal changed a fingerprint input (REQ signatures, edges/contract schemas,
// neighbors), the affected task doc is regenerated — deterministically, no LLM — into the same
// commit.
//
// Placement: push-time PROJECTION over the in-memory graph, the same pattern as
// ARCHITECTURE.md. There is no server-side patch engine (patch application is client-core
// only), so the DB snapshot keeps the last generated copy as a cache; the REPO — the surface
// the repo-side AI actually consumes — is always fresh. Mutating the graph object BEFORE
// extractArtifactFiles/serializeModel means the pushed file, the anchor, and ARCHITECTURE.md
// all agree within the commit.
//
// Provenance guard: only artifacts carrying `metadata.taskContextFingerprint` are managed by
// the generator and eligible for regeneration. A task-kind artifact WITHOUT a fingerprint is
// user-authored — never overwritten.
//
// C4 step 2 extends the same gate to `kind='test-plan'` artifacts (guarded by
// `metadata.testContextFingerprint`), with one addition: the plan's editable
// "## Test Strategy" section is preserved through regeneration.

import { loadCatalogs } from "./catalog-loader.ts";
import { liveNodeIdSet, filterMappingsToLiveNodes } from "./mapping-liveness.ts";
import { loadTaskStateByNode, reconcileTaskItemOrphans } from "./task-deltas.ts";
import { loadNodeConstraints, type NodeConstraint } from "./node-constraints.ts";
import { loadServedVision, servedVisionText, type ServedVision } from "./served-vision.ts";
import { recordFingerprint } from "./node-memory.ts";
import {
  generateTaskDocument,
  computeTaskContextFingerprint,
  carryAgentTaskContent,
} from "./task-document-generator.ts";
import {
  generateTestDocument,
  computeTestContextFingerprint,
  findExistingTestArtifact,
  carryAgentPlanContent,
} from "./test-document-generator.ts";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

export interface PacketRefreshResult {
  /** Managed task-doc artifacts whose fingerprint was recomputed. */
  checked: number;
  /** How many were stale and had their content regenerated in-memory. */
  refreshed: number;
  refreshedPaths: string[];
  /** Task-kind artifacts without a generator fingerprint (user-authored) — never touched. */
  skippedUnmanaged: number;
  // C4 step 2: the same gate, extended to requirement-scoped test plans. Same provenance
  // guard (metadata.testContextFingerprint = generator-managed; absent = user-authored,
  // never touched), with one extra respect: the plan's "## Test Strategy" section is
  // explicitly editable, so a regenerate carries the user's section body forward.
  /** Managed test-plan artifacts whose fingerprint was recomputed. */
  testPlansChecked: number;
  /** How many test plans were stale and regenerated in-memory (Test Strategy preserved). */
  testPlansRefreshed: number;
  testPlansRefreshedPaths: string[];
  /** Test-plan artifacts without a generator fingerprint (user-authored) — never touched. */
  testPlansSkippedUnmanaged: number;
  /** R.1b: with `checkOnly`, the managed task docs whose fingerprint moved
   *  (the next push regenerates them); nothing is regenerated or written. */
  stalePaths?: string[];
  /** AL.29: each artifact whose content was regenerated, as the update that saves it
   *  (git-push files these, so NodeSpec stores what it pushed). */
  saves: PacketSave[];
  error?: string;
}

/** AL.29: one regenerated task doc or test plan, as the update_artifact changes that save it. */
export interface PacketSave {
  id: string;
  path: string;
  kind: "task" | "test-plan";
  changes: { content: string; updatedAt: string; metadata: AnyRecord };
}

const EMPTY: PacketRefreshResult = {
  checked: 0, refreshed: 0, refreshedPaths: [], skippedUnmanaged: 0,
  testPlansChecked: 0, testPlansRefreshed: 0, testPlansRefreshedPaths: [], testPlansSkippedUnmanaged: 0,
  saves: [],
};

/**
 * Recompute task-doc fingerprints for the graph and regenerate stale docs IN MEMORY.
 * Mutates `graph.artifacts[*].content/updatedAt/metadata` for stale managed packets only.
 * Never throws — a failed refresh must never block a push (the stale doc still shipping is
 * strictly no worse than before C1).
 */
// deno-lint-ignore no-explicit-any
export async function refreshTaskPackets(
  supabase: any, projectId: string, graph: AnyRecord, branchId: string | null = null,
  opts?: { checkOnly?: boolean; nodeIds?: string[] },
): Promise<PacketRefreshResult> {
  try {
    const artifacts = (graph?.artifacts ?? {}) as Record<string, AnyRecord>;
    const taskArtifacts = Object.values(artifacts).filter((a) => a?.kind === "task");
    const testPlanArtifacts = Object.values(artifacts).filter((a) => a?.kind === "test-plan");
    if (taskArtifacts.length === 0 && testPlanArtifacts.length === 0) return { ...EMPTY };

    // R.1b: a check reads only the nodes it names and writes nothing.
    const onlyNodes = opts?.nodeIds ? new Set(opts.nodeIds) : null;
    const fingerprinted = taskArtifacts.filter((a) => a?.metadata?.taskContextFingerprint?.fingerprint);
    const skippedUnmanaged = taskArtifacts.length - fingerprinted.length;
    const managed = onlyNodes ? fingerprinted.filter((a) => onlyNodes.has(String(a.nodeId))) : fingerprinted;
    // C4 step 2: same provenance guard for plans — only fingerprint-managed ones refresh.
    const managedPlans = testPlanArtifacts.filter((a) => a?.metadata?.testContextFingerprint?.fingerprint);
    const testPlansSkippedUnmanaged = testPlanArtifacts.length - managedPlans.length;
    if (managed.length === 0 && managedPlans.length === 0) {
      return { ...EMPTY, skippedUnmanaged, testPlansSkippedUnmanaged };
    }

    const catalogs = await loadCatalogs(supabase, { projectIds: [projectId] });

    // Spec plane: same load shape the generator's original caller used — requirements grouped
    // per node plus the REQ -> all-mapped-nodes map for cross-node attribution. C4 also keeps
    // each requirement once, keyed by human REQ id, for the test-plan pass (its axis is the
    // requirement, not the node).
    let vision: string | undefined;
    const requirementsByNode: Record<string, AnyRecord[]> = {};
    const requirementNodeMap: Record<string, string[]> = {};
    const requirementsByHumanId: Record<string, AnyRecord> = {};
    // AA.6: node id → requirement ROW uuids, for the served vision.
    const requirementRowsByNode = new Map<string, string[]>();
    const { data: spec } = await supabase
      .from("project_specifications")
      .select("id, vision")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (spec) {
      vision = spec.vision || undefined;
      const { data: rawMappings } = await supabase
        .from("specification_mappings")
        .select("requirement_id, node_id")
        .eq("specification_id", spec.id);
      // N5.13: prune mappings whose node no longer exists on THIS branch — otherwise a
      // C1 refresh writes phantom node UUIDs into the packet's "Shared with" lines.
      const mappings = filterMappingsToLiveNodes(
        (rawMappings ?? []) as Array<{ requirement_id: string; node_id: string }>,
        liveNodeIdSet(graph.nodes as Record<string, unknown> | undefined),
      );
      if (mappings && mappings.length > 0) {
        const reqRowIds = [...new Set((mappings as AnyRecord[]).map((m) => m.requirement_id))];
        const { data: reqs } = await supabase
          .from("specification_requirements")
          .select("id, requirement_id, name, description, category, status, acceptance_criteria")
          .in("id", reqRowIds);
        const reqMap = new Map(((reqs ?? []) as AnyRecord[]).map((r) => [r.id, r]));
        for (const m of mappings as AnyRecord[]) {
          const req = reqMap.get(m.requirement_id);
          if (!req) continue;
          const humanId = String(req.requirement_id);
          if (!requirementNodeMap[humanId]) requirementNodeMap[humanId] = [];
          if (!requirementNodeMap[humanId].includes(m.node_id)) requirementNodeMap[humanId].push(m.node_id);
          if (!requirementsByNode[m.node_id]) requirementsByNode[m.node_id] = [];
          requirementRowsByNode.set(m.node_id, [...(requirementRowsByNode.get(m.node_id) ?? []), String(req.id)]);
          const reqForGen = {
            requirementId: humanId,
            name: String(req.name ?? ""),
            description: String(req.description ?? ""),
            category: String(req.category ?? ""),
            status: String(req.status ?? ""),
            acceptanceCriteria: req.acceptance_criteria ?? [],
          };
          requirementsByNode[m.node_id].push(reqForGen);
          if (!requirementsByHumanId[humanId]) requirementsByHumanId[humanId] = reqForGen;
        }
      }
    }

    const result: PacketRefreshResult = {
      ...EMPTY, skippedUnmanaged, testPlansSkippedUnmanaged,
      refreshedPaths: [], testPlansRefreshedPaths: [], saves: [],
    };
    const now = new Date().toISOString();

    // A4 (docs/WORK_LOOP_PLAN.md): recorded task done-state renders `[x]` in
    // refreshed docs. Best-effort — a state-read failure degrades to the
    // pre-A4 unticked rendering, never to a failed refresh.
    let taskStateByNode = new Map<string, Map<string, boolean>>();
    try {
      taskStateByNode = await loadTaskStateByNode(supabase, projectId);
    } catch { /* refresh proceeds stateless */ }

    // AA.0 (R.2a): the constraints each packet carries, in one batch. When they
    // cannot be read the task-doc pass is skipped rather than run without
    // them: a refresh would drop the block and tell the agent there are none.
    let constraintsByNode: Map<string, NodeConstraint[]> | null = null;
    try {
      constraintsByNode = await loadNodeConstraints(supabase, projectId, managed.map((a) => String(a.nodeId)), undefined, graph);
    } catch { constraintsByNode = null; }
    // AA.6: and the vision sentences each packet carries, the same way.
    let servedByNode: Map<string, ServedVision> | null = null;
    if (constraintsByNode) {
      try {
        const rows = new Map(managed.map((a) => [String(a.nodeId), requirementRowsByNode.get(String(a.nodeId)) ?? []]));
        servedByNode = await loadServedVision(supabase, projectId, branchId, vision, rows);
      } catch { servedByNode = null; }
    }

    for (const artifact of constraintsByNode && servedByNode ? managed : []) {
      const node = graph.nodes?.[artifact.nodeId];
      if (!node) continue; // orphaned doc; mapping-liveness rules own that cleanup

      const nodeForGen = {
        id: node.id, label: node.label, type: node.type,
        technology: node.technology, parentId: node.parentId,
        metadata: node.metadata,
      };
      const reqs = requirementsByNode[node.id] ?? [];

      // Full requirement objects, not just ids: the signature hashes name/description/
      // criteria (incl. met), so editing a requirement — or accepting a completion tick —
      // marks the packet stale. Ids alone were blind to content edits (fixed 2026-07-21).
      // deno-lint-ignore no-explicit-any
      const constraints = constraintsByNode!.get(String(node.id));
      const served = servedByNode!.get(String(node.id));
      const fp = computeTaskContextFingerprint(nodeForGen as any, graph as any, reqs as any, servedVisionText(served), catalogs as any, constraints);
      result.checked++;
      if (fp.fingerprint === artifact.metadata.taskContextFingerprint.fingerprint) continue;
      if (opts?.checkOnly) {
        result.stalePaths = [...(result.stalePaths ?? []), String(artifact.path ?? "")];
        continue;
      }

      // deno-lint-ignore no-explicit-any
      const regeneratedDoc = generateTaskDocument({
        node: nodeForGen, graph, catalogs, requirements: reqs,
        servedVision: served, requirementNodeMap,
        taskState: taskStateByNode.get(node.id),
        constraints,
        // deno-lint-ignore no-explicit-any
      } as any);
      // N5.17: the AI-authored Implementation Context section survives regeneration
      // verbatim; the fingerprint flip that got us here flags it REVIEW NEEDED (once).
      // Y: the person's Added Tasks section survives the same way. AL.29: and the
      // steps under each work order (the same function generate_task_docs uses).
      const content = carryAgentTaskContent(regeneratedDoc, String(artifact.content ?? ""), { flagReview: true });
      // A4: orphan-reconcile against the keys this refresh emits (flag, never
      // delete), Added Tasks included. Best-effort — must never fail the refresh.
      try {
        await reconcileTaskItemOrphans(supabase, projectId, node.id, content);
      } catch { /* non-fatal */ }

      // AA.7: the history grows by the flip that got us here.
      artifact.metadata = { ...recordFingerprint(artifact.metadata, fp), stale: false };
      if (content !== artifact.content) {
        artifact.content = content;
        artifact.updatedAt = now;
        result.refreshed++;
        result.refreshedPaths.push(String(artifact.path ?? ""));
        result.saves.push({ id: String(artifact.id), path: String(artifact.path ?? ""), kind: "task", changes: { content, updatedAt: now, metadata: artifact.metadata } });
      }
    }

    if (opts?.checkOnly) return result;

    // ── C4 step 2: the test-plan pass ─────────────────────────────────────────────
    // Requirement-scoped (implementation is node-scoped, acceptance is requirement-
    // scoped). Owner recovery: metadata.requirementId first; findExistingTestArtifact's
    // path matching doubles as the legacy fallback for pre-C4 plans, which then gain
    // the metadata key here.
    const reqList = Object.values(requirementsByHumanId);
    for (const artifact of managedPlans) {
      const metaReqId = artifact.metadata?.requirementId;
      const requirement =
        (metaReqId ? requirementsByHumanId[String(metaReqId)] : undefined) ??
        reqList.find((r) =>
          findExistingTestArtifact(
            { [String(artifact.id)]: artifact } as Record<string, AnyRecord>,
            String(r.requirementId),
            String(r.name),
          ) === artifact
        );
      if (!requirement) continue; // requirement deleted/unmapped; not this gate's cleanup

      const humanId = String(requirement.requirementId);
      const mappedNodeIds = requirementNodeMap[humanId] ?? [];
      const mappedNodes = mappedNodeIds
        .map((nid) => graph.nodes?.[nid])
        .filter(Boolean)
        .map((n: AnyRecord) => ({ nodeId: n.id, label: n.label, role: n.type, technology: n.technology }));
      // Mirror ensureTestDocumentForRequirement's filter exactly — the fingerprint must
      // be computed over the same inputs the MCP lane used, or every plan reads stale.
      const sourceArtifacts = Object.values(artifacts).filter(
        (a) => mappedNodeIds.includes(a.nodeId) && a.kind === "source" && a.status !== "suggested",
      );

      // deno-lint-ignore no-explicit-any
      const fp = computeTestContextFingerprint(requirement as any, mappedNodes as any, sourceArtifacts as any, graph as any, catalogs as any);
      result.testPlansChecked++;
      if (fp.fingerprint === artifact.metadata.testContextFingerprint.fingerprint) continue;

      // deno-lint-ignore no-explicit-any
      const regenerated = generateTestDocument({
        requirement, graph, catalogs, mappedNodes, sourceArtifacts,
        // deno-lint-ignore no-explicit-any
      } as any);
      // The editable section gets the same respect C1 gives user-authored docs: a
      // strategy body the user changed rides into the regenerated plan verbatim, and
      // (AL.29) so do the test-case statements. No vision: plans carry none (R1).
      const content = carryAgentPlanContent(regenerated, String(artifact.content ?? ""));

      artifact.metadata = { ...artifact.metadata, testContextFingerprint: fp, requirementId: humanId, stale: false };
      if (content !== artifact.content) {
        artifact.content = content;
        artifact.updatedAt = now;
        result.testPlansRefreshed++;
        result.testPlansRefreshedPaths.push(String(artifact.path ?? ""));
        result.saves.push({ id: String(artifact.id), path: String(artifact.path ?? ""), kind: "test-plan", changes: { content, updatedAt: now, metadata: artifact.metadata } });
      }
    }

    return result;
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : String(err) };
  }
}

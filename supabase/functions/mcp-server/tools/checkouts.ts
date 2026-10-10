// V3 P2 (task 2.2): the `checkouts` tool bucket — the agent-native work loop's
// lease surface. checkout_task claims work through agent_checkout_claim
// (20260913240000: atomic under the project row lock, stale holds reclaimed,
// advisory levels always insert); checkout_heartbeat keeps a lease fresh and
// carries progress display state (tests[], touches[]); release_checkout ends
// one with an audited reason; get_work_queue serves the next unblocked tasks
// in pinned order — the accepted work plan when one exists, else the
// deterministic fallback (node build order × task-doc order), which keeps P2
// independent of P6.
//
// Doctrine (docs/V3_OVERHAUL_PLAN.md pinned semantics): checkouts are
// ADVISORY to every shipped tool — report_test_results, task ticks and the
// rest never require a lease (no retro-gating). OSS core per ruling R1: no
// tier gate here; only the P6 plan tools are gated. Structural supabase
// param + type-only SupabaseClient so the bucket is offline-testable.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, holderIdentity, credentialLabel, UUID_RE, actorLabel } from "../shared.ts";
import { handleGetBuildReadiness } from "./tasks.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";
import { laterPatchFromRow, patchesTouchingNode, type PatchRowLike } from "../../_shared/patch-targets.ts";
import { getProjectTier } from "../../_shared/deployment.ts";
import { featureAllowed } from "../../_shared/feature-rules.ts";
import { leaseReach, normalizePath, criterionToken, taskToken, reachOf, outsideReach, reachOverlap, WHOLE_NODE } from "../../_shared/lease-reach.ts";
import { parseTaskDocTasks, stepGaps, STEP_FORMAT } from "../../_shared/task-deltas.ts";
import { loadGraphData } from "../../_shared/mcp-context-assembly.ts";
import { explodeSignalLine, fileGroups } from "../../_shared/explode-signal.ts";

const LEVELS = ["task", "code", "requirement", "outcome", "criterion", "node"] as const;
type CheckoutLevel = (typeof LEVELS)[number];
/** v3u (R3): the exclusive levels — one active lease per ref, stale reclaim.
 *  criterion is (requirement row, v3l criterion id): one criterion, one
 *  binding test, one reported outcome, said up front instead of a conflict
 *  receipt after the work. */
const EXCLUSIVE_LEVELS: readonly CheckoutLevel[] = ["task", "code", "criterion", "node"];
/** AA.5: the levels that work inside a node, with a reach. */
const WORK_LEVELS: readonly CheckoutLevel[] = ["task", "code"];
const RELEASE_REASONS = ["released", "verified", "resolved"] as const;

/** Stale threshold mirrors the RPC default: 30 silent minutes → stale-held. */
const STALE_AFTER_MS = 30 * 60 * 1000;

export function isStale(heartbeatAt: string | null | undefined): boolean {
  if (!heartbeatAt) return false;
  return Date.now() - new Date(heartbeatAt).getTime() > STALE_AFTER_MS;
}

/** AL.29 (gap 3): a work order as the branch's task doc lists it. withoutSteps:
 *  open with no step under it (3.3: the reader generate_task_docs answers with). */
export interface DocWorkOrder { nodeId: string; key: string; displayId: string; title: string; checked: boolean; docIndex: number; withoutSteps: boolean }

/** The work orders in the branch's task docs (one parser, the one the Plan
 *  board reads with), optionally for one node, and the docs with steps waiting
 *  under "Steps to review". A key two docs share counts once. */
async function readDocWorkOrders(supabase: SupabaseClient, branchId: string, nodeId?: string): Promise<{
  orders: DocWorkOrder[];
  stepsToReview: Array<{ nodeId: string; artifactId: string; path: string | null; steps: number }>;
}> {
  const graph = (await loadGraphData(supabase, branchId)) as { artifacts?: Record<string, { id?: string; kind?: string; nodeId?: string; path?: string; content?: unknown }> } | null;
  const orders: DocWorkOrder[] = [];
  const stepsToReview: Array<{ nodeId: string; artifactId: string; path: string | null; steps: number }> = [];
  const seen = new Set<string>();
  for (const [id, a] of Object.entries(graph?.artifacts ?? {})) {
    if (a.kind !== "task" || typeof a.content !== "string" || typeof a.nodeId !== "string") continue;
    if (nodeId && a.nodeId !== nodeId) continue;
    const gaps = stepGaps(a.content);
    const empty = new Set(gaps.withoutSteps.map((w) => w.key));
    if (gaps.toReview > 0) stepsToReview.push({ nodeId: a.nodeId, artifactId: a.id ?? id, path: a.path ?? null, steps: gaps.toReview });
    parseTaskDocTasks(a.content).tasks.forEach((t, docIndex) => {
      if (!t.key || seen.has(`${a.nodeId}::${t.key}`)) return;
      seen.add(`${a.nodeId}::${t.key}`);
      orders.push({ nodeId: a.nodeId!, key: t.key, displayId: t.displayId, title: t.title, checked: t.checked, docIndex, withoutSteps: empty.has(t.key) });
    });
  }
  return { orders, stepsToReview };
}

export interface TaskStateRow { id: string; node_id: string; task_key: string; display_id: string | null; title: string | null; done?: boolean | null; orphaned?: boolean | null; mark?: string | null }
export interface OpenWorkOrder { taskItemId: string | null; nodeId: string; taskKey: string; displayId: string | null; title: string | null; mark: string | null; docIndex: number; withoutSteps: boolean }

/**
 * AL.29 (gap 3): the open work. The docs say which work orders exist; a
 * task_items row, when there is one, says whether it is done or orphaned and
 * carries its mark. With no row, the doc's own box decides (the Plan board's
 * rule). A row whose key no doc lists stays open work while it is neither.
 * Pure.
 */
export function openWorkOrders(rows: TaskStateRow[], orders: DocWorkOrder[]): OpenWorkOrder[] {
  const rowByKey = new Map(rows.map((r) => [`${r.node_id}::${r.task_key}`, r]));
  const listed = new Set<string>();
  const open: OpenWorkOrder[] = [];
  for (const o of orders) {
    listed.add(`${o.nodeId}::${o.key}`);
    const row = rowByKey.get(`${o.nodeId}::${o.key}`);
    if (row ? row.done === true || row.orphaned === true : o.checked) continue;
    open.push({ taskItemId: row?.id ?? null, nodeId: o.nodeId, taskKey: o.key, displayId: o.displayId, title: o.title, mark: row?.mark ?? null, docIndex: o.docIndex, withoutSteps: o.withoutSteps });
  }
  for (const r of rows) {
    if (listed.has(`${r.node_id}::${r.task_key}`) || r.done === true || r.orphaned === true) continue;
    open.push({ taskItemId: r.id, nodeId: r.node_id, taskKey: r.task_key, displayId: r.display_id, title: r.title, mark: r.mark ?? null, docIndex: Number.MAX_SAFE_INTEGER, withoutSteps: false });
  }
  return open;
}

export async function handleCheckoutTask(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: {
    project_id: string;
    level?: string;
    task_item_id?: string;
    node_id?: string;
    task_key?: string;
    ref_id?: string;
    criterion_id?: string;
    branch_id?: string;
    proposal_id?: string;
    external_agent?: string;
    meta?: Record<string, unknown>;
    /** AA.5: the files this work will touch (task and code levels). None: the whole node. */
    touches?: string[];
  }
): Promise<MCPResponse> {
  if (!checkScope(auth, "write")) {
    return { success: false, error: "Insufficient permissions: write scope required" };
  }
  const level = (args.level ?? "task") as CheckoutLevel;
  if (!LEVELS.includes(level)) {
    return { success: false, error: `Unknown checkout level "${args.level}". Valid: ${LEVELS.join(", ")}.` };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ("error" in resolved) return resolved.error;
  const projectId = resolved.project.id;

  // Resolve the ref. Task-level accepts the queue's task_item_id directly, or
  // the (node_id, task_key) pair a task document anchors carry.
  let refId = args.ref_id ?? null;
  // AA.5: the node the work sits in, and (task level) the task's anchor key.
  let nodeId: string | null = null;
  let taskKey: string | null = null;
  let ownPath: string | null = null;
  let docs: Awaited<ReturnType<typeof readDocWorkOrders>> | null = null;
  if (level === "node") {
    nodeId = args.node_id?.trim() || null;
    if (!nodeId || !UUID_RE.test(nodeId)) {
      return { success: false, error: "A node checkout needs node_id: the node's UUID from get_architecture_overview." };
    }
    refId = null;
  } else if (level === "task") {
    refId = args.task_item_id ?? null;
    let state: { done?: boolean | null; orphaned?: boolean | null } | null = null;
    if (!refId && args.node_id && args.task_key) {
      const lookup = () => supabase
        .from("task_items")
        .select("id, done, orphaned")
        .eq("project_id", projectId)
        .eq("node_id", args.node_id!)
        .eq("task_key", args.task_key!)
        .maybeSingle();
      let { data: item, error } = await lookup();
      if (error) return { success: false, error: `Task lookup failed: ${error.message}` };
      if (!item) {
        // AL.29 (gap 3): a work order nobody has ticked or claimed has no row
        // yet. The node's task doc says it exists; the claim creates its row
        // (a row written meanwhile, by a tick or another claim, is kept).
        const branchId = args.branch_id ?? ((await getPrimaryBranch(supabase, projectId, "id")) as { id: string } | null)?.id ?? null;
        docs = branchId ? await readDocWorkOrders(supabase, branchId, args.node_id) : null;
        const order = docs?.orders.find((o) => o.key === args.task_key);
        if (!order) {
          return { success: false, error: `No work order with key ${args.task_key} in node ${args.node_id}'s task document. get_work_queue lists the open work orders with their node and key.` };
        }
        if (order.checked) {
          return { success: false, error: `Work order ${order.displayId} (${order.title}) is ticked done in its task document, so there is nothing to claim. get_work_queue lists the open work orders.` };
        }
        const { error: rowError } = await supabase.from("task_items").upsert({
          project_id: projectId, node_id: args.node_id, task_key: args.task_key,
          display_id: order.displayId, title: order.title, done: false, orphaned: false, provenance: {},
        }, { onConflict: "project_id,node_id,task_key", ignoreDuplicates: true });
        if (rowError) return { success: false, error: `Could not record the work order: ${rowError.message}` };
        ({ data: item, error } = await lookup());
        if (error || !item) return { success: false, error: `Task lookup failed: ${error?.message ?? "the row was not recorded"}` };
      }
      refId = (item as { id: string }).id;
      state = item as { done?: boolean | null; orphaned?: boolean | null };
      nodeId = args.node_id;
      taskKey = args.task_key;
    }
    if (!refId) {
      return { success: false, error: "Task checkout needs task_item_id, or node_id + task_key (the <!-- t:key --> anchor)." };
    }
    if (!nodeId) {
      const { data: row } = await supabase.from("task_items").select("node_id, task_key, done, orphaned").eq("id", refId).maybeSingle();
      nodeId = (row as { node_id?: string } | null)?.node_id ?? null;
      taskKey = (row as { task_key?: string } | null)?.task_key ?? null;
      state = row as { done?: boolean | null; orphaned?: boolean | null } | null;
    }
    // AL.29: done work is not claimable, and neither is a work order its doc no longer lists.
    if (state?.done === true) {
      return { success: false, error: "This work order is done (ticked), so there is nothing to claim. get_work_queue lists the open work orders." };
    }
    if (state?.orphaned === true) {
      return { success: false, error: "This work order is no longer in its node's task document (orphaned), so there is nothing to claim. get_work_queue lists the open work orders." };
    }
  } else if (level === "code" && refId) {
    const { data: row } = await supabase.from("artifacts").select("node_id, path").eq("id", refId).maybeSingle();
    nodeId = (row as { node_id?: string | null } | null)?.node_id ?? null;
    ownPath = (row as { path?: string | null } | null)?.path ?? null;
  }
  if (level === "node") {
    // the node must exist on the branch the lease is for
    const branchId = args.branch_id ?? ((await getPrimaryBranch(supabase, projectId, "id")) as { id: string } | null)?.id ?? null;
    if (branchId) {
      const { data: ids, error: idsErr } = await supabase.rpc("graph_reference_ids", { p_branch_id: branchId });
      const nodes = (ids as { nodes?: unknown } | null)?.nodes;
      if (!idsErr && Array.isArray(nodes) && !nodes.map(String).includes(nodeId!)) {
        return { success: false, error: `No node ${nodeId} on this branch. get_architecture_overview lists the nodes with their ids.` };
      }
    }
  } else if (!refId) {
    return { success: false, error: `Checkout at level "${level}" needs ref_id (${level === "code" ? "artifact" : level === "criterion" ? "requirement" : level} UUID).` };
  }
  // v3u (R3): a criterion lease names WHICH criterion inside the requirement
  // row — the v3l identity (the criterion's `id`, as list_requirements and
  // get_test_plan serve it), never the criterion text.
  const criterionId = args.criterion_id?.trim() || null;
  if (level === "criterion" && !criterionId) {
    return { success: false, error: "Criterion checkout needs ref_id (the requirement row UUID) AND criterion_id (the criterion's id from list_requirements or get_test_plan — the v3l identity, not the text)." };
  }
  if (level !== "criterion" && criterionId) {
    return { success: false, error: `criterion_id only means something at level "criterion" — drop it, or set level: "criterion".` };
  }

  // AA.5: a work lease's reach: its declared files, one import hop inside the
  // node, the files the same test verifies; the whole node when none are named.
  const touches = [...(args.touches ?? []), ...(ownPath ? [ownPath] : [])].map(normalizePath).filter(Boolean);
  let reach: string[] | null = null;
  if ((WORK_LEVELS as readonly string[]).includes(level) && nodeId) {
    reach = await loadReach(supabase, projectId, args.branch_id ?? null, nodeId, touches, taskKey);
  }

  // AA.3: a node's box (when it is a part) and its parts (when it is exploded):
  // the box's lease covers its parts, a part's lease waits for the box.
  const family = nodeId ? await loadBoxAndParts(supabase, projectId, args.branch_id ?? null, nodeId) : null;

  // Advisory drafting holds are tied to a pending proposal by design; the
  // hold is display state, so a missing proposal_id is allowed but noted.
  const { data, error } = await supabase.rpc("agent_checkout_claim", {
    p_project_id: projectId,
    p_level: level,
    p_ref_id: refId,
    // 7.0: a session holds as a human — Team's presence is people too. The
    // identity is 'user:<id>' so the person's own holds read mine and release.
    p_holder_kind: auth.authMethod === "jwt" ? "human" : "agent",
    // O.2: the nickname when given, else the proven credential (the key's name); never a placeholder.
    p_holder_label: actorLabel(auth, args.external_agent),
    p_holder_key_id: auth.keyId ?? null,
    p_holder_delegate: holderIdentity(auth),
    p_branch_id: args.branch_id ?? null,
    p_proposal_id: args.proposal_id ?? null,
    p_meta: args.meta ?? {},
    p_criterion_id: criterionId,
    ...(nodeId ? { p_node_id: nodeId } : {}),
    ...(reach ? { p_reach: reach } : {}),
    ...(family?.box ? { p_box: family.box } : {}),
    ...(family && family.parts.length > 0 ? { p_parts: family.parts } : {}),
  });
  if (error) return { success: false, error: `Claim failed: ${error.message}` };

  const claim = (data ?? {}) as Record<string, unknown>;
  if (claim.renewed === true) {
    return {
      success: true,
      data: { ...claim, level, refId, ...(nodeId ? { nodeId } : {}), ...(criterionId ? { criterionId } : {}), message: "You already held this; the lease is renewed (heartbeat moved, meta merged). Keep working under the same checkoutId." },
    };
  }
  if (claim.claimed === false) {
    // AA.5 / AA.3: the explode signal. A collision on a node whose files split
    // into groups with no imports between them suggests exploding it.
    const signal = nodeId && family && claim.conflict && claim.relation !== "box" && claim.relation !== "part"
      ? await explodeSignal(supabase, family, nodeId)
      : null;
    return {
      success: true,
      data: {
        ...claim,
        ...(nodeId ? { nodeId } : {}),
        ...(signal ? { explodeSignal: signal.groups } : {}),
        message: refusalMessage(claim, level) + (signal ? ` ${signal.line}` : ""),
      },
    };
  }
  // AA.5: the last holder's hand-off note reaches the next claim on the same work.
  const handoff = await lastHandoff(supabase, projectId, level, refId, nodeId, criterionId);
  // AL.29 (3.3): what the work order's doc still asks for, as get_work_queue says it.
  let stepFields: Record<string, unknown> = {};
  if (level === "task" && nodeId && taskKey) {
    const branchId = args.branch_id ?? ((await getPrimaryBranch(supabase, projectId, "id")) as { id: string } | null)?.id ?? null;
    docs ??= branchId ? await readDocWorkOrders(supabase, branchId, nodeId) : null;
    const withoutSteps = docs?.orders.find((o) => o.key === taskKey)?.withoutSteps === true;
    const review = docs?.stepsToReview ?? [];
    stepFields = {
      ...(withoutSteps ? { withoutSteps } : {}),
      ...(review.length > 0 ? { stepsToReview: review } : {}),
      ...(withoutSteps || review.length > 0 ? { stepFormat: STEP_FORMAT } : {}),
    };
  }
  return {
    success: true,
    data: {
      ...claim,
      level,
      refId,
      ...(nodeId ? { nodeId } : {}),
      ...(reach ? { reach } : {}),
      ...(criterionId ? { criterionId } : {}),
      ...(handoff ? { handoff } : {}),
      ...stepFields,
      message: level === "node"
        ? "Claimed: this node is locked for you. Its structure (role, technology, configuration, edges, contracts, parts, the files bound to it, its task document) changes only through you until you release it; work inside it by others waits. Heartbeat via checkout_heartbeat; release with a note for whoever comes next."
        : level === "criterion"
        // R6 folded into the loop: a failed report is the genuine RED of the
        // TDD cycle, not a mistake to avoid reporting.
        ? "Claimed: this criterion is yours — one criterion, one binding test, one reported outcome. Write the failing test first and report it (status failed flips met to false with provenance — a genuine, auditable RED), bind by EXACT criterion_text, then report the green run. The lease releases on release_checkout or 30 silent minutes."
        : (EXCLUSIVE_LEVELS as readonly string[]).includes(level)
        ? `Claimed. ${reach ? (reach.includes(WHOLE_NODE) ? "No files were named, so this lease reaches the whole node and other work there waits; name the files with touches to share the node. " : `Your reach is ${reach.length} file${reach.length === 1 ? "" : "s"} (what you named, their imports inside the node, and what the same tests verify); work outside it runs in parallel. `) : ""}Heartbeat via checkout_heartbeat while working (meta.touches reports the files you touched); the lease releases on report_test_results evidence, release_checkout, or 30 silent minutes.`
        : "Advisory drafting hold recorded — non-exclusive; it clears when the linked proposal resolves.",
    },
  };
}

/** AA.5: why a claim was refused, in words the agent can act on. Pure. */
export function refusalMessage(claim: Record<string, unknown>, level: string): string {
  const who = `${claim.heldBy} (since ${claim.since})`;
  // AA.3: an exploded node's lease covers its parts, and a part's waits for it.
  if (claim.conflict === "node" && claim.relation === "box") {
    return `The node this one is a part of (${claim.heldNode}) is leased by ${who}: a box's lease covers its parts, so no one else's lease or work starts inside them until it ends. Work something else from get_work_queue meanwhile.`;
  }
  if (claim.conflict === "node" && claim.relation === "part") {
    return `One of this node's parts (${claim.heldNode}) is leased by ${who}: the box's lease covers its parts, so it waits for that lease to end.`;
  }
  if (claim.conflict === "node") {
    return `The node is leased by ${who}: its structure is locked and no one else's work starts inside it until that lease ends. Work something else from get_work_queue meanwhile.`;
  }
  if (claim.conflict === "work") {
    const held = Array.isArray(claim.heldReach) ? (claim.heldReach as string[]) : [];
    return `Work inside this node is held by ${who}${held.length && !held.includes(WHOLE_NODE) ? ` on ${held.slice(0, 5).join(", ")}${held.length > 5 ? ` and ${held.length - 5} more` : ""}` : ""}. A node lease waits for the work inside the node to end.`;
  }
  if (claim.conflict === "reach") {
    const held = Array.isArray(claim.heldReach) ? (claim.heldReach as string[]) : [];
    const coupling = String(claim.coupling ?? "");
    const heldLine = held.includes(WHOLE_NODE) ? "the whole node (no files named)" : `${held.slice(0, 5).join(", ")}${held.length > 5 ? ` and ${held.length - 5} more` : ""}`;
    return coupling === WHOLE_NODE
      ? `${who} holds ${heldLine}, and one of the two leases names no files, so they collide. Name the files you will touch (touches), wait, or coordinate with the holder.`
      : `${who} holds ${heldLine}; your reach meets it at ${coupling}. Narrow your touches away from it, wait for that lease, or coordinate with the holder.`;
  }
  return `Held by ${who}. A hold goes stale after 30 silent minutes and becomes claimable; work something else from get_work_queue meanwhile.${level === "node" ? " While it is held the node is locked for everyone but its holder." : ""}`;
}

/**
 * AA.5: a work lease's reach. The node's files are its bound artifacts and
 * the repo index's files; the import hop and the test coupling are read only
 * for the files named. A greenfield node (no files) reaches the criteria the
 * task serves, read from its task document.
 */
async function loadReach(
  supabase: SupabaseClient,
  projectId: string,
  branchArg: string | null,
  nodeId: string,
  touches: string[],
  taskKey: string | null,
): Promise<string[]> {
  try {
    const branchId = branchArg ?? ((await getPrimaryBranch(supabase, projectId, "id")) as { id: string } | null)?.id ?? null;
    const { data: arts } = await supabase.from("artifacts").select("id, path, kind, content_text").eq("project_id", projectId).eq("node_id", nodeId);
    const artifacts = (Array.isArray(arts) ? arts : []) as Array<{ id: string; path: string | null; kind: string | null; content_text?: string | null }>;
    const files = new Map<string, string | null>();
    for (const a of artifacts) if (a.path && !a.path.startsWith(".nodespec/")) files.set(normalizePath(a.path), a.id);
    if (branchId) {
      const { data: idx } = await supabase.from("repo_index").select("path").eq("branch_id", branchId).eq("node_id", nodeId);
      for (const r of (Array.isArray(idx) ? idx : []) as Array<{ path: string }>) if (!files.has(normalizePath(r.path))) files.set(normalizePath(r.path), null);
    }

    if (files.size === 0) {
      // greenfield: the criteria this task serves, else the task itself
      const doc = artifacts.find((a) => a.kind === "task" || (a.path ?? "").startsWith(".nodespec/tasks/"));
      const task = taskKey && doc?.content_text ? parseTaskDocTasks(doc.content_text).tasks.find((t) => t.key === taskKey) : undefined;
      const greenfield = task?.serves?.length ? task.serves.map((sv) => criterionToken(sv.reqId, sv.text)) : taskKey ? [taskToken(taskKey)] : [];
      return leaseReach({ touches, nodeFiles: [], edges: [], testGroups: [], greenfield });
    }
    if (touches.length === 0) return [WHOLE_NODE];

    const edges: Array<{ from: string; to: string }> = [];
    if (branchId) {
      const [out, inc] = await Promise.all([
        supabase.from("repo_index_edges").select("from_path, to_path").eq("branch_id", branchId).in("from_path", touches),
        supabase.from("repo_index_edges").select("from_path, to_path").eq("branch_id", branchId).in("to_path", touches),
      ]);
      for (const r of [...((out.data ?? []) as Array<{ from_path: string; to_path: string }>), ...((inc.data ?? []) as Array<{ from_path: string; to_path: string }>)]) {
        edges.push({ from: r.from_path, to: r.to_path });
      }
    }
    const touchedIds = touches.map((t) => files.get(t)).filter((x): x is string => !!x);
    const testGroups: string[][] = [];
    if (touchedIds.length > 0) {
      const { data: cases } = await supabase.from("test_cases").select("source_artifact_ids").overlaps("source_artifact_ids", touchedIds).is("retired_at", null);
      const pathById = new Map([...files].filter(([, id]) => id).map(([path, id]) => [id as string, path]));
      for (const c of (Array.isArray(cases) ? cases : []) as Array<{ source_artifact_ids: string[] | null }>) {
        testGroups.push((c.source_artifact_ids ?? []).map((id) => pathById.get(id)).filter((p): p is string => !!p));
      }
    }
    return leaseReach({ touches, nodeFiles: [...files.keys()], edges, testGroups });
  } catch {
    // A read that fails reaches the whole node: safe, never a silent overlap.
    return [WHOLE_NODE];
  }
}

/** AA.3: the family a node's lease lives in: its box when it is a part, its parts when it is exploded. */
export interface NodeFamily { branchId: string | null; label: string; box: string | null; parts: string[]; explodable: boolean }

async function loadBoxAndParts(supabase: SupabaseClient, projectId: string, branchArg: string | null, nodeId: string): Promise<NodeFamily | null> {
  try {
    const branchId = branchArg ?? ((await getPrimaryBranch(supabase, projectId, "id")) as { id: string } | null)?.id ?? null;
    if (!branchId) return null;
    const graph = (await loadGraphData(supabase, branchId)) as { nodes?: Record<string, { id: string; type?: string; label?: string; parentId?: string | null }> } | null;
    const nodes = graph?.nodes ?? {};
    const node = nodes[nodeId];
    if (!node) return null;
    const { data: roles } = await supabase.from("node_roles").select("id, capability_tags, can_contain");
    const rows = (Array.isArray(roles) ? roles : []) as Array<{ id: string; capability_tags: string[] | null; can_contain: unknown }>;
    const partRoles = new Set(rows.filter((r) => (r.capability_tags ?? []).includes("part")).map((r) => r.id));
    const own = rows.find((r) => r.id === node.type);
    const listed = Array.isArray(own?.can_contain) ? (own!.can_contain as string[]) : ((own?.can_contain as { roleIds?: string[] } | null)?.roleIds ?? []);
    const box = node.parentId && partRoles.has(String(node.type)) ? node.parentId : null;
    const parts = Object.values(nodes).filter((n) => n.parentId === nodeId && partRoles.has(String(n.type))).map((n) => n.id);
    return { branchId, label: String(node.label ?? nodeId), box, parts, explodable: parts.length === 0 && listed.some((id) => partRoles.has(id)) };
  } catch {
    return null;
  }
}

/** AA.5 / AA.3: the explode signal for a node whose claim was just refused, or null. */
async function explodeSignal(supabase: SupabaseClient, family: NodeFamily, nodeId: string): Promise<{ groups: ReturnType<typeof fileGroups>; line: string } | null> {
  if (!family.explodable || !family.branchId) return null;
  try {
    const { data: idx } = await supabase.from("repo_index").select("path").eq("branch_id", family.branchId).eq("node_id", nodeId).limit(2000);
    const files = ((Array.isArray(idx) ? idx : []) as Array<{ path: string }>).map((r) => normalizePath(r.path));
    if (files.length < 4) return null;
    const imports: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < files.length; i += 150) {
      const { data: rows } = await supabase.from("repo_index_edges").select("from_path, to_path").eq("branch_id", family.branchId).in("from_path", files.slice(i, i + 150));
      for (const r of (Array.isArray(rows) ? rows : []) as Array<{ from_path: string; to_path: string }>) imports.push({ from: normalizePath(r.from_path), to: normalizePath(r.to_path) });
    }
    const groups = fileGroups(files, imports);
    const line = explodeSignalLine(groups, family.label);
    return line ? { groups, line } : null;
  } catch {
    return null;
  }
}

/** AA.5: the hand-off note the last holder of the same work left, if any. */
async function lastHandoff(
  supabase: SupabaseClient,
  projectId: string,
  level: string,
  refId: string | null,
  nodeId: string | null,
  criterionId: string | null,
): Promise<{ note: string; from: string; at: string } | null> {
  if (!(EXCLUSIVE_LEVELS as readonly string[]).includes(level)) return null;
  try {
    let q = supabase.from("agent_checkouts").select("holder_label, released_at, meta").eq("project_id", projectId).eq("level", level).eq("released_reason", "released");
    q = level === "node" ? q.eq("node_id", nodeId) : level === "task" ? q.eq("task_item_id", refId) : level === "code" ? q.eq("artifact_id", refId) : q.eq("requirement_id", refId).eq("criterion_id", criterionId);
    const { data } = await q.order("released_at", { ascending: false }).limit(1).maybeSingle();
    const row = data as { holder_label: string; released_at: string; meta: Record<string, unknown> | null } | null;
    const h = row?.meta?.handoff as { note?: unknown } | undefined;
    return row && h && typeof h.note === "string" && h.note.trim() ? { note: h.note, from: row.holder_label, at: row.released_at } : null;
  } catch {
    return null;
  }
}

type ActiveLease = { id: string; level: string; holder_label: string; holder_key_id: string | null; holder_delegate: string | null; meta: Record<string, unknown> | null; node_id?: string | null };

/** The active lease by id in this project, or null. */
async function activeLease(supabase: SupabaseClient, projectId: string, checkoutId: string): Promise<{ lease: ActiveLease | null; error?: string }> {
  const { data, error } = await supabase
    .from("agent_checkouts")
    .select("id, level, holder_label, holder_key_id, holder_delegate, meta, node_id")
    .eq("id", checkoutId)
    .eq("project_id", projectId)
    .is("released_at", null)
    .maybeSingle();
  if (error) return { lease: null, error: error.message };
  return { lease: (data as ActiveLease | null) ?? null };
}

const GONE = "No active checkout with that id in this project: already released, reclaimed, or never existed.";

export async function handleReleaseCheckout(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; checkout_id: string; reason?: string; note?: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, "write")) {
    return { success: false, error: "Insufficient permissions: write scope required" };
  }
  const reason = args.reason ?? "released";
  if (!(RELEASE_REASONS as readonly string[]).includes(reason)) {
    return { success: false, error: `Unknown release reason "${args.reason}". Valid: ${RELEASE_REASONS.join(", ")}.` };
  }
  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ("error" in resolved) return resolved.error;

  // AA.0: only the holder ends its own lease. The owner or a maintainer can
  // end a stuck one, with a note that is recorded on the lease.
  const found = await activeLease(supabase, resolved.project.id, args.checkout_id);
  if (found.error) return { success: false, error: `Release failed: ${found.error}` };
  if (!found.lease) return { success: false, error: GONE };
  const lease = found.lease;
  const mine = isMine(auth, holderIdentity(auth), lease);
  const note = args.note?.trim() ?? "";
  let meta: Record<string, unknown> | undefined;
  // AA.5: releasing exclusive work hands it on, so it says where it stands;
  // the next claim on the same work receives the note.
  if (mine && reason === "released" && (EXCLUSIVE_LEVELS as readonly string[]).includes(lease.level)) {
    if (!note) {
      return { success: false, error: "Releasing hands this work on: say where it stands in note (done, what is next, or what blocks it). The next claim on it receives the note." };
    }
    meta = { ...(lease.meta ?? {}), handoff: { note, at: new Date().toISOString() } };
  }
  if (!mine) {
    const role = (resolved.project as { role?: string }).role;
    if (role !== "owner" && role !== "maintainer") {
      return { success: false, error: `Held by ${lease.holder_label}; only its holder releases it. The project owner or a maintainer can release a stuck lease with a note.` };
    }
    if (!note) {
      return { success: false, error: `Held by ${lease.holder_label}. Releasing someone else's lease needs a note saying why (it is recorded on the lease).` };
    }
    meta = { ...(lease.meta ?? {}), releasedBy: actorLabel(auth, undefined), releaseNote: note, handoff: { note, at: new Date().toISOString() } };
  }

  const { data, error } = await supabase
    .from("agent_checkouts")
    .update({ released_at: new Date().toISOString(), released_reason: reason, ...(meta ? { meta } : {}) })
    .eq("id", lease.id)
    .is("released_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { success: false, error: `Release failed: ${error.message}` };
  if (!data) return { success: false, error: GONE };
  return { success: true, data: { released: true, checkoutId: lease.id, reason, ...(mine ? {} : { releasedFor: lease.holder_label }) } };
}

export async function handleCheckoutHeartbeat(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; checkout_id: string; meta?: Record<string, unknown> }
): Promise<MCPResponse> {
  if (!checkScope(auth, "write")) {
    return { success: false, error: "Insufficient permissions: write scope required" };
  }
  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ("error" in resolved) return resolved.error;

  // AA.0: only the holder keeps its lease alive, and a heartbeat merges its
  // meta into what the lease carries instead of replacing it.
  const found = await activeLease(supabase, resolved.project.id, args.checkout_id);
  if (found.error) return { success: false, error: `Heartbeat failed: ${found.error}` };
  if (!found.lease) {
    return { success: false, error: "No active checkout with that id: it was released or reclaimed. Re-claim via checkout_task before continuing." };
  }
  if (!isMine(auth, holderIdentity(auth), found.lease)) {
    return { success: false, error: `Held by ${found.lease.holder_label}; only its holder renews it.` };
  }

  const patch: Record<string, unknown> = { heartbeat_at: new Date().toISOString() };
  if (args.meta && typeof args.meta === "object") patch.meta = { ...(found.lease.meta ?? {}), ...args.meta };
  // AD.3 (D23): every commit the holder reports is kept (the last 50), so a
  // change card can tell the holder's own commits from someone else's.
  const reported = typeof args.meta?.commitSha === "string" ? args.meta.commitSha.trim().toLowerCase() : "";
  if (/^[0-9a-f]{7,64}$/.test(reported)) {
    const prior = Array.isArray((found.lease.meta as Record<string, unknown> | null)?.commits)
      ? ((found.lease.meta as Record<string, unknown>).commits as unknown[]).filter((c): c is string => typeof c === "string")
      : [];
    patch.meta = { ...(patch.meta as Record<string, unknown>), commits: [...prior.filter((c) => c !== reported), reported].slice(-50) };
  }

  // AA.5: a file touched outside the declared reach extends the lease when no
  // one else's work reaches it, and is flagged when someone's does.
  const extended: string[] = [];
  const flagged: Array<{ path: string; heldBy: string }> = [];
  const touched = Array.isArray(args.meta?.touches) ? (args.meta!.touches as unknown[]).map(String) : [];
  if (touched.length > 0 && (WORK_LEVELS as readonly string[]).includes(found.lease.level) && found.lease.node_id) {
    const reach = reachOf(found.lease.meta);
    const outside = outsideReach(reach, touched);
    if (outside.length > 0) {
      const { data: others } = await supabase
        .from("agent_checkouts")
        .select("id, holder_label, holder_key_id, holder_delegate, heartbeat_at, meta")
        .eq("project_id", resolved.project.id)
        .eq("node_id", found.lease.node_id)
        .in("level", ["task", "code"])
        .is("released_at", null);
      const me = holderIdentity(auth);
      const live = ((others ?? []) as Array<ActiveLease & { heartbeat_at: string }>)
        .filter((o) => o.id !== found.lease!.id && !isStale(o.heartbeat_at) && !isMine(auth, me, o));
      for (const path of outside) {
        const holder = live.find((o) => reachOverlap(reachOf(o.meta), [path]) !== null);
        if (holder) flagged.push({ path, heldBy: holder.holder_label });
        else extended.push(path);
      }
      if (extended.length > 0) {
        patch.meta = { ...((patch.meta as Record<string, unknown> | undefined) ?? found.lease.meta ?? {}), reach: [...reach, ...extended].sort() };
      }
    }
  }

  const { data, error } = await supabase
    .from("agent_checkouts")
    .update(patch)
    .eq("id", found.lease.id)
    .is("released_at", null)
    .select("id, heartbeat_at")
    .maybeSingle();
  if (error) return { success: false, error: `Heartbeat failed: ${error.message}` };
  if (!data) {
    return { success: false, error: "No active checkout with that id — it was released or reclaimed. Re-claim via checkout_task before continuing." };
  }
  return {
    success: true,
    data: {
      ok: true,
      heartbeatAt: (data as { heartbeat_at: string }).heartbeat_at,
      ...(extended.length > 0 ? { reachExtended: extended } : {}),
      ...(flagged.length > 0
        ? { outsideScope: flagged, warning: `You touched ${flagged.map((f) => `${f.path} (held by ${f.heldBy})`).join(", ")}, outside your lease and inside someone else's. Coordinate with the holder before committing it.` }
        : {}),
    },
  };
}

/** R7: a hold is mine when its credential is mine — the key id, or the
 *  (user, client) delegate an OAuth connector keeps across renewals. */
export function isMine(
  auth: AuthResult,
  me: string | null,
  lease: { holder_key_id: string | null; holder_delegate: string | null },
): boolean {
  if (auth.keyId && lease.holder_key_id === auth.keyId) return true;
  return !!me && lease.holder_delegate === me;
}

/** AL.11: the fresh leases other credentials hold on nodes (the node itself,
 *  or task or code work inside it), one per node with a node lease first.
 *  The lock propose_patches puts on graph changes and generate_task_docs on
 *  task documents. A failed read is returned, never read as "nobody". */
export type NodeLease = { id: string; level: string; node_id: string; holder_label: string; holder_key_id: string | null; holder_delegate: string | null; since: string; heartbeat_at: string };
export async function nodeLeasesOfOthers(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
): Promise<{ byNode: Map<string, NodeLease>; error: string | null }> {
  const { data, error } = await supabase
    .from("agent_checkouts")
    .select("id, level, node_id, holder_label, holder_key_id, holder_delegate, since, heartbeat_at")
    .eq("project_id", projectId)
    .in("level", ["node", "task", "code"])
    .is("released_at", null);
  const byNode = new Map<string, NodeLease>();
  if (error) return { byNode, error: error.message };
  const me = holderIdentity(auth);
  for (const l of (data ?? []) as NodeLease[]) {
    if (!l.node_id || isStale(l.heartbeat_at) || isMine(auth, me, l)) continue;
    if (!byNode.has(l.node_id) || l.level === "node") byNode.set(l.node_id, l);
  }
  return { byNode, error: null };
}

async function keyNamesFor(supabase: SupabaseClient, keyIds: Array<string | null>): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(keyIds.filter(Boolean))] as string[];
  if (ids.length === 0) return names;
  try {
    const { data } = await supabase.from("mcp_api_keys").select("id, name").in("id", ids);
    for (const k of (data ?? []) as Array<{ id: string; name: string | null }>) if (k.name) names.set(k.id, k.name);
  } catch (_err) { /* names are display; the board stands without them */ }
  return names;
}

/** 4b.4: when each holding credential stops working — a key's expires_at,
 *  an OAuth client's furthest live token (refresh window, else access) —
 *  so a human sees an agent about to lose access mid-task before it does.
 *  Map delegate → ISO or null (never expires / unknown). Best effort. */
export async function credentialHorizons(supabase: SupabaseClient, delegates: Array<string | null>): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const keys = new Map<string, string>();
  const oauth = new Map<string, { userId: string; clientId: string }>();
  for (const d of delegates) {
    if (!d) continue;
    if (d.startsWith("key:")) keys.set(d, d.slice(4));
    else if (d.startsWith("oauth:")) {
      const rest = d.slice(6);
      const i = rest.indexOf(":");
      if (i > 0) oauth.set(d, { userId: rest.slice(0, i), clientId: rest.slice(i + 1) });
    }
  }
  try {
    if (keys.size > 0) {
      const { data } = await supabase.from("mcp_api_keys").select("id, expires_at").in("id", [...keys.values()]);
      const byId = new Map(((data ?? []) as Array<{ id: string; expires_at: string | null }>).map((k) => [k.id, k.expires_at]));
      for (const [d, id] of keys) out.set(d, byId.get(id) ?? null);
    }
    if (oauth.size > 0) {
      const users = [...new Set([...oauth.values()].map((o) => o.userId))];
      const clients = [...new Set([...oauth.values()].map((o) => o.clientId))];
      const { data } = await supabase
        .from("mcp_oauth_tokens")
        .select("user_id, client_id, expires_at, refresh_expires_at")
        .in("user_id", users)
        .in("client_id", clients)
        .is("revoked_at", null);
      const rows = (data ?? []) as Array<{ user_id: string; client_id: string; expires_at: string; refresh_expires_at: string | null }>;
      for (const [d, o] of oauth) {
        const horizons = rows.filter((r) => r.user_id === o.userId && r.client_id === o.clientId).map((r) => r.refresh_expires_at ?? r.expires_at);
        out.set(d, horizons.length > 0 ? horizons.sort().at(-1)! : null);
      }
    }
  } catch (_err) { /* the board stands without horizons */ }
  return out;
}

/** 4b.3: after a proposal is filed, the filing credential's advisory holds
 *  on the outcomes and requirements the proposal touches bind to it — the
 *  hold now says "waiting for your approval", and resolving the proposal
 *  releases it. Best effort: never fails the filing. Returns how many bound. */
export async function bindHoldsToProposal(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  proposalId: string,
  patches: Array<{ type?: string; payload?: unknown }>,
): Promise<number> {
  const me = holderIdentity(auth);
  if (!me) return 0;
  const candidateIds = new Set<string>();
  const requirementIds = new Set<string>();
  for (const p of patches) {
    const payload = (p?.payload ?? {}) as { candidateId?: unknown; requirementId?: unknown };
    if (typeof payload.candidateId === "string") candidateIds.add(payload.candidateId);
    if (typeof payload.requirementId === "string" && UUID_RE.test(payload.requirementId)) requirementIds.add(payload.requirementId);
  }
  let bound = 0;
  try {
    if (candidateIds.size > 0) {
      const { data } = await supabase
        .from("agent_checkouts")
        .update({ proposal_id: proposalId })
        .eq("project_id", projectId)
        .eq("level", "outcome")
        .eq("holder_delegate", me)
        .is("released_at", null)
        .is("proposal_id", null)
        .in("candidate_id", [...candidateIds])
        .select("id");
      bound += ((data ?? []) as unknown[]).length;
    }
    if (requirementIds.size > 0) {
      const { data } = await supabase
        .from("agent_checkouts")
        .update({ proposal_id: proposalId })
        .eq("project_id", projectId)
        .eq("level", "requirement")
        .eq("holder_delegate", me)
        .is("released_at", null)
        .is("proposal_id", null)
        .in("requirement_id", [...requirementIds])
        .select("id");
      bound += ((data ?? []) as unknown[]).length;
    }
  } catch (_err) { /* binding is display state */ }
  return bound;
}


/** A resolved proposal (accepted or rejected) releases every advisory hold
 *  bound to it as 'resolved' — the audited third ending. Best effort. */
export async function releaseHoldsForProposal(supabase: SupabaseClient, proposalId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("agent_checkouts")
      .update({ released_at: new Date().toISOString(), released_reason: "resolved" })
      .eq("proposal_id", proposalId)
      .is("released_at", null)
      .select("id");
    return ((data ?? []) as unknown[]).length;
  } catch (_err) {
    return 0;
  }
}

/** V3 collision visibility: the FULL lease board, every level, so an agent
 *  sees in one read who is on what — its own holds marked `mine` (R7: by
 *  credential) — before touching a requirement, outcome, task or artifact
 *  someone else has in hand. Advisory levels appear here too (nothing else
 *  lists them). Best effort: a failed read returns an empty board, never a
 *  failed queue. Read even when the project has no open tasks — outcome
 *  and requirement holds exist before any task does. */
export async function readActiveHolds(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
): Promise<Array<Record<string, unknown>>> {
  const activeHolds: Array<Record<string, unknown>> = [];
  try {
    const { data: allLeases } = await supabase
      .from("agent_checkouts")
      .select("id, level, holder_label, holder_key_id, holder_delegate, task_item_id, artifact_id, requirement_id, candidate_id, criterion_id, node_id, proposal_id, meta, since, heartbeat_at")
      .eq("project_id", projectId)
      .is("released_at", null);
    const leases = (allLeases ?? []) as Array<{
      id: string; level: string; holder_label: string; holder_key_id: string | null; holder_delegate: string | null;
      node_id?: string | null;
      task_item_id: string | null; artifact_id: string | null; requirement_id: string | null;
      candidate_id: string | null; criterion_id: string | null; proposal_id: string | null; meta: Record<string, unknown> | null;
      since: string; heartbeat_at: string;
    }>;
    if (leases.length > 0) {
      const label = new Map<string, string>();
      // V3 2.3: the node a task or artifact hold sits on, so the rail and the
      // queue can answer "who is on this node".
      const nodeOf = new Map<string, string>();
      const wanted = (key: "task_item_id" | "requirement_id" | "candidate_id" | "artifact_id") =>
        [...new Set(leases.map((l) => l[key]).filter(Boolean))] as string[];
      const taskIds = wanted("task_item_id");
      if (taskIds.length > 0) {
        const { data } = await supabase.from("task_items").select("id, title, display_id, node_id").in("id", taskIds);
        for (const r of (data ?? []) as Array<{ id: string; title: string | null; display_id: string | null; node_id: string | null }>) {
          label.set(r.id, [r.display_id, r.title].filter(Boolean).join(" · ") || r.id);
          if (r.node_id) nodeOf.set(r.id, r.node_id);
        }
      }
      const reqIds = wanted("requirement_id");
      if (reqIds.length > 0) {
        const { data } = await supabase.from("specification_requirements").select("id, requirement_id, name").in("id", reqIds);
        for (const r of (data ?? []) as Array<{ id: string; requirement_id: string; name: string }>) {
          label.set(r.id, `${r.requirement_id} · ${r.name}`);
        }
      }
      const candIds = wanted("candidate_id");
      if (candIds.length > 0) {
        const { data } = await supabase.from("requirement_candidates").select("id, name").in("id", candIds);
        for (const r of (data ?? []) as Array<{ id: string; name: string }>) label.set(r.id, r.name);
      }
      const artIds = wanted("artifact_id");
      if (artIds.length > 0) {
        const { data } = await supabase.from("artifacts").select("id, path, node_id").in("id", artIds);
        for (const r of (data ?? []) as Array<{ id: string; path: string | null; node_id: string | null }>) {
          label.set(r.id, r.path ?? r.id);
          if (r.node_id) nodeOf.set(r.id, r.node_id);
        }
      }
      // V3 2.3: a human canvas edit on a held node is the collision the holder
      // wants to know about. Derived from graph_patches (actor_type human,
      // appended after the hold began, naming the hold's node); nothing is
      // stored, so the answer is always current.
      const humanEdits = new Map<string, { count: number; latest: { sequence: number; summary: string | null } }>();
      try {
        const heldNodes = leases
          .map((l) => ({ l, nodeId: l.node_id ?? nodeOf.get(l.task_item_id ?? l.artifact_id ?? "") ?? null }))
          .filter((x): x is { l: typeof leases[number]; nodeId: string } => x.nodeId !== null);
        if (heldNodes.length > 0) {
          const primary = await getPrimaryBranch(supabase, projectId, "id");
          if (primary) {
            const earliest = heldNodes.map((x) => x.l.since).sort()[0];
            const { data: rows } = await supabase
              .from("graph_patches")
              .select("sequence, patch_type, payload, actor_type, summary, created_at")
              .eq("branch_id", primary.id)
              .eq("actor_type", "human")
              .gte("created_at", earliest)
              .order("sequence", { ascending: true })
              .limit(500);
            const patches = (rows ?? []) as Array<PatchRowLike & { created_at: string }>;
            for (const { l, nodeId } of heldNodes) {
              const mine = patchesTouchingNode(patches.filter((r) => r.created_at >= l.since).map(laterPatchFromRow), nodeId);
              if (mine.length > 0) {
                const last = mine[mine.length - 1];
                humanEdits.set(l.id, { count: mine.length, latest: { sequence: last.sequence, summary: last.summary ?? null } });
              }
            }
          }
        }
      } catch (_collisionErr) { /* the board stands without the collision read */ }
      // R7: the credential behind each hold — key names resolve in one batch,
      // OAuth clients read off the delegate id itself.
      const keyNames = await keyNamesFor(supabase, leases.map((l) => l.holder_key_id));
      const delegateOfLease = (l: { holder_delegate: string | null; holder_key_id: string | null }) =>
        l.holder_delegate ?? (l.holder_key_id ? `key:${l.holder_key_id}` : null);
      const horizons = await credentialHorizons(supabase, leases.map(delegateOfLease));
      const me = holderIdentity(auth);
      for (const l of leases) {
        const refId = l.task_item_id ?? l.requirement_id ?? l.candidate_id ?? l.artifact_id;
        const delegate = delegateOfLease(l);
        // v3u: a criterion hold labels as its requirement plus WHICH criterion
        const baseLabel = refId ? (label.get(refId) ?? refId) : null;
        const nodeId = l.node_id ?? nodeOf.get(l.task_item_id ?? l.artifact_id ?? "") ?? null;
        const edits = humanEdits.get(l.id);
        activeHolds.push({
          checkoutId: l.id,
          level: l.level,
          ...(nodeId ? { nodeId } : {}),
          ...(edits ? { humanEditsSince: edits.count, humanEditLatest: edits.latest } : {}),
          advisory: l.level === "requirement" || l.level === "outcome",
          holder: l.holder_label,
          credential: credentialLabel(delegate, keyNames),
          credentialExpiresAt: delegate ? (horizons.get(delegate) ?? null) : null,
          mine: isMine(auth, me, l),
          refId,
          refLabel: l.level === "criterion" && l.criterion_id && baseLabel ? `${baseLabel} · criterion ${l.criterion_id}` : l.level === "node" ? "the node (its structure is locked)" : baseLabel,
          // AA.5: what a work lease reaches inside its node ('*' is the whole node)
          ...(l.level === "task" || l.level === "code" ? { reach: reachOf(l.meta) } : {}),
          ...(l.criterion_id ? { criterionId: l.criterion_id } : {}),
          since: l.since,
          stale: isStale(l.heartbeat_at),
          ...(l.proposal_id ? { proposalId: l.proposal_id } : {}),
          ...(l.meta && Object.keys(l.meta).length > 0 ? { meta: l.meta } : {}),
        });
      }
    }
  } catch (_holdsErr) { /* the queue stands even when the board read fails */ }
  return activeHolds;
}

export async function handleGetWorkQueue(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id?: string; limit?: number }
): Promise<MCPResponse> {
  if (!checkScope(auth, "read")) {
    return { success: false, error: "Insufficient permissions: read scope required" };
  }
  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ("error" in resolved) return resolved.error;
  const projectId = resolved.project.id;
  const limit = Math.max(1, Math.min(args.limit ?? 20, 100));

  // AL.29 (gap 3): the work orders come from the branch's task docs; a
  // task_items row (written by the first tick or claim) holds their state.
  // Before this the queue read rows only, so a fresh work order was never offered.
  const { data: items, error: itemsError } = await supabase
    .from("task_items")
    .select("id, node_id, task_key, display_id, title, done, orphaned, mark")
    .eq("project_id", projectId);
  if (itemsError) return { success: false, error: `Task read failed: ${itemsError.message}` };
  let branchId = args.branch_id ?? null;
  if (!branchId) {
    const { data: branches } = await supabase
      .from("branches")
      .select("id, is_primary")
      .eq("project_id", projectId);
    const rows = (Array.isArray(branches) ? branches : []) as Array<{ id: string; is_primary: boolean | null }>;
    branchId = (rows.find((b) => b.is_primary) ?? rows[0])?.id ?? null;
  }
  const docs = branchId ? await readDocWorkOrders(supabase, branchId) : { orders: [], stepsToReview: [] };
  const open = openWorkOrders((items ?? []) as TaskStateRow[], docs.orders);
  if (open.length === 0) {
    const activeHolds = await readActiveHolds(supabase, auth, projectId);
    return { success: true, data: { source: "none", queue: [], totalOpen: 0, activeHolds, message: "No open tasks. generate_task_docs creates task packets from the architecture. activeHolds still lists every active lease (outcome and requirement holds exist before any task does)." } };
  }

  // Pinned ordering: the accepted work plan when one exists (P6), else the
  // deterministic fallback. The plan probe tolerates the tables not existing
  // yet — community builds and pre-P6 chains simply never have one.
  // Q: the accepted plan is Priority, Indie and above. Below it the queue is
  // the build order, even when a plan survives from a paid period.
  let planAllowed = false;
  try { planAllowed = featureAllowed(await getProjectTier(supabase, projectId, auth.userId, { role: resolved.project.role }), "priority_board"); } catch { /* fail closed */ }
  let planOrder: Map<string, number> | null = null;
  if (planAllowed) try {
    const { data: plan } = await supabase
      .from("work_plans")
      .select("id")
      .eq("project_id", projectId)
      .eq("status", "accepted")
      .maybeSingle();
    const planId = (plan as { id: string } | null)?.id;
    if (planId) {
      const { data: planItems } = await supabase
        .from("work_plan_items")
        .select("item_key, node_id, rank")
        .eq("plan_id", planId)
        .eq("item_kind", "task");
      if (planItems && (planItems as unknown[]).length > 0) {
        planOrder = new Map(
          (planItems as Array<{ item_key: string; node_id: string; rank: number }>).map((p) => [
            `${p.node_id}:${p.item_key}`,
            p.rank,
          ])
        );
      }
    }
  } catch (_planErr) { /* no plan lane — the fallback below is the order */ }

  // Fallback node order: the SAME dependency-ordered buildOrder the readiness
  // preflight computes (contract upstream + container parent) — composed, not
  // re-derived, so the two never drift. Readiness needs a branch: the primary
  // one when the caller names none. No resolvable branch degrades to plain
  // display order rather than failing the queue.
  const nodePosition = new Map<string, number>();
  const nodeLabel = new Map<string, string>();
  if (!planOrder && branchId) {
    const readiness = await handleGetBuildReadiness(supabase, auth, {
      project_id: projectId,
      branch_id: branchId,
      detail: "summary",
    }, { chain: false }); // AA.1: the queue never waits on the chain, so it does not read it
    if (readiness.success) {
      const rd = readiness.data as { buildOrder?: string[]; nodes?: Array<{ nodeId: string; label: string }> };
      const byLabel = new Map((rd.nodes ?? []).map((n) => [n.label, n.nodeId]));
      (rd.buildOrder ?? []).forEach((label, i) => {
        const id = byLabel.get(label);
        if (id) {
          nodePosition.set(id, i);
          nodeLabel.set(id, label);
        }
      });
    }
  }

  // Within a node, the doc's own order (T2 before T10).
  const ranked = open
    .map((t) => ({
      t,
      rank: planOrder
        ? (planOrder.get(`${t.nodeId}:${t.taskKey}`) ?? Number.MAX_SAFE_INTEGER)
        : (nodePosition.get(t.nodeId) ?? Number.MAX_SAFE_INTEGER),
    }))
    .sort((a, b) =>
      a.rank - b.rank
      || a.t.nodeId.localeCompare(b.t.nodeId)
      || a.t.docIndex - b.t.docIndex
      || String(a.t.displayId ?? "").localeCompare(String(b.t.displayId ?? ""))
      || a.t.taskKey.localeCompare(b.t.taskKey));

  // Active leases attach as display state — held work stays IN the queue
  // (a checkout is advisory), it just says who has it and whether the hold
  // has gone stale. A work order with no row yet has no lease.
  const ids = ranked.slice(0, limit).map((r) => r.t.taskItemId).filter((id): id is string => !!id);
  const holds = new Map<string, { holder: string; since: string; heartbeatAt: string }>();
  if (ids.length > 0) {
    const { data: leases } = await supabase
      .from("agent_checkouts")
      .select("task_item_id, holder_label, since, heartbeat_at")
      .eq("project_id", projectId)
      .eq("level", "task")
      .is("released_at", null)
      .in("task_item_id", ids);
    for (const l of (leases ?? []) as Array<{ task_item_id: string; holder_label: string; since: string; heartbeat_at: string }>) {
      holds.set(l.task_item_id, { holder: l.holder_label, since: l.since, heartbeatAt: l.heartbeat_at });
    }
  }

  const activeHolds = await readActiveHolds(supabase, auth, projectId);
  // AL.29 (3.3): the empty and flagged blocks, as generate_task_docs names them.
  const asks = ranked.slice(0, limit).some(({ t }) => t.withoutSteps) || docs.stepsToReview.length > 0;

  return {
    success: true,
    data: {
      source: planOrder ? "accepted-plan" : "build-order",
      totalOpen: open.length,
      queue: ranked.slice(0, limit).map(({ t }) => {
        const hold = t.taskItemId ? holds.get(t.taskItemId) : undefined;
        return {
          taskItemId: t.taskItemId,
          taskKey: t.taskKey,
          displayId: t.displayId,
          title: t.title,
          nodeId: t.nodeId,
          // 7.3: the mark travels with the item so the boundary can withhold it
          mark: t.mark,
          ...(nodeLabel.has(t.nodeId) ? { nodeLabel: nodeLabel.get(t.nodeId) } : {}),
          ...(hold
            ? { heldBy: hold.holder, holderSince: hold.since, holdStale: isStale(hold.heartbeatAt) }
            : {}),
          ...(t.withoutSteps ? { withoutSteps: true } : {}),
        };
      }),
      ...(docs.stepsToReview.length > 0 ? { stepsToReview: docs.stepsToReview } : {}),
      ...(asks ? { stepFormat: STEP_FORMAT } : {}),
      activeHolds,
      message: "Claim with checkout_task: task_item_id, or node_id + task_key when taskItemId is null (a work order no one has ticked or claimed yet; the claim records it). Held entries are advisory; a stale hold (30 silent minutes) is claimable. activeHolds is the whole lease board (every level, yours marked mine); check it before touching held work.",
    },
  };
}

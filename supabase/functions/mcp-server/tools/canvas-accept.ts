// AL.24 (owner 2026-10-05): "even when i select auto for agents approval,
// there are proposals that sit ... ensure that upon toggle, the backend logic
// remains headless so the user doesn't have to have the app open, as well as
// we don't have a race condition if the user then clicks reject or approve
// while the function is completing auto approval."
//
// A canvas proposal under Auto applied only while the app was open: a poller
// in the canvas accepted it every 30 seconds, with no claim, so a reject in
// another tab could land on top of it. The server now accepts it itself,
// through the steps the app's accept takes (ProposalService.acceptProposal),
// with the patch engine the app runs (a generated copy of core,
// scripts/sync-core-engine.mjs), under the claim resolve_proposal takes: one
// decider at a time, and merged only by the claim that applied it.
//
// Four answers, and never half an apply:
//   merged     every patch is in the branch's log and its snapshot
//   waiting    left pending for the person, the reason recorded on the
//              proposal (metadata.autoWait): a locked or leased node, a file
//              git cannot serve yet, a write that failed
//   set aside  rejected with the reason, as a stale spec batch is under Auto:
//              the branch moved under it, or a patch will not apply; the
//              agent re-reads and files again
//   busy       another decider holds it
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult } from "../shared.ts";
import { applyPatches } from "../../_shared/core-engine/patch-engine.ts";
import { createEmptyGraph } from "../../_shared/core-engine/utils.ts";
import { GraphSchema } from "../../_shared/core-engine/schemas.ts";
import { withoutPorts } from "../../_shared/core-engine/without-ports.ts";
import { getContainerTypeById } from "../../_shared/core-engine/container-types.ts";
import { collectGitContentRequests, injectGitContent } from "../../_shared/core-engine/proposal-git-content.ts";
import { proposeArchitectureMappings } from "../../_shared/core-engine/architecture-mapping.ts";
import { flagStaleCriteria, nodesWithChangedFiles } from "../../_shared/core-engine/evidence-stale.ts";
import type { Graph, PatchOperation } from "../../_shared/core-engine/types.ts";
import { conflictsSince, describeConflicts, laterPatchFromRow, type PatchRowLike } from "../../_shared/patch-targets.ts";
import { resolveCard } from "../../_shared/card-resolve.ts";
import { projectAncestry, type AncestryFn } from "../../_shared/baseline.ts";
import { claimProposal, type ProposalRow } from "./approvals.ts";
import { releaseHoldsForProposal } from "./checkouts.ts";
import { projectRepoReader } from "./reconcile.ts";
import { refuseLeasedNodeTargets, refuseLockedNodeTargets } from "./proposals.ts";

export type CanvasAuto =
  | { status: "merged"; applied: number; mappings: number; notes: string[] }
  | { status: "waiting"; reason: string }
  | { status: "set aside"; reason: string }
  | { status: "busy" };

type ReadAt = (path: string, ref: string) => Promise<{ status: "found"; text: string } | { status: "absent" } | { status: "failed"; error: string }>;

/** The two reads that leave the database, replaceable in tests. */
export interface CanvasAcceptDeps {
  repoReader: (supabase: SupabaseClient, projectId: string) => Promise<ReadAt | null>;
  ancestry: (supabase: SupabaseClient, projectId: string) => Promise<AncestryFn>;
}

const DEPS: CanvasAcceptDeps = {
  repoReader: (supabase, projectId) => projectRepoReader(supabase, projectId) as Promise<ReadAt | null>,
  ancestry: (supabase, projectId) => projectAncestry(supabase, projectId),
};

type Entry = { patch: PatchOperation; explanation?: string; status?: string };
const PAGE = 1000;
const APPEND_BATCH = 500;

/** A branch's patches after `since`, in order, every page. */
async function patchesAfter(supabase: SupabaseClient, branchId: string, since: number, columns: string): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("graph_patches").select(columns)
      .eq("branch_id", branchId).gt("sequence", since).order("sequence", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`could not read the branch's patches: ${error.message}`);
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** The branch as it stands: its latest snapshot with every later patch applied. */
async function branchHead(supabase: SupabaseClient, branchId: string): Promise<{ graph: Graph; sequence: number; ids: string[] }> {
  const { data: snap, error } = await supabase.from("graph_snapshots").select("graph_data, patch_sequence")
    .eq("branch_id", branchId).order("patch_sequence", { ascending: false }).order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw new Error(`could not read the branch's snapshot: ${error.message}`);
  const row = snap as { graph_data?: Graph; patch_sequence?: number } | null;
  const base = row?.graph_data ?? createEmptyGraph();
  const baseSeq = typeof row?.patch_sequence === "number" ? row.patch_sequence : 0;
  const later = await patchesAfter(supabase, branchId, baseSeq, "id, sequence, payload");
  let graph = base;
  if (later.length > 0) {
    const replay = applyPatches(base, later.map((r) => r.payload as PatchOperation));
    if (!replay.success || !replay.graph) throw new Error(`the branch's own history does not replay (${replay.error?.code ?? "UNKNOWN"}: ${replay.error?.message ?? "no reason"})`);
    graph = replay.graph;
  }
  const sequence = later.length > 0 ? Number(later[later.length - 1].sequence) : baseSeq;
  return { graph, sequence, ids: later.map((r) => String(r.id)) };
}

const patchRows = (branchId: string, patches: PatchOperation[], first: number) => patches.map((p, j) => ({
  id: p.metadata.id,
  branch_id: branchId,
  sequence: first + j,
  patch_type: p.type,
  actor_type: p.metadata.actorType,
  actor_id: null,
  summary: p.metadata.summary,
  payload: p,
  preconditions: (p.metadata as { preconditions?: unknown }).preconditions ?? null,
}));

/** AL.29: append only if the branch is still at `headSequence`, the head the
 *  patches were applied to. False when another writer took the next number
 *  first (nothing of these was written). The rest of a long batch follows
 *  appendPatches. */
async function appendPatchesAfter(supabase: SupabaseClient, branchId: string, patches: PatchOperation[], headSequence: number): Promise<boolean> {
  const first = patches.slice(0, APPEND_BATCH);
  const { error } = await supabase.from("graph_patches").insert(patchRows(branchId, first, headSequence + 1));
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`could not write the patches: ${error.message}`);
  }
  if (patches.length > APPEND_BATCH) await appendPatches(supabase, branchId, patches.slice(APPEND_BATCH));
  return true;
}

/** Append in order, numbered after the branch's head. A number another
 *  writer took meanwhile (23505) is read again and the rest retried. */
async function appendPatches(supabase: SupabaseClient, branchId: string, patches: PatchOperation[]): Promise<void> {
  let left = patches;
  for (let attempt = 0; attempt < 3 && left.length > 0; attempt++) {
    const { data: next, error: seqErr } = await supabase.rpc("get_next_patch_sequence", { p_branch_id: branchId });
    if (seqErr) throw new Error(`could not number the patches: ${seqErr.message}`);
    let seq = Number(next);
    let clash = false;
    for (let i = 0; i < left.length; i += APPEND_BATCH) {
      const batch = left.slice(i, i + APPEND_BATCH);
      const { error } = await supabase.from("graph_patches").insert(patchRows(branchId, batch, seq));
      if (error) {
        if (error.code !== "23505") throw new Error(`could not write the patches: ${error.message}`);
        clash = true;
        break;
      }
      seq += batch.length;
    }
    if (!clash) return;
    const landed = await existingIds(supabase, left.map((p) => p.metadata.id));
    left = left.filter((p) => !landed.has(p.metadata.id));
  }
  if (left.length > 0) throw new Error("could not write the patches: their numbers kept being taken by another writer");
}

async function existingIds(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("graph_patches").select("id").in("id", ids.slice(i, i + 100));
    if (error) throw new Error(`could not read the branch's patches: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string }>) found.add(r.id);
  }
  return found;
}

/** AD.3 (D22) on the server: a file this accept changed makes its node's
 *  git-ticked criteria ask for a re-verify, as the app's accept does. */
async function flagNodeEvidenceStale(supabase: SupabaseClient, projectId: string, nodeId: string, commitSha?: string): Promise<number> {
  const { data: spec } = await supabase.from("project_specifications").select("id")
    .eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!spec) return 0;
  const { data: maps } = await supabase.from("specification_mappings").select("requirement_id")
    .eq("specification_id", (spec as { id: string }).id).eq("node_id", nodeId);
  const reqIds = [...new Set(((maps ?? []) as Array<{ requirement_id: string | null }>).map((m) => m.requirement_id).filter((x): x is string => !!x))];
  if (reqIds.length === 0) return 0;
  const { data: reqs } = await supabase.from("specification_requirements").select("id, acceptance_criteria").in("id", reqIds);
  const at = new Date().toISOString();
  const value = { at, ...(commitSha ? { commitSha } : {}), reason: "source-changed" as const };
  let flagged = 0;
  for (const r of (reqs ?? []) as Array<{ id: string; acceptance_criteria: unknown }>) {
    const { flaggedTexts } = flagStaleCriteria(r.acceptance_criteria, value);
    if (flaggedTexts.length === 0) continue;
    const { error } = await supabase.rpc("apply_criteria_ops", {
      p_requirement_id: r.id,
      p_ops: flaggedTexts.map((text) => ({ op: "mark_stale", criterion_text: text, value })),
    });
    if (!error) flagged += flaggedTexts.length;
  }
  return flagged;
}

/** The app's mapping of new nodes to requirements, on the server. */
async function mapNewNodes(supabase: SupabaseClient, projectId: string, entries: Entry[]): Promise<number> {
  const nodes = entries.filter((e) => e?.patch?.type === "add_node").map((e) => {
    const p = (e.patch.payload ?? {}) as { id?: string; label?: string; type?: string; technology?: string };
    return { id: p.id ?? "", label: p.label || "", type: p.type || "", technology: p.technology || "" };
  });
  if (nodes.length === 0) return 0;
  const { data: spec } = await supabase.from("project_specifications").select("id, preferences")
    .eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const s = spec as { id: string; preferences?: { specEnabled?: boolean } | null } | null;
  if (!s || s.preferences?.specEnabled === false) return 0;
  const { data: reqRows } = await supabase.from("specification_requirements")
    .select("id, name, description, category, acceptance_criteria").eq("specification_id", s.id);
  const requirements = ((reqRows ?? []) as Array<{ id: string; name: string; description: string | null; category: string | null; acceptance_criteria: unknown }>)
    .map((r) => ({
      id: r.id, name: r.name, description: r.description, category: r.category,
      acceptanceCriteria: (Array.isArray(r.acceptance_criteria) ? r.acceptance_criteria : [])
        .filter((c): c is { text: string } => !!c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"),
    }));
  if (requirements.length === 0) return 0;
  const { data: mapped } = await supabase.from("specification_mappings").select("node_id").eq("specification_id", s.id);
  const already = new Set(((mapped ?? []) as Array<{ node_id: string }>).map((m) => m.node_id));
  const rows = proposeArchitectureMappings(nodes, requirements, already, (type) => !!getContainerTypeById(type)).map((m) => ({
    specification_id: s.id, requirement_id: m.requirementId, node_id: m.nodeId, mapping_type: m.mappingType,
    confidence: m.confidence || 1.0, notes: m.notes, created_by: null,
  }));
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("specification_mappings").insert(rows);
  return error ? 0 : rows.length;
}

/** Accept a pending canvas proposal under Auto, as the agent that filed it
 *  (`filer`: its own leases never lock it out). The caller has decided Auto
 *  covers it (autoWaitReason); this runs the accept. */
export async function acceptCanvasBatch(
  supabase: SupabaseClient,
  projectId: string,
  row: Pick<ProposalRow, "id">,
  filer: AuthResult,
  deps: CanvasAcceptDeps = DEPS,
): Promise<CanvasAuto> {
  const claimedAt = new Date().toISOString();
  const claim = await claimProposal(supabase, row.id, claimedAt);
  if (claim !== "claimed") return { status: "busy" };

  // Read it again under the claim: a person may have edited its patches since.
  const { data: fresh } = await supabase.from("ai_proposals").select("id, status, source_branch_id, patches, metadata").eq("id", row.id).maybeSingle();
  const cur = fresh as (ProposalRow & { patches: Entry[] }) | null;
  if (!cur || cur.status !== "pending") return { status: "busy" };
  const meta = (cur.metadata ?? {}) as Record<string, unknown>;
  const entries = (Array.isArray(cur.patches) ? cur.patches : []) as Entry[];
  const branchId = cur.source_branch_id;

  const wait = async (reason: string): Promise<CanvasAuto> => {
    await supabase.from("ai_proposals").update({ reviewed_at: null, metadata: { ...meta, autoWait: { reason, at: new Date().toISOString() } } })
      .eq("id", row.id).eq("status", "pending").eq("reviewed_at", claimedAt);
    return { status: "waiting", reason };
  };
  const setAside = async (reason: string, extra: Record<string, unknown> = {}): Promise<CanvasAuto> => {
    await supabase.from("ai_proposals").update({
      status: "rejected", reviewed_at: claimedAt,
      patches: entries.map((e) => ({ ...e, status: "rejected" })),
      metadata: { ...meta, ...extra, resolvedBy: "auto", resolveNote: reason },
    }).eq("id", row.id).eq("status", "pending").eq("reviewed_at", claimedAt);
    await releaseHoldsForProposal(supabase, row.id);
    return { status: "set aside", reason };
  };

  if (entries.some((e) => e?.status === "conflicted")) {
    return wait("Some of its changes conflict with later changes on the branch: reject those to edit them out, or ask the agent to file again.");
  }
  let approved = entries.filter((e) => e?.status === "approved").map((e) => e.patch);
  if (approved.length === 0) approved = entries.filter((e) => e?.status === "pending").map((e) => e.patch);
  if (approved.length === 0) return wait("It carries no change left to apply.");

  try {
    // V3 2.1: the read it was built on, checked again now. Under Auto a stale
    // read is set aside, as a stale spec batch is.
    const baseSequence = typeof meta.baseSequence === "number" ? meta.baseSequence : null;
    if (baseSequence !== null) {
      const later = await patchesAfter(supabase, branchId, baseSequence, "sequence, patch_type, payload, actor_type, summary");
      const conflicts = conflictsSince(approved, later.map((r) => laterPatchFromRow(r as unknown as PatchRowLike)));
      if (conflicts.length > 0) {
        return setAside(`Stale read: ${describeConflicts(conflicts)} Nothing was applied; re-read the branch and file again.`, { conflicts });
      }
    }

    // V3 2.4 and AA.5: a node locked or leased since it was filed waits for the person.
    const locked = await refuseLockedNodeTargets(supabase, projectId, approved as unknown as Array<Record<string, unknown>>);
    if (locked) return wait(locked.replace(/ Nothing was created\.$/, ""));
    const leased = await refuseLeasedNodeTargets(supabase, filer, projectId, approved as unknown as Array<Record<string, unknown>>, branchId);
    if (leased) return wait(leased.replace(/ Nothing was created\.$/, ""));

    // C1: files bound by reference come from git now, before anything lands.
    const { requests, malformed } = collectGitContentRequests(approved);
    if (malformed.length > 0) {
      return setAside(`Bindings-only files carry no usable git reference: ${malformed.join(", ")}. File again with content_ref, or with the content inline.`);
    }
    if (requests.length > 0) {
      const read = await deps.repoReader(supabase, projectId);
      if (!read) return wait(`It pulls ${requests.length} file(s) from git, and the project's git connection cannot be read: reconnect the repository.`);
      const files = new Map<string, string>();
      for (const r of requests) {
        const got = await read(r.path, r.ref);
        if (got.status === "found") files.set(r.path, got.text);
        else if (got.status === "failed") return wait(`Git could not serve ${r.path} at ${r.ref}: ${got.error}`);
      }
      const injected = injectGitContent(approved, requests, files);
      if (injected.missing.length > 0) {
        return wait(`Git has no ${injected.missing.join(", ")} at ${requests[0].ref}: push the commit its content_ref names.`);
      }
      approved = injected.patches;
    }

    // AG.13: what lands carries no ports.
    approved = withoutPorts(approved);

    const landed = await existingIds(supabase, approved.map((p) => p.metadata.id));
    const fresh = approved.filter((p) => !landed.has(p.metadata.id));

    // AL.29: the read, the base check and the write are one step. The first
    // patch takes the number right after the head the graph was built on, so a
    // writer that lands in between (two agents editing one document from one
    // read) takes that number first; this apply then reads the branch again
    // and checks its base against what landed, instead of writing a whole
    // artifact over it. graph_patches is unique on (branch, sequence).
    let head = await branchHead(supabase, branchId);
    let artifactsBefore = (head.graph.artifacts ?? {}) as Record<string, { nodeId?: string | null; content?: string; contentHash?: string }>;
    let finalGraph = head.graph;
    for (let attempt = 0; fresh.length > 0; attempt++) {
      if (attempt > 0) {
        head = await branchHead(supabase, branchId);
        artifactsBefore = (head.graph.artifacts ?? {}) as typeof artifactsBefore;
      }
      // Everything up to the head this applies to, checked against the read it was built on.
      if (baseSequence !== null) {
        const later = await patchesAfter(supabase, branchId, baseSequence, "sequence, patch_type, payload, actor_type, summary");
        const conflicts = conflictsSince(fresh, later.map((r) => laterPatchFromRow(r as unknown as PatchRowLike)));
        if (conflicts.length > 0) {
          return setAside(`Stale read: ${describeConflicts(conflicts)} Nothing was applied; re-read the branch and file again.`, { conflicts });
        }
      }
      const result = applyPatches(head.graph, fresh);
      if (!result.success || !result.graph) {
        const err = result.error;
        return setAside(`A patch will not apply: ${err?.code ?? "UNKNOWN"}: ${err?.message ?? "no reason given"}${err?.path ? ` (at ${err.path})` : ""}. Nothing was applied; re-read the branch and file again.`);
      }
      const valid = GraphSchema.safeParse(result.graph);
      if (!valid.success) {
        return setAside(`The canvas it leaves is not a valid graph: ${valid.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Nothing was applied.`);
      }
      finalGraph = result.graph;
      if (await appendPatchesAfter(supabase, branchId, fresh, head.sequence)) break;
      if (attempt >= 2) return wait("The branch kept moving while this applied; nothing was written, and it is tried again on the next pass.");
    }

    if (fresh.length > 0) {
      // The snapshot: the graph applied above when the log holds exactly the
      // head it was built on and these patches; otherwise built again from
      // the log, so it never disagrees with it.
      const since = await patchesAfter(supabase, branchId, head.sequence, "id, sequence, payload");
      let snapshotGraph: Graph | null = finalGraph;
      if (since.length !== fresh.length || since.some((r, i) => String(r.id) !== fresh[i].metadata.id)) {
        try { snapshotGraph = (await branchHead(supabase, branchId)).graph; } catch { snapshotGraph = null; }
      }
      const lastSeq = since.length > 0 ? Number(since[since.length - 1].sequence) : head.sequence;
      if (snapshotGraph) {
        await supabase.from("graph_snapshots").insert({
          project_id: projectId, branch_id: branchId, graph_data: snapshotGraph,
          version: snapshotGraph.version, hash: snapshotGraph.hash, patch_sequence: lastSeq,
        });
      }
    }

    const mappings = await mapNewNodes(supabase, projectId, entries).catch(() => 0);

    const now = new Date().toISOString();
    const { autoWait: _was, ...rest } = meta;
    await supabase.from("ai_proposals").update({
      status: "merged", reviewed_at: now, merged_at: now,
      metadata: { ...rest, resolvedBy: "auto", resolveNote: null, auto: true },
    }).eq("id", row.id).eq("status", "pending").eq("reviewed_at", claimedAt);

    const notes: string[] = [];
    const reconciles = meta.reconcilesChange as { eventId?: unknown; commitSha?: unknown } | undefined;
    const loads = meta.loadsModel as { headSha?: unknown } | undefined;
    const sourceCommit = typeof reconciles?.commitSha === "string" ? reconciles.commitSha : typeof loads?.headSha === "string" ? loads.headSha : undefined;
    for (const nodeId of nodesWithChangedFiles(approved, artifactsBefore)) {
      try { await flagNodeEvidenceStale(supabase, projectId, nodeId, sourceCommit); } catch { /* best-effort, as in the app */ }
    }
    // AD.1 (D8): the change card a reconcile answers resolves now, as the version the agent read.
    if (reconciles && typeof reconciles.eventId === "string") {
      try {
        const outcome = await resolveCard(supabase, {
          projectId, eventId: reconciles.eventId, resolution: "accepted",
          expectedCommitSha: String(reconciles.commitSha ?? ""), resolvedBy: filer.userId ?? null,
          metadataPatch: { reconciledByProposal: row.id }, ancestry: await deps.ancestry(supabase, projectId),
        });
        if (!outcome.ok) notes.push(`The change card it answers stays pending: ${outcome.message}`);
      } catch (err) {
        notes.push(`The change card it answers stays pending: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await releaseHoldsForProposal(supabase, row.id);
    return { status: "merged", applied: fresh.length, mappings, notes };
  } catch (err) {
    return wait(`It could not be applied: ${err instanceof Error ? err.message : String(err)}`);
  }
}

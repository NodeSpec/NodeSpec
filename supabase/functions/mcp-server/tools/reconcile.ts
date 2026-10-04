// V3 R.1b: get_pending_changes with change_event_id reads one card's
// reconcile packet (no new tool). This loads the rows; the packet is built by
// _shared/reconcile-packet.ts, and the structural signals come from the
// repository import's extractors through _shared/reconcile-signals.ts, a
// seam the community build stubs (`{ available: false }`).
//
// Plan: the packet is on every plan (git sync is community). The repository
// index owner and the signals ride with repo import (Indie and above); below
// it they are absent and `signals` says `{ available: false }`.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult } from "../shared.ts";
import { credentialLabel, holderIdentity } from "../shared.ts";
import { isMine, isStale } from "./checkouts.ts";
import { loadLatestSnapshot } from "../../_shared/git-drift.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";
import { refreshTaskPackets } from "../../_shared/packet-freshness.ts";
import { providerApiBase, readRepoFile } from "../../_shared/git-provider.ts";
import { decryptWithUpgrade, isEncrypted } from "../../_shared/crypto.ts";
import { computeReconcileSignals, type ReadAt, type ReconcileSignalsResult } from "../../_shared/reconcile-signals.ts";
import {
  buildReconcilePacket,
  type CatalogEntry, type ChangedFileLike, type NodeHold, type NodeRequirement, type NodeTest,
  type PacketGraph, type ReconcilePacket, type TaskDocState,
} from "../../_shared/reconcile-packet.ts";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

const chunk = <T>(xs: T[], n = 100): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** A reader of the project's repository at a ref, or null without one. */
export async function projectRepoReader(supabase: SupabaseClient, projectId: string): Promise<ReadAt | null> {
  const { data: integration } = await supabase
    .from("git_integrations")
    .select("provider, repo_owner, repo_name, base_url, access_token_encrypted")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!integration?.access_token_encrypted) return null;
  let token = String(integration.access_token_encrypted);
  try {
    if (isEncrypted(token)) token = (await decryptWithUpgrade(token)).plaintext;
  } catch {
    return null;
  }
  const apiBase = providerApiBase(integration.provider, integration.base_url);
  return (path, ref) => readRepoFile(integration.provider, apiBase, integration.repo_owner, integration.repo_name, path, ref, token.trim());
}

export interface ReconcileLoadOptions {
  /** Repository import is on this plan: the index owner and the signals. */
  repoImport: boolean;
  /** Test seam: the repository reader (defaults to the project's integration). */
  read?: ReadAt | null;
}

export async function loadReconcilePacket(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  changeEventId: string,
  opts: ReconcileLoadOptions,
): Promise<{ packet: ReconcilePacket; event: AnyRecord } | { error: string }> {
  const { data: event, error } = await supabase
    .from("git_change_events")
    .select("id, commit_sha, commit_message, author, changed_files, status, metadata, created_at")
    .eq("id", changeEventId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!event) return { error: `No change ${changeEventId} on this project. List the pending changes with get_pending_changes and pass one of their changeEventId values.` };
  const meta = (event.metadata ?? {}) as AnyRecord;
  const changedFiles = (Array.isArray(event.changed_files) ? event.changed_files as unknown[] : [])
    .map((f) => (typeof f === "string" ? { path: f, action: "modified" } : f) as AnyRecord | null)
    .filter((f): f is AnyRecord => !!f && typeof f.path === "string") as ChangedFileLike[];

  // The card's branch (AD.4: no name means the primary, by its flag).
  const branch = typeof meta.branchName === "string" && meta.branchName
    ? (await supabase.from("branches").select("id, name").eq("project_id", projectId).eq("name", meta.branchName).maybeSingle()).data
    : meta.unmappedRef ? null : await getPrimaryBranch(supabase, projectId, "id, name, is_primary");
  const branchId = (branch as AnyRecord | null)?.id as string | undefined;
  const graph = branchId ? ((await loadLatestSnapshot(supabase, branchId)).graph as PacketGraph | null) : null;
  const nodes = graph?.nodes ?? {};
  const artifacts = Object.values(graph?.artifacts ?? {}) as AnyRecord[];
  const paths = changedFiles.map((f) => String(f.path).replace(/^\/+/, ""));

  // Repository index owners (Indie and above).
  const indexOwners = new Map<string, string>();
  if (opts.repoImport && branchId && paths.length > 0) {
    for (const part of chunk(paths)) {
      const { data } = await supabase.from("repo_index").select("path, node_id").eq("branch_id", branchId).in("path", part);
      for (const r of (data ?? []) as AnyRecord[]) if (r.path && r.node_id) indexOwners.set(String(r.path), String(r.node_id));
    }
  }

  // Touched nodes: bound owners and index owners of the changed paths.
  const byPath = new Map(artifacts.filter((a) => a?.path).map((a) => [String(a.path).replace(/^\/+/, ""), a]));
  const touched = new Set<string>();
  for (const f of changedFiles) {
    const p = String(f.path).replace(/^\/+/, "");
    const bound = byPath.get(p) ?? (f.oldPath ? byPath.get(String(f.oldPath).replace(/^\/+/, "")) : undefined);
    if (bound?.nodeId && nodes[bound.nodeId]) touched.add(String(bound.nodeId));
    else if (indexOwners.get(p) && nodes[indexOwners.get(p)!]) touched.add(indexOwners.get(p)!);
  }
  const nodeIds = [...touched];

  // Mapped requirements and the tests on them.
  const requirements = new Map<string, NodeRequirement[]>();
  const tests = new Map<string, NodeTest[]>();
  if (nodeIds.length > 0) {
    const { data: maps } = await supabase.from("specification_mappings").select("requirement_id, node_id").in("node_id", nodeIds);
    const mapRows = (maps ?? []) as AnyRecord[];
    const rowIds = [...new Set(mapRows.map((m) => String(m.requirement_id)))];
    if (rowIds.length > 0) {
      const [{ data: reqs }, { data: cases }] = await Promise.all([
        supabase.from("specification_requirements").select("id, requirement_id, name, locked, confirmed, archived_at").in("id", rowIds),
        supabase.from("test_cases").select("requirement_id, name, artifact_path, retired_at").in("requirement_id", rowIds),
      ]);
      const reqById = new Map(((reqs ?? []) as AnyRecord[]).filter((r) => !r.archived_at).map((r) => [String(r.id), r]));
      for (const m of mapRows) {
        const r = reqById.get(String(m.requirement_id));
        if (!r) continue;
        const nodeId = String(m.node_id);
        const displayId = String(r.requirement_id ?? r.id);
        requirements.set(nodeId, [...(requirements.get(nodeId) ?? []), { id: displayId, name: String(r.name ?? ""), locked: r.locked === true, confirmed: r.confirmed === true }]);
        const own = ((cases ?? []) as AnyRecord[]).filter((t) => String(t.requirement_id) === String(m.requirement_id) && !t.retired_at);
        tests.set(nodeId, [...(tests.get(nodeId) ?? []), ...own.map((t) => ({ name: String(t.name ?? ""), path: t.artifact_path ? String(t.artifact_path) : null, requirement: displayId }))]);
      }
    }
  }

  // Live holds on the touched nodes (a node, its files, or its tasks).
  const holds = new Map<string, NodeHold[]>();
  if (nodeIds.length > 0) {
    const { data: leaseRows } = await supabase
      .from("agent_checkouts")
      .select("level, holder_label, holder_key_id, holder_delegate, task_item_id, artifact_id, node_id, since, heartbeat_at")
      .eq("project_id", projectId)
      .is("released_at", null);
    const leases = ((leaseRows ?? []) as AnyRecord[]).filter((l) => !isStale(l.heartbeat_at));
    const taskIds = leases.map((l) => l.task_item_id).filter(Boolean) as string[];
    const taskNode = new Map<string, string>();
    if (taskIds.length > 0) {
      const { data } = await supabase.from("task_items").select("id, node_id").in("id", taskIds);
      for (const t of (data ?? []) as AnyRecord[]) if (t.node_id) taskNode.set(String(t.id), String(t.node_id));
    }
    const artifactNode = new Map(artifacts.map((a) => [String(a.id), String(a.nodeId ?? "")]));
    const keyIds = [...new Set(leases.map((l) => l.holder_key_id).filter(Boolean))] as string[];
    const keyNames = new Map<string, string>();
    if (keyIds.length > 0) {
      const { data } = await supabase.from("mcp_api_keys").select("id, name").in("id", keyIds);
      for (const k of (data ?? []) as AnyRecord[]) if (k.name) keyNames.set(String(k.id), String(k.name));
    }
    const me = holderIdentity(auth);
    for (const l of leases) {
      const nodeId = l.node_id ? String(l.node_id)
        : l.artifact_id ? artifactNode.get(String(l.artifact_id))
        : l.task_item_id ? taskNode.get(String(l.task_item_id)) : undefined;
      if (!nodeId || !touched.has(nodeId)) continue;
      const holder = credentialLabel(l.holder_delegate ?? (l.holder_key_id ? `key:${l.holder_key_id}` : null), keyNames) ?? String(l.holder_label ?? "someone");
      holds.set(nodeId, [...(holds.get(nodeId) ?? []), { level: String(l.level), holder, since: l.since ? String(l.since) : null, mine: isMine(auth, me, l as never) }]);
    }
  }

  // Task-doc freshness: a check that regenerates and writes nothing.
  const taskDocs = new Map<string, TaskDocState>();
  const docs = artifacts.filter((a) => a?.kind === "task" && touched.has(String(a.nodeId)));
  if (docs.length > 0 && graph) {
    let stale: Set<string> | null = null;
    try {
      const check = await refreshTaskPackets(supabase, projectId, structuredClone(graph), branchId ?? null, { checkOnly: true, nodeIds });
      stale = check.error ? null : new Set(check.stalePaths ?? []);
    } catch { stale = null; }
    for (const a of docs) {
      const managed = !!a.metadata?.taskContextFingerprint?.fingerprint;
      const state: TaskDocState["state"] = !managed ? "unmanaged" : stale === null ? "unknown" : stale.has(String(a.path)) ? "stale" : "fresh";
      taskDocs.set(String(a.nodeId), { path: String(a.path), state });
    }
  }

  // Structural signals (Indie and above), and the catalog to name them.
  let signals: ReconcileSignalsResult = { available: false };
  let catalog: CatalogEntry[] = [];
  if (opts.repoImport && event.commit_sha) {
    const read = opts.read !== undefined ? opts.read : await projectRepoReader(supabase, projectId);
    if (read) {
      signals = await computeReconcileSignals(
        changedFiles.map((f) => ({ path: String(f.path).replace(/^\/+/, ""), action: f.action === "added" || f.action === "removed" ? f.action : "modified", ...(f.oldPath ? { oldPath: String(f.oldPath) } : {}) })),
        { baseSha: typeof meta.baseSha === "string" ? meta.baseSha : null, headSha: String(event.commit_sha), read },
      );
    }
    if (signals.available && (signals.deps.added.length + signals.deps.dropped.length + signals.imports.added.length) > 0) {
      const { data } = await supabase
        .from("technology_catalog")
        .select("id, name, display_name, role_affinities, ai_context, project_id");
      catalog = ((data ?? []) as AnyRecord[])
        .filter((r) => !r.project_id || r.project_id === projectId)
        .map((r) => ({
          id: String(r.id),
          name: String(r.name ?? r.id),
          displayName: r.display_name ?? null,
          roles: Array.isArray(r.role_affinities) ? r.role_affinities.map(String) : [],
          typicalTech: Array.isArray(r.ai_context?.typicalTech) ? r.ai_context.typicalTech.map(String) : [],
          dataModel: typeof r.ai_context?.dataModel === "string" ? r.ai_context.dataModel : null,
        }));
    }
  }

  const packet = buildReconcilePacket({
    card: { id: String(event.id), commitSha: event.commit_sha ?? null, status: String(event.status), changedFiles, metadata: meta },
    branchName: (branch as AnyRecord | null)?.name ?? null,
    graph,
    indexOwners,
    requirements,
    tests,
    holds,
    taskDocs,
    signals,
    catalog,
  });
  return { packet, event };
}

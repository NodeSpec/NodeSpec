// AA.3 (owner 2026-09-23): what explode_node and collapse_node compile
// against, read once per propose call: the branch graph, the depth rule from
// the catalog, the repo index rows of the nodes in play (the target and its
// parts), the file imports among them, and the files proving each
// requirement mapped there. And the rule that goes with it: exploding or
// collapsing a node needs the node's lease (AA.5).
//
// Structural supabase param + type-only SupabaseClient, so the module is
// offline-testable against FakeSupabase and MemorySupabase.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { CatalogData } from "../../_shared/catalog-loader.ts";
import type { ExplodeContext } from "../../_shared/explode.ts";
import { isPartRole, namedRoleIds } from "../../_shared/part-roles.ts";
import { loadGraphData } from "../../_shared/mcp-context-assembly.ts";
import type { AuthResult } from "../shared.ts";
import { holderIdentity } from "../shared.ts";
import { isMine, isStale } from "./checkouts.ts";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

const PAGE = 1000;
const CHUNK = 150;

/** Every row of a paged read (PostgREST caps a response at its max rows). */
async function allRows(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, cap = 20000): Promise<AnyRecord[]> {
  const out: AnyRecord[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error || !Array.isArray(data)) break;
    out.push(...(data as AnyRecord[]));
    if (data.length < PAGE) break;
  }
  return out;
}

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** The depth rule, read from the catalog: a role's parts, and whether a role is a part. */
export function depthRuleFromCatalog(catalogs: CatalogData | null): Pick<ExplodeContext, "partsOf" | "isPart" | "isDataPart" | "dataModelOf"> {
  return {
    partsOf: (roleId: string) => {
      if (!catalogs) return null;
      const row = catalogs.nodeRoles[roleId];
      if (!row) return [];
      return namedRoleIds(row.can_contain).filter((id) => isPartRole(catalogs.nodeRoles[id]));
    },
    isPart: (roleId: string) => !!catalogs && isPartRole(catalogs.nodeRoles[roleId]),
    // AA.3b: a part whose interface is data groups a data store's contents (a table group).
    isDataPart: (roleId: string) => !!catalogs && isPartRole(catalogs.nodeRoles[roleId]) && catalogs.nodeRoles[roleId]?.interface_kind === "data",
    dataModelOf: (technologyId) => {
      if (!catalogs || !technologyId) return null;
      const model = (catalogs.technologies[technologyId]?.ai_context as Record<string, unknown> | undefined)?.dataModel;
      return typeof model === "string" ? model : null;
    },
  };
}

export async function loadExplodeContext(
  supabase: SupabaseClient,
  branchId: string,
  targetIds: string[],
  catalogs: CatalogData | null,
  citedPaths: string[] = [],
): Promise<ExplodeContext | null> {
  const graph = (await loadGraphData(supabase, branchId)) as AnyRecord | null;
  if (!graph || typeof graph.nodes !== "object") return null;
  const nodes: ExplodeContext["nodes"] = {};
  for (const n of Object.values(graph.nodes ?? {}) as AnyRecord[]) {
    if (n?.id) nodes[String(n.id)] = { id: String(n.id), type: String(n.type ?? ""), label: String(n.label ?? n.id), parentId: n.parentId ?? null, technology: n.technology ?? null };
  }
  const edges: ExplodeContext["edges"] = {};
  for (const e of Object.values(graph.edges ?? {}) as AnyRecord[]) {
    if (e?.id) edges[String(e.id)] = { id: String(e.id), source: String(e.source), target: String(e.target), contractId: e.contractId ? String(e.contractId) : undefined, metadata: e.metadata ?? undefined };
  }
  const artifacts: ExplodeContext["artifacts"] = {};
  for (const a of Object.values(graph.artifacts ?? {}) as AnyRecord[]) {
    if (a?.id && a.nodeId && a.path) artifacts[String(a.id)] = { id: String(a.id), nodeId: String(a.nodeId), path: String(a.path), kind: a.kind ?? null };
  }

  const targets = new Set(targetIds.filter((id) => nodes[id]));
  const inPlay = [...new Set([...targets, ...Object.values(nodes).filter((n) => n.parentId && targets.has(n.parentId)).map((n) => n.id)])];

  const indexed: ExplodeContext["indexed"] = [];
  for (const ids of chunks(inPlay)) {
    const rows = await allRows((from, to) =>
      supabase.from("repo_index").select("path, node_id").eq("branch_id", branchId).in("node_id", ids).order("path").range(from, to)
    );
    for (const r of rows) if (r.path && r.node_id) indexed.push({ path: String(r.path), nodeId: String(r.node_id) });
  }

  const paths = new Set([...indexed.map((r) => r.path), ...Object.values(artifacts).filter((a) => inPlay.includes(a.nodeId)).map((a) => a.path)]);
  const imports: ExplodeContext["imports"] = [];
  for (const from of chunks([...paths])) {
    const rows = await allRows((a, b) =>
      supabase.from("repo_index_edges").select("from_path, to_path").eq("branch_id", branchId).in("from_path", from).range(a, b)
    );
    for (const r of rows) if (paths.has(String(r.to_path))) imports.push({ from: String(r.from_path), to: String(r.to_path) });
  }

  // Item 25: a group's table may name the file that defines it wherever it
  // lives (a service's migrations, say). A file bound to a node is in the
  // graph already; one the repo index alone knows is looked up here.
  const known = new Set([...indexed.map((r) => r.path), ...Object.values(artifacts).map((a) => a.path)]);
  const unresolved = [...new Set(citedPaths)].filter((p) => !known.has(p));
  for (const some of chunks(unresolved)) {
    const { data } = await supabase.from("repo_index").select("path").eq("branch_id", branchId).in("path", some);
    for (const r of (data ?? []) as AnyRecord[]) if (r.path) known.add(String(r.path));
  }
  const knownPaths = new Set(citedPaths.filter((p) => known.has(p)));

  const proofs: ExplodeContext["proofs"] = [];
  if (inPlay.length > 0) {
    const { data: maps } = await supabase.from("specification_mappings").select("requirement_id, node_id, artifact_ids").in("node_id", inPlay);
    const mapRows = (maps ?? []) as AnyRecord[];
    const rowIds = [...new Set(mapRows.map((m) => String(m.requirement_id)))];
    if (rowIds.length > 0) {
      const [{ data: reqs }, { data: tests }] = await Promise.all([
        supabase.from("specification_requirements").select("id, requirement_id, name, archived_at").in("id", rowIds),
        supabase.from("test_cases").select("requirement_id, artifact_path, source_artifact_ids, retired_at").in("requirement_id", rowIds),
      ]);
      const reqById = new Map(((reqs ?? []) as AnyRecord[]).filter((r) => !r.archived_at).map((r) => [String(r.id), r]));
      const pathOf = (id: unknown) => artifacts[String(id)]?.path ?? null;
      for (const m of mapRows) {
        const req = reqById.get(String(m.requirement_id));
        if (!req) continue;
        const own = ((tests ?? []) as AnyRecord[]).filter((t) => String(t.requirement_id) === String(m.requirement_id) && !t.retired_at);
        const proving = [
          ...own.map((t) => t.artifact_path).filter(Boolean).map(String),
          ...own.flatMap((t) => (Array.isArray(t.source_artifact_ids) ? t.source_artifact_ids : [])).map(pathOf),
          ...(Array.isArray(m.artifact_ids) ? m.artifact_ids : []).map(pathOf),
        ].filter((p): p is string => !!p);
        proofs.push({ requirement: `${req.requirement_id ?? req.id} "${req.name ?? ""}"`, nodeId: String(m.node_id), paths: [...new Set(proving)] });
      }
    }
  }
  return { nodes, edges, artifacts, indexed, imports, proofs, knownPaths, ...depthRuleFromCatalog(catalogs) };
}

/** Item 25: whether a role explodes into table groups (a data store): one of
 *  the parts it lists is a part whose interface is data. Read from the catalog. */
export async function explodesIntoTableGroups(supabase: SupabaseClient, roleId: string): Promise<boolean> {
  const { data: row } = await supabase.from("node_roles").select("can_contain").eq("id", roleId).maybeSingle();
  const listed = namedRoleIds((row as AnyRecord | null)?.can_contain);
  if (listed.length === 0) return false;
  const { data } = await supabase.from("node_roles").select("id, capability_tags, interface_kind").in("id", listed);
  return ((data ?? []) as AnyRecord[]).some((r) => isPartRole(r) && r.interface_kind === "data");
}

/** AA.3: exploding or collapsing a node changes its structure, so it needs the
 *  node's lease, held by this credential. Returns the refusal, or null. */
export async function requireNodeLeases(
  supabase: SupabaseClient,
  auth: AuthResult,
  projectId: string,
  targets: Array<{ nodeId: string; label: string; kind: string }>,
): Promise<string | null> {
  if (targets.length === 0) return null;
  const { data } = await supabase
    .from("agent_checkouts")
    .select("node_id, holder_label, holder_key_id, holder_delegate, heartbeat_at")
    .eq("project_id", projectId)
    .eq("level", "node")
    .in("node_id", targets.map((t) => t.nodeId))
    .is("released_at", null);
  const me = holderIdentity(auth);
  const leases = (data ?? []) as Array<{ node_id: string; holder_label: string; holder_key_id: string | null; holder_delegate: string | null; heartbeat_at: string }>;
  const missing = targets.filter((t) => !leases.some((l) => l.node_id === t.nodeId && !isStale(l.heartbeat_at) && isMine(auth, me, l)));
  if (missing.length === 0) return null;
  return missing.map((t) =>
    `${t.kind} changes the structure of "${t.label}", so it needs the node's lease: claim it with checkout_task (level "node", node_id "${t.nodeId}"), then propose again.`
  ).join(" ") + " Nothing was created.";
}

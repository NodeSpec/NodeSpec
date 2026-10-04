// V3 R.1b: one change card's reconcile packet. Pure.
//
// A card says which files changed; the packet says what that means to the
// architecture, so an agent reconciles in one read and one write instead of
// rubber-stamping content or re-reading the repository:
//   - per file: action, the owning node (its binding, else the repository
//     index's node, else the nearest bound directory as a suggestion with its
//     reason), and whether it is a task doc, a test, a spec or model anchor;
//   - per touched node: role, technology, contracts in and out with the
//     counterpart, mapped requirements (locked, confirmed), bound tests, live
//     holds, task-doc freshness, and whether its last file was removed;
//   - structural signals from the diff (reconcile-signals.ts, Indie and above;
//     below it `{ available: false }`, never an empty list);
//   - a classification, and the conflicts behind it;
//   - a draft resolution: intents for resolve_change, each citing its file
//     and line, for the agent to edit rather than invent.
// The loader (mcp-server/tools/reconcile.ts) reads the rows; this builds.

import type { ReconcileSignalsResult, NamedSignal } from "./reconcile-signals.ts";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

export interface ChangedFileLike { path: string; action: string; oldPath?: string }

export interface PacketGraph {
  nodes: Record<string, AnyRecord>;
  edges?: Record<string, AnyRecord>;
  contracts?: Record<string, AnyRecord>;
  artifacts?: Record<string, AnyRecord>;
}

export interface CatalogEntry {
  id: string;
  name: string;
  displayName?: string | null;
  roles: string[];
  typicalTech: string[];
  dataModel?: string | null;
}

export interface NodeRequirement { id: string; name: string; locked: boolean; confirmed: boolean }
export interface NodeTest { name: string; path: string | null; requirement: string }
export interface NodeHold { level: string; holder: string; since: string | null; mine: boolean }
export interface TaskDocState { path: string; state: "fresh" | "stale" | "unmanaged" | "unknown" }

export interface PacketInputs {
  card: { id: string; commitSha: string | null; status: string; changedFiles: ChangedFileLike[]; metadata: AnyRecord };
  branchName: string | null;
  graph: PacketGraph | null;
  /** Repository index owners of the changed paths (Indie and above; else empty). */
  indexOwners: Map<string, string>;
  requirements: Map<string, NodeRequirement[]>;
  tests: Map<string, NodeTest[]>;
  holds: Map<string, NodeHold[]>;
  taskDocs: Map<string, TaskDocState>;
  signals: ReconcileSignalsResult;
  catalog: CatalogEntry[];
}

export type FileKind = "task-doc" | "test-plan" | "test" | "spec-anchor" | "model-anchor" | "bindings" | "board";

export interface PacketFile {
  path: string;
  action: "added" | "modified" | "removed" | "renamed";
  oldPath?: string;
  kind?: FileKind;
  owner?: { nodeId: string; label: string; via: "binding" | "repo-index"; artifactId?: string };
  suggestion?: { nodeId: string; label: string; reason: string };
  /** The file sits in a directory this change adds with its own manifest. */
  newDirectory?: string;
}

export interface ContractEnd { contractId: string | null; name: string | null; kind: string | null; counterpart: { nodeId: string; label: string } }

export interface PacketNode {
  nodeId: string;
  label: string;
  role: string | null;
  technology: string | null;
  files: string[];
  contracts: { in: ContractEnd[]; out: ContractEnd[] };
  requirements: NodeRequirement[];
  tests: NodeTest[];
  holds: NodeHold[];
  taskDoc: TaskDocState | null;
  lastFileRemoved?: true;
}

export interface CatalogRef { id: string; name: string }

export type PacketSignals = { available: false } | {
  available: true;
  routes: { added: Array<{ method: string; route: string; path: string; line?: number; nodeId?: string }>; removed: Array<{ method: string; route: string; path: string; line?: number; nodeId?: string }> };
  hosts: { added: Array<{ host: string; path: string; line?: number }> };
  dependencies: { added: Array<NamedSignal & { catalog?: CatalogRef }>; dropped: Array<NamedSignal & { catalog?: CatalogRef }> };
  /** Module imports the change adds that name a catalog entry. */
  clients: Array<NamedSignal & { catalog: CatalogRef }>;
  env: { added: NamedSignal[] };
  deployments: { added: Array<{ kind: string; path: string; line?: number; detail?: string }>; removed: Array<{ kind: string; path: string; detail?: string }> };
  newDirectories: Array<{ dir: string; manifests: string[]; files: string[] }>;
  unread: string[];
};

export type Classification = "content-only" | "needs-binding" | "structural" | "spec" | "model-edited" | "conflicts";

export interface ReconcilePacket {
  changeEventId: string;
  commitSha: string | null;
  baseSha: string | null;
  branchName: string | null;
  status: string;
  files: PacketFile[];
  nodes: PacketNode[];
  signals: PacketSignals;
  classification: Classification[];
  conflicts: Array<{ nodeId: string; label: string; reason: string }>;
  draft: { intents: AnyRecord[]; notes: string[] };
}

/** Roles a dependency names as a node of its own (a store, a broker, a
 *  service reached over the network), never a library inside the caller. */
export const BACKING_ROLES = new Set([
  "database", "cache", "message-broker", "queue", "event-stream", "event-store", "external-service",
  "external-data", "object-storage", "search-engine", "vector-database", "graph-db", "time-series-db",
  "data-warehouse", "auth-provider", "feature-store", "secret-manager", "config-store", "notification-service",
]);

/** The runtime a new service's manifest names, as a catalog id. */
const MANIFEST_TECH: Record<string, string> = {
  "package.json": "nodejs", "requirements.txt": "python-backend", "pyproject.toml": "python-backend",
  "go.mod": "go-backend", "Cargo.toml": "rust-backend", "Gemfile": "ruby-backend",
  "composer.json": "php-backend", "pom.xml": "java-backend", "build.gradle": "java-backend",
  "build.gradle.kts": "kotlin-backend",
};

const MAX_FILE_BINDS = 40;
const MAX_ENDS = 20;
const MAX_TESTS = 20;
const TEST_PATH = /(^|\/)(__tests__|tests?|spec|e2e)\/|\.(test|spec)\.[a-z0-9]+$|_test\.[a-z0-9]+$|(^|\/)test_[^/]+\.py$/i;

const norm = (p: unknown) => String(p ?? "").replace(/^\/+/, "");
const dirOf = (p: string) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
const baseOf = (p: string) => p.split("/").pop() ?? p;
const labelOf = (n: AnyRecord | undefined, id: string) => String(n?.label ?? n?.name ?? id);
const OWN_KINDS = new Set(["task", "test-plan"]);

export function fileKind(path: string, artifactKind?: string | null, testPaths?: Set<string>): FileKind | undefined {
  if (path === ".nodespec/model.json") return "model-anchor";
  if (path === ".nodespec/spec.json") return "spec-anchor";
  if (path === ".nodespec/bindings.json") return "bindings";
  if (path === ".nodespec/BOARD.md") return "board";
  if (artifactKind === "task" || (path.startsWith(".nodespec/tasks/") && path.endsWith(".task.md"))) return "task-doc";
  if (artifactKind === "test-plan") return "test-plan";
  if (testPaths?.has(path) || TEST_PATH.test(path)) return "test";
  return undefined;
}

/** The catalog entry a dependency or module name names: by id or name first,
 *  then by the entry's typical technology list (`ioredis` names Redis). */
export function catalogFor(raw: string, catalog: CatalogEntry[]): CatalogEntry | null {
  const lower = raw.toLowerCase();
  const scope = lower.match(/^@([^/]+)\//)?.[1] ?? null;
  const keys = [lower, ...(scope ? [scope] : [])];
  for (const key of keys) {
    const hit = catalog.find((e) => e.id.toLowerCase() === key || e.name.toLowerCase() === key || (e.displayName ?? "").toLowerCase() === key);
    if (hit) return hit;
  }
  const byTech = catalog.filter((e) => e.typicalTech.some((t) => t.toLowerCase() === lower));
  if (byTech.length === 1) return byTech[0];
  const contained = byTech.filter((e) => lower.includes(e.id.toLowerCase()));
  return contained.length === 1 ? contained[0] : null;
}

/** The contract kind an edge to a backing entry of this role carries. */
export function contractKindFor(entry: CatalogEntry, role: string): string {
  if (entry.id.includes("kafka") || role === "event-stream" || role === "event-store") return "kafka";
  if (role === "message-broker" || role === "queue") return "amqp";
  if (["database", "data-warehouse", "time-series-db"].includes(role)) {
    return !entry.dataModel || entry.dataModel === "relational" ? "sql" : "nosql";
  }
  if (["cache", "vector-database", "search-engine", "graph-db", "feature-store"].includes(role)) return "nosql";
  return "rest";
}

function slug(s: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return out || "node";
}

function titleOf(dir: string): string {
  const b = baseOf(dir) || dir || "service";
  return b.split(/[-_ ]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function bindKind(path: string): string {
  const b = baseOf(path);
  if (/^Dockerfile(\..+)?$/.test(b) || b.endsWith(".dockerfile") || /^docker-compose/.test(b)) return "build";
  if (/\.(md|mdx|rst|txt)$/i.test(b)) return "doc";
  if (/\.(json|ya?ml|toml|ini|env|lock)$/i.test(b) || /^(Gemfile|go\.mod|pom\.xml)$/.test(b)) return "config";
  if (/\.(sql|prisma|graphql|gql|proto|avsc)$/i.test(b)) return "schema";
  return "source";
}

export function buildReconcilePacket(inp: PacketInputs): ReconcilePacket {
  const nodes = inp.graph?.nodes ?? {};
  const artifacts = Object.values(inp.graph?.artifacts ?? {}) as AnyRecord[];
  const byPath = new Map<string, AnyRecord>();
  for (const a of artifacts) if (a?.path) byPath.set(norm(a.path), a);
  const testPaths = new Set<string>();
  for (const list of inp.tests.values()) for (const t of list) if (t.path) testPaths.add(norm(t.path));
  const meta = inp.card.metadata ?? {};
  const ignored = new Set<string>(Array.isArray(meta.ignoredResidue) ? meta.ignoredResidue.map(String) : []);

  // Bound files per directory, for the nearest-directory suggestion.
  const boundUnder = (dir: string) => artifacts.filter((a) =>
    a?.path && a.nodeId && nodes[a.nodeId] && !OWN_KINDS.has(String(a.kind)) && (dir === "" ? true : norm(a.path).startsWith(dir + "/"))
  );
  const suggestFor = (path: string): PacketFile["suggestion"] | undefined => {
    for (let dir = dirOf(path); dir !== ""; dir = dirOf(dir)) {
      const bound = boundUnder(dir);
      if (bound.length === 0) continue;
      const count = new Map<string, number>();
      for (const a of bound) count.set(String(a.nodeId), (count.get(String(a.nodeId)) ?? 0) + 1);
      const ranked = [...count.entries()].sort((x, y) => y[1] - x[1]);
      if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return undefined;
      const [nodeId, n] = ranked[0];
      return { nodeId, label: labelOf(nodes[nodeId], nodeId), reason: `${n} of the ${bound.length} bound file(s) under ${dir}/ belong to it` };
    }
    return undefined;
  };

  const files: PacketFile[] = inp.card.changedFiles.map((f) => {
    const path = norm(f.path);
    const oldPath = f.oldPath ? norm(f.oldPath) : undefined;
    const action: PacketFile["action"] = oldPath && oldPath !== path ? "renamed" : (f.action === "added" || f.action === "removed" ? f.action : "modified");
    const bound = byPath.get(path) ?? (oldPath ? byPath.get(oldPath) : undefined);
    const kind = fileKind(path, bound?.kind ?? null, testPaths);
    const out: PacketFile = { path, action, ...(oldPath && action === "renamed" ? { oldPath } : {}), ...(kind ? { kind } : {}) };
    if (bound?.nodeId && nodes[bound.nodeId]) {
      out.owner = { nodeId: String(bound.nodeId), label: labelOf(nodes[bound.nodeId], bound.nodeId), via: "binding", artifactId: String(bound.id) };
    } else if (inp.indexOwners.get(path) && nodes[inp.indexOwners.get(path)!]) {
      const nodeId = inp.indexOwners.get(path)!;
      out.owner = { nodeId, label: labelOf(nodes[nodeId], nodeId), via: "repo-index" };
    } else if (!path.startsWith(".nodespec/") && action !== "removed") {
      const s = suggestFor(path);
      if (s) out.suggestion = s;
    }
    return out;
  });

  // Touched nodes: every owner.
  const touched = new Map<string, string[]>();
  for (const f of files) if (f.owner) touched.set(f.owner.nodeId, [...(touched.get(f.owner.nodeId) ?? []), f.path]);
  const removed = new Set(files.filter((f) => f.action === "removed").map((f) => f.path));
  const edges = Object.values(inp.graph?.edges ?? {}) as AnyRecord[];
  const contracts = inp.graph?.contracts ?? {};
  const endOf = (e: AnyRecord, other: string): ContractEnd => {
    const c = e.contractId ? contracts[e.contractId] : undefined;
    return {
      contractId: e.contractId ? String(e.contractId) : null,
      name: c?.name ? String(c.name) : (e.label ? String(e.label) : null),
      kind: c?.kind ? String(c.kind) : null,
      counterpart: { nodeId: other, label: labelOf(nodes[other], other) },
    };
  };
  const packetNodes: PacketNode[] = [...touched.entries()].map(([nodeId, paths]) => {
    const n = nodes[nodeId];
    const own = artifacts.filter((a) => a?.nodeId === nodeId && a.path && !OWN_KINDS.has(String(a.kind)));
    const lastFileRemoved = own.length > 0 && own.every((a) => removed.has(norm(a.path)));
    return {
      nodeId,
      label: labelOf(n, nodeId),
      role: n?.type ? String(n.type) : null,
      technology: n?.technology ? String(n.technology) : null,
      files: paths,
      contracts: {
        in: edges.filter((e) => e.target === nodeId).slice(0, MAX_ENDS).map((e) => endOf(e, String(e.source))),
        out: edges.filter((e) => e.source === nodeId).slice(0, MAX_ENDS).map((e) => endOf(e, String(e.target))),
      },
      requirements: inp.requirements.get(nodeId) ?? [],
      tests: (inp.tests.get(nodeId) ?? []).slice(0, MAX_TESTS),
      holds: inp.holds.get(nodeId) ?? [],
      taskDoc: inp.taskDocs.get(nodeId) ?? null,
      ...(lastFileRemoved ? { lastFileRemoved: true as const } : {}),
    };
  });

  // Structural signals, with owners and catalog entries named.
  const ownerOf = new Map(files.filter((f) => f.owner).map((f) => [f.path, f.owner!.nodeId]));
  const withCatalog = (s: NamedSignal) => {
    const hit = catalogFor(s.name, inp.catalog);
    return hit ? { ...s, catalog: { id: hit.id, name: hit.name } } : { ...s };
  };
  let signals: PacketSignals = { available: false };
  const newDirs: Array<{ dir: string; manifests: string[]; files: string[] }> = [];
  if (inp.signals.available) {
    const s = inp.signals;
    const added = files.filter((f) => f.action === "added");
    for (const m of s.manifests.added) {
      const dir = m.dir;
      if (dir === "" || newDirs.some((d) => d.dir === dir)) {
        newDirs.find((d) => d.dir === dir)?.manifests.push(m.path);
        continue;
      }
      // New: nothing under it is bound or indexed to a node, and the change
      // only adds there.
      const under = (p: string) => p.startsWith(dir + "/");
      if (boundUnder(dir).length > 0) continue;
      if (files.some((f) => under(f.path) && (f.action !== "added" || f.owner))) continue;
      newDirs.push({ dir, manifests: [m.path], files: added.filter((f) => under(f.path)).map((f) => f.path) });
    }
    // A nested manifest belongs to the outermost new directory.
    const outer = newDirs.filter((d) => !newDirs.some((o) => o !== d && d.dir.startsWith(o.dir + "/")));
    for (const d of newDirs) {
      if (outer.includes(d)) continue;
      const o = outer.find((x) => d.dir.startsWith(x.dir + "/"));
      if (o) o.manifests.push(...d.manifests);
    }
    newDirs.splice(0, newDirs.length, ...outer);
    // A file in a new directory belongs to the new node, not a neighbour's.
    for (const f of files) {
      const d = newDirs.find((x) => f.path.startsWith(x.dir + "/"));
      if (!d) continue;
      delete f.suggestion;
      f.newDirectory = d.dir;
    }
    signals = {
      available: true,
      routes: {
        added: s.routes.added.map((r) => ({ method: r.method, route: r.route, path: r.path, ...(r.line ? { line: r.line } : {}), ...(ownerOf.has(r.path) ? { nodeId: ownerOf.get(r.path) } : {}) })),
        removed: s.routes.removed.map((r) => ({ method: r.method, route: r.route, path: r.path, ...(r.line ? { line: r.line } : {}), ...(ownerOf.has(r.path) ? { nodeId: ownerOf.get(r.path) } : {}) })),
      },
      hosts: { added: s.hosts.added.map((h) => ({ host: h.host, path: h.path, ...(h.line ? { line: h.line } : {}) })) },
      dependencies: { added: s.deps.added.map(withCatalog), dropped: s.deps.dropped.map(withCatalog) },
      clients: s.imports.added.map(withCatalog).filter((c): c is NamedSignal & { catalog: CatalogRef } => "catalog" in c && !!c.catalog),
      env: { added: s.env.added },
      deployments: { added: s.deployments.added, removed: s.deployments.removed },
      newDirectories: newDirs,
      unread: s.unread,
    };
  }

  // Draft resolution.
  const intents: AnyRecord[] = [];
  const notes: string[] = [];
  const refs = new Set<string>();
  const refFor = (want: string) => {
    let r = slug(want); let i = 2;
    while (refs.has(r)) r = `${slug(want).slice(0, 36)}-${i++}`;
    refs.add(r);
    return r;
  };
  const dirRef = new Map<string, string>();
  const dirLabel = new Map<string, string>();
  const catalogIds = new Set(inp.catalog.map((c) => c.id));
  if (signals.available) {
    for (const d of signals.newDirectories) {
      const ref = refFor(baseOf(d.dir));
      dirRef.set(d.dir, ref);
      const label = titleOf(d.dir);
      dirLabel.set(d.dir, label);
      const routes = signals.routes.added.filter((r) => r.path.startsWith(d.dir + "/"));
      const docker = signals.deployments.added.filter((x) => x.kind === "dockerfile" && x.path.startsWith(d.dir + "/"));
      const framework = inp.signals.available
        ? inp.signals.routes.added.find((r) => r.path.startsWith(d.dir + "/"))?.framework
        : undefined;
      const fromManifest = d.manifests.map((p) => MANIFEST_TECH[baseOf(p)]).find((t) => t && catalogIds.has(t));
      const technology = framework && catalogIds.has(framework) ? framework : fromManifest;
      intents.push({
        kind: "add_node", ref, label, type: "backend-service", ...(technology ? { technology } : {}),
        evidence: [
          ...d.manifests.map((p) => ({ path: p, line: 1, note: `new directory ${d.dir}/ with its own ${baseOf(p)}` })),
          ...docker.filter((x) => !d.manifests.includes(x.path)).map((x) => ({ path: x.path, line: 1, note: x.detail ?? "Dockerfile" })),
          ...routes.slice(0, 3).map((r) => ({ path: r.path, ...(r.line ? { line: r.line } : {}), note: `route ${r.method} ${r.route}` })),
        ],
      });
    }
    let binds = 0;
    for (const d of signals.newDirectories) {
      for (const p of d.files) {
        if (binds >= MAX_FILE_BINDS) break;
        if (fileKind(p, null, testPaths)) continue;
        binds++;
        intents.push({ kind: "bind_file", path: p, nodeId: `@${dirRef.get(d.dir)}`, nodeLabel: dirLabel.get(d.dir), artifactKind: bindKind(p), evidence: [{ path: p, note: `added in ${d.dir}/` }] });
      }
    }
    if (binds >= MAX_FILE_BINDS) notes.push(`Only the first ${MAX_FILE_BINDS} files of the new directories are drafted as bindings.`);

    // Backing services a dependency or client names. The source is the file's
    // owner, the new directory it sits in, or the one node its directory's
    // bound files belong to (a manifest next to bound code speaks for it).
    const siblingsOwner = (path: string): { id: string; label: string } | null => {
      const ids = [...new Set(boundUnder(dirOf(path)).map((a) => String(a.nodeId)))];
      return dirOf(path) !== "" && ids.length === 1 ? { id: ids[0], label: labelOf(nodes[ids[0]], ids[0]) } : null;
    };
    const sourceFor = (path: string): { id: string; label: string } | null => {
      const owner = ownerOf.get(path);
      if (owner) return { id: owner, label: labelOf(nodes[owner], owner) };
      const d = signals.available ? signals.newDirectories.find((x) => path.startsWith(x.dir + "/")) : undefined;
      if (d) return { id: `@${dirRef.get(d.dir)}`, label: dirLabel.get(d.dir)! };
      const s = files.find((f) => f.path === path)?.suggestion;
      if (s) return { id: s.nodeId, label: s.label };
      return siblingsOwner(path);
    };
    type Backing = { entry: CatalogEntry; role: string; evidence: AnyRecord[]; sources: Map<string, { label: string; evidence: AnyRecord[] }> };
    const backing = new Map<string, Backing>();
    const mentions = [
      ...signals.dependencies.added.map((x) => ({ ...x, how: "dependency" })),
      ...signals.clients.map((x) => ({ ...x, how: "import" })),
    ];
    for (const m of mentions) {
      const entry = m.catalog ? inp.catalog.find((c) => c.id === m.catalog!.id) : undefined;
      if (!entry) continue;
      const role = entry.roles.find((r) => BACKING_ROLES.has(r));
      if (!role) continue;
      const ev = { path: m.path, ...(m.line ? { line: m.line } : {}), note: `${m.how} ${m.name} added (${entry.name})` };
      const b: Backing = backing.get(entry.id) ?? { entry, role, evidence: [], sources: new Map() };
      if (!b.evidence.some((e) => e.path === ev.path && e.note === ev.note)) b.evidence.push(ev);
      const src = sourceFor(m.path);
      if (src) {
        const s: { label: string; evidence: AnyRecord[] } = b.sources.get(src.id) ?? { label: src.label, evidence: [] };
        if (!s.evidence.some((e) => e.path === ev.path && e.note === ev.note)) s.evidence.push(ev);
        b.sources.set(src.id, s);
      } else {
        notes.push(`${m.path} adds ${m.name} (${entry.name}) but no node owns the file; bind it first, then connect its node.`);
      }
      backing.set(entry.id, b);
    }
    for (const b of backing.values()) {
      const existing = Object.values(nodes).find((n) => String(n?.technology ?? "").toLowerCase() === b.entry.id.toLowerCase());
      let target: string;
      if (existing) {
        target = String(existing.id);
      } else {
        const ref = refFor(b.entry.id);
        target = `@${ref}`;
        intents.push({ kind: "add_node", ref, label: b.entry.name, type: b.role, technology: b.entry.id, evidence: b.evidence });
      }
      for (const [source, s] of b.sources) {
        if (existing && edges.some((e) => e.source === source && e.target === target)) continue;
        intents.push({
          kind: "connect_nodes", source, target,
          sourceLabel: s.label, targetLabel: existing ? labelOf(existing, target) : b.entry.name,
          contract: { kind: contractKindFor(b.entry, b.role), name: `${s.label} to ${b.entry.name}` },
          evidence: s.evidence,
        });
      }
    }
    for (const r of signals.routes.removed) {
      notes.push(`Route ${r.method} ${r.route} was removed from ${r.path}${r.nodeId ? ` (${labelOf(nodes[r.nodeId], r.nodeId)})` : ""}: check the contracts that served it.`);
    }
    for (const r of signals.routes.added) {
      if (!r.nodeId) continue;
      notes.push(`Route ${r.method} ${r.route} was declared in ${r.path}${r.line ? `:${r.line}` : ""} (${labelOf(nodes[r.nodeId], r.nodeId)}): check its contracts carry it.`);
    }
    for (const h of signals.hosts.added) {
      notes.push(`${h.path}${h.line ? `:${h.line}` : ""} now calls ${h.host}.`);
    }
  }

  // Unbound files next to one node's bound files.
  const inNewDir = (p: string) => signals.available && signals.newDirectories.some((d) => p.startsWith(d.dir + "/"));
  for (const f of files) {
    if (f.owner || !f.suggestion || f.action === "removed" || f.kind || ignored.has(f.path) || inNewDir(f.path)) continue;
    intents.push({ kind: "bind_file", path: f.path, nodeId: f.suggestion.nodeId, nodeLabel: f.suggestion.label, artifactKind: bindKind(f.path), evidence: [{ path: f.path, note: f.suggestion.reason }] });
  }
  for (const n of packetNodes) {
    if (n.lastFileRemoved) notes.push(`${n.label} has no bound file left after this change: remove the node, or bind its new files.`);
  }
  const moved = files.filter((f) => f.action === "renamed" && f.owner?.via === "binding");
  if (moved.length > 0) notes.push(`${moved.length} bound file(s) moved; their bindings follow the new path when the change is accepted.`);

  // Classification.
  const classification: Classification[] = [];
  const conflicts: ReconcilePacket["conflicts"] = [];
  const unbound = files.filter((f) => !f.owner && f.action !== "removed" && !f.path.startsWith(".nodespec/") && f.path !== "ARCHITECTURE.md" && !ignored.has(f.path));
  if (meta.modelChanged === true || files.some((f) => f.kind === "model-anchor")) classification.push("model-edited");
  if (meta.specChanged === true || files.some((f) => f.kind === "spec-anchor")) classification.push("spec");
  const structural = packetNodes.some((n) => n.lastFileRemoved) || (signals.available && (
    signals.routes.added.length + signals.routes.removed.length + signals.hosts.added.length + signals.newDirectories.length > 0 ||
    [...signals.dependencies.added, ...signals.dependencies.dropped, ...signals.clients].some((d) => d.catalog && inp.catalog.some((c) => c.id === d.catalog!.id && c.roles.some((r) => BACKING_ROLES.has(r))))
  ));
  if (structural) classification.push("structural");
  if (unbound.length > 0) classification.push("needs-binding");
  for (const n of packetNodes) {
    const locked = n.requirements.filter((r) => r.locked);
    if (locked.length > 0) conflicts.push({ nodeId: n.nodeId, label: n.label, reason: `maps locked ${locked.map((r) => r.id).join(", ")}` });
    const others = n.holds.filter((h) => !h.mine);
    if (others.length > 0) conflicts.push({ nodeId: n.nodeId, label: n.label, reason: `held by ${[...new Set(others.map((h) => h.holder))].join(", ")}` });
  }
  if (conflicts.length > 0) classification.push("conflicts");
  if (classification.length === 0) classification.push("content-only");

  return {
    changeEventId: inp.card.id,
    commitSha: inp.card.commitSha,
    baseSha: typeof meta.baseSha === "string" ? meta.baseSha : null,
    branchName: inp.branchName,
    status: inp.card.status,
    files,
    nodes: packetNodes,
    signals,
    classification,
    conflicts,
    draft: { intents, notes },
  };
}

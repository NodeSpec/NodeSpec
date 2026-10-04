// AA.3 (owner 2026-09-23): explode a node one level, and collapse it back.
//
// The agent decides the parts from its reading of the node's code: each part
// has a label, a role, the files it owns and why it is a part. The server
// checks the proposal (every file assigned once or left on the node, roles
// the depth rule allows, no part without files when the node has files) and
// compiles it into one proposal the person accepts or rejects:
//
//   - the node keeps its id, role and technology and gains the parts as
//     children (parentId);
//   - files move to the part that owns them (update_artifact), and the repo
//     index follows them on accept (repoIndexMoves, applied by the
//     explode_rebind_on_proposal_accept trigger);
//   - internal edges come from the repo index's file imports that cross
//     parts, one edge and one contract per pair of parts;
//   - outside edges stay on the node, unless a part takes one: the end on
//     the node moves to the part, keeping the edge and contract ids (the
//     patch engine drops the old port, AA.0);
//   - requirement mappings stay on the node; one proven only by files in a
//     single part is named as a suggestion to move.
//
// collapse_node is the exact inverse. The node's lease is checked by the
// caller (proposals.ts), which also loads this context. Pure: ids come from
// the caller, so tests can fix them.

export interface ExplodeNode { id: string; type: string; label: string; parentId?: string | null; technology?: string | null }
export interface ExplodeEdge { id: string; source: string; target: string; contractId?: string; metadata?: Record<string, unknown> }

/** AA.3b: what a database group lists (a table, a collection, a key pattern). */
export interface GroupEntry { name: string; columns?: number; keys?: string[]; kind?: string; file?: string; note?: string }
export const ACCESS_VALUES = ['read', 'write', 'both'] as const;
export const REFERENCE_VALUES = ['foreign_key', 'code'] as const;
export interface ExplodeArtifact { id: string; nodeId: string; path: string; kind?: string | null }

export interface ExplodeContext {
  nodes: Record<string, ExplodeNode>;
  edges: Record<string, ExplodeEdge>;
  artifacts: Record<string, ExplodeArtifact>;
  /** The part roles a role lists in can_contain (the depth rule). Null: the catalog did not load. */
  partsOf: (roleId: string) => string[] | null;
  isPart: (roleId: string) => boolean;
  /** AA.3b: a part that groups a data store's contents (a table group). */
  isDataPart?: (roleId: string) => boolean;
  /** AA.3b: the data model of a technology (its catalog row's ai_context.dataModel). */
  dataModelOf?: (technologyId: string | null | undefined) => string | null;
  /** Repo index rows bound to the nodes in play (the target and its parts). */
  indexed: Array<{ path: string; nodeId: string }>;
  /** File imports among those files (repo_index_edges). */
  imports: Array<{ from: string; to: string }>;
  /** Requirements mapped to the nodes in play, with the files that prove them. */
  proofs: Array<{ requirement: string; nodeId: string; paths: string[] }>;
  /** Item 25: the repository files, anywhere in the project, that a group's
   *  tables name as where they are defined (the ones the repo index knows). */
  knownPaths?: ReadonlySet<string>;
}

export interface RepoIndexMove { path: string; from: string; to: string }

export interface ExplodeCompiled {
  summary: string;
  ids: Record<string, string | string[]>;
  patches: Array<{ type: string; payload: Record<string, unknown> }>;
  explanations: string[];
  repoIndexMoves: RepoIndexMove[];
  suggestions: string[];
}

/** NodeSpec's own documents on a node: they stay with the node, never a part. */
const OWN_DOCUMENT_KINDS = new Set(['task', 'test-plan']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rec = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
const q = (s: string) => `"${s}"`;

/** Item 25: the files an explode's tables name as where they are defined. */
export function citedTableFiles(intent: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const part of Array.isArray(intent.parts) ? intent.parts : []) {
    for (const t of Array.isArray(rec(part)?.tables) ? rec(part)!.tables as unknown[] : []) {
      const file = str(rec(t)?.file);
      if (file) out.add(file);
    }
  }
  return [...out];
}

/** The files a node owns: its artifacts (not NodeSpec's own documents) and its repo index rows. */
export function filesOfNode(ctx: ExplodeContext, nodeId: string): { paths: Set<string>; artifactsByPath: Map<string, string[]>; indexed: Set<string> } {
  const artifactsByPath = new Map<string, string[]>();
  for (const a of Object.values(ctx.artifacts)) {
    if (a.nodeId !== nodeId || !a.path || OWN_DOCUMENT_KINDS.has(String(a.kind ?? ''))) continue;
    artifactsByPath.set(a.path, [...(artifactsByPath.get(a.path) ?? []), a.id]);
  }
  const indexed = new Set(ctx.indexed.filter((r) => r.nodeId === nodeId).map((r) => r.path));
  return { paths: new Set([...artifactsByPath.keys(), ...indexed]), artifactsByPath, indexed };
}

export function partsOfNode(ctx: ExplodeContext, nodeId: string): ExplodeNode[] {
  return Object.values(ctx.nodes).filter((n) => n.parentId === nodeId && ctx.isPart(n.type));
}

/** A requirement proven only by files in one part: the part it could move to. */
function provenInOnePart(paths: string[], partOfPath: Map<string, string>): string | null {
  if (paths.length === 0) return null;
  const owners = new Set(paths.map((p) => partOfPath.get(p) ?? ''));
  if (owners.size !== 1) return null;
  const only = [...owners][0];
  return only || null;
}

export function compileExplode(
  it: Record<string, unknown>,
  ctx: ExplodeContext | undefined,
  newId: () => string,
  alias?: 'split_node',
): ExplodeCompiled | { error: string } {
  if (!ctx) return { error: 'the graph could not be read, so nothing can be exploded; retry' };
  const nodeId = str(it.nodeId);
  if (!nodeId || !UUID_RE.test(nodeId)) return { error: 'nodeId must be the uuid of the node to explode' };
  const node = ctx.nodes[nodeId];
  if (!node) return { error: `no node ${nodeId} on this branch (get_architecture_overview lists the nodes)` };
  if (ctx.isPart(node.type)) return { error: `${q(node.label)} is itself a part, and a part holds nothing, so it cannot be exploded` };
  const allowed = ctx.partsOf(node.type);
  if (allowed === null) return { error: 'the catalog could not be read, so the parts cannot be checked; retry' };
  if (allowed.length === 0) {
    return { error: `${q(node.label)} is a ${node.type}, and that role lists no parts, so it cannot be exploded (the depth rule; lookup_catalog shows each role's parts)` };
  }
  const existing = partsOfNode(ctx, nodeId);
  if (existing.length > 0) {
    return { error: `${q(node.label)} already has ${existing.length} part${existing.length === 1 ? '' : 's'}. Collapse it first (collapse_node), or add one more with add_node and its parentId` };
  }

  const rawParts = Array.isArray(it.parts) ? it.parts : alias === 'split_node' && Array.isArray(it.into) ? it.into : null;
  if (!rawParts || rawParts.length === 0) {
    return { error: 'parts must list at least one part { label, role, files, why, takes? }' };
  }
  const own = filesOfNode(ctx, nodeId);
  const partOfPath = new Map<string, string>();
  const labels = new Set<string>();
  const takenEdges = new Map<string, string>();
  type Part = {
    id: string; label: string; role: string; why: string; technology: string | null; files: string[];
    takes: Array<{ edgeId: string; side: 'source' | 'target'; access: string | null }>;
    tables: GroupEntry[]; references: Array<{ part: string; via: string; note: string | null }>;
  };
  const isData = (role: string) => ctx.isDataPart?.(role) ?? false;
  const parts: Part[] = [];

  for (let p = 0; p < rawParts.length; p++) {
    const r = rec(rawParts[p]);
    const label = r ? str(r.label) : null;
    if (!r || !label) return { error: `parts[${p}].label is required` };
    if (labels.has(label.toLowerCase())) return { error: `two parts are labelled ${q(label)}; each part needs its own name` };
    labels.add(label.toLowerCase());
    const role = str(r.role) ?? (alias === 'split_node' ? str(r.type) : null);
    if (!role) return { error: `parts[${p}] (${q(label)}).role is required: one of ${allowed.join(', ')}` };
    if (!allowed.includes(role)) {
      return { error: `parts[${p}] (${q(label)}) has role ${role}, which a ${node.type} does not list. Its parts are ${allowed.join(', ')} (the depth rule)` };
    }
    const why = str(r.why);
    if (!why) return { error: `parts[${p}] (${q(label)}).why is required: say why this is a part of ${q(node.label)} (the logic it holds)` };
    const files: string[] = [];
    const rawFiles = r.files === undefined ? [] : Array.isArray(r.files) ? r.files : null;
    if (rawFiles === null) return { error: `parts[${p}] (${q(label)}).files must be an array of file paths` };
    for (const f of rawFiles) {
      const path = str(f);
      if (!path) return { error: `parts[${p}] (${q(label)}).files holds an empty path` };
      if (!own.paths.has(path)) {
        return { error: `${q(path)} is not one of ${q(node.label)}'s files (the node context, or search_repo_index, lists them)` };
      }
      const other = partOfPath.get(path);
      if (other) return { error: `${q(path)} is named by parts ${q(parts.find((x) => x.id === other)?.label ?? other)} and ${q(label)}; a file belongs to one part (or stays on the node)` };
      files.push(path);
    }
    const id = newId();
    for (const path of files) partOfPath.set(path, id);
    const takes: Part['takes'] = [];
    const rawTakes = Array.isArray(r.takes) ? r.takes : [];
    for (let t = 0; t < rawTakes.length; t++) {
      const take = rawTakes[t];
      const edgeId = typeof take === 'string' ? str(take) : str(rec(take)?.edgeId);
      const edge = edgeId ? ctx.edges[edgeId] : undefined;
      if (!edgeId || !edge) return { error: `parts[${p}] (${q(label)}).takes[${t}] names no edge on this branch` };
      const onSource = edge.source === nodeId; const onTarget = edge.target === nodeId;
      if (onSource === onTarget) return { error: `edge ${edgeId} does not have exactly one end on ${q(node.label)}, so no part can take it` };
      const side: 'source' | 'target' = onSource ? 'source' : 'target';
      const asked = str(rec(take)?.side);
      if (asked && asked !== side) return { error: `edge ${edgeId} has its ${side} on ${q(node.label)}, not its ${asked}` };
      const prior = takenEdges.get(edgeId);
      if (prior) return { error: `edge ${edgeId} is taken by parts ${q(prior)} and ${q(label)}; one part takes an edge` };
      const access = str(rec(take)?.access);
      if (access && !(ACCESS_VALUES as readonly string[]).includes(access)) {
        return { error: `parts[${p}] (${q(label)}).takes[${t}].access must be read, write or both` };
      }
      takenEdges.set(edgeId, label);
      takes.push({ edgeId, side, access });
    }
    // AA.3b: a database group lists what it holds, and names the groups it references.
    const tables: GroupEntry[] = [];
    const rawTables = r.tables === undefined ? [] : Array.isArray(r.tables) ? r.tables : null;
    if (rawTables === null) return { error: `parts[${p}] (${q(label)}).tables must be an array of { name, columns?, keys?, kind?, file?, note? }` };
    if (rawTables.length > 0 && !isData(role)) return { error: `parts[${p}] (${q(label)}) is a ${role}; only a group of a data store lists tables` };
    for (let k = 0; k < rawTables.length; k++) {
      const e = rec(rawTables[k]);
      const name = e ? str(e.name) : null;
      if (!e || !name) return { error: `parts[${p}] (${q(label)}).tables[${k}].name is required` };
      const entry: GroupEntry = { name };
      if (e.columns !== undefined) {
        if (typeof e.columns !== 'number' || !Number.isInteger(e.columns) || e.columns < 0) return { error: `parts[${p}] (${q(label)}).tables[${k}].columns must be a whole number` };
        entry.columns = e.columns;
      }
      if (e.keys !== undefined) {
        if (!Array.isArray(e.keys) || e.keys.some((x) => !str(x))) return { error: `parts[${p}] (${q(label)}).tables[${k}].keys must be a list of field names` };
        entry.keys = e.keys.map((x) => String(x).trim());
      }
      const kind = str(e.kind); if (kind) entry.kind = kind;
      const note = str(e.note); if (note) entry.note = note;
      // Item 25: the file that defines a table, wherever it lives: this part's,
      // one left on the node (one schema file for every group), or a service's
      // own migrations when the schema sits with the code that owns it.
      const file = str(e.file);
      if (file) {
        const known = own.paths.has(file) || !!ctx.knownPaths?.has(file) || Object.values(ctx.artifacts).some((a) => a.path === file && !OWN_DOCUMENT_KINDS.has(String(a.kind ?? '')));
        if (!known) return { error: `parts[${p}] (${q(label)}).tables[${k}].file ${q(file)} is no file of this project; name the file that defines the table (search_repo_index finds it), or leave file out` };
        entry.file = file;
      }
      tables.push(entry);
    }
    // A part is never empty: it owns a file, or (item 25) a group lists what it
    // holds, since one schema file often defines every group's tables.
    if (own.paths.size > 0 && files.length === 0 && tables.length === 0) {
      return {
        error: isData(role)
          ? `group ${q(label)} owns none of ${q(node.label)}'s files and lists no tables; a group owns a file or lists its tables (files no part names stay on the node)`
          : `part ${q(label)} owns none of ${q(node.label)}'s files; every part owns at least one (files no part names stay on the node)`,
      };
    }
    const references: Part['references'] = [];
    const rawRefs = Array.isArray(r.references) ? r.references : [];
    if (rawRefs.length > 0 && !isData(role)) return { error: `parts[${p}] (${q(label)}) is a ${role}; only a group of a data store names references` };
    for (let k = 0; k < rawRefs.length; k++) {
      const ref = rec(rawRefs[k]);
      const to = ref ? str(ref.part) : null;
      const via = ref ? str(ref.via) : null;
      if (!ref || !to) return { error: `parts[${p}] (${q(label)}).references[${k}].part is required: the label of another group` };
      if (!via || !(REFERENCE_VALUES as readonly string[]).includes(via)) return { error: `parts[${p}] (${q(label)}).references[${k}].via must be foreign_key or code` };
      references.push({ part: to, via, note: str(ref.note) });
    }
    parts.push({ id, label, role, why, technology: str(r.technology), files, takes, tables, references });
  }

  const patches: ExplodeCompiled['patches'] = [];
  const explanations: string[] = [];
  const repoIndexMoves: RepoIndexMove[] = [];
  for (const part of parts) {
    const payload: Record<string, unknown> = {
      id: part.id, type: part.role, label: part.label, parentId: nodeId,
      metadata: { description: part.why, ...(part.tables.length > 0 ? { tables: part.tables } : {}) },
    };
    if (part.technology) payload.technology = part.technology;
    patches.push({ type: 'add_node', payload });
    explanations.push(`Explode ${q(node.label)}: add the part ${q(part.label)} (${part.role}): ${part.why}`);
    for (const path of part.files) {
      for (const artifactId of own.artifactsByPath.get(path) ?? []) {
        patches.push({ type: 'update_artifact', payload: { id: artifactId, changes: { nodeId: part.id } } });
        explanations.push(`Move ${path} to ${q(part.label)}`);
      }
      if (own.indexed.has(path)) repoIndexMoves.push({ path, from: nodeId, to: part.id });
    }
    for (const take of part.takes) {
      // AA.3b: a service edge that lands on a group says whether it reads, writes or both.
      const changes: Record<string, unknown> = { [take.side]: part.id };
      if (take.access) changes.metadata = { ...(ctx.edges[take.edgeId]?.metadata ?? {}), access: take.access };
      patches.push({ type: 'update_edge', payload: { id: take.edgeId, changes } });
      explanations.push(`Move the ${take.side} of edge ${take.edgeId} from ${q(node.label)} to ${q(part.label)}${take.access ? ` (${take.access === 'both' ? 'read and write' : take.access})` : ''}; the edge and its contract keep their ids`);
    }
  }

  // Internal edges: the file imports that cross parts, one edge and contract per pair.
  const byPair = new Map<string, Array<{ from: string; to: string }>>();
  const dataIds = new Set(parts.filter((p) => isData(p.role)).map((p) => p.id));
  for (const imp of ctx.imports) {
    const a = partOfPath.get(imp.from); const b = partOfPath.get(imp.to);
    if (!a || !b || a === b) continue;
    // Between two groups of a data store, the references the agent names are the edges.
    if (dataIds.has(a) && dataIds.has(b)) continue;
    const key = `${a}>${b}`;
    byPair.set(key, [...(byPair.get(key) ?? []), imp]);
  }
  const order = new Map(parts.map((p, i) => [p.id, i]));
  const pairKeys = [...byPair.keys()].sort((x, y) => {
    const [xa, xb] = x.split('>'); const [ya, yb] = y.split('>');
    return (order.get(xa)! - order.get(ya)!) || (order.get(xb)! - order.get(yb)!);
  });
  const edgeIds: string[] = []; const contractIds: string[] = [];
  const labelOf = new Map(parts.map((p) => [p.id, p.label]));
  for (const key of pairKeys) {
    const [a, b] = key.split('>');
    const evidence = byPair.get(key)!;
    const contractId = newId(); const edgeId = newId();
    contractIds.push(contractId); edgeIds.push(edgeId);
    patches.push({ type: 'add_contract', payload: { id: contractId, kind: 'dependency', name: `${labelOf.get(a)} uses ${labelOf.get(b)}` } });
    explanations.push(`${q(labelOf.get(a)!)} imports ${q(labelOf.get(b)!)} (${evidence.length} import${evidence.length === 1 ? '' : 's'})`);
    patches.push({
      type: 'add_edge',
      payload: {
        id: edgeId, source: a, target: b, contractId, label: 'imports',
        metadata: { evidence: evidence.slice(0, 5).map((e) => `${e.from} -> ${e.to}`), imports: evidence.length },
      },
    });
    explanations.push(`Connect ${q(labelOf.get(a)!)} to ${q(labelOf.get(b)!)}: ${evidence.slice(0, 2).map((e) => `${e.from} imports ${e.to}`).join('; ')}`);
  }

  // AA.3b: a reference between two groups: a foreign key (solid) or one kept in code (dashed).
  const byLabel = new Map(parts.map((p) => [p.label.toLowerCase(), p]));
  const model = ctx.dataModelOf?.(node.technology ?? null) ?? null;
  for (const part of parts) {
    for (const ref of part.references) {
      const to = byLabel.get(ref.part.toLowerCase());
      if (!to || !isData(to.role) || to.id === part.id) {
        return { error: `${q(part.label)} references ${q(ref.part)}, which is not another group in this explode` };
      }
      const contractId = newId(); const edgeId = newId();
      contractIds.push(contractId); edgeIds.push(edgeId);
      const label = ref.via === 'foreign_key' ? 'foreign key' : 'reference kept in code';
      patches.push({ type: 'add_contract', payload: { id: contractId, kind: model === 'relational' ? 'sql' : 'nosql', name: `${part.label} references ${to.label}` } });
      explanations.push(`${q(part.label)} references ${q(to.label)} (${label})`);
      patches.push({
        type: 'add_edge',
        payload: { id: edgeId, source: part.id, target: to.id, contractId, label, metadata: { reference: ref.via, ...(ref.note ? { note: ref.note } : {}) } },
      });
      explanations.push(`Connect ${q(part.label)} to ${q(to.label)}: ${ref.note ?? label}`);
    }
  }

  const suggestions: string[] = [];
  for (const proof of ctx.proofs) {
    if (proof.nodeId !== nodeId) continue;
    const part = provenInOnePart(proof.paths, partOfPath);
    if (!part) continue;
    suggestions.push(`${proof.requirement} is proven only by files in ${q(labelOf.get(part)!)}. Its mapping stays on ${q(node.label)}; once this is accepted, map it to the part (map_requirement) if it belongs there.`);
  }

  const left = [...own.paths].filter((p) => !partOfPath.has(p)).length;
  return {
    summary: `explode ${q(node.label)} into ${parts.map((p) => q(p.label)).join(', ')}`,
    ids: { nodeId, partIds: parts.map((p) => p.id), edgeIds, contractIds },
    patches, explanations, repoIndexMoves,
    suggestions: [
      ...(left > 0 ? [`${left} of ${q(node.label)}'s ${own.paths.size} files stay on the node itself.`] : []),
      ...suggestions,
    ],
  };
}

export function compileCollapse(
  it: Record<string, unknown>,
  ctx: ExplodeContext | undefined,
): ExplodeCompiled | { error: string } {
  if (!ctx) return { error: 'the graph could not be read, so nothing can be collapsed; retry' };
  const nodeId = str(it.nodeId);
  if (!nodeId || !UUID_RE.test(nodeId)) return { error: 'nodeId must be the uuid of the exploded node' };
  const node = ctx.nodes[nodeId];
  if (!node) return { error: `no node ${nodeId} on this branch (get_architecture_overview lists the nodes)` };
  const parts = partsOfNode(ctx, nodeId);
  if (parts.length === 0) return { error: `${q(node.label)} has no parts, so there is nothing to collapse` };
  const partIds = new Set(parts.map((p) => p.id));
  const labelOf = new Map(parts.map((p) => [p.id, p.label]));
  const inside = (id: string) => id === nodeId || partIds.has(id);

  const patches: ExplodeCompiled['patches'] = [];
  const explanations: string[] = [];
  const repoIndexMoves: RepoIndexMove[] = [];
  for (const part of parts) {
    const files = filesOfNode(ctx, part.id);
    for (const [path, ids] of files.artifactsByPath) {
      for (const id of ids) {
        patches.push({ type: 'update_artifact', payload: { id, changes: { nodeId } } });
        explanations.push(`Move ${path} back from ${q(part.label)} to ${q(node.label)}`);
      }
    }
    for (const path of files.indexed) repoIndexMoves.push({ path, from: part.id, to: nodeId });
  }
  for (const edge of Object.values(ctx.edges)) {
    const s = partIds.has(edge.source); const t = partIds.has(edge.target);
    if (!s && !t) continue;
    if (inside(edge.source) && inside(edge.target)) {
      patches.push({ type: 'remove_edge', payload: { id: edge.id } });
      explanations.push(`Remove the edge inside ${q(node.label)} between ${q(labelOf.get(edge.source) ?? node.label)} and ${q(labelOf.get(edge.target) ?? node.label)}`);
      continue;
    }
    const side = s ? 'source' : 'target';
    patches.push({ type: 'update_edge', payload: { id: edge.id, changes: { [side]: nodeId } } });
    explanations.push(`Move the ${side} of edge ${edge.id} from ${q(labelOf.get(s ? edge.source : edge.target)!)} back to ${q(node.label)}`);
  }
  for (const part of parts) {
    patches.push({ type: 'remove_node', payload: { id: part.id } });
    explanations.push(`Remove the part ${q(part.label)}`);
  }
  const suggestions = ctx.proofs
    .filter((p) => partIds.has(p.nodeId))
    .map((p) => `${p.requirement} is mapped to the part ${q(labelOf.get(p.nodeId)!)}. Once this is accepted, map it to ${q(node.label)} (map_requirement); a mapping to a removed part no longer counts.`);
  return {
    summary: `collapse ${q(node.label)}, folding back ${parts.map((p) => q(p.label)).join(', ')}`,
    ids: { nodeId, partIds: [...partIds] },
    patches, explanations, repoIndexMoves, suggestions,
  };
}

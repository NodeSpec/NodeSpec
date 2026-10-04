// V3 AD.2b (owner 2026-09-24, findings D3 and D4): a load is a diff.
//
// Loading git's model used to replace the branch's snapshot with a graph built
// from the anchor alone (`anchorToGraph`): schemas, configuration, positions,
// port details, locks, file content and every contract no edge used were
// dropped, and it ran unasked on a page load and when a merge arrived, under
// an open editor.
//
// Now git's anchor is compared with the canvas and turned into ordinary
// patches, which a person accepts as a proposal like any other change. A patch
// names only what git changed: positions, file content, node metadata the
// anchor does not carry, port details, groups and contracts no edge uses stay
// as they are. A value git withheld as a credential keeps the canvas's value.
// A change no patch can express (git moved a node out of its container, or
// cleared a field the patch format cannot clear) is listed, never guessed.
import {
  parseModel, serializeModel, nodeDetailMetadata,
  type ModelAnchor, type AnchorNode, type AnchorEdge, type AnchorArtifact,
} from "./model-anchor.ts";
import { keepWithheldFromCanvas, withholdCredentials } from "./credential-withhold.ts";

/** Equals the sentinel in mcp-server/tools/proposals.ts and
 *  src/ui/utils/proposal-git-content.ts (a test pins all three). The accept
 *  path fetches the file at `contentSource.ref` in its place. */
export const GIT_CONTENT_SENTINEL = "__nodespec_git_content__";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;
// deno-lint-ignore no-explicit-any
export type LoadPatch = { type: string; metadata: Record<string, any>; payload: Record<string, any> };

export interface LoadPlan {
  patches: LoadPatch[];
  /** One sentence per patch, for the proposal. */
  explanations: string[];
  /** What git changed that no patch can express; the canvas keeps its value. */
  notApplied: string[];
  counts: { added: number; changed: number; removed: number };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The patches that make `canvas` hold the design `repo` describes. Pure; the
 * order is one the patch engine accepts: contracts, nodes (parents first),
 * edges and files added or changed, then files, edges and nodes removed
 * (children first), so no removal takes a contract or a port a new edge needs.
 */
export async function anchorLoadPatches(
  canvas: AnyRecord,
  repo: ModelAnchor,
  opts: { actorId: string; sourceCommit: string; nowIso: string },
): Promise<LoadPlan> {
  const details = repo.modelVersion >= 2;
  const parsed = parseModel(await serializeModel(canvas));
  const ours = parsed.ok ? parsed.model : null;
  const oursNode = new Map((ours?.nodes ?? []).map((n) => [n.id, n]));
  const cNodes = (canvas.nodes ?? {}) as Record<string, AnyRecord>;
  const cEdges = (canvas.edges ?? {}) as Record<string, AnyRecord>;
  const cContracts = (canvas.contracts ?? {}) as Record<string, AnyRecord>;
  const cArtifacts = (canvas.artifacts ?? {}) as Record<string, AnyRecord>;

  const plan: LoadPlan = { patches: [], explanations: [], notApplied: [], counts: { added: 0, changed: 0, removed: 0 } };
  const push = (type: string, payload: AnyRecord, explanation: string, count: keyof LoadPlan["counts"]) => {
    plan.patches.push({
      type,
      metadata: { id: crypto.randomUUID(), timestamp: opts.nowIso, actorType: "system", actorId: opts.actorId, summary: explanation },
      payload,
    });
    plan.explanations.push(explanation);
    plan.counts[count]++;
  };
  const cannot = (what: string) => plan.notApplied.push(what);

  // ── contracts ──────────────────────────────────────────────────────────
  for (const c of repo.contracts) {
    const cur = cContracts[c.id];
    if (!cur) {
      push("add_contract", {
        id: c.id, kind: c.kind, name: c.name,
        ...(c.interactionKind ? { interactionKind: c.interactionKind } : {}),
        ...(c.transport ? { transport: c.transport } : {}),
        ...(c.specFormat ? { specFormat: c.specFormat } : {}),
        ...(c.schema !== undefined ? { schema: keepWithheldFromCanvas(c.schema, undefined) } : {}),
        status: "draft",
      }, `Git's model adds contract ${c.name}`, "added");
      continue;
    }
    const name = cur.name || c.name;
    const changes: AnyRecord = {};
    if (cur.kind !== c.kind) changes.kind = c.kind;
    if (cur.name !== c.name) changes.name = c.name;
    for (const f of ["interactionKind", "transport", "specFormat"] as const) {
      if (c[f]) {
        if (cur[f] !== c[f]) changes[f] = c[f];
      } else if (cur[f]) {
        cannot(`Contract ${name}: git cleared its ${f}; the canvas keeps ${cur[f]}.`);
      }
    }
    const curSchema = cur.schema !== undefined && cur.schema !== null ? withholdCredentials(cur.schema).value : undefined;
    if (details) {
      if (c.schema !== undefined) {
        if (!same(curSchema, c.schema)) changes.schema = keepWithheldFromCanvas(c.schema, cur.schema);
      } else if (curSchema !== undefined && Object.keys(curSchema as AnyRecord).length > 0) {
        cannot(`Contract ${name}: git has no schema for it; the canvas keeps its schema.`);
      }
    } else if (c.schemaHash && curSchema !== undefined) {
      // A version 1 model names the schema by hash only.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(curSchema)));
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      if (hash !== c.schemaHash) cannot(`Contract ${name}: its schema changed in git, and this model.json (version 1) does not carry schemas.`);
    }
    if (Object.keys(changes).length > 0) {
      push("update_contract", { id: c.id, changes }, `Git's model changes contract ${name}`, "changed");
    }
  }

  // ── nodes: added parents first ─────────────────────────────────────────
  const repoNodes = new Map(repo.nodes.map((n) => [n.id, n]));
  const depth = (n: AnchorNode): number => {
    let d = 0;
    let p = n.parentId;
    const seen = new Set<string>([n.id]);
    while (p && repoNodes.has(p) && !seen.has(p)) {
      seen.add(p);
      d++;
      p = repoNodes.get(p)!.parentId;
    }
    return d;
  };
  const added = repo.nodes.filter((n) => !cNodes[n.id]).sort((a, b) => depth(a) - depth(b) || a.id.localeCompare(b.id));
  for (const n of added) {
    const meta = details ? nodeDetailMetadata(n, undefined) : {};
    push("add_node", {
      id: n.id, type: n.type, label: n.label,
      ...(n.technology ? { technology: n.technology } : {}),
      ...(n.parentId ? { parentId: n.parentId } : {}),
      ...(n.placementKind ? { placementKind: n.placementKind } : {}),
      // AG.13 (owner 2026-09-28): ports came out of the model; a load writes none.
      status: "draft",
      ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
    }, `Git's model adds node ${n.label}`, "added");
  }

  for (const n of repo.nodes) {
    const cur = cNodes[n.id];
    if (!cur) continue;
    const name = cur.label || n.label;
    const changes: AnyRecord = {};
    if (cur.type !== n.type) changes.type = n.type;
    if (cur.label !== n.label) changes.label = n.label;
    if (n.technology) {
      if (cur.technology !== n.technology) changes.technology = n.technology;
    } else if (cur.technology) {
      changes.technology = ""; // written as absent, exactly as git has it
    }
    if (n.parentId) {
      if (cur.parentId !== n.parentId) changes.parentId = n.parentId;
    } else if (cur.parentId) {
      cannot(`Node ${name}: git moved it out of its container; the canvas keeps it where it is.`);
    }
    if (n.placementKind) {
      if (cur.placementKind !== n.placementKind) changes.placementKind = n.placementKind;
    } else if (cur.placementKind) {
      cannot(`Node ${name}: git cleared its placement; the canvas keeps ${cur.placementKind}.`);
    }
    // AG.13: ports never make a node differ; git's ports (a version 2 file)
    // and the canvas's are left as they are.
    // Configuration (version 2): update_node merges metadata, so positions and
    // every other key stay; a withheld value keeps the canvas's.
    if (details && (oursNode.get(n.id)?.configHash ?? "") !== (n.configHash ?? "")) {
      const curMeta = (cur.metadata ?? {}) as AnyRecord;
      const meta: AnyRecord = {};
      if (n.config !== undefined) {
        meta.config = keepWithheldFromCanvas(n.config, curMeta.config);
      } else if (curMeta.config && typeof curMeta.config === "object" && Object.keys(curMeta.config).length > 0) {
        meta.config = {};
      }
      if (n.configSource !== undefined) {
        if (curMeta.configSource !== n.configSource) meta.configSource = n.configSource;
      } else if (curMeta.configSource === "ai" || curMeta.configSource === "manual") {
        cannot(`Node ${name}: git has no configuration choice recorded; the canvas keeps "${curMeta.configSource}".`);
      }
      if (Object.keys(meta).length > 0) changes.metadata = meta;
    }
    if (Object.keys(changes).length > 0) {
      // Named as the canvas names it, which is what the person recognises.
      push("update_node", { id: n.id, changes }, `Git's model changes node ${name}`, "changed");
    }
  }

  // ── edges ──────────────────────────────────────────────────────────────
  const edgeName = (e: AnchorEdge) =>
    e.label || `${repoNodes.get(e.source)?.label ?? cNodes[e.source]?.label ?? e.source.slice(0, 8)} to ${repoNodes.get(e.target)?.label ?? cNodes[e.target]?.label ?? e.target.slice(0, 8)}`;
  for (const e of repo.edges) {
    const cur = cEdges[e.id];
    if (!cur) {
      push("add_edge", {
        id: e.id, source: e.source, target: e.target, contractId: e.contractId,
        ...(e.label ? { label: e.label } : {}),
        ...(e.direction ? { direction: e.direction } : {}),
        ...(e.criticality ? { criticality: e.criticality } : {}),
      }, `Git's model adds the connection ${edgeName(e)}`, "added");
      continue;
    }
    const changes: AnyRecord = {};
    for (const f of ["source", "target", "contractId"] as const) if (cur[f] !== e[f]) changes[f] = e[f];
    // AG.13: an edge's port ids never make it differ.
    for (const f of ["direction", "criticality"] as const) {
      if (e[f]) {
        if (cur[f] !== e[f]) changes[f] = e[f];
      } else if (cur[f]) {
        cannot(`Connection ${edgeName(e)}: git cleared its ${f}; the canvas keeps it.`);
      }
    }
    if (e.label) {
      if (cur.label !== e.label) changes.label = e.label;
    } else if (cur.label) {
      changes.label = "";
    }
    if (Object.keys(changes).length > 0) {
      push("update_edge", { id: e.id, changes }, `Git's model changes the connection ${edgeName(e)}`, "changed");
    }
  }

  // ── files: bindings (content comes from git at accept) ─────────────────
  const normalized = (p: unknown) => String(p ?? "").replace(/^\//, "");
  for (const a of repo.artifacts) {
    const cur = cArtifacts[a.id];
    if (!cur) {
      push("add_artifact", {
        id: a.id, nodeId: a.nodeId, path: a.path, kind: a.kind,
        ...(a.contentHash ? { contentHash: a.contentHash } : {}),
        content: GIT_CONTENT_SENTINEL,
        createdAt: opts.nowIso, updatedAt: opts.nowIso,
        sourceProvenance: "anchor-restore",
        metadata: {
          provenance: { origin: "anchor-restore", commitSha: opts.sourceCommit, at: opts.nowIso },
          // Optional: a binding whose file was never committed lands without
          // content instead of failing the whole accept.
          contentSource: { type: "git", ref: opts.sourceCommit, optional: true },
        },
      }, `Git's model binds ${a.path}`, "added");
      continue;
    }
    const changes: AnyRecord = {};
    if (String(cur.nodeId ?? "") !== a.nodeId) changes.nodeId = a.nodeId;
    if (normalized(cur.path) !== a.path) changes.path = a.path;
    if (String(cur.kind ?? "") !== a.kind) changes.kind = a.kind;
    if (Object.keys(changes).length > 0) {
      push("update_artifact", { id: a.id, changes }, `Git's model changes the binding of ${a.path}`, "changed");
    }
  }

  // ── removals: files, then connections, then nodes (children first) ─────
  const removedNodes = new Set(Object.keys(cNodes).filter((id) => !repoNodes.has(id)));
  const repoArtifacts = new Set(repo.artifacts.map((a: AnchorArtifact) => a.id));
  for (const [id, a] of Object.entries(cArtifacts)) {
    if (!a?.path || repoArtifacts.has(id) || removedNodes.has(String(a.nodeId ?? ""))) continue;
    if (a.status === "complete") {
      cannot(`File ${normalized(a.path)}: git no longer binds it, but it is marked complete on the canvas, so it stays.`);
      continue;
    }
    push("remove_artifact", { id }, `Git's model no longer binds ${normalized(a.path)}`, "removed");
  }
  const repoEdges = new Set(repo.edges.map((e) => e.id));
  for (const [id, e] of Object.entries(cEdges)) {
    if (repoEdges.has(id) || removedNodes.has(String(e.source)) || removedNodes.has(String(e.target))) continue;
    const label = e.label || `${cNodes[e.source]?.label ?? "?"} to ${cNodes[e.target]?.label ?? "?"}`;
    push("remove_edge", { id }, `Git's model removes the connection ${label}`, "removed");
  }
  const canvasDepth = (id: string): number => {
    let d = 0;
    let p = cNodes[id]?.parentId;
    const seen = new Set<string>([id]);
    while (p && cNodes[p] && !seen.has(p)) {
      seen.add(p);
      d++;
      p = cNodes[p].parentId;
    }
    return d;
  };
  for (const id of [...removedNodes].sort((a, b) => canvasDepth(b) - canvasDepth(a) || a.localeCompare(b))) {
    push("remove_node", { id }, `Git's model removes node ${cNodes[id]?.label ?? id}`, "removed");
  }

  return plan;
}

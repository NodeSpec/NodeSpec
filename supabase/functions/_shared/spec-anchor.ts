// R7 · the spec plane's git anchor — `.nodespec/spec.json`.
//
// Owner 2026-07-31: "upon connecting to git, if a model.json is detected, our tool
// renders the nodes correctly… however, requirements/acceptance criteria and spec
// are not imported at all." They were never EXPORTED either: model.json carries
// requirement EDGES (`mappings: [{requirementId, nodeIds}]`) but no requirement
// content and no spec document, so there was nothing for connect to read.
//
// WHY A SEPARATE FILE, not more fields on the model anchor:
//  1. model.json stays byte-identical, so no already-connected project
//     hash-mismatches its repo anchor on deploy and no spurious drift card appears.
//  2. Evidence state must never ride in the ARCHITECTURE anchor. A criterion
//     flipped by a passing test would churn `modelHash` and raise an architecture
//     drift card — the test-evidence loop fighting the design-drift loop.
//
// WHAT THIS FILE DOES NOT CARRY, and why: per-criterion `met`, requirement
// `status`, and `validation_status`. Those are EVIDENCE, and R5 already owns their
// git channel (derived `- [x]` checkboxes in task docs → drift card → `met:true`
// with provenance, one approval, never silent). Carrying `met` here too would give
// one truth two inbound writers. This file makes requirements EXIST; R5 ticks them.

export const SPEC_ANCHOR_PATH = ".nodespec/spec.json";
export const SPEC_ANCHOR_VERSION = 1;

export interface SpecAnchorRequirement {
  /** Portable human id (REQ-###) — never a row uuid, exactly like AnchorMapping. */
  requirementId: string;
  name: string;
  description?: string;
  category: string;
  /**
   * Criterion TEXTS in authored order. Order is content, not presentation: R5a
   * matches criteria by exact text, and re-sorting would silently rewrite the
   * mapping between a task-doc checkbox and the criterion it ticks.
   */
  acceptanceCriteria: string[];
  contentHash: string;
}

export interface SpecAnchorMapping {
  requirementId: string;
  nodeId: string;
  mappingType: string;
}

export interface SpecAnchor {
  specVersion: number;
  generatedBy: "nodespec";
  specHash: string;
  vision: string;
  /**
   * LEGACY ONLY — the Features portion of the spec was removed (migration
   * 20260625154151 dropped the DB column). This key is never written anymore;
   * it stays optional so already-pushed old-format files still parse, and
   * `verifySpecHash` hashes the shape the file actually has (same rule as
   * R7d's verifyModelHash). Adopt/apply ignore it entirely.
   */
  // deno-lint-ignore no-explicit-any
  features?: any[];
  // deno-lint-ignore no-explicit-any
  constraints: any[];
  // deno-lint-ignore no-explicit-any
  preferences: Record<string, any>;
  requirements: SpecAnchorRequirement[];
  mappings: SpecAnchorMapping[];
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Key-sorted at EVERY depth. `constraints`/`preferences` are free-form
 * jsonb the user's own tooling may have written in any key order — without this,
 * a semantically identical spec would produce a different specHash and read as
 * drift. (The model anchor can use plain JSON.stringify because it constructs
 * every object literal itself; this one cannot.)
 */
export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`).join(",")}}`;
}

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

export interface SpecInput {
  vision?: string | null;
  constraints?: unknown;
  preferences?: unknown;
}

export interface RequirementInput {
  requirement_id: string;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  /** D2: loaded for the BOARD.md derivation; serializeSpec ignores it. */
  status?: string | null;
  acceptance_criteria?: unknown;
}

export interface SpecMappingInput {
  requirementId: string;
  nodeId: string;
  mappingType?: string | null;
}

/**
 * Criteria are stored as jsonb and have carried two shapes over the project's life:
 * bare strings, and `{text, met}` objects. Read both; emit text only (`met` is R5's).
 */
export function criteriaTexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const c of raw) {
    if (typeof c === "string") {
      if (c.trim()) out.push(c);
    } else if (c && typeof c === "object") {
      const text = (c as AnyRecord).text;
      if (typeof text === "string" && text.trim()) out.push(text);
    }
  }
  return out;
}

/**
 * Serialize the spec plane into the canonical spec.json string. Pure over its
 * inputs; requirements sorted by REQ id, mappings by (requirementId, nodeId).
 */
export async function serializeSpec(
  spec: SpecInput,
  requirements: RequirementInput[],
  mappings: SpecMappingInput[],
): Promise<string> {
  const reqs: SpecAnchorRequirement[] = [];
  for (const r of requirements) {
    if (!r.requirement_id) continue;
    const core = {
      requirementId: String(r.requirement_id),
      name: String(r.name ?? ""),
      ...(r.description ? { description: String(r.description) } : {}),
      category: String(r.category ?? "functional"),
      acceptanceCriteria: criteriaTexts(r.acceptance_criteria),
    };
    reqs.push({ ...core, contentHash: await sha256Hex(stableSerialize(core)) });
  }
  reqs.sort((a, b) => a.requirementId.localeCompare(b.requirementId));

  const seen = new Set<string>();
  const maps: SpecAnchorMapping[] = [];
  for (const m of mappings) {
    if (!m.requirementId || !m.nodeId) continue;
    const key = `${m.requirementId}\u0000${m.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    maps.push({
      requirementId: String(m.requirementId),
      nodeId: String(m.nodeId),
      mappingType: String(m.mappingType || "implements"),
    });
  }
  maps.sort((a, b) =>
    a.requirementId.localeCompare(b.requirementId) || a.nodeId.localeCompare(b.nodeId)
  );

  const content = {
    vision: String(spec.vision ?? ""),
    constraints: Array.isArray(spec.constraints) ? spec.constraints : [],
    preferences: (spec.preferences && typeof spec.preferences === "object" && !Array.isArray(spec.preferences))
      ? spec.preferences as Record<string, unknown>
      : {},
    requirements: reqs,
    mappings: maps,
  };
  const specHash = await sha256Hex(stableSerialize(content));

  const anchor: SpecAnchor = {
    specVersion: SPEC_ANCHOR_VERSION,
    generatedBy: "nodespec",
    specHash,
    ...content,
  } as SpecAnchor;
  return JSON.stringify(anchor, null, 2) + "\n";
}

export type SpecParseResult =
  | { ok: true; spec: SpecAnchor }
  | { ok: false; error: string };

/** Parse + structurally validate a spec.json string. */
export function parseSpec(json: string): SpecParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `spec.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const s = raw as AnyRecord;
  if (!s || typeof s !== "object") return { ok: false, error: "spec.json root is not an object" };
  if (s.specVersion !== SPEC_ANCHOR_VERSION) {
    return { ok: false, error: `Unsupported specVersion: ${s.specVersion} (expected ${SPEC_ANCHOR_VERSION})` };
  }
  if (!Array.isArray(s.requirements)) return { ok: false, error: "spec.json requirements is not an array" };
  if (!Array.isArray(s.mappings)) return { ok: false, error: "spec.json mappings is not an array" };
  for (const r of s.requirements as AnyRecord[]) {
    if (!r.requirementId || typeof r.name !== "string") {
      return { ok: false, error: `spec.json requirement missing requirementId/name: ${JSON.stringify(r).slice(0, 120)}` };
    }
    if (r.acceptanceCriteria !== undefined && !Array.isArray(r.acceptanceCriteria)) {
      return { ok: false, error: `spec.json requirement ${r.requirementId} acceptanceCriteria is not an array` };
    }
  }
  for (const m of s.mappings as AnyRecord[]) {
    if (!m.requirementId || !m.nodeId) {
      return { ok: false, error: `spec.json mapping missing requirementId/nodeId: ${JSON.stringify(m).slice(0, 120)}` };
    }
  }
  return { ok: true, spec: s as SpecAnchor };
}

/** Recompute the spec hash of a parsed anchor (integrity check for adopt paths). */
export async function verifySpecHash(spec: SpecAnchor): Promise<boolean> {
  const content = {
    vision: spec.vision,
    // Legacy shim: old-format files hashed a `features` key inside content.
    // Hash the shape the file actually has (R7d verifyModelHash precedent) so
    // pre-removal files verify clean; the key is ignored everywhere else.
    ...("features" in spec ? { features: spec.features } : {}),
    constraints: spec.constraints,
    preferences: spec.preferences,
    requirements: spec.requirements,
    mappings: spec.mappings,
  };
  return (await sha256Hex(stableSerialize(content))) === spec.specHash;
}

export interface SpecAnchorSummary {
  requirements: number;
  criteria: number;
  mappings: number;
}

export function summarizeSpec(spec: SpecAnchor): SpecAnchorSummary {
  return {
    requirements: spec.requirements.length,
    criteria: spec.requirements.reduce((n, r) => n + (r.acceptanceCriteria?.length ?? 0), 0),
    mappings: spec.mappings.length,
  };
}

/**
 * Load the spec plane for a project in the shape `serializeSpec` wants.
 * Returns null when the project has no spec row — the push then writes no
 * spec.json rather than an empty one (an empty spec file would read, on the next
 * connect, as "this project HAS a spec and it is blank").
 *
 * THROWS on a failed query: "query failed" must never read as "project has no
 * spec". Exactly that silence hid a schema drift (the dropped features column)
 * that disabled the whole spec plane while every offline test passed.
 *
 * AC: `constraintsCarried` is the owner's plan answer (node-constraints.ts
 * constraintsCarried, asked by the caller so this file stays free of the
 * plan code). Absent or false, constraints are not read and none is written.
 */
// deno-lint-ignore no-explicit-any
export async function loadSpecPlane(supabase: any, projectId: string, opts: { constraintsCarried?: boolean } = {}): Promise<
  { spec: SpecInput; requirements: RequirementInput[]; mappings: SpecMappingInput[] } | null
> {
  const { data: specRow, error: specErr } = await supabase
    .from("project_specifications")
    .select("id, vision, preferences")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (specErr) throw new Error(`loadSpecPlane: project_specifications query failed: ${specErr.message}`);
  if (!specRow) return null;

  // No `priority` — dropped by migration 20260126015837; the live harness caught
  // this select 400ing exactly like the dropped column above. And the same rule
  // as above: these two queries THROW on error rather than serializing an empty
  // (but valid-looking) spec plane.
  const [reqRes, mapRes] = await Promise.all([
    supabase
      .from("specification_requirements")
      .select("id, requirement_id, name, description, category, status, acceptance_criteria, archived_at")
      .eq("specification_id", specRow.id),
    supabase
      .from("specification_mappings")
      .select("requirement_id, node_id, mapping_type")
      .eq("specification_id", specRow.id),
  ]);
  if (reqRes.error) throw new Error(`loadSpecPlane: specification_requirements query failed: ${reqRes.error.message}`);
  if (mapRes.error) throw new Error(`loadSpecPlane: specification_mappings query failed: ${mapRes.error.message}`);
  const { data: reqRows } = reqRes;
  const { data: mapRows } = mapRes;

  const requirements = (reqRows ?? []) as Array<RequirementInput & { id: string }>;
  // specification_mappings.requirement_id is the ROW uuid; the anchor speaks
  // REQ-### so it survives a move to a different database.
  const humanId = new Map(requirements.map((r) => [r.id, r.requirement_id]));
  const mappings: SpecMappingInput[] = [];
  for (const m of ((mapRows ?? []) as AnyRecord[])) {
    const requirementId = humanId.get(m.requirement_id);
    if (!requirementId || !m.node_id) continue;
    mappings.push({ requirementId, nodeId: String(m.node_id), mappingType: m.mapping_type });
  }

  // AA.0 (R.2a): spec.json carries the constraints from the one store, not the
  // legacy jsonb. A marked constraint never leaves in a file committed to git;
  // the workflow travels by name (readable, and a new project may not have
  // the lane: the adopt trigger files it project-wide).
  // R.2b: a check, a scope other than the project and its waivers ride along
  // (reviewed like code); guidance for the project writes exactly what it did.
  // A waiver leaves without its owner (an account id stays in the database).
  // AC (owner 2026-09-24): below Indie constraints do not exist, so spec.json
  // carries none (the owner's plan decides, the same answer the drift sweep
  // reads, so a push and a sweep never disagree).
  const carried = opts.constraintsCarried === true;
  let { data: conRows, error: conErr }: { data: unknown; error: { message: string } | null } = !carried ? { data: [], error: null } : await supabase
    .from("project_constraints")
    .select("ctype, title, description, rationale, workflow_id, mark, kind, scope_kind, scope_value, check_spec, waivers, workflows(name)")
    .eq("project_id", projectId);
  if (carried && conErr && /column .* does not exist|42703/i.test(conErr.message)) {
    ({ data: conRows, error: conErr } = await supabase
      .from("project_constraints")
      .select("ctype, title, description, rationale, workflow_id, mark, workflows(name)")
      .eq("project_id", projectId));
  }
  if (conErr) throw new Error(`loadSpecPlane: project_constraints query failed: ${conErr.message}`);
  const constraints = ((conRows ?? []) as AnyRecord[])
    .filter((c) => !c.mark)
    .map((c) => ({
      type: String(c.ctype),
      description: String(c.description),
      ...(c.title ? { title: String(c.title) } : {}),
      ...(c.rationale ? { rationale: String(c.rationale) } : {}),
      ...(c.workflow_id && (c.workflows as AnyRecord | null)?.name ? { workflow: String((c.workflows as AnyRecord).name) } : {}),
      ...(c.kind === "check" && c.check_spec ? { kind: "check", check: c.check_spec } : {}),
      ...(c.scope_kind && !["project", "workflow"].includes(String(c.scope_kind)) && c.scope_value
        ? { scope: { kind: String(c.scope_kind), value: String(c.scope_value) } } : {}),
      ...(Array.isArray(c.waivers) && c.waivers.length > 0
        ? { waivers: (c.waivers as AnyRecord[]).map(({ owner: _owner, ...w }) => w) } : {}),
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.description.localeCompare(b.description));

  return {
    spec: {
      vision: specRow.vision,
      constraints,
      preferences: specRow.preferences,
    },
    requirements,
    mappings,
  };
}

// ── R7c: entity-level spec diff — the easy-reconciliation surface ─────────────
// Same shape and direction convention as diffAnchors: FROM the project's spec TO
// the repo's, so buckets read as "what LOADING the repo would do to your spec".
// Set arithmetic over content hashes, never a text merge.

export interface SpecDiffEntry {
  requirementId: string;
  label: string;
}

export interface SpecDiffBucket {
  added: SpecDiffEntry[];
  removed: SpecDiffEntry[];
  changed: SpecDiffEntry[];
}

export interface SpecDiff {
  identical: boolean;
  requirements: SpecDiffBucket;
  /** Criterion-level detail: which acceptance criteria a load would add or drop. */
  criteria: { added: string[]; removed: string[] };
  visionChanged: boolean;
  mappingsChanged: boolean;
}

export function diffSpecs(ours: SpecAnchor, theirs: SpecAnchor): SpecDiff {
  const byId = (list: SpecAnchorRequirement[]) => new Map(list.map((r) => [r.requirementId, r]));
  const o = byId(ours.requirements);
  const t = byId(theirs.requirements);

  const label = (r: SpecAnchorRequirement) => `${r.requirementId} ${r.name}`.trim();
  const bucket: SpecDiffBucket = { added: [], removed: [], changed: [] };
  for (const [id, r] of t) {
    const mine = o.get(id);
    if (!mine) bucket.added.push({ requirementId: id, label: label(r) });
    else if (mine.contentHash !== r.contentHash) bucket.changed.push({ requirementId: id, label: label(r) });
  }
  for (const [id, r] of o) {
    if (!t.has(id)) bucket.removed.push({ requirementId: id, label: label(r) });
  }

  // Criterion detail across every requirement present on either side. Texts are
  // compared exactly — the same binding rule R5a uses for task-doc checkboxes.
  const criteria = { added: [] as string[], removed: [] as string[] };
  for (const id of new Set([...o.keys(), ...t.keys()])) {
    const mine = new Set(o.get(id)?.acceptanceCriteria ?? []);
    const yours = new Set(t.get(id)?.acceptanceCriteria ?? []);
    for (const c of yours) if (!mine.has(c)) criteria.added.push(`${id}: ${c}`);
    for (const c of mine) if (!yours.has(c)) criteria.removed.push(`${id}: ${c}`);
  }

  const mapKey = (m: SpecAnchorMapping) => `${m.requirementId}:${m.nodeId}:${m.mappingType}`;
  const mappingsChanged =
    ours.mappings.length !== theirs.mappings.length ||
    ours.mappings.map(mapKey).sort().join("|") !== theirs.mappings.map(mapKey).sort().join("|");

  const visionChanged = (ours.vision ?? "") !== (theirs.vision ?? "");
  const identical =
    bucket.added.length === 0 && bucket.removed.length === 0 && bucket.changed.length === 0 &&
    !visionChanged && !mappingsChanged;

  return { identical, requirements: bucket, criteria, visionChanged, mappingsChanged };
}

export interface CappedSpecDiffBucket {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  added: string[];
  removed: string[];
  changed: string[];
}

export interface CappedSpecDiff {
  identical: boolean;
  requirements: CappedSpecDiffBucket;
  criteria: { addedCount: number; removedCount: number; added: string[]; removed: string[] };
  visionChanged: boolean;
  mappingsChanged: boolean;
}

/**
 * Card-metadata form: caps each list so a large spec cannot bloat the event row.
 * Counts survive even when the name lists truncate.
 * NOTE: this shape crosses the wire into the client's hand-mirrored copy in
 * src/ui/services/GitService.ts — change the two together.
 */
export function capSpecDiff(diff: SpecDiff, maxPerList = 8): CappedSpecDiff {
  return {
    identical: diff.identical,
    requirements: {
      addedCount: diff.requirements.added.length,
      removedCount: diff.requirements.removed.length,
      changedCount: diff.requirements.changed.length,
      added: diff.requirements.added.slice(0, maxPerList).map((e) => e.label),
      removed: diff.requirements.removed.slice(0, maxPerList).map((e) => e.label),
      changed: diff.requirements.changed.slice(0, maxPerList).map((e) => e.label),
    },
    criteria: {
      addedCount: diff.criteria.added.length,
      removedCount: diff.criteria.removed.length,
      added: diff.criteria.added.slice(0, maxPerList),
      removed: diff.criteria.removed.slice(0, maxPerList),
    },
    visionChanged: diff.visionChanged,
    mappingsChanged: diff.mappingsChanged,
  };
}

// ── R7b / R7c: load a spec anchor into the database ───────────────────────────
// Mirrors the architecture's provenance ratchet: a repo carrying a spec is ADOPTED,
// never re-inferred. The spec plane has no patch ledger, so a load writes rows
// directly, after a person asked for it (connect, or "Load requirements from
// repo"). Adopt creates the project's spec and is refused when one exists;
// apply updates the one it has.
//
// V3 AD.2c (finding D21): the whole load is ONE call, `apply_spec_load`
// (migration 20260924140000), so it lands whole or not at all. The old path
// wrote the spec, each requirement and the mappings as separate requests, so a
// failure part way left a spec half loaded, and it deleted every mapping of
// each requirement git named before inserting git's again, which dropped the
// mappings added in NodeSpec and reset the confidence, notes and validation of
// the rest. The rules the database now applies:
//  - a criterion whose TEXT is unchanged keeps its evidence (the whole stored
//    object: met and whatever R5 stamped beside it); a new or reworded one
//    arrives unmet, because the evidence proved the old wording. The row is
//    locked before it is read, so a tick landing at the same moment survives;
//  - a locked requirement is not written, and is named when git changed it;
//  - requirements git does not name are kept and named, never deleted;
//  - mappings follow `planSpecMappings`: every other row stays exactly as it is.

/** The values the database accepts (CHECK constraints on the two tables). */
const REQUIREMENT_CATEGORIES = ["functional", "non-functional", "technical", "business"];
const MAPPING_TYPES = new Set(["implements", "depends_on", "validates", "supports"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SpecMappingPlan {
  /** Git's mappings; the database adds each one the project lacks. */
  add: SpecAnchorMapping[];
  /** Mappings git removed since the last sync; the database removes each one
   *  the project still has. */
  remove: SpecAnchorMapping[];
  /** Git's mappings that cannot land: the requirement is not in git's list,
   *  the node is not a node id or not in the project, or the type is unknown. */
  skipped: number;
}

/**
 * AD.2c: which mappings a load writes, from three sides: git now (`repo`), git
 * at the last sync (`baseline`, the spec.json of `last_synced_commit`, null
 * when there is none) and the project, which the database reads inside the
 * load. A mapping git holds is added where the project lacks it; a mapping in
 * the baseline that git no longer holds was removed in git, and is removed;
 * a mapping only the project has was added in NodeSpec, and stays. Only the
 * requirements git names are touched: one it does not name is kept whole,
 * mappings included, as the requirement itself is.
 */
export function planSpecMappings(
  repo: SpecAnchor,
  baseline: SpecAnchor | null,
  liveNodeIds: Set<string> | null = null,
): SpecMappingPlan {
  const listed = new Set(repo.requirements.map((r) => r.requirementId));
  const valid = (m: SpecAnchorMapping): SpecAnchorMapping | null => {
    const mappingType = m.mappingType || "implements";
    const nodeId = String(m.nodeId ?? "").toLowerCase();
    if (!listed.has(m.requirementId) || !UUID_RE.test(nodeId) || !MAPPING_TYPES.has(mappingType)) return null;
    return { requirementId: m.requirementId, nodeId, mappingType };
  };
  const key = (m: SpecAnchorMapping) => `${m.requirementId}\u0000${m.nodeId}\u0000${m.mappingType}`;

  const inGit = new Set<string>();
  const add: SpecAnchorMapping[] = [];
  let skipped = 0;
  for (const raw of repo.mappings) {
    const m = valid(raw);
    if (!m) { skipped++; continue; }
    if (inGit.has(key(m))) continue;
    inGit.add(key(m));
    if (liveNodeIds && !liveNodeIds.has(m.nodeId) && !liveNodeIds.has(raw.nodeId)) { skipped++; continue; }
    add.push(m);
  }

  const remove: SpecAnchorMapping[] = [];
  const removing = new Set<string>();
  for (const raw of baseline?.mappings ?? []) {
    const m = valid(raw);
    if (!m || inGit.has(key(m)) || removing.has(key(m))) continue;
    removing.add(key(m));
    remove.push(m);
  }
  return { add, remove, skipped };
}

/** A category the database refuses would fail the whole load; name each one
 *  first so the person reads which requirement, not a constraint name. */
export function specLoadProblems(spec: SpecAnchor): string[] {
  return spec.requirements
    .filter((r) => r.category && !REQUIREMENT_CATEGORIES.includes(r.category))
    .map((r) => `${r.requirementId} has the category "${r.category}"; a requirement is ${REQUIREMENT_CATEGORIES.join(", ")}.`);
}

interface SpecLoadRow {
  ok: boolean;
  reason?: string;
  specId?: string;
  added?: number;
  updated?: number;
  criteriaPreserved?: number;
  mappingsAdded?: number;
  mappingsRemoved?: number;
  skippedMappings?: number;
  locked?: string[];
  keptLocal?: string[];
}

// deno-lint-ignore no-explicit-any
async function runSpecLoad(supabase: any, mode: "adopt" | "apply", args: {
  projectId: string;
  actorId: string | null;
  spec: SpecAnchor;
  mappings: SpecMappingPlan;
  origin: string;
  sourceCommit?: string;
}): Promise<{ ok: true; row: SpecLoadRow } | { ok: false; message: string }> {
  const { spec } = args;
  const { data, error } = await supabase.rpc("apply_spec_load", {
    p_project_id: args.projectId,
    p_mode: mode,
    p_actor: args.actorId,
    p_spec: {
      vision: spec.vision || "",
      constraints: Array.isArray(spec.constraints) ? spec.constraints : [],
      preferences: spec.preferences && typeof spec.preferences === "object" && !Array.isArray(spec.preferences)
        ? spec.preferences : {},
      specHash: spec.specHash,
    },
    p_requirements: spec.requirements.map((r) => ({
      requirementId: r.requirementId,
      name: r.name,
      description: r.description ?? null,
      category: r.category || "functional",
      // `met` is NOT in the anchor by design: evidence travels through R5's
      // task-doc checkbox lane, so a new criterion arrives unmet.
      acceptanceCriteria: (r.acceptanceCriteria ?? []).filter((c): c is string => typeof c === "string"),
    })),
    p_mappings_add: args.mappings.add,
    p_mappings_remove: args.mappings.remove,
    // Same two-half provenance convention the artifact lanes use (R3-4b).
    p_provenance: {
      origin: args.origin,
      ...(args.sourceCommit ? { commitSha: args.sourceCommit } : {}),
      at: new Date().toISOString(),
    },
  });
  if (error) return { ok: false, message: `The requirements load failed and nothing was written: ${error.message}` };
  if (!data || typeof data !== "object") return { ok: false, message: "The requirements load returned nothing; nothing was written." };
  return { ok: true, row: data as SpecLoadRow };
}

export type SpecAdoptResult =
  | { adopted: true; specId: string; counts: SpecAnchorSummary; skippedMappings: number }
  | { adopted: false; reason: "already-has-spec" | "hash-failed" | "invalid-spec" | "no-owner" | "write-failed"; message?: string };

/**
 * @param liveNodeIds node ids that exist in the adopting project. A mapping to an
 *   unknown node is DROPPED, not invented — the same liveness rule
 *   `loadAnchorMappings` applies on the way out. Pass null to skip the check
 *   (used when the architecture adoption is still a pending proposal, so the
 *   nodes do not exist yet — see the caller's note).
 */
// deno-lint-ignore no-explicit-any
export async function adoptSpecAnchor(supabase: any, opts: {
  projectId: string;
  ownerId: string | null;
  spec: SpecAnchor;
  liveNodeIds?: Set<string> | null;
  sourceCommit?: string;
}): Promise<SpecAdoptResult> {
  const { projectId, ownerId, spec, liveNodeIds = null, sourceCommit } = opts;
  if (!ownerId) return { adopted: false, reason: "no-owner" };
  if (!(await verifySpecHash(spec))) {
    return { adopted: false, reason: "hash-failed", message: "spec.json hash does not match its content" };
  }
  const problems = specLoadProblems(spec);
  if (problems.length > 0) return { adopted: false, reason: "invalid-spec", message: problems.join(" ") };

  const mappings = planSpecMappings(spec, null, liveNodeIds);
  const run = await runSpecLoad(supabase, "adopt", {
    projectId, actorId: ownerId, spec, mappings, origin: "spec-anchor-adopt", sourceCommit,
  });
  if (!run.ok) return { adopted: false, reason: "write-failed", message: run.message };
  if (!run.row.ok) {
    return run.row.reason === "already-has-spec"
      ? { adopted: false, reason: "already-has-spec" }
      : { adopted: false, reason: "write-failed", message: run.row.reason ?? "the load was refused" };
  }
  return {
    adopted: true,
    specId: String(run.row.specId),
    counts: { ...summarizeSpec(spec), mappings: run.row.mappingsAdded ?? 0 },
    skippedMappings: mappings.skipped + (run.row.skippedMappings ?? 0),
  };
}

export type SpecApplyResult =
  | {
    applied: true;
    specId: string;
    counts: { added: number; updated: number; criteriaPreserved: number; mappings: number; mappingsRemoved: number };
    /** Requirements this project has that the repo's spec does not mention — reported, never deleted. */
    keptLocal: string[];
    /** AD.2c: locked requirements git changed; not written. */
    locked: string[];
    skippedMappings: number;
  }
  | { applied: false; reason: "no-spec" | "hash-failed" | "invalid-spec" | "write-failed"; message?: string };

/**
 * Apply a repo spec onto an EXISTING project spec. Upsert, never wipe:
 *  - requirements present on both sides take the repo's authored fields and keep
 *    their evidence;
 *  - requirements only the repo has are inserted;
 *  - requirements only WE have are LEFT ALONE and reported. Deleting a
 *    requirement cascades its mappings, test cases and validation results — that
 *    is not something a sync does behind one click. Removal stays the user's
 *    explicit act in the Spec view.
 *  - mappings follow `planSpecMappings` against `baseline`, git's spec at the
 *    last sync: without one, nothing is removed.
 */
// deno-lint-ignore no-explicit-any
export async function applySpecAnchor(supabase: any, opts: {
  projectId: string;
  ownerId: string | null;
  spec: SpecAnchor;
  baseline?: SpecAnchor | null;
  liveNodeIds?: Set<string> | null;
  sourceCommit?: string;
}): Promise<SpecApplyResult> {
  const { projectId, ownerId, spec, baseline = null, liveNodeIds = null, sourceCommit } = opts;
  if (!(await verifySpecHash(spec))) {
    return { applied: false, reason: "hash-failed", message: "spec.json hash does not match its content" };
  }
  const problems = specLoadProblems(spec);
  if (problems.length > 0) return { applied: false, reason: "invalid-spec", message: problems.join(" ") };

  const mappings = planSpecMappings(spec, baseline, liveNodeIds);
  const run = await runSpecLoad(supabase, "apply", {
    projectId, actorId: ownerId, spec, mappings, origin: "spec-anchor-load", sourceCommit,
  });
  if (!run.ok) return { applied: false, reason: "write-failed", message: run.message };
  if (!run.row.ok) {
    return run.row.reason === "no-spec"
      ? { applied: false, reason: "no-spec" }
      : { applied: false, reason: "write-failed", message: run.row.reason ?? "the load was refused" };
  }
  const r = run.row;
  return {
    applied: true,
    specId: String(r.specId),
    counts: {
      added: r.added ?? 0,
      updated: r.updated ?? 0,
      criteriaPreserved: r.criteriaPreserved ?? 0,
      mappings: r.mappingsAdded ?? 0,
      mappingsRemoved: r.mappingsRemoved ?? 0,
    },
    keptLocal: r.keptLocal ?? [],
    locked: r.locked ?? [],
    skippedMappings: mappings.skipped + (r.skippedMappings ?? 0),
  };
}

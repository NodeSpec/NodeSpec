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
 */
// deno-lint-ignore no-explicit-any
export async function loadSpecPlane(supabase: any, projectId: string): Promise<
  { spec: SpecInput; requirements: RequirementInput[]; mappings: SpecMappingInput[] } | null
> {
  const { data: specRow, error: specErr } = await supabase
    .from("project_specifications")
    .select("id, vision, constraints, preferences")
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
      .select("id, requirement_id, name, description, category, status, acceptance_criteria")
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

  return {
    spec: {
      vision: specRow.vision,
      constraints: specRow.constraints,
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

// ── R7b: adopt-on-connect — materialize a spec anchor into the DB ──────────────
// Mirrors the architecture's provenance ratchet: a repo carrying a spec is ADOPTED,
// never re-inferred. But unlike the architecture (which adopts through the
// proposal → accept → patch pipeline, because the graph is patch-versioned), the
// spec plane has no patch ledger — so this writes rows directly, and it is
// deliberately ADOPT-ONLY: a project that already has a spec is never overwritten.
// Reconciling a DIVERGED spec is R7c's card, on the same one-approval rule as
// every other inbound change.

export type SpecAdoptResult =
  | { adopted: true; specId: string; counts: SpecAnchorSummary; skippedMappings: number }
  | { adopted: false; reason: "already-has-spec" | "hash-failed" | "no-owner" | "write-failed"; message?: string };

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

  const { data: existing } = await supabase
    .from("project_specifications")
    .select("id")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();
  if (existing) return { adopted: false, reason: "already-has-spec" };

  const now = new Date().toISOString();
  const { data: specRow, error: specErr } = await supabase
    .from("project_specifications")
    .insert({
      project_id: projectId,
      vision: spec.vision || "",
      constraints: spec.constraints ?? [],
      preferences: spec.preferences ?? {},
      created_by: ownerId,
      metadata: {
        // Same two-half provenance convention the artifact lanes use (R3-4b).
        provenance: {
          origin: "spec-anchor-adopt",
          ...(sourceCommit ? { commitSha: sourceCommit } : {}),
          at: now,
        },
        specHash: spec.specHash,
      },
    })
    .select("id")
    .maybeSingle();
  if (specErr || !specRow) {
    return { adopted: false, reason: "write-failed", message: specErr?.message ?? "specification insert returned no row" };
  }

  const reqRows = spec.requirements.map((r) => ({
    specification_id: specRow.id,
    requirement_id: r.requirementId,
    name: r.name,
    description: r.description ?? null,
    category: r.category || "functional",
    // `met` is NOT in the anchor by design — evidence state travels through R5's
    // task-doc checkbox lane. An adopted criterion therefore starts unmet, which
    // is the honest state: a fresh adoption carries no evidence.
    acceptance_criteria: (r.acceptanceCriteria ?? []).map((text) => ({ text, met: false })),
    metadata: {
      provenance: {
        origin: "spec-anchor-adopt",
        ...(sourceCommit ? { commitSha: sourceCommit } : {}),
        at: now,
      },
    },
  }));

  let insertedReqs: Array<{ id: string; requirement_id: string }> = [];
  if (reqRows.length > 0) {
    const { data, error } = await supabase
      .from("specification_requirements")
      .insert(reqRows)
      .select("id, requirement_id");
    if (error) {
      return { adopted: false, reason: "write-failed", message: `requirements insert failed: ${error.message}` };
    }
    insertedReqs = (data ?? []) as Array<{ id: string; requirement_id: string }>;
  }

  const rowIdOf = new Map(insertedReqs.map((r) => [r.requirement_id, r.id]));
  const mapRows: Array<Record<string, unknown>> = [];
  let skippedMappings = 0;
  for (const m of spec.mappings) {
    const rowId = rowIdOf.get(m.requirementId);
    if (!rowId) { skippedMappings++; continue; }
    if (liveNodeIds && !liveNodeIds.has(m.nodeId)) { skippedMappings++; continue; }
    mapRows.push({
      specification_id: specRow.id,
      requirement_id: rowId,
      node_id: m.nodeId,
      mapping_type: m.mappingType || "implements",
      created_by: ownerId,
    });
  }
  if (mapRows.length > 0) {
    const { error } = await supabase.from("specification_mappings").insert(mapRows);
    if (error) {
      // Requirements landed; traceability did not. Report honestly rather than
      // rolling back a spec the user can otherwise use.
      return { adopted: false, reason: "write-failed", message: `mappings insert failed: ${error.message}` };
    }
  }

  return {
    adopted: true,
    specId: specRow.id,
    counts: { ...summarizeSpec(spec), mappings: mapRows.length },
    skippedMappings,
  };
}

// ── R7c: apply a repo spec onto a project that ALREADY has one ────────────────

export interface StoredCriterion {
  text: string;
  met?: boolean;
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
}

/**
 * THE RULE THAT MAKES A SPEC LOAD SAFE: evidence survives.
 *
 * Rebuild a requirement's criteria from the repo's list, carrying `met` (and any
 * provenance R5 stamped alongside it) across for every criterion whose TEXT is
 * unchanged. Exact match only — the same binding rule R5a uses to tie a task-doc
 * checkbox to a criterion.
 *
 *  - repo added a criterion  → arrives unmet (nothing has proved it yet)
 *  - repo removed one        → it goes
 *  - repo EDITED one         → a different criterion, so it arrives unmet. The
 *                              evidence proved the old wording, not the new one;
 *                              silently carrying `met` across an edit would let a
 *                              reworded criterion inherit a tick it never earned.
 *
 * Without this, an AI's "test passed → criterion met" could be erased by the next
 * unrelated spec load, and the loop the owner asked for would not hold.
 */
export function mergeCriteria(existing: unknown, repoTexts: string[]): { criteria: StoredCriterion[]; preserved: number } {
  const prior = new Map<string, StoredCriterion>();
  if (Array.isArray(existing)) {
    for (const c of existing) {
      if (typeof c === "string") prior.set(c, { text: c });
      else if (c && typeof c === "object" && typeof (c as AnyRecord).text === "string") {
        prior.set((c as AnyRecord).text, c as StoredCriterion);
      }
    }
  }
  let preserved = 0;
  const criteria = repoTexts.map((text) => {
    const before = prior.get(text);
    if (before && before.met === true) preserved++;
    // Keep the WHOLE prior object (met + any provenance R5 wrote), not just the flag.
    return before ? { ...before, text } : { text, met: false };
  });
  return { criteria, preserved };
}

export type SpecApplyResult =
  | {
    applied: true;
    specId: string;
    counts: { added: number; updated: number; criteriaPreserved: number; mappings: number };
    /** Requirements this project has that the repo's spec does not mention — reported, never deleted. */
    keptLocal: string[];
    skippedMappings: number;
  }
  | { applied: false; reason: "no-spec" | "hash-failed" | "no-owner" | "write-failed"; message?: string };

/**
 * Apply a repo spec onto an EXISTING project spec. Upsert, never wipe:
 *  - requirements present on both sides take the repo's authored fields and keep
 *    their evidence (see mergeCriteria);
 *  - requirements only the repo has are inserted;
 *  - requirements only WE have are LEFT ALONE and reported. Deleting a
 *    requirement cascades its mappings, test cases and validation results — that
 *    is not something a sync does behind one click. Removal stays the user's
 *    explicit act in the Spec view.
 *  - mappings are replaced only FOR THE REQUIREMENTS THE REPO MENTIONS: keeping a
 *    mapping the repo dropped would make the next push re-add it (ping-pong),
 *    while touching unrelated requirements' mappings would destroy local work.
 */
// deno-lint-ignore no-explicit-any
export async function applySpecAnchor(supabase: any, opts: {
  projectId: string;
  ownerId: string | null;
  spec: SpecAnchor;
  liveNodeIds?: Set<string> | null;
  sourceCommit?: string;
}): Promise<SpecApplyResult> {
  const { projectId, ownerId, spec, liveNodeIds = null, sourceCommit } = opts;
  if (!(await verifySpecHash(spec))) {
    return { applied: false, reason: "hash-failed", message: "spec.json hash does not match its content" };
  }

  const { data: specRow } = await supabase
    .from("project_specifications")
    .select("id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!specRow) return { applied: false, reason: "no-spec" };

  const now = new Date().toISOString();
  const provenance = {
    origin: "spec-anchor-load",
    ...(sourceCommit ? { commitSha: sourceCommit } : {}),
    at: now,
  };

  await supabase
    .from("project_specifications")
    .update({
      vision: spec.vision || "",
      constraints: spec.constraints ?? [],
      preferences: spec.preferences ?? {},
      updated_at: now,
    })
    .eq("id", specRow.id);

  const { data: existingRows } = await supabase
    .from("specification_requirements")
    .select("id, requirement_id, acceptance_criteria, metadata")
    .eq("specification_id", specRow.id);
  const existing = new Map(
    ((existingRows ?? []) as AnyRecord[]).map((r) => [r.requirement_id as string, r]),
  );

  let added = 0;
  let updated = 0;
  let criteriaPreserved = 0;
  const rowIdOf = new Map<string, string>();

  for (const r of spec.requirements) {
    const prior = existing.get(r.requirementId);
    const merged = mergeCriteria(prior?.acceptance_criteria, r.acceptanceCriteria ?? []);
    criteriaPreserved += merged.preserved;
    const fields = {
      name: r.name,
      description: r.description ?? null,
      category: r.category || "functional",
      acceptance_criteria: merged.criteria,
      updated_at: now,
    };
    if (prior) {
      const { error } = await supabase
        .from("specification_requirements")
        .update({ ...fields, metadata: { ...(prior.metadata ?? {}), provenance } })
        .eq("id", prior.id);
      if (error) return { applied: false, reason: "write-failed", message: `update ${r.requirementId}: ${error.message}` };
      rowIdOf.set(r.requirementId, prior.id);
      updated++;
    } else {
      const { data, error } = await supabase
        .from("specification_requirements")
        .insert({
          specification_id: specRow.id,
          requirement_id: r.requirementId,
          ...fields,
          metadata: { provenance },
        })
        .select("id")
        .maybeSingle();
      if (error || !data) {
        return { applied: false, reason: "write-failed", message: `insert ${r.requirementId}: ${error?.message ?? "no row"}` };
      }
      rowIdOf.set(r.requirementId, data.id);
      added++;
    }
  }

  const repoIds = new Set(spec.requirements.map((r) => r.requirementId));
  const keptLocal = [...existing.keys()].filter((id) => !repoIds.has(id));

  // Mappings: replace the set for the requirements the repo mentions, only.
  const touchedRowIds = [...rowIdOf.values()];
  let skippedMappings = 0;
  const mapRows: Array<Record<string, unknown>> = [];
  for (const m of spec.mappings) {
    const rowId = rowIdOf.get(m.requirementId);
    if (!rowId) { skippedMappings++; continue; }
    if (liveNodeIds && !liveNodeIds.has(m.nodeId)) { skippedMappings++; continue; }
    mapRows.push({
      specification_id: specRow.id,
      requirement_id: rowId,
      node_id: m.nodeId,
      mapping_type: m.mappingType || "implements",
      ...(ownerId ? { created_by: ownerId } : {}),
    });
  }
  if (touchedRowIds.length > 0) {
    const { error: delErr } = await supabase
      .from("specification_mappings")
      .delete()
      .eq("specification_id", specRow.id)
      .in("requirement_id", touchedRowIds);
    if (delErr) return { applied: false, reason: "write-failed", message: `mapping clear: ${delErr.message}` };
  }
  if (mapRows.length > 0) {
    const { error } = await supabase.from("specification_mappings").insert(mapRows);
    if (error) return { applied: false, reason: "write-failed", message: `mapping insert: ${error.message}` };
  }

  return {
    applied: true,
    specId: specRow.id,
    counts: { added, updated, criteriaPreserved, mappings: mapRows.length },
    keptLocal,
    skippedMappings,
  };
}

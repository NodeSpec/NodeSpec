// R7a/R7b · the spec plane becomes git-durable.
//
// Owner 2026-07-31: "upon connecting to git, if a model.json is detected, our tool
// renders the nodes correctly after a proposal is generated. However,
// requirements/acceptance criteria and spec are not imported at all." They were
// never exported either — model.json carries requirement EDGES, not content.
//
// The load-bearing rule pinned here: `.nodespec/spec.json` carries AUTHORED
// content only. Per-criterion `met`, requirement `status`, and validation_status
// stay out, because R5 already owns their git channel (task-doc checkboxes → drift
// card → met:true with provenance). Two inbound writers for one truth is the
// workflow drift this project forbids.
import { FakeSupabase, assert, assertEquals } from "./helpers.ts";
import {
  SPEC_ANCHOR_PATH, SPEC_ANCHOR_VERSION,
  serializeSpec, parseSpec, verifySpecHash, summarizeSpec, criteriaTexts,
  stableSerialize, adoptSpecAnchor, loadSpecPlane,
  type SpecAnchor,
} from "../_shared/spec-anchor.ts";

// No `features` here: the Features portion of the spec was removed (migration
// 20260625154151 dropped the column). Fixtures must mirror the REAL schema —
// modeling the phantom column is exactly how the live breakage stayed invisible
// while the offline suite passed.
const SPEC = {
  vision: "Ship a thing",
  constraints: ["must run offline"],
  preferences: { style: "terse" },
};

const REQS = [
  {
    requirement_id: "REQ-002",
    name: "Second",
    description: "the second one",
    category: "functional",
    acceptance_criteria: [{ text: "criterion b1", met: true }, { text: "criterion b2", met: false }],
  },
  {
    requirement_id: "REQ-001",
    name: "First",
    category: "non-functional",
    acceptance_criteria: ["plain string criterion"],
  },
];

// Node ids are uuids, as every NodeSpec node's is (specification_mappings.node_id).
const NODE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NODE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const MAPS = [
  { requirementId: "REQ-001", nodeId: NODE_B, mappingType: "implements" },
  { requirementId: "REQ-001", nodeId: NODE_A },
];

const parsed = async () => {
  const json = await serializeSpec(SPEC, REQS, MAPS);
  const p = parseSpec(json);
  assert(p.ok, "fixture must parse");
  return (p as { ok: true; spec: SpecAnchor }).spec;
};

// ── The path + shape contract ─────────────────────────────────────────────────

Deno.test("the spec plane has its OWN anchor path — model.json is untouched", () => {
  assertEquals(SPEC_ANCHOR_PATH, ".nodespec/spec.json");
  // Under .nodespec/, so classifySweepFiles already excludes it from bindable
  // residue and computeStalePaths can never claim it (not an anchor artifact path).
  assert(SPEC_ANCHOR_PATH.startsWith(".nodespec/"), "must live under .nodespec/");
});

Deno.test("serialize → parse round-trips and the hash verifies", async () => {
  const spec = await parsed();
  assertEquals(spec.specVersion, SPEC_ANCHOR_VERSION);
  assertEquals(spec.generatedBy, "nodespec");
  assert(await verifySpecHash(spec), "specHash must match its content");
  assertEquals(summarizeSpec(spec), { requirements: 2, criteria: 3, mappings: 2 });
});

Deno.test("requirements are keyed by the portable REQ id and sorted by it", async () => {
  const spec = await parsed();
  assertEquals(spec.requirements.map((r) => r.requirementId), ["REQ-001", "REQ-002"]);
  assertEquals(spec.mappings.map((m) => `${m.requirementId}:${m.nodeId}`), [`REQ-001:${NODE_A}`, `REQ-001:${NODE_B}`]);
  assertEquals(spec.mappings[0].mappingType, "implements", "a missing mapping type defaults, never nulls");
});

// THE no-second-writer rule.
Deno.test("evidence state NEVER reaches the spec anchor — no met, no status", async () => {
  const json = await serializeSpec(SPEC, REQS, MAPS);
  assert(!json.includes('"met"'), "per-criterion met is R5's channel (task-doc checkboxes), not this file's");
  assert(!json.includes('"status"'), "requirement workflow status is evidence state, not authored content");
  assert(!json.includes("validationStatus"), "validation_status belongs to R5d");
  const spec = await parsed();
  // The criterion whose fixture said met:true comes back as bare text.
  assertEquals(spec.requirements[1].acceptanceCriteria, ["criterion b1", "criterion b2"]);
});

Deno.test("criterion order is CONTENT — R5a matches by exact text, so it is never sorted", async () => {
  const spec = await parsed();
  assertEquals(spec.requirements[1].acceptanceCriteria, ["criterion b1", "criterion b2"]);
  const reversed = await serializeSpec(SPEC, [{
    ...REQS[0],
    acceptance_criteria: [{ text: "criterion b2" }, { text: "criterion b1" }],
  }], []);
  const other = await serializeSpec(SPEC, [REQS[0]], []);
  assert(reversed !== other, "reordering criteria must change the file — it changes which checkbox means what");
});

Deno.test("both stored criterion shapes are read: bare strings and {text, met}", () => {
  assertEquals(criteriaTexts(["a", "b"]), ["a", "b"]);
  assertEquals(criteriaTexts([{ text: "a", met: true }, { text: "b" }]), ["a", "b"]);
  assertEquals(criteriaTexts([{ text: "  " }, "", null, 7]), [], "blank and malformed entries are dropped");
  assertEquals(criteriaTexts("not an array"), []);
});

Deno.test("free-form jsonb key order is NOT drift — the hash is key-sorted at every depth", async () => {
  const a = await serializeSpec(
    { ...SPEC, preferences: { style: "terse", tone: { formality: "low", emoji: false } } }, [], [],
  );
  const b = await serializeSpec(
    { ...SPEC, preferences: { tone: { emoji: false, formality: "low" }, style: "terse" } }, [], [],
  );
  assertEquals(JSON.parse(a).specHash, JSON.parse(b).specHash, "re-saving identical preferences must not read as drift");
  assertEquals(stableSerialize({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

Deno.test("serialization is deterministic — same input, byte-identical output", async () => {
  assertEquals(await serializeSpec(SPEC, REQS, MAPS), await serializeSpec(SPEC, [...REQS].reverse(), [...MAPS].reverse()));
});

Deno.test("a duplicate mapping row collapses to one entry", async () => {
  const json = await serializeSpec(SPEC, REQS, [
    { requirementId: "REQ-001", nodeId: "node-a" },
    { requirementId: "REQ-001", nodeId: "node-a", mappingType: "validates" },
  ]);
  assertEquals(JSON.parse(json).mappings.length, 1);
});

// ── parse validation ──────────────────────────────────────────────────────────

Deno.test("parseSpec rejects malformed files rather than half-importing them", () => {
  assert(!parseSpec("{not json").ok);
  assert(!parseSpec(JSON.stringify({ specVersion: 99, requirements: [], mappings: [] })).ok);
  assert(!parseSpec(JSON.stringify({ specVersion: 1, mappings: [] })).ok, "requirements must be an array");
  assert(!parseSpec(JSON.stringify({
    specVersion: 1, requirements: [{ name: "no id" }], mappings: [],
  })).ok, "a requirement without a REQ id has no portable identity");
  assert(!parseSpec(JSON.stringify({
    specVersion: 1, requirements: [], mappings: [{ requirementId: "REQ-001" }],
  })).ok, "a mapping without a node id points nowhere");
});

Deno.test("a tampered spec fails hash verification", async () => {
  const spec = await parsed();
  spec.requirements[0].name = "hand-edited";
  assert(!(await verifySpecHash(spec)));
});

// ── R7b adoption ──────────────────────────────────────────────────────────────
// V3 AD.2c: the load is ONE call to apply_spec_load, so it lands whole or not at
// all. What the database does with it (criteria unmet, evidence kept, locked
// rows, mappings kept) is proven on real Postgres in scripts/db-lane/082.

// deno-lint-ignore no-explicit-any
type Params = Record<string, any>;
const loadRow = (row: Record<string, unknown> = {}) => ({
  data: {
    ok: true, specId: "spec-1", added: 2, updated: 0, criteriaPreserved: 0,
    mappingsAdded: 2, mappingsRemoved: 0, skippedMappings: 0, locked: [], keptLocal: [], ...row,
  },
  error: null,
});
const adoptFake = (result: { data: unknown; error: unknown } = loadRow()) =>
  new FakeSupabase().script("rpc", "apply_spec_load", result as never);
const loads = (fake: FakeSupabase) => fake.callsTo("rpc", "apply_spec_load");
const params = (fake: FakeSupabase) => loads(fake)[0].payload as Params;

Deno.test("adopt sends the spec, its requirements and its mappings in ONE call", async () => {
  const fake = adoptFake();
  const result = await adoptSpecAnchor(fake, {
    projectId: "p1", ownerId: "u1", spec: await parsed(), sourceCommit: "deadbeef",
  });
  assert(result.adopted, `expected adoption, got ${JSON.stringify(result)}`);
  assertEquals(result.counts, { requirements: 2, criteria: 3, mappings: 2 });
  assertEquals(loads(fake).length, 1);
  assertEquals(fake.calls.filter((c) => c.table !== "rpc").length, 0, "nothing is written outside the one call");

  const p = params(fake);
  assertEquals(p.p_mode, "adopt");
  assertEquals(p.p_actor, "u1");
  // Criterion TEXTS only: `met` is not in the anchor, so the database brings
  // each one in unmet. A fresh adoption carries no evidence.
  assertEquals(p.p_requirements[0].acceptanceCriteria, ["plain string criterion"]);
  // Same two-half provenance convention as the artifact lanes (R3-4b).
  assertEquals(p.p_provenance.origin, "spec-anchor-adopt");
  assertEquals(p.p_provenance.commitSha, "deadbeef");
  // Mappings name the portable REQ id; the database finds the row.
  assertEquals(p.p_mappings_add.map((m: Params) => `${m.requirementId}:${m.nodeId}`), [`REQ-001:${NODE_A}`, `REQ-001:${NODE_B}`]);
  assertEquals(p.p_mappings_remove, [], "an adopt removes nothing");
});

// The ratchet: adopt-only, never overwrite.
Deno.test("a project that already has a spec is never overwritten", async () => {
  const fake = adoptFake({ data: { ok: false, reason: "already-has-spec" }, error: null });
  const result = await adoptSpecAnchor(fake, { projectId: "p1", ownerId: "u1", spec: await parsed() });
  assert(!result.adopted, "refused");
  assertEquals((result as { reason: string }).reason, "already-has-spec");
});

Deno.test("a tampered spec.json is refused at adopt time, not half-applied", async () => {
  const spec = await parsed();
  spec.vision = "hand-edited after the hash was computed";
  const fake = adoptFake();
  const result = await adoptSpecAnchor(fake, { projectId: "p1", ownerId: "u1", spec });
  assert(!result.adopted, "refused");
  assertEquals((result as { reason: string }).reason, "hash-failed");
  assertEquals(loads(fake).length, 0, "nothing is sent");
});

Deno.test("adoption needs an owner — specifications.created_by is NOT NULL", async () => {
  const fake = adoptFake();
  const result = await adoptSpecAnchor(fake, { projectId: "p1", ownerId: null, spec: await parsed() });
  assert(!result.adopted, "refused");
  assertEquals((result as { reason: string }).reason, "no-owner");
  assertEquals(loads(fake).length, 0);
});

Deno.test("a mapping to an unknown node is DROPPED, never invented", async () => {
  const fake = adoptFake(loadRow({ mappingsAdded: 1 }));
  const result = await adoptSpecAnchor(fake, {
    projectId: "p1", ownerId: "u1", spec: await parsed(),
    liveNodeIds: new Set([NODE_A]),
  });
  assert(result.adopted, "adopted");
  assertEquals(result.skippedMappings, 1);
  assertEquals(params(fake).p_mappings_add.map((m: Params) => m.nodeId), [NODE_A]);
});

Deno.test("a failed load reports write-failed and says nothing was written", async () => {
  const fake = adoptFake({ data: null, error: { message: "boom" } });
  const result = await adoptSpecAnchor(fake, { projectId: "p1", ownerId: "u1", spec: await parsed() });
  assert(!result.adopted, "refused");
  assertEquals((result as { reason: string }).reason, "write-failed");
  const message = (result as { message?: string }).message ?? "";
  assert(message.includes("boom") && message.includes("nothing was written"), message);
});

Deno.test("a category the database refuses is named before anything is sent", async () => {
  const p = parseSpec(await serializeSpec(SPEC, [{ ...REQS[0], category: "nonsense" }], []));
  assert(p.ok, "fixture parses");
  const fake = adoptFake();
  const result = await adoptSpecAnchor(fake, { projectId: "p1", ownerId: "u1", spec: (p as { ok: true; spec: SpecAnchor }).spec });
  assert(!result.adopted, "refused");
  assertEquals((result as { reason: string }).reason, "invalid-spec");
  assert((result as { message?: string }).message?.includes('REQ-002 has the category "nonsense"'), "the requirement is named");
  assertEquals(loads(fake).length, 0);
});

// ── R7a export-side loading ───────────────────────────────────────────────────

Deno.test("a project with no spec row yields null — the push writes NO spec.json", async () => {
  const fake = new FakeSupabase();
  fake.script("project_specifications", "select", { data: null });
  assertEquals(await loadSpecPlane(fake, "p1"), null);
  // An empty spec.json would read, on the next connect, as "this project HAS a
  // spec and it is blank" — and adoption would then refuse forever.
});

// ── Wiring pins (the two functions this chunk touches) ────────────────────────
// jsr-403 blocks `deno check` on both files (type-only supabase-js import), so
// their wiring is held by source pins rather than the type checker.

const source = (rel: string) => Deno.readTextFileSync(new URL(rel, import.meta.url));

Deno.test("git-push writes the spec anchor alongside the model anchor", () => {
  const src = source("../git-push/index.ts");
  assert(src.includes('import { serializeSpec, loadSpecPlane, SPEC_ANCHOR_PATH }'), "imports the shared module");
  assert(src.includes("path: SPEC_ANCHOR_PATH,"), "pushes the spec file");
  assert(src.includes("files.push({ path: MODEL_ANCHOR_PATH,"), "the model anchor line is untouched");
  // Observability: a project with no spec writes no spec.json, and that must be
  // distinguishable from a failure (the push-cleanup lesson).
  assert(src.includes("specAnchored,"), "the flag rides the response and the sync log");
});

Deno.test("a 422 non-fast-forward ref update reruns the preflight ONCE on a freshly read head", () => {
  // The provider can serve a stale head for seconds after a recent push; two
  // rapid same-ref pushes (bench-caught; R4 auto-push does it in production)
  // then 422 on the ref PATCH. AD.1: the push reports the branch moved and the
  // handler reruns the whole preflight (head, range, plan) once, so nothing is
  // built on a stale read; a second 422 is genuine contention and surfaces.
  const src = source("../git-push/index.ts");
  assert(/if \(updateRefResponse\.status === 422\) \{[\s\S]{0,200}moved: true/.test(src), "a 422 reports the branch moved");
  assert(src.includes("for (let attempt = 0; attempt < 2 && !pushResult; attempt++)"), "the preflight runs at most twice");
  assert(src.includes("moved twice while pushing"), "a second move surfaces");
});

Deno.test("a spec-plane failure NEVER fails the push — the architecture anchor must still land", () => {
  const src = source("../git-push/index.ts");
  const start = src.indexOf("let specAnchored = false;");
  assert(start > 0, "spec block present");
  const block = src.slice(start, start + 900);
  assert(block.includes("try {") && block.includes("} catch (specErr) {"), "the spec write is guarded");
  assert(!block.includes("return new Response"), "it must not short-circuit the push");
});

Deno.test("connect adopts the spec plane and reports it SEPARATELY from the architecture", () => {
  const src = source("../save-git-integration/index.ts");
  assert(src.includes('import { SPEC_ANCHOR_PATH, parseSpec, adoptSpecAnchor }'));
  // R3-6 once widened the response with branchDetect; V3 AD.2b retired it. The
  // separateness claim is the same.
  assert(src.includes("anchorAdopt, specAdopt, primaryBranch:") && !src.includes("branchDetect"),
    '"nodes came in but requirements did not" must be readable, not inferred');
  // Runs regardless of which architecture branch was taken — "does this project
  // have requirements?" is a separate question from "does its graph match?".
  assert(src.includes("liveNodeIds: null,"), "the adopted graph is still a pending proposal at this point");
});

Deno.test("loadSpecPlane translates mapping row uuids back to REQ ids", async () => {
  const fake = new FakeSupabase();
  fake.script("project_specifications", "select", {
    data: { id: "spec-1", vision: "v", constraints: [], preferences: {} },
  });
  fake.script("specification_requirements", "select", {
    data: [{ id: "row-1", requirement_id: "REQ-001", name: "First", acceptance_criteria: [] }],
  });
  fake.script("specification_mappings", "select", {
    data: [
      { requirement_id: "row-1", node_id: "node-a", mapping_type: "validates" },
      { requirement_id: "row-missing", node_id: "node-z", mapping_type: "implements" },
    ],
  });
  const plane = await loadSpecPlane(fake, "p1");
  assert(plane, "expected a spec plane");
  assertEquals(plane.mappings, [{ requirementId: "REQ-001", nodeId: "node-a", mappingType: "validates" }]);
});

// ── Dropped columns (live-caught by the SB-4 harness, twice) ──────────────────
// project_specifications.features was dropped by migration 20260625154151 and
// specification_requirements.priority by 20260126015837, but the spec plane kept
// selecting/writing BOTH — and swallowed the resulting query errors as "project
// has no spec" — silently disabling R7a–R7d on every migrated database while
// this suite passed against fixtures that modeled the phantom columns. These
// pins make both halves impossible to reintroduce quietly.

Deno.test("loadSpecPlane never touches the dropped features/priority columns and surfaces query errors", () => {
  const src = source("../_shared/spec-anchor.ts");
  const start = src.indexOf("export async function loadSpecPlane");
  const block = src.slice(start, src.indexOf("\n}", start));
  assert(!block.includes("features"), "the features column no longer exists (migration 20260625154151)");
  assert(!/select\([^)]*priority/.test(block), "the priority column no longer exists (migration 20260126015837)");
  assert(block.includes("error: specErr"), "the spec query error must be read…");
  assert(block.includes("if (specErr) throw"), "…and thrown — a failed query must NEVER read as 'no spec'");
  assert(block.includes("if (reqRes.error) throw") && block.includes("if (mapRes.error) throw"),
    "the requirements/mappings queries must throw too — an error there must never serialize as an EMPTY spec plane");
});

Deno.test("a failed spec query THROWS instead of reading as 'project has no spec'", async () => {
  const fake = new FakeSupabase();
  fake.script("project_specifications", "select", {
    data: null,
    error: { message: "column project_specifications.features does not exist", code: "42703" },
  });
  let threw = false;
  try {
    await loadSpecPlane(fake, "p1");
  } catch (e) {
    threw = true;
    assert(String(e).includes("does not exist"), "the real DB error must surface in the message");
  }
  assert(threw, "silence here is what hid the schema drift — it must throw");
});

Deno.test("a failed REQUIREMENTS query throws too — never an empty-but-valid spec plane", async () => {
  const fake = new FakeSupabase();
  fake.script("project_specifications", "select", {
    data: { id: "spec-1", vision: "v", constraints: [], preferences: {} },
  });
  fake.script("specification_requirements", "select", {
    data: null,
    error: { message: "Could not find the 'priority' column of 'specification_requirements' in the schema cache", code: "PGRST204" },
  });
  fake.script("specification_mappings", "select", { data: [] });
  let threw = false;
  try {
    await loadSpecPlane(fake, "p1");
  } catch (e) {
    threw = true;
    assert(String(e).includes("priority"), "the real DB error must surface in the message");
  }
  assert(threw, "an empty requirements list from a FAILED query would push a spec.json that erases every requirement");
});

Deno.test("spec.json requirements carry NO priority key (column dropped, 20260126015837)", async () => {
  const fresh = await serializeSpec(SPEC, REQS, MAPS);
  assert(!fresh.includes('"priority"'), "priority was removed from requirements — never re-emit it");
});

Deno.test("new spec.json files carry NO features key; LEGACY files still verify (shim)", async () => {
  const fresh = await serializeSpec(SPEC, REQS, MAPS);
  assert(!fresh.includes('"features"'), "the Features portion of the spec was removed — never re-emit it");

  // Rebuild a pre-removal file exactly as the old serializer hashed it:
  // `features` participated in the hashed content. Such files must verify clean
  // (never "hash-failed" on adopt) with the key simply ignored downstream.
  const sha256Hex = async (s: string) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
  const legacyContent = {
    vision: "old project",
    features: [{ id: "F1", name: "Login" }],
    constraints: ["must run offline"],
    preferences: { style: "terse" },
    requirements: [],
    mappings: [],
  };
  const legacy = {
    specVersion: SPEC_ANCHOR_VERSION,
    generatedBy: "nodespec",
    specHash: await sha256Hex(stableSerialize(legacyContent)),
    ...legacyContent,
  };
  const p = parseSpec(JSON.stringify(legacy));
  assert(p.ok, "legacy files must still parse");
  assert(await verifySpecHash((p as { ok: true; spec: SpecAnchor }).spec),
    "legacy hash must verify — the shim hashes the shape the file actually has (R7d precedent)");
});

// ── R7c: spec drift lane ──────────────────────────────────────────────────────

import { diffSpecs, capSpecDiff, applySpecAnchor } from "../_shared/spec-anchor.ts";
import { classifySweepFiles, decideBranchFreshness, cardFlaggedPlanes, cardFullyAnswered } from "../_shared/git-drift.ts";

const specOf = async (
  reqs: Array<{ requirement_id: string; name?: string; acceptance_criteria?: unknown }>,
  vision = "v",
  maps: SpecMappingInput[] = [],
) => {
  const p = parseSpec(await serializeSpec({ vision }, reqs, maps));
  assert(p.ok, "fixture parses");
  return (p as { ok: true; spec: SpecAnchor }).spec;
};

Deno.test("diffSpecs reads as 'what LOADING the repo would do to your spec'", async () => {
  const ours = await specOf([
    { requirement_id: "REQ-001", name: "Kept", acceptance_criteria: ["a"] },
    { requirement_id: "REQ-002", name: "Only ours" },
  ]);
  const theirs = await specOf([
    { requirement_id: "REQ-001", name: "Kept", acceptance_criteria: ["a", "b"] },
    { requirement_id: "REQ-003", name: "Only theirs" },
  ]);
  const d = diffSpecs(ours, theirs);
  assert(!d.identical);
  assertEquals(d.requirements.added.map((e) => e.requirementId), ["REQ-003"]);
  assertEquals(d.requirements.removed.map((e) => e.requirementId), ["REQ-002"]);
  assertEquals(d.requirements.changed.map((e) => e.requirementId), ["REQ-001"]);
  assertEquals(d.criteria.added, ["REQ-001: b"]);
});

Deno.test("an identical spec is identical — a no-op load raises nothing", async () => {
  const a = await specOf([{ requirement_id: "REQ-001", name: "Same", acceptance_criteria: ["x"] }]);
  const b = await specOf([{ requirement_id: "REQ-001", name: "Same", acceptance_criteria: ["x"] }]);
  assert(diffSpecs(a, b).identical);
});

Deno.test("vision and mapping moves register as divergence", async () => {
  const a = await specOf([], "old vision");
  const b = await specOf([], "new vision");
  assert(diffSpecs(a, b).visionChanged);
  const m1 = await specOf([{ requirement_id: "REQ-001", name: "R" }], "v", []);
  const m2 = await specOf([{ requirement_id: "REQ-001", name: "R" }], "v", [{ requirementId: "REQ-001", nodeId: "n1" }]);
  assert(diffSpecs(m1, m2).mappingsChanged);
});

Deno.test("capSpecDiff keeps counts honest when the name lists truncate", async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ requirement_id: `REQ-${String(i).padStart(3, "0")}`, name: `R${i}` }));
  const capped = capSpecDiff(diffSpecs(await specOf([]), await specOf(many)), 3);
  assertEquals(capped.requirements.addedCount, 12);
  assertEquals(capped.requirements.added.length, 3);
});

// ── applySpecAnchor ───────────────────────────────────────────────────────────
// The evidence rule (a criterion whose text is unchanged keeps met and whatever
// R5 stamped beside it; an edited one arrives unmet; bare-string criteria read)
// lives in apply_spec_load and is proven in scripts/db-lane/082.

const applyFake = (row: Record<string, unknown> = {}) => new FakeSupabase().script(
  "rpc", "apply_spec_load",
  loadRow({ added: 1, updated: 1, criteriaPreserved: 1, mappingsAdded: 1, mappingsRemoved: 1, keptLocal: ["REQ-001"], locked: ["REQ-007"], ...row }) as never,
);

Deno.test("apply: one call in apply mode; the counts, the kept and the locked come from the database", async () => {
  const fake = applyFake();
  const result = await applySpecAnchor(fake, {
    projectId: "p1", ownerId: "u1", sourceCommit: "sha1",
    spec: await specOf([
      { requirement_id: "REQ-001", name: "Updated name", acceptance_criteria: ["kept criterion", "new criterion"] },
      { requirement_id: "REQ-009", name: "Brand new" },
    ]),
  });
  assert(result.applied, `expected apply, got ${JSON.stringify(result)}`);
  assertEquals(result.counts, { added: 1, updated: 1, criteriaPreserved: 1, mappings: 1, mappingsRemoved: 1 });
  // Non-destructive by design: reported, never deleted.
  assertEquals(result.keptLocal, ["REQ-001"]);
  assertEquals(result.locked, ["REQ-007"]);
  assertEquals(fake.calls.map((c) => `${c.table}.${c.op}`), ["rpc.apply_spec_load"], "nothing is written outside the one call");
  const p = params(fake);
  assertEquals(p.p_mode, "apply");
  assertEquals(p.p_provenance.origin, "spec-anchor-load");
  assertEquals(p.p_requirements.map((r: Params) => r.acceptanceCriteria), [["kept criterion", "new criterion"], []]);
});

Deno.test("apply: without git's spec at the last sync, a load removes no mapping", async () => {
  const fake = applyFake();
  await applySpecAnchor(fake, {
    projectId: "p1", ownerId: "u1",
    spec: await specOf([{ requirement_id: "REQ-001", name: "R" }], "v", [{ requirementId: "REQ-001", nodeId: NODE_A }]),
  });
  assertEquals(params(fake).p_mappings_remove, []);
  assertEquals(params(fake).p_mappings_add, [{ requirementId: "REQ-001", nodeId: NODE_A, mappingType: "implements" }]);
});

Deno.test("apply refuses a tampered spec before touching anything", async () => {
  const spec = await specOf([{ requirement_id: "REQ-001", name: "R" }]);
  spec.vision = "hand-edited";
  const fake = applyFake();
  const result = await applySpecAnchor(fake, { projectId: "p1", ownerId: "u1", spec });
  assert(!result.applied, "refused");
  assertEquals((result as { reason: string }).reason, "hash-failed");
  assertEquals(loads(fake).length, 0);
});

Deno.test("apply on a project without a spec says so", async () => {
  const fake = adoptFake({ data: { ok: false, reason: "no-spec" }, error: null });
  const result = await applySpecAnchor(fake, { projectId: "p1", ownerId: "u1", spec: await specOf([]) });
  assert(!result.applied, "refused");
  assertEquals((result as { reason: string }).reason, "no-spec");
});

// ── Sweep integration ─────────────────────────────────────────────────────────

Deno.test("classifySweepFiles reports the spec plane separately from the model", () => {
  const r = classifySweepFiles(
    [{ path: ".nodespec/spec.json", action: "modified" }, { path: "src/a.ts", action: "modified" }],
    new Set(["src/a.ts"]),
  );
  assertEquals(r.specChanged, true);
  assertEquals(r.modelChanged, false);
  assertEquals(r.residuePaths, [], "the anchor dir is never bindable residue");
});

// The merge-swallow failure mode, one plane over.
Deno.test("a divergent spec BLOCKS both auto lanes — no baseline may advance past it", () => {
  const base = {
    refDeleted: false, refMoved: true, modelChanged: true,
    canvasMatchesHead: true, canvasMatchesBaseline: true,
    matchedArtifactCount: 0, residueCount: 0, userInitiated: true,
  };
  assertEquals(decideBranchFreshness(base), "baseline-fast-forward", "precondition: it would fast-forward");
  assertEquals(
    decideBranchFreshness({ ...base, specDivergent: true }), "card",
    "the requirements moved — advancing would swallow them exactly like the merge-swallow bug",
  );
  assertEquals(
    decideBranchFreshness({ ...base, canvasMatchesHead: false, specDivergent: true }), "card",
    "auto-restore loads the MODEL and says nothing about requirements",
  );
});

Deno.test("specDivergent does not disturb the ladder when the spec is unchanged", () => {
  const base = {
    refDeleted: false, refMoved: true, modelChanged: true,
    canvasMatchesHead: true, canvasMatchesBaseline: false,
    matchedArtifactCount: 0, residueCount: 0, userInitiated: false,
  };
  assertEquals(decideBranchFreshness({ ...base, specDivergent: false }), "baseline-fast-forward");
});

// ── Plane-aware card resolution ───────────────────────────────────────────────

Deno.test("a card flagging BOTH planes is not resolved by loading only one", () => {
  const both = { source: "sweep", modelChanged: true, specChanged: true };
  assertEquals(cardFlaggedPlanes(both), ["model", "spec"]);
  assert(!cardFullyAnswered(both, ["model"]), "the requirements question is still live");
  assert(!cardFullyAnswered(both, ["spec"]), "the architecture question is still live");
  assert(cardFullyAnswered(both, ["model", "spec"]));
});

Deno.test("legacy cards (no specChanged) behave exactly as before — model load resolves them", () => {
  assertEquals(cardFlaggedPlanes({ source: "sweep", modelChanged: true }), ["model"]);
  assert(cardFullyAnswered({ source: "sweep", modelChanged: true }, ["model"]));
  // connect-anchor-mismatch cards predate modelChanged entirely.
  assert(cardFullyAnswered({ source: "connect-anchor-mismatch" }, ["model"]));
});

Deno.test("a spec-ONLY card is resolved by a spec load alone", () => {
  const specOnly = { source: "sweep", modelChanged: false, specChanged: true };
  assertEquals(cardFlaggedPlanes(specOnly), ["spec"]);
  assert(cardFullyAnswered(specOnly, ["spec"]));
});

// ── R3-3d: 'main' hardcode hygiene ────────────────────────────────────────────
// The banked census named four true drift risks. Two are pure and pinned here;
// the third (client seeding 'main' for a master-default repo) is now caught
// server-side at Save; the fourth (MCP main-only snapshot reads) was assessed and
// deliberately left alone — see the V2_TASKS entry.

import { resolveWebhookBranchName } from "../_shared/git-drift.ts";

Deno.test("R3-3d: a bound ref always wins, whatever the default branch is", () => {
  const rows = [{ name: "main", git_ref: "master" }, { name: "feature-x", git_ref: "feature-x" }];
  assertEquals(resolveWebhookBranchName("master", "master", rows), "main");
  assertEquals(resolveWebhookBranchName("feature-x", "master", rows), "feature-x");
});

Deno.test("R3-3d: the unbound fallback never invents a branch that isn't there", () => {
  // No rows → nothing to map to (the old code returned the literal "main").
  assertEquals(resolveWebhookBranchName("master", "master", []), null);
  // main bound elsewhere → claiming the default ref would stamp one branch's sha
  // onto another's baseline.
  assertEquals(resolveWebhookBranchName("master", "master", [{ name: "main", git_ref: "trunk" }]), null);
  // Genuinely unbound main → the default ref does read as main.
  assertEquals(resolveWebhookBranchName("master", "master", [{ name: "main", git_ref: null }]), "main");
});

Deno.test("R3-3d: an unknown default branch is unmapped, never guessed as 'main'", () => {
  const rows = [{ name: "main", git_ref: null }];
  assertEquals(resolveWebhookBranchName("master", null, rows), null);
  assertEquals(resolveWebhookBranchName("master", undefined, rows), null);
  assertEquals(resolveWebhookBranchName("master", "", rows), null);
});

Deno.test("R3-3d: the webhook passes default_branch through instead of guessing", () => {
  const src = source("../git-webhook/handlers.ts");
  assert(!src.includes('integration.default_branch ?? "main"'), "the guess is gone");
  assert(src.includes("integration.default_branch,"), "the real value is passed through");
});

Deno.test("R3-3d: Save refuses to bind a ref the repository does not have", () => {
  const src = source("../save-git-integration/index.ts");
  assert(src.includes("providerDefaultBranch"), "the repo probe's default branch is captured");
  assert(src.includes("does not exist in"), "the rejection names the branch");
  assert(src.includes('use "Detect branches" to pick it'), "…and how to fix it");
  // A rejection, never a silent auto-correction: quietly rewriting the user's
  // branch choice is how a project ends up synced against a ref it never chose.
  assert(!src.includes("defaultBranch = providerDefaultBranch"), "never silently rewritten");
});

// ── R4: auto-push on accept — the commit-subject trap ─────────────────────────

Deno.test("R4: a custom commit subject NEVER loses the self-push prefix", () => {
  const src = source("../git-push/index.ts");
  // The prefix is prepended server-side in BOTH branches. If a caller could supply
  // a bare message, NodeSpec would read its own commit as out-of-band drift: the
  // webhook skip, the sweep fast-forward and the merge-arrival detector all key on
  // this prefix.
  assert(src.includes("`${SELF_PUSH_PREFIX} ${reasonText}`"), "custom subject is prefixed");
  // AD.1: the default subject counts the files the push actually writes.
  assert(
    src.includes("`${SELF_PUSH_PREFIX} ${fileCount} files from ${branchName}`"),
    "the default subject is unchanged",
  );
  // Precise, not a substring: `commitMessage = reasonText` legitimately contains
  // "commitMessage = reason". What must never appear is the raw request field
  // becoming the message.
  assert(!/commitMessage\s*=\s*reason;/.test(src), "the caller's text is never the whole message");
  assert(!/commitMessage\s*=\s*reasonText;/.test(src), "…not even after normalization");
});

Deno.test("R4: the commit subject is bounded and single-line", () => {
  const src = source("../git-push/index.ts");
  // A multi-line or unbounded subject would corrupt the commit-message matching
  // every self-push lane does on the FIRST line.
  assert(src.includes('replace(/\\s+/g, " ")'), "newlines collapse to spaces");
  assert(src.includes(".slice(0, 120)"), "bounded");
});

Deno.test("R4 loop stitching: status surfaces unreconciled changes and points at them FIRST", () => {
  const src = source("../mcp-server/tools/projects.ts");
  assert(src.includes("pendingRepositoryChanges"), "the count is in the response");
  assert(src.includes("Call get_pending_changes FIRST"), "the next action directs the AI at it");
  assert(
    src.includes("Reconcile before proposing further design work"),
    "…and says why — building on an unreconciled change is what makes the two sides diverge",
  );
});

// ── R3-6: second-project branch safety ────────────────────────────────────────
// Owner bench 2026-07-31: "create a new project and connect to the same repo —
// the branches do not detect. When I create a new branch in the new project…
// it wants to push to main."

Deno.test("R3-6: an unbound non-main branch NEVER pushes to the repository default", () => {
  const src = source("../git-push/index.ts");
  // The self-heal exists…
  assert(src.includes("if (!branch.git_ref && !isPrimaryRow({ ...branch, name: branchName }))"), "the unbound-branch lane exists");
  assert(src.includes("Refusing to push to the repository default instead."),
    "…and failure REFUSES rather than falling back");
  // …binds what it created before pushing…
  assert(src.includes("targetRef = branchName;"), "the push targets the ref it just created");
  assert(src.includes("branch.last_synced_commit = created.sha;"),
    "the in-memory row stays coherent for the overwrite guard below");
  // …and runs BEFORE the unbaselined-push guard, so the guard evaluates the REAL ref.
  const heal = src.indexOf("if (!branch.git_ref && !isPrimaryRow({ ...branch, name: branchName }))");
  const guard = src.indexOf("R2.2 PUSH OVERWRITE GUARD");
  assert(heal > 0 && guard > heal, "self-heal precedes the overwrite guard");
});

Deno.test("R3-6: main keeps its default-ref fallback (connect binds it anyway)", () => {
  const src = source("../git-push/index.ts");
  assert(src.includes("let targetRef = branch.git_ref || integration.default_branch;"),
    "the fallback line survives for main");
});

Deno.test("V3 AD.2b: connect materializes no design branch from the repository (R3-6 detection retired)", () => {
  const save = source("../save-git-integration/index.ts");
  assert(!save.includes("detectRepoDesignBranches") && !save.includes("listRemoteBranchNames"), "no detection at connect");
  const drift = source("../_shared/git-drift.ts");
  assert(!drift.includes("export async function detectRepoDesignBranches("), "the detector is gone");
});

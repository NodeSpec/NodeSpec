// B1 (docs/WORK_LOOP_PLAN.md): the `.nodespec/bindings.json` declaration
// contract. Doctrine mirrors every other ingestion lane in this project:
// tolerant of absence, literal about content, and LOUD about anything it
// cannot resolve — a declaration that fails must be visible, never inferred
// away, or the AI never learns it failed.
import {
  parseBindingManifest,
  resolveBindings,
  renderBindingManifest,
  summarizeBindings,
  BINDINGS_PATH,
  BINDINGS_VERSION,
} from "../_shared/binding-manifest.ts";
import { assert, assertEquals, FakeSupabase } from "./helpers.ts";

const NODE_API = "11111111-1111-4111-8111-111111111111";
const NODE_DB = "22222222-2222-4222-8222-222222222222";
const NODE_DUP_A = "33333333-3333-4333-8333-333333333333";
const NODE_DUP_B = "44444444-4444-4444-8444-444444444444";

const graph = {
  nodes: {
    [NODE_API]: { id: NODE_API, label: "API Service" },
    [NODE_DB]: { id: NODE_DB, label: "Database" },
    [NODE_DUP_A]: { id: NODE_DUP_A, label: "Worker" },
    [NODE_DUP_B]: { id: NODE_DUP_B, label: "Worker" },
  },
  artifacts: {
    a1: { path: "src/api/index.ts" },
  },
};

// ── parse ─────────────────────────────────────────────────────────────────────

Deno.test("B1: an absent or empty declaration file is the normal state, not an error", () => {
  for (const input of [null, undefined, "", "   "]) {
    assertEquals(parseBindingManifest(input), { entries: [], flagged: [] });
  }
});

Deno.test("B1: both the envelope shape and a bare array parse", () => {
  const envelope = parseBindingManifest(JSON.stringify({
    version: BINDINGS_VERSION,
    bindings: [{ path: "src/api/users.ts", node: "API Service", kind: "source" }],
  }));
  assertEquals(envelope.entries.length, 1);
  assertEquals(envelope.flagged, []);

  const bare = parseBindingManifest(JSON.stringify(
    [{ path: "src/api/users.ts", node: "API Service", kind: "source" }],
  ));
  assertEquals(bare.entries, envelope.entries);
});

Deno.test("B1: paths normalize and nodeId is accepted as a synonym for node", () => {
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [
      { path: "./src/a.ts", node: "API Service", kind: "source" },
      { path: "/src/b.ts", nodeId: NODE_API, kind: "source" },
    ],
  }));
  assertEquals(parsed.entries.map((e) => e.path), ["src/a.ts", "src/b.ts"]);
  assertEquals(parsed.entries[1].node, NODE_API);
});

Deno.test("B1: kind defaults to source and an invalid kind is flagged, not coerced", () => {
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [
      { path: "src/a.ts", node: "API Service" },
      { path: "src/b.ts", node: "API Service", kind: "not-a-kind" },
    ],
  }));
  assertEquals(parsed.entries.length, 1);
  assertEquals(parsed.entries[0].kind, "source");
  assertEquals(parsed.flagged[0].reason, "invalid-kind");
});

Deno.test("B1: malformed input is reported, never silently dropped", () => {
  const badJson = parseBindingManifest("{ not json");
  assertEquals(badJson.entries, []);
  assertEquals(badJson.flagged[0].reason, "invalid-json");

  const badShape = parseBindingManifest(JSON.stringify({ version: 1 }));
  assertEquals(badShape.flagged[0].reason, "invalid-shape");

  const badRows = parseBindingManifest(JSON.stringify({
    bindings: ["a string", { node: "API Service" }, { path: "src/x.ts" }],
  }));
  assertEquals(badRows.entries, []);
  assertEquals(
    badRows.flagged.map((f) => f.reason),
    ["invalid-entry", "missing-path", "missing-node"],
  );
});

Deno.test("B1: a declaration may not escape the repo or claim NodeSpec's own files", () => {
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [
      { path: "../../etc/passwd", node: "API Service", kind: "source" },
      { path: ".nodespec/model.json", node: "API Service", kind: "doc" },
      { path: ".nodespec/tasks/api.task.md", node: "API Service", kind: "task" },
      { path: "src/ok.ts", node: "API Service", kind: "source" },
    ],
  }));
  assertEquals(parsed.entries.map((e) => e.path), ["src/ok.ts"]);
  assertEquals(
    parsed.flagged.map((f) => f.reason),
    ["path-escape", "reserved-path", "reserved-path"],
  );
});

Deno.test("B1: duplicate paths keep the first and flag the rest", () => {
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [
      { path: "src/a.ts", node: "API Service", kind: "source" },
      { path: "src/a.ts", node: "Database", kind: "source" },
    ],
  }));
  assertEquals(parsed.entries.length, 1);
  assertEquals(parsed.entries[0].node, "API Service");
  assertEquals(parsed.flagged[0].reason, "duplicate-path");
});

Deno.test("B1: the entry cap is enforced and reported", () => {
  const many = Array.from({ length: 600 }, (_, i) => ({
    path: `src/f${i}.ts`, node: "API Service", kind: "source",
  }));
  const parsed = parseBindingManifest(JSON.stringify({ bindings: many }));
  assertEquals(parsed.entries.length, 500);
  assert(parsed.flagged.some((f) => f.reason === "too-many-entries"));
});

// ── resolve ───────────────────────────────────────────────────────────────────

Deno.test("B1: declarations resolve by node id and by label", () => {
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [
      { path: "src/by-label.ts", node: "API Service", kind: "source" },
      { path: "src/by-id.ts", node: NODE_DB, kind: "source" },
      { path: "src/case.ts", node: "api service", kind: "source" },
    ],
  }));
  const resolved = resolveBindings(parsed, graph);
  assertEquals(resolved.flagged, []);
  assertEquals(resolved.bind.map((b) => b.nodeId), [NODE_API, NODE_DB, NODE_API]);
});

Deno.test("B1: an unknown node is flagged — declarations never author architecture", () => {
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [{ path: "src/x.ts", node: "Cache Layer", kind: "source" }],
  }));
  const resolved = resolveBindings(parsed, graph);
  assertEquals(resolved.bind, []);
  assertEquals(resolved.flagged[0].reason, "unknown-node");
});

Deno.test("B1: an ambiguous label is flagged rather than guessed", () => {
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [{ path: "src/w.ts", node: "Worker", kind: "source" }],
  }));
  const resolved = resolveBindings(parsed, graph);
  assertEquals(resolved.bind, []);
  assertEquals(resolved.flagged[0].reason, "ambiguous-node");
  assert(resolved.flagged[0].detail.includes("declare the node id"));
});

Deno.test("B1: an already-bound path is a completed hand-off, not a rebinding", () => {
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [{ path: "src/api/index.ts", node: "Database", kind: "source" }],
  }));
  const resolved = resolveBindings(parsed, graph);
  assertEquals(resolved.bind, [], "must not re-point a bound file at another node");
  assertEquals(resolved.alreadyBound.length, 1);
  assertEquals(resolved.flagged, []);
});

Deno.test("B1: parse flags survive into the resolution for the card", () => {
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [{ path: "src/a.ts", node: "API Service", kind: "bogus" }],
  }));
  const resolved = resolveBindings(parsed, graph);
  assertEquals(resolved.flagged.length, 1);
  assertEquals(resolved.flagged[0].reason, "invalid-kind");
});

// ── render ────────────────────────────────────────────────────────────────────

Deno.test("B1: rendering round-trips through the parser and carries its own guidance", () => {
  const rendered = renderBindingManifest([
    { path: "src/a.ts", node: "API Service", kind: "source", language: "typescript" },
  ]);
  const reparsed = parseBindingManifest(rendered);
  assertEquals(reparsed.flagged, []);
  assertEquals(reparsed.entries.length, 1);
  assertEquals(reparsed.entries[0].language, "typescript");
  assert(rendered.includes("Declare files you create"), "self-documenting note missing");
  assert(rendered.endsWith("\n"), "file must end with a newline");
});

Deno.test("B1: an emptied queue renders a valid empty envelope, not a deleted file", () => {
  const rendered = renderBindingManifest([]);
  const reparsed = parseBindingManifest(rendered);
  assertEquals(reparsed, { entries: [], flagged: [] });
  assert(rendered.includes(`"version": ${BINDINGS_VERSION}`));
});

Deno.test("B1: the contract path is the documented one", () => {
  assertEquals(BINDINGS_PATH, ".nodespec/bindings.json");
});

Deno.test("B1: summary names each outcome separately", () => {
  const summary = summarizeBindings({
    bind: [{ path: "a", node: "n", kind: "source", nodeId: NODE_API }],
    alreadyBound: [{ path: "b", node: "n", kind: "source" }],
    flagged: [{ reason: "unknown-node", detail: "c" }],
  });
  assert(summary.includes("1 file(s) declared for binding"), summary);
  assert(summary.includes("1 already bound"), summary);
  assert(summary.includes("1 declaration issue(s)"), summary);
});

// ── B1 review round (owner-requested quality pass before bench) ───────────────

Deno.test("B1 review: generator-owned kinds are NOT declarable — evidence lanes stay closed", () => {
  // task/test-plan artifacts feed the R5/A4 checkbox-evidence parsers; a
  // declaration minting one would let a hand-authored file's checkboxes read
  // as criterion/task evidence. The skill documents six declarable kinds and
  // the parser must refuse exactly what the skill promises.
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [
      { path: "docs/notes.task.md", node: "API Service", kind: "task" },
      { path: "docs/plan.tests.md", node: "API Service", kind: "test-plan" },
      { path: "src/ok.ts", node: "API Service", kind: "source" },
    ],
  }));
  assertEquals(parsed.entries.map((e) => e.path), ["src/ok.ts"]);
  assertEquals(parsed.flagged.length, 2);
  assert(parsed.flagged.every((f) => f.reason === "invalid-kind"));
  assert(!parsed.flagged[0].detail.includes('"task", '), "task must not be advertised as declarable");
});

Deno.test("B1 review: '..' escape check is per-segment — dotted filenames are legal", () => {
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [
      { path: "src/foo..bar.ts", node: "API Service", kind: "source" },
      { path: "src/../../etc/passwd", node: "API Service", kind: "source" },
    ],
  }));
  assertEquals(parsed.entries.map((e) => e.path), ["src/foo..bar.ts"]);
  assertEquals(parsed.flagged, [{ reason: "path-escape", detail: "src/../../etc/passwd" }]);
});

Deno.test("B1 review: skills and parser agree on the declarable-kind list", async () => {
  // The skills' documented list is the contract users see; keep BOTH product
  // skills lockstep with DECLARABLE_KINDS so neither side drifts silently.
  for (const dir of ["nodespec-developer", "nodespec-oss-developer"]) {
    const skill = await Deno.readTextFile(
      new URL(`../../../skills/${dir}/SKILL.md`, import.meta.url),
    );
    assert(
      skill.includes("`kind` is one of source, schema, doc,\nconfig, build, design") ||
      skill.includes("kind is one of source, schema, doc"),
      `${dir} must document the six declarable kinds`,
    );
  }
  const { DECLARABLE_KINDS } = await import("../_shared/binding-manifest.ts");
  assertEquals([...DECLARABLE_KINDS].sort(), ["build", "config", "design", "doc", "schema", "source"]);
});

// ── B3: consumption (docs/WORK_LOOP_PLAN.md) ─────────────────────────────────

Deno.test("B3: computeRemainingBindings — only paths the pushed graph binds leave the file", async () => {
  const { computeRemainingBindings } = await import("../_shared/binding-manifest.ts");
  const parsed = parseBindingManifest(JSON.stringify({
    bindings: [
      { path: "src/consumed.ts", node: "API Service", kind: "source" },
      { path: "src/waiting.ts", node: "API Service", kind: "source" },
    ],
  }));
  const { remaining, consumed } = computeRemainingBindings(parsed, new Set(["src/consumed.ts"]));
  assertEquals(consumed.map((e) => e.path), ["src/consumed.ts"]);
  assertEquals(remaining.map((e) => e.path), ["src/waiting.ts"],
    "an unconsumed declaration must NEVER leave the file — bind-then-clear");
});

Deno.test("B3: git-push skips the rewrite when the parse flagged rows (never silently delete)", () => {
  const src = Deno.readTextFileSync(new URL("../git-push/index.ts", import.meta.url));
  assert(src.includes("parsedBindings.flagged.length === 0"),
    "a rewrite with flagged rows would delete a malformed row before its author saw the flag");
  assert(src.includes("consumed.length > 0"), "no-op pushes must not churn the file");
  assert(/bindings cleanup skipped \(push continues\)/.test(src), "the clearing block must never fail a push");
});

Deno.test("B3: computeSweepBindingResolution resolves against the branch snapshot, read-only", async () => {
  const { computeSweepBindingResolution } = await import("../_shared/binding-sweep.ts");
  const fake = new FakeSupabase();
  fake.script("branches", "select", { data: { id: "b1" }, error: null });
  fake.script("graph_snapshots", "select", {
    data: {
      graph_data: {
        nodes: { [NODE_API]: { id: NODE_API, label: "API Service" } },
        artifacts: { a1: { path: "src/api/index.ts" } },
      },
    },
    error: null,
  });

  const resolution = await computeSweepBindingResolution(fake, "proj-1", {
    integration: { provider: "github", repo_owner: "o", repo_name: "r" },
    apiBase: "https://api.github.com", token: "t", ref: "main", branchName: "main",
    fetchFile: () => Promise.resolve(JSON.stringify({
      bindings: [
        { path: "src/new-file.ts", node: "API Service", kind: "source" },
        { path: "src/api/index.ts", node: "API Service", kind: "source" },
        { path: "src/mystery.ts", node: "Nonexistent", kind: "source" },
      ],
    })),
  });

  assert(resolution !== null);
  assertEquals(resolution!.bind.map((b) => b.path), ["src/new-file.ts"]);
  assertEquals(resolution!.bind[0].nodeId, NODE_API);
  assertEquals(resolution!.alreadyBound.map((b) => b.path), ["src/api/index.ts"]);
  assertEquals(resolution!.flagged[0].reason, "unknown-node");
  // READ-ONLY: computing a resolution must write nothing.
  assert(fake.calls.every((c) => c.op === "select"), "binding resolution must never write");
});

Deno.test("B3: absent declaration file or missing snapshot resolves to null (nothing to report)", async () => {
  const { computeSweepBindingResolution } = await import("../_shared/binding-sweep.ts");
  const absent = await computeSweepBindingResolution(new FakeSupabase(), "proj-1", {
    integration: { provider: "github", repo_owner: "o", repo_name: "r" },
    apiBase: "x", token: "t", ref: "main", branchName: "main",
    fetchFile: () => Promise.resolve(null),
  });
  assertEquals(absent, null);

  const noSnapshot = new FakeSupabase();
  noSnapshot.script("branches", "select", { data: { id: "b1" }, error: null });
  noSnapshot.script("graph_snapshots", "select", { data: null, error: null });
  const waiting = await computeSweepBindingResolution(noSnapshot, "proj-1", {
    integration: { provider: "github", repo_owner: "o", repo_name: "r" },
    apiBase: "x", token: "t", ref: "main", branchName: "main",
    fetchFile: () => Promise.resolve(JSON.stringify({ bindings: [{ path: "a.ts", node: "X", kind: "source" }] })),
  });
  assertEquals(waiting, null, "no snapshot -> declarations simply wait; no report");
});

Deno.test("B3: both card producers attach bindingResolution best-effort in the same shape", () => {
  const webhook = Deno.readTextFileSync(new URL("../git-webhook/handlers.ts", import.meta.url));
  const drift = Deno.readTextFileSync(new URL("../_shared/git-drift.ts", import.meta.url));
  for (const [name, src] of [["webhook", webhook], ["sweep", drift]] as const) {
    assert(src.includes("...(bindingResolution ? { bindingResolution } : {})"),
      `${name} must attach the resolution conditionally`);
    assert(/try\s*\{[\s\S]{0,400}BindingResolution[\s\S]{0,600}catch/.test(src) ||
      /catch \(bindErr\)/.test(src),
      `${name} resolution must be best-effort — a failure never drops the card`);
  }
  // The B2 clobber rule: the server side of B3 computes and reports only.
  const sweepModule = Deno.readTextFileSync(new URL("../_shared/binding-sweep.ts", import.meta.url));
  assert(!sweepModule.includes("insert") && !sweepModule.includes("update") && !sweepModule.includes("upsert"),
    "binding-sweep must be read-only");
});

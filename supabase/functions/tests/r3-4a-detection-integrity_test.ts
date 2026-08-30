// R3-4a: detection integrity for out-of-band changes.
// Pin 1: matchFilesToArtifacts matches against the SWEPT branch's snapshot, not
//        main's (the R3-3c branch-scoped sweep had still matched a feature branch's
//        files against main's artifacts — wrong matches / false residue).
// Pin 2: resolveWebhookBranchName — a webhook names a git ref, not a NodeSpec
//        branch; bound git_ref wins, default branch reads as main, anything else
//        is UNMAPPED (null) and must never advance a baseline.
import { assert, assertEquals, FakeSupabase } from "./helpers.ts";
import { matchFilesToArtifacts, resolveWebhookBranchName } from "../_shared/git-drift.ts";

const PROJECT = "aaaaaaaa-0000-4000-8000-000000000001";

Deno.test("matchFilesToArtifacts queries the branch it was given and matches its artifacts", async () => {
  const sb = new FakeSupabase();
  sb.script("branches", "select", { data: { id: "branch-feature" }, error: null });
  sb.script("graph_snapshots", "select", {
    data: {
      graph_data: {
        nodes: { n1: { id: "n1", label: "Api" } },
        artifacts: { a1: { id: "a1", nodeId: "n1", path: "src/feature-only.ts" } },
      },
    },
    error: null,
  });

  const result = await matchFilesToArtifacts(sb, PROJECT, [
    { path: "src/feature-only.ts", action: "modified" },
  ], "feature-x");

  const branchCall = sb.callsTo("branches", "select")[0];
  const nameFilter = branchCall.filters.find((f) => f.method === "eq" && f.args[0] === "name");
  assertEquals(nameFilter?.args[1], "feature-x", "branch lookup uses the swept branch, not hardcoded main");

  assertEquals(result.matches.length, 1);
  assertEquals(result.matches[0].artifactId, "a1");
  assertEquals(result.matches[0].nodeName, "Api");
});

Deno.test("matchFilesToArtifacts defaults to main when no branch is given (legacy callers)", async () => {
  const sb = new FakeSupabase();
  sb.script("branches", "select", { data: { id: "branch-main" }, error: null });
  sb.script("graph_snapshots", "select", { data: { graph_data: { nodes: {}, artifacts: {} } }, error: null });

  await matchFilesToArtifacts(sb, PROJECT, [{ path: "x.ts", action: "modified" }]);

  const branchCall = sb.callsTo("branches", "select")[0];
  const nameFilter = branchCall.filters.find((f) => f.method === "eq" && f.args[0] === "name");
  assertEquals(nameFilter?.args[1], "main");
});

Deno.test("resolveWebhookBranchName: bound ref wins, default branch reads as main, else unmapped", () => {
  const rows = [
    { name: "main", git_ref: "trunk" },
    { name: "feature-x", git_ref: "feature-x" },
    { name: "local-only", git_ref: null },
  ];
  // A branch row bound to the pushed ref wins — even over the default-branch rule.
  assertEquals(resolveWebhookBranchName("feature-x", "trunk", rows), "feature-x");
  assertEquals(resolveWebhookBranchName("trunk", "trunk", rows), "main");
  // Pre-binding integrations: main exists but was never bound → the default ref
  // still reads as main.
  assertEquals(resolveWebhookBranchName("trunk", "trunk", [{ name: "main", git_ref: null }]), "main");
  // R3-3d: what the fallback must NOT do any more.
  //  · No branch rows at all → nothing to map to. Returning the literal "main"
  //    sent the caller looking up a row that does not exist.
  assertEquals(resolveWebhookBranchName("trunk", "trunk", []), null);
  //  · main bound to a DIFFERENT ref → claiming the default ref for it would
  //    stamp one branch's sha onto another's baseline (the R3-3c corruption).
  assertEquals(
    resolveWebhookBranchName("trunk", "trunk", [{ name: "main", git_ref: "some-other-ref" }]),
    null,
  );
  //  · An unknown default branch is unmapped, never guessed as "main".
  assertEquals(resolveWebhookBranchName("trunk", null, [{ name: "main", git_ref: null }]), null);
  // A ref nobody is bound to is UNMAPPED — the caller stamps unmappedRef and
  // resolution never advances any baseline.
  assertEquals(resolveWebhookBranchName("random-branch", "trunk", rows), null);
});

Deno.test("resolveWebhookBranchName: a RENAMED primary (owner spike 2026-08-23) maps by binding and falls back by IDENTITY, returning its real name", () => {
  // Connect renamed the trunk to 'develop' and bound it — the bound-ref rule
  // maps the push straight to the renamed row.
  const renamed = [{ name: "develop", git_ref: "develop", is_primary: true }];
  assertEquals(resolveWebhookBranchName("develop", "develop", renamed), "develop");
  // Unbound flagged primary named anything: the default-ref fallback returns
  // the row's REAL name, never the literal "main".
  const unbound = [{ name: "trunk-design", git_ref: null, is_primary: true }];
  assertEquals(resolveWebhookBranchName("trunk", "trunk", unbound), "trunk-design");
  // Flagged data is authoritative: a row named 'main' that is NOT the
  // primary does not catch the default-ref fallback.
  const demoted = [{ name: "main", git_ref: null, is_primary: false }];
  assertEquals(resolveWebhookBranchName("trunk", "trunk", demoted), null);
});

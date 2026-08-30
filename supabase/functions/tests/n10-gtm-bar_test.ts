// N10(b) — the GTM-ready bar, defined ONCE in catalog-schemas so the enrichment
// tracker, the coverage sweep, and the import lane cannot diverge on "done".
// Assessor, not gate: legacy-thin rows keep saving; this measures COMPLETENESS.
import { assert, assertEquals } from "./helpers.ts";
import { assessTechnologyGtmReadiness } from "../_shared/catalog-schemas.ts";

const NOW = "2026-08-09T00:00:00Z";

// deno-lint-ignore no-explicit-any
function readyRow(over: Record<string, unknown> = {}, aiOver: Record<string, unknown> = {}): any {
  return {
    id: "stripe",
    suggested_files: [{ path: "src/lib/stripe.ts" }],
    ai_context: {
      purpose: "Payment processing platform",
      configMode: "code",
      apiReference: { docsUrl: "https://docs.stripe.com" },
      sdkInitPattern: "const stripe = new Stripe(key)",
      bestPractices: ["idempotency keys", "webhook signatures", "test clocks"],
      antiPatterns: ["storing card numbers", "polling for payment state", "skipping webhook verification"],
      securityGuidance: "Never log full card data; verify webhook signatures.",
      provenance: { verifiedAt: "2026-07-01T00:00:00Z", method: "live-docs" },
      ...aiOver,
    },
    ...over,
  };
}

Deno.test("GTM bar: a fully enriched row is ready with zero gaps", () => {
  const r = assessTechnologyGtmReadiness(readyRow(), { now: NOW });
  assertEquals(r.missing, []);
  assertEquals(r.ready, true);
  assertEquals(r.provenanceStatus, "fresh-live-docs");
});

Deno.test("GTM bar: every bar line reports its own named gap", () => {
  const bare = assessTechnologyGtmReadiness({ id: "thin", ai_context: {} }, { now: NOW });
  assertEquals(bare.ready, false);
  const gapText = bare.missing.join("\n");
  for (const expected of ["purpose", "configMode", "apiReference.docsUrl", "sdkInitPattern OR configurationTemplate", "bestPractices", "antiPatterns", "securityGuidance", "provenance"]) {
    assert(gapText.includes(expected), `named gap for ${expected}`);
  }
  assertEquals(bare.provenanceStatus, "unverified");
});

Deno.test("GTM bar: conditional lines — external needs setupInstructions, code-bearing needs suggested_files", () => {
  const external = assessTechnologyGtmReadiness(readyRow({}, { configMode: "external", setupInstructions: undefined }), { now: NOW });
  assert(external.missing.some((m) => m.includes("setupInstructions")), "console-configured with no setup steps");

  const codeNoFiles = assessTechnologyGtmReadiness(readyRow({ suggested_files: [] }), { now: NOW });
  assert(codeNoFiles.missing.some((m) => m.includes("suggested_files")), "code-bearing with no file suggestions");

  // configMode 'none' demands neither conditional line.
  const none = assessTechnologyGtmReadiness(readyRow({ suggested_files: [] }, { configMode: "none" }), { now: NOW });
  assert(!none.missing.some((m) => m.includes("suggested_files") || m.includes("setupInstructions")));
});

Deno.test("GTM bar: counts are real minimums — 2 bestPractices is not 3", () => {
  const r = assessTechnologyGtmReadiness(readyRow({}, { bestPractices: ["a", "b"] }), { now: NOW });
  assert(r.missing.some((m) => m.includes("bestPractices")));
});

Deno.test("GTM bar (N8.1c): top tier requires FRESH live-docs; base tier only presence", () => {
  const staleProv = { verifiedAt: "2025-01-01T00:00:00Z", method: "live-docs" };
  const modelProv = { verifiedAt: "2026-07-01T00:00:00Z", method: "model-knowledge" };

  const baseStale = assessTechnologyGtmReadiness(readyRow({}, { provenance: staleProv }), { now: NOW });
  assertEquals(baseStale.ready, true, "base tier: stale provenance still meets the bar (reported, not gated)");
  assertEquals(baseStale.provenanceStatus, "stale");

  const topStale = assessTechnologyGtmReadiness(readyRow({}, { provenance: staleProv }), { now: NOW, topTier: true });
  assertEquals(topStale.ready, false);
  assert(topStale.missing.some((m) => m.includes("older than")), "top tier: stale verifiedAt is a gap");

  const topModel = assessTechnologyGtmReadiness(readyRow({}, { provenance: modelProv }), { now: NOW, topTier: true });
  assertEquals(topModel.ready, false);
  assert(topModel.missing.some((m) => m.includes("live-docs")), "top tier: model-knowledge is a gap");
  assertEquals(topModel.provenanceStatus, "fresh");
});

Deno.test("GTM bar: deterministic — no `now` means age is unknowable, presence carries", () => {
  const r = assessTechnologyGtmReadiness(readyRow({}, { provenance: { verifiedAt: "2020-01-01T00:00:00Z", method: "live-docs" } }));
  assertEquals(r.provenanceStatus, "fresh-live-docs", "without a clock the assessor never guesses staleness");
});

Deno.test("GTM bar B10: lifecycle exemptions report exempt with zero gaps, active rows unaffected", () => {
  // migrated: a migrationTarget names the successor — exempt regardless of other gaps
  const migrated = assessTechnologyGtmReadiness(
    { id: "torchserve", ai_context: { migrationTarget: "triton" } }, { now: NOW });
  assertEquals(migrated.ready, true);
  assertEquals(migrated.missing, []);
  assertEquals(migrated.exempt, "migrated");

  // retired: no successor, still exempt
  const retired = assessTechnologyGtmReadiness(
    { id: "tecton", ai_context: { lifecycle: "retired" } }, { now: NOW });
  assertEquals(retired.exempt, "retired");
  assertEquals(retired.ready, true);

  // platform umbrella: pending the dedicated platform bar
  const umbrella = assessTechnologyGtmReadiness(
    { id: "aws", ai_context: { lifecycle: "platform-umbrella", provenance: { verifiedAt: "2026-08-10", method: "model-knowledge" } } }, { now: NOW });
  assertEquals(umbrella.exempt, "platform-umbrella");
  assertEquals(umbrella.provenanceStatus, "fresh");

  // an active row (no lifecycle keys) never reports exempt
  const active = assessTechnologyGtmReadiness(readyRow(), { now: NOW });
  assertEquals(active.exempt, undefined);
});

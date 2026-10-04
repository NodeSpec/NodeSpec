// N8.4b-3 — `technology_catalog.common_connections` carries THREE shapes across the live
// catalog: a bare id string, `{targetRole, contractKind}`, and `{id, reason}` (75 rows,
// the plurality). Every reader used to destructure `.targetRole` blindly, so those 75
// rows rendered "-> undefined via undefined" into lookup_catalog: AI-facing text,
// silently wrong.
import { assertEquals } from "./helpers.ts";
import {
  formatCommonConnection,
  normalizeCommonConnections,
} from "../_shared/role-registry.ts";

Deno.test("normalize: all three shapes collapse to {id, reason?}", () => {
  assertEquals(
    normalizeCommonConnections([
      "backend-service",
      { targetRole: "database", contractKind: "sql" },
      { id: "azure-openai-service", reason: "RAG and embedding generation" },
    ]),
    [
      { id: "backend-service" },
      { id: "database", reason: "via sql" },
      { id: "azure-openai-service", reason: "RAG and embedding generation" },
    ],
  );
});

Deno.test("normalize: junk entries are dropped, never emitted as undefined", () => {
  // deno-lint-ignore no-explicit-any
  const junk: any = [null, "", {}, { reason: "orphaned reason" }, "worker"];
  assertEquals(normalizeCommonConnections(junk), [{ id: "worker" }]);
  assertEquals(normalizeCommonConnections(null), []);
  assertEquals(normalizeCommonConnections(undefined), []);
});

Deno.test("format: no 'undefined' ever reaches AI-facing text", () => {
  assertEquals(formatCommonConnection({ id: "queue" }), "queue");
  assertEquals(
    formatCommonConnection({ id: "azure-event-grid", reason: "Delivery event notifications" }),
    "azure-event-grid (Delivery event notifications)",
  );
  const rendered = normalizeCommonConnections([{ id: "a", reason: "b" }, "c"])
    .map(formatCommonConnection)
    .join(", ");
  assertEquals(rendered.includes("undefined"), false);
});

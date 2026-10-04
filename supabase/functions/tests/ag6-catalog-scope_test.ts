// AG.6c and AG.8 (owner 2026-09-28). A custom technology row belongs to one project. The server
// reads the catalog with the service role, which RLS does not narrow, so an import or an
// MCP call could read, and stamp on a node, another project's custom row. The loader now
// takes the projects a read may see and drops every other custom row.
import { loadCatalogs, technologyInScope } from "../_shared/catalog-loader.ts";
import { classifyNodeDeliverable } from "../_shared/task-document-generator.ts";
import { assertEquals, completeRole, FakeSupabase } from "./helpers.ts";

function scripted(): FakeSupabase {
  const sb = new FakeSupabase();
  sb.script("node_roles", "select", { data: [completeRole({ id: "backend-service", nature: "build" })], error: null });
  sb.script("technology_catalog", "select", {
    data: [
      { id: "nodejs", name: "Node.js", role_affinities: ["backend-service"], ai_context: {}, is_user_contributed: false, project_id: null },
      { id: "ours", name: "Ours", role_affinities: ["backend-service"], ai_context: { purpose: "p1's own" }, is_user_contributed: true, project_id: "p1" },
      { id: "theirs", name: "Theirs", role_affinities: ["backend-service"], ai_context: { purpose: "p2's own" }, is_user_contributed: true, project_id: "p2" },
      { id: "nobodys", name: "Nobody's", role_affinities: ["backend-service"], ai_context: {}, is_user_contributed: true, project_id: null },
    ],
    error: null,
  });
  for (const t of ["deployment_targets", "cloud_provider_patterns", "scope_archetypes"]) sb.script(t, "select", { data: [], error: null });
  return sb;
}

Deno.test("AG.6c: a scoped read keeps catalog rows and the listed project's custom rows, and drops every other custom row", async () => {
  const c = await loadCatalogs(scripted() as never, { projectIds: ["p1"] });
  assertEquals(Object.keys(c.technologies).sort(), ["nodejs", "ours"]);
});

Deno.test("AG.6c: a read scoped to no project sees catalog rows only", async () => {
  const c = await loadCatalogs(scripted() as never, { projectIds: [] });
  assertEquals(Object.keys(c.technologies).sort(), ["nodejs"]);
});

Deno.test("AG.6c: an unscoped read (the admin template path) is unchanged", async () => {
  const c = await loadCatalogs(scripted() as never);
  assertEquals(Object.keys(c.technologies).sort(), ["nobodys", "nodejs", "ours", "theirs"]);
});

Deno.test("AG.6c: the scope rule itself", () => {
  const scope = { projectIds: ["p1"] };
  assertEquals(technologyInScope({ is_user_contributed: false, project_id: null }, scope), true);
  assertEquals(technologyInScope({ is_user_contributed: true, project_id: "p1" }, scope), true);
  assertEquals(technologyInScope({ is_user_contributed: true, project_id: "p2" }, scope), false);
  assertEquals(technologyInScope({ is_user_contributed: true, project_id: null }, scope), false);
});

// AG.8: SQLite's row carried configMode `declarative`, so a SQLite node's packet asked for
// provisioning. Without the key it classifies as the code the app writes around it.
Deno.test("AG.8: a database node on SQLite is working code once the row carries no configMode, and was provisioning before", () => {
  const database = { nature: "build", is_container: false, container_style: null };
  const node = { technology: "sqlite" };
  assertEquals(classifyNodeDeliverable(database, { purpose: "An embedded file database." }, node, null), "code");
  assertEquals(classifyNodeDeliverable(database, { purpose: "An embedded file database.", configMode: "declarative" }, node, null), "declarative");
});

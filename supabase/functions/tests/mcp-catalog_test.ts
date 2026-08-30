// N3.6: catalog discovery over MCP — the read lane external AIs never had. Pins: read
// scope required; FTS RPC drives technology results (with nature + configMode + when_to_use
// signals); roles match in-memory with direct-hit ranking; lookup wraps user-contributed
// rows per P0-7; bounds enforced.
import { handleSearchCatalog, handleLookupCatalog } from '../mcp-server/tools/catalog.ts';
import { searchRoles, describeNature } from '../_shared/catalog-search.ts';
import { FakeSupabase, assert, assertEquals, completeRole } from './helpers.ts';

const READ = { userId: 'user-1', scopes: ['read'], authMethod: 'api_key' } as never;

// deno-lint-ignore no-explicit-any
function catalogRows(): { roles: any[]; techs: any[] } {
  return {
    roles: [
      { id: 'data-prep-pipeline', label: 'Data Prep Pipeline', nature: 'build', is_container: false, capability_tags: ['etl'], when_to_use: 'Choose for ETL pipelines that transform raw data', sort_order: 1 },
      { id: 'external-service', label: 'External Service', nature: 'call', is_container: false, capability_tags: [], when_to_use: 'Third-party API you call', sort_order: 2 },
      { id: 'old-role', label: 'Old ETL Role', nature: 'build', is_container: false, capability_tags: ['etl'], when_to_use: null, deprecated: true, sort_order: 3 },
    ],
    techs: [
      { id: 'n8n', name: 'n8n', role_affinities: ['data-prep-pipeline'], ai_context: { summary: 'Workflow automation engine', treatmentOverride: 'boundary', configMode: 'definition-as-code' }, is_user_contributed: false },
      { id: 'user-thing', name: 'User Thing', role_affinities: ['external-service'], ai_context: { purpose: 'Contributed by a user' }, is_user_contributed: true },
    ],
  };
}

// deno-lint-ignore no-explicit-any
function script(sb: FakeSupabase, rpcResult: any) {
  const { roles, techs } = catalogRows();
  sb.script('node_roles', 'select', { data: roles.map(completeRole), error: null });
  sb.script('technology_catalog', 'select', { data: techs, error: null });
  for (const t of ['deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('rpc', 'search_relevant_technologies', rpcResult);
}

Deno.test('search_catalog: read scope required; short query rejected', async () => {
  const sb = new FakeSupabase();
  const noScope = await handleSearchCatalog(sb as never, { userId: 'u', scopes: [], authMethod: 'api_key' } as never, { query: 'workflow' });
  assertEquals(noScope.success, false);
  const short = await handleSearchCatalog(sb as never, READ, { query: 'a' });
  assertEquals(short.success, false);
  assertEquals(sb.callsTo('rpc', 'search_relevant_technologies').length, 0, 'no RPC before validation');
});

Deno.test('search_catalog: technologies via FTS with nature/configMode; roles in-memory with when_to_use', async () => {
  const sb = new FakeSupabase();
  script(sb, { data: [{ tech_id: 'n8n', rank: 0.9 }], error: null });

  const r = await handleSearchCatalog(sb as never, READ, { query: 'etl pipelines' });
  assertEquals(r.success, true);
  const data = r.data as { technologies: Array<Record<string, unknown>>; roles: Array<Record<string, unknown>>; guidance: string };

  // N3.7 enums-first: machine truth leads; prose is demoted to `description`.
  assertEquals(data.technologies[0].id, 'n8n');
  assertEquals(data.technologies[0].treatment, 'boundary', 'effective treatment enum (leaf role + tech override)');
  assertEquals(data.technologies[0].ownership, 'build');
  assertEquals(data.technologies[0].configMode, 'definition-as-code');
  assert(String(data.technologies[0].description).includes('Engine'), 'prose gloss lives under description only');
  assertEquals(data.technologies[0].nature, undefined, 'no co-equal prose field');

  const roleIds = data.roles.map((role) => role.id);
  assert(roleIds.includes('data-prep-pipeline'), 'role matched via capability tag/when_to_use');
  assert(!roleIds.includes('old-role'), 'deprecated roles never surface');
  const prep = data.roles.find((role) => role.id === 'data-prep-pipeline')!;
  assertEquals(prep.treatment, 'leaf');
  assertEquals(prep.ownership, 'build');
  assert(String(prep.whenToUse).includes('ETL'), 'when_to_use reaches the AI at last');
  assert(data.guidance.includes('propose_patches'), 'guidance steers usage');
  assert(data.guidance.includes('boundary = you configure/call it'), 'guidance IS the single enum legend');
  // N3.8: provider-branded services must be parented under their platform node.
  assert(data.guidance.includes('provider platform node'), 'guidance carries the provider-platform containment rule');
});

Deno.test('searchRoles: direct-hit ranking — exact label beats tag match', () => {
  // deno-lint-ignore no-explicit-any
  const catalogs: any = { nodeRoles: Object.fromEntries(catalogRows().roles.map((r) => [r.id, r])) };
  const hits = searchRoles(catalogs, 'external service', 10);
  assertEquals(hits[0].id, 'external-service', 'exact label match first');
});

Deno.test('describeNature: mirrors the client wording for the key shapes', () => {
  const { roles, techs } = catalogRows();
  // deno-lint-ignore no-explicit-any
  const byId: any = Object.fromEntries(roles.map((r) => [r.id, r]));
  assertEquals(describeNature(byId['external-service']), 'External service — you call it, someone else runs it');
  assert(describeNature(byId['data-prep-pipeline'], techs[0]).includes('definition file lives in your repo'));
  assertEquals(describeNature(byId['data-prep-pipeline']), 'Service you build');
});

Deno.test('lookup_catalog: user-contributed technology detail is P0-7 wrapped; curated is not', async () => {
  const sb = new FakeSupabase();
  script(sb, { data: [], error: null });
  const contributed = await handleLookupCatalog(sb as never, READ, { technology_id: 'user-thing' });
  assertEquals(contributed.success, true);
  const cd = contributed.data as { catalog: string; userContributed: boolean };
  assertEquals(cd.userContributed, true);
  assert(cd.catalog.includes('UNTRUSTED') || cd.catalog.includes('untrusted'), 'enveloped');

  const sb2 = new FakeSupabase();
  script(sb2, { data: [], error: null });
  const curated = await handleLookupCatalog(sb2 as never, READ, { technology_id: 'n8n' });
  const kd = curated.data as { catalog: string; userContributed: boolean };
  assertEquals(kd.userContributed, false);
  assert(kd.catalog.includes('n8n'));
});

// N5.12: get_build_readiness — the build preflight (owner direction 2026-07-24: when
// the user asks their AI to build code/config/schema artifacts, the AI must not leave
// them hanging on undefined interface contracts). Pins: every gap kind, the ready path,
// doc staleness by fingerprint hash, dependency-ordered buildOrder, none-deliverable
// exclusion. WS1/WS2 (owner live test 2026-07-31): resolution actions live in ONE
// top-level remediations map keyed by gap kind (gaps never carry resolveWith over
// MCP); unscoped calls default to summary rows; schema blockers carry draftInputs;
// dangling schemaRefs surface as BROKEN, in the doc and the readiness report alike.
import { handleGetBuildReadiness } from '../mcp-server/tools/tasks.ts';
import { generateTaskDocument } from '../_shared/task-document-generator.ts';
import { FakeSupabase, assert, assertEquals, completeRole } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const N_WORKER = '33333333-3333-4333-8333-333333333333';
const N_DB = '44444444-4444-4444-8444-444444444444';
const N_LONELY = '55555555-5555-4555-8555-555555555555';
const N_GHOST = '66666666-6666-4666-8666-666666666666';
const REQ_ROW = '77777777-7777-4777-8777-777777777777';

const READ_AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read'] } as never;

const ROLES = [
  { id: 'backend-service', kind: 'app_service', is_container: false, treatment_mode: 'leaf' },
  // N5.16: hosting container (deliverable) vs logical group (organizational).
  { id: 'vpc-role', kind: 'infrastructure', is_container: true, treatment_mode: 'container' },
  { id: 'group-role', kind: 'logical_group', is_container: true, container_style: 'logical-boundary', treatment_mode: 'container' },
];
const TECHS = [
  { id: 'aws-lambda', name: 'AWS Lambda', role_affinities: ['backend-service'], ai_context: { configMode: 'code' } },
  // WS2: apiReference areas feed schema-gap draftInputs.apiEndpoints (all areas when
  // the counterparty node made no apiAreas selection; filtered when it did).
  { id: 'aws-rds-postgresql', name: 'AWS RDS PostgreSQL', role_affinities: ['backend-service'], ai_context: { configMode: 'declarative', apiReference: { areas: { Query: { endpoints: ['GET /query'] }, Admin: { endpoints: ['POST /admin'] } } } }, metadata_schema: { engineVersion: { type: 'enum', options: ['15', '16'] } } },
  { id: 'express', name: 'Express', role_affinities: ['backend-service'], ai_context: {} },
  { id: 'aws-goodie', name: 'AWS Goodie', role_affinities: ['backend-service'], ai_context: { configMode: 'none' } },
  // N5.14: non-provider tech carrying a declarative configMode — suspicious filing.
  { id: 'oddball', name: 'Oddball', role_affinities: ['backend-service'], ai_context: { configMode: 'declarative' } },
];

// deno-lint-ignore no-explicit-any
function benchGraph(): any {
  return {
    nodes: {
      vpcNode: { id: 'vpcNode', type: 'vpc-role', label: 'Net VPC', ports: [] },
      grpNode: { id: 'grpNode', type: 'group-role', label: 'Grouping', ports: [] },
      [N_WORKER]: { id: N_WORKER, type: 'backend-service', label: 'Heavy Job Worker', technology: 'aws-lambda', parentId: 'vpcNode', ports: [] },
      [N_DB]: { id: N_DB, type: 'backend-service', label: 'Primary Database', technology: 'aws-rds-postgresql', ports: [] },
      [N_LONELY]: { id: N_LONELY, type: 'backend-service', label: 'Lonely Service', technology: 'express', ports: [] },
      [N_GHOST]: { id: N_GHOST, type: 'backend-service', label: 'Account Shell', technology: 'aws-goodie', ports: [] },
      odd1: { id: 'odd1', type: 'backend-service', label: 'Odd Service', technology: 'oddball', ports: [] },
      bare1: { id: 'bare1', type: 'backend-service', label: 'Bare Concept', ports: [] }, // generic role drop — no technology
    },
    edges: { e1: { id: 'e1', source: N_WORKER, target: N_DB, contractId: 'c1' } },
    contracts: { c1: { id: 'c1', name: 'Worker Data Queries', kind: 'sql' } },
    artifacts: {},
  };
}

// deno-lint-ignore no-explicit-any
function script(sb: FakeSupabase, g: any) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: g }, error: null });
  sb.script('node_roles', 'select', { data: ROLES.map(completeRole), error: null });
  sb.script('technology_catalog', 'select', { data: TECHS, error: null });
  for (const t of ['deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: 'Bench' }, error: null });
  sb.script('specification_mappings', 'select', {
    data: [
      { requirement_id: REQ_ROW, node_id: N_WORKER },
      { requirement_id: REQ_ROW, node_id: N_DB },
      // N5.13 (bench AI finding): stale mapping to a node deleted from this branch —
      // must be pruned at read time, never surfacing as a phantom UUID.
      { requirement_id: REQ_ROW, node_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    ],
    error: null,
  });
  sb.script('specification_requirements', 'select', {
    data: [{
      id: REQ_ROW, requirement_id: 'REQ-005', name: 'Dedicated Compute',
      description: 'Background jobs on dedicated compute.', category: 'technical', status: 'in-progress',
      acceptance_criteria: [{ text: 'Compute has no public-facing network path', met: false }],
    }],
    error: null,
  });
}

// deno-lint-ignore no-explicit-any
function entry(data: any, label: string): any {
  // deno-lint-ignore no-explicit-any
  return (data.nodes as any[]).find((n) => n.label === label);
}

Deno.test('get_build_readiness: every gap kind reported; remediations map carries the resolution actions ONCE per kind; buildOrder respects dependencies; none-deliverable excluded', async () => {
  const sb = new FakeSupabase();
  script(sb, benchGraph());

  const r = await handleGetBuildReadiness(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, detail: 'full' });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.detail, 'full');

  const worker = entry(data, 'Heavy Job Worker');
  assert(worker && worker.ready === false, 'worker has blockers');
  // deno-lint-ignore no-explicit-any
  const kinds = (worker.blockers as any[]).map((b) => b.kind);
  assert(kinds.includes('schema'), 'schema blocker for the undefined sql contract');
  // deno-lint-ignore no-explicit-any
  const schemaBlocker = (worker.blockers as any[]).find((b) => b.kind === 'schema');
  assert(schemaBlocker.detail.includes('Worker Data Queries'), 'blocker names the contract');
  // WS1: resolveWith is hoisted — gaps stay lean, the action lives in remediations.
  assert(!('resolveWith' in schemaBlocker), 'gaps never carry resolveWith over MCP');
  assert(data.remediations.schema.includes('update_contract'), 'schema remediation names the patch lane');
  // WS2: the server assembles the draft inputs; the AI drafts.
  const di = schemaBlocker.draftInputs;
  assert(di, 'schema blockers carry draftInputs');
  assertEquals(di.selfTechnology, 'aws-lambda');
  assertEquals(di.counterpartyTechnology, 'aws-rds-postgresql');
  assertEquals(di.suggestedSpecFormat, 'sql_ddl', 'sql contract kind → sql_ddl dialect');
  assert(di.servingCriteria.includes('Compute has no public-facing network path'), 'unmet criteria ride along');
  assertEquals(di.apiEndpoints, ['GET /query', 'POST /admin'], 'no apiAreas selection → all counterparty areas');
  assert(kinds.includes('owner'), 'owner blocker for the shared, unmatched criterion');
  // deno-lint-ignore no-explicit-any
  const ownerBlocker = (worker.blockers as any[]).find((b) => b.kind === 'owner');
  assert(ownerBlocker.detail.includes('Compute has no public-facing network path'), 'blocker cites the criterion');
  assert(data.remediations.owner.includes('map_requirement'), 'owner remediation names the mapping lane');
  // N5.13: phantom mapping pruned + machine-safe node ids alongside the prose.
  assert(!ownerBlocker.detail.includes('dddddddd'), 'deleted-node UUID never surfaces in the blocker');
  assertEquals(ownerBlocker.relatedNodeIds, [N_DB], 'structured sharing-node ids, live nodes only');
  assert(kinds.includes('doc'), 'missing task doc is a blocker');
  assert(data.remediations.doc.includes('generate_task_docs'), 'doc remediation names the tool');

  const db = entry(data, 'Primary Database');
  // deno-lint-ignore no-explicit-any
  assert((db.advisories as any[]).some((a) => a.kind === 'config'), 'schema-bearing tech with no config → advisory');

  const lonely = entry(data, 'Lonely Service');
  // deno-lint-ignore no-explicit-any
  assert((lonely.advisories as any[]).some((a) => a.kind === 'mapping'), 'unmapped node → mapping advisory');

  // N4.7: a code-deliverable node with NO technology bound (generic role drop) gets a
  // technology advisory — packet quality degrades; never rides silently to build.
  const bare = entry(data, 'Bare Concept');
  // deno-lint-ignore no-explicit-any
  const techAdvisory = (bare.advisories as any[]).find((a) => a.kind === 'technology');
  assert(techAdvisory, 'technology-less buildable node → technology advisory');
  assert(data.remediations.technology.includes('search_catalog'), 'technology remediation names the discovery lane');
  // deno-lint-ignore no-explicit-any
  assert(!(entry(data, 'Heavy Job Worker').advisories as any[]).some((a) => a.kind === 'technology'), 'technology-bound node gets no advisory');
  // Absent kinds never get a remediation entry (no test backlog scripted here).
  assert(!('tests' in data.remediations), 'remediations built only for present kinds');

  // N5.14: configMode declarative on a NON-provider technology → classification
  // advisory (catalog truth drives a suspicious deliverable; surface, never silent).
  const odd = entry(data, 'Odd Service');
  // deno-lint-ignore no-explicit-any
  const classification = (odd.advisories as any[]).find((a) => a.kind === 'classification');
  assert(classification, 'suspicious configMode on non-provider tech → classification advisory');
  assert(classification.detail.includes('oddball'), 'advisory names the technology');

  assert(!entry(data, 'Account Shell'), 'configMode none → excluded (nothing to build)');

  // N5.16: hosting containers are assessed (declarative deliverable); logical groups
  // stay organizational; a hosted child builds AFTER its container.
  const vpc = entry(data, 'Net VPC');
  assert(vpc, 'hosting container included in readiness');
  assertEquals(vpc.deliverable, 'declarative');
  assert(!entry(data, 'Grouping'), 'logical group excluded — organizational only');

  const order = data.buildOrder as string[];
  assert(order.indexOf('Primary Database') < order.indexOf('Heavy Job Worker'), 'upstream sql target builds before its caller');
  assert(order.indexOf('Net VPC') < order.indexOf('Heavy Job Worker'), 'container provisions before its hosted child (N5.16)');
});

Deno.test('get_build_readiness: fresh doc + defined interfaces → ready; stale fingerprint → doc blocker', async () => {
  // deno-lint-ignore no-explicit-any
  const g: any = benchGraph();
  g.contracts.c1.schema = { table: 'jobs', operation: 'select' }; // schema now defined
  const DOC = '88888888-8888-4888-8888-888888888888';
  g.artifacts[DOC] = {
    id: DOC, nodeId: N_LONELY, kind: 'task',
    path: '.nodespec/tasks/lonely-service.task.md', content: 'DOC',
    metadata: {}, // no stored fingerprint → no staleness claim
  };

  const sb = new FakeSupabase();
  script(sb, g);
  const r = await handleGetBuildReadiness(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH });
  // deno-lint-ignore no-explicit-any
  const lonely = entry(r.data as any, 'Lonely Service');
  assertEquals(lonely.ready, true, 'no contracts, doc present → ready (advisories do not block)');

  // Same node, but the stored fingerprint hash no longer matches → stale doc blocker.
  g.artifacts[DOC].metadata = { taskContextFingerprint: { fingerprint: 'stale-hash' } };
  const sb2 = new FakeSupabase();
  script(sb2, g);
  const r2 = await handleGetBuildReadiness(sb2 as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, detail: 'full' });
  // deno-lint-ignore no-explicit-any
  const lonely2 = entry(r2.data as any, 'Lonely Service');
  assertEquals(lonely2.ready, false);
  // deno-lint-ignore no-explicit-any
  const docBlocker = (lonely2.blockers as any[]).find((b) => b.kind === 'doc');
  assert(docBlocker && docBlocker.detail.includes('STALE'), 'fingerprint mismatch → stale doc blocker');
});

// ── WS1: the two-step protocol (summary default → scoped full re-call) ──────────────

Deno.test('get_build_readiness: unscoped call defaults to SUMMARY — per-node gap counts by kind, no gap objects, short nextAction', async () => {
  const sb = new FakeSupabase();
  script(sb, benchGraph());

  const r = await handleGetBuildReadiness(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH });
  assertEquals(r.success, true);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.detail, 'summary');

  const worker = entry(data, 'Heavy Job Worker');
  assert(!('blockers' in worker) && !('advisories' in worker), 'summary rows carry counts, never gap objects');
  assertEquals(worker.ready, false);
  assertEquals(worker.blockerCounts.schema, 1, 'counts keyed by gap kind');
  assertEquals(worker.blockerCounts.owner, 1);
  assertEquals(worker.blockerCounts.doc, 1);
  // The resolution actions still arrive — once per kind, not once per gap.
  assert(data.remediations.schema.includes('update_contract'), 'remediations ride the summary');
  assert(Array.isArray(data.buildOrder) && data.buildOrder.length > 0, 'buildOrder rides the summary');
  assert(String(data.nextAction).length <= 160, 'nextAction stays short — the how lives in remediations');
});

Deno.test('get_build_readiness: node_ids scoping defaults to FULL; explicit detail overrides either way', async () => {
  const sb = new FakeSupabase();
  script(sb, benchGraph());
  const scoped = await handleGetBuildReadiness(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, node_ids: ['Heavy Job Worker'] });
  // deno-lint-ignore no-explicit-any
  const data = scoped.data as any;
  assertEquals(data.detail, 'full');
  assertEquals(data.nodes.length, 1, 'scoped to the one named node');
  assert(Array.isArray(data.nodes[0].blockers), 'scoped rows are full gap objects');

  const sb2 = new FakeSupabase();
  script(sb2, benchGraph());
  const summarized = await handleGetBuildReadiness(sb2 as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, node_ids: ['Heavy Job Worker'], detail: 'summary' });
  // deno-lint-ignore no-explicit-any
  const data2 = summarized.data as any;
  assertEquals(data2.detail, 'summary');
  assert(!('blockers' in data2.nodes[0]), 'explicit detail wins over the scoping default');
});

// ── WS2: dangling schemaRef + draftInputs filtering + dependency alignment ──────────

Deno.test('get_build_readiness + task doc: dangling schemaRef surfaces as BROKEN (naming the missing artifact), never as "no schema"', async () => {
  // deno-lint-ignore no-explicit-any
  const g: any = benchGraph();
  const GHOST_REF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  g.contracts.c1.schemaRef = GHOST_REF; // no such artifact in the graph

  const sb = new FakeSupabase();
  script(sb, g);
  const r = await handleGetBuildReadiness(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, detail: 'full' });
  // deno-lint-ignore no-explicit-any
  const worker = entry(r.data as any, 'Heavy Job Worker');
  // deno-lint-ignore no-explicit-any
  const blocker = (worker.blockers as any[]).find((b) => b.kind === 'schema');
  assert(blocker, 'a broken ref still blocks the build');
  assert(blocker.detail.includes('BROKEN'), 'called out as a broken reference, not an undefined schema');
  assert(blocker.detail.includes(GHOST_REF), 'the missing artifact is named');
  assert(blocker.detail.includes('update_contract'), 're-link action stated in the detail (the ref-specific part remediations cannot carry)');

  // Doc parity: the packet renders the same truth (same ContractDetail — WS2).
  const catalogs = {
    nodeRoles: Object.fromEntries(ROLES.map((role) => [role.id, role])),
    technologies: Object.fromEntries(TECHS.map((t) => [t.id, t])),
    deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {},
    // deno-lint-ignore no-explicit-any
  } as any;
  // deno-lint-ignore no-explicit-any
  const doc = generateTaskDocument({ node: g.nodes[N_WORKER], graph: g, catalogs, requirements: [] } as any);
  assert(doc.includes('⚠ SCHEMA REFERENCE BROKEN'), 'doc renders the broken-ref block');
  assert(doc.includes(GHOST_REF), 'doc names the missing artifact');
  assert(!doc.includes('SCHEMA UNDEFINED'), 'never misreported as merely undefined');
});

Deno.test('WS2 alignment: interactionKind dependency is honored by BOTH the doc and readiness — no schema demanded', async () => {
  // deno-lint-ignore no-explicit-any
  const g: any = benchGraph();
  g.contracts.c1 = { id: 'c1', name: 'Worker Data Queries', kind: 'custom', interactionKind: 'dependency' };

  const sb = new FakeSupabase();
  script(sb, g);
  const r = await handleGetBuildReadiness(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, detail: 'full' });
  // deno-lint-ignore no-explicit-any
  const worker = entry(r.data as any, 'Heavy Job Worker');
  // deno-lint-ignore no-explicit-any
  assert(!(worker.blockers as any[]).some((b) => b.kind === 'schema'), 'readiness never counted this as a gap');

  const catalogs = {
    nodeRoles: Object.fromEntries(ROLES.map((role) => [role.id, role])),
    technologies: Object.fromEntries(TECHS.map((t) => [t.id, t])),
    deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {},
    // deno-lint-ignore no-explicit-any
  } as any;
  // deno-lint-ignore no-explicit-any
  const doc = generateTaskDocument({ node: g.nodes[N_WORKER], graph: g, catalogs, requirements: [] } as any);
  assert(doc.includes('Dependency contract — no payload schema expected'), 'doc now agrees (it used to demand a schema here)');
  assert(!doc.includes('SCHEMA UNDEFINED'), 'no schema demand on a dependency interaction');
});

Deno.test('draftInputs: counterparty apiEndpoints honor that node\'s metadata.config.apiAreas selection', async () => {
  // deno-lint-ignore no-explicit-any
  const g: any = benchGraph();
  g.nodes[N_DB].metadata = { config: { apiAreas: ['Query'] } };

  const sb = new FakeSupabase();
  script(sb, g);
  const r = await handleGetBuildReadiness(sb as never, READ_AUTH, { project_id: PROJECT.id, branch_id: BRANCH, detail: 'full' });
  // deno-lint-ignore no-explicit-any
  const worker = entry(r.data as any, 'Heavy Job Worker');
  // deno-lint-ignore no-explicit-any
  const blocker = (worker.blockers as any[]).find((b) => b.kind === 'schema');
  assertEquals(blocker.draftInputs.apiEndpoints, ['GET /query'], 'selection filters exactly like the packet\'s API Reference');
});

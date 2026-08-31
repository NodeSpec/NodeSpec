// N2: boundary treatment behavior (M1b: treatment DERIVES from nature + is_container —
// fixtures carry the new axes). A boundary role is an engine that owns its
// internals (n8n/Airflow/NiFi...) — NodeSpec owns placement, wiring, and connection config.
// Pins the four behavioral deltas plus the two already-correct-by-construction filters:
// boundary ⇒ NOT is_container (N1 CHECK), so leaf filters and port injection already treat
// boundary nodes as task-doc-bearing leaves — asserted here so a refactor can't regress it.
import { computeTaskContextFingerprint, generateTaskDocument } from '../_shared/task-document-generator.ts';
import { buildNodeContext } from '../_shared/mcp-context-assembly.ts';
import { inferPlacementKind } from '../_shared/tool-executor.ts';
import { ensureNodePorts } from '../_shared/catalog-node-normalization.ts';
import { canContainerAcceptChild } from '../_shared/role-registry.ts';
import { handleGenerateTaskDocs } from '../mcp-server/tools/tasks.ts';
import { FakeSupabase, assert, assertEquals, completeRole } from './helpers.ts';

const N_FLOW = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
const N_API = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb';

// deno-lint-ignore no-explicit-any
const CATALOGS: any = {
  nodeRoles: {
    'scheduled-trigger': {
      id: 'scheduled-trigger', label: 'Scheduled Trigger', description: 'Time-based automation entry',
      nature: 'engine', palette_category: 'automation', is_container: false,
      container_layer: null, capability_tags: [],
      default_ports: [{ name: 'trigger-out', direction: 'out' }],
    },
    'backend-service': {
      id: 'backend-service', label: 'Backend Service', description: 'App service',
      nature: 'build', palette_category: 'services', is_container: false,
      container_layer: null, capability_tags: [],
      default_ports: [{ name: 'input', direction: 'in' }, { name: 'output', direction: 'out' }],
    },
    'domain-module': {
      id: 'domain-module', label: 'Domain Module', description: 'Logical grouping',
      nature: 'build', palette_category: 'structure', is_container: true, container_style: 'logical-boundary',
      container_layer: 'logical', capability_tags: [],
    },
    'k8s-cluster': {
      id: 'k8s-cluster', label: 'Cluster', description: 'Hosting',
      nature: 'host', palette_category: 'infra', is_container: true,
      container_layer: 'infrastructure', capability_tags: [],
    },
    'app-scope': {
      id: 'app-scope', label: 'App Scope', description: 'Plain container (no layer)',
      nature: 'build', palette_category: 'structure', is_container: true,
      container_layer: null, capability_tags: [],
    },
  },
  technologies: {
    n8n: { id: 'n8n', name: 'n8n', role_affinities: ['scheduled-trigger'], ai_context: {} },
  },
  deploymentTargets: {}, legacyMappings: {}, cloudPatterns: {}, scopeArchetypes: {},
};

// deno-lint-ignore no-explicit-any
function twoNodeGraph(): any {
  return {
    nodes: {
      [N_FLOW]: { id: N_FLOW, type: 'scheduled-trigger', label: 'Nightly Sync', technology: 'n8n', ports: [] },
      [N_API]: { id: N_API, type: 'backend-service', label: 'API Service', ports: [] },
    },
    edges: {}, contracts: {}, artifacts: {},
  };
}

Deno.test('N5.5: metadata.config renders a Configuration block in the packet; absent when empty', () => {
  const g = twoNodeGraph();
  g.nodes[N_API].metadata = { config: { region: 'us-east-1', tier: 'standard', replicas: 3 } };
  const doc = generateTaskDocument({ node: g.nodes[N_API], graph: g, catalogs: CATALOGS as never, requirements: [] });
  assert(doc.includes('## Configuration'), 'config section present');
  assert(doc.includes('**region:** us-east-1'), 'string value rendered');
  assert(doc.includes('**replicas:** 3'), 'number value rendered');
  assert(doc.includes('honor these choices'), 'framed as user decisions');

  const bare = generateTaskDocument({ node: g.nodes[N_FLOW], graph: g, catalogs: CATALOGS as never, requirements: [] });
  assert(!bare.includes('## Configuration'), 'no config → no section');
});

Deno.test('N5.8: deliverable classifies by IN-GRAPH ownership — platform parent → IaC, infra parent → code', () => {
  // The Lambda/CloudFront bench pair: same role kind (app_service — cdn is mis-filed,
  // N8), opposite correct deliverables. The graph knows: CloudFront's parent is the AWS
  // PLATFORM node (N3.8 minimum-container rule) → rent → provisioning config; Lambda
  // under a VPC (infrastructure) → build → working code.
  // deno-lint-ignore no-explicit-any
  const catalogs: any = {
    ...CATALOGS,
    nodeRoles: {
      ...CATALOGS.nodeRoles,
      aws: { id: 'aws', label: 'AWS', description: 'Platform', nature: 'host', palette_category: 'platform', is_container: true, container_layer: 'infrastructure', capability_tags: [] },
      vpc: { id: 'vpc', label: 'VPC', description: 'Network', nature: 'build', palette_category: 'infra', is_container: true, container_layer: 'infrastructure', capability_tags: [] },
    },
    technologies: {
      'aws-cloudfront': { id: 'aws-cloudfront', name: 'AWS CloudFront', role_affinities: ['backend-service'], ai_context: {} },
      'aws-lambda': { id: 'aws-lambda', name: 'AWS Lambda', role_affinities: ['backend-service'], ai_context: {} },
    },
  };
  // deno-lint-ignore no-explicit-any
  const g: any = {
    nodes: {
      awsNode: { id: 'awsNode', type: 'aws', label: 'AWS', ports: [] },
      vpcNode: { id: 'vpcNode', type: 'vpc', label: 'VPC', ports: [] },
      cdn: { id: 'cdn', type: 'backend-service', label: 'CloudFront', technology: 'aws-cloudfront', parentId: 'awsNode', ports: [] },
      fn: { id: 'fn', type: 'backend-service', label: 'API Functions', technology: 'aws-lambda', parentId: 'vpcNode', ports: [] },
    },
    edges: {}, contracts: {}, artifacts: {},
  };
  const cdnDoc = generateTaskDocument({ node: g.nodes.cdn, graph: g, catalogs, requirements: [] });
  assert(cdnDoc.includes('provisioned, not programmed — no application code implements it'), 'platform-parented node → provisioned service (N10(e) wording: no provider-managed overclaim for self-hosted rows)');
  assert(cdnDoc.includes('Provisioning configuration (IaC)'), 'deliverable = provisioning config');
  assert(!cdnDoc.includes('Working code for this component'), 'NOT a coding task');

  const fnDoc = generateTaskDocument({ node: g.nodes.fn, graph: g, catalogs, requirements: [] });
  assert(fnDoc.includes('Working code for this component'), 'infra-parented compute → working code');

  // N5.14 (owner-caught: react + frontend-app got the IaC directive): rent-by-PLACEMENT
  // on a NON-provider technology never flips user code to IaC — react inside the
  // platform container and express hosted on infra both stay coding tasks. Only
  // rent-by-identity (provider-branded tech / platform_capability role) is declarative.
  catalogs.technologies['react'] = { id: 'react', name: 'React', role_affinities: ['backend-service'], ai_context: {} };
  catalogs.technologies['express'] = { id: 'express', name: 'Express', role_affinities: ['backend-service'], ai_context: {} };
  g.nodes.web = { id: 'web', type: 'backend-service', label: 'Frontend App', technology: 'react', parentId: 'awsNode', ports: [] };
  g.nodes.api = { id: 'api', type: 'backend-service', label: 'API', technology: 'express', parentId: 'vpcNode', placementKind: 'hosts', ports: [] };
  const webDoc = generateTaskDocument({ node: g.nodes.web, graph: g, catalogs, requirements: [] });
  assert(webDoc.includes('Working code for this component'), 'react under a platform parent → still working code');
  assert(!webDoc.includes('provider-managed service'), 'no IaC framing for hosted user code');
  const apiDoc = generateTaskDocument({ node: g.nodes.api, graph: g, catalogs, requirements: [] });
  assert(apiDoc.includes('Working code for this component'), 'express hosted (placementKind hosts) → still working code');

  // configMode is always authoritative: 'code' forces working-code even under a platform.
  catalogs.technologies['aws-cloudfront'].ai_context = { configMode: 'code' };
  const forced = generateTaskDocument({ node: g.nodes.cdn, graph: g, catalogs, requirements: [] });
  assert(forced.includes('Working code for this component'), 'configMode code overrides ownership');

  // 'none' → no-task statement (and generate_task_docs skips these nodes entirely).
  catalogs.technologies['aws-cloudfront'].ai_context = { configMode: 'none' };
  const none = generateTaskDocument({ node: g.nodes.cdn, graph: g, catalogs, requirements: [] });
  assert(none.includes('**No implementation task.**'), 'account-access-only node states no task');
});

Deno.test('N5.11: the packet CONTAINS synthesized, ordered, criterion-cited task boxes', () => {
  // Owner 2026-07-24: "I want the task document checkboxes to be explicit,
  // contextual-to-that-node" — N5.10's authoring directive was too weak (docs carried
  // an instruction, not tasks). Synthesis is deterministic from model truth, so the
  // Postgres-vs-CloudFront catalog-richness gap cannot reappear.
  // deno-lint-ignore no-explicit-any
  const catalogs: any = {
    ...CATALOGS,
    nodeRoles: {
      ...CATALOGS.nodeRoles,
      aws: { id: 'aws', label: 'AWS', description: 'Platform', nature: 'host', palette_category: 'platform', is_container: true, container_layer: 'infrastructure', capability_tags: [] },
    },
    technologies: {
      ...CATALOGS.technologies,
      // Catalog-THIN declarative row (the Postgres shape): configMode only, no guidance.
      'aws-rds-postgresql': { id: 'aws-rds-postgresql', name: 'AWS RDS PostgreSQL', role_affinities: ['backend-service'], ai_context: { configMode: 'declarative' } },
      'aws-lambda': {
        id: 'aws-lambda', name: 'AWS Lambda', role_affinities: ['backend-service'],
        ai_context: { configMode: 'code', bestPractices: ['Keep handlers small'] },
        suggested_files: [{ path: 'src/handler.ts', kind: 'source' }],
      },
    },
  };
  // deno-lint-ignore no-explicit-any
  const g: any = {
    nodes: {
      awsNode: { id: 'awsNode', type: 'aws', label: 'AWS', ports: [] },
      db: { id: 'db', type: 'backend-service', label: 'Postgres', technology: 'aws-rds-postgresql', parentId: 'awsNode', ports: [] },
      fn: { id: 'fn', type: 'backend-service', label: 'API Functions', technology: 'aws-lambda', parentId: 'awsNode', ports: [] },
    },
    edges: {
      e1: { id: 'e1', source: 'fn', target: 'db', contractId: 'c1' },
    },
    contracts: {
      c1: { id: 'c1', name: 'Data Access', kind: 'sql' },
    },
    artifacts: {},
  };
  const requirements = [
    {
      requirementId: 'REQ-101', name: 'Durable Storage', description: 'Data survives restarts.',
      category: 'functional', status: 'in-progress',
      acceptanceCriteria: [
        { text: 'Records persist across restarts', met: false },
        { text: 'Backups enabled', met: true }, // met → no task
      ],
    },
    {
      requirementId: 'REQ-102', name: 'Performance', description: 'Fast queries.',
      category: 'non-functional', status: 'in-progress',
      acceptanceCriteria: [{ text: 'Queries respond quickly', met: false }],
    },
    {
      requirementId: 'REQ-103', name: 'Data Layer Integration', description: 'Functions use the DB.',
      category: 'functional', status: 'in-progress',
      acceptanceCriteria: [{ text: 'API Functions read via Data Access', met: false }],
    },
  ];
  const requirementNodeMap = { 'REQ-101': ['db'], 'REQ-102': ['db', 'fn'], 'REQ-103': ['db', 'fn'] };

  // Declarative node with a THIN catalog row: full task list anyway.
  const dbDoc = generateTaskDocument({ node: g.nodes.db, graph: g, catalogs, requirements, requirementNodeMap });
  assert(dbDoc.includes('## Implementation Tasks'), 'synthesized section present');
  assert(!dbDoc.includes('## Write the Implementation Tasks'), 'N5.10 authoring directive replaced');
  assert(dbDoc.includes('**T1 — Provision AWS RDS PostgreSQL via IaC.**'), 'kind-correct foundation task');
  assert(dbDoc.includes('deployed under AWS'), 'foundation task names the parent');
  assert(dbDoc.includes('[PLACEHOLDER: config — no user configuration recorded'), 'missing config is a placeholder, not silence');
  assert(dbDoc.includes('Expose the interface API Functions consumes, per Contract "Data Access" (sql).'), 'incoming contract task');
  assert(dbDoc.includes('[PLACEHOLDER: schema — Contract "Data Access" has no schema'), 'schema gap tagged on the contract task');
  assert(dbDoc.includes('↳ serves: REQ-103 "API Functions read via Data Access" — coordinate with API Functions'), 'contract-evidenced criterion attaches to the contract task');
  assert(dbDoc.includes('Configure the service to satisfy: "Records persist across restarts" (REQ-101).'), 'solo unmatched criterion gets its own kind-verbed task');
  assert(dbDoc.includes('Resolve ownership, then implement: "Queries respond quickly" (REQ-102).'), 'owner-unresolved criterion gets a task anyway');
  assert(dbDoc.includes('[PLACEHOLDER: owner — this node or a sharing node (API Functions)'), 'ownership gap tagged');
  assert(!dbDoc.includes('"Backups enabled" (REQ-101)'), 'met criteria produce no task');
  assert(dbDoc.includes('Verify every acceptance criterion above and tick its box.'), 'final verification task');
  assert(dbDoc.includes('→ covered by Task T'), 'criterion boxes back-reference their task');
  // N5.11 amendment: covered criteria are slim (no attribution echo), and expansion
  // by the consuming AI is MANDATORY — the flowdown is its job, not a template's.
  assert(!dbDoc.includes('→ THIS NODE via Contract'), 'attribution echo gone from covered criteria');
  assert(dbDoc.includes('**Your first action — expand these work orders.**'), 'mandatory expansion directive present');
  assert(dbDoc.includes('guarantees WHAT must be covered, not HOW'), 'two-layer contract stated');
  assert(dbDoc.includes('keeping task IDs, criterion citations, and open `[PLACEHOLDER: …]` tags intact'), 'expansion preserves traceability + placeholders');
  assert(!dbDoc.includes('Working code for this component'), 'configMode declarative beats parentage — no coding task for RDS');

  // Code node: scaffold foundation with suggested files + outgoing integration task,
  // guidance reframed as reference for the synthesized tasks.
  const fnDoc = generateTaskDocument({ node: g.nodes.fn, graph: g, catalogs, requirements: [] });
  assert(fnDoc.includes('**T1 — Scaffold the AWS Lambda component.**'), 'code foundation task');
  assert(fnDoc.includes('suggested structure: `src/handler.ts`'), 'catalog suggested files enumerated');
  assert(fnDoc.includes('Implement the integration with Postgres (aws-rds-postgresql) per Contract "Data Access" (sql).'), 'outgoing contract task, code verb');
  assert(fnDoc.includes('Reference for executing the Implementation Tasks above'), 'Technology Guidance reframed as reference');

  // external-config: foundation flips to connection config; required setup steps
  // become explicit manual-step tasks.
  catalogs.technologies['aws-rds-postgresql'].ai_context = {
    configMode: 'external',
    setupInstructions: [{ required: true, type: 'account', title: 'Create the database account', instructions: 'Console.' }],
  };
  const extDoc = generateTaskDocument({ node: g.nodes.db, graph: g, catalogs, requirements: [] });
  assert(extDoc.includes('Record the connection configuration for AWS RDS PostgreSQL.'), 'external-config foundation task');
  assert(extDoc.includes('Complete manual step: Create the database account.'), 'required setup step becomes a task box');

  // 'none' deliverable: nothing to do → no task section at all.
  catalogs.technologies['aws-rds-postgresql'].ai_context = { configMode: 'none' };
  const noneDoc = generateTaskDocument({ node: g.nodes.db, graph: g, catalogs, requirements: [] });
  assert(!noneDoc.includes('## Implementation Tasks'), 'no-task node gets no task section');
});

Deno.test('N5.9: shared-requirement criteria without contract evidence say OWNER UNRESOLVED, never THIS NODE', () => {
  // The Route 53 acceptance-review defect: DNS's doc claimed TLS termination as its own
  // internal logic because "internal logic" was the default on every sharing node.
  // deno-lint-ignore no-explicit-any
  const g: any = {
    nodes: {
      [N_FLOW]: { id: N_FLOW, type: 'backend-service', label: 'Route 53', ports: [] },
      cdn: { id: 'cdn', type: 'backend-service', label: 'CloudFront', ports: [] },
    },
    edges: { e1: { id: 'e1', source: N_FLOW, target: 'cdn', contractId: 'c1' } },
    contracts: { c1: { id: 'c1', name: 'DNS Resolution', kind: 'dependency' } },
    artifacts: {},
  };
  const doc = generateTaskDocument({
    node: g.nodes[N_FLOW], graph: g, catalogs: CATALOGS as never,
    requirements: [{
      requirementId: 'REQ-003', name: 'Public Web Access', description: 'HTTPS via custom domain.',
      category: 'functional', status: 'in-progress',
      acceptanceCriteria: [{ text: 'All traffic is served over HTTPS with a valid TLS certificate', met: false }],
    }],
    requirementNodeMap: { 'REQ-003': [N_FLOW, 'cdn'] },
  });
  // N5.11 amendment: the honesty semantics live in the synthesized TASK now — the
  // criterion box carries only the back-reference; the task carries the placeholder.
  assert(doc.includes('[PLACEHOLDER: owner — this node or a sharing node (CloudFront)'), 'shared + unmatched → honest unresolved (as a task placeholder)');
  assert(doc.includes('Resolve ownership, then implement: "All traffic is served over HTTPS with a valid TLS certificate"'), 'unresolved criterion still gets a task');
  assert(!doc.includes('THIS NODE: internal logic'), 'no false ownership claim on a shared requirement');

  // Solo-mapped requirement keeps the direct internal-logic directive.
  const solo = generateTaskDocument({
    node: g.nodes[N_FLOW], graph: g, catalogs: CATALOGS as never,
    requirements: [{
      requirementId: 'REQ-005', name: 'Zone Management', description: 'DNS zones managed as code.',
      category: 'functional', status: 'in-progress',
      acceptanceCriteria: [{ text: 'Zone records are managed via IaC', met: false }],
    }],
    requirementNodeMap: { 'REQ-005': [N_FLOW] },
  });
  assert(solo.includes("it is this node's internal responsibility"), 'solo-mapped + unmatched → this node owns it (stated in its task)');
  assert(solo.includes('Implement: "Zone records are managed via IaC"'), 'solo criterion has its own task (code-kind verb — node has no technology)');

  // Dependency contracts don't demand payload schemas.
  assert(doc.includes('no payload schema expected'), 'dependency contract → no schema-proposal noise');
  assert(!doc.split('DNS Resolution')[1]?.includes('SCHEMA UNDEFINED'), 'no schema-undefined block for dependency kind');
});

Deno.test('N5.9: incoming edges NEVER create startup dependencies — the Route 53 ↔ CloudFront cycle is dead', () => {
  // deno-lint-ignore no-explicit-any
  const g: any = {
    nodes: {
      [N_FLOW]: { id: N_FLOW, type: 'backend-service', label: 'CloudFront', ports: [] },
      dns: { id: 'dns', type: 'backend-service', label: 'Route 53', ports: [] },
    },
    edges: { e1: { id: 'e1', source: 'dns', target: N_FLOW, contractId: 'c1' } },
    contracts: { c1: { id: 'c1', name: 'DNS Resolution', kind: 'dependency' } },
    artifacts: {},
  };
  const doc = generateTaskDocument({ node: g.nodes[N_FLOW], graph: g, catalogs: CATALOGS as never, requirements: [] });
  const chain = doc.split('## Dependency Chain')[1] ?? '';
  assert(!chain.includes('**Must be available BEFORE this node starts:**'), 'incoming-only node has NO startup dependencies');
  assert(chain.includes('Route 53'), 'the source appears under depends-on-this');
  assert(chain.includes('initiates DNS Resolution against this node'), 'incoming dependency phrased from the source side');
});

Deno.test('N5.7: criteria render as scoped task boxes with inline attribution; the bottom map is gone', () => {
  // deno-lint-ignore no-explicit-any
  const g: any = {
    nodes: {
      [N_FLOW]: { id: N_FLOW, type: 'backend-service', label: 'API Service', ports: [] },
      other: { id: 'other', type: 'backend-service', label: 'Auth Service', ports: [] },
    },
    edges: { e1: { id: 'e1', source: N_FLOW, target: 'other', contractId: 'c1' } },
    contracts: { c1: { id: 'c1', name: 'Token Validation', kind: 'rest' } },
    artifacts: {},
  };
  const doc = generateTaskDocument({
    node: g.nodes[N_FLOW], graph: g, catalogs: CATALOGS as never,
    requirements: [{
      requirementId: 'REQ-001', name: 'Secure API', description: 'API must be authenticated.',
      category: 'functional', status: 'in-progress',
      acceptanceCriteria: [
        { text: 'Requests carry validated tokens', met: false },
        { text: 'Unauthenticated requests are rejected', met: false },
      ],
    }],
    requirementNodeMap: { 'REQ-001': [N_FLOW, 'other'] },
  });
  assert(doc.includes('## Requirements — Your Scope'), 'scoped requirements heading');
  assert(doc.includes('Acceptance criteria — your task boxes'), 'criteria framed as task boxes');
  // N5.11 amendment: covered criteria carry ONLY the task back-reference — the
  // coordination detail lives in the task's serves-line (owner: the attribution echo
  // was "not a quality task; just a regurgitation").
  assert(doc.includes('→ covered by Task T'), 'covered criterion points at its task');
  assert(doc.includes('↳ serves: REQ-001 "Requests carry validated tokens" — coordinate with Auth Service'), 'coordination detail lives in the task serves-line');
  assert(doc.includes('their slices live in their own task docs'), 'sharing framed as other nodes\' docs');
  assert(!doc.includes('## Acceptance Criteria Implementation Map'), 'bottom map section deleted');
  assert(!doc.includes('## Connected Components'), 'lossy duplicate section deleted');
  assert(doc.includes('> **Scope:** implement ONLY this node'), 'one-node scope line up top');
});

Deno.test('N5.7: Manual Steps is rule-driven — external-mode node with no catalog steps gets an honest placeholder', () => {
  // deno-lint-ignore no-explicit-any
  const catalogs: any = {
    ...CATALOGS,
    technologies: {
      n8n: { id: 'n8n', name: 'n8n', role_affinities: ['scheduled-trigger'], ai_context: { configMode: 'external' } },
    },
  };
  const g = twoNodeGraph();
  const doc = generateTaskDocument({ node: g.nodes[N_FLOW], graph: g, catalogs, requirements: [] });
  assert(doc.includes('## Manual Steps'), 'manual steps section present by RULE');
  assert(doc.includes('No catalog steps exist for this technology yet'), 'honest placeholder, not silence');
  assert(doc.includes('do NOT mark this node'), 'completion gate stated');

  // A plain buildable leaf with no setup instructions gets NO manual section.
  const leafDoc = generateTaskDocument({ node: g.nodes[N_API], graph: g, catalogs: CATALOGS as never, requirements: [] });
  assert(!leafDoc.includes('## Manual Steps'), 'code-configurable node → no manual section');
});

Deno.test('N5.6: dependency chain uses REAL contract enums — sync origins are dependencies, callers depend on us', () => {
  // The CloudFront bench doc inversion: outgoing `rest` fell through to "receives from
  // this node", telling the AI its S3 ORIGIN depended on the CDN.
  // deno-lint-ignore no-explicit-any
  const g: any = {
    nodes: {
      [N_FLOW]: { id: N_FLOW, type: 'backend-service', label: 'CDN Edge', ports: [] },
      origin: { id: 'origin', type: 'backend-service', label: 'Object Store', ports: [] },
      caller: { id: 'caller', type: 'backend-service', label: 'Web Client', ports: [] },
      sink: { id: 'sink', type: 'backend-service', label: 'Event Sink', ports: [] },
    },
    edges: {
      e1: { id: 'e1', source: N_FLOW, target: 'origin', contractId: 'c1' },
      e2: { id: 'e2', source: 'caller', target: N_FLOW, contractId: 'c2' },
      e3: { id: 'e3', source: N_FLOW, target: 'sink', contractId: 'c3' },
    },
    contracts: {
      c1: { id: 'c1', name: 'Static Origin', kind: 'rest' },
      c2: { id: 'c2', name: 'Edge Requests', kind: 'rest' },
      c3: { id: 'c3', name: 'Access Logs', kind: 'kafka' },
    },
    artifacts: {},
  };
  const doc = generateTaskDocument({ node: g.nodes[N_FLOW], graph: g, catalogs: CATALOGS as never, requirements: [] });
  const chain = doc.split('## Dependency Chain')[1] ?? '';
  const before = chain.split('**Depends on THIS node being available:**')[0];
  const after = chain.split('**Depends on THIS node being available:**')[1] ?? '';
  assert(before.includes('**Must be available BEFORE this node starts:**'), 'has must-be-available section');
  assert(before.includes('Object Store'), 'outgoing rest target = a dependency of this node (the origin)');
  assert(after.includes('Web Client'), 'incoming rest caller depends on THIS node');
  assert(after.includes('Event Sink'), 'outgoing async (kafka) consumer depends on this node');
  assert(!before.includes('Web Client'), 'the caller is NOT a startup dependency of this node');
});

Deno.test('N5.6: flattened catalog code snippets (literal backslash-n) render as real lines', () => {
  // deno-lint-ignore no-explicit-any
  const catalogs: any = {
    ...CATALOGS,
    technologies: {
      n8n: {
        id: 'n8n', name: 'n8n', role_affinities: ['scheduled-trigger'],
        ai_context: { sdkInitPattern: 'line one\\ncd app\\nnpm start' },
      },
    },
  };
  const g = twoNodeGraph();
  const doc = generateTaskDocument({ node: g.nodes[N_FLOW], graph: g, catalogs, requirements: [] });
  assert(doc.includes('line one\ncd app\nnpm start'), 'flattened snippet unescaped to real newlines');
  assert(!doc.includes('\\ncd app'), 'no literal backslash-n remains');
});

Deno.test('N2.2: a boundary-engine technology raises a LEAF role to a boundary node', () => {
  // The bench-found gap: data-prep-pipeline is a LEAF role (kind app_service — authored as
  // code). Binding n8n (a boundary engine carrying ai_context.treatmentOverride='boundary')
  // makes the NODE a boundary. Same role with NO technology stays a leaf.
  // deno-lint-ignore no-explicit-any
  const catalogs: any = {
    ...CATALOGS,
    nodeRoles: {
      ...CATALOGS.nodeRoles,
      'data-prep-pipeline': {
        id: 'data-prep-pipeline', label: 'Data Prep Pipeline', description: 'ETL job',
        nature: 'build', palette_category: 'ai-ml', is_container: false,
        container_layer: null, capability_tags: [],
        default_ports: [],
      },
    },
    technologies: {
      n8n: { id: 'n8n', name: 'n8n', role_affinities: ['data-prep-pipeline'],
        ai_context: { treatmentOverride: 'boundary', configMode: 'definition-as-code' } },
    },
  };
  // deno-lint-ignore no-explicit-any
  const withN8n: any = { nodes: { [N_FLOW]: { id: N_FLOW, type: 'data-prep-pipeline', label: 'Nightly ETL', technology: 'n8n', ports: [] } }, edges: {}, contracts: {}, artifacts: {} };
  const doc = generateTaskDocument({ node: withN8n.nodes[N_FLOW], graph: withN8n, catalogs, requirements: [] });
  assert(doc.includes('engine that owns its own internals'), 'leaf role + boundary-engine tech → boundary deliverable (N5.7: inside Your Deliverable)');
  assert(doc.includes('definition IS a deliverable code file'), 'config mode still modulates it');
  assertEquals(buildNodeContext(withN8n.nodes[N_FLOW], withN8n, catalogs).treatmentMode, 'boundary');

  // deno-lint-ignore no-explicit-any
  const plain: any = { nodes: { [N_API]: { id: N_API, type: 'data-prep-pipeline', label: 'Hand-coded ETL', ports: [] } }, edges: {}, contracts: {}, artifacts: {} };
  const plainDoc = generateTaskDocument({ node: plain.nodes[N_API], graph: plain, catalogs, requirements: [] });
  assert(!plainDoc.includes('engine that owns its own internals'), 'data-prep-pipeline authored as code (no tech) stays a leaf');
  assert(plainDoc.includes('Working code for this component'), 'leaf deliverable is the build directive');
  assertEquals(buildNodeContext(plain.nodes[N_API], plain, catalogs).treatmentMode, 'leaf');
});

Deno.test('N2.3: containment — effective-boundary child bypasses hand-enumerated can_contain lists', () => {
  // The bench toast: "docker container cannot contain Data Prep Pipeline node type".
  // Hosting containers enumerate role ids; the precedence rule makes treatment win first.
  // deno-lint-ignore no-explicit-any
  const catalogs: any = {
    nodeRoles: {
      'docker-container': {
        id: 'docker-container', label: 'Docker Container', nature: 'host',
        is_container: true, container_layer: 'runtime',
        can_contain: ['backend-service', 'database'], // data-prep-pipeline NOT listed
      },
      'data-prep-pipeline': {
        id: 'data-prep-pipeline', label: 'Data Prep Pipeline', nature: 'build',
        is_container: false,
      },
      'scheduled-trigger': {
        id: 'scheduled-trigger', label: 'Scheduled Trigger', nature: 'engine',
        is_container: false,
      },
      'frontend-app': {
        id: 'frontend-app', label: 'Frontend', nature: 'build',
        is_container: false,
      },
    },
    technologies: {
      n8n: { id: 'n8n', name: 'n8n', role_affinities: [], ai_context: { treatmentOverride: 'boundary' } },
      react: { id: 'react', name: 'React', role_affinities: [], ai_context: {} },
    },
  };

  // Leaf role + boundary-engine tech → allowed despite not being in the list (THE bench case).
  assertEquals(canContainerAcceptChild(catalogs, 'docker-container', 'data-prep-pipeline', 'n8n').allowed, true);
  // Role-level boundary → allowed with no technology at all.
  assertEquals(canContainerAcceptChild(catalogs, 'docker-container', 'scheduled-trigger').allowed, true);
  // Leaf children keep EXACTLY the existing enumeration behavior — no blanket loosening.
  assertEquals(canContainerAcceptChild(catalogs, 'docker-container', 'data-prep-pipeline').allowed, false, 'hand-coded ETL leaf: list still applies');
  assertEquals(canContainerAcceptChild(catalogs, 'docker-container', 'frontend-app', 'react').allowed, false, 'non-boundary tech does not unlock');
  assertEquals(canContainerAcceptChild(catalogs, 'docker-container', 'backend-service').allowed, true, 'listed leaf still allowed');
});

Deno.test('N2.3: placement inference consults the technology override (leaf role + n8n → scopes)', () => {
  // deno-lint-ignore no-explicit-any
  const ctx: any = {
    catalogs: {
      ...CATALOGS,
      nodeRoles: {
        ...CATALOGS.nodeRoles,
        'data-prep-pipeline': {
          id: 'data-prep-pipeline', label: 'Data Prep Pipeline', nature: 'build',
          palette_category: 'ai-ml', is_container: false, container_layer: null,
          capability_tags: [],
        },
      },
      technologies: { n8n: { id: 'n8n', name: 'n8n', role_affinities: [], ai_context: { treatmentOverride: 'boundary' } } },
    },
  };
  assertEquals(inferPlacementKind(ctx, 'app-scope', 'data-prep-pipeline', 'n8n'), 'scopes', 'effective boundary scopes into a plain container');
  assertEquals(inferPlacementKind(ctx, 'k8s-cluster', 'data-prep-pipeline', 'n8n'), 'hosts', 'hosting still wins');
  assertEquals(inferPlacementKind(ctx, 'app-scope', 'data-prep-pipeline'), 'contains', 'same role hand-coded stays contains');
});

Deno.test('boundary task doc leads with interface mode; leaf doc does not', () => {
  const g = twoNodeGraph();
  const boundaryDoc = generateTaskDocument({
    node: g.nodes[N_FLOW], graph: g, catalogs: CATALOGS, requirements: [],
  });
  assert(boundaryDoc.includes('## Your Deliverable'), 'deliverable block present (N5.7)');
  assert(boundaryDoc.includes('engine that owns its own internals'), 'boundary framing present');
  assert(boundaryDoc.includes('never reimplement its functionality as application code'), 'anti-reimplementation instruction');
  assert(boundaryDoc.includes('Never decompose its internals'), 'graph-protection instruction');
  assert(boundaryDoc.includes('(n8n)'), 'names the owning engine');
  assert(boundaryDoc.includes('**Configuration artifacts**'), 'no configMode declared → conservative default deliverable');

  const leafDoc = generateTaskDocument({
    node: g.nodes[N_API], graph: g, catalogs: CATALOGS, requirements: [],
  });
  assert(!leafDoc.includes('engine that owns its own internals'), 'leaf docs stay build briefs');
});

Deno.test('N2.1: ai_context.configMode modulates the boundary deliverables', () => {
  const g = twoNodeGraph();
  // deno-lint-ignore no-explicit-any
  const withMode = (configMode?: string): any => ({
    ...CATALOGS,
    technologies: { n8n: { ...CATALOGS.technologies.n8n, ai_context: configMode ? { configMode } : {} } },
  });
  const doc = (configMode?: string) =>
    generateTaskDocument({ node: g.nodes[N_FLOW], graph: g, catalogs: withMode(configMode), requirements: [] });

  const dac = doc('definition-as-code');
  assert(dac.includes('definition IS a deliverable code file'), 'DAG/workflow file is an explicit deliverable');
  assert(dac.includes('Never decompose its internals into architecture nodes'), 'graph invariant stated even when code is welcome (N5.7: in the deliverable intro)');

  assert(doc('declarative').includes('Provisioning configuration (IaC)'), 'managed service → IaC deliverable');
  assert(doc('external').includes('Connection configuration ONLY'), 'console-configured → connection config only');
  assert(doc('external').includes('see Manual Steps'), 'external mode points at the Manual Steps section');
  assert(doc(undefined).includes('**Configuration artifacts**'), 'absent → conservative default');
});

Deno.test('buildNodeContext carries treatmentMode (boundary; leaf default when axes absent)', () => {
  const g = twoNodeGraph();
  assertEquals(buildNodeContext(g.nodes[N_FLOW], g, CATALOGS).treatmentMode, 'boundary');
  assertEquals(buildNodeContext(g.nodes[N_API], g, CATALOGS).treatmentMode, 'leaf');
  // Role without the N1 axes (pre-migration shape) → is_container decides, else leaf.
  // deno-lint-ignore no-explicit-any
  const legacy: any = { ...CATALOGS, nodeRoles: { 'backend-service': { ...CATALOGS.nodeRoles['backend-service'], nature: undefined } } };
  assertEquals(buildNodeContext(g.nodes[N_API], g, legacy).treatmentMode, 'leaf');
});

Deno.test('inferPlacementKind: boundary child scopes unless genuinely hosted; leaf behavior unchanged', () => {
  // deno-lint-ignore no-explicit-any
  const ctx: any = { catalogs: CATALOGS };
  // Boundary child: engine membership is scoping — except under real hosting infrastructure.
  assertEquals(inferPlacementKind(ctx, 'domain-module', 'scheduled-trigger'), 'scopes');
  assertEquals(inferPlacementKind(ctx, 'app-scope', 'scheduled-trigger'), 'scopes', 'plain container: scopes, not contains');
  assertEquals(inferPlacementKind(ctx, 'k8s-cluster', 'scheduled-trigger'), 'hosts', 'hosted wins over boundary');
  // Leaf child: exactly the pre-N2 rules.
  assertEquals(inferPlacementKind(ctx, 'domain-module', 'backend-service'), 'scopes');
  assertEquals(inferPlacementKind(ctx, 'k8s-cluster', 'backend-service'), 'hosts');
  assertEquals(inferPlacementKind(ctx, 'app-scope', 'backend-service'), 'contains');
});

Deno.test('port injection: boundary role keeps its default_ports (interface IS the point)', () => {
  const r = ensureNodePorts(CATALOGS, 'scheduled-trigger', undefined);
  assertEquals(r.ports.map((p) => `${p.direction}:${p.name}`), ['out:trigger-out'], 'catalog default_ports materialized, not skipped');
  const c = ensureNodePorts(CATALOGS, 'domain-module', undefined);
  assertEquals(c.ports, [], 'containers still portless');
});

Deno.test('generate_task_docs: boundary node passes the leaf filter and gets an interface-mode packet', async () => {
  const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
  const BRANCH = '22222222-2222-4222-8222-222222222222';
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: twoNodeGraph() }, error: null });
  sb.script('node_roles', 'select', { data: Object.values(CATALOGS.nodeRoles).map(completeRole), error: null });
  sb.script('technology_catalog', 'select', { data: Object.values(CATALOGS.technologies), error: null });
  for (const t of ['deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: null, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const auth = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'propose'] } as never;
  const r = await handleGenerateTaskDocs(sb as never, auth, { project_id: PROJECT.id, branch_id: BRANCH });
  assertEquals(r.success, true);
  assertEquals((r.data as Record<string, unknown>).generated, 2, 'boundary AND leaf both get packets');

  const insert = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { type: string; payload: Record<string, unknown> } }>;
  };
  const docs = insert.patches.filter((p) => p.patch.type === 'add_artifact');
  const flowDoc = docs.find((p) => String(p.patch.payload.content).includes('Nightly Sync'))!;
  assert(String(flowDoc.patch.payload.content).includes('engine that owns its own internals'),
    'boundary packet is interface-mode over MCP too');
});

// ── Dogfood find 2026-09-02 (#5): project rulings can veto catalog guidance ──
Deno.test('metadata.suppressCatalogGuidance drops the Technology Guidance body, keeps everything else', () => {
  // deno-lint-ignore no-explicit-any
  const catalogs: any = JSON.parse(JSON.stringify(CATALOGS));
  catalogs.technologies.n8n.ai_context = {
    purpose: 'Workflow automation engine',
    bestPractices: ['USE CSHARP FOR COMPLEX SYSTEMS'],
  };
  const g = twoNodeGraph();

  const withGuidance = generateTaskDocument({ node: g.nodes[N_FLOW], graph: g, catalogs, requirements: [] });
  assert(withGuidance.includes('## Technology Guidance'), 'guidance renders by default');
  assert(withGuidance.includes('USE CSHARP FOR COMPLEX SYSTEMS'), 'catalog advice present by default');

  g.nodes[N_FLOW].metadata = { suppressCatalogGuidance: true };
  const suppressed = generateTaskDocument({ node: g.nodes[N_FLOW], graph: g, catalogs, requirements: [] });
  assert(!suppressed.includes('USE CSHARP FOR COMPLEX SYSTEMS'), 'the contradicting catalog advice is gone');
  assert(suppressed.includes('Catalog guidance suppressed for this node'), 'the packet says WHY the section is thin');
  assert(suppressed.includes('metadata.suppressCatalogGuidance'), 'and how to re-enable it');
  assert(suppressed.includes('# Task:'), 'the rest of the packet is untouched');
});

// The flag changes packet CONTENT, so it must move the fingerprint — otherwise the
// push-time freshness gate serves the pre-suppression packet forever. Present only
// when true: unflagged nodes keep byte-identical fingerprints (no re-stale round).
Deno.test('suppressCatalogGuidance moves the task fingerprint in BOTH directions; absence changes nothing', () => {
  const g = twoNodeGraph();
  const node = g.nodes[N_FLOW];

  const bare = computeTaskContextFingerprint(node, g, [], undefined, CATALOGS);
  node.metadata = { suppressCatalogGuidance: true };
  const flagged = computeTaskContextFingerprint(node, g, [], undefined, CATALOGS);
  assert(flagged.fingerprint !== bare.fingerprint, 'setting the flag stales the stored packet');
  assertEquals(flagged.fields.guidanceSuppressed, true, 'the field records WHY the fingerprint moved');

  node.metadata = { suppressCatalogGuidance: false };
  const unflagged = computeTaskContextFingerprint(node, g, [], undefined, CATALOGS);
  assertEquals(unflagged.fingerprint, bare.fingerprint, 'false and absent hash identically — only strict true participates');
  assert(!('guidanceSuppressed' in unflagged.fields), 'unflagged nodes keep the pre-change field set byte-identical');

  delete node.metadata;
  const cleared = computeTaskContextFingerprint(node, g, [], undefined, CATALOGS);
  assertEquals(cleared.fingerprint, bare.fingerprint, 'removing the flag returns to the original fingerprint (re-enables guidance ⇒ stale again)');
});

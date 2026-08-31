// WS3 — test-plan doctrine: split verification lanes + plans-follow-schemas.
//
// The pins here hold the generator restructure's four load-bearing properties:
// (1) criterion text renders ONCE (## Acceptance Criteria, AC-<REQ>-<n> ids, tagged
//     [automated]/[manual]) — every other section cites the id;
// (2) manual criteria route through ## Manual Verification (the R5 task-doc tick +
//     approval lane) and NEVER produce an automated scenario;
// (3) a criterion touching a schemaless non-dependency contract renders the one-line
//     [blocked by schema: …] marker — no Given/When/Then scaffolds anywhere;
// (4) the fingerprint's topology schema token MOVES when a schema lands, so a blocked
//     plan auto-unblocks at the next freshness pass (the design review's critical
//     catch — without it the marker would be permanent).
// Plus the shared-predicate wiring: get_test_plan's schemaBlockedContracts comes from
// contractSchemaGaps, built on the SAME isContractSchemaGap readiness blocks on.
import {
  generateTestDocument,
  computeTestContextFingerprint,
  contractSchemaGaps,
} from '../_shared/test-document-generator.ts';
import { generateTaskDocument, isContractSchemaGap } from '../_shared/task-document-generator.ts';
import { handleGetTestPlan } from '../mcp-server/tools/context.ts';
import { MCP_TOOLS } from '../mcp-server/tool-registry.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

const N_API = '33333333-3333-4333-8333-333333333333';
const N_PAY = '44444444-4444-4444-8444-444444444444';
const N_DNS = '55555555-5555-4555-8555-555555555555';

const MAPPED = [{ nodeId: N_API, label: 'API Service', role: 'backend-service', technology: 'express' }];
const EMPTY_CATALOGS: Any = { nodeRoles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} };

// One mapped node, three contracts: a schemaless rest gap ("Payments API"), a
// schema-carrying rest contract ("Status API"), and a schemaless dependency (never a
// gap). Passing withPaymentsSchema fills the gap inline — the unblock case.
function laneGraph(opts?: { withPaymentsSchema?: boolean }): Any {
  return {
    nodes: {
      [N_API]: { id: N_API, label: 'API Service', type: 'backend-service', technology: 'express', ports: [], artifacts: [] },
      [N_PAY]: { id: N_PAY, label: 'Payment Gateway', type: 'backend-service', technology: 'stripe', ports: [] },
      [N_DNS]: { id: N_DNS, label: 'DNS', type: 'dns-service', ports: [] },
    },
    edges: {
      e1: { id: 'e1', source: N_API, target: N_PAY, contractId: 'c1' },
      e2: { id: 'e2', source: N_PAY, target: N_API, contractId: 'c2' },
      e3: { id: 'e3', source: N_DNS, target: N_API, contractId: 'c3' },
    },
    contracts: {
      c1: { id: 'c1', name: 'Payments API', kind: 'rest', ...(opts?.withPaymentsSchema ? { specFormat: 'openapi', schema: { openapi: '3.1.0', paths: { '/payments': {} } } } : {}) },
      c2: { id: 'c2', name: 'Status API', kind: 'rest', specFormat: 'openapi', schema: { openapi: '3.1.0', paths: { '/status': {} } } },
      c3: { id: 'c3', name: 'Domain Reference', kind: 'dependency' },
    },
    artifacts: {},
  };
}

const AUTOMATED_TEXT = 'GET /health returns 200 within 250ms';
const BLOCKED_TEXT = 'Submitting a charge through the Payments API returns 201';
const MANUAL_TEXT = 'Operator confirms the refund email renders correctly';

function reqForGen(): Any {
  return {
    requirementId: 'REQ-009', name: 'Payments', description: 'Charge handling',
    category: 'functional', status: 'pending',
    acceptanceCriteria: [
      { text: AUTOMATED_TEXT, met: false },
      { text: BLOCKED_TEXT, met: false },
      { text: MANUAL_TEXT, met: false, verification: 'manual' },
    ],
  };
}

function genDoc(graph: Any): string {
  return generateTestDocument({
    requirement: reqForGen(), graph, catalogs: EMPTY_CATALOGS,
    mappedNodes: MAPPED as never, sourceArtifacts: [],
  });
}

// ── (1) criterion text once ───────────────────────────────────────────────────

Deno.test('WS3 plan: criterion text renders exactly ONCE — sections cite AC ids, headings use slugs', () => {
  const doc = genDoc(laneGraph());
  for (const text of [AUTOMATED_TEXT, BLOCKED_TEXT, MANUAL_TEXT]) {
    assertEquals(doc.split(text).length - 1, 1, `"${text}" must appear exactly once (in ## Acceptance Criteria)`);
  }
  assert(doc.includes('- **AC-REQ-009-1** [automated] [PENDING] ' + AUTOMATED_TEXT), 'AC id + lane tag + status + text on one row');
  assert(doc.includes('- **AC-REQ-009-3** [manual] [PENDING] ' + MANUAL_TEXT), 'manual lane tagged');
});

// ── (2) manual placement ──────────────────────────────────────────────────────

Deno.test('WS3 plan: manual criterion lives in ## Manual Verification (tick+approval lane), never in Automated Test Scenarios', () => {
  const doc = genDoc(laneGraph());
  const manualSection = doc.slice(doc.indexOf('## Manual Verification'));
  assert(doc.includes('## Manual Verification'), 'section exists when a manual criterion exists');
  assert(manualSection.includes('- [ ] AC-REQ-009-3'), 'manual criterion checklisted by id');
  assert(manualSection.includes('report_test_results REFUSES'), 'the lane rule is stated where the human reads it');
  assert(manualSection.includes('task document'), 'routes through the task-doc tick + approval');
  assert(!doc.includes('#### AC-REQ-009-3'), 'no automated scenario derived for a manual criterion');
  assert(!doc.includes('test_id "TC-REQ-009-3"'), 'no suggested test case for a manual criterion');

  // No manual criteria → no section (derived sections never render empty).
  const req = reqForGen();
  req.acceptanceCriteria = req.acceptanceCriteria.filter((c: Any) => c.verification !== 'manual');
  const doc2 = generateTestDocument({ requirement: req, graph: laneGraph(), catalogs: EMPTY_CATALOGS, mappedNodes: MAPPED as never, sourceArtifacts: [] });
  assert(!doc2.includes('## Manual Verification'));
});

// ── (3) blocked one-liner, scaffold diet ──────────────────────────────────────

Deno.test('WS3 plan: schemaless-contract criterion gets the one-line blocked marker; NO Given/When/Then scaffolds anywhere', () => {
  const doc = genDoc(laneGraph());
  assert(doc.includes('#### AC-REQ-009-2:'), 'blocked criterion keeps its scenario heading');
  assert(
    doc.includes('[blocked by schema: contract "Payments API" — resolve via get_build_readiness, then this plan refreshes]'),
    'the exact one-line marker (also what the docs cite)',
  );
  assert(!doc.includes('test_id "TC-REQ-009-2"'), 'no derive-and-report line while blocked');
  assert(doc.includes('Derive the test from AC-REQ-009-1') && doc.includes('test_id "TC-REQ-009-1"'),
    'the unblocked criterion gets its derive-and-report line');
  // Scaffold diet: the blank G/W/T template and the static Edge Cases filler are gone.
  for (const dead of ['**Given:**', '**When:**', '**Then:**', '### Edge Cases', '### Test Scenarios']) {
    assert(!doc.includes(dead), `scaffold "${dead}" must not render`);
  }
  // The editable seed survives — the freshness pins key on these literals.
  assert(doc.includes('<!-- Edit this section to refine the testing approach -->'), 'editable marker kept');
  assert(doc.includes('- [ ] Define test data fixtures'), 'fixture seed kept');
  // Contract Validation is a DERIVED level-2 section now — outside ## Test Strategy.
  assert(doc.indexOf('## Contract Validation') < doc.indexOf('## Test Strategy'), 'moved out of the editable region');
});

Deno.test('WS3 plan: schema bodies never inline — presence line with specFormat, size, h8; blocked contract marked in Contract Validation', () => {
  const doc = genDoc(laneGraph());
  assert(/schema present \(openapi, \d+ chars, hash [0-9a-f]{8}\)/.test(doc), 'Status API reports presence, not the body');
  assert(!doc.includes('"openapi": "3.1.0"'), 'no schema body in the plan');
  assert(doc.includes('dependency contract (no payload schema expected)'), 'dependency contracts are not schema gaps');
  const validation = doc.slice(doc.indexOf('## Contract Validation'), doc.indexOf('## Manual Verification'));
  assert(validation.includes('#### Payments API (rest)'), 'gap contract listed');
  assert(validation.includes('[blocked by schema: contract "Payments API"'), 'with the blocked marker, not invented checks');
});

Deno.test('WS3 plan: project vision trimmed to ~400 chars', () => {
  const doc = generateTestDocument({
    requirement: reqForGen(), graph: laneGraph(), catalogs: EMPTY_CATALOGS,
    mappedNodes: MAPPED as never, sourceArtifacts: [], projectVision: 'V'.repeat(1200),
  });
  const contextSection = doc.slice(doc.indexOf('## Project Context'), doc.indexOf('## Acceptance Criteria'));
  assert(contextSection.includes('V'.repeat(400) + ' …'), 'trimmed with ellipsis');
  assert(!contextSection.includes('V'.repeat(401)), 'never the full body');
});

// ── (4) fingerprint schema token ──────────────────────────────────────────────

Deno.test('WS3 fingerprint: topology carries the schema token and MOVES when the schema lands — a blocked plan auto-unblocks', () => {
  const before = computeTestContextFingerprint(reqForGen(), MAPPED as never, [], laneGraph());
  const after = computeTestContextFingerprint(reqForGen(), MAPPED as never, [], laneGraph({ withPaymentsSchema: true }));
  assert(before.fields.connectedTopology.some((t: string) => t.includes(':rest:noschema')), 'schemaless contract tokens noschema');
  assert(before.fields.connectedTopology.some((t: string) => /:rest:schema-[0-9a-f]{8}$/.test(t)), 'schema-carrying contract tokens its h8');
  assert(after.fields.connectedTopology.every((t: string) => !t.includes('noschema') || t.includes('dependency')), 'landing the schema replaces the noschema token');
  assert(before.fingerprint !== after.fingerprint, 'fingerprint moves → freshness gate regenerates → blocked marker clears');
});

Deno.test('WS3 fingerprint: moving a criterion between lanes moves the fingerprint (the plan resections)', () => {
  const req = reqForGen();
  const before = computeTestContextFingerprint(req, MAPPED as never, [], laneGraph());
  req.acceptanceCriteria[0].verification = 'manual';
  const after = computeTestContextFingerprint(req, MAPPED as never, [], laneGraph());
  assert(before.fingerprint !== after.fingerprint);
});

// ── shared predicate: readiness and the plan lane cannot diverge ──────────────

Deno.test('WS3 contractSchemaGaps: same predicate as readiness — schemaless non-dependency contracts on mapped nodes only', () => {
  const gaps = contractSchemaGaps(laneGraph(), [N_API]);
  assertEquals(gaps, [{ contractName: 'Payments API', contractKind: 'rest' }]);
  assertEquals(contractSchemaGaps(laneGraph({ withPaymentsSchema: true }), [N_API]), [], 'schema landed → no gap');
  assertEquals(contractSchemaGaps(laneGraph(), []), [], 'no mapped nodes → no contracts in scope');
  // The predicate itself: dependency by kind OR interactionKind is never a gap.
  assert(isContractSchemaGap({ contractKind: 'rest', interactionKind: null, schemaContent: null }));
  assert(!isContractSchemaGap({ contractKind: 'rest', interactionKind: 'dependency', schemaContent: null }));
  assert(!isContractSchemaGap({ contractKind: 'dependency', interactionKind: null, schemaContent: null }));
  assert(!isContractSchemaGap({ contractKind: 'rest', interactionKind: null, schemaContent: '{}' }));
});

Deno.test('WS3 wiring: readiness blocks on isContractSchemaGap and the test lane imports it — single-sourced predicate', () => {
  const taskSrc = Deno.readTextFileSync(new URL('../_shared/task-document-generator.ts', import.meta.url));
  assert(taskSrc.includes('if (!isContractSchemaGap(c)) continue;'), 'assessNodeReadiness keys its schema blockers on THE predicate');
  const testSrc = Deno.readTextFileSync(new URL('../_shared/test-document-generator.ts', import.meta.url));
  assert(testSrc.includes('import { isContractSchemaGap, simpleHash } from "./task-document-generator.ts"'),
    'test lane imports the predicate + the single-sourced h8 — never a local copy');
  assert(!/^function simpleHash/m.test(testSrc), 'the local simpleHash copy stays deleted');
});

// ── get_test_plan response: schemaBlockedContracts + doctrine ─────────────────

Deno.test('WS3 get_test_plan: response carries schemaBlockedContracts (shared helper) and the one-line ordering doctrine', async () => {
  const sb = new FakeSupabase();
  const g = laneGraph();
  // Stored plan → no generation, no catalog load; the gap list still computes.
  g.artifacts['tp1'] = {
    id: 'tp1', nodeId: N_API, kind: 'test-plan', path: '.nodespec/tests/req-009.tests.md',
    content: 'STORED', metadata: { testContextFingerprint: { fingerprint: 'f1' }, requirementId: 'REQ-009' },
  };
  sb.script('projects', 'select', { data: { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' }, error: null });
  sb.script('specification_requirements', 'select', {
    data: { id: 'row-9', requirement_id: 'REQ-009', name: 'Payments', description: 'd', category: 'functional', status: 'pending', acceptance_criteria: [{ text: BLOCKED_TEXT }], specification_id: 'spec-1' },
    error: null,
  });
  sb.script('graph_snapshots', 'select', { data: { graph_data: g }, error: null });
  sb.script('specification_mappings', 'select', { data: [{ node_id: N_API }], error: null });
  sb.script('test_cases', 'select', { data: [], error: null });

  const r = await handleGetTestPlan(sb as never, { userId: 'user-1', authMethod: 'api_key', scopes: ['read'] } as never, {
    project_id: '11111111-1111-4111-8111-111111111111', branch_id: 'b1', requirement_id: 'row-9',
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as Any;
  assertEquals(data.schemaBlockedContracts, ['Payments API'], 'the gap list rides the response');
  assert(String(data.doctrine).includes('Plans follow schemas'), 'ordering doctrine stated as data, not prose to infer');
  assert(String(data.doctrine).includes('report_test_results') && String(data.doctrine).includes('manual'),
    'doctrine names both verification lanes');
});

// ── task-doc side: (manual) rows + split-lane final work order ────────────────

Deno.test('WS3 task doc: manual criteria rows marked (manual); final verification work order states ordering + both lanes', () => {
  const graph = laneGraph();
  const doc = generateTaskDocument({
    node: graph.nodes[N_API], graph, catalogs: EMPTY_CATALOGS,
    requirements: [reqForGen()],
  });
  assert(doc.includes(`- [ ] ${MANUAL_TEXT} (manual)`), 'manual row carries the lane cue');
  assert(doc.includes(`- [ ] ${AUTOMATED_TEXT}`) && !doc.includes(`${AUTOMATED_TEXT} (manual)`), 'automated rows unmarked');
  assert(doc.includes('plans follow schemas (contract-first TDD): schemas → test plans → implement → verify'), 'ordering doctrine in the final work order');
  assert(doc.includes('AUTOMATED criteria: call get_test_plan'), 'automated lane instruction kept');
  assert(doc.includes('MANUAL criteria (rows marked (manual) above): report_test_results REFUSES'), 'manual lane branch stated');
});

// ── registry doctrine ─────────────────────────────────────────────────────────

Deno.test('WS3 registry: verification field documented on requirement writes; manual-lane + plans-follow-schemas doctrine on the read/report tools', () => {
  const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;
  for (const name of ['create_requirement', 'update_requirement']) {
    const tool = byName(name);
    assert(tool.description.includes("verification"), `${name}: describes the lane field`);
    const items = (tool.inputSchema as Any).properties.acceptance_criteria.items;
    assertEquals(items.anyOf[1].properties.verification.enum, ['automated', 'manual'], `${name}: object form schema`);
  }
  assert(byName('update_requirement').description.includes('met/testId/provenance/verification'), 'carry-forward discipline documented');
  assert(byName('report_test_results').description.includes("manual-lane"), 'refusal outcome named');
  const gtp = byName('get_test_plan');
  assert(gtp.description.includes('plans follow schemas (contract-first TDD)'), 'ordering doctrine on get_test_plan');
  assert(gtp.description.includes('schemaBlockedContracts'), 'response field documented');
});

// ── mock-services seed is conditional (dogfood find 2026-09-02, #6) ───────────
Deno.test('setup seeds: mock-services line only when a cross-boundary edge exists', () => {
  // laneGraph wires API Service -> Payment Gateway (outside the mapped set):
  // external dependency exists, the mock line earns its place.
  const withExternal = genDoc(laneGraph());
  assert(withExternal.includes('Set up mock services for external dependencies'), 'external deps present -> line present');

  // A self-contained graph (every edge endpoint mapped, or no edges at all —
  // the Godot game shape) must NOT tell the AI to mock services it has none of.
  const selfContained = laneGraph();
  selfContained.edges = {};
  const without = genDoc(selfContained);
  assert(!without.includes('Set up mock services'), 'no external deps -> no mock-services boilerplate');
  assert(without.includes('Define test data fixtures'), 'the other seeds stay');
  assert(without.includes('Configure test environment variables'), 'the other seeds stay');
});

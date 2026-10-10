import type { CatalogData } from "./catalog-loader.ts";
// WS3: simpleHash is single-sourced in task-document-generator.ts (WS1 exported it so
// every surface derives the same h8 from the same schema content — the Interfaces
// section's `hash <h8>` and the fingerprint's schema token below MUST match
// get_project_context's schemaHash). isContractSchemaGap is THE shared schema-gap
// predicate — the same one get_build_readiness blocks on, so the plan's
// [blocked by schema: …] markers can never disagree with readiness.
import { isContractSchemaGap, simpleHash } from "./task-document-generator.ts";
import {
  criterionTextById, planStatements,
  SCENARIO_HEADING, MANUAL_ITEM, SCENARIOS_HEADING, MANUAL_HEADING, STATEMENTS_TO_REVIEW_HEADING, REVIEW_NOTE,
} from "./plan-cases.ts";
// AL.29: the plan's reader and its lookup live in plan-cases.ts (the app reads plans
// with it too); these names stay importable from here.
export { findExistingTestArtifact, getTestDocumentPath, planCases, planStatements, statementGaps, STATEMENTS_TO_REVIEW_HEADING, type PlanCase } from "./plan-cases.ts";

interface GraphNode {
  id: string;
  label: string;
  type: string;
  technology?: string;
  parentId?: string;
  metadata?: {
    rationale?: string;
    domainMetadata?: unknown;
    [key: string]: unknown;
  };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  contractId: string;
}

interface GraphContract {
  id: string;
  name: string;
  kind: string;
  interactionKind?: string;
  transport?: string;
  specFormat?: string;
  schema?: Record<string, unknown>;
  schemaRef?: string;
}

interface GraphArtifact {
  id: string;
  nodeId: string;
  kind: string;
  path: string;
  content?: string;
  language?: string;
  status?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

interface GraphData {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  contracts: Record<string, GraphContract>;
  artifacts: Record<string, GraphArtifact>;
}

interface RequirementForTest {
  requirementId: string;
  name: string;
  description: string;
  category: string;
  /** WS3: verification 'manual' = R5 tick+approval lane; absent = automated (D-2). */
  acceptanceCriteria: Array<{ text: string; met?: boolean; verification?: string }>;
}

interface MappedNode {
  nodeId: string;
  label: string;
  role: string;
  technology?: string;
}

export interface TestDocumentInput {
  requirement: RequirementForTest;
  graph: GraphData;
  catalogs: CatalogData;
  mappedNodes: MappedNode[];
  sourceArtifacts: GraphArtifact[];
}

// WS3 restructure (owner-measured ~85k tokens for get_test_plan×17 — criterion text
// shipped ×3 plus blank Given/When/Then scaffolds): criterion text renders ONCE, in
// ## Acceptance Criteria under a stable AC-<REQ>-<n> id, and every other section cites
// the id. The derived ## Automated Test Scenarios section replaces the scaffolds with
// one derive-and-report line per automated criterion — or, when the criterion touches
// a schemaless non-dependency contract, the one-line [blocked by schema: …] marker
// (plans follow schemas — contract-first TDD; the fingerprint's schema token refreshes
// the plan when the schema lands). Manual criteria route through ## Manual
// Verification (the R5 task-doc tick + approval lane, never report_test_results).
// ## Test Strategy stays the ONLY editable section — its <!-- Edit --> marker and
// fixture seed lines are pinned by the freshness suite.
export function generateTestDocument(input: TestDocumentInput): string {
  const { requirement, graph, catalogs, mappedNodes, sourceArtifacts } = input;

  const lines: string[] = [];

  lines.push(`# Test Plan: ${requirement.requirementId} - ${requirement.name}`);
  lines.push("");

  // -- Testing Objectives --
  lines.push("## Testing Objectives");
  lines.push("");
  lines.push(`**Requirement:** ${requirement.name}`);
  lines.push(`**Category:** ${requirement.category}`);
  if (requirement.description) {
    lines.push(`**Description:** ${requirement.description}`);
  }
  lines.push("");

  // AL.29 R1 (owner 2026-10-09): no vision in a test plan. The read and the push
  // gate passed different visions, so the file in git and NodeSpec's copy never
  // agreed; the task doc carries the vision its node serves.

  const criteria = requirement.acceptanceCriteria.map((ac, i) => ({
    text: ac.text,
    met: ac.met === true,
    manual: ac.verification === "manual",
    acId: `AC-${requirement.requirementId}-${i + 1}`,
    tcId: `TC-${requirement.requirementId}-${i + 1}`,
  }));

  // -- Acceptance Criteria: the ONE place criterion text renders --
  if (criteria.length > 0) {
    lines.push("## Acceptance Criteria");
    lines.push("");
    lines.push("Criterion text lives HERE once; every section below cites the AC id.");
    lines.push("");
    for (const c of criteria) {
      lines.push(`- **${c.acId}** [${c.manual ? "manual" : "automated"}] [${c.met ? "VERIFIED" : "PENDING"}] ${c.text}`);
    }
    lines.push("");
  }

  // -- Criterion Assessment (cites ids — the text is one section up) --
  const assessments = requirement.acceptanceCriteria.map((ac, i) => assessCriterion(ac.text, i));
  const issueCount = assessments.filter(a => a.issues.length > 0).length;
  if (assessments.length > 0) {
    lines.push("## Criterion Assessment");
    lines.push("");
    if (issueCount === 0) {
      lines.push("All criteria appear specific and testable.");
    } else {
      lines.push(`${issueCount} of ${assessments.length} criteria have potential quality issues:`);
      lines.push("");
      for (const a of assessments) {
        if (a.issues.length === 0) continue;
        lines.push(`**${criteria[a.index].acId}:**`);
        for (const issue of a.issues) {
          lines.push(`- ${issue.severity}: ${issue.message}`);
        }
        if (a.suggestion) {
          lines.push(`- Suggestion: ${a.suggestion}`);
        }
        lines.push("");
      }
    }
    lines.push("");
  }

  // -- Recommended Test Types --
  const testTypes = inferTestTypes(requirement, mappedNodes, sourceArtifacts);
  if (testTypes.length > 0) {
    lines.push("## Recommended Test Types");
    lines.push("");
    for (const tt of testTypes) {
      lines.push(`### ${tt.type}`);
      lines.push(`- **Scope:** ${tt.scope}`);
      lines.push(`- **Rationale:** ${tt.rationale}`);
      lines.push("");
    }
  }

  // -- Framework Recommendation --
  const framework = inferFramework(mappedNodes, catalogs);
  if (framework) {
    lines.push("## Suggested Framework");
    lines.push("");
    lines.push(`**Framework:** ${framework.name}`);
    if (framework.reason) lines.push(`**Reason:** ${framework.reason}`);
    lines.push("");
  }

  // -- Mapped Architecture Nodes --
  if (mappedNodes.length > 0) {
    lines.push("## Architecture Components Under Test");
    lines.push("");
    lines.push("| Component | Role | Technology |");
    lines.push("|-----------|------|------------|");
    for (const mn of mappedNodes) {
      const tech = mn.technology || "---";
      lines.push(`| ${mn.label} | ${mn.role} | ${tech} |`);
    }
    lines.push("");
  }

  // -- Interface Contracts (WS3 diet: presence + size + h8, never the body — the
  // hash matches get_project_context's schemaHash, so "did it move?" is answerable
  // without shipping the spec; read the body via get_project_context view 'full') --
  const contracts = buildTestContracts(mappedNodes, graph);
  if (contracts.length > 0) {
    lines.push("## Interfaces & Contracts to Verify");
    lines.push("");
    for (const c of contracts) {
      lines.push(`- **${c.sourceLabel}** -> **${c.targetLabel}** via \`${c.contractKind}\` ("${c.contractName}") — ${schemaStatusFor(c)}`);
    }
    lines.push("");
  }

  // -- Source Artifacts --
  if (sourceArtifacts.length > 0) {
    lines.push("## Source Artifacts");
    lines.push("");
    lines.push("| File | Kind | Language | Component |");
    lines.push("|------|------|----------|-----------|");
    for (const a of sourceArtifacts) {
      const lang = a.language || "---";
      const nodeLabel = graph.nodes[a.nodeId]?.label || a.nodeId;
      lines.push(`| \`${a.path}\` | ${a.kind} | ${lang} | ${nodeLabel} |`);
    }
    lines.push("");
  }

  // -- Automated Test Scenarios (DERIVED — outside the editable region; the old
  // blank Given/When/Then scaffolds are gone: deriving the test IS the consuming
  // AI's job, and a schemaless contract makes derivation unsafe, so those criteria
  // carry the one-line blocked marker instead — plans follow schemas) --
  const automated = criteria.filter((c) => !c.manual);
  const manual = criteria.filter((c) => c.manual);
  const gapContracts = contracts.filter((c) => isContractSchemaGap(c));

  lines.push("## Automated Test Scenarios");
  lines.push("");
  lines.push("Each heading and the line under it are derived and regenerate when criteria, mappings, or contract schemas change. Under each heading, write the test's statements as checkbox lines (\"- [ ] Given ..., when ..., then ...\", with a then that can be observed and names the file or API it checks); they are kept with their criterion through every regeneration. Implement and run the test, then report the outcome via report_test_results using the suggested test_id and the criterion's EXACT text as criterion_text (that binding is what flips met).");
  lines.push("");
  if (automated.length === 0) {
    lines.push(criteria.length === 0
      ? "_Define acceptance criteria to generate test scenarios._"
      : "_Every criterion is manual — see Manual Verification._");
    lines.push("");
  }
  for (const c of automated) {
    lines.push(`#### ${c.acId}: ${criterionSlug(c.text)}`);
    const blockedBy = findContractsForCriterion(c.text, gapContracts, graph);
    if (blockedBy.length > 0) {
      lines.push(schemaBlockedMarker(blockedBy.map((b) => b.contractName)));
    } else {
      lines.push(`Derive the test from ${c.acId} and report the outcome with test_id "${c.tcId}".`);
    }
    lines.push("");
  }

  // -- Contract Validation (DERIVED — moved OUT of the editable region so it
  // regenerates when schemas land; schemaless contracts show the blocked marker) --
  if (contracts.length > 0) {
    lines.push("## Contract Validation");
    lines.push("");
    lines.push("Derived checks per contract — regenerates when schemas change; do not edit.");
    lines.push("");
    const contractTests = buildContractValidationTests(contracts.filter((c) => !isContractSchemaGap(c)), graph);
    for (const ct of contractTests) {
      lines.push(`#### ${ct.contractName} (${ct.direction}: ${ct.connectedLabel})`);
      for (const desc of ct.testDescriptions) {
        lines.push(`- [ ] ${desc}`);
      }
      lines.push("");
    }
    for (const gc of gapContracts) {
      lines.push(`#### ${gc.contractName} (${gc.contractKind})`);
      lines.push(schemaBlockedMarker([gc.contractName]));
      lines.push("");
    }
  }

  // -- Manual Verification (WS3 split lanes: these are proven by a human through the
  // R5 task-doc tick + approval lane — explicitly NOT report_test_results) --
  if (manual.length > 0) {
    lines.push("## Manual Verification");
    lines.push("");
    lines.push("These criteria are proven by a HUMAN: perform the check, tick the criterion box in the owning node's task document, and have the user approve the resulting change card — that approval is what flips met. report_test_results REFUSES to bind manual criteria; do not author test cases for them.");
    lines.push("");
    for (const c of manual) {
      lines.push(`- [ ] ${c.acId} — verify per the criterion text above, then tick + approve via the task doc`);
    }
    lines.push("");
  }

  // -- Editable Strategy Section (the ONLY editable region — marker + fixture seeds
  // are load-bearing: the freshness gate carries a user-edited body forward verbatim
  // and its pins key on these literals) --
  lines.push("## Test Strategy");
  lines.push("");
  lines.push("<!-- Edit this section to refine the testing approach -->");
  lines.push("");
  lines.push("### Setup & Fixtures");
  lines.push("");
  lines.push("- [ ] Define test data fixtures");
  // Dogfood find 2026-09-02 (#6): "mock services" only means something when
  // this requirement's nodes actually talk to components OUTSIDE the mapped
  // set — a self-contained game project got the line in all 30 plans. Emit
  // it only when a cross-boundary edge exists.
  {
    const mappedIds = new Set(mappedNodes.map((n) => n.nodeId));
    const hasExternalDependency = Object.values(graph.edges).some(
      (e) => mappedIds.has(e.source) !== mappedIds.has(e.target),
    );
    if (hasExternalDependency) {
      lines.push("- [ ] Set up mock services for external dependencies");
    }
  }
  lines.push("- [ ] Configure test environment variables");
  lines.push("");

  return lines.join("\n");
}

// The scenario heading's slug — deliberately NOT the verbatim criterion text (the
// text renders exactly once, in ## Acceptance Criteria; the heading only needs to be
// recognizable and grep-able).
function criterionSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length <= 60 ? slug : slug.slice(0, 60).replace(/-+$/g, "");
}

// WS3 plans-follow-schemas: the ONE blocked-marker wording. get_build_readiness is the
// resolution lane (its schema blockers carry draftInputs); the fingerprint's schema
// token refreshes the plan when the schema lands, unblocking the scenario.
function schemaBlockedMarker(contractNames: string[]): string {
  const list = contractNames.map((n) => `contract "${n}"`).join(", ");
  return `[blocked by schema: ${list} — resolve via get_build_readiness, then this plan refreshes]`;
}

// The Interfaces line's schema status: presence + dialect + size + the SAME h8 every
// other surface derives from identical content (simpleHash is single-sourced).
function schemaStatusFor(c: ContractForTest): string {
  if (c.contractKind === "dependency" || c.interactionKind === "dependency") {
    return "dependency contract (no payload schema expected)";
  }
  if (c.schemaContent) {
    return `schema present (${c.specFormat || "format unspecified"}, ${c.schemaContent.length} chars, hash ${simpleHash(c.schemaContent)})`;
  }
  return `schema MISSING — ${schemaBlockedMarker([c.contractName])}`;
}

interface TestTypeRecommendation {
  type: string;
  scope: string;
  rationale: string;
}

function inferTestTypes(
  requirement: RequirementForTest,
  mappedNodes: MappedNode[],
  sourceArtifacts: GraphArtifact[],
): TestTypeRecommendation[] {
  const types: TestTypeRecommendation[] = [];

  if (requirement.acceptanceCriteria.length > 0) {
    types.push({
      type: "Acceptance / BDD",
      scope: "Requirement-level behavior validation",
      rationale: `${requirement.acceptanceCriteria.length} acceptance criteria defined`,
    });
  }

  if (sourceArtifacts.length > 0) {
    types.push({
      type: "Unit",
      scope: "Individual function/method correctness",
      rationale: `${sourceArtifacts.length} source artifact(s) available for targeted testing`,
    });
  }

  if (mappedNodes.length >= 2) {
    types.push({
      type: "Integration",
      scope: "Cross-component communication and data flow",
      rationale: `${mappedNodes.length} architectural components mapped to this requirement`,
    });
  }

  if (requirement.category === "non-functional") {
    types.push({
      type: "Performance / Load",
      scope: "Response time, throughput, resource usage",
      rationale: "Non-functional requirement - likely needs performance validation",
    });
  }

  return types;
}

interface FrameworkRecommendation {
  name: string;
  reason: string;
}

function inferFramework(
  mappedNodes: MappedNode[],
  catalogs: CatalogData,
): FrameworkRecommendation | null {
  const techs = mappedNodes
    .filter((n) => n.technology)
    .map((n) => n.technology!)
    .map((t) => catalogs.technologies[t])
    .filter(Boolean);

  for (const tech of techs) {
    const aiCtx = tech?.ai_context;
    if (aiCtx?.testingPatterns?.framework) {
      return {
        name: aiCtx.testingPatterns.framework,
        reason: `Recommended for ${tech.name} projects`,
      };
    }
  }

  // ── keyed on technology ID, never on the display NAME ────────────────────────────────
  // This block used to be four `name.toLowerCase().includes(...)` tests, and the `"go"` one
  // matched 48 of the 297 catalog rows: every Google Cloud service, plus Algolia, ArgoCD,
  // MongoDB and Godot. Exactly one of the 48 was actually Go. A Godot game therefore had
  // "go test" recommended to the user's AI, and so did any GCP project that happened not to
  // also carry a React/Node/Python technology — the first match wins, and `go` was last.
  //
  // `name` is prose and will keep colliding; `id` is the stable key the whole catalog is
  // addressed by. Unknown technologies now return null: the Test Plan simply omits the
  // Framework line, which is strictly better than naming the wrong one. An AI told "go test"
  // for a GDScript project does not degrade gracefully — it writes Go.
  const TEST_FRAMEWORK_BY_TECH_ID: Record<string, FrameworkRecommendation> = {
    // Game engines — the family that surfaced this bug.
    "godot": { name: "GdUnit4", reason: "Godot 4's maintained test framework (GDScript and C#); GUT is the Godot 3 answer" },
    "unity": { name: "Unity Test Framework", reason: "Unity's built-in edit-mode and play-mode test runner" },
    "unreal-engine": { name: "Unreal Automation System", reason: "Unreal's built-in automation and functional test harness" },

    // Languages and runtimes.
    "go-backend": { name: "go test", reason: "Go built-in testing" },
    "python-backend": { name: "pytest", reason: "Python ecosystem standard" },
    "nodejs": { name: "Vitest", reason: "Modern Node.js test runner" },
    "rust-backend": { name: "cargo test", reason: "Rust built-in testing" },
    "java-backend": { name: "JUnit 5", reason: "Java ecosystem standard" },
    "kotlin-backend": { name: "JUnit 5 + Kotest", reason: "Kotlin JVM standard" },
    "ruby-backend": { name: "RSpec", reason: "Ruby ecosystem standard" },
    "php-backend": { name: "PHPUnit", reason: "PHP ecosystem standard" },
    "dotnet-worker": { name: "xUnit", reason: ".NET ecosystem standard" },

    // UI frameworks.
    "react": { name: "Vitest + React Testing Library", reason: "React ecosystem standard" },
    "react-native": { name: "Jest + React Native Testing Library", reason: "React Native ecosystem standard" },
    "vue": { name: "Vitest + Vue Test Utils", reason: "Vue ecosystem standard" },
    "svelte": { name: "Vitest + Testing Library", reason: "Svelte ecosystem standard" },
    "flutter": { name: "flutter_test", reason: "Flutter's bundled widget and unit test framework" },
    "swift-ios": { name: "XCTest", reason: "Apple's bundled test framework" },
    "kotlin-android": { name: "JUnit + Espresso", reason: "Android ecosystem standard" },
  };

  for (const tech of techs) {
    const hit = tech?.id ? TEST_FRAMEWORK_BY_TECH_ID[tech.id] : undefined;
    if (hit) return hit;
  }

  // No confident answer. Say nothing rather than guess — see the note above.
  return null;
}

interface ContractForTest {
  contractId: string;
  sourceLabel: string;
  targetLabel: string;
  contractKind: string;
  /** WS3: carried so isContractSchemaGap sees the same dependency evidence readiness does. */
  interactionKind: string | null;
  specFormat: string | null;
  contractName: string;
  schemaContent: string | null;
}

// Inline-first schema resolution — the same precedence as buildContractSection in
// task-document-generator.ts and buildNodeContext in mcp-context-assembly.ts, and the
// same pretty-printed serialization, so the h8 of identical content matches across
// every surface (a dangling schemaRef resolves to null = gap).
function resolveContractSchemaContent(contract: GraphContract | undefined, graph: GraphData): string | null {
  if (!contract) return null;
  if (contract.schema && Object.keys(contract.schema).length > 0) {
    return JSON.stringify(contract.schema, null, 2);
  }
  if (contract.schemaRef) {
    const sa = graph.artifacts[contract.schemaRef];
    if (sa?.content) {
      return typeof sa.content === "string" ? sa.content : JSON.stringify(sa.content, null, 2);
    }
  }
  return null;
}

function buildTestContracts(mappedNodes: MappedNode[], graph: GraphData): ContractForTest[] {
  const nodeIds = new Set(mappedNodes.map((n) => n.nodeId));
  const results: ContractForTest[] = [];
  const seen = new Set<string>();

  for (const edge of Object.values(graph.edges)) {
    if (!nodeIds.has(edge.source) && !nodeIds.has(edge.target)) continue;

    if (seen.has(edge.id)) continue;
    seen.add(edge.id);

    const contract = graph.contracts[edge.contractId];
    if (!contract) continue;

    const sourceNode = graph.nodes[edge.source];
    const targetNode = graph.nodes[edge.target];

    results.push({
      contractId: contract.id,
      sourceLabel: sourceNode?.label || edge.source,
      targetLabel: targetNode?.label || edge.target,
      contractKind: contract.kind,
      interactionKind: contract.interactionKind || null,
      specFormat: contract.specFormat || null,
      contractName: contract.name,
      schemaContent: resolveContractSchemaContent(contract, graph),
    });
  }

  return results;
}

// WS3: get_test_plan's schemaBlockedContracts — the mapped-node view of the schema-gap
// workflow, built on the SAME predicate readiness blocks on (isContractSchemaGap,
// single-sourced) over the same contracts the plan derives scenarios from, so the
// response field can never disagree with get_build_readiness or the plan body.
export function contractSchemaGaps(
  graph: GraphData,
  mappedNodeIds: string[],
): Array<{ contractName: string; contractKind: string }> {
  const mappedNodes: MappedNode[] = mappedNodeIds
    .map((id) => graph.nodes[id])
    .filter(Boolean)
    .map((n) => ({ nodeId: n.id, label: n.label, role: n.type, technology: n.technology }));
  const gaps: Array<{ contractName: string; contractKind: string }> = [];
  const seen = new Set<string>();
  for (const c of buildTestContracts(mappedNodes, graph)) {
    if (!isContractSchemaGap(c) || seen.has(c.contractId)) continue;
    seen.add(c.contractId);
    gaps.push({ contractName: c.contractName, contractKind: c.contractKind });
  }
  return gaps;
}

function findContractsForCriterion(
  criterionText: string,
  contracts: ContractForTest[],
  _graph: GraphData
): ContractForTest[] {
  const lower = criterionText.toLowerCase();
  return contracts.filter((c) => {
    const keywords = [
      c.sourceLabel.toLowerCase(),
      c.targetLabel.toLowerCase(),
      c.contractName.toLowerCase(),
      ...c.contractName.toLowerCase().split(/[\s_-]+/).filter(k => k.length > 2),
    ];
    return keywords.some((kw) => lower.includes(kw));
  });
}

interface ContractValidationTest {
  contractName: string;
  contractKind: string;
  direction: "inbound" | "outbound";
  connectedLabel: string;
  testDescriptions: string[];
}

function buildContractValidationTests(
  contracts: ContractForTest[],
  _graph: GraphData
): ContractValidationTest[] {
  const results: ContractValidationTest[] = [];

  for (const c of contracts) {
    const tests: string[] = [];
    const interaction = c.contractKind;

    if (interaction === "request_response" || interaction === "rest_api") {
      tests.push(`should return 400 when ${c.contractName} request is missing required fields`);
      tests.push(`should return 401 when ${c.contractName} request has invalid authentication`);
      tests.push(`should return 200 with valid response shape for ${c.contractName}`);
      tests.push(`should handle timeout from ${c.targetLabel} gracefully`);
      if (c.schemaContent) {
        tests.push(`should validate response schema matches contract definition for ${c.contractName}`);
      }
    } else if (interaction === "event" || interaction === "pub_sub") {
      tests.push(`should emit well-formed event for ${c.contractName} with required fields`);
      tests.push(`should handle malformed incoming event from ${c.sourceLabel} without crashing`);
      tests.push(`should route unprocessable events to dead-letter for ${c.contractName}`);
    } else if (interaction === "queue" || interaction === "async_job") {
      tests.push(`should process ${c.contractName} messages idempotently`);
      tests.push(`should retry failed ${c.contractName} jobs with exponential backoff`);
      tests.push(`should move permanently failed jobs to DLQ after max retries`);
    } else if (interaction === "data_read" || interaction === "data_write" || interaction === "database") {
      tests.push(`should handle ${c.targetLabel} connection failure gracefully`);
      tests.push(`should validate data integrity for ${c.contractName} operations`);
      tests.push(`should handle constraint violations from ${c.targetLabel}`);
    } else if (interaction === "grpc") {
      tests.push(`should return INVALID_ARGUMENT for malformed ${c.contractName} requests`);
      tests.push(`should handle UNAVAILABLE status from ${c.targetLabel}`);
      tests.push(`should validate protobuf schema compliance for ${c.contractName}`);
    } else if (interaction === "websocket" || interaction === "realtime") {
      tests.push(`should handle disconnection from ${c.targetLabel} with reconnection`);
      tests.push(`should validate message format for ${c.contractName} channel`);
    } else {
      tests.push(`should verify ${c.contractName} contract between ${c.sourceLabel} and ${c.targetLabel}`);
      tests.push(`should handle ${c.targetLabel} unavailability gracefully`);
    }

    if (tests.length > 0) {
      results.push({
        contractName: c.contractName,
        contractKind: c.contractKind,
        direction: "outbound",
        connectedLabel: c.targetLabel,
        testDescriptions: tests,
      });
    }
  }

  return results;
}

// C4 step 2: the generator's "## Test Strategy" section is explicitly editable (the
// `<!-- Edit this section ... -->` marker). A freshness regenerate must give it the
// same respect C1 gives user-authored task docs: if the stored plan's strategy section
// differs from what the generator would emit, the USER'S section body is carried into
// the regenerated document verbatim (heading included). Everything outside the section
// is derived and regenerates freely.
const TEST_STRATEGY_HEADING = "## Test Strategy";

function extractSection(content: string, heading: string): { start: number; end: number } | null {
  const lines = content.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === heading) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // Section runs to the next level-2 heading (### subsections belong to it).
    if (/^## (?!#)/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

export function preserveTestStrategySection(generated: string, stored: string): string {
  const storedSec = extractSection(stored, TEST_STRATEGY_HEADING);
  if (!storedSec) return generated;
  const generatedSec = extractSection(generated, TEST_STRATEGY_HEADING);
  if (!generatedSec) return generated;

  const storedLines = stored.split("\n").slice(storedSec.start, storedSec.end);
  const generatedLines = generated.split("\n");
  const generatedSection = generatedLines.slice(generatedSec.start, generatedSec.end);

  if (storedLines.join("\n") === generatedSection.join("\n")) return generated;

  return [
    ...generatedLines.slice(0, generatedSec.start),
    ...storedLines,
    ...generatedLines.slice(generatedSec.end),
  ].join("\n");
}

/** A regenerated plan with the stored plan's statements put back under the same
 *  criterion; the rest under "Statements to review". Returns `generated` unchanged
 *  when the stored plan has none. */
export function keepAgentStatements(generated: string, stored: string): string {
  const kept = planStatements(stored);
  if (kept.byText.size === 0 && kept.review.length === 0) return generated;
  const lines = generated.split("\n");
  const textOf = criterionTextById(lines);
  // Every criterion the regenerated plan has a place for (a scenario heading or a
  // manual item), found before the walk: the review block is written at the end of
  // the scenarios, before the manual items are reached.
  const anchored = new Set<string>();
  {
    let sec = "";
    for (const line of lines) {
      if (/^## (?!#)/.test(line)) { sec = line.trim(); continue; }
      const m = sec === SCENARIOS_HEADING ? SCENARIO_HEADING.exec(line) : sec === MANUAL_HEADING ? MANUAL_ITEM.exec(line) : null;
      const text = m ? textOf.get(m[1]) : undefined;
      if (text !== undefined) anchored.add(text);
    }
  }
  const out: string[] = [];
  let section = "";
  let pending: string[] | null = null;
  let reviewed = false;
  const flush = () => { if (pending) { out.push(...pending); pending = null; } };
  const emitReview = () => {
    if (reviewed) return;
    reviewed = true;
    const entries = [...kept.review];
    for (const [text, list] of kept.byText) {
      if (anchored.has(text)) continue;
      entries.push(`Written for: "${text}"`, ...list);
    }
    if (entries.length === 0) return;
    out.push(STATEMENTS_TO_REVIEW_HEADING, "", REVIEW_NOTE, "", ...entries, "");
  };
  for (const line of lines) {
    if (/^## (?!#)/.test(line)) {
      flush();
      if (section === SCENARIOS_HEADING) emitReview();
      section = line.trim();
      out.push(line);
      continue;
    }
    if (section === SCENARIOS_HEADING) {
      if (line.startsWith("#### ")) {
        flush();
        const m = SCENARIO_HEADING.exec(line);
        const text = m ? textOf.get(m[1]) : undefined;
        const list = text !== undefined ? kept.byText.get(text) : undefined;
        if (text !== undefined && list) pending = list;
        out.push(line);
        continue;
      }
      if (line.trim() === "") flush();
      out.push(line);
      continue;
    }
    out.push(line);
    if (section === MANUAL_HEADING) {
      const m = MANUAL_ITEM.exec(line);
      const text = m ? textOf.get(m[1]) : undefined;
      const list = text !== undefined ? kept.byText.get(text) : undefined;
      if (text !== undefined && list) out.push(...list.map((l) => `  ${l}`));
    }
  }
  flush();
  if (section === SCENARIOS_HEADING) emitReview();
  return out.join("\n");
}

/** How an agent writes a test case's statements; get_test_plan serves it beside the gaps. */
export const STATEMENT_FORMAT = "Under each \"#### AC-...\" test case heading, one checkbox line per statement (\"- [ ] Given ..., when ..., then ...\", with a then that can be observed and names the file or API it checks); under a manual item, the same lines indented by two spaces (the check a person performs). Write them into the stored plan with propose_patches update_artifact, passing base_sequence (the headSequence you read the plan at). Statements stay with their criterion when the plan regenerates; those of a criterion that was reworded or removed move to \"#### Statements to review\", each group under a \"Written for:\" line that quotes the criterion: move each statement under its test case, or delete it. A case blocked by a schema waits for the schema.";

/** What a regeneration carries from the stored plan: the Test Strategy body and the
 *  test-case statements. The read path and the push gate both call this. */
export function carryAgentPlanContent(generated: string, stored: string): string {
  return keepAgentStatements(preserveTestStrategySection(generated, stored), stored);
}

interface CriterionIssue {
  severity: "Warning" | "Info";
  message: string;
}

interface CriterionAssessment {
  index: number;
  text: string;
  issues: CriterionIssue[];
  suggestion: string | null;
}

const VAGUE_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bshould\s+be\s+(fast|quick|responsive|good|nice|efficient)\b/i, message: "Subjective performance term without measurable threshold" },
  { pattern: /\b(easy|intuitive|user-friendly|simple|clean)\b/i, message: "Subjective UX term -- specify observable behavior instead" },
  { pattern: /\b(appropriate|proper|correct|suitable|adequate)\b/i, message: "Ambiguous qualifier -- define what qualifies as acceptable" },
  { pattern: /\betc\.?\b/i, message: "Open-ended list (etc.) makes completeness untestable" },
  { pattern: /\b(might|maybe|possibly|could|optionally)\b/i, message: "Uncertain language -- criteria should be definitive" },
  { pattern: /\b(most|some|many|few|several)\b/i, message: "Imprecise quantifier -- specify exact count or percentage" },
];

const MISSING_SPECIFICITY: Array<{ test: (text: string) => boolean; message: string; suggestion: string }> = [
  {
    test: (t) => /\b(within|under|less than|at most|maximum)\b/i.test(t) && !/\d/.test(t),
    message: "Time/size constraint without a numeric value",
    suggestion: "Add a specific threshold (e.g., 'within 200ms', 'under 5MB')",
  },
  {
    test: (t) => t.length < 15,
    message: "Criterion is too brief to be independently verifiable",
    suggestion: "Expand with specific expected behavior and observable outcome",
  },
  {
    test: (t) => !/\b(when|if|given|after|before|on|upon|during)\b/i.test(t) && !/\b(shall|must|will|can|displays?|returns?|shows?|creates?|sends?|stores?)\b/i.test(t),
    message: "No clear trigger or action verb -- hard to derive a test case",
    suggestion: "Rewrite in 'When [trigger], [system] shall [observable outcome]' form",
  },
];

function assessCriterion(text: string, index: number): CriterionAssessment {
  const issues: CriterionIssue[] = [];
  let suggestion: string | null = null;

  for (const { pattern, message } of VAGUE_PATTERNS) {
    if (pattern.test(text)) {
      issues.push({ severity: "Warning", message });
    }
  }

  for (const { test, message, suggestion: sug } of MISSING_SPECIFICITY) {
    if (test(text)) {
      issues.push({ severity: "Warning", message });
      if (!suggestion) suggestion = sug;
    }
  }

  if (issues.length === 0 && text.split(/\s+/).length > 40) {
    issues.push({ severity: "Info", message: "Long criterion -- consider splitting into multiple focused criteria" });
  }

  return { index, text, issues, suggestion };
}

// WS3: the local simpleHash copy is gone — the h8 is single-sourced from
// task-document-generator.ts (imported at the top) so fingerprint tokens, the
// Interfaces section, and get_project_context's schemaHash always agree.

export interface TestContextFingerprint {
  fingerprint: string;
  timestamp: string;
  fields: {
    criteriaHashes: string[];
    mappedNodeSignatures: string[];
    sourceArtifactContentHashes: string[];
    connectedTopology: string[];
    /** Always empty since AL.29 R1 (plans carry no vision); kept so stored
     *  fingerprints keep matching. */
    visionHash: string;
    /** N10(b): the plan's ONE catalog read is ai_context.testingPatterns of the mapped
     *  technologies (framework recommendation) — hashed narrowly so enrichment of any
     *  OTHER ai_context key never re-stales plans. Empty when the caller passes no
     *  catalogs (legacy signature). */
    catalogSignature: string;
  };
}

export function computeTestContextFingerprint(
  requirement: RequirementForTest,
  mappedNodes: MappedNode[],
  sourceArtifacts: GraphArtifact[],
  graph: GraphData,
  catalogs?: CatalogData,
): TestContextFingerprint {
  // WS3: verification participates — moving a criterion between the automated and
  // manual lanes moves it between plan sections, so it must stale the plan.
  const criteriaHashes = requirement.acceptanceCriteria.map((ac) =>
    simpleHash({ text: ac.text, verification: ac.verification === "manual" ? "manual" : "" })
  );

  const mappedNodeSignatures = mappedNodes
    .map((n) => `${n.label}:${n.role}:${n.technology || ""}`)
    .sort();

  const sourceArtifactContentHashes = sourceArtifacts
    .map((a) => `${a.path}:${simpleHash(a.content || "")}`)
    .sort();

  const nodeIds = new Set(mappedNodes.map((n) => n.nodeId));
  const connectedTopology: string[] = [];
  for (const edge of Object.values(graph.edges)) {
    if (!nodeIds.has(edge.source) && !nodeIds.has(edge.target)) continue;
    const contract = graph.contracts[edge.contractId];
    const src = graph.nodes[edge.source];
    const tgt = graph.nodes[edge.target];
    // WS3 (design review's critical catch): without a schema token here, a plan whose
    // scenarios rendered [blocked by schema: …] would NEVER auto-unblock — the schema
    // landing changed nothing the fingerprint saw. Same h8 as every other surface
    // (inline-first content, single-sourced simpleHash). Adding the token moves every
    // stored plan fingerprint ONCE (accepted: one-time testPlansRefreshed round at the
    // next push; Test Strategy sections are preserved by the freshness gate).
    const schemaContent = resolveContractSchemaContent(contract, graph);
    const schemaToken = schemaContent ? `schema-${simpleHash(schemaContent)}` : "noschema";
    connectedTopology.push(
      `${src?.label || edge.source}->${tgt?.label || edge.target}:${contract?.kind || "?"}:${schemaToken}`,
    );
  }
  connectedTopology.sort();

  const fields = {
    criteriaHashes,
    mappedNodeSignatures,
    sourceArtifactContentHashes,
    connectedTopology,
    // AL.29 R1: plans carry no vision. The field stays, always empty, so every
    // stored fingerprint (all of them made without a vision) still matches.
    visionHash: "",
    // N10(b): narrow by design — testingPatterns is the plan's only catalog read, so
    // enriching bestPractices/apiReference/etc. must not re-stale every plan.
    catalogSignature: catalogs
      ? simpleHash(JSON.stringify(
          mappedNodes
            .filter((n) => n.technology)
            .map((n) => {
              const tp = (catalogs.technologies[n.technology!]?.ai_context as Record<string, unknown> | undefined)
                ?.testingPatterns;
              return tp ? `${n.technology}:${simpleHash(JSON.stringify(tp))}` : "";
            })
            .filter(Boolean)
            .sort(),
        ))
      : "",
  };

  return {
    fingerprint: simpleHash(fields),
    timestamp: new Date().toISOString(),
    fields,
  };
}

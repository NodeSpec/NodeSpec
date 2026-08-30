import type { CatalogData } from "./catalog-loader.ts";
import type { ResolvedCapability } from "./mcp-context-assembly.ts";
import { effectiveTreatmentForRole, deriveOwnership } from "./ontology.ts";
import { collectInheritedScopes, effectiveInheritedValues, renderInheritedContext } from "./inherited-context.ts";
import { inferProviderFromId, isProviderBrandedId } from "./provider-inference.ts";
import { resolveConfigChoice } from "./config-choice.ts";
import { assignTaskKeys } from "./task-deltas.ts";

// ── N5.8: THE deliverable quality gate ────────────────────────────────────────────────
// One axis-pure classifier decides what a node's task doc demands — never per-technology
// logic (node types will number in the thousands). Precedence:
//   1. ai_context.configMode (authoritative catalog data):
//      'none'  → NO task doc at all (account-access-only node; architectural truth only)
//      'code'  → managed runtime hosting USER-AUTHORED code (Lambda-class): working code
//      'definition-as-code' | 'declarative' | 'external' → the N2.1 spectrum
//   2. effectiveTreatment boundary → boundary config deliverable (generic 'config')
//   3. deriveOwnership (the N1 IN-GRAPH rule — platform parent / hosts placement → integrate;
//      this is what the N3.8 minimum-container rule feeds): call → connection-only;
//      integrate → provisioning IaC; build/host → working code.
export type DeliverableKind =
  | "code"
  | "definition-as-code"
  | "declarative"
  | "external-config"
  | "connection-only"
  | "config"
  | "none";

// M7: the private alias Set is gone — it was the fifth copy of the provider table and the
// one M6 missed, because it is a Set where the others are Records. `providerFamilyForId`
// covers prefix AND registered alias, which is exactly what this predicate wanted.
// Used to split integrate-by-identity from integrate-by-placement in the classifier.
function isProviderTechnology(technologyId: string | undefined | null): boolean {
  return !!technologyId && isProviderBrandedId(technologyId);
}

export function classifyNodeDeliverable(
  roleRow: { nature?: string | null; is_container?: boolean | null; container_style?: string | null } | undefined,
  techAiContext: Record<string, unknown> | undefined,
  node: { parentId?: string; placementKind?: string; technology?: string },
  parentNature: string | null | undefined,
): DeliverableKind {
  // N10(a) first live sweep (2026-08-09, service-mesh): the logical-boundary exclusion
  // must come BEFORE configMode. A logical Structure node with a config-bearing bound
  // technology (istio-class configMode 'declarative') was short-circuiting into a
  // deliverable packet — but N5.16's rule is structural: only logical Structure is
  // organizational, no deliverable, no doc, regardless of what technology it carries.
  if (roleRow?.is_container && roleRow.container_style === "logical-boundary") return "none";
  const configMode = techAiContext?.configMode as string | undefined;
  if (configMode === "none") return "none";
  if (configMode === "code") return "code";
  if (configMode === "definition-as-code") return "definition-as-code";
  if (configMode === "declarative") return "declarative";
  if (configMode === "external") return "external-config";
  // N5.16 (owner bench finding): containers are NOT just organizational. A HOSTING
  // container (vpc, docker-container, k8s-cluster, platform containers) owns a real
  // provisioning deliverable — VPC gateways/subnets, compose definitions, cluster
  // provisioning. Only the logical Structure set (containerStyle 'logical-boundary',
  // excluded above) is organizational. Catalog configMode (above) can still refine a
  // hosting container's kind (e.g. definition-as-code for compose).
  if (roleRow?.is_container) {
    return "declarative";
  }
  // M1b: treatment derives from nature + containment; no stored column is read.
  const treatment = effectiveTreatmentForRole(
    { nature: roleRow?.nature, is_container: roleRow?.is_container },
    techAiContext?.treatmentOverride as string | undefined,
  );
  if (treatment === "boundary") return "config";
  const ownership = deriveOwnership(node, { nature: roleRow?.nature, parentNature });
  if (ownership === "call") return "connection-only";
  if (ownership === "integrate") {
    // N5.14 (owner-caught: react + frontend-app received the IaC directive): integrate has
    // two sources and only one is a provider service. Integrate-by-IDENTITY — the node IS a
    // managed capability (nature='integrate') or a provider-branded technology
    // (the N5.8 CloudFront-without-configMode fallback; N8 stamps these with
    // authoritative configMode) → provisioning IaC. Integrate-by-PLACEMENT — a user-authored
    // technology merely HOSTED on rented/platform infra (react on S3, express on EC2)
    // → the deliverable stays working code; placement changes who runs the runtime,
    // never what the user authors.
    if (roleRow?.nature === "integrate" || isProviderTechnology(node.technology)) {
      return "declarative";
    }
    return "code";
  }
  return "code";
}

// ── N5.12: build-readiness assessment ────────────────────────────────────────────────
// Owner direction 2026-07-24: when the user asks their AI to build code/config/schema
// artifacts, the AI must not leave them hanging on undefined contracts — the gaps the
// packet renders as `[PLACEHOLDER: …]` need a machine-readable preflight with the exact
// resolution action per gap. This assessor lives HERE, in the same module that renders
// the placeholders, so the doc and the readiness report can never diverge on what
// counts as a gap. Deterministic — no LLM; the calling AI supplies the fixes (drafting
// schemas is where its intelligence comes in).
export interface ReadinessGap {
  kind: "schema" | "owner" | "config" | "mapping" | "doc" | "classification" | "technology" | "tests";
  detail: string;
  resolveWith: string;
  /** N5.13: machine-safe node references (bench AI: prose labels are fragile for
   *  third-party consumption). owner → the sharing nodes; schema → the counterparty. */
  relatedNodeIds?: string[];
  /** WS2: schema gaps only — the server-assembled inputs for the AI that must draft
   *  the missing schema. The server gathers, never drafts (owner live test 2026-07-31:
   *  the AI was left staring at ⚠ SCHEMA UNDEFINED with nothing to draft from). */
  draftInputs?: SchemaDraftInputs;
}

/** WS2: everything the model already knows that a schema draft should honor. */
export interface SchemaDraftInputs {
  /** Both sides of the interface — the schema must speak both technologies. */
  selfTechnology: string | null;
  counterpartyTechnology: string | null;
  /** The counterparty's curated API surface (ai_context.apiReference endpoints),
   *  narrowed to the areas that node's user selected (metadata.config.apiAreas)
   *  when a selection exists — same filter the packet's API Reference uses. */
  apiEndpoints: string[];
  /** Unmet acceptance-criterion texts this node serves — what the schema must carry. */
  servingCriteria: string[];
  /** Spec dialect: the contract's own specFormat when set, else implied by kind
   *  (rest→openapi, graphql→graphql_schema, grpc→protobuf, kafka/amqp/websocket/
   *  sse→asyncapi, sql→sql_ddl, else json_schema). */
  suggestedSpecFormat: string;
}

// WS3 plans-follow-schemas: THE schema-gap predicate, single-sourced. The readiness
// blockers below, the doc's [PLACEHOLDER: schema] lane, and the test-plan lane's
// blocked markers / get_test_plan schemaBlockedContracts all key on this one function,
// so no surface can disagree about which contracts block building or scenario
// derivation: non-dependency (kind AND interactionKind) with no resolvable schema
// content — a dangling schemaRef resolves to nothing, so it counts as a gap too.
export function isContractSchemaGap(c: {
  contractKind: string;
  interactionKind?: string | null;
  schemaContent?: string | null;
}): boolean {
  const isDependency = c.contractKind === "dependency" || c.interactionKind === "dependency";
  return !isDependency && !c.schemaContent;
}

/** WS2: kind → spec dialect mapping for suggestedSpecFormat (see interface doc). */
function suggestedSpecFormatForKind(kind: string): string {
  switch (kind) {
    case "rest": return "openapi";
    case "graphql": return "graphql_schema";
    case "grpc": return "protobuf";
    case "kafka":
    case "amqp":
    case "websocket":
    case "sse": return "asyncapi";
    case "sql": return "sql_ddl";
    default: return "json_schema";
  }
}

/** WS2: the counterparty's curated endpoints, filtered exactly like the packet's
 *  API Reference section (selected metadata.config.apiAreas when present, else all). */
function counterpartyApiEndpoints(
  counterparty: GraphNode | undefined,
  catalogs: CatalogData,
): string[] {
  if (!counterparty?.technology) return [];
  const techRow = catalogs.technologies[counterparty.technology];
  const apiRef = (techRow?.ai_context as Record<string, unknown> | undefined)?.apiReference as
    | { areas?: Record<string, { endpoints?: string[] }> }
    | undefined;
  if (!apiRef?.areas) return [];
  const areaNames = Object.keys(apiRef.areas);
  const rawSelection = (counterparty.metadata?.config as Record<string, unknown> | undefined)?.apiAreas;
  const selected = Array.isArray(rawSelection)
    ? areaNames.filter((a) => (rawSelection as unknown[]).includes(a))
    : [];
  const chosen = selected.length > 0 ? selected : areaNames;
  return chosen.flatMap((name) => apiRef.areas?.[name]?.endpoints ?? []);
}

export interface NodeReadiness {
  deliverable: DeliverableKind;
  /** Gaps that make building against the model unsafe (inventing the missing piece). */
  blockers: ReadinessGap[];
  /** Gaps worth surfacing that do not block a correct build. */
  advisories: ReadinessGap[];
  /** Node ids this node needs available first (outgoing sync/dependency contracts). */
  upstreamNodeIds: string[];
}

export function assessNodeReadiness(input: TaskDocumentInput): NodeReadiness {
  const { node, graph, catalogs, requirements, requirementNodeMap } = input;
  const roleRow = catalogs.nodeRoles[node.type];
  const techRow = node.technology ? catalogs.technologies[node.technology] : null;
  const techAiContext = techRow?.ai_context as Record<string, unknown> | undefined;
  const parentNature = node.parentId ? catalogs.nodeRoles[graph.nodes[node.parentId]?.type ?? ""]?.nature ?? null : null;
  const deliverable = classifyNodeDeliverable(roleRow, techAiContext, node, parentNature);

  const blockers: ReadinessGap[] = [];
  const advisories: ReadinessGap[] = [];
  if (deliverable === "none") {
    return { deliverable, blockers, advisories, upstreamNodeIds: [] };
  }

  const contracts = buildContractSection(node, graph);

  // schema — every non-dependency contract without a schema is a build blocker: the
  // packet forbids inventing the shape, so nothing can be built against it yet.
  // WS2: each blocker ships draftInputs so the consuming AI drafts from model truth
  // instead of a bare "no schema" (the criteria to serve are the same list for every
  // contract on this node — mappings are REQ→node, not criterion→contract).
  const servingCriteria = requirements.flatMap((r) =>
    r.acceptanceCriteria.filter((ac) => !ac.met).map((ac) => ac.text)
  );
  for (const c of contracts) {
    if (!isContractSchemaGap(c)) continue;
    const preposition = c.direction === "outgoing" ? "to" : "from";
    // WS2: a dangling ref is a DIFFERENT lie than no ref — the model claims a schema
    // exists. Name the broken artifact, in the same words as the doc's ⚠ SCHEMA
    // REFERENCE BROKEN block (this module renders both, so they cannot diverge).
    const detail = c.danglingSchemaRef
      ? `Contract "${c.contractName}" (${c.contractKind}, ${preposition} ${c.connectedNodeLabel}) has a BROKEN schema reference — schemaRef points at missing or contentless artifact ${c.danglingSchemaRef}; re-link via update_contract {schemaRef} / link_schema_artifact, or replace it with an inline schema`
      : `Contract "${c.contractName}" (${c.contractKind}, ${preposition} ${c.connectedNodeLabel}) has no schema or schemaRef`;
    blockers.push({
      kind: "schema",
      detail,
      resolveWith: `Draft the schema yourself from the requirements, criteria, and both nodes' technologies, then submit it as a propose_patches update_contract patch for the user to accept — do not build against this interface before acceptance.`,
      relatedNodeIds: [c.connectedNodeId],
      draftInputs: {
        selfTechnology: node.technology ?? null,
        counterpartyTechnology: c.connectedNodeTechnology,
        apiEndpoints: counterpartyApiEndpoints(graph.nodes[c.connectedNodeId], catalogs),
        servingCriteria,
        suggestedSpecFormat: c.specFormat && c.specFormat !== "none"
          ? c.specFormat
          : suggestedSpecFormatForKind(c.contractKind),
      },
    });
  }

  // owner — an unmet criterion on a SHARED requirement with no contract evidence has
  // no known owner; building it here may duplicate or contradict the owning node.
  const attribution = new Map<string, CriteriaMapEntry["criteria"][number]>();
  if (contracts.length > 0) {
    for (const entry of buildAcceptanceCriteriaMap(node, graph, requirements, contracts, requirementNodeMap)) {
      for (const criterion of entry.criteria) {
        attribution.set(`${entry.requirementName}::${criterion.text}`, criterion);
      }
    }
  }
  for (const req of requirements) {
    const sharedIds = (requirementNodeMap?.[req.requirementId] ?? []).filter((id) => id !== node.id);
    if (sharedIds.length === 0) continue;
    const sharedLabels = sharedIds.map((id) => graph.nodes[id]?.label || id);
    for (const ac of req.acceptanceCriteria) {
      if (ac.met) continue;
      const attr = attribution.get(`${req.requirementId}: ${req.name}::${ac.text}`);
      if (attr?.matchedContractName) continue;
      blockers.push({
        kind: "owner",
        detail: `Criterion "${ac.text}" (${req.requirementId}) is shared with ${sharedLabels.join(", ")} and has no contract evidence for which node owns it`,
        resolveWith: `Decide the owning node with the user, then record it via map_requirement (mode 'remove' also prunes stale links; or adjust the requirement upstream with update_requirement).`,
        relatedNodeIds: sharedIds,
      });
    }
  }

  // config — a schema-bearing technology with no recorded choices builds on guesses.
  const metadataSchema = (techRow as { metadata_schema?: Record<string, unknown> } | null)?.metadata_schema;
  const nodeConfig = node.metadata?.config as Record<string, unknown> | undefined;
  if (metadataSchema && Object.keys(metadataSchema).length > 0 && (!nodeConfig || Object.keys(nodeConfig).length === 0)) {
    advisories.push({
      kind: "config",
      detail: `${techRow?.name ?? node.technology} exposes configuration options but this node has none recorded`,
      resolveWith: `Ask the user to set their choices in the node inspector (Configuration) — the packet folds them in as decisions to honor.`,
    });
  }

  // classification — authoritative catalog data (configMode) driving a non-code
  // deliverable on a NON-provider technology is suspicious: user-authored frameworks
  // (react, express, …) should classify as working code. The classifier cannot
  // override configMode (it is catalog truth), so surface it for a human catalog-
  // filing decision instead of letting a misclassification pass silently (N5.14 —
  // the bench AI accepted an IaC directive for a React app without pushback).
  const configModeValue = techAiContext?.configMode as string | undefined;
  if (
    configModeValue && ["declarative", "external", "none"].includes(configModeValue) &&
    node.technology && !isProviderTechnology(node.technology) &&
    roleRow?.nature !== "integrate"
  ) {
    advisories.push({
      kind: "classification",
      detail: `Technology "${node.technology}" carries configMode "${configModeValue}" but is not provider-branded — its deliverable classifies as ${deliverable}, which is unusual for a user-authored framework`,
      resolveWith: "Verify the catalog filing with the user (the N8 filing gate owns configMode correctness); if wrong, the catalog row's ai_context.configMode needs fixing — do not silently build to the suspicious deliverable.",
    });
  }

  // technology — a buildable node with no technology bound is a legitimate modeling
  // state (generic role drop; binding happens via the AI patch lane or recreation
  // from the palette — N8.1 removed the inspector rebind dropdown), but the packet
  // quality degrades: no Technology Guidance, no configMode, weaker classification.
  // Surface it so a forgotten generic node never rides silently to implementation
  // (N4.7 — closes the functional-node-type loop over MCP).
  if (deliverable === "code" && !node.technology) {
    advisories.push({
      kind: "technology",
      detail: "No technology is bound to this node — guidance and deliverable classification degrade to role-level defaults",
      resolveWith: "Ask the user which technology this component uses (search_catalog to explore options), then bind it via the inspector — or confirm it is intentionally technology-neutral.",
    });
  }

  // mapping — a node with zero mapped requirements has no traceability anchor at all.
  if (requirements.length === 0) {
    advisories.push({
      kind: "mapping",
      detail: "No requirements are mapped to this node — its tasks trace to nothing",
      resolveWith: "Map existing requirements with map_requirement, or add missing ones upstream with create_requirement, then regenerate the task doc.",
    });
  }

  const upstreamNodeIds = [...new Set(
    contracts.filter((c) => c.direction === "outgoing" && isSyncOutgoing(c)).map((c) => c.connectedNodeId),
  )];

  return { deliverable, blockers, advisories, upstreamNodeIds };
}

function resolveCapabilityForTask(
  node: GraphNode,
  graph: GraphData,
  catalogs: CatalogData
): ResolvedCapability | null {
  if (!node.technology || !node.parentId) return null;

  const roleRow = catalogs.nodeRoles[node.type];
  if (roleRow?.nature === 'integrate') return null;

  // M6 BUGFIX: this copy had the prefixes but NOT the family mapping, so a firebase-*
  // node resolved provider `firebase` against a `gcp` platform parent (N4.7 merged the
  // family). One table now, in provider-inference.ts.
  const provider = inferProviderFromId(node.technology);
  if (!provider) return null;

  const parent = graph.nodes[node.parentId];
  if (!parent) return null;

  const parentRole = catalogs.nodeRoles[parent.type];
  if (!parentRole || parentRole.nature !== 'host') return null;

  // M1c: sourced from the TECHNOLOGY row (the capability roles retired in M1b). Twin of
  // mcp-context-assembly.ts::resolveCapabilityEquivalence — keep both in step.
  const capabilityRole = catalogs.technologies[node.technology];
  if (!capabilityRole) return null;

  return {
    platformCapabilityRole: capabilityRole.id,
    platformCapabilityLabel: (capabilityRole.display_name || capabilityRole.name),
    provider,
    equivalenceNote: `This node is semantically equivalent to a "${(capabilityRole.display_name || capabilityRole.name)}" (${capabilityRole.id}) platform_capability node. Treat it as the managed ${provider.toUpperCase()} service for spec generation, code scaffolding, and architecture decisions.`,
  };
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  technology?: string;
  parentId?: string;
  placementKind?: string;
  ports?: Array<{ name?: string; direction: "in" | "out"; contractId?: string }>;
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
  direction?: string;
  criticality?: string;
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
}

interface GraphData {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  contracts: Record<string, GraphContract>;
  artifacts: Record<string, GraphArtifact>;
}

interface RequirementForTask {
  requirementId: string;
  name: string;
  description: string;
  category: string;
  status: string;
  /** WS3: verification 'manual' = R5 tick+approval lane; absent = automated (D-2). */
  acceptanceCriteria: Array<{ text: string; met?: boolean; verification?: string }>;
}

export interface TaskDocumentInput {
  node: GraphNode;
  graph: GraphData;
  catalogs: CatalogData;
  requirements: RequirementForTask[];
  projectVision?: string;
  /**
   * Human requirement id (e.g. "REQ-001") -> ALL node ids the requirement is mapped to
   * (from specification_mappings). Requirements are pre-scoped to this node upstream;
   * the map exists so the doc can label sharing and bound cross-node attribution.
   * When absent, cross-node "Satisfied by" claims degrade to unverified candidates.
   */
  requirementNodeMap?: Record<string, string[]>;
  /**
   * A4 (docs/WORK_LOOP_PLAN.md): anchor key → done, from task_items. When a
   * task's key is recorded done, regeneration renders `[x]` instead of
   * wiping the tick — without this every regen visually erased progress.
   * Absent (older call sites, tests) → every box renders unticked, exactly
   * the pre-A4 output.
   */
  taskState?: Map<string, boolean>;
}

/** N5.6 (owner bench doc): some catalog ai_context code snippets were authored flat —
 *  literal backslash-n instead of newlines — and rendered broken in packets. Unescape
 *  ONLY when the string carries the flattened signature (no real newlines but literal
 *  `\n` sequences), so genuinely multi-line snippets that contain `\n` inside string
 *  literals are left untouched. Data-side normalization is an N8 worksheet item. */
function normalizeFlattenedCode(code: string): string {
  if (!code.includes("\\n") || code.includes("\n")) return code;
  return code.replace(/\\t/g, "\t").replace(/\\n/g, "\n");
}

export function generateTaskDocument(input: TaskDocumentInput): string {
  const { node, graph, catalogs, requirements, projectVision, requirementNodeMap, taskState } = input;

  const roleRow = catalogs.nodeRoles[node.type];
  const techRow = node.technology ? catalogs.technologies[node.technology] : null;

  const lines: string[] = [];

  lines.push(`# Task: ${node.label}`);
  lines.push("");
  // N5.7: one-node scoping stated up front — the packet is a directive for THIS node
  // only; other nodes' work appears solely as interfaces/coordination points.
  lines.push(`> **Scope:** implement ONLY this node ("${node.label}"). Work belonging to other nodes appears here solely as interfaces and coordination points — do not implement or re-derive it.`);
  lines.push("> This document is DERIVED from the NodeSpec model + catalog (fingerprinted, regenerable via generate_task_docs). Node context/export is the model truth; propose model changes through the proposal flow — hand-edits to model facts here do not change the model.");
  lines.push("");

  // -- Component Purpose --
  lines.push("## Component Purpose");
  lines.push("");
  lines.push(`**Role:** ${roleRow?.label || node.type}`);
  if (node.technology) {
    lines.push(`**Technology:** ${techRow?.name || node.technology}`);
  } else if (typeof node.metadata?.customTechnology === "string" && node.metadata.customTechnology) {
    // N3.5 custom nodes: node-local identity, no catalog row. Degrade LOUDLY, not
    // silently — same honesty pattern as ⚠ SCHEMA UNDEFINED.
    lines.push(`**Technology:** ${node.metadata.customTechnology} (custom — user-defined; no catalog guidance exists. Do NOT invent SDK, setup, or configuration specifics for it; work from this node's contracts, and propose schemas/config through the proposal flow where they are missing.)`);
  }
  if (roleRow?.description) lines.push(`**Description:** ${roleRow.description}`);
  if (node.metadata?.rationale) lines.push(`**Rationale:** ${node.metadata.rationale}`);
  lines.push("");

  // N5.7/N5.8 "Your Deliverable": ONE consistent statement of what output this node
  // wants — decided by classifyNodeDeliverable (axis-pure; see the classifier header).
  // Boundary framing (the engine owns its internals) renders WHENEVER treatment is
  // boundary, on top of whichever deliverable kind applies.
  const techAiContext = techRow?.ai_context as Record<string, unknown> | undefined;
  const treatment = effectiveTreatmentForRole({ nature: roleRow?.nature, is_container: roleRow?.is_container }, techAiContext?.treatmentOverride as string | undefined);
  const parentNature = node.parentId ? catalogs.nodeRoles[graph.nodes[node.parentId]?.type ?? ""]?.nature ?? null : null;
  const deliverable = classifyNodeDeliverable(roleRow, techAiContext, node, parentNature);
  lines.push("## Your Deliverable");
  lines.push("");
  if (treatment === "boundary") {
    lines.push(`This component is an engine that owns its own internals${techRow ? ` (${techRow.name})` : ""}. Never decompose its internals into architecture nodes, and never reimplement its functionality as application code.`);
    lines.push("- **Connection contracts** for every interface below (triggers, payloads, endpoints)");
  }
  switch (deliverable) {
    case "none":
      lines.push("**No implementation task.** This node needs no code and no configuration deliverable (account access only). It exists in the model for architectural truth and traceability.");
      break;
    case "code":
      lines.push("**Working code for this component**, honoring the contracts and criteria below, plus its configuration artifacts and tests.");
      break;
    case "definition-as-code":
      lines.push("- **The engine's definition IS a deliverable code file** — whatever form this engine's definitions take (workflow/DAG, pipeline, gateway config, manifest set, scrape/rule config). Author it as an artifact bound to this node; it versions through git like any code.");
      break;
    case "declarative": {
      // N5.16: containers get container-true phrasing — "provider-managed service"
      // is wrong for a Docker container or a VPC the user provisions themselves.
      if (roleRow?.is_container) {
        lines.push("This container provisions the runtime context for the components inside it — no application code implements the container itself.");
      } else if (treatment !== "boundary") {
        // N10(e) cold-judge finding: "provider-managed" overclaimed for self-hosted
        // declarative rows (ollama, qdrant, kafka run by the user) — the constant is
        // provisioned-not-programmed, not who operates it.
        lines.push("This service is provisioned, not programmed — no application code implements it (provider-managed, or operated by you if self-hosted).");
      }
      // N8.4i (owner IaC ruling 2026-07-28): the IaC TOOL is inherited platform
      // scope — never a canvas node, and NEVER a guess. When the platform container
      // declares iacTool, the packet names exactly that tool; when it does not, the
      // packet instructs confirmation instead of offering a grab-bag an AI would
      // pick from arbitrarily (the hallucination class this guards against).
      const iacToolRaw = effectiveInheritedValues(collectInheritedScopes(graph, node.id)).iacTool;
      const iacTool = typeof iacToolRaw === "string" && iacToolRaw.trim() !== "" ? iacToolRaw : null;
      if (iacTool) {
        lines.push(`- **Provisioning configuration (IaC — ${iacTool})** — declare the service as ${iacTool} config artifacts: existence, sizing, wiring, permissions. The tool is set on the platform container; do not switch tools per node.`);
      } else {
        lines.push("- **Provisioning configuration (IaC)** — declare the service as config artifacts: existence, sizing, wiring, permissions. The IaC tool is NOT declared on this project's platform container — CONFIRM the tool with the user (Terraform / OpenTofu / Pulumi / provider-native / CDK) before authoring artifacts; do NOT assume one.");
      }
      if (treatment !== "boundary") lines.push("- **Connection contracts** for every interface below");
      break;
    }
    case "external-config":
      lines.push("- **Connection configuration ONLY** — endpoints, credential references, contracts. The service is configured in its own environment (console/UI); see Manual Steps. Do not author definition files it cannot import.");
      break;
    case "connection-only":
      lines.push("This is an external service you call — no application code implements it.");
      lines.push("- **Connection contracts** for every interface below");
      lines.push("- **Client configuration** as config artifacts; account/access setup in Manual Steps");
      break;
    case "config":
      lines.push("- **Configuration artifacts** that bind this engine into the system (config kind)");
      break;
  }
  lines.push("");

  // N5.11: everything task synthesis consumes, computed BEFORE the tasks section.
  // (contracts/attribution used to be computed just before Requirements — hoisted.)
  const nodeConfig = node.metadata?.config as Record<string, unknown> | undefined;
  const hasConfigValues = !!nodeConfig && typeof nodeConfig === "object" && Object.keys(nodeConfig).length > 0;
  // N8.1b: per-node choice — the user explicitly delegated configuration to the AI
  // (inspector "AI decides").
  // Owner bug 2026-07-30: this was `!hasUserConfig && configSource === 'ai'` — values
  // OVERRODE the explicit choice, which is what made "AI decides" unreachable in the
  // inspector once anything was typed. THE rule now lives in _shared/config-choice.ts
  // and every surface reads it: an explicit delegation wins, dormant values stay in the
  // model (they return if the user switches back) but never render as chosen. The
  // three packet states are preserved: honor-choices / delegated / unchosen-placeholder.
  const configChoice = resolveConfigChoice(node.metadata as Record<string, unknown> | undefined);
  const configDelegated = configChoice === "delegated";
  const hasUserConfig = configChoice === "user-specified" && hasConfigValues;
  const contracts = buildContractSection(node, graph);
  const setupSteps = (techRow?.ai_context?.setupInstructions ?? []) as Array<{ required: boolean; type: string; title: string; instructions: string; commands?: string[]; url?: string }>;
  const needsManualSteps = deliverable === "external-config" || deliverable === "connection-only";

  const criteriaAttribution = new Map<string, CriteriaMapEntry["criteria"][number]>();
  if (contracts.length > 0) {
    for (const entry of buildAcceptanceCriteriaMap(node, graph, requirements, contracts, requirementNodeMap)) {
      for (const criterion of entry.criteria) {
        criteriaAttribution.set(`${entry.requirementName}::${criterion.text}`, criterion);
      }
    }
  }

  // N5.11: the packet CONTAINS the ordered task list — synthesized deterministically
  // from model truth (owner: explicit, contextual checkboxes, not an instruction to
  // write them). The consuming AI executes and refines; it does not author from zero.
  let criterionTaskRef = new Map<string, string>();
  if (deliverable !== "none") {
    const criteriaForSynthesis: CriterionForSynthesis[] = [];
    for (const req of requirements) {
      const sharedLabels = (requirementNodeMap?.[req.requirementId] ?? [])
        .filter((id) => id !== node.id)
        .map((id) => graph.nodes[id]?.label || id);
      for (const ac of req.acceptanceCriteria) {
        if (ac.met) continue; // met criteria need no task
        const key = `${req.requirementId}: ${req.name}::${ac.text}`;
        const attr = criteriaAttribution.get(key);
        criteriaForSynthesis.push({
          key,
          reqId: req.requirementId,
          text: ac.text,
          matchedContractName: attr?.matchedContractName ?? null,
          coordinationHint: attr?.coordinationHint ?? null,
          crossNodeDependencies: attr?.crossNodeDependencies ?? [],
          sharedLabels,
        });
      }
    }

    const synth = buildImplementationTasks({
      deliverable,
      componentName: techRow?.name || roleRow?.label || node.label,
      parentLabel: node.parentId ? graph.nodes[node.parentId]?.label ?? null : null,
      contracts,
      criteria: criteriaForSynthesis,
      requiredSetupTitles: needsManualSteps ? setupSteps.filter((s) => s.required).map((s) => s.title) : [],
      hasUserConfig,
      configDelegated,
      suggestedFiles: (techRow?.suggested_files ?? []).map((sf: { path: string }) => sf.path),
      hostedChildren: roleRow?.is_container
        ? Object.values(graph.nodes).filter((n) => n.parentId === node.id).map((n) => n.label)
        : [],
      taskState,
    });
    criterionTaskRef = synth.criterionTaskRef;

    // N5.17 (owner ruling 2026-08-08): the packet's ONE AI-authored section. Catalog
    // slices know technologies, not THIS project — the project-contextual layer can
    // only come from the party holding full context (packet + graph + repo + the
    // user conversation): the consuming AI. NodeSpec emits the scaffold and
    // preserves authored prose verbatim across regenerations
    // (preserveImplementationContextSection); it never writes the prose itself.
    lines.push(...implementationContextScaffold());

    lines.push("## Implementation Tasks");
    lines.push("");
    lines.push("Ordered WORK ORDERS synthesized from the model — this node's deliverable kind, contracts, criterion attribution, configuration, and dependency chain. They guarantee coverage, scope, and traceability; they deliberately do NOT contain the implementation detail — that is your job (see the expansion directive below the list).");
    lines.push("");
    lines.push(...synth.lines);
    lines.push("");
    // N5.11 amendment (owner quality check): the criterion→implementation flowdown is
    // NOT deterministic and must not be faked with templates — it is the consuming
    // AI's job, made MANDATORY here instead of an optional refine note. The scaffold
    // frames the work; the AI supplies the how.
    lines.push("**Your first action — expand these work orders.** Each task above guarantees WHAT must be covered, not HOW. Before writing any code or configuration, expand every task with the concrete implementation steps for THIS technology in THIS project — the specific resources, settings, files, schemas, and tests — using the Configuration, Interface Contracts, Technology Guidance, and node context as your references. Record the expanded list in this section via update_artifact (propose_patches) after this doc is accepted, keeping task IDs, criterion citations, and open `[PLACEHOLDER: …]` tags intact. Resolve placeholders with the user through the proposal flow; this node is never complete while one remains open. When the work orders are implemented, verify through the test lane: run get_test_plan for each requirement this node serves, implement and run the plan's tests, and report outcomes via report_test_results — passing results are the evidence that flips criteria met.");
    lines.push("");
  }

  // N5.5: metadata.config = the user's explicit, schema-driven configuration choices
  // (DynamicMetadataForm). These are decisions an implementing AI must HONOR, so they
  // go in the packet verbatim. Absent/empty → no section.
  // Owner 2026-07-30: gated on hasUserConfig (the CHOICE), not on the raw values —
  // a delegated node with dormant leftovers must not print "honor these choices"
  // while the task note says the configuration was delegated.
  if (hasUserConfig && nodeConfig) {
    lines.push("## Configuration");
    lines.push("");
    lines.push("User-selected configuration for this component (honor these choices):");
    for (const [key, value] of Object.entries(nodeConfig)) {
      lines.push(`- **${key}:** ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
    }
    lines.push("");
  } else if (configDelegated) {
    // N8.1b: the user chose "AI decides" — an explicit delegation, not an omission.
    lines.push("## Configuration");
    lines.push("");
    lines.push("**Delegated to you (user choice):** select sensible defaults for this technology per the Technology Guidance, record them as config artifacts bound to this node, and state them when expanding the work orders — the user reviews them there.");
    lines.push("");
  }

  const resolvedCapability = resolveCapabilityForTask(node, graph, catalogs);
  if (resolvedCapability) {
    lines.push("### Platform Capability Equivalence");
    lines.push("");
    lines.push(resolvedCapability.equivalenceNote);
    lines.push(`- **Equivalent Role:** ${resolvedCapability.platformCapabilityRole} (${resolvedCapability.platformCapabilityLabel})`);
    lines.push(`- **Provider:** ${resolvedCapability.provider}`);
    lines.push("");
  }

  if (projectVision) {
    lines.push("## Project Context");
    lines.push("");
    lines.push(projectVision);
    lines.push("");
  }

  // -- Requirements — Your Scope --
  // Each criterion is ONE task box with its attribution inline: THIS NODE (internal
  // logic) / THIS NODE via a contract (coordinate with the other node) / unverified
  // candidate — plus (N5.11) a back-reference to the synthesized Implementation Task
  // that covers it. Contracts + attribution are computed above the tasks section.
  if (requirements.length > 0) {
    lines.push("## Requirements — Your Scope");
    lines.push("");
    for (const req of requirements) {
      lines.push(`### ${req.requirementId}: ${req.name}`);
      lines.push(`Category: ${req.category} | Status: ${req.status ?? "—"}`);
      const mappedNodeIds = requirementNodeMap?.[req.requirementId];
      const sharedLabels = (mappedNodeIds ?? [])
        .filter((id) => id !== node.id)
        .map((id) => graph.nodes[id]?.label || id);
      if (requirementNodeMap) {
        if (!mappedNodeIds || mappedNodeIds.length === 0) {
          lines.push(`_Unscoped: no requirement-to-node mapping — included as fallback context._`);
        } else if (sharedLabels.length > 0) {
          lines.push(`_Shared with: ${sharedLabels.join(", ")} — their slices live in their own task docs._`);
        }
      }
      if (req.description) lines.push(req.description);
      if (req.acceptanceCriteria.length > 0) {
        lines.push("");
        lines.push("**Acceptance criteria — your task boxes:**");
        for (const ac of req.acceptanceCriteria) {
          const check = ac.met ? "[x]" : "[ ]";
          // WS3: the (manual) marker is the row-level cue for the split-lane final
          // work order — this criterion's proof is the tick+approval lane, never
          // report_test_results.
          const lane = ac.verification === "manual" ? " (manual)" : "";
          lines.push(`- ${check} ${ac.text}${lane}`);
          const criterionKey = `${req.requirementId}: ${req.name}::${ac.text}`;
          // N5.11 amendment (owner: the attribution echo is "not a quality task; just
          // a regurgitation"): when a synthesized task covers this criterion, the task
          // owns the coordination/ownership detail (serves-line, placeholders) — the
          // criterion box carries ONLY the back-reference. The verbose attribution
          // renders only when nothing covers it (met criteria, taskless docs).
          const taskId = criterionTaskRef.get(criterionKey);
          if (taskId) {
            lines.push(`  → covered by Task ${taskId}`);
            continue;
          }
          const attr = criteriaAttribution.get(criterionKey);
          if (attr) {
            const coordinate = attr.crossNodeDependencies.length > 0
              ? ` — coordinate with ${attr.crossNodeDependencies.join(", ")}`
              : "";
            if (attr.satisfiedBy === "Internal logic of this component") {
              // N5.9 (owner acceptance review — Route 53 claimed TLS termination):
              // "internal logic" is a DEFAULT, not evidence. On a SHARED requirement
              // the generator cannot know which node owns an unmatched criterion
              // (mappings are REQ→nodes, not criterion→node) — say so honestly
              // instead of asserting ownership on every sharing node.
              if (sharedLabels.length > 0) {
                lines.push(`  → owner unresolved — this node or a sharing node (${sharedLabels.join(", ")}): no contract evidence; assign via the requirement mapping`);
              } else if (attr.coordinationHint) {
                // Keyword-only contract hit: ownership is THIS node (the old
                // "possible match … verify or reassign" line told agents to
                // fix a mapping that was already correct).
                lines.push(`  → THIS NODE: internal logic — possible coordination point: ${attr.coordinationHint} (keyword signal only)`);
              } else {
                lines.push(`  → THIS NODE: internal logic${coordinate}`);
              }
            } else {
              lines.push(`  → THIS NODE via ${attr.satisfiedBy}${coordinate}`);
            }
          }
        }
      }
      lines.push("");
    }
  }

  // -- Interface Contracts --
  if (contracts.length > 0) {
    lines.push("## Interface Contracts");
    lines.push("");
    for (const c of contracts) {
      const arrow = c.direction === "incoming" ? "RECEIVES FROM" : "SENDS TO";
      lines.push(`### ${arrow}: ${c.connectedNodeLabel} (${c.connectedNodeRole})`);
      lines.push(`- **Contract:** ${c.contractName}`);
      lines.push(`- **Protocol:** ${c.contractKind}`);
      if (c.interactionKind) lines.push(`- **Interaction:** ${c.interactionKind}`);
      if (c.transport) lines.push(`- **Transport:** ${c.transport}`);
      if (c.specFormat) lines.push(`- **Spec Format:** ${c.specFormat}`);
      if (c.connectedNodeTechnology) {
        lines.push(`- **Their Technology:** ${c.connectedNodeTechnology}`);
      }
      if (c.schemaContent) {
        lines.push("");
        lines.push("**Schema:**");
        lines.push("```");
        lines.push(c.schemaContent);
        lines.push("```");
      } else if (c.contractKind === "dependency" || c.interactionKind === "dependency") {
        // N5.9: dependency edges carry no payload — demanding a schema proposal here is
        // noise. The deliverable is the connection/config expectation, not a message shape.
        // WS2: also honor interactionKind (aligned with assessNodeReadiness, which always
        // did — the doc used to demand a schema readiness never counted as a gap).
        lines.push("");
        lines.push("_Dependency contract — no payload schema expected. Capture the connection/config");
        lines.push("expectations (endpoints, identifiers, references) in this node's config artifacts;");
        lines.push("propose a schema only if a real payload shape exists for this interface._");
      } else if (c.danglingSchemaRef) {
        // WS2: the ref claims a schema that does not exist — a broken reference, not an
        // undefined schema. Same wording as the readiness blocker (rendered from the
        // same ContractDetail, so the two surfaces cannot diverge).
        lines.push("");
        lines.push("**⚠ SCHEMA REFERENCE BROKEN**");
        lines.push("");
        lines.push(`Contract "${c.contractName}" (${c.contractKind}) has schemaRef ${c.danglingSchemaRef}, but that`);
        lines.push("artifact is missing or has no content — the reference claims a schema that does");
        lines.push("not exist. Do NOT invent the shape. Re-link a real schema artifact via");
        lines.push("update_contract {schemaRef} / link_schema_artifact, or supply the schema inline");
        lines.push("via update_contract {schema}, through the proposal flow before building.");
      } else {
        lines.push("");
        lines.push("**⚠ SCHEMA UNDEFINED**");
        lines.push("");
        lines.push(`Contract "${c.contractName}" (${c.contractKind}) has no schema or schemaRef.`);
        lines.push("No payload, endpoint, or message shape exists for this interface yet — do NOT");
        lines.push("invent one. Before implementing against this contract, propose a schema through");
        lines.push("the proposal flow (propose_patches) and build only after it is accepted.");
      }
      lines.push("");
    }
  }

  // -- Technology Guidance --
  if (techRow?.ai_context) {
    const ctx = techRow.ai_context;
    lines.push("## Technology Guidance");
    lines.push("");
    // N5.10/N5.11: guidance is REFERENCE material for the synthesized Implementation
    // Tasks — the task list above stands alone when this section is thin or absent.
    lines.push("_Reference for executing the Implementation Tasks above — apply where relevant. The task list stands even where this guidance is thin._");
    lines.push("");
    if (ctx.purpose) {
      lines.push(`**Purpose:** ${ctx.purpose}`);
      lines.push("");
    }
    // N10(b) (owner ruling 2026-08-10): for EXTERNAL services/SaaS/integrations, the
    // most current vendor documentation is PARAMOUNT — vendors change endpoints, auth
    // flows, and webhook formats on their schedule, not this document's, and the
    // acquisitions audit showed ownership itself is the dominant freshness event. The
    // packet's curated content is doctrine and orientation; for externals the LIVE
    // docs are the API truth and the packet says so explicitly.
    const isExternalService = (ctx as Record<string, unknown>).configMode === "external";
    // N10(d): lifecycle steering — a node bound to a migrated/retired technology gets
    // told so at the TOP of Technology Guidance, before any curated content invites
    // building on it. The catalog never deletes rows (N8 pattern); this line is how
    // the successor reaches the builder.
    {
      const migrationTarget = (ctx as Record<string, unknown>).migrationTarget as string | undefined;
      const lifecycle = (ctx as Record<string, unknown>).lifecycle as string | undefined;
      if (migrationTarget) {
        lines.push(`**Catalog status — migrated:** this technology's catalog row has been superseded by \`${migrationTarget}\`. Prefer the successor for new work; if this node must stay on the current technology, treat the guidance below as maintenance context.`);
        lines.push("");
      } else if (lifecycle === "retired") {
        lines.push(`**Catalog status — retired:** this technology's catalog row is retired with no named successor. Confirm with the user before building new functionality on it.`);
        lines.push("");
      }
    }
    {
      const apiRef = (ctx as Record<string, unknown>).apiReference as
        | { docsUrl?: string; areas?: Record<string, { docsUrl?: string; endpoints?: string[] }> }
        | undefined;
      if (isExternalService) {
        lines.push(`**API currency (third-party integration):** endpoints, parameters, auth flows, and webhook formats change on the vendor's schedule. Before implementing against this service, consult the current documentation${apiRef?.docsUrl ? ` at ${apiRef.docsUrl}` : ""}; the curated guidance below is orientation and doctrine, not a substitute. Where the live docs contradict this packet, the live docs win — surface the discrepancy to the user so the catalog row gets re-verified.`);
        lines.push("");
      }
      // N8.1b (owner): the node CARRIES the service's API reference. For non-external
      // technologies (SDKs, frameworks, self-hosted infra) that snapshot spares the AI
      // a fetch; for externals it is a curated ORIENTATION over the live docs (above).
      // When the user selected areas (config.apiAreas, the multiselect), only those
      // render; otherwise the available areas are listed with a pointer to the selector.
      if (apiRef?.areas && Object.keys(apiRef.areas).length > 0) {
        const areaNames = Object.keys(apiRef.areas);
        const rawSelection = nodeConfig?.apiAreas;
        const selected = Array.isArray(rawSelection)
          ? areaNames.filter((a) => (rawSelection as unknown[]).includes(a))
          : [];
        lines.push(isExternalService
          ? `**API Reference** (curated snapshot — verify against the live docs${apiRef.docsUrl ? `: ${apiRef.docsUrl}` : ""} before implementing):`
          : `**API Reference** (curated — do not fetch externally${apiRef.docsUrl ? `; full docs: ${apiRef.docsUrl}` : ""}):`);
        lines.push("");
        if (selected.length > 0) {
          for (const name of selected) {
            const area = apiRef.areas[name];
            lines.push(`#### ${name}${area.docsUrl ? ` — ${area.docsUrl}` : ""}`);
            for (const endpoint of area.endpoints ?? []) {
              lines.push(`- ${endpoint}`);
            }
            lines.push("");
          }
          const unselected = areaNames.filter((a) => !selected.includes(a));
          if (unselected.length > 0) {
            lines.push(`_Not selected for this component (available if scope grows): ${unselected.join(", ")}._`);
            lines.push("");
          }
        } else {
          lines.push(`Available areas — the user has not selected which this component uses (inspector → Configuration): ${areaNames.join(", ")}. Confirm the needed areas with the user before implementing against them.`);
          lines.push("");
        }
        // N8.1c: the trust signal travels WITH the reference.
        const prov = (ctx as Record<string, unknown>).provenance as { verifiedAt?: string; method?: string } | undefined;
        if (prov?.verifiedAt) {
          lines.push(`_Reference provenance: verified ${prov.verifiedAt} · ${prov.method ?? "unrecorded"}._`);
          lines.push("");
        }
      }
    }
    if (ctx.sdkInitPattern) {
      lines.push("**SDK Initialization:**");
      lines.push("```");
      lines.push(normalizeFlattenedCode(ctx.sdkInitPattern));
      lines.push("```");
      lines.push("");
    }
    if (ctx.commonApiPatterns && ctx.commonApiPatterns.length > 0) {
      lines.push("**Common API Patterns:**");
      lines.push("");
      for (const pattern of ctx.commonApiPatterns) {
        lines.push(`#### ${pattern.name}`);
        if (pattern.description) lines.push(pattern.description);
        lines.push("```");
        lines.push(normalizeFlattenedCode(pattern.codeTemplate));
        lines.push("```");
        lines.push("");
      }
    }
    if (ctx.configurationTemplate) {
      lines.push("**Configuration Template:**");
      lines.push("```");
      lines.push(normalizeFlattenedCode(ctx.configurationTemplate));
      lines.push("```");
      lines.push("");
    }
    if (ctx.bestPractices && ctx.bestPractices.length > 0) {
      lines.push("**Best Practices:**");
      for (const bp of ctx.bestPractices) {
        lines.push(`- ${bp}`);
      }
      lines.push("");
    }
    if (ctx.antiPatterns && ctx.antiPatterns.length > 0) {
      lines.push("**Anti-Patterns to Avoid:**");
      for (const ap of ctx.antiPatterns) {
        lines.push(`- ${ap}`);
      }
      lines.push("");
    }
    // N8.4g: dated deprecation/license facts render in the packet, not in dead keys.
    if ((ctx as Record<string, unknown>).freshnessNote) {
      lines.push(`**Freshness:** ${(ctx as Record<string, unknown>).freshnessNote}`);
      lines.push("");
    }
    if (ctx.securityGuidance) {
      lines.push(`**Security:** ${ctx.securityGuidance}`);
      lines.push("");
    }
    if (ctx.integrationPatterns && ctx.integrationPatterns.length > 0) {
      lines.push("**Integration Patterns:**");
      for (const ip of ctx.integrationPatterns) {
        lines.push(`- ${ip}`);
      }
      lines.push("");
    }
    if (techRow.suggested_files && techRow.suggested_files.length > 0) {
      lines.push("**Suggested File Structure:**");
      for (const sf of techRow.suggested_files) {
        lines.push(`- \`${sf.path}\` (${sf.kind})`);
      }
      lines.push("");
    }
  }

  // -- Manual Steps (N5.7: RULE-driven, consistently formatted) --
  // The section renders whenever the node is NOT fully configurable by AI code output
  // (console-configured engines, provider-managed / external services) — even when the
  // catalog carries no steps yet (honest placeholder) — and additionally whenever
  // catalog setupInstructions exist for any node.
  if (needsManualSteps && setupSteps.length === 0) {
    lines.push("## Manual Steps");
    lines.push("");
    lines.push("> This node is configured outside the repo — AI code output cannot complete it.");
    lines.push("");
    lines.push("No catalog steps exist for this technology yet. Derive the required manual");
    lines.push("configuration from the contracts and Configuration sections above, record the");
    lines.push("steps via the proposal flow (update this task doc), and do NOT mark this node");
    lines.push("complete until they are done.");
    lines.push("");
  }
  if (setupSteps.length > 0) {
    const allSteps = setupSteps;
    const required = allSteps.filter((s: { required: boolean }) => s.required);
    const optional = allSteps.filter((s: { required: boolean }) => !s.required);

    lines.push("## Manual Steps");
    lines.push("");
    lines.push("> The following steps require manual action by a human. AI cannot complete these steps automatically.");
    lines.push("");

    // Compact summary checklist
    lines.push("**Quick checklist:**");
    for (const step of required) {
      lines.push(`- [ ] ${step.title} *(required)*`);
    }
    for (const step of optional) {
      lines.push(`- [ ] ${step.title} *(optional)*`);
    }
    lines.push("");

    // Full details — required first
    if (required.length > 0) {
      lines.push("### Required Steps");
      lines.push("");
      for (const step of required) {
        lines.push(`#### [${step.type}] ${step.title}`);
        lines.push("");
        lines.push(step.instructions);
        lines.push("");
        if (step.commands && step.commands.length > 0) {
          lines.push("```bash");
          for (const cmd of step.commands) {
            lines.push(cmd);
          }
          lines.push("```");
          lines.push("");
        }
        if (step.url) {
          lines.push(`**Reference:** ${step.url}`);
          lines.push("");
        }
      }
    }

    if (optional.length > 0) {
      lines.push("### Optional Steps");
      lines.push("");
      for (const step of optional) {
        lines.push(`#### [${step.type}] ${step.title}`);
        lines.push("");
        lines.push(step.instructions);
        lines.push("");
        if (step.commands && step.commands.length > 0) {
          lines.push("```bash");
          for (const cmd of step.commands) {
            lines.push(cmd);
          }
          lines.push("```");
          lines.push("");
        }
        if (step.url) {
          lines.push(`**Reference:** ${step.url}`);
          lines.push("");
        }
      }
    }
  }

  // N5.7: "Connected Components" (a lossy duplicate of Interface Contracts) and the
  // bottom "Acceptance Criteria Implementation Map" (now merged inline into
  // Requirements — Your Scope) are GONE — same truth, stated once, where it's used.

  // -- Dependency Chain --
  if (contracts.length > 0) {
    const depChain = buildDependencyChain(node, graph, contracts);
    if (depChain.mustBeAvailable.length > 0 || depChain.dependsOnThis.length > 0 || depChain.softDependencies.length > 0) {
      lines.push("## Dependency Chain");
      lines.push("");
      lines.push("Startup/initialization order based on edge directions and interaction patterns.");
      lines.push("");
      if (depChain.mustBeAvailable.length > 0) {
        lines.push("**Must be available BEFORE this node starts:**");
        for (const dep of depChain.mustBeAvailable) {
          lines.push(`- ${dep.label} (${dep.reason})`);
        }
        lines.push("");
      }
      if (depChain.softDependencies.length > 0) {
        lines.push("**Optional / fallback dependencies (NOT startup-blocking):**");
        for (const dep of depChain.softDependencies) {
          lines.push(`- ${dep.label} (${dep.reason})`);
        }
        lines.push("");
      }
      if (depChain.dependsOnThis.length > 0) {
        lines.push("**Depends on THIS node being available:**");
        for (const dep of depChain.dependsOnThis) {
          lines.push(`- ${dep.label} (${dep.reason})`);
        }
        lines.push("");
      }
    }
  }

  // -- Error Handling Contracts --
  if (contracts.length > 0) {
    const errorContracts = buildErrorHandlingContracts(contracts);
    if (errorContracts.emits.length > 0 || errorContracts.handles.length > 0) {
      lines.push("## Error Handling Contracts");
      lines.push("");
      if (errorContracts.emits.length > 0) {
        lines.push("**Errors this node MUST emit to consumers:**");
        for (const e of errorContracts.emits) {
          lines.push(`- ${e}`);
        }
        lines.push("");
      }
      if (errorContracts.handles.length > 0) {
        lines.push("**Errors this node MUST handle from dependencies:**");
        for (const h of errorContracts.handles) {
          lines.push(`- ${h}`);
        }
        lines.push("");
      }
    }
  }

  // -- Containment --
  if (node.parentId) {
    const parent = graph.nodes[node.parentId];
    if (parent) {
      lines.push(`**Parent Container:** ${parent.label} (${parent.type})`);
      lines.push("");
    }
    // N8.4r: the containers' OWN configuration scopes this node — region, environment,
    // IAM baseline, tagging policy. Printing the parent's label alone left every one of
    // those choices invisible to the implementing AI.
    const inherited = renderInheritedContext(collectInheritedScopes(graph, node.id));
    if (inherited) {
      lines.push(inherited);
      lines.push("");
    }
  }
  const children = Object.values(graph.nodes).filter((n) => n.parentId === node.id);
  if (children.length > 0) {
    lines.push("**Contains:**");
    for (const child of children) {
      const tech = child.technology ? ` [${child.technology}]` : "";
      lines.push(`- ${child.label}${tech} (${child.type})`);
    }
    lines.push("");
  }

  // -- Existing Implementation --
  const nodeArtifacts = Object.values(graph.artifacts).filter(
    (a) => a.nodeId === node.id && a.kind !== "task" && a.status !== "suggested"
  );
  if (nodeArtifacts.length > 0) {
    lines.push("## Existing Implementation");
    lines.push("");
    lines.push("| File | Kind | Language | Status |");
    lines.push("|------|------|----------|--------|");
    for (const a of nodeArtifacts) {
      const lang = a.language || "---";
      const status = a.status || "draft";
      const desc = a.description ? ` - ${a.description}` : "";
      lines.push(`| \`${a.path}\`${desc} | ${a.kind} | ${lang} | ${status} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

interface ContractDetail {
  direction: "incoming" | "outgoing";
  contractKind: string;
  contractName: string;
  interactionKind: string | null;
  transport: string | null;
  specFormat: string | null;
  /** N8.6(C): the EDGE's criticality (required default) — dependency ordering honors it. */
  criticality: string | null;
  connectedNodeId: string;
  connectedNodeLabel: string;
  connectedNodeRole: string;
  connectedNodeTechnology: string | null;
  schemaContent: string | null;
  /** WS2: schemaRef set but the artifact is missing or contentless — the ref claims a
   *  schema that does not exist. Carries the broken artifact id; null when the ref is
   *  absent or resolves. Renders as ⚠ SCHEMA REFERENCE BROKEN, never as "no schema". */
  danglingSchemaRef: string | null;
}

// P0-3: inferPayloadShape used to live here, fabricating REST/event/gRPC/GraphQL payload
// shapes for schema-less contracts. Deleted — a contract with no schema now renders an
// explicit "⚠ SCHEMA UNDEFINED" block instead of an invented interface.

function buildContractSection(node: GraphNode, graph: GraphData): ContractDetail[] {
  const results: ContractDetail[] = [];

  for (const edge of Object.values(graph.edges)) {
    if (edge.source !== node.id && edge.target !== node.id) continue;

    const contract = graph.contracts[edge.contractId];
    if (!contract) continue;

    const isOutgoing = edge.source === node.id;
    const connectedId = isOutgoing ? edge.target : edge.source;
    const connectedNode = graph.nodes[connectedId];

    let schemaContent: string | null = null;
    let danglingSchemaRef: string | null = null;
    if (contract.schema && Object.keys(contract.schema).length > 0) {
      schemaContent = JSON.stringify(contract.schema, null, 2);
    } else if (contract.schemaRef) {
      const schemaArtifact = graph.artifacts[contract.schemaRef];
      if (schemaArtifact?.content) {
        schemaContent =
          typeof schemaArtifact.content === "string"
            ? schemaArtifact.content
            : JSON.stringify(schemaArtifact.content, null, 2);
      } else {
        // WS2 (owner live test 2026-07-31): ref set, artifact missing/contentless. The
        // old code silently equated this with "no schema", so the doc and readiness
        // both told the AI to DRAFT one while the model claimed one existed elsewhere.
        danglingSchemaRef = contract.schemaRef;
      }
    }

    results.push({
      direction: isOutgoing ? "outgoing" : "incoming",
      contractKind: contract.kind,
      contractName: contract.name,
      interactionKind: contract.interactionKind || null,
      transport: contract.transport || null,
      specFormat: contract.specFormat || null,
      criticality: edge.criticality || null,
      connectedNodeId: connectedId,
      connectedNodeLabel: connectedNode?.label || connectedId,
      connectedNodeRole: connectedNode?.type || "unknown",
      connectedNodeTechnology: connectedNode?.technology || null,
      schemaContent,
      danglingSchemaRef,
    });
  }

  return results;
}

interface CriteriaMapEntry {
  requirementName: string;
  criteria: Array<{
    text: string;
    satisfiedBy: string;
    crossNodeDependencies: string[];
    /** N5.11: the ContractDetail.contractName the matcher VERIFIED (requirement mapped
     *  to the connected node too), so task synthesis can attach the criterion to that
     *  contract's task. Null = no contract evidence — the criterion stays this node's
     *  own work order. A keyword-only hit never sets this (Camera System live find
     *  2026-09-01: it swept every criterion onto the wrong contract task). */
    matchedContractName: string | null;
    /** Keyword-only contract hit — a soft note, never task routing. */
    coordinationHint: string | null;
  }>;
}

// Vocabulary that appears in almost every contract name and proves nothing about
// WHICH interface a criterion belongs to.
const GENERIC_CONTRACT_TOKENS = new Set([
  "interface", "system", "service", "data", "contract", "api",
  "config", "configuration", "integration", "connection", "component", "module",
]);

function buildAcceptanceCriteriaMap(
  node: GraphNode,
  _graph: GraphData,
  requirements: RequirementForTask[],
  contracts: ContractDetail[],
  requirementNodeMap?: Record<string, string[]>
): CriteriaMapEntry[] {
  const entries: CriteriaMapEntry[] = [];

  // Self-reference subtraction (Camera System, 2026-09-01): contract names
  // conventionally embed the OWNING node's domain noun ("Camera Hint Interface"
  // on Camera System), and every criterion of a requirement mapped to this node
  // uses that noun too. A token this node's own label carries is ownership
  // evidence, never cross-node evidence.
  const ownTokens = new Set(
    (node.label || "").toLowerCase().split(/[\s_:\-/]+/).filter((t) => t.length > 2),
  );

  for (const req of requirements) {
    if (req.acceptanceCriteria.length === 0) continue;

    const mappedNodeIds = requirementNodeMap?.[req.requirementId];

    const criteriaList: CriteriaMapEntry["criteria"] = [];
    for (const ac of req.acceptanceCriteria) {
      const acLower = ac.text.toLowerCase();
      const crossNodeDeps: string[] = [];
      let satisfiedBy = "Internal logic of this component";
      let matchedContractName: string | null = null;
      let coordinationHint: string | null = null;

      // Score EVERY contract — no first-match break, so iteration order never
      // decides attribution. Verified evidence (requirement mapped to the
      // connected node) beats any keyword count; ties go to more keyword hits,
      // then to the earlier contract (stable).
      let best: { c: ContractDetail; verified: boolean; hits: number } | null = null;
      for (const c of contracts) {
        const connLabel = c.connectedNodeLabel.toLowerCase();
        const contractNameLower = c.contractName.toLowerCase();
        // Full phrases stay matchable even when they carry this node's noun —
        // a criterion quoting the whole contract name is strong signal. Single
        // tokens are filtered: generic vocabulary and this node's own tokens
        // prove nothing about the connected side.
        const phrases = [connLabel, contractNameLower].filter((k) => k.length > 2);
        const tokens = [...contractNameLower.split(/[\s_-]+/), ...connLabel.split(/[\s_:\-/]+/)]
          .filter((k) => k.length > 2 && !GENERIC_CONTRACT_TOKENS.has(k) && !ownTokens.has(k));
        const hits = [...new Set([...phrases, ...tokens])].filter((kw) => acLower.includes(kw)).length;
        if (hits === 0) continue;
        const verified = !!(mappedNodeIds && mappedNodeIds.includes(c.connectedNodeId));
        if (!best
          || (verified && !best.verified)
          || (verified === best.verified && hits > best.hits)) {
          best = { c, verified, hits };
        }
      }

      if (best) {
        const preposition = best.c.direction === "outgoing" ? "to" : "from";
        const label = `Contract "${best.c.contractName}" (${best.c.contractKind}) ${preposition} ${best.c.connectedNodeLabel}`;
        if (best.verified) {
          // Real cross-node evidence — the criterion may ride this contract's task.
          satisfiedBy = label;
          matchedContractName = best.c.contractName;
          crossNodeDeps.push(best.c.connectedNodeLabel);
        } else {
          // Keyword-only signal: ownership stays with THIS node (the criterion
          // gets its own Implement work order); the hint survives as a note.
          // The old behavior demoted to "candidate" but still routed the
          // criterion onto the contract task — the verification and the
          // routing disagreed, and the doc then warned about its own mistake.
          coordinationHint = label;
        }
      }

      criteriaList.push({
        text: ac.text,
        satisfiedBy,
        crossNodeDependencies: crossNodeDeps,
        matchedContractName,
        coordinationHint,
      });
    }

    entries.push({ requirementName: `${req.requirementId}: ${req.name}`, criteria: criteriaList });
  }

  return entries;
}

// ── N5.11: deterministic task synthesis ──────────────────────────────────────────────
// Owner direction 2026-07-24: "I want the task document checkboxes to be explicit,
// contextual-to-that-node and its integrations/deployment/constraints/traceability to
// acceptance criteria." N5.10 delegated authoring to the consuming AI — too weak. The
// old internal v4 workflow worked because its prompt was a MANDATORY ordered checklist;
// this is that rubric, encoded deterministically. Everything a concrete task list needs
// is already computed (deliverable kind, contracts + schema state, criterion
// attribution, config, setup steps, dependency order) — this function COMPOSES them
// into ordered task boxes. Mechanical assembly, no LLM: full inversion intact.
//
// Task order: T1 foundation (by deliverable kind) → outgoing contracts (must-be-
// available targets first) → incoming contract exposure → unmatched solo criteria →
// owner-unresolved criteria → required manual steps → final verification. Every UNMET
// criterion appears in exactly one task's serves-list; model gaps become standardized
// `[PLACEHOLDER: …]` tags instead of invented detail.

interface CriterionForSynthesis {
  key: string; // `${requirementId}: ${name}::${text}` — same key the render loop uses
  reqId: string;
  text: string;
  /** VERIFIED contract evidence only — a keyword-only hit never sets this. */
  matchedContractName: string | null;
  /** Keyword-only contract hit, rendered as a soft note on the serves line. */
  coordinationHint: string | null;
  crossNodeDependencies: string[];
  sharedLabels: string[];
}

interface SynthTask {
  title: string;
  details: string[];
  serves: CriterionForSynthesis[];
}

interface SynthesizedTaskList {
  lines: string[];
  criterionTaskRef: Map<string, string>;
}

function buildImplementationTasks(args: {
  deliverable: DeliverableKind;
  componentName: string;
  parentLabel: string | null;
  contracts: ContractDetail[];
  criteria: CriterionForSynthesis[];
  requiredSetupTitles: string[];
  hasUserConfig: boolean;
  /** N8.1b: user explicitly chose "AI decides" for configuration — delegation, not a gap. */
  configDelegated?: boolean;
  suggestedFiles: string[];
  /** N5.16: labels of components hosted INSIDE this node (containers only) — each
   *  must be represented in the container's provisioning definition. */
  hostedChildren?: string[];
  /** A4: anchor key → done; keys the doc will emit render `[x]` when true. */
  taskState?: Map<string, boolean>;
}): SynthesizedTaskList {
  const { deliverable, componentName, parentLabel, contracts, criteria, requiredSetupTitles, hasUserConfig, configDelegated = false, suggestedFiles, hostedChildren = [], taskState } = args;
  const tasks: SynthTask[] = [];

  // Partition criteria by evidence (mirrors the Requirements-section attribution).
  const byContract = new Map<string, CriterionForSynthesis[]>();
  const soloInternal: CriterionForSynthesis[] = [];
  const ownerUnresolved: CriterionForSynthesis[] = [];
  for (const c of criteria) {
    if (c.matchedContractName) {
      const list = byContract.get(c.matchedContractName) ?? [];
      list.push(c);
      byContract.set(c.matchedContractName, list);
    } else if (c.sharedLabels.length > 0) {
      ownerUnresolved.push(c);
    } else {
      soloInternal.push(c);
    }
  }

  // T1 — the foundation task, phrased by deliverable kind.
  const configNote = hasUserConfig
    ? "Honor the user's choices in ## Configuration."
    : configDelegated
    ? "Configuration delegated by the user — choose sensible defaults per the Technology Guidance and record them (see ## Configuration)."
    : "[PLACEHOLDER: config — no user configuration recorded for this node; confirm sizing/domains/settings with the user]";
  switch (deliverable) {
    case "code": {
      const details = ["Create the source layout, build files, and test harness this node's working code lives in."];
      if (suggestedFiles.length > 0) {
        details.push(`Start from the catalog's suggested structure: ${suggestedFiles.map((f) => `\`${f}\``).join(", ")}.`);
      }
      tasks.push({ title: `Scaffold the ${componentName} component.`, details, serves: [] });
      break;
    }
    case "declarative":
      tasks.push({
        title: `Provision ${componentName} via IaC.`,
        details: [
          `Author the provisioning definition as config artifacts bound to this node — existence, wiring, permissions${parentLabel ? `, deployed under ${parentLabel}` : ""}.`,
          configNote,
        ],
        serves: [],
      });
      break;
    case "definition-as-code":
      tasks.push({
        title: `Author the ${componentName} definition artifact.`,
        details: [
          "The engine's definition IS the deliverable — in whatever form this engine's definitions take (workflow/DAG, gateway config, manifest set, scrape/rule config). Author it as a code artifact bound to this node. Never reimplement the engine's internals as application code.",
          ...(hasUserConfig ? ["Honor the user's choices in ## Configuration."] : []),
        ],
        serves: [],
      });
      break;
    case "external-config":
      tasks.push({
        title: `Record the connection configuration for ${componentName}.`,
        details: [
          "Endpoints, credential references, and identifiers, as config artifacts bound to this node. The service itself is configured in its own environment — see ## Manual Steps.",
        ],
        serves: [],
      });
      break;
    case "connection-only":
      tasks.push({
        title: `Record the client connection configuration for ${componentName}.`,
        details: [
          "Endpoints, credential references, and client settings for this external service, as config artifacts bound to this node.",
        ],
        serves: [],
      });
      break;
    case "config":
      tasks.push({
        title: `Author the binding configuration for ${componentName}.`,
        details: [
          "Configuration artifacts that bind this engine into the system — the engine owns its internals; never reimplement them.",
        ],
        serves: [],
      });
      break;
  }

  // N5.16 (owner: "docker compose correctly accounted for"): a container's definition
  // must account for every hosted component — a child missing from the definition
  // will not run. Rendered right after the foundation task.
  if (hostedChildren.length > 0) {
    tasks.push({
      title: "Account for every hosted component in this container's definition.",
      details: [
        `Hosted here: ${hostedChildren.join(", ")}.`,
        "Each hosted component must be represented in the provisioning definition (compose service entry / subnet placement / deployment target, as appropriate for this container).",
      ],
      serves: [],
    });
  }

  const takeServes = (contractName: string): CriterionForSynthesis[] => {
    const assigned = byContract.get(contractName) ?? [];
    byContract.delete(contractName);
    return assigned;
  };

  const schemaDetail = (c: ContractDetail): string => {
    if (c.contractKind === "dependency" || c.interactionKind === "dependency") {
      return "Dependency contract — capture the reference/identifier wiring in this node's config artifacts; no payload schema expected.";
    }
    if (c.schemaContent) return "Build to the contract schema EXACTLY (see Interface Contracts).";
    return `[PLACEHOLDER: schema — Contract "${c.contractName}" has no schema; propose one via propose_patches before building against this interface]`;
  };

  // Outgoing contract tasks — must-be-available targets first (dependency order).
  const outgoingVerb = deliverable === "code"
    ? "Implement the integration with"
    : deliverable === "declarative" || deliverable === "definition-as-code" || deliverable === "config"
      ? "Declare the wiring to"
      : "Record the connection configuration for";
  const outgoing = contracts.filter((c) => c.direction === "outgoing");
  outgoing.sort((a, b) => Number(isSyncOutgoing(b)) - Number(isSyncOutgoing(a)));
  for (const c of outgoing) {
    const tech = c.connectedNodeTechnology ? ` (${c.connectedNodeTechnology})` : "";
    tasks.push({
      title: `${outgoingVerb} ${c.connectedNodeLabel}${tech} per Contract "${c.contractName}" (${c.contractKind}).`,
      details: [schemaDetail(c)],
      serves: takeServes(c.contractName),
    });
  }

  // Incoming contract tasks — expose what the source needs.
  for (const c of contracts.filter((x) => x.direction === "incoming")) {
    tasks.push({
      title: `Expose the interface ${c.connectedNodeLabel} consumes, per Contract "${c.contractName}" (${c.contractKind}).`,
      details: [
        `Record the endpoint/identifiers ${c.connectedNodeLabel} needs in this node's config artifacts — coordinate with ${c.connectedNodeLabel}.`,
        schemaDetail(c),
      ],
      serves: takeServes(c.contractName),
    });
  }

  // Criteria with no contract evidence.
  const criterionVerb = deliverable === "code" ? "Implement" : "Configure the service to satisfy";
  for (const c of soloInternal) {
    tasks.push({
      title: `${criterionVerb}: "${c.text}" (${c.reqId}).`,
      details: ["No interface contract maps to this criterion — it is this node's internal responsibility."],
      serves: [c],
    });
  }
  for (const c of ownerUnresolved) {
    tasks.push({
      title: `Resolve ownership, then implement: "${c.text}" (${c.reqId}).`,
      details: [
        `[PLACEHOLDER: owner — this node or a sharing node (${c.sharedLabels.join(", ")}); assign via the requirement mapping, then keep this task here or move it to the owning node's doc]`,
      ],
      serves: [c],
    });
  }

  // Required manual steps become tasks for the kinds that cannot be completed by code output.
  for (const title of requiredSetupTitles) {
    tasks.push({
      title: `Complete manual step: ${title}.`,
      details: ["See ## Manual Steps for instructions — a human must perform this; do not mark it done from code output alone."],
      serves: [],
    });
  }

  // Final verification task. WS3 doctrine: plans follow schemas (contract-first TDD),
  // and verification is split into two lanes — automated criteria flip only on
  // report_test_results evidence; manual criteria flip only via the R5 task-doc
  // tick + user-approved change card. This work order states both, in order.
  tasks.push({
    title: "Verify every acceptance criterion above and tick its box.",
    details: [
      "Ordering doctrine — plans follow schemas (contract-first TDD): schemas → test plans → implement → verify. Resolve any open [PLACEHOLDER: schema] gap FIRST (get_build_readiness supplies draftInputs; submit the schema via propose_patches update_contract) — test-plan scenarios touching a schemaless contract stay one-line [blocked by schema: …] markers until the schema lands, then the plan refreshes itself.",
      "AUTOMATED criteria: call get_test_plan for EACH requirement this node serves, implement the plan's test cases, run them, and report every outcome via report_test_results — a passing result flips the criterion's met flag automatically and the response receipt shows which criteria flipped.",
      "MANUAL criteria (rows marked (manual) above): report_test_results REFUSES to bind them — prove each by ticking its criterion box in this task doc and having the user approve the resulting change card; that approval is the only thing that flips a manual criterion met.",
      "This node is complete only when every criterion box is ticked and no `[PLACEHOLDER: …]` tag remains open.",
    ],
    serves: [],
  });

  // Emit. A4: every task line carries a stable content-derived anchor
  // (`<!-- t:key -->`, key = hash of the title) so ticks survive
  // regeneration and renumbering — identity is content, never position.
  // Recorded done-state renders `[x]`; without it a regen wipes progress.
  const lines: string[] = [];
  const criterionTaskRef = new Map<string, string>();
  const taskKeys = assignTaskKeys(tasks.map((t) => t.title));
  tasks.forEach((t, i) => {
    const id = `T${i + 1}`;
    const key = taskKeys[i];
    const done = taskState?.get(key) === true;
    lines.push(`- [${done ? "x" : " "}] **${id} — ${t.title}** <!-- t:${key} -->`);
    for (const d of t.details) lines.push(`  ${d}`);
    for (const s of t.serves) {
      criterionTaskRef.set(s.key, id);
      // Every serves-line is now the VERIFIED form the board aligner reads —
      // attribution routing no longer produces criteria the doc distrusts.
      // A keyword-only contract hit rides along as a soft note (it names a
      // contract worth consulting, never a different owner).
      const coordinate = s.crossNodeDependencies.length > 0 ? ` — coordinate with ${s.crossNodeDependencies.join(", ")}` : "";
      const hint = s.coordinationHint ? ` — possible coordination point: ${s.coordinationHint} (keyword signal only)` : "";
      lines.push(`  ↳ serves: ${s.reqId} "${s.text}"${coordinate}${hint}`);
    }
  });

  return { lines, criterionTaskRef };
}

// Real enum sets (N5.6 — see buildDependencyChain header). Module scope since N5.11:
// task synthesis orders contract tasks by the same must-be-available classification.
const ASYNC_INTERACTIONS = new Set(["event", "queue", "telemetry"]);
const SYNC_INTERACTIONS = new Set(["request_response", "data_read", "data_write", "data_sync", "auth", "dependency", "ipc", "file_transfer"]);
const ASYNC_KINDS = new Set(["kafka", "amqp"]);
const SYNC_KINDS = new Set(["rest", "graphql", "grpc", "websocket", "sse", "sql", "nosql", "ipc", "dependency", "custom"]);
const CALL_LIKE = new Set(["request_response", "auth", "rest", "graphql", "grpc", "websocket", "sse"]);

// N8.6(A): websocket/sse are CONNECTION-ORIENTED. Their payload semantics are event
// (async — interactionKind stays 'event', ASYNC_INTERACTIONS keeps it), but dependency
// ORDERING follows the transport: you connect TO the server, so the target of an
// outgoing websocket/sse edge must exist first. Checked on the contract KIND before
// any interactionKind classification — a documented exception, not a re-labeling.
// Without it, interactionKind 'event' (which the UI always fills) routed these to the
// async branch and the packet said the websocket SERVER consumes this node's output.
const CONNECTION_ORIENTED_KINDS = new Set(["websocket", "sse"]);

function isSyncOutgoing(c: ContractDetail): boolean {
  if (CONNECTION_ORIENTED_KINDS.has(c.contractKind ?? "")) return true;
  return SYNC_INTERACTIONS.has(c.interactionKind ?? "") || (!c.interactionKind && SYNC_KINDS.has(c.contractKind ?? ""));
}

interface DependencyChainResult {
  mustBeAvailable: Array<{ label: string; reason: string }>;
  dependsOnThis: Array<{ label: string; reason: string }>;
  /** N8.6(C): outgoing sync targets whose edge is optional/fallback — real
   *  dependencies, but NOT startup-blocking; listing them under must-be-available
   *  would contradict the criticality the user set. */
  softDependencies: Array<{ label: string; reason: string }>;
}

function buildDependencyChain(
  _node: GraphNode,
  _graph: GraphData,
  contracts: ContractDetail[]
): DependencyChainResult {
  const mustBeAvailable: Array<{ label: string; reason: string }> = [];
  const dependsOnThis: Array<{ label: string; reason: string }> = [];
  const softDependencies: Array<{ label: string; reason: string }> = [];
  const seenUp = new Set<string>();
  const seenDown = new Set<string>();

  // N5.6 (owner bench doc, CloudFront packet): this function used to branch on tokens
  // that don't exist in the enums (`rest_api`, `pub_sub`, `database`), so every real
  // outgoing sync call (`rest`, `grpc`, `sql`, …) fell to the else-branch and the doc
  // told the AI its ORIGINS "depend on this node" — inverted. Branch on the REAL enums:
  // interactionKind when present, contract kind as fallback. An outgoing sync/data/
  // dependency edge means the TARGET must exist first; an outgoing async edge (kafka/
  // amqp/event/queue) means the target consumes us. An incoming sync CALL means the
  // CALLER depends on us (the old code inverted this too); incoming data_read/write
  // means the reader depends on us; incoming dependency-style edges keep the
  // "provides via" reading (DNS → CDN).
  for (const c of contracts) {
    const interaction = c.interactionKind || c.contractKind;
    const connectionOriented = CONNECTION_ORIENTED_KINDS.has(c.contractKind ?? "");
    const isAsync = !connectionOriented && (ASYNC_INTERACTIONS.has(c.interactionKind ?? "") || (!c.interactionKind && ASYNC_KINDS.has(c.contractKind ?? "")));
    const isSync = connectionOriented || SYNC_INTERACTIONS.has(c.interactionKind ?? "") || (!c.interactionKind && SYNC_KINDS.has(c.contractKind ?? ""));

    if (c.direction === "outgoing") {
      if (seenDown.has(c.connectedNodeLabel)) continue;
      seenDown.add(c.connectedNodeLabel);

      if (isAsync) {
        dependsOnThis.push({ label: c.connectedNodeLabel, reason: `consumes this node's output via ${c.contractName} (${interaction})` });
      } else if (isSync) {
        // N8.6(C): the edge's criticality decides WHICH list. An optional/fallback
        // dependency is real but not startup-blocking — the user explicitly said this
        // node must start and degrade gracefully without it.
        if (c.criticality === "optional" || c.criticality === "fallback") {
          softDependencies.push({ label: c.connectedNodeLabel, reason: `${c.criticality} dependency via ${c.contractName} (${interaction}) — this node must start and degrade gracefully when it is unavailable` });
        } else {
          mustBeAvailable.push({ label: c.connectedNodeLabel, reason: `this node calls/depends on it via ${c.contractName} (${interaction})` });
        }
      } else {
        dependsOnThis.push({ label: c.connectedNodeLabel, reason: `receives from this node via ${c.contractName} (${interaction})` });
      }
    } else {
      if (seenUp.has(c.connectedNodeLabel)) continue;
      seenUp.add(c.connectedNodeLabel);

      const incomingInteraction = c.interactionKind ?? "";
      if (incomingInteraction === "data_read" || incomingInteraction === "data_write" || incomingInteraction === "data_sync") {
        dependsOnThis.push({ label: c.connectedNodeLabel, reason: `reads/writes this node via ${c.contractName}` });
      } else if (isAsync) {
        // Async producers don't create a startup ordering either way.
      } else if (CALL_LIKE.has(c.interactionKind ?? "") || (!c.interactionKind && CALL_LIKE.has(c.contractKind ?? ""))) {
        dependsOnThis.push({ label: c.connectedNodeLabel, reason: `calls this node via ${c.contractName} (${interaction})` });
      } else {
        // N5.9 (owner acceptance review): an incoming edge means the SOURCE points at
        // this node — the source needs it, never the other way. The old "provides X to
        // this node → must-be-available" reading made Route 53 ↔ CloudFront list each
        // other as startup dependencies (a cycle). Incoming edges never produce
        // must-be-available.
        dependsOnThis.push({ label: c.connectedNodeLabel, reason: `initiates ${c.contractName} against this node (${interaction})` });
      }
    }
  }

  return { mustBeAvailable, dependsOnThis, softDependencies };
}

interface ErrorHandlingResult {
  emits: string[];
  handles: string[];
}

// N8.6(A): protocol guidance keys on the contract KIND first, semantics on the
// interactionKind second. The old `interactionKind || contractKind` collapse made
// every kind-specific branch (grpc, websocket) unreachable whenever interactionKind
// was set — which is always, since the UI force-fills it — and half the tokens it
// tested (`rest_api`, `pub_sub`, `async_job`, `database`, `realtime`) exist in no
// enum anywhere. Kind carries the protocol (gRPC status codes, WS reconnection,
// SSE Last-Event-ID); interactionKind carries the semantic class when the kind has
// no protocol-specific story (rest/custom/kafka/amqp/sql fall through to it).
function buildErrorHandlingContracts(contracts: ContractDetail[]): ErrorHandlingResult {
  const emits: string[] = [];
  const handles: string[] = [];

  for (const c of contracts) {
    const kind = c.contractKind ?? "";
    const interaction = c.interactionKind ?? "";

    if (c.direction === "outgoing") {
      if (kind === "grpc") {
        handles.push(`gRPC errors from ${c.connectedNodeLabel} ("${c.contractName}"): handle UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED status codes`);
      } else if (kind === "websocket") {
        handles.push(`WebSocket failures for ${c.connectedNodeLabel} ("${c.contractName}"): handle disconnection, reconnection with backoff, and message ordering`);
      } else if (kind === "sse") {
        handles.push(`SSE stream failures from ${c.connectedNodeLabel} ("${c.contractName}"): reconnect with Last-Event-ID to resume, handle mid-stream disconnects and retry directives`);
      } else if (kind === "graphql") {
        handles.push(`GraphQL errors from ${c.connectedNodeLabel} ("${c.contractName}"): handle the errors array on 200 responses, partial data, and transport-level failures separately`);
      } else if (interaction === "request_response" || interaction === "auth" || kind === "rest") {
        handles.push(`HTTP errors from ${c.connectedNodeLabel} ("${c.contractName}"): handle 4xx (client error), 5xx (server error), timeouts, and connection refused`);
      } else if (interaction === "event" || kind === "kafka") {
        emits.push(`Event delivery failures to ${c.connectedNodeLabel} ("${c.contractName}"): implement dead-letter queue or retry with exponential backoff`);
      } else if (interaction === "queue" || kind === "amqp") {
        handles.push(`Queue acknowledgment failures for ${c.connectedNodeLabel} ("${c.contractName}"): implement retry semantics with max-retry cap and DLQ`);
      } else if (interaction === "data_read" || interaction === "data_write" || interaction === "data_sync" || kind === "sql" || kind === "nosql") {
        handles.push(`Database errors from ${c.connectedNodeLabel} ("${c.contractName}"): handle connection pool exhaustion, query timeout, constraint violations, and deadlocks`);
      }
    } else {
      if (kind === "grpc") {
        emits.push(`gRPC error responses to ${c.connectedNodeLabel} ("${c.contractName}"): return appropriate status codes (INVALID_ARGUMENT, NOT_FOUND, INTERNAL) with error details`);
      } else if (kind === "websocket" || kind === "sse") {
        emits.push(`Stream lifecycle errors to ${c.connectedNodeLabel} ("${c.contractName}"): close with meaningful codes/reasons and release per-connection resources on abrupt client disconnects`);
      } else if (interaction === "request_response" || interaction === "auth" || kind === "rest" || kind === "graphql") {
        emits.push(`HTTP error responses to ${c.connectedNodeLabel} ("${c.contractName}"): return proper 4xx for validation errors, 401/403 for auth failures, 5xx for internal errors with correlation IDs`);
      } else if (interaction === "event" || kind === "kafka") {
        handles.push(`Malformed events from ${c.connectedNodeLabel} ("${c.contractName}"): validate event schema, route invalid messages to DLQ, emit processing failure events`);
      } else if (interaction === "queue" || kind === "amqp") {
        emits.push(`Job failure signals to ${c.connectedNodeLabel} ("${c.contractName}"): emit failure status with error details, support idempotent retry`);
      }
    }
  }

  return { emits, handles };
}

// P0-4: the path carries a short node-id suffix and is used ONLY to seed the FIRST
// creation of a node's task doc. It is never recomputed to find an existing doc —
// lookups go through findExistingTaskArtifact (nodeId + kind), so renaming a node
// neither moves its doc nor duplicates it, and docs stored under legacy label-only
// paths keep their persisted path on update.
export function getTaskDocumentPath(nodeLabel: string, nodeId: string): string {
  const slug = nodeLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const idSuffix = nodeId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return `.nodespec/tasks/${slug}-${idSuffix}.task.md`;
}

// ── N5.17: the AI-authored "Implementation Context" section ──────────────────────
//
// The packet is a hybrid document: every derived section is generator-owned and
// regenerates freely; THIS one section belongs to the consuming AI. The inversion
// holds — NodeSpec emits the scaffold and preserves authored prose, it never writes
// the prose (no server-side LLM call, ever). The authored text is deliberately NOT
// a fingerprint input (computeTaskContextFingerprint hashes derived inputs only),
// so authoring the section can never re-stale the packet it lives in.
//
// Semantics, mirroring preserveTestStrategySection (test-document-generator.ts):
//   · stored section still carries the scaffold placeholder → not authored → the
//     fresh scaffold wins (directive wording may have improved between versions);
//   · authored prose → carried into the regenerated doc VERBATIM;
//   · flagReview (a fingerprint flip regenerated the doc around it) → a single
//     REVIEW-NEEDED line is inserted under the heading, once — never duplicated,
//     never wiped; the AI deletes it after re-verifying the section.
export const IMPLEMENTATION_CONTEXT_HEADING = "## Implementation Context";
export const IMPLEMENTATION_CONTEXT_PLACEHOLDER = "_Not yet authored._";
export const IMPLEMENTATION_CONTEXT_REVIEW_MARKER =
  "> ⚠ REVIEW NEEDED: the derived sections of this document changed after this context was authored. Re-verify this section against them, update what no longer holds, then delete this line.";

export function implementationContextScaffold(): string[] {
  return [
    IMPLEMENTATION_CONTEXT_HEADING,
    "",
    "<!-- AI-AUTHORED SECTION: NodeSpec never writes prose here. Your text survives regeneration verbatim while the derived sections around it keep refreshing. -->",
    `${IMPLEMENTATION_CONTEXT_PLACEHOLDER} **Consuming AI — author this section BEFORE building.** Working from this full packet plus the repository, record the project-specific context no catalog can know: how this node's technology composes with its neighbors in THIS project, the integration specifics behind each interface contract, configuration rationale, and your intended implementation approach. Replace this placeholder (keep the heading) either by editing this file in the repo and pushing — NodeSpec surfaces the edit as a change card for the user to accept — or via an update_artifact patch through propose_patches. If a REVIEW-NEEDED line appears here later, the derived context changed after you wrote this: re-verify the section, then delete that line.`,
    "",
  ];
}

export function preserveImplementationContextSection(
  generated: string,
  stored: string,
  opts: { flagReview?: boolean } = {},
): string {
  const storedSec = extractLevel2Section(stored, IMPLEMENTATION_CONTEXT_HEADING);
  if (!storedSec) return generated;
  const generatedSec = extractLevel2Section(generated, IMPLEMENTATION_CONTEXT_HEADING);
  // Node became taskless (deliverable 'none' emits no section): the prose has no
  // home in the regenerated doc — git history keeps it; do not resurrect a section
  // the generator no longer emits.
  if (!generatedSec) return generated;

  const storedLines = stored.split("\n").slice(storedSec.start, storedSec.end);
  const authored = !storedLines.join("\n").includes(IMPLEMENTATION_CONTEXT_PLACEHOLDER);
  if (!authored) return generated;

  const carried = [...storedLines];
  if (opts.flagReview && !storedLines.some((l) => l.trim() === IMPLEMENTATION_CONTEXT_REVIEW_MARKER)) {
    carried.splice(1, 0, "", IMPLEMENTATION_CONTEXT_REVIEW_MARKER);
  }

  const generatedLines = generated.split("\n");
  return [
    ...generatedLines.slice(0, generatedSec.start),
    ...carried,
    ...generatedLines.slice(generatedSec.end),
  ].join("\n");
}

/** Section runs from its `## ` heading to the next level-2 heading (### belongs to it). */
function extractLevel2Section(content: string, heading: string): { start: number; end: number } | null {
  const lines = content.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === heading) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

// P0-4: the ONE way to find a node's existing task document — by nodeId + kind,
// never by recomputed path (label renames used to change the recomputed path, miss
// the lookup, and create a duplicate artifact while orphaning the old one).
export function findExistingTaskArtifact<T extends { nodeId: string; kind: string }>(
  artifacts: Record<string, T>,
  nodeId: string
): T | null {
  for (const artifact of Object.values(artifacts)) {
    if (artifact.nodeId === nodeId && artifact.kind === "task") {
      return artifact;
    }
  }
  return null;
}

/**
 * Deterministic serialization at EVERY depth — `simpleHash`'s replacer array only
 * orders the top level, and config values are user-authored objects whose key order
 * is not guaranteed stable across edits. Without this, re-saving identical config
 * could churn the fingerprint (spurious staleness); with it, only real changes move.
 */
function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`).join(",")}}`;
}

/**
 * The packet's rendered configuration state, as ONE flat string.
 *
 * Owner-directed 2026-07-30 (found while fixing the AI-decides toggle): the packet
 * RENDERS configuration three ways — the "## Configuration" values block, the
 * delegation statement, or the unchosen placeholder — but the fingerprint covered
 * none of it, so a config edit never staled the packet and the C1 freshness gate
 * silently shipped an outdated task doc on the next commit.
 *
 * Content-equivalent BY CONSTRUCTION: the signature moves only when the rendered
 * text moves. A delegated node hashes as "delegated" no matter what dormant values
 * it carries (they render nowhere — see resolveConfigChoice), and "I'll specify"
 * with nothing typed yet hashes empty, exactly like unchosen, because both render
 * the same placeholder. Flat string on purpose: simpleHash's replacer array would
 * strip the inner keys of a nested object.
 */
function configSignatureFor(metadata: Record<string, unknown> | undefined): string {
  const choice = resolveConfigChoice(metadata);
  if (choice === "delegated") return "delegated";
  const values = metadata?.config as Record<string, unknown> | undefined;
  const hasValues = !!values && typeof values === "object" && Object.keys(values).length > 0;
  return choice === "user-specified" && hasValues ? `manual:${stableSerialize(values)}` : "";
}

// WS1: exported — mcp-context-assembly's schemaHash uses THE same h8 so a hash seen in
// get_project_context matches the one a fingerprint or doc surface derives from the
// same schema content. Callers hashing plain strings pass them as-is (the replacer
// array only orders top-level keys of objects).
export function simpleHash(obj: unknown): string {
  const str = JSON.stringify(obj, Object.keys(obj as object).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

export interface TaskContextFingerprint {
  fingerprint: string;
  timestamp: string;
  fields: {
    nodeRole: string;
    nodeTechnology: string | null;
    edgeSignatures: string[];
    requirementSignatures: string[];
    connectedNodeSignatures: string[];
    /** Rendered configuration state — "delegated" | `manual:{…}` | "" (unchosen). */
    configSignature: string;
    /** R6 (Discovered #9): every packet embeds the project vision, so it is
     *  packet CONTENT — without this a vision edit shipped stale packets
     *  marked fresh (the anchor's specHash moved; no packet did). */
    visionHash: string;
    /** N10(b): the generator branches on the PARENT (rent-by-placement reads its role's
     *  nature; the hosted path reads its technology) — without this, reparenting a node
     *  flipped its deliverable class without staling the packet. Graph-derived, so it is
     *  always computable. */
    parentSignature: string;
    /** N10(b) — the recorded enrichment blind spot: technology was tracked BY ID ONLY,
     *  so C1's push-time freshness gate never noticed catalog enrichment and
     *  already-pushed packets stayed thin forever. Hashes exactly the catalog content
     *  the packet renders or branches on: the node's role text+axes, its technology's
     *  ai_context/metadata_schema/suggested_files, the parent role's placement axes,
     *  and each counterparty technology's apiReference. Empty when the caller has no
     *  catalogs (legacy signature) — every generator callsite should pass them. */
    catalogSignature: string;
  };
}

/** Requirement content that participates in the fingerprint. Passing bare ids is still
 *  accepted (legacy signature `REQ-###` with no content hash) but blinds the freshness
 *  gate to requirement edits — every generator callsite should pass the full shape. */
export interface RequirementFingerprintInput {
  requirementId: string;
  name?: string;
  description?: string;
  acceptanceCriteria?: Array<{ text?: string; met?: boolean }>;
}

function requirementSignature(r: string | RequirementFingerprintInput): string {
  if (typeof r === "string") return r;
  const criteria = Array.isArray(r.acceptanceCriteria)
    ? r.acceptanceCriteria.map((c) => `${c?.met === true ? "x" : "o"}:${c?.text ?? ""}`)
    : [];
  // `met` is included on purpose: an accepted completion tick must refresh the packet so
  // the derived checkboxes re-render from truth (completion provenance, 2026-07-21).
  return `${r.requirementId}:${simpleHash(`${r.name ?? ""}|${r.description ?? ""}|${criteria.join("\n")}`)}`;
}

/** N10(b): the catalog content that actually reaches this node's packet, hashed. Scoped
 *  deliberately — whole-row hashing would re-stale packets on cosmetic column edits
 *  (icon, color, sort_order) that never render. */
function catalogContentSignature(node: GraphNode, graph: GraphData, catalogs?: CatalogData): string {
  if (!catalogs) return "";
  const roleRow = catalogs.nodeRoles[node.type];
  const techRow = node.technology ? catalogs.technologies[node.technology] : null;
  const parent = node.parentId ? graph.nodes[node.parentId] : null;
  const parentRole = parent ? catalogs.nodeRoles[parent.type] : null;

  // Counterparty surface: the packet renders each dependency's ai_context.apiReference
  // (buildApiSurface) — an endpoint added to a NEIGHBOR's catalog row changes THIS
  // node's packet.
  const deps: string[] = [];
  const seen = new Set<string>();
  for (const edge of Object.values(graph.edges)) {
    if (edge.source !== node.id && edge.target !== node.id) continue;
    const connId = edge.source === node.id ? edge.target : edge.source;
    if (seen.has(connId)) continue;
    seen.add(connId);
    const depTech = graph.nodes[connId]?.technology;
    const apiRef = depTech
      ? (catalogs.technologies[depTech]?.ai_context as Record<string, unknown> | undefined)?.apiReference
      : undefined;
    if (depTech && apiRef) deps.push(`${depTech}:${simpleHash(JSON.stringify(apiRef))}`);
  }

  return simpleHash(JSON.stringify({
    role: roleRow
      ? {
          description: roleRow.description ?? "",
          nature: roleRow.nature ?? "",
          interfaceKind: roleRow.interface_kind ?? "",
          isContainer: roleRow.is_container === true,
          containerStyle: roleRow.container_style ?? "",
        }
      : null,
    tech: techRow
      ? {
          aiContext: techRow.ai_context ?? {},
          metadataSchema: techRow.metadata_schema ?? {},
          suggestedFiles: techRow.suggested_files ?? [],
        }
      : null,
    parentRole: parentRole
      ? { nature: parentRole.nature ?? "", containerStyle: parentRole.container_style ?? "" }
      : null,
    deps: deps.sort(),
  }));
}

export function computeTaskContextFingerprint(
  node: GraphNode,
  graph: GraphData,
  requirements?: Array<string | RequirementFingerprintInput>,
  vision?: string,
  catalogs?: CatalogData,
): TaskContextFingerprint {
  const edgeSignatures: string[] = [];
  const connectedNodeSignatures: string[] = [];
  const seen = new Set<string>();

  for (const edge of Object.values(graph.edges)) {
    if (edge.source !== node.id && edge.target !== node.id) continue;

    const contract = graph.contracts[edge.contractId];
    const kind = contract?.kind || "unknown";
    const name = contract?.name || "";

    // N8.6(C): the signature covers EVERYTHING about an edge the packet renders or
    // branches on. It was `id:kind:name:schemaRefHash` — blind to the contract
    // descriptors (the packet renders Transport/Spec Format and branches on
    // interactionKind, so an inspector override changed packet content without
    // staling it), to the edge behavior fields (criticality moves the dependency
    // chain), and to INLINE contract.schema (only schemaRef artifact content was
    // hashed). Unset fields contribute empty segments, so untouched graphs get a
    // one-time stale round from the format change and are stable after.
    let schemaHash = "";
    if (contract?.schemaRef) {
      const sa = graph.artifacts[contract.schemaRef];
      if (sa?.content) schemaHash = simpleHash(sa.content);
    } else if (contract?.schema && Object.keys(contract.schema).length > 0) {
      schemaHash = simpleHash(JSON.stringify(contract.schema));
    }

    const descriptors = `${contract?.interactionKind || ""}:${contract?.transport || ""}:${contract?.specFormat || ""}`;
    const behavior = `${edge.direction || ""}:${edge.criticality || ""}`;
    edgeSignatures.push(`${edge.id}:${kind}:${name}:${descriptors}:${behavior}:${schemaHash}`);

    const connId = edge.source === node.id ? edge.target : edge.source;
    if (!seen.has(connId)) {
      seen.add(connId);
      const cn = graph.nodes[connId];
      if (cn) connectedNodeSignatures.push(`${cn.label}:${cn.type}:${cn.technology || ""}`);
    }
  }

  const requirementSignatures = (requirements || []).map(requirementSignature).sort();

  const fields = {
    nodeRole: node.type,
    nodeTechnology: node.technology ?? null,
    edgeSignatures: edgeSignatures.sort(),
    requirementSignatures,
    connectedNodeSignatures: connectedNodeSignatures.sort(),
    // Owner-directed 2026-07-30: configuration is packet CONTENT, so it belongs in
    // the freshness signature. Adding the field re-stales every existing packet
    // ONCE (the same one-time round the N8.6(C) format change took); regeneration
    // is deterministic, so untouched packets produce byte-identical content and
    // packet-freshness only rewrites `artifact.content` when it actually differs —
    // no file churn, no anchor/contentHash movement, nothing for git to commit.
    configSignature: configSignatureFor(node.metadata as Record<string, unknown> | undefined),
    // R6 (Discovered #9): same one-time re-stale round as configSignature
    // above — the field-set change moves every stored fingerprint once, the
    // content-diff guard keeps unchanged renders from rewriting files.
    visionHash: vision ? simpleHash(vision) : "",
    // N10(b): reparenting flips the rent-by-placement classification; the parent's
    // technology picks the hosting platform's guidance. Same one-time re-stale round.
    parentSignature: node.parentId
      ? `${node.parentId}:${graph.nodes[node.parentId]?.type ?? ""}:${graph.nodes[node.parentId]?.technology ?? ""}`
      : "",
    // N10(b): the enrichment blind spot closed — catalog content the packet renders.
    catalogSignature: catalogContentSignature(node, graph, catalogs),
  };

  return {
    fingerprint: simpleHash(fields),
    timestamp: new Date().toISOString(),
    fields,
  };
}

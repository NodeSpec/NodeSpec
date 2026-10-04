// AA.0 (R.2a, owner 2026-09-23): the constraints that apply to a node, read
// from the one store (`project_constraints`).
//
// A constraint applies to a node when it is project-wide (no workflow), or
// when it is scoped to a workflow the node serves. A node serves a workflow
// when a requirement mapped to it derives from an outcome homed on that
// workflow (specification_mappings → outcome_derivations →
// requirement_candidates.workflow_id). One batch of reads covers every node
// asked for, so a regeneration over the whole graph costs four queries.
//
// Classification: the row's `mark` rides along. The MCP transport removes
// what the caller is not cleared for (redactByClearance); the task document,
// which is committed to git, never writes a marked constraint and says how
// many it left out (renderConstraintsSection).
//
// R.2b (owner 2026-09-24): a constraint is guidance or a check, and holds
// for the project, one workflow, a role, a technology, a contract kind or a
// node. Scopes other than the project and a workflow are matched on the
// graph, so a caller that holds the graph passes it; without it those
// constraints reach no node (never a guess).
//
// AC (owner 2026-09-24): constraints do not exist below Indie. A project
// carries them when its owner's plan has Workflows; otherwise nothing here is
// read, so no task document, context, readiness report or check names one,
// and after a downgrade the rows stay stored and are simply not referenced.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CONSTRAINT_TYPES } from "./constraint-identity.ts";
import { getEffectiveTier } from "./deployment.ts";
// feature-rules, not workflow-gate: the app's tests import this file through
// the task-document generator, and workflow-gate reaches the zod schema.
import { featureAllowed } from "./feature-rules.ts";
import {
  asCheckSpec, batchCounts, describeCheck, describeScope, judgeBatch, nodesInScope, ruleFromRow,
  type CheckSpec, type ConstraintKind, type RuleGraph, type RuleView, type ScopeKind,
} from "./constraint-rules.ts";

export interface NodeConstraint {
  id: string;
  ctype: string;
  title: string | null;
  description: string;
  rationale: string | null;
  /** The workflow it holds for; null = the whole project. */
  workflowId: string | null;
  workflowName: string | null;
  mark: string | null;
  /** R.2b: guidance, or a check evaluated on the graph. Rows before R.2b are guidance. */
  kind?: ConstraintKind;
  scopeKind?: ScopeKind;
  scopeValue?: string | null;
  check?: CheckSpec | null;
  /** Who it holds for, in a phrase, with names from the graph when the loader had it. */
  scopeText?: string;
}

type ConstraintRow = {
  id: string; ctype: string; title: string | null; description: string; rationale: string | null;
  workflow_id: string | null; mark: string | null;
  kind?: string | null; scope_kind?: string | null; scope_value?: string | null; check_spec?: unknown;
};

const COLUMNS = "id, ctype, title, description, rationale, workflow_id, mark";
const RULE_COLUMNS = `${COLUMNS}, kind, scope_kind, scope_value, check_spec, waivers, stats, created_at`;

/** A graph as the loader receives it (any snapshot shape), read as a RuleGraph. */
export function asRuleGraph(g: unknown): RuleGraph | null {
  if (!g || typeof g !== "object") return null;
  const o = g as Record<string, unknown>;
  const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, never> : {});
  return { nodes: rec(o.nodes), edges: rec(o.edges), contracts: rec(o.contracts) };
}

const TYPE_RANK = new Map<string, number>(CONSTRAINT_TYPES.map((t, i) => [t, i]));

/** Canonical order: by type (the rail's order), then by the words. Pure. */
export function sortConstraints(list: NodeConstraint[]): NodeConstraint[] {
  return [...list].sort((a, b) =>
    (TYPE_RANK.get(a.ctype) ?? 99) - (TYPE_RANK.get(b.ctype) ?? 99)
    || (a.title ?? a.description).localeCompare(b.title ?? b.description)
    || a.id.localeCompare(b.id));
}

/** AC: does this project carry constraints? Its owner's plan decides (the
 *  licence when self-hosted). A failed read is a no: nothing is referenced.
 *  A caller that already read the owner passes it. */
export async function constraintsCarried(supabase: SupabaseClient, projectId: string, ownerId?: string | null): Promise<boolean> {
  try {
    let owner = ownerId ?? null;
    if (!owner) {
      const { data } = await supabase.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
      owner = (data as { owner_id?: string } | null)?.owner_id ?? null;
    }
    if (!owner) return false;
    return featureAllowed(await getEffectiveTier(supabase as never, owner), "workflow_space");
  } catch {
    return false;
  }
}

/** Every constraint of the project, each with its workflow's name. */
export async function loadProjectConstraints(
  supabase: SupabaseClient,
  projectId: string,
): Promise<NodeConstraint[]> {
  return (await loadConstraintsAndRules(supabase, projectId)).constraints;
}

/** One read for both shapes: the constraints a packet carries, and the same
 *  rows as rules (checks, waivers, counts) for readiness (R.2b). */
export async function loadConstraintsAndRules(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ carried: boolean; constraints: NodeConstraint[]; rules: RuleView[] }> {
  if (!(await constraintsCarried(supabase, projectId))) return { carried: false, constraints: [], rules: [] };
  let { data, error }: { data: unknown; error: { message: string } | null } = await supabase
    .from("project_constraints")
    .select(RULE_COLUMNS)
    .eq("project_id", projectId);
  // A stack without migration 20260924120000 has no rule columns: read what
  // it has, and every row is the guidance it was.
  if (error && /column .* does not exist|42703/i.test(`${error.message} ${(error as { code?: string }).code ?? ""}`)) {
    ({ data, error } = await supabase.from("project_constraints").select(COLUMNS).eq("project_id", projectId));
  }
  if (error) throw new Error(`project_constraints read failed: ${error.message}`);
  const rows = (Array.isArray(data) ? data : []) as ConstraintRow[];
  const laneIds = [...new Set(rows.map((r) => r.workflow_id).filter((v): v is string => !!v))];
  const laneNames = new Map<string, string>();
  if (laneIds.length > 0) {
    const { data: lanes } = await supabase.from("workflows").select("id, name").in("id", laneIds);
    for (const l of (Array.isArray(lanes) ? lanes : []) as Array<{ id: string; name: string }>) laneNames.set(l.id, l.name);
  }
  const rules = rows.map((r) => ruleFromRow(r as unknown as Record<string, unknown>)).filter((r) => r.kind === "guide" || r.check);
  const constraints = sortConstraints(rows.map((r) => {
    const kind: ConstraintKind = r.kind === "check" ? "check" : "guide";
    const scopeKind: ScopeKind = r.workflow_id ? "workflow"
      : (["role", "technology", "contract_kind", "node"] as const).find((k) => k === r.scope_kind) ?? "project";
    const workflowName = r.workflow_id ? laneNames.get(r.workflow_id) ?? null : null;
    const scopeValue = scopeKind === "project" || scopeKind === "workflow" ? null : r.scope_value ?? null;
    return {
      id: r.id,
      ctype: r.ctype,
      title: r.title,
      description: r.description,
      rationale: r.rationale,
      workflowId: r.workflow_id,
      workflowName,
      mark: r.mark ?? null,
      kind,
      scopeKind,
      scopeValue,
      check: kind === "check" ? asCheckSpec(r.check_spec) : null,
      // Project and workflow words are the ones the document always wrote.
      ...(scopeKind === "project" || scopeKind === "workflow" ? {} : { scopeText: describeScope({ scopeKind, scopeValue, workflowId: null }) }),
    };
  }));
  return { carried: true, constraints, rules };
}

/**
 * Node id → the constraints that apply to it. Every node asked for gets an
 * entry (an empty list when none apply), so a caller can tell "none apply"
 * from "not loaded".
 */
export async function loadNodeConstraints(
  supabase: SupabaseClient,
  projectId: string,
  nodeIds: string[],
  /** The project's constraints when the caller already read them (AA.1: readiness also counts them). */
  preloaded?: NodeConstraint[],
  /** R.2b: the graph, for role, technology, contract-kind and node scopes. */
  graph?: unknown,
): Promise<Map<string, NodeConstraint[]>> {
  if (nodeIds.length === 0) return new Map();
  let all = preloaded;
  if (!all) {
    const read = await loadConstraintsAndRules(supabase, projectId);
    // AC: below Indie no node gets an entry: nothing is rendered or hashed.
    if (!read.carried) return new Map();
    all = read.constraints;
  }
  const out = new Map<string, NodeConstraint[]>(nodeIds.map((id) => [id, []]));
  if (all.length === 0) return out;

  const rg = asRuleGraph(graph);
  const projectWide = all.filter((c) => !c.workflowId && (c.scopeKind ?? "project") === "project");
  const scoped = all.filter((c) => c.workflowId);
  const onGraph = all.filter((c) => !c.workflowId && (c.scopeKind ?? "project") !== "project");
  const lanesByNode = scoped.length > 0 ? await lanesServedByNodes(supabase, projectId, nodeIds) : new Map<string, Set<string>>();
  const reach = new Map<string, Set<string>>();
  if (rg) {
    for (const c of onGraph) reach.set(c.id, nodesInScope({ scopeKind: c.scopeKind!, scopeValue: c.scopeValue ?? null, workflowId: null }, rg));
  }
  for (const nodeId of nodeIds) {
    const lanes = lanesByNode.get(nodeId) ?? new Set<string>();
    out.set(nodeId, sortConstraints([
      ...projectWide,
      ...scoped.filter((c) => lanes.has(c.workflowId!)),
      ...onGraph.filter((c) => reach.get(c.id)?.has(nodeId)).map((c) => withGraphNames(c, rg)),
    ]));
  }
  return out;
}

/** Scope words with the graph's names for a node scope. */
function withGraphNames(c: NodeConstraint, rg: RuleGraph | null): NodeConstraint {
  if (!rg || c.scopeKind !== "node" || !c.scopeValue) return c;
  const label = (rg.nodes[c.scopeValue] as { label?: string } | undefined)?.label;
  return label ? { ...c, scopeText: describeScope({ scopeKind: "node", scopeValue: c.scopeValue, workflowId: null }, { node: () => label }) } : c;
}

/** Node id → the workflows its requirements' outcomes are homed on (R.2b: readiness and checks read it too). */
export async function workflowsServedByNodes(
  supabase: SupabaseClient,
  projectId: string,
  nodeIds: string[],
): Promise<Map<string, Set<string>>> {
  return await lanesServedByNodes(supabase, projectId, nodeIds);
}

/** Node id → the workflows its requirements' outcomes are homed on. */
async function lanesServedByNodes(
  supabase: SupabaseClient,
  projectId: string,
  nodeIds: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const { data: spec } = await supabase
    .from("project_specifications")
    .select("id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!spec) return out;
  const { data: maps } = await supabase
    .from("specification_mappings")
    .select("requirement_id, node_id")
    .eq("specification_id", (spec as { id: string }).id)
    .in("node_id", nodeIds);
  const mappings = (Array.isArray(maps) ? maps : []) as Array<{ requirement_id: string; node_id: string }>;
  const reqIds = [...new Set(mappings.map((m) => m.requirement_id))];
  if (reqIds.length === 0) return out;
  const { data: ders } = await supabase
    .from("outcome_derivations")
    .select("candidate_id, requirement_row_id")
    .in("requirement_row_id", reqIds);
  const derivations = (Array.isArray(ders) ? ders : []) as Array<{ candidate_id: string; requirement_row_id: string }>;
  const candIds = [...new Set(derivations.map((d) => d.candidate_id))];
  if (candIds.length === 0) return out;
  const { data: cands } = await supabase
    .from("requirement_candidates")
    .select("id, workflow_id")
    .in("id", candIds);
  const laneOfCandidate = new Map<string, string>();
  for (const c of (Array.isArray(cands) ? cands : []) as Array<{ id: string; workflow_id: string | null }>) {
    if (c.workflow_id) laneOfCandidate.set(c.id, c.workflow_id);
  }
  const lanesOfReq = new Map<string, Set<string>>();
  for (const d of derivations) {
    const lane = laneOfCandidate.get(d.candidate_id);
    if (!lane) continue;
    (lanesOfReq.get(d.requirement_row_id) ?? lanesOfReq.set(d.requirement_row_id, new Set()).get(d.requirement_row_id)!).add(lane);
  }
  for (const m of mappings) {
    const lanes = lanesOfReq.get(m.requirement_id);
    if (!lanes) continue;
    const set = out.get(m.node_id) ?? new Set<string>();
    for (const l of lanes) set.add(l);
    out.set(m.node_id, set);
  }
  return out;
}

/** The short id a doc and an agent cite: `c:` and the first 8 of the uuid. */
export function constraintRef(id: string): string {
  return `c:${id.replace(/-/g, "").slice(0, 8)}`;
}

export const CONSTRAINTS_HEADING = "## Constraints That Apply Here";

/**
 * The task document's block. `undefined` (a caller that did not load them)
 * renders nothing; an empty list renders the one-line note the owner ruled
 * (no constraints is a note, never a gap). Marked constraints are never
 * written into the file (it is committed to git); they are counted.
 */
export function renderConstraintsSection(constraints: NodeConstraint[] | undefined): string[] {
  if (constraints === undefined) return [];
  const lines = [CONSTRAINTS_HEADING, ""];
  const open = constraints.filter((c) => !c.mark);
  const marked = constraints.length - open.length;
  if (open.length === 0 && marked === 0) {
    lines.push("None recorded for this node. Standing conditions the build must honour (security, compliance, cost, technology and the like) can be filed with a `create_constraint` patch.");
    lines.push("");
    return lines;
  }
  lines.push("Standing conditions this node must honour. Cite one by its id when a decision depends on it.");
  lines.push("");
  for (const c of open) {
    const head = c.title ? `**[${c.ctype}] ${c.title}**` : `**[${c.ctype}]**`;
    const scope = c.scopeText
      ? `holds for ${c.scopeText}`
      : c.workflowId ? `holds for the ${c.workflowName ? `"${c.workflowName}"` : "one"} workflow` : "holds for the whole project";
    const why = c.rationale ? ` Why: ${c.rationale}` : "";
    // R.2b: a check says what it checks and what happens to a change that breaks it.
    const checked = c.kind === "check" && c.check
      ? ` Checked: ${describeCheck(c.check)} ${c.check.severity === "refuse" ? "A proposal that breaks it is refused." : "A proposal that breaks it is filed with a warning."}`
      : "";
    lines.push(`- ${head} (${constraintRef(c.id)}): ${c.description}${why}${checked} (${scope})`);
  }
  if (marked > 0) {
    lines.push(`- ${marked} more constraint${marked === 1 ? " carries" : "s carry"} a classification mark and ${marked === 1 ? "is" : "are"} not written into this file. Read ${marked === 1 ? "it" : "them"} with get_project_context on this node.`);
  }
  lines.push("");
  return lines;
}

/** What the packet fingerprint hashes, so a constraint edit re-stales the packets it reaches. Pure. */
export function constraintsSignature(constraints: NodeConstraint[] | undefined): string {
  if (!constraints || constraints.length === 0) return "";
  return sortConstraints(constraints)
    .map((c) => {
      const base = [c.id, c.ctype, c.title ?? "", c.description, c.rationale ?? "", c.workflowId ?? "", c.workflowName ?? "", c.mark ?? ""];
      // R.2b: the rule fields count only where they say something, so a
      // packet written before R.2b keeps its fingerprint.
      const ruled = c.kind === "check" || (c.scopeKind && c.scopeKind !== "project" && c.scopeKind !== "workflow");
      return (ruled ? [...base, c.kind ?? "guide", c.scopeKind ?? "", c.scopeValue ?? "", c.check ? JSON.stringify(c.check) : ""] : base).join("\u0001");
    })
    .join("\u0002");
}

// ── R.2b: checks, held against a proposal ──────────────────────────────────

/** The project's constraints as rules, with their waivers and counts (checks
 *  only, unless asked). A stack without migration 20260924120000 has none. */
export async function loadRules(supabase: SupabaseClient, projectId: string, opts: { checksOnly?: boolean } = {}): Promise<RuleView[]> {
  if (!(await constraintsCarried(supabase, projectId))) return [];
  let q = supabase
    .from("project_constraints")
    .select("id, kind, scope_kind, scope_value, workflow_id, check_spec, waivers, stats, title, description, created_at, mark")
    .eq("project_id", projectId);
  if (opts.checksOnly) q = q.eq("kind", "check");
  const { data, error } = await q;
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map(ruleFromRow).filter((r) => r.kind === "guide" || r.check);
}

export async function loadChecks(supabase: SupabaseClient, projectId: string): Promise<RuleView[]> {
  return await loadRules(supabase, projectId, { checksOnly: true });
}

/** Add use counts; best-effort (a count never fails the call it rides). */
export async function countConstraintUse(
  supabase: SupabaseClient,
  projectId: string,
  counts: Record<string, { fired?: number; violated?: number; waived?: number }>,
): Promise<void> {
  if (Object.keys(counts).length === 0) return;
  try { await supabase.rpc("constraints_count", { p_project: projectId, p_counts: counts }); } catch { /* counts are advisory */ }
}

export interface ProposalJudgement {
  /** Set when a refusing check is broken by the batch: nothing is filed. */
  refusal: string | null;
  /** One line per warning check the batch breaks; the proposal files with them. */
  warnings: string[];
  findings: Array<{ constraintId: string; severity: "warn" | "refuse"; target: string; message: string }>;
}

/**
 * R.2b: hold a batch against the project's checks. Only what the batch
 * introduces counts, never debt it did not add; a waiver filed in the same
 * batch (update_constraint addWaiver) is honoured, since the person decides
 * both together. Counts fired, violated and waived. Null when the project
 * has no check.
 */
export async function judgeProposal(
  supabase: SupabaseClient,
  projectId: string,
  branchId: string,
  patches: ReadonlyArray<{ type?: unknown; payload?: unknown }>,
): Promise<ProposalJudgement | null> {
  const checks = await loadChecks(supabase, projectId);
  if (checks.length === 0) return null;
  const { data: snap } = await supabase
    .from("graph_snapshots")
    .select("graph_data")
    .eq("branch_id", branchId)
    .order("patch_sequence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const before = asRuleGraph((snap as { graph_data?: unknown } | null)?.graph_data) ?? { nodes: {}, edges: {}, contracts: {} };
  const lanes = checks.some((c) => c.scopeKind === "workflow")
    ? await lanesServedByNodes(supabase, projectId, [...new Set([...Object.keys(before.nodes), ...patches.map((p) => String((p.payload as { id?: unknown } | undefined)?.id ?? ""))].filter(Boolean))])
    : undefined;
  const j = judgeBatch(checks, before, patches, lanes);
  await countConstraintUse(supabase, projectId, batchCounts(j));
  const byId = new Map(checks.map((c) => [c.id, c]));
  const name = (id: string) => {
    const c = byId.get(id);
    return `${constraintRef(id)}${c?.title ? ` "${c.title}"` : ""}`;
  };
  const findings = [...j.refused, ...j.warned].map((v) => ({ constraintId: v.constraintId, severity: v.severity, target: v.target.id, message: v.message }));
  const refusal = j.refused.length === 0 ? null
    : `This batch breaks ${j.refused.length === 1 ? "a check" : `${j.refused.length} checks`} the project refuses changes against: ` +
      j.refused.map((v) => `${name(v.constraintId)}: ${v.message} (target ${v.target.id})`).join(" ") +
      " Nothing was filed. Change the batch, or, if the break is intended, add update_constraint { constraintId, addWaiver: { target, reason } } to the same batch; the person accepts the waiver with the rest.";
  const warnings = j.warned.map((v) => `Breaks ${name(v.constraintId)}: ${v.message} The proposal files; the reviewer sees it.`);
  return { refusal, warnings, findings };
}

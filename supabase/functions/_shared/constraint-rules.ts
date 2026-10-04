// R.2b and R.2c (owner 2026-09-24): a constraint is guidance or a check, it
// holds for a scope, and it learns from use.
//
// The owner's condition: "okay as long as the rules are quality and
// contextual to the user's project (i.e. uses the user's AI over MCP or it's
// deterministically done but without generalized guidance)." So:
//   - NodeSpec ships no rule. Every constraint is written by the person, or
//     drafted by their own agent over MCP and approved by the person.
//   - A check is a closed, deterministic predicate. The predicate has no
//     default instance: its scope and its parameters (which roles, which
//     technologies, how many calls) are the project's own.
//   - The server never words a rule. What it notices (a check waived again
//     and again, a constraint nothing has touched in 90 days, a gap that
//     recurs across this project's nodes) goes to the agent as evidence from
//     this project; the agent drafts, the person decides.
//
// Pure and import-free, so the app renders the same words the server
// evaluates (the app imports this file directly, as it does
// constraint-identity.ts).

export const CONSTRAINT_KINDS = ["guide", "check"] as const;
export type ConstraintKind = typeof CONSTRAINT_KINDS[number];

/** What a constraint holds for. `workflow` rides workflow_id (Indie and above). */
export const SCOPE_KINDS = ["project", "workflow", "role", "technology", "contract_kind", "node"] as const;
export type ScopeKind = typeof SCOPE_KINDS[number];

/** The closed check vocabulary. Each is evaluated on the graph alone. */
export const CHECK_PREDICATES = ["contract_has_schema", "no_calls_between_roles", "technology_in_list", "sync_calls_at_most"] as const;
export type CheckPredicate = typeof CHECK_PREDICATES[number];

export const CHECK_SEVERITIES = ["warn", "refuse"] as const;
export type CheckSeverity = typeof CHECK_SEVERITIES[number];

export type CheckSpec =
  | { predicate: "contract_has_schema"; severity: CheckSeverity; params?: Record<string, never> }
  | { predicate: "no_calls_between_roles"; severity: CheckSeverity; params: { from: string; to: string } }
  | { predicate: "technology_in_list"; severity: CheckSeverity; params: { technologies: string[] } }
  | { predicate: "sync_calls_at_most"; severity: CheckSeverity; params: { max: number } };

export interface Waiver {
  id: string;
  /** The node or edge the check does not hold against. */
  target: string;
  reason: string;
  /** Who accepted it: the person who approved the waiver. */
  owner: string | null;
  /** ISO time; absent, it holds until removed. */
  expiresAt?: string | null;
  at: string;
}

export interface ConstraintStats {
  fired?: number;
  violated?: number;
  waived?: number;
  lastFiredAt?: string | null;
}

/** Where a constraint came from in this project (R.2c). */
export interface ConstraintOrigin {
  source: "person" | "agent" | "review" | "recurring_gap" | "implementation_context";
  /** The rejected proposal whose note it states. */
  proposalId?: string;
  /** The readiness gap it answers. */
  gap?: string;
  /** The nodes the evidence came from. */
  nodeIds?: string[];
}

/** The rule fields a reader needs; camelCase over the row. */
export interface RuleView {
  id: string;
  kind: ConstraintKind;
  scopeKind: ScopeKind;
  scopeValue: string | null;
  workflowId: string | null;
  check: CheckSpec | null;
  waivers: Waiver[];
  stats: ConstraintStats;
  title: string | null;
  description: string;
  createdAt?: string | null;
  /** 7.3: a marked constraint's words are shown to cleared viewers only. */
  mark?: string | null;
}

// ── the graph the checks read (structural, both runtimes) ───────────────────

export interface RuleNode { id: string; type: string; label?: string; technology?: string | null; parentId?: string | null }
export interface RuleEdge { id: string; source: string; target: string; contractId?: string | null; label?: string | null }
export interface RuleContract { id: string; kind?: string | null; interactionKind?: string | null; name?: string | null; schema?: unknown; schemaRef?: string | null }
export interface RuleGraph {
  nodes: Record<string, RuleNode>;
  edges: Record<string, RuleEdge>;
  contracts: Record<string, RuleContract>;
}

/** Row → view. Tolerant of rows written before R.2b (every new column has a default). */
export function ruleFromRow(row: Record<string, unknown>): RuleView {
  const kind = row.kind === "check" ? "check" : "guide";
  const scopeKind = (SCOPE_KINDS as readonly string[]).includes(String(row.scope_kind))
    ? row.scope_kind as ScopeKind
    : row.workflow_id ? "workflow" : "project";
  return {
    id: String(row.id),
    kind,
    scopeKind,
    scopeValue: typeof row.scope_value === "string" ? row.scope_value : null,
    workflowId: typeof row.workflow_id === "string" ? row.workflow_id : null,
    check: kind === "check" ? asCheckSpec(row.check_spec) : null,
    waivers: Array.isArray(row.waivers) ? (row.waivers as Waiver[]).filter((w) => w && typeof w.target === "string") : [],
    stats: row.stats && typeof row.stats === "object" ? row.stats as ConstraintStats : {},
    title: typeof row.title === "string" ? row.title : null,
    description: String(row.description ?? ""),
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    mark: typeof row.mark === "string" ? row.mark : null,
  };
}

export function asCheckSpec(v: unknown): CheckSpec | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const severity: CheckSeverity = o.severity === "refuse" ? "refuse" : "warn";
  const p = (o.params ?? {}) as Record<string, unknown>;
  switch (o.predicate) {
    case "contract_has_schema": return { predicate: "contract_has_schema", severity };
    case "no_calls_between_roles":
      return typeof p.from === "string" && typeof p.to === "string" && p.from && p.to
        ? { predicate: "no_calls_between_roles", severity, params: { from: p.from, to: p.to } } : null;
    case "technology_in_list": {
      const list = Array.isArray(p.technologies) ? p.technologies.filter((t): t is string => typeof t === "string" && !!t) : [];
      return list.length > 0 ? { predicate: "technology_in_list", severity, params: { technologies: list } } : null;
    }
    case "sync_calls_at_most":
      return typeof p.max === "number" && Number.isInteger(p.max) && p.max >= 0
        ? { predicate: "sync_calls_at_most", severity, params: { max: p.max } } : null;
    default: return null;
  }
}

// ── words (the app, the task document and the agent read the same) ─────────

export interface RuleLabels {
  role?: (id: string) => string;
  technology?: (id: string) => string;
  node?: (id: string) => string;
  workflow?: (id: string) => string;
}

const said = (f: ((id: string) => string) | undefined, id: string) => (f ? f(id) : id);

/** What a check asks, in a sentence. */
export function describeCheck(check: CheckSpec, labels: RuleLabels = {}): string {
  switch (check.predicate) {
    case "contract_has_schema": return "Every connection carries a contract with a schema.";
    case "no_calls_between_roles": return `No ${said(labels.role, check.params.from)} connects to a ${said(labels.role, check.params.to)} directly.`;
    case "technology_in_list": return `Built only with ${check.params.technologies.map((t) => said(labels.technology, t)).join(", ")}.`;
    case "sync_calls_at_most": return `At most ${check.params.max} synchronous call${check.params.max === 1 ? "" : "s"} out of each node.`;
  }
}

/** Who it holds for, in a phrase. */
export function describeScope(rule: Pick<RuleView, "scopeKind" | "scopeValue" | "workflowId">, labels: RuleLabels = {}): string {
  switch (rule.scopeKind) {
    case "project": return "the whole project";
    case "workflow": return rule.workflowId ? `the "${said(labels.workflow, rule.workflowId)}" workflow` : "one workflow";
    case "role": return `every ${said(labels.role, rule.scopeValue ?? "")} node`;
    case "technology": return `every node built with ${said(labels.technology, rule.scopeValue ?? "")}`;
    case "contract_kind": return `every ${rule.scopeValue ?? ""} connection`;
    case "node": return `${said(labels.node, rule.scopeValue ?? "")} and what it holds`;
  }
}

// ── scope ────────────────────────────────────────────────────────────────────

/** A part stands for its node: its role is the node's. */
function effectiveRole(graph: RuleGraph, node: RuleNode): string {
  if (node.type.startsWith("part-") && node.parentId && graph.nodes[node.parentId]) return graph.nodes[node.parentId].type;
  return node.type;
}

function descendantsOf(graph: RuleGraph, rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of Object.values(graph.nodes)) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) { out.add(n.id); grew = true; }
    }
  }
  return out;
}

/**
 * The nodes a constraint holds for. `lanesByNode` (node id → workflows it
 * serves) is needed only for workflow scope; without it a workflow-scoped
 * constraint reaches nothing. A contract-kind scope reaches the nodes at
 * either end of a connection of that kind.
 */
export function nodesInScope(
  rule: Pick<RuleView, "scopeKind" | "scopeValue" | "workflowId">,
  graph: RuleGraph,
  lanesByNode?: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const all = Object.values(graph.nodes);
  switch (rule.scopeKind) {
    case "project": return new Set(all.map((n) => n.id));
    case "workflow": return new Set(all.filter((n) => !!rule.workflowId && lanesByNode?.get(n.id)?.has(rule.workflowId)).map((n) => n.id));
    case "role": return new Set(all.filter((n) => effectiveRole(graph, n) === rule.scopeValue).map((n) => n.id));
    case "technology": return new Set(all.filter((n) => !!rule.scopeValue && n.technology === rule.scopeValue).map((n) => n.id));
    case "node": return rule.scopeValue && graph.nodes[rule.scopeValue] ? descendantsOf(graph, rule.scopeValue) : new Set();
    case "contract_kind": {
      const out = new Set<string>();
      for (const e of edgesOfKind(graph, rule.scopeValue)) { out.add(e.source); out.add(e.target); }
      return out;
    }
  }
}

function edgesOfKind(graph: RuleGraph, kind: string | null): RuleEdge[] {
  if (!kind) return [];
  return Object.values(graph.edges).filter((e) => e.contractId && graph.contracts[e.contractId]?.kind === kind);
}

/** The connections a check reads: of the kind, or touching a node in scope. */
function edgesInScope(rule: Pick<RuleView, "scopeKind" | "scopeValue" | "workflowId">, graph: RuleGraph, inScope: Set<string>): RuleEdge[] {
  if (rule.scopeKind === "contract_kind") return edgesOfKind(graph, rule.scopeValue);
  if (rule.scopeKind === "project") return Object.values(graph.edges);
  return Object.values(graph.edges).filter((e) => inScope.has(e.source) || inScope.has(e.target));
}

// ── evaluation ───────────────────────────────────────────────────────────────

export interface Violation {
  constraintId: string;
  predicate: CheckPredicate;
  severity: CheckSeverity;
  target: { kind: "node" | "edge"; id: string };
  /** The nodes it touches, for readiness per node. */
  nodeIds: string[];
  message: string;
}

const SYNC_KINDS = new Set(["rest", "graphql", "grpc", "custom"]);

function isSync(c: RuleContract | undefined): boolean {
  if (!c) return false;
  if (c.interactionKind) return c.interactionKind === "request_response";
  return !!c.kind && SYNC_KINDS.has(c.kind);
}

function hasSchema(c: RuleContract): boolean {
  if (typeof c.schemaRef === "string" && c.schemaRef) return true;
  if (typeof c.schema === "string") return c.schema.trim().length > 0;
  return !!c.schema && typeof c.schema === "object" && Object.keys(c.schema as object).length > 0;
}

const nameOf = (graph: RuleGraph, id: string) => graph.nodes[id]?.label ?? id;

/** One check against the graph. Pure. */
export function evaluateCheck(
  rule: RuleView,
  graph: RuleGraph,
  lanesByNode?: ReadonlyMap<string, ReadonlySet<string>>,
): Violation[] {
  const check = rule.check;
  if (rule.kind !== "check" || !check) return [];
  const inScope = nodesInScope(rule, graph, lanesByNode);
  const out: Violation[] = [];
  const hit = (target: Violation["target"], nodeIds: string[], message: string) =>
    out.push({ constraintId: rule.id, predicate: check.predicate, severity: check.severity, target, nodeIds, message });

  switch (check.predicate) {
    case "contract_has_schema":
      for (const e of edgesInScope(rule, graph, inScope)) {
        const c = e.contractId ? graph.contracts[e.contractId] : undefined;
        if (c?.kind === "dependency") continue; // an import between parts has no wire format
        if (!c || !hasSchema(c)) {
          hit({ kind: "edge", id: e.id }, [e.source, e.target],
            `${nameOf(graph, e.source)} to ${nameOf(graph, e.target)}${c?.name ? ` (${c.name})` : ""} has no contract schema.`);
        }
      }
      break;
    case "no_calls_between_roles":
      for (const e of edgesInScope(rule, graph, inScope)) {
        const s = graph.nodes[e.source], t = graph.nodes[e.target];
        if (!s || !t) continue;
        if (effectiveRole(graph, s) === check.params.from && effectiveRole(graph, t) === check.params.to) {
          hit({ kind: "edge", id: e.id }, [e.source, e.target], `${nameOf(graph, e.source)} connects to ${nameOf(graph, e.target)} directly.`);
        }
      }
      break;
    case "technology_in_list": {
      const allowed = new Set(check.params.technologies);
      for (const id of inScope) {
        const n = graph.nodes[id];
        if (n?.technology && !allowed.has(n.technology)) hit({ kind: "node", id }, [id], `${nameOf(graph, id)} is built with ${n.technology}.`);
      }
      break;
    }
    case "sync_calls_at_most":
      for (const id of inScope) {
        const n = graph.nodes[id];
        if (!n || n.type.startsWith("part-")) continue; // a part's calls count on its node
        const own = descendantsOf(graph, id);
        const targets = new Set<string>();
        for (const e of Object.values(graph.edges)) {
          if (own.has(e.source) && !own.has(e.target) && isSync(e.contractId ? graph.contracts[e.contractId] : undefined)) targets.add(e.target);
        }
        if (targets.size > check.params.max) hit({ kind: "node", id }, [id], `${nameOf(graph, id)} makes ${targets.size} synchronous calls (at most ${check.params.max}).`);
      }
      break;
  }
  return out;
}

export function waiverHolds(w: Waiver, now: Date): boolean {
  return !w.expiresAt || new Date(w.expiresAt).getTime() > now.getTime();
}

/** Every check against the graph, split into what stands and what a waiver covers. */
export function evaluateChecks(
  rules: RuleView[],
  graph: RuleGraph,
  lanesByNode?: ReadonlyMap<string, ReadonlySet<string>>,
  now: Date = new Date(),
): { violations: Violation[]; waived: Violation[] } {
  const violations: Violation[] = [];
  const waived: Violation[] = [];
  for (const rule of rules) {
    const held = new Set(rule.waivers.filter((w) => waiverHolds(w, now)).map((w) => w.target));
    for (const v of evaluateCheck(rule, graph, lanesByNode)) (held.has(v.target.id) ? waived : violations).push(v);
  }
  return { violations, waived };
}

const keyOf = (v: Violation) => `${v.constraintId}\u0001${v.target.kind}\u0001${v.target.id}`;

/** What a change introduces: in `after`, not in `before`. A proposal answers for these only, never for debt it did not add. */
export function introduced(before: Violation[], after: Violation[]): Violation[] {
  const had = new Set(before.map(keyOf));
  return after.filter((v) => !had.has(keyOf(v)));
}

/**
 * The graph a batch of patches would leave: nodes, edges and contracts only,
 * the parts a check reads. Removing a node removes its connections. Spec ops
 * and everything else pass through untouched. Pure; the input is not mutated.
 */
export function projectPatches(graph: RuleGraph, patches: ReadonlyArray<{ type?: unknown; payload?: unknown }>): RuleGraph {
  const g: RuleGraph = { nodes: { ...graph.nodes }, edges: { ...graph.edges }, contracts: { ...graph.contracts } };
  for (const patch of patches) {
    const p = (patch.payload ?? {}) as Record<string, unknown>;
    const id = typeof p.id === "string" ? p.id : null;
    const changes = (p.changes ?? {}) as Record<string, unknown>;
    switch (patch.type) {
      case "add_node": if (id) g.nodes[id] = p as unknown as RuleNode; break;
      case "update_node": if (id && g.nodes[id]) g.nodes[id] = { ...g.nodes[id], ...changes, id } as RuleNode; break;
      case "remove_node": case "delete_node":
        if (id) {
          delete g.nodes[id];
          for (const [eid, e] of Object.entries(g.edges)) if (e.source === id || e.target === id) delete g.edges[eid];
        }
        break;
      case "add_edge": if (id) g.edges[id] = p as unknown as RuleEdge; break;
      case "update_edge": if (id && g.edges[id]) g.edges[id] = { ...g.edges[id], ...changes, id } as RuleEdge; break;
      case "remove_edge": case "delete_edge": if (id) delete g.edges[id]; break;
      case "add_contract": if (id) g.contracts[id] = p as unknown as RuleContract; break;
      case "update_contract": if (id && g.contracts[id]) g.contracts[id] = { ...g.contracts[id], ...changes, id } as RuleContract; break;
      case "remove_contract": case "delete_contract": if (id) delete g.contracts[id]; break;
    }
  }
  return g;
}

/**
 * R.2b: what a batch does to the project's checks. `rules` are the checks as
 * stored; waivers filed in the same batch (update_constraint addWaiver) count
 * as the person would accept them, since they are decided together.
 * Returns only what the batch introduces, split by severity.
 */
export function judgeBatch(
  rules: RuleView[],
  before: RuleGraph,
  patches: ReadonlyArray<{ type?: unknown; payload?: unknown }>,
  lanesByNode?: ReadonlyMap<string, ReadonlySet<string>>,
  now: Date = new Date(),
): { refused: Violation[]; warned: Violation[]; waived: Violation[]; touched: string[] } {
  const checks = rules.filter((r) => r.kind === "check" && r.check);
  if (checks.length === 0) return { refused: [], warned: [], waived: [], touched: [] };
  const pending = new Map<string, Waiver[]>();
  for (const patch of patches) {
    if (patch.type !== "update_constraint") continue;
    const p = (patch.payload ?? {}) as { constraintId?: string; addWaiver?: { target?: string; reason?: string; expiresAt?: string } };
    if (!p.constraintId || !p.addWaiver?.target) continue;
    const list = pending.get(p.constraintId) ?? [];
    list.push({ id: "pending", target: p.addWaiver.target, reason: p.addWaiver.reason ?? "", owner: null, expiresAt: p.addWaiver.expiresAt ?? null, at: now.toISOString() });
    pending.set(p.constraintId, list);
  }
  const withPending = checks.map((r) => pending.has(r.id) ? { ...r, waivers: [...r.waivers, ...pending.get(r.id)!] } : r);
  const after = projectPatches(before, patches);
  const was = evaluateChecks(checks, before, lanesByNode, now);
  const now_ = evaluateChecks(withPending, after, lanesByNode, now);
  const fresh = introduced([...was.violations, ...was.waived], now_.violations);
  const freshWaived = introduced([...was.violations, ...was.waived], now_.waived);
  // A check "fires" on a batch that changes something in its reach.
  const changed = new Set<string>();
  for (const patch of patches) {
    const p = (patch.payload ?? {}) as Record<string, unknown>;
    for (const k of ["id", "source", "target"]) if (typeof p[k] === "string") changed.add(p[k] as string);
    const c = (p.changes ?? {}) as Record<string, unknown>;
    for (const k of ["source", "target"]) if (typeof c[k] === "string") changed.add(c[k] as string);
  }
  const touched = withPending.filter((r) => {
    const reach = nodesInScope(r, after, lanesByNode);
    for (const id of changed) {
      if (reach.has(id)) return true;
      const e = after.edges[id] ?? before.edges[id];
      if (e && (reach.has(e.source) || reach.has(e.target))) return true;
      if (after.contracts[id] || before.contracts[id]) {
        if (Object.values(after.edges).some((x) => x.contractId === id && (reach.has(x.source) || reach.has(x.target)))) return true;
      }
    }
    return false;
  }).map((r) => r.id);
  return {
    refused: fresh.filter((v) => v.severity === "refuse"),
    warned: fresh.filter((v) => v.severity === "warn"),
    waived: freshWaived,
    touched,
  };
}

/** Counts for constraints_count(): fired per touched check, violated and waived per new finding. */
export function batchCounts(j: { refused: Violation[]; warned: Violation[]; waived: Violation[]; touched: string[] }): Record<string, { fired: number; violated: number; waived: number }> {
  const out: Record<string, { fired: number; violated: number; waived: number }> = {};
  const at = (id: string) => (out[id] ??= { fired: 0, violated: 0, waived: 0 });
  for (const id of j.touched) at(id).fired = 1;
  for (const v of [...j.refused, ...j.warned]) at(v.constraintId).violated++;
  for (const v of j.waived) at(v.constraintId).waived++;
  return out;
}

// ── R.2c: what use says about a constraint ──────────────────────────────────

export const OFTEN_WAIVED_AT = 3;
export const QUIET_DAYS = 90;

export interface RuleSignal {
  constraintId: string;
  signal: "often_waived" | "quiet";
  /** Evidence from this project, never advice. */
  detail: string;
}

/** A check waived again and again (relax it?), a constraint nothing has used in 90 days (retire it?). */
export function ruleSignals(rules: RuleView[], now: Date = new Date()): RuleSignal[] {
  const out: RuleSignal[] = [];
  for (const r of rules) {
    const waived = Math.max(r.stats.waived ?? 0, r.waivers.filter((w) => waiverHolds(w, now)).length);
    if (r.kind === "check" && waived >= OFTEN_WAIVED_AT) {
      out.push({ constraintId: r.id, signal: "often_waived", detail: `Waived ${waived} times.` });
    }
    const last = r.stats.lastFiredAt ?? r.createdAt ?? null;
    if (last && now.getTime() - new Date(last).getTime() > QUIET_DAYS * 86_400_000) {
      out.push({ constraintId: r.id, signal: "quiet", detail: r.stats.lastFiredAt ? `Last used ${r.stats.lastFiredAt.slice(0, 10)}.` : `Not used since it was filed on ${last.slice(0, 10)}.` });
    }
  }
  return out;
}

/**
 * R.2c: a learning written in more than one node's Implementation Context.
 * Lines are compared after trimming list marks, case and spacing; a line
 * shorter than 24 characters is too thin to be a rule. The project's own
 * words are returned (the first node's spelling), never a paraphrase.
 */
export function repeatedLearnings(
  entries: ReadonlyArray<{ nodeId: string; text: string }>,
  minNodes = 2,
  limit = 5,
): Array<{ text: string; nodeIds: string[] }> {
  const byLine = new Map<string, { text: string; nodeIds: Set<string> }>();
  for (const { nodeId, text } of entries) {
    for (const raw of text.split("\n")) {
      const line = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
      if (line.length < 24) continue;
      const key = line.toLowerCase().replace(/[`*_]/g, "").replace(/[.;:,!]+$/, "").replace(/\s+/g, " ");
      const hit = byLine.get(key) ?? { text: line, nodeIds: new Set<string>() };
      hit.nodeIds.add(nodeId);
      byLine.set(key, hit);
    }
  }
  return [...byLine.values()]
    .filter((h) => h.nodeIds.size >= minNodes)
    .sort((a, b) => b.nodeIds.size - a.nodeIds.size || a.text.localeCompare(b.text))
    .slice(0, limit)
    .map((h) => ({ text: h.text, nodeIds: [...h.nodeIds].sort() }));
}

/** R.2c: the same readiness gap on this many nodes is worth asking about. */
export const RECURRING_GAP_AT = 3;

/** What the agent is asked to do with each signal. Procedure only: the rule's
 *  words come from the user, drafted by their agent. */
export const SIGNAL_ASKS = {
  often_waived: "Ask the user whether this check still holds as written. If not, propose update_constraint with the check they now want, or delete_constraint with their reason, citing these waivers.",
  quiet: "Ask the user whether it still applies. If not, propose delete_constraint with their reason.",
  recurring_gap: "Ask the user whether every connection in this project should carry a schema. If so, propose create_constraint { kind: 'check', check: { predicate: 'contract_has_schema', severity }, origin: { source: 'recurring_gap', gap, nodeIds } } in their words.",
  repeated_learning: "Ask the user whether this holds beyond these nodes. If so, propose create_constraint (guidance) in their words with origin { source: 'implementation_context', nodeIds }.",
  review: "The reviewer said why. If the note states something that should hold for this project beyond this proposal, ask the user and propose create_constraint in their words with origin { source: 'review', proposalId }; otherwise revise the proposal.",
} as const;

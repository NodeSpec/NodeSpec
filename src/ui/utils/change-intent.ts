// AA.2: an import starts from intent. The APP mirror of
// supabase/functions/_shared/change-intent.ts: the section from the first
// export on is byte-identical to the Deno file and cross-pinned in
// aa2-change-intent.test.ts, so the template the app writes and the one the
// agent proposes are the same, and the canvas draws the scope the server
// counts.

export type ChangeIntent = "migrate" | "harden" | "component" | "extend";
export type ImportIntent = ChangeIntent | "describe";

/** The baseline step every change starts with. */
export const BASELINE_STEP = "What works today";

export interface IntentChoice {
  intent: ImportIntent;
  label: string;
  /** One line under the choice: what happens next. */
  detail: string;
  /** The change workflow's steps, in order; none for describe. */
  steps: string[];
}

export const IMPORT_INTENTS: readonly IntentChoice[] = [
  {
    intent: "migrate",
    label: "Migrate it",
    detail: "Move the system somewhere else and keep what works today working.",
    steps: [BASELINE_STEP, "Stand up the target", "Move", "Cut over", "Retire"],
  },
  {
    intent: "harden",
    label: "Harden it",
    detail: "Hold the system to rules it does not meet yet: security, cost, reliability.",
    steps: [BASELINE_STEP, "Change", "Verify"],
  },
  {
    intent: "component",
    label: "Change a component",
    detail: "Rework one part of the system and prove the rest still works.",
    steps: [BASELINE_STEP, "Change", "Verify"],
  },
  {
    intent: "extend",
    label: "Extend it",
    detail: "Add something new to the system without breaking what is there.",
    steps: [BASELINE_STEP, "Build", "Verify"],
  },
  {
    intent: "describe",
    label: "Describe the whole system",
    detail: "Draft the journeys the system serves from the repository, and backfill requirements across it.",
    steps: [],
  },
];

export const CHANGE_INTENTS: readonly ChangeIntent[] = ["migrate", "harden", "component", "extend"];

export function isChangeIntent(x: unknown): x is ChangeIntent {
  return typeof x === "string" && (CHANGE_INTENTS as readonly string[]).includes(x);
}

/** The template steps for an intent; empty for describe or an unknown word. */
export function changeSteps(intent: string): string[] {
  return [...(IMPORT_INTENTS.find((c) => c.intent === intent)?.steps ?? [])];
}

export interface ScopeInput {
  /** Outcomes: their home lane and the steps they are filed on. */
  outcomes: Array<{ id: string; workflowId: string | null; stepIds?: string[] }>;
  steps: Array<{ id: string; workflowId: string }>;
  /** outcome → requirement ROW uuid. */
  derivations: Array<{ candidateId: string; requirementRowId: string }>;
  /** requirement ROW uuid → node id. */
  mappings: Array<{ requirementRowId: string; nodeId: string }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

export interface ChangeScope {
  /** The change's outcomes: homed in it or filed on one of its steps. */
  outcomeIds: string[];
  requirementRowIds: string[];
  /** In scope: the nodes those requirements map to. */
  nodeIds: string[];
  /** Edges with one end in scope and one outside: the boundary. */
  crossingEdgeIds: string[];
  /** Edges with both ends in scope. */
  innerEdgeIds: string[];
}

/** The change's scope, derived from its outcomes. Order is stable (sorted). */
export function changeScope(input: ScopeInput, workflowId: string): ChangeScope {
  const ownSteps = new Set(input.steps.filter((s) => s.workflowId === workflowId).map((s) => s.id));
  const outcomeIds = input.outcomes
    .filter((o) => o.workflowId === workflowId || (o.stepIds ?? []).some((id) => ownSteps.has(id)))
    .map((o) => o.id);
  const outcomes = new Set(outcomeIds);
  const rows = new Set(input.derivations.filter((d) => outcomes.has(d.candidateId)).map((d) => d.requirementRowId));
  const nodes = new Set(input.mappings.filter((m) => rows.has(m.requirementRowId)).map((m) => m.nodeId));
  const crossing: string[] = [];
  const inner: string[] = [];
  for (const e of input.edges) {
    const a = nodes.has(e.source);
    const b = nodes.has(e.target);
    if (a && b) inner.push(e.id);
    else if (a || b) crossing.push(e.id);
  }
  return {
    outcomeIds: [...outcomes].sort(),
    requirementRowIds: [...rows].sort(),
    nodeIds: [...nodes].sort(),
    crossingEdgeIds: crossing.sort(),
    innerEdgeIds: inner.sort(),
  };
}

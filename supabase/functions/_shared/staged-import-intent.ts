// AL.21 (owner 2026-10-03): "Is this actually triggering anything for the
// user's agent?" It was not. As the person accepts an import the app asks
// what they are here to do and records the answer in
// projects.metadata.importIntent (a change also gets its workflow). Only
// get_import_context read it, and nothing sent the agent there, so the agent
// heard of the answer only if the person repeated it.
//
// MCP cannot call the agent, so the answer waits where the agent already
// looks, as AE.6's explode requests do: the status read leads with it until
// the agent has acted on it (outcomes filed for it, or a waiting proposal
// that files them), and the app gives the person a one-line prompt that
// sends their agent to the status read. No table, no column, no tool.

import { IMPORT_INTENTS, isChangeIntent, type ImportIntent } from "./change-intent.ts";

export interface StagedImportIntent {
  intent: ImportIntent;
  /** The change's workflow; null for describe. */
  workflowId: string | null;
  at: string | null;
}

export interface ImportIntentState {
  intent: ImportIntent;
  label: string;
  /** The change's name as it is now; null for describe. */
  change: string | null;
  workflowId: string | null;
  at: string | null;
  /** Outcomes filed for it: on the change, or since the answer for describe. */
  outcomes: number;
  /** The waiting proposal that files them, when there is one. */
  proposalId: string | null;
  /** The agent has acted on the answer. */
  started: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The answer the app recorded, tolerating anything else in the key. A change without its workflow is not an answer. */
export function readImportIntent(metadata: Record<string, unknown> | null | undefined): StagedImportIntent | null {
  const raw = metadata?.importIntent;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const choice = IMPORT_INTENTS.find((c) => c.intent === r.intent);
  if (!choice) return null;
  const workflowId = typeof r.workflowId === "string" && UUID_RE.test(r.workflowId) ? r.workflowId : null;
  if (isChangeIntent(choice.intent) && !workflowId) return null;
  return { intent: choice.intent, workflowId: isChangeIntent(choice.intent) ? workflowId : null, at: typeof r.at === "string" ? r.at : null };
}

type PendingProposal = { id: string; patches?: unknown };

/** The waiting proposal that files outcomes for the answer: for a change, a
 *  create_candidate naming its workflow (by id or name); for describe, any
 *  outcome or lane. */
export function proposalAnswering(staged: StagedImportIntent, changeName: string | null, pending: readonly PendingProposal[]): string | null {
  const name = changeName?.trim().toLowerCase() ?? null;
  for (const p of pending) {
    const patches = Array.isArray(p.patches) ? p.patches as Array<Record<string, unknown>> : [];
    for (const entry of patches) {
      const patch = entry?.patch && typeof entry.patch === "object" ? entry.patch as Record<string, unknown> : entry;
      const payload = patch?.payload && typeof patch.payload === "object" ? patch.payload as Record<string, unknown> : {};
      if (staged.workflowId) {
        if (patch?.type !== "create_candidate") continue;
        const byId = payload.workflowId === staged.workflowId;
        const byName = !!name && typeof payload.workflowName === "string" && payload.workflowName.trim().toLowerCase() === name;
        if (byId || byName) return p.id;
      } else if (patch?.type === "create_candidate" || patch?.type === "upsert_workflow") {
        return p.id;
      }
    }
  }
  return null;
}

// The status handler's generic client types run the checker past its
// instantiation depth (staged-explodes.ts says the same), so the reads are
// typed narrowly here.
type Res = { data: unknown; count?: number | null; error?: { message: string } | null };
type Filter = PromiseLike<Res> & {
  eq: (col: string, v: string) => Filter;
  neq: (col: string, v: string) => Filter;
  gte: (col: string, v: string) => Filter;
  maybeSingle: () => PromiseLike<Res>;
};
type Reader = { from: (table: string) => { select: (cols: string, opts?: { count: "exact"; head: true }) => Filter } };

/** The answer as it stands: null when the change it named is gone. The
 *  pending proposals are read only while no outcome is filed for it. */
export async function loadImportIntentState(
  client: unknown,
  projectId: string,
  staged: StagedImportIntent,
  pending: () => Promise<readonly PendingProposal[]>,
): Promise<ImportIntentState | null> {
  const db = client as Reader;
  const choice = IMPORT_INTENTS.find((c) => c.intent === staged.intent)!;
  let change: string | null = null;
  if (staged.workflowId) {
    const { data, error } = await db.from("workflows").select("id, name").eq("id", staged.workflowId).eq("project_id", projectId).maybeSingle();
    if (error) throw new Error(`could not read the change: ${error.message}`);
    const row = data as { name?: unknown } | null;
    if (!row) return null;
    change = typeof row.name === "string" ? row.name : "";
  }
  let q = db.from("requirement_candidates").select("id", { count: "exact", head: true })
    .eq("project_id", projectId).eq("kind", "outcome").neq("status", "dismissed");
  if (staged.workflowId) q = q.eq("workflow_id", staged.workflowId);
  else if (staged.at) q = q.gte("created_at", staged.at);
  const { count, error } = await q;
  if (error) throw new Error(`could not read the outcomes: ${error.message}`);
  const outcomes = count ?? 0;
  const proposalId = outcomes > 0 ? null : proposalAnswering(staged, change, await pending());
  return {
    intent: staged.intent, label: choice.label, change, workflowId: staged.workflowId, at: staged.at,
    outcomes, proposalId, started: outcomes > 0 || proposalId !== null,
  };
}

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

/** The status lead: what to do while the answer waits, what not to repeat once proposed, nothing once outcomes exist. */
export function importIntentLead(state: ImportIntentState | null, hasVision: boolean): string {
  if (!state || state.outcomes > 0) return "";
  if (state.proposalId) {
    const what = state.change !== null ? `The outcomes of the change ${q(state.change)} are` : "The description of the whole system is";
    return `${what} proposed (proposal ${state.proposalId}) and wait${state.change !== null ? "" : "s"} for the user's review; do not propose ${state.change !== null ? "them" : "it"} again. `;
  }
  const vision = hasVision ? "" : "update_vision drafted from the repository (tell the user it is a draft to confirm in their words), ";
  if (state.change !== null) {
    const steps = IMPORT_INTENTS.find((c) => c.intent === state.intent)!.steps;
    return `IMPORT INTENT CHOSEN in the app: the user chose ${q(state.label)} and named the change ${q(state.change)} (steps: ${steps.join(", ")}). ` +
      "Do not ask them what they are here to do again. Call get_import_context: its intent section reads the change with its scope and the repository's tests on it. " +
      `Then file ONE propose_patches call: ${vision}the outcomes on each of the change's steps, ${steps[0]} first (create_candidate { workflowName: ${q(state.change)}, stepName, serves }), ` +
      "and its constraints (create_constraint { workflowName }). ";
  }
  return `IMPORT INTENT CHOSEN in the app: the user chose ${q(state.label)}. Do not ask them what they are here to do again. ` +
    `Call get_import_context, then file ONE propose_patches call: ${vision}the lanes the system serves (upsert_workflow and upsert_workflow_step from the CI jobs and e2e order) ` +
    "and create_candidate for each outcome (workflowName, serves). ";
}

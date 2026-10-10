// Q (owner 2026-09-22): Free and Community see and use only what their plan
// carries. This module is the MCP half of that rule: what tools/list serves
// a caller, and which tools a call is refused on, both derived from the one
// feature table (_shared/feature-rules.ts).
//
// Two kinds of edit, one rule each:
//
//   TOOL_FEATURE  a tool that IS a paid capability (it creates or uses it).
//                 Below the feature's tier the tool is not listed, and a call
//                 to it is refused with the plan's refusal at the dispatch
//                 choke point, on both transports.
//   EDITS         an open tool whose description or schema names a paid
//                 capability. Below the feature's tier the sentence or the
//                 field is removed, so the agent is never told about a
//                 door it cannot use.
//
// Reads that answer about the account's OWN access stay listed on every
// plan (list_projects, list_project_members): a Free account can hold a
// seat on a paid project, and needs to see it.
//
// Every `find` must occur in the registry text it edits; the suite pins that,
// so a reworded description fails a test instead of silently showing the
// paid sentence again.
import { MCP_TOOLS, nearestToolNames } from './tool-registry.ts';
import { featureAllowed, featureInEdition, requireFeature, type Edition, type Feature } from '../_shared/feature-rules.ts';
import { serverEdition } from '../_shared/deployment.ts';
import type { PlanTier } from '../_shared/tiers.ts';

export const TOOL_FEATURE: Readonly<Record<string, Feature>> = {
  run_repo_import: 'repo_import',
  get_import_context: 'repo_import',
  get_node_context: 'repo_import',
  search_repo_index: 'repo_import',
  backfill_requirements: 'repo_import',
  get_work_plan: 'priority_board',
  propose_work_plan: 'priority_board',
  accept_work_plan: 'priority_board',
  set_project_member: 'team_lanes',
};

type Path = ReadonlyArray<string | number>;

export type SurfaceEdit =
  | { tool: string; feature: Feature; find: string; replace: string }
  | { tool: string; feature: Feature; schemaFind: string; replace: string }
  | { tool: string; feature: Feature; drop: Path };

export const EDITS: readonly SurfaceEdit[] = [
  // Workflows (Indie and above)
  {
    tool: 'propose_patches', feature: 'workflow_space',
    find: ' | place_on_step { candidateId, stepIds }. place_on_step, the workflow ops (upsert_workflow, upsert_workflow_step, set_outcome_step_maps, delete_workflow*) and the constraint ops (create_constraint, update_constraint, delete_constraint) need Indie and above; below it the call is refused naming them, and create_candidate files the outcome on the project.',
    replace: '.',
  },
  // AC (owner 2026-09-24): constraints are part of Workflows. Below Indie no
  // description names them: they do not exist on that plan.
  {
    tool: 'propose_patches', feature: 'workflow_space',
    find: "spec ops ride the batch, among them create_constraint { ctype: technology|architecture|deployment|performance|security|compliance|cost|other, description, title?, rationale?, scope?: { kind: role|technology|contract_kind|node, value }, kind?: guide|check, check?: { predicate: contract_has_schema | no_calls_between_roles { from, to } | technology_in_list { technologies } | sync_calls_at_most { max }, severity: warn|refuse, params } } for a standing condition the build must honour, in the user's words (NodeSpec ships none); update_constraint { constraintId, changes?, addWaiver?: { target, reason, expiresAt? }, removeWaiver? } and delete_constraint { constraintId, reason } are accepted by the user in the app only. A batch that adds a break of a refusing check is refused; of a warning check, it files with the warning;",
    replace: 'spec ops ride the batch;',
  },
  { tool: 'get_proposal_status', feature: 'workflow_space', find: 'reviewNote when they left one, with reviewNoteAsk: a note that states a standing rule for the project can be filed as a constraint, the user deciding.', replace: 'reviewNote when they left one.' },
  { tool: 'get_build_readiness', feature: 'workflow_space', find: 'unserved sentences are advisory and constraints are only ever a note. Broken checks are constraint advisories; unscoped reads add constraintSignals.', replace: 'unserved sentences are advisory.' },
  { tool: 'get_project_context', feature: 'workflow_space', find: 'the constraints and vision sentences that apply', replace: 'the vision sentences that apply' },
  { tool: 'propose_patches', feature: 'workflow_space', schemaFind: ' | set_contract_schema | place_on_step,', replace: ' | set_contract_schema,' },
  { tool: 'propose_patches', feature: 'workflow_space', find: 'spec ops (requirements, outcomes, workflows, constraints)', replace: 'spec ops (requirements, outcomes)' },
  { tool: 'propose_patches', feature: 'workflow_space', find: 'a promotion, a settle, a changed or retired constraint, or a confirmed requirement still waits', replace: 'a promotion, a settle or a confirmed requirement still waits' },
  { tool: 'get_outcome_board', feature: 'workflow_space', find: '(prompt data — what a workflow should achieve)', replace: '(prompt data: what the product should achieve)' },
  { tool: 'get_outcome_board', feature: 'workflow_space', find: ', the workflow steps it maps to', replace: '' },
  {
    tool: 'get_outcome_board', feature: 'workflow_space',
    find: 'Every board carries workflows.available; below Indie it is false and lanes, homeLane and steps are OMITTED, not empty.',
    replace: 'workflows.available is false on this plan, so the board carries no lanes, homeLane or steps.',
  },
  { tool: 'resolve_proposal', feature: 'workflow_space', find: '(requirement / outcome / workflow kinds)', replace: '(requirement / outcome kinds)' },

  // Priority (Indie and above)
  {
    tool: 'get_work_queue', feature: 'priority_board',
    find: 'the ACCEPTED work plan when one exists, else the deterministic fallback — the same dependency-ordered buildOrder',
    replace: 'the same dependency-ordered buildOrder',
  },
  { tool: 'get_work_queue', feature: 'priority_board', find: '; the ordering artifact itself (layers, critical path) is get_work_plan.', replace: '.' },

  // Repo import (Indie and above)
  {
    tool: 'update_vision', feature: 'repo_import',
    find: '; brownfield (after a repo import), draft it FROM the imported graph and present it for their edit before setting it.',
    replace: '.',
  },
  { tool: 'create_project', feature: 'repo_import', find: ' Repo-import project creation is not available via MCP.', replace: '' },
  // R.1b: the reconcile packet's index owner and structural signals ride with
  // repository import; below it the packet says signals: { available: false }.
  { tool: 'get_pending_changes', feature: 'repo_import', find: '(its binding, the repository index, or a suggested node with the reason)', replace: '(its binding, or a suggested node with the reason)' },
  { tool: 'get_pending_changes', feature: 'repo_import', find: '; structural signals from the diff (routes, outbound hosts, dependencies naming catalog entries, new directories with a manifest)', replace: '' },

  // Classification marks (Government)
  { tool: 'create_requirement', feature: 'classification', drop: ['properties', 'acceptance_criteria', 'items', 'anyOf', 1, 'properties', 'mark'] },
  { tool: 'update_requirement', feature: 'classification', drop: ['properties', 'preconditions', 'items', 'properties', 'mark'] },
  { tool: 'set_project_member', feature: 'classification', drop: ['properties', 'clearance'] },
  { tool: 'list_project_members', feature: 'classification', find: ' (each seat with its clearance — the classification marks it may see)', replace: '' },
];

export interface ServedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function dropPath(root: unknown, path: Path): void {
  let node = root as Record<string | number, unknown> | undefined;
  for (let i = 0; i < path.length - 1; i++) {
    node = node?.[path[i]] as Record<string | number, unknown> | undefined;
    if (!node || typeof node !== 'object') return;
  }
  if (node && typeof node === 'object') delete node[path[path.length - 1]];
}

/** Whether a tool is on this plan at all. */
export function toolOnPlan(name: string, tier: PlanTier): boolean {
  const feature = TOOL_FEATURE[name];
  return !feature || featureAllowed(tier, feature);
}

/** What tools/list serves a caller on this tier: the paid tools gone, and
 *  every open tool's description and schema without the paid sentences
 *  and fields. Pure; the registry is never mutated. */
/** What tools/list serves on a plan, in this build. A feature the build does
 *  not carry is left out whatever the plan (audit, owner 2026-09-27:
 *  classification is the Government build's alone). */
export function toolsForTier(tier: PlanTier, edition: Edition = serverEdition()): ServedTool[] {
  const served: ServedTool[] = [];
  for (const tool of MCP_TOOLS) {
    if (!toolOnPlan(tool.name, tier)) continue;
    let description = tool.description as string;
    let inputSchema = JSON.parse(JSON.stringify(tool.inputSchema)) as Record<string, unknown>;
    for (const edit of EDITS) {
      if (edit.tool !== tool.name || (featureAllowed(tier, edit.feature) && featureInEdition(edit.feature, edition))) continue;
      if ('find' in edit) description = description.replace(edit.find, edit.replace);
      else if ('schemaFind' in edit) inputSchema = JSON.parse(JSON.stringify(inputSchema).replace(edit.schemaFind, edit.replace));
      else dropPath(inputSchema, edit.drop);
    }
    served.push({ name: tool.name, description, inputSchema });
  }
  return served;
}

/** A client caches tools/list for the session, so the refusal says how the
 *  tool appears once the plan allows it. */
export const AFTER_UPGRADE = 'After an upgrade, reconnect the NodeSpec MCP server so tools/list shows it.';

/** The refusal a call to a tool that is not on this plan gets. Null when
 *  the tool is on the plan (or is not a paid tool at all). */
export function planRefusal(name: string, tier: PlanTier): string | null {
  const feature = TOOL_FEATURE[name];
  if (!feature) return null;
  const gate = requireFeature(tier, feature, { surface: name, stays: AFTER_UPGRADE });
  return gate.ok ? null : gate.error;
}

/** Typo suggestions drawn only from the tools this plan lists, so a near
 *  miss never names a tool the caller cannot see. */
export function nearestOnPlan(input: string, tier: PlanTier, max = 3): string[] {
  return nearestToolNames(input, max, MCP_TOOLS.filter((t) => toolOnPlan(t.name, tier)).map((t) => t.name));
}

/** The unknown-tool refusal, worded for the caller's list. */
export function unknownToolMessage(input: string, tier: PlanTier): string {
  const near = nearestOnPlan(input, tier);
  const count = MCP_TOOLS.filter((t) => toolOnPlan(t.name, tier)).length;
  return `Unknown tool: ${input}.`
    + (near.length > 0 ? ` Closest by name: ${near.join(', ')}.` : '')
    + ` tools/list serves every tool on this plan (${count} tools).`;
}

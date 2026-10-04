// P (owner 2026-09-22): Workflows start at Indie.
//
// What is closed below Indie is STRUCTURE: the journeys, their steps, and
// which step an outcome sits on. What stays open on every plan is the WORK:
// outcomes are filed and derived into requirements exactly as before.
//
// Two promises to the agent on the other end of the wire:
//
//   1. It is never handed an empty value that means "not on your plan".
//      A board below Indie carries `workflows: { available: false, ... }`
//      and OMITS lanes, homeLane and steps; it never returns them empty,
//      because an empty array reads as "nothing is mapped yet".
//   2. Nothing is orphaned. An outcome filed below Indie still has its home
//      lane (the v3v trigger homes it; workflow_id is NOT NULL), so a later
//      upgrade finds every outcome where the database put it.
//
// The gate runs twice: at propose (the agent hears at once and nothing is
// filed) and at apply (a proposal filed on Indie and accepted after a
// downgrade: each lane-shaping patch in it is refused at its write, with the
// upgrade reason; the rest is decided patch by patch, as it always is).
import type { PlanTier } from './tiers.ts';
import { requireFeature, featureAllowed } from './feature-rules.ts';
import { SPEC_PATCH_KIND } from './spec-patch-schema.ts';

/** The spec-plane ops that shape a workflow: exactly the ops the patch
 *  vocabulary files under kind 'workflow', derived rather than listed, so a
 *  workflow op added later is gated the day it exists. Every other op,
 *  including create_candidate and promote_candidate, is open on every plan. */
export const WORKFLOW_OPS: readonly string[] = Object.entries(SPEC_PATCH_KIND)
  .filter(([, kind]) => kind === 'workflow')
  .map(([type]) => type)
  .sort();

export function isWorkflowOp(type: unknown): boolean {
  return typeof type === 'string' && WORKFLOW_OPS.includes(type);
}

export function workflowsAllowed(tier: PlanTier): boolean {
  return featureAllowed(tier, 'workflow_space');
}

/** What keeps working, said in every refusal so the agent has a next move. */
export const WORKFLOWS_STAY =
  'Outcomes and requirements keep working on every plan: file an outcome with create_candidate (no workflow needed) ' +
  'and derive it with promote_candidate. Nothing is deleted; workflows made on a paid plan come back on Indie.';

export function requireWorkflows(tier: PlanTier, surface: string): { ok: true } | { ok: false; error: string } {
  return requireFeature(tier, 'workflow_space', { surface, stays: WORKFLOWS_STAY });
}

/** AC (owner 2026-09-24): constraints are part of Workflows. "Constraints
 *  CRUD operations and references shouldn't exist in lower tiers." Every
 *  constraint op is Indie and above, refused at propose and at apply (Z had
 *  gated only a constraint scoped to one workflow). */
export const CONSTRAINT_OPS: readonly string[] = ['create_constraint', 'delete_constraint', 'update_constraint'];

export function isConstraintOp(type: unknown): boolean {
  return typeof type === 'string' && CONSTRAINT_OPS.includes(type);
}

/** What keeps working when a constraint op is refused. */
export const CONSTRAINTS_STAY =
  'Requirements, task documents, readiness and tests work on every plan without them; constraints made on a paid plan come back on Indie.';

export function requireConstraints(tier: PlanTier, surface: string): { ok: true } | { ok: false; error: string } {
  return requireFeature(tier, 'workflow_space', { surface, stays: CONSTRAINTS_STAY });
}

/** create_candidate named a workflow on a plan without Workflows: the
 *  outcome is still filed, on the project, and the agent is told where. */
export const OUTCOME_ON_PROJECT_NOTE = (named: string) =>
  `Workflows are available on Indie and above, so this outcome was filed on the project rather than on "${named}". ` +
  'It keeps working like any outcome; after an upgrade it can be placed on a workflow step.';

/** The block every outcome board carries, on every plan, so its absence is
 *  never how an agent learns anything. */
export function workflowsBlock(tier: PlanTier):
  | { available: true }
  | { available: false; tier: PlanTier; note: string } {
  if (workflowsAllowed(tier)) return { available: true };
  return {
    available: false,
    tier,
    note:
      'Workflows are available on Indie and above, so this board carries no lanes, homeLane or steps. ' +
      'Every outcome here is real and derivable; none is missing a workflow.',
  };
}

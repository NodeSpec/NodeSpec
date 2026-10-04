// P (owner 2026-09-22): Workflows start at Indie. The gate module's pins:
// the gated set IS the vocabulary's 'workflow' kind (so a new lane-shaping
// op cannot slip past), outcomes and requirements are never in it, the
// refusal names the upgrade and what stays, and the board block always
// exists with a reason when it is closed.
import { WORKFLOW_OPS, isWorkflowOp, workflowsAllowed, requireWorkflows, workflowsBlock, WORKFLOWS_STAY, OUTCOME_ON_PROJECT_NOTE } from '../_shared/workflow-gate.ts';
import { SPEC_PATCH_KIND } from '../_shared/spec-patch-schema.ts';
import { CANONICAL_TIERS } from '../_shared/tiers.ts';
import { assert, assertEquals } from './helpers.ts';

Deno.test('workflow gate: the gated ops are exactly the vocabulary\'s workflow kind, and today that is these five', () => {
  const workflowKind = Object.keys(SPEC_PATCH_KIND).filter((t) => (SPEC_PATCH_KIND as Record<string, string>)[t] === 'workflow').sort();
  assertEquals([...WORKFLOW_OPS], workflowKind);
  assertEquals([...WORKFLOW_OPS], ['delete_workflow', 'delete_workflow_step', 'set_outcome_step_maps', 'upsert_workflow', 'upsert_workflow_step']);
  for (const t of WORKFLOW_OPS) assert(isWorkflowOp(t), t);
});

Deno.test('workflow gate: outcomes, requirements and the graph are never gated by it', () => {
  for (const t of ['create_candidate', 'update_candidate', 'promote_candidate', 'attach_candidate', 'settle_candidate', 'dismiss_candidate',
    'create_requirement', 'update_requirement', 'update_vision', 'add_node', 'add_edge', 'add_contract']) {
    assert(!isWorkflowOp(t), `${t} is gated`);
  }
  assert(!isWorkflowOp(undefined) && !isWorkflowOp(42) && !isWorkflowOp(''));
});

Deno.test('workflow gate: closed below Indie, open from Indie up, on every tier exactly once', () => {
  assertEquals(CANONICAL_TIERS.map((t) => [t, workflowsAllowed(t)]), [
    ['community', false], ['indie', true], ['team', true], ['enterprise', true], ['government', true],
  ]);
});

Deno.test('workflow gate: a refusal names the surface, the tier, the upgrade path and what keeps working', () => {
  const r = requireWorkflows('community', 'Shaping a workflow (upsert_workflow)');
  assert(!r.ok);
  assert(r.error.startsWith('Shaping a workflow (upsert_workflow) is available on Indie and above; this account resolves to the Community tier.'), r.error);
  assert(r.error.includes('https://nodespec.io/pricing'), r.error);
  assert(r.error.endsWith(WORKFLOWS_STAY), r.error);
  assert(WORKFLOWS_STAY.includes('create_candidate') && WORKFLOWS_STAY.includes('promote_candidate'), 'the next move is named');
  assertEquals(requireWorkflows('indie', 'x'), { ok: true });
});

Deno.test('workflow gate: the board block always exists; closed, it carries the tier and the reason', () => {
  assertEquals(workflowsBlock('indie'), { available: true });
  const closed = workflowsBlock('community');
  assertEquals(closed.available, false);
  assert(!closed.available && closed.tier === 'community' && closed.note.includes('Indie and above'));
  assert(OUTCOME_ON_PROJECT_NOTE('Ops').includes('"Ops"') && OUTCOME_ON_PROJECT_NOTE('Ops').includes('filed on the project'));
});

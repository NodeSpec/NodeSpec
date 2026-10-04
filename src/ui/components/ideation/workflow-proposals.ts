// V3 AE.7 (owner 2026-09-25): a teammate's Workflows edit is a proposal.
// The app compiles the edit into the same spec ops an agent files
// (upsert_workflow, delete_workflow, upsert_workflow_step,
// delete_workflow_step, set_outcome_step_maps) and files ONE proposal
// through propose_patches on the server's session door; the owner, or a
// maintainer in the app, decides it under Proposals and the server applies
// it there (spec-patch-apply). When the project's Outcomes & workflow
// setting is Auto-apply the edit is written directly instead
// (useWorkflowLanes, useOutcomes). Pure builders first; one call.
import { callEdgeFunction } from '../../../persistence/supabase/client.js';
import { sentenceCase } from './typography.js';

export interface WorkflowSpecPatch { type: string; payload: Record<string, unknown> }

const clean = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function laneUpsert(p: { id?: string; name: string; color?: string | null; ownerLabel?: string | null; contributors?: readonly string[]; sortOrder?: number; kind?: 'workflow' | 'change'; intent?: string }): WorkflowSpecPatch {
  return { type: 'upsert_workflow', payload: clean({ id: p.id, name: p.name, color: p.color ?? undefined, ownerLabel: p.ownerLabel ?? undefined, contributors: p.contributors ? [...p.contributors] : undefined, sortOrder: p.sortOrder, kind: p.kind, intent: p.intent }) };
}
export function laneDelete(id: string): WorkflowSpecPatch {
  return { type: 'delete_workflow', payload: { id } };
}
export function stepUpsert(p: { id?: string; workflowId: string; name: string; sortOrder?: number }): WorkflowSpecPatch {
  return { type: 'upsert_workflow_step', payload: clean({ id: p.id, workflowId: p.workflowId, name: p.name, sortOrder: p.sortOrder }) };
}
export function stepDelete(id: string): WorkflowSpecPatch {
  return { type: 'delete_workflow_step', payload: { id } };
}
export function stepMaps(p: { candidateId: string; branchId: string; stepIds: readonly string[] }): WorkflowSpecPatch {
  return { type: 'set_outcome_step_maps', payload: { candidateId: p.candidateId, branchId: p.branchId, stepIds: [...p.stepIds] } };
}

/** The toast after a proposal files: what was asked, and where it waits. */
export function proposalNotice(explanation: string): string {
  return `Filed as a proposal: ${explanation}. The owner decides it under Proposals.`;
}

/** One proposal for one edit, as the signed-in person. The server answers
 *  the proposal's id, or refuses by name (the plan, the seat, the schema). */
export async function fileWorkflowProposal(
  projectId: string,
  patches: readonly WorkflowSpecPatch[],
  explanation: string,
  email: string | null,
): Promise<{ proposalId: string } | { error: string }> {
  try {
    const r = await callEdgeFunction<{ success: boolean; error?: string; data?: { proposalId?: string } }>('mcp-server', {
      tool: 'propose_patches',
      arguments: {
        project_id: projectId,
        // AL.2: a teammate's edit is a person's (actorType human), and its
        // card reads as a sentence.
        patches: patches.map((p) => ({ type: p.type, payload: p.payload, metadata: { actorType: 'human' } })),
        explanations: patches.map(() => sentenceCase(explanation)),
        ...(email ? { external_agent: email } : {}),
      },
    });
    if (!r.success) return { error: r.error || 'The proposal was not filed.' };
    const proposalId = r.data?.proposalId;
    return proposalId ? { proposalId } : { error: 'The proposal was filed without an id.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

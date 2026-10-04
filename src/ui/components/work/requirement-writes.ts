// V3 4.1 → 6.1: the requirement record's ONE guarded write path, as it
// stood on the rail (and on Trace before that): the row's updated_at is the
// concurrency token, a locked row refuses in the database's own words
// (v3x), and the trace re-reads after every write. 6.1 adds the task tick
// (task_items.done with app provenance) and a test case the person adds by
// hand (test_cases, status not started, bound to the criterion it proves),
// both under the same RLS the app already holds.
//
// Y (owner 2026-09-23): a task the person adds by hand. Tasks are the
// agent's to write (generate_task_docs), so a hand-added one goes where the
// agent reads them: the node's task doc, in its own `## Added Tasks`
// section, as the same update_artifact patch the Architecture workbench
// makes (the branch store applies it and autosave persists it).
// Regeneration carries the section verbatim (task-deltas.ts).
import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import { createAddArtifactPatch, createUpdateArtifactPatch, createUpdateNodePatch } from '@nodespec/core/patch-factory.js';
import { generateUUID, now } from '@nodespec/core/utils.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { appendAddedTask, getTaskDocumentPath, nextAddedTaskId } from '../../../../supabase/functions/_shared/task-deltas.js';
import type { TraceChain } from '../ideation/useTraceData.js';
import type { VerifyWrite } from '../ideation/VerifyLane.js';

export interface RequirementWriteDeps {
  traceRefresh: () => Promise<void>;
  bandRefresh: () => Promise<void>;
  outcomesRefresh: () => Promise<void>;
  /** A delete clears the selection before the re-read lands. */
  onDeleted?: () => void;
}

/** null on success, else the refusal in words. */
export async function writeRequirementRow(ch: TraceChain, patch: VerifyWrite, deps: RequirementWriteDeps): Promise<string | null> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('criteria' in patch) updates.acceptance_criteria = patch.criteria;
  if ('locked' in patch) updates.locked = patch.locked;
  if ('mark' in patch) updates.mark = patch.mark;
  if ('description' in patch) updates.description = patch.description;
  if ('archived' in patch) updates.archived_at = patch.archived ? new Date().toISOString() : null;
  try {
    if ('delete' in patch) {
      const { data, error } = await getSupabaseClient().from('specification_requirements').delete().eq('id', ch.reqRowId).select('id').maybeSingle();
      if (error) return error.message;
      if (!data) { void deps.traceRefresh(); return 'This requirement is already gone. Refreshed.'; }
      deps.onDeleted?.();
      await Promise.all([deps.traceRefresh(), deps.bandRefresh(), deps.outcomesRefresh()]);
      return null;
    }
    let q = getSupabaseClient().from('specification_requirements').update(updates).eq('id', ch.reqRowId);
    if (ch.verify.updatedAt) q = q.eq('updated_at', ch.verify.updatedAt);
    const { data, error } = await q.select('id').maybeSingle();
    if (error) return error.message;
    if (!data) { void deps.traceRefresh(); return 'This requirement changed since Work read it. Refreshed; try again.'; }
    await Promise.all([deps.traceRefresh(), deps.bandRefresh()]);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'The write failed.';
  }
}

/** 6.1: tick or untick a task from the record. The task_items row is
 *  keyed (project, node, key); a task the docs name but no row holds yet
 *  gets its row here. Provenance says a person did it in the app. */
export async function tickTask(
  input: { projectId: string; nodeId: string; taskKey: string; displayId: string; title: string; done: boolean },
  deps: Pick<RequirementWriteDeps, 'traceRefresh'>,
): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    const provenance = { source: 'ui', actor: user?.email ?? user?.id ?? 'owner', at: new Date().toISOString() };
    const { data: existing, error: readErr } = await supabase
      .from('task_items').select('id').eq('project_id', input.projectId).eq('node_id', input.nodeId).eq('task_key', input.taskKey).maybeSingle();
    if (readErr) return readErr.message;
    const now = new Date().toISOString();
    const { error } = existing
      ? await supabase.from('task_items').update({ done: input.done, provenance, updated_at: now }).eq('id', (existing as { id: string }).id)
      : await supabase.from('task_items').insert({ project_id: input.projectId, node_id: input.nodeId, task_key: input.taskKey, display_id: input.displayId, title: input.title, done: input.done, provenance });
    if (error) return error.message;
    await deps.traceRefresh();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'The tick did not land.';
  }
}

/** The next TC id after the ones a requirement holds: TC-012 after TC-011;
 *  TC-001 on a requirement with none. Pure. */
export function nextTestId(existing: ReadonlyArray<{ test_id: string }>): string {
  let max = 0;
  for (const t of existing) {
    const m = /^TC-(\d+)$/.exec(t.test_id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `TC-${String(max + 1).padStart(3, '0')}`;
}

/** A test the person adds by hand (owner's ruling 2026-09-21): it proves ONE
 *  criterion and is bound to it at creation, so an agent reporting that
 *  criterion under another id is told which case holds it (never a second
 *  case for the same criterion). Order: the binding goes through the guarded
 *  requirement write first (a locked or since-changed row refuses here and
 *  nothing else happens), then the row is inserted under the id the
 *  criterion now names; a TC label another writer took meanwhile is retried
 *  once with the next free one; a row that still cannot land unbinds. The
 *  row carries metadata.source 'manual' so every surface can say whose it is. */
export async function addTestCase(
  input: { chain: TraceChain; requirementRowId: string; criterionId: string; testId: string; name: string; expected: string | null },
  deps: RequirementWriteDeps,
): Promise<string | null> {
  const criterion = input.chain.verify.criteria.find((c) => c.id === input.criterionId);
  if (!criterion) { void deps.traceRefresh(); return 'That criterion is gone. Refreshed.'; }
  if (typeof criterion.testId === 'string' && criterion.testId) return 'That criterion already has its test.';
  const name = input.name.trim() || String(criterion.text ?? '').trim();
  if (!name) return 'A test needs a name.';
  const newId = crypto.randomUUID();
  const before = input.chain.verify.criteria;
  const bound = await writeRequirementRow(input.chain, { criteria: before.map((c) => (c.id === input.criterionId ? { ...c, testId: newId } : c)) }, deps);
  if (bound) return bound;
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    const insert = (testId: string) => supabase.from('test_cases').insert({
      id: newId, requirement_id: input.requirementRowId, test_id: testId, name, status: 'not_started',
      ...(input.expected?.trim() ? { expected_result: input.expected.trim() } : {}),
      metadata: { source: 'manual', authoredBy: user?.email ?? user?.id ?? 'owner', at: new Date().toISOString() },
    });
    let { error } = await insert(input.testId);
    if (error?.code === '23505') {
      const { data: taken } = await supabase.from('test_cases').select('test_id').eq('requirement_id', input.requirementRowId);
      ({ error } = await insert(nextTestId((taken ?? []) as Array<{ test_id: string }>)));
    }
    if (error) {
      // the row never landed: give the criterion back (the trigger that clears a
      // deleted test's binding has nothing to clear here)
      await supabase.from('specification_requirements').update({ acceptance_criteria: before, updated_at: new Date().toISOString() }).eq('id', input.requirementRowId);
      void deps.traceRefresh();
      return error.message;
    }
    await deps.traceRefresh();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'The test was not added.';
  }
}

/** The node's task doc, found by node and kind (never by recomputed path). */
function taskDocOf(graph: Graph | null | undefined, nodeId: string) {
  return Object.values(graph?.artifacts ?? {}).find((a) => a.nodeId === nodeId && a.kind === 'task') ?? null;
}

/** The T id the next hand-added task takes on this node. Pure. */
export function nextTaskIdOn(graph: Graph | null | undefined, nodeId: string): string {
  return nextAddedTaskId(taskDocOf(graph, nodeId)?.content ?? null);
}

/** Y: the patches that add a person's task to a node's task doc, serving
 *  one criterion of the requirement; or the refusal in words. A node with
 *  no doc yet gets one started (and linked), which the agent's next
 *  generate_task_docs fills in around the section. Pure. */
export function addTaskPatches(
  graph: Graph | null | undefined,
  input: { nodeId: string; title: string; serves: { reqId: string; text: string } },
): { patches: PatchOperation[] } | { refusal: string } {
  const node = graph?.nodes?.[input.nodeId];
  if (!node) return { refusal: 'That node is gone from the architecture.' };
  if (!input.serves.text.trim()) return { refusal: 'Pick the criterion this task serves.' };
  const doc = taskDocOf(graph, input.nodeId);
  const next = appendAddedTask(doc?.content ?? null, { nodeLabel: node.label, title: input.title, serves: input.serves });
  if (!next.ok) return { refusal: next.refusal };
  const summary = `Add ${next.displayId} to ${node.label} by hand`;
  if (doc) {
    return { patches: [createUpdateArtifactPatch(doc.id, { content: next.content }, { actorType: 'human', summary })] };
  }
  const id = generateUUID();
  const at = now();
  return {
    patches: [
      createAddArtifactPatch({
        id, nodeId: node.id, kind: 'task', path: getTaskDocumentPath(node.label, node.id),
        content: next.content, language: 'markdown', status: 'draft',
        description: `Implementation task document for ${node.label}`, createdAt: at, updatedAt: at,
      }, { actorType: 'human', summary }),
      createUpdateNodePatch(node.id, { artifacts: [...(node.artifacts ?? []), id] }, { actorType: 'human', summary: `Link the task document to ${node.label}` }),
    ],
  };
}

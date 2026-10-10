// GENERATED from core/src/evidence-stale.ts by scripts/sync-core-engine.mjs. Do not edit:
// change core and run the script; src/tests/core-engine-copy.test.ts fails on drift.
// R5e · evidence-stale, "the source changed under a proven criterion, re-verify."
//
// The scenario: a criterion was marked met via a git tick (R5c). Later, an
// out-of-band change to one of that node's bound artifacts is ACCEPTED from the
// sweep, the implementation the tick vouched for has moved. The criterion is not
// UNMET (nothing disproved it), but its evidence is stale: it proved the old code.
//
// Deterministic by construction: the file→artifact→node→criterion chain is fully
// known (artifact binding + specification_mappings), so no inference is involved.
// This is the analogue of the existing `test_cases` source-change staleness
// trigger (migration 20260325192007), for criteria whose evidence is a git tick
// rather than a test, which is why the scope below is provenance-gated.
//
// AL.24: the pure half lives in core, so the server's Auto accept flags the
// same criteria a person's accept does; the app's write stays in
// src/ui/services/evidenceStale.ts.

export interface EvidenceStaleMark {
  at: string;
  commitSha?: string;
  reason: 'source-changed';
}

/**
 * Flag the met criteria whose evidence is a GIT TICK. Pure.
 *
 * Scope, deliberately narrow (each exclusion is a different truth-owner):
 *  - `met !== true`            → nothing to go stale.
 *  - `provenance.source !== 'git'` → test-evidenced criteria already have their
 *    own staleness lane (the test_cases source-change trigger), and UI-ticked
 *    criteria were asserted by a human, not derived from the file that changed,
 *    flagging those would second-guess a person from a signal about code.
 *  - already flagged           → idempotent; re-accepting more changes must not
 *    stack marks or churn the row.
 *
 * `met` STAYS TRUE. Stale evidence is a prompt to re-verify, not a retraction,
 * the same asymmetry R5a applies to unticks.
 */
export function flagStaleCriteria(
  stored: unknown,
  mark: EvidenceStaleMark,
): { criteria: Array<Record<string, unknown>>; flaggedTexts: string[] } {
  const flaggedTexts: string[] = [];
  const criteria = (Array.isArray(stored) ? stored : []).map((c) => {
    const obj: Record<string, unknown> =
      typeof c === 'string' ? { text: c } : { ...(c as Record<string, unknown>) };
    const provenance = obj.provenance as { source?: string } | undefined;
    if (
      obj.met === true &&
      provenance?.source === 'git' &&
      !obj.evidenceStale &&
      typeof obj.text === 'string'
    ) {
      obj.evidenceStale = { ...mark };
      flaggedTexts.push(obj.text);
    }
    return obj;
  });
  return { criteria, flaggedTexts };
}

/**
 * V3 AD.3 (D22): the nodes whose bound files a batch of accepted patches
 * changed. Evidence used to go stale only on the Git panel's file accept; a
 * proposal that brings a file change onto the canvas (an agent reconciling a
 * change, a load of git's model, a binding pulled from a commit) flags the
 * same criteria. Only an existing file whose content differs counts: a new
 * binding has nothing to make stale. AL.29: a task document or a test plan is
 * NodeSpec's own description of the work, not the code a test proved, so its
 * regeneration (at generate_task_docs, get_test_plan or a push) never makes
 * evidence stale. Pure.
 */
export function nodesWithChangedFiles(
  patches: Array<{ type: string; payload?: unknown }>,
  artifactsBefore: Record<string, { nodeId?: string | null; content?: string; contentHash?: string; kind?: string } | undefined>,
): string[] {
  const nodes = new Set<string>();
  for (const p of patches) {
    if (p.type !== 'update_artifact') continue;
    const payload = (p.payload ?? {}) as { id?: string; changes?: { content?: unknown; contentHash?: unknown; nodeId?: unknown } };
    const changes = payload.changes;
    if (!payload.id || !changes || typeof changes.content !== 'string') continue;
    const before = artifactsBefore[payload.id];
    if (!before) continue;
    if (before.kind === 'task' || before.kind === 'test-plan') continue;
    if (before.content === changes.content) continue;
    if (before.contentHash && typeof changes.contentHash === 'string' && before.contentHash === changes.contentHash) continue;
    const nodeId = typeof changes.nodeId === 'string' ? changes.nodeId : before.nodeId;
    if (nodeId) nodes.add(nodeId);
  }
  return [...nodes];
}

/**
 * A human touching a stale criterion IS the re-verification. Used by the Spec
 * view's criterion toggle: any explicit met change clears the stale mark (and a
 * re-tick records UI provenance, so the audit trail says who re-verified).
 */
export function clearEvidenceStale(criterion: Record<string, unknown>): Record<string, unknown> {
  const { evidenceStale: _dropped, ...rest } = criterion;
  return rest;
}

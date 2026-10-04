/**
 * An approval never discards a patch (production incident 2026-09-18).
 *
 * On 'OpenMed Import' a container node was exploded into children over MCP:
 * 7 remove_edge patches retired the old container's edges and 7 add_edge
 * patches replaced them against the new children. Every add_edge referenced a
 * contractId that no add_contract had ever created — two ghost ids across all
 * seven. propose_patches validated each patch ALONE against the schema, which
 * only asks that contractId be a uuid, so the batch was accepted.
 *
 * At approve time the engine did the right thing and raised CONTRACT_NOT_FOUND
 * for each add_edge. ProposalService then counted them into `droppedCount`,
 * compared that against MAX_ALLOWED_DROP_COUNT (10) AND MAX_ALLOWED_DROP_RATIO
 * (0.2) — 7 of ~135 patches is 5.2%, under both — and committed the snapshot
 * anyway, reporting success. The removes had applied. The canvas lost 7 edges
 * and every one of the 14 patches stayed in graph_patches: the graph
 * disagreed with its own log, silently.
 *
 * The engine already catches this. What was missing was refusing to proceed.
 * These pin that no drop is tolerated at any ratio, and that the failure names
 * the patch so it is actionable.
 *
 * (The other half — refusing such a batch at submission so the agent
 * self-corrects — lives in supabase/functions/tests/mcp-proposals_test.ts and
 * migration 20260919100000.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');
const service = () => src('src/ui/services/ProposalService.ts');

describe('accepting a proposal never drops a patch', () => {
  it('the drop tolerance is gone — no ratio, no count, no survivor', () => {
    const s = service();
    // The thresholds are what let 7 lost edges read as a successful approval.
    expect(s).not.toContain('MAX_ALLOWED_DROP_RATIO');
    expect(s).not.toContain('MAX_ALLOWED_DROP_COUNT');
    // droppedCount is gone as CODE. The word may still appear in the comment
    // that records why the tolerance was removed — that history is the point.
    const code = s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain('droppedCount');
    expect(code).not.toMatch(/\bdropRatio\b/);
  });

  it('a patch that will not apply throws, and the snapshot is not saved', () => {
    const s = service();
    const fn = s.slice(s.indexOf('const applyInBatches'), s.indexOf('return { graph: currentGraph, patchCount: patches.length };'));
    // The one-by-one pass exists to NAME the offender, not to skip it.
    expect(fn).toContain('const singleResult = applyPatches(currentGraph, [patch]);');
    expect(fn).toContain('throw new Error(');
    // Everything the user needs to act: what failed, why, and that nothing was lost.
    expect(fn).toContain('no patch was discarded and the snapshot was NOT saved');
    expect(fn).toContain('err?.code');
    expect(fn).toContain('err?.message');
    expect(fn).toContain('patch?.type');
    // And no path out that quietly continues past a failure.
    expect(fn).not.toMatch(/\bcontinue;\s*\}\s*else\s*\{\s*\w*[Dd]rop/);
  });

  it('applyInBatches no longer reports a drop count to its callers', () => {
    const s = service();
    expect(s).toContain('Promise<{ graph: any; patchCount: number } | null>');
    expect(s).toContain('return { graph: currentGraph, patchCount: patches.length };');
  });

  it('the full-replay path commits what replayed or throws — never a degraded snapshot', () => {
    const s = service();
    const replay = s.slice(s.indexOf('Full replay from empty graph'), s.indexOf('Safety guard: prevent snapshot regression'));
    expect(replay).toContain('const fullResult = await applyInBatches(emptyGraph, patchPayloads);');
    // The old escape: preserve the existing snapshot and return, leaving the
    // log ahead of the graph with nothing surfaced.
    expect(replay).not.toContain('Preserving existing snapshot');
    expect(replay).not.toContain('dropRatio');
  });

  it('the node-regression guard still throws rather than returning silently', () => {
    // Nodes got this treatment in 2026-07-16; edges never did until now. The
    // guard must stay a throw — the two failures are the same shape.
    expect(service()).toContain('Snapshot regression blocked:');
    expect(service()).toContain('the patch log is ahead of the persisted snapshot');
  });
});

describe('the engine that catches it', () => {
  it('add_edge validation rejects an unresolvable contract, source or target', () => {
    const engine = src('core/src/patch-engine.ts');
    const addEdge = engine.slice(engine.indexOf("case 'add_edge':"), engine.indexOf("case 'update_edge':"));
    expect(addEdge).toContain('CONTRACT_NOT_FOUND');
    expect(addEdge).toContain('SOURCE_NODE_NOT_FOUND');
    expect(addEdge).toContain('TARGET_NODE_NOT_FOUND');
    expect(addEdge).toContain('graph.contracts[validPatch.payload.contractId]');
  });

  it('contracts are applied before the edges that reference them, so batch order is not the bug', () => {
    const engine = src('core/src/patch-engine.ts');
    const order = engine.slice(engine.indexOf('export function sortPatchesByDependencyOrder'));
    expect(order).toContain("'add_contract': 10");
  });
});

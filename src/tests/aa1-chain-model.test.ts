import { describe, it, expect } from 'vitest';
import { attachableOutcomes, chainCounts, chainLine, constraintReach, firstUnserved, inChain, packetNodeIds, reachLine, sentenceLabel, servedBy, servesLine } from '../ui/components/work/chain-model.js';
import { visionSentences } from '../ui/utils/vision-sentences.js';
import type { Outcome } from '../ui/components/ideation/useOutcomes.js';

// AA.1 (owner 2026-09-23): the chain in the app, pure. The Requirements
// header reads it as counts; a new outcome is offered the sentence no outcome
// serves yet; the rail and the record say which sentence an outcome serves;
// a requirement derives from an open outcome; a constraint says how many node
// packets carry it (project-wide: every packet; scoped: the nodes its
// workflow's outcomes' requirements map to).

const VISION = 'Shelfie helps bookshops sell online. Orders ship in two days!\n- Owners see stock.';
const S = visionSentences(VISION);
const outcome = (id: string, over: Partial<Outcome> = {}): Outcome => ({
  id, name: id, description: '', category: 'functional', kind: 'outcome', key: `outcome:${id}`, status: 'pending', node_id: null,
  criteria: [], requirement_row_id: null, workflow_id: 'lane', mark: null, evidence: null,
  workflowId: 'lane', stepIds: [], live: false, promoted: false, reqRef: null, derivations: [], claimed: {}, reqRefs: [], settled: false, serves: [], ...over,
});
const derived = (rowId: string) => [{ id: `d-${rowId}`, requirementRowId: rowId, reqRef: null, criteriaIds: [], proposedByKind: 'human' as const, createdAt: '2026-09-23T00:00:00Z' }];

describe('AA.1 · the chain as counts', () => {
  it('counts sentences served, outcomes (an import-born candidate once it derived), requirements from an outcome', () => {
    const outcomes = [
      outcome('o1', { serves: [S[1]], derivations: derived('r1') }),
      outcome('o2', { serves: [{ id: 'v:00000000', text: 'Gone' }] }),
      outcome('imp', { kind: 'api', serves: [S[0]] }),
      outcome('imp2', { kind: 'api', derivations: derived('r2') }),
    ];
    expect(inChain(outcomes[2])).toBe(false);
    expect(inChain(outcomes[3])).toBe(true);
    const c = chainCounts({ vision: VISION, outcomes, requirementIds: ['r1', 'r2', 'r3'] });
    expect(c).toEqual({ sentences: 3, served: 1, outcomes: 3, requirements: 3, withOutcome: 2 });
    expect(chainLine(c, '1 of 9 criteria proven')).toBe('1 of 3 vision sentences served · 3 outcomes · 2 of 3 requirements from an outcome · 1 of 9 criteria proven');
    expect(chainLine(chainCounts({ vision: '', outcomes: [], requirementIds: [] }), null)).toBe('No vision yet · 0 outcomes · no requirements');
  });

  it('offers the first sentence no outcome serves yet, else the first', () => {
    expect(firstUnserved(S, [outcome('o1', { serves: [S[0]] })])?.id).toBe(S[1].id);
    expect(firstUnserved(S, S.map((v, i) => outcome(`o${i}`, { serves: [v] })))?.id).toBe(S[0].id);
    expect(firstUnserved([], [])).toBeNull();
  });
});

describe('AA.1 · what an outcome serves', () => {
  it('current sentences read as served; a sentence the vision lost says so; none says so', () => {
    expect(servedBy(outcome('o', { serves: [S[2], { id: 'v:00000000', text: 'Old words' }] }), S)).toEqual({ current: [S[2]], lost: [{ id: 'v:00000000', text: 'Old words' }] });
    expect(servesLine(outcome('o', { serves: [S[0], S[2]] }), S)).toBe('Serves the vision: “Shelfie helps bookshops sell online.” and “Owners see stock.”');
    expect(servesLine(outcome('o', { serves: [{ id: 'v:00000000', text: 'Old words' }] }), S)).toBe('Cites a sentence the vision no longer has: “Old words”');
    expect(servesLine(outcome('o'), S)).toBe('Serves no sentence of the vision yet');
    expect(sentenceLabel({ id: 'v:1', text: 'x'.repeat(100) }, 10)).toBe('xxxxxxx...');
  });

  it('a requirement derives from an open outcome only (a closed one derives nothing more)', () => {
    expect(attachableOutcomes([outcome('b', { name: 'Beta' }), outcome('a', { name: 'Alpha' }), outcome('s', { status: 'accepted' }), outcome('i', { kind: 'api' })]))
      .toEqual([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);
  });
});

describe('AA.1 · where a constraint is carried', () => {
  it('project-wide: every packet; scoped: the packets of the nodes its workflow\'s outcomes derive into', () => {
    const packets = packetNodeIds({
      a1: { path: '.nodespec/tasks/api.task.md', nodeId: 'n1' },
      a2: { path: '.nodespec/tasks/db.task.md', nodeId: 'n2' },
      a3: { path: 'src/api.ts', nodeId: 'n1' },
      a4: { path: '.nodespec/tasks/web.task.md', nodeId: 'n3' },
    });
    expect([...packets].sort()).toEqual(['n1', 'n2', 'n3']);
    const reach = constraintReach({
      constraints: [{ id: 'k-all', workflow_id: null }, { id: 'k-checkout', workflow_id: 'checkout' }, { id: 'k-none', workflow_id: 'returns' }],
      outcomes: [outcome('o1', { workflowId: 'checkout', derivations: derived('r1') }), outcome('o2', { workflowId: 'returns' })],
      requirementNodes: new Map([['r1', ['n1', 'n2', 'n9']]]),
      packets,
    });
    expect(Object.fromEntries(reach)).toEqual({ 'k-all': 3, 'k-checkout': 2, 'k-none': 0 });
    expect([reachLine(0), reachLine(1), reachLine(4)]).toEqual(['In no node packet yet', 'In 1 node packet', 'In 4 node packets']);
  });
});

describe('AA.1 · the app writes what the server checks', () => {
  it('useOutcomes stores citations as { id, text } on evidence.serves; a settled outcome takes a new citation; attach reads the row first', async () => {
    const { readFileSync } = await import('node:fs');
    const hook = readFileSync('src/ui/components/ideation/useOutcomes.ts', 'utf-8');
    expect(hook).toContain("evidence: { serves: serves.map((v) => ({ id: v.id, text: v.text })) }");
    const setServes = hook.slice(hook.indexOf('const setServes = useCallback'), hook.indexOf('const attachRequirement = useCallback'));
    expect(setServes).toContain(".neq('status', 'dismissed')");
    const attach = hook.slice(hook.indexOf('const attachRequirement = useCallback'));
    expect(attach).toContain(".select('id, name, status, criteria, requirement_row_id')");
    expect(attach).toContain("proposed_by_kind: 'human'");
    // K.2's wrapper inherits what the requirement's outcomes already cite
    expect(hook).toContain('const inherited = new Map<string, VisionSentence>();');
  });
});

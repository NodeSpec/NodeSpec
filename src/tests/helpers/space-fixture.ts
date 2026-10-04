// W: the mockup's Incident response workflow as Work's hooks hand it over
// (lanes and steps, outcomes with their step maps and derivations, the
// requirement band, the trace chains, the constraints, the graph). Shared by
// the Workflows space's model and render tests.
import type { WorkflowLane } from '../../ui/components/ideation/useWorkflowLanes.js';
import type { Outcome } from '../../ui/components/ideation/useOutcomes.js';
import type { BandRequirement } from '../../ui/components/ideation/useRequirementBand.js';
import type { TraceChain } from '../../ui/components/ideation/useTraceData.js';
import type { ConstraintRow } from '../../ui/components/ideation/useConstraints.js';
import type { Graph } from '@nodespec/core/types.js';

type Task = { key: string; d: string; t: string; done: boolean; commit?: string };
type Test = { id: string; tc: string; name: string; status: string; type: string; file: string; covers?: string };

export interface SpaceFixture {
  lanes: WorkflowLane[];
  outcomes: Outcome[];
  band: Map<string, BandRequirement>;
  chains: Map<string, TraceChain>;
  constraints: ConstraintRow[];
  graph: Graph;
  req: Record<string, string>;
}

export function spaceFixture(): SpaceFixture {
  const lanes: WorkflowLane[] = [
    { id: 'wf-ir', name: 'Incident response', kind: 'workflow', color: '#8B8FE6', ownerLabel: 'Ana Kohl', contributors: [], sortOrder: 0,
      steps: ['Detect', 'Triage', 'Contain', 'Eradicate', 'Report'].map((name, i) => ({ id: `s${i}`, name, sortOrder: i })) },
    { id: 'wf-po', name: 'Purchase order approval', kind: 'workflow', color: '#5fd3c8', ownerLabel: null, contributors: [], sortOrder: 1,
      steps: ['Request', 'Approve', 'Reconcile'].map((name, i) => ({ id: `p${i}`, name, sortOrder: i })) },
  ];
  const band = new Map<string, BandRequirement>();
  const chains = new Map<string, TraceChain>();
  const graph = { nodes: {}, artifacts: {}, edges: {}, contracts: {} } as unknown as Graph & { nodes: Record<string, unknown>; artifacts: Record<string, unknown> };
  const node = (id: string, label: string, technology: string) => { (graph.nodes as Record<string, unknown>)[id] = { id, label, technology }; return { id, label }; };
  (graph.artifacts as Record<string, unknown>)['a1'] = { id: 'a1', path: 'services/detection/rules_engine.py', language: 'python', kind: 'source', contentHash: '9f2c1ab4e07d55aa1122' };
  const req: Record<string, string> = {};

  const make = (rowId: string, ref: string, name: string, crit: Array<[string, boolean]>, o: { node?: { id: string; label: string }; tasks?: Task[]; tests?: Test[]; confirmed?: boolean; locked?: boolean; sha?: string } = {}) => {
    req[ref] = rowId;
    const met = crit.filter((c) => c[1]).length;
    band.set(rowId, { id: rowId, ref, name, status: null, locked: !!o.locked, confirmed: !!o.confirmed, backfilled: false, nodeIds: o.node ? [o.node.id] : [], criteriaCount: crit.length, metCount: met, derived: true, done: met === crit.length, archived: false, state: 'open' as never, archivedAt: null, expands: [] });
    const tests = o.tests ?? [];
    chains.set(rowId, {
      id: `ch-${rowId}`, reqRowId: rowId, ref, title: name, groupId: null, groupIndex: 0, groupSize: 1, originIds: [], rowState: 'PARTIAL', state: 'open', counts: {} as never, archived: false,
      cells: {
        outcome: [], req: [], code: [],
        arch: o.node ? [{ id: o.node.id, tier: 'arch', label: o.node.label, ref: null, meta: '', live: null, state: 'ok', upLabel: '', up: [], downLabel: '', down: [] }] : [],
        plan: o.node ? [{ id: `plan-${rowId}`, tier: 'plan', label: '', ref: null, meta: '', live: null, state: 'open', upLabel: 'Tasks', downLabel: 'Tests',
          up: (o.tasks ?? []).map((t) => ({ id: `task:${o.node!.id}:${t.key}`, kind: 'task' as const, title: `${t.d} · ${t.t}`, right: t.done ? 'done' : 'open', state: t.done ? 'ok' as const : 'open' as const, live: null, provenance: t.commit ? { source: 'git', commitSha: t.commit } : null, detail: [], links: ['c1'] })),
          down: tests.map((t) => ({ id: `tc:${t.id}`, kind: 'test' as const, title: `${t.tc} · ${t.name}`, right: t.status, state: 'open' as const, live: null, provenance: null, detail: [['test code', t.file], ['expects', '—']] as Array<[string, string]>, links: [`af:${t.file}`, ...(t.covers ? [`af:${t.covers}`] : [])] })) }] : [],
      },
      verify: {
        locked: !!o.locked, mark: null, updatedAt: null, description: `${name}, in full.`, archivedAt: null,
        criteria: crit.map((c, i) => ({ id: `c${i + 1}`, text: c[0], met: c[1], ...(tests[i] ? { testId: tests[i].id } : {}), ...(c[1] && o.sha ? { provenance: { source: 'test', commitSha: `${o.sha}ffffff`, at: `2026-09-2${i}T10:00:00Z` } } : {}) })),
        tests: tests.map((t) => ({ id: t.id, test_id: t.tc, name: t.name, status: t.status, stale: false, testType: t.type, framework: 'pytest' })),
      },
    } as TraceChain);
  };

  const det = node('n1', 'Detection Engine', 'sigma-rules');
  make('r1', 'REQ-014', 'Anomalous login detection', [['Flags five failed logins in a minute', true], ['Raises within 60 seconds', true]], {
    node: det, confirmed: true, sha: '9e41b07',
    tasks: [{ key: 't1', d: 'T01', t: 'Write the sigma rule', done: true, commit: '9e41b07' }],
    tests: [{ id: 'tc1', tc: 'TC-004', name: 'five failures raise', status: 'passed', type: 'unit', file: 'tests/test_rules.py', covers: 'services/detection/rules_engine.py' }],
  });
  make('r2', 'REQ-021', 'Alert enrichment', [['Adds asset owner', true], ['Adds blast radius', false]], { node: node('n2', 'Enrichment API', 'fastapi') });
  make('r3', 'REQ-022', 'Enrichment latency budget', [['p95 under 400ms', false]]);
  make('r4', 'REQ-018', 'Incident timeline export', [['Exports CSV', true]], { confirmed: true });

  const outcome = (id: string, name: string, stepIds: string[], reqs: string[], x: { settled?: boolean; agent?: boolean; description?: string } = {}): Outcome => ({
    id, name, description: x.description ?? null, category: null, kind: 'outcome', key: id, status: x.settled ? 'accepted' : 'pending', node_id: null, criteria: [{ text: 'drafted' }],
    requirement_row_id: reqs[0] ?? null, workflow_id: 'wf-ir', workflowId: 'wf-ir', stepIds, live: false, promoted: reqs.length > 0, reqRef: reqs[0] ? band.get(reqs[0])!.ref : null,
    derivations: reqs.map((r, i) => ({ id: `d-${id}-${i}`, requirementRowId: r, reqRef: band.get(r)!.ref, criteriaIds: [], proposedByKind: x.agent ? 'agent' as const : 'human' as const, createdAt: '2026-09-12T10:00:00Z' })),
    claimed: {}, reqRefs: reqs.map((r) => band.get(r)!.ref), settled: !!x.settled, serves: [],
  });
  const outcomes: Outcome[] = [
    outcome('o1', 'A suspicious sign-in raises an alert inside 60 seconds', ['s0'], ['r1'], { settled: true }),
    outcome('o2', 'An analyst sees severity and blast radius on one screen', ['s1'], ['r2', 'r3'], { agent: true }),
    outcome('o4', 'The root cause is removed and proven gone', ['s3'], []),
    outcome('o5', 'A timeline lands in the incident record automatically', ['s4', 'p2'], ['r4'], { description: 'Derived from the CI job names at import.' }),
    outcome('o9', 'A draft an agent filed on no stage', [], []),
    { ...outcome('imp', 'An imported api candidate', ['s2'], []), kind: 'api' },
  ];
  const constraints: ConstraintRow[] = [
    { id: 'k1', ctype: 'security', title: 'Alerts route through the existing SIEM', description: 'Nothing pages a human directly.', rationale: 'The SOC reads one queue.', author: 'Ana Kohl', workflow_id: 'wf-ir' },
    { id: 'k2', ctype: 'technology', title: 'Python 3.12 on every service', description: 'Python 3.12 on every service', rationale: null, author: null, workflow_id: null },
    { id: 'k3', ctype: 'technology', title: null, description: 'PostgreSQL is the only primary store', rationale: null, author: null, workflow_id: null },
  ];
  return { lanes, outcomes, band, chains, constraints, graph, req };
}

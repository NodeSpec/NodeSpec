// AL.29 (owner 2026-10-09): the test-case statements in a plan are the agent's.
// They are kept with their criterion through every regeneration, on the read path
// and at the push gate, whatever renumbers the positional AC ids; statements whose
// criterion was reworded or removed are kept for review, never dropped. R1: a test
// plan carries no project vision, so the file in git and NodeSpec's copy agree.
import {
  generateTestDocument,
  computeTestContextFingerprint,
  carryAgentPlanContent,
  keepAgentStatements,
  planStatements,
  STATEMENTS_TO_REVIEW_HEADING,
} from '../_shared/test-document-generator.ts';
import { ensureTestDocumentForRequirement } from '../_shared/mcp-context-assembly.ts';
import { refreshTaskPackets } from '../_shared/packet-freshness.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const N1 = '33333333-3333-4333-8333-333333333333';
const TP = '66666666-6666-4666-8666-666666666666';
const MAPPED = [{ nodeId: N1, label: 'Store', role: 'database', technology: 'postgresql' }];
// deno-lint-ignore no-explicit-any
const CATALOGS: any = { nodeRoles: {}, technologies: {}, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} };

const C0 = 'backups are encrypted at rest';
const C1 = 'a nightly backup is taken';
const C2 = 'a backup restores into an empty database';
const C2B = 'a backup restores into an empty database within one hour';
const CM = 'an operator restored a backup by hand';

type Crit = { text: string; verification?: 'manual' };
// deno-lint-ignore no-explicit-any
const req = (criteria: Crit[]): any => ({
  requirementId: 'REQ-003', name: 'Back up tasks', description: 'Backed up and restorable',
  category: 'functional', status: 'pending', acceptanceCriteria: criteria.map((c) => ({ ...c, met: false })),
});
// deno-lint-ignore no-explicit-any
function graph(): any {
  return { nodes: { [N1]: { id: N1, label: 'Store', type: 'database', technology: 'postgresql', ports: [], artifacts: [] } }, edges: {}, contracts: {}, artifacts: {} };
}
const gen = (criteria: Crit[]) => generateTestDocument({ requirement: req(criteria), graph: graph(), catalogs: CATALOGS, mappedNodes: MAPPED as never, sourceArtifacts: [] });

/** The plan with lines added under the scenario heading for `acId` (after its derived line). */
function under(plan: string, acId: string, lines: string[]): string {
  const all = plan.split('\n');
  const at = all.findIndex((l) => l.startsWith(`#### ${acId}:`));
  if (at < 0) throw new Error(`no heading ${acId}`);
  let end = at + 1;
  while (end < all.length && all[end].trim() !== '' && !all[end].startsWith('#')) end++;
  all.splice(end, 0, ...lines);
  return all.join('\n');
}
/** The plan with indented lines added under the manual item for `acId`. */
function underManual(plan: string, acId: string, lines: string[]): string {
  const all = plan.split('\n');
  const at = all.findIndex((l) => l.startsWith(`- [ ] ${acId} `));
  if (at < 0) throw new Error(`no manual item ${acId}`);
  all.splice(at + 1, 0, ...lines.map((l) => `  ${l}`));
  return all.join('\n');
}
/** The lines under a scenario heading, to the next heading. */
function block(plan: string, acId: string): string[] {
  const all = plan.split('\n');
  const at = all.findIndex((l) => l.startsWith(`#### ${acId}:`));
  if (at < 0) return [];
  const out: string[] = [];
  for (let i = at + 1; i < all.length && !all[i].startsWith('#'); i++) out.push(all[i]);
  return out;
}

const S1 = '- [ ] Given the 02:00 job ran, when the bucket is listed, then a dump dated today is present';
const S2 = '- [ ] Given an empty database, when the newest dump is restored, then the tasks table holds every row';
const SM = '- [ ] Restore the newest dump into a scratch database and count the tasks rows';

Deno.test('AL.29: the generator writes no checkbox line where statements go, so none is mistaken for the agent\'s', () => {
  const plan = gen([{ text: C1 }, { text: CM, verification: 'manual' }]);
  assertEquals(planStatements(plan).byText.size, 0);
  assertEquals(planStatements(plan).review.length, 0);
  assertEquals(keepAgentStatements(gen([{ text: C1 }]), plan), gen([{ text: C1 }]), 'nothing to keep: the generated plan is returned as is');
});

Deno.test('AL.29: a criterion inserted first renumbers the test cases; each statement stays with its criterion', () => {
  const stored = under(under(gen([{ text: C1 }, { text: C2 }]), 'AC-REQ-003-1', [S1]), 'AC-REQ-003-2', [S2]);
  const next = carryAgentPlanContent(gen([{ text: C0 }, { text: C1 }, { text: C2 }]), stored);
  assert(!block(next, 'AC-REQ-003-1').includes(S1), 'the new first criterion has none');
  assert(block(next, 'AC-REQ-003-2').includes(S1), 'C1 is now AC-REQ-003-2, and its statement went with it');
  assert(block(next, 'AC-REQ-003-3').includes(S2), 'C2 is now AC-REQ-003-3');
  assert(!next.includes(STATEMENTS_TO_REVIEW_HEADING), 'nothing to review');
});

Deno.test('AL.29: a reworded criterion keeps its statements under "Statements to review", never dropped', () => {
  const stored = under(under(gen([{ text: C1 }, { text: C2 }]), 'AC-REQ-003-1', [S1]), 'AC-REQ-003-2', [S2]);
  const next = carryAgentPlanContent(gen([{ text: C1 }, { text: C2B }]), stored);
  assert(block(next, 'AC-REQ-003-1').includes(S1), 'the unchanged criterion keeps its statement in place');
  assert(!block(next, 'AC-REQ-003-2').includes(S2), 'the reworded one does not silently carry the old statement');
  const review = next.slice(next.indexOf(STATEMENTS_TO_REVIEW_HEADING));
  assert(review.includes(`Written for: "${C2}"`) && review.includes(S2), 'kept for review, naming what it was written for');
  assert(next.indexOf(STATEMENTS_TO_REVIEW_HEADING) < next.indexOf('## Test Strategy'), 'inside Automated Test Scenarios');
});

Deno.test('AL.29: carrying is byte-stable: twice is once, and the review block never duplicates', () => {
  const stored = under(under(gen([{ text: C1 }, { text: C2 }]), 'AC-REQ-003-1', [S1]), 'AC-REQ-003-2', [S2]);
  const generated = gen([{ text: C1 }, { text: C2B }]);
  const once = carryAgentPlanContent(generated, stored);
  const twice = carryAgentPlanContent(generated, once);
  assertEquals(twice, once, 'regenerating the carried plan with no change gives the same bytes');
  assertEquals(once.split(S2).length - 1, 1, 'the review statement appears once');
  // A later change adds a second orphan; the first stays, once.
  const later = carryAgentPlanContent(gen([{ text: C2B }]), once);
  assertEquals(later.split(S2).length - 1, 1);
  assert(later.includes(`Written for: "${C1}"`) && later.includes(S1), 'the newly orphaned statement joins the review');
  // And with no change at all the plan is exactly what was stored.
  const plain = under(gen([{ text: C1 }]), 'AC-REQ-003-1', [S1]);
  assertEquals(carryAgentPlanContent(gen([{ text: C1 }]), plain), plain);
});

Deno.test('AL.29: a manual criterion keeps its indented check; a criterion moved to manual takes its statements along', () => {
  const stored = underManual(under(gen([{ text: C1 }, { text: CM, verification: 'manual' }]), 'AC-REQ-003-1', [S1]), 'AC-REQ-003-2', [SM]);
  const same = carryAgentPlanContent(gen([{ text: C1 }, { text: CM, verification: 'manual' }]), stored);
  assertEquals(same, stored, 'kept in place, byte for byte');
  const moved = carryAgentPlanContent(gen([{ text: C1, verification: 'manual' }, { text: CM, verification: 'manual' }]), stored);
  const manual = moved.slice(moved.indexOf('## Manual Verification'), moved.indexOf('## Test Strategy'));
  assert(manual.includes(`  ${S1}`), 'C1 is manual now: its statement sits under its manual item, indented');
  assert(manual.includes(`  ${SM}`));
});

Deno.test('AL.29: the Test Strategy body and the statements are both carried', () => {
  const stored = under(gen([{ text: C1 }]), 'AC-REQ-003-1', [S1]).replace('- [ ] Define test data fixtures', '- [ ] MY FIXTURE PLAN');
  const next = carryAgentPlanContent(gen([{ text: C0 }, { text: C1 }]), stored);
  assert(next.includes('- [ ] MY FIXTURE PLAN'));
  assert(block(next, 'AC-REQ-003-2').includes(S1));
});

Deno.test('AL.29: the read path regenerates a stale plan with its statements and names the stored plan', () => {
  const g = graph();
  const oldReq = req([{ text: C1 }]);
  g.artifacts[TP] = {
    id: TP, nodeId: N1, kind: 'test-plan', path: '.nodespec/tests/req-003.tests.md',
    content: under(gen([{ text: C1 }]), 'AC-REQ-003-1', [S1]),
    metadata: { testContextFingerprint: computeTestContextFingerprint(oldReq, MAPPED as never, [], g, CATALOGS), requirementId: 'REQ-003' },
  };
  const r = ensureTestDocumentForRequirement(g, CATALOGS, { ...req([{ text: C0 }, { text: C1 }]), rowId: 'row-3' }, [N1]);
  assertEquals(r.refreshed, true);
  assertEquals(r.storedArtifactId, TP);
  assert(block(String(r.rawContent), 'AC-REQ-003-2').includes(S1), 'the statement followed C1 to AC-REQ-003-2');
});

// deno-lint-ignore no-explicit-any
function scriptGate(sb: FakeSupabase, criteria: Crit[], vision: string | null) {
  for (const t of ['node_roles', 'technology_catalog', 'deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) {
    sb.script(t, 'select', { data: [], error: null });
  }
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision }, error: null });
  sb.script('specification_mappings', 'select', { data: [{ requirement_id: 'row-3', node_id: N1 }], error: null });
  sb.script('specification_requirements', 'select', {
    data: [{ id: 'row-3', requirement_id: 'REQ-003', name: 'Back up tasks', description: 'Backed up and restorable', category: 'functional', status: 'pending', acceptance_criteria: criteria.map((c) => ({ ...c, met: false })) }],
    error: null,
  });
}

Deno.test('AL.29 R1: with a project vision set, the push gate leaves a plan made without one as it is', async () => {
  const sb = new FakeSupabase();
  const criteria = [{ text: C1 }];
  scriptGate(sb, criteria, 'Tasks for small teams. Nothing else.');
  const g = graph();
  const stored = under(gen(criteria), 'AC-REQ-003-1', [S1]);
  g.artifacts[TP] = {
    id: TP, nodeId: N1, kind: 'test-plan', path: '.nodespec/tests/req-003.tests.md', content: stored,
    metadata: { testContextFingerprint: computeTestContextFingerprint(req(criteria), MAPPED as never, [], g, CATALOGS), requirementId: 'REQ-003' },
  };
  const r = await refreshTaskPackets(sb as never, 'proj-1', g);
  assertEquals(r.testPlansChecked, 1);
  assertEquals(r.testPlansRefreshed, 0, 'the vision is not a plan input: the file git gets is the stored copy');
  assertEquals(g.artifacts[TP].content, stored);
  assert(!g.artifacts[TP].content.includes('## Project Context'));
});

Deno.test('AL.29: the push gate regenerates a stale plan with its statements kept', async () => {
  const sb = new FakeSupabase();
  const oldCriteria = [{ text: C1 }];
  const newCriteria = [{ text: C0 }, { text: C1 }];
  scriptGate(sb, newCriteria, null);
  const g = graph();
  g.artifacts[TP] = {
    id: TP, nodeId: N1, kind: 'test-plan', path: '.nodespec/tests/req-003.tests.md',
    content: under(gen(oldCriteria), 'AC-REQ-003-1', [S1]),
    metadata: { testContextFingerprint: computeTestContextFingerprint(req(oldCriteria), MAPPED as never, [], g, CATALOGS), requirementId: 'REQ-003' },
  };
  const r = await refreshTaskPackets(sb as never, 'proj-1', g);
  assertEquals(r.testPlansRefreshed, 1);
  assert(g.artifacts[TP].content.includes(C0), 'regenerated from the current criteria');
  assert(block(g.artifacts[TP].content, 'AC-REQ-003-2').includes(S1), 'and the statement followed its criterion');
});

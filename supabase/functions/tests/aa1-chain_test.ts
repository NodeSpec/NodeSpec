// AA.1 (owner 2026-09-23): every link has downstream provenance.
//
// The vision splits into sentences with stable ids; an outcome cites the
// sentence or sentences it serves (evidence.serves, resolved at propose and
// at apply against the vision as it then is); readiness reports the chain by
// plan in its own block (vision, off-vision, origin, no-step; unserved is
// advisory; constraints are only ever a note); nothing else waits on it.
import { visionSentences, visionSentenceId, resolveServes, servesOf, normalizeVisionSentence } from '../_shared/vision-sentences.ts';
import { chainReport, citeVision, inChain, CHAIN_ITEM_CAP, NO_CONSTRAINTS_NOTE, type ChainOutcome } from '../_shared/chain.ts';
import { SpecPatchOperationSchema } from '../_shared/spec-patch-schema.ts';
import { applySpecPatch } from '../mcp-server/tools/spec-patch-apply.ts';
import { handleProposePatches } from '../mcp-server/tools/proposals.ts';
import { handleGetBuildReadiness } from '../mcp-server/tools/tasks.ts';
import { assembleOutcomeBoard } from '../mcp-server/tools/outcome-board.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals, completeRole } from './helpers.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const CAND = '55555555-5555-4555-8555-555555555555';
const AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write', 'propose'] } as AuthResult;
// AL.6: a key that may only propose files and waits at any level; these pin filing, not autonomy.
const FILER = { ...AUTH, scopes: ['read', 'propose'] } as AuthResult;
const INDIE = { plan_name: 'indie', status: 'active' };

const VISION = `# Shelfie

Shelfie helps independent bookshops sell online. Every order ships within two days!
- Owners see stock across branches.
- Owners see stock across branches.
`;

// deno-lint-ignore no-explicit-any
const spec = (type: string, payload: Record<string, unknown>): any => {
  const parsed = SpecPatchOperationSchema.safeParse({
    type,
    metadata: { id: crypto.randomUUID(), actorType: 'ai', actorId: 'claude · bench', summary: 'bench', timestamp: new Date().toISOString() },
    payload,
  });
  if (!parsed.success) throw new Error(`fixture does not parse: ${parsed.error.message}`);
  return parsed.data;
};

// ── the sentences ───────────────────────────────────────────────────────────

Deno.test('AA.1 sentences: headings skipped, list markers dropped, a line splits at a sentence end, repeats collapse', () => {
  const s = visionSentences(VISION);
  assertEquals(s.map((x) => x.text), [
    'Shelfie helps independent bookshops sell online.',
    'Every order ships within two days!',
    'Owners see stock across branches.',
  ]);
  assert(s.every((x) => /^v:[0-9a-f]{8}$/.test(x.id)));
  assertEquals(visionSentences(''), []);
  assertEquals(visionSentences(null), []);
  assertEquals(visionSentences('We ship e.g. books and maps. Fast.').map((x) => x.text), ['We ship e.g. books and maps.', 'Fast.'], 'a lower-case word after a period is not a new sentence');
});

Deno.test('AA.1 ids: case, spacing, emphasis and trailing punctuation keep the id; rewording makes a new sentence', () => {
  const id = visionSentenceId('Every order ships within two days!');
  assertEquals(visionSentenceId('every  order ships **within** two days'), id);
  assertEquals(visionSentenceId('Every order ships within two days.'), id);
  assert(visionSentenceId('Every order ships within three days') !== id, 'reworded');
  assertEquals(normalizeVisionSentence('  Owners *see* stock!  '), 'owners see stock');
});

Deno.test('AA.1 resolve: by id or by words, in the order given, repeats collapse, the rest named as unknown', () => {
  const s = visionSentences(VISION);
  const r = resolveServes([s[2].id, 'every order ships within two days', s[2].id, 'Customers get refunds'], s);
  assertEquals(r.served.map((x) => x.text), ['Owners see stock across branches.', 'Every order ships within two days!']);
  assertEquals(r.unknown, ['Customers get refunds']);
  assertEquals(servesOf({ serves: [{ id: s[0].id, text: s[0].text }, 'v:0000abcd', 42] }).map((x) => x.id), [s[0].id, 'v:0000abcd']);
  assertEquals(servesOf({ route: '/x' }), [], 'import evidence with no citation');
  assertEquals(servesOf(null), []);
});

Deno.test('AA.1 cite: no vision, an unknown sentence and a known one', () => {
  const none = citeVision('create_candidate', ['anything'], '');
  assert('error' in none && none.error === 'create_candidate refused: the project has no vision to cite yet. Put an update_vision earlier in the same proposal, then cite its sentences.');
  const bad = citeVision('update_candidate', ['Customers get refunds'], VISION);
  assert('error' in bad && bad.error === 'update_candidate refused: "Customers get refunds" is not a sentence of the current vision. get_outcome_board lists the vision\'s sentences with their ids.', JSON.stringify(bad));
  const good = citeVision('create_candidate', ['Owners see stock across branches'], VISION);
  assert('served' in good && good.served.length === 1);
});

// ── the chain, pure ─────────────────────────────────────────────────────────

const S = visionSentences(VISION);
const outcome = (over: Partial<ChainOutcome>): ChainOutcome => ({
  id: 'o1', key: 'outcome:o1', name: 'Orders ship fast', kind: 'outcome', status: 'pending', mark: null,
  serves: [S[1]], derived: 1, onStep: true, ...over,
});

Deno.test('AA.1 chain: an empty vision is the one vision blocker (off-vision waits for a vision to cite)', () => {
  const r = chainReport({ vision: '', workflows: false, outcomes: [outcome({ serves: [] })], requirements: [], constraintsRecorded: 2 });
  assertEquals(r.blockers.map((g) => g.kind), ['vision']);
  assertEquals(r.blockers[0].detail, 'The project has no vision. Outcomes cite its sentences, so it comes first.');
  assertEquals(r.ready, false);
  assertEquals(r.notes, []);
});

Deno.test('AA.1 chain: a cited vision is ready; the sentences no outcome serves are advisory', () => {
  const r = chainReport({
    vision: VISION, workflows: false, outcomes: [outcome({})],
    requirements: [{ requirementId: 'REQ-001', name: 'Two-day shipping', mark: null, hasOrigin: true }], constraintsRecorded: 1,
  });
  assertEquals(r.ready, true);
  assertEquals(r.blockers, []);
  assertEquals(r.advisories.map((g) => [g.kind, g.detail, g.items!.map((i) => i.id)]), [['unserved', '2 vision sentences are served by no outcome.', [S[0].id, S[2].id]]]);
  assertEquals(r.counts, { visionSentences: 3, sentencesServed: 1, outcomes: 1, outcomesCitingVision: 1, requirements: 1, requirementsWithOrigin: 1 });
});

Deno.test('AA.1 chain: an outcome citing nothing, or a sentence the vision lost, is off vision and says what it cited', () => {
  const lost = { id: visionSentenceId('Every order ships within three days'), text: 'Every order ships within three days' };
  const r = chainReport({
    vision: VISION, workflows: false,
    outcomes: [outcome({ id: 'o1', serves: [lost] }), outcome({ id: 'o2', name: 'Stock view', serves: [] }), outcome({ id: 'o3', serves: [S[0]] })],
    requirements: [], constraintsRecorded: 1,
  });
  const off = r.blockers.find((g) => g.kind === 'off-vision')!;
  assertEquals(off.detail, '2 outcomes cite no sentence of the current vision. 1 of them cites a sentence the vision no longer has (`was` holds the words it cited).');
  assertEquals(off.items, [{ id: 'o1', label: 'Orders ship fast', mark: null, was: 'Every order ships within three days' }, { id: 'o2', label: 'Stock view', mark: null }]);
  assert(!r.blockers.some((g) => g.kind === 'vision'), 'one outcome cites it, so the vision is cited');
});

Deno.test('AA.1 chain: an import-born candidate is evidence until it derives a requirement, then a link', () => {
  assertEquals(inChain({ kind: 'api', derived: 0 }), false);
  assertEquals(inChain({ kind: 'api', derived: 1 }), true);
  assertEquals(inChain({ kind: 'outcome', derived: 0 }), true);
  const r = chainReport({ vision: VISION, workflows: false, outcomes: [outcome({}), outcome({ id: 'imp', kind: 'api', serves: [], derived: 0 })], requirements: [], constraintsRecorded: 1 });
  assertEquals(r.counts.outcomes, 1);
  assert(!r.blockers.some((g) => g.kind === 'off-vision'));
});

Deno.test('AA.1 chain: a requirement with no outcome is origin; marks ride the items so the boundary withholds them', () => {
  const r = chainReport({
    vision: VISION, workflows: false, outcomes: [outcome({})],
    requirements: [
      { requirementId: 'REQ-001', name: 'Two-day shipping', mark: null, hasOrigin: true },
      { requirementId: 'REQ-002', name: 'Enclave audit', mark: 'CUI', hasOrigin: false },
    ],
    constraintsRecorded: 1,
  });
  assertEquals(r.blockers.map((g) => [g.kind, g.detail, g.items]), [['origin', '1 requirement derives from no outcome.', [{ id: 'REQ-002', label: 'Enclave audit', mark: 'CUI' }]]]);
});

Deno.test('AA.1 chain: no-step is a gap only on a plan with Workflows, and only for a pending outcome', () => {
  const outs = [outcome({ id: 'o1', onStep: false }), outcome({ id: 'o2', onStep: false, status: 'accepted' }), outcome({ id: 'o3' })];
  const community = chainReport({ vision: VISION, workflows: false, outcomes: outs, requirements: [], constraintsRecorded: 1 });
  assert(!community.blockers.some((g) => g.kind === 'no-step'), 'Community carries no Workflows');
  const indie = chainReport({ vision: VISION, workflows: true, outcomes: outs, requirements: [], constraintsRecorded: 1 });
  assertEquals(indie.blockers.filter((g) => g.kind === 'no-step').map((g) => g.items!.map((i) => i.id)), [['o1']], 'a settled outcome keeps the steps it was filed on');
});

Deno.test('AA.1 chain: constraints are notes, never gaps; items cap and count the rest', () => {
  const none = chainReport({ vision: VISION, workflows: false, outcomes: [outcome({})], requirements: [], constraintsRecorded: 0, unreachedConstraints: [] });
  assertEquals(none.notes, [NO_CONSTRAINTS_NOTE]);
  assertEquals(none.ready, true, 'a note never holds the chain');
  const unreached = chainReport({ vision: VISION, workflows: false, outcomes: [outcome({})], requirements: [], constraintsRecorded: 3, unreachedConstraints: ['c:1a2b3c4d'] });
  assertEquals(unreached.notes, ['Constraint c:1a2b3c4d reaches no node yet: no requirement mapped to a node derives from an outcome on its workflow.']);
  const many = Array.from({ length: CHAIN_ITEM_CAP + 3 }, (_, i) => ({ requirementId: `REQ-${i}`, name: `R${i}`, mark: null, hasOrigin: false }));
  const capped = chainReport({ vision: VISION, workflows: false, outcomes: [outcome({})], requirements: many, constraintsRecorded: 1 });
  const g = capped.blockers.find((x) => x.kind === 'origin')!;
  assertEquals([g.items!.length, g.more], [CHAIN_ITEM_CAP, 3]);
});

// ── the write side: create_candidate and update_candidate ──────────────────

Deno.test('AA.1 apply create_candidate: serves resolves against the current vision and lands in evidence; none files with the note', async () => {
  const sb = new FakeSupabase();
  sb.script('project_specifications', 'select', { data: { vision: VISION }, error: null });
  sb.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:1' }, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT, spec('create_candidate', { branchId: BRANCH, name: 'Orders ship fast', serves: ['every order ships within two days'] }));
  assertEquals(r.applied, true, JSON.stringify(r));
  const row = sb.callsTo('requirement_candidates', 'insert')[0].payload as { evidence: { serves: Array<{ id: string; text: string }> } };
  assertEquals(row.evidence.serves, [{ id: S[1].id, text: 'Every order ships within two days!' }]);
  assertEquals((r as { result: { serves: string[] } }).result.serves, [S[1].id]);

  const plain = new FakeSupabase();
  plain.script('requirement_candidates', 'insert', { data: { id: CAND, key: 'outcome:2' }, error: null });
  const p = await applySpecPatch(plain as never, AUTH, PROJECT, spec('create_candidate', { branchId: BRANCH, name: 'Stock view' }));
  assertEquals(p.applied, true);
  assert(String((p as { result: { offVision: string } }).result.offVision).startsWith('This outcome cites no vision sentence'));
  assertEquals(plain.callsTo('project_specifications').length, 0, 'no citation, no vision read');
  // no citation, so no serves; AL.7: the agent that filed it is still kept
  assertEquals((plain.callsTo('requirement_candidates', 'insert')[0].payload as { evidence?: unknown }).evidence, { filedBy: { credential: 'key:k1', agent: 'claude · bench' } });
});

Deno.test('AA.1 apply create_candidate: a sentence the vision does not have refuses before any insert', async () => {
  const sb = new FakeSupabase();
  sb.script('project_specifications', 'select', { data: { vision: VISION }, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT, spec('create_candidate', { branchId: BRANCH, name: 'Refunds', serves: ['Customers get refunds'] }));
  assertEquals(r.applied, false);
  assertEquals(sb.callsTo('requirement_candidates', 'insert').length, 0);
});

const row = (status: string) => ({
  id: CAND, project_id: PROJECT, branch_id: BRANCH, node_id: null, key: 'api:n1:orders', kind: 'api', name: 'Orders API',
  description: '', category: 'functional', criteria: [], status, requirement_row_id: null, evidence: { route: '/orders' },
});

Deno.test('AA.1 apply update_candidate: a settled outcome takes serves and nothing else; evidence keeps what the import found', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', { data: row('accepted'), error: null });
  sb.script('project_specifications', 'select', { data: { vision: VISION }, error: null });
  sb.script('requirement_candidates', 'update', { data: null, error: null });
  const r = await applySpecPatch(sb as never, AUTH, PROJECT, spec('update_candidate', { candidateId: CAND, changes: { serves: [S[0].id] } }));
  assertEquals(r.applied, true, JSON.stringify(r));
  const written = sb.callsTo('requirement_candidates', 'update')[0].payload as { evidence: Record<string, unknown>; name?: string };
  assertEquals(written.evidence, { route: '/orders', serves: [{ id: S[0].id, text: S[0].text }] });

  const renamed = new FakeSupabase();
  renamed.script('requirement_candidates', 'select', { data: row('accepted'), error: null });
  const n = await applySpecPatch(renamed as never, AUTH, PROJECT, spec('update_candidate', { candidateId: CAND, changes: { name: 'Orders', serves: [S[0].id] } }));
  assertEquals(n.applied, false);
  assert(String((n as { error: string }).error).endsWith('A settled outcome takes one change: serves.'));

  const dismissed = new FakeSupabase();
  dismissed.script('requirement_candidates', 'select', { data: row('dismissed'), error: null });
  const d = await applySpecPatch(dismissed as never, AUTH, PROJECT, spec('update_candidate', { candidateId: CAND, changes: { serves: [S[0].id] } }));
  assertEquals(d.applied, false, 'dismissed is terminal');
});

// ── propose: resolved before anything is filed ─────────────────────────────

function scriptProposal(sb: FakeSupabase) {
  sb.script('projects', 'select', { data: { id: PROJECT, name: 'Demo' }, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('projects', 'select', { data: null, error: null }); // the policy read
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
}

Deno.test('AA.1 propose: a citation the stored vision lacks refuses the batch by name; the batch\'s own update_vision counts', async () => {
  const bad = new FakeSupabase();
  scriptProposal(bad);
  bad.script('project_specifications', 'select', { data: { vision: VISION }, error: null });
  const r = await handleProposePatches(bad as never, FILER, {
    project_id: PROJECT, branch_id: BRANCH,
    patches: [{ type: 'create_candidate', payload: { branchId: BRANCH, name: 'Refunds', serves: ['Customers get refunds'] } }],
  });
  assertEquals(r.success, false);
  assertEquals(String(r.error), 'patch[0] create_candidate: create_candidate refused: "Customers get refunds" is not a sentence of the current vision. get_outcome_board lists the vision\'s sentences with their ids. Nothing was created.');
  assertEquals(bad.callsTo('ai_proposals', 'insert').length, 0);

  const withVision = new FakeSupabase();
  scriptProposal(withVision);
  const ok = await handleProposePatches(withVision as never, FILER, {
    project_id: PROJECT, branch_id: BRANCH,
    patches: [
      { type: 'update_vision', payload: { vision: 'Customers get refunds within a day.' } },
      { type: 'create_candidate', payload: { branchId: BRANCH, name: 'Refunds', serves: ['Customers get refunds within a day'] } },
      { type: 'create_candidate', payload: { branchId: BRANCH, name: 'Receipts' } },
    ],
  });
  assertEquals(ok.success, true, JSON.stringify(ok));
  assertEquals(withVision.callsTo('project_specifications').filter((c) => c.payload === 'vision').length, 0, 'the batch carries its vision; the stored one is not read');
  assertEquals((ok.data as { warnings: string[] }).warnings, ['patch[2] create_candidate: This outcome cites no vision sentence, so get_build_readiness reports it as off vision until it does: update_candidate with serves.']);
});

// ── readiness and the board ────────────────────────────────────────────────

const N_API = '33333333-3333-4333-8333-333333333333';
const REQ_ROW = '77777777-7777-4777-8777-777777777777';

function scriptReadiness(sb: FakeSupabase, plan: Record<string, string> | null) {
  sb.script('projects', 'select', { data: { id: PROJECT, name: 'Bench' }, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { nodes: { [N_API]: { id: N_API, type: 'backend-service', label: 'API', technology: 'express', ports: [] } }, edges: {}, contracts: {}, artifacts: {} } }, error: null });
  sb.script('node_roles', 'select', { data: [{ id: 'backend-service', kind: 'app_service', is_container: false, treatment_mode: 'leaf' }].map(completeRole), error: null });
  sb.script('technology_catalog', 'select', { data: [{ id: 'express', name: 'Express', role_affinities: ['backend-service'], ai_context: {} }], error: null });
  for (const t of ['deployment_targets', 'legacy_type_mappings', 'cloud_provider_patterns', 'scope_archetypes']) sb.script(t, 'select', { data: [], error: null });
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', vision: VISION }, error: null });
  sb.script('specification_mappings', 'select', { data: [{ requirement_id: REQ_ROW, node_id: N_API }], error: null });
  sb.script('specification_requirements', 'select', { data: [{ id: REQ_ROW, requirement_id: 'REQ-001', name: 'Two-day shipping', description: 'd', category: 'functional', status: 'pending', acceptance_criteria: [] }], error: null });
  // AC: the constraints are read where the owner's plan carries them
  sb.script('projects', 'select', { data: { owner_id: 'owner-1' }, error: null });
  if (plan) sb.script('stripe_subscriptions', 'select', { data: plan, error: null });
  sb.script('project_constraints', 'select', { data: [], error: null });
  sb.script('requirement_candidates', 'select', { count: 0, data: null, error: null }); // candidatesOpen
  if (plan) sb.script('stripe_subscriptions', 'select', { data: plan, error: null });
  sb.script('requirement_candidates', 'select', { data: [
    { id: 'o1', key: 'outcome:o1', kind: 'outcome', name: 'Orders ship fast', status: 'pending', evidence: { serves: [{ id: S[1].id, text: S[1].text }] }, mark: null },
    { id: 'o2', key: 'outcome:o2', kind: 'outcome', name: 'Stock view', status: 'pending', evidence: {}, mark: null },
  ], error: null });
  sb.script('outcome_derivations', 'select', { data: [{ candidate_id: 'o1', requirement_row_id: REQ_ROW }], error: null });
  sb.script('specification_requirements', 'select', { data: [
    { id: REQ_ROW, requirement_id: 'REQ-001', name: 'Two-day shipping', mark: null, archived_at: null },
    { id: 'r2', requirement_id: 'REQ-002', name: 'Old one', mark: null, archived_at: '2026-09-01T00:00:00Z' },
  ], error: null });
  sb.script('outcome_step_maps', 'select', { data: [{ candidate_id: 'o1' }], error: null });
}

Deno.test('AA.1 readiness: the chain block on Indie, items wrapped at full detail, counts only at summary; nodes untouched by it', async () => {
  const sb = new FakeSupabase();
  scriptReadiness(sb, INDIE);
  const r = await handleGetBuildReadiness(sb as never, AUTH, { project_id: PROJECT, branch_id: BRANCH, detail: 'full' });
  assertEquals(r.success, true, JSON.stringify(r).slice(0, 400));
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.chain.blockers.map((g: { kind: string }) => g.kind), ['off-vision', 'no-step']);
  assertEquals(data.chain.blockers[0].items, [{ id: 'o2', label: '<untrusted-data>Stock view</untrusted-data>' }]);
  assertEquals(data.chain.advisories.map((g: { kind: string; count: number }) => [g.kind, g.count]), [['unserved', 2]]);
  assertEquals(data.chain.notes, [NO_CONSTRAINTS_NOTE]);
  assertEquals(data.chain.counts.requirements, 1, 'an archived requirement is out of the chain');
  assert(data.remediations['off-vision'].includes('update_candidate') && data.remediations['no-step'].includes('set_outcome_step_maps'));
  assert(typeof data.untrustedDataAdvisory === 'string');
  for (const n of data.nodes) for (const g of [...n.blockers, ...n.advisories]) assert(!['vision', 'off-vision', 'origin', 'no-step'].includes(g.kind), 'a chain gap never lands on a node');
  assert(String(data.message).includes('The chain from vision to requirements has 2 blocking gaps (off-vision, no-step)'), data.message);

  const summary = new FakeSupabase();
  scriptReadiness(summary, INDIE);
  const s = await handleGetBuildReadiness(summary as never, AUTH, { project_id: PROJECT, branch_id: BRANCH });
  // deno-lint-ignore no-explicit-any
  const sd = (s.data as any).chain;
  assertEquals(sd.blockers[0], { kind: 'off-vision', detail: '1 outcome cites no sentence of the current vision.', count: 1 });
});

Deno.test('AA.1 readiness: on Community no step map is read and no-step is never a gap', async () => {
  const sb = new FakeSupabase();
  scriptReadiness(sb, null);
  const r = await handleGetBuildReadiness(sb as never, AUTH, { project_id: PROJECT, branch_id: BRANCH, detail: 'full' });
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.chain.blockers.map((g: { kind: string }) => g.kind), ['off-vision']);
  assertEquals(sb.callsTo('outcome_step_maps').length, 0);
  // AC: constraints do not exist on Community: not read, and no note about them
  assertEquals(sb.callsTo('project_constraints').length, 0);
  assert(!JSON.stringify(data).toLowerCase().includes('constraint'), 'no constraint is named on Community');
});

Deno.test('AA.1 board: the vision\'s sentences with ids and counts, each outcome\'s citations with current', () => {
  const board = assembleOutcomeBoard({
    auth: AUTH,
    candidates: [
      { id: 'o1', key: 'outcome:o1', kind: 'outcome', name: 'Orders ship fast', description: null, category: null, status: 'pending', criteria: [], requirement_row_id: null, updated_at: '2026-09-23T00:00:00Z', evidence: { serves: [{ id: S[1].id, text: S[1].text }, { id: 'v:00000000', text: 'A sentence since removed' }] } },
    ],
    lanes: [], steps: [], maps: [], derivations: [], reqRefs: new Map(), holds: [], keyNames: new Map(), vision: VISION,
  });
  assertEquals(board.vision.sentences.map((v) => [v.id, v.servedBy]), [[S[0].id, 0], [S[1].id, 1], [S[2].id, 0]]);
  assertEquals(board.outcomes[0].serves.map((v) => [v.id, v.current]), [[S[1].id, true], ['v:00000000', false]]);
  assert(board.vision.sentences[0].text.startsWith('<untrusted-data>'), 'the vision is user-authored');
});

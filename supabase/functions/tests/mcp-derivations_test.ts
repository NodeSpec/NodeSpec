// V3 4b.1 (R5/R6/R7): promotion DERIVES. Pins: criterion identity (written
// ids survive, legacy text resolves to a stable hash id, a re-save keeps the
// id); a second derivation from the same outcome claims only unclaimed
// criteria, names its own requirement, leaves the frozen first link alone
// and relates to its sibling; a claimed criterion refuses by name; an
// exhausted outcome points at settle; settle needs a derivation and writes
// the terminal 'accepted'; settle rides NEVER_AUTO_APPLY; preconditions on
// promote can address a criterion by id; and the accept lane — the app's
// JWT is the human act, a key is not — records the proposal as the origin.
import {
  fnv1a32, criterionIdOf, identifyCriteria, identifiedFromRow, normalizeCriterionText,
} from '../_shared/criterion-identity.ts';
import { SpecPatchOperationSchema, NEVER_AUTO_APPLY } from '../_shared/spec-patch-schema.ts';
import { applySpecPatch } from '../mcp-server/tools/spec-patch-apply.ts';
import { checkSpecPreconditions, readPath } from '../mcp-server/tools/spec-preconditions.ts';
import { routeChange, resolveAutomationPolicy } from '../mcp-server/tools/change-router.ts';
import { handleResolveProposal } from '../mcp-server/tools/approvals.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Bench' };
const BRANCH = '22222222-2222-4222-8222-222222222222';
const CAND = '33333333-3333-4333-8333-333333333333';
const SPEC = '55555555-5555-4555-8555-555555555555';
const PROP = '66666666-6666-4666-8666-666666666666';

const KEY_AUTH = { userId: 'user-1', authMethod: 'api_key', keyId: 'k1', scopes: ['read', 'write'] } as never;
const JWT_AUTH = { userId: 'user-1', authMethod: 'jwt', scopes: ['read', 'write', 'propose'] } as never;

const meta = (extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), actorType: 'ai' as const, actorId: 'claude · bench',
  summary: 'bench patch', timestamp: new Date().toISOString(), ...extra,
});
// deno-lint-ignore no-explicit-any
const specPatch = (type: string, payload: unknown, extraMeta: Record<string, unknown> = {}): any => {
  const parsed = SpecPatchOperationSchema.safeParse({ type, metadata: meta(extraMeta), payload });
  if (!parsed.success) throw new Error(`fixture does not parse: ${type}: ${parsed.error.message}`);
  return parsed.data;
};

// An outcome with three identified criteria, one already derived into REQ-004.
const CRITERIA = [{ id: 'c1', text: 'A holds' }, { id: 'c2', text: 'B holds' }, { id: 'c3', text: 'C holds', verification: 'manual' }];
const candidate = (over: Record<string, unknown> = {}) => ({
  id: CAND, project_id: PROJECT.id, branch_id: BRANCH, node_id: null, key: 'outcome:dd44', kind: 'outcome',
  name: 'Tenants export their data', description: 'On demand.', category: 'functional',
  criteria: CRITERIA, status: 'pending', requirement_row_id: 'req-row-1', ...over,
});
const PRIOR = [{ id: 'der-1', requirement_row_id: 'req-row-1', criteria_slice: [{ id: 'c1', text: 'A holds' }] }];

function scriptSecondDerivation(sb: FakeSupabase) {
  sb.script('requirement_candidates', 'select', { data: candidate(), error: null });
  sb.script('outcome_derivations', 'select', { data: PRIOR, error: null });
  sb.script('specification_requirements', 'select', { data: [{ id: 'req-row-1', requirement_id: 'REQ-004' }], error: null }); // reqRefOf
  sb.script('project_specifications', 'select', { data: { id: SPEC }, error: null });
  sb.script('specification_requirements', 'select', { data: [{ requirement_id: 'REQ-004' }], error: null }); // nextRequirementId
  sb.script('specification_requirements', 'insert', { data: { id: 'req-row-2', requirement_id: 'REQ-005' }, error: null });
  sb.script('outcome_derivations', 'insert', { data: null, error: null });
  sb.script('specification_requirement_relations', 'insert', { data: null, error: null });
}

Deno.test('criterion identity: written ids survive, legacy text hashes deterministically, a re-save keeps the id', () => {
  assertEquals(fnv1a32('A holds'), fnv1a32('A holds'));
  assert(fnv1a32('A holds') !== fnv1a32('B holds'));
  assertEquals(normalizeCriterionText('  A   holds \n'), 'A holds');
  assertEquals(criterionIdOf({ id: 'c1', text: 'A holds' }), 'c1');
  assertEquals(criterionIdOf({ text: '  A   holds ' }), `h${fnv1a32('A holds')}`);
  // write path: existing legacy criterion keeps answering to its hash id after a re-save
  const saved = identifyCriteria([{ text: 'A holds' }, 'Brand new', { id: 'keep', text: 'Kept' }, '   '], [{ text: 'A holds' }]);
  assertEquals(saved.length, 3, 'blank text drops');
  assertEquals(saved[0].id, `h${fnv1a32('A holds')}`);
  assert(/^[0-9a-f]{8}$/.test(saved[1].id), 'a new criterion mints a uuid8');
  assertEquals(saved[2].id, 'keep');
  // read path: no minting
  assertEquals(identifiedFromRow([{ text: 'x' }, { id: 'y', text: 'Y', verification: 'manual' }, { text: '' }]).map((c) => c.id), [`h${fnv1a32('x')}`, 'y']);
});

Deno.test('a second derivation claims only unclaimed criteria, names itself, keeps the first link, relates to its sibling', async () => {
  const sb = new FakeSupabase();
  scriptSecondDerivation(sb);
  const r = await applySpecPatch(sb as never, KEY_AUTH, PROJECT.id,
    specPatch('promote_candidate', { candidateId: CAND, criteriaIds: ['c2'], name: 'Export is fast', description: 'B only.' }));
  assertEquals(r.applied, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const result = (r as any).result;
  assertEquals(result.requirementId, 'REQ-005');
  assertEquals(result.claimed, 1);
  assertEquals(result.remaining, 1, 'c3 is still unclaimed');
  assertEquals(result.derivations, 2);
  // deno-lint-ignore no-explicit-any
  const ins = sb.callsTo('specification_requirements', 'insert')[0].payload as any;
  assertEquals(ins.name, 'Export is fast');
  assertEquals(ins.description, 'B only.');
  assertEquals(ins.acceptance_criteria, [{ text: 'B holds', met: false }]);
  assertEquals(ins.metadata.promotion.criterionIds, ['c2']);
  // deno-lint-ignore no-explicit-any
  const der = sb.callsTo('outcome_derivations', 'insert')[0].payload as any;
  assertEquals(der.criteria_slice, [{ id: 'c2', text: 'B holds' }]);
  assertEquals(der.requirement_row_id, 'req-row-2');
  // the first derivation's link is frozen — no candidate write at all
  assertEquals(sb.callsTo('requirement_candidates', 'update').length, 0, 'requirement_row_id is write-once; status stays pending');
  // deno-lint-ignore no-explicit-any
  const rel = sb.callsTo('specification_requirement_relations', 'insert')[0].payload as any;
  assertEquals(rel.from_requirement_id, 'req-row-2');
  assertEquals(rel.to_requirement_id, 'req-row-1');
  assertEquals(rel.relation_type, 'relates_to');
  assertEquals(rel.source, 'ai');
  assert(rel.notes.includes('outcome:dd44'));
});

Deno.test('default slice = every unclaimed criterion; a claimed id refuses by name; an unknown id refuses', async () => {
  const sb = new FakeSupabase();
  scriptSecondDerivation(sb);
  const r = await applySpecPatch(sb as never, KEY_AUTH, PROJECT.id, specPatch('promote_candidate', { candidateId: CAND }));
  assertEquals(r.applied, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  const der = sb.callsTo('outcome_derivations', 'insert')[0].payload as any;
  assertEquals(der.criteria_slice.map((c: { id: string }) => c.id), ['c2', 'c3'], 'c1 is claimed by REQ-004');
  assertEquals(der.criteria_slice[1].verification, 'manual');

  const sb2 = new FakeSupabase();
  sb2.script('requirement_candidates', 'select', { data: candidate(), error: null });
  sb2.script('outcome_derivations', 'select', { data: PRIOR, error: null });
  sb2.script('specification_requirements', 'select', { data: [{ id: 'req-row-1', requirement_id: 'REQ-004' }], error: null });
  const claimed = await applySpecPatch(sb2 as never, KEY_AUTH, PROJECT.id, specPatch('promote_candidate', { candidateId: CAND, criteriaIds: ['c1'] }));
  assertEquals(claimed.applied, false);
  assert(String((claimed as { error: string }).error).includes('"A holds" is already derived into REQ-004'), 'the refusal names the criterion and its REQ');
  assertEquals(sb2.callsTo('specification_requirements', 'insert').length, 0);

  const sb3 = new FakeSupabase();
  sb3.script('requirement_candidates', 'select', { data: candidate(), error: null });
  sb3.script('outcome_derivations', 'select', { data: PRIOR, error: null });
  sb3.script('specification_requirements', 'select', { data: [{ id: 'req-row-1', requirement_id: 'REQ-004' }], error: null });
  const unknown = await applySpecPatch(sb3 as never, KEY_AUTH, PROJECT.id, specPatch('promote_candidate', { candidateId: CAND, criteriaIds: ['nope'] }));
  assertEquals(unknown.applied, false);
  assert(String((unknown as { error: string }).error).includes('"nope" is not on'), 'unknown ids refuse loudly');
});

Deno.test('an exhausted outcome refuses and points at settle; the empty-criteria sentence is unchanged', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', { data: candidate({ criteria: [{ id: 'c1', text: 'A holds' }] }), error: null });
  sb.script('outcome_derivations', 'select', { data: PRIOR, error: null });
  sb.script('specification_requirements', 'select', { data: [{ id: 'req-row-1', requirement_id: 'REQ-004' }], error: null });
  const r = await applySpecPatch(sb as never, KEY_AUTH, PROJECT.id, specPatch('promote_candidate', { candidateId: CAND }));
  assertEquals(r.applied, false);
  const err = String((r as { error: string }).error);
  assert(err.includes('already derived (REQ-004)'), err);
  assert(err.includes('settle the outcome'), err);

  const sb2 = new FakeSupabase();
  sb2.script('requirement_candidates', 'select', { data: candidate({ criteria: [], requirement_row_id: null }), error: null });
  const empty = await applySpecPatch(sb2 as never, KEY_AUTH, PROJECT.id, specPatch('promote_candidate', { candidateId: CAND }));
  assert(String((empty as { error: string }).error).includes('has no testable outcome'), 'the app cross-pins this sentence');
});

Deno.test('settle: needs a derivation, writes the terminal accepted, and a settled outcome derives no further', async () => {
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', { data: candidate({ requirement_row_id: null }), error: null });
  sb.script('outcome_derivations', 'select', { data: [], error: null });
  const bare = await applySpecPatch(sb as never, JWT_AUTH, PROJECT.id, specPatch('settle_candidate', { candidateId: CAND }));
  assertEquals(bare.applied, false);
  assert(String((bare as { error: string }).error).includes('has derived nothing yet'));
  assertEquals(sb.callsTo('requirement_candidates', 'update').length, 0);

  const sb2 = new FakeSupabase();
  sb2.script('requirement_candidates', 'select', { data: candidate(), error: null });
  sb2.script('outcome_derivations', 'select', { data: PRIOR, error: null });
  sb2.script('requirement_candidates', 'update', { data: null, error: null });
  const ok = await applySpecPatch(sb2 as never, JWT_AUTH, PROJECT.id, specPatch('settle_candidate', { candidateId: CAND }));
  assertEquals(ok.applied, true, JSON.stringify(ok));
  // deno-lint-ignore no-explicit-any
  const upd = sb2.callsTo('requirement_candidates', 'update')[0].payload as any;
  assertEquals(upd.status, 'accepted');
  assert(!!upd.decided_at);

  const sb3 = new FakeSupabase();
  sb3.script('requirement_candidates', 'select', { data: candidate({ status: 'accepted' }), error: null });
  const after = await applySpecPatch(sb3 as never, KEY_AUTH, PROJECT.id, specPatch('promote_candidate', { candidateId: CAND }));
  assertEquals(after.applied, false);
  assert(String((after as { error: string }).error).includes('settled outcome derives no further'));

  // R6: settle rides the human-only set — the router proposes it even at auto.
  assert(NEVER_AUTO_APPLY.has('settle_candidate'));
  assertEquals(routeChange(resolveAutomationPolicy({}), 'settle_candidate'), 'propose');
  assertEquals(routeChange(resolveAutomationPolicy({}), 'promote_candidate'), 'propose');
});

Deno.test('preconditions on promote: hash_match addresses a criterion by id — a disjoint sibling never false-conflicts', async () => {
  const row = candidate() as unknown as Record<string, unknown>;
  assertEquals(readPath(row, 'criteria[id=c2].text'), 'B holds');
  assertEquals(readPath(row, `criteria[id=h${fnv1a32('A holds')}].text`), undefined, 'a written id wins over the hash form');
  assertEquals(readPath({ criteria: [{ text: 'legacy' }] }, `criteria[id=h${fnv1a32('legacy')}].text`), 'legacy', 'legacy rows answer to their hash id');

  const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const sb = new FakeSupabase();
  sb.script('requirement_candidates', 'select', { data: candidate(), error: null }); // the precondition read
  const fresh = await checkSpecPreconditions(sb as never, PROJECT.id,
    specPatch('promote_candidate', { candidateId: CAND, criteriaIds: ['c2'] }, { preconditions: [{ type: 'hash_match', path: 'criteria[id=c2].text', expected: await sha('B holds') }] }));
  assertEquals(fresh.ok, true, JSON.stringify(fresh));

  const sb2 = new FakeSupabase();
  sb2.script('requirement_candidates', 'select', { data: candidate(), error: null });
  const stale = await checkSpecPreconditions(sb2 as never, PROJECT.id,
    specPatch('promote_candidate', { candidateId: CAND, criteriaIds: ['c2'] }, { preconditions: [{ type: 'hash_match', path: 'criteria[id=c2].text', expected: await sha('B held, reworded') }] }));
  assertEquals(stale.ok, false);
  assert(String((stale as { error: string }).error).includes('criteria[id=c2].text'), 'the refusal names the id-addressed path');
});

// The accept lane: the app's JWT is the human act (R7) — it applies a
// promote proposal and the derivation records the proposal as its origin;
// an API key is a delegate and is still refused.
function prelude(sb: FakeSupabase, row: unknown) {
  sb.script('projects', 'select', { data: PROJECT, error: null });
  sb.script('ai_proposals', 'select', { data: row, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH, project_id: PROJECT.id }, error: null });
}
const promoteProposal = () => ({
  id: PROP, status: 'pending', source_branch_id: BRANCH,
  patches: [{ patch: specPatch('promote_candidate', { candidateId: CAND, criteriaIds: ['c2'] }), explanation: 'derive B', status: 'pending' }],
  metadata: { plane: 'spec', source: 'mcp-server', externalAgent: 'bench · agent-a', authMethod: 'api_key', apiKeyId: 'k1' },
});

Deno.test('resolve_proposal: the signed-in user (JWT) accepts a promotion; the derivation carries the proposal and the proposing key', async () => {
  const sb = new FakeSupabase();
  prelude(sb, promoteProposal());
  // AL.8: the batch is checked against the rows as they are now, first
  sb.script('requirement_candidates', 'select', { data: candidate(), error: null });
  sb.script('outcome_derivations', 'select', { data: PRIOR, error: null });
  scriptSecondDerivation(sb);
  sb.script('ai_proposals', 'update', { data: null, error: null });
  const r = await handleResolveProposal(sb as never, JWT_AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(r.success, true, JSON.stringify(r));
  // deno-lint-ignore no-explicit-any
  assertEquals((r.data as any).status, 'merged');
  // deno-lint-ignore no-explicit-any
  const der = sb.callsTo('outcome_derivations', 'insert')[0].payload as any;
  assertEquals(der.via_proposal_id, PROP);
  assertEquals(der.proposed_by_kind, 'agent');
  assertEquals(der.proposed_by_id, 'k1');
  assertEquals(der.approved_by, 'user-1');
  assertEquals(der.criteria_slice, [{ id: 'c2', text: 'B holds' }]);
});

Deno.test('resolve_proposal: an API key still cannot accept a promotion — a delegate cannot approve what it proposed', async () => {
  const sb = new FakeSupabase();
  prelude(sb, promoteProposal());
  const r = await handleResolveProposal(sb as never, KEY_AUTH, { project_id: PROJECT.id, proposal_id: PROP, action: 'accept' });
  assertEquals(r.success, false);
  assert(String(r.error).includes('human act'));
  assertEquals(sb.callsTo('outcome_derivations', 'insert').length, 0);
});

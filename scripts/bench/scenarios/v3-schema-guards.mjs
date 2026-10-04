// V3 P0/P1 bench rider (docs/V3_OVERHAUL_PLAN.md): the migration invariants
// that used to be manual "You test locally" bullets, automated against the
// LIVE local schema. `supabase db reset` proves the chain replays; THIS
// proves the invariants actually bite on real rows: the spec UNIQUE the
// July incident never got, the automation code-pin CHECK, the couplings
// XOR endpoints, the widened candidate kind with a NULL node, and the
// claim RPC staying closed to non-service callers.
import { rest, uid, Scenario } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

/** An insert/update expected to be REFUSED: resolves { refused, message }. */
async function refused(fn) {
  try {
    await fn();
    return { refused: false, message: '(accepted)' };
  } catch (err) {
    return { refused: true, message: String(err?.message ?? err) };
  }
}

export const schemaGuards = {
  name: 'v3-schema-guards',
  boxes: ['V3-P0 spec UNIQUE', 'V3-P1 code pin', 'V3-P1 couplings XOR', 'V3-P1 outcome kind', 'V3-9.5 home lane', 'V3-9.3 locked means locked', 'V3-P2 RPC closed lane'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'v3guards');
    const db = rest(env);

    // 1 — one specification per project (v3b): the fixture already made the
    // spec row, so a second insert must hit the constraint by NAME.
    const dupe = await refused(() => db.insert('project_specifications', {
      id: uid(), project_id: fx.ids.project, vision: 'the forked spec the July race used to create',
      created_by: session.userId,
    }));
    s.check('second spec row for one project is refused', dupe.refused && dupe.message.includes('project_specifications_project_id_key'),
      dupe.message.slice(0, 300));

    // 2 — the Code tier is pinned (v3h): NodeSpec never writes code, and not
    // even the service role can raise the lane.
    const rogue = await refused(() => db.update('projects', `id=eq.${fx.ids.project}`, {
      automation_policy: { code: '2' },
    }));
    s.check('automation_policy code:2 is refused', rogue.refused && rogue.message.includes('projects_automation_code_pinned'),
      rogue.message.slice(0, 300));
    await db.update('projects', `id=eq.${fx.ids.project}`, { automation_policy: { requirements: '1' } });
    const [proj] = await db.select('projects', `id=eq.${fx.ids.project}&select=automation_policy`);
    s.check('a legal policy writes', proj?.automation_policy?.requirements === '1', JSON.stringify(proj));

    // 3 — couplings endpoints are XOR (v3g): two from-endpoints refused, a
    // clean requirement→requirement waits_on accepted.
    const twoFroms = await refused(() => db.insert('couplings', {
      id: uid(), branch_id: fx.ids.branch, scope: 'cross', coupling_type: 'waits_on',
      from_requirement_id: fx.ids.req1, from_candidate_id: uid(), to_requirement_id: fx.ids.req2,
    }));
    s.check('coupling with two from-endpoints is refused', twoFroms.refused && twoFroms.message.includes('couplings_from_one_endpoint'),
      twoFroms.message.slice(0, 300));
    const [coupling] = await db.insert('couplings', {
      id: uid(), branch_id: fx.ids.branch, scope: 'cross', coupling_type: 'waits_on',
      from_requirement_id: fx.ids.req1, to_requirement_id: fx.ids.req2,
    });
    s.check('a clean waits_on coupling writes', !!coupling?.id, JSON.stringify(coupling).slice(0, 200));

    // 4 — ideation-born outcomes (v3d): kind 'outcome' with NULL node_id is
    // legal; an unknown kind is not.
    const [outcome] = await db.insert('requirement_candidates', {
      id: uid(), project_id: fx.ids.project, branch_id: fx.ids.branch, node_id: null,
      key: `outcome:${uid().slice(0, 8)}`, kind: 'outcome', name: 'Tenants export their data',
      criteria: [{ text: 'Export completes under 60s' }],
    });
    s.check('outcome candidate with no node writes', outcome?.kind === 'outcome' && outcome?.node_id === null,
      JSON.stringify(outcome).slice(0, 200));
    const badKind = await refused(() => db.insert('requirement_candidates', {
      id: uid(), project_id: fx.ids.project, branch_id: fx.ids.branch, node_id: null,
      key: `bad:${uid().slice(0, 8)}`, kind: 'banana', name: 'nope',
    }));
    s.check('unknown candidate kind is refused', badKind.refused && badKind.message.includes('requirement_candidates_kind_check'),
      badKind.message.slice(0, 300));

    // 4b — 9.5 (v3v): no orphan process. The outcome above named no lane and
    // must have been homed by the database; an import-born kind lands in an
    // Imported workflow created once; a workflow with outcomes refuses deletion.
    const [homed] = await db.select('requirement_candidates', `id=eq.${outcome.id}&select=workflow_id`);
    s.check('an outcome with no lane named is homed, never orphaned', !!homed?.workflow_id, JSON.stringify(homed));
    await db.insert('requirement_candidates', {
      id: uid(), project_id: fx.ids.project, branch_id: fx.ids.branch, node_id: 'n-probe',
      key: `api:n-probe:${uid().slice(0, 8)}`, kind: 'api', name: 'Probe API',
    });
    await db.insert('requirement_candidates', {
      id: uid(), project_id: fx.ids.project, branch_id: fx.ids.branch, node_id: 'n-probe',
      key: `data:n-probe:${uid().slice(0, 8)}`, kind: 'data', name: 'Probe data model',
    });
    const imported = await db.select('workflows', `project_id=eq.${fx.ids.project}&name=eq.Imported&select=id`);
    s.check('import-born kinds share ONE Imported workflow, created once', imported.length === 1, `imported workflows=${imported.length}`);
    const laneDelete = await refused(() => db.delete('workflows', `id=eq.${homed.workflow_id}`));
    // UAT hardening 2026-09-27: any error used to count (a bad id, a 400); the
    // refusal is the foreign key's, and the lane is still there.
    const [laneStill] = homed?.workflow_id ? await db.select('workflows', `id=eq.${homed.workflow_id}&select=id`) : [];
    s.check('a lane with outcomes refuses deletion (RESTRICT)', laneDelete.refused && /23503|foreign key/i.test(laneDelete.message) && !!laneStill,
      laneDelete.message.slice(0, 200));

    // 5b — locked means locked (v3x, doctrine 6): the row refuses every
    // write but the pure unlock and evidence; its mappings, relations and
    // derivations refuse too; the refusal names the door.
    await db.update('specification_requirements', `id=eq.${fx.ids.req1}`, { locked: true });
    const edit = await refused(() => db.update('specification_requirements', `id=eq.${fx.ids.req1}`, { name: 'renamed while locked' }));
    s.check('a field edit on a locked requirement is refused, naming the door', edit.refused && edit.message.includes('is locked') && edit.message.includes('Unlock it in the app'),
      edit.message.slice(0, 300));
    const [lockedRow] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const evidenced = (lockedRow?.acceptance_criteria ?? []).map((c, i) => (i === 0 ? { ...c, met: true, provenance: { source: 'bench', at: new Date().toISOString() } } : c));
    const ev = await refused(() => db.update('specification_requirements', `id=eq.${fx.ids.req1}`, { acceptance_criteria: evidenced }));
    s.check('evidence on a locked requirement still flows', !ev.refused, ev.message.slice(0, 300));
    const mapLocked = await refused(() => db.insert('specification_mappings', {
      id: uid(), specification_id: fx.ids.spec, requirement_id: fx.ids.req1, node_id: fx.ids.nodeDb, mapping_type: 'implements', confidence: 0.5,
    }));
    s.check('a mapping on a locked requirement is refused', mapLocked.refused && mapLocked.message.includes('is locked'), mapLocked.message.slice(0, 200));
    const relLocked = await refused(() => db.insert('specification_requirement_relations', {
      id: uid(), specification_id: fx.ids.spec, from_requirement_id: fx.ids.req2, to_requirement_id: fx.ids.req1, relation_type: 'relates_to',
    }));
    s.check('a relation to a locked requirement is refused', relLocked.refused && relLocked.message.includes('is locked'), relLocked.message.slice(0, 200));
    const attachLocked = await refused(() => db.insert('outcome_derivations', {
      id: uid(), project_id: fx.ids.project, branch_id: fx.ids.branch, candidate_id: outcome.id, requirement_row_id: fx.ids.req1, criteria_slice: [], proposed_by_kind: 'human',
    }));
    s.check('attach to a locked requirement is refused', attachLocked.refused && attachLocked.message.includes('is locked'), attachLocked.message.slice(0, 200));
    const rider = await refused(() => db.update('specification_requirements', `id=eq.${fx.ids.req1}`, { locked: false, name: 'unlock with a rider' }));
    s.check('an unlock with an edit riding along is refused', rider.refused && /P0LCK|is locked/.test(rider.message), rider.message.slice(0, 200));
    const unlock = await refused(() => db.update('specification_requirements', `id=eq.${fx.ids.req1}`, { locked: false }));
    const afterUnlock = await refused(() => db.update('specification_requirements', `id=eq.${fx.ids.req1}`, { name: 'renamed after unlock' }));
    s.check('the pure unlock writes and the edit follows', !unlock.refused && !afterUnlock.refused, `${unlock.message} / ${afterUnlock.message}`);

    // 5 — the claim RPC is a closed lane (v3j): an anon-key caller gets a
    // refusal, never a lease. (The MCP tools call it service-role.)
    const anonRpc = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/agent_checkout_claim`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_project_id: fx.ids.project, p_level: 'task', p_ref_id: uid(), p_holder_kind: 'agent', p_holder_label: 'anon · intruder' }),
    });
    s.check('anon cannot execute the claim RPC', [401, 403, 404].includes(anonRpc.status), `status=${anonRpc.status}`);

    return { s };
  },
};

export default [schemaGuards];

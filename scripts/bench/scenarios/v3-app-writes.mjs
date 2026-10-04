// Bench audit rider (owner's ask 2026-09-21): the APP's own door, live.
//
// Every other scenario reads and writes the database with the service key
// (RLS bypassed) and drives the server over MCP (service role inside). The
// app does neither: it writes as the signed-in person through PostgREST,
// under the RLS policies, and only the server's answer to what the person
// did proves the two halves agree. That is the path the owner's reports of
// 2026-09-21 came from ("locking a requirement doesn't appear to work",
// "adding a workflow shows nothing"), and no scenario walked it.
//
// This one does, with the person's own JWT: a workflow, its step, an
// outcome filed on the step, the duplicate-name refusal the app toasts; a
// lock the person sets and the tools honour (update_requirement and
// relate_requirements refuse in the lock's words, unlock lets the relation
// land); a test the person adds in Work, bound through the seat-facing
// writer, that report_test_results will not lend to another criterion but
// will run for its own; a tick that drops a task from the agents' queue;
// the Autonomy mirror on the project row; the RPCs the app calls; a
// requirement deleted; the app's sliced project delete, owner only. Then
// the seat model on the same door with a real contributor and a real
// viewer: v3p (20260914170000) rewrote every owner-only policy into a seat
// check at apply time, which a text grep of the migrations never shows, so
// these checks are the only place the promise is proven; a policy that
// regressed to owner-only fails here, never silently.
//
// Owner's run 2026-09-21: 45 of 49, the four misses were the bench's (the
// person's test bound by its test_id string where the app binds by the row
// id; labels arrive inside the untrusted-data envelope).
import { rest, restAs, callFn, mcpCall, uid, Scenario, parseMcp } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';


async function adminCreateUser(env, email, password) {
  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.id) throw new Error(`admin create user ${email} → ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.id;
}
async function adminDeleteUser(env, id) {
  await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  }).catch(() => {});
}
async function signInAs(env, email, password) {
  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) throw new Error(`sign-in as ${email} → ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return { accessToken: data.access_token, userId: data.user?.id };
}
const brief = (r) => `${r.status} ${JSON.stringify(r.data ?? r.error).slice(0, 240)}`;

export const appWrites = {
  name: 'v3-app-writes',
  boxes: [
    'V3-6.1 the Work surface writes as the person', 'V3-2.4 a lock the person sets refuses the tools', 'V3-6.2 a person-added test is never a tool\'s test',
    'K.1 the first vision and the constraints, as the person', 'V3-8.2 the Autonomy mirror', 'V3-2.2 the canvas save moves the agents\' head sequence', 'V3 the RPCs the app calls', 'V3-7.0 the seat model on the app path', 'V3 the app deletes a project in slices',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const db = rest(env);
    const me = restAs(env, session);
    const fx = await createProject(env, session, 'v3app');
    const project = fx.ids.project;
    const stamp = Date.now();
    const t1 = uid();
    const t2 = uid();
    await db.insert('task_items', [
      { id: t1, project_id: project, node_id: fx.ids.nodeApi, task_key: 'a99a0001', display_id: 'T1', title: 'Wire the API', done: false, orphaned: false, provenance: {} },
      { id: t2, project_id: project, node_id: fx.ids.nodeDb, task_key: 'a99a0002', display_id: 'T2', title: 'Provision the store', done: false, orphaned: false, provenance: {} },
    ]);
    const people = [];

    try {
      // 1 — workflows, a step, an outcome filed on it: the Steps tab's writes, as the person.
      const wf = await me.insert('workflows', { project_id: project, name: 'Release', sort_order: 0 });
      const wfId = wf.data?.[0]?.id;
      s.check('the person creates a workflow (the app\'s insert lands under RLS)', wf.status === 201 && !!wfId, brief(wf));
      const dup = await me.insert('workflows', { project_id: project, name: 'Release', sort_order: 1 });
      s.check('the same name again is refused by the database as 23505 (the toast the app shows)', dup.status === 409 && dup.error?.code === '23505', brief(dup));
      const step = await me.insert('workflow_steps', { workflow_id: wfId, name: 'Ship', sort_order: 0 });
      const stepId = step.data?.[0]?.id;
      s.check('a step lands on it', step.status === 201 && !!stepId, brief(step));
      const outcome = await me.insert('requirement_candidates', {
        project_id: project, branch_id: fx.ids.branch, workflow_id: wfId, node_id: null,
        key: `outcome:${uid().slice(0, 8)}`, kind: 'outcome', name: 'Tenants export their data', description: '', category: 'functional', criteria: [],
      });
      const outcomeId = outcome.data?.[0]?.id;
      s.check('an outcome lands', outcome.status === 201 && !!outcomeId, brief(outcome));
      const filed = await me.insert('outcome_step_maps', { branch_id: fx.ids.branch, candidate_id: outcomeId, step_id: stepId });
      s.check('the outcome is filed on the step', filed.status === 201, brief(filed));
      const seen = await me.select('workflows', `project_id=eq.${project}&select=id,name,workflow_steps(id,name)`);
      s.check('the person reads the workflow back with its step (what the Steps tab renders)',
        seen.status === 200 && (seen.data ?? []).some((w) => w.id === wfId && w.workflow_steps?.length === 1), brief(seen));
      const filedSeen = await me.select('outcome_step_maps', `candidate_id=eq.${outcomeId}&select=id,step_id`);
      s.check('and the filing', filedSeen.status === 200 && filedSeen.data?.[0]?.step_id === stepId, brief(filedSeen));

      // 1a — K.2: File a requirement on a step, the app's exact sequence
      // (useOutcomes.fileRequirement) as the person: the wrapper outcome,
      // filed on the step WHILE PENDING (the order v3t's terminal rule
      // permits), its derivation to the requirement row, then settled
      // accepted. The Work surface's one way to align a requirement with a
      // workflow, proven under RLS.
      const wrap = await me.insert('requirement_candidates', {
        project_id: project, branch_id: fx.ids.branch, workflow_id: wfId, node_id: null,
        key: `outcome:${uid().slice(0, 8)}`, kind: 'outcome', name: 'Store tasks', description: '', category: 'functional', criteria: [],
      });
      const wrapId = wrap.data?.[0]?.id;
      s.check('K.2: the wrapper outcome lands as the person', wrap.status === 201 && !!wrapId, brief(wrap));
      const wrapMap = await me.insert('outcome_step_maps', { branch_id: fx.ids.branch, candidate_id: wrapId, step_id: stepId });
      s.check('K.2: it files on the step while pending', wrapMap.status === 201, brief(wrapMap));
      const deriv = await me.insert('outcome_derivations', {
        project_id: project, branch_id: fx.ids.branch, candidate_id: wrapId, requirement_row_id: fx.ids.req1,
        criteria_slice: [], proposed_by_kind: 'human', proposed_by_id: session.userId, via_proposal_id: null, approved_by: session.userId,
      });
      s.check('K.2: the derivation names the requirement it stands for', deriv.status === 201, brief(deriv));
      const settle = await me.update('requirement_candidates', `id=eq.${wrapId}`, { status: 'accepted', requirement_row_id: fx.ids.req1, decided_at: new Date().toISOString() });
      s.check('K.2: settled accepted, the workflow view now carries the requirement row', settle.status === 200 && settle.data?.[0]?.status === 'accepted', brief(settle));

      // 1b — K.1 (owner's live report 2026-09-21): the FIRST vision save on a
      // fresh project, the app's exact insert. useProjectVision.save sends no
      // created_by; the column defaults to auth.uid() (20260921150000), so
      // the v3p INSERT policy's created_by = auth.uid() conjunct holds.
      // Before that migration this exact write was refused as an RLS
      // violation: the regression the owner hit clicking Save.
      const freshP = await me.insert('projects', { name: `bench-auto-k1-vision-${stamp}`, owner_id: session.userId, metadata: {} });
      const freshId = freshP.data?.[0]?.id;
      s.check('the person starts a fresh project (the app\'s insert)', freshP.status === 201 && !!freshId, brief(freshP));
      const firstVision = await me.insert('project_specifications', { project_id: freshId, vision: 'A tiny task API, benched.', raw_input: '', phase_status: 'drafting_requirements' });
      s.check('K.1: the first vision save lands as the person, no created_by sent', firstVision.status === 201, brief(firstVision));
      const stamped = await me.select('project_specifications', `project_id=eq.${freshId}&select=created_by,vision`);
      s.check('and the row is stamped with its author by the database', stamped.status === 200 && stamped.data?.[0]?.created_by === session.userId, brief(stamped));
      const editVision = await me.update('project_specifications', `project_id=eq.${freshId}`, { vision: 'A tiny task API, benched twice.', updated_at: new Date().toISOString() });
      s.check('the author edits the vision (the app\'s update path)', editVision.status === 200 && editVision.data?.[0]?.vision === 'A tiny task API, benched twice.', brief(editVision));
      const secondSpec = await me.insert('project_specifications', { project_id: freshId, vision: 'Again.', raw_input: '', phase_status: 'drafting_requirements' });
      s.check('a second spec row for the same project is refused (the app updates instead)', secondSpec.status === 409 && secondSpec.error?.code === '23505', brief(secondSpec));

      // 1c — constraints as the person: useConstraints.add's exact insert,
      // the duplicate-identity refusal the app words as "That constraint is
      // already recorded.", the read the band renders, and the remove.
      const conHash = `bench-hash-${stamp}`;
      const con = await me.insert('project_constraints', { project_id: project, ctype: 'technology', description: 'Everything ships behind the proxy', source_hash: conHash, workflow_id: null });
      const conId = con.data?.[0]?.id;
      s.check('the person records a constraint (the app\'s insert lands under RLS)', con.status === 201 && !!conId, brief(con));
      const conDup = await me.insert('project_constraints', { project_id: project, ctype: 'technology', description: 'Everything ships behind the proxy', source_hash: conHash, workflow_id: null });
      s.check('the same identity again is 23505 (the toast: already recorded)', conDup.status === 409 && conDup.error?.code === '23505', brief(conDup));
      const conSeen = await me.select('project_constraints', `project_id=eq.${project}&select=id,ctype,workflow_id`);
      s.check('the person reads the constraints band back', conSeen.status === 200 && (conSeen.data ?? []).some((r) => r.id === conId && r.workflow_id === null), brief(conSeen));
      const conGone = await me.delete('project_constraints', `id=eq.${conId}`);
      s.check('and removes one', conGone.status === 200 && (conGone.data ?? []).length === 1, brief(conGone));

      // 2 — the lock: set by the person with the app's concurrency token, honoured by the tools.
      const before = await me.select('specification_requirements', `id=eq.${fx.ids.req1}&select=id,locked,updated_at`);
      s.check('the person reads their requirement, unlocked', before.status === 200 && before.data?.length === 1 && before.data[0].locked === false, brief(before));
      const lock = await me.update('specification_requirements', `id=eq.${fx.ids.req1}&updated_at=eq.${encodeURIComponent(before.data?.[0]?.updated_at ?? '')}`, { locked: true });
      s.check('the lock lands (updated_at still matched, the app\'s token)', lock.status === 200 && lock.data?.length === 1 && lock.data[0].locked === true, brief(lock));
      const edit = parseMcp(await mcpCall(env, 'update_requirement', { project_id: project, requirement_id: 'REQ-001', description: 'rewritten while locked', external_agent: 'bench · app' }));
      s.check('update_requirement refuses the locked row in the app\'s words', edit.isError === true && /REQ-001 is locked/.test(String(edit.raw)) && /No tool unlocks/.test(String(edit.raw)), JSON.stringify(edit).slice(0, 300));
      const relateLocked = parseMcp(await mcpCall(env, 'relate_requirements', { project_id: project, from_requirement_id: 'REQ-002', to_requirement_id: 'REQ-001', relation_type: 'depends_on' }));
      s.check('relate_requirements refuses too: a relation is a write on both ends', relateLocked.isError === true && /is locked/.test(String(relateLocked.raw)), JSON.stringify(relateLocked).slice(0, 300));
      const [underLock] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=description,locked`);
      s.check('nothing changed under the lock', underLock?.locked === true && underLock?.description !== 'rewritten while locked', JSON.stringify(underLock));
      const unlock = await me.update('specification_requirements', `id=eq.${fx.ids.req1}`, { locked: false });
      s.check('the person unlocks', unlock.status === 200 && unlock.data?.[0]?.locked === false, brief(unlock));
      const related = parseMcp(await mcpCall(env, 'relate_requirements', { project_id: project, from_requirement_id: 'REQ-002', to_requirement_id: 'REQ-001', relation_type: 'depends_on' }));
      s.check('unlocked, the relation lands', related.relationType === 'depends_on' && related.from === 'REQ-002' && related.to === 'REQ-001' && related.mode === 'add', JSON.stringify(related).slice(0, 300));
      const again = parseMcp(await mcpCall(env, 'relate_requirements', { project_id: project, from_requirement_id: 'REQ-002', to_requirement_id: 'REQ-001', relation_type: 'depends_on' }));
      s.check('adding it twice says it already exists', again.alreadyExists === true, JSON.stringify(again).slice(0, 300));
      const removed = parseMcp(await mcpCall(env, 'relate_requirements', { project_id: project, from_requirement_id: 'REQ-002', to_requirement_id: 'REQ-001', relation_type: 'depends_on', mode: 'remove' }));
      s.check('and it is removed by name', removed.mode === 'remove' && removed.isError !== true, JSON.stringify(removed).slice(0, 300));

      // 3 — the person's own test: added in Work, bound to its criterion, never a tool's test.
      // The app (requirement-writes.ts addTestCase) mints the row id first,
      // binds the criterion to THAT id, then inserts the row under it: the
      // criterion's testId is the case row, never the TC-nnn label.
      const testRowId = uid();
      const added = await me.insert('test_cases', {
        id: testRowId, requirement_id: fx.ids.req1, test_id: 'TC-M1', name: 'The person checks the export by hand', status: 'not_started',
        metadata: { source: 'manual', authoredBy: env.BENCH_USER, at: new Date().toISOString() },
      });
      s.check('the person adds a test in Work (the app\'s insert lands)', added.status === 201 && added.data?.[0]?.test_id === 'TC-M1', brief(added));
      const bind = await me.rpc('apply_criteria_ops_as_member', { p_requirement_id: fx.ids.req1, p_ops: [{ op: 'bind', criterion_text: 'tasks persist across restarts', value: testRowId }] });
      s.check('the person binds it to a criterion by the row id, through the seat-facing writer', bind.status === 200, brief(bind));
      const lent = parseMcp(await mcpCall(env, 'report_test_results', {
        project_id: project, requirement_id: 'REQ-001', results: [{ test_id: 'TC-M1', status: 'passed', criterion_text: 'queries return within 200ms' }],
      }));
      s.check('report_test_results will not lend the person\'s test id to another criterion',
        lent.isError === true && /is the test the person added in Work/.test(String(lent.raw)) && /Nothing was recorded/.test(String(lent.raw)), JSON.stringify(lent).slice(0, 400));
      const own = parseMcp(await mcpCall(env, 'report_test_results', {
        project_id: project, requirement_id: 'REQ-001', results: [{ test_id: 'TC-M1', status: 'passed', criterion_text: 'tasks persist across restarts' }],
      }));
      s.check('the same test id reports its own criterion', own.isError !== true, JSON.stringify(own).slice(0, 300));
      const [afterOwn] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
      const bound = (afterOwn?.acceptance_criteria ?? []).find((c) => c.text === 'tasks persist across restarts');
      s.check('and the criterion the person bound flips met with provenance', bound?.met === true && bound?.testId === testRowId && bound?.provenance?.source === 'test', JSON.stringify(afterOwn?.acceptance_criteria).slice(0, 300));

      // 4 — a tick in the app drops the task from the agents' queue.
      const q0 = parseMcp(await mcpCall(env, 'get_work_queue', { project_id: project }));
      const tick = await me.update('task_items', `id=eq.${t1}`, { done: true });
      const q1 = parseMcp(await mcpCall(env, 'get_work_queue', { project_id: project }));
      s.check('the person ticks a task and the queue drops it', tick.status === 200 && tick.data?.length === 1 && q0.totalOpen === 2 && q1.totalOpen === 1,
        JSON.stringify({ tick: brief(tick), before: q0.totalOpen, after: q1.totalOpen }));

      // 5 — the Autonomy tab's mirror on the project row.
      const meta = await me.select('projects', `id=eq.${project}&select=metadata`);
      const mirror = await me.update('projects', `id=eq.${project}`, { metadata: { ...(meta.data?.[0]?.metadata ?? {}), autoApproveProposals: true } });
      s.check('the person writes the project row (the Autonomy mirror)', mirror.status === 200 && mirror.data?.[0]?.metadata?.autoApproveProposals === true, brief(mirror));

      // 5b — the canvas save as the person: the next sequence, the patch row, the snapshot; the agents' overview moves with it.
      const [snapBefore] = await db.select('graph_snapshots', `branch_id=eq.${fx.ids.branch}&select=graph_data,version,patch_sequence&order=patch_sequence.desc&limit=1`);
      const seq = await me.rpc('get_next_patch_sequence', { p_branch_id: fx.ids.branch });
      s.check('the person is handed the next patch sequence', seq.status === 200 && Number.isInteger(seq.data) && seq.data >= 1, brief(seq));
      const graph = structuredClone(snapBefore?.graph_data ?? {});
      const renamed = 'API renamed in the app';
      if (graph?.nodes?.[fx.ids.nodeApi]) graph.nodes[fx.ids.nodeApi].label = renamed;
      const patchId = uid();
      const patch = { type: 'update_node', payload: { nodeId: fx.ids.nodeApi, changes: { label: renamed } }, metadata: { id: patchId, actorType: 'human', summary: 'Renamed the API node in the app', timestamp: new Date().toISOString() } };
      const patchRow = await me.insert('graph_patches', {
        id: patchId, branch_id: fx.ids.branch, sequence: seq.data, patch_type: 'update_node', actor_type: 'human', actor_id: session.userId,
        summary: patch.metadata.summary, payload: patch, preconditions: null,
      });
      s.check('the person\'s patch row lands (the editor\'s save)', patchRow.status === 201, brief(patchRow));
      const snap = await me.insert('graph_snapshots', { project_id: project, branch_id: fx.ids.branch, graph_data: graph, version: (snapBefore?.version ?? 0) + 1, hash: `bench-${stamp}`, patch_sequence: seq.data });
      s.check('and the snapshot at that sequence', snap.status === 201, brief(snap));
      const ovAfter = parseMcp(await mcpCall(env, 'get_architecture_overview', { project_id: project, since_sequence: (seq.data ?? 1) - 1 }));
      s.check('the agents\' overview moves with the person\'s save: the head sequence, the human patch listed, the new label',
        ovAfter.headSequence === seq.data
          && (ovAfter.since?.patches ?? []).some((p) => p.sequence === seq.data && p.actorType === 'human' && p.type === 'update_node')
          && (ovAfter.nodes ?? []).some((n) => String(n.label ?? n.name ?? '').includes(renamed)),
        JSON.stringify({ head: ovAfter.headSequence, since: ovAfter.since, labels: (ovAfter.nodes ?? []).map((n) => n.label ?? n.name), raw: ovAfter.raw }).slice(0, 400));

      // 6 — the RPCs the app calls as the person.
      const conn = await me.rpc('has_mcp_connection');
      s.check('has_mcp_connection answers the person true (the seeded key has spoken)', conn.status === 200 && conn.data === true, brief(conn));
      const horizons = await me.rpc('mcp_credential_horizons');
      s.check('mcp_credential_horizons lists the person\'s live credentials', horizons.status === 200 && Array.isArray(horizons.data) && horizons.data.some((h) => String(h.delegate).startsWith('key:')), brief(horizons));
      const counted = await me.rpc('agent_connection_count', { p_user_id: session.userId });
      s.check('agent_connection_count is not the person\'s to call (service role only)', counted.status >= 400 && /42501|permission denied/i.test(JSON.stringify(counted.error)), brief(counted));

      // 7 — the person deletes a requirement; the tools stop listing it.
      const del = await me.delete('specification_requirements', `id=eq.${fx.ids.req2}`);
      s.check('the person deletes a requirement', del.status === 200 && del.data?.length === 1, brief(del));
      const listed = parseMcp(await mcpCall(env, 'list_requirements', { project_id: project }));
      s.check('list_requirements no longer serves it', Array.isArray(listed.requirements) && !listed.requirements.some((r) => r.requirementId === 'REQ-002') && listed.requirements.some((r) => r.requirementId === 'REQ-001'),
        JSON.stringify((listed.requirements ?? []).map((r) => r.requirementId)));

      // 8 — the seat model on the app path: a real contributor and a real viewer.
      const password = `Bench-${uid()}`;
      const contributorEmail = `bench-app-contrib-${stamp}@nodespec.test`;
      const viewerEmail = `bench-app-viewer-${stamp}@nodespec.test`;
      const contributorId = await adminCreateUser(env, contributorEmail, password);
      people.push(contributorId);
      const viewerId = await adminCreateUser(env, viewerEmail, password);
      people.push(viewerId);
      await db.insert('project_members', [
        { project_id: project, user_id: contributorId, role: 'contributor', invited_by: session.userId },
        { project_id: project, user_id: viewerId, role: 'viewer', invited_by: session.userId },
      ]);
      const contributorSession = await signInAs(env, contributorEmail, password);
      const c = restAs(env, contributorSession);
      const v = restAs(env, await signInAs(env, viewerEmail, password));
      await mcpCall(env, 'checkout_task', { project_id: project, task_item_id: t2, external_agent: 'bench · holder' });

      // what stands today
      const cProject = await c.select('projects', `id=eq.${project}&select=id`);
      const cRoster = await c.select('project_members', `project_id=eq.${project}&select=user_id,role`);
      s.check('a contributor sees the project and its roster (seat-following policies)', cProject.data?.length === 1 && (cRoster.data ?? []).length >= 2, `${brief(cProject)} | ${brief(cRoster)}`);
      const vLock = await v.update('specification_requirements', `id=eq.${fx.ids.req1}`, { locked: true });
      s.check('a viewer cannot lock a requirement', vLock.status === 200 && (vLock.data ?? []).length === 0, brief(vLock));
      const vLane = await v.insert('workflows', { project_id: project, name: 'Viewer lane', sort_order: 9 });
      // UAT hardening 2026-09-27: the refusal is row security's, not any error.
      s.check('a viewer cannot create a workflow', vLane.status >= 400 && /42501|row-level security/.test(JSON.stringify(vLane.error)), brief(vLane));
      const cOps = await c.rpc('apply_criteria_ops_as_member', { p_requirement_id: fx.ids.req1, p_ops: [] });
      s.check('a contributor may change criteria through the seat-facing writer', cOps.status === 200, brief(cOps));
      const vOps = await v.rpc('apply_criteria_ops_as_member', { p_requirement_id: fx.ids.req1, p_ops: [] });
      s.check('a viewer may not', vOps.status >= 400 && /contributor/.test(JSON.stringify(vOps.error)), brief(vOps));

      // what the seats promise on the app path (v3p rewrote the owner policies into seat checks at apply time)
      const promises = [
        ['a contributor reads the requirements the Work surface lists', () => c.select('specification_requirements', `specification_id=eq.${fx.ids.spec}&select=id`), (r) => (r.data ?? []).length >= 1],
        ['a viewer reads them too', () => v.select('specification_requirements', `specification_id=eq.${fx.ids.spec}&select=id`), (r) => (r.data ?? []).length >= 1],
        ['a contributor reads the workflows and steps', () => c.select('workflows', `project_id=eq.${project}&select=id`), (r) => (r.data ?? []).length >= 1],
        ['a contributor reads the outcomes', () => c.select('requirement_candidates', `project_id=eq.${project}&select=id`), (r) => (r.data ?? []).length >= 1],
        ['a contributor sees the agents\' holds (the Agents panel)', () => c.select('agent_checkouts', `project_id=eq.${project}&released_at=is.null&select=id`), (r) => (r.data ?? []).length >= 1],
        ['a contributor reads the task items (the Plan tab)', () => c.select('task_items', `project_id=eq.${project}&select=id`), (r) => (r.data ?? []).length >= 1],
        ['a contributor locks a requirement', () => c.update('specification_requirements', `id=eq.${fx.ids.req1}`, { locked: true }), (r) => (r.data ?? []).length === 1],
        ['a contributor adds a test in Work', () => c.insert('test_cases', { requirement_id: fx.ids.req1, test_id: 'TC-M2', name: 'The contributor checks by hand', status: 'not_started', metadata: { source: 'manual' } }), (r) => r.status === 201],
        ['a contributor creates a workflow', () => c.insert('workflows', { project_id: project, name: 'Contributor lane', sort_order: 5 }), (r) => r.status === 201],
      ];
      for (const [label, probe, pass] of promises) {
        let r;
        try { r = await probe(); } catch (e) { r = { status: 0, data: null, error: String(e) }; }
        s.check(`seat model: ${label}`, pass(r), `${brief(r)} (a policy on this table no longer follows the seat)`);
      }

      // AE.7 (owner 2026-09-25): a teammate's Workflows edit is a proposal the
      // owner decides, unless the project's Outcomes & workflow setting is
      // Auto-apply. The app files it through propose_patches on the server's
      // session door, named by the person's email; the owner accepts it under
      // Proposals and the server applies the same op an agent would file.
      //
      // Decision 1 (owner 2026-09-26): the project owner's plan governs what
      // the project carries, for everyone seated on it. The contributor is a
      // fresh account with no paid plan of its own; the owner's plan carries
      // Workflows, so the contributor's edit is decided on it.
      const ae7Own = await db.select('stripe_subscriptions', `user_id=eq.${contributorId}&status=in.(active,trialing)&select=plan_name`);
      s.check('decision 1: the contributor holds no paid plan of their own', ae7Own.every((r) => !/indie|team|enterprise|government/i.test(String(r.plan_name))), JSON.stringify(ae7Own).slice(0, 200));
      const ae7OwnerTier = await me.rpc('project_plan_tier', { p_project_id: project });
      const ae7SeatTier = await c.rpc('project_plan_tier', { p_project_id: project });
      s.check('decision 1: the database answers the contributor the project\'s plan, its owner\'s, which carries Workflows',
        ae7SeatTier.status === 200 && ae7SeatTier.data === ae7OwnerTier.data && ['indie', 'team', 'enterprise', 'government'].includes(ae7SeatTier.data),
        `${brief(ae7OwnerTier)} | ${brief(ae7SeatTier)}`);
      const ae7Asked = await me.update('projects', `id=eq.${project}`, { automation_policy: { candidates: 1 } });
      s.check('AE.7 the owner sets Outcomes & workflow to Propose', ae7Asked.status === 200, brief(ae7Asked));
      const laneName = `Teammate lane ${stamp}`;
      const ae7Filed = (await callFn(env, contributorSession, 'mcp-server', {
        tool: 'propose_patches',
        arguments: { project_id: project, patches: [{ type: 'upsert_workflow', payload: { name: laneName, sortOrder: 8 } }], explanations: [`add the workflow "${laneName}"`], external_agent: contributorEmail },
      })).data;
      const [ae7Row] = ae7Filed?.data?.proposalId ? await db.select('ai_proposals', `id=eq.${ae7Filed.data.proposalId}&select=status,metadata,patches`) : [];
      s.check('AE.7 the contributor\'s edit files as a pending proposal in their name (the app\'s door)',
        ae7Filed?.success === true && ae7Row?.status === 'pending' && ae7Row?.metadata?.authMethod === 'jwt' && ae7Row?.metadata?.externalAgent === contributorEmail &&
        ae7Row?.patches?.[0]?.patch?.type === 'upsert_workflow' && (await db.select('workflows', `project_id=eq.${project}&name=eq.${encodeURIComponent(laneName)}&select=id`)).length === 0,
        JSON.stringify({ ae7Filed, ae7Row }).slice(0, 400));
      const ae7Decided = (await callFn(env, session, 'mcp-server', { tool: 'resolve_proposal', arguments: { project_id: project, proposal_id: ae7Filed?.data?.proposalId, action: 'accept' } })).data;
      const ae7Landed = await db.select('workflows', `project_id=eq.${project}&name=eq.${encodeURIComponent(laneName)}&select=id,name`);
      s.check('AE.7 the owner accepts it under Proposals and the workflow lands', ae7Decided?.success === true && ae7Landed.length === 1, JSON.stringify({ ae7Decided, ae7Landed }).slice(0, 300));
      const ae7Auto = await me.update('projects', `id=eq.${project}`, { automation_policy: { candidates: 2 } });
      const ae7Direct = await c.insert('workflows', { project_id: project, name: `${laneName} direct`, sort_order: 9 });
      s.check('AE.7 with Outcomes & workflow at Auto-apply the same edit writes directly (the seat policy lets it)', ae7Auto.status === 200 && ae7Direct.status === 201, `${brief(ae7Auto)} | ${brief(ae7Direct)}`);
      await me.update('projects', `id=eq.${project}`, { automation_policy: {} });

      // Audit (owner 2026-09-27): the repository connection is the owner's or
      // a maintainer's to manage (the Repository tab's commit mode and auto
      // sync); a contributor reads it and pushes through the edge functions.
      const [repoRow] = await db.insert('git_integrations', [{
        project_id: project, provider: 'github', repo_owner: 'bench', repo_name: `app-writes-${stamp}`, default_branch: 'main',
        access_token_encrypted: 'bench-not-a-token', created_by: session.userId,
      }]);
      try {
        const cSees = await c.select('git_integrations', `id=eq.${repoRow.id}&select=id`);
        const cMode = await c.update('git_integrations', `id=eq.${repoRow.id}`, { commit_mode: 'pull-request' });
        s.check('a contributor reads the repository connection but cannot change its commit mode',
          (cSees.data ?? []).length === 1 && cMode.status === 200 && (cMode.data ?? []).length === 0, `${brief(cSees)} | ${brief(cMode)}`);
        await db.update('project_members', `project_id=eq.${project}&user_id=eq.${contributorId}`, { role: 'maintainer' });
        const mMode = await c.update('git_integrations', `id=eq.${repoRow.id}`, { commit_mode: 'pull-request' });
        await db.update('project_members', `project_id=eq.${project}&user_id=eq.${contributorId}`, { role: 'contributor' });
        const oSync = await me.update('git_integrations', `id=eq.${repoRow.id}`, { auto_sync: true });
        s.check('a maintainer changes the commit mode, and the owner turns on auto sync',
          (mMode.data ?? []).length === 1 && (oSync.data ?? []).length === 1, `${brief(mMode)} | ${brief(oSync)}`);
      } finally {
        await db.delete('git_integrations', `id=eq.${repoRow.id}`).catch(() => {});
      }

      // 9 — the app's project delete, in slices, as the owner; a viewer cannot.
      const throwaway = await me.insert('projects', { name: `bench-auto-appdel-${stamp}`, owner_id: session.userId, metadata: {} });
      const pid = throwaway.data?.[0]?.id;
      s.check('the person creates a project through the app\'s insert', throwaway.status === 201 && !!pid, brief(throwaway));
      let done = false;
      let steps = 0;
      while (pid && !done && steps < 50) {
        const r = await me.rpc('project_delete_step', { p_project_id: pid });
        if (r.status !== 200) { s.check('project_delete_step answers its owner', false, brief(r)); break; }
        done = r.data?.done === true;
        steps++;
      }
      s.check('project_delete_step drains and removes the project for its owner', done && (await db.select('projects', `id=eq.${pid}&select=id`)).length === 0, `done=${done} steps=${steps}`);
      const foreignDel = await v.rpc('project_delete_step', { p_project_id: project });
      s.check('a viewer cannot delete the project through the same RPC',
        foreignDel.status >= 400 && /only the project owner/.test(JSON.stringify(foreignDel.error)) && (await db.select('projects', `id=eq.${project}&select=id`)).length === 1, brief(foreignDel));
    } finally {
      await db.update('specification_requirements', `id=eq.${fx.ids.req1}`, { locked: false }).catch(() => {});
      for (const id of people) await adminDeleteUser(env, id);
    }
    return { s };
  },
};

export default [appWrites];

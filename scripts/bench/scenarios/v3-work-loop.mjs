// V3 P2 bench rider (docs/V3_OVERHAUL_PLAN.md): the agent-native checkout
// lane, live — the automated replacement for the P2 "You test locally"
// bullets. Drives the REAL stack end to end: queue ordering out of the
// deployed readiness lane, the claim RPC's row-lock contention path, the
// stale-reclaim path (heartbeat backdated via service role — the bench
// cannot wait 30 minutes), audit rows surviving release, and advisory
// requirement-level holds coexisting. FakeSupabase pins prove the handler
// logic; THIS proves the SQL underneath it (partial unique indexes, the
// project row lock, RLS, the release-reason CHECK).
//
// V3 I (2026-09-21): agent B is a SECOND CREDENTIAL. The scenario mints a
// key for it through create_api_key as the signed-in person (the Connected
// tab's door) and revokes it at the end, so the contention, the reclaim and
// the two-drafter and two-verifier checks below run between two real keys,
// not one key wearing two labels. A (the seeded key) and B each see the
// other's hold as not mine, with the other's key named.
import { rest, mcpCall, mcpCallAs, uid, Scenario, parseMcp } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

const KEY_B_NAME = 'bench-conn-loop-b';

// Over the REAL transport the tool-result text is the handler's data
// ALREADY UNWRAPPED (no {success, data} envelope — that shape exists only
// in the Deno fake); an error arrives as isError text. parseMcp (lib.mjs) reads it.

export const checkoutLoop = {
  name: 'checkout-loop',
  boxes: ['V3-P2 queue order', 'V3-P2 claim contention', 'V3-P2 stale reclaim', 'V3-P2 lease audit', 'V3-P2 advisory holds', 'V3u criterion lease', 'V3-P2 verified exit', 'V3-4b.5 sha stitch'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'v3loop');
    const db = rest(env);

    // Agent B's own key (V3 I). A crashed run's leftover would trip the
    // one-live-name rule, so it is deleted first; the mint goes through the
    // signed-in person exactly as the Connected tab does.
    await db.delete('mcp_api_keys', `user_id=eq.${session.userId}&name=eq.${KEY_B_NAME}`);
    const keyB = parseMcp(await mcpCallAs(env, { accessToken: session.accessToken }, 'create_api_key', { name: KEY_B_NAME }));
    s.check('agent B connects with its own key, minted by the signed-in person', /^ns_live_/.test(keyB.apiKey ?? ''), JSON.stringify(keyB).slice(0, 300));
    const credB = { apiKey: keyB.apiKey ?? env.MCP_API_KEY };
    const asB = (tool, args) => mcpCallAs(env, credB, tool, args);

    // Two open tasks, one per node. The fixture's edge is API → DB over a
    // sql contract (source = caller), so the DB is the API's upstream and
    // its task must rank FIRST — display ids deliberately say otherwise.
    const taskApi = uid();
    const taskDb = uid();
    await db.insert('task_items', [
      { id: taskApi, project_id: fx.ids.project, node_id: fx.ids.nodeApi, task_key: 'a3f19c02', display_id: 'T1', title: 'Wire the API', done: false, orphaned: false, provenance: {} },
      { id: taskDb, project_id: fx.ids.project, node_id: fx.ids.nodeDb, task_key: 'b4e28d13', display_id: 'T2', title: 'Provision the store', done: false, orphaned: false, provenance: {} },
    ]);

    // 1 — the queue serves dependency order from the live readiness lane.
    let q = parseMcp(await mcpCall(env, 'get_work_queue', { project_id: fx.ids.project }));
    s.check('queue answers', Array.isArray(q.queue) && q.totalOpen === 2, JSON.stringify(q).slice(0, 400));
    s.check('fallback source is build-order', q.source === 'build-order', q.source);
    s.check('upstream DB task ranks before its caller', q.queue?.[0]?.taskItemId === taskDb,
      JSON.stringify(q.queue?.map((e) => e.title)));

    // 2 — claim, then contention: the second agent gets the holder, not an error.
    const a = parseMcp(await mcpCall(env, 'checkout_task', {
      project_id: fx.ids.project, task_item_id: taskDb, external_agent: 'bench · agent-a',
    }));
    s.check('agent A claims', a.claimed === true && !!a.checkoutId, JSON.stringify(a).slice(0, 400));
    const checkoutA = a.checkoutId;

    const b1 = parseMcp(await asB('checkout_task', {
      project_id: fx.ids.project, task_item_id: taskDb, external_agent: 'bench · agent-b',
    }));
    s.check('agent B is told who holds it', b1.claimed === false && b1.heldBy === 'bench · agent-a',
      JSON.stringify(b1).slice(0, 400));
    // V3 I: B's own board marks A's hold as not mine and names A's key.
    const qB = parseMcp(await asB('get_work_queue', { project_id: fx.ids.project }));
    const seenByB = (qB.activeHolds ?? []).find((h) => h.refId === taskDb);
    s.check("B's board: A's hold is not mine and names A's credential, not B's",
      seenByB?.mine === false && String(seenByB?.credential).startsWith('key · ') && seenByB?.credential !== `key · ${KEY_B_NAME}`,
      JSON.stringify(seenByB ?? qB.activeHolds).slice(0, 300));

    q = parseMcp(await mcpCall(env, 'get_work_queue', { project_id: fx.ids.project }));
    const heldRow = q.queue?.find((e) => e.taskItemId === taskDb);
    s.check('queue renders the hold (held work stays listed)', heldRow?.heldBy === 'bench · agent-a' && heldRow?.holdStale === false,
      JSON.stringify(heldRow));
    // Collision board: activeHolds carries the same lease with a resolved
    // label, and the CALLING key recognizes it as its own (mine).
    const boardHold = (q.activeHolds ?? []).find((h) => h.refId === taskDb);
    s.check('activeHolds publishes the board with mine + label',
      boardHold?.holder === 'bench · agent-a' && boardHold?.mine === true
        && String(boardHold?.refLabel).includes('Provision the store') && boardHold?.advisory === false,
      JSON.stringify(boardHold ?? q.activeHolds).slice(0, 300));

    // 3 — heartbeat carries progress display state.
    const hb = parseMcp(await mcpCall(env, 'checkout_heartbeat', {
      project_id: fx.ids.project, checkout_id: checkoutA, meta: { tests: ['TC-001'], touches: ['src/db.ts'] },
    }));
    s.check('heartbeat refreshes', hb.ok === true, JSON.stringify(hb).slice(0, 300));
    const [leaseRow] = await db.select('agent_checkouts', `id=eq.${checkoutA}&select=meta,heartbeat_at`);
    s.check('display state persisted', leaseRow?.meta?.tests?.[0] === 'TC-001', JSON.stringify(leaseRow?.meta));

    // 4 — stale reclaim: backdate the heartbeat (the bench cannot wait 30
    // minutes), then agent B's claim reclaims atomically and the OLD lease
    // survives as audit.
    await db.update('agent_checkouts', `id=eq.${checkoutA}`, {
      heartbeat_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    });
    const b2 = parseMcp(await asB('checkout_task', {
      project_id: fx.ids.project, task_item_id: taskDb, external_agent: 'bench · agent-b',
    }));
    s.check('stale hold reclaims', b2.claimed === true && b2.reclaimedFrom === checkoutA,
      JSON.stringify(b2).slice(0, 400));
    const [oldLease] = await db.select('agent_checkouts', `id=eq.${checkoutA}&select=released_at,released_reason`);
    s.check('the old lease is audit, not gone', oldLease?.released_reason === 'reclaimed' && !!oldLease?.released_at,
      JSON.stringify(oldLease));
    const [newLease] = await db.select('agent_checkouts', `id=eq.${b2.checkoutId}&select=holder_key_id,holder_delegate`);
    s.check("the reclaimed lease is B's key, not A's", !!keyB.keyId && newLease?.holder_key_id === keyB.keyId && newLease?.holder_delegate === `key:${keyB.keyId}`,
      JSON.stringify({ newLease, keyB: keyB.keyId }));

    // 5 — audited release, by the holder.
    const rel = parseMcp(await asB('release_checkout', {
      project_id: fx.ids.project, checkout_id: b2.checkoutId, reason: 'verified',
    }));
    s.check('release verified', rel.released === true && rel.reason === 'verified', JSON.stringify(rel).slice(0, 300));

    // 6 — advisory holds are non-exclusive: two agents drafting against the
    // same requirement coexist.
    const adv1 = parseMcp(await mcpCall(env, 'checkout_task', {
      project_id: fx.ids.project, level: 'requirement', ref_id: fx.ids.req1, external_agent: 'bench · drafter-1',
    }));
    const adv2 = parseMcp(await asB('checkout_task', {
      project_id: fx.ids.project, level: 'requirement', ref_id: fx.ids.req1, external_agent: 'bench · drafter-2',
    }));
    s.check('advisory holds coexist', adv1.claimed === true && adv1.advisory === true && adv2.claimed === true,
      JSON.stringify({ adv1, adv2 }).slice(0, 400));
    const advisory = await db.select('agent_checkouts',
      `requirement_id=eq.${fx.ids.req1}&released_at=is.null&select=id`);
    s.check('two active drafting holds on the requirement', advisory.length === 2, `active=${advisory.length}`);

    // 6b — v3u (board R3): the criterion lease. The unit of the test lane is
    // exclusive now — one criterion, one binding test, one reported outcome —
    // and the id comes from list_requirements, which serves the v3l identity
    // even for rows that never stored one (the fixture's criteria are
    // id-less objects, so the served id is the derived text hash).
    const lr = parseMcp(await mcpCall(env, 'list_requirements', { project_id: fx.ids.project }));
    const lrReq1 = (lr.requirements ?? []).find((r) => r.requirementId === 'REQ-001');
    const crit = (lrReq1?.acceptanceCriteria ?? []).find((c) => c?.text === 'queries return within 200ms');
    s.check('list serves the criterion id (derived for pre-v3l rows)',
      typeof crit?.id === 'string' && crit.id.startsWith('h'),
      JSON.stringify(lrReq1?.acceptanceCriteria ?? lr).slice(0, 300));
    const c1 = parseMcp(await mcpCall(env, 'checkout_task', {
      project_id: fx.ids.project, level: 'criterion', ref_id: fx.ids.req1, criterion_id: crit.id, external_agent: 'bench · verifier-1',
    }));
    const c2 = parseMcp(await asB('checkout_task', {
      project_id: fx.ids.project, level: 'criterion', ref_id: fx.ids.req1, criterion_id: crit.id, external_agent: 'bench · verifier-2',
    }));
    s.check('criterion lease is exclusive with the holder named',
      c1.claimed === true && c1.advisory === false && c2.claimed === false && c2.heldBy === 'bench · verifier-1',
      JSON.stringify({ c1, c2 }).slice(0, 400));
    const qc = parseMcp(await mcpCall(env, 'get_work_queue', { project_id: fx.ids.project }));
    const cHold = (qc.activeHolds ?? []).find((h) => h.criterionId === crit.id);
    s.check('the board names WHICH criterion',
      cHold?.level === 'criterion' && String(cHold?.refLabel).includes(`criterion ${crit.id}`),
      JSON.stringify(cHold ?? qc.activeHolds).slice(0, 300));
    const cRel = parseMcp(await mcpCall(env, 'release_checkout', {
      project_id: fx.ids.project, checkout_id: c1.checkoutId, reason: 'released', note: 'The failing test is written; the fix is next.',
    }));
    s.check('criterion lease releases', cRel.released === true, JSON.stringify(cRel).slice(0, 200));

    // 7 — the verification exit (task 2.6), live: the fixture maps REQ-001
    // to the API node, so a lease on the API task is released by EVIDENCE —
    // a passing report against REQ-001 — never by a "done" declaration.
    // Red evidence holds the lease.
    const v = parseMcp(await mcpCall(env, 'checkout_task', {
      project_id: fx.ids.project, task_item_id: taskApi, external_agent: 'bench · verifier',
    }));
    s.check('verifier claims the API task', v.claimed === true && !!v.checkoutId, JSON.stringify(v).slice(0, 300));

    const red = parseMcp(await mcpCall(env, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: 'REQ-001',
      results: [{ test_id: 'TC-100', status: 'failed', criterion_text: 'queries return within 200ms' }],
      external_agent: 'bench · verifier',
    }));
    const [heldAfterRed] = await db.select('agent_checkouts', `id=eq.${v.checkoutId}&select=released_at`);
    // UAT hardening 2026-09-27: a report that failed outright also releases
    // nothing; the red result must have been recorded.
    s.check('red evidence holds the lease', red.isError !== true && red.reported === 1 && !red.checkoutsReleased && heldAfterRed?.released_at === null,
      JSON.stringify({ reported: red.reported ?? null, error: red.isError ? String(red.raw).slice(0, 120) : null, receipt: red.checkoutsReleased ?? null, released_at: heldAfterRed?.released_at }));

    // 4b.5 (R8): commit and push FIRST, then report with the sha — the
    // flipped criterion and the verified lease both point at real history.
    const SHA = 'abc123def456abc123def456abc123def456abc1';
    const green = parseMcp(await mcpCall(env, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: 'REQ-001',
      results: [{ test_id: 'TC-100', status: 'passed', criterion_text: 'queries return within 200ms' }],
      external_agent: 'bench · verifier',
      git: { commit_sha: SHA, branch: 'main' },
    }));
    s.check('passing evidence releases with a receipt',
      Array.isArray(green.checkoutsReleased) && green.checkoutsReleased.some((c) => c.checkoutId === v.checkoutId),
      JSON.stringify(green.checkoutsReleased ?? green).slice(0, 300));
    const [verifiedLease] = await db.select('agent_checkouts',
      `id=eq.${v.checkoutId}&select=released_at,released_reason,meta`);
    s.check('the lease is audit: released_reason=verified',
      verifiedLease?.released_reason === 'verified' && !!verifiedLease?.released_at,
      JSON.stringify(verifiedLease));
    s.check('the verified lease carries the commit and the requirement (R8 stitch)',
      verifiedLease?.meta?.verified?.commitSha === SHA && verifiedLease?.meta?.verified?.requirementId === 'REQ-001' && verifiedLease?.meta?.verified?.branch === 'main',
      JSON.stringify(verifiedLease?.meta));
    // Scoped by the fixture's ROW id: requirement_id is only unique within a
    // spec, and the service role sees every project — the seed's own REQ-001
    // ("POST /tasks…") answered here first (live-caught 2026-09-15).
    const [reqRow] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const stitched = (reqRow?.acceptance_criteria ?? []).find((c) => c?.provenance?.commitSha === SHA);
    s.check('the flipped criterion points at the same commit', !!stitched && stitched.provenance.source === 'test',
      JSON.stringify(reqRow?.acceptance_criteria ?? reqRow).slice(0, 300));

    // V3 I: B's key goes back where it came from; the account keeps only
    // what it had. A revoke releases whatever B still holds, audited.
    if (keyB.keyId) {
      const gone = parseMcp(await mcpCallAs(env, { accessToken: session.accessToken }, 'revoke_api_key', { key_id: keyB.keyId }));
      s.check("B's key is revoked at the end, its remaining holds released", gone.keyId === keyB.keyId, JSON.stringify(gone).slice(0, 300));
    }

    return { s };
  },
};

export default [checkoutLoop];

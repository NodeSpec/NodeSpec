// V3 4b.3 bench rider (docs/V3_OVERHAUL_PLAN.md): the agent derivation
// lane, live — get_outcome_board as the agent's read (criteria ids, the
// envelope), the advisory outcome hold with the calling credential marked
// mine on the board, a two-derivation proposal that BINDS the hold on
// filing, and a resolve that releases it as 'resolved' (reject is legal
// over a key; accept is the human act and lands with P8). Deno pins prove
// the assembly; THIS proves the RPC, the bind/release updates and RLS
// underneath against the live stack.
import { rest, mcpCall, mcpRpc, uid, Scenario, parseMcp } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';


export const agentLane = {
  name: 'v3-agent-lane',
  boxes: ['V3-4b.3 outcome board', 'V3-4b.3 delegate identity', 'V3-4b.3 hold↔proposal', 'V3-R decided outcomes keep their filing', 'V3-P workflows by plan'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'v3lane');
    const db = rest(env);

    // An outcome with two identified criteria, on the fixture branch.
    const outcomeId = uid();
    await db.insert('requirement_candidates', {
      id: outcomeId, project_id: fx.ids.project, branch_id: fx.ids.branch, node_id: null,
      key: `outcome:${uid().slice(0, 8)}`, kind: 'outcome', name: 'Tenants export their data',
      criteria: [{ id: 'c1', text: 'Export completes under 60s' }, { id: 'c2', text: 'Export is audited' }],
    });

    // 1 — the read: ids, unclaimed, envelope.
    let board = parseMcp(await mcpCall(env, 'get_outcome_board', { project_id: fx.ids.project, branch_id: fx.ids.branch }));
    let mine = (board.outcomes ?? []).find((o) => o.candidateId === outcomeId);
    s.check('the board lists the outcome with criteria ids', !!mine && mine.criteria?.map((c) => c.id).join(',') === 'c1,c2',
      JSON.stringify(mine ?? board).slice(0, 400));
    s.check('nothing claimed yet', Array.isArray(mine?.unclaimedCriteriaIds) && mine.unclaimedCriteriaIds.length === 2 && mine.derivations?.length === 0,
      JSON.stringify(mine?.unclaimedCriteriaIds));
    s.check('user-authored text is enveloped', String(mine?.name).startsWith('<untrusted-data>') && typeof board.untrustedDataAdvisory === 'string',
      String(mine?.name).slice(0, 80));

    // P: whatever this account's plan, the board SAYS whether it has
    // Workflows, and never hands an agent empty lanes it must interpret.
    const workflowsOn = board.workflows?.available === true;
    s.check('the board always states workflows.available', typeof board.workflows?.available === 'boolean', JSON.stringify(board.workflows));
    s.check(workflowsOn
      ? 'with Workflows: lanes and each outcome\'s steps are present'
      : 'without Workflows: lanes, homeLane and steps are omitted, and the note names Indie',
      workflowsOn
        ? Array.isArray(board.lanes) && Array.isArray(mine?.steps)
        : !('lanes' in board) && !!mine && !('steps' in mine) && !('homeLaneId' in mine) && String(board.workflows?.note).includes('Indie'),
      JSON.stringify({ workflows: board.workflows, keys: mine ? Object.keys(mine) : null }).slice(0, 400));

    // Q: the tool list is the same plan. Below Indie the paid tools are
    // absent and propose_patches never mentions place_on_step; on Indie and
    // above they are listed.
    const listed = await mcpRpc(env, null, 'tools/list', {});
    const tools = Array.isArray(listed.data?.result?.tools) ? listed.data.result.tools : [];
    const names = new Set(tools.map((t) => t.name));
    const paidListed = ['run_repo_import', 'get_work_plan', 'propose_work_plan', 'accept_work_plan', 'search_repo_index'].filter((n) => names.has(n));
    const proposeText = tools.find((t) => t.name === 'propose_patches')?.description ?? '';
    s.check(workflowsOn
      ? 'tools/list on this plan: the Indie tools are listed and propose_patches offers place_on_step'
      : 'tools/list on this plan: no Indie tool is listed and propose_patches never names place_on_step',
      tools.length > 0 && (workflowsOn ? paidListed.length === 5 && proposeText.includes('place_on_step') : paidListed.length === 0 && !proposeText.includes('place_on_step')),
      JSON.stringify({ count: tools.length, paidListed }).slice(0, 300));

    // 2 — the hold: advisory, and the CALLING credential sees it as mine on the board.
    const hold = parseMcp(await mcpCall(env, 'checkout_task', {
      project_id: fx.ids.project, level: 'outcome', ref_id: outcomeId, external_agent: 'bench · deriver',
    }));
    s.check('advisory outcome hold claimed', hold.claimed === true && hold.advisory === true && !!hold.checkoutId, JSON.stringify(hold).slice(0, 300));
    const [leaseRow] = await db.select('agent_checkouts', `id=eq.${hold.checkoutId}&select=holder_delegate,holder_key_id,proposal_id`);
    s.check('the lease carries the delegate identity (R7)', typeof leaseRow?.holder_delegate === 'string' && leaseRow.holder_delegate.startsWith('key:'),
      JSON.stringify(leaseRow));
    board = parseMcp(await mcpCall(env, 'get_outcome_board', { project_id: fx.ids.project, branch_id: fx.ids.branch }));
    mine = (board.outcomes ?? []).find((o) => o.candidateId === outcomeId);
    const myHold = (mine?.holds ?? []).find((h) => h.checkoutId === hold.checkoutId);
    s.check('the board marks the hold mine with its credential', myHold?.mine === true && String(myHold?.credential).startsWith('key · ') && myHold?.proposalId === null,
      JSON.stringify(myHold ?? mine?.holds));

    // 3 — the proposal: two derivations, one per slice; filing BINDS the hold.
    const prop = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch,
      patches: [
        { type: 'promote_candidate', payload: { candidateId: outcomeId, criteriaIds: ['c1'], name: 'Export is fast' } },
        { type: 'promote_candidate', payload: { candidateId: outcomeId, criteriaIds: ['c2'], name: 'Export is audited' } },
      ],
      explanations: ['Derive the speed requirement.', 'Derive the audit requirement.'],
      external_agent: 'bench · deriver',
    }));
    s.check('a two-derivation proposal files and reports the bound hold', !!prop.proposalId && prop.holdsBound === 1, JSON.stringify(prop).slice(0, 300));
    const [bound] = await db.select('agent_checkouts', `id=eq.${hold.checkoutId}&select=proposal_id,released_at`);
    s.check('the hold is bound to the proposal, still active', bound?.proposal_id === prop.proposalId && bound?.released_at === null, JSON.stringify(bound));

    // 4 — a key cannot ACCEPT (the human act, P8); it may REJECT — and the
    // bound hold ends as 'resolved' either way.
    const accept = parseMcp(await mcpCall(env, 'resolve_proposal', { project_id: fx.ids.project, proposal_id: prop.proposalId, action: 'accept' }));
    s.check('accept over a key is refused as the human act', accept.isError === true && String(accept.raw).includes('human act'), JSON.stringify(accept).slice(0, 200));
    const reject = parseMcp(await mcpCall(env, 'resolve_proposal', { project_id: fx.ids.project, proposal_id: prop.proposalId, action: 'reject', note: 'bench' }));
    s.check('reject resolves and releases the bound hold', reject.status === 'rejected' && reject.holdsReleased === 1, JSON.stringify(reject).slice(0, 300));
    const [released] = await db.select('agent_checkouts', `id=eq.${hold.checkoutId}&select=released_reason,released_at`);
    s.check('the lease ended as resolved — the audited third ending', released?.released_reason === 'resolved' && !!released?.released_at, JSON.stringify(released));
    const [untouched] = await db.select('requirement_candidates', `id=eq.${outcomeId}&select=status,requirement_row_id`);
    s.check('nothing derived without the human — the outcome is pending and unlinked', untouched?.status === 'pending' && untouched?.requirement_row_id === null, JSON.stringify(untouched));

    // 5 — v3t: a decided outcome keeps the steps it was filed on, in EVERY
    // lane. This outcome is still pending, so file it on a step first, then
    // settle it, then try to move it — the order a real board produces.
    const [stepRow] = await db.insert('workflows', { project_id: fx.ids.project, name: `terminal-lane-${Date.now()}`, created_by: session.userId });
    const [step] = await db.insert('workflow_steps', { workflow_id: stepRow.id, name: 'Filed here', sort_order: 0 });
    await db.insert('outcome_step_maps', { branch_id: fx.ids.branch, candidate_id: outcomeId, step_id: step.id });
    s.check('a PENDING outcome can be filed on a step', (await db.select('outcome_step_maps', `candidate_id=eq.${outcomeId}&select=id`)).length === 1);

    await db.update('requirement_candidates', `id=eq.${outcomeId}`, { status: 'accepted', decided_at: new Date().toISOString() });

    // the MCP lane: the one that used to load the row and never read its status
    const remap = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project,
      patches: [{ type: 'set_outcome_step_maps', payload: { candidateId: outcomeId, branchId: fx.ids.branch, stepIds: [] } }],
    }));
    const remapText = JSON.stringify(remap);
    // AL.6 and AL.8 (bench 2026-10-02): with the Candidates lane at Auto (this
    // fixture's default) the remap would apply as it files, so the batch is
    // checked against the row as it is now and set aside at filing, by name:
    // nothing is created, nothing waits, and the row reads rejected by the
    // auto lane with the reason. (Before, it filed as pending and the accept
    // was where the terminal rule refused it.)
    // A proposal belongs to its branch (ai_proposals has no project column);
    // filed with no branch_id, the remap landed on the fixture's primary.
    const [setAside] = workflowsOn
      ? await db.select('ai_proposals', `source_branch_id=eq.${fx.ids.branch}&order=created_at.desc&limit=1&select=status,metadata`)
      : [];
    const waiting = workflowsOn ? await db.select('ai_proposals', `source_branch_id=eq.${fx.ids.branch}&status=eq.pending&select=id`) : [];
    const stillFiled = await db.select('outcome_step_maps', `candidate_id=eq.${outcomeId}&select=id`);
    s.check('a settled outcome keeps its filing: the map survives the remap attempt',
      stillFiled.length === 1, `the map was cleared: ${JSON.stringify({ remap }).slice(0, 300)}`);
    // P: below Indie the remap never reaches the terminal rule; the Workflows
    // gate refuses it first. Say which refusal this account got, so a pass on
    // Community is never mistaken for proof of the terminal rule (the direct
    // write below proves that one on every plan).
    s.check(workflowsOn
      ? 'with Workflows the remap is set aside at filing, by name, as terminal: nothing applied, nothing waiting'
      : 'without Workflows the remap is refused by the Workflows gate, by name, before anything files',
      workflowsOn
        ? remap.isError === true && remap.transport !== true && !/Shaping a workflow/.test(remapText) &&
          /Nothing was applied/.test(remapText) && /"Tenants export their data" is settled now/.test(String(remap.raw ?? '')) &&
          setAside?.status === 'rejected' && setAside?.metadata?.resolvedBy === 'auto' && waiting.length === 0
        : /Shaping a workflow \(patch\[0\] set_outcome_step_maps\) is available on Indie and above/.test(remapText) && /Nothing was created/.test(remapText),
      JSON.stringify({ remap: remapText.slice(0, 160), setAside: setAside ?? null, waiting: waiting.length }).slice(0, 400));

    // and the database refuses it even when nothing above is in the way
    const direct = await fetch(`${env.SUPABASE_URL}/rest/v1/outcome_step_maps`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
      body: JSON.stringify({ branch_id: fx.ids.branch, candidate_id: outcomeId, step_id: step.id }),
    });
    const body = await direct.text();
    s.check('even a direct write with the service key is refused by the guard',
      direct.status >= 400 && /decided outcomes keep the steps/i.test(body),
      `status ${direct.status}: ${body.slice(0, 200)}`);

    // a cascade must still work: deleting the decided outcome takes its maps
    await db.delete('requirement_candidates', `id=eq.${outcomeId}`);
    s.check('the guard never blocks a cascade — deleting the outcome takes its maps with it',
      (await db.select('outcome_step_maps', `candidate_id=eq.${outcomeId}&select=id`)).length === 0);

    return { s };
  },
};

export default [agentLane];

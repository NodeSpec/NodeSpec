// V3 5.2 bench rider (docs/V3_OVERHAUL_PLAN.md): the scenario that would
// have caught the dangling RPC. `supabase db reset` replays the whole
// migration chain and the seed on the LOCAL stack, then ONE propose_patches
// goes over the deployed function against a project created on that fresh
// stack. graph_reference_ids (the RPC every propose_patches call validates
// against) shipped deleted once; a fresh reset followed by one proposal is
// exactly the read that noticed nothing.
//
// OPT-IN (like ri-large-repo): the reset wipes every row, so it cannot run
// in the middle of the suite. Name it: npm run bench:auto -- --only=fresh-reset-propose
import { spawnSync } from 'node:child_process';
import { mcpCall, signIn, uid, Scenario, parseMcp } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';


export const freshResetPropose = {
  name: 'fresh-reset-propose',
  boxes: ['V3-5.2 the chain replays on a fresh reset', 'V3-5.2 one propose_patches lands on the fresh stack'],
  async run(env) {
    const s = new Scenario(this.name, this.boxes);

    // 1 — the reset. loadEnv already refused a non-local SUPABASE_URL, so
    // this can only ever wipe the local stack.
    const reset = spawnSync('supabase', ['db', 'reset'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60 * 1000 });
    const resetOut = `${reset.stdout ?? ''}${reset.stderr ?? ''}`.trim().slice(-800);
    s.check('supabase db reset replays the whole chain and the seed', reset.status === 0, reset.error ? String(reset.error) : resetOut);
    if (reset.status !== 0) return { s };

    // 2 — the seed re-created the bench user and its key: sign in again,
    // make a project on the fresh stack, file one proposal over the function.
    const session = await signIn(env);
    const fx = await createProject(env, session, 'fresh-reset');
    // UAT hardening 2026-09-27: the batch now names things only the RPC can
    // vouch for (the fixture's database node and its contract), so an RPC that
    // answered with nothing would refuse it; a made-up contract proves the
    // check is live and not waved through.
    const nodeId = uid();
    const edgeTo = (contractId) => ({
      type: 'add_edge', payload: { id: uid(), source: nodeId, target: fx.ids.nodeDb, contractId },
    });
    const proposed = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch,
      patches: [
        { type: 'add_node', payload: { id: nodeId, type: 'backend-service', label: 'Fresh-reset service' } },
        edgeTo(fx.ids.contract),
      ],
      explanations: ['One node and its edge to the existing database, filed right after a reset: the read that would have caught a dangling RPC.'],
      external_agent: 'bench · fresh reset',
    }));
    s.check('propose_patches lands on the fresh stack, its references to existing node and contract found by the RPC',
      !!proposed.proposalId && !proposed.isError, JSON.stringify(proposed).slice(0, 400));
    const bogusContract = uid();
    const refused = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch,
      patches: [
        { type: 'add_node', payload: { id: nodeId, type: 'backend-service', label: 'Fresh-reset service' } },
        edgeTo(bogusContract),
      ],
      explanations: ['A contract nobody made: must be refused by name.'],
      external_agent: 'bench · fresh reset',
    }));
    s.check('a reference to a contract that does not exist is refused by name, and nothing files',
      refused.isError === true && refused.transport !== true &&
      String(refused.raw).includes(bogusContract) && /no such contract exists on this branch/.test(String(refused.raw)) &&
      /No proposal was created/.test(String(refused.raw)),
      JSON.stringify(refused).slice(0, 400));
    if (proposed.proposalId) {
      const status = parseMcp(await mcpCall(env, 'get_proposal_status', { project_id: fx.ids.project, proposal_id: proposed.proposalId }));
      s.check('the proposal reads back pending', status.status === 'pending', JSON.stringify(status).slice(0, 300));
    }
    return { s };
  },
};

export default [freshResetPropose];

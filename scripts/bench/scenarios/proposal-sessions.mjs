// C2 (docs/WORK_LOOP_PLAN.md): chunked proposal sessions, live over MCP.
//
//   finalize:false starts a STAGED session (invisible to the review surface,
//   which lists 'pending' only) → proposal_id appends across calls →
//   finalize:true promotes everything to ONE pending proposal → a second
//   finalize is refused. No repo needed — proposals are DB-only.
import { rest, mcpCall, uid, Scenario } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

const parseMcp = (r) => {
  const text = r.data?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
};

export const proposalSessions = {
  name: 'proposal-sessions',
  boxes: [
    'C2 session staged (invisible) until finalized',
    'C2 append merges across calls',
    'C2 finalize → ONE pending proposal',
    'C2 double-finalize guard',
    'C3 truncation guards live',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'chunked');
    const db = rest(env);
    const base = { project_id: fx.ids.project, branch_id: fx.ids.branch };

    // Call 1: start the session with a contract (dependency order — the edge
    // batches that follow reference it, proving ordering holds ACROSS calls).
    const contractId = uid();
    const start = parseMcp(await mcpCall(env, 'propose_patches', {
      ...base, finalize: false,
      patches: [{ type: 'add_contract', payload: { id: contractId, kind: 'rest', name: 'Chunked API' } }],
      explanations: ['batch 1: the contract'],
    }));
    const proposalId = start?.proposalId;
    s.check('finalize:false starts a staged session', start?.status === 'staged' && !!proposalId,
      JSON.stringify(start ?? {}).slice(0, 300));

    const [row1] = await db.select('ai_proposals', `id=eq.${proposalId}&select=status,patches`);
    s.check('session row is STAGED — invisible to the review surface (which lists pending only)',
      row1?.status === 'staged');

    // Call 2: append a node.
    const nodeId = uid();
    const append = parseMcp(await mcpCall(env, 'propose_patches', {
      ...base, proposal_id: proposalId,
      patches: [{ type: 'add_node', payload: { id: nodeId, type: 'backend-service', label: 'Chunked Service' } }],
      explanations: ['batch 2: the node'],
    }));
    s.check('append merges into the session (2 total, still staged)',
      append?.status === 'staged' && append?.sessionPatchCount === 2 && append?.patchCountThisCall === 1,
      JSON.stringify(append ?? {}).slice(0, 300));

    // Call 3: final batch + finalize in one call.
    const node2 = uid();
    const fin = parseMcp(await mcpCall(env, 'propose_patches', {
      ...base, proposal_id: proposalId, finalize: true,
      patches: [{ type: 'add_node', payload: { id: node2, type: 'database', label: 'Chunked Store' } }],
      explanations: ['batch 3: the store'],
    }));
    s.check('finalize promotes the whole session to ONE pending proposal (3 patches)',
      fin?.status === 'pending' && fin?.sessionPatchCount === 3,
      JSON.stringify(fin ?? {}).slice(0, 300));

    const [row2] = await db.select('ai_proposals', `id=eq.${proposalId}&select=status,patches`);
    s.check('DB row is pending with all three batches merged',
      row2?.status === 'pending' && row2?.patches?.length === 3,
      `status=${row2?.status} patches=${row2?.patches?.length}`);

    // Double-finalize must be refused — the session is closed.
    const again = parseMcp(await mcpCall(env, 'propose_patches', {
      ...base, proposal_id: proposalId, finalize: true,
    }));
    s.check('double-finalize is refused with the already-finalized guard',
      JSON.stringify(again ?? {}).includes('already finalized'),
      JSON.stringify(again ?? {}).slice(0, 300));

    // The status tool sees one coherent proposal.
    const status = parseMcp(await mcpCall(env, 'get_proposal_status', { proposal_id: proposalId }));
    s.check('get_proposal_status reports the full session as one proposal',
      status?.patchSummary?.total === 3, JSON.stringify(status ?? {}).slice(0, 200));

    // C3, live: a deliberately huge single call is refused NAMING the limit
    // and the chunked continuation (the ~80KB payload also proves a large
    // body traverses the real transport intact), and a declared-intent
    // mismatch fails loudly instead of creating a fragment.
    const huge = parseMcp(await mcpCall(env, 'propose_patches', {
      ...base,
      patches: Array.from({ length: 501 }, () => ({ type: 'add_node', payload: { id: 'x' } })),
    }));
    const hugeText = JSON.stringify(huge ?? {});
    const short = parseMcp(await mcpCall(env, 'propose_patches', {
      ...base,
      patches: [{ type: 'add_contract', payload: { id: uid(), kind: 'rest', name: 'Half' } }],
      expected_patch_count: 2,
    }));
    const shortText = JSON.stringify(short ?? {});
    s.check('C3: oversized call names the limit + chunked path; short delivery fails loudly',
      hugeText.includes('500-per-call limit') && hugeText.includes('finalize: false') &&
      shortText.includes('Truncation detected'),
      `huge=${hugeText.slice(0, 150)} short=${shortText.slice(0, 150)}`);

    return { s, fx };
  },
};

export default [proposalSessions];

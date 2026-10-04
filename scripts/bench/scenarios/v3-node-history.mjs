// Item 27 with AA.7 (docs/V3_OVERHAUL_PLAN.md), live: a node's history is
// read at the app's door as the person, stays bounded however much the node
// holds, and says how much it leaves out; the agent's slice says the same;
// a stranger to the project reads none of it.
//
// The decisions are written as rows (a merged proposal is what the accept
// leaves behind): accepting an architecture change is the person's act in
// the app, and the bench cannot click. The READS are the product's own: the
// node_memory function through PostgREST as the signed-in person (RLS on),
// and get_project_context view slice over MCP.
import { rest, restAs, mcpCall, uid, Scenario, parseMcp, adminCreateUser, adminDeleteUser, signInAs } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

const REASONS = [
  'Split the router from the handlers',
  'Name the service for what it serves',
  'Bind the entry point',
  'Move the health check',
  'Drop the dead route',
];
const WHO = 'bench · history';

export const nodeHistory = {
  name: 'v3-node-history',
  boxes: [
    'Item 27 twenty decisions, newest first',
    'Item 27 three reasons and how many there were',
    "Item 27 a file edit is the file's history, not the node's",
    "AA.7 the agent's slice says what it leaves out",
    'AA.7 a stranger reads no history',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const db = rest(env);
    const fx = await createProject(env, session, 'nodehist');

    const [aiRun] = await db.insert('ai_runs', {
      project_id: fx.ids.project, branch_id: fx.ids.branch, model: 'bench', prompt_hash: 'bench-node-history',
      status: 'completed', input_snapshot_id: fx.ids.snapshot,
    });
    const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();
    const entry = (patch, explanation) => ({ status: 'accepted', explanation, patch });
    const rename = (label) => ({ type: 'update_node', payload: { id: fx.ids.nodeApi, changes: { label } } });
    const merged = (id, patches, ago) => ({
      id, ai_run_id: aiRun.id, source_branch_id: fx.ids.branch, proposal_branch_id: fx.ids.branch,
      status: 'merged', patches, metadata: { credentialLabel: WHO }, merged_at: minutesAgo(ago),
    });

    // Twenty-four older decisions on the node, one reason each; the newest
    // decision gives five reasons on the node and one on its neighbour; a
    // file edit on the node's file, newer than all of them, names the file.
    const newestId = uid();
    const fileEditId = uid();
    await db.insert('ai_proposals', [
      ...Array.from({ length: 24 }, (_, i) => merged(uid(), [entry(rename(`API Service v${i}`), `Decision ${i}`)], 120 - i)),
      merged(newestId, [
        ...REASONS.map((r) => entry(rename('API Service'), r)),
        entry({ type: 'update_node', payload: { id: fx.ids.nodeDb, changes: { label: 'Primary Database' } } }, 'The database keeps its name'),
      ], 2),
      merged(fileEditId, [entry({ type: 'update_artifact', payload: { id: fx.ids.artifact, changes: { content: 'export {}\n' } } }, 'Tighten the handler')], 1),
    ]);

    const args = { p_project_id: fx.ids.project, p_branch_id: fx.ids.branch, p_node_id: fx.ids.nodeApi };
    const read = await restAs(env, session).rpc('node_memory', args);
    const decisions = read.data?.decisions ?? [];
    s.check('the person reads the node\'s history at the app\'s door', read.ok && Array.isArray(read.data?.decisions),
      JSON.stringify(read).slice(0, 300));
    s.check('twenty decisions of the twenty-five on the node, newest first',
      decisions.length === 20 && decisions[0]?.proposalId === newestId &&
      decisions.every((d, i) => i === 0 || Date.parse(decisions[i - 1].at) >= Date.parse(d.at)),
      `count ${decisions.length}, first ${decisions[0]?.proposalId ?? 'none'} (expected ${newestId})`);
    const top = decisions[0];
    s.check('the newest decision keeps its first three reasons in order and counts all five; the neighbour\'s reason is not the node\'s',
      JSON.stringify(top?.explanations) === JSON.stringify(REASONS.slice(0, 3)) && top?.explanationCount === 5 && top?.who === WHO,
      JSON.stringify(top ?? null).slice(0, 300));
    s.check('a file edit is the file\'s history: it is not among the node\'s decisions',
      !decisions.some((d) => d.proposalId === fileEditId), JSON.stringify(decisions.map((d) => d.proposalId)).slice(0, 200));

    // The agent's view: the slice's memory says how many reasons it does not show.
    const slice = parseMcp(await mcpCall(env, 'get_project_context', {
      project_id: fx.ids.project, branch_id: fx.ids.branch, target_type: 'node', target_id: fx.ids.nodeApi, view: 'slice',
    }));
    const memory = slice.slice?.memory ?? [];
    const shown = memory.find((m) => m.kind === 'decision' && m.proposalId === newestId);
    s.check('the agent\'s slice carries the decision with its first reason and "and 2 more"',
      slice.isError !== true && String(shown?.text ?? '').includes(REASONS[0]) && String(shown?.text ?? '').includes('; and 2 more') &&
      !String(shown?.text ?? '').includes(REASONS[3]),
      JSON.stringify(shown ?? { memory: memory.length, raw: slice.raw }).slice(0, 300));
    s.check('the slice keeps the same twenty decisions', memory.filter((m) => m.kind === 'decision').length === 20,
      `decisions in the slice: ${memory.filter((m) => m.kind === 'decision').length}`);

    // A stranger: signed in, no seat on this project.
    const email = `bench-stranger-${uid().slice(0, 8)}@nodespec.local`;
    const password = `bench-${uid()}`;
    const strangerId = await adminCreateUser(env, email, password);
    try {
      const stranger = await signInAs(env, email, password);
      const theirs = await restAs(env, stranger).rpc('node_memory', args);
      s.check('a stranger to the project reads no history of its node',
        theirs.ok && (theirs.data?.decisions ?? []).length === 0 && (theirs.data?.changes ?? []).length === 0,
        JSON.stringify(theirs).slice(0, 300));
    } finally {
      await adminDeleteUser(env, strangerId);
    }
    return { s, fx };
  },
};

export default [nodeHistory];

// AL.28 (owner 2026-10-08, a live production bug): get_test_plan filed a
// plan as "create the file, then link it to its node", the engine ran the
// link first, and under Auto the server set every one aside (33 in one
// project) with MISSING_ARTIFACT. No scenario ran it: r6 checked the plan was
// pending, then wrote the accepted end state into the snapshot itself.
//
// This runs the whole lane on the deployed stack with Architecture at Auto
// (the lane a plan or task-doc file rides), the way the production project
// was set: plans and a task doc filed at once, two sweeps racing (the app's
// project-open sweep and the toggle's), and every read that must then agree.
import { rest, mcpCall, uid, Scenario, parseMcp } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

const latestGraph = async (db, branchId) => {
  const [snap] = await db.select('graph_snapshots', `branch_id=eq.${branchId}&select=graph_data,patch_sequence&order=patch_sequence.desc,created_at.desc&limit=1`);
  return snap?.graph_data ?? { nodes: {}, artifacts: {} };
};

/** No node links a file twice, a file that is not there, or another
 *  node's file. (The fixture writes its snapshot directly, with two seeded
 *  files on API Service missing from its list; the engine never builds that,
 *  and this scenario does not judge it. The new files are checked by id.) */
const linkFaults = (graph) => Object.values(graph.nodes ?? {}).flatMap((n) => {
  const linked = n.artifacts ?? [];
  const faults = [];
  if (new Set(linked).size !== linked.length) faults.push(`${n.label}: links a file twice ${JSON.stringify(linked)}`);
  for (const id of linked) {
    const a = graph.artifacts?.[id];
    if (!a) faults.push(`${n.label}: links ${id}, which is not there`);
    else if (a.nodeId !== n.id) faults.push(`${n.label}: links ${id}, which is ${a.nodeId}'s`);
  }
  return faults;
});

export const autoPlans = {
  name: 'al28-auto-plans',
  boxes: [
    'AL.28 get_test_plan proposals apply under Auto (no MISSING_ARTIFACT)',
    'AL.28 racing sweeps apply each proposal once',
    'AL.28 a new task doc applies under Auto',
    'AL.28 every lane reads the same plan (get_test_plan, report_test_results, get_project_status)',
    'AL.28 a plan filed by hand under the row id is the plan',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'al28plans');
    const db = rest(env);
    await db.update('projects', `id=eq.${fx.ids.project}`, { automation_policy: { architecture: 2 } });

    // 1. Two plans for two requirements on the same node, asked for at once.
    const asked = (await Promise.all(['req1', 'req2'].map((k) => mcpCall(env, 'get_test_plan', {
      project_id: fx.ids.project, requirement_id: fx.ids[k], external_agent: 'bench · planner',
    })))).map(parseMcp);
    const ids = asked.map((p) => p?.proposalId).filter(Boolean);
    s.check('both plans are new and filed as proposals', asked.every((p) => p?.testPlanIsNew === true) && ids.length === 2,
      JSON.stringify(asked.map((p) => ({ isNew: p?.testPlanIsNew, proposalId: p?.proposalId, err: p?.raw }))).slice(0, 400));
    const filed = ids.length ? await db.select('ai_proposals', `id=in.(${ids.join(',')})&select=id,patches`) : [];
    s.check('each proposal is one add_artifact on API Service, no link step',
      filed.length === 2 && filed.every((p) => p.patches.length === 1 && p.patches[0].patch.type === 'add_artifact' && p.patches[0].patch.payload.nodeId === fx.ids.nodeApi),
      JSON.stringify(filed.map((p) => p.patches.map((e) => [e.patch.type, e.patch.payload?.nodeId]))).slice(0, 300));

    // 2. Two sweeps at once: the app's on project open and the Auto toggle's.
    const sweeps = (await Promise.all([0, 1].map(() => mcpCall(env, 'resolve_proposal', { project_id: fx.ids.project, action: 'auto' })))).map(parseMcp);
    const appliedIds = sweeps.flatMap((sw) => (sw?.applied ?? []).map((a) => a.proposalId));
    s.check('the racing sweeps apply each plan exactly once, none set aside',
      appliedIds.length === 2 && new Set(appliedIds).size === 2 && sweeps.every((sw) => (sw?.setAside ?? []).length === 0),
      JSON.stringify(sweeps).slice(0, 500));
    const decided = ids.length ? await db.select('ai_proposals', `id=in.(${ids.join(',')})&select=status,metadata`) : [];
    s.check('both proposals read merged by Auto with no refusal note',
      decided.length === 2 && decided.every((p) => p.status === 'merged' && p.metadata?.resolvedBy === 'auto' && !p.metadata?.resolveNote),
      JSON.stringify(decided.map((p) => [p.status, p.metadata?.resolvedBy, p.metadata?.resolveNote])).slice(0, 400));
    const planIds = filed.map((p) => p.patches[0].patch.payload.id);
    const logged = planIds.length ? await db.select('graph_patches', `branch_id=eq.${fx.ids.branch}&select=id,payload`) : [];
    s.check('each plan is in the branch log once',
      planIds.every((pid) => logged.filter((r) => r.payload?.payload?.id === pid).length === 1),
      JSON.stringify(logged.map((r) => r.payload?.type)).slice(0, 300));

    let graph = await latestGraph(db, fx.ids.branch);
    s.check('API Service links both plans once; no node links a file twice, missing, or another node\'s',
      planIds.every((pid) => (graph.nodes[fx.ids.nodeApi]?.artifacts ?? []).filter((x) => x === pid).length === 1) && linkFaults(graph).length === 0,
      JSON.stringify({ faults: linkFaults(graph), api: graph.nodes[fx.ids.nodeApi]?.artifacts }).slice(0, 400));

    // 3. Asked again, the plans are the ones that landed: nothing new is filed.
    const again = (await Promise.all(['req1', 'req2'].map((k) => mcpCall(env, 'get_test_plan', { project_id: fx.ids.project, requirement_id: fx.ids[k] })))).map(parseMcp);
    s.check('get_test_plan now finds both plans and files nothing',
      again.every((p) => p?.testPlanIsNew === false && !p?.proposalId),
      JSON.stringify(again.map((p) => ({ isNew: p?.testPlanIsNew, proposalId: p?.proposalId }))).slice(0, 300));
    const report = parseMcp(await mcpCall(env, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: 'REQ-001', external_agent: 'bench · planner',
      results: [{ test_id: 'TC-801', status: 'passed', name: 'tasks persist', criterion_text: 'tasks persist across restarts' }],
    }));
    s.check('report_test_results ties the result to the same plan',
      report?.testPlan?.exists === true && report?.testPlan?.path === '.nodespec/tests/req-001.tests.md',
      JSON.stringify({ testPlan: report?.testPlan, warnings: report?.warnings }).slice(0, 300));

    // 4. A new task document, filed and swept the same way.
    const docs = parseMcp(await mcpCall(env, 'generate_task_docs', {
      project_id: fx.ids.project, branch_id: fx.ids.branch, node_ids: ['Primary Database'], external_agent: 'bench · planner',
    }));
    const [docProposal] = docs?.proposalId ? await db.select('ai_proposals', `id=eq.${docs.proposalId}&select=patches`) : [];
    s.check('the new task doc is one add_artifact on Primary Database',
      docProposal?.patches?.length === 1 && docProposal.patches[0].patch.type === 'add_artifact' && docProposal.patches[0].patch.payload.nodeId === fx.ids.nodeDb,
      JSON.stringify({ docs, patches: docProposal?.patches?.map((e) => e.patch.type) }).slice(0, 400));
    const docSweep = parseMcp(await mcpCall(env, 'resolve_proposal', { project_id: fx.ids.project, action: 'auto' }));
    s.check('the sweep applies the task doc', (docSweep?.applied ?? []).some((a) => a.proposalId === docs?.proposalId),
      JSON.stringify(docSweep).slice(0, 400));
    graph = await latestGraph(db, fx.ids.branch);
    const docId = docProposal?.patches?.[0]?.patch?.payload?.id;
    s.check('Primary Database links its task doc; the canvas links nothing twice or missing',
      !!docId && (graph.nodes[fx.ids.nodeDb]?.artifacts ?? []).includes(docId) && linkFaults(graph).length === 0,
      JSON.stringify({ faults: linkFaults(graph), db: graph.nodes[fx.ids.nodeDb]?.artifacts }).slice(0, 400));

    // 5. A plan filed by hand the way the production agent did: the row id in
    // metadata.requirementId and an upper-case path. It is the plan.
    const created = parseMcp(await mcpCall(env, 'create_requirement', {
      project_id: fx.ids.project, name: 'Export tasks', description: 'Tasks export as CSV',
      acceptance_criteria: ['an export holds every task'],
    }));
    const [row3] = await db.select('specification_requirements', `specification_id=eq.${fx.ids.spec}&requirement_id=eq.${created?.requirementId}&select=id`);
    await mcpCall(env, 'map_requirement', { project_id: fx.ids.project, requirement_id: created?.requirementId, node_ids: [fx.ids.nodeApi], mode: 'replace' });
    const at = new Date().toISOString();
    const handId = uid();
    const hand = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, external_agent: 'bench · hand-filer',
      patches: [{ type: 'add_artifact', payload: {
        id: handId, nodeId: fx.ids.nodeApi, kind: 'test-plan', path: `.nodespec/tests/${created?.requirementId}.tests.md`,
        content: '# Test plan, written by hand\n\n## Test Strategy\nExport through the public API only.\n', language: 'markdown', status: 'draft',
        createdAt: at, updatedAt: at, metadata: { requirementId: row3?.id },
      } }],
      explanations: ['bench: a plan filed by hand under the row id'],
    }));
    s.check('the hand-filed plan applies as it files (Architecture at Auto)', hand?.routed === 'applied',
      JSON.stringify(hand).slice(0, 300));
    const handRead = parseMcp(await mcpCall(env, 'get_test_plan', { project_id: fx.ids.project, requirement_id: row3?.id }));
    s.check('get_test_plan serves the hand-filed plan and files no second one',
      handRead?.testPlanIsNew === false && !handRead?.proposalId && String(handRead?.testPlanContent ?? '').includes('written by hand'),
      JSON.stringify({ isNew: handRead?.testPlanIsNew, proposalId: handRead?.proposalId }).slice(0, 300));

    const status = parseMcp(await mcpCall(env, 'get_project_status', { project_id: fx.ids.project }));
    s.check('get_project_status counts the three requirements that have a plan, as the other lanes find them',
      status?.testCoverage?.requirementsWithTestPlans === 3 && status?.testCoverage?.requirementsWithoutTestPlans === 0,
      JSON.stringify(status?.testCoverage).slice(0, 300));
    return { s, fx };
  },
};

export default [autoPlans];

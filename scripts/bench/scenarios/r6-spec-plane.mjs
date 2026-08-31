// SB-4 scenarios 17–18: R6 — the spec plane at scale, live.
//
// Two scenarios covering the four authored R6 bench legs:
//   r6-vision-lane        (1) update_vision over MCP → git-push regenerates the
//                             task packet AND the committed doc embeds the new
//                             vision — the visionHash fingerprint leg END TO END
//                             (Discovered #9/#10).
//   r6-relations-coupling (2) create_requirement with relations[] records
//                             lineage at creation (source 'ai');
//                         (3) derived coupling flips shared_node → adjacent when
//                             map_requirement moves a requirement across an edge;
//                         (4) two rapid auto-numbered creates land distinct ids
//                             (Discovered #8, the numbering race).
import { callFn, github, rest, mcpCall, uid, until, Scenario } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const parse = (r) => {
  const text = r.data?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
};

export const visionLane = {
  name: 'r6-vision-lane',
  boxes: ['R6 leg 1 (visionHash end to end, fresh-fingerprint baseline)', 'N5.17 live (preserve + flag + exclusion)', 'cross-lane fingerprint agreement'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'r6vision');
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const db = rest(env);
    const gh = github(env);

    // Seed a MANAGED task doc (fingerprint present → refreshable, the C1
    // provenance guard) with a deliberately stale fingerprint. The fixture's
    // unmanaged task artifact is REMOVED from this project's snapshot so nodeApi
    // carries exactly ONE task artifact — findExistingTaskArtifact resolves by
    // (nodeId, kind), and two docs on one node would make generate_task_docs'
    // update target ambiguous.
    const artId = uid();
    const graph = structuredClone(fx.graph);
    delete graph.artifacts[fx.ids.taskArtifact];
    graph.nodes[fx.ids.nodeApi].artifacts = [];
    graph.artifacts[artId] = {
      id: artId, nodeId: fx.ids.nodeApi, path: '.nodespec/tasks/api-service-managed.task.md',
      kind: 'task', status: 'draft',
      content: '# Task: API Service\n(stale — regenerate)\n',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      metadata: { taskContextFingerprint: { fingerprint: 'bench-stale' } },
    };
    await db.insert('graph_snapshots', {
      id: uid(), project_id: fx.ids.project, branch_id: fx.ids.branch,
      version: 1, hash: 'benchfix-r6', patch_sequence: 1, graph_data: graph,
    });

    // Push 1: regenerates the stale doc with the CURRENT vision (in memory — the
    // gate never writes snapshots, which is exactly why the steps below exist).
    const push1 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push1.data.success, JSON.stringify(push1.data).slice(0, 300));
    s.check('setup push refreshed the seeded stale doc', (push1.data.packetsRefreshed ?? 0) >= 1,
      JSON.stringify(push1.data).slice(0, 300));
    const doc1 = await gh.getFileEventually('.nodespec/tasks/api-service-managed.task.md', 'main');
    s.check('committed doc carries the N5.17 Implementation Context scaffold + directive',
      !!doc1 && doc1.content.includes('## Implementation Context') && doc1.content.includes('author this section BEFORE building'),
      doc1?.content?.slice(0, 400) ?? 'doc never appeared');

    // BENCH-AUDIT HARDENING (2026-08-09): the push gate refreshes IN MEMORY only —
    // the DB fingerprint stays 'bench-stale' forever, so "refreshed ≥ 1" on a later
    // push would hold with or without the visionHash mechanism (a vacuous pin, the
    // round-12 class). Make it real: persist a FRESH server-computed fingerprint via
    // the generate_task_docs lane (applying its update patch the way UI acceptance
    // does), so the only thing that can re-stale the packet afterwards is a true
    // fingerprint input change.
    const gen = parse(await mcpCall(env, 'generate_task_docs', {
      project_id: fx.ids.project, branch_id: fx.ids.branch, node_ids: ['API Service'],
      external_agent: 'bench-harness',
    }));
    s.check('generate_task_docs parks a refresh proposal for the managed doc', !!gen?.proposalId,
      JSON.stringify(gen).slice(0, 300));
    const [genProposal] = gen?.proposalId
      ? await db.select('ai_proposals', `id=eq.${gen.proposalId}&select=patches`)
      : [];
    const updPatch = (genProposal?.patches ?? []).map((p) => p.patch)
      .find((p) => p.type === 'update_artifact' && p.payload?.id === artId);
    const freshFp = updPatch?.payload?.changes?.metadata?.taskContextFingerprint?.fingerprint;
    s.check('update patch targets the managed doc with a fresh server-computed fingerprint',
      !!updPatch && typeof freshFp === 'string' && freshFp !== 'bench-stale',
      JSON.stringify(updPatch?.payload?.changes?.metadata ?? genProposal ?? null).slice(0, 300));
    if (!updPatch) return { s, fx, integrationId }; // nothing to apply — the checks above are the report

    // Apply the patch (acceptance's end state) AND author the Implementation
    // Context section in the same snapshot — an accepted out-of-band edit.
    const AUTHORED_LINE = 'AUTHORED BENCH CONTEXT: Express reaches the Store through the SQL contract; pool size 5 by bench finding.';
    const graph2 = structuredClone(graph);
    graph2.artifacts[artId] = { ...graph2.artifacts[artId], ...updPatch.payload.changes };
    s.check('authoring target: the regenerated content carries the scaffold placeholder',
      String(graph2.artifacts[artId].content ?? '').includes('_Not yet authored._'),
      String(graph2.artifacts[artId].content ?? '').slice(0, 200));
    graph2.artifacts[artId].content = String(graph2.artifacts[artId].content)
      .replace(/_Not yet authored\._[^\n]*/, AUTHORED_LINE);
    await db.insert('graph_snapshots', {
      id: uid(), project_id: fx.ids.project, branch_id: fx.ids.branch,
      version: 2, hash: 'benchfix-r6-authored', patch_sequence: 2, graph_data: graph2,
    });

    // Push 2 — the NEGATIVE CONTROL, two live claims at once: (a) cross-lane
    // fingerprint agreement (generate_task_docs' fingerprint satisfies the push
    // gate — refreshed must be 0), (b) N5.17 fingerprint exclusion (the authored
    // edit is a content change, and content is never a fingerprint input).
    await until(async () => (await gh.headSha('main')) === push1.data.commitSha, { timeoutMs: 20000, everyMs: 2000 });
    const push2 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId,
    });
    s.check('authored-edit push succeeds', push2.data.success, JSON.stringify(push2.data).slice(0, 300));
    s.check('NEGATIVE CONTROL: fresh fingerprint + authored edit → packetsRefreshed 0 (cross-lane agreement + N5.17 exclusion, live)',
      (push2.data.packetsRefreshed ?? 0) === 0, JSON.stringify(push2.data).slice(0, 300));
    const docWhen = (pred) => until(async () => {
      const f = await gh.getFile('.nodespec/tasks/api-service-managed.task.md', 'main');
      return f && pred(f.content) ? f : null;
    }, { timeoutMs: 30000, everyMs: 2000 });
    const doc2 = await docWhen((c) => c.includes(AUTHORED_LINE));
    s.check('committed doc carries the AUTHORED prose, no review marker yet',
      !!doc2 && !doc2.content.includes('REVIEW NEEDED'), doc2?.content?.slice(0, 300) ?? 'authored content never appeared');

    // The vision edit — over MCP, the C3 write lane.
    const NEW_VISION = 'R6 BENCH VISION: a task API whose packets follow the vision';
    const vis = parse(await mcpCall(env, 'update_vision', { project_id: fx.ids.project, vision: NEW_VISION }));
    s.check('update_vision succeeds over MCP', vis?.vision === NEW_VISION || vis?.updated === true || !vis?.isError,
      JSON.stringify(vis).slice(0, 300));

    // Push 3: NOTHING changed but the vision, against a genuinely FRESH
    // fingerprint — visionHash alone must re-stale the packet (the R6 leg-1 pin,
    // now non-vacuous). N5.17 preservation rides the same regeneration: authored
    // prose survives verbatim and gains the REVIEW-NEEDED flag.
    await until(async () => (await gh.headSha('main')) === push2.data.commitSha, { timeoutMs: 20000, everyMs: 2000 });
    const push3 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId,
    });
    s.check('post-vision push succeeds', push3.data.success, JSON.stringify(push3.data).slice(0, 300));
    s.check('vision edit ALONE re-staled the packet (packetsRefreshed ≥ 1, fresh-fingerprint baseline)',
      (push3.data.packetsRefreshed ?? 0) >= 1, JSON.stringify(push3.data).slice(0, 300));
    const doc3 = await docWhen((c) => c.includes(NEW_VISION));
    s.check('committed task doc embeds the NEW vision text', !!doc3, 'vision never appeared in the doc');
    if (doc3) {
      s.check('N5.17 LIVE: authored prose SURVIVED the regeneration verbatim',
        doc3.content.includes(AUTHORED_LINE), doc3.content.slice(0, 400));
      s.check('N5.17 LIVE: regeneration flagged the authored section REVIEW NEEDED (placeholder stays gone)',
        doc3.content.includes('REVIEW NEEDED') && !doc3.content.includes('_Not yet authored._'),
        doc3.content.slice(0, 400));
    }
    return { s, fx, integrationId };
  },
};

export const relationsCoupling = {
  name: 'r6-relations-coupling',
  boxes: ['R6 legs 2-4 (authored relations · derived coupling · numbering race)', 'Discovered #6/#8 closed'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'r6rel');
    const db = rest(env);

    // (3a) Both seeded requirements map nodeApi → shared_node coupling out of the box.
    let list = parse(await mcpCall(env, 'list_requirements', { project_id: fx.ids.project }));
    const req1Before = (list?.requirements ?? []).find((r) => r.requirementId === 'REQ-001');
    s.check('coupling: co-mapped requirements read shared_node via the node LABEL',
      (req1Before?.coupling ?? []).some((c) => c.requirementId === 'REQ-002' && c.kind === 'shared_node' && c.via === 'API Service'),
      JSON.stringify(req1Before?.coupling).slice(0, 300));

    // (2) Lineage recorded AT creation: create_requirement carries relations[].
    const created = parse(await mcpCall(env, 'create_requirement', {
      project_id: fx.ids.project,
      name: 'Archive tasks', description: 'Completed tasks can be archived',
      relations: [
        { to: 'REQ-001', type: 'expands' },
        { to: 'REQ-999', type: 'expands' }, // bogus target — reported, never fatal
      ],
    }));
    s.check('create_requirement with relations succeeds', created?.requirementId === 'REQ-003',
      JSON.stringify(created).slice(0, 300));
    s.check('lineage recorded (relationsCreated) and the bogus target reported (relationsFailed), non-fatal',
      (created?.relationsCreated ?? []).some((r) => r.to === 'REQ-001' && r.type === 'expands') &&
      (created?.relationsFailed ?? []).some((r) => r.to === 'REQ-999'),
      JSON.stringify({ created: created?.relationsCreated, failed: created?.relationsFailed }).slice(0, 300));

    const rows = await db.select('specification_requirement_relations',
      `specification_id=eq.${fx.ids.spec}&select=from_requirement_id,to_requirement_id,relation_type,source`);
    s.check('DB: exactly one relation row, source ai, expands onto REQ-001',
      rows.length === 1 && rows[0].relation_type === 'expands' && rows[0].source === 'ai' &&
      rows[0].to_requirement_id === fx.ids.req1, JSON.stringify(rows).slice(0, 300));

    list = parse(await mcpCall(env, 'list_requirements', { project_id: fx.ids.project }));
    const req3 = (list?.requirements ?? []).find((r) => r.requirementId === 'REQ-003');
    const req1 = (list?.requirements ?? []).find((r) => r.requirementId === 'REQ-001');
    s.check('list_requirements carries the relation BOTH directions (from on REQ-003, to on REQ-001)',
      (req3?.relations?.from ?? []).some((r) => r.to === 'REQ-001' && r.type === 'expands') &&
      (req1?.relations?.to ?? []).some((r) => r.from === 'REQ-003' && r.type === 'expands'),
      JSON.stringify({ req3: req3?.relations, req1: req1?.relations }).slice(0, 300));

    // (3b) Move REQ-002 across the edge → the coupling flips to adjacent,
    // via names the bridging edge.
    const moved = parse(await mcpCall(env, 'map_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-002', node_ids: [fx.ids.nodeDb], mode: 'replace',
    }));
    s.check('map_requirement replace moves REQ-002 to the database node', !moved?.isError,
      JSON.stringify(moved).slice(0, 200));
    list = parse(await mcpCall(env, 'list_requirements', { project_id: fx.ids.project }));
    const req1After = (list?.requirements ?? []).find((r) => r.requirementId === 'REQ-001');
    s.check('coupling flips to adjacent, via names the bridging edge "API Service → Primary Database"',
      (req1After?.coupling ?? []).some((c) => c.requirementId === 'REQ-002' && c.kind === 'adjacent' && c.via === 'API Service → Primary Database'),
      JSON.stringify(req1After?.coupling).slice(0, 300));

    // (4) Discovered #8: two RAPID auto-numbered creates → distinct ids (the
    // 23505 retry recomputes; pre-R6 both could land the same client-computed id).
    const [a, b] = (await Promise.all([
      mcpCall(env, 'create_requirement', { project_id: fx.ids.project, name: 'Rapid A', description: 'race a' }),
      mcpCall(env, 'create_requirement', { project_id: fx.ids.project, name: 'Rapid B', description: 'race b' }),
    ])).map(parse);
    s.check('both rapid creates succeed', !!a?.requirementId && !!b?.requirementId,
      JSON.stringify({ a, b }).slice(0, 300));
    s.check('rapid auto-numbered creates land DISTINCT ids', a?.requirementId !== b?.requirementId,
      `${a?.requirementId} vs ${b?.requirementId}`);
    return { s, fx };
  },
};

export const canvasData = {
  name: 'r6-canvas-data',
  boxes: ['Section G data contract (archived lineage inputs · test roll-up inputs · plan↔evidence alignment)'],
  // The Decomposition canvas's Section G features are client-pure (vitest-pinned:
  // computeArchivedLineage, roll-up, bundling) — this scenario proves the SERVED
  // DATA they consume; the rendered canvas is the owner's visual spot-check.
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'r6canvas');
    const db = rest(env);

    // Archival predicate inputs: REQ-001 completed + expanded by a successor.
    const upd = parse(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-001', status: 'implemented',
    }));
    s.check('REQ-001 marked implemented', !upd?.isError, JSON.stringify(upd).slice(0, 200));
    const created = parse(await mcpCall(env, 'create_requirement', {
      project_id: fx.ids.project, name: 'Store tasks v2', description: 'Supersedes v1',
      relations: [{ to: 'REQ-001', type: 'expands' }],
    }));
    s.check('successor created with expands lineage', created?.requirementId === 'REQ-003' &&
      (created?.relationsCreated ?? []).some((r) => r.to === 'REQ-001' && r.type === 'expands'),
      JSON.stringify(created).slice(0, 250));

    const list = parse(await mcpCall(env, 'list_requirements', { project_id: fx.ids.project }));
    const r1 = (list?.requirements ?? []).find((r) => r.requirementId === 'REQ-001');
    const r3 = (list?.requirements ?? []).find((r) => r.requirementId === 'REQ-003');
    s.check('archival inputs served: target implemented + incoming expands; expander carries outgoing',
      r1?.status === 'implemented' &&
      (r1?.relations?.to ?? []).some((x) => x.from === 'REQ-003' && x.type === 'expands') &&
      (r3?.relations?.from ?? []).some((x) => x.to === 'REQ-001' && x.type === 'expands'),
      JSON.stringify({ r1: { status: r1?.status, rel: r1?.relations }, r3: r3?.relations }).slice(0, 300));

    // Roll-up inputs: mixed test outcomes on the ACTIVE requirement.
    const report = parse(await mcpCall(env, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: 'REQ-002', external_agent: 'bench-harness',
      results: [
        { test_id: 'TC-101', status: 'passed', name: 'filter works' },
        { test_id: 'TC-102', status: 'failed', name: 'sort works' },
        { test_id: 'TC-103', status: 'not_started', name: 'paging works' },
      ],
    }));
    s.check('mixed outcomes reported', report?.reported === 3, JSON.stringify(report).slice(0, 200));
    const rows = await db.select('test_cases', `requirement_id=eq.${fx.ids.req2}&select=test_id,status,stale&order=test_id`);
    s.check('roll-up inputs served: one passed, one failed, one pending, none stale',
      rows.length === 3 &&
      rows.filter((r) => r.status === 'passed').length === 1 &&
      rows.filter((r) => r.status === 'failed').length === 1 &&
      rows.filter((r) => r.status === 'not_started').length === 1 &&
      rows.every((r) => r.stale === false),
      JSON.stringify(rows).slice(0, 250));

    // ── Plan↔evidence alignment (the owner-caught orphan): evidence rows with no
    // stored test-plan artifact must be VISIBLE as orphans, and the plan lane must
    // close the loop. The fixture graph carries a task doc but no test plan, so the
    // report above is exactly the orphan state the live bench surfaced.
    s.check('orphaned evidence is reported: testPlan.exists false + warning naming get_test_plan',
      report?.testPlan?.exists === false &&
      (report?.warnings ?? []).some((w) => w.includes('No test plan') && w.includes('get_test_plan')),
      JSON.stringify({ testPlan: report?.testPlan, warnings: report?.warnings }).slice(0, 300));

    // Upstream: get_test_plan generates the missing plan and PARKS it as a pending
    // proposal (the inversion: NodeSpec never writes the graph on its own).
    const plan = parse(await mcpCall(env, 'get_test_plan', {
      project_id: fx.ids.project, branch_id: fx.ids.branch, requirement_id: fx.ids.req2,
    }));
    s.check('get_test_plan generated a fresh plan and parked a proposal',
      plan?.testPlanIsNew === true && !!plan?.proposalId, JSON.stringify({ isNew: plan?.testPlanIsNew, proposalId: plan?.proposalId }).slice(0, 200));
    const [proposal] = plan?.proposalId
      ? await db.select('ai_proposals', `id=eq.${plan.proposalId}&select=status,patches`)
      : [];
    const planPatch = (proposal?.patches ?? []).map((p) => p.patch).find((p) => p.type === 'add_artifact');
    s.check('parked proposal is pending with an add_artifact kind test-plan carrying metadata.requirementId',
      proposal?.status === 'pending' && planPatch?.payload?.kind === 'test-plan' &&
      planPatch?.payload?.metadata?.requirementId === 'REQ-002',
      JSON.stringify({ status: proposal?.status, kind: planPatch?.payload?.kind, meta: planPatch?.payload?.metadata }).slice(0, 300));

    // Acceptance is a CLIENT act (the user clicks accept; patches apply into a new
    // snapshot) — mirror its end state directly, as the c4 scenario seeds artifacts.
    const graph2 = structuredClone(fx.graph);
    graph2.artifacts[planPatch.payload.id] = planPatch.payload;
    await db.insert('graph_snapshots', {
      id: uid(), project_id: fx.ids.project, branch_id: fx.ids.branch,
      version: 1, hash: 'benchfix-plan-accepted', patch_sequence: 1, graph_data: graph2,
    });

    // Downstream re-report: with the plan stored, the same lane reads ALIGNED —
    // exists true at the id-only path, and the orphan warning is gone.
    const report2 = parse(await mcpCall(env, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: 'REQ-002', external_agent: 'bench-harness',
      results: [{ test_id: 'TC-102', status: 'passed', name: 'sort works' }],
    }));
    s.check('aligned re-report: testPlan {exists, path} and NO orphan warning',
      report2?.testPlan?.exists === true &&
      report2?.testPlan?.path === '.nodespec/tests/req-002.tests.md' &&
      !(report2?.warnings ?? []).some((w) => w.includes('No test plan')),
      JSON.stringify({ testPlan: report2?.testPlan, warnings: report2?.warnings }).slice(0, 300));
    return { s, fx };
  },
};

// Owner 2026-08-22: the AI can categorize requirements into sections — the
// same specification_sections the app manages by hand. Name resolution is
// trimmed + case-insensitive; a miss creates the section at end-of-order;
// update moves by name and clears with null.
export const sectionLane = {
  name: 'req-sections',
  boxes: [
    'create_requirement section: create-on-miss + case-insensitive reuse (ONE row)',
    'update_requirement section: move by name, clear with null',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'sections');
    const db = rest(env);

    const first = parse(await mcpCall(env, 'create_requirement', {
      project_id: fx.ids.project, name: 'Billing export', description: 'CSV export of invoices',
      section: 'Billing',
    }));
    const second = parse(await mcpCall(env, 'create_requirement', {
      project_id: fx.ids.project, name: 'Billing webhooks', description: 'Stripe webhook intake',
      section: '  billing ', // different casing + whitespace — must NOT mint a duplicate
    }));
    s.check('both creates filed; the canonical stored name echoed both times',
      first?.section === 'Billing' && second?.section === 'Billing',
      JSON.stringify({ first, second }).slice(0, 300));

    const sectionRows = await db.select('specification_sections',
      `specification_id=eq.${fx.ids.spec}&select=id,name,order_index`);
    const billingRows = (sectionRows ?? []).filter((r) => r.name === 'Billing');
    s.check('ONE Billing section row exists (case-insensitive reuse, no duplicate)',
      billingRows.length === 1, JSON.stringify(sectionRows).slice(0, 300));

    let list = parse(await mcpCall(env, 'list_requirements', { project_id: fx.ids.project }));
    const filed = (list?.requirements ?? []).filter((r) => r.sectionName === 'Billing');
    s.check('list_requirements reads both back under Billing',
      filed.length === 2, JSON.stringify(filed.map((r) => r.requirementId)).slice(0, 200));

    // Move by name (creates 'Platform' on the miss), then clear with null.
    const moved = parse(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: second.requirementId, section: 'Platform',
    }));
    s.check('update moves the requirement to a NEW section and echoes it',
      moved?.section === 'Platform' && (moved?.updatedFields ?? []).includes('section_id'),
      JSON.stringify(moved).slice(0, 200));
    const cleared = parse(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: first.requirementId, section: null,
    }));
    s.check('update with section null clears', cleared?.success !== false,
      JSON.stringify(cleared).slice(0, 200));

    list = parse(await mcpCall(env, 'list_requirements', { project_id: fx.ids.project }));
    const firstRow = (list?.requirements ?? []).find((r) => r.requirementId === first.requirementId);
    const secondRow = (list?.requirements ?? []).find((r) => r.requirementId === second.requirementId);
    s.check('final state: one moved to Platform, one unsectioned',
      secondRow?.sectionName === 'Platform' && !firstRow?.sectionName,
      JSON.stringify({ firstRow: firstRow?.sectionName ?? null, secondRow: secondRow?.sectionName ?? null }));

    return { s, fx };
  },
};

export default [visionLane, relationsCoupling, canvasData, sectionLane];

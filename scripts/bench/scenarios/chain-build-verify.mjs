// AL.29 phase 1 (owner 2026-10-09): the work and the tests live as bullets in
// two files, steps under each work order in the task doc and statements under
// each test case in the test plan. Any agent, or several, may write them,
// change them, build from them and report against them. NodeSpec keeps them
// through every regeneration, keeps (and flags) the ones whose work order or
// criterion changed, saves them, and serves the same content over MCP, in the
// app and in git.
//
// This drives that chain live, through MCP only, by two agent keys, on the
// fixture's database node with a project vision. Each box is written before
// its fix (AL.29 phases 2 and 3) and is expected red until that phase deploys.
// The manual-criteria race (gap 7) is proven in Deno, where the interleaving
// is deterministic; a live race here would pass or fail by timing.
import { rest, restAs, mcpCall, mcpCallAs, callFn, github, Scenario, parseMcp } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const KEY_B_NAME = 'bench-conn-chain-b';
const AGENT_A = 'bench · agent-a';
const AGENT_B = 'bench · agent-b';

// The shared parser's line rule (supabase/functions/_shared/task-deltas.ts TASK_LINE).
const TASK_LINE = /^-\s+\[([ xX])\]\s+\*\*(T\d+)\s+\u2014\s+(.+?)\*\*\s*(?:<!--\s*t:([a-f0-9]{8}(?:-\d+)?)\s*-->)?\s*$/;

const C1 = 'a nightly backup of the task store is taken';
const C2 = 'a backup restores into an empty database';
const C2_REWORDED = 'a backup restores into an empty database within one hour';
const C_MANUAL = 'an operator restored a backup by hand';
const C0 = 'backups are encrypted at rest';

const STEPS_A = ['Schedule pg_dump of the tasks schema at 02:00 UTC', 'Write each dump to the backups bucket with a dated name'];
const STEPS_B = ['Script a restore into a fresh database from the newest dump'];
const STATEMENTS_C1 = ['Given the backup job ran, when the bucket is listed, then a dump dated today is present'];
const STATEMENTS_C2 = ['Given an empty database, when the newest dump is restored, then the tasks table holds every row'];

/** Work orders in the doc's Implementation Tasks and Added Tasks sections. */
export function workOrders(doc) {
  const out = [];
  let inTasks = false;
  for (const raw of String(doc ?? '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^##\s+/.test(line)) { inTasks = /^##\s+(Implementation Tasks|Added Tasks)\b/.test(line); continue; }
    if (!inTasks) continue;
    const m = TASK_LINE.exec(line);
    if (m) out.push({ checked: m[1] !== ' ', displayId: m[2], title: m[3], key: m[4] ?? null });
  }
  return out;
}

/** The doc with step lines added under the work order keyed `key`, after its own indented lines. */
export function withSteps(doc, key, steps) {
  const lines = String(doc).split('\n');
  const at = lines.findIndex((l) => l.includes(`<!-- t:${key} -->`));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
  lines.splice(end, 0, ...steps.map((s) => `  - [ ] ${s}`));
  return lines.join('\n');
}

/** The indented lines directly under the work order keyed `key`. */
export function linesUnder(doc, key) {
  const lines = String(doc ?? '').split('\n');
  const at = lines.findIndex((l) => l.includes(`<!-- t:${key} -->`));
  if (at < 0) return [];
  const out = [];
  for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) out.push(lines[i].trim());
  return out;
}

/** The plan with statement lines added under the test-case heading for `acId`. */
export function withStatements(plan, acId, statements) {
  const lines = String(plan).split('\n');
  const at = lines.findIndex((l) => l.startsWith(`#### ${acId}:`));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && lines[end].trim() !== '' && !lines[end].startsWith('#')) end++;
  lines.splice(end, 0, ...statements.map((s) => `- [ ] ${s}`));
  return lines.join('\n');
}

/** The lines under one test-case heading, up to the next heading. */
export function caseBlock(plan, acId) {
  const lines = String(plan ?? '').split('\n');
  const at = lines.findIndex((l) => l.startsWith(`#### ${acId}:`));
  if (at < 0) return [];
  const out = [];
  for (let i = at + 1; i < lines.length && !lines[i].startsWith('#'); i++) out.push(lines[i].trim());
  return out;
}

/** The plan with a statement under the manual item for `acId` (indented, the check a person performs). */
export function withManualStatement(plan, acId, statement) {
  const lines = String(plan).split('\n');
  const at = lines.findIndex((l) => new RegExp(`^- \\[[ xX]\\] ${acId}\\b`).test(l));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
  lines.splice(end, 0, `  - [ ] ${statement}`);
  return lines.join('\n');
}

/** The text without the block under `heading`, up to the next heading: the agent deletes what waits for review. */
export function withoutBlock(text, heading) {
  const lines = String(text).split('\n');
  const at = lines.findIndex((l) => l.trim() === heading);
  if (at < 0) return text;
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith('#')) end++;
  lines.splice(at, end - at);
  return lines.join('\n');
}

const has = (text, line) => String(text ?? '').includes(line);

export const chainBuildVerify = {
  name: 'chain-build-verify',
  boxes: [
    'AL.29 a fresh work order is in the queue and claimable by its key',
    'AL.29 a done work order is neither offered nor claimable',
    'AL.29 two agents editing one doc: no edit is silently lost',
    'AL.29 regenerating with no change keeps the steps and files nothing',
    'AL.29 steps survive a criterion change; a changed work order keeps its steps for review',
    'AL.29 test-case statements survive regeneration on the right criterion',
    'AL.29 a changed test plan is saved: NodeSpec serves and stores the same plan',
    'AL.29 the pushed files equal the copies NodeSpec stores',
    'AL.29 a result against a planned test case marks its criterion met',
    'AL.29 an agent that follows only the responses fills every block',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'chain');
    const db = rest(env);
    const asUser = restAs(env, session);
    const project = fx.ids.project;
    await db.update('projects', `id=eq.${project}`, { automation_policy: { architecture: 2, tasks: 2 } });

    const latest = async () => {
      const [snap] = await db.select('graph_snapshots', `branch_id=eq.${fx.ids.branch}&select=graph_data,patch_sequence&order=patch_sequence.desc,created_at.desc&limit=1`);
      return snap?.graph_data ?? { nodes: {}, artifacts: {} };
    };
    const dbDoc = (graph) => Object.values(graph.artifacts ?? {}).find((a) => a.nodeId === fx.ids.nodeDb && a.kind === 'task');
    const req3Plan = (graph) => Object.values(graph.artifacts ?? {}).find((a) => a.kind === 'test-plan'
      && (a.metadata?.requirementId === 'REQ-003' || String(a.path).toLowerCase() === '.nodespec/tests/req-003.tests.md'));
    const sweep = async () => parseMcp(await mcpCall(env, 'resolve_proposal', { project_id: project, action: 'auto' }));
    const head = async (call) => parseMcp(await call('get_architecture_overview', { project_id: project }))?.headSequence;
    const keyFor = (doc, text) => workOrders(doc).find((w) => w.title.includes(`"${text}"`))?.key ?? null;

    // Agent B is a second credential, minted and revoked here (v3-work-loop's pattern).
    await db.delete('mcp_api_keys', `user_id=eq.${session.userId}&name=eq.${KEY_B_NAME}`);
    const keyB = parseMcp(await mcpCallAs(env, { accessToken: session.accessToken }, 'create_api_key', { name: KEY_B_NAME }));
    if (!/^ns_live_/.test(keyB.apiKey ?? '')) throw new Error(`agent B's key was not minted: ${JSON.stringify(keyB).slice(0, 300)}`);
    const asA = (tool, args) => mcpCall(env, tool, args);
    const asB = (tool, args) => mcpCallAs(env, { apiKey: keyB.apiKey }, tool, args);

    /** Read the stored doc and the head, add `steps` under the work order for `criterion`, file it. */
    const writeSteps = async (call, who, criterion, steps) => {
      const base = await head(call);
      const doc = dbDoc(await latest());
      const key = keyFor(doc?.content, criterion);
      const next = key ? withSteps(doc.content, key, steps) : null;
      if (!next) return { key, routed: 'not-written', raw: `no work order quotes "${criterion}"` };
      const r = parseMcp(await call('propose_patches', {
        project_id: project, base_sequence: base, external_agent: who,
        patches: [{ type: 'update_artifact', payload: { id: doc.id, changes: { content: next } } }],
        explanations: [`${who} writes the steps for "${criterion}"`],
      }));
      return { key, routed: r?.routed ?? (r?.isError ? 'refused' : 'unknown'), raw: r };
    };

    try {
      // Setup: a requirement on the database node, with one manual criterion.
      const created = parseMcp(await asA('create_requirement', {
        project_id: project, name: 'Back up tasks', description: 'The task store is backed up and restorable',
        acceptance_criteria: [C1, C2, { text: C_MANUAL, verification: 'manual' }],
      }));
      if (created?.requirementId !== 'REQ-003') throw new Error(`setup: create_requirement gave ${JSON.stringify(created).slice(0, 300)}`);
      await asA('map_requirement', { project_id: project, requirement_id: 'REQ-003', node_ids: [fx.ids.nodeDb], mode: 'replace' });
      const gen = async () => parseMcp(await asA('generate_task_docs', {
        project_id: project, branch_id: fx.ids.branch, node_ids: [fx.ids.nodeDb], external_agent: AGENT_A,
      }));
      await gen();
      await sweep();
      let doc = dbDoc(await latest());
      const orders = workOrders(doc?.content);
      if (orders.length < 3 || !keyFor(doc.content, C1) || !keyFor(doc.content, C2)) {
        throw new Error(`setup: the database task doc did not land with its work orders: ${JSON.stringify(orders).slice(0, 400)}`);
      }

      // 1. The queue offers fresh work orders, and one can be claimed by its key.
      const queue = parseMcp(await asA('get_work_queue', { project_id: project }));
      const offered = new Set((queue?.queue ?? []).filter((e) => e.nodeId === fx.ids.nodeDb).map((e) => e.taskKey));
      const open = orders.filter((w) => !w.checked && w.key);
      const target = open[0];
      const claim = parseMcp(await asA('checkout_task', {
        project_id: project, node_id: fx.ids.nodeDb, task_key: target.key, external_agent: AGENT_A,
      }));
      s.check('AL.29 a fresh work order is in the queue and claimable by its key',
        open.every((w) => offered.has(w.key)) && claim?.claimed === true,
        JSON.stringify({ open: open.map((w) => w.key), offered: [...offered], totalOpen: queue?.totalOpen, claim }).slice(0, 500));
      if (claim?.checkoutId) await asA('release_checkout', { project_id: project, checkout_id: claim.checkoutId, reason: 'released', note: 'bench: claim proven' });

      // 2. A work order ticked the way the app ticks it is neither offered nor claimable.
      const ticked = open[open.length - 1];
      await asUser.insert('task_items', {
        project_id: project, node_id: fx.ids.nodeDb, task_key: ticked.key, display_id: ticked.displayId, title: ticked.title,
        done: true, provenance: { source: 'ui', actor: 'bench', at: new Date().toISOString() },
      });
      const queue2 = parseMcp(await asA('get_work_queue', { project_id: project }));
      const claimDone = parseMcp(await asB('checkout_task', {
        project_id: project, node_id: fx.ids.nodeDb, task_key: ticked.key, external_agent: AGENT_B,
      }));
      s.check('AL.29 a done work order is neither offered nor claimable',
        !(queue2?.queue ?? []).some((e) => e.taskKey === ticked.key) && claimDone?.claimed !== true,
        JSON.stringify({ ticked: ticked.key, claimDone }).slice(0, 400));
      if (claimDone?.checkoutId) await asB('release_checkout', { project_id: project, checkout_id: claimDone.checkoutId, reason: 'released', note: 'bench: should not have been claimable' });
      // The tick renders as [x] on the next regeneration; let the doc take it now, so
      // box 4 measures steps alone.
      await gen();
      await sweep();

      // 3. Two agents write steps into the same doc from the same read, at once.
      const [a1, b1] = await Promise.all([
        writeSteps(asA, AGENT_A, C1, STEPS_A),
        writeSteps(asB, AGENT_B, C2, STEPS_B),
      ]);
      await sweep();
      doc = dbDoc(await latest());
      const landedA = STEPS_A.every((t) => has(doc.content, t));
      const landedB = STEPS_B.every((t) => has(doc.content, t));
      const silentlyLost = (a1.routed === 'applied' && !landedA) || (b1.routed === 'applied' && !landedB);
      let refiles = 0;
      if (!landedA) { refiles++; await writeSteps(asA, AGENT_A, C1, STEPS_A); }
      if (!landedB) { refiles++; await writeSteps(asB, AGENT_B, C2, STEPS_B); }
      if (refiles) { await sweep(); doc = dbDoc(await latest()); }
      const bothLanded = STEPS_A.every((t) => has(doc.content, t)) && STEPS_B.every((t) => has(doc.content, t));
      s.check('AL.29 two agents editing one doc: no edit is silently lost', !silentlyLost && bothLanded && refiles <= 1,
        JSON.stringify({ first: [a1.routed, b1.routed], landedFirst: [landedA, landedB], refiles, bothLanded }).slice(0, 400));

      // 4. Regenerating with no input change keeps the steps and files nothing.
      const keyC1 = keyFor(doc.content, C1);
      const before = doc.content;
      const regen = await gen();
      await sweep();
      doc = dbDoc(await latest());
      s.check('AL.29 regenerating with no change keeps the steps and files nothing',
        !regen?.proposalId && doc.content === before,
        JSON.stringify({ proposalId: regen?.proposalId, alreadyFresh: regen?.alreadyFresh, refreshed: regen?.refreshed, stepsKept: STEPS_A.every((t) => has(doc.content, t)) }).slice(0, 400));
      if (!STEPS_A.every((t) => has(doc.content, t)) || !STEPS_B.every((t) => has(doc.content, t))) {
        // Measure the next box on its own: put the steps back the way an agent would.
        await writeSteps(asA, AGENT_A, C1, STEPS_A);
        await writeSteps(asA, AGENT_A, C2, STEPS_B);
        await sweep();
      }

      // 5. A criterion is reworded; the doc regenerates.
      await asA('update_requirement', {
        project_id: project, requirement_id: 'REQ-003',
        acceptance_criteria: [C1, C2_REWORDED, { text: C_MANUAL, verification: 'manual' }],
      });
      await gen();
      await sweep();
      doc = dbDoc(await latest());
      const underC1 = linesUnder(doc.content, keyC1);
      s.check('AL.29 steps survive a criterion change; a changed work order keeps its steps for review',
        keyFor(doc.content, C1) === keyC1 && STEPS_A.every((t) => underC1.some((l) => l.includes(t)))
          && STEPS_B.every((t) => has(doc.content, t)) && !!keyFor(doc.content, C2_REWORDED),
        JSON.stringify({ underC1, stepsBKept: STEPS_B.every((t) => has(doc.content, t)) }).slice(0, 400));

      // 6. The test plan: filed, then an agent writes statements under each test case.
      const firstPlan = parseMcp(await asA('get_test_plan', { project_id: project, requirement_id: 'REQ-003', external_agent: AGENT_A }));
      await sweep();
      let plan = req3Plan(await latest());
      if (!plan) throw new Error(`setup: the REQ-003 plan did not land: ${JSON.stringify({ isNew: firstPlan?.testPlanIsNew, proposalId: firstPlan?.proposalId }).slice(0, 300)}`);
      const withBoth = withStatements(withStatements(plan.content, 'AC-REQ-003-1', STATEMENTS_C1) ?? '', 'AC-REQ-003-2', STATEMENTS_C2);
      const wrote = parseMcp(await asA('propose_patches', {
        project_id: project, base_sequence: await head(asA), external_agent: AGENT_A,
        patches: [{ type: 'update_artifact', payload: { id: plan.id, changes: { content: withBoth } } }],
        explanations: ['agent A writes the statements for each test case'],
      }));
      await sweep();
      plan = req3Plan(await latest());
      if (!STATEMENTS_C1.every((t) => has(plan?.content, t))) {
        throw new Error(`setup: the statements did not land: ${JSON.stringify(wrote).slice(0, 300)}`);
      }

      // 7. A criterion is inserted first; C1 becomes AC-REQ-003-2 and C2 (reworded) AC-REQ-003-3.
      await asA('update_requirement', {
        project_id: project, requirement_id: 'REQ-003',
        acceptance_criteria: [C0, C1, C2_REWORDED, { text: C_MANUAL, verification: 'manual' }],
      });
      const served = parseMcp(await asB('get_test_plan', { project_id: project, requirement_id: 'REQ-003', external_agent: AGENT_B }));
      const servedC1 = caseBlock(served?.testPlanContent, 'AC-REQ-003-2');
      const servedC0 = caseBlock(served?.testPlanContent, 'AC-REQ-003-1');
      s.check('AL.29 test-case statements survive regeneration on the right criterion',
        STATEMENTS_C1.every((t) => servedC1.some((l) => l.includes(t))) && !STATEMENTS_C1.some((t) => servedC0.some((l) => l.includes(t)))
          && STATEMENTS_C2.every((t) => has(served?.testPlanContent, t)),
        JSON.stringify({ servedC1, servedC0 }).slice(0, 400));

      await sweep();
      plan = req3Plan(await latest());
      const again = parseMcp(await asB('get_test_plan', { project_id: project, requirement_id: 'REQ-003', external_agent: AGENT_B }));
      s.check('AL.29 a changed test plan is saved: NodeSpec serves and stores the same plan',
        has(plan?.content, C0) && STATEMENTS_C1.every((t) => has(plan?.content, t))
          && again?.testPlanRefreshed !== true && !again?.proposalId && !has(plan?.content, '## Project Context'),
        JSON.stringify({ storedHasC0: has(plan?.content, C0), refreshedAgain: again?.testPlanRefreshed, proposalAgain: again?.proposalId, note: again?.note }).slice(0, 400));

      // 8. Push: the files in git are the copies NodeSpec stores.
      const { integrationId } = await connectRepo(env, session, callFn, project);
      const push = await callFn(env, session, 'git-push', { projectId: project, branchName: 'main', integrationId, confirmOverwrite: true });
      const sha = push.data?.commitSha;
      const gh = github(env);
      const graphAtPush = await latest();
      const storedDoc = dbDoc(graphAtPush);
      const storedPlan = req3Plan(graphAtPush);
      const fileDoc = sha && storedDoc ? await gh.getFile(storedDoc.path, sha) : null;
      const filePlan = sha && storedPlan ? await gh.getFile(storedPlan.path, sha) : null;
      s.check('AL.29 the pushed files equal the copies NodeSpec stores',
        !!push.data?.success && fileDoc?.content === storedDoc?.content && filePlan?.content === storedPlan?.content,
        JSON.stringify({
          push: push.data?.success, testPlansRefreshed: push.data?.testPlansRefreshed, packetsRefreshed: push.data?.packetsRefreshed, packetsSaved: push.data?.packetsSaved,
          docEqual: fileDoc?.content === storedDoc?.content, planEqual: filePlan?.content === storedPlan?.content,
          fileHasProjectContext: has(filePlan?.content, '## Project Context'),
        }).slice(0, 500));

      // 9. A result reported against the planned test case marks its criterion met.
      const report = parseMcp(await asB('report_test_results', {
        project_id: project, requirement_id: 'REQ-003', external_agent: AGENT_B,
        ...(sha ? { git: { commit_sha: sha, branch: 'main' } } : {}),
        results: [{ test_id: 'TC-REQ-003-2', status: 'passed', name: 'nightly backup present', criterion_text: C1 }],
      }));
      const [row] = await db.select('specification_requirements', `specification_id=eq.${fx.ids.spec}&requirement_id=eq.REQ-003&select=acceptance_criteria`);
      const c1Row = (row?.acceptance_criteria ?? []).find((c) => c.text === C1);
      s.check('AL.29 a result against a planned test case marks its criterion met', c1Row?.met === true,
        JSON.stringify({ c1: c1Row, warnings: report?.warnings, binding: report?.results?.[0]?.criterionBinding }).slice(0, 400));

      // 10. Phases 3.3 and 5.1: what the four tools say is still to write, read
      // from their answers alone, is written; then none of them names anything.
      const asked = async () => {
        const g = await gen();
        await sweep();
        const tp = parseMcp(await asA('get_test_plan', { project_id: project, requirement_id: 'REQ-003', external_agent: AGENT_A }));
        await sweep();
        const q = parseMcp(await asA('get_work_queue', { project_id: project }));
        const rd = parseMcp(await asA('get_build_readiness', { project_id: project, detail: 'summary' }));
        return {
          workOrders: (g?.workOrdersWithoutSteps ?? []).flatMap((d) => d.workOrders.map((w) => w.key)),
          stepsToReview: (g?.stepsToReview ?? []).reduce((n, d) => n + d.steps, 0),
          testCases: (tp?.testCasesWithoutStatements ?? []).map((c) => ({ id: c.id, lane: c.lane })),
          statementsToReview: tp?.statementsToReview ?? 0,
          formats: [g?.stepFormat, tp?.statementFormat, q?.stepFormat].filter(Boolean).length,
          queueWithoutSteps: (q?.queue ?? []).filter((e) => e.nodeId === fx.ids.nodeDb && e.withoutSteps).map((e) => e.taskKey),
          readiness: (rd?.projectAdvisories ?? []).filter((a) => ['steps', 'statements', 'review', 'test-plans'].includes(a.kind)).map((a) => `${a.kind}:${a.count}`),
        };
      };
      const ask = await asked();
      const graphNow = await latest();
      const docNow = dbDoc(graphNow);
      const planNow = req3Plan(graphNow);
      let docNext = withoutBlock(docNow.content, '### Steps to review');
      for (const key of ask.workOrders) docNext = withSteps(docNext, key, [`Build and test what work order ${key} asks for in the database node`]) ?? docNext;
      let planNext = withoutBlock(planNow.content, '#### Statements to review');
      for (const c of ask.testCases) {
        planNext = (c.lane === 'manual'
          ? withManualStatement(planNext, c.id, `Given the runbook, when an operator performs ${c.id}, then the outcome it names is observed`)
          : withStatements(planNext, c.id, [`Given the store, when ${c.id} is exercised, then the outcome it names is observed`])) ?? planNext;
      }
      const filled = parseMcp(await asA('propose_patches', {
        project_id: project, base_sequence: await head(asA), external_agent: AGENT_A,
        patches: [
          { type: 'update_artifact', payload: { id: docNow.id, changes: { content: docNext } } },
          { type: 'update_artifact', payload: { id: planNow.id, changes: { content: planNext } } },
        ],
        explanations: ['agent A writes the steps the work orders lack', 'agent A writes the statements the test cases lack'],
      }));
      await sweep();
      const after = await asked();
      s.check('AL.29 an agent that follows only the responses fills every block',
        ask.workOrders.length > 0 && ask.testCases.length > 0 && ask.formats === 3 && ask.queueWithoutSteps.length > 0 && ask.readiness.length > 0
          && after.workOrders.length === 0 && after.stepsToReview === 0 && after.testCases.length === 0 && after.statementsToReview === 0
          && after.formats === 0 && after.queueWithoutSteps.length === 0 && after.readiness.length === 0,
        JSON.stringify({ asked: ask, filed: filled?.routed ?? filled?.isError, after }).slice(0, 600));
    } finally {
      if (keyB.keyId) await mcpCallAs(env, { accessToken: session.accessToken }, 'revoke_api_key', { key_id: keyB.keyId }).catch(() => {});
    }
    return { s, fx };
  },
};

export default [chainBuildVerify];

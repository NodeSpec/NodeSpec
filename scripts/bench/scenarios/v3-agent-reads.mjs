// Bench audit rider (owner's ask 2026-09-21): the reads an agent makes
// before it writes, and the one tool that starts a project, live.
//
// The 2026-09-21 inventory found six registered tools no scenario had ever
// called on the real stack: create_project, get_architecture_overview,
// get_project_context, search_catalog, lookup_catalog, get_import_context
// (relate_requirements, the seventh, rides v3-app-writes with the lock
// doctrine). They are the first calls in the Hermes runbook: make the
// project, search the catalog before proposing, read the canvas with its
// head sequence, read the build brief, read the import context. This rider
// runs each against the deployed functions, asserts the shape the skill
// depends on, and takes the created project back down through the app's
// own sliced delete, as the person.
import { rest, restAs, mcpCall, Scenario, parseMcp } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

const short = (v) => JSON.stringify(v).slice(0, 300);

export const agentReads = {
  name: 'v3-agent-reads',
  boxes: [
    'V3-1.4 every registered tool has a live run', 'V3 create_project over MCP and the app\'s delete', 'V3-2.2 since_sequence reads',
    'V3 the build brief', 'V3-J catalog search finds the thing named', 'V3-9.6 import context honest-empty',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const db = rest(env);
    const me = restAs(env, session);
    const fx = await createProject(env, session, 'v3reads');
    const stamp = Date.now();

    // 1 — create_project: refused without a name; a real project with one main branch; empty overview; the app takes it down.
    const nameless = parseMcp(await mcpCall(env, 'create_project', { name: '' }));
    s.check('create_project needs a name', nameless.isError === true && /Project name is required/.test(String(nameless.raw)), short(nameless));
    const projectName = `bench-auto-agentproj-${stamp}`;
    const created = parseMcp(await mcpCall(env, 'create_project', { name: projectName }));
    s.check('create_project answers ids and the empty-canvas message', !!created.projectId && !!created.branchId && /empty canvas/.test(String(created.message)), short(created));
    if (created.projectId) {
      const branches = await db.select('branches', `project_id=eq.${created.projectId}&select=id,name,is_primary`);
      s.check('one primary branch named main', branches.length === 1 && branches[0].name === 'main' && branches[0].is_primary === true && branches[0].id === created.branchId, short(branches));
      const listed = parseMcp(await mcpCall(env, 'list_projects', {}));
      s.check('list_projects serves it', (listed.projects ?? []).some((p) => p.name === projectName), short((listed.projects ?? []).map((p) => p.name)));
      const blank = parseMcp(await mcpCall(env, 'get_architecture_overview', { project_id: created.projectId }));
      s.check('the new project\'s overview is honestly empty at sequence 0', Array.isArray(blank.nodes) && blank.nodes.length === 0 && blank.headSequence === 0 && /No (nodes in architecture|architecture yet)/.test(String(blank.mermaid)), short(blank));
      let done = false;
      let steps = 0;
      while (!done && steps < 50) {
        const r = await me.rpc('project_delete_step', { p_project_id: created.projectId });
        if (r.status !== 200) { s.check('project_delete_step answers the owner', false, `${r.status} ${short(r.error)}`); break; }
        done = r.data?.done === true;
        steps++;
      }
      s.check('the app\'s sliced delete removes the created project, branch included',
        done && (await db.select('projects', `id=eq.${created.projectId}&select=id`)).length === 0 && (await db.select('branches', `project_id=eq.${created.projectId}&select=id`)).length === 0,
        `done=${done} steps=${steps}`);
    }

    // 2 — the overview on the fixture: the canvas with its head sequence, and what changed since.
    const ov = parseMcp(await mcpCall(env, 'get_architecture_overview', { project_id: fx.ids.project }));
    s.check('the overview serves the fixture\'s two nodes, one edge, a head sequence and a diagram',
      ov.nodes?.length === 2 && ov.edges?.length === 1 && Number.isInteger(ov.headSequence) && typeof ov.mermaid === 'string' && ov.since === undefined,
      short({ nodes: ov.nodes?.length, edges: ov.edges?.length, headSequence: ov.headSequence, since: ov.since, raw: ov.raw }));
    const since = parseMcp(await mcpCall(env, 'get_architecture_overview', { project_id: fx.ids.project, since_sequence: ov.headSequence ?? 0 }));
    s.check('since_sequence at the head answers nothing new, not truncated',
      since.since?.sinceSequence === (ov.headSequence ?? 0) && Array.isArray(since.since?.patches) && since.since.patches.length === 0 && since.since.truncated === false,
      short(since.since ?? since));
    const negative = parseMcp(await mcpCall(env, 'get_architecture_overview', { project_id: fx.ids.project, since_sequence: -1 }));
    s.check('a negative since_sequence is refused by name', negative.isError === true && /since_sequence must be a non-negative integer/.test(String(negative.raw)), short(negative));

    // 3 — the build brief for a node, and a requirement target.
    const ctx = parseMcp(await mcpCall(env, 'get_project_context', { project_id: fx.ids.project, target_type: 'node', target_id: fx.ids.nodeApi }));
    s.check('get_project_context brief: the build brief, the process hint, the envelope advisory',
      ctx.view === 'brief' && ctx.target?.id === fx.ids.nodeApi && typeof ctx.promptDocument === 'string' && ctx.promptDocument.length > 100
        && typeof ctx.processHints?.nextStep === 'string' && typeof ctx.untrustedDataAdvisory === 'string',
      short({ view: ctx.view, target: ctx.target, brief: (ctx.promptDocument ?? '').length, hint: ctx.processHints?.nextStep?.slice(0, 80), raw: ctx.raw }));
    const ctxReq = parseMcp(await mcpCall(env, 'get_project_context', { project_id: fx.ids.project, target_type: 'requirement', target_id: 'REQ-001', view: 'structured' }));
    // UAT hardening 2026-09-27: the answer has to be about REQ-001. The
    // requirement's own test-plan state rides only when the target resolved
    // (by REQ-NNN, inside this project); the lookup used to take a row uuid
    // alone, so this target silently carried no plan state.
    s.check('a requirement target by REQ-NNN answers in the structured view with that requirement\'s test-plan state',
      ctxReq.isError !== true && ctxReq.view === 'structured' && ctxReq.context?.target?.id === 'REQ-001' &&
      typeof ctxReq.testPlan?.exists === 'boolean' && typeof ctxReq.testPlan?.testCaseSummary?.total === 'number',
      short(ctxReq).slice(0, 200));

    // 4 — the catalog, read before proposing.
    const found = parseMcp(await mcpCall(env, 'search_catalog', { query: 'postgresql' }));
    s.check('search_catalog finds postgresql by name with the vocabulary legend',
      (found.technologies ?? []).some((t) => t.id === 'postgresql') && Array.isArray(found.roles) && /treatment/.test(String(found.guidance)),
      short({ technologies: (found.technologies ?? []).map((t) => t.id).slice(0, 8), roles: (found.roles ?? []).length, raw: found.raw }));
    // Owner's run 2026-09-21 found "postgres" answering eight rows that
    // MENTION Postgres and never PostgreSQL: the english stemmer writes
    // 'postgres' as 'postgr' and 'PostgreSQL' as 'postgresql', so the row
    // could not match. Migration 20260921140000 added the prefix lane and
    // the exactness boost (lane 066 proves the SQL); these hold the answer
    // a person actually gets.
    const prefix = parseMcp(await mcpCall(env, 'search_catalog', { query: 'postgres', max_results: 25 }));
    s.check('search_catalog LEADS with PostgreSQL for the common spelling "postgres"',
      (prefix.technologies ?? [])[0]?.id === 'postgresql',
      short({ technologies: (prefix.technologies ?? []).map((t) => t.id), raw: prefix.raw }));
    s.check('and the row named by the full spelling outranks the rows that merely mention it',
      (found.technologies ?? [])[0]?.id === 'postgresql',
      short({ technologies: (found.technologies ?? []).map((t) => t.id), raw: found.raw }));
    // AE.9 (owner 2026-09-25, rulings 18 and 19): firmware stacks and
    // kernel-level code are catalog rows (migration 20260925180000), so an
    // agent proposing a device or a driver finds the id instead of inventing
    // one. The stack answers the search with the row's own affinities.
    const zephyr = parseMcp(await mcpCall(env, 'search_catalog', { query: 'zephyr' }));
    const zephyrRow = (zephyr.technologies ?? []).find((t) => t.id === 'zephyr');
    s.check('AE.9: search_catalog finds the zephyr row on firmware-service',
      // UAT hardening 2026-09-27: the tool answers roleAffinities; the old
      // read fell back to the expected value and could not fail.
      !!zephyrRow && Array.isArray(zephyrRow.roleAffinities) && zephyrRow.roleAffinities.includes('firmware-service'),
      short({ zephyr: zephyrRow ?? null, technologies: (zephyr.technologies ?? []).map((t) => t.id).slice(0, 8), raw: zephyr.raw }));
    const kernel = parseMcp(await mcpCall(env, 'search_catalog', { query: 'kernel module' }));
    s.check('AE.9: search_catalog finds the kernel-module role and its two technology rows',
      (kernel.roles ?? []).some((r) => r.id === 'kernel-module')
        && ['linux-kernel-module', 'windows-driver'].every((id) => (kernel.technologies ?? []).some((t) => t.id === id)),
      short({ roles: (kernel.roles ?? []).map((r) => r.id).slice(0, 8), technologies: (kernel.technologies ?? []).map((t) => t.id).slice(0, 8), raw: kernel.raw }));
    // a short prefix still reaches the thing named, which is what an agent types
    const short_q = parseMcp(await mcpCall(env, 'search_catalog', { query: 'kube', max_results: 10 }));
    s.check('a prefix reaches the thing named ("kube" finds Kubernetes)',
      (short_q.technologies ?? []).some((t) => t.id === 'kubernetes'),
      short({ technologies: (short_q.technologies ?? []).map((t) => t.id), raw: short_q.raw }));
    const tooShort = parseMcp(await mcpCall(env, 'search_catalog', { query: 'p' }));
    s.check('a one-letter query is refused', tooShort.isError === true && /at least 2 characters/.test(String(tooShort.raw)), short(tooShort));
    const tech = parseMcp(await mcpCall(env, 'lookup_catalog', { technology_id: 'postgresql' }));
    s.check('lookup_catalog serves the technology detail, not user-contributed', !!tech.catalog && JSON.stringify(tech.catalog).includes('postgresql') && tech.userContributed === false, short(tech).slice(0, 200));
    const role = parseMcp(await mcpCall(env, 'lookup_catalog', { role_id: 'backend-service' }));
    s.check('and a role detail', !!role.catalog && JSON.stringify(role.catalog).includes('backend-service'), short(role).slice(0, 200));
    const nothing = parseMcp(await mcpCall(env, 'lookup_catalog', {}));
    s.check('lookup_catalog with nothing named is refused', nothing.isError === true && /Provide at least one of/.test(String(nothing.raw)), short(nothing));

    // 5 — the import context on a project never imported: the honest empty.
    const ic = parseMcp(await mcpCall(env, 'get_import_context', { project_id: fx.ids.project }));
    s.check('get_import_context on a project never imported says so and names run_repo_import',
      ic.isError === true && /No repository import exists for this branch yet/.test(String(ic.raw)) && /run_repo_import/.test(String(ic.raw)), short(ic));

    return { s };
  },
};

export default [agentReads];

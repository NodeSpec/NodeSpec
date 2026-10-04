// SB-4 scenarios 9–10: the webhook lane (testable for the FIRST time — GitHub
// can never reach a localhost bench, but a locally-forged valid HMAC signature
// exercises the identical verification path) and the MCP tool surface.
import { callFn, rest, github, postSignedWebhook, mcpCall, uid, until, Scenario, parseMcp } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const pendingCards = (env, projectId) =>
  rest(env).select('git_change_events', `project_id=eq.${projectId}&status=eq.pending&select=id,metadata,commit_message`);

export const webhookLane = {
  name: 'webhook-lane',
  boxes: ['P0-9 webhook suite LIVE', 'R3-4a webhook parity (previously SKIP on localhost)'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'webhook');
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success);

    const secret = `bench-secret-${uid().slice(0, 8)}`;
    await rest(env).update('git_integrations', `id=eq.${integrationId}`, { webhook_secret: secret });

    // AD.1: a delivery wakes the sync check, which reads the real range.
    const gh = github(env);
    const payload = (message, sha) => ({
      ref: 'refs/heads/main', after: sha,
      head_commit: { id: sha, message, author: { username: 'bench' }, modified: ['src/api/index.ts'] },
    });

    // 1. Bad signature → rejected before any write.
    const bad = await postSignedWebhook(env, integrationId, secret, payload('feat: forged', await gh.headSha('main')), { badSignature: true });
    s.check('bad signature is rejected (401)', bad.status === 401, `status=${bad.status} ${JSON.stringify(bad.data).slice(0, 200)}`);

    // 2. A real out-of-band commit, then its delivery → the sync check cards it.
    await gh.putFile('src/api/index.ts', 'main', `export const edited = "${uid().slice(0, 6)}";\n`, 'feat: out-of-band via webhook');
    const head = await gh.headSha('main');
    const ok = await postSignedWebhook(env, integrationId, secret, payload('feat: out-of-band via webhook', head));
    s.check('valid delivery runs the sync check', ok.status === 200 && ok.data?.branchName === 'main' && !!ok.data?.sweep,
      `status=${ok.status} ${JSON.stringify(ok.data).slice(0, 200)}`);
    const cards = await pendingCards(env, fx.ids.project);
    const card = cards.find((c) => c.metadata?.source === 'sweep');
    s.check('the sync check raised one pending card with the bound file matched', cards.length === 1 &&
      (card?.metadata?.artifactMatches ?? []).some((m) => m.path === 'src/api/index.ts'), JSON.stringify(cards).slice(0, 300));

    // 3. NodeSpec's own push, then its delivery → no second card, and the
    //    agent's edit is not overwritten (the push skips it).
    const own = await callFn(env, session, 'git-push', { projectId: fx.ids.project, branchName: 'main', integrationId });
    s.check('the push skips the file git changed', (own.data?.skipped ?? []).some((f) => f.path === 'src/api/index.ts') || own.data?.code === 'all-skipped',
      JSON.stringify(own.data).slice(0, 300));
    const after = own.data?.commitSha ?? await gh.headSha('main');
    // UAT hardening 2026-09-27: the delivery's own answer is part of the proof
    // (a webhook that 500s raises no card either), and the file is read at the
    // push's commit, never at a branch ref that can still serve the old tree.
    const selfDelivery = await postSignedWebhook(env, integrationId, secret, payload('Update from NodeSpec: bench', after));
    const later = await pendingCards(env, fx.ids.project);
    s.check('NodeSpec\'s own push raised NO second card', selfDelivery.status === 200 && later.length === 1,
      `delivery ${selfDelivery.status} ${JSON.stringify(selfDelivery.data).slice(0, 160)}; cards ${cards.length} → ${later.length}`);
    const file = await gh.getFile('src/api/index.ts', after);
    s.check('the out-of-band edit is still in git', !!file?.content?.includes('export const edited'), `at ${after}: ${(file?.content ?? '').slice(0, 120)}`);
    return { s, fx, integrationId };
  },
};

export const mcpTools = {
  name: 'mcp-tools',
  boxes: ['R4 (c) loop stitching', 'R5d mark_entity_complete', 'MCP get_pending_changes'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'mcp');
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success);

    // Parse the JSON-RPC tools/call envelope: result.content[0].text.
    // The shared strict reader (lib.mjs): a call that failed below the tool is an error.
    const parse = parseMcp;

    // R5d: whole-node completion — declaration recorded, criteria untouched.
    const before = await rest(env).select('specification_requirements',
      `specification_id=eq.${fx.ids.spec}&select=acceptance_criteria&order=requirement_id`);
    const mark = await mcpCall(env, 'mark_entity_complete', {
      project_id: fx.ids.project, node_id: 'API Service', external_agent: 'bench-harness', note: 'live harness run',
    });
    const markData = parse(mark);
    s.check('mark_entity_complete succeeds', mark.status === 200 && markData?.validationStatus === 'valid',
      JSON.stringify(markData).slice(0, 300));
    s.check('response reports the still-unmet criteria (declaration ≠ proof)',
      markData?.criteriaUntouched === true && markData?.unmetCriteria === 3, JSON.stringify(markData).slice(0, 200));
    const mappings = await rest(env).select('specification_mappings',
      `specification_id=eq.${fx.ids.spec}&node_id=eq.${fx.ids.nodeApi}&select=validation_status,validation_provenance`);
    s.check('validation_status=valid with mcp provenance', mappings.length === 2 && mappings.every((m) =>
      m.validation_status === 'valid' && m.validation_provenance?.source === 'mcp' && m.validation_provenance?.actor === 'bench-harness'),
      JSON.stringify(mappings).slice(0, 300));
    const criteria = await rest(env).select('specification_requirements',
      `specification_id=eq.${fx.ids.spec}&select=acceptance_criteria&order=requirement_id`);
    s.check('THE INVARIANT: criteria byte-identical (never flipped by completion)',
      JSON.stringify(criteria) === JSON.stringify(before), 'criteria changed!');

    // R4 (c): status stitching — raise a card, status must lead with reconciliation.
    const gh = github(env);
    await gh.putFile('src/api/index.ts', 'main', '// oob for status\n', 'fix: oob for status stitching');
    // Same read-staleness class sweepUntil covers elsewhere (this site calls
    // git-pull directly, so it missed that hardening): the sweep can read a
    // stale head right after the out-of-band commit and report clean — a clean
    // sweep advances nothing, so re-sweeping until the card lands is lossless.
    await until(async () => {
      await callFn(env, session, 'git-pull', { integrationId, mode: 'drift-check', branchName: 'main', force: true });
      const rows = await rest(env).select('git_change_events', `project_id=eq.${fx.ids.project}&status=eq.pending&select=id`);
      return rows.length > 0 ? rows : null;
    }, { timeoutMs: 30000, everyMs: 3000 });
    const status = parse(await mcpCall(env, 'get_project_status', { project_id: fx.ids.project }));
    s.check('get_project_status counts the pending change', (status?.pendingRepositoryChanges ?? 0) >= 1,
      JSON.stringify(status).slice(0, 300));
    s.check('nextAction leads with reconcile-first', /get_pending_changes FIRST/.test(status?.nextAction ?? ''),
      status?.nextAction?.slice(0, 200));

    const pending = parse(await mcpCall(env, 'get_pending_changes', { project_id: fx.ids.project }));
    // An error object used to count as "the card" (!!list).
    s.check('get_pending_changes returns the card', Array.isArray(pending?.pendingChanges) && pending.pendingChanges.length >= 1,
      JSON.stringify(pending).slice(0, 200));

    // Resolver honesty (bench-audit hardening 2026-08-09): a project id that exists
    // for NOBODY must come back as a clean, named error — never a crash, never an
    // empty-but-successful response an AI would happily build on.
    const ghostResp = await mcpCall(env, 'get_project_status', { project_id: uid() });
    const ghost = parse(ghostResp);
    s.check('nonexistent project → clean named error over MCP (no crash, no phantom success)',
      ghostResp.status === 200 &&
      (ghost?.success === false || ghost?.isError === true) &&
      /not found|no project/i.test(String(ghost?.error ?? ghost?.raw ?? '')),
      JSON.stringify(ghost).slice(0, 200));
    return { s, fx, integrationId };
  },
};

export default [webhookLane, mcpTools];

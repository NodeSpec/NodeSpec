// SB-4 scenarios 9–10: the webhook lane (testable for the FIRST time — GitHub
// can never reach a localhost bench, but a locally-forged valid HMAC signature
// exercises the identical verification path) and the MCP tool surface.
import { callFn, rest, github, postSignedWebhook, mcpCall, uid, until, Scenario } from '../lib.mjs';
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

    const gh = github(env);
    const head = await gh.headSha('main');
    const payload = (message, sha) => ({
      ref: 'refs/heads/main', after: sha,
      head_commit: { id: sha, message, author: { username: 'bench' }, modified: ['src/api/index.ts'] },
    });

    // 1. Bad signature → rejected before any write.
    const bad = await postSignedWebhook(env, integrationId, secret, payload('feat: forged', head), { badSignature: true });
    s.check('bad signature is rejected (401)', bad.status === 401, `status=${bad.status} ${JSON.stringify(bad.data).slice(0, 200)}`);
    // 2. Valid signature + external commit → pending card raised.
    const ok = await postSignedWebhook(env, integrationId, secret, payload('feat: out-of-band via webhook', head));
    s.check('valid signature accepted', ok.status === 200, `status=${ok.status} ${JSON.stringify(ok.data).slice(0, 200)}`);
    const cards = await pendingCards(env, fx.ids.project);
    const webhookCard = cards.find((c) => c.commit_message === 'feat: out-of-band via webhook');
    s.check('webhook raised a pending card with matches', !!webhookCard &&
      (webhookCard.metadata?.artifactMatches ?? []).length === 1, JSON.stringify(cards).slice(0, 300));
    // 3. Self-push message → ignored (both prefixes are pinned offline; live-check the new one).
    const selfCount = cards.length;
    const self = await postSignedWebhook(env, integrationId, secret, payload('Update from NodeSpec: 2 files from main', head));
    s.check('self-push ignored', self.status === 200 && /self-push/i.test(self.data?.message ?? ''),
      JSON.stringify(self.data).slice(0, 200));
    const after = await pendingCards(env, fx.ids.project);
    s.check('self-push raised NO card', after.length === selfCount, `${selfCount} → ${after.length}`);
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
    const parse = (r) => {
      const text = r.data?.result?.content?.[0]?.text;
      try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
    };

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
    s.check('validation_status=valid with mcp provenance', mappings.every((m) =>
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
    const list = pending?.changes ?? pending?.pendingChanges ?? pending;
    s.check('get_pending_changes returns the card', Array.isArray(list) ? list.length >= 1 : !!list,
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

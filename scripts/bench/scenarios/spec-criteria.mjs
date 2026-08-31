// SB-4 scenarios 7–8: spec drift (R7c) and the criterion completion loop (R5).
import { callFn, github, rest, until, sweepUntil, Scenario } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const sweep = async (env, session, integrationId, branchName = 'main') =>
  (await callFn(env, session, 'git-pull', { integrationId, mode: 'drift-check', branchName, force: true })).data?.sweep;

const pendingCards = (env, projectId) =>
  rest(env).select('git_change_events', `project_id=eq.${projectId}&status=eq.pending&select=id,metadata`);

export const specDrift = {
  name: 'spec-drift',
  boxes: ['R7c 1–4 (spec diff card, evidence survives a load, no deletes)'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'specdrift');
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success);

    // Mark one criterion met (with git provenance) so the load has evidence to
    // preserve — this is the invariant the whole R7c design hangs on.
    const db = rest(env);
    await db.update('specification_requirements', `id=eq.${fx.ids.req1}`, {
      acceptance_criteria: [
        { text: 'tasks persist across restarts', met: true, provenance: { source: 'git', commitSha: 'bench', at: new Date().toISOString() } },
        { text: 'queries return within 200ms', met: false },
      ],
    });

    // Out-of-band spec edit: rename REQ-002, add REQ-003, keep REQ-001 intact.
    const gh = github(env);
    // Read-after-own-push → poll (contents API stale after the force-reset).
    const specFile = await gh.getFileEventually('.nodespec/spec.json', 'main');
    if (!specFile) throw new Error('spec.json never appeared on main after the setup push');
    const spec = JSON.parse(specFile.content);
    const req2 = spec.requirements.find((r) => r.requirementId === 'REQ-002');
    req2.name = 'Query tasks fast';
    spec.requirements.push({
      requirementId: 'REQ-003', name: 'Export tasks', category: 'functional',
      acceptanceCriteria: ['CSV export works'],
      contentHash: 'recomputed-by-nobody', // deliberately stale entry hash…
    });
    // …so recompute the FILE hash the way parse→verify expects is impossible here;
    // instead serialize honestly: drop specHash and let the card lane report it?
    // No — the sweep hash-verifies. Rebuild entry + file hashes with the same
    // stableSerialize rules (sorted keys at every depth).
    const stable = (v) => {
      if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
      if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
      return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    };
    const { createHash } = await import('node:crypto');
    const sha = (t) => createHash('sha256').update(t).digest('hex');
    for (const r of spec.requirements) {
      const core = {
        requirementId: r.requirementId, name: r.name,
        ...(r.description ? { description: r.description } : {}),
        category: r.category, acceptanceCriteria: r.acceptanceCriteria,
      };
      r.contentHash = sha(stable(core));
    }
    // Shape must match serializeSpec's hashed content EXACTLY — no `features`
    // (the Features portion of the spec was removed, migration 20260625154151).
    const content = {
      vision: spec.vision, constraints: spec.constraints,
      preferences: spec.preferences, requirements: spec.requirements, mappings: spec.mappings,
    };
    spec.specHash = sha(stable(content));
    await gh.putFile('.nodespec/spec.json', 'main', JSON.stringify(spec, null, 2) + '\n', 'docs: hand-edited requirements');

    const result = await sweepUntil(() => sweep(env, session, integrationId), (r) => r?.specChanged === true);
    s.check('sweep flags specChanged', result?.specChanged === true, JSON.stringify(result).slice(0, 300));
    const cards = await until(async () => {
      const rows = await pendingCards(env, fx.ids.project);
      return rows.length > 0 ? rows : null;
    });
    s.check('card carries the spec diff', !!cards && !!cards[0].metadata?.specDiff,
      JSON.stringify(cards?.[0]?.metadata ?? {}).slice(0, 300));

    const restore = await callFn(env, session, 'git-pull', {
      integrationId, mode: 'restore-spec', branchName: 'main',
    });
    s.check('restore-spec applies (mode=applied)', restore.data.success && restore.data.mode === 'applied',
      JSON.stringify(restore.data).slice(0, 300));
    s.check('met evidence SURVIVED the load', (restore.data.counts?.criteriaPreserved ?? 0) >= 1,
      JSON.stringify(restore.data.counts));

    const [req1] = await rest(env).select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const kept = (req1.acceptance_criteria ?? []).find((c) => c.text === 'tasks persist across restarts');
    s.check('DB: the git-evidenced criterion is still met with provenance intact',
      kept?.met === true && kept?.provenance?.source === 'git', JSON.stringify(req1.acceptance_criteria).slice(0, 300));
    const [spec2] = await rest(env).select('specification_requirements',
      `specification_id=eq.${fx.ids.spec}&requirement_id=eq.REQ-003&select=requirement_id,acceptance_criteria`);
    s.check('the repo-added requirement arrived (unmet)', !!spec2 &&
      spec2.acceptance_criteria.every((c) => c.met !== true), JSON.stringify(spec2 ?? null).slice(0, 200));
    return { s, fx, integrationId };
  },
};

export const criteriaLoop = {
  name: 'criteria-loop',
  boxes: ['R5a-c bench box 1–7 (tick → card → one approval → met + provenance)'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'criteria');
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push.data.success);

    // Tick one box + reword another in the task doc, out of band.
    const gh = github(env);
    const doc = await gh.getFileEventually('.nodespec/tasks/api-service.task.md', 'main');
    s.check('task doc was pushed', !!doc);
    if (!doc) return { s, fx, integrationId };
    const edited = doc.content
      .replace('- [ ] tasks persist across restarts', '- [x] tasks persist across restarts')
      .replace('- [ ] queries return within 200ms', '- [ ] queries return within 200 milliseconds');
    await gh.putFile('.nodespec/tasks/api-service.task.md', 'main', edited, 'chore: dev ticked a criterion');

    // SETTLE before sweeping (bench-audit round 15): unlike spec-drift, where a
    // stale-read sweep reads clean and retrying is lossless, the FIRST drift sweep
    // here CONSUMES the opportunity — it mints the card from whatever content the
    // provider serves. A stale read births a delta-less card (live-caught: sweep saw
    // the commit and matched the artifact path but read the PRE-edit content, so no
    // checkbox change was visible and apply-criteria had nothing to apply). Wait
    // until the provider serves the ticked content, then let the sweep mint the card.
    const served = await until(async () => {
      const f = await gh.getFile('.nodespec/tasks/api-service.task.md', 'main');
      return f?.content.includes('- [x] tasks persist across restarts') ? true : null;
    }, { timeoutMs: 30000, everyMs: 2000 });
    s.check('provider serves the ticked doc before the sweep runs', !!served,
      'edited content never became visible — provider staleness exceeded 30s');

    const result = await sweepUntil(() => sweep(env, session, integrationId), (r) => r?.status === 'drift');
    s.check('sweep reports drift', result?.status === 'drift', JSON.stringify(result).slice(0, 200));
    const cards = await until(async () => {
      const rows = await pendingCards(env, fx.ids.project);
      return rows.length > 0 ? rows : null;
    });
    const deltas = cards?.[0]?.metadata?.criterionDeltas;
    s.check('card carries criterionDeltas', !!deltas, JSON.stringify(cards?.[0]?.metadata ?? {}).slice(0, 400));
    if (deltas) {
      const ticks = deltas.deltas.filter((d) => d.direction === 'tick');
      s.check('exactly the ticked criterion is a tick delta',
        ticks.length === 1 && ticks[0].text === 'tasks persist across restarts', JSON.stringify(deltas).slice(0, 300));
      s.check('the REWORDED line is flagged, never guessed',
        deltas.flagged.some((f) => f.text.includes('200 milliseconds')), JSON.stringify(deltas.flagged));
    }

    // Before approval: the criterion must still be unmet (never silent).
    const before = await rest(env).select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    s.check('NEVER SILENT: unmet until the card is approved',
      before[0].acceptance_criteria.every((c) => c.met !== true), JSON.stringify(before[0].acceptance_criteria));

    const apply = await callFn(env, session, 'git-pull', {
      integrationId, mode: 'apply-criteria', changeEventId: cards?.[0]?.id,
    });
    s.check('apply-criteria applies exactly one tick', apply.data.success && apply.data.applied === 1,
      JSON.stringify(apply.data).slice(0, 200));
    const after = await rest(env).select('specification_requirements', `id=eq.${fx.ids.req1}&select=acceptance_criteria`);
    const met = after[0].acceptance_criteria.find((c) => c.text === 'tasks persist across restarts');
    s.check('met:true with git provenance (commitSha + at)',
      met?.met === true && met?.provenance?.source === 'git' && !!met?.provenance?.commitSha,
      JSON.stringify(after[0].acceptance_criteria).slice(0, 300));

    const again = await callFn(env, session, 'git-pull', {
      integrationId, mode: 'apply-criteria', changeEventId: cards?.[0]?.id,
    });
    s.check('no double-apply on a re-run', again.data.success && again.data.applied === 0,
      JSON.stringify(again.data).slice(0, 200));
    return { s, fx, integrationId };
  },
};

export default [specDrift, criteriaLoop];

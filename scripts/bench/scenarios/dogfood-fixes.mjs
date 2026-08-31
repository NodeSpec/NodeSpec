// Dogfood-fix regressions (Godot bench round, 2026-09-02) — the behaviors the
// fix batch changed, proven LIVE against the deployed functions:
//
//   unchanged-push        (#4) a byte-identical tree mints NO commit: the
//                         response says unchanged + serves the EXISTING head
//                         sha, and a real change right after mints normally.
//   patch-key-refusal     (#1/#2) unknown keys in update changes are refused
//                         BY NAME with the metadata.config hint (never
//                         silently dropped), and get_proposal_status derives
//                         the effective per-patch outcome from the row
//                         lifecycle.
//   suppress-guidance     (#5 + fingerprint follow-up) metadata.
//                         suppressCatalogGuidance swaps the packet's
//                         Technology Guidance for the suppression note, AND
//                         moves the task fingerprint so the push gate
//                         actually propagates the flag into the committed
//                         packet.
//   testplan-read-refresh (#3) a stored plan whose fingerprint no longer
//                         matches the live graph regenerates AT READ TIME
//                         (Test Strategy edits preserved, response says
//                         testPlanRefreshed + note); a matching fingerprint
//                         serves the stored plan verbatim, untouched.
import { callFn, rest, github, mcpCall, Scenario } from '../lib.mjs';
import { createProject, connectRepo, bumpArtifactContent } from '../fixtures.mjs';

const parseMcp = (r) => {
  const text = r.data?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
};

export const unchangedPush = {
  name: 'unchanged-push',
  boxes: [
    'DF-4 identical tree → unchanged:true, existing head sha, no new commit',
    'DF-4 real change right after mints a NEW commit normally',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'unchg');
    const gh = github(env);
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);

    const push1 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push succeeds', push1.data.success, JSON.stringify(push1.data).slice(0, 200));

    // Nothing changed — the push must report the existing head, not mint a
    // commit ("I pushed" stays meaningful as evidence of change).
    const push2 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('DF-4: unchanged push reports unchanged:true with the EXISTING head sha',
      push2.data.success && push2.data.unchanged === true &&
      push2.data.commitSha === push1.data.commitSha,
      JSON.stringify(push2.data).slice(0, 300));
    s.check('DF-4: the response SAYS no commit was created',
      typeof push2.data.message === 'string' && push2.data.message.includes('no commit created'),
      JSON.stringify(push2.data.message ?? null));
    const headAfterNoop = await gh.headSha('main');
    s.check('DF-4: main head did not move', headAfterNoop === push1.data.commitSha,
      `head=${headAfterNoop} expected=${push1.data.commitSha}`);

    // Control: a real change right after mints normally — the guard fires
    // only on identical trees, never on real work.
    await bumpArtifactContent(env, fx, 'unchg-v2');
    const push3 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('DF-4 control: a real change mints a NEW commit (no unchanged flag)',
      push3.data.success && push3.data.unchanged !== true &&
      push3.data.commitSha !== push1.data.commitSha,
      JSON.stringify(push3.data).slice(0, 300));
    return { s, fx, integrationId };
  },
};

export const patchKeyRefusal = {
  name: 'patch-key-refusal',
  boxes: [
    'DF-1 unknown change keys refused BY NAME + metadata.config hint',
    'DF-1 complete-metadata update proposes clean',
    'DF-2 get_proposal_status derives effective per-patch outcome',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'patchkey');
    const db = rest(env);

    // The live Godot failure shape: configuration at the top level of changes.
    const refused = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch, external_agent: 'bench-harness',
      patches: [{
        type: 'update_node',
        payload: { id: fx.ids.nodeApi, changes: { configuration: { camera_mode: 'follow' } } },
      }],
    }));
    const refusalText = String(refused?.raw ?? refused?.error ?? JSON.stringify(refused));
    s.check('DF-1: unknown key is refused BY NAME (never silently dropped)',
      refusalText.includes('"configuration"') && refusalText.includes('refused'),
      refusalText.slice(0, 400));
    s.check('DF-1: the refusal hints at metadata.config and lists the known fields',
      refusalText.includes('metadata.config') && refusalText.includes('Known fields'),
      refusalText.slice(0, 400));
    // ai_proposals is keyed by source_branch_id (no project_id column —
    // live-caught on the owner's first DF run: this select 400'd and killed
    // the scenario).
    const orphans = await db.select('ai_proposals', `source_branch_id=eq.${fx.ids.branch}&select=id`);
    s.check('DF-1: no proposal row was created by the refusal', orphans.length === 0,
      `found ${orphans.length} proposal(s)`);

    // The taught path: the COMPLETE metadata object, config under metadata.config.
    const proposed = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch, external_agent: 'bench-harness',
      patches: [{
        type: 'update_node',
        payload: {
          id: fx.ids.nodeApi,
          changes: { metadata: { position: { x: 120, y: 160 }, config: { camera_mode: 'follow' } } },
        },
      }],
      explanations: ['bench: config via metadata.config'],
    }));
    const proposalId = proposed?.proposalId ?? proposed?.proposal_id;
    s.check('DF-1: metadata.config lane proposes clean', !!proposalId,
      JSON.stringify(proposed).slice(0, 300));
    if (!proposalId) return { s, fx };

    const pending = parseMcp(await mcpCall(env, 'get_proposal_status', { project_id: fx.ids.project, proposal_id: proposalId }));
    s.check('status while pending: row pending, one pending patch',
      pending?.status === 'pending' && pending?.patchSummary?.pending === 1,
      JSON.stringify(pending).slice(0, 300));

    // Reject the WHOLE proposal the way the app's review panel does (row
    // status only — stored per-patch stamps stay untouched). The read must
    // derive the effective outcome from the row lifecycle.
    await db.update('ai_proposals', `id=eq.${proposalId}`,
      { status: 'rejected', reviewed_at: new Date().toISOString() });
    const settled = parseMcp(await mcpCall(env, 'get_proposal_status', { project_id: fx.ids.project, proposal_id: proposalId }));
    s.check('DF-2: terminal row governs — the stored pending patch reads rejected, summary agrees',
      settled?.status === 'rejected' &&
      settled?.patches?.[0]?.status === 'rejected' &&
      settled?.patchSummary?.rejected === 1 && settled?.patchSummary?.pending === 0,
      JSON.stringify(settled).slice(0, 300));
    return { s, fx };
  },
};

export const suppressGuidance = {
  name: 'suppress-guidance',
  boxes: [
    'DF-5 packet renders catalog guidance by default (nodejs ai_context)',
    'DF-5 suppressCatalogGuidance flag re-stales the packet AND the committed doc carries the suppression note',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'suppress');
    const db = rest(env);
    const gh = github(env);
    const DOC = '.nodespec/tasks/api-service.task.md';

    // Give the API node a technology whose catalog row carries real
    // ai_context (nodejs: backend-service affinity, enriched in the full
    // sync) — Technology Guidance renders only when guidance exists.
    const [snap] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
    snap.graph_data.nodes[fx.ids.nodeApi].technology = 'nodejs';
    await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snap.graph_data });

    // The push gate's provenance guard only manages artifacts carrying a
    // generator fingerprint (a fingerprint-less task doc is user-authored and
    // NEVER touched — live-caught on the owner's first DF run: the fixture doc
    // shipped verbatim and nothing refreshed). Persist a REAL fingerprint the
    // way UI acceptance does: generate_task_docs → apply its patch payload
    // into the snapshot (the r6-spec-plane emulation).
    const gen = parseMcp(await mcpCall(env, 'generate_task_docs', {
      project_id: fx.ids.project, branch_id: fx.ids.branch, node_ids: ['API Service'],
      external_agent: 'bench-harness',
    }));
    const [genProposal] = gen?.proposalId
      ? await db.select('ai_proposals', `id=eq.${gen.proposalId}&select=patches`)
      : [];
    const genPatch = (genProposal?.patches ?? []).map((p) => p.patch)
      .find((p) => (p.type === 'update_artifact' || p.type === 'add_artifact') &&
        (p.payload?.id === fx.ids.taskArtifact || p.payload?.path === DOC ||
         p.payload?.changes?.path === DOC));
    const genContent = genPatch?.payload?.changes?.content ?? genPatch?.payload?.content;
    const genMeta = genPatch?.payload?.changes?.metadata ?? genPatch?.payload?.metadata;
    s.check('DF-5 baseline: generated packet renders ## Technology Guidance from the catalog',
      typeof genContent === 'string' && genContent.includes('## Technology Guidance') &&
      !genContent.includes('Catalog guidance suppressed') &&
      !!genMeta?.taskContextFingerprint?.fingerprint,
      JSON.stringify({ proposalId: gen?.proposalId, patchTypes: (genProposal?.patches ?? []).map((p) => p.patch?.type) }).slice(0, 300));
    if (typeof genContent !== 'string') return { s, fx };
    const [snapGen] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
    const applyTo = snapGen.graph_data.artifacts[genPatch.payload.id] ?? snapGen.graph_data.artifacts[fx.ids.taskArtifact];
    snapGen.graph_data.artifacts[fx.ids.taskArtifact] = {
      ...applyTo, ...(genPatch.payload.changes ?? genPatch.payload),
      id: fx.ids.taskArtifact, nodeId: fx.ids.nodeApi, kind: 'task', path: DOC,
    };
    await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snapGen.graph_data });

    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const push1 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('setup push: fresh fingerprint means NO refresh (non-vacuous baseline) and the committed doc carries the guidance',
      push1.data.success && (push1.data.packetsRefreshed ?? 0) === 0,
      JSON.stringify(push1.data).slice(0, 300));
    const doc1 = await gh.getFileEventually(DOC, push1.data.commitSha);
    s.check('DF-5 baseline: committed packet renders ## Technology Guidance',
      !!doc1 && doc1.content.includes('## Technology Guidance') &&
      !doc1.content.includes('Catalog guidance suppressed'),
      doc1?.content?.slice(0, 300) ?? '(doc absent)');

    // The project ruling contradicts the catalog: set the flag the way the
    // accepted update_node patch persists it (client-apply emulation).
    const [snap2] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
    const node = snap2.graph_data.nodes[fx.ids.nodeApi];
    node.metadata = { ...(node.metadata ?? {}), suppressCatalogGuidance: true };
    await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snap2.graph_data });

    // Fingerprint follow-up: the flag is packet CONTENT, so the push gate
    // must notice it (packetsRefreshed ≥ 1) — before the fix the fingerprint
    // never moved and the committed packet kept the catalog guidance forever.
    // Non-vacuous because push1 just proved 0 on the same stored fingerprint.
    const push2 = await callFn(env, session, 'git-push', {
      projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true,
    });
    s.check('DF-5: flag flip alone re-stales the packet (packetsRefreshed ≥ 1)',
      push2.data.success && (push2.data.packetsRefreshed ?? 0) >= 1,
      JSON.stringify(push2.data).slice(0, 300));
    const doc2 = await gh.getFileEventually(DOC, push2.data.commitSha);
    s.check('DF-5: committed packet carries the suppression note',
      !!doc2 && doc2.content.includes('Catalog guidance suppressed for this node') &&
      doc2.content.includes('suppressCatalogGuidance'),
      doc2?.content?.slice(0, 400) ?? '(doc absent)');
    return { s, fx, integrationId };
  },
};

export const testplanReadRefresh = {
  name: 'testplan-read-refresh',
  boxes: [
    'DF-3 stale stored plan regenerates AT READ TIME, Test Strategy preserved',
    'DF-3 response says testPlanRefreshed + note; nothing persisted',
    'DF-3 matching fingerprint serves the stored plan verbatim',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'planfresh');
    const db = rest(env);
    const PLAN_PATH = '.nodespec/tests/REQ-001.tests.md';
    const STORED_BODY = '# Test Plan: STALE STORED BODY\n\n## Test Strategy\n\nBENCH CUSTOM STRATEGY LINE\n';

    // A stored plan whose fingerprint verifiably does NOT match the live
    // graph (the Godot failure: five plans still reporting "noschema" after
    // the schema landed, served on the word of a stale flag).
    const [snap] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
    const planId = crypto.randomUUID();
    snap.graph_data.artifacts[planId] = {
      id: planId, nodeId: fx.ids.nodeApi, kind: 'test-plan', path: PLAN_PATH,
      content: STORED_BODY, status: 'accepted',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      metadata: {
        requirementId: 'REQ-001',
        testContextFingerprint: { fingerprint: 'deadbeef', timestamp: new Date().toISOString(), fields: {} },
      },
    };
    await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snap.graph_data });

    // (keyed by source_branch_id — ai_proposals has no project_id column)
    const proposalsBefore = (await db.select('ai_proposals', `source_branch_id=eq.${fx.ids.branch}&select=id`)).length;
    const read1 = parseMcp(await mcpCall(env, 'get_test_plan', {
      project_id: fx.ids.project, branch_id: fx.ids.branch, requirement_id: fx.ids.req1,
    }));
    s.check('DF-3: mismatched fingerprint → regenerated at read time (stale body gone)',
      read1?.testPlanIsNew === false && read1?.testPlanRefreshed === true &&
      typeof read1?.testPlanContent === 'string' &&
      !read1.testPlanContent.includes('STALE STORED BODY'),
      JSON.stringify({ isNew: read1?.testPlanIsNew, refreshed: read1?.testPlanRefreshed }).slice(0, 200));
    s.check('DF-3: user\'s Test Strategy edit carried forward verbatim',
      !!read1?.testPlanContent?.includes('BENCH CUSTOM STRATEGY LINE'),
      read1?.testPlanContent?.slice(0, 300) ?? '(no content)');
    s.check('DF-3: the response EXPLAINS the refresh (note present)',
      typeof read1?.note === 'string' && read1.note.includes('fresh regeneration'),
      JSON.stringify(read1?.note ?? null));
    const proposalsAfter = (await db.select('ai_proposals', `source_branch_id=eq.${fx.ids.branch}&select=id`)).length;
    s.check('DF-3: the refresh persisted NOTHING (push gate owns the artifact)',
      proposalsAfter === proposalsBefore, `proposals ${proposalsBefore}→${proposalsAfter}`);

    // Stamp the CURRENT fingerprint back onto the stored artifact: the next
    // read must serve the stored plan untouched (no churn on fresh plans).
    const currentFp = read1?.fingerprint;
    if (currentFp?.fingerprint) {
      const [snap2] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
      snap2.graph_data.artifacts[planId].metadata.testContextFingerprint = currentFp;
      await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snap2.graph_data });
      const read2 = parseMcp(await mcpCall(env, 'get_test_plan', {
        project_id: fx.ids.project, branch_id: fx.ids.branch, requirement_id: fx.ids.req1,
      }));
      s.check('DF-3: matching fingerprint serves the STORED plan verbatim, no refresh',
        read2?.testPlanRefreshed !== true && read2?.testPlanIsNew === false &&
        !!read2?.testPlanContent?.includes('STALE STORED BODY'),
        JSON.stringify({ refreshed: read2?.testPlanRefreshed, head: read2?.testPlanContent?.slice(0, 120) }));
    } else {
      s.check('DF-3: read returned the current fingerprint for the round-trip', false,
        JSON.stringify(read1?.fingerprint ?? null));
    }
    return { s, fx };
  },
};

export default [unchangedPush, patchKeyRefusal, suppressGuidance, testplanReadRefresh];

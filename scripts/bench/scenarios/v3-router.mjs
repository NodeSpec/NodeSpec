// V3 P2 bench rider (task 2.4): the change router, live. Deno pins prove
// the routing logic against the fake; THIS proves the merged control plane
// end to end on the deployed stack: the auto default applying + recording
// a merged audit row, a tightened lane converting a direct edit into a
// pending proposal with NOTHING changed, resolve_proposal accepting it and
// the change landing, Ask-first refusing outright, and the promotion
// doctrine — a promote_candidate proposal files through the widened
// propose_patches but can NEVER be accepted over MCP.
import { rest, restAs, mcpCall, callFn, uid, Scenario, parseMcp } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';


export const routerLoop = {
  name: 'v3-router',
  boxes: ['V3-P2 auto applies+records', 'V3-P2 propose lane converts', 'V3-P2 resolve_proposal accept', 'V3-P2 ask-first refuses', 'V3-P2 promotion human-only', 'V3-P2 preconditions guard', 'V3-P4 dismissed terminal', 'V3-4b.1 derivations propose-only', 'V3-8.1 queue resolve round-trip'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'v3router');
    const db = rest(env);

    // 1 — the shipped default (auto): the edit applies AND a merged audit
    // row records it — the approvals queue as the complete change surface.
    const auto = parseMcp(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-001',
      description: 'Tasks persist across restarts, rewritten by the router bench.',
      external_agent: 'bench · router',
    }));
    s.check('auto lane applies with routing receipt', auto.routed === 'applied' && !!auto.recordedProposalId,
      JSON.stringify(auto).slice(0, 400));
    const [afterAuto] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=description`);
    s.check('the edit really landed', String(afterAuto?.description).includes('router bench'), afterAuto?.description);
    const [audit] = await db.select('ai_proposals', `id=eq.${auto.recordedProposalId}&select=status,metadata`);
    s.check('the audit row is merged + auto', audit?.status === 'merged' && audit?.metadata?.auto === true,
      JSON.stringify(audit));
    // O.2 (owner 2026-09-22): the row names the CREDENTIAL that filed it, by
    // the key's NAME (never an id prefix, never "unknown agent"); the nickname
    // the agent sent rides beside it as what it calls itself.
    const label = String(audit?.metadata?.credentialLabel ?? '');
    s.check('O.2: the audit row carries the key that filed it, by name', /^key:[0-9a-f-]{36}$/.test(String(audit?.metadata?.credential ?? '')) && label.startsWith('key · ') && !/^key · [0-9a-f]{8}$/.test(label),
      JSON.stringify(audit?.metadata).slice(0, 300));
    s.check('O.2: the nickname the agent sent is kept as the nickname', audit?.metadata?.externalAgent === 'bench · router', String(audit?.metadata?.externalAgent));
    // and an agent that sends NO nickname is still its key, not "unknown agent"
    const anon = parseMcp(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-001',
      description: 'Tasks persist across restarts, rewritten again with no nickname.',
    }));
    const [anonAudit] = anon.recordedProposalId ? await db.select('ai_proposals', `id=eq.${anon.recordedProposalId}&select=metadata`) : [null];
    s.check('O.2: with no external_agent the author is the key itself, never "unknown agent"',
      !!anonAudit && anonAudit.metadata?.externalAgent === anonAudit.metadata?.credentialLabel && !/unknown/i.test(String(anonAudit.metadata?.externalAgent)),
      JSON.stringify(anonAudit?.metadata).slice(0, 300));

    // 2 — tighten Requirements to Propose: the same tool now changes
    // NOTHING and files a pending proposal instead.
    await db.update('projects', `id=eq.${fx.ids.project}`, { automation_policy: { requirements: '1' } });
    const proposed = parseMcp(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-001',
      name: 'Store tasks, renamed via the propose lane',
      external_agent: 'bench · router',
    }));
    s.check('propose lane converts the call', proposed.routed === 'proposed' && !!proposed.proposalId,
      JSON.stringify(proposed).slice(0, 400));
    const [unchanged] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=name`);
    s.check('nothing changed until acceptance', !String(unchanged?.name).includes('renamed'), unchanged?.name);

    // 3 — the server accept lane applies it.
    const accepted = parseMcp(await mcpCall(env, 'resolve_proposal', {
      project_id: fx.ids.project, proposal_id: proposed.proposalId, action: 'accept',
    }));
    s.check('resolve_proposal merges', accepted.status === 'merged' && accepted.applied === 1,
      JSON.stringify(accepted).slice(0, 400));
    const [afterAccept] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=name`);
    s.check('the accepted change landed', String(afterAccept?.name).includes('renamed'), afterAccept?.name);

    // 4 — Ask first refuses outright, naming the lane and the open door.
    await db.update('projects', `id=eq.${fx.ids.project}`, { automation_policy: { requirements: '0' } });
    const refused = parseMcp(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-001', description: 'should never land',
    }));
    s.check('ask-first refuses with guidance', refused.isError === true && String(refused.raw).includes('Ask first'),
      JSON.stringify(refused).slice(0, 300));

    // 5 — promotion doctrine, live: an outcome candidate's promotion can be
    // PROPOSED through the widened propose_patches, but never ACCEPTED over
    // MCP — a key cannot approve what it proposed.
    const candidateId = uid();
    await db.insert('requirement_candidates', {
      id: candidateId, project_id: fx.ids.project, branch_id: fx.ids.branch, node_id: null,
      key: `outcome:${uid().slice(0, 8)}`, kind: 'outcome', name: 'Offline-first sync',
      criteria: [{ text: 'Edits made offline reconcile within 5s of reconnect' }],
    });
    const promo = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch,
      patches: [{ type: 'promote_candidate', payload: { candidateId } }],
      explanations: ['Promote the offline-first outcome to a canonical requirement.'],
      external_agent: 'bench · router',
    }));
    s.check('promotion proposes through the widened lane', !!promo.proposalId, JSON.stringify(promo).slice(0, 300));
    const promoAccept = parseMcp(await mcpCall(env, 'resolve_proposal', {
      project_id: fx.ids.project, proposal_id: promo.proposalId, action: 'accept',
    }));
    s.check('promotion can never be accepted over MCP', promoAccept.isError === true && String(promoAccept.raw).includes('human act'),
      JSON.stringify(promoAccept).slice(0, 300));
    const [cand] = await db.select('requirement_candidates', `id=eq.${candidateId}&select=status`);
    s.check('the candidate stays pending for the app queue', cand?.status === 'pending', cand?.status);

    // 6 — multi-agent preconditions (task 2.7), live: optimistic
    // concurrency against the REAL row. A stale value_equals refuses the
    // level-2 write; a fresh one applies; and the merge gate re-checks at
    // accept: a proposal whose row moved out-of-band stays PENDING with
    // nothing written (AL.8 checks the whole batch first), never
    // last-write-wins; a reject closes it.
    await db.update('projects', `id=eq.${fx.ids.project}`, { automation_policy: {} });
    const [currentRow] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=name`);

    const staleGuard = parseMcp(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-001',
      description: 'guarded overwrite that must never land',
      preconditions: [{ type: 'value_equals', path: 'name', expected: 'a name from a stale read' }],
      external_agent: 'bench · router',
    }));
    s.check('stale precondition refuses the level-2 write',
      staleGuard.isError === true && String(staleGuard.raw).includes('Precondition failed'),
      JSON.stringify(staleGuard).slice(0, 300));

    const freshGuard = parseMcp(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-001',
      description: 'guarded rewrite that lands cleanly',
      preconditions: [{ type: 'value_equals', path: 'name', expected: currentRow.name }],
      external_agent: 'bench · router',
    }));
    s.check('fresh precondition applies with the routing receipt', freshGuard.routed === 'applied',
      JSON.stringify(freshGuard).slice(0, 300));

    await db.update('projects', `id=eq.${fx.ids.project}`, { automation_policy: { requirements: '1' } });
    const guardedProp = parseMcp(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-001',
      description: 'proposed under guard — must never land',
      preconditions: [{ type: 'value_equals', path: 'name', expected: currentRow.name }],
      external_agent: 'bench · router',
    }));
    s.check('guarded proposal files', guardedProp.routed === 'proposed' && !!guardedProp.proposalId,
      JSON.stringify(guardedProp).slice(0, 300));

    await db.update('specification_requirements', `id=eq.${fx.ids.req1}`, { name: 'Moved out-of-band' });
    const staleAccept = parseMcp(await mcpCall(env, 'resolve_proposal', {
      project_id: fx.ids.project, proposal_id: guardedProp.proposalId, action: 'accept',
    }));
    s.check('stale accept fails loudly naming the precondition',
      staleAccept.isError === true && String(staleAccept.raw).includes('Precondition failed'),
      JSON.stringify(staleAccept).slice(0, 300));
    const [guardedRow] = await db.select('ai_proposals', `id=eq.${guardedProp.proposalId}&select=status`);
    s.check('AL.8: nothing applied, the proposal stays pending, and the answer says to reject it or re-file',
      guardedRow?.status === 'pending' && /Nothing was applied/.test(String(staleAccept.raw)) && /stays pending/.test(String(staleAccept.raw)),
      JSON.stringify({ status: guardedRow?.status, raw: String(staleAccept.raw).slice(0, 200) }));
    const [afterStale] = await db.select('specification_requirements', `id=eq.${fx.ids.req1}&select=description`);
    s.check('nothing landed from the stale proposal', !String(afterStale?.description).includes('proposed under guard'),
      afterStale?.description);
    const closeStale = parseMcp(await mcpCall(env, 'resolve_proposal', {
      project_id: fx.ids.project, proposal_id: guardedProp.proposalId, action: 'reject', note: 'filed from a stale read',
    }));
    s.check('and a reject closes it', closeStale.status === 'rejected', JSON.stringify(closeStale).slice(0, 200));

    // 7: dismissed is terminal (P4 rider, task 4.6), live. AL.6: with the
    // Candidates lane at Auto, the dismiss an agent files lands as it files
    // (nothing waits); AL.8: a later change to the dismissed outcome is
    // checked against the row as it is now and set aside at filing, by
    // name, and the row never moves. (The one-criterion promote refusal
    // stays a Deno pin: over MCP, promotion can be proposed but never
    // accepted, so that gate is only reachable through the app's accept
    // lane, which P8 exercises live.)
    await db.update('projects', `id=eq.${fx.ids.project}`, { automation_policy: { requirements: '1', candidates: '2' } });
    const dismissTarget = uid();
    await db.insert('requirement_candidates', {
      id: dismissTarget, project_id: fx.ids.project, branch_id: fx.ids.branch, node_id: null,
      key: `outcome:${uid().slice(0, 8)}`, kind: 'outcome', name: 'Short-lived idea',
      criteria: [{ text: 'never mind' }],
    });
    const dis = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch,
      patches: [{ type: 'dismiss_candidate', payload: { candidateId: dismissTarget } }],
      explanations: ['Dismiss the short-lived idea.'],
      external_agent: 'bench · router',
    }));
    const [afterDismiss] = await db.select('requirement_candidates', `id=eq.${dismissTarget}&select=status,decided_at`);
    s.check('AL.6: at Auto the dismiss lands as it files and stamps the decision',
      dis.routed === 'applied' && dis.status === 'merged' && afterDismiss?.status === 'dismissed' && !!afterDismiss?.decided_at,
      JSON.stringify({ dis, afterDismiss }).slice(0, 300));

    const late = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch,
      patches: [{ type: 'update_candidate', payload: { candidateId: dismissTarget, changes: { name: 'Second thoughts' } } }],
      explanations: ['Try to edit a dismissed candidate.'],
      external_agent: 'bench · router',
    }));
    s.check('a later decide is set aside at filing, by name: dismissed is terminal',
      late.isError === true && /Nothing was applied/.test(String(late.raw)) && /"Short-lived idea" is dismissed now/.test(String(late.raw)),
      JSON.stringify(late).slice(0, 300));
    // a proposal belongs to its branch (ai_proposals has no project column)
    const [setAside] = await db.select('ai_proposals', `source_branch_id=eq.${fx.ids.branch}&order=created_at.desc&limit=1&select=status,metadata`);
    s.check('the set-aside row is rejected by the auto lane, with the reason',
      setAside?.status === 'rejected' && setAside?.metadata?.resolvedBy === 'auto' && /is dismissed now/.test(String(setAside?.metadata?.resolveNote)),
      JSON.stringify(setAside).slice(0, 300));
    const [stillDismissed] = await db.select('requirement_candidates', `id=eq.${dismissTarget}&select=status,name`);
    s.check('the row never moved', stillDismissed?.status === 'dismissed' && stillDismissed?.name === 'Short-lived idea',
      JSON.stringify(stillDismissed));

    // 8 — derivations (4b.1, R5/R6), live: a SLICED promote (criteriaIds)
    // travels the proposal lane and stays pending — NEVER_AUTO_APPLY holds
    // for derivations exactly as for whole-outcome promotes; settle is on
    // the same human-only set; the derivation table is there, RLS-guarded,
    // and empty for the outcome until a human accepts (P8 lands that half).
    const derivedId = uid();
    await db.insert('requirement_candidates', {
      id: derivedId, project_id: fx.ids.project, branch_id: fx.ids.branch, node_id: null,
      key: `outcome:${uid().slice(0, 8)}`, kind: 'outcome', name: 'Tenants export their data',
      criteria: [{ id: 'c1', text: 'Export completes under 60s' }, { id: 'c2', text: 'Export is audited' }],
    });
    const sliced = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch,
      patches: [{ type: 'promote_candidate', payload: { candidateId: derivedId, criteriaIds: ['c1'], name: 'Export is fast' } }],
      explanations: ['Derive the speed requirement from the export outcome.'],
      external_agent: 'bench · router',
    }));
    s.check('a sliced promote files as a proposal', !!sliced.proposalId, JSON.stringify(sliced).slice(0, 300));
    const slicedAccept = parseMcp(await mcpCall(env, 'resolve_proposal', {
      project_id: fx.ids.project, proposal_id: sliced.proposalId, action: 'accept',
    }));
    s.check('a key cannot accept a derivation either', slicedAccept.isError === true && String(slicedAccept.raw).includes('human act'),
      JSON.stringify(slicedAccept).slice(0, 300));
    // AL.8: while that promotion waits on the outcome, a second proposal on
    // the same outcome is refused naming the one waiting (two waiting
    // proposals on one thing would leave the later one half-applied).
    const settleEarly = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch,
      patches: [{ type: 'settle_candidate', payload: { candidateId: derivedId } }],
      explanations: ['Declare the outcome fully covered.'],
      external_agent: 'bench · router',
    }));
    s.check('AL.8: a settle filed while the promotion waits is refused, naming the waiting proposal',
      settleEarly.isError === true && String(settleEarly.raw).includes(sliced.proposalId) && /already waiting on the outcome/.test(String(settleEarly.raw)),
      JSON.stringify(settleEarly).slice(0, 300));
    const derivations = await db.select('outcome_derivations', `candidate_id=eq.${derivedId}&select=id`);
    const [untouched] = await db.select('requirement_candidates', `id=eq.${derivedId}&select=status,requirement_row_id`);
    s.check('nothing derived until a human accepts — the outcome is pending and unlinked',
      Array.isArray(derivations) && derivations.length === 0 && untouched?.status === 'pending' && untouched?.requirement_row_id === null,
      JSON.stringify({ derivations, untouched }));

    // 9 — 8.1: the app half. The approvals queue posts the SAME tool with the
    // user's session (the direct request path, Authorization: Bearer <jwt>):
    // promotion is a human act, so THIS accept derives — the slice becomes a
    // REQ, the derivation names the proposal as its origin, the outcome stays
    // pending (one criterion still unclaimed); then settle from the queue
    // closes it. The audit row says the app decided.
    const appAccept = await callFn(env, session, 'mcp-server', {
      tool: 'resolve_proposal', arguments: { project_id: fx.ids.project, proposal_id: sliced.proposalId, action: 'accept' },
    });
    s.check('the app session accepts the derivation',
      appAccept.status === 200 && appAccept.data?.success === true && appAccept.data?.data?.status === 'merged',
      JSON.stringify(appAccept).slice(0, 400));
    const derivedRows = await db.select('outcome_derivations',
      `candidate_id=eq.${derivedId}&select=id,requirement_row_id,via_proposal_id,proposed_by_kind,criteria_slice`);
    s.check('one derivation — agent-proposed, via that proposal, one criterion in the slice',
      derivedRows.length === 1 && derivedRows[0].via_proposal_id === sliced.proposalId
        && derivedRows[0].proposed_by_kind === 'agent' && (derivedRows[0].criteria_slice ?? []).length === 1,
      JSON.stringify(derivedRows));
    const [derivedReq] = derivedRows.length
      ? await db.select('specification_requirements', `id=eq.${derivedRows[0].requirement_row_id}&select=name,acceptance_criteria`)
      : [null];
    s.check('the REQ carries the slice', derivedReq?.name === 'Export is fast' && (derivedReq?.acceptance_criteria ?? []).length === 1,
      JSON.stringify(derivedReq));
    const [afterDerive] = await db.select('requirement_candidates', `id=eq.${derivedId}&select=status,requirement_row_id`);
    s.check('the outcome stays pending with its first derivation linked',
      afterDerive?.status === 'pending' && !!afterDerive?.requirement_row_id && afterDerive.requirement_row_id === derivedRows[0]?.requirement_row_id,
      JSON.stringify(afterDerive));
    const [resolvedRow] = await db.select('ai_proposals', `id=eq.${sliced.proposalId}&select=status,metadata`);
    s.check('the proposal is merged and audited as an app decision',
      resolvedRow?.status === 'merged' && resolvedRow?.metadata?.resolvedBy === 'app', JSON.stringify(resolvedRow));
    // with the derivation landed nothing waits on the outcome, so settle files
    // as a proposal (human-only, R6) and the queue closes it
    const settle = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project, branch_id: fx.ids.branch,
      patches: [{ type: 'settle_candidate', payload: { candidateId: derivedId } }],
      explanations: ['Declare the outcome fully covered.'],
      external_agent: 'bench · router',
    }));
    s.check('settle files as a proposal (human-only, R6)', !!settle.proposalId && settle.status === 'pending', JSON.stringify(settle).slice(0, 300));
    const appSettle = await callFn(env, session, 'mcp-server', {
      tool: 'resolve_proposal', arguments: { project_id: fx.ids.project, proposal_id: settle.proposalId, action: 'accept' },
    });
    const [settled] = await db.select('requirement_candidates', `id=eq.${derivedId}&select=status`);
    s.check('settle from the queue closes the outcome', appSettle.data?.success === true && settled?.status === 'accepted',
      JSON.stringify({ appSettle: appSettle.data, settled }).slice(0, 400));

    // AE.12 (owner 2026-09-25, "reason please"): a proposal the person
    // rejects on the canvas carries their reason. The app writes the same
    // key resolve_proposal writes (metadata.resolveNote, resolvedBy app);
    // the agent reads it back as reviewNote. The write here is the app's
    // own PATCH as the signed-in person, under RLS.
    await db.update('projects', `id=eq.${fx.ids.project}`, { automation_policy: { requirements: '1' } });
    const [wordedBefore] = await db.select('specification_requirements', `id=eq.${fx.ids.req2}&select=description`);
    const toReject = parseMcp(await mcpCall(env, 'update_requirement', {
      project_id: fx.ids.project, requirement_id: 'REQ-002', description: 'A change the person will turn down.', external_agent: 'bench · router',
    }));
    s.check('AE.12: a proposal waits for the person', toReject.routed === 'proposed' && !!toReject.proposalId, JSON.stringify(toReject).slice(0, 300));
    const me = restAs(env, session);
    const reason = 'Not this way: REQ-002 stays as the customer worded it.';
    const [before] = (await me.select('ai_proposals', `id=eq.${toReject.proposalId}&select=metadata`)).data ?? [];
    const stamped = await me.update('ai_proposals', `id=eq.${toReject.proposalId}`, { metadata: { ...(before?.metadata ?? {}), resolveNote: reason, resolvedBy: 'app' }, status: 'rejected' });
    s.check('AE.12: the person\'s rejection with its reason lands under RLS', stamped.ok && stamped.data?.[0]?.status === 'rejected', JSON.stringify(stamped.error ?? stamped.data).slice(0, 300));
    const readBack = parseMcp(await mcpCall(env, 'get_proposal_status', { proposal_id: toReject.proposalId }));
    s.check('AE.12: the agent reads the reason as reviewNote on the rejected proposal',
      readBack.status === 'rejected' && readBack.reviewNote === reason, JSON.stringify(readBack).slice(0, 300));
    const [stillWorded] = await db.select('specification_requirements', `id=eq.${fx.ids.req2}&select=description`);
    // UAT hardening 2026-09-27: this read the candidate row, which has no
    // description, so it could never fail. The requirement is what the
    // rejected proposal would have changed.
    s.check('AE.12: nothing of the rejected change landed',
      !!stillWorded && !!wordedBefore && stillWorded.description === wordedBefore.description && !String(stillWorded.description).includes('turn down'),
      JSON.stringify({ before: wordedBefore?.description, after: stillWorded?.description }).slice(0, 300));

    return { s };
  },
};

export default [routerLoop];

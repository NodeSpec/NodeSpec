// V3 AE.6 (owner 2026-09-25): the Expand button on the canvas stages an
// explode request for the person's agent to pick up over MCP (MCP is not
// event driven, so the request waits where the agent already looks).
//
//   the person presses Expand on API Service: the app's read-modify-write
//   of projects.metadata.stagedExplodes, under RLS →
//   the agent's get_project_status leads with EXPANSION REQUESTED, naming
//   the node and the explode_node intent, and lists it under stagedExplodes;
//   the node's slice says it too →
//   the agent does what the lead says: the node lease, then ONE explode_node
//   proposal →
//   the status now says the expansion is proposed and waits for the person,
//   naming the proposal, and does not ask again →
//   the person withdraws the request: nothing is served.
//
// The accept of the explode is the app's patch engine (aa3-explode_test.ts
// applies it); the app drops the request once the parts land.
import { restAs, mcpCall, Scenario, parseMcp } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';


export const ae6ExpandRequest = {
  name: 'ae6-expand-request',
  boxes: ['AE.6 the Expand press stages the request', 'AE.6 the status leads with it and the slice says it', 'AE.6 once proposed the status says it waits', 'AE.6 withdrawn is gone'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'ae6');
    const me = restAs(env, session);
    const project = fx.ids.project;

    // 1: the press. The app reads the metadata, adds the request, writes it back.
    const before = await me.select('projects', `id=eq.${project}&select=metadata`);
    // UAT hardening 2026-09-27: exactly what the app's Expand writes
    // (src/ui/utils/explode-staging.ts stageExplode: node, label, time; no
    // note), so the bench proves the request the product makes.
    const staged = [{ nodeId: fx.ids.nodeApi, label: 'API Service', stagedAt: new Date().toISOString() }];
    const wrote = await me.update('projects', `id=eq.${project}`, { metadata: { ...(before.data?.[0]?.metadata ?? {}), stagedExplodes: staged } });
    s.check('the person stages the request on the project under RLS', wrote.ok && wrote.data?.[0]?.metadata?.stagedExplodes?.length === 1, JSON.stringify(wrote).slice(0, 300));

    // 2: the agent's reads.
    let status = parseMcp(await mcpCall(env, 'get_project_status', { project_id: project }));
    const lead = String(status.nextAction ?? '');
    s.check('get_project_status leads with the request, naming the node and the intent, and lists it',
      lead.startsWith('EXPANSION REQUESTED from the canvas: the user asked for "API Service"') && lead.includes(fx.ids.nodeApi) &&
      !lead.includes('saying:') && lead.includes('ONE explode_node intent') &&
      status.stagedExplodes?.length === 1 && status.stagedExplodes[0].nodeId === fx.ids.nodeApi && status.stagedExplodes[0].proposalId === null,
      JSON.stringify({ lead: lead.slice(0, 300), stagedExplodes: status.stagedExplodes }));
    const slice = parseMcp(await mcpCall(env, 'get_project_context', { project_id: project, target_type: 'node', target_id: fx.ids.nodeApi, view: 'slice' }));
    s.check('the node\'s slice says it',
      !!slice.explodeRequested && slice.explodeRequested.note === null && (slice.notes ?? []).some((n) => n.includes('exploded into its parts')),
      JSON.stringify({ explodeRequested: slice.explodeRequested, notes: slice.notes }).slice(0, 400));

    // 3: the agent does what the lead says.
    const hold = parseMcp(await mcpCall(env, 'checkout_task', { project_id: project, level: 'node', node_id: fx.ids.nodeApi, external_agent: 'bench · exploder' }));
    s.check('the node lease is claimed', hold.claimed === true, JSON.stringify(hold).slice(0, 300));
    const proposed = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: project, external_agent: 'bench · exploder',
      intents: [{ kind: 'explode_node', nodeId: fx.ids.nodeApi, parts: [{ label: 'Handlers', role: 'part-handler', files: ['src/api/index.ts'], why: 'the HTTP handlers the service exposes' }] }],
    }));
    s.check('one explode_node proposal is filed', typeof proposed.proposalId === 'string' && proposed.compiled?.intents === 1, JSON.stringify(proposed).slice(0, 400));

    // 4: proposed, the status says it waits and never asks twice.
    status = parseMcp(await mcpCall(env, 'get_project_status', { project_id: project }));
    const after = String(status.nextAction ?? '');
    s.check('the status says the expansion is proposed and waits, naming the proposal, and does not ask again',
      after.includes(`The expansion of "API Service" the user asked for is proposed (proposal ${proposed.proposalId}) and waits for their review; do not propose it again.`) &&
      !after.includes('EXPANSION REQUESTED') && status.stagedExplodes?.[0]?.proposalId === proposed.proposalId,
      JSON.stringify({ lead: after.slice(0, 300), stagedExplodes: status.stagedExplodes }));

    // 5: withdrawn.
    const now = await me.select('projects', `id=eq.${project}&select=metadata`);
    const { stagedExplodes: _dropped, ...kept } = now.data?.[0]?.metadata ?? {};
    const withdrew = await me.update('projects', `id=eq.${project}`, { metadata: kept });
    status = parseMcp(await mcpCall(env, 'get_project_status', { project_id: project }));
    s.check('withdrawn: the status carries neither the lead nor the list',
      withdrew.ok && !String(status.nextAction ?? '').toLowerCase().includes('expansion') && status.stagedExplodes === undefined,
      JSON.stringify({ withdrew: withdrew.status, lead: String(status.nextAction ?? '').slice(0, 200), stagedExplodes: status.stagedExplodes }));
    return { s, fx };
  },
};

export default [ae6ExpandRequest];

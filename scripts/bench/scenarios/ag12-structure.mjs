// AG.12a to AG.12c (phase 6, owner 2026-09-28: "Agent proposals should follow the same
// canvas rules, but these rules need to be made present to the user's agent over MCP"),
// live against the deployed mcp-server:
//  - a node placed where its parent may not hold it is refused where it is filed, naming
//    what the parent holds, and nothing is filed;
//  - a placement that passes is filed with the placement the parent gives, whatever the
//    agent sent, and the answer says so;
//  - the node reads (structured and slice) say what the node and its parent hold;
//  - the task packet says where the node runs (AG.12b), and the host's packet names the
//    service it runs with its technology;
//  - the catalog reads say how a type holds (AG.12c).
// The project is a bench fixture with its API service moved into an App Engine host.
import { rest, mcpCall, parseMcp, Scenario, uid } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

const brief = (v) => JSON.stringify(v).slice(0, 400);

export const structureLive = {
  name: 'ag12-structure-live',
  boxes: [
    'AG.12a a proposal placed where its parent may not hold it is refused, naming what the parent holds',
    'AG.12a the placement follows how the parent holds',
    'AG.12a the node reads say what the node and its parent hold',
    'AG.12b the packet says where the node runs; the host names what it runs',
    'AG.12c the catalog reads say how each type holds',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const db = rest(env);
    const fx = await createProject(env, session, 'ag12');
    const hostId = uid();

    // The API service runs on App Engine: the host carries its technology and one choice.
    const [snap] = await db.select('graph_snapshots', `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
    snap.graph_data.nodes[hostId] = {
      id: hostId, type: 'docker-container', label: 'App Engine', technology: 'gcp-app-engine',
      artifacts: [], metadata: { position: { x: 60, y: 60 }, config: { baseImage: 'nodejs20' } }, status: 'draft',
    };
    Object.assign(snap.graph_data.nodes[fx.ids.nodeApi], { parentId: hostId, placementKind: 'hosts', technology: 'nodejs' });
    await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snap.graph_data });
    const [engine] = await db.select('technology_catalog', 'id=eq.gcp-app-engine&select=name');
    const [node] = await db.select('technology_catalog', 'id=eq.nodejs&select=name');

    // AG.12c: the catalog reads.
    const found = parseMcp(await mcpCall(env, 'search_catalog', { query: 'Container or App Runtime' }));
    const runtime = (found.roles ?? []).find((r) => r.id === 'docker-container');
    s.check('search_catalog gives the runtime a line saying it runs what it holds and what it may hold',
      /^Runs what it holds: a node inside it is hosted by it\. May hold: /.test(runtime?.holds ?? '') && !/Hosting environment/.test(runtime?.description ?? ''),
      brief(runtime ?? found));
    const vpc = parseMcp(await mcpCall(env, 'lookup_catalog', { role_id: 'vpc' }));
    s.check('lookup_catalog says a VPC places what it holds, and lists what it may hold',
      /Places what it holds: a node inside it names it in its own configuration\. May hold: .*network-connection/.test(String(vpc.catalog ?? '')),
      brief(vpc));

    // AG.12a: the node reads.
    const structured = parseMcp(await mcpCall(env, 'get_project_context', {
      project_id: fx.ids.project, target_type: 'node', target_id: 'API Service', view: 'structured',
    }));
    const target = structured?.context?.target?.node;
    // A leaf's line names the parts it lists, if any; nothing else may sit in it.
    const leafLine = (line) => /^A leaf(: it holds nothing\.|\. Parts: .*Nothing else can be placed inside it\.)$/.test(line ?? '');
    s.check('the structured read says the service is a leaf and its host runs what it holds',
      leafLine(target?.holds) && target?.parentNode?.placementKind === 'hosts'
        && /^Runs what it holds/.test(target?.parentNode?.holds ?? ''),
      brief({ holds: target?.holds, parent: target?.parentNode }));
    const slice = parseMcp(await mcpCall(env, 'get_project_context', {
      project_id: fx.ids.project, target_type: 'node', target_id: 'API Service', view: 'slice',
    }));
    const sliceNode = slice?.slice?.node;
    s.check('the slice says the same, with the parent\'s type',
      leafLine(sliceNode?.holds) && sliceNode?.parent?.role === 'docker-container'
        && /^Runs what it holds/.test(sliceNode?.parent?.holds ?? ''),
      brief(sliceNode ?? slice));

    // AG.12a: a placement the host may not hold is refused where it is filed.
    // Proposals are scoped by branch (ai_proposals has no project column).
    const countProposals = async () => (await db.select('ai_proposals', `source_branch_id=eq.${fx.ids.branch}&select=id`)).length;
    const before = await countProposals();
    const refused = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project,
      intents: [{ kind: 'add_node', label: 'Phone App', type: 'mobile-app', parentId: hostId }],
      explanations: ['bench: a phone app inside a server runtime'],
    }));
    // The transport puts "Error: " before every tool error.
    const refusal = String(refused.raw ?? refused.error ?? '');
    s.check('a phone app placed in the runtime is refused, naming what the runtime may hold',
      refused.isError === true && refusal.startsWith('Error: Placement refused:') && /a docker-container may not hold a mobile-app\. Runs what it holds/.test(refusal)
        && /May hold: .*backend-service/.test(refusal) && /Nothing was created\.$/.test(refusal),
      refusal);
    s.check('nothing was filed', (await countProposals()) === before, `before ${before}`);

    // AG.12a: a placement that passes carries the host's placement, whatever the agent sent.
    const workerId = uid();
    const filed = parseMcp(await mcpCall(env, 'propose_patches', {
      project_id: fx.ids.project,
      patches: [{ type: 'add_node', payload: { id: workerId, type: 'worker', label: 'Mailer', parentId: hostId, placementKind: 'scopes' } }],
      explanations: ['bench: a worker the runtime runs'],
    }));
    const [row] = filed.proposalId ? await db.select('ai_proposals', `id=eq.${filed.proposalId}&select=patches`) : [];
    const stored = (row?.patches ?? []).map((p) => p.patch ?? p).find((p) => p.payload?.id === workerId);
    s.check('the filed worker is hosted by the runtime, as on the canvas',
      stored?.payload?.placementKind === 'hosts', brief(stored ?? filed));
    s.check('the answer says the placement was set from the parent',
      (filed.normalizations ?? []).some((n) => n.field === 'placementKind' && n.from === 'scopes' && n.to === 'hosts'),
      brief(filed.normalizations ?? filed));

    // AG.12b: the packets.
    const gen = parseMcp(await mcpCall(env, 'generate_task_docs', {
      project_id: fx.ids.project, node_ids: ['API Service', 'App Engine'], external_agent: 'bench-harness',
    }));
    const [genRow] = gen?.proposalId ? await db.select('ai_proposals', `id=eq.${gen.proposalId}&select=patches`) : [];
    const docs = (genRow?.patches ?? []).map((p) => p.patch ?? p)
      .map((p) => p.payload?.changes?.content ?? p.payload?.content).filter((c) => typeof c === 'string');
    const apiDoc = docs.find((d) => d.startsWith('# Task: API Service')) ?? '';
    const hostDoc = docs.find((d) => d.startsWith('# Task: App Engine')) ?? '';
    s.check('the service\'s packet says it runs on App Engine, with the host\'s technology and where its choices are',
      apiDoc.includes('**Runs on:** API Service in App Engine.')
        && apiDoc.includes(`**Host:** App Engine (Container or App Runtime, ${engine?.name}) runs this code`)
        && apiDoc.includes("The host's recorded choices are under Inherited Context below")
        && /From \*\*App Engine\*\* \(docker-container\): baseImage: nodejs20/.test(apiDoc),
      apiDoc.split('\n').filter((l) => /Runs on|Host:|From \*\*/.test(l)).join(' | ').slice(0, 400) || brief(gen));
    s.check('the host\'s packet names the service it runs with its technology',
      hostDoc.includes("**Runs (write this host's deploy definition for each one's technology):**")
        && hostDoc.includes(`- API Service (Backend Service): ${node?.name}`),
      hostDoc.split('\n').filter((l) => /Runs|API Service/.test(l)).join(' | ').slice(0, 400) || brief(gen));

    return { s, fx };
  },
};

export default [structureLive];

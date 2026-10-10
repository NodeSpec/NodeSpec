// AL.28 (owner 2026-10-08, a live production bug): get_test_plan files a
// plan as two steps, create the file and link it to its node. The engine's
// dependency sort ran every update_node before every add_artifact, so the
// link was checked against a graph without the file (MISSING_ARTIFACT) and
// the server's Auto accept set all 33 such proposals aside. The app's replays
// fell back to filed order and hid it. These run the engine itself.
import { describe, it, expect } from 'vitest';
import { applyPatch, applyPatches, sortPatchesByDependencyOrder } from '@nodespec/core/patch-engine.js';
import {
  createAddArtifactPatch,
  createAddContractPatch,
  createAddEdgePatch,
  createAddNodePatch,
  createUpdateArtifactPatch,
  createUpdateNodePatch,
} from '@nodespec/core/patch-factory.js';
import { createEmptyGraph, generateUUID } from '@nodespec/core/utils.js';
import type { Artifact, Graph, Node, PatchOperation } from '@nodespec/core/types.js';

const human = (summary: string) => ({ actorType: 'human' as const, summary });
const T0 = Date.parse('2026-10-08T13:13:38.000Z');

/** Patches carry the order they were filed in, a millisecond apart. */
function filed<P extends PatchOperation>(patches: P[]): P[] {
  return patches.map((p, i) => ({ ...p, metadata: { ...p.metadata, timestamp: new Date(T0 + i).toISOString() } }));
}

function node(label: string): Node {
  return { id: generateUUID(), type: 'service', label, data: {}, metadata: {} } as Node;
}

function file(nodeId: string, path: string, kind: Artifact['kind'] = 'test-plan'): Artifact {
  const at = new Date(T0).toISOString();
  return { id: generateUUID(), nodeId, kind, path, content: `# ${path}`, language: 'markdown', status: 'draft', createdAt: at, updatedAt: at, metadata: {} } as Artifact;
}

/** A graph holding the given nodes, built through the engine. */
function graphWith(...nodes: Node[]): Graph {
  const r = applyPatches(createEmptyGraph(), filed(nodes.map((n) => createAddNodePatch(n, human(`add ${n.label}`)))));
  if (!r.success || !r.graph) throw new Error(`setup failed: ${r.error?.message}`);
  return r.graph;
}

/** The pair get_test_plan and generate_task_docs filed, linking from the read-time list. */
function createAndLink(g: Graph, nodeId: string, path: string, kind: Artifact['kind'] = 'test-plan'): { art: Artifact; patches: PatchOperation[] } {
  const art = file(nodeId, path, kind);
  const current = g.nodes[nodeId].artifacts ?? [];
  return {
    art,
    patches: [
      createAddArtifactPatch(art, human(`create ${path}`)),
      createUpdateNodePatch(nodeId, { artifacts: [...current, art.id] }, human(`link ${path}`)),
    ],
  };
}

/** One patch at a time, in filed order: what the app's fallback did. */
function oneAtATime(g: Graph, patches: PatchOperation[]): Graph {
  let cur = g;
  for (const p of patches) {
    const r = applyPatch(cur, p);
    if (!r.success || !r.graph) throw new Error(`filed-order apply failed at ${p.type}: ${r.error?.message}`);
    cur = r.graph;
  }
  return cur;
}

describe('AL.28: a link filed with the file it links applies in one batch', () => {
  it("get_test_plan's create-then-link proposal applies in one call, and the node links the plan once", () => {
    const web = node('Web App');
    const g = graphWith(web);
    const { art, patches } = createAndLink(g, web.id, '.nodespec/tests/req-015.tests.md');

    const r = applyPatches(g, filed(patches));

    expect(r.error?.code).toBeUndefined();
    expect(r.success).toBe(true);
    expect(r.graph!.artifacts[art.id]?.path).toBe('.nodespec/tests/req-015.tests.md');
    expect(r.graph!.nodes[web.id].artifacts).toEqual([art.id]);
  });

  it('a link filed before its file applies too', () => {
    const web = node('Web App');
    const g = graphWith(web);
    const { art, patches } = createAndLink(g, web.id, '.nodespec/tests/req-001.tests.md');

    const r = applyPatches(g, filed([patches[1], patches[0]]));

    expect(r.success).toBe(true);
    expect(r.graph!.nodes[web.id].artifacts).toEqual([art.id]);
  });

  it('a link to a file that is in neither the graph nor the batch is still refused', () => {
    const web = node('Web App');
    const g = graphWith(web);
    const ghost = generateUUID();
    const other = file(web.id, 'docs/other.md', 'doc');

    const r = applyPatches(g, filed([
      createAddArtifactPatch(other, human('create other')),
      createUpdateNodePatch(web.id, { artifacts: [other.id, ghost] }, human('link a ghost')),
    ]));

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('MISSING_ARTIFACT');
    expect(r.error?.message).toContain(ghost);
  });

  it("generate_task_docs' four create-and-link pairs on four nodes apply in one call", () => {
    const nodes = ['Web App', 'App API', 'Worker', 'Database'].map(node);
    const g = graphWith(...nodes);
    const pairs = nodes.map((n) => createAndLink(g, n.id, `.nodespec/tasks/${n.label.toLowerCase().replace(/ /g, '-')}.md`, 'task'));

    const r = applyPatches(g, filed(pairs.flatMap((p) => p.patches)));

    expect(r.success).toBe(true);
    nodes.forEach((n, i) => expect(r.graph!.nodes[n.id].artifacts).toEqual([pairs[i].art.id]));
  });

  it('a link naming two new files runs after the later of the two', () => {
    const web = node('Web App');
    const g = graphWith(web);
    const a = file(web.id, 'docs/a.md', 'doc');
    const b = file(web.id, 'docs/b.md', 'doc');

    const r = applyPatches(g, filed([
      createAddArtifactPatch(a, human('create a')),
      createUpdateNodePatch(web.id, { artifacts: [a.id, b.id] }, human('link both')),
      createAddArtifactPatch(b, human('create b')),
    ]));

    expect(r.success).toBe(true);
    expect(r.graph!.nodes[web.id].artifacts).toEqual([a.id, b.id]);
  });

  it('every other patch keeps the place the phase order gives it', () => {
    const web = node('Web App');
    const api = node('App API');
    const g = graphWith(web);
    const existing = file(web.id, 'src/app.ts', 'source');
    const g1 = applyPatches(g, filed([createAddArtifactPatch(existing, human('seed'))])).graph!;
    const plan = file(web.id, '.nodespec/tests/req-002.tests.md');
    const contractId = generateUUID();

    const patches = filed([
      createUpdateNodePatch(web.id, { label: 'Web App (renamed)' }, human('rename')),
      createAddArtifactPatch(plan, human('create plan')),
      createUpdateNodePatch(web.id, { artifacts: [existing.id, plan.id] }, human('link plan')),
      createUpdateArtifactPatch(existing.id, { content: 'export {}' }, human('edit app.ts')),
      createAddEdgePatch({ id: generateUUID(), source: web.id, target: api.id, contractId, label: 'calls', metadata: {} } as never, human('wire')),
      createAddNodePatch(api, human('add api')),
      createAddContractPatch({ id: contractId, kind: 'rest', name: 'Orders', schema: {}, metadata: {} } as never, human('contract')),
    ]);
    const summaries = sortPatchesByDependencyOrder(patches).map((p) => p.metadata.summary);

    expect(summaries).toEqual(['contract', 'add api', 'rename', 'create plan', 'link plan', 'edit app.ts', 'wire']);
    const r = applyPatches(g1, patches);
    expect(r.success).toBe(true);
    expect(r.graph!.nodes[web.id].label).toBe('Web App (renamed)');
    expect(r.graph!.nodes[web.id].artifacts).toEqual([existing.id, plan.id]);
  });

  it("a branch log holding several proposals' pairs replays in one call to the graph filed order builds", () => {
    // The server's branch head replays every patch after the snapshot in one
    // applyPatches call; before AL.28 one such pair in the log made that throw,
    // which left every later Auto apply on the branch waiting.
    const web = node('Web App');
    const api = node('App API');
    const g = graphWith(web, api);
    const first = createAndLink(g, web.id, '.nodespec/tests/req-001.tests.md');
    const afterFirst = oneAtATime(g, first.patches);
    const second = createAndLink(afterFirst, web.id, '.nodespec/tasks/web-app.md', 'task');
    const afterSecond = oneAtATime(afterFirst, second.patches);
    const third = createAndLink(afterSecond, api.id, '.nodespec/tests/req-002.tests.md');
    const log = filed([
      ...first.patches,
      createUpdateNodePatch(api.id, { label: 'Orders API' }, human('rename api')),
      ...second.patches,
      ...third.patches,
    ]);

    const replay = applyPatches(g, log);
    const byFiledOrder = oneAtATime(g, log);

    expect(replay.success).toBe(true);
    expect(replay.graph!.nodes).toEqual(byFiledOrder.nodes);
    expect(replay.graph!.artifacts).toEqual(byFiledOrder.artifacts);
    expect(replay.graph!.nodes[web.id].artifacts).toEqual([first.art.id, second.art.id]);
    expect(replay.graph!.nodes[api.id].artifacts).toEqual([third.art.id]);
  });

  it('applying a batch leaves its patches as they were filed', () => {
    // The server writes the patches it applied to the branch log; a later
    // file on the same node once pushed itself into an earlier link patch.
    const web = node('Web App');
    const g = graphWith(web);
    const first = createAndLink(g, web.id, '.nodespec/tests/req-005.tests.md');
    const second = file(web.id, '.nodespec/tasks/web-app.md', 'task');
    const batch = filed([...first.patches, createAddArtifactPatch(second, human('create doc'))]);
    const asFiled = JSON.parse(JSON.stringify(batch));

    const r = applyPatches(g, batch);

    expect(r.success).toBe(true);
    expect(r.graph!.nodes[web.id].artifacts).toEqual([first.art.id, second.id]);
    expect(JSON.parse(JSON.stringify(batch))).toEqual(asFiled);
  });

  it('a file created for a node links it with no link step, so two agents never overwrite each other', () => {
    // AL.28b: the generators file the create alone. Two plans for one node,
    // each built from the same read, both stay linked whichever applies first.
    const web = node('Web App');
    const g = graphWith(web);
    const one = file(web.id, '.nodespec/tests/req-003.tests.md');
    const two = file(web.id, '.nodespec/tests/req-004.tests.md');

    const ab = applyPatches(applyPatches(g, [createAddArtifactPatch(one, human('agent A'))]).graph!, [createAddArtifactPatch(two, human('agent B'))]);
    const ba = applyPatches(applyPatches(g, [createAddArtifactPatch(two, human('agent B'))]).graph!, [createAddArtifactPatch(one, human('agent A'))]);

    expect(ab.graph!.nodes[web.id].artifacts).toEqual([one.id, two.id]);
    expect(ba.graph!.nodes[web.id].artifacts).toEqual([two.id, one.id]);
  });
});

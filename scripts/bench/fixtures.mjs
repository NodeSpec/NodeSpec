// SB-4 · fixtures — per-run state, mirroring supabase/seed.sql shapes.
//
// Every run creates FRESH projects (name prefix `bench-auto-`) and starts by
// deleting the previous run's leftovers (projects cascade to branches,
// snapshots, specs, cards, integrations). The sandbox repo is reset separately
// (lib.github().resetSandbox()).
import { rest, uid, sleep } from './lib.mjs';

export const RUN_PREFIX = 'bench-auto-';

export async function cleanupPreviousRuns(env) {
  const db = rest(env);
  await db.delete('projects', `name=like.${RUN_PREFIX}*`);
}

/**
 * A project with main branch + a schema-v8 snapshot carrying two nodes, one
 * edge/contract, and one file-backed artifact (push needs content + non-
 * suggested status), plus a spec with two requirements (criteria) mapped to the
 * API node. Shape mirrors supabase/seed.sql; ids are fresh per call.
 */
export async function createProject(env, session, label) {
  const db = rest(env);
  const ids = {
    project: uid(), branch: uid(), snapshot: uid(),
    nodeApi: uid(), nodeDb: uid(), portOut: uid(), portIn: uid(),
    contract: uid(), edge: uid(), artifact: uid(), taskArtifact: uid(),
    spec: uid(), req1: uid(), req2: uid(),
  };
  const name = `${RUN_PREFIX}${label}-${Date.now()}`;

  const [project] = await db.insert('projects', {
    id: ids.project, name, owner_id: session.userId, metadata: {},
  });
  const [branch] = await db.insert('branches', {
    id: ids.branch, project_id: ids.project, name: 'main', is_primary: true, created_by: session.userId,
  });

  const graph = {
    id: ids.project,
    schemaVersion: 8,
    version: 0,
    hash: 'benchfix',
    origin: 'spec_authored',
    nodes: {
      [ids.nodeApi]: {
        id: ids.nodeApi, type: 'backend-service', label: 'API Service',
        ports: [{ id: ids.portOut, name: 'DB queries', direction: 'out', contractId: ids.contract, required: true }],
        artifacts: [], metadata: { position: { x: 120, y: 160 } }, status: 'draft',
      },
      [ids.nodeDb]: {
        id: ids.nodeDb, type: 'database', label: 'Primary Database',
        ports: [{ id: ids.portIn, name: 'SQL interface', direction: 'in', contractId: ids.contract, required: true }],
        artifacts: [], metadata: { position: { x: 480, y: 160 } }, status: 'draft',
      },
    },
    edges: {
      [ids.edge]: {
        id: ids.edge, source: ids.nodeApi, target: ids.nodeDb,
        sourcePortId: ids.portOut, targetPortId: ids.portIn, contractId: ids.contract,
      },
    },
    contracts: {
      [ids.contract]: { id: ids.contract, kind: 'sql', name: 'Task storage queries', status: 'draft' },
    },
    artifacts: {
      [ids.artifact]: {
        id: ids.artifact, nodeId: ids.nodeApi, path: 'src/api/index.ts', kind: 'source',
        content: 'export const handler = () => "bench";\n', status: 'draft',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
      [ids.taskArtifact]: {
        id: ids.taskArtifact, nodeId: ids.nodeApi, path: '.nodespec/tasks/api-service.task.md', kind: 'task',
        content: [
          '# Task: API Service', '',
          '## Requirements — Your Scope', '',
          '### REQ-001: Store tasks', 'Category: functional | Status: pending', '',
          '**Acceptance criteria — your task boxes:**',
          '- [ ] tasks persist across restarts',
          '- [ ] queries return within 200ms', '',
        ].join('\n'),
        status: 'draft',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    },
    metadata: {},
  };
  await db.insert('graph_snapshots', {
    id: ids.snapshot, project_id: ids.project, branch_id: ids.branch,
    version: 0, hash: 'benchfix', patch_sequence: 0, graph_data: graph,
  });

  // No `features` (dropped by 20260625154151) and no requirement `priority`
  // (dropped by 20260126015837) — the harness's first live runs caught BOTH
  // phantom-column inserts as PGRST204. Fixtures mirror migrations, not code.
  await db.insert('project_specifications', {
    id: ids.spec, project_id: ids.project, vision: 'Bench: a tiny task API',
    constraints: [], preferences: {}, created_by: session.userId, metadata: {},
  });
  const reqs = await db.insert('specification_requirements', [
    {
      id: ids.req1, specification_id: ids.spec, requirement_id: 'REQ-001',
      name: 'Store tasks', description: 'Tasks persist', category: 'functional',
      acceptance_criteria: [
        { text: 'tasks persist across restarts', met: false },
        { text: 'queries return within 200ms', met: false },
      ],
    },
    {
      id: ids.req2, specification_id: ids.spec, requirement_id: 'REQ-002',
      name: 'Query tasks', description: 'Tasks are queryable', category: 'functional',
      acceptance_criteria: [{ text: 'filter by status works', met: false }],
    },
  ]);
  await db.insert('specification_mappings', [
    { specification_id: ids.spec, requirement_id: ids.req1, node_id: ids.nodeApi, mapping_type: 'implements', created_by: session.userId },
    { specification_id: ids.spec, requirement_id: ids.req2, node_id: ids.nodeApi, mapping_type: 'implements', created_by: session.userId },
  ]);

  return { ids, name, project, branch, graph, reqRows: reqs };
}

/**
 * C3: an EMPTY project (project + main branch + zero-node snapshot, no spec).
 * The import trigger fires only on no-anchor + empty graph — createProject's
 * two seeded nodes would suppress it.
 */
export async function createEmptyProject(env, session, label) {
  const db = rest(env);
  const ids = { project: uid(), branch: uid(), snapshot: uid() };
  const name = `${RUN_PREFIX}${label}-${Date.now()}`;
  const [project] = await db.insert('projects', {
    id: ids.project, name, owner_id: session.userId, metadata: {},
  });
  const [branch] = await db.insert('branches', {
    id: ids.branch, project_id: ids.project, name: 'main', is_primary: true, created_by: session.userId,
  });
  await db.insert('graph_snapshots', {
    id: ids.snapshot, project_id: ids.project, branch_id: ids.branch,
    version: 0, hash: 'benchfix-empty', patch_sequence: 0,
    graph_data: {
      id: ids.project, schemaVersion: 8, version: 0, hash: 'benchfix-empty',
      origin: 'spec_authored', nodes: {}, edges: {}, contracts: {}, artifacts: {}, metadata: {},
    },
  });
  return { ids, name, project, branch };
}

/**
 * C3: seed the sandbox repo with an N-file fixture in ONE commit via the Git
 * Data API (tree → commit → ref patch; the shape resetSandbox already proves
 * with a single entry). Runs INSIDE a scenario (reset precedes every one).
 * Returns the commit sha; callers should poll until the tree serves all
 * files before connecting (read-after-push staleness).
 */
export async function seedRepoFixture(gh, files, message = 'bench: seed import fixture') {
  // resetSandbox force-reset main moments before this runs, and GitHub's read
  // APIs serve the PRE-reset state for a few seconds after a force-push (the
  // same staleness class getFileEventually documents for contents). A stale
  // headSha here parents the fixture commit on dead history, so the
  // fast-forward ref PATCH 422s — live-run proven. Re-read and rebuild from
  // the fresh head; force stays FALSE so a real divergence still surfaces.
  for (let attempt = 0; ; attempt++) {
    const parentSha = await gh.headSha('main');
    // Layer the fixture ONTO the parent commit's tree (base_tree). Without it
    // the API builds a root tree of ONLY these entries, silently dropping the
    // reset README — which made seedAndSettle's blob-count condition
    // unsatisfiable and burned its full timeout on every scenario.
    let baseTreeSha = null;
    if (parentSha) {
      const parent = await gh.call('GET', `${gh.repo}/git/commits/${parentSha}`);
      baseTreeSha = parent.data?.tree?.sha ?? null;
    }
    const tree = Object.entries(files).map(([path, content]) => ({
      path, mode: '100644', type: 'blob', content,
    }));
    const treeResp = await gh.call('POST', `${gh.repo}/git/trees`, {
      tree, ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
    });
    if (!treeResp.data?.sha) throw new Error(`fixture tree failed: ${JSON.stringify(treeResp.data).slice(0, 300)}`);
    const commitResp = await gh.call('POST', `${gh.repo}/git/commits`, {
      message, tree: treeResp.data.sha, parents: parentSha ? [parentSha] : [],
    });
    if (!commitResp.data?.sha) throw new Error(`fixture commit failed: ${JSON.stringify(commitResp.data).slice(0, 300)}`);
    const refResp = await gh.call('PATCH', `${gh.repo}/git/refs/heads/main`, {
      sha: commitResp.data.sha, force: false,
    });
    if (refResp.status < 300) return commitResp.data.sha;
    const nonFastForward = refResp.status === 422 && /fast forward/i.test(refResp.data?.message ?? '');
    if (!nonFastForward || attempt >= 3) {
      throw new Error(`fixture ref update failed: ${JSON.stringify(refResp.data).slice(0, 300)}`);
    }
    await sleep(2000 * (attempt + 1));
  }
}

/**
 * Mutate the seeded source artifact's content in the persisted snapshot (the
 * client-apply emulation direct-commit-sync established). Needed since the
 * unchanged-tree guard (dogfood #4): a re-push of an identical graph mints NO
 * commit, so any scenario that wants a SECOND real commit must move the tree
 * first.
 */
export async function bumpArtifactContent(env, fx, marker) {
  const db = rest(env);
  const [snapshot] = await db.select('graph_snapshots',
    `id=eq.${fx.ids.snapshot}&select=id,graph_data`);
  snapshot.graph_data.artifacts[fx.ids.artifact].content =
    `export const handler = () => "${marker}";\n`;
  await db.update('graph_snapshots', `id=eq.${fx.ids.snapshot}`, { graph_data: snapshot.graph_data });
}

/** Connect a project to the sandbox repo through the REAL edge function. */
export async function connectRepo(env, session, callFn, projectId) {
  const { status, data } = await callFn(env, session, 'save-git-integration', {
    projectId,
    provider: 'github',
    repoOwner: env.repoOwner,
    repoName: env.repoName,
    defaultBranch: 'main',
    accessToken: env.GITHUB_TOKEN,
  });
  if (status !== 200 || !data.success) {
    throw new Error(`connect failed (${status}): ${JSON.stringify(data).slice(0, 400)}`);
  }
  const db = rest(env);
  const [integration] = await db.select('git_integrations', `project_id=eq.${projectId}&select=id,webhook_secret,default_branch`);
  return { integrationId: integration.id, connect: data };
}

// S1-3 chunk 5: regression tests for the `projects` tool bucket (non-heavy), extracted
// verbatim from mcp-server/index.ts into mcp-server/tools/projects.ts (+ its internal
// computeNextAction / computeGraphHash / createEmptyGraphForProject helpers). Exercises
// the real handlers against a FakeSupabase. (Logic preservation only; module-graph boot
// is the live edge runtime, per the S1-2 lesson.)
import {
  handleListProjects,
  handleGetProjectStatus,
  handleCreateProject, readStagedSpecification } from '../mcp-server/tools/projects.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

const WRITE: AuthResult = { userId: 'user-1', scopes: ['read', 'write'], authMethod: 'api_key' };
const READ: AuthResult = { userId: 'user-1', scopes: ['read'], authMethod: 'api_key' };
const PROJECT = { id: '11111111-1111-1111-1111-111111111111', name: 'Demo' };

function projectRow() {
  return { data: { id: PROJECT.id, name: PROJECT.name }, error: null };
}

// ── list_projects ────────────────────────────────────────────────────────────────────

Deno.test('list_projects: read scope required', async () => {
  const sb = new FakeSupabase();
  const r = await handleListProjects(sb as never, { userId: 'u', scopes: [], authMethod: 'api_key' });
  assertEquals(r.success, false);
  assertEquals(sb.calls.length, 0);
});

Deno.test('list_projects: maps rows, pulling description out of metadata', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', {
    data: [
      { id: 'p1', name: 'Alpha', metadata: { description: 'first' }, created_at: 't', updated_at: 't' },
      { id: 'p2', name: 'Beta', metadata: null, created_at: 't', updated_at: 't' },
    ],
    error: null,
  });
  const r = await handleListProjects(sb as never, READ);
  assertEquals(r.success, true);
  const projects = (r.data as { projects: Array<{ projectId: string; description: string | null }> }).projects;
  assertEquals(projects[0].description, 'first');
  assertEquals(projects[1].description, null);
});

Deno.test('get_project_status: aggregates counts and derives nextAction', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', { count: 3, data: null, error: null }); // reqCount
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });                 // main branch
  sb.script('graph_snapshots', 'select', { data: { graph_data: { nodes: { n1: {}, n2: {} }, artifacts: {} } }, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });                  // testCount
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });                  // staleTestCaseCount

  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const data = r.data as { counts: { requirements: number; architectureNodes: number }; nextAction: string; hasSpecification: boolean; phaseStatus: string; storedPhaseStatus?: string };
  assertEquals(data.counts.requirements, 3);
  assertEquals(data.counts.architectureNodes, 2);
  assertEquals(data.hasSpecification, true);
  // Owner bug 2026-08-23: nodes on the canvas mean the project is past
  // drafting whatever the stale wizard column says — the phase is DERIVED,
  // the lagging stored value reported alongside, and the advice follows
  // the derived phase.
  assertEquals(data.phaseStatus, 'architecture_confirmed');
  assertEquals(data.storedPhaseStatus, 'drafting_requirements');
  assert(data.nextAction.includes('Architecture is ready'), data.nextAction.slice(0, 160));
  assert(data.nextAction.includes('get_test_plan'), 'directs into the verification lane');
});

// ── R6: vision-first instruction stitching ───────────────────────────────────────────

function scriptStatusWith(sb: FakeSupabase, vision: string, reqCount: number) {
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision }, error: null });
  sb.script('specification_requirements', 'select', { count: reqCount, data: null, error: null });
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { nodes: {}, artifacts: {} } }, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });
}

Deno.test('R6 get_project_status: no vision + no requirements → ASK THE USER FIRST, update_vision before drafting', async () => {
  const sb = new FakeSupabase();
  scriptStatusWith(sb, '', 0);
  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const data = r.data as { hasVision: boolean; nextAction: string };
  assertEquals(data.hasVision, false);
  assert(data.nextAction.includes('FIRST ask the USER for their vision'), data.nextAction);
  assert(data.nextAction.includes('update_vision'), 'names the tool');
  assert(data.nextAction.indexOf('update_vision') < data.nextAction.indexOf('create_requirement'),
    'vision comes BEFORE requirements in the directive');
});

Deno.test('R6 get_project_status: vision present + no requirements → the plain draft-requirements directive', async () => {
  const sb = new FakeSupabase();
  scriptStatusWith(sb, 'A task API for small teams', 0);
  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  const data = r.data as { hasVision: boolean; nextAction: string };
  assertEquals(data.hasVision, true);
  assert(data.nextAction.startsWith('No requirements yet.'), data.nextAction);
  assert(!data.nextAction.includes('update_vision'), 'no vision nag once it exists');
});

Deno.test('R6 get_project_status: whitespace-only vision counts as ABSENT', async () => {
  const sb = new FakeSupabase();
  scriptStatusWith(sb, '   ', 0);
  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assertEquals((r.data as { hasVision: boolean }).hasVision, false);
});

Deno.test('get_project_status: read scope required', async () => {
  const sb = new FakeSupabase();
  const r = await handleGetProjectStatus(sb as never, { userId: 'u', scopes: [], authMethod: 'api_key' }, { project_id: PROJECT.id });
  assertEquals(r.success, false);
});

// ── create_project ───────────────────────────────────────────────────────────────────

Deno.test('create_project: write scope + non-empty name required', async () => {
  const sb = new FakeSupabase();
  assertEquals((await handleCreateProject(sb as never, READ, { name: 'x' })).success, false);
  const r = await handleCreateProject(sb as never, WRITE, { name: '   ' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('name is required'));
});

Deno.test('create_project: hosted Free tier is capped at TWO projects (owner 2026-08-31 Stripe round)', async () => {
  const sb = new FakeSupabase();
  // getUserTier → community (no subscription), not admin, project count already at the cap.
  sb.script('stripe_subscriptions', 'select', { data: null, error: null });
  sb.script('auth', 'getUserById', { data: { user: { id: 'u1', app_metadata: {} } }, error: null });
  sb.script('projects', 'select', { data: [{ id: 'p1', metadata: {} }, { id: 'p2', metadata: null }], error: null });
  const r = await handleCreateProject(sb as never, WRITE, { name: 'Third' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Free accounts include 2 projects'));
  assert((r.error ?? '').includes('Indie'), 'the refusal steers to the upgrade path');
  assertEquals(sb.callsTo('projects', 'insert').length, 0, 'no project created when capped');
});

Deno.test('create_project: community tier below the cap proceeds past the limit check', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: null, error: null });
  sb.script('auth', 'getUserById', { data: { user: { id: 'u1', app_metadata: {} } }, error: null });
  sb.script('projects', 'select', { data: [], error: null }); // 0 of 2 used
  sb.script('projects', 'select', { data: { id: 'existing' }, error: null }); // duplicate-name check hits
  const r = await handleCreateProject(sb as never, WRITE, { name: 'First' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('already exists'), 'reached the duplicate-name check, not the cap');
});

// AJ.6 (owner 2026-09-30): the example project every account gets does not
// count against the two projects Free includes.
Deno.test('create_project: the account\'s example project is not counted against the Free cap', async () => {
  const example = { id: 'ex', metadata: { example: 'harbor-lane-bakery', exampleTeam: [] } };
  const below = new FakeSupabase();
  below.script('stripe_subscriptions', 'select', { data: null, error: null });
  below.script('auth', 'getUserById', { data: { user: { id: 'u1', app_metadata: {} } }, error: null });
  below.script('projects', 'select', { data: [example, { id: 'p1', metadata: {} }], error: null }); // the example and one of their own
  below.script('projects', 'select', { data: { id: 'existing' }, error: null }); // duplicate-name check hits
  const r1 = await handleCreateProject(below as never, WRITE, { name: 'Second' });
  assertEquals(r1.success, false);
  assert((r1.error ?? '').includes('already exists'), `one of their own and the example leave room for a second: ${r1.error}`);

  const at = new FakeSupabase();
  at.script('stripe_subscriptions', 'select', { data: null, error: null });
  at.script('auth', 'getUserById', { data: { user: { id: 'u1', app_metadata: {} } }, error: null });
  at.script('projects', 'select', { data: [example, { id: 'p1', metadata: {} }, { id: 'p2', metadata: { kept: 1 } }], error: null });
  const r2 = await handleCreateProject(at as never, WRITE, { name: 'Third' });
  assertEquals(r2.success, false);
  assert((r2.error ?? '').includes('already has 2.'), `two of their own are the cap, the example aside: ${r2.error}`);
  assertEquals(at.callsTo('projects', 'insert').length, 0);
});

Deno.test('create_project: admins are exempt from the community cap', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: null, error: null });
  sb.script('auth', 'getUserById', { data: { user: { id: 'u1', app_metadata: { is_admin: true } } }, error: null });
  sb.script('projects', 'select', { data: { id: 'existing' }, error: null }); // duplicate-name check hits
  const r = await handleCreateProject(sb as never, WRITE, { name: 'Demo' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('already exists'), 'no cap query for admins, straight to duplicate-name');
  assertEquals(sb.callsTo('auth', 'getUserById')[0].payload, WRITE.userId, 'admin is read from the caller\'s own account');
});

Deno.test('RLS audit: a settings row saying is_admin does not lift the Free cap; only the account\'s app_metadata does', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: null, error: null });
  sb.script('user_settings', 'select', { data: { is_admin: true }, error: null }); // a person writes their own row
  sb.script('auth', 'getUserById', { data: { user: { id: 'u1', app_metadata: {} } }, error: null });
  sb.script('projects', 'select', { data: [{ id: 'p1', metadata: {} }, { id: 'p2', metadata: null }], error: null });
  const r = await handleCreateProject(sb as never, WRITE, { name: 'Third' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Free accounts include 2 projects'), r.error);
  assertEquals(sb.callsTo('projects', 'insert').length, 0);
  assertEquals(sb.callsTo('user_settings').length, 0, 'the settings row is not consulted');
});

Deno.test('create_project: duplicate name rejected', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: { plan_name: 'Pro', status: 'active' }, error: null }); // pro → no cap
  sb.script('projects', 'select', { data: { id: 'existing' }, error: null }); // existing-name check hits
  const r = await handleCreateProject(sb as never, WRITE, { name: 'Demo' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('already exists'));
});

Deno.test('create_project: happy path creates project, main branch, snapshot, and links base', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: { plan_name: 'Pro', status: 'active' }, error: null }); // pro tier
  sb.script('projects', 'select', { data: null, error: null });           // no existing-name clash
  sb.script('projects', 'insert', { data: { id: 'proj-1', name: 'New' }, error: null });
  sb.script('branches', 'insert', { data: { id: 'branch-1' }, error: null });
  sb.script('graph_snapshots', 'insert', { data: { id: 'snap-1' }, error: null });
  sb.script('branches', 'update', { data: null, error: null });

  const r = await handleCreateProject(sb as never, WRITE, { name: 'New', description: 'desc' });
  assertEquals(r.success, true);
  const data = r.data as { projectId: string; branchId: string };
  assertEquals(data.projectId, 'proj-1');
  assertEquals(data.branchId, 'branch-1');
  // main branch created; base_snapshot_id linked via update.
  const branchInsert = sb.callsTo('branches', 'insert')[0].payload as { name: string };
  assertEquals(branchInsert.name, 'main');
  const branchUpdate = sb.callsTo('branches', 'update')[0].payload as { base_snapshot_id: string };
  assertEquals(branchUpdate.base_snapshot_id, 'snap-1');
});

Deno.test('create_project: snapshot failure rolls back branch and project', async () => {
  const sb = new FakeSupabase();
  sb.script('stripe_subscriptions', 'select', { data: { plan_name: 'Pro', status: 'active' }, error: null });
  sb.script('projects', 'select', { data: null, error: null });
  sb.script('projects', 'insert', { data: { id: 'proj-1', name: 'New' }, error: null });
  sb.script('branches', 'insert', { data: { id: 'branch-1' }, error: null });
  sb.script('graph_snapshots', 'insert', { data: null, error: { message: 'boom' } }); // snapshot fails
  const r = await handleCreateProject(sb as never, WRITE, { name: 'New' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('initial snapshot'));
  // Rollback: both branch and project deleted.
  assertEquals(sb.callsTo('branches', 'delete').length, 1);
  assertEquals(sb.callsTo('projects', 'delete').length, 1);
});

// ── Spec-import lane (owner audit 2026-08-13) ────────────────────────────────
// The 'Import a specification' wizard lane fed the retired internal agent;
// nothing re-routed it after inversion — a fresh import-spec project opened on
// an empty panel with no trigger. The status lead IS the trigger now.

Deno.test('spec-import origin + empty spec → nextAction leads with the document conversion workflow', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: null }, error: null });
  sb.script('specification_requirements', 'select', { count: 0, data: null, error: null });
  // reqCount===0 → the handler reads projects.metadata for the origin
  sb.script('projects', 'select', { data: { metadata: { workflowOrigin: 'import-spec' } }, error: null });
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { nodes: {}, artifacts: {} } }, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });

  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const next = (r.data as { nextAction: string }).nextAction;
  assert(next.includes('IMPORT AN EXISTING SPECIFICATION'), next.slice(0, 160));
  assert(next.includes('paste'), 'asks the user for the document');
  assert(next.includes('update_vision') && next.includes('create_requirement'), 'names the conversion tools');
  assert(next.includes('Do not invent content'), 'faithfulness rule rides the lead');
});

Deno.test('staged specification (owner spike 2026-09-04) → the document rides the response and the lead says convert it now', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: null }, error: null });
  sb.script('specification_requirements', 'select', { count: 0, data: null, error: null });
  // The app's import window staged the document; origin rides alongside.
  const text = '# Product\n\n## Requirements\n- Users can register\n- Users can log in';
  sb.script('projects', 'select', {
    data: { metadata: { workflowOrigin: 'import-spec', stagedSpecImport: { text, chars: text.length, stagedAt: '2026-09-04T10:00:00.000Z' } } },
    error: null,
  });
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { nodes: {}, artifacts: {} } }, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });

  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const data = r.data as { nextAction: string; stagedSpecification?: { text: string; chars: number; stagedAt: string | null } };
  assert(data.nextAction.includes('SPECIFICATION DOCUMENT IS STAGED'), data.nextAction.slice(0, 160));
  assert(data.nextAction.includes('do not ask the user to paste it again'), 'the staged lead never re-asks for the document');
  assert(data.nextAction.includes('update_vision') && data.nextAction.includes('create_requirement'), 'names the conversion tools');
  assert(data.nextAction.includes('Do not invent content'), 'faithfulness rule rides the staged lead too');
  assert(!data.nextAction.includes('IMPORT AN EXISTING SPECIFICATION'), 'the bare-origin lead yields to the staged one');
  assertEquals(data.stagedSpecification?.text, text);
  assertEquals(data.stagedSpecification?.chars, text.length);
  assertEquals(data.stagedSpecification?.stagedAt, '2026-09-04T10:00:00.000Z');
});

Deno.test('readStagedSpecification tolerates junk and fills chars from the text', () => {
  assertEquals(readStagedSpecification(null), null);
  assertEquals(readStagedSpecification({}), null);
  assertEquals(readStagedSpecification({ stagedSpecImport: 'nope' }), null);
  assertEquals(readStagedSpecification({ stagedSpecImport: { text: '   ' } }), null);
  assertEquals(readStagedSpecification({ stagedSpecImport: { text: 'abc' } }), { text: 'abc', chars: 3, stagedAt: null });
});

Deno.test('spec-import origin with requirements already present → no import lead (work done)', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', { count: 4, data: null, error: null });
  // reqCount>0 → the metadata is read once, for the staged explode requests
  // (AE.6), and the spec-import lanes never look at it
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { nodes: {}, artifacts: {} } }, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });

  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const next = (r.data as { nextAction: string }).nextAction;
  assert(!next.includes('IMPORT AN EXISTING SPECIFICATION'), next.slice(0, 160));
  assertEquals(sb.callsTo('projects', 'select').length, 2, 'the project row, then one metadata read (AE.6); nothing more once requirements exist');
});

// ── D4: the test-budget gauge ────────────────────────────────────────────────────────

Deno.test('D4 get_project_status: sprawl gauge flags over-tested requirements with the consolidation nudge', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'generating_code', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', { count: 2, data: null, error: null }); // head count
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { nodes: { n1: {} }, artifacts: {} } }, error: null });
  // Requirement rows now carry criteria: REQ-001 has 2, REQ-002 has 1.
  sb.script('specification_requirements', 'select', {
    data: [
      { id: 'r1', requirement_id: 'REQ-001', acceptance_criteria: [{ text: 'a' }, { text: 'b' }] },
      { id: 'r2', requirement_id: 'REQ-002', acceptance_criteria: [{ text: 'c' }] },
    ],
    error: null,
  });
  // 5 cases on REQ-001 (> 2 x 2 criteria = sprawl), 1 on REQ-002 (within budget).
  sb.script('test_cases', 'select', {
    data: [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, status: 'passed', stale: false, requirement_id: 'r1' })),
      { id: 'c9', status: 'passed', stale: false, requirement_id: 'r2' },
    ],
    error: null,
  });

  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const budget = (r.data as { testBudget: {
    policy: string; criteriaTotal: number; testCases: number; testsPerCriterion: number | null;
    overTested: Array<{ requirementId: string; criteria: number; tests: number; testsPerCriterion: number | null }>;
    nudge?: string;
  } }).testBudget;
  assertEquals(budget.criteriaTotal, 3);
  assertEquals(budget.testCases, 6);
  assertEquals(budget.testsPerCriterion, 2);
  assertEquals(budget.overTested, [{ requirementId: 'REQ-001', criteria: 2, tests: 5, testsPerCriterion: 2.5 }]);
  assert(!!budget.nudge, 'over-tested requirement produces the nudge');
  assert(budget.nudge!.includes('REQ-001 (5 tests / 2 criteria)'), budget.nudge);
  assert(budget.nudge!.includes('ONE binding test per criterion'), 'the doctrine rides the nudge');
  assert(budget.policy.includes('verified (smoke)'), 'smoke tier named as legitimate');
});

Deno.test('D4 get_project_status: within budget -> empty overTested, NO nudge (the gauge never nags a clean project)', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'generating_code', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', { count: 1, data: null, error: null });
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { nodes: {}, artifacts: {} } }, error: null });
  sb.script('specification_requirements', 'select', {
    data: [{ id: 'r1', requirement_id: 'REQ-001', acceptance_criteria: [{ text: 'a' }, { text: 'b' }] }],
    error: null,
  });
  sb.script('test_cases', 'select', {
    data: [
      { id: 'c1', status: 'passed', stale: false, requirement_id: 'r1' },
      { id: 'c2', status: 'failed', stale: false, requirement_id: 'r1' },
    ],
    error: null,
  });

  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  const budget = (r.data as { testBudget: { overTested: unknown[]; nudge?: string; testsPerCriterion: number | null } }).testBudget;
  assertEquals(budget.overTested, []);
  assertEquals(budget.nudge, undefined);
  assertEquals(budget.testsPerCriterion, 1);
});

// ── Owner bug 2026-08-23: derived phase over the stale wizard column ─────────────────

Deno.test('stale-phase fix: drafting_requirements column + architecture + tests derives generating_code', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', { count: 4, data: null, error: null });
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { nodes: { n1: {}, n2: {}, n3: {} }, artifacts: {} } }, error: null });
  sb.script('specification_requirements', 'select', {
    data: [{ id: 'r1', requirement_id: 'REQ-001', acceptance_criteria: [{ text: 'a' }] }], error: null,
  });
  sb.script('test_cases', 'select', {
    data: [{ id: 'c1', status: 'passed', stale: false, requirement_id: 'r1' }], error: null,
  });

  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const data = r.data as { phaseStatus: string; storedPhaseStatus?: string; nextAction: string };
  assertEquals(data.phaseStatus, 'generating_code');
  assertEquals(data.storedPhaseStatus, 'drafting_requirements');
  assert(data.nextAction.includes('Build/verify loop underway'), data.nextAction.slice(0, 160));
});

Deno.test('stale-phase fix: storedPhaseStatus is OMITTED when the column already agrees', async () => {
  const sb = new FakeSupabase();
  scriptStatusWith(sb, 'A vision', 0);
  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  const data = r.data as { phaseStatus: string; storedPhaseStatus?: string };
  assertEquals(data.phaseStatus, 'drafting_requirements');
  assertEquals(data.storedPhaseStatus, undefined);
});

// ── 7.0: seats ride along ──────────────────────────────────────────────────
Deno.test('list_projects (7.0): owned ∪ seats, role per row, newest first, no duplicate for a project owned and seated; a seat below Team is not listed', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: [{ id: 'p1', name: 'Mine', metadata: null, created_at: 't', updated_at: '2026-09-10' }], error: null });
  sb.script('project_members', 'select', { data: [
    { role: 'contributor', projects: { id: 'p2', name: 'Theirs', owner_id: 'team-owner', metadata: { description: 'shared' }, created_at: 't', updated_at: '2026-09-14' } },
    { role: 'viewer', projects: { id: 'p1', name: 'Mine', owner_id: 'user-1', metadata: null, created_at: 't', updated_at: '2026-09-10' } },
    // decision 1: held on an Indie owner's project, which is its owner's alone
    { role: 'contributor', projects: { id: 'p3', name: 'Held', owner_id: 'indie-owner', metadata: null, created_at: 't', updated_at: '2026-09-20' } },
  ], error: null });
  sb.script('stripe_subscriptions', 'select', { data: [
    { user_id: 'team-owner', plan_name: 'team', status: 'active', current_period_end: '2099-01-01' },
    { user_id: 'indie-owner', plan_name: 'indie', status: 'active', current_period_end: '2099-01-01' },
  ], error: null });
  const r = await handleListProjects(sb as never, READ);
  assertEquals(r.success, true);
  const projects = (r.data as { projects: Array<{ projectId: string; role: string; description: string | null }> }).projects;
  assertEquals(projects.map((p) => [p.projectId, p.role]), [['p2', 'contributor'], ['p1', 'owner']]);
  assertEquals(projects[0].description, 'shared');
  const seats = sb.callsTo('project_members', 'select')[0];
  assert(seats.filters.some((f) => f.method === 'eq' && f.args[0] === 'user_id' && f.args[1] === 'user-1'), JSON.stringify(seats.filters));
});

// Q (owner 2026-09-22): repo import is Indie and above. A job left from a
// paid period (or created before the gate) never points a Free agent at
// run_repo_import; on Indie the lead is unchanged.
function emptyProjectWithImportJob(sb: FakeSupabase, plan: string | null) {
  sb.script('stripe_subscriptions', 'select', { data: plan ? { plan_name: plan, status: 'active' } : null, error: null });
  sb.script('projects', 'select', projectRow());
  sb.script('project_specifications', 'select', { data: { id: 'spec-1', phase_status: 'drafting_requirements', vision: 'V' }, error: null });
  sb.script('specification_requirements', 'select', { count: 0, data: null, error: null });
  sb.script('projects', 'select', { data: { metadata: {} }, error: null });
  sb.script('branches', 'select', { data: { id: 'main-b' }, error: null });
  sb.script('graph_snapshots', 'select', { data: { graph_data: { nodes: {}, artifacts: {} } }, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });
  sb.script('test_cases', 'select', { count: 0, data: null, error: null });
  sb.script('import_jobs', 'select', { data: { id: 'job-1', status: 'pending', stage: 'skeleton', proposal_id: null }, error: null });
}

Deno.test('Q get_project_status: below Indie a pending import job is never read and the lead never names run_repo_import', async () => {
  const sb = new FakeSupabase();
  emptyProjectWithImportJob(sb, null);
  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const next = (r.data as { nextAction: string }).nextAction;
  assert(!next.includes('run_repo_import') && !next.includes('repository import'), next.slice(0, 200));
  assertEquals(sb.callsTo('import_jobs').length, 0, 'the job table is not read below Indie');
});

Deno.test('Q get_project_status: on Indie the pending import still leads', async () => {
  const sb = new FakeSupabase();
  emptyProjectWithImportJob(sb, 'indie');
  const r = await handleGetProjectStatus(sb as never, READ, { project_id: PROJECT.id });
  assertEquals(r.success, true);
  const next = (r.data as { nextAction: string }).nextAction;
  assert(next.startsWith('A repository import is waiting to be driven (stage: skeleton)'), next.slice(0, 200));
});

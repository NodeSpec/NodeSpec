// S1-3 chunk 2: regression tests for the `proposals` tool bucket, extracted verbatim from
// mcp-server/index.ts into mcp-server/tools/proposals.ts. Exercises the real handlers +
// the P0-10 patch validator against a FakeSupabase. (Logic preservation only; the
// module-graph-boots check is the live edge runtime, per the S1-2 lesson.)
import {
  validateAndNormalizeProposalPatch,
  handleProposePatches,
  handleGetProposalStatus,
} from '../mcp-server/tools/proposals.ts';
import type { AuthResult } from '../mcp-server/shared.ts';
import { OUTCOME_ON_PROJECT_NOTE, WORKFLOWS_STAY } from '../_shared/workflow-gate.ts';
import { FakeSupabase, assert, assertEquals, completeRole } from './helpers.ts';

const PROPOSE_AUTH: AuthResult = { userId: 'user-1', scopes: ['read', 'propose'], authMethod: 'api_key' };
const READ_ONLY: AuthResult = { userId: 'user-1', scopes: ['read'], authMethod: 'api_key' };
const NAMED_PROJECT = { id: '11111111-1111-1111-1111-111111111111', name: 'Demo' };

// A minimal valid add_node patch (satisfies PatchOperationSchema after metadata enrichment).
function addNodePatch() {
  return {
    type: 'add_node',
    payload: {
      id: '22222222-2222-2222-2222-222222222222',
      type: 'backend-service',
      label: 'API',
    },
  };
}

// P1-7/bench 2026-07-19: artifact CONTENT submitted over MCP must survive into the stored
// proposal verbatim — the client-side externalization ('__stored_externally__' +
// ai_proposal_artifacts) is NOT part of this path, and an external AI concluded (wrongly,
// doc-induced) that file bodies can't travel through propose_patches. This pins that they can.
Deno.test('propose_patches: add_artifact content survives into the stored proposal verbatim', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const BODY = '# API Service Tasks\n\n- [ ] implement /health endpoint\n';
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [{
      type: 'add_artifact',
      payload: {
        id: '33333333-3333-4333-8333-333333333333',
        nodeId: '22222222-2222-4222-8222-222222222222',
        kind: 'task', path: '.nodespec/tasks/api-service.task.md',
        content: BODY,
        createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z',
      },
    }],
    external_agent: 'claude',
  });
  assertEquals(r.success, true);
  const proposalInsert = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { payload: { content?: string } } }>;
  };
  assertEquals(proposalInsert.patches[0].patch.payload.content, BODY, 'content stored inline, byte-identical');
});

// ── validateAndNormalizeProposalPatch (P0-10) ────────────────────────────────────────

Deno.test('validate: rejects non-object / missing type / bad type', () => {
  assert('error' in validateAndNormalizeProposalPatch(null, 0, 'e', 'agent'), 'null rejected');
  assert('error' in validateAndNormalizeProposalPatch({ payload: {} }, 0, 'e', 'agent'), 'missing type rejected');
  assert('error' in validateAndNormalizeProposalPatch({ type: 'frobnicate', payload: {} }, 0, 'e', 'agent'), 'unknown type rejected');
});

Deno.test('validate: enriches metadata (id/actorType/actorId/summary/timestamp) on a valid patch', () => {
  const r = validateAndNormalizeProposalPatch(addNodePatch(), 3, 'adds the API node', 'my-agent');
  assert(!('error' in r), 'valid patch accepted');
  const meta = (r as { patch: Record<string, unknown> }).patch.metadata as Record<string, unknown>;
  assertEquals(meta.actorType, 'ai');
  assertEquals(meta.actorId, 'my-agent');
  assertEquals(meta.summary, 'adds the API node');
  assert(typeof meta.id === 'string' && (meta.id as string).length > 0, 'id minted');
  assert(typeof meta.timestamp === 'string', 'timestamp minted');
});

Deno.test('validate: schema-invalid payload returns field-level errors (the P0-10 fix)', () => {
  const r = validateAndNormalizeProposalPatch(
    { type: 'add_node', payload: { id: 'not-a-uuid' } }, 0, 'e', 'agent',
  );
  assert('error' in r, 'invalid payload rejected');
  assert((r as { error: string }).error.includes('does not match the NodeSpec patch schema'), 'names the schema mismatch');
});

// ── propose_patches ──────────────────────────────────────────────────────────────────

Deno.test('propose_patches: requires propose scope', async () => {
  const sb = new FakeSupabase();
  const r = await handleProposePatches(sb as never, READ_ONLY, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1', patches: [addNodePatch()],
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('propose scope'), 'names the scope');
  assertEquals(sb.calls.length, 0, 'no DB call on scope failure');
});

Deno.test('propose_patches: an invalid patch blocks the whole batch with named errors, no rows written', async () => {
  const sb = new FakeSupabase();
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [{ type: 'add_node', payload: { id: 'nope' } }],
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Invalid patches'), 'batch rejected');
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0, 'no proposal written');
});

Deno.test('propose_patches: valid batch creates ai_run and proposal, and does NOT mint a branch', async () => {
  const sb = new FakeSupabase();
  // resolveProjectByName by UUID → project row.
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  // branch existence check.
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  // ai_runs insert, ai_proposals insert. (No branches insert — the bugfix stopped minting
  // dangling mcp-proposal/* branches; proposal_branch_id points at the source branch.)
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1', patches: [addNodePatch()],
    explanations: ['adds API'], external_agent: 'claude',
  });
  assertEquals(r.success, true);
  const data = r.data as Record<string, unknown>;
  assert(typeof data.proposalId === 'string', 'proposalId returned');
  assertEquals(data.patchCount, 1);
  assertEquals(data.status, 'pending');

  // No dangling branch is created — the regression this bugfix fixes.
  assertEquals(sb.callsTo('branches', 'insert').length, 0, 'no proposal branch minted');

  // The proposal row carries the normalized patch with enriched metadata, and points
  // proposal_branch_id at the source branch (matching the in-app path).
  const proposalInsert = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { metadata: { actorId: string } }; status: string }>;
    source_branch_id: string; proposal_branch_id: string;
  };
  assertEquals(proposalInsert.patches[0].status, 'pending');
  assertEquals(proposalInsert.patches[0].patch.metadata.actorId, 'claude');
  assertEquals(proposalInsert.proposal_branch_id, proposalInsert.source_branch_id, 'proposal_branch_id = source branch');
});

Deno.test('propose_patches: unknown branch is rejected before writing a proposal', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: null, error: null }); // branch not found
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'ghost', patches: [addNodePatch()],
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Branch not found'));
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);
});

// ── catalog normalization (2026-07-15): server-side, IP-safe, end-to-end ──────────────

// Script the 7 catalog tables loadCatalogs reads (arrays so indexById doesn't throw).
function scriptCatalog(sb: FakeSupabase, extraTechs: Array<Record<string, unknown>> = []) {
  const roleRow = (id: string, palette_category: string, extra: Record<string, unknown> = {}) => ({
    id, label: id, description: '', icon_name: '', color: '', rf_visual_type: '', palette_category,
    kind: 'compute', is_container: false, container_layer: null, container_style: null,
    can_contain: [], metadata_schema: {}, suggested_contracts: [],
    sort_order: 1, capability_tags: [], default_technology: null, ...extra,
  });
  sb.script('node_roles', 'select', {
    data: [
      roleRow('backend-service', 'Services', { sort_order: 1 }),
      roleRow('frontend-app', 'Frontend', { sort_order: 1 }),
    ].map(completeRole),
    error: null,
  });
  sb.script('technology_catalog', 'select', {
    data: [{
      id: 'react', name: 'react', icon_url: null, brand_color: '', secondary_color: null,
      display_name: null, node_shape: null, role_affinities: ['frontend-app'], ai_context: {},
      suggested_files: [], default_metadata: {}, metadata_schema: {}, common_connections: [],
      is_user_contributed: false, project_id: null, created_by: null,
    }, ...extraTechs],
    error: null,
  });
  sb.script('deployment_targets', 'select', { data: [], error: null });
  sb.script('legacy_type_mappings', 'select', { data: [], error: null });
  sb.script('cloud_provider_patterns', 'select', { data: [], error: null });
  sb.script('scope_archetypes', 'select', { data: [], error: null });
}

Deno.test('propose_patches: normalizes a catalog-invalid node server-side (the live bug, end-to-end)', async () => {
  const sb = new FakeSupabase();
  scriptCatalog(sb);
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  // The external AI proposes catalog-blind: type "service", technology "React".
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [{ type: 'add_node', payload: { id: '22222222-2222-2222-2222-222222222222', type: 'service', technology: 'React', label: 'React Frontend' } }],
  });
  assertEquals(r.success, true);

  // The STORED patch was conformed to the catalog: service→frontend-app (via react affinity),
  // React→react, status defaulted to draft.
  const stored = (sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { payload: { type: string; technology: string; status: string; ports: Array<{ id: string; direction: string }> } } }>;
  }).patches[0].patch.payload;
  assertEquals(stored.type, 'frontend-app');
  assertEquals(stored.technology, 'react');
  assertEquals(stored.status, 'draft');

  // AG.13 (owner 2026-09-28): ports came out of the model; nothing is provisioned.
  assert(!('ports' in stored), 'no ports provisioned');

  // And the response reports the normalizations transparently.
  const norm = (r.data as { normalizations: Array<{ field: string; to: string }> }).normalizations;
  assert(norm.some((n) => n.field === 'type' && n.to === 'frontend-app'), 'reports the type conform');
  assert(norm.some((n) => n.field === 'technology' && n.to === 'react'), 'reports the tech conform');
  assert(!norm.some((n) => n.field === 'ports'), 'no port provisioning to report');
});

// AG.6c (2026-09-28): the server reads the catalog with the service role, so without a
// scope a proposal could type a node from another project's custom technology.
Deno.test('propose_patches (AG.6c): a custom technology types a node only inside its own project', async () => {
  const sb = new FakeSupabase();
  const custom = (id: string, project_id: string) => ({
    id, name: id, icon_url: null, brand_color: '', secondary_color: null, display_name: null, node_shape: null,
    role_affinities: ['frontend-app'], ai_context: {}, suggested_files: [], default_metadata: {}, metadata_schema: {},
    common_connections: [], is_user_contributed: true, project_id, created_by: null,
  });
  scriptCatalog(sb, [custom('our-widget', NAMED_PROJECT.id), custom('their-widget', '99999999-9999-4999-8999-999999999999')]);
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [
      { type: 'add_node', payload: { id: '33333333-3333-4333-8333-333333333331', type: 'service', technology: 'our-widget', label: 'Ours' } },
      { type: 'add_node', payload: { id: '33333333-3333-4333-8333-333333333332', type: 'service', technology: 'their-widget', label: 'Theirs' } },
    ],
  });
  assertEquals(r.success, true);
  const stored = (sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { payload: { type: string } } }>;
  }).patches.map((p) => p.patch.payload.type);
  assertEquals(stored[0], 'frontend-app', "the project's own custom row types its node");
  assert(stored[1] !== 'frontend-app', `another project's custom row is not read: ${stored[1]}`);
  const norm = (r.data as { normalizations: Array<{ patchIndex: number; field: string; reason: string }> }).normalizations;
  assert(norm.some((n) => n.patchIndex === 1 && n.field === 'technology' && n.reason.includes('not in catalog')), JSON.stringify(norm));
});

// ── get_proposal_status ──────────────────────────────────────────────────────────────

Deno.test('get_proposal_status: requires read scope and a proposal_id', async () => {
  const sb = new FakeSupabase();
  assertEquals((await handleGetProposalStatus(sb as never, { userId: 'u', scopes: [], authMethod: 'api_key' }, { proposal_id: 'x' })).success, false);
  assertEquals((await handleGetProposalStatus(sb as never, READ_ONLY, { proposal_id: '' })).success, false);
});

Deno.test('get_proposal_status: enforces ownership then summarizes patch statuses', async () => {
  const sb = new FakeSupabase();
  // Ownership check row: nested project owner matches auth user.
  sb.script('ai_proposals', 'select', {
    data: { id: 'p1', source_branch_id: 'b1', branches: { projects: { owner_id: 'user-1' } } },
    error: null,
  });
  // The detail fetch.
  sb.script('ai_proposals', 'select', {
    data: {
      id: 'p1', status: 'pending', created_at: 't', reviewed_at: null, merged_at: null,
      patches: [
        { patch: {}, explanation: 'a', status: 'pending' },
        { patch: {}, explanation: 'b', status: 'approved' },
      ],
    },
    error: null,
  });
  const r = await handleGetProposalStatus(sb as never, READ_ONLY, { proposal_id: 'p1' });
  assertEquals(r.success, true);
  const summary = (r.data as { patchSummary: { total: number; pending: number; approved: number } }).patchSummary;
  assertEquals([summary.total, summary.pending, summary.approved], [2, 1, 1]);
});

Deno.test('get_proposal_status (R.2c, AC): the reviewer\'s note comes back; the ask to file it as a constraint only where the owner\'s plan carries constraints', async () => {
  const status = async (plan: string | null) => {
    const sb = new FakeSupabase();
    sb.script('ai_proposals', 'select', {
      data: { id: 'p1', source_branch_id: 'b1', branches: { project_id: 'proj-1', projects: { owner_id: 'user-1' } } },
      error: null,
    });
    sb.script('ai_proposals', 'select', {
      data: { id: 'p1', status: 'rejected', created_at: 't', reviewed_at: 't', merged_at: null, patches: [], metadata: { rejectionReason: 'We never call the database from the web app.' } },
      error: null,
    });
    sb.script('stripe_subscriptions', 'select', { data: plan ? { plan_name: plan, status: 'active' } : null, error: null });
    const r = await handleGetProposalStatus(sb as never, READ_ONLY, { proposal_id: 'p1' });
    assertEquals(sb.callsTo('projects').length, 0, 'the owner is already known');
    return r.data as { reviewNote?: string; reviewNoteAsk?: string };
  };
  const indie = await status('indie');
  assertEquals(indie.reviewNote, 'We never call the database from the web app.');
  assert(typeof indie.reviewNoteAsk === 'string' && indie.reviewNoteAsk.length > 0, 'the ask rides on Indie');
  const community = await status(null);
  assertEquals(community.reviewNote, 'We never call the database from the web app.');
  assert(!('reviewNoteAsk' in community), 'no constraint ask below Indie');
});

// AE.12: the app's canvas rejection writes the reason into the proposal's
// metadata (ProposalService.rejectProposal, pinned to this exact shape in
// src/tests/ae-batch1-rulings.test.tsx); the agent reads it back here.
Deno.test('get_proposal_status (AE.12): a rejection recorded by the app, metadata exactly as the app writes it, comes back as the reviewNote', async () => {
  const sb = new FakeSupabase();
  sb.script('ai_proposals', 'select', {
    data: { id: 'p1', source_branch_id: 'b1', branches: { project_id: 'proj-1', projects: { owner_id: 'user-1' } } },
    error: null,
  });
  sb.script('ai_proposals', 'select', {
    data: { id: 'p1', status: 'rejected', created_at: 't', reviewed_at: 't', merged_at: null, patches: [],
      metadata: { source: 'mcp-server', credential: 'key:k1', resolveNote: 'Not this way: the API keeps its own cache.', resolvedBy: 'app' } },
    error: null,
  });
  sb.script('stripe_subscriptions', 'select', { data: null, error: null });
  const r = await handleGetProposalStatus(sb as never, READ_ONLY, { proposal_id: 'p1' });
  assertEquals((r.data as { reviewNote?: string }).reviewNote, 'Not this way: the API keeps its own cache.');
});

Deno.test('get_proposal_status: other users cannot read a proposal', async () => {
  const sb = new FakeSupabase();
  sb.script('ai_proposals', 'select', {
    data: { id: 'p1', source_branch_id: 'b1', branches: { projects: { owner_id: 'someone-else' } } },
    error: null,
  });
  const r = await handleGetProposalStatus(sb as never, READ_ONLY, { proposal_id: 'p1' });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('not found or access denied'));
});

// ── C1: content-by-reference (docs/WORK_LOOP_PLAN.md) ────────────────────────────────
// "Push code to git; propose bindings." add_artifact patches that omit `content`
// when the call carries content_ref are stamped with the server-owned sentinel +
// payload.metadata.contentSource; the CLIENT pulls the bytes at accept. The
// sentinel is server-stamped ONLY, and the lane refuses projects with no git
// integration BEFORE any insert.

import { applyContentByReference, GIT_CONTENT_SENTINEL } from '../mcp-server/tools/proposals.ts';

function bindingsOnlyArtifact() {
  return {
    type: 'add_artifact',
    payload: {
      id: '44444444-4444-4444-8444-444444444444',
      nodeId: '22222222-2222-4222-8222-222222222222',
      kind: 'source', path: 'src/notifications.ts',
      createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    },
  };
}

Deno.test('C1 propose: content_ref stamps sentinel + contentSource into the stored patch', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('git_integrations', 'select', { data: { id: 'g1' }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [bindingsOnlyArtifact()],
    content_ref: 'abc123def456',
    external_agent: 'claude',
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const stored = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { payload: { content?: string; metadata?: Record<string, unknown> } } }>;
  };
  assertEquals(stored.patches[0].patch.payload.content, GIT_CONTENT_SENTINEL, 'sentinel stored, never raw absence');
  assertEquals(stored.patches[0].patch.payload.metadata?.contentSource, { type: 'git', ref: 'abc123def456' });
  const data = r.data as { contentByReference?: { count: number; ref: string }; message: string };
  assertEquals(data.contentByReference, { count: 1, ref: 'abc123def456' });
  assert(data.message.includes('bindings-only'), 'response teaches the lane');
});

Deno.test('C1 propose: no git integration → refused BEFORE any insert, naming both fixes', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('git_integrations', 'select', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [bindingsOnlyArtifact()],
    content_ref: 'abc123def456',
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('no git integration'), r.error);
  assert((r.error ?? '').includes('inline'), 'the inline-content fix is named');
  assertEquals(sb.callsTo('ai_runs', 'insert').length, 0, 'nothing inserted');
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0, 'nothing inserted');
});

Deno.test('C1 propose: inline content wins — content_ref never overwrites a provided body', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const withContent = bindingsOnlyArtifact() as { payload: Record<string, unknown> };
  withContent.payload.content = 'export const x = 1;\n';
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [withContent],
    content_ref: 'abc123def456',
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const stored = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { payload: { content?: string; metadata?: Record<string, unknown> } } }>;
  };
  assertEquals(stored.patches[0].patch.payload.content, 'export const x = 1;\n');
  assertEquals(stored.patches[0].patch.payload.metadata?.contentSource, undefined, 'no marker on inline content');
  assertEquals((r.data as { contentByReference?: unknown }).contentByReference, undefined);
  assertEquals(sb.callsTo('git_integrations', 'select').length, 0, 'integration not even consulted');
});

Deno.test('C1 propose: the sentinel is server-stamped ONLY — a caller submitting it is refused', async () => {
  const sb = new FakeSupabase();
  const forged = bindingsOnlyArtifact() as { payload: Record<string, unknown> };
  forged.payload.content = GIT_CONTENT_SENTINEL;
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [forged],
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('reserved sentinel'), r.error);
});

Deno.test('C1 propose: content_ref shape is validated (whitespace refused)', async () => {
  const sb = new FakeSupabase();
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [bindingsOnlyArtifact()],
    content_ref: 'not a ref',
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('content_ref'), r.error);
});

Deno.test('C1 propose: content omitted WITHOUT content_ref keeps today\'s behavior (no sentinel)', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [bindingsOnlyArtifact()],
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const stored = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    patches: Array<{ patch: { payload: { content?: string } } }>;
  };
  assertEquals(stored.patches[0].patch.payload.content, undefined, 'content stays absent, artifact is a contentless binding');
});

Deno.test('C1 applyContentByReference: only add_artifact without content is stamped; others pass through', () => {
  const node = { type: 'add_node', payload: { id: 'n', type: 'backend-service', label: 'X' } };
  const r1 = applyContentByReference(node, 'abc123', 0);
  assert(!('error' in r1) && r1.stamped === false && r1.patch === node, 'non-artifact untouched');
  const r2 = applyContentByReference(bindingsOnlyArtifact(), undefined, 0);
  assert(!('error' in r2) && r2.stamped === false, 'no ref → no stamp');
  const r3 = applyContentByReference(bindingsOnlyArtifact(), 'abc123', 0);
  assert(!('error' in r3) && r3.stamped === true, 'artifact + ref → stamped');
  const stamped = (r3 as { patch: { payload: { content: string; metadata: { contentSource: unknown } } } }).patch;
  assertEquals(stamped.payload.content, GIT_CONTENT_SENTINEL);
  assertEquals(stamped.payload.metadata.contentSource, { type: 'git', ref: 'abc123' });
});

// ── C2: chunked proposal sessions (docs/WORK_LOOP_PLAN.md) ───────────────────────────
// finalize:false starts a STAGED session (the import lane's invisible-until-
// finalized convention, distinguished by metadata.chunkedSession); proposal_id
// appends; finalize:true promotes to ONE pending proposal. Expiry is a sliding
// 30-minute window enforced lazily. Plain calls are untouched.

function stagedSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1', status: 'staged', source_branch_id: 'b1',
    patches: [{ patch: { type: 'add_node' }, explanation: 'first batch', status: 'pending' }],
    metadata: {
      source: 'mcp-server',
      chunkedSession: { startedAt: 't0', calls: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    },
    ...overrides,
  };
}

function scriptProjectAndBranch(sb: FakeSupabase) {
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
}

Deno.test('C2 start: finalize:false creates a STAGED session with the chunked marker', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndBranch(sb);
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()], finalize: false,
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const inserted = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    status: string; metadata: { chunkedSession?: { calls: number; expiresAt: string } };
  };
  assertEquals(inserted.status, 'staged', 'invisible to review until finalized');
  assertEquals(inserted.metadata.chunkedSession?.calls, 1);
  assert(typeof inserted.metadata.chunkedSession?.expiresAt === 'string', 'expiry stamped');
  const data = r.data as { status: string; nextAction: string; sessionPatchCount: number };
  assertEquals(data.status, 'staged');
  assertEquals(data.sessionPatchCount, 1);
  assert(data.nextAction.includes('finalize'), 'the finalize step is taught');
});

Deno.test('C2 append: patches merge into the session and the expiry window slides', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndBranch(sb);
  sb.script('ai_proposals', 'select', { data: stagedSessionRow(), error: null });
  sb.script('ai_proposals', 'update', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()], proposal_id: 'sess-1',
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const updated = sb.callsTo('ai_proposals', 'update')[0].payload as {
    patches: unknown[]; status?: string; metadata: { chunkedSession: { calls: number; expiresAt: string } };
  };
  assertEquals(updated.patches.length, 2, 'append merges, never replaces');
  assertEquals(updated.status, undefined, 'still staged — no status change on append');
  assertEquals(updated.metadata.chunkedSession.calls, 2);
  const data = r.data as { patchCountThisCall: number; sessionPatchCount: number; status: string };
  assertEquals([data.patchCountThisCall, data.sessionPatchCount, data.status], [1, 2, 'staged']);
  assertEquals(sb.callsTo('ai_runs', 'insert').length, 0, 'no extra run row for appends');
});

Deno.test('C2 finalize: promotes the whole session to ONE pending proposal (patches optional)', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndBranch(sb);
  sb.script('ai_proposals', 'select', { data: stagedSessionRow(), error: null });
  sb.script('ai_proposals', 'update', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    proposal_id: 'sess-1', finalize: true,
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const updated = sb.callsTo('ai_proposals', 'update')[0].payload as {
    status: string; patches: unknown[]; metadata: { chunkedSession: { finalizedAt?: string } };
  };
  assertEquals(updated.status, 'pending', 'finalize closes the session into review');
  assertEquals(updated.patches.length, 1, 'finalize-only call appends nothing');
  assert(typeof updated.metadata.chunkedSession.finalizedAt === 'string');
  const data = r.data as { status: string; message: string };
  assertEquals(data.status, 'pending');
  assert(data.message.includes('ONE proposal'), 'coherence is stated');
});

Deno.test('C2 expiry: a stale session is discarded and the caller told to restart', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndBranch(sb);
  sb.script('ai_proposals', 'select', {
    data: stagedSessionRow({
      metadata: { chunkedSession: { startedAt: 't0', calls: 2, expiresAt: new Date(Date.now() - 1000).toISOString() } },
    }),
    error: null,
  });
  sb.script('ai_proposals', 'delete', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()], proposal_id: 'sess-1',
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('expired'), r.error);
  assert((r.error ?? '').includes('finalize: false'), 'the restart path is named');
  assertEquals(sb.callsTo('ai_proposals', 'update').length, 0, 'nothing appended to a corpse');
  assertEquals(sb.callsTo('ai_proposals', 'delete').length, 1, 'the stale draft is reaped');
});

Deno.test('C2 double-finalize guard: a pending proposal cannot be appended to or re-finalized', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndBranch(sb);
  sb.script('ai_proposals', 'select', { data: stagedSessionRow({ status: 'pending' }), error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    proposal_id: 'sess-1', finalize: true,
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('already finalized'), r.error);
  assertEquals(sb.callsTo('ai_proposals', 'update').length, 0);
});

Deno.test('C2 lane guard: an import-lane staged draft is not a chunked session', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndBranch(sb);
  sb.script('ai_proposals', 'select', {
    data: stagedSessionRow({ metadata: { source: 'repo-import' } }), error: null,
  });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()], proposal_id: 'sess-1',
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('import lane'), r.error);
});

Deno.test('C2 ownership: a session on another branch is not found', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndBranch(sb);
  sb.script('ai_proposals', 'select', { data: stagedSessionRow({ source_branch_id: 'other-branch' }), error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()], proposal_id: 'sess-1',
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('not found'), r.error);
});

Deno.test('C2 backward compat: a plain call still creates a pending proposal, no chunked marker', async () => {
  const sb = new FakeSupabase();
  scriptProjectAndBranch(sb);
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()],
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const inserted = sb.callsTo('ai_proposals', 'insert')[0].payload as {
    status: string; metadata: Record<string, unknown>;
  };
  assertEquals(inserted.status, 'pending');
  assertEquals(inserted.metadata.chunkedSession, undefined);
  assertEquals(sb.callsTo('ai_proposals', 'delete').length, 0, 'no cleanup sweep on plain calls');
});

// ── C3: honest partial reporting (docs/WORK_LOOP_PLAN.md) ────────────────────────────
// A payload that parses is indistinguishable from a complete one, so truncation
// is fought with declared intent (expected_patch_count), a per-call ceiling that
// names the chunked continuation, and responses that always echo what arrived.

Deno.test('C3: expected_patch_count mismatch fails loudly BEFORE anything is created', async () => {
  const sb = new FakeSupabase();
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()], expected_patch_count: 3,
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('Truncation detected'), r.error);
  assert((r.error ?? '').includes('3') && (r.error ?? '').includes('1'), 'both numbers named');
  assert((r.error ?? '').includes('chunked session'), 'the continuation path is named');
  assertEquals(sb.calls.length, 0, 'nothing touched the database');
});

Deno.test('C3: a matching expected_patch_count passes through untouched', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()], expected_patch_count: 1,
  });
  assertEquals(r.success, true, JSON.stringify(r));
});

Deno.test('C3: the per-call ceiling names the limit and the chunked continuation', async () => {
  const sb = new FakeSupabase();
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: Array.from({ length: 501 }, () => ({ type: 'add_node', payload: { id: 'x' } })),
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('500-per-call limit'), r.error);
  assert((r.error ?? '').includes('finalize: false'), 'the continuation path is named');
  assertEquals(sb.calls.length, 0, 'rejected before validation or any DB touch');
});

Deno.test('C3: every plain response echoes patchCountThisCall and carries the fragment recovery path', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()],
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as { patchCountThisCall: number; ifTruncated: string; message: string };
  assertEquals(data.patchCountThisCall, 1);
  assert(data.message.includes('1 patch(es)'), 'the count rides the message too');
  assert(data.ifTruncated.includes('FRAGMENT'), 'fragment recovery is taught');
  assert(data.ifTruncated.includes('expected_patch_count'), 'the loud-failure opt-in is taught');
});

Deno.test('C3: a chunked append points truncation recovery at the still-open session', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('ai_proposals', 'select', { data: stagedSessionRow(), error: null });
  sb.script('ai_proposals', 'update', { data: null, error: null });
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()], proposal_id: 'sess-1', expected_patch_count: 1,
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as { ifTruncated: string };
  assert(data.ifTruncated.includes('append the missing ones'), 'recovery = append, the session is open');
  assert(data.ifTruncated.includes('sess-1'), 'the session id is named');
});

Deno.test('C3: an explanations/patches length mismatch is flagged as a truncation tell', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()], explanations: ['a', 'b', 'c'],
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as { warnings?: string[] };
  assert(Array.isArray(data.warnings) && data.warnings[0].includes('explanations has 3'), JSON.stringify(data.warnings));
});

Deno.test('C3: expected_patch_count shape is validated', async () => {
  const sb = new FakeSupabase();
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addNodePatch()], expected_patch_count: 1.5,
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('positive integer'), r.error);
});

// ── Dogfood find 2026-09-02 (#1): unknown change keys refuse loudly ───────────
Deno.test('validate: update_node with an unknown changes key is REFUSED by name, never silently dropped', () => {
  const r = validateAndNormalizeProposalPatch({
    type: 'update_node',
    payload: { id: '22222222-2222-2222-2222-222222222222', changes: { configuration: { speed: 5 } } },
  }, 0, 'sets config', 'agent');
  assert('error' in r, 'the silent-drop shape must be an error');
  const err = (r as { error: string }).error;
  assert(err.includes('"configuration"'), 'names the offending key');
  assert(err.includes('metadata.config'), 'teaches where node configuration actually lives');
  assert(err.includes('replaced wholesale'), 'warns about the metadata replace semantics');
});

Deno.test('validate: the REAL config write path (changes.metadata.config) still validates clean', () => {
  const r = validateAndNormalizeProposalPatch({
    type: 'update_node',
    payload: { id: '22222222-2222-2222-2222-222222222222', changes: { metadata: { config: { speed: 5 } } } },
  }, 0, 'sets config properly', 'agent');
  assert(!('error' in r), `metadata.config path must pass: ${JSON.stringify(r)}`);
});

Deno.test('validate: known change keys on every update type still pass (blast radius check)', () => {
  const label = validateAndNormalizeProposalPatch({
    type: 'update_node',
    payload: { id: '22222222-2222-2222-2222-222222222222', changes: { label: 'Renamed' } },
  }, 0, 'rename', 'agent');
  assert(!('error' in label), 'plain label update unaffected');
});

// ── Dogfood find 2026-09-02 (#2): status and patchSummary can never disagree ──
Deno.test('get_proposal_status: a merged row reports merged patches — the pending:1/merged:0 contradiction is gone', async () => {
  const sb = new FakeSupabase();
  sb.script('ai_proposals', 'select', {
    data: { id: 'p1', source_branch_id: 'b1', branches: { projects: { owner_id: 'user-1' } } },
    error: null,
  });
  // The live shape: whole-proposal accept stamped the ROW merged but never
  // rewrote the per-patch statuses in the stored JSON.
  sb.script('ai_proposals', 'select', {
    data: {
      id: 'p1', status: 'merged', created_at: 't', reviewed_at: 't', merged_at: 't',
      patches: [
        { patch: {}, explanation: 'carried by the whole-proposal accept', status: 'pending' },
        { patch: {}, explanation: 'explicitly rejected during review', status: 'rejected' },
      ],
    },
    error: null,
  });
  const r = await handleGetProposalStatus(sb as never, READ_ONLY, { proposal_id: 'p1' });
  assertEquals(r.success, true);
  const d = r.data as { status: string; patchSummary: Record<string, number>; patches: Array<{ status: string }> };
  assertEquals(d.status, 'merged');
  assertEquals([d.patchSummary.pending, d.patchSummary.merged, d.patchSummary.rejected], [0, 1, 1],
    'pending derives to merged under a merged row; an explicit rejection keeps its stamp');
  assertEquals(d.patches[0].status, 'merged');
  assertEquals(d.patches[1].status, 'rejected');
});

Deno.test('get_proposal_status: a PENDING row still reports raw patch statuses (no derivation)', async () => {
  const sb = new FakeSupabase();
  sb.script('ai_proposals', 'select', {
    data: { id: 'p2', source_branch_id: 'b1', branches: { projects: { owner_id: 'user-1' } } },
    error: null,
  });
  sb.script('ai_proposals', 'select', {
    data: {
      id: 'p2', status: 'pending', created_at: 't', reviewed_at: null, merged_at: null,
      patches: [{ patch: {}, explanation: 'a', status: 'pending' }],
    },
    error: null,
  });
  const r = await handleGetProposalStatus(sb as never, READ_ONLY, { proposal_id: 'p2' });
  const d = r.data as { patchSummary: Record<string, number> };
  assertEquals([d.patchSummary.pending, d.patchSummary.merged], [1, 0], 'in-flight rows are untouched');
});

// ── 9.6: proposing IS the ask — the routing note names the lane, the file still lands ──
const BRANCH_UUID = '22222222-2222-4222-8222-222222222222';
const CONTEXT_BATCH = [
  { type: 'update_vision', payload: { vision: 'Drafted from the README; confirm in your words.' } },
  { type: 'upsert_workflow', payload: { name: 'Onboarding' } },
  { type: 'upsert_workflow_step', payload: { workflowName: 'Onboarding', name: 'Sign up' } },
  // AA.1: the outcome cites the sentence it serves, by its words (the vision rides the same batch)
  { type: 'create_candidate', payload: { branchId: BRANCH_UUID, workflowName: 'Onboarding', name: 'New users reach the dashboard', serves: ['Drafted from the README; confirm in your words.'] } },
];

// A context proposal follows a repo import (Indie and above), and its lanes
// are Workflows (P: Indie and above), so the fixture account is Indie. Pass
// null for a Community account (no subscription row).
const INDIE_ROW = { plan_name: 'indie', status: 'active' };
function scriptContextProposal(sb: FakeSupabase, policy: Record<string, string> | null, plan: Record<string, string> | null = INDIE_ROW) {
  if (plan) sb.script('stripe_subscriptions', 'select', { data: plan, error: null });
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: BRANCH_UUID }, error: null });
  sb.script('projects', 'select', { data: policy ? { automation_policy: policy } : null, error: null }); // the policy read
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
}

Deno.test('propose_patches (9.6): a level-0 candidates lane does NOT refuse the context proposal — it files, and routing names the lane', async () => {
  const sb = new FakeSupabase();
  scriptContextProposal(sb, { candidates: '0', requirements: '2' });
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: BRANCH_UUID, patches: CONTEXT_BATCH, external_agent: 'claude',
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const data = r.data as { patchCount: number; status: string; routing: { route: string; lane: string | null; note: string } };
  assertEquals(data.patchCount, 4);
  assertEquals(data.status, 'pending');
  assertEquals(data.routing.route, 'refuse');
  assertEquals(data.routing.lane, 'candidates');
  assert(data.routing.note.includes('level 0') && data.routing.note.includes('still files'), data.routing.note);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 1, 'the proposal is written');
});

Deno.test('propose_patches (9.6, AL.6): the mixed batch reports the strictest lane at review level; at Auto a key that may only propose still waits, and says what Auto applies', async () => {
  const sb = new FakeSupabase();
  scriptContextProposal(sb, { candidates: '1', requirements: '2' });
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, { project_id: NAMED_PROJECT.id, branch_id: BRANCH_UUID, patches: CONTEXT_BATCH });
  assertEquals(r.success, true, JSON.stringify(r));
  const routing = (r.data as { routing: { route: string; lane: string | null; note: string } }).routing;
  assertEquals(routing, { route: 'propose', lane: 'candidates', note: 'The candidates lane reviews every change; this proposal is the expected path.' });

  const auto = new FakeSupabase();
  scriptContextProposal(auto, { candidates: '2', requirements: '2' });
  const a = await handleProposePatches(auto as never, PROPOSE_AUTH, { project_id: NAMED_PROJECT.id, branch_id: BRANCH_UUID, patches: CONTEXT_BATCH });
  assertEquals(a.success, true, JSON.stringify(a));
  const ar = (a.data as { routing: { route: string; note: string } }).routing;
  assertEquals(ar.route, 'apply');
  // AL.24: the note names why it waits, and so does the proposal (its card says it)
  assertEquals(ar.note, 'Every lane this batch touches is at Auto, but it waits for the user: Its agent may only propose: the credential it used has no write access.');
  assertEquals((a.data as { status: string }).status, 'pending', 'a key with no write scope never applies');
  const writes = auto.callsTo('ai_proposals', 'update');
  assertEquals(writes.length, 1, 'nothing was claimed or applied; the reason is recorded');
  const recorded = writes[0].payload as { status?: string; reviewed_at?: string; metadata: { autoWait: { reason: string } } };
  assertEquals([recorded.status, recorded.reviewed_at], [undefined, undefined]);
  assertEquals(recorded.metadata.autoWait.reason, 'Its agent may only propose: the credential it used has no write access.');
  assert(writes[0].filters.some((f) => f.method === 'is' && f.args[0] === 'reviewed_at' && f.args[1] === null), 'only while no decider holds it');
});

Deno.test('propose_patches (9.6): with no policy row the shipped defaults route — a graph op reports the architecture lane at propose', async () => {
  const sb = new FakeSupabase();
  scriptContextProposal(sb, null);
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, { project_id: NAMED_PROJECT.id, branch_id: BRANCH_UUID, patches: [addNodePatch()] });
  assertEquals(r.success, true, JSON.stringify(r));
  const routing = (r.data as { routing: { route: string; lane: string | null } }).routing;
  assertEquals(routing.route, 'propose');
  assertEquals(routing.lane, 'architecture');
});

// ── P (2026-09-22): Workflows are Indie and above, at the propose door ───────
// The agent hears at propose, not when the user accepts: a lane-shaping op
// refuses the whole batch by name (never half-filed); an outcome that names
// a workflow still files, with a warning saying it lands on the project.

Deno.test('propose_patches (P): on Community a lane-shaping op refuses the whole batch by name, says what stays, and creates nothing', async () => {
  const sb = new FakeSupabase();
  scriptContextProposal(sb, null, null);
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, { project_id: NAMED_PROJECT.id, branch_id: BRANCH_UUID, patches: CONTEXT_BATCH });
  assertEquals(r.success, false, JSON.stringify(r));
  const err = String(r.error);
  assert(err.startsWith('Shaping a workflow (patch[1] upsert_workflow, patch[2] upsert_workflow_step) is available on Indie and above; this account resolves to the Community tier.'), err);
  assert(err.includes(WORKFLOWS_STAY), err);
  assert(err.endsWith('Nothing was created.'), err);
  assertEquals(sb.callsTo('ai_runs', 'insert').length, 0);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0, 'no proposal the user would later have to decline');
});

Deno.test('propose_patches (P): place_on_step is refused on Community, named as the intent the agent sent', async () => {
  const sb = new FakeSupabase();
  scriptContextProposal(sb, null, null);
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: BRANCH_UUID,
    intents: [{ kind: 'place_on_step', candidateId: crypto.randomUUID(), stepIds: [crypto.randomUUID()] }],
  });
  assertEquals(r.success, false, JSON.stringify(r));
  assert(String(r.error).startsWith('Shaping a workflow (intent[0] place_on_step) is available on Indie and above'), String(r.error));
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);
});

Deno.test('propose_patches (P): on Community an outcome that names a workflow still files, and the warning says where it lands', async () => {
  const sb = new FakeSupabase();
  scriptContextProposal(sb, null, null);
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: BRANCH_UUID,
    patches: [{ type: 'create_candidate', payload: { branchId: BRANCH_UUID, workflowName: 'Onboarding', name: 'New users reach the dashboard' } }],
  });
  assertEquals(r.success, true, JSON.stringify(r));
  const warnings = (r.data as { warnings?: string[] }).warnings ?? [];
  assertEquals(warnings, [
    `patch[0] create_candidate: ${OUTCOME_ON_PROJECT_NOTE('Onboarding')}`,
    // AA.1: it cites no vision sentence, so it files with that note too
    `patch[0] create_candidate: ${OFF_VISION_NOTE}`,
  ]);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 1, 'the outcome files: outcomes are open on every plan');
});

Deno.test('propose_patches (P): Indie files the same context batch with no warning, and a batch that shapes no workflow reads no tier', async () => {
  const sb = new FakeSupabase();
  scriptContextProposal(sb, null);
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, { project_id: NAMED_PROJECT.id, branch_id: BRANCH_UUID, patches: CONTEXT_BATCH });
  assertEquals(r.success, true, JSON.stringify(r));
  assertEquals((r.data as { warnings?: string[] }).warnings, undefined);

  const plain = new FakeSupabase();
  scriptContextProposal(plain, null, null);
  const g = await handleProposePatches(plain as never, PROPOSE_AUTH, { project_id: NAMED_PROJECT.id, branch_id: BRANCH_UUID, patches: [addNodePatch()] });
  assertEquals(g.success, true, JSON.stringify(g));
  assertEquals(plain.callsTo('stripe_subscriptions').length, 0, 'the gate costs nothing when nothing touches a workflow');
});

// ── Batch referential validation (production incident 2026-09-18) ─────────────
//
// 'OpenMed Import': an explode of a container node proposed 7 remove_edge
// patches retiring the old container's edges and 7 add_edge patches replacing
// them against the new children. Every add_edge carried a contractId — two
// distinct ids across all seven — that no add_contract patch ever created.
// PatchOperationSchema only asks that contractId be a uuid, so the batch was
// accepted. At approve time the engine raised CONTRACT_NOT_FOUND, the removes
// applied, the adds were discarded under a drop tolerance, and the user was
// told the approval succeeded. The canvas lost 7 edges; all 14 patches stayed
// in graph_patches. These pin the refusal at submission.
import { findBatchReferenceGaps, describeBatchReferenceGaps } from '../mcp-server/tools/proposals.ts';
import { OFF_VISION_NOTE } from '../_shared/chain.ts';

const NODE_A = 'a879d17a-9ee5-43d5-a5d3-c498afc96873';
const NODE_B = '3c64b02e-610d-487a-8894-c372e4bde6cc';
const GHOST_CONTRACT = '1dd5ee27-c8fe-4e75-8ad8-51ede6daaea5';
const REAL_CONTRACT = 'ee3657d8-a5d1-4243-8752-ce893480fa49';

function addEdge(contractId: string, source = NODE_A, target = NODE_B) {
  return {
    type: 'add_edge',
    payload: { id: 'aaa10001-0001-4001-a001-000000000001', label: 'imports core types', source, target, contractId },
  };
}
function addContract(id: string) {
  return { type: 'add_contract', payload: { id, kind: 'dependency', name: 'Internal Python Imports', status: 'draft' } };
}
const BRANCH_IDS = { nodes: [NODE_A, NODE_B], contracts: [REAL_CONTRACT] };

Deno.test('batch references: the OpenMed shape — an edge against a contract nothing creates is a gap', () => {
  const gaps = findBatchReferenceGaps([addEdge(GHOST_CONTRACT)], BRANCH_IDS);
  assertEquals(gaps.length, 1);
  assertEquals(gaps[0].entity, 'contract');
  assertEquals(gaps[0].field, 'contractId');
  assertEquals(gaps[0].missingId, GHOST_CONTRACT);
  const msg = describeBatchReferenceGaps(gaps);
  assert(msg.includes(GHOST_CONTRACT), 'the message names the missing id');
  assert(msg.includes('add_contract'), 'the message names the fix');
});

Deno.test('batch references: a contract already on the branch resolves', () => {
  assertEquals(findBatchReferenceGaps([addEdge(REAL_CONTRACT)], BRANCH_IDS).length, 0);
});

Deno.test('batch references: a contract created ANYWHERE in the batch resolves — order does not matter', () => {
  // applyPatches sorts by dependency phase (add_contract at 10, edges later),
  // so a contract declared after the edge that uses it still lands first.
  assertEquals(findBatchReferenceGaps([addEdge(GHOST_CONTRACT), addContract(GHOST_CONTRACT)], BRANCH_IDS).length, 0);
  assertEquals(findBatchReferenceGaps([addContract(GHOST_CONTRACT), addEdge(GHOST_CONTRACT)], BRANCH_IDS).length, 0);
});

Deno.test('batch references: unknown source and target nodes are named too', () => {
  const ghostNode = '99999999-9999-4999-8999-999999999999';
  const gaps = findBatchReferenceGaps([addEdge(REAL_CONTRACT, ghostNode, ghostNode)], BRANCH_IDS);
  assertEquals(gaps.length, 2);
  assertEquals(gaps.map((g) => g.field).sort(), ['source', 'target']);
  assertEquals(gaps.every((g) => g.entity === 'node'), true);
});

Deno.test('batch references: a contract removed earlier in the batch no longer resolves', () => {
  const gaps = findBatchReferenceGaps(
    [{ type: 'remove_contract', payload: { id: REAL_CONTRACT } }, addEdge(REAL_CONTRACT)],
    BRANCH_IDS,
  );
  assertEquals(gaps.length, 1);
  assertEquals(gaps[0].missingId, REAL_CONTRACT);
});

Deno.test('batch references: an add_node in the batch satisfies an edge endpoint', () => {
  const fresh = '44444444-4444-4444-4444-444444444444';
  const gaps = findBatchReferenceGaps(
    [{ type: 'add_node', payload: { id: fresh, type: 'backend-service', label: 'API Service' } }, addEdge(REAL_CONTRACT, NODE_A, fresh)],
    BRANCH_IDS,
  );
  assertEquals(gaps.length, 0);
});

Deno.test('propose_patches: refuses the OpenMed batch and creates nothing', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('rpc', 'graph_reference_ids', { data: { found: true, nodes: BRANCH_IDS.nodes, contracts: BRANCH_IDS.contracts }, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [{ type: 'remove_edge', payload: { id: 'b163709f-1786-4512-8020-bc269a65b970' } }, addEdge(GHOST_CONTRACT)],
    external_agent: 'claude',
  });

  assertEquals(r.success, false);
  assert((r.error ?? '').includes(GHOST_CONTRACT), `error names the missing contract: ${r.error}`);
  assert((r.error ?? '').includes('patch[1]'), 'error names the offending index');
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0, 'no proposal was created');
  assertEquals(sb.callsTo('ai_runs', 'insert').length, 0, 'no ai_run was created');
});

Deno.test('propose_patches: the same batch WITH its add_contract is accepted', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('rpc', 'graph_reference_ids', { data: { found: true, nodes: BRANCH_IDS.nodes, contracts: BRANCH_IDS.contracts }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addContract(GHOST_CONTRACT), addEdge(GHOST_CONTRACT)],
    external_agent: 'claude',
  });

  assertEquals(r.success, true, `expected acceptance, got: ${r.error}`);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 1);
});

Deno.test('propose_patches: a stack without the migration fails loudly, never silently unvalidated', async () => {
  const sb = new FakeSupabase();
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('rpc', 'graph_reference_ids', { data: null, error: { message: 'Could not find the function public.graph_reference_ids' } });

  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [addEdge(GHOST_CONTRACT)],
    external_agent: 'claude',
  });

  assertEquals(r.success, false);
  assert((r.error ?? '').includes('20260919100000'), `error names the migration: ${r.error}`);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);
});

// ── V3 2.1 (2026-09-19): base_sequence, checked at propose ────────────────────
// The agent says which head it read; a batch whose targets a later patch
// changed is refused before anything is created, naming the patch and the
// change. Optional: without it the proposal files as before.
const NODE_ON_BRANCH = '22222222-2222-4222-8222-222222222222';
const OTHER_NODE = '99999999-9999-4999-8999-999999999999';
function updateNodePatch(id: string) {
  return { type: 'update_node', payload: { id, changes: { label: 'Renamed' } } };
}
function laterRow(sequence: number, id: string, actor = 'human', summary = 'renamed to Cache') {
  return { sequence, patch_type: 'update_node', actor_type: actor, summary, payload: { type: 'update_node', payload: { id, changes: {} } } };
}
function scriptHappyPath(sb: FakeSupabase) {
  sb.script('projects', 'select', { data: { id: NAMED_PROJECT.id, name: NAMED_PROJECT.name }, error: null });
  sb.script('branches', 'select', { data: { id: 'b1' }, error: null });
  sb.script('rpc', 'graph_reference_ids', { data: { found: true, nodes: [NODE_ON_BRANCH, OTHER_NODE], contracts: [] }, error: null });
}

Deno.test('propose_patches: base_sequence is stored on the proposal and the current head is echoed', async () => {
  const sb = new FakeSupabase();
  scriptHappyPath(sb);
  sb.script('graph_patches', 'select', { data: [laterRow(6, OTHER_NODE, 'human', 'added a cache')], error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1', patches: [updateNodePatch(NODE_ON_BRANCH)], external_agent: 'claude', base_sequence: 5,
  });
  assertEquals(r.success, true, `expected acceptance, got: ${r.error}`);
  const data = r.data as { baseSequence?: number; headSequence?: number };
  assertEquals(data.baseSequence, 5);
  assertEquals(data.headSequence, 6, 'the head is the last later patch');
  const inserted = sb.callsTo('ai_proposals', 'insert')[0].payload as { metadata: { baseSequence?: number } };
  assertEquals(inserted.metadata.baseSequence, 5, 'the read rides the row so the accept can check it again');
});

Deno.test('propose_patches: a stale base_sequence is refused before anything is created, naming the patch and the change', async () => {
  const sb = new FakeSupabase();
  scriptHappyPath(sb);
  sb.script('graph_patches', 'select', { data: [laterRow(7, NODE_ON_BRANCH, 'human', 'renamed to Cache')], error: null });
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1', patches: [updateNodePatch(NODE_ON_BRANCH)], external_agent: 'claude', base_sequence: 5,
  });
  assertEquals(r.success, false);
  const e = r.error ?? '';
  assert(e.includes('Stale read'), e);
  assert(e.includes(NODE_ON_BRANCH), 'names the id both sides touch');
  assert(e.includes('sequence 7') && e.includes('the user') && e.includes('renamed to Cache'), 'names the later change and who made it');
  assert(e.includes('since_sequence: 5'), 'tells the agent how to re-read');
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0, 'nothing created');
  assertEquals(sb.callsTo('ai_runs', 'insert').length, 0, 'no run minted');
});

Deno.test('propose_patches: base_sequence must be a non-negative integer; without it the head is read once and recorded as the base (AL.8)', async () => {
  const sb = new FakeSupabase();
  scriptHappyPath(sb);
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1', patches: [updateNodePatch(NODE_ON_BRANCH)], external_agent: 'claude', base_sequence: -1,
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').includes('non-negative integer'), r.error);
  assertEquals(sb.callsTo('graph_patches', 'select').length, 0);

  const sb2 = new FakeSupabase();
  scriptHappyPath(sb2);
  sb2.script('graph_patches', 'select', { data: { sequence: 12 }, error: null });
  sb2.script('ai_runs', 'insert', { data: null, error: null });
  sb2.script('ai_proposals', 'insert', { data: null, error: null });
  const r2 = await handleProposePatches(sb2 as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1', patches: [updateNodePatch(NODE_ON_BRANCH)], external_agent: 'claude',
  });
  assertEquals(r2.success, true, r2.error);
  assertEquals(sb2.callsTo('graph_patches', 'select').length, 1, 'the head, once');
  // the accept compares against what landed after the head this was built on
  assertEquals((sb2.callsTo('ai_proposals', 'insert')[0].payload as { metadata: { baseSequence?: unknown } }).metadata.baseSequence, 12);
  assertEquals('headSequence' in (r2.data as Record<string, unknown>), false);
});

Deno.test('get_proposal_status: echoes the read the proposal was built on and what the accept found had moved', async () => {
  const sb = new FakeSupabase();
  sb.script('ai_proposals', 'select', { data: { id: 'p1', source_branch_id: 'b1', branches: { project_id: NAMED_PROJECT.id, projects: { owner_id: 'user-1' } } }, error: null });
  sb.script('ai_proposals', 'select', {
    data: {
      id: 'p1', status: 'pending',
      patches: [{ patch: updateNodePatch(NODE_ON_BRANCH), explanation: 'rename', status: 'conflicted', conflictReason: 'patch[0] update_node targets the node, which the user changed at sequence 9 with update_node.' }],
      metadata: { baseSequence: 5, conflicts: [{ index: 0, targetId: NODE_ON_BRANCH, laterSequence: 9 }], headSequence: 9 },
      created_at: '2026-09-19T10:00:00Z', reviewed_at: null, merged_at: null,
    },
    error: null,
  });
  const r = await handleGetProposalStatus(sb as never, READ_ONLY, { proposal_id: 'p1' });
  assertEquals(r.success, true, r.error);
  const d = r.data as { baseSequence: number | null; conflicts?: unknown[]; patchSummary: { conflicted: number } };
  assertEquals(d.baseSequence, 5);
  assertEquals(d.patchSummary.conflicted, 1, 'the accept path is the first writer of conflicted; this tool counts it');
  assertEquals((d.conflicts ?? []).length, 1);
});

// ── V3 2.4 (2026-09-19): a locked node refuses where the proposal is filed ──
Deno.test('propose_patches: a batch that changes a locked node is refused whole, naming the patch and the node', async () => {
  const sb = new FakeSupabase();
  scriptHappyPath(sb);
  sb.script('project_specifications', 'select', { data: { locked_nodes: [NODE_ON_BRANCH] }, error: null });
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [updateNodePatch(OTHER_NODE), updateNodePatch(NODE_ON_BRANCH)],
    external_agent: 'claude',
  });
  assertEquals(r.success, false);
  const e = r.error ?? '';
  assert(e.includes('Locked node'), e);
  assert(e.includes(`patch[1] update_node targets node ${NODE_ON_BRANCH}`), e);
  assert(e.includes('No tool unlocks'), e);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0, 'nothing created, not even the open patch');
});

Deno.test('propose_patches: an edge TO a locked node is allowed (the lock protects the node, not its neighbourhood)', async () => {
  const sb = new FakeSupabase();
  scriptHappyPath(sb);
  sb.script('project_specifications', 'select', { data: { locked_nodes: [NODE_ON_BRANCH] }, error: null });
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  const contract = '88888888-8888-4888-8888-888888888888';
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1',
    patches: [
      { type: 'add_contract', payload: { id: contract, kind: 'rest', name: 'Cache API' } },
      { type: 'add_edge', payload: { id: '77777777-7777-4777-8777-777777777777', source: OTHER_NODE, target: NODE_ON_BRANCH, contractId: contract } },
    ],
    external_agent: 'claude',
  });
  assertEquals(r.success, true, r.error);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 1);
});

// ── V3 3.1 (2026-09-19): intents inside propose_patches ──────────────────────
Deno.test('propose_patches: intents compile to patches that join the batch first, pass the same validation, and are recorded on the proposal', async () => {
  const sb = new FakeSupabase();
  scriptHappyPath(sb);
  sb.script('ai_runs', 'insert', { data: null, error: null });
  sb.script('ai_proposals', 'insert', { data: null, error: null });
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1', external_agent: 'claude-code',
    intents: [
      { kind: 'add_node', label: 'Cache', type: 'cache', technology: 'redis' },
    ],
    patches: [updateNodePatch(NODE_ON_BRANCH)],
    explanations: ['rename the API'],
  });
  assertEquals(r.success, true, `expected acceptance, got: ${r.error}`);
  // deno-lint-ignore no-explicit-any
  const data = r.data as any;
  assertEquals(data.patchCount, 2, 'one compiled patch plus the agent\'s own');
  assertEquals(data.compiled.intents, 1);
  assertEquals(data.compiled.patches, 1);
  assert(typeof data.compiled.ids[0].nodeId === 'string', 'the minted node id is named back');
  // deno-lint-ignore no-explicit-any
  const inserted = sb.callsTo('ai_proposals', 'insert')[0].payload as any;
  assertEquals(inserted.patches.length, 2);
  assertEquals(inserted.patches[0].patch.type, 'add_node');
  assertEquals(inserted.patches[0].patch.payload.label, 'Cache');
  assertEquals(inserted.patches[0].explanation, 'Add node "Cache"');
  assertEquals(inserted.patches[1].explanation, 'rename the API', 'the agent\'s own explanations still line up with its own patches');
  assertEquals(inserted.metadata.intents, [{ kind: 'add_node', summary: 'add a node "Cache" (cache, redis)', ids: { nodeId: data.compiled.ids[0].nodeId } }]);
  // the project is resolved once for the compile and reused below; the routing block's policy read and
  // the constraints' owner read (AC: are they carried?) are the other projects selects
  assertEquals(sb.callsTo('projects', 'select').length, 3);
});

Deno.test('propose_patches: an intent that fails to compile, or compiles to an invalid patch, refuses naming the intent; nothing is created', async () => {
  const sb = new FakeSupabase();
  scriptHappyPath(sb);
  const r = await handleProposePatches(sb as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1', external_agent: 'claude',
    intents: [{ kind: 'connect_nodes', source: NODE_ON_BRANCH, target: NODE_ON_BRANCH, contract: { kind: 'rest', name: 'x' } }],
  });
  assertEquals(r.success, false);
  assert((r.error ?? '').startsWith('intent[0] (connect_nodes): source and target must differ'), r.error);
  assertEquals(sb.callsTo('ai_proposals', 'insert').length, 0);

  const sb2 = new FakeSupabase();
  scriptHappyPath(sb2);
  const r2 = await handleProposePatches(sb2 as never, PROPOSE_AUTH, {
    project_id: NAMED_PROJECT.id, branch_id: 'b1', external_agent: 'claude',
    intents: [{ kind: 'connect_nodes', source: OTHER_NODE, target: NODE_ON_BRANCH, contract: { kind: 'telepathy', name: 'x' } }],
  });
  assertEquals(r2.success, false);
  assert((r2.error ?? '').includes('intent[0] (connect_nodes) compiled patch[0]'), r2.error);
  assertEquals(sb2.callsTo('ai_proposals', 'insert').length, 0);
});

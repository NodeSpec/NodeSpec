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
function scriptCatalog(sb: FakeSupabase) {
  const roleRow = (id: string, palette_category: string, extra: Record<string, unknown> = {}) => ({
    id, label: id, description: '', icon_name: '', color: '', rf_visual_type: '', palette_category,
    kind: 'compute', is_container: false, container_layer: null, container_style: null,
    can_contain: [], metadata_schema: {}, default_ports: [], suggested_contracts: [],
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
    }],
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

  // 2026-07-16: portless proposed nodes get default ports provisioned (edges can't render on a
  // portless node — React Flow drops them without handles).
  assert(Array.isArray(stored.ports) && stored.ports.length > 0, 'ports provisioned');
  assert(stored.ports.some((p) => p.direction === 'in') && stored.ports.some((p) => p.direction === 'out'), 'in+out pair');

  // And the response reports the normalizations transparently.
  const norm = (r.data as { normalizations: Array<{ field: string; to: string }> }).normalizations;
  assert(norm.some((n) => n.field === 'type' && n.to === 'frontend-app'), 'reports the type conform');
  assert(norm.some((n) => n.field === 'technology' && n.to === 'react'), 'reports the tech conform');
  assert(norm.some((n) => n.field === 'ports'), 'reports the port provisioning');
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

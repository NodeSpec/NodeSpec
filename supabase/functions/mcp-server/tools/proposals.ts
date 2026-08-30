// S1-3: the `proposals` tool bucket — propose_patches (the primary external-agent write
// path) and get_proposal_status. Moved verbatim from index.ts (no logic change). A leaf
// bucket: it depends only on shared helpers + the patch schema, and the git bucket's
// resolve_change depends on THIS module (not the other way round). Structural supabase
// param + type-only SupabaseClient so it's offline-testable.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PatchOperationSchema } from "../../_shared/patch-schema.ts";
import { loadCatalogs } from "../../_shared/catalog-loader.ts";
import type { CatalogData } from "../../_shared/catalog-loader.ts";
import { normalizeProposedNode, ensureNodePorts, type NodeNormalizationNote } from "../../_shared/catalog-node-normalization.ts";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, UUID_RE } from "../shared.ts";

// C1 (docs/WORK_LOOP_PLAN.md): content-by-reference. When the AI has already
// pushed the file bodies to git, an add_artifact may omit `content` and pass
// `content_ref` (the pushed commit sha, or a branch name) — the server stamps
// this sentinel plus payload.metadata.contentSource, and the CLIENT pulls the
// real bytes from git at accept time (the B2 rule: only the state's owner
// writes the graph; the fetch itself still runs server-side via git-pull).
// The sentinel is server-stamped ONLY — a caller submitting it verbatim is
// refused, so it can never smuggle un-refed "content" past review.
export const GIT_CONTENT_SENTINEL = "__nodespec_git_content__";

// C2 (docs/WORK_LOOP_PLAN.md): chunked proposal sessions. A session is an
// ai_proposals row in the EXISTING 'staged' status (the import lane's
// invisible-until-finalized convention — ChangesPanel lists 'pending' only)
// carrying metadata.chunkedSession as the marker that separates it from
// import drafts. Expiry is a sliding window enforced LAZILY (append/finalize
// past the deadline discards the draft and says so) plus opportunistic
// cleanup on session start — no cron, replay-safe, no migration.
export const CHUNKED_SESSION_TTL_MS = 30 * 60 * 1000;
export const CHUNKED_SESSION_MAX_PATCHES = 5000;

// C3 (docs/WORK_LOOP_PLAN.md): honest partial reporting. A JSON payload that
// PARSES is indistinguishable from a complete one, so truncation is fought on
// three fronts: a per-call ceiling that names the chunked continuation path
// instead of choking downstream, a caller-declared expected_patch_count that
// makes a short delivery fail LOUDLY before anything is created, and every
// response echoing exactly what arrived so a fragment is never silently
// accepted as complete.
export const SINGLE_CALL_MAX_PATCHES = 500;

/**
 * Pre-validation transform for one patch: stamp content-by-reference on
 * add_artifact payloads that omit `content` when the call carries a
 * content_ref. Pure; malformed patches pass through untouched so the main
 * validator reports them with its richer message.
 */
export function applyContentByReference(
  patch: unknown,
  contentRef: string | undefined,
  index: number,
): { patch: unknown; stamped: boolean } | { error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { patch, stamped: false };
  const p = patch as Record<string, unknown>;
  const payload = (p.payload && typeof p.payload === 'object' && !Array.isArray(p.payload))
    ? p.payload as Record<string, unknown>
    : null;
  if (payload?.content === GIT_CONTENT_SENTINEL) {
    return {
      error: `patch[${index}]: content "${GIT_CONTENT_SENTINEL}" is a reserved sentinel the server stamps itself — ` +
        `omit content and pass content_ref instead`,
    };
  }
  if (p.type !== 'add_artifact' || !payload || payload.content !== undefined || !contentRef) {
    return { patch, stamped: false };
  }
  const priorMeta = (payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata))
    ? payload.metadata as Record<string, unknown>
    : {};
  return {
    patch: {
      ...p,
      payload: {
        ...payload,
        content: GIT_CONTENT_SENTINEL,
        metadata: { ...priorMeta, contentSource: { type: 'git', ref: contentRef } },
      },
    },
    stamped: true,
  };
}

const VALID_PATCH_TYPES = new Set([
  'add_node', 'update_node', 'remove_node', 'delete_node',
  'add_edge', 'update_edge', 'remove_edge', 'delete_edge',
  'add_contract', 'update_contract', 'remove_contract', 'delete_contract',
  'add_artifact', 'update_artifact', 'remove_artifact', 'delete_artifact',
  'update_graph_metadata', 'add_port', 'update_port', 'delete_port',
  'connect_ports', 'create_node_from_template', 'instantiate_contract_stub',
  'attach_artifact_stub', 'mark_entity_complete', 'add_node_group',
  'update_node_group', 'remove_node_group', 'set_edge_direction',
  'set_edge_criticality',
]);

// Conform a proposed patch's node type/technology to the catalog (IP-safe, server-side,
// deterministic — the external AI proposes catalog-blind). Applies to the three ops that
// embed a node: add_node (payload), create_node_from_template (payload.node), and update_node
// (payload.changes, only when a `type` is being changed — a technology-only change lacks the
// existing node's role to validate against and is left as-is, a documented minor gap).
// Returns a payload copy + the change notes; a null catalog (load failure) is a no-op.
function applyCatalogNormalization(
  p: Record<string, unknown>,
  catalogs: CatalogData | null,
): { payload: unknown; notes: NodeNormalizationNote[] } {
  if (!catalogs) return { payload: p.payload, notes: [] };
  const notes: NodeNormalizationNote[] = [];

  const conformFullNode = (node: Record<string, unknown>): Record<string, unknown> => {
    const out = { ...node };
    const n = normalizeProposedNode(catalogs, out.type as string | undefined, out.technology as string | undefined);
    out.type = n.type;
    if (n.technology !== undefined) out.technology = n.technology;
    else delete out.technology;
    if (out.status === undefined) out.status = 'draft';
    notes.push(...n.notes);
    // Portless nodes render zero React Flow handles, which silently drops every edge touching
    // them — provision the role's default ports (or a generic in/out pair) like the in-app
    // creation paths always did. Uses the RESOLVED type.
    const ensured = ensureNodePorts(catalogs, n.type, out.ports);
    out.ports = ensured.ports;
    if (ensured.note) notes.push(ensured.note);
    return out;
  };

  if (p.type === 'add_node' && p.payload && typeof p.payload === 'object') {
    return { payload: conformFullNode(p.payload as Record<string, unknown>), notes };
  }
  if (p.type === 'create_node_from_template' && p.payload && typeof p.payload === 'object') {
    const payload = { ...(p.payload as Record<string, unknown>) };
    if (payload.node && typeof payload.node === 'object') payload.node = conformFullNode(payload.node as Record<string, unknown>);
    return { payload, notes };
  }
  if (p.type === 'update_node' && p.payload && typeof p.payload === 'object') {
    const payload = { ...(p.payload as Record<string, unknown>) };
    const changes = { ...((payload.changes ?? {}) as Record<string, unknown>) };
    if (changes.type !== undefined) {
      const n = normalizeProposedNode(catalogs, changes.type as string | undefined, changes.technology as string | undefined);
      changes.type = n.type;
      if (changes.technology !== undefined && n.technology !== undefined) changes.technology = n.technology;
      notes.push(...n.notes);
    }
    payload.changes = changes;
    return { payload, notes };
  }
  return { payload: p.payload, notes: [] };
}

// Validate a single incoming patch against the canonical NodeSpec shape and
// enrich its metadata so it satisfies PatchOperationSchema when applied in the UI.
export function validateAndNormalizeProposalPatch(
  patch: unknown,
  index: number,
  explanation: string,
  externalAgent: string,
  catalogs: CatalogData | null = null,
): { patch: Record<string, unknown>; notes: NodeNormalizationNote[] } | { error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { error: `patch[${index}]: must be an object` };
  }
  const p = patch as Record<string, unknown>;

  if (typeof p.type !== 'string' || !VALID_PATCH_TYPES.has(p.type)) {
    return {
      error: `patch[${index}]: invalid or missing 'type'. Expected one of the NodeSpec patch operation types (e.g. add_node, add_edge, add_contract, add_artifact).`,
    };
  }

  if (!p.payload || typeof p.payload !== 'object' || Array.isArray(p.payload)) {
    return { error: `patch[${index}] (${p.type}): missing 'payload' object` };
  }

  const rawMeta = (p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata))
    ? p.metadata as Record<string, unknown>
    : {};

  const metadata: Record<string, unknown> = {
    ...rawMeta,
    id: typeof rawMeta.id === 'string' && UUID_RE.test(rawMeta.id) ? rawMeta.id : crypto.randomUUID(),
    actorType: rawMeta.actorType === 'human' || rawMeta.actorType === 'ai' || rawMeta.actorType === 'system'
      ? rawMeta.actorType
      : 'ai',
    actorId: typeof rawMeta.actorId === 'string' ? rawMeta.actorId : externalAgent,
    summary: typeof rawMeta.summary === 'string' && rawMeta.summary.length > 0 ? rawMeta.summary : explanation,
    timestamp: typeof rawMeta.timestamp === 'string' ? rawMeta.timestamp : new Date().toISOString(),
  };

  // IP-safe catalog normalization (2026-07-15): conform node type/technology to the catalog
  // server-side BEFORE schema validation, so the external AI can propose catalog-blind and the
  // stored patch renders correctly. Deterministic; the catalog never crosses the AI boundary.
  const { payload: normalizedPayload, notes } = applyCatalogNormalization(p, catalogs);

  // P0-10: validate against the SAME schema the app enforces at approve time. Without
  // this, a malformed payload is accepted here and dies later in the approve dialog as
  // an unactionable "Patch does not match schema" — the agent must hear the field-level
  // errors NOW so it can self-correct.
  const parsed = PatchOperationSchema.safeParse({ ...p, payload: normalizedPayload, metadata });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`)
      .join('; ');
    return {
      error: `patch[${index}] (${p.type}): payload does not match the NodeSpec patch schema — ${issues}. ` +
        `Fix the named fields and resubmit; no proposal was created.`,
    };
  }

  return { patch: parsed.data as unknown as Record<string, unknown>, notes };
}

export async function handleProposePatches(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; branch_id: string; patches?: unknown[]; explanations?: string[]; external_agent?: string; content_ref?: string; proposal_id?: string; finalize?: boolean; expected_patch_count?: number }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'propose')) {
    return { success: false, error: 'Insufficient permissions: propose scope required' };
  }

  // C2 (docs/WORK_LOOP_PLAN.md): chunked sessions. finalize:false starts a
  // STAGED session (invisible to review — the same staged convention the
  // import lane uses); proposal_id appends to it; finalize:true promotes it
  // to pending. A finalize-only call may omit patches entirely.
  const isFinalizeOnly = !!args.proposal_id && args.finalize === true &&
    (args.patches === undefined || (Array.isArray(args.patches) && args.patches.length === 0));
  const patches = args.patches ?? [];

  if (!args.project_id || !args.branch_id || (!isFinalizeOnly && (!args.patches || !Array.isArray(args.patches)))) {
    return { success: false, error: 'project_id, branch_id, and patches array are required' };
  }

  if (patches.length === 0 && !isFinalizeOnly) {
    return { success: false, error: 'patches array must contain at least one patch' };
  }

  // C3: declared-intent truncation check — fail loudly BEFORE anything is
  // created, never accept a fragment as silently complete.
  if (args.expected_patch_count !== undefined) {
    if (!Number.isInteger(args.expected_patch_count) || args.expected_patch_count < 1) {
      return { success: false, error: 'expected_patch_count must be a positive integer' };
    }
    if (args.expected_patch_count !== patches.length) {
      return {
        success: false,
        error: `Truncation detected: expected_patch_count declares ${args.expected_patch_count} patch(es) but ${patches.length} arrived — ` +
          `nothing was created. Resend the full batch, or stream it as a chunked session ` +
          `(finalize: false to start, append with the returned proposal_id, finalize: true to submit).`,
      };
    }
  }

  // C3: per-call ceiling — a call this size should be a chunked session, and
  // the error names that path instead of choking downstream.
  if (patches.length > SINGLE_CALL_MAX_PATCHES) {
    return {
      success: false,
      error: `${patches.length} patches exceeds the ${SINGLE_CALL_MAX_PATCHES}-per-call limit — nothing was created. ` +
        `Stream a chunked session instead: finalize: false to start, append batches of up to ${SINGLE_CALL_MAX_PATCHES} ` +
        `with the returned proposal_id, then finalize: true (sessions hold up to ${CHUNKED_SESSION_MAX_PATCHES} patches).`,
    };
  }

  // C3: an explanations array that does not line up with patches is a cheap
  // truncation tell (a generation cut mid-stream closes arrays early) —
  // surfaced as a warning, never inferred away.
  const truncationWarnings: string[] = [];
  if (args.explanations !== undefined && patches.length > 0 && args.explanations.length !== patches.length) {
    truncationWarnings.push(
      `explanations has ${args.explanations.length} entr(ies) for ${patches.length} patch(es) — if your call was cut ` +
        `short mid-generation, verify patchCountThisCall matches what you intended before the user accepts.`,
    );
  }

  // C1: content_ref is a git ref (commit sha preferred — it pins the bytes; a
  // branch name is accepted but moves). Shape-checked here so a typo fails the
  // call, not the user's accept click later.
  const contentRef = typeof args.content_ref === 'string' ? args.content_ref.trim() : undefined;
  if (args.content_ref !== undefined && (!contentRef || contentRef.length > 200 || /\s/.test(contentRef))) {
    return { success: false, error: 'content_ref must be a single git ref (commit sha or branch name) with no whitespace' };
  }

  const externalAgent = args.external_agent || 'external-mcp-agent';

  // Load the catalog once for the whole batch (server-side; never sent to the AI). A load
  // failure degrades to no normalization rather than failing the propose.
  let catalogs: CatalogData | null = null;
  try {
    const loaded = await loadCatalogs(supabase);
    // An empty catalog (load failure, or a stack that returned no roles) disables
    // normalization cleanly rather than defaulting every node to the global generic.
    if (loaded && Object.keys(loaded.nodeRoles).length > 0) catalogs = loaded;
  } catch (e) {
    console.warn('[propose_patches] catalog load failed; proceeding without node normalization:', e);
  }

  const validationErrors: string[] = [];
  const normalizedPatches: Record<string, unknown>[] = [];
  const normalizationNotes: Array<{ patchIndex: number; field: string; from: string; to: string; reason: string }> = [];
  let contentByReferenceCount = 0;
  for (let i = 0; i < patches.length; i++) {
    const explanation = args.explanations?.[i] || 'No explanation provided';
    // C1: stamp content-by-reference before schema validation (the sentinel is
    // a plain string, so the stamped patch validates like any content-ful one).
    const prepared = applyContentByReference(patches[i], contentRef, i);
    if ('error' in prepared) {
      validationErrors.push(prepared.error);
      continue;
    }
    if (prepared.stamped) contentByReferenceCount++;
    const result = validateAndNormalizeProposalPatch(prepared.patch, i, explanation, externalAgent, catalogs);
    if ('error' in result) {
      validationErrors.push(result.error);
    } else {
      normalizedPatches.push(result.patch);
      for (const n of result.notes) normalizationNotes.push({ patchIndex: i, ...n });
    }
  }

  if (validationErrors.length > 0) {
    return {
      success: false,
      error: `Invalid patches (${validationErrors.length}): ${validationErrors.join('; ')}`,
    };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', args.branch_id)
    .eq('project_id', projectId)
    .maybeSingle();

  if (!branch) {
    return { success: false, error: 'Branch not found' };
  }

  // C1: bindings-only artifacts are only honest if someone can actually pull
  // the bytes at accept — refuse BEFORE any insert when no repo is connected,
  // naming both fixes.
  if (contentByReferenceCount > 0) {
    const { data: integration } = await supabase
      .from('git_integrations')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle();
    if (!integration) {
      return {
        success: false,
        error: `content_ref was provided for ${contentByReferenceCount} artifact(s) but this project has no git integration — ` +
          `connect the repository in NodeSpec's Git panel, or include the artifact content inline`,
      };
    }
  }

  // C2: session continuation — append to (and/or finalize) an existing
  // chunked draft. One UPDATE; no extra ai_runs row (the session's run was
  // created when it started).
  if (args.proposal_id) {
    const { data: sessRow } = await supabase
      .from('ai_proposals')
      .select('id, status, patches, metadata, source_branch_id')
      .eq('id', args.proposal_id)
      .maybeSingle();
    // The branch was already verified to belong to the caller's project, so
    // requiring the session to sit on that same branch closes ownership.
    if (!sessRow || (sessRow as { source_branch_id: string }).source_branch_id !== args.branch_id) {
      return { success: false, error: 'Proposal session not found on this branch' };
    }
    const sess = sessRow as { id: string; status: string; patches: unknown[]; metadata: Record<string, unknown> };
    // deno-lint-ignore no-explicit-any
    const chunked = (sess.metadata?.chunkedSession ?? null) as any;
    if (sess.status !== 'staged') {
      return {
        success: false,
        error: `Proposal session is '${sess.status}', not 'staged' — it was already finalized. Start a new session (finalize: false) for further changes.`,
      };
    }
    if (!chunked) {
      return { success: false, error: 'That staged proposal is not a chunked session (it belongs to the import lane) — it cannot be appended to or finalized here.' };
    }
    if (typeof chunked.expiresAt === 'string' && Date.parse(chunked.expiresAt) < Date.now()) {
      // Lazy expiry: discard the stale draft so it cannot linger invisible.
      try {
        await supabase.from('ai_proposals').delete().eq('id', sess.id).eq('status', 'staged');
      } catch (_delErr) { /* cleanup is best-effort */ }
      return {
        success: false,
        error: `Proposal session expired (no activity before ${chunked.expiresAt}) and was discarded — resubmit from the start with finalize: false.`,
      };
    }

    const appendedEntries = normalizedPatches.map((patch, index) => ({
      patch,
      explanation: args.explanations?.[index] || 'No explanation provided',
      status: 'pending',
    }));
    const combined = [...(sess.patches ?? []), ...appendedEntries];
    if (combined.length > CHUNKED_SESSION_MAX_PATCHES) {
      return { success: false, error: `Session would hold ${combined.length} patches, over the ${CHUNKED_SESSION_MAX_PATCHES} cap — finalize what is staged or split the work.` };
    }
    const finalizing = args.finalize === true;
    const expiresAt = new Date(Date.now() + CHUNKED_SESSION_TTL_MS).toISOString();
    const { error: updateError } = await supabase
      .from('ai_proposals')
      .update({
        patches: combined,
        ...(finalizing ? { status: 'pending' } : {}),
        metadata: {
          ...sess.metadata,
          chunkedSession: {
            ...chunked,
            calls: (typeof chunked.calls === 'number' ? chunked.calls : 1) + 1,
            // Sliding window: every append buys the session another interval.
            expiresAt,
            ...(finalizing ? { finalizedAt: new Date().toISOString() } : {}),
          },
        },
      })
      .eq('id', sess.id)
      .eq('status', 'staged');
    if (updateError) {
      return { success: false, error: `Failed to update session: ${updateError.message}` };
    }

    return {
      success: true,
      data: {
        proposalId: sess.id,
        status: finalizing ? 'pending' : 'staged',
        // C3 groundwork: every chunked response states what THIS call added
        // and what the session now holds — a truncated batch is visible.
        patchCountThisCall: normalizedPatches.length,
        sessionPatchCount: combined.length,
        ...(finalizing
          ? {
              message: `Session finalized with ${combined.length} patch(es) — now pending user review as ONE proposal.`,
              nextAction: 'Poll get_proposal_status with the proposalId to check acceptance.',
              ifTruncated: 'If sessionPatchCount is lower than you intended, the finalized proposal is a FRAGMENT — ask the user to decline it and restart a session (finalize: false).',
            }
          : {
              message: `Appended ${normalizedPatches.length} patch(es); session holds ${combined.length}.`,
              nextAction: `Append more with proposal_id, or pass finalize: true to submit for review. Session expires ${expiresAt} without activity.`,
              expiresAt,
              ifTruncated: `If fewer patches arrived this call than you sent, the session is still open — append the missing ones with proposal_id: "${sess.id}" before finalizing.`,
            }),
        ...(truncationWarnings.length > 0 ? { warnings: truncationWarnings } : {}),
        ...(contentByReferenceCount > 0
          ? { contentByReference: { count: contentByReferenceCount, ref: contentRef } }
          : {}),
        normalizations: normalizationNotes,
      },
    };
  }

  // C2: session start — a staged draft, invisible to review until finalized.
  const isChunkedStart = args.finalize === false;
  if (isChunkedStart) {
    // Opportunistic hygiene: expired chunked drafts on this branch are dead
    // weight nobody can see — clear them while we are here. Best-effort.
    try {
      await supabase
        .from('ai_proposals')
        .delete()
        .eq('source_branch_id', args.branch_id)
        .eq('status', 'staged')
        .lt('metadata->chunkedSession->>expiresAt', new Date().toISOString());
    } catch (_cleanupErr) { /* never blocks the propose */ }
  }

  const aiRunId = crypto.randomUUID();
  const { error: runError } = await supabase
    .from('ai_runs')
    .insert({
      id: aiRunId,
      project_id: projectId,
      branch_id: args.branch_id,
      model: externalAgent,
      prompt_hash: 'mcp-proposal',
      status: 'completed',
      completed_at: new Date().toISOString(),
      metadata: {
        source: 'mcp-server',
        externalAgent: args.external_agent || 'unknown',
        patchCount: patches.length,
        authMethod: auth.authMethod,
        apiKeyId: auth.keyId || null,
      },
    });

  if (runError) {
    return { success: false, error: `Failed to create AI run: ${runError.message}` };
  }

  // Bugfix (2026-07-14): previously this minted a real `mcp-proposal/<run>` branch on
  // every proposal purely to satisfy the NOT-NULL `proposal_branch_id` FK — but nothing
  // ever populated it with a graph snapshot or read it back. The result was dangling
  // empty branches that cluttered the branch switcher and, when clicked, silently landed
  // the user on the new-project onboarding screen (no snapshot to load). The in-app
  // proposal path never created a branch either; it points proposal_branch_id at the
  // source branch. Match that: the proposal's patches live in `patches` (JSON) and are
  // applied to the source branch on approval, so a distinct branch was never needed.
  const proposalBranchId = args.branch_id;

  const proposalPatches = normalizedPatches.map((patch, index) => ({
    patch,
    explanation: args.explanations?.[index] || 'No explanation provided',
    status: 'pending',
  }));

  const sessionExpiresAt = new Date(Date.now() + CHUNKED_SESSION_TTL_MS).toISOString();
  const proposalId = crypto.randomUUID();
  const { error: proposalError } = await supabase
    .from('ai_proposals')
    .insert({
      id: proposalId,
      ai_run_id: aiRunId,
      source_branch_id: args.branch_id,
      proposal_branch_id: proposalBranchId,
      status: isChunkedStart ? 'staged' : 'pending',
      patches: proposalPatches,
      validation_expectations: [],
      metadata: {
        source: 'mcp-server',
        externalAgent: args.external_agent || 'unknown',
        authMethod: auth.authMethod,
        apiKeyId: auth.keyId || null,
        normalizations: normalizationNotes,
        ...(isChunkedStart
          ? { chunkedSession: { startedAt: new Date().toISOString(), calls: 1, expiresAt: sessionExpiresAt } }
          : {}),
      },
    });

  if (proposalError) {
    return { success: false, error: `Failed to create proposal: ${proposalError.message}` };
  }

  return {
    success: true,
    data: {
      proposalId,
      aiRunId,
      proposalBranchId,
      patchCount: patches.length,
      status: isChunkedStart ? 'staged' : 'pending',
      // C3: every response states exactly what arrived this call.
      patchCountThisCall: patches.length,
      ...(isChunkedStart ? { sessionPatchCount: patches.length, expiresAt: sessionExpiresAt } : {}),
      message: (isChunkedStart
        ? `Chunked session started with ${patches.length} patch(es) — INVISIBLE to review until finalized.`
        : `Proposal created successfully with ${patches.length} patch(es). Review and accept/reject patches in NodeSpec UI.`)
        + (contentByReferenceCount > 0
          ? ` ${contentByReferenceCount} artifact(s) are bindings-only: their content will be pulled from git at ref "${contentRef}" when the user accepts — make sure that commit is pushed and reachable.`
          : ''),
      nextAction: isChunkedStart
        ? `Append further batches with proposal_id: "${proposalId}", then pass finalize: true on the last call (patches optional). Session expires ${sessionExpiresAt} without activity.`
        : 'Poll get_proposal_status with the proposalId to check acceptance. After patches are accepted, call get_project_status to see what is needed next.',
      // C3: never accept a fragment as silently complete — the recovery path
      // rides every response.
      ifTruncated: isChunkedStart
        ? `If fewer patches arrived than you sent, the session is still open — append the missing ones with proposal_id: "${proposalId}" before finalizing.`
        : 'If patchCountThisCall is lower than you intended, this proposal is a FRAGMENT — ask the user to decline it, then resubmit as a chunked session (finalize: false → append with proposal_id → finalize: true), or resend with expected_patch_count so a short delivery fails loudly.',
      ...(truncationWarnings.length > 0 ? { warnings: truncationWarnings } : {}),
      // C1 transparency: how many artifacts ride as bindings-only, and at what ref.
      ...(contentByReferenceCount > 0
        ? { contentByReference: { count: contentByReferenceCount, ref: contentRef } }
        : {}),
      // Transparency: which proposed node type/technology values the server conformed to the
      // catalog (so the AI can learn the house vocabulary). Empty when nothing was changed.
      normalizations: normalizationNotes,
    },
  };
}

export async function handleGetProposalStatus(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { proposal_id: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  if (!args.proposal_id) {
    return { success: false, error: 'proposal_id is required' };
  }

  const { data: ownerCheck, error: ownerError } = await supabase
    .from('ai_proposals')
    .select(`
      id,
      source_branch_id,
      branches!ai_proposals_source_branch_id_fkey (
        project_id,
        projects!branches_project_id_fkey (
          owner_id
        )
      )
    `)
    .eq('id', args.proposal_id)
    .maybeSingle();

  if (ownerError || !ownerCheck) {
    return { success: false, error: 'Proposal not found' };
  }

  const projectOwnerId = (ownerCheck.branches as { projects: { owner_id: string } })?.projects?.owner_id;
  if (projectOwnerId !== auth.userId) {
    return { success: false, error: 'Proposal not found or access denied' };
  }

  const { data: proposal, error } = await supabase
    .from('ai_proposals')
    .select('id, status, patches, created_at, reviewed_at, merged_at')
    .eq('id', args.proposal_id)
    .maybeSingle();

  if (error || !proposal) {
    return { success: false, error: 'Proposal not found' };
  }

  const patches = proposal.patches as Array<{ patch: unknown; explanation: string; status: string }>;
  const patchSummary = {
    total: patches.length,
    pending: patches.filter(p => p.status === 'pending').length,
    approved: patches.filter(p => p.status === 'approved').length,
    rejected: patches.filter(p => p.status === 'rejected').length,
    merged: patches.filter(p => p.status === 'merged').length,
    conflicted: patches.filter(p => p.status === 'conflicted').length,
  };

  return {
    success: true,
    data: {
      proposalId: proposal.id,
      status: proposal.status,
      patchSummary,
      createdAt: proposal.created_at,
      reviewedAt: proposal.reviewed_at,
      mergedAt: proposal.merged_at,
      patches: patches.map((p, i) => ({
        index: i,
        status: p.status,
        explanation: p.explanation,
      })),
    },
  };
}

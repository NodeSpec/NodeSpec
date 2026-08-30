// S1-3: the `git` tool bucket — get_pending_changes (read) and resolve_change. Moved
// verbatim from index.ts (no logic change). resolve_change reconciles an accepted git
// change by submitting its patches through the proposals bucket — so this module imports
// handleProposePatches from ./proposals.ts (the cross-bucket dependency the split makes
// explicit). Structural supabase param + type-only SupabaseClient so it's offline-testable.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName } from "../shared.ts";
import { handleProposePatches } from "./proposals.ts";
import { runDriftSweep, applyCriterionDeltas } from "../../_shared/git-drift.ts";
import { applyTaskDeltas } from "../../_shared/task-deltas.ts";

export async function handleGetPendingChanges(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  // P1-7 R2: on-connect drift sweep — the AI's first look at pending changes IS the connect
  // moment, so detect out-of-band commits right now (webhook-independent; 60s-throttled inside;
  // never blocks the read).
  let sweep: { status: string } | undefined;
  try {
    sweep = await runDriftSweep(supabase, projectId);
  } catch (_swErr) { /* sweep must never break reads */ }

  const { data: events, error } = await supabase
    .from('git_change_events')
    .select('id, commit_sha, commit_message, author, changed_files, status, metadata, created_at')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: {
      pendingChanges: (events || []).map((e: any) => ({
        changeEventId: e.id,
        commitSha: e.commit_sha,
        commitMessage: e.commit_message,
        author: e.author,
        changedFiles: e.changed_files,
        branch: e.metadata?.branch,
        source: e.metadata?.source ?? 'webhook',
        branchName: e.metadata?.branchName ?? 'main',
        baseSha: e.metadata?.baseSha,
        modelChanged: e.metadata?.modelChanged ?? false,
        residuePaths: e.metadata?.residuePaths ?? [],
        ignoredResidue: e.metadata?.ignoredResidue ?? [],
        artifactMatches: e.metadata?.artifactMatches ?? [],
        // A5 (docs/WORK_LOOP_PLAN.md): completion provenance is VISIBLE over
        // MCP — checkbox ticks the card carries (criteria + anchored tasks)
        // and the applied stamps, so the AI can see what a resolve with
        // apply_ticks would flip and whether it already happened.
        ...(e.metadata?.criterionDeltas ? { criterionDeltas: e.metadata.criterionDeltas } : {}),
        ...(e.metadata?.taskDeltas ? { taskDeltas: e.metadata.taskDeltas } : {}),
        ...(e.metadata?.criteriaApplied ? { criteriaApplied: e.metadata.criteriaApplied } : {}),
        ...(e.metadata?.ticksApplied ? { ticksApplied: e.metadata.ticksApplied } : {}),
        // B3: resolved .nodespec/bindings.json declarations — which new files
        // the AI attributed, which failed to resolve (bind via resolve_change
        // patches, or let the app's auto-sync bind them).
        ...(e.metadata?.bindingResolution ? { bindingResolution: e.metadata.bindingResolution } : {}),
        createdAt: e.created_at,
      })),
      totalPending: (events || []).length,
      driftSweep: sweep,
    },
  };
}

export async function handleResolveChange(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { change_event_id: string; resolution: 'accepted' | 'dismissed'; patches?: unknown[]; apply_ticks?: boolean }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'write')) {
    return { success: false, error: 'Insufficient permissions: write scope required' };
  }

  if (!args.change_event_id || !args.resolution) {
    return { success: false, error: 'change_event_id and resolution are required' };
  }

  if (!['accepted', 'dismissed'].includes(args.resolution)) {
    return { success: false, error: 'resolution must be "accepted" or "dismissed"' };
  }

  const { data: event, error: fetchError } = await supabase
    .from('git_change_events')
    .select('id, project_id, status, commit_sha, metadata, projects!git_change_events_project_id_fkey(owner_id)')
    .eq('id', args.change_event_id)
    .maybeSingle();

  if (fetchError || !event) {
    return { success: false, error: 'Change event not found' };
  }

  const eventOwnerId = (event.projects as { owner_id: string } | null)?.owner_id;
  if (eventOwnerId !== auth.userId) {
    return { success: false, error: 'Change event not found or access denied' };
  }

  if (event.status !== 'pending') {
    return { success: false, error: `Change event already resolved with status: ${event.status}` };
  }

  // A5 (docs/WORK_LOOP_PLAN.md): apply the card's checkbox ticks in-band.
  // ACCEPTED only — a dismissed card must never write evidence. Both lanes
  // are tick-only and double-apply-guarded (the applied stamps below plus
  // the natural idempotency of already-met/already-done skips), and both
  // run BEFORE the status flip so a failure leaves the card pending and
  // retryable rather than resolved-with-lost-ticks.
  // deno-lint-ignore no-explicit-any
  const cardMeta = (event.metadata ?? {}) as Record<string, any>;
  let ticksSummary: { criteriaApplied: number; tasksApplied: number } | null = null;
  if (args.apply_ticks === true && args.resolution === 'accepted') {
    const hasCriterionDeltas = cardMeta.criterionDeltas && Array.isArray(cardMeta.criterionDeltas.deltas);
    const hasTaskDeltas = cardMeta.taskDeltas && Array.isArray(cardMeta.taskDeltas.deltas);
    if (!hasCriterionDeltas && !hasTaskDeltas) {
      return { success: false, error: 'apply_ticks requested but this change carries no criterion or task deltas' };
    }
    try {
      const criteriaResult = hasCriterionDeltas && !cardMeta.criteriaApplied
        ? await applyCriterionDeltas(supabase, event.project_id, {
            deltas: cardMeta.criterionDeltas,
            commitSha: event.commit_sha ?? undefined,
          })
        : { applied: 0 };
      const taskResult = hasTaskDeltas && !cardMeta.ticksApplied
        ? await applyTaskDeltas(supabase, event.project_id, {
            deltas: cardMeta.taskDeltas,
            commitSha: event.commit_sha ?? undefined,
            source: 'git',
          })
        : { applied: 0 };
      ticksSummary = { criteriaApplied: criteriaResult.applied, tasksApplied: taskResult.applied };
    } catch (applyErr) {
      return { success: false, error: `Tick apply failed (card left pending): ${applyErr instanceof Error ? applyErr.message : String(applyErr)}` };
    }
  }

  const { error: updateError } = await supabase
    .from('git_change_events')
    .update({
      status: args.resolution,
      resolved_by: auth.userId,
      resolved_at: new Date().toISOString(),
      // The applied stamps fold into the SAME write that resolves the card.
      ...(ticksSummary
        ? {
            metadata: {
              ...cardMeta,
              ...(cardMeta.criterionDeltas && !cardMeta.criteriaApplied
                ? { criteriaApplied: { at: new Date().toISOString(), count: ticksSummary.criteriaApplied } }
                : {}),
              ...(cardMeta.taskDeltas && !cardMeta.ticksApplied
                ? { ticksApplied: { at: new Date().toISOString(), count: ticksSummary.tasksApplied } }
                : {}),
            },
          }
        : {}),
    })
    .eq('id', args.change_event_id);

  if (updateError) {
    return { success: false, error: `Failed to resolve: ${updateError.message}` };
  }

  // P1-7 R2: advance the drift baseline on resolution — accept AND dismiss (dismiss =
  // "acknowledged, don't re-flag"; without this every sweep re-detects the same range forever).
  // Debt-audit fix (2026-07-29): this lane was hardcoded to main and ignored the card's
  // metadata — the SAME baseline-corruption bug class R3-3c fixed client-side. It now
  // mirrors GitService.resolveChangeEvent exactly: advance the branch the card BELONGS
  // to; never advance for ref-deleted lifecycle cards, dismissed connect-anchor-mismatch
  // cards (would disarm the push guard), the legacy 'unknown' sha sentinel, or webhook
  // cards for refs no NodeSpec branch is bound to.
  // deno-lint-ignore no-explicit-any
  const eventMeta = (event.metadata ?? {}) as Record<string, any>;
  const cardSource = eventMeta.source as string | undefined;
  const cardBranchName = (eventMeta.branchName as string | undefined) ?? 'main';
  const skipBaseline =
    cardSource === 'ref-deleted' ||
    (cardSource === 'connect-anchor-mismatch' && args.resolution === 'dismissed') ||
    event.commit_sha === 'unknown' ||
    (!eventMeta.branchName && !!eventMeta.unmappedRef);
  if (event.commit_sha && !skipBaseline) {
    const { error: baselineErr } = await supabase
      .from('branches')
      .update({ last_synced_commit: event.commit_sha })
      .eq('project_id', event.project_id)
      .eq('name', cardBranchName);
    if (baselineErr) console.warn(`[resolve_change] baseline advance failed: ${baselineErr.message}`);
  }

  let proposalId: string | null = null;
  if (args.resolution === 'accepted' && args.patches && Array.isArray(args.patches) && args.patches.length > 0) {
    // Reconciliation patches land on the branch the card belongs to, not blindly main.
    const { data: branches } = await supabase
      .from('branches')
      .select('id')
      .eq('project_id', event.project_id)
      .eq('name', cardBranchName)
      .maybeSingle();

    if (branches) {
      const result = await handleProposePatches(supabase, auth, {
        project_id: event.project_id,
        branch_id: branches.id,
        patches: args.patches,
        explanations: args.patches.map(() => 'Reconciled from external git change'),
        external_agent: 'git-reconciliation',
      });
      if (result.success && result.data) {
        proposalId = (result.data as any).proposalId;
      }
    }
  }

  return {
    success: true,
    data: {
      changeEventId: args.change_event_id,
      resolution: args.resolution,
      proposalId,
      ...(ticksSummary ? ticksSummary : {}),
      message: args.resolution === 'accepted'
        ? 'Change accepted' + (proposalId ? '. Patches submitted as proposal.' : '.')
          + (ticksSummary ? ` Applied ${ticksSummary.criteriaApplied} criterion tick(s) and ${ticksSummary.tasksApplied} task tick(s) with git provenance.` : '')
        : 'Change dismissed.',
    },
  };
}

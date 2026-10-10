// S1-3: the `git` tool bucket — get_pending_changes (read) and resolve_change. Moved
// verbatim from index.ts (no logic change). resolve_change reconciles an accepted git
// change by submitting its patches through the proposals bucket — so this module imports
// handleProposePatches from ./proposals.ts (the cross-bucket dependency the split makes
// explicit). Structural supabase param + type-only SupabaseClient so it's offline-testable.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { collisionsBetween, type LeaseCollision } from '../../_shared/lease-collisions.ts';
import { credentialLabel } from '../shared.ts';
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, memberRoleFor, roleAtLeast } from "../shared.ts";
import { handleProposePatches } from "./proposals.ts";
import { runDriftSweep } from "../../_shared/git-drift.ts";
import { projectAncestry, baselineOutcomeNote } from "../../_shared/baseline.ts";
import { resolveCard, unappliedTicks, ticksPhrase } from "../../_shared/card-resolve.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";
import { applyTaskDeltas } from "../../_shared/task-deltas.ts";
import { loadAutomationPolicy } from "./change-router.ts";
import { loadReconcilePacket } from "./reconcile.ts";
import { getProjectTier } from "../../_shared/deployment.ts";
import { featureAllowed } from "../../_shared/feature-rules.ts";

/** One card as get_pending_changes lists it. */
// deno-lint-ignore no-explicit-any
export function cardView(e: any, primaryName: string | null, collisions?: LeaseCollision[]) {
  return {
    changeEventId: e.id,
    ...(collisions && collisions.length > 0 ? { touchesHeldWork: collisions } : {}),
    commitSha: e.commit_sha,
    commitMessage: e.commit_message,
    author: e.author,
    changedFiles: e.changed_files,
    // AD.3: the files grouped by the author of the commits that changed them.
    ...(Array.isArray(e.metadata?.authors) ? { authors: e.metadata.authors } : {}),
    branch: e.metadata?.branch,
    source: e.metadata?.source ?? 'webhook',
    branchName: e.metadata?.branchName ?? (e.metadata?.unmappedRef ? null : primaryName),
    baseSha: e.metadata?.baseSha,
    modelChanged: e.metadata?.modelChanged ?? false,
    residuePaths: e.metadata?.residuePaths ?? [],
    ignoredResidue: e.metadata?.ignoredResidue ?? [],
    artifactMatches: e.metadata?.artifactMatches ?? [],
    // A5 (docs/WORK_LOOP_PLAN.md): completion provenance is VISIBLE over
    // MCP: checkbox ticks the card carries (criteria + anchored tasks)
    // and the applied stamps, so the AI can see what a resolve with
    // apply_ticks would flip and whether it already happened.
    ...(e.metadata?.criterionDeltas ? { criterionDeltas: e.metadata.criterionDeltas } : {}),
    ...(e.metadata?.taskDeltas ? { taskDeltas: e.metadata.taskDeltas } : {}),
    ...(e.metadata?.criteriaApplied ? { criteriaApplied: e.metadata.criteriaApplied } : {}),
    ...(e.metadata?.ticksApplied ? { ticksApplied: e.metadata.ticksApplied } : {}),
    // B3: resolved .nodespec/bindings.json declarations: which new files
    // the AI attributed, which failed to resolve (bind via resolve_change
    // patches, or let the app's auto-sync bind them).
    ...(e.metadata?.bindingResolution ? { bindingResolution: e.metadata.bindingResolution } : {}),
    // AD.1d: a proposal filed to reconcile this change; the change
    // resolves when a person accepts it.
    ...(e.metadata?.reconcileProposalId ? { reconcileProposalId: e.metadata.reconcileProposalId } : {}),
    createdAt: e.created_at,
  };
}

export async function handleGetPendingChanges(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; change_event_id?: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  // R.1b: one card's reconcile packet. No sweep: the card is read as filed,
  // and resolve_change guards on the commitSha returned here.
  if (args.change_event_id !== undefined) {
    if (typeof args.change_event_id !== 'string' || !args.change_event_id.trim()) {
      return { success: false, error: 'change_event_id must be a change card id from get_pending_changes' };
    }
    let repoImport = false;
    try { repoImport = featureAllowed(await getProjectTier(supabase, projectId, auth.userId, { role: resolved.project.role }), 'repo_import'); } catch { /* fail closed */ }
    const loaded = await loadReconcilePacket(supabase, auth, projectId, args.change_event_id.trim(), { repoImport });
    if ('error' in loaded) return { success: false, error: loaded.error };
    const primary = loaded.packet.branchName ?? null;
    const collisions = await heldWorkCollisions(supabase, projectId, [loaded.event as never]);
    return { success: true, data: { change: cardView(loaded.event, primary, collisions), reconcile: loaded.packet } };
  }

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

  // AD.3: the branch the sync check reads, so an agent commits where its work
  // is seen (and its evidence counts). Best effort: a read failure omits it.
  let trackedBranch: string | null = null;
  // AD.4 (D15): a card from before R3-3c names no branch; it is the primary's,
  // named by its row, never by the literal 'main'.
  let primaryName: string | null = null;
  try {
    const { data: integ } = await supabase
      .from('git_integrations').select('default_branch').eq('project_id', projectId).maybeSingle();
    if (integ) {
      const primary = await getPrimaryBranch(supabase, projectId, 'id, name, git_ref, is_primary');
      primaryName = (primary?.name as string | null) ?? null;
      trackedBranch = (primary?.git_ref as string | null) || (integ.default_branch as string | null) || null;
    }
  } catch (_err) { /* optional */ }

  // 4b.5 (R8): git reality vs the lease board — which pending commits
  // touched files bound to work someone holds. Best effort, read-time.
  const collisions = await heldWorkCollisions(supabase, projectId, (events || []) as Array<{ id: string; commit_sha: string | null; author: string | null; changed_files: unknown; metadata?: Record<string, unknown> | null }>);
  const collisionsByEvent = new Map<string, LeaseCollision[]>();
  for (const c of collisions) collisionsByEvent.set(c.changeEventId, [...(collisionsByEvent.get(c.changeEventId) ?? []), c]);

  return {
    success: true,
    data: {
      pendingChanges: (events || []).map((e: any) => cardView(e, primaryName, collisionsByEvent.get(e.id))),
      totalPending: (events || []).length,
      ...(trackedBranch ? { trackedBranch } : {}),
      heldWorkCollisions: collisions.length,
      driftSweep: sweep,
    },
  };
}

/** Pending changes × active exclusive leases, joined through the artifacts
 *  bound to each lease's node (task) or artifact (code). Empty on any read
 *  failure — a warning surface never breaks the read it rides on. */
export async function heldWorkCollisions(
  supabase: SupabaseClient,
  projectId: string,
  events: Array<{ id: string; commit_sha: string | null; author: string | null; changed_files: unknown; metadata?: Record<string, unknown> | null }>,
): Promise<LeaseCollision[]> {
  if (events.length === 0) return [];
  try {
    const { data: leaseRows } = await supabase
      .from('agent_checkouts')
      .select('id, level, holder_label, holder_key_id, holder_delegate, task_item_id, artifact_id, node_id, meta')
      .eq('project_id', projectId)
      .in('level', ['task', 'code', 'node'])
      .is('released_at', null);
    const leases = (leaseRows ?? []) as Array<{ id: string; level: string; holder_label: string; holder_key_id: string | null; holder_delegate: string | null; task_item_id: string | null; artifact_id: string | null; node_id?: string | null; meta?: Record<string, unknown> | null }>;
    if (leases.length === 0) return [];
    const taskIds = leases.map((l) => l.task_item_id).filter(Boolean) as string[];
    const tasks: Array<{ id: string; node_id: string | null; display_id: string | null; title: string | null }> = [];
    if (taskIds.length > 0) {
      const { data } = await supabase.from('task_items').select('id, node_id, display_id, title').in('id', taskIds);
      tasks.push(...((data ?? []) as typeof tasks));
    }
    // AA.5: a node lease holds every file bound to its node.
    const nodeIds = [...new Set([...tasks.map((t) => t.node_id), ...leases.filter((l) => l.level === 'node').map((l) => l.node_id)].filter(Boolean))] as string[];
    const artifactIds = leases.map((l) => l.artifact_id).filter(Boolean) as string[];
    const artifacts: Array<{ id: string; node_id: string | null; path: string | null }> = [];
    if (nodeIds.length > 0) {
      const { data } = await supabase.from('artifacts').select('id, node_id, path').eq('project_id', projectId).in('node_id', nodeIds);
      artifacts.push(...((data ?? []) as typeof artifacts));
    }
    if (artifactIds.length > 0) {
      const { data } = await supabase.from('artifacts').select('id, node_id, path').in('id', artifactIds);
      for (const a of (data ?? []) as typeof artifacts) if (!artifacts.some((x) => x.id === a.id)) artifacts.push(a);
    }
    const keyIds = [...new Set(leases.map((l) => l.holder_key_id).filter(Boolean))] as string[];
    const keyNames = new Map<string, string>();
    if (keyIds.length > 0) {
      const { data } = await supabase.from('mcp_api_keys').select('id, name').in('id', keyIds);
      for (const k of (data ?? []) as Array<{ id: string; name: string | null }>) if (k.name) keyNames.set(k.id, k.name);
    }
    return collisionsBetween(
      events.map((e) => ({
        changeEventId: e.id, commitSha: e.commit_sha, author: e.author,
        changedFiles: Array.isArray(e.changed_files) ? e.changed_files as Array<{ path?: unknown } | string> : null,
        authors: Array.isArray(e.metadata?.authors) ? e.metadata!.authors as Array<{ author: string; commits: string[]; files: string[] }> : null,
      })),
      leases.map((l) => ({ ...l, credential: credentialLabel(l.holder_delegate ?? (l.holder_key_id ? `key:${l.holder_key_id}` : null), keyNames) })),
      tasks,
      artifacts,
    );
  } catch (_err) {
    return [];
  }
}

export async function handleResolveChange(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { change_event_id: string; commit_sha?: string; resolution: 'accepted' | 'dismissed'; patches?: unknown[]; intents?: unknown[]; apply_ticks?: boolean }
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
  if (args.intents !== undefined && !Array.isArray(args.intents)) {
    return { success: false, error: 'intents must be an array of { kind, ... } objects' };
  }
  const ownPatches = Array.isArray(args.patches) ? args.patches : [];
  const intents = Array.isArray(args.intents) ? args.intents : [];

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
    // 7.0: not the owner — resolving a change is a contributor's write.
    const seat = await memberRoleFor(supabase, event.project_id as string, auth.userId);
    if (!roleAtLeast(seat, 'contributor')) {
      return { success: false, error: 'Change event not found or access denied' };
    }
  }

  if (event.status !== 'pending') {
    return { success: false, error: `Change event already resolved with status: ${event.status}` };
  }

  // AD.1 (D8): the card resolves only as the version the agent read. The sync
  // check rewrites a pending card in place as commits arrive; resolving a
  // card read before that would move the baseline past commits nobody saw.
  if (!args.commit_sha) {
    return { success: false, error: 'commit_sha is required: pass the card\'s commitSha as get_pending_changes returned it' };
  }
  if (event.commit_sha !== args.commit_sha) {
    return { success: false, error: 'This change has moved on since you read it: new commits arrived and the card now covers them. Call get_pending_changes again and review what it holds now.' };
  }

  // deno-lint-ignore no-explicit-any
  const cardMeta = (event.metadata ?? {}) as Record<string, any>;

  // AD.1d (D8): a proposal already filed to reconcile this change decides it.
  // The change resolves, and the last sync moves, when a person accepts it.
  if (typeof cardMeta.reconcileProposalId === 'string' && cardMeta.reconcileProposalId) {
    const { data: waiting } = await supabase
      .from('ai_proposals').select('status').eq('id', cardMeta.reconcileProposalId).maybeSingle();
    if (waiting && (waiting.status === 'pending' || waiting.status === 'staged')) {
      return {
        success: false,
        error: `Proposal ${cardMeta.reconcileProposalId} reconciling this change is waiting for review; the change resolves when a person accepts it. Leave the change as it is.`,
      };
    }
  }

  // AD.3 (ruling 3, D19): ticks split by kind. A criterion tick is applied
  // only by a person, in the Git panel, at every Autonomy setting: over MCP it
  // stays on the card and the change stays pending for that person. A task
  // tick follows the Tasks setting: Ask first refuses it, Propose leaves it on
  // the card, Auto-apply applies it with the accept (apply_ticks: true).
  // AD.1d (D6) stands: ticks are never dropped, so a change keeping ticks
  // stays pending; a person may still dismiss it.
  const pendingTicks = unappliedTicks(cardMeta);
  let applyTaskTicks = false;
  let tasksWaitForPerson = false;
  if (args.resolution === 'accepted' && pendingTicks.tasks > 0) {
    const tasksLevel = (await loadAutomationPolicy(supabase, event.project_id as string)).tasks;
    if (tasksLevel === 0) {
      return {
        success: false,
        error: `This change carries ${ticksPhrase({ criteria: 0, tasks: pendingTicks.tasks })}, and the Tasks setting is Ask first: a person applies them. Leave the change for a person.`,
      };
    }
    if (tasksLevel === 2 && args.apply_ticks !== true) {
      return {
        success: false,
        error: `This change carries ${ticksPhrase({ criteria: 0, tasks: pendingTicks.tasks })}. Pass apply_ticks: true to apply them with the accept, or leave the change for a person.`,
      };
    }
    applyTaskTicks = tasksLevel === 2;
    tasksWaitForPerson = tasksLevel === 1;
  }
  if (args.apply_ticks === true && args.resolution === 'accepted') {
    const hasCriterionDeltas = cardMeta.criterionDeltas && Array.isArray(cardMeta.criterionDeltas.deltas);
    const hasTaskDeltas = cardMeta.taskDeltas && Array.isArray(cardMeta.taskDeltas.deltas);
    if (!hasCriterionDeltas && !hasTaskDeltas) {
      return { success: false, error: 'apply_ticks requested but this change carries no criterion or task deltas' };
    }
  }

  // A5 (docs/WORK_LOOP_PLAN.md): the task ticks the setting lets an agent
  // apply land in-band. ACCEPTED only (a dismissed card must never write
  // evidence), tick-only and double-apply-guarded (the stamp below plus the
  // natural idempotency of already-done skips), and BEFORE any status flip so
  // a failure leaves the card pending and retryable.
  let ticksSummary: { criteriaApplied: number; tasksApplied: number } | null =
    args.apply_ticks === true && args.resolution === 'accepted' ? { criteriaApplied: 0, tasksApplied: 0 } : null;
  if (applyTaskTicks) {
    try {
      const taskResult = await applyTaskDeltas(supabase, event.project_id, {
        deltas: cardMeta.taskDeltas,
        commitSha: event.commit_sha ?? undefined,
        source: 'git',
      });
      ticksSummary = { criteriaApplied: 0, tasksApplied: taskResult.applied };
    } catch (applyErr) {
      return { success: false, error: `Tick apply failed (card left pending): ${applyErr instanceof Error ? applyErr.message : String(applyErr)}` };
    }
  }

  const nowIso = new Date().toISOString();
  const stamps: Record<string, unknown> = applyTaskTicks && ticksSummary
    ? { ticksApplied: { at: nowIso, count: ticksSummary.tasksApplied } }
    : {};
  const ticksNote = applyTaskTicks && ticksSummary
    ? ` Applied ${ticksSummary.tasksApplied} task tick(s) with git provenance.`
    : '';
  // What stays on the card for a person, said in the receipt.
  const waiting = args.resolution === 'accepted' ? unappliedTicks({ ...cardMeta, ...stamps }) : { criteria: 0, tasks: 0 };
  const waitingParts: string[] = [];
  if (waiting.criteria > 0) {
    waitingParts.push(`${ticksPhrase({ criteria: waiting.criteria, tasks: 0 })} ${waiting.criteria === 1 ? 'is' : 'are'} a person's to apply in the Git panel; an agent never applies one.`);
  }
  if (waiting.tasks > 0) {
    waitingParts.push(`${ticksPhrase({ criteria: 0, tasks: waiting.tasks })} wait${waiting.tasks === 1 ? 's' : ''} for a person${tasksWaitForPerson ? ' (the Tasks setting is Propose)' : ''}.`);
  }
  const waitingNote = waitingParts.length > 0 ? ` ${waitingParts.join(' ')}` : '';
  // The card keeps its applied stamps even when it stays pending, so a retry
  // never applies the same ticks twice. Only while it is still the version read.
  const stampPendingCard = async (extra: Record<string, unknown>) => {
    if (Object.keys(stamps).length === 0 && Object.keys(extra).length === 0) return true;
    const { data: stamped } = await supabase
      .from('git_change_events')
      .update({ metadata: { ...cardMeta, ...stamps, ...extra } })
      .eq('id', args.change_event_id)
      .eq('status', 'pending')
      .eq('commit_sha', args.commit_sha as string)
      .select('id');
    return Array.isArray(stamped) && stamped.length > 0;
  };

  // AD.1d (D8): patches reconcile the change through a proposal, filed FIRST.
  // The change stays pending with the proposal's id; accepting the proposal
  // resolves it and moves the last sync (git-pull proposal-baseline). Until
  // then nothing about git's side has been reviewed, so nothing moves.
  // R.1: intents ride the same proposal (add_node, connect_nodes, explode_node,
  // bind_file, each citing its evidence), so a structural reconcile is one call.
  if (args.resolution === 'accepted' && (ownPatches.length > 0 || intents.length > 0)) {
    const branchRow = typeof cardMeta.branchName === 'string' && cardMeta.branchName
      ? (await supabase.from('branches').select('id').eq('project_id', event.project_id).eq('name', cardMeta.branchName).maybeSingle()).data
      : await getPrimaryBranch(supabase, event.project_id as string, 'id');
    if (!branchRow?.id) {
      await stampPendingCard({});
      return { success: false, error: `The change's branch was not found, so no proposal was filed and the change stays pending.${ticksNote}` };
    }
    const result = await handleProposePatches(supabase, auth, {
      project_id: event.project_id,
      branch_id: branchRow.id,
      patches: ownPatches,
      ...(intents.length > 0 ? { intents } : {}),
      explanations: ownPatches.map(() => 'Reconciled from external git change'),
      external_agent: 'git-reconciliation',
      // R.1b: a file bound here (bind_file, or add_artifact without content)
      // is the card's own commit; its bytes are pulled from git at accept.
      ...(event.commit_sha ? { content_ref: event.commit_sha as string } : {}),
    }, { reconcilesChange: { eventId: args.change_event_id, commitSha: args.commit_sha as string } });
    // deno-lint-ignore no-explicit-any
    const filedData = (result.data ?? {}) as any;
    const proposalId = result.success ? (filedData.proposalId as string | undefined) : undefined;
    if (!proposalId) {
      await stampPendingCard({});
      return { success: false, error: `The reconciling proposal was not filed (${result.error ?? 'no proposal id'}); the change stays pending.${ticksNote}` };
    }
    // AL.24: under Auto the reconcile applied as it filed, and the accept
    // resolved the card it answers (or says why it could not).
    if (filedData.routed === 'applied') {
      const notes = Array.isArray(filedData.notes) ? filedData.notes as string[] : [];
      const { data: card } = await supabase.from('git_change_events').select('status, metadata').eq('id', args.change_event_id).maybeSingle();
      await supabase.from('git_change_events')
        .update({ metadata: { ...((card?.metadata as Record<string, unknown>) ?? cardMeta), ...stamps, reconcileProposalId: proposalId } })
        .eq('id', args.change_event_id).eq('commit_sha', args.commit_sha as string);
      const resolved = card?.status && card.status !== 'pending';
      return {
        success: true,
        data: {
          changeEventId: args.change_event_id,
          resolution: resolved ? card.status : 'pending',
          proposalId,
          routed: 'applied',
          ...(ticksSummary ? ticksSummary : {}),
          ...(waiting.criteria + waiting.tasks > 0 ? { waitingForPerson: waiting } : {}),
          message: `The reconcile applied as it filed (proposal ${proposalId}): the Architecture lane is at Auto. ` +
            (resolved ? 'The change resolved.' : (notes.join(' ') || 'The change card it answers stays pending.')) +
            `${waitingNote}${ticksNote}`,
        },
      };
    }
    const waits = await stampPendingCard({ reconcileProposalId: proposalId });
    return {
      success: true,
      data: {
        changeEventId: args.change_event_id,
        resolution: 'pending',
        proposalId,
        ...(ticksSummary ? ticksSummary : {}),
        ...(waiting.criteria + waiting.tasks > 0 ? { waitingForPerson: waiting } : {}),
        message: `${intents.length > 0 ? 'The reconcile' : 'Patches'} filed as proposal ${proposalId}. The change stays pending and resolves when a person accepts the proposal; the last sync moves then.${waitingNote}${ticksNote}` +
          (waits ? '' : ' The change moved on while the proposal was filed: read it again with get_pending_changes.'),
      },
    };
  }

  // AD.3: ticks a person applies keep the change pending; the task ticks
  // applied here are stamped so they never apply twice.
  if (waiting.criteria + waiting.tasks > 0) {
    const kept = await stampPendingCard({});
    return {
      success: true,
      data: {
        changeEventId: args.change_event_id,
        resolution: 'pending',
        proposalId: null,
        waitingForPerson: waiting,
        ...(ticksSummary ? ticksSummary : {}),
        message: `The change stays pending.${waitingNote}${ticksNote}` +
          (kept ? '' : ' The change moved on meanwhile: read it again with get_pending_changes.'),
      },
    };
  }

  // AD.1: one resolver and one baseline writer for the app and agents alike.
  // The applied stamps fold into the SAME write that resolves the card; the
  // baseline only moves forward, and when the provider cannot confirm that,
  // the card stays pending.
  const resolved = await resolveCard(supabase, {
    projectId: event.project_id as string,
    eventId: args.change_event_id,
    resolution: args.resolution,
    expectedCommitSha: args.commit_sha,
    resolvedBy: auth.userId,
    metadataPatch: stamps,
    ancestry: await projectAncestry(supabase, event.project_id as string),
  });
  if (!resolved.ok) {
    await stampPendingCard({});
    return { success: false, error: resolved.message + ticksNote };
  }
  const baselineNote = resolved.baseline.outcome === 'none' ? null : baselineOutcomeNote(resolved.baseline.outcome);

  return {
    success: true,
    data: {
      changeEventId: args.change_event_id,
      resolution: args.resolution,
      proposalId: null,
      ...(ticksSummary ? ticksSummary : {}),
      message: (args.resolution === 'accepted' ? 'Change accepted.' : 'Change dismissed.') + ticksNote,
      ...(baselineNote ? { baselineNote } : {}),
    },
  };
}

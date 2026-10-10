// AL.29 (bench, 2026-10-09): a push regenerated a stale task doc or test plan
// in memory and wrote it to git, while NodeSpec kept the stale copy. Nothing
// else saves a task doc that went stale (only generate_task_docs, when an
// agent calls it), so git and NodeSpec disagreed until then: the bench saw a
// pushed task doc that differed from the stored one after a criterion was
// added.
//
// The push now saves what it regenerated where Auto would apply it (the
// Architecture lane at Auto and the person pushing may decide): one proposal of
// update_artifact patches, filed as that person on the sequence the push read,
// and applied at once. Anywhere else it files nothing, as before: a push is not
// a request to change NodeSpec's copy, and a proposal left waiting on every
// push would hold the doc against generate_task_docs (AL.11); there the
// refresh generate_task_docs or get_test_plan files is how NodeSpec's copy
// catches up, and the push says so. An artifact a waiting proposal already
// changes is left to that proposal. An edit that landed after the push read
// the branch sets the save aside as a stale read, so the save never writes
// over it.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PatchOperationSchema } from "../../_shared/patch-schema.ts";
import type { PacketSave } from "../../_shared/packet-freshness.ts";
import { autoApply, autoRule } from "./auto-apply.ts";
import { filerFromProposal } from "./auto-filer.ts";
import { artifactTargetsOf, loadAutomationPolicy } from "./change-router.ts";
import type { CanvasAcceptDeps } from "./canvas-accept.ts";
import type { ProposalRow } from "./approvals.ts";

export interface PushSaveResult {
  /** The proposal that carries the save; null when nothing was filed. */
  proposalId: string | null;
  /** applied: NodeSpec stores what was pushed. not saved: Auto does not cover
   *  it, so nothing was filed. waiting: filed, and waits for the person. set
   *  aside: the branch moved under it (push again to save). not filed: the save
   *  could not be recorded. */
  status: "applied" | "not saved" | "waiting" | "set aside" | "not filed";
  reason?: string;
  /** Paths left to a proposal that already changes them. */
  leftToWaiting?: Array<{ path: string; proposalId: string }>;
}

export async function savePushRefresh(
  supabase: SupabaseClient,
  args: { projectId: string; branchId: string; userId: string; saves: PacketSave[]; baseSequence: number | null; deps?: CanvasAcceptDeps },
): Promise<PushSaveResult | null> {
  const { projectId, branchId, userId, saves, baseSequence } = args;
  if (saves.length === 0) return null;
  // The branch's waiting proposals (an artifact id names a file on this branch).
  const { data: waiting, error: waitErr } = await supabase.from("ai_proposals").select("id, patches")
    .eq("source_branch_id", branchId).eq("status", "pending");
  if (waitErr) return { proposalId: null, status: "not filed", reason: "The waiting proposals could not be read, so the regenerated files were pushed but not saved. Push again to save them." };
  const holder = new Map<string, string>();
  for (const w of (waiting ?? []) as Array<{ id: string; patches: unknown }>) {
    for (const e of Array.isArray(w.patches) ? w.patches : []) {
      for (const k of artifactTargetsOf(((e ?? {}) as { patch?: { type?: unknown; payload?: unknown } }).patch ?? {})) if (!holder.has(k)) holder.set(k, w.id);
    }
  }
  const leftToWaiting = saves.filter((s) => holder.has(`artifact:${s.id}`)).map((s) => ({ path: s.path, proposalId: holder.get(`artifact:${s.id}`)! }));
  const mine = saves.filter((s) => !holder.has(`artifact:${s.id}`));
  const left = leftToWaiting.length > 0 ? { leftToWaiting } : {};
  if (mine.length === 0) return { proposalId: null, status: "waiting", reason: "A waiting proposal already changes each regenerated file.", ...left };

  const { data: proj } = await supabase.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
  const meta = {
    source: "git-push-refresh", requestedBy: "git-push", proposedByUserId: userId, authMethod: "jwt", credential: `user:${userId}`,
    ...(baseSequence !== null ? { baseSequence } : {}),
  };
  const filer = await filerFromProposal(supabase, projectId, (proj as { owner_id?: string } | null)?.owner_id ?? null, meta);
  const policy = await loadAutomationPolicy(supabase, projectId);
  const rule = autoRule(policy, ["update_artifact"], meta, filer);
  if (rule !== null) {
    const why = rule === "off" ? "Architecture is not at Auto" : `Auto does not apply it for you (${rule.replace(/\.$/, "")})`;
    return { proposalId: null, status: "not saved", reason: `${why}, so NodeSpec's copy is left as it is and git has the regenerated file. NodeSpec's copy catches up when the refresh generate_task_docs or get_test_plan files is accepted.`, ...left };
  }

  const now = new Date().toISOString();
  const patches = mine.map((s) => ({
    type: "update_artifact",
    metadata: { id: crypto.randomUUID(), timestamp: now, actorType: "system", actorId: "push-freshness", summary: `Save the regenerated ${s.kind === "task" ? "task document" : "test plan"} ${s.path}` },
    payload: { id: s.id, changes: s.changes },
  }));
  for (const p of patches) {
    if (!PatchOperationSchema.safeParse(p).success) return { proposalId: null, status: "not filed", reason: `The regenerated ${p.payload.id} is not a valid patch, so it was pushed but not saved.`, ...left };
  }
  const aiRunId = crypto.randomUUID();
  const { error: runError } = await supabase.from("ai_runs").insert({
    id: aiRunId, project_id: projectId, branch_id: branchId, model: "push-freshness", prompt_hash: "git-push-refresh",
    status: "completed", completed_at: now, metadata: { ...meta, patchCount: patches.length },
  });
  if (runError) return { proposalId: null, status: "not filed", reason: `The save could not be recorded (${runError.message}); the regenerated files were pushed. Push again to save them.`, ...left };
  const proposalId = crypto.randomUUID();
  const row = {
    id: proposalId, ai_run_id: aiRunId, source_branch_id: branchId, proposal_branch_id: branchId, status: "pending",
    patches: patches.map((patch) => ({ patch, status: "pending", explanation: `${patch.metadata.summary}: the push regenerated it because its inputs changed; what an agent or person wrote in it is kept` })),
    validation_expectations: [], metadata: meta,
  };
  const { error: proposalError } = await supabase.from("ai_proposals").insert(row);
  if (proposalError) return { proposalId: null, status: "not filed", reason: `The save could not be recorded (${proposalError.message}); the regenerated files were pushed. Push again to save them.`, ...left };

  const outcome = await autoApply(supabase, projectId, row as unknown as ProposalRow, filer, policy, args.deps);
  if (!outcome) return { proposalId, status: "waiting", reason: "Architecture is not at Auto, so the save waits for you under Proposals.", ...left };
  if (outcome.status === "applied") return { proposalId, status: "applied", ...left };
  if (outcome.status === "waiting") return { proposalId, status: "waiting", reason: outcome.reason, ...left };
  if (outcome.status === "busy") return { proposalId, status: "waiting", reason: "Someone is deciding it now.", ...left };
  return { proposalId, status: "set aside", reason: outcome.reason, ...left };
}

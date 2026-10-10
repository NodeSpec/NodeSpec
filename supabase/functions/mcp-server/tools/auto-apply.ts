// AL.24 (owner 2026-10-05): one Auto rule for every proposal an agent files,
// applied by the server whether or not the app is open.
//
// When every lane a batch touches is at Auto, the batch applies as it files:
// a requirement, outcome, workflow or constraint batch through the spec
// accept (acceptSpecBatch), a canvas batch through the server's canvas accept
// (acceptCanvasBatch), and (owner ruling: "Follow the Tasks lane") a work
// plan through the plan accept. The vision applies too (owner ruling: "Apply
// it too"). What still waits for the person, at every level, is named on the
// proposal (metadata.autoWait) so its card says why:
//
//   promoting, attaching or settling an outcome, or changing or retiring a
//   constraint (doctrine R6/R7, NEVER_AUTO_APPLY)
//   a change to a confirmed requirement
//   a repository import (reviewed in its panel) and a load of git's model
//   a batch from an agent that may only propose: its key has no write
//   access, or it acts for a member who is not the owner (a member's agent
//   never decides)
//
// The sweep applies what Auto covers among the proposals already waiting: the
// app runs it when a lane is set to Auto and when the project opens, so a
// backlog filed under Propose clears without anyone clicking through it.
// Every apply goes through the claim (claimProposal), so a person's accept or
// reject arriving meanwhile is refused instead of landing on top of it.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { NEVER_AUTO_APPLY, SPEC_PATCH_KIND } from "../../_shared/spec-patch-schema.ts";
import { laneOfPatchType, loadAutomationPolicy, requirementRefsOf, type AutomationLane, type AutomationLevel } from "./change-router.ts";
import { acceptSpecBatch, BEING_DECIDED, type ProposalRow } from "./approvals.ts";
import { acceptCanvasBatch, type CanvasAcceptDeps } from "./canvas-accept.ts";
import { resolveSpecForProject } from "./requirements.ts";
import { isExampleMetadata } from "../../_shared/deployment.ts";
import { filerFromProposal, filerRefusal, type Filer } from "./auto-filer.ts";
import { sweepPlans, type PlanSweep } from "./work-plan.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isSpecOp = (t: string) => Object.prototype.hasOwnProperty.call(SPEC_PATCH_KIND, t);

export type Policy = Record<AutomationLane, AutomationLevel>;

/** Whether Auto covers a batch, by what it is and who filed it: "off" when a
 *  lane it touches is not at Auto, null when Auto applies it, otherwise the
 *  reason it waits for the person. The confirmed-requirement read is
 *  autoApply's. Pure. */
export function autoRule(policy: Policy, types: readonly string[], meta: Record<string, unknown>, filer: Filer): "off" | string | null {
  if (types.length === 0) return "off";
  if (!types.every((t) => policy[laneOfPatchType(t)] === 2)) return "off";
  if ("finalization" in meta || typeof meta.jobId === "string") return "A repository import is reviewed in its import panel, at every autonomy level.";
  if (meta.source === "git-load" || meta.source === "git-adopt") return "It loads the design from git, which replaces design on the canvas: a load always waits for you.";
  const humanOnly = [...new Set(types.filter((t) => NEVER_AUTO_APPLY.has(t)))];
  if (humanOnly.length > 0) {
    return humanOnly.every((t) => t.endsWith("_constraint"))
      ? "It changes or retires a constraint: weakening what the build is held to is always your decision."
      : "It promotes, attaches or settles an outcome: that is always your decision.";
  }
  return filerRefusal({ ...filer, channel: filer.auth.authMethod });
}

export type AutoOutcome =
  | { status: "applied"; plane: "spec" | "canvas"; data: Record<string, unknown> }
  | { status: "partial" | "set aside"; plane: "spec" | "canvas"; reason: string; data?: Record<string, unknown> }
  | { status: "waiting"; reason: string }
  | { status: "busy" };

async function recordWait(supabase: SupabaseClient, id: string, meta: Record<string, unknown>, reason: string): Promise<void> {
  // Only while nobody holds it: a decider's claim is never written over.
  await supabase.from("ai_proposals").update({ metadata: { ...meta, autoWait: { reason, at: new Date().toISOString() } } })
    .eq("id", id).eq("status", "pending").is("reviewed_at", null);
}

/** Apply one pending proposal if Auto covers it. Null when a lane it
 *  touches is not at Auto (it waits as filed). */
export async function autoApply(
  supabase: SupabaseClient,
  projectId: string,
  row: ProposalRow,
  filer: Filer,
  policy: Policy,
  deps?: CanvasAcceptDeps,
): Promise<AutoOutcome | null> {
  const entries = Array.isArray(row.patches) ? row.patches : [];
  const types = entries.map((e) => String(e?.patch?.type ?? ""));
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const rule = autoRule(policy, types, meta, filer);
  if (rule === "off") return null;
  if (rule !== null) {
    await recordWait(supabase, row.id, meta, rule);
    return { status: "waiting", reason: rule };
  }
  const spec = types.every(isSpecOp);
  if (spec) {
    // a confirmed requirement always waits for the person (as on a direct write)
    const refs = [...new Set(entries.flatMap((e) => requirementRefsOf((e?.patch ?? {}) as never)))];
    if (refs.length > 0) {
      const s = await resolveSpecForProject(supabase, projectId);
      if (s) {
        const ids = refs.filter((r) => UUID_RE.test(r)), codes = refs.filter((r) => !UUID_RE.test(r));
        const rows: Array<{ confirmed?: boolean }> = [];
        if (ids.length > 0) rows.push(...(((await supabase.from("specification_requirements").select("confirmed").eq("specification_id", s.id).in("id", ids)).data ?? []) as Array<{ confirmed?: boolean }>));
        if (codes.length > 0) rows.push(...(((await supabase.from("specification_requirements").select("confirmed").eq("specification_id", s.id).in("requirement_id", codes)).data ?? []) as Array<{ confirmed?: boolean }>));
        if (rows.some((r) => r.confirmed === true)) {
          const reason = "It changes a confirmed requirement, which changes only with your approval.";
          await recordWait(supabase, row.id, meta, reason);
          return { status: "waiting", reason };
        }
      }
    }
    const decided = await acceptSpecBatch(supabase, filer.auth, projectId, row, { by: "auto", note: null });
    const data = (decided.data ?? {}) as Record<string, unknown>;
    if (decided.success) return { status: "applied", plane: "spec", data };
    if (data.status === "partial") return { status: "partial", plane: "spec", reason: String(decided.error ?? ""), data };
    if (data.status === "rejected") return { status: "set aside", plane: "spec", reason: String(decided.error ?? ""), data };
    if (decided.error === BEING_DECIDED) return { status: "busy" };
    const reason = String(decided.error ?? "It could not be applied.");
    await recordWait(supabase, row.id, meta, reason);
    return { status: "waiting", reason };
  }
  if (types.some(isSpecOp)) return null; // a mixed batch is refused at filing; never applied here
  const canvas = await acceptCanvasBatch(supabase, projectId, row, filer.auth, deps);
  switch (canvas.status) {
    case "merged": return { status: "applied", plane: "canvas", data: { applied: canvas.applied, mappings: canvas.mappings, ...(canvas.notes.length > 0 ? { notes: canvas.notes } : {}) } };
    case "set aside": return { status: "set aside", plane: "canvas", reason: canvas.reason };
    case "waiting": return { status: "waiting", reason: canvas.reason };
    default: return { status: "busy" };
  }
}

export interface SweepResult {
  applied: Array<{ proposalId: string; plane: "spec" | "canvas" }>;
  waiting: Array<{ proposalId: string; reason: string }>;
  setAside: Array<{ proposalId: string; reason: string }>;
  busy: string[];
  plans: PlanSweep[];
}

const SWEEP_LIMIT = 100;

/** Apply what Auto covers among the project's waiting proposals and its
 *  newest proposed plan per branch, oldest first. */
export async function sweepAuto(supabase: SupabaseClient, projectId: string, deps?: CanvasAcceptDeps): Promise<SweepResult> {
  const out: SweepResult = { applied: [], waiting: [], setAside: [], busy: [], plans: [] };
  const policy = await loadAutomationPolicy(supabase, projectId);
  const { data: proj } = await supabase.from("projects").select("owner_id, metadata").eq("id", projectId).maybeSingle();
  // The account's example is a fixed showcase: its waiting proposals are part of the tour.
  if (isExampleMetadata((proj as { metadata?: unknown } | null)?.metadata)) return out;
  const ownerId = (proj as { owner_id?: string } | null)?.owner_id ?? null;
  const { data: branches } = await supabase.from("branches").select("id").eq("project_id", projectId);
  const branchIds = ((branches ?? []) as Array<{ id: string }>).map((b) => b.id);
  if (branchIds.length === 0) return out;

  const { data: pending } = await supabase.from("ai_proposals").select("id, status, source_branch_id, patches, metadata")
    .in("source_branch_id", branchIds).eq("status", "pending").order("created_at", { ascending: true }).limit(SWEEP_LIMIT);
  const filers = new Map<string, Filer>();
  for (const row of (pending ?? []) as ProposalRow[]) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const key = `${String(meta.credential ?? meta.apiKeyId ?? "")}|${String(meta.proposedByUserId ?? "")}|${String(meta.authMethod ?? "")}`;
    let filer = filers.get(key);
    if (!filer) { filer = await filerFromProposal(supabase, projectId, ownerId, meta); filers.set(key, filer); }
    const r = await autoApply(supabase, projectId, row, filer, policy, deps);
    if (!r) continue;
    if (r.status === "applied") out.applied.push({ proposalId: row.id, plane: r.plane });
    else if (r.status === "waiting") out.waiting.push({ proposalId: row.id, reason: r.reason });
    else if (r.status === "busy") out.busy.push(row.id);
    else out.setAside.push({ proposalId: row.id, reason: r.reason });
  }

  if (policy.tasks === 2) out.plans = await sweepPlans(supabase, projectId, ownerId);
  return out;
}

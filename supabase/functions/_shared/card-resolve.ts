// V3 AD.1 (finding D8): the one way a change card resolves, for the app and
// for agents alike. The app used to write the card and the baseline straight
// from the browser, and resolve_change did the same on the server; neither
// checked the card was still the one the person or agent had read, and
// neither checked the baseline only moved forward. A sync check rewrites a
// pending card in place as new commits arrive, so a card read before that
// resolved to the NEW head, moving the baseline past commits nobody saw.
//
// Now a card resolves only
//   - while it is pending,
//   - as the version the caller read (its commit sha), and
//   - with its baseline move decided before anything is written: when the
//     provider cannot confirm the card's commit follows the last sync, the
//     card stays pending (fail closed).
// A card whose commit the baseline has already passed resolves without
// moving anything. A card carrying ticks nobody applied is accepted only once
// they are applied; a dismiss records them as set aside (AD.1d).
import { planBaselineMove, writeBaselineMove, isCommitSha, type AncestryFn, type BaselineOutcome, type BaselinePlan } from "./baseline.ts";
import { getPrimaryBranch } from "./primary-branch.ts";

export type CardResolution = "accepted" | "dismissed";

/** Which branch's baseline resolving this card moves: `{ branchName }` (null
 *  means the primary branch), or null when it moves none. */
export function cardBaselineTarget(
  // deno-lint-ignore no-explicit-any
  card: { commit_sha?: string | null; metadata?: any },
  resolution: CardResolution,
): { branchName: string | null } | null {
  const meta = card.metadata ?? {};
  const source = meta.source as string | undefined;
  // A lifecycle card's sha is the old baseline itself, not a sync point.
  if (source === "ref-deleted") return null;
  // A webhook card for a ref no branch is bound to moves no branch.
  if (!meta.branchName && meta.unmappedRef) return null;
  // Dismissing the mismatch card keeps the repository's model protected: the
  // branch stays unbaselined so the push guard keeps asking.
  if (source === "connect-anchor-mismatch" && resolution === "dismissed") return null;
  if (!isCommitSha(card.commit_sha)) return null;
  return { branchName: typeof meta.branchName === "string" && meta.branchName ? meta.branchName : null };
}

/** AD.1 (D6): the ticks on a card nobody applied. A criterion tick counts
 *  until the card carries `criteriaApplied`, a task tick until it carries
 *  `ticksApplied`; an untick is never applied, so it never counts. */
// deno-lint-ignore no-explicit-any
export function unappliedTicks(meta: any): { criteria: number; tasks: number } {
  // deno-lint-ignore no-explicit-any
  const ticks = (deltas: any) =>
    // deno-lint-ignore no-explicit-any
    Array.isArray(deltas?.deltas) ? deltas.deltas.filter((d: any) => d?.direction === "tick").length : 0;
  return {
    criteria: meta?.criteriaApplied ? 0 : ticks(meta?.criterionDeltas),
    tasks: meta?.ticksApplied ? 0 : ticks(meta?.taskDeltas),
  };
}

// deno-lint-ignore no-explicit-any
export function hasUnappliedTicks(meta: any): boolean {
  const t = unappliedTicks(meta);
  return t.criteria + t.tasks > 0;
}

/** "2 criterion ticks and 1 task tick", for messages. */
export function ticksPhrase(t: { criteria: number; tasks: number }): string {
  const parts: string[] = [];
  if (t.criteria > 0) parts.push(`${t.criteria} criterion tick${t.criteria === 1 ? "" : "s"}`);
  if (t.tasks > 0) parts.push(`${t.tasks} task tick${t.tasks === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

export type ResolveCardOutcome =
  | { ok: true; baseline: { moved: boolean; outcome: BaselineOutcome | "none" } }
  | { ok: false; code: "not-found" | "not-pending" | "changed" | "ticks-unapplied" | "unconfirmed" | "raced"; message: string };

export async function resolveCard(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    projectId: string;
    eventId: string;
    resolution: CardResolution;
    /** The card's commit sha as the caller read it. */
    expectedCommitSha: string;
    resolvedBy: string | null;
    /** Merged into the card's metadata in the same write. */
    metadataPatch?: Record<string, unknown>;
    ancestry: AncestryFn;
  },
): Promise<ResolveCardOutcome> {
  const { data: card } = await supabase
    .from("git_change_events")
    .select("id, project_id, status, commit_sha, metadata")
    .eq("id", args.eventId)
    .maybeSingle();
  if (!card || card.project_id !== args.projectId) {
    return { ok: false, code: "not-found", message: "Change event not found" };
  }
  if (card.status !== "pending") {
    return { ok: false, code: "not-pending", message: `Change event already resolved with status: ${card.status}` };
  }
  if (!args.expectedCommitSha || card.commit_sha !== args.expectedCommitSha) {
    return {
      ok: false,
      code: "changed",
      message: "This change has moved on since it was read: new commits arrived and the card now covers them. Read it again and review what it holds now.",
    };
  }

  // AD.1 (D6): ticks are never dropped. An accept needs every tick applied
  // (the stamps may ride in this same write); a dismiss names the ticks it
  // sets aside on the card.
  const patch: Record<string, unknown> = { ...(args.metadataPatch ?? {}) };
  const unapplied = unappliedTicks({ ...(card.metadata ?? {}), ...patch });
  if (unapplied.criteria + unapplied.tasks > 0) {
    if (args.resolution === "accepted") {
      return {
        ok: false,
        code: "ticks-unapplied",
        message: `This change carries ${ticksPhrase(unapplied)} nobody applied. Apply them first, or dismiss the change to set them aside.`,
      };
    }
    patch.ticksDismissed = { at: new Date().toISOString(), criteria: unapplied.criteria, tasks: unapplied.tasks };
  }

  // Decide the baseline before writing anything.
  let plan: BaselinePlan | null = null;
  const target = cardBaselineTarget(card, args.resolution);
  if (target) {
    const branch = target.branchName
      ? (await supabase.from("branches").select("id").eq("project_id", args.projectId).eq("name", target.branchName).maybeSingle()).data
      : await getPrimaryBranch(supabase, args.projectId, "id");
    if (branch?.id) {
      plan = await planBaselineMove(supabase, { branchId: branch.id, to: card.commit_sha, ancestry: args.ancestry });
      if (plan?.decision.outcome === "unknown") {
        return {
          ok: false,
          code: "unconfirmed",
          message: "The git provider could not confirm this change follows the last sync, so the change was left pending. Try again.",
        };
      }
    }
  }

  const { data: updated, error } = await supabase
    .from("git_change_events")
    .update({
      status: args.resolution,
      resolved_by: args.resolvedBy,
      resolved_at: new Date().toISOString(),
      ...(Object.keys(patch).length > 0 ? { metadata: { ...(card.metadata ?? {}), ...patch } } : {}),
    })
    .eq("id", args.eventId)
    .eq("status", "pending")
    .eq("commit_sha", args.expectedCommitSha)
    .select("id");
  if (error || !Array.isArray(updated) || updated.length === 0) {
    return {
      ok: false,
      code: "raced",
      message: "This change was resolved or moved on while you were acting on it. Read it again.",
    };
  }

  if (!plan) return { ok: true, baseline: { moved: false, outcome: "none" } };
  const written = await writeBaselineMove(supabase, plan);
  return { ok: true, baseline: { moved: written.moved, outcome: written.outcome } };
}

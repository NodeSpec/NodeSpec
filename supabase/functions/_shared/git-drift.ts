// P1-7 R1: shared git-drift primitives. Home of the artifact matcher (moved verbatim-modulo-fix
// from git-webhook/handlers.ts — importing across function directories is fragile for deploy
// bundling; _shared is the sanctioned pattern) and, as R2 lands, the drift-sweep decision logic.
//
// FIX (2026-07-16, verified): the matcher's branch lookup used `.eq("is_main", true)` — a column
// that exists in NO migration and not in the prod schema. In production that query always
// errored, so every webhook event ever ingested carried EMPTY artifact matches (the error path
// degrades to `{ matches: [], error }`). FakeSupabase doesn't validate column names, which is how
// the P0-9 suite stayed green over a broken filter. Main-ness is name-derived everywhere else in
// the codebase; the lookup now matches that convention.

export interface ChangedFile {
  path: string;
  action: "added" | "modified" | "removed";
  additions?: number;
  deletions?: number;
  /** Present when the file was renamed/moved in git; `path` is the NEW location. */
  oldPath?: string;
}

export interface MatchResult {
  // movedFrom present = the artifact is bound to the file's OLD path (git-side rename/move);
  // `path` is the file's new location. The binding must FOLLOW git — without this, a moved
  // file shows up as residue (spurious re-inference) and the next push re-creates it at the
  // stale path.
  // R5b: `kind` distinguishes a task doc (whose checkboxes are EVIDENCE) from
  // ordinary source (whose checkboxes are prose).
  matches: Array<{ path: string; artifactId: string; nodeId: string; nodeName: string; kind?: string; movedFrom?: string }>;
  error?: string;
}

// R3-4a: the matcher takes the branch whose artifacts the files should match
// against. It was hardcoded to main, so a branch-scoped sweep (R3-3c) matched a
// feature branch's changed files against MAIN's snapshot — wrong matches and
// false residue on feature branches.
// deno-lint-ignore no-explicit-any
export async function matchFilesToArtifacts(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  projectId: string,
  changedFiles: ChangedFile[],
  branchName?: string,
): Promise<MatchResult> {
  try {
    // AD.4 (D15): no branch named means the primary branch, found by its flag.
    const { data: branches, error: branchError } = branchName
      ? await supabase
        .from("branches")
        .select("id")
        .eq("project_id", projectId)
        .eq("name", branchName)
        .maybeSingle()
      : { data: await getPrimaryBranch(supabase, projectId, "id"), error: null };

    if (branchError) {
      return { matches: [], error: `Branch lookup failed: ${branchError.message}` };
    }
    if (!branches) return { matches: [] };

    const { graph, error: snapshotError } = await loadLatestSnapshot(supabase, branches.id);
    if (snapshotError) {
      return { matches: [], error: `Snapshot lookup failed: ${snapshotError.message}` };
    }
    if (!graph) return { matches: [] };
    const artifacts = graph.artifacts || {};
    const nodes = graph.nodes || {};
    const changedPaths = new Set(changedFiles.map((f) => f.path));
    // Renamed/moved files: old location → new location, so an artifact bound to the OLD path
    // is recognized as a move rather than orphaned (and the new path doesn't read as residue).
    const movedByOldPath = new Map(
      changedFiles.filter((f) => f.oldPath).map((f) => [f.oldPath as string, f.path]),
    );
    const matches: MatchResult["matches"] = [];

    // deno-lint-ignore no-explicit-any
    for (const [artifactId, artifact] of Object.entries(artifacts) as [string, any][]) {
      if (!artifact.path) continue;
      const normalizedPath = artifact.path.startsWith("/") ? artifact.path.slice(1) : artifact.path;
      const node = nodes[artifact.nodeId];
      const nodeName = node?.label || node?.name || "Unknown";
      // R5b: the artifact KIND rides along so the sweep can tell a task doc from
      // ordinary source. A ticked checkbox in a task doc is evidence; a ticked
      // checkbox anywhere else is prose.
      const kind = typeof artifact.kind === "string" ? artifact.kind : undefined;
      if (changedPaths.has(normalizedPath)) {
        matches.push({ path: normalizedPath, artifactId, nodeId: artifact.nodeId, nodeName, kind });
      } else if (movedByOldPath.has(normalizedPath)) {
        matches.push({
          path: movedByOldPath.get(normalizedPath)!,
          artifactId,
          nodeId: artifact.nodeId,
          nodeName,
          kind,
          movedFrom: normalizedPath,
        });
      }
    }

    return { matches };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("matchFilesToArtifacts error:", err);
    return { matches: [], error: `Artifact matching failed: ${msg}` };
  }
}

// ── P1-7 R2: the on-connect drift sweep ───────────────────────────────────────────────
// Webhook-independent change detection: compare remote HEAD against the branch's
// last_synced_commit baseline (established by push/pull in R1), classify what changed, and
// maintain ONE cumulative open sweep event per project (superseded on re-sweep — per-HEAD dedup
// would stack overlapping events as more commits land, because every sweep spans the SAME
// baseline). Self-push-only ranges fast-forward the baseline silently. Pure decision helpers are
// exported for offline tests; the orchestrator's provider calls run only on the live bench.

import { providerApiBase, fetchRemoteHeadShaDetailed, fetchRepoFile, readRepoFile, fetchCommitFiles } from "./git-provider.ts";
import { advanceBaseline, ancestryFor, planBaselineMove, writeBaselineMove, baselineOutcomeNote, type BaselinePlan } from "./baseline.ts";
import { readRange } from "./push-plan.ts";
import { hasUnappliedTicks } from "./card-resolve.ts";
import { buildGitHubHeaders, fetchFullGitHubTree, fetchGitHubFiles } from "./git-tree.ts";
// RI-9: closed module (stubbed in the community export — the stub reports
// 'unsupported' and the sweep carries on).
import { refreshRepoIndexForBranch, type IndexFreshness } from "./import-freshness.ts";
import { isPrimaryRow, getPrimaryBranch } from "./primary-branch.ts";
import { releaseHeldEvidence } from "./evidence-commit.ts";
import { groupFilesByAuthor, authorLine, MAX_ATTRIBUTED_COMMITS, type AuthorGroup } from "./commit-authors.ts";
import { decryptWithUpgrade, isEncrypted } from "./crypto.ts";
import { MODEL_ANCHOR_PATH, parseModel, serializeModel, diffAnchors, capAnchorDiff, verifyModelHash, sameDesign, type CappedAnchorDiff, type ModelAnchor } from "./model-anchor.ts";
import { anchorLoadPatches } from "./anchor-load.ts";
import { SPEC_ANCHOR_PATH, parseSpec, serializeSpec, loadSpecPlane, diffSpecs, capSpecDiff, adoptSpecAnchor, applySpecAnchor, type CappedSpecDiff, type SpecAnchor } from "./spec-anchor.ts";
import { constraintsCarried } from "./node-constraints.ts";
import {
  parseTaskDocCriteria, computeCriterionDeltas, applicableDeltas,
  type CriterionDeltaResult, type CurrentCriterion,
} from "./criterion-deltas.ts";
import { computeSweepTaskDeltas, applyTaskDeltas, type TaskDeltaResult } from "./task-deltas.ts";
import { computeSweepBindingResolution } from "./binding-sweep.ts";
import { BINDINGS_PATH, type BindingResolution } from "./binding-manifest.ts";
import { BOARD_PATH, parseBoardMd, computeBoardTickDeltas, mergeCriterionDeltaResults, mergeTaskDeltaResults } from "./board-generator.ts";

// ── R2.2: anchor-restore on connect + push overwrite guard (pure decision helpers) ────
// Owner-discovered via an accidental disaster-recovery test: after a DB reset the
// repo's model.json was the ONLY surviving copy of the graph — and the app neither
// surfaced it on connect (non-empty/unbaselined projects fell through every lane:
// adopt-on-connect requires an EMPTY graph, the drift sweep declines unbaselined
// branches) nor protected it (the first push from a fresh project silently
// overwrote it — a data-loss AMPLIFIER after any DB loss).

export interface AnchorSummary {
  modelHash: string;
  nodes: number;
  edges: number;
  contracts: number;
  artifacts: number;
}

export function summarizeAnchor(model: ModelAnchor): AnchorSummary {
  return {
    modelHash: model.modelHash,
    nodes: model.nodes.length,
    edges: model.edges.length,
    contracts: model.contracts.length,
    artifacts: model.artifacts.length,
  };
}

export type ConnectAnchorAction =
  | "none"           // no anchor, or already-baselined divergence (the drift sweep owns that)
  | "adopt"          // empty project + valid anchor → restore proposal (existing R2 lane)
  | "auto-baseline"  // repo anchor IS this project's model on an UNBASELINED branch: establish the baseline silently (disconnect/reconnect with no changes must be a no-op, owner bench 2026-07-28)
  | "mismatch-card"  // NON-empty project, GENUINE divergence, unbaselined → surface a pending card; accept = baseline (repo yields on next push), dismiss = stay unbaselined (push guard keeps protecting)
  | "invalid-skip";  // anchor present but unparseable/hash-failed → never auto-act on it

export function decideConnectAnchorAction(args: {
  anchorPresent: boolean;
  parsedOk: boolean;
  hashOk: boolean;
  nodeCount: number;
  /** repo anchor modelHash === this project's own serialized modelHash */
  projectMatchesAnchor: boolean;
  /** branch already has a sync baseline (divergence there is the sweep's job) */
  baselined: boolean;
}): ConnectAnchorAction {
  if (!args.anchorPresent) return "none";
  if (!args.parsedOk || !args.hashOk) return "invalid-skip";
  if (args.nodeCount === 0) return "adopt";
  // AD.1 (D10): a baselined branch is the sync check's, whatever the anchor
  // says. Re-saving used to set the baseline to HEAD whenever the
  // architecture matched, skipping every code commit since the last sync.
  if (args.baselined) return "none";
  if (args.projectMatchesAnchor) return "auto-baseline";
  return "mismatch-card";
}

/**
 * The ONE way to read a branch's newest snapshot. patch_sequence FIRST — created_at
 * alone let same-tick rows shadow each other (fixed 2026-07-16: a push read a STALE
 * graph and silently dropped just-saved artifacts). Debt audit 2026-07-29: five call
 * sites carried hand-copies of this ordering-sensitive query; one copy losing the
 * two-key order would silently regress that bug.
 */
// deno-lint-ignore no-explicit-any
export async function loadLatestSnapshot(supabase: any, branchId: string): Promise<{
  // deno-lint-ignore no-explicit-any
  graph: any | null;
  error: { message: string } | null;
  /** AD.2b: the patch sequence the snapshot holds, null when there is none. */
  patchSequence: number | null;
}> {
  const { data, error } = await supabase
    .from("graph_snapshots")
    .select("graph_data, patch_sequence")
    .eq("branch_id", branchId)
    .order("patch_sequence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    graph: data?.graph_data ?? null,
    error: error ?? null,
    patchSequence: typeof data?.patch_sequence === "number" ? data.patch_sequence : null,
  };
}

// R7d: loadAnchorMappings DELETED. Its one job was feeding requirement mappings
// into serializeModel; model.json is architecture-only now, so both sides of every
// comparison serialize WITHOUT mappings — which preserves the R2.2 rationale
// ("connect must serialize the same model a push would") by construction.

export interface UnbaselinedPushVerdict {
  blocked: boolean;
  /** Present when the repo anchor parsed — shown in the confirmation prompt. */
  summary?: AnchorSummary;
  reason?: string;
}

/**
 * A push from a branch with NO sync baseline overwrites whatever the repo holds,
 * sight unseen. Block when the repo already carries a model anchor — even an
 * unparseable one (a corrupt/hand-edited anchor is still the user's file). The
 * caller retries with explicit confirmation to proceed.
 */
export function evaluateUnbaselinedPush(
  baseline: string | null | undefined,
  repoAnchorText: string | null,
): UnbaselinedPushVerdict {
  if (baseline) return { blocked: false };
  if (repoAnchorText == null) return { blocked: false };
  const parsed = parseModel(repoAnchorText);
  if (parsed.ok) {
    return {
      blocked: true,
      summary: summarizeAnchor(parsed.model),
      reason: "the repository already carries a NodeSpec model this project has never synced with",
    };
  }
  return {
    blocked: true,
    reason: "the repository carries a .nodespec/model.json this project has never synced with (file did not parse as a NodeSpec anchor)",
  };
}

// ── R3-3c: branch-switch freshness ladder (pure, pinned) ──────────────────────────
// Switching to a design branch checks THAT branch's ref through the one sweep
// engine. The ladder decides what a moved (or vanished) ref means for this branch:
//   ref-deleted-card       — bound+baselined ref 404s (the post-PR-merge signature):
//                            offer "archive this design branch?"; never touch baselines
//   none                   — ref unmoved
//   baseline-fast-forward  — canvas already equals the HEAD anchor and nothing else
//                            changed in the range: bookkeeping only, no question
//   auto-restore           — model moved but the working copy is UNTOUCHED since its
//                            baseline and the switch was user-initiated: run the R3-1
//                            loader silently ("user-initiated + undiverged = no
//                            question to ask", same principle as merge convergence)
//   card                   — anything else: the standard explicit reconciliation card
export type BranchFreshnessAction =
  | "ref-deleted-card"
  | "none"
  | "baseline-fast-forward"
  | "auto-restore"
  | "card";

export function decideBranchFreshness(args: {
  refDeleted: boolean;
  refMoved: boolean;
  modelChanged: boolean;
  canvasMatchesHead: boolean;
  canvasMatchesBaseline: boolean;
  matchedArtifactCount: number;
  residueCount: number;
  userInitiated: boolean;
  /**
   * R7c: the range also moved `.nodespec/spec.json` to something this project's
   * spec does not equal (or we could not prove it does). BOTH auto lanes below
   * reason only about the ARCHITECTURE anchor: `baseline-fast-forward` proves the
   * canvas matches the HEAD *model*, and `auto-restore` loads the *model*. Neither
   * says anything about requirements, so letting either run would advance the
   * baseline past a spec change nobody has seen — the merge-swallow failure mode
   * (2026-07-30) in a different plane. Same invariant, restated: nothing may
   * advance a baseline past content this canvas has not seen.
   */
  specDivergent?: boolean;
  /**
   * AD.1 (D6): the range carries ticks in a task doc or the board. Ticks are
   * applied only from a card, so neither automatic lane may run past them.
   */
  carriesTicks?: boolean;
  /**
   * AD.1 (D7): the range touched `.nodespec/spec.json` and the project's
   * requirements match it (`specDivergent` false): a spec load answered it.
   */
  specChanged?: boolean;
}): BranchFreshnessAction {
  if (args.refDeleted) return "ref-deleted-card";
  if (!args.refMoved) return "none";
  if (args.specDivergent) return "card";
  if (args.carriesTicks) return "card";
  if (args.modelChanged && args.canvasMatchesHead && args.matchedArtifactCount === 0 && args.residueCount === 0) {
    return "baseline-fast-forward";
  }
  // AD.1: a range whose only change is a spec.json the project already matches
  // (a spec load answered it) is bookkeeping too.
  if (!args.modelChanged && args.specChanged && args.matchedArtifactCount === 0 && args.residueCount === 0) {
    return "baseline-fast-forward";
  }
  // AD.1 (D7): loading the model brings no file content, so a range that also
  // edited bound files is never loaded silently; it goes on a card.
  if (args.modelChanged && args.canvasMatchesBaseline && args.matchedArtifactCount === 0 && args.residueCount === 0 && args.userInitiated) {
    return "auto-restore";
  }
  return "card";
}

// ── R3-4a: webhook ref → NodeSpec branch mapping (pure, pinned) ───────────────────
// A push webhook names a git ref, not a NodeSpec branch. Map it: a branch row
// bound to that ref wins; the integration's default branch reads as main; anything
// else is UNMAPPED (null) — an unmapped ref's card must never advance any baseline.
export function resolveWebhookBranchName(
  pushedRef: string,
  defaultBranch: string | null | undefined,
  branchRows: Array<{ name: string; git_ref: string | null; is_primary?: boolean | null }>,
): string | null {
  const bound = branchRows.find((b) => b.git_ref === pushedRef);
  if (bound) return bound.name;
  // R3-3d: the unbound fallback used to return the LITERAL "main" whenever the
  // pushed ref was the repo default. Two ways that lied:
  //   · the project may have no branch row called 'main' at all — the caller then
  //     looks up a row that does not exist and the card lands nowhere;
  //   · main may be bound to a DIFFERENT ref (a master repo where main tracks
  //     something else) — claiming the default ref for it would stamp one branch's
  //     sha onto another's baseline, the exact corruption R3-3c fixed elsewhere.
  // A missing default branch is now honestly unmapped rather than guessed as
  // "main": inventing a ref name is how a master-default repo silently drifts.
  if (!defaultBranch || pushedRef !== defaultBranch) return null;
  // Owner spike 2026-08-23: the trunk is identified by is_primary, not the
  // literal name 'main' — connect may have renamed it to the bound git
  // branch. The fallback returns the row's REAL name so the card lands on
  // the branch the header actually shows.
  const main = branchRows.find((b) => isPrimaryRow(b));
  if (!main) return null;
  return main.git_ref ? null : main.name;
}

export const SWEEP_THROTTLE_MS = 60_000;
// The subject every NodeSpec commit carries, a label for people. NodeSpec
// knows its own commits by the sha and blobs it records (AD.1), never by this
// message, so nothing matches on it (AD.4 retired the message matchers).
export const SELF_PUSH_PREFIX = "Update from NodeSpec:";

export function shouldRunSweep(lastCheckAt: string | null | undefined, nowMs: number, throttleMs = SWEEP_THROTTLE_MS): boolean {
  if (!lastCheckAt) return true;
  const last = Date.parse(lastCheckAt);
  if (Number.isNaN(last)) return true;
  return nowMs - last >= throttleMs;
}

/**
 * Owner bench 2026-07-29 (rename bug): paths the repo's CURRENT anchor claims
 * that this push no longer stands behind. A path is stale when its artifact was
 * RENAMED (same id, different path in the new model) or REMOVED (id gone from
 * the model). An artifact that merely isn't pushed this time (content empty,
 * suggested status) keeps its path — the model still claims it. Pure; exported
 * for offline tests.
 */
export function computeStalePaths(
  oldAnchorArtifacts: Array<{ id: string; path: string }>,
  // deno-lint-ignore no-explicit-any
  graphArtifacts: Record<string, any>,
  pushedPaths: string[],
): string[] {
  const norm = (p: string) => (p.startsWith("/") ? p.slice(1) : p);
  const newPathById = new Map<string, string>();
  const allClaimedPaths = new Set<string>();
  for (const [id, a] of Object.entries(graphArtifacts)) {
    if (!a || !a.path) continue;
    const p = norm(String(a.path));
    newPathById.set(id, p);
    allClaimedPaths.add(p);
  }
  const pushed = new Set(pushedPaths.map(norm));

  const stale: string[] = [];
  const seen = new Set<string>();
  for (const old of oldAnchorArtifacts) {
    const oldPath = norm(old.path);
    if (seen.has(oldPath)) continue;
    const newPath = newPathById.get(old.id);
    const renamed = newPath !== undefined && newPath !== oldPath;
    const removed = newPath === undefined;
    if (!renamed && !removed) continue;
    // Never delete a path some OTHER artifact now claims, or one this very push writes.
    if (allClaimedPaths.has(oldPath) || pushed.has(oldPath)) continue;
    seen.add(oldPath);
    stale.push(oldPath);
  }
  return stale;
}

/** Split changed files into anchor/model, matched-artifact, and residue (unattributed) sets. */
export function classifySweepFiles(
  files: ChangedFile[],
  matchedPaths: Set<string>,
): { modelChanged: boolean; specChanged: boolean; residuePaths: string[] } {
  const modelChanged = files.some((f) => f.path === MODEL_ANCHOR_PATH);
  // R7c: the spec plane has its OWN anchor, so "the requirements moved" is a
  // separate question from "the architecture moved" — a criterion ticked by a
  // passing test must never read as an architecture change.
  const specChanged = files.some((f) => f.path === SPEC_ANCHOR_PATH);
  const residuePaths = files
    .filter((f) =>
      f.action !== "removed" &&
      !matchedPaths.has(f.path) &&
      !f.path.startsWith(".nodespec/") &&
      f.path !== "ARCHITECTURE.md"
    )
    .map((f) => f.path);
  return { modelChanged, specChanged, residuePaths };
}

/**
 * Maintain ONE cumulative open sweep event per project: supersede in place, and HEAL any
 * duplicates a pre-claim-fix race left behind (keep the first card, auto-dismiss the rest —
 * dismissal here does NOT advance the baseline; the surviving card owns the range).
 * Returns the surviving/created event id. Exported for offline tests.
 */
// deno-lint-ignore no-explicit-any
export async function upsertCumulativeSweepEvent(supabase: any, args: {
  integrationId: string;
  projectId: string;
  headSha: string;
  summary: string;
  files: ChangedFile[];
  /** AD.3: who made the commits, for the card's header. */
  author?: string | null;
  // deno-lint-ignore no-explicit-any
  metadata: Record<string, any>;
  /** AD.4 (D15): whether this card's branch is the primary one, by its flag,
   *  so a card from before R3-3c (no branchName) is recognised as the
   *  primary's. Defaults to "the card names no branch". */
  isPrimary?: boolean;
}): Promise<string | undefined> {
  const { data: pending } = await supabase
    .from("git_change_events")
    .select("id, metadata")
    .eq("project_id", args.projectId)
    .eq("status", "pending");
  // R3-3c: the cumulative card is per BRANCH now — a feature branch's sweep must
  // never supersede main's card (or vice versa). Legacy cards carry no branchName
  // and belong to the primary branch (AD.4: known by its flag, not by "main").
  const own = {
    name: String(args.metadata?.branchName ?? ""),
    isPrimary: args.isPrimary ?? !args.metadata?.branchName,
  };
  // deno-lint-ignore no-explicit-any
  const sweepEvents = ((pending ?? []) as any[]).filter((e) =>
    e?.metadata?.source === "sweep" && cardOnBranch(e?.metadata, own)
  );

  if (sweepEvents.length === 0) {
    const { data: inserted } = await supabase
      .from("git_change_events")
      .insert({
        integration_id: args.integrationId,
        project_id: args.projectId,
        commit_sha: args.headSha,
        commit_message: args.summary,
        changed_files: args.files,
        ...(args.author ? { author: args.author } : {}),
        status: "pending",
        metadata: args.metadata,
      })
      .select("id")
      .maybeSingle();
    return inserted?.id;
  }

  const survivor = sweepEvents[0];
  for (const dup of sweepEvents.slice(1)) {
    await supabase
      .from("git_change_events")
      .update({
        status: "dismissed",
        metadata: { ...(dup.metadata ?? {}), supersededBy: survivor.id, note: "duplicate sweep event auto-dismissed" },
      })
      .eq("id", dup.id);
  }
  // R3-4c: the user's ignore-this-residue decisions survive the supersede — a
  // wholesale metadata replace would resurrect every ignored file on re-sweep.
  const survivorIgnored = Array.isArray(survivor.metadata?.ignoredResidue)
    ? (survivor.metadata.ignoredResidue as string[])
    : [];
  await supabase
    .from("git_change_events")
    .update({
      commit_sha: args.headSha, commit_message: args.summary, changed_files: args.files,
      ...(args.author !== undefined ? { author: args.author } : {}),
      metadata: { ...args.metadata, ...(survivorIgnored.length ? { ignoredResidue: survivorIgnored } : {}) },
    })
    .eq("id", survivor.id);
  return survivor.id;
}

/** AD.1: pending sweep cards on this branch whose whole range turned out to be
 *  NodeSpec's own writing (a GitLab push the check saw before its record
 *  landed): dismissed, never accepted, and no baseline moves here. */
// deno-lint-ignore no-explicit-any
async function dismissCardsCoveredByOwnRange(supabase: any, projectId: string, branch: { name: string; isPrimary: boolean }): Promise<void> {
  const { data: pending } = await supabase
    .from("git_change_events")
    .select("id, metadata")
    .eq("project_id", projectId)
    .eq("status", "pending");
  // deno-lint-ignore no-explicit-any
  for (const card of (pending ?? []) as any[]) {
    if (card?.metadata?.source !== "sweep") continue;
    if (!cardOnBranch(card?.metadata, branch)) continue;
    // AD.1 (D6): ticks nobody applied keep their card.
    if (hasUnappliedTicks(card?.metadata)) continue;
    await supabase.from("git_change_events")
      .update({
        status: "dismissed",
        resolved_at: new Date().toISOString(),
        metadata: { ...(card.metadata ?? {}), note: "every change it covered is NodeSpec's own" },
      })
      .eq("id", card.id)
      .eq("status", "pending");
  }
}

export type DriftSweepStatus =
  | "no_integration" | "unbaselined" | "throttled" | "clean"
  | "fast_forwarded" | "drift" | "error"
  // R3-3c: branch lifecycle + switch-freshness outcomes
  | "ref_deleted" | "behind_in_sync"
  // AD.2b: an arriving merge filed git's model as a proposal.
  | "load_proposed";

export interface DriftSweepResult {
  status: DriftSweepStatus;
  headSha?: string;
  baseSha?: string;
  changedFileCount?: number;
  residueCount?: number;
  modelChanged?: boolean;
  /** R7c: the range moved `.nodespec/spec.json` — the card offers a spec load. */
  specChanged?: boolean;
  eventId?: string;
  detail?: string;
  /** AD.2b: the load proposal a merge arrival filed. */
  proposalId?: string;
  /** RI-9: repo index freshness outcome for this head (accepted imports only). */
  indexFreshness?: IndexFreshness;
}

/**
 * Run one sweep for a project's bound branch (main by default). Never throws — callers
 * (MCP get_pending_changes, the git panel) must not break when the provider is unreachable.
 * R3-3c: `branchName` scopes the sweep to that branch's ref/baseline; `force` skips the
 * throttle+claim (a branch SWITCH is an explicit user ask, not background polling — the
 * per-branch cumulative-card dedup still prevents duplicates).
 */
// deno-lint-ignore no-explicit-any
export async function runDriftSweep(supabase: any, projectId: string, opts?: { branchName?: string; force?: boolean }): Promise<DriftSweepResult> {
  try {
    const userInitiated = opts?.force === true;

    const { data: integration } = await supabase
      .from("git_integrations")
      .select("id, provider, repo_owner, repo_name, default_branch, base_url, access_token_encrypted, last_drift_check_at")
      .eq("project_id", projectId)
      .maybeSingle();
    if (!integration) return { status: "no_integration" };

    if (!userInitiated) {
      if (!shouldRunSweep(integration.last_drift_check_at, Date.now())) {
        return { status: "throttled" };
      }
      // Atomic claim (compare-and-set). Check-then-write let two concurrent sweeps — the Git
      // panel firing twice on open, or the panel racing an MCP get_pending_changes — BOTH pass
      // the throttle and each insert a "cumulative" event: duplicate cards on the user's first
      // interaction (bench-caught 2026-07-18). Only the caller whose UPDATE still matches the
      // row's previous last_drift_check_at wins; the loser matches 0 rows and yields.
      let claim = supabase
        .from("git_integrations")
        .update({ last_drift_check_at: new Date().toISOString() })
        .eq("id", integration.id);
      claim = integration.last_drift_check_at == null
        ? claim.is("last_drift_check_at", null)
        : claim.eq("last_drift_check_at", integration.last_drift_check_at);
      const { data: claimed } = await claim.select("id");
      if (!claimed || (Array.isArray(claimed) && claimed.length === 0)) {
        return { status: "throttled", detail: "another sweep claimed this window" };
      }
    }

    // AD.4 (D15): no branch named means the primary branch, found by its
    // flag. The literal "main" missed once connect renamed the primary to the
    // git default's name.
    const { data: branch } = opts?.branchName
      ? await supabase
        .from("branches")
        .select("id, name, git_ref, last_synced_commit, is_primary")
        .eq("project_id", projectId)
        .eq("name", opts.branchName)
        .maybeSingle()
      : { data: await getPrimaryBranch(supabase, projectId, "id, name, git_ref, last_synced_commit, is_primary") };
    if (!branch) return { status: "error", detail: opts?.branchName ? `No '${opts.branchName}' branch` : "No primary branch" };
    const branchName: string = branch.name;
    // Cards from before R3-3c name no branch; they are the primary's.
    const onPrimary = isPrimaryRow(branch);

    const ref = branch.git_ref || integration.default_branch;
    const baseline = branch.last_synced_commit;
    if (!baseline) return { status: "unbaselined", detail: "Push or pull once to establish a sync baseline" };

    let token = integration.access_token_encrypted;
    if (isEncrypted(token)) {
      const { plaintext } = await decryptWithUpgrade(token);
      token = plaintext;
    }
    token = (token ?? "").trim();

    const apiBase = providerApiBase(integration.provider, integration.base_url);
    const headResult = await fetchRemoteHeadShaDetailed(integration.provider, apiBase, integration.repo_owner, integration.repo_name, ref, token);
    const head = headResult.sha;
    if (!head) {
      // R3-3c: a bound, baselined, non-main ref answering 404 is the post-PR-merge
      // signature (merged + "delete branch"). Offer the lifecycle choice as a card —
      // Archive (deleteBranch) or Keep — and NEVER touch any baseline from it.
      if (headResult.status === 404 && branch.git_ref && baseline && !isPrimaryRow({ ...branch, name: branchName })) {
        const { data: pendingRD } = await supabase
          .from("git_change_events")
          .select("id, metadata")
          .eq("project_id", projectId)
          .eq("status", "pending");
        // deno-lint-ignore no-explicit-any
        const existing = ((pendingRD ?? []) as any[]).find((e) =>
          e?.metadata?.source === "ref-deleted" && e?.metadata?.branchName === branchName
        );
        if (existing) return { status: "ref_deleted", eventId: existing.id };
        const { data: inserted } = await supabase
          .from("git_change_events")
          .insert({
            integration_id: integration.id,
            project_id: projectId,
            commit_sha: baseline,
            commit_message: `The git branch "${ref}" no longer exists — it was likely merged and deleted after a pull request. Archive this design branch? Archiving removes the NodeSpec branch and its local change log (the merged work lives in git). Keep it if you plan to recreate the ref.`,
            changed_files: [],
            status: "pending",
            metadata: { source: "ref-deleted", branchName, ref },
          })
          .select("id")
          .maybeSingle();
        return { status: "ref_deleted", eventId: inserted?.id };
      }
      const where = `${integration.repo_owner}/${integration.repo_name}@${ref}`;
      const hint = headResult.status === 404
        ? `branch "${ref}" was not found — it may have been deleted or renamed; re-save the integration with the current branch`
        : headResult.status === 401 || headResult.status === 403
          ? "the access token was rejected — it may have expired or lost permissions; re-save the integration with a fresh token"
          : headResult.status
            ? `provider returned HTTP ${headResult.status}`
            : "network error reaching the provider";
      return { status: "error", detail: `Could not resolve remote HEAD for ${where}: ${hint}` };
    }

    // AD.3a (D18): test results held for a commit that was not on the tracked
    // branch count once the head is it or descends from it. Evidence is not
    // a design change, so this runs whatever the sweep decides below.
    if (isPrimaryRow({ ...branch, name: branchName })) {
      try {
        await releaseHeldEvidence(supabase, {
          projectId, headSha: head,
          ancestry: ancestryFor(integration.provider, apiBase, integration.repo_owner, integration.repo_name, token),
        });
      } catch (err) {
        console.warn("[git-drift] held evidence was not released this time:", err);
      }
    }

    if (head === baseline) return { status: "clean", headSha: head };

    // AD.1 (D1, D12): the range with NodeSpec's own writing from this branch
    // told apart by recorded sha and blob, never by commit message.
    const range = await readRange(supabase, {
      provider: integration.provider, apiBase, owner: integration.repo_owner, repo: integration.repo_name, token,
      integrationId: integration.id, branchId: branch.id, base: baseline, head, ref,
    });
    const compare = range.ok ? range.compare : null;

    // RI-9: the repo index (accepted import) is refreshed by blob sha on
    // every sweep that found a moved head — one tree call + one SQL diff,
    // bounded re-extraction, deleted paths dropped. Best-effort: a
    // provider or SQL failure is reported on the card, never thrown.
    const indexFreshness = await refreshRepoIndexForBranch(supabase, {
      fetchTree: async () => {
        const { tree, truncated } = await fetchFullGitHubTree(
          apiBase, integration.repo_owner, integration.repo_name, ref, buildGitHubHeaders(token),
        );
        return {
          // deno-lint-ignore no-explicit-any
          entries: (tree as any[]).filter((t) => t.type === "blob").map((t) => ({ path: t.path, sha: t.sha, size: t.size })),
          truncated,
        };
      },
      fetchFiles: (paths) => fetchGitHubFiles(apiBase, integration.repo_owner, integration.repo_name, head, token, paths),
    }, { branchId: branch.id, headSha: head, provider: integration.provider });

    // Owner bench 2026-07-30 (DATA-LOSS edge case: "merged a branch to main, the
    // artifact did not exist on main and NodeSpec will not detect it"): "our own
    // commits" never implies "this canvas has them". A merge brings commits
    // NodeSpec wrote on ANOTHER branch, so only this branch's own writing moves
    // the baseline here; the merge lane below files git's model as a proposal.
    // AD.1: when everything in the range is NodeSpec's own writing from this
    // branch, there is nothing to review: the baseline moves forward and a
    // pending card that covered only that range is dismissed.
    if (range.ok && range.foreign.length === 0) {
      const moved = await advanceBaseline(supabase, {
        branchId: branch.id, to: head,
        ancestry: ancestryFor(integration.provider, apiBase, integration.repo_owner, integration.repo_name, token),
      });
      if (moved.moved || moved.outcome === "same") {
        await dismissCardsCoveredByOwnRange(supabase, projectId, { name: branchName, isPrimary: onPrimary });
        return {
          status: "fast_forwarded", headSha: head, baseSha: baseline, modelChanged: false, indexFreshness,
          detail: "every change since the last sync is NodeSpec's own",
        };
      }
    }

    // AD.1 (D12): a merge arrives only when every file it changed carries a
    // blob NodeSpec wrote from some branch (a merge, squash or rebase changes
    // shas but never blobs), never on a commit message.
    // Bench 2026-09-25: a recognised merge that still ends as a card says why.
    let mergeNotFiled: string | null = null;
    if (range.ok && range.foreignAnyBranch.length === 0) {
      // Owner bench 2026-07-29: a merged NodeSpec PR coming home is OUR content —
      // "a PR brings the merge up". Load the ref's model instead of raising a
      // "# changes" card against ourselves. Guarded: only when this branch's
      // canvas still equals its baseline (nobody designed locally in between);
      // a guard failure falls through to the honest ladder below.
      // AD.2b (D4): the merge is filed as a load proposal a person accepts,
      // never loaded under an open editor. Accepting it moves the last sync.
      const filed = await fileModelLoadProposal(supabase, projectId, branchName, {
        requestedBy: "automatic", requireCanvasMatchesBaseline: true,
      });
      if (filed.ok && filed.status !== "identical") {
        return {
          status: "load_proposed", headSha: filed.headSha, baseSha: baseline, modelChanged: true,
          proposalId: filed.proposalId, indexFreshness,
          detail: `NodeSpec merge arrived on ${ref}: git's model is waiting in Proposals`,
        };
      }
      if (filed.ok) {
        return {
          status: "fast_forwarded", headSha: filed.headSha, baseSha: baseline, modelChanged: true, indexFreshness,
          detail: filed.baselineMoved
            ? `NodeSpec merge arrived on ${ref}: the canvas already holds its model`
            : `NodeSpec merge arrived on ${ref}: the canvas already holds its model; ${filed.baselineNote ?? "the last sync stays where it was"}`,
        };
      }
      mergeNotFiled = `NodeSpec merge arrived on ${ref} but git's model was not filed (${filed.code}: ${filed.message}); the change card asks instead`;
    }

    const files: ChangedFile[] = range.ok ? range.foreign : [];
    const match = await matchFilesToArtifacts(supabase, projectId, files, branchName);
    const matchedPaths = new Set(match.matches.map((m) => m.path));
    const { modelChanged, specChanged, residuePaths } = classifySweepFiles(files, matchedPaths);

    // R3-2: when the range touched model.json, attach the ENTITY-level diff so the
    // card's Accept/Load choice is informed, not blind. Best-effort — a diff failure
    // never degrades the sweep itself (booleans stay false → the conservative card).
    // R3-3c: the same pass computes the freshness ladder's inputs.
    let modelDiff: CappedAnchorDiff | null = null;
    let canvasMatchesHead = false;
    let canvasMatchesBaseline = false;
    if (modelChanged) {
      try {
        const repoAnchorText = await fetchRepoFile(
          integration.provider, apiBase, integration.repo_owner, integration.repo_name,
          MODEL_ANCHOR_PATH, ref, token,
        );
        const repoParsed = repoAnchorText ? parseModel(repoAnchorText) : null;
        const { graph: snapGraph } = await loadLatestSnapshot(supabase, branch.id);
        const graph = snapGraph ?? {};
        const ownParsed = parseModel(await serializeModel(graph));
        if (repoParsed?.ok && ownParsed.ok) {
          modelDiff = capAnchorDiff(diffAnchors(ownParsed.model, repoParsed.model));
          // R7d: never the stored hashes: a legacy repo anchor hashed a mappings
          // section that no longer exists, and comparing stored hashes would
          // card every pre-R7d repo. AD.2: the whole design when the repo's
          // anchor carries it (a configuration change in git is a change), the
          // architecture when it is version 1.
          canvasMatchesHead = await sameDesign(ownParsed.model, repoParsed.model);
        }
        // "Working copy untouched since baseline?" costs one more provider call —
        // fetch it only when a silent auto-restore is even on the table.
        if (userInitiated && ownParsed.ok && !canvasMatchesHead && residuePaths.length === 0) {
          const baselineAnchorText = await fetchRepoFile(
            integration.provider, apiBase, integration.repo_owner, integration.repo_name,
            MODEL_ANCHOR_PATH, baseline, token,
          );
          const baselineParsed = baselineAnchorText ? parseModel(baselineAnchorText) : null;
          canvasMatchesBaseline = baselineParsed?.ok === true && ownParsed.ok &&
            await sameDesign(ownParsed.model, baselineParsed.model);
        }
      } catch (diffErr) {
        console.warn("[git-drift] model diff computation failed (sweep continues):", diffErr);
      }
    }

    // R7c: the same treatment for the spec plane. Deliberately does NOT feed
    // decideBranchFreshness — that ladder decides whether to auto-load the
    // ARCHITECTURE, and a requirement edit must never silently replace a canvas.
    // A spec change always asks; it never acts on its own.
    let specDiff: CappedSpecDiff | null = null;
    if (specChanged) {
      try {
        const repoSpecText = await fetchRepoFile(
          integration.provider, apiBase, integration.repo_owner, integration.repo_name,
          SPEC_ANCHOR_PATH, ref, token,
        );
        const repoSpec = repoSpecText ? parseSpec(repoSpecText) : null;
        if (repoSpec?.ok) {
          const ourPlane = await loadSpecPlane(supabase, projectId, { constraintsCarried: await constraintsCarried(supabase as never, projectId) });
          const ourSpec = ourPlane
            ? parseSpec(await serializeSpec(ourPlane.spec, ourPlane.requirements, ourPlane.mappings))
            : parseSpec(await serializeSpec({ vision: "" }, [], []));
          if (ourSpec.ok) specDiff = capSpecDiff(diffSpecs(ourSpec.spec, repoSpec.spec));
        }
      } catch (specErr) {
        console.warn("[git-drift] spec diff computation failed (sweep continues):", specErr);
      }
    }

    // R5b: COMPLETION PROVENANCE — a changed task doc carries ticked checkboxes,
    // which are the rendered form of per-criterion `met`. A developer or an AI
    // ticking a box in git is already producing the signal; nothing read it. Fetch
    // the changed task docs, diff their boxes against the database, and hang the
    // result on the card so the accept lane can apply it with provenance.
    // Best-effort: a failure here never degrades the sweep (the card still lands).
    let criterionDeltas: CriterionDeltaResult | null = null;
    // A4: the second checkbox family — anchored implementation tasks — rides
    // the same card. Same rules: task-kind matches only, best-effort.
    let taskDeltas: TaskDeltaResult | null = null;
    const taskDocMatches = match.matches.filter((m) => m.kind === "task");
    if (taskDocMatches.length > 0) {
      try {
        criterionDeltas = await computeSweepCriterionDeltas(
          supabase, projectId, integration, apiBase, token, ref, taskDocMatches.map((m) => m.path),
        );
      } catch (deltaErr) {
        console.warn("[git-drift] criterion delta computation failed (sweep continues):", deltaErr);
      }
      try {
        taskDeltas = await computeSweepTaskDeltas(supabase, projectId, {
          integration, apiBase, token, ref,
          files: taskDocMatches.map((m) => ({ path: m.path, nodeId: m.nodeId })),
          fetchFile: fetchRepoFile,
        });
      } catch (deltaErr) {
        console.warn("[git-drift] task delta computation failed (sweep continues):", deltaErr);
      }
    }

    // D2: ticks in BOARD.md ride the SAME card, merged into the same delta
    // arrays (dedup — a tick may appear in both the board and a task doc).
    if (files.some((f) => f.path === BOARD_PATH)) {
      try {
        const boardDeltas = await computeSweepBoardDeltas(supabase, projectId, { integration, apiBase, token, ref });
        if (boardDeltas) {
          criterionDeltas = criterionDeltas
            ? mergeCriterionDeltaResults(criterionDeltas, boardDeltas.criterionDeltas)
            : boardDeltas.criterionDeltas;
          taskDeltas = taskDeltas
            ? mergeTaskDeltaResults(taskDeltas, boardDeltas.taskDeltas)
            : boardDeltas.taskDeltas;
        }
      } catch (boardErr) {
        console.warn("[git-drift] board delta computation failed (sweep continues):", boardErr);
      }
    }

    // B3: declared new files — read-only resolve, same producer parity as the
    // webhook. Computed when the range touched the declaration file or left
    // residue the declarations might cover.
    let bindingResolution: BindingResolution | null = null;
    if (files.some((f) => f.path === BINDINGS_PATH) || residuePaths.length > 0) {
      try {
        bindingResolution = await computeSweepBindingResolution(supabase, projectId, {
          integration, apiBase, token, ref, branchName, fetchFile: fetchRepoFile,
        });
      } catch (bindErr) {
        console.warn("[git-drift] binding resolution failed (sweep continues):", bindErr);
      }
    }

    const action = decideBranchFreshness({
      refDeleted: false,
      refMoved: true,
      modelChanged,
      canvasMatchesHead,
      canvasMatchesBaseline,
      matchedArtifactCount: match.matches.length,
      residueCount: residuePaths.length,
      userInitiated,
      // Conservative when the diff could not be computed: `specChanged` with no
      // usable diff means "the requirements moved and we cannot prove they match",
      // which must block the auto lanes exactly like a proven divergence.
      specDivergent: specChanged && (specDiff === null || !specDiff.identical),
      specChanged,
      carriesTicks: hasUnappliedTicks({ criterionDeltas, taskDeltas }),
    });
    if (action === "baseline-fast-forward") {
      // The canvas already IS the repo HEAD model and nothing else changed in the
      // range: pure bookkeeping, no question to ask anyone. AD.1: through the
      // one writer, forward only; a move the provider cannot confirm falls
      // through to an ordinary card.
      const moved = await advanceBaseline(supabase, {
        branchId: branch.id, to: head,
        ancestry: ancestryFor(integration.provider, apiBase, integration.repo_owner, integration.repo_name, token),
      });
      if (moved.moved || moved.outcome === "same") {
        return { status: "fast_forwarded", headSha: head, baseSha: baseline, modelChanged, indexFreshness, detail: "canvas already matches the repo HEAD model" };
      }
    }
    if (action === "auto-restore") {
      // No card: the caller (branch switch) runs the R3-1 loader, which advances
      // the baseline and resolves any pending model cards itself.
      // RI-9 (bench 2026-09-04): the index refresh already ran for this head;
      // every post-freshness return reports it, this lane included.
      return { status: "behind_in_sync", headSha: head, baseSha: baseline, modelChanged: true, indexFreshness, detail: "working copy untouched since its baseline — safe to load the ref's model" };
    }

    // AD.3 (D23): the card says who changed which file. Each commit NodeSpec
    // did not write (newest MAX_ATTRIBUTED_COMMITS) is asked for its files; a
    // file no read commit accounts for stays unattributed, never guessed.
    let authors: AuthorGroup[] = [];
    if (range.ok && files.length > 0) {
      const foreignCommits = range.compare.commits.filter((c) => !range.recorded.has(c.sha)).slice(-MAX_ATTRIBUTED_COMMITS);
      const withFiles = await Promise.all(foreignCommits.map(async (c) => ({
        sha: c.sha,
        author: c.author ?? null,
        files: await fetchCommitFiles(integration.provider, apiBase, integration.repo_owner, integration.repo_name, c.sha, token),
      })));
      authors = groupFilesByAuthor(withFiles, files.map((f) => f.path)).authors;
    }

    const commitCount = compare?.commits.length ?? 0;
    const summary = compare
      ? `${commitCount} out-of-band commit(s) on ${ref} (${files.length} file(s) changed since last sync)`
      : `Out-of-band changes on ${ref} (provider compare unavailable — possible force push)`;

    const metadata = {
      source: "sweep",
      branch: ref,
      // R3-3c: the NodeSpec branch this card belongs to — resolution advances THIS
      // row's baseline (a feature card must never stamp its sha onto main).
      branchName,
      baseSha: baseline,
      commitCount,
      artifactMatches: match.matches,
      ...(match.error ? { matchError: match.error } : {}),
      modelChanged,
      // R7c: the requirements moved in the repo — the card offers a spec load.
      specChanged,
      // R5b: ticked acceptance criteria found in the changed task docs.
      ...(criterionDeltas && (criterionDeltas.deltas.length > 0 || criterionDeltas.flagged.length > 0)
        ? { criterionDeltas }
        : {}),
      // A4: ticked implementation tasks found in the changed task docs.
      ...(taskDeltas && (taskDeltas.deltas.length > 0 || taskDeltas.flagged.length > 0)
        ? { taskDeltas }
        : {}),
      // B3: declared new files awaiting their bind.
      ...(bindingResolution ? { bindingResolution } : {}),
      residuePaths,
      ...(authors.length > 0 ? { authors } : {}),
      ...(modelDiff ? { modelDiff } : {}),
      ...(specDiff ? { specDiff } : {}),
      ...(compare ? {} : { compareFailed: true }),
      // RI-9: what the repo index learned from this head (stale nodes by sha).
      ...(indexFreshness.status !== "no_index" ? { indexFreshness } : {}),
    };

    const eventId = await upsertCumulativeSweepEvent(supabase, {
      integrationId: integration.id,
      projectId,
      headSha: head,
      summary,
      files,
      author: authorLine(authors),
      metadata,
      isPrimary: onPrimary,
    });

    return {
      status: "drift", headSha: head, baseSha: baseline,
      changedFileCount: files.length, residueCount: residuePaths.length, modelChanged, specChanged, eventId,
      indexFreshness,
      ...(mergeNotFiled ? { detail: mergeNotFiled } : {}),
    };
  } catch (err) {
    return { status: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

// ── R7c: plane-aware card resolution ──────────────────────────────────────────
// A sweep card can flag TWO independent questions: "the architecture moved" and
// "the requirements moved". Loading one plane answers only that half. Before R7c
// the model restore resolved every pending card unconditionally, so a card that
// also carried a spec change had the spec question silently discarded — the
// merge-swallow failure mode again, one plane over.
//
// A card now resolves only once every plane it flagged has been loaded; the
// planes covered so far are recorded on the card. Cards raised before this
// existed flag only the model, so their behavior is unchanged by construction.

/** Which planes a card is asking about. */
// deno-lint-ignore no-explicit-any
export function cardFlaggedPlanes(metadata: any): string[] {
  const planes: string[] = [];
  // Anything but an explicit spec-only card asks the architecture question:
  // connect-anchor-mismatch cards predate `modelChanged` and are model by nature.
  if (metadata?.modelChanged !== false || metadata?.source === "connect-anchor-mismatch") planes.push("model");
  if (metadata?.specChanged === true) planes.push("spec");
  return planes;
}

/** True once `covered` accounts for every plane the card flagged. */
// deno-lint-ignore no-explicit-any
export function cardFullyAnswered(metadata: any, covered: string[]): boolean {
  const flagged = cardFlaggedPlanes(metadata);
  return flagged.every((p) => covered.includes(p));
}

// ── AD.1 (D6, D7): a load answers only its own cards ─────────────────────────
// A load used to accept every pending sweep card in the project, on any
// branch, and a card that flagged no plane (content only) counted as
// answered; its ticks, bound files and residue went with it. Now a load
// answers a card only when the card is this branch's, every plane it flagged
// has been loaded, and it holds nothing a load does not answer.

/** Residue on the card nobody ignored. */
// deno-lint-ignore no-explicit-any
function openResidue(metadata: any): string[] {
  const ignored = new Set<string>(Array.isArray(metadata?.ignoredResidue) ? metadata.ignoredResidue : []);
  const residue: string[] = Array.isArray(metadata?.residuePaths) ? metadata.residuePaths : [];
  return residue.filter((p) => !ignored.has(p));
}

/** True when the loads in `covered` answer every question the card asks: at
 *  least one plane flagged and each one loaded, and no bound file to accept,
 *  no residue nobody bound or ignored, and no tick nobody applied. */
// deno-lint-ignore no-explicit-any
export function cardAnsweredByLoads(metadata: any, covered: string[]): boolean {
  const flagged = cardFlaggedPlanes(metadata);
  if (flagged.length === 0) return false;
  if (!flagged.every((p) => covered.includes(p))) return false;
  if (Array.isArray(metadata?.artifactMatches) && metadata.artifactMatches.length > 0) return false;
  if (openResidue(metadata).length > 0) return false;
  if (hasUnappliedTicks(metadata)) return false;
  return true;
}

/** Whether a card belongs to this branch. A card with no branch name is the
 *  primary branch's, except a webhook card for a ref no branch is bound to,
 *  which is nobody's. */
// deno-lint-ignore no-explicit-any
export function cardOnBranch(metadata: any, branch: { name: string; isPrimary: boolean }): boolean {
  const name = metadata?.branchName;
  if (typeof name === "string" && name) return name === branch.name;
  if (metadata?.unmappedRef) return false;
  return branch.isPrimary;
}

export interface LoadCardPlan {
  // deno-lint-ignore no-explicit-any
  answered: Array<{ id: string; commitSha: string; metadata: any }>;
  // deno-lint-ignore no-explicit-any
  progressed: Array<{ id: string; commitSha: string; metadata: any }>;
}

/** Pure: what a load of `plane` at `headSha` does to the pending cards. A
 *  card that flagged the plane records it; one the loads now fully answer is
 *  accepted; every other card is left as it is. */
export function planCardsAfterLoad(
  // deno-lint-ignore no-explicit-any
  cards: any[],
  plane: "model" | "spec",
  branch: { name: string; isPrimary: boolean },
  headSha: string,
): LoadCardPlan {
  const plan: LoadCardPlan = { answered: [], progressed: [] };
  for (const card of cards) {
    const meta = card?.metadata ?? {};
    if (meta.source !== "connect-anchor-mismatch" && meta.source !== "sweep") continue;
    if (!cardOnBranch(meta, branch)) continue;
    if (!cardFlaggedPlanes(meta).includes(plane)) continue;
    const covered = Array.from(new Set([...(Array.isArray(meta.restoredPlanes) ? meta.restoredPlanes : []), plane]));
    const metadata = { ...meta, restoredPlanes: covered, restoredHeadSha: headSha };
    if (cardAnsweredByLoads(meta, covered)) {
      plan.answered.push({ id: card.id, commitSha: card.commit_sha, metadata: { ...metadata, resolution: "restored-from-repo" } });
    } else {
      plan.progressed.push({ id: card.id, commitSha: card.commit_sha, metadata });
    }
  }
  return plan;
}

/** Pure (I3): a load moves the baseline forward only when everything in
 *  baseline..head that NodeSpec did not write, from any branch, is the anchor
 *  the load brought in. Anything else stays for the sync check, which
 *  fast-forwards once the project matches git or puts it on a card. */
export function loadCoversRange(foreignAnyBranch: Array<{ path: string; oldPath?: string }>, anchorPath: string): boolean {
  return foreignAnyBranch.every((f) => f.path === anchorPath && !f.oldPath);
}

export const LOAD_KEPT_BASELINE_NOTE =
  "The last sync stays where it was: git has other changes since, and the next check puts them on a card.";

/** Accept the cards the load answered and record the plane on the rest, each
 *  only while it is pending and still the version read. No baseline moves
 *  here: the load decides that from the range. */
// deno-lint-ignore no-explicit-any
export async function resolveCardsAfterRestore(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  projectId: string,
  headSha: string,
  plane: "model" | "spec",
  branch: { name: string; isPrimary: boolean },
): Promise<{ answered: number; progressed: number }> {
  const { data: pendingCards } = await supabase
    .from("git_change_events")
    .select("id, commit_sha, metadata")
    .eq("project_id", projectId)
    .eq("status", "pending");
  const plan = planCardsAfterLoad(pendingCards ?? [], plane, branch, headSha);
  for (const card of plan.answered) {
    await supabase.from("git_change_events")
      .update({ status: "accepted", resolved_at: new Date().toISOString(), metadata: card.metadata })
      .eq("id", card.id)
      .eq("status", "pending")
      .eq("commit_sha", card.commitSha);
  }
  for (const card of plan.progressed) {
    // Half-answered: record the progress, keep the card open. What remains is
    // still live and must not vanish.
    await supabase.from("git_change_events")
      .update({ metadata: card.metadata })
      .eq("id", card.id)
      .eq("status", "pending")
      .eq("commit_sha", card.commitSha);
  }
  return { answered: plan.answered.length, progressed: plan.progressed.length };
}

/** After a load: move the baseline as planned when it is a first baseline or
 *  a person's re-anchor, or forward only when the range holds nothing but the
 *  anchor loaded (`loadCoversRange`). Exported for offline tests. */
export async function moveBaselineAfterLoad(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    plan: BaselinePlan;
    anchorPath: string;
    provider: string; apiBase: string; owner: string; repo: string; token: string;
    integrationId: string;
  },
): Promise<{ moved: boolean; note: string | null }> {
  const { plan } = args;
  if (!plan.decision.move) return { moved: false, note: baselineOutcomeNote(plan.decision.outcome) };
  if (plan.decision.outcome === "forward" && plan.current) {
    const range = await readRange(supabase, {
      provider: args.provider, apiBase: args.apiBase, owner: args.owner, repo: args.repo, token: args.token,
      integrationId: args.integrationId, branchId: plan.branchId, base: plan.current, head: plan.to,
    });
    if (!range.ok || !loadCoversRange(range.foreignAnyBranch, args.anchorPath)) {
      return { moved: false, note: LOAD_KEPT_BASELINE_NOTE };
    }
  }
  const written = await writeBaselineMove(supabase, plan);
  return { moved: written.moved, note: written.moved ? null : baselineOutcomeNote(written.outcome) };
}

// ── R7c: spec restore (shared core) ───────────────────────────────────────────
// The spec-plane twin of the model load. Deliberately separate: the
// two anchors move independently, and a user who wants the repo's requirements
// must not be forced to also replace their canvas.

export type RestoreSpecResult =
  | {
    ok: true;
    headSha: string;
    ref: string;
    specHash: string;
    mode: "adopted" | "applied";
    counts: unknown;
    keptLocal?: string[];
    /** AD.2c: locked requirements git changed; not written. */
    locked?: string[];
    baselineMoved: boolean;
    baselineNote?: string;
  }
  | {
    ok: false;
    code: "no-integration" | "no-branch" | "no-head" | "read-failed" | "no-spec-file" | "invalid-spec" | "hash-failed" | "no-owner" | "write-failed";
    message: string;
  };

// deno-lint-ignore no-explicit-any
export async function restoreSpecFromRef(supabase: any, projectId: string, branchName: string): Promise<RestoreSpecResult> {
  const { data: integration } = await supabase
    .from("git_integrations")
    .select("id, provider, repo_owner, repo_name, default_branch, base_url, access_token_encrypted")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!integration) return { ok: false, code: "no-integration", message: "No git integration for this project" };

  let token = integration.access_token_encrypted;
  if (isEncrypted(token)) {
    const { plaintext } = await decryptWithUpgrade(token);
    token = plaintext;
  }
  token = (token ?? "").trim();
  const apiBase = providerApiBase(integration.provider, integration.base_url);

  const { data: branch } = await supabase
    .from("branches")
    .select("id, git_ref, last_synced_commit, is_primary")
    .eq("project_id", projectId)
    .eq("name", branchName)
    .maybeSingle();
  if (!branch) return { ok: false, code: "no-branch", message: `No '${branchName}' branch for this project` };
  const ref = branch.git_ref || integration.default_branch;

  const headResult = await fetchRemoteHeadShaDetailed(
    integration.provider, apiBase, integration.repo_owner, integration.repo_name, ref, token,
  );
  const headSha = headResult.sha;
  if (!headSha) return { ok: false, code: "no-head", message: `Could not resolve remote HEAD for ${ref}` };

  // AD.1 (D11): an unreadable spec is not an absent one.
  const specRead = await readRepoFile(
    integration.provider, apiBase, integration.repo_owner, integration.repo_name, SPEC_ANCHOR_PATH, ref, token,
  );
  if (specRead.status === "failed") {
    return { ok: false, code: "read-failed", message: `Could not read ${SPEC_ANCHOR_PATH} on ${ref} (${specRead.error}); nothing was loaded. Try again.` };
  }
  const specText = specRead.status === "found" ? specRead.text : null;
  if (!specText) {
    return {
      ok: false,
      code: "no-spec-file",
      message: `${SPEC_ANCHOR_PATH} not found on ${ref}. The requirements file ships with every ` +
        `NodeSpec commit since the spec plane moved out of model.json — this ref's last NodeSpec ` +
        `commit predates that. Commit once from the project that owns these requirements, then load again.`,
    };
  }
  const parsed = parseSpec(specText);
  if (!parsed.ok) return { ok: false, code: "invalid-spec", message: parsed.error };

  // SB-4 harness build caught this: the column is owner_id (user_id does not
  // exist on projects) — the select errored, ownerId resolved null, and the
  // ADOPT path of "Load requirements from repo" always failed with no-owner.
  const { data: project } = await supabase
    .from("projects").select("owner_id").eq("id", projectId).maybeSingle();
  const ownerId: string | null = project?.owner_id ?? null;

  const { data: existingSpec } = await supabase
    .from("project_specifications").select("id").eq("project_id", projectId).limit(1).maybeSingle();

  // AD.1: this branch's cards record the load, and those it fully answers are
  // accepted. A spec load never sets a first baseline; on a baselined branch
  // it moves forward only when spec.json is all git changed other than by
  // NodeSpec (`loadCoversRange`).
  const afterSpecLoad = async (): Promise<{ baselineMoved: boolean; baselineNote?: string }> => {
    let moved = false;
    let note: string | null = null;
    if (branch.last_synced_commit) {
      const plan = await planBaselineMove(supabase, {
        branchId: branch.id, to: headSha,
        ancestry: ancestryFor(integration.provider, apiBase, integration.repo_owner, integration.repo_name, token),
      });
      if (plan) {
        const after = await moveBaselineAfterLoad(supabase, {
          plan, anchorPath: SPEC_ANCHOR_PATH,
          provider: integration.provider, apiBase, owner: integration.repo_owner, repo: integration.repo_name, token,
          integrationId: integration.id,
        });
        moved = after.moved;
        note = after.note;
      }
    }
    await resolveCardsAfterRestore(supabase, projectId, headSha, "spec", {
      name: branchName, isPrimary: isPrimaryRow({ ...branch, name: branchName }),
    });
    return { baselineMoved: moved, ...(note ? { baselineNote: note } : {}) };
  };

  // No spec yet → the R7b adopt lane. Already has one → the R7c upsert, which
  // preserves evidence (see mergeCriteria).
  if (!existingSpec) {
    const adopted = await adoptSpecAnchor(supabase, {
      projectId, ownerId, spec: parsed.spec, sourceCommit: headSha,
    });
    if (!adopted.adopted) {
      // "already-has-spec" cannot happen on this branch (we just proved there is
      // none) — a race would land here, and write-failed is the honest report.
      const code: "hash-failed" | "invalid-spec" | "no-owner" | "write-failed" =
        adopted.reason === "already-has-spec" ? "write-failed" : adopted.reason;
      return { ok: false, code, message: adopted.message ?? adopted.reason };
    }
    const after = await afterSpecLoad();
    return { ok: true, headSha, ref, specHash: parsed.spec.specHash, mode: "adopted", counts: adopted.counts, ...after };
  }

  // AD.2c: git's spec at the last sync is the third side of the mapping
  // plan (planSpecMappings): a mapping git removed since then is removed, one
  // only the project has stays. An unreadable baseline refuses the load, as
  // the head's does; a baseline without a readable spec.json removes nothing.
  let baselineSpec: SpecAnchor | null = null;
  if (branch.last_synced_commit === headSha) {
    baselineSpec = parsed.spec;
  } else if (branch.last_synced_commit) {
    const baseRead = await readRepoFile(
      integration.provider, apiBase, integration.repo_owner, integration.repo_name, SPEC_ANCHOR_PATH, branch.last_synced_commit, token,
    );
    if (baseRead.status === "failed") {
      return { ok: false, code: "read-failed", message: `Could not read ${SPEC_ANCHOR_PATH} at the last sync (${baseRead.error}); nothing was loaded. Try again.` };
    }
    if (baseRead.status === "found") {
      const base = parseSpec(baseRead.text);
      if (base.ok) baselineSpec = base.spec;
    }
  }

  const applied = await applySpecAnchor(supabase, {
    projectId, ownerId, spec: parsed.spec, baseline: baselineSpec, sourceCommit: headSha,
  });
  if (!applied.applied) {
    return { ok: false, code: applied.reason === "no-spec" ? "write-failed" : applied.reason, message: applied.message ?? applied.reason };
  }
  const after = await afterSpecLoad();
  return {
    ok: true, headSha, ref, specHash: parsed.spec.specHash,
    mode: "applied", counts: applied.counts, keptLocal: applied.keptLocal,
    ...(applied.locked.length ? { locked: applied.locked } : {}), ...after,
  };
}

// ── AD.2b: loading git's model files a proposal ────────────────────────────────
// A load used to write a new snapshot built from the anchor alone, dropping
// schemas, configuration, positions and file content, and it ran unasked on a
// page load and when a merge arrived (findings D3, D4). No path writes a
// snapshot from git now. The anchor at the ref's head is compared with the
// canvas and filed as ONE proposal of ordinary patches (`anchorLoadPatches`);
// a person accepts it, and only then does the last sync move (git-pull
// `proposal-baseline`, which also answers the cards the load answers). One
// pending load per branch: a newer head replaces the older proposal.

export type ModelLoadResult =
  | {
    ok: true;
    status: "filed" | "already-filed";
    headSha: string;
    proposalId: string;
    patchCount: number;
    notApplied: string[];
  }
  | {
    ok: true;
    /** The canvas already holds git's design: nothing to accept. The cards the
     *  load answers are answered and the last sync moves as a load's does. */
    status: "identical";
    headSha: string;
    baselineMoved: boolean;
    baselineNote?: string;
  }
  | {
    ok: false;
    code: "no-integration" | "no-branch" | "no-head" | "no-anchor" | "read-failed" | "invalid-anchor" | "hash-failed" | "guard-failed" | "cannot-express" | "write-failed";
    message: string;
  };

// deno-lint-ignore no-explicit-any
export async function fileModelLoadProposal(supabase: any, projectId: string, branchName: string, opts: {
  /** "person": someone asked for this load, so accepting it may re-anchor a
   *  rewritten history. "automatic": a page load or an arriving merge; the
   *  last sync only ever moves forward. */
  requestedBy: "person" | "automatic";
  /** Merge arrival: file only when the canvas still equals its baseline's
   *  model (nobody designed locally since); otherwise the sync check's card
   *  asks instead. */
  requireCanvasMatchesBaseline?: boolean;
}): Promise<ModelLoadResult> {
  const { data: integration } = await supabase
    .from("git_integrations")
    .select("id, provider, repo_owner, repo_name, default_branch, base_url, access_token_encrypted")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!integration) return { ok: false, code: "no-integration", message: "No git integration for this project" };

  let token = integration.access_token_encrypted;
  if (isEncrypted(token)) {
    const { plaintext } = await decryptWithUpgrade(token);
    token = plaintext;
  }
  token = (token ?? "").trim();
  const apiBase = providerApiBase(integration.provider, integration.base_url);

  const { data: branch } = await supabase
    .from("branches")
    .select("id, git_ref, last_synced_commit, is_primary")
    .eq("project_id", projectId)
    .eq("name", branchName)
    .maybeSingle();
  if (!branch) return { ok: false, code: "no-branch", message: `No '${branchName}' branch for this project` };
  const ref = branch.git_ref || integration.default_branch;

  const headResult = await fetchRemoteHeadShaDetailed(
    integration.provider, apiBase, integration.repo_owner, integration.repo_name, ref, token,
  );
  const headSha = headResult.sha;
  if (!headSha) {
    return { ok: false, code: "no-head", message: `Could not resolve remote HEAD for ${integration.repo_owner}/${integration.repo_name}@${ref}` };
  }

  // AD.1 (D11): an unreadable anchor is not an absent one.
  const anchorRead = await readRepoFile(
    integration.provider, apiBase, integration.repo_owner, integration.repo_name, MODEL_ANCHOR_PATH, headSha, token,
  );
  if (anchorRead.status === "failed") {
    return { ok: false, code: "read-failed", message: `Could not read ${MODEL_ANCHOR_PATH} on ${ref} (${anchorRead.error}); nothing was filed. Try again.` };
  }
  if (anchorRead.status === "absent") {
    return { ok: false, code: "no-anchor", message: `The repository has no ${MODEL_ANCHOR_PATH} on ${ref}; there is nothing to load` };
  }
  const parsed = parseModel(anchorRead.text);
  if (!parsed.ok) return { ok: false, code: "invalid-anchor", message: `Repo model anchor is invalid: ${parsed.error}` };
  if (!(await verifyModelHash(parsed.model))) {
    return { ok: false, code: "hash-failed", message: "Repo model anchor failed hash verification (tampered or hand-edited); refusing to load it" };
  }

  const { graph: snapGraph, patchSequence } = await loadLatestSnapshot(supabase, branch.id);
  const canvas = snapGraph ?? {};
  const oursParsed = parseModel(await serializeModel(canvas));

  if (opts.requireCanvasMatchesBaseline) {
    if (!branch.last_synced_commit) {
      return { ok: false, code: "guard-failed", message: "Branch has no sync baseline; a merge is not loaded on its own" };
    }
    const baselineRead = await readRepoFile(
      integration.provider, apiBase, integration.repo_owner, integration.repo_name, MODEL_ANCHOR_PATH, branch.last_synced_commit, token,
    );
    const baselineParsed = baselineRead.status === "found" ? parseModel(baselineRead.text) : null;
    const untouched = baselineParsed?.ok === true && oursParsed.ok && await sameDesign(oursParsed.model, baselineParsed.model);
    if (!untouched) {
      return { ok: false, code: "guard-failed", message: "The canvas changed since the last sync; the change card asks instead" };
    }
  }

  const isPrimary = isPrimaryRow({ ...branch, name: branchName });
  const ancestry = ancestryFor(integration.provider, apiBase, integration.repo_owner, integration.repo_name, token);

  // The canvas already holds git's design: nothing for a person to accept.
  if (oursParsed.ok && await sameDesign(oursParsed.model, parsed.model)) {
    const plan = await planBaselineMove(supabase, { branchId: branch.id, to: headSha, ancestry, reanchor: opts.requestedBy === "person" });
    const after = plan
      ? await moveBaselineAfterLoad(supabase, {
        plan, anchorPath: MODEL_ANCHOR_PATH,
        provider: integration.provider, apiBase, owner: integration.repo_owner, repo: integration.repo_name, token,
        integrationId: integration.id,
      })
      : { moved: false, note: baselineOutcomeNote("no-branch") };
    await resolveCardsAfterRestore(supabase, projectId, headSha, "model", { name: branchName, isPrimary });
    return { ok: true, status: "identical", headSha, baselineMoved: after.moved, ...(after.note ? { baselineNote: after.note } : {}) };
  }

  const nowIso = new Date().toISOString();
  const load = await anchorLoadPatches(canvas, parsed.model, { actorId: "git-load", sourceCommit: headSha, nowIso });
  if (load.patches.length === 0) {
    return {
      ok: false, code: "cannot-express",
      message: `Git's model differs from the canvas only in ways a proposal cannot express: ${load.notApplied.join(" ")}`,
    };
  }

  // One pending load per branch. The same head is the same proposal (a person
  // asking for it makes it theirs); an older head is replaced.
  const { data: pending } = await supabase
    .from("ai_proposals")
    .select("id, metadata, patches")
    .eq("source_branch_id", branch.id)
    .eq("status", "pending");
  // deno-lint-ignore no-explicit-any
  for (const row of ((pending ?? []) as any[]).filter((r) => r?.metadata?.source === "git-load")) {
    if (row.metadata?.loadsModel?.headSha === headSha) {
      if (opts.requestedBy === "person" && row.metadata.loadsModel.reanchor !== true) {
        await supabase.from("ai_proposals")
          .update({ metadata: { ...row.metadata, loadsModel: { ...row.metadata.loadsModel, reanchor: true } } })
          .eq("id", row.id);
      }
      const patchCount = Array.isArray(row.patches) ? row.patches.length : load.patches.length;
      return { ok: true, status: "already-filed", headSha, proposalId: row.id, patchCount, notApplied: row.metadata?.notApplied ?? [] };
    }
    await supabase.from("ai_proposals")
      .update({
        status: "rejected",
        reviewed_at: nowIso,
        metadata: { ...row.metadata, resolveNote: `Replaced by a load of a newer commit (${headSha.slice(0, 8)}).` },
      })
      .eq("id", row.id)
      .eq("status", "pending");
  }

  const aiRunId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const { error: runError } = await supabase.from("ai_runs").insert({
    id: aiRunId, project_id: projectId, branch_id: branch.id,
    model: "git-load", prompt_hash: "git-load", status: "completed",
    completed_at: nowIso,
    metadata: { source: "git-load", modelHash: parsed.model.modelHash, patchCount: load.patches.length },
  });
  if (runError) return { ok: false, code: "write-failed", message: `Could not file the load: ${runError.message}` };
  const { error: propError } = await supabase.from("ai_proposals").insert({
    id: proposalId, ai_run_id: aiRunId,
    source_branch_id: branch.id, proposal_branch_id: branch.id,
    status: "pending",
    patches: load.patches.map((patch, i) => ({ patch, status: "pending", explanation: load.explanations[i] })),
    validation_expectations: [],
    metadata: {
      source: "git-load",
      // The commit the design was read at; accepting moves the last sync here.
      loadsModel: { headSha, branchName, modelHash: parsed.model.modelHash, reanchor: opts.requestedBy === "person" },
      // The canvas the diff was taken against: a later change to the same
      // entities is a conflict at accept, as for any proposal (V3 2.1).
      ...(patchSequence !== null ? { baseSequence: patchSequence } : {}),
      counts: load.counts,
      ...(load.notApplied.length > 0 ? { notApplied: load.notApplied } : {}),
    },
  });
  if (propError) return { ok: false, code: "write-failed", message: `Could not file the load: ${propError.message}` };
  return { ok: true, status: "filed", headSha, proposalId, patchCount: load.patches.length, notApplied: load.notApplied };
}


// ── R5b/R5c: completion provenance — the git→`met` lane ───────────────────────
// A task doc is a normal repo file whose acceptance-criteria checkboxes RENDER the
// per-criterion `met` flags. Ticking one in git is therefore already the signal;
// these two functions read it and, on the user's approval, apply it.
//
// The owner's rule (2026-07-21) is what shapes this: git ticks flow **via the drift
// card — one approval, never silent**. A file in a repository must not be able to
// mutate the spec plane on its own.

/** Load the project's current criteria, keyed by REQ id. */
// deno-lint-ignore no-explicit-any
async function loadCurrentCriteria(supabase: any, projectId: string): Promise<Record<string, CurrentCriterion[]>> {
  const { data: spec } = await supabase
    .from("project_specifications").select("id").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!spec) return {};
  const { data: reqs } = await supabase
    .from("specification_requirements")
    .select("requirement_id, acceptance_criteria")
    .eq("specification_id", spec.id);
  const out: Record<string, CurrentCriterion[]> = {};
  // deno-lint-ignore no-explicit-any
  for (const r of ((reqs ?? []) as any[])) {
    const list = Array.isArray(r.acceptance_criteria) ? r.acceptance_criteria : [];
    // AD.3: the lane rides along, so a card can say which ticked criteria
    // expect a test result.
    out[r.requirement_id] = list.map((c: unknown): CurrentCriterion =>
      typeof c === "string"
        ? { text: c }
        : { text: String((c as any)?.text ?? ""), met: (c as any)?.met === true, ...((c as any)?.verification === "manual" ? { verification: "manual" as const } : {}) }
    ).filter((c: { text: string }) => c.text);
  }
  return out;
}

/** Fetch the changed task docs at `ref` and diff their checkboxes against the DB. */
// deno-lint-ignore no-explicit-any
export async function computeSweepCriterionDeltas(
  supabase: any,
  projectId: string,
  // deno-lint-ignore no-explicit-any
  integration: any,
  apiBase: string,
  token: string,
  ref: string,
  paths: string[],
): Promise<CriterionDeltaResult> {
  const current = await loadCurrentCriteria(supabase, projectId);
  const merged: CriterionDeltaResult = { deltas: [], flagged: [] };
  for (const path of paths) {
    const content = await fetchRepoFile(
      integration.provider, apiBase, integration.repo_owner, integration.repo_name, path, ref, token,
    );
    if (!content) continue;
    const result = computeCriterionDeltas(parseTaskDocCriteria(content), current);
    merged.deltas.push(...result.deltas);
    merged.flagged.push(...result.flagged);
  }
  // One criterion can appear in several node task docs (a shared requirement) —
  // the same tick must not be reported, or applied, twice.
  const seen = new Set<string>();
  merged.deltas = merged.deltas.filter((d) => {
    const key = `${d.requirementId}::${d.direction}::${d.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const seenFlags = new Set<string>();
  merged.flagged = merged.flagged.filter((f) => {
    const key = `${f.requirementId}::${f.text}`;
    if (seenFlags.has(key)) return false;
    seenFlags.add(key);
    return true;
  });
  return merged;
}

/**
 * D2 (docs/WORK_LOOP_PLAN.md): ticks made in `.nodespec/BOARD.md` ingest
 * through the SAME delta lanes task docs use — this fetches the board at the
 * pushed ref, parses it, and delegates to computeCriterionDeltas /
 * computeTaskDeltas via computeBoardTickDeltas. The caller MERGES the result
 * into the card's criterionDeltas/taskDeltas (dedup — the same tick may also
 * appear in a task doc), so apply_ticks and the client apply lane need no
 * changes at all. Best-effort: a board failure never drops the card.
 */
// deno-lint-ignore no-explicit-any
export async function computeSweepBoardDeltas(supabase: any, projectId: string, args: {
  // deno-lint-ignore no-explicit-any
  integration: any;
  apiBase: string;
  token: string;
  ref: string;
}): Promise<{ criterionDeltas: CriterionDeltaResult; taskDeltas: TaskDeltaResult } | null> {
  const { integration, apiBase, token, ref } = args;
  const content = await fetchRepoFile(
    integration.provider, apiBase, integration.repo_owner, integration.repo_name, BOARD_PATH, ref, token,
  );
  if (!content) return null;
  const parsed = parseBoardMd(content);
  const current = await loadCurrentCriteria(supabase, projectId);
  const { data: stateRows } = await supabase
    .from("task_items")
    .select("node_id, task_key, done")
    .eq("project_id", projectId);
  const doneByNodeKey = new Map<string, boolean>(
    (Array.isArray(stateRows) ? stateRows : []).map(
      (r: { node_id: string; task_key: string; done: boolean }) => [`${r.node_id}::${r.task_key}`, r.done === true],
    ),
  );
  return computeBoardTickDeltas(parsed, current, doneByNodeKey);
}

export interface ApplyCriterionResult {
  applied: number;
  requirementsTouched: string[];
  /** AL.29 (gap 7): requirements whose write did not land, with why. A card is
   *  marked applied only when this is empty. */
  failed: Array<{ requirementId: string; reason: string }>;
}

/**
 * AL.29 (gap 7): the ops one requirement's ticks become: set_met and a git
 * provenance stamp for each criterion a tick names that is not met yet,
 * selected by the criterion's id (its text when it has none). A criterion
 * already met keeps the provenance of whatever proved it. Pure.
 */
export function criterionTickOps(
  stored: unknown,
  ticks: Array<{ text: string }>,
  provenance: { source: "git"; commitSha?: string; actor?: string; appliedBy?: string; at: string },
): { ops: Array<Record<string, unknown>>; count: number } {
  const wanted = new Set(ticks.map((t) => t.text));
  const ops: Array<Record<string, unknown>> = [];
  let count = 0;
  const byText = new Set<string>();
  for (const c of Array.isArray(stored) ? stored : []) {
    if (!c || typeof c !== "object") continue;
    const crit = c as Record<string, unknown>;
    if (typeof crit.text !== "string" || !wanted.has(crit.text) || crit.met === true) continue;
    count++;
    if (typeof crit.id === "string" && crit.id) {
      ops.push({ op: "set_met", criterion_id: crit.id, value: true }, { op: "stamp", criterion_id: crit.id, value: { ...provenance } });
    } else if (!byText.has(crit.text)) {
      byText.add(crit.text);
      ops.push({ op: "set_met", criterion_text: crit.text, value: true }, { op: "stamp", criterion_text: crit.text, value: { ...provenance } });
    }
  }
  return { ops, count };
}

/**
 * R5c: apply a card's tick deltas to `met`, with provenance.
 *
 * ONLY ticks are applied — never unticks. A regenerated or stale task doc
 * legitimately shows an unticked box for a criterion whose evidence lives
 * elsewhere (a passing test case), and letting a file's checkbox retract proven
 * evidence would make the weakest source of truth the deciding one.
 *
 * Whole-node completion never routes here either: that writes
 * `specification_mappings.validation_status` (R5d), because "the component is
 * done" is a different claim from "this criterion is proven".
 */
// deno-lint-ignore no-explicit-any
export async function applyCriterionDeltas(supabase: any, projectId: string, opts: {
  deltas: CriterionDeltaResult;
  commitSha?: string;
  actor?: string;
  /** AD.3: the person applying the ticks (a user id). */
  appliedBy?: string;
}): Promise<ApplyCriterionResult> {
  const ticks = applicableDeltas(opts.deltas);
  if (ticks.length === 0) return { applied: 0, requirementsTouched: [], failed: [] };

  const { data: spec } = await supabase
    .from("project_specifications").select("id").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!spec) return { applied: 0, requirementsTouched: [], failed: [] };

  const byReq = new Map<string, typeof ticks>();
  for (const t of ticks) {
    if (!byReq.has(t.requirementId)) byReq.set(t.requirementId, []);
    byReq.get(t.requirementId)!.push(t);
  }

  const provenance = {
    source: "git" as const,
    ...(opts.commitSha ? { commitSha: opts.commitSha } : {}),
    ...(opts.actor ? { actor: opts.actor } : {}),
    ...(opts.appliedBy ? { appliedBy: opts.appliedBy } : {}),
    at: new Date().toISOString(),
  };
  let applied = 0;
  const touched: string[] = [];
  const failed: ApplyCriterionResult["failed"] = [];
  for (const [requirementId, reqTicks] of byReq) {
    // AL.29 (gap 7): through the one locked writer, per criterion, so a test
    // result or another tick landing on the same requirement is never
    // overwritten by a whole-array write. The read decides which criteria
    // flip; the row it was made on is the compare token, and a requirement
    // that moved since is read again once.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: row, error: readError } = await supabase
        .from("specification_requirements")
        .select("id, acceptance_criteria, updated_at")
        .eq("specification_id", spec.id)
        .eq("requirement_id", requirementId)
        .maybeSingle();
      if (readError) { failed.push({ requirementId, reason: readError.message }); break; }
      if (!row) break;
      const { ops, count } = criterionTickOps(row.acceptance_criteria, reqTicks, provenance);
      if (count === 0) break;
      const { error } = await supabase.rpc("apply_criteria_ops", {
        p_requirement_id: row.id,
        p_ops: ops,
        p_expected_updated_at: row.updated_at ?? null,
      });
      if (error && attempt === 0 && (error.code === "40001" || /moved since you read it/.test(error.message ?? ""))) continue;
      if (error) {
        console.warn(`[git-drift] criterion apply failed for ${requirementId}: ${error.message}`);
        failed.push({ requirementId, reason: error.message ?? "the write was refused" });
        break;
      }
      applied += count;
      touched.push(requirementId);
      break;
    }
  }
  return { applied, requirementsTouched: touched, failed };
}

/**
 * The Git panel's apply: a card's criterion ticks and task ticks, by the
 * person applying them, in one action. AL.29 (gap 7): the card is stamped
 * criteriaApplied only when every requirement's write landed. One that did
 * not leaves the card's criterion ticks unapplied, so the card asks again
 * and a second apply writes only what is still unmet. Task ticks are stamped
 * as they apply.
 */
export async function applyCardTicks(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  projectId: string,
  // deno-lint-ignore no-explicit-any
  card: { id: string; commit_sha?: string | null; author?: string | null; metadata?: any },
  appliedBy: string,
): Promise<{ applied: number; tasksApplied: number; requirements: string[]; failed: ApplyCriterionResult["failed"] }> {
  const deltas = card.metadata?.criterionDeltas;
  const taskDeltas = card.metadata?.taskDeltas;
  const hasCriterionDeltas = !!deltas && Array.isArray(deltas.deltas);
  const hasTaskDeltas = !!taskDeltas && Array.isArray(taskDeltas.deltas);
  const result: ApplyCriterionResult = hasCriterionDeltas
    ? await applyCriterionDeltas(supabase, projectId, {
        deltas,
        commitSha: card.commit_sha ?? undefined,
        actor: card.author ?? undefined,
        appliedBy,
      })
    : { applied: 0, requirementsTouched: [], failed: [] };

  // A4: the card's anchored-task ticks apply through the same action. Tick-only
  // and idempotent (already-done rows are skipped), like the criterion lane.
  let tasksApplied = 0;
  if (hasTaskDeltas) {
    tasksApplied = (await applyTaskDeltas(supabase, projectId, {
      deltas: taskDeltas,
      commitSha: card.commit_sha ?? undefined,
      actor: card.author ?? undefined,
      source: "git",
    })).applied;
  }

  // One metadata write carries both stamps, so re-opening the card cannot apply
  // the same ticks twice.
  const at = new Date().toISOString();
  const criteriaDone = result.failed.length === 0;
  if (criteriaDone || hasTaskDeltas) {
    await supabase
      .from("git_change_events")
      .update({
        metadata: {
          ...(card.metadata ?? {}),
          ...(criteriaDone ? { criteriaApplied: { at, count: result.applied } } : {}),
          ...(hasTaskDeltas ? { ticksApplied: { at, count: tasksApplied } } : {}),
        },
      })
      .eq("id", card.id);
  }
  return { applied: result.applied, tasksApplied, requirements: result.requirementsTouched, failed: result.failed };
}

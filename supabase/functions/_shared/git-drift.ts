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
  branchName = "main"
): Promise<MatchResult> {
  try {
    const { data: branches, error: branchError } = await supabase
      .from("branches")
      .select("id")
      .eq("project_id", projectId)
      .eq("name", branchName)
      .maybeSingle();

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

import { providerApiBase, fetchRemoteHeadShaDetailed, fetchCompare, fetchRepoFile } from "./git-provider.ts";
import { isPrimaryRow } from "./primary-branch.ts";
import { decryptWithUpgrade, isEncrypted } from "./crypto.ts";
import { MODEL_ANCHOR_PATH, parseModel, serializeModel, diffAnchors, capAnchorDiff, anchorToGraph, verifyModelHash, coreModelHash, type CappedAnchorDiff, type ModelAnchor } from "./model-anchor.ts";
import { SPEC_ANCHOR_PATH, parseSpec, serializeSpec, loadSpecPlane, diffSpecs, capSpecDiff, adoptSpecAnchor, applySpecAnchor, type CappedSpecDiff } from "./spec-anchor.ts";
import {
  parseTaskDocCriteria, computeCriterionDeltas, applyTickDeltas, applicableDeltas,
  type CriterionDeltaResult,
} from "./criterion-deltas.ts";
import { computeSweepTaskDeltas, type TaskDeltaResult } from "./task-deltas.ts";
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
  | "auto-baseline"  // repo anchor IS this project's model — re-establish the baseline silently (disconnect/reconnect with no changes must be a no-op, owner bench 2026-07-28)
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
  if (args.projectMatchesAnchor) return "auto-baseline";
  if (args.baselined) return "none";
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
}> {
  const { data, error } = await supabase
    .from("graph_snapshots")
    .select("graph_data")
    .eq("branch_id", branchId)
    .order("patch_sequence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { graph: data?.graph_data ?? null, error: error ?? null };
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
}): BranchFreshnessAction {
  if (args.refDeleted) return "ref-deleted-card";
  if (!args.refMoved) return "none";
  if (args.specDivergent) return "card";
  if (args.modelChanged && args.canvasMatchesHead && args.matchedArtifactCount === 0 && args.residueCount === 0) {
    return "baseline-fast-forward";
  }
  if (args.modelChanged && args.canvasMatchesBaseline && args.residueCount === 0 && args.userInitiated) {
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
// Rebrand 2026-07-30 (owner: "Nodal" is the old app name): new pushes sign as
// NodeSpec, but every MATCHER accepts the legacy prefix forever — existing
// repos carry self-push history under the old name, and a prefix-only cutover
// would misread that history as out-of-band drift.
export const SELF_PUSH_PREFIX = "Update from NodeSpec:";
export const LEGACY_SELF_PUSH_PREFIXES = ["Update from Nodal:"] as const;

export function isSelfPushMessage(message: string): boolean {
  return message.startsWith(SELF_PUSH_PREFIX) ||
    LEGACY_SELF_PUSH_PREFIXES.some((p) => message.startsWith(p));
}

export function shouldRunSweep(lastCheckAt: string | null | undefined, nowMs: number, throttleMs = SWEEP_THROTTLE_MS): boolean {
  if (!lastCheckAt) return true;
  const last = Date.parse(lastCheckAt);
  if (Number.isNaN(last)) return true;
  return nowMs - last >= throttleMs;
}

/**
 * Every commit in the range is a NodeSpec push.
 *
 * NOT a safe basis for advancing a baseline on its own — see the sweep's
 * merge-arrival comment (owner bench 2026-07-30). "Our own commits" does not
 * imply "this branch's canvas has them": a merged PR delivers commits authored
 * on ANOTHER branch. Kept as a predicate (and a strict subset of
 * `isNodeSpecMergeArrival`); the sweep decides via the merge-arrival lane and
 * the freshness ladder, never via this alone.
 */
export function isSelfPushOnly(commits: Array<{ message: string }>): boolean {
  return commits.length > 0 && commits.every((c) => isSelfPushMessage(c.message));
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

/**
 * Owner bench 2026-07-29 ("a PR brings the merge up — is this correct?"): a merged
 * NodeSpec pull request comes home as a push whose commits are OUR OWN self-pushes
 * plus git's merge machinery — the head-commit-only self-push guard missed it, so
 * the merge raised a pending "# changes" card against content NodeSpec itself
 * authored. A range qualifies as a NodeSpec merge arrival when EVERY commit is
 * either NodeSpec-authored (self-push prefix, or the squash commit carrying our
 * own PR title "Merge design branch '…'") or pure merge machinery — AND at least
 * one commit is genuinely NodeSpec-authored (a range of only foreign merge
 * commits proves nothing).
 */
export function isNodeSpecMergeArrival(commits: Array<{ message: string }>): boolean {
  if (commits.length === 0) return false;
  const isOwn = (m: string) =>
    isSelfPushMessage(m) || m.startsWith("Merge design branch '");
  const isMergeMachinery = (m: string) =>
    /^Merge (pull request |branch |remote-tracking branch )/.test(m);
  return commits.every((c) => isOwn(c.message) || isMergeMachinery(c.message)) &&
    commits.some((c) => isOwn(c.message));
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
  // deno-lint-ignore no-explicit-any
  metadata: Record<string, any>;
}): Promise<string | undefined> {
  const { data: pending } = await supabase
    .from("git_change_events")
    .select("id, metadata")
    .eq("project_id", args.projectId)
    .eq("status", "pending");
  // R3-3c: the cumulative card is per BRANCH now — a feature branch's sweep must
  // never supersede main's card (or vice versa). Legacy cards carry no branchName
  // and read as main.
  const cardBranch = (args.metadata?.branchName as string | undefined) ?? "main";
  // deno-lint-ignore no-explicit-any
  const sweepEvents = ((pending ?? []) as any[]).filter((e) =>
    e?.metadata?.source === "sweep" &&
    ((e?.metadata?.branchName as string | undefined) ?? "main") === cardBranch
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
      metadata: { ...args.metadata, ...(survivorIgnored.length ? { ignoredResidue: survivorIgnored } : {}) },
    })
    .eq("id", survivor.id);
  return survivor.id;
}

export type DriftSweepStatus =
  | "no_integration" | "unbaselined" | "throttled" | "clean"
  | "fast_forwarded" | "drift" | "error"
  // R3-3c: branch lifecycle + switch-freshness outcomes
  | "ref_deleted" | "behind_in_sync";

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
  /**
   * The sweep LOADED a new model into this branch's snapshot (merge-arrival lane)
   * rather than merely advancing bookkeeping. Both cases report `fast_forwarded`,
   * but only this one leaves the caller's in-memory canvas stale — the client must
   * refresh and say so. Owner bench 2026-07-30: without this flag the R3-3c
   * auto-load step silently updated the DB while the canvas kept showing the old
   * model, which reads as "the feature is broken".
   */
  restoredModel?: boolean;
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
    const branchName = opts?.branchName ?? "main";
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

    const { data: branch } = await supabase
      .from("branches")
      .select("id, name, git_ref, last_synced_commit, is_primary")
      .eq("project_id", projectId)
      .eq("name", branchName)
      .maybeSingle();
    if (!branch) return { status: "error", detail: `No '${branchName}' branch` };

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
    if (head === baseline) return { status: "clean", headSha: head };

    const compare = await fetchCompare(integration.provider, apiBase, integration.repo_owner, integration.repo_name, baseline, head, token);

    // Owner bench 2026-07-30 (DATA-LOSS edge case: "merged a branch to main, the
    // artifact did not exist on main and NodeSpec will not detect it"):
    // `isSelfPushOnly` used to run FIRST and bare-advance the baseline to HEAD
    // WITHOUT loading anything. Its premise — "our own commits ⇒ this canvas
    // already has them" — held only while pushes came from THIS branch. The PR
    // merge lane broke it: main's ref receives commits NodeSpec authored on
    // ANOTHER branch, which main's canvas has never seen. A rebase/fast-forward
    // merge produces a range of pure self-pushes, so that lane swallowed the
    // merge: baseline := HEAD, model never loaded, and every later sweep read
    // head === baseline → "clean". The change became PERMANENTLY undetectable.
    //
    // isSelfPushOnly is a strict SUBSET of isNodeSpecMergeArrival (pinned), so the
    // merge-arrival lane below now owns every one of those ranges and does the
    // right thing: restore when the canvas is untouched, else fall through to the
    // ladder, which decides honestly (baseline-fast-forward only when the canvas
    // ALREADY matches HEAD — the safe version of the old shortcut — otherwise a
    // card). The unconditional advance is gone; nothing may advance a baseline
    // past content this canvas has not seen.
    if (compare && isNodeSpecMergeArrival(compare.commits)) {
      // Owner bench 2026-07-29: a merged NodeSpec PR coming home is OUR content —
      // "a PR brings the merge up". Load the ref's model instead of raising a
      // "# changes" card against ourselves. Guarded: only when this branch's
      // canvas still equals its baseline (nobody designed locally in between);
      // a guard failure falls through to the honest ladder below.
      const restored = await restoreBranchModelFromRef(supabase, projectId, branchName, {
        requireCanvasMatchesBaseline: true,
      });
      if (restored.ok) {
        return {
          status: "fast_forwarded", headSha: restored.headSha, baseSha: baseline, modelChanged: true,
          restoredModel: true,
          detail: `NodeSpec merge arrived on ${ref} — model loaded and baseline advanced`,
        };
      }
    }

    const files: ChangedFile[] = compare?.files ?? [];
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
          // R7d: compare the architecture-only projection, never stored hashes —
          // a legacy repo anchor hashed a mappings section that no longer exists,
          // and comparing stored hashes would card every pre-R7d repo.
          canvasMatchesHead =
            (await coreModelHash(ownParsed.model)) === (await coreModelHash(repoParsed.model));
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
            (await coreModelHash(ownParsed.model)) === (await coreModelHash(baselineParsed.model));
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
          const ourPlane = await loadSpecPlane(supabase, projectId);
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
    });
    if (action === "baseline-fast-forward") {
      // The canvas already IS the repo HEAD model and nothing else changed in the
      // range — pure bookkeeping, no question to ask anyone.
      await supabase.from("branches").update({ last_synced_commit: head }).eq("id", branch.id);
      return { status: "fast_forwarded", headSha: head, baseSha: baseline, modelChanged, detail: "canvas already matches the repo HEAD model" };
    }
    if (action === "auto-restore") {
      // No card: the caller (branch switch) runs the R3-1 loader, which advances
      // the baseline and resolves any pending model cards itself.
      return { status: "behind_in_sync", headSha: head, baseSha: baseline, modelChanged: true, detail: "working copy untouched since its baseline — safe to load the ref's model" };
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
      ...(modelDiff ? { modelDiff } : {}),
      ...(specDiff ? { specDiff } : {}),
      ...(compare ? {} : { compareFailed: true }),
    };

    const eventId = await upsertCumulativeSweepEvent(supabase, {
      integrationId: integration.id,
      projectId,
      headSha: head,
      summary,
      files,
      metadata,
    });

    return {
      status: "drift", headSha: head, baseSha: baseline,
      changedFileCount: files.length, residueCount: residuePaths.length, modelChanged, specChanged, eventId,
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

// deno-lint-ignore no-explicit-any
export async function resolveCardsAfterRestore(
  supabase: any,
  projectId: string,
  headSha: string,
  plane: "model" | "spec",
): Promise<void> {
  const { data: pendingCards } = await supabase
    .from("git_change_events")
    .select("id, metadata")
    .eq("project_id", projectId)
    .eq("status", "pending");
  // deno-lint-ignore no-explicit-any
  for (const card of (pendingCards ?? []) as any[]) {
    const source = card?.metadata?.source;
    if (source !== "connect-anchor-mismatch" && source !== "sweep") continue;
    const covered = Array.from(new Set([...(card?.metadata?.restoredPlanes ?? []), plane]));
    const metadata = {
      ...(card.metadata ?? {}),
      restoredPlanes: covered,
      resolution: "restored-from-repo",
      restoredHeadSha: headSha,
    };
    if (cardFullyAnswered(card.metadata, covered)) {
      await supabase.from("git_change_events")
        .update({ status: "accepted", resolved_at: new Date().toISOString(), metadata })
        .eq("id", card.id);
    } else {
      // Half-answered: record the progress, keep the card open. The remaining
      // plane's question is still live and must not vanish.
      await supabase.from("git_change_events").update({ metadata }).eq("id", card.id);
    }
  }
}

// ── R7c: spec restore (shared core) ───────────────────────────────────────────
// The spec-plane twin of restoreBranchModelFromRef. Deliberately separate: the
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
  }
  | {
    ok: false;
    code: "no-integration" | "no-branch" | "no-head" | "no-spec-file" | "invalid-spec" | "hash-failed" | "no-owner" | "write-failed";
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
    .select("id, git_ref")
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

  const specText = await fetchRepoFile(
    integration.provider, apiBase, integration.repo_owner, integration.repo_name, SPEC_ANCHOR_PATH, ref, token,
  );
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

  // No spec yet → the R7b adopt lane. Already has one → the R7c upsert, which
  // preserves evidence (see mergeCriteria).
  if (!existingSpec) {
    const adopted = await adoptSpecAnchor(supabase, {
      projectId, ownerId, spec: parsed.spec, sourceCommit: headSha,
    });
    if (!adopted.adopted) {
      // "already-has-spec" cannot happen on this branch (we just proved there is
      // none) — a race would land here, and write-failed is the honest report.
      const code: "hash-failed" | "no-owner" | "write-failed" =
        adopted.reason === "already-has-spec" ? "write-failed" : adopted.reason;
      return { ok: false, code, message: adopted.message ?? adopted.reason };
    }
    await resolveCardsAfterRestore(supabase, projectId, headSha, "spec");
    return { ok: true, headSha, ref, specHash: parsed.spec.specHash, mode: "adopted", counts: adopted.counts };
  }

  const applied = await applySpecAnchor(supabase, {
    projectId, ownerId, spec: parsed.spec, sourceCommit: headSha,
  });
  if (!applied.applied) {
    return { ok: false, code: applied.reason === "no-spec" ? "write-failed" : applied.reason, message: applied.message ?? applied.reason };
  }
  await resolveCardsAfterRestore(supabase, projectId, headSha, "spec");
  return {
    ok: true, headSha, ref, specHash: parsed.spec.specHash,
    mode: "applied", counts: applied.counts, keptLocal: applied.keptLocal,
  };
}

// ── Model restore (shared core) ────────────────────────────────────────────────
// One implementation of "load the ref's anchor as this branch's model": used by
// git-pull's explicit restore-model action, by the sweep's merge-arrival lane,
// and by the webhook when a NodeSpec PR merge comes home. Loads its own
// integration row + token (same pattern as runDriftSweep) so callers stay thin.

export type RestoreBranchResult =
  | { ok: true; headSha: string; ref: string; modelHash: string; counts: unknown }
  | {
    ok: false;
    code: "no-integration" | "no-branch" | "no-head" | "no-anchor" | "invalid-anchor" | "hash-failed" | "guard-failed" | "write-failed";
    message: string;
  };

// deno-lint-ignore no-explicit-any
export async function restoreBranchModelFromRef(supabase: any, projectId: string, branchName: string, opts?: {
  /**
   * Auto-restore safety guard (merge-arrival lanes): only proceed when the
   * branch's canvas model still equals its BASELINE anchor — i.e. nobody
   * changed the design locally since the last sync. An explicit user-invoked
   * restore skips this (the user chose git as the winner).
   */
  requireCanvasMatchesBaseline?: boolean;
  /**
   * R3-6: default TRUE — restoring a model answers pending model cards ("git
   * won"), and every pre-existing caller relies on that. Connect-time branch
   * DETECTION passes false: it materializes OTHER branches' models, and letting
   * it resolve cards would swallow the main mismatch card the same connect may
   * have just raised on a non-empty project.
   */
  resolveCards?: boolean;
}): Promise<RestoreBranchResult> {
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
    .select("id, git_ref, last_synced_commit")
    .eq("project_id", projectId)
    .eq("name", branchName)
    .maybeSingle();
  if (!branch) return { ok: false, code: "no-branch", message: `No '${branchName}' branch for this project` };

  // R3-3a: a NodeSpec branch restores from ITS bound git ref (1:1 binding).
  const ref = branch.git_ref || integration.default_branch;

  const headResult = await fetchRemoteHeadShaDetailed(
    integration.provider, apiBase, integration.repo_owner, integration.repo_name, ref, token,
  );
  const headSha = headResult.sha;
  if (!headSha) {
    return { ok: false, code: "no-head", message: `Could not resolve remote HEAD for ${integration.repo_owner}/${integration.repo_name}@${ref}` };
  }

  const anchorText = await fetchRepoFile(
    integration.provider, apiBase, integration.repo_owner, integration.repo_name,
    MODEL_ANCHOR_PATH, ref, token,
  );
  if (!anchorText) {
    return { ok: false, code: "no-anchor", message: `The repository has no ${MODEL_ANCHOR_PATH} on ${ref} — nothing to restore` };
  }

  const parsed = parseModel(anchorText);
  if (!parsed.ok) {
    return { ok: false, code: "invalid-anchor", message: `Repo model anchor is invalid: ${parsed.error}` };
  }
  if (!(await verifyModelHash(parsed.model))) {
    return { ok: false, code: "hash-failed", message: "Repo model anchor failed hash verification (tampered or hand-edited) — refusing to restore from it" };
  }

  // Prior snapshot: keep the graph's IDENTITY (id) and version monotonicity — the
  // restored graph is the same project moving to a new state, not a new project.
  const { data: prior } = await supabase
    .from("graph_snapshots")
    .select("graph_data, patch_sequence")
    .eq("branch_id", branch.id)
    .order("patch_sequence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const priorGraph = prior?.graph_data ?? {};

  if (opts?.requireCanvasMatchesBaseline) {
    if (!branch.last_synced_commit) {
      return { ok: false, code: "guard-failed", message: "Branch has no sync baseline — auto-restore refused" };
    }
    try {
      const baselineAnchorText = await fetchRepoFile(
        integration.provider, apiBase, integration.repo_owner, integration.repo_name,
        MODEL_ANCHOR_PATH, branch.last_synced_commit, token,
      );
      const baselineParsed = baselineAnchorText ? parseModel(baselineAnchorText) : null;
      const canvasParsed = parseModel(await serializeModel(priorGraph));
      // R7d: architecture-only comparison (legacy anchors carry a mappings section).
      const untouched = baselineParsed?.ok === true && canvasParsed.ok &&
        (await coreModelHash(canvasParsed.model)) === (await coreModelHash(baselineParsed.model));
      if (!untouched) {
        return { ok: false, code: "guard-failed", message: "The canvas diverged from its baseline — keeping the reconciliation card instead of auto-restoring" };
      }
    } catch (guardErr) {
      return { ok: false, code: "guard-failed", message: `Baseline comparison failed: ${guardErr instanceof Error ? guardErr.message : String(guardErr)}` };
    }
  }

  const graphId = typeof priorGraph.id === "string" && priorGraph.id ? priorGraph.id : crypto.randomUUID();
  const version = (typeof priorGraph.version === "number" ? priorGraph.version : 0) + 1;
  const patchSequence = (typeof prior?.patch_sequence === "number" ? prior.patch_sequence : 0) + 1;

  const { graph, counts } = anchorToGraph(parsed.model, {
    graphId, version, nowIso: new Date().toISOString(),
    // R3-4b: the HEAD we restored from IS the provenance commit for every
    // artifact this restore materializes.
    sourceCommit: headSha,
  });

  const { error: insertError } = await supabase
    .from("graph_snapshots")
    .insert({
      project_id: projectId,
      branch_id: branch.id,
      graph_data: graph,
      version: graph.version,
      hash: graph.hash,
      patch_sequence: patchSequence,
    });
  if (insertError) {
    return { ok: false, code: "write-failed", message: `Restore snapshot write failed: ${insertError.message}` };
  }

  // Baseline = the HEAD we restored from: project and repo now agree by construction.
  await supabase.from("branches")
    .update({ last_synced_commit: headSha, git_ref: ref })
    .eq("id", branch.id);

  // Pending model cards asked "which side wins?" — git did. Resolve them so they
  // don't re-prompt against a question that no longer exists. (R3-6: connect-time
  // branch detection opts out — see the opt's doc.)
  if (opts?.resolveCards !== false) {
    await resolveCardsAfterRestore(supabase, projectId, headSha, "model");
  }

  await supabase.from("git_sync_log").insert({
    integration_id: integration.id,
    project_id: projectId,
    branch_id: branch.id,
    direction: "pull",
    commit_sha: headSha,
    status: "success",
    patches_synced: 0,
    completed_at: new Date().toISOString(),
  });

  return { ok: true, headSha, ref, modelHash: parsed.model.modelHash, counts };
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
async function loadCurrentCriteria(supabase: any, projectId: string): Promise<Record<string, Array<{ text: string; met?: boolean }>>> {
  const { data: spec } = await supabase
    .from("project_specifications").select("id").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!spec) return {};
  const { data: reqs } = await supabase
    .from("specification_requirements")
    .select("requirement_id, acceptance_criteria")
    .eq("specification_id", spec.id);
  const out: Record<string, Array<{ text: string; met?: boolean }>> = {};
  // deno-lint-ignore no-explicit-any
  for (const r of ((reqs ?? []) as any[])) {
    const list = Array.isArray(r.acceptance_criteria) ? r.acceptance_criteria : [];
    out[r.requirement_id] = list.map((c: unknown) =>
      typeof c === "string" ? { text: c } : { text: String((c as any)?.text ?? ""), met: (c as any)?.met === true }
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
 * A3 (docs/WORK_LOOP_PLAN.md): webhook-time completion provenance.
 *
 * Before this, only the 60-second drift sweep computed criterion deltas — a
 * tick arriving by webhook produced a card with no deltas and waited for a
 * later sweep to notice. This wrapper gives the webhook the exact same
 * computation the sweep runs (same fetch, same matcher, same dedupe),
 * owning the one piece the webhook handler lacks: token decryption +
 * provider API base resolution. Callers treat it best-effort — a delta
 * failure must never drop the card.
 */
export async function computeWebhookCriterionDeltas(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  integration: {
    provider: string;
    project_id: string;
    base_url?: string | null;
    repo_owner: string;
    repo_name: string;
    access_token_encrypted?: string | null;
  },
  ref: string,
  paths: string[],
): Promise<CriterionDeltaResult> {
  let token = integration.access_token_encrypted ?? "";
  if (token && isEncrypted(token)) {
    const { plaintext } = await decryptWithUpgrade(token);
    token = plaintext;
  }
  const apiBase = providerApiBase(integration.provider, integration.base_url);
  return computeSweepCriterionDeltas(
    supabase, integration.project_id, integration, apiBase, token, ref, paths,
  );
}

/** B3: the declaration counterpart — read-only resolve for the webhook card. */
export async function computeWebhookBindingResolution(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  integration: {
    provider: string;
    project_id: string;
    base_url?: string | null;
    repo_owner: string;
    repo_name: string;
    access_token_encrypted?: string | null;
  },
  ref: string,
  branchName: string,
): Promise<BindingResolution | null> {
  let token = integration.access_token_encrypted ?? "";
  if (token && isEncrypted(token)) {
    const { plaintext } = await decryptWithUpgrade(token);
    token = plaintext;
  }
  const apiBase = providerApiBase(integration.provider, integration.base_url);
  return computeSweepBindingResolution(supabase, integration.project_id, {
    integration, apiBase, token, ref, branchName, fetchFile: fetchRepoFile,
  });
}

/** A4: the task-checkbox counterpart of computeWebhookCriterionDeltas. */
export async function computeWebhookTaskDeltas(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  integration: {
    provider: string;
    project_id: string;
    base_url?: string | null;
    repo_owner: string;
    repo_name: string;
    access_token_encrypted?: string | null;
  },
  ref: string,
  files: Array<{ path: string; nodeId: string }>,
): Promise<TaskDeltaResult> {
  let token = integration.access_token_encrypted ?? "";
  if (token && isEncrypted(token)) {
    const { plaintext } = await decryptWithUpgrade(token);
    token = plaintext;
  }
  const apiBase = providerApiBase(integration.provider, integration.base_url);
  return computeSweepTaskDeltas(supabase, integration.project_id, {
    integration, apiBase, token, ref, files, fetchFile: fetchRepoFile,
  });
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

/** D2: the webhook-side wrapper — token decryption + API base, same as every
 *  other webhook wrapper in this file. */
export async function computeWebhookBoardDeltas(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  integration: {
    provider: string;
    project_id: string;
    base_url?: string | null;
    repo_owner: string;
    repo_name: string;
    access_token_encrypted?: string | null;
  },
  ref: string,
): Promise<{ criterionDeltas: CriterionDeltaResult; taskDeltas: TaskDeltaResult } | null> {
  let token = integration.access_token_encrypted ?? "";
  if (token && isEncrypted(token)) {
    const { plaintext } = await decryptWithUpgrade(token);
    token = plaintext;
  }
  const apiBase = providerApiBase(integration.provider, integration.base_url);
  return computeSweepBoardDeltas(supabase, integration.project_id, { integration, apiBase, token, ref });
}

export interface ApplyCriterionResult {
  applied: number;
  requirementsTouched: string[];
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
}): Promise<ApplyCriterionResult> {
  const ticks = applicableDeltas(opts.deltas);
  if (ticks.length === 0) return { applied: 0, requirementsTouched: [] };

  const { data: spec } = await supabase
    .from("project_specifications").select("id").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!spec) return { applied: 0, requirementsTouched: [] };

  const byReq = new Map<string, typeof ticks>();
  for (const t of ticks) {
    if (!byReq.has(t.requirementId)) byReq.set(t.requirementId, []);
    byReq.get(t.requirementId)!.push(t);
  }

  const at = new Date().toISOString();
  let applied = 0;
  const touched: string[] = [];
  for (const [requirementId, reqTicks] of byReq) {
    const { data: row } = await supabase
      .from("specification_requirements")
      .select("id, acceptance_criteria")
      .eq("specification_id", spec.id)
      .eq("requirement_id", requirementId)
      .maybeSingle();
    if (!row) continue;
    const result = applyTickDeltas(row.acceptance_criteria, reqTicks, {
      source: "git",
      ...(opts.commitSha ? { commitSha: opts.commitSha } : {}),
      ...(opts.actor ? { actor: opts.actor } : {}),
      at,
    });
    if (result.applied === 0) continue;
    const { error } = await supabase
      .from("specification_requirements")
      .update({ acceptance_criteria: result.criteria, updated_at: at })
      .eq("id", row.id);
    if (error) {
      console.warn(`[git-drift] criterion apply failed for ${requirementId}: ${error.message}`);
      continue;
    }
    applied += result.applied;
    touched.push(requirementId);
  }
  return { applied, requirementsTouched: touched };
}


// ── R3-6: connect-time design-branch detection ────────────────────────────────
// Owner bench 2026-07-31 (second project, same repo): "the branches do not
// detect." The repo's non-default branches created by ANOTHER project already
// ARE design branches — this materializes them here: a branch row per anchored
// ref, model loaded through the R3-1 loader, baseline = the loaded HEAD. A
// branch with no valid anchor is NOT a design branch: its row is rolled back and
// the skip reason reported (a CI/dependabot ref must not become a phantom design
// branch). Idempotent — rows that already exist by name are skipped.

export interface BranchDetectResult {
  created: Array<{ name: string; nodes: number }>;
  skipped: Array<{ name: string; reason: string }>;
  /** Set when more anchored candidates existed than the cap allowed. */
  capped?: number;
}

const BRANCH_DETECT_CAP = 10;

// deno-lint-ignore no-explicit-any
export async function detectRepoDesignBranches(supabase: any, opts: {
  projectId: string;
  ownerId: string;
  defaultBranch: string;
  branchNames: string[];
}): Promise<BranchDetectResult> {
  const { projectId, ownerId, defaultBranch, branchNames } = opts;
  const result: BranchDetectResult = { created: [], skipped: [] };

  const { data: existingRows } = await supabase
    .from("branches")
    .select("name")
    .eq("project_id", projectId);
  const existing = new Set(((existingRows ?? []) as Array<{ name: string }>).map((b) => b.name));

  const candidates = branchNames
    .filter((n) => n && n !== defaultBranch && !existing.has(n))
    .sort();
  const toProcess = candidates.slice(0, BRANCH_DETECT_CAP);
  if (candidates.length > toProcess.length) result.capped = candidates.length - toProcess.length;

  for (const name of toProcess) {
    const { data: row, error: insErr } = await supabase
      .from("branches")
      .insert({ project_id: projectId, name, created_by: ownerId, git_ref: name })
      .select("id")
      .maybeSingle();
    if (insErr || !row) {
      result.skipped.push({ name, reason: insErr?.message ?? "branch row insert failed" });
      continue;
    }
    // The R3-1 loader does the rest: anchor at the ref, hash-verified, snapshot
    // written, baseline = the loaded HEAD. resolveCards:false — detection must
    // not swallow the main mismatch card this same connect may have raised.
    const restored = await restoreBranchModelFromRef(supabase, projectId, name, { resolveCards: false });
    if (!restored.ok) {
      await supabase.from("branches").delete().eq("id", row.id);
      result.skipped.push({ name, reason: `${restored.code}: not a design branch (${restored.message})` });
      continue;
    }
    const counts = restored.counts as { nodes?: number } | undefined;
    result.created.push({ name, nodes: counts?.nodes ?? 0 });
  }
  return result;
}

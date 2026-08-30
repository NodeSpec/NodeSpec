/*
  P0-9: git-webhook logic, extracted verbatim from index.ts so it is testable under the
  P0-8 Deno harness (index.ts reads env and calls Deno.serve at module load). index.ts
  keeps env checks, real client construction, and the serve loop.

  Also per P0-9: the unused weak `verifyGitHubSignature` stub (fake "hash" that returned
  true for any sha256=-prefixed signature) is DELETED — the HMAC verifier below is the
  only signature check.
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

// P1-7 R1: ChangedFile/MatchResult + matchFilesToArtifacts moved to ../_shared/git-drift.ts
// (with the is_main -> name==='main' fix; see the note there). Re-exported for existing callers
// and the P0-9 test suite.
import { matchFilesToArtifacts, classifySweepFiles, resolveWebhookBranchName, isNodeSpecMergeArrival, restoreBranchModelFromRef, isSelfPushMessage, computeWebhookCriterionDeltas, computeWebhookTaskDeltas } from "../_shared/git-drift.ts";
import type { CriterionDeltaResult } from "../_shared/criterion-deltas.ts";
import type { TaskDeltaResult } from "../_shared/task-deltas.ts";
import { computeWebhookBindingResolution, computeWebhookBoardDeltas } from "../_shared/git-drift.ts";
import { BOARD_PATH, mergeCriterionDeltaResults, mergeTaskDeltaResults } from "../_shared/board-generator.ts";
import { BINDINGS_PATH, type BindingResolution } from "../_shared/binding-manifest.ts";
import type { ChangedFile, MatchResult } from "../_shared/git-drift.ts";
export { matchFilesToArtifacts };
export type { ChangedFile, MatchResult };

export interface GitHubPushPayload {
  ref: string;
  after: string;
  head_commit?: {
    id: string;
    message: string;
    author?: { name?: string; username?: string };
    added?: string[];
    modified?: string[];
    removed?: string[];
  };
  commits?: Array<{
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
  repository?: {
    full_name?: string;
  };
}

export interface GitLabPushPayload {
  ref: string;
  after: string;
  checkout_sha?: string;
  commits?: Array<{
    id: string;
    message: string;
    author?: { name?: string };
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
  project?: {
    path_with_namespace?: string;
  };
}

// Rebrand 2026-07-30: the prefix (and its legacy-accepting matcher) lives ONCE
// in _shared/git-drift.ts — this file's private copy was a drift hazard.
export { SELF_PUSH_PREFIX } from "../_shared/git-drift.ts";

export async function verifyGitHubSignatureHmac(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    if (!signature.startsWith("sha256=")) return false;
    const sigHex = signature.slice(7);

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const macHex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return macHex === sigHex;
  } catch {
    return false;
  }
}

export function parseGitHubPush(body: GitHubPushPayload): {
  commitSha: string;
  commitMessage: string;
  author: string;
  changedFiles: ChangedFile[];
  branch: string;
  /** Every commit message in the push — merge-arrival detection needs the full range, not just head. */
  commits: Array<{ message: string }>;
} {
  const changedFiles: ChangedFile[] = [];
  const seenPaths = new Set<string>();

  const allCommits = body.commits || [];
  if (body.head_commit) {
    const hc = body.head_commit;
    for (const p of hc.added || []) {
      if (!seenPaths.has(p)) {
        seenPaths.add(p);
        changedFiles.push({ path: p, action: "added" });
      }
    }
    for (const p of hc.modified || []) {
      if (!seenPaths.has(p)) {
        seenPaths.add(p);
        changedFiles.push({ path: p, action: "modified" });
      }
    }
    for (const p of hc.removed || []) {
      if (!seenPaths.has(p)) {
        seenPaths.add(p);
        changedFiles.push({ path: p, action: "removed" });
      }
    }
  }

  for (const commit of allCommits) {
    for (const p of commit.added || []) {
      if (!seenPaths.has(p)) {
        seenPaths.add(p);
        changedFiles.push({ path: p, action: "added" });
      }
    }
    for (const p of commit.modified || []) {
      if (!seenPaths.has(p)) {
        seenPaths.add(p);
        changedFiles.push({ path: p, action: "modified" });
      }
    }
    for (const p of commit.removed || []) {
      if (!seenPaths.has(p)) {
        seenPaths.add(p);
        changedFiles.push({ path: p, action: "removed" });
      }
    }
  }

  const ref = body.ref || "";
  const branch = ref.replace("refs/heads/", "");

  const commitMessages = new Map<string, string>();
  if (body.head_commit?.id) commitMessages.set(body.head_commit.id, body.head_commit.message || "");
  for (const c of allCommits) {
    // deno-lint-ignore no-explicit-any
    const anyC = c as any;
    if (anyC.id) commitMessages.set(anyC.id, anyC.message || "");
  }

  return {
    commitSha: body.after || body.head_commit?.id || "",
    commitMessage: body.head_commit?.message || "",
    author:
      body.head_commit?.author?.username ||
      body.head_commit?.author?.name ||
      "unknown",
    changedFiles,
    branch,
    commits: [...commitMessages.values()].map((message) => ({ message })),
  };
}

export function parseGitLabPush(body: GitLabPushPayload): {
  commitSha: string;
  commitMessage: string;
  author: string;
  changedFiles: ChangedFile[];
  branch: string;
  commits: Array<{ message: string }>;
} {
  const changedFiles: ChangedFile[] = [];
  const seenPaths = new Set<string>();

  for (const commit of body.commits || []) {
    for (const p of commit.added || []) {
      if (!seenPaths.has(p)) {
        seenPaths.add(p);
        changedFiles.push({ path: p, action: "added" });
      }
    }
    for (const p of commit.modified || []) {
      if (!seenPaths.has(p)) {
        seenPaths.add(p);
        changedFiles.push({ path: p, action: "modified" });
      }
    }
    for (const p of commit.removed || []) {
      if (!seenPaths.has(p)) {
        seenPaths.add(p);
        changedFiles.push({ path: p, action: "removed" });
      }
    }
  }

  const ref = body.ref || "";
  const branch = ref.replace("refs/heads/", "");

  const lastCommit =
    body.commits && body.commits.length > 0
      ? body.commits[body.commits.length - 1]
      : null;

  return {
    commitSha: body.checkout_sha || body.after || lastCommit?.id || "",
    commitMessage: lastCommit?.message || "",
    author: lastCommit?.author?.name || "unknown",
    changedFiles,
    branch,
    commits: (body.commits || []).map((c) => ({ message: c.message || "" })),
  };
}

/** The full request-processing flow, minus env reads and client construction. */
// deno-lint-ignore no-explicit-any
export async function processWebhook(supabase: any, req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const url = new URL(req.url);
  const integrationId = url.searchParams.get("integration_id");

  if (!integrationId) {
    return new Response(
      JSON.stringify({ error: "integration_id query parameter is required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const rawBody = await req.text();

  const { data: integration, error: intError } = await supabase
    .from("git_integrations")
    .select("id, project_id, provider, webhook_secret, default_branch, repo_owner, repo_name, base_url, access_token_encrypted")
    .eq("id", integrationId)
    .maybeSingle();

  if (intError || !integration) {
    return new Response(
      JSON.stringify({ error: "Integration not found" }),
      {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (integration.webhook_secret) {
    const githubSig =
      req.headers.get("X-Hub-Signature-256") ||
      req.headers.get("x-hub-signature-256");
    const gitlabToken =
      req.headers.get("X-Gitlab-Token") ||
      req.headers.get("x-gitlab-token");

    if (integration.provider === "github" && githubSig) {
      const valid = await verifyGitHubSignatureHmac(
        rawBody,
        githubSig,
        integration.webhook_secret
      );
      if (!valid) {
        return new Response(
          JSON.stringify({ error: "Invalid webhook signature" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else if (integration.provider === "gitlab" && gitlabToken) {
      if (gitlabToken !== integration.webhook_secret) {
        return new Response(
          JSON.stringify({ error: "Invalid webhook token" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }
  }

  const githubEvent =
    req.headers.get("X-GitHub-Event") ||
    req.headers.get("x-github-event");
  const gitlabEvent =
    req.headers.get("X-Gitlab-Event") ||
    req.headers.get("x-gitlab-event");

  if (githubEvent === "ping") {
    return new Response(
      JSON.stringify({ ok: true, message: "Webhook configured" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const isPush =
    githubEvent === "push" ||
    gitlabEvent === "Push Hook" ||
    gitlabEvent === "push";

  if (!isPush) {
    return new Response(
      JSON.stringify({ ok: true, message: "Event type ignored" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const parsed =
    integration.provider === "github"
      ? parseGitHubPush(body as GitHubPushPayload)
      : parseGitLabPush(body as GitLabPushPayload);

  if (parsed.changedFiles.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, message: "No file changes detected" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (isSelfPushMessage(parsed.commitMessage)) {
    return new Response(
      JSON.stringify({ ok: true, message: "Self-push ignored" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // R3-4a: map the pushed git ref to a NodeSpec branch (bound git_ref wins;
  // default branch reads as main; anything else is unmapped and must never
  // advance a baseline) — and match files against THAT branch's artifacts.
  const { data: branchRows } = await supabase
    .from("branches")
    .select("name, git_ref, is_primary")
    .eq("project_id", integration.project_id);
  const mappedBranchName = resolveWebhookBranchName(
    parsed.branch,
    // R3-3d: was `?? "main"`. A missing default_branch is unknown, not "main" —
    // guessing it makes a master-default repo map the wrong ref. Pass the null
    // through; resolveWebhookBranchName then maps only genuinely BOUND branches.
    integration.default_branch,
    (Array.isArray(branchRows) ? branchRows : []) as Array<{ name: string; git_ref: string | null; is_primary?: boolean | null }>,
  );

  // Owner bench 2026-07-29 ("a PR brings the merge up"): when EVERY commit in the
  // push is NodeSpec's own work plus git's merge machinery, this is our merged PR
  // coming home — not an external change. Load the ref's model into the mapped
  // branch instead of raising a "# changes" card against our own content. Guarded
  // (canvas must still equal its baseline; anchor must hash-verify) — any guard
  // failure falls through to the normal pending card below.
  if (mappedBranchName && isNodeSpecMergeArrival(parsed.commits)) {
    const restored = await restoreBranchModelFromRef(supabase, integration.project_id, mappedBranchName, {
      requireCanvasMatchesBaseline: true,
    });
    if (restored.ok) {
      await supabase.from("git_change_events").insert({
        integration_id: integration.id,
        project_id: integration.project_id,
        commit_sha: parsed.commitSha,
        commit_message: parsed.commitMessage,
        author: parsed.author,
        changed_files: parsed.changedFiles,
        status: "accepted",
        resolved_at: new Date().toISOString(),
        metadata: {
          branch: parsed.branch,
          provider: integration.provider,
          eventType: githubEvent || gitlabEvent,
          fileCount: parsed.changedFiles.length,
          branchName: mappedBranchName,
          source: "merge-arrival",
          resolution: "merge-fast-forward",
          restoredHeadSha: restored.headSha,
        },
      });
      return new Response(
        JSON.stringify({ ok: true, commitSha: parsed.commitSha, status: "merge-fast-forward", restoredHeadSha: restored.headSha }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    console.warn(`[git-webhook] merge-arrival restore declined (${restored.code}): ${restored.message} — falling through to a pending card`);
  }

  // Debt-audit fix (2026-07-29): an UNMAPPED ref gets NO artifact matching and no
  // residue — matching a random branch's files against main's artifacts offered
  // Accept buttons that would write foreign content onto main's canvas, and
  // "everything is residue" was noise. The card still records the push honestly.
  const matchResult = mappedBranchName
    ? await matchFilesToArtifacts(supabase, integration.project_id, parsed.changedFiles, mappedBranchName)
    : { matches: [] as MatchResult["matches"] };

  // R3-4a: webhook parity with the sweep — classify the range so webhook cards
  // carry the same modelChanged/residuePaths signals sweep cards do.
  const matchedPaths = new Set(matchResult.matches.map((m) => m.path));
  const classified = classifySweepFiles(parsed.changedFiles, matchedPaths);
  const modelChanged = classified.modelChanged;
  const residuePaths = mappedBranchName ? classified.residuePaths : [];

  // A3 (docs/WORK_LOOP_PLAN.md): webhook parity with the sweep for completion
  // provenance — a tick pushed out-of-band should ride THIS card, not wait for
  // a later sweep to recompute it. Only TASK-kind matches are read (a ticked
  // box in ordinary source is prose, not evidence — the R5b rule), and the
  // whole block is best-effort: a delta failure never drops the card.
  let criterionDeltas: CriterionDeltaResult | null = null;
  let taskDeltas: TaskDeltaResult | null = null;
  const taskDocMatches = matchResult.matches.filter((m) => m.kind === "task");
  const taskDocPaths = taskDocMatches.map((m) => m.path);
  if (mappedBranchName && taskDocPaths.length > 0) {
    try {
      criterionDeltas = await computeWebhookCriterionDeltas(
        supabase, integration, parsed.branch, taskDocPaths,
      );
    } catch (deltaErr) {
      console.warn("[git-webhook] criterion delta computation failed (card still lands):", deltaErr);
    }
    // A4: anchored implementation-task ticks ride the same card.
    try {
      taskDeltas = await computeWebhookTaskDeltas(
        supabase, integration, parsed.branch,
        taskDocMatches.map((m) => ({ path: m.path, nodeId: m.nodeId })),
      );
    } catch (deltaErr) {
      console.warn("[git-webhook] task delta computation failed (card still lands):", deltaErr);
    }
  }

  // D2: ticks in BOARD.md ride the SAME card, merged into the same delta
  // arrays (dedup — a tick may appear in both the board and a task doc).
  // Best-effort — the card still lands.
  if (mappedBranchName && parsed.changedFiles.some((f) => f.path === BOARD_PATH)) {
    try {
      const boardDeltas = await computeWebhookBoardDeltas(supabase, integration, parsed.branch);
      if (boardDeltas) {
        criterionDeltas = criterionDeltas
          ? mergeCriterionDeltaResults(criterionDeltas, boardDeltas.criterionDeltas)
          : boardDeltas.criterionDeltas;
        taskDeltas = taskDeltas
          ? mergeTaskDeltaResults(taskDeltas, boardDeltas.taskDeltas)
          : boardDeltas.taskDeltas;
      }
    } catch (boardErr) {
      console.warn("[git-webhook] board delta computation failed (card still lands):", boardErr);
    }
  }

  // B3: declared new files ride the card too. Compute when the push touched
  // the declaration file or produced residue the declarations might cover.
  // READ-ONLY (the B2 clobber rule: only the client applies) and best-effort.
  let bindingResolution: BindingResolution | null = null;
  if (mappedBranchName && (parsed.changedFiles.some((f) => f.path === BINDINGS_PATH) || residuePaths.length > 0)) {
    try {
      bindingResolution = await computeWebhookBindingResolution(
        supabase, integration, parsed.branch, mappedBranchName,
      );
    } catch (bindErr) {
      console.warn("[git-webhook] binding resolution failed (card still lands):", bindErr);
    }
  }

  const { error: insertError } = await supabase
    .from("git_change_events")
    .insert({
      integration_id: integration.id,
      project_id: integration.project_id,
      commit_sha: parsed.commitSha,
      commit_message: parsed.commitMessage,
      author: parsed.author,
      changed_files: parsed.changedFiles,
      status: "pending",
      metadata: {
        branch: parsed.branch,
        provider: integration.provider,
        eventType: githubEvent || gitlabEvent,
        fileCount: parsed.changedFiles.length,
        artifactMatches: matchResult.matches,
        ...(matchResult.error ? { matchError: matchResult.error } : {}),
        modelChanged,
        // A3: same conditional shape the sweep uses — the apply lane reads
        // metadata.criterionDeltas identically from either producer.
        ...(criterionDeltas && (criterionDeltas.deltas.length > 0 || criterionDeltas.flagged.length > 0)
          ? { criterionDeltas }
          : {}),
        ...(taskDeltas && (taskDeltas.deltas.length > 0 || taskDeltas.flagged.length > 0)
          ? { taskDeltas }
          : {}),
        ...(bindingResolution ? { bindingResolution } : {}),
        residuePaths,
        ...(mappedBranchName
          ? { branchName: mappedBranchName }
          : { unmappedRef: parsed.branch }),
      },
    });

  if (insertError) {
    console.error("Failed to insert change event:", insertError);
    return new Response(
      JSON.stringify({ error: "Failed to record change event" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      commitSha: parsed.commitSha,
      changedFiles: parsed.changedFiles.length,
      status: "pending",
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

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
import { matchFilesToArtifacts, resolveWebhookBranchName, runDriftSweep } from "../_shared/git-drift.ts";
import type { ChangedFile, MatchResult } from "../_shared/git-drift.ts";
import { readWebhookSecret, timingSafeEqual, webhookRepoMatches } from "../_shared/webhook-secret.ts";
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

    return timingSafeEqual(macHex, sigHex.toLowerCase());
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

/** The full request-processing flow, minus env reads and client construction.
 *  AD.1: `deps.runDriftSweep` is the sync check a delivery wakes (injectable
 *  so tests can see what it is asked without reaching a provider). */
export async function processWebhook(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  req: Request,
  deps: { runDriftSweep: typeof runDriftSweep } = { runDriftSweep },
): Promise<Response> {
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

  // AD.0 (S2): every delivery proves it knows the secret. It used to be checked
  // only when a secret was on file AND a header came with the delivery, and
  // nothing ever wrote the secret, so every delivery was accepted.
  const refuse = (error: string) => new Response(
    JSON.stringify({ error }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
  const secret = await readWebhookSecret(integration.webhook_secret);
  if (!secret) {
    return refuse("This integration has no webhook secret. Save the integration in NodeSpec to get one, then add it to this webhook.");
  }
  if (integration.provider === "github") {
    const githubSig =
      req.headers.get("X-Hub-Signature-256") ||
      req.headers.get("x-hub-signature-256");
    if (!githubSig || !(await verifyGitHubSignatureHmac(rawBody, githubSig, secret))) {
      return refuse("Invalid webhook signature");
    }
  } else if (integration.provider === "gitlab") {
    const gitlabToken =
      req.headers.get("X-Gitlab-Token") ||
      req.headers.get("x-gitlab-token");
    if (!gitlabToken || !timingSafeEqual(gitlabToken, secret)) {
      return refuse("Invalid webhook token");
    }
  } else {
    return refuse("Unsupported provider");
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

  // AD.0 (S2): a signed delivery for some other repository is not this
  // integration's business, whoever signed it.
  if (!webhookRepoMatches(integration.provider, body, integration.repo_owner, integration.repo_name)) {
    return refuse("This delivery names a different repository from the integration's.");
  }

  // AD.1 (D12, D13, D20): a delivery wakes the sync check and does nothing
  // else. The webhook used to write its own card per delivery (a duplicate
  // on redelivery and beside the sync check's card, with no specChanged, so
  // auto-sync could swallow a spec edit), judge NodeSpec's own push by the
  // head commit's message (hiding the commits under it), and load models on
  // a merge arrival. The sync check does each of those once, from the range,
  // with NodeSpec's own writing told apart by recorded sha and blob.
  const pushedRef = integration.provider === "github"
    ? parseGitHubPush(body as GitHubPushPayload).branch
    : parseGitLabPush(body as GitLabPushPayload).branch;

  // R3-4a: map the pushed git ref to a NodeSpec branch (bound git_ref wins;
  // default branch reads as main; anything else is unmapped). R3-3d: a
  // missing default_branch is unknown, not "main".
  const { data: branchRows } = await supabase
    .from("branches")
    .select("name, git_ref, is_primary")
    .eq("project_id", integration.project_id);
  const mappedBranchName = resolveWebhookBranchName(
    pushedRef,
    integration.default_branch,
    (Array.isArray(branchRows) ? branchRows : []) as Array<{ name: string; git_ref: string | null; is_primary?: boolean | null }>,
  );
  if (!mappedBranchName) {
    return new Response(
      JSON.stringify({ ok: true, message: `Ignored: ${pushedRef} is not bound to a NodeSpec branch`, ref: pushedRef }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sweep = await deps.runDriftSweep(supabase, integration.project_id, { branchName: mappedBranchName, force: true });
  return new Response(
    JSON.stringify({
      ok: true,
      branchName: mappedBranchName,
      sweep: {
        status: sweep.status,
        ...(sweep.eventId ? { eventId: sweep.eventId } : {}),
        ...(sweep.detail ? { detail: sweep.detail } : {}),
      },
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractOrchestratorAuth } from "../_shared/auth-helpers.ts";
import { decryptWithUpgrade, isEncrypted } from "../_shared/crypto.ts";
import { providerApiBase } from "../_shared/git-provider.ts";
import { runDriftSweep, fileModelLoadProposal, restoreSpecFromRef, applyCardTicks, moveBaselineAfterLoad, resolveCardsAfterRestore } from "../_shared/git-drift.ts";
import { MODEL_ANCHOR_PATH } from "../_shared/model-anchor.ts";
import { isPrimaryRow, getPrimaryBranch } from "../_shared/primary-branch.ts";
import { buildGitHubHeaders, encodeRepoPath, fetchFullGitHubTree, fetchGitHubFiles } from "../_shared/git-tree.ts";
import { gitPullModeAccess, mayUseIntegration, INTEGRATION_NOT_FOUND, type GitAccess } from "../_shared/git-access.ts";
import { advanceBaseline, ancestryFor, baselineOutcomeNote, isCommitSha, planBaselineMove } from "../_shared/baseline.ts";
import { resolveCard } from "../_shared/card-resolve.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PullRequest {
  integrationId: string;
  path?: string;
  mode?: 'tree-scan' | 'selective-fetch' | 'drift-check' | 'restore-model' | 'restore-spec' | 'apply-criteria' | 'resolve-change' | 'proposal-baseline';
  /** apply-criteria (R5c), resolve-change (AD.1): the change-event card. */
  changeEventId?: string;
  /** resolve-change (AD.1): accept or dismiss, the card's commit sha as the
   *  person read it, and the audit stamps the accept lane records. */
  resolution?: 'accepted' | 'dismissed';
  commitSha?: string;
  stamps?: Record<string, unknown>;
  /** proposal-baseline (AD.1): the accepted proposal that carries a baseline. */
  proposalId?: string;
  /** R3-3a: restore-model targets this NodeSpec branch (default: the primary branch, by its flag); the anchor
   *  is fetched from that branch's bound git ref. R3-3c: drift-check honors it too
   *  (branch-scoped sweep). */
  branchName?: string;
  /** R3-3c: drift-check only — user-initiated (branch switch) skips the throttle. */
  force?: boolean;
  /** restore-model (AD.2b): the app asked on its own (a page load), not a
   *  person; accepting that load never re-anchors a rewritten history. */
  automatic?: boolean;
  paths?: string[];
  maxContentLength?: number;
  /** selective-fetch only: fetch at this EXACT ref/commit sha (recovery lane —
   *  read a resolved change's content at the commit its card recorded). Wins
   *  over branchName resolution. */
  ref?: string;
}

interface RepoFile {
  path: string;
  content: string;
  size: number;
  language: string;
}

interface TreeScanEntry {
  path: string;
  size: number;
}

function getExtension(path: string): string {
  const filename = path.split("/").pop() || "";
  if (filename.toLowerCase() === "dockerfile") return "dockerfile";
  if (filename.toLowerCase() === "makefile") return "makefile";
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ext;
}

function detectLanguage(path: string): string {
  const ext = getExtension(path);
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", rb: "ruby", rs: "rust", go: "go",
    java: "java", kt: "kotlin", swift: "swift",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
    html: "html", css: "css", scss: "scss", less: "less",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml",
    md: "markdown", txt: "plaintext",
    sql: "sql", graphql: "graphql", gql: "graphql",
    sh: "shell", bash: "shell", zsh: "shell",
    dockerfile: "dockerfile", makefile: "makefile",
    svelte: "svelte", vue: "vue", astro: "astro",
    tf: "hcl", hcl: "hcl", proto: "protobuf",
  };
  return langMap[ext] || "plaintext";
}

async function resolveIntegrationAndToken(
  integrationId: string,
  userId: string,
  access: GitAccess,
): Promise<{
  integration: {
    id: string;
    project_id: string;
    provider: string;
    repo_owner: string;
    repo_name: string;
    default_branch: string;
    base_url?: string | null;
  };
  token: string;
  serviceClient: ReturnType<typeof createClient>;
} | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  const { data: integration, error: integrationError } = await serviceClient
    .from("git_integrations")
    .select("id, project_id, provider, repo_owner, repo_name, default_branch, base_url, access_token_encrypted")
    .eq("id", integrationId)
    .maybeSingle();

  if (integrationError) throw integrationError;
  if (!integration) return null;
  // AD.0 (S1): the caller must hold a seat on the integration's project before
  // its token is decrypted; a refusal reads as an unknown id.
  if (!(await mayUseIntegration(serviceClient, { integrationProjectId: integration.project_id, userId, access }))) {
    return null;
  }

  let token = integration.access_token_encrypted;
  if (!token) {
    throw new Error('No access token found. Please re-save the integration with a valid token.');
  }

  if (isEncrypted(token)) {
    try {
      // P0-1: lazy re-encryption — persist a v2 envelope when the stored token was legacy.
      const { plaintext, upgraded } = await decryptWithUpgrade(token);
      token = plaintext;
      if (upgraded) {
        const { error: upgradeError } = await serviceClient
          .from("git_integrations")
          .update({ access_token_encrypted: upgraded })
          .eq("id", integration.id);
        if (upgradeError) console.warn(`[git-pull] lazy v2 re-encryption failed: ${upgradeError.message}`);
      }
    } catch {
      throw new Error('Failed to decrypt access token. Please re-save the integration with a new token.');
    }
  }

  token = token.trim();

  return { integration, token, serviceClient };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { userId } = await extractOrchestratorAuth(req);
    console.log('[git-pull] Authenticated userId:', userId);

    const { integrationId, path: subPath, mode, paths, maxContentLength, branchName, force, ref, changeEventId, resolution, commitSha, stamps, proposalId, automatic }: PullRequest = await req.json();
    // AD.0 (D9): no default mode. content-fetch used to be the default, and it
    // moved the baseline to HEAD without loading anything; AD.4 retired it
    // (nothing called it).
    const access = gitPullModeAccess(mode);
    if (!access) {
      return new Response(
        JSON.stringify({ error: "git-pull needs a mode: tree-scan, selective-fetch, drift-check, restore-model, restore-spec, apply-criteria, resolve-change or proposal-baseline" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const requestMode = mode as NonNullable<PullRequest['mode']>;

    const resolved = await resolveIntegrationAndToken(integrationId, userId, access);
    if (!resolved) {
      return new Response(
        JSON.stringify({ error: INTEGRATION_NOT_FOUND }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { integration, token, serviceClient } = resolved;

    if (requestMode === 'drift-check') {
      // P1-7 R2: on-connect drift sweep — remote HEAD vs the branch's last_synced_commit
      // baseline; maintains one cumulative pending sweep event. Webhook-independent.
      // R3-3c: branchName scopes the sweep to that branch's ref; force (branch switch)
      // skips the throttle — an explicit user ask, not background polling.
      const result = await runDriftSweep(serviceClient, integration.project_id, {
        ...(branchName ? { branchName } : {}),
        ...(force === true ? { force: true } : {}),
      });
      return new Response(
        JSON.stringify({ success: true, sweep: result }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // AD.4 (D15): a load names its branch or targets the primary branch, found
    // by its flag. The literal 'main' missed once connect renamed the primary.
    if (requestMode === 'restore-model' || requestMode === 'restore-spec') {
      const target = branchName ?? (await getPrimaryBranch(serviceClient, integration.project_id, 'id, name, is_primary'))?.name;
      if (!target) return jsonResponse({ error: 'This project has no primary branch to load into.' }, 404);
      if (requestMode === 'restore-model') {
        return await handleRestoreModel(integration, serviceClient, target, automatic === true);
      }
      // R7c: the spec plane's twin. Separate action on purpose: loading the repo's
      // requirements must not force a canvas replacement, and vice versa.
      return await handleRestoreSpec(integration, serviceClient, target);
    }
    // R5c: apply a card's ticked acceptance criteria. Owner rule (2026-07-21):
    // git ticks flow VIA THE DRIFT CARD — one approval, never silent. A file in a
    // repository must not be able to mutate the spec plane on its own.
    if (requestMode === 'apply-criteria') {
      return await handleApplyCriteria(integration, serviceClient, changeEventId, userId);
    }

    // AD.1 (D8): a card resolves on the server, through the one resolver and
    // the one baseline writer, never from the browser.
    if (requestMode === 'resolve-change') {
      return await handleResolveChangeCard(integration, token, serviceClient, userId, { changeEventId, resolution, commitSha, stamps });
    }
    // AD.1 (D5, D8, D10): a baseline riding on a proposal moves when the
    // proposal is accepted, not when it is filed: an adopt at connect, or an
    // agent's reconcile of a change card.
    if (requestMode === 'proposal-baseline') {
      return await handleProposalBaseline(integration, token, serviceClient, userId, proposalId);
    }

    if (requestMode === 'tree-scan') {
      return await handleTreeScan(integration, token, subPath);
    }

    if (requestMode === 'selective-fetch') {
      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return new Response(
          JSON.stringify({ error: 'selective-fetch requires a non-empty paths array' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Owner bench 2026-07-29: selective-fetch always read the DEFAULT branch, so
      // Compare/Accept/Load-from-repo silently found nothing (or errored) for files
      // living on a feature branch. branchName resolves to that branch's bound ref.
      // Owner 2026-07-30: an explicit `ref` (commit sha — the recovery lane) wins.
      let fetchRef: string | undefined = ref || undefined;
      if (!fetchRef && branchName) {
        const { data: fetchBranch } = await serviceClient
          .from('branches')
          .select('git_ref')
          .eq('project_id', integration.project_id)
          .eq('name', branchName)
          .maybeSingle();
        fetchRef = fetchBranch?.git_ref ?? undefined;
      }
      return await handleSelectiveFetch(integration, token, paths, maxContentLength, fetchRef);
    }

    // Unreachable: gitPullModeAccess refuses every mode not handled above.
    return jsonResponse({ error: `Unhandled git-pull mode: ${requestMode}` }, 400);
  } catch (error: any) {
    console.error("Git pull error:", error);
    const message = error.message || "Failed to pull from git";
    const status = message.includes("Authentication") || message.includes("authorization") ? 401 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
);

/** The audit stamps the app's accept lane may fold into a resolve. Nothing
 *  else from the browser reaches a card's metadata. */
const RESOLVE_STAMP_KEYS = ["autoSynced", "declarationsBound"] as const;

async function handleResolveChangeCard(
  integration: { project_id: string; provider: string; repo_owner: string; repo_name: string; base_url?: string | null },
  token: string,
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  userId: string,
  args: { changeEventId?: string; resolution?: string; commitSha?: string; stamps?: Record<string, unknown> },
): Promise<Response> {
  if (!args.changeEventId) return jsonResponse({ error: "changeEventId is required" }, 400);
  if (args.resolution !== "accepted" && args.resolution !== "dismissed") {
    return jsonResponse({ error: 'resolution must be "accepted" or "dismissed"' }, 400);
  }
  if (!args.commitSha) return jsonResponse({ error: "commitSha is required: the card's commit as you read it" }, 400);
  const metadataPatch: Record<string, unknown> = {};
  for (const key of RESOLVE_STAMP_KEYS) {
    if (args.stamps && args.stamps[key] !== undefined) metadataPatch[key] = args.stamps[key];
  }
  const outcome = await resolveCard(serviceClient, {
    projectId: integration.project_id,
    eventId: args.changeEventId,
    resolution: args.resolution,
    expectedCommitSha: args.commitSha,
    resolvedBy: userId,
    metadataPatch,
    ancestry: ancestryFor(
      integration.provider, providerApiBase(integration.provider, integration.base_url),
      integration.repo_owner, integration.repo_name, token,
    ),
  });
  if (!outcome.ok) {
    const status = outcome.code === "not-found" ? 404 : outcome.code === "unconfirmed" ? 503 : 409;
    return jsonResponse({ error: outcome.message, code: outcome.code }, status);
  }
  const note = outcome.baseline.outcome === "none" ? null : baselineOutcomeNote(outcome.baseline.outcome);
  return jsonResponse({ success: true, baseline: { ...outcome.baseline, ...(note ? { note } : {}) } });
}

async function handleProposalBaseline(
  integration: { id: string; project_id: string; provider: string; repo_owner: string; repo_name: string; default_branch: string; base_url?: string | null },
  token: string,
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  userId: string,
  proposalId?: string,
): Promise<Response> {
  if (!proposalId) return jsonResponse({ error: "proposalId is required" }, 400);
  const { data: proposal } = await serviceClient
    .from("ai_proposals")
    .select("id, status, metadata, source_branch_id")
    .eq("id", proposalId)
    .maybeSingle();
  const { data: branch } = proposal?.source_branch_id
    ? await serviceClient.from("branches").select("id, project_id, name, is_primary").eq("id", proposal.source_branch_id).maybeSingle()
    : { data: null };
  const reconciles = proposal?.metadata?.reconcilesChange;
  const isAdopt = proposal?.metadata?.source === "git-adopt";
  const loads = proposal?.metadata?.source === "git-load" ? proposal.metadata.loadsModel : null;
  if (!proposal || !branch || branch.project_id !== integration.project_id || (!isAdopt && !reconciles?.eventId && !isCommitSha(loads?.headSha))) {
    return jsonResponse({ error: "No proposal carrying a baseline was found for this project" }, 404);
  }
  if (proposal.status !== "merged" && proposal.status !== "accepted") {
    return jsonResponse({ error: "The proposal is not accepted; the baseline waits for it" }, 409);
  }
  const apiBase = providerApiBase(integration.provider, integration.base_url);
  const ancestry = ancestryFor(integration.provider, apiBase, integration.repo_owner, integration.repo_name, token);

  // AD.2b: an accepted load of git's model. The canvas now holds the design
  // read at `headSha`: the last sync moves as a load's does (forward only
  // when the range holds nothing else; a person's load may re-anchor), and
  // the cards the load answers are answered.
  if (loads) {
    const plan = await planBaselineMove(serviceClient, { branchId: branch.id, to: loads.headSha, ancestry, reanchor: loads.reanchor === true });
    const after = plan
      ? await moveBaselineAfterLoad(serviceClient, {
        plan, anchorPath: MODEL_ANCHOR_PATH,
        provider: integration.provider, apiBase, owner: integration.repo_owner, repo: integration.repo_name, token,
        integrationId: integration.id,
      })
      : { moved: false, note: baselineOutcomeNote("no-branch") };
    await resolveCardsAfterRestore(serviceClient, integration.project_id, loads.headSha, "model", {
      name: branch.name, isPrimary: isPrimaryRow(branch),
    });
    return jsonResponse({ success: true, baseline: { moved: after.moved, ...(after.note ? { note: after.note } : {}) } });
  }

  // An agent's reconcile: the change card it answered resolves now, through
  // the one resolver, as the version the agent read. A card that moved on
  // since holds newer commits and stays for a person.
  if (!isAdopt) {
    const outcome = await resolveCard(serviceClient, {
      projectId: integration.project_id,
      eventId: String(reconciles.eventId),
      resolution: "accepted",
      expectedCommitSha: String(reconciles.commitSha ?? ""),
      resolvedBy: userId,
      metadataPatch: { reconciledByProposal: proposalId },
      ancestry,
    });
    if (!outcome.ok) {
      const status = outcome.code === "not-found" ? 404 : outcome.code === "unconfirmed" ? 503 : 409;
      return jsonResponse({ error: outcome.message, code: outcome.code }, status);
    }
    const note = outcome.baseline.outcome === "none" ? null : baselineOutcomeNote(outcome.baseline.outcome);
    return jsonResponse({ success: true, baseline: { ...outcome.baseline, ...(note ? { note } : {}) } });
  }

  const sha = proposal.metadata?.adoptHeadSha;
  if (!isCommitSha(sha)) {
    return jsonResponse({ error: "The adopt proposal carries no commit to sync from" }, 400);
  }
  const moved = await advanceBaseline(serviceClient, { branchId: branch.id, to: sha, ancestry });
  const note = baselineOutcomeNote(moved.outcome);
  return jsonResponse({ success: true, baseline: { ...moved, ...(note ? { note } : {}) } });
}

async function handleTreeScan(
  integration: { provider: string; repo_owner: string; repo_name: string; default_branch: string; base_url?: string | null },
  token: string,
  subPath?: string,
): Promise<Response> {
  const apiBase = providerApiBase(integration.provider, integration.base_url);
  let entries: TreeScanEntry[];
  let truncated: boolean;

  if (integration.provider === "github") {
    const result = await treeScanGitHub(apiBase, integration.repo_owner, integration.repo_name, integration.default_branch, token, subPath);
    entries = result.entries;
    truncated = result.truncated;
  } else if (integration.provider === "gitlab") {
    const result = await treeScanGitLab(apiBase, integration.repo_owner, integration.repo_name, integration.default_branch, token, subPath);
    entries = result.entries;
    truncated = result.truncated;
  } else {
    throw new Error(`Unsupported provider: ${integration.provider}`);
  }

  return new Response(
    JSON.stringify({
      success: true,
      entries,
      totalEntries: entries.length,
      truncated,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

async function handleSelectiveFetch(
  integration: { provider: string; repo_owner: string; repo_name: string; default_branch: string; base_url?: string | null },
  token: string,
  paths: string[],
  maxContentLength?: number,
  ref?: string,
): Promise<Response> {
  const apiBase = providerApiBase(integration.provider, integration.base_url);
  const fetchRef = ref || integration.default_branch;
  let files: RepoFile[];
  const truncatedFiles: string[] = [];

  if (integration.provider === "github") {
    files = await selectiveFetchGitHub(
      apiBase, integration.repo_owner, integration.repo_name, fetchRef,
      token, paths, maxContentLength, truncatedFiles,
    );
  } else if (integration.provider === "gitlab") {
    files = await selectiveFetchGitLab(
      apiBase, integration.repo_owner, integration.repo_name, fetchRef,
      token, paths, maxContentLength, truncatedFiles,
    );
  } else {
    throw new Error(`Unsupported provider: ${integration.provider}`);
  }

  return new Response(
    JSON.stringify({
      success: true,
      files,
      ref: fetchRef,
      fetchedCount: files.length,
      requestedCount: paths.length,
      truncatedFiles,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

async function treeScanGitHub(
  apiBase: string, owner: string, repo: string, branch: string, token: string, subPath?: string
): Promise<{ entries: TreeScanEntry[]; truncated: boolean }> {
  const headers = buildGitHubHeaders(token);
  const { tree, truncated, collectedCount, pendingDirs } = await fetchFullGitHubTree(apiBase, owner, repo, branch, headers);

  let blobs = tree.filter((item: any) => item.type === "blob");

  if (truncated && blobs.length >= 4500 && blobs.length <= 5500) {
    console.warn(
      `[git-pull] WARNING: Tree scan for ${owner}/${repo} returned ${blobs.length} blobs with truncated=true. ` +
      `GitHub's recursive API likely truncated the response and the non-recursive fallback was insufficient. ` +
      `Collected: ${collectedCount ?? 'N/A'}, pending dirs: ${pendingDirs ?? 'N/A'}.`
    );
  }

  if (subPath) {
    const prefix = subPath.endsWith("/") ? subPath : subPath + "/";
    blobs = blobs.filter((item: any) => item.path.startsWith(prefix) || item.path === subPath);
  }

  const entries: TreeScanEntry[] = blobs.map((blob: any) => ({
    path: blob.path,
    size: blob.size || 0,
  }));

  return { entries, truncated };
}

async function selectiveFetchGitHub(
  apiBase: string, owner: string, repo: string, branch: string, token: string,
  paths: string[], maxContentLength: number | undefined, truncatedFiles: string[],
): Promise<RepoFile[]> {
  // The shared reader encodes each path and refuses one that is not inside the repository.
  const fetched = await fetchGitHubFiles(apiBase, owner, repo, branch, token, paths);
  return fetched.map(({ path, content }) => {
    let body = content;
    if (maxContentLength && body.length > maxContentLength) {
      body = body.substring(0, maxContentLength);
      truncatedFiles.push(path);
    }
    return { path, content: body, size: body.length, language: detectLanguage(path) };
  });
}

async function treeScanGitLab(
  apiBase: string, owner: string, repo: string, branch: string, token: string, subPath?: string
): Promise<{ entries: TreeScanEntry[]; truncated: boolean }> {
  const baseUrl = apiBase;
  const projectPath = `${owner}/${repo}`;
  const glHeaders = { "PRIVATE-TOKEN": token };

  const projectResponse = await fetch(`${baseUrl}/projects/${encodeURIComponent(projectPath)}`, { headers: glHeaders });
  if (!projectResponse.ok) throw new Error(`Failed to get project: ${projectResponse.statusText}`);
  const projectData = await projectResponse.json();
  const glProjectId = projectData.id;

  const pathParam = subPath ? `&path=${encodeURIComponent(subPath)}` : "";
  let allItems: any[] = [];
  let page = 1;
  const MAX_TREE_SCAN_ITEMS = 50000;
  let hitLimit = false;

  while (allItems.length < MAX_TREE_SCAN_ITEMS) {
    const treeResponse = await fetch(
      `${baseUrl}/projects/${glProjectId}/repository/tree?ref=${encodeURIComponent(branch)}&recursive=true&per_page=100&page=${page}${pathParam}`,
      { headers: glHeaders },
    );
    // GL-1 (owner report 2026-09-08): a failed page used to `break` into an
    // EMPTY scan — "no files detected" with no cause. Name it instead
    // (GitHub's scan already throws); the first page is the one that tells.
    if (!treeResponse.ok) {
      if (treeResponse.status === 401) throw new Error("GitLab rejected the access token (401) — re-save the integration with a token that has read_api + read_repository (or api) scope.");
      if (treeResponse.status === 404) throw new Error(`GitLab could not find branch "${branch}" of ${projectPath} (404) — check the branch name and that the token can see the project.`);
      throw new Error(`GitLab tree scan failed on page ${page} (HTTP ${treeResponse.status})`);
    }
    const items = await treeResponse.json();
    if (!items.length) break;
    allItems = allItems.concat(items);
    page++;
    if (allItems.length >= MAX_TREE_SCAN_ITEMS) {
      hitLimit = true;
      break;
    }
  }

  const entries: TreeScanEntry[] = allItems
    .filter((item: any) => item.type === "blob")
    .map((item: any) => ({
      path: item.path,
      size: item.size || 0,
    }));

  return { entries, truncated: hitLimit };
}

async function selectiveFetchGitLab(
  apiBase: string, owner: string, repo: string, branch: string, token: string,
  paths: string[], maxContentLength: number | undefined, truncatedFiles: string[],
): Promise<RepoFile[]> {
  const baseUrl = apiBase;
  const projectPath = `${owner}/${repo}`;
  const glHeaders = { "PRIVATE-TOKEN": token };

  const projectResponse = await fetch(`${baseUrl}/projects/${encodeURIComponent(projectPath)}`, { headers: glHeaders });
  if (!projectResponse.ok) throw new Error(`Failed to get project: ${projectResponse.statusText}`);
  const projectData = await projectResponse.json();
  const glProjectId = projectData.id;

  const files: RepoFile[] = [];
  const batchSize = 10;

  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (filePath: string) => {
        if (!encodeRepoPath(filePath)) return null;
        const fileResponse = await fetch(
          `${baseUrl}/projects/${glProjectId}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(branch)}`,
          { headers: glHeaders },
        );
        if (!fileResponse.ok) return null;
        let content = await fileResponse.text();
        let wasTruncated = false;
        if (maxContentLength && content.length > maxContentLength) {
          content = content.substring(0, maxContentLength);
          wasTruncated = true;
        }
        if (wasTruncated) truncatedFiles.push(filePath);
        return {
          path: filePath,
          content,
          size: content.length,
          language: detectLanguage(filePath),
        };
      }),
    );
    for (const result of results) {
      if (result) files.push(result);
    }
  }

  return files;
}

// ── R3-1: THE LOADER — restore the graph from the repo's model anchor ──────────────
// Git is the durable source of truth for the model; this is the git→canvas direction.
// AD.2b (D3, D4): loading git's model files it as a proposal of ordinary
// patches (fileModelLoadProposal): git's design, with the canvas's positions,
// file content and withheld values kept. A person accepts it in Proposals, and
// only then does the last sync move (proposal-baseline). Nothing here writes
// the canvas. When the canvas already holds git's design there is nothing to
// accept; the cards the load answers are answered at once.
async function handleRestoreModel(
  integration: { project_id: string },
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  branchName: string,
  automatic: boolean,
): Promise<Response> {
  const result = await fileModelLoadProposal(serviceClient, integration.project_id, branchName, {
    requestedBy: automatic ? "automatic" : "person",
  });
  if (!result.ok) {
    const statusByCode: Record<string, number> = {
      "no-integration": 404,
      "no-branch": 404,
      "no-head": 502,
      "no-anchor": 404,
      "read-failed": 502,
      "invalid-anchor": 422,
      "hash-failed": 422,
      "guard-failed": 409,
      "cannot-express": 409,
      "write-failed": 500,
    };
    return jsonResponse({ error: result.message, code: result.code }, statusByCode[result.code] ?? 500);
  }
  if (result.status === "identical") {
    return jsonResponse({
      success: true, status: "identical", headSha: result.headSha, baselineMoved: result.baselineMoved,
      ...(result.baselineNote ? { note: result.baselineNote } : {}),
    });
  }
  return jsonResponse({
    success: true, status: result.status, headSha: result.headSha, proposalId: result.proposalId,
    patchCount: result.patchCount, ...(result.notApplied.length > 0 ? { notApplied: result.notApplied } : {}),
  });
}

// R7c: load `.nodespec/spec.json` from the branch's bound ref. Adopts when the
// project has no spec, upserts when it does — and an upsert PRESERVES per-criterion
// `met` for unchanged criterion text, so evidence an AI produced (test passed →
// criterion met) survives a later spec load. Requirements the repo dropped are
// reported, never deleted.
// R5c: apply the criterionDeltas a sweep hung on this card. Ticks only — a stale
// or regenerated task doc showing an UNTICKED box must never retract evidence that
// something else (a passing test) proved.
async function handleApplyCriteria(
  integration: { project_id: string },
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  changeEventId: string | undefined,
  userId: string,
): Promise<Response> {
  if (!changeEventId) {
    return new Response(
      JSON.stringify({ error: "changeEventId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const { data: card } = await serviceClient
    .from("git_change_events")
    .select("id, commit_sha, author, metadata, project_id")
    .eq("id", changeEventId)
    .maybeSingle();
  if (!card || card.project_id !== integration.project_id) {
    return new Response(
      JSON.stringify({ error: "Change event not found for this project" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const deltas = card.metadata?.criterionDeltas;
  const cardTaskDeltas = card.metadata?.taskDeltas;
  const hasCriterionDeltas = deltas && Array.isArray(deltas.deltas);
  const hasTaskDeltas = cardTaskDeltas && Array.isArray(cardTaskDeltas.deltas);
  if (!hasCriterionDeltas && !hasTaskDeltas) {
    return new Response(
      JSON.stringify({ error: "This change carries no acceptance-criteria or task deltas" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  // AD.3 (ruling 3): this is the one way a criterion tick is applied, by a
  // person in the app. The provenance records who applied it beside who
  // committed it; for an automated criterion that is the person's own mark,
  // standing where a test result would. AL.29: written through the locked
  // criteria writer, and the card is marked applied only when every write landed.
  const out = await applyCardTicks(serviceClient, integration.project_id, card, userId);
  if (out.failed.length > 0) {
    const names = out.failed.map((f) => `${f.requirementId} (${f.reason})`).join(", ");
    return new Response(
      JSON.stringify({
        error: `${out.applied > 0 ? `Marked ${out.applied} acceptance criterion(s) met, but ` : ""}the criteria of ${names} could not be written. The card stays open; apply it again to write what is still unmet.`,
        applied: out.applied, tasksApplied: out.tasksApplied, requirements: out.requirements, failed: out.failed,
      }),
      { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, applied: out.applied, tasksApplied: out.tasksApplied, requirements: out.requirements }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

async function handleRestoreSpec(
  integration: { project_id: string },
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  branchName: string,
): Promise<Response> {
  const result = await restoreSpecFromRef(serviceClient, integration.project_id, branchName);
  if (!result.ok) {
    const statusByCode: Record<string, number> = {
      "no-integration": 404,
      "no-branch": 404,
      "no-head": 502,
      "read-failed": 502,
      "no-spec-file": 404,
      "invalid-spec": 422,
      "hash-failed": 422,
      "no-owner": 409,
      "write-failed": 500,
    };
    return new Response(
      JSON.stringify({ error: result.message }),
      { status: statusByCode[result.code] ?? 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  return new Response(
    JSON.stringify({
      success: true,
      restored: true,
      mode: result.mode,
      headSha: result.headSha,
      specHash: result.specHash,
      counts: result.counts,
      ...(result.keptLocal?.length ? { keptLocal: result.keptLocal } : {}),
      ...(result.locked?.length ? { locked: result.locked } : {}),
      baselineMoved: result.baselineMoved,
      ...(result.baselineNote ? { note: result.baselineNote } : {}),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

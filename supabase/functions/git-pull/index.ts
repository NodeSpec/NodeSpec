import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractOrchestratorAuth } from "../_shared/auth-helpers.ts";
import { getPrimaryBranch } from "../_shared/primary-branch.ts";
import { decryptWithUpgrade, isEncrypted } from "../_shared/crypto.ts";
import { providerApiBase, fetchRemoteHeadSha, fetchRepoFile } from "../_shared/git-provider.ts";
import { runDriftSweep, restoreBranchModelFromRef, restoreSpecFromRef, applyCriterionDeltas } from "../_shared/git-drift.ts";
import { applyTaskDeltas } from "../_shared/task-deltas.ts";
import { MODEL_ANCHOR_PATH, parseModel, verifyModelHash, anchorToGraph } from "../_shared/model-anchor.ts";
import { buildGitHubHeaders, fetchFullGitHubTree } from "../_shared/git-tree.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PullRequest {
  integrationId: string;
  path?: string;
  mode?: 'content-fetch' | 'tree-scan' | 'selective-fetch' | 'drift-check' | 'restore-model' | 'restore-spec' | 'apply-criteria';
  /** apply-criteria (R5c): the change-event card whose criterionDeltas to apply. */
  changeEventId?: string;
  /** R3-3a: restore-model targets this NodeSpec branch (default 'main'); the anchor
   *  is fetched from that branch's bound git ref. R3-3c: drift-check honors it too
   *  (branch-scoped sweep). */
  branchName?: string;
  /** R3-3c: drift-check only — user-initiated (branch switch) skips the throttle. */
  force?: boolean;
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

const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "rs", "go", "java", "kt", "swift", "c", "cpp", "h", "hpp", "cs",
  "html", "css", "scss", "less", "sass",
  "json", "yaml", "yml", "toml", "xml", "csv",
  "md", "txt", "rst",
  "sql", "graphql", "gql",
  "sh", "bash", "zsh", "fish",
  "dockerfile", "makefile", "cmake",
  "env", "gitignore", "editorconfig",
  "svelte", "vue", "astro",
  "tf", "hcl",
  "proto",
]);

const MAX_FILE_SIZE = 256 * 1024;
const MAX_FILES = 10_000;

function getExtension(path: string): string {
  const filename = path.split("/").pop() || "";
  if (filename.toLowerCase() === "dockerfile") return "dockerfile";
  if (filename.toLowerCase() === "makefile") return "makefile";
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ext;
}

function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(getExtension(path));
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
  integrationId: string
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
}> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  const { data: integration, error: integrationError } = await serviceClient
    .from("git_integrations")
    .select("id, project_id, provider, repo_owner, repo_name, default_branch, base_url, access_token_encrypted")
    .eq("id", integrationId)
    .maybeSingle();

  if (integrationError) throw integrationError;
  if (!integration) throw new Error("Integration not found");

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

    const { integrationId, path: subPath, mode, paths, maxContentLength, branchName, force, ref, changeEventId }: PullRequest = await req.json();
    const requestMode = mode || 'content-fetch';

    const { integration, token, serviceClient } = await resolveIntegrationAndToken(integrationId);

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

    if (requestMode === 'restore-model') {
      return await handleRestoreModel(integration, token, serviceClient, branchName ?? 'main');
    }
    // R7c: the spec plane's twin. Separate action on purpose — loading the repo's
    // requirements must not force a canvas replacement, and vice versa.
    if (requestMode === 'restore-spec') {
      return await handleRestoreSpec(integration, serviceClient, branchName ?? 'main');
    }
    // R5c: apply a card's ticked acceptance criteria. Owner rule (2026-07-21):
    // git ticks flow VIA THE DRIFT CARD — one approval, never silent. A file in a
    // repository must not be able to mutate the spec plane on its own.
    if (requestMode === 'apply-criteria') {
      return await handleApplyCriteria(integration, serviceClient, changeEventId);
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

    return await handleContentFetch(integration, token, subPath, serviceClient);
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

async function handleContentFetch(
  integration: { id: string; project_id: string; provider: string; repo_owner: string; repo_name: string; default_branch: string; base_url?: string | null },
  token: string,
  subPath: string | undefined,
  serviceClient: ReturnType<typeof createClient>,
): Promise<Response> {
  const apiBase = providerApiBase(integration.provider, integration.base_url);
  let files: RepoFile[];
  let totalMatched = 0;
  let treeTruncated = false;

  if (integration.provider === "github") {
    const result = await pullFromGitHub(apiBase, integration.repo_owner, integration.repo_name, integration.default_branch, token, subPath);
    files = result.files;
    totalMatched = result.totalMatched;
    treeTruncated = result.truncated;
  } else if (integration.provider === "gitlab") {
    const result = await pullFromGitLab(apiBase, integration.repo_owner, integration.repo_name, integration.default_branch, token, subPath);
    files = result.files;
    totalMatched = result.totalMatched;
  } else {
    throw new Error(`Unsupported provider: ${integration.provider}`);
  }

  await serviceClient.from("git_integrations").update({
    last_sync_at: new Date().toISOString(),
    sync_status: "idle",
  }).eq("id", integration.id);

  // P1-7 R1: record WHICH commit this pull reflected (previously omitted — pulls never captured
  // a SHA, so no sync baseline could ever be established from the pull side) and advance the
  // main branch's drift baseline to it.
  let pulledHeadSha: string | null = null;
  try {
    pulledHeadSha = await fetchRemoteHeadSha(
      integration.provider, apiBase, integration.repo_owner, integration.repo_name,
      integration.default_branch, token,
    );
    if (pulledHeadSha) {
      const primary = await getPrimaryBranch(serviceClient, integration.project_id, "id, name, is_primary");
      if (primary) {
        await serviceClient
          .from("branches")
          .update({ last_synced_commit: pulledHeadSha, git_ref: integration.default_branch })
          .eq("id", primary.id);
      }
    }
  } catch (headErr) {
    console.warn("[git-pull] failed to capture pulled HEAD SHA:", headErr);
  }

  await serviceClient.from("git_sync_log").insert({
    integration_id: integration.id,
    project_id: integration.project_id,
    direction: "pull",
    status: "success",
    commit_sha: pulledHeadSha,
    patches_synced: files.length,
    completed_at: new Date().toISOString(),
    metadata: { fileCount: files.length, subPath: subPath || "/" },
  });

  return new Response(
    JSON.stringify({
      success: true,
      files,
      fileCount: files.length,
      totalMatched,
      truncated: treeTruncated || totalMatched > files.length,
      ...(treeTruncated ? { treeTruncatedNote: "Tree traversal was incomplete. totalMatched may be understated." } : {}),
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

async function pullFromGitHub(
  apiBase: string, owner: string, repo: string, branch: string, token: string,
  subPath?: string,
): Promise<{ files: RepoFile[]; totalMatched: number; truncated: boolean }> {
  const baseUrl = apiBase;
  const headers = buildGitHubHeaders(token);
  const { tree, truncated } = await fetchFullGitHubTree(apiBase, owner, repo, branch, headers);

  let blobs = tree.filter((item: any) =>
    item.type === "blob" && isTextFile(item.path) && item.size <= MAX_FILE_SIZE
  );

  if (subPath) {
    const prefix = subPath.endsWith("/") ? subPath : subPath + "/";
    blobs = blobs.filter((item: any) => item.path.startsWith(prefix) || item.path === subPath);
  }

  const totalMatched = blobs.length;
  blobs = blobs.slice(0, MAX_FILES);

  const files: RepoFile[] = [];

  const batchSize = 10;
  for (let i = 0; i < blobs.length; i += batchSize) {
    const batch = blobs.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (blob: any) => {
        const contentResponse = await fetch(
          `${baseUrl}/repos/${owner}/${repo}/contents/${blob.path}?ref=${branch}`,
          { headers: { ...headers, "Accept": "application/vnd.github.raw+json" } },
        );
        if (!contentResponse.ok) return null;
        const content = await contentResponse.text();
        return {
          path: blob.path,
          content,
          size: blob.size,
          language: detectLanguage(blob.path),
        };
      }),
    );
    for (const result of results) {
      if (result) files.push(result);
    }
  }

  return { files, totalMatched, truncated };
}

async function selectiveFetchGitHub(
  apiBase: string, owner: string, repo: string, branch: string, token: string,
  paths: string[], maxContentLength: number | undefined, truncatedFiles: string[],
): Promise<RepoFile[]> {
  const baseUrl = apiBase;
  const headers = {
    ...buildGitHubHeaders(token),
    "Accept": "application/vnd.github.raw+json",
  };

  const files: RepoFile[] = [];
  const batchSize = 10;

  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (filePath: string) => {
        const contentResponse = await fetch(
          `${baseUrl}/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
          { headers },
        );
        if (!contentResponse.ok) return null;
        let content = await contentResponse.text();
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
      `${baseUrl}/projects/${glProjectId}/repository/tree?ref=${branch}&recursive=true&per_page=100&page=${page}${pathParam}`,
      { headers: glHeaders },
    );
    if (!treeResponse.ok) break;
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

async function pullFromGitLab(
  apiBase: string, owner: string, repo: string, branch: string, token: string,
  subPath?: string,
): Promise<{ files: RepoFile[]; totalMatched: number }> {
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

  while (allItems.length < MAX_FILES) {
    const treeResponse = await fetch(
      `${baseUrl}/projects/${glProjectId}/repository/tree?ref=${branch}&recursive=true&per_page=100&page=${page}${pathParam}`,
      { headers: glHeaders },
    );
    if (!treeResponse.ok) break;
    const items = await treeResponse.json();
    if (!items.length) break;
    allItems = allItems.concat(items);
    page++;
  }

  const matchedBlobs = allItems
    .filter((item: any) => item.type === "blob" && isTextFile(item.path));
  const totalMatched = matchedBlobs.length;
  const blobs = matchedBlobs.slice(0, MAX_FILES);

  const files: RepoFile[] = [];
  const batchSize = 10;

  for (let i = 0; i < blobs.length; i += batchSize) {
    const batch = blobs.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (blob: any) => {
        const fileResponse = await fetch(
          `${baseUrl}/projects/${glProjectId}/repository/files/${encodeURIComponent(blob.path)}/raw?ref=${branch}`,
          { headers: glHeaders },
        );
        if (!fileResponse.ok) return null;
        const content = await fileResponse.text();
        return {
          path: blob.path,
          content,
          size: content.length,
          language: detectLanguage(blob.path),
        };
      }),
    );
    for (const result of results) {
      if (result) files.push(result);
    }
  }

  return { files, totalMatched };
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
        const fileResponse = await fetch(
          `${baseUrl}/projects/${glProjectId}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${branch}`,
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
// Whole-graph replace via a NEW snapshot (N6.1 snapshot-only persist precedent —
// graph_patches are NEVER rewritten; the log keeps forward history, the snapshot
// moves). Establishes the baseline at the restored HEAD and resolves any pending
// model cards (their question — "which side wins?" — has been answered: git did).
// Invoked EXPLICITLY only (a card button / the blocked-push panel); never automatic.
// R3-3a/merge-arrival: the restore CORE lives in _shared/git-drift.ts
// (restoreBranchModelFromRef) so the sweep's and webhook's merge-arrival lanes
// share ONE implementation. This handler is the explicit user-invoked lane —
// no canvas==baseline guard (the user chose git as the winner) — and maps the
// shared result codes onto HTTP responses.
async function handleRestoreModel(
  integration: {
    id: string;
    project_id: string;
    provider: string;
    repo_owner: string;
    repo_name: string;
    default_branch: string;
    base_url?: string | null;
  },
  _token: string,
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  branchName: string,
): Promise<Response> {
  const result = await restoreBranchModelFromRef(serviceClient, integration.project_id, branchName);
  if (!result.ok) {
    const statusByCode: Record<string, number> = {
      "no-integration": 404,
      "no-branch": 404,
      "no-head": 502,
      "no-anchor": 404,
      "invalid-anchor": 422,
      "hash-failed": 422,
      "guard-failed": 409,
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
      headSha: result.headSha,
      modelHash: result.modelHash,
      counts: result.counts,
      note: "Artifact file contents are not stored in the anchor — they hydrate on demand via Load-from-repo in the Files tab.",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
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
  changeEventId?: string,
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
  const result = hasCriterionDeltas
    ? await applyCriterionDeltas(serviceClient, integration.project_id, {
        deltas,
        commitSha: card.commit_sha ?? undefined,
        actor: card.author ?? undefined,
      })
    : { applied: 0, requirementsTouched: [] as string[] };

  // A4 (docs/WORK_LOOP_PLAN.md): the card's anchored-task ticks apply through
  // the SAME action — one approval covers both checkbox families. Tick-only
  // and idempotent (already-done rows are skipped), like the criterion lane.
  let tasksApplied = 0;
  if (hasTaskDeltas) {
    const taskResult = await applyTaskDeltas(serviceClient, integration.project_id, {
      deltas: cardTaskDeltas,
      commitSha: card.commit_sha ?? undefined,
      actor: card.author ?? undefined,
      source: "git",
    });
    tasksApplied = taskResult.applied;
  }

  // Record that this card's completion question has been answered, so
  // re-opening the card cannot apply the same ticks twice — ONE metadata
  // write carries both stamps.
  await serviceClient
    .from("git_change_events")
    .update({
      metadata: {
        ...(card.metadata ?? {}),
        criteriaApplied: { at: new Date().toISOString(), count: result.applied },
        ...(hasTaskDeltas ? { ticksApplied: { at: new Date().toISOString(), count: tasksApplied } } : {}),
      },
    })
    .eq("id", card.id);

  return new Response(
    JSON.stringify({ success: true, applied: result.applied, tasksApplied, requirements: result.requirementsTouched }),
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
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

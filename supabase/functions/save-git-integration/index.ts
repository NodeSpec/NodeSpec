import { createClient } from "jsr:@supabase/supabase-js@2";
import { encrypt } from "../_shared/crypto.ts";
import { getPrimaryBranch, computePrimaryRename } from "../_shared/primary-branch.ts";
import { extractOrchestratorAuth } from "../_shared/auth-helpers.ts";
import { providerApiBase, fetchRemoteHeadSha, fetchRemoteHeadShaDetailed, readRepoFile } from "../_shared/git-provider.ts";
import { advanceBaseline, ancestryFor } from "../_shared/baseline.ts";
import { MODEL_ANCHOR_PATH, parseModel, verifyModelHash, anchorToPatches, serializeModel, diffAnchors, capAnchorDiff, sameDesign, type ModelAnchor } from "../_shared/model-anchor.ts";
import { SPEC_ANCHOR_PATH, parseSpec, adoptSpecAnchor } from "../_shared/spec-anchor.ts";
import { summarizeAnchor, decideConnectAnchorAction, loadLatestSnapshot } from "../_shared/git-drift.ts";
import { getEffectiveTier } from "../_shared/deployment.ts";
import { featureAllowed } from "../_shared/feature-rules.ts";
import { newWebhookSecret, readWebhookSecret, webhookSecretToKeep } from "../_shared/webhook-secret.ts";
import { isWorkBranch } from "../_shared/commit-mode.ts";
import { mayUseIntegration } from "../_shared/git-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SaveIntegrationRequest {
  projectId: string;
  provider: "github" | "gitlab";
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  accessToken: string;
  baseUrl?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { userId } = await extractOrchestratorAuth(req);
    const body: SaveIntegrationRequest = await req.json();
    const { projectId, provider, repoOwner, repoName, defaultBranch, accessToken, baseUrl } = body;
    // P1-7 R1.5: optional self-hosted provider API base (GitHub Enterprise Server /api/v3,
    // self-managed GitLab /api/v4, or a local container on the bench). Null = cloud default.
    const normalizedBaseUrl: string | null = typeof baseUrl === 'string' && baseUrl.trim()
      ? baseUrl.trim().replace(/\/+$/, '')
      : null;
    if (normalizedBaseUrl && !/^https?:\/\//.test(normalizedBaseUrl)) {
      return new Response(
        JSON.stringify({ error: 'baseUrl must be an http(s) URL (e.g. https://gitlab.example.com/api/v4)' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const trimmedToken = (accessToken || '').trim();

    if (!projectId || !provider || !repoOwner || !repoName || !trimmedToken) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // AD.4 (D16): a nodespec/push-* branch is where NodeSpec opens pull
    // requests from; tracking it would read a pull request's work as the design.
    if (isWorkBranch(defaultBranch)) {
      return new Response(
        JSON.stringify({ error: `"${defaultBranch}" is a branch NodeSpec opens pull requests from. Choose the branch they merge into.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: project, error: projectError } = await serviceClient
      .from("projects")
      .select("id, owner_id")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError || !project) {
      return new Response(
        JSON.stringify({ error: "Project not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // The owner, or a maintainer seat on a Team project, manages the
    // repository connection (owner 2026-09-27).
    if (!(await mayUseIntegration(serviceClient, { integrationProjectId: projectId, userId, access: "manage" }))) {
      return new Response(
        JSON.stringify({ error: "Connecting the repository needs the project owner or a maintainer." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // R3-3d: the reachability probe below already returns the repo object, which
    // carries the PROVIDER's real default branch. Capture it — the client seeds its
    // form field with 'main', so a manually-typed connection to a master-default
    // repo used to bind main's git_ref to a branch that does not exist, and every
    // later fetch/sweep/push on that ref failed for a reason nobody could see.
    let providerDefaultBranch: string | null = null;

    if (provider === 'github') {
      const testResp = await fetch(`${normalizedBaseUrl || 'https://api.github.com'}/repos/${repoOwner.trim()}/${repoName.trim()}`, {
        headers: {
          'Authorization': `Bearer ${trimmedToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (testResp.status === 401) {
        return new Response(
          JSON.stringify({ error: 'Invalid GitHub token. Check that your token is correct and not expired.' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (testResp.status === 404) {
        return new Response(
          JSON.stringify({ error: `Repository ${repoOwner}/${repoName} not found. Check the repo name and ensure your token has the "repo" scope.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (testResp.ok) {
        try { providerDefaultBranch = (await testResp.json())?.default_branch ?? null; } catch { /* probe only */ }
      }
    } else if (provider === 'gitlab') {
      const glPath = `${repoOwner.trim()}/${repoName.trim()}`;
      const testResp = await fetch(`${normalizedBaseUrl || 'https://gitlab.com/api/v4'}/projects/${encodeURIComponent(glPath)}`, {
        headers: { 'PRIVATE-TOKEN': trimmedToken },
      });
      if (testResp.status === 401) {
        return new Response(
          JSON.stringify({ error: 'Invalid GitLab token. Check that your token is correct and not expired.' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (testResp.status === 404) {
        return new Response(
          JSON.stringify({ error: `Repository ${repoOwner}/${repoName} not found. Check the repo path and ensure your token has the "api" scope.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (testResp.ok) {
        try { providerDefaultBranch = (await testResp.json())?.default_branch ?? null; } catch { /* probe only */ }
      }
    }

    // R3-3d: refuse to BIND a ref that does not exist. Only checked when the
    // submitted branch differs from the provider's default (the common path costs
    // no extra call). Deliberately a rejection, not a silent auto-correction:
    // quietly rewriting the user's branch choice is how a project ends up synced
    // against a ref it never chose.
    if (providerDefaultBranch && defaultBranch && defaultBranch !== providerDefaultBranch) {
      const probe = await fetchRemoteHeadShaDetailed(
        provider, providerApiBase(provider, normalizedBaseUrl),
        repoOwner.trim(), repoName.trim(), defaultBranch, trimmedToken,
      );
      if (!probe.sha) {
        return new Response(
          JSON.stringify({
            error: `Branch "${defaultBranch}" does not exist in ${repoOwner}/${repoName}. ` +
              `This repository's default branch is "${providerDefaultBranch}" — use "Detect branches" to pick it.`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const encryptedToken = await encrypt(trimmedToken);

    const { data: existing } = await serviceClient
      .from("git_integrations")
      .select("id, provider, repo_owner, repo_name, default_branch, base_url, webhook_secret")
      .eq("project_id", projectId)
      .maybeSingle();

    // R2.2 fix (owner bench: reconnect raised a phantom mismatch card): only a CHANGED
    // binding invalidates the baseline. Re-saving the same repo/branch (token refresh,
    // reconnect) must keep it — the unconditional null here was why every reconnect
    // read as "never synced".
    const bindingChanged = !existing ||
      existing.provider !== provider ||
      existing.repo_owner !== repoOwner ||
      existing.repo_name !== repoName ||
      existing.default_branch !== defaultBranch ||
      (existing.base_url ?? null) !== normalizedBaseUrl;

    // AD.0 (S2): the webhook's secret. Kept across saves of the same binding,
    // made new when there is none or the repository changed (its webhook lives
    // there), stored encrypted like the token, and returned to the owner on
    // every save so the Git panel can show it beside the webhook URL.
    const keptSecret = webhookSecretToKeep(await readWebhookSecret(existing?.webhook_secret), bindingChanged);
    const webhookSecret = keptSecret ?? newWebhookSecret();
    const encryptedWebhookSecret = await encrypt(webhookSecret);

    let integrationId: string;
    if (existing) {
      const { error: updateError } = await serviceClient
        .from("git_integrations")
        .update({
          provider,
          repo_owner: repoOwner,
          repo_name: repoName,
          default_branch: defaultBranch,
          base_url: normalizedBaseUrl,
          access_token_encrypted: encryptedToken,
          webhook_secret: encryptedWebhookSecret,
        })
        .eq("id", existing.id);

      if (updateError) throw updateError;
      integrationId = existing.id;
    } else {
      const { data: inserted, error: insertError } = await serviceClient
        .from("git_integrations")
        .insert({
          project_id: projectId,
          provider,
          repo_owner: repoOwner,
          repo_name: repoName,
          default_branch: defaultBranch,
          base_url: normalizedBaseUrl,
          access_token_encrypted: encryptedToken,
          webhook_secret: encryptedWebhookSecret,
          created_by: userId,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;
      integrationId = inserted.id;
    }
    const webhook = { integrationId, secret: webhookSecret, created: keptSecret === null };

    // P1-7 R1: bind the project's main branch to the integration's default git branch — the
    // 1:1 branch↔git-ref mirror the bidirectional sync loop keys on. R2.2 fix: the baseline
    // is reset ONLY when the binding actually changed — the old SHA is meaningless against a
    // different repo/ref, but re-saving the SAME binding must keep it.
    // Owner spike 2026-08-23: resolve the trunk by IDENTITY (is_primary),
    // not the literal name — and make the header truthful: the trunk row
    // RENAMES to the git branch it now mirrors (collision-guarded: a sibling
    // already holding that name is never overwritten — see
    // computePrimaryRename). Binding also stamps is_primary, self-healing
    // legacy rows resolved through the naming fallback.
    let primaryBranch: { id: string; name: string } | null = null;
    let primaryRename: { rename: boolean; to?: string; reason: string } = { rename: false, reason: "no primary branch" };
    const primaryRow = await getPrimaryBranch(serviceClient, projectId);
    if (primaryRow) {
      primaryBranch = { id: primaryRow.id, name: primaryRow.name };
      const { error: bindError } = await serviceClient
        .from("branches")
        .update({ git_ref: defaultBranch, is_primary: true, ...(bindingChanged ? { last_synced_commit: null } : {}) })
        .eq("id", primaryRow.id);
      if (bindError) {
        console.warn(`[save-git-integration] primary-branch binding failed: ${bindError.message}`);
      }
      const { data: siblingRows } = await serviceClient
        .from("branches").select("id, name").eq("project_id", projectId);
      const siblingNames = ((siblingRows ?? []) as Array<{ id: string; name: string }>)
        .filter((b) => b.id !== primaryRow.id).map((b) => b.name);
      primaryRename = computePrimaryRename({ primaryName: primaryRow.name, gitBranch: defaultBranch, siblingNames });
      if (primaryRename.rename && primaryRename.to) {
        const { error: renameError } = await serviceClient
          .from("branches").update({ name: primaryRename.to }).eq("id", primaryRow.id);
        if (renameError) {
          primaryRename = { rename: false, reason: `rename failed: ${renameError.message}` };
        } else {
          primaryBranch = { id: primaryRow.id, name: primaryRename.to };
        }
      }
    } else {
      console.warn("[save-git-integration] no primary branch row found — binding skipped");
    }

    // P1-7 R2: ADOPT-ON-CONNECT (the provenance ratchet). If the connected repo carries a
    // NodeSpec model anchor AND this project's graph is empty, materialize the AUTHORED design
    // through the normal proposal pipeline — read, never re-inferred; ids and relationships
    // travel with the repo. Non-empty graphs are left to the drift sweep (no silent overwrite).
    // Best-effort: adoption failure never fails the save.
    // deno-lint-ignore no-explicit-any
    let anchorAdopt: Record<string, any> = { detected: false };
    // R7b: the spec plane reports separately from the architecture — "nodes came
    // in but requirements did not" must be readable from the response, not inferred.
    // deno-lint-ignore no-explicit-any
    const specAdopt: Record<string, any> = { detected: false };
    try {
      const { data: mainBranch } = primaryBranch
        ? await serviceClient
          .from("branches").select("id, last_synced_commit").eq("id", primaryBranch.id).maybeSingle()
        : { data: null };
      if (mainBranch) {
        const { graph: snapGraph } = await loadLatestSnapshot(serviceClient, mainBranch.id);
        const nodeCount = snapGraph?.nodes ? Object.keys(snapGraph.nodes).length : 0;

        const apiBase = providerApiBase(provider, normalizedBaseUrl);
        // AD.1 (D11): a model.json the provider would not serve is not a
        // repository without one. Treating it as absent used to start an import
        // over a repository that already carries a design.
        const anchorRead = await readRepoFile(provider, apiBase, repoOwner.trim(), repoName.trim(), MODEL_ANCHOR_PATH, defaultBranch, trimmedToken);
        const anchorText = anchorRead.status === "found" ? anchorRead.text : null;

        if (anchorRead.status === "failed") {
          anchorAdopt.skipped = `could not read ${MODEL_ANCHOR_PATH} (${anchorRead.error}), so nothing was adopted, compared or imported; save again to retry`;
        } else if (!anchorText) {
          // Observability parity with every other branch: the no-anchor outcome
          // must be NAMED (the bench read a blank here when the contents API
          // served a stale 404 right after a push — silence hid which branch ran).
          anchorAdopt.skipped = "no anchor found in the repository — nothing to adopt or compare";
          // C3: no anchor AND an empty graph = the brownfield entry. Create an
          // import job the client drives (skeleton → fetch → enrich → synthesize);
          // the result lands as ONE reviewable proposal. Best-effort like the rest
          // of this block — a job-insert failure never fails the save.
          // Q (owner 2026-09-22): repo import is Indie and above, so below it
          // no job is made and the response carries no importJob; the save
          // itself (git export and pull) is the same on every plan. The plan
          // is the project's, its owner's, whoever connects the repository.
          let importAllowed = false;
          try { importAllowed = featureAllowed(await getEffectiveTier(serviceClient as never, project.owner_id), "repo_import"); } catch { /* fail closed */ }
          if (nodeCount === 0 && importAllowed) {
            const { data: existingJob } = await serviceClient
              .from("import_jobs")
              .select("id, status")
              .eq("project_id", projectId)
              .in("status", ["pending", "running", "awaiting_review"])
              .maybeSingle();
            if (existingJob) {
              anchorAdopt.importJob = { id: existingJob.id, status: existingJob.status, resumed: true };
            } else {
              const { data: integrationRow } = await serviceClient
                .from("git_integrations").select("id").eq("project_id", projectId).maybeSingle();
              const jobId = crypto.randomUUID();
              const { error: jobErr } = await serviceClient.from("import_jobs").insert({
                id: jobId,
                project_id: projectId,
                branch_id: mainBranch.id,
                integration_id: integrationRow?.id ?? null,
                status: "pending",
                stage: "skeleton",
              });
              if (jobErr) {
                console.warn(`[save-git-integration] import job insert failed: ${jobErr.message}`);
              } else {
                anchorAdopt.importJob = { id: jobId, status: "pending" };
              }
            }
          }
        }
        if (anchorText) {
          anchorAdopt.detected = true;
          const parsed = parseModel(anchorText);
          if (!parsed.ok) {
            anchorAdopt.skipped = `anchor invalid: ${parsed.error}`;
          } else if (!(await verifyModelHash(parsed.model))) {
            anchorAdopt.skipped = "anchor failed hash verification (tampered or hand-edited) — resolve via drift review";
          } else if (nodeCount > 0) {
            // R2.2 RESTORE LANE, non-empty half (owner disaster-recovery discovery),
            // fixed after the owner's reconnect bench: a repo anchor that IS this
            // project's own model is NOT a mismatch — disconnect/reconnect with no
            // changes must be a NO-OP (auto re-baseline, no card). A card is raised
            // only for GENUINE divergence on an unbaselined branch: ACCEPT =
            // establish the baseline (this project's model wins on the next push),
            // DISMISS = stay unbaselined (the push overwrite guard keeps
            // protecting). Baselined divergence belongs to the drift sweep. Full
            // RESTORE into a non-empty project is R3's branch-switch loader —
            // until then, restore by connecting a FRESH project.
            try {
              const summary = summarizeAnchor(parsed.model);
              anchorAdopt.repoAnchor = summary;

              let ownParsedModel: ModelAnchor | null = null;
              let projectMatchesAnchor = false;
              try {
                const ownParsed = parseModel(await serializeModel(snapGraph ?? {}));
                if (ownParsed.ok) {
                  ownParsedModel = ownParsed.model;
                  // R7d: never the stored hashes: a pre-R7d repo anchor's stored
                  // hash covers a mappings section today's serialization no
                  // longer emits. Same design must read as a match (reconnect
                  // stays a no-op). AD.2: the whole design when the repo's
                  // anchor carries it, architecture when it is version 1.
                  projectMatchesAnchor = await sameDesign(ownParsed.model, parsed.model);
                }
              } catch (hashErr) {
                console.warn("[save-git-integration] own-model hash computation failed:", hashErr);
              }

              const baselineAfterBind = bindingChanged ? null : (mainBranch.last_synced_commit ?? null);
              const action = decideConnectAnchorAction({
                anchorPresent: true, parsedOk: true, hashOk: true, nodeCount,
                projectMatchesAnchor,
                baselined: !!baselineAfterBind,
              });

              if (action === "auto-baseline") {
                // AD.1 (D10): only an unbaselined branch gets here, and the one
                // writer sets its first baseline.
                const anchorHeadSha = await fetchRemoteHeadSha(provider, apiBase, repoOwner.trim(), repoName.trim(), defaultBranch, trimmedToken);
                if (anchorHeadSha) {
                  await advanceBaseline(serviceClient, {
                    branchId: mainBranch.id, to: anchorHeadSha,
                    ancestry: ancestryFor(provider, apiBase, repoOwner.trim(), repoName.trim(), trimmedToken),
                  });
                }
                anchorAdopt.skipped = "repo anchor matches this project's model — baseline re-established, nothing to review";
              } else if (action === "none") {
                anchorAdopt.skipped = "model differs but the branch is baselined — the drift sweep owns divergence";
              } else {
                anchorAdopt.skipped = "project graph is not empty and differs from the repo model — mismatch card raised";
                // Re-saving the integration must not stack duplicate cards.
                const { data: pendingCards } = await serviceClient
                  .from("git_change_events").select("id, metadata")
                  .eq("project_id", projectId).eq("status", "pending");
                // deno-lint-ignore no-explicit-any
                const existingCard = ((pendingCards ?? []) as any[]).find((e) => e?.metadata?.source === "connect-anchor-mismatch");
                if (existingCard) {
                  anchorAdopt.mismatchCardId = existingCard.id;
                } else {
                  const anchorHeadSha = await fetchRemoteHeadSha(provider, apiBase, repoOwner.trim(), repoName.trim(), defaultBranch, trimmedToken);
                  if (!anchorHeadSha) {
                    // Never write a garbage baseline: without a real HEAD sha the card's
                    // accept path has nothing valid to advance to. The push guard still
                    // protects; the card can be raised on the next save.
                    anchorAdopt.skipped = "model differs but the remote HEAD could not be resolved — no card raised; the push guard still protects the repo copy";
                  } else {
                    const { data: integrationRow } = await serviceClient
                      .from("git_integrations").select("id").eq("project_id", projectId).maybeSingle();
                    const { data: cardRow } = await serviceClient.from("git_change_events").insert({
                      integration_id: integrationRow?.id,
                      project_id: projectId,
                      commit_sha: anchorHeadSha,
                      commit_message: `This repository already carries a NodeSpec model (${summary.nodes} node(s), ${summary.edges} edge(s), hash ${summary.modelHash.slice(0, 12)}…) that differs from this project's. Accept to acknowledge it — your project's model will overwrite it on the next push. Dismiss to keep the repo copy protected (pushes will ask for explicit confirmation). To RESTORE the repo model instead, connect it to a fresh empty project.`,
                      changed_files: [{ path: MODEL_ANCHOR_PATH, action: "modified" }],
                      status: "pending",
                      metadata: {
                        source: "connect-anchor-mismatch",
                        repoAnchor: summary,
                        // R3-2: entity-level model diff (project → repo direction:
                        // "what LOADING the repo would do to your canvas").
                        ...(ownParsedModel ? { modelDiff: capAnchorDiff(diffAnchors(ownParsedModel, parsed.model)) } : {}),
                      },
                    }).select("id").maybeSingle();
                    anchorAdopt.mismatchCardId = cardRow?.id;
                  }
                }
              }
            } catch (cardErr) {
              console.warn("[save-git-integration] connect-anchor evaluation failed:", cardErr);
            }
          } else {
            // R3-4b (owner bench 2026-07-30): stamp the ref HEAD the anchor was read
            // from, so adopted artifacts carry the same {origin, commitSha, at} detail
            // the other lanes write. Best-effort — a failed lookup still yields
            // origin + timestamp rather than the NULL detail this lane used to leave.
            let adoptHeadSha: string | undefined;
            try {
              adoptHeadSha = (await fetchRemoteHeadSha(
                provider, apiBase, repoOwner.trim(), repoName.trim(), defaultBranch, trimmedToken,
              )) ?? undefined;
            } catch { /* provenance detail degrades to origin+timestamp; adoption proceeds */ }
            const patches = anchorToPatches(parsed.model, "git-adopt", adoptHeadSha);
            const aiRunId = crypto.randomUUID();
            const proposalId = crypto.randomUUID();
            await serviceClient.from("ai_runs").insert({
              id: aiRunId, project_id: projectId, branch_id: mainBranch.id,
              model: "git-adopt", prompt_hash: "git-adopt", status: "completed",
              completed_at: new Date().toISOString(),
              metadata: { source: "git-adopt", modelHash: parsed.model.modelHash, patchCount: patches.length },
            });
            const { error: propError } = await serviceClient.from("ai_proposals").insert({
              id: proposalId, ai_run_id: aiRunId,
              source_branch_id: mainBranch.id, proposal_branch_id: mainBranch.id,
              status: "pending",
              patches: patches.map((patch) => ({ patch, status: "pending", explanation: patch.metadata.summary })),
              validation_expectations: [],
              metadata: {
                source: "git-adopt", modelHash: parsed.model.modelHash,
                anchorMappings: parsed.model.mappings ?? [], // legacy anchors only — spec.json owns mappings since R7
                // AD.1 (D5): the commit the model was read at. The branch's
                // baseline is set to it when this proposal is accepted.
                ...(adoptHeadSha ? { adoptHeadSha } : {}),
              },
            });
            if (propError) {
              anchorAdopt.skipped = `proposal insert failed: ${propError.message}`;
            } else {
              anchorAdopt.proposalId = proposalId;
              anchorAdopt.counts = {
                nodes: parsed.model.nodes.length, edges: parsed.model.edges.length,
                contracts: parsed.model.contracts.length, artifacts: parsed.model.artifacts.length,
              };
              // AD.1 (D5): no baseline yet. It used to be set here, before anyone
              // accepted the adopt; a rejected adopt then left the branch reading
              // as in sync with an empty canvas, and the next push deleted every
              // file the repository's model listed. Unbaselined, the push guard
              // asks first; accepting the proposal sets the baseline.
            }
          }
        }

        // ── R7b: adopt the SPEC plane ────────────────────────────────────────
        // Owner 2026-07-31: "requirements/acceptance criteria and spec are not
        // imported at all." They live in their own anchor (`.nodespec/spec.json`)
        // so evidence state never churns the architecture's modelHash — see
        // _shared/spec-anchor.ts for the full ruling.
        //
        // Runs INDEPENDENTLY of which architecture branch was taken above: the
        // question "does this project have requirements?" is separate from "does
        // its graph match the repo?", and importing a spec into a project that has
        // none is purely additive. adoptSpecAnchor refuses if a spec already
        // exists — reconciling a DIVERGED spec is R7c's card, never a silent
        // overwrite.
        try {
          const specRead = await readRepoFile(
            provider, apiBase, repoOwner.trim(), repoName.trim(), SPEC_ANCHOR_PATH, defaultBranch, trimmedToken,
          );
          const specText = specRead.status === "found" ? specRead.text : null;
          if (specRead.status === "failed") {
            specAdopt.detected = true;
            specAdopt.skipped = `could not read ${SPEC_ANCHOR_PATH} (${specRead.error}), so no requirements were adopted; save again to retry`;
          } else if (specText) {
            specAdopt.detected = true;
            const parsedSpec = parseSpec(specText);
            if (!parsedSpec.ok) {
              specAdopt.skipped = `spec.json invalid: ${parsedSpec.error}`;
            } else {
              let specHeadSha: string | undefined;
              try {
                specHeadSha = (await fetchRemoteHeadSha(
                  provider, apiBase, repoOwner.trim(), repoName.trim(), defaultBranch, trimmedToken,
                )) ?? undefined;
              } catch { /* provenance degrades to origin+timestamp; adoption proceeds */ }
              const result = await adoptSpecAnchor(serviceClient, {
                projectId,
                ownerId: userId,
                spec: parsedSpec.spec,
                // Deliberately NOT filtered by live nodes: the architecture
                // adoption above is a PENDING proposal, so its nodes do not exist
                // yet and a liveness filter here would drop every mapping. Dead
                // mappings are already handled downstream — loadAnchorMappings
                // filters them on the way back out to the anchor.
                liveNodeIds: null,
                sourceCommit: specHeadSha,
              });
              if (result.adopted) {
                specAdopt.specId = result.specId;
                specAdopt.counts = result.counts;
                if (result.skippedMappings > 0) specAdopt.skippedMappings = result.skippedMappings;
              } else {
                specAdopt.skipped = result.message ?? result.reason;
              }
            }
          }
        } catch (specErr) {
          console.warn("[save-git-integration] spec adopt failed (save + anchor adopt still succeeded):", specErr);
          specAdopt.skipped = "spec adopt error — see function logs";
        }
      }
    } catch (adoptErr) {
      console.warn("[save-git-integration] adopt-on-connect failed (save still succeeded):", adoptErr);
      anchorAdopt = { detected: anchorAdopt.detected ?? false, skipped: "adopt error — see function logs" };
    }

    // AD.2b: connect no longer materializes the repository's other branches as
    // design branches (R3-6). That wrote each branch's snapshot straight from
    // git, and 2.2 keeps one design branch per project (the AD.4 retirement,
    // taken here because no path may write a snapshot from git).

    return new Response(
      JSON.stringify({ success: true, anchorAdopt, specAdopt, primaryBranch: primaryBranch ? { ...primaryBranch, gitRef: defaultBranch, renamed: primaryRename.rename, renameReason: primaryRename.reason } : null, webhook }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("Save git integration error:", error);
    const message = error.message || "Failed to save integration";
    const status = message.includes("Authentication") || message.includes("authorization") ? 401 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

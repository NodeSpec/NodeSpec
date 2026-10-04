import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractOrchestratorAuth } from "../_shared/auth-helpers.ts";
import { decryptWithUpgrade, isEncrypted } from "../_shared/crypto.ts";
import { serializeModelWithReport, serializeModel, parseModel, diffAnchors, renderAnchorDiffMarkdown, sameDesign, verifyModelHash, MODEL_ANCHOR_PATH, type ModelAnchor, type WithheldValue } from "../_shared/model-anchor.ts";
import { serializeSpec, loadSpecPlane, SPEC_ANCHOR_PATH } from "../_shared/spec-anchor.ts";
import { constraintsCarried } from "../_shared/node-constraints.ts";
import { providerApiBase, fetchRepoFile, readRepoFile, fetchRemoteHeadSha, fetchRemoteHeadShaDetailed, createRemoteBranch, createPullRequest, mergeRemoteBranch, listPullRequests, resetRemoteBranch, type PullRequestRef } from "../_shared/git-provider.ts";
import { resolveCommitMode, workBranchName } from "../_shared/commit-mode.ts";
import { BOARD_PATH, buildBoardModel, renderBoardMd } from "../_shared/board-generator.ts";
import { isPrimaryRow, getPrimaryBranch } from "../_shared/primary-branch.ts";
import { evaluateUnbaselinedPush, loadLatestSnapshot, computeStalePaths, runDriftSweep, SELF_PUSH_PREFIX } from "../_shared/git-drift.ts";
import { readRange, foreignPaths, planAttempt, baselineAfterPush, gitBlobSha, gitLabChanges, gitLabActions, gitLabBranchMoved, type PushPlan } from "../_shared/push-plan.ts";
import { fetchFullGitLabTree, gitlabProjectPath } from "../_shared/git-tree.ts";
import { refreshTaskPackets } from "../_shared/packet-freshness.ts";
import { BINDINGS_PATH } from "../_shared/binding-manifest.ts";
import { mayUseIntegration, INTEGRATION_NOT_FOUND } from "../_shared/git-access.ts";
import { advanceBaseline, ancestryFor } from "../_shared/baseline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PushRequest {
  projectId: string;
  branchName: string;
  integrationId: string;
  /** R2.2: explicit consent to overwrite a repo anchor this project never synced with. */
  confirmOverwrite?: boolean;
  /** R3-3a: 'create-branch' creates a REAL git ref for a NodeSpec branch (1:1 binding).
   *  R3-3b: 'open-pr' opens a pull request source→target with the entity diff as body;
   *  'merge-direct' performs a REAL provider merge (the explicit no-PR option). */
  action?: 'push' | 'create-branch' | 'open-pr' | 'merge-direct';
  /** create-branch: the git ref to branch FROM (defaults to the source NodeSpec branch's ref). */
  fromBranchName?: string;
  /** open-pr / merge-direct: the NodeSpec branch to merge INTO (defaults to main). */
  targetBranchName?: string;
  /**
   * R4: what this push is FOR — used as the commit subject (e.g. an accepted
   * proposal's title). The SELF_PUSH_PREFIX is prepended server-side and is never
   * the caller's to supply or omit.
   */
  reason?: string;
}

interface FileEntry {
  path: string;
  content: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { userId } = await extractOrchestratorAuth(req);
    console.log('[git-push] Authenticated userId:', userId);

    const { projectId, branchName, integrationId, confirmOverwrite, action, fromBranchName, targetBranchName, reason }: PushRequest = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: integration, error: integrationError } = await serviceClient
      .from("git_integrations")
      .select("id, project_id, provider, repo_owner, repo_name, default_branch, base_url, access_token_encrypted, commit_mode")
      .eq("id", integrationId)
      .maybeSingle();

    if (integrationError) throw integrationError;
    // AD.0 (S1): the integration must be the named project's, and every action
    // here writes to the repository or a baseline, so the caller needs a
    // contributor seat. A refusal reads as an unknown id.
    if (!integration || !(await mayUseIntegration(serviceClient, {
      integrationProjectId: integration.project_id, requestedProjectId: projectId, userId, access: "write",
    }))) {
      return new Response(
        JSON.stringify({ error: INTEGRATION_NOT_FOUND }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let token = integration.access_token_encrypted;
    if (isEncrypted(token)) {
      // P0-1: lazy re-encryption — persist a v2 envelope when the stored token was legacy.
      const { plaintext, upgraded } = await decryptWithUpgrade(token);
      token = plaintext;
      if (upgraded) {
        const { error: upgradeError } = await serviceClient
          .from("git_integrations")
          .update({ access_token_encrypted: upgraded })
          .eq("id", integration.id);
        if (upgradeError) console.warn(`[git-push] lazy v2 re-encryption failed: ${upgradeError.message}`);
      }
    }

    const { data: branch, error: branchError } = await serviceClient
      .from("branches")
      .select("id, name, git_ref, last_synced_commit, is_primary")
      .eq("project_id", projectId)
      .eq("name", branchName)
      .maybeSingle();

    if (branchError) throw branchError;
    if (!branch) throw new Error("Branch not found");

    // Debt audit 2026-07-29: pure function of the integration — computed ONCE
    // instead of once per lane (it was recomputed 4x in this handler).
    const apiBase = providerApiBase(integration.provider, integration.base_url);
    const pushAncestry = ancestryFor(integration.provider, apiBase, integration.repo_owner, integration.repo_name, token);

    // R3-3a: the ref this branch is bound to — a NodeSpec branch maps 1:1 to a git
    // ref. main falls back to the integration default (connect binds it anyway);
    // an UNBOUND non-main branch is handled in the push lane below (R3-6) — it
    // must NEVER inherit the default-ref fallback.
    let targetRef = branch.git_ref || integration.default_branch;

    if (action === 'create-branch') {
      // Create the REAL git ref for this (just-created) NodeSpec branch. Binds
      // git_ref + baseline on the branch row so the first push/sweep on it is
      // coherent from birth.
      //
      // BASE = the source branch's BASELINE (last_synced_commit), not a live head
      // read. Two reasons, one live-caught: (1) the baseline is the commit the
      // source branch's model snapshot corresponds to, so ref base == model base
      // by construction; (2) the provider can serve a STALE head for a few
      // seconds after rapid ref moves — the SB-4 bench caught a design ref based
      // on a pre-push main, which surfaced three checks later as an unexplainable
      // "PR has merge conflicts" (mergeable=false/dirty) on a clean PR. Live head
      // is the fallback only when the source branch has never synced.
      // AD.4 (D15): no source named means the primary branch, by its flag.
      const { data: fromBranch } = fromBranchName
        ? await serviceClient
          .from("branches")
          .select("git_ref, last_synced_commit")
          .eq("project_id", projectId)
          .eq("name", fromBranchName)
          .maybeSingle()
        : { data: await getPrimaryBranch(serviceClient, projectId, "git_ref, last_synced_commit, is_primary") };
      const sourceRef = fromBranch?.git_ref || integration.default_branch;
      const fromSha = fromBranch?.last_synced_commit
        || await fetchRemoteHeadSha(integration.provider, apiBase, integration.repo_owner, integration.repo_name, sourceRef, token);
      if (!fromSha) {
        return new Response(
          JSON.stringify({ error: `Could not resolve HEAD of ${sourceRef} to branch from` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const created = await createRemoteBranch(integration.provider, apiBase, integration.repo_owner, integration.repo_name, branchName, fromSha, token);
      if (!created.sha) {
        return new Response(
          JSON.stringify({ error: created.error ?? "Branch creation failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // AD.1: through the one writer; a new ref re-anchors its branch.
      await advanceBaseline(serviceClient, {
        branchId: branch.id, to: created.sha, ancestry: pushAncestry, reanchor: true, extra: { git_ref: branchName },
      });
      return new Response(
        JSON.stringify({ success: true, created: true, ref: branchName, sha: created.sha, alreadyExists: created.alreadyExists === true, fromRef: sourceRef }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === 'open-pr' || action === 'merge-direct') {
      // R3-3b: a design merge IS a git merge, and the DEFAULT vehicle is a pull
      // request. This lane runs AFTER the client pushed through the normal push
      // lane (guard + freshness gate already ran there) — it only creates the PR
      // or the real merge commit. Never a DB copy; deletes nothing.
      const sourceRef = branch.git_ref;
      if (!sourceRef) {
        return new Response(
          JSON.stringify({ error: `Design branch "${branchName}" has no bound git ref. Push from it once (or recreate it) to bind one, then merge.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const primaryForMerge = targetBranchName ? null : await getPrimaryBranch(serviceClient, projectId, "id, name");
      const targetName: string | undefined = targetBranchName ?? primaryForMerge?.name;
      if (!targetName) {
        return new Response(
          JSON.stringify({ error: "This project has no primary branch to merge into." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { data: targetBranch, error: targetError } = await serviceClient
        .from("branches")
        .select("id, git_ref, last_synced_commit")
        .eq("project_id", projectId)
        .eq("name", targetName)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!targetBranch) {
        return new Response(
          JSON.stringify({ error: `Target branch "${targetName}" not found` }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const mergeTargetRef = targetBranch.git_ref || integration.default_branch;
      if (sourceRef === mergeTargetRef) {
        return new Response(
          JSON.stringify({ error: `Source and target resolve to the same git ref ("${sourceRef}") — nothing to merge` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Entity diff for the PR body: what merging the source INTO the target does
      // to the target = diffAnchors(target, source). Missing/corrupt anchors are
      // stated honestly instead of silently omitted.
      const [sourceAnchorText, targetAnchorText] = await Promise.all([
        fetchRepoFile(integration.provider, apiBase, integration.repo_owner, integration.repo_name, MODEL_ANCHOR_PATH, sourceRef, token),
        fetchRepoFile(integration.provider, apiBase, integration.repo_owner, integration.repo_name, MODEL_ANCHOR_PATH, mergeTargetRef, token),
      ]);
      const sourceParsed = sourceAnchorText ? parseModel(sourceAnchorText) : null;
      const targetParsed = targetAnchorText ? parseModel(targetAnchorText) : null;
      let diffBody: string;
      if (sourceParsed?.ok && targetParsed?.ok) {
        diffBody = renderAnchorDiffMarkdown(diffAnchors(targetParsed.model, sourceParsed.model), branchName, targetName);
      } else if (sourceParsed?.ok && !targetAnchorText) {
        const m = sourceParsed.model;
        diffBody = `## NodeSpec design change\n\nMerging design branch \`${branchName}\` into \`${targetName}\`.\n\nThe target carries no NodeSpec model yet — this merge introduces the full design model (${m.nodes.length} node(s), ${m.edges.length} connection(s), ${m.contracts.length} contract(s)).`;
      } else {
        diffBody = `## NodeSpec design change\n\nMerging design branch \`${branchName}\` into \`${targetName}\`.\n\n_Entity diff unavailable: ${!sourceAnchorText ? "the source ref carries no model anchor" : !sourceParsed?.ok ? `source anchor invalid (${sourceParsed && !sourceParsed.ok ? sourceParsed.error : "unknown"})` : targetParsed && !targetParsed.ok ? `target anchor invalid (${targetParsed.error})` : "anchor fetch failed"}._`;
      }

      if (action === 'open-pr') {
        const title = `Merge design branch '${branchName}' into '${targetName}'`;
        const pr = await createPullRequest(
          integration.provider, apiBase, integration.repo_owner, integration.repo_name,
          sourceRef, mergeTargetRef, title, diffBody, token,
        );
        if (pr.nothingToMerge) {
          return new Response(
            JSON.stringify({ error: pr.error ?? "Nothing to merge — the target already contains this branch" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        if (!pr.url) {
          return new Response(
            JSON.stringify({ error: pr.error ?? "Pull request creation failed" }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ success: true, prUrl: pr.url, prNumber: pr.number, alreadyExists: pr.alreadyExists === true, sourceRef, targetRef: mergeTargetRef }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // merge-direct: compute targetInSync BEFORE the ref moves — was the target
      // branch's canvas identical to what its ref held? Only then may the client
      // auto-run the R3-1 loader afterwards (user-initiated merge + undiverged
      // target = no question to ask). Anything uncertain reads as diverged.
      let targetInSync = false;
      if (targetParsed?.ok) {
        try {
          const { graph: targetSnapGraph } = await loadLatestSnapshot(serviceClient, targetBranch.id);
          const targetGraph = targetSnapGraph || {};
          const ownParsed = parseModel(await serializeModel(targetGraph));
          // R7d: never the stored hashes (a pre-R7d target anchor still carries
          // a mappings section its stored hash covers). AD.2: the whole design
          // when both anchors carry it, architecture when either is version 1.
          targetInSync = ownParsed.ok && await sameDesign(ownParsed.model, targetParsed.model as ModelAnchor);
        } catch (syncErr) {
          console.warn("[git-push] merge-direct targetInSync computation failed (treating as diverged):", syncErr);
        }
      }

      const merged = await mergeRemoteBranch(
        integration.provider, apiBase, integration.repo_owner, integration.repo_name,
        sourceRef, mergeTargetRef, `Merge NodeSpec design branch '${branchName}' into '${targetName}'`, token,
      );
      if (merged.conflict) {
        return new Response(
          JSON.stringify({ conflict: true, error: merged.error ?? "Merge conflict — resolve in git", ...(merged.prUrl ? { prUrl: merged.prUrl } : {}) }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!merged.sha && !merged.alreadyMerged) {
        return new Response(
          JSON.stringify({ error: merged.error ?? "Merge failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          success: true, merged: true, mergeSha: merged.sha,
          alreadyMerged: merged.alreadyMerged === true, targetInSync,
          targetRef: mergeTargetRef, ...(merged.prUrl ? { prUrl: merged.prUrl } : {}),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // R3-6 (owner bench 2026-07-31: a new branch in a second project "wants to
    // push to main"): the fallback above aimed an unbound NON-MAIN branch at the
    // repository DEFAULT ref — a feature canvas overwriting main, with main's
    // stale-path cleanup then deleting whatever that canvas doesn't claim. Two UI
    // texts already promise that pushing from an unbound branch binds its ref
    // ("Re-try by pushing from that branch"); make the promise true: create the
    // ref from the default branch HEAD (the same base the create-branch lane
    // defaults to), bind + baseline it, and push THERE. If the ref cannot be
    // created, REFUSE — never fall back to the default ref.
    if (!branch.git_ref && !isPrimaryRow({ ...branch, name: branchName })) {
      // Same base rule as the create-branch lane above: prefer the default
      // branch's BASELINE over a live head read (stale-head-after-rapid-moves,
      // live-caught by the bench); live head only when it has never synced.
      const { data: defaultRow } = await serviceClient
        .from("branches")
        .select("last_synced_commit")
        .eq("project_id", projectId)
        .eq("git_ref", integration.default_branch)
        .maybeSingle();
      const fromSha = defaultRow?.last_synced_commit || await fetchRemoteHeadSha(
        integration.provider, apiBase, integration.repo_owner, integration.repo_name,
        integration.default_branch, token,
      );
      if (!fromSha) {
        return new Response(
          JSON.stringify({ error: `Design branch "${branchName}" has no git branch yet, and the ref could not be created (HEAD of ${integration.default_branch} unresolvable). Refusing to push to the repository default instead.` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const created = await createRemoteBranch(
        integration.provider, apiBase, integration.repo_owner, integration.repo_name,
        branchName, fromSha, token,
      );
      if (!created.sha) {
        return new Response(
          JSON.stringify({ error: `Design branch "${branchName}" has no git branch yet, and creating one failed: ${created.error ?? "provider error"}. Refusing to push to the repository default instead.` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // AD.1: through the one writer; a new ref re-anchors its branch.
      await advanceBaseline(serviceClient, {
        branchId: branch.id, to: created.sha, ancestry: pushAncestry, reanchor: true, extra: { git_ref: branchName },
      });
      // Keep the in-memory row coherent for the guard + baseline logic below —
      // the ref we just created at `created.sha` IS this branch's sync state.
      branch.git_ref = branchName;
      branch.last_synced_commit = created.sha;
      targetRef = branchName;
    }

    // R2.2 PUSH OVERWRITE GUARD (owner disaster-recovery discovery): an UNBASELINED
    // push overwrites whatever the repo holds, sight unseen — after a DB loss the
    // repo anchor may be the ONLY surviving copy of the graph, and the first push
    // from a fresh project used to silently destroy it. If this branch has never
    // synced AND the repo already carries a model anchor, stop and require explicit
    // confirmation. Baselined pushes are untouched (the drift sweep owns that lane).
    if (!branch.last_synced_commit && !confirmOverwrite) {
      // Provider unreachable → cannot prove the repo is safe to overwrite; fail
      // CLOSED (the whole point is protecting the last surviving copy). AD.1
      // (D11): this read used to return null on any error, so an outage read
      // as "no model here" and the guard passed.
      const guardRead = await readRepoFile(
        integration.provider, apiBase, integration.repo_owner, integration.repo_name,
        MODEL_ANCHOR_PATH, targetRef, token,
      );
      if (guardRead.status === "failed") {
        return new Response(
          JSON.stringify({ error: `Could not verify the repository's existing model before an unbaselined push: ${guardRead.error}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const repoAnchorText = guardRead.status === "found" ? guardRead.text : null;
      const verdict = evaluateUnbaselinedPush(branch.last_synced_commit, repoAnchorText);
      if (verdict.blocked) {
        return new Response(
          JSON.stringify({
            requiresOverwriteConfirmation: true,
            reason: verdict.reason,
            ...(verdict.summary ? { repoAnchor: verdict.summary } : {}),
            error: "Push blocked: this project has never synced with this repository, which already carries a NodeSpec model. Confirm to overwrite it, or restore it into a project first.",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { graph: snapGraph, error: snapshotError } = await loadLatestSnapshot(serviceClient, branch.id);
    if (snapshotError) throw snapshotError;
    const graph = snapGraph || {};

    // P1-7 C1: packet freshness gate — never ship a stale task doc. Recomputes fingerprints
    // for generator-managed task artifacts and regenerates stale ones IN MEMORY before file
    // extraction and anchor serialization, so file, anchor, and ARCHITECTURE.md agree within
    // this commit. Never throws; a refresh failure just pushes what the snapshot holds.
    const packetRefresh = await refreshTaskPackets(serviceClient, projectId, graph, branch.id);
    if (packetRefresh.error) {
      console.warn(`[git-push] packet freshness gate failed (pushing snapshot content as-is): ${packetRefresh.error}`);
    }

    const { files, diagnostics } = extractArtifactFiles(graph);

    const architectureMd = generateArchitectureDocument(graph);
    if (architectureMd) {
      files.push({ path: "ARCHITECTURE.md", content: architectureMd });
    }


    if (files.length === 0) {
      let errorMessage = "No artifact files to push.";

      if (diagnostics.total === 0) {
        errorMessage = "No artifacts found in the project. Add artifacts to your nodes first.";
      } else {
        const reasons = [];
        if (diagnostics.filtered.noContent > 0) {
          reasons.push(`${diagnostics.filtered.noContent} artifact(s) have no content`);
        }
        if (diagnostics.filtered.noPath > 0) {
          reasons.push(`${diagnostics.filtered.noPath} artifact(s) have no file path`);
        }
        if (diagnostics.filtered.suggested > 0) {
          reasons.push(`${diagnostics.filtered.suggested} artifact(s) are in 'suggested' status`);
        }

        if (reasons.length > 0) {
          errorMessage = `Found ${diagnostics.total} artifact(s), but none are ready to push: ${reasons.join(", ")}. Make sure your artifacts have content and are not in 'suggested' status.`;
        }
      }

      return new Response(
        JSON.stringify({ error: errorMessage, diagnostics }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // P1-7 R1: write the model anchor. Deterministic, content-addressed serialization of the
    // design model — the artifact that makes git the durable design store (adopt-on-connect,
    // branch mirrors, provenance-safe re-import all read it back).
    // R7d (owner: "you're incorporating the requirements/spec into model.json —
    // rectify"): ARCHITECTURE ONLY. Requirement mappings no longer ride here —
    // one fact, one file: the spec plane (requirements, criteria, mappings) is
    // `.nodespec/spec.json`'s, written just below.
    // AD.2 (I12): the anchor carries configuration and schema bodies now, with
    // every value that looks like a credential withheld; the push names each.
    const anchorWrite = await serializeModelWithReport(graph);
    files.push({ path: MODEL_ANCHOR_PATH, content: anchorWrite.text });

    // R7a (owner 2026-07-31: "requirements/acceptance criteria and spec are not
    // imported at all"): they were never EXPORTED either — model.json carries
    // requirement EDGES but no requirement content and no spec document. The spec
    // plane gets its OWN anchor so evidence state never churns `modelHash` (a
    // criterion flipped by a passing test must not raise an architecture drift
    // card), and so model.json stays byte-identical for every connected project.
    // Written only when the project HAS a spec: an empty spec.json would read, on
    // the next connect, as "this project has a spec and it is blank".
    let specAnchored = false;
    let specPlane: Awaited<ReturnType<typeof loadSpecPlane>> = null;
    try {
      specPlane = await loadSpecPlane(serviceClient, projectId, { constraintsCarried: await constraintsCarried(serviceClient, projectId) });
      if (specPlane) {
        files.push({
          path: SPEC_ANCHOR_PATH,
          content: await serializeSpec(specPlane.spec, specPlane.requirements, specPlane.mappings),
        });
        specAnchored = true;
      }
    } catch (specErr) {
      // Never fail a push over the spec plane — the architecture anchor is the
      // load-bearing artifact and must still land.
      console.warn("[git-push] spec plane load failed (pushing without spec.json):", specErr);
    }

    // D2 (docs/WORK_LOOP_PLAN.md): `.nodespec/BOARD.md` — the work board's
    // git projection, regenerated on every push from the SAME derivation the
    // canvas board renders (deriveWorkStatus, cross-runtime). Byte-idempotent
    // rendering means an unchanged board produces an identical blob — no diff
    // noise. Best-effort: a board failure never fails a push.
    try {
      if (specPlane && specPlane.requirements.length > 0) {
        const boardModel = await buildBoardModel(serviceClient, projectId, {
          graph: graph as Parameters<typeof buildBoardModel>[2]["graph"],
          requirements: specPlane.requirements as Parameters<typeof buildBoardModel>[2]["requirements"],
          mappings: specPlane.mappings,
        });
        files.push({ path: BOARD_PATH, content: renderBoardMd(boardModel) });
      }
    } catch (boardErr) {
      console.warn("[git-push] BOARD.md generation skipped (push continues):", boardErr);
    }

    // B3 (docs/WORK_LOOP_PLAN.md): clear CONSUMED declarations from
    // `.nodespec/bindings.json`: bind-then-clear, keyed off the graph being
    // pushed. An entry leaves the file ONLY when its path is bound now, so a
    // failed or not-yet-applied bind can never lose a declaration. The
    // manifest is read and rewritten per attempt, at the head that attempt
    // builds on (`planAttempt`), never at an earlier read of the ref.
    const boundPaths = new Set(
      Object.values((graph.artifacts ?? {}) as Record<string, { path?: string }>)
        .map((a) => (typeof a?.path === "string" ? a.path.replace(/^\//, "") : ""))
        .filter((p) => p.length > 0),
    );

    // Owner bench 2026-07-29 (rename bug): the push lane only ever ADDED tree
    // entries, so renaming an artifact in the inspector left the OLD file behind
    // in the repo forever (model.json moved on; git didn't). Compare the repo's
    // CURRENT anchor (what NodeSpec previously claimed at this ref) with the new
    // model: any path the old anchor claims whose artifact was renamed or removed
    // gets a delete entry in the same commit. Only anchor-claimed paths are ever
    // deleted — user files NodeSpec never owned are untouchable by construction.
    // Baselined pushes only: an unbaselined first push has no prior claim to clean.
    // Owner bench 2026-07-30 ("delete in canvas → push → file survives in git"):
    // this lane used to fail SILENTLY when the repo's current anchor was missing,
    // unfetchable, or unparseable (e.g. a hand-merged model.json) — and the loss
    // is PERMANENT, because this very push writes a fresh anchor that no longer
    // claims the deleted path, so no future push can clean it either. The skip
    // reason now rides the response + sync log so the client can say it out loud.
    let stalePaths: string[] = [];
    let cleanupSkipped: string | null = null;
    if (branch.last_synced_commit) {
      try {
        // AD.1 (D5, D11): a deletion is named only by an anchor NodeSpec wrote,
        // which its hash proves; a hand-edited or unreadable model.json names none.
        const oldRead = await readRepoFile(
          integration.provider, apiBase, integration.repo_owner, integration.repo_name,
          MODEL_ANCHOR_PATH, targetRef, token,
        );
        const oldParsed = oldRead.status === "found" ? parseModel(oldRead.text) : null;
        if (oldRead.status === "failed") {
          cleanupSkipped = `could not read ${MODEL_ANCHOR_PATH} on ${targetRef} (${oldRead.error}), so nothing was deleted`;
        } else if (oldRead.status === "absent") {
          cleanupSkipped = `no ${MODEL_ANCHOR_PATH} found on ${targetRef}`;
        } else if (!oldParsed?.ok) {
          cleanupSkipped = `repo model anchor on ${targetRef} is unreadable (${oldParsed && !oldParsed.ok ? oldParsed.error : "parse failed"}) — likely hand-edited/hand-merged; this push rewrites a valid anchor`;
        } else if (!(await verifyModelHash(oldParsed.model))) {
          cleanupSkipped = `repo model anchor on ${targetRef} fails its hash (hand-edited), so it names no deletion; this push rewrites a valid anchor`;
        } else {
          stalePaths = computeStalePaths(oldParsed.model.artifacts, graph.artifacts ?? {}, files.map((f) => f.path));
        }
      } catch (staleErr) {
        cleanupSkipped = `anchor fetch failed: ${staleErr instanceof Error ? staleErr.message : String(staleErr)}`;
        console.warn("[git-push] stale-path computation failed (pushing without deletions):", staleErr);
      }
    }

    const { data: patches } = await serviceClient
      .from("graph_patches")
      .select("id")
      .eq("branch_id", branch.id);

    // The prefix IS the self-push signature (webhook guard, sweep fast-forward,
    // merge-arrival) — emit it from the ONE shared constant so emit and match
    // can never drift apart.
    // R4: an auto-push on proposal accept names WHAT it committed (the proposal
    // title) instead of a file count. The SELF_PUSH_PREFIX is NOT optional and is
    // prepended here, never supplied by the caller: every self-push matcher — the
    // webhook skip, the sweep's fast-forward, the merge-arrival detector — keys on
    // it, so a custom message that lost the prefix would make NodeSpec read its own
    // commit as out-of-band drift and raise a card against itself.
    const reasonText = typeof reason === "string" ? reason.trim().replace(/\s+/g, " ").slice(0, 120) : "";
    // AD.1: the prefix stays as a label for people; NodeSpec knows its own
    // commits by the sha and blobs recorded below, never by this message.
    const commitMessageFor = (fileCount: number) => reasonText
      ? `${SELF_PUSH_PREFIX} ${reasonText}`
      : `${SELF_PUSH_PREFIX} ${fileCount} files from ${branchName}`;
    const json = (body: unknown, status = 200) => new Response(
      JSON.stringify(body),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

    // AD.1 (D1, D2): the push preflight. Read the head, read what changed in
    // git since the baseline, and never write over it: every file git changed
    // other than by NodeSpec is skipped, reference files included, and
    // reported, and that change is on a card before anything is written. The
    // commit is built on exactly the head that was read; if the branch moves
    // meanwhile, the preflight runs once more.
    // UX-1.1b: commit mode, 'direct' (default) or 'pull-request'. AD.4 (D14,
    // ruling 6): one work branch per tracked ref and one open pull request on
    // it; while it is open each push adds a commit to it, and with none open
    // the work branch starts again at the tracked branch's head.
    const commitMode = resolveCommitMode(integration);
    const baselineAtStart: string | null = branch.last_synced_commit ?? null;
    let pushResult: GitPushResult | null = null;
    let plan: PushPlan = { write: files, skipped: [], deletions: stalePaths };
    let pushRef = targetRef;
    let prWorkBranch: string | null = null;
    let openPr: PullRequestRef | null = null;
    let blobs: Record<string, string> = {};
    let logRowId: string | null = null;
    for (let attempt = 0; attempt < 2 && !pushResult; attempt++) {
      const headRead = await fetchRemoteHeadShaDetailed(
        integration.provider, apiBase, integration.repo_owner, integration.repo_name, targetRef, token,
      );
      // No branch yet (404) or an empty repository (GitHub's 409) has no head
      // to build on; any other failure is not "no head" and stops the push.
      if (!headRead.sha && headRead.status !== 404 && headRead.status !== 409) {
        return json({ error: `Could not read the head of ${targetRef} before pushing (${headRead.status ? `HTTP ${headRead.status}` : "network error"}); nothing was written. Try again.` }, 502);
      }
      const head = headRead.sha;
      let foreign = new Set<string>();
      if (baselineAtStart && head && head !== baselineAtStart) {
        const range = await readRange(serviceClient, {
          provider: integration.provider, apiBase, owner: integration.repo_owner, repo: integration.repo_name, token,
          integrationId: integration.id, branchId: branch.id, base: baselineAtStart, head, ref: targetRef,
        });
        if (!range.ok) {
          return json({
            error: `Could not tell what changed on ${targetRef} since the last sync (the provider could not compare the two; the history may have been rewritten). Nothing was written. Load the repository's model to sync from its head, then push.`,
            code: "range-unknown",
          }, 409);
        }
        foreign = foreignPaths(range.foreign);
        if (range.foreign.length > 0 && attempt === 0) {
          // The change is on its card before anything is written.
          await runDriftSweep(serviceClient, projectId, { branchName, force: true });
        }
      }
      plan = await planAttempt({
        files, stalePaths, foreign, head, ref: targetRef, boundPaths,
        readManifest: (at) => fetchRepoFile(
          integration.provider, apiBase, integration.repo_owner, integration.repo_name, BINDINGS_PATH, at, token,
        ),
      });
      if (plan.write.length === 0 && plan.deletions.length === 0) {
        return json({
          error: "Every file this push would write changed in git since the last sync. Review the pending change, then push again.",
          code: "all-skipped",
          skipped: plan.skipped,
        }, 409);
      }
      blobs = Object.fromEntries(await Promise.all(plan.write.map(async (f) => [f.path, await gitBlobSha(f.content)] as const)));

      pushRef = targetRef;
      prWorkBranch = null;
      openPr = null;
      // The commit is built on this: the tracked branch's head, or the work
      // branch's head while its pull request is open.
      let buildOn: string | null = head;
      if (commitMode === "pull-request") {
        if (!head) throw new Error(`Cannot open a PR: target ref '${targetRef}' has no head (push directly once first)`);
        prWorkBranch = workBranchName(targetRef);
        const open = await listPullRequests(
          integration.provider, apiBase, integration.repo_owner, integration.repo_name, prWorkBranch, targetRef, token, "open",
        );
        if (!open) {
          return json({ error: `Could not read the open pull requests from ${prWorkBranch}; nothing was written. Try again.` }, 502);
        }
        const workHead = await fetchRemoteHeadShaDetailed(
          integration.provider, apiBase, integration.repo_owner, integration.repo_name, prWorkBranch, token,
        );
        if (!workHead.sha && workHead.status !== 404) {
          return json({ error: `Could not read the head of ${prWorkBranch} (${workHead.status ? `HTTP ${workHead.status}` : "network error"}); nothing was written. Try again.` }, 502);
        }
        if (open.length > 0 && workHead.sha) {
          openPr = open[0];
          buildOn = workHead.sha;
        } else {
          // No pull request is open: whatever the work branch held was merged
          // or turned down, so it starts again at the tracked branch's head.
          const reset = await resetRemoteBranch(
            integration.provider, apiBase, integration.repo_owner, integration.repo_name, prWorkBranch, head, token,
          );
          if (!reset.ok) throw new Error(`Could not start the pull request branch '${prWorkBranch}': ${reset.error}`);
        }
        pushRef = prWorkBranch;
      }

      // Recorded before the ref moves (GitHub), so a sync check or webhook
      // that sees the commit already knows it is NodeSpec's.
      const record = async (sha: string, parent: string | null, deletedPaths: string[]) => {
        const { data: row } = await serviceClient.from("git_sync_log").insert({
          integration_id: integrationId,
          project_id: projectId,
          branch_id: branch.id,
          direction: "push",
          commit_sha: sha,
          status: "pending",
          metadata: {
            nodespecPush: true, parent, blobs, deleted: deletedPaths,
            // AD.4 (D14): a pull request push names its work branch and, once
            // known, its pull request: a merge of that pull request brings it.
            ...(prWorkBranch ? { workBranch: prWorkBranch, ...(openPr ? { prNumber: openPr.number } : {}) } : {}),
          },
        }).select("id").maybeSingle();
        logRowId = row?.id ?? null;
      };

      if (integration.provider === "github") {
        const attemptResult = await pushToGitHub(
          apiBase, integration.repo_owner, integration.repo_name, pushRef, token,
          commitMessageFor(plan.write.length), plan.write, plan.deletions, buildOn, record,
        );
        if (attemptResult.moved) {
          if (logRowId) {
            await serviceClient.from("git_sync_log")
              .update({ status: "failed", error_message: "the branch moved while pushing", completed_at: new Date().toISOString() })
              .eq("id", logRowId);
          }
          logRowId = null;
          continue;
        }
        pushResult = attemptResult;
      } else if (integration.provider === "gitlab") {
        const attemptResult = await pushToGitLab(
          apiBase, integration.repo_owner, integration.repo_name, pushRef, token,
          commitMessageFor(plan.write.length), plan.write, plan.deletions, buildOn, blobs,
        );
        // AD.4 (D17): GitLab refused the commit because a file changed since
        // the preflight read the branch; nothing landed, so it runs again.
        if (attemptResult.moved) continue;
        pushResult = attemptResult;
        // GitLab names the commit only after it lands; the sync check matches
        // its files by blob until this row exists.
        if (!pushResult.unchanged) await record(pushResult.sha, pushResult.parent, pushResult.deletedPaths);
      } else {
        throw new Error(`Unsupported provider: ${integration.provider}`);
      }
    }
    if (!pushResult) {
      return json({ error: `${targetRef} moved twice while pushing, so nothing was written. Push again.`, code: "moved" }, 409);
    }
    const commitSha = pushResult.sha;
    const unchanged = pushResult.unchanged === true;

    // PR mode: open the pull request now that the work branch carries the
    // commit. A PR failure here is a real failure — the user chose PR mode,
    // so silently leaving an orphan work branch would be worse than erroring.
    // An UNCHANGED push opens no PR: there is nothing to review.
    let prInfo: { url: string; number?: number; reused?: boolean } | null = null;
    if (commitMode === "pull-request" && prWorkBranch && openPr) {
      // AD.4 (D14): the push added a commit to the pull request already open.
      prInfo = { url: openPr.url ?? "", number: openPr.number, reused: true };
    } else if (commitMode === "pull-request" && prWorkBranch && !unchanged) {
      const prTitle = `NodeSpec design push: ${reasonText || `${plan.write.length} file(s) from ${branchName}`}`;
      const prBody = `NodeSpec pushed ${plan.write.length} file(s) from design branch \`${branchName}\` in pull-request commit mode.\n\nMerging applies the design state to \`${targetRef}\`; NodeSpec reconciles automatically on merge.`;
      const pr = await createPullRequest(
        integration.provider, apiBase, integration.repo_owner, integration.repo_name,
        prWorkBranch, targetRef, prTitle, prBody, token,
      );
      if (!pr.url) {
        throw new Error(`Commit landed on '${prWorkBranch}' but opening the PR failed: ${pr.error ?? "unknown error"} — open it manually or push again`);
      }
      prInfo = { url: pr.url, number: pr.number };
    }

    await serviceClient.from("git_integrations").update({
      last_sync_at: new Date().toISOString(),
      sync_status: "idle",
    }).eq("id", integrationId);

    const withheld: WithheldValue[] = plan.write.some((f) => f.path === MODEL_ANCHOR_PATH) ? anchorWrite.withheld : [];
    const logMetadata = {
      fileCount: plan.write.length,
      ...(unchanged ? { unchanged: true } : { nodespecPush: true, parent: pushResult.parent, blobs, deleted: pushResult.deletedPaths }),
      // rename/removal cleanup observability: what the anchor comparison
      // wanted deleted, what the provider commit actually deleted, and why
      // the lane was skipped when it was.
      stalePaths,
      deletedPaths: pushResult.deletedPaths,
      ...(cleanupSkipped ? { cleanupSkipped } : {}),
      // AD.1: what the push left alone because git changed it since the last sync.
      ...(plan.skipped.length ? { skipped: plan.skipped } : {}),
      // AD.2: the values kept out of git because they looked like credentials.
      ...(withheld.length ? { withheld } : {}),
      // R7a: did the spec plane travel with this commit? A project with no spec
      // row writes no spec.json, and that must be distinguishable from a failure.
      specAnchored,
      ...(prInfo ? { commitMode: "pull-request", prUrl: prInfo.url, workBranch: prWorkBranch, ...(typeof prInfo.number === "number" ? { prNumber: prInfo.number } : {}) } : {}),
    };
    if (logRowId) {
      await serviceClient.from("git_sync_log").update({
        status: "success",
        patches_synced: patches?.length || 0,
        completed_at: new Date().toISOString(),
        metadata: logMetadata,
      }).eq("id", logRowId);
    } else {
      // An unchanged push made no commit: its row names the existing head and
      // never claims it as NodeSpec's.
      await serviceClient.from("git_sync_log").insert({
        integration_id: integrationId,
        project_id: projectId,
        branch_id: branch.id,
        direction: "push",
        commit_sha: commitSha,
        status: "success",
        patches_synced: patches?.length || 0,
        completed_at: new Date().toISOString(),
        metadata: logMetadata,
      });
    }

    // AD.1 (D2): the baseline moves to this commit only when it was built on
    // the baseline itself. Otherwise commits NodeSpec did not write lie
    // between, and they stay on their card until a person resolves it.
    // UX-1.1b: in pull-request mode the TARGET has not moved — the commit sits
    // on the work branch behind a PR — so the baseline must NOT advance; the
    // sync check moves it when the merge arrives.
    let baselineOutcome: { moved: boolean; reason: string } = { moved: false, reason: "pull-request" };
    if (commitMode !== "pull-request") {
      if (branch.git_ref !== targetRef) {
        await serviceClient.from("branches").update({ git_ref: targetRef }).eq("id", branch.id);
      }
      const after = baselineAfterPush({ baseline: baselineAtStart, parent: pushResult.parent, newSha: commitSha, unchanged });
      baselineOutcome = { moved: false, reason: after.reason };
      if (after.move) {
        const moved = await advanceBaseline(serviceClient, { branchId: branch.id, to: commitSha, ancestry: pushAncestry });
        baselineOutcome = { moved: moved.moved, reason: moved.moved ? after.reason : moved.outcome };
        if (!moved.moved && moved.outcome !== "same") {
          console.warn(`[git-push] sync baseline not advanced (${moved.outcome})`);
        }
      }
    }

    return json({
      success: true, commitSha, fileCount: plan.write.length,
      // Dogfood find #4: an unchanged tree mints NO commit; commitSha is
      // the existing head, and the caller can finally trust that a new sha
      // means something actually changed.
      ...(unchanged ? { unchanged: true, message: "Tree identical to the current head: no commit created." } : {}),
      // AD.1: the files left alone because git changed them since the last sync.
      ...(plan.skipped.length ? { skipped: plan.skipped } : {}),
      // AD.2: the values kept out of git because they looked like credentials.
      ...(withheld.length ? { withheld } : {}),
      baseline: baselineOutcome,
      specAnchored,
      ...(prInfo ? { commitMode: "pull-request", prUrl: prInfo.url, prNumber: prInfo.number, workBranch: prWorkBranch, ...(prInfo.reused ? { prReused: true } : {}) } : {}),
      deletedPaths: pushResult.deletedPaths,
      ...(cleanupSkipped ? { cleanupSkipped } : {}),
      packetsRefreshed: packetRefresh.refreshed,
      ...(packetRefresh.refreshedPaths.length ? { refreshedPackets: packetRefresh.refreshedPaths } : {}),
      // C4 step 2: the freshness gate covers test plans too, in the same observability shape.
      testPlansRefreshed: packetRefresh.testPlansRefreshed,
      ...(packetRefresh.testPlansRefreshedPaths.length ? { refreshedTestPlans: packetRefresh.testPlansRefreshedPaths } : {}),
    });
  } catch (error: any) {
    console.error("Git push error:", error);
    const message = error.message || "Failed to push to git";
    const status = message.includes("Authentication") || message.includes("authorization") ? 401 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

interface ArtifactFilterResult {
  files: FileEntry[];
  diagnostics: {
    total: number;
    filtered: {
      noPath: number;
      noContent: number;
      suggested: number;
    };
    included: number;
  };
}

function extractArtifactFiles(graph: any): ArtifactFilterResult {
  const files: FileEntry[] = [];
  const artifacts = graph.artifacts || {};
  const diagnostics = {
    total: 0,
    filtered: {
      noPath: 0,
      noContent: 0,
      suggested: 0,
    },
    included: 0,
  };

  for (const artifact of Object.values(artifacts) as any[]) {
    diagnostics.total++;

    if (!artifact.path) {
      diagnostics.filtered.noPath++;
      continue;
    }

    if (!artifact.content || artifact.content.trim() === '') {
      diagnostics.filtered.noContent++;
      continue;
    }

    if (artifact.status === "suggested") {
      diagnostics.filtered.suggested++;
      continue;
    }

    let filePath = artifact.path;
    if (filePath.startsWith("/")) filePath = filePath.slice(1);

    files.push({ path: filePath, content: artifact.content });
    diagnostics.included++;
  }

  return { files, diagnostics };
}


/** AD.1: what a push attempt did. `moved`: the branch was no longer at the
 *  head the preflight read, so nothing landed and the preflight runs again. */
interface GitPushResult {
  sha: string;
  /** The commit this one was built on (the head the preflight read). */
  parent: string | null;
  deletedPaths: string[];
  unchanged?: boolean;
  moved?: boolean;
}

async function pushToGitHub(
  apiBase: string,
  owner: string, repo: string, branch: string, token: string,
  message: string, files: FileEntry[],
  stalePaths: string[],
  /** AD.1: build on exactly this head (null: the branch has no head yet). */
  parent: string | null,
  /** AD.1: record the commit as NodeSpec's before the ref moves. */
  onCommitCreated: (sha: string, parent: string | null, deletedPaths: string[]) => Promise<void>,
): Promise<GitPushResult> {
  const baseUrl = apiBase;

  console.log('[pushToGitHub] Pushing to:', `${owner}/${repo}`);

  // Debt-audit fix (2026-07-29): `token ` is the legacy GitHub auth scheme — it
  // works for classic PATs but FAILS for fine-grained PATs and GitHub Apps.
  // Every other call site in the codebase uses Bearer; this was the last holdout.
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  console.log('[pushToGitHub] Checking repository access...');
  const repoCheckResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}`, { headers });
  console.log('[pushToGitHub] Repository check status:', repoCheckResponse.status);

  if (!repoCheckResponse.ok) {
    const body = await repoCheckResponse.text();
    console.error('[pushToGitHub] Repository check failed:', body);
    throw new Error(`Repository not found or not accessible (${repoCheckResponse.status}): ${body}. Please ensure the repository exists and the token has write access.`);
  }

  // AD.1: build on the head the preflight read and checked, never on
  // whatever the ref reads now; a branch that moved meanwhile is reported as
  // moved and the preflight runs again.
  const latestCommitSha: string | null = parent;
  let baseTreeSha: string | null = null;
  if (latestCommitSha) {
    const commitResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers });
    if (!commitResponse.ok) throw new Error(`Failed to get commit: ${commitResponse.statusText}`);
    const commitData = await commitResponse.json();
    baseTreeSha = commitData.tree.sha;
  }

  // For empty repos (no base tree), create blobs first
  let treeEntries;
  if (!baseTreeSha) {
    console.log('[pushToGitHub] Empty repo detected, creating blobs first...');
    treeEntries = await Promise.all(files.map(async (f) => {
      const blobResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ content: f.content, encoding: "utf-8" }),
      });
      if (!blobResponse.ok) {
        const body = await blobResponse.text();
        throw new Error(`Failed to create blob for ${f.path}: ${body}`);
      }
      const blobData = await blobResponse.json();
      return {
        path: f.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blobData.sha,
      };
    }));
  } else {
    // For existing repos, use inline content with base tree
    treeEntries = files.map((f) => ({
      path: f.path,
      mode: "100644" as const,
      type: "blob" as const,
      content: f.content,
    }));
  }

  // Rename/removal cleanup: a tree entry with sha:null DELETES the path. Only
  // paths that actually exist in the base tree get one — the trees API 422s on
  // deleting a nonexistent path (e.g. the file was already removed out-of-band).
  const deletedPaths: string[] = [];
  if (stalePaths.length > 0 && baseTreeSha) {
    try {
      const baseTreeResp = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`, { headers });
      if (baseTreeResp.ok) {
        const baseTreeData = await baseTreeResp.json();
        const existing = new Set(
          ((baseTreeData.tree ?? []) as Array<{ path: string; type: string }>)
            .filter((t) => t.type === "blob")
            .map((t) => t.path),
        );
        for (const p of stalePaths) {
          if (existing.has(p)) {
            treeEntries.push({ path: p, mode: "100644" as const, type: "blob" as const, sha: null } as any);
            deletedPaths.push(p);
          }
        }
      } else {
        console.warn(`[pushToGitHub] base tree fetch for deletions failed (${baseTreeResp.status}) — pushing without deletions`);
      }
    } catch (delErr) {
      console.warn('[pushToGitHub] stale-path deletion setup failed (pushing without deletions):', delErr);
    }
  }

  const treePayload: any = { tree: treeEntries };
  if (baseTreeSha) {
    treePayload.base_tree = baseTreeSha;
  }

  const treeResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(treePayload),
  });
  if (!treeResponse.ok) {
    const body = await treeResponse.text();
    throw new Error(`Failed to create tree (${treeResponse.status}): ${body}`);
  }
  const treeData = await treeResponse.json();

  // Dogfood find 2026-09-02 (#4): git trees are content-addressed, so a push
  // whose files are byte-identical to the head produces the SAME tree sha.
  // Minting a commit anyway made "I pushed" meaningless as evidence of
  // change — the ref moved while nothing did. Report the existing head as
  // unchanged instead; evidence-over-claims applies to the server too.
  if (latestCommitSha && baseTreeSha && treeData.sha === baseTreeSha) {
    return { sha: latestCommitSha, parent: latestCommitSha, deletedPaths: [], unchanged: true };
  }

  const commitPayload: any = { message, tree: treeData.sha };
  if (latestCommitSha) {
    commitPayload.parents = [latestCommitSha];
  }

  const newCommitResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(commitPayload),
  });
  if (!newCommitResponse.ok) throw new Error(`Failed to create commit: ${newCommitResponse.statusText}`);
  const newCommitData = await newCommitResponse.json();
  await onCommitCreated(newCommitData.sha, latestCommitSha, deletedPaths);

  if (latestCommitSha) {
    const updateRefResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommitData.sha }),
    });
    if (!updateRefResponse.ok) {
      // 422 non-fast-forward: the branch is no longer at the head we built on
      // (someone pushed, or the provider served a lagging ref). AD.1: the
      // caller re-runs the preflight on the new head, so nothing written on a
      // stale read can overwrite a change git made since.
      if (updateRefResponse.status === 422) {
        console.warn('[pushToGitHub] ref update 422: the branch moved; the preflight runs again');
        return { sha: newCommitData.sha, parent: latestCommitSha, deletedPaths, moved: true };
      }
      throw new Error(`Failed to update ref: ${updateRefResponse.statusText}`);
    }
  } else {
    const createRefResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommitData.sha }),
    });
    if (!createRefResponse.ok) {
      const body = await createRefResponse.text();
      throw new Error(`Failed to create ref (${createRefResponse.status}): ${body}`);
    }
  }

  return { sha: newCommitData.sha, parent: latestCommitSha, deletedPaths };
}

async function pushToGitLab(
  apiBase: string,
  owner: string, repo: string, branch: string, token: string,
  message: string, files: FileEntry[],
  stalePaths: string[],
  /** AD.4 (D17): the head the preflight read (null: the branch has none yet). */
  parent: string | null,
  /** path to the blob this push writes there */
  blobs: Record<string, string>,
): Promise<GitPushResult> {
  const project = gitlabProjectPath(owner, repo);
  const glHeaders = { "PRIVATE-TOKEN": token, "Content-Type": "application/json" };

  // AD.4 (D17): the files the branch held at the head the preflight read,
  // every page of them. The listing used to stop at its first hundred entries,
  // so a file past them was "created" and GitLab refused the whole commit; a
  // failed read was taken for an empty branch. It throws now.
  const existing = new Map<string, string>();
  if (parent) {
    const listed = await fetchFullGitLabTree(apiBase, owner, repo, parent, token);
    if (listed.truncated) throw new Error(`NodeSpec could not list every file of ${owner}/${repo} (${listed.collectedCount} read); nothing was written. Try the push again.`);
    // deno-lint-ignore no-explicit-any
    for (const t of listed.tree as any[]) existing.set(t.path, t.sha);
  }
  const changes = gitLabChanges({ files, blobs, existing, stalePaths });
  if (parent && changes.creates.length + changes.updates.length + changes.deletes.length === 0) {
    return { sha: parent, parent, deletedPaths: [], unchanged: true };
  }

  // Each file updated or deleted names the commit that last changed it at
  // that head, so GitLab refuses the commit when the file changed since.
  const lastCommitIds = new Map<string, string>();
  const touched = [...changes.updates.map((f) => f.path), ...changes.deletes];
  for (let i = 0; i < touched.length; i += 10) {
    await Promise.all(touched.slice(i, i + 10).map(async (path) => {
      const resp = await fetch(
        `${apiBase}/projects/${project}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(parent as string)}`,
        { method: "HEAD", headers: { "PRIVATE-TOKEN": token } },
      );
      const id = resp.headers.get("x-gitlab-last-commit-id");
      if (!resp.ok || !id) throw new Error(`Could not read ${path} at ${String(parent).slice(0, 8)} (HTTP ${resp.status}); nothing was written. Try again.`);
      lastCommitIds.set(path, id);
    }));
  }

  const commitResponse = await fetch(`${apiBase}/projects/${project}/repository/commits`, {
    method: "POST",
    headers: glHeaders,
    body: JSON.stringify({ branch, commit_message: message, actions: gitLabActions(changes, lastCommitIds) }),
  });
  if (!commitResponse.ok) {
    const errorText = await commitResponse.text();
    if (gitLabBranchMoved(commitResponse.status, errorText)) {
      console.warn("[pushToGitLab] a file changed since the preflight read the branch; the preflight runs again");
      return { sha: "", parent, deletedPaths: [], moved: true };
    }
    throw new Error(`Failed to create commit: ${commitResponse.statusText} - ${errorText}`);
  }
  const commitData = await commitResponse.json();
  // AD.1: the commit names the parent GitLab gave it; one other than the head
  // the preflight read means commits landed between, and the baseline stays.
  const committedParent = Array.isArray(commitData.parent_ids) && typeof commitData.parent_ids[0] === "string"
    ? commitData.parent_ids[0] as string
    : null;
  return { sha: commitData.id, parent: committedParent, deletedPaths: changes.deletes };
}

function generateArchitectureDocument(graph: any): string | null {
  const nodes = graph.nodes || {};
  const edges = graph.edges || {};
  const contracts = graph.contracts || {};
  const artifacts = graph.artifacts || {};

  const nodeList = Object.values(nodes) as any[];
  if (nodeList.length === 0) return null;

  const lines: string[] = [];
  lines.push("# Architecture Overview");
  lines.push("");
  lines.push("This document is auto-generated by NodeSpec. It describes the system architecture,");
  lines.push("component inventory, connection topology, and links to per-component task documents.");
  lines.push("");

  const containers = nodeList.filter((n) => {
    const children = nodeList.filter((c) => c.parentId === n.id);
    return children.length > 0;
  });
  const leafNodes = nodeList.filter((n) => {
    const children = nodeList.filter((c) => c.parentId === n.id);
    return children.length === 0;
  });

  lines.push("## Component Inventory");
  lines.push("");
  lines.push("| Component | Role | Technology | Parent | Task Document | Test Plan |");
  lines.push("|-----------|------|------------|--------|---------------|-----------|");

  for (const node of leafNodes) {
    const parent = node.parentId ? nodes[node.parentId] : null;
    const parentLabel = parent?.label || "---";
    const tech = node.technology || "---";

    // Require content, matching extractArtifactFiles: a content-less artifact is never
    // pushed, so linking it here would point at a file that does not exist in the repo.
    const taskArtifact = Object.values(artifacts).find(
      (a: any) => a.nodeId === node.id && a.kind === "task" && a.path && a.content
    ) as any;
    const taskLink = taskArtifact ? `[\`${taskArtifact.path}\`](./${taskArtifact.path})` : "---";

    const testArtifact = Object.values(artifacts).find(
      (a: any) => a.nodeId === node.id && a.kind === "test-plan" && a.path && a.content
    ) as any;
    const testLink = testArtifact ? `[\`${testArtifact.path}\`](./${testArtifact.path})` : "---";

    lines.push(`| ${node.label} | ${node.type} | ${tech} | ${parentLabel} | ${taskLink} | ${testLink} |`);
  }
  lines.push("");

  if (containers.length > 0) {
    lines.push("## Containment Hierarchy");
    lines.push("");
    const roots = containers.filter((n) => !n.parentId || !nodes[n.parentId]);
    for (const root of roots) {
      renderContainerTree(lines, root, nodes, 0);
    }
    const orphanLeaves = leafNodes.filter((n) => !n.parentId || !nodes[n.parentId]);
    for (const leaf of orphanLeaves) {
      lines.push(`- ${leaf.label} (${leaf.type})`);
    }
    lines.push("");
  }

  const edgeList = Object.values(edges) as any[];
  if (edgeList.length > 0) {
    lines.push("## Connection Topology");
    lines.push("");
    lines.push("| Source | Target | Protocol | Contract |");
    lines.push("|--------|--------|----------|----------|");

    for (const edge of edgeList) {
      const source = nodes[edge.source];
      const target = nodes[edge.target];
      const contract = contracts[edge.contractId];
      const sourceLabel = source?.label || edge.source;
      const targetLabel = target?.label || edge.target;
      const kind = contract?.kind || "custom";
      const contractName = contract?.name || "---";

      lines.push(`| ${sourceLabel} | ${targetLabel} | ${kind} | ${contractName} |`);
    }
    lines.push("");
  }

  const taskArtifacts = (Object.values(artifacts) as any[]).filter(
    (a) => a.kind === "task" && a.path && a.content
  );
  if (taskArtifacts.length > 0) {
    lines.push("## Task Documents");
    lines.push("");
    lines.push("Each component has a task document containing the full implementation context:");
    lines.push("requirements, contracts, technology guidance, and connected components.");
    lines.push("Use these as the primary brief when implementing or modifying a component.");
    lines.push("");
    for (const ta of taskArtifacts) {
      const ownerNode = nodes[ta.nodeId];
      const label = ownerNode?.label || ta.nodeId;
      lines.push(`- **${label}**: [\`${ta.path}\`](./${ta.path})`);
    }
    lines.push("");
  }

  const testPlanArtifacts = (Object.values(artifacts) as any[]).filter(
    (a) => a.kind === "test-plan" && a.path && a.content
  );
  if (testPlanArtifacts.length > 0) {
    lines.push("## Test Plans");
    lines.push("");
    lines.push("Each requirement has a test plan documenting acceptance criteria assessments,");
    lines.push("recommended test types, framework suggestions, and test scenarios.");
    lines.push("");
    for (const tp of testPlanArtifacts) {
      const ownerNode = nodes[tp.nodeId];
      const label = ownerNode?.label || tp.nodeId;
      lines.push(`- **${label}**: [\`${tp.path}\`](./${tp.path})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderContainerTree(lines: string[], node: any, allNodes: Record<string, any>, depth: number): void {
  const indent = "  ".repeat(depth);
  const tech = node.technology ? ` [${node.technology}]` : "";
  lines.push(`${indent}- **${node.label}**${tech} (${node.type})`);

  const children = Object.values(allNodes).filter((n: any) => n.parentId === node.id) as any[];
  for (const child of children) {
    renderContainerTree(lines, child, allNodes, depth + 1);
  }
}

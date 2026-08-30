import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractOrchestratorAuth } from "../_shared/auth-helpers.ts";
import { decryptWithUpgrade, isEncrypted } from "../_shared/crypto.ts";
import { serializeModel, parseModel, diffAnchors, renderAnchorDiffMarkdown, coreModelHash, MODEL_ANCHOR_PATH, type ModelAnchor } from "../_shared/model-anchor.ts";
import { serializeSpec, loadSpecPlane, SPEC_ANCHOR_PATH } from "../_shared/spec-anchor.ts";
import { providerApiBase, fetchRepoFile, fetchRemoteHeadSha, createRemoteBranch, createPullRequest, mergeRemoteBranch } from "../_shared/git-provider.ts";
import { resolveCommitMode, workBranchName } from "../_shared/commit-mode.ts";
import { BOARD_PATH, buildBoardModel, renderBoardMd } from "../_shared/board-generator.ts";
import { isPrimaryRow, getPrimaryBranch } from "../_shared/primary-branch.ts";
import { evaluateUnbaselinedPush, loadLatestSnapshot, computeStalePaths, SELF_PUSH_PREFIX } from "../_shared/git-drift.ts";
import { refreshTaskPackets } from "../_shared/packet-freshness.ts";
import { BINDINGS_PATH, parseBindingManifest, computeRemainingBindings, renderBindingManifest } from "../_shared/binding-manifest.ts";

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
      .select("id, provider, repo_owner, repo_name, default_branch, base_url, access_token_encrypted, commit_mode")
      .eq("id", integrationId)
      .maybeSingle();

    if (integrationError) throw integrationError;
    if (!integration) throw new Error("Integration not found");

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
      const { data: fromBranch } = await serviceClient
        .from("branches")
        .select("git_ref, last_synced_commit")
        .eq("project_id", projectId)
        .eq("name", fromBranchName ?? "main")
        .maybeSingle();
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
      await serviceClient.from("branches")
        .update({ git_ref: branchName, last_synced_commit: created.sha })
        .eq("id", branch.id);
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
      const targetName = targetBranchName ?? primaryForMerge?.name ?? "main";
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
          // R7d: architecture-only comparison — a pre-R7d target anchor still
          // carries a mappings section its stored hash covers.
          targetInSync = ownParsed.ok &&
            (await coreModelHash(ownParsed.model)) === (await coreModelHash(targetParsed.model as ModelAnchor));
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
      await serviceClient.from("branches")
        .update({ git_ref: branchName, last_synced_commit: created.sha })
        .eq("id", branch.id);
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
      let repoAnchorText: string | null = null;
      try {
        repoAnchorText = await fetchRepoFile(
          integration.provider, apiBase, integration.repo_owner, integration.repo_name,
          MODEL_ANCHOR_PATH, targetRef, token,
        );
      } catch (guardErr) {
        // Provider unreachable → cannot prove the repo is safe to overwrite; fail
        // CLOSED (the whole point is protecting the last surviving copy).
        return new Response(
          JSON.stringify({ error: `Could not verify the repository's existing model before an unbaselined push: ${guardErr instanceof Error ? guardErr.message : String(guardErr)}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
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
    const packetRefresh = await refreshTaskPackets(serviceClient, projectId, graph);
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
    files.push({ path: MODEL_ANCHOR_PATH, content: await serializeModel(graph) });

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
      specPlane = await loadSpecPlane(serviceClient, projectId);
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
    // `.nodespec/bindings.json` — bind-then-clear, keyed off the graph being
    // pushed: an entry leaves the file ONLY when its path is actually bound
    // now, so a failed or not-yet-applied bind can never lose a declaration.
    // Skipped whenever the parse produced flagged rows (rewriting from parsed
    // entries would silently delete a malformed row before its author saw the
    // flag) and never fails a push.
    try {
      const bindingsRaw = await fetchRepoFile(
        integration.provider, apiBase, integration.repo_owner, integration.repo_name,
        BINDINGS_PATH, targetRef, token,
      );
      if (bindingsRaw) {
        const parsedBindings = parseBindingManifest(bindingsRaw);
        if (parsedBindings.flagged.length === 0 && parsedBindings.entries.length > 0) {
          const boundPaths = new Set(
            Object.values((graph.artifacts ?? {}) as Record<string, { path?: string }>)
              .map((a) => (typeof a?.path === "string" ? a.path.replace(/^\//, "") : ""))
              .filter((p) => p.length > 0),
          );
          const { remaining, consumed } = computeRemainingBindings(parsedBindings, boundPaths);
          if (consumed.length > 0) {
            files.push({ path: BINDINGS_PATH, content: renderBindingManifest(remaining) });
          }
        }
      }
    } catch (bindErr) {
      console.warn("[git-push] bindings cleanup skipped (push continues):", bindErr);
    }

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
        const oldAnchorText = await fetchRepoFile(
          integration.provider, apiBase, integration.repo_owner, integration.repo_name,
          MODEL_ANCHOR_PATH, targetRef, token,
        );
        const oldParsed = oldAnchorText ? parseModel(oldAnchorText) : null;
        if (oldParsed?.ok) {
          stalePaths = computeStalePaths(oldParsed.model.artifacts, graph.artifacts ?? {}, files.map((f) => f.path));
        } else if (!oldAnchorText) {
          cleanupSkipped = `no ${MODEL_ANCHOR_PATH} found on ${targetRef}`;
        } else {
          cleanupSkipped = `repo model anchor on ${targetRef} is unreadable (${oldParsed && !oldParsed.ok ? oldParsed.error : "parse failed"}) — likely hand-edited/hand-merged; this push rewrites a valid anchor`;
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
    const commitMessage = reasonText
      ? `${SELF_PUSH_PREFIX} ${reasonText}`
      : `${SELF_PUSH_PREFIX} ${files.length} files from ${branchName}`;
    let pushResult: { sha: string; deletedPaths: string[] };

    // UX-1.1b: commit mode — 'direct' (default; identical to before) or
    // 'pull-request': commit to a nodespec/push-* work branch cut at the
    // target's head, then open the PR. The work-branch push still carries
    // SELF_PUSH_PREFIX, so the webhook's self-push guard skips it; the PR's
    // eventual merge lands in the existing merge-arrival lane.
    const commitMode = resolveCommitMode(integration);
    let pushRef = targetRef;
    let prWorkBranch: string | null = null;
    if (commitMode === "pull-request") {
      const baseSha = await fetchRemoteHeadSha(
        integration.provider, apiBase, integration.repo_owner, integration.repo_name, targetRef, token,
      );
      if (!baseSha) throw new Error(`Cannot open a PR: target ref '${targetRef}' has no head (push directly once first)`);
      prWorkBranch = workBranchName(targetRef);
      const created = await createRemoteBranch(
        integration.provider, apiBase, integration.repo_owner, integration.repo_name, prWorkBranch, baseSha, token,
      );
      if (!created.sha && created.alreadyExists !== true) {
        throw new Error(`Could not create the PR work branch '${prWorkBranch}': ${created.error ?? "unknown error"}`);
      }
      pushRef = prWorkBranch;
    }

    if (integration.provider === "github") {
      pushResult = await pushToGitHub(
        apiBase,
        integration.repo_owner,
        integration.repo_name,
        pushRef,
        token,
        commitMessage,
        files,
        stalePaths,
      );
    } else if (integration.provider === "gitlab") {
      pushResult = await pushToGitLab(
        apiBase,
        integration.repo_owner,
        integration.repo_name,
        pushRef,
        token,
        commitMessage,
        files,
        stalePaths,
      );
    } else {
      throw new Error(`Unsupported provider: ${integration.provider}`);
    }
    const commitSha = pushResult.sha;

    // PR mode: open the pull request now that the work branch carries the
    // commit. A PR failure here is a real failure — the user chose PR mode,
    // so silently leaving an orphan work branch would be worse than erroring.
    let prInfo: { url: string; number?: number } | null = null;
    if (commitMode === "pull-request" && prWorkBranch) {
      const prTitle = `NodeSpec design push: ${reasonText || `${files.length} file(s) from ${branchName}`}`;
      const prBody = `NodeSpec pushed ${files.length} file(s) from design branch \`${branchName}\` in pull-request commit mode.\n\nMerging applies the design state to \`${targetRef}\`; NodeSpec reconciles automatically on merge.`;
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

    await serviceClient.from("git_sync_log").insert({
      integration_id: integrationId,
      project_id: projectId,
      branch_id: branch.id,
      direction: "push",
      commit_sha: commitSha,
      status: "success",
      patches_synced: patches?.length || 0,
      completed_at: new Date().toISOString(),
      metadata: {
        fileCount: files.length,
        // rename/removal cleanup observability: what the anchor comparison
        // wanted deleted, what the provider commit actually deleted, and why
        // the lane was skipped when it was.
        stalePaths,
        deletedPaths: pushResult.deletedPaths,
        ...(cleanupSkipped ? { cleanupSkipped } : {}),
        // R7a: did the spec plane travel with this commit? A project with no spec
        // row writes no spec.json, and that must be distinguishable from a failure.
        specAnchored,
        ...(prInfo ? { commitMode: "pull-request", prUrl: prInfo.url, workBranch: prWorkBranch } : {}),
      },
    });

    // P1-7 R1: advance the sync baseline — the commit we just created IS the reconciled state.
    // The drift sweep diffs remote HEAD against this; because pushes advance it, sweep ranges
    // normally contain only out-of-band (user) commits. Also bind git_ref opportunistically if
    // the branch was never bound (R3 makes binding first-class).
    // R3-3a: bind to the ref we actually pushed to — never clobber a feature
    // branch's binding with the integration default.
    // UX-1.1b: in pull-request mode the TARGET has not moved — the commit sits
    // on the work branch behind a PR — so the baseline must NOT advance; the
    // merge-arrival lane fast-forwards it when the PR merges.
    if (commitMode !== "pull-request") {
      const { error: baselineError } = await serviceClient
        .from("branches")
        .update({ last_synced_commit: commitSha, git_ref: targetRef })
        .eq("id", branch.id);
      if (baselineError) {
        console.warn(`[git-push] failed to advance sync baseline: ${baselineError.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true, commitSha, fileCount: files.length,
        specAnchored,
        ...(prInfo ? { commitMode: "pull-request", prUrl: prInfo.url, prNumber: prInfo.number, workBranch: prWorkBranch } : {}),
        deletedPaths: pushResult.deletedPaths,
        ...(cleanupSkipped ? { cleanupSkipped } : {}),
        packetsRefreshed: packetRefresh.refreshed,
        ...(packetRefresh.refreshedPaths.length ? { refreshedPackets: packetRefresh.refreshedPaths } : {}),
        // C4 step 2: the freshness gate covers test plans too — same observability shape.
        testPlansRefreshed: packetRefresh.testPlansRefreshed,
        ...(packetRefresh.testPlansRefreshedPaths.length ? { refreshedTestPlans: packetRefresh.testPlansRefreshedPaths } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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


async function pushToGitHub(
  apiBase: string,
  owner: string, repo: string, branch: string, token: string,
  message: string, files: FileEntry[],
  stalePaths: string[] = [],
  _staleHeadRetry = false,
): Promise<{ sha: string; deletedPaths: string[] }> {
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

  const refResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });

  let latestCommitSha: string | null = null;
  let baseTreeSha: string | null = null;

  if (refResponse.ok) {
    const refData = await refResponse.json();
    latestCommitSha = refData.object.sha;

    const commitResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers });
    if (!commitResponse.ok) throw new Error(`Failed to get commit: ${commitResponse.statusText}`);
    const commitData = await commitResponse.json();
    baseTreeSha = commitData.tree.sha;
  } else if (refResponse.status !== 404 && refResponse.status !== 409) {
    const body = await refResponse.text();
    throw new Error(`Failed to get branch ref (${refResponse.status}): ${body}`);
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

  if (latestCommitSha) {
    const updateRefResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommitData.sha }),
    });
    if (!updateRefResponse.ok) {
      // 422 non-fast-forward: the head we built on was STALE (the provider can
      // serve a lagging ref for seconds after a recent push — the bench hit it
      // on two rapid same-ref pushes, and R4's auto-push-on-accept does the same
      // in production). One full re-attempt on a freshly read head: the tree is
      // rebuilt against the real base, the commit re-parented, honest content
      // either way. A second 422 is genuine contention — surface it.
      if (updateRefResponse.status === 422 && !_staleHeadRetry) {
        console.warn('[pushToGitHub] ref update 422 (stale head) — rebuilding on fresh head, one retry');
        return pushToGitHub(apiBase, owner, repo, branch, token, message, files, stalePaths, true);
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

  return { sha: newCommitData.sha, deletedPaths };
}

async function pushToGitLab(
  apiBase: string,
  owner: string, repo: string, branch: string, token: string,
  message: string, files: FileEntry[],
  stalePaths: string[] = [],
): Promise<{ sha: string; deletedPaths: string[] }> {
  const baseUrl = apiBase;
  const projectPath = `${owner}/${repo}`;
  const glHeaders = { "PRIVATE-TOKEN": token, "Content-Type": "application/json" };

  const projectResponse = await fetch(`${baseUrl}/projects/${encodeURIComponent(projectPath)}`, { headers: glHeaders });
  if (!projectResponse.ok) throw new Error(`Failed to get project: ${projectResponse.statusText}`);
  const projectData = await projectResponse.json();
  const glProjectId = projectData.id;

  const existingFilesResponse = await fetch(
    `${baseUrl}/projects/${glProjectId}/repository/tree?ref=${branch}&recursive=true&per_page=100`,
    { headers: glHeaders },
  );
  const existingFiles = existingFilesResponse.ok ? await existingFilesResponse.json() : [];
  const existingPaths = new Set(
    (existingFiles as any[]).filter((f: any) => f.type === "blob").map((f: any) => f.path),
  );

  const actions: Array<Record<string, string>> = files.map((f) => ({
    action: existingPaths.has(f.path) ? "update" : "create",
    file_path: f.path,
    content: f.content,
  }));
  // Rename/removal cleanup — delete only paths that still exist on the branch
  // (the commits API fails the WHOLE commit on deleting a nonexistent path).
  const deletedPaths: string[] = [];
  for (const p of stalePaths) {
    if (existingPaths.has(p)) {
      actions.push({ action: "delete", file_path: p });
      deletedPaths.push(p);
    }
  }

  const commitResponse = await fetch(`${baseUrl}/projects/${glProjectId}/repository/commits`, {
    method: "POST",
    headers: glHeaders,
    body: JSON.stringify({ branch, commit_message: message, actions }),
  });
  if (!commitResponse.ok) {
    const errorText = await commitResponse.text();
    throw new Error(`Failed to create commit: ${commitResponse.statusText} - ${errorText}`);
  }
  const commitData = await commitResponse.json();
  return { sha: commitData.id, deletedPaths };
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

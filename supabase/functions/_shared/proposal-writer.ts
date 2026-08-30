// C3 commit 3: server-side proposal writer WITH artifact-content
// externalization.
//
// The '__stored_externally__' lane existed only client-side
// (src/ui/services/ProposalService.ts): patches inserted server-side (MCP
// propose_patches, the git-adopt lane) carry full artifact bodies straight
// into ai_proposals.patches — fine at hand-authored scale, a guaranteed
// ~1MB PostgREST body failure at repo scale. This writer is the server
// mirror of the client stripping: add_artifact content is replaced by the
// sentinel and stored in ai_proposal_artifacts (the accept path already
// rehydrates it — ProposalService.acceptProposal).
//
// Failure honesty: the side-table rows are the CONTENT. If their insert
// fails after the proposal row landed, the proposal would rehydrate to
// sentinel strings — so this rolls the proposal + run back and throws
// rather than leaving a proposal that lies about its artifacts.

export const EXTERNALIZED_CONTENT_SENTINEL = "__stored_externally__";
const ARTIFACT_BATCH_SIZE = 50;

interface RawPatch {
  type: string;
  payload: Record<string, unknown>;
  metadata: { id: string; actorType: string; actorId: string; summary: string; timestamp: string };
}

export interface WriteProposalOptions {
  /** Proposal status at creation. Default 'pending' (visible for acceptance).
   *  'staged' = invisible draft awaiting AI finalization (finalize_import);
   *  admitted by ai_proposals_status_check since migration 20260812100000. */
  status?: "pending" | "staged";
  projectId: string;
  branchId: string;
  patches: RawPatch[];
  /** Provenance discriminator — becomes ai_runs.model + metadata.source (e.g. 'repo-import'). */
  source: string;
  metadata?: Record<string, unknown>;
}

export interface WriteProposalResult {
  proposalId: string;
  aiRunId: string;
  patchCount: number;
  externalizedArtifacts: number;
}

export async function writeProposal(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: WriteProposalOptions,
): Promise<WriteProposalResult> {
  const artifactContents: Array<{ artifactId: string; content: string; contentHash: string | null }> = [];
  const stripped = opts.patches.map((p) => {
    if (p.type === "add_artifact" && typeof p.payload?.content === "string" && p.payload.content.length > 0) {
      artifactContents.push({
        artifactId: String(p.payload.id),
        content: p.payload.content as string,
        contentHash: (p.payload.contentHash as string | undefined) ?? null,
      });
      return { ...p, payload: { ...p.payload, content: EXTERNALIZED_CONTENT_SENTINEL } };
    }
    return p;
  });

  const aiRunId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: runErr } = await supabase.from("ai_runs").insert({
    id: aiRunId,
    project_id: opts.projectId,
    branch_id: opts.branchId,
    model: opts.source,
    prompt_hash: opts.source,
    status: "completed",
    completed_at: now,
    metadata: { source: opts.source, patchCount: stripped.length },
  });
  if (runErr) throw new Error(`ai_runs insert failed: ${runErr.message}`);

  const { error: propErr } = await supabase.from("ai_proposals").insert({
    id: proposalId,
    ai_run_id: aiRunId,
    source_branch_id: opts.branchId,
    proposal_branch_id: opts.branchId,
    status: opts.status ?? "pending",
    patches: stripped.map((patch) => ({ patch, status: "pending", explanation: patch.metadata.summary })),
    validation_expectations: [],
    metadata: { ...(opts.metadata ?? {}), source: opts.source },
  });
  if (propErr) {
    await supabase.from("ai_runs").delete().eq("id", aiRunId);
    throw new Error(`ai_proposals insert failed: ${propErr.message}`);
  }

  for (let i = 0; i < artifactContents.length; i += ARTIFACT_BATCH_SIZE) {
    const batch = artifactContents.slice(i, i + ARTIFACT_BATCH_SIZE).map((a) => ({
      proposal_id: proposalId,
      artifact_id: a.artifactId,
      content: a.content,
      content_hash: a.contentHash,
    }));
    const { error: artErr } = await supabase
      .from("ai_proposal_artifacts")
      .upsert(batch, { onConflict: "proposal_id,artifact_id" });
    if (artErr) {
      // Roll back: a proposal whose external content is missing would
      // rehydrate to sentinel strings — refuse to leave it behind.
      await supabase.from("ai_proposal_artifacts").delete().eq("proposal_id", proposalId);
      await supabase.from("ai_proposals").delete().eq("id", proposalId);
      await supabase.from("ai_runs").delete().eq("id", aiRunId);
      throw new Error(`artifact content externalization failed: ${artErr.message}`);
    }
  }

  return {
    proposalId,
    aiRunId,
    patchCount: stripped.length,
    externalizedArtifacts: artifactContents.length,
  };
}

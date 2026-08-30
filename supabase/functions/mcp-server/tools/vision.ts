// C3 commit 8: update_vision — the minimal vision write lane C3c's backfill
// needs (R6 later adds visionHash + instruction stitching; this is just the
// one-column write with the same spec bootstrap create_requirement uses).
// Doctrine: the vision is the USER'S — greenfield, the AI is directed to ASK
// and record their words; brownfield (post-import), the AI drafts FROM the
// imported graph and the user edits the proposal. Either way this tool
// records it; it never invents it server-side.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName } from "../shared.ts";
import { resolveSpecForProject } from "./requirements.ts";

export async function handleUpdateVision(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; vision: string },
): Promise<MCPResponse> {
  if (!checkScope(auth, "write")) {
    return { success: false, error: "Insufficient permissions: write scope required" };
  }

  const vision = (args.vision ?? "").trim();
  if (!vision) {
    return { success: false, error: "vision is required — a project vision cannot be blanked over MCP. Edit it in the app to clear it." };
  }
  if (vision.length > 10_000) {
    return { success: false, error: `vision is too long (${vision.length} chars, max 10000) — this is the anchoring statement, not the spec.` };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ("error" in resolved) return resolved.error;
  const projectId = resolved.project.id;

  const existingSpec = await resolveSpecForProject(supabase, projectId);
  let specId: string;
  let created = false;
  if (existingSpec) {
    specId = existingSpec.id as string;
    const { error: updErr } = await supabase
      .from("project_specifications")
      .update({ vision })
      .eq("id", specId);
    if (updErr) return { success: false, error: `Vision update failed: ${updErr.message}` };
  } else {
    // Same bootstrap as create_requirement: MCP-first projects get a minimal
    // spec row (race convergence included — re-resolve newest).
    const { data: newSpec, error: specErr } = await supabase
      .from("project_specifications")
      .insert({
        project_id: projectId,
        vision,
        raw_input: "",
        created_by: auth.userId,
        phase_status: "drafting_requirements",
      })
      .select("id")
      .single();
    if (specErr || !newSpec) {
      return { success: false, error: `Failed to create specification: ${specErr?.message || "unknown error"}` };
    }
    const converged = await resolveSpecForProject(supabase, projectId);
    specId = (converged?.id as string) ?? (newSpec.id as string);
    created = true;
    if (specId !== newSpec.id) {
      // Lost the race — write the vision onto the winning spec too.
      await supabase.from("project_specifications").update({ vision }).eq("id", specId);
    }
  }

  return {
    success: true,
    data: {
      specificationId: specId,
      specificationCreated: created,
      visionLength: vision.length,
      // R6: this claim is now TRUE — the vision is part of both context
      // fingerprints, so the push-time freshness gate regenerates every
      // packet/test-plan that embeds it.
      nextAction: "Vision recorded. The next git push regenerates every task packet and test plan that embeds it (the freshness gate fingerprints the vision); generate_task_docs refreshes packets on demand. Continue: create_requirement (criteria start unmet) + map_requirement — brownfield, until run_repo_import reports empty coverage; greenfield, draft requirements with the user.",
    },
  };
}

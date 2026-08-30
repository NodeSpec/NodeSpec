// B3 (docs/WORK_LOOP_PLAN.md) · sweep/webhook-side binding resolution.
//
// READ-ONLY by design. The B2 lesson governs: binding a file creates an
// artifact — a graph write — and server-side graph writes race the open
// editor's autosave (which persists its in-memory graph wholesale). So the
// server's whole job here is to COMPUTE and REPORT: fetch the declaration
// file at the ref, resolve it against the branch's latest snapshot, and hang
// the result on the change card. The APPLY happens client-side through the
// same patch pipeline the residue-bind button drives (or by the AI through
// resolve_change patches); the CLEAR happens at the next NodeSpec push,
// keyed off what the pushed graph actually binds (bind-then-clear).

import {
  BINDINGS_PATH,
  parseBindingManifest,
  resolveBindings,
  type BindingResolution,
} from "./binding-manifest.ts";

export type FetchFileFn = (
  provider: string,
  apiBase: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string,
) => Promise<string | null>;

/**
 * Resolve `.nodespec/bindings.json` at a ref against the mapped branch's
 * latest snapshot graph. Returns null when there is nothing to report — no
 * file, an empty queue, or no snapshot to resolve against (a graph that
 * does not exist yet cannot bind anything; the declarations simply wait).
 */
// deno-lint-ignore no-explicit-any
export async function computeSweepBindingResolution(supabase: any, projectId: string, args: {
  // deno-lint-ignore no-explicit-any
  integration: any;
  apiBase: string;
  token: string;
  ref: string;
  /** The mapped NodeSpec branch whose graph declarations resolve against. */
  branchName: string;
  fetchFile: FetchFileFn;
}): Promise<BindingResolution | null> {
  const { integration, apiBase, token, ref, branchName, fetchFile } = args;

  const raw = await fetchFile(
    integration.provider, apiBase, integration.repo_owner, integration.repo_name,
    BINDINGS_PATH, ref, token,
  );
  const parsed = parseBindingManifest(raw);
  if (parsed.entries.length === 0 && parsed.flagged.length === 0) return null;

  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("project_id", projectId)
    .eq("name", branchName)
    .maybeSingle();
  if (!branch) return null;

  const { data: snapshot } = await supabase
    .from("graph_snapshots")
    .select("graph_data")
    .eq("branch_id", branch.id)
    .order("patch_sequence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snapshot?.graph_data) return null;

  const resolution = resolveBindings(parsed, snapshot.graph_data as {
    nodes?: Record<string, { id: string; label?: string }>;
    artifacts?: Record<string, { path?: string }>;
  });
  if (
    resolution.bind.length === 0 &&
    resolution.alreadyBound.length === 0 &&
    resolution.flagged.length === 0
  ) {
    return null;
  }
  return resolution;
}

// AA.6 (moved from AA.1, owner 2026-09-23): a node's packet and context carry
// the vision sentences its work serves, not the whole vision.
//
// The chain runs vision sentence → outcome (evidence.serves) → requirement
// (outcome_derivations) → node (specification_mappings). Walked backwards from
// a node, it names the sentences that node exists for. Those are what its
// packet and its context say; the whole vision is one read away
// (get_outcome_board lists every sentence), and a sentence the node does not
// serve no longer re-stales its packet when it is edited.
//
// A citation counts only while the sentence is still in the vision (the id is
// the hash of its words, vision-sentences.ts); a reworded sentence drops out
// here the way it reads as off vision on the chain. Dismissed outcomes cite
// nothing.
//
// The block is rendered here, once, and both the generator and the
// fingerprint read it (servedVisionLines / servedVisionText), so what the
// packet says and what its freshness hashes cannot drift apart.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { servesOf, visionSentences, type VisionSentence } from "./vision-sentences.ts";

export interface ServedVision {
  /** false when the project has no vision recorded: the packet says nothing about it. */
  recorded: boolean;
  /** The current sentences the node's outcomes cite, in vision order, each once. */
  sentences: VisionSentence[];
}

export const SERVED_VISION_HEADING = "## Vision This Node Serves";
export const WHOLE_VISION_POINTER = "The whole vision is one read away: get_outcome_board lists every sentence with its id.";
export const SERVES_NO_SENTENCE =
  "No outcome behind this node's requirements cites the vision, so no sentence is carried here.";

/** The sentences a set of outcome evidence blobs cites, against the current vision. */
export function servedSentences(vision: string | null | undefined, evidences: unknown[]): ServedVision {
  const current = visionSentences(vision);
  if (current.length === 0) return { recorded: false, sentences: [] };
  const cited = new Set<string>();
  for (const e of evidences) for (const s of servesOf(e)) cited.add(s.id);
  return { recorded: true, sentences: current.filter((s) => cited.has(s.id)) };
}

/** The packet's block, markdown lines. Empty when the project has no vision. */
export function servedVisionLines(sv: ServedVision | null | undefined): string[] {
  if (!sv || !sv.recorded) return [];
  if (sv.sentences.length === 0) return [SERVED_VISION_HEADING, "", `${SERVES_NO_SENTENCE} ${WHOLE_VISION_POINTER}`, ""];
  return [
    SERVED_VISION_HEADING,
    "",
    "The sentences of the project vision that the outcomes behind this node's requirements cite:",
    "",
    ...sv.sentences.map((s) => `- ${s.text}`),
    "",
    WHOLE_VISION_POINTER,
    "",
  ];
}

/** What the packet fingerprint hashes for the vision: exactly the block it renders. */
export function servedVisionText(sv: ServedVision | null | undefined): string {
  return servedVisionLines(sv).join("\n");
}

/**
 * The served vision for each node, in three reads: the derivations behind the
 * nodes' requirements, the outcomes they came from, and nothing else (the
 * vision and the mappings are the caller's). `requirementRowsByNode` maps a
 * node id to the requirement ROW uuids mapped to it. Throws on a read error:
 * a packet written without it would say the node serves nothing.
 */
export async function loadServedVision(
  supabase: SupabaseClient,
  projectId: string,
  /** The branch the outcomes live on; null reads them on every branch. */
  branchId: string | null,
  vision: string | null | undefined,
  requirementRowsByNode: Map<string, string[]>,
): Promise<Map<string, ServedVision>> {
  const out = new Map<string, ServedVision>();
  const none = servedSentences(vision, []);
  for (const nodeId of requirementRowsByNode.keys()) out.set(nodeId, none);
  if (!none.recorded) return out;
  const rowIds = [...new Set([...requirementRowsByNode.values()].flat())];
  if (rowIds.length === 0) return out;

  const { data: derRows, error: derErr } = await supabase
    .from("outcome_derivations")
    .select("candidate_id, requirement_row_id")
    .eq("project_id", projectId)
    .in("requirement_row_id", rowIds);
  if (derErr) throw new Error(`outcome derivations: ${derErr.message}`);
  const derivations = (Array.isArray(derRows) ? derRows : []) as Array<{ candidate_id: string; requirement_row_id: string }>;
  const candidateIds = [...new Set(derivations.map((d) => d.candidate_id))];
  if (candidateIds.length === 0) return out;

  let candQuery = supabase
    .from("requirement_candidates")
    .select("id, evidence, status")
    .in("id", candidateIds);
  if (branchId) candQuery = candQuery.eq("branch_id", branchId);
  const { data: candRows, error: candErr } = await candQuery;
  if (candErr) throw new Error(`outcomes: ${candErr.message}`);
  const evidenceById = new Map<string, unknown>();
  for (const c of (Array.isArray(candRows) ? candRows : []) as Array<{ id: string; evidence: unknown; status: string }>) {
    if (c.status !== "dismissed") evidenceById.set(c.id, c.evidence);
  }
  const outcomesByRow = new Map<string, string[]>();
  for (const d of derivations) {
    const list = outcomesByRow.get(d.requirement_row_id) ?? [];
    list.push(d.candidate_id);
    outcomesByRow.set(d.requirement_row_id, list);
  }
  for (const [nodeId, rows] of requirementRowsByNode) {
    const evidences = rows.flatMap((r) => outcomesByRow.get(r) ?? []).map((id) => evidenceById.get(id)).filter((e) => e !== undefined);
    out.set(nodeId, servedSentences(vision, evidences));
  }
  return out;
}

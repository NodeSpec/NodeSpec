// R6: relate_requirements — the AUTHORED requirement↔requirement lane.
//
// Doctrine (inversion): NodeSpec never writes a relation on its own — rows
// come only from a user click in the panel or an explicit call here.
// Deterministic node-overlap coupling stays DERIVED at read time
// (list_requirements' coupling field) and never lands in this table.
// 'expands' records expansion lineage — the "this new requirement expands
// completed REQ-007" answer — and renders as a card badge + decomposition
// edge. Patterned on map_requirement: both ends accept REQ-xxx or the row
// uuid; add is idempotent (the unique violation reads as alreadyExists, not
// an error); remove deletes the exact (from, to, type) fact.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName } from "../shared.ts";
import { resolveRequirementRow, resolveSpecForProject } from "./requirements.ts";

export const RELATION_TYPES = ["expands", "depends_on", "relates_to"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export async function handleRelateRequirements(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: {
    project_id: string;
    from_requirement_id: string;
    to_requirement_id: string;
    relation_type: string;
    mode?: "add" | "remove";
    notes?: string;
  },
): Promise<MCPResponse> {
  if (!checkScope(auth, "write")) {
    return { success: false, error: "Insufficient permissions: write scope required" };
  }
  const mode = args.mode === "remove" ? "remove" : "add";
  if (!RELATION_TYPES.includes(args.relation_type as RelationType)) {
    return { success: false, error: `Invalid relation_type "${args.relation_type}". Valid: ${RELATION_TYPES.join(", ")}` };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ("error" in resolved) return resolved.error;
  const spec = await resolveSpecForProject(supabase, resolved.project.id);
  if (!spec) {
    return { success: false, error: "Project has no specification — create requirements first." };
  }

  const from = await resolveRequirementRow(supabase, spec.id, args.from_requirement_id);
  if (!from) return { success: false, error: `Requirement not found: ${args.from_requirement_id}` };
  const to = await resolveRequirementRow(supabase, spec.id, args.to_requirement_id);
  if (!to) return { success: false, error: `Requirement not found: ${args.to_requirement_id}` };
  if (from.id === to.id) {
    return { success: false, error: "A requirement cannot relate to itself." };
  }

  if (mode === "remove") {
    const { error: delErr } = await supabase
      .from("specification_requirement_relations")
      .delete()
      .eq("from_requirement_id", from.id)
      .eq("to_requirement_id", to.id)
      .eq("relation_type", args.relation_type);
    if (delErr) return { success: false, error: delErr.message };
    return {
      success: true,
      data: {
        mode,
        from: from.requirement_id,
        to: to.requirement_id,
        relationType: args.relation_type,
      },
    };
  }

  const { error: insErr } = await supabase
    .from("specification_requirement_relations")
    .insert({
      specification_id: spec.id,
      from_requirement_id: from.id,
      to_requirement_id: to.id,
      relation_type: args.relation_type,
      source: "ai",
      created_by: auth.userId,
      ...(args.notes ? { notes: args.notes } : {}),
    });
  if (insErr) {
    // Duplicate = the fact already stands; recording it twice is a no-op, not a failure.
    if (insErr.code === "23505") {
      return {
        success: true,
        data: { mode, from: from.requirement_id, to: to.requirement_id, relationType: args.relation_type, alreadyExists: true },
      };
    }
    return { success: false, error: insErr.message };
  }

  return {
    success: true,
    data: { mode, from: from.requirement_id, to: to.requirement_id, relationType: args.relation_type },
  };
}

/** create_requirement's optional relations[] rides through here: resolve each
 *  target and insert with source 'ai'; unresolvable targets are REPORTED,
 *  never fatal — the requirement itself stands. */
export async function createRelationsForNewRequirement(
  supabase: SupabaseClient,
  specId: string,
  fromRowId: string,
  userId: string,
  relations: Array<{ to: string; type: string; notes?: string }>,
): Promise<{ created: Array<{ to: string; type: string }>; failed: Array<{ to: string; type: string; reason: string }> }> {
  const created: Array<{ to: string; type: string }> = [];
  const failed: Array<{ to: string; type: string; reason: string }> = [];
  for (const rel of relations) {
    if (!RELATION_TYPES.includes(rel.type as RelationType)) {
      failed.push({ to: rel.to, type: rel.type, reason: `invalid relation type (valid: ${RELATION_TYPES.join(", ")})` });
      continue;
    }
    const target = await resolveRequirementRow(supabase, specId, rel.to);
    if (!target) {
      failed.push({ to: rel.to, type: rel.type, reason: "target requirement not found" });
      continue;
    }
    if (target.id === fromRowId) {
      failed.push({ to: rel.to, type: rel.type, reason: "a requirement cannot relate to itself" });
      continue;
    }
    const { error } = await supabase
      .from("specification_requirement_relations")
      .insert({
        specification_id: specId,
        from_requirement_id: fromRowId,
        to_requirement_id: target.id,
        relation_type: rel.type,
        source: "ai",
        created_by: userId,
        ...(rel.notes ? { notes: rel.notes } : {}),
      });
    if (error && error.code !== "23505") {
      failed.push({ to: rel.to, type: rel.type, reason: error.message ?? "insert failed" });
      continue;
    }
    created.push({ to: target.requirement_id, type: rel.type });
  }
  return { created, failed };
}

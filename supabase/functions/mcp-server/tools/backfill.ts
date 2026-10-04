/*
  Community edition stub — requirement backfill (backfill_requirements)
  derives candidates from the repo index the repo-import pipeline builds,
  which is not part of the open-source distribution. This file keeps the MCP
  surface coherent (the tool stays registered and answers honestly) while
  carrying zero backfill logic. Available on NodeSpec hosted (Indie and
  above) and in enterprise builds — https://nodespec.io/pricing
*/
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";

const NOT_INCLUDED =
  "Requirement backfill is not included in the community edition. " +
  "It is available on NodeSpec hosted (Indie and above) and in enterprise builds — https://nodespec.io/pricing. " +
  "create_requirement and map_requirement are fully available here.";

export function handleBackfillRequirements(
  _supabase: SupabaseClient,
  _auth: AuthResult,
  _args: { project_id: string; node_id?: string; branch_id?: string; accept?: string[]; dismiss?: string[] },
): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}

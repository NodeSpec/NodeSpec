/*
  Community edition stub — repo index retrieval (get_node_context,
  search_repo_index) rides the repo-import pipeline, which is not part of the
  open-source distribution. This file keeps the MCP surface coherent (the
  tools stay registered and answer honestly) while carrying zero retrieval
  logic. Available on NodeSpec hosted (Indie and above) and in enterprise
  builds — https://nodespec.io/pricing
*/
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";

const NOT_INCLUDED =
  "Repo index retrieval is not included in the community edition. " +
  "It is available on NodeSpec hosted (Indie and above) and in enterprise builds — https://nodespec.io/pricing. " +
  "get_project_context and the artifact reads are fully available here.";

export function handleGetNodeContext(
  _supabase: SupabaseClient,
  _auth: AuthResult,
  _args: { project_id: string; node_id: string; branch_id?: string; hub_limit?: number },
): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}

export function handleSearchRepoIndex(
  _supabase: SupabaseClient,
  _auth: AuthResult,
  _args: { project_id: string; query: string; node_id?: string; branch_id?: string; max_results?: number },
): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}

export function handleGetImportContext(
  _supabase: SupabaseClient,
  _auth: AuthResult,
  _args: { project_id: string; branch_id?: string },
): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}

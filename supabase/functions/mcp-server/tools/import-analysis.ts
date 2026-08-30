/*
  Community edition stub — the repo-import reverse-engineering pipeline is not
  part of the open-source distribution. This file keeps the MCP surface
  coherent (the tool stays registered and answers honestly) while carrying
  zero pipeline logic. Repo import is available on NodeSpec hosted (Indie and
  above) and in enterprise builds — https://nodespec.io/pricing
*/
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";

export interface ImportDecisions {
  approve?: boolean;
  renames?: Array<{ from_label: string; to_label: string }>;
  role_changes?: Array<{ label: string; role_id: string }>;
  set_technology?: Array<{ label: string; technology: string }>;
  drop_nodes?: string[];
  add_edges?: Array<{ from_label: string; to_label: string; contract_kind?: string; label?: string; evidence: string }>;
  drop_edges?: Array<{ from_label: string; to_label: string }>;
}

const NOT_INCLUDED =
  "Repo import reverse visualization is not included in the community edition. " +
  "It is available on NodeSpec hosted (Indie and above) and in enterprise builds — https://nodespec.io/pricing. " +
  "Assigning repo files to nodes via gitops (propose_patches artifacts) is fully available here.";

export function handleRunRepoImport(
  _supabase: SupabaseClient,
  _auth: AuthResult,
  _args: { project_id: string; restart?: boolean; decisions?: ImportDecisions },
): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}

export function handleFinalizeImport(
  _supabase: SupabaseClient,
  _auth: AuthResult,
  _args: { project_id: string } & ImportDecisions,
): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}

/*
  Community edition stub — project seats (list_project_members /
  set_project_member) are the Team roster, which is not part of the
  open-source distribution (R1: multi-lane + presence is Team). This file
  keeps the MCP surface coherent (the tools stay registered and answer
  honestly) while carrying zero roster logic. Available on NodeSpec hosted
  (Team and above) and in the licensed container — https://nodespec.io/pricing
*/
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";

const NOT_INCLUDED =
  "Project seats (the Team roster) are not included in the community edition — every project here has one account, its owner. " +
  "Seats are available on NodeSpec hosted (Team and above) and in the licensed container — https://nodespec.io/pricing. " +
  "Everything else — the Workflow and Trace modes, MCP with every scope, git export and import — is fully available here.";

export function handleListProjectMembers(_supabase: SupabaseClient, _auth: AuthResult, _args: { project_id: string }): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}
export function handleSetProjectMember(_supabase: SupabaseClient, _auth: AuthResult, _args: { project_id: string; email: string; role: string }): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}

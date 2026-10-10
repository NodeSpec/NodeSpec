/*
  Community edition stub — Priority mode (get_work_plan / propose_work_plan /
  accept_work_plan) orders the work over the deterministic coupling engine,
  which is not part of the open-source distribution (R1: indie+). This file
  keeps the MCP surface coherent (the tools stay registered and answer
  honestly) while carrying zero engine logic. Available on NodeSpec hosted
  (Indie and above) and in enterprise builds — https://nodespec.io/pricing
*/
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";

const NOT_INCLUDED =
  "The prioritization board (work plans) is not included in the community edition. " +
  "It is available on NodeSpec hosted (Indie and above) and in enterprise builds — https://nodespec.io/pricing. " +
  "get_work_queue's build-order fallback and the Workflow and Trace modes are fully available here.";

export function handleGetWorkPlan(_supabase: SupabaseClient, _auth: AuthResult, _args: { project_id: string; branch_id?: string }): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}
export function handleProposeWorkPlan(_supabase: SupabaseClient, _auth: AuthResult, _args: unknown): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}
export function handleAcceptWorkPlan(_supabase: SupabaseClient, _auth: AuthResult, _args: { project_id: string; plan_id: string }): Promise<MCPResponse> {
  return Promise.resolve({ success: false, error: NOT_INCLUDED });
}

/** AL.24: the sweep's half for plans; plans are not in the community edition. */
export interface PlanSweep { planId: string; status: "accepted" | "waiting"; reason?: string }
export function sweepPlans(_supabase: SupabaseClient, _projectId: string, _ownerId: string | null): Promise<PlanSweep[]> {
  return Promise.resolve([]);
}

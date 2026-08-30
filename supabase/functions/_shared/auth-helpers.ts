/**
 * Shared authentication helpers for edge functions
 *
 * This module provides consistent authentication handling across all edge functions.
 *
 * Authentication Flow:
 * 1. Upstream functions (agent-orchestrator) validate JWT and extract userId
 * 2. They pass userId to downstream functions in the request body
 * 3. Downstream functions ONLY accept userId (no JWT validation)
 */

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface AuthContext {
  userId: string;
  supabase: SupabaseClient;
}

export interface AuthOptions {
  /**
   * Whether this is an orchestrator function that validates JWT
   * If true, validates JWT. If false, requires userId in body.
   * @default false (downstream function, requires userId)
   */
  isOrchestrator?: boolean;
}

/**
 * Extract authentication context for DOWNSTREAM functions
 * These functions are called by orchestrators and ONLY accept userId from request body
 * NO JWT validation is performed
 *
 * @param requestBody - The parsed request body containing userId
 * @returns AuthContext with userId and Supabase client (using service role for internal operations)
 * @throws Error if userId is not provided
 */
export function extractDownstreamAuth(
  requestBody: { userId?: string; [key: string]: unknown }
): AuthContext {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase configuration missing');
  }

  if (!requestBody.userId || typeof requestBody.userId !== 'string') {
    throw new Error('userId is required in request body (must be passed by orchestrator)');
  }

  console.log('✅ [auth] Using userId from orchestrator:', requestBody.userId);

  // Create Supabase client with SERVICE ROLE key (bypasses RLS for internal service calls)
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  return {
    userId: requestBody.userId,
    supabase,
  };
}

/**
 * Extract authentication context for ORCHESTRATOR functions
 * These are entry points that validate JWT and extract userId
 *
 * @param req - The incoming request
 * @returns AuthContext with userId and authenticated Supabase client
 * @throws Error if authentication fails
 */
export async function extractOrchestratorAuth(req: Request): Promise<AuthContext> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase configuration missing');
  }

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');

  if (!authHeader) {
    throw new Error('Authentication required: No authorization header');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Invalid authorization header format: Must start with "Bearer "');
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error('Auth validation failed:', error?.message ?? 'No user');
    throw new Error(`Authentication failed: ${error?.message || 'Invalid token'}`);
  }

  return {
    userId: user.id,
    supabase,
  };
}

/**
 * DEPRECATED: Use extractDownstreamAuth or extractOrchestratorAuth instead
 */
export async function extractAuthContext(
  req: Request,
  requestBody: { userId?: string; [key: string]: unknown },
  options: AuthOptions = {}
): Promise<AuthContext> {
  const { isOrchestrator = false } = options;

  if (isOrchestrator) {
    return await extractOrchestratorAuth(req);
  } else {
    return extractDownstreamAuth(requestBody);
  }
}

/**
 * Validate that an auth header exists and is properly formatted
 * Does not validate the JWT itself
 *
 * @param req - The incoming request
 * @returns The auth header string
 * @throws Error if auth header is missing or invalid
 */
export function requireAuthHeader(req: Request): string {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');

  if (!authHeader) {
    throw new Error('Authentication required: No authorization header');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Invalid authorization header format: Must start with "Bearer "');
  }

  return authHeader;
}

/**
 * Create a Supabase client with authentication
 *
 * @param authHeader - Optional auth header to use
 * @returns Authenticated Supabase client
 */
export function createAuthenticatedClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase configuration missing');
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

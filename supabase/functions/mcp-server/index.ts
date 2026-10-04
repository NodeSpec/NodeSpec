import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "./shared.ts";
import { handleRequest } from "./server.ts";

// S1-3 chunk 8 (final): mcp-server is a thin composition root. The HTTP
// router is ./server.ts (handleRequest: sub-path, OAuth endpoints, discovery,
// authentication, transport hand-off), so the Deno suite can drive it with a
// Request the way a connecting agent does. This file only reads the
// environment, builds the service-role client and serves.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ success: false, error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  return await handleRequest(req, createClient(supabaseUrl, supabaseServiceKey));
});

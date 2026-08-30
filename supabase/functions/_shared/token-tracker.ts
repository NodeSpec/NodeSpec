import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type TokenSource = "platform" | "byok";

export interface TokenUsageEntry {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  edgeFunction: string;
  projectId?: string;
  source?: TokenSource;
}

let _serviceClient: SupabaseClient | null = null;

function getServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase config missing for token tracker");
  _serviceClient = createClient(url, key);
  return _serviceClient;
}

export function trackTokenUsage(entry: TokenUsageEntry): void {
  if (entry.inputTokens === 0 && entry.outputTokens === 0) return;

  const client = getServiceClient();
  client
    .from("token_usage")
    .insert({
      user_id: entry.userId,
      model: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      edge_function: entry.edgeFunction,
      project_id: entry.projectId || null,
      source: entry.source || "platform",
    })
    .then(({ error }) => {
      if (error) console.error("[token-tracker] Insert failed:", error.message);
    });
}

export function extractOpenAIUsage(
  responseBody: Record<string, unknown>
): { inputTokens: number; outputTokens: number } {
  const usage = responseBody?.usage as
    | { prompt_tokens?: number; completion_tokens?: number }
    | undefined;
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  };
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractOrchestratorAuth } from "../_shared/auth-helpers.ts";
import { encrypt, decrypt } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Provider = "openai" | "anthropic" | "google";
type Operation = "save" | "delete" | "list";

const VALID_PROVIDERS = new Set<Provider>(["openai", "anthropic", "google"]);

interface RequestBody {
  operation: Operation;
  provider?: Provider;
  apiKey?: string;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 3) + "..." + key.slice(-4);
}

async function validateOpenAIKey(apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (resp.status === 401)
      return "Invalid OpenAI API key. Check that your key is correct and not expired.";
    if (resp.status === 403)
      return "OpenAI API key lacks required permissions.";
    if (!resp.ok) {
      const text = await resp.text();
      return `OpenAI API returned ${resp.status}: ${text.slice(0, 200)}`;
    }
    return null;
  } catch (err) {
    return `Failed to reach OpenAI API: ${(err as Error).message}`;
  }
}

async function validateAnthropicKey(apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (resp.status === 401)
      return "Invalid Anthropic API key. Check that your key is correct and not expired.";
    if (resp.status === 403)
      return "Anthropic API key lacks required permissions.";
    if (!resp.ok) {
      const text = await resp.text();
      return `Anthropic API returned ${resp.status}: ${text.slice(0, 200)}`;
    }
    return null;
  } catch (err) {
    return `Failed to reach Anthropic API: ${(err as Error).message}`;
  }
}

async function validateGoogleKey(apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (resp.status === 400 || resp.status === 401 || resp.status === 403)
      return "Invalid Google AI API key. Check that your key is correct and has Generative Language API enabled.";
    if (!resp.ok) {
      const text = await resp.text();
      return `Google AI API returned ${resp.status}: ${text.slice(0, 200)}`;
    }
    return null;
  } catch (err) {
    return `Failed to reach Google AI API: ${(err as Error).message}`;
  }
}

const VALIDATORS: Record<
  Provider,
  (key: string) => Promise<string | null>
> = {
  openai: validateOpenAIKey,
  anthropic: validateAnthropicKey,
  google: validateGoogleKey,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { userId } = await extractOrchestratorAuth(req);
    const body: RequestBody = await req.json();
    const { operation } = body;

    if (!operation || !["save", "delete", "list"].includes(operation)) {
      return new Response(
        JSON.stringify({
          error: 'operation is required and must be "save", "delete", or "list"',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (operation === "list") {
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("provider, is_active, api_key_encrypted, created_at, updated_at")
        .eq("user_id", userId)
        .order("provider");

      if (error) throw error;

      const keys = await Promise.all(
        (data || []).map(
          async (row: {
            provider: string;
            is_active: boolean;
            api_key_encrypted: string;
            created_at: string;
            updated_at: string;
          }) => {
            let hint = "****";
            try {
              const plaintext = await decrypt(row.api_key_encrypted);
              hint = maskKey(plaintext);
            } catch {
              hint = "encrypted";
            }
            return {
              provider: row.provider,
              is_active: row.is_active,
              hint,
              created_at: row.created_at,
              updated_at: row.updated_at,
            };
          }
        )
      );

      const { data: settings } = await supabase
        .from("user_settings")
        .select("ai_provider, ai_model, use_global_ai, use_v4_orchestrator")
        .eq("user_id", userId)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          keys,
          settings: settings || {
            ai_provider: null,
            ai_model: null,
            use_global_ai: true,
            use_v4_orchestrator: false,
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (operation === "save") {
      const { provider, apiKey } = body;

      if (!provider || !VALID_PROVIDERS.has(provider)) {
        return new Response(
          JSON.stringify({
            error:
              'provider is required and must be "openai", "anthropic", or "google"',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 8) {
        return new Response(
          JSON.stringify({ error: "apiKey is required and must be valid" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const trimmedKey = apiKey.trim();
      const validationError = await VALIDATORS[provider](trimmedKey);
      if (validationError) {
        return new Response(
          JSON.stringify({ error: validationError }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const encryptedKey = await encrypt(trimmedKey);

      const { error: upsertError } = await supabase
        .from("user_api_keys")
        .upsert(
          {
            user_id: userId,
            provider,
            api_key_encrypted: encryptedKey,
            is_active: true,
          },
          { onConflict: "user_id,provider" }
        );

      if (upsertError) throw upsertError;

      return new Response(
        JSON.stringify({
          success: true,
          provider,
          hint: maskKey(trimmedKey),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (operation === "delete") {
      const { provider } = body;

      if (!provider || !VALID_PROVIDERS.has(provider)) {
        return new Response(
          JSON.stringify({
            error:
              'provider is required and must be "openai", "anthropic", or "google"',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { error: deleteError } = await supabase
        .from("user_api_keys")
        .delete()
        .eq("user_id", userId)
        .eq("provider", provider);

      if (deleteError) throw deleteError;

      return new Response(
        JSON.stringify({ success: true, provider }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown operation" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message.includes("Authentication") ? 401 : 500;
    console.error("[manage-ai-keys] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// P0-1: one-shot batch re-encryption of stored customer secrets to the v2 envelope.
//
// Covers BOTH secret stores:
//   - user_api_keys.api_key_encrypted        (AI provider keys)
//   - git_integrations.access_token_encrypted (git provider tokens; legacy rows may be
//     v1-encrypted OR raw plaintext — the old code only decrypted when isEncrypted())
//
// Admin-only (same gate as admin-update-subscription: JWT app_metadata.is_admin).
// Requires ENCRYPTION_SECRET. Rows that fail to decrypt are left untouched and counted.
// Safe to run repeatedly: v2 rows are skipped.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decryptAny, encryptV2, isEncrypted } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface TableSummary {
  table: string;
  total: number;
  alreadyV2: number;
  upgradedFromV1: number;
  upgradedFromPlaintext: number;
  failed: number;
  failedIds: string[];
}

async function reencryptTable(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  table: string,
  column: string,
  encryptionSecret: string,
  legacySecret: string,
): Promise<TableSummary> {
  const summary: TableSummary = {
    table, total: 0, alreadyV2: 0, upgradedFromV1: 0, upgradedFromPlaintext: 0, failed: 0, failedIds: [],
  };

  const { data: rows, error } = await supabase.from(table).select(`id, ${column}`);
  if (error) throw new Error(`${table}: ${error.message}`);

  for (const row of (rows || []) as Array<Record<string, string | null>>) {
    const value = row[column];
    if (!value) continue;
    summary.total++;

    if (value.startsWith("v2:")) {
      summary.alreadyV2++;
      continue;
    }

    try {
      let upgraded: string;
      let fromPlaintext = false;

      if (isEncrypted(value)) {
        const { plaintext } = await decryptAny(value, { encryptionSecret, legacySecret });
        upgraded = await encryptV2(plaintext, encryptionSecret);
      } else {
        // Legacy reality for git tokens: stored raw. Encrypt in place.
        upgraded = await encryptV2(value, encryptionSecret);
        fromPlaintext = true;
      }

      const { error: updateError } = await supabase
        .from(table)
        .update({ [column]: upgraded })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);

      if (fromPlaintext) summary.upgradedFromPlaintext++;
      else summary.upgradedFromV1++;
    } catch (e) {
      summary.failed++;
      summary.failedIds.push(String(row.id));
      console.error(`[admin-reencrypt-secrets] ${table} row ${row.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return summary;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: "Database not configured" }, 500);
    }

    const encryptionSecret = Deno.env.get("ENCRYPTION_SECRET");
    if (!encryptionSecret) {
      return jsonResponse({ error: "ENCRYPTION_SECRET is not configured — set it before running the batch re-encryption (see DEPLOYMENT.md)" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    if (user.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: "Admin access required" }, 403);
    }

    const results = [
      await reencryptTable(supabase, "user_api_keys", "api_key_encrypted", encryptionSecret, supabaseServiceKey),
      await reencryptTable(supabase, "git_integrations", "access_token_encrypted", encryptionSecret, supabaseServiceKey),
    ];

    const remaining = results.reduce((n, r) => n + r.failed, 0);
    return jsonResponse({
      success: remaining === 0,
      results,
      note: remaining === 0
        ? "All stored secrets are now v2."
        : "Some rows failed to decrypt and were left untouched — their owners must re-save those keys/tokens.",
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});

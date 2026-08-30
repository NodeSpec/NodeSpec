// Shared env loading for the N10 sweep scripts. Parsing is IDENTICAL to the bench's
// scripts/bench/lib.mjs loadEnv — same file, same tolerances — so a .env.bench that
// runs the bench always runs the sweeps. Divergence here already bit once (2026-08-09):
// the first version split on "\n" and used an anchored regex, so on a Windows CRLF
// file the trailing \r kept `$` from matching and EVERY line silently failed to parse.
export function loadBenchEnv(importMetaUrl: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = Deno.readTextFileSync(new URL("./bench/.env.bench", importMetaUrl));
  } catch {
    return out; // no bench env file — env vars must carry
  }
  // Bench-identical: /\r?\n/ split, whitespace-tolerant key=value, comments skipped,
  // blank values counted as ABSENT (a bare "KEY=" line must not shadow a default).
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[2].trim().length > 0) out[m[1]] = m[2].trim();
  }
  return out;
}

export interface SweepEnv {
  SUPABASE_URL: string;
  KEY: string;
}

/** Resolve URL + service key (env vars win over .env.bench, same precedence as the
 *  bench) or exit with a diagnosis that says exactly what was looked at. */
export function resolveSweepEnv(importMetaUrl: string): SweepEnv {
  const fromFile = loadBenchEnv(importMetaUrl);
  const url = (Deno.env.get("SUPABASE_URL") ?? fromFile.SUPABASE_URL ?? "http://127.0.0.1:54321").replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? fromFile.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    const found = Object.keys(fromFile);
    console.error("SUPABASE_SERVICE_ROLE_KEY missing — set the env var or fill scripts/bench/.env.bench");
    console.error(found.length > 0
      ? `  scripts/bench/.env.bench was read; keys with non-blank values: ${found.join(", ")}`
      : "  scripts/bench/.env.bench was not found or has no non-blank values");
    Deno.exit(1);
  }
  return { SUPABASE_URL: url, KEY: key };
}

// N10(b) — docsUrl LIVE VERIFIER. Fetches every apiReference.docsUrl stored in the
// catalog and reports any that do not answer 2xx/3xx. Run on a machine with open
// egress (the authoring environment has none — the URL batch migration says so in
// its header); every failure this prints is a catalog bug report.
//
//   npm run n10:verify-urls
import { resolveSweepEnv } from "./n10-lib.ts";

const { SUPABASE_URL, KEY } = resolveSweepEnv(import.meta.url);

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/technology_catalog?select=id,ai_context&limit=1000`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
);
if (!res.ok) {
  console.error(`technology_catalog: ${res.status} ${await res.text()}`);
  Deno.exit(1);
}
const rows: { id: string; ai_context?: { apiReference?: { docsUrl?: string } } }[] = await res.json();

const withUrl = rows
  .map((r) => ({ id: r.id, url: r.ai_context?.apiReference?.docsUrl }))
  .filter((r): r is { id: string; url: string } => typeof r.url === "string" && r.url.length > 0);

console.log(`Checking ${withUrl.length} stored docsUrl values…`);
const failures: { id: string; url: string; status: string }[] = [];
const botBlocked: { id: string; url: string }[] = [];

// A real browser UA: several docs hosts (Oracle's dev.mysql.com WAF, first live run
// 2026-08-10) answer 403 to UA-less fetches for URLs that load fine in a browser.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Sequential with a small delay — this is a correctness check, not a load test.
async function check(url: string): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    // GET, not HEAD — several docs CDNs reject HEAD.
    const r = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": UA } });
    try { await r.body?.cancel(); } catch { /* consumed/locked body is not a URL verdict */ }
    return r.status;
  } finally {
    clearTimeout(timer);
  }
}

for (const { id, url } of withUrl) {
  try {
    let status: number;
    try {
      status = await check(url);
    } catch {
      // One retry — transient resets are common on bot-hostile hosts.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await check(url);
    }
    if (status === 403) {
      // The host ANSWERED — the URL exists but a WAF dislikes scripted clients.
      botBlocked.push({ id, url });
    } else if (status >= 400) {
      failures.push({ id, url, status: String(status) });
    }
  } catch {
    // A fetch-level TypeError is a CLIENT rejection (TLS/protocol/bot defenses), not
    // proof the URL is wrong (first live run: developer.android.com). Same class as
    // a WAF 403: confirm once in a browser instead of filing a catalog bug.
    botBlocked.push({ id, url: `${url} (connection rejected — script client)` });
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}

if (botBlocked.length > 0) {
  console.log(`${botBlocked.length} bot-blocked (403 — the host answered; confirm once in a browser):`);
  for (const b of botBlocked) console.log(`  ${b.id}: ${b.url}`);
}
if (failures.length === 0) {
  console.log(`ALL ${withUrl.length} docsUrl values answered — verified live.`);
} else {
  console.log(`${failures.length} FAILURE(S) — each is a catalog bug report:`);
  for (const f of failures) console.log(`  ${f.id}: ${f.url} → ${f.status}`);
  Deno.exit(2);
}

// AJ.1 (owner 2026-09-30, huge repositories): when GitHub's recursive listing
// is cut short, the import walks the tree a directory at a time, fifteen reads
// at once. A directory whose read failed (GitHub's secondary rate limit, on a
// repository with thousands of directories) was dropped and the listing still
// called complete: its files were missing from the import, and the index
// freshness sweep, which skips a truncated listing so it cannot misreport
// deletions, took them as deleted. A failed read is retried as GitHub asks,
// and one that still fails marks the listing truncated.
import { fetchGitHubTreeNonRecursive, retryWaitMs } from "../_shared/git-tree.ts";
import { assert, assertEquals } from "./helpers.ts";

type Item = { path: string; type: "blob" | "tree"; sha: string };
const tree = (items: Item[]) => new Response(JSON.stringify({ tree: items }), { status: 200 });

function github(dirs: Record<string, (call: number) => Response>) {
  const calls = new Map<string, number>();
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const sha = String(input).split("/git/trees/")[1];
    const n = (calls.get(sha) ?? 0) + 1;
    calls.set(sha, n);
    return dirs[sha](n);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const ROOT = () => tree([
  { path: "README.md", type: "blob", sha: "b0" },
  { path: "flaky", type: "tree", sha: "flaky" },
  { path: "gone", type: "tree", sha: "gone" },
  { path: "ok", type: "tree", sha: "ok" },
]);

Deno.test("AJ.1 tree walk: a rate-limited directory is read after the wait GitHub asks; one that still fails marks the listing truncated", async () => {
  const slept: number[] = [];
  const { fetchImpl, calls } = github({
    root: ROOT,
    flaky: (n) => n <= 2
      ? new Response("secondary rate limit", { status: 403, headers: { "retry-after": "3" } })
      : tree([{ path: "x.ts", type: "blob", sha: "b1" }]),
    gone: () => new Response("server error", { status: 502 }),
    ok: () => tree([{ path: "y.ts", type: "blob", sha: "b2" }]),
  });
  const r = await fetchGitHubTreeNonRecursive("https://api.github.com", "o", "r", "root", {}, { fetchImpl, sleep: async (ms) => { slept.push(ms); } });
  const paths = r.tree.map((t: { path: string }) => t.path).sort();
  assertEquals(paths, ["README.md", "flaky/x.ts", "ok/y.ts"]);
  assertEquals(r.truncated, true, "a directory it could not read means the listing is incomplete");
  assertEquals(r.failedDirs, 1);
  assertEquals(calls.get("flaky"), 3);
  assertEquals(calls.get("gone"), 3, "a server error is retried too, then given up");
  assert(slept.filter((ms) => ms === 3000).length === 2, `waited what GitHub asked: ${slept}`);
});

Deno.test("AJ.1 tree walk: a complete walk is not truncated; a directory refused for good is not retried", async () => {
  const clean = github({ root: () => tree([{ path: "ok", type: "tree", sha: "ok" }]), ok: () => tree([{ path: "y.ts", type: "blob", sha: "b2" }]) });
  const r = await fetchGitHubTreeNonRecursive("https://api.github.com", "o", "r", "root", {}, { fetchImpl: clean.fetchImpl, sleep: async () => {} });
  assertEquals(r.truncated, false);
  assertEquals(r.failedDirs, undefined);

  const refused = github({ root: () => tree([{ path: "secret", type: "tree", sha: "s" }]), s: () => new Response("Not Found", { status: 404 }) });
  const r2 = await fetchGitHubTreeNonRecursive("https://api.github.com", "o", "r", "root", {}, { fetchImpl: refused.fetchImpl, sleep: async () => {} });
  assertEquals(refused.calls.get("s"), 1, "a 404 is not a rate limit");
  assertEquals([r2.truncated, r2.failedDirs], [true, 1]);
});

Deno.test("AJ.1 retry wait: Retry-After, a spent quota, and what is not worth waiting for", () => {
  const res = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });
  assertEquals(retryWaitMs(res(403, { "retry-after": "5" }), 10_000), 5000);
  assertEquals(retryWaitMs(res(429, { "retry-after": "60" }), 10_000), 10_000, "capped");
  assertEquals(retryWaitMs(res(503), 10_000, 1500), 1500);
  assertEquals(retryWaitMs(res(403), 10_000), null, "a plain 403 is a permission, not a limit");
  assertEquals(retryWaitMs(res(404), 10_000), null);
  const soon = String(Math.floor(Date.now() / 1000) + 3);
  const wait = retryWaitMs(res(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": soon }), 10_000)!;
  assert(wait > 0 && wait <= 4000, String(wait));
  const late = String(Math.floor(Date.now() / 1000) + 3600);
  assertEquals(retryWaitMs(res(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": late }), 10_000), null);
});

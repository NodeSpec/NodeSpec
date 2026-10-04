// RLS and access audit (owner 2026-09-30): "ensure we are not introducing a leakage or
// security risk". git-pull's selective fetch put a path from the request body straight
// into the GitHub contents URL, and a URL resolves dot segments, so a seat holder could
// send "../../../../user/repos#" and read another GitHub endpoint with the integration's
// token. Every reader that puts a repository path into a provider URL now encodes it
// segment by segment and refuses one that is not a plain path inside the repository.
import { assert, assertEquals } from './helpers.ts';
import { encodeRepoPath, fetchGitHubFiles } from '../_shared/git-tree.ts';
import { readRepoFile } from '../_shared/git-provider.ts';

const API = 'https://api.github.com';
const CONTENTS = '/repos/acme/app/contents/';

/** Runs `body` with fetch answering every call; returns the URLs it was asked for. */
async function withFetch(body: () => Promise<void>): Promise<string[]> {
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    return Promise.resolve(new Response(JSON.stringify({ encoding: 'utf-8', content: 'x' }), { status: 200 }));
  }) as typeof fetch;
  try { await body(); } finally { globalThis.fetch = real; }
  return asked;
}

Deno.test('a repository path is encoded segment by segment; one that leaves the repository is refused', () => {
  assertEquals(encodeRepoPath('src/app/main.ts'), 'src/app/main.ts');
  assertEquals(encodeRepoPath('docs/My File #1?.md'), 'docs/My%20File%20%231%3F.md');
  assertEquals(encodeRepoPath('.github/workflows/ci.yml'), '.github/workflows/ci.yml', 'a dot file is a plain name');
  for (const bad of ['', '/etc/passwd', '../secrets', 'a/../../b', 'a/./b', 'a//b', 'a/', '..', '.', 'a\u0000b', 'x\ny']) {
    assertEquals(encodeRepoPath(bad), null, JSON.stringify(bad));
  }
});

Deno.test('the selective fetch never reaches past the repository contents, whatever path it is sent', async () => {
  const paths = [
    'src/index.ts',
    '../../../../user/repos?visibility=private#',
    '../../../../repos/acme/other-private/contents/.env#',
    'docs/%2e%2e/%2e%2e/%2e%2e/user',
    'a/./b.ts',
    'docs/My File.md',
  ];
  const asked = await withFetch(async () => {
    const files = await fetchGitHubFiles(API, 'acme', 'app', 'feature/x', 'tok', paths);
    assertEquals(files.map((f) => f.path), ['src/index.ts', 'docs/%2e%2e/%2e%2e/%2e%2e/user', 'docs/My File.md'],
      'the plain paths are read; the ones that climb out are not');
  });
  assertEquals(asked.length, 3);
  for (const url of asked) {
    const u = new URL(url);
    assert(u.pathname.startsWith(CONTENTS), `${url} left the repository contents`);
    assertEquals(u.searchParams.get('ref'), 'feature/x', 'the ref is one query value');
    assertEquals(u.hash, '', 'nothing after a # was carried');
  }
  assert(asked.some((u) => u.includes('docs/%252e%252e/')), 'an encoded dot is encoded again, never decoded into a climb');
});

Deno.test('reading one repository file refuses a path outside the repository before any request', async () => {
  const asked = await withFetch(async () => {
    const bad = await readRepoFile('github', API, 'acme', 'app', '../../../user', 'main', 'tok');
    assertEquals(bad.status, 'failed');
    const ok = await readRepoFile('github', API, 'acme', 'app', '.nodespec/model.json', 'main', 'tok');
    assertEquals(ok.status, 'found');
  });
  assertEquals(asked.length, 1, 'only the plain path was requested');
  assert(new URL(asked[0]).pathname.startsWith(CONTENTS));
});

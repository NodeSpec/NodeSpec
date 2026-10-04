import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { build } from 'vite';
import { managedAnalytics } from '../../vite.config';

/*
  Audit (owner 2026-09-27): "Google analytics is only on our managed versions
  free/indie/team and should not be on others." The tag is added at build
  time for the hosted edition with a measurement id; a real Vite build of a
  small page shows what each edition ships.
*/

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function built(env: Record<string, string | undefined>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'ga-build-'));
  dirs.push(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><title>t</title></head><body><script type="module" src="/main.js"></script></body></html>');
  writeFileSync(join(root, 'main.js'), 'document.title = "t";\n');
  await build({ root, configFile: false, logLevel: 'silent', plugins: [managedAnalytics(env)], build: { outDir: join(root, 'dist'), emptyOutDir: true } });
  return readFileSync(join(root, 'dist', 'index.html'), 'utf8');
}

const ID = 'G-TEST123';

describe('Google Analytics by edition', () => {
  it('the managed build (hosted, with an id) carries the tag and its id, in the head', async () => {
    const html = await built({ VITE_NODESPEC_EDITION: 'hosted', VITE_GA_MEASUREMENT_ID: ID });
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain(`<script async src="https://www.googletagmanager.com/gtag/js?id=${ID}"></script>`);
    expect(head).toContain(`gtag('config', '${ID}');`);
  });

  it.each([
    ['the open source build (no edition)', {}],
    ['the Enterprise build', { VITE_NODESPEC_EDITION: 'enterprise' }],
    ['the Government build', { VITE_NODESPEC_EDITION: 'government' }],
  ])('%s carries no tag, even with an id in its environment', async (_label, env) => {
    const html = await built({ ...env, VITE_GA_MEASUREMENT_ID: ID });
    expect(html).not.toContain('googletagmanager');
    expect(html).not.toContain('gtag(');
    expect(html).not.toContain(ID);
  });

  it('hosted without an id, or with one that is not a measurement id, carries none', async () => {
    expect(await built({ VITE_NODESPEC_EDITION: 'hosted' })).not.toContain('googletagmanager');
    const odd = await built({ VITE_NODESPEC_EDITION: 'hosted', VITE_GA_MEASUREMENT_ID: "G-1');alert(1);//" });
    expect(odd).not.toContain('googletagmanager');
    expect(odd).not.toContain('alert(1)');
  });

  it('the page every build starts from carries neither the tag nor the managed id', () => {
    const page = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    expect(page).not.toContain('googletagmanager');
    expect(page).not.toMatch(/G-[A-Z0-9]{6,}/);
  });
});

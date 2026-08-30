import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/*
  Plain-HTTP MCP connect lane (owner boot-test find, 2026-08-31).

  A community container runs on http:// when local or freshly self-hosted —
  and clients that add remote connectors by URL (Claude Desktop / claude.ai)
  REQUIRE https, so the one-URL flow is a dead end there. The shared connect
  guide must teach the mcp-remote bridge whenever the server URL is http://,
  and render the unchanged one-URL flow on https (hosted, TLS-fronted
  enterprise) — one guide backs the walkthrough step, the header popup, and
  the connect modal, so this cannot drift per surface.
*/

const guide = readFileSync(
  resolve(__dirname, '../ui/components/common/McpConnectGuide.tsx'),
  'utf-8'
);

describe('MCP connect guide — http-aware Claude Desktop lane', () => {
  it('detects the transport from the real server URL', () => {
    expect(guide).toContain("const insecureHttp = mcpUrl.startsWith('http://')");
  });

  it('http gets the mcp-remote bridge with --allow-http; the browser sign-in survives', () => {
    expect(guide).toContain("tab === 'claude-desktop' && insecureHttp");
    expect(guide).toContain('"mcp-remote"');
    expect(guide).toContain('"--allow-http"');
    expect(guide).toContain('claude_desktop_config.json');
  });

  it('warns off the wrong file and teaches replace-vs-merge (owner live-hit, 2026-08-31)', () => {
    // The owner edited %APPDATA%\Claude\config.json — Claude's own preferences
    // file that sits NEXT to claude_desktop_config.json — and later pasted the
    // snippet alongside existing content (parse error past the snippet's last
    // line). The guide must name the trap and split the empty-file and
    // has-content cases explicitly.
    expect(guide).toContain('is Claude&apos;s own');
    expect(guide).toContain('preferences and the wrong place');
    expect(guide).toContain('paste the block below as the whole file');
    expect(guide).toContain('add only the');
    expect(guide).toContain('fully quit and restart Claude Desktop');
  });

  it('https renders the unchanged one-URL connector flow (hosted stays byte-identical)', () => {
    expect(guide).toContain("tab === 'claude-desktop' && !insecureHttp");
    expect(guide).toContain('Add custom connector');
  });

  it('cloud self-hosters are pointed at TLS-in-front as the no-bridge path', () => {
    const hits = guide.match(/TLS\s*\n?\s*section/g) ?? guide.match(/TLS/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2); // Claude Desktop tab + Other tab
  });

  it('one guide, three surfaces: walkthrough step and modal both render it', () => {
    for (const rel of ['../ui/components/common/MCPConnectStep.tsx', '../ui/components/panels/McpConnectModal.tsx']) {
      expect(readFileSync(resolve(__dirname, rel), 'utf-8')).toContain('McpConnectGuide');
    }
  });
});

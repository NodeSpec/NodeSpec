// The ONE connection guide (owner ruling 2026-08-13): the same clean UI backs
// the onboarding connect step AND the in-app "connection instructions" popup,
// so the instructions cannot drift between surfaces. Six lanes — Claude
// Desktop, Claude Code CLI, Cursor, OpenAI Codex, VS Code, Other — all
// pointing at the one OAuth endpoint; connecting opens a NodeSpec sign-in in
// the browser, no API key to generate or paste. "Other" carries the generic
// config plus the API-key fallback for clients that cannot browser-auth.
//
// Props mirror MCPConnectStep's (isDark + a colors record) so the guide works
// inside onboarding's modal, which renders outside the app ThemeProvider.
import { useState } from 'react';
import { Copy } from 'lucide-react';

type GuideTab = 'claude-desktop' | 'claude-code' | 'cursor' | 'codex' | 'vscode' | 'other';

const TABS: Array<{ id: GuideTab; label: string }> = [
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'OpenAI Codex' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'other', label: 'Other' },
];

export function McpConnectGuide({ isDark, c }: { isDark: boolean; c: Record<string, string> }) {
  const [tab, setTab] = useState<GuideTab>('claude-desktop');
  const [copied, setCopied] = useState<string | null>(null);

  const mcpUrl = import.meta.env.VITE_MCP_PUBLIC_URL
    || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp-server`;
  // Plain-HTTP deployment (local container, or self-hosted before TLS is put
  // in front): clients that add remote connectors by URL — Claude Desktop /
  // claude.ai — REQUIRE https and reject this URL outright (owner boot-test,
  // 2026-08-31). The mcp-remote bridge is the standard answer: a local stdio
  // relay the client launches itself, which talks HTTP to the container and
  // still runs the same OAuth browser sign-in. Hosted (https) renders the
  // unchanged one-URL flow.
  const insecureHttp = mcpUrl.startsWith('http://');
  const bridgeSnippet = `{
  "mcpServers": {
    "nodespec": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${mcpUrl}", "--allow-http"]
    }
  }
}`;

  const copyText = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const codeBlock = (id: string, text: string) => (
    <div style={{
      position: 'relative', padding: '10px 12px', borderRadius: '6px', fontSize: '11.5px',
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
      border: `1px solid ${c.border}`, fontFamily: 'ui-monospace, monospace',
      whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5, color: c.text,
    }}>
      {text}
      <button
        onClick={() => copyText(id, text)}
        style={{
          position: 'absolute', top: '6px', right: '6px', padding: '3px 8px',
          borderRadius: '4px', border: `1px solid ${c.border}`, fontSize: '10px',
          backgroundColor: copied === id ? '#15803d' : c.surface,
          color: copied === id ? '#fff' : c.text, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '4px',
        }}
      >
        <Copy size={10} /> {copied === id ? 'Copied' : 'Copy'}
      </button>
    </div>
  );

  const jsonSnippet = `{
  "mcpServers": {
    "nodespec": {
      "url": "${mcpUrl}"
    }
  }
}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* The one URL, front and center — copy it exactly, same for every account. */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: c.textMuted, marginBottom: '6px' }}>
          Server URL — identical for every account, nothing to customize
        </div>
        {codeBlock('mcp-url', mcpUrl)}
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 12px', borderRadius: '6px', fontSize: '12px',
              fontWeight: tab === t.id ? 700 : 500, cursor: 'pointer',
              border: tab === t.id ? 'none' : `1px solid ${c.border}`,
              backgroundColor: tab === t.id ? c.primary : 'transparent',
              color: tab === t.id ? '#fff' : c.text,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: '12.5px', lineHeight: 1.65, color: c.text }}>
        {tab === 'claude-desktop' && !insecureHttp && (
          <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <li>Open <strong>Settings → Connectors</strong> (claude.ai works too, on Pro/Max/Team plans).</li>
            <li>Choose <strong>Add custom connector</strong> and paste the server URL above. Leave the optional client fields empty.</li>
            <li>Claude opens a NodeSpec sign-in — approve it, and the tools appear.</li>
          </ol>
        )}
        {tab === 'claude-desktop' && insecureHttp && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              Claude&apos;s connector settings require an <strong>https://</strong> URL, and this NodeSpec
              runs on plain HTTP (normal for a local or freshly self-hosted container). Connect through
              the <strong>mcp-remote</strong> bridge instead — a small relay Claude Desktop launches
              itself (needs Node.js installed):
            </div>
            <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li>Open <strong>Settings → Developer → Edit Config</strong>. This targets{' '}
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>claude_desktop_config.json</span> — make sure
                that&apos;s the file you edit; the neighboring{' '}
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>config.json</span> is Claude&apos;s own
                preferences and the wrong place.</li>
              <li>If the file is empty (or brand new), paste the block below as the whole file. If it already has
                content, add only the <span style={{ fontFamily: 'ui-monospace, monospace' }}>&quot;nodespec&quot;</span>{' '}
                entry inside the existing <span style={{ fontFamily: 'ui-monospace, monospace' }}>&quot;mcpServers&quot;</span>{' '}
                object (create that object if it&apos;s missing).</li>
              <li>Save, then fully quit and restart Claude Desktop.</li>
              <li>Claude opens your browser to finish connecting. On a default local install the
                connection approves itself — the tab completes on its own and the tools appear. If a
                sign-in page shows instead, use your NodeSpec account.</li>
            </ol>
            {codeBlock('claude-bridge', bridgeSnippet)}
            <div style={{ color: c.textMuted }}>
              Running in your own cloud? Put HTTPS in front of the container (the deploy guide&apos;s TLS
              section covers CloudFront and reverse-proxy options) and the plain add-a-connector flow
              works with no bridge.
            </div>
          </div>
        )}
        {tab === 'claude-code' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>One command, then approve the sign-in it opens in your browser:</div>
            {codeBlock('cc-cmd', `claude mcp add --transport http nodespec ${mcpUrl}`)}
            <div style={{ color: c.textMuted }}>
              Run <span style={{ fontFamily: 'ui-monospace, monospace' }}>/mcp</span> inside Claude Code to
              check the connection or re-authorize.
            </div>
          </div>
        )}
        {tab === 'cursor' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>Add to <strong>~/.cursor/mcp.json</strong> (or Settings → MCP → Add server), then restart Cursor and approve the sign-in prompt:</div>
            {codeBlock('cursor-json', jsonSnippet)}
          </div>
        )}
        {tab === 'codex' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>Add to <strong>~/.codex/config.toml</strong>, then restart Codex and approve the sign-in prompt:</div>
            {codeBlock('codex-toml', `[mcp_servers.nodespec]\nurl = "${mcpUrl}"`)}
          </div>
        )}
        {tab === 'vscode' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              Create <strong>.vscode/mcp.json</strong> in your workspace (or run <strong>MCP: Add Server</strong>{' '}
              from the Command Palette). VS Code uses <span style={{ fontFamily: 'ui-monospace, monospace' }}>servers</span>,
              not <span style={{ fontFamily: 'ui-monospace, monospace' }}>mcpServers</span>:
            </div>
            {codeBlock('vscode-json', `{
  "servers": {
    "nodespec": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`)}
            <div style={{ color: c.textMuted }}>
              Start the server from the CodeLens above the entry, then approve the browser sign-in. Requires a
              VS Code version with Copilot agent-mode MCP support.
            </div>
          </div>
        )}
        {tab === 'other' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              Windsurf and most MCP-capable agents accept the standard config — add it wherever your client
              keeps MCP servers, restart, and approve the sign-in prompt:
            </div>
            {codeBlock('other-json', jsonSnippet)}
            {insecureHttp && (
              <div style={{ color: c.textMuted }}>
                If your client refuses <span style={{ fontFamily: 'ui-monospace, monospace' }}>http://</span> URLs,
                use the mcp-remote bridge shown on the Claude Desktop tab, or put HTTPS in front of the
                deployment (deploy guide, TLS section).
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

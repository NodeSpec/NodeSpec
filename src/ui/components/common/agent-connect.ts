// AK.1 (owner 2026-10-01): "We can't just favor claude code in our agents
// popup ... The primary platforms are claude code, codex, gemini's
// harness/antigravity, etc. If all of these are the same method, then
// simplify to local MCP client vs over our managed version." And: "single
// individuals authenticate over our managed platform primarily, meanwhile
// local is for our OSS version or enterprise users."
//
// The method is the same for every client: NodeSpec is one streamable HTTP
// MCP server at one address. What differs is how the client is told about
// it, and how the person proves who they are:
//
//   sign-in  the managed platform, served over https at a public address
//            (the managed edition against a local server is the key lane:
//            owner 2026-10-01, the dev container). The client is given the address and
//            opens a NodeSpec sign-in in the browser (OAuth); there is
//            nothing to copy but the address.
//   key      a local build (open source, Enterprise, Government), or any
//            agent that cannot open a browser. A key minted under Agents,
//            Connected, sent as `Authorization: Bearer <key>` (the server
//            reads it the same as X-MCP-API-Key).
//
// So the lines are per client, and each client's line is the one its own
// documentation gives (checked 2026-10-01): Claude Code `claude mcp add`,
// Codex `codex mcp add --url` (TOML, bearer from an environment variable),
// Gemini CLI `gemini mcp add --transport http`, Antigravity's
// mcp_config.json (`serverUrl`), the Claude app's connectors (or the
// mcp-remote bridge for a key), and the plain `mcpServers` shape most other
// clients take (Cursor, Windsurf, Hermes). Antigravity has no reliable
// browser sign-in for remote servers, so it takes a key on every build.
//
// Pure: the build and the client in, the words and the lines out.
import type { Edition } from '../../config/feature-rules.js';

export type ConnectLane = 'sign-in' | 'key';

export type AgentClient = 'claude-code' | 'codex' | 'gemini-cli' | 'antigravity' | 'claude-app' | 'other';

export const AGENT_CLIENTS: ReadonlyArray<{ id: AgentClient; label: string }> = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini-cli', label: 'Gemini CLI' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'claude-app', label: 'Claude app' },
  { id: 'other', label: 'Other MCP client' },
];

/** A server on the person's own machine or network: plain http, or a
 *  loopback, private or .local address. The Claude app adds remote servers
 *  over https only, and reaches them from Anthropic's side, so it cannot
 *  sign in to one of these; local clients reach it directly, with a key. */
export function isLocalServer(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return true; }
  if (u.protocol !== 'https:') return true;
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === 'host.docker.internal'
    || h === '::1' || h === '0.0.0.0' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

/** How this build's people connect: the managed platform signs a person in
 *  through their client; a local build, or the managed edition run against a
 *  local server (a dev container), connects a local client with a key. */
export function connectLaneFor(edition: Edition, url: string): ConnectLane {
  return edition === 'hosted' && !isLocalServer(url) ? 'sign-in' : 'key';
}

/** The environment variable Codex reads the key from. */
export const CODEX_KEY_ENV = 'NODESPEC_API_KEY';

export interface ClientSteps {
  /** The client needs a key even where the build signs people in. */
  needsKey: boolean;
  /** What to do, in order. */
  steps: string[];
  /** The lines to copy, each with what it is. */
  blocks: Array<{ id: string; label: string; text: string }>;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** The steps and lines for one client. On the key lane, `key` is the key
 *  just minted (the lines are only drawn with one). */
export function clientSteps(client: AgentClient, lane: ConnectLane, url: string, key?: string): ClientSteps {
  const http = url.startsWith('http://');
  const signIn = lane === 'sign-in' && client !== 'antigravity';
  if (signIn) {
    switch (client) {
      case 'claude-code':
        return { needsKey: false, steps: ['Add NodeSpec, then run /mcp inside Claude Code, choose nodespec and approve the NodeSpec sign-in it opens.'],
          blocks: [{ id: 'claude-code', label: 'Terminal', text: `claude mcp add --transport http nodespec ${url}` }] };
      case 'codex':
        return { needsKey: false, steps: ['Add NodeSpec, then sign in; Codex opens the NodeSpec sign-in in your browser.'],
          blocks: [
            { id: 'codex-add', label: 'Terminal', text: `codex mcp add nodespec --url ${url}` },
            { id: 'codex-login', label: 'Then', text: 'codex mcp login nodespec' },
          ] };
      case 'gemini-cli':
        return { needsKey: false, steps: ['Add NodeSpec, then run /mcp auth nodespec inside Gemini CLI and approve the NodeSpec sign-in it opens.'],
          blocks: [{ id: 'gemini-cli', label: 'Terminal', text: `gemini mcp add --transport http nodespec ${url}` }] };
      case 'claude-app':
        return { needsKey: false, steps: [
          'In Claude (desktop or claude.ai), open Settings, Connectors, and choose Add custom connector.',
          'Paste the server address below and leave the optional fields empty. Claude opens the NodeSpec sign-in; approve it.',
        ], blocks: [{ id: 'claude-app', label: 'Server address', text: url }] };
      default:
        return { needsKey: false, steps: [
          'Add NodeSpec where your client keeps its MCP servers, restart it, and approve the NodeSpec sign-in it opens.',
          'Most clients take this shape (Cursor, Windsurf and others); a few name the address field differently, so follow your client if it asks for another key.',
        ], blocks: [{ id: 'other', label: 'MCP config', text: json({ mcpServers: { nodespec: { url } } }) }] };
    }
  }

  // The key lane: every line carries the key, so it is drawn only with one.
  const k = key ?? '<your key>';
  const bearer = `Bearer ${k}`;
  const check = { id: 'check', label: 'Check the connection', text: `curl -s ${url} -H "Authorization: ${bearer}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'` };
  switch (client) {
    case 'claude-code':
      return { needsKey: true, steps: ['Add NodeSpec with the key, then run /mcp inside Claude Code to see it connected.'],
        blocks: [{ id: 'claude-code', label: 'Terminal', text: `claude mcp add --transport http nodespec ${url} --header "Authorization: ${bearer}"` }, check] };
    case 'codex':
      return { needsKey: true, steps: [`Codex reads the key from an environment variable: set ${CODEX_KEY_ENV} where Codex runs (your shell profile keeps it), then add NodeSpec.`],
        blocks: [
          { id: 'codex-env', label: 'Shell', text: `export ${CODEX_KEY_ENV}="${k}"` },
          { id: 'codex-add', label: 'Terminal', text: `codex mcp add nodespec --url ${url} --bearer-token-env-var ${CODEX_KEY_ENV}` },
          check,
        ] };
    case 'gemini-cli':
      return { needsKey: true, steps: ['Add NodeSpec with the key, then run /mcp inside Gemini CLI to see it connected.'],
        blocks: [{ id: 'gemini-cli', label: 'Terminal', text: `gemini mcp add --transport http nodespec ${url} --header "Authorization: ${bearer}"` }, check] };
    case 'antigravity':
      return { needsKey: true, steps: [
        'In Antigravity open Manage MCP Servers, then View raw config (mcp_config.json).',
        'Add the nodespec entry inside mcpServers, save, and refresh the servers. Antigravity names the address serverUrl.',
      ], blocks: [{ id: 'antigravity', label: 'mcp_config.json', text: json({ mcpServers: { nodespec: { serverUrl: url, headers: { Authorization: bearer } } } }) }, check] };
    case 'claude-app':
      return { needsKey: true, steps: [
        'The Claude app takes a key through the mcp-remote bridge (needs Node.js): open Settings, Developer, Edit Config, which opens claude_desktop_config.json.',
        'Add the nodespec entry inside mcpServers, save, then quit Claude fully and open it again.',
      ], blocks: [{ id: 'claude-app', label: 'claude_desktop_config.json', text: json({ mcpServers: { nodespec: {
        command: 'npx',
        args: ['-y', 'mcp-remote', url, ...(http ? ['--allow-http'] : []), '--header', 'Authorization:${NODESPEC_AUTH}'],
        env: { NODESPEC_AUTH: bearer },
      } } }) }, check] };
    default:
      return { needsKey: true, steps: [
        'Add NodeSpec where your client keeps its MCP servers and restart it. Hermes, Cursor, Windsurf and most clients take this shape.',
        'A client that names the address field differently (VS Code: servers, with "type": "http") takes the same address and the same header.',
      ], blocks: [{ id: 'other', label: 'MCP config', text: json({ mcpServers: { nodespec: { url, headers: { Authorization: bearer } } } }) }, check] };
  }
}

/** The sentence the Connected tab and the tour open with, by lane. */
export function connectIntro(lane: ConnectLane): string {
  return lane === 'sign-in'
    ? 'Every client connects to the same address and signs you in through the browser. Pick yours for the exact line.'
    : 'Every MCP client connects the same way: this server\'s address and a key. Mint a key per agent, then pick its client for the exact line.';
}
